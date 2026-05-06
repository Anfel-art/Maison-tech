import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.js';
import { sendPasswordReset } from '../mailer.js';

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

// POST /api/auth/forgot-password — body: { email }
// Genera token y envía email de reset. Siempre responde OK (no revela si el email existe).
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });

  const usuario = db.prepare('SELECT * FROM usuario WHERE usu_email = ?').get(email.trim().toLowerCase());

  if (usuario) {
    // Invalidar tokens anteriores del usuario
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE usu_id = ?').run(usuario.usu_id);

    // Generar token seguro (32 bytes → 64 hex chars)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hora

    db.prepare(
      'INSERT INTO password_reset_tokens (usu_id, token, expires_at) VALUES (?, ?, ?)'
    ).run(usuario.usu_id, token, expiresAt);

    try {
      await sendPasswordReset(usuario.usu_email, usuario.usu_nombre, token);
    } catch (err) {
      console.error('[mailer] Error enviando email de reset:', err.message);
      // No fallar — el admin puede ver el token en logs si hay error de email
    }
  }

  // Siempre responder OK para no revelar si el email existe en el sistema
  res.json({ ok: true, message: 'Si el email existe, recibirás un enlace en los próximos minutos.' });
});

// POST /api/auth/reset-password — body: { token, newPassword }
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword?.trim())
    return res.status(400).json({ error: 'Token y nueva contraseña son requeridos' });
  if (newPassword.trim().length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  const row = db.prepare(
    "SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0"
  ).get(token);

  if (!row) return res.status(400).json({ error: 'Token inválido o ya utilizado' });
  if (new Date(row.expires_at) < new Date())
    return res.status(400).json({ error: 'El enlace expiró. Solicitá uno nuevo.' });

  const hash = await bcrypt.hash(newPassword.trim(), 10);
  const now  = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.transaction(() => {
    db.prepare(
      'UPDATE usuario SET usu_pass = ?, usu_pass_plain = ?, usu_fechamod = ? WHERE usu_id = ?'
    ).run(hash, newPassword.trim(), now, row.usu_id);
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);
  })();

  res.json({ ok: true, message: 'Contraseña actualizada correctamente. Ya podés iniciar sesión.' });
});

// GET /api/auth/verify-reset-token/:token — verifica si un token es válido (para mostrar el form)
router.get('/verify-reset-token/:token', (req, res) => {
  const row = db.prepare(
    "SELECT usu_id FROM password_reset_tokens WHERE token = ? AND used = 0"
  ).get(req.params.token);
  if (!row) return res.status(400).json({ valid: false, error: 'Token inválido o ya utilizado' });
  if (new Date(row.expires_at) < new Date())
    return res.status(400).json({ valid: false, error: 'El enlace expiró' });
  res.json({ valid: true });
});

export default router;
