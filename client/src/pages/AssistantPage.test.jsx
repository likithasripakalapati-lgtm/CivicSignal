import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AssistantPage from './AssistantPage.jsx';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import * as authService from '../services/auth.js';
import { askAssistant } from '../services/assistant.js';

const { localVoice } = vi.hoisted(() => ({
  localVoice: {
    onEvent: null,
    capabilities: { recognition: true, synthesis: true },
    startRecording: vi.fn(),
    stopRecordingAndTranscribe: vi.fn(),
    dispose: vi.fn(),
  },
}));
const { localTeluguSpeaker } = vi.hoisted(() => ({
  localTeluguSpeaker: {
    onEvent: null,
    speak: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock('../services/auth.js', () => ({
  getCurrentUser: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../services/assistant.js', () => ({
  askAssistant: vi.fn(),
}));

vi.mock('../services/browserVoice.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLocalSpeechRecognizer: vi.fn(({ onEvent }) => {
      localVoice.onEvent = onEvent;
      return localVoice;
    }),
    getBrowserVoiceCapabilities: vi.fn(() => localVoice.capabilities),
  };
});

vi.mock('../services/localTeluguTts.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createLocalTeluguSpeaker: vi.fn(({ onEvent }) => {
      localTeluguSpeaker.onEvent = onEvent;
      return localTeluguSpeaker;
    }),
    getLocalTeluguTtsCapabilities: vi.fn(() => true),
  };
});

const speechSynthesisNames = ['speechSynthesis', 'SpeechSynthesisUtterance'];
const originalSpeechSynthesisDescriptors = new Map(
  speechSynthesisNames.map((name) => [name, Object.getOwnPropertyDescriptor(window, name)]),
);

function installWindowApi(name, value) {
  Object.defineProperty(window, name, { configurable: true, writable: true, value });
}

function renderAssistant(path = '/assistant') {
  return render(
    <LanguageProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes><Route path="/assistant" element={<AssistantPage />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  for (const [name, descriptor] of originalSpeechSynthesisDescriptors) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else delete window[name];
  }
  localStorage.clear();
  localVoice.onEvent = null;
  localVoice.capabilities = { recognition: true, synthesis: true };
  localVoice.startRecording.mockReset().mockResolvedValue(undefined);
  localVoice.stopRecordingAndTranscribe.mockReset().mockResolvedValue('');
  localVoice.dispose.mockReset();
  localTeluguSpeaker.onEvent = null;
  localTeluguSpeaker.speak.mockReset().mockResolvedValue(undefined);
  localTeluguSpeaker.cancel.mockReset();
  localTeluguSpeaker.dispose.mockReset();
  authService.getCurrentUser.mockReset();
  authService.getCurrentUser.mockResolvedValue({
    id: 'user-1',
    email: 'citizen@example.test',
    languagePreference: 'en-IN',
  });
  askAssistant.mockReset();
});

describe('assistant page', () => {
  it('lets the user review and edit locally recognized speech before explicit submission', async () => {
    const user = userEvent.setup();
    askAssistant.mockResolvedValue({
      answer: 'Answer',
      answerable: true,
      language: 'en',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI-generated answer.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Start listening' }));
    expect(localVoice.startRecording).toHaveBeenCalledWith('en');
    expect(askAssistant).not.toHaveBeenCalled();
    act(() => localVoice.onEvent({ type: 'status', status: 'recording' }));
    expect(screen.getByRole('status')).toHaveTextContent('Recording locally');

    await user.click(screen.getByRole('button', { name: 'Stop recording' }));
    expect(localVoice.stopRecordingAndTranscribe).toHaveBeenCalledOnce();
    act(() => localVoice.onEvent({ type: 'transcript', text: 'When is the notice effective?' }));

    const textbox = screen.getByRole('textbox', { name: 'Question about your notices' });
    expect(textbox).toHaveValue('When is the notice effective?');
    await user.clear(textbox);
    await user.type(textbox, 'When does this notice start?');
    expect(askAssistant).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(askAssistant).toHaveBeenCalledWith({
      question: 'When does this notice start?',
      language: 'en',
      mode: 'all',
    });
  });

  it('disposes local recording and Telugu speech and stops browser speech when navigating away', async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    installWindowApi('speechSynthesis', { cancel, getVoices: () => [] });
    const { unmount } = renderAssistant();

    askAssistant.mockResolvedValue({
      answer: 'తెలుగు సమాధానం.',
      answerable: true,
      language: 'te',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI answer.',
      sources: [],
      evidence: [],
    });
    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.type(await screen.findByRole('textbox', { name: 'మీ నోటీసుల గురించి ప్రశ్న' }), 'ప్రశ్న');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));
    await screen.findByText('తెలుగు సమాధానం.');
    await user.click(screen.getByRole('button', { name: 'సమాధానాన్ని వినండి' }));
    await user.click(await screen.findByRole('button', { name: 'వినడం ప్రారంభించండి' }));
    unmount();

    expect(localVoice.dispose).toHaveBeenCalledOnce();
    expect(localTeluguSpeaker.dispose).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalled();
  });

  it('keeps English browser speech synthesis behind the existing Speak and Stop controls', async () => {
    const user = userEvent.setup();
    class MockSpeechSynthesisUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    const voices = [{ lang: 'en-IN', name: 'English' }];
    const speak = vi.fn();
    const cancel = vi.fn();
    installWindowApi('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
    installWindowApi('speechSynthesis', { speak, cancel, getVoices: () => voices });
    askAssistant.mockResolvedValue({
      answer: 'Water supply will stop.',
      answerable: true,
      language: 'en',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI answer.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    await user.type(await screen.findByRole('textbox', { name: 'Question about your notices' }), 'What happens?');
    await user.click(screen.getByRole('button', { name: 'Ask question' }));
    expect(await screen.findByText('Water supply will stop.')).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Speak answer' }));
    expect(speak).toHaveBeenCalledOnce();
    const utterance = speak.mock.calls[0][0];
    expect(utterance.lang).toBe('en-IN');
    expect(utterance.voice).toBe(voices[0]);
    expect(screen.getByRole('status')).toHaveTextContent('Reading the answer aloud');

    await user.click(screen.getByRole('button', { name: 'Stop speaking' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop speaking' })).not.toBeInTheDocument();
    expect(localTeluguSpeaker.speak).not.toHaveBeenCalled();
  });

  it('generates Telugu speech only after Speak answer and shows local model progress', async () => {
    const user = userEvent.setup();
    const speak = vi.fn();
    const cancel = vi.fn();
    installWindowApi('speechSynthesis', { speak, cancel, getVoices: () => [] });
    askAssistant.mockResolvedValue({
      answer: 'నీటి సరఫరా నిలిపివేయబడుతుంది.',
      answerable: true,
      language: 'te',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI answer.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.type(await screen.findByRole('textbox', { name: 'మీ నోటీసుల గురించి ప్రశ్న' }), 'ఏమి జరుగుతుంది?');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));
    expect(await screen.findByText('నీటి సరఫరా నిలిపివేయబడుతుంది.')).toBeInTheDocument();
    expect(speak).not.toHaveBeenCalled();
    expect(localTeluguSpeaker.speak).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'సమాధానాన్ని వినండి' }));
    expect(localTeluguSpeaker.speak).toHaveBeenCalledWith('నీటి సరఫరా నిలిపివేయబడుతుంది.');
    expect(speak).not.toHaveBeenCalled();
    expect(screen.getByText(/మొదటి డౌన్‌లోడ్ సుమారు 109 MiB/)).toBeInTheDocument();

    act(() => localTeluguSpeaker.onEvent({ type: 'status', status: 'generating' }));
    expect(screen.getByText('స్థానికంగా తెలుగు ప్రసంగాన్ని రూపొందిస్తున్నాం…')).toBeInTheDocument();
    act(() => localTeluguSpeaker.onEvent({
      type: 'progress',
      progress: { progress: 50, loaded: 50, total: 100 },
    }));
    expect(screen.getByRole('progressbar', { name: 'తెలుగు ప్రసంగ మోడల్ డౌన్‌లోడ్ పురోగతి' })).toHaveValue(50);

    await user.click(screen.getByRole('button', { name: 'మాట్లాడటం ఆపండి' }));
    expect(localTeluguSpeaker.cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'మాట్లాడటం ఆపండి' })).not.toBeInTheDocument();
  });

  it('keeps the Telugu text answer visible when local speech generation fails', async () => {
    const user = userEvent.setup();
    askAssistant.mockResolvedValue({
      answer: 'రాత సమాధానం అందుబాటులో ఉంటుంది.',
      answerable: true,
      language: 'te',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI answer.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.type(await screen.findByRole('textbox', { name: 'మీ నోటీసుల గురించి ప్రశ్న' }), 'ప్రశ్న');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));
    expect(await screen.findByText('రాత సమాధానం అందుబాటులో ఉంటుంది.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'సమాధానాన్ని వినండి' }));

    act(() => localTeluguSpeaker.onEvent({
      type: 'error',
      category: 'download',
      name: 'NetworkError',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('తెలుగు ప్రసంగ మోడల్‌ను డౌన్‌లోడ్ చేయలేకపోయాం');
    expect(screen.getByText('రాత సమాధానం అందుబాటులో ఉంటుంది.')).toBeInTheDocument();
  });

  it('cancels Telugu speech before loading another answer', async () => {
    const user = userEvent.setup();
    askAssistant
      .mockResolvedValueOnce({
        answer: 'మొదటి సమాధానం.',
        answerable: true,
        language: 'te',
        mode: 'all',
        aiGenerated: true,
        disclaimer: 'AI answer.',
        sources: [],
        evidence: [],
      })
      .mockResolvedValueOnce({
        answer: 'Second answer.',
        answerable: true,
        language: 'en',
        mode: 'all',
        aiGenerated: true,
        disclaimer: 'AI answer.',
        sources: [],
        evidence: [],
      });
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    const questionInput = await screen.findByRole('textbox', { name: 'మీ నోటీసుల గురించి ప్రశ్న' });
    await user.type(questionInput, 'మొదటి ప్రశ్న');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));
    await screen.findByText('మొదటి సమాధానం.');
    await user.click(screen.getByRole('button', { name: 'సమాధానాన్ని వినండి' }));

    await user.clear(questionInput);
    await user.type(questionInput, 'రెండవ ప్రశ్న');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));

    expect(localTeluguSpeaker.cancel).toHaveBeenCalled();
    expect(await screen.findByText('Second answer.')).toBeInTheDocument();
  });

  it('reports microphone permission and empty-speech errors without submitting', async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Start listening' }));
    act(() => localVoice.onEvent({
      type: 'error',
      category: 'microphone-denied',
      name: 'NotAllowedError',
    }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone permission was denied');
    expect(screen.getByRole('alert')).toHaveTextContent('Diagnostic code: NotAllowedError');

    await user.click(screen.getByRole('button', { name: 'Start listening' }));
    act(() => localVoice.onEvent({ type: 'transcript', text: '' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No speech was detected');
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it.each([
    ['download', 'The speech model could not be downloaded', 'NetworkError'],
    ['memory', 'does not have enough memory', 'RangeError'],
    ['compatibility', 'cannot run the local speech model', 'RuntimeError'],
    ['unexpected-error', 'Local speech transcription could not complete', 'InferenceError'],
  ])('shows local model diagnostic for %s errors', async (category, message, name) => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Start listening' }));
    act(() => localVoice.onEvent({ type: 'error', category, name }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert')).toHaveTextContent(`Diagnostic code: ${name}`);
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('shows local model memory errors in Telugu', async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.click(screen.getByRole('button', { name: 'వినడం ప్రారంభించండి' }));
    act(() => localVoice.onEvent({ type: 'error', category: 'memory', name: 'RangeError' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('తగినంత మెమరీ లేదు');
  });

  it('handles a browser microphone permission rejection', async () => {
    const user = userEvent.setup();
    localVoice.startRecording.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Start listening' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Microphone permission was denied');
    expect(screen.getByRole('alert')).toHaveTextContent('Diagnostic code: NotAllowedError');
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('shows model download progress and starts local Telugu recognition', async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.click(screen.getByRole('button', { name: 'వినడం ప్రారంభించండి' }));
    expect(localVoice.startRecording).toHaveBeenCalledWith('te');

    act(() => localVoice.onEvent({ type: 'status', status: 'loading-model' }));
    expect(screen.getByRole('status')).toHaveTextContent('స్థానిక ఇంగ్లీష్, తెలుగు ప్రసంగ మోడల్‌ను లోడ్ చేస్తున్నాం');
    act(() => localVoice.onEvent({
      type: 'progress',
      progress: { progress: 42, loaded: 42, total: 100 },
    }));
    expect(screen.getByRole('progressbar', { name: 'ప్రసంగ మోడల్ డౌన్‌లోడ్ పురోగతి' })).toHaveValue(42);
    expect(screen.getByRole('status')).toHaveTextContent('మోడల్ ఫైల్ పురోగతి: 42%');
  });

  it('keeps typed questions usable when local speech APIs are unsupported', async () => {
    const user = userEvent.setup();
    localVoice.capabilities = { recognition: false, synthesis: false };
    askAssistant.mockResolvedValue({
      answer: 'Typed question answer.',
      answerable: true,
      language: 'en',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI-generated answer.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    expect(await screen.findByText(/Local speech input is not supported/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start listening' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Question about your notices' }), 'What is the notice about?');
    await user.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(await screen.findByText('Typed question answer.')).toBeInTheDocument();
    expect(askAssistant).toHaveBeenCalledOnce();
  });

  it('submits a current-notice question and displays AI evidence and page reference', async () => {
    const user = userEvent.setup();
    askAssistant.mockResolvedValue({
      answer: 'Water supply stops on 20 June.',
      answerable: true,
      language: 'en',
      mode: 'current',
      aiGenerated: true,
      disclaimer: 'AI-generated; not official guidance.',
      sources: [{
        noticeId: 'notice-1',
        filename: 'water-notice.pdf',
        authenticityStatus: 'unverified',
      }],
      evidence: [{
        noticeId: 'notice-1',
        filename: 'water-notice.pdf',
        pageNumber: 3,
        quote: 'Water supply will stop on 20 June.',
      }],
    });
    renderAssistant('/assistant?noticeId=notice-1');

    await user.type(await screen.findByRole('textbox', { name: 'Question about your notices' }), 'When does water stop?');
    await user.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(await screen.findByText('Water supply stops on 20 June.')).toBeInTheDocument();
    expect(screen.getByText('“Water supply will stop on 20 June.”')).toBeInTheDocument();
    expect(screen.getByText('water-notice.pdf — Page 3')).toBeInTheDocument();
    expect(screen.getByText('AI-generated; not official guidance.')).toBeInTheDocument();
    expect(askAssistant).toHaveBeenCalledWith({
      question: 'When does water stop?',
      language: 'en',
      mode: 'current',
      noticeId: 'notice-1',
    });
  });

  it('supports all-notices mode, Telugu language, and the no-answer state', async () => {
    const user = userEvent.setup();
    askAssistant.mockResolvedValue({
      answer: 'అందుబాటులో ఉన్న నోటీసుల్లో ఈ ప్రశ్నకు సమాధానం లేదు.',
      answerable: false,
      language: 'te',
      mode: 'all',
      aiGenerated: true,
      disclaimer: 'AI రూపొందించిన సమాధానం.',
      sources: [],
      evidence: [],
    });
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Telugu' }));
    await user.click(screen.getByRole('button', { name: 'నా అన్ని నోటీసులు' }));
    await user.type(screen.getByRole('textbox', { name: 'మీ నోటీసుల గురించి ప్రశ్న' }), 'ఏదైనా సబ్సిడీ ఉందా?');
    await user.click(screen.getByRole('button', { name: 'ప్రశ్న అడగండి' }));

    expect(await screen.findByText('అందుబాటులో ఉన్న నోటీసుల్లో ఈ ప్రశ్నకు సమాధానం లేదు.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('అందుబాటులో ఉన్న నోటీసుల్లో ఈ ప్రశ్నకు సమాధానం లేదు.');
    expect(askAssistant).toHaveBeenCalledWith({
      question: 'ఏదైనా సబ్సిడీ ఉందా?',
      language: 'te',
      mode: 'all',
    });
  });

  it('shows loading and a localized error state', async () => {
    const user = userEvent.setup();
    let rejectRequest;
    askAssistant.mockReturnValue(new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    renderAssistant();

    await user.type(await screen.findByRole('textbox', { name: 'Question about your notices' }), 'What is the notice about?');
    await user.click(screen.getByRole('button', { name: 'Ask question' }));

    expect(screen.getByRole('status')).toHaveTextContent('Preparing an answer from your notices');
    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();
    rejectRequest({ response: { data: { error: { code: 'GEMINI_UNAVAILABLE' } } } });

    expect(await screen.findByRole('alert')).toHaveTextContent('The assistant is temporarily unavailable.');
  });

  it('does not send a request in current-notice mode without a notice ID', async () => {
    const user = userEvent.setup();
    renderAssistant();

    await user.click(await screen.findByRole('button', { name: 'Current notice' }));
    expect(screen.getByText(/Open a notice and choose/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask question' })).toBeDisabled();
    expect(askAssistant).not.toHaveBeenCalled();
  });

  it('requires sign-in before asking questions', async () => {
    authService.getCurrentUser.mockRejectedValue(new Error('signed out'));
    renderAssistant();

    expect(await screen.findByText('Sign in to ask questions about your private notices.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    await waitFor(() => expect(askAssistant).not.toHaveBeenCalled());
  });
});
