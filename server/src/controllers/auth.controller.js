import { registerUser, authenticateUser } from '../services/auth.service.js';
import { clearAuthCookies, issueAuthCookies } from '../utils/tokens.js';

export async function register(req, res, next) {
  try {
    const user = await registerUser(req.validated.body);
    const csrfToken = issueAuthCookies(res, user.id);
    return res.status(201).json({ user, csrfToken });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const user = await authenticateUser(req.validated.body);
    if (!user) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    const csrfToken = issueAuthCookies(res, user.id);
    return res.status(200).json({ user, csrfToken });
  } catch (error) {
    return next(error);
  }
}

export function logout(_req, res) {
  clearAuthCookies(res);
  res.set('Cache-Control', 'no-store');
  return res.status(204).end();
}
