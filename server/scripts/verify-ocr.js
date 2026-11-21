import { createCanvas } from '@napi-rs/canvas';
import { createLocalOcrWorker, tessdataDirectory } from '../src/services/ocr.service.js';

const worker = await createLocalOcrWorker();
try {
  const canvas = createCanvas(1500, 300);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1500, 300);
  context.fillStyle = '#111';
  context.font = '64px "Arial"';
  context.fillText('PUBLIC NOTICE 2026', 40, 100);
  context.font = '64px "Nirmala UI"';
  context.fillText('నీటి సరఫరా', 40, 220);
  const { data } = await worker.recognize(canvas.toBuffer('image/png'));
  const normalized = data.text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const englishPassed = normalized.includes('public') && normalized.includes('notice');
  const teluguPassed = normalized.includes('నీటి') || normalized.includes('సరఫరా');
  console.log(`Tesseract.js loaded local eng+tel data from ${tessdataDirectory}`);
  console.log(`Synthetic OCR text: ${data.text.trim() || '(empty)'}`);
  console.log(`English sample: ${englishPassed ? 'PASS' : 'FAIL'}; Telugu sample: ${teluguPassed ? 'PASS' : 'FAIL'}`);
  if (!englishPassed || !teluguPassed) process.exitCode = 1;
} finally {
  await worker.terminate();
}
