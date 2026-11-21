import mongoose from 'mongoose';

const extractedPageSchema = new mongoose.Schema({
  pageNumber: { type: Number, required: true, min: 1 },
  method: { type: String, enum: ['digital', 'ocr'], required: true },
  text: { type: String, required: true },
}, { _id: false });

const processingJobSchema = new mongoose.Schema({
  noticeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Notice', required: true, unique: true, index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['queued', 'processing', 'completed', 'failed'], default: 'queued', required: true, index: true },
  progress: { type: Number, min: 0, max: 100, default: 0 },
  currentPage: { type: Number, min: 0, default: 0 },
  totalPages: { type: Number, min: 0, default: null },
  attempts: { type: Number, min: 0, default: 0 },
  processingToken: { type: String, select: false },
  leaseUntil: { type: Date, select: false },
  lastErrorCode: { type: String, enum: ['DOCUMENT_UNREADABLE', 'EXTRACTION_EMPTY', 'PROCESSING_FAILED'], default: null },
  extractionMethod: { type: String, enum: ['digital', 'ocr', 'mixed'], default: null },
  extractedPages: { type: [extractedPageSchema], default: undefined, select: false },
  analysisStatus: {
  type: String,
  enum: ['pending', 'completed', 'failed'],
  default: null,
},
analysis: {
  type: mongoose.Schema.Types.Mixed,
  default: undefined,
  select: false,
},
analysisErrorCode: {
  type: String,
  enum: [
    'GEMINI_NOT_CONFIGURED',
    'GEMINI_RATE_LIMITED',
    'GEMINI_UNAVAILABLE',
    'GEMINI_REQUEST_FAILED',
    'GEMINI_INVALID_RESPONSE',
    'GEMINI_EVIDENCE_INVALID',
    'GEMINI_EMPTY_RESPONSE',
    'GEMINI_INVALID_JSON',
  ],
  default: null,
},
}, { timestamps: true, versionKey: false });

processingJobSchema.index({ status: 1, createdAt: 1 });
processingJobSchema.index({ status: 1, leaseUntil: 1, attempts: 1 });

export const ProcessingJob = mongoose.models.ProcessingJob ?? mongoose.model('ProcessingJob', processingJobSchema);
