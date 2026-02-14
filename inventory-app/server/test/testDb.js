import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { migrateInventorySchema } from '../src/inventory/db.js';
import { createApp } from '../src/app.js';
import { createInventoryDbProvider } from '../src/inventory/inventoryDb.js';
import { getOwnerToken, getServerSecret, openStateDb } from '../src/idp/stateDb.js';
import { setStateDb } from '../src/idp/webauthnDb.js';

export function createTestContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-server-test-'));
  const prior = process.env.INVENTORY_DATA_DIR;
  process.env.INVENTORY_DATA_DIR = dir;

  const state = openStateDb();
  const ownerToken = getOwnerToken(state.db);
  const serverSecret = getServerSecret(state.db);

  // Initialize WebAuthn DB so credentials are stored in the stateDb.
  setStateDb(state.db);

  const inventoryDbProvider = createInventoryDbProvider({ migrateInventorySchema });
  const { db, dbPath } = inventoryDbProvider.getDbForInventory('default');

  const app = createApp({
    inventoryDbProvider,
    stateDb: state.db,
    ownerToken,
    serverSecret
  });

  let server;

  async function startServer() {
    if (server) return server;
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
      s.on('error', reject);
    });
    return server;
  }

  function baseUrl() {
    if (!server) throw new Error('Server not started; call startServer() first');
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    if (!port) throw new Error('Unable to determine server port');
    return `http://127.0.0.1:${port}`;
  }

  function cleanup() {
    try {
      server?.close();
    } catch {
      // ignore
    }
    try {
      inventoryDbProvider.closeAll();
    } catch {
      // ignore
    }
    try {
      state.db.close();
    } catch {
      // ignore
    }
    if (prior === undefined) delete process.env.INVENTORY_DATA_DIR;
    else process.env.INVENTORY_DATA_DIR = prior;

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  return {
    app,
    db,
    dbPath,
    ownerToken,
    dir,
    authHeader: { Authorization: `Bearer ${ownerToken}` },
    startServer,
    baseUrl,
    cleanup
  };
}
