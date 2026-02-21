/**
 * Sync engine — mirrors Android's InventoryRepository.syncOnce().
 *
 * Sync order:
 * 1. Bootstrap (if first sync) — GET /api/export
 * 2. Push pending item creates — POST /api/items
 * 3. Push pending item updates — PUT /api/items/:id
 * 4. Push pending scan events — POST /api/scans/apply
 * 5. Pull incremental items — GET /api/items?since=X
 * 6. Refresh categories & locations
 */

import { api } from './api.js';
import * as store from './storage.js';

function newEventId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* ignore */ }
  return `e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function syncOnce() {
  const prefs = store.getPrefs();
  if (!prefs.baseUrl || !prefs.token) return { skipped: true };

  const result = { bootstrapped: false, itemsPulled: 0, scansApplied: 0 };

  // 1. Bootstrap if needed
  if (!prefs.bootstrapped) {
    const snapshot = await api.fetchJson('/api/export');
    store.setCategories(snapshot.categories || []);
    store.setLocations(snapshot.locations || []);
    store.setItems(snapshot.items || []);

    const maxMod = Math.max(0, ...(snapshot.items || []).map(i => i.last_modified || 0));
    store.setPrefs({ bootstrapped: true, itemsSinceMs: maxMod });
    result.bootstrapped = true;
    return result;
  }

  // 2. Push pending item creates
  const creates = store.getPendingCreates();
  const remainingCreates = [];
  for (const pending of creates) {
    try {
      const res = await api.fetchJson('/api/items', {
        method: 'POST',
        body: JSON.stringify(pending.data)
      });
      // Upsert real item
      if (res.item) store.upsertItems([res.item]);
    } catch {
      remainingCreates.push(pending);
    }
  }
  store.setPendingCreates(remainingCreates);

  // 3. Push pending item updates
  const updates = store.getPendingUpdates();
  const remainingUpdates = [];
  for (const pending of updates) {
    try {
      await api.fetchJson(`/api/items/${pending.item_id}`, {
        method: 'PUT',
        body: JSON.stringify(pending.data)
      });
    } catch (err) {
      if (err.status === 409) {
        pending.state = 'conflict';
      }
      remainingUpdates.push(pending);
    }
  }
  store.setPendingUpdates(remainingUpdates);

  // 4. Push pending scan events
  const scans = store.getPendingScans();
  if (scans.length > 0) {
    try {
      const events = scans.map(s => ({
        event_id: s.event_id,
        barcode: s.barcode,
        delta: s.delta,
        item_id: s.item_id,
        scanned_at: s.scanned_at
      }));
      const scanRes = await api.fetchJson('/api/scans/apply', {
        method: 'POST',
        body: JSON.stringify({ events })
      });

      const remaining = [];
      for (let i = 0; i < scans.length; i++) {
        const r = scanRes.results?.[i];
        if (r && (r.status === 'applied' || r.status === 'duplicate')) {
          result.scansApplied++;
          if (r.item) store.upsertItems([r.item]);
        } else {
          remaining.push(scans[i]);
        }
      }
      store.setPendingScans(remaining);
    } catch {
      // Keep all scans for retry
    }
  }

  // 5. Pull incremental items
  const since = store.getPrefs().itemsSinceMs || 0;
  try {
    const itemsRes = await api.fetchJson(`/api/items?since=${since}&includeDeleted=1`);
    const items = itemsRes.items || [];
    if (items.length > 0) {
      store.upsertItems(items);
      result.itemsPulled = items.length;
      const maxMod = Math.max(since, ...items.map(i => i.last_modified || 0));
      store.setPrefs({ itemsSinceMs: maxMod });
    }
  } catch { /* retry next sync */ }

  // 6. Refresh categories & locations
  try {
    const [catsRes, locsRes] = await Promise.all([
      api.fetchJson('/api/categories'),
      api.fetchJson('/api/locations')
    ]);
    store.setCategories(catsRes.categories || []);
    store.setLocations(locsRes.locations || []);
  } catch { /* retry next sync */ }

  store.setPrefs({ lastSyncMs: Date.now() });
  return result;
}

/**
 * Queue a barcode scan event for offline-first processing.
 */
export function queueScan(barcode, delta = 1, itemId = null) {
  const event = {
    event_id: newEventId(),
    barcode,
    delta,
    item_id: itemId,
    scanned_at: Date.now(),
    state: 'pending'
  };
  store.addPendingScan(event);
  return event;
}

/**
 * Queue a new item for offline creation.
 */
export function queueItemCreate(data) {
  const pending = {
    client_id: newEventId(),
    temp_item_id: -(Date.now() % 1000000),
    data: { ...data, last_modified: Date.now() },
    state: 'pending',
    created_at: Date.now()
  };
  store.addPendingCreate(pending);

  // Also add to local items cache with temp ID
  const localItem = { item_id: pending.temp_item_id, ...data, last_modified: Date.now() };
  store.upsertItems([localItem]);
  return localItem;
}
