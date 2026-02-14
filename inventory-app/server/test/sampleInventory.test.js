import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import request from 'supertest';

import { createTestContext } from './testDb.js';

function loadSampleSnapshot() {
  const samplePath = fileURLToPath(new URL('../../docs/sample-inventory.json', import.meta.url));
  const raw = fs.readFileSync(samplePath, 'utf8');
  return JSON.parse(raw);
}

describe('sample inventory snapshot', () => {
  it('imports docs/sample-inventory.json and makes items queryable', async () => {
    const ctx = createTestContext();
    try {
      const snapshot = loadSampleSnapshot();

      const imported = await request(ctx.app)
        .post('/api/import')
        .set(ctx.authHeader)
        .send(snapshot);

      expect(imported.status).toBe(200);
      expect(imported.body.ok).toBe(true);

      const listed = await request(ctx.app)
        .get('/api/items?q=Sample%20-%20')
        .set(ctx.authHeader);

      expect(listed.status).toBe(200);
      expect(Array.isArray(listed.body.items)).toBe(true);
      expect(listed.body.items.length).toBeGreaterThanOrEqual(4);

      const barcoded = await request(ctx.app)
        .get('/api/items?q=SAMPLE-CHARGER-001')
        .set(ctx.authHeader);

      expect(barcoded.status).toBe(200);
      expect(barcoded.body.items.some(i => i.barcode === 'SAMPLE-CHARGER-001')).toBe(true);
    } finally {
      ctx.cleanup();
    }
  });
});
