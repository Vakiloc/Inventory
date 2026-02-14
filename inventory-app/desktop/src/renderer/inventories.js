export function renderInventories({ el, inventories, activeInventoryId }) {
  const sel = el('inventorySelect');
  if (!sel) return;

  sel.innerHTML = '';
  for (const inv of inventories) {
    const o = document.createElement('option');
    o.value = String(inv.id);
    o.textContent = inv.name;
    sel.appendChild(o);
  }

  if (activeInventoryId) sel.value = activeInventoryId;
}

export async function loadInventories({
  windowInventory,
  setInventories,
  setActiveInventoryId,
  renderInventories
}) {
  if (!windowInventory?.listInventories) return;

  const res = await windowInventory.listInventories();
  const inventories = Array.isArray(res?.inventories) ? res.inventories : [];
  const activeId = typeof res?.activeId === 'string' ? res.activeId : null;

  setInventories(inventories);
  setActiveInventoryId(activeId);
  renderInventories();
}

export async function switchInventory({
  nextId,
  windowInventory,
  activeInventoryId,
  setStatus,
  setActiveInventoryId,
  clearToken,
  loadToken,
  refreshLookups,
  refreshItems
}) {
  const id = String(nextId || '').trim();
  if (!id) return;
  if (!windowInventory?.setActiveInventory) return;
  if (id === activeInventoryId) return;

  setStatus('Switching inventory…');
  const res = await windowInventory.setActiveInventory(id);
  if (res?.error) {
    if (res.error === 'in_use') {
      throw new Error('Another inventory server is already running on this port. Close it and try again.');
    }
    throw new Error(res.error);
  }

  setActiveInventoryId(id);
  clearToken();
  await loadToken();
  await refreshLookups();
  await refreshItems();
  setStatus('Inventory switched');
}

export async function createInventoryFromUi({
  el,
  windowInventory,
  setStatus,
  reloadInventories,
  clearToken,
  loadToken,
  refreshLookups,
  refreshItems
}) {
  const name = el('newInventory')?.value?.trim();
  if (!name) return;
  if (!windowInventory?.createInventory) return;

  setStatus('Creating inventory…');
  const res = await windowInventory.createInventory(name);
  if (res?.error) throw new Error(res.error);
  if (el('newInventory')) el('newInventory').value = '';

  await reloadInventories();
  clearToken();
  await loadToken();
  await refreshLookups();
  await refreshItems();
  setStatus('Inventory created');
}
