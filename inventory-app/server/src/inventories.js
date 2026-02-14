import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function registryPath() {
  return process.env.INVENTORY_REGISTRY_PATH || null;
}

export function inventoriesRoot() {
  return process.env.INVENTORY_INVENTORIES_ROOT || null;
}

export function loadRegistry() {
  const regPath = registryPath();
  if (!regPath) return null;

  try {
    const raw = fs.readFileSync(regPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.inventories) && typeof parsed.activeId === 'string') {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

export function listInventoriesFromRegistry(reg) {
  const invs = Array.isArray(reg?.inventories) ? reg.inventories : [];
  return invs.map(({ id, name }) => ({ id: String(id), name: String(name || id) }));
}

export function resolveInventoryDataDir(reg, inventoryId) {
  const invs = Array.isArray(reg?.inventories) ? reg.inventories : [];
  const match = invs.find(i => String(i?.id) === String(inventoryId));
  const dataDir = match?.dataDir ? String(match.dataDir) : null;
  if (dataDir) ensureDir(dataDir);
  return dataDir;
}

export function defaultInventoryId(reg) {
  const invs = Array.isArray(reg?.inventories) ? reg.inventories : [];
  if (typeof reg?.activeId === 'string' && invs.some(i => String(i?.id) === reg.activeId)) return reg.activeId;
  const first = invs[0]?.id;
  return first ? String(first) : 'default';
}

export function ensureDefaultSingleInventory(rootDir) {
  // For non-Electron / legacy mode: one inventory in INVENTORY_DATA_DIR.
  // We synthesize a registry-like record so the rest of the server can treat it uniformly.
  const dir = rootDir || path.join(process.cwd(), 'data');
  ensureDir(dir);
  return {
    activeId: 'default',
    inventories: [{ id: 'default', name: 'Default', dataDir: dir }]
  };
}
