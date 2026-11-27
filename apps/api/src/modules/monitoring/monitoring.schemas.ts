import { z } from 'zod';

/** Request bodies and queries for the monitoring API. Messages are written for the person filling the form. */

const reason = z
  .string({ error: 'Give a reason' })
  .trim()
  .min(3, 'Give a reason of at least 3 characters')
  .max(500, 'Keep the reason under 500 characters');

export const announcementSchema = z.object({
  body: z.string({ error: 'Write a message' }).trim().min(1, 'Write a message').max(1000, 'Keep announcements under 1000 characters'),
  priority: z.enum(['normal', 'urgent']).default('normal'),
  targetUserId: z.string().uuid('Choose a candidate from the list').nullish(),
});
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const clarificationSchema = z.object({
  question: z.string({ error: 'Write your question' }).trim().min(1, 'Write your question').max(1000, 'Keep your question under 1000 characters'),
  itemId: z.string().uuid('Unknown question').nullish(),
});
export type ClarificationInput = z.infer<typeof clarificationSchema>;

export const clarificationAnswerSchema = z.object({
  answer: z.string({ error: 'Write an answer' }).trim().min(1, 'Write an answer').max(2000, 'Keep the answer under 2000 characters'),
  /** Everyone sees the answer: the fair default, since others may have the same doubt. */
  broadcast: z.boolean().default(true),
});
export type ClarificationAnswerInput = z.infer<typeof clarificationAnswerSchema>;

const minutes = z.coerce
  .number({ error: 'Enter the minutes to add' })
  .int('Use whole minutes')
  .min(1, 'Add at least 1 minute')
  .max(120, 'Add at most 120 minutes at a time');

export const extendSchema = z.object({ minutes, reason });
export type ExtendInput = z.infer<typeof extendSchema>;

export const extendAllSchema = z.object({
  minutes,
  reason,
  /** Only the candidates in the detected outage (recomputed on the server), instead of everyone in progress. */
  onlyAffected: z.boolean().default(false),
});
export type ExtendAllInput = z.infer<typeof extendAllSchema>;

export const forceSubmitSchema = z.object({ reason });
export type ForceSubmitInput = z.infer<typeof forceSubmitSchema>;

export const reviewSchema = z.object({
  status: z.enum(['no_concern', 'follow_up', 'escalated'], { error: 'Choose an outcome' }),
  note: z.string().trim().max(1000, 'Keep the note under 1000 characters').default(''),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

const severityList = z
  .string()
  .trim()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .pipe(z.array(z.enum(['low', 'medium', 'high'], { error: 'Severity must be low, medium or high' })));

export const incidentQuerySchema = z.object({
  status: z.enum(['open', 'reviewed', 'all']).default('all'),
  severity: severityList.optional(),
});
export type IncidentQuery = z.infer<typeof incidentQuerySchema>;
