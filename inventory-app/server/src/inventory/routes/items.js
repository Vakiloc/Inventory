import express from 'express';

import {
  parseIntParam,
  parseJsonBody,
  sendError,
  sendOk,
  sendValidationFailed,
  wrapRoute
} from '../../http.js';

import { ItemBarcodeSchema, ItemUpsertSchema, nowMs } from '../../validation.js';
import {
  attachBarcodeToItem,
  createItem,
  detachBarcodeFromItem,
  getItem,
  listItemBarcodes,
  listItemBarcodesSince,
  listItems,
  softDeleteItem,
  updateItem
} from '../repo.js';

export function createItemsRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createItemsRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createItemsRouter: requireEdit is required');

  const router = express.Router();

  router.get(
    '/items',
    requireAuth,
    wrapRoute((req, res) => {
      const q = typeof req.query.q === 'string' ? req.query.q : undefined;
      const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
      const locationId = req.query.locationId ? Number(req.query.locationId) : undefined;
      const since = req.query.since ? Number(req.query.since) : undefined;
      const includeDeleted = req.query.includeDeleted === '1';

      const items = listItems(req.db, { q, categoryId, locationId, since, includeDeleted });
      const deleted = items.filter(i => i.deleted === 1).map(i => i.item_id);

      sendOk(res, { items, deleted, serverTimeMs: nowMs() });
    })
  );

  router.get(
    '/item-barcodes',
    requireAuth,
    wrapRoute((req, res) => {
      const since = req.query.since ? Number(req.query.since) : 0;
      sendOk(res, {
        serverTimeMs: nowMs(),
        barcodes: listItemBarcodesSince(req.db, Number.isFinite(since) ? since : 0)
      });
    })
  );

  router.get(
    '/items/:id',
    requireAuth,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const item = getItem(req.db, id);
      if (!item) return sendError(res, 404, 'not_found');
      sendOk(res, { item });
    })
  );

  router.get(
    '/items/:id/barcodes',
    requireAuth,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const item = getItem(req.db, id);
      if (!item) return sendError(res, 404, 'not_found');
      sendOk(res, { barcodes: listItemBarcodes(req.db, id) });
    })
  );

  router.post(
    '/items/:id/barcodes',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(ItemBarcodeSchema, req, res);
      if (!data) return;

      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const result = attachBarcodeToItem(req.db, id, data.barcode);
      if (result?.error === 'not_found') return sendError(res, 404, 'not_found');
      if (result?.error === 'barcode_in_use') {
        return sendOk(res, { error: 'barcode_in_use', item_id: result.item_id }, 409);
      }
      sendOk(res, { ok: true, barcode: result.barcode, item_id: result.item_id });
    })
  );

  router.post(
    '/items',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(ItemUpsertSchema, req, res);
      if (!data) return;
      const created = createItem(req.db, data);
      sendOk(res, { item: created });
    })
  );

  router.put(
    '/items/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const parsed = ItemUpsertSchema.partial().safeParse(req.body);
      if (!parsed.success) return sendValidationFailed(res, parsed.error.flatten());

      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const existing = getItem(req.db, id);
      if (!existing) return sendError(res, 404, 'not_found');

      // LWW guard: reject older writes
      if (
        typeof parsed.data.last_modified === 'number' &&
        parsed.data.last_modified < (existing.last_modified ?? 0)
      ) {
        return sendOk(res, {
          error: 'conflict',
          serverItem: existing,
          clientTimestamp: parsed.data.last_modified
        }, 409);
      }

      const updated = updateItem(req.db, id, parsed.data);
      sendOk(res, { item: updated });
    })
  );

  router.delete(
    '/items/:id',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const updated = softDeleteItem(req.db, id);
      if (!updated) return sendError(res, 404, 'not_found');
      sendOk(res, { item: updated });
    })
  );

  router.delete(
    '/items/:id/barcodes/:barcode',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const id = parseIntParam(req, res, 'id');
      if (!id) return;

      const barcode = decodeURIComponent(req.params.barcode || '').trim();
      if (!barcode) return sendError(res, 400, 'barcode_required');

      const result = detachBarcodeFromItem(req.db, id, barcode);
      if (result?.error === 'not_found') return sendError(res, 404, 'not_found');
      sendOk(res, { ok: true, barcode, item_id: id });
    })
  );

  return router;
}
