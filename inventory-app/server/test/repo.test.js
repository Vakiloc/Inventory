import { afterEach, describe, expect, it } from 'vitest';

import { createTestContext } from './testDb.js';
import {
  attachBarcodeToItem,
  createItem,
  updateItem,
  softDeleteItem,
  getItem,
  getItemByBarcodeExact,
  getItemsByBarcodeExact,
  listItems,
  incrementItemQuantity,
  applyScanEventByBarcode,
  createCategory,
  createLocation
} from '../src/repo.js';

let ctx;
afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
});

describe('repo helpers', () => {
  it('finds item by alternate barcode', () => {
    ctx = createTestContext();

    const item = createItem(ctx.db, { name: 'Camera', barcode: 'PRIMARY-1', quantity: 1 });
    const attached = attachBarcodeToItem(ctx.db, item.item_id, 'ALT-1');
    expect(attached.ok).toBe(true);

    const found = getItemByBarcodeExact(ctx.db, 'ALT-1');
    expect(found).not.toBeNull();
    expect(found.item_id).toBe(item.item_id);
  });

  it('createItem returns item with auto-set fields', () => {
    ctx = createTestContext();

    const before = Date.now();
    const item = createItem(ctx.db, { name: 'Auto Fields' });
    expect(item.name).toBe('Auto Fields');
    expect(item.quantity).toBe(1);
    expect(item.deleted).toBe(0);
    expect(item.last_modified).toBeGreaterThanOrEqual(before);
    expect(item.barcode).toBeNull();
    expect(item.category_id).toBeNull();
  });

  it('listItems returns all non-deleted items', () => {
    ctx = createTestContext();

    createItem(ctx.db, { name: 'Keep A', quantity: 1 });
    createItem(ctx.db, { name: 'Keep B', quantity: 1 });
    const toDelete = createItem(ctx.db, { name: 'Remove', quantity: 1 });
    softDeleteItem(ctx.db, toDelete.item_id);

    const items = listItems(ctx.db, {});
    expect(items.length).toBe(2);
    expect(items.every(i => i.deleted === 0)).toBe(true);
  });

  it('listItems filters by search query (name)', () => {
    ctx = createTestContext();

    createItem(ctx.db, { name: 'Red Widget', quantity: 1 });
    createItem(ctx.db, { name: 'Blue Gadget', quantity: 1 });

    const items = listItems(ctx.db, { q: 'Widget' });
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('Red Widget');
  });

  it('listItems filters by categoryId', () => {
    ctx = createTestContext();

    const cat = createCategory(ctx.db, { name: 'Tools' });
    createItem(ctx.db, { name: 'In Cat', quantity: 1, category_id: cat.category_id });
    createItem(ctx.db, { name: 'No Cat', quantity: 1 });

    const items = listItems(ctx.db, { categoryId: cat.category_id });
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('In Cat');
  });

  it('listItems with since parameter returns only updated items', () => {
    ctx = createTestContext();

    const old = createItem(ctx.db, { name: 'Old', quantity: 1 });
    const cutoff = old.last_modified;

    // Force a later timestamp
    const newer = createItem(ctx.db, { name: 'New', quantity: 1, last_modified: cutoff + 10_000 });

    const items = listItems(ctx.db, { since: cutoff });
    expect(items.length).toBe(1);
    expect(items[0].item_id).toBe(newer.item_id);
  });

  it('updateItem merges patch with existing', () => {
    ctx = createTestContext();

    const item = createItem(ctx.db, { name: 'Original', quantity: 3, barcode: 'BC-1' });
    const updated = updateItem(ctx.db, item.item_id, { quantity: 7 });
    expect(updated.quantity).toBe(7);
    expect(updated.name).toBe('Original');
    expect(updated.barcode).toBe('BC-1');
  });

  it('softDeleteItem sets deleted=1 and bumps last_modified', () => {
    ctx = createTestContext();

    const item = createItem(ctx.db, { name: 'ToDelete', quantity: 1 });
    const originalLm = item.last_modified;

    const deleted = softDeleteItem(ctx.db, item.item_id);
    expect(deleted.deleted).toBe(1);
    expect(deleted.last_modified).toBeGreaterThanOrEqual(originalLm);
  });

  it('getItemsByBarcodeExact returns multiple matches', () => {
    ctx = createTestContext();

    createItem(ctx.db, { name: 'Item X', quantity: 1, barcode: 'SHARED' });
    createItem(ctx.db, { name: 'Item Y', quantity: 1, barcode: 'SHARED' });

    const items = getItemsByBarcodeExact(ctx.db, 'SHARED');
    expect(items.length).toBe(2);
  });

  it('incrementItemQuantity clamps at zero', () => {
    ctx = createTestContext();

    const item = createItem(ctx.db, { name: 'Clamp Test', quantity: 2 });
    const result = incrementItemQuantity(ctx.db, item.item_id, -10);
    expect(result.quantity).toBe(0);
  });

  it('incrementItemQuantity returns null for deleted item', () => {
    ctx = createTestContext();

    const item = createItem(ctx.db, { name: 'Gone', quantity: 5 });
    softDeleteItem(ctx.db, item.item_id);

    const result = incrementItemQuantity(ctx.db, item.item_id, 1);
    expect(result).toBeNull();
  });

  it('applyScanEventByBarcode returns applied for single match', () => {
    ctx = createTestContext();

    createItem(ctx.db, { name: 'Scannable', quantity: 1, barcode: 'SCAN-1' });

    const result = applyScanEventByBarcode(ctx.db, {
      event_id: 'repo-e1',
      barcode: 'SCAN-1',
      delta: 2
    });
    expect(result.status).toBe('applied');
    expect(result.item.quantity).toBe(3);
  });

  it('applyScanEventByBarcode idempotent on replay', () => {
    ctx = createTestContext();

    createItem(ctx.db, { name: 'Replay', quantity: 1, barcode: 'REPLAY-1' });

    const first = applyScanEventByBarcode(ctx.db, {
      event_id: 'repo-replay',
      barcode: 'REPLAY-1',
      delta: 1
    });
    expect(first.status).toBe('applied');
    expect(first.item.quantity).toBe(2);

    const second = applyScanEventByBarcode(ctx.db, {
      event_id: 'repo-replay',
      barcode: 'REPLAY-1',
      delta: 1
    });
    expect(second.status).toBe('duplicate');
    expect(second.item.quantity).toBe(2);
  });
});
