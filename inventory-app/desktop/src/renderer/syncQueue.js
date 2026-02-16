import { newEventId } from './utils.js';

const STORAGE_KEY = 'inventory_sync_queue';
const MAX_RETRIES = 10;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;

/**
 * Offline-first sync queue that persists pending operations to localStorage
 * and flushes them when the server is reachable.
 */
export function createSyncQueue({ api, onStatusChange }) {
  let queue = loadQueue();
  let flushing = false;
  let flushTimer = null;

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveQueue() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } catch {
      // localStorage full or unavailable
    }
    if (onStatusChange) onStatusChange(queue.length);
  }

  function enqueue(op) {
    queue.push({
      id: newEventId(),
      type: op.type,
      payload: op.payload,
      retries: 0,
      createdAt: Date.now()
    });
    saveQueue();
    scheduleFlush();
  }

  function scheduleFlush(delayMs = 100) {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, delayMs);
  }

  function backoffDelay(retries) {
    return Math.min(BASE_DELAY_MS * Math.pow(2, retries), MAX_DELAY_MS);
  }

  async function flush() {
    if (flushing || queue.length === 0) return;
    flushing = true;

    const remaining = [];
    // Group scan events to send as batch
    const pendingScans = [];
    const otherOps = [];

    for (const op of queue) {
      if (op.type === 'scan') {
        pendingScans.push(op);
      } else {
        otherOps.push(op);
      }
    }

    // Flush scan events as a batch
    if (pendingScans.length > 0) {
      try {
        const events = pendingScans.map(op => op.payload);
        await api.fetchJson('/api/scans', {
          method: 'POST',
          body: JSON.stringify({ events })
        });
        // All scans succeeded - don't re-add to remaining
      } catch {
        // Server unreachable or error - keep all scan ops
        for (const op of pendingScans) {
          op.retries = (op.retries || 0) + 1;
          if (op.retries < MAX_RETRIES) {
            remaining.push(op);
          }
          // Silently drop after MAX_RETRIES
        }
      }
    }

    // Flush other operations one by one
    for (const op of otherOps) {
      try {
        if (op.type === 'item_create') {
          await api.fetchJson('/api/items', {
            method: 'POST',
            body: JSON.stringify(op.payload)
          });
        } else if (op.type === 'item_update') {
          await api.fetchJson(`/api/items/${op.payload.item_id}`, {
            method: 'PUT',
            body: JSON.stringify(op.payload.data)
          });
        } else if (op.type === 'item_delete') {
          await api.fetchJson(`/api/items/${op.payload.item_id}`, {
            method: 'DELETE'
          });
        }
        // Success - don't re-add
      } catch {
        op.retries = (op.retries || 0) + 1;
        if (op.retries < MAX_RETRIES) {
          remaining.push(op);
        }
      }
    }

    queue = remaining;
    saveQueue();
    flushing = false;

    // If still items in queue, schedule another flush with backoff
    if (queue.length > 0) {
      const maxRetries = Math.max(...queue.map(op => op.retries || 0));
      scheduleFlush(backoffDelay(maxRetries));
    }
  }

  function getPendingCount() {
    return queue.length;
  }

  function clear() {
    queue = [];
    saveQueue();
  }

  function destroy() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  return {
    enqueue,
    flush,
    getPendingCount,
    clear,
    destroy
  };
}
