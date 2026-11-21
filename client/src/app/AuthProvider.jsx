import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authService from '../services/auth.js';
import { useLanguage } from './LanguageProvider.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { setLanguage } = useLanguage();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  const acceptUser = useCallback((nextUser) => {
    setUser(nextUser);
    setStatus('ready');
    if (nextUser?.languagePreference) setLanguage(nextUser.languagePreference);
  }, [setLanguage]);

  const refreshUser = useCallback(async () => {
    try {
      acceptUser(await authService.getCurrentUser());
    } catch {
      setUser(null);
      setStatus('ready');
    }
  }, [acceptUser]);

  useEffect(() => { void refreshUser(); }, [refreshUser]);

  const signIn = useCallback(async (credentials) => {
    const nextUser = await authService.signIn(credentials);
    acceptUser(nextUser);
    return nextUser;
  }, [acceptUser]);

  const register = useCallback(async (credentials) => {
    const nextUser = await authService.register(credentials);
    acceptUser(nextUser);
    return nextUser;
  }, [acceptUser]);

  const signOut = useCallback(async () => {
    await authService.signOut();
    setUser(null);
    setStatus('ready');
  }, []);

  const updatePreferences = useCallback(async (preferences) => {
    const nextUser = await authService.updatePreferences(preferences);
    acceptUser(nextUser);
    return nextUser;
  }, [acceptUser]);

  const value = useMemo(() => ({
    user, status, signIn, register, signOut, refreshUser, updatePreferences,
  }), [user, status, signIn, register, signOut, refreshUser, updatePreferences]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
