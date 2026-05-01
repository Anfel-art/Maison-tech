import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// Admin, superadmin y cajero pueden operar caja
const soloAdmin = requireRole('admin', 'superadmin', 'caja');

// GET /api/caja?from=&to=
router.get('/', soloAdmin, (req, res) => {
  const { from, to } = req.query;
  let sql = 'SELECT * FROM caja_movimiento';
  const params = [];
  const conditions = [];
  if (from) { conditions.push("mov_timestamp >= ?"); params.push(from); }
  if (to)   { conditions.push("mov_timestamp <= ?"); params.push(to + ' 23:59:59'); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY mov_id DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/caja/balance
router.get('/balance', soloAdmin, (req, res) => {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS total_ingresos,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS total_egresos,
      COALESCE(SUM(CASE WHEN mov_es_reembolso=1 THEN mov_monto ELSE 0 END),0)                        AS total_reembolsos
    FROM caja_movimiento
  `).get();
  res.json({
    total_ingresos:   row.total_ingresos,
    total_egresos:    row.total_egresos,
    total_reembolsos: row.total_reembolsos,
    balance:          row.total_ingresos - row.total_egresos - row.total_reembolsos,
  });
});

// POST /api/caja
router.post('/', soloAdmin, (req, res) => {
  const { tipo, concepto, monto, metodo_pago = 'efectivo', referencia = null, cli_id = null, items = null } = req.body;
  if (!tipo || !concepto || monto == null)
    return res.status(400).json({ error: 'tipo, concepto y monto son requeridos' });
  if (!['ingreso', 'egreso'].includes(tipo))
    return res.status(400).json({ error: 'tipo debe ser ingreso o egreso' });
  if (isNaN(monto) || Number(monto) <= 0)
    return res.status(400).json({ error: 'monto debe ser un número positivo' });
  if (!['efectivo','tarjeta','transferencia','mixto'].includes(metodo_pago))
    return res.status(400).json({ error: 'metodo_pago inválido' });

  // Snapshot del nombre del cliente (por si se elimina después)
  let cli_nombre_snap = null;
  if (cli_id) {
    const cli = db.prepare('SELECT cli_nombre FROM cliente WHERE cli_id = ?').get(cli_id);
    if (!cli) return res.status(400).json({ error: 'Cliente no encontrado' });
    cli_nombre_snap = cli.cli_nombre;
  }

  const usu = req.user;
  const dbUsu = usu?.id ? db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usu.id) : null;
  const movItems = items && Array.isArray(items) && items.length > 0 ? JSON.stringify(items) : null;

  let lastId;
  db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO caja_movimiento
        (mov_tipo, mov_concepto, mov_monto, mov_metodo_pago, mov_referencia, usu_id, usu_nombre, cli_id, cli_nombre_snap, mov_items)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tipo, concepto.trim(), Number(monto), metodo_pago, referencia ?? null,
           usu?.id ?? null, dbUsu?.usu_nombre ?? usu?.user ?? null,
           cli_id ?? null, cli_nombre_snap, movItems);
    lastId = result.lastInsertRowid;

    // Descontar stock e incorporar productos al cliente si es venta con items del catálogo
    if (tipo === 'ingreso' && Array.isArray(items) && items.length > 0) {
      const stmtStock = db.prepare(
        'UPDATE catalogo_item SET item_stock = MAX(0, item_stock - ?) WHERE item_id = ?'
      );
      const stmtInsertCP = db.prepare(
        `INSERT INTO cliente_producto (cli_id, item_id, cp_cantidad, cp_origen) VALUES (?, ?, ?, 'venta')
         ON CONFLICT(cli_id, item_id) DO UPDATE SET
           cp_cantidad = cp_cantidad + excluded.cp_cantidad`
      );
      items.forEach(it => {
        if (it.item_id && it.cantidad > 0) {
          stmtStock.run(Number(it.cantidad), it.item_id);
          if (cli_id) stmtInsertCP.run(cli_id, it.item_id, Number(it.cantidad));
        }
      });
    }
  })();

  res.status(201).json(db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(lastId));
});

// POST /api/caja/:id/reembolso — genera un egreso inverso referenciado al original
router.post('/:id/reembolso', soloAdmin, (req, res) => {
  const original = db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (original.mov_es_reembolso) return res.status(400).json({ error: 'Este movimiento ya es un reembolso' });

  // Verifica que no tenga ya un reembolso asociado
  const yaReembolsado = db.prepare('SELECT 1 FROM caja_movimiento WHERE mov_ref_id = ? AND mov_es_reembolso = 1').get(req.params.id);
  if (yaReembolsado) return res.status(400).json({ error: 'Este movimiento ya fue reembolsado' });

  const usu = req.user;
  const dbUsu = usu?.id ? db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usu.id) : null;
  const tipoReembolso = original.mov_tipo === 'ingreso' ? 'egreso' : 'ingreso';

  const result = db.prepare(`
    INSERT INTO caja_movimiento
      (mov_tipo, mov_concepto, mov_monto, mov_metodo_pago, mov_es_reembolso, mov_ref_id, usu_id, usu_nombre)
    VALUES (?, ?, ?, ?, 1, ?, ?, ?)
  `).run(
    tipoReembolso,
    `REEMBOLSO — ${original.mov_concepto}`,
    original.mov_monto,
    original.mov_metodo_pago,
    original.mov_id,
    usu?.id ?? null,
    dbUsu?.usu_nombre ?? usu?.user ?? null
  );

  res.status(201).json(db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(result.lastInsertRowid));
});

// GET /api/caja/cierres?fecha=YYYY-MM-DD  (sin fecha → lista todos)
router.get('/cierres', soloAdmin, (req, res) => {
  const { fecha } = req.query;
  if (fecha) {
    return res.json(db.prepare('SELECT * FROM caja_cierre WHERE cierre_fecha = ?').get(fecha) || null);
  }
  res.json(db.prepare('SELECT * FROM caja_cierre ORDER BY cierre_fecha DESC').all());
});

// POST /api/caja/cierre  — crea el cierre del día
router.post('/cierre', soloAdmin, (req, res) => {
  const { fecha, notas = null } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha requerida' });

  const existing = db.prepare('SELECT 1 FROM caja_cierre WHERE cierre_fecha = ?').get(fecha);
  if (existing) return res.status(409).json({ error: 'La caja de este día ya fue cerrada' });

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS ingresos,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS egresos,
      COALESCE(SUM(CASE WHEN mov_es_reembolso=1 THEN mov_monto ELSE 0 END),0)                        AS reembolsos,
      COUNT(*) AS mov_count
    FROM caja_movimiento
    WHERE mov_timestamp >= ? AND mov_timestamp <= ?
  `).get(fecha, fecha + ' 23:59:59');

  const usu = req.user;
  const dbUsu = usu?.id ? db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usu.id) : null;

  const result = db.prepare(`
    INSERT INTO caja_cierre
      (cierre_fecha, cierre_ingresos, cierre_egresos, cierre_reembolsos, cierre_balance, cierre_mov_count, cierre_notas, usu_id, usu_nombre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fecha,
    stats.ingresos, stats.egresos, stats.reembolsos,
    stats.ingresos - stats.egresos - stats.reembolsos,
    stats.mov_count, notas,
    usu?.id ?? null, dbUsu?.usu_nombre ?? usu?.user ?? null
  );

  res.status(201).json(db.prepare('SELECT * FROM caja_cierre WHERE cierre_id = ?').get(result.lastInsertRowid));
});

// DELETE /api/caja/cierre/:fecha  — reabre la caja eliminando el cierre del día
router.delete('/cierre/:fecha', soloAdmin, (req, res) => {
  const { fecha } = req.params;
  const cierre = db.prepare('SELECT 1 FROM caja_cierre WHERE cierre_fecha = ?').get(fecha);
  if (!cierre) return res.status(404).json({ error: 'No existe cierre para esa fecha' });
  db.prepare('DELETE FROM caja_cierre WHERE cierre_fecha = ?').run(fecha);
  res.json({ ok: true });
});

// DELETE /api/caja/:id
router.delete('/:id', soloAdmin, (req, res) => {
  const mov = db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (mov.mov_es_reembolso) return res.status(400).json({ error: 'No se puede eliminar un reembolso directamente' });
  // Eliminar reembolso asociado si existe
  db.prepare('DELETE FROM caja_movimiento WHERE mov_ref_id = ?').run(req.params.id);
  db.prepare('DELETE FROM caja_movimiento WHERE mov_id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
