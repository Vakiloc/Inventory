import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Inventory Database (inventory.sqlite)
 * Source of Truth for:
 * - Items, Categories, Locations
 * - Scan History, Sync Logs
 *
 * WebAuthn credentials are managed by the IdP module in server-state.sqlite.
 */

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function getDataDir() {
  // Keep DB next to server by default; Electron can override via INVENTORY_DATA_DIR
  const base = process.env.INVENTORY_DATA_DIR || path.join(process.cwd(), 'data');
  ensureDir(base);
  return base;
}

export function openDb() {
  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, 'inventory.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrateInventorySchema(db);
  return { db, dbPath };
}

export function migrateInventorySchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      category_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS locations (
      location_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      parent_id INTEGER,
      UNIQUE(name, parent_id),
      FOREIGN KEY(parent_id) REFERENCES locations(location_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      item_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      barcode TEXT,
      barcode_corrupted INTEGER NOT NULL DEFAULT 0,
      category_id INTEGER,
      location_id INTEGER,
      purchase_date TEXT,
      warranty_info TEXT,
      value REAL,
      serial_number TEXT,
      photo_path TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      last_modified INTEGER NOT NULL,
      FOREIGN KEY(category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
      FOREIGN KEY(location_id) REFERENCES locations(location_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS item_barcodes (
      barcode TEXT PRIMARY KEY,
      item_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER) * 1000),
      FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_events (
      event_id TEXT PRIMARY KEY,
      barcode TEXT NOT NULL,
      item_id INTEGER,
      delta INTEGER NOT NULL,
      status TEXT NOT NULL,
      scanned_at INTEGER,
      applied_at INTEGER NOT NULL,
      FOREIGN KEY(item_id) REFERENCES items(item_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY,
      sync_time INTEGER NOT NULL,
      source TEXT NOT NULL,
      details TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
    CREATE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode);
    CREATE INDEX IF NOT EXISTS idx_items_last_modified ON items(last_modified);
    CREATE INDEX IF NOT EXISTS idx_items_deleted ON items(deleted);

    CREATE INDEX IF NOT EXISTS idx_item_barcodes_item_id ON item_barcodes(item_id);
    CREATE INDEX IF NOT EXISTS idx_item_barcodes_created_at ON item_barcodes(created_at);

    CREATE INDEX IF NOT EXISTS idx_scan_events_applied_at ON scan_events(applied_at);
  `);

  // Backwards-compatible migrations for existing DB files.
  // (CREATE TABLE IF NOT EXISTS does not add new columns.)
  try {
    const cols = db.prepare("PRAGMA table_info(items)").all();
    const hasCorrupted = Array.isArray(cols) && cols.some(c => c?.name === 'barcode_corrupted');
    if (!hasCorrupted) {
      db.exec('ALTER TABLE items ADD COLUMN barcode_corrupted INTEGER NOT NULL DEFAULT 0');
    }
  } catch {
    // If migration fails, keep running; the API will still work on fresh DBs.
  }

  const hasToken = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('api_token');

  if (!hasToken) {
    const token = cryptoRandomToken();
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('api_token', token);
  }
}

function cryptoRandomToken() {
  // Node 18+ has global crypto
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('hex');
}

export function getApiToken(db) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('api_token');
  return row?.value;
}
