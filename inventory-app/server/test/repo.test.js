import { afterEach, describe, expect, it } from 'vitest';

import { createTestContext } from './testDb.js';
import { attachBarcodeToItem, createItem, getItemByBarcodeExact } from '../src/repo.js';

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
});
