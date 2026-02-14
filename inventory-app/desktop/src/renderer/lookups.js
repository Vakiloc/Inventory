import { t } from './i18n/index.js';

export function createLookupsController({
  el,
  api,
  canEdit,
  setStatus,
  optionAll,
  optionItem,
  renderItems
}) {
  if (typeof el !== 'function') throw new Error('createLookupsController: el is required');
  if (!api?.fetchJson) throw new Error('createLookupsController: api is required');
  if (typeof canEdit !== 'function') throw new Error('createLookupsController: canEdit is required');
  if (typeof setStatus !== 'function') throw new Error('createLookupsController: setStatus is required');
  if (typeof optionAll !== 'function') throw new Error('createLookupsController: optionAll is required');
  if (typeof optionItem !== 'function') throw new Error('createLookupsController: optionItem is required');
  if (typeof renderItems !== 'function') throw new Error('createLookupsController: renderItems is required');

  let categories = [];
  let locations = [];

  function categoryName(id) {
    return categories.find(c => c.category_id === id)?.name || '';
  }

  function locationName(id) {
    return locations.find(l => l.location_id === id)?.name || '';
  }

  function updateLookupActionButtons() {
    const editable = canEdit();
    const catId = el('categoryFilter').value;
    const locId = el('locationFilter').value;

    el('editCategory').disabled = !editable || !catId;
    el('deleteCategory').disabled = !editable || !catId;
    el('editLocation').disabled = !editable || !locId;
    el('deleteLocation').disabled = !editable || !locId;
  }

  async function refreshLookups() {
    const cat = await api.fetchJson('/api/categories');
    const loc = await api.fetchJson('/api/locations');
    categories = cat.categories;
    locations = loc.locations;

    const catFilter = el('categoryFilter');
    const locFilter = el('locationFilter');
    const catSelect = el('categoryId');
    const locSelect = el('locationId');

    catFilter.innerHTML = '';
    locFilter.innerHTML = '';
    catSelect.innerHTML = '';
    locSelect.innerHTML = '';

    catFilter.appendChild(optionAll(t('filters.category.all')));
    locFilter.appendChild(optionAll(t('filters.location.all')));

    catSelect.appendChild(optionItem('', '—'));
    locSelect.appendChild(optionItem('', '—'));

    for (const c of categories) {
      catFilter.appendChild(optionItem(c.category_id, c.name));
      catSelect.appendChild(optionItem(c.category_id, c.name));
    }
    for (const l of locations) {
      locFilter.appendChild(optionItem(l.location_id, l.name));
      locSelect.appendChild(optionItem(l.location_id, l.name));
    }

    updateLookupActionButtons();
  }

  async function addCategory() {
    const name = el('newCategory').value.trim();
    if (!name) return;
    await api.fetchJson('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
    el('newCategory').value = '';
    await refreshLookups();
  }

  async function addLocation() {
    const name = el('newLocation').value.trim();
    if (!name) return;
    await api.fetchJson('/api/locations', { method: 'POST', body: JSON.stringify({ name, parent_id: null }) });
    el('newLocation').value = '';
    await refreshLookups();
  }

  async function renameSelectedCategory() {
    if (!canEdit()) return;
    const idStr = el('categoryFilter').value;
    if (!idStr) return;
    const id = Number(idStr);
    const current = categories.find(c => c.category_id === id);
    const nextName = window.prompt(t('prompt.renameCategory'), current?.name || '');
    const name = (nextName || '').trim();
    if (!name || name === current?.name) return;

    await api.fetchJson(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    await refreshLookups();
    el('categoryFilter').value = String(id);
    updateLookupActionButtons();
    renderItems();
    setStatus(t('status.categoryRenamed'));
  }

  async function deleteSelectedCategory({ refreshItems }) {
    if (!canEdit()) return;
    const idStr = el('categoryFilter').value;
    if (!idStr) return;
    const id = Number(idStr);
    const current = categories.find(c => c.category_id === id);
    const ok = window.confirm(t('confirm.deleteCategory', { name: current?.name || id }));
    if (!ok) return;

    await api.fetchJson(`/api/categories/${id}`, { method: 'DELETE' });
    await refreshLookups();
    el('categoryFilter').value = '';
    await refreshItems();
    updateLookupActionButtons();
    setStatus(t('status.categoryDeleted'));
  }

  async function renameSelectedLocation() {
    if (!canEdit()) return;
    const idStr = el('locationFilter').value;
    if (!idStr) return;
    const id = Number(idStr);
    const current = locations.find(l => l.location_id === id);
    const nextName = window.prompt(t('prompt.renameLocation'), current?.name || '');
    const name = (nextName || '').trim();
    if (!name || name === current?.name) return;

    await api.fetchJson(`/api/locations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, parent_id: current?.parent_id ?? null })
    });
    await refreshLookups();
    el('locationFilter').value = String(id);
    updateLookupActionButtons();
    renderItems();
    setStatus(t('status.locationRenamed'));
  }

  async function deleteSelectedLocation({ refreshItems }) {
    if (!canEdit()) return;
    const idStr = el('locationFilter').value;
    if (!idStr) return;
    const id = Number(idStr);
    const current = locations.find(l => l.location_id === id);
    const ok = window.confirm(t('confirm.deleteLocation', { name: current?.name || id }));
    if (!ok) return;

    await api.fetchJson(`/api/locations/${id}`, { method: 'DELETE' });
    await refreshLookups();
    el('locationFilter').value = '';
    await refreshItems();
    updateLookupActionButtons();
    setStatus(t('status.locationDeleted'));
  }

  return {
    refreshLookups,
    updateLookupActionButtons,
    addCategory,
    addLocation,
    renameSelectedCategory,
    deleteSelectedCategory,
    renameSelectedLocation,
    deleteSelectedLocation,
    categoryName,
    locationName,
  };
}
