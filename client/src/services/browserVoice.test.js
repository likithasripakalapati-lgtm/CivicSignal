import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserSpeechUtterance,
  createLocalSpeechRecognizer,
  getBrowserVoiceCapabilities,
  resampleToMono,
} from './browserVoice.js';

function createAudioScope({ sampleRate = 32_000, captureSetupError = null } = {}) {
  const tracks = [{ stop: vi.fn() }];
  const stream = { getTracks: () => tracks };
  const progressEvents = [];
  const workerMessagesSent = [];
  const intervalCallbacks = new Map();
  let intervalId = 0;

  class AudioContext {
    constructor() {
      AudioContext.instance = this;
      this.sampleRate = sampleRate;
      this.state = 'running';
      this.destination = {};
      this.resume = vi.fn(async () => {});
      this.close = vi.fn(async () => {
        this.state = 'closed';
      });
      this.createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      this.createGain = vi.fn(() => ({
        gain: { value: 1 },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
    }

    createScriptProcessor() {
      if (captureSetupError) throw captureSetupError;
      AudioContext.processor = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      };
      return AudioContext.processor;
    }
  }

  class Worker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      Worker.instance = this;
    }

    postMessage(message) {
      workerMessagesSent.push(message);
      if (message.type === 'transcribe') {
        queueMicrotask(() => {
          this.onmessage({
            data: {
              type: 'transcript',
              text: message.language === 'te' ? 'తెలుగు వాక్యం' : 'English words',
            },
          });
        });
      }
    }

    terminate = vi.fn();
  }
  vi.stubGlobal('Worker', Worker);

  const scope = {
    isSecureContext: true,
    navigator: { mediaDevices: { getUserMedia: vi.fn(async () => stream) } },
    AudioContext,
    Worker,
    WebAssembly,
    setInterval: vi.fn((callback) => {
      intervalId += 1;
      intervalCallbacks.set(intervalId, callback);
      return intervalId;
    }),
    clearInterval: vi.fn((id) => intervalCallbacks.delete(id)),
  };
  const onEvent = vi.fn((event) => progressEvents.push(event));
  const recognizer = createLocalSpeechRecognizer({ onEvent }, scope);
  return {
    scope,
    recognizer,
    onEvent,
    progressEvents,
    workerMessagesSent,
    tracks,
    intervalCallbacks,
    get worker() { return Worker.instance; },
    get processor() { return AudioContext.processor; },
    get audioContext() { return AudioContext.instance; },
  };
}

function pushPcm(fixture, samples) {
  fixture.processor.onaudioprocess({
    inputBuffer: {
      getChannelData: () => Float32Array.from(samples),
    },
  });
}

describe('local browser speech', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires local capture and worker capabilities', () => {
    class AudioContext {
      createScriptProcessor() {}
    }
    const supported = {
      isSecureContext: true,
      navigator: { mediaDevices: { getUserMedia: vi.fn() } },
      AudioContext,
      Worker: class {},
      WebAssembly,
      SpeechSynthesisUtterance: class {},
      speechSynthesis: { speak: vi.fn() },
    };

    expect(getBrowserVoiceCapabilities(supported)).toEqual({
      recognition: true,
      synthesis: true,
    });
    expect(getBrowserVoiceCapabilities({
      ...supported,
      isSecureContext: false,
    }).recognition).toBe(false);
    expect(getBrowserVoiceCapabilities({}).recognition).toBe(false);
  });

  it('converts and downsamples PCM chunks to mono 16 kHz', () => {
    const samples = resampleToMono([
      Float32Array.from([0, 1]),
      Float32Array.from([2, 3]),
    ], 32_000);

    expect(samples).toBeInstanceOf(Float32Array);
    expect(Array.from(samples)).toEqual([0, 2]);
  });

  it.each(['en', 'te'])('captures local PCM and transcribes in %s', async (language) => {
    const fixture = createAudioScope();
    await fixture.recognizer.startRecording(language);
    expect(fixture.scope.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(fixture.processor.onaudioprocess).toBeTypeOf('function');
    pushPcm(fixture, [0.25, 0.5, 0.75, 1]);
    pushPcm(fixture, [-0.25, -0.5, -0.75, -1]);

    const result = await fixture.recognizer.stopRecordingAndTranscribe();
    expect(result).toBe(language === 'te' ? 'తెలుగు వాక్యం' : 'English words');
    expect(fixture.workerMessagesSent[0]).toMatchObject({
      type: 'transcribe',
      language,
      model: 'onnx-community/whisper-tiny',
    });
    expect(fixture.workerMessagesSent[0].samples).toBeInstanceOf(ArrayBuffer);
    expect(fixture.workerMessagesSent[0].samples.byteLength).toBe(4 * Float32Array.BYTES_PER_ELEMENT);
    expect(fixture.worker.options).toEqual({ type: 'module' });
    expect(fixture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(fixture.processor.disconnect).toHaveBeenCalledOnce();
    expect(fixture.onEvent).toHaveBeenCalledWith({ type: 'status', status: 'recording' });
  });

  it('forwards model progress and stops capture resources when cancelled or disposed', async () => {
    const fixture = createAudioScope();
    await fixture.recognizer.startRecording();
    fixture.recognizer.cancel();
    expect(fixture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(fixture.processor.disconnect).toHaveBeenCalledOnce();

    await fixture.recognizer.startRecording();
    pushPcm(fixture, [0.1, 0.2, 0.3, 0.4]);
    await fixture.recognizer.stopRecordingAndTranscribe();
    await fixture.recognizer.startRecording();
    fixture.recognizer.dispose();
    expect(fixture.worker.terminate).toHaveBeenCalledOnce();
    expect(fixture.tracks[0].stop).toHaveBeenCalledTimes(3);
  });

  it('enforces the 30-second limit and transcribes the captured samples', async () => {
    const fixture = createAudioScope();
    await fixture.recognizer.startRecording();
    pushPcm(fixture, [0.1, 0.2, 0.3, 0.4]);
    const timer = fixture.intervalCallbacks.values().next().value;
    const startedAt = Date.now();
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(startedAt + 30_001);
    timer();
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(fixture.workerMessagesSent).toHaveLength(1);
    expect(fixture.progressEvents).toContainEqual({ type: 'status', status: 'max-duration' });
    expect(fixture.tracks[0].stop).toHaveBeenCalledOnce();
    nowSpy.mockRestore();
  });

  it('preserves microphone permission and empty capture errors', async () => {
    const denied = createAudioScope();
    denied.scope.navigator.mediaDevices.getUserMedia.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    );
    await expect(denied.recognizer.startRecording()).rejects.toMatchObject({
      name: 'NotAllowedError',
    });

    const empty = createAudioScope();
    await empty.recognizer.startRecording();
    await expect(empty.recognizer.stopRecordingAndTranscribe()).rejects.toThrow('empty-audio');
    expect(empty.tracks[0].stop).toHaveBeenCalledOnce();
  });

  it('releases the microphone and audio context when PCM setup fails', async () => {
    const fixture = createAudioScope({ captureSetupError: new Error('capture setup failed') });

    await expect(fixture.recognizer.startRecording()).rejects.toThrow('capture setup failed');

    expect(fixture.tracks[0].stop).toHaveBeenCalledOnce();
    expect(fixture.audioContext.close).toHaveBeenCalledOnce();
  });

  it('selects speech-synthesis voices by locale and reports unavailable APIs', () => {
    class Utterance {
      constructor(text) {
        this.text = text;
      }
    }
    const teluguVoice = { lang: 'te-IN', name: 'Telugu' };
    const scope = {
      SpeechSynthesisUtterance: Utterance,
      speechSynthesis: { getVoices: () => [teluguVoice] },
    };

    expect(createBrowserSpeechUtterance('నమస్కారం', 'te-IN', scope).utterance).toMatchObject({
      text: 'నమస్కారం',
      lang: 'te-IN',
      voice: teluguVoice,
    });
    expect(createBrowserSpeechUtterance('Hello', 'en-IN', scope)).toEqual({
      error: 'voice-unavailable',
    });
    expect(createBrowserSpeechUtterance('Hello', 'en-IN', {})).toEqual({
      error: 'unavailable',
    });
  });
});
