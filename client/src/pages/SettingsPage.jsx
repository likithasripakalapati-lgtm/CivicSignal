import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import PageHeading from '../components/ui/PageHeading.jsx';
import { getAreas } from '../services/areas.js';

function districtLabel(area, t) {
  const key = `areas.districts.${area.id}`;
  const translated = t(key);
  return translated === key ? area.name : translated;
}

export default function SettingsPage() {
  const { user, status: authStatus, updatePreferences } = useAuth();
  const { t } = useLanguage();
  const [areas, setAreas] = useState([]);
  const [selectedAreaIds, setSelectedAreaIds] = useState([]);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user || authStatus !== 'ready') return undefined;
    let active = true;
    setLoadingAreas(true);
    setErrorKey('');
    getAreas()
      .then((result) => {
        if (active) setAreas(result.areas);
      })
      .catch(() => {
        if (active) setErrorKey('settings.areasLoadFailed');
      })
      .finally(() => {
        if (active) setLoadingAreas(false);
      });
    return () => { active = false; };
  }, [user, authStatus]);

  useEffect(() => {
    setSelectedAreaIds(user?.selectedAreaIds ?? []);
  }, [user?.id, user?.selectedAreaIds?.join(',')]);

  function toggleArea(areaId) {
    setSaved(false);
    setSelectedAreaIds((current) => current.includes(areaId)
      ? current.filter((id) => id !== areaId)
      : current.length < 20 ? [...current, areaId] : current);
  }

  async function savePreferences() {
    if (saving || selectedAreaIds.length > 20) return;
    setSaving(true);
    setErrorKey('');
    setSaved(false);
    try {
      await updatePreferences({ selectedAreaIds });
      setSaved(true);
    } catch {
      setErrorKey('settings.areasSaveFailed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeading titleKey="settings.title" descriptionKey="settings.description" />
      {authStatus === 'loading' ? (
        <p role="status" className="text-sm text-muted">{t('settings.checkingAccount')}</p>
      ) : !user ? (
        <div className="rounded-2xl border border-line bg-white p-6 text-center">
          <p className="text-ink">{t('settings.signInRequired')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-forest px-4 py-2 font-semibold text-white" to="/sign-in">
            {t('settings.signInAction')}
          </Link>
        </div>
      ) : (
        <section className="max-w-3xl rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-ink">{t('settings.districtTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t('settings.districtDescription')}</p>
          </div>

          {loadingAreas ? (
            <p role="status" className="text-sm text-muted">{t('settings.loadingDistricts')}</p>
          ) : areas.length > 0 ? (
            <>
              <p className="mb-3 text-xs text-muted">{t('settings.selectedDistrictCount', { count: selectedAreaIds.length })}</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {areas.map((area) => (
                  <li key={area.id}>
                    <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-line px-3 py-2 hover:bg-soft">
                      <input
                        type="checkbox"
                        checked={selectedAreaIds.includes(area.id)}
                        onChange={() => toggleArea(area.id)}
                        disabled={!selectedAreaIds.includes(area.id) && selectedAreaIds.length >= 20}
                        className="size-4 accent-forest"
                      />
                      <span className="text-sm font-medium text-ink">{districtLabel(area, t)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : !loadingAreas && !errorKey ? (
            <p role="status" className="text-sm text-muted">{t('settings.noDistricts')}</p>
          ) : null}

          {errorKey && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t(errorKey)}</p>}
          {saved && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{t('settings.preferencesSaved')}</p>}

          <button
            type="button"
            onClick={savePreferences}
            disabled={loadingAreas || saving || areas.length === 0}
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-forest px-5 py-2 font-semibold text-white hover:bg-forest/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t('settings.savingPreferences') : t('settings.savePreferences')}
          </button>
        </section>
      )}
    </>
  );
}
