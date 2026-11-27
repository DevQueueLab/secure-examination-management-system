import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/client';
import { organizations } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import type { AuditService } from '../audit/audit.service';
import type { Actor } from './people.service';

export interface OrgSettingsView {
  id: string;
  name: string;
  slug: string;
  type: 'institution' | 'competition';
  status: 'active' | 'suspended';
  contactEmail: string | null;
  branding: { accentColor: string | null; tagline: string | null };
  createdAt: string;
}

export interface OrgSettingsPatch {
  name?: string;
  contactEmail?: string | null;
  branding?: { accentColor?: string | null; tagline?: string | null };
}

export const accentColorSchema = z
  .string()
  .trim()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Use a hex colour such as #0A84FF');

/** #abc and #aabbcc are accepted; stored as #AABBCC. */
export function normalizeHex(hex: string): string {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `#${full.toUpperCase()}`;
}

const LABELS: Record<string, string> = { name: 'name', contactEmail: 'contact email', accentColor: 'accent colour', tagline: 'tagline' };

export class OrgSettingsService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(organizationId: string): Promise<OrgSettingsView> {
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) throw new NotFoundError('Organization');
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      type: org.type,
      status: org.status,
      contactEmail: org.contactEmail,
      branding: { accentColor: org.branding.accentColor ?? null, tagline: org.branding.tagline ?? null },
      createdAt: org.createdAt.toISOString(),
    };
  }

  async update(actor: Actor, patch: OrgSettingsPatch) {
    const { auth } = actor;
    const organizationId = auth.organization.id;
    const [org] = await this.db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    if (!org) throw new NotFoundError('Organization');

    const branding = { ...org.branding };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    if (patch.branding?.accentColor !== undefined) {
      const next = patch.branding.accentColor ? normalizeHex(patch.branding.accentColor) : undefined;
      if (next !== branding.accentColor) changes.accentColor = { from: branding.accentColor ?? null, to: next ?? null };
      if (next) branding.accentColor = next;
      else delete branding.accentColor;
    }
    if (patch.branding?.tagline !== undefined) {
      const next = patch.branding.tagline?.trim() || undefined;
      if (next !== branding.tagline) changes.tagline = { from: branding.tagline ?? null, to: next ?? null };
      if (next) branding.tagline = next;
      else delete branding.tagline;
    }
    const set: Partial<typeof organizations.$inferInsert> = {};
    if (patch.name !== undefined && patch.name !== org.name) {
      changes.name = { from: org.name, to: patch.name };
      set.name = patch.name;
    }
    if (patch.contactEmail !== undefined && (patch.contactEmail || null) !== org.contactEmail) {
      changes.contactEmail = { from: org.contactEmail, to: patch.contactEmail || null };
      set.contactEmail = patch.contactEmail || null;
    }
    if (Object.keys(changes).length === 0) return this.get(organizationId);

    await this.db
      .update(organizations)
      .set({ ...set, branding })
      .where(eq(organizations.id, organizationId));
    await this.audit.record({
      organizationId,
      actorId: auth.user.id,
      action: 'org.settings_updated',
      entityType: 'organization',
      entityId: organizationId,
      summary: `updated the organization ${Object.keys(changes).map((k) => LABELS[k] ?? k).join(', ')}`,
      metadata: { changes },
      ip: actor.ip,
    });
    return this.get(organizationId);
  }
}
