import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { rateLimit } from 'express-rate-limit';
import db from '../db.js';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.js';
import { sendPasswordReset } from '../mailer.js';
import { audit } from '../middleware/audit.js';

const router = Router();

// Rate limiter para login: máx 10 intentos por IP cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión. Intenta de nuevo en 15 minutos.' },
});

// Rate limiter para reset de contraseña: máx 5 intentos por IP cada 15 minutos
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de recuperación. Intenta de nuevo en 15 minutos.' },
});

// Rate limiter para forgot-password: máx 5 solicitudes por IP por hora
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de recuperación. Intenta de nuevo en una hora.' },
});

// POST /api/auth/login — body: { user, pass }
router.post('/login', loginLimiter, async (req, res) => {
  const { user, pass } = req.body;
  if (!user || !pass) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  if (typeof user !== 'string' || typeof pass !== 'string')
    return res.status(400).json({ error: 'Datos de login inválidos' });
  if (user.trim().length > 100 || pass.length > 200)
    return res.status(400).json({ error: 'Usuario o contraseña demasiado largos' });

  const usuario = db.prepare('SELECT * FROM usuario WHERE LOWER(usu_user) = LOWER(?)').get(user.trim());
  if (!usuario) {
    // Auditar intento fallido con usuario inexistente (sin revelar si existe)
    req.user = { id: null, user: user.trim() };
    audit(req, 'auth.login_failed', 'usuario', null, { user: user.trim() }, 'error');
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const valid = await bcrypt.compare(pass, usuario.usu_pass);
  if (!valid) {
    // Auditar intento fallido con contraseña incorrecta
    req.user = { id: usuario.usu_id, user: usuario.usu_user };
    audit(req, 'auth.login_failed', 'usuario', usuario.usu_id, { user: usuario.usu_user }, 'error');
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = jwt.sign(
    { id: usuario.usu_id, user: usuario.usu_user, rol: usuario.usu_rol },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // Limpiar tokens de reset expirados en cada login exitoso (housekeeping)
  db.prepare("DELETE FROM password_reset_tokens WHERE expires_at < datetime('now') OR used = 1").run();

  // Auditoría: inyectamos req.user manualmente porque el middleware de auth aún no corrió
  req.user = { id: usuario.usu_id, user: usuario.usu_user, rol: usuario.usu_rol };
  audit(req, 'auth.login', 'usuario', usuario.usu_id);

  res.json({
    token,
    id:         usuario.usu_id,
    nombre:     usuario.usu_nombre,
    user:       usuario.usu_user,
    rol:        usuario.usu_rol,
    tiene_caja: usuario.usu_tiene_caja === 1,
  });
});

// POST /api/auth/forgot-password — body: { email }
// Genera token y envía email de reset. Siempre responde OK (no revela si el email existe).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/forgot-password', forgotLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });
  if (!EMAIL_RE.test(email.trim())) return res.status(400).json({ error: 'Formato de email inválido' });

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
router.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword?.trim())
    return res.status(400).json({ error: 'Token y nueva contraseña son requeridos' });
  if (newPassword.trim().length < 8)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

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
      'UPDATE usuario SET usu_pass = ?, usu_fechamod = ? WHERE usu_id = ?'
    ).run(hash, now, row.usu_id);
    db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').run(row.id);
  })();

  res.json({ ok: true, message: 'Contraseña actualizada correctamente. Ya podés iniciar sesión.' });
});

// PATCH /api/auth/change-password — body: { currentPassword, newPassword }
// Requiere JWT válido (se monta en requireAuth antes de este router)
router.patch('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword?.trim())
    return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas' });
  if (newPassword.trim().length < 8 || newPassword.trim().length > 100)
    return res.status(400).json({ error: 'La nueva contraseña debe tener entre 8 y 100 caracteres' });

  // req.user viene del middleware requireAuth — pero este router es público (/api/auth)
  // así que verificamos el JWT manualmente desde el header
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autenticado' });

  let userId;
  try {
    const { id } = (await import('jsonwebtoken')).default.verify(header.slice(7), (await import('../config.js')).JWT_SECRET);
    userId = id;
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const usuario = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(userId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const valid = await bcrypt.compare(currentPassword, usuario.usu_pass);
  if (!valid) return res.status(401).json({ error: 'La contraseña actual es incorrecta' });

  const hash = await bcrypt.hash(newPassword.trim(), 10);
  const now  = new Date().toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE usuario SET usu_pass = ?, usu_fechamod = ? WHERE usu_id = ?').run(hash, now, userId);
  req.user = { id: userId, user: usuario.usu_user, rol: usuario.usu_rol };
  audit(req, 'auth.change_password', 'usuario', userId);

  res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
});

// PATCH /api/auth/profile — actualiza nombre y/o email del usuario autenticado
router.patch('/profile', async (req, res) => {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autenticado' });

  let userId;
  try {
    const { id } = (await import('jsonwebtoken')).default.verify(header.slice(7), (await import('../config.js')).JWT_SECRET);
    userId = id;
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }

  const usuario = db.prepare('SELECT * FROM usuario WHERE usu_id = ?').get(userId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

  const { nombre, email } = req.body;
  if (nombre !== undefined && (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 100))
    return res.status(400).json({ error: 'El nombre debe tener entre 2 y 100 caracteres' });
  if (email !== undefined && email && !EMAIL_RE.test(email.trim()))
    return res.status(400).json({ error: 'Formato de email inválido' });

  const nuevoNombre = nombre?.trim() ?? usuario.usu_nombre;
  const nuevoEmail  = email !== undefined ? (email.trim().toLowerCase() || null) : usuario.usu_email;
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  db.prepare('UPDATE usuario SET usu_nombre = ?, usu_email = ?, usu_fechamod = ? WHERE usu_id = ?')
    .run(nuevoNombre, nuevoEmail, now, userId);

  req.user = { id: userId, user: usuario.usu_user, rol: usuario.usu_rol };
  audit(req, 'auth.update_profile', 'usuario', userId, { nombre: nuevoNombre, email: nuevoEmail });

  res.json({ ok: true, nombre: nuevoNombre, email: nuevoEmail });
});

// GET /api/auth/verify-reset-token/:token — verifica si un token es válido (para mostrar el form)
router.get('/verify-reset-token/:token', (req, res) => {
  const row = db.prepare(
    "SELECT usu_id, expires_at FROM password_reset_tokens WHERE token = ? AND used = 0"
  ).get(req.params.token);
  if (!row) return res.status(400).json({ valid: false, error: 'Token inválido o ya utilizado' });
  if (new Date(row.expires_at) < new Date())
    return res.status(400).json({ valid: false, error: 'El enlace expiró' });
  res.json({ valid: true });
});

export default router;
