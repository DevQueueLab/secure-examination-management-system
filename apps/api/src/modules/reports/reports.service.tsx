import { renderToBuffer } from '@react-pdf/renderer';
import { and, desc, eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import type { Container } from '../../container';
import { attempts, exams, issuedReports, organizations } from '../../db/schema';
import { verificationCode } from '../../lib/crypto';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { TenantAuthContext } from '../../types/auth';
import { computeExamAnalytics } from '../analytics/analytics.service';
import { loadExamForStaff } from '../exams/exam-access';
import { GRADING_ROLES, settingsOf } from '../grading/exam-structure';
import { maskName } from '../grading/response-format';
import { buildResultCard, type ResultCard } from '../results/result-card';
import { CandidateReport } from './pdf/candidate-report';
import { ExamReport } from './pdf/exam-report';
import { ReportSigner } from './signing';

type AttemptRow = typeof attempts.$inferSelect;
type ExamRow = typeof exams.$inferSelect;
type ReportRow = typeof issuedReports.$inferSelect;

const CODE_RE = /^ATH-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/;

/** The minimal, signed statement a verifiable report makes. Nothing else is ever disclosed publicly. */
export interface ReportPayload {
  code: string;
  organization: string;
  exam: string;
  candidate: string;
  score: number;
  maxScore: number;
  percent: number;
  issuedAt: string;
  resultsVersion: number;
  [key: string]: unknown;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

export class ReportsService {
  readonly signer: ReportSigner;

  constructor(private readonly c: Container) {
    this.signer = new ReportSigner(c.db, c.config.REPORT_SIGNING_KEY);
  }

  verifyUrl(code: string) {
    return `${this.c.config.APP_ORIGIN.replace(/\/$/, '')}/verify/${code}`;
  }

  async qrDataUrl(code: string) {
    return QRCode.toDataURL(this.verifyUrl(code), { margin: 1, width: 320, errorCorrectionLevel: 'M', color: { dark: '#1d1d1fff', light: '#ffffffff' } });
  }

  /**
   * Who may get a candidate report: the candidate after publication, or staff on the exam with reports.generate.
   * Anyone else (other candidates, other tenants, sandbox attempts) gets a 404.
   */
  private async loadForReport(auth: TenantAuthContext, attemptId: string): Promise<{ attempt: AttemptRow; exam: ExamRow; asOwner: boolean }> {
    const [attempt] = await this.c.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.organizationId, auth.organization.id), eq(attempts.isSandbox, false)))
      .limit(1);
    if (!attempt) throw new NotFoundError('Result');
    if (attempt.userId === auth.user.id && auth.permissions.has('results.view_own')) {
      const [exam] = await this.c.db.select().from(exams).where(eq(exams.id, attempt.examId)).limit(1);
      if (!exam) throw new NotFoundError('Result');
      if (exam.resultsStatus !== 'published' || attempt.status !== 'submitted') throw new ConflictError('Your results have not been published yet');
      return { attempt, exam, asOwner: true };
    }
    if (!auth.permissions.has('reports.generate')) throw new NotFoundError('Result');
    const exam = await loadExamForStaff(this.c.db, auth, attempt.examId, GRADING_ROLES);
    if (attempt.status !== 'submitted') throw new ConflictError('This attempt has not been submitted yet');
    return { attempt, exam, asOwner: false };
  }

  /** Latest valid report for the attempt at the exam's current results version. */
  async currentReport(attemptId: string, resultsVersion: number): Promise<ReportRow | null> {
    const [row] = await this.c.db
      .select()
      .from(issuedReports)
      .where(and(eq(issuedReports.attemptId, attemptId), eq(issuedReports.resultsVersion, resultsVersion), eq(issuedReports.status, 'valid')))
      .orderBy(desc(issuedReports.issuedAt))
      .limit(1);
    return row ?? null;
  }

  /**
   * Issues (or reuses) the verifiable report for a published result. A report whose signed score no longer
   * matches the live score (a regrade after publication) is superseded and a fresh one is issued.
   */
  async issue(auth: TenantAuthContext, attempt: AttemptRow, exam: ExamRow, card: ResultCard): Promise<ReportRow> {
    const existing = await this.currentReport(attempt.id, exam.resultsVersion);
    if (existing) {
      const p = existing.payload as Partial<ReportPayload>;
      if (p.score === card.score && p.maxScore === card.maxScore) return existing;
      await this.c.db.update(issuedReports).set({ status: 'superseded', supersededAt: new Date() }).where(eq(issuedReports.id, existing.id));
    }
    const [org] = await this.c.db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, exam.organizationId));
    for (let tries = 0; ; tries++) {
      const code = verificationCode();
      const issuedAt = new Date();
      const payload: ReportPayload = {
        code,
        organization: org?.name ?? '',
        exam: exam.code ? `${exam.title} (${exam.code})` : exam.title,
        candidate: maskName(card.candidate.name),
        score: card.score,
        maxScore: card.maxScore,
        percent: card.percent,
        issuedAt: issuedAt.toISOString(),
        resultsVersion: exam.resultsVersion,
      };
      const { signature, keyId } = await this.signer.sign(payload);
      try {
        const [row] = await this.c.db
          .insert(issuedReports)
          .values({
            organizationId: exam.organizationId,
            examId: exam.id,
            attemptId: attempt.id,
            userId: attempt.userId,
            verificationCode: code,
            resultsVersion: exam.resultsVersion,
            payload,
            signature,
            issuedAt,
          })
          .returning();
        await this.c.audit.record({
          organizationId: exam.organizationId,
          actorId: auth.user.id,
          action: 'report.issued',
          entityType: 'issued_report',
          entityId: row!.id,
          summary: `Issued verifiable report ${code} for ${exam.title}`,
          metadata: { attemptId: attempt.id, resultsVersion: exam.resultsVersion, keyId },
        });
        return row!;
      } catch (err) {
        // A code collision (60 bits) is astronomically rare; retry with a new one.
        if (tries < 3 && String((err as { code?: string }).code) === '23505') continue;
        throw err;
      }
    }
  }

  private async verificationBlock(row: ReportRow) {
    const { keyId } = await this.signer.publicKey();
    return { code: row.verificationCode, url: this.verifyUrl(row.verificationCode), qrDataUrl: await this.qrDataUrl(row.verificationCode), keyId, issuedAt: row.issuedAt };
  }

  /** Issues the verification code without downloading the PDF (the result page's "Get verification code"). */
  async issueForAttempt(auth: TenantAuthContext, attemptId: string) {
    const { attempt, exam } = await this.loadForReport(auth, attemptId);
    if (exam.resultsStatus !== 'published') throw new ConflictError('Publish results before issuing verifiable reports');
    const card = await buildResultCard(this.c.db, attempt, exam, { solutions: false, feedback: false });
    const row = await this.issue(auth, attempt, exam, card);
    const block = await this.verificationBlock(row);
    return { ...block, status: row.status };
  }

  async attemptPdf(auth: TenantAuthContext, attemptId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { attempt, exam, asOwner } = await this.loadForReport(auth, attemptId);
    const settings = settingsOf(exam);
    const showFeedback = asOwner ? settings.results.showFeedback : true;
    const card = await buildResultCard(this.c.db, attempt, exam, { solutions: false, feedback: showFeedback });
    const published = exam.resultsStatus === 'published';
    const row = published ? await this.issue(auth, attempt, exam, card) : null;
    const verification = row ? await this.verificationBlock(row) : null;
    const buffer = await renderToBuffer(<CandidateReport card={card} verification={verification} showFeedback={showFeedback} />);
    await this.c.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'report.downloaded',
      entityType: 'attempt',
      entityId: attempt.id,
      summary: `Downloaded the result report for ${card.candidate.name}${published ? '' : ' (provisional)'}`,
      metadata: { examId: exam.id, verificationCode: row?.verificationCode ?? null },
    });
    return { buffer, filename: `${slug(exam.code ?? exam.title)}-${slug(card.candidate.name)}-result.pdf` };
  }

  async examPdf(auth: TenantAuthContext, examId: string): Promise<{ buffer: Buffer; filename: string }> {
    const exam = await loadExamForStaff(this.c.db, auth, examId, GRADING_ROLES);
    const data = await computeExamAnalytics(this.c.db, exam);
    const buffer = await renderToBuffer(<ExamReport data={data} organizationName={auth.organization.name} />);
    await this.c.audit.record({
      organizationId: exam.organizationId,
      actorId: auth.user.id,
      action: 'report.exam_downloaded',
      entityType: 'exam',
      entityId: exam.id,
      summary: `Downloaded the examination report for ${exam.title}`,
    });
    return { buffer, filename: `${slug(exam.code ?? exam.title)}-exam-report.pdf` };
  }

  /** Public verification: only the signed payload and its status. Unknown codes are 404. */
  async verify(rawCode: string) {
    const code = rawCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) throw new NotFoundError('Report');
    const [row] = await this.c.db.select().from(issuedReports).where(eq(issuedReports.verificationCode, code)).limit(1);
    if (!row) throw new NotFoundError('Report');
    const p = row.payload as ReportPayload;
    const signatureValid = await this.signer.verify(row.payload, row.signature);
    const { keyId, algorithm } = await this.signer.publicKey();

    // Scores can also change through paths that never touch reports (a dispute remedy, a fairness adjustment),
    // so a report still marked valid is checked against the live result before it is called current.
    let status = row.status;
    let supersededAt = row.supersededAt;
    if (status === 'valid') {
      const [live] = await this.c.db
        .select({ score: attempts.score, maxScore: attempts.maxScore, resultsStatus: exams.resultsStatus, resultsVersion: exams.resultsVersion })
        .from(attempts)
        .innerJoin(exams, eq(exams.id, attempts.examId))
        .where(eq(attempts.id, row.attemptId))
        .limit(1);
      const same = (a: number | null | undefined, b: number) => a !== null && a !== undefined && Math.abs(a - b) < 1e-6;
      const current = !!live && live.resultsStatus === 'published' && live.resultsVersion === row.resultsVersion && same(live.score ?? 0, p.score) && same(live.maxScore, p.maxScore);
      if (!current) {
        status = 'superseded';
        supersededAt = new Date();
        await this.c.db
          .update(issuedReports)
          .set({ status: 'superseded', supersededAt })
          .where(and(eq(issuedReports.id, row.id), eq(issuedReports.status, 'valid')));
      }
    }

    return {
      code,
      valid: status === 'valid' && signatureValid,
      status,
      organization: p.organization,
      exam: p.exam,
      candidate: p.candidate,
      score: p.score,
      maxScore: p.maxScore,
      percent: p.percent,
      issuedAt: p.issuedAt,
      resultsVersion: p.resultsVersion,
      supersededAt,
      signatureValid,
      signature: { algorithm, keyId, value: row.signature, payload: p },
    };
  }

  async publicKey() {
    const key = await this.signer.publicKey();
    return {
      ...key,
      canonicalization: 'The signature covers the payload serialized as JSON with object keys sorted lexicographically at every level and no whitespace.',
    };
  }
}

const instances = new WeakMap<Container, ReportsService>();
/** One service (and one cached signing key) per container. */
export function reportsServiceFor(c: Container): ReportsService {
  let svc = instances.get(c);
  if (!svc) instances.set(c, (svc = new ReportsService(c)));
  return svc;
}
