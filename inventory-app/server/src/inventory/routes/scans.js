import express from 'express';

import { parseJsonBody, sendOk, wrapRoute } from '../../http.js';
import { BarcodeResolveSchema, ScanEventsApplySchema, nowMs } from '../../validation.js';
import { applyScanEventByBarcode, applyScanEventByBarcodeChosenItem, getItemsByBarcodeExact } from '../repo.js';

/**
 * Process a single scan event and return a standardized result object.
 * Used by both the unified /scans endpoint and the legacy /scan redirect.
 */
function processScanEvent(db, ev) {
  try {
    const r = typeof ev.item_id === 'number'
      ? applyScanEventByBarcodeChosenItem(db, {
        event_id: ev.event_id,
        barcode: ev.barcode,
        delta: ev.delta,
        scanned_at: ev.scanned_at,
        item_id: ev.item_id
      })
      : applyScanEventByBarcode(db, {
        event_id: ev.event_id,
        barcode: ev.barcode,
        delta: ev.delta,
        scanned_at: ev.scanned_at
      });
    return r;
  } catch (e) {
    return { status: 'error', event_id: ev.event_id, reason: String(e?.message || e) };
  }
}

export function createScansRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createScansRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createScansRouter: requireEdit is required');

  const router = express.Router();

  // Read-only barcode resolution (no quantity changes)
  router.post(
    '/scan/resolve',
    requireAuth,
    wrapRoute((req, res) => {
      const data = parseJsonBody(BarcodeResolveSchema, req, res);
      if (!data) return;

      const barcode = data.barcode.trim();
      const matches = getItemsByBarcodeExact(req.db, barcode);

      if (matches.length === 0) return sendOk(res, { action: 'not_found' });
      if (matches.length === 1) return sendOk(res, { action: 'found', item: matches[0] });
      return sendOk(res, { action: 'multiple', items: matches });
    })
  );

  // Unified scan endpoint: accepts 1-500 scan events
  // Response: { serverTimeMs, results: [{ event_id, status, item?, reason?, items? }] }
  router.post(
    '/scans',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(ScanEventsApplySchema, req, res);
      if (!data) return;

      const results = data.events.map(ev => processScanEvent(req.db, ev));
      sendOk(res, { serverTimeMs: nowMs(), results });
    })
  );

  return router;
}
