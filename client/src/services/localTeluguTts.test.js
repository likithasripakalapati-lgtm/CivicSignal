import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLocalTeluguSpeaker,
  getLocalTeluguTtsCapabilities,
} from './localTeluguTts.js';

const workers = [];
const audioContexts = [];
const sources = [];

class MockWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.postMessage = vi.fn();
    this.terminate = vi.fn();
    workers.push(this);
  }

  send(data) {
    this.onmessage({ data });
  }
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
    this.resume = vi.fn().mockResolvedValue(undefined);
    this.close = vi.fn(() => {
      this.state = 'closed';
      return Promise.resolve();
    });
    audioContexts.push(this);
  }

  createBuffer() {
    return { copyToChannel: vi.fn() };
  }

  createBufferSource() {
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    sources.push(source);
    return source;
  }
}

const scope = {
  Worker: MockWorker,
  AudioContext: MockAudioContext,
  WebAssembly,
};

async function startSpeech(speaker, text = 'తెలుగు సమాధానం') {
  const result = speaker.speak(text);
  await Promise.resolve();
  return { result, worker: workers.at(-1), message: workers.at(-1).postMessage.mock.calls[0][0] };
}

beforeEach(() => {
  vi.stubGlobal('Worker', MockWorker);
  workers.length = 0;
  audioContexts.length = 0;
  sources.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local Telugu speech synthesis', () => {
  it('checks browser worker, Web Audio, and WebAssembly support', () => {
    expect(getLocalTeluguTtsCapabilities(scope)).toBe(true);
    expect(getLocalTeluguTtsCapabilities({ ...scope, Worker: undefined })).toBe(false);
  });

  it('loads the model only after an explicit speak request and reports progress', async () => {
    const onEvent = vi.fn();
    const speaker = createLocalTeluguSpeaker({ onEvent }, scope);
    expect(workers).toHaveLength(0);

    const { result, worker, message } = await startSpeech(speaker);
    expect(message).toMatchObject({
      type: 'synthesize',
      text: 'తెలుగు సమాధానం',
      model: 'ravivarmapatturi/vayyuedge-mms-tts-tel-onnx',
    });
    expect(worker.options).toEqual({ type: 'module' });

    worker.send({ type: 'status', id: message.id, status: 'loading-model' });
    worker.send({ type: 'progress', id: message.id, progress: { progress: 35, loaded: 35, total: 100 } });
    expect(onEvent).toHaveBeenCalledWith({ type: 'status', id: message.id, status: 'loading-model' });
    expect(onEvent).toHaveBeenCalledWith({
      type: 'progress',
      id: message.id,
      progress: { progress: 35, loaded: 35, total: 100 },
    });

    worker.send({
      type: 'audio',
      id: message.id,
      audio: new Float32Array([0.1, -0.1]).buffer,
      sampleRate: 16_000,
    });
    sources[0].onended();
    await expect(result).resolves.toBeUndefined();
    expect(onEvent).toHaveBeenCalledWith({ type: 'status', status: 'playing' });
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', status: 'idle' });
  });

  it('stops generated audio immediately and cancels in-flight worker inference', async () => {
    const speaker = createLocalTeluguSpeaker({ onEvent: vi.fn() }, scope);
    const { result, worker, message } = await startSpeech(speaker);
    const rejection = expect(result).rejects.toThrow('cancelled');

    speaker.cancel();

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(audioContexts[0].close).toHaveBeenCalledOnce();

    const secondSpeech = speaker.speak('మరో సమాధానం');
    await Promise.resolve();
    const activeWorker = workers.at(-1);
    const activeMessage = activeWorker.postMessage.mock.calls[0][0];
    activeWorker.send({
      type: 'audio',
      id: activeMessage.id,
      audio: new Float32Array([0.2, -0.2]).buffer,
      sampleRate: 16_000,
    });
    const playbackRejection = expect(secondSpeech).rejects.toThrow('cancelled');
    speaker.cancel();

    await playbackRejection;
    expect(sources.at(-1).stop).toHaveBeenCalledOnce();
    expect(message.type).toBe('synthesize');
  });

  it('surfaces model download and inference failures', async () => {
    const onEvent = vi.fn();
    const speaker = createLocalTeluguSpeaker({ onEvent }, scope);
    const { result, worker, message } = await startSpeech(speaker);
    worker.send({
      type: 'error',
      id: message.id,
      category: 'download',
      name: 'NetworkError',
    });

    await expect(result).rejects.toThrow('download');
    expect(onEvent).toHaveBeenCalledWith({
      type: 'error',
      category: 'download',
      name: 'NetworkError',
    });
    expect(audioContexts[0].close).toHaveBeenCalledOnce();
  });
});
