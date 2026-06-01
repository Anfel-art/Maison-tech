import { Router } from 'express';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// POST /api/solicitudes — cualquier usuario autenticado puede crear una solicitud
router.post('/', (req, res) => {
  const { itemId, itemNombre, mensaje } = req.body;
  if (!itemNombre?.trim())
    return res.status(400).json({ error: 'Nombre del producto requerido' });

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = db.prepare(`
    INSERT INTO solicitud_reposicion (item_id, item_nombre, usu_id, usu_nombre, mensaje, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    itemId || null,
    itemNombre.trim(),
    req.user.id,
    req.user.user,
    mensaje?.trim() || null,
    now
  );

  res.status(201).json({ id: result.lastInsertRowid, ok: true });
});

// GET /api/solicitudes — solo admin/superadmin
router.get('/', requireRole('admin', 'superadmin'), (req, res) => {
  const soloNoleidas = req.query.noLeidas === '1';
  const rows = db.prepare(`
    SELECT s.*, u.usu_nombre as usu_nombre_real
    FROM solicitud_reposicion s
    LEFT JOIN usuario u ON s.usu_id = u.usu_id
    ${soloNoleidas ? 'WHERE s.leida = 0' : ''}
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all();
  res.json(rows);
});

// GET /api/solicitudes/pendientes — cuenta no leídas (para badge)
router.get('/pendientes', requireRole('admin', 'superadmin'), (req, res) => {
  const { total } = db.prepare('SELECT COUNT(*) as total FROM solicitud_reposicion WHERE leida = 0').get();
  res.json({ total });
});

// PATCH /api/solicitudes/:id/leida — marcar como leída
router.patch('/:id/leida', requireRole('admin', 'superadmin'), (req, res) => {
  db.prepare('UPDATE solicitud_reposicion SET leida = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// PATCH /api/solicitudes/leer-todas — marcar todas como leídas
router.patch('/leer-todas', requireRole('admin', 'superadmin'), (req, res) => {
  db.prepare('UPDATE solicitud_reposicion SET leida = 1 WHERE leida = 0').run();
  res.json({ ok: true });
});

// DELETE /api/solicitudes/:id — descartar una solicitud
router.delete('/:id', requireRole('admin', 'superadmin'), (req, res) => {
  db.prepare('DELETE FROM solicitud_reposicion WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
