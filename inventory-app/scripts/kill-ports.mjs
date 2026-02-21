#!/usr/bin/env node
/**
 * Cross-platform port killer.
 * Finds and kills processes listening on the development ports (443, 5174)
 * before starting the dev servers.
 *
 * Usage: node scripts/kill-ports.mjs [port1] [port2] ...
 * Defaults to ports 443 and 5174 if none specified.
 */

import { execSync } from 'node:child_process';

const defaultPorts = [443, 5174];
const ports = process.argv.slice(2).map(Number).filter(Boolean);
const targets = ports.length ? ports : defaultPorts;

function killOnWindows(port) {
  try {
    const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const pids = new Set();
    for (const line of output.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      if (pid && pid !== 0) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
        console.log(`  Killed PID ${pid}`);
      } catch { /* already dead */ }
    }
    return pids.size;
  } catch {
    return 0;
  }
}

function killOnUnix(port) {
  try {
    // lsof works on both macOS and Linux
    const output = execSync(`lsof -ti :${port}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const pids = new Set(
      output.trim().split('\n').map(s => parseInt(s.trim(), 10)).filter(Boolean)
    );
    for (const pid of pids) {
      try {
        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
        console.log(`  Killed PID ${pid}`);
      } catch { /* already dead */ }
    }
    return pids.size;
  } catch {
    return 0;
  }
}

const isWin = process.platform === 'win32';
const kill = isWin ? killOnWindows : killOnUnix;

for (const port of targets) {
  console.log(`Checking port ${port}...`);
  const killed = kill(port);
  if (killed === 0) {
    console.log(`  No process found on port ${port}.`);
  }
}
