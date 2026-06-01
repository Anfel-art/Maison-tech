import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';

const router = Router();

const soloAdmin = requireRole('admin', 'superadmin');

const ROLES_VALIDOS = ['superadmin', 'admin', 'caja', 'terreno'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_RE  = /^[a-zA-Z0-9_.\-]{3,50}$/;

function rolesPermitidos(rolActual) {
  if (rolActual === 'superadmin') return ['superadmin', 'admin', 'caja', 'terreno'];
  if (rolActual === 'admin')      return ['admin', 'caja', 'terreno'];
  return [];
}

function formatUser(u) {
  return {
    id:         u.id          ?? u.usu_id,
    nombre:     u.nombre      ?? u.usu_nombre,
    user:       u.user        ?? u.usu_user,
    rol:        u.rol         ?? u.usu_rol,
    email:      u.email       ?? u.usu_email ?? null,
    tiene_caja: u.tiene_caja  !== undefined ? (u.tiene_caja === 1 || u.tiene_caja === true)
                             : (u.usu_tiene_caja === 1),
    fechacre:   u.fechacre    ?? u.usu_fechacre,
    fechamod:   u.fechamod    ?? u.usu_fechamod,
  };
}

const SELECT_USU = `
  SELECT usu_id as id, usu_nombre as nombre, usu_user as user, usu_rol as rol,
         usu_email as email, usu_tiene_caja as tiene_caja,
         usu_fechacre as fechacre, usu_fechamod as fechamod
  FROM usuario
`;

// GET /api/usuarios
router.get('/', soloAdmin, (req, res) => {
  const usuarios = db.prepare(SELECT_USU + ' ORDER BY usu_id').all();
  res.json(usuarios.map(u => formatUser(u)));
});

// GET /api/usuarios/actividad — últimos creados/editados
router.get('/actividad', soloAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT usu_id as id, usu_nombre as nombre, usu_user as user, usu_rol as rol,
           usu_fechacre as fechacre, usu_fechamod as fechamod,
           COALESCE(usu_fechamod, usu_fechacre) as ultima_actividad,
           CASE WHEN usu_fechamod IS NOT NULL THEN 'editado' ELSE 'creado' END as accion
    FROM usuario
    ORDER BY COALESCE(usu_fechamod, usu_fechacre) DESC
    LIMIT 8
  `).all();
  res.json(rows);
});

// POST /api/usuarios
router.post('/', soloAdmin, async (req, res) => {
  const { nombre, user, pass, rol, email } = req.body;
  if (!nombre?.trim() || !user?.trim() || !pass?.trim() || !rol)
    return res.status(400).json({ error: 'nombre, user, pass y rol son requeridos' });

  if (nombre.trim().length < 2 || nombre.trim().length > 100)
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
  if (!USER_RE.test(user.trim()))
    return res.status(400).json({ error: 'El usuario debe tener 3-50 caracteres (letras, números, _, -, .)' });
  if (pass.trim().length < 8 || pass.trim().length > 100)
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 100 caracteres' });
  if (!ROLES_VALIDOS.includes(rol))
    return res.status(400).json({ error: 'Rol inválido' });
  if (email && !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ error: 'Formato de email inválido' });

  const permitidos = rolesPermitidos(req.user.rol);
  if (!permitidos.includes(rol))
    return res.status(403).json({ error: `No puedes asignar el rol "${rol}"` });

  if (db.prepare('SELECT 1 FROM usuario WHERE LOWER(usu_user) = LOWER(?)').get(user.trim()))
    return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });

  const emailClean = email?.trim().toLowerCase() || null;
  const hash = await bcrypt.hash(pass, 10);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  // El rol terreno siempre incluye el módulo de caja (usu_tiene_caja = 1)
  const tieneCajaVal = rol === 'terreno' ? 1 : 0;
  const result = db.prepare(
    'INSERT INTO usuario (usu_nombre, usu_user, usu_pass, usu_rol, usu_email, usu_tiene_caja, usu_fechacre) VALUES (?,?,?,?,?,?,?)'
  ).run(nombre.trim(), user.trim(), hash, rol, emailClean, tieneCajaVal, now);

  audit(req, 'usuario.create', 'usuario', result.lastInsertRowid, { user: user.trim(), rol });
  res.status(201).json(formatUser({
    id: result.lastInsertRowid,
    nombre: nombre.trim(),
    user: user.trim(),
    rol,
    email: emailClean,
    tiene_caja: tieneCajaVal === 1,
    fechacre: now,
    fechamod: null,
  }));
});

// PATCH /api/usuarios/:id
router.patch('/:id', soloAdmin, async (req, res) => {
  const target = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Solo un superadmin puede modificar a otro superadmin
  if (target.usu_rol === 'superadmin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo un superadmin puede modificar a otro superadmin' });

  if (target.usu_rol === 'admin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede modificar a otros administradores' });

  const { nombre, user, pass, rol, email, tiene_caja } = req.body;

  if (nombre !== undefined && (nombre.trim().length < 2 || nombre.trim().length > 100))
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
  if (user !== undefined && !USER_RE.test(user.trim()))
    return res.status(400).json({ error: 'El usuario debe tener 3-50 caracteres (letras, números, _, -, .)' });
  if (pass !== undefined && (pass.trim().length < 8 || pass.trim().length > 100))
    return res.status(400).json({ error: 'La contraseña debe tener entre 8 y 100 caracteres' });
  if (email !== undefined && email && !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ error: 'Formato de email inválido' });

  if (rol) {
    const permitidos = rolesPermitidos(req.user.rol);
    if (!permitidos.includes(rol))
      return res.status(403).json({ error: `No puedes asignar el rol "${rol}"` });
  }

  if (user && user.trim().toLowerCase() !== target.usu_user.toLowerCase()) {
    if (db.prepare('SELECT 1 FROM usuario WHERE LOWER(usu_user) = LOWER(?) AND usu_id != ?').get(user.trim(), req.params.id))
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
  }

  const nuevoNombre   = nombre?.trim()  ?? target.usu_nombre;
  const nuevoUser     = user?.trim()    ?? target.usu_user;
  const nuevoRol      = rol             ?? target.usu_rol;
  const nuevoPass     = pass ? await bcrypt.hash(pass, 10) : target.usu_pass;
  const nuevoEmail    = email !== undefined ? (email?.trim().toLowerCase() || null) : target.usu_email;
  // tiene_caja solo aplica a rol terreno (o al nuevo rol si se está cambiando)
  const rolFinal      = nuevoRol;
  const nuevoTieneCaja = tiene_caja !== undefined
    ? (rolFinal === 'terreno' ? (tiene_caja ? 1 : 0) : 0)
    : target.usu_tiene_caja ?? 0;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    'UPDATE usuario SET usu_nombre=?, usu_user=?, usu_pass=?, usu_rol=?, usu_email=?, usu_tiene_caja=?, usu_fechamod=? WHERE usu_id=?'
  ).run(nuevoNombre, nuevoUser, nuevoPass, nuevoRol, nuevoEmail, nuevoTieneCaja, now, req.params.id);

  audit(req, 'usuario.update', 'usuario', req.params.id,
    { user: nuevoUser, rol: nuevoRol, passChanged: !!pass, tiene_caja: nuevoTieneCaja });
  res.json(formatUser({
    id: Number(req.params.id),
    nombre: nuevoNombre,
    user: nuevoUser,
    rol: nuevoRol,
    email: nuevoEmail,
    tiene_caja: nuevoTieneCaja === 1,
    fechacre: target.usu_fechacre,
    fechamod: now,
  }));
});

// GET /api/usuarios/:id/vehiculo
router.get('/:id/vehiculo', soloAdmin, (req, res) => {
  const v = db.prepare('SELECT * FROM vehiculo WHERE usu_id = ?').get(req.params.id);
  if (!v) return res.json(null);
  res.json({ id: v.vei_id, modelo: v.vei_modelo, marca: v.vei_marca, color: v.vei_color, chapa: v.vei_chapa });
});

// PUT /api/usuarios/:id/vehiculo — crea o actualiza el vehículo del usuario
router.put('/:id/vehiculo', soloAdmin, (req, res) => {
  const { modelo, marca, color, chapa } = req.body;
  if (!modelo?.trim()) return res.status(400).json({ error: 'El modelo es requerido' });

  const usu = db.prepare('SELECT usu_id, usu_rol FROM usuario WHERE usu_id = ?').get(req.params.id);
  if (!usu) return res.status(404).json({ error: 'Usuario no encontrado' });

  const existing = db.prepare('SELECT vei_id FROM vehiculo WHERE usu_id = ?').get(req.params.id);
  if (existing) {
    db.prepare('UPDATE vehiculo SET vei_modelo=?, vei_marca=?, vei_color=?, vei_chapa=? WHERE usu_id=?')
      .run(modelo.trim(), marca?.trim() || null, color?.trim() || null, chapa?.trim() || null, req.params.id);
  } else {
    db.prepare('INSERT INTO vehiculo (vei_modelo, vei_marca, vei_color, vei_chapa, usu_id) VALUES (?,?,?,?,?)')
      .run(modelo.trim(), marca?.trim() || null, color?.trim() || null, chapa?.trim() || null, req.params.id);
  }

  const v = db.prepare('SELECT * FROM vehiculo WHERE usu_id = ?').get(req.params.id);
  res.json({ id: v.vei_id, modelo: v.vei_modelo, marca: v.vei_marca, color: v.vei_color, chapa: v.vei_chapa });
});

// DELETE /api/usuarios/:id/vehiculo
router.delete('/:id/vehiculo', soloAdmin, (req, res) => {
  db.prepare('DELETE FROM vehiculo WHERE usu_id = ?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/usuarios/:id
router.delete('/:id', soloAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  // Solo un superadmin puede eliminar a otro superadmin
  if (target.usu_rol === 'superadmin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo un superadmin puede eliminar a otro superadmin' });

  if (target.usu_rol === 'admin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede eliminar administradores' });

  if (target.usu_id === req.user.id)
    return res.status(403).json({ error: 'No puedes eliminar tu propio usuario' });

  db.prepare('DELETE FROM usuario WHERE usu_id = ?').run(req.params.id);
  audit(req, 'usuario.delete', 'usuario', req.params.id, { user: target.usu_user, rol: target.usu_rol });
  res.json({ ok: true });
});

export default router;
