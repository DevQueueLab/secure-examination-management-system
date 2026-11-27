import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import Papa from 'papaparse';
import { z } from 'zod';
import type { Database, Executor } from '../../db/client';
import { importJobs, memberships, roles, users } from '../../db/schema';
import { AppError, ConflictError, ValidationError } from '../../lib/errors';
import type { AuditService } from '../audit/audit.service';
import { isUniqueViolation, permissionsBeyond } from './access';
import type { Actor } from './people.service';
import { provisionMember } from './provision';

export const MAX_IMPORT_ROWS = 1000;

export const IMPORT_COLUMNS = ['name', 'email', 'role', 'roll_number', 'cohort'] as const;
type Column = (typeof IMPORT_COLUMNS)[number];

/** Spreadsheet headers people actually use, mapped to our columns. */
const HEADER_ALIASES: Record<string, Column> = {
  name: 'name',
  full_name: 'name',
  fullname: 'name',
  student_name: 'name',
  candidate_name: 'name',
  participant_name: 'name',
  email: 'email',
  e_mail: 'email',
  email_address: 'email',
  mail: 'email',
  role: 'role',
  role_key: 'role',
  roll_number: 'roll_number',
  roll_no: 'roll_number',
  roll: 'roll_number',
  rollnumber: 'roll_number',
  external_id: 'roll_number',
  externalid: 'roll_number',
  student_id: 'roll_number',
  registration_number: 'roll_number',
  reg_no: 'roll_number',
  competitor_id: 'roll_number',
  cohort: 'cohort',
  batch: 'cohort',
  class: 'cohort',
  section: 'cohort',
  team: 'cohort',
  group: 'cohort',
};

const normHeader = (h: string) =>
  h
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_');

export type RowAction = 'create' | 'link' | 'update' | 'skip';

export interface ImportRowReport {
  /** Spreadsheet row (the header is row 1) for CSV; 1-based item index for JSON. */
  row: number;
  name: string;
  email: string;
  role: { key: string; name: string } | null;
  externalId: string | null;
  cohort: string | null;
  action: RowAction | null;
  errors: { field: Column | 'row'; message: string }[];
  warnings: string[];
}

export interface ImportReport {
  dryRun: boolean;
  committed: boolean;
  jobId: string | null;
  filename: string | null;
  ignoredColumns: string[];
  summary: { total: number; valid: number; invalid: number; warnings: number; create: number; link: number; update: number; skip: number };
  rows: ImportRowReport[];
  /** New accounts only, returned once on commit. Never stored in plain text. */
  credentials: { row: number; name: string; email: string; temporaryPassword: string }[];
}

const emailSchema = z.string().email();
const cell = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

export const IMPORT_TEMPLATE = [
  'name,email,role,roll_number,cohort',
  'Ayesha Khan,ayesha.khan@example.edu,candidate,FA26-BCS-001,BCS-1A',
  'Omar Siddiqui,omar.siddiqui@example.edu,candidate,FA26-BCS-002,BCS-1B',
  'Dr. Hina Mirza,hina.mirza@example.edu,examiner,,',
  '',
].join('\r\n');

/**
 * Bulk onboarding of people (SF-4.4). The dry run and the commit share one validation pass, so what the
 * preview promised is exactly what is written. The commit runs in a single transaction.
 */
export class PeopleImportService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private parse(format: 'csv' | 'json', data: unknown): { records: Record<Column, string>[]; ignoredColumns: string[]; rowOffset: number } {
    if (format === 'csv') {
      if (typeof data !== 'string' || !data.trim()) throw new ValidationError('The file is empty', { data: 'The file is empty' });
      const parsed = Papa.parse<Record<string, string>>(data.trim(), { header: true, skipEmptyLines: 'greedy', transformHeader: normHeader });
      const headers = parsed.meta.fields ?? [];
      const mapped = new Map<string, Column>();
      const ignoredColumns: string[] = [];
      for (const h of headers) {
        const col = HEADER_ALIASES[h];
        if (col && ![...mapped.values()].includes(col)) mapped.set(h, col);
        else if (h) ignoredColumns.push(h);
      }
      const have = new Set(mapped.values());
      if (!have.has('name') || !have.has('email')) {
        throw new ValidationError('The file needs at least a name and an email column. Download the template to see the format.', {
          data: 'Missing name or email column',
        });
      }
      const records = parsed.data.map((raw) => {
        const out = { name: '', email: '', role: '', roll_number: '', cohort: '' } as Record<Column, string>;
        for (const [h, col] of mapped) out[col] = cell(raw[h]);
        return out;
      });
      return { records, ignoredColumns, rowOffset: 2 };
    }
    const list = typeof data === 'string' ? safeJson(data) : data;
    if (!Array.isArray(list)) throw new ValidationError('Expected a JSON array of people', { data: 'Expected a JSON array' });
    const ignored = new Set<string>();
    const records = list.map((item) => {
      const out = { name: '', email: '', role: '', roll_number: '', cohort: '' } as Record<Column, string>;
      if (item && typeof item === 'object') {
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          const col = HEADER_ALIASES[normHeader(k.replace(/([a-z])([A-Z])/g, '$1_$2'))];
          if (col) out[col] = cell(v);
          else ignored.add(k);
        }
      }
      return out;
    });
    return { records, ignoredColumns: [...ignored], rowOffset: 1 };
  }

  private async validate(tx: Executor, actor: Actor, records: Record<Column, string>[], rowOffset: number): Promise<ImportRowReport[]> {
    const organizationId = actor.auth.organization.id;
    const orgRoles = await tx.select().from(roles).where(eq(roles.organizationId, organizationId));
    const byKey = new Map(orgRoles.map((r) => [r.key.toLowerCase(), r]));
    const byName = new Map(orgRoles.map((r) => [r.name.toLowerCase(), r]));
    const roleHint = orgRoles.map((r) => r.key).join(', ');

    const emails = [...new Set(records.map((r) => r.email.toLowerCase()).filter(Boolean))];
    const existingUsers = emails.length
      ? await tx.select({ id: users.id, email: users.email, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(inArray(users.email, emails))
      : [];
    const userByEmail = new Map(existingUsers.map((u) => [u.email, u]));
    const memberRows = existingUsers.length
      ? await tx
          .select({ userId: memberships.userId, roleId: memberships.roleId, externalId: memberships.externalId, cohort: memberships.cohort })
          .from(memberships)
          .where(and(eq(memberships.organizationId, organizationId), inArray(memberships.userId, existingUsers.map((u) => u.id))))
      : [];
    const memberByUser = new Map(memberRows.map((m) => [m.userId, m]));
    const externalIds = [...new Set(records.map((r) => r.roll_number).filter(Boolean))];
    const takenExternal = externalIds.length
      ? await tx
          .select({ externalId: memberships.externalId, userId: memberships.userId, name: users.name })
          .from(memberships)
          .innerJoin(users, eq(users.id, memberships.userId))
          .where(and(eq(memberships.organizationId, organizationId), isNotNull(memberships.externalId), inArray(memberships.externalId, externalIds)))
      : [];
    const externalOwner = new Map(takenExternal.map((t) => [t.externalId!, t]));

    const seenEmail = new Map<string, number>();
    const seenExternal = new Map<string, number>();

    return records.map((rec, i) => {
      const row = i + rowOffset;
      const errors: ImportRowReport['errors'] = [];
      const warnings: string[] = [];
      const email = rec.email.toLowerCase();

      if (!rec.name) errors.push({ field: 'name', message: 'Name is missing' });
      else if (rec.name.length > 120) errors.push({ field: 'name', message: 'Name is longer than 120 characters' });
      if (!email) errors.push({ field: 'email', message: 'Email is missing' });
      else if (email.length > 254 || !emailSchema.safeParse(email).success) errors.push({ field: 'email', message: `"${rec.email}" is not a valid email` });
      if (rec.roll_number.length > 64) errors.push({ field: 'roll_number', message: 'Roll number is longer than 64 characters' });
      if (rec.cohort.length > 64) errors.push({ field: 'cohort', message: 'Cohort is longer than 64 characters' });

      const roleRef = rec.role.toLowerCase();
      const role = roleRef ? (byKey.get(roleRef) ?? byKey.get(roleRef.replace(/[\s-]+/g, '_')) ?? byName.get(roleRef)) : byKey.get('candidate');
      if (!role) errors.push({ field: 'role', message: `Unknown role "${rec.role}". Use one of: ${roleHint}` });
      else if (permissionsBeyond(actor.auth, role.permissions).length > 0) {
        errors.push({ field: 'role', message: `You can't assign ${role.name}: it has access you don't have` });
      }

      if (email) {
        const first = seenEmail.get(email);
        if (first !== undefined) errors.push({ field: 'email', message: `Same email as row ${first}` });
        else seenEmail.set(email, row);
      }
      if (rec.roll_number) {
        const first = seenExternal.get(rec.roll_number);
        if (first !== undefined) errors.push({ field: 'roll_number', message: `Same roll number as row ${first}` });
        else seenExternal.set(rec.roll_number, row);
      }

      const user = userByEmail.get(email);
      const member = user ? memberByUser.get(user.id) : undefined;
      if (user?.isPlatformAdmin) errors.push({ field: 'email', message: 'This email belongs to a platform administrator' });
      const owner = rec.roll_number ? externalOwner.get(rec.roll_number) : undefined;
      if (owner && owner.userId !== user?.id) errors.push({ field: 'roll_number', message: `Roll number already belongs to ${owner.name}` });

      let action: RowAction | null = null;
      if (errors.length === 0 && role) {
        if (!user) action = 'create';
        else if (!member) {
          action = 'link';
          warnings.push('Already has an Athena account: added with their current password');
        } else {
          const changes = (rec.roll_number && rec.roll_number !== member.externalId) || (rec.cohort && rec.cohort !== member.cohort);
          action = changes ? 'update' : 'skip';
          if (member.roleId !== role.id) {
            const currentRole = orgRoles.find((r) => r.id === member.roleId);
            warnings.push(`Already a member as ${currentRole?.name ?? 'another role'}. Their role stays; change it on the People page.`);
          } else if (!changes) warnings.push('Already a member with these details: nothing to change');
        }
      }

      return {
        row,
        name: rec.name,
        email,
        role: role ? { key: role.key, name: role.name } : null,
        externalId: rec.roll_number || null,
        cohort: rec.cohort || null,
        action,
        errors,
        warnings,
      };
    });
  }

  async run(actor: Actor, input: { format: 'csv' | 'json'; data: unknown; dryRun: boolean; skipInvalid: boolean; filename?: string | null }): Promise<ImportReport> {
    const { records, ignoredColumns, rowOffset } = this.parse(input.format, input.data);
    if (records.length === 0) throw new ValidationError('The file has no people in it', { data: 'No rows found' });
    if (records.length > MAX_IMPORT_ROWS) {
      throw new ValidationError(`Import up to ${MAX_IMPORT_ROWS} people at a time. This file has ${records.length}.`, { data: 'Too many rows' });
    }
    const filename = input.filename?.slice(0, 200) || null;
    const summarize = (rows: ImportRowReport[]): ImportReport['summary'] => ({
      total: rows.length,
      valid: rows.filter((r) => r.errors.length === 0).length,
      invalid: rows.filter((r) => r.errors.length > 0).length,
      warnings: rows.filter((r) => r.warnings.length > 0).length,
      create: rows.filter((r) => r.action === 'create').length,
      link: rows.filter((r) => r.action === 'link').length,
      update: rows.filter((r) => r.action === 'update').length,
      skip: rows.filter((r) => r.action === 'skip').length,
    });

    if (input.dryRun) {
      const rows = await this.validate(this.db, actor, records, rowOffset);
      return { dryRun: true, committed: false, jobId: null, filename, ignoredColumns, summary: summarize(rows), rows, credentials: [] };
    }

    const organizationId = actor.auth.organization.id;
    try {
      return await this.db.transaction(async (tx) => {
        const rows = await this.validate(tx, actor, records, rowOffset);
        const summary = summarize(rows);
        if (summary.invalid > 0 && !input.skipInvalid) {
          throw new AppError(422, 'IMPORT_HAS_ERRORS', `${summary.invalid} ${summary.invalid === 1 ? 'row has' : 'rows have'} problems. Fix them, or import only the valid rows.`);
        }
        if (summary.create + summary.link + summary.update === 0) {
          throw new ValidationError('Nothing to import: every row is invalid or already up to date');
        }
        const credentials: ImportReport['credentials'] = [];

        // Argon2 hashing dominates; a small pool of workers keeps large files quick. Every worker is
        // awaited before a failure is rethrown, so nothing keeps writing into a transaction being rolled back.
        const queue = rows.filter((r) => r.action === 'create' || r.action === 'link');
        let next = 0;
        let failure: unknown = null;
        const worker = async () => {
          while (failure === null && next < queue.length) {
            const r = queue[next++]!;
            try {
              const result = await provisionMember(tx, {
                organizationId,
                email: r.email,
                name: r.name,
                roleKey: r.role!.key,
                externalId: r.externalId,
                cohort: r.cohort,
              });
              if (result.temporaryPassword) credentials.push({ row: r.row, name: r.name, email: r.email, temporaryPassword: result.temporaryPassword });
            } catch (err) {
              failure ??= err;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
        if (failure !== null) throw failure;

        for (const r of rows.filter((x) => x.action === 'update')) {
          const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.email, r.email)).limit(1);
          await tx
            .update(memberships)
            .set({ ...(r.externalId ? { externalId: r.externalId } : {}), ...(r.cohort ? { cohort: r.cohort } : {}) })
            .where(and(eq(memberships.userId, u!.id), eq(memberships.organizationId, organizationId)));
        }
        credentials.sort((a, b) => a.row - b.row);

        const errorList = rows.flatMap((r) => r.errors.map((e) => ({ row: r.row, field: e.field, message: e.message })));
        const imported = summary.create + summary.link + summary.update;
        const [job] = await tx
          .insert(importJobs)
          .values({
            organizationId,
            kind: 'candidates',
            filename,
            totalRows: summary.total,
            importedRows: imported,
            errorRows: summary.invalid,
            errors: errorList.slice(0, 500),
            createdBy: actor.auth.user.id,
          })
          .returning({ id: importJobs.id });
        await this.audit.record(
          {
            organizationId,
            actorId: actor.auth.user.id,
            action: 'people.imported',
            entityType: 'import_job',
            entityId: job!.id,
            summary: `imported ${imported} ${imported === 1 ? 'person' : 'people'}${filename ? ` from ${filename}` : ''}`,
            metadata: { created: summary.create, linked: summary.link, updated: summary.update, skipped: summary.skip, invalid: summary.invalid },
            ip: actor.ip,
          },
          tx,
        );
        return { dryRun: false, committed: true, jobId: job!.id, filename, ignoredColumns, summary, rows, credentials };
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('Someone added some of these people while you were importing. Run the check again.');
      throw err;
    }
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ValidationError('That is not valid JSON', { data: 'Invalid JSON' });
  }
}
