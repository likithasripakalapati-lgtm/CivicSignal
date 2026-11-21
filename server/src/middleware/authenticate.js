import { ACCESS_COOKIE, verifyAccessToken } from '../utils/tokens.js';

export function authenticate(req, res, next) {
  const token = req.cookies?.[ACCESS_COOKIE];
  if (!token) {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
  }

  try {
    const claims = verifyAccessToken(token);
    req.auth = { userId: claims.sub };
    return next();
  } catch {
    return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
  }
}
