import en from './en.json';
import es from './es.json';

const BUNDLES = {
  en,
  es
};

const LOCALE_STORAGE_KEY = 'inventory.locale';

function normalizeLocale(locale) {
  const raw = String(locale || '').trim();
  if (!raw) return 'en';

  // Normalize: "en-US" => "en"
  const base = raw.split(/[-_]/)[0];
  return base ? base.toLowerCase() : 'en';
}

export function getActiveLocale() {
  try {
    const stored = normalizeLocale(globalThis?.localStorage?.getItem?.(LOCALE_STORAGE_KEY));
    if (stored && stored !== 'en') return stored;
    if (stored === 'en') return 'en';
  } catch {
    // ignore
  }

  return normalizeLocale(globalThis?.navigator?.language || 'en');
}

export function setUserLocale(locale) {
  const loc = normalizeLocale(locale);
  try {
    if (!loc) {
      globalThis?.localStorage?.removeItem?.(LOCALE_STORAGE_KEY);
      return;
    }
    globalThis?.localStorage?.setItem?.(LOCALE_STORAGE_KEY, loc);
  } catch {
    // ignore
  }
}

export function getBundle(locale) {
  const loc = normalizeLocale(locale);
  return BUNDLES[loc] || BUNDLES.en;
}

function format(template, params) {
  const str = String(template ?? '');
  if (!params) return str;
  return str.replaceAll(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) return String(params[key]);
    return m;
  });
}

export function t(key, params) {
  const k = String(key || '').trim();
  if (!k) return '';
  const bundle = getBundle(getActiveLocale());
  const msg = bundle[k] ?? BUNDLES.en[k];
  if (msg == null) return k;
  return format(msg, params);
}

export function applyI18nToDom(root = document) {
  const scope = root || document;

  // Set lang attribute.
  try {
    if (scope?.documentElement) scope.documentElement.lang = getActiveLocale();
  } catch {
    // ignore
  }

  // Text nodes
  const textEls = scope.querySelectorAll?.('[data-i18n]') || [];
  for (const el of textEls) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    el.textContent = t(key);
  }

  // Placeholders
  const phEls = scope.querySelectorAll?.('[data-i18n-placeholder]') || [];
  for (const el of phEls) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) continue;
    el.setAttribute('placeholder', t(key));
  }

  // Element attributes (generic)
  const attrEls = scope.querySelectorAll?.('[data-i18n-attr]') || [];
  for (const el of attrEls) {
    const raw = el.getAttribute('data-i18n-attr');
    if (!raw) continue;

    // Format: "attrName:key"
    const [attrName, key] = raw.split(':');
    if (!attrName || !key) continue;
    el.setAttribute(attrName, t(key));
  }
}
