import { sendError } from './http.js';

const HEADER = 'x-inventory-id';

export function createInventoryMiddleware(inventoryDbProvider) {
  if (!inventoryDbProvider) throw new Error('createInventoryMiddleware: inventoryDbProvider is required');

  return function inventoryContext(req, res, next) {
    const reg = inventoryDbProvider.getRegistry();
    const headerId = req.header(HEADER);
    const inventoryId = String(headerId || reg?.activeId || 'default').trim();

    const resolved = inventoryDbProvider.getDbForInventory(inventoryId);
    if (resolved?.error) {
      return sendError(res, 404, 'inventory_not_found', { inventoryId });
    }

    req.inventoryId = inventoryId;
    req.db = resolved.db;
    req.dbPath = resolved.dbPath;

    // Useful for debugging / client confirmation.
    res.setHeader('X-Inventory-Id', inventoryId);
    next();
  };
}

export function getRequestInventoryId(req) {
  return req?.inventoryId ? String(req.inventoryId) : null;
}
