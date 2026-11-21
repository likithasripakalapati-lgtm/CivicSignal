import { ArrowRight, Globe2, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '../app/LanguageProvider.jsx';

const principles = [
  { icon: Sparkles, title: 'landing.principleClarity', body: 'landing.principleClarityText' },
  { icon: Globe2, title: 'landing.principleLocal', body: 'landing.principleLocalText' },
  { icon: ShieldCheck, title: 'landing.principleEvidence', body: 'landing.principleEvidenceText' },
];

export default function LandingPage() {
  const { t } = useLanguage();
  return <div className="space-y-10 sm:space-y-14">
    <section className="relative overflow-hidden rounded-[28px] bg-forest px-6 py-10 text-white sm:px-10 sm:py-14 lg:px-14 lg:py-16"><div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full border border-white/10 sm:size-96" /><div className="pointer-events-none absolute -right-2 top-8 size-52 rounded-full border border-white/10 sm:size-72" /><div className="relative max-w-3xl"><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/80"><span className="size-1.5 rounded-full bg-lime" />{t('landing.eyebrow')}</p><h1 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">{t('landing.headline')}</h1><p className="mt-6 max-w-xl text-sm leading-7 text-white/70 sm:text-base">{t('landing.description')}</p><div className="mt-8 flex flex-wrap gap-3"><Link to="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-lime px-5 text-sm font-semibold text-forest hover:bg-[#d1e98d]">{t('landing.openDashboard')}<ArrowRight size={16} /></Link><Link to="/sign-in" className="inline-flex min-h-11 items-center rounded-xl border border-white/25 px-5 text-sm font-semibold text-white hover:bg-white/10">{t('nav.signIn')}</Link></div><p className="mt-6 text-sm text-white/65">{t('landing.teluguTagline')}</p></div></section>
    <section><div className="mb-5"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-forest">{t('landing.principlesEyebrow')}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">{t('landing.principlesTitle')}</h2></div><div className="grid gap-4 md:grid-cols-3">{principles.map(({ icon: Icon, title, body }) => <article key={title} className="rounded-2xl border border-line bg-white p-5 sm:p-6"><span className="grid size-10 place-items-center rounded-xl bg-soft text-forest"><Icon size={19} /></span><h3 className="mt-5 text-base font-semibold">{t(title)}</h3><p className="mt-2 text-sm leading-6 text-muted">{t(body)}</p></article>)}</div></section>
    <section className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><h2 className="font-semibold">{t('landing.phaseTitle')}</h2><p className="mt-1 text-sm text-muted">{t('landing.phaseDescription')}</p></div><span className="w-fit rounded-full bg-soft px-3 py-1.5 text-xs font-semibold text-forest">{t('landing.phaseBadge')}</span></section>
  </div>;
}
