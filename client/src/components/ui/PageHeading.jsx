import { useLanguage } from '../../app/LanguageProvider.jsx';

export default function PageHeading({ titleKey, descriptionKey, eyebrowKey = 'layout.civicSignal' }) {
  const { t } = useLanguage();
  return <div className="mb-8 max-w-3xl"><p className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-forest">{t(eyebrowKey)}</p><h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{t(titleKey)}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted sm:text-base">{t(descriptionKey)}</p></div>;
}
