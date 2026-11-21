import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Notice } from '../src/models/Notice.js';
import { ProcessingJob } from '../src/models/ProcessingJob.js';
import { User } from '../src/models/User.js';
import { config } from '../src/config/env.js';
import { removeStoredDocument } from '../src/services/gridFs.service.js';
import { analyzeNoticeText } from '../src/services/geminiAnalysis.service.js';
import { verifyOfficialPublication } from '../src/services/sourceVerification.service.js';
vi.mock('../src/services/geminiAnalysis.service.js', () => ({
  analyzeNoticeText: vi.fn(),
}));
vi.mock('../src/services/sourceVerification.service.js', () => ({
  verifyOfficialPublication: vi.fn(),
}));

const origin = 'http://localhost:5173';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/zWQAAAAASUVORK5CYII=', 'base64');

function createPdf(pageCount) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>'),
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, value] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${value}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body);
}

function createPngHeader(width, height) {
  const header = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function createJpegHeader(width, height) {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    0x00, 0xff, 0xd9,
  ]);
}

function upload(agent, name = 'notice.png', buffer = png, mime = 'image/png') {
  return agent.post('/api/v1/notices/upload').set('Origin', origin)
    .set('X-CSRF-Token', agent.csrfToken)
    .attach('document', buffer, { filename: name, contentType: mime });
}

async function createCitizen(email = 'citizen@example.com') {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf');
  agent.csrfToken = csrf.body.csrfToken;
  const registered = await agent.post('/api/v1/auth/register').set('Origin', origin)
    .set('X-CSRF-Token', agent.csrfToken)
    .send({ email, password: 'A secure pass 123!' });
  expect(registered.status).toBe(201);
  agent.userId = registered.body.user.id;
  agent.csrfToken = registered.body.csrfToken;
  return agent;
}

beforeAll(async () => {
  await connectDatabase();
  await Promise.all([User.init(), Notice.init(), ProcessingJob.init()]);
});

beforeEach(async () => {
  vi.clearAllMocks();
  await Promise.all([User.deleteMany({}), Notice.deleteMany({}), ProcessingJob.deleteMany({})]);
  await Promise.all([
    mongoose.connection.db.collection(`${config.gridFsBucketName}.files`).deleteMany({}),
    mongoose.connection.db.collection(`${config.gridFsBucketName}.chunks`).deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoose.connection.close();
});

describe('authenticated document upload and private storage', () => {
  it('requires authentication to list notices', async () => {
    const response = await request(app).get('/api/v1/notices');
    expect(response.status).toBe(401);
  });

  it('returns an empty list when the signed-in user has no notices', async () => {
    const agent = await createCitizen();
    const response = await agent.get('/api/v1/notices');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ notices: [] });
  });

  it('lists only the signed-in user notices using safe fields and real IDs', async () => {
    const owner = await createCitizen('notice-list-owner@example.com');
    const otherUser = await createCitizen('notice-list-other@example.com');
    const gridFsId = new mongoose.Types.ObjectId();
    const ownedNotice = await Notice.create({
      ownerId: owner.userId,
      originalFile: {
        gridFsId,
        filename: 'water-supply.pdf',
        contentType: 'application/pdf',
        sizeBytes: 123,
      },
      status: 'completed',
    });
    await ProcessingJob.create({
      noticeId: ownedNotice._id,
      ownerId: owner.userId,
      status: 'completed',
      extractionMethod: 'digital',
      extractedPages: [{ pageNumber: 1, method: 'digital', text: 'PRIVATE EXTRACTED PAGE TEXT' }],
      analysis: {
        title: { value: 'Water supply interruption' },
        internalMarker: 'PRIVATE ANALYSIS DATA',
      },
      attempts: 3,
      lastErrorCode: 'PROCESSING_FAILED',
    });
    const otherNotice = await Notice.create({
      ownerId: otherUser.userId,
      originalFile: {
        gridFsId: new mongoose.Types.ObjectId(),
        filename: 'another-users-notice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 456,
      },
      status: 'queued',
    });

    const response = await owner.get('/api/v1/notices');

    expect(response.status).toBe(200);
    expect(response.body.notices).toHaveLength(1);
    expect(response.body.notices[0]).toMatchObject({
      id: String(ownedNotice._id),
      title: 'Water supply interruption',
      filename: 'water-supply.pdf',
      extractionStatus: 'completed',
    });
    expect(new Date(response.body.notices[0].uploadedAt).toISOString()).toBe(ownedNotice.createdAt.toISOString());
    expect(response.body.notices[0].id).not.toBe(String(otherNotice._id));
    expect(response.body.notices[0]).not.toHaveProperty('ownerId');
    expect(JSON.stringify(response.body)).not.toContain(String(gridFsId));
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE EXTRACTED PAGE TEXT');
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE ANALYSIS DATA');
    expect(JSON.stringify(response.body)).not.toContain('attempts');
    expect(JSON.stringify(response.body)).not.toContain('lastErrorCode');
  });

 it('requires authentication and CSRF before accepting an upload', async () => {
  const anonymous = await request(app).post('/api/v1/notices/upload').set('Origin', origin)
    .attach('document', png, { filename: 'notice.png', contentType: 'image/png' });
  expect(anonymous.status).toBe(401);

  const agent = await createCitizen();
  const noCsrf = await agent.post('/api/v1/notices/upload').set('Origin', origin)
    .attach('document', png, { filename: 'notice.png', contentType: 'image/png' });
  expect(noCsrf.status).toBe(403);
});

  it('streams an accepted image to GridFS and creates a notice and queued job', async () => {
    const agent = await createCitizen();
    const response = await upload(agent);
    expect(response.status).toBe(201);
    expect(response.body.notice).toMatchObject({
      filename: 'notice.png',
      contentType: 'image/png',
      sizeBytes: png.length,
      status: 'queued',
      authenticityStatus: 'unverified',
      sourceVerification: { status: 'not_checked' },
    });
    expect(response.body.processing).toMatchObject({ status: 'queued', progress: 0 });
    expect(await Notice.countDocuments()).toBe(1);
    expect(await ProcessingJob.countDocuments()).toBe(1);
    expect(await mongoose.connection.db.collection(`${config.gridFsBucketName}.files`).countDocuments()).toBe(1);
    const detail = await agent.get(`/api/v1/notices/${response.body.notice.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.processing.status).toBe('queued');
    expect(detail.body).not.toHaveProperty('ownerId');
    expect(JSON.stringify(detail.body)).not.toContain('gridFsId');
    expect((await agent.get(`/api/v1/notices/${response.body.notice.id}/text`)).status).toBe(409);
    const document = await agent.get(`/api/v1/notices/${response.body.notice.id}/document`);
    expect(document.status).toBe(200);
    expect(document.headers['content-type']).toBe('image/png');
    expect(Buffer.from(document.body).equals(png)).toBe(true);
  });

  it('accepts a readable PDF and rejects PDFs above the configured page limit', async () => {
    const agent = await createCitizen();
    const accepted = await upload(agent, 'one-page.pdf', createPdf(1), 'application/pdf');
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);

    const tooManyPages = await upload(agent, 'large.pdf', createPdf(config.uploadMaxPdfPages + 1), 'application/pdf');
    expect(tooManyPages.status).toBe(400);
    expect(tooManyPages.body.error.code).toBe('PDF_PAGE_LIMIT');
    expect(await Notice.countDocuments()).toBe(1);
  });

  it('accepts a JPEG with readable dimensions', async () => {
    const agent = await createCitizen();
    const response = await upload(agent, 'notice.jpg', createJpegHeader(1, 1), 'image/jpeg');
    expect(response.status).toBe(201);
    expect(response.body.notice.contentType).toBe('image/jpeg');
  });

  it('rejects spoofed signatures, unsupported formats, and untrusted origins', async () => {
    const agent = await createCitizen();
    expect((await upload(agent, 'fake.png', Buffer.from('%PDF-1.7'), 'image/png')).status).toBe(400);
    expect((await upload(agent, 'notice.gif', Buffer.from('GIF89a'), 'image/gif')).status).toBe(400);
    const wrongOrigin = await agent.post('/api/v1/notices/upload').set('Origin', 'https://attacker.invalid')
      .set('X-CSRF-Token', agent.csrfToken).attach('document', png, { filename: 'notice.png', contentType: 'image/png' });
    expect(wrongOrigin.status).toBe(403);
    expect(await Notice.countDocuments()).toBe(0);
  });

  it('enforces the upload byte and image pixel limits', async () => {
    const agent = await createCitizen();
    const oversizedImage = await upload(agent, 'oversized.png', createPngHeader(7000, 7000));
    expect(oversizedImage.status).toBe(400);
    expect(oversizedImage.body.error.code).toBe('IMAGE_DIMENSION_LIMIT');

    const tooLarge = await upload(agent, 'large.png', Buffer.alloc(config.uploadMaxFileSizeBytes + 1), 'image/png');
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await Notice.countDocuments()).toBe(0);
  });

  it('hides notice details and original files from another account', async () => {
    const owner = await createCitizen('owner@example.com');
    const created = await upload(owner);
    const stranger = await createCitizen('stranger@example.com');
    expect((await stranger.get(`/api/v1/notices/${created.body.notice.id}`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/notices/${created.body.notice.id}/text`)).status).toBe(404);
    expect((await stranger.get(`/api/v1/notices/${created.body.notice.id}/document`)).status).toBe(404);
  });

  it('returns extracted pages only after completion and only to the owner', async () => {
    const owner = await createCitizen();
    const uploaded = await upload(owner);
    const noticeId = uploaded.body.notice.id;
    await ProcessingJob.updateOne({ noticeId }, {
      $set: {
        status: 'completed', progress: 100, currentPage: 1, totalPages: 1,
        extractionMethod: 'ocr', extractedPages: [{ pageNumber: 1, method: 'ocr', text: 'PUBLIC NOTICE' }],
      },
    });
    const detail = await owner.get(`/api/v1/notices/${noticeId}`);
    expect(detail.body.processing).toMatchObject({ status: 'completed', extractionMethod: 'ocr' });
    expect(detail.body).not.toHaveProperty('pages');
    expect((await owner.get(`/api/v1/notices/${noticeId}/text`)).body).toMatchObject({
      extractionMethod: 'ocr', pages: [{ pageNumber: 1, method: 'ocr', text: 'PUBLIC NOTICE' }],
    });
    const stranger = await createCitizen('stranger@example.com');
    expect((await stranger.get(`/api/v1/notices/${noticeId}/text`)).status).toBe(404);
  });
it('analyses extracted notices, saves results, and restricts access to the owner', async () => {
  const owner = await createCitizen();
  const uploaded = await upload(owner);
  const noticeId = uploaded.body.notice.id;

  await ProcessingJob.updateOne({ noticeId }, {
    $set: {
      status: 'completed',
      progress: 100,
      extractedPages: [{
        pageNumber: 1,
        method: 'digital',
        text: 'PUBLIC NOTICE. Water supply interruption in Tambaram.',
      }],
    },
  });

  const analysis = {
    documentCategory: {
      value: 'public_notice',
      evidence: 'PUBLIC NOTICE',
      pageNumber: 1,
    },
    title: {
      value: 'Water supply interruption',
      evidence: 'Water supply interruption',
      pageNumber: 1,
    },
    issuingDepartment: null,
    noticeDate: null,
    importantDates: [],
    locations: [{
      value: 'Tambaram',
      evidence: 'Water supply interruption in Tambaram.',
      pageNumber: 1,
    }],
    citizenInstructions: [],
    referenceNumbers: [],
  };

  analyzeNoticeText.mockResolvedValueOnce(analysis);

  const response = await owner.post(`/api/v1/notices/${noticeId}/analyze`)
    .set('Origin', origin)
    .set('X-CSRF-Token', owner.csrfToken)
    .send({});

  expect(response.status).toBe(200);
  expect(response.body).toEqual({
    analysisStatus: 'completed',
    analysis,
  });

  const savedJob = await ProcessingJob.findOne({ noticeId })
    .select('+analysis').lean();

  expect(savedJob.analysisStatus).toBe('completed');
  expect(savedJob.analysis).toEqual(analysis);
  expect(savedJob.status).toBe('completed');

  const stranger = await createCitizen('stranger@example.com');

  const forbidden = await stranger.post(`/api/v1/notices/${noticeId}/analyze`)
    .set('Origin', origin)
    .set('X-CSRF-Token', stranger.csrfToken)
    .send({});

  expect(forbidden.status).toBe(404);
});

  it('stores official source match evidence without changing the notice authenticity status', async () => {
    const owner = await createCitizen();
    const uploaded = await upload(owner);
    const noticeId = uploaded.body.notice.id;
    const analysis = {
      title: { value: 'Water Supply Interruption', evidence: 'Water Supply Interruption', pageNumber: 1 },
      issuingDepartment: { value: 'Municipal Water Department', evidence: 'Municipal Water Department', pageNumber: 1 },
      noticeDate: { value: '15/05/2025', evidence: '15/05/2025', pageNumber: 1 },
    };
    const sourceVerification = {
      status: 'match_found',
      sourceName: 'Andhra Pradesh Gazette',
      sourceOrganization: 'Commissionerate of Printing, Government of Andhra Pradesh',
      sourceUrl: 'https://apegazette.cgg.gov.in/preview.do?fileName=%2FUploads%2Fnotice.pdf',
      publicationDate: '15/05/2025',
      checkedAt: new Date('2026-04-10T00:00:00.000Z'),
      evidence: [{
        field: 'title',
        noticePageNumber: 1,
        noticeEvidence: 'Water Supply Interruption',
        sourcePageNumber: 2,
        sourceEvidence: 'Water Supply Interruption notice',
      }],
      reason: null,
    };
    await ProcessingJob.updateOne({ noticeId }, {
      $set: {
        status: 'completed',
        analysisStatus: 'completed',
        analysis,
        extractedPages: [{
          pageNumber: 1,
          method: 'digital',
          text: 'Water Supply Interruption. Municipal Water Department. 15/05/2025.',
        }],
      },
    });
    verifyOfficialPublication.mockResolvedValueOnce(sourceVerification);

    const response = await owner.post(`/api/v1/notices/${noticeId}/verify-source`)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        candidateUrl: sourceVerification.sourceUrl,
        publicationDate: sourceVerification.publicationDate,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sourceVerification: {
        status: 'match_found',
        sourceName: 'Andhra Pradesh Gazette',
        publicationDate: '15/05/2025',
        evidence: [{
          field: 'title',
          noticePageNumber: 1,
          sourcePageNumber: 2,
        }],
      },
      authenticityStatus: 'unverified',
    });
    expect(verifyOfficialPublication).toHaveBeenCalledWith(expect.objectContaining({
      candidateUrl: sourceVerification.sourceUrl,
      publicationDate: sourceVerification.publicationDate,
      analysis,
      noticePages: expect.arrayContaining([expect.objectContaining({ pageNumber: 1 })]),
    }));

    const savedNotice = await Notice.findById(noticeId).lean();
    expect(savedNotice.authenticityStatus).toBe('unverified');
    expect(savedNotice.sourceVerification.status).toBe('match_found');
    expect(savedNotice.sourceVerification.evidence[0]).toMatchObject({
      noticePageNumber: 1,
      sourcePageNumber: 2,
      sourceEvidence: 'Water Supply Interruption notice',
    });
    const detail = await owner.get(`/api/v1/notices/${noticeId}`);
    expect(detail.body.notice.sourceVerification).toMatchObject({
      status: 'match_found',
      publicationDate: '15/05/2025',
    });

    const stranger = await createCitizen('stranger@example.com');
    const forbidden = await stranger.post(`/api/v1/notices/${noticeId}/verify-source`)
      .set('Origin', origin)
      .set('X-CSRF-Token', stranger.csrfToken)
      .send({
        candidateUrl: sourceVerification.sourceUrl,
        publicationDate: sourceVerification.publicationDate,
      });
    expect(forbidden.status).toBe(404);
  });

  it('requires CSRF and validates the source candidate request', async () => {
    const owner = await createCitizen();
    const uploaded = await upload(owner);
    const noticeId = uploaded.body.notice.id;

    const noCsrf = await owner.post(`/api/v1/notices/${noticeId}/verify-source`)
      .set('Origin', origin)
      .send({ candidateUrl: 'not-a-url', publicationDate: '2025' });
    expect(noCsrf.status).toBe(403);

    const invalid = await owner.post(`/api/v1/notices/${noticeId}/verify-source`)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ candidateUrl: 'not-a-url', publicationDate: '2025' });
    expect(invalid.status).toBe(400);

    verifyOfficialPublication.mockRejectedValueOnce(
      Object.assign(new Error('Unsupported source URL'), { code: 'SOURCE_URL_UNSUPPORTED' }),
    );
    const unsupportedSource = await owner.post(`/api/v1/notices/${noticeId}/verify-source`)
      .set('Origin', origin)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        candidateUrl: 'https://apegazette.cgg.gov.in.attacker.invalid/preview.do?fileName=%2Fnotice.pdf',
        publicationDate: '15 May 2025',
      });
    expect(unsupportedSource.status).toBe(400);
    expect(unsupportedSource.body.error.code).toBe('SOURCE_URL_UNSUPPORTED');
    expect(verifyOfficialPublication).toHaveBeenCalledTimes(1);
  });
  it('requires CSRF for retry, restricts retry to the owner, and enforces the attempt limit', async () => {
    const owner = await createCitizen();
    const uploaded = await upload(owner);
    const noticeId = uploaded.body.notice.id;
    await ProcessingJob.updateOne({ noticeId }, { $set: { status: 'failed', attempts: 2 } });
    await Notice.updateOne({ _id: noticeId }, { $set: { status: 'failed' } });

    const missingCsrf = await owner.post(`/api/v1/notices/${noticeId}/process`).set('Origin', origin).send({});
    expect(missingCsrf.status).toBe(403);
    const stranger = await createCitizen('stranger@example.com');
    expect((await stranger.post(`/api/v1/notices/${noticeId}/process`).set('Origin', origin)
      .set('X-CSRF-Token', stranger.csrfToken).send({})).status).toBe(404);

    const retried = await owner.post(`/api/v1/notices/${noticeId}/process`).set('Origin', origin)
      .set('X-CSRF-Token', owner.csrfToken).send({});
    expect(retried.status).toBe(202);
    expect(retried.body.processing.status).toBe('queued');
    await ProcessingJob.updateOne({ noticeId }, { $set: { status: 'failed', attempts: config.processingMaxAttempts } });
    expect((await owner.post(`/api/v1/notices/${noticeId}/process`).set('Origin', origin)
      .set('X-CSRF-Token', owner.csrfToken).send({})).status).toBe(409);
  });

  it('cleans GridFS and the notice record if processing job creation fails', async () => {
    const agent = await createCitizen();
    vi.spyOn(ProcessingJob, 'create').mockRejectedValueOnce(new Error('test database write failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await upload(agent);
    errorLog.mockRestore();
    expect(response.status).toBe(500);
    expect(await Notice.countDocuments()).toBe(0);
    expect(await ProcessingJob.countDocuments()).toBe(0);
    expect(await mongoose.connection.db.collection(`${config.gridFsBucketName}.files`).countDocuments()).toBe(0);
    expect(await mongoose.connection.db.collection(`${config.gridFsBucketName}.chunks`).countDocuments()).toBe(0);
  });

  it('removes orphaned GridFS chunks left by an interrupted stream', async () => {
    const fileId = new mongoose.Types.ObjectId();
    await mongoose.connection.db.collection(`${config.gridFsBucketName}.chunks`).insertOne({
      _id: new mongoose.Types.ObjectId(), files_id: fileId, n: 0, data: Buffer.from('partial'),
    });
    await removeStoredDocument(fileId);
    expect(await mongoose.connection.db.collection(`${config.gridFsBucketName}.files`).countDocuments({ _id: fileId })).toBe(0);
    expect(await mongoose.connection.db.collection(`${config.gridFsBucketName}.chunks`).countDocuments({ files_id: fileId })).toBe(0);
  });
    it('returns saved analysis only to the notice owner', async () => {
    const owner = await createCitizen();
    const uploaded = await upload(owner);
    const noticeId = uploaded.body.notice.id;

    const analysis = {
      documentCategory: {
        value: 'public_notice',
        evidence: 'PUBLIC NOTICE',
        pageNumber: 1,
      },
      title: null,
      issuingDepartment: null,
      noticeDate: null,
      importantDates: [],
      locations: [],
      citizenInstructions: [],
      referenceNumbers: [],
    };

    await ProcessingJob.updateOne(
      { noticeId },
      { $set: { analysisStatus: 'completed', analysis } },
    );

    const response = await owner.get(`/api/v1/notices/${noticeId}/analysis`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      analysisStatus: 'completed',
      analysis,
      errorCode: null,
    });

    const stranger = await createCitizen('stranger@example.com');
    const forbidden = await stranger.get(`/api/v1/notices/${noticeId}/analysis`);

    expect(forbidden.status).toBe(404);
  });
});
