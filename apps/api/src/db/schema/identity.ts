import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, tstz, updatedAt } from './_common';
import { membershipStatus, organizationStatus, organizationType, userStatus } from './enums';

/** Tenants: institutions and competition organizers onboarded by platform admins. */
export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  type: organizationType('type').notNull(),
  status: organizationStatus('status').notNull().default('active'),
  contactEmail: text('contact_email'),
  branding: jsonb('branding').$type<{ accentColor?: string; tagline?: string }>().notNull().default({}),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A global identity. Tenant access comes only from memberships; platform admins need none. */
export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
  status: userStatus('status').notNull().default('active'),
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: tstz('locked_until'),
  lastLoginAt: tstz('last_login_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Roles are permission sets per tenant. System roles are seeded; admins may add custom ones. */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    permissions: text('permissions').array().notNull().default(sql`'{}'::text[]`),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('roles_org_key_uq').on(t.organizationId, t.key)],
);

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: membershipStatus('status').notNull().default('active'),
    /** Student / roll number or competitor id inside this tenant. */
    externalId: text('external_id'),
    /** Class, batch or team, used for bulk enrollment. */
    cohort: text('cohort'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('memberships_user_org_uq').on(t.userId, t.organizationId),
    index('memberships_org_role_idx').on(t.organizationId, t.roleId),
  ],
);

/** Opaque server-side sessions. Only the SHA-256 of the token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    expiresAt: tstz('expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    summary: text('summary'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_org_time_idx').on(t.organizationId, t.createdAt)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id'),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_time_idx').on(t.userId, t.createdAt)],
);
