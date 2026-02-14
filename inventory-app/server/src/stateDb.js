import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Server State Database (server-state.sqlite)
 * Source of Truth for:
 * - Server Secrets, Owner Token
 * - Paired Devices, Device Tokens
 * - Pairing Codes
 * Checks: migrateState()
 */

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function cryptoRandomTokenHex(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function getServerStateDir() {
  const base = process.env.INVENTORY_SERVER_STATE_DIR || process.env.INVENTORY_DATA_DIR || path.join(process.cwd(), 'data');
  ensureDir(base);
  return base;
}

export function openStateDb() {
  const dir = getServerStateDir();
  const dbPath = path.join(dir, 'server-state.sqlite');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrateState(db);
  return { db, dbPath };
}

function migrateState(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      pubkey TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'editor',
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      code TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER,
      status TEXT DEFAULT 'created'
    );

    CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON pairing_codes(expires_at);
    CREATE INDEX IF NOT EXISTS idx_devices_revoked ON devices(revoked);
  `);

  try {
    db.prepare('ALTER TABLE pairing_codes ADD COLUMN status TEXT DEFAULT "created"').run();
  } catch (e) {
    // ignore if exists
  }

  const ensure = (key, valueFactory) => {
    const row = db.prepare('SELECT value FROM server_meta WHERE key = ?').get(key);
    if (row?.value) return row.value;
    const v = valueFactory();
    db.prepare('INSERT INTO server_meta(key,value) VALUES(?,?)').run(key, v);
    return v;
  };

  ensure('server_secret', () => cryptoRandomTokenHex(32));
  ensure('owner_token', () => cryptoRandomTokenHex(32));
}

export function getServerSecret(stateDb) {
  const row = stateDb.prepare('SELECT value FROM server_meta WHERE key = ?').get('server_secret');
  return row?.value;
}

export function getOwnerToken(stateDb) {
  const row = stateDb.prepare('SELECT value FROM server_meta WHERE key = ?').get('owner_token');
  return row?.value;
}

export function createPairingCode(stateDb, { ttlMs = 120_000, nowMs = Date.now() } = {}) {
  const code = cryptoRandomTokenHex(16);
  const expiresAt = nowMs + ttlMs;
  stateDb.prepare('INSERT INTO pairing_codes(code, created_at, expires_at, consumed_at) VALUES(?,?,?,NULL)')
    .run(code, nowMs, expiresAt);
  return { code, expires_at_ms: expiresAt };
}

export function updatePairingCodeStatus(stateDb, code, status, { nowMs = Date.now() } = {}) {
  const c = String(code || '').trim();
  if (!c) return { ok: false, error: 'code_required' };
  
  if (status === 'consumed') {
     const res = stateDb.prepare('UPDATE pairing_codes SET consumed_at = ?, status = ? WHERE code = ?').run(nowMs, status, c);
     if (res.changes === 0) return { ok: false, error: 'invalid_code' };
     return { ok: true };
  }
  
  const res = stateDb.prepare('UPDATE pairing_codes SET status = ? WHERE code = ?').run(status, c);
  if (res.changes === 0) return { ok: false, error: 'invalid_code' };
  return { ok: true };
}

export function validatePairingCode(stateDb, code, { nowMs = Date.now() } = {}) {
  const c = String(code || '').trim();
  if (!c) return { ok: false, error: 'code_required' };

  const row = stateDb.prepare('SELECT code, expires_at, consumed_at, status FROM pairing_codes WHERE code = ?').get(c);
  if (!row) return { ok: false, error: 'invalid_code' };
  if (row.consumed_at || row.status === 'consumed') return { ok: false, error: 'already_used' };
  if (Number(row.expires_at) < nowMs) return { ok: false, error: 'expired' };

  return { ok: true, row };
}

export function consumePairingCode(stateDb, code, { nowMs = Date.now() } = {}) {
  const val = validatePairingCode(stateDb, code, { nowMs });
  if (!val.ok) return { ok: false, error: val.error };
  return updatePairingCodeStatus(stateDb, code, 'consumed', { nowMs });
}

export function getPairingCodeStatus(stateDb, code, { nowMs = Date.now() } = {}) {
  const c = String(code || '').trim();
  if (!c) return { ok: false, error: 'code_required' };

  const row = stateDb.prepare('SELECT code, expires_at, consumed_at, status FROM pairing_codes WHERE code = ?').get(c);
  if (!row) return { ok: false, error: 'invalid_code' };

  if (row.consumed_at) return {
    ok: true,
    status: 'consumed',
    status_detail: row.status,
    expires_at_ms: Number(row.expires_at),
    consumed_at_ms: Number(row.consumed_at)
  };
  if (Number(row.expires_at) < nowMs) return { ok: true, status: 'expired', status_detail: row.status, expires_at_ms: Number(row.expires_at) };

  return { ok: true, status: 'pending', status_detail: row.status, expires_at_ms: Number(row.expires_at) };
}


export function upsertDevice(stateDb, { device_id, pubkey, name, role = 'editor', nowMs = Date.now() }) {
  const did = String(device_id || '').trim();
  if (!did) throw new Error('device_id_required');

  const existing = stateDb.prepare('SELECT device_id, revoked, role FROM devices WHERE device_id = ?').get(did);
  if (!existing) {
    stateDb.prepare(
      'INSERT INTO devices(device_id, pubkey, name, role, revoked, created_at, last_seen_at) VALUES(?,?,?,?,0,?,?)'
    ).run(did, pubkey ?? null, name ?? null, role ?? 'editor', nowMs, nowMs);
    return { device_id: did, role: role ?? 'editor', revoked: 0 };
  }

  if (existing.revoked) {
    // Keep revoked devices revoked; allow metadata update only.
    stateDb.prepare('UPDATE devices SET pubkey = ?, name = ?, last_seen_at = ? WHERE device_id = ?')
      .run(pubkey ?? null, name ?? null, nowMs, did);
    return { device_id: did, role: existing.role, revoked: 1 };
  }

  stateDb.prepare('UPDATE devices SET pubkey = ?, name = ?, last_seen_at = ? WHERE device_id = ?')
    .run(pubkey ?? null, name ?? null, nowMs, did);

  return { device_id: did, role: existing.role, revoked: 0 };
}

export function getDevice(stateDb, deviceId) {
  const did = String(deviceId || '').trim();
  if (!did) return null;
  return stateDb.prepare('SELECT device_id, role, revoked FROM devices WHERE device_id = ?').get(did) || null;
}

export function listDevices(stateDb) {
  return stateDb
    .prepare('SELECT device_id, name, role, revoked, created_at, last_seen_at FROM devices ORDER BY created_at DESC')
    .all();
}

export function setDeviceRevoked(stateDb, deviceId, revoked) {
  const did = String(deviceId || '').trim();
  if (!did) throw new Error('device_id_required');
  stateDb.prepare('UPDATE devices SET revoked = ? WHERE device_id = ?').run(revoked ? 1 : 0, did);
}
