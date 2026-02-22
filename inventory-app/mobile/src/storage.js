/**
 * Local storage layer for mobile app preferences and offline data.
 * Uses localStorage (available in Capacitor WebView) for simplicity.
 * Mirrors Android's DataStore Preferences + pending queue tables.
 */

const PREFS_KEY = 'inventory_prefs';
const ITEMS_KEY = 'inventory_items';
const CATEGORIES_KEY = 'inventory_categories';
const LOCATIONS_KEY = 'inventory_locations';
const PENDING_SCANS_KEY = 'inventory_pending_scans';
const PENDING_CREATES_KEY = 'inventory_pending_creates';
const PENDING_UPDATES_KEY = 'inventory_pending_updates';

// --- Preferences ---

const defaultPrefs = {
  baseUrl: '',
  token: '',
  inventoryId: '',
  locale: 'en',
  lastSyncMs: 0,
  itemsSinceMs: 0,
  barcodeSinceMs: 0,
  bootstrapped: false
};

export function getPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaultPrefs, ...JSON.parse(raw) } : { ...defaultPrefs };
  } catch {
    return { ...defaultPrefs };
  }
}

export function setPrefs(partial) {
  const current = getPrefs();
  const updated = { ...current, ...partial };
  localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
  return updated;
}

export function clearPrefs() {
  localStorage.removeItem(PREFS_KEY);
}

export function isPaired() {
  const p = getPrefs();
  return Boolean(p.baseUrl && p.token);
}

// --- Items cache ---

export function getItems() {
  try {
    return JSON.parse(localStorage.getItem(ITEMS_KEY) || '[]');
  } catch { return []; }
}

export function setItems(items) {
  localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
}

export function upsertItems(incoming) {
  const current = getItems();
  const map = new Map(current.map(i => [i.item_id, i]));
  for (const item of incoming) {
    map.set(item.item_id, item);
  }
  const result = [...map.values()];
  setItems(result);
  return result;
}

// --- Categories cache ---

export function getCategories() {
  try {
    return JSON.parse(localStorage.getItem(CATEGORIES_KEY) || '[]');
  } catch { return []; }
}

export function setCategories(cats) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(cats));
}

// --- Locations cache ---

export function getLocations() {
  try {
    return JSON.parse(localStorage.getItem(LOCATIONS_KEY) || '[]');
  } catch { return []; }
}

export function setLocations(locs) {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locs));
}

// --- Pending scan events (offline queue) ---

export function getPendingScans() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SCANS_KEY) || '[]');
  } catch { return []; }
}

export function addPendingScan(event) {
  const scans = getPendingScans();
  scans.push(event);
  localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify(scans));
}

export function setPendingScans(scans) {
  localStorage.setItem(PENDING_SCANS_KEY, JSON.stringify(scans));
}

// --- Pending item creates (offline queue) ---

export function getPendingCreates() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_CREATES_KEY) || '[]');
  } catch { return []; }
}

export function addPendingCreate(item) {
  const creates = getPendingCreates();
  creates.push(item);
  localStorage.setItem(PENDING_CREATES_KEY, JSON.stringify(creates));
}

export function setPendingCreates(creates) {
  localStorage.setItem(PENDING_CREATES_KEY, JSON.stringify(creates));
}

// --- Pending item updates (offline queue) ---

export function getPendingUpdates() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_UPDATES_KEY) || '[]');
  } catch { return []; }
}

export function addPendingUpdate(item) {
  const updates = getPendingUpdates();
  updates.push(item);
  localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(updates));
}

export function setPendingUpdates(updates) {
  localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(updates));
}

// --- Clear all data (for unpair) ---

export function clearAllData() {
  clearPrefs();
  localStorage.removeItem(ITEMS_KEY);
  localStorage.removeItem(CATEGORIES_KEY);
  localStorage.removeItem(LOCATIONS_KEY);
  localStorage.removeItem(PENDING_SCANS_KEY);
  localStorage.removeItem(PENDING_CREATES_KEY);
  localStorage.removeItem(PENDING_UPDATES_KEY);
}

// --- Utility ---

export function getTotalPending() {
  return getPendingScans().length + getPendingCreates().length + getPendingUpdates().length;
}
