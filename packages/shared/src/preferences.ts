import { z } from 'zod';

/** Candidate workspace preferences (SF-4.7). Saved on the user profile so they follow the candidate. */
export const workspacePreferencesSchema = z.object({
  theme: z.enum(['system', 'light', 'dark', 'sepia', 'contrast']).default('system'),
  fontScale: z.number().min(0.85).max(1.6).default(1),
  font: z.enum(['sans', 'serif', 'readable']).default('sans'),
  lineSpacing: z.enum(['compact', 'normal', 'relaxed']).default('normal'),
  layout: z.enum(['paged', 'scroll']).default('paged'),
  navigator: z.enum(['left', 'right', 'bottom', 'hidden']).default('right'),
  timer: z.enum(['always', 'minimal', 'last5']).default('always'),
  reduceMotion: z.boolean().default(false),
  showWordCount: z.boolean().default(true),
  confirmBeforeSubmit: z.boolean().default(true),
});
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;
export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = workspacePreferencesSchema.parse({});
