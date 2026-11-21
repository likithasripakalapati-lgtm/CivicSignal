import { api } from './api.js';
import { refreshCsrfToken } from './auth.js';

export async function askAssistant({ question, language, mode, noticeId }) {
  const csrfToken = await refreshCsrfToken();
  const payload = { question, language, mode };
  if (mode === 'current') payload.noticeId = noticeId;

  const { data } = await api.post('/assistant/ask', payload, {
    headers: { 'X-CSRF-Token': csrfToken },
  });
  return data;
}
