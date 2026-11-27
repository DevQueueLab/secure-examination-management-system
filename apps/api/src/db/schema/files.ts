import { customType, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './_common';
import { organizations, users } from './identity';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const userFileKind = pgEnum('user_file_kind', ['avatar', 'document']);

/** Profile photos and personal documents, stored in Postgres. Lists never select `data`. */
export const userFiles = pgTable(
  'user_files',
  {
    id: id(),
    /** Tenant the file was uploaded under; null for avatars of users without a tenant. */
    organizationId: uuid('org_id').references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: userFileKind('kind').notNull(),
    category: text('category'),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    data: bytea('data').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('user_files_user_idx').on(t.userId)],
);
