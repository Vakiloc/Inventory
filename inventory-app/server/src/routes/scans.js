import express from 'express';

import { parseJsonBody, sendError, sendOk, wrapRoute } from '../http.js';
import { BarcodeResolveSchema, BarcodeScanSchema, ScanEventsApplySchema, nowMs } from '../validation.js';
import { applyScanEventByBarcode, applyScanEventByBarcodeChosenItem, forceAttachBarcodeToItem, getItem, getItemsByBarcodeExact, incrementItemQuantity } from '../repo.js';

export function createScansRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createScansRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createScansRouter: requireEdit is required');

  const router = express.Router();

  // Resolve barcode to an item (primary or alternate) without changing quantity.
  router.post(
    '/scan/resolve',
    requireAuth,
    wrapRoute((req, res) => {
      const data = parseJsonBody(BarcodeResolveSchema, req, res);
      if (!data) return;

      const barcode = data.barcode.trim();
      console.log(`[Scans] /scan/resolve barcode=${barcode}`);
      
      const matches = getItemsByBarcodeExact(req.db, barcode);
      if (matches.length === 0) {
        console.log(`[Scans] /scan/resolve not_found`);
        return sendOk(res, { action: 'not_found' });
      }
      if (matches.length === 1) {
        console.log(`[Scans] /scan/resolve found item_id=${matches[0].item_id}`);
        return sendOk(res, { action: 'found', item: matches[0] });
      }
      console.log(`[Scans] /scan/resolve ambiguous matches=${matches.length}`);
      return sendOk(res, { action: 'multiple', items: matches });
    })
  );

  // Barcode scan: if barcode already exists (primary or alternate), increment quantity.
  // If not found, return action=not_found so client can open Add Item prefilled.
  router.post(
    '/scan',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(BarcodeScanSchema, req, res);
      if (!data) return;

      const barcode = data.barcode.trim();
      const delta = data.delta;
      const eventId = data.event_id ? String(data.event_id).trim() : null;
      const chosenItemId = typeof data.item_id === 'number' ? data.item_id : null;
      const override = data.override === true;

      console.log(`[Scans] /scan barcode=${barcode} delta=${delta} item=${chosenItemId || 'any'} override=${override} event=${eventId}`);

      if (chosenItemId) {
        const item = getItem(req.db, chosenItemId);
        if (!item || item.deleted === 1) return sendError(res, 404, 'not_found');

        // If an event id is supplied, apply idempotently so retry won't double-increment.
        if (eventId) {
          const result = applyScanEventByBarcodeChosenItem(req.db, {
            event_id: eventId,
            barcode,
            delta,
            scanned_at: nowMs(),
            item_id: chosenItemId,
            override
          });

          if (result.status === 'mismatch') {
            console.warn(`[Scans] Scan mismatch for item=${chosenItemId} barcode=${barcode}`);
            return sendOk(res, { error: 'barcode_item_mismatch' }, 409);
          }
          if (result.status === 'not_found') return sendOk(res, { action: 'not_found' });
          if (result.status === 'duplicate' || result.status === 'applied') {
            console.log(`[Scans] Scan applied (chosen) status=${result.status}`);
            return sendOk(res, { action: 'incremented', item: result.item });
          }
          return sendOk(res, { action: 'not_found' });
        }

        if (override) {
          // Non-idempotent fallback; clients should prefer event_id.
          console.log(`[Scans] Force attaching barcode ${barcode} to item ${chosenItemId}`);
          forceAttachBarcodeToItem(req.db, chosenItemId, barcode);
          const updated = incrementItemQuantity(req.db, chosenItemId, delta);
          if (!updated) return sendError(res, 404, 'not_found');
          return sendOk(res, { action: 'incremented', item: updated });
        }

        const matches = getItemsByBarcodeExact(req.db, barcode);
        if (!matches.some(i => i.item_id === chosenItemId)) {
          return sendOk(res, { error: 'barcode_item_mismatch' }, 409);
        }

        const updated = incrementItemQuantity(req.db, chosenItemId, delta);
        if (!updated) return sendError(res, 404, 'not_found');
        return sendOk(res, { action: 'incremented', item: updated });
      }

      // If an event id is supplied, apply idempotently so retry won't double-increment.
      if (eventId) {
        const result = applyScanEventByBarcode(req.db, {
          event_id: eventId,
          barcode,
          delta,
          scanned_at: nowMs()
        });
        if (result.status === 'not_found') {
             console.log('[Scans] Scan not_found');
             return sendOk(res, { action: 'not_found' });
        }
        if (result.status === 'ambiguous') {
            console.log('[Scans] Scan ambiguous');
            return sendOk(res, { action: 'multiple', items: result.items || [] });
        }
        if (result.status === 'duplicate' && !result.item) {
          if (result.reason === 'ambiguous') {
            return sendOk(res, { action: 'multiple', items: result.items || [] });
          }
          return sendOk(res, { action: 'not_found' });
        }
        if (result.status === 'applied' || result.status === 'duplicate') {
             console.log(`[Scans] Scan success status=${result.status}`);
             return sendOk(res, { action: 'incremented', item: result.item });
        }
      }

      const matches = getItemsByBarcodeExact(req.db, barcode);
      if (matches.length === 0) return sendOk(res, { action: 'not_found' });
      if (matches.length > 1) return sendOk(res, { action: 'multiple', items: matches });

      const updated = incrementItemQuantity(req.db, matches[0].item_id, delta);
      if (!updated) return sendError(res, 404, 'not_found');
      return sendOk(res, { action: 'incremented', item: updated });
    })
  );

  // Offline mobile support: apply a batch of scan delta events idempotently.
  // Unknown/illegible barcodes are returned as status=not_found so the client can mark them corrupted.
  router.post(
    '/scans/apply',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const data = parseJsonBody(ScanEventsApplySchema, req, res);
      if (!data) return;

      const results = [];
      for (const ev of data.events) {
        try {
          const r = typeof ev.item_id === 'number'
            ? applyScanEventByBarcodeChosenItem(req.db, {
              event_id: ev.event_id,
              barcode: ev.barcode,
              delta: ev.delta,
              scanned_at: ev.scanned_at,
              item_id: ev.item_id,
              override: ev.override === true
            })
            : applyScanEventByBarcode(req.db, {
              event_id: ev.event_id,
              barcode: ev.barcode,
              delta: ev.delta,
              scanned_at: ev.scanned_at
            });
          results.push(r);
        } catch (e) {
          results.push({ status: 'error', event_id: ev.event_id, reason: String(e?.message || e) });
        }
      }

      sendOk(res, { serverTimeMs: nowMs(), results });
    })
  );

  return router;
}
