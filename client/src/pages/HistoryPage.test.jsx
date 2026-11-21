import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import HistoryPage from './HistoryPage.jsx';
import * as authService from '../services/auth.js';
import { getNotices } from '../services/notices.js';

vi.mock('../services/auth.js', () => ({
  getCurrentUser: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../services/notices.js', () => ({
  getNotices: vi.fn(),
}));

function renderHistory() {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <MemoryRouter><HistoryPage /></MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockReset();
  authService.getCurrentUser.mockResolvedValue({
    id: 'user-1',
    email: 'citizen@example.test',
    languagePreference: 'en-IN',
  });
  getNotices.mockReset();
});

describe('notice history list', () => {
  it('shows an empty state and upload link when the API returns no notices', async () => {
    getNotices.mockResolvedValue({ notices: [] });
    renderHistory();

    expect(await screen.findByRole('heading', { name: 'You have not uploaded any notices yet' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Submit a notice' })).toHaveAttribute('href', '/notices/upload');
  });

  it('renders notice status and links each item using its real notice ID', async () => {
    getNotices.mockResolvedValue({
      notices: [{
        id: '6b01404f8a2e97f35876c216',
        title: 'Water supply interruption',
        filename: 'water-supply.pdf',
        uploadedAt: '2026-11-20T08:30:00.000Z',
        extractionStatus: 'completed',
      }],
    });
    renderHistory();

    const noticeLink = await screen.findByRole('link', { name: /Water supply interruption/ });
    expect(noticeLink).toHaveAttribute('href', '/notices/6b01404f8a2e97f35876c216');
    expect(noticeLink).toHaveTextContent('water-supply.pdf');
    expect(noticeLink).toHaveTextContent('Text extraction: Complete');
    expect(noticeLink).toHaveTextContent(/Uploaded:.*2026/);
  });

  it('renders notice statuses and navigation labels in Telugu', async () => {
    localStorage.setItem('civicsignal.language', 'te-IN');
    authService.getCurrentUser.mockResolvedValue({
      id: 'user-1',
      email: 'citizen@example.test',
      languagePreference: 'te-IN',
    });
    getNotices.mockResolvedValue({
      notices: [{
        id: 'notice-telugu',
        title: 'ప్రజా నోటీసు',
        filename: 'notice.pdf',
        uploadedAt: '2026-11-20T08:30:00.000Z',
        extractionStatus: 'processing',
      }],
    });
    renderHistory();

    const noticeLink = await screen.findByRole('link', { name: /ప్రజా నోటీసు/ });
    expect(noticeLink).toHaveAttribute('href', '/notices/notice-telugu');
    expect(noticeLink).toHaveTextContent('పాఠ్య సేకరణ: ప్రాసెస్ అవుతోంది');
    expect(document.documentElement.lang).toBe('te-IN');
  });

  it('asks signed-out users to sign in', async () => {
    authService.getCurrentUser.mockRejectedValue(new Error('signed out'));
    renderHistory();

    expect(await screen.findByText('Sign in to view your uploaded notices.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(getNotices).not.toHaveBeenCalled();
  });
});
