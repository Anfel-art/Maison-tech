# SEPRISA – Sistema de Gestión y Recaudación

App de gestión de máquinas recreativas (peluches, grúas, monedas, casitas) con rutas de recaudación geolocalizadas.

## Stack

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 + Vite + PWA |
| Backend | Express 5 + better-sqlite3 |
| Mapa | Leaflet.js + leaflet-routing-machine (OSRM) |
| DB | SQLite (`server/seprisa.db`) |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Deploy | Docker + nginx |

## Funcionalidades

- **Dashboard** – KPIs, últimos registros, estado de máquinas
- **Gestión de Máquinas** – CRUD de máquinas, tipos configurables, selector de ubicación en mapa
- **Tipos de Campo** – Campos dinámicos por tipo de máquina (number, constant, select), fórmulas con `{key}` y `{prev:key}`, grupos, orden drag-and-drop
- **Registro de Recaudación** – Formulario por máquina con campos calculados automáticamente, soporte de fotos
- **Rutas** – Vista móvil del recaudador: mapa con paradas, optimización nearest-neighbor, seguimiento de distancia/tiempo
- **Historial de Rutas** – Panel admin con ejecuciones activas y finalizadas
- **Roles** – `superadmin` · `admin` · `terreno`

## Instalación con Docker (recomendado)

### Requisitos
- Docker Desktop instalado y corriendo

### Pasos

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd "Rutas de Recaudacion"

# 2. Construir y levantar los contenedores
docker-compose up -d --build

# 3. Verificar que el stack esté en pie
curl http://localhost:5173/api/health
# → {"ok":true}
```

La app queda disponible en **http://localhost:5173**

> **Nota:** El API corre internamente en el puerto 3001 dentro de Docker.
> El nginx del frontend hace proxy de `/api/` → `api:3001`, por lo que
> no es necesario exponer el puerto 3001 al host.

### Cargar datos de demo

Luego de que el stack esté corriendo, ejecutar desde la raíz del repo:

```bash
cd pos-app
node server/seed-demo.mjs
```

Esto crea:
- Ubicación **JFC San Lorenzo** (San Lorenzo, Paraguay) con coordenadas reales
- Tipo de máquina **Peluches** con 24 campos organizados en grupos:
  - General (constante `coin_valor`)
  - Contador Digital (coin, prize, total_coin, total_prize, ingreso, % local)
  - Real (ingreso real, ingreso recaudación, valor premios, saldo)
  - Contador Analógico (crédito/premio ANT y ACT, diferencias)
  - Premios Real (stock ini/fin, salida, reposición, precio, valor)
- 6 máquinas: `PL-001-Tank`, `PL-001-Medi`, `PL-002-Medi`, `PL-003-Medi`, `PL-004-Medi`, `PL-001-PlayT`

El script es **idempotente** — se puede ejecutar varias veces sin duplicar datos.

## Usuarios por defecto

| Usuario | Contraseña | Rol |
|---------|-----------|-----|
| `superadmin` | `superadmin` | Superadmin (configuración) |
| `admin` | `admin` | Admin (dashboard) |
| `terreno` | `terreno` | Recaudador (app móvil) |

## Desarrollo local (sin Docker)

```bash
cd pos-app
npm install

# Terminal 1 — API (puerto 3001)
npm run server:dev

# Terminal 2 — Frontend (puerto 5173)
npm run dev
```

> En modo dev, Vite hace proxy de `/api/` → `localhost:3001` automáticamente.

## Actualizar contenedores tras cambios

```bash
# Solo frontend (cambios en src/)
docker-compose build frontend && docker-compose up -d frontend

# Solo API (cambios en server/)
docker-compose build api && docker-compose up -d api

# Ambos
docker-compose build && docker-compose up -d
```

## Estructura

```
Rutas de Recaudacion/
├── docker-compose.yml
└── pos-app/
    ├── Dockerfile.api         # node:20-slim, puerto 3001
    ├── Dockerfile.frontend    # build Vite + nginx:stable-alpine, puerto 80
    ├── nginx.conf             # proxy /api/ y /uploads/ → api:3001
    ├── server/
    │   ├── index.js           # Express entry point
    │   ├── db.js              # Schema SQLite + migraciones + seed usuarios
    │   ├── seed-demo.mjs      # Datos de demo (tipos, campos, máquinas)
    │   ├── middleware/
    │   │   └── auth.js        # JWT middleware
    │   └── routes/
    │       ├── auth.js        # POST /api/auth/login
    │       ├── machines.js    # CRUD máquinas + /meta/tipos + /meta/lugares
    │       ├── records.js     # Registros de recaudación + imágenes
    │       ├── routeRuns.js   # Ejecuciones de rutas
    │       ├── reports.js     # Reportes y exportación
    │       ├── config.js      # Configuración del negocio
    │       └── maintenance.js # Gastos de mantenimiento
    └── src/
        ├── App.jsx            # Panel admin (Dashboard, Máquinas, Rutas, Config)
        ├── MobileApp.jsx      # App recaudador (mapa + formularios)
        ├── MapView.jsx        # Mapa Leaflet con routing
        └── api.js             # Cliente HTTP centralizado
```

## API REST

```
POST   /api/auth/login

GET    /api/machines
POST   /api/machines
PATCH  /api/machines/:id
DELETE /api/machines/:id
GET    /api/machines/meta/tipos
POST   /api/machines/meta/tipos
PATCH  /api/machines/meta/tipos/:id
DELETE /api/machines/meta/tipos/:id
POST   /api/machines/meta/tipos/:id/campos
PATCH  /api/machines/meta/tipos/:id/campos/:campoId
DELETE /api/machines/meta/tipos/:id/campos/:campoId
GET    /api/machines/meta/lugares
POST   /api/machines/meta/lugares
PATCH  /api/machines/meta/lugares/:id

GET    /api/records?machineId=&routeRunId=&from=&to=
POST   /api/records
POST   /api/records/:id/images

GET    /api/route-runs?status=
POST   /api/route-runs
PATCH  /api/route-runs/:id
PATCH  /api/route-runs/:id/stops/:stopId

GET    /api/reports/por-evento
GET    /api/reports/mensual
GET    /api/reports/acumulado
GET    /api/reports/export

GET    /api/config
PATCH  /api/config
```
