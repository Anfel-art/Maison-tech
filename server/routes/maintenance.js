import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// GET /api/maintenance?machineId=XXX
// Admin/superadmin ven todos; terreno solo su propia máquina (machineId obligatorio)
router.get('/', requireRole('admin', 'superadmin', 'terreno'), (req, res) => {
  const { machineId } = req.query;
  // Terreno solo puede consultar por máquina específica, nunca el listado global
  if (req.user.rol === 'terreno' && !machineId)
    return res.status(400).json({ error: 'machineId es requerido para este rol' });
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

// POST /api/maintenance — solo admin, superadmin y terreno pueden registrar mantenimientos
router.post('/', requireRole('superadmin', 'admin', 'terreno'), (req, res) => {
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
