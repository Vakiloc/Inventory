// Re-export shim: inventory DB has moved to inventory/db.js
export {
  getDataDir,
  openDb,
  migrateInventorySchema,
  getApiToken
} from './inventory/db.js';
