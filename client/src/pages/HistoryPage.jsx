import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import PageHeading from '../components/ui/PageHeading.jsx';
import { getNotices } from '../services/notices.js';

const extractionStatuses = new Set(['queued', 'processing', 'completed', 'failed']);

function historyErrorKey(error) {
  if (error.response?.status === 401) return 'history.signInRequired';
  return 'history.loadFailed';
}

function formatUploadDate(value, locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? '');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export default function HistoryPage() {
  const { user, status: authStatus } = useAuth();
  const { t, locale } = useLanguage();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState('');

  useEffect(() => {
    if (authStatus === 'loading') return undefined;
    if (!user) {
      setLoading(false);
      setNotices([]);
      return undefined;
    }

    let active = true;
    setLoading(true);
    setErrorKey('');
    getNotices()
      .then((result) => {
        if (!Array.isArray(result.notices)) throw new Error('Notice list response is invalid.');
        if (active) setNotices(result.notices);
      })
      .catch((error) => {
        if (active) {
          setNotices([]);
          setErrorKey(historyErrorKey(error));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [authStatus, user]);

  return (
    <>
      <PageHeading titleKey="history.title" descriptionKey="history.description" />
      {authStatus === 'loading' || loading ? (
        <p role="status" className="text-sm text-slate-600">{t('history.loading')}</p>
      ) : !user ? (
        <div className="rounded-xl bg-slate-50 p-5 text-center">
          <p className="text-slate-700">{t('history.signInRequired')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/sign-in">
            {t('history.signInAction')}
          </Link>
        </div>
      ) : errorKey ? (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{t(errorKey)}</p>
      ) : notices.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <h2 className="text-base font-semibold text-slate-900">{t('history.emptyTitle')}</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">{t('history.emptyDescription')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/notices/upload">
            {t('history.uploadAction')}
          </Link>
        </section>
      ) : (
        <ul className="space-y-3">
          {notices.map((notice) => (
            <li key={notice.id}>
              <Link
                to={`/notices/${encodeURIComponent(notice.id)}`}
                className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:bg-slate-50"
              >
                <h2 className="break-words font-semibold text-slate-950">{notice.title}</h2>
                <p className="mt-1 break-all text-sm text-slate-600">{notice.filename}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                  <p>{t('history.uploadedAt')}: {formatUploadDate(notice.uploadedAt, locale)}</p>
                  <p>{t('history.extractionStatus')}: {t(`history.status.${extractionStatuses.has(notice.extractionStatus) ? notice.extractionStatus : 'unknown'}`)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
