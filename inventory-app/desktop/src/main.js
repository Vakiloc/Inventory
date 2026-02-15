import { app, BrowserWindow, ipcMain, Menu, session, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync, exec } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Bonjour } from 'bonjour-service';
import { createRequire } from 'node:module';
import { issueServerCert, getRootCertPath } from './keystore.js';
import { detectLocalIp, getSslipDomain, configureServerEnv } from './serverConfig.js';

const require = createRequire(import.meta.url);

let ngrok;
try {
  ngrok = require('ngrok');
} catch (e) {
  // ngrok optional or failed to load
}

// --- WebAuthn Dev Setup: Check/Create Keystore and Inject SHA256 ---
let devInitPromise = Promise.resolve();
if (!app.isPackaged) {
  // We still run dev-init for SHA/Debug keys if needed for Android
  // But we also have the new production Keystore logic
  console.log('[Main] Running in Dev Mode. Queuing Keystore checks...');
  devInitPromise = import('../scripts/dev-init.js')
    .then(() => console.log('[Main] Dev Init Complete'))
    .catch(e => console.error('[Main] Failed to run dev-init:', e));
}


// -------------------------------------------------------------------

// Cleanup previously added dangling promise
// (Removed stale app.whenReady block)

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('unhandledRejection', reason);
});

const trustedCertCache = new Set();

// Allow self-signed certificates for localhost and user-trusted hosts
app.on('certificate-error', async (event, webContents, url, error, certificate, callback) => {
  // Always automatically allow localhost/loopback and local sslip.io domains
  if (
    url.startsWith('https://localhost') ||
    url.startsWith('https://127.0.0.1') ||
    url.startsWith('https://0.0.0.0') ||
    url.includes('.sslip.io')
  ) {
    event.preventDefault();
    callback(true);
    return;
  }

  // Check cache
  const certFingerprint = certificate.fingerprint;
  if (trustedCertCache.has(certFingerprint)) {
    event.preventDefault();
    callback(true);
    return;
  }

  // Prevent default behavior (which is to cancel/block) and wait for user decision
  event.preventDefault();

  try {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Trust & Connect'],
      defaultId: 0,
      cancelId: 0,
      title: 'Security Warning',
      message: `The server's security certificate is not trusted (Error: ${error}).`,
      detail: `URL: ${url}\nFingerprint: ${certFingerprint}\n\nThis is expected if you are connecting to your own local Inventory Server.\nDo you want to trust this certificate for this session?`
    });

    if (response === 1) {
      trustedCertCache.add(certFingerprint);
      callback(true);
    } else {
      callback(false);
    }
  } catch (err) {
    console.error('Certificate dialog error:', err);
    callback(false);
  }
});


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_PORT = Number(process.env.INVENTORY_PORT || 443);
const SERVER_URL = process.env.INVENTORY_SERVER_URL || `https://localhost:${SERVER_PORT}`;

let serverProc;
let serverProcDataDir = null;
let mainWindow = null;
let isQuitting = false;
let quitCleanupInProgress = false;
let bonjourInstance = null;
let ngrokUrl = null;

async function toggleRemoteTunnel(enable) {
  if (!ngrok) {
    console.warn('Ngrok module not available');
    return false;
  }
  
  // We need to know if we are HTTPS to tell Ngrok proper address?
  // If we are strictly HTTPS, we should ensure ngrok tunnel points to https://localhost:5199
  // ngrok node wrapper connect(): { addr: 'https://localhost:PORT' } usually implies to ngrok to skip verify or expect TLS.
  // Actually, ngrok standard is "addr: 5199" -> HTTP.
  // "addr: https://localhost:5199" -> HTTPS.
  
  const target = `https://localhost:${SERVER_PORT}`;

  try {
    if (enable) {
      if (ngrokUrl) return true; // Already running
      console.log('[Ngrok] Starting tunnel...');
      
      const opts = { addr: target };
      
      // Check for existing tunnels on port 4040 (default ngrok API)
      try {
         const response = await fetch('http://127.0.0.1:4040/api/tunnels').catch(() => null);
         if (response && response.ok) {
             const data = await response.json();
             // Look for a tunnel pointing to our SERVER_PORT
             const existingTunnel = data.tunnels.find(t => t.config && t.config.addr.endsWith(':' + SERVER_PORT));
             if (existingTunnel) {
                 console.log('[Ngrok] Found existing tunnel for port ' + SERVER_PORT + ': ' + existingTunnel.public_url);
                 ngrokUrl = existingTunnel.public_url;
             }
         }
      } catch (e) { 
        // Ignore errors checking for existing tunnels
      }

      if (!ngrokUrl) {
          // Attempt connection
          console.log('[Ngrok] connecting with options:', JSON.stringify(opts));
          try {
            ngrokUrl = await ngrok.connect(opts);
          } catch (err) {
            const isExistsError = err?.body?.details?.err?.includes('already exists') 
                || err?.message?.includes('already exists')
                || (typeof err === 'string' && err.includes('already exists'));

            if (isExistsError) {
                console.log('[Ngrok] Tunnel collision detected. Killing stale ngrok process and retrying...');
                await ngrok.kill();
                await new Promise(r => setTimeout(r, 1000));
                ngrokUrl = await ngrok.connect(opts);
            } else {
                throw err;
            }
          }
          console.log('[Ngrok] Tunnel established:', ngrokUrl);
      }
    } else {
      if (!ngrokUrl) return true; // Already stopped
      await ngrok.disconnect();
      await ngrok.kill();
      ngrokUrl = null;
      console.log('[Ngrok] Tunnel stopped');
    }

    // Restart logic to pick up new RP_ID
    if (serverProcDataDir && !process.env.INVENTORY_SERVER_URL) {
      console.log('[Ngrok] Restarting server to update RP_ID configuration...');
      await restartLocalServerWithDataDir(serverProcDataDir);
    }
    
    // Refresh UI to show new pairing URL if dialog is open (triggering a reload or event)
    if (mainWindow) {
       mainWindow.webContents.send('tunnel-status-changed', { active: !!ngrokUrl, url: ngrokUrl });
    }

    return true;
  } catch (err) {
    console.error('[Ngrok] Error toggling tunnel:', err);
    console.error('[Ngrok] Detail:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    
    let userMsg = `Failed to ${enable ? 'start' : 'stop'} tunnel: ${err.message}`;
    if (err.message.includes('ECONNREFUSED')) {
       userMsg += "\n\nTip: The ngrok agent might be failing to start. Check if 'ngrok' is installed/authed or if another instance is blocking port 4040.";
    }
    
    if (mainWindow) {
        dialog.showErrorBox('Remote Tunnel Error', userMsg);
    }
    return false;
  }
}

function requestAppQuit(reason) {
  // eslint-disable-next-line no-console
  console.warn(`electron: quit requested (${reason})`);

  // Cleanup Bonjour
  if (bonjourInstance) {
     try {
       bonjourInstance.unpublishAll();
       bonjourInstance.destroy();
     } catch (e) { /* ignore */ }
  }
  
  // Cleanup Ngrok
  if (ngrokUrl && ngrok) {
      try {
        ngrok.disconnect();
        ngrok.kill();
      } catch (e) { /* ignore */ }
  }

  // If Electron isn't ready yet, wait until it is.
  if (!app.isReady()) {
    app.once('ready', () => app.quit());
    return;
  }

  app.quit();
}

process.on('SIGINT', () => requestAppQuit('SIGINT'));
process.on('SIGTERM', () => requestAppQuit('SIGTERM'));


function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function registryPath() {
  return path.join(app.getPath('userData'), 'inventories.json');
}

function inventoriesRoot() {
  return path.join(app.getPath('userData'), 'inventories');
}

function loadRegistry() {
  const p = registryPath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.inventories) && typeof parsed.activeId === 'string') {
      for (const inv of parsed.inventories) {
        if (inv?.dataDir) ensureDir(inv.dataDir);
      }
      return parsed;
    }
  } catch {
    // ignore
  }

  const root = inventoriesRoot();
  ensureDir(root);
  const defaultId = 'default';
  const defaultDir = path.join(root, defaultId);
  ensureDir(defaultDir);
  const reg = {
    activeId: defaultId,
    inventories: [{ id: defaultId, name: 'Default', dataDir: defaultDir }]
  };
  fs.writeFileSync(p, JSON.stringify(reg, null, 2), 'utf8');
  return reg;
}

function saveRegistry(reg) {
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), 'utf8');
}

function findActiveInventory(reg) {
  const inv = reg.inventories.find(i => i.id === reg.activeId) || reg.inventories[0];
  return inv || null;
}

function newInventoryId() {
  return crypto.randomBytes(8).toString('hex');
}

function loadUserConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load user config:', err);
  }
  return {};
}

async function isServerReachable(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/ping`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startServerIfLocal() {
  if (process.env.INVENTORY_SERVER_URL) return; // external server provided

  // If another inventory server is already running (dev, previous Electron run, etc.),
  // reuse it instead of failing with EADDRINUSE.
  if (await isServerReachable(SERVER_URL)) {
    // eslint-disable-next-line no-console
    console.log(`Using existing inventory server at ${SERVER_URL}`);
    return;
  }

  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', '..', 'server');
  const serverEntry = path.join(serverRoot, 'src', 'index.js');

  const reg = loadRegistry();
  const active = findActiveInventory(reg);
  if (!active) throw new Error('No active inventory');

  // --- Dynamic Cert Generation (Network Overhaul) ---
  // 1. Detect Local IP
  const localIp = detectLocalIp();
  const sslipDomain = getSslipDomain(localIp);
  console.log(`[Main] Detected Local IP: ${localIp}. Using Domain: ${sslipDomain}`);

  const userConfig = loadUserConfig();
  const useCustomCert = userConfig.httpsKey && userConfig.httpsCert;

  if (useCustomCert) {
    console.log('[Main] Using custom SSL keys from config');
  } else {
    // Log the config path to help the user
    const cfgPath = path.join(app.getPath('userData'), 'config.json');
    console.log(`[Main] No custom certs found. To use your own (e.g. Let's Encrypt), create: ${cfgPath}`);
    console.log(`With content: { "httpsKey": "path/to/key.pem", "httpsCert": "path/to/cert.pem", "hostname": "your.domain.com" }`);
  }

  // 2. Issue Cert
  let pfxBuffer;
  if (!useCustomCert) {
    try {
        pfxBuffer = issueServerCert(localIp);
    } catch (err) {
        console.error('[Main] Failed to issue server cert:', err);
        // Fallback or exit? If we can't issue a cert, we can't run HTTPS safely.
        // But maybe we should try 127.0.0.1 as fallback?
        // For now, let's throw/return to avoid unsecure connection confusion.
        return;
    }
  } else {
    console.log('[Main] Using custom SSL keys from config');
  }

  // Option A packaging: in packaged builds we run the server under Electron's Node
  // (ELECTRON_RUN_AS_NODE=1) and rebuild native deps for Electron at package time.
  const nodeExec = app.isPackaged
    ? process.execPath
    : (process.env.INVENTORY_NODE || process.env.npm_node_execpath || process.execPath);

  // eslint-disable-next-line no-console
  console.log('electron: spawning server', { nodeExec, serverEntry, serverRoot });

  const tempPfxPath = path.join(app.getPath('userData'), 'temp_server.pfx');
  if (pfxBuffer) {
     fs.writeFileSync(tempPfxPath, pfxBuffer);
  }

  serverProcDataDir = active.dataDir;

  const env = configureServerEnv({
    processEnv: process.env,
    isPackaged: app.isPackaged,
    serverPort: SERVER_PORT,
    dataDir: active.dataDir,
    registryPath: registryPath(),
    serverStateDir: app.getPath('userData'),
    pfxPath: useCustomCert ? undefined : tempPfxPath,
    pfxPass: '',
    sslCert: useCustomCert ? userConfig.httpsCert : undefined,
    sslKey: useCustomCert ? userConfig.httpsKey : undefined,
    rootCaPath: getRootCertPath(),
    androidDebugSha256: process.env.ANDROID_DEBUG_SHA256,
    webAuthnRpId: ngrokUrl ? new URL(ngrokUrl).hostname : (userConfig.idpHostname || userConfig.hostname || sslipDomain),
    nodeExec,
    execPath: process.execPath
  });

  serverProc = spawn(nodeExec, [serverEntry], {
    env,
    cwd: serverRoot,
    stdio: 'inherit',
    windowsHide: true
  });

  serverProc.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log('server exited', code);
  });
  
  // Publish mDNS service to ensure .local resolution works on Android
  try {
     const hostname = os.hostname();
     const name = `inventory-${hostname}`; // Ensure unique-ish name
     const type = 'http';
     
     // Advertise the service. This often triggers the OS or the library to respond to mDNS queries.
     // Windows 10+ usually handles mDNS if enabled, but this library provides an explicit responder
     // if the OS is not doing it for us.
     // Note: We are publishing the *service* _http._tcp.local.
     // Android NsdManager can discover this.
     // Standard DNS resolver on Android (getByName) relies on the Responder being active.
     
     if (bonjourInstance) {
        bonjourInstance.unpublishAll();
        bonjourInstance.destroy();
     }
     
     bonjourInstance = new Bonjour();
     bonjourInstance.publish({ name, type, port: SERVER_PORT, host: `${hostname}.local` });
     console.log(`[Bonjour] Published service: ${name}._${type}._tcp.local -> ${hostname}.local:${SERVER_PORT}`);
  } catch (err) {
      console.error('[Bonjour] Failed to publish service:', err);
  }
}

function waitForProcExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
      return resolve();
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve();
    };

    const t = setTimeout(finish, timeoutMs);
    proc.once('exit', finish);
  });
}

async function stopLocalServer({ timeoutMs = 3000 } = {}) {
  if (!serverProc) return;
  if (serverProc.exitCode !== null || serverProc.signalCode !== null) {
    serverProc = null;
    serverProcDataDir = null;
    return;
  }

  try {
    serverProc.kill('SIGTERM');
  } catch {
    // ignore
  }

  await waitForProcExit(serverProc, timeoutMs);

  // If it's still around, force kill and wait briefly again.
  if (serverProc && serverProc.exitCode === null && serverProc.signalCode === null && !serverProc.killed) {
    try {
      serverProc.kill('SIGKILL');
    } catch {
      // ignore
    }
    await waitForProcExit(serverProc, 750);
  }

  serverProc = null;
  serverProcDataDir = null;
}

async function restartLocalServerWithDataDir(dataDir) {
  if (process.env.INVENTORY_SERVER_URL) return { error: 'external_server' };

  // eslint-disable-next-line no-console
  console.log('electron: restartLocalServerWithDataDir requested', { dataDir });

  // If we didn't spawn the process (we reused an existing server), we can't safely restart it.
  if (!serverProc && (await isServerReachable(SERVER_URL))) {
    // eslint-disable-next-line no-console
    console.log('electron: server already running externally');
    return { error: 'in_use' };
  }

  await stopLocalServer();

  const serverRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..', '..', 'server');
  const serverEntry = path.join(serverRoot, 'src', 'index.js');
  
  // Prefer system node in dev, embedded node (Electron) in release/packaged
  // If npm_node_execpath is available, it's likely the system node that invoked npm.
  const nodeExec = app.isPackaged
    ? process.execPath
    : (process.env.INVENTORY_NODE || process.env.npm_node_execpath || 'node'); // Fallback to 'node' in PATH if needed

  // eslint-disable-next-line no-console
  console.log('electron: spawning server', { nodeExec, serverEntry, serverRoot });

  const userConfig = loadUserConfig();
  const useCustomCert = userConfig.httpsKey && userConfig.httpsCert;

  const ksPath = path.join(app.getPath('userData'), 'keystore');
  const certPath = useCustomCert ? userConfig.httpsCert : path.join(ksPath, 'cert.pem');
  const keyPath = useCustomCert ? userConfig.httpsKey : path.join(ksPath, 'key.pem');

  serverProcDataDir = dataDir;
  serverProc = spawn(nodeExec, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: app.isPackaged ? 'production' : (process.env.NODE_ENV || undefined),
      PORT: String(SERVER_PORT),
      INVENTORY_DATA_DIR: dataDir,
      INVENTORY_REGISTRY_PATH: registryPath(),
      INVENTORY_SERVER_STATE_DIR: app.getPath('userData'),
      HTTPS_CERT_PATH: certPath,
      HTTPS_KEY_PATH: keyPath,
      IDP_HOSTNAME: userConfig.idpHostname,
      APP_HOSTNAME: userConfig.appHostname,
      ANDROID_DEBUG_SHA256: process.env.ANDROID_DEBUG_SHA256, // Pass it down
      WEBAUTHN_RP_ID: ngrokUrl ? new URL(ngrokUrl).hostname : (userConfig.idpHostname || userConfig.hostname || undefined),
      ...(nodeExec === process.execPath ? { ELECTRON_RUN_AS_NODE: '1' } : {})
    },
    cwd: serverRoot,
    stdio: 'inherit',
    windowsHide: true
  });
  
  serverProc.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('electron: server spawn error', err);
  });

  serverProc.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.log('electron: server exited', code);
  });

  // Wait briefly for the new server to come up.
  const started = await new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (await isServerReachable(SERVER_URL)) {
        clearInterval(interval);
        // eslint-disable-next-line no-console
        console.log('electron: server became reachable');
        return resolve(true);
      }
      if (attempts >= 40) { // Increased timeout to 6s
        clearInterval(interval);
        // eslint-disable-next-line no-console
        console.error('electron: server failed to become reachable');
        return resolve(false);
      }
    }, 150);
  });

  if (!started) return { error: 'start_failed' };
  return { ok: true };
}

function createWindow(initialFile = 'index.html') {
  // eslint-disable-next-line no-console
  console.log('electron: createWindow start', { initialFile });

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // eslint-disable-next-line no-console
  console.log('electron: createWindow created');

  // Diagnostics for unexpected window closes/crashes.
  mainWindow.on('close', (evt) => {
    // Always quit the app when the window is closed.
    if (!isQuitting) {
      evt.preventDefault();
      isQuitting = true;
      app.quit();
      return;
    }

    // eslint-disable-next-line no-console
    console.log('electron: window close', {
      isQuitting,
      url: mainWindow?.webContents?.getURL?.() || null
    });
  });

  mainWindow.on('closed', () => {
    // eslint-disable-next-line no-console
    console.log('electron: window closed');
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (_evt, errorCode, errorDescription, validatedURL) => {
    // eslint-disable-next-line no-console
    console.error('electron: did-fail-load', { errorCode, errorDescription, validatedURL });
  });

  mainWindow.webContents.on('console-message', (_evt, level, message, line, sourceId) => {
    // eslint-disable-next-line no-console
    console.log('renderer:console', { level, message, line, sourceId });
  });

  mainWindow.webContents.on('did-start-loading', () => {
    // eslint-disable-next-line no-console
    console.log('electron: did-start-loading');
  });

  mainWindow.webContents.on('dom-ready', () => {
    // eslint-disable-next-line no-console
    console.log('electron: dom-ready', { url: mainWindow.webContents.getURL() });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // eslint-disable-next-line no-console
    console.log('electron: did-finish-load', { url: mainWindow.webContents.getURL() });
  });

  mainWindow.webContents.on('did-stop-loading', () => {
    // eslint-disable-next-line no-console
    console.log('electron: did-stop-loading', { url: mainWindow.webContents.getURL() });
  });

  mainWindow.webContents.on('will-navigate', (_evt, url) => {
    // eslint-disable-next-line no-console
    console.log('electron: will-navigate', url);
  });

  mainWindow.webContents.on('did-navigate', (_evt, url) => {
    // eslint-disable-next-line no-console
    console.log('electron: did-navigate', url);
  });

  mainWindow.webContents.on('did-navigate-in-page', (_evt, url) => {
    // eslint-disable-next-line no-console
    console.log('electron: did-navigate-in-page', url);
  });

  mainWindow.webContents.on('render-process-gone', (_evt, details) => {
    // eslint-disable-next-line no-console
    console.error('electron: render-process-gone', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    // eslint-disable-next-line no-console
    console.warn('electron: renderer unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    // eslint-disable-next-line no-console
    console.log('electron: renderer responsive');
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const targetUrl = initialFile === 'index.html' 
      ? devServerUrl 
      : `${devServerUrl}/${initialFile}`;

    // eslint-disable-next-line no-console
    console.log('electron: loading dev URL', targetUrl);
    mainWindow.loadURL(targetUrl).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('electron: loadURL failed', err);
    });
    return;
  }

  // If initialFile is setup.html, we need to ensure it exists in dist.
  // For now, assuming build includes it or we handle it.
  const filePath = path.join(__dirname, '..', 'dist', 'renderer', initialFile);
  mainWindow.loadFile(filePath).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('electron: loadFile failed', err);
  });
}

// --- Setup Helpers ---
function needsSetup() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  return !fs.existsSync(configPath) && !process.env.INVENTORY_SERVER_URL;
}

function detectCertDefaults() {
  const possibleRoots = [];
  if (process.platform === 'win32') possibleRoots.push('C:\\Certbot\\live');
  else if (process.platform === 'linux') possibleRoots.push('/etc/letsencrypt/live');
  
  for (const root of possibleRoots) {
    if (fs.existsSync(root)) {
        try {
            const domains = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory());
            if (domains.length > 0) {
                const domain = domains[0];
                return {
                    hostname: domain,
                    key: path.join(root, domain, 'privkey.pem'),
                    cert: path.join(root, domain, 'fullchain.pem')
                };
            }
        } catch(e) { /* ignore */ }
    }
  }
  return null;
}

app.whenReady().then(async () => {
  // eslint-disable-next-line no-console
  console.log('electron: ready');
  
  // Wait for Dev Init (Keystore SHA generation) before spawning server
  await devInitPromise;
  
  // 1. Startup Tunnel Check (BEFORE starting server)
  try {
     const fetch = (await import('node-fetch')).default || global.fetch; 
     const response = await fetch('http://127.0.0.1:4040/api/tunnels').catch(() => null);
     if (response && response.ok) {
        const data = await response.json();
        const existingTunnel = data.tunnels?.find(t => t.config?.addr.endsWith(':' + SERVER_PORT));
        if (existingTunnel) {
           console.log('[Startup] Found existing Ngrok tunnel: ' + existingTunnel.public_url);
           ngrokUrl = existingTunnel.public_url;
        }
     }
  } catch(e) {
     /* ignore */ 
  }

  // 2. Setup Check
  if (needsSetup()) {
    ipcMain.handle('setup:getConfigDefaults', async () => detectCertDefaults());
    
    ipcMain.handle('setup:selectFile', async (e, opts) => {
        const { canceled, filePaths } = await dialog.showOpenDialog({ ...opts, properties: ['openFile'] });
        return canceled ? null : filePaths[0];
    });

    ipcMain.handle('setup:generateCert', async (e, args) => {
        // Run PowerShell script
        const scriptPath = path.join(__dirname, '..', 'scripts', 'setup-certbot.ps1');
        const resultFile = path.join(app.getPath('temp'), `setup-result-${Date.now()}.json`);
        
        let { subdomains, token, email } = args;

        // Backward compatibility for stale renderers
        if (!subdomains && args.domain) {
            subdomains = [args.domain];
            if (args.idpDomain) subdomains.push(args.idpDomain);
        }

        if (!subdomains || !Array.isArray(subdomains)) {
             return { success: false, message: "Invalid parameters: subdomains missing" };
        }
        
        return new Promise((resolve) => {
            const sender = e.sender;
            const log = (msg) => sender.send('setup:log', msg);
            
            // Format for display
            const displayDomains = subdomains.map(d => d.includes('.duckdns.org') ? d : `${d}.duckdns.org`).join(', ');
            log(`Prompting for Admin privileges to run Certbot for: ${displayDomains}...`);

            log(`(A new PowerShell window will open. Please accept the UAC prompt.)`);
            
            // Normalize domains: ensure .duckdns.org suffix before passing to PowerShell
            // (defends against Start-Process -ArgumentList mangling the array)
            const normalizedSubs = subdomains.map(s =>
                s.includes('.duckdns.org') ? s : `${s}.duckdns.org`
            );
            const subsArg = normalizedSubs.map(s => `"${s}"`).join(',');

            const argsParts = [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', `"${scriptPath}"`,
                '-Subdomains', subsArg,
                '-Token', `"${token}"`,
                '-Email', `"${email}"`,
                '-ResultFile', `"${resultFile}"`
            ];

            const psArgs = argsParts.join(' ');

            const cmd = `Start-Process powershell -Verb RunAs -ArgumentList '${psArgs}'`;
            
            log(`Please watch the external PowerShell window for progress.`);
            
            exec(`powershell "${cmd}"`, (err) => {
                if (err) {
                    log('ERROR: Failed to launch elevated process: ' + err.message);
                    resolve({ success: false, message: 'Failed to launch process' });
                    return;
                }
                
                // Poll for result file
                let attempts = 0;
                const maxAttempts = 180; // 3 minutes
                const interval = setInterval(() => {
                    attempts++;
                    if (fs.existsSync(resultFile)) {
                        clearInterval(interval);
                        try {
                            const raw = fs.readFileSync(resultFile, 'utf8');
                            const data = JSON.parse(raw);
                            fs.unlinkSync(resultFile); // Cleanup
                            
                            if (data.success) {
                                log('Script reported success. Verifying certificate paths...');

                                // Double-check paths exist (catches PowerShell script bugs)
                                if (!fs.existsSync(data.result.key)) {
                                    log('ERROR: Key path does not exist: ' + data.result.key);
                                    resolve({
                                        success: false,
                                        message: 'Certificate key file not accessible',
                                        details: `Expected: ${data.result.key}\n\nThe PowerShell script reported success but the file cannot be found.`
                                    });
                                    return;
                                }

                                if (!fs.existsSync(data.result.cert)) {
                                    log('ERROR: Cert path does not exist: ' + data.result.cert);
                                    resolve({
                                        success: false,
                                        message: 'Certificate file not accessible',
                                        details: `Expected: ${data.result.cert}\n\nThe PowerShell script reported success but the file cannot be found.`
                                    });
                                    return;
                                }

                                log('Certificate paths verified.');
                                resolve({ success: true, result: data.result });
                            } else {
                                log('Script reported error: ' + data.message);
                                if (data.output) {
                                  log('--- Script Output ---');
                                  log(data.output);
                                  log('---------------------');
                                }
                                resolve({ success: false, message: data.message });
                            }
                        } catch (e) {
                            log('Error reading result file: ' + e.message);
                            resolve({ success: false, message: 'Invalid result file content' });
                        }
                    } else if (attempts >= maxAttempts) {
                        clearInterval(interval);
                        log('Timed out waiting for script execution.');
                        resolve({ success: false, message: 'Timeout' });
                    }
                }, 1000);
            });
        });
    });
    
    ipcMain.handle('setup:validateAndSave', async (e, config) => {
        try {
            if (!config.useSelfSigned) {
                const keyExists = fs.existsSync(config.httpsKey);
                const certExists = fs.existsSync(config.httpsCert);

                if (!keyExists || !certExists) {
                    let errorMsg = 'Certificate validation failed:\n\n';
                    if (!keyExists) errorMsg += `✗ Key not found: ${config.httpsKey}\n`;
                    if (!certExists) errorMsg += `✗ Cert not found: ${config.httpsCert}\n`;
                    errorMsg += '\nPlease check the setup wizard output for errors.';
                    throw new Error(errorMsg);
                }

                // Verify files are readable and non-empty
                const keyStats = fs.statSync(config.httpsKey);
                const certStats = fs.statSync(config.httpsCert);

                if (keyStats.size === 0 || certStats.size === 0) {
                    throw new Error(`Certificate files are empty. This indicates a generation failure.`);
                }
            }
            const saveData = config.useSelfSigned ? { hostname: 'localhost' } : {
                hostname: config.hostname,
                idpHostname: config.idpHostname,
                httpsKey: config.httpsKey,
                httpsCert: config.httpsCert
            };
            fs.writeFileSync(path.join(app.getPath('userData'), 'config.json'), JSON.stringify(saveData, null, 2));
            
            await startServerIfLocal();
            
            if (process.env.VITE_DEV_SERVER_URL) {
               mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
            } else {
               const appPath = path.join(__dirname, '..', 'dist', 'renderer', 'index.html');
               mainWindow.loadFile(appPath);
            }
            
            return { success: true };
        } catch(err) {
            console.error('Setup Error:', err);
            return { success: false, message: err.message };
        }
    });
    
    createWindow('setup.html');
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow('setup.html');
    });
    return;
  }

  // 2b. Start Server
  await startServerIfLocal();
  
  // 3. Application Menu
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'viewMenu' },
    {
      label: 'Remote',
      submenu: [
        {
          label: 'Enable WebAuthn Tunnel (ngrok)',
          type: 'checkbox',
          checked: !!ngrokUrl, // Reflect initial state
          click: async (menuItem) => {
             const success = await toggleRemoteTunnel(menuItem.checked);
             if (!success) {
                menuItem.checked = !menuItem.checked; // Revert UI if action failed
             }
          }
        }
      ]
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ role: 'about' }] }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Only allow camera access. Deny everything else.
    if (permission === 'media') return callback(true);
    return callback(false);
  });

  // 4. Create Window
  try {
    createWindow();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('electron: createWindow failed', err);
    throw err;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // eslint-disable-next-line no-console
  console.log('electron: window-all-closed');

  app.quit();
});

app.on('before-quit', (evt) => {
  isQuitting = true;
  // eslint-disable-next-line no-console
  console.log('electron: before-quit');

  if (quitCleanupInProgress) return;
  quitCleanupInProgress = true;

  // Delay quit until we've stopped the local server (otherwise the child process
  // can keep the Electron main process alive on Windows).
  evt.preventDefault();
  (async () => {
    try {
      await stopLocalServer({ timeoutMs: 3000 });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('electron: stopLocalServer failed during quit', err);
    } finally {
      // Continue the normal quit flow.
      app.quit();
    }
  })();
});

app.on('quit', () => {
  // eslint-disable-next-line no-console
  console.log('electron: quit');
});

ipcMain.handle('app:getServerUrl', async () => {
  return { serverUrl: SERVER_URL };
});



function getLanIpv4s() {
  const nets = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (!net) continue;
      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;
      const address = net.address;
      if (!address) continue;
      // Skip APIPA
      if (address.startsWith('169.254.')) continue;
      candidates.push(address);
    }
  }

  return candidates;
}

ipcMain.handle('app:getLanBaseUrl', async () => {
  // Use ngrok if active (WebAuthn / Remote pairing)
  // This might be deprecated, but we leave it for potential remote access needs.
  if (ngrokUrl) {
    return {
       baseUrl: ngrokUrl,
       ips: []
    };
  }

  const localIp = detectLocalIp();
  const userConfig = loadUserConfig();

  // When custom certs with a hostname are configured, use that hostname
  // so the QR code URL matches the certificate's SANs.
  if (userConfig.hostname && userConfig.httpsKey && userConfig.httpsCert) {
    return {
      baseUrl: `https://${userConfig.hostname}:${SERVER_PORT}`,
      ips: [localIp]
    };
  }

  // Default: use sslip.io Local PKI domain strategy.
  // This provides a secure origin (compatible with WebAuthn) that resolves to the local LAN IP.
  const sslipDomain = getSslipDomain(localIp);

  return {
    baseUrl: `https://${sslipDomain}:${SERVER_PORT}`,
    ips: [localIp]
  };
});

ipcMain.handle('inventory:list', async () => {
  const reg = loadRegistry();
  return {
    inventories: reg.inventories.map(({ id, name }) => ({ id, name })),
    activeId: reg.activeId
  };
});

ipcMain.handle('inventory:create', async (_evt, name) => {
  const n = String(name || '').trim();
  if (!n) return { error: 'name_required' };

  const reg = loadRegistry();
  const id = newInventoryId();
  const dataDir = path.join(inventoriesRoot(), id);
  ensureDir(dataDir);

  reg.inventories.push({ id, name: n, dataDir });
  reg.activeId = id;
  saveRegistry(reg);

  const restarted = await restartLocalServerWithDataDir(dataDir);
  if (restarted?.error) return restarted;

  return { ok: true, id };
});

ipcMain.handle('inventory:setActive', async (_evt, id) => {
  const nextId = String(id || '').trim();
  if (!nextId) return { error: 'id_required' };

  const reg = loadRegistry();
  const inv = reg.inventories.find(i => i.id === nextId);
  if (!inv) return { error: 'not_found' };

  reg.activeId = nextId;
  saveRegistry(reg);

  const restarted = await restartLocalServerWithDataDir(inv.dataDir);
  if (restarted?.error) return restarted;

  return { ok: true };
});
