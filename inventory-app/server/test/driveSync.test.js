import { afterEach, describe, expect, it } from 'vitest';

import { createTestContext } from './testDb.js';
import { createItem, listItems, listSyncLog } from '../src/repo.js';
import {
  pullSnapshotFromDriveWithDeps,
  pushSnapshotToDriveWithDeps
} from '../src/drive/driveSync.js';

function createFakeDrive() {
  const filesById = new Map(); // id -> { id, name, body }
  let nextId = 1;

  function findByName(name) {
    for (const f of filesById.values()) {
      if (f.name === name) return f;
    }
    return null;
  }

  return {
    files: {
      async list() {
        // We ignore "q" parsing in tests; the implementation only needs to return files with id/name.
        return {
          data: {
            files: Array.from(filesById.values()).map(({ id, name }) => ({ id, name }))
          }
        };
      },
      async create({ requestBody }) {
        const id = String(nextId++);
        filesById.set(id, { id, name: requestBody?.name, body: '', version: 1, modifiedTime: new Date().toISOString() });
        return { data: { id } };
      },
      async update({ fileId, media }) {
        const existing = filesById.get(String(fileId));
        if (!existing) throw new Error('fake_drive_missing_file');
        existing.body = typeof media?.body === 'string' ? media.body : String(media?.body ?? '');
        existing.version = Number(existing.version || 1) + 1;
        existing.modifiedTime = new Date().toISOString();
        return { data: { id: String(fileId) } };
      },
      async get({ fileId, alt, fields }) {
        const existing = filesById.get(String(fileId));
        if (!existing) throw new Error('fake_drive_missing_file');

        // metadata request
        if (!alt && fields) {
          return {
            data: {
              id: existing.id,
              name: existing.name,
              version: existing.version,
              modifiedTime: existing.modifiedTime
            }
          };
        }

        // media request
        return { data: Buffer.from(existing.body, 'utf8') };
      }
    },

    // helper for assertions
    _getByName(name) {
      return findByName(name);
    }
  };
}

let ctx;
afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
});

describe('drive sync (offline unit tests)', () => {
  it('push writes snapshot JSON and appends sync log', async () => {
    ctx = createTestContext();
    const drive = createFakeDrive();

    createItem(ctx.db, { name: 'Drive Push Item', quantity: 1, barcode: 'DRV-PUSH' });

    const res = await pushSnapshotToDriveWithDeps({
      drive,
      db: ctx.db,
      filename: 'inventory-sync.test.json'
    });

    expect(res.ok).toBe(true);
    expect(res.fileId).toBeTruthy();
    expect(typeof res.remoteVersion).toBe('number');

    const file = drive._getByName('inventory-sync.test.json');
    expect(file).not.toBeNull();

    const snapshot = JSON.parse(file.body);
    expect(snapshot.schema).toBe(1);
    expect(snapshot.items.some(i => i.name === 'Drive Push Item')).toBe(true);

    const log = listSyncLog(ctx.db, { limit: 10 });
    expect(log.some(e => e.source === 'drive_push')).toBe(true);
  });

  it('pull imports snapshot into DB and appends sync log', async () => {
    // First DB pushes
    const drive = createFakeDrive();
    const ctx1 = createTestContext();
    try {
      createItem(ctx1.db, { name: 'Drive Pull Item', quantity: 3, barcode: 'DRV-PULL' });
      await pushSnapshotToDriveWithDeps({ drive, db: ctx1.db, filename: 'inventory-sync.test.json' });
    } finally {
      ctx1.cleanup();
    }

    // Second DB pulls
    ctx = createTestContext();
    const before = listItems(ctx.db, { includeDeleted: true });
    expect(before.length).toBe(0);

    const res = await pullSnapshotFromDriveWithDeps({
      drive,
      db: ctx.db,
      filename: 'inventory-sync.test.json'
    });

    expect(res.ok).toBe(true);
    expect(res.fileId).toBeTruthy();
    expect(typeof res.remoteVersion).toBe('number');

    const after = listItems(ctx.db, { includeDeleted: true });
    expect(after.some(i => i.barcode === 'DRV-PULL')).toBe(true);

    const log = listSyncLog(ctx.db, { limit: 10 });
    expect(log.some(e => e.source === 'drive_pull')).toBe(true);
  });

  it('detects conflict when expectedVersion is stale', async () => {
    ctx = createTestContext();
    const drive = createFakeDrive();

    createItem(ctx.db, { name: 'Conflict Item', quantity: 1 });
    const first = await pushSnapshotToDriveWithDeps({
      drive,
      db: ctx.db,
      filename: 'inventory-sync.conflict.json'
    });
    expect(first.ok).toBe(true);
    const expectedVersion = first.remoteVersion;

    // Simulate someone else updating the remote file
    await drive.files.update({
      fileId: first.fileId,
      media: { mimeType: 'application/json', body: JSON.stringify({ schema: 1, items: [] }) }
    });

    const second = await pushSnapshotToDriveWithDeps({
      drive,
      db: ctx.db,
      filename: 'inventory-sync.conflict.json',
      expectedVersion
    });
    expect(second.ok).toBe(false);
    expect(second.error).toBe('conflict');
    expect(second.expectedVersion).toBe(expectedVersion);
    expect(typeof second.remoteVersion).toBe('number');
    expect(second.remoteVersion).not.toBe(expectedVersion);
  });
});
