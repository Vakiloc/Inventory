import { createCategoriesRouter } from './routes/categories.js';
import { createLocationsRouter } from './routes/locations.js';
import { createItemsRouter } from './routes/items.js';
import { createScansRouter } from './routes/scans.js';
import { createSyncLogRouter } from './routes/syncLog.js';
import { createInventoriesRouter } from './routes/inventories.js';

/**
 * Inventory App module.
 *
 * Responsible for:
 * - Item, Category, Location CRUD
 * - Barcode scanning and quantity management
 * - Sync / Export / Import
 * - Multi-inventory selection
 *
 * All data is stored in inventory.sqlite (one per inventory).
 * Auth middleware is provided by the IdP module — this module only
 * consumes `requireAuth` and `requireEdit` functions.
 */
export function createInventoryRouters({ inventoryDbProvider, requireAuth, requireEdit }) {
  if (!inventoryDbProvider) throw new Error('createInventoryRouters: inventoryDbProvider is required');
  if (typeof requireAuth !== 'function') throw new Error('createInventoryRouters: requireAuth is required');
  if (typeof requireEdit !== 'function') throw new Error('createInventoryRouters: requireEdit is required');

  // Return individual route routers — mounted flat on the API router by
  // app.js to match Express's expected routing depth.
  return [
    createInventoriesRouter({ inventoryDbProvider, requireAuth }),
    createCategoriesRouter({ requireAuth, requireEdit }),
    createLocationsRouter({ requireAuth, requireEdit }),
    createItemsRouter({ requireAuth, requireEdit }),
    createScansRouter({ requireAuth, requireEdit }),
    createSyncLogRouter({ requireAuth, requireEdit }),
  ];
}
