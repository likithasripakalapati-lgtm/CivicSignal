
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config/env.js';

const OFFICIAL_SOURCES = new Map([
  ['apegazette.cgg.gov.in', {
    name: 'Andhra Pradesh Gazette',
    organization: 'Commissionerate of Printing, Stationary & Stores Purchase, Andhra Pradesh',
  }],
]);

const MAX_SOURCE_PDF_BYTES = config.uploadMaxFileSizeBytes;
const MAX_SOURCE_PDF_CHARACTERS = 2_000_000;
const SOURCE_FETCH_TIMEOUT_MS = 10_000;

function fail(code, message) {
  return Object.assign(new Error(message), { code });
}

function normalizeText(value) {
  return Array.from(value.normalize('NFKC').toLocaleLowerCase('en'))
    .map((character) =>
      /[\p{L}\p{N}]/u.test(character) ? character : ' ',
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSource(candidateUrl) {
  let url;

  try {
    url = new URL(candidateUrl);
  } catch {
    throw fail(
      'SOURCE_URL_UNSUPPORTED',
      'The publication URL is not supported.',
    );
  }

  const hostname = url.hostname.toLowerCase();
  const gazetteSource = OFFICIAL_SOURCES.get(hostname);
  const isGazette = Boolean(gazetteSource);

  const isIndianGovernmentDomain =
    hostname.endsWith('.gov.in') ||
    hostname.endsWith('.nic.in');

  const rawPath =
    candidateUrl.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? '';

  const queryStart = candidateUrl.indexOf('?');
  const queryEntries = queryStart < 0
    ? []
    : candidateUrl.slice(queryStart + 1).split('&');

  const hasSingleParameter = (name) =>
    queryEntries.length === 1 &&
    queryEntries[0].startsWith(`${name}=`) &&
    queryEntries[0].length > name.length + 1;

  const isGazetteRoute =
    isGazette &&
    (
      (
        url.pathname === '/uploadGazette_view' &&
        hasSingleParameter('filePath')
      ) ||
      (
        url.pathname === '/preview.do' &&
        hasSingleParameter('fileName')
      )
    );

  const isDirectGovernmentPdf =
    isIndianGovernmentDomain &&
    url.pathname.toLowerCase().endsWith('.pdf');

  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    rawPath !== url.pathname ||
    (!isGazetteRoute && !isDirectGovernmentPdf)
  ) {
    throw fail(
      'SOURCE_URL_UNSUPPORTED',
      'Use a direct PDF publication link from a supported Indian government domain.',
    );
  }

  const source = gazetteSource ?? {
    name: hostname,
    organization:
      'Indian government domain (domain-based identification; not independently authenticated)',
  };

  return { source };
}

function unavailable(
  sourceUrl,
  source,
  reason,
  checkedAt = new Date(),
) {
  return {
    status: 'unavailable',
    sourceName: source?.name ?? null,
    sourceOrganization: source?.organization ?? null,
    sourceUrl,
    publicationDate: null,
    checkedAt,
    evidence: [],
    reason,
  };
}

async function readBoundedBody(response) {
  const contentLength = Number(
    response.headers.get('content-length'),
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_SOURCE_PDF_BYTES
  ) {
    return null;
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    return bytes.length <= MAX_SOURCE_PDF_BYTES
      ? bytes
      : null;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      total += value.byteLength;

      if (total > MAX_SOURCE_PDF_BYTES) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return result;
}

async function fetchSourcePdf(url) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SOURCE_FETCH_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/pdf',
      },
      redirect: 'manual',
      signal: controller.signal,
    });

    if (!response.ok || response.status >= 300) {
      return { reason: 'SOURCE_FETCH_FAILED' };
    }

    const contentType = response.headers
      .get('content-type')
      ?.split(';')[0]
      .trim()
      .toLowerCase();

    if (
      contentType !== 'application/pdf' &&
      contentType !== 'application/octet-stream'
    ) {
      return { reason: 'SOURCE_DOCUMENT_INVALID' };
    }

    const bytes = await readBoundedBody(response);

    if (!bytes) {
      return { reason: 'SOURCE_DOCUMENT_INVALID' };
    }

    const prefix = new TextDecoder().decode(
      bytes.subarray(0, 1024),
    );

    if (!prefix.includes('%PDF-')) {
      return { reason: 'SOURCE_DOCUMENT_INVALID' };
    }

    return { bytes };
  } catch {
    return { reason: 'SOURCE_FETCH_FAILED' };
  } finally {
    clearTimeout(timeout);
  }
}

async function extractSourcePages(bytes) {
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    isEvalSupported: false,
  });

  let pdf;

  try {
    pdf = await loadingTask.promise;

    if (
      !pdf.numPages ||
      pdf.numPages > config.uploadMaxPdfPages
    ) {
      return null;
    }

    const pages = [];
    let totalCharacters = 0;

    for (
      let pageNumber = 1;
      pageNumber <= pdf.numPages;
      pageNumber += 1
    ) {
      const page = await pdf.getPage(pageNumber);

      try {
        const content = await page.getTextContent();

        const text = content.items
          .map((item) => item.str ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();

        totalCharacters += text.length;

        if (totalCharacters > MAX_SOURCE_PDF_CHARACTERS) {
          return null;
        }

        pages.push({
          pageNumber,
          text,
        });
      } finally {
        page.cleanup();
      }
    }

    return pages.some((page) => page.text)
      ? pages
      : null;
  } catch {
    return null;
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

function getNormalizedWithOffsets(value) {
  const rawCharacters = Array.from(value);
  const normalizedCharacters = [];
  const rawOffsets = [];

  for (const [rawOffset, rawCharacter] of rawCharacters.entries()) {
    for (
      const character of Array.from(
        rawCharacter.normalize('NFKC').toLocaleLowerCase('en'),
      )
    ) {
      if (/[\p{L}\p{N}]/u.test(character)) {
        normalizedCharacters.push(character);
        rawOffsets.push(rawOffset);
      } else if (
        normalizedCharacters.length &&
        normalizedCharacters.at(-1) !== ' '
      ) {
        normalizedCharacters.push(' ');
        rawOffsets.push(rawOffset);
      }
    }
  }

  while (normalizedCharacters.at(-1) === ' ') {
    normalizedCharacters.pop();
    rawOffsets.pop();
  }

  return {
    normalized: normalizedCharacters.join(''),
    rawCharacters,
    rawOffsets,
  };
}

function findSourceEvidence(pages, value) {
  const query = normalizeText(value);

  if (!query) return null;

  for (const page of pages) {
    const {
      normalized,
      rawCharacters,
      rawOffsets,
    } = getNormalizedWithOffsets(page.text);

    const index = normalized.indexOf(query);

    if (index < 0) continue;

    const start = Math.max(
      0,
      rawOffsets[index] - 100,
    );

    const end = Math.min(
      rawCharacters.length,
      rawOffsets[index + query.length - 1] + 101,
    );

    return {
      pageNumber: page.pageNumber,
      text: rawCharacters
        .slice(start, end)
        .join('')
        .trim()
        .slice(0, 1200),
    };
  }

  return null;
}

function hasValidatedNoticeFact(fact, pages) {
  if (
    !fact?.value ||
    !fact.evidence ||
    !Number.isInteger(fact.pageNumber)
  ) {
    return false;
  }

  const page = pages.find(
    (item) => item.pageNumber === fact.pageNumber,
  );

  if (
    !page ||
    !normalizeText(page.text).includes(
      normalizeText(fact.evidence),
    )
  ) {
    return false;
  }

  return normalizeText(fact.evidence).includes(
    normalizeText(fact.value),
  );
}

function hasRequiredNoticeMetadata(analysis, noticePages) {
  return [
    analysis?.title,
    analysis?.issuingDepartment,
    analysis?.noticeDate,
  ].every((fact) =>
    hasValidatedNoticeFact(fact, noticePages),
  );
}

function matchPublication(
  analysis,
  noticePages,
  sourcePages,
  publicationDate,
) {
  const facts = [
    {
      field: 'title',
      fact: analysis?.title,
    },
    {
      field: 'issuingDepartment',
      fact: analysis?.issuingDepartment,
    },
    {
      field: 'noticeDate',
      fact: analysis?.noticeDate,
    },
  ];

  if (
    !facts.every(({ fact }) =>
      hasValidatedNoticeFact(fact, noticePages),
    )
  ) {
    return null;
  }

  const evidence = [];

  for (const { field, fact } of facts) {
    const sourceEvidence = findSourceEvidence(
      sourcePages,
      fact.value,
    );

    if (!sourceEvidence) return null;

    evidence.push({
      field,
      noticePageNumber: fact.pageNumber,
      noticeEvidence: fact.evidence,
      sourcePageNumber: sourceEvidence.pageNumber,
      sourceEvidence: sourceEvidence.text,
    });
  }

  const dateEvidence = findSourceEvidence(
    sourcePages,
    publicationDate,
  );

  if (!dateEvidence) return null;

  evidence.push({
    field: 'publicationDate',
    noticePageNumber: null,
    noticeEvidence: null,
    sourcePageNumber: dateEvidence.pageNumber,
    sourceEvidence: dateEvidence.text,
  });

  return evidence;
}

export async function verifyOfficialPublication({
  candidateUrl,
  publicationDate,
  analysis,
  noticePages,
}) {
  const { source } = getSource(candidateUrl);
  const checkedAt = new Date();
  const sourceUrl = candidateUrl;

  if (
    !hasRequiredNoticeMetadata(
      analysis,
      noticePages ?? [],
    )
  ) {
    return unavailable(
      sourceUrl,
      source,
      'SOURCE_METADATA_INSUFFICIENT',
      checkedAt,
    );
  }

  const fetched = await fetchSourcePdf(candidateUrl);

  if (!fetched.bytes) {
    return unavailable(
      sourceUrl,
      source,
      fetched.reason,
      checkedAt,
    );
  }

  const sourcePages = await extractSourcePages(
    fetched.bytes,
  );

  if (!sourcePages) {
    return unavailable(
      sourceUrl,
      source,
      'SOURCE_TEXT_UNAVAILABLE',
      checkedAt,
    );
  }

  const evidence = matchPublication(
    analysis,
    noticePages ?? [],
    sourcePages,
    publicationDate,
  );

  if (!evidence) {
    return {
      status: 'no_match',
      sourceName: source.name,
      sourceOrganization: source.organization,
      sourceUrl,
      publicationDate: null,
      checkedAt,
      evidence: [],
      reason: null,
    };
  }

  return {
    status: 'match_found',
    sourceName: source.name,
    sourceOrganization: source.organization,
    sourceUrl,
    publicationDate,
    checkedAt,
    evidence,
    reason: null,
  };
}
