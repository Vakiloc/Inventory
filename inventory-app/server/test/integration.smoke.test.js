import { afterEach, describe, expect, it } from 'vitest';

import { createTestContext } from './testDb.js';

let ctx;
afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
});

async function jsonFetch(url, { method = 'GET', headers, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : null),
      ...(headers || {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  return { status: res.status, body: parsed };
}

describe('integration smoke (real HTTP)', () => {
  it('boots and serves authenticated endpoints over HTTP', async () => {
    ctx = createTestContext();
    await ctx.startServer();
    const base = ctx.baseUrl();

    const ping = await jsonFetch(`${base}/api/ping`);
    expect(ping.status).toBe(200);
    expect(ping.body.ok).toBe(true);

    const meta401 = await jsonFetch(`${base}/api/meta`);
    expect(meta401.status).toBe(401);

    const meta = await jsonFetch(`${base}/api/meta`, { headers: ctx.authHeader });
    expect(meta.status).toBe(200);
    expect(typeof meta.body.serverTimeMs).toBe('number');

    const created = await jsonFetch(`${base}/api/items`, {
      method: 'POST',
      headers: ctx.authHeader,
      body: { name: 'Smoke Item', quantity: 1 }
    });
    expect(created.status).toBe(200);
    expect(created.body.item.name).toBe('Smoke Item');

    const listed = await jsonFetch(`${base}/api/items?q=Smoke`, { headers: ctx.authHeader });
    expect(listed.status).toBe(200);
    expect(listed.body.items.length).toBe(1);
  });
});
