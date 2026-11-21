import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileUp, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import { uploadNotice } from '../services/notices.js';
import PageHeading from '../components/ui/PageHeading.jsx';

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export default function UploadPage() {
  const { user, status } = useAuth();
  const { t } = useLanguage();
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [result, setResult] = useState(null);

  function selectFile(event) {
    const selected = event.target.files?.[0] ?? null;
    setResult(null);
    setErrorKey('');
    setProgress(0);
    if (selected && selected.size > MAX_SIZE_BYTES) {
      setFile(null);
      setErrorKey('upload.fileTooLarge');
      event.target.value = '';
      return;
    }
    setFile(selected);
  }

  async function submit(event) {
    event.preventDefault();
    if (!file || submitting) return;
    const formElement = event.currentTarget;
    setSubmitting(true);
    setErrorKey('');
    setResult(null);
    setProgress(0);
    try {
      setResult(await uploadNotice(file, setProgress));
      setProgress(100);
      setFile(null);
      formElement.reset();
    } catch (error) {
      const code = error.response?.data?.error?.code;
      setErrorKey(code === 'CSRF_REJECTED' || code === 'ORIGIN_REJECTED'
        ? 'upload.securityError'
        : error.response?.status === 401 ? 'upload.authRequired'
        : code === 'FILE_TOO_LARGE' ? 'upload.fileTooLarge'
          : ['INVALID_PDF', 'INVALID_IMAGE', 'UNSUPPORTED_FILE', 'PDF_PAGE_LIMIT', 'IMAGE_DIMENSION_LIMIT', 'EMPTY_FILE'].includes(code)
            ? 'upload.invalidFile' : 'upload.failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeading titleKey="upload.title" descriptionKey="upload.description" />
      <section className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        {status === 'loading' ? <p className="text-sm text-slate-600" role="status">{t('upload.checkingAccount')}</p> : !user ? (
          <div className="rounded-xl bg-slate-50 p-5 text-center">
            <p className="text-slate-700">{t('upload.signInRequired')}</p>
            <Link className="mt-4 inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800" to="/sign-in">{t('upload.signInAction')}</Link>
          </div>
        ) : result ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status">
            <h2 className="text-lg font-semibold text-emerald-900">{t('upload.successTitle')}</h2>
            <p className="mt-2 break-all text-sm text-emerald-900">{result.notice.filename}</p>
            <p className="mt-2 text-sm text-emerald-800">{t('upload.queuedMessage')}</p>
            <Link to={`/notices/${encodeURIComponent(result.notice.id)}`} className="mt-4 inline-flex rounded-lg bg-emerald-800 px-4 py-2 font-semibold text-white hover:bg-emerald-900">{t('upload.viewNotice')}</Link>
            <button className="mt-5 rounded-lg border border-emerald-700 px-4 py-2 font-semibold text-emerald-900 hover:bg-emerald-100" onClick={() => { setResult(null); setProgress(0); }}>{t('upload.uploadAnother')}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-6">
            <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 sm:p-8">
              <label htmlFor="notice-document" className="flex cursor-pointer flex-col items-center text-center">
                <FileUp aria-hidden="true" className="mb-3 h-9 w-9 text-blue-700" />
                <span className="font-semibold text-slate-900">{t('upload.chooseFile')}</span>
                <span className="mt-2 text-sm text-slate-600">{t('upload.fileTypes')}</span>
                <span className="mt-1 text-xs text-slate-500">{t('upload.sizeLimit')}</span>
              </label>
              <input id="notice-document" aria-label={t('upload.chooseFile')} className="sr-only" type="file" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" onChange={selectFile} disabled={submitting} />
              {file && <p className="mt-4 break-all text-center text-sm font-medium text-slate-700">{file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB</p>}
            </div>

            {errorKey && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{t(errorKey)}</p>}

            {submitting && <div aria-label={t('upload.progressLabel')}>
              <div className="mb-2 flex justify-between text-sm text-slate-600"><span>{t('upload.uploading')}</span><span>{progress}%</span></div>
              <progress className="h-2 w-full accent-blue-700" max="100" value={progress} />
            </div>}

            <div className="flex items-start gap-3 rounded-lg bg-blue-50 p-4 text-sm text-blue-950">
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
              <p>{t('upload.privacyNote')}</p>
            </div>

            <button type="submit" disabled={!file || submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400 sm:w-auto">
              {submitting && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
              {submitting ? t('upload.uploading') : t('upload.submitAction')}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
