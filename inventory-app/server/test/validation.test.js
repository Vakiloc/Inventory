import { describe, expect, it } from 'vitest';

import {
  ScanEventSchema,
  ScanEventsApplySchema,
  ItemUpsertSchema,
  CategorySchema,
  LocationSchema
} from '../src/validation.js';

describe('validation schemas', () => {
  // ── ItemUpsertSchema ────────────────────────────────────────────────

  it('rejects empty item name', () => {
    const res = ItemUpsertSchema.safeParse({ name: '' });
    expect(res.success).toBe(false);
  });

  it('rejects item name exceeding max length', () => {
    const res = ItemUpsertSchema.safeParse({ name: 'x'.repeat(501) });
    expect(res.success).toBe(false);
  });

  it('accepts item name at max length (500)', () => {
    const res = ItemUpsertSchema.safeParse({ name: 'x'.repeat(500) });
    expect(res.success).toBe(true);
  });

  it('rejects quantity exceeding max', () => {
    const res = ItemUpsertSchema.safeParse({ name: 'Test', quantity: 1_000_000 });
    expect(res.success).toBe(false);
  });

  it('accepts quantity at max boundary (999999)', () => {
    const res = ItemUpsertSchema.safeParse({ name: 'Test', quantity: 999_999 });
    expect(res.success).toBe(true);
    expect(res.data.quantity).toBe(999_999);
  });

  it('rejects negative quantity', () => {
    const res = ItemUpsertSchema.safeParse({ name: 'Test', quantity: -1 });
    expect(res.success).toBe(false);
  });

  // ── ScanEventSchema ─────────────────────────────────────────────────

  it('rejects out-of-range scan delta', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: 1000, event_id: 'e1' });
    expect(res.success).toBe(false);
  });

  it('allows negative scan delta (decrement)', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: -1, event_id: 'e1' });
    expect(res.success).toBe(true);
  });

  it('rejects zero scan delta', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: 0, event_id: 'e1' });
    expect(res.success).toBe(false);
  });

  it('requires event_id on ScanEventSchema', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: 1 });
    expect(res.success).toBe(false);
  });

  it('rejects barcode exceeding max length', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'x'.repeat(129), delta: 1, event_id: 'e1' });
    expect(res.success).toBe(false);
  });

  it('accepts delta at positive boundary (+100)', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: 100, event_id: 'e1' });
    expect(res.success).toBe(true);
  });

  it('rejects delta just beyond positive boundary (+101)', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: 101, event_id: 'e1' });
    expect(res.success).toBe(false);
  });

  it('accepts delta at negative boundary (-100)', () => {
    const res = ScanEventSchema.safeParse({ barcode: 'X', delta: -100, event_id: 'e1' });
    expect(res.success).toBe(true);
  });

  // ── ScanEventsApplySchema ───────────────────────────────────────────

  it('ScanEventsApplySchema rejects more than 500 events', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      event_id: `e-${i}`,
      barcode: 'X',
      delta: 1
    }));
    const res = ScanEventsApplySchema.safeParse({ events });
    expect(res.success).toBe(false);
  });

  it('ScanEventsApplySchema accepts empty events array', () => {
    const res = ScanEventsApplySchema.safeParse({ events: [] });
    expect(res.success).toBe(true);
  });

  // ── CategorySchema ──────────────────────────────────────────────────

  it('CategorySchema rejects empty name', () => {
    const res = CategorySchema.safeParse({ name: '' });
    expect(res.success).toBe(false);
  });

  it('CategorySchema rejects name exceeding 200 chars', () => {
    const res = CategorySchema.safeParse({ name: 'x'.repeat(201) });
    expect(res.success).toBe(false);
  });

  it('CategorySchema accepts valid name', () => {
    const res = CategorySchema.safeParse({ name: 'Kitchen' });
    expect(res.success).toBe(true);
    expect(res.data.name).toBe('Kitchen');
  });

  // ── LocationSchema ──────────────────────────────────────────────────

  it('LocationSchema rejects empty name', () => {
    const res = LocationSchema.safeParse({ name: '' });
    expect(res.success).toBe(false);
  });

  it('LocationSchema accepts name with null parent_id', () => {
    const res = LocationSchema.safeParse({ name: 'Room', parent_id: null });
    expect(res.success).toBe(true);
  });

  it('LocationSchema accepts name with integer parent_id', () => {
    const res = LocationSchema.safeParse({ name: 'Shelf', parent_id: 1 });
    expect(res.success).toBe(true);
    expect(res.data.parent_id).toBe(1);
  });
});
