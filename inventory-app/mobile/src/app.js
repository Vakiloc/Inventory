/**
 * Inventory Mobile — Main application entry point.
 *
 * Manages screen navigation, item rendering, pairing, scanning, and sync.
 */

import { api } from './api.js';
import * as store from './storage.js';
import { syncOnce, queueScan, queueItemCreate } from './sync.js';
import { initNetwork, isOnline, onStatusChange, stopPeriodicSync } from './network.js';

// --- DOM helpers ---
const el = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Screen navigation ---
function showScreen(id) {
  for (const s of $$('.screen')) s.classList.remove('active');
  el(id)?.classList.add('active');

  // Update bottom nav active state
  for (const nav of $$('.nav-item')) {
    nav.classList.toggle('active', nav.dataset.screen === id);
  }
}

// --- Pairing ---
async function handlePairFromQr(payload) {
  const statusEl = el('pair-status');
  try {
    statusEl.textContent = 'Pairing...';
    statusEl.className = 'status-msg';

    let data;
    if (typeof payload === 'string') data = JSON.parse(payload);
    else data = payload;

    if (!data.baseUrl) throw new Error('Invalid pairing data: missing baseUrl');

    // If there's a code, exchange it for a token
    if (data.code) {
      const res = await fetch(`${data.baseUrl}/api/pair/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: data.code,
          device_id: crypto.randomUUID(),
          name: 'Mobile Device'
        })
      });
      if (!res.ok) throw new Error(`Pairing failed: ${res.status}`);
      const body = await res.json();
      data.token = body.token;
    }

    if (!data.token) throw new Error('Invalid pairing data: no token');

    store.setPrefs({
      baseUrl: data.baseUrl,
      token: data.token,
      bootstrapped: false
    });

    statusEl.textContent = 'Paired! Syncing...';
    statusEl.className = 'status-msg success';

    await syncOnce();
    showScreen('screen-items');
    renderItems();
    renderLookups();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'status-msg error';
  }
}

// --- Items rendering ---
function renderItems() {
  const list = el('items-list');
  if (!list) return;

  let items = store.getItems().filter(i => !i.deleted);
  const categories = store.getCategories();
  const locations = store.getLocations();

  // Search filter
  const query = (el('search')?.value || '').toLowerCase().trim();
  if (query) {
    items = items.filter(i =>
      (i.name || '').toLowerCase().includes(query) ||
      (i.barcode || '').toLowerCase().includes(query) ||
      (i.serial_number || '').toLowerCase().includes(query)
    );
  }

  // Category filter
  const catFilter = el('filter-category')?.value;
  if (catFilter) items = items.filter(i => String(i.category_id) === catFilter);

  // Location filter
  const locFilter = el('filter-location')?.value;
  if (locFilter) items = items.filter(i => String(i.location_id) === locFilter);

  const catMap = new Map(categories.map(c => [c.category_id, c.name]));
  const locMap = new Map(locations.map(l => [l.location_id, l.name]));

  if (items.length === 0) {
    list.innerHTML = '<div style="text-align:center; padding:40px; color:var(--muted);">No items found</div>';
  } else {
    list.innerHTML = items.map(i => `
      <div class="item-card" data-id="${i.item_id}">
        <div class="item-info">
          <div class="item-name">${esc(i.name || 'Unnamed')}</div>
          <div class="item-meta">${esc(catMap.get(i.category_id) || '')}${i.category_id && i.location_id ? ' · ' : ''}${esc(locMap.get(i.location_id) || '')}</div>
        </div>
        <div class="item-qty">${i.quantity ?? 0}</div>
      </div>
    `).join('');
  }

  // Status
  const pending = store.getTotalPending();
  const prefs = store.getPrefs();
  const syncText = prefs.lastSyncMs ? `Last sync: ${new Date(prefs.lastSyncMs).toLocaleTimeString()}` : '';
  const pendingText = pending > 0 ? ` · ${pending} pending` : '';
  const offlineText = !isOnline() ? ' · Offline' : '';
  el('items-status').textContent = `${items.length} items${pendingText}${offlineText}${syncText ? ' · ' + syncText : ''}`;
}

function renderLookups() {
  const categories = store.getCategories();
  const locations = store.getLocations();

  // Filter dropdowns
  for (const selId of ['filter-category', 'item-category']) {
    const sel = el(selId);
    if (!sel) continue;
    const val = sel.value;
    sel.innerHTML = '<option value="">All categories</option>' +
      categories.map(c => `<option value="${c.category_id}">${esc(c.name)}</option>`).join('');
    sel.value = val;
  }

  for (const selId of ['filter-location', 'item-location']) {
    const sel = el(selId);
    if (!sel) continue;
    const val = sel.value;
    sel.innerHTML = '<option value="">All locations</option>' +
      locations.map(l => `<option value="${l.location_id}">${esc(l.name)}</option>`).join('');
    sel.value = val;
  }
}

// --- Item detail ---
function openItemDetail(item) {
  el('item-id').value = item?.item_id || '';
  el('item-name').value = item?.name || '';
  el('item-description').value = item?.description || '';
  el('item-quantity').value = item?.quantity ?? 1;
  el('item-value').value = item?.value ?? '';
  el('item-category').value = item?.category_id || '';
  el('item-location').value = item?.location_id || '';
  el('item-barcode').value = item?.barcode || '';
  el('item-serial').value = item?.serial_number || '';
  el('item-purchase').value = item?.purchase_date || '';
  el('item-warranty').value = item?.warranty_info || '';
  el('detail-title').textContent = item?.item_id ? 'Edit Item' : 'New Item';
  el('btn-delete-item').style.display = item?.item_id > 0 ? '' : 'none';

  renderLookups();
  showScreen('screen-item-detail');
}

async function saveItem() {
  const itemId = el('item-id').value;
  const data = {
    name: el('item-name').value.trim(),
    description: el('item-description').value.trim() || null,
    quantity: parseInt(el('item-quantity').value) || 1,
    value: parseFloat(el('item-value').value) || null,
    category_id: parseInt(el('item-category').value) || null,
    location_id: parseInt(el('item-location').value) || null,
    barcode: el('item-barcode').value.trim() || null,
    serial_number: el('item-serial').value.trim() || null,
    purchase_date: el('item-purchase').value || null,
    warranty_info: el('item-warranty').value.trim() || null,
    last_modified: Date.now()
  };

  if (!data.name) { alert('Name is required'); return; }

  try {
    if (itemId && parseInt(itemId) > 0) {
      // Update
      await api.fetchJson(`/api/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
    } else {
      // Create
      await api.fetchJson('/api/items', {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }
    await syncOnce();
    renderItems();
    showScreen('screen-items');
  } catch (err) {
    // Offline — queue locally
    if (itemId && parseInt(itemId) > 0) {
      store.addPendingUpdate({ item_id: parseInt(itemId), data, state: 'pending', created_at: Date.now() });
    } else {
      queueItemCreate(data);
    }
    renderItems();
    showScreen('screen-items');
  }
}

async function deleteItem() {
  const itemId = parseInt(el('item-id').value);
  if (!itemId || itemId <= 0) return;
  if (!confirm('Delete this item?')) return;

  try {
    await api.fetchJson(`/api/items/${itemId}`, { method: 'DELETE' });
  } catch { /* will sync later */ }

  // Remove from local cache
  const items = store.getItems().filter(i => i.item_id !== itemId);
  store.setItems(items);
  renderItems();
  showScreen('screen-items');
}

// --- Barcode scanning ---
let scanStream = null;

async function startScan(target = 'quick') {
  showScreen('screen-scan');
  const video = el('scan-video');
  const resultEl = el('scan-result');
  resultEl.textContent = 'Point camera at a barcode...';

  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = scanStream;

    // Use ZXing for barcode detection
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();

    const onResult = async (result) => {
      if (!result) return;
      const code = result.getText();
      stopScan();

      if (target === 'item-barcode') {
        el('item-barcode').value = code;
        showScreen('screen-item-detail');
        return;
      }

      // Quick scan: try to apply on server
      resultEl.textContent = `Scanned: ${code}`;
      queueScan(code, 1);
      renderItems();
      updateScanQueueDisplay();

      // Try immediate server apply
      try {
        await syncOnce();
        renderItems();
      } catch { /* queued for later */ }
    };

    reader.decodeFromVideoElement(video, onResult);
  } catch (err) {
    resultEl.textContent = `Camera error: ${err.message}`;
  }
}

function stopScan() {
  if (scanStream) {
    for (const track of scanStream.getTracks()) track.stop();
    scanStream = null;
  }
}

function updateScanQueueDisplay() {
  const count = store.getPendingScans().length;
  el('scan-queue-count').textContent = String(count);
}

// --- Settings ---
function renderSettings() {
  const prefs = store.getPrefs();
  el('settings-server-url').textContent = prefs.baseUrl || 'Not paired';
  el('settings-last-sync').textContent = prefs.lastSyncMs ? new Date(prefs.lastSyncMs).toLocaleString() : 'Never';
  el('settings-pending').textContent = String(store.getTotalPending());
  const netEl = el('settings-network');
  if (netEl) netEl.textContent = isOnline() ? 'Connected' : 'Offline';
}

// --- Sync ---
async function doSync() {
  const statusEl = el('items-status');
  try {
    statusEl.textContent = 'Syncing...';
    await syncOnce();
    renderItems();
    renderSettings();
  } catch (err) {
    statusEl.textContent = `Sync error: ${err.message}`;
  }
}

function updateNetworkIndicator() {
  const online = isOnline();
  const indicator = el('network-status');
  if (indicator) {
    indicator.textContent = online ? 'Online' : 'Offline';
    indicator.className = `network-indicator ${online ? 'online' : 'offline'}`;
  }
}

// --- HTML escaping ---
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Wire UI ---
function wireUi() {
  // Bottom navigation
  for (const nav of $$('.nav-item')) {
    nav.addEventListener('click', () => {
      const target = nav.dataset.screen;
      if (target) {
        showScreen(target);
        if (target === 'screen-settings') renderSettings();
        if (target === 'screen-items') renderItems();
      }
    });
  }

  // Pair screen
  el('btn-scan-qr')?.addEventListener('click', () => startScan('pair-qr'));
  el('btn-paste-pair')?.addEventListener('click', async () => {
    const text = prompt('Paste pairing JSON:');
    if (text) await handlePairFromQr(text);
  });

  // Items screen
  el('btn-sync')?.addEventListener('click', doSync);
  el('btn-add-item')?.addEventListener('click', () => openItemDetail(null));
  el('search')?.addEventListener('input', renderItems);
  el('filter-category')?.addEventListener('change', renderItems);
  el('filter-location')?.addEventListener('change', renderItems);

  el('items-list')?.addEventListener('click', (e) => {
    const card = e.target.closest('.item-card');
    if (!card) return;
    const id = parseInt(card.dataset.id);
    const item = store.getItems().find(i => i.item_id === id);
    if (item) openItemDetail(item);
  });

  // Scan screen
  el('btn-scan')?.addEventListener('click', () => startScan('quick'));
  el('scan-back')?.addEventListener('click', () => { stopScan(); showScreen('screen-items'); });

  // Item detail
  el('detail-back')?.addEventListener('click', () => showScreen('screen-items'));
  el('item-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveItem(); });
  el('btn-delete-item')?.addEventListener('click', deleteItem);
  el('btn-scan-barcode')?.addEventListener('click', () => startScan('item-barcode'));

  // Settings
  el('btn-force-sync')?.addEventListener('click', doSync);
  el('btn-unpair')?.addEventListener('click', () => {
    if (!confirm('Unpair this device? All local data will be cleared.')) return;
    store.clearAllData();
    stopScan();
    stopPeriodicSync();
    showScreen('screen-pair');
  });
}

// --- Boot ---
async function boot() {
  wireUi();

  // Initialize network monitoring + periodic sync
  await initNetwork();
  updateNetworkIndicator();
  onStatusChange(() => {
    updateNetworkIndicator();
    renderItems(); // refresh status bar
  });

  if (store.isPaired()) {
    showScreen('screen-items');
    renderItems();
    renderLookups();

    // Initial sync
    doSync();
  } else {
    showScreen('screen-pair');
  }
}

boot();
