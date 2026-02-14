import crypto from 'node:crypto';

import { errorKeyForCode, t as tI18n } from './i18n/index.js';

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

function hmacSha256Hex(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(String(message)).digest('hex');
}

// Auth supports:
/**
 * Authentication Strategy:
 * - Owner token: Validates against `server-state.sqlite` (server_meta.owner_token). Grants full 'owner' role.
 * - Device token: Validates against `server-state.sqlite` (devices table). Grants 'editor' or 'viewer' role.
 *   Format: d1.<device_id>.<mac> where mac=HMAC(server_secret, device_id)
 */
export function installSecurityMiddleware(app) {
  app.use((req, res, next) => {
    // Basic CORS (can be stricter if needed, but local apps are often loose)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Inventory-Id');
    
    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    
    // HSTS (Max Age: 1 year)
    // Only strictly enforced on HTTPS, but good practice to send.
    // Chrome might ignore it on local IPs, but it matters for sslip.io.
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
}

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

export function sendOk(res, body, status = 200) {
  return res.status(status).json(body);
}

export function sendError(res, status, error, details) {
  const errorString = String(error || 'error');
  const payload = { error: errorString };

  const locale = String(res?.locals?.locale || 'en');
  const hasCodeLikeError = /^[a-z0-9_]+$/i.test(errorString);
  const messageKey = hasCodeLikeError ? errorKeyForCode(errorString) : 'errors.unknown';

  let message = tI18n(locale, messageKey);
  if (message === messageKey) {
    message = tI18n(locale, 'errors.unknown');
  }

  payload.message_key = messageKey;
  payload.message = message;

  // Provide a machine-readable error code for callers that want it.
  // Keep `error` as the backward-compatible primary field.
  if (hasCodeLikeError) payload.code = errorString;
  if (details !== undefined) payload.details = details;
  return res.status(status).json(payload);
}

export function sendValidationFailed(res, flattenedZodError) {
  const locale = String(res?.locals?.locale || 'en');
  const messageKey = errorKeyForCode('validation_failed');
  return res.status(400).json({
    code: 'validation_failed',
    error: flattenedZodError,
    message_key: messageKey,
    message: tI18n(locale, messageKey)
  });
}

export function parseIntParam(req, res, name, { min = 1 } = {}) {
  const raw = req.params?.[name];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    sendError(res, 400, 'invalid_id', { param: name });
    return null;
  }
  return value;
}

export function parseJsonBody(schema, req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    sendValidationFailed(res, parsed.error.flatten());
    return null;
  }
  return parsed.data;
}

export function wrapRoute(handler) {
  return function wrapped(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export function installJsonErrorHandler(app) {
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const details = isProd ? undefined : String(err?.message || err);

    // eslint-disable-next-line no-console
    console.error('Unhandled error', err);
    sendError(res, 500, 'internal_error', details ? { message: details } : undefined);
  });
}
