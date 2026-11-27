import { Router } from 'express';
import { z } from 'zod';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requireAnyPermission, requirePermission, tenantOf } from '../../middleware/guards';
import { idParam } from '../questions/route-helpers';
import { CANDIDATE_CSV_TEMPLATE } from './enrollment-import';
import { EnrollmentService } from './enrollments.service';
import { EXAM_READ_PERMISSIONS } from './exam-roles';
import { ExamStaffService } from './exam-staff.service';
import { ExamStructureService } from './exam-structure.service';
import { ExamService } from './exams.service';
import {
  accommodationSchema,
  addQuestionsSchema,
  createExamSchema,
  eligibleSchema,
  enrollmentImportSchema,
  enrollmentListSchema,
  enrollSchema,
  examQuestionUpdateSchema,
  listExamsSchema,
  reorderSchema,
  sectionCreateSchema,
  sectionUpdateSchema,
  staffAddSchema,
  updateExamSchema,
} from './exams.schemas';

/**
 * Exams: lifecycle, structure, review, staff and enrollments (mounted at /api/v1/exams).
 * Route guards check organization permissions; services check exam-level staff roles via loadExamForStaff.
 */
export function examsRoutes(c: Container): Router {
  const router = Router();
  const staff = new ExamStaffService(c.db, c.audit);
  const exams = new ExamService(c.db, c.audit, staff);
  const structure = new ExamStructureService(c.db, c.audit);
  const enrollments = new EnrollmentService(c.db, c.audit);

  const read = requireAnyPermission(...EXAM_READ_PERMISSIONS);
  const manage = requirePermission('exams.manage');
  const examId = (req: Parameters<typeof tenantOf>[0]) => idParam(req, 'id', 'Exam');

  // ---------- exams ----------
  router.get('/', read, async (req, res) => {
    res.json(await exams.list(tenantOf(req), parse(listExamsSchema, req.query)));
  });
  router.post('/', requirePermission('exams.create'), async (req, res) => {
    res.status(201).json(await exams.create(tenantOf(req), parse(createExamSchema, req.body)));
  });
  router.get('/enrollments/template', requirePermission('candidates.manage'), (req, res) => {
    tenantOf(req);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="athena-candidates-template.csv"');
    res.send(`${CANDIDATE_CSV_TEMPLATE}\n`);
  });
  router.get('/:id', read, async (req, res) => {
    res.json(await exams.get(tenantOf(req), examId(req)));
  });
  router.patch('/:id', manage, async (req, res) => {
    res.json(await exams.update(tenantOf(req), examId(req), parse(updateExamSchema, req.body)));
  });
  router.get('/:id/review', read, async (req, res) => {
    res.json(await exams.review(tenantOf(req), examId(req)));
  });
  router.post('/:id/publish', requirePermission('exams.publish'), async (req, res) => {
    res.json(await exams.publish(tenantOf(req), examId(req)));
  });
  router.post('/:id/unpublish', requirePermission('exams.publish'), async (req, res) => {
    res.json(await exams.unpublish(tenantOf(req), examId(req)));
  });
  router.post('/:id/archive', manage, async (req, res) => {
    res.json(await exams.archive(tenantOf(req), examId(req)));
  });
  router.post('/:id/duplicate', requirePermission('exams.create'), async (req, res) => {
    res.status(201).json(await exams.duplicate(tenantOf(req), examId(req)));
  });

  // ---------- sections ----------
  router.post('/:id/sections', manage, async (req, res) => {
    res.status(201).json(await structure.createSection(tenantOf(req), examId(req), parse(sectionCreateSchema, req.body)));
  });
  router.post('/:id/sections/reorder', manage, async (req, res) => {
    res.json(await structure.reorderSections(tenantOf(req), examId(req), parse(reorderSchema, req.body).order));
  });
  router.patch('/:id/sections/:sectionId', manage, async (req, res) => {
    res.json(await structure.updateSection(tenantOf(req), examId(req), idParam(req, 'sectionId', 'Section'), parse(sectionUpdateSchema, req.body)));
  });
  router.post('/:id/sections/:sectionId/marks', manage, async (req, res) => {
    const { marks } = parse(z.object({ marks: z.number().positive('Marks must be more than 0').max(1000) }), req.body);
    res.json(await structure.setSectionMarks(tenantOf(req), examId(req), idParam(req, 'sectionId', 'Section'), marks));
  });
  router.delete('/:id/sections/:sectionId', manage, async (req, res) => {
    res.json(await structure.deleteSection(tenantOf(req), examId(req), idParam(req, 'sectionId', 'Section')));
  });

  // ---------- questions in the exam ----------
  router.post('/:id/questions', manage, async (req, res) => {
    res.status(201).json(await structure.addQuestions(tenantOf(req), examId(req), parse(addQuestionsSchema, req.body)));
  });
  router.patch('/:id/questions/:examQuestionId', manage, async (req, res) => {
    res.json(await structure.updateQuestion(tenantOf(req), examId(req), idParam(req, 'examQuestionId', 'Exam question'), parse(examQuestionUpdateSchema, req.body)));
  });
  router.delete('/:id/questions/:examQuestionId', manage, async (req, res) => {
    res.json(await structure.removeQuestion(tenantOf(req), examId(req), idParam(req, 'examQuestionId', 'Exam question')));
  });

  // ---------- staff ----------
  router.get('/:id/staff', read, async (req, res) => {
    res.json({ items: await staff.listFor(tenantOf(req), examId(req)) });
  });
  router.get('/:id/staff/eligible', manage, async (req, res) => {
    const { q } = parse(z.object({ q: z.string().trim().max(200).optional() }), req.query);
    res.json({ items: await staff.eligible(tenantOf(req), examId(req), q) });
  });
  router.post('/:id/staff', manage, async (req, res) => {
    res.status(201).json({ items: await staff.add(tenantOf(req), examId(req), parse(staffAddSchema, req.body)) });
  });
  router.delete('/:id/staff/:userId', manage, async (req, res) => {
    res.json({ items: await staff.remove(tenantOf(req), examId(req), idParam(req, 'userId', 'Staff member')) });
  });

  // ---------- enrollments ----------
  const candidates = requirePermission('candidates.manage');
  router.get('/:id/enrollments', read, async (req, res) => {
    res.json(await enrollments.list(tenantOf(req), examId(req), parse(enrollmentListSchema, req.query)));
  });
  router.get('/:id/eligible-candidates', candidates, async (req, res) => {
    res.json(await enrollments.eligible(tenantOf(req), examId(req), parse(eligibleSchema, req.query)));
  });
  router.post('/:id/enrollments', candidates, async (req, res) => {
    res.status(201).json(await enrollments.enroll(tenantOf(req), examId(req), parse(enrollSchema, req.body)));
  });
  router.post('/:id/enrollments/import', candidates, async (req, res) => {
    const body = parse(enrollmentImportSchema, req.body);
    res.status(body.dryRun ? 200 : 201).json(await enrollments.import(tenantOf(req), examId(req), body));
  });
  router.patch('/:id/enrollments/:enrollmentId', candidates, async (req, res) => {
    res.json(await enrollments.updateAccommodation(tenantOf(req), examId(req), idParam(req, 'enrollmentId', 'Enrollment'), parse(accommodationSchema, req.body)));
  });
  router.delete('/:id/enrollments/:enrollmentId', candidates, async (req, res) => {
    res.json(await enrollments.remove(tenantOf(req), examId(req), idParam(req, 'enrollmentId', 'Enrollment')));
  });

  return router;
}
