import { Router } from 'express';
import multer from 'multer';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: join(__dirname, '../uploads'),
  filename: (_req, file, cb) => cb(null, `cat_${Date.now()}${extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Solo se permiten imágenes (jpeg, png, webp, gif)'));
  },
});

const router     = Router();
const soloAdmin  = requireRole('admin', 'superadmin');
const adminOCaja = requireRole('admin', 'superadmin', 'caja');

// ─── TIPOS DE ÍTEM ─────────────────────────────────────────────────────────────

// GET /api/catalogo/tipos
router.get('/tipos', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM item_tipo_cat ORDER BY itc_nombre COLLATE NOCASE').all());
});

// POST /api/catalogo/tipos
router.post('/tipos', soloAdmin, (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const result = db.prepare('INSERT INTO item_tipo_cat (itc_nombre) VALUES (?)').run(nombre.trim());
    res.status(201).json(db.prepare('SELECT * FROM item_tipo_cat WHERE itc_id = ?').get(result.lastInsertRowid));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un tipo con ese nombre' });
    throw e;
  }
});

// PATCH /api/catalogo/tipos/:id
router.patch('/tipos/:id', soloAdmin, (req, res) => {
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre es requerido' });
  try {
    const updated = db.prepare('UPDATE item_tipo_cat SET itc_nombre = ? WHERE itc_id = ?').run(nombre.trim(), req.params.id);
    if (updated.changes === 0) return res.status(404).json({ error: 'Tipo no encontrado' });
    res.json(db.prepare('SELECT * FROM item_tipo_cat WHERE itc_id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un tipo con ese nombre' });
    throw e;
  }
});

// DELETE /api/catalogo/tipos/:id
router.delete('/tipos/:id', soloAdmin, (req, res) => {
  const inUse = db.prepare('SELECT 1 FROM catalogo_item WHERE item_cat_id = ?').get(req.params.id);
  if (inUse) return res.status(409).json({ error: 'Este tipo está en uso, reasigna los productos primero' });
  const del = db.prepare('DELETE FROM item_tipo_cat WHERE itc_id = ?').run(req.params.id);
  if (del.changes === 0) return res.status(404).json({ error: 'Tipo no encontrado' });
  res.json({ ok: true });
});

// GET /api/catalogo/tipomaquinas
router.get('/tipomaquinas', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT tmq_id, tmq_desc FROM tipomaquina ORDER BY tmq_desc COLLATE NOCASE').all());
});

// ─── CATÁLOGO ─────────────────────────────────────────────────────────────────

// GET /api/catalogo?catId=&todos=1
router.get('/', requireAuth, (req, res) => {
  const { catId, todos } = req.query;
  let sql = `
    SELECT ci.*, tc.itc_nombre AS tipo_cat_nombre, tm.tmq_desc AS tipo_maq_nombre
    FROM catalogo_item ci
    LEFT JOIN item_tipo_cat tc ON ci.item_cat_id = tc.itc_id
    LEFT JOIN tipomaquina tm ON ci.item_tmq_id = tm.tmq_id
  `;
  const conditions = [];
  const params = [];
  if (!todos) { conditions.push('ci.item_vigente = 1'); }
  if (catId)  { conditions.push('ci.item_cat_id = ?'); params.push(catId); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY tc.itc_nombre COLLATE NOCASE, ci.item_nombre COLLATE NOCASE';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/catalogo
router.post('/', soloAdmin, (req, res) => {
  const { nombre, precio, descrip, stock, item_cat_id, item_tmq_id, item_tipo } = req.body;
  if (!nombre?.trim() || precio == null)
    return res.status(400).json({ error: 'nombre y precio son requeridos' });
  if (nombre.trim().length > 200)
    return res.status(400).json({ error: 'nombre no puede superar 200 caracteres' });
  if (descrip && descrip.trim().length > 1000)
    return res.status(400).json({ error: 'descrip no puede superar 1000 caracteres' });
  if (isNaN(precio) || Number(precio) < 0)
    return res.status(400).json({ error: 'precio debe ser un número no negativo' });
  const tipoFinal = item_tipo === 'servicio' ? 'servicio' : 'producto';
  const result = db.prepare(
    'INSERT INTO catalogo_item (item_nombre, item_tipo, item_precio, item_descrip, item_stock, item_cat_id, item_tmq_id) VALUES (?,?,?,?,?,?,?)'
  ).run(
    nombre.trim(), tipoFinal, Number(precio),
    descrip?.trim() || null,
    stock != null ? Number(stock) : 0,
    item_cat_id || null,
    item_tmq_id || null
  );
  res.status(201).json(db.prepare('SELECT * FROM catalogo_item WHERE item_id = ?').get(result.lastInsertRowid));
});

// PATCH /api/catalogo/:id
router.patch('/:id', soloAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM catalogo_item WHERE item_id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (req.body.nombre !== undefined && req.body.nombre.trim().length > 200)
    return res.status(400).json({ error: 'nombre no puede superar 200 caracteres' });
  if (req.body.descrip !== undefined && req.body.descrip && req.body.descrip.trim().length > 1000)
    return res.status(400).json({ error: 'descrip no puede superar 1000 caracteres' });
  const nombre      = req.body.nombre      !== undefined ? req.body.nombre.trim()          : item.item_nombre;
  const precio      = req.body.precio      !== undefined ? Number(req.body.precio)          : item.item_precio;
  const descrip     = req.body.descrip     !== undefined ? req.body.descrip?.trim() || null : item.item_descrip;
  const vigente     = req.body.vigente     !== undefined ? (req.body.vigente ? 1 : 0)       : item.item_vigente;
  const imagen      = req.body.imagen      !== undefined ? req.body.imagen                  : item.item_imagen;
  const stock       = req.body.stock       !== undefined ? Number(req.body.stock)            : (item.item_stock ?? 0);
  const item_cat_id = req.body.item_cat_id !== undefined ? (req.body.item_cat_id || null)   : item.item_cat_id;
  const item_tmq_id = req.body.item_tmq_id !== undefined ? (req.body.item_tmq_id || null)   : item.item_tmq_id;
  db.prepare(
    'UPDATE catalogo_item SET item_nombre=?, item_precio=?, item_descrip=?, item_vigente=?, item_imagen=?, item_stock=?, item_cat_id=?, item_tmq_id=? WHERE item_id=?'
  ).run(nombre, precio, descrip, vigente, imagen || null, stock, item_cat_id, item_tmq_id, req.params.id);
  res.json(db.prepare('SELECT * FROM catalogo_item WHERE item_id = ?').get(req.params.id));
});

// POST /api/catalogo/:id/imagen
router.post('/:id/imagen', soloAdmin, upload.single('foto'), (req, res) => {
  const item = db.prepare('SELECT 1 FROM catalogo_item WHERE item_id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  const imagePath = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE catalogo_item SET item_imagen = ? WHERE item_id = ?').run(imagePath, req.params.id);
  res.json({ path: imagePath });
});

// DELETE /api/catalogo/:id
router.delete('/:id', soloAdmin, (req, res) => {
  const item = db.prepare('SELECT 1 FROM catalogo_item WHERE item_id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' });
  db.prepare('DELETE FROM catalogo_item WHERE item_id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
