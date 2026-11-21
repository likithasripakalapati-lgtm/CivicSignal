import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { getNotices } from './notices.js';

vi.mock('./api.js', () => ({
  api: { get: vi.fn() },
}));

beforeEach(() => {
  api.get.mockReset();
});

describe('notice list service', () => {
  it('requests the authenticated notices collection and returns its response', async () => {
    const data = { notices: [{ id: 'notice-1', title: 'Notice' }] };
    api.get.mockResolvedValue({ data });

    await expect(getNotices()).resolves.toEqual(data);
    expect(api.get).toHaveBeenCalledWith('/notices');
  });
});
