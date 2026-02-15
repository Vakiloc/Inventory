import express from 'express';
import crypto from 'node:crypto';
import { wrapRoute, sendOk, sendError } from '../../http.js';
import { requireLocalNetwork } from '../ipCheck.js';
import * as webauthn from '../webauthn.js';
import { getServerSecret, upsertDevice, consumePairingCode, validatePairingCode, updatePairingCodeStatus } from '../stateDb.js';
import { nowMs } from '../../validation.js';

function hmacSha256Hex(secret, message) {
  return crypto.createHmac('sha256', String(secret)).update(String(message)).digest('hex');
}

export function createWebAuthnRouter({ stateDb, cert }) {
  const router = express.Router();

  // Registration Cancel (by client)
  router.post('/registration/cancel', wrapRoute(async (req, res) => {
    const body = req.body || {};
    if (body.token) {
       console.log('[WebAuthn] Client cancelled registration for token', body.token);
       updatePairingCodeStatus(stateDb, body.token, 'cancelled');
    }
    sendOk(res, { ok: true });
  }));

  // Registration Options (Restricted to Local Network)
  router.post('/registration/options', requireLocalNetwork, wrapRoute(async (req, res) => {
    console.log('[WebAuthn] /registration/options request');
    let user = { user_id: 1, username: 'Owner' };

    const body = req.body || {};

    if (body.token) {
       const valid = validatePairingCode(stateDb, body.token, { nowMs: nowMs() });
       if (!valid.ok) {
         console.warn('[WebAuthn] Invalid pairing token provided:', valid.error);
         return sendError(res, 401, 'invalid_token');
       }
       console.log('[WebAuthn] Pairing token valid. Updating status to scanning.');
       updatePairingCodeStatus(stateDb, body.token, 'scanned');
    }

    try {
      let rpID = process.env.WEBAUTHN_RP_ID || req.hostname;

      console.log(`[WebAuthn] Generating registration options for rpID=${rpID}`);
      const options = await webauthn.generateRegistrationOptions({ user, rpID });

      sendOk(res, options);
    } catch (err) {
      console.error('[WebAuthn] Error generating registration options:', err);
      sendError(res, 500, 'registration_options_failed');
    }
  }));

  // Registration Verify (Restricted to Local Network)
  router.post('/registration/verify', requireLocalNetwork, wrapRoute(async (req, res) => {
    const { response, friendlyName, token } = req.body;
    console.log(`[WebAuthn] /registration/verify request. FriendlyName='${friendlyName}'`);

    if (token) {
       const consumed = consumePairingCode(stateDb, token, { nowMs: nowMs() });
       if (!consumed.ok) {
           console.warn(`[WebAuthn] Pairing code '${token}' failed to consume: ${consumed.error}`);
           return sendError(res, 401, 'pairing_code_invalid');
       }
    }

    try {
      const rpID = process.env.WEBAUTHN_RP_ID || req.hostname;
      const expectedOrigin = req.get('origin') || `http://${req.headers.host}`;

      console.log(`[WebAuthn] Verifying registration with rpID=${rpID}, origin=${expectedOrigin}`);

      const result = await webauthn.verifyRegistrationResponse({
          response,
          friendlyName,
          expectedRPID: rpID,
          expectedOrigin: [expectedOrigin, 'android:apk-key-hash:VG3I2kczWKYAmCozuIBnRndiauGbQIIL4anyAWq3Dnc']
      });

      if (result.verified) {
        const credentialId = response.id;
        console.log(`[WebAuthn] Registration verified. New Credential ID: ${credentialId}`);

        upsertDevice(stateDb, {
            device_id: credentialId,
            pubkey: 'webauthn',
            name: friendlyName || 'Passkey Device',
            role: 'owner',
            nowMs: nowMs()
        });

        const secret = getServerSecret(stateDb);
        const mac = hmacSha256Hex(secret, credentialId);
        const deviceToken = `d1.${credentialId}.${mac}`;

        sendOk(res, { verified: true, token: deviceToken, cert });
      } else {
        console.warn('[WebAuthn] Registration verification failed (result.verified=false)');
        sendError(res, 400, 'verification_failed');
      }
    } catch (err) {
      console.error('[WebAuthn] Registration verify exception:', err);
      sendError(res, 400, err.message);
    }
  }));

  // Authentication Options
  router.post('/authentication/options', wrapRoute(async (req, res) => {
    console.log('[WebAuthn] /authentication/options request');
    try {
      const options = await webauthn.generateAuthenticationOptions();
      sendOk(res, options);
    } catch (err) {
      console.error('[WebAuthn] Auth options error:', err);
      sendError(res, 500, 'authentication_options_failed');
    }
  }));

  // Authentication Verify
  router.post('/authentication/verify', wrapRoute(async (req, res) => {
    console.log('[WebAuthn] /authentication/verify request');
    const { response } = req.body;

    try {
      const result = await webauthn.verifyAuthenticationResponse({ response });
      if (result.verified) {
        const credentialId = response.id;

        upsertDevice(stateDb, {
            device_id: credentialId,
            pubkey: 'webauthn',
            name: 'Passkey Device',
            role: 'owner',
            nowMs: nowMs()
        });

        const secret = getServerSecret(stateDb);
        const mac = hmacSha256Hex(secret, credentialId);
        const deviceToken = `d1.${credentialId}.${mac}`;

        sendOk(res, { verified: true, token: deviceToken, userId: result.userId });
      } else {
        sendError(res, 400, 'verification_failed');
      }
    } catch (err) {
        console.error(err);
        sendError(res, 400, err.message);
    }
  }));

  return router;
}
