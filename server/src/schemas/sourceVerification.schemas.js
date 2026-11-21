import { z } from 'zod';

export const sourceCandidateSchema = z.object({
  candidateUrl: z.string().trim().url().max(2048),
  publicationDate: z.string().trim().min(4).max(80),
}).strict();
