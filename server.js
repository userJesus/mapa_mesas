const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const jpegJs = require('jpeg-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Caminhos ----------
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const RESTAURANTS_FILE = path.join(DATA_DIR, 'restaurants.json');
const PLANTAS_DIR = path.join(DATA_DIR, 'plantas');
const ASSETS_DIR = path.join(__dirname, 'assets');
const MESAS_DIR = path.join(ASSETS_DIR, 'mesas');
const FONT_DIR = path.join(__dirname, 'fonts');
const FALLBACK_PLANTA = path.join(ASSETS_DIR, 'planta.png');

const CANVAS_W = 1448, CANVAS_H = 1086;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PLANTAS_DIR)) fs.mkdirSync(PLANTAS_DIR, { recursive: true });
}

// ---------- Imagens base ----------
const mesaImages = {};
for (const n of [1, 2, 3, 4, 5]) {
  const f = path.join(MESAS_DIR, `${n}.png`);
  if (fs.existsSync(f)) mesaImages[n] = fs.readFileSync(f).toString('base64');
}

let defaultPlantaB64 = null;
if (fs.existsSync(FALLBACK_PLANTA)) {
  defaultPlantaB64 = fs.readFileSync(FALLBACK_PLANTA).toString('base64');
}

// ---------- Layouts ----------
const MESA_TYPES = {
  round_2:  { img: 1, w: 150, h: 95 },
  round_4:  { img: 2, w: 130, h: 130 },
  square_4: { img: 5, w: 125, h: 125 },
  rect_6:   { img: 3, w: 215, h: 145 },
  rect_8:   { img: 4, w: 265, h: 170 },
};
const layoutKey = t => `${t.shape}_${t.seats}`;

// Template de mesas usado ao criar qualquer novo restaurante
const DEFAULT_TABLES = [
  { id: 1,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 320 },
  { id: 2,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 440 },
  { id: 3,  shape: 'round',  seats: 2, area: 'salao',   x: 215,  y: 555 },
  { id: 4,  shape: 'square', seats: 4, area: 'salao',   x: 215,  y: 680 },
  { id: 5,  shape: 'square', seats: 4, area: 'salao',   x: 510,  y: 320 },
  { id: 6,  shape: 'square', seats: 4, area: 'salao',   x: 660,  y: 320 },
  { id: 7,  shape: 'round',  seats: 4, area: 'salao',   x: 860,  y: 320 },
  { id: 8,  shape: 'square', seats: 4, area: 'salao',   x: 1100, y: 320 },
  { id: 9,  shape: 'round',  seats: 4, area: 'salao',   x: 1100, y: 475 },
  { id: 10, shape: 'square', seats: 4, area: 'salao',   x: 1100, y: 610 },
  { id: 11, shape: 'round',  seats: 4, area: 'salao',   x: 1100, y: 755 },
  { id: 12, shape: 'rect',   seats: 6, area: 'salao',   x: 535,  y: 535 },
  { id: 13, shape: 'rect',   seats: 8, area: 'salao',   x: 805,  y: 535 },
  { id: 14, shape: 'rect',   seats: 8, area: 'salao',   x: 535,  y: 705 },
  { id: 15, shape: 'rect',   seats: 8, area: 'salao',   x: 805,  y: 705 },
  { id: 16, shape: 'round',  seats: 4, area: 'salao',   x: 660,  y: 810 },
  { id: 17, shape: 'round',  seats: 4, area: 'varanda', x: 240,  y: 905 },
  { id: 18, shape: 'round',  seats: 4, area: 'varanda', x: 430,  y: 905 },
  { id: 19, shape: 'round',  seats: 4, area: 'varanda', x: 825,  y: 905 },
  { id: 20, shape: 'round',  seats: 4, area: 'varanda', x: 1015, y: 905 },
].map(t => ({ ...t, status: 'available', scaleX: 1, scaleY: 1 }));

// ---------- Persistência multi-restaurante ----------
let restaurants = {}; // { id: { id, name, createdAt, plantaFile, tables, currentSelection, history } }

function newRestaurant(id, name, plantaFile = null) {
  return {
    id, name,
    createdAt: new Date().toISOString(),
    plantaFile,
    tables: structuredClone(DEFAULT_TABLES),
    currentSelection: null,
    history: [],
  };
}

function applyTableState(r, tableState) {
  for (const [id, st] of Object.entries(tableState)) {
    const t = r.tables.find(t => t.id === Number(id));
    if (!t) continue;
    if (typeof st === 'string') {
      if (['available', 'occupied', 'reserved'].includes(st)) t.status = st;
    } else if (st && typeof st === 'object') {
      if (typeof st.status === 'string' && ['available', 'occupied', 'reserved'].includes(st.status)) t.status = st.status;
      if (typeof st.x === 'number') t.x = st.x;
      if (typeof st.y === 'number') t.y = st.y;
      if (typeof st.scale === 'number' && st.scale > 0) { t.scaleX = st.scale; t.scaleY = st.scale; }
      if (typeof st.scaleX === 'number' && st.scaleX > 0) t.scaleX = st.scaleX;
      if (typeof st.scaleY === 'number' && st.scaleY > 0) t.scaleY = st.scaleY;
    }
  }
}

function saveRestaurants() {
  ensureDirs();
  fs.writeFileSync(RESTAURANTS_FILE, JSON.stringify({ restaurants }, null, 2));
}

function loadRestaurants() {
  ensureDirs();
  if (fs.existsSync(RESTAURANTS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(RESTAURANTS_FILE, 'utf8'));
      restaurants = data.restaurants || {};
      return;
    } catch (e) { console.error('Erro ao ler restaurants.json:', e.message); }
  }
  // Migração do formato antigo (single-restaurant)
  const oldStateFile = path.join(DATA_DIR, 'selections.json');
  if (fs.existsSync(oldStateFile)) {
    try {
      const old = JSON.parse(fs.readFileSync(oldStateFile, 'utf8'));
      const def = newRestaurant('default', 'Restaurante Principal');
      applyTableState(def, old.tableState || {});
      def.currentSelection = old.currentSelection || null;
      def.history = old.history || [];
      restaurants[def.id] = def;
      saveRestaurants();
      console.log('Estado antigo migrado para restaurante "default"');
      return;
    } catch (e) { console.error('Migração falhou:', e.message); }
  }
  // Cria default vazio
  restaurants['default'] = newRestaurant('default', 'Restaurante Principal');
  saveRestaurants();
}

function generateId() {
  return 'rest_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ---------- SVG ----------
function defs() {
  return `<defs>${Object.entries(mesaImages).map(([n, b64]) =>
    `<symbol id="mesa${n}" viewBox="0 0 800 800"><image href="data:image/png;base64,${b64}" width="800" height="800" preserveAspectRatio="xMidYMid meet"/></symbol>`
  ).join('')}</defs>`;
}

function getPlantaForRestaurant(r) {
  if (r.plantaFile) {
    const p = path.join(PLANTAS_DIR, r.plantaFile);
    if (fs.existsSync(p)) {
      const ext = path.extname(r.plantaFile).toLowerCase();
      const mime = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
      return { b64: fs.readFileSync(p).toString('base64'), mime };
    }
  }
  if (defaultPlantaB64) return { b64: defaultPlantaB64, mime: 'image/png' };
  return null;
}

function background(r) {
  const planta = getPlantaForRestaurant(r);
  if (planta) {
    return `<image href="data:${planta.mime};base64,${planta.b64}" x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" preserveAspectRatio="xMidYMid meet"/>`;
  }
  return `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="#f0e0c2"/>
    <text x="${CANVAS_W/2}" y="${CANVAS_H/2}" text-anchor="middle" font-family="Roboto, Arial, sans-serif" font-size="22" fill="#a0907a">Sem planta</text>`;
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

function fullSvg(r) {
  const tablesSvg = r.tables.map(tableSvg).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" preserveAspectRatio="xMidYMid meet">
${defs()}
${background(r)}
<g id="tables-layer">${tablesSvg}</g>
</svg>`;
}

function renderRaster(r, query) {
  const width = Math.min(Math.max(parseInt(query.width, 10) || CANVAS_W, 200), 4000);
  return new Resvg(fullSvg(r), {
    background: '#f0e0c2',
    fitTo: { mode: 'width', value: width },
    font: { fontDirs: [FONT_DIR], loadSystemFonts: false, defaultFontFamily: 'Roboto' },
  }).render();
}

// ---------- Middleware ----------
function requireRestaurant(req, res, next) {
  const r = restaurants[req.params.id];
  if (!r) return res.status(404).json({ error: 'Restaurante não encontrado' });
  req.restaurant = r;
  next();
}
function defaultRestaurant(req, res, next) {
  req.restaurant = restaurants['default'];
  if (!req.restaurant) return res.status(500).json({ error: 'Restaurante padrão não inicializado' });
  next();
}

// ---------- Handlers (compartilhados entre /api/tables e /api/restaurants/:id/tables) ----------
const H = {
  list: (req, res) => res.json({ tables: req.restaurant.tables, currentSelection: req.restaurant.currentSelection }),

  select: (req, res) => {
    const r = req.restaurant;
    const { tableId } = req.body;
    if (typeof tableId !== 'number') return res.status(400).json({ error: 'tableId (number) é obrigatório' });
    const table = r.tables.find(t => t.id === tableId);
    if (!table) return res.status(404).json({ error: `Mesa ${tableId} não encontrada` });
    if (table.status !== 'available') return res.status(409).json({ error: `Mesa ${tableId} já está bloqueada (status: ${table.status})` });
    table.status = 'occupied';
    r.currentSelection = { tableId, selectedAt: new Date().toISOString() };
    r.history.push({ ...r.currentSelection, action: 'select' });
    saveRestaurants();
    res.json({ message: 'Mesa reservada e bloqueada', selection: r.currentSelection, table });
  },

  release: (req, res) => {
    const r = req.restaurant;
    const requested = (req.body && typeof req.body.tableId === 'number') ? req.body.tableId
      : req.query.tableId ? Number(req.query.tableId)
      : r.currentSelection?.tableId ?? null;
    if (requested == null) return res.status(400).json({ error: 'Nenhuma mesa para liberar' });
    const table = r.tables.find(t => t.id === requested);
    if (!table) return res.status(404).json({ error: `Mesa ${requested} não encontrada` });
    if (table.status === 'available') return res.status(409).json({ error: `Mesa ${requested} já está disponível` });
    table.status = 'available';
    r.history.push({ tableId: requested, action: 'release', releasedAt: new Date().toISOString() });
    if (r.currentSelection?.tableId === requested) r.currentSelection = null;
    saveRestaurants();
    res.json({ message: `Mesa ${requested} liberada`, table });
  },

  reset: (req, res) => {
    const r = req.restaurant;
    const released = [];
    for (const t of r.tables) if (t.status !== 'available') { released.push(t.id); t.status = 'available'; }
    const had = !!r.currentSelection;
    r.currentSelection = null;
    if (released.length || had) r.history.push({ action: 'reset', tableIds: released, resetAt: new Date().toISOString() });
    saveRestaurants();
    res.json({ message: `${released.length} mesa(s) liberada(s)`, released });
  },

  history: (req, res) => res.json({ history: req.restaurant.history }),

  positions: (req, res) => {
    const r = req.restaurant;
    const positions = req.body?.positions;
    if (!Array.isArray(positions)) return res.status(400).json({ error: 'positions deve ser array' });
    const clamp = v => Math.max(0.2, Math.min(4, v));
    const updated = [];
    for (const p of positions) {
      const t = r.tables.find(t => t.id === p.id);
      if (!t) continue;
      if (Number.isFinite(p.x)) t.x = Math.round(p.x);
      if (Number.isFinite(p.y)) t.y = Math.round(p.y);
      if (Number.isFinite(p.scale) && p.scale > 0) { t.scaleX = clamp(p.scale); t.scaleY = clamp(p.scale); }
      if (Number.isFinite(p.scaleX) && p.scaleX > 0) t.scaleX = clamp(p.scaleX);
      if (Number.isFinite(p.scaleY) && p.scaleY > 0) t.scaleY = clamp(p.scaleY);
      updated.push({ id: t.id, x: t.x, y: t.y, scaleX: t.scaleX ?? 1, scaleY: t.scaleY ?? 1 });
    }
    saveRestaurants();
    res.json({ message: 'Posições salvas', updated });
  },

  image: (req, res) => {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(fullSvg(req.restaurant));
  },

  imagePng: (req, res) => {
    try {
      const png = renderRaster(req.restaurant, req.query).asPng();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', 'inline; filename="planta-mesas.png"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(png);
    } catch (e) {
      console.error('Erro PNG:', e);
      res.status(500).json({ error: 'Falha ao gerar PNG', detail: e.message });
    }
  },

  imageJpeg: (req, res) => {
    try {
      const quality = Math.min(Math.max(parseInt(req.query.quality, 10) || 88, 30), 100);
      const r = renderRaster(req.restaurant, req.query);
      const jpeg = jpegJs.encode({ data: r.pixels, width: r.width, height: r.height }, quality);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', 'inline; filename="planta-mesas.jpeg"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(jpeg.data);
    } catch (e) {
      console.error('Erro JPEG:', e);
      res.status(500).json({ error: 'Falha ao gerar JPEG', detail: e.message });
    }
  },
};

// ---------- Restaurantes (CRUD) ----------
app.get('/api/restaurants', (req, res) => {
  const list = Object.values(restaurants).map(r => ({
    id: r.id, name: r.name, createdAt: r.createdAt,
    hasPlanta: !!r.plantaFile,
    tableCount: r.tables.length,
  }));
  res.json({ restaurants: list });
});

app.post('/api/restaurants', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 100) {
    return res.status(400).json({ error: 'name (string, max 100 chars) é obrigatório' });
  }
  const id = generateId();
  restaurants[id] = newRestaurant(id, name.trim());
  saveRestaurants();
  res.status(201).json({ restaurant: restaurants[id] });
});

app.delete('/api/restaurants/:id', requireRestaurant, (req, res) => {
  const r = req.restaurant;
  if (r.id === 'default') return res.status(403).json({ error: 'Restaurante "default" não pode ser removido' });
  if (r.plantaFile) {
    const p = path.join(PLANTAS_DIR, r.plantaFile);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  delete restaurants[r.id];
  saveRestaurants();
  res.json({ message: 'Restaurante removido' });
});

// Acessar a imagem da planta (PNG/JPEG salva em disco) diretamente
app.get('/api/restaurants/:id/planta', requireRestaurant, (req, res) => {
  const planta = getPlantaForRestaurant(req.restaurant);
  if (!planta) return res.status(404).json({ error: 'Sem planta' });
  res.setHeader('Content-Type', planta.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.send(Buffer.from(planta.b64, 'base64'));
});

// ---------- Geração de planta via OpenAI (gpt-image-1) ----------
app.post('/api/restaurants/:id/planta/generate', requireRestaurant, async (req, res) => {
  const { apiKey, imageBase64, mimeType, prompt } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string') return res.status(400).json({ error: 'apiKey é obrigatória' });
  if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'imageBase64 é obrigatório' });

  const defaultPrompt = `Reproduce this restaurant floor plan as a clean top-down architectural illustration.

REFERENCE FIDELITY (most important):
- Use the input image as the STRICT architectural reference.
- Keep the EXACT same overall layout, proportions, orientation, and positions of every room
  (kitchen, bathrooms, entrance, varandas/outdoor decks, counter/bar, storage areas, etc.).
- Keep walls, openings and corners exactly where they appear in the input.
- Keep decorative plants and pots in the same positions as the input.
- If the input image contains TEXT LABELS identifying rooms (e.g. COZINHA, COCINA, KITCHEN,
  BANHEIRO, BATHROOM, VARANDA, ENTRADA, DESPENSA, CÂMARA, BAR, CAIXA, BALCÃO, etc.):
  use those labels to understand which area is which, and place those rooms in the SAME
  spatial positions in the output. Respect the language of the input.
- DO NOT invent rooms, equipment, walls, columns, doors or features that are not present
  in the input. Do not mirror or rotate the layout.

WHAT TO REMOVE FROM THE OUTPUT:
- All tables, chairs, stools and seating of any kind. The dining floor (salão) must be
  completely empty.
- All text, labels, room names, legends, keys, sidebars, captions, arrows, scale bars,
  measurements and annotations of any kind. The output image must contain ZERO text.

VISUAL STYLE:
- Top-down (bird's eye) view, edge-to-edge, no surrounding panels or borders.
- Beige/cream colored floor with subtle tile pattern.
- Dark brown wall outlines (~6px).
- Kitchen with realistic appliances visible (stoves, sinks, counters), in the SAME area
  as in the input.
- Bathrooms with toilets/sinks visible, in the SAME area as in the input.
- Outdoor varandas with wooden decks if present in the input.
- Realistic illustration style, like a professional architectural rendering.
- Aspect ratio: 1536x1024 landscape.`;

  try {
    const buf = Buffer.from(imageBase64, 'base64');
    const blob = new Blob([buf], { type: mimeType || 'image/png' });
    const form = new FormData();
    form.append('image', blob, 'photo.png');
    form.append('model', 'gpt-image-2');
    form.append('prompt', (typeof prompt === 'string' && prompt.trim()) ? prompt : defaultPrompt);
    form.append('size', '1536x1024');
    form.append('n', '1');

    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || `OpenAI HTTP ${r.status}` });
    const generatedB64 = data.data?.[0]?.b64_json;
    if (!generatedB64) return res.status(500).json({ error: 'Resposta inesperada da OpenAI', raw: data });

    ensureDirs();
    const filename = `${req.restaurant.id}_${Date.now()}.png`;
    fs.writeFileSync(path.join(PLANTAS_DIR, filename), Buffer.from(generatedB64, 'base64'));

    if (req.restaurant.plantaFile) {
      const old = path.join(PLANTAS_DIR, req.restaurant.plantaFile);
      if (fs.existsSync(old)) fs.unlinkSync(old);
    }
    req.restaurant.plantaFile = filename;
    saveRestaurants();
    res.json({ message: 'Planta gerada', plantaUrl: `/api/restaurants/${req.restaurant.id}/planta` });
  } catch (e) {
    console.error('Erro na geração:', e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- Rotas scoped por restaurante ----------
app.get('/api/restaurants/:id/tables', requireRestaurant, H.list);
app.post('/api/restaurants/:id/tables/select', requireRestaurant, H.select);
app.delete('/api/restaurants/:id/tables/select', requireRestaurant, H.release);
app.post('/api/restaurants/:id/tables/reset', requireRestaurant, H.reset);
app.get('/api/restaurants/:id/tables/history', requireRestaurant, H.history);
app.put('/api/restaurants/:id/tables/positions', requireRestaurant, H.positions);
app.get('/api/restaurants/:id/tables/image', requireRestaurant, H.image);
app.get('/api/restaurants/:id/tables/image.png', requireRestaurant, H.imagePng);
app.get(['/api/restaurants/:id/tables/image.jpeg', '/api/restaurants/:id/tables/image.jpg'], requireRestaurant, H.imageJpeg);

// ---------- Backward compat: /api/tables/* opera no "default" ----------
app.get('/api/tables', defaultRestaurant, H.list);
app.post('/api/tables/select', defaultRestaurant, H.select);
app.delete('/api/tables/select', defaultRestaurant, H.release);
app.post('/api/tables/reset', defaultRestaurant, H.reset);
app.get('/api/tables/history', defaultRestaurant, H.history);
app.put('/api/tables/positions', defaultRestaurant, H.positions);
app.get('/api/tables/image', defaultRestaurant, H.image);
app.get('/api/tables/image.png', defaultRestaurant, H.imagePng);
app.get(['/api/tables/image.jpeg', '/api/tables/image.jpg'], defaultRestaurant, H.imageJpeg);

loadRestaurants();
app.listen(PORT, () => console.log(`Restaurant API rodando em http://localhost:${PORT}`));
