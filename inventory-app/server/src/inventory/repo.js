import { nowMs } from '../validation.js';

function normalizeItemForDb(item) {
  return {
    name: item.name,
    description: item.description ?? null,
    quantity: typeof item.quantity === 'number' ? item.quantity : 1,
    barcode: item.barcode ?? null,
    barcode_corrupted: typeof item.barcode_corrupted === 'number' ? item.barcode_corrupted : 0,
    category_id: item.category_id ?? null,
    location_id: item.location_id ?? null,
    purchase_date: item.purchase_date ?? null,
    warranty_info: item.warranty_info ?? null,
    value: item.value ?? null,
    serial_number: item.serial_number ?? null,
    photo_path: item.photo_path ?? null,
    deleted: typeof item.deleted === 'number' ? item.deleted : 0,
    last_modified: typeof item.last_modified === 'number' ? item.last_modified : nowMs()
  };
}

export function listItems(db, { q, categoryId, locationId, since, includeDeleted }) {
  const where = [];
  const params = {};

  if (!includeDeleted) {
    where.push('deleted = 0');
  }

  if (typeof since === 'number') {
    where.push('last_modified > @since');
    params.since = since;
  }

  if (q) {
    where.push(`(
      name LIKE @q
      OR barcode LIKE @q
      OR serial_number LIKE @q
      OR EXISTS (
        SELECT 1 FROM item_barcodes b
        WHERE b.item_id = items.item_id AND b.barcode LIKE @q
      )
    )`);
    params.q = `%${q}%`;
  }

  if (typeof categoryId === 'number') {
    where.push('category_id = @categoryId');
    params.categoryId = categoryId;
  }

  if (typeof locationId === 'number') {
    where.push('location_id = @locationId');
    params.locationId = locationId;
  }

  const sql = `
    SELECT * FROM items
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY last_modified DESC
  `;

  return db.prepare(sql).all(params);
}

export function listItemBarcodes(db, itemId) {
  return db
    .prepare('SELECT barcode, item_id, created_at FROM item_barcodes WHERE item_id = ? ORDER BY barcode ASC')
    .all(itemId);
}

export function listItemBarcodesSince(db, sinceMs = 0) {
  const since = Number.isFinite(Number(sinceMs)) ? Number(sinceMs) : 0;
  return db
    .prepare('SELECT barcode, item_id, created_at FROM item_barcodes WHERE created_at > ? ORDER BY created_at ASC')
    .all(since);
}

function getScanEvent(db, eventId) {
  if (!eventId) return null;
  return db
    .prepare('SELECT event_id, barcode, item_id, delta, status, scanned_at, applied_at FROM scan_events WHERE event_id = ?')
    .get(eventId);
}

function insertScanEvent(db, row) {
  db.prepare(
    `INSERT OR IGNORE INTO scan_events(
      event_id, barcode, item_id, delta, status, scanned_at, applied_at
    ) VALUES(?,?,?,?,?,?,?)`
  ).run(
    row.event_id,
    row.barcode,
    row.item_id ?? null,
    row.delta,
    row.status,
    row.scanned_at ?? null,
    row.applied_at
  );
}

export function applyScanEventByBarcode(db, { event_id, barcode, delta, scanned_at }) {
  const eid = String(event_id || '').trim();
  const code = String(barcode || '').trim();
  const d = Number(delta ?? 1);

  if (!eid) throw new Error('event_id_required');
  if (!code) throw new Error('barcode_required');
  if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100) throw new Error('delta_invalid');

  const tx = db.transaction(() => {
    const existing = getScanEvent(db, eid);
    if (existing) {
      if (existing.item_id) {
        return { status: 'duplicate', event_id: eid, item: getItem(db, existing.item_id) };
      }
      if (existing.status === 'ambiguous') {
        return { status: 'duplicate', event_id: eid, reason: 'ambiguous', items: getItemsByBarcodeExact(db, code) };
      }
      return { status: 'duplicate', event_id: eid, reason: existing.status };
    }

    const matches = getItemsByBarcodeExact(db, code);
    const appliedAt = nowMs();
    if (matches.length === 0) {
      insertScanEvent(db, {
        event_id: eid,
        barcode: code,
        item_id: null,
        delta: d,
        status: 'not_found',
        scanned_at: typeof scanned_at === 'number' ? scanned_at : null,
        applied_at: appliedAt
      });
      return { status: 'not_found', event_id: eid };
    }

    if (matches.length > 1) {
      insertScanEvent(db, {
        event_id: eid,
        barcode: code,
        item_id: null,
        delta: d,
        status: 'ambiguous',
        scanned_at: typeof scanned_at === 'number' ? scanned_at : null,
        applied_at: appliedAt
      });
      return { status: 'ambiguous', event_id: eid, items: matches };
    }

    const found = matches[0];

    const updated = incrementItemQuantity(db, found.item_id, d);
    insertScanEvent(db, {
      event_id: eid,
      barcode: code,
      item_id: found.item_id,
      delta: d,
      status: 'applied',
      scanned_at: typeof scanned_at === 'number' ? scanned_at : null,
      applied_at: appliedAt
    });

    return { status: 'applied', event_id: eid, item: updated };
  });

  return tx();
}

export function applyScanEventByBarcodeChosenItem(db, { event_id, barcode, delta, scanned_at, item_id }) {
  const eid = String(event_id || '').trim();
  const code = String(barcode || '').trim();
  const d = Number(delta ?? 1);
  const chosenItemId = Number(item_id);

  if (!eid) throw new Error('event_id_required');
  if (!code) throw new Error('barcode_required');
  if (!Number.isInteger(d) || d === 0 || Math.abs(d) > 100) throw new Error('delta_invalid');
  if (!Number.isInteger(chosenItemId)) throw new Error('item_id_required');

  const tx = db.transaction(() => {
    const existing = getScanEvent(db, eid);
    if (existing) {
      if (existing.item_id) {
        return { status: 'duplicate', event_id: eid, item: getItem(db, existing.item_id) };
      }
      if (existing.status === 'ambiguous') {
        return { status: 'duplicate', event_id: eid, reason: 'ambiguous', items: getItemsByBarcodeExact(db, code) };
      }
      return { status: 'duplicate', event_id: eid, reason: existing.status };
    }

    const item = getItem(db, chosenItemId);
    const appliedAt = nowMs();
    if (!item || item.deleted === 1) {
      insertScanEvent(db, {
        event_id: eid,
        barcode: code,
        item_id: chosenItemId,
        delta: d,
        status: 'not_found',
        scanned_at: typeof scanned_at === 'number' ? scanned_at : null,
        applied_at: appliedAt
      });
      return { status: 'not_found', event_id: eid };
    }

    const updated = incrementItemQuantity(db, chosenItemId, d);
    insertScanEvent(db, {
      event_id: eid,
      barcode: code,
      item_id: chosenItemId,
      delta: d,
      status: 'applied',
      scanned_at: typeof scanned_at === 'number' ? scanned_at : null,
      applied_at: appliedAt
    });

    return { status: 'applied', event_id: eid, item: updated };
  });

  return tx();
}

export function getItemByBarcodeExact(db, barcode) {
  if (!barcode) return null;

  const viaAlt = db
    .prepare(`
      SELECT i.* FROM item_barcodes b
      JOIN items i ON i.item_id = b.item_id
      WHERE i.deleted = 0 AND b.barcode = ?
    `)
    .get(barcode);

  if (viaAlt) return viaAlt;

  const primary = db
    .prepare('SELECT * FROM items WHERE deleted = 0 AND barcode = ?')
    .get(barcode);
  return primary || null;
}

export function getItemsByBarcodeExact(db, barcode) {
  const code = String(barcode || '').trim();
  if (!code) return [];

  const viaAlt = db
    .prepare(`
      SELECT i.* FROM item_barcodes b
      JOIN items i ON i.item_id = b.item_id
      WHERE i.deleted = 0 AND b.barcode = ?
    `)
    .all(code);

  if (viaAlt.length > 0) {
    const seen = new Set();
    const out = [];
    for (const item of viaAlt) {
      if (!item) continue;
      if (seen.has(item.item_id)) continue;
      seen.add(item.item_id);
      out.push(item);
    }
    return out;
  }

  const primary = db
    .prepare('SELECT * FROM items WHERE deleted = 0 AND barcode = ? ORDER BY last_modified DESC')
    .all(code);

  const seen = new Set();
  const out = [];
  for (const item of [...primary, ...viaAlt]) {
    if (!item) continue;
    if (seen.has(item.item_id)) continue;
    seen.add(item.item_id);
    out.push(item);
  }
  return out;
}

export function incrementItemQuantity(db, itemId, delta = 1) {
  const tx = db.transaction(() => {
    const existing = getItem(db, itemId);
    if (!existing || existing.deleted === 1) return null;

    const nextQty = Math.max(0, Number(existing.quantity ?? 0) + Number(delta ?? 0));
    const lm = nowMs();
    db.prepare('UPDATE items SET quantity = ?, last_modified = ? WHERE item_id = ?').run(nextQty, lm, itemId);
    return getItem(db, itemId);
  });

  return tx();
}

export function attachBarcodeToItem(db, itemId, barcode) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('barcode_required');

  const tx = db.transaction(() => {
    const item = getItem(db, itemId);
    if (!item || item.deleted === 1) return { error: 'not_found' };

    if (item.barcode === code) {
      return { ok: true, barcode: code, item_id: itemId };
    }

    const existing = db
      .prepare('SELECT barcode, item_id FROM item_barcodes WHERE barcode = ?')
      .get(code);

    if (existing && existing.item_id !== itemId) {
      return { error: 'barcode_in_use', item_id: existing.item_id };
    }

    db.prepare('INSERT OR IGNORE INTO item_barcodes(barcode, item_id) VALUES(?, ?)').run(code, itemId);
    return { ok: true, barcode: code, item_id: itemId };
  });

  return tx();
}

export function detachBarcodeFromItem(db, itemId, barcode) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('barcode_required');

  const item = getItem(db, itemId);
  if (!item || item.deleted === 1) return { error: 'not_found' };

  const info = db
    .prepare('DELETE FROM item_barcodes WHERE item_id = ? AND barcode = ?')
    .run(itemId, code);

  if (info.changes === 0) return { error: 'not_found' };
  return { ok: true, barcode: code, item_id: itemId };
}

export function getItem(db, id) {
  return db.prepare('SELECT * FROM items WHERE item_id = ?').get(id);
}

export function createItem(db, item) {
  const normalized = normalizeItemForDb(item);
  const stmt = db.prepare(`
    INSERT INTO items(
      name, description, quantity, barcode, barcode_corrupted, category_id, location_id,
      purchase_date, warranty_info, value, serial_number, photo_path,
      deleted, last_modified
    ) VALUES(
      @name, @description, @quantity, @barcode, @barcode_corrupted, @category_id, @location_id,
      @purchase_date, @warranty_info, @value, @serial_number, @photo_path,
      0, @last_modified
    )
  `);
  const info = stmt.run(normalized);
  return getItem(db, info.lastInsertRowid);
}

export function updateItem(db, id, patch) {
  const existing = getItem(db, id);
  if (!existing) return null;

  const next = normalizeItemForDb({ ...existing, ...patch });

  db.prepare(`
    UPDATE items SET
      name=@name,
      description=@description,
      quantity=@quantity,
      barcode=@barcode,
      barcode_corrupted=@barcode_corrupted,
      category_id=@category_id,
      location_id=@location_id,
      purchase_date=@purchase_date,
      warranty_info=@warranty_info,
      value=@value,
      serial_number=@serial_number,
      photo_path=@photo_path,
      deleted=@deleted,
      last_modified=@last_modified
    WHERE item_id=@item_id
  `).run({ ...next, item_id: id });

  return getItem(db, id);
}

export function softDeleteItem(db, id) {
  const existing = getItem(db, id);
  if (!existing) return null;
  return updateItem(db, id, { deleted: 1, last_modified: nowMs() });
}

export function listCategories(db) {
  return db.prepare('SELECT * FROM categories ORDER BY name ASC').all();
}

export function createCategory(db, { name }) {
  const info = db.prepare('INSERT INTO categories(name) VALUES(?)').run(name);
  return db.prepare('SELECT * FROM categories WHERE category_id = ?').get(info.lastInsertRowid);
}

export function updateCategory(db, id, { name }) {
  db.prepare('UPDATE categories SET name = ? WHERE category_id = ?').run(name, id);
  return db.prepare('SELECT * FROM categories WHERE category_id = ?').get(id);
}

export function deleteCategory(db, id) {
  db.prepare('UPDATE items SET category_id = NULL, last_modified = ? WHERE category_id = ?').run(nowMs(), id);
  db.prepare('DELETE FROM categories WHERE category_id = ?').run(id);
}

export function listLocations(db) {
  return db.prepare('SELECT * FROM locations ORDER BY name ASC').all();
}

export function createLocation(db, { name, parent_id }) {
  const info = db
    .prepare('INSERT INTO locations(name,parent_id) VALUES(?,?)')
    .run(name, parent_id ?? null);
  return db.prepare('SELECT * FROM locations WHERE location_id = ?').get(info.lastInsertRowid);
}

export function updateLocation(db, id, { name, parent_id }) {
  db.prepare('UPDATE locations SET name = ?, parent_id = ? WHERE location_id = ?').run(
    name,
    parent_id ?? null,
    id
  );
  return db.prepare('SELECT * FROM locations WHERE location_id = ?').get(id);
}

export function deleteLocation(db, id) {
  db.prepare('UPDATE items SET location_id = NULL, last_modified = ? WHERE location_id = ?').run(nowMs(), id);
  db.prepare('DELETE FROM locations WHERE location_id = ?').run(id);
}

export function upsertManyByIdLww(db, incomingItems) {
  const tx = db.transaction(() => {
    for (const item of incomingItems) {
      if (!item || typeof item.item_id !== 'number') continue;
      const existing = getItem(db, item.item_id);
      if (!existing) {
        const normalized = normalizeItemForDb(item);
        db.prepare(`
          INSERT INTO items(
            item_id, name, description, quantity, barcode, barcode_corrupted, category_id, location_id,
            purchase_date, warranty_info, value, serial_number, photo_path,
            deleted, last_modified
          ) VALUES(
            @item_id, @name, @description, @quantity, @barcode, @barcode_corrupted, @category_id, @location_id,
            @purchase_date, @warranty_info, @value, @serial_number, @photo_path,
            @deleted, @last_modified
          )
        `).run({ ...normalized, item_id: item.item_id });
        continue;
      }

      if ((item.last_modified ?? 0) > (existing.last_modified ?? 0)) {
        updateItem(db, item.item_id, item);
      }
    }
  });

  tx();
}

export function exportSnapshot(db) {
  const categories = listCategories(db);
  const locations = listLocations(db);
  const items = db.prepare('SELECT * FROM items ORDER BY item_id ASC').all();
  const item_barcodes = db.prepare('SELECT * FROM item_barcodes ORDER BY barcode ASC').all();
  return {
    schema: 1,
    exported_at_ms: nowMs(),
    categories,
    locations,
    items,
    item_barcodes
  };
}

export function importSnapshotLww(db, snapshot) {
  const tx = db.transaction(() => {
    if (Array.isArray(snapshot.categories)) {
      for (const c of snapshot.categories) {
        if (!c?.name) continue;
        db.prepare('INSERT OR IGNORE INTO categories(name) VALUES(?)').run(String(c.name));
      }
    }

    if (Array.isArray(snapshot.locations)) {
      for (const l of snapshot.locations) {
        if (!l?.name) continue;
        db.prepare('INSERT OR IGNORE INTO locations(name,parent_id) VALUES(?,NULL)').run(String(l.name));
      }
    }

    if (Array.isArray(snapshot.items)) {
      // Validate referential integrity: nullify category/location IDs that don't exist
      const validCatIds = new Set(db.prepare('SELECT category_id FROM categories').all().map(r => r.category_id));
      const validLocIds = new Set(db.prepare('SELECT location_id FROM locations').all().map(r => r.location_id));
      const cleaned = snapshot.items.map(it => ({
        ...it,
        category_id: (it.category_id != null && validCatIds.has(it.category_id)) ? it.category_id : null,
        location_id: (it.location_id != null && validLocIds.has(it.location_id)) ? it.location_id : null
      }));
      upsertManyByIdLww(db, cleaned);
    }

    if (Array.isArray(snapshot.item_barcodes)) {
      for (const b of snapshot.item_barcodes) {
        if (!b?.barcode || typeof b?.item_id !== 'number') continue;
        const code = String(b.barcode).trim();
        if (!code) continue;
        const item = getItem(db, b.item_id);
        if (!item) continue;
        db.prepare('INSERT OR IGNORE INTO item_barcodes(barcode, item_id) VALUES(?, ?)').run(code, b.item_id);
      }
    }
  });

  tx();
}

export function appendSyncLog(db, { source, details }) {
  db.prepare('INSERT INTO sync_log(sync_time,source,details) VALUES(?,?,?)').run(
    nowMs(),
    source,
    details ? JSON.stringify(details) : null
  );
}

export function listSyncLog(db, { limit = 50 } = {}) {
  return db
    .prepare('SELECT * FROM sync_log ORDER BY sync_time DESC LIMIT ?')
    .all(limit);
}
