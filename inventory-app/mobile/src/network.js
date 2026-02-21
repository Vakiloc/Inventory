/**
 * Network status detection and background sync scheduler.
 *
 * Uses @capacitor/network when running natively, falls back to
 * navigator.onLine + window events in the browser.
 */

import { syncOnce } from './sync.js';
import * as store from './storage.js';

let _online = navigator.onLine;
let _listeners = [];
let _syncTimer = null;

const SYNC_INTERVAL_MS = 60_000; // 60 seconds

// --- Public API ---

/** Current network status. */
export function isOnline() {
  return _online;
}

/**
 * Register a callback for network status changes.
 * Callback receives { connected: boolean }.
 */
export function onStatusChange(fn) {
  _listeners.push(fn);
  return () => {
    _listeners = _listeners.filter(f => f !== fn);
  };
}

/** Initialize network monitoring and background sync. */
export async function initNetwork() {
  // Try Capacitor Network plugin (native)
  try {
    const { Network } = await import('@capacitor/network');

    const status = await Network.getStatus();
    _online = status.connected;

    Network.addListener('networkStatusChange', (s) => {
      const prev = _online;
      _online = s.connected;
      if (prev !== _online) {
        _notify();
        // Sync immediately when coming back online
        if (_online && store.isPaired()) {
          syncOnce().catch(() => {});
        }
      }
    });
  } catch {
    // Fallback: browser events
    window.addEventListener('online', () => {
      _online = true;
      _notify();
      if (store.isPaired()) syncOnce().catch(() => {});
    });
    window.addEventListener('offline', () => {
      _online = false;
      _notify();
    });
  }

  startPeriodicSync();
}

/** Start periodic background sync (every 60s). */
export function startPeriodicSync() {
  if (_syncTimer) return;
  _syncTimer = setInterval(async () => {
    if (!store.isPaired() || !_online) return;
    try { await syncOnce(); } catch { /* retry next cycle */ }
  }, SYNC_INTERVAL_MS);
}

/** Stop periodic sync. */
export function stopPeriodicSync() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
}

// --- Internal ---

function _notify() {
  for (const fn of _listeners) {
    try { fn({ connected: _online }); } catch { /* ignore */ }
  }
}
