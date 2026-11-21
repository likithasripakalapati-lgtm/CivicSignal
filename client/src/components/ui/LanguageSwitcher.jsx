import { useLanguage } from '../../app/LanguageProvider.jsx';

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useLanguage();
  return <div className="inline-flex rounded-xl border border-line bg-white p-1" role="group" aria-label={t('layout.language')}>
    {[['en-IN', 'English'], ['te-IN', 'తెలుగు']].map(([locale, label]) => <button key={locale} type="button" onClick={() => setLanguage(locale)} aria-pressed={language === locale} className={`min-h-9 rounded-lg px-3 text-xs font-semibold transition ${language === locale ? 'bg-forest text-white shadow-sm' : 'text-muted hover:bg-soft hover:text-ink'}`}>{label}</button>)}
  </div>;
}
