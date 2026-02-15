import express from 'express';
import cors from 'cors';

import { resolveLocaleFromRequest } from './i18n/index.js';
import { installJsonErrorHandler, installSecurityMiddleware } from './http.js';

import { createIdp } from './idp/index.js';
import { requireRole } from './idp/auth.js';
import { createInventoryRouters } from './inventory/index.js';
import { createInventoryMiddleware } from './inventory/middleware.js';

export function createApp({ inventoryDbProvider, stateDb, ownerToken, serverSecret, cert }) {
  if (!inventoryDbProvider) throw new Error('createApp: inventoryDbProvider is required');
  if (!stateDb) throw new Error('createApp: stateDb is required');
  if (!ownerToken) throw new Error('createApp: ownerToken is required');
  if (!serverSecret) throw new Error('createApp: serverSecret is required');

  const app = express();
  installSecurityMiddleware(app);
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));

  // Serve Root CA for Android Trust (Bootstrap)
  app.get('/root.crt', (req, res) => {
    const caPath = process.env.INVENTORY_ROOT_CA_PATH;
    if (caPath) {
       res.download(caPath, 'root.crt');
    } else {
       res.status(404).send('Root CA not configured on server.');
    }
  });

  // Serve Asset Links for Android WebAuthn (App Linking)
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const sha256 = process.env.ANDROID_DEBUG_SHA256 || "54:6D:C8:DA:47:33:58:A6:00:98:2A:33:B8:80:67:46:77:62:6A:E1:9B:40:82:0B:E1:A9:F2:01:6A:B7:0E:77";
    console.log('[Server] Served assetlinks.json with SHA:', sha256);
    res.json([{
      "relation": ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      "target": {
        "namespace": "android_app",
        "package_name": "com.inventory.android",
        "sha256_cert_fingerprints": [
          sha256
        ]
      }
    }]);
  });

  app.use((req, res, next) => {
    res.locals.locale = resolveLocaleFromRequest(req);
    next();
  });

  // ── Identity Provider (IdP) ──────────────────────────────────────────
  // Handles: authentication, device pairing, WebAuthn/passkey management.
  // All state stored in server-state.sqlite.
  const idp = createIdp({ stateDb, ownerToken, serverSecret, cert });

  // ── Inventory App ────────────────────────────────────────────────────
  // Handles: item/category/location CRUD, barcode scanning, sync.
  // Auth middleware is provided by the IdP; data stored in inventory.sqlite.
  const requireEdit = requireRole('editor');
  const inventoryRouters = createInventoryRouters({
    inventoryDbProvider,
    requireAuth: idp.requireAuth,
    requireEdit
  });

  // ── Route Mounting ───────────────────────────────────────────────────
  // All route routers are mounted flat on the API router (no extra nesting)
  // to match Express's routing expectations and avoid issues with
  // setImmediate in sub-router fallthrough.
  const api = express.Router();
  api.use(createInventoryMiddleware(inventoryDbProvider));
  for (const r of idp.apiRouters) api.use(r);
  for (const r of inventoryRouters) api.use(r);

  // Domain Splitting Logic
  const idpHost = process.env.IDP_HOSTNAME;
  const appHost = process.env.APP_HOSTNAME;

  if (idpHost || appHost) {
    console.log(`[Server] Split Domain Mode Active. IDP=${idpHost}, APP=${appHost}`);

    // IDP Router
    const idpDomainRouter = express.Router();
    idpDomainRouter.use('/auth/webauthn', idp.webAuthnRouter);

    // App Router
    const appDomainRouter = express.Router();
    appDomainRouter.use('/api', api);

    app.use((req, res, next) => {
      // Shared Routes (Root CA, AssetLinks)
      if (req.path === '/root.crt' || req.path.startsWith('/.well-known/')) {
        return next();
      }

      if (req.hostname === idpHost) {
        return idpDomainRouter(req, res, next);
      }
      if (req.hostname === appHost) {
        return appDomainRouter(req, res, next);
      }

      if (req.hostname !== idpHost && req.hostname !== appHost) {
         return next();
      }

      res.status(404).json({ error: 'invalid_host', message: 'Host not recognized.' });
    });

    // Fallback/Monolith attachment (reachable if next() called above)
    app.use('/auth/webauthn', idp.webAuthnRouter);
    app.use('/api', api);

  } else {
    // Standard Monolith Mode
    app.use('/auth/webauthn', idp.webAuthnRouter);
    app.use('/api', api);
  }

  installJsonErrorHandler(app);

  return app;
}
