const API = '/api';

let restaurantsList = [];
let activeRestaurantId = null;
let tables = [];
let currentSelection = null;
let mesaTypes = []; // [{id, label, w, h, builtin}]

// Estado do modo Reposicionar
let editMode = false;
let pendingPositions = {};
let pendingScales = {};
let originalState = {};
let activeDrag = null;
let editingTableId = null;

const $ = id => document.getElementById(id);
const apiRoot = () => activeRestaurantId ? `${API}/restaurants/${activeRestaurantId}` : API;

// ---------- Boot ----------
async function init() {
  await loadRestaurantsList();
  if (!restaurantsList.length) {
    setStatus('Nenhum restaurante encontrado', 'error');
    return;
  }
  // Tenta restaurar último selecionado, senão pega o default
  const saved = localStorage.getItem('activeRestaurantId');
  activeRestaurantId = restaurantsList.find(r => r.id === saved)?.id || restaurantsList[0].id;
  $('restaurant-select').value = activeRestaurantId;
  await refreshAll();
}

async function loadRestaurantsList() {
  try {
    const res = await fetch(`${API}/restaurants`);
    const data = await res.json();
    restaurantsList = data.restaurants || [];
    const select = $('restaurant-select');
    select.innerHTML = restaurantsList.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    updateDeleteBtn();
  } catch (e) { setStatus(`Erro ao listar restaurantes: ${e.message}`, 'error'); }
}

function updateDeleteBtn() {
  const btn = $('delete-restaurant-btn');
  btn.disabled = !activeRestaurantId || activeRestaurantId === 'default';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function changeRestaurant(id) {
  activeRestaurantId = id;
  localStorage.setItem('activeRestaurantId', id);
  updateDeleteBtn();
  if (editMode) cancelEditMode();
  await refreshAll();
}

async function deleteCurrentRestaurant() {
  if (!activeRestaurantId || activeRestaurantId === 'default') return;
  const r = restaurantsList.find(r => r.id === activeRestaurantId);
  if (!confirm(`Remover restaurante "${r?.name}"? Essa ação não pode ser desfeita.`)) return;
  try {
    const res = await fetch(`${API}/restaurants/${activeRestaurantId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus('Restaurante removido', 'success');
    activeRestaurantId = 'default';
    localStorage.removeItem('activeRestaurantId');
    await loadRestaurantsList();
    $('restaurant-select').value = activeRestaurantId;
    await refreshAll();
  } catch (e) { setStatus(e.message, 'error'); }
}

// ---------- Modal: novo restaurante ----------
function openNewRestaurantModal() {
  $('nr-name').value = '';
  $('nr-api-key').value = '';
  $('nr-photo').value = '';
  $('nr-prompt').value = '';
  $('nr-progress').hidden = true;
  $('nr-create-btn').disabled = false;
  $('new-restaurant-modal').hidden = false;
  $('nr-name').focus();
}

function closeNewRestaurantModal() {
  $('new-restaurant-modal').hidden = true;
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const result = fr.result; // "data:image/png;base64,..."
      const b64 = String(result).split(',')[1];
      resolve(b64);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function createRestaurant() {
  const name = $('nr-name').value.trim();
  if (!name) { alert('Informe um nome para o restaurante'); return; }
  const apiKey = $('nr-api-key').value.trim();
  const photo = $('nr-photo').files[0];
  const prompt = $('nr-prompt').value.trim();
  if (!apiKey) { alert('Informe a chave da OpenAI'); return; }
  if (!photo) { alert('Selecione uma foto do restaurante'); return; }
  await createWithAi({ name, apiKey, photo, prompt });
}

async function createWithAi({ name, apiKey, photo, prompt }) {
  setNrBusy(true, 'Criando restaurante…');
  let timer = null;
  let newId = null;
  let createOk = false;
  let plantaOk = false;
  let aiError = null;
  try {
    // 1) Cria o restaurante
    console.log('[create] POST /api/restaurants', { name });
    const r1 = await fetch(`${API}/restaurants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d1 = await r1.json();
    console.log('[create] response', r1.status, d1);
    if (!r1.ok) throw new Error(d1.error || `Erro ao criar (HTTP ${r1.status})`);
    newId = d1.restaurant.id;
    createOk = true;

    // 2) Gera planta via OpenAI (pode demorar 1-2 min)
    console.log('[create] convertendo foto para base64...', { size: photo.size, type: photo.type });
    const imageBase64 = await fileToBase64(photo);
    console.log('[create] base64 size:', imageBase64.length, 'chars');

    const startedAt = Date.now();
    const updateTimer = () => {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      setNrBusy(true, `Gerando planta com OpenAI… ${sec}s (típico 60–90s)`);
    };
    updateTimer();
    timer = setInterval(updateTimer, 1000);

    console.log('[create] POST /planta/generate começando...');
    const r2 = await fetch(`${API}/restaurants/${newId}/planta/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, imageBase64, mimeType: photo.type, prompt }),
    });
    clearInterval(timer); timer = null;
    const d2 = await r2.json();
    console.log('[create] /planta/generate response', r2.status, d2);
    if (!r2.ok) {
      aiError = d2.error || `OpenAI HTTP ${r2.status}`;
      throw new Error(`Falha na geração da planta: ${aiError}`);
    }
    plantaOk = true;
    setStatus(`Restaurante "${name}" criado com planta gerada por IA`, 'success');

    // 3) Pré-carrega o novo restaurante ANTES de fechar o modal
    setNrBusy(true, 'Carregando dados do restaurante…');
    activeRestaurantId = newId;
    localStorage.setItem('activeRestaurantId', activeRestaurantId);
    await loadRestaurantsList();
    const sel = $('restaurant-select');
    if (sel) sel.value = activeRestaurantId;
    await refreshAll();

    // Sucesso → fecha modal
    closeNewRestaurantModal();
  } catch (e) {
    console.error('[create] erro:', e);
    if (timer) clearInterval(timer);
    // Se o restaurante foi criado mas a geração falhou, remove ele pra não deixar lixo
    if (createOk && !plantaOk && newId) {
      try {
        await fetch(`${API}/restaurants/${newId}`, { method: 'DELETE' });
        console.log('[create] restaurante incompleto removido:', newId);
      } catch (delErr) { console.warn('Falha ao remover lixo:', delErr); }
    }
    alert(`Erro: ${e.message}\n\nO restaurante NÃO foi criado. Verifique a chave da OpenAI e tente novamente.`);
    // Modal fica aberto para o usuário corrigir
  } finally {
    if (timer) clearInterval(timer);
    setNrBusy(false);
  }
}

function setNrBusy(busy, msg = '') {
  $('nr-create-btn').disabled = busy;
  // cancelar sempre disponível (a chamada da OpenAI já foi disparada — fechar o modal não a interrompe)
  $('nr-progress').hidden = !busy;
  if (msg) $('nr-progress-text').textContent = msg;
}

// ---------- Carregar planta + dados ----------
async function refreshAll() {
  await Promise.all([loadFloorplan(), loadData()]);
  renderSelection();
  if (editMode) attachDragHandlers();
  else attachClickHandlers();
}

async function loadFloorplan() {
  try {
    const res = await fetch(`${apiRoot()}/tables/image`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    const container = $('map-container');
    container.innerHTML = '';
    container.appendChild(svg);
    setStatus('Planta carregada', 'success');
  } catch (e) { setStatus(`Erro ao carregar planta: ${e.message}`, 'error'); }
}

async function loadData() {
  const res = await fetch(`${apiRoot()}/tables`);
  const data = await res.json();
  tables = data.tables;
  currentSelection = data.currentSelection;
}

async function loadMesaTypes() {
  try {
    const res = await fetch(`${API}/mesas`);
    const data = await res.json();
    mesaTypes = data.mesas || [];
    populateAddMesaSelect();
  } catch (e) { console.warn('mesas:', e.message); }
}

function populateAddMesaSelect() {
  const sel = $('add-mesa-type');
  if (!sel) return;
  sel.innerHTML = mesaTypes.map(m =>
    `<option value="${m.id}">${m.builtin ? '' : '✨ '}${m.label}</option>`
  ).join('');
}

// ---------- Modo seleção ----------
function attachClickHandlers() {
  document.querySelectorAll('#map-container .table-group').forEach(g => {
    const id = parseInt(g.dataset.tableId, 10);
    if (g.classList.contains('available')) g.addEventListener('click', () => selectTable(id));
  });
}

async function selectTable(tableId) {
  try {
    const res = await fetch(`${apiRoot()}/tables/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`Mesa ${tableId} reservada e bloqueada`, 'success');
    await refreshAll();
  } catch (e) { setStatus(e.message, 'error'); }
}

async function releaseTable() {
  if (!currentSelection) return;
  const tableId = currentSelection.tableId;
  try {
    const res = await fetch(`${apiRoot()}/tables/select`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`Mesa ${tableId} liberada`, 'success');
    await refreshAll();
  } catch (e) { setStatus(e.message, 'error'); }
}

// ---------- Modo reposicionar ----------
function svgPoint(svg, clientX, clientY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d };
}

function attachDragHandlers() {
  const svg = document.querySelector('#map-container svg');
  if (!svg) return;
  document.querySelectorAll('#map-container .table-group').forEach(g => {
    g.addEventListener('pointerdown', onDragStart);
    g.addEventListener('wheel', onTableWheel, { passive: false });
  });
}

function getCurrentScale(id) {
  const t = tables.find(t => t.id === id);
  const pend = pendingScales[id];
  return { x: pend?.x ?? t.scaleX ?? 1, y: pend?.y ?? t.scaleY ?? 1 };
}

function getBaseDims(id) {
  const g = document.querySelector(`#map-container .table-group[data-table-id="${id}"]`);
  if (!g) return { w: 100, h: 100 };
  return { w: parseFloat(g.dataset.baseW) || 100, h: parseFloat(g.dataset.baseH) || 100 };
}

function applyTransform(g, id) {
  const t = tables.find(t => t.id === id);
  const x = pendingPositions[id]?.x ?? t.x;
  const y = pendingPositions[id]?.y ?? t.y;
  const s = getCurrentScale(id);
  const scalePart = (s.x === 1 && s.y === 1) ? '' : ` scale(${s.x}, ${s.y})`;
  g.setAttribute('transform', `translate(${x}, ${y})${scalePart}`);
}

function onDragStart(e) {
  if (!editMode) return;
  e.preventDefault();
  const g = e.currentTarget;
  const id = parseInt(g.dataset.tableId, 10);
  const svg = document.querySelector('#map-container svg');
  const t = tables.find(t => t.id === id);
  const cur = pendingPositions[id] || { x: t.x, y: t.y };
  const pt = svgPoint(svg, e.clientX, e.clientY);
  activeDrag = { id, group: g, svg, offset: { x: pt.x - cur.x, y: pt.y - cur.y } };
  g.classList.add('dragging');
  g.setPointerCapture?.(e.pointerId);
  g.addEventListener('pointermove', onDragMove);
  g.addEventListener('pointerup', onDragEnd);
  g.addEventListener('pointercancel', onDragEnd);
  selectTableForEdit(id);
}

function onDragMove(e) {
  if (!activeDrag) return;
  const pt = svgPoint(activeDrag.svg, e.clientX, e.clientY);
  pendingPositions[activeDrag.id] = { x: pt.x - activeDrag.offset.x, y: pt.y - activeDrag.offset.y };
  applyTransform(activeDrag.group, activeDrag.id);
}

function onDragEnd() {
  if (!activeDrag) return;
  activeDrag.group.classList.remove('dragging');
  activeDrag.group.removeEventListener('pointermove', onDragMove);
  activeDrag.group.removeEventListener('pointerup', onDragEnd);
  activeDrag.group.removeEventListener('pointercancel', onDragEnd);
  activeDrag = null;
}

function onTableWheel(e) {
  if (!editMode) return;
  e.preventDefault();
  const g = e.currentTarget;
  const id = parseInt(g.dataset.tableId, 10);
  const cur = getCurrentScale(id);
  const step = e.deltaY < 0 ? 0.05 : -0.05;
  const nx = Math.max(0.3, Math.min(3, cur.x + step));
  const ny = Math.max(0.3, Math.min(3, cur.y + step));
  pendingScales[id] = { x: Math.round(nx * 100) / 100, y: Math.round(ny * 100) / 100 };
  applyTransform(g, id);
  selectTableForEdit(id);
  syncDimensionInputs(id);
}

function selectTableForEdit(id) {
  editingTableId = id;
  const select = $('edit-table-select');
  if (select) select.value = String(id);
}

function syncDimensionInputs(id) {
  if (!id) return;
  const base = getBaseDims(id);
  const s = getCurrentScale(id);
  $('edit-width').value = Math.round(base.w * s.x);
  $('edit-height').value = Math.round(base.h * s.y);
}

function populateEditSelect() {
  $('edit-table-select').innerHTML = tables.map(t => `<option value="${t.id}">Mesa ${t.id}</option>`).join('');
}

function onDimensionInput() {
  if (!editingTableId) return;
  const base = getBaseDims(editingTableId);
  const w = parseFloat($('edit-width').value);
  const h = parseFloat($('edit-height').value);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const sx = Math.max(0.2, Math.min(4, w / base.w));
  const sy = Math.max(0.2, Math.min(4, h / base.h));
  pendingScales[editingTableId] = { x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100 };
  const g = document.querySelector(`#map-container .table-group[data-table-id="${editingTableId}"]`);
  if (g) applyTransform(g, editingTableId);
}

function onEditTableSelectChange() {
  editingTableId = parseInt($('edit-table-select').value, 10);
  syncDimensionInputs(editingTableId);
}

function enterEditMode() {
  editMode = true;
  pendingPositions = {};
  pendingScales = {};
  originalState = Object.fromEntries(tables.map(t => [t.id, { x: t.x, y: t.y, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1 }]));
  document.body.classList.add('edit-mode');
  $('edit-buttons-idle').hidden = true;
  $('edit-buttons-active').hidden = false;
  populateEditSelect();
  loadMesaTypes(); // tipos disponíveis pro botão de adicionar
  editingTableId = tables[0]?.id ?? null;
  if (editingTableId) {
    $('edit-table-select').value = String(editingTableId);
    syncDimensionInputs(editingTableId);
  }
  attachDragHandlers();
  setStatus('Modo Reposicionar — arraste, scroll ou edite largura/altura', '');
}

async function addMesaToRestaurant() {
  const sel = $('add-mesa-type');
  const mesaTypeKey = sel?.value;
  if (!mesaTypeKey) return;
  // Salva pendentes antes (pra não perder)
  if (Object.keys(pendingPositions).length || Object.keys(pendingScales).length) {
    if (!confirm('Você tem alterações pendentes não salvas. Salvar antes de adicionar a nova mesa?')) return;
    await savePositions();
    enterEditMode();
  }
  try {
    const res = await fetch(`${apiRoot()}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mesaTypeKey, x: 700, y: 540 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`Mesa ${data.table.id} adicionada — arraste pra posicioná-la`, 'success');
    await loadData();
    await loadFloorplan();
    populateEditSelect();
    attachDragHandlers();
    editingTableId = data.table.id;
    $('edit-table-select').value = String(editingTableId);
    syncDimensionInputs(editingTableId);
  } catch (e) { setStatus(e.message, 'error'); }
}

async function deleteSelectedTable() {
  if (!editingTableId) return;
  if (!confirm(`Excluir Mesa ${editingTableId}?`)) return;
  try {
    const res = await fetch(`${apiRoot()}/tables/${editingTableId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`Mesa ${editingTableId} removida`, 'success');
    delete pendingPositions[editingTableId];
    delete pendingScales[editingTableId];
    await loadData();
    await loadFloorplan();
    populateEditSelect();
    attachDragHandlers();
    editingTableId = tables[0]?.id ?? null;
    if (editingTableId) {
      $('edit-table-select').value = String(editingTableId);
      syncDimensionInputs(editingTableId);
    }
  } catch (e) { setStatus(e.message, 'error'); }
}

// ---------- Modal: gerar nova mesa via IA + rembg ----------
function openGenMesaModal() {
  $('gm-label').value = '';
  $('gm-api-key').value = '';
  $('gm-prompt').value = '';
  $('gm-w').value = 200;
  $('gm-h').value = 200;
  $('gm-progress').hidden = true;
  $('gm-create-btn').disabled = false;
  $('gen-mesa-modal').hidden = false;
  $('gm-label').focus();
}
function closeGenMesaModal() { $('gen-mesa-modal').hidden = true; }

async function generateMesa() {
  const label = $('gm-label').value.trim();
  const apiKey = $('gm-api-key').value.trim();
  const prompt = $('gm-prompt').value.trim();
  const width = parseInt($('gm-w').value, 10);
  const height = parseInt($('gm-h').value, 10);
  if (!label) { alert('Informe um nome'); return; }
  if (!apiKey) { alert('Informe a chave OpenAI'); return; }
  setGmBusy(true, 'Gerando imagem com OpenAI…');
  let timer = null;
  const startedAt = Date.now();
  const tick = () => setGmBusy(true, `Gerando + removendo fundo… ${Math.round((Date.now()-startedAt)/1000)}s`);
  tick();
  timer = setInterval(tick, 1000);
  try {
    const res = await fetch(`${API}/mesas/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, label, prompt, width, height }),
    });
    clearInterval(timer); timer = null;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`Modelo "${label}" gerado e disponível`, 'success');
    closeGenMesaModal();
    await loadMesaTypes();
    // Sugere o novo modelo no dropdown de adicionar
    if (data.mesa?.id) {
      const sel = $('add-mesa-type');
      if (sel) sel.value = data.mesa.id;
    }
  } catch (e) {
    alert(`Erro: ${e.message}`);
  } finally {
    if (timer) clearInterval(timer);
    setGmBusy(false);
  }
}

function setGmBusy(busy, msg = '') {
  $('gm-create-btn').disabled = busy;
  $('gm-progress').hidden = !busy;
  if (msg) $('gm-progress-text').textContent = msg;
}

function exitEditMode() {
  editMode = false;
  pendingPositions = {};
  pendingScales = {};
  document.body.classList.remove('edit-mode');
  $('edit-buttons-idle').hidden = false;
  $('edit-buttons-active').hidden = true;
}

async function savePositions() {
  const ids = new Set([...Object.keys(pendingPositions), ...Object.keys(pendingScales)]);
  const positions = [...ids].map(idStr => {
    const id = parseInt(idStr, 10);
    const t = tables.find(t => t.id === id);
    const p = pendingPositions[id] || { x: t.x, y: t.y };
    const s = pendingScales[id] || { x: t.scaleX ?? 1, y: t.scaleY ?? 1 };
    return { id, x: p.x, y: p.y, scaleX: s.x, scaleY: s.y };
  });
  if (!positions.length) { exitEditMode(); await refreshAll(); return; }
  try {
    const res = await fetch(`${apiRoot()}/tables/positions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro');
    setStatus(`${positions.length} mesa(s) atualizada(s)`, 'success');
    exitEditMode();
    await refreshAll();
  } catch (e) { setStatus(e.message, 'error'); }
}

function cancelEditMode() {
  const ids = new Set([...Object.keys(pendingPositions), ...Object.keys(pendingScales)]);
  for (const idStr of ids) {
    const orig = originalState[idStr];
    if (orig) {
      const g = document.querySelector(`#map-container .table-group[data-table-id="${idStr}"]`);
      if (g) {
        const sp = (orig.scaleX === 1 && orig.scaleY === 1) ? '' : ` scale(${orig.scaleX}, ${orig.scaleY})`;
        g.setAttribute('transform', `translate(${orig.x}, ${orig.y})${sp}`);
      }
    }
  }
  setStatus('Mudanças descartadas', '');
  exitEditMode();
}

// ---------- Sidebar ----------
function renderSelection() {
  const info = $('selection-info');
  const btn = $('clear-btn');
  if (currentSelection) {
    const t = tables.find(x => x.id === currentSelection.tableId);
    const shapeLabel = {
      round_2: 'Redonda 2 lug.',
      round_4: 'Redonda 4 lug.',
      square_4: 'Quadrada 4 lug.',
      rect_6: 'Retangular 6 lug.',
      rect_8: 'Retangular 8 lug.',
    }[`${t.shape}_${t.seats}`] || `${t.seats} lugares`;
    info.className = 'selection-filled';
    info.innerHTML = `<strong>Mesa ${t.id}</strong><br><span>Tipo: ${shapeLabel}</span><br><span>Área: ${t.area}</span><br><small style="color:#6b5a45">${new Date(currentSelection.selectedAt).toLocaleString('pt-BR')}</small>`;
    btn.disabled = false;
  } else {
    info.className = 'selection-empty';
    info.textContent = 'Nenhuma mesa selecionada';
    btn.disabled = true;
  }
}

function setStatus(msg, type = '') {
  const el = $('status-msg');
  el.textContent = msg;
  el.className = type;
}

// ---------- Eventos (null-safe) ----------
function on(id, evt, fn) {
  const el = $(id);
  if (el) el.addEventListener(evt, fn);
  else console.warn(`[init] elemento #${id} não encontrado — verifique se o HTML está atualizado`);
}
function onSel(sel, evt, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener(evt, fn);
  else console.warn(`[init] elemento ${sel} não encontrado`);
}

on('clear-btn', 'click', releaseTable);
on('edit-toggle-btn', 'click', enterEditMode);
on('edit-save-btn', 'click', savePositions);
on('edit-cancel-btn', 'click', cancelEditMode);
on('edit-table-select', 'change', onEditTableSelectChange);
on('edit-width', 'input', onDimensionInput);
on('edit-height', 'input', onDimensionInput);
on('restaurant-select', 'change', e => changeRestaurant(e.target.value));
on('new-restaurant-btn', 'click', openNewRestaurantModal);
on('delete-restaurant-btn', 'click', deleteCurrentRestaurant);
on('nr-create-btn', 'click', createRestaurant);
on('nr-cancel-btn', 'click', closeNewRestaurantModal);
on('nr-close-x', 'click', closeNewRestaurantModal);
onSel('#new-restaurant-modal .modal-backdrop', 'click', closeNewRestaurantModal);
on('add-mesa-btn', 'click', addMesaToRestaurant);
on('edit-delete-btn', 'click', deleteSelectedTable);
on('open-gen-mesa-btn', 'click', openGenMesaModal);
on('gm-create-btn', 'click', generateMesa);
on('gm-cancel-btn', 'click', closeGenMesaModal);
on('gm-close-x', 'click', closeGenMesaModal);
onSel('#gen-mesa-modal .modal-backdrop', 'click', closeGenMesaModal);
document.addEventListener('keydown', e => {
  const modal = $('new-restaurant-modal');
  if (e.key === 'Escape' && modal && !modal.hidden) closeNewRestaurantModal();
});

init();
