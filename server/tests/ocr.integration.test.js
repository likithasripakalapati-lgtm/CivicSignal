import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertTrainedDataAvailable, createLocalOcrWorker, tessdataDirectory } from '../src/services/ocr.service.js';
import { extractDocument } from '../src/services/documentExtraction.service.js';

let worker;
let workingDirectory;

function makePdf(objects) {
  const pieces = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  let length = pieces[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n'),
    ]);
    pieces.push(chunk);
    length += chunk.length;
  });
  const xrefOffset = length;
  const xref = Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  return Buffer.concat([...pieces, xref]);
}

function makeTextPdf(lines) {
  const pageIds = lines.map((_line, index) => 3 + index * 2);
  const fontId = 3 + lines.length * 2;
  const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>')];
  objects.push(Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${lines.length} >>`));
  lines.forEach((line, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const stream = Buffer.from(`BT /F1 24 Tf 50 700 Td (${line}) Tj ET`);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from('\nendstream')]));
  });
  objects.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
  return makePdf(objects);
}

function makeScannedPdf(jpeg, width, height) {
  const content = Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`);
  const imageObject = Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
    jpeg, Buffer.from('\nendstream'),
  ]);
  return makePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 260] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    imageObject,
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
  ]);
}

function makeMixedPdf(jpeg, width, height) {
  const digitalText = Buffer.from('BT /F1 24 Tf 50 700 Td (PUBLIC NOTICE 2026) Tj ET');
  const scanCommand = Buffer.from(`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`);
  const imageObject = Buffer.concat([
    Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
    jpeg, Buffer.from('\nendstream'),
  ]);
  return makePdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 800] /Resources << /Font << /F1 8 0 R >> >> /Contents 4 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Length ${digitalText.length} >>\nstream\n`), digitalText, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 260] /Resources << /XObject << /Im0 6 0 R >> >> /Contents 7 0 R >>'),
    imageObject,
    Buffer.concat([Buffer.from(`<< /Length ${scanCommand.length} >>\nstream\n`), scanCommand, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
  ]);
}

function makeSampleImage() {
  const canvas = createCanvas(1500, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1500, 300);
  context.fillStyle = '#111';
  context.font = '64px Arial';
  context.fillText('PUBLIC NOTICE 2026', 40, 100);
  context.font = '64px "Nirmala UI"';
  context.fillText('నీటి సరఫరా', 40, 220);
  return canvas.toBuffer('image/jpeg', 92);
}

function expectedWords(text) {
  const lower = text.toLocaleLowerCase();
  return lower.includes('public') && lower.includes('notice')
    && (lower.includes('నీటి') || lower.includes('సరఫరా'));
}

describe('local Tesseract.js extraction', () => {
  beforeAll(async () => {
    await assertTrainedDataAvailable();
    worker = await createLocalOcrWorker();
    workingDirectory = await mkdtemp(join(tmpdir(), 'civicsignal-ocr-test-'));
  }, 30000);

  afterAll(async () => {
    if (worker) await worker.terminate();
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  });

  it('loads the local English and Telugu trained data files', async () => {
    await assertTrainedDataAvailable();
    expect(tessdataDirectory).toContain('tessdata');
  });

  it('extracts selectable text from each digital PDF page with page numbers', async () => {
    const path = join(workingDirectory, 'digital.pdf');
    await writeFile(path, makeTextPdf(['PUBLIC NOTICE 2026', 'SECOND PAGE 2027']));
    const progress = [];
    const output = await extractDocument({ path, contentType: 'application/pdf', worker, onPageProgress: (page) => progress.push(page) });
    expect(output.extractionMethod).toBe('digital');
    expect(output.extractedPages.map(({ pageNumber }) => pageNumber)).toEqual([1, 2]);
    expect(output.extractedPages[0].text.toLowerCase()).toContain('public notice');
    expect(output.extractedPages[1].text.toLowerCase()).toContain('second page');
    expect(progress).toEqual([1, 2]);
  });

  it('uses OCR for an image and matches synthetic English and Telugu words tolerantly', async () => {
    const path = join(workingDirectory, 'sample.jpg');
    await writeFile(path, makeSampleImage());
    const output = await extractDocument({ path, contentType: 'image/jpeg', worker });
    expect(output.extractionMethod).toBe('ocr');
    expect(output.extractedPages[0].pageNumber).toBe(1);
    expect(expectedWords(output.extractedPages[0].text)).toBe(true);
  }, 30000);

  it('OCRs scanned PDF pages while keeping digital page numbers and methods', async () => {
    const path = join(workingDirectory, 'scanned.pdf');
    await writeFile(path, makeScannedPdf(makeSampleImage(), 1500, 300));
    const output = await extractDocument({ path, contentType: 'application/pdf', worker });
    expect(output.extractionMethod).toBe('ocr');
    expect(output.extractedPages).toHaveLength(1);
    expect(output.extractedPages[0]).toMatchObject({ pageNumber: 1, method: 'ocr' });
    expect(expectedWords(output.extractedPages[0].text)).toBe(true);
  }, 30000);

  it('labels a document mixed when pages combine selectable text and OCR', async () => {
    const path = join(workingDirectory, 'mixed.pdf');
    await writeFile(path, makeMixedPdf(makeSampleImage(), 1500, 300));
    const output = await extractDocument({ path, contentType: 'application/pdf', worker });
    expect(output.extractionMethod, JSON.stringify(output.extractedPages)).toBe('mixed');
    expect(output.extractedPages.map(({ pageNumber, method }) => ({ pageNumber, method }))).toEqual([
      { pageNumber: 1, method: 'digital' }, { pageNumber: 2, method: 'ocr' },
    ]);
    expect(output.extractedPages[0].text.toLowerCase()).toContain('public notice');
    expect(expectedWords(output.extractedPages[1].text)).toBe(true);
  }, 30000);
});
