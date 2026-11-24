import { analyzeNoticeText } from '../services/geminiAnalysis.service.js';
import { unlink } from 'node:fs/promises';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Notice } from '../models/Notice.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { validateDocumentFile } from '../services/documentValidation.service.js';
import { removeStoredDocument, storeDocument } from '../services/gridFs.service.js';
import { verifyOfficialPublication } from '../services/sourceVerification.service.js';

function safeFilename(filename) {
  return filename.replace(/[\\/"\r\n]/g, '_').slice(0, 255) || 'document';
}

export async function uploadNotice(req, res, next) {
  let fileId;
  let noticeId;
  let jobId;
  try {
    const { contentType, sizeBytes } = await validateDocumentFile(req.file);
    fileId = new mongoose.Types.ObjectId();
    await storeDocument(req.file, fileId, { contentType, ownerId: req.auth.userId });
    const notice = await Notice.create({
      ownerId: req.auth.userId,
      originalFile: { gridFsId: fileId, filename: safeFilename(req.file.originalname), contentType, sizeBytes },
      status: 'queued',
      authenticityStatus: 'unverified',
      sourceVerification: { status: 'not_checked' },
    });
    noticeId = notice._id;
    const job = await ProcessingJob.create({ noticeId: notice._id, ownerId: req.auth.userId, status: 'queued' });
    jobId = job._id;

    return res.status(201).json({
      notice: {
        id: notice.id,
        filename: notice.originalFile.filename,
        contentType,
        sizeBytes,
        status: notice.status,
        authenticityStatus: notice.authenticityStatus,
        sourceVerification: notice.sourceVerification,
      },
      processing: { status: job.status, progress: job.progress },
    });
  } catch (error) {
    if (jobId) await ProcessingJob.deleteOne({ _id: jobId, ownerId: req.auth.userId }).catch(() => {});
    if (noticeId) await Notice.deleteOne({ _id: noticeId, ownerId: req.auth.userId }).catch(() => {});
    if (fileId) await removeStoredDocument(fileId);
    return next(error);
  } finally {
    if (req.file?.path) await unlink(req.file.path).catch(() => {});
  }
}

export async function getNotices(req, res) {
  const notices = await Notice.find({ ownerId: req.auth.userId })
    .sort({ createdAt: -1, _id: -1 })
    .select('_id originalFile.filename status createdAt')
    .lean();
  const jobs = notices.length > 0
    ? await ProcessingJob.find({
      ownerId: req.auth.userId,
      noticeId: { $in: notices.map(({ _id }) => _id) },
    }).select('noticeId status +analysis').lean()
    : [];
  const jobsByNoticeId = new Map(jobs.map((job) => [String(job.noticeId), job]));

  return res.json({
    notices: notices.map((notice) => {
      const job = jobsByNoticeId.get(String(notice._id));
      const analyzedTitle = job?.analysis?.title?.value;
      return {
        id: String(notice._id),
        title: typeof analyzedTitle === 'string' && analyzedTitle.trim()
          ? analyzedTitle.trim()
          : notice.originalFile.filename,
        filename: notice.originalFile.filename,
        uploadedAt: notice.createdAt,
        extractionStatus: job?.status ?? notice.status,
      };
    }),
  });
}

export async function getNotice(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const notice = await Notice.findOne({ _id: req.params.id, ownerId: req.auth.userId }).lean();
  if (!notice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const job = await ProcessingJob.findOne({ noticeId: notice._id, ownerId: req.auth.userId })
    .select('status progress currentPage totalPages attempts lastErrorCode extractionMethod').lean();
  return res.json({ notice: {
    id: String(notice._id), filename: notice.originalFile.filename, contentType: notice.originalFile.contentType,
    sizeBytes: notice.originalFile.sizeBytes,
    authenticityStatus: notice.authenticityStatus,
    sourceVerification: notice.sourceVerification ?? { status: 'not_checked' },
  }, processing: job ? {
    status: job.status, progress: job.progress, currentPage: job.currentPage, totalPages: job.totalPages,
    attempts: job.attempts, canRetry: job.status === 'failed' && job.attempts < config.processingMaxAttempts,
    errorCode: job.lastErrorCode, extractionMethod: job.status === 'completed' ? job.extractionMethod : null,
  } : null });
}

export async function getNoticeText(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const notice = await Notice.findOne({ _id: req.params.id, ownerId: req.auth.userId }).select('_id').lean();
  if (!notice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const job = await ProcessingJob.findOne({ noticeId: notice._id, ownerId: req.auth.userId }).select('+extractedPages status extractionMethod').lean();
  if (!job || job.status !== 'completed') {
    return res.status(409).json({ error: { code: job?.status === 'failed' ? 'PROCESSING_FAILED' : 'PROCESSING_INCOMPLETE', message: 'Extracted text is not available yet.' } });
  }
  return res.json({ extractionMethod: job.extractionMethod, pages: job.extractedPages ?? [] });
}
export async function analyzeNotice(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const notice = await Notice.findOne({
    _id: req.params.id,
    ownerId: req.auth.userId,
  }).select('_id').lean();

  if (!notice) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const job = await ProcessingJob.findOne({
    noticeId: notice._id,
    ownerId: req.auth.userId,
  }).select('+extractedPages status').lean();

  if (!job || job.status !== 'completed' || !job.extractedPages?.length) {
    return res.status(409).json({
      error: {
        code: 'PROCESSING_INCOMPLETE',
        message: 'Please wait until document extraction is complete.',
      },
    });
  }

  let failureStage = 'analysis';
  try {
    const analysis = await analyzeNoticeText(job.extractedPages);

    failureStage = 'persistence';
    await ProcessingJob.updateOne(
      { _id: job._id, ownerId: req.auth.userId },
      {
        $set: {
          analysis,
          analysisStatus: 'completed',
          analysisErrorCode: null,
        },
      },
    );

    return res.json({ analysisStatus: 'completed', analysis });
  } catch (error) {
    const allowedCodes = [
      'GEMINI_NOT_CONFIGURED',
      'GEMINI_RATE_LIMITED',
      'GEMINI_UNAVAILABLE',
      'GEMINI_REQUEST_FAILED',
      'GEMINI_INVALID_RESPONSE',
      'GEMINI_EVIDENCE_INVALID',
      'GEMINI_EMPTY_RESPONSE',
      'GEMINI_INVALID_JSON',
      'ANALYSIS_INPUT_EMPTY',
      'ANALYSIS_INPUT_TOO_LARGE',
    ];

    const errorCode = allowedCodes.includes(error.code)
      ? error.code
      : 'GEMINI_REQUEST_FAILED';

    console.error('Notice analysis failed', {
      stage: failureStage,
      code: errorCode,
      errorName: ['ApiError', 'GoogleGenAIError', 'Error', 'TypeError', 'MongooseError', 'MongoServerError']
        .includes(error?.name)
        ? error.name
        : 'OtherError',
    });

    await ProcessingJob.updateOne(
      { _id: job._id, ownerId: req.auth.userId },
      {
        $set: {
          analysisStatus: 'failed',
          analysisErrorCode: errorCode,
        },
        $unset: { analysis: 1 },
      },
    );

    const statusCodeByErrorCode = {
      GEMINI_RATE_LIMITED: 429,
      GEMINI_UNAVAILABLE: 503,
      GEMINI_NOT_CONFIGURED: 503,
      ANALYSIS_INPUT_TOO_LARGE: 413,
      ANALYSIS_INPUT_EMPTY: 409,
    };
    const statusCode = statusCodeByErrorCode[errorCode] ?? 502;

    return res.status(statusCode).json({
      error: {
        code: errorCode,
        message: 'We could not analyse this notice right now. Please try again later.',
      },
    });
  }
}
export async function getNoticeAnalysis(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const notice = await Notice.findOne({
    _id: req.params.id,
    ownerId: req.auth.userId,
  }).select('_id').lean();

  if (!notice) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const job = await ProcessingJob.findOne({
    noticeId: notice._id,
    ownerId: req.auth.userId,
  }).select('+analysis analysisStatus analysisErrorCode').lean();

  if (!job) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Analysis not found.' },
    });
  }

  return res.json({
    analysisStatus: job.analysisStatus,
    analysis: job.analysis ?? null,
    errorCode: job.analysisErrorCode ?? null,
  });
}

export async function verifyNoticeSource(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const notice = await Notice.findOne({
    _id: req.params.id,
    ownerId: req.auth.userId,
  }).select('_id authenticityStatus').lean();

  if (!notice) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Notice not found.' },
    });
  }

  const job = await ProcessingJob.findOne({
    noticeId: notice._id,
    ownerId: req.auth.userId,
  }).select('+analysis +extractedPages analysisStatus').lean();

  let sourceVerification;
  try {
    sourceVerification = await verifyOfficialPublication({
      ...req.validated.body,
      analysis: job?.analysis,
      noticePages: job?.extractedPages,
    });
  } catch (error) {
    if (error?.code === 'SOURCE_URL_UNSUPPORTED') {
      return res.status(400).json({
        error: { code: 'SOURCE_URL_UNSUPPORTED', message: 'Use a publication PDF URL from the supported Andhra Pradesh Gazette.' },
      });
    }
    throw error;
  }

  await Notice.updateOne(
    { _id: notice._id, ownerId: req.auth.userId },
    { $set: { sourceVerification } },
  );

  return res.json({
    sourceVerification,
    authenticityStatus: notice.authenticityStatus,
  });
}
export async function retryNoticeProcessing(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const notice = await Notice.findOne({ _id: req.params.id, ownerId: req.auth.userId }).select('_id').lean();
  if (!notice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Notice not found.' } });
  const job = await ProcessingJob.findOneAndUpdate({
    noticeId: notice._id,
    ownerId: req.auth.userId,
    status: 'failed',
    attempts: { $lt: config.processingMaxAttempts },
  }, {
    $set: { status: 'queued', progress: 0, currentPage: 0, totalPages: null, lastErrorCode: null },
    $unset: { processingToken: 1, leaseUntil: 1, extractedPages: 1, extractionMethod: 1 },
  }, { returnDocument: 'after' }).select('status progress');
  if (!job) return res.status(409).json({ error: { code: 'RETRY_NOT_AVAILABLE', message: 'This notice cannot be retried.' } });
  await Notice.updateOne({ _id: notice._id, ownerId: req.auth.userId }, { $set: { status: 'queued' } });
  return res.status(202).json({ processing: { status: job.status, progress: job.progress } });
}

export async function downloadNoticeDocument(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });
  const notice = await Notice.findOne({ _id: req.params.id, ownerId: req.auth.userId }).lean();
  if (!notice) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Document not found.' } });

  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: config.gridFsBucketName });
  const stream = bucket.openDownloadStream(notice.originalFile.gridFsId);
  stream.once('error', (error) => {
    if (res.headersSent) return res.destroy(error);
    if (error?.code === 'ENOENT') return res.status(404).json({ error: { code: 'DOCUMENT_MISSING', message: 'Original document is unavailable.' } });
    return next(error);
  });
  res.set({
    'Content-Type': notice.originalFile.contentType,
    'Content-Length': String(notice.originalFile.sizeBytes),
    'Content-Disposition': `attachment; filename="${safeFilename(notice.originalFile.filename)}"; filename*=UTF-8''${encodeURIComponent(notice.originalFile.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
  return stream.pipe(res);
}
