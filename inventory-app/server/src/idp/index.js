import { createAuthMiddleware, requireRole } from './auth.js';
import { createCoreRouter } from './routes/core.js';
import { createDevicesRouter } from './routes/devices.js';
import { createWebAuthnRouter } from './routes/webauthn.js';

/**
 * Identity Provider (IdP) module.
 *
 * Responsible for:
 * - Authentication (token validation, role enforcement)
 * - Device pairing (QR code flow, pair/exchange)
 * - Device management (list, revoke)
 * - WebAuthn / Passkey registration and authentication
 *
 * All state is stored in server-state.sqlite (the stateDb).
 */
export function createIdp({ stateDb, ownerToken, serverSecret, cert }) {
  if (!stateDb) throw new Error('createIdp: stateDb is required');
  if (!ownerToken) throw new Error('createIdp: ownerToken is required');
  if (!serverSecret) throw new Error('createIdp: serverSecret is required');

  const requireAuth = createAuthMiddleware({ ownerToken, serverSecret, stateDb });
  const requireOwner = requireRole('owner');

  // WebAuthn routes (mounted under /auth/webauthn)
  const webAuthnRouter = createWebAuthnRouter({ stateDb, cert });

  return {
    requireAuth,
    requireOwner,
    webAuthnRouter,
    // Individual route factories — mounted flat on the API router by app.js
    // to avoid nested Router layers that conflict with fake-timer test environments.
    apiRouters: [
      createCoreRouter({ ownerToken, stateDb, requireAuth }),
      createDevicesRouter({ stateDb, requireAuth, requireOwner }),
    ],
  };
}

// Re-export auth utilities so consumers can import from the idp package.
export { createAuthMiddleware, requireRole } from './auth.js';
