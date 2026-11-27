import Papa from 'papaparse';
import { z } from 'zod';

/** Pure parsing for candidate imports: CSV columns name, email, roll_number, cohort, time_multiplier. */

export interface CandidateRowError {
  row: number;
  field: string;
  message: string;
}

export interface CandidateDraft {
  row: number;
  name: string;
  email: string;
  rollNumber: string | null;
  cohort: string | null;
  /** null when the file leaves it blank (keeps an existing accommodation). */
  timeMultiplier: number | null;
}

export const MAX_CANDIDATE_ROWS = 500;
export const CANDIDATE_COLUMNS = ['name', 'email', 'roll_number', 'cohort', 'time_multiplier'] as const;

const email = z.string().trim().toLowerCase().email();

export const CANDIDATE_CSV_TEMPLATE = [
  CANDIDATE_COLUMNS.join(','),
  'Ayesha Malik,ayesha.malik@student.northfield.edu,FA24-BCS-002,BCS-5B,',
  'Hamza Siddiqui,hamza.siddiqui@student.northfield.edu,FA24-BCS-031,BCS-5A,1.25',
  'New Student,new.student@student.northfield.edu,FA24-BCS-099,BCS-5A,1.5',
].join('\n');

type RawRow = Record<string, unknown>;

function rowsFrom(format: 'csv' | 'json', data: string): { rows: RawRow[]; errors: CandidateRowError[]; base: number } | { fatal: Record<string, string> } {
  if (format === 'csv') {
    const result = Papa.parse<Record<string, string>>(data.replace(/^﻿/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'),
    });
    const fields = result.meta.fields ?? [];
    if (!fields.includes('email')) return { fatal: { data: 'The CSV needs an "email" column. Download the template to see the expected header.' } };
    const errors = result.errors
      .filter((e) => e.code !== 'TooFewFields')
      .map((e) => ({ row: (e.row ?? 0) + 2, field: 'row', message: e.message }));
    return { rows: result.data, errors, base: 2 };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (e) {
    return { fatal: { data: `Not valid JSON: ${(e as Error).message}` } };
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { candidates?: unknown })?.candidates) ? (parsed as { candidates: unknown[] }).candidates : null;
  if (!list) return { fatal: { data: 'Expected an array of candidates, or { "candidates": [...] }' } };
  return { rows: list.map((x) => (x && typeof x === 'object' ? (x as RawRow) : {})), errors: [], base: 1 };
}

export function parseCandidates(format: 'csv' | 'json', data: string): { drafts: CandidateDraft[]; errors: CandidateRowError[]; total: number } | { fatal: Record<string, string> } {
  const source = rowsFrom(format, data);
  if ('fatal' in source) return source;
  if (source.rows.length === 0) return { fatal: { data: 'The file has no rows' } };
  if (source.rows.length > MAX_CANDIDATE_ROWS) return { fatal: { data: `The file has ${source.rows.length} rows. Split it into files of at most ${MAX_CANDIDATE_ROWS}.` } };

  const errors: CandidateRowError[] = [...source.errors];
  const broken = new Set(source.errors.map((e) => e.row));
  const drafts: CandidateDraft[] = [];
  const seenEmail = new Map<string, number>();
  const seenRoll = new Map<string, number>();
  const str = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

  source.rows.forEach((raw, i) => {
    const row = i + source.base;
    if (broken.has(row)) return;
    const rowErrors: CandidateRowError[] = [];
    const err = (field: string, message: string) => rowErrors.push({ row, field, message });

    const emailRaw = str(raw.email);
    const parsedEmail = email.safeParse(emailRaw);
    if (!emailRaw) err('email', 'Email is required');
    else if (!parsedEmail.success) err('email', `"${emailRaw}" is not a valid email address`);
    const mail = parsedEmail.success ? parsedEmail.data : '';
    if (mail) {
      const first = seenEmail.get(mail);
      if (first !== undefined) err('email', `Duplicate of row ${first}`);
      else seenEmail.set(mail, row);
    }

    const name = str(raw.name);
    if (name.length > 120) err('name', 'Names are at most 120 characters');

    const roll = str(raw.roll_number ?? raw.rollNumber ?? raw.roll);
    if (roll.length > 64) err('roll_number', 'Roll numbers are at most 64 characters');
    if (roll) {
      const key = roll.toUpperCase();
      const first = seenRoll.get(key);
      if (first !== undefined) err('roll_number', `Roll number ${roll} is also used on row ${first}`);
      else seenRoll.set(key, row);
    }

    const cohort = str(raw.cohort);
    if (cohort.length > 80) err('cohort', 'Cohort names are at most 80 characters');

    const multRaw = str(raw.time_multiplier ?? raw.timeMultiplier).replace(/x$/i, '');
    let timeMultiplier: number | null = null;
    if (multRaw) {
      const n = Number(multRaw);
      if (!Number.isFinite(n) || n < 1 || n > 3) err('time_multiplier', `Time multiplier must be a number from 1 to 3 (got "${multRaw}")`);
      else if (Math.round(n * 100) !== n * 100) err('time_multiplier', 'Use at most two decimal places, e.g. 1.25');
      else timeMultiplier = n;
    }

    errors.push(...rowErrors);
    if (rowErrors.length === 0) drafts.push({ row, name, email: mail, rollNumber: roll || null, cohort: cohort || null, timeMultiplier });
  });
  return { drafts, errors, total: source.rows.length };
}
