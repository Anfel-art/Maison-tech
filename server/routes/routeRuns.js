import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import { calcularYGuardarCierre } from './caja.js';

const router = Router();

const ADMIN_ROLES = ['superadmin', 'admin'];

// El rol "caja" no tiene acceso a recorridos (información operacional)
const sinCaja = (req, res, next) => {
  if (req.user?.rol === 'caja')
    return res.status(403).json({ error: 'Acceso denegado' });
  next();
};

// Todo usuario con rol 'terreno' tiene módulo de caja integrado
function usuTieneCaja(usuId) {
  const usu = db.prepare('SELECT usu_rol FROM usuario WHERE usu_id = ?').get(usuId);
  return usu?.usu_rol === 'terreno';
}

// Abre automáticamente la sesión de caja para un usuario terreno+caja al iniciar ruta
function autoAbrirCaja(usuId, fecha) {
  const existing = db.prepare('SELECT cierre_id FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, usuId);
  if (existing) return; // ya abierta o cerrada
  const dbUsu = db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usuId);
  db.prepare(`
    INSERT INTO caja_cierre
      (cierre_fecha, cierre_status, apertura_efectivo, apertura_notas, apertura_timestamp,
       apertura_usu_id, apertura_usu_nombre,
       cierre_ingresos, cierre_egresos, cierre_reembolsos, cierre_balance, cierre_mov_count)
    VALUES (?, 'abierta', 0, 'Apertura automática al iniciar ruta', datetime('now'), ?, ?, 0, 0, 0, 0, 0)
  `).run(fecha, usuId, dbUsu?.usu_nombre ?? null);
}

// Al completar ruta: registra movimientos de caja por cada rec_registro del run
function registrarRecaudacionEnCaja(runId, usuId) {
  const registros = db.prepare(`
    SELECT r.rre_id, r.maq_id, r.rre_mnto_total, r.rre_timestamp,
           m.cli_id, c.cli_nombre
    FROM rec_registro r
    JOIN maquina m ON r.maq_id = m.maq_id
    LEFT JOIN cliente c ON m.cli_id = c.cli_id
    WHERE r.route_run_id = ? AND r.rre_mnto_total > 0 AND r.rre_tipo != 'init'
  `).all(runId);

  const dbUsu = db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usuId);
  const stmtInsert = db.prepare(`
    INSERT INTO caja_movimiento
      (mov_tipo, mov_concepto, mov_monto, mov_metodo_pago, mov_referencia,
       usu_id, usu_nombre, cli_id, cli_nombre_snap, maq_id)
    VALUES ('ingreso', ?, ?, 'efectivo', ?, ?, ?, ?, ?, ?)
  `);

  for (const reg of registros) {
    const concepto = `Recaudación MQ ${reg.maq_id}${reg.cli_nombre ? ' — ' + reg.cli_nombre : ''}`;
    const referencia = `Ruta #${runId} · Reg #${reg.rre_id}`;
    stmtInsert.run(
      concepto,
      Number(reg.rre_mnto_total),
      referencia,
      usuId,
      dbUsu?.usu_nombre ?? null,
      reg.cli_id ?? null,
      reg.cli_nombre ?? null,
      reg.maq_id
    );
  }
  return registros.length;
}

/** Devuelve true si el usuario puede gestionar el recorrido dado */
function puedeGestionar(user, run) {
  if (ADMIN_ROLES.includes(user.rol)) return true;         // admin/superadmin: acceso total
  if (user.rol === 'terreno' && run.usu_id === user.id) return true; // recaudador asignado
  return false;
}

/** Formatea un run individual (con stops — para GET /:id) */
function formatRun(run, stopsMap = null, totalsMap = null) {
  const stops = stopsMap
    ? (stopsMap.get(run.id) ?? [])
    : db.prepare(`
        SELECT s.*, l.lgr_nombre as location, t.tmq_desc as type, l.lgr_lat as lat, l.lgr_lng as lng
        FROM route_run_stops s
        JOIN maquina m ON s.machine_id = m.maq_id
        LEFT JOIN lugar l ON m.lgr_id = l.lgr_id
        LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
        WHERE s.route_run_id = ? ORDER BY s.stop_order
      `).all(run.id);

  const totalRecaudado = totalsMap
    ? (totalsMap.get(run.id) ?? 0)
    : db.prepare(
        'SELECT COALESCE(SUM(rre_mnto_total), 0) as total FROM rec_registro WHERE route_run_id = ?'
      ).get(run.id).total;

  const doneCount   = stops.filter(s => s.status === 'done').length;
  const failedCount = stops.filter(s => s.status === 'failed').length;

  let duration = null;
  if (run.started_at && run.completed_at) {
    duration = Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 60000);
  }

  return {
    id: run.id,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    status: run.status,
    totalDistance: run.total_distance,
    totalTime: run.total_time,
    totalRecaudado,
    duration,
    doneCount,
    failedCount,
    recaudadorId:     run.usu_id ?? null,
    recaudadorNombre: run.recaudador_nombre ?? null,
    stops: stops.map(s => ({
      id: s.id,
      machineId: s.machine_id,
      location: s.location,
      type: s.type,
      stopOrder: s.stop_order,
      status: s.status,
      visitedAt: s.visited_at,
      coords: s.lat && s.lng ? [s.lat, s.lng] : null,
    })),
  };
}

/** Batch-fetch stops y totales para una lista de runs (evita N+1) */
function batchFormat(runs) {
  if (!runs.length) return [];
  const ids = runs.map(r => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const allStops = db.prepare(`
    SELECT s.*, l.lgr_nombre as location, t.tmq_desc as type, l.lgr_lat as lat, l.lgr_lng as lng
    FROM route_run_stops s
    JOIN maquina m ON s.machine_id = m.maq_id
    LEFT JOIN lugar l ON m.lgr_id = l.lgr_id
    LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
    WHERE s.route_run_id IN (${placeholders}) ORDER BY s.route_run_id, s.stop_order
  `).all(...ids);

  const allTotals = db.prepare(`
    SELECT route_run_id, COALESCE(SUM(rre_mnto_total), 0) as total
    FROM rec_registro WHERE route_run_id IN (${placeholders})
    GROUP BY route_run_id
  `).all(...ids);

  const stopsMap  = new Map();
  const totalsMap = new Map();
  for (const s of allStops) {
    if (!stopsMap.has(s.route_run_id)) stopsMap.set(s.route_run_id, []);
    stopsMap.get(s.route_run_id).push(s);
  }
  for (const t of allTotals) totalsMap.set(t.route_run_id, t.total);

  return runs.map(r => formatRun(r, stopsMap, totalsMap));
}

// GET /api/route-runs/mis-tareas  ← debe estar ANTES de /:id
router.get('/mis-tareas', sinCaja, (req, res) => {
  const runs = db.prepare(
    "SELECT * FROM route_runs WHERE usu_id = ? AND status IN ('pending','active') ORDER BY id DESC"
  ).all(req.user.id);
  res.json(batchFormat(runs));
});

// GET /api/route-runs/mi-historial — recorridos completados del recaudador autenticado
router.get('/mi-historial', sinCaja, (req, res) => {
  const runs = db.prepare(
    "SELECT * FROM route_runs WHERE usu_id = ? AND status IN ('completed','cancelled') ORDER BY id DESC LIMIT 50"
  ).all(req.user.id);
  res.json(batchFormat(runs));
});

// GET /api/route-runs?status=active&usuId=3&limit=6
// Sin filtros aplica ventana de 90 días para evitar cargar todo el historial
router.get('/', sinCaja, (req, res) => {
  const { status, usuId } = req.query;
  const limit = req.query.limit ? Math.min(500, Math.max(1, parseInt(req.query.limit))) : null;
  const conds = [];
  const params = [];

  if (status) { conds.push('status = ?'); params.push(status); }
  if (usuId)  { conds.push('usu_id = ?'); params.push(Number(usuId)); }

  // Sin ningún filtro, limitar a los últimos 90 días
  if (!status && !usuId) {
    conds.push("date(started_at) >= date('now', '-90 days')");
  }

  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const limitClause = limit ? ` LIMIT ${limit}` : '';
  const runs = db.prepare(`SELECT * FROM route_runs${where} ORDER BY id DESC${limitClause}`).all(...params);
  res.json(batchFormat(runs));
});

// GET /api/route-runs/:id
router.get('/:id', sinCaja, (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  res.json(formatRun(run));
});

// POST /api/route-runs — solo admin/superadmin pueden crear recorridos
router.post('/', requireAuth, (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.rol))
    return res.status(403).json({ error: 'Solo administradores pueden crear recorridos' });
  const { machineIds, recaudadorId } = req.body;
  if (!machineIds?.length) return res.status(400).json({ error: 'machineIds requerido' });

  const create = db.transaction(() => {
    let recaudadorNombre = null;
    if (recaudadorId) {
      const usu = db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(recaudadorId);
      recaudadorNombre = usu?.usu_nombre ?? null;
    }
    // Si tiene recaudador asignado → queda en 'pending' hasta que el recaudador acepte
    const status = recaudadorId ? 'pending' : 'active';

    const result = db.prepare(
      'INSERT INTO route_runs (status, usu_id, recaudador_nombre) VALUES (?,?,?)'
    ).run(status, recaudadorId ?? null, recaudadorNombre);
    const runId = result.lastInsertRowid;

    const insertStop = db.prepare(
      'INSERT INTO route_run_stops (route_run_id, machine_id, stop_order) VALUES (?, ?, ?)'
    );
    machineIds.forEach((id, i) => insertStop.run(runId, id, i));

    return db.prepare('SELECT * FROM route_runs WHERE id = ?').get(runId);
  });

  const created = create();
  audit(req, 'route_run.create', 'route_run', created.id,
    { recaudadorId: recaudadorId ?? null, machineCount: machineIds.length, status: created.status });
  res.status(201).json(formatRun(created));
});

// PATCH /api/route-runs/:id/aceptar — recaudador acepta la tarea asignada
router.patch('/:id/aceptar', requireAuth, (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  if (run.usu_id !== req.user.id) return res.status(403).json({ error: 'No autorizado' });
  if (run.status !== 'pending') return res.status(400).json({ error: 'El recorrido no está pendiente de aceptación' });

  db.prepare(
    "UPDATE route_runs SET status = 'active', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?"
  ).run(req.params.id);

  // Si el recaudador tiene acceso a caja, auto-abrir sesión de caja
  if (usuTieneCaja(req.user.id)) {
    const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Asuncion' });
    try { autoAbrirCaja(req.user.id, fecha); } catch (e) { console.error('[caja] Error auto-apertura:', e.message); }
  }

  res.json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

// PATCH /api/route-runs/:id — body: { status, totalDistance, totalTime }
// Admin/superadmin: cualquier recorrido. Terreno: solo el suyo propio.
const VALID_RUN_STATUS = ['pending', 'active', 'completed', 'cancelled'];
router.patch('/:id', (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });

  if (!puedeGestionar(req.user, run))
    return res.status(403).json({ error: 'No tenés permiso para modificar este recorrido' });

  const { status, totalDistance, totalTime } = req.body;

  if (status !== undefined && !VALID_RUN_STATUS.includes(status))
    return res.status(400).json({ error: `Estado inválido. Valores permitidos: ${VALID_RUN_STATUS.join(', ')}` });

  // Terreno solo puede completar o cancelar su recorrido (no revertir a pending/active)
  if (status && req.user.rol === 'terreno' && !['completed', 'cancelled'].includes(status))
    return res.status(403).json({ error: 'Solo puedes completar o cancelar tu recorrido' });

  const completedAt = status === 'completed' ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE route_runs SET
      status = COALESCE(?, status),
      total_distance = COALESCE(?, total_distance),
      total_time = COALESCE(?, total_time),
      completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(status ?? null, totalDistance ?? null, totalTime ?? null, completedAt, req.params.id);

  if (status) {
    audit(req, 'route_run.status', 'route_run', Number(req.params.id),
      { from: run.status, to: status });
  }

  // Si el recorrido se completó (transición nueva, no ya estaba completed) y el recaudador tiene caja
  if (status === 'completed' && run.status !== 'completed' && run.usu_id && usuTieneCaja(run.usu_id)) {
    const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Asuncion' });
    try {
      db.transaction(() => {
        registrarRecaudacionEnCaja(Number(req.params.id), run.usu_id);
        calcularYGuardarCierre({ usuId: run.usu_id, fecha, routeRunId: Number(req.params.id) });
      })();
    } catch (e) { console.error('[caja] Error auto-cierre al completar ruta:', e.message); }
  }

  res.json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

// POST /api/route-runs/:id/stops — agrega una máquina extra al recorrido
// Admin/superadmin: cualquier recorrido. Terreno: solo su propio recorrido activo.
router.post('/:id/stops', (req, res) => {
  const { machineId } = req.body;
  if (!machineId) return res.status(400).json({ error: 'machineId requerido' });

  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Recorrido no encontrado' });

  // Admin/superadmin pueden agregar a cualquier recorrido; terreno solo al suyo
  if (!ADMIN_ROLES.includes(req.user.rol) && run.usu_id !== req.user.id)
    return res.status(403).json({ error: 'Solo podés agregar paradas a tu propio recorrido' });

  if (!['pending', 'active'].includes(run.status))
    return res.status(400).json({ error: 'Solo se pueden modificar recorridos activos o pendientes' });

  const maq = db.prepare('SELECT 1 FROM maquina WHERE maq_id = ?').get(machineId);
  if (!maq) return res.status(404).json({ error: 'Máquina no encontrada' });

  const dup = db.prepare('SELECT 1 FROM route_run_stops WHERE route_run_id = ? AND machine_id = ?').get(req.params.id, machineId);
  if (dup) return res.status(409).json({ error: 'La máquina ya está en el recorrido' });

  const { maxOrd } = db.prepare('SELECT COALESCE(MAX(stop_order), -1) as maxOrd FROM route_run_stops WHERE route_run_id = ?').get(req.params.id);
  db.prepare('INSERT INTO route_run_stops (route_run_id, machine_id, stop_order) VALUES (?,?,?)').run(req.params.id, machineId, maxOrd + 1);

  res.status(201).json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

// PATCH /api/route-runs/:id/stops/:stopId — body: { status: 'done'|'failed'|'pending' }
// Admin/superadmin: cualquier recorrido. Terreno: solo el suyo.
const VALID_STOP_STATUS = ['pending', 'done', 'failed'];
router.patch('/:id/stops/:stopId', (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });

  if (!puedeGestionar(req.user, run))
    return res.status(403).json({ error: 'No tenés permiso para modificar este recorrido' });

  const { status } = req.body;
  if (!status || !VALID_STOP_STATUS.includes(status))
    return res.status(400).json({ error: `Estado de parada inválido. Valores permitidos: ${VALID_STOP_STATUS.join(', ')}` });

  const visitedAt = new Date().toISOString();
  db.prepare('UPDATE route_run_stops SET status = ?, visited_at = ? WHERE id = ? AND route_run_id = ?')
    .run(status, visitedAt, req.params.stopId, req.params.id);

  res.json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

// DELETE /api/route-runs/:id/stops/:stopId — quita una parada (solo admins)
router.delete('/:id/stops/:stopId', (req, res) => {
  if (!ADMIN_ROLES.includes(req.user.rol))
    return res.status(403).json({ error: 'Solo administradores pueden eliminar paradas' });

  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Recorrido no encontrado' });
  if (!['pending', 'active'].includes(run.status))
    return res.status(400).json({ error: 'Solo se pueden modificar recorridos pendientes o en curso' });

  const stop = db.prepare('SELECT * FROM route_run_stops WHERE id = ? AND route_run_id = ?')
    .get(req.params.stopId, req.params.id);
  if (!stop) return res.status(404).json({ error: 'Parada no encontrada' });

  db.prepare('DELETE FROM route_run_stops WHERE id = ?').run(req.params.stopId);

  // Si ya no quedan paradas, cancelar el recorrido automáticamente
  const { cnt } = db.prepare('SELECT COUNT(*) as cnt FROM route_run_stops WHERE route_run_id = ?').get(req.params.id);
  if (cnt === 0) {
    db.prepare("UPDATE route_runs SET status = 'cancelled' WHERE id = ?").run(req.params.id);
    return res.json({ ok: true, runCancelled: true, runId: Number(req.params.id) });
  }

  res.json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

export default router;
