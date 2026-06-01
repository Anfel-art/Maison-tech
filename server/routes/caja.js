import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { cajaWriteLimiter } from '../middleware/writeLimiter.js';
import { audit } from '../middleware/audit.js';

const router = Router();

// ¿El usuario tiene acceso a funciones de caja?
// Admin/superadmin/caja/terreno: todos sí.
function tieneCajaAccess(req) {
  if (!req.user) return false;
  return ['admin', 'superadmin', 'caja', 'terreno'].includes(req.user.rol);
}

// Middleware: permitir acceso si tiene permiso de caja
function soloAdmin(req, res, next) {
  if (tieneCajaAccess(req)) return next();
  return res.status(403).json({ error: 'Acceso denegado' });
}

// ¿El usuario solo puede ver su propia caja?
// caja y terreno siempre ven solo la suya; admin/superadmin ven todo.
const soloSuCaja = (req) => req.user?.rol === 'caja' || req.user?.rol === 'terreno';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── GET /api/caja?from=&to=&own=1 ───────────────────────────────────────────
// cajero          → siempre solo sus movimientos
// admin/superadmin → todos los movimientos; si ?own=1, solo los propios
//   (CajaPage siempre pasa own=1 para mostrar únicamente la caja del usuario activo)
router.get('/', soloAdmin, (req, res) => {
  const { from, to, own, usuId } = req.query;
  const conditions = [], params = [];
  if (from) { conditions.push("mov_timestamp >= ?"); params.push(from); }
  if (to)   { conditions.push("mov_timestamp <= ?"); params.push(to + ' 23:59:59'); }
  if (soloSuCaja(req) || own === '1') {
    // Cajero o modo "propio" (CajaPage): filtrar por usuario actual
    conditions.push("usu_id = ?"); params.push(req.user.id);
  } else if (usuId) {
    // Admin/superadmin filtrando por un cajero específico (Historial admin)
    conditions.push("usu_id = ?"); params.push(Number(usuId));
  }
  let sql = 'SELECT * FROM caja_movimiento';
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY mov_id DESC';
  res.json(db.prepare(sql).all(...params));
});

// ─── GET /api/caja/balance?fecha=YYYY-MM-DD&own=1&usuId=N ────────────────────
router.get('/balance', soloAdmin, (req, res) => {
  const { fecha, own, usuId } = req.query;
  const conditions = [], params = [];
  if (fecha) {
    conditions.push("mov_timestamp >= ?"); params.push(fecha);
    conditions.push("mov_timestamp <= ?"); params.push(fecha + ' 23:59:59');
  }
  if (soloSuCaja(req) || own === '1') {
    conditions.push("usu_id = ?"); params.push(req.user.id);
  } else if (usuId) {
    // Admin/superadmin filtrando por cajero específico
    conditions.push("usu_id = ?"); params.push(Number(usuId));
  }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS total_ingresos,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS total_egresos,
      COALESCE(SUM(CASE WHEN mov_es_reembolso=1 THEN mov_monto ELSE 0 END),0)                        AS total_reembolsos
    FROM caja_movimiento ${where}
  `).get(...params);
  res.json({
    total_ingresos:   row.total_ingresos,
    total_egresos:    row.total_egresos,
    total_reembolsos: row.total_reembolsos,
    balance:          row.total_ingresos - row.total_egresos - row.total_reembolsos,
  });
});

// ─── POST /api/caja ───────────────────────────────────────────────────────────
router.post('/', soloAdmin, cajaWriteLimiter, (req, res) => {
  const { tipo, concepto, monto, metodo_pago = 'efectivo', referencia = null, cli_id = null, maq_id = null, items = null } = req.body;
  if (!tipo || !concepto || monto == null)
    return res.status(400).json({ error: 'tipo, concepto y monto son requeridos' });
  if (!['ingreso', 'egreso'].includes(tipo))
    return res.status(400).json({ error: 'tipo debe ser ingreso o egreso' });
  if (typeof concepto !== 'string' || concepto.trim().length < 1 || concepto.trim().length > 500)
    return res.status(400).json({ error: 'concepto debe tener entre 1 y 500 caracteres' });
  if (referencia !== null && referencia !== undefined && String(referencia).length > 200)
    return res.status(400).json({ error: 'referencia no puede superar 200 caracteres' });
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
  try {
    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO caja_movimiento
          (mov_tipo, mov_concepto, mov_monto, mov_metodo_pago, mov_referencia, usu_id, usu_nombre, cli_id, cli_nombre_snap, maq_id, mov_items)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(tipo, concepto.trim(), Number(monto), metodo_pago, referencia ?? null,
             usu?.id ?? null, dbUsu?.usu_nombre ?? usu?.user ?? null,
             cli_id ?? null, cli_nombre_snap, maq_id ?? null, movItems);
      lastId = result.lastInsertRowid;

      // Descontar stock e incorporar productos al cliente si es venta con items del catálogo
      if (tipo === 'ingreso' && Array.isArray(items) && items.length > 0) {
        const stmtStock = db.prepare(
          'UPDATE catalogo_item SET item_stock = item_stock - ? WHERE item_id = ?'
        );
        const stmtInsertCP = db.prepare(
          `INSERT INTO cliente_producto (cli_id, item_id, cp_cantidad, cp_origen) VALUES (?, ?, ?, 'venta')
           ON CONFLICT(cli_id, item_id) DO UPDATE SET
             cp_cantidad = cp_cantidad + excluded.cp_cantidad`
        );
        // Agregar cantidades por item_id (por si el mismo producto aparece más de una vez)
        const itemsAgrupados = Object.values(
          items.filter(it => it.item_id && it.cantidad > 0)
               .reduce((acc, it) => {
                 const key = String(it.item_id);
                 acc[key] = acc[key]
                   ? { ...acc[key], cantidad: acc[key].cantidad + Number(it.cantidad) }
                   : { item_id: it.item_id, cantidad: Number(it.cantidad) };
                 return acc;
               }, {})
        );
        // Validar stock con cantidades ya agregadas (evita falso positivo por duplicados)
        for (const it of itemsAgrupados) {
          const item = db.prepare('SELECT item_nombre, item_stock FROM catalogo_item WHERE item_id = ?').get(it.item_id);
          if (!item) throw Object.assign(new Error(`Producto ${it.item_id} no encontrado`), { status: 404 });
          if (item.item_stock !== null && item.item_stock < it.cantidad) {
            throw Object.assign(
              new Error(`Stock insuficiente para "${item.item_nombre}" (disponible: ${item.item_stock}, solicitado: ${it.cantidad})`),
              { status: 409 }
            );
          }
        }
        itemsAgrupados.forEach(it => {
          stmtStock.run(it.cantidad, it.item_id);
          if (cli_id) stmtInsertCP.run(cli_id, it.item_id, it.cantidad);
        });
      }
    })();
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }

  audit(req, 'caja.movimiento', 'caja_movimiento', lastId, { tipo, monto: Number(monto), concepto: concepto.trim() });
  res.status(201).json(db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(lastId));
});

// ─── POST /api/caja/:id/reembolso ────────────────────────────────────────────
router.post('/:id/reembolso', soloAdmin, (req, res) => {
  const original = db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (original.mov_es_reembolso) return res.status(400).json({ error: 'Este movimiento ya es un reembolso' });

  // Cajero solo puede reembolsar sus propios movimientos
  if (soloSuCaja(req) && original.usu_id !== req.user.id)
    return res.status(403).json({ error: 'No podés reembolsar movimientos de otra caja' });

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

// ─── GET /api/caja/cierres?fecha=YYYY-MM-DD&usuId=N ──────────────────────────
// Devuelve la sesión del usuario actual (o de otro usuario si admin pasa usuId).
router.get('/cierres', soloAdmin, (req, res) => {
  const { fecha, usuId } = req.query;
  // Admin/superadmin puede ver la sesión de otro usuario; cajero/terreno solo la propia
  const targetId = (soloSuCaja(req) || !usuId) ? req.user.id : Number(usuId);
  if (fecha) {
    const row = db.prepare('SELECT * FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, targetId);
    return res.json(row || null);
  }
  // Sin fecha: historial de sesiones del target
  const rows = db.prepare('SELECT * FROM caja_cierre WHERE apertura_usu_id = ? ORDER BY cierre_fecha DESC').all(targetId);
  res.json(rows);
});

// ─── POST /api/caja/apertura ──────────────────────────────────────────────────
router.post('/apertura', soloAdmin, (req, res) => {
  const { fecha, efectivo = 0, notas = null } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha requerida' });
  if (!DATE_RE.test(fecha) || isNaN(Date.parse(fecha)))
    return res.status(400).json({ error: 'Formato de fecha inválido (use YYYY-MM-DD)' });
  if (isNaN(Number(efectivo)) || Number(efectivo) < 0)
    return res.status(400).json({ error: 'efectivo debe ser un número >= 0' });

  // Verificar que el usuario no tenga ya una sesión abierta para hoy
  const existing = db.prepare('SELECT * FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, req.user.id);
  if (existing) return res.status(409).json({ error: 'Ya tenés una sesión de caja abierta para hoy' });

  const usu = req.user;
  const dbUsu = usu?.id ? db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usu.id) : null;

  const result = db.prepare(`
    INSERT INTO caja_cierre
      (cierre_fecha, cierre_status, apertura_efectivo, apertura_notas, apertura_timestamp,
       apertura_usu_id, apertura_usu_nombre,
       cierre_ingresos, cierre_egresos, cierre_reembolsos, cierre_balance, cierre_mov_count)
    VALUES (?, 'abierta', ?, ?, datetime('now'), ?, ?, 0, 0, 0, 0, 0)
  `).run(fecha, Number(efectivo), notas, usu?.id ?? null, dbUsu?.usu_nombre ?? usu?.user ?? null);

  audit(req, 'caja.apertura', 'caja_cierre', result.lastInsertRowid, { fecha, efectivo: Number(efectivo) });
  res.status(201).json(db.prepare('SELECT * FROM caja_cierre WHERE cierre_id = ?').get(result.lastInsertRowid));
});

// ─── Helper: calcular y persistir cierre de caja para un usuario/fecha ────────
// Usado tanto por POST /cierre (manual) como por routeRuns al completar ruta.
export function calcularYGuardarCierre({ usuId, fecha, notas = null, recuento_efectivo = 0, routeRunId = null, auditReq = null }) {
  const existing = db.prepare('SELECT * FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, usuId);

  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS ingresos,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 THEN mov_monto ELSE 0 END),0) AS egresos,
      COALESCE(SUM(CASE WHEN mov_es_reembolso=1 THEN mov_monto ELSE 0 END),0)                        AS reembolsos,
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 AND mov_metodo_pago='efectivo'      THEN mov_monto ELSE 0 END),0) AS ing_efectivo,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 AND mov_metodo_pago='efectivo'      THEN mov_monto ELSE 0 END),0) AS egr_efectivo,
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 AND mov_metodo_pago='tarjeta'       THEN mov_monto ELSE 0 END),0) AS ing_tarjeta,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 AND mov_metodo_pago='tarjeta'       THEN mov_monto ELSE 0 END),0) AS egr_tarjeta,
      COALESCE(SUM(CASE WHEN mov_tipo='ingreso' AND mov_es_reembolso=0 AND mov_metodo_pago='transferencia' THEN mov_monto ELSE 0 END),0) AS ing_transferencia,
      COALESCE(SUM(CASE WHEN mov_tipo='egreso'  AND mov_es_reembolso=0 AND mov_metodo_pago='transferencia' THEN mov_monto ELSE 0 END),0) AS egr_transferencia,
      COUNT(*) AS mov_count
    FROM caja_movimiento
    WHERE mov_timestamp >= ? AND mov_timestamp <= ? AND usu_id = ?
  `).get(fecha, fecha + ' 23:59:59', usuId);

  const dbUsu = db.prepare('SELECT usu_nombre FROM usuario WHERE usu_id = ?').get(usuId);
  const apertura_efectivo   = existing?.apertura_efectivo ?? 0;
  const esp_efectivo        = apertura_efectivo + stats.ing_efectivo - stats.egr_efectivo;
  const diferencia_efectivo = Number(recuento_efectivo) - esp_efectivo;

  let cierre_id;
  if (existing) {
    db.prepare(`
      UPDATE caja_cierre SET
        cierre_status = 'cerrada', cierre_timestamp = datetime('now'),
        cierre_ingresos = ?, cierre_egresos = ?, cierre_reembolsos = ?,
        cierre_balance = ?, cierre_mov_count = ?,
        cierre_notas = ?, usu_id = ?, usu_nombre = ?,
        recuento_efectivo = ?, esp_efectivo = ?, diferencia_efectivo = ?,
        ing_efectivo = ?, egr_efectivo = ?,
        ing_tarjeta = ?, egr_tarjeta = ?,
        ing_transferencia = ?, egr_transferencia = ?,
        route_run_id = COALESCE(route_run_id, ?)
      WHERE cierre_fecha = ? AND apertura_usu_id = ?
    `).run(
      stats.ingresos, stats.egresos, stats.reembolsos,
      stats.ingresos - stats.egresos - stats.reembolsos, stats.mov_count,
      notas, usuId, dbUsu?.usu_nombre ?? null,
      Number(recuento_efectivo), esp_efectivo, diferencia_efectivo,
      stats.ing_efectivo, stats.egr_efectivo,
      stats.ing_tarjeta, stats.egr_tarjeta,
      stats.ing_transferencia, stats.egr_transferencia,
      routeRunId ?? null,
      fecha, usuId
    );
    cierre_id = existing.cierre_id;
  } else {
    const result = db.prepare(`
      INSERT INTO caja_cierre
        (cierre_fecha, cierre_status, cierre_ingresos, cierre_egresos, cierre_reembolsos,
         cierre_balance, cierre_mov_count, cierre_notas, usu_id, usu_nombre,
         apertura_usu_id, apertura_usu_nombre,
         recuento_efectivo, esp_efectivo, diferencia_efectivo,
         ing_efectivo, egr_efectivo, ing_tarjeta, egr_tarjeta, ing_transferencia, egr_transferencia,
         route_run_id)
      VALUES (?, 'cerrada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      fecha, stats.ingresos, stats.egresos, stats.reembolsos,
      stats.ingresos - stats.egresos - stats.reembolsos, stats.mov_count,
      notas, usuId, dbUsu?.usu_nombre ?? null,
      usuId, dbUsu?.usu_nombre ?? null,
      Number(recuento_efectivo), esp_efectivo, diferencia_efectivo,
      stats.ing_efectivo, stats.egr_efectivo,
      stats.ing_tarjeta, stats.egr_tarjeta,
      stats.ing_transferencia, stats.egr_transferencia,
      routeRunId ?? null
    );
    cierre_id = result.lastInsertRowid;
  }

  if (auditReq) audit(auditReq, 'caja.cierre', 'caja_cierre', cierre_id, { fecha, diferencia_efectivo });
  return db.prepare('SELECT * FROM caja_cierre WHERE cierre_id = ?').get(cierre_id);
}

// ─── POST /api/caja/cierre ────────────────────────────────────────────────────
router.post('/cierre', soloAdmin, (req, res) => {
  const { fecha, notas = null, recuento_efectivo = 0 } = req.body;
  if (!fecha) return res.status(400).json({ error: 'fecha requerida' });
  if (!DATE_RE.test(fecha) || isNaN(Date.parse(fecha)))
    return res.status(400).json({ error: 'Formato de fecha inválido (use YYYY-MM-DD)' });

  const usu = req.user;
  const existing = db.prepare('SELECT cierre_status FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, usu.id);
  if (existing && (existing.cierre_status === 'cerrada' || !existing.cierre_status))
    return res.status(409).json({ error: 'La caja de este día ya fue cerrada' });

  const cierre = calcularYGuardarCierre({ usuId: usu.id, fecha, notas, recuento_efectivo, auditReq: req });
  res.status(201).json(cierre);
});

// ─── DELETE /api/caja/cierre/:fecha ──────────────────────────────────────────
// Reabre o cancela la sesión del usuario actual para esa fecha
router.delete('/cierre/:fecha', soloAdmin, (req, res) => {
  const { fecha } = req.params;
  if (!DATE_RE.test(fecha) || isNaN(Date.parse(fecha)))
    return res.status(400).json({ error: 'Formato de fecha inválido (use YYYY-MM-DD)' });

  const cierre = db.prepare('SELECT * FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').get(fecha, req.user.id);
  if (!cierre) return res.status(404).json({ error: 'No existe sesión de caja para esa fecha' });

  if (cierre.cierre_status === 'cerrada' || !cierre.cierre_status) {
    // Reabrir: volver a 'abierta', conservando la apertura
    db.prepare(`
      UPDATE caja_cierre SET
        cierre_status = 'abierta',
        cierre_timestamp = NULL,
        cierre_ingresos = 0, cierre_egresos = 0, cierre_reembolsos = 0,
        cierre_balance = 0, cierre_mov_count = 0,
        cierre_notas = NULL, usu_id = NULL, usu_nombre = NULL,
        recuento_efectivo = 0, esp_efectivo = 0, diferencia_efectivo = 0
      WHERE cierre_fecha = ? AND apertura_usu_id = ?
    `).run(fecha, req.user.id);
    audit(req, 'caja.cierre_delete', 'caja_cierre', cierre.cierre_id, { fecha, accion: 'reabierta' });
    res.json({ ok: true, status: 'abierta', sesion: db.prepare('SELECT * FROM caja_cierre WHERE cierre_id = ?').get(cierre.cierre_id) });
  } else {
    // 'abierta': cancelar la sesión completamente
    db.prepare('DELETE FROM caja_cierre WHERE cierre_fecha = ? AND apertura_usu_id = ?').run(fecha, req.user.id);
    audit(req, 'caja.apertura_delete', 'caja_cierre', cierre.cierre_id, { fecha, accion: 'cancelada' });
    res.json({ ok: true, status: 'deleted' });
  }
});

// ─── GET /api/caja/sesiones ───────────────────────────────────────────────────
// cajero          → siempre solo sus sesiones
// admin/superadmin → todas; si ?own=1, solo las propias; si ?usuId=, de ese cajero
router.get('/sesiones', soloAdmin, (req, res) => {
  const { from, to, status, usuId, own } = req.query;
  const conds = [], params = [];
  if (from)   { conds.push('cierre_fecha >= ?'); params.push(from); }
  if (to)     { conds.push('cierre_fecha <= ?'); params.push(to); }
  if (status) { conds.push('cierre_status = ?'); params.push(status); }
  if (soloSuCaja(req) || own === '1') {
    conds.push('apertura_usu_id = ?');
    params.push(req.user.id);
  } else if (usuId) {
    conds.push('apertura_usu_id = ?');
    params.push(Number(usuId));
  }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT * FROM caja_cierre${where} ORDER BY cierre_fecha DESC, cierre_id DESC LIMIT 365`
  ).all(...params);
  res.json(rows);
});

// ─── GET /api/caja/sesiones/:id/movimientos ───────────────────────────────────
// Movimientos de una sesión específica por cierre_id
router.get('/sesiones/:id/movimientos', soloAdmin, (req, res) => {
  const { id } = req.params;
  const sesion = db.prepare('SELECT * FROM caja_cierre WHERE cierre_id = ?').get(id);
  if (!sesion) return res.status(404).json({ error: 'Sesión no encontrada' });
  // Cajero solo puede ver su propia sesión
  if (soloSuCaja(req) && sesion.apertura_usu_id !== req.user.id)
    return res.status(403).json({ error: 'Sin acceso a esta sesión' });

  const rows = db.prepare(`
    SELECT m.*, u.usu_nombre as cajero_real
    FROM caja_movimiento m
    LEFT JOIN usuario u ON m.usu_id = u.usu_id
    WHERE m.mov_timestamp >= ? AND m.mov_timestamp <= ?
      AND m.usu_id = ?
    ORDER BY m.mov_id DESC
  `).all(sesion.cierre_fecha, sesion.cierre_fecha + ' 23:59:59', sesion.apertura_usu_id);
  res.json(rows);
});

// ─── GET /api/caja/pedidos ────────────────────────────────────────────────────
// cajero          → siempre solo sus pedidos
// admin/superadmin → todos; si ?own=1, solo los propios; si ?usuId=, de ese cajero
router.get('/pedidos', soloAdmin, (req, res) => {
  const { from, to, usuId, tipo, soloVentas, own } = req.query;
  const conds = [], params = [];
  if (from)       { conds.push("m.mov_timestamp >= ?"); params.push(from); }
  if (to)         { conds.push("m.mov_timestamp <= ?"); params.push(to + ' 23:59:59'); }
  if (soloSuCaja(req) || own === '1') {
    conds.push("m.usu_id = ?"); params.push(req.user.id);
  } else if (usuId) {
    conds.push("m.usu_id = ?"); params.push(Number(usuId));
  }
  if (tipo)       { conds.push("m.mov_tipo = ?"); params.push(tipo); }
  if (soloVentas === '1') { conds.push("m.mov_es_reembolso = 0"); }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(`
    SELECT m.*,
      date(m.mov_timestamp) as mov_fecha,
      c.cli_nombre
    FROM caja_movimiento m
    LEFT JOIN cliente c ON m.cli_id = c.cli_id
    ${where}
    ORDER BY m.mov_id DESC
    LIMIT 1000
  `).all(...params);
  res.json(rows);
});

// ─── GET /api/caja/export — CSV de sesiones de caja ──────────────────────────
// Admin/superadmin: todas las sesiones (o filtradas); caja/terreno: solo las propias.
router.get('/export', soloAdmin, (req, res) => {
  const { from, to, usuId, own } = req.query;
  const conds = [], params = [];
  if (from)   { conds.push('cierre_fecha >= ?'); params.push(from); }
  if (to)     { conds.push('cierre_fecha <= ?'); params.push(to); }
  if (soloSuCaja(req) || own === '1') {
    conds.push('apertura_usu_id = ?'); params.push(req.user.id);
  } else if (usuId) {
    conds.push('apertura_usu_id = ?'); params.push(Number(usuId));
  }
  // Sin filtro de fecha, limitar a los últimos 365 días
  if (!from && !to) {
    conds.push("cierre_fecha >= date('now', '-365 days')");
  }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : '';
  const rows = db.prepare(
    `SELECT * FROM caja_cierre${where} ORDER BY cierre_fecha DESC, cierre_id DESC LIMIT 1000`
  ).all(...params);

  const fmt = (v) => (v == null ? '' : String(v));
  const num = (v) => (v == null ? '0' : String(Number(v)));
  const esc = (v) => `"${fmt(v).replace(/"/g, '""')}"`;

  const header = [
    'Fecha', 'Cajero', 'Estado',
    'Apertura (Gs.)', 'Ingresos (Gs.)', 'Egresos (Gs.)', 'Reembolsos (Gs.)', 'Balance (Gs.)',
    'Efectivo esperado (Gs.)', 'Efectivo contado (Gs.)', 'Diferencia (Gs.)',
    'Ing. Efectivo', 'Eg. Efectivo', 'Ing. Tarjeta', 'Eg. Tarjeta', 'Ing. Transfer.', 'Eg. Transfer.',
    'Movimientos', 'Notas', 'Apertura timestamp', 'Cierre timestamp',
  ];

  const csvRows = [header.map(esc).join(',')];
  for (const r of rows) {
    csvRows.push([
      r.cierre_fecha,
      r.apertura_usu_nombre ?? '',
      r.cierre_status ?? '',
      num(r.apertura_efectivo),
      num(r.cierre_ingresos),
      num(r.cierre_egresos),
      num(r.cierre_reembolsos),
      num(r.cierre_balance),
      num(r.esp_efectivo),
      num(r.recuento_efectivo),
      num(r.diferencia_efectivo),
      num(r.ing_efectivo),
      num(r.egr_efectivo),
      num(r.ing_tarjeta),
      num(r.egr_tarjeta),
      num(r.ing_transferencia),
      num(r.egr_transferencia),
      num(r.cierre_mov_count),
      r.cierre_notas ?? '',
      r.apertura_timestamp ?? '',
      r.cierre_timestamp ?? '',
    ].map(esc).join(','));
  }

  const fecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Asuncion' });
  const csv = '﻿' + csvRows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="sesiones_caja_${fecha}.csv"`);
  res.send(csv);
});

// ─── DELETE /api/caja/:id ─────────────────────────────────────────────────────
router.delete('/:id', soloAdmin, (req, res) => {
  const mov = db.prepare('SELECT * FROM caja_movimiento WHERE mov_id = ?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (mov.mov_es_reembolso) return res.status(400).json({ error: 'No se puede eliminar un reembolso directamente' });
  // Cajero solo puede eliminar sus propios movimientos
  if (soloSuCaja(req) && mov.usu_id !== req.user.id)
    return res.status(403).json({ error: 'No podés eliminar movimientos de otra caja' });

  db.transaction(() => {
    // Restaurar stock si era una venta (ingreso) con ítems del catálogo
    if (mov.mov_tipo === 'ingreso' && mov.mov_items) {
      let items = [];
      try { items = JSON.parse(mov.mov_items); } catch { /* malformed — skip */ }
      if (Array.isArray(items) && items.length > 0) {
        const stmtStock = db.prepare(
          'UPDATE catalogo_item SET item_stock = item_stock + ? WHERE item_id = ?'
        );
        const stmtCP = db.prepare(
          `UPDATE cliente_producto
             SET cp_cantidad = MAX(0, cp_cantidad - ?)
           WHERE cli_id = ? AND item_id = ?`
        );
        for (const it of items) {
          if (!it.item_id || !(it.cantidad > 0)) continue;
          stmtStock.run(Number(it.cantidad), it.item_id);
          if (mov.cli_id) stmtCP.run(Number(it.cantidad), mov.cli_id, it.item_id);
        }
      }
    }
    // Eliminar reembolso asociado si existe, luego el movimiento
    db.prepare('DELETE FROM caja_movimiento WHERE mov_ref_id = ?').run(req.params.id);
    db.prepare('DELETE FROM caja_movimiento WHERE mov_id = ?').run(req.params.id);
  })();

  audit(req, 'caja.movimiento_delete', 'caja_movimiento', req.params.id,
    { tipo: mov.mov_tipo, monto: mov.mov_monto, concepto: mov.mov_concepto });
  res.json({ ok: true });
});

export default router;
