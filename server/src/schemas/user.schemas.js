import { z } from 'zod';
import { andhraPradeshDistricts } from '../services/areaMatching.service.js';

const supportedAreaIds = new Set(andhraPradeshDistricts.map(({ id }) => id));

export const preferencesSchema = z.object({
  languagePreference: z.enum(['en-IN', 'te-IN']).optional(),
  selectedAreaIds: z.array(z.string().trim().min(1).max(100))
    .max(20)
    .refine((ids) => ids.every((id) => supportedAreaIds.has(id)), 'One or more selected areas are not supported.').optional(),
  notificationCategories: z.array(z.enum(['notices', 'events', 'revisions'])).max(3).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one preference must be provided');
