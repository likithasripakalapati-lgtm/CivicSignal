import { env, pipeline } from '@huggingface/transformers';

env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.numThreads = 1;

let transcriberPromise;

function categorizeError(error, loading) {
  const message = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (/sharedarraybuffer|cross.?origin|webassembly.*(not supported|unsupported|compile)|simd.*(not supported|unsupported)/.test(message)) {
    return 'compatibility';
  }
  if (/memory|allocation|out of memory|array buffer|wasm.*grow/.test(message)) return 'memory';
  if (loading) return 'download';
  return 'transcription';
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'transcribe') return;
  let loading = !transcriberPromise;

  try {
    if (!transcriberPromise) {
      self.postMessage({ type: 'status', status: 'loading-model' });
      transcriberPromise = pipeline('automatic-speech-recognition', data.model, {
        dtype: 'q8',
        progress_callback: (progress) => self.postMessage({ type: 'progress', progress }),
      });
    }
    const transcriber = await transcriberPromise;
    loading = false;
    self.postMessage({ type: 'status', status: 'transcribing' });
    const result = await transcriber(new Float32Array(data.samples), {
      language: data.language === 'te' ? 'telugu' : 'english',
      task: 'transcribe',
    });
    self.postMessage({ type: 'transcript', text: result.text?.trim() ?? '' });
  } catch (error) {
    if (loading) transcriberPromise = null;
    self.postMessage({
      type: 'error',
      category: categorizeError(error, loading),
      name: error?.name ?? 'Error',
    });
  }
};
