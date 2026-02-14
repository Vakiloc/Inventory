import crypto from 'node:crypto';

import { sendError } from '../http.js';

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function roleRank(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'owner' || r === 'admin') return 3;
  if (r === 'editor' || r === 'collaborator') return 2;
  if (r === 'viewer' || r === 'read_only' || r === 'readonly') return 1;
  return 0;
}

export function hmacSha256Hex(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(String(message)).digest('hex');
}

/**
 * Authentication Strategy:
 * - Owner token: Validates against `server-state.sqlite` (server_meta.owner_token). Grants full 'owner' role.
 * - Device token: Validates against `server-state.sqlite` (devices table). Grants 'editor' or 'viewer' role.
 *   Format: d1.<device_id>.<mac> where mac=HMAC(server_secret, device_id)
 */
export function createAuthMiddleware({ ownerToken, serverSecret, stateDb }) {
  if (!ownerToken) throw new Error('createAuthMiddleware: ownerToken is required');
  if (!serverSecret) throw new Error('createAuthMiddleware: serverSecret is required');
  if (!stateDb) throw new Error('createAuthMiddleware: stateDb is required');

  return function requireAuth(req, res, next) {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
    if (!token) return sendError(res, 401, 'unauthorized');

    // Owner tokens
    if (safeEqual(token, ownerToken)) {
      req.auth = { role: 'owner', tokenType: 'owner' };
      return next();
    }

    // Device tokens
    if (token.startsWith('d1.')) {
      const parts = token.split('.');
      if (parts.length === 3) {
        const deviceId = parts[1];
        const mac = parts[2];
        const expected = hmacSha256Hex(serverSecret, deviceId);
        if (!safeEqual(mac, expected)) return sendError(res, 401, 'unauthorized');

        const device = stateDb
          .prepare('SELECT device_id, role, revoked FROM devices WHERE device_id = ?')
          .get(deviceId);

        if (!device || device.revoked) return sendError(res, 401, 'unauthorized');

        req.auth = { role: device.role || 'editor', device_id: device.device_id, tokenType: 'device' };
        return next();
      }
    }

    return sendError(res, 401, 'unauthorized');
  };
}

export function requireRole(minRole) {
  const min = roleRank(minRole);
  if (min <= 0) throw new Error('requireRole: invalid minRole');
  return function requireRoleMw(req, res, next) {
    const r = roleRank(req?.auth?.role);
    if (r < min) return sendError(res, 403, 'forbidden');
    next();
  };
}
