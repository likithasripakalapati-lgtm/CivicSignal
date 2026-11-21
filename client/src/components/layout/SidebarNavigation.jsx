import { NavLink } from 'react-router-dom';
import { primaryNavigation } from '../../app/pageDefinitions.js';
import { useLanguage } from '../../app/LanguageProvider.jsx';

export default function SidebarNavigation({ onNavigate }) {
  const { t } = useLanguage();
  return <nav aria-label={t('layout.primaryNavigation')} className="p-4 sm:p-5 md:sticky md:top-[72px]">
    <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-muted">{t('layout.workspace')}</p>
    <div className="space-y-1">{primaryNavigation.map(({ path, key, icon: Icon }) => <NavLink key={path} to={path} onClick={onNavigate} className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-forest text-white' : 'text-muted hover:bg-soft hover:text-ink'}`}><Icon size={17} strokeWidth={1.8} /><span>{t(key)}</span></NavLink>)}</div>
  </nav>;
}
