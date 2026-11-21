import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { config } from '../config/env.js';

const tempDirectory = resolve(config.uploadTempDirectory || join(tmpdir(), 'civicsignal-uploads'));
mkdirSync(tempDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, tempDirectory),
  filename: (_req, file, callback) => {
    const extension = file.originalname.toLowerCase().match(/\.(pdf|jpe?g|png)$/)?.[0] || '';
    callback(null, `${randomUUID()}${extension}`);
  },
});

export const receiveDocument = multer({
  storage,
  limits: { fileSize: config.uploadMaxFileSizeBytes, files: 1, fields: 0, parts: 1 },
}).single('document');
