#!/usr/bin/env node
/**
 * Cross-platform dev helper for WebAuthn testing via ngrok.
 * Starts an ngrok tunnel and launches the server with the tunnel's public URL as the RP ID.
 *
 * Usage: node scripts/start-dev-webauthn.mjs
 */

import { execSync, spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 5199;

// --- Detect/install ngrok ---
function hasNgrok() {
  try {
    execSync(process.platform === 'win32' ? 'where ngrok' : 'which ngrok', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!hasNgrok()) {
  console.error('ngrok is not found in PATH.');
  console.error('Install ngrok from https://ngrok.com/download or via your package manager.');
  process.exit(1);
}

// --- Kill existing ngrok if running ---
function killExistingNgrok() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM ngrok.exe', { stdio: 'pipe' });
    } else {
      execSync('pkill -f ngrok', { stdio: 'pipe' });
    }
    console.log('Killed existing ngrok process.');
  } catch { /* not running */ }
}

// --- Fetch tunnels from ngrok API ---
function fetchTunnels() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// --- Start ngrok and wait for tunnel ---
async function startNgrok() {
  killExistingNgrok();

  console.log(`Starting ngrok tunnel on port ${PORT}...`);
  const ngrokProc = spawn('ngrok', ['http', String(PORT), '--log=stdout'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false
  });

  // Wait for tunnel
  const startTime = Date.now();
  const timeout = 15000;

  while (Date.now() - startTime < timeout) {
    await new Promise(r => setTimeout(r, 1000));

    if (ngrokProc.exitCode !== null) {
      console.error('ngrok process exited unexpectedly.');
      process.exit(1);
    }

    try {
      const data = await fetchTunnels();
      if (data.tunnels && data.tunnels.length > 0) {
        return { url: data.tunnels[0].public_url, proc: ngrokProc };
      }
    } catch { /* API not ready yet */ }
  }

  ngrokProc.kill();
  console.error('Timed out waiting for ngrok to start.');
  process.exit(1);
}

// --- Main ---
const { url: publicUrl, proc: ngrokProcess } = await startNgrok();
const hostname = publicUrl.replace(/^https?:\/\//, '');

console.log('\n==================================================================');
console.log(' WEBAUTHN DEV SERVER STARTED');
console.log('==================================================================');
console.log(`Public URL : ${publicUrl}`);
console.log(`RP ID      : ${hostname}`);
console.log('Instructions:');
console.log('1. Open the Android App.');
console.log('2. UNPAIR or CLEAR DATA on the app (since server URL changed).');
console.log('3. Pair again using the Public URL above.');
console.log('==================================================================\n');

process.env.WEBAUTHN_RP_ID = hostname;

console.log('Starting Server... (Press Ctrl+C to stop)');
const serverProc = spawn('npm', ['run', 'dev', '-w', 'server'], {
  stdio: 'inherit',
  env: { ...process.env, WEBAUTHN_RP_ID: hostname },
  shell: process.platform === 'win32'
});

function cleanup() {
  console.log('\nStopping ngrok...');
  try { ngrokProcess.kill(); } catch { /* already dead */ }
  try { serverProc.kill(); } catch { /* already dead */ }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

serverProc.on('exit', () => {
  cleanup();
});
