import { z } from 'zod';

/** Error envelope returned by every failing API call. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Field-level validation issues: path -> message. */
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export const ERROR_CODES = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  EXAM_NOT_AVAILABLE: 'EXAM_NOT_AVAILABLE',
  ATTEMPT_CLOSED: 'ATTEMPT_CLOSED',
  SESSION_TAKEN_OVER: 'SESSION_TAKEN_OVER',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const uuidParam = z.string().uuid('Invalid id');
