import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz, updatedAt } from './_common';
import { importKind } from './enums';
import { organizations, users } from './identity';

/** Small key/value store for process state, e.g. the API heartbeat used to detect server outages. */
export const systemState = pgTable('system_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: updatedAt(),
});

/** Verified server outages; active attempts are extended by exactly this duration. */
export const outages = pgTable('outages', {
  id: id(),
  startedAt: tstz('started_at').notNull(),
  endedAt: tstz('ended_at').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  compensatedAttempts: integer('compensated_attempts').notNull().default(0),
  createdAt: createdAt(),
});

export const importJobs = pgTable('import_jobs', {
  id: id(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  kind: importKind('kind').notNull(),
  filename: text('filename'),
  totalRows: integer('total_rows').notNull().default(0),
  importedRows: integer('imported_rows').notNull().default(0),
  errorRows: integer('error_rows').notNull().default(0),
  errors: jsonb('errors').$type<{ row: number; field?: string; message: string }[]>().notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});
