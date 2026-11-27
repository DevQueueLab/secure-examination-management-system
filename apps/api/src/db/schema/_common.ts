import { timestamp, uuid, numeric } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().defaultRandom();
export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () =>
  tstz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Marks and scores: exact decimals, surfaced to TypeScript as numbers. */
export const marks = (name: string) => numeric(name, { precision: 10, scale: 3, mode: 'number' });
