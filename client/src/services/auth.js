import { api } from './api.js';

let csrfToken = null;

export async function refreshCsrfToken() {
  const { data } = await api.get('/auth/csrf');
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function submitCredentials(path, payload) {
  const token = await refreshCsrfToken();
  const { data } = await api.post(path, payload, { headers: { 'X-CSRF-Token': token } });
  csrfToken = data.csrfToken;
  return data.user;
}

export function register(credentials) {
  return submitCredentials('/auth/register', credentials);
}

export function signIn(credentials) {
  return submitCredentials('/auth/login', credentials);
}

export async function getCurrentUser() {
  const { data } = await api.get('/users/me');
  return data.user;
}

export async function updatePreferences(preferences) {
  const token = await refreshCsrfToken();
  const { data } = await api.patch('/users/preferences', preferences, {
    headers: { 'X-CSRF-Token': token },
  });
  return data.user;
}

export async function signOut() {
  const token = await refreshCsrfToken();
  await api.post('/auth/logout', {}, { headers: { 'X-CSRF-Token': token } });
  csrfToken = null;
}
