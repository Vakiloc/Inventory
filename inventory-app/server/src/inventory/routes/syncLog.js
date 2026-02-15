import express from 'express';

import { sendOk, wrapRoute } from '../../http.js';
import { appendSyncLog, exportSnapshot, importSnapshotLww, listSyncLog } from '../repo.js';

export function createSyncLogRouter({ requireAuth, requireEdit }) {
  if (typeof requireAuth !== 'function') throw new Error('createSyncLogRouter: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createSyncLogRouter: requireEdit is required');

  const router = express.Router();

  router.get(
    '/export',
    requireAuth,
    wrapRoute((req, res) => {
      const snapshot = exportSnapshot(req.db);
      appendSyncLog(req.db, { source: 'export', details: { items: snapshot.items?.length ?? 0 } });
      sendOk(res, snapshot);
    })
  );

  router.post(
    '/import',
    requireAuth,
    requireEdit,
    wrapRoute((req, res) => {
      const snapshot = req.body || {};
      importSnapshotLww(req.db, snapshot);
      appendSyncLog(req.db, { source: 'import', details: { ok: true } });
      sendOk(res, { ok: true });
    })
  );

  router.get(
    '/sync-log',
    requireAuth,
    wrapRoute((req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      sendOk(res, { log: listSyncLog(req.db, { limit: Number.isFinite(limit) ? limit : 50 }) });
    })
  );

  return router;
}
