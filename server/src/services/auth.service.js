import bcrypt from 'bcrypt';
import { User } from '../models/User.js';
import { config } from '../config/env.js';

export function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    languagePreference: user.languagePreference,
    selectedAreaIds: user.selectedAreaIds,
    notificationCategories: user.notificationCategories,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function registerUser({ email, password, languagePreference }) {
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const user = await User.create({ email, passwordHash, languagePreference });
  return toSafeUser(user);
}

export async function authenticateUser({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const hash = user?.passwordHash ?? await bcrypt.hash('constant-time-dummy-password', config.bcryptRounds);
  const passwordMatches = await bcrypt.compare(password, hash);
  if (!user || !passwordMatches) return null;
  return toSafeUser(user);
}

export async function getUserById(id) {
  const user = await User.findById(id);
  return user ? toSafeUser(user) : null;
}

export async function updateUserPreferences(id, preferences) {
  const user = await User.findByIdAndUpdate(id, { $set: preferences }, {
    returnDocument: 'after',
    runValidators: true,
  });
  return user ? toSafeUser(user) : null;
}
