import mongoose from 'mongoose';

const sourceEvidenceSchema = new mongoose.Schema({
  field: { type: String, enum: ['title', 'issuingDepartment', 'noticeDate', 'publicationDate'], required: true },
  noticePageNumber: { type: Number, min: 1, default: null },
  noticeEvidence: { type: String, maxlength: 1200, default: null },
  sourcePageNumber: { type: Number, min: 1, required: true },
  sourceEvidence: { type: String, required: true, maxlength: 1200 },
}, { _id: false });

const sourceVerificationSchema = new mongoose.Schema({
  status: { type: String, enum: ['not_checked', 'match_found', 'no_match', 'unavailable'], default: 'not_checked', required: true },
  sourceName: { type: String, maxlength: 120, default: null },
  sourceOrganization: { type: String, maxlength: 250, default: null },
  sourceUrl: { type: String, maxlength: 2048, default: null },
  publicationDate: { type: String, maxlength: 80, default: null },
  checkedAt: { type: Date, default: null },
  evidence: { type: [sourceEvidenceSchema], default: [] },
  reason: {
    type: String,
    enum: ['SOURCE_FETCH_FAILED', 'SOURCE_DOCUMENT_INVALID', 'SOURCE_TEXT_UNAVAILABLE', 'SOURCE_METADATA_INSUFFICIENT'],
    default: null,
  },
}, { _id: false });

const noticeSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  originalFile: {
    gridFsId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    filename: { type: String, required: true, maxlength: 255 },
    contentType: { type: String, enum: ['application/pdf', 'image/jpeg', 'image/png'], required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
  },
  status: { type: String, enum: ['queued', 'processing', 'failed', 'completed'], default: 'queued', required: true },
  authenticityStatus: { type: String, enum: ['unverified'], default: 'unverified', required: true },
  sourceVerification: { type: sourceVerificationSchema, default: () => ({}) },
}, { timestamps: true, versionKey: false });

noticeSchema.index({ ownerId: 1, createdAt: -1 });

export const Notice = mongoose.models.Notice ?? mongoose.model('Notice', noticeSchema);
