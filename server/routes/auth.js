import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../db.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.js';

const router = Router();

// POST /api/auth/login — body: { user, pass }
router.post('/login', async (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const usuario = db.prepare('SELECT * FROM usuario WHERE usu_user = ?').get(user);
  if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });

  const valid = await bcrypt.compare(pass, usuario.usu_pass);
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign(
    { id: usuario.usu_id, user: usuario.usu_user, rol: usuario.usu_rol },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({
    token,
    id: usuario.usu_id,
    nombre: usuario.usu_nombre,
    user: usuario.usu_user,
    rol: usuario.usu_rol,
  });
});

export default router;
