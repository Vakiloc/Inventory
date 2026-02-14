import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createTestContext } from './testDb.js';

let ctx;

afterEach(() => {
  if (ctx) ctx.cleanup();
  ctx = undefined;
  vi.unstubAllEnvs();
});

describe('Network Overhaul Tests', () => {
    it('GET /root.crt returns 404 by default', async () => {
        vi.stubEnv('INVENTORY_ROOT_CA_PATH', ''); 
        ctx = createTestContext();
        const res = await request(ctx.app).get('/root.crt');
        expect(res.status).toBe(404);
    });

    it('GET /root.crt returns file when INVENTORY_ROOT_CA_PATH is set', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-cert-test-'));
        const certPath = path.join(tmpDir, 'test-root.crt');
        fs.writeFileSync(certPath, '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----');
        
        vi.stubEnv('INVENTORY_ROOT_CA_PATH', certPath);
        
        ctx = createTestContext();
        const res = await request(ctx.app).get('/root.crt');
        expect(res.status).toBe(200);
        expect(res.text).toContain('FAKE');
        expect(res.header['content-disposition']).toContain('root.crt');

        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            // ignore cleanup errors
        }
    });

    it('GET /api/ping has security headers', async () => {
        ctx = createTestContext();
        const res = await request(ctx.app).get('/api/ping');
        expect(res.status).toBe(200);
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['strict-transport-security']).toBeDefined();
        // HSTS might vary, but we expect it to be present.
    });

    it('POST /auth/webauthn/registration/options uses WEBAUTHN_RP_ID', async () => {
        vi.stubEnv('WEBAUTHN_RP_ID', 'example.com');
        ctx = createTestContext();
        
        const res = await request(ctx.app)
            .post('/auth/webauthn/registration/options')
            .send({});
            
        expect(res.status).toBe(200);
        expect(res.body.rp).toBeDefined();
        expect(res.body.rp.id).toBe('example.com');
    });
});
