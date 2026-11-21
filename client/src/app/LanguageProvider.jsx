import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from '../i18n/en-IN.json';
import te from '../i18n/te-IN.json';

const dictionaries = { 'en-IN': en, 'te-IN': te };
const LanguageContext = createContext(null);
const STORAGE_KEY = 'civicsignal.language';

function getInitialLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'te-IN' ? 'te-IN' : 'en-IN';
  } catch {
    return 'en-IN';
  }
}

function getValue(dictionary, key) {
  return key.split('.').reduce((value, part) => value?.[part], dictionary);
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage);
  const setLanguage = useCallback((nextLanguage) => {
    if (!Object.hasOwn(dictionaries, nextLanguage)) return;
    setLanguageState(nextLanguage);
    try {
      localStorage.setItem(STORAGE_KEY, nextLanguage);
    } catch {
      // The selected language still applies for this session if storage is unavailable.
    }
    document.documentElement.lang = nextLanguage;
  }, []);
  const t = useCallback((key, values) => {
    const value = getValue(dictionaries[language], key) ?? key;
    if (typeof value !== 'string' || !values) return value;
    return value.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t, locale: language }), [language, setLanguage, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
