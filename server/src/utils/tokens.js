import { randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export const ACCESS_COOKIE = 'civicsignal_access';
export const CSRF_COOKIE = 'civicsignal_csrf';

const cookieOptions = {
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/api',
};

export function createAccessToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtAccessTokenTtlSeconds,
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    algorithms: ['HS256'],
    issuer: config.jwtIssuer,
    audience: config.jwtAudience,
  });
}

export function issueCsrfCookie(res) {
  const csrfToken = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, csrfToken, {
    ...cookieOptions,
    httpOnly: false,
    maxAge: config.jwtAccessTokenTtlSeconds * 1000,
  });
  return csrfToken;
}

export function issueAuthCookies(res, userId) {
  const csrfToken = issueCsrfCookie(res);
  res.cookie(ACCESS_COOKIE, createAccessToken(userId), {
    ...cookieOptions,
    httpOnly: true,
    maxAge: config.jwtAccessTokenTtlSeconds * 1000,
  });
  return csrfToken;
}

export function clearAuthCookies(res) {
  res.clearCookie(ACCESS_COOKIE, { ...cookieOptions, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...cookieOptions, httpOnly: false });
}

export function tokensMatch(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
