import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config/env.js';
import { recognizeImage } from './ocr.service.js';


const MAX_EXTRACTED_CHARACTERS = 2_000_000;

function classifyDocument(methods) {
  if (methods.size > 1) return 'mixed';
  return methods.values().next().value ?? 'ocr';
}

function assertTextLimit(pages) {
  const totalCharacters = pages.reduce((total, page) => total + page.text.length, 0);
  if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
    throw Object.assign(new Error('Extraction output exceeds the supported size.'), { code: 'EXTRACTION_TOO_LARGE' });
  }
}

async function ocrPdfPage(page, worker) {
  const baseViewport = page.getViewport({ scale: 1 });
  const basePixels = Math.max(1, baseViewport.width * baseViewport.height);
  const scale = Math.min(1.5, Math.sqrt(config.ocrMaxRenderPixels / basePixels));
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  await page.render({ canvasContext: context, viewport }).promise;
  const imageBuffer = canvas.toBuffer('image/png');
  return recognizeImage(worker, imageBuffer);
}

async function extractPdf(path, worker, onPageProgress) {
  // File size has been validated on upload; this read is bounded by the configured upload cap.
  const data = new Uint8Array(await readFile(path));
  const loadingTask = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  let pdf;
  const pages = [];
  const methods = new Set();
  try {
    pdf = await loadingTask.promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const digitalText = content.items.map((item) => item.str ?? '').join(' ').replace(/\s+/g, ' ').trim();
        const method = digitalText ? 'digital' : 'ocr';
        const text = digitalText || await ocrPdfPage(page, worker);
        pages.push({ pageNumber, method, text });
        methods.add(method);
        assertTextLimit(pages);
        await onPageProgress?.(pageNumber, pdf.numPages);
      } finally { page.cleanup(); }
    }
    return { totalPages: pdf.numPages, extractionMethod: classifyDocument(methods), extractedPages: pages };
  } catch (error) {
    if (error?.code === 'EXTRACTION_TOO_LARGE') throw error;
    throw Object.assign(new Error('PDF could not be extracted.'), { code: 'DOCUMENT_UNREADABLE' });
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

export async function extractDocument({ path, contentType, worker, onPageProgress }) {
  if (contentType === 'application/pdf') return extractPdf(path, worker, onPageProgress);
  const text = await recognizeImage(worker, path);
  if (!text) throw Object.assign(new Error('OCR did not return readable text.'), { code: 'EXTRACTION_EMPTY' });
  const extractedPages = [{ pageNumber: 1, method: 'ocr', text }];
  assertTextLimit(extractedPages);
  await onPageProgress?.(1, 1);
  return { totalPages: 1, extractionMethod: 'ocr', extractedPages };
}
