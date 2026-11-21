import { config } from '../config/env.js';
import { CSRF_COOKIE, tokensMatch } from '../utils/tokens.js';

export function verifyCsrf(req, res, next) {
  const origin = req.get('origin');
  const trustedOrigin = origin && config.clientOrigins.includes(origin);
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('x-csrf-token');

  if (!trustedOrigin || !tokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({ error: { code: 'CSRF_REJECTED', message: 'Request could not be verified.' } });
  }
  return next();
}
