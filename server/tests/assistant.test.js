import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { Notice } from '../src/models/Notice.js';
import { ProcessingJob } from '../src/models/ProcessingJob.js';
import { User } from '../src/models/User.js';

const assistantMocks = vi.hoisted(() => ({
  answerNoticeQuestion: vi.fn(),
}));

vi.mock('../src/services/geminiAnalysis.service.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, answerNoticeQuestion: assistantMocks.answerNoticeQuestion };
});

const origin = 'http://localhost:5173';
const sourceText = 'Water supply will be interrupted in Markapuram on 20 June.';

async function createCitizen(email) {
  const agent = request.agent(app);
  const csrf = await agent.get('/api/v1/auth/csrf');
  const registered = await agent.post('/api/v1/auth/register')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email, password: 'A secure pass 123!' });
  expect(registered.status).toBe(201);
  agent.csrfToken = registered.body.csrfToken;
  agent.authUserId = registered.body.user.id;
  return agent;
}

async function createNotice(ownerId, {
  filename = 'notice.pdf',
  noticeStatus = 'completed',
  jobStatus = 'completed',
  text = sourceText,
} = {}) {
  const notice = await Notice.create({
    ownerId,
    originalFile: {
      gridFsId: new mongoose.Types.ObjectId(),
      filename,
      contentType: 'application/pdf',
      sizeBytes: 123,
    },
    status: noticeStatus,
  });
  const job = await ProcessingJob.create({
    noticeId: notice._id,
    ownerId,
    status: jobStatus,
    extractedPages: text === null ? undefined : [{
      pageNumber: 4,
      method: 'digital',
      text,
    }],
  });
  return { notice, job };
}

function ask(agent, body) {
  return agent.post('/api/v1/assistant/ask')
    .set('Origin', origin)
    .set('X-CSRF-Token', agent.csrfToken)
    .send(body);
}

function answerNotice(noticeId, overrides = {}) {
  return {
    answer: 'Water supply will be interrupted in Markapuram on 20 June.',
    answerable: true,
    evidence: [{
      noticeId: String(noticeId),
      pageNumber: 4,
      quote: 'Water supply will be interrupted in Markapuram on 20 June.',
    }],
    ...overrides,
  };
}

beforeAll(async () => {
  await connectDatabase();
  await Promise.all([User.init(), Notice.init(), ProcessingJob.init()]);
});

beforeEach(async () => {
  assistantMocks.answerNoticeQuestion.mockReset();
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

describe('authenticated notice assistant API', () => {
  it('answers a current-notice question in English with verified page evidence', async () => {
    const user = await createCitizen('assistant-en@example.com');
    const { notice } = await createNotice(user.authUserId);
    assistantMocks.answerNoticeQuestion.mockResolvedValue(answerNotice(notice.id));

    const response = await ask(user, {
      question: 'When will the water supply be interrupted?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      answer: 'Water supply will be interrupted in Markapuram on 20 June.',
      answerable: true,
      language: 'en',
      mode: 'current',
      aiGenerated: true,
      sources: [{
        noticeId: notice.id,
        filename: 'notice.pdf',
        authenticityStatus: 'unverified',
      }],
      evidence: [{
        noticeId: notice.id,
        filename: 'notice.pdf',
        pageNumber: 4,
        quote: 'Water supply will be interrupted in Markapuram on 20 June.',
      }],
    });
    expect(response.body.disclaimer).toContain('not official government guidance');
    expect(assistantMocks.answerNoticeQuestion).toHaveBeenCalledWith(expect.objectContaining({
      question: 'When will the water supply be interrupted?',
      language: 'en',
      sources: [expect.objectContaining({ noticeId: notice.id, pages: [{ pageNumber: 4, text: sourceText }] })],
    }));
  });

  it('answers a Telugu question in the requested language', async () => {
    const user = await createCitizen('assistant-te@example.com');
    const { notice } = await createNotice(user.authUserId);
    assistantMocks.answerNoticeQuestion.mockResolvedValue(answerNotice(notice.id, {
      answer: 'మార్కాపురంలో జూన్ 20న నీటి సరఫరా నిలిపివేయబడుతుంది.',
    }));

    const response = await ask(user, {
      question: 'నీటి సరఫరా ఎప్పుడు నిలిపివేయబడుతుంది?',
      language: 'te',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(200);
    expect(response.body.language).toBe('te');
    expect(response.body.answer).toContain('జూన్ 20');
    expect(response.body.disclaimer).toContain('అధికారిక ప్రభుత్వ మార్గదర్శకం కాదు');
  });

  it('answers all-notices questions using only owned completed readable notices', async () => {
    const user = await createCitizen('assistant-all@example.com');
    const { notice: first } = await createNotice(user.authUserId, { filename: 'first.pdf' });
    const { notice: second } = await createNotice(user.authUserId, {
      filename: 'second.pdf',
      text: 'Road closure in Polavaram on 22 June.',
    });
    const unreadable = await createNotice(user.authUserId, {
      filename: 'unreadable.pdf',
      text: null,
    });
    const otherUserNotice = await createNotice(new mongoose.Types.ObjectId(), {
      filename: 'other-user.pdf',
      text: 'Private unrelated notice text.',
    });
    assistantMocks.answerNoticeQuestion.mockResolvedValue(answerNotice(first.id));

    const response = await ask(user, {
      question: 'What does the notice say?',
      language: 'en',
      mode: 'all',
    });

    expect(response.status).toBe(200);
    expect(response.body.mode).toBe('all');
    expect(response.body.sources).toHaveLength(2);
    expect(response.body.sources.map(({ noticeId }) => noticeId)).toEqual(expect.arrayContaining([
      first.id,
      second.id,
    ]));
    const sourceIds = assistantMocks.answerNoticeQuestion.mock.calls[0][0].sources.map(({ noticeId }) => noticeId);
    expect(sourceIds).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(sourceIds).not.toContain(unreadable.notice.id);
    expect(sourceIds).not.toContain(otherUserNotice.notice.id);
  });

  it('does not disclose another user’s notice', async () => {
    const owner = await createCitizen('assistant-owner@example.com');
    const stranger = await createCitizen('assistant-stranger@example.com');
    const { notice } = await createNotice(owner.authUserId);

    const response = await ask(stranger, {
      question: 'What is this notice about?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/assistant/ask')
      .set('Origin', origin)
      .send({ question: 'Question', language: 'en', mode: 'all' });

    expect(response.status).toBe(401);
  });

  it('does not use a notice while processing', async () => {
    const user = await createCitizen('assistant-processing@example.com');
    const { notice } = await createNotice(user.authUserId, {
      noticeStatus: 'processing',
      jobStatus: 'processing',
    });

    const response = await ask(user, {
      question: 'What does it say?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROCESSING_INCOMPLETE');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it('reports failed or unavailable extraction instead of answering', async () => {
    const user = await createCitizen('assistant-extraction@example.com');
    const failed = await createNotice(user.authUserId, {
      noticeStatus: 'failed',
      jobStatus: 'failed',
    });
    const unavailable = await createNotice(user.authUserId, { text: null });

    const failedResponse = await ask(user, {
      question: 'What does it say?',
      language: 'en',
      mode: 'current',
      noticeId: failed.notice.id,
    });
    const unavailableResponse = await ask(user, {
      question: 'What does it say?',
      language: 'en',
      mode: 'current',
      noticeId: unavailable.notice.id,
    });

    expect(failedResponse.status).toBe(409);
    expect(failedResponse.body.error.code).toBe('EXTRACTION_FAILED');
    expect(unavailableResponse.status).toBe(409);
    expect(unavailableResponse.body.error.code).toBe('EXTRACTION_UNAVAILABLE');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it('returns a controlled unsupported-answer response without invented evidence', async () => {
    const user = await createCitizen('assistant-unsupported@example.com');
    const { notice } = await createNotice(user.authUserId);
    assistantMocks.answerNoticeQuestion.mockResolvedValue({
      answer: 'The notice may announce a new subsidy.',
      answerable: false,
      evidence: [],
    });

    const response = await ask(user, {
      question: 'What subsidy is available?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(200);
    expect(response.body.answerable).toBe(false);
    expect(response.body.answer).toBe('The available notices do not contain the answer.');
    expect(response.body.evidence).toEqual([]);
  });

  it('returns a safe error when the model evidence cannot be validated', async () => {
    const user = await createCitizen('assistant-invalid-evidence@example.com');
    const { notice } = await createNotice(user.authUserId);
    assistantMocks.answerNoticeQuestion.mockRejectedValue(Object.assign(
      new Error('Untrusted model detail'),
      { code: 'GEMINI_EVIDENCE_INVALID' },
    ));

    const response = await ask(user, {
      question: 'What date?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('GEMINI_EVIDENCE_INVALID');
    expect(response.body.error.message).not.toContain('Untrusted model detail');
  });

  it('rejects invalid requests before retrieving source documents', async () => {
    const user = await createCitizen('assistant-invalid-request@example.com');

    const response = await ask(user, {
      question: '   ',
      language: 'fr',
      mode: 'current',
      noticeId: 'not-an-id',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it('rejects source text exceeding the bounded Gemini context', async () => {
    const user = await createCitizen('assistant-too-large@example.com');
    const { notice } = await createNotice(user.authUserId, { text: 'x'.repeat(60_001) });

    const response = await ask(user, {
      question: 'Summarize this notice.',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('SOURCE_TEXT_TOO_LARGE');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it('rejects all-notices requests that exceed the notice count limit instead of silently omitting sources', async () => {
    const user = await createCitizen('assistant-too-many@example.com');
    await Promise.all(Array.from({ length: 11 }, (_, index) => createNotice(user.authUserId, {
      filename: `notice-${index}.pdf`,
    })));

    const response = await ask(user, {
      question: 'What is in my notices?',
      language: 'en',
      mode: 'all',
    });

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('TOO_MANY_NOTICES');
    expect(assistantMocks.answerNoticeQuestion).not.toHaveBeenCalled();
  });

  it.each([
    ['GEMINI_UNAVAILABLE', 503],
    ['GEMINI_RATE_LIMITED', 429],
  ])('handles Gemini failure %s without exposing internals', async (code, status) => {
    const user = await createCitizen(`assistant-${code.toLowerCase()}@example.com`);
    const { notice } = await createNotice(user.authUserId);
    assistantMocks.answerNoticeQuestion.mockRejectedValue(Object.assign(
      new Error('Sensitive upstream details'),
      { code },
    ));

    const response = await ask(user, {
      question: 'What date?',
      language: 'en',
      mode: 'current',
      noticeId: notice.id,
    });

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.message).not.toContain('Sensitive upstream details');
  });
});
