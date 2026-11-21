import { getUserById, updateUserPreferences } from '../services/auth.service.js';

export async function getCurrentUser(req, res, next) {
  try {
    const user = await getUserById(req.auth.userId);
    if (!user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}

export async function patchPreferences(req, res, next) {
  try {
    const user = await updateUserPreferences(req.auth.userId, req.validated.body);
    if (!user) return res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication is required.' } });
    return res.status(200).json({ user });
  } catch (error) {
    return next(error);
  }
}
