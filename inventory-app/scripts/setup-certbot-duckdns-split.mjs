#!/usr/bin/env node
/**
 * Interactive wrapper for DuckDNS + Certbot certificate setup.
 * Prompts for parameters and delegates to desktop/scripts/setup-certbot.mjs.
 *
 * Usage: node scripts/setup-certbot-duckdns-split.mjs
 *   or with args: node scripts/setup-certbot-duckdns-split.mjs --subdomains=app,idp --token=TOKEN --email=me@example.com
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const certbotScript = path.join(__dirname, '..', 'desktop', 'scripts', 'setup-certbot.mjs');

// Parse any CLI flags
const cliArgs = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const eq = a.indexOf('=');
      return eq > 0 ? [a.slice(0, eq), a.slice(eq + 1)] : [a, 'true'];
    })
);

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  console.log('=== DuckDNS Certificate Setup ===\n');

  const subdomains = cliArgs['--subdomains'] || await ask('DuckDNS subdomains (comma-separated, e.g. myapp,myapp-idp): ');
  const token = cliArgs['--token'] || await ask('DuckDNS token: ');
  const email = cliArgs['--email'] || await ask('Email for Let\'s Encrypt: ');
  const port = cliArgs['--web-app-port'] || await ask('Server port [443]: ') || '443';

  if (!subdomains || !token || !email) {
    console.error('All fields are required.');
    process.exit(1);
  }

  const args = [
    certbotScript,
    `--subdomains=${subdomains}`,
    `--token=${token}`,
    `--email=${email}`,
    `--web-app-port=${port}`
  ];

  try {
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

main();
