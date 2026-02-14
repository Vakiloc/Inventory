import Database from 'better-sqlite3';
import path from 'node:path';

import { ensureDefaultSingleInventory, loadRegistry, resolveInventoryDataDir } from './inventories.js';
import { getDataDir } from './db.js';

// Cache DB handles per inventory id. For 0.1.1 we keep it simple; we can add LRU later.
const dbCache = new Map();

function openDbAt(dataDir, migrateFn) {
  const dbPath = path.join(dataDir, 'inventory.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateFn(db);
  return { db, dbPath };
}

export function createInventoryDbProvider({ migrateInventorySchema }) {
  if (typeof migrateInventorySchema !== 'function') {
    throw new Error('createInventoryDbProvider: migrateInventorySchema is required');
  }

  return {
    getRegistry() {
      const reg = loadRegistry();
      if (reg) return reg;
      // Legacy / standalone server mode: treat INVENTORY_DATA_DIR as the only inventory.
      return ensureDefaultSingleInventory(getDataDir());
    },

    getDbForInventory(inventoryId) {
      const reg = this.getRegistry();
      const dataDir = resolveInventoryDataDir(reg, inventoryId);
      if (!dataDir) {
        return { error: 'inventory_not_found' };
      }

      const key = String(inventoryId);
      const cached = dbCache.get(key);
      if (cached) return cached;

      const opened = openDbAt(dataDir, migrateInventorySchema);
      dbCache.set(key, opened);
      return opened;
    },

    closeAll() {
      for (const v of dbCache.values()) {
        try {
          v.db.close();
        } catch {
          // ignore
        }
      }
      dbCache.clear();
    }
  };
}
