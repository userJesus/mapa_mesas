const API = '/api';

let tables = [];
let currentSelection = null;

// Estado do modo Reposicionar
let editMode = false;
let pendingPositions = {};      // { tableId: {x, y} }
let pendingScales = {};         // { tableId: {x, y} }   (scaleX, scaleY)
let originalState = {};         // backup pra cancelar
let activeDrag = null;
let editingTableId = null;      // mesa selecionada nos campos largura/altura

async function refreshAll() {
  await Promise.all([loadFloorplan(), loadData()]);
  renderSelection();
  if (editMode) attachDragHandlers();
  else attachClickHandlers();
}

async function loadFloorplan() {
  try {
    const res = await fetch(`${API}/tables/image`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    const container = document.getElementById('map-container');
    container.innerHTML = '';
    container.appendChild(svg);
    setStatus('Planta carregada', 'success');
  } catch (e) {
    setStatus(`Erro ao carregar planta: ${e.message}`, 'error');
  }
}

async function loadData() {
  const res = await fetch(`${API}/tables`);
  const data = await res.json();
  tables = data.tables;
  currentSelection = data.currentSelection;
}

// ---------- Modo seleção (clique pra reservar) ----------
function attachClickHandlers() {
  document.querySelectorAll('#map-container .table-group').forEach(g => {
    const id = parseInt(g.dataset.tableId, 10);
    if (g.classList.contains('available')) {
      g.addEventListener('click', () => selectTable(id));
    }
  });
}

async function selectTable(tableId) {
  try {
    const res = await fetch(`${API}/tables/select`, {
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
    const res = await fetch(`${API}/tables/select`, {
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

// ---------- Modo reposicionar (drag-and-drop) ----------
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
  return {
    x: pend?.x ?? t.scaleX ?? 1,
    y: pend?.y ?? t.scaleY ?? 1,
  };
}

function getBaseDims(id) {
  const g = document.querySelector(`#map-container .table-group[data-table-id="${id}"]`);
  if (!g) return { w: 100, h: 100 };
  return {
    w: parseFloat(g.dataset.baseW) || 100,
    h: parseFloat(g.dataset.baseH) || 100,
  };
}

function applyTransform(g, id) {
  const t = tables.find(t => t.id === id);
  const x = pendingPositions[id]?.x ?? t.x;
  const y = pendingPositions[id]?.y ?? t.y;
  const s = getCurrentScale(id);
  const scalePart = (s.x === 1 && s.y === 1) ? '' : ` scale(${s.x}, ${s.y})`;
  g.setAttribute('transform', `translate(${x}, ${y})${scalePart}`);
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
  setStatus(`Mesa ${id} → ${pendingScales[id].x.toFixed(2)}× / ${pendingScales[id].y.toFixed(2)}×`, '');
}

function selectTableForEdit(id) {
  editingTableId = id;
  const select = document.getElementById('edit-table-select');
  if (select) select.value = String(id);
}

function syncDimensionInputs(id) {
  if (!id) return;
  const base = getBaseDims(id);
  const s = getCurrentScale(id);
  const wInput = document.getElementById('edit-width');
  const hInput = document.getElementById('edit-height');
  if (wInput) wInput.value = Math.round(base.w * s.x);
  if (hInput) hInput.value = Math.round(base.h * s.y);
}

function populateEditSelect() {
  const select = document.getElementById('edit-table-select');
  if (!select) return;
  select.innerHTML = tables.map(t => `<option value="${t.id}">Mesa ${t.id}</option>`).join('');
}

function onDimensionInput() {
  if (!editingTableId) return;
  const base = getBaseDims(editingTableId);
  const wInput = document.getElementById('edit-width');
  const hInput = document.getElementById('edit-height');
  const w = parseFloat(wInput.value);
  const h = parseFloat(hInput.value);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return;
  const sx = Math.max(0.2, Math.min(4, w / base.w));
  const sy = Math.max(0.2, Math.min(4, h / base.h));
  pendingScales[editingTableId] = { x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100 };
  const g = document.querySelector(`#map-container .table-group[data-table-id="${editingTableId}"]`);
  if (g) applyTransform(g, editingTableId);
}

function onEditTableSelectChange() {
  const select = document.getElementById('edit-table-select');
  editingTableId = parseInt(select.value, 10);
  syncDimensionInputs(editingTableId);
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
  activeDrag = {
    id,
    group: g,
    svg,
    offset: { x: pt.x - cur.x, y: pt.y - cur.y },
  };
  g.classList.add('dragging');
  g.setPointerCapture?.(e.pointerId);
  g.addEventListener('pointermove', onDragMove);
  g.addEventListener('pointerup', onDragEnd);
  g.addEventListener('pointercancel', onDragEnd);
}

function onDragMove(e) {
  if (!activeDrag) return;
  const pt = svgPoint(activeDrag.svg, e.clientX, e.clientY);
  const newX = pt.x - activeDrag.offset.x;
  const newY = pt.y - activeDrag.offset.y;
  pendingPositions[activeDrag.id] = { x: newX, y: newY };
  applyTransform(activeDrag.group, activeDrag.id);
}

function onDragEnd(e) {
  if (!activeDrag) return;
  activeDrag.group.classList.remove('dragging');
  activeDrag.group.removeEventListener('pointermove', onDragMove);
  activeDrag.group.removeEventListener('pointerup', onDragEnd);
  activeDrag.group.removeEventListener('pointercancel', onDragEnd);
  activeDrag = null;
  setStatus(`${Object.keys(pendingPositions).length} mesa(s) movida(s) — não esqueça de salvar`, '');
}

function enterEditMode() {
  editMode = true;
  pendingPositions = {};
  pendingScales = {};
  originalState = Object.fromEntries(tables.map(t => [t.id, { x: t.x, y: t.y, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1 }]));
  document.body.classList.add('edit-mode');
  document.getElementById('edit-buttons-idle').hidden = true;
  document.getElementById('edit-buttons-active').hidden = false;
  populateEditSelect();
  editingTableId = tables[0]?.id ?? null;
  if (editingTableId) {
    document.getElementById('edit-table-select').value = String(editingTableId);
    syncDimensionInputs(editingTableId);
  }
  attachDragHandlers();
  setStatus('Modo Reposicionar — arraste para mover, edite largura/altura abaixo', '');
}

function exitEditMode() {
  editMode = false;
  pendingPositions = {};
  pendingScales = {};
  document.body.classList.remove('edit-mode');
  document.getElementById('edit-buttons-idle').hidden = false;
  document.getElementById('edit-buttons-active').hidden = true;
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
  if (!positions.length) {
    setStatus('Nenhuma alteração para salvar', '');
    exitEditMode();
    await refreshAll();
    return;
  }
  try {
    const res = await fetch(`${API}/tables/positions`, {
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
  refreshAll();
}

// ---------- Sidebar ----------
function renderSelection() {
  const info = document.getElementById('selection-info');
  const btn = document.getElementById('clear-btn');
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
    info.innerHTML = `<strong>Mesa ${t.id}</strong><br>
      <span>Tipo: ${shapeLabel}</span><br>
      <span>Área: ${t.area}</span><br>
      <small style="color:#6b5a45">${new Date(currentSelection.selectedAt).toLocaleString('pt-BR')}</small>`;
    btn.disabled = false;
  } else {
    info.className = 'selection-empty';
    info.textContent = 'Nenhuma mesa selecionada';
    btn.disabled = true;
  }
}

function setStatus(msg, type = '') {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  el.className = type;
}

document.getElementById('clear-btn').addEventListener('click', releaseTable);
document.getElementById('edit-toggle-btn').addEventListener('click', enterEditMode);
document.getElementById('edit-save-btn').addEventListener('click', savePositions);
document.getElementById('edit-cancel-btn').addEventListener('click', cancelEditMode);
document.getElementById('edit-table-select').addEventListener('change', onEditTableSelectChange);
document.getElementById('edit-width').addEventListener('input', onDimensionInput);
document.getElementById('edit-height').addEventListener('input', onDimensionInput);
refreshAll();
