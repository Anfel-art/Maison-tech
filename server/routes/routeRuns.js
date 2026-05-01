import { Router } from 'express';
import db from '../db.js';

const router = Router();

function formatRun(run) {
  const stops = db.prepare(`
    SELECT s.*, l.lgr_nombre as location, t.tmq_desc as type, l.lgr_lat as lat, l.lgr_lng as lng
    FROM route_run_stops s
    JOIN maquina m ON s.machine_id = m.maq_id
    LEFT JOIN lugar l ON m.lgr_id = l.lgr_id
    LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
    WHERE s.route_run_id = ? ORDER BY s.stop_order
  `).all(run.id);

  const { total: totalRecaudado } = db.prepare(
    'SELECT COALESCE(SUM(rre_mnto_total), 0) as total FROM rec_registro WHERE route_run_id = ?'
  ).get(run.id);

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

// GET /api/route-runs/mis-tareas  ← debe estar ANTES de /:id
router.get('/mis-tareas', (req, res) => {
  const runs = db.prepare(
    "SELECT * FROM route_runs WHERE usu_id = ? AND status IN ('pending','active') ORDER BY id DESC"
  ).all(req.user.id);
  res.json(runs.map(formatRun));
});

// GET /api/route-runs/mi-historial — recorridos completados del recaudador autenticado
router.get('/mi-historial', (req, res) => {
  const runs = db.prepare(
    "SELECT * FROM route_runs WHERE usu_id = ? AND status IN ('completed','cancelled') ORDER BY id DESC LIMIT 50"
  ).all(req.user.id);
  res.json(runs.map(formatRun));
});

// GET /api/route-runs?status=active&usuId=3
router.get('/', (req, res) => {
  const { status, usuId } = req.query;
  const conds = [];
  const params = [];

  if (status) { conds.push('status = ?'); params.push(status); }
  if (usuId)  { conds.push('usu_id = ?'); params.push(Number(usuId)); }

  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const runs = db.prepare(`SELECT * FROM route_runs${where} ORDER BY id DESC`).all(...params);
  res.json(runs.map(formatRun));
});

// GET /api/route-runs/:id
router.get('/:id', (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  res.json(formatRun(run));
});

// POST /api/route-runs — body: { machineIds: ['MQR-001', ...], recaudadorId?: number }
router.post('/', (req, res) => {
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

  res.status(201).json(formatRun(create()));
});

// PATCH /api/route-runs/:id/aceptar — recaudador acepta la tarea asignada
router.patch('/:id/aceptar', (req, res) => {
  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  if (run.usu_id !== req.user.id) return res.status(403).json({ error: 'No autorizado' });
  if (run.status !== 'pending') return res.status(400).json({ error: 'El recorrido no está pendiente de aceptación' });

  db.prepare(
    "UPDATE route_runs SET status = 'active', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?"
  ).run(req.params.id);

  res.json(formatRun(db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id)));
});

// PATCH /api/route-runs/:id — body: { status, totalDistance, totalTime }
router.patch('/:id', (req, res) => {
  const { status, totalDistance, totalTime } = req.body;
  const completedAt = status === 'completed' ? new Date().toISOString() : null;

  db.prepare(`
    UPDATE route_runs SET
      status = COALESCE(?, status),
      total_distance = COALESCE(?, total_distance),
      total_time = COALESCE(?, total_time),
      completed_at = COALESCE(?, completed_at)
    WHERE id = ?
  `).run(status ?? null, totalDistance ?? null, totalTime ?? null, completedAt, req.params.id);

  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  res.json(formatRun(run));
});

// POST /api/route-runs/:id/stops — agrega una máquina extra al recorrido
router.post('/:id/stops', (req, res) => {
  const { machineId } = req.body;
  if (!machineId) return res.status(400).json({ error: 'machineId requerido' });

  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'Recorrido no encontrado' });
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

// PATCH /api/route-runs/:id/stops/:stopId — body: { status: 'done'|'failed' }
router.patch('/:id/stops/:stopId', (req, res) => {
  const { status } = req.body;
  const visitedAt = new Date().toISOString();

  db.prepare('UPDATE route_run_stops SET status = ?, visited_at = ? WHERE id = ? AND route_run_id = ?')
    .run(status, visitedAt, req.params.stopId, req.params.id);

  const run = db.prepare('SELECT * FROM route_runs WHERE id = ?').get(req.params.id);
  if (!run) return res.status(404).json({ error: 'No encontrado' });
  res.json(formatRun(run));
});

// DELETE /api/route-runs/:id/stops/:stopId — quita una parada del recorrido
router.delete('/:id/stops/:stopId', (req, res) => {
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
