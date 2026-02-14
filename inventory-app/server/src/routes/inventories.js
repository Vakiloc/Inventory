import express from 'express';

import { sendOk, wrapRoute } from '../http.js';
import { listInventoriesFromRegistry } from '../inventories.js';

export function createInventoriesRouter({ inventoryDbProvider, requireAuth }) {
  if (!inventoryDbProvider) throw new Error('createInventoriesRouter: inventoryDbProvider is required');
  if (typeof requireAuth !== 'function') throw new Error('createInventoriesRouter: requireAuth is required');

  const router = express.Router();

  router.get(
    '/inventories',
    requireAuth,
    wrapRoute((req, res) => {
      const reg = inventoryDbProvider.getRegistry();
      sendOk(res, {
        activeId: reg?.activeId || null,
        inventories: listInventoriesFromRegistry(reg)
      });
    })
  );

  return router;
}
