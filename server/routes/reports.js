import { Router } from 'express';
import db from '../db.js';

const router = Router();

function parseExtra(raw) {
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function buildWhere(machineId, from, to) {
  const c = [], p = [];
  if (machineId) { c.push('r.maq_id = ?');                     p.push(machineId); }
  if (from)      { c.push("date(r.rre_timestamp) >= date(?)"); p.push(from); }
  if (to)        { c.push("date(r.rre_timestamp) <= date(?)"); p.push(to); }
  return { where: c.length ? ' WHERE ' + c.join(' AND ') : '', params: p };
}

const BASE = `
  SELECT r.rre_id as id, r.maq_id as machine, l.lgr_nombre as location,
         substr(r.rre_timestamp, 1, 10) as date,
         strftime('%Y-%m', r.rre_timestamp) as mes,
         r.rre_mnto_total as mntoTotal, r.rre_pre_calc as preCalc,
         r.rre_campos_extra as extra, t.tmq_desc as tipo
  FROM rec_registro r
  LEFT JOIN lugar l ON r.lgr_id = l.lgr_id
  LEFT JOIN maquina m ON r.maq_id = m.maq_id
  LEFT JOIN tipomaquina t ON m.tmq_id = t.tmq_id
`;

// GET /api/reports/por-evento?from=&to=&machineId=
router.get('/por-evento', (req, res) => {
  const { machineId, from, to } = req.query;
  const { where, params } = buildWhere(machineId, from, to);
  const rows = db.prepare(BASE + where + ' ORDER BY r.rre_timestamp DESC').all(...params);
  res.json(rows.map(r => ({ ...r, camposExtra: parseExtra(r.extra), extra: undefined })));
});

// GET /api/reports/mensual?from=&to=&machineId=
router.get('/mensual', (req, res) => {
  const { machineId, from, to } = req.query;
  const { where, params } = buildWhere(machineId, from, to);
  const rows = db.prepare(BASE + where + ' ORDER BY r.rre_timestamp ASC').all(...params);

  const groups = new Map();
  for (const r of rows) {
    const key = `${r.machine}||${r.mes}`;
    if (!groups.has(key)) {
      groups.set(key, {
        machine: r.machine, location: r.location, mes: r.mes, tipo: r.tipo,
        eventos: 0, totalFisico: 0, totalPreCalc: 0, sumCampos: {},
      });
    }
    const g = groups.get(key);
    g.eventos++;
    g.totalFisico  += r.mntoTotal || 0;
    g.totalPreCalc += r.preCalc   || 0;
    const cx = parseExtra(r.extra);
    for (const [k, v] of Object.entries(cx)) {
      if (typeof v === 'number') g.sumCampos[k] = (g.sumCampos[k] || 0) + v;
    }
  }
  res.json([...groups.values()]);
});

// GET /api/reports/acumulado?from=&to=&machineId=
router.get('/acumulado', (req, res) => {
  const { machineId, from, to } = req.query;
  const { where, params } = buildWhere(machineId, from, to);
  const rows = db.prepare(BASE + where + ' ORDER BY r.rre_timestamp ASC').all(...params);

  const running = new Map();
  res.json(rows.map(r => {
    const prev = running.get(r.machine) || 0;
    const total = prev + (r.preCalc || 0);
    running.set(r.machine, total);
    return {
      id: r.id, date: r.date, machine: r.machine, location: r.location, tipo: r.tipo,
      preCalc: r.preCalc || 0, camposExtra: parseExtra(r.extra), runningTotal: total,
    };
  }));
});

// GET /api/reports/descuadres?from=&to=&machineId=
router.get('/descuadres', (req, res) => {
  const { machineId, from, to } = req.query;
  const { where, params } = buildWhere(machineId, from, to);
  const extra = 'ABS(r.rre_mnto_total - r.rre_pre_calc) > 0.01';
  const finalWhere = where ? where + ' AND ' + extra : ' WHERE ' + extra;
  const rows = db.prepare(BASE + finalWhere + ' ORDER BY r.rre_timestamp DESC').all(...params);
  res.json(rows.map(r => ({
    ...r,
    diff: (r.mntoTotal || 0) - (r.preCalc || 0),
    camposExtra: parseExtra(r.extra),
    extra: undefined,
  })));
});

// GET /api/reports/export?from=&to=&machineId= — CSV download
router.get('/export', (req, res) => {
  const { machineId, from, to } = req.query;
  const { where, params } = buildWhere(machineId, from, to);
  const rows = db.prepare(BASE + where + ' ORDER BY r.rre_timestamp DESC').all(...params);

  const allKeys = new Set();
  const parsed = rows.map(r => {
    const cx = parseExtra(r.extra);
    Object.keys(cx).forEach(k => allKeys.add(k));
    return { ...r, camposExtra: cx };
  });

  const cxCols = [...allKeys];
  const header = ['ID', 'Fecha', 'Tipo', 'Máquina', 'Ubicación', 'Mes',
                  'Monto Total', 'Pre-Cálculo', 'Diferencia', ...cxCols];

  const escape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvRows = [header.map(escape).join(',')];
  for (const r of parsed) {
    const diff = (r.mntoTotal || 0) - (r.preCalc || 0);
    const row = [
      r.id, r.date, r.tipo, r.machine, r.location || '', r.mes,
      r.mntoTotal || 0, r.preCalc || 0, diff,
      ...cxCols.map(k => r.camposExtra[k] ?? ''),
    ];
    csvRows.push(row.map(escape).join(','));
  }

  const csv = '\ufeff' + csvRows.join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="reporte_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send(csv);
});

export default router;
