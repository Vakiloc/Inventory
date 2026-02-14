import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestContext } from './testDb.js';

let ctx;
afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
});

describe('inventory-server API', () => {
  it('GET /api/ping works without auth', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('inventory-server');
  });

  it('rejects protected endpoints without auth', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/meta');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('creates categories/locations and items, then searches', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app)
      .post('/api/categories')
      .set(ctx.authHeader)
      .send({ name: 'Electronics' });
    expect(catRes.status).toBe(200);
    expect(catRes.body.category.name).toBe('Electronics');

    const locRes = await request(ctx.app)
      .post('/api/locations')
      .set(ctx.authHeader)
      .send({ name: 'Garage Shelf' });
    expect(locRes.status).toBe(200);
    expect(locRes.body.location.name).toBe('Garage Shelf');

    const itemRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({
        name: 'Power Drill',
        quantity: 1,
        barcode: '12345',
        category_id: catRes.body.category.category_id,
        location_id: locRes.body.location.location_id
      });
    expect(itemRes.status).toBe(200);
    expect(itemRes.body.item.name).toBe('Power Drill');

    const listRes = await request(ctx.app)
      .get('/api/items?q=Drill')
      .set(ctx.authHeader);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items.length).toBe(1);
    expect(listRes.body.items[0].barcode).toBe('12345');
  });

  it('renames a category via PUT /api/categories/:id', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app)
      .post('/api/categories')
      .set(ctx.authHeader)
      .send({ name: 'Kitchen' });
    expect(catRes.status).toBe(200);

    const id = catRes.body.category.category_id;

    const renameRes = await request(ctx.app)
      .put(`/api/categories/${id}`)
      .set(ctx.authHeader)
      .send({ name: 'Kitchen (Main)' });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.category.name).toBe('Kitchen (Main)');

    const listRes = await request(ctx.app).get('/api/categories').set(ctx.authHeader);
    expect(listRes.status).toBe(200);
    expect(listRes.body.categories.some(c => c.category_id === id && c.name === 'Kitchen (Main)')).toBe(true);
  });

  it('returns 409 when renaming a category to an existing name', async () => {
    ctx = createTestContext();

    const aRes = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'A' });
    expect(aRes.status).toBe(200);
    await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'B' }).expect(200);

    const idA = aRes.body.category.category_id;
    const conflictRes = await request(ctx.app)
      .put(`/api/categories/${idA}`)
      .set(ctx.authHeader)
      .send({ name: 'B' });

    expect(conflictRes.status).toBe(409);
  });

  it('renames a location via PUT /api/locations/:id', async () => {
    ctx = createTestContext();

    const locRes = await request(ctx.app)
      .post('/api/locations')
      .set(ctx.authHeader)
      .send({ name: 'Pantry' });
    expect(locRes.status).toBe(200);

    const id = locRes.body.location.location_id;

    const renameRes = await request(ctx.app)
      .put(`/api/locations/${id}`)
      .set(ctx.authHeader)
      .send({ name: 'Pantry (Basement)', parent_id: null });
    expect(renameRes.status).toBe(200);
    expect(renameRes.body.location.name).toBe('Pantry (Basement)');

    const listRes = await request(ctx.app).get('/api/locations').set(ctx.authHeader);
    expect(listRes.status).toBe(200);
    expect(listRes.body.locations.some(l => l.location_id === id && l.name === 'Pantry (Basement)')).toBe(true);
  });

  it('scan increments quantity when barcode exists', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Batteries', quantity: 2, barcode: 'BAT-001' });
    expect(createRes.status).toBe(200);
    expect(createRes.body.item.quantity).toBe(2);

    const scanRes = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'BAT-001', delta: 3 });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.action).toBe('incremented');
    expect(scanRes.body.item.quantity).toBe(5);
  });

  it('scan returns multiple when barcode matches multiple items', async () => {
    ctx = createTestContext();

    const aRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'AA Battery Pack', quantity: 1, barcode: 'DUP-001' });
    expect(aRes.status).toBe(200);

    const bRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'AAA Battery Pack', quantity: 5, barcode: 'DUP-001' });
    expect(bRes.status).toBe(200);

    const scanRes = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'DUP-001', delta: 1 });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.action).toBe('multiple');
    expect(Array.isArray(scanRes.body.items)).toBe(true);
    expect(scanRes.body.items.length).toBe(2);

    // Ensure it did not increment an arbitrary item.
    const afterA = await request(ctx.app).get(`/api/items/${aRes.body.item.item_id}`).set(ctx.authHeader);
    const afterB = await request(ctx.app).get(`/api/items/${bRes.body.item.item_id}`).set(ctx.authHeader);
    expect(afterA.status).toBe(200);
    expect(afterB.status).toBe(200);
    expect(afterA.body.item.quantity).toBe(1);
    expect(afterB.body.item.quantity).toBe(5);
  });

  it('scan increments chosen item when barcode matches multiple items', async () => {
    ctx = createTestContext();

    const aRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Soda Can 330ml', quantity: 2, barcode: 'DUP-002' });
    expect(aRes.status).toBe(200);

    const bRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Soda Can 500ml', quantity: 10, barcode: 'DUP-002' });
    expect(bRes.status).toBe(200);

    const chosenId = bRes.body.item.item_id;

    const scanRes = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'DUP-002', item_id: chosenId, delta: 3 });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.action).toBe('incremented');
    expect(scanRes.body.item.item_id).toBe(chosenId);
    expect(scanRes.body.item.quantity).toBe(13);

    const afterA = await request(ctx.app).get(`/api/items/${aRes.body.item.item_id}`).set(ctx.authHeader);
    expect(afterA.status).toBe(200);
    expect(afterA.body.item.quantity).toBe(2);
  });

  it('scan override increments any chosen item and attaches barcode mapping', async () => {
    ctx = createTestContext();

    // Two items share the same *primary* barcode.
    await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Original Item A', quantity: 1, barcode: 'OV-001' })
      .expect(200);

    await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Original Item B', quantity: 2, barcode: 'OV-001' })
      .expect(200);

    // Chosen item has a different barcode.
    const chosenRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Chosen Item', quantity: 10, barcode: 'CH-1' });
    expect(chosenRes.status).toBe(200);
    const chosenId = chosenRes.body.item.item_id;

    const scanRes = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'OV-001', item_id: chosenId, delta: 3, event_id: 'ov-e1', override: true });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.action).toBe('incremented');
    expect(scanRes.body.item.item_id).toBe(chosenId);
    expect(scanRes.body.item.quantity).toBe(13);

    // Future resolves should prefer the attached mapping and be unambiguous.
    const resolveRes = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'OV-001' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.action).toBe('found');
    expect(resolveRes.body.item.item_id).toBe(chosenId);

    // And a plain scan should now increment the chosen item (not return multiple).
    const scan2 = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'OV-001', delta: 1 });
    expect(scan2.status).toBe(200);
    expect(scan2.body.action).toBe('incremented');
    expect(scan2.body.item.item_id).toBe(chosenId);
    expect(scan2.body.item.quantity).toBe(14);
  });

  it('scan override can reassign an existing alternate barcode mapping', async () => {
    ctx = createTestContext();

    const aRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Alt Owner A', quantity: 1, barcode: null });
    expect(aRes.status).toBe(200);
    const aId = aRes.body.item.item_id;

    const bRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'New Owner B', quantity: 5, barcode: null });
    expect(bRes.status).toBe(200);
    const bId = bRes.body.item.item_id;

    await request(ctx.app)
      .post(`/api/items/${aId}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'ALT-OV-1' })
      .expect(200);

    const scanRes = await request(ctx.app)
      .post('/api/scan')
      .set(ctx.authHeader)
      .send({ barcode: 'ALT-OV-1', item_id: bId, delta: 2, event_id: 'ov-e2', override: true });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.action).toBe('incremented');
    expect(scanRes.body.item.item_id).toBe(bId);
    expect(scanRes.body.item.quantity).toBe(7);

    const resolveRes = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'ALT-OV-1' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.action).toBe('found');
    expect(resolveRes.body.item.item_id).toBe(bId);
  });

  it('scan resolve returns item without incrementing quantity', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Flashlight', quantity: 7, barcode: 'FL-007' });
    expect(createRes.status).toBe(200);
    expect(createRes.body.item.quantity).toBe(7);

    const resolveRes = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'FL-007' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.action).toBe('found');
    expect(resolveRes.body.item.name).toBe('Flashlight');
    expect(resolveRes.body.item.quantity).toBe(7);

    const after = await request(ctx.app).get(`/api/items/${createRes.body.item.item_id}`).set(ctx.authHeader);
    expect(after.status).toBe(200);
    expect(after.body.item.quantity).toBe(7);

    const resolveMissing = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'MISSING-1' });
    expect(resolveMissing.status).toBe(200);
    expect(resolveMissing.body.action).toBe('not_found');
  });

  it('scan resolve returns multiple when barcode matches multiple items', async () => {
    ctx = createTestContext();

    await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Widget A', quantity: 1, barcode: 'DUP-003' })
      .expect(200);

    await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Widget B', quantity: 1, barcode: 'DUP-003' })
      .expect(200);

    const resolveRes = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'DUP-003' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.action).toBe('multiple');
    expect(Array.isArray(resolveRes.body.items)).toBe(true);
    expect(resolveRes.body.items.length).toBe(2);
  });

  it('POST /api/scans/apply applies delta events idempotently', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Paper Towels', quantity: 1, barcode: 'PT-01' });
    expect(createRes.status).toBe(200);

    const apply1 = await request(ctx.app)
      .post('/api/scans/apply')
      .set(ctx.authHeader)
      .send({
        events: [{ event_id: 'e1', barcode: 'PT-01', delta: 2, scanned_at: Date.now() }]
      });
    expect(apply1.status).toBe(200);
    expect(apply1.body.results[0].status).toBe('applied');
    expect(apply1.body.results[0].item.quantity).toBe(3);

    // replay same event should not double increment
    const apply2 = await request(ctx.app)
      .post('/api/scans/apply')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'e1', barcode: 'PT-01', delta: 2, scanned_at: Date.now() }] });
    expect(apply2.status).toBe(200);
    expect(apply2.body.results[0].status).toBe('duplicate');
    expect(apply2.body.results[0].item.quantity).toBe(3);
  });

  it('POST /api/scans/apply supports negative deltas (decrement, clamped at 0)', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Gloves', quantity: 2, barcode: 'G-01' });
    expect(createRes.status).toBe(200);

    const dec1 = await request(ctx.app)
      .post('/api/scans/apply')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'dec-1', barcode: 'G-01', delta: -1, scanned_at: Date.now() }] });
    expect(dec1.status).toBe(200);
    expect(dec1.body.results[0].status).toBe('applied');
    expect(dec1.body.results[0].item.quantity).toBe(1);

    // decrement below zero should clamp
    const dec2 = await request(ctx.app)
      .post('/api/scans/apply')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'dec-2', barcode: 'G-01', delta: -5, scanned_at: Date.now() }] });
    expect(dec2.status).toBe(200);
    expect(dec2.body.results[0].status).toBe('applied');
    expect(dec2.body.results[0].item.quantity).toBe(0);
  });

  it('POST /api/scans/apply returns not_found for unknown barcodes', async () => {
    ctx = createTestContext();

    const apply = await request(ctx.app)
      .post('/api/scans/apply')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'missing-1', barcode: 'UNKNOWN', delta: 1, scanned_at: Date.now() }] });

    expect(apply.status).toBe(200);
    expect(apply.body.results[0].status).toBe('not_found');
  });

  it('GET /api/item-barcodes returns mappings created after since', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Laptop Charger', quantity: 1, barcode: 'LC-PRIMARY' });
    const id = createRes.body.item.item_id;

    // SQLite default created_at uses seconds precision (strftime('%s')*1000).
    // Use a conservative cutoff so the test is not flaky.
    const since = Date.now() - 10_000;

    const addAlt = await request(ctx.app)
      .post(`/api/items/${id}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'LC-ALT-1' });
    expect(addAlt.status).toBe(200);

    const list = await request(ctx.app)
      .get(`/api/item-barcodes?since=${since}`)
      .set(ctx.authHeader);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.barcodes)).toBe(true);
    expect(list.body.barcodes.some(b => b.barcode === 'LC-ALT-1' && b.item_id === id)).toBe(true);
  });

  it('enforces last-write-wins (rejects older update)', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Router', quantity: 1, barcode: 'NET-01' });
    const item = createRes.body.item;

    // first update to bump last_modified
    const bumpRes = await request(ctx.app)
      .put(`/api/items/${item.item_id}`)
      .set(ctx.authHeader)
      .send({ quantity: 2 });
    expect(bumpRes.status).toBe(200);
    const serverLm = bumpRes.body.item.last_modified;

    // now attempt an older write
    const oldRes = await request(ctx.app)
      .put(`/api/items/${item.item_id}`)
      .set(ctx.authHeader)
      .send({ quantity: 1, last_modified: serverLm - 10_000 });
    expect(oldRes.status).toBe(409);
    expect(oldRes.body.error).toBe('conflict');
    expect(oldRes.body.serverItem.item_id).toBe(item.item_id);
  });

  it('composite /api/sync upserts and returns deleted ids', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Lamp', quantity: 1, barcode: 'LMP-1' });
    const item = createRes.body.item;

    const delRes = await request(ctx.app)
      .delete(`/api/items/${item.item_id}`)
      .set(ctx.authHeader);
    expect(delRes.status).toBe(200);
    expect(delRes.body.item.deleted).toBe(1);

    const syncRes = await request(ctx.app)
      .post('/api/sync')
      .set(ctx.authHeader)
      .send({ since: 0, items: [] });
    expect(syncRes.status).toBe(200);
    expect(Array.isArray(syncRes.body.items)).toBe(true);
    expect(syncRes.body.deleted).toContain(item.item_id);
  });
});
