import crypto from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { createTestContext } from './testDb.js';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

async function mintPairCode(ctx) {
  // Prefer real HTTP so remoteAddress is 127.0.0.1 and loopback checks pass.
  await ctx.startServer();
  const res = await request(ctx.baseUrl()).get('/api/admin/pair-code');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('code');
  expect(res.body).toHaveProperty('expires_at_ms');
  return res.body;
}

async function getPairCodeStatus(ctx, code) {
  await ctx.startServer();
  const res = await request(ctx.baseUrl()).get(`/api/admin/pair-code/${encodeURIComponent(code)}/status`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('status');
  return res.body;
}

describe('pairing flow', () => {
  let ctx;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-06T00:00:00.000Z'));
    ctx = createTestContext();
  });

  afterEach(() => {
    try {
      ctx?.cleanup?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it('mints a loopback-only pairing code with expiry', async () => {
    const { code, expires_at_ms } = await mintPairCode(ctx);
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(8);
    expect(expires_at_ms).toBeGreaterThan(Date.now());
    // Default TTL is 120s.
    expect(expires_at_ms).toBe(Date.now() + 120_000);
  });

  it('rejects invalid pairing codes', async () => {
    const pubkey = 'fake-pubkey-1';
    const device_id = sha256Hex(pubkey);

    const res = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code: 'nope', device_id, pubkey, name: 'Pixel' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_code');
  });

  it('enforces one-time use of pairing code', async () => {
    const { code } = await mintPairCode(ctx);

    const pubkey = 'fake-pubkey-2';
    const device_id = sha256Hex(pubkey);

    const r1 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Device A' });
    expect(r1.status).toBe(200);
    expect(r1.body).toHaveProperty('token');

    const r2 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Device A' });

    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe('already_used');
  });

  it('reports pairing code status (pending -> consumed)', async () => {
    const { code } = await mintPairCode(ctx);

    const s1 = await getPairCodeStatus(ctx, code);
    expect(s1.status).toBe('pending');
    expect(s1.expires_at_ms).toBe(Date.now() + 120_000);

    const pubkey = 'fake-pubkey-status-1';
    const device_id = sha256Hex(pubkey);
    const ex = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Status Device' });
    expect(ex.status).toBe(200);

    const s2 = await getPairCodeStatus(ctx, code);
    expect(s2.status).toBe('consumed');
    expect(typeof s2.consumed_at_ms).toBe('number');
  });

  it('reports pairing code status as expired after TTL', async () => {
    const { code, expires_at_ms } = await mintPairCode(ctx);
    vi.setSystemTime(expires_at_ms + 1);

    const s = await getPairCodeStatus(ctx, code);
    expect(s.status).toBe('expired');
    expect(s.expires_at_ms).toBe(expires_at_ms);
  });

  it('expires pairing codes (410)', async () => {
    const { code, expires_at_ms } = await mintPairCode(ctx);

    const pubkey = 'fake-pubkey-3';
    const device_id = sha256Hex(pubkey);

    vi.setSystemTime(expires_at_ms + 1);

    const res = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Late Device' });

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('expired');
  });

  it('requires device_id to equal sha256(pubkey)', async () => {
    const { code } = await mintPairCode(ctx);

    const pubkey = 'fake-pubkey-4';
    const wrongDeviceId = 'x'.repeat(64);

    const res = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id: wrongDeviceId, pubkey, name: 'Bad Device' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('device_mismatch');
  });

  it('issues deterministic device token for same device_id across multiple pairings', async () => {
    const pubkey = 'fake-pubkey-5';
    const device_id = sha256Hex(pubkey);

    const c1 = await mintPairCode(ctx);
    const r1 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code: c1.code, device_id, pubkey, name: 'Device D' });
    expect(r1.status).toBe(200);

    const c2 = await mintPairCode(ctx);
    const r2 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code: c2.code, device_id, pubkey, name: 'Device D' });
    expect(r2.status).toBe(200);

    expect(r2.body.token).toBe(r1.body.token);
    expect(r1.body.token.startsWith(`d1.${device_id}.`)).toBe(true);
    expect(r1.body.device_id).toBe(device_id);
    expect(r1.body.role).toBe('editor');
  });

  it('device token authenticates and carries inventory context via X-Inventory-Id', async () => {
    const pubkey = 'fake-pubkey-6';
    const device_id = sha256Hex(pubkey);

    const { code } = await mintPairCode(ctx);
    const ex = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Inv Device' });
    expect(ex.status).toBe(200);

    const token = ex.body.token;

    const meta = await request(ctx.app)
      .get('/api/meta')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Inventory-Id', 'default');

    expect(meta.status).toBe(200);
    expect(meta.body.inventoryId).toBe('default');
    expect(meta.headers['x-inventory-id']).toBe('default');
    expect(meta.body.auth.role).toBe('editor');
    expect(meta.body.auth.device_id).toBe(device_id);

    const invs = await request(ctx.app)
      .get('/api/inventories')
      .set('Authorization', `Bearer ${token}`);
    expect(invs.status).toBe(200);
    expect(Array.isArray(invs.body.inventories)).toBe(true);
  });

  it('returns 404 inventory_not_found for unknown X-Inventory-Id', async () => {
    const pubkey = 'fake-pubkey-7';
    const device_id = sha256Hex(pubkey);

    const { code } = await mintPairCode(ctx);
    const ex = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'Inv Device' });
    expect(ex.status).toBe(200);

    const token = ex.body.token;

    const meta = await request(ctx.app)
      .get('/api/meta')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Inventory-Id', 'does-not-exist');

    expect(meta.status).toBe(404);
    expect(meta.body.error).toBe('inventory_not_found');
  });

  it('owner can revoke a device; revoked device cannot re-pair', async () => {
    const pubkey = 'fake-pubkey-8';
    const device_id = sha256Hex(pubkey);

    const c1 = await mintPairCode(ctx);
    const ex1 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code: c1.code, device_id, pubkey, name: 'Revokable' });
    expect(ex1.status).toBe(200);

    // Owner revokes the device.
    const revoke = await request(ctx.app)
      .post(`/api/devices/${device_id}/revoke`)
      .set(ctx.authHeader)
      .send({ revoked: true });
    expect(revoke.status).toBe(200);
    expect(revoke.body.revoked).toBe(true);

    const c2 = await mintPairCode(ctx);
    const ex2 = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code: c2.code, device_id, pubkey, name: 'Revokable' });

    expect(ex2.status).toBe(403);
    expect(ex2.body.error).toBe('revoked');
  });

  it('device token cannot access owner-only device listing', async () => {
    const pubkey = 'fake-pubkey-9';
    const device_id = sha256Hex(pubkey);

    const { code } = await mintPairCode(ctx);
    const ex = await request(ctx.app)
      .post('/api/pair/exchange')
      .send({ code, device_id, pubkey, name: 'NonOwner' });
    expect(ex.status).toBe(200);

    const token = ex.body.token;

    const list = await request(ctx.app)
      .get('/api/devices')
      .set('Authorization', `Bearer ${token}`);

    // Authenticated but not owner.
    expect(list.status).toBe(403);
    expect(list.body.error).toBe('forbidden');
  });
});
