import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthForm from './AuthForm.jsx';
import { AuthProvider } from '../../app/AuthProvider.jsx';
import { LanguageProvider } from '../../app/LanguageProvider.jsx';
import * as authService from '../../services/auth.js';

vi.mock('../../services/auth.js', () => ({
  getCurrentUser: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
}));

const createdUser = { id: 'user-1', email: 'person@example.test', languagePreference: 'en-IN' };

function renderForm(mode) {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[mode === 'register' ? '/register' : '/sign-in']}>
          <Routes>
            <Route path="/register" element={<AuthForm mode="register" />} />
            <Route path="/sign-in" element={<AuthForm mode="sign-in" />} />
            <Route path="/dashboard" element={<h1>Dashboard opened</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue(null);
  authService.register.mockResolvedValue(createdUser);
  authService.signIn.mockResolvedValue(createdUser);
});

describe('bilingual authentication forms', () => {
  it('submits sign-in credentials through the existing auth service', async () => {
    const user = userEvent.setup();
    renderForm('sign-in');

    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'a strong test pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(authService.signIn).toHaveBeenCalledWith({ email: 'person@example.test', password: 'a strong test pass' });
    expect(await screen.findByRole('heading', { name: 'Dashboard opened' })).toBeInTheDocument();
  });

  it('registers using the selected Telugu locale and renders Telugu labels', async () => {
    localStorage.setItem('civicsignal.language', 'te-IN');
    const user = userEvent.setup();
    renderForm('register');

    expect(screen.getByLabelText('ఇమెయిల్ చిరునామా')).toBeInTheDocument();
    await user.type(screen.getByLabelText('ఇమెయిల్ చిరునామా'), 'person@example.test');
    await user.type(screen.getByLabelText('పాస్‌వర్డ్'), 'a strong test pass');
    await user.type(screen.getByLabelText('పాస్‌వర్డ్‌ను మళ్లీ నమోదు చేయండి'), 'a strong test pass');
    await user.click(screen.getByRole('button', { name: 'ఖాతా సృష్టించండి' }));

    expect(authService.register).toHaveBeenCalledWith({
      email: 'person@example.test', password: 'a strong test pass', languagePreference: 'te-IN',
    });
    expect(await screen.findByRole('heading', { name: 'Dashboard opened' })).toBeInTheDocument();
  });

  it('shows a bilingual validation message when confirmation does not match', async () => {
    const user = userEvent.setup();
    renderForm('register');

    await user.type(screen.getByLabelText('Email address'), 'person@example.test');
    await user.type(screen.getByLabelText('Password'), 'a strong test pass');
    await user.type(screen.getByLabelText('Confirm password'), 'a different test pass');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.');
    expect(authService.register).not.toHaveBeenCalled();
  });
});
