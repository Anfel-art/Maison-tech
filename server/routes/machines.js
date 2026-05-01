import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const SELECT_MACHINE = `
  SELECT m.maq_id, m.maq_status, m.maq_fechacre, m.cli_id,
         m.tmq_id as tmq_id_val,
         t.tmq_desc as type, t.tmq_fields as type_fields,
         l.lgr_id as lgr_id_val, l.lgr_nombre as location, l.lgr_direccion, l.lgr_lat, l.lgr_lng,
         p.pro_nombre as producto,
         c.cli_nombre as cliente_nombre,
         (SELECT rre_mnto_total FROM rec_registro WHERE maq_id = m.maq_id ORDER BY rre_id DESC LIMIT 1) as last_revenue
  FROM maquina m
  LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
  LEFT JOIN lugar l ON m.lgr_id = l.lgr_id
  LEFT JOIN producto p ON m.pro_id = p.pro_id
  LEFT JOIN cliente c ON m.cli_id = c.cli_id
`;

function formatMachine(m) {
  return {
    id: m.maq_id,
    tmqId: m.tmq_id_val ?? null,
    type: m.type ?? '',
    typeFields: JSON.parse(m.type_fields || '[]'),
    lgrId: m.lgr_id_val ?? null,
    location: m.location ?? '',
    direccion: m.lgr_direccion ?? '',
    status: m.maq_status,
    lastRevenue: m.last_revenue ? `$${Number(m.last_revenue).toLocaleString('es-PY')}` : null,
    producto: m.producto ?? null,
    fechaCreacion: m.maq_fechacre,
    coords: m.lgr_lat && m.lgr_lng ? [m.lgr_lat, m.lgr_lng] : null,
    cliId: m.cli_id ?? null,
    clienteNombre: m.cliente_nombre ?? null,
  };
}

function getCampos(tmqId) {
  return db.prepare(`
    SELECT tca_id as id, tca_key as key, tca_label as label, tca_grupo as grupo,
           tca_tipo as tipo, tca_requerido as requerido, tca_readonly as readonly,
           tca_formula as formula, tca_es_precalc as esPrecalc, tca_ancho as ancho, tca_orden as orden,
           tca_usa_ultimo_registro as usaUltimoRegistro, tca_opciones as opciones
    FROM tipo_campo WHERE tmq_id = ? ORDER BY tca_orden, tca_id
  `).all(tmqId).map(c => ({
    ...c,
    requerido:           c.requerido           === 1,
    readonly:            c.readonly            === 1,
    esPrecalc:           c.esPrecalc           === 1,
    usaUltimoRegistro:   c.usaUltimoRegistro   === 1,
    opciones:            c.opciones ? JSON.parse(c.opciones) : [],
  }));
}

// GET /api/machines
router.get('/', (_req, res) => {
  const machines = db.prepare(SELECT_MACHINE + ' ORDER BY m.maq_id').all();
  res.json(machines.map(formatMachine));
});

// GET /api/machines/:id
router.get('/:id', (req, res) => {
  const m = db.prepare(SELECT_MACHINE + ' WHERE m.maq_id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Máquina no encontrada' });
  res.json(formatMachine(m));
});

// POST /api/machines — body: { id, tmqId, lgrId, proId?, status? }
router.post('/', (req, res) => {
  const { id, tmqId, lgrId, proId, status } = req.body;
  if (!id || !tmqId || !lgrId) return res.status(400).json({ error: 'id, tmqId y lgrId son requeridos' });

  db.prepare('INSERT INTO maquina (maq_id, tmq_id, lgr_id, pro_id, maq_status) VALUES (?,?,?,?,?)')
    .run(id, tmqId, lgrId, proId ?? null, status ?? 'ok');

  const m = db.prepare(SELECT_MACHINE + ' WHERE m.maq_id = ?').get(id);
  res.status(201).json(formatMachine(m));
});

// PATCH /api/machines/:id
router.patch('/:id', (req, res) => {
  const { tmqId, lgrId, proId, status, newId, cliId } = req.body;
  const currentId = req.params.id;

  if (!db.prepare('SELECT 1 FROM maquina WHERE maq_id = ?').get(currentId))
    return res.status(404).json({ error: 'Máquina no encontrada' });

  const trimmedNewId = newId ? newId.trim() : null;
  if (trimmedNewId && trimmedNewId !== currentId) {
    if (!trimmedNewId) return res.status(400).json({ error: 'El ID no puede estar vacío' });
    if (db.prepare('SELECT 1 FROM maquina WHERE maq_id = ?').get(trimmedNewId))
      return res.status(400).json({ error: 'Ya existe una máquina con ese ID' });
  }

  const finalId = (trimmedNewId && trimmedNewId !== currentId) ? trimmedNewId : currentId;

  // cliId puede ser null explícitamente para desasignar
  const cliIdValue = cliId !== undefined ? (cliId || null) : undefined;

  db.transaction(() => {
    if (cliIdValue !== undefined) {
      // Actualización con cli_id explícito
      db.prepare(`
        UPDATE maquina SET
          tmq_id     = COALESCE(?, tmq_id),
          lgr_id     = COALESCE(?, lgr_id),
          pro_id     = COALESCE(?, pro_id),
          maq_status = COALESCE(?, maq_status),
          cli_id     = ?
        WHERE maq_id = ?
      `).run(tmqId ?? null, lgrId ?? null, proId ?? null, status ?? null, cliIdValue, currentId);
    } else {
      db.prepare(`
        UPDATE maquina SET
          tmq_id     = COALESCE(?, tmq_id),
          lgr_id     = COALESCE(?, lgr_id),
          pro_id     = COALESCE(?, pro_id),
          maq_status = COALESCE(?, maq_status)
        WHERE maq_id = ?
      `).run(tmqId ?? null, lgrId ?? null, proId ?? null, status ?? null, currentId);
    }

    if (finalId !== currentId) {
      db.prepare('UPDATE rec_registro SET maq_id = ? WHERE maq_id = ?').run(finalId, currentId);
      db.prepare('UPDATE maq_gastos   SET maq_id = ? WHERE maq_id = ?').run(finalId, currentId);
      db.prepare('UPDATE maquina      SET maq_id = ? WHERE maq_id = ?').run(finalId, currentId);
    }
  })();

  const m = db.prepare(SELECT_MACHINE + ' WHERE m.maq_id = ?').get(finalId);
  res.json(formatMachine(m));
});

// DELETE /api/machines/:id — cascade-deletes dependent rows
router.delete('/:id', (req, res) => {
  const id = req.params.id;
  const exists = db.prepare('SELECT 1 FROM maquina WHERE maq_id = ?').get(id);
  if (!exists) return res.status(404).json({ error: 'Máquina no encontrada' });

  db.transaction(() => {
    db.prepare('DELETE FROM rec_img WHERE rre_id IN (SELECT rre_id FROM rec_registro WHERE maq_id = ?)').run(id);
    db.prepare('DELETE FROM rec_registro WHERE maq_id = ?').run(id);
    db.prepare('DELETE FROM maq_gastos WHERE maq_id = ?').run(id);
    db.prepare('DELETE FROM route_run_stops WHERE machine_id = ?').run(id);
    db.prepare('DELETE FROM maquina WHERE maq_id = ?').run(id);
  })();

  res.json({ ok: true });
});

// ─── Lookup tables ────────────────────────────────────────────────────────────

// GET /api/machines/meta/tipos
router.get('/meta/tipos', (_req, res) => {
  const tipos = db.prepare('SELECT tmq_id as id, tmq_desc as desc, tmq_fields as fields FROM tipomaquina ORDER BY tmq_id').all();
  res.json(tipos.map(t => ({ ...t, fields: JSON.parse(t.fields || '[]'), campos: getCampos(t.id) })));
});

// POST /api/machines/meta/tipos — superadmin only
router.post('/meta/tipos', requireRole('superadmin'), (req, res) => {
  const { desc } = req.body;
  if (!desc) return res.status(400).json({ error: 'desc requerido' });
  const result = db.prepare("INSERT INTO tipomaquina (tmq_desc, tmq_fields) VALUES (?,?)").run(desc, '[]');
  res.status(201).json({ id: result.lastInsertRowid, desc, fields: [], campos: [] });
});

// PATCH /api/machines/meta/tipos/:id — superadmin only
router.patch('/meta/tipos/:id', requireRole('superadmin'), (req, res) => {
  const { desc } = req.body;
  if (desc !== undefined) db.prepare('UPDATE tipomaquina SET tmq_desc = ? WHERE tmq_id = ?').run(desc, req.params.id);
  const t = db.prepare('SELECT tmq_id as id, tmq_desc as desc, tmq_fields as fields FROM tipomaquina WHERE tmq_id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrado' });
  res.json({ id: t.id, desc: t.desc, fields: JSON.parse(t.fields || '[]'), campos: getCampos(t.id) });
});

// DELETE /api/machines/meta/tipos/:id — superadmin only
router.delete('/meta/tipos/:id', requireRole('superadmin'), (req, res) => {
  const inUse = db.prepare('SELECT 1 FROM maquina WHERE tmq_id = ?').get(req.params.id);
  if (inUse) return res.status(409).json({ error: 'Tipo en uso por máquinas existentes' });
  db.transaction(() => {
    db.prepare('DELETE FROM tipo_campo WHERE tmq_id = ?').run(req.params.id);
    db.prepare('DELETE FROM tipomaquina WHERE tmq_id = ?').run(req.params.id);
  })();
  res.json({ ok: true });
});

// ─── Campos de tipo ───────────────────────────────────────────────────────────

// POST /api/machines/meta/tipos/:id/campos/reorder — must be before :campoId route
router.patch('/meta/tipos/:id/campos/reorder', requireRole('superadmin'), (req, res) => {
  const { order } = req.body; // [{ id, orden }, ...]
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un array' });
  const stmt = db.prepare('UPDATE tipo_campo SET tca_orden = ? WHERE tca_id = ? AND tmq_id = ?');
  db.transaction(() => { order.forEach(({ id, orden }) => stmt.run(orden, id, req.params.id)); })();
  res.json({ campos: getCampos(req.params.id) });
});

// POST /api/machines/meta/tipos/:id/campos
router.post('/meta/tipos/:id/campos', requireRole('superadmin'), (req, res) => {
  const { key, label, grupo, tipo, requerido, readonly, formula, esPrecalc, ancho, usaUltimoRegistro, opciones } = req.body;
  if (!key || !label) return res.status(400).json({ error: 'key y label son requeridos' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(tca_orden),0) as m FROM tipo_campo WHERE tmq_id = ?').get(req.params.id).m;
  try {
    const r = db.prepare(`
      INSERT INTO tipo_campo (tmq_id,tca_key,tca_label,tca_grupo,tca_tipo,tca_requerido,tca_readonly,tca_formula,tca_es_precalc,tca_ancho,tca_orden,tca_usa_ultimo_registro,tca_opciones)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(req.params.id, key, label, grupo ?? 'General', tipo ?? 'number',
           requerido ? 1 : 0, readonly ? 1 : 0, formula ?? null, esPrecalc ? 1 : 0, ancho ?? 2, maxOrden + 1,
           usaUltimoRegistro ? 1 : 0,
           opciones?.length ? JSON.stringify(opciones) : null);
    res.status(201).json(getCampos(req.params.id).find(c => c.id === r.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: `La clave '${key}' ya existe para este tipo` });
    throw e;
  }
});

// PATCH /api/machines/meta/tipos/:id/campos/:campoId
router.patch('/meta/tipos/:id/campos/:campoId', requireRole('superadmin'), (req, res) => {
  const { label, grupo, tipo, requerido, readonly, formula, esPrecalc, ancho, usaUltimoRegistro, opciones } = req.body;
  const sets = []; const params = [];
  if (label               !== undefined) { sets.push('tca_label = ?');                 params.push(label); }
  if (grupo               !== undefined) { sets.push('tca_grupo = ?');                 params.push(grupo); }
  if (tipo                !== undefined) { sets.push('tca_tipo = ?');                  params.push(tipo); }
  if (requerido           !== undefined) { sets.push('tca_requerido = ?');             params.push(requerido ? 1 : 0); }
  if (readonly            !== undefined) { sets.push('tca_readonly = ?');              params.push(readonly ? 1 : 0); }
  if (formula             !== undefined) { sets.push('tca_formula = ?');               params.push(formula ?? null); }
  if (esPrecalc           !== undefined) { sets.push('tca_es_precalc = ?');            params.push(esPrecalc ? 1 : 0); }
  if (ancho               !== undefined) { sets.push('tca_ancho = ?');                 params.push(ancho); }
  if (usaUltimoRegistro   !== undefined) { sets.push('tca_usa_ultimo_registro = ?');   params.push(usaUltimoRegistro ? 1 : 0); }
  if (opciones            !== undefined) { sets.push('tca_opciones = ?');              params.push(opciones?.length ? JSON.stringify(opciones) : null); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  params.push(req.params.campoId, req.params.id);
  db.prepare(`UPDATE tipo_campo SET ${sets.join(', ')} WHERE tca_id = ? AND tmq_id = ?`).run(...params);
  const c = getCampos(req.params.id).find(c => c.id === parseInt(req.params.campoId));
  if (!c) return res.status(404).json({ error: 'Campo no encontrado' });
  res.json(c);
});

// DELETE /api/machines/meta/tipos/:id/campos/:campoId
router.delete('/meta/tipos/:id/campos/:campoId', requireRole('superadmin'), (req, res) => {
  db.prepare('DELETE FROM tipo_campo WHERE tca_id = ? AND tmq_id = ?').run(req.params.campoId, req.params.id);
  res.json({ ok: true });
});

// GET /api/machines/meta/lugares
router.get('/meta/lugares', (_req, res) => {
  res.json(db.prepare('SELECT lgr_id as id, lgr_nombre as nombre, lgr_direccion as direccion, lgr_lat as lat, lgr_lng as lng FROM lugar ORDER BY lgr_nombre').all());
});

// POST /api/machines/meta/lugares
router.post('/meta/lugares', (req, res) => {
  const { nombre, direccion, lat, lng } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  const result = db.prepare('INSERT INTO lugar (lgr_nombre, lgr_direccion, lgr_lat, lgr_lng) VALUES (?,?,?,?)').run(nombre, direccion ?? null, lat ?? null, lng ?? null);
  res.status(201).json({ id: result.lastInsertRowid, nombre, direccion, lat, lng });
});

// PATCH /api/machines/meta/lugares/:id
router.patch('/meta/lugares/:id', (req, res) => {
  const { nombre, direccion, lat, lng } = req.body;
  const existing = db.prepare('SELECT lgr_id as id, lgr_nombre as nombre, lgr_direccion as direccion, lgr_lat as lat, lgr_lng as lng FROM lugar WHERE lgr_id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lugar no encontrado' });
  db.prepare(`UPDATE lugar SET
    lgr_nombre     = COALESCE(?, lgr_nombre),
    lgr_direccion  = ?,
    lgr_lat        = ?,
    lgr_lng        = ?
    WHERE lgr_id = ?
  `).run(nombre ?? null, direccion ?? existing.direccion, lat ?? null, lng ?? null, req.params.id);
  const updated = db.prepare('SELECT lgr_id as id, lgr_nombre as nombre, lgr_direccion as direccion, lgr_lat as lat, lgr_lng as lng FROM lugar WHERE lgr_id = ?').get(req.params.id);
  res.json(updated);
});

export default router;
