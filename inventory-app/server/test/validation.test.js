import { describe, expect, it } from 'vitest';

import { BarcodeScanSchema, ItemUpsertSchema } from '../src/validation.js';

describe('validation schemas', () => {
  it('rejects empty item name', () => {
    const res = ItemUpsertSchema.safeParse({ name: '' });
    expect(res.success).toBe(false);
  });

  it('rejects out-of-range scan delta', () => {
    const res = BarcodeScanSchema.safeParse({ barcode: 'X', delta: 1000 });
    expect(res.success).toBe(false);
  });

  it('allows negative scan delta (decrement)', () => {
    const res = BarcodeScanSchema.safeParse({ barcode: 'X', delta: -1 });
    expect(res.success).toBe(true);
  });

  it('rejects zero scan delta', () => {
    const res = BarcodeScanSchema.safeParse({ barcode: 'X', delta: 0 });
    expect(res.success).toBe(false);
  });
});
