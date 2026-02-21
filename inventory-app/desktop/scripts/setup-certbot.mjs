#!/usr/bin/env node
/**
 * Cross-platform Let's Encrypt certificate setup via DuckDNS DNS-01 challenge.
 *
 * Stores Python venv and Certbot data under AppDataDir (Electron userData).
 * Falls back to user home directory for backward compat.
 *
 * Invoked by the Electron main process (setup:generateCert IPC handler).
 *
 * Arguments (passed as env vars or CLI flags):
 *   --result-file=PATH     Where to write JSON result
 *   --subdomains=a,b       Comma-separated DuckDNS subdomains
 *   --token=TOKEN           DuckDNS token
 *   --email=EMAIL           Let's Encrypt email
 *   --app-data-dir=PATH    Electron userData directory
 *   --web-app-port=PORT    Server port for connectivity check
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import https from 'node:https';
import crypto from 'node:crypto';
import { execSync, execFileSync, spawnSync } from 'node:child_process';

// --- Argument parsing ---
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, 'true'];
    })
);

const resultFile = args['--result-file'] || '';
const subdomainsRaw = args['--subdomains'] || '';
const token = args['--token'] || '';
const email = args['--email'] || '';
const appDataDir = args['--app-data-dir'] || '';
const webAppPort = args['--web-app-port'] || '443';

// --- Directories ---
const baseDir = appDataDir && appDataDir.trim() ? appDataDir.trim() : os.homedir();
const venvDir = path.join(baseDir, '.certbot-env');
const certbotBaseDir = path.join(baseDir, '.inventory-certbot');
const configDir = path.join(certbotBaseDir, 'config');
const workDir = path.join(certbotBaseDir, 'work');
const logsDir = path.join(certbotBaseDir, 'logs');
const credDir = path.join(certbotBaseDir, 'credentials');
const credFile = path.join(credDir, 'duckdns.ini');

// Legacy location for backward compatibility
const legacyCertbotBaseDir = path.join(os.homedir(), '.inventory-certbot');
const legacyConfigDir = path.join(legacyCertbotBaseDir, 'config');

// --- Detect local IP (cross-platform, mirrors serverConfig.js) ---
function detectLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal && n.address.startsWith('192.168.')) return n.address;
    }
  }
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

// --- Port check (cross-platform) ---
function checkPort(host, port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port: Number(port), timeout: 3000 });
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

// --- DuckDNS update (cross-platform) ---
async function updateDuckDns(domains, duckToken, localIp) {
  const subNames = domains.map(d => d.replace(/\.duckdns\.org$/, '')).join(',');
  console.log(`Registering/updating DuckDNS: ${subNames} -> ${localIp}`);

  const url = `https://www.duckdns.org/update?domains=${subNames}&token=${duckToken}&ip=${localIp}`;
  const response = await new Promise((resolve, reject) => {
    https.get(url, { timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data.trim()));
    }).on('error', reject);
  });

  if (response !== 'OK') {
    throw new Error(`DuckDNS registration failed (response: '${response}'). Verify your token.`);
  }
  console.log('DuckDNS domains registered/updated successfully.');
}

// --- Certificate existence check ---
function testExistingCerts(domains, cfgDir) {
  const mainDomain = domains[0];
  const baseName = mainDomain.replace(/\.duckdns\.org$/, '');
  const liveRoot = path.join(cfgDir, 'live');

  if (!fs.existsSync(liveRoot)) return null;

  let dirs;
  try { dirs = fs.readdirSync(liveRoot).filter(n => fs.statSync(path.join(liveRoot, n)).isDirectory()); }
  catch { return null; }

  // Prioritize exact match, then prefix matches
  const candidates = dirs
    .filter(d => d === mainDomain || d === baseName || d.startsWith(mainDomain) || d.startsWith(baseName))
    .sort((a, b) => {
      const aExact = a === mainDomain || a === baseName;
      const bExact = b === mainDomain || b === baseName;
      return aExact === bExact ? 0 : aExact ? -1 : 1;
    });

  for (const candidate of candidates) {
    const certDir = path.join(liveRoot, candidate);
    const keyPath = path.join(certDir, 'privkey.pem');
    const certPath = path.join(certDir, 'fullchain.pem');
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) continue;

    try {
      // Resolve symlinks
      const realCertPath = fs.realpathSync(certPath);
      const certPem = fs.readFileSync(realCertPath, 'utf8');

      // Extract first PEM block
      const match = certPem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
      if (!match) continue;

      const x509 = new crypto.X509Certificate(match[0]);
      const expiresAt = new Date(x509.validTo);
      const daysLeft = Math.floor((expiresAt - Date.now()) / 86400000);

      return {
        domain: candidate,
        keyPath,
        certPath,
        expiresAt: expiresAt.toISOString(),
        daysLeft,
        needsRenewal: daysLeft < 30
      };
    } catch (err) {
      console.warn(`Warning: Could not parse existing certificate: ${err.message}`);
    }
  }
  return null;
}

// --- Write JSON result ---
function writeResult(success, data = null, message = '', output = '') {
  if (!resultFile) {
    console.log('No result file specified.');
    return;
  }

  const obj = { success };
  if (success) {
    obj.result = data;
  } else {
    obj.message = message;
    if (output) obj.output = output;
  }

  const dir = path.dirname(resultFile);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resultFile, JSON.stringify(obj, null, 2), 'utf8');
}

// --- Detect python command ---
function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const ver = execFileSync(cmd, ['--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      if (ver.includes('Python 3')) return cmd;
    } catch { /* not found */ }
  }
  return null;
}

// --- Venv pip/certbot paths (platform-aware) ---
function venvBin(name) {
  const isWin = process.platform === 'win32';
  const binDir = isWin ? 'Scripts' : 'bin';
  const ext = isWin ? '.exe' : '';
  return path.join(venvDir, binDir, name + ext);
}

// --- Main ---
async function main() {
  console.log('=== Inventory App: Certificate Setup ===');

  // Validation
  const python = findPython();
  if (!python) throw new Error('Python 3 is not installed or not in PATH.');

  // Parse subdomains
  const targets = subdomainsRaw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.endsWith('.duckdns.org') ? s : `${s}.duckdns.org`);

  if (targets.length === 0) throw new Error('At least one subdomain is required.');
  if (!token) throw new Error('DuckDNS Token is required.');
  if (!email) throw new Error('Email is required.');

  console.log(`Targets: ${targets.join(', ')}`);

  // Detect local IP and check port
  const localIp = detectLocalIp();
  if (!localIp) {
    throw new Error('Could not detect local IPv4 address.');
  }
  const portOpen = await checkPort(localIp, webAppPort);
  if (portOpen) {
    console.log(`Local IP detected: ${localIp} and port ${webAppPort} is open.`);
  } else {
    console.log(`Warning: Local IP ${localIp} detected but port ${webAppPort} is not open.`);
  }

  // Register/update DuckDNS
  await updateDuckDns(targets, token, localIp);

  // Check existing certificates
  let existing = testExistingCerts(targets, configDir);
  if (!existing && legacyConfigDir !== configDir) {
    existing = testExistingCerts(targets, legacyConfigDir);
  }

  if (existing && !existing.needsRenewal) {
    console.log(`Valid certificate found (expires in ${existing.daysLeft} days).`);
    console.log(`  Key:  ${existing.keyPath}`);
    console.log(`  Cert: ${existing.certPath}`);
    console.log('Reusing existing certificate. Skipping Certbot.');

    const resultData = { hostname: existing.domain, key: existing.keyPath, cert: existing.certPath, reused: true };
    if (targets.length > 1) resultData.idpHostname = targets[1];
    writeResult(true, resultData);
    return;
  }

  if (existing && existing.needsRenewal) {
    console.log(`Certificate expires in ${existing.daysLeft} days. Will attempt renewal.`);
  }

  // Python venv setup
  if (!fs.existsSync(venvDir)) {
    console.log('Creating Python Venv...');
    execFileSync(python, ['-m', 'venv', venvDir], { stdio: 'inherit' });
  }

  const pipExe = venvBin('pip');
  if (!fs.existsSync(pipExe)) {
    throw new Error(`Virtual Environment corrupted. Delete '${venvDir}' and retry.`);
  }

  console.log('Installing dependencies...');
  execFileSync(pipExe, ['install', 'certbot', 'certbot-dns-duckdns', '--quiet', '--disable-pip-version-check'], {
    stdio: 'inherit'
  });

  // Create directories
  for (const dir of [configDir, workDir, logsDir, credDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write credentials
  fs.writeFileSync(credFile, `dns_duckdns_token = ${token}`, 'utf8');

  // Run Certbot
  console.log('Requesting certificate via DuckDNS...');
  const certbotExe = venvBin('certbot');
  if (!fs.existsSync(certbotExe)) {
    throw new Error(`Certbot executable not found in venv: ${certbotExe}`);
  }

  const certbotArgs = [
    'certonly',
    '--non-interactive',
    '--agree-tos',
    '--expand',
    '--email', email,
    '--authenticator', 'dns-duckdns',
    '--dns-duckdns-credentials', credFile,
    '--dns-duckdns-propagation-seconds', '60',
    '--config-dir', configDir,
    '--work-dir', workDir,
    '--logs-dir', logsDir,
    ...targets.flatMap(t => ['-d', t])
  ];

  const certbotResult = spawnSync(certbotExe, certbotArgs, { stdio: 'pipe', encoding: 'utf8' });
  const cmdOutput = (certbotResult.stdout || '') + (certbotResult.stderr || '');

  if (certbotResult.status !== 0) {
    console.error('Certbot Failed!');
    let errMsg = `Certbot failed with exit code ${certbotResult.status}`;

    const rateLimitMatch = cmdOutput.match(/too many certificates.*?retry after\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+UTC)/);
    if (rateLimitMatch) {
      errMsg = `Rate limited by Let's Encrypt. Retry after ${rateLimitMatch[1]}.`;
    }

    writeResult(false, null, errMsg, cmdOutput);
    process.exit(1);
  }

  console.log(cmdOutput);

  // Verification
  console.log('Verifying certificate files...');

  const liveDir = path.join(configDir, 'live');
  if (fs.existsSync(liveDir)) {
    console.log('Available certificate directories:');
    for (const d of fs.readdirSync(liveDir)) {
      console.log(`  - ${d}`);
    }
  }

  let mainDomain = targets[0];
  let liveCertDir = path.join(configDir, 'live', mainDomain);

  if (!fs.existsSync(liveCertDir)) {
    const altDomain = mainDomain.replace(/\.duckdns\.org$/, '');
    const altLiveCertDir = path.join(configDir, 'live', altDomain);
    if (fs.existsSync(altLiveCertDir)) {
      console.log(`Using normalized domain: ${altDomain}`);
      mainDomain = altDomain;
      liveCertDir = altLiveCertDir;
    } else {
      throw new Error(`Certificate directory not found at: ${liveCertDir} or ${altLiveCertDir}`);
    }
  }

  const keyPath = path.join(liveCertDir, 'privkey.pem');
  const certPath = path.join(liveCertDir, 'fullchain.pem');

  if (!fs.existsSync(keyPath)) throw new Error(`Private key not found: ${keyPath}`);
  if (!fs.existsSync(certPath)) throw new Error(`Certificate not found: ${certPath}`);

  // Verify non-empty (resolve symlinks)
  const realKeyPath = fs.realpathSync(keyPath);
  const realCertPath = fs.realpathSync(certPath);
  const keySize = fs.statSync(realKeyPath).size;
  const certSize = fs.statSync(realCertPath).size;

  if (keySize === 0) throw new Error(`Private key file is empty: ${keyPath}`);
  if (certSize === 0) throw new Error(`Certificate file is empty: ${certPath}`);

  console.log('Certificate verified:');
  console.log(`  Key:  ${keyPath} (${keySize} bytes)`);
  console.log(`  Cert: ${certPath} (${certSize} bytes)`);
  console.log('Success! Certificate Generated.');

  const resultData = { hostname: mainDomain, key: keyPath, cert: certPath };
  if (targets.length > 1) resultData.idpHostname = targets[1];
  writeResult(true, resultData);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  writeResult(false, null, err.message);
  process.exit(1);
});
