import { Router } from 'express';
import { z } from 'zod';
import type { Container } from '../../container';
import { parse } from '../../lib/validate';
import { requirePermission, tenantOf } from '../../middleware/guards';
import { CategoryService } from './categories.service';
import { CSV_TEMPLATE, JSON_TEMPLATE } from './question-import';
import { QuestionImportService } from './question-import.service';
import { QuestionService } from './questions.service';
import { bulkIdsSchema, categoryInputSchema, createQuestionSchema, importRequestSchema, listQuestionsSchema, previewSchema, updateQuestionSchema } from './questions.schemas';
import { idParam } from './route-helpers';

/** Question bank, categories, versions, candidate preview and bulk import (mounted at /api/v1/questions). */
export function questionsRoutes(c: Container): Router {
  const router = Router();
  const categories = new CategoryService(c.db, c.audit);
  const questions = new QuestionService(c.db, c.audit, categories);
  const importer = new QuestionImportService(c.db, c.audit, categories);
  const view = requirePermission('questions.view');
  const manage = requirePermission('questions.manage');

  // ---------- categories (literal paths are registered before /:id) ----------
  router.get('/categories', view, async (req, res) => {
    res.json({ items: await categories.list(tenantOf(req).organization.id) });
  });
  router.post('/categories', manage, async (req, res) => {
    res.status(201).json(await categories.create(tenantOf(req), parse(categoryInputSchema, req.body)));
  });
  router.patch('/categories/:categoryId', manage, async (req, res) => {
    const id = idParam(req, 'categoryId', 'Category');
    res.json(await categories.update(tenantOf(req), id, parse(categoryInputSchema.partial(), req.body)));
  });
  router.delete('/categories/:categoryId', manage, async (req, res) => {
    const id = idParam(req, 'categoryId', 'Category');
    res.json(await categories.remove(tenantOf(req), id));
  });

  router.get('/tags', view, async (req, res) => {
    res.json({ items: await questions.tags(tenantOf(req).organization.id) });
  });

  // ---------- import ----------
  router.get('/import/template', manage, (req, res) => {
    const { format } = parse(z.object({ format: z.enum(['csv', 'json']).default('csv') }), req.query);
    tenantOf(req);
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="athena-question-template.${format}"`);
    res.send(format === 'csv' ? `${CSV_TEMPLATE}\n` : `${JSON_TEMPLATE}\n`);
  });
  router.post('/import', manage, async (req, res) => {
    const body = parse(importRequestSchema, req.body);
    const result = await importer.run(tenantOf(req), body);
    res.status(body.dryRun ? 200 : 201).json(result);
  });

  // ---------- authoring helpers ----------
  router.post('/preview', manage, (req, res) => {
    tenantOf(req);
    res.json(questions.preview(parse(previewSchema, req.body)));
  });
  router.post('/bulk-archive', manage, async (req, res) => {
    res.json(await questions.setStatus(tenantOf(req), parse(bulkIdsSchema, req.body).ids, 'archived'));
  });
  router.post('/bulk-restore', manage, async (req, res) => {
    res.json(await questions.setStatus(tenantOf(req), parse(bulkIdsSchema, req.body).ids, 'active'));
  });

  // ---------- questions ----------
  router.get('/', view, async (req, res) => {
    res.json(await questions.list(tenantOf(req), parse(listQuestionsSchema, req.query)));
  });
  router.post('/', manage, async (req, res) => {
    res.status(201).json(await questions.create(tenantOf(req), parse(createQuestionSchema, req.body)));
  });
  router.get('/:id', view, async (req, res) => {
    res.json(await questions.get(tenantOf(req), idParam(req, 'id', 'Question')));
  });
  router.put('/:id', manage, async (req, res) => {
    const id = idParam(req, 'id', 'Question');
    res.json(await questions.update(tenantOf(req), id, parse(updateQuestionSchema, req.body)));
  });
  router.post('/:id/archive', manage, async (req, res) => {
    const id = idParam(req, 'id', 'Question');
    await questions.setStatus(tenantOf(req), [id], 'archived');
    res.json(await questions.get(tenantOf(req), id));
  });
  router.post('/:id/restore', manage, async (req, res) => {
    const id = idParam(req, 'id', 'Question');
    await questions.setStatus(tenantOf(req), [id], 'active');
    res.json(await questions.get(tenantOf(req), id));
  });
  router.post('/:id/duplicate', manage, async (req, res) => {
    res.status(201).json(await questions.duplicate(tenantOf(req), idParam(req, 'id', 'Question')));
  });
  router.get('/:id/versions', view, async (req, res) => {
    res.json(await questions.versions(tenantOf(req), idParam(req, 'id', 'Question')));
  });

  return router;
}
