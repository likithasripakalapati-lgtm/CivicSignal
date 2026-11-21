const MAX_RECORDING_SECONDS = 30;
const MODEL_ID = 'onnx-community/whisper-tiny';
const SAMPLE_RATE = 16_000;

export function getBrowserVoiceCapabilities(scope = window) {
  const AudioContextConstructor = scope?.AudioContext ?? scope?.webkitAudioContext;
  return {
    recognition: Boolean(
      scope?.isSecureContext
      && typeof scope?.navigator?.mediaDevices?.getUserMedia === 'function'
      && typeof AudioContextConstructor === 'function'
      && typeof AudioContextConstructor.prototype?.createScriptProcessor === 'function'
      && typeof scope?.Worker === 'function'
      && typeof scope?.WebAssembly?.instantiate === 'function',
    ),
    synthesis: Boolean(
      scope?.speechSynthesis
      && typeof scope.SpeechSynthesisUtterance === 'function',
    ),
  };
}

export function resampleToMono(chunks, sampleRate) {
  const sourceLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const outputLength = Math.floor(sourceLength * SAMPLE_RATE / sampleRate);
  if (!outputLength) throw new Error('empty-audio');

  const source = new Float32Array(sourceLength);
  let offset = 0;
  for (const chunk of chunks) {
    source.set(chunk, offset);
    offset += chunk.length;
  }

  const output = new Float32Array(outputLength);
  const ratio = sampleRate / SAMPLE_RATE;

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const left = Math.floor(sourcePosition);
    const right = Math.min(left + 1, sourceLength - 1);
    const fraction = sourcePosition - left;
    output[index] = source[left] * (1 - fraction) + source[right] * fraction;
  }
  return output;
}

function findLanguageVoice(voices, language) {
  const normalizedLanguage = language.toLowerCase();
  return voices.find((voice) => voice.lang.toLowerCase() === normalizedLanguage)
    ?? voices.find((voice) => voice.lang.toLowerCase().startsWith(`${normalizedLanguage.split('-')[0]}-`))
    ?? null;
}

export function createBrowserSpeechUtterance(text, language, scope = window) {
  if (!scope?.speechSynthesis || typeof scope.SpeechSynthesisUtterance !== 'function') {
    return { error: 'unavailable' };
  }

  const utterance = new scope.SpeechSynthesisUtterance(text);
  utterance.lang = language;
  const voices = scope.speechSynthesis.getVoices?.() ?? [];
  if (voices.length > 0) {
    const voice = findLanguageVoice(voices, language);
    if (!voice) return { error: 'voice-unavailable' };
    utterance.voice = voice;
  }
  return { utterance };
}

export function createLocalSpeechRecognizer({
  onEvent,
}, scope = window) {
  const AudioContextConstructor = scope.AudioContext ?? scope.webkitAudioContext;
  let stream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let mutedGainNode = null;
  let worker = null;
  let pcmChunks = [];
  let recordingTimer = null;
  let recording = false;
  let transcriptionPromise = null;
  let resolveWorkerResult = null;
  let rejectWorkerResult = null;
  let language = 'en';
  let disposed = false;

  const emit = (event) => {
    if (!disposed) onEvent(event);
  };

  const releaseCapture = async () => {
    if (recordingTimer !== null) scope.clearInterval(recordingTimer);
    recordingTimer = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    sourceNode?.disconnect();
    processorNode?.disconnect();
    mutedGainNode?.disconnect();
    sourceNode = null;
    processorNode = null;
    mutedGainNode = null;
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
    audioContext = null;
  };

  const failTranscription = (error) => {
    rejectWorkerResult?.(error);
    resolveWorkerResult = null;
    rejectWorkerResult = null;
  };

  const ensureWorker = () => {
    if (worker) return worker;
    if (typeof scope.Worker !== 'function') throw new Error('unsupported');

    worker = new Worker(new URL('./browserVoice.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress' || data.type === 'status') {
        emit(data);
      } else if (data.type === 'transcript') {
        emit(data);
        resolveWorkerResult?.(data.text);
        resolveWorkerResult = null;
        rejectWorkerResult = null;
      } else if (data.type === 'error') {
        const error = new Error(data.category);
        error.name = data.name ?? 'Error';
        failTranscription(error);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'worker-failed');
      error.name = event.error?.name || 'WorkerError';
      failTranscription(error);
    };
    return worker;
  };

  const transcribe = async (chunks, sampleRate) => {
    const samples = resampleToMono(chunks, sampleRate);
    if (disposed) throw new Error('disposed');
    const activeWorker = ensureWorker();
    emit({ type: 'status', status: 'transcribing' });
    return new Promise((resolve, reject) => {
      resolveWorkerResult = resolve;
      rejectWorkerResult = reject;
      activeWorker.postMessage({
        type: 'transcribe',
        language,
        samples: samples.buffer,
        model: MODEL_ID,
      }, [samples.buffer]);
    });
  };

  const stopRecordingAndTranscribe = () => {
    if (transcriptionPromise) return transcriptionPromise;
    if (!recording || !audioContext) return Promise.reject(new Error('not-recording'));
    recording = false;
    emit({ type: 'status', status: 'processing-audio' });
    const capturedChunks = pcmChunks;
    const capturedSampleRate = audioContext.sampleRate;
    pcmChunks = [];
    transcriptionPromise = releaseCapture()
      .then(() => transcribe(capturedChunks, capturedSampleRate))
      .finally(() => {
        pcmChunks = [];
        transcriptionPromise = null;
      });
    return transcriptionPromise.finally(() => {
      if (transcriptionPromise) transcriptionPromise = null;
    });
  };

  return {
    async startRecording(selectedLanguage = 'en') {
      if (disposed) throw new Error('disposed');
      if (!getBrowserVoiceCapabilities(scope).recognition) throw new Error('unsupported');
      await releaseCapture();
      if (disposed) throw new Error('disposed');
      language = selectedLanguage === 'te' ? 'te' : 'en';
      try {
        audioContext = new AudioContextConstructor();
        await audioContext.resume();
        stream = await scope.navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
          throw new Error('disposed');
        }
        sourceNode = audioContext.createMediaStreamSource(stream);
        processorNode = audioContext.createScriptProcessor(4096, 1, 1);
        mutedGainNode = audioContext.createGain();
        mutedGainNode.gain.value = 0;
        processorNode.onaudioprocess = (event) => {
          if (!recording) return;
          const input = event.inputBuffer.getChannelData(0);
          pcmChunks.push(new Float32Array(input));
        };
        sourceNode.connect(processorNode);
        processorNode.connect(mutedGainNode);
        mutedGainNode.connect(audioContext.destination);
        pcmChunks = [];
        recording = true;
        emit({ type: 'status', status: 'recording' });
        const startedAt = Date.now();
        recordingTimer = scope.setInterval(() => {
          if (Date.now() - startedAt < MAX_RECORDING_SECONDS * 1000) return;
          scope.clearInterval(recordingTimer);
          recordingTimer = null;
          scope.clearInterval(recordingTimer);
          recordingTimer = null;
          emit({ type: 'status', status: 'max-duration' });
          void stopRecordingAndTranscribe().catch((error) => {
            emit({ type: 'error', category: error.message || 'transcription-failed', name: error.name });
          });
        }, 500);
      } catch (error) {
        recording = false;
        await releaseCapture();
        throw error;
      }
    },
    stopRecordingAndTranscribe,
    cancel() {
      recording = false;
      pcmChunks = [];
      void releaseCapture();
    },
    dispose() {
      disposed = true;
      recording = false;
      if (recordingTimer !== null) scope.clearInterval(recordingTimer);
      recordingTimer = null;
      pcmChunks = [];
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      if (audioContext && audioContext.state !== 'closed') void audioContext.close();
      audioContext = null;
      worker?.terminate();
      worker = null;
      failTranscription(new Error('disposed'));
    },
  };
}
