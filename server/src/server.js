import 'dotenv/config';
import app from './app.js';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { startDocumentWorker, stopDocumentWorker } from './services/processingWorker.service.js';

let server;

try {
  await connectDatabase();
  server = app.listen(config.port, () => {
    console.log(`CivicSignal API listening on port ${config.port}`);
  });
  try {
    await startDocumentWorker();
  } catch (error) {
    console.error('Document worker unavailable. Run the OCR setup script and restart.', { code: error?.code ?? error?.name ?? 'UNKNOWN' });
  }
} catch (error) {
  console.error('Database connection failed', { name: error?.name ?? 'Error', code: error?.code ?? 'UNKNOWN' });
  process.exitCode = 1;
}

async function shutdown() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await stopDocumentWorker();
  await disconnectDatabase();
}

process.once('SIGINT', () => shutdown().finally(() => process.exit()));
process.once('SIGTERM', () => shutdown().finally(() => process.exit()));
