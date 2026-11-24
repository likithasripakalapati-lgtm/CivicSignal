import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { askAssistant } from '../controllers/assistant.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireTrustedOrigin } from '../middleware/requireTrustedOrigin.js';
import { verifyCsrf } from '../middleware/verifyCsrf.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { assistantQuestionSchema } from '../schemas/assistant.schemas.js';

const assistantRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many assistant requests. Please try again later.' } },
});

const router = Router();

router.post(
  '/ask',
  authenticate,
  requireTrustedOrigin,
  verifyCsrf,
  assistantRateLimit,
  validateRequest(assistantQuestionSchema),
  askAssistant,
);

export default router;
