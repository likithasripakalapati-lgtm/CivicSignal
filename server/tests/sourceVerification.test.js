import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyOfficialPublication } from '../src/services/sourceVerification.service.js';

function createTextPdf(text) {
  const escapedText = text.replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
    .replaceAll('/', '\\057');
  const stream = `BT /F1 6 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document);
}

const candidateUrl = 'https://apegazette.cgg.gov.in/preview.do?fileName=%2FUploads%2Fnotice.pdf';
const publicationDate = '15 May 2025';
const analysis = {
  title: { value: 'Water Supply Interruption', evidence: 'Water Supply Interruption Notice', pageNumber: 1 },
  issuingDepartment: { value: 'Municipal Water Department', evidence: 'Municipal Water Department', pageNumber: 1 },
  noticeDate: { value: '15 May 2025', evidence: 'Dated 15 May 2025', pageNumber: 1 },
};
const noticePages = [{
  pageNumber: 1,
  text: 'Water Supply Interruption Notice. Municipal Water Department. Dated 15 May 2025.',
}];
const sourceText = 'Andhra Pradesh Gazette. Municipal Water Department. Water Supply Interruption Notice. Dated 15 May 2025. Published 15 May 2025.';

function mockPdfResponse(bytes) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/pdf' },
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('official source verification', () => {
  it('matches metadata and records supporting text from the official PDF pages', async () => {
    mockPdfResponse(createTextPdf(sourceText));

    const result = await verifyOfficialPublication({
      candidateUrl,
      publicationDate,
      analysis,
      noticePages,
    });

    expect(result).toMatchObject({
      status: 'match_found',
      sourceName: 'Andhra Pradesh Gazette',
      sourceOrganization: expect.stringContaining('Andhra Pradesh'),
      sourceUrl: candidateUrl,
      publicationDate,
    });
    expect(result.evidence).toHaveLength(4);
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'title',
        noticePageNumber: 1,
        sourcePageNumber: 1,
        sourceEvidence: expect.stringContaining('Water Supply Interruption'),
      }),
      expect.objectContaining({
        field: 'publicationDate',
        sourcePageNumber: 1,
        sourceEvidence: expect.stringContaining('15 May 2025'),
      }),
    ]));
  });
  it('accepts direct APSDMA government PDF links', async () => {
  const apsdmaUrl =
    'https://apsdma.ap.gov.in/files/2e2bb9d70ef9b9ab262f4a59b169f842.pdf';

  mockPdfResponse(createTextPdf(sourceText));

  const result = await verifyOfficialPublication({
    candidateUrl: apsdmaUrl,
    publicationDate,
    analysis,
    noticePages,
  });

  expect(result).toMatchObject({
    status: 'match_found',
    sourceName: 'apsdma.ap.gov.in',
    sourceUrl: apsdmaUrl,
    publicationDate,
  });
});

  it('accepts the official uploadGazette_view route and matches slash dates against hyphen dates', async () => {
    const uploadRouteUrl = 'https://apegazette.cgg.gov.in/uploadGazette_view?filePath=opaque-token%2Fpublication';
    const mockedFetch = vi.fn().mockResolvedValue(new Response(
      createTextPdf(`${sourceText} Published 20-11-2026.`),
      { status: 200, headers: { 'content-type': 'application/pdf' } },
    ));
    vi.stubGlobal('fetch', mockedFetch);

    const result = await verifyOfficialPublication({
      candidateUrl: uploadRouteUrl,
      publicationDate: '20/11/2026',
      analysis,
      noticePages,
    });

    expect(result).toMatchObject({
      status: 'match_found',
      sourceUrl: uploadRouteUrl,
      publicationDate: '20/11/2026',
    });
    expect(result.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: 'publicationDate',
        sourceEvidence: expect.stringContaining('20-11-2026'),
      }),
    ]));
    expect(mockedFetch).toHaveBeenCalledWith(uploadRouteUrl, expect.objectContaining({
      method: 'GET',
      redirect: 'manual',
    }));
  });

  it('returns no_match when readable official source text does not corroborate the notice metadata', async () => {
    mockPdfResponse(createTextPdf('Different Department. Another publication. 20/05/2025.'));

    const result = await verifyOfficialPublication({
      candidateUrl,
      publicationDate,
      analysis,
      noticePages,
    });

    expect(result).toMatchObject({ status: 'no_match', publicationDate: null, evidence: [] });
  });

  it('returns unavailable for redirects rather than following them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: 'https://attacker.invalid/publication.pdf' },
    })));

    const result = await verifyOfficialPublication({
      candidateUrl,
      publicationDate,
      analysis,
      noticePages,
    });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'SOURCE_FETCH_FAILED' });
    expect(fetch).toHaveBeenCalledWith(candidateUrl, expect.objectContaining({ redirect: 'manual' }));
  });

  it('rejects spoofed, non-HTTPS, and non-publication URLs before fetching', async () => {
    const mockedFetch = vi.fn();
    vi.stubGlobal('fetch', mockedFetch);
    const urls = [
      'https://apegazette.cgg.gov.in.attacker.invalid/preview.do?fileName=%2FUploads%2Fnotice.pdf',
      'http://apegazette.cgg.gov.in/preview.do?fileName=%2FUploads%2Fnotice.pdf',
      'https://apegazette.cgg.gov.in/fileShow?fileName=%2FUploads%2Fnotice.pdf',
      'https://user:password@apegazette.cgg.gov.in/preview.do?fileName=opaque',
      'https://apegazette.cgg.gov.in/uploadGazette_view?filePath=opaque&extra=value',
      'https://apegazette.cgg.gov.in/uploadGazette_view?fileName=opaque',
      'https://apegazette.cgg.gov.in/uploadGazette_view?filePath=',
      'https://apegazette.cgg.gov.in/uploadGazette_view?filePath=one&filePath=two',
      'https://apegazette.cgg.gov.in/preview.do?fileName=opaque&extra=value',
      'https://apegazette.cgg.gov.in/preview.do?fileName=opaque#fragment',
    ];

    for (const unsupportedUrl of urls) {
      await expect(verifyOfficialPublication({
        candidateUrl: unsupportedUrl,
        publicationDate,
        analysis,
        noticePages,
      })).rejects.toMatchObject({ code: 'SOURCE_URL_UNSUPPORTED' });
    }

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('does not call an unreadable candidate an unmatched publication', async () => {
    mockPdfResponse(Buffer.from('not a PDF'));

    const result = await verifyOfficialPublication({
      candidateUrl,
      publicationDate,
      analysis,
      noticePages,
    });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'SOURCE_DOCUMENT_INVALID' });
  });

  it('returns unavailable when the uploaded notice lacks validated metadata', async () => {
    const mockedFetch = vi.fn();
    vi.stubGlobal('fetch', mockedFetch);

    const result = await verifyOfficialPublication({
      candidateUrl,
      publicationDate,
      analysis: { ...analysis, issuingDepartment: null },
      noticePages,
    });

    expect(result).toMatchObject({ status: 'unavailable', reason: 'SOURCE_METADATA_INSUFFICIENT' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
