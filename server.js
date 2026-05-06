const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const jpegJs = require('jpeg-js');

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
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      return {
        currentSelection: data.currentSelection ?? null,
        tableState: data.tableState ?? {},
        history: Array.isArray(data.history) ? data.history : [],
      };
    }
  } catch (e) { console.error('Erro ao carregar estado:', e.message); }
  return { currentSelection: null, tableState: {}, history: [] };
}
function saveState() {
  try {
    ensureDataDir();
    const tableState = {};
    for (const t of tables) tableState[t.id] = { status: t.status, x: t.x, y: t.y, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1 };
    fs.writeFileSync(STATE_FILE, JSON.stringify({ currentSelection, tableState, history }, null, 2));
  } catch (e) { console.error('Erro ao salvar estado:', e.message); }
}

// ---------- Assets (planta + mesas) ----------
const ASSETS_DIR = path.join(__dirname, 'assets');
const MESAS_DIR = path.join(ASSETS_DIR, 'mesas');

const mesaImages = {};
for (const n of [1, 2, 3, 4, 5]) {
  const f = path.join(MESAS_DIR, `${n}.png`);
  if (fs.existsSync(f)) mesaImages[n] = fs.readFileSync(f).toString('base64');
}

let plantaB64 = null, plantaMime = null;
const plantaPng = path.join(ASSETS_DIR, 'planta.png');
const plantaJpg = path.join(ASSETS_DIR, 'planta.jpg');
if (fs.existsSync(plantaPng))      { plantaB64 = fs.readFileSync(plantaPng).toString('base64'); plantaMime = 'image/png'; }
else if (fs.existsSync(plantaJpg)) { plantaB64 = fs.readFileSync(plantaJpg).toString('base64'); plantaMime = 'image/jpeg'; }
console.log(plantaB64 ? `Planta carregada (${plantaMime})` : 'AVISO: assets/planta.png não encontrada, usando fundo simples');

// ---------- Layout ----------
const CANVAS_W = 1448, CANVAS_H = 1086;

// img: número do PNG em assets/mesas/   |   w/h: tamanho de renderização em coords do canvas
const MESA_TYPES = {
  round_2:  { img: 1, w: 150, h: 95 },
  round_4:  { img: 2, w: 130, h: 130 },
  square_4: { img: 5, w: 125, h: 125 },
  rect_6:   { img: 3, w: 215, h: 145 },
  rect_8:   { img: 4, w: 265, h: 170 },
};

const layoutKey = t => `${t.shape}_${t.seats}`;

// Posições (centros) baseadas na referência enviada
const tables = [
  // parede esquerda
  { id: 1,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 320, status: 'available' },
  { id: 2,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 440, status: 'available' },
  { id: 3,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 555, status: 'available' },
  { id: 4,  shape: 'square', seats: 4, area: 'salao',   x: 215,  y: 680, status: 'available' },
  // topo central
  { id: 5,  shape: 'square', seats: 4, area: 'salao',   x: 510,  y: 320, status: 'available' },
  { id: 6,  shape: 'square', seats: 4, area: 'salao',   x: 660,  y: 320, status: 'available' },
  { id: 7,  shape: 'round',  seats: 4, area: 'salao',   x: 860,  y: 320, status: 'available' },
  // parede direita
  { id: 8,  shape: 'square', seats: 4, area: 'salao',   x: 1100, y: 320, status: 'available' },
  { id: 9,  shape: 'round',  seats: 4, area: 'salao',   x: 1100, y: 475, status: 'available' },
  { id: 10, shape: 'square', seats: 4, area: 'salao',   x: 1100, y: 610, status: 'available' },
  { id: 11, shape: 'round',  seats: 4, area: 'salao',   x: 1100, y: 755, status: 'available' },
  // centro
  { id: 12, shape: 'rect',   seats: 6, area: 'salao',   x: 535,  y: 535, status: 'available' },
  { id: 13, shape: 'rect',   seats: 8, area: 'salao',   x: 805,  y: 535, status: 'available' },
  { id: 14, shape: 'rect',   seats: 8, area: 'salao',   x: 535,  y: 705, status: 'available' },
  { id: 15, shape: 'rect',   seats: 8, area: 'salao',   x: 805,  y: 705, status: 'available' },
  // entrada
  { id: 16, shape: 'round',  seats: 4, area: 'salao',   x: 660,  y: 810, status: 'available' },
  // varandas (esquerda + direita) - dentro dos decks
  { id: 17, shape: 'round',  seats: 4, area: 'varanda', x: 180,  y: 935, status: 'available' },
  { id: 18, shape: 'round',  seats: 4, area: 'varanda', x: 365,  y: 935, status: 'available' },
  { id: 19, shape: 'round',  seats: 4, area: 'varanda', x: 905,  y: 905, status: 'available' },
  { id: 20, shape: 'round',  seats: 4, area: 'varanda', x: 1090, y: 905, status: 'available' },
];

// Aplica overrides persistidos (status + posicionamento)
const initial = loadState();
let currentSelection = initial.currentSelection;
let history = initial.history;
for (const [id, st] of Object.entries(initial.tableState)) {
  const t = tables.find(t => t.id === Number(id));
  if (!t) continue;
  if (typeof st === 'string') {
    if (['available', 'occupied', 'reserved'].includes(st)) t.status = st;
  } else if (st && typeof st === 'object') {
    if (typeof st.status === 'string' && ['available', 'occupied', 'reserved'].includes(st.status)) t.status = st.status;
    if (typeof st.x === 'number') t.x = st.x;
    if (typeof st.y === 'number') t.y = st.y;
    // Backward compat: scale uniforme antigo vira scaleX/scaleY
    if (typeof st.scale === 'number' && st.scale > 0) { t.scaleX = st.scale; t.scaleY = st.scale; }
    if (typeof st.scaleX === 'number' && st.scaleX > 0) t.scaleX = st.scaleX;
    if (typeof st.scaleY === 'number' && st.scaleY > 0) t.scaleY = st.scaleY;
  }
}

// ---------- API JSON ----------
app.get('/api/tables', (req, res) => {
  res.json({ tables, currentSelection });
});

app.post('/api/tables/select', (req, res) => {
  const { tableId } = req.body;
  if (typeof tableId !== 'number') return res.status(400).json({ error: 'tableId (number) é obrigatório' });
  const table = tables.find(t => t.id === tableId);
  if (!table) return res.status(404).json({ error: `Mesa ${tableId} não encontrada` });
  if (table.status !== 'available') return res.status(409).json({ error: `Mesa ${tableId} já está bloqueada (status: ${table.status})` });
  table.status = 'occupied';
  currentSelection = { tableId, selectedAt: new Date().toISOString() };
  history.push({ ...currentSelection, action: 'select' });
  saveState();
  res.json({ message: 'Mesa reservada e bloqueada', selection: currentSelection, table });
});

app.delete('/api/tables/select', (req, res) => {
  const requested = (req.body && typeof req.body.tableId === 'number') ? req.body.tableId
    : req.query.tableId ? Number(req.query.tableId)
    : currentSelection?.tableId ?? null;
  if (requested == null) return res.status(400).json({ error: 'Nenhuma mesa para liberar' });
  const table = tables.find(t => t.id === requested);
  if (!table) return res.status(404).json({ error: `Mesa ${requested} não encontrada` });
  if (table.status === 'available') return res.status(409).json({ error: `Mesa ${requested} já está disponível` });
  table.status = 'available';
  history.push({ tableId: requested, action: 'release', releasedAt: new Date().toISOString() });
  if (currentSelection?.tableId === requested) currentSelection = null;
  saveState();
  res.json({ message: `Mesa ${requested} liberada`, table });
});

app.get('/api/tables/history', (req, res) => res.json({ history }));

app.post('/api/tables/reset', (req, res) => {
  const released = [];
  for (const t of tables) {
    if (t.status !== 'available') {
      released.push(t.id);
      t.status = 'available';
    }
  }
  const hadSelection = !!currentSelection;
  currentSelection = null;
  if (released.length || hadSelection) {
    history.push({ action: 'reset', tableIds: released, resetAt: new Date().toISOString() });
  }
  saveState();
  res.json({ message: `${released.length} mesa(s) liberada(s)`, released });
});

app.put('/api/tables/positions', (req, res) => {
  const positions = req.body?.positions;
  if (!Array.isArray(positions)) return res.status(400).json({ error: 'positions deve ser um array de {id, x?, y?, scaleX?, scaleY?, scale?}' });
  const clamp = v => Math.max(0.2, Math.min(4, v));
  const updated = [];
  for (const p of positions) {
    const t = tables.find(t => t.id === p.id);
    if (!t) continue;
    if (Number.isFinite(p.x)) t.x = Math.round(p.x);
    if (Number.isFinite(p.y)) t.y = Math.round(p.y);
    if (Number.isFinite(p.scale) && p.scale > 0) { t.scaleX = clamp(p.scale); t.scaleY = clamp(p.scale); }
    if (Number.isFinite(p.scaleX) && p.scaleX > 0) t.scaleX = clamp(p.scaleX);
    if (Number.isFinite(p.scaleY) && p.scaleY > 0) t.scaleY = clamp(p.scaleY);
    updated.push({ id: t.id, x: t.x, y: t.y, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1 });
  }
  saveState();
  res.json({ message: 'Posições salvas', updated });
});

// ---------- SVG ----------
function defs() {
  return `<defs>${Object.entries(mesaImages).map(([n, b64]) =>
    `<symbol id="mesa${n}" viewBox="0 0 800 800"><image href="data:image/png;base64,${b64}" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></symbol>`
  ).join('')}</defs>`;
}

function background() {
  if (plantaB64) {
    return `<image href="data:${plantaMime};base64,${plantaB64}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="#f0e0c2"/>
    <text x="${CANVAS_W / 2}" y="${CANVAS_H / 2}" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="22" fill="#a0907a">Salve a planta em assets/planta.png</text>`;
}

function tableSvg(t) {
  const layout = MESA_TYPES[layoutKey(t)];
  if (!layout || !mesaImages[layout.img]) return '';
  const opacity = t.status === 'available' ? 1 : 0.4;
  const labelColor = t.status === 'available' ? '#1c1917' : '#dc2626';
  const sx = t.scaleX ?? 1;
  const sy = t.scaleY ?? 1;
  const scalePart = (sx === 1 && sy === 1) ? '' : ` scale(${sx}, ${sy})`;
  return `<g class="table-group ${t.status}" data-table-id="${t.id}" data-base-w="${layout.w}" data-base-h="${layout.h}" transform="translate(${t.x}, ${t.y})${scalePart}">
    <use href="#mesa${layout.img}" x="${-layout.w / 2}" y="${-layout.h / 2}" width="${layout.w}" height="${layout.h}" opacity="${opacity}"/>
    <text x="0" y="5" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="15" font-weight="700" fill="${labelColor}" stroke="#fdf6e3" stroke-width="3.5" paint-order="stroke" pointer-events="none">Mesa ${t.id}</text>
  </g>`;
}

function fullSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" preserveAspectRatio="xMidYMid meet">
${defs()}
${background()}
<g id="tables-layer">${tables.map(tableSvg).join('')}</g>
</svg>`;
}

app.get('/api/tables/image', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(fullSvg());
});

const FONT_DIR = path.join(__dirname, 'fonts');
function renderRaster(req) {
  const width = Math.min(Math.max(parseInt(req.query.width, 10) || CANVAS_W, 200), 4000);
  return new Resvg(fullSvg(), {
    background: '#f0e0c2',
    fitTo: { mode: 'width', value: width },
    font: { fontDirs: [FONT_DIR], loadSystemFonts: false, defaultFontFamily: 'Roboto' },
  }).render();
}

app.get('/api/tables/image.png', (req, res) => {
  try {
    const png = renderRaster(req).asPng();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'inline; filename="planta-mesas.png"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (e) {
    console.error('Erro ao gerar PNG:', e);
    res.status(500).json({ error: 'Falha ao gerar PNG', detail: e.message });
  }
});

app.get(['/api/tables/image.jpeg', '/api/tables/image.jpg'], (req, res) => {
  try {
    const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 88, 30), 100);
    const r = renderRaster(req);
    const jpeg = jpegJs.encode({ data: r.pixels, width: r.width, height: r.height }, quality);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', 'inline; filename="planta-mesas.jpeg"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(jpeg.data);
  } catch (e) {
    console.error('Erro ao gerar JPEG:', e);
    res.status(500).json({ error: 'Falha ao gerar JPEG', detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Restaurant API rodando em http://localhost:${PORT}`);
});
