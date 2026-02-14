import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestContext } from './testDb.js';

let ctx;
afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
});

describe('progress checks (data consistency + sync behaviors)', () => {
  it('can attach/list alternate barcodes and enforces uniqueness', async () => {
    ctx = createTestContext();

    const a = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Item A', quantity: 1, barcode: 'PRIMARY-A' });
    const itemA = a.body.item;

    const b = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Item B', quantity: 1, barcode: 'PRIMARY-B' });
    const itemB = b.body.item;

    const attach = await request(ctx.app)
      .post(`/api/items/${itemA.item_id}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'ALT-XYZ' });
    expect(attach.status).toBe(200);

    const list = await request(ctx.app)
      .get(`/api/items/${itemA.item_id}/barcodes`)
      .set(ctx.authHeader);
    expect(list.status).toBe(200);
    expect(list.body.barcodes.map(bc => bc.barcode)).toContain('ALT-XYZ');

    const conflict = await request(ctx.app)
      .post(`/api/items/${itemB.item_id}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'ALT-XYZ' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('barcode_in_use');
    expect(conflict.body.item_id).toBe(itemA.item_id);
  });

  it('export/import roundtrip works across fresh DBs (LWW merge)', async () => {
    const ctx1 = createTestContext();
    const ctx2 = createTestContext();

    try {
      const created = await request(ctx1.app)
        .post('/api/items')
        .set(ctx1.authHeader)
        .send({ name: 'Exported Item', quantity: 2, barcode: 'EXP-1' });
      expect(created.status).toBe(200);

      const exported = await request(ctx1.app).get('/api/export').set(ctx1.authHeader);
      expect(exported.status).toBe(200);
      expect(exported.body.schema).toBe(1);
      expect(Array.isArray(exported.body.items)).toBe(true);

      const imported = await request(ctx2.app)
        .post('/api/import')
        .set(ctx2.authHeader)
        .send(exported.body);
      expect(imported.status).toBe(200);
      expect(imported.body.ok).toBe(true);

      const list2 = await request(ctx2.app).get('/api/items?q=Exported').set(ctx2.authHeader);
      expect(list2.status).toBe(200);
      expect(list2.body.items.length).toBe(1);
      expect(list2.body.items[0].barcode).toBe('EXP-1');

      const log2 = await request(ctx2.app).get('/api/sync-log?limit=5').set(ctx2.authHeader);
      expect(log2.status).toBe(200);
      expect(log2.body.log.some(e => e.source === 'import')).toBe(true);
    } finally {
      ctx1.cleanup();
      ctx2.cleanup();
    }
  });

  it('GET /api/items supports since + includeDeleted for incremental sync', async () => {
    ctx = createTestContext();

    const created = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Incremental', quantity: 1 });
    const item = created.body.item;

    const got = await request(ctx.app)
      .get(`/api/items/${item.item_id}`)
      .set(ctx.authHeader);
    const oldLm = got.body.item.last_modified;

    // Force a deterministic LWW bump
    const bumped = await request(ctx.app)
      .put(`/api/items/${item.item_id}`)
      .set(ctx.authHeader)
      .send({ name: 'Incremental Updated', last_modified: oldLm + 1000 });
    expect(bumped.status).toBe(200);

    const since = await request(ctx.app)
      .get(`/api/items?since=${oldLm}`)
      .set(ctx.authHeader);
    expect(since.status).toBe(200);
    expect(since.body.items.some(i => i.item_id === item.item_id)).toBe(true);

    // Soft delete and verify includeDeleted behavior
    const deleted = await request(ctx.app)
      .delete(`/api/items/${item.item_id}`)
      .set(ctx.authHeader);
    expect(deleted.status).toBe(200);

    const notIncluded = await request(ctx.app)
      .get('/api/items?q=Incremental')
      .set(ctx.authHeader);
    expect(notIncluded.status).toBe(200);
    expect(notIncluded.body.items.length).toBe(0);

    const included = await request(ctx.app)
      .get('/api/items?includeDeleted=1')
      .set(ctx.authHeader);
    expect(included.status).toBe(200);
    expect(included.body.items.some(i => i.item_id === item.item_id)).toBe(true);
    expect(included.body.deleted).toContain(item.item_id);
  });
});
