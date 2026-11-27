import { Router } from 'express';
import { z } from 'zod';
import { DISPUTE_CATEGORIES, DISPUTE_OUTCOMES, DISPUTE_STATUSES, REMEDY_TYPES, uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { DisputesService } from './disputes.service';
import { DisputeInsightsService } from './insights.service';
import { RemediesService } from './remedies.service';

const marksValue = (label: string) =>
  z
    .number({ error: `${label} must be a number` })
    .finite()
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, `${label} can have at most three decimals`);

/** "true"/"1" only: z.coerce.boolean() would read "false" as true. */
const flag = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const raiseSchema = z.object({
  attemptId: uuidParam,
  attemptItemId: uuidParam.nullable().optional(),
  category: z.enum(DISPUTE_CATEGORIES, { error: 'Choose what kind of problem this is' }),
  description: z
    .string({ error: 'Describe the problem' })
    .trim()
    .min(20, 'Describe the problem in at least 20 characters')
    .max(2000, 'Keep the description under 2000 characters'),
});

const previewQuery = z.object({
  itemId: uuidParam.optional(),
  category: z.enum(DISPUTE_CATEGORIES).default('grading_error'),
});

const messageSchema = z.object({
  body: z.string({ error: 'Write a message' }).trim().min(1, 'Write a message').max(2000, 'Keep the message under 2000 characters'),
  internal: z.boolean().optional().default(false),
});

const appealSchema = z.object({
  reason: z
    .string({ error: 'Explain why you are appealing' })
    .trim()
    .min(20, 'Explain why you disagree in at least 20 characters')
    .max(2000, 'Keep it under 2000 characters'),
});

const assignSchema = z.object({ assigneeId: uuidParam.nullable() });

const statusSchema = z
  .object({
    status: z.enum(['under_review', 'needs_info'], { error: 'Choose under review or needs information' }),
    message: z.string().trim().max(2000, 'Keep the message under 2000 characters').optional(),
  })
  .refine((v) => v.status !== 'needs_info' || (v.message && v.message.length >= 5), {
    message: 'Say what you need from the candidate',
    path: ['message'],
  });

const regradeSchema = z
  .object({
    part: z.enum(['answer', 'working'], { error: 'Choose which part to re-mark' }),
    score: marksValue('The score').optional(),
    rubricItemIds: z.array(uuidParam).max(50).optional(),
    adjustment: marksValue('The adjustment').optional(),
  })
  .refine((v) => v.score !== undefined || v.rubricItemIds !== undefined || v.adjustment !== undefined, {
    message: 'Give a new score, or choose rubric items',
    path: ['score'],
  });

const resolveSchema = z.object({
  outcome: z.enum(DISPUTE_OUTCOMES, { error: 'Choose an outcome' }),
  note: z
    .string({ error: 'Explain the decision' })
    .trim()
    .min(10, 'Explain the decision in at least 10 characters. The candidate will read it.')
    .max(2000, 'Keep the reason under 2000 characters'),
  regrade: regradeSchema.nullable().optional(),
});

const inboxQuery = z.object({
  examId: uuidParam.optional(),
  status: z.enum([...DISPUTE_STATUSES, 'active', 'all']).optional(),
  category: z.enum(DISPUTE_CATEGORIES).optional(),
  assignedToMe: flag,
  overdue: flag,
});

const remedySchema = z.object({
  questionId: uuidParam,
  type: z.enum(REMEDY_TYPES, { error: 'Choose a remedy' }),
  payload: z.record(z.string(), z.unknown()).default({}),
  reason: z
    .string({ error: 'Explain the remedy' })
    .trim()
    .min(10, 'Explain the remedy in at least 10 characters. Every affected candidate will see it.')
    .max(1000, 'Keep the reason under 1000 characters'),
  disputeId: uuidParam.nullable().optional(),
  /** Defaults to a preview: changing everyone's marks has to be asked for explicitly. */
  dryRun: z.boolean().default(true),
});

/** Routes for the disputes module (mounted at /disputes). Static paths come before /:id. */
export function disputesRoutes(c: Container): Router {
  const router = Router();
  const svc = new DisputesService(c);
  const insights = new DisputeInsightsService(c);
  const remedies = new RemediesService(c);

  const candidate = requirePermission('disputes.raise');
  const staff = requirePermission('disputes.resolve');
  const either = requireAnyPermission('disputes.raise', 'disputes.resolve');

  // ---------------------------------------------------------------- candidate
  router.post('/', candidate, async (req, res) => {
    res.status(201).json(await svc.raise(tenantOf(req), parse(raiseSchema, req.body)));
  });

  router.get('/mine', candidate, async (req, res) => {
    res.json(await svc.mine(tenantOf(req)));
  });

  router.get('/attempts/:attemptId/context', candidate, async (req, res) => {
    res.json(await svc.context(tenantOf(req), parse(uuidParam, req.params.attemptId)));
  });

  router.get('/attempts/:attemptId/preview', candidate, async (req, res) => {
    const q = parse(previewQuery, req.query);
    res.json(await svc.preview(tenantOf(req), parse(uuidParam, req.params.attemptId), q.itemId ?? null, q.category));
  });

  router.get('/attempts/:attemptId/history', requireAnyPermission('results.view_own', 'disputes.raise', 'disputes.resolve', 'grading.grade'), async (req, res) => {
    res.json(await insights.history(tenantOf(req), parse(uuidParam, req.params.attemptId)));
  });

  // ---------------------------------------------------------------- staff
  router.get('/', staff, async (req, res) => {
    res.json(await svc.inbox(tenantOf(req), parse(inboxQuery, req.query)));
  });

  router.get('/exams/:examId/summary', staff, async (req, res) => {
    res.json(await insights.summary(tenantOf(req), parse(uuidParam, req.params.examId)));
  });

  router.get('/exams/:examId/remedies', staff, async (req, res) => {
    res.json(await remedies.list(tenantOf(req), parse(uuidParam, req.params.examId)));
  });

  router.post('/exams/:examId/remedies', staff, async (req, res) => {
    const body = parse(remedySchema, req.body);
    const out = await remedies.apply(tenantOf(req), parse(uuidParam, req.params.examId), body);
    res.status(body.dryRun ? 200 : 201).json(out);
  });

  // ---------------------------------------------------------------- one dispute
  router.get('/:id', either, async (req, res) => {
    res.json(await svc.get(tenantOf(req), parse(uuidParam, req.params.id)));
  });

  router.post('/:id/messages', either, async (req, res) => {
    res.status(201).json(await svc.addMessage(tenantOf(req), parse(uuidParam, req.params.id), parse(messageSchema, req.body)));
  });

  router.post('/:id/withdraw', candidate, async (req, res) => {
    res.json(await svc.withdraw(tenantOf(req), parse(uuidParam, req.params.id)));
  });

  router.post('/:id/appeal', candidate, async (req, res) => {
    res.status(201).json(await svc.appeal(tenantOf(req), parse(uuidParam, req.params.id), parse(appealSchema, req.body)));
  });

  router.post('/:id/assign', staff, async (req, res) => {
    res.json(await svc.assign(tenantOf(req), parse(uuidParam, req.params.id), parse(assignSchema, req.body)));
  });

  router.post('/:id/status', staff, async (req, res) => {
    res.json(await svc.setStatus(tenantOf(req), parse(uuidParam, req.params.id), parse(statusSchema, req.body)));
  });

  router.post('/:id/resolve', staff, async (req, res) => {
    res.json(await svc.resolve(tenantOf(req), parse(uuidParam, req.params.id), parse(resolveSchema, req.body)));
  });

  return router;
}
