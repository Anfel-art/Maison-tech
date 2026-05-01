import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
const soloAdmin = requireRole('admin', 'superadmin');

function fmt(row) {
  return {
    id:        row.cli_id,
    nombre:    row.cli_nombre,
    tipo:      row.cli_tipo,
    rucCi:     row.cli_ruc_ci   ?? null,
    email:     row.cli_email    ?? null,
    telefono:  row.cli_telefono ?? null,
    direccion: row.cli_direccion ?? null,
    contacto:  row.cli_contacto  ?? null,
    notas:     row.cli_notas    ?? null,
    activo:    row.cli_activo === 1,
    fechacre:  row.cli_fechacre,
    lat:       row.cli_lat      ?? null,
    lng:       row.cli_lng      ?? null,
  };
}

// GET /api/clientes?buscar=&tipo=&activo=
router.get('/', (req, res) => {
  const { buscar, tipo, activo } = req.query;
  let sql = 'SELECT * FROM cliente';
  const params = [];
  const conds  = [];
  if (buscar) {
    conds.push('(cli_nombre LIKE ? OR cli_ruc_ci LIKE ? OR cli_email LIKE ? OR cli_telefono LIKE ?)');
    const q = `%${buscar}%`;
    params.push(q, q, q, q);
  }
  if (tipo && ['persona','empresa'].includes(tipo)) {
    conds.push('cli_tipo = ?'); params.push(tipo);
  }
  if (activo !== undefined) {
    conds.push('cli_activo = ?'); params.push(activo === '0' ? 0 : 1);
  }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY cli_nombre ASC';
  res.json(db.prepare(sql).all(...params).map(fmt));
});

// GET /api/clientes/:id/ficha — datos completos: productos asignados + historial de máquinas
router.get('/:id/ficha', (req, res) => {
  const row = db.prepare('SELECT * FROM cliente WHERE cli_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Productos asignados a este cliente
  const productos = db.prepare(`
    SELECT cp.cp_id, cp.cp_cantidad, cp.cp_fecha, cp.cp_origen,
           ci.item_id, ci.item_nombre, ci.item_descrip, ci.item_precio, ci.item_vigente,
           ci.item_cat_id, ci.item_tmq_id,
           itc.itc_nombre AS tipo_cat_nombre
    FROM cliente_producto cp
    JOIN catalogo_item ci ON cp.item_id = ci.item_id
    LEFT JOIN item_tipo_cat itc ON ci.item_cat_id = itc.itc_id
    WHERE cp.cli_id = ?
    ORDER BY ci.item_nombre COLLATE NOCASE
  `).all(req.params.id);

  // Productos disponibles para asignar (que este cliente aún no tiene)
  const disponibles = db.prepare(`
    SELECT item_id, item_nombre, item_descrip, item_precio, item_vigente
    FROM catalogo_item
    WHERE item_id NOT IN (SELECT item_id FROM cliente_producto WHERE cli_id = ?)
    ORDER BY item_vigente DESC, item_nombre COLLATE NOCASE
  `).all(req.params.id);

  // Máquinas vinculadas a este cliente
  let recaudaciones = [];
  let mantenimientos = [];

  const maquinas = db.prepare(`
    SELECT m.maq_id, m.tmq_id, m.lgr_id, m.maq_status, m.maq_fechacre,
           t.tmq_desc as tipo_maq,
           l.lgr_nombre as lugar_nombre, l.lgr_lat, l.lgr_lng,
           p.pro_nombre as producto,
           (SELECT COUNT(*) FROM rec_registro r WHERE r.maq_id = m.maq_id) as total_recaudaciones,
           (SELECT rre_mnto_total FROM rec_registro r WHERE r.maq_id = m.maq_id ORDER BY rre_id DESC LIMIT 1) as ultima_recaudacion
    FROM maquina m
    LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
    LEFT JOIN lugar l ON m.lgr_id = l.lgr_id
    LEFT JOIN producto p ON m.pro_id = p.pro_id
    WHERE m.cli_id = ?
    ORDER BY m.maq_fechacre DESC
  `).all(req.params.id);

  if (maquinas.length > 0) {
    const maqIds = maquinas.map(m => m.maq_id);
    const inList = maqIds.map(() => '?').join(',');

    recaudaciones = db.prepare(`
      SELECT r.rre_id, r.maq_id, r.rre_timestamp, r.rre_mnto_total, r.rre_mnto_locatario,
             r.rre_cont_entrada, r.rre_cont_salida, r.rre_cont_dif, r.rre_tipo,
             p.pro_nombre as producto_nombre,
             u.usu_nombre as recaudador_nombre,
             l.lgr_nombre as lugar_nombre
      FROM rec_registro r
      JOIN maquina m ON r.maq_id = m.maq_id
      LEFT JOIN producto p ON m.pro_id = p.pro_id
      LEFT JOIN ruta rt ON r.rut_id = rt.rut_id
      LEFT JOIN vehiculo v ON rt.vei_id = v.vei_id
      LEFT JOIN usuario u ON v.usu_id = u.usu_id
      LEFT JOIN lugar l ON r.lgr_id = l.lgr_id
      WHERE r.maq_id IN (${inList})
      ORDER BY r.rre_timestamp DESC
      LIMIT 100
    `).all(...maqIds);

    mantenimientos = db.prepare(`
      SELECT g.gsq_id, g.maq_id, g.gsq_timestamp, g.gsq_descripcion, g.gsq_monto,
             p.pro_nombre as producto_nombre
      FROM maq_gastos g
      JOIN maquina m ON g.maq_id = m.maq_id
      LEFT JOIN producto p ON m.pro_id = p.pro_id
      WHERE g.maq_id IN (${inList})
      ORDER BY g.gsq_timestamp DESC
      LIMIT 100
    `).all(...maqIds);
  }

  // Ventas de caja realizadas a este cliente
  const ventas = db.prepare(`
    SELECT mov_id, mov_timestamp, mov_monto, mov_concepto, mov_metodo_pago,
           mov_items, mov_es_reembolso, usu_nombre
    FROM caja_movimiento
    WHERE cli_id = ? AND mov_tipo = 'ingreso'
    ORDER BY mov_timestamp DESC
    LIMIT 100
  `).all(req.params.id);

  res.json({ cliente: fmt(row), productos, disponibles, maquinas, recaudaciones, mantenimientos, ventas });
});

// POST /api/clientes/:id/productos — asignar producto a cliente
router.post('/:id/productos', soloAdmin, (req, res) => {
  const { itemId, cantidad = 1 } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });
  const cliente = db.prepare('SELECT cli_id FROM cliente WHERE cli_id = ?').get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const item = db.prepare('SELECT item_id, item_nombre FROM catalogo_item WHERE item_id = ?').get(itemId);
  if (!item) return res.status(404).json({ error: 'Producto no encontrado' });
  try {
    db.prepare(`INSERT INTO cliente_producto (cli_id, item_id, cp_cantidad, cp_origen) VALUES (?,?,?,'manual')
       ON CONFLICT(cli_id, item_id) DO UPDATE SET cp_cantidad = excluded.cp_cantidad, cp_origen = 'manual'`)
      .run(req.params.id, itemId, Math.max(1, Number(cantidad) || 1));
    const cp = db.prepare(`
      SELECT cp.cp_id, cp.cp_cantidad, cp.cp_fecha, ci.item_id, ci.item_nombre, ci.item_descrip, ci.item_precio
      FROM cliente_producto cp JOIN catalogo_item ci ON cp.item_id = ci.item_id
      WHERE cp.cli_id = ? AND cp.item_id = ?
    `).get(req.params.id, itemId);
    res.status(201).json(cp);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Este producto ya está asignado al cliente' });
    throw e;
  }
});

// PATCH /api/clientes/:id/productos/:itemId — actualizar cantidad
router.patch('/:id/productos/:itemId', soloAdmin, (req, res) => {
  const { cantidad } = req.body;
  if (cantidad == null || isNaN(cantidad) || Number(cantidad) < 1)
    return res.status(400).json({ error: 'cantidad debe ser un número mayor a 0' });
  const updated = db.prepare(`UPDATE cliente_producto SET cp_cantidad = ? WHERE cli_id = ? AND item_id = ?`)
    .run(Math.round(Number(cantidad)), req.params.id, req.params.itemId);
  if (updated.changes === 0) return res.status(404).json({ error: 'Asignación no encontrada' });
  res.json({ ok: true, cantidad: Math.round(Number(cantidad)) });
});

// DELETE /api/clientes/:id/productos/:itemId — quitar producto del cliente
router.delete('/:id/productos/:itemId', soloAdmin, (req, res) => {
  const del = db.prepare(`DELETE FROM cliente_producto WHERE cli_id = ? AND item_id = ?`)
    .run(req.params.id, req.params.itemId);
  if (del.changes === 0) return res.status(404).json({ error: 'Asignación no encontrada' });
  res.json({ ok: true });
});

// GET /api/clientes/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM cliente WHERE cli_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(fmt(row));
});

// POST /api/clientes
router.post('/', soloAdmin, (req, res) => {
  const { nombre, tipo = 'persona', rucCi, email, telefono, direccion, contacto, notas, lat, lng } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (!['persona','empresa'].includes(tipo)) return res.status(400).json({ error: 'tipo inválido' });
  const result = db.prepare(`
    INSERT INTO cliente (cli_nombre, cli_tipo, cli_ruc_ci, cli_email, cli_telefono, cli_direccion, cli_contacto, cli_notas, cli_lat, cli_lng)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(nombre.trim(), tipo, rucCi||null, email||null, telefono||null, direccion||null, contacto||null, notas||null, lat??null, lng??null);
  res.status(201).json(fmt(db.prepare('SELECT * FROM cliente WHERE cli_id = ?').get(result.lastInsertRowid)));
});

// PATCH /api/clientes/:id
router.patch('/:id', soloAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM cliente WHERE cli_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { nombre, tipo, rucCi, email, telefono, direccion, contacto, notas, activo, lat, lng } = req.body;
  db.prepare(`
    UPDATE cliente SET
      cli_nombre    = COALESCE(?, cli_nombre),
      cli_tipo      = COALESCE(?, cli_tipo),
      cli_ruc_ci    = ?,
      cli_email     = ?,
      cli_telefono  = ?,
      cli_direccion = ?,
      cli_contacto  = ?,
      cli_notas     = ?,
      cli_activo    = COALESCE(?, cli_activo),
      cli_lat       = ?,
      cli_lng       = ?
    WHERE cli_id = ?
  `).run(
    nombre?.trim() ?? null,
    tipo ?? null,
    rucCi     !== undefined ? (rucCi     || null) : existing.cli_ruc_ci,
    email     !== undefined ? (email     || null) : existing.cli_email,
    telefono  !== undefined ? (telefono  || null) : existing.cli_telefono,
    direccion !== undefined ? (direccion || null) : existing.cli_direccion,
    contacto  !== undefined ? (contacto  || null) : existing.cli_contacto,
    notas     !== undefined ? (notas     || null) : existing.cli_notas,
    activo    !== undefined ? (activo ? 1 : 0) : null,
    lat       !== undefined ? (lat       ?? null) : existing.cli_lat,
    lng       !== undefined ? (lng       ?? null) : existing.cli_lng,
    req.params.id
  );
  res.json(fmt(db.prepare('SELECT * FROM cliente WHERE cli_id = ?').get(req.params.id)));
});

// DELETE /api/clientes/:id
router.delete('/:id', soloAdmin, (req, res) => {
  const row = db.prepare('SELECT cli_id FROM cliente WHERE cli_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Cliente no encontrado' });
  db.prepare('DELETE FROM cliente WHERE cli_id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
