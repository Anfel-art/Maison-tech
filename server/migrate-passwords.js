/**
 * Script de migración: convierte contraseñas en plain text a bcrypt hashes.
 * Ejecutar UNA SOLA VEZ: node server/migrate-passwords.js
 */
import bcrypt from 'bcryptjs';
import db from './db.js';

const SALT_ROUNDS = 10;

const usuarios = db.prepare('SELECT usu_id, usu_user, usu_pass FROM usuario').all();

console.log(`[migrate] Encontrados ${usuarios.length} usuarios.`);

for (const u of usuarios) {
  // Detectar si ya es un hash bcrypt (empieza con $2a$ o $2b$)
  if (u.usu_pass.startsWith('$2')) {
    console.log(`[migrate] ${u.usu_user}: ya tiene hash, omitiendo.`);
    continue;
  }

  const hash = await bcrypt.hash(u.usu_pass, SALT_ROUNDS);
  db.prepare('UPDATE usuario SET usu_pass = ? WHERE usu_id = ?').run(hash, u.usu_id);
  console.log(`[migrate] ${u.usu_user}: contraseña hasheada correctamente.`);
}

console.log('[migrate] Migración completada.');
