import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleMocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor() {
      this.models = { generateContent: googleMocks.generateContent };
    }
  },
}));

import { analyzeNoticeText, answerNoticeQuestion } from '../src/services/geminiAnalysis.service.js';

function jsonResponse(value) {
  return { text: JSON.stringify(value) };
}

const extraction = {
  documentCategory: {
    value: 'public_notice',
    evidence: 'PUBLIC NOTICE',
    pageNumber: 1,
  },
  title: {
    value: 'Water supply interruption',
    evidence: 'Water supply interruption',
    pageNumber: 1,
  },
  issuingDepartment: null,
  noticeDate: null,
  importantDates: [],
  locations: [{
    value: 'Tambaram',
    evidence: 'Tambaram',
    pageNumber: 1,
  }],
  citizenInstructions: [],
  referenceNumbers: [],
};

beforeEach(() => {
  googleMocks.generateContent.mockReset();
});

describe('bilingual notice analysis', () => {
  it('constrains Gemini JSON output and identifies structurally incomplete extraction', async () => {
    const incompleteExtraction = { ...extraction };
    delete incompleteExtraction.referenceNumbers;
    googleMocks.generateContent.mockResolvedValueOnce(jsonResponse(incompleteExtraction));

    await expect(analyzeNoticeText([{
      pageNumber: 1,
      method: 'digital',
      text: 'PUBLIC NOTICE',
    }])).rejects.toMatchObject({
      code: 'GEMINI_INVALID_RESPONSE',
      failureReason: 'extraction_schema',
    });

    const request = googleMocks.generateContent.mock.calls[0][0];
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.responseJsonSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        referenceNumbers: { type: 'array', maxItems: 30 },
      },
    });
    expect(request.config.responseJsonSchema.required).toContain('referenceNumbers');
    expect(JSON.stringify(request.config.responseJsonSchema)).not.toMatch(/minLength|maxLength|\$schema/);
  });

  it('logs only safe Gemini error metadata when the API request fails', async () => {
    googleMocks.generateContent.mockRejectedValueOnce(Object.assign(
      new Error('Sensitive provider response'),
      { status: 404, code: 'MODEL_NOT_FOUND' },
    ));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(analyzeNoticeText([{
        pageNumber: 1,
        method: 'digital',
        text: 'PUBLIC NOTICE',
      }])).rejects.toMatchObject({ code: 'GEMINI_REQUEST_FAILED' });

      expect(errorLog).toHaveBeenCalledWith('Gemini request failed', {
        status: 404,
        errorCode: 'MODEL_NOT_FOUND',
        errorName: 'Error',
      });
      expect(JSON.stringify(errorLog.mock.calls)).not.toContain('Sensitive provider response');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('returns faithful page translations and bilingual simple explanations', async () => {
    googleMocks.generateContent
      .mockResolvedValueOnce(jsonResponse(extraction))
      .mockResolvedValueOnce(jsonResponse({
        translatedPages: [{
          pageNumber: 1,
          englishText: 'PUBLIC NOTICE. Water supply interruption in Tambaram.',
          teluguText: 'ప్రజా నోటీసు. తంబరం లో నీటి సరఫరా నిలిపివేత.',
        }],
        simpleExplanation: {
          english: 'Water supply will stop in Tambaram.',
          telugu: 'తంబరం లో నీటి సరఫరా నిలిపివేయబడుతుంది.',
          evidence: [{
            value: 'Water supply interruption',
            evidence: 'Water supply interruption',
            pageNumber: 1,
          }],
        },
      }));

    const result = await analyzeNoticeText([{
      pageNumber: 1,
      method: 'digital',
      text: 'PUBLIC NOTICE. Water supply interruption in Tambaram.',
    }]);

    expect(result.translatedPages).toEqual([{
      pageNumber: 1,
      englishText: 'PUBLIC NOTICE. Water supply interruption in Tambaram.',
      teluguText: 'ప్రజా నోటీసు. తంబరం లో నీటి సరఫరా నిలిపివేత.',
    }]);
    expect(googleMocks.generateContent.mock.calls[0][0].config.responseJsonSchema.required)
      .toEqual(expect.arrayContaining(['documentCategory', 'referenceNumbers']));
    expect(googleMocks.generateContent.mock.calls[1][0].config.responseJsonSchema.required)
      .toEqual(expect.arrayContaining(['translatedPages', 'simpleExplanation']));
    expect(result.simpleExplanation.sections).toHaveLength(1);
    expect(result.simpleExplanation.sections[0].english).toBe('Water supply will stop in Tambaram.');
  });

  describe('grounded assistant answers', () => {
    it('rejects evidence quotes that do not appear on the cited notice page', async () => {
      googleMocks.generateContent.mockResolvedValueOnce(jsonResponse({
        answer: 'A subsidy is available.',
        answerable: true,
        evidence: [{
          noticeId: 'notice-1',
          pageNumber: 4,
          quote: 'This invented quote is not in the notice.',
        }],
      }));

      await expect(answerNoticeQuestion({
        question: 'What is available?',
        language: 'en',
        sources: [{
          noticeId: 'notice-1',
          filename: 'notice.pdf',
          pages: [{ pageNumber: 4, text: 'Water supply will be interrupted.' }],
        }],
      })).rejects.toMatchObject({ code: 'GEMINI_EVIDENCE_INVALID' });
    });

    it('accepts a source quote only for the matching notice and page', async () => {
      googleMocks.generateContent.mockResolvedValueOnce(jsonResponse({
        answer: 'Water supply will be interrupted.',
        answerable: true,
        evidence: [{
          noticeId: 'notice-1',
          pageNumber: 4,
          quote: 'Water supply will be interrupted.',
        }],
      }));

      await expect(answerNoticeQuestion({
        question: 'What will happen?',
        language: 'en',
        sources: [{
          noticeId: 'notice-1',
          filename: 'notice.pdf',
          pages: [{ pageNumber: 4, text: 'Water supply will be interrupted.' }],
        }],
      })).resolves.toMatchObject({
        answerable: true,
        evidence: [{ noticeId: 'notice-1', pageNumber: 4 }],
      });
    });
  });

  it('handles long documents in bounded batches', async () => {
    const sourcePages = Array.from({ length: 9 }, (_, index) => ({
      pageNumber: index + 1,
      method: 'digital',
      text: `PUBLIC NOTICE PAGE ${index + 1}`,
    }));
    const extractionWithLocation = {
      ...extraction,
      locations: [],
      documentCategory: null,
      title: null,
    };

    googleMocks.generateContent.mockResolvedValueOnce(jsonResponse(extractionWithLocation));
    googleMocks.generateContent.mockResolvedValueOnce(jsonResponse({
      translatedPages: sourcePages.slice(0, 8).map((page) => ({
        pageNumber: page.pageNumber,
        englishText: `Translation ${page.pageNumber}`,
        teluguText: `అనువాదం ${page.pageNumber}`,
      })),
      simpleExplanation: {
        english: 'The first pages contain public notice information.',
        telugu: 'మొదటి పేజీలు ప్రజా నోటీసు సమాచారాన్ని కలిగి ఉన్నాయి.',
        evidence: [{
          value: 'Public notice',
          evidence: 'PUBLIC NOTICE PAGE 1',
          pageNumber: 1,
        }],
      },
    }));
    googleMocks.generateContent.mockResolvedValueOnce(jsonResponse({
      translatedPages: [{
        pageNumber: 9,
        englishText: 'Translation 9',
        teluguText: 'అనువాదం 9',
      }],
      simpleExplanation: {
        english: 'The final page contains public notice information.',
        telugu: 'చివరి పేజీ ప్రజా నోటీసు సమాచారాన్ని కలిగి ఉంది.',
        evidence: [{
          value: 'Public notice',
          evidence: 'PUBLIC NOTICE PAGE 9',
          pageNumber: 9,
        }],
      },
    }));

    const result = await analyzeNoticeText(sourcePages);

    expect(googleMocks.generateContent).toHaveBeenCalledTimes(3);
    expect(result.translatedPages).toHaveLength(9);
    expect(result.simpleExplanation.sections).toHaveLength(2);
  });

  it('rejects output that omits a source page', async () => {
    const minimalExtraction = {
      ...extraction,
      documentCategory: null,
      title: null,
      locations: [],
    };
    googleMocks.generateContent
      .mockResolvedValueOnce(jsonResponse(minimalExtraction))
      .mockResolvedValueOnce(jsonResponse({
        translatedPages: [],
        simpleExplanation: {
          english: 'The notice contains water supply information.',
          telugu: 'నోటీసులో నీటి సరఫరా సమాచారం ఉంది.',
          evidence: [{
            value: 'Water supply',
            evidence: 'PUBLIC NOTICE',
            pageNumber: 1,
          }],
        },
      }));

    await expect(analyzeNoticeText([{
      pageNumber: 1,
      method: 'digital',
      text: 'PUBLIC NOTICE.',
    }])).rejects.toMatchObject({ code: 'GEMINI_INVALID_RESPONSE' });
  });

  it('rejects explanation evidence not found on the stated page', async () => {
    const minimalExtraction = {
      ...extraction,
      documentCategory: null,
      title: null,
      locations: [],
    };
    googleMocks.generateContent
      .mockResolvedValueOnce(jsonResponse(minimalExtraction))
      .mockResolvedValueOnce(jsonResponse({
        translatedPages: [{
          pageNumber: 1,
          englishText: 'PUBLIC NOTICE.',
          teluguText: 'ప్రజా నోటీసు.',
        }],
        simpleExplanation: {
          english: 'The notice contains unsupported information.',
          telugu: 'నోటీసులో మద్దతు లేని సమాచారం ఉంది.',
          evidence: [{
            value: 'Unsupported claim',
            evidence: 'THIS TEXT DOES NOT EXIST',
            pageNumber: 1,
          }],
        },
      }));

    await expect(analyzeNoticeText([{
      pageNumber: 1,
      method: 'digital',
      text: 'PUBLIC NOTICE.',
    }])).rejects.toMatchObject({ code: 'GEMINI_EVIDENCE_INVALID' });
  });
});
