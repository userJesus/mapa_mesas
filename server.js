const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Persistência ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'selections.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    ensureDataDir();
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      return {
        currentSelection: data.currentSelection ?? null,
        history: Array.isArray(data.history) ? data.history : [],
      };
    }
  } catch (e) {
    console.error('Erro ao carregar estado:', e.message);
  }
  return { currentSelection: null, history: [] };
}

function saveState() {
  try {
    ensureDataDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ currentSelection, history }, null, 2));
  } catch (e) {
    console.error('Erro ao salvar estado:', e.message);
  }
}

// ---------- Dados ----------
const tables = [
  // parede esquerda
  { id: 1,  shape: 'round',  seats: 2, area: 'salao', x: 130,  y: 380, status: 'available' },
  { id: 2,  shape: 'round',  seats: 2, area: 'salao', x: 130,  y: 510, status: 'available' },
  { id: 3,  shape: 'round',  seats: 2, area: 'salao', x: 130,  y: 640, status: 'available' },
  { id: 4,  shape: 'square', seats: 4, area: 'salao', x: 130,  y: 770, status: 'available' },
  // topo central
  { id: 5,  shape: 'square', seats: 4, area: 'salao', x: 380,  y: 380, status: 'available' },
  { id: 6,  shape: 'square', seats: 4, area: 'salao', x: 580,  y: 380, status: 'available' },
  { id: 7,  shape: 'round',  seats: 4, area: 'salao', x: 800,  y: 380, status: 'available' },
  // parede direita
  { id: 8,  shape: 'square', seats: 4, area: 'salao', x: 1180, y: 380, status: 'available' },
  { id: 9,  shape: 'round',  seats: 4, area: 'salao', x: 1180, y: 510, status: 'available' },
  { id: 10, shape: 'square', seats: 4, area: 'salao', x: 1180, y: 640, status: 'available' },
  { id: 11, shape: 'round',  seats: 4, area: 'salao', x: 1180, y: 770, status: 'available' },
  // centro
  { id: 12, shape: 'rect',   seats: 6, area: 'salao', x: 430,  y: 555, status: 'available' },
  { id: 13, shape: 'rect',   seats: 8, area: 'salao', x: 820,  y: 555, status: 'available' },
  // centro inferior
  { id: 14, shape: 'rect',   seats: 8, area: 'salao', x: 430,  y: 760, status: 'available' },
  { id: 15, shape: 'rect',   seats: 8, area: 'salao', x: 820,  y: 760, status: 'available' },
];

const TABLE_LAYOUTS = {
  round_2:  { shape: 'round', r: 22, chairs: [
    { x: 0, y: -32, r: 0 }, { x: 0, y: 32, r: 180 },
  ]},
  round_4:  { shape: 'round', r: 30, chairs: [
    { x: 0, y: -42, r: 0 }, { x: 0, y: 42, r: 180 },
    { x: -42, y: 0, r: 270 }, { x: 42, y: 0, r: 90 },
  ]},
  square_4: { shape: 'rect', w: 65, h: 65, chairs: [
    { x: 0, y: -45, r: 0 }, { x: 0, y: 45, r: 180 },
    { x: -45, y: 0, r: 270 }, { x: 45, y: 0, r: 90 },
  ]},
  rect_6:   { shape: 'rect', w: 130, h: 65, chairs: [
    { x: -35, y: -45, r: 0 }, { x: 35, y: -45, r: 0 },
    { x: -35, y: 45, r: 180 }, { x: 35, y: 45, r: 180 },
    { x: -78, y: 0, r: 270 }, { x: 78, y: 0, r: 90 },
  ]},
  rect_8:   { shape: 'rect', w: 200, h: 65, chairs: [
    { x: -70, y: -45, r: 0 }, { x: -23, y: -45, r: 0 },
    { x: 23, y: -45, r: 0 }, { x: 70, y: -45, r: 0 },
    { x: -70, y: 45, r: 180 }, { x: -23, y: 45, r: 180 },
    { x: 23, y: 45, r: 180 }, { x: 70, y: 45, r: 180 },
  ]},
};

const layoutKey = t => `${t.shape}_${t.seats}`;

const initial = loadState();
let currentSelection = initial.currentSelection;
let history = initial.history;

// ---------- API JSON ----------
app.get('/api/tables', (req, res) => {
  res.json({ tables, currentSelection });
});

app.post('/api/tables/select', (req, res) => {
  const { tableId } = req.body;
  if (typeof tableId !== 'number') return res.status(400).json({ error: 'tableId (number) é obrigatório' });
  const table = tables.find(t => t.id === tableId);
  if (!table) return res.status(404).json({ error: `Mesa ${tableId} não encontrada` });
  if (table.status !== 'available') return res.status(409).json({ error: `Mesa ${tableId} não está disponível (status: ${table.status})` });
  currentSelection = { tableId, selectedAt: new Date().toISOString() };
  history.push({ ...currentSelection, action: 'select' });
  saveState();
  res.json({ message: 'Mesa selecionada', selection: currentSelection, table });
});

app.delete('/api/tables/select', (req, res) => {
  if (currentSelection) history.push({ ...currentSelection, action: 'clear', clearedAt: new Date().toISOString() });
  currentSelection = null;
  saveState();
  res.json({ message: 'Seleção removida' });
});

app.get('/api/tables/history', (req, res) => {
  res.json({ history });
});

// ---------- SVG: defs ----------
const SVG_DEFS = `
<defs>
  <linearGradient id="woodGrad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#8a5a30"/>
    <stop offset="40%" stop-color="#5d3a1f"/>
    <stop offset="60%" stop-color="#5d3a1f"/>
    <stop offset="100%" stop-color="#8a5a30"/>
  </linearGradient>
  <radialGradient id="woodRound" cx="50%" cy="50%" r="55%">
    <stop offset="0%" stop-color="#9a6a3c"/>
    <stop offset="100%" stop-color="#5d3a1f"/>
  </radialGradient>
  <linearGradient id="counterGrad" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#8a5a30"/>
    <stop offset="100%" stop-color="#5d3a1f"/>
  </linearGradient>
  <pattern id="floorTile" x="0" y="0" width="80" height="80" patternUnits="userSpaceOnUse">
    <rect width="80" height="80" fill="#f0e0c2"/>
    <path d="M0 0 L80 0 M0 80 L80 80 M0 0 L0 80 M80 0 L80 80" stroke="#dcc89e" stroke-width="0.6" opacity="0.6"/>
  </pattern>
  <pattern id="kitchenTile" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
    <rect width="40" height="40" fill="#e8e8e3"/>
    <path d="M0 40 L40 40 M40 0 L40 40" stroke="#c0c0b8" stroke-width="0.8"/>
  </pattern>
  <pattern id="varandaWood" x="0" y="0" width="20" height="120" patternUnits="userSpaceOnUse">
    <rect width="20" height="120" fill="#c9a66a"/>
    <path d="M20 0 L20 120" stroke="#8a6a3a" stroke-width="0.8"/>
  </pattern>
</defs>`;

// ---------- SVG: cadeira / mesa / planta ----------
function chairSvg(c) {
  return `<g transform="translate(${c.x}, ${c.y}) rotate(${c.r})">
    <path d="M -12 -7 Q -15 -15 -7 -15 L 7 -15 Q 15 -15 12 -7" fill="none" stroke="#3d2810" stroke-width="5" stroke-linecap="round"/>
    <rect x="-12" y="-9" width="24" height="16" rx="4" fill="#8b5a3c" stroke="#3d2810" stroke-width="1.2"/>
  </g>`;
}

function tableShape(layout) {
  if (layout.shape === 'round') {
    return `<circle r="${layout.r}" fill="url(#woodRound)" stroke="#2a1f15" stroke-width="2.5"/>`;
  }
  return `<rect x="${-layout.w/2}" y="${-layout.h/2}" width="${layout.w}" height="${layout.h}" rx="3" fill="url(#woodGrad)" stroke="#2a1f15" stroke-width="2.5"/>`;
}

function selectionRing(layout) {
  if (layout.shape === 'round') {
    return `<circle r="${layout.r + 7}" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="5 3"/>`;
  }
  return `<rect x="${-layout.w/2 - 7}" y="${-layout.h/2 - 7}" width="${layout.w + 14}" height="${layout.h + 14}" rx="6" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="5 3"/>`;
}

function tableSvg(t, selectedId) {
  const layout = TABLE_LAYOUTS[layoutKey(t)];
  if (!layout) return '';
  const isSelected = selectedId === t.id;
  const statusColors = { available: '#22c55e', occupied: '#ef4444', reserved: '#f59e0b' };
  const opacity = t.status === 'available' ? 1 : 0.6;
  const chairs = layout.chairs.map(chairSvg).join('');
  const ring = isSelected ? selectionRing(layout) : '';

  return `<g class="table-group ${t.status}${isSelected ? ' selected' : ''}" data-table-id="${t.id}" transform="translate(${t.x}, ${t.y})" opacity="${opacity}">
    ${chairs}
    ${tableShape(layout)}
    ${ring}
    <g class="label">
      <rect x="-34" y="-11" width="68" height="22" rx="11" fill="#fdf6e3" stroke="#2a1f15" stroke-width="1.2"/>
      <circle cx="-23" cy="0" r="4.5" fill="${statusColors[t.status]}" stroke="#2a1f15" stroke-width="0.8"/>
      <text x="6" y="4" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#2a1f15">Mesa ${t.id}</text>
    </g>
  </g>`;
}

function plantSvg(x, y, scale = 1) {
  return `<g transform="translate(${x}, ${y}) scale(${scale})">
    <path d="M -11 -1 L 11 -1 L 9 12 L -9 12 Z" fill="#6b4423" stroke="#3d2810" stroke-width="1"/>
    <ellipse cx="-7" cy="-6" rx="9" ry="11" fill="#3d7a3a"/>
    <ellipse cx="7" cy="-6" rx="9" ry="11" fill="#4a8e44"/>
    <ellipse cx="0" cy="-12" rx="10" ry="11" fill="#5cab58"/>
    <ellipse cx="-3" cy="-15" rx="6" ry="7" fill="#6dba68"/>
    <ellipse cx="4" cy="-14" rx="6" ry="7" fill="#7dca78"/>
  </g>`;
}

// ---------- SVG: cenário estático ----------
function staticBg() {
  return `
  <!-- piso -->
  <rect x="0" y="0" width="1300" height="1000" fill="url(#floorTile)"/>

  <!-- parede externa -->
  <rect x="20" y="20" width="1260" height="960" fill="none" stroke="#2a1f15" stroke-width="9"/>

  <!-- COZINHA -->
  <rect x="60" y="60" width="700" height="200" fill="url(#kitchenTile)" stroke="#2a1f15" stroke-width="3"/>
  <text x="410" y="175" text-anchor="middle" font-family="Arial" font-size="28" font-weight="800" fill="#3d2810" letter-spacing="4">COZINHA</text>
  <rect x="80"  y="80" width="60" height="34" fill="#9a9890" stroke="#5a5852"/>
  <rect x="150" y="80" width="60" height="34" fill="#7a7872" stroke="#5a5852"/>
  <rect x="220" y="80" width="90" height="34" fill="#9a9890" stroke="#5a5852"/>
  <rect x="320" y="80" width="60" height="34" fill="#7a7872" stroke="#5a5852"/>
  <rect x="560" y="80" width="60" height="34" fill="#7a7872" stroke="#5a5852"/>
  <rect x="630" y="80" width="80" height="34" fill="#9a9890" stroke="#5a5852"/>
  <line x1="80" y1="240" x2="740" y2="240" stroke="#5a5852" stroke-width="2"/>

  <!-- CÂMARA FRIA / DESPENSA -->
  <rect x="760" y="60"  width="140" height="100" fill="#dde4ed" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="830" y="105" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#3d2810">CÂMARA</text>
  <text x="830" y="123" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#3d2810">FRIA</text>
  <rect x="760" y="160" width="140" height="100" fill="#e8e0d3" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="830" y="215" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#3d2810">DESPENSA</text>

  <!-- BANHEIROS -->
  <rect x="900" y="60"  width="340" height="95" fill="#dde4ed" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="1070" y="113" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#3d2810" letter-spacing="1.5">BANHEIRO MASCULINO</text>
  <rect x="900" y="155" width="340" height="105" fill="#dde4ed" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="1070" y="213" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#3d2810" letter-spacing="1.5">BANHEIRO FEMININO</text>

  <!-- CAIXA / BALCÃO -->
  <rect x="60" y="270" width="260" height="38" fill="url(#counterGrad)" stroke="#2a1f15" stroke-width="2"/>
  <text x="190" y="295" text-anchor="middle" font-family="Arial" font-size="13" font-weight="800" fill="#fdf6e3" letter-spacing="2.5">CAIXA / BALCÃO</text>

  <!-- Título do salão (watermark) -->
  <text x="660" y="470" text-anchor="middle" font-family="Arial" font-size="15" font-weight="600" fill="#8b6c45" letter-spacing="6" opacity="0.55">SALÃO PRINCIPAL</text>

  <!-- VARANDA esquerda -->
  <rect x="60" y="850" width="500" height="130" fill="url(#varandaWood)" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="310" y="975" text-anchor="middle" font-family="Arial" font-size="14" font-weight="800" fill="#3d2810" letter-spacing="4">VARANDA</text>

  <!-- VARANDA direita -->
  <rect x="780" y="850" width="460" height="130" fill="url(#varandaWood)" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="1010" y="975" text-anchor="middle" font-family="Arial" font-size="14" font-weight="800" fill="#3d2810" letter-spacing="4">VARANDA</text>

  <!-- ENTRADA -->
  <rect x="560" y="900" width="220" height="80" fill="#a8c87a" stroke="#2a1f15" stroke-width="2.5"/>
  <text x="670" y="935" text-anchor="middle" font-family="Arial" font-size="14" font-weight="800" fill="#1a2e05" letter-spacing="2">ENTRADA</text>
  <text x="670" y="958" text-anchor="middle" font-family="Arial" font-size="11" font-weight="600" fill="#1a2e05" letter-spacing="2">RECEPÇÃO</text>

  <!-- Plantas decorativas -->
  ${plantSvg(50,  335)}
  ${plantSvg(50,  830, 1.1)}
  ${plantSvg(1255, 335)}
  ${plantSvg(1255, 830, 1.1)}
  ${plantSvg(80,  880, 0.9)}
  ${plantSvg(540, 880, 0.9)}
  ${plantSvg(800, 880, 0.9)}
  ${plantSvg(1220, 880, 0.9)}
  ${plantSvg(220, 960, 0.75)}
  ${plantSvg(1100, 960, 0.75)}
  `;
}

function fullSvg() {
  const selectedId = currentSelection?.tableId ?? null;
  const tablesSvg = tables.map(t => tableSvg(t, selectedId)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1300" height="1000" viewBox="0 0 1300 1000" preserveAspectRatio="xMidYMid meet">
  ${SVG_DEFS}
  ${staticBg()}
  <g id="tables-layer">${tablesSvg}</g>
</svg>`;
}

app.get('/api/tables/image', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(fullSvg());
});

app.listen(PORT, () => {
  console.log(`Restaurant API rodando em http://localhost:${PORT}`);
});
