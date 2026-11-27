import { RT } from '@athena/shared';
import type { Executor } from '../../db/client';
import { notifications } from '../../db/schema';
import type { Realtime } from '../../realtime/realtime';

export interface NotifyInput {
  userId: string;
  /** Tenant the notification belongs to; null for account-level notices. */
  organizationId?: string | null;
  /** Machine-readable category, e.g. 'results.published', 'role.changed'. */
  kind: string;
  title: string;
  body?: string | null;
  /** In-app path to open, e.g. /exams/<id>/grading. */
  link?: string | null;
  /** Optional here so the helper can also be called as notify(tx, { ..., realtime }). */
  realtime?: Realtime;
}

/** What the bell receives over RT.notification and in GET /notifications. */
export interface NotificationView {
  id: string;
  organizationId: string | null;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Stores a notification and pushes it to the user's socket room. Run it inside the caller's transaction.
 * The push may arrive before that transaction commits; clients insert the pushed row into their cache and
 * re-sync over HTTP, so an early or lost push never shows something that was rolled back for long.
 *
 *   await notify(tx, { userId, organizationId, kind: 'results.published', title, body, link }, c.realtime);
 */
export async function notify(tx: Executor, input: NotifyInput, realtime?: Realtime): Promise<NotificationView> {
  const [row] = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      kind: input.kind.slice(0, 80),
      title: input.title.slice(0, 200),
      body: input.body ? input.body.slice(0, 1000) : null,
      link: input.link ?? null,
    })
    .returning();
  const view = toNotificationView(row!);
  (realtime ?? input.realtime)?.toUser(input.userId, RT.notification, view);
  return view;
}

export function toNotificationView(row: typeof notifications.$inferSelect): NotificationView {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
