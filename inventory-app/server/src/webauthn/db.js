import { openDb } from '../db.js';

let _db = null;
function getDb() {
  if (!_db) {
    _db = openDb().db;
  }
  return _db;
}

export function saveChallenge({ challenge, type, userId = null, expiresAt }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO challenge_transactions (type, challenge, user_id, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(type, challenge, userId, expiresAt);
}

export function getChallenge(challenge) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM challenge_transactions 
    WHERE challenge = ? AND used_at IS NULL
  `).get(challenge);
}

export function getChallengeByType(type, userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM challenge_transactions 
    WHERE type = ? AND user_id = ? AND used_at IS NULL
    ORDER BY issued_at DESC
    LIMIT 1
  `).get(type, userId);
}

export function markChallengeUsed(txId) {
  const db = getDb();
  db.prepare(`
    UPDATE challenge_transactions 
    SET used_at = strftime('%s','now') 
    WHERE tx_id = ?
  `).run(txId);
}

export function saveCredential({ credentialId, userId, publicKey, signCount, aaguid, transports, friendlyName }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO webauthn_credentials (credential_id, user_id, public_key, sign_count, aaguid, transports, friendly_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(credentialId, userId, publicKey, signCount, aaguid, transports, friendlyName);
}

export function getCredentialsByUser(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM webauthn_credentials WHERE user_id = ? AND revoked_at IS NULL
  `).all(userId);
}

export function getCredentialById(credentialId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM webauthn_credentials WHERE credential_id = ?
  `).get(credentialId);
}

export function updateCredentialCounter(credentialId, newCounter) {
  const db = getDb();
  db.prepare(`
    UPDATE webauthn_credentials 
    SET sign_count = ?, last_used_at = strftime('%s','now')
    WHERE credential_id = ?
  `).run(newCounter, credentialId);
}
