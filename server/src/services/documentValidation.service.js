import { readFile, open, stat } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { config } from '../config/env.js';

const SIGNATURES = {
  'application/pdf': (bytes) => bytes.subarray(0, 5).toString('ascii') === '%PDF-',
  'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

export class UploadValidationError extends Error {
  constructor(code, message) { super(message); this.name = 'UploadValidationError'; this.code = code; }
}

async function readPrefix(path, length = 32) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

async function inspectPng(path) {
  const bytes = await readPrefix(path, 24);
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new UploadValidationError('INVALID_IMAGE', 'Image file is invalid.');
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function inspectJpeg(path) {
  const handle = await open(path, 'r');
  try {
    const fileInfo = await handle.stat();
    const scanLength = Math.min(fileInfo.size, 1024 * 1024);
    const bytes = Buffer.alloc(scanLength);
    const { bytesRead } = await handle.read(bytes, 0, scanLength, 0);
    let offset = 2;
    while (offset + 4 < bytesRead) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (offset + 2 > bytesRead) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytesRead) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (segmentLength < 7) break;
        return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      }
      offset += segmentLength;
    }
  } finally { await handle.close(); }
  throw new UploadValidationError('INVALID_IMAGE', 'Image dimensions could not be read.');
}

async function validatePdf(path) {
  // Parsing is explicitly bounded by the upload size limit before allocating this buffer.
  const data = new Uint8Array(await readFile(path));
  const task = getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > config.uploadMaxPdfPages) {
      throw new UploadValidationError('PDF_PAGE_LIMIT', `PDFs may contain at most ${config.uploadMaxPdfPages} pages.`);
    }
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError('INVALID_PDF', 'PDF file is invalid or unreadable.');
  } finally {
    await task.destroy().catch(() => {});
  }
}

export async function validateDocumentFile(file) {
  if (!file || !file.path) throw new UploadValidationError('FILE_REQUIRED', 'Choose a document to upload.');
  const details = await stat(file.path);
  if (details.size < 1) throw new UploadValidationError('EMPTY_FILE', 'The selected file is empty.');
  if (details.size > config.uploadMaxFileSizeBytes) {
    throw new UploadValidationError('FILE_TOO_LARGE', 'The selected file exceeds the upload size limit.');
  }

  const ext = file.originalname.toLowerCase().split('.').pop();
  const expectedType = ({ pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' })[ext];
  const bytes = await readPrefix(file.path);
  const actualType = Object.keys(SIGNATURES).find((type) => SIGNATURES[type](bytes));
  if (!expectedType || actualType !== expectedType || file.mimetype !== expectedType) {
    throw new UploadValidationError('UNSUPPORTED_FILE', 'Upload a valid PDF, JPG, or PNG file.');
  }

  if (actualType === 'application/pdf') {
    await validatePdf(file.path);
  } else {
    const dimensions = actualType === 'image/png' ? await inspectPng(file.path) : await inspectJpeg(file.path);
    if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > config.uploadMaxImagePixels) {
      throw new UploadValidationError('IMAGE_DIMENSION_LIMIT', 'The image dimensions exceed the allowed limit.');
    }
  }
  return { contentType: actualType, sizeBytes: details.size };
}
