import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PAIRS = [
  {
    name: 'desktop',
    en: 'desktop/src/renderer/i18n/en.json',
    es: 'desktop/src/renderer/i18n/es.json',
  },
  {
    name: 'server',
    en: 'server/src/i18n/en.json',
    es: 'server/src/i18n/es.json',
  },
  {
    name: 'android',
    en: 'android/app/src/main/assets/i18n/en.json',
    es: 'android/app/src/main/assets/i18n/es.json',
  },
];

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readJsonObject(relativePath) {
  const fullPath = path.resolve(repoRoot, relativePath);
  let raw;
  try {
    raw = await fs.readFile(fullPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Missing file: ${relativePath}`);
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(stripBom(raw));
  } catch (error) {
    throw new Error(`Invalid JSON: ${relativePath} (${error.message})`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Expected JSON object: ${relativePath}`);
  }
  return parsed;
}

function sortedKeys(obj) {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

async function main() {
  let failed = false;

  for (const pair of PAIRS) {
    const en = await readJsonObject(pair.en);
    const es = await readJsonObject(pair.es);

    const enKeys = new Set(Object.keys(en));
    const esKeys = new Set(Object.keys(es));

    const missing = [];
    for (const key of enKeys) {
      if (!esKeys.has(key)) missing.push(key);
    }

    if (missing.length) {
      failed = true;
      console.error(`\n[i18n] ${pair.name}: ${pair.es} is missing ${missing.length} key(s) present in ${pair.en}:`);
      for (const key of missing.sort((a, b) => a.localeCompare(b))) {
        console.error(`  - ${key}`);
      }
    } else {
      console.log(`[i18n] ${pair.name}: OK (${pair.es} covers ${pair.en})`);
    }

    // Optional signal for cleanup (does not fail): extra keys in es
    const extras = [];
    for (const key of esKeys) {
      if (!enKeys.has(key)) extras.push(key);
    }
    if (extras.length) {
      console.warn(`\n[i18n] ${pair.name}: note: ${pair.es} has ${extras.length} extra key(s) not present in ${pair.en}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

await main();