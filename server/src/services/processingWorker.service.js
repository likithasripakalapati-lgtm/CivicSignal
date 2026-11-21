import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Notice } from '../models/Notice.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { extractDocument } from './documentExtraction.service.js';
import { createLocalOcrWorker } from './ocr.service.js';

const TEMP_PREFIX = 'civicsignal-processing-';
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
let stopping = false;
let loopPromise;
let ocrWorker;

function leaseFilter(jobId, token, now = new Date()) {
  return { _id: jobId, status: 'processing', processingToken: token, leaseUntil: { $gt: now } };
}

export async function claimNextJob(now = new Date()) {
  await failExhaustedLeases(now);
  const token = randomUUID();
  return ProcessingJob.findOneAndUpdate({
    attempts: { $lt: config.processingMaxAttempts },
    $or: [
      { status: 'queued' },
      { status: 'processing', leaseUntil: { $lte: now } },
    ],
  }, {
    $set: {
      status: 'processing',
      processingToken: token,
      leaseUntil: new Date(now.getTime() + config.processingLeaseMs),
      progress: 0,
      currentPage: 0,
      totalPages: null,
      lastErrorCode: null,
    },
    $unset: { extractionMethod: 1, extractedPages: 1 },
    $inc: { attempts: 1 },
  }, { sort: { createdAt: 1 }, returnDocument: 'after' }).select('+processingToken +leaseUntil');
}

export async function failExhaustedLeases(now = new Date()) {
  const expired = await ProcessingJob.find({
    status: 'processing', attempts: { $gte: config.processingMaxAttempts }, leaseUntil: { $lte: now },
  }).select('_id noticeId ownerId').lean();
  for (const item of expired) {
    const failed = await ProcessingJob.findOneAndUpdate({
      _id: item._id, status: 'processing', attempts: { $gte: config.processingMaxAttempts }, leaseUntil: { $lte: now },
    }, { $set: { status: 'failed', lastErrorCode: 'PROCESSING_FAILED' }, $unset: { processingToken: 1, leaseUntil: 1 } });
    if (failed) await Notice.updateOne({ _id: item.noticeId, ownerId: item.ownerId }, { $set: { status: 'failed' } });
  }
}

export async function renewJobLease(jobId, token) {
  const now = new Date();
  const result = await ProcessingJob.updateOne(leaseFilter(jobId, token, now), {
    $set: { leaseUntil: new Date(now.getTime() + config.processingLeaseMs) },
  });
  return result.matchedCount === 1;
}

export async function updateJobProgress(jobId, token, currentPage, totalPages) {
  const now = new Date();
  const result = await ProcessingJob.updateOne(leaseFilter(jobId, token, now), {
    $set: {
      currentPage,
      totalPages,
      progress: Math.min(99, Math.floor((currentPage / totalPages) * 100)),
      leaseUntil: new Date(now.getTime() + config.processingLeaseMs),
    },
  });
  return result.matchedCount === 1;
}

async function downloadForProcessing(notice, directory) {
  const filename = join(directory, 'source-document');
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: config.gridFsBucketName });
  let bytesWritten = 0;
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      bytesWritten += chunk.length;
      if (bytesWritten > config.uploadMaxFileSizeBytes || bytesWritten > notice.originalFile.sizeBytes) {
        callback(Object.assign(new Error('Stored document exceeded its expected size.'), { code: 'DOCUMENT_UNREADABLE' }));
      } else callback(null, chunk);
    },
  });
  await pipeline(bucket.openDownloadStream(notice.originalFile.gridFsId), limit, createWriteStream(filename, { flags: 'wx', mode: 0o600 }));
  if (bytesWritten !== notice.originalFile.sizeBytes) {
    throw Object.assign(new Error('Stored document size did not match its metadata.'), { code: 'DOCUMENT_UNREADABLE' });
  }
  return filename;
}

function safeFailureCode(error) {
  if (error?.code === 'DOCUMENT_UNREADABLE' || error?.code === 'EXTRACTION_EMPTY') return error.code;
  return 'PROCESSING_FAILED';
}

async function markFailed(job, failureCode) {
  const failed = await ProcessingJob.findOneAndUpdate(leaseFilter(job._id, job.processingToken), {
    $set: { status: 'failed', lastErrorCode: failureCode },
    $unset: { processingToken: 1, leaseUntil: 1 },
  });
  if (failed) await Notice.updateOne({ _id: job.noticeId, ownerId: job.ownerId }, { $set: { status: 'failed' } });
}

export async function completeClaim(job, extraction) {
  const completed = await ProcessingJob.findOneAndUpdate(leaseFilter(job._id, job.processingToken), {
    $set: {
      status: 'completed', progress: 100, currentPage: extraction.totalPages,
      totalPages: extraction.totalPages, extractionMethod: extraction.extractionMethod,
      extractedPages: extraction.extractedPages,
    },
    $unset: { processingToken: 1, leaseUntil: 1, lastErrorCode: 1 },
  });
  if (!completed) return false;
  await Notice.updateOne({ _id: job.noticeId, ownerId: job.ownerId }, { $set: { status: 'completed' } });
  return true;
}

async function processClaimedJob(job, worker) {
  let directory;
  const heartbeat = setInterval(() => {
    void renewJobLease(job._id, job.processingToken).catch(() => {});
  }, Math.max(5000, Math.floor(config.processingLeaseMs / 3)));
  heartbeat.unref?.();

  try {
    const notice = await Notice.findOne({ _id: job.noticeId, ownerId: job.ownerId });
    if (!notice) throw Object.assign(new Error('Notice record is missing.'), { code: 'DOCUMENT_UNREADABLE' });
    directory = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
    const path = await downloadForProcessing(notice, directory);
    const extraction = await extractDocument({
      path,
      contentType: notice.originalFile.contentType,
      worker,
      onPageProgress: async (currentPage, totalPages) => {
        const renewed = await updateJobProgress(job._id, job.processingToken, currentPage, totalPages);
        if (!renewed) throw Object.assign(new Error('Processing lease was lost.'), { code: 'LEASE_LOST' });
      },
    });
    if (!extraction.extractedPages.some((page) => page.text.trim())) {
      throw Object.assign(new Error('Extraction returned no text.'), { code: 'EXTRACTION_EMPTY' });
    }

    return completeClaim(job, extraction);
  } catch (error) {
    if (error?.code !== 'LEASE_LOST') await markFailed(job, safeFailureCode(error)).catch(() => {});
    return false;
  } finally {
    clearInterval(heartbeat);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function processNextJobOnce(worker = ocrWorker) {
  const job = await claimNextJob();
  if (!job) return false;
  await Notice.updateOne({ _id: job.noticeId, ownerId: job.ownerId }, { $set: { status: 'processing' } });
  await processClaimedJob(job, worker);
  return true;
}

async function removeStaleTemporaryDirectories() {
  const root = tmpdir();
  const entries = await readdir(root, { withFileTypes: true });
  const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
  await Promise.all(entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX)).map(async (entry) => {
    const path = join(root, basename(entry.name));
    const details = await stat(path).catch(() => null);
    if (details && details.mtimeMs < staleBefore) await rm(path, { recursive: true, force: true }).catch(() => {});
  }));
}

async function workerLoop() {
  while (!stopping) {
    try {
      const claimed = await processNextJobOnce(ocrWorker);
      if (!claimed) await delay(config.processingPollIntervalMs);
    } catch (error) {
      console.error('Processing worker cycle failed', { name: error?.name ?? 'Error', code: error?.code ?? 'UNKNOWN' });
      await delay(config.processingPollIntervalMs);
    }
  }
}

export async function startDocumentWorker() {
  if (loopPromise) return;
  await removeStaleTemporaryDirectories();
  ocrWorker = await createLocalOcrWorker();
  stopping = false;
  loopPromise = workerLoop();
}

export async function stopDocumentWorker() {
  stopping = true;
  if (loopPromise) await loopPromise;
  loopPromise = undefined;
  if (ocrWorker) await ocrWorker.terminate().catch(() => {});
  ocrWorker = undefined;
}
