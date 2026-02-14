import { errorKeyForCode, t as tI18n } from './i18n/index.js';

// ── Re-exports from IdP module (backward compatibility) ────────────
// Auth middleware has moved to idp/auth.js. These re-exports ensure
// existing code that imports from http.js continues to work.
export { createAuthMiddleware, requireRole } from './idp/auth.js';

// ── Security Middleware ────────────────────────────────────────────
export function installSecurityMiddleware(app) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Inventory-Id');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
}

// ── Response Helpers ───────────────────────────────────────────────
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

// ── Request Parsing Helpers ────────────────────────────────────────
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

// ── Route Wrapper ──────────────────────────────────────────────────
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

// ── Error Handler ──────────────────────────────────────────────────
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
