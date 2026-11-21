import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import PageHeading from '../components/ui/PageHeading.jsx';
import {
  analyzeNotice,
  getNotice,
  getNoticeAnalysis,
  getNoticeText,
  retryNoticeProcessing,
  verifyNoticeSource,
} from '../services/notices.js';

function requestErrorKey(error) {
  if (error.response?.status === 401) return 'notice.signInRequired';
  if (error.response?.status === 404) return 'notice.notFound';
  return 'notice.loadFailed';
}

function sourceVerificationErrorKey(error) {
  const code = error.response?.data?.error?.code;
  const errorKeys = {
    SOURCE_URL_UNSUPPORTED: 'notice.sourceUrlUnsupported',
    VALIDATION_ERROR: 'notice.sourceInputInvalid',
    CSRF_REJECTED: 'notice.sourceSecurityError',
    RATE_LIMITED: 'notice.sourceRateLimited',
    AUTH_REQUIRED: 'notice.sourceSignInRequired',
    NOT_FOUND: 'notice.sourceNoticeNotFound',
  };
  return errorKeys[code] ?? 'notice.sourceCheckFailed';
}

export default function NoticeDetailsPage() {
  const { noticeId } = useParams();
  const { user, status: authStatus } = useAuth();
  const { t, locale } = useLanguage();
  const [record, setRecord] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [analysisStatus, setAnalysisStatus] = useState('pending');
  const [analysisError, setAnalysisError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bilingualLanguage, setBilingualLanguage] = useState('en-IN');
  const [candidateUrl, setCandidateUrl] = useState('');
  const [publicationDate, setPublicationDate] = useState('');
  const [checkingSource, setCheckingSource] = useState(false);
  const [sourceVerificationError, setSourceVerificationError] = useState('');

  useEffect(() => {
    if (!user || authStatus !== 'ready') return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const nextRecord = await getNotice(noticeId);
        if (!active) return;
        setRecord(nextRecord);
        setErrorKey('');
        if (nextRecord.processing?.status === 'completed') {
          setExtraction(await getNoticeText(noticeId));
        } else {
          setExtraction(null);
          if (['queued', 'processing'].includes(nextRecord.processing?.status)) {
            timer = setTimeout(poll, 2000);
          }
        }
      } catch (error) {
        if (active) setErrorKey(requestErrorKey(error));
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [noticeId, user, authStatus, refreshKey]);
    useEffect(() => {
    if (!extraction) return undefined;

    let active = true;

    getNoticeAnalysis(noticeId)
      .then((result) => {
        if (!active) return;
        setAnalysis(result.analysis);
        setAnalysisStatus(result.analysisStatus ?? 'idle');
        setAnalysisError(result.errorCode ?? '');
      })
      .catch(() => {
        if (active) setAnalysisError('LOAD_FAILED');
      });

    return () => {
      active = false;
    };
  }, [noticeId, extraction]);
    const runAnalysis = useCallback(async () => {
    if (analyzing || !extraction) return;

    setAnalyzing(true);
    setAnalysisError('');

    try {
      const result = await analyzeNotice(noticeId);
      setAnalysis(result.analysis);
      setAnalysisStatus(result.analysisStatus);
    } catch (error) {
      setAnalysisError(error.response?.data?.error?.code ?? 'ANALYSIS_FAILED');
      setAnalysisStatus('failed');
    } finally {
      setAnalyzing(false);
    }
  }, [noticeId, extraction, analyzing]);

  const retry = useCallback(async () => {
    if (retrying) return;
    setRetrying(true);
    setErrorKey('');
    try {
      await retryNoticeProcessing(noticeId);
      setRecord((current) => current ? { ...current, processing: { ...current.processing, status: 'queued', progress: 0, currentPage: 0 } } : current);
      setExtraction(null);
      setRefreshKey((value) => value + 1);
    } catch (error) {
      setErrorKey(error.response?.data?.error?.code === 'CSRF_REJECTED' ? 'notice.securityError' : 'notice.retryFailed');
    } finally {
      setRetrying(false);
    }
  }, [noticeId, retrying]);

  const checkSource = useCallback(async (event) => {
    event.preventDefault();
    if (checkingSource || !analysis || analysisStatus !== 'completed') return;

    setCheckingSource(true);
    setSourceVerificationError('');
    try {
      const result = await verifyNoticeSource(noticeId, { candidateUrl, publicationDate });
      if (!result?.sourceVerification?.status) {
        setSourceVerificationError('notice.sourceCheckFailed');
        return;
      }
      setRecord((current) => current ? {
        ...current,
        notice: { ...current.notice, sourceVerification: result.sourceVerification },
      } : current);
    } catch (error) {
      setSourceVerificationError(sourceVerificationErrorKey(error));
    } finally {
      setCheckingSource(false);
    }
  }, [analysis, analysisStatus, candidateUrl, checkingSource, noticeId, publicationDate]);

  const processing = record?.processing;
  const statusKey = `notice.status.${processing?.status ?? 'queued'}`;
  const sourceVerification = record?.notice?.sourceVerification ?? { status: 'not_checked' };
  const checkedAtDate = sourceVerification.checkedAt ? new Date(sourceVerification.checkedAt) : null;
  const checkedAt = checkedAtDate && !Number.isNaN(checkedAtDate.getTime())
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(checkedAtDate)
    : null;

  return (
    <>
      <PageHeading titleKey="notice.title" descriptionKey="notice.description" />
      {authStatus === 'loading' ? <p role="status" className="text-sm text-slate-600">{t('notice.loading')}</p> : !user ? (
        <div className="rounded-xl bg-slate-50 p-5 text-center">
          <p className="text-slate-700">{t('notice.signInRequired')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/sign-in">{t('upload.signInAction')}</Link>
        </div>
      ) : errorKey ? <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{t(errorKey)}</p> : !record ? (
        <p role="status" className="text-sm text-slate-600">{t('notice.loading')}</p>
      ) : (
        <div className="mx-auto max-w-4xl space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <h2 className="break-all text-xl font-semibold text-slate-950">{record.notice.filename}</h2>
                <p className="mt-2 text-sm text-slate-600">{t('notice.authenticityUnverified')}</p>
              </div>
              <a href={`/api/v1/notices/${encodeURIComponent(noticeId)}/document`} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                <Download aria-hidden="true" size={17} />{t('notice.downloadOriginal')}
              </a>
            </div>
            <Link
              to={`/assistant?noticeId=${encodeURIComponent(noticeId)}`}
              className="mt-4 inline-flex rounded-lg border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50"
            >
              {t('notice.askAssistant')}
            </Link>
          </section>

          <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm sm:p-7" aria-live="polite">
            <h2 className="text-xl font-semibold text-slate-950">{t('notice.sourceVerificationTitle')}</h2>
            <p className="mt-2 text-sm text-slate-600">{t('notice.sourceVerificationDescription')}</p>

            <div className={`mt-4 rounded-lg p-3 text-sm ${
              sourceVerification.status === 'match_found'
                ? 'bg-emerald-50 text-emerald-900'
                : sourceVerification.status === 'unavailable'
                  ? 'bg-amber-50 text-amber-900'
                  : sourceVerification.status === 'no_match'
                    ? 'bg-slate-100 text-slate-800'
                    : 'bg-slate-50 text-slate-700'
            }`} role="status" aria-live="polite">
              <p className="font-semibold">
                {checkingSource
                  ? t('notice.sourceChecking')
                  : t(`notice.sourceStatus.${sourceVerification.status ?? 'not_checked'}`)}
              </p>
              {sourceVerification.status === 'no_match' && <p className="mt-1">{t('notice.sourceNoMatchCaveat')}</p>}
              {sourceVerification.status === 'unavailable' && sourceVerification.reason && (
                <p className="mt-1">{t(`notice.sourceUnavailableReasons.${sourceVerification.reason}`)}</p>
              )}
            </div>

            {sourceVerification.sourceName && (
              <div className="mt-4 space-y-1 text-sm text-slate-700">
                <p><span className="font-semibold">{t('notice.sourceOrganization')}:</span> {sourceVerification.sourceOrganization || sourceVerification.sourceName}</p>
                {sourceVerification.publicationDate && (
                  <p><span className="font-semibold">{t('notice.sourcePublicationDate')}:</span> {sourceVerification.publicationDate}</p>
                )}
                {sourceVerification.sourceUrl && (
                  <p className="break-all">
                    <span className="font-semibold">{t('notice.sourcePublicationUrl')}:</span>{' '}
                    <a className="text-blue-700 underline" href={sourceVerification.sourceUrl} target="_blank" rel="noreferrer">
                      {sourceVerification.sourceName || t('notice.sourceOpenPublication')}
                    </a>
                  </p>
                )}
                {checkedAt && <p><span className="font-semibold">{t('notice.sourceLastChecked')}:</span> {checkedAt}</p>}
              </div>
            )}

            {sourceVerification.evidence?.length > 0 && (
              <div className="mt-4 space-y-3">
                <h3 className="font-semibold text-slate-900">{t('notice.sourceMatchEvidence')}</h3>
                {sourceVerification.evidence.map((item, index) => (
                  <article key={`${item.field}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <h4 className="text-sm font-semibold text-slate-900">{t(`notice.sourceFields.${item.field}`)}</h4>
                    {item.noticeEvidence && (
                      <p className="mt-2 text-sm text-slate-700">
                        <span className="font-semibold">{t('notice.sourceUploadedEvidence', { page: item.noticePageNumber })}:</span> {item.noticeEvidence}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-semibold">{t('notice.sourceOfficialEvidence', { page: item.sourcePageNumber })}:</span> {item.sourceEvidence}
                    </p>
                  </article>
                ))}
              </div>
            )}

            <form className="mt-5 space-y-3 border-t border-slate-100 pt-5" onSubmit={checkSource}>
              <h3 className="font-semibold text-slate-900">{t('notice.sourceCandidateTitle')}</h3>
              <p className="text-sm text-slate-600">{t('notice.sourceCandidateHelp')}</p>
              <div>
                <label htmlFor="source-candidate-url" className="mb-1 block text-sm font-medium text-slate-800">{t('notice.sourceUrlLabel')}</label>
                <input
                  id="source-candidate-url"
                  type="url"
                  required
                  maxLength={2048}
                  value={candidateUrl}
                  onChange={(event) => setCandidateUrl(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="https://apegazette.cgg.gov.in/uploadGazette_view?filePath=..."
                />
              </div>
              <div>
                <label htmlFor="source-publication-date" className="mb-1 block text-sm font-medium text-slate-800">{t('notice.sourceDateLabel')}</label>
                <input
                  id="source-publication-date"
                  type="text"
                  required
                  maxLength={80}
                  value={publicationDate}
                  onChange={(event) => setPublicationDate(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder={t('notice.sourceDatePlaceholder')}
                />
              </div>
              {(!analysis || analysisStatus !== 'completed') && (
                <p className="text-sm text-slate-600">{t('notice.sourceAnalysisRequired')}</p>
              )}
              {sourceVerificationError && <p role="alert" className="text-sm text-red-700">{t(sourceVerificationError)}</p>}
              <button
                type="submit"
                disabled={checkingSource || !analysis || analysisStatus !== 'completed'}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-60"
              >
                {checkingSource && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {checkingSource ? t('notice.sourceChecking') : t('notice.sourceCheckAction')}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-live="polite">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{t('notice.processingLabel')}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{t(statusKey)}</h2>
                {processing?.totalPages > 0 && <p className="mt-1 text-sm text-slate-600">{t('notice.pageProgress', { current: processing.currentPage, total: processing.totalPages })}</p>}
              </div>
              {processing?.status === 'failed' && processing.canRetry && <button type="button" onClick={retry} disabled={retrying} className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60">
                {retrying ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                {retrying ? t('notice.retrying') : t('notice.retryAction')}
              </button>}
            </div>
            {['queued', 'processing'].includes(processing?.status) && <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-600"><span>{t('notice.progressLabel')}</span><span>{processing?.progress ?? 0}%</span></div>
              <progress aria-label={t('notice.progressLabel')} className="h-2 w-full accent-blue-700" max="100" value={processing?.progress ?? 0} />
            </div>}
            {processing?.status === 'failed' && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('notice.processingFailed')}</p>}
          </section>
          {extraction && processing?.status === 'completed' && (
  <section className="rounded-2xl border border-blue-200 bg-white p-5 shadow-sm sm:p-7">
    <h2 className="text-xl font-semibold text-slate-950">
      {t('notice.analysisTitle')}
    </h2>

    <p className="mt-2 text-sm text-slate-600">
      {t('notice.analysisDescription')}
    </p>

    {!analysis || analysisStatus !== 'completed' ? (
      <div className="mt-4">
        <button
          type="button"
          onClick={runAnalysis}
          disabled={analyzing}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
        >
          {analyzing && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {analyzing ? t('notice.analyzing') : t('notice.analyzeAction')}
        </button>

        {analysisError && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {t('notice.analysisFailed')}
          </p>
        )}
      </div>
    ) : (
      <div className="mt-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-blue-900">{t('notice.bilingualLabel')}</p>
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1" aria-label={t('notice.bilingualLanguage')}>
            <button type="button" aria-pressed={bilingualLanguage === 'en-IN'} onClick={() => setBilingualLanguage('en-IN')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${bilingualLanguage === 'en-IN' ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              {t('notice.languageEnglish')}
            </button>
            <button type="button" aria-pressed={bilingualLanguage === 'te-IN'} onClick={() => setBilingualLanguage('te-IN')} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${bilingualLanguage === 'te-IN' ? 'bg-blue-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              {t('notice.languageTelugu')}
            </button>
          </div>
        </div>

        {analysis.simpleExplanation?.sections?.length ? (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
            <h3 className="font-semibold text-slate-950">{t('notice.simpleExplanationTitle')}</h3>
            <p className="mt-1 text-xs text-slate-600">{t('notice.aiGeneratedLabel')}</p>
            <div className="mt-3 space-y-4">
              {analysis.simpleExplanation.sections.map((section, index) => (
                <article key={`explanation-${index}`} className="rounded-lg bg-white p-4">
                  <p className="text-sm leading-7 text-slate-800">
                    {bilingualLanguage === 'te-IN' ? section.telugu : section.english}
                  </p>
                  {section.evidence?.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      {section.evidence.map((fact, factIndex) => (
                        <p key={`explanation-evidence-${factIndex}`} className="text-xs text-slate-500">
                          {fact.evidence} — {t('notice.pageLabel', { page: fact.pageNumber })}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>
        ) : (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t('notice.simpleExplanationMissing')}
          </p>
        )}

        {analysis.translatedPages?.length ? (
          <section className="space-y-3">
            <div>
              <h3 className="font-semibold text-slate-950">{t('notice.translatedContentTitle')}</h3>
              <p className="mt-1 text-xs text-slate-600">{t('notice.aiTranslatedLabel')}</p>
            </div>
            {analysis.translatedPages.map((page) => (
              <article key={`translated-${page.pageNumber}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="font-semibold text-slate-900">{t('notice.pageLabel', { page: page.pageNumber })}</h4>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">
                  {bilingualLanguage === 'te-IN' ? page.teluguText : page.englishText}
                </p>
              </article>
            ))}
          </section>
        ) : (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {t('notice.translationsMissing')}
          </p>
        )}

        {[
          ['notice.analysisCategory', analysis.documentCategory],
          ['notice.analysisNoticeTitle', analysis.title],
          ['notice.analysisDepartment', analysis.issuingDepartment],
          ['notice.analysisDate', analysis.noticeDate],
        ].map(([label, fact]) => fact && (
          <div key={label}>
            <h3 className="font-semibold text-slate-900">{t(label)}</h3>
            <p className="mt-1 text-sm text-slate-700">
  {label === 'notice.analysisCategory'
    ? t(`notice.categoryValues.${fact.value}`)
    : fact.value}
</p>
            <p className="mt-1 text-xs text-slate-500">
              {fact.evidence} — {t('notice.pageLabel', { page: fact.pageNumber })}
            </p>
          </div>
        ))}

        {['importantDates', 'locations', 'citizenInstructions', 'referenceNumbers'].map((key) => (
          analysis[key]?.length > 0 && (
            <div key={key}>
              <h3 className="font-semibold text-slate-900">
                {t(`notice.analysis.${key}`)}
              </h3>
              <ul className="mt-2 space-y-3">
                {analysis[key].map((fact, index) => (
                  <li key={`${key}-${index}`} className="rounded-lg bg-slate-50 p-3">
                    <p className="text-sm text-slate-800">{fact.value}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {fact.evidence} — {t('notice.pageLabel', { page: fact.pageNumber })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )
        ))}
      </div>
    )}
  </section>
)}

          {extraction && processing?.status === 'completed' && <section className="space-y-4">
            <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
              <h2 className="text-xl font-semibold text-slate-950">{t('notice.extractedText')}</h2>
              <p className="text-sm text-slate-600">{t(`notice.method.${extraction.extractionMethod}`)}</p>
            </div>
            {extraction.pages.map((page) => <article key={page.pageNumber} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <h3 className="font-semibold text-slate-900">{t('notice.pageLabel', { page: page.pageNumber })}</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{t(`notice.method.${page.method}`)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-800">{page.text || t('notice.noText')}</p>
            </article>)}
          </section>}
        </div>
      )}
    </>
  );
}
