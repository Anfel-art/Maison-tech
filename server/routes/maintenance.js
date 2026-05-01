import { Router } from 'express';
import db from '../db.js';

const router = Router();

// GET /api/maintenance?machineId=XXX
router.get('/', (req, res) => {
  const { machineId } = req.query;
  let rows;
  if (machineId) {
    rows = db.prepare(`
      SELECT g.*, m.maq_id, m.maq_status
      FROM maq_gastos g
      JOIN maquina m ON g.maq_id = m.maq_id
      WHERE g.maq_id = ?
      ORDER BY g.gsq_timestamp DESC
    `).all(machineId);
  } else {
    rows = db.prepare(`
      SELECT g.*, m.maq_id, m.maq_status
      FROM maq_gastos g
      JOIN maquina m ON g.maq_id = m.maq_id
      ORDER BY g.gsq_timestamp DESC
      LIMIT 100
    `).all();
  }
  res.json(rows.map(r => ({
    id: r.gsq_id,
    machineId: r.maq_id,
    runId: r.rut_id,
    timestamp: r.gsq_timestamp,
    descripcion: r.gsq_descripcion,
    monto: r.gsq_monto,
  })));
});

// POST /api/maintenance
router.post('/', (req, res) => {
  const { machineId, runId, descripcion, monto, items } = req.body;
  if (!machineId || !descripcion) {
    return res.status(400).json({ error: 'machineId y descripcion son requeridos' });
  }

  // Serialize items list into description if provided
  const fullDesc = items && items.length > 0
    ? `${descripcion}\n[Productos: ${items.join(', ')}]`
    : descripcion;

  // rut_id references tabla `ruta` (legacy), no route_runs — siempre null
  const result = db.prepare(`
    INSERT INTO maq_gastos (maq_id, gsq_descripcion, gsq_monto)
    VALUES (?, ?, ?)
  `).run(machineId, fullDesc, monto || 0);

  res.status(201).json({ id: result.lastInsertRowid });
});

export default router;
