import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NoticeDetailsPage from './NoticeDetailsPage.jsx';
import { AuthProvider } from '../app/AuthProvider.jsx';
import { LanguageProvider } from '../app/LanguageProvider.jsx';
import * as authService from '../services/auth.js';
import * as noticeService from '../services/notices.js';

vi.mock('../services/auth.js', () => ({ getCurrentUser: vi.fn(), register: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('../services/notices.js', () => ({
  getNotice: vi.fn(),
  getNoticeText: vi.fn(),
  retryNoticeProcessing: vi.fn(),
  analyzeNotice: vi.fn(),
  getNoticeAnalysis: vi.fn(),
  verifyNoticeSource: vi.fn(),
}));

function renderDetails() {
  return render(<LanguageProvider><AuthProvider><MemoryRouter initialEntries={['/notices/notice-1']}>
    <Routes><Route path="/notices/:noticeId" element={<NoticeDetailsPage />} /></Routes>
  </MemoryRouter></AuthProvider></LanguageProvider>);
}

const notice = (status, extra = {}) => ({
  notice: { id: 'notice-1', filename: 'notice.pdf', authenticityStatus: 'unverified' },
  processing: { status, progress: 0, currentPage: 0, totalPages: null, attempts: 1, canRetry: false, ...extra },
});

beforeEach(() => {
  localStorage.clear();
  authService.getCurrentUser.mockResolvedValue({ id: 'user-1', email: 'citizen@example.test', languagePreference: 'en-IN' });
  noticeService.getNotice.mockReset();
  noticeService.getNoticeText.mockReset();
  noticeService.retryNoticeProcessing.mockReset();
  noticeService.analyzeNotice.mockReset();
  noticeService.getNoticeAnalysis.mockReset();
  noticeService.verifyNoticeSource.mockReset();
  noticeService.getNoticeAnalysis.mockResolvedValue({
    analysisStatus: 'idle',
    analysis: null,
    errorCode: null,
  });
});

const sourceReadyAnalysis = {
  documentCategory: null,
  title: { value: 'Water supply notice', evidence: 'Water supply notice', pageNumber: 1 },
  issuingDepartment: { value: 'Water Department', evidence: 'Water Department', pageNumber: 1 },
  noticeDate: { value: '15 May 2025', evidence: '15 May 2025', pageNumber: 1 },
  importantDates: [],
  locations: [],
  citizenInstructions: [],
  referenceNumbers: [],
  translatedPages: [],
  simpleExplanation: { sections: [] },
};

describe('notice details and extraction states', () => {
  it('links the current notice to the assistant with its notice ID', async () => {
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({ extractionMethod: 'digital', pages: [] });
    renderDetails();

    expect(await screen.findByRole('link', { name: 'Ask about this notice' }))
      .toHaveAttribute('href', '/assistant?noticeId=notice-1');
  });

  it('renders extracted pages with page references after completion', async () => {
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, currentPage: 2, totalPages: 2, extractionMethod: 'mixed' }));
    noticeService.getNoticeText.mockResolvedValue({ extractionMethod: 'mixed', pages: [
      { pageNumber: 1, method: 'digital', text: 'PUBLIC NOTICE' },
      { pageNumber: 2, method: 'ocr', text: 'WATER SUPPLY' },
    ] });
    renderDetails();

    expect(await screen.findByText('PUBLIC NOTICE')).toBeInTheDocument();
    expect(screen.getByText('WATER SUPPLY')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByText('Mixed digital text and OCR')).toBeInTheDocument();
  });

  it('shows page processing progress without requesting partial extraction', async () => {
    noticeService.getNotice.mockResolvedValue(notice('processing', { progress: 40, currentPage: 2, totalPages: 5 }));
    renderDetails();
    expect(await screen.findByText('Page 2 of 5')).toBeInTheDocument();
    expect(screen.getByText('Processing')).toBeInTheDocument();
    expect(noticeService.getNoticeText).not.toHaveBeenCalled();
  });

  it('retries a failed job and refreshes its status', async () => {
    const user = userEvent.setup();
    noticeService.getNotice.mockResolvedValueOnce(notice('failed', { canRetry: true, errorCode: 'PROCESSING_FAILED' }))
      .mockResolvedValue(notice('queued'));
    noticeService.retryNoticeProcessing.mockResolvedValue({ processing: { status: 'queued', progress: 0 } });
    renderDetails();
    await user.click(await screen.findByRole('button', { name: 'Retry processing' }));
    expect(noticeService.retryNoticeProcessing).toHaveBeenCalledWith('notice-1');
    expect(await screen.findByText('Queued')).toBeInTheDocument();
  });

  it('shows English and Telugu translations and simple explanations with evidence', async () => {
    const user = userEvent.setup();
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'PUBLIC NOTICE. Water supply interrupted.' }],
    });
    noticeService.getNoticeAnalysis.mockResolvedValue({
      analysisStatus: 'completed',
      analysis: {
        documentCategory: null,
        title: null,
        issuingDepartment: null,
        noticeDate: null,
        importantDates: [],
        locations: [],
        citizenInstructions: [],
        referenceNumbers: [],
        translatedPages: [{
          pageNumber: 1,
          englishText: 'PUBLIC NOTICE. Water supply interrupted.',
          teluguText: 'ప్రజా నోటీసు. నీటి సరఫరా నిలిపివేయబడింది.',
        }],
        simpleExplanation: {
          sections: [{
            english: 'Water supply will be interrupted.',
            telugu: 'నీటి సరఫరా నిలిపివేయబడుతుంది.',
            evidence: [{ value: 'Interrupted supply', evidence: 'Water supply interrupted', pageNumber: 1 }],
          }],
        },
      },
      errorCode: null,
    });

    renderDetails();

    expect((await screen.findAllByText('PUBLIC NOTICE. Water supply interrupted.')).length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Water supply will be interrupted.')).toBeInTheDocument();
    expect(screen.getByText(/AI-generated translation/)).toBeInTheDocument();
    expect(screen.getByText(/AI-generated explanation/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Telugu' }));

    expect(screen.getByText('ప్రజా నోటీసు. నీటి సరఫరా నిలిపివేయబడింది.')).toBeInTheDocument();
    expect(screen.getByText('నీటి సరఫరా నిలిపివేయబడుతుంది.')).toBeInTheDocument();
  });

  it('shows missing bilingual content and analysis error states', async () => {
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'ORIGINAL NOTICE TEXT' }],
    });
    noticeService.getNoticeAnalysis.mockResolvedValue({
      analysisStatus: 'completed',
      analysis: {
        documentCategory: null,
        title: null,
        issuingDepartment: null,
        noticeDate: null,
        importantDates: [],
        locations: [],
        citizenInstructions: [],
        referenceNumbers: [],
      },
      errorCode: null,
    });

    renderDetails();

    expect(await screen.findByText('English and Telugu translations are not available for this notice.')).toBeInTheDocument();
    expect(screen.getByText('A simple explanation is not available for this notice.')).toBeInTheDocument();
    expect(screen.getByText('ORIGINAL NOTICE TEXT')).toBeInTheDocument();
  });

  it('shows an analysis error and keeps the retry action available', async () => {
    const user = userEvent.setup();
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'ORIGINAL NOTICE TEXT' }],
    });
    noticeService.analyzeNotice.mockRejectedValue({
      response: { data: { error: { code: 'GEMINI_UNAVAILABLE' } } },
    });
    renderDetails();

    await user.click(await screen.findByRole('button', { name: 'Analyse notice' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not analyse this notice');
  });

  it('checks a candidate source and displays matched metadata and evidence without authenticating the notice', async () => {
    const user = userEvent.setup();
    let resolveVerification;
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'Water supply notice. Water Department. 15 May 2025.' }],
    });
    noticeService.getNoticeAnalysis.mockResolvedValue({
      analysisStatus: 'completed',
      analysis: sourceReadyAnalysis,
      errorCode: null,
    });
    noticeService.verifyNoticeSource.mockReturnValue(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    const verificationResult = {
      authenticityStatus: 'unverified',
      sourceVerification: {
        status: 'match_found',
        sourceName: 'Andhra Pradesh Gazette',
        sourceOrganization: 'Commissionerate of Printing, Andhra Pradesh',
        sourceUrl: 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fnotice.pdf',
        publicationDate: '15 May 2025',
        checkedAt: '2026-04-10T00:00:00.000Z',
        evidence: [{
          field: 'title',
          noticePageNumber: 1,
          noticeEvidence: 'Water supply notice',
          sourcePageNumber: 2,
          sourceEvidence: 'Water supply notice, Water Department',
        }],
        reason: null,
      },
    };

    renderDetails();

    await user.type(await screen.findByLabelText('Official government PDF URL'), 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fnotice.pdf');
    await user.type(screen.getByLabelText('Publication date shown on source'), '15 May 2025');
    const submit = screen.getByRole('button', { name: 'Check official source' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(screen.getAllByText('Checking source…')).toHaveLength(2);
    resolveVerification(verificationResult);

    expect(await screen.findByText('Official source match found for this candidate')).toBeInTheDocument();
    expect(screen.getByText('Notice authenticity remains unverified. A source match alone does not establish that the uploaded notice is authentic.')).toBeInTheDocument();
    expect(screen.getByText('Water supply notice, Water Department')).toBeInTheDocument();
    expect(screen.getByText('Uploaded notice, page 1:')).toBeInTheDocument();
    expect(screen.getByText('Official publication, page 2:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Andhra Pradesh Gazette' })).toHaveAttribute(
      'href',
      'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fnotice.pdf',
    );
    expect(noticeService.verifyNoticeSource).toHaveBeenCalledWith('notice-1', {
      candidateUrl: 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fnotice.pdf',
      publicationDate: '15 May 2025',
    });
  });

  it('keeps no-match and unavailable states distinct and displays them in Telugu', async () => {
    authService.getCurrentUser.mockResolvedValue({
      id: 'user-1',
      email: 'citizen@example.test',
      languagePreference: 'te-IN',
    });
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'ORIGINAL NOTICE' }],
    });
    noticeService.getNoticeAnalysis.mockResolvedValue({
      analysisStatus: 'completed',
      analysis: sourceReadyAnalysis,
      errorCode: null,
    });
    noticeService.verifyNoticeSource.mockResolvedValueOnce({
      sourceVerification: {
        status: 'no_match',
        sourceName: 'Andhra Pradesh Gazette',
        sourceOrganization: 'Commissionerate of Printing, Andhra Pradesh',
        sourceUrl: 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fcandidate.pdf',
        publicationDate: null,
        checkedAt: '2026-04-10T00:00:00.000Z',
        evidence: [],
        reason: null,
      },
    });
    renderDetails();

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('అధికారిక ప్రభుత్వ PDF URL'), 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fcandidate.pdf');
    await user.type(screen.getByLabelText('మూలంలో చూపిన ప్రచురణ తేదీ'), '15 మే 2025');
    const submit = screen.getByRole('button', { name: 'అధికారిక మూలాన్ని తనిఖీ చేయండి' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByText('ఈ సూచించిన ప్రచురణ నోటీసుతో సరిపోలలేదు')).toBeInTheDocument();
    expect(screen.getByText('ఈ ఫలితం మీరు అందించిన ప్రచురణకు మాత్రమే వర్తిస్తుంది; దీని అర్థం నోటీసు నకిలీ అని కాదు.')).toBeInTheDocument();

    noticeService.verifyNoticeSource.mockResolvedValueOnce({
      sourceVerification: {
        status: 'unavailable',
        sourceName: 'Andhra Pradesh Gazette',
        sourceOrganization: 'Commissionerate of Printing, Andhra Pradesh',
        sourceUrl: 'https://apegazette.cgg.gov.in/preview.do?fileName=%2Fcandidate.pdf',
        publicationDate: null,
        checkedAt: '2026-04-10T00:00:00.000Z',
        evidence: [],
        reason: 'SOURCE_FETCH_FAILED',
      },
    });
    await user.click(submit);
    expect(await screen.findByText('ధృవీకరణ అందుబాటులో లేదు')).toBeInTheDocument();
    expect(screen.getByText('అధికారిక మూలం నుండి సూచించిన ప్రచురణను పొందలేకపోయాం.')).toBeInTheDocument();
  });

  it('shows a clear error when the candidate URL is outside the supported source registry', async () => {
    const user = userEvent.setup();
    noticeService.getNotice.mockResolvedValue(notice('completed', { progress: 100, extractionMethod: 'digital' }));
    noticeService.getNoticeText.mockResolvedValue({
      extractionMethod: 'digital',
      pages: [{ pageNumber: 1, method: 'digital', text: 'ORIGINAL NOTICE' }],
    });
    noticeService.getNoticeAnalysis.mockResolvedValue({
      analysisStatus: 'completed',
      analysis: sourceReadyAnalysis,
      errorCode: null,
    });
    noticeService.verifyNoticeSource.mockRejectedValueOnce({
      response: { data: { error: { code: 'SOURCE_URL_UNSUPPORTED' } } },
    });
    renderDetails();

    await user.type(await screen.findByLabelText('Official government PDF URL'), 'https://example.invalid/notice.pdf');
    await user.type(screen.getByLabelText('Publication date shown on source'), '15 May 2025');
    const submit = screen.getByRole('button', { name: 'Check official source' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use a direct PDF publication link from a supported Indian government domain (.gov.in or .nic.in), or a supported Andhra Pradesh Gazette publication URL.',
    );
    expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  });
});
