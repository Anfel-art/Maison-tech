import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import authRouter from './routes/auth.js';
import machinesRouter from './routes/machines.js';
import recordsRouter from './routes/records.js';
import routeRunsRouter from './routes/routeRuns.js';
import maintenanceRouter from './routes/maintenance.js';
import reportsRouter from './routes/reports.js';
import cajaRouter from './routes/caja.js';
import catalogoRouter from './routes/catalogo.js';
import clientesRouter from './routes/clientes.js';
import usuariosRouter from './routes/usuarios.js';
import db from './db.js';
import { requireAuth, requireRole } from './middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

// Permite localhost Y cualquier IP de red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+)(:\d+)?$/;
app.use(cors({ origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)) }));
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Rutas públicas
app.use('/api/auth', authRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Rutas protegidas — requieren JWT válido
app.use('/api/machines', requireAuth, machinesRouter);
app.use('/api/records', requireAuth, recordsRouter);
app.use('/api/route-runs', requireAuth, routeRunsRouter);
app.use('/api/maintenance', requireAuth, maintenanceRouter);
app.use('/api/reports',    requireAuth, reportsRouter);
app.use('/api/caja',      requireAuth, cajaRouter);
app.use('/api/catalogo',  requireAuth, catalogoRouter);
app.use('/api/clientes',  requireAuth, clientesRouter);
app.use('/api/usuarios',  requireAuth, usuariosRouter);
function readConfig() {
  const rows = db.prepare('SELECT cfg_key, cfg_value FROM app_config').all();
  const cfg = {};
  rows.forEach(r => { cfg[r.cfg_key] = parseFloat(r.cfg_value) || r.cfg_value; });
  return cfg;
}

app.get('/api/config', requireAuth, (_req, res) => res.json(readConfig()));

app.patch('/api/config', requireAuth, requireRole('superadmin'), (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO app_config (cfg_key, cfg_value) VALUES (?,?)');
  db.transaction(() => {
    for (const [k, v] of Object.entries(req.body)) {
      if (k && k !== 'schema_clean_v1') stmt.run(k, String(v));
    }
  })();
  res.json(readConfig());
});
app.get('/', (_req, res) => res.send('SEPRISA API is running. Use /api/health for health check.'));

app.listen(PORT, () => {
  console.log(`[server] SEPRISA API corriendo en http://localhost:${PORT}`);
});
