import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import UploadPage from './UploadPage.jsx';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import * as authService from '../services/auth.js';
import * as noticeService from '../services/notices.js';
import te from '../i18n/te-IN.json';

vi.mock('../services/auth.js', () => ({
  getCurrentUser: vi.fn(),
  refreshCsrfToken: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
}));
vi.mock('../services/notices.js', () => ({ uploadNotice: vi.fn() }));

function renderUpload() {
  return render(<LanguageProvider><AuthProvider><MemoryRouter><UploadPage /></MemoryRouter></AuthProvider></LanguageProvider>);
}

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue({ id: 'citizen-1', email: 'citizen@example.test', languagePreference: 'en-IN' });
  noticeService.uploadNotice.mockResolvedValue({ notice: { id: 'notice-1', filename: 'notice.png' }, processing: { status: 'queued', progress: 0 } });
});

describe('bilingual notice upload form', () => {
  it('submits a selected file and shows its queued receipt', async () => {
    const user = userEvent.setup();
    renderUpload();
    const file = new File(['image'], 'notice.png', { type: 'image/png' });
    await user.upload(await screen.findByLabelText('Choose a PDF, JPG, or PNG file'), file);
    await user.click(screen.getByRole('button', { name: 'Upload document' }));

    expect(noticeService.uploadNotice).toHaveBeenCalledWith(file, expect.any(Function));
    expect(await screen.findByRole('heading', { name: 'Document received' })).toBeInTheDocument();
    expect(screen.getByText('The original file is stored securely and queued for processing. Extraction is not available yet.')).toBeInTheDocument();
  });

  it('renders the upload controls in Telugu when that language is saved', async () => {
    localStorage.setItem('civicsignal.language', 'te-IN');
    authService.getCurrentUser.mockResolvedValue({ id: 'citizen-1', email: 'citizen@example.test', languagePreference: 'te-IN' });
    renderUpload();
    expect(await screen.findByLabelText(te.upload.chooseFile)).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('te-IN');
  });

  it('asks signed-out visitors to sign in before they can upload', async () => {
    authService.getCurrentUser.mockResolvedValue(null);
    renderUpload();
    expect(await screen.findByText('Sign in to upload a document.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
  });
});
