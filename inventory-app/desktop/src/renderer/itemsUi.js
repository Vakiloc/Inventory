import { t } from './i18n/index.js';

export function createItemsController({
  el,
  api,
  canEdit,
  setStatus,
  categoryName,
  locationName,
  getStatusSuffix
}) {
  if (typeof el !== 'function') throw new Error('createItemsController: el is required');
  if (!api?.fetchJson) throw new Error('createItemsController: api is required');
  if (typeof canEdit !== 'function') throw new Error('createItemsController: canEdit is required');
  if (typeof setStatus !== 'function') throw new Error('createItemsController: setStatus is required');
  if (typeof categoryName !== 'function') throw new Error('createItemsController: categoryName is required');
  if (typeof locationName !== 'function') throw new Error('createItemsController: locationName is required');
  if (getStatusSuffix != null && typeof getStatusSuffix !== 'function') {
    throw new Error('createItemsController: getStatusSuffix must be a function');
  }

  const itemsTbody = el('items');

  let items = [];
  let itemDialogSnapshot = null;

  function formatWhen(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.toLocaleString();
  }

  function readItemFormState() {
    return {
      item_id: el('itemId').value ? Number(el('itemId').value) : null,
      name: el('name').value,
      description: el('description').value,
      quantity: el('quantity').value,
      value: el('value').value,
      category_id: el('categoryId').value,
      location_id: el('locationId').value,
      barcode: el('barcode').value,
      barcode_corrupted: el('barcodeCorrupted')?.checked ? 1 : 0,
      serial_number: el('serial').value,
      purchase_date: el('purchase').value,
      warranty_info: el('warranty').value,
      photo_path: el('photo').value
    };
  }

  function writeItemFormState(s) {
    el('itemId').value = s?.item_id ?? '';
    el('name').value = s?.name ?? '';
    el('description').value = s?.description ?? '';
    el('quantity').value = s?.quantity ?? 1;
    el('value').value = s?.value ?? '';
    el('categoryId').value = s?.category_id ?? '';
    el('locationId').value = s?.location_id ?? '';
    el('barcode').value = s?.barcode ?? '';
    if (el('barcodeCorrupted')) el('barcodeCorrupted').checked = (s?.barcode_corrupted ?? 0) === 1;
    el('serial').value = s?.serial_number ?? '';
    el('purchase').value = s?.purchase_date ?? '';
    el('warranty').value = s?.warranty_info ?? '';
    el('photo').value = s?.photo_path ?? '';
  }

  function isDirty(a, b) {
    const sa = JSON.stringify(a ?? {});
    const sb = JSON.stringify(b ?? {});
    return sa !== sb;
  }

  function cancelItemDialog() {
    const dlg = el('itemDialog');
    const current = readItemFormState();
    const dirty = isDirty(current, itemDialogSnapshot);

    if (dirty) {
      const ok = window.confirm(t('confirm.discardUnsavedChanges'));
      if (!ok) return;
    }

    // Reset form to snapshot (so reopening starts clean)
    writeItemFormState(itemDialogSnapshot);
    dlg.close('cancel');
    setStatus(t('status.canceled'));
  }

  function renderItems() {
    const q = el('search').value.trim().toLowerCase();
    const catId = el('categoryFilter').value;
    const locId = el('locationFilter').value;

    const filtered = items.filter(it => {
      if (it.deleted === 1) return false;
      if (catId && String(it.category_id ?? '') !== catId) return false;
      if (locId && String(it.location_id ?? '') !== locId) return false;
      if (!q) return true;

      const hay = `${it.name || ''} ${it.barcode || ''} ${it.serial_number || ''}`.toLowerCase();
      return hay.includes(q);
    });

    itemsTbody.innerHTML = '';

    async function applyQtyDelta(item, delta) {
      if (!canEdit()) return;
      const id = item?.item_id;
      if (!id) return;
      const current = Number(item.quantity ?? 0);
      const next = Math.max(0, current + Number(delta ?? 0));
      const code = String(item?.barcode || '').trim();
      try {
        // If the item has a barcode, represent +/- as scan events so shared barcodes remain
        // deterministic across devices (server applies using item_id).
        if (code && (item?.barcode_corrupted ?? 0) !== 1) {
          const eventId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
          await api.fetchJson('/api/scans/apply', {
            method: 'POST',
            body: JSON.stringify({
              events: [{
                event_id: eventId,
                barcode: code,
                delta: Number(delta ?? 0),
                scanned_at: Date.now(),
                item_id: Number(id)
              }]
            })
          });
        } else {
          await api.fetchJson(`/api/items/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity: next, last_modified: Date.now() })
          });
        }
        await refreshItems();
        setStatus(t('status.quantityUpdated', { name: item.name }));
      } catch (e) {
        setStatus(t('status.quantityError', { error: e.message }));
      }
    }

    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'empty';

      if (items.length === 0) {
        td.textContent = canEdit()
          ? t('items.empty.noItemsYetCanEdit')
          : t('items.empty.noItemsYetReadOnly');
      } else if (q || catId || locId) {
        td.textContent = t('items.empty.noMatch');
      } else {
        td.textContent = t('items.empty.noItemsToDisplay');
      }

      tr.appendChild(td);
      itemsTbody.appendChild(tr);
    }

    for (const it of filtered) {
      const tr = document.createElement('tr');

      const tdWarn = document.createElement('td');
      if ((it.barcode_corrupted ?? 0) === 1) {
        tdWarn.textContent = '⚠';
        tdWarn.title = t('item.field.barcode.corrupted');
      } else {
        tdWarn.textContent = '';
      }

      const tdName = document.createElement('td');
      tdName.textContent = it.name;

      const tdQty = document.createElement('td');
      const qtyWrap = document.createElement('div');
      qtyWrap.style.display = 'flex';
      qtyWrap.style.alignItems = 'center';
      qtyWrap.style.gap = '6px';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'btn';
      minusBtn.textContent = '-';
      minusBtn.disabled = !canEdit();
      minusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        applyQtyDelta(it, -1);
      });

      const qtyText = document.createElement('span');
      qtyText.textContent = String(it.quantity ?? 0);

      const plusBtn = document.createElement('button');
      plusBtn.className = 'btn';
      plusBtn.textContent = '+';
      plusBtn.disabled = !canEdit();
      plusBtn.addEventListener('click', (e) => {
        e.preventDefault();
        applyQtyDelta(it, +1);
      });

      qtyWrap.appendChild(minusBtn);
      qtyWrap.appendChild(qtyText);
      qtyWrap.appendChild(plusBtn);
      tdQty.appendChild(qtyWrap);

      const tdCat = document.createElement('td');
      tdCat.textContent = categoryName(it.category_id);

      const tdLoc = document.createElement('td');
      tdLoc.textContent = locationName(it.location_id);

      const tdBar = document.createElement('td');
      tdBar.textContent = it.barcode || '';

      const tdMod = document.createElement('td');
      tdMod.textContent = formatWhen(it.last_modified);

      const tdActions = document.createElement('td');
      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.textContent = t('common.edit');
      editBtn.disabled = !canEdit();
      editBtn.addEventListener('click', () => openItemDialog(it));
      tdActions.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger';
      delBtn.textContent = t('common.delete');
      delBtn.style.marginLeft = '8px';
      delBtn.disabled = !canEdit();
      delBtn.addEventListener('click', async () => {
        if (!canEdit()) return;
        const ok = window.confirm(t('confirm.deleteItem', { name: it.name }));
        if (!ok) return;
        try {
          await api.fetchJson(`/api/items/${it.item_id}`, { method: 'DELETE' });
          await refreshItems();
          setStatus(t('status.deleted', { name: it.name }));
        } catch (e) {
          setStatus(t('status.deleteError', { error: e.message }));
        }
      });
      tdActions.appendChild(delBtn);

      tr.appendChild(tdWarn);
      tr.appendChild(tdName);
      tr.appendChild(tdQty);
      tr.appendChild(tdCat);
      tr.appendChild(tdLoc);
      tr.appendChild(tdBar);
      tr.appendChild(tdMod);
      tr.appendChild(tdActions);

      itemsTbody.appendChild(tr);
    }

    const suffix = getStatusSuffix ? String(getStatusSuffix() || '').trim() : '';
    const suffixPart = suffix ? ` · ${suffix}` : '';
    setStatus(t('status.loadedItems', { count: filtered.length, suffixPart }));
  }

  async function refreshItems() {
    const data = await api.fetchJson('/api/items');
    items = data.items;
    renderItems();
  }

  async function refreshAltBarcodes(itemId) {
    const section = el('altBarcodesSection');
    const box = el('altBarcodes');
    box.textContent = '';

    if (!itemId) {
      section.style.display = 'none';
      return;
    }

    try {
      const res = await api.fetchJson(`/api/items/${itemId}/barcodes`);
      const codes = Array.isArray(res.barcodes) ? res.barcodes.map(b => b.barcode).filter(Boolean) : [];
      section.style.display = 'block';
      box.textContent = codes.length ? codes.join('\n') : t('item.altBarcodes.none');
    } catch {
      section.style.display = 'block';
      box.textContent = t('item.altBarcodes.errorLoading');
    }
  }

  function openItemDialog(item) {
    if (!canEdit()) return;
    const dlg = el('itemDialog');
    el('dialogTitle').textContent = item?.item_id
      ? t('dialog.item.editTitle', { id: item.item_id })
      : t('dialog.item.addTitle');
    el('delete').style.display = item?.item_id ? 'inline-block' : 'none';

    writeItemFormState({
      item_id: item?.item_id ?? '',
      name: item?.name ?? '',
      description: item?.description ?? '',
      quantity: item?.quantity ?? 1,
      value: item?.value ?? '',
      category_id: item?.category_id ?? '',
      location_id: item?.location_id ?? '',
      barcode: item?.barcode ?? '',
      barcode_corrupted: item?.barcode_corrupted ?? 0,
      serial_number: item?.serial_number ?? '',
      purchase_date: item?.purchase_date ?? '',
      warranty_info: item?.warranty_info ?? '',
      photo_path: item?.photo_path ?? ''
    });

    itemDialogSnapshot = readItemFormState();

    refreshAltBarcodes(item?.item_id);

    dlg.showModal();

    try {
      const checked = Boolean(el('barcodeCorrupted')?.checked);
      const input = el('barcode');
      if (input) {
        input.disabled = checked;
        if (checked) input.value = '';
      }
    } catch {
      // ignore
    }

    // Make manual entry reliable: focus name field on open.
    setTimeout(() => {
      try {
        el('name')?.focus();
      } catch {
        // ignore
      }
    }, 0);
  }

  async function addAltBarcode() {
    const itemId = el('itemId').value;
    if (!itemId) return;
    const code = el('altBarcodeInput').value.trim();
    if (!code) return;

    try {
      await api.fetchJson(`/api/items/${itemId}/barcodes`, {
        method: 'POST',
        body: JSON.stringify({ barcode: code })
      });
      el('altBarcodeInput').value = '';
      await refreshAltBarcodes(Number(itemId));
      setStatus('Barcode added');
    } catch (e) {
      if (e.status === 409 && e.body?.item_id) {
        setStatus(`Barcode already used by item #${e.body.item_id}`);
      } else {
        setStatus(`Add barcode error: ${e.message}`);
      }
    }
  }

  async function saveItem() {
    const id = el('itemId').value;

    const trimmedName = el('name').value.trim();
    if (!trimmedName) {
      setStatus('Name is required');
      try {
        el('name')?.focus();
      } catch {
        // ignore
      }
      return;
    }

    const rawBarcode = String(el('barcode').value || '').trim();
    const corrupted = Boolean(el('barcodeCorrupted')?.checked);
    const normalizedBarcode = rawBarcode ? rawBarcode : null;

    const payload = {
      name: trimmedName,
      description: el('description').value || null,
      quantity: Number(el('quantity').value || 0),
      value: el('value').value === '' ? null : Number(el('value').value),
      category_id: el('categoryId').value ? Number(el('categoryId').value) : null,
      location_id: el('locationId').value ? Number(el('locationId').value) : null,
      barcode: corrupted ? null : normalizedBarcode,
      barcode_corrupted: corrupted ? 1 : 0,
      serial_number: el('serial').value || null,
      purchase_date: el('purchase').value || null,
      warranty_info: el('warranty').value || null,
      photo_path: el('photo').value || null
    };

    if (id) {
      await api.fetchJson(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api.fetchJson('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    }

    await refreshItems();
  }

  async function deleteItem() {
    const id = el('itemId').value;
    if (!id) return;
    await api.fetchJson(`/api/items/${id}`, { method: 'DELETE' });
    await refreshItems();
  }

  return {
    renderItems,
    refreshItems,
    openItemDialog,
    cancelItemDialog,
    saveItem,
    deleteItem,
    addAltBarcode
  };
}
