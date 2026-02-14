import { migrateInventorySchema } from './db.js';
import { createApp } from './app.js';
import { openStateDb, getOwnerToken, getServerSecret } from './stateDb.js';
import { createInventoryDbProvider } from './inventoryDb.js';
import https from 'node:https';
import fs from 'node:fs';

const state = openStateDb();
const ownerToken = getOwnerToken(state.db);
const serverSecret = getServerSecret(state.db);

const inventoryDbProvider = createInventoryDbProvider({ migrateInventorySchema });

// eslint-disable-next-line no-console
console.log('inventory-server: initializing app...');

// Pre-load certificate if available, so we can pass it to the App (and WebAuthn routes)
let httpsCertData = null;
let httpsKeyData = null;

if (process.env.HTTPS_KEY_PATH && process.env.HTTPS_CERT_PATH) {
    try {
        httpsKeyData = fs.readFileSync(process.env.HTTPS_KEY_PATH);
        httpsCertData = fs.readFileSync(process.env.HTTPS_CERT_PATH);
    } catch (e) { /* ignore, handled later */ }
}

const app = createApp({
  inventoryDbProvider,
  stateDb: state.db,
  ownerToken,
  serverSecret,
  cert: httpsCertData ? httpsCertData.toString('utf8') : undefined
});

const port = Number(process.env.PORT || 5199);
let server;

if (process.env.HTTPS_PFX_PATH) {
  try {
    const pfx = fs.readFileSync(process.env.HTTPS_PFX_PATH);
    const passphrase = process.env.HTTPS_PASSPHRASE || '';
    
    server = https.createServer({ pfx, passphrase }, app).listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`inventory-server listening on https://0.0.0.0:${port}`);
    });
  } catch(err) {
     console.error('Failed to start HTTPS server with PFX, falling back:', err);
     server = app.listen(port, () => {
         // eslint-disable-next-line no-console
         console.log(`inventory-server listening on http://0.0.0.0:${port}`);
     });
  }
} else if (httpsKeyData && httpsCertData) {
  try {
    server = https.createServer({ key: httpsKeyData, cert: httpsCertData }, app).listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`inventory-server listening on https://0.0.0.0:${port}`);
    });
  } catch (err) {
    console.error('Failed to start HTTPS server, falling back using http:', err);
    server = app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`inventory-server listening on http://0.0.0.0:${port}`);
    });
  }
} else {
  server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`inventory-server listening on http://0.0.0.0:${port}`);
  });
}

// Track active sockets so shutdown can reliably release the port even if
// keep-alive connections are hanging around.
const sockets = new Set();
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeHttpServer({ gracefulMs = 500, forceMs = 1500 } = {}) {
  let closed = false;

  const closePromise = new Promise((resolve) => {
    try {
      server.close(() => {
        closed = true;
        resolve();
      });
    } catch {
      closed = true;
      resolve();
    }
  });

  // Give in-flight requests a brief chance to finish.
  await Promise.race([closePromise, delay(gracefulMs)]);

  if (!closed) {
    // If supported by the Node version, proactively close keep-alive connections.
    try {
      server.closeIdleConnections?.();
    } catch {
      // ignore
    }

    try {
      server.closeAllConnections?.();
    } catch {
      // ignore
    }

    // Fallback: end+destroy any sockets we know about.
    for (const socket of sockets) {
      try {
        socket.end();
      } catch {
        // ignore
      }
    }

    // Allow a tick for FIN to flush, then force destroy.
    await delay(50);
    for (const socket of sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
  }

  // Wait a bit longer for close to complete after forcing connections down.
  await Promise.race([closePromise, delay(forceMs)]);
}

let shuttingDown = false;
async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;

  // eslint-disable-next-line no-console
  console.log('inventory-server shutting down', reason);

  const timeout = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.warn('inventory-server shutdown timed out; forcing exit');
    process.exit(1);
  }, 3000);

  try {
    await closeHttpServer({ gracefulMs: 500, forceMs: 1500 });
  } catch {
    // ignore
  }

  try {
    inventoryDbProvider.closeAll();
  } catch {
    // ignore
  }

  try {
    legacyDb.db.close();
  } catch {
    // ignore
  }

  try {
    state.db.close();
  } catch {
    // ignore
  }

  clearTimeout(timeout);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('inventory-server uncaughtException', err);
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('inventory-server unhandledRejection', reason);
  shutdown('unhandledRejection');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    // eslint-disable-next-line no-console
    console.error(
      `inventory-server failed to start: port ${port} is already in use. ` +
        `Set PORT to a free port (example: PORT=5200).`
    );
    process.exit(1);
  }
  throw err;
});
