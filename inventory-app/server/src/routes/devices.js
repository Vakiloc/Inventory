import express from 'express';

import { parseIntParam, sendError, sendOk, wrapRoute } from '../http.js';

export function createDevicesRouter({ stateDb, requireAuth, requireOwner }) {
  if (!stateDb) throw new Error('createDevicesRouter: stateDb is required');
  if (typeof requireAuth !== 'function') throw new Error('createDevicesRouter: requireAuth is required');
  if (typeof requireOwner !== 'function') throw new Error('createDevicesRouter: requireOwner is required');

  const router = express.Router();

  router.get(
    '/devices',
    requireAuth,
    requireOwner,
    wrapRoute((req, res) => {
      const rows = stateDb
        .prepare('SELECT device_id, name, role, revoked, created_at, last_seen_at FROM devices ORDER BY created_at DESC')
        .all();
      sendOk(res, { devices: rows });
    })
  );

  router.post(
    '/devices/:id/revoke',
    requireAuth,
    requireOwner,
    wrapRoute((req, res) => {
      const id = String(req.params?.id || '').trim();
      if (!id) return sendError(res, 400, 'invalid_id');

      const revoked = !!req.body?.revoked;
      stateDb.prepare('UPDATE devices SET revoked = ? WHERE device_id = ?').run(revoked ? 1 : 0, id);
      sendOk(res, { ok: true, device_id: id, revoked });
    })
  );

  return router;
}
