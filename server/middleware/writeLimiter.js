/**
 * Rate limiters para endpoints de escritura.
 * Protegen contra flooding sin afectar el uso normal.
 *
 * Límites elegidos para no molestar al usuario legítimo:
 *   - records:  60 registros / 10 min por IP  → ~1 por cada 10 s  (recaudador promedio)
 *   - caja:     40 movimientos / 15 min por IP
 *   - clientes: 30 operaciones / 15 min por IP
 *   - genérico: 50 operaciones / 10 min por IP (para otros POST/PATCH/DELETE)
 */
import { rateLimit } from 'express-rate-limit';

const json429 = (msg) => ({
  legacyHeaders: false,
  standardHeaders: true,
  message: { error: msg },
});

export const recordsWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  ...json429('Demasiados registros en poco tiempo. Esperá unos minutos e intentá de nuevo.'),
});

export const cajaWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  ...json429('Demasiados movimientos de caja en poco tiempo. Esperá unos minutos.'),
});

export const clientesWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  ...json429('Demasiadas operaciones sobre clientes. Esperá unos minutos.'),
});

export const genericWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 50,
  ...json429('Demasiadas solicitudes. Esperá unos minutos e intentá de nuevo.'),
});
