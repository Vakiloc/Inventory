import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '..');

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

const builderBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
);

function safeRmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function safeCopyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

const releaseVersion = process.env.RELEASE_VERSION;
const args = ['--win', '--x64', '--publish', 'never'];
if (releaseVersion) {
  args.push(`--config.extraMetadata.version=${releaseVersion}`);
}

// IMPORTANT:
// electron-builder runs internal npm commands to install production deps. If invoked within a monorepo
// workspace package, npm can treat the operation as workspace-scoped and/or combine flags in ways that
// break (e.g. "--no-workspaces" with an implicit "--workspace"). To make the build deterministic and
// avoid touching the workspace root, run electron-builder from a temporary standalone project dir.
const tmpProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-desktop-build-'));
try {
  fs.copyFileSync(
    path.join(desktopDir, 'package.json'),
    path.join(tmpProjectDir, 'package.json')
  );
  safeCopyDir(path.join(desktopDir, 'src'), path.join(tmpProjectDir, 'src'));
  safeCopyDir(path.join(desktopDir, 'dist'), path.join(tmpProjectDir, 'dist'));
  const stagePath = path.join(desktopDir, '.stage');
  if (fs.existsSync(stagePath)) {
    safeCopyDir(stagePath, path.join(tmpProjectDir, '.stage'));
  }

  await run(builderBin, args, { cwd: tmpProjectDir });

  // Copy artifacts back where CI expects them.
  const outSrc = path.join(tmpProjectDir, 'dist-electron');
  const outDest = path.join(desktopDir, 'dist-electron');
  safeRmrf(outDest);
  if (fs.existsSync(outSrc)) {
    safeCopyDir(outSrc, outDest);
  }
} finally {
  safeRmrf(tmpProjectDir);
}
