import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config/env.js';
import { login, logout, register } from '../controllers/auth.controller.js';
import { requireTrustedOrigin, validateOptionalTrustedOrigin } from '../middleware/requireTrustedOrigin.js';
import { verifyCsrf } from '../middleware/verifyCsrf.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { loginSchema, registerSchema } from '../schemas/auth.schemas.js';
import { getCsrfToken } from '../controllers/csrf.controller.js';

const router = Router();
const authRateLimit = rateLimit({
  windowMs: config.authRateLimitWindowMs,
  limit: config.authRateLimitMax,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
});

router.get('/csrf', validateOptionalTrustedOrigin, getCsrfToken);
router.post('/register', requireTrustedOrigin, authRateLimit, verifyCsrf, validateRequest(registerSchema), register);
router.post('/login', requireTrustedOrigin, authRateLimit, verifyCsrf, validateRequest(loginSchema), login);
router.post('/logout', requireTrustedOrigin, verifyCsrf, logout);

export default router;
