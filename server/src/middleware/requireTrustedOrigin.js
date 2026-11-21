import { config } from '../config/env.js';

export function requireTrustedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin || !config.clientOrigins.includes(origin)) {
    return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } });
  }
  return next();
}

export function validateOptionalTrustedOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin && !config.clientOrigins.includes(origin)) {
    return res.status(403).json({ error: { code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' } });
  }
  return next();
}
