const API = '/api';

let tables = [];
let currentSelection = null;

async function refreshAll() {
  await Promise.all([loadFloorplan(), loadData()]);
  renderSelection();
  attachClickHandlers();
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

function attachClickHandlers() {
  const groups = document.querySelectorAll('#map-container .table-group');
  groups.forEach(g => {
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
    setStatus(`Mesa ${tableId} selecionada`, 'success');
    await refreshAll();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

async function clearSelection() {
  try {
    await fetch(`${API}/tables/select`, { method: 'DELETE' });
    setStatus('Seleção removida', 'success');
    await refreshAll();
  } catch (e) {
    setStatus(e.message, 'error');
  }
}

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

document.getElementById('clear-btn').addEventListener('click', clearSelection);
refreshAll();
