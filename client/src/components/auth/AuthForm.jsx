import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeading from '../ui/PageHeading.jsx';
import { useAuth } from '../../app/AuthProvider.jsx';
import { useLanguage } from '../../app/LanguageProvider.jsx';

function errorKey(error) {
  switch (error?.response?.data?.error?.code) {
    case 'INVALID_CREDENTIALS': return 'authForms.invalidCredentials';
    case 'EMAIL_IN_USE': return 'authForms.emailInUse';
    case 'VALIDATION_ERROR': return 'authForms.validationError';
    case 'CSRF_REJECTED':
    case 'ORIGIN_REJECTED': return 'authForms.securityError';
    case 'RATE_LIMITED': return 'authForms.rateLimited';
    default: return 'authForms.requestFailed';
  }
}

export default function AuthForm({ mode }) {
  const isRegister = mode === 'register';
  const { t, language } = useLanguage();
  const { signIn, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (isRegister && password !== confirmPassword) {
      setError(t('authForms.passwordMismatch'));
      return;
    }

    setPending(true);
    try {
      const credentials = { email: email.trim(), password };
      if (isRegister) credentials.languagePreference = language;
      await (isRegister ? register(credentials) : signIn(credentials));
      navigate('/dashboard', { replace: true });
    } catch (requestError) {
      setError(t(errorKey(requestError)));
    } finally {
      setPending(false);
    }
  }

  return <>
    <PageHeading
      titleKey={isRegister ? 'auth.registerTitle' : 'auth.signInTitle'}
      descriptionKey={isRegister ? 'auth.registerDescription' : 'auth.signInDescription'}
    />
    <section className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="auth-email" className="mb-2 block text-sm font-medium">{t('authForms.emailLabel')}</label>
          <input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254}
            value={email} onChange={(event) => setEmail(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-forest" />
        </div>
        <div>
          <label htmlFor="auth-password" className="mb-2 block text-sm font-medium">{t('authForms.passwordLabel')}</label>
          <input id="auth-password" name="password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} required minLength={isRegister ? 10 : 1} maxLength={72}
            value={password} onChange={(event) => setPassword(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-forest" />
          {isRegister && <p className="mt-2 text-xs leading-5 text-muted">{t('authForms.passwordHint')}</p>}
        </div>
        {isRegister && <div>
          <label htmlFor="auth-confirm-password" className="mb-2 block text-sm font-medium">{t('authForms.confirmPasswordLabel')}</label>
          <input id="auth-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={10} maxLength={72}
            value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-forest" />
        </div>}
        {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={pending || !email || !password || (isRegister && !confirmPassword)}
          className="min-h-11 w-full rounded-xl bg-forest px-5 text-sm font-semibold text-white transition hover:bg-[#214f40] disabled:cursor-not-allowed disabled:opacity-55">
          {pending ? t('authForms.submitting') : t(isRegister ? 'authForms.registerAction' : 'authForms.signInAction')}
        </button>
      </form>
      <p className="mt-6 border-t border-line pt-5 text-center text-sm text-muted">
        {t(isRegister ? 'authForms.haveAccount' : 'authForms.needAccount')}{' '}
        <Link to={isRegister ? '/sign-in' : '/register'} className="font-semibold text-forest underline-offset-4 hover:underline">
          {t(isRegister ? 'authForms.signInLink' : 'authForms.registerLink')}
        </Link>
      </p>
    </section>
  </>;
}
