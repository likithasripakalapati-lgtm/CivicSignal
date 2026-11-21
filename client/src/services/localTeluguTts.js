const MODEL_ID = 'ravivarmapatturi/vayyuedge-mms-tts-tel-onnx';

export function getLocalTeluguTtsCapabilities(scope = window) {
  const AudioContextConstructor = scope?.AudioContext ?? scope?.webkitAudioContext;
  return Boolean(
    typeof scope?.Worker === 'function'
    && typeof AudioContextConstructor === 'function'
    && typeof AudioContextConstructor.prototype?.createBuffer === 'function'
    && typeof scope?.WebAssembly?.instantiate === 'function',
  );
}

export function createLocalTeluguSpeaker({ onEvent }, scope = window) {
  const AudioContextConstructor = scope.AudioContext ?? scope.webkitAudioContext;
  let worker = null;
  let audioContext = null;
  let audioSource = null;
  let pending = null;
  let requestId = 0;
  let workerBusy = false;
  let disposed = false;

  const emit = (event) => {
    if (!disposed) onEvent(event);
  };

  const releaseAudioContext = () => {
    const context = audioContext;
    audioContext = null;
    if (context && context.state !== 'closed') void context.close();
  };

  const settlePending = (error) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    if (error) current.reject(error);
    else current.resolve();
  };

  const stopSource = () => {
    const source = audioSource;
    audioSource = null;
    if (!source) return;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // The source may have ended between the state check and stop().
    }
    source.disconnect();
  };

  const terminateWorker = () => {
    worker?.terminate();
    worker = null;
    workerBusy = false;
  };

  const cancel = () => {
    requestId += 1;
    stopSource();
    if (workerBusy) terminateWorker();
    settlePending(new Error('cancelled'));
    releaseAudioContext();
    emit({ type: 'status', status: 'idle' });
  };

  const fail = (data) => {
    workerBusy = false;
    if (data.category === 'memory') terminateWorker();
    const error = new Error(data.category ?? 'synthesis');
    error.name = data.name ?? 'Error';
    emit({ type: 'error', category: data.category ?? 'synthesis', name: error.name });
    settlePending(error);
    releaseAudioContext();
  };

  const playAudio = (data) => {
    if (!pending || data.id !== pending.id || !audioContext) return;
    try {
      const samples = new Float32Array(data.audio);
      if (!samples.length || !Number.isFinite(data.sampleRate) || data.sampleRate <= 0) {
        throw new Error('invalid-audio');
      }

      const buffer = audioContext.createBuffer(1, samples.length, data.sampleRate);
      buffer.copyToChannel(samples, 0);
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.onended = () => {
        if (audioSource !== source) return;
        audioSource = null;
        source.disconnect();
        settlePending();
        releaseAudioContext();
        emit({ type: 'status', status: 'idle' });
      };
      audioSource = source;
      emit({ type: 'status', status: 'playing' });
      source.start();
    } catch (error) {
      fail({
        category: 'synthesis',
        name: error?.name ?? 'AudioPlaybackError',
      });
    }
  };

  const ensureWorker = () => {
    if (worker) return worker;
    if (typeof scope.Worker !== 'function') {
      const error = new Error('unsupported');
      error.name = 'NotSupportedError';
      throw error;
    }

    worker = new Worker(new URL('./localTeluguTts.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'status' || data.type === 'progress') {
        emit(data);
      } else if (data.type === 'audio') {
        workerBusy = false;
        playAudio(data);
      } else if (data.type === 'error') {
        fail(data);
      }
    };
    worker.onerror = (event) => {
      terminateWorker();
      const diagnostic = event.error?.message ?? event.message ?? '';
      fail({
        category: /memory|allocation|out of memory/i.test(diagnostic) ? 'memory' : 'synthesis',
        name: event.error?.name ?? event.message ?? 'WorkerError',
      });
    };
    return worker;
  };

  return {
    async speak(text) {
      if (disposed) throw new Error('disposed');
      cancel();
      if (!getLocalTeluguTtsCapabilities(scope)) {
        const error = new Error('unsupported');
        error.name = 'NotSupportedError';
        emit({ type: 'error', category: 'compatibility', name: error.name });
        throw error;
      }

      const id = requestId;
      try {
        audioContext = new AudioContextConstructor();
        await audioContext.resume();
        if (disposed || id !== requestId) throw new Error('cancelled');

        const activeWorker = ensureWorker();
        workerBusy = true;
        const result = new Promise((resolve, reject) => {
          pending = { id, resolve, reject };
        });
        activeWorker.postMessage({ type: 'synthesize', id, text, model: MODEL_ID });
        return await result;
      } catch (error) {
        if (error.message !== 'cancelled') {
          fail({
            category: error.name === 'NotSupportedError' ? 'compatibility' : 'synthesis',
            name: error.name ?? 'Error',
          });
        }
        throw error;
      }
    },
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      terminateWorker();
    },
  };
}
