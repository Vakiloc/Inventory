import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line import/no-commonjs
const en = require('./en.json');

const BUNDLES = {
  en
};

function normalizeLocale(locale) {
  const raw = String(locale || '').trim();
  if (!raw) return 'en';
  const base = raw.split(/[-_]/)[0];
  return base ? base.toLowerCase() : 'en';
}

export function resolveLocaleFromRequest(req) {
  // Prefer explicit override if present.
  const q = req?.query?.locale;
  if (typeof q === 'string' && q.trim()) return normalizeLocale(q);

  // Parse Accept-Language: "es-ES,es;q=0.9,en;q=0.8"
  const header = String(req?.header?.('accept-language') || req?.headers?.['accept-language'] || '').trim();
  if (!header) return 'en';

  const first = header.split(',')[0];
  const lang = first.split(';')[0];
  return normalizeLocale(lang);
}

function format(template, params) {
  const str = String(template ?? '');
  if (!params) return str;
  return str.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) return String(params[key]);
    return m;
  });
}

export function t(locale, key, params) {
  const loc = normalizeLocale(locale);
  const k = String(key || '').trim();
  if (!k) return '';

  const bundle = BUNDLES[loc] || BUNDLES.en;
  const msg = bundle[k] ?? BUNDLES.en[k];
  if (msg == null) return k;
  return format(msg, params);
}

export function errorKeyForCode(code) {
  const c = String(code || '').trim();
  if (!c) return 'errors.unknown';
  return `errors.${c}`;
}
