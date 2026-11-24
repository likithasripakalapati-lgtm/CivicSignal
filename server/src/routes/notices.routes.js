import { Router } from 'express';

import {
  analyzeNotice,
  downloadNoticeDocument,
  getNoticeAnalysis,
  getNotice,
  getNotices,
  getNoticeText,
  retryNoticeProcessing,
  uploadNotice,
  verifyNoticeSource,
} from '../controllers/notices.controller.js';

import { authenticate } from '../middleware/authenticate.js';
import { receiveDocument } from '../middleware/documentUpload.js';
import { requireTrustedOrigin } from '../middleware/requireTrustedOrigin.js';
import { verifyCsrf } from '../middleware/verifyCsrf.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { sourceCandidateSchema } from '../schemas/sourceVerification.schemas.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const sourceVerificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many verification attempts. Please try again later.' } },
});

const router = Router();

router.get('/', authenticate, getNotices);
router.post('/upload', authenticate, requireTrustedOrigin, verifyCsrf, receiveDocument, uploadNotice);
router.post('/:id/analyze', authenticate, requireTrustedOrigin, verifyCsrf, analyzeNotice);
router.post('/:id/process', authenticate, requireTrustedOrigin, verifyCsrf, retryNoticeProcessing);
router.post('/:id/verify-source', authenticate, requireTrustedOrigin, verifyCsrf, sourceVerificationRateLimit, validateRequest(sourceCandidateSchema), verifyNoticeSource);
router.get('/:id/document', authenticate, downloadNoticeDocument);
router.get('/:id/text', authenticate, getNoticeText);
router.get('/:id', authenticate, getNotice);
router.get('/:id/analysis', authenticate, getNoticeAnalysis);

export default router;