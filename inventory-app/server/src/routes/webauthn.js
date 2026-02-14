import express from 'express';
import crypto from 'node:crypto';
import os from 'node:os';
import { wrapRoute, sendOk, sendError, parseJsonBody } from '../http.js';
import { requireLocalNetwork } from '../middleware/ipCheck.js';
import * as webauthn from '../webauthn/index.js';
import { getServerSecret, upsertDevice, consumePairingCode, validatePairingCode, updatePairingCodeStatus } from '../stateDb.js';
import { nowMs } from '../validation.js';

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
    // Generate options for registration
    // We assume the client handles user prompting and we allow bootstrapping if allowed.
    // Simplifying for MVP: defaulting to Owner (ID 1).
    let user = { user_id: 1, username: 'Owner' };
    
    // Check for pairing token if provided
    const body = req.body || {};
    let pairingCodeObj = null;

    if (body.token) {
       // Validate but do not consume yet
       const valid = validatePairingCode(stateDb, body.token, { nowMs: nowMs() });
       if (!valid.ok) {
         console.warn('[WebAuthn] Invalid pairing token provided:', valid.error);
         return sendError(res, 401, 'invalid_token');
       }
       pairingCodeObj = valid.row;
       console.log('[WebAuthn] Pairing token valid. Updating status to scanning.');
       updatePairingCodeStatus(stateDb, body.token, 'scanned');
    } 
    
    try {
      // Use the configured RP ID (e.g., sslip.io domain) or fallback to hostname.
      // Unlike legacy NetBIOS/IP setups, we now strictly prefer the domain to ensure WebAuthn security context.
      let rpID = process.env.WEBAUTHN_RP_ID || req.hostname;
      
      console.log(`[WebAuthn] Generating registration options for rpID=${rpID}`);
      const options = await webauthn.generateRegistrationOptions({ user, rpID });
      
      // If we have a pairing code, we might want to store the challenge with it (optional), 
      // but for now relying on stateDb is enough for status tracking.
      // Could also update status to 'authenticating' if we distinguish that.
      
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
    
    // If pairing token provided, consume it now (indicates successful pairing flow completion)
    if (token) {
       const consumed = consumePairingCode(stateDb, token, { nowMs: nowMs() });
       // We log warning but don't fail verification if code is weird, unless strict security requires it.
       // However, if the code is invalid, maybe we shouldn't have allowed options?
       // For robust pairing: if token is invalid here, it means it expired or was stolen.
       if (!consumed.ok) {
           console.warn(`[WebAuthn] Pairing code '${token}' failed to consume: ${consumed.error}`);
           // We can choose to fail or proceed. Proceeding creates the credential but leaves the desktop hanging.
           // Failing seems safer for "Pairing" flow.
           return sendError(res, 401, 'pairing_code_invalid');
       }
    }

    try {
      // Use req.hostname to match what was used in registration/options
      const rpID = req.hostname; 
      // Allow the actual origin of the request, assuming it matches the hostname logic.
      const expectedOrigin = req.get('origin') || `http://${req.headers.host}`;
      
      console.log(`[WebAuthn] Verifying registration with rpID=${rpID}, origin=${expectedOrigin}`);

      const result = await webauthn.verifyRegistrationResponse({ 
          response, 
          friendlyName,
          expectedRPID: rpID,
          expectedOrigin: [expectedOrigin, 'android:apk-key-hash:VG3I2kczWKYAmCozuIBnRndiauGbQIIL4anyAWq3Dnc'] // Add android hash if needed
      });
      
      if (result.verified) {
        const credentialId = response.id; 
        console.log(`[WebAuthn] Registration verified. New Credential ID: ${credentialId}`);
        
        // Upsert standard Device Record
        upsertDevice(stateDb, {
            device_id: credentialId,
            pubkey: 'webauthn',
            name: friendlyName || 'Passkey Device',
            role: 'owner',
            nowMs: nowMs()
        });

        // Issue Token
        const secret = getServerSecret(stateDb);
        const mac = hmacSha256Hex(secret, credentialId);
        const token = `d1.${credentialId}.${mac}`;
        
        sendOk(res, { verified: true, token, cert });
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
        
        // Upsert/Ensure device record
         upsertDevice(stateDb, {
            device_id: credentialId,
            pubkey: 'webauthn',
            name: 'Passkey Device', 
            role: 'owner', 
            nowMs: nowMs()
        });

        const secret = getServerSecret(stateDb);
        const mac = hmacSha256Hex(secret, credentialId);
        const token = `d1.${credentialId}.${mac}`;
        
        sendOk(res, { verified: true, token, userId: result.userId });
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

