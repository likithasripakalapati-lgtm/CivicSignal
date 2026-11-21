import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../../app/AuthProvider.jsx';
import { LanguageProvider } from '../../app/LanguageProvider.jsx';
import AppLayout from './AppLayout.jsx';
import * as authService from '../../services/auth.js';

vi.mock('../../services/auth.js', () => ({
  getCurrentUser: vi.fn(), register: vi.fn(), signIn: vi.fn(), signOut: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue({ id: 'user-1', email: 'citizen@example.test', languagePreference: 'en-IN' });
  authService.signOut.mockResolvedValue(undefined);
});

describe('application sign-out control', () => {
  it('does not expose parameterized notice detail routes as navigation links', async () => {
    render(<LanguageProvider><AuthProvider><MemoryRouter initialEntries={['/dashboard']}>
      <Routes><Route element={<AppLayout />}><Route path="/dashboard" element={<p>Workspace content</p>} /></Route></Routes>
    </MemoryRouter></AuthProvider></LanguageProvider>);

    expect(await screen.findByRole('link', { name: 'Notice history' })).toHaveAttribute('href', '/history');
    expect(screen.queryByRole('link', { name: 'Notice details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '/notices/:noticeId' })).not.toBeInTheDocument();
  });

  it('clears authenticated session state after server sign-out succeeds', async () => {
    const user = userEvent.setup();
    render(<LanguageProvider><AuthProvider><MemoryRouter initialEntries={['/']}>
      <Routes><Route element={<AppLayout />}><Route path="/" element={<p>Workspace content</p>} /></Route></Routes>
    </MemoryRouter></AuthProvider></LanguageProvider>);

    const button = await screen.findByRole('button', { name: 'Sign out' });
    await user.click(button);
    expect(authService.signOut).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument());
    expect(screen.getByText('Workspace content')).toBeInTheDocument();
  });
});
