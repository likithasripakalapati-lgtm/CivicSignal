import { access, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const tessdataDirectory = resolve(process.env.OCR_TESSDATA_DIR || join(projectRoot, 'tessdata'));

export async function assertTrainedDataAvailable() {
  for (const language of ['eng', 'tel']) {
    try { await access(join(tessdataDirectory, `${language}.traineddata`)); }
    catch { throw new Error(`Missing ${language}.traineddata in the configured TESSDATA directory.`); }
  }
}

export async function createLocalOcrWorker() {
  await assertTrainedDataAvailable();
  await mkdir(join(projectRoot, '.ocr-cache'), { recursive: true });
  return createWorker(['eng', 'tel'], 1, {
    langPath: tessdataDirectory,
    gzip: false,
    cachePath: join(projectRoot, '.ocr-cache'),
    cacheMethod: 'none',
  });
}

export async function recognizeImage(worker, image) {
  const result = await worker.recognize(image);
  return result.data.text.trim();
}
