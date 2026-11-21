import { env, pipeline } from '@huggingface/transformers';

const MODEL_ID = 'ravivarmapatturi/vayyuedge-mms-tts-tel-onnx';

env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.numThreads = 1;

let synthesizerPromise;

function categorizeError(error, loading) {
  const message = `${error?.name ?? ''} ${error?.message ?? ''}`.toLowerCase();
  if (/memory|allocation|out of memory|array buffer|wasm.*grow/.test(message)) return 'memory';
  if (/sharedarraybuffer|cross.?origin|webassembly.*(not supported|unsupported|compile)|simd.*(not supported|unsupported)/.test(message)) {
    return 'compatibility';
  }
  if (loading) return 'download';
  return 'synthesis';
}

self.onmessage = async ({ data }) => {
  if (data.type !== 'synthesize') return;
  const loading = !synthesizerPromise;

  try {
    if (!synthesizerPromise) {
      self.postMessage({ type: 'status', id: data.id, status: 'loading-model' });
      synthesizerPromise = pipeline('text-to-speech', data.model, {
        dtype: 'fp32',
        progress_callback: (progress) => self.postMessage({ type: 'progress', id: data.id, progress }),
      });
    }
    const synthesizer = await synthesizerPromise;
    self.postMessage({ type: 'status', id: data.id, status: 'generating' });
    const result = await synthesizer(data.text);
    const audio = result.audio.slice();
    self.postMessage({
      type: 'audio',
      id: data.id,
      audio: audio.buffer,
      sampleRate: result.sampling_rate,
    }, [audio.buffer]);
  } catch (error) {
    if (loading) synthesizerPromise = null;
    self.postMessage({
      type: 'error',
      id: data.id,
      category: categorizeError(error, loading),
      name: error?.name ?? 'Error',
    });
  }
};
