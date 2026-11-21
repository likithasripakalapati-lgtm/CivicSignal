import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('civicsignal'),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().trim().min(1).default('gemini-3.5-flash-lite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('civicsignal-api'),
  JWT_AUDIENCE: z.string().default('civicsignal-client'),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  UPLOAD_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().max(25 * 1024 * 1024).default(10 * 1024 * 1024),
  UPLOAD_MAX_PDF_PAGES: z.coerce.number().int().positive().max(500).default(100),
  UPLOAD_MAX_IMAGE_PIXELS: z.coerce.number().int().positive().max(100_000_000).default(40_000_000),
  GRIDFS_BUCKET_NAME: z.string().min(1).default('civicDocuments'),
  OCR_TESSDATA_DIR: z.string().optional(),
  PROCESSING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  PROCESSING_LEASE_MS: z.coerce.number().int().min(30000).max(1800000).default(300000),
  PROCESSING_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(10000).default(1000),
  OCR_MAX_RENDER_PIXELS: z.coerce.number().int().positive().max(16000000).default(12000000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  // Do not print env values or the original parser error (which may contain secrets).
  const names = result.error.issues.map(({ path }) => path.join('.')).join(', ');
  throw new Error(`Invalid server configuration. Check these environment variables: ${names}`);
}

export const config = Object.freeze({
  nodeEnv: result.data.NODE_ENV,
  port: result.data.PORT,
  clientOrigins: result.data.CLIENT_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean),
  mongoUri: result.data.MONGODB_URI,
  mongoDbName: result.data.MONGODB_DB_NAME,
  geminiApiKey: result.data.GEMINI_API_KEY,
  geminiModel: result.data.GEMINI_MODEL,
  jwtSecret: result.data.JWT_SECRET,
  jwtIssuer: result.data.JWT_ISSUER,
  jwtAudience: result.data.JWT_AUDIENCE,
  jwtAccessTokenTtlSeconds: result.data.JWT_ACCESS_TOKEN_TTL_SECONDS,
  bcryptRounds: result.data.BCRYPT_ROUNDS,
  authRateLimitWindowMs: result.data.AUTH_RATE_LIMIT_WINDOW_MS,
  authRateLimitMax: result.data.AUTH_RATE_LIMIT_MAX,
  uploadMaxFileSizeBytes: result.data.UPLOAD_MAX_FILE_SIZE_BYTES,
  uploadMaxPdfPages: result.data.UPLOAD_MAX_PDF_PAGES,
  uploadMaxImagePixels: result.data.UPLOAD_MAX_IMAGE_PIXELS,
  gridFsBucketName: result.data.GRIDFS_BUCKET_NAME,
  uploadTempDirectory: process.env.UPLOAD_TEMP_DIR,
  ocrTessdataDirectory: result.data.OCR_TESSDATA_DIR,
  processingMaxAttempts: result.data.PROCESSING_MAX_ATTEMPTS,
  processingLeaseMs: result.data.PROCESSING_LEASE_MS,
  processingPollIntervalMs: result.data.PROCESSING_POLL_INTERVAL_MS,
  ocrMaxRenderPixels: result.data.OCR_MAX_RENDER_PIXELS,
  isProduction: result.data.NODE_ENV === 'production',
});
