import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { signIn, signOut, updatePreferences } from './auth.js';

vi.mock('./api.js', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
});

describe('CSRF lifecycle around sign-out and sign-in', () => {
  it('bootstraps fresh tokens for logout and the next sign-in', async () => {
    api.get
      .mockResolvedValueOnce({ data: { csrfToken: 'logout-csrf-token' } })
      .mockResolvedValueOnce({ data: { csrfToken: 'fresh-sign-in-csrf-token' } });
    api.post
      .mockResolvedValueOnce({ data: undefined })
      .mockResolvedValueOnce({ data: { user: { id: 'citizen-1', email: 'citizen@example.test' }, csrfToken: 'rotated-after-login' } });

    await signOut();
    const user = await signIn({ email: 'citizen@example.test', password: 'test password' });

    expect(user.id).toBe('citizen-1');
    expect(api.get).toHaveBeenNthCalledWith(1, '/auth/csrf');
    expect(api.get).toHaveBeenNthCalledWith(2, '/auth/csrf');
    expect(api.post).toHaveBeenNthCalledWith(1, '/auth/logout', {}, {
      headers: { 'X-CSRF-Token': 'logout-csrf-token' },
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/auth/login', {
      email: 'citizen@example.test', password: 'test password',
    }, { headers: { 'X-CSRF-Token': 'fresh-sign-in-csrf-token' } });
    expect(api.defaults).toBeUndefined();
  });

  it('updates user preferences using a fresh CSRF token', async () => {
    api.get.mockResolvedValueOnce({ data: { csrfToken: 'preferences-csrf-token' } });
    api.patch.mockResolvedValueOnce({ data: { user: { id: 'citizen-1', selectedAreaIds: ['ap-anakapalli'] } } });

    const user = await updatePreferences({ selectedAreaIds: ['ap-anakapalli'] });

    expect(user.selectedAreaIds).toEqual(['ap-anakapalli']);
    expect(api.get).toHaveBeenCalledWith('/auth/csrf');
    expect(api.patch).toHaveBeenCalledWith('/users/preferences', {
      selectedAreaIds: ['ap-anakapalli'],
    }, { headers: { 'X-CSRF-Token': 'preferences-csrf-token' } });
  });
});
