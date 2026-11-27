import type { Executor } from '../../db/client';
import { auditLogs } from '../../db/schema';
import { logger } from '../../lib/logger';

export interface AuditEntry {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Writes who-did-what records. Never throws into the caller's flow. */
export class AuditService {
  constructor(private readonly db: Executor) {}

  async record(entry: AuditEntry, tx: Executor = this.db): Promise<void> {
    try {
      await tx.insert(auditLogs).values({
        organizationId: entry.organizationId ?? null,
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
      });
    } catch (err) {
      logger.error({ err, action: entry.action }, 'audit write failed');
    }
  }
}
