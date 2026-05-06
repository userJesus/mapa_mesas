# Mapa de Mesas — API + Front-end

API em Node.js/Express + front-end estático para visualizar a planta de um restaurante,
selecionar mesas e obter a imagem (SVG) atualizada da planta.

Os registros de seleção e o histórico ficam persistidos em disco no servidor
(`data/selections.json`).

## Stack

- Node.js 18+ (Express 4, CORS)
- Front-end: HTML/CSS/JS puro (SVG renderizado pelo back-end)
- Persistência: arquivo JSON local

## Rodar localmente

```bash
git clone https://github.com/userJesus/mapa_mesas.git
cd mapa_mesas
npm install
npm start
```

O servidor sobe em `http://localhost:3000` (configurável via `PORT`).

Front-end: abra [http://localhost:3000](http://localhost:3000).

## Endpoints

Base URL: `http://localhost:3000` (em produção, a URL pública do Railway).

| Método | Rota | Descrição |
|--------|------|-----------|
| GET    | `/api/tables`            | Lista todas as mesas e a seleção atual |
| GET    | `/api/tables/image`      | Retorna a planta completa em SVG |
| GET    | `/api/tables/image.png`  | Retorna a planta como PNG (binário) |
| GET    | `/api/tables/image.jpeg` | Retorna a planta como JPEG (binário) — alias `.jpg` |
| GET    | `/api/tables/history`    | Retorna o histórico de seleções |
| POST   | `/api/tables/select`     | Reserva e **bloqueia** uma mesa |
| DELETE | `/api/tables/select`     | **Libera** uma mesa bloqueada |

### `GET /api/tables`

Resposta `200`:

```json
{
  "tables": [
    { "id": 1, "shape": "round", "seats": 2, "area": "salao", "x": 130, "y": 380, "status": "available" },
    ...
  ],
  "currentSelection": null
}
```

`status` ∈ `available` | `occupied` | `reserved`.
`shape` ∈ `round` | `square` | `rect`.

```bash
curl https://SEU-APP.up.railway.app/api/tables
```

### `GET /api/tables/image`

Retorna a planta inteira (paredes, salas, mesas, cadeiras, plantas) como SVG.
A mesa atualmente selecionada aparece com um anel azul tracejado.

`Content-Type: image/svg+xml`.

```bash
curl https://SEU-APP.up.railway.app/api/tables/image -o planta.svg
```

Pode ser embedado direto no HTML:

```html
<img src="https://SEU-APP.up.railway.app/api/tables/image" alt="Planta">
```

### `GET /api/tables/image.png`

Retorna a mesma planta renderizada como **PNG** (binário). Use este endpoint
quando precisar de um arquivo de imagem (ex.: upload em S3, anexo em e-mail).

Query string opcional:
- `width` — largura em pixels (default `1300`, mín `200`, máx `4000`).
  A altura é proporcional. Aumente para mais nitidez em impressão.

`Content-Type: image/png` · `Content-Disposition: inline; filename="planta-mesas.png"`

```bash
curl https://SEU-APP.up.railway.app/api/tables/image.png -o planta.png
curl "https://SEU-APP.up.railway.app/api/tables/image.png?width=2400" -o planta-hd.png
```

Upload direto para S3 (Node.js, AWS SDK v3):

```js
const png = await fetch(`${API}/api/tables/image.png?width=2000`)
  .then(r => r.arrayBuffer())
  .then(b => Buffer.from(b));

await s3.send(new PutObjectCommand({
  Bucket: 'meu-bucket',
  Key: `planta-${Date.now()}.png`,
  Body: png,
  ContentType: 'image/png',
}));
```

### `GET /api/tables/image.jpeg` (alias `.jpg`)

Mesma planta renderizada como **JPEG** binário. Use quando o pipeline que
consome a imagem não aceita XML/SVG (por exemplo, sistemas de upload que
auto-convertem XML em JSON).

Query string opcional:
- `width` — largura em pixels (default `1300`, mín `200`, máx `4000`).
- `quality` — qualidade JPEG (default `88`, mín `30`, máx `100`).

`Content-Type: image/jpeg` · `Content-Disposition: inline; filename="planta-mesas.jpeg"`

```bash
curl https://SEU-APP.up.railway.app/api/tables/image.jpeg -o planta.jpeg
curl "https://SEU-APP.up.railway.app/api/tables/image.jpeg?width=2400&quality=92" -o planta-hd.jpeg
```

### `POST /api/tables/select`

Reserva uma mesa e **bloqueia** seu uso (status passa para `occupied`).
Tentativas posteriores de reservar a mesma mesa retornam `409` até ela
ser liberada via `DELETE`.

Body JSON: `{ "tableId": <number> }`

Resposta `200`:

```json
{
  "message": "Mesa reservada e bloqueada",
  "selection": { "tableId": 12, "selectedAt": "2026-05-06T14:23:09.746Z" },
  "table": { "id": 12, "shape": "rect", "seats": 6, "area": "salao", "x": 430, "y": 555, "status": "occupied" }
}
```

Erros:
- `400` — `tableId` ausente ou não é número
- `404` — mesa não existe
- `409` — mesa já bloqueada (`occupied` ou `reserved`)

```bash
curl -X POST https://SEU-APP.up.railway.app/api/tables/select \
  -H "Content-Type: application/json" \
  -d '{"tableId": 12}'
```

A mudança de status persiste em `data/selections.json` e sobrevive a restart.

### `DELETE /api/tables/select`

**Libera** uma mesa bloqueada (volta para `available`).

Pode receber `tableId` no corpo, na query string, ou nada (libera a
`currentSelection`).

```bash
# por id (corpo)
curl -X DELETE https://SEU-APP.up.railway.app/api/tables/select \
  -H "Content-Type: application/json" \
  -d '{"tableId": 12}'

# por id (query string)
curl -X DELETE "https://SEU-APP.up.railway.app/api/tables/select?tableId=12"

# sem id - libera a mesa atualmente selecionada
curl -X DELETE https://SEU-APP.up.railway.app/api/tables/select
```

Erros:
- `400` — nenhum `tableId` informado e não há `currentSelection`
- `404` — mesa não existe
- `409` — mesa já está disponível

### `GET /api/tables/history`

Resposta `200`:

```json
{
  "history": [
    { "tableId": 12, "selectedAt": "2026-05-06T14:23:09.746Z", "action": "select" },
    { "tableId": 12, "selectedAt": "2026-05-06T14:23:09.746Z", "action": "clear", "clearedAt": "2026-05-06T14:25:00.000Z" }
  ]
}
```

## Deploy no Railway

1. **Crie o serviço:**
   - Acesse [railway.app](https://railway.app) e clique em **New Project → Deploy from GitHub repo**.
   - Selecione `userJesus/mapa_mesas` e autorize o acesso se necessário.
   - O Railway detecta Node.js automaticamente e usa o script `start` do `package.json`.

2. **Variáveis de ambiente (opcionais):**
   - `PORT` — definido automaticamente pelo Railway.
   - `DATA_DIR` — diretório dos arquivos de estado (default: `./data`).
     Se você anexar um Volume, defina como o caminho de mount (ex.: `/data`).

3. **Persistência (recomendado):**
   - O sistema de arquivos do Railway é **efêmero** por padrão; restarts apagam o `data/`.
   - Para preservar histórico e seleção entre deploys, adicione um **Volume**:
     - No painel do serviço → **Settings → Volumes → New Volume**
     - Mount path: `/data`
     - Defina a env var `DATA_DIR=/data`

4. **Domínio público:**
   - Aba **Settings → Networking → Generate Domain**.
   - A URL pública será algo como `https://mapa-mesas-production.up.railway.app`.

5. **Atualizações:**
   - Cada `git push` na branch principal dispara um novo deploy automaticamente.

## Estrutura

```
mapa_mesas/
├── server.js            # API Express + geração do SVG
├── package.json
├── public/              # Front-end estático
│   ├── index.html
│   ├── style.css
│   └── app.js
└── data/                # (criado em runtime) selections.json
```

## Licença

MIT.
