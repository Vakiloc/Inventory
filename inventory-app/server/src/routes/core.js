import express from 'express';
import crypto from 'node:crypto';

import { nowMs } from '../validation.js';
import { PairExchangeSchema } from '../validation.js';
import { parseJsonBody, sendError, sendOk, wrapRoute } from '../http.js';
import {
  consumePairingCode,
  createPairingCode,
  getPairingCodeStatus,
  getServerSecret,
  upsertDevice,
} from '../stateDb.js';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function isLoopback(req) {
  const ra = req.socket?.remoteAddress || '';
  return ra === '127.0.0.1' || ra === '::1' || ra.endsWith('127.0.0.1');
}

export function createCoreRouter({ ownerToken, stateDb, requireAuth }) {
  if (!ownerToken) throw new Error('createCoreRouter: ownerToken is required');
  if (!stateDb) throw new Error('createCoreRouter: stateDb is required');
  if (typeof requireAuth !== 'function') throw new Error('createCoreRouter: requireAuth is required');

  const router = express.Router();

  router.get(
    '/ping',
    wrapRoute((req, res) => {
      sendOk(res, { ok: true, name: 'inventory-server', time: new Date().toISOString() });
    })
  );

  // Desktop UI can read token locally; mobile pairing should use QR in desktop UI (added later)
  router.get(
    '/admin/token',
    wrapRoute((req, res) => {
      if (!isLoopback(req)) return sendError(res, 403, 'forbidden');
      sendOk(res, { token: ownerToken });
    })
  );

  // Desktop UI mints a short-lived pairing code to embed in a QR.
  router.get(
    '/admin/pair-code',
    wrapRoute((req, res) => {
      if (!isLoopback(req)) return sendError(res, 403, 'forbidden');
      const { code, expires_at_ms } = createPairingCode(stateDb, { ttlMs: 120_000, nowMs: nowMs() });
      sendOk(res, { code, expires_at_ms });
    })
  );

  // Desktop can poll this to know when the QR code has been consumed.
  router.get(
    '/admin/pair-code/:code/status',
    wrapRoute((req, res) => {
      if (!isLoopback(req)) return sendError(res, 403, 'forbidden');
      const result = getPairingCodeStatus(stateDb, req.params.code, { nowMs: nowMs() });
      if (!result.ok) return sendError(res, 400, result.error);
      sendOk(res, result);
    })
  );

  // Mobile exchanges pairing code + device identity for a deterministic per-device token.
  router.post(
    '/pair/exchange',
    wrapRoute((req, res) => {
      const data = parseJsonBody(PairExchangeSchema, req, res);
      if (!data) return;

      const consumed = consumePairingCode(stateDb, data.code, { nowMs: nowMs() });
      if (!consumed.ok) {
        const status = consumed.error === 'expired' ? 410 : 400;
        return sendError(res, status, consumed.error);
      }

      const pubkey = String(data.pubkey || '').trim();
      const claimedId = String(data.device_id || '').trim();
      const computedId = sha256Hex(pubkey);
      if (computedId !== claimedId) {
        return sendError(res, 400, 'device_mismatch');
      }

      const device = upsertDevice(stateDb, {
        device_id: claimedId,
        pubkey,
        name: data.name ?? null,
        role: 'editor',
        nowMs: nowMs()
      });

      if (device.revoked) return sendError(res, 403, 'revoked');

      const secret = getServerSecret(stateDb);
      const mac = crypto.createHmac('sha256', String(secret)).update(claimedId).digest('hex');
      const token = `d1.${claimedId}.${mac}`;
      sendOk(res, { token, device_id: claimedId, role: device.role || 'editor' });
    })
  );

  router.get(
    '/meta',
    requireAuth,
    wrapRoute((req, res) => {
      sendOk(res, {
        dbPath: req.dbPath,
        serverTimeMs: nowMs(),
        inventoryId: req.inventoryId,
        auth: { role: req?.auth?.role || null, device_id: req?.auth?.device_id || null }
      });
    })
  );

  return router;
}
