import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Notice } from '../src/models/Notice.js';
import { ProcessingJob } from '../src/models/ProcessingJob.js';
import { config } from '../src/config/env.js';
import { claimNextJob, completeClaim, processNextJobOnce } from '../src/services/processingWorker.service.js';
import { storeDocument } from '../src/services/gridFs.service.js';

const ownerId = () => new mongoose.Types.ObjectId();
let workingDirectory;

function makeDigitalPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const text = Buffer.from('BT /F1 24 Tf 50 700 Td (PUBLIC NOTICE 2026) Tj ET');
  let document = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  offsets.push(Buffer.byteLength(document));
  document += `5 0 obj\n<< /Length ${text.length} >>\nstream\n${text.toString()}\nendstream\nendobj\n`;
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document);
}

async function createNotice(owner = ownerId()) {
  return Notice.create({
    ownerId: owner,
    originalFile: {
      gridFsId: new mongoose.Types.ObjectId(), filename: 'synthetic.pdf',
      contentType: 'application/pdf', sizeBytes: 100,
    },
  });
}

beforeAll(async () => {
  await connectDatabase();
  await Promise.all([Notice.init(), ProcessingJob.init()]);
  workingDirectory = await mkdtemp(join(tmpdir(), 'civicsignal-worker-test-'));
});

beforeEach(async () => {
  await Promise.all([Notice.deleteMany({}), ProcessingJob.deleteMany({})]);
  await Promise.all([
    mongoose.connection.db.collection(`${config.gridFsBucketName}.files`).deleteMany({}),
    mongoose.connection.db.collection(`${config.gridFsBucketName}.chunks`).deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoose.connection.close();
  if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
});

describe('atomic processing job lifecycle', () => {
  it('allows only one concurrent worker to atomically claim a queued job', async () => {
    const notice = await createNotice();
    await ProcessingJob.create({ noticeId: notice._id, ownerId: notice.ownerId });
    const claims = await Promise.all([claimNextJob(), claimNextJob()]);
    const successfulClaims = claims.filter(Boolean);
    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0].status).toBe('processing');
    expect(successfulClaims[0].processingToken).toBeTruthy();
    expect(successfulClaims[0].leaseUntil.getTime()).toBeGreaterThan(Date.now());
    expect(successfulClaims[0].attempts).toBe(1);
  });

  it('reclaims an expired lease with a new token and increments the bounded attempt count', async () => {
    const notice = await createNotice();
    const job = await ProcessingJob.create({ noticeId: notice._id, ownerId: notice.ownerId });
    await ProcessingJob.updateOne({ _id: job._id }, {
      $set: { status: 'processing', processingToken: 'old-worker', leaseUntil: new Date(Date.now() - 1000), attempts: 1 },
    });
    const reclaimed = await claimNextJob();
    expect(reclaimed.processingToken).not.toBe('old-worker');
    expect(reclaimed.attempts).toBe(2);
  });

  it('refuses a stale worker result after its token has been replaced', async () => {
    const notice = await createNotice();
    const job = await ProcessingJob.create({
      noticeId: notice._id, ownerId: notice.ownerId, status: 'processing',
      processingToken: 'current-worker', leaseUntil: new Date(Date.now() + 60000), attempts: 2,
    });
    const staleWrite = await completeClaim({ ...job.toObject(), processingToken: 'expired-worker' }, {
      totalPages: 1, extractionMethod: 'digital', extractedPages: [{ pageNumber: 1, method: 'digital', text: 'stale data' }],
    });
    expect(staleWrite).toBe(false);
    const persisted = await ProcessingJob.findById(job._id).select('+extractedPages').lean();
    expect(persisted.status).toBe('processing');
    expect(persisted.extractedPages).toBeUndefined();
  });

  it('fails an expired job after its retry budget is exhausted', async () => {
    const notice = await createNotice();
    const job = await ProcessingJob.create({
      noticeId: notice._id, ownerId: notice.ownerId, status: 'processing',
      processingToken: 'expired-worker', leaseUntil: new Date(Date.now() - 1000), attempts: 3,
    });
    expect(await claimNextJob()).toBeNull();
    const failed = await ProcessingJob.findById(job._id).lean();
    expect(failed.status).toBe('failed');
    expect(failed.lastErrorCode).toBe('PROCESSING_FAILED');
    expect((await Notice.findById(notice._id).lean()).status).toBe('failed');
  });

  it('processes a queued digital PDF through GridFS and persists page text only when complete', async () => {
    const owner = ownerId();
    const filePath = join(workingDirectory, 'digital.pdf');
    const bytes = makeDigitalPdf();
    await writeFile(filePath, bytes);
    const gridFsId = new mongoose.Types.ObjectId();
    await storeDocument({ path: filePath, originalname: 'digital.pdf' }, gridFsId, { contentType: 'application/pdf', ownerId: owner });
    const notice = await Notice.create({ ownerId: owner, originalFile: {
      gridFsId, filename: 'digital.pdf', contentType: 'application/pdf', sizeBytes: bytes.length,
    } });
    const job = await ProcessingJob.create({ noticeId: notice._id, ownerId: owner });

    expect(await processNextJobOnce({})).toBe(true);
    const completed = await ProcessingJob.findById(job._id).select('+extractedPages').lean();
    expect(completed).toMatchObject({ status: 'completed', progress: 100, extractionMethod: 'digital' });
    expect(completed.extractedPages).toEqual([{ pageNumber: 1, method: 'digital', text: 'PUBLIC NOTICE 2026' }]);
    expect((await Notice.findById(notice._id).lean()).status).toBe('completed');
  });

  it('marks corrupted stored documents failed without publishing partial extraction', async () => {
    const owner = ownerId();
    const filePath = join(workingDirectory, 'broken.pdf');
    const bytes = Buffer.from('%PDF-1.4\nnot a readable document');
    await writeFile(filePath, bytes);
    const gridFsId = new mongoose.Types.ObjectId();
    await storeDocument({ path: filePath, originalname: 'broken.pdf' }, gridFsId, { contentType: 'application/pdf', ownerId: owner });
    const notice = await Notice.create({ ownerId: owner, originalFile: {
      gridFsId, filename: 'broken.pdf', contentType: 'application/pdf', sizeBytes: bytes.length,
    } });
    const job = await ProcessingJob.create({ noticeId: notice._id, ownerId: owner });

    await processNextJobOnce({});
    const failed = await ProcessingJob.findById(job._id).select('+extractedPages').lean();
    expect(failed.status).toBe('failed');
    expect(failed.lastErrorCode).toBe('DOCUMENT_UNREADABLE');
    expect(failed.extractedPages).toBeUndefined();
    expect((await Notice.findById(notice._id).lean()).status).toBe('failed');
  });
});
