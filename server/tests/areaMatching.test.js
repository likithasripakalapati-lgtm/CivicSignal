import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Notice } from '../src/models/Notice.js';
import { ProcessingJob } from '../src/models/ProcessingJob.js';
import { User } from '../src/models/User.js';
import {
  andhraPradeshDistricts,
  matchNoticeLocations,
} from '../src/services/areaMatching.service.js';

const origin = 'http://localhost:5173';

async function createCitizen(email = 'citizen@example.com') {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf');
  const registered = await agent.post('/api/v1/auth/register')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email, password: 'A secure pass 123!' });
  expect(registered.status).toBe(201);
  agent.csrfToken = registered.body.csrfToken;
  return agent;
}

async function createAnalyzedNotice(ownerId, locations, filename = 'notice.pdf') {
  const notice = await Notice.create({
    ownerId,
    originalFile: {
      gridFsId: new mongoose.Types.ObjectId(),
      filename,
      contentType: 'application/pdf',
      sizeBytes: 123,
    },
    status: 'completed',
  });
  await ProcessingJob.create({
    noticeId: notice._id,
    ownerId,
    status: 'completed',
    analysisStatus: 'completed',
    analysis: {
      locations,
      importantDates: [],
      citizenInstructions: [],
      referenceNumbers: [],
      translatedPages: [],
      simpleExplanation: { sections: [] },
    },
  });
  return notice;
}

beforeAll(async () => {
  await connectDatabase();
  await Promise.all([User.init(), Notice.init(), ProcessingJob.init()]);
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    Notice.deleteMany({}),
    ProcessingJob.deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoose.connection.close();
});

describe('district registry and evidence-based matching', () => {
  it('exposes the Andhra Pradesh district registry without unverified geometry', async () => {
    const response = await request(app).get('/api/v1/areas');

    expect(response.status).toBe(200);
    expect(response.body.areas).toHaveLength(28);
    expect(response.body.areas.every((area) => area.level === 'district')).toBe(true);
    expect(response.body.areas.map((area) => area.id)).toEqual(expect.arrayContaining([
      'ap-anakapalli',
      'ap-markapuram',
      'ap-polavaram',
    ]));
    expect(response.body.source).toMatchObject({
      name: 'Integrated Government Online Directory (IGOD)',
      stateCode: '28',
      districtIdScheme: 'Stable CivicSignal application IDs; not LGD district codes',
    });
    expect(response.body.areas.find(({ id }) => id === 'ap-markapuram').sourceMetadata).toMatchObject({
      authority: 'Reserve Bank of India',
      workingCode: '02Y',
      formationOrder: 'G.O.MS.No.524',
      formationOrderDate: '2025-12-30',
      notificationDate: '2026-04-10',
    });
    expect(response.body.areas.find(({ id }) => id === 'ap-polavaram').sourceMetadata).toMatchObject({
      authority: 'Reserve Bank of India',
      workingCode: '02X',
      formationOrder: 'G.O.MS.No.517',
      formationOrderDate: '2025-12-30',
      notificationDate: '2026-04-10',
    });
    expect(response.body.areas.every((area) => !('lgdDistrictCode' in area))).toBe(true);
    expect(response.body.geometryAvailable).toBe(false);
    expect(response.body.areas.some((area) => 'geometry' in area)).toBe(false);
  });

  it('keeps stable application IDs unique and includes all 28 selectable districts', () => {
    const ids = andhraPradeshDistricts.map(({ id }) => id);

    expect(ids).toHaveLength(28);
    expect(new Set(ids).size).toBe(28);
    expect(ids).toContain('ap-polavaram');
    expect(ids).toContain('ap-markapuram');
  });

  it('matches only supported district names found in the cited evidence', () => {
    const evidence = 'The public notice applies to Anantapuramu district.';
    const locations = [{
      value: 'Anantapuramu district',
      evidence,
      pageNumber: 4,
    }];

    const result = matchNoticeLocations(locations, ['ap-ananthapuramu']);

    expect(result.matches).toEqual([expect.objectContaining({
      areaId: 'ap-ananthapuramu',
      status: 'explicit_mention',
      matchedAlias: 'anantapuramu',
      evidence,
      pageNumber: 4,
    })]);
    expect(result.unresolved).toEqual([]);
  });

  it('preserves every supporting evidence snippet and page for presentation grouping', () => {
    const locations = [
      {
        value: 'Markapuram district',
        evidence: 'Notice lists Markapuram for the service update.',
        pageNumber: 2,
      },
      {
        value: 'Markapuram district',
        evidence: 'Notice lists Markapuram for the service update.',
        pageNumber: 3,
      },
      {
        value: 'Markapuram district',
        evidence: 'Residents in Markapuram should follow the schedule.',
        pageNumber: 4,
      },
    ];

    const result = matchNoticeLocations(locations, ['ap-markapuram']);

    expect(result.matches).toHaveLength(3);
    expect(result.matches.map(({ evidence, pageNumber }) => ({ evidence, pageNumber }))).toEqual([
      { evidence: locations[0].evidence, pageNumber: 2 },
      { evidence: locations[1].evidence, pageNumber: 3 },
      { evidence: locations[2].evidence, pageNumber: 4 },
    ]);
  });

  it('does not match a district name found only in the extracted value, not evidence', () => {
    const result = matchNoticeLocations([{
      value: 'Anakapalli district',
      evidence: 'This location is mentioned in the document.',
      pageNumber: 2,
    }], ['ap-anakapalli']);

    expect(result.matches).toEqual([]);
    expect(result.unresolved[0]).toMatchObject({ status: 'unresolved', location: { pageNumber: 2 } });
  });

  it('does not match district names embedded inside unrelated words', () => {
    const result = matchNoticeLocations([{
      value: 'Anakapalliville',
      evidence: 'Anakapalliville road is temporarily closed.',
      pageNumber: 1,
    }], ['ap-anakapalli']);

    expect(result.matches).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  it.each([
    ['Nellore', 'ap-spsr-nellore', 'nellore'],
    ['Sri Potti Sriramulu Nellore', 'ap-spsr-nellore', 'sri potti sriramulu nellore'],
    ['Konaseema', 'ap-dr-br-ambedkar-konaseema', 'konaseema'],
    ['Dr. B.R. Ambedkar Konaseema', 'ap-dr-br-ambedkar-konaseema', 'dr b r ambedkar konaseema'],
  ])('matches the supported alias %s from evidence and preserves its citation', (alias, areaId, matchedAlias) => {
    const evidence = `The notice names ${alias} for this service update.`;
    const result = matchNoticeLocations([{
      value: alias,
      evidence,
      pageNumber: 7,
    }], [areaId]);

    expect(result.matches).toEqual([expect.objectContaining({
      areaId,
      matchedAlias,
      evidence,
      pageNumber: 7,
    })]);
  });

  it.each([
    ['Polavaram', 'ap-polavaram', '02X'],
    ['Markapuram', 'ap-markapuram', '02Y'],
  ])('allows selecting %s using its application ID, not its RBI working code', async (name, areaId, workingCode) => {
    const citizen = await createCitizen();
    const selected = await citizen.patch('/api/v1/users/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', citizen.csrfToken)
      .send({ selectedAreaIds: [areaId] });

    expect(selected.status).toBe(200);
    expect(selected.body.user.selectedAreaIds).toContain(areaId);

    const invalidCode = await citizen.patch('/api/v1/users/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', citizen.csrfToken)
      .send({ selectedAreaIds: [workingCode] });
    expect(invalidCode.status).toBe(400);

    const evidence = `The notice explicitly names ${name} district.`;
    const result = matchNoticeLocations([{
      value: `${name} district`,
      evidence,
      pageNumber: 9,
    }], [areaId]);
    expect(result.matches).toEqual([expect.objectContaining({
      areaId,
      evidence,
      pageNumber: 9,
    })]);
  });

  it('retains explicit matches outside the selected area without implying impact there', () => {
    const result = matchNoticeLocations([{
      value: 'Guntur district',
      evidence: 'The service change is for Guntur district.',
      pageNumber: 3,
    }], ['ap-anakapalli']);

    expect(result.matches).toEqual([]);
    expect(result.otherExplicitDistricts).toEqual([expect.objectContaining({
      areaId: 'ap-guntur',
      evidence: 'The service change is for Guntur district.',
      pageNumber: 3,
    })]);
    expect(JSON.stringify(result)).not.toContain('unaffected');
  });

  it('requires a selected supported district to retrieve private notice impact', async () => {
    const citizen = await createCitizen();
    const notSelected = await citizen.get('/api/v1/areas/ap-anakapalli/impact');
    expect(notSelected.status).toBe(403);
    expect(notSelected.body.error.code).toBe('AREA_NOT_SELECTED');

    const selected = await citizen.patch('/api/v1/users/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', citizen.csrfToken)
      .send({ selectedAreaIds: ['ap-ananthapuramu'] });
    expect(selected.status).toBe(200);

    const unsupported = await citizen.patch('/api/v1/users/preferences')
      .set('Origin', origin)
      .set('X-CSRF-Token', citizen.csrfToken)
      .send({ selectedAreaIds: ['ap-hypothetical-district'] });
    expect(unsupported.status).toBe(400);

    const invalidArea = await citizen.get('/api/v1/areas/ap-hypothetical-district/impact');
    expect(invalidArea.status).toBe(404);
  });

  it('returns confirmed and unresolved impact with evidence, only for the owner', async () => {
    const owner = await createCitizen();
    await createCitizen('stranger@example.com');
    const ownerRecord = await User.findOne({ email: 'citizen@example.com' });
    const strangerRecord = await User.findOne({ email: 'stranger@example.com' });
    await User.updateOne({ _id: ownerRecord._id }, { $set: { selectedAreaIds: ['ap-ananthapuramu'] } });

    await createAnalyzedNotice(ownerRecord._id, [
      {
        value: 'Ananthapuramu district',
        evidence: 'The notice explicitly applies to Ananthapuramu district.',
        pageNumber: 2,
      },
      {
        value: 'near the reservoir',
        evidence: 'Residents near the reservoir should take note.',
        pageNumber: 3,
      },
    ]);
    await createAnalyzedNotice(strangerRecord._id, [{
      value: 'Ananthapuramu district',
      evidence: 'The notice explicitly applies to Ananthapuramu district.',
      pageNumber: 1,
    }], 'private-stranger-notice.pdf');

    const response = await owner.get('/api/v1/areas/ap-ananthapuramu/impact');

    expect(response.status).toBe(200);
    expect(response.body.notices).toHaveLength(1);
    expect(response.body.notices[0]).toMatchObject({
      impactStatus: 'district_mentioned',
      impactStatuses: ['district_mentioned', 'unresolved'],
      districtId: 'ap-ananthapuramu',
      matches: [{
        areaId: 'ap-ananthapuramu',
        evidence: 'The notice explicitly applies to Ananthapuramu district.',
        pageNumber: 2,
      }],
    });
    expect(response.body.notices[0].unresolvedLocations).toHaveLength(1);
    expect(response.body.notices[0].unresolvedLocations[0]).toMatchObject({
      status: 'unresolved',
      location: { pageNumber: 3 },
    });
    expect(JSON.stringify(response.body)).not.toContain('unaffected');
    expect(andhraPradeshDistricts).toHaveLength(28);
  });

  it('returns one API record per notice ID and distinct statuses for same-name uploads', async () => {
    const owner = await createCitizen();
    const user = await User.findOne({ email: 'citizen@example.com' });
    await User.updateOne({ _id: user._id }, { $set: { selectedAreaIds: ['ap-markapuram'] } });

    await createAnalyzedNotice(user._id, [{
      value: 'Markapuram',
      evidence: 'The notice names Markapuram district.',
      pageNumber: 1,
    }, {
      value: 'the service boundary',
      evidence: 'Residents near the service boundary should take note.',
      pageNumber: 2,
    }], 'govt.notice.pdf');
    await createAnalyzedNotice(user._id, [], 'govt.notice.pdf');
    await createAnalyzedNotice(user._id, [{
      value: 'the industrial corridor',
      evidence: 'Residents near the industrial corridor should take note.',
      pageNumber: 3,
    }], 'govt.notice.pdf');

    const unknownNotice = await Notice.create({
      ownerId: user._id,
      originalFile: {
        gridFsId: new mongoose.Types.ObjectId(),
        filename: 'govt.notice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 123,
      },
      status: 'completed',
    });

    const response = await owner.get('/api/v1/areas/ap-markapuram/impact');
    const notices = response.body.notices;

    expect(response.status).toBe(200);
    expect(notices).toHaveLength(4);
    expect(notices.every(({ districtId }) => districtId === 'ap-markapuram')).toBe(true);
    expect(new Set(notices.map(({ noticeId }) => noticeId)).size).toBe(4);
    expect(notices.every(({ filename }) => filename === 'govt.notice.pdf')).toBe(true);
    expect(notices.find(({ noticeId }) => noticeId === String(unknownNotice._id))).toMatchObject({
      impactStatus: 'unknown',
      impactStatuses: ['unknown'],
    });
    expect(notices.map(({ impactStatus }) => impactStatus)).toEqual(expect.arrayContaining([
      'district_mentioned',
      'not_explicitly_listed',
      'unresolved',
      'unknown',
    ]));
    const mixedEvidenceNotice = notices.find(({ impactStatus }) => impactStatus === 'district_mentioned');
    expect(mixedEvidenceNotice.impactStatuses).toEqual(['district_mentioned', 'unresolved']);
    expect(mixedEvidenceNotice.unresolvedLocations[0]).toMatchObject({
      status: 'unresolved',
      location: {
        evidence: 'Residents near the service boundary should take note.',
        pageNumber: 2,
      },
    });
  });

  it('labels notices with no explicit selected district as not explicitly listed, not unaffected', async () => {
    const owner = await createCitizen();
    const user = await User.findOne({ email: 'citizen@example.com' });
    await User.updateOne({ _id: user._id }, { $set: { selectedAreaIds: ['ap-anakapalli'] } });
    await createAnalyzedNotice(user._id, [{
      value: 'Kurnool district',
      evidence: 'The notice names Kurnool district.',
      pageNumber: 1,
    }]);

    const response = await owner.get('/api/v1/areas/ap-anakapalli/impact');

    expect(response.status).toBe(200);
    expect(response.body.notices[0]).toMatchObject({
      impactStatus: 'not_explicitly_listed',
      matches: [],
      unresolvedLocations: [],
    });
    expect(JSON.stringify(response.body)).not.toContain('unaffected');
  });
});
