import { getActiveLocale, t } from './i18n/index.js';

function getErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  if (typeof body?.error?.message === 'string' && body.error.message.trim()) return body.error.message;
  if (body.code === 'validation_failed' || body.error === 'validation_failed') return t('errors.validation_failed');
  if (typeof body.error === 'string' && body.error.trim()) return body.error;
  if (typeof body.message === 'string' && body.message.trim()) return body.message;
  return fallback;
}

export function createApiClient({ getBaseUrl, getToken }) {
  if (typeof getBaseUrl !== 'function') throw new Error('createApiClient: getBaseUrl must be a function');
  if (typeof getToken !== 'function') throw new Error('createApiClient: getToken must be a function');

  return {
    async fetchJson(path, options = {}) {
      const baseUrl = String(getBaseUrl() || '');
      if (!baseUrl) throw new Error('Server URL is not set');

      const headers = new Headers(options.headers || {});
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept-Language', getActiveLocale());

      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(getErrorMessage(body, res.statusText));
        err.status = res.status;
        err.body = body;
        throw err;
      }

      return body;
    }
  };
}
