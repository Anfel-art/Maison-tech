import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { scheduleBackup } from './backup.js';
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
import solicitudesRouter from './routes/solicitudes.js';
import db from './db.js';
import { requireAuth, requireRole } from './middleware/auth.js';

// Rate limiter para el endpoint de auditoría (superadmin — evita consultas masivas accidentales)
const auditLimiter = rateLimit({
  windowMs: 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas consultas al log de auditoría. Intentá de nuevo en un minuto.' },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

// Seguridad HTTP: cabeceras recomendadas (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
app.use(compression()); // Comprime respuestas JSON/texto (reduce ~70% el tráfico)
app.use(helmet({
  // La app sirve archivos estáticos (uploads), no necesita CSP estricto en la API
  contentSecurityPolicy: false,
}));

// Permite localhost Y cualquier IP de red local (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|(192\.168|10\.\d+|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+)(:\d+)?$/;
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));
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
app.use('/api/solicitudes', requireAuth, solicitudesRouter);

// GET /api/audit?limit=100&page=1&accion=login&usuId=&from=&to= — solo superadmin, con rate limit
app.get('/api/audit', requireAuth, requireRole('superadmin'), auditLimiter, (req, res) => {
  const limit  = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const offset = (page - 1) * limit;
  const { accion, usuId, from, to } = req.query;

  const conds = [], params = [];
  if (accion) { conds.push('a.accion = ?');                              params.push(accion); }
  if (usuId)  { conds.push('a.usu_id = ?');                              params.push(Number(usuId)); }
  if (from)   { conds.push("date(a.timestamp) >= date(?)");              params.push(from); }
  if (to)     { conds.push("date(a.timestamp) <= date(?)");              params.push(to); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';

  // Use unaliased conds for simple COUNT
  const countConds = [], countParams = [];
  if (accion) { countConds.push('accion = ?');                           countParams.push(accion); }
  if (usuId)  { countConds.push('usu_id = ?');                           countParams.push(Number(usuId)); }
  if (from)   { countConds.push("date(timestamp) >= date(?)");           countParams.push(from); }
  if (to)     { countConds.push("date(timestamp) <= date(?)");           countParams.push(to); }
  const countWhere = countConds.length ? ' WHERE ' + countConds.join(' AND ') : '';

  const { total } = db.prepare(`SELECT COUNT(*) as total FROM audit_log${countWhere}`).get(...countParams);
  const rows = db.prepare(
    `SELECT a.*, u.usu_nombre
     FROM audit_log a
     LEFT JOIN usuario u ON a.usu_id = u.usu_id
     ${where}
     ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ data: rows, total, page, limit, totalPages: Math.ceil(total / limit) });
});
function readConfig() {
  const rows = db.prepare('SELECT cfg_key, cfg_value FROM app_config').all();
  const cfg = {};
  rows.forEach(r => { cfg[r.cfg_key] = parseFloat(r.cfg_value) || r.cfg_value; });
  return cfg;
}

app.get('/api/config', requireAuth, requireRole('admin', 'superadmin'), (_req, res) => res.json(readConfig()));

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

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[server] Error no controlado:', err?.message ?? err);
  // No exponer stack traces al cliente en producción
  res.status(err?.status ?? 500).json({ error: err?.message ?? 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`[server] SEPRISA API corriendo en http://localhost:${PORT}`);
  scheduleBackup(); // Backup automático cada 24h
});
