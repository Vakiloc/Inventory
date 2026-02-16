import { createApiClient } from './apiClient.js';
import {
  createInventoryFromUi as createInventoryFromUiImpl,
  loadInventories as loadInventoriesImpl,
  renderInventories as renderInventoriesImpl,
  switchInventory as switchInventoryImpl
} from './inventories.js';
import { createScanner } from './scanner.js';
import { registerDevice, signIn } from './webauthn.js';
import { showPairing } from './pairing.js';
import { createLookupsController } from './lookups.js';
import { createItemsController } from './itemsUi.js';
import { createSyncQueue } from './syncQueue.js';
import { newEventId } from './utils.js';
import { applyI18nToDom, getActiveLocale, setUserLocale, t } from './i18n/index.js';

// Dev-only diagnostic: detect unexpected attempts to close the window.
if (!globalThis.__INVENTORY_TEST__ && typeof window !== 'undefined' && typeof window.close === 'function') {
  const _close = window.close.bind(window);
  window.close = (...args) => {
    // eslint-disable-next-line no-console
    console.warn('renderer: window.close called', new Error('window.close').stack);
    return _close(...args);
  };
}

let serverUrl;
let token;
let role = 'owner';

let lastSyncAtMs = Number(localStorage.getItem('lastSyncAtMs')) || 0;
let online = true;

const api = createApiClient({
  getBaseUrl: () => serverUrl,
  getToken: () => token
});

const el = (id) => document.getElementById(id);

const syncQueue = createSyncQueue({
  api,
  onStatusChange(pending) {
    const badge = el('pendingBadge');
    if (badge) {
      badge.textContent = pending > 0 ? `(${pending} pending)` : '';
      badge.style.display = pending > 0 ? 'inline' : 'none';
    }
  }
});

// Apply i18n to initial DOM content (English remains the default).
applyI18nToDom(document);

// Language selector
try {
  const sel = document.getElementById('localeSelect');
  if (sel) {
    sel.value = getActiveLocale();
    sel.addEventListener('change', () => {
      setUserLocale(sel.value);
      // Simplest way to ensure all dynamic strings refresh.
      window.location.reload();
    });
  }
} catch {
  // ignore
}

const statusEl = el('status');

const scanner = createScanner({ el, setStatus, onScanned: handleScannedBarcode });

let inventories = [];
let activeInventoryId = null;

function setStatus(msg, type = 'info') {
  statusEl.textContent = msg;
  statusEl.className = 'status-bar'; // reset
  if (type !== 'info') {
    statusEl.classList.add(`status-${type}`);
  }
}

function setStatusBrief(msg, ms = 1200) {
  const token = String(Date.now()) + Math.random();
  globalThis.__lastStatusToken = token;
  setStatus(msg);
  setTimeout(() => {
    if (globalThis.__lastStatusToken === token) {
      if (activeInventoryId) {
        setStatus(`Inventory: ${activeInventoryId}`);
      } else {
        setStatus('');
      }
    }
  }, ms);
}

function formatWhen(ms) {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

function formatItemOption(it) {
  const qty = typeof it?.quantity === 'number' ? it.quantity : 0;
  const id = it?.item_id;
  const name = it?.name || t('items.unnamed');
  return t('items.optionFormat', { name, qty, id });
}

async function chooseItemViaDialog({ title, hint, items, allowCreate }) {
  const dlg = el('chooseItemDialog');
  const titleEl = el('chooseItemTitle');
  const hintEl = el('chooseItemHint');
  const sel = el('chooseItemSelect');
  const createBtn = el('chooseItemCreate');

  if (!dlg || !titleEl || !hintEl || !sel || !createBtn) {
    throw new Error('Missing choose-item dialog elements');
  }

  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return { action: 'cancel' };

  titleEl.textContent = title || t('dialog.chooseItem.title');
  hintEl.textContent = hint || '';

  // Clear options
  sel.textContent = '';
  for (const it of list) {
    const opt = document.createElement('option');
    opt.value = String(it.item_id);
    opt.textContent = formatItemOption(it);
    sel.appendChild(opt);
  }
  sel.selectedIndex = 0;

  createBtn.style.display = allowCreate ? '' : 'none';

  return new Promise((resolve) => {
    const onCreate = () => {
      dlg.returnValue = 'create';
      dlg.close();
    };

    const onClose = () => {
      createBtn.removeEventListener('click', onCreate);

      const rv = String(dlg.returnValue || '').toLowerCase();
      if (rv === 'create') {
        resolve({ action: 'create_new' });
        return;
      }

      if (rv === 'choose' || rv === 'default') {
        const itemId = Number.parseInt(String(sel.value || ''), 10);
        const chosen = list.find((it) => it && it.item_id === itemId);
        if (chosen) resolve({ action: 'choose', item: chosen });
        else resolve({ action: 'cancel' });
        return;
      }

      resolve({ action: 'cancel' });
    };

    createBtn.addEventListener('click', onCreate);
    dlg.addEventListener('close', onClose, { once: true });
    dlg.showModal();
  });
}


async function handleScannedBarcode(code, target = 'quick') {
  if (target === 'access-code') {
    try {
      const payload = JSON.parse(code);
      if (!payload.baseUrl || !payload.code) throw new Error('Invalid access code');
      
      const onPhase = (phase, msg) => {
         console.log(`[Pairing] Phase: ${phase} - ${msg}`);
         setStatus(msg, phase === 'authenticator_prompt' ? 'action' : 'info');
         if (phase === 'authenticator_prompt') {
            document.body.classList.add('flash-action');
            setTimeout(() => document.body.classList.remove('flash-action'), 300);
         }
      };

      setStatus('Joining inventory...', 'info');
      
      const t = await registerDevice(payload.baseUrl, payload.code, 'Guest Desktop', onPhase);
      
      localStorage.setItem('remote_server_url', payload.baseUrl);
      localStorage.setItem('auth_token', t);
      setStatus('Joined! Reloading...', 'success');
      
      // Delay reload to let user see success message
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      console.error(e);
      setStatus(`Join failed: ${e.message}`, 'error');
    }
    return;
  }

  // If we are inside an item dialog, treat as setting the barcode field.
  if (target === 'item') {
    el('barcode').value = code;
    return;
  }

  const overrideMode = Boolean(el('scanNoIncrement')?.checked);

  // Quick scan mode: resolve barcode and either increment quantity or open the item.
  try {
    if (overrideMode) {
      if (!canEdit()) {
        setStatus(t('status.readOnly'));
        return;
      }

      const listRes = await api.fetchJson('/api/items');
      const items = Array.isArray(listRes.items) ? listRes.items : [];

      const choice = await chooseItemViaDialog({
        title: t('dialog.scanOverride.title'),
        hint: t('dialog.scanOverride.hint', { barcode: code }),
        items,
        allowCreate: true
      });
      if (!choice || choice.action === 'cancel') {
        setStatus(t('status.scanCancelled'));
        return;
      }

      if (choice.action === 'create_new') {
        openItemDialog({ barcode: code, quantity: 1 });
        return;
      }

      const chosen = choice.item;
      // Attach barcode to chosen item explicitly, then scan
      await api.fetchJson(`/api/items/${chosen.item_id}/barcodes`, {
        method: 'POST',
        body: JSON.stringify({ barcode: code })
      }).catch(() => { /* barcode may already be attached */ });

      const scanRes = await api.fetchJson('/api/scans', {
        method: 'POST',
        body: JSON.stringify({
          events: [{ event_id: newEventId(), barcode: code, delta: 1, item_id: chosen.item_id, scanned_at: Date.now() }]
        })
      });
      const r = scanRes.results?.[0];

      if (r && (r.status === 'applied' || r.status === 'duplicate') && r.item) {
        setStatusBrief(t('status.scanned', { name: r.item.name }));
        await refreshItems();
        openItemDialog(r.item);
        return;
      }

      setStatus(t('status.scanResultUnexpected'));
      return;
    }

    // Standard quick scan via unified endpoint
    const scanRes = await api.fetchJson('/api/scans', {
      method: 'POST',
      body: JSON.stringify({
        events: [{ event_id: newEventId(), barcode: code, delta: 1, scanned_at: Date.now() }]
      })
    });
    const r = scanRes.results?.[0];

    if (r && (r.status === 'applied' || r.status === 'duplicate') && r.item) {
      setStatusBrief(t('status.scanned', { name: r.item.name }));
      await refreshItems();
      if (canEdit()) openItemDialog(r.item);
      return;
    }

    if (r && r.status === 'not_found') {
      // Track unresolved barcodes in localStorage
      try {
        const key = 'inventory_unresolved_barcodes';
        const existing = JSON.parse(localStorage.getItem(key) || '[]');
        const entry = existing.find(e => e.barcode === code);
        if (entry) {
          entry.count++;
          entry.lastSeen = Date.now();
        } else {
          existing.push({ barcode: code, count: 1, firstSeen: Date.now(), lastSeen: Date.now() });
        }
        // Keep only the most recent 100
        if (existing.length > 100) existing.splice(0, existing.length - 100);
        localStorage.setItem(key, JSON.stringify(existing));
      } catch { /* ignore storage errors */ }

      if (canEdit()) openItemDialog({ barcode: code, quantity: 1 });
      else setStatus(t('status.barcodeNotFound'));
      return;
    }

    if (r && r.status === 'ambiguous' && Array.isArray(r.items) && r.items.length) {
      const choice = await chooseItemViaDialog({
        title: t('dialog.multipleMatches.title'),
        hint: t('dialog.multipleMatches.hint', { barcode: code }),
        items: r.items,
        allowCreate: false
      });
      if (!choice || choice.action !== 'choose') {
        setStatus(t('status.scanCancelled'));
        return;
      }

      const chosen = choice.item;

      const scanRes2 = await api.fetchJson('/api/scans', {
        method: 'POST',
        body: JSON.stringify({
          events: [{ event_id: newEventId(), barcode: code, delta: 1, item_id: chosen.item_id, scanned_at: Date.now() }]
        })
      });
      const r2 = scanRes2.results?.[0];

      if (r2 && (r2.status === 'applied' || r2.status === 'duplicate') && r2.item) {
        setStatus(t('status.incrementedQuantity', { name: r2.item.name }));
        await refreshItems();
        if (canEdit()) openItemDialog(r2.item);
        return;
      }

      setStatus(t('status.scanResultUnexpected'));
      return;
    }

    setStatus(t('status.scanResultUnexpected'));
  } catch (e) {
    setStatus(t('status.scanError', { error: e?.message || String(e) }));
  }
}

function canEdit() {
  return role !== 'viewer';
}

function applyRoleToUi() {
  const editable = canEdit();
  el('add').disabled = !editable;
  el('addCategory').disabled = !editable;
  el('addLocation').disabled = !editable;
  el('newCategory').disabled = !editable;
  el('newLocation').disabled = !editable;
  el('editCategory').disabled = !editable;
  el('deleteCategory').disabled = !editable;
  el('editLocation').disabled = !editable;
  el('deleteLocation').disabled = !editable;
  el('scanInput').disabled = false; // scanning/search still allowed
}

async function getServerUrl() {
  if (!window.inventory) {
    console.error('getServerUrl: window.inventory is undefined. Use Electron to run this app.');
    // Check if we are running in a browser environment
    if (typeof window !== 'undefined' && window.location.protocol.startsWith('http')) {
       console.warn('Falling back to localhost:443 for browser debugging');
       return 'https://localhost:443';
    }
    throw new Error('Electron context bridge not available');
  }
  const resp = await window.inventory.getServerUrl();
  return resp.serverUrl;
}

function renderInventories() {
  renderInventoriesImpl({ el, inventories, activeInventoryId });
}

async function loadInventories() {
  await loadInventoriesImpl({
    windowInventory: window.inventory,
    setInventories: (v) => {
      inventories = v;
    },
    setActiveInventoryId: (v) => {
      activeInventoryId = v;
    },
    renderInventories
  });
}

async function switchInventory(nextId) {
  return switchInventoryImpl({
    nextId,
    windowInventory: window.inventory,
    activeInventoryId,
    setStatus,
    setActiveInventoryId: (v) => {
      activeInventoryId = v;
    },
    clearToken: () => {
      token = null;
    },
    loadToken,
    refreshLookups,
    refreshItems
  });
}

async function createInventoryFromUi() {
  return createInventoryFromUiImpl({
    el,
    windowInventory: window.inventory,
    setStatus,
    reloadInventories: loadInventories,
    clearToken: () => {
      token = null;
    },
    loadToken,
    refreshLookups,
    refreshItems
  });
}

async function loadToken() {
  const res = await fetch(`${serverUrl}/api/admin/token`);
  const body = await res.json();
  token = body.token;
}

function optionAll(label) {
  const o = document.createElement('option');
  o.value = '';
  o.textContent = label;
  return o;
}

function optionItem(value, label) {
  const o = document.createElement('option');
  o.value = String(value);
  o.textContent = label;
  return o;
}

let itemsUi;

const lookups = createLookupsController({
  el,
  api,
  canEdit,
  setStatus,
  optionAll,
  optionItem,
  renderItems: () => itemsUi.renderItems()
});

itemsUi = createItemsController({
  el,
  api,
  canEdit,
  setStatus,
  categoryName: (id) => lookups.categoryName(id),
  locationName: (id) => lookups.locationName(id),
  getStatusSuffix: () => (lastSyncAtMs ? `Last sync: ${formatWhen(lastSyncAtMs)}` : '')
});

function renderItems() {
  return itemsUi.renderItems();
}

async function refreshItems() {
  try {
    setStatus('Syncing…');
    // Flush any pending offline operations before pulling
    await syncQueue.flush();
    await itemsUi.refreshItems();
    lastSyncAtMs = Date.now();
    localStorage.setItem('lastSyncAtMs', String(lastSyncAtMs));
    online = true;
    // Refresh status line with the new last-sync timestamp.
    itemsUi.renderItems();
  } catch (e) {
    online = false;
    setStatus(`Sync error: ${e.message}`);
  }
}

function openItemDialog(item) {
  return itemsUi.openItemDialog(item);
}

function cancelItemDialog() {
  return itemsUi.cancelItemDialog();
}

async function saveItem() {
  return itemsUi.saveItem();
}

async function deleteItem() {
  return itemsUi.deleteItem();
}

async function addAltBarcode() {
  return itemsUi.addAltBarcode();
}

async function refreshLookups() {
  await lookups.refreshLookups();
  syncFilterBar();
}

function updateLookupActionButtons() {
  return lookups.updateLookupActionButtons();
}

async function addCategory() {
  return lookups.addCategory();
}

async function addLocation() {
  return lookups.addLocation();
}

async function renameSelectedCategory() {
  return lookups.renameSelectedCategory();
}

async function deleteSelectedCategory() {
  return lookups.deleteSelectedCategory({ refreshItems });
}

async function renameSelectedLocation() {
  return lookups.renameSelectedLocation();
}

async function deleteSelectedLocation() {
  return lookups.deleteSelectedLocation({ refreshItems });
}

function toggleSidebar() {
  const sidebar = el('sidebar');
  const layout = sidebar?.closest('.layout');
  const isCollapsed = sidebar?.classList.toggle('collapsed');
  if (layout) layout.classList.toggle('sidebar-collapsed', isCollapsed);
  localStorage.setItem('sidebarCollapsed', isCollapsed ? '1' : '');
}

function restoreSidebarState() {
  if (localStorage.getItem('sidebarCollapsed') === '1') {
    const sidebar = el('sidebar');
    const layout = sidebar?.closest('.layout');
    sidebar?.classList.add('collapsed');
    if (layout) layout.classList.add('sidebar-collapsed');
  }
}

function syncFilterBar() {
  const mainCat = el('mainCategoryFilter');
  const mainLoc = el('mainLocationFilter');
  const sidebarCat = el('categoryFilter');
  const sidebarLoc = el('locationFilter');

  if (mainCat && sidebarCat) {
    mainCat.innerHTML = sidebarCat.innerHTML;
    mainCat.value = sidebarCat.value;
  }
  if (mainLoc && sidebarLoc) {
    mainLoc.innerHTML = sidebarLoc.innerHTML;
    mainLoc.value = sidebarLoc.value;
  }
}

function wireUi() {
  restoreSidebarState();

  const sidebarToggle = el('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar);
  }

  // Main filter bar: sync selections bidirectionally with sidebar
  const mainCat = el('mainCategoryFilter');
  const mainLoc = el('mainLocationFilter');

  if (mainCat) {
    mainCat.addEventListener('change', () => {
      const sidebarCat = el('categoryFilter');
      if (sidebarCat) sidebarCat.value = mainCat.value;
      updateLookupActionButtons();
      renderItems();
    });
  }

  if (mainLoc) {
    mainLoc.addEventListener('change', () => {
      const sidebarLoc = el('locationFilter');
      if (sidebarLoc) sidebarLoc.value = mainLoc.value;
      updateLookupActionButtons();
      renderItems();
    });
  }

  const clearBtn = el('clearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (mainCat) mainCat.value = '';
      if (mainLoc) mainLoc.value = '';
      const sidebarCat = el('categoryFilter');
      const sidebarLoc = el('locationFilter');
      if (sidebarCat) sidebarCat.value = '';
      if (sidebarLoc) sidebarLoc.value = '';
      updateLookupActionButtons();
      renderItems();
    });
  }

  const copyBtn = el('copyPairPayload');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const text = el('pairPayload')?.value || '';
        if (!text) throw new Error('Nothing to copy');
        await navigator.clipboard.writeText(text);
        setStatus('Pairing JSON copied');
      } catch (e) {
        setStatus(`Copy failed: ${e.message}`);
      }
    });
  }

  const invSel = el('inventorySelect');
  if (invSel) {
    invSel.addEventListener('change', async () => {
      try {
        await switchInventory(invSel.value);
      } catch (e) {
        invSel.value = activeInventoryId || invSel.value;
        setStatus(`Switch error: ${e.message}`);
      }
    });
  }

  const addInv = el('addInventory');
  if (addInv) {
    addInv.addEventListener('click', async () => {
      try {
        await createInventoryFromUi();
      } catch (e) {
        setStatus(`Create inventory error: ${e.message}`);
      }
    });
  }

  el('sync').addEventListener('click', refreshItems);
  el('add').addEventListener('click', () => openItemDialog(null));

  el('share').addEventListener('click', async () => {
    try {
      await showPairing({ el, serverUrl, windowInventory: window.inventory });
    } catch (e) {
      setStatus(`Share error: ${e.message}`);
    }
  });

  el('scanAccessCode').addEventListener('click', async () => {
    try {
      await scanner.startWebcamScan('access-code');
    } catch (e) {
      scanner.stopWebcamScan();
      setStatus(`Camera error: ${e.message}`);
    }
  });

  el('webcamScan').addEventListener('click', async () => {
    try {
      await scanner.startWebcamScan('quick');
    } catch (e) {
      scanner.stopWebcamScan();
      setStatus(`Camera error: ${e.message}`);
    }
  });

  el('scanBarcode').addEventListener('click', async () => {
    try {
      await scanner.startWebcamScan('item');
    } catch (e) {
      scanner.stopWebcamScan();
      setStatus(`Camera error: ${e.message}`);
    }
  });

  const bcCorrupted = el('barcodeCorrupted');
  if (bcCorrupted) {
    const apply = () => {
      const checked = Boolean(bcCorrupted.checked);
      const input = el('barcode');
      if (!input) return;
      input.disabled = checked;
      if (checked) input.value = '';
    };
    bcCorrupted.addEventListener('change', apply);
    el('itemDialog').addEventListener('close', () => {
      // reset to default enabled
      const input = el('barcode');
      if (input) input.disabled = false;
    });
    apply();
  }

  el('addAltBarcode').addEventListener('click', addAltBarcode);

  el('scanDialog').addEventListener('close', () => {
    scanner.stopWebcamScan();
  });

  el('role').addEventListener('change', () => {
    role = el('role').value;
    localStorage.setItem('role', role);
    applyRoleToUi();
    renderItems();
  });

  el('search').addEventListener('input', renderItems);
  el('categoryFilter').addEventListener('change', () => {
    // Sync sidebar filter to main filter bar
    if (mainCat) mainCat.value = el('categoryFilter').value;
    updateLookupActionButtons();
    renderItems();
  });
  el('locationFilter').addEventListener('change', () => {
    // Sync sidebar filter to main filter bar
    if (mainLoc) mainLoc.value = el('locationFilter').value;
    updateLookupActionButtons();
    renderItems();
  });

  el('addCategory').addEventListener('click', addCategory);
  el('addLocation').addEventListener('click', addLocation);

  el('editCategory').addEventListener('click', async () => {
    try {
      await renameSelectedCategory();
    } catch (e) {
      setStatus(`Rename error: ${e.message}`);
    }
  });
  el('deleteCategory').addEventListener('click', async () => {
    try {
      await deleteSelectedCategory();
    } catch (e) {
      setStatus(`Delete error: ${e.message}`);
    }
  });
  el('editLocation').addEventListener('click', async () => {
    try {
      await renameSelectedLocation();
    } catch (e) {
      setStatus(`Rename error: ${e.message}`);
    }
  });
  el('deleteLocation').addEventListener('click', async () => {
    try {
      await deleteSelectedLocation();
    } catch (e) {
      setStatus(`Delete error: ${e.message}`);
    }
  });

  el('delete').addEventListener('click', async () => {
    await deleteItem();
    el('itemDialog').close();
  });

  el('cancelItem').addEventListener('click', cancelItemDialog);

  // Esc key on <dialog> triggers a cancel event: intercept to apply dirty-check.
  el('itemDialog').addEventListener('cancel', (e) => {
    e.preventDefault();
    cancelItemDialog();
  });

  el('itemForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await saveItem();
      el('itemDialog').close();
      setStatus('Saved');
    } catch (err) {
      setStatus(`Save error: ${err?.message || err}`);
    }
  });

  // USB scanner-friendly: focus and press enter to search/add
  el('scanInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const code = el('scanInput').value.trim();
    if (!code) return;

    // Treat USB scan same as webcam scan: server resolves/increments.
    await handleScannedBarcode(code, 'quick');
    el('scanInput').value = '';
  });

  // Keyboard shortcuts (desktop QoL)
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;

    const isMod = e.ctrlKey || e.metaKey;
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase?.() || '';
    const inTextField = tag === 'input' || tag === 'textarea' || active?.isContentEditable;

    // Mod+K: focus search
    if (isMod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      el('search')?.focus?.();
      return;
    }

    // Mod+L: focus quick scan input
    if (isMod && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      el('scanInput')?.focus?.();
      return;
    }

    // Mod+N: add item
    if (isMod && (e.key === 'n' || e.key === 'N')) {
      if (!canEdit()) return;
      e.preventDefault();
      openItemDialog(null);
      return;
    }

    // Mod+S: save item dialog if open
    if (isMod && (e.key === 's' || e.key === 'S')) {
      const dlg = el('itemDialog');
      if (dlg?.open) {
        e.preventDefault();
        const form = el('itemForm');
        if (form?.requestSubmit) form.requestSubmit();
        else form?.dispatchEvent?.(new Event('submit', { cancelable: true }));
      }
      return;
    }

    // Mod+B: toggle sidebar
    if (isMod && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      toggleSidebar();
      return;
    }

    // "/": focus search (avoid stealing when typing)
    if (!inTextField && e.key === '/') {
      e.preventDefault();
      el('search')?.focus?.();
    }
  });
}

// Periodic connectivity check: ping server every 15s, auto-flush queue when reconnected.
let connectivityTimer = null;
function startConnectivityCheck() {
  if (connectivityTimer) return;
  connectivityTimer = setInterval(async () => {
    try {
      await api.fetchJson('/api/ping');
      if (!online) {
        online = true;
        // Came back online - flush pending and refresh
        await syncQueue.flush();
        await refreshItems();
      }
    } catch {
      online = false;
    }
  }, 15_000);
}

async function boot() {
  try {
    const remoteUrl = localStorage.getItem('remote_server_url');
    if (remoteUrl) {
      serverUrl = remoteUrl;
      token = localStorage.getItem('auth_token');
      setStatus(`Connecting to remote server: ${serverUrl}`);
    } else {
      setStatus('Connecting to local server…');
      serverUrl = await getServerUrl();
      await loadInventories();
      await loadToken();
    }

    await refreshLookups();
    await refreshItems();
    role = localStorage.getItem('role') || 'owner';
    el('role').value = role;
    applyRoleToUi();
    updateLookupActionButtons();
    wireUi();
    startConnectivityCheck();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
}

export { boot };

// Allow tests to import the module without auto-booting.
if (!globalThis.__INVENTORY_TEST__) {
  boot();
}
