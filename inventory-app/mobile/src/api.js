/**
 * REST API client for the Inventory server.
 * Adapted from desktop/src/renderer/apiClient.js — uses fetch() directly.
 */

import { getPrefs } from './storage.js';

export function createApiClient() {
  return {
    async fetchJson(path, options = {}) {
      const prefs = getPrefs();
      const baseUrl = prefs.baseUrl;
      if (!baseUrl) throw new Error('Not paired — no server URL');

      const headers = new Headers(options.headers || {});
      if (prefs.token) headers.set('Authorization', `Bearer ${prefs.token}`);
      if (prefs.inventoryId) headers.set('X-Inventory-Id', prefs.inventoryId);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept-Language', prefs.locale || 'en');

      const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = new Error(body.message || body.error || res.statusText);
        err.status = res.status;
        err.body = body;
        throw err;
      }

      return body;
    }
  };
}

// Singleton API client
export const api = createApiClient();
