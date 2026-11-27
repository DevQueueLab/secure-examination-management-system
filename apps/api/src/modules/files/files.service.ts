import { createHash } from 'node:crypto';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { memberships, userFiles } from '../../db/schema';
import { AppError, NotFoundError, ValidationError } from '../../lib/errors';
import type { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../../types/auth';

export const AVATAR_MAX_BYTES = 300 * 1024;
export const DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENTS_PER_USER = 10;
export const DOCUMENT_CATEGORIES = ['identity', 'accommodation', 'other'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type SniffedMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';

/** The type comes from the bytes alone; the declared Content-Type is never trusted. */
export function sniffMime(buf: Buffer): SniffedMime | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** Drops any path, control and bidi characters; keeps the extension when capping at 120 characters. */
export function sanitizeFilename(raw: unknown): string {
  let name = typeof raw === 'string' ? raw : '';
  name = name.normalize('NFC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, '');
  name = name.replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (name.length > 120) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
    name = name.slice(0, 120 - ext.length).trimEnd() + ext;
  }
  return name || 'document';
}

/** RFC 5987 value for `filename*=UTF-8''…`. */
export function contentDisposition(filename: string): string {
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

const listColumns = {
  id: userFiles.id,
  filename: userFiles.filename,
  mime: userFiles.mime,
  sizeBytes: userFiles.sizeBytes,
  category: userFiles.category,
  createdAt: userFiles.createdAt,
};

export class FilesService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private isAdminOf(auth: AuthContext, orgId: string | null): boolean {
    return !!orgId && auth.organization?.id === orgId && auth.permissions.has('users.manage');
  }

  // ---------- avatar ----------

  async setAvatar(auth: AuthContext, body: Buffer) {
    const mime = sniffMime(body);
    if (!mime || mime === 'application/pdf')
      throw new ValidationError('Choose a JPEG, PNG or WebP image');
    if (body.length > AVATAR_MAX_BYTES)
      throw new AppError(413, 'VALIDATION_ERROR', 'The photo must be 300 KB or smaller');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const row = await this.db.transaction(async (tx) => {
      // Serialises concurrent uploads by the same person, so exactly one avatar survives.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`user_files:${auth.user.id}`}, 0))`,
      );
      await tx
        .delete(userFiles)
        .where(and(eq(userFiles.userId, auth.user.id), eq(userFiles.kind, 'avatar')));
      const [inserted] = await tx
        .insert(userFiles)
        .values({
          organizationId: auth.organization?.id ?? null,
          userId: auth.user.id,
          kind: 'avatar',
          filename: 'avatar',
          mime,
          sizeBytes: body.length,
          sha256,
          data: body,
        })
        .returning({ id: userFiles.id, createdAt: userFiles.createdAt });
      return inserted!;
    });
    return { fileId: row.id, createdAt: row.createdAt };
  }

  async removeAvatar(auth: AuthContext) {
    await this.db
      .delete(userFiles)
      .where(and(eq(userFiles.userId, auth.user.id), eq(userFiles.kind, 'avatar')));
  }

  /** The owner, or anyone signed in to a tenant the owner belongs to. Otherwise 404. */
  async getAvatar(auth: AuthContext, userId: string) {
    if (userId !== auth.user.id) {
      if (!auth.organization) throw new NotFoundError('Photo');
      const [m] = await this.db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(eq(memberships.userId, userId), eq(memberships.organizationId, auth.organization.id)),
        )
        .limit(1);
      if (!m) throw new NotFoundError('Photo');
    }
    try {
      const [row] = await this.db
        .select({ id: userFiles.id, mime: userFiles.mime, data: userFiles.data })
        .from(userFiles)
        .where(and(eq(userFiles.userId, userId), eq(userFiles.kind, 'avatar')))
        .orderBy(desc(userFiles.createdAt))
        .limit(1);
      return row ?? null;
    } catch (err) {
      // Every avatar in the app reads this route: a database without the table (an unmigrated dev
      // database) answers "no photo" instead of failing each image. Production migrates before it listens.
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === '42P01' || e.cause?.code === '42P01') return null;
      throw err;
    }
  }

  // ---------- documents ----------

  async listOwn(auth: AuthContext) {
    const items = await this.db
      .select(listColumns)
      .from(userFiles)
      .where(and(eq(userFiles.userId, auth.user.id), eq(userFiles.kind, 'document')))
      .orderBy(asc(userFiles.createdAt));
    return { items, max: DOCUMENTS_PER_USER };
  }

  /** Org admins only, and only documents uploaded under their tenant. Anyone else sees 404. */
  async listForMember(auth: AuthContext, userId: string) {
    const orgId = auth.organization?.id ?? null;
    if (!this.isAdminOf(auth, orgId)) throw new NotFoundError('Person');
    const [member] = await this.db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId!)))
      .limit(1);
    if (!member) throw new NotFoundError('Person');
    const items = await this.db
      .select(listColumns)
      .from(userFiles)
      .where(
        and(
          eq(userFiles.userId, userId),
          eq(userFiles.kind, 'document'),
          eq(userFiles.organizationId, orgId!),
        ),
      )
      .orderBy(asc(userFiles.createdAt));
    return { items, max: DOCUMENTS_PER_USER };
  }

  async upload(
    auth: AuthContext,
    input: { body: Buffer; filename: unknown; category: DocumentCategory; ip?: string | null },
  ) {
    const { body } = input;
    if (body.length === 0) throw new ValidationError('The file is empty');
    if (body.length > DOCUMENT_MAX_BYTES)
      throw new AppError(413, 'VALIDATION_ERROR', 'Each document must be 5 MB or smaller');
    const mime = sniffMime(body);
    if (!mime) throw new ValidationError('Upload a PDF, JPEG, PNG or WebP file');
    const filename = sanitizeFilename(input.filename);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const doc = await this.db.transaction(async (tx) => {
      // Same per-person lock as avatars: the count and the insert cannot interleave with another upload.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`user_files:${auth.user.id}`}, 0))`,
      );
      const [{ n } = { n: 0 }] = await tx
        .select({ n: count() })
        .from(userFiles)
        .where(and(eq(userFiles.userId, auth.user.id), eq(userFiles.kind, 'document')));
      if (n >= DOCUMENTS_PER_USER)
        throw new ValidationError(
          `You can keep up to ${DOCUMENTS_PER_USER} documents. Delete one to add another.`,
        );
      const [inserted] = await tx
        .insert(userFiles)
        .values({
          organizationId: auth.organization?.id ?? null,
          userId: auth.user.id,
          kind: 'document',
          category: input.category,
          filename,
          mime,
          sizeBytes: body.length,
          sha256,
          data: body,
        })
        .returning(listColumns);
      return inserted!;
    });
    await this.audit.record({
      organizationId: auth.organization?.id ?? null,
      actorId: auth.user.id,
      action: 'profile.document_uploaded',
      entityType: 'user_file',
      entityId: doc.id,
      summary: `Uploaded "${filename}"`,
      metadata: { category: input.category, mime, sizeBytes: body.length, sha256 },
      ip: input.ip ?? null,
    });
    return doc;
  }

  async download(auth: AuthContext, id: string, ip?: string | null) {
    const [row] = await this.db
      .select()
      .from(userFiles)
      .where(and(eq(userFiles.id, id), eq(userFiles.kind, 'document')))
      .limit(1);
    if (!row) throw new NotFoundError('Document');
    const owner = row.userId === auth.user.id;
    if (!owner && !this.isAdminOf(auth, row.organizationId)) throw new NotFoundError('Document');
    if (!owner) {
      await this.audit.record({
        organizationId: row.organizationId,
        actorId: auth.user.id,
        action: 'profile.document_downloaded',
        entityType: 'user_file',
        entityId: row.id,
        summary: `Downloaded "${row.filename}" of another member`,
        metadata: { ownerId: row.userId, category: row.category },
        ip: ip ?? null,
      });
    }
    return row;
  }

  async remove(auth: AuthContext, id: string, ip?: string | null) {
    const [row] = await this.db
      .delete(userFiles)
      .where(
        and(
          eq(userFiles.id, id),
          eq(userFiles.kind, 'document'),
          eq(userFiles.userId, auth.user.id),
        ),
      )
      .returning({
        id: userFiles.id,
        filename: userFiles.filename,
        organizationId: userFiles.organizationId,
      });
    if (!row) throw new NotFoundError('Document');
    await this.audit.record({
      organizationId: row.organizationId,
      actorId: auth.user.id,
      action: 'profile.document_deleted',
      entityType: 'user_file',
      entityId: row.id,
      summary: `Deleted "${row.filename}"`,
      ip: ip ?? null,
    });
  }
}
