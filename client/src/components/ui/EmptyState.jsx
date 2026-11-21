import { Sparkles } from 'lucide-react';
import { useLanguage } from '../../app/LanguageProvider.jsx';

export default function EmptyState({ titleKey = 'empty.title', descriptionKey = 'empty.description' }) {
  const { t } = useLanguage();
  return <section className="rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center sm:px-10"><span className="mx-auto mb-4 grid size-11 place-items-center rounded-2xl bg-soft text-forest"><Sparkles size={19} /></span><h2 className="text-base font-semibold text-ink">{t(titleKey)}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{t(descriptionKey)}</p></section>;
}
