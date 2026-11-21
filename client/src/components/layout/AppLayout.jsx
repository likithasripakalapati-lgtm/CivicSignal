import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { LogOut, Menu, X } from 'lucide-react';
import { useLanguage } from '../../app/LanguageProvider.jsx';
import { useAuth } from '../../app/AuthProvider.jsx';
import LanguageSwitcher from '../ui/LanguageSwitcher.jsx';
import SidebarNavigation from './SidebarNavigation.jsx';

export default function AppLayout() {
  const { t } = useLanguage();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutFailed(false);
    try { await signOut(); }
    catch { setSignOutFailed(true); }
    finally { setSigningOut(false); }
  }
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-4 sm:px-6 lg:px-10">
          <a href="/" className="flex items-center gap-3" aria-label={t('brand.name')}>
            <span className="grid size-10 place-items-center rounded-2xl bg-forest text-white"><span className="size-3 rounded-full bg-lime" /></span>
            <span><span className="block text-[17px] font-bold tracking-tight">{t('brand.name')}</span><span className="hidden text-[10px] font-semibold uppercase tracking-[.18em] text-muted sm:block">{t('brand.label')}</span></span>
          </a>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex"><span className="text-xs text-muted">{t('layout.language')}</span><LanguageSwitcher /></div>
            {user && <button type="button" onClick={handleSignOut} disabled={signingOut} aria-label={t('layout.signOut')} className="flex size-10 items-center justify-center gap-2 rounded-xl border border-line px-2 text-sm font-medium text-muted hover:bg-soft disabled:opacity-60 sm:w-auto sm:px-3">
              <LogOut size={17} aria-hidden="true" /><span className="hidden sm:inline">{signingOut ? t('layout.signingOut') : t('layout.signOut')}</span>
            </button>}
          </div>
          <button className="grid size-10 place-items-center rounded-xl border border-line md:hidden" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? t('layout.closeMenu') : t('layout.openMenu')} aria-expanded={menuOpen}>
            {menuOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </header>
      {signOutFailed && <p role="alert" className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-sm text-red-800">{t('layout.signOutFailed')}</p>}
      <div className="mx-auto grid max-w-[1440px] md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-72px)] border-r border-line bg-white md:block"><SidebarNavigation /></aside>
        {menuOpen && <div className="fixed inset-x-0 top-[72px] z-20 max-h-[calc(100vh-72px)] overflow-y-auto border-b border-line bg-white shadow-xl md:hidden"><SidebarNavigation onNavigate={() => setMenuOpen(false)} /><div className="border-t border-line px-5 py-4"><p className="mb-2 text-xs text-muted">{t('layout.language')}</p><LanguageSwitcher /></div></div>}
        <main className="min-w-0 px-4 py-7 sm:px-6 sm:py-9 lg:px-10 lg:py-11"><Outlet /></main>
      </div>
      <footer className="border-t border-line bg-white px-4 py-5 text-center text-xs text-muted">{t('footer.disclaimer')}</footer>
    </div>
  );
}
