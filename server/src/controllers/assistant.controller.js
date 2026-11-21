import mongoose from 'mongoose';
import { answerNoticeQuestion } from '../services/geminiAnalysis.service.js';
import { Notice } from '../models/Notice.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { assistantResponseSchema } from '../schemas/assistant.schemas.js';

const MAX_NOTICES = 10;
const MAX_SOURCE_CHARACTERS = 60_000;

const NO_ANSWER = {
  en: 'The available notices do not contain the answer.',
  te: 'అందుబాటులో ఉన్న నోటీసుల్లో ఈ ప్రశ్నకు సమాధానం లేదు.',
};

const DISCLAIMER = {
  en: 'AI-generated answer based only on the cited notice text. This is not official government guidance; the notice remains unverified.',
  te: 'ఈ సమాధానం ఉదహరించిన నోటీసు పాఠ్యంపై మాత్రమే AI రూపొందించింది. ఇది అధికారిక ప్రభుత్వ మార్గదర్శకం కాదు; నోటీసు ధృవీకరించబడలేదు.',
};

function assistantError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function extractionError(res, job) {
  if (job?.status === 'failed') {
    return assistantError(
      res,
      409,
      'EXTRACTION_FAILED',
      'Text extraction failed for this notice, so it cannot be used to answer questions.',
    );
  }
  if (!job) {
    return assistantError(
      res,
      409,
      'EXTRACTION_UNAVAILABLE',
      'Extracted text is not available for this notice.',
    );
  }
  return assistantError(
    res,
    409,
    'PROCESSING_INCOMPLETE',
    'Please wait until text extraction is complete.',
  );
}

function readablePages(job) {
  return (job?.extractedPages ?? [])
    .filter((page) => Number.isInteger(page.pageNumber) && page.pageNumber > 0
      && typeof page.text === 'string' && page.text.trim())
    .map(({ pageNumber, text }) => ({ pageNumber, text }));
}

function toSource(notice, job) {
  return {
    noticeId: String(notice._id),
    filename: notice.originalFile.filename,
    pages: readablePages(job),
    authenticityStatus: 'unverified',
  };
}

function mapGeminiFailure(error) {
  if (error?.code === 'GEMINI_NOT_CONFIGURED' || error?.code === 'GEMINI_UNAVAILABLE') {
    return { status: 503, code: error.code };
  }
  if (error?.code === 'GEMINI_RATE_LIMITED') {
    return { status: 429, code: error.code };
  }
  if ([
    'GEMINI_INVALID_RESPONSE',
    'GEMINI_EVIDENCE_INVALID',
    'GEMINI_EMPTY_RESPONSE',
    'GEMINI_INVALID_JSON',
  ].includes(error?.code)) {
    return { status: 502, code: error.code };
  }
  return { status: 502, code: 'GEMINI_REQUEST_FAILED' };
}

export async function askAssistant(req, res) {
  const { question, language, mode, noticeId } = req.validated.body;
  const ownerId = req.auth.userId;
  let sources;

  if (mode === 'current') {
    if (!mongoose.isValidObjectId(noticeId)) {
      return assistantError(res, 404, 'NOT_FOUND', 'Notice not found.');
    }

    const notice = await Notice.findOne({ _id: noticeId, ownerId })
      .select('_id status originalFile.filename')
      .lean();
    if (!notice) return assistantError(res, 404, 'NOT_FOUND', 'Notice not found.');
    if (notice.status === 'failed') {
      return assistantError(res, 409, 'EXTRACTION_FAILED', 'Text extraction failed for this notice.');
    }
    if (notice.status !== 'completed') {
      return assistantError(res, 409, 'PROCESSING_INCOMPLETE', 'Please wait until text extraction is complete.');
    }

    const job = await ProcessingJob.findOne({ noticeId: notice._id, ownerId })
      .select('status +extractedPages')
      .lean();
    if (!job || job.status !== 'completed') return extractionError(res, job);
    sources = [toSource(notice, job)];
    if (sources[0].pages.length === 0) {
      return assistantError(res, 409, 'EXTRACTION_UNAVAILABLE', 'No readable extracted text is available for this notice.');
    }
  } else {
    const notices = await Notice.find({ ownerId, status: 'completed' })
      .sort({ createdAt: -1, _id: -1 })
      .limit(MAX_NOTICES + 1)
      .select('_id originalFile.filename')
      .lean();

    if (notices.length > MAX_NOTICES) {
      return assistantError(
        res,
        413,
        'TOO_MANY_NOTICES',
        `Ask about one notice at a time; all-notices questions are limited to ${MAX_NOTICES} completed notices.`,
      );
    }
    if (notices.length === 0) {
      return assistantError(res, 409, 'NO_READABLE_NOTICES', 'No completed notices are available to answer this question.');
    }

    const jobs = await ProcessingJob.find({
      ownerId,
      noticeId: { $in: notices.map(({ _id }) => _id) },
      status: 'completed',
    }).select('noticeId status +extractedPages').lean();
    const jobsByNoticeId = new Map(jobs.map((job) => [String(job.noticeId), job]));
    sources = notices
      .map((notice) => toSource(notice, jobsByNoticeId.get(String(notice._id))))
      .filter((source) => source.pages.length > 0);

    if (sources.length === 0) {
      return assistantError(res, 409, 'NO_READABLE_NOTICES', 'No completed notices with readable extracted text are available.');
    }
  }

  const totalCharacters = sources.reduce(
    (total, source) => total + source.pages.reduce((pageTotal, page) => pageTotal + page.text.length, 0),
    0,
  );
  if (totalCharacters > MAX_SOURCE_CHARACTERS) {
    return assistantError(
      res,
      413,
      'SOURCE_TEXT_TOO_LARGE',
      'The selected notices contain too much text to answer safely. Please ask about fewer or shorter notices.',
    );
  }

  let generated;
  try {
    generated = await answerNoticeQuestion({ question, language, sources });
  } catch (error) {
    const failure = mapGeminiFailure(error);
    return assistantError(
      res,
      failure.status,
      failure.code,
      'We could not answer from the notices right now. Please try again later.',
    );
  }

  const sourceById = new Map(sources.map((source) => [source.noticeId, source]));
  const response = assistantResponseSchema.safeParse({
    answer: generated.answerable ? generated.answer : NO_ANSWER[language],
    answerable: generated.answerable,
    language,
    mode,
    aiGenerated: true,
    disclaimer: DISCLAIMER[language],
    sources: sources.map(({ noticeId: id, filename }) => ({
      noticeId: id,
      filename,
      authenticityStatus: 'unverified',
    })),
    evidence: generated.evidence.map((item) => ({
      ...item,
      filename: sourceById.get(item.noticeId)?.filename,
    })),
  });

  if (!response.success) {
    return assistantError(
      res,
      502,
      'GEMINI_INVALID_RESPONSE',
      'The answer could not be validated against the available notice text.',
    );
  }
  return res.json(response.data);
}
