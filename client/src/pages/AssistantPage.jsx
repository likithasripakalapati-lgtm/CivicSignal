
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../app/AuthProvider.jsx';
import { useLanguage } from '../app/LanguageProvider.jsx';
import { askAssistant } from '../services/assistant.js';
import {
  createLocalSpeechRecognizer,
  createBrowserSpeechUtterance,
  getBrowserVoiceCapabilities,
} from '../services/browserVoice.js';
import {
  createLocalTeluguSpeaker,
  getLocalTeluguTtsCapabilities,
} from '../services/localTeluguTts.js';

function assistantErrorKey(error) {
  const code = error.response?.data?.error?.code;
  const errorKeys = {
    AUTH_REQUIRED: 'assistant.signInRequired',
    CSRF_REJECTED: 'assistant.securityError',
    ORIGIN_REJECTED: 'assistant.securityError',
    EXTRACTION_FAILED: 'assistant.extractionFailed',
    EXTRACTION_UNAVAILABLE: 'assistant.extractionUnavailable',
    PROCESSING_INCOMPLETE: 'assistant.processingIncomplete',
    NO_READABLE_NOTICES: 'assistant.noNotices',
    TOO_MANY_NOTICES: 'assistant.tooManyNotices',
    SOURCE_TEXT_TOO_LARGE: 'assistant.sourceTextTooLarge',
    GEMINI_RATE_LIMITED: 'assistant.rateLimited',
    RATE_LIMITED: 'assistant.rateLimited',
    GEMINI_UNAVAILABLE: 'assistant.unavailable',
    GEMINI_NOT_CONFIGURED: 'assistant.unavailable',
    GEMINI_REQUEST_FAILED: 'assistant.unavailable',
  };
  if (error.response?.status === 404) return 'assistant.noticeNotFound';
  return errorKeys[code] ?? 'assistant.requestFailed';
}

export default function AssistantPage() {
  const [searchParams] = useSearchParams();
  const noticeId = searchParams.get('noticeId') ?? '';
  const { user, status: authStatus } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const [mode, setMode] = useState(noticeId ? 'current' : 'all');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [voiceErrorKey, setVoiceErrorKey] = useState('');
  const [voiceErrorCode, setVoiceErrorCode] = useState('');
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceProgress, setVoiceProgress] = useState(null);
  const [teluguTtsStatus, setTeluguTtsStatus] = useState('');
  const [teluguTtsProgress, setTeluguTtsProgress] = useState(null);
  const voiceRecognizerRef = useRef(null);
  const teluguSpeakerRef = useRef(null);
  const assistantLanguage = language === 'te-IN' ? 'te' : 'en';
  const voiceCapabilities = getBrowserVoiceCapabilities();
  const teluguTtsAvailable = getLocalTeluguTtsCapabilities();

  useEffect(() => () => {
    voiceRecognizerRef.current?.dispose();
    voiceRecognizerRef.current = null;
    teluguSpeakerRef.current?.dispose();
    teluguSpeakerRef.current = null;
    window.speechSynthesis?.cancel();
  }, []);

  function setLocalVoiceError(error) {
    setListening(false);
    setVoiceStatus('');
    setVoiceProgress(null);
    const errorKeys = {
      NotAllowedError: 'assistant.microphoneDenied',
      PermissionDeniedError: 'assistant.microphoneDenied',
      'microphone-denied': 'assistant.microphoneDenied',
      NotFoundError: 'assistant.microphoneUnavailable',
      DevicesNotFoundError: 'assistant.microphoneUnavailable',
      NotReadableError: 'assistant.microphoneUnavailable',
      'microphone-failed': 'assistant.microphoneUnavailable',
      unsupported: 'assistant.recognitionUnsupported',
      compatibility: 'assistant.localSpeechCompatibility',
      download: 'assistant.modelDownloadFailed',
      memory: 'assistant.modelMemoryLimit',
      RangeError: 'assistant.modelMemoryLimit',
      'empty-audio': 'assistant.noSpeech',
      transcription: 'assistant.localTranscriptionFailed',
    };
    const category = error?.category
      ?? (errorKeys[error?.name] ? error.name : error?.message)
      ?? error?.name;
    setVoiceErrorKey(errorKeys[category] ?? 'assistant.localTranscriptionFailed');
    const code = error?.name && error.name !== 'Error'
      ? error.name
      : (category && category !== 'Error' ? category : '');
    setVoiceErrorCode(code);
  }

  function getVoiceRecognizer() {
    if (voiceRecognizerRef.current) return voiceRecognizerRef.current;
    voiceRecognizerRef.current = createLocalSpeechRecognizer({
      onEvent: (event) => {
        if (event.type === 'status') {
          if (event.status === 'recording') setListening(true);
          if (event.status === 'max-duration') setListening(false);
          if (event.status === 'loading-model') setVoiceProgress(null);
          setVoiceStatus(event.status);
        } else if (event.type === 'progress') {
          setVoiceStatus('downloading');
          setVoiceProgress(event.progress);
        } else if (event.type === 'transcript') {
          setListening(false);
          setVoiceStatus('');
          setVoiceProgress(null);
          if (event.text) {
            setQuestion(event.text);
            setVoiceErrorKey('');
            setVoiceErrorCode('');
          } else {
            setVoiceErrorKey('assistant.noSpeech');
            setVoiceErrorCode('');
          }
        } else if (event.type === 'error') setLocalVoiceError(event);
      },
    });
    return voiceRecognizerRef.current;
  }

  function getTeluguSpeaker() {
    if (teluguSpeakerRef.current) return teluguSpeakerRef.current;
    teluguSpeakerRef.current = createLocalTeluguSpeaker({
      onEvent: (event) => {
        if (event.type === 'status') {
          setTeluguTtsStatus(event.status === 'idle' ? '' : event.status);
          setSpeaking(event.status !== 'idle');
          if (event.status === 'idle') setTeluguTtsProgress(null);
        } else if (event.type === 'progress') {
          setTeluguTtsStatus('downloading');
          setTeluguTtsProgress(event.progress);
        } else if (event.type === 'error') {
          const errorKeys = {
            compatibility: 'assistant.teluguTtsUnavailable',
            download: 'assistant.teluguTtsDownloadFailed',
            memory: 'assistant.teluguTtsMemoryLimit',
            synthesis: 'assistant.teluguTtsFailed',
          };
          setSpeaking(false);
          setTeluguTtsStatus('');
          setTeluguTtsProgress(null);
          setVoiceErrorKey(errorKeys[event.category] ?? 'assistant.teluguTtsFailed');
          setVoiceErrorCode(event.name && event.name !== 'Error' ? event.name : '');
        }
      },
    });
    return teluguSpeakerRef.current;
  }

  async function startListening() {
    if (!voiceCapabilities.recognition) {
      setVoiceErrorKey('assistant.recognitionUnsupported');
      setVoiceErrorCode('');
      return;
    }

    window.speechSynthesis?.cancel();
    teluguSpeakerRef.current?.cancel();
    setSpeaking(false);
    setTeluguTtsStatus('');
    setTeluguTtsProgress(null);
    setVoiceErrorKey('');
    setVoiceErrorCode('');
    try {
      setVoiceStatus('requesting-microphone');
      await getVoiceRecognizer().startRecording(assistantLanguage);
    } catch (error) {
      if (error.message !== 'disposed') setLocalVoiceError(error);
    }
  }

  async function stopListening() {
    if (!voiceRecognizerRef.current) return;
    setListening(false);
    setVoiceStatus('processing-audio');
    setVoiceErrorKey('');
    try {
      await voiceRecognizerRef.current.stopRecordingAndTranscribe();
    } catch (error) {
      if (error.message !== 'disposed') setLocalVoiceError(error);
    }
  }

  function speakAnswer() {
    if (!answer?.answer || speaking) return;
    setVoiceErrorKey('');
    setVoiceErrorCode('');
    if (answer.language === 'te') {
      if (!teluguTtsAvailable) {
        setVoiceErrorKey('assistant.teluguTtsUnavailable');
        return;
      }
      const speakingPromise = getTeluguSpeaker().speak(answer.answer);
      setTeluguTtsStatus('loading-model');
      setTeluguTtsProgress(null);
      setSpeaking(true);
      void speakingPromise.catch((error) => {
        if (error.message !== 'cancelled' && error.message !== 'disposed') {
          setSpeaking(false);
        }
      });
      return;
    }

    const result = createBrowserSpeechUtterance(
      answer.answer,
      'en-IN',
    );
    if (result.error) {
      setVoiceErrorKey(result.error === 'voice-unavailable'
        ? 'assistant.speechVoiceUnavailable'
        : 'assistant.speechUnavailable');
      return;
    }

    const synthesis = window.speechSynthesis;
    result.utterance.onstart = () => setSpeaking(true);
    result.utterance.onend = () => setSpeaking(false);
    result.utterance.onerror = (event) => {
      setSpeaking(false);
      if (!['canceled', 'interrupted'].includes(event.error)) {
        setVoiceErrorKey('assistant.speechFailed');
      }
    };
    synthesis.cancel();
    try {
      synthesis.speak(result.utterance);
      setSpeaking(true);
    } catch {
      setSpeaking(false);
      setVoiceErrorKey('assistant.speechFailed');
    }
  }

  function stopSpeaking() {
    window.speechSynthesis?.cancel();
    teluguSpeakerRef.current?.cancel();
    setSpeaking(false);
    setTeluguTtsStatus('');
    setTeluguTtsProgress(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading || !question.trim() || (mode === 'current' && !noticeId)) return;
    stopSpeaking();
    if (listening) void stopListening();
    setLoading(true);
    setAnswer(null);
    setErrorKey('');
    try {
      setAnswer(await askAssistant({
        question: question.trim(),
        language: assistantLanguage,
        mode,
        ...(mode === 'current' ? { noticeId } : {}),
      }));
    } catch (error) {
      setErrorKey(assistantErrorKey(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">{t('assistant.title')}</h1>
        <p className="mt-2 text-slate-600">{t('assistant.description')}</p>
      </header>

      {authStatus === 'loading' ? (
        <p role="status" className="text-sm text-slate-600">{t('assistant.checkingAccount')}</p>
      ) : !user ? (
        <div className="rounded-xl bg-slate-50 p-5 text-center">
          <p className="text-slate-700">{t('assistant.signInRequired')}</p>
          <Link className="mt-4 inline-flex rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/sign-in">
            {t('assistant.signInAction')}
          </Link>
        </div>
      ) : (
      <>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">{t('assistant.languageTitle')}</h2>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            aria-pressed={language === 'en-IN'}
            onClick={() => setLanguage('en-IN')}
            className={`rounded-lg px-4 py-2 ${
              language === 'en-IN'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-300 text-slate-700'
            }`}
          >
            {t('assistant.english')}
          </button>

          <button
            type="button"
            aria-pressed={language === 'te-IN'}
            onClick={() => setLanguage('te-IN')}
            className={`rounded-lg px-4 py-2 ${
              language === 'te-IN'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-300 text-slate-700'
            }`}
          >
            {t('assistant.telugu')}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">{t('assistant.modeTitle')}</h2>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setMode('current')}
            aria-pressed={mode === 'current'}
            className={`rounded-lg px-4 py-2 ${
              mode === 'current'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-300 text-slate-700'
            }`}
          >
            {t('assistant.currentNotice')}
          </button>

          <button
            type="button"
            onClick={() => setMode('all')}
            aria-pressed={mode === 'all'}
            className={`rounded-lg px-4 py-2 ${
              mode === 'all'
                ? 'bg-blue-700 text-white'
                : 'border border-slate-300 text-slate-700'
            }`}
          >
            {t('assistant.allNotices')}
          </button>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          {mode === 'current' ? t('assistant.currentDescription') : t('assistant.allDescription')}
        </p>
        {mode === 'current' && !noticeId && (
          <p role="status" className="mt-2 text-sm text-amber-800">{t('assistant.currentNoticeRequired')}</p>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold text-slate-900">{t('assistant.questionTitle')}</h2>
        <p className="mb-3 text-sm text-slate-600">{t('assistant.voicePrivacy')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            aria-label={t('assistant.questionLabel')}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={t('assistant.questionPlaceholder')}
            rows={4}
            maxLength={1200}
            className="w-full rounded-lg border border-slate-300 p-3 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={startListening}
              disabled={listening || loading || Boolean(voiceStatus && voiceStatus !== 'recording') || !voiceCapabilities.recognition}
              aria-pressed={listening}
              className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {listening ? t('assistant.listening') : t('assistant.startListening')}
            </button>
            {listening && (
              <button
                type="button"
                onClick={stopListening}
                className="rounded-lg border border-slate-300 px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
              >
                {t('assistant.stopListening')}
              </button>
            )}
            <button
              type="submit"
              disabled={!question.trim() || loading || listening || Boolean(voiceStatus) || (mode === 'current' && !noticeId)}
              className="rounded-lg bg-blue-700 px-5 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? t('assistant.asking') : t('assistant.askAction')}
            </button>
          </div>
        </form>
      </section>

      {voiceStatus && (
        <div role="status" className="space-y-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900" aria-live="polite">
          <p>{t(`assistant.voiceStatus.${voiceStatus}`)}</p>
          {voiceStatus === 'downloading' && voiceProgress && (
            <div>
              <progress
                className="w-full"
                max="100"
                value={Number.isFinite(voiceProgress.progress) ? voiceProgress.progress : undefined}
                aria-label={t('assistant.modelDownloadProgress')}
              />
              {Number.isFinite(voiceProgress.progress) && (
                <p>{t('assistant.modelDownloadPercent', { percent: Math.round(voiceProgress.progress) })}</p>
              )}
            </div>
          )}
        </div>
      )}
      {!voiceCapabilities.recognition && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('assistant.recognitionUnsupported')}</p>
      )}
      {loading && <p role="status" className="text-sm text-slate-600">{t('assistant.loading')}</p>}
      {errorKey && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{t(errorKey)}</p>}
      {voiceErrorKey && (
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
          {t(voiceErrorKey)}
          {voiceErrorCode && <> {t('assistant.errorCodeLabel')} <code>{voiceErrorCode}</code></>}
        </p>
      )}
      {answer && (
        <section className="space-y-4 rounded-xl border border-indigo-200 bg-white p-5 shadow-sm" aria-live="polite">
          <div className="rounded-lg bg-indigo-50 p-3 text-sm font-medium text-indigo-900">
            {t('assistant.aiGenerated')}
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">{t('assistant.answerTitle')}</h2>
            <p
              role={answer.answerable ? undefined : 'status'}
              className={`mt-2 whitespace-pre-wrap text-slate-800 ${answer.answerable ? '' : 'rounded-lg bg-amber-50 p-3 text-amber-900'}`}
            >
              {answer.answer}
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={speakAnswer}
                disabled={(answer.language === 'te' ? !teluguTtsAvailable : !voiceCapabilities.synthesis) || speaking}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {speaking ? t('assistant.speaking') : t('assistant.speakAnswer')}
              </button>
              {speaking && (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  {t('assistant.stopSpeaking')}
                </button>
              )}
            </div>
            {speaking && <p role="status" className="mt-2 text-sm text-slate-600">{t('assistant.speakingStatus')}</p>}
            {answer.language === 'te' && (
              <p className="mt-2 text-sm text-slate-600">{t('assistant.teluguTtsPrivacy')}</p>
            )}
            {answer.language === 'te' && !teluguTtsAvailable && (
              <p className="mt-2 text-sm text-amber-800">{t('assistant.teluguTtsUnavailable')}</p>
            )}
            {answer.language !== 'te' && !voiceCapabilities.synthesis && (
              <p className="mt-2 text-sm text-amber-800">{t('assistant.speechUnavailable')}</p>
            )}
          </div>
          {answer.disclaimer && <p className="text-sm text-amber-800">{answer.disclaimer}</p>}
          {answer.answerable && answer.evidence.length > 0 ? (
            <div>
              <h3 className="font-semibold text-slate-900">{t('assistant.evidenceTitle')}</h3>
              <ul className="mt-2 space-y-3">
                {answer.evidence.map((item, index) => (
                  <li key={`${item.noticeId}-${item.pageNumber}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="whitespace-pre-wrap text-sm text-slate-800">“{item.quote}”</p>
                    <p className="mt-2 text-xs text-slate-600">
                      {item.filename} — {t('assistant.pageReference', { page: item.pageNumber })}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {answer.sources?.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-900">{t('assistant.sourcesTitle')}</h3>
              <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                {answer.sources.map((source) => (
                  <li key={source.noticeId}>{source.filename} — {t('assistant.unverified')}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {teluguTtsStatus && (
        <div role="status" className="space-y-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900" aria-live="polite">
          <p>{t(`assistant.teluguTtsStatus.${teluguTtsStatus}`)}</p>
          {teluguTtsStatus === 'downloading' && teluguTtsProgress && (
            <div>
              <progress
                className="w-full"
                max="100"
                value={Number.isFinite(teluguTtsProgress.progress) ? teluguTtsProgress.progress : undefined}
                aria-label={t('assistant.teluguTtsProgress')}
              />
              {Number.isFinite(teluguTtsProgress.progress) && (
                <p>{t('assistant.teluguTtsPercent', { percent: Math.round(teluguTtsProgress.progress) })}</p>
              )}
            </div>
          )}
        </div>
      )}
      </>
      )}
    </main>
  );
}
