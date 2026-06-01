/**
 * Helper de auditoría.
 *
 * Uso:
 *   import { audit } from '../middleware/audit.js';
 *   audit(req, 'record.create', 'maquina', machineId, { monto: 5000 });
 *
 * Acciones registradas por convención:
 *   auth.login           — inicio de sesión exitoso
 *   auth.change_password — cambio de contraseña propio
 *   record.create        — nuevo registro de recaudación
 *   route_run.create     — nuevo recorrido creado
 *   route_run.status     — cambio de estado de un recorrido
 *   caja.movimiento      — ingreso o egreso de caja
 *   caja.cierre          — cierre diario de caja
 *   cliente.create       — nuevo cliente
 *   cliente.update       — edición de cliente
 *   cliente.delete       — eliminación de cliente
 *   usuario.create       — nuevo usuario del sistema
 *   usuario.update       — edición de usuario
 *   usuario.delete       — eliminación de usuario
 */
import db from '../db.js';

// Aseguramos la columna resultado (por si la BD fue creada antes de este cambio)
try {
  db.exec("ALTER TABLE audit_log ADD COLUMN resultado TEXT NOT NULL DEFAULT 'ok'");
} catch { /* columna ya existe */ }

const _insert = db.prepare(`
  INSERT INTO audit_log (usu_id, usu_user, accion, entidad, entidad_id, detalle, ip, resultado)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * @param {import('express').Request} req
 * @param {string} accion       — acción realizada (ej: 'record.create')
 * @param {string} [entidad]    — tabla/recurso afectado (ej: 'maquina')
 * @param {string|number} [entidadId] — ID del recurso
 * @param {object} [detalle]    — datos adicionales (se serializa como JSON)
 * @param {'ok'|'error'} [resultado] — resultado de la operación (default: 'ok')
 */
export function audit(req, accion, entidad = null, entidadId = null, detalle = null, resultado = 'ok') {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
             ?? req.socket?.remoteAddress
             ?? null;
    _insert.run(
      req.user?.id   ?? null,
      req.user?.user ?? null,
      accion,
      entidad,
      entidadId != null ? String(entidadId) : null,
      detalle    != null ? JSON.stringify(detalle) : null,
      ip,
      resultado,
    );
  } catch (err) {
    // El log nunca debe romper la respuesta principal
    console.error('[audit] Error al registrar:', err.message);
  }
}
