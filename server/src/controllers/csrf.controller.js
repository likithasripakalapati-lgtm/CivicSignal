import { issueCsrfCookie } from '../utils/tokens.js';

export function getCsrfToken(_req, res) {
  const csrfToken = issueCsrfCookie(res);
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ csrfToken });
}
