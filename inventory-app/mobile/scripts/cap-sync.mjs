#!/usr/bin/env node
/**
 * Capacitor sync wrapper that patches tar v7 CJS interop.
 *
 * The workspace root overrides tar to v7 for security, but tar v7
 * sets __esModule without a default export, breaking Capacitor CLI's
 * `tslib.__importDefault(require("tar"))` pattern.
 *
 * Usage: node scripts/cap-sync.mjs [ios|android]
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mobileDir = join(__dirname, '..');

// Write a temporary CJS preload that patches tar's default export
const patchPath = join(mobileDir, '_tar-patch.cjs');
writeFileSync(patchPath, `
const Module = require('module');
const origRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  const result = origRequire.apply(this, arguments);
  if (id === 'tar' && result && result.__esModule && !result.default) {
    result.default = result;
  }
  return result;
};
`);

const platform = process.argv[2]; // 'ios' or 'android'
const args = ['cap', 'sync'];
if (platform) args.push(platform);

try {
  execFileSync('npx', args, {
    cwd: mobileDir,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: `--require ${patchPath}` },
    shell: process.platform === 'win32'
  });
} finally {
  try { unlinkSync(patchPath); } catch { /* ignore */ }
}
