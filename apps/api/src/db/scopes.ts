import { eq } from 'drizzle-orm';
import { attempts } from './schema';

/**
 * The one query scope for "real" attempts. Every statistic, result list, monitor view and analytics query must
 * include it so examiner sandbox previews can never leak into real numbers.
 */
export const realAttempts = eq(attempts.isSandbox, false);
