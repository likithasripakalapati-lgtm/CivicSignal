import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { refreshCsrfToken } from './auth.js';
import { askAssistant } from './assistant.js';

vi.mock('./api.js', () => ({
  api: { post: vi.fn() },
}));

vi.mock('./auth.js', () => ({
  refreshCsrfToken: vi.fn(),
}));

beforeEach(() => {
  api.post.mockReset();
  refreshCsrfToken.mockReset();
  refreshCsrfToken.mockResolvedValue('fresh-csrf-token');
  api.post.mockResolvedValue({ data: { answer: 'Grounded answer' } });
});

describe('assistant API service', () => {
  it('sends a current-notice question with a fresh CSRF token', async () => {
    const result = await askAssistant({
      question: 'When is the notice effective?',
      language: 'en',
      mode: 'current',
      noticeId: 'notice-1',
    });

    expect(result).toEqual({ answer: 'Grounded answer' });
    expect(refreshCsrfToken).toHaveBeenCalledOnce();
    expect(api.post).toHaveBeenCalledWith('/assistant/ask', {
      question: 'When is the notice effective?',
      language: 'en',
      mode: 'current',
      noticeId: 'notice-1',
    }, { headers: { 'X-CSRF-Token': 'fresh-csrf-token' } });
  });

  it('sends all-notices questions without a notice ID and preserves the CSRF header', async () => {
    await askAssistant({
      question: 'Summarize my notices.',
      language: 'te',
      mode: 'all',
      noticeId: 'must-not-be-sent',
    });

    expect(api.post).toHaveBeenCalledWith('/assistant/ask', {
      question: 'Summarize my notices.',
      language: 'te',
      mode: 'all',
    }, { headers: { 'X-CSRF-Token': 'fresh-csrf-token' } });
  });
});
