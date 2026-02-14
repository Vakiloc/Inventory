import express from 'express';
import cors from 'cors';

import { resolveLocaleFromRequest } from './i18n/index.js';

import {
  createAuthMiddleware,
  requireRole,
  installJsonErrorHandler,
  installSecurityMiddleware
} from './http.js';

import { createInventoryMiddleware } from './inventoryMiddleware.js';

import { createCoreRouter } from './routes/core.js';
import { createCategoriesRouter } from './routes/categories.js';
import { createLocationsRouter } from './routes/locations.js';
import { createItemsRouter } from './routes/items.js';
import { createScansRouter } from './routes/scans.js';
import { createSyncLogRouter } from './routes/syncLog.js';
import { createInventoriesRouter } from './routes/inventories.js';
import { createDevicesRouter } from './routes/devices.js';
import { createWebAuthnRouter } from './routes/webauthn.js';

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

  const requireAuth = createAuthMiddleware({ ownerToken, serverSecret, stateDb });
  const requireEdit = requireRole('editor');
  const requireOwner = requireRole('owner');

  const withInventory = createInventoryMiddleware(inventoryDbProvider);

  const api = express.Router();
  api.use(withInventory);
  api.use(createCoreRouter({ ownerToken, stateDb, requireAuth }));
  api.use(createInventoriesRouter({ inventoryDbProvider, requireAuth }));
  api.use(createDevicesRouter({ stateDb, requireAuth, requireOwner }));
  api.use(createCategoriesRouter({ requireAuth, requireEdit }));
  api.use(createLocationsRouter({ requireAuth, requireEdit }));
  api.use(createItemsRouter({ requireAuth, requireEdit }));
  api.use(createScansRouter({ requireAuth, requireEdit }));
  api.use(createSyncLogRouter({ requireAuth, requireEdit }));

  const webAuthnRouter = createWebAuthnRouter({ stateDb, cert });

  // Domain Splitting Logic
  const idpHost = process.env.IDP_HOSTNAME;
  const appHost = process.env.APP_HOSTNAME;

  if (idpHost || appHost) {
    // eslint-disable-next-line no-console
    console.log(`[Server] Split Domain Mode Active. IDP=${idpHost}, APP=${appHost}`);

    // IDP Router
    const idpRouter = express.Router();
    idpRouter.use('/auth/webauthn', webAuthnRouter);

    // App Router
    const appRouter = express.Router();
    appRouter.use('/api', api);

    app.use((req, res, next) => {
      // Shared Routes (Root CA, AssetLinks)
      if (req.path === '/root.crt' || req.path.startsWith('/.well-known/')) {
        return next();
      }

      if (req.hostname === idpHost) {
        return idpRouter(req, res, next);
      }
      if (req.hostname === appHost) {
        return appRouter(req, res, next);
      }

      // Check for local IP access (failover for Monolith-style access via IP)
      // If accessing via IP (not domain), dispatch based on path?
      // Or block? Let's allow IP access to work as Monolith for debugging/setup.
      if (!req.hostname.includes(idpHost) && !req.hostname.includes(appHost)) {
         // Fallback to monolith behavior if accessing via IP or other domain
         // But warn
         return next();
      }

      res.status(404).json({ error: 'invalid_host', message: 'Host not recognized.' });
    });

    // Fallback/Monolith attachment (reachable if next() called above)
    app.use('/auth/webauthn', webAuthnRouter);
    app.use('/api', api);

  } else {
    // Standard Monolith Mode
    app.use('/auth/webauthn', webAuthnRouter);
    app.use('/api', api);
  }

  installJsonErrorHandler(app);

  return app;
}
