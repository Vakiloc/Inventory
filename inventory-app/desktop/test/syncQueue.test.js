import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSyncQueue } from '../src/renderer/syncQueue.js';

// Mock localStorage
const store = {};
const mockLocalStorage = {
  getItem: (key) => store[key] ?? null,
  setItem: (key, val) => { store[key] = val; },
  removeItem: (key) => { delete store[key]; }
};
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage });

// Mock crypto.randomUUID if not already defined
if (!globalThis.crypto?.randomUUID) {
  try {
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => `test-${Date.now()}-${Math.random()}` },
      configurable: true
    });
  } catch {
    // crypto may already exist with randomUUID in jsdom
  }
}

function createMockApi() {
  return {
    calls: [],
    failNext: false,
    fetchJson(path, options) {
      this.calls.push({ path, options });
      if (this.failNext) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ ok: true, results: [] });
    }
  };
}

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('createSyncQueue', () => {
  it('starts with zero pending count', () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('enqueue increases pending count', () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e1', barcode: 'BC-1', delta: 1 } });
    expect(queue.getPendingCount()).toBe(1);
    queue.destroy();
  });

  it('persists queue to localStorage', () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e2', barcode: 'BC-2', delta: 1 } });
    const stored = JSON.parse(store['inventory_sync_queue']);
    expect(stored.length).toBe(1);
    expect(stored[0].payload.barcode).toBe('BC-2');
    queue.destroy();
  });

  it('flush sends scan events via /api/scans', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e3', barcode: 'BC-3', delta: 1 } });
    await queue.flush();
    expect(api.calls.length).toBe(1);
    expect(api.calls[0].path).toBe('/api/scans');
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('keeps items in queue on failure', async () => {
    const api = createMockApi();
    api.failNext = true;
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e4', barcode: 'BC-4', delta: 1 } });
    await queue.flush();
    expect(queue.getPendingCount()).toBe(1);
    queue.destroy();
  });

  it('clear empties the queue', () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e5', barcode: 'BC-5', delta: 1 } });
    queue.clear();
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('calls onStatusChange callback', () => {
    const api = createMockApi();
    const counts = [];
    const queue = createSyncQueue({ api, onStatusChange: (n) => counts.push(n) });
    queue.enqueue({ type: 'scan', payload: { event_id: 'e6', barcode: 'BC-6', delta: 1 } });
    expect(counts).toContain(1);
    queue.clear();
    expect(counts).toContain(0);
    queue.destroy();
  });

  it('flush handles item_create operations', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'item_create', payload: { name: 'Test Item', quantity: 1 } });
    await queue.flush();
    expect(api.calls.length).toBe(1);
    expect(api.calls[0].path).toBe('/api/items');
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('flush handles item_update operations', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'item_update', payload: { item_id: 42, data: { name: 'Updated' } } });
    await queue.flush();
    expect(api.calls.length).toBe(1);
    expect(api.calls[0].path).toBe('/api/items/42');
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('flush handles item_delete operations', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'item_delete', payload: { item_id: 99 } });
    await queue.flush();
    expect(api.calls.length).toBe(1);
    expect(api.calls[0].path).toBe('/api/items/99');
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('flush handles mixed operation types (scans batched, others individual)', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'scan', payload: { event_id: 'mix-1', barcode: 'BC-1', delta: 1 } });
    queue.enqueue({ type: 'scan', payload: { event_id: 'mix-2', barcode: 'BC-2', delta: 1 } });
    queue.enqueue({ type: 'item_create', payload: { name: 'New', quantity: 1 } });
    queue.enqueue({ type: 'item_update', payload: { item_id: 10, data: { name: 'Upd' } } });
    await queue.flush();
    // Scans batched into 1 call + 2 individual ops = 3 calls
    expect(api.calls.length).toBe(3);
    expect(api.calls[0].path).toBe('/api/scans');
    expect(api.calls[1].path).toBe('/api/items');
    expect(api.calls[2].path).toBe('/api/items/10');
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('queue restores from localStorage on creation', () => {
    const api = createMockApi();
    const q1 = createSyncQueue({ api });
    q1.enqueue({ type: 'scan', payload: { event_id: 'persist-1', barcode: 'BC-P', delta: 1 } });
    q1.enqueue({ type: 'item_create', payload: { name: 'Saved', quantity: 1 } });
    expect(q1.getPendingCount()).toBe(2);
    q1.destroy();

    // New queue should restore from localStorage
    const q2 = createSyncQueue({ api });
    expect(q2.getPendingCount()).toBe(2);
    q2.destroy();
  });

  it('multiple enqueues accumulate correctly', () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    for (let i = 0; i < 5; i++) {
      queue.enqueue({ type: 'scan', payload: { event_id: `acc-${i}`, barcode: `BC-${i}`, delta: 1 } });
    }
    expect(queue.getPendingCount()).toBe(5);
    queue.destroy();
  });

  it('flush with no pending items is a no-op', async () => {
    const api = createMockApi();
    const queue = createSyncQueue({ api });
    await queue.flush();
    expect(api.calls.length).toBe(0);
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });

  it('onStatusChange fires with 0 after successful flush', async () => {
    const api = createMockApi();
    const counts = [];
    const queue = createSyncQueue({ api, onStatusChange: (n) => counts.push(n) });
    queue.enqueue({ type: 'scan', payload: { event_id: 'cb-1', barcode: 'BC-CB', delta: 1 } });
    await queue.flush();
    // Should have received: 1 (after enqueue), then 0 (after flush)
    expect(counts).toContain(1);
    expect(counts).toContain(0);
    queue.destroy();
  });

  it('failed flush retains items for retry', async () => {
    const api = createMockApi();
    api.failNext = true;
    const queue = createSyncQueue({ api });
    queue.enqueue({ type: 'item_create', payload: { name: 'Retry Me', quantity: 1 } });
    await queue.flush();
    expect(queue.getPendingCount()).toBe(1);

    // Now succeed
    api.failNext = false;
    await queue.flush();
    expect(queue.getPendingCount()).toBe(0);
    queue.destroy();
  });
});
