import { afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.MONGODB_DB_NAME = 'civicsignal_test';
process.env.JWT_SECRET = 'test-only-secret-that-is-long-enough-for-validation';
process.env.JWT_ISSUER = 'civicsignal-test-api';
process.env.JWT_AUDIENCE = 'civicsignal-test-client';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.BCRYPT_ROUNDS = '10';
process.env.AUTH_RATE_LIMIT_MAX = '100';
process.env.UPLOAD_MAX_FILE_SIZE_BYTES = '10485760';
process.env.UPLOAD_MAX_PDF_PAGES = '100';
process.env.UPLOAD_MAX_IMAGE_PIXELS = '40000000';
process.env.GEMINI_API_KEY = 'test-gemini-key';

const mongoServer = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongoServer.getUri();

afterAll(async () => {
  await mongoServer.stop();
});
