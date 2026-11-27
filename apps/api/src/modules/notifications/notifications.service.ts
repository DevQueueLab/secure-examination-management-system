import { and, count, desc, eq, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { notifications } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import type { AuthContext } from '../../types/auth';
import { toNotificationView } from './notify';

/**
 * A person's notifications. Inside a tenant they see that tenant's notices plus account-level ones;
 * outside a tenant (platform admins) only account-level ones, so one tenant's notices never surface in another.
 */
export class NotificationsService {
  constructor(private readonly db: Database) {}

  private scope(auth: AuthContext): SQL {
    const orgScope = auth.organization
      ? or(isNull(notifications.organizationId), eq(notifications.organizationId, auth.organization.id))!
      : isNull(notifications.organizationId);
    return and(eq(notifications.userId, auth.user.id), orgScope)!;
  }

  async list(auth: AuthContext, opts: { limit: number; before?: Date; unreadOnly?: boolean }) {
    const where = and(
      this.scope(auth),
      opts.before ? lt(notifications.createdAt, opts.before) : undefined,
      opts.unreadOnly ? isNull(notifications.readAt) : undefined,
    );
    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(opts.limit + 1);
    const [unread] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(this.scope(auth), isNull(notifications.readAt)));
    const hasMore = rows.length > opts.limit;
    return {
      items: rows.slice(0, opts.limit).map(toNotificationView),
      unreadCount: unread?.n ?? 0,
      hasMore,
    };
  }

  async markRead(auth: AuthContext, id: string) {
    // Keeps the first read time; someone else's id reads as not found.
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), this.scope(auth)))
      .returning({ id: notifications.id });
    if (!row) throw new NotFoundError('Notification');
  }

  async markAllRead(auth: AuthContext) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(this.scope(auth), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { updated: rows.length };
  }
}
