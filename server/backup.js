/**
 * backup.js — Backup automático de la base de datos SQLite
 *
 * Uso manual:  node server/backup.js
 * En código:   import { scheduleBackup } from './backup.js'
 *              scheduleBackup(db)   ← llama al iniciar el servidor
 */

import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH      = join(__dirname, 'seprisa.db');
const BACKUP_DIR   = join(__dirname, 'backups');
const MAX_BACKUPS  = 7;          // Mantener últimos 7 días
const INTERVAL_MS  = 24 * 60 * 60 * 1000; // Cada 24 horas

function pad(n) { return String(n).padStart(2, '0'); }

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function runBackup() {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const dest = join(BACKUP_DIR, `seprisa_${timestamp()}.db`);
    copyFileSync(DB_PATH, dest);
    console.log(`[backup] ✓ Base de datos respaldada → ${dest}`);

    // Eliminar backups más viejos que MAX_BACKUPS
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('seprisa_') && f.endsWith('.db'))
      .map(f => ({ name: f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // más nuevo primero

    files.slice(MAX_BACKUPS).forEach(f => {
      unlinkSync(join(BACKUP_DIR, f.name));
      console.log(`[backup] Eliminado backup antiguo: ${f.name}`);
    });
  } catch (err) {
    console.error('[backup] Error al respaldar la base de datos:', err.message);
  }
}

/**
 * Inicia backup inmediato y luego cada 24 horas.
 * Llamar desde server/index.js después de arrancar el servidor.
 */
export function scheduleBackup() {
  // Primer backup al iniciar (con 5s de delay para no bloquear el arranque)
  setTimeout(runBackup, 5000);
  // Luego cada 24h
  setInterval(runBackup, INTERVAL_MS);
}
