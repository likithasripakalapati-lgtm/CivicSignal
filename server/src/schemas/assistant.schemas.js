import { z } from 'zod';

const currentQuestionSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  language: z.enum(['en', 'te']),
  mode: z.literal('current'),
  noticeId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();

const allQuestionSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  language: z.enum(['en', 'te']),
  mode: z.literal('all'),
}).strict();

export const assistantQuestionSchema = z.discriminatedUnion('mode', [
  currentQuestionSchema,
  allQuestionSchema,
]);

const assistantEvidenceSchema = z.object({
  noticeId: z.string().min(1).max(64),
  filename: z.string().min(1).max(255),
  pageNumber: z.number().int().positive(),
  quote: z.string().min(3).max(1200),
}).strict();

export const assistantResponseSchema = z.object({
  answer: z.string().min(1).max(6000),
  answerable: z.boolean(),
  language: z.enum(['en', 'te']),
  mode: z.enum(['current', 'all']),
  aiGenerated: z.literal(true),
  disclaimer: z.string().min(1).max(500),
  sources: z.array(z.object({
    noticeId: z.string().min(1).max(64),
    filename: z.string().min(1).max(255),
    authenticityStatus: z.literal('unverified'),
  }).strict()).max(10),
  evidence: z.array(assistantEvidenceSchema).max(20),
}).strict();
