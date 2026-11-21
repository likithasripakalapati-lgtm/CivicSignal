import { z } from 'zod';

const passwordSchema = z.string()
  .min(10, 'Password must contain at least 10 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');

export const registerSchema = z.object({
  email: z.email().max(254).transform((email) => email.trim().toLowerCase()),
  password: passwordSchema,
  languagePreference: z.enum(['en-IN', 'te-IN']).default('en-IN'),
}).strict();

export const loginSchema = z.object({
  email: z.email().max(254).transform((email) => email.trim().toLowerCase()),
  password: z.string().min(1).max(256)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes'),
}).strict();
