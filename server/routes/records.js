import { Router } from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import db from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { recordsWriteLimiter } from '../middleware/writeLimiter.js';
import { audit } from '../middleware/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const storage = multer.diskStorage({
  destination: join(__dirname, '../uploads'),
  filename: (_req, file, cb) => {
    cb(null, `rec_${Date.now()}${extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB máx.
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (jpeg, png, webp, gif)'));
    }
  },
});

const router = Router();

function formatRecord(r) {
  const preCalc  = r.rre_pre_calc   ?? 0;
  const mntoTotal = r.rre_mnto_total ?? 0;
  const diff = mntoTotal - preCalc;
  return {
    id: r.rre_id,
    tipo: r.rre_tipo ?? 'normal',
    machine: r.maq_id,
    location: r.lgr_nombre ?? '',
    preCalc,
    fisico: mntoTotal,
    status: diff !== 0 ? `Descuadre (${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('es-PY')} Gs.)` : 'OK',
    date: r.rre_timestamp?.slice(0, 10) ?? '',
    contEntrada: r.rre_cont_entrada,
    contSalida: r.rre_cont_salida,
    contDigital: r.rre_cont_rec_digital,
    contPozo: r.rre_cont_rec_pozo,
    contReal: r.rre_cont_real,
    contRealDif: r.rre_cont_real_dif,
    contPremioEntrada: r.rre_cont_premio_entrada,
    contPremioSalida: r.rre_cont_premio_salida,
    contPremioStockAct: r.rre_cont_premio_stock_act,
    contPremioStockAdd: r.rre_cont_premio_stock_add,
    contJuegosUtilizados: r.rre_cont_juegos_utilizados,
    mntoLocatario: r.rre_mnto_locatario,
    mntoCasa: r.rre_mnto_casa,
    mntoRecaudador: r.rre_mnto_recaudador,
    mntoTotal: r.rre_mnto_total,
    camposExtra: (() => { try { return r.rre_campos_extra ? JSON.parse(r.rre_campos_extra) : {}; } catch { return {}; } })(),
  };
}

const SELECT_RECORD = `
  SELECT r.*, l.lgr_nombre
  FROM rec_registro r
  LEFT JOIN lugar l ON r.lgr_id = l.lgr_id
`;

// GET /api/records?machineId=xxx&routeRunId=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
// Sin filtros aplica límite de 90 días para evitar cargar toda la BD
router.get('/', (req, res) => {
  const { machineId, routeRunId, from, to } = req.query;
  const conditions = [];
  const params = [];

  if (machineId)  { conditions.push('r.maq_id = ?');                    params.push(machineId); }
  if (routeRunId) { conditions.push('r.route_run_id = ?');               params.push(routeRunId); }
  if (from)       { conditions.push("date(r.rre_timestamp) >= date(?)"); params.push(from); }
  if (to)         { conditions.push("date(r.rre_timestamp) <= date(?)"); params.push(to); }

  // Si no hay ningún filtro de fecha ni de máquina, aplicar ventana de 90 días por defecto
  const hasDateFilter = from || to;
  if (!hasDateFilter && !machineId && !routeRunId) {
    conditions.push("date(r.rre_timestamp) >= date('now', '-90 days')");
  }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  const rows = db.prepare(SELECT_RECORD + where + ' ORDER BY r.rre_id DESC').all(...params);
  res.json(rows.map(formatRecord));
});

// GET /api/records/last/:machineId — último registro de una máquina
router.get('/last/:machineId', (req, res) => {
  const r = db.prepare(SELECT_RECORD + ' WHERE r.maq_id = ? ORDER BY r.rre_id DESC LIMIT 1').get(req.params.machineId);
  if (!r) return res.status(404).json({ error: 'Sin registros' });
  res.json(formatRecord(r));
});

// POST /api/records
router.post('/', requireAuth, recordsWriteLimiter, (req, res) => {
  const {
    machine, maqId, lgrId, rutId,
    preCalc, mntoTotal, montoTotal, mntoLocatario, mntoCasa, mntoRecaudador,
    camposExtra, timestamp, tipo,
    // Legacy direct fields (old clients / fallback)
    fisico,
    contEntrada, contSalida, contDigital, contPozo,
    contReal, contRealDif,
    contPremioEntrada, contPremioSalida, contPremioStockAct, contPremioStockAdd,
    contJuegosUtilizados,
  } = req.body;

  const machineIdRaw = machine ?? maqId ?? null;
  if (!machineIdRaw) return res.status(400).json({ error: 'El ID de máquina es requerido' });

  // Verificar que la máquina existe en la BD
  const maqExiste = db.prepare('SELECT 1 FROM maquina WHERE maq_id = ?').get(machineIdRaw);
  if (!maqExiste) return res.status(404).json({ error: `Máquina '${machineIdRaw}' no encontrada` });

  const montoFinal = camposExtra?.monto_total ?? mntoTotal ?? montoTotal ?? fisico ?? 0;
  if (typeof montoFinal !== 'number' || !isFinite(montoFinal) || montoFinal < 0)
    return res.status(400).json({ error: 'El monto total debe ser un número no negativo' });

  if (timestamp) {
    // Requiere formato ISO 8601 estricto: YYYY-MM-DDTHH:mm o YYYY-MM-DD HH:mm (con segundos opcionales)
    const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
    if (!ISO_RE.test(String(timestamp)) || isNaN(Date.parse(timestamp)))
      return res.status(400).json({ error: 'Formato de timestamp inválido (use ISO 8601: YYYY-MM-DDTHH:mm:ss)' });
  }

  const extra = camposExtra ?? {};

  // Map dynamic campo keys to legacy columns where available
  const cEntrada  = extra.cont_entrada  ?? contEntrada  ?? 0;
  const cSalida   = extra.cont_salida   ?? contSalida   ?? 0;
  const cDif      = extra.cont_dif      ?? (cSalida - cEntrada);
  const cDigital  = extra.cont_digital  ?? contDigital  ?? 0;
  const cPozo     = extra.cont_pozo     ?? contPozo     ?? 0;
  const cReal     = extra.cont_real     ?? contReal     ?? 0;
  const cRealDif  = contRealDif         ?? (cReal - cPozo);
  const cPremioE  = extra.premio_entrada ?? contPremioEntrada  ?? 0;
  const cPremioS  = extra.premio_salida  ?? contPremioSalida   ?? 0;
  const cStockA   = extra.stock_act      ?? contPremioStockAct ?? 0;
  const cStockAdd = extra.stock_add      ?? contPremioStockAdd ?? 0;
  const mTotal    = extra.monto_total    ?? mntoTotal ?? montoTotal ?? fisico ?? 0;
  const machineId = machineIdRaw;
  const preCalcV  = preCalc ?? extra.firma_yu ?? extra.saldo ?? extra.pre_calc ?? 0;

  const tsClause  = timestamp ? ', rre_timestamp' : '';
  const tsParam   = timestamp ? ', ?' : '';
  const tipoVal   = tipo === 'init' ? 'init' : 'normal';
  const result = db.prepare(`
    INSERT INTO rec_registro (
      maq_id, lgr_id, route_run_id,
      rre_tipo,
      rre_pre_calc,
      rre_cont_entrada, rre_cont_salida, rre_cont_dif, rre_cont_rec_digital, rre_cont_rec_pozo,
      rre_cont_real, rre_cont_real_dif,
      rre_cont_premio_entrada, rre_cont_premio_salida,
      rre_cont_premio_stock_act, rre_cont_premio_stock_add,
      rre_mnto_locatario, rre_mnto_casa, rre_mnto_recaudador, rre_mnto_total,
      rre_campos_extra${tsClause}
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${tsParam})
  `).run(
    machineId, lgrId ?? null, rutId ?? null,
    tipoVal,
    preCalcV,
    cEntrada, cSalida, cDif, cDigital, cPozo,
    cReal, cRealDif,
    cPremioE, cPremioS, cStockA, cStockAdd,
    mntoLocatario ?? 0, mntoCasa ?? 0, mntoRecaudador ?? 0, mTotal,
    Object.keys(extra).length > 0 ? JSON.stringify(extra) : '{}',
    ...(timestamp ? [timestamp] : []),
  );

  const r = db.prepare(SELECT_RECORD + ' WHERE r.rre_id = ?').get(result.lastInsertRowid);
  audit(req, 'record.create', 'maquina', machineId, { monto: mTotal, recordId: result.lastInsertRowid });
  res.status(201).json(formatRecord(r));
});

// POST /api/records/:id/images
router.post('/:id/images', requireAuth, upload.single('photo'), (req, res) => {
  const { id } = req.params;
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

  // Verify the record exists before inserting the image
  const record = db.prepare('SELECT rre_id FROM rec_registro WHERE rre_id = ?').get(id);
  if (!record) return res.status(404).json({ error: 'Registro no encontrado' });

  const rimPath = `/uploads/${req.file.filename}`;
  const result = db.prepare(
    'INSERT INTO rec_img (rim_path, rim_evento, rre_id) VALUES (?, ?, ?)'
  ).run(rimPath, 'evidencia', id);

  res.status(201).json({ id: result.lastInsertRowid, path: rimPath });
});

export default router;
