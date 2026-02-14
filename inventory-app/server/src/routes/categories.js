import express from 'express';

import { parseIntParam, parseJsonBody, sendError, sendOk, wrapRoute } from '../http.js';
import { CategorySchema } from '../validation.js';
import {
  createCategory,
  deleteCategory,
  listCategories,
  updateCategory
} from '../repo.js';

export function createCategoriesRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createCategoriesRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createCategoriesRouter: requireEdit is required');

  const router = express.Router();

  router.get(
    '/categories',
    requireAuth,
    wrapRoute((req, res) => {
      sendOk(res, { categories: listCategories(req.db) });
    })
  );

  router.post(
    '/categories',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(CategorySchema, req, res);
      if (!data) return;
      sendOk(res, { category: createCategory(req.db, data) });
    })
  );

  router.put(
    '/categories/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const data = parseJsonBody(CategorySchema, req, res);
      if (!data) return;

      try {
        const updated = updateCategory(req.db, id, data);
        if (!updated) return sendError(res, 404, 'not_found');
        sendOk(res, { category: updated });
      } catch (err) {
        if (String(err?.message || err).includes('UNIQUE')) {
          return sendError(res, 409, 'Category name already exists');
        }
        throw err;
      }
    })
  );

  router.delete(
    '/categories/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;
      deleteCategory(req.db, id);
      sendOk(res, { ok: true });
    })
  );

  return router;
}
