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
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ barcode: 'BAT-001', delta: 3, event_id: 'bat-scan-1' }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].item.quantity).toBe(5);
  });

  it('scan returns ambiguous when barcode matches multiple items', async () => {
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
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ barcode: 'DUP-001', delta: 1, event_id: 'dup-scan-1' }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('ambiguous');
    expect(Array.isArray(scanRes.body.results[0].items)).toBe(true);
    expect(scanRes.body.results[0].items.length).toBe(2);

    // Ensure it did not increment an arbitrary item.
    const afterA = await request(ctx.app).get(`/api/items/${aRes.body.item.item_id}`).set(ctx.authHeader);
    const afterB = await request(ctx.app).get(`/api/items/${bRes.body.item.item_id}`).set(ctx.authHeader);
    expect(afterA.status).toBe(200);
    expect(afterB.status).toBe(200);
    expect(afterA.body.item.quantity).toBe(1);
    expect(afterB.body.item.quantity).toBe(5);
  });

  it('scan increments chosen item when item_id is specified', async () => {
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
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ barcode: 'DUP-002', item_id: chosenId, delta: 3, event_id: 'dup2-scan-1' }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].item.item_id).toBe(chosenId);
    expect(scanRes.body.results[0].item.quantity).toBe(13);

    const afterA = await request(ctx.app).get(`/api/items/${aRes.body.item.item_id}`).set(ctx.authHeader);
    expect(afterA.status).toBe(200);
    expect(afterA.body.item.quantity).toBe(2);
  });

  it('explicit barcode attachment + scan replaces override flow', async () => {
    ctx = createTestContext();

    // Chosen item has a different barcode.
    const chosenRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Chosen Item', quantity: 10, barcode: 'CH-1' });
    expect(chosenRes.status).toBe(200);
    const chosenId = chosenRes.body.item.item_id;

    // Attach barcode explicitly
    const attachRes = await request(ctx.app)
      .post(`/api/items/${chosenId}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'OV-001' });
    expect(attachRes.status).toBe(200);

    // Scan should now resolve to the chosen item
    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'ov-e1', barcode: 'OV-001', delta: 3, scanned_at: Date.now() }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].item.item_id).toBe(chosenId);
    expect(scanRes.body.results[0].item.quantity).toBe(13);

    // Resolve should find the chosen item
    const resolveRes = await request(ctx.app)
      .post('/api/scan/resolve')
      .set(ctx.authHeader)
      .send({ barcode: 'OV-001' });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.action).toBe('found');
    expect(resolveRes.body.item.item_id).toBe(chosenId);
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

  it('POST /api/scans applies delta events idempotently', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Paper Towels', quantity: 1, barcode: 'PT-01' });
    expect(createRes.status).toBe(200);

    const apply1 = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({
        events: [{ event_id: 'e1', barcode: 'PT-01', delta: 2, scanned_at: Date.now() }]
      });
    expect(apply1.status).toBe(200);
    expect(apply1.body.results[0].status).toBe('applied');
    expect(apply1.body.results[0].item.quantity).toBe(3);

    // replay same event should not double increment
    const apply2 = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'e1', barcode: 'PT-01', delta: 2, scanned_at: Date.now() }] });
    expect(apply2.status).toBe(200);
    expect(apply2.body.results[0].status).toBe('duplicate');
    expect(apply2.body.results[0].item.quantity).toBe(3);
  });

  it('POST /api/scans supports negative deltas (decrement, clamped at 0)', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Gloves', quantity: 2, barcode: 'G-01' });
    expect(createRes.status).toBe(200);

    const dec1 = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'dec-1', barcode: 'G-01', delta: -1, scanned_at: Date.now() }] });
    expect(dec1.status).toBe(200);
    expect(dec1.body.results[0].status).toBe('applied');
    expect(dec1.body.results[0].item.quantity).toBe(1);

    // decrement below zero should clamp
    const dec2 = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'dec-2', barcode: 'G-01', delta: -5, scanned_at: Date.now() }] });
    expect(dec2.status).toBe(200);
    expect(dec2.body.results[0].status).toBe('applied');
    expect(dec2.body.results[0].item.quantity).toBe(0);
  });

  it('POST /api/scans returns not_found for unknown barcodes', async () => {
    ctx = createTestContext();

    const apply = await request(ctx.app)
      .post('/api/scans')
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

  it('POST /api/scans unified endpoint applies scan events', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Tape', quantity: 3, barcode: 'TAPE-01' });
    expect(createRes.status).toBe(200);

    const scansRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({
        events: [{ event_id: 'unified-1', barcode: 'TAPE-01', delta: 2, scanned_at: Date.now() }]
      });
    expect(scansRes.status).toBe(200);
    expect(scansRes.body.results[0].status).toBe('applied');
    expect(scansRes.body.results[0].item.quantity).toBe(5);
    expect(typeof scansRes.body.serverTimeMs).toBe('number');
  });

  it('DELETE /api/items/:id/barcodes/:barcode removes alternate barcode', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Headphones', quantity: 1, barcode: 'HP-PRIMARY' });
    const id = createRes.body.item.item_id;

    await request(ctx.app)
      .post(`/api/items/${id}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'HP-ALT-1' })
      .expect(200);

    const listBefore = await request(ctx.app)
      .get(`/api/items/${id}/barcodes`)
      .set(ctx.authHeader);
    expect(listBefore.body.barcodes.some(b => b.barcode === 'HP-ALT-1')).toBe(true);

    const delRes = await request(ctx.app)
      .delete(`/api/items/${id}/barcodes/HP-ALT-1`)
      .set(ctx.authHeader);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);

    const listAfter = await request(ctx.app)
      .get(`/api/items/${id}/barcodes`)
      .set(ctx.authHeader);
    expect(listAfter.body.barcodes.some(b => b.barcode === 'HP-ALT-1')).toBe(false);
  });

  it('DELETE /api/items/:id/barcodes/:barcode returns 404 for non-existent mapping', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Speaker', quantity: 1 });
    const id = createRes.body.item.item_id;

    const delRes = await request(ctx.app)
      .delete(`/api/items/${id}/barcodes/NONEXISTENT`)
      .set(ctx.authHeader);
    expect(delRes.status).toBe(404);
  });

  it('deleting a category nullifies items category_id', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app)
      .post('/api/categories')
      .set(ctx.authHeader)
      .send({ name: 'Temp Category' });
    const catId = catRes.body.category.category_id;

    const itemRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Cat Item', quantity: 1, category_id: catId });
    const itemId = itemRes.body.item.item_id;
    expect(itemRes.body.item.category_id).toBe(catId);

    await request(ctx.app)
      .delete(`/api/categories/${catId}`)
      .set(ctx.authHeader)
      .expect(200);

    const after = await request(ctx.app).get(`/api/items/${itemId}`).set(ctx.authHeader);
    expect(after.body.item.category_id).toBeNull();
  });

  it('deleting a location nullifies items location_id', async () => {
    ctx = createTestContext();

    const locRes = await request(ctx.app)
      .post('/api/locations')
      .set(ctx.authHeader)
      .send({ name: 'Temp Location' });
    const locId = locRes.body.location.location_id;

    const itemRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Loc Item', quantity: 1, location_id: locId });
    const itemId = itemRes.body.item.item_id;
    expect(itemRes.body.item.location_id).toBe(locId);

    await request(ctx.app)
      .delete(`/api/locations/${locId}`)
      .set(ctx.authHeader)
      .expect(200);

    const after = await request(ctx.app).get(`/api/items/${itemId}`).set(ctx.authHeader);
    expect(after.body.item.location_id).toBeNull();
  });

  // ── Category CRUD ───────────────────────────────────────────────────

  it('GET /api/categories returns categories in alphabetical order', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Zebra' }).expect(200);
    await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Apple' }).expect(200);
    await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Mango' }).expect(200);

    const res = await request(ctx.app).get('/api/categories').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.categories.length).toBe(3);
    expect(res.body.categories[0].name).toBe('Apple');
    expect(res.body.categories[1].name).toBe('Mango');
    expect(res.body.categories[2].name).toBe('Zebra');
  });

  it('POST /api/categories rejects duplicate name', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Unique' }).expect(200);

    const dup = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Unique' });
    // SQLite UNIQUE constraint triggers an error
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/categories rejects empty name', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/categories/:id removes category from list', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'ToRemove' });
    const catId = catRes.body.category.category_id;

    await request(ctx.app).delete(`/api/categories/${catId}`).set(ctx.authHeader).expect(200);

    const listRes = await request(ctx.app).get('/api/categories').set(ctx.authHeader);
    expect(listRes.body.categories.some(c => c.category_id === catId)).toBe(false);
  });

  it('DELETE /api/categories/:id bumps last_modified on affected items', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Temp' });
    const catId = catRes.body.category.category_id;

    const itemRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Affected', quantity: 1, category_id: catId });
    const originalLm = itemRes.body.item.last_modified;

    // Small delay for timestamp change
    await new Promise(r => setTimeout(r, 5));

    await request(ctx.app).delete(`/api/categories/${catId}`).set(ctx.authHeader).expect(200);

    const after = await request(ctx.app).get(`/api/items/${itemRes.body.item.item_id}`).set(ctx.authHeader);
    expect(after.body.item.category_id).toBeNull();
    expect(after.body.item.last_modified).toBeGreaterThanOrEqual(originalLm);
  });

  // ── Location CRUD ─────────────────────────────────────────────────

  it('GET /api/locations returns locations in alphabetical order', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Garage' }).expect(200);
    await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Attic' }).expect(200);
    await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Basement' }).expect(200);

    const res = await request(ctx.app).get('/api/locations').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.locations.length).toBe(3);
    expect(res.body.locations[0].name).toBe('Attic');
    expect(res.body.locations[1].name).toBe('Basement');
    expect(res.body.locations[2].name).toBe('Garage');
  });

  it('POST /api/locations with parent_id creates child location', async () => {
    ctx = createTestContext();

    const parentRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Building A' });
    const parentId = parentRes.body.location.location_id;

    const childRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Room 101', parent_id: parentId });
    expect(childRes.status).toBe(200);
    expect(childRes.body.location.parent_id).toBe(parentId);
  });

  it('POST /api/locations allows same name with different parent_id', async () => {
    ctx = createTestContext();

    const parentA = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Floor 1' });
    const parentB = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Floor 2' });

    const roomA = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Storage', parent_id: parentA.body.location.location_id });
    expect(roomA.status).toBe(200);

    const roomB = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Storage', parent_id: parentB.body.location.location_id });
    expect(roomB.status).toBe(200);
    expect(roomA.body.location.location_id).not.toBe(roomB.body.location.location_id);
  });

  it('POST /api/locations rejects duplicate (name, parent_id) pair', async () => {
    ctx = createTestContext();

    // UNIQUE(name, parent_id) only fires with non-NULL parent_id (NULL != NULL in SQLite)
    const parent = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Building' });
    const parentId = parent.body.location.location_id;

    await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Closet', parent_id: parentId }).expect(200);

    const dup = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Closet', parent_id: parentId });
    expect(dup.status).toBeGreaterThanOrEqual(400);
  });

  it('POST /api/locations rejects empty name', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('PUT /api/locations/:id returns 409 for duplicate (name, parent_id)', async () => {
    ctx = createTestContext();

    // Must use explicit parent_id for UNIQUE constraint to work (NULL != NULL in SQLite)
    const parent = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Wing' });
    const parentId = parent.body.location.location_id;

    const aRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Loc-A', parent_id: parentId });
    await request(ctx.app).post('/api/locations').set(ctx.authHeader)
      .send({ name: 'Loc-B', parent_id: parentId }).expect(200);

    const renameRes = await request(ctx.app)
      .put(`/api/locations/${aRes.body.location.location_id}`)
      .set(ctx.authHeader)
      .send({ name: 'Loc-B', parent_id: parentId });
    expect(renameRes.status).toBe(409);
  });

  it('DELETE /api/locations/:id removes location from list', async () => {
    ctx = createTestContext();

    const locRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Doomed' });
    const locId = locRes.body.location.location_id;

    await request(ctx.app).delete(`/api/locations/${locId}`).set(ctx.authHeader).expect(200);

    const listRes = await request(ctx.app).get('/api/locations').set(ctx.authHeader);
    expect(listRes.body.locations.some(l => l.location_id === locId)).toBe(false);
  });

  it('DELETE /api/locations/:id bumps last_modified on affected items', async () => {
    ctx = createTestContext();

    const locRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Temp Loc' });
    const locId = locRes.body.location.location_id;

    const itemRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Affected Item', quantity: 1, location_id: locId });
    const originalLm = itemRes.body.item.last_modified;

    await new Promise(r => setTimeout(r, 5));

    await request(ctx.app).delete(`/api/locations/${locId}`).set(ctx.authHeader).expect(200);

    const after = await request(ctx.app).get(`/api/items/${itemRes.body.item.item_id}`).set(ctx.authHeader);
    expect(after.body.item.location_id).toBeNull();
    expect(after.body.item.last_modified).toBeGreaterThanOrEqual(originalLm);
  });

  // ── Item management edge cases ──────────────────────────────────────

  it('GET /api/items/:id returns 404 for non-existent item', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app)
      .get('/api/items/99999')
      .set(ctx.authHeader);
    expect(res.status).toBe(404);
  });

  it('POST /api/items with only name uses defaults', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Minimal Item' });
    expect(res.status).toBe(200);
    expect(res.body.item.name).toBe('Minimal Item');
    expect(res.body.item.quantity).toBe(1);
    expect(res.body.item.barcode).toBeNull();
    expect(res.body.item.category_id).toBeNull();
    expect(res.body.item.location_id).toBeNull();
    expect(res.body.item.deleted).toBe(0);
    expect(typeof res.body.item.last_modified).toBe('number');
  });

  it('PUT /api/items/:id partial update preserves other fields', async () => {
    ctx = createTestContext();

    const catRes = await request(ctx.app)
      .post('/api/categories')
      .set(ctx.authHeader)
      .send({ name: 'Tools' });
    const catId = catRes.body.category.category_id;

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Hammer', quantity: 3, barcode: 'HM-01', category_id: catId, serial_number: 'SN-123' });
    const item = createRes.body.item;

    const updateRes = await request(ctx.app)
      .put(`/api/items/${item.item_id}`)
      .set(ctx.authHeader)
      .send({ quantity: 5 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.item.quantity).toBe(5);
    expect(updateRes.body.item.name).toBe('Hammer');
    expect(updateRes.body.item.barcode).toBe('HM-01');
    expect(updateRes.body.item.category_id).toBe(catId);
    expect(updateRes.body.item.serial_number).toBe('SN-123');
  });

  it('DELETE /api/items/:id soft-deletes and excludes from default list', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Disposable', quantity: 1 });
    const itemId = createRes.body.item.item_id;

    const delRes = await request(ctx.app)
      .delete(`/api/items/${itemId}`)
      .set(ctx.authHeader);
    expect(delRes.status).toBe(200);

    // Default list excludes deleted items
    const listRes = await request(ctx.app)
      .get('/api/items')
      .set(ctx.authHeader);
    expect(listRes.body.items.some(i => i.item_id === itemId)).toBe(false);

    // GET by ID still returns the item with deleted=1
    const getRes = await request(ctx.app)
      .get(`/api/items/${itemId}`)
      .set(ctx.authHeader);
    expect(getRes.status).toBe(200);
    expect(getRes.body.item.deleted).toBe(1);
  });

  it('GET /api/items filters by categoryId', async () => {
    ctx = createTestContext();

    const catA = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'CatA' });
    const catB = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'CatB' });

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'In A', quantity: 1, category_id: catA.body.category.category_id });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'In B', quantity: 1, category_id: catB.body.category.category_id });

    const res = await request(ctx.app)
      .get(`/api/items?categoryId=${catA.body.category.category_id}`)
      .set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].name).toBe('In A');
  });

  it('GET /api/items filters by locationId', async () => {
    ctx = createTestContext();

    const locA = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'LocA' });
    const locB = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'LocB' });

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'At A', quantity: 1, location_id: locA.body.location.location_id });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'At B', quantity: 1, location_id: locB.body.location.location_id });

    const res = await request(ctx.app)
      .get(`/api/items?locationId=${locA.body.location.location_id}`)
      .set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].name).toBe('At A');
  });

  it('GET /api/items combined search + categoryId filter', async () => {
    ctx = createTestContext();

    const cat = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Elec' });
    const catId = cat.body.category.category_id;

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Red Wire', quantity: 1, category_id: catId });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Blue Wire', quantity: 1 });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Red Tape', quantity: 1, category_id: catId });

    const res = await request(ctx.app)
      .get(`/api/items?q=Wire&categoryId=${catId}`)
      .set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].name).toBe('Red Wire');
  });

  it('GET /api/items search matches serial_number', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Laptop', quantity: 1, serial_number: 'XYZ-9876' });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Mouse', quantity: 1 });

    const res = await request(ctx.app)
      .get('/api/items?q=XYZ-9876')
      .set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].name).toBe('Laptop');
  });

  it('GET /api/items search matches alternate barcode', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Monitor', quantity: 1, barcode: 'MON-PRIMARY' });
    const itemId = createRes.body.item.item_id;

    await request(ctx.app).post(`/api/items/${itemId}/barcodes`).set(ctx.authHeader)
      .send({ barcode: 'MON-ALT-UNIQUE' });

    const res = await request(ctx.app)
      .get('/api/items?q=MON-ALT-UNIQUE')
      .set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].item_id).toBe(itemId);
  });

  it('full item lifecycle: create → read → update → search → delete', async () => {
    ctx = createTestContext();

    // Create with all fields
    const catRes = await request(ctx.app).post('/api/categories').set(ctx.authHeader).send({ name: 'Lifecycle Cat' });
    const locRes = await request(ctx.app).post('/api/locations').set(ctx.authHeader).send({ name: 'Lifecycle Loc' });

    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({
        name: 'Lifecycle Item',
        description: 'A test item',
        quantity: 3,
        barcode: 'LIFE-001',
        category_id: catRes.body.category.category_id,
        location_id: locRes.body.location.location_id,
        serial_number: 'SN-LIFE',
        value: 29.99
      });
    expect(createRes.status).toBe(200);
    const itemId = createRes.body.item.item_id;
    expect(createRes.body.item.description).toBe('A test item');
    expect(createRes.body.item.value).toBe(29.99);

    // Read
    const getRes = await request(ctx.app).get(`/api/items/${itemId}`).set(ctx.authHeader);
    expect(getRes.status).toBe(200);
    expect(getRes.body.item.name).toBe('Lifecycle Item');
    expect(getRes.body.item.serial_number).toBe('SN-LIFE');

    // Update name
    const updateRes = await request(ctx.app)
      .put(`/api/items/${itemId}`)
      .set(ctx.authHeader)
      .send({ name: 'Updated Lifecycle Item' });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.item.name).toBe('Updated Lifecycle Item');
    expect(updateRes.body.item.quantity).toBe(3); // unchanged

    // Search by updated name
    const searchRes = await request(ctx.app).get('/api/items?q=Updated Lifecycle').set(ctx.authHeader);
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.items.length).toBe(1);
    expect(searchRes.body.items[0].item_id).toBe(itemId);

    // Delete
    const delRes = await request(ctx.app).delete(`/api/items/${itemId}`).set(ctx.authHeader);
    expect(delRes.status).toBe(200);
    expect(delRes.body.item.deleted).toBe(1);

    // Search no longer returns deleted item
    const afterSearch = await request(ctx.app).get('/api/items?q=Updated Lifecycle').set(ctx.authHeader);
    expect(afterSearch.body.items.length).toBe(0);
  });

  it('GET /api/items search matches primary barcode', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Barcode Item', quantity: 1, barcode: 'PRI-UNIQUE-789' });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Other Thing', quantity: 1 });

    const res = await request(ctx.app).get('/api/items?q=PRI-UNIQUE-789').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].name).toBe('Barcode Item');
  });

  it('GET /api/items with no items returns empty array', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/items').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(typeof res.body.serverTimeMs).toBe('number');
  });

  it('GET /api/items search with no matches returns empty array', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Something', quantity: 1 });

    const res = await request(ctx.app).get('/api/items?q=NONEXISTENT').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
  });

  it('POST /api/items rejects missing name', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).post('/api/items').set(ctx.authHeader).send({ quantity: 5 });
    expect(res.status).toBe(400);
  });

  it('PUT /api/items/:id returns 404 for non-existent item', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app)
      .put('/api/items/99999')
      .set(ctx.authHeader)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/items/:id returns 404 for non-existent item', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).delete('/api/items/99999').set(ctx.authHeader);
    expect(res.status).toBe(404);
  });

  it('GET /api/items/:id/barcodes returns 404 for non-existent item', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/items/99999/barcodes').set(ctx.authHeader);
    expect(res.status).toBe(404);
  });

  it('PUT /api/items/:id LWW accepts newer explicit last_modified', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Clock', quantity: 1 });
    const item = createRes.body.item;

    const futureTs = item.last_modified + 60_000;
    const updateRes = await request(ctx.app)
      .put(`/api/items/${item.item_id}`)
      .set(ctx.authHeader)
      .send({ name: 'Wall Clock', last_modified: futureTs });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.item.name).toBe('Wall Clock');
  });

  // ── Scan workflow edge cases ────────────────────────────────────────

  it('POST /api/scans batch with multiple events returns results in order', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'ItemA', quantity: 1, barcode: 'BC-A' });
    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'ItemB', quantity: 1, barcode: 'BC-B' });

    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({
        events: [
          { event_id: 'batch-1', barcode: 'BC-A', delta: 1 },
          { event_id: 'batch-2', barcode: 'BC-B', delta: 2 },
          { event_id: 'batch-3', barcode: 'MISSING', delta: 1 }
        ]
      });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results.length).toBe(3);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].event_id).toBe('batch-1');
    expect(scanRes.body.results[1].status).toBe('applied');
    expect(scanRes.body.results[1].event_id).toBe('batch-2');
    expect(scanRes.body.results[1].item.quantity).toBe(3);
    expect(scanRes.body.results[2].status).toBe('not_found');
    expect(scanRes.body.results[2].event_id).toBe('batch-3');
  });

  it('POST /api/scans with item_id pointing to deleted item returns not_found', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Deleted Thing', quantity: 5, barcode: 'DEL-001' });
    const itemId = createRes.body.item.item_id;

    await request(ctx.app).delete(`/api/items/${itemId}`).set(ctx.authHeader).expect(200);

    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'del-scan-1', barcode: 'DEL-001', delta: 1, item_id: itemId }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('not_found');
  });

  it('POST /api/scans with item_id pointing to non-existent item returns error', async () => {
    ctx = createTestContext();

    // Non-existent item_id triggers a FK constraint error during scan event insertion
    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'ghost-1', barcode: 'ANY', delta: 1, item_id: 99999 }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('error');
  });

  it('POST /api/scans duplicate event_id within same batch', async () => {
    ctx = createTestContext();

    await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'DupBatch', quantity: 1, barcode: 'DB-001' });

    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({
        events: [
          { event_id: 'same-id', barcode: 'DB-001', delta: 1 },
          { event_id: 'same-id', barcode: 'DB-001', delta: 1 }
        ]
      });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].item.quantity).toBe(2);
    expect(scanRes.body.results[1].status).toBe('duplicate');
    // Quantity should not have been incremented again
    expect(scanRes.body.results[1].item.quantity).toBe(2);
  });

  it('POST /api/scans returns 400 for invalid payload (missing event_id)', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ barcode: 'X', delta: 1 }] });
    expect(res.status).toBe(400);
  });

  it('POST /api/scans scan via alternate barcode applies to correct item', async () => {
    ctx = createTestContext();

    const createRes = await request(ctx.app).post('/api/items').set(ctx.authHeader)
      .send({ name: 'Gadget', quantity: 10, barcode: 'GAD-PRIMARY' });
    const itemId = createRes.body.item.item_id;

    await request(ctx.app)
      .post(`/api/items/${itemId}/barcodes`)
      .set(ctx.authHeader)
      .send({ barcode: 'GAD-ALT-1' });

    const scanRes = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .send({ events: [{ event_id: 'alt-scan-1', barcode: 'GAD-ALT-1', delta: 5 }] });
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.results[0].status).toBe('applied');
    expect(scanRes.body.results[0].item.item_id).toBe(itemId);
    expect(scanRes.body.results[0].item.quantity).toBe(15);
  });

  // ── Sync & export/import ────────────────────────────────────────────

  it('POST /api/import merges via LWW (newer incoming wins)', async () => {
    const ctx1 = createTestContext();
    const ctx2 = createTestContext();

    try {
      // Create item in target (ctx2)
      const localRes = await request(ctx2.app).post('/api/items').set(ctx2.authHeader)
        .send({ name: 'Local Version', quantity: 1, barcode: 'LWW-01' });
      const localItem = localRes.body.item;

      // Create a snapshot with the same item_id but newer timestamp and different name
      const snapshot = {
        schema: 1,
        exported_at_ms: Date.now(),
        categories: [],
        locations: [],
        items: [{
          item_id: localItem.item_id,
          name: 'Remote Version',
          quantity: 5,
          barcode: 'LWW-01',
          last_modified: localItem.last_modified + 60_000,
          deleted: 0
        }],
        item_barcodes: []
      };

      await request(ctx2.app)
        .post('/api/import')
        .set(ctx2.authHeader)
        .send(snapshot)
        .expect(200);

      const after = await request(ctx2.app)
        .get(`/api/items/${localItem.item_id}`)
        .set(ctx2.authHeader);
      expect(after.body.item.name).toBe('Remote Version');
      expect(after.body.item.quantity).toBe(5);
    } finally {
      ctx1.cleanup();
      ctx2.cleanup();
    }
  });

  it('POST /api/import preserves local when incoming is older', async () => {
    const ctx1 = createTestContext();

    try {
      const localRes = await request(ctx1.app).post('/api/items').set(ctx1.authHeader)
        .send({ name: 'Newer Local', quantity: 10 });
      const localItem = localRes.body.item;

      const snapshot = {
        schema: 1,
        exported_at_ms: Date.now(),
        categories: [],
        locations: [],
        items: [{
          item_id: localItem.item_id,
          name: 'Older Remote',
          quantity: 1,
          last_modified: localItem.last_modified - 60_000,
          deleted: 0
        }],
        item_barcodes: []
      };

      await request(ctx1.app)
        .post('/api/import')
        .set(ctx1.authHeader)
        .send(snapshot)
        .expect(200);

      const after = await request(ctx1.app)
        .get(`/api/items/${localItem.item_id}`)
        .set(ctx1.authHeader);
      expect(after.body.item.name).toBe('Newer Local');
      expect(after.body.item.quantity).toBe(10);
    } finally {
      ctx1.cleanup();
    }
  });

  it('POST /api/import cleans invalid category/location refs', async () => {
    ctx = createTestContext();

    const snapshot = {
      schema: 1,
      exported_at_ms: Date.now(),
      categories: [],
      locations: [],
      items: [{
        item_id: 1,
        name: 'Bad Refs',
        quantity: 1,
        category_id: 999,
        location_id: 888,
        last_modified: Date.now(),
        deleted: 0
      }],
      item_barcodes: []
    };

    await request(ctx.app)
      .post('/api/import')
      .set(ctx.authHeader)
      .send(snapshot)
      .expect(200);

    const after = await request(ctx.app)
      .get('/api/items/1')
      .set(ctx.authHeader);
    expect(after.status).toBe(200);
    expect(after.body.item.name).toBe('Bad Refs');
    expect(after.body.item.category_id).toBeNull();
    expect(after.body.item.location_id).toBeNull();
  });

  it('GET /api/sync-log returns entries in descending order', async () => {
    ctx = createTestContext();

    const snapshot1 = { schema: 1, exported_at_ms: Date.now(), categories: [], locations: [], items: [], item_barcodes: [] };
    await request(ctx.app).post('/api/import').set(ctx.authHeader).send(snapshot1).expect(200);

    // Small delay to ensure distinct timestamps
    await new Promise(r => setTimeout(r, 10));

    const snapshot2 = { schema: 1, exported_at_ms: Date.now(), categories: [], locations: [], items: [], item_barcodes: [] };
    await request(ctx.app).post('/api/import').set(ctx.authHeader).send(snapshot2).expect(200);

    const logRes = await request(ctx.app).get('/api/sync-log').set(ctx.authHeader);
    expect(logRes.status).toBe(200);
    expect(logRes.body.log.length).toBeGreaterThanOrEqual(2);
    // Descending order: first entry has the larger (more recent) sync_time
    expect(logRes.body.log[0].sync_time).toBeGreaterThanOrEqual(logRes.body.log[1].sync_time);
  });

  // ── Multi-inventory ───────────────────────────────────────────────

  it('GET /api/inventories returns default inventory in single-inventory mode', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/inventories').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.activeId).toBe('default');
    expect(res.body.inventories.length).toBe(1);
    expect(res.body.inventories[0].id).toBe('default');
    expect(res.body.inventories[0].name).toBe('Default');
  });

  it('API responses include X-Inventory-Id header', async () => {
    ctx = createTestContext();

    const res = await request(ctx.app).get('/api/items').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.headers['x-inventory-id']).toBe('default');
  });

  it('GET /api/inventories lists multiple inventories from registry', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' },
        { id: 'inv-b', name: 'Inventory B' }
      ]
    });

    const res = await request(ctx.app).get('/api/inventories').set(ctx.authHeader);
    expect(res.status).toBe(200);
    expect(res.body.activeId).toBe('inv-a');
    expect(res.body.inventories.length).toBe(2);
    expect(res.body.inventories.some(i => i.id === 'inv-a' && i.name === 'Inventory A')).toBe(true);
    expect(res.body.inventories.some(i => i.id === 'inv-b' && i.name === 'Inventory B')).toBe(true);
  });

  it('invalid X-Inventory-Id header returns 404', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' }
      ]
    });

    const res = await request(ctx.app)
      .get('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('inventory_not_found');
  });

  it('X-Inventory-Id header isolates item data between inventories', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' },
        { id: 'inv-b', name: 'Inventory B' }
      ]
    });

    // Create item in inv-a
    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a')
      .send({ name: 'Item in A', quantity: 3 });
    expect(createRes.status).toBe(200);
    expect(createRes.headers['x-inventory-id']).toBe('inv-a');

    // Query inv-a → item found
    const aList = await request(ctx.app)
      .get('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a');
    expect(aList.status).toBe(200);
    expect(aList.body.items.length).toBe(1);
    expect(aList.body.items[0].name).toBe('Item in A');

    // Query inv-b → empty
    const bList = await request(ctx.app)
      .get('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-b');
    expect(bList.status).toBe(200);
    expect(bList.body.items.length).toBe(0);
  });

  it('X-Inventory-Id defaults to activeId when header omitted', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' },
        { id: 'inv-b', name: 'Inventory B' }
      ]
    });

    // Create item without X-Inventory-Id header → defaults to activeId (inv-a)
    const createRes = await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .send({ name: 'Default Target', quantity: 1 });
    expect(createRes.status).toBe(200);
    expect(createRes.headers['x-inventory-id']).toBe('inv-a');

    // Query inv-a explicitly → item found
    const aList = await request(ctx.app)
      .get('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a');
    expect(aList.body.items.length).toBe(1);
    expect(aList.body.items[0].name).toBe('Default Target');
  });

  it('categories and locations are isolated between inventories', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' },
        { id: 'inv-b', name: 'Inventory B' }
      ]
    });

    // Create category and location in inv-a
    await request(ctx.app)
      .post('/api/categories')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a')
      .send({ name: 'Category A' })
      .expect(200);

    await request(ctx.app)
      .post('/api/locations')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a')
      .send({ name: 'Location A' })
      .expect(200);

    // Query inv-b → empty categories and locations
    const catRes = await request(ctx.app)
      .get('/api/categories')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-b');
    expect(catRes.body.categories.length).toBe(0);

    const locRes = await request(ctx.app)
      .get('/api/locations')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-b');
    expect(locRes.body.locations.length).toBe(0);
  });

  it('scan events are isolated between inventories', async () => {
    ctx = createTestContext({
      registryInventories: [
        { id: 'inv-a', name: 'Inventory A' },
        { id: 'inv-b', name: 'Inventory B' }
      ]
    });

    // Create item with barcode in inv-a
    await request(ctx.app)
      .post('/api/items')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a')
      .send({ name: 'Scanned Item', quantity: 1, barcode: 'SCAN-001' })
      .expect(200);

    // Scan barcode in inv-a → applied
    const scanA = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-a')
      .send({ events: [{ event_id: 'iso-1', barcode: 'SCAN-001', delta: 1 }] });
    expect(scanA.status).toBe(200);
    expect(scanA.body.results[0].status).toBe('applied');

    // Same barcode in inv-b → not_found (item doesn't exist in inv-b)
    const scanB = await request(ctx.app)
      .post('/api/scans')
      .set(ctx.authHeader)
      .set('X-Inventory-Id', 'inv-b')
      .send({ events: [{ event_id: 'iso-2', barcode: 'SCAN-001', delta: 1 }] });
    expect(scanB.status).toBe(200);
    expect(scanB.body.results[0].status).toBe('not_found');
  });
});
