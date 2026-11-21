import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import PageHeading from '../components/ui/PageHeading.jsx';
import { getAreaImpact, getAreas } from '../services/areas.js';
import { groupImpactNotices } from './impactMapPresentation.js';

function districtLabel(area, t) {
  const key = `areas.districts.${area.id}`;
  const translated = t(key);
  return translated === key ? area.name : translated;
}

export default function ImpactMapPage() {
  const { user, status: authStatus } = useAuth();
  const { t } = useLanguage();
  const [areasWithImpact, setAreasWithImpact] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const selectedIds = user?.selectedAreaIds ?? [];
  const selectedKey = selectedIds.join(',');

  useEffect(() => {
    if (!user || authStatus !== 'ready' || selectedIds.length === 0) {
      setAreasWithImpact([]);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(false);
    getAreas()
      .then(async ({ areas }) => Promise.all(
        areas.filter((area) => selectedIds.includes(area.id)).map(async (area) => ({
          area,
          impact: await getAreaImpact(area.id),
        })),
      ))
      .then((result) => {
        if (active) setAreasWithImpact(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [user, authStatus, selectedKey]);

  return (
    <>
      <PageHeading titleKey="map.title" descriptionKey="map.description" />
      {authStatus === 'loading' ? (
        <p role="status" className="text-sm text-muted">{t('map.checkingAccount')}</p>
      ) : !user ? (
        <div className="rounded-2xl border border-line bg-white p-6 text-center">
          <p className="text-ink">{t('map.signInRequired')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-forest px-4 py-2 font-semibold text-white" to="/sign-in">
            {t('map.signInAction')}
          </Link>
        </div>
      ) : selectedIds.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-6">
          <p className="text-ink">{t('map.noSelectedDistricts')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-forest px-4 py-2 font-semibold text-white" to="/settings">
            {t('map.chooseDistricts')}
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
            {t('map.noVerifiedBoundaryNotice')}
          </p>
          {loading && <p role="status" className="text-sm text-muted">{t('map.loadingImpact')}</p>}
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('map.loadFailed')}</p>}
          {!loading && !error && areasWithImpact.map(({ area, impact }) => (
            <section key={area.id} className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7">
              <h2 className="text-xl font-semibold text-ink">{districtLabel(area, t)}</h2>
              {impact.notices.length === 0 ? (
                <p className="mt-3 text-sm text-muted">{t('map.noNoticeRecords')}</p>
              ) : (
                <ul className="mt-4 space-y-4">
                  {groupImpactNotices(impact.notices, area.id).map((notice, index) => (
                    <li
                      key={notice.noticeId
                        ? JSON.stringify([notice.districtId, notice.noticeId])
                        : `notice-${index}`}
                      className="rounded-xl border border-line bg-canvas p-4"
                    >
                      <h3 className="break-all font-semibold text-ink">{notice.filename}</h3>
                      {notice.noticeId && (
                        <p className="mt-1 text-xs text-muted" title={notice.noticeId}>
                          {t('map.noticeReference', { id: notice.noticeId.slice(-8) })}
                        </p>
                      )}
                      {notice.impactStatuses.includes('district_mentioned') && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-emerald-900">{t('map.districtMentioned')}</p>
                          <p className="mt-1 text-xs text-muted">{t('map.mentionIsNotImpact')}</p>
                          {notice.matches.map((match, index) => (
                            <blockquote key={`match-${index}`} className="mt-3 border-l-2 border-emerald-600 pl-3 text-sm leading-6 text-ink">
                              {match.evidence || t('map.evidenceUnavailable')}
                              {match.pageNumbers.map((pageNumber) => (
                                <span key={pageNumber} className="mt-1 block text-xs text-muted">
                                  {t('map.pageReference', { page: pageNumber })}
                                </span>
                              ))}
                            </blockquote>
                          ))}
                        </div>
                      )}
                      {notice.impactStatuses.includes('unresolved') && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-amber-900">{t('map.unresolved')}</p>
                          {notice.unresolvedLocations.map((item, index) => (
                            <blockquote key={`unresolved-${index}`} className="mt-3 border-l-2 border-amber-500 pl-3 text-sm leading-6 text-ink">
                              {item.evidence || t('map.evidenceUnavailable')}
                              {item.pageNumbers.map((pageNumber) => (
                                <span key={pageNumber} className="mt-1 block text-xs text-muted">
                                  {t('map.pageReference', { page: pageNumber })}
                                </span>
                              ))}
                            </blockquote>
                          ))}
                        </div>
                      )}
                      {notice.impactStatuses.includes('not_explicitly_listed') && (
                        <p className="mt-3 text-sm leading-6 text-muted">{t('map.notListedCaveat')}</p>
                      )}
                      {notice.impactStatuses.includes('unknown') && (
                        <p className="mt-3 text-sm leading-6 text-muted">{t('map.analysisUnavailable')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
