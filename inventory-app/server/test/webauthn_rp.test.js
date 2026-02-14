
import { vi, describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import os from 'node:os';
import { createWebAuthnRouter } from '../src/routes/webauthn.js';

const mocks = vi.hoisted(() => ({
  webAuthn: {
    generateRegistrationOptions: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
  },
  stateDb: {
    consumePairingCode: vi.fn(),
    getServerSecret: vi.fn().mockReturnValue('secret'),
    upsertDevice: vi.fn(),
  }
}));

vi.mock('../src/webauthn/index.js', () => mocks.webAuthn);
vi.mock('../src/stateDb.js', () => mocks.stateDb);

describe('WebAuthn Router RP ID Handling', () => {
    let app;
    let request;

    beforeAll(() => {
        // Setup default mock implementation
        mocks.webAuthn.generateRegistrationOptions.mockImplementation(async ({ user, rpID }) => {
            return {
                challenge: 'mock-challenge',
                rp: { name: 'InvenTory', id: rpID },
                user: { id: 'mock-id', name: user.username, displayName: user.username },
            };
        });
        mocks.stateDb.consumePairingCode.mockReturnValue({ ok: true });

        app = express();
        app.use(express.json());
        // Mount the router
        app.use('/auth/webauthn', createWebAuthnRouter({ stateDb: mocks.stateDb }));
        request = supertest(app);
    });

    it('should use request hostname for RP ID', async () => {
        const res = await request
            .post('/auth/webauthn/registration/options')
            .send({ username: 'testuser', pairingCode: '1234' })
            .set('Host', 'localhost:3000');

        expect(res.status).toBe(200);
        expect(res.body.rp.id).toBe('localhost');
    });
});
