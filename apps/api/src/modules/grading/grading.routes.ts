import { Router } from 'express';
import { z } from 'zod';
import { uuidParam } from '@athena/shared';
import type { Container } from '../../container';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { parse } from '../../lib/validate';
import { GradingService } from './grading.service';

const marksValue = (label: string) =>
  z
    .number({ error: `${label} must be a number` })
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, `${label} can have at most three decimals`);

const rubricBase = z.object({
  label: z.string().trim().min(1, 'Give the item a short label').max(200, 'Keep the label under 200 characters'),
  description: z.string().trim().max(1000, 'Keep the description under 1000 characters').nullable().optional(),
  points: marksValue('Points').refine((v) => Math.abs(v) <= 100, 'Points must be between −100 and 100'),
  target: z.enum(['answer', 'working']).default('answer'),
  position: z.number().int().min(0).max(10_000).optional(),
});
const rubricPatch = rubricBase
  .partial()
  .extend({ target: z.enum(['answer', 'working']).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to change');

const gradeSchema = z.object({
  part: z.enum(['answer', 'working'], { error: 'Choose which part you are grading' }),
  rubricItemIds: z.array(uuidParam).max(50).default([]),
  adjustment: marksValue('The adjustment').optional(),
  /** Explicit score; rejected (422) when outside [0, part max]. */
  score: marksValue('The score').optional(),
  feedback: z.string().max(5000, 'Keep feedback under 5000 characters').nullable().optional(),
});
const groupGradeSchema = gradeSchema.extend({
  answerIds: z.array(uuidParam).min(1, 'Choose at least one answer').max(500),
});

/** Routes for the grading module (mounted at /grading). */
export function gradingRoutes(c: Container): Router {
  const router = Router();
  const svc = new GradingService(c);
  const canGrade = requirePermission('grading.grade');
  const canRubric = requireAnyPermission('grading.grade', 'exams.manage');

  router.get('/inbox', canGrade, async (req, res) => {
    res.json(await svc.inbox(tenantOf(req)));
  });

  router.get('/exams/:examId/queue', canGrade, async (req, res) => {
    res.json(await svc.queue(tenantOf(req), parse(uuidParam, req.params.examId)));
  });

  router.get('/exams/:examId/questions/:questionId/rubric', canRubric, async (req, res) => {
    res.json(await svc.listRubric(tenantOf(req), parse(uuidParam, req.params.examId), parse(uuidParam, req.params.questionId)));
  });

  router.post('/exams/:examId/questions/:questionId/rubric', canRubric, async (req, res) => {
    const body = parse(rubricBase, req.body);
    res.status(201).json(await svc.createRubricItem(tenantOf(req), parse(uuidParam, req.params.examId), parse(uuidParam, req.params.questionId), body));
  });

  router.patch('/rubric-items/:id', canRubric, async (req, res) => {
    const body = parse(rubricPatch, req.body);
    res.json(await svc.updateRubricItem(tenantOf(req), parse(uuidParam, req.params.id), body));
  });

  router.delete('/rubric-items/:id', canRubric, async (req, res) => {
    res.json(await svc.deleteRubricItem(tenantOf(req), parse(uuidParam, req.params.id)));
  });

  router.get('/exams/:examId/questions/:questionId/answers', canGrade, async (req, res) => {
    res.json(await svc.answersForQuestion(tenantOf(req), parse(uuidParam, req.params.examId), parse(uuidParam, req.params.questionId)));
  });

  router.post('/exams/:examId/questions/:questionId/zero-blanks', canGrade, async (req, res) => {
    res.json(await svc.zeroBlanks(tenantOf(req), parse(uuidParam, req.params.examId), parse(uuidParam, req.params.questionId)));
  });

  // Declared before /answers/:answerId so "group" is never read as an id.
  router.post('/answers/group', canGrade, async (req, res) => {
    const { answerIds, ...input } = parse(groupGradeSchema, req.body);
    res.json(await svc.gradeGroup(tenantOf(req), answerIds, input));
  });

  router.put('/answers/:answerId', canGrade, async (req, res) => {
    const body = parse(gradeSchema, req.body);
    res.json(await svc.grade(tenantOf(req), parse(uuidParam, req.params.answerId), body));
  });

  return router;
}
