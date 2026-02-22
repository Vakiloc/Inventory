#!/usr/bin/env node
/**
 * Cross-platform release script.
 *
 * Usage: node scripts/release.mjs <version> [options]
 *
 * Options:
 *   --skip-tests       Skip running tests
 *   --skip-desktop     Skip building the desktop installer
 *   --skip-android     Skip building the Android APK
 *   --android-jdk=PATH Path to Android JDK (default: auto-detect)
 *   --create-tag       Create a git tag
 *   --push-tag         Push the git tag to origin (implies --create-tag)
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const inventoryAppRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(inventoryAppRoot, '..');

// --- Argument parsing ---
const args = process.argv.slice(2);
const version = args.find(a => !a.startsWith('--'));
const flags = new Set(args.filter(a => a.startsWith('--') && !a.includes('=')));
const opts = Object.fromEntries(
  args.filter(a => a.startsWith('--') && a.includes('=')).map(a => {
    const [k, ...v] = a.split('=');
    return [k, v.join('=')];
  })
);

const skipTests = flags.has('--skip-tests');
const skipDesktop = flags.has('--skip-desktop');
const skipAndroid = flags.has('--skip-android');
const pushTag = flags.has('--push-tag');
const createTag = flags.has('--create-tag') || pushTag;

if (!version) {
  console.error('Usage: node scripts/release.mjs <version> [options]');
  console.error('Example: node scripts/release.mjs 0.1.5 --create-tag');
  process.exit(1);
}

// --- Helpers ---
function step(text) {
  console.log(`\n=== ${text} ===`);
}

function run(cmd, options = {}) {
  console.log(`  > ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...options });
}

function requireCommand(name) {
  try {
    execSync(process.platform === 'win32' ? `where ${name}` : `which ${name}`, { stdio: 'pipe' });
  } catch {
    throw new Error(`Required command not found: ${name}`);
  }
}

function assertSemVer(v) {
  if (!v || v.startsWith('v')) {
    throw new Error(`Version must not include the 'v' prefix. Use 0.1.1 (not v0.1.1).`);
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(v)) {
    throw new Error(`Invalid version format: '${v}'. Expected SemVer like 0.1.1 or 0.1.1-rc.1`);
  }
}

function ensureRepoClean(dir) {
  const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8' }).trim();
  if (dirty) {
    throw new Error(`Working tree is not clean. Commit/stash changes first.\n\n${dirty}`);
  }
}

// --- Windows-specific: Symlink privilege check ---
function testSymlinkPrivilege() {
  if (process.platform !== 'win32') return true; // Unix always supports symlinks

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-symlink-test-'));
  try {
    const target = path.join(tmpDir, 'target.txt');
    const link = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(target, 'ok');
    try {
      fs.symlinkSync(target, link);
      return true;
    } catch {
      return false;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// --- Windows-specific: Ensure 7zip binary ---
function ensure7ZipBinary() {
  if (process.platform !== 'win32') return; // Only needed for Windows NSIS builds

  const p = path.join(inventoryAppRoot, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
  if (fs.existsSync(p)) return;

  console.log('7za.exe missing. Attempting to reinstall 7zip-bin...');
  run('npm i --no-save 7zip-bin@5.2.0', { cwd: inventoryAppRoot });

  if (!fs.existsSync(p)) {
    throw new Error(`7za.exe still missing at ${p}. Try reinstalling or add a Defender exclusion.`);
  }
}

// --- Detect Android JDK ---
function findAndroidJdk() {
  const explicit = opts['--android-jdk'];
  if (explicit) return explicit;

  const candidates = [];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Android\\Android Studio\\jbr');
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Android Studio.app/Contents/jbr/Contents/Home');
    candidates.push(`${os.homedir()}/Library/Java/JavaVirtualMachines`);
  } else {
    candidates.push('/usr/lib/jvm/java-17-openjdk-amd64');
    candidates.push('/usr/lib/jvm/java-17-openjdk');
  }

  // Also check JAVA_HOME
  if (process.env.JAVA_HOME) candidates.unshift(process.env.JAVA_HOME);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// --- Main ---
step('Preflight');
requireCommand('npm');
assertSemVer(version);

if (createTag) {
  requireCommand('git');
  ensureRepoClean(repoRoot);
}

if (!skipDesktop) {
  ensure7ZipBinary();
}

if (!skipAndroid) {
  const jdk = findAndroidJdk();
  if (!jdk) {
    throw new Error('Android JDK not found. Install Android Studio or pass --android-jdk=PATH.');
  }
  process.env.JAVA_HOME = jdk;
  const jdkBin = path.join(jdk, 'bin');
  process.env.PATH = `${jdkBin}${path.delimiter}${process.env.PATH}`;
}

if (!skipTests) {
  step('Validate: npm test');
  run('npm test', { cwd: inventoryAppRoot });
}

if (!skipDesktop) {
  step('Build: Desktop installer');

  if (process.platform === 'win32' && !testSymlinkPrivilege()) {
    throw new Error(
      'Windows symlink privilege is not available.\n\n' +
      'Fix: enable Developer Mode (Windows Settings -> For developers) or run elevated.\n' +
      'Or re-run with --skip-desktop to only produce the Android APK.'
    );
  }

  process.env.RELEASE_VERSION = version;
  run('npm -w desktop run dist:win', { cwd: inventoryAppRoot });
}

if (!skipAndroid) {
  step('Build: Android release APK');
  const androidDir = path.join(inventoryAppRoot, 'android');
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

  process.env.VERSION_NAME = version;
  process.env.VERSION_CODE = String(Math.floor(Date.now() / 86400000)); // days since epoch

  if (!skipTests) {
    step('Validate: Android unit tests');
    run(`${gradlew} :app:testDebugUnitTest`, { cwd: androidDir });
  }

  run(`${gradlew} :app:copyReleaseApk`, { cwd: androidDir });
}

// --- Artifacts ---
step('Artifacts');

const apk = path.join(inventoryAppRoot, 'android', 'app', 'artifacts', 'app-release.apk');
if (fs.existsSync(apk)) {
  console.log(`Android APK: ${apk}`);
}

const desktopOut = path.join(inventoryAppRoot, 'desktop', 'dist-electron');
if (fs.existsSync(desktopOut)) {
  const files = fs.readdirSync(desktopOut).filter(f => /\.(exe|msi|dmg|AppImage|deb|snap|zip)$/i.test(f));
  if (files.length) {
    for (const f of files) console.log(`Desktop installer: ${path.join(desktopOut, f)}`);
  } else {
    console.log(`Desktop output folder: ${desktopOut}`);
  }
}

// --- Git tag ---
if (createTag) {
  step('Git tag');
  const tag = `v${version}`;
  const existing = execSync(`git tag --list ${tag}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
  if (existing) throw new Error(`Tag already exists: ${tag}`);

  run(`git tag ${tag}`, { cwd: repoRoot });

  if (pushTag) {
    run(`git push origin ${tag}`, { cwd: repoRoot });
  }
}

step('Done');
