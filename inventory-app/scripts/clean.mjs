#!/usr/bin/env node
/**
 * Cross-platform project cleanup script.
 * Removes node_modules, build artifacts, Python venvs, temp files, and logs.
 *
 * Usage: node scripts/clean.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find inventory-app root by walking up from scripts/
let root = path.resolve(__dirname, '..');
while (!fs.existsSync(path.join(root, 'inventory-app')) && path.dirname(root) !== root) {
  root = path.dirname(root);
}
// If we found the repo root, use inventory-app as the working root
if (fs.existsSync(path.join(root, 'inventory-app'))) {
  root = path.join(root, 'inventory-app');
} else {
  // Fallback: scripts/ is inside inventory-app/
  root = path.resolve(__dirname, '..');
}

console.log(`Cleaning project at ${root}`);

function removeSafe(targetPath) {
  if (!fs.existsSync(targetPath)) {
    console.log(`  Skipping ${targetPath} (Not found)`);
    return;
  }
  console.log(`  Removing ${targetPath}...`);
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    console.log(`  Removed.`);
  } catch (err) {
    console.error(`  Failed to remove ${targetPath}: ${err.message}`);
  }
}

function findRecursive(dir, matcher) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (matcher(entry)) {
        results.push(fullPath);
      } else if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...findRecursive(fullPath, matcher));
      }
    }
  } catch { /* permission errors, etc. */ }
  return results;
}

// 0. Python Virtual Environments (pyvenv.cfg marker)
console.log('\n--- Python venvs ---');
const venvConfigs = findRecursive(root, e => e.name === 'pyvenv.cfg' && e.isFile());
for (const cfg of venvConfigs) {
  removeSafe(path.dirname(cfg));
}

// 1. Node Modules
console.log('\n--- node_modules ---');
const nodeModulesDirs = findRecursive(root, e => e.name === 'node_modules' && e.isDirectory());
for (const nm of nodeModulesDirs) {
  removeSafe(nm);
}

// 2. Desktop Build Artifacts
console.log('\n--- Desktop build artifacts ---');
removeSafe(path.join(root, 'desktop', 'dist'));
removeSafe(path.join(root, 'desktop', 'dist-electron'));
removeSafe(path.join(root, 'desktop', '.vite'));

// 3. Android Build Artifacts
console.log('\n--- Android build artifacts ---');
removeSafe(path.join(root, 'android', '.gradle'));
removeSafe(path.join(root, 'android', 'app', 'build'));
removeSafe(path.join(root, 'android', 'build'));

// 4. Server Data (Temporary files only — keep inventory.sqlite!)
console.log('\n--- Server temp data ---');
removeSafe(path.join(root, 'server', 'data', 'inventory.sqlite-shm'));
removeSafe(path.join(root, 'server', 'data', 'inventory.sqlite-wal'));

// 5. Logs
console.log('\n--- Logs ---');
for (const dir of [root, path.join(root, 'server'), path.join(root, 'desktop')]) {
  if (!fs.existsSync(dir)) continue;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.log')) removeSafe(path.join(dir, f));
    }
  } catch { /* ignore */ }
}

// 6. Claude temporary files (tmpclaude-*-cwd bug)
console.log('\n--- Claude temp files ---');
const claudeTemps = findRecursive(root, e => e.isFile() && e.name.startsWith('tmpclaude-') && e.name.endsWith('-cwd'));
for (const f of claudeTemps) {
  removeSafe(f);
}

console.log('\nClean complete! Run "npm install" to rebuild dependencies.');
