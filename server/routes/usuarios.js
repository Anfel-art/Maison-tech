import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

const soloAdmin = requireRole('admin', 'superadmin');

// Nivel numérico por rol: mayor = más privilegio
const ROL_LEVEL = { superadmin: 4, admin: 3, caja: 2, terreno: 1 };

function rolesPermitidos(rolActual) {
  if (rolActual === 'superadmin') return ['superadmin', 'admin', 'caja', 'terreno'];
  if (rolActual === 'admin')      return ['admin', 'caja', 'terreno'];
  return [];
}

/** Puede el solicitante ver la contraseña del usuario destino?
 *  - superadmin ve: admin, caja, terreno
 *  - admin      ve: caja, terreno
 *  - Nadie ve: superadmin */
function puedeVerPassword(rolSolicitante, rolDestino) {
  if (rolDestino === 'superadmin') return false;
  return (ROL_LEVEL[rolSolicitante] ?? 0) > (ROL_LEVEL[rolDestino] ?? 0);
}

function formatUser(u, rolSolicitante) {
  return {
    id:        u.id        ?? u.usu_id,
    nombre:    u.nombre    ?? u.usu_nombre,
    user:      u.user      ?? u.usu_user,
    rol:       u.rol       ?? u.usu_rol,
    fechacre:  u.fechacre  ?? u.usu_fechacre,
    fechamod:  u.fechamod  ?? u.usu_fechamod,
    password:  puedeVerPassword(rolSolicitante, u.rol ?? u.usu_rol)
               ? (u.usu_pass_plain ?? null)
               : null,
  };
}

const SELECT_USU = `
  SELECT usu_id as id, usu_nombre as nombre, usu_user as user, usu_rol as rol,
         usu_fechacre as fechacre, usu_fechamod as fechamod, usu_pass_plain
  FROM usuario
`;

// GET /api/usuarios
router.get('/', soloAdmin, (req, res) => {
  const usuarios = db.prepare(SELECT_USU + ' ORDER BY usu_id').all();
  res.json(usuarios.map(u => formatUser(u, req.user.rol)));
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
router.post('/', soloAdmin, (req, res) => {
  const { nombre, user, pass, rol } = req.body;
  if (!nombre?.trim() || !user?.trim() || !pass?.trim() || !rol)
    return res.status(400).json({ error: 'nombre, user, pass y rol son requeridos' });

  const permitidos = rolesPermitidos(req.user.rol);
  if (!permitidos.includes(rol))
    return res.status(403).json({ error: `No puedes asignar el rol "${rol}"` });

  if (db.prepare('SELECT 1 FROM usuario WHERE usu_user = ?').get(user.trim()))
    return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });

  const hash = bcrypt.hashSync(pass, 10);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const result = db.prepare(
    'INSERT INTO usuario (usu_nombre, usu_user, usu_pass, usu_rol, usu_fechacre, usu_pass_plain) VALUES (?,?,?,?,?,?)'
  ).run(nombre.trim(), user.trim(), hash, rol, now, pass.trim());

  res.status(201).json(formatUser({
    id: result.lastInsertRowid,
    nombre: nombre.trim(),
    user: user.trim(),
    rol,
    fechacre: now,
    fechamod: null,
    usu_pass_plain: pass.trim(),
  }, req.user.rol));
});

// PATCH /api/usuarios/:id
router.patch('/:id', soloAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (target.usu_rol === 'superadmin')
    return res.status(403).json({ error: 'No se puede modificar al superadmin' });

  if (target.usu_rol === 'admin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede modificar a otros administradores' });

  const { nombre, user, pass, rol } = req.body;

  if (rol) {
    const permitidos = rolesPermitidos(req.user.rol);
    if (!permitidos.includes(rol))
      return res.status(403).json({ error: `No puedes asignar el rol "${rol}"` });
  }

  if (user && user.trim() !== target.usu_user) {
    if (db.prepare('SELECT 1 FROM usuario WHERE usu_user = ? AND usu_id != ?').get(user.trim(), req.params.id))
      return res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' });
  }

  const nuevoNombre   = nombre?.trim()  ?? target.usu_nombre;
  const nuevoUser     = user?.trim()    ?? target.usu_user;
  const nuevoRol      = rol             ?? target.usu_rol;
  const nuevoPass     = pass ? bcrypt.hashSync(pass, 10) : target.usu_pass;
  const nuevoPlain    = pass?.trim()    ? pass.trim() : target.usu_pass_plain;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare(
    'UPDATE usuario SET usu_nombre=?, usu_user=?, usu_pass=?, usu_rol=?, usu_fechamod=?, usu_pass_plain=? WHERE usu_id=?'
  ).run(nuevoNombre, nuevoUser, nuevoPass, nuevoRol, now, nuevoPlain, req.params.id);

  res.json(formatUser({
    id: Number(req.params.id),
    nombre: nuevoNombre,
    user: nuevoUser,
    rol: nuevoRol,
    fechacre: target.usu_fechacre,
    fechamod: now,
    usu_pass_plain: nuevoPlain,
  }, req.user.rol));
});

// DELETE /api/usuarios/:id
router.delete('/:id', soloAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (target.usu_rol === 'superadmin')
    return res.status(403).json({ error: 'No se puede eliminar al superadmin' });

  if (target.usu_rol === 'admin' && req.user.rol !== 'superadmin')
    return res.status(403).json({ error: 'Solo el superadmin puede eliminar administradores' });

  if (target.usu_id === req.user.id)
    return res.status(403).json({ error: 'No puedes eliminar tu propio usuario' });

  db.prepare('DELETE FROM usuario WHERE usu_id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
