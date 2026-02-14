import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { rebuild } from '@electron/rebuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');

const serverSrcDir = path.join(repoRoot, 'server');
const stageDir = path.join(desktopDir, '.stage', 'server');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else if (entry.isFile()) {
      copyFile(src, dest);
    }
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32',
      ...opts
    });
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  rmrf(stageDir);
  ensureDir(stageDir);

  // Copy server sources into the staged server directory.
  copyDir(path.join(serverSrcDir, 'src'), path.join(stageDir, 'src'));
  copyFile(path.join(serverSrcDir, 'package.json'), path.join(stageDir, 'package.json'));

  // Install production deps for the staged server.
  const npmCmd = 'npm';
  await run(
    npmCmd,
    ['install', '--no-workspaces', '--omit=dev', '--no-audit', '--no-fund', '--ignore-scripts'],
    { cwd: stageDir }
  );

  // Rebuild native deps (better-sqlite3) for Electron.
  const require = createRequire(import.meta.url);
  const electronVersion = require('electron/package.json').version;

  await rebuild({
    buildPath: stageDir,
    electronVersion,
    arch: process.arch,
    force: true,
    onlyModules: ['better-sqlite3']
  });
}

await main();
