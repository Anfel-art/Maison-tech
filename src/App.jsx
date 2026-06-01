import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import * as LucideIcons from 'lucide-react';
// MobileApp se carga de forma lazy: admins nunca descargan el código móvil
const MobileApp = lazy(() => import('./MobileApp'));
import ScanPage from './ScanPage';

// ── Dark mode — inicializar antes del primer render ────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = saved ?? (prefersDark ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
})();
import { getMachines, getMachine, getRecords, createRecord, updateMachine, getRouteRuns, updateStop, deleteStop, updateRouteRun, createRouteRun, createMachine, getTipos, getLugares, createLugar, updateLugar, getConfig, updateConfig, createTipo, updateTipo, deleteTipo, createCampo, updateCampo, deleteCampo, reorderCampos, login, getToken, clearToken, getNombre, setNombre, getTieneCaja, changePassword, updateProfile, getReportePorEvento, getReporteMensual, getReporteAcumulado, getReporteDescuadres, getReporteExportUrl, getCajaMovimientos, getCajaBalance, createCajaMovimiento, deleteCajaMovimiento, reembolsarMovimiento, getCatalogo, createCatalogoItem, updateCatalogoItem, deleteCatalogoItem, uploadCatalogoImagen, getItemTiposCat, createItemTipoCat, updateItemTipoCat, deleteItemTipoCat, getTipomaquinas, getClientes, getClientesData, getClienteFicha, createCliente, updateCliente, deleteCliente, getCajaCierre, createCajaApertura, createCajaCierre, deleteCajaCierre, getUsuarios, createUsuario, updateUsuario, deleteUsuario, getUsuariosActividad, getVehiculo, saveVehiculo, deleteVehiculo, asignarProductoCliente, updateProductoCliente, removeProductoCliente, forgotPassword, resetPassword, verifyResetToken, getAuditLog, createSolicitud, getSolicitudes, getSolicitudesPendientes, marcarSolicitudLeida, marcarTodasLeidas, deleteSolicitud, getSesiones, getSesionMovimientos, getPedidos, exportCajaSesiones } from './api';
import './index.css';

const Icon = ({ name, size = 24, className = "" }) => {
    const componentName = name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('');
    const IconComponent = LucideIcons[componentName] || LucideIcons.HelpCircle;
    return <IconComponent size={size} className={className} />;
};


function fmtDuration(minutes) {
    if (minutes == null) return '—';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtGs(n) {
    return n ? n.toLocaleString('es-PY') + ' Gs.' : '0 Gs.';
}

const RunCard = ({ run, onUpdate }) => {
    const [expanded, setExpanded] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [confirmCancel, setConfirmCancel] = useState(false);
    const [datePart, timePart] = (run.startedAt ?? '').split(' ');
    const timeStr = timePart ? timePart.slice(0, 5) : '';
    const isActive  = run.status === 'active';
    const isPending = run.status === 'pending';
    const firstPendingIdx = run.stops.findIndex(s => s.status === 'pending');

    // Tiempo transcurrido para rutas activas
    const elapsed = isActive && run.startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000))
        : null;

    const statusLabel     = { pending: 'Pendiente', active: 'Activa', completed: 'Completada', cancelled: 'Cancelada' };
    const statusBadgeStyle = {
        pending:   { background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74' },
        active:    { background: '#eef2ff', color: '#4f46e5', border: '1px solid #a5b4fc' },
        completed: { background: '#f0fdf4', color: '#16a34a', border: '1px solid #86efac' },
        cancelled: { background: '#f9fafb', color: '#6b7280', border: '1px solid #d1d5db' },
    };
    const dotColor = { pending: '#ea580c', active: '#4f46e5', completed: '#10b981', cancelled: '#9ca3af' };

    async function handleStop(stop, status) {
        setProcessing(true);
        await updateStop(run.id, stop.id, status);
        const updatedStatuses = run.stops.map(s => s.id === stop.id ? status : s.status);
        if (updatedStatuses.every(s => s !== 'pending')) {
            await updateRouteRun(run.id, { status: 'completed', totalDistance: run.totalDistance, totalTime: run.totalTime });
        }
        await onUpdate();
        setProcessing(false);
    }

    async function handleFinalize() {
        setProcessing(true);
        await updateRouteRun(run.id, { status: 'cancelled', totalDistance: run.totalDistance, totalTime: run.totalTime });
        await onUpdate();
        setProcessing(false);
        setConfirmCancel(false);
    }

    const badgeStyle = { ...(statusBadgeStyle[run.status] ?? statusBadgeStyle.cancelled), fontSize: '0.62rem', fontWeight: 700, borderRadius: 999, padding: '1px 8px' };

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            <div
                style={{ padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}
                onClick={() => setExpanded(!expanded)}
            >
                <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: dotColor[run.status] ?? '#9ca3af' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span className="font-semibold text-sm">Ruta #{run.id}</span>
                        <span style={badgeStyle}>{statusLabel[run.status] ?? run.status}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {datePart} · {timeStr}
                        {run.recaudadorNombre && (
                            <span style={{ marginLeft: 6, color: 'var(--text)', fontWeight: 600 }}>· {run.recaudadorNombre}</span>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Paradas</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                            {run.doneCount ?? run.stops.filter(s => s.status === 'done').length}/{run.stops.length}
                            {run.failedCount > 0 && (
                                <span style={{ fontSize: '0.65rem', color: '#ef4444', marginLeft: 3 }}>({run.failedCount}✕)</span>
                            )}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{isActive ? 'Transcurrido' : 'Duración'}</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isActive ? '#4f46e5' : 'inherit' }}>
                            {elapsed != null ? fmtDuration(elapsed) : fmtDuration(run.duration ?? run.totalTime)}
                        </div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Recaudado</div>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: run.totalRecaudado > 0 ? '#10b981' : 'var(--text-primary)' }}>
                            {(run.totalRecaudado ?? 0).toLocaleString('es-PY')} Gs.
                        </div>
                    </div>
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} className="text-muted" />
                </div>
            </div>
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem', background: 'var(--bg-color)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {run.stops.map((stop, i) => {
                            const isNext = isActive && i === firstPendingIdx;
                            const visitHora = stop.visitedAt
                                ? new Date(stop.visitedAt).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })
                                : null;
                            return (
                                <div key={stop.id} style={{
                                    border: `1px solid ${isNext ? 'rgba(79,70,229,0.3)' : 'var(--border)'}`,
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '0.5rem 0.625rem',
                                    background: isNext ? 'rgba(79,70,229,0.04)' : 'transparent',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                                        <div style={{
                                            width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.65rem', fontWeight: 700, color: 'white', flexShrink: 0,
                                            background: stop.status === 'done' ? '#10b981' : stop.status === 'failed' ? '#ef4444' : isNext ? '#4f46e5' : '#9ca3af'
                                        }}>{i + 1}</div>
                                        <span style={{ flex: 1 }}>{stop.location ?? stop.machineId}</span>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{stop.machineId}</span>
                                        {visitHora && (
                                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <Icon name="clock" size={10} />{visitHora}
                                            </span>
                                        )}
                                        {stop.status !== 'pending' && (
                                            <span style={{
                                                fontSize: '0.65rem', padding: '0.125rem 0.375rem', borderRadius: 4, fontWeight: 600,
                                                background: stop.status === 'done' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                                color: stop.status === 'done' ? '#065f46' : '#b91c1c'
                                            }}>
                                                {stop.status === 'done' ? 'Visitado' : 'Saltado'}
                                            </span>
                                        )}
                                    </div>
                                    {isNext && (
                                        <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.5rem' }}>
                                            <button
                                                disabled={processing}
                                                onClick={() => handleStop(stop, 'done')}
                                                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.3rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#065f46', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', opacity: processing ? 0.5 : 1 }}
                                            >
                                                <Icon name="check-circle" size={13} /> Visitado
                                            </button>
                                            <button
                                                disabled={processing}
                                                onClick={() => handleStop(stop, 'failed')}
                                                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.3rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#b91c1c', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', opacity: processing ? 0.5 : 1 }}
                                            >
                                                <Icon name="x-circle" size={13} /> Saltado
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {isActive && (
                        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                            {confirmCancel ? (
                                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '0.65rem 0.85rem' }}>
                                    <p style={{ fontSize: '0.8rem', color: '#b91c1c', fontWeight: 600, margin: '0 0 0.5rem' }}>
                                        ¿Confirmar cancelación de esta ruta? Esta acción no se puede deshacer.
                                    </p>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button disabled={processing} onClick={handleFinalize}
                                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.8rem', borderRadius: 6, border: '1px solid rgba(239,68,68,0.4)', background: '#fee2e2', color: '#b91c1c', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', opacity: processing ? 0.5 : 1 }}>
                                            <Icon name="square" size={13} /> Sí, cancelar
                                        </button>
                                        <button onClick={() => setConfirmCancel(false)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.8rem', borderRadius: 6, border: '1px solid var(--border)', background:'var(--surface)', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}>
                                            Volver
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button disabled={processing} onClick={() => setConfirmCancel(true)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.4rem 0.875rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#b91c1c', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', opacity: processing ? 0.5 : 1 }}>
                                    <Icon name="square" size={13} /> Finalizar Ruta
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ─── ReportePanel ─────────────────────────────────────────────────────────────
const thS = { padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--bg-color)', borderBottom: '1px solid var(--border)' };
const tdS = { padding: '0.5rem 0.75rem', fontSize: '0.82rem', borderBottom: '1px solid var(--border)' };
const thR = { ...thS, textAlign: 'right' };
const tdR = { ...tdS, textAlign: 'right' };

function numFmt(v, decimals = 2) {
    if (v == null || v === '') return '—';
    return Number(v).toLocaleString('es-PY', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function ReporteFilters({ filters, setFilters, machines }) {
    return (
        <div className="card p-4 mb-4">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                <div>
                    <label className="text-xs text-muted block mb-1">Desde</label>
                    <input type="date" className="input" value={filters.from}
                        onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
                </div>
                <div>
                    <label className="text-xs text-muted block mb-1">Hasta</label>
                    <input type="date" className="input" value={filters.to}
                        onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
                </div>
                <div>
                    <label className="text-xs text-muted block mb-1">Máquina</label>
                    <select className="input" value={filters.machineId}
                        onChange={e => setFilters(f => ({ ...f, machineId: e.target.value }))}>
                        <option value="">Todas las máquinas</option>
                        {machines.map(m => <option key={m.id} value={m.id}>{m.id} — {m.location}</option>)}
                    </select>
                </div>
                <button className="btn btn-secondary" onClick={() => setFilters({ from: '', to: '', machineId: '' })}>
                    <Icon name="x" size={14} /> Limpiar
                </button>
            </div>
        </div>
    );
}

// Sub-tab: Por Evento
function TabPorEvento({ filters, machines, exportUrl }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getReportePorEvento(filters)
          .then(data => { if (!cancelled) setRows(data); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [filters]);

    const totalFisico = rows.reduce((s, r) => s + (r.mntoTotal || 0), 0);

    // Collect all camposExtra keys that appear (numeric only, excluding monto_total already shown)
    const cxKeys = [...new Set(rows.flatMap(r => Object.keys(r.camposExtra || {}).filter(k => typeof r.camposExtra[k] === 'number' && k !== 'monto_total')))];
    // Key formula result campos to highlight (readonly calculated values)
    const keyFinancial = cxKeys.filter(k => ['firma_yu','saldo','neto','ganancia','resultado'].includes(k));

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="font-semibold text-sm">{loading ? 'Cargando...' : `${rows.length} eventos`}</span>
                <a href={exportUrl} className="btn btn-secondary" style={{ fontSize: '0.75rem', textDecoration: 'none' }}>
                    <Icon name="download" size={14} /> Exportar CSV
                </a>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={thS}>#</th>
                            <th style={thS}>Fecha</th>
                            <th style={thS}>Tipo</th>
                            <th style={thS}>Máquina</th>
                            <th style={thS}>Ubicación</th>
                            <th style={thR}>Monto Total</th>
                            {keyFinancial.map(k => <th key={k} style={thR}>{k.replace(/_/g,' ')}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={6 + keyFinancial.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Cargando...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={6 + keyFinancial.length} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Sin registros</td></tr>
                        ) : rows.map(r => (
                            <tr key={r.id}>
                                <td style={{ ...tdS, color: 'var(--text-muted)', fontSize: '0.7rem' }}>#{r.id}</td>
                                <td style={tdS}>{r.date}</td>
                                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.tipo}</td>
                                <td style={tdS}><span className="badge">{r.machine}</span></td>
                                <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.location || '—'}</td>
                                <td style={{ ...tdR, fontWeight: 600 }}>{numFmt(r.mntoTotal)}</td>
                                {keyFinancial.map(k => (
                                    <td key={k} style={{ ...tdR, color: '#10b981', fontWeight: 600 }}>{numFmt(r.camposExtra?.[k])}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr style={{ background: 'var(--bg-color)' }}>
                                <td colSpan={5} style={{ ...tdS, fontWeight: 700, fontSize: '0.78rem' }}>TOTAL ({rows.length})</td>
                                <td style={{ ...tdR, fontWeight: 700 }}>{numFmt(totalFisico)}</td>
                                {keyFinancial.map(k => (
                                    <td key={k} style={{ ...tdR, fontWeight: 700, color: '#10b981' }}>
                                        {numFmt(rows.reduce((s, r) => s + (r.camposExtra?.[k] || 0), 0))}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

// Sub-tab: Mensual
function TabMensual({ filters }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getReporteMensual(filters)
          .then(data => { if (!cancelled) setRows(data); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [filters]);

    const grandFisico = rows.reduce((s, r) => s + (r.totalFisico || 0), 0);

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
                <span className="font-semibold text-sm">{loading ? 'Cargando...' : `${rows.length} períodos`}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={thS}>Mes</th>
                            <th style={thS}>Tipo</th>
                            <th style={thS}>Máquina</th>
                            <th style={thS}>Ubicación</th>
                            <th style={thR}>Eventos</th>
                            <th style={thR}>Total Recaudado</th>
                            <th style={thR}>Promedio/Evento</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Cargando...</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Sin datos</td></tr>
                        ) : rows.map((r, i) => {
                            const avg = r.eventos > 0 ? r.totalFisico / r.eventos : 0;
                            return (
                                <tr key={i}>
                                    <td style={{ ...tdS, fontWeight: 600 }}>{r.mes}</td>
                                    <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.tipo}</td>
                                    <td style={tdS}><span className="badge">{r.machine}</span></td>
                                    <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.location || '—'}</td>
                                    <td style={tdR}>{r.eventos}</td>
                                    <td style={{ ...tdR, fontWeight: 600 }}>{numFmt(r.totalFisico)}</td>
                                    <td style={{ ...tdR, color: 'var(--text-muted)' }}>{numFmt(avg)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr style={{ background: 'var(--bg-color)' }}>
                                <td colSpan={4} style={{ ...tdS, fontWeight: 700, fontSize: '0.78rem' }}>TOTAL GENERAL</td>
                                <td style={{ ...tdR, fontWeight: 700 }}>{rows.reduce((s, r) => s + r.eventos, 0)}</td>
                                <td style={{ ...tdR, fontWeight: 700 }}>{numFmt(grandFisico)}</td>
                                <td style={tdR} />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    );
}

// Sub-tab: Acumulado
function TabAcumulado({ filters }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getReporteAcumulado(filters)
          .then(data => { if (!cancelled) setRows(data); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [filters]);

    // Agrupar por máquina para mostrar el running total final de cada una
    const porMaquina = {};
    rows.forEach(r => {
        if (!porMaquina[r.machine]) porMaquina[r.machine] = { machine: r.machine, location: r.location, tipo: r.tipo, eventos: 0, runningTotal: 0 };
        porMaquina[r.machine].eventos++;
        porMaquina[r.machine].runningTotal = r.runningTotal;
    });
    const resumen = Object.values(porMaquina).sort((a, b) => b.runningTotal - a.runningTotal);
    const grandTotal = resumen.reduce((s, r) => s + r.runningTotal, 0);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Tabla resumen por máquina */}
            <div className="card" style={{ overflow: 'hidden', gridColumn: '1/-1' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-semibold text-sm">{loading ? 'Cargando...' : `${resumen.length} máquinas · ${rows.length} eventos`}</span>
                    <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--success)' }}>
                        Total acumulado: {numFmt(grandTotal)}
                    </span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thS}>Máquina</th>
                                <th style={thS}>Tipo</th>
                                <th style={thS}>Ubicación</th>
                                <th style={thR}>Eventos</th>
                                <th style={thR}>Total Acumulado</th>
                                <th style={thR}>% del total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Cargando...</td></tr>
                            ) : resumen.length === 0 ? (
                                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Sin datos</td></tr>
                            ) : resumen.map((r, i) => {
                                const pct = grandTotal > 0 ? (r.runningTotal / grandTotal * 100).toFixed(1) : 0;
                                return (
                                    <tr key={r.machine}>
                                        <td style={tdS}><span className="badge">{r.machine}</span></td>
                                        <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.tipo || '—'}</td>
                                        <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.location || '—'}</td>
                                        <td style={tdR}>{r.eventos}</td>
                                        <td style={{ ...tdR, fontWeight: 700, color: 'var(--success)' }}>{numFmt(r.runningTotal)}</td>
                                        <td style={tdR}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                                <div style={{ width: 60, height: 6, background: 'var(--bg-color)', borderRadius: 99, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--primary)', borderRadius: 99 }} />
                                                </div>
                                                <span style={{ fontSize: '0.75rem', minWidth: 38, textAlign: 'right' }}>{pct}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {resumen.length > 0 && (
                            <tfoot>
                                <tr style={{ background: 'var(--bg-color)' }}>
                                    <td colSpan={3} style={{ ...tdS, fontWeight: 700, fontSize: '0.78rem' }}>TOTAL GENERAL</td>
                                    <td style={{ ...tdR, fontWeight: 700 }}>{resumen.reduce((s, r) => s + r.eventos, 0)}</td>
                                    <td style={{ ...tdR, fontWeight: 700, color: 'var(--success)' }}>{numFmt(grandTotal)}</td>
                                    <td style={tdR} />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </div>
    );
}

// Sub-tab: Descuadres
function TabDescuadres({ filters }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getReporteDescuadres(filters)
          .then(data => { if (!cancelled) setRows(data); })
          .catch(() => {})
          .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [filters]);

    const totalDiff = rows.reduce((s, r) => s + (r.diff || 0), 0);
    const positivos = rows.filter(r => r.diff > 0).length;
    const negativos = rows.filter(r => r.diff < 0).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* KPIs de descuadres */}
            {rows.length > 0 && !loading && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                    {[
                        { label: 'Total descuadres', value: rows.length, color: '#d97706', bg: '#fffbeb' },
                        { label: 'Sobrantes (físico > esperado)', value: positivos, color: '#16a34a', bg: '#f0fdf4' },
                        { label: 'Faltantes (físico < esperado)', value: negativos, color: '#dc2626', bg: '#fef2f2' },
                    ].map(k => (
                        <div key={k.label} className="card p-3" style={{ background: k.bg, border: `1px solid ${k.color}22` }}>
                            <div style={{ fontSize: '0.65rem', color: k.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{k.label}</div>
                            <div style={{ fontSize: '1.35rem', fontWeight: 900, color: k.color }}>{k.value}</div>
                        </div>
                    ))}
                </div>
            )}

            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-semibold text-sm">{loading ? 'Cargando...' : `${rows.length} descuadre${rows.length !== 1 ? 's' : ''} encontrado${rows.length !== 1 ? 's' : ''}`}</span>
                    {rows.length > 0 && (
                        <span style={{ fontWeight: 800, fontSize: '0.85rem', color: totalDiff >= 0 ? '#16a34a' : '#dc2626' }}>
                            Diferencia total: {totalDiff >= 0 ? '+' : ''}{numFmt(totalDiff)}
                        </span>
                    )}
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thS}>#</th>
                                <th style={thS}>Fecha</th>
                                <th style={thS}>Máquina</th>
                                <th style={thS}>Tipo</th>
                                <th style={thS}>Ubicación</th>
                                <th style={thR}>Esperado (pre-calc)</th>
                                <th style={thR}>Físico</th>
                                <th style={thR}>Diferencia</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Cargando...</td></tr>
                            ) : rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                                            <Icon name="check-circle" size={32} style={{ color: 'var(--success)', opacity: 0.6 }} />
                                            <span style={{ fontWeight: 600 }}>Sin descuadres en el período</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : rows.map(r => {
                                const diff = r.diff || 0;
                                const diffColor = diff > 0 ? '#16a34a' : '#dc2626';
                                const diffBg   = diff > 0 ? '#f0fdf4' : '#fef2f2';
                                return (
                                    <tr key={r.id}>
                                        <td style={{ ...tdS, color: 'var(--text-muted)', fontSize: '0.7rem' }}>#{r.id}</td>
                                        <td style={tdS}>{r.date}</td>
                                        <td style={tdS}><span className="badge">{r.machine}</span></td>
                                        <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.tipo || '—'}</td>
                                        <td style={{ ...tdS, color: 'var(--text-muted)' }}>{r.location || '—'}</td>
                                        <td style={tdR}>{numFmt(r.preCalc)}</td>
                                        <td style={{ ...tdR, fontWeight: 600 }}>{numFmt(r.mntoTotal)}</td>
                                        <td style={{ ...tdR }}>
                                            <span style={{ background: diffBg, color: diffColor, fontWeight: 800, padding: '2px 8px', borderRadius: 6, fontSize: '0.82rem' }}>
                                                {diff > 0 ? '+' : ''}{numFmt(diff)}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        {rows.length > 0 && (
                            <tfoot>
                                <tr style={{ background: 'var(--bg-color)' }}>
                                    <td colSpan={7} style={{ ...tdS, fontWeight: 700, fontSize: '0.78rem' }}>DIFERENCIA TOTAL</td>
                                    <td style={{ ...tdR, fontWeight: 800, color: totalDiff >= 0 ? '#16a34a' : '#dc2626' }}>
                                        {totalDiff >= 0 ? '+' : ''}{numFmt(totalDiff)}
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
        </div>
    );
}

const REPORT_TABS = [
    { key: 'evento',     label: 'Por Evento',  icon: 'list' },
    { key: 'mensual',    label: 'Mensual',     icon: 'calendar' },
    { key: 'acumulado',  label: 'Acumulado',   icon: 'trending-up' },
    { key: 'descuadres', label: 'Descuadres',  icon: 'alert-triangle' },
];

const ReportePanel = ({ machines }) => {
    const [tab, setTab]         = useState('evento');
    const [filters, setFilters] = useState({ from: '', to: '', machineId: '' });
    const exportUrl = getReporteExportUrl(filters);

    return (
        <div>
            <ReporteFilters filters={filters} setFilters={setFilters} machines={machines} />

            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
                {REPORT_TABS.map(t => (
                    <button key={t.key} onClick={() => setTab(t.key)}
                        className="btn"
                        style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem', background: tab === t.key ? 'var(--primary)' : 'transparent', color: tab === t.key ? '#fff' : 'var(--text-muted)', border: tab === t.key ? 'none' : '1px solid var(--border)' }}>
                        <Icon name={t.icon} size={13} /> {t.label}
                        {t.key === 'descuadres' && <span style={{ marginLeft: 4, background: tab === t.key ? 'rgba(255,255,255,0.25)' : '#fef2f2', color: tab === t.key ? 'white' : '#dc2626', borderRadius: 99, fontSize: '0.65rem', fontWeight: 800, padding: '0px 5px' }}>!</span>}
                    </button>
                ))}
            </div>

            {tab === 'evento'     && <TabPorEvento  filters={filters} machines={machines} exportUrl={exportUrl} />}
            {tab === 'mensual'    && <TabMensual    filters={filters} />}
            {tab === 'acumulado'  && <TabAcumulado  filters={filters} />}
            {tab === 'descuadres' && <TabDescuadres filters={filters} />}
        </div>
    );
};

// ─── AsignacionRecorridoPage ───────────────────────────────────────────────────
const AsignacionRecorridoPage = () => {
    const [maquinas,  setMaquinas]  = useState([]);
    const [clientes,  setClientes]  = useState([]);
    const [tipos,     setTipos]     = useState([]);
    const [lugares,   setLugares]   = useState([]);
    const [loading,   setLoading]   = useState(true);
    const [selec,        setSelec]        = useState(new Set()); // maq_ids seleccionadas
    const [creating,     setCreating]     = useState(false);
    const [runCreado,    setRunCreado]    = useState(null);
    const [error,        setError]        = useState('');
    const [recaudadores, setRecaudadores] = useState([]);
    const [recaudadorId, setRecaudadorId] = useState('');
    // Filtros
    const [filtroCli,    setFiltroCli]    = useState('');
    const [filtroLugar,  setFiltroLugar]  = useState('');
    const [filtroTipo,   setFiltroTipo]   = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [buscar,       setBuscar]       = useState('');

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const [mqs, clis, tps, lgs, usuarios] = await Promise.all([
                getMachines(), getClientesData(), getTipos(), getLugares(), getUsuarios()
            ]);
            setMaquinas(mqs);
            setClientes(clis);
            setTipos(tps);
            setLugares(lgs);
            setRecaudadores(usuarios.filter(u => u.rol === 'terreno'));
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const toggle = (id) => setSelec(s => {
        const n = new Set(s);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
    });

    const toggleAll = (ids) => setSelec(s => {
        const n = new Set(s);
        const todosSelec = ids.every(id => n.has(id));
        ids.forEach(id => todosSelec ? n.delete(id) : n.add(id));
        return n;
    });

    const handleCrearRecorrido = async () => {
        if (selec.size === 0) return;
        setCreating(true); setError('');
        try {
            const run = await createRouteRun([...selec], recaudadorId ? Number(recaudadorId) : null);
            setRunCreado(run);
            setSelec(new Set());
            setRecaudadorId('');
        } catch (e) { setError(e.message || 'Error al crear el recorrido'); }
        finally { setCreating(false); }
    };

    const statusColor = { ok:'#16a34a', mantenimiento:'#d97706', fuera_servicio:'#dc2626', baja:'#6b7280' };
    const statusLabel = { ok:'Operativa', mantenimiento:'Mantenimiento', fuera_servicio:'Fuera de servicio', baja:'De baja' };

    // Aplicar filtros
    const filtradas = maquinas.filter(m => {
        if (filtroStatus && m.status !== filtroStatus) return false;
        if (filtroTipo   && String(m.tmqId) !== String(filtroTipo)) return false;
        if (filtroLugar  && String(m.lgrId) !== String(filtroLugar)) return false;
        if (filtroCli) {
            const cli = clientes.find(c => String(c.id) === String(filtroCli));
            if (!cli) return false;
            // buscar por nombre de cliente en el campo cliente_nombre del machine
            if (!m.clienteNombre && !m.cliente_nombre) return false;
            const nomMaq = (m.clienteNombre || m.cliente_nombre || '').toLowerCase();
            if (!nomMaq.includes(cli.nombre.toLowerCase())) return false;
        }
        if (buscar) {
            const q = buscar.toLowerCase();
            if (!m.id?.toLowerCase().includes(q) && !m.location?.toLowerCase().includes(q) && !m.type?.toLowerCase().includes(q)) return false;
        }
        return true;
    });

    // Agrupar por cliente
    const grupos = filtradas.reduce((acc, m) => {
        const key = m.clienteNombre || m.cliente_nombre || '— Sin cliente asignado —';
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
    }, {});

    const seleccionadas = maquinas.filter(m => selec.has(m.id));

    if (loading) return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'4rem', color:'var(--text-muted)' }}>
            <Icon name="loader" size={28} className="animate-spin" />&nbsp; Cargando máquinas…
        </div>
    );

    return (
        <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>

            {/* ── Modal éxito ── */}
            {runCreado && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                    <div className="card p-6" style={{ maxWidth:400, width:'100%', textAlign:'center' }}>
                        <div style={{ width:56, height:56, borderRadius:'50%', background:'var(--success-light)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 1rem' }}>
                            <Icon name="check-circle" size={30} style={{ color:'var(--success)' }} />
                        </div>
                        <div style={{ fontWeight:800, fontSize:'1.1rem', marginBottom:6 }}>
                            {runCreado.recaudadorId ? '¡Tarea asignada!' : '¡Recorrido creado!'}
                        </div>
                        <div style={{ color:'var(--text-muted)', fontSize:'0.85rem', marginBottom: runCreado.recaudadorId ? '0.5rem' : '1.25rem' }}>
                            Se creó el recorrido <strong>#{runCreado.id}</strong> con <strong>{runCreado.stops?.length ?? 0} paradas</strong>.
                        </div>
                        {runCreado.recaudadorId && (
                            <div style={{ background:'var(--success-light)', border:'1px solid var(--success)', borderRadius:8, padding:'0.5rem 0.75rem', marginBottom:'1.25rem', display:'flex', alignItems:'center', gap:8, fontSize:'0.82rem', color:'var(--success)' }}>
                                <Icon name="user-check" size={14} style={{ flexShrink:0 }} />
                                <span>Asignado a <strong>{runCreado.recaudadorNombre}</strong> — recibirá la tarea como pendiente en su app.</span>
                            </div>
                        )}
                        <div style={{ display:'flex', gap:'0.6rem', justifyContent:'center' }}>
                            <button className="btn btn-secondary" onClick={() => setRunCreado(null)}>Cerrar</button>
                            <button className="btn" onClick={() => setRunCreado(null)}>Ver en Rutas</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Header */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'1rem' }}>
                <div>
                    <h2 style={{ fontWeight:800, fontSize:'1.25rem', marginBottom:4 }}>Asignación de Recorrido</h2>
                    <p style={{ color:'var(--text-muted)', fontSize:'0.85rem' }}>Seleccioná las máquinas que formarán parte del próximo recorrido de recaudación.</p>
                </div>
                <div style={{ display:'flex', gap:'0.6rem', alignItems:'center' }}>
                    {error && <span style={{ fontSize:'0.82rem', color:'var(--danger)', fontWeight:600 }}>{error}</span>}
                    <button className="btn btn-secondary btn-icon" onClick={cargar} title="Actualizar"><Icon name="refresh-cw" size={15} /></button>
                    <button
                        onClick={handleCrearRecorrido}
                        disabled={selec.size === 0 || creating}
                        style={{ display:'flex', alignItems:'center', gap:7, padding:'0.55rem 1.1rem', borderRadius:9, border:'none', background: selec.size > 0 ? 'var(--primary)' : '#d1d5db', color:'white', fontWeight:700, fontSize:'0.88rem', cursor: selec.size > 0 ? 'pointer' : 'not-allowed', transition:'all 0.15s' }}>
                        {creating ? <><Icon name="loader" size={15} className="animate-spin" /> Creando…</> : <><Icon name="route" size={15} /> Crear Recorrido {selec.size > 0 ? `(${selec.size})` : ''}</>}
                    </button>
                </div>
            </div>

            <div className="asignacion-grid">

                {/* ── Panel izquierdo: filtros + máquinas ── */}
                <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

                    {/* Filtros */}
                    <div className="card" style={{ padding:'0.85rem 1.1rem', display:'flex', gap:'0.6rem', flexWrap:'wrap', alignItems:'center' }}>
                        <Icon name="filter" size={15} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                        <input type="text" placeholder="Buscar ID, ubicación…" value={buscar} onChange={e => setBuscar(e.target.value)}
                            style={{ padding:'0.35rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem', width:170 }} />
                        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}
                            style={{ padding:'0.35rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem' }}>
                            <option value="">Todos los estados</option>
                            <option value="ok">Operativa</option>
                            <option value="mantenimiento">Mantenimiento</option>
                            <option value="fuera_servicio">Fuera de servicio</option>
                            <option value="baja">De baja</option>
                        </select>
                        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
                            style={{ padding:'0.35rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem' }}>
                            <option value="">Todos los tipos</option>
                            {tipos.map(t => <option key={t.id} value={t.id}>{t.description}</option>)}
                        </select>
                        <select value={filtroLugar} onChange={e => setFiltroLugar(e.target.value)}
                            style={{ padding:'0.35rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem' }}>
                            <option value="">Todas las ubicaciones</option>
                            {lugares.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <select value={filtroCli} onChange={e => setFiltroCli(e.target.value)}
                            style={{ padding:'0.35rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem' }}>
                            <option value="">Todos los clientes</option>
                            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        {(buscar || filtroStatus || filtroTipo || filtroLugar || filtroCli) && (
                            <button onClick={() => { setBuscar(''); setFiltroStatus(''); setFiltroTipo(''); setFiltroLugar(''); setFiltroCli(''); }}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:'0.78rem', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}>
                                <Icon name="x" size={12} /> Limpiar
                            </button>
                        )}
                        <span style={{ marginLeft:'auto', fontSize:'0.78rem', color:'var(--text-muted)' }}>{filtradas.length} máquina{filtradas.length !== 1 ? 's' : ''}</span>
                    </div>

                    {/* Lista agrupada por cliente */}
                    {filtradas.length === 0 ? (
                        <div className="card" style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>
                            <Icon name="search-x" size={40} style={{ marginBottom:8, opacity:0.4 }} />
                            <div style={{ fontWeight:600 }}>Sin máquinas que coincidan con los filtros</div>
                        </div>
                    ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.85rem' }}>
                            {Object.entries(grupos).map(([cliente, mqs]) => {
                                const ids = mqs.map(m => m.id);
                                const todosSelec = ids.every(id => selec.has(id));
                                return (
                                    <div key={cliente} className="card" style={{ overflow:'hidden' }}>
                                        {/* Cabecera del grupo */}
                                        <div style={{ padding:'0.65rem 1rem', background:'var(--bg-color)', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8 }}>
                                            <input type="checkbox" checked={todosSelec} onChange={() => toggleAll(ids)}
                                                style={{ width:15, height:15, accentColor:'var(--primary)', cursor:'pointer', flexShrink:0 }} />
                                            <Icon name="user" size={14} style={{ color:'var(--text-muted)' }} />
                                            <span style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--text)', flex:1 }}>{cliente}</span>
                                            <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', background:'var(--border)', borderRadius:999, padding:'1px 8px' }}>
                                                {mqs.length} máquina{mqs.length !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                        {/* Máquinas del grupo */}
                                        <div style={{ display:'flex', flexDirection:'column' }}>
                                            {mqs.map((m, i) => {
                                                const sel = selec.has(m.id);
                                                return (
                                                    <div key={m.id}
                                                        onClick={() => toggle(m.id)}
                                                        style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.7rem 1rem', cursor:'pointer', borderBottom: i < mqs.length - 1 ? '1px solid var(--border)' : 'none', background: sel ? 'var(--primary-light)' : 'var(--surface)', transition:'background 0.12s' }}
                                                        onMouseEnter={e => { if (!sel) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background = sel ? 'var(--primary-light)' : 'var(--surface)'; }}>
                                                        <input type="checkbox" checked={sel} onChange={() => toggle(m.id)} onClick={e => e.stopPropagation()}
                                                            style={{ width:15, height:15, accentColor:'var(--primary)', cursor:'pointer', flexShrink:0 }} />
                                                        {/* Estado dot */}
                                                        <div style={{ width:10, height:10, borderRadius:'50%', background: statusColor[m.status] || '#6b7280', flexShrink:0 }} title={statusLabel[m.status]} />
                                                        {/* Info */}
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap' }}>
                                                                <span style={{ fontWeight:700, fontSize:'0.88rem', color:'var(--text-main)' }}>{m.id}</span>
                                                                {m.type && <span style={{ fontSize:'0.68rem', background:'var(--primary-light)', color:'var(--primary)', borderRadius:4, padding:'1px 6px', fontWeight:700 }}>{m.type}</span>}
                                                                {m.status !== 'ok' && <span style={{ fontSize:'0.65rem', background: m.status === 'mantenimiento' ? 'var(--warning-light)' : 'var(--danger-light)', color: m.status === 'mantenimiento' ? 'var(--warning)' : 'var(--danger)', borderRadius:4, padding:'1px 6px', fontWeight:700 }}>{statusLabel[m.status]}</span>}
                                                            </div>
                                                            <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginTop:2, display:'flex', alignItems:'center', gap:5 }}>
                                                                <Icon name="map-pin" size={10} />
                                                                {m.location || '— Sin ubicación —'}
                                                            </div>
                                                        </div>
                                                        {/* Última recaudación */}
                                                        {m.lastRevenue && (
                                                            <div style={{ textAlign:'right', flexShrink:0 }}>
                                                                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>Última rec.</div>
                                                                <div style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--success)' }}>{m.lastRevenue}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* ── Panel derecho: resumen de selección ── */}
                <div style={{ position:'sticky', top:'1rem', display:'flex', flexDirection:'column', gap:'0.85rem' }}>
                    <div className="card" style={{ overflow:'hidden' }}>
                        <div style={{ padding:'0.75rem 1rem', background:'var(--primary)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                                <Icon name="list-checks" size={16} style={{ color:'white' }} />
                                <span style={{ fontWeight:700, fontSize:'0.88rem', color:'white' }}>Seleccionadas</span>
                            </div>
                            <span style={{ background:'rgba(255,255,255,0.25)', color:'white', borderRadius:999, fontSize:'0.78rem', fontWeight:800, padding:'1px 10px' }}>{selec.size}</span>
                        </div>
                        {selec.size === 0 ? (
                            <div style={{ padding:'1.5rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.82rem' }}>
                                <Icon name="mouse-pointer-click" size={26} style={{ marginBottom:6, opacity:0.4 }} />
                                <div>Hacé clic en las máquinas de la lista para agregarlas al recorrido.</div>
                            </div>
                        ) : (
                            <div style={{ maxHeight:320, overflowY:'auto' }}>
                                {seleccionadas.map(m => (
                                    <div key={m.id} style={{ display:'flex', alignItems:'center', gap:8, padding:'0.55rem 0.85rem', borderBottom:'1px solid var(--border)' }}>
                                        <div style={{ width:8, height:8, borderRadius:'50%', background: statusColor[m.status] || '#6b7280', flexShrink:0 }} />
                                        <div style={{ flex:1, minWidth:0 }}>
                                            <div style={{ fontWeight:700, fontSize:'0.8rem' }}>{m.id}</div>
                                            <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.location || '—'}</div>
                                        </div>
                                        <button onClick={() => toggle(m.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171', padding:2, display:'flex', flexShrink:0 }}>
                                            <Icon name="x" size={13} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Asignar recaudador */}
                        <div style={{ padding:'0.6rem 0.85rem', borderTop:'1px solid var(--border)' }}>
                            <div style={{ fontSize:'0.65rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:'0.4rem', display:'flex', alignItems:'center', gap:5 }}>
                                <Icon name="user-check" size={11} /> Asignar recaudador
                            </div>
                            <select value={recaudadorId} onChange={e => setRecaudadorId(e.target.value)}
                                style={{ width:'100%', padding:'0.4rem 0.55rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.8rem', background:'var(--bg-secondary)', color:'var(--text-main)', marginBottom:'0.5rem' }}>
                                <option value="">— Sin asignar (libre) —</option>
                                {recaudadores.map(r => (
                                    <option key={r.id} value={r.id}>{r.nombre}</option>
                                ))}
                            </select>
                            {recaudadorId && (
                                <div style={{ fontSize:'0.72rem', color:'var(--success)', background:'var(--success-light)', border:'1px solid var(--success)', borderRadius:6, padding:'3px 8px', marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:4 }}>
                                    <Icon name="bell" size={10} /> El recaudador recibirá la tarea como pendiente
                                </div>
                            )}
                        </div>
                        {selec.size > 0 && (
                            <div style={{ padding:'0.6rem 0.85rem', borderTop:'1px solid var(--border)', display:'flex', gap:'0.5rem' }}>
                                <button onClick={() => setSelec(new Set())} style={{ flex:1, padding:'0.4rem', borderRadius:7, border:'1px solid var(--border)', background:'var(--surface)', fontSize:'0.78rem', fontWeight:600, cursor:'pointer', color:'var(--text-muted)' }}>
                                    Limpiar
                                </button>
                                <button onClick={handleCrearRecorrido} disabled={creating}
                                    style={{ flex:2, padding:'0.4rem', borderRadius:7, border:'none', background:'var(--primary)', color:'white', fontSize:'0.78rem', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                                    {creating ? <><Icon name="loader" size={13} className="animate-spin" />Creando…</> : <><Icon name="route" size={13} />{recaudadorId ? 'Asignar' : 'Crear recorrido'}</>}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Stats rápidos */}
                    <div className="card" style={{ padding:'0.85rem 1rem' }}>
                        <div style={{ fontSize:'0.65rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'0.6rem' }}>Resumen general</div>
                        {[
                            { label:'Total máquinas', val: maquinas.length, icon:'cpu' },
                            { label:'Operativas', val: maquinas.filter(m => m.status === 'ok').length, icon:'check-circle', color:'var(--success)' },
                            { label:'En mantenimiento', val: maquinas.filter(m => m.status === 'mantenimiento').length, icon:'wrench', color:'var(--warning)' },
                            { label:'Fuera de servicio', val: maquinas.filter(m => m.status === 'fuera_servicio').length, icon:'x-circle', color:'#dc2626' },
                        ].map(({ label, val, icon, color }) => (
                            <div key={label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.3rem 0', borderBottom:'1px dashed var(--border)' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:'0.78rem', color:'var(--text-muted)' }}>
                                    <Icon name={icon} size={12} style={{ color: color || 'var(--text-muted)' }} /> {label}
                                </div>
                                <span style={{ fontWeight:700, fontSize:'0.85rem', color: color || 'var(--text)' }}>{val}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── RoutesPage ────────────────────────────────────────────────────────────────
const RoutesPage = () => {
    const [runs, setRuns]               = useState([]);
    const [loading, setLoading]         = useState(true);
    const [recaudadores, setRecaudadores] = useState([]);
    const [filtroUsuId, setFiltroUsuId] = useState('');
    const [filterFrom, setFilterFrom]   = useState('');
    const [filterTo, setFilterTo]       = useState('');

    // Load recaudadores (field agents) for the dropdown
    useEffect(() => {
        getUsuarios().then(list => {
            setRecaudadores(Array.isArray(list) ? list.filter(u => u.rol === 'terreno') : []);
        }).catch(() => {});
    }, []);

    const loadRuns = useCallback(async () => {
        setLoading(true);
        try {
            const params = {};
            if (filtroUsuId) params.usuId = filtroUsuId;
            const r = await getRouteRuns(params);
            setRuns(Array.isArray(r) ? r : []);
        } finally { setLoading(false); }
    }, [filtroUsuId]);

    useEffect(() => { loadRuns(); }, [loadRuns]);

    const clearFilters = () => { setFiltroUsuId(''); setFilterFrom(''); setFilterTo(''); };
    const hasFilters   = filtroUsuId || filterFrom || filterTo;

    // Client-side date filter on startedAt / createdAt
    const filtered = runs.filter(r => {
        const dateStr = (r.startedAt || r.createdAt || '').slice(0, 10);
        if (filterFrom && dateStr < filterFrom) return false;
        if (filterTo   && dateStr > filterTo)   return false;
        return true;
    });

    const pending   = filtered.filter(r => r.status === 'pending');
    const active    = filtered.filter(r => r.status === 'active');
    const completed = filtered.filter(r => r.status === 'completed');
    const finished  = filtered.filter(r => r.status !== 'active' && r.status !== 'pending');

    const statsRecaudado = completed.reduce((s, r) => s + (r.totalRecaudado || 0), 0);
    const statsDuracion  = completed.reduce((s, r) => s + (r.duration || 0), 0);
    const statsParadas   = completed.reduce((s, r) => s + (r.doneCount || 0), 0);

    return (
        <div className="animate-fade-in">
            {/* Header */}
            <div className="flex justify-between items-center mb-5">
                <div>
                    <h2 className="text-xl font-bold">Historial de Rutas</h2>
                    <p className="text-sm text-muted mt-1">Ejecuciones activas y finalizadas</p>
                </div>
            </div>

            {/* Filter bar */}
            <div className="card p-3 mb-4" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130 }}>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Desde</label>
                    <input
                        type="date"
                        value={filterFrom}
                        onChange={e => setFilterFrom(e.target.value)}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                    />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 130 }}>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Hasta</label>
                    <input
                        type="date"
                        value={filterTo}
                        onChange={e => setFilterTo(e.target.value)}
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                    />
                </div>
                {recaudadores.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 160 }}>
                        <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>Recaudador</label>
                        <select
                            value={filtroUsuId}
                            onChange={e => setFiltroUsuId(e.target.value)}
                            style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
                        >
                            <option value="">— Todos —</option>
                            {recaudadores.map(u => (
                                <option key={u.usu_id ?? u.id} value={u.usu_id ?? u.id}>{u.usu_nombre ?? u.nombre}</option>
                            ))}
                        </select>
                    </div>
                )}
                {hasFilters && (
                    <button
                        onClick={clearFilters}
                        style={{ fontSize: '0.78rem', padding: '0.3rem 0.8rem', borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', alignSelf: 'flex-end' }}
                    >
                        ✕ Limpiar
                    </button>
                )}
                <div style={{ marginLeft: 'auto', alignSelf: 'flex-end', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {filtered.length} de {runs.length} ruta{runs.length !== 1 ? 's' : ''}
                </div>
            </div>

            <>
                    {/* Aggregate stats for completed runs */}
                    {completed.length > 0 && (
                        <div className="routes-stats-grid">
                            {[
                                ['Rutas completadas', completed.length, null],
                                ['Total recaudado', fmtGs(statsRecaudado), '#10b981'],
                                ['Paradas visitadas', statsParadas, null],
                                ['Tiempo total', fmtDuration(statsDuracion), null],
                            ].map(([label, value, color]) => (
                                <div key={label} className="card p-3">
                                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
                                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: color ?? 'var(--text-primary)' }}>{value}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {loading ? (
                        <div className="card p-8 text-center text-muted">Cargando rutas...</div>
                    ) : filtered.length === 0 ? (
                        <div className="card p-8 flex flex-col items-center justify-center text-muted" style={{ minHeight: 200 }}>
                            <Icon name="map" size={48} className="mb-4" />
                            <p className="font-semibold">{runs.length === 0 ? 'No hay rutas registradas' : 'No hay rutas para los filtros aplicados'}</p>
                            <p className="text-sm mt-1">{runs.length === 0 ? 'Haz clic en "Nueva Ruta" para comenzar' : 'Probá con otro rango de fechas o recaudador'}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {pending.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold uppercase mb-3" style={{ letterSpacing: '0.05em', color: '#ea580c' }}>
                                        ⏳ Rutas Pendientes ({pending.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {pending.map(run => <RunCard key={run.id} run={run} onUpdate={loadRuns} />)}
                                    </div>
                                </div>
                            )}
                            {active.length > 0 && (
                                <div>
                                    <div className="text-xs font-semibold uppercase mb-3" style={{ letterSpacing: '0.05em', color: '#4f46e5' }}>
                                        🟢 Rutas Activas ({active.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {active.map(run => <RunCard key={run.id} run={run} onUpdate={loadRuns} />)}
                                    </div>
                                </div>
                            )}
                            {finished.length > 0 && (
                                <div>
                                    <div className="text-xs text-muted font-semibold uppercase mb-3" style={{ letterSpacing: '0.05em' }}>
                                        Rutas Finalizadas ({finished.length})
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {finished.map(run => <RunCard key={run.id} run={run} />)}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
            </>
        </div>
    );
};

// ─── Machine prefix lookup ────────────────────────────────────────────────────
const TYPE_PREFIX = { 1: 'MQR', 2: 'MQC', 3: 'MQP', 4: 'MQG' };

function generateMachineId(tmqId, existingMachines) {
    const prefix = TYPE_PREFIX[tmqId] ?? 'MQX';
    const nums = existingMachines
        .filter(m => m.id.startsWith(prefix + '-'))
        .map(m => parseInt(m.id.split('-')[1]) || 0);
    const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
    return `${prefix}-${String(next).padStart(3, '0')}`;
}

// ─── LocationPickerModal ──────────────────────────────────────────────────────
// Modal con mapa Leaflet donde el usuario clickea para fijar coordenadas.
const TUMBACO_CENTER = [-0.225, -78.397]; // centro por defecto: Tumbaco, Ecuador

function LocationPickerModal({ initial, lugarNombre, onConfirm, onCancel }) {
    const containerRef = useRef(null);
    const mapRef       = useRef(null);
    const markerRef    = useRef(null);
    const coordsRef    = useRef(initial || null); // siempre tiene el valor más reciente
    const [coords, setCoords] = useState(initial || null); // [lat, lng] | null

    // Actualiza tanto el ref (sincrónico) como el estado (para re-render)
    const updateCoords = (pos) => {
        coordsRef.current = pos;
        setCoords(pos);
    };

    useEffect(() => {
        if (mapRef.current) return;
        if (!containerRef.current) return;
        let destroyed = false;
        import('leaflet').then(({ default: L }) => {
            if (destroyed || !containerRef.current) return;
            const center = initial || TUMBACO_CENTER;
            const zoom   = initial ? 16 : 13;
            const map = L.map(containerRef.current).setView(center, zoom);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '© OpenStreetMap contributors',
            }).addTo(map);

            function placeMarker(latlng) {
                const pos = [latlng.lat, latlng.lng];
                if (markerRef.current) {
                    markerRef.current.setLatLng(pos);
                } else {
                    markerRef.current = L.marker(pos, { draggable: true }).addTo(map);
                    markerRef.current.on('dragend', e => {
                        const ll = e.target.getLatLng();
                        updateCoords([ll.lat, ll.lng]);
                    });
                }
                updateCoords(pos);
            }

            if (initial) placeMarker({ lat: initial[0], lng: initial[1] });
            map.on('click', e => placeMarker(e.latlng));
            mapRef.current = map;
        });

        return () => { destroyed = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; markerRef.current = null; } };
    }, []);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9500, display: 'flex', flexDirection: 'column', background: '#000' }}>
            {/* Header */}
            <div style={{ background: 'var(--surface)', padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', flexShrink: 0, gap: '1rem' }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        Seleccionar ubicación {lugarNombre ? `— ${lugarNombre}` : ''}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        {coords
                            ? `📍 ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}`
                            : 'Hacé click en el mapa para fijar la ubicación. Podés arrastrar el marcador para ajustar.'}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    <button className="btn" style={{ padding: '0.5rem 1rem' }} onClick={onCancel}>Cancelar</button>
                    <button
                        className="btn btn-primary" style={{ padding: '0.5rem 1rem', opacity: coords ? 1 : 0.45 }}
                        disabled={!coords}
                        onClick={() => { const c = coordsRef.current; if (c) onConfirm(c); }}
                    >
                        Confirmar ubicación
                    </button>
                </div>
            </div>
            {/* Mapa */}
            <div ref={containerRef} style={{ flex: 1 }} />
        </div>
    );
}

// ─── MachinesPage (create form) ───────────────────────────────────────────────
const MachinesPage = ({ machines, onMachineCreated, onBack }) => {
    const [tipos, setTipos] = useState([]);
    const [lugares, setLugares] = useState([]);
    const [saving, setSaving] = useState(false);
    const [showNewLugar, setShowNewLugar] = useState(false);

    // Form state
    const [form, setForm] = useState({
        tmqId: '',
        lgrId: '',
        proId: '',
        status: 'ok',
        fechaCreacion: new Date().toISOString().slice(0, 10),
        customId: '',       // vacío = usar el generado automáticamente
    });
    const [idManuallyEdited, setIdManuallyEdited] = useState(false);
    // New lugar inline form
    const [lugarForm, setLugarForm] = useState({ nombre: '', direccion: '', lat: '', lng: '' });
    // Map picker: null | 'new' | lugarId (editing existing)
    const [mapPickerTarget, setMapPickerTarget] = useState(null);

    const loadMeta = useCallback(async () => {
        const [t, l] = await Promise.all([getTipos(), getLugares()]);
        setTipos(t);
        setLugares(l);
        if (t.length > 0) setForm(f => f.tmqId ? f : { ...f, tmqId: String(t[0].id) });
        if (l.length > 0) setForm(f => f.lgrId ? f : { ...f, lgrId: String(l[0].id) });
    }, []);

    useEffect(() => { loadMeta(); }, [loadMeta]);

    const generatedId = form.tmqId ? generateMachineId(parseInt(form.tmqId), machines) : '';
    // Cuando cambia el tipo y el usuario NO editó manualmente el ID, sincronizar
    const effectiveId = (idManuallyEdited && form.customId.trim()) ? form.customId.trim() : generatedId;

    async function handleAddLugar() {
        if (!lugarForm.nombre.trim()) return;
        const created = await createLugar({
            nombre: lugarForm.nombre,
            direccion: lugarForm.direccion || null,
            lat: lugarForm.lat ? parseFloat(lugarForm.lat) : null,
            lng: lugarForm.lng ? parseFloat(lugarForm.lng) : null,
        });
        setLugares(prev => [...prev, created]);
        setForm(f => ({ ...f, lgrId: String(created.id) }));
        setLugarForm({ nombre: '', direccion: '', lat: '', lng: '' });
        setShowNewLugar(false);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!form.tmqId || !form.lgrId || !effectiveId) return;
        setSaving(true);
        try {
            await createMachine({
                id: effectiveId,
                tmqId: parseInt(form.tmqId),
                lgrId: parseInt(form.lgrId),
                proId: form.proId ? parseInt(form.proId) : undefined,
                status: form.status,
            });
            await onMachineCreated();
            onBack();
        } catch (err) {
            alert('Error al crear máquina: ' + err.message);
        } finally {
            setSaving(false);
        }
    }

    // Called when user confirms a location in the map picker
    async function handleMapConfirm([lat, lng]) {
        if (mapPickerTarget === 'new') {
            // Just update the inline form state
            setLugarForm(f => ({ ...f, lat: String(lat), lng: String(lng) }));
        } else {
            // Update an existing lugar via API
            const updated = await updateLugar(mapPickerTarget, { lat, lng });
            setLugares(prev => prev.map(l => l.id === updated.id ? updated : l));
        }
        setMapPickerTarget(null);
    }

    // Initial coords for the picker (if editing an existing lugar)
    const pickerInitial = (() => {
        if (!mapPickerTarget || mapPickerTarget === 'new') {
            if (lugarForm.lat && lugarForm.lng)
                return [parseFloat(lugarForm.lat), parseFloat(lugarForm.lng)];
            return null;
        }
        const l = lugares.find(x => x.id === mapPickerTarget);
        return l?.lat && l?.lng ? [l.lat, l.lng] : null;
    })();

    const pickerLugarNombre = mapPickerTarget === 'new'
        ? lugarForm.nombre
        : lugares.find(l => l.id === mapPickerTarget)?.nombre;

    if (mapPickerTarget !== null) {
        return (
            <LocationPickerModal
                initial={pickerInitial}
                lugarNombre={pickerLugarNombre}
                onConfirm={handleMapConfirm}
                onCancel={() => setMapPickerTarget(null)}
            />
        );
    }

    return (
        <div className="animate-fade-in max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-6 cursor-pointer text-muted hover:text-primary transition-colors"
                onClick={onBack}>
                <Icon name="arrow-left" size={20} />
                <span className="font-semibold text-sm">Volver al Inventario</span>
            </div>

            <div className="card p-8">
                    <div className="border-b pb-4 mb-6">
                        <h3 className="text-xl font-bold flex items-center gap-2">
                            <Icon name="joystick" className="text-primary" /> Nueva Máquina
                        </h3>
                        <p className="text-sm text-muted mt-1">El ID se genera automáticamente según el tipo seleccionado.</p>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {/* ID de máquina — editable */}
                        <div className="card mb-6 p-4" style={{ background: 'var(--bg-color)', border: '1px dashed var(--border)' }}>
                            <label className="text-xs font-bold text-muted mb-2 block" style={{ letterSpacing: '1px', textTransform: 'uppercase' }}>
                                ID de Máquina
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <input
                                    className="input"
                                    style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.5px', flex: 1 }}
                                    value={idManuallyEdited ? form.customId : generatedId}
                                    placeholder={generatedId || 'Selecciona un tipo primero…'}
                                    onChange={e => {
                                        setIdManuallyEdited(true);
                                        setForm(f => ({ ...f, customId: e.target.value }));
                                    }}
                                />
                                {idManuallyEdited && (
                                    <button type="button" className="btn btn-secondary" style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}
                                        onClick={() => { setIdManuallyEdited(false); setForm(f => ({ ...f, customId: '' })); }}
                                        title="Restaurar ID automático">
                                        <Icon name="refresh-cw" size={13} /> Auto
                                    </button>
                                )}
                            </div>
                            {!idManuallyEdited && generatedId && (
                                <div className="text-xs text-muted mt-1">
                                    Generado automáticamente según el tipo · edita el campo para personalizar
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Tipo */}
                            <div className="input-group">
                                <label className="label">Tipo de Máquina <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <select className="input" required value={form.tmqId}
                                    onChange={e => {
                                        setForm(f => ({ ...f, tmqId: e.target.value }));
                                        if (!idManuallyEdited) {} // noop — auto-ID recalculates from generatedId
                                    }}>
                                    <option value="">Seleccionar tipo...</option>
                                    {tipos.map(t => <option key={t.id} value={t.id}>{t.desc}</option>)}
                                </select>
                            </div>

                            {/* Estado */}
                            <div className="input-group">
                                <label className="label">Estado Operativo</label>
                                <select className="input" value={form.status}
                                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                                    <option value="ok">Operativa (OK)</option>
                                    <option value="warning">Requiere Mantención (Aviso)</option>
                                </select>
                            </div>

                            {/* Fecha de creación */}
                            <div className="input-group">
                                <label className="label">Fecha de Alta</label>
                                <input type="date" className="input" value={form.fechaCreacion}
                                    onChange={e => setForm(f => ({ ...f, fechaCreacion: e.target.value }))} />
                            </div>

                            {/* Producto (opcional) */}
                            <div className="input-group">
                                <label className="label">Producto <span className="text-muted text-xs">(opcional)</span></label>
                                <input className="input" placeholder="ID de producto" value={form.proId}
                                    onChange={e => setForm(f => ({ ...f, proId: e.target.value }))} />
                            </div>

                            {/* Lugar */}
                            <div className="input-group md:col-span-2">
                                <label className="label">Ubicación <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <select className="input" required value={form.lgrId}
                                        onChange={e => setForm(f => ({ ...f, lgrId: e.target.value }))}>
                                        <option value="">Seleccionar lugar...</option>
                                        {lugares.map(l => (
                                            <option key={l.id} value={l.id}>
                                                {l.nombre}{l.direccion ? ` — ${l.direccion}` : ''}
                                                {l.lat && l.lng ? ' 📍' : ' (sin coords)'}
                                            </option>
                                        ))}
                                    </select>
                                    {/* Edit coords of selected lugar */}
                                    {form.lgrId && (
                                        <button type="button" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}
                                            title="Fijar coordenadas en el mapa"
                                            onClick={() => setMapPickerTarget(Number(form.lgrId))}>
                                            <Icon name="map-pin" size={14} /> Coordenadas
                                        </button>
                                    )}
                                    <button type="button" className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}
                                        onClick={() => setShowNewLugar(v => !v)}>
                                        <Icon name="plus" size={14} /> Nuevo lugar
                                    </button>
                                </div>
                            </div>

                            {/* Inline new lugar */}
                            {showNewLugar && (
                                <div className="md:col-span-2">
                                    <div className="card p-4" style={{ background: 'var(--bg-color)', border: '1px solid var(--border)' }}>
                                        <div className="text-sm font-semibold mb-3">Agregar nuevo lugar</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="input-group">
                                                <label className="label">Nombre <span style={{ color: 'var(--danger)' }}>*</span></label>
                                                <input className="input" placeholder="Ej: Supermercado ABC" value={lugarForm.nombre}
                                                    onChange={e => setLugarForm(f => ({ ...f, nombre: e.target.value }))} />
                                            </div>
                                            <div className="input-group">
                                                <label className="label">Dirección</label>
                                                <input className="input" placeholder="Ej: Av. Principal 123" value={lugarForm.direccion}
                                                    onChange={e => setLugarForm(f => ({ ...f, direccion: e.target.value }))} />
                                            </div>
                                            <div className="input-group md:col-span-2">
                                                <label className="label">Ubicación en el mapa</label>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <button type="button" className="btn btn-secondary"
                                                        onClick={() => setMapPickerTarget('new')}>
                                                        <Icon name="map-pin" size={14} />
                                                        {lugarForm.lat && lugarForm.lng ? 'Cambiar en mapa' : 'Seleccionar en mapa'}
                                                    </button>
                                                    {lugarForm.lat && lugarForm.lng && (
                                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                                            📍 {parseFloat(lugarForm.lat).toFixed(5)}, {parseFloat(lugarForm.lng).toFixed(5)}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex justify-end gap-2 mt-3">
                                            <button type="button" className="btn btn-secondary" onClick={() => setShowNewLugar(false)}>Cancelar</button>
                                            <button type="button" className="btn btn-primary" onClick={handleAddLugar}>
                                                <Icon name="save" size={14} /> Guardar lugar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 mt-8 pt-6 border-t">
                            <button type="button" className="btn btn-secondary" onClick={onBack}>
                                Cancelar
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                <Icon name="save" size={16} /> {saving ? 'Guardando...' : 'Crear Máquina'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        );
};

// ─── helpers ────────────────────────────────────────────────────────────────
function slugify(str) {
    return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// ─── CampoForm — form to add or edit a campo ─────────────────────────────────
const EMPTY_CAMPO = { key: '', label: '', grupo: 'General', tipo: 'number', requerido: false, readonly: false, formula: '', ancho: 2, usaUltimoRegistro: false, opciones: [] };
const TIPOS_INPUT = [
  { value: 'number',   label: 'Número' },
  { value: 'text',     label: 'Texto corto' },
  { value: 'textarea', label: 'Texto largo' },
  { value: 'checkbox', label: 'Casilla (Sí/No)' },
  { value: 'select',   label: 'Lista de opciones' },
  { value: 'date',     label: 'Fecha' },
  { value: 'constant', label: 'Constante (valor fijo)' },
];

function CampoForm({ initial, existingGrupos, allCampos = [], onSave, onCancel }) {
    const [f, setF] = useState(initial ?? EMPTY_CAMPO);
    const [keyLocked, setKeyLocked] = useState(!!initial?.id); // lock key for existing campos
    const formulaInputRef = useRef(null);

    function handleLabel(e) {
        const label = e.target.value;
        setF(prev => ({ ...prev, label, key: keyLocked ? prev.key : slugify(label) }));
    }

    function insertAtCursor(text) {
        const input = formulaInputRef.current;
        if (!input) { setF(p => ({ ...p, formula: p.formula + text })); return; }
        const start = input.selectionStart ?? input.value.length;
        const end   = input.selectionEnd   ?? input.value.length;
        const newFormula = f.formula.slice(0, start) + text + f.formula.slice(end);
        setF(p => ({ ...p, formula: newFormula }));
        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(start + text.length, start + text.length);
        });
    }

    // Campos available as references in formulas (exclude self)
    const refCampos     = allCampos.filter(c => c.key && c.key !== f.key);
    const prevRefCampos = refCampos.filter(c => c.tipo !== 'constant');

    const grupoOptions = [...new Set(['General', 'Contadores', 'Premios', 'Monto', ...existingGrupos])];

    return (
        <div className="p-4" style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="input-group">
                    <label className="label">Etiqueta <span style={{ color: 'var(--danger)' }}>*</span></label>
                    <input className="input" placeholder="Ej: Contador Digital" value={f.label} onChange={handleLabel} />
                </div>
                <div className="input-group">
                    <label className="label">
                        Clave (key) <span style={{ color: 'var(--danger)' }}>*</span>
                        {!keyLocked && <span className="text-xs text-muted ml-1">(auto, editable)</span>}
                        {keyLocked && <span className="text-xs text-muted ml-1">(no editable)</span>}
                    </label>
                    <input className="input" placeholder="cont_digital" value={f.key}
                        readOnly={keyLocked}
                        style={{ background: keyLocked ? 'var(--bg-color)' : undefined }}
                        onChange={e => !keyLocked && setF(p => ({ ...p, key: slugify(e.target.value) }))} />
                </div>
                <div className="input-group">
                    <label className="label">Grupo</label>
                    <input className="input" list="grupos-list" placeholder="Contadores" value={f.grupo}
                        onChange={e => setF(p => ({ ...p, grupo: e.target.value }))} />
                    <datalist id="grupos-list">
                        {grupoOptions.map(g => <option key={g} value={g} />)}
                    </datalist>
                </div>
                <div className="input-group">
                    <label className="label">Tipo de campo</label>
                    <select className="input" value={f.tipo} onChange={e => {
                        const t = e.target.value;
                        setF(p => ({
                            ...p, tipo: t,
                            opciones: t === 'select' ? p.opciones : [],
                            readonly: t === 'constant' ? true : p.readonly,
                            requerido: t === 'constant' ? false : p.requerido,
                            usaUltimoRegistro: t === 'constant' ? false : p.usaUltimoRegistro,
                            formula: t === 'constant' ? (p.formula || '0') : p.formula,
                        }));
                    }}>
                        {TIPOS_INPUT.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                </div>
                {f.tipo !== 'constant' && (
                    <div className="input-group">
                        <label className="label">Ancho en formulario</label>
                        <select className="input" value={f.ancho} onChange={e => setF(p => ({ ...p, ancho: parseInt(e.target.value) }))}>
                            <option value={1}>Ancho completo</option>
                            <option value={2}>Medio ancho</option>
                        </select>
                    </div>
                )}
                {f.tipo !== 'constant' && (
                    <div className="flex flex-col gap-2 justify-center">
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input type="checkbox" checked={f.requerido} onChange={e => setF(p => ({ ...p, requerido: e.target.checked }))} />
                            Campo obligatorio
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                            <input type="checkbox" checked={f.readonly} onChange={e => setF(p => ({ ...p, readonly: e.target.checked, usaUltimoRegistro: e.target.checked ? false : p.usaUltimoRegistro }))} />
                            Solo lectura (calculado por fórmula)
                        </label>
                        {!f.readonly && (
                            <label className="flex items-center gap-2 cursor-pointer text-sm" title="Al abrir el formulario de recaudación, este campo se pre-cargará con el valor del último registro de esa máquina">
                                <input type="checkbox" checked={f.usaUltimoRegistro} onChange={e => setF(p => ({ ...p, usaUltimoRegistro: e.target.checked }))} />
                                Pre-cargar desde último registro
                            </label>
                        )}
                    </div>
                )}
                {f.tipo === 'constant' && (
                    <div className="input-group md:col-span-2">
                        <label className="label">Valor de la constante</label>
                        <input type="number" className="input" placeholder="Ej: 500" value={f.formula}
                            onChange={e => setF(p => ({ ...p, formula: e.target.value }))} />
                        <span className="text-xs text-muted mt-1">Este valor estará disponible como <code>{`{${f.key || 'clave'}}`}</code> en las fórmulas de otros campos. No aparece en el formulario.</span>
                    </div>
                )}
                {f.tipo !== 'constant' && f.readonly && (
                    <div className="input-group md:col-span-2">
                        <label className="label">Fórmula</label>
                        <input
                            ref={formulaInputRef}
                            className="input"
                            placeholder="Ej: {cont_salida} - {cont_entrada}"
                            value={f.formula}
                            onChange={e => setF(p => ({ ...p, formula: e.target.value }))}
                            style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}
                        />
                        {/* ── Formula builder chips ── */}
                        <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {/* Operators */}
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: '7rem', flexShrink: 0 }}>Operadores</span>
                                {['+', '-', '*', '/', '(', ')'].map(op => (
                                    <button key={op} type="button" onClick={() => insertAtCursor(op)}
                                        style={{ padding: '0.15rem 0.5rem', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.4 }}>
                                        {op}
                                    </button>
                                ))}
                            </div>
                            {/* Este registro */}
                            {refCampos.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: '7rem', flexShrink: 0 }}>Este registro</span>
                                    {refCampos.map(c => (
                                        <button key={c.key} type="button" onClick={() => insertAtCursor(`{${c.key}}`)}
                                            title={c.label}
                                            style={{ padding: '0.15rem 0.5rem', borderRadius: 10, border: '1px solid rgba(79,70,229,0.3)', background: 'rgba(79,70,229,0.07)', color: '#4338ca', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                                            {c.key}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Último registro */}
                            {prevRefCampos.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', width: '7rem', flexShrink: 0 }}>Último registro</span>
                                    {prevRefCampos.map(c => (
                                        <button key={c.key} type="button" onClick={() => insertAtCursor(`{prev:${c.key}}`)}
                                            title={`Valor de "${c.label}" del último registro guardado`}
                                            style={{ padding: '0.15rem 0.5rem', borderRadius: 10, border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.07)', color: '#047857', cursor: 'pointer', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                                            ult:{c.key}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <span className="text-xs text-muted mt-1">
                            Hacé click en los chips para insertar. <span style={{ color: '#4338ca' }}><code>{'{clave}'}</code></span> = valor ingresado ahora, <span style={{ color: '#047857' }}><code>{'ult:clave'}</code></span> = valor del último registro guardado.
                        </span>
                    </div>
                )}
                {f.tipo === 'select' && (
                    <div className="input-group md:col-span-2">
                        <label className="label">Opciones de la lista <span style={{ color: 'var(--danger)' }}>*</span></label>
                        <textarea className="input" rows={3}
                            placeholder="Una opción por línea. Ej:&#10;Opción A&#10;Opción B&#10;Opción C"
                            value={(f.opciones ?? []).join('\n')}
                            onChange={e => setF(p => ({ ...p, opciones: e.target.value.split('\n').map(s => s.trimEnd()).filter(Boolean) }))}
                            style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                        />
                        <span className="text-xs text-muted mt-1">Una opción por línea.</span>
                    </div>
                )}
            </div>
            <div className="flex justify-end gap-2 mt-3">
                <button className="btn btn-secondary" onClick={onCancel}>Cancelar</button>
                <button className="btn btn-primary" disabled={!f.key || !f.label} onClick={() => onSave(f)}>
                    <Icon name="save" size={14} /> Guardar campo
                </button>
            </div>
        </div>
    );
}

// ─── TipoRow — expandable tipo card with campo management ─────────────────────
function TipoRow({ tipo, onTipoUpdated, onTipoDeleted }) {
    const [expanded, setExpanded] = useState(false);
    const [editingTipoName, setEditingTipoName] = useState(false);
    const [newName, setNewName] = useState(tipo.desc);
    const [addingCampo, setAddingCampo] = useState(false);
    const [editingCampo, setEditingCampo] = useState(null);
    const [campos, setCampos] = useState(tipo.campos ?? []);

    useEffect(() => { setCampos(tipo.campos ?? []); }, [tipo.campos]);

    const existingGrupos = [...new Set(campos.map(c => c.grupo))];

    async function handleRenameTipo() {
        if (!newName.trim() || newName === tipo.desc) { setEditingTipoName(false); return; }
        await updateTipo(tipo.id, { desc: newName });
        setEditingTipoName(false);
        onTipoUpdated();
    }

    async function handleDeleteTipo() {
        if (!window.confirm(`¿Eliminar tipo "${tipo.desc}"? Esta acción no se puede deshacer.`)) return;
        try { await deleteTipo(tipo.id); onTipoDeleted(); }
        catch (err) { alert(err.message); }
    }

    async function handleAddCampo(f) {
        await createCampo(tipo.id, f);
        setAddingCampo(false);
        onTipoUpdated();
    }

    async function handleUpdateCampo(campoId, f) {
        await updateCampo(tipo.id, campoId, f);
        setEditingCampo(null);
        onTipoUpdated();
    }

    async function handleDeleteCampo(campoId) {
        await deleteCampo(tipo.id, campoId);
        onTipoUpdated();
    }

    async function handleMove(idx, dir) {
        const reordered = [...campos];
        const swap = idx + dir;
        if (swap < 0 || swap >= reordered.length) return;
        [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
        const order = reordered.map((c, i) => ({ id: c.id, orden: i + 1 }));
        setCampos(reordered);
        await reorderCampos(tipo.id, order);
        onTipoUpdated();
    }

    const groups = [...new Set(campos.map(c => c.grupo))];

    return (
        <div className="card mb-3" style={{ overflow: 'hidden' }}>
            {/* Tipo header */}
            <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                {editingTipoName ? (
                    <div className="flex items-center gap-2 flex-1">
                        <input className="input" style={{ maxWidth: 220 }} value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleRenameTipo()} />
                        <button className="btn btn-primary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={handleRenameTipo}>OK</button>
                        <button className="btn btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.78rem' }} onClick={() => { setEditingTipoName(false); setNewName(tipo.desc); }}>✕</button>
                    </div>
                ) : (
                    <div className="flex-1">
                        <span className="font-semibold">{tipo.desc}</span>
                        <span className="text-xs text-muted ml-2">{campos.length} campo{campos.length !== 1 ? 's' : ''}</span>
                    </div>
                )}
                {!editingTipoName && (
                    <div className="flex gap-1">
                        <button className="btn btn-secondary btn-icon" title="Renombrar" onClick={() => setEditingTipoName(true)}>
                            <Icon name="edit" size={14} />
                        </button>
                        <button className="btn btn-secondary btn-icon" title="Expandir campos"
                            style={{ color: expanded ? 'var(--primary)' : undefined }}
                            onClick={() => setExpanded(v => !v)}>
                            <Icon name={expanded ? 'chevron-up' : 'list'} size={14} />
                        </button>
                        <button className="btn btn-secondary btn-icon" title="Eliminar tipo" style={{ color: 'var(--danger)' }} onClick={handleDeleteTipo}>
                            <Icon name="trash-2" size={14} />
                        </button>
                    </div>
                )}
            </div>

            {/* Campos panel */}
            {expanded && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '1rem', background: 'var(--bg-color)' }}>
                    {groups.map(grupo => (
                        <div key={grupo} style={{ marginBottom: '1rem' }}>
                            <div className="text-xs font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.05em' }}>{grupo}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                                {campos.filter(c => c.grupo === grupo).map((c, relIdx) => {
                                    const absIdx = campos.indexOf(c);
                                    return editingCampo?.id === c.id ? (
                                        <CampoForm key={c.id} initial={editingCampo} existingGrupos={existingGrupos} allCampos={campos}
                                            onSave={f => handleUpdateCampo(c.id, f)}
                                            onCancel={() => setEditingCampo(null)} />
                                    ) : (
                                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--surface)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.6rem', border: '1px solid var(--border)' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <span className="font-medium text-sm">{c.label}</span>
                                                <span className="text-xs text-muted ml-2 font-mono">{c.key}</span>
                                                <span className="text-xs text-muted ml-1">· {c.tipo}</span>
                                                {c.requerido && <span className="badge badge-primary ml-1" style={{ fontSize: '0.6rem' }}>req</span>}
                                                {c.tipo === 'constant' && <span className="badge ml-1" style={{ fontSize: '0.6rem', background: 'rgba(99,102,241,0.1)', color: '#4338ca', border: '1px solid rgba(99,102,241,0.3)' }}>= {c.formula}</span>}
                                                {c.readonly && c.tipo !== 'constant' && <span className="badge ml-1" style={{ fontSize: '0.6rem', background: 'rgba(245,158,11,0.1)', color: '#b45309', border: '1px solid rgba(245,158,11,0.3)' }}>fórmula</span>}
                                                {c.ancho === 1 && <span className="text-xs text-muted ml-1">· completo</span>}
                                            </div>
                                            <div className="flex gap-1 flex-shrink-0">
                                                <button className="btn btn-secondary btn-icon" style={{ padding: '0.2rem' }} title="Subir" onClick={() => handleMove(absIdx, -1)} disabled={absIdx === 0}><Icon name="chevron-up" size={12} /></button>
                                                <button className="btn btn-secondary btn-icon" style={{ padding: '0.2rem' }} title="Bajar" onClick={() => handleMove(absIdx, 1)} disabled={absIdx === campos.length - 1}><Icon name="chevron-down" size={12} /></button>
                                                <button className="btn btn-secondary btn-icon" style={{ padding: '0.2rem' }} title="Editar" onClick={() => setEditingCampo({ ...c })}><Icon name="edit" size={12} /></button>
                                                <button className="btn btn-secondary btn-icon" style={{ padding: '0.2rem', color: 'var(--danger)' }} title="Eliminar" onClick={() => handleDeleteCampo(c.id)}><Icon name="trash-2" size={12} /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* Add campo form */}
                    {addingCampo ? (
                        <CampoForm existingGrupos={existingGrupos} allCampos={campos}
                            onSave={handleAddCampo}
                            onCancel={() => setAddingCampo(false)} />
                    ) : (
                        <button className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => setAddingCampo(true)}>
                            <Icon name="plus" size={14} /> Añadir campo
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── ConfigPanel ─────────────────────────────────────────────────────────────
const ConfigPanel = ({ onMachineTypesChanged }) => {
    const [tipos, setTipos]           = useState([]);
    const [addingTipo, setAddingTipo] = useState(false);
    const [newTipoDesc, setNewTipoDesc] = useState('');

    const load = useCallback(async () => {
        setTipos(await getTipos());
    }, []);

    useEffect(() => { load(); }, [load]);

    async function handleCreateTipo() {
        if (!newTipoDesc.trim()) return;
        await createTipo({ desc: newTipoDesc });
        setNewTipoDesc('');
        setAddingTipo(false);
        await load();
        onMachineTypesChanged?.();
    }

    async function handleTipoUpdated() {
        await load();
        onMachineTypesChanged?.();
    }

    return (
        <div className="animate-fade-in" style={{ maxWidth: 820 }}>
            {/* Tipos de máquina */}
            <div className="card">
                <div className="p-4 border-b flex justify-between items-center">
                    <div>
                        <h3 className="font-semibold text-lg flex items-center gap-2">
                            <Icon name="joystick" size={18} className="text-primary" /> Tipos de Máquina
                        </h3>
                        <p className="text-xs text-muted mt-1">Definí los campos del formulario de recaudación para cada tipo. Expande un tipo para gestionar sus campos.</p>
                    </div>
                    {!addingTipo && (
                        <button className="btn btn-primary" onClick={() => setAddingTipo(true)}>
                            <Icon name="plus" size={16} /> Nuevo Tipo
                        </button>
                    )}
                </div>

                {addingTipo && (
                    <div className="p-4 border-b" style={{ background: 'var(--bg-color)' }}>
                        <div className="text-sm font-semibold mb-2">Nuevo tipo de máquina</div>
                        <div className="flex gap-2 items-center">
                            <input className="input" placeholder="Ej: Grúa Premium" value={newTipoDesc}
                                onChange={e => setNewTipoDesc(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleCreateTipo()} />
                            <button className="btn btn-primary" disabled={!newTipoDesc.trim()} onClick={handleCreateTipo}>
                                <Icon name="save" size={14} /> Crear
                            </button>
                            <button className="btn btn-secondary" onClick={() => { setAddingTipo(false); setNewTipoDesc(''); }}>
                                Cancelar
                            </button>
                        </div>
                        <p className="text-xs text-muted mt-2">Después de crear el tipo, expándelo para añadir sus campos de recaudación.</p>
                    </div>
                )}

                <div className="p-4">
                    {tipos.length === 0 ? (
                        <div className="text-muted text-sm text-center py-4">No hay tipos configurados.</div>
                    ) : (
                        tipos.map(t => (
                            <TipoRow key={t.id} tipo={t}
                                onTipoUpdated={handleTipoUpdated}
                                onTipoDeleted={handleTipoUpdated} />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── ProductosPage ────────────────────────────────────────────────────────────
const TIPO_ICONOS = { Maquina:'🎰', Electronico:'⚡', Otro:'📦' };
const tipoIcon = (nombre) => TIPO_ICONOS[nombre] || '📦';

const ProductosPage = ({ readOnly = false, initialBuscar = '', onBuscarUsed }) => {
    const [items, setItems]           = useState([]);
    const [tiposCat, setTiposCat]     = useState([]);
    const [tipomaquinas, setTipomaquinas] = useState([]);
    const [loading, setLoading]       = useState(true);
    const [editing, setEditing]       = useState(null);
    const [form, setForm]             = useState({ nombre:'', item_cat_id:'', item_tmq_id:'', precio:'', descrip:'', vigente:1, stock:'0' });
    const [imageFile, setImageFile]   = useState(null);
    const [imagePreview, setImagePreview] = useState('');
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState('');
    const [filtro, setFiltro]         = useState('todos');
    const [buscar, setBuscar]         = useState('');
    const [filtroEstado, setFiltroEstado] = useState('activo');
    const [precioMin, setPrecioMin]   = useState('');
    const [precioMax, setPrecioMax]   = useState('');
    const [ordenar, setOrdenar]       = useState('nombre');
    // Gestión de tipos
    const [gestionTipos, setGestionTipos] = useState(false);
    const [editTipoId, setEditTipoId]     = useState(null);
    const [editTipoNombre, setEditTipoNombre] = useState('');
    const [nuevoTipo, setNuevoTipo]       = useState('');
    const [savingTipo, setSavingTipo]     = useState(false);
    // Solicitud de reposición (cajero)
    const [solicitandoItem, setSolicitandoItem] = useState(null);
    const [solicitudMsg, setSolicitudMsg]       = useState('');
    const [solicitudEnviando, setSolicitudEnviando] = useState(false);
    const [solicitudOk, setSolicitudOk]         = useState(null); // id del item cuya solicitud se envió

    const refresh = useCallback(async () => {
        setLoading(true);
        const [data, tipos, tmqs] = await Promise.all([
            getCatalogo({ todos: true }),
            getItemTiposCat(),
            getTipomaquinas(),
        ]);
        setItems(data);
        setTiposCat(tipos);
        setTipomaquinas(tmqs);
        setLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Cuando llegamos desde el panel de notificaciones con un producto pre-buscado
    useEffect(() => {
        if (initialBuscar) {
            setBuscar(initialBuscar);
            onBuscarUsed && onBuscarUsed();
        }
    }, [initialBuscar]); // eslint-disable-line react-hooks/exhaustive-deps

    const tipoSeleccionado = tiposCat.find(t => String(t.itc_id) === String(form.item_cat_id));
    const esMaquina = tipoSeleccionado?.itc_nombre === 'Maquina';

    const openNew = () => {
        setForm({ nombre:'', item_cat_id:'', item_tmq_id:'', precio:'', descrip:'', vigente:1, stock:'0' });
        setImageFile(null); setImagePreview(''); setEditing('new'); setError('');
    };
    const openEdit = (item) => {
        setForm({ nombre: item.item_nombre, item_cat_id: String(item.item_cat_id || ''), item_tmq_id: String(item.item_tmq_id || ''), precio: String(item.item_precio), descrip: item.item_descrip || '', vigente: item.item_vigente ?? 1, stock: String(item.item_stock ?? 0) });
        setImageFile(null); setImagePreview(item.item_imagen || ''); setEditing(item); setError('');
    };

    const handleSave = async (e) => {
        e.preventDefault(); setError('');
        if (!form.nombre.trim() || form.precio === '') { setError('Nombre y precio son requeridos.'); return; }
        if (isNaN(form.precio) || Number(form.precio) < 0) { setError('El precio debe ser un número válido.'); return; }
        setSaving(true);
        try {
            const data = {
                nombre: form.nombre, precio: Number(form.precio), descrip: form.descrip,
                vigente: form.vigente, stock: Number(form.stock) || 0,
                item_cat_id: form.item_cat_id ? Number(form.item_cat_id) : null,
                item_tmq_id: esMaquina && form.item_tmq_id ? Number(form.item_tmq_id) : null,
            };
            let saved;
            if (editing === 'new') saved = await createCatalogoItem(data);
            else { await updateCatalogoItem(editing.item_id, data); saved = { item_id: editing.item_id }; }
            if (imageFile) await uploadCatalogoImagen(saved.item_id, imageFile);
            setEditing(null); setImageFile(null); setImagePreview('');
            await refresh();
        } catch { setError('Error al guardar.'); }
        finally { setSaving(false); }
    };

    const handleToggle = async (item) => {
        await updateCatalogoItem(item.item_id, { vigente: item.item_vigente ? 0 : 1 });
        await refresh();
    };
    const handleDelete = async (item) => {
        if (!confirm(`¿Eliminar "${item.item_nombre}"?`)) return;
        await deleteCatalogoItem(item.item_id); await refresh();
    };

    // ── Gestión de tipos ───────────────────────────────────────────────────────
    const handleAddTipo = async () => {
        if (!nuevoTipo.trim()) return;
        setSavingTipo(true);
        try { await createItemTipoCat(nuevoTipo.trim()); setNuevoTipo(''); await refresh(); }
        catch (e) { alert(e.message || 'Error al crear tipo'); }
        finally { setSavingTipo(false); }
    };
    const handleSaveTipo = async (id) => {
        if (!editTipoNombre.trim()) return;
        setSavingTipo(true);
        try { await updateItemTipoCat(id, editTipoNombre.trim()); setEditTipoId(null); await refresh(); }
        catch (e) { alert(e.message || 'Error al guardar'); }
        finally { setSavingTipo(false); }
    };
    const handleDeleteTipo = async (t) => {
        if (!confirm(`¿Eliminar el tipo "${t.itc_nombre}"?`)) return;
        setSavingTipo(true);
        try { await deleteItemTipoCat(t.itc_id); await refresh(); }
        catch (e) { alert(e.message || 'Error al eliminar'); }
        finally { setSavingTipo(false); }
    };

    // ── Filtrado ───────────────────────────────────────────────────────────────
    const q = buscar.toLowerCase().trim();
    const pMin = precioMin !== '' ? Number(precioMin) : null;
    const pMax = precioMax !== '' ? Number(precioMax) : null;
    const filtered = items
        .filter(i => filtro === 'todos' || String(i.item_cat_id) === filtro)
        .filter(i => filtroEstado === 'todos' || (filtroEstado === 'activo' ? i.item_vigente : !i.item_vigente))
        .filter(i => !q || i.item_nombre.toLowerCase().includes(q) || (i.item_descrip || '').toLowerCase().includes(q))
        .filter(i => pMin === null || Number(i.item_precio) >= pMin)
        .filter(i => pMax === null || Number(i.item_precio) <= pMax)
        .sort((a, b) => {
            if (ordenar === 'precio-asc')  return Number(a.item_precio) - Number(b.item_precio);
            if (ordenar === 'precio-desc') return Number(b.item_precio) - Number(a.item_precio);
            return a.item_nombre.localeCompare(b.item_nombre);
        });
    const hayFiltrosActivos = q || filtroEstado !== 'activo' || precioMin !== '' || precioMax !== '' || filtro !== 'todos';
    const highlight = (text) => {
        if (!q || !text) return text;
        const idx = text.toLowerCase().indexOf(q);
        if (idx === -1) return text;
        return <>{text.slice(0, idx)}<mark style={{ background:'#fef08a', borderRadius:2, padding:'0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
    };

    return (
        <div className="animate-fade-in">

            {/* ── Modal gestión de tipos ── */}
            {gestionTipos && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9100, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
                    <div style={{ background:'var(--surface)', borderRadius:16, padding:'2rem', width:'100%', maxWidth:380, maxHeight:'85vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.25rem' }}>
                            <h3 style={{ fontWeight:700, fontSize:'1.05rem' }}>Gestionar tipos de producto</h3>
                            <button onClick={() => { setGestionTipos(false); setEditTipoId(null); }} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.2rem', color:'#555' }}>✕</button>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem', marginBottom:'1.25rem' }}>
                            {tiposCat.map(t => (
                                <div key={t.itc_id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.5rem 0.75rem', borderRadius:9, border:'1px solid var(--border)', background:'var(--bg-color)' }}>
                                    {editTipoId === t.itc_id ? (
                                        <>
                                            <input autoFocus value={editTipoNombre} onChange={e => setEditTipoNombre(e.target.value)}
                                                onKeyDown={e => { if (e.key==='Enter') handleSaveTipo(t.itc_id); if (e.key==='Escape') setEditTipoId(null); }}
                                                style={{ flex:1, padding:'0.3rem 0.5rem', borderRadius:6, border:'1.5px solid var(--primary)', fontSize:'0.85rem' }} />
                                            <button onClick={() => handleSaveTipo(t.itc_id)} disabled={savingTipo}
                                                style={{ padding:'0.3rem 0.6rem', borderRadius:6, border:'none', background:'var(--primary)', color:'white', fontWeight:700, cursor:'pointer', fontSize:'0.8rem' }}>
                                                <Icon name="check" size={13} />
                                            </button>
                                            <button onClick={() => setEditTipoId(null)} style={{ padding:'0.3rem 0.5rem', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontSize:'0.8rem' }}>
                                                <Icon name="x" size={13} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <span style={{ flex:1, fontWeight:600, fontSize:'0.88rem' }}>{tipoIcon(t.itc_nombre)} {t.itc_nombre}</span>
                                            <button onClick={() => { setEditTipoId(t.itc_id); setEditTipoNombre(t.itc_nombre); }}
                                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:4, display:'flex' }}>
                                                <Icon name="pencil" size={14} />
                                            </button>
                                            <button onClick={() => handleDeleteTipo(t)} disabled={savingTipo}
                                                style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171', padding:4, display:'flex' }}>
                                                <Icon name="trash-2" size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div style={{ borderTop:'1px solid var(--border)', paddingTop:'1rem' }}>
                            <label style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text-muted)', display:'block', marginBottom:'0.4rem' }}>Agregar nuevo tipo</label>
                            <div style={{ display:'flex', gap:'0.5rem' }}>
                                <input value={nuevoTipo} onChange={e => setNuevoTipo(e.target.value)}
                                    onKeyDown={e => e.key==='Enter' && handleAddTipo()}
                                    placeholder="Ej: Hidráulico, Refrigeración..." className="input" style={{ flex:1 }} />
                                <button onClick={handleAddTipo} disabled={savingTipo || !nuevoTipo.trim()}
                                    className="btn btn-primary" style={{ flexShrink:0 }}>
                                    <Icon name="plus" size={15} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            , document.body)}

            {/* ── Modal crear / editar ítem ── */}
            {editing !== null && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:9000, display:'flex', alignItems:'flex-end', justifyContent:'center', padding:'0' }}
                    className="modal-productos-overlay">
                    <div style={{ background:'var(--surface)', borderRadius:'16px 16px 0 0', padding:'1.5rem 1.5rem 2rem', width:'100%', maxWidth:480, maxHeight:'92dvh', overflowY:'auto', boxShadow:'0 -4px 40px rgba(0,0,0,0.2)' }}
                        onClick={e => e.stopPropagation()}>
                    <style>{`@media (min-width: 769px) { .modal-productos-overlay { align-items: center !important; padding: 1rem !important; } .modal-productos-overlay > div { border-radius: 16px !important; max-height: 90vh; } }`}</style>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem' }}>
                            <h3 style={{ fontWeight:700, fontSize:'1.1rem' }}>{editing === 'new' ? 'Nuevo ítem' : 'Editar ítem'}</h3>
                            <button onClick={() => setEditing(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:'1.2rem', color:'#555' }}>✕</button>
                        </div>
                        <form onSubmit={handleSave} className="flex flex-col gap-4">
                            <div className="input-group mb-0">
                                <label className="label">Nombre</label>
                                <input className="input" value={form.nombre} onChange={e => setForm(f => ({...f, nombre: e.target.value}))} placeholder="Ej: Fruit King" required />
                            </div>

                            {/* Tipo de producto */}
                            <div className="input-group mb-0">
                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.4rem' }}>
                                    <label className="label" style={{ margin:0 }}>Tipo de producto</label>
                                    <button type="button" onClick={() => setGestionTipos(true)}
                                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', fontSize:'0.75rem', fontWeight:600, display:'flex', alignItems:'center', gap:4 }}>
                                        <Icon name="settings" size={13} /> Gestionar tipos
                                    </button>
                                </div>
                                <select className="input" value={form.item_cat_id}
                                    onChange={e => setForm(f => ({...f, item_cat_id: e.target.value, item_tmq_id: ''}))}>
                                    <option value="">— Sin tipo —</option>
                                    {tiposCat.map(t => (
                                        <option key={t.itc_id} value={t.itc_id}>{tipoIcon(t.itc_nombre)} {t.itc_nombre}</option>
                                    ))}
                                </select>
                                {!form.item_cat_id && (
                                    <div style={{ marginTop:'0.3rem', fontSize:'0.73rem', color:'var(--warning)', display:'flex', alignItems:'center', gap:4 }}>
                                        <Icon name="alert-triangle" size={12} /> Sin categoría: este producto aparecerá en "General" en las mantenciones de campo. Asigná <strong>Electrónico</strong> u <strong>Otro</strong> si es un repuesto.
                                    </div>
                                )}
                            </div>

                            {/* Subtipo de máquina (solo si tipo es Maquina) */}
                            {esMaquina && (
                                <div className="input-group mb-0">
                                    <label className="label">Tipo de máquina</label>
                                    <select className="input" value={form.item_tmq_id}
                                        onChange={e => setForm(f => ({...f, item_tmq_id: e.target.value}))}>
                                        <option value="">— Sin especificar —</option>
                                        {tipomaquinas.map(tm => (
                                            <option key={tm.tmq_id} value={tm.tmq_id}>{tm.tmq_desc}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="input-group mb-0">
                                <label className="label">Precio unitario (Gs.)</label>
                                <input className="input" type="number" min="0" step="1" value={form.precio} onChange={e => setForm(f => ({...f, precio: e.target.value}))} placeholder="0" required />
                            </div>
                            <div className="input-group mb-0">
                                <label className="label">Existencias (unidades en stock)</label>
                                <input className="input" type="number" min="0" step="1" value={form.stock} onChange={e => setForm(f => ({...f, stock: e.target.value}))} placeholder="0" />
                            </div>
                            <div className="input-group mb-0">
                                <label className="label">Descripción <span className="text-muted" style={{fontWeight:400}}>(opcional)</span></label>
                                <input className="input" value={form.descrip} onChange={e => setForm(f => ({...f, descrip: e.target.value}))} placeholder="Descripción breve..." />
                            </div>

                            {/* Foto */}
                            <div className="input-group mb-0">
                                <label className="label">Foto <span className="text-muted" style={{fontWeight:400}}>(opcional)</span></label>
                                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                                    {imagePreview ? (
                                        <div style={{ position:'relative', flexShrink:0 }}>
                                            <img src={imagePreview} alt="preview" style={{ width:72, height:72, objectFit:'cover', borderRadius:10, border:'2px solid var(--border)' }} />
                                            <button type="button" onClick={() => { setImageFile(null); setImagePreview(''); }}
                                                style={{ position:'absolute', top:-6, right:-6, width:20, height:20, borderRadius:'50%', background:'var(--danger)', color:'#fff', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:800 }}>✕</button>
                                        </div>
                                    ) : (
                                        <div style={{ width:72, height:72, borderRadius:10, border:'2px dashed var(--border)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-muted)', flexShrink:0 }}>
                                            <Icon name="image" size={24} />
                                        </div>
                                    )}
                                    <div style={{ flex:1 }}>
                                        <label style={{ display:'inline-flex', alignItems:'center', gap:6, padding:'0.45rem 0.9rem', borderRadius:8, border:'1.5px solid var(--border)', cursor:'pointer', fontSize:'0.82rem', fontWeight:600, color:'var(--text)', background:'var(--bg-color)' }}>
                                            <Icon name="upload" size={14} />
                                            {imagePreview ? 'Cambiar foto' : 'Subir foto'}
                                            <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => {
                                                const file = e.target.files?.[0]; if (!file) return;
                                                setImageFile(file);
                                                const reader = new FileReader();
                                                reader.onload = ev => setImagePreview(ev.target.result);
                                                reader.readAsDataURL(file);
                                            }} />
                                        </label>
                                        <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:4 }}>JPG, PNG o WEBP · máx. 5 MB</div>
                                    </div>
                                </div>
                            </div>

                            {/* Activo / Inactivo */}
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.65rem 0.85rem', borderRadius:10, border:`1.5px solid ${form.vigente ? 'var(--success)' : 'var(--border)'}`, background: form.vigente ? '#f0fdf4' : 'var(--bg-color)', transition:'all 0.2s' }}>
                                <div>
                                    <div style={{ fontWeight:700, fontSize:'0.88rem', color: form.vigente ? 'var(--success)' : 'var(--text-muted)' }}>{form.vigente ? '✅ Activo' : '⛔ Inactivo'}</div>
                                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:1 }}>{form.vigente ? 'Visible en catálogo y caja' : 'No aparece en catálogo ni caja'}</div>
                                </div>
                                <button type="button" onClick={() => setForm(f => ({...f, vigente: f.vigente ? 0 : 1}))}
                                    style={{ background:'none', border:'none', cursor:'pointer', padding:4, color: form.vigente ? 'var(--success)' : 'var(--text-muted)' }}>
                                    <Icon name={form.vigente ? 'toggle-right' : 'toggle-left'} size={36} />
                                </button>
                            </div>

                            {error && <div className="bg-danger-light text-danger p-2 rounded-md text-xs font-medium">{error}</div>}
                            <div style={{ display:'flex', gap:'0.75rem', marginTop:'0.5rem' }}>
                                <button type="submit" className="btn btn-primary" style={{ flex:1 }} disabled={saving}>
                                    <Icon name={saving ? 'loader' : 'save'} size={16} /> {saving ? 'Guardando...' : 'Guardar'}
                                </button>
                                <button type="button" className="btn btn-secondary" style={{ flex:1 }} onClick={() => setEditing(null)}>Cancelar</button>
                            </div>
                        </form>
                    </div>
                </div>
            , document.body)}

            {/* ── Toolbar ── */}
            <div className="card" style={{ padding:'1rem 1.25rem', marginBottom:'1rem', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap' }}>
                    <div style={{ flex:1, minWidth:200, position:'relative' }}>
                        <Icon name="search" size={15} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                        <input className="input" placeholder="Buscar por nombre o descripción..."
                            value={buscar} onChange={e => setBuscar(e.target.value)}
                            style={{ paddingLeft:32, paddingRight: buscar ? 32 : undefined }} />
                        {buscar && (
                            <button onClick={() => setBuscar('')} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}>
                                <Icon name="x-circle" size={15} />
                            </button>
                        )}
                    </div>
                    {hayFiltrosActivos && (
                        <button onClick={() => { setBuscar(''); setFiltro('todos'); setFiltroEstado('activo'); setPrecioMin(''); setPrecioMax(''); setOrdenar('nombre'); }}
                            className="btn btn-secondary" style={{ fontSize:'0.82rem', flexShrink:0, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="x" size={14} /> Limpiar filtros
                        </button>
                    )}
                    {!readOnly && (
                        <button className="btn btn-primary" onClick={openNew} style={{ flexShrink:0 }}>
                            <Icon name="plus" size={16} /> Nuevo ítem
                        </button>
                    )}
                </div>

                <div style={{ display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center' }}>
                    {/* Filtro por tipo (dinámico) */}
                    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center', flexWrap:'wrap' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Tipo:</span>
                        <button onClick={() => setFiltro('todos')}
                            className={`btn ${filtro === 'todos' ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ fontSize:'0.78rem', padding:'0.35rem 0.75rem', display:'flex', alignItems:'center', gap:'0.3rem' }}>
                            Todos
                            <span style={{ background: filtro==='todos' ? 'rgba(255,255,255,0.25)' : 'var(--border)', borderRadius:10, padding:'0 5px', fontSize:'0.7rem', fontWeight:700 }}>{items.length}</span>
                        </button>
                        {tiposCat.map(t => {
                            const count = items.filter(i => String(i.item_cat_id) === String(t.itc_id)).length;
                            return (
                                <button key={t.itc_id} onClick={() => setFiltro(String(t.itc_id))}
                                    className={`btn ${filtro === String(t.itc_id) ? 'btn-primary' : 'btn-secondary'}`}
                                    style={{ fontSize:'0.78rem', padding:'0.35rem 0.75rem', display:'flex', alignItems:'center', gap:'0.3rem' }}>
                                    {tipoIcon(t.itc_nombre)} {t.itc_nombre}
                                    <span style={{ background: filtro===String(t.itc_id) ? 'rgba(255,255,255,0.25)' : 'var(--border)', borderRadius:10, padding:'0 5px', fontSize:'0.7rem', fontWeight:700 }}>{count}</span>
                                </button>
                            );
                        })}
                        {!readOnly && (
                            <button onClick={() => setGestionTipos(true)} title="Gestionar tipos"
                                style={{ padding:'0.35rem 0.5rem', borderRadius:7, border:'1px dashed var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', display:'flex', alignItems:'center', gap:4, fontSize:'0.75rem' }}>
                                <Icon name="settings" size={13} /> Gestionar
                            </button>
                        )}
                    </div>

                    <div style={{ width:1, height:24, background:'var(--border)' }} />

                    {/* Estado */}
                    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Estado:</span>
                        {[{v:'activo',l:'✅ Activos'},{v:'inactivo',l:'⛔ Inactivos'},{v:'todos',l:'Todos'}].map(f => (
                            <button key={f.v} onClick={() => setFiltroEstado(f.v)}
                                style={{ padding:'0.35rem 0.75rem', borderRadius:999, border:`1.5px solid ${filtroEstado===f.v ? 'var(--primary)' : 'var(--border)'}`, background: filtroEstado===f.v ? 'var(--primary-light)' : 'white', color: filtroEstado===f.v ? 'var(--primary)' : 'var(--text-muted)', fontSize:'0.78rem', fontWeight:600, cursor:'pointer' }}>
                                {f.l}
                            </button>
                        ))}
                    </div>

                    <div style={{ width:1, height:24, background:'var(--border)' }} />

                    {/* Precio */}
                    <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Precio:</span>
                        <input type="number" min={0} placeholder="Desde" value={precioMin} onChange={e => setPrecioMin(e.target.value)}
                            className="input" style={{ width:90, padding:'0.35rem 0.6rem', fontSize:'0.82rem' }} />
                        <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>—</span>
                        <input type="number" min={0} placeholder="Hasta" value={precioMax} onChange={e => setPrecioMax(e.target.value)}
                            className="input" style={{ width:90, padding:'0.35rem 0.6rem', fontSize:'0.82rem' }} />
                    </div>

                    <div style={{ width:1, height:24, background:'var(--border)' }} />

                    {/* Ordenar */}
                    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center' }}>
                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:600, whiteSpace:'nowrap' }}>Ordenar:</span>
                        <select value={ordenar} onChange={e => setOrdenar(e.target.value)}
                            className="input" style={{ padding:'0.35rem 0.6rem', fontSize:'0.82rem', width:'auto', cursor:'pointer' }}>
                            <option value="nombre">Nombre A–Z</option>
                            <option value="precio-asc">Precio ↑</option>
                            <option value="precio-desc">Precio ↓</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* ── Alerta de stock bajo ── */}
            {(() => {
                const sinStock  = items.filter(i => i.item_vigente && (i.item_stock ?? 0) === 0 && i.item_tipo !== 'servicio');
                const stockBajo = items.filter(i => i.item_vigente && (i.item_stock ?? 0) > 0 && (i.item_stock ?? 0) <= 5 && i.item_tipo !== 'servicio');
                if (sinStock.length === 0 && stockBajo.length === 0) return null;
                return (
                    <div style={{ marginBottom:'1rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                        {sinStock.length > 0 && (
                            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:10, padding:'0.7rem 1rem' }}>
                                <Icon name="alert-circle" size={18} style={{ color:'var(--danger)', flexShrink:0 }} />
                                <div style={{ flex:1 }}>
                                    <span style={{ fontWeight:700, color:'var(--danger)', fontSize:'0.85rem' }}>Sin stock: </span>
                                    <span style={{ fontSize:'0.82rem', color:'#7f1d1d' }}>
                                        {sinStock.map(i => i.item_nombre).join(', ')}
                                    </span>
                                </div>
                                <span style={{ fontSize:'0.78rem', fontWeight:800, color:'var(--danger)', background:'var(--danger-light)', borderRadius:999, padding:'2px 10px', flexShrink:0 }}>
                                    {sinStock.length} ítem{sinStock.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                        )}
                        {stockBajo.length > 0 && (
                            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:10, padding:'0.7rem 1rem' }}>
                                <Icon name="alert-triangle" size={18} style={{ color:'#f59e0b', flexShrink:0 }} />
                                <div style={{ flex:1 }}>
                                    <span style={{ fontWeight:700, color:'var(--warning)', fontSize:'0.85rem' }}>Stock bajo (≤5 u.): </span>
                                    <span style={{ fontSize:'0.82rem', color:'#78350f' }}>
                                        {stockBajo.map(i => `${i.item_nombre} (${i.item_stock})`).join(', ')}
                                    </span>
                                </div>
                                <span style={{ fontSize:'0.78rem', fontWeight:800, color:'#f59e0b', background:'var(--warning-light)', borderRadius:999, padding:'2px 10px', flexShrink:0 }}>
                                    {stockBajo.length} ítem{stockBajo.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* ── Tabla ── */}
            <div className="card">
                <div className="p-4 border-b flex justify-between items-center">
                    <h3 className="font-semibold text-lg">Catálogo de Productos</h3>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                        {q && <span className="text-xs text-muted">"{buscar}" —</span>}
                        <span className="badge badge-primary">{filtered.length} ítem{filtered.length !== 1 ? 's' : ''}</span>
                    </div>
                </div>
                {loading ? (
                    <div className="p-8 text-center text-muted">Cargando...</div>
                ) : filtered.length === 0 ? (
                    <div className="p-8 text-center text-muted">
                        <Icon name={q ? 'search-x' : 'package'} size={40} className="mb-2" />
                        <div>{q ? `Sin resultados para "${buscar}"` : 'Sin ítems registrados'}</div>
                        {q ? (
                            <button className="btn btn-secondary mt-3" onClick={() => setBuscar('')}><Icon name="x" size={14} /> Limpiar búsqueda</button>
                        ) : !readOnly ? (
                            <button className="btn btn-primary mt-4" onClick={openNew}><Icon name="plus" size={16} /> Agregar primero</button>
                        ) : null}
                    </div>
                ) : (
                    <div className="productos-card-grid" style={{ padding:'1rem' }}>
                        {filtered.map(item => {
                            const s = item.item_stock ?? 0;
                            const stockColor = s === 0 ? '#ef4444' : s <= 5 ? '#f59e0b' : '#16a34a';
                            const stockBg    = s === 0 ? '#fef2f2' : s <= 5 ? '#fffbeb' : '#f0fdf4';
                            const descripcion = item.item_descrip || item.tipo_cat_nombre || '';
                            // Resaltar cuando el admin llega desde una solicitud de reposición
                            const esDestacado = q && item.item_nombre.toLowerCase() === q;
                            return (
                                <div key={item.item_id} className="producto-card" style={{ opacity: item.item_vigente ? 1 : 0.5, ...(esDestacado ? { outline: '2.5px solid #f59e0b', boxShadow: '0 0 0 4px rgba(245,158,11,0.18)' } : {}) }}>
                                    {/* Imagen */}
                                    <div className="producto-card-img">
                                        {item.item_imagen
                                            ? <img src={item.item_imagen} alt={item.item_nombre} />
                                            : <span>{item.tipo_cat_nombre ? tipoIcon(item.tipo_cat_nombre) : '📦'}</span>
                                        }
                                    </div>
                                    {/* Info */}
                                    <div className="producto-card-body">
                                        <div className="producto-card-nombre">{item.item_nombre}</div>
                                        {!item.item_cat_id && !readOnly && (
                                            <div style={{ display:'inline-flex', alignItems:'center', gap:3, fontSize:'0.65rem', fontWeight:700, color:'var(--warning)', background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.35)', borderRadius:4, padding:'0.05rem 0.35rem', marginBottom:'0.2rem' }}>
                                                <Icon name="alert-triangle" size={9} /> Sin categoría
                                            </div>
                                        )}
                                        <div className="producto-card-precio-row">
                                            <span className="producto-card-precio">
                                                ${Number(item.item_precio).toLocaleString('es-CL')}
                                            </span>
                                            <span className="producto-card-stock" style={{ background:stockBg, color:stockColor }}>
                                                {s === 0 && <Icon name="alert-circle" size={9} />}
                                                {s}{item.item_tipo === 'servicio' ? 'u.' : 'u.'}
                                            </span>
                                        </div>
                                        {descripcion && (
                                            <div className="producto-card-desc">{descripcion}</div>
                                        )}
                                    </div>
                                    {/* Acciones (solo admin/superadmin) */}
                                    {!readOnly && (
                                        <div className="producto-card-actions">
                                            <button className="btn btn-secondary btn-icon" onClick={() => openEdit(item)} title="Editar">
                                                <Icon name="edit-2" size={13} />
                                            </button>
                                            <button className="btn btn-secondary btn-icon" onClick={() => handleToggle(item)} title={item.item_vigente ? 'Desactivar' : 'Activar'}
                                                style={{ color: item.item_vigente ? 'var(--success)' : 'var(--text-muted)' }}>
                                                <Icon name="refresh-cw" size={13} />
                                            </button>
                                            <button className="btn btn-secondary btn-icon" onClick={() => handleDelete(item)} title="Eliminar"
                                                style={{ color:'var(--danger)' }}>
                                                <Icon name="trash-2" size={13} />
                                            </button>
                                        </div>
                                    )}
                                    {/* Botón reposición para cajero (readOnly) */}
                                    {readOnly && item.item_tipo !== 'servicio' && (item.item_stock ?? 0) <= 5 && (
                                        <div className="producto-card-actions">
                                            {solicitudOk === item.item_id ? (
                                                <span style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--success)', padding:'0.25rem 0.5rem' }}>Solicitud enviada</span>
                                            ) : (
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ fontSize:'0.72rem', padding:'0.25rem 0.6rem', color: (item.item_stock ?? 0) === 0 ? '#dc2626' : '#d97706', borderColor: (item.item_stock ?? 0) === 0 ? '#fca5a5' : '#fcd34d', fontWeight:700 }}
                                                    onClick={() => { setSolicitandoItem(item); setSolicitudMsg(''); }}
                                                    title="Notificar al administrador que se necesita reponer este producto"
                                                >
                                                    <Icon name="bell" size={11} /> Solicitar reposicion
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Modal solicitud de reposición */}
            {solicitandoItem && createPortal(
            <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                <div className="card p-6" style={{ maxWidth:400, width:'100%' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
                        <div style={{ width:42, height:42, borderRadius:'50%', background:'#fffbeb', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, border:'1.5px solid #fcd34d' }}>
                            <Icon name="bell" size={20} style={{ color:'var(--warning)' }} />
                        </div>
                        <div>
                            <div className="font-semibold" style={{ fontSize:'1rem' }}>Solicitar reposicion</div>
                            <div className="text-sm text-muted" style={{ fontSize:'0.8rem' }}>{solicitandoItem.item_nombre}</div>
                        </div>
                    </div>
                    <div style={{ background:'#fef9ef', border:'1px solid #fcd34d', borderRadius:8, padding:'0.6rem 0.9rem', marginBottom:'1rem', fontSize:'0.82rem', color:'var(--warning)', fontWeight:500 }}>
                        <strong>Stock actual: {solicitandoItem.item_stock ?? 0} u.</strong><br />
                        Se notificara al administrador para que reponga este producto.
                    </div>
                    <label className="form-label" style={{ fontWeight:700, fontSize:'0.82rem' }}>Mensaje adicional (opcional)</label>
                    <textarea
                        className="input"
                        rows={3}
                        placeholder="Ej: Se necesitan urgente para mañana..."
                        value={solicitudMsg}
                        onChange={e => setSolicitudMsg(e.target.value)}
                        style={{ resize:'vertical', marginBottom:'1rem', fontSize:'0.85rem' }}
                    />
                    <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                        <button className="btn btn-secondary" onClick={() => setSolicitandoItem(null)} disabled={solicitudEnviando}>
                            Cancelar
                        </button>
                        <button
                            className="btn btn-primary"
                            disabled={solicitudEnviando}
                            onClick={async () => {
                                setSolicitudEnviando(true);
                                try {
                                    await createSolicitud(solicitandoItem.item_id, solicitandoItem.item_nombre, solicitudMsg.trim() || undefined);
                                    setSolicitudOk(solicitandoItem.item_id);
                                    setSolicitandoItem(null);
                                    setSolicitudMsg('');
                                } catch(e) {
                                    alert(e.message || 'Error al enviar la solicitud');
                                } finally {
                                    setSolicitudEnviando(false);
                                }
                            }}
                        >
                            {solicitudEnviando ? 'Enviando...' : 'Enviar solicitud'}
                        </button>
                    </div>
                </div>
            </div>,
            document.body
        )}
        </div>
    );
};

// ─── CajaPage ─────────────────────────────────────────────────────────────────
const METODOS_PAGO = [
    { id: 'efectivo',      label: 'Efectivo',      icon: '💵' },
    { id: 'tarjeta',       label: 'Tarjeta',        icon: '💳' },
    { id: 'transferencia', label: 'Transferencia',  icon: '🏦' },
];

const CajaPage = ({ userRol }) => {
    const [movimientos, setMovimientos] = useState([]);
    const [balance, setBalance] = useState({ total_ingresos: 0, total_egresos: 0, total_reembolsos: 0, balance: 0 });
    const [catalogo, setCatalogo] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tipo, setTipo] = useState('ingreso');
    const [concepto, setConcepto] = useState('');
    const [monto, setMonto] = useState('');
    const [metodoPago, setMetodoPago] = useState('efectivo');
    const [tarjUltimos4, setTarjUltimos4] = useState('');
    const [tarjTipo, setTarjTipo] = useState('debito');
    const [transReferencia, setTransReferencia] = useState('');
    const [transBanco, setTransBanco] = useState('');
    const [dividirPago, setDividirPago] = useState(false);
    const PAGO_VACIO = () => ({ id: Date.now() + Math.random(), metodo: 'efectivo', monto: '', tarjUltimos4: '', tarjTipo: 'debito', transReferencia: '', transBanco: '' });
    const [pagosDiv, setPagosDiv] = useState([PAGO_VACIO(), PAGO_VACIO()]);
    const [clienteSeleccionado, setClienteSeleccionado] = useState(null); // { id, nombre, tipo }
    const [showClientePicker, setShowClientePicker] = useState(false);   // picker panel de clientes
    const [clientePickerBuscar, setClientePickerBuscar] = useState('');
    const [clientePickerTipo, setClientePickerTipo] = useState('todos');
    const clientePickerRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showPicker, setShowPicker] = useState(false);
    const [pickerTab, setPickerTab] = useState('producto');
    const [pickerBuscar, setPickerBuscar] = useState('');
    const [pickerCart, setPickerCart] = useState([]); // [{ item, cantidad }]
    const [cartSummary, setCartSummary] = useState([]); // resumen confirmado del carrito
    const [pickerStockWarn, setPickerStockWarn] = useState('');
    const [reembolsando, setReembolsando] = useState(null); // id del movimiento a reembolsar
    const [movDetalle, setMovDetalle] = useState(null); // movimiento seleccionado para ver detalle
    const [pagina, setPagina] = useState(1);
    const MOV_POR_PAGINA = 4;
    const catalogoRef = useRef(null);
    // Panel de clientes en caja
    const [cajaClientes, setCajaClientes] = useState([]);
    const [cajaCliLoading, setCajaCliLoading] = useState(false);
    const [cajaModalCli, setCajaModalCli] = useState(false);
    const [cajaFormCli, setCajaFormCli] = useState({ nombre:'', tipo:'persona', rucCi:'', email:'', telefono:'', direccion:'', contacto:'', notas:'', lat:null, lng:null });
    const [cajaSavingCli, setCajaSavingCli] = useState(false);
    const [cajaErrorCli, setCajaErrorCli] = useState('');
    const [cajaMapPickerCli, setCajaMapPickerCli] = useState(false);
    // ── Selector de cliente por máquina (cascada en picker) ─────────────────
    const [cliPickerModo, setCliPickerModo]       = useState('clientes'); // 'clientes' | 'maquina'
    const [maqPickerMaquinas, setMaqPickerMaquinas] = useState([]);
    const [maqPickerCargando, setMaqPickerCargando] = useState(false);
    const [maqPickerBusqueda, setMaqPickerBusqueda] = useState('');

    // ── Selector de cajero (solo admin/superadmin) ──────────────────────────
    const esSupervisor = ['admin','superadmin'].includes(userRol);
    const [filtroCajero, setFiltroCajero] = useState(null); // null = mi caja | { id, nombre } = ver otro
    const [listaCajeros, setListaCajeros] = useState([]);

    useEffect(() => {
        if (!esSupervisor) return;
        getUsuarios().then(us => setListaCajeros(
            (us || []).filter(u => ['caja','terreno','admin','superadmin'].includes(u.rol))
        )).catch(() => {});
    }, [esSupervisor]);

    // ── Cierre de caja ──────────────────────────────────────────────────────
    const [cierreHoy, setCierreHoy] = useState(null);          // objeto sesión (null | {cierre_status:'abierta'|'cerrada',...})
    const [showCierreModal, setShowCierreModal] = useState(false);
    const [cierreNotas, setCierreNotas] = useState('');
    const [savingCierre, setSavingCierre] = useState(false);
    const [cierreError, setCierreError] = useState('');
    const [recuentoEfectivo, setRecuentoEfectivo] = useState('');
    // ── Apertura de caja ────────────────────────────────────────────────────
    const [showAperturaModal, setShowAperturaModal] = useState(false);
    const [aperturaEfectivo, setAperturaEfectivo] = useState('');
    const [aperturaNotas, setAperturaNotas] = useState('');
    const [savingApertura, setSavingApertura] = useState(false);
    const [aperturaError, setAperturaError] = useState('');
    const hoyFecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
    // Estado derivado de la sesión de hoy
    const cajaStatus = cierreHoy ? (cierreHoy.cierre_status || 'cerrada') : null;
    // null → sin sesión | 'abierta' → operando | 'cerrada' → cerrada

    const refresh = useCallback(async () => {
        setLoading(true);
        const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
        const movParams  = { from: fecha, to: fecha };
        const balOpts    = {};
        const cierreUsuId = filtroCajero?.id ?? null;
        if (filtroCajero) {
            // Admin viendo la caja de otro usuario
            movParams.usuId = filtroCajero.id;
            balOpts.usuId   = filtroCajero.id;
        } else {
            // Vista propia
            movParams.own = true;
            balOpts.own   = true;
        }
        const [movs, bal, cat, cierre] = await Promise.all([
            getCajaMovimientos(movParams),
            getCajaBalance(fecha, balOpts),
            getCatalogo(),
            getCajaCierre(fecha, cierreUsuId).catch(() => null),
        ]);
        setMovimientos(movs);
        setBalance(bal);
        setCatalogo(cat);
        setCierreHoy(cierre);
        setLoading(false);
        setPagina(1);
    }, [filtroCajero]);

    useEffect(() => { refresh(); }, [refresh]);

    // Cargar clientes cuando el picker está abierto o cambia la búsqueda/filtro
    useEffect(() => {
        if (!showClientePicker) return;
        setCajaCliLoading(true);
        const tipo = clientePickerTipo === 'todos' ? '' : clientePickerTipo;
        getClientesData({ buscar: clientePickerBuscar, tipo, activo: true })
            .then(data => setCajaClientes(data))
            .catch(() => {})
            .finally(() => setCajaCliLoading(false));
    }, [showClientePicker, clientePickerBuscar, clientePickerTipo]);

    // Cargar máquinas cuando se activa el modo 'maquina' del picker
    useEffect(() => {
        if (cliPickerModo !== 'maquina' || !showClientePicker) return;
        if (maqPickerMaquinas.length > 0) return; // ya cargadas
        setMaqPickerCargando(true);
        getMachines().then(ms => setMaqPickerMaquinas(ms)).catch(() => {}).finally(() => setMaqPickerCargando(false));
    }, [cliPickerModo, showClientePicker]); // eslint-disable-line react-hooks/exhaustive-deps

    // Máquinas con cliente asignado, agrupadas por cliente
    const clientesMaquinasPicker = useMemo(() => {
        const conCliente = maqPickerMaquinas.filter(m => m.cliId != null);
        const groups = {};
        conCliente.forEach(m => {
            const key = String(m.cliId);
            if (!groups[key]) groups[key] = { cliId: m.cliId, nombre: m.clienteNombre ?? `Cliente ${m.cliId}`, maquinas: [] };
            groups[key].maquinas.push(m);
        });
        return Object.values(groups).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }, [maqPickerMaquinas]);

    const clientesMaquinasPickerFiltrados = useMemo(() => {
        const q = maqPickerBusqueda.trim().toLowerCase();
        if (!q) return clientesMaquinasPicker;
        return clientesMaquinasPicker
            .map(g => ({
                ...g,
                maquinas: g.maquinas.filter(m =>
                    String(m.id).toLowerCase().includes(q) ||
                    (m.location ?? '').toLowerCase().includes(q) ||
                    (m.type ?? '').toLowerCase().includes(q)
                ),
            }))
            .filter(g => g.maquinas.length > 0 || g.nombre.toLowerCase().includes(q));
    }, [clientesMaquinasPicker, maqPickerBusqueda]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!concepto.trim() || !monto || Number(monto) <= 0) {
            setError('Completa todos los campos correctamente.');
            return;
        }

        let metodo_pago, referencia;

        if (dividirPago) {
            // Validar que todos los tramos tengan monto > 0
            const sumDiv = pagosDiv.reduce((s, p) => s + (Number(p.monto) || 0), 0);
            if (pagosDiv.some(p => !p.monto || Number(p.monto) <= 0)) {
                setError('Asigna un monto mayor a 0 en cada tramo de pago.');
                return;
            }
            if (Math.abs(sumDiv - Number(monto)) > 0.01) {
                setError(`La suma de los tramos ($${sumDiv.toLocaleString('es-CL')}) no coincide con el monto total ($${Number(monto).toLocaleString('es-CL')}).`);
                return;
            }
            // Validar extras por tramo
            for (const p of pagosDiv) {
                if (p.metodo === 'tarjeta' && p.tarjUltimos4.length !== 4) {
                    setError('Ingresa los 4 dígitos de la tarjeta en cada tramo correspondiente.');
                    return;
                }
                if (p.metodo === 'transferencia' && !p.transReferencia.trim()) {
                    setError('Ingresa el N° de comprobante en cada tramo de transferencia.');
                    return;
                }
            }
            metodo_pago = 'mixto';
            referencia = pagosDiv.map(p => {
                if (p.metodo === 'efectivo') return `Efectivo: $${Number(p.monto).toLocaleString('es-CL')}`;
                if (p.metodo === 'tarjeta') return `${p.tarjTipo === 'debito' ? 'Débito' : 'Crédito'} ****${p.tarjUltimos4}: $${Number(p.monto).toLocaleString('es-CL')}`;
                if (p.metodo === 'transferencia') return `Transf. Ref:${p.transReferencia}${p.transBanco ? ` (${p.transBanco})` : ''}: $${Number(p.monto).toLocaleString('es-CL')}`;
                return '';
            }).join(' | ');
        } else {
            // Validaciones método simple
            if (metodoPago === 'tarjeta' && tarjUltimos4.length !== 4) {
                setError('Ingresa los últimos 4 dígitos de la tarjeta.');
                return;
            }
            if (metodoPago === 'transferencia' && !transReferencia.trim()) {
                setError('Ingresa el N° de comprobante de la transferencia.');
                return;
            }
            metodo_pago = metodoPago;
            referencia = null;
            if (metodoPago === 'tarjeta') referencia = `${tarjTipo === 'debito' ? 'Débito' : 'Crédito'} **** ${tarjUltimos4}`;
            else if (metodoPago === 'transferencia') referencia = `Ref: ${transReferencia.trim()}${transBanco.trim() ? ` | Banco: ${transBanco.trim()}` : ''}`;
        }

        setSaving(true);
        try {
            const items = cartSummary.length > 0
                ? cartSummary.map(e => ({ item_id: e.item.item_id, nombre: e.item.item_nombre, tipo: e.item.item_tipo, precio: Number(e.item.item_precio), cantidad: e.cantidad }))
                : null;
            const nuevoMov = await createCajaMovimiento({ tipo, concepto, monto: Number(monto), metodo_pago, referencia, cli_id: clienteSeleccionado?.id ?? null, items });
            setConcepto('');
            setMonto('');
            setTarjUltimos4('');
            setTransReferencia('');
            setTransBanco('');
            setDividirPago(false);
            setPagosDiv([PAGO_VACIO(), PAGO_VACIO()]);
            setCartSummary([]);
            setClienteSeleccionado(null);
            await refresh();
            setMovDetalle({ ...nuevoMov, _isNew: true });
        } catch {
            setError('Error al guardar el movimiento.');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!confirm('¿Eliminar este movimiento?')) return;
        await deleteCajaMovimiento(id);
        await refresh();
    };

    const handleReembolso = async (id) => {
        setReembolsando(id);
    };

    const confirmReembolso = async () => {
        if (!reembolsando) return;
        try {
            await reembolsarMovimiento(reembolsando);
            await refresh();
        } catch {
            setError('Error al procesar el reembolso.');
        } finally {
            setReembolsando(null);
        }
    };

    const handleAperturaCaja = async () => {
        setAperturaError('');
        setSavingApertura(true);
        try {
            const sesion = await createCajaApertura({
                fecha: hoyFecha,
                efectivo: Number(aperturaEfectivo) || 0,
                notas: aperturaNotas.trim() || null,
            });
            setCierreHoy(sesion);
            setShowAperturaModal(false);
            setAperturaEfectivo('');
            setAperturaNotas('');
        } catch (e) {
            const msg = e?.message || '';
            setAperturaError(msg.includes('ya existe') ? 'Ya existe una sesión de caja para hoy.' : 'Error al abrir la caja.');
        } finally {
            setSavingApertura(false);
        }
    };

    const handleReabrirCaja = async () => {
        const esCerrada = cajaStatus === 'cerrada';
        const msg = esCerrada
            ? '¿Reabrir la caja? El cierre será cancelado pero la apertura se conservará.'
            : '¿Cancelar la apertura de caja de hoy?';
        if (!confirm(msg)) return;
        try {
            const result = await deleteCajaCierre(hoyFecha);
            if (result?.status === 'abierta') {
                await refresh();
            } else {
                setCierreHoy(null);
            }
        } catch {
            setError('Error al reabrir la caja.');
        }
    };

    const handleCierreCaja = async () => {
        setCierreError('');
        setSavingCierre(true);
        try {
            const cierre = await createCajaCierre({
                fecha: hoyFecha,
                notas: cierreNotas.trim() || null,
                recuento_efectivo: Number(recuentoEfectivo) || 0,
            });
            setCierreHoy(cierre);
            setShowCierreModal(false);
            setCierreNotas('');
            setRecuentoEfectivo('');
        } catch (e) {
            const msg = e?.message || '';
            setCierreError(msg.includes('ya fue cerrada') ? 'La caja de hoy ya fue cerrada.' : 'Error al registrar el cierre.');
        } finally {
            setSavingCierre(false);
        }
    };

    const printCierre = (c, movs) => {
        const fechaStr = new Date(c.cierre_fecha + 'T00:00:00').toLocaleDateString('es-PY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Asuncion' });
        const horaStr  = new Date(c.cierre_timestamp).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' });
        const logoUrl  = `${window.location.origin}/logo.png`;

        const movNorm   = (movs || movimientos).filter(m => !m.mov_es_reembolso);
        const reembs    = (movs || movimientos).filter(m => m.mov_es_reembolso);
        const ingresos  = movNorm.filter(m => m.mov_tipo === 'ingreso');
        const egresos   = movNorm.filter(m => m.mov_tipo === 'egreso');

        const metodoLabel = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', mixto: 'Dividido' };

        const rowsHTML = (list) => list.map(m => {
            const hora = new Date(m.mov_timestamp).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Asuncion' });
            return `<tr style="border-bottom:1px dashed #e5e7eb">
              <td style="padding:.35em .75em;font-size:.8em;color:#6b7280">${hora}</td>
              <td style="padding:.35em .75em;font-size:.82em;color:#111827;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.mov_concepto}</td>
              <td style="padding:.35em .75em;font-size:.75em;color:#6b7280;white-space:nowrap">${metodoLabel[m.mov_metodo_pago] || m.mov_metodo_pago}</td>
              <td style="padding:.35em .75em;font-size:.85em;font-weight:700;text-align:right;white-space:nowrap">$${Number(m.mov_monto).toLocaleString('es-CL')}</td>
            </tr>`;
        }).join('');

        const sectionHTML = (title, color, list, total) => list.length === 0 ? '' : `
          <div style="margin-bottom:1.1em">
            <div style="font-size:.7em;font-weight:800;color:${color};letter-spacing:.1em;text-transform:uppercase;border-bottom:2px solid ${color};padding-bottom:.25em;margin-bottom:.35em">${title} (${list.length})</div>
            <table style="width:100%;border-collapse:collapse">${rowsHTML(list)}</table>
            <div style="display:flex;justify-content:flex-end;padding:.35em .75em;font-size:.85em;font-weight:800;color:${color}">Total: $${Number(total).toLocaleString('es-CL')}</div>
          </div>`;

        const w = window.open('', '_blank', 'width=520,height=700');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Cierre de Caja · ${c.cierre_fecha}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',system-ui,sans-serif; background:#f3f4f6; display:flex; justify-content:center; padding:1.5rem; }
  .ticket { background:white; border-radius:12px; padding:1.5em; max-width:480px; width:100%; box-shadow:0 4px 24px rgba(0,0,0,.12); }
  @media print { body { background:white; padding:0; } .ticket { box-shadow:none; border-radius:0; } }
</style></head><body>
<div class="ticket">
  <!-- Header -->
  <div style="text-align:center;margin-bottom:1.1em">
    <img src="${logoUrl}" alt="Logo" style="height:36px;margin-bottom:.5em;object-fit:contain" onerror="this.style.display='none'">
    <div style="font-size:1.05em;font-weight:900;color:#1e293b;letter-spacing:.05em">CIERRE DE CAJA</div>
    <div style="font-size:.75em;color:#64748b;margin-top:.25em;text-transform:capitalize">${fechaStr}</div>
    <div style="font-size:.7em;color:#94a3b8;margin-top:.15em">Cerrado a las ${horaStr}${c.usu_nombre ? ' · por ' + c.usu_nombre : ''}</div>
  </div>

  <!-- Balance -->
  <div style="background:#f8fafc;border-radius:8px;padding:.85em 1em;margin-bottom:1.1em;border:1px solid #e2e8f0">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5em;margin-bottom:.5em">
      <div style="background:white;border-radius:6px;padding:.5em .75em;border:1px solid #e2e8f0">
        <div style="font-size:.6em;color:#64748b;font-weight:700;text-transform:uppercase">Ingresos</div>
        <div style="font-size:.95em;font-weight:800;color:#16a34a">$${Number(c.cierre_ingresos).toLocaleString('es-CL')}</div>
      </div>
      <div style="background:white;border-radius:6px;padding:.5em .75em;border:1px solid #e2e8f0">
        <div style="font-size:.6em;color:#64748b;font-weight:700;text-transform:uppercase">Egresos</div>
        <div style="font-size:.95em;font-weight:800;color:#dc2626">$${Number(c.cierre_egresos).toLocaleString('es-CL')}</div>
      </div>
    </div>
    <div style="background:${Number(c.cierre_balance) >= 0 ? '#f0fdf4' : '#fef2f2'};border-radius:6px;padding:.55em 1em;border:1px solid ${Number(c.cierre_balance) >= 0 ? '#86efac' : '#fca5a5'};text-align:center">
      <div style="font-size:.62em;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:.2em">Balance Final</div>
      <div style="font-size:1.25em;font-weight:900;color:${Number(c.cierre_balance) >= 0 ? '#16a34a' : '#dc2626'}">$${Number(c.cierre_balance).toLocaleString('es-CL')}</div>
    </div>
    ${c.cierre_notas ? `<div style="margin-top:.5em;font-size:.72em;color:#64748b;font-style:italic;text-align:center">"${c.cierre_notas}"</div>` : ''}
  </div>

  <!-- Detalle por tipo -->
  ${sectionHTML('Ingresos', '#16a34a', ingresos, Number(c.cierre_ingresos))}
  ${sectionHTML('Egresos', '#dc2626', egresos, Number(c.cierre_egresos))}
  ${reembs.length > 0 ? sectionHTML('Reembolsos', '#7c3aed', reembs, reembs.reduce((s,m) => s + m.mov_monto, 0)) : ''}

  <!-- Footer -->
  <div style="margin-top:1em;padding-top:.75em;border-top:1px dashed #e2e8f0;text-align:center">
    <div style="font-size:.62em;color:#94a3b8">Documento de uso interno · No válido como factura fiscal</div>
    <div style="font-size:.65em;font-weight:700;color:#6b7280;margin-top:.2em">MAISONTECH APP © ${new Date().getFullYear()}</div>
  </div>
</div>
<script>window.onload = () => window.print();<\/script>
</body></html>`);
        w.document.close();
    };

    const printTicket = (mov) => {
        const esReembolso = mov.mov_es_reembolso === 1;
        const tipoLabel   = esReembolso ? 'REEMBOLSO' : (mov.mov_tipo === 'ingreso' ? 'INGRESO' : 'EGRESO');
        const color       = esReembolso ? '#7c3aed' : (mov.mov_tipo === 'ingreso' ? '#16a34a' : '#dc2626');
        const metodoLabel = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Pago Dividido' }[mov.mov_metodo_pago] || mov.mov_metodo_pago;
        const metodoIcon  = { efectivo:'💵', tarjeta:'💳', transferencia:'🏦', mixto:'💳' }[mov.mov_metodo_pago] || '';

        const dt = new Date(mov.mov_timestamp);
        const fechaStr = dt.toLocaleDateString('es-PY', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Asuncion' });
        const horaStr  = dt.toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });
        const numFormatted = mov.mov_id.toString().padStart(6, '0');
        const logoUrl = `${window.location.origin}/logo.png`;
        const DOT_COLORS = ['#f97316','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f59e0b','#14b8a6','#ef4444'];

        // Parse items
        let parsedItems = null;
        try {
            if (mov.mov_items) {
                const p = typeof mov.mov_items === 'string' ? JSON.parse(mov.mov_items) : mov.mov_items;
                if (Array.isArray(p) && p.length > 0) parsedItems = p;
            }
        } catch { /* ignore */ }

        // Build concepto rows — sizes in em relative to .ticket base (16px screen / 12pt print)
        let conceptoHTML;
        if (parsedItems) {
            const totalItems = parsedItems.reduce((s, it) => s + it.precio * it.cantidad, 0);
            const rows = parsedItems.map((it, i) => {
                const subtotal = it.precio * it.cantidad;
                const dot = DOT_COLORS[i % DOT_COLORS.length];
                return `<tr>
                  <td style="padding:.55em 1.4em;border-bottom:1px dashed #e5e7eb;vertical-align:middle">
                    <span style="display:inline-block;width:.65em;height:.65em;border-radius:50%;background:${dot};margin-right:.55em;flex-shrink:0;vertical-align:middle"></span>
                    <span style="font-size:1em;color:#111827;font-weight:600;vertical-align:middle">${it.nombre}</span>
                    <span style="font-size:.85em;color:#6b7280;font-weight:600;vertical-align:middle"> x${it.cantidad}</span>
                  </td>
                  <td style="padding:.55em 1.4em;border-bottom:1px dashed #e5e7eb;text-align:right;font-size:1em;font-weight:700;color:#111827;white-space:nowrap;vertical-align:middle">
                    $${subtotal.toLocaleString('es-PY')}
                  </td>
                </tr>`;
            }).join('');
            conceptoHTML = `<table style="width:100%;border-collapse:collapse">
              ${rows}
              <tr>
                <td style="padding:.7em 1.4em;font-size:.8em;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:.06em">TOTAL</td>
                <td style="padding:.7em 1.4em;text-align:right;font-size:1.4em;font-weight:900;color:${color};white-space:nowrap">$${totalItems.toLocaleString('es-PY')}</td>
              </tr>
            </table>`;
        } else {
            const monto = Number(mov.mov_monto).toLocaleString('es-PY');
            conceptoHTML = `<table style="width:100%;border-collapse:collapse">
              <tr>
                <td style="padding:.55em 1.4em;border-bottom:1px dashed #e5e7eb;font-size:1em;color:#111827;font-weight:600">${mov.mov_concepto}</td>
                <td style="padding:.55em 1.4em;border-bottom:1px dashed #e5e7eb;text-align:right;font-size:1em;font-weight:700;color:#111827;white-space:nowrap">$${monto}</td>
              </tr>
              <tr>
                <td style="padding:.7em 1.4em;font-size:.8em;font-weight:800;color:#374151;text-transform:uppercase;letter-spacing:.06em">TOTAL</td>
                <td style="padding:.7em 1.4em;text-align:right;font-size:1.4em;font-weight:900;color:${color};white-space:nowrap">$${monto}</td>
              </tr>
            </table>`;
        }

        // Build tramos rows
        let tramosHTML = '';
        if (mov.mov_referencia && mov.mov_metodo_pago === 'mixto') {
            const rows = mov.mov_referencia.split(' | ').map((t, i) => {
                const parts = t.split(':');
                const label = parts[0].trim();
                const amount = parts.slice(1).join(':').trim();
                return `<tr>
                  <td style="padding:.65em 1.4em;border-bottom:1px solid #f1f5f9;font-size:1em;color:#374151;vertical-align:middle">
                    <span style="display:inline-flex;align-items:center;justify-content:center;width:1.5em;height:1.5em;background:#e0e7ff;color:#4338ca;border-radius:50%;font-size:.78em;font-weight:800;margin-right:.6em;flex-shrink:0">${i+1}</span>${label}
                  </td>
                  <td style="padding:.65em 1.4em;border-bottom:1px solid #f1f5f9;text-align:right;font-weight:800;font-size:1em;color:${color};white-space:nowrap">${amount}</td>
                </tr>`;
            }).join('');
            tramosHTML = `
            <div style="height:1px;border-top:1px dashed #d1d5db;margin:0 1.4em"></div>
            <div style="padding:.6em 1.4em .4em">
              <div style="font-size:.6em;font-weight:800;color:#9ca3af;letter-spacing:.13em;text-transform:uppercase;margin-bottom:.5em">Distribución del pago</div>
              <div style="border-radius:.5em;border:1px solid #e5e7eb;overflow:hidden">
                <div style="background:#f8fafc;padding:.35em .9em;font-size:.6em;font-weight:800;color:#6b7280;letter-spacing:.13em;text-transform:uppercase;border-bottom:1px solid #e5e7eb">Tramos de pago</div>
                <table style="width:100%;border-collapse:collapse">${rows}</table>
              </div>
            </div>`;
        } else if (mov.mov_referencia) {
            tramosHTML = `
            <div style="height:1px;border-top:1px dashed #d1d5db;margin:0 1.4em"></div>
            <div style="padding:.6em 1.4em">
              <div style="font-size:.6em;font-weight:800;color:#9ca3af;letter-spacing:.13em;text-transform:uppercase;margin-bottom:.35em">Referencia de pago</div>
              <p style="font-size:.9em;font-weight:600;color:#111827">${mov.mov_referencia}</p>
            </div>`;
        }

        const w = window.open('', '_blank', 'width=860,height=940,scrollbars=yes');
        w.document.write(`<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comprobante N° ${numFormatted}</title>
<style>
  @page{size:auto;margin:12mm}
  *{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  html{font-size:16px}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#dde3ea;display:flex;align-items:flex-start;justify-content:center;padding:2.2rem 1.5rem;min-height:100vh}
  .ticket{font-size:clamp(15px,2.4vw,20px);background:#fff;width:100%;max-width:52em;border-radius:1em;overflow:hidden;box-shadow:0 .6em 2.5em rgba(0,0,0,0.2)}
  @media print{
    html{font-size:13pt}
    body{background:#dde3ea!important;padding:0;display:block}
    .ticket{max-width:100%!important;border-radius:.6em!important;box-shadow:none!important;font-size:13pt!important}
  }
</style></head><body>
<div class="ticket">

  <!-- HEADER -->
  <div style="background:#1a1a2e;padding:1.1em 1.5em;display:flex;align-items:center;gap:1em">
    <img src="${logoUrl}" alt="" style="width:3.8em;height:3.8em;object-fit:contain;border-radius:50%;border:2px solid rgba(255,255,255,0.18);background:#000;flex-shrink:0" onerror="this.style.display='none'">
    <div style="flex:1;min-width:0">
      <div style="font-size:1.1em;font-weight:900;color:#f9fafb;letter-spacing:.09em;text-transform:uppercase;line-height:1.2">MAISONTECH APP</div>
      <div style="font-size:.62em;color:#6b7280;letter-spacing:.05em;text-transform:uppercase;margin-top:.2em">Sistema de Gestión y Recaudación</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:.55em;font-weight:700;color:#6b7280;letter-spacing:.13em;text-transform:uppercase">Comprobante de Caja</div>
      <div style="font-size:1.25em;font-weight:900;color:#f9fafb;margin-top:.15em;letter-spacing:.03em">N° ${numFormatted}</div>
    </div>
  </div>

  <!-- AMOUNT BANNER -->
  <div style="background:${color};padding:1.25em 1.75em;display:flex;align-items:center;justify-content:space-between;gap:1em">
    <div style="background:rgba(255,255,255,0.22);border:1px solid rgba(255,255,255,0.4);border-radius:2em;padding:.28em 1.1em;font-size:.68em;font-weight:800;color:#fff;letter-spacing:.16em;text-transform:uppercase;flex-shrink:0">${tipoLabel}</div>
    <div style="font-size:2.9em;font-weight:900;color:#fff;line-height:1;letter-spacing:-.03em">
      <span style="font-size:.45em;vertical-align:super;margin-right:.1em">$</span>${Number(mov.mov_monto).toLocaleString('es-PY')}
    </div>
  </div>

  <!-- PAYMENT METHOD -->
  <div style="display:flex;align-items:center;justify-content:center;padding:.55em 1em;background:#f8fafc;border-bottom:1px solid #e5e7eb">
    <span style="display:inline-flex;align-items:center;gap:.45em;background:#fff;border:1px solid #e0e7ff;border-radius:2em;padding:.3em 1.1em;font-size:.8em;font-weight:700;color:#4338ca">
      ${metodoIcon} ${metodoLabel}
    </span>
  </div>

  ${esReembolso ? `<div style="background:#ede9fe;border-bottom:1px solid #c4b5fd;padding:.4em 1.4em;display:flex;align-items:center;justify-content:center;gap:.4em;font-size:.8em;font-weight:700;color:#6d28d9">↩ Reembolso — Ref. movimiento #${mov.mov_ref_id}</div>` : ''}

  <!-- DATE / OPERATOR -->
  <div style="padding:1.1em 1.4em .75em">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6em 1em">
      ${mov.cli_nombre_snap ? `<div style="grid-column:1/-1"><div style="font-size:.6em;font-weight:700;color:#9ca3af;letter-spacing:.09em;text-transform:uppercase;margin-bottom:.2em">Cliente</div><div style="font-size:1em;font-weight:700;color:#111827">${mov.cli_nombre_snap}</div></div>` : ''}
      <div>
        <div style="font-size:.6em;font-weight:700;color:#9ca3af;letter-spacing:.09em;text-transform:uppercase;margin-bottom:.2em">Fecha</div>
        <div style="font-size:.88em;font-weight:600;color:#111827">${fechaStr}</div>
      </div>
      <div>
        <div style="font-size:.6em;font-weight:700;color:#9ca3af;letter-spacing:.09em;text-transform:uppercase;margin-bottom:.2em">Hora</div>
        <div style="font-size:.88em;font-weight:600;color:#111827">${horaStr}</div>
      </div>
      ${mov.usu_nombre ? `<div style="grid-column:1/-1"><div style="font-size:.6em;font-weight:700;color:#9ca3af;letter-spacing:.09em;text-transform:uppercase;margin-bottom:.2em">Operador</div><div style="font-size:1em;font-weight:700;color:#111827">${mov.usu_nombre}</div></div>` : ''}
    </div>
  </div>

  <!-- CONCEPTO -->
  <div style="height:1px;border-top:1px dashed #d1d5db;margin:0 1.4em"></div>
  <div style="padding:.6em 0 0">
    <div style="font-size:.6em;font-weight:800;color:#9ca3af;letter-spacing:.13em;text-transform:uppercase;padding:0 1.4em;margin-bottom:.4em">Concepto</div>
    ${conceptoHTML}
  </div>

  ${tramosHTML}

  <!-- FOOTER -->
  <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:.85em 1.4em;text-align:center;margin-top:.6em">
    <div style="font-size:.6em;color:#9ca3af;line-height:1.7">Documento de uso interno · No válido como factura fiscal · Generado automáticamente</div>
    <div style="font-size:.65em;font-weight:700;color:#6b7280;margin-top:.25em;letter-spacing:.06em">MAISONTECH APP © ${new Date().getFullYear()}</div>
  </div>

</div>
<script>window.onload = () => window.print();<\/script>
</body></html>`);
        w.document.close();
    };

    return (
        <div className="animate-fade-in">

            {/* ── Modal Apertura de Caja ── */}
            {showAperturaModal && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                    <div className="card p-6" style={{ maxWidth:420, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
                            <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--success-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon name="store" size={22} style={{ color:'var(--success)' }} />
                            </div>
                            <div>
                                <div className="font-semibold" style={{ fontSize:'1rem' }}>Control de Apertura</div>
                                <div className="text-sm text-muted">{new Date().toLocaleDateString('es-PY', { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone:'America/Asuncion' })}</div>
                            </div>
                        </div>

                        <div className="input-group mb-4">
                            <label className="label">Caja de apertura <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(efectivo inicial en caja)</span></label>
                            <div style={{ position:'relative' }}>
                                <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontWeight:700, fontSize:'0.9rem', pointerEvents:'none' }}>$</span>
                                <input
                                    className="input"
                                    style={{ paddingLeft:26 }}
                                    type="number"
                                    min="0"
                                    step="any"
                                    placeholder="0"
                                    value={aperturaEfectivo}
                                    onChange={e => setAperturaEfectivo(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="input-group mb-4">
                            <label className="label">Nota de apertura <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span></label>
                            <textarea
                                className="input" rows={2}
                                placeholder="Ej: Turno mañana, sin novedad..."
                                value={aperturaNotas}
                                onChange={e => setAperturaNotas(e.target.value)}
                                style={{ resize:'vertical' }}
                            />
                        </div>

                        {aperturaError && <div style={{ background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'1rem', fontSize:'0.82rem', fontWeight:600 }}>{aperturaError}</div>}

                        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => { setShowAperturaModal(false); setAperturaError(''); }} disabled={savingApertura}>
                                Cancelar
                            </button>
                            <button
                                className="btn"
                                style={{ background:'#16a34a', color:'white', gap:6 }}
                                onClick={handleAperturaCaja}
                                disabled={savingApertura}
                            >
                                {savingApertura ? <><Icon name="loader" size={15} className="animate-spin" /> Abriendo...</> : <><Icon name="store" size={15} /> Abrir Caja</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Modal Cierre de Caja (estilo Odoo) ── */}
            {showCierreModal && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                    <div className="card" style={{ maxWidth:500, width:'100%', overflow:'hidden' }}>
                        {/* Header */}
                        <div style={{ background:'linear-gradient(135deg,#1e293b,#334155)', padding:'1.1rem 1.5rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <div>
                                <div style={{ fontWeight:900, color:'white', fontSize:'1rem', letterSpacing:'0.03em' }}>Cerrando la Caja</div>
                                <div style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:2 }}>
                                    {movimientos.filter(m => !m.mov_es_reembolso).length} movimientos · ${Number(balance.total_ingresos).toLocaleString('es-CL')} facturado
                                </div>
                            </div>
                            <button onClick={() => { setShowCierreModal(false); setCierreError(''); setCierreNotas(''); setRecuentoEfectivo(''); }}
                                style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:8, padding:'0.35rem 0.6rem', cursor:'pointer', color:'white', display:'flex' }}>
                                <Icon name="x" size={16} />
                            </button>
                        </div>

                        <div style={{ padding:'1.25rem 1.5rem', maxHeight:'70vh', overflowY:'auto' }}>
                            {/* Desglose por método de pago — estilo Odoo */}
                            {(() => {
                                const aperturaMonto  = Number(cierreHoy?.apertura_efectivo ?? 0);
                                const movNorm        = movimientos.filter(m => !m.mov_es_reembolso);
                                const espEfectivo    = aperturaMonto
                                    + movNorm.filter(m => m.mov_tipo === 'ingreso' && m.mov_metodo_pago === 'efectivo').reduce((s,m) => s + m.mov_monto, 0)
                                    - movNorm.filter(m => m.mov_tipo === 'egreso'  && m.mov_metodo_pago === 'efectivo').reduce((s,m) => s + m.mov_monto, 0);
                                const pagosEfectivo   = movNorm.filter(m => m.mov_tipo === 'ingreso' && m.mov_metodo_pago === 'efectivo').reduce((s,m) => s + m.mov_monto, 0);
                                const pagosEgEfectivo = movNorm.filter(m => m.mov_tipo === 'egreso'  && m.mov_metodo_pago === 'efectivo').reduce((s,m) => s + m.mov_monto, 0);
                                const pagosTarjeta    = movNorm.filter(m => m.mov_tipo === 'ingreso' && m.mov_metodo_pago === 'tarjeta').reduce((s,m) => s + m.mov_monto, 0);
                                const pagosTransfer   = movNorm.filter(m => m.mov_tipo === 'ingreso' && m.mov_metodo_pago === 'transferencia').reduce((s,m) => s + m.mov_monto, 0);
                                const recuentoNum    = Number(recuentoEfectivo) || 0;
                                const diferenciaEf   = recuentoNum - espEfectivo;

                                const METODO_META = {
                                    'Efectivo':       { color:'var(--success)', bg:'#f0fdf4', border:'#bbf7d0' },
                                    'Tarjeta':        { color:'var(--primary)', bg:'#eef2ff', border:'#c7d2fe' },
                                    'Transferencia':  { color:'#0891b2', bg:'#ecfeff', border:'#a5f3fc' },
                                };
                                const MetodoRow = ({ label, apertura, pagos, egresosMov, esp, recuentoField, diferencia, isEfectivo }) => {
                                    const sinMovimientos = !isEfectivo && esp === 0;
                                    const meta = METODO_META[label] || { color:'#64748b', bg:'#f8fafc', border:'#e2e8f0' };
                                    const difOk = Math.abs(diferencia) < 0.01;
                                    return (
                                    <div style={{
                                        marginBottom:'0.85rem',
                                        borderRadius:12,
                                        border:`1.5px solid ${sinMovimientos ? '#e2e8f0' : meta.border}`,
                                        background: sinMovimientos ? '#f8fafc' : meta.bg,
                                        overflow:'hidden',
                                        opacity: sinMovimientos ? 0.6 : 1,
                                        transition:'opacity 0.2s',
                                    }}>
                                        {/* Header método */}
                                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1rem', borderBottom: sinMovimientos ? 'none' : `1px solid ${meta.border}` }}>
                                            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                                <div style={{ width:4, height:36, borderRadius:2, background: sinMovimientos ? '#e2e8f0' : meta.color, flexShrink:0 }} />
                                                <div>
                                                    <div style={{ fontWeight:800, fontSize:'0.95rem', color: sinMovimientos ? '#94a3b8' : meta.color }}>{label}</div>
                                                    {sinMovimientos && <div style={{ fontSize:'0.65rem', color:'#94a3b8', fontWeight:700, letterSpacing:'0.06em', textTransform:'uppercase' }}>Sin movimientos</div>}
                                                </div>
                                            </div>
                                            <div style={{ textAlign:'right' }}>
                                                <div style={{ fontWeight:900, fontSize:'1.15rem', color: sinMovimientos ? '#94a3b8' : meta.color }}>
                                                    ${Number(esp).toLocaleString('es-CL')}
                                                </div>
                                                <div style={{ fontSize:'0.65rem', color:'#94a3b8', fontWeight:600, letterSpacing:'0.04em' }}>ESPERADO</div>
                                            </div>
                                        </div>

                                        {/* Desglose + recuento */}
                                        {!sinMovimientos && (
                                            <div style={{ padding:'0.65rem 1rem' }}>
                                                {/* Líneas de desglose */}
                                                <div style={{ display:'flex', flexDirection:'column', gap:'0.2rem', marginBottom: recuentoField ? '0.65rem' : 0 }}>
                                                    {isEfectivo && (
                                                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.76rem', color:'#64748b' }}>
                                                            <span>Apertura de caja</span>
                                                            <span style={{ fontWeight:600 }}>${Number(apertura).toLocaleString('es-CL')}</span>
                                                        </div>
                                                    )}
                                                    {pagos > 0 && (
                                                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.76rem', color:'#64748b' }}>
                                                            <span>▸ Ingresos</span>
                                                            <span style={{ fontWeight:600, color:'var(--success)' }}>+${Number(pagos).toLocaleString('es-CL')}</span>
                                                        </div>
                                                    )}
                                                    {isEfectivo && egresosMov > 0 && (
                                                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.76rem', color:'#64748b' }}>
                                                            <span>▸ Egresos efectivo</span>
                                                            <span style={{ fontWeight:600, color:'#dc2626' }}>−${Number(egresosMov).toLocaleString('es-CL')}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Campo recuento */}
                                                {recuentoField}

                                                {/* Diferencia — pill */}
                                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'0.6rem', padding:'0.45rem 0.65rem', borderRadius:8, background: difOk ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)', border:`1px solid ${difOk ? '#86efac' : '#fca5a5'}` }}>
                                                    <span style={{ fontSize:'0.73rem', fontWeight:800, color: difOk ? '#16a34a' : '#dc2626', letterSpacing:'0.05em', textTransform:'uppercase' }}>
                                                        {difOk ? 'Sin diferencia' : 'Diferencia'}
                                                    </span>
                                                    <span style={{ fontSize:'0.95rem', fontWeight:900, color: difOk ? '#16a34a' : '#dc2626' }}>
                                                        {diferencia >= 0 ? '+' : ''}${Number(diferencia).toLocaleString('es-CL')}
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    );
                                };

                                return (
                                    <>
                                        <MetodoRow
                                            label="Efectivo" apertura={aperturaMonto}
                                            pagos={pagosEfectivo} egresosMov={pagosEgEfectivo}
                                            esp={espEfectivo} isEfectivo={true}
                                            diferencia={diferenciaEf}
                                            recuentoField={
                                                <div>
                                                    <label style={{ fontSize:'0.7rem', fontWeight:700, color:'#64748b', display:'block', marginBottom:'0.35rem', letterSpacing:'0.04em' }}>
                                                        RECUENTO FÍSICO DE EFECTIVO
                                                    </label>
                                                    <div style={{ position:'relative' }}>
                                                        <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'#64748b', fontWeight:800, pointerEvents:'none', fontSize:'0.95rem' }}>$</span>
                                                        <input
                                                            className="input"
                                                            style={{
                                                                paddingLeft:26,
                                                                fontSize:'1rem',
                                                                fontWeight:700,
                                                                borderWidth:2,
                                                                borderColor: recuentoEfectivo
                                                                    ? (Math.abs(diferenciaEf) > 0.01 ? '#ef4444' : '#16a34a')
                                                                    : '#c7d2fe',
                                                                background:'var(--surface)',
                                                            }}
                                                            type="number" min="0" step="any"
                                                            placeholder={`0 (esperado: $${Number(espEfectivo).toLocaleString('es-CL')})`}
                                                            value={recuentoEfectivo}
                                                            onChange={e => setRecuentoEfectivo(e.target.value)}
                                                        />
                                                    </div>
                                                </div>
                                            }
                                        />
                                        <MetodoRow label="Tarjeta" apertura={0}
                                            pagos={pagosTarjeta} egresosMov={0}
                                            esp={pagosTarjeta} isEfectivo={false}
                                            diferencia={0}
                                            recuentoField={null}
                                        />
                                        <MetodoRow label="Transferencia" apertura={0}
                                            pagos={pagosTransfer} egresosMov={0}
                                            esp={pagosTransfer} isEfectivo={false}
                                            diferencia={0}
                                            recuentoField={null}
                                        />
                                    </>
                                );
                            })()}

                            {/* Nota de cierre */}
                            <div style={{ marginTop:'0.75rem', background:'#f8fafc', border:'1.5px solid #e2e8f0', borderRadius:12, padding:'0.75rem 1rem' }}>
                                <label style={{ fontSize:'0.7rem', fontWeight:800, color:'#64748b', display:'block', marginBottom:'0.4rem', letterSpacing:'0.05em', textTransform:'uppercase' }}>
                                    Nota de cierre <span style={{ fontWeight:500, color:'#94a3b8', textTransform:'none', letterSpacing:0 }}>(opcional)</span>
                                </label>
                                <textarea
                                    className="input" rows={2}
                                    placeholder="Ej: Todo en orden, sin diferencias..."
                                    value={cierreNotas}
                                    onChange={e => setCierreNotas(e.target.value)}
                                    style={{ resize:'vertical', background:'var(--surface)', border:'1.5px solid #e2e8f0', borderRadius:8 }}
                                />
                            </div>
                        </div>

                        {cierreError && <div style={{ margin:'0 1.5rem', background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', fontSize:'0.82rem', fontWeight:600 }}>{cierreError}</div>}

                        {/* Footer botones */}
                        <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border)', display:'flex', gap:'0.75rem', alignItems:'center', justifyContent:'space-between' }}>
                            <button
                                type="button"
                                onClick={() => printCierre({ cierre_fecha: hoyFecha, cierre_timestamp: new Date().toISOString(), cierre_ingresos: balance.total_ingresos, cierre_egresos: balance.total_egresos, cierre_balance: balance.balance, cierre_notas: cierreNotas || null, usu_nombre: null })}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'0.78rem', fontWeight:600, display:'inline-flex', alignItems:'center', gap:5 }}
                            >
                                <Icon name="printer" size={13} /> Vista previa
                            </button>
                            <div style={{ display:'flex', gap:'0.75rem' }}>
                                <button className="btn btn-secondary" onClick={() => { setShowCierreModal(false); setCierreError(''); setCierreNotas(''); setRecuentoEfectivo(''); }} disabled={savingCierre}>
                                    Descartar
                                </button>
                                <button
                                    className="btn"
                                    style={{ background:'#d97706', color:'white', gap:6 }}
                                    onClick={handleCierreCaja}
                                    disabled={savingCierre}
                                >
                                    {savingCierre ? <><Icon name="loader" size={15} className="animate-spin" /> Cerrando...</> : <><Icon name="lock" size={15} /> Cerrar Caja</>}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Modal detalle de movimiento ── */}
            {movDetalle && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}
                     onClick={e => { if (e.target === e.currentTarget) setMovDetalle(null); }}>
                    <div className="card" style={{ maxWidth:480, width:'100%', overflow:'hidden' }}>
                        {/* Header */}
                        {(() => {
                            const m = movDetalle;
                            const esR = m.mov_es_reembolso === 1;
                            const color = esR ? '#7c3aed' : (m.mov_tipo === 'ingreso' ? '#16a34a' : '#dc2626');
                            const colorLight = esR ? '#f5f3ff' : (m.mov_tipo === 'ingreso' ? '#f0fdf4' : '#fef2f2');
                            const tipoLabel = esR ? 'Reembolso' : (m.mov_tipo === 'ingreso' ? 'Ingreso' : 'Egreso');
                            const metodoLabel = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Pago Dividido' }[m.mov_metodo_pago] || m.mov_metodo_pago;
                            const metodoIcon = { efectivo:'💵', tarjeta:'💳', transferencia:'🏦', mixto:'💸' }[m.mov_metodo_pago] || '';
                            let parsedItems = null;
                            try { if (m.mov_items) { const p = typeof m.mov_items === 'string' ? JSON.parse(m.mov_items) : m.mov_items; if (Array.isArray(p) && p.length > 0) parsedItems = p; } } catch {}
                            const DOT = ['#f97316','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f59e0b'];
                            return (<>
                                {/* Franja de éxito */}
                                {m._isNew && (
                                    <div style={{ background:'var(--success-light)', borderBottom:'1px solid #86efac', padding:'0.55rem 1.25rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                        <div style={{ width:22, height:22, borderRadius:'50%', background:'#16a34a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name="check" size={13} style={{ color:'#fff' }} />
                                        </div>
                                        <span style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--success)' }}>
                                            {m.mov_tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} registrado exitosamente
                                        </span>
                                    </div>
                                )}
                                {/* Banner */}
                                <div style={{ background: color, padding:'1.1rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    <div>
                                        <div style={{ fontSize:'0.68rem', fontWeight:800, color:'rgba(255,255,255,0.75)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:4 }}>
                                            Movimiento #{m.mov_id.toString().padStart(6,'0')}
                                        </div>
                                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                            <span style={{ background:'rgba(255,255,255,0.2)', border:'1px solid rgba(255,255,255,0.35)', borderRadius:20, padding:'2px 12px', fontSize:'0.72rem', fontWeight:800, color:'#fff', letterSpacing:'1.5px', textTransform:'uppercase' }}>
                                                {tipoLabel}
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign:'right' }}>
                                        <div style={{ fontSize:'2rem', fontWeight:900, color:'#fff', lineHeight:1, letterSpacing:'-0.5px' }}>
                                            <span style={{ fontSize:'0.9rem', verticalAlign:'super', marginRight:1 }}>$</span>
                                            {Number(m.mov_monto).toLocaleString('es-PY')}
                                        </div>
                                    </div>
                                </div>

                                {/* Método */}
                                <div style={{ background: colorLight, borderBottom:'1px solid var(--border)', padding:'0.45rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    <span style={{ fontSize:'0.8rem', fontWeight:600, color }}>{metodoIcon} {metodoLabel}</span>
                                    <button onClick={() => setMovDetalle(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(0,0,0,0.4)', lineHeight:1, fontSize:'1.2rem' }}>✕</button>
                                </div>

                                {/* Cuerpo */}
                                <div style={{ padding:'1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.75rem' }}>

                                    {/* Fecha / Hora / Operador */}
                                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem 1rem' }}>
                                        <div>
                                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:2 }}>Fecha</div>
                                            <div style={{ fontSize:'0.84rem', fontWeight:600 }}>
                                                {new Date(m.mov_timestamp).toLocaleDateString('es-PY', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Asuncion' })}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:2 }}>Hora</div>
                                            <div style={{ fontSize:'0.84rem', fontWeight:600 }}>
                                                {new Date(m.mov_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
                                            </div>
                                        </div>
                                        {m.usu_nombre && (
                                            <div style={{ gridColumn:'1/-1' }}>
                                                <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:2 }}>Operador</div>
                                                <div style={{ fontSize:'0.84rem', fontWeight:600 }}>{m.usu_nombre}</div>
                                            </div>
                                        )}
                                        {m.cli_nombre_snap && (
                                            <div style={{ gridColumn:'1/-1' }}>
                                                <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:2 }}>Cliente</div>
                                                <div style={{ fontSize:'0.84rem', fontWeight:700, display:'flex', alignItems:'center', gap:6 }}>
                                                    <span style={{ background:'var(--primary-light)', color:'var(--primary)', borderRadius:999, padding:'1px 8px', fontSize:'0.72rem', border:'1px solid var(--primary)' }}>👤 {m.cli_nombre_snap}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Concepto / Items */}
                                    <div style={{ borderTop:'1px dashed var(--border)', paddingTop:'0.75rem' }}>
                                        <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:'0.4rem' }}>Concepto</div>
                                        {parsedItems ? (
                                            <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
                                                {parsedItems.map((it, i) => (
                                                    <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                                        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                                                            <span style={{ width:9, height:9, borderRadius:'50%', background: DOT[i % DOT.length], display:'inline-block', flexShrink:0 }}></span>
                                                            <span style={{ fontSize:'0.85rem', fontWeight:600 }}>{it.nombre}</span>
                                                            <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:600 }}>x{it.cantidad}</span>
                                                        </div>
                                                        <span style={{ fontSize:'0.85rem', fontWeight:700, whiteSpace:'nowrap' }}>${(it.precio * it.cantidad).toLocaleString('es-PY')}</span>
                                                    </div>
                                                ))}
                                                <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px dashed var(--border)', marginTop:'0.3rem', paddingTop:'0.4rem' }}>
                                                    <span style={{ fontSize:'0.75rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.8px' }}>Total</span>
                                                    <span style={{ fontSize:'1rem', fontWeight:900, color }}>${parsedItems.reduce((s,it) => s + it.precio * it.cantidad, 0).toLocaleString('es-PY')}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize:'0.85rem', fontWeight:600 }}>{m.mov_concepto}</div>
                                        )}
                                    </div>

                                    {/* Tramos si mixto */}
                                    {m.mov_referencia && m.mov_metodo_pago === 'mixto' && (
                                        <div style={{ borderTop:'1px dashed var(--border)', paddingTop:'0.75rem' }}>
                                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:'0.5rem' }}>Distribución del pago</div>
                                            <div style={{ borderRadius:8, border:'1px solid var(--border)', overflow:'hidden' }}>
                                                <div style={{ background:'var(--bg-color)', padding:'4px 10px', fontSize:'0.6rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.5px', textTransform:'uppercase', borderBottom:'1px solid var(--border)' }}>Tramos de pago</div>
                                                {m.mov_referencia.split(' | ').map((t, i) => {
                                                    const parts = t.split(':'); const label = parts[0].trim(); const amount = parts.slice(1).join(':').trim();
                                                    return (
                                                        <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.5rem 0.75rem', borderBottom: i < m.mov_referencia.split(' | ').length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                                                <span style={{ width:22, height:22, background:'var(--primary-light)', color:'var(--primary)', borderRadius:'50%', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:'0.7rem', fontWeight:800 }}>{i+1}</span>
                                                                <span style={{ fontSize:'0.84rem' }}>{label}</span>
                                                            </div>
                                                            <span style={{ fontSize:'0.84rem', fontWeight:700, color }}>{amount}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Referencia simple */}
                                    {m.mov_referencia && m.mov_metodo_pago !== 'mixto' && (
                                        <div style={{ borderTop:'1px dashed var(--border)', paddingTop:'0.75rem' }}>
                                            <div style={{ fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:2 }}>Referencia</div>
                                            <div style={{ fontSize:'0.84rem', fontWeight:600 }}>{m.mov_referencia}</div>
                                        </div>
                                    )}

                                    {esR && m.mov_ref_id && (
                                        <div style={{ background:'var(--primary-light)', borderRadius:8, padding:'0.5rem 0.75rem', fontSize:'0.8rem', color:'#6d28d9', fontWeight:600 }}>
                                            ↩ Reembolso del movimiento #{m.mov_ref_id}
                                        </div>
                                    )}
                                </div>

                                {/* Acciones */}
                                <div style={{ borderTop:'1px solid var(--border)', padding:'0.85rem 1.25rem', display:'flex', gap:'0.6rem', justifyContent:'flex-end', background:'var(--bg-color)', flexWrap:'wrap' }}>
                                    <button className="btn btn-secondary" style={{ gap:6 }} onClick={() => { printTicket(m); }}>
                                        <Icon name="printer" size={15} /> Imprimir ticket
                                    </button>
                                    {!esR && (
                                        <button className="btn btn-secondary" style={{ gap:6, color:'#7c3aed' }}
                                            onClick={() => { setMovDetalle(null); handleReembolso(m.mov_id); }}>
                                            <Icon name="rotate-ccw" size={15} /> Reembolsar
                                        </button>
                                    )}
                                    {!esR && (
                                        <button className="btn btn-secondary" style={{ gap:6, color:'var(--danger)' }}
                                            onClick={async () => { if (!confirm('¿Eliminar este movimiento?')) return; setMovDetalle(null); await deleteCajaMovimiento(m.mov_id); await refresh(); }}>
                                            <Icon name="trash-2" size={15} /> Eliminar
                                        </button>
                                    )}
                                </div>
                            </>);
                        })()}
                    </div>
                </div>,
                document.body
            )}

            {/* Reembolso confirm modal */}
            {reembolsando && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999 }}>
                    <div className="card p-6" style={{ maxWidth:380, width:'100%', margin:'1rem' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem' }}>
                            <div style={{ width:40, height:40, borderRadius:'50%', background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon name="rotate-ccw" size={20} style={{ color:'#7c3aed' }} />
                            </div>
                            <div>
                                <div className="font-semibold">Confirmar Reembolso</div>
                                <div className="text-sm text-muted">Movimiento #{reembolsando}</div>
                            </div>
                        </div>
                        <p className="text-sm text-muted mb-4">Se generará un movimiento inverso como comprobante de reembolso. Esta acción no se puede deshacer.</p>
                        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setReembolsando(null)}>Cancelar</button>
                            <button className="btn btn-primary" style={{ background:'#7c3aed' }} onClick={confirmReembolso}>
                                <Icon name="rotate-ccw" size={15} /> Confirmar Reembolso
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Selector de cajero (solo admin/superadmin) ── */}
            {esSupervisor && (
                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem', background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:10, padding:'0.6rem 1rem', flexWrap:'wrap' }}>
                    <Icon name="users" size={16} style={{ color:'var(--primary)', flexShrink:0 }} />
                    <span style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--text-main)', whiteSpace:'nowrap' }}>Ver caja de:</span>
                    <select
                        value={filtroCajero?.id ?? ''}
                        onChange={e => {
                            const id = e.target.value;
                            if (!id) { setFiltroCajero(null); return; }
                            const usu = listaCajeros.find(u => String(u.id ?? u.usu_id) === id);
                            setFiltroCajero(usu ? { id: Number(id), nombre: usu.nombre ?? usu.usu_nombre } : null);
                        }}
                        style={{ flex:1, minWidth:160, maxWidth:260, padding:'0.3rem 0.6rem', borderRadius:7, border:'1.5px solid var(--border)', background:'var(--surface)', fontSize:'0.82rem', cursor:'pointer' }}
                    >
                        <option value="">Mi caja</option>
                        {listaCajeros
                            .filter(u => u.id !== undefined || u.usu_id !== undefined)
                            .map(u => {
                                const uid = u.id ?? u.usu_id;
                                const nombre = u.nombre ?? u.usu_nombre ?? '—';
                                const rol = u.rol ?? u.usu_rol ?? '';
                                return <option key={uid} value={uid}>{nombre} ({rol})</option>;
                            })
                        }
                    </select>
                    {filtroCajero && (
                        <div style={{ display:'flex', alignItems:'center', gap:5, background:'#fef9c3', border:'1px solid #fbbf24', borderRadius:7, padding:'0.25rem 0.65rem', fontSize:'0.78rem', fontWeight:700, color:'#92400e' }}>
                            <Icon name="eye" size={13} /> Modo lectura — solo visualización
                            <button onClick={() => setFiltroCajero(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'#92400e', padding:0, marginLeft:4, display:'flex' }}>
                                <Icon name="x" size={13} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── Banner: Caja ABIERTA ── */}
            {cajaStatus === 'abierta' && (
                <div style={{ background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', border:'2px solid #86efac', borderRadius:12, padding:'0.8rem 1.1rem', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
                    <div style={{ width:36, height:36, borderRadius:'50%', background:'#16a34a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <Icon name="store" size={18} style={{ color:'white' }} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                        <span style={{ fontWeight:800, color:'var(--success)', fontSize:'0.9rem' }}>Caja abierta</span>
                        <span style={{ fontSize:'0.78rem', color:'var(--success)', marginLeft:8 }}>
                            {new Date(cierreHoy.apertura_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
                            {cierreHoy.apertura_usu_nombre ? ` · ${cierreHoy.apertura_usu_nombre}` : ''}
                        </span>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft:10, background:'#16a34a22', borderRadius:999, padding:'1px 10px', fontSize:'0.72rem', fontWeight:700, color:'var(--success)' }}>
                            Efectivo inicial: ${Number(cierreHoy.apertura_efectivo ?? 0).toLocaleString('es-CL')}
                        </span>
                        {cierreHoy.apertura_notas && <div style={{ fontSize:'0.72rem', color:'var(--success)', marginTop:2, fontStyle:'italic' }}>"{cierreHoy.apertura_notas}"</div>}
                    </div>
                    {['superadmin','admin'].includes(userRol) && (
                        <button
                            onClick={handleReabrirCaja}
                            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface)', border:'1.5px solid var(--success)', color:'var(--success)', borderRadius:8, padding:'0.35rem 0.75rem', fontWeight:700, fontSize:'0.75rem', cursor:'pointer', whiteSpace:'nowrap' }}
                        >
                            <Icon name="x" size={13} /> Cancelar apertura
                        </button>
                    )}
                </div>
            )}

            {/* ── Banner: Caja CERRADA ── */}
            {cajaStatus === 'cerrada' && (
                <div style={{ background:'#fefce8', border:'2px solid #fbbf24', borderRadius:12, padding:'0.9rem 1.1rem', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
                    <Icon name="lock" size={22} style={{ color:'var(--warning)', flexShrink:0 }} />
                    <div style={{ flex:1, minWidth:0 }}>
                        <span style={{ fontWeight:800, color:'var(--warning)', fontSize:'0.9rem' }}>Caja cerrada</span>
                        <span style={{ fontSize:'0.8rem', color:'#78350f', marginLeft:8 }}>
                            {cierreHoy.cierre_timestamp && new Date(cierreHoy.cierre_timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
                            {cierreHoy.usu_nombre ? ` · por ${cierreHoy.usu_nombre}` : ''}
                        </span>
                        {/* Diferencia de efectivo */}
                        {cierreHoy.diferencia_efectivo != null && cierreHoy.diferencia_efectivo !== 0 && (
                            <span style={{ marginLeft:8, display:'inline-flex', alignItems:'center', gap:3, background: cierreHoy.diferencia_efectivo < 0 ? '#fef2f2' : '#f0fdf4', borderRadius:999, padding:'1px 9px', fontSize:'0.72rem', fontWeight:700, color: cierreHoy.diferencia_efectivo < 0 ? '#dc2626' : '#16a34a' }}>
                                Dif. efectivo: {cierreHoy.diferencia_efectivo > 0 ? '+' : ''}${Number(cierreHoy.diferencia_efectivo).toLocaleString('es-CL')}
                            </span>
                        )}
                        {cierreHoy.diferencia_efectivo === 0 && cierreHoy.recuento_efectivo != null && (
                            <span style={{ marginLeft:8, display:'inline-flex', alignItems:'center', gap:3, background:'var(--success-light)', borderRadius:999, padding:'1px 9px', fontSize:'0.72rem', fontWeight:700, color:'var(--success)' }}>
                                ✓ Sin diferencias
                            </span>
                        )}
                        {cierreHoy.cierre_notas && <div style={{ fontSize:'0.75rem', color:'#78350f', marginTop:2 }}>"{cierreHoy.cierre_notas}"</div>}
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', flexShrink:0 }}>
                        <button
                            onClick={() => printCierre(cierreHoy)}
                            style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1.5px solid #d97706', color:'var(--warning)', borderRadius:8, padding:'0.4rem 0.85rem', fontWeight:700, fontSize:'0.8rem', cursor:'pointer', whiteSpace:'nowrap' }}
                        >
                            <Icon name="printer" size={14} /> Imprimir
                        </button>
                        {['superadmin','admin'].includes(userRol) && (
                            <button
                                onClick={handleReabrirCaja}
                                style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1.5px solid #ef4444', color:'var(--danger)', borderRadius:8, padding:'0.4rem 0.85rem', fontWeight:700, fontSize:'0.8rem', cursor:'pointer', whiteSpace:'nowrap' }}
                            >
                                <Icon name="lock-open" size={14} /> Reabrir Caja
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Botones: Abrir / Cerrar Caja ── */}
            <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1rem', gap:'0.5rem' }}>
                {cajaStatus === null && !filtroCajero && (
                    <button
                        className="btn"
                        style={{ background:'#16a34a', color:'white', fontWeight:700, gap:6, boxShadow:'0 2px 8px rgba(22,163,74,0.3)' }}
                        onClick={() => { setAperturaError(''); setShowAperturaModal(true); }}
                    >
                        <Icon name="store" size={16} /> Abrir Caja
                    </button>
                )}
                {cajaStatus === 'abierta' && !filtroCajero && (
                    <button
                        className="btn"
                        style={{ background:'#d97706', color:'white', fontWeight:700, gap:6, boxShadow:'0 2px 8px rgba(217,119,6,0.3)' }}
                        onClick={() => { setCierreError(''); setRecuentoEfectivo(''); setShowCierreModal(true); }}
                    >
                        <Icon name="lock" size={16} /> Cerrar Caja
                    </button>
                )}
            </div>

            {/* Balance Cards */}
            <div className="stats-grid routes-stats-grid" style={{ marginBottom: '1.5rem' }}>
                <div className="card stat-card">
                    <div className="stat-icon bg-success-light">
                        <Icon name="arrow-down-circle" size={24} className="text-success" />
                    </div>
                    <div>
                        <div className="text-sm text-muted">Total Ingresos</div>
                        <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                            ${balance.total_ingresos.toLocaleString('es-CL')}
                        </div>
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-danger-light">
                        <Icon name="arrow-up-circle" size={24} className="text-danger" />
                    </div>
                    <div>
                        <div className="text-sm text-muted">Total Egresos</div>
                        <div className="text-2xl font-bold" style={{ color: 'var(--danger)' }}>
                            ${balance.total_egresos.toLocaleString('es-CL')}
                        </div>
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon" style={{ background:'#ede9fe' }}>
                        <Icon name="rotate-ccw" size={24} style={{ color:'#7c3aed' }} />
                    </div>
                    <div>
                        <div className="text-sm text-muted">Reembolsos</div>
                        <div className="text-2xl font-bold" style={{ color:'#7c3aed' }}>
                            ${balance.total_reembolsos.toLocaleString('es-CL')}
                        </div>
                    </div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-primary-light">
                        <Icon name="wallet" size={24} className="text-primary" />
                    </div>
                    <div>
                        <div className="text-sm text-muted">Balance en Caja</div>
                        <div className="text-2xl font-bold" style={{ color: balance.balance >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            ${balance.balance.toLocaleString('es-CL')}
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Gate: caja no abierta → bloquea todo el formulario de ventas ── */}
            {cajaStatus !== 'abierta' ? (
                <div className="card" style={{ padding:'3.5rem 2rem', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'1.5rem', marginBottom:'1.5rem' }}>
                    {cajaStatus === null ? (
                        <>
                            <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#16a34a,#15803d)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 6px 20px rgba(22,163,74,0.35)' }}>
                                <Icon name="store" size={34} style={{ color:'white' }} />
                            </div>
                            <div>
                                <div style={{ fontWeight:800, fontSize:'1.25rem', color:'var(--success)', marginBottom:6 }}>Caja sin abrir</div>
                                <div style={{ color:'#6b7280', fontSize:'0.9rem', maxWidth:320, lineHeight:1.5 }}>
                                    Para registrar ventas y movimientos necesitás <strong>abrir la caja</strong> primero.
                                </div>
                            </div>
                            {!filtroCajero && (
                            <button
                                className="btn"
                                style={{ background:'#16a34a', color:'white', fontWeight:700, fontSize:'1rem', padding:'0.75rem 2.25rem', gap:8, boxShadow:'0 4px 14px rgba(22,163,74,0.35)', borderRadius:10 }}
                                onClick={() => { setAperturaError(''); setShowAperturaModal(true); }}
                            >
                                <Icon name="store" size={20} /> Abrir Caja
                            </button>
                            )}
                        </>
                    ) : (
                        <>
                            <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#fef3c7,#fde68a)', border:'2.5px solid #fbbf24', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 14px rgba(217,119,6,0.2)' }}>
                                <Icon name="lock" size={34} style={{ color:'var(--warning)' }} />
                            </div>
                            <div>
                                <div style={{ fontWeight:800, fontSize:'1.25rem', color:'var(--warning)', marginBottom:6 }}>Caja cerrada</div>
                                <div style={{ color:'#6b7280', fontSize:'0.9rem', maxWidth:340, lineHeight:1.5 }}>
                                    {['superadmin','admin'].includes(userRol)
                                        ? 'La caja de hoy fue cerrada. Podés reabrirla si necesitás registrar más movimientos.'
                                        : 'La caja de hoy fue cerrada. Contactá al administrador para continuar.'}
                                </div>
                            </div>
                            {['superadmin','admin'].includes(userRol) && (
                                <button
                                    className="btn"
                                    style={{ background:'#d97706', color:'white', fontWeight:700, fontSize:'1rem', padding:'0.75rem 2.25rem', gap:8, boxShadow:'0 4px 14px rgba(217,119,6,0.3)', borderRadius:10 }}
                                    onClick={handleReabrirCaja}
                                >
                                    <Icon name="lock-open" size={20} /> Reabrir Caja
                                </button>
                            )}
                        </>
                    )}
                </div>
            ) : (
            <div className="caja-main-grid">
                {/* LEFT: Tipo + Catálogo — oculto en modo lectura */}
                {!filtroCajero && <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                    <div className="card p-5">
                        <div className="input-group mb-0">
                            <label className="label">Tipo</label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                <button type="button"
                                    onClick={() => setTipo('ingreso')}
                                    style={{
                                        padding: '0.6rem',
                                        borderRadius: 8,
                                        border: `2px solid ${tipo === 'ingreso' ? 'var(--success)' : 'var(--border)'}`,
                                        background: tipo === 'ingreso' ? 'var(--success-light)' : 'transparent',
                                        color: tipo === 'ingreso' ? 'var(--success)' : 'var(--text-muted)',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    }}>
                                    <Icon name="arrow-down-circle" size={16} /> Ingreso
                                </button>
                                <button type="button"
                                    onClick={() => setTipo('egreso')}
                                    style={{
                                        padding: '0.6rem',
                                        borderRadius: 8,
                                        border: `2px solid ${tipo === 'egreso' ? 'var(--danger)' : 'var(--border)'}`,
                                        background: tipo === 'egreso' ? 'var(--danger-light)' : 'transparent',
                                        color: tipo === 'egreso' ? 'var(--danger)' : 'var(--text-muted)',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                    }}>
                                    <Icon name="arrow-up-circle" size={16} /> Egreso
                                </button>
                            </div>
                        </div>
                        {catalogo.length > 0 && (
                            <button type="button" onClick={() => {
                                    const abriendo = !showPicker;
                                    setShowPicker(abriendo);
                                    if (abriendo) {
                                        setTimeout(() => {
                                            catalogoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                        }, 50);
                                    }
                                }}
                                className="btn btn-secondary w-full"
                                style={{ justifyContent:'center', gap:6, marginTop:'1rem' }}>
                                <Icon name="package" size={16} /> Ver catálogo de productos
                            </button>
                        )}
                    </div>
                    {/* Panel catálogo — columna izquierda */}
                    {showPicker && catalogo.length > 0 && (() => {
                        const cartTotal = pickerCart.reduce((s, e) => s + Number(e.item.item_precio) * e.cantidad, 0);
                        const cartCount = pickerCart.reduce((s, e) => s + e.cantidad, 0);
                        const addToCart = (item) => {
                            const stock = item.item_stock ?? 0;
                            if (stock === 0) {
                                const unidad = item.item_tipo === 'servicio' ? 'usos' : 'unidades';
                                setPickerStockWarn(`⚠️ Sin stock: "${item.item_nombre}" no tiene ${unidad} disponibles.`);
                                setTimeout(() => setPickerStockWarn(''), 4000);
                                return;
                            }
                            setPickerCart(prev => {
                                const idx = prev.findIndex(e => e.item.item_id === item.item_id);
                                if (idx >= 0) {
                                    const cantActual = prev[idx].cantidad;
                                    if (cantActual >= stock) {
                                        const unidad = item.item_tipo === 'servicio' ? 'usos' : 'unidades';
                                        setPickerStockWarn(`⚠️ Stock insuficiente: solo hay ${stock} ${unidad} de "${item.item_nombre}".`);
                                        setTimeout(() => setPickerStockWarn(''), 4000);
                                        return prev;
                                    }
                                    const next = [...prev]; next[idx] = { ...next[idx], cantidad: cantActual + 1 }; return next;
                                }
                                setPickerStockWarn('');
                                return [...prev, { item, cantidad: 1 }];
                            });
                        };
                        const setCartCantidad = (itemId, v) => {
                            const val = Math.max(1, parseInt(v) || 1);
                            setPickerCart(prev => prev.map(e => {
                                if (e.item.item_id !== itemId) return e;
                                const stock = e.item.item_stock ?? 0;
                                if (stock > 0 && val > stock) {
                                    const unidad = e.item.item_tipo === 'servicio' ? 'usos' : 'unidades';
                                    setPickerStockWarn(`Límite alcanzado: solo hay ${stock} ${unidad} disponibles de "${e.item.item_nombre}". Se ajustó automáticamente.`);
                                    setTimeout(() => setPickerStockWarn(''), 5000);
                                    return { ...e, cantidad: stock };
                                }
                                setPickerStockWarn('');
                                return { ...e, cantidad: val };
                            }));
                        };
                        const removeFromCart = (itemId) => setPickerCart(prev => prev.filter(e => e.item.item_id !== itemId));
                        const confirmCart = () => {
                            if (pickerCart.length === 0) return;
                            // Validación final de stock antes de confirmar
                            const excedido = pickerCart.find(e => {
                                const stock = e.item.item_stock ?? 0;
                                return stock > 0 && e.cantidad > stock;
                            });
                            if (excedido) {
                                const stock = excedido.item.item_stock;
                                const unidad = excedido.item.item_tipo === 'servicio' ? 'usos' : 'unidades';
                                setPickerStockWarn(`No se puede confirmar: "${excedido.item.item_nombre}" supera el stock disponible (máx. ${stock} ${unidad}).`);
                                setTimeout(() => setPickerStockWarn(''), 6000);
                                return;
                            }
                            const label = pickerCart.map(e => e.cantidad > 1 ? `${e.item.item_nombre} x${e.cantidad}` : e.item.item_nombre).join(', ');
                            setConcepto(label); setMonto(String(cartTotal)); setCartSummary([...pickerCart]);
                            setShowPicker(false); setPickerBuscar(''); setPickerCart([]);
                        };
                        const q = pickerBuscar.toLowerCase().trim();
                        const items = q
                            ? catalogo.filter(c => c.item_nombre.toLowerCase().includes(q) || (c.item_descrip || '').toLowerCase().includes(q))
                            : catalogo.filter(c => c.item_tipo === pickerTab);
                        const highlight = (text) => {
                            if (!q || !text) return text;
                            const idx = text.toLowerCase().indexOf(q);
                            if (idx === -1) return text;
                            return <>{text.slice(0, idx)}<mark style={{ background:'#fef08a', borderRadius:2, padding:'0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
                        };
                        return (
                        <div className="card animate-fade-in" ref={catalogoRef}>
                            <div className="p-4 border-b flex justify-between items-center">
                                <h3 className="font-semibold text-lg flex items-center gap-2">
                                    <Icon name="package" size={20} className="text-primary" /> Catálogo
                                    {cartCount > 0 && <span style={{ background:'var(--primary)', color:'white', borderRadius:999, fontSize:'0.72rem', fontWeight:700, padding:'2px 9px' }}>{cartCount} en carrito</span>}
                                </h3>
                                <button className="btn btn-secondary btn-icon" onClick={() => { setShowPicker(false); setPickerBuscar(''); setPickerCart([]); }} title="Cerrar"><Icon name="x" size={18} /></button>
                            </div>
                            <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', background:'var(--bg-color)' }}>
                                <div style={{ position:'relative' }}>
                                    <Icon name="search" size={15} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                                    <input className="input" placeholder="Buscar producto o servicio..." value={pickerBuscar} onChange={e => setPickerBuscar(e.target.value)} style={{ paddingLeft:32, paddingRight: pickerBuscar ? 32 : undefined }} autoFocus />
                                    {pickerBuscar && <button onClick={() => setPickerBuscar('')} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}><Icon name="x-circle" size={15} /></button>}
                                </div>
                            </div>
                            {!pickerBuscar && (
                                <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
                                    {['producto','servicio'].map(t => (
                                        <button key={t} type="button" onClick={() => setPickerTab(t)}
                                            style={{ padding:'0.65rem 1.5rem', border:'none', cursor:'pointer', fontWeight: pickerTab===t ? 700 : 500, background: pickerTab===t ? 'var(--primary-light)' : 'transparent', color: pickerTab===t ? 'var(--primary)' : 'var(--text-muted)', fontSize:'0.875rem', borderBottom: pickerTab===t ? '2px solid var(--primary)' : '2px solid transparent', transition:'all 0.15s' }}>
                                            {t === 'producto' ? '📦 Productos' : '🔧 Servicios'}
                                            <span className="badge badge-primary" style={{ marginLeft:6, fontSize:'0.7rem' }}>{catalogo.filter(c => c.item_tipo === t).length}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {q && <div style={{ padding:'0.5rem 1rem 0', fontSize:'0.78rem', color:'var(--text-muted)' }}>{items.length === 0 ? 'Sin resultados' : `${items.length} resultado${items.length !== 1 ? 's' : ''} para "${pickerBuscar}"`}</div>}
                            {pickerStockWarn && (
                                <div style={{ margin:'0.6rem 1rem 0', padding:'0.65rem 0.9rem', borderRadius:8, background:'#fef9c3', border:'1.5px solid #f59e0b', color:'var(--warning)', fontSize:'0.82rem', fontWeight:600, display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                    <span style={{ fontSize:'1rem' }}>⚠️</span>
                                    <span>{pickerStockWarn.replace(/^⚠️\s*/, '')}</span>
                                </div>
                            )}
                            <div style={{ padding:'0.75rem 1rem 1rem', display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'0.5rem' }}>
                                {items.length === 0 ? (
                                    <div style={{ gridColumn:'1/-1', textAlign:'center', color:'var(--text-muted)', padding:'2rem', fontSize:'0.9rem' }}>
                                        <Icon name="search-x" size={32} className="mb-2" />
                                        <div>{q ? `Sin resultados para "${pickerBuscar}"` : `Sin ${pickerTab === 'producto' ? 'productos' : 'servicios'} registrados`}</div>
                                    </div>
                                ) : items.map(item => {
                                    const cartEntry = pickerCart.find(e => e.item.item_id === item.item_id);
                                    const inCart = !!cartEntry;
                                    const sinStock = (item.item_stock ?? 0) === 0;
                                    return (
                                        <div key={item.item_id}
                                            style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.7rem 0.85rem', borderRadius:8, border: sinStock ? '1.5px solid #fca5a5' : inCart ? '2px solid var(--primary)' : '1px solid var(--border)', background: sinStock ? '#fef2f2' : inCart ? 'var(--primary-light)' : 'var(--surface, white)', transition:'all 0.15s', boxShadow: inCart && !sinStock ? '0 0 0 3px rgba(79,70,229,0.1)' : '0 1px 3px rgba(0,0,0,0.05)', cursor: sinStock ? 'not-allowed' : 'pointer', opacity: sinStock ? 0.7 : 1 }}
                                            onClick={() => addToCart(item)}>
                                            <div style={{ flex:1, minWidth:0 }}>
                                                <div style={{ fontWeight:700, fontSize:'0.875rem', color: sinStock ? '#9ca3af' : 'var(--text)', lineHeight:1.3, marginBottom:'0.2rem', display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                                                    <span style={{ overflow:'hidden', textOverflow:'ellipsis' }}>{highlight(item.item_nombre)}</span>
                                                    {inCart && !sinStock && <span style={{ background:'var(--primary)', color:'white', borderRadius:999, fontSize:'0.65rem', fontWeight:800, padding:'1px 7px', flexShrink:0 }}>×{cartEntry.cantidad}</span>}
                                                    {sinStock && <span style={{ background:'#ef4444', color:'white', borderRadius:999, fontSize:'0.62rem', fontWeight:800, padding:'1px 7px', flexShrink:0 }}>SIN STOCK</span>}
                                                </div>
                                                <div style={{ fontSize:'0.82rem', color: sinStock ? '#9ca3af' : 'var(--primary)', fontWeight:700 }}>Precio: ${Number(item.item_precio).toLocaleString('es-PY')}</div>
                                                {(() => { const s = item.item_stock ?? 0; const sc = s === 0 ? '#ef4444' : s <= 5 ? '#f59e0b' : '#16a34a'; return <div style={{ fontSize:'0.7rem', color: sc, fontWeight:600, marginTop:'0.1rem' }}>Stock: {s} {item.item_tipo === 'servicio' ? 'usos' : 'u.'}</div>; })()}
                                                {item.item_descrip && <div style={{ fontSize:'0.71rem', color:'var(--text-muted)', marginTop:'0.15rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{highlight(item.item_descrip)}</div>}
                                            </div>
                                            {item.item_imagen ? (
                                                <img src={item.item_imagen} alt={item.item_nombre} style={{ width:62, height:62, objectFit:'cover', borderRadius:6, border:'1px solid var(--border)', flexShrink:0, filter: sinStock ? 'grayscale(60%)' : 'none' }} />
                                            ) : (
                                                <div style={{ width:62, height:62, display:'flex', alignItems:'center', justifyContent:'center', background: sinStock ? '#f3f4f6' : 'var(--bg-color)', borderRadius:6, border:'1px solid var(--border)', flexShrink:0, fontSize:'1.6rem' }}>
                                                    {item.item_tipo === 'producto' ? '📦' : '🔧'}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {pickerCart.length > 0 && (
                                <div style={{ borderTop:'2px solid var(--primary)', background:'var(--primary-light)', padding:'1rem' }}>
                                    <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--primary)', marginBottom:'0.6rem', display:'flex', alignItems:'center', gap:6 }}>
                                        <Icon name="shopping-cart" size={16} /> Carrito ({pickerCart.length} {pickerCart.length === 1 ? 'ítem' : 'ítems'})
                                    </div>
                                    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', marginBottom:'0.75rem' }}>
                                        {pickerCart.map(entry => {
                                            const stock = entry.item.item_stock ?? 0;
                                            const enLimite = stock > 0 && entry.cantidad >= stock;
                                            const unidad = entry.item.item_tipo === 'servicio' ? 'usos' : 'u.';
                                            return (
                                            <div key={entry.item.item_id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', background:'var(--surface)', borderRadius:8, padding:'0.45rem 0.6rem', border: enLimite ? '1.5px solid #f59e0b' : '1px solid var(--border)' }}>
                                                {entry.item.item_imagen ? (
                                                    <img src={entry.item.item_imagen} alt={entry.item.item_nombre} style={{ width:24, height:24, objectFit:'cover', borderRadius:5, border:'1px solid var(--border)', flexShrink:0 }} />
                                                ) : (
                                                    <span style={{ flexShrink:0 }}>{entry.item.item_tipo === 'producto' ? '📦' : '🔧'}</span>
                                                )}
                                                <div style={{ flex:1, minWidth:0 }}>
                                                    <span style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'block' }} title={entry.item.item_nombre}>
                                                        {entry.item.item_nombre}
                                                    </span>
                                                    {enLimite && (
                                                        <span style={{ fontSize:'0.66rem', color:'#b45309', fontWeight:600 }}>⚠️ Límite de stock ({stock} {unidad})</span>
                                                    )}
                                                </div>
                                                <div style={{ display:'flex', alignItems:'center', gap:3, flexShrink:0 }}>
                                                    <button type="button" onClick={() => setCartCantidad(entry.item.item_id, entry.cantidad - 1)} style={{ width:22, height:22, border:'1px solid var(--primary)', borderRadius:5, background:'var(--surface)', color:'var(--primary)', fontWeight:700, fontSize:'0.9rem', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                                                    <input type="number" min={1} max={stock > 0 ? stock : undefined} value={entry.cantidad} onChange={e => setCartCantidad(entry.item.item_id, e.target.value)} onClick={e => e.stopPropagation()} style={{ width:36, textAlign:'center', border:`1px solid ${enLimite ? '#f59e0b' : 'var(--border)'}`, borderRadius:5, padding:'1px 3px', fontSize:'0.82rem', fontWeight:700, color: enLimite ? '#b45309' : 'inherit' }} />
                                                    <button type="button" onClick={() => setCartCantidad(entry.item.item_id, entry.cantidad + 1)} disabled={enLimite}
                                                        style={{ width:22, height:22, border:`1px solid ${enLimite ? '#d1d5db' : 'var(--primary)'}`, borderRadius:5, background: enLimite ? '#f3f4f6' : 'white', color: enLimite ? '#9ca3af' : 'var(--primary)', fontWeight:700, fontSize:'0.9rem', cursor: enLimite ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                                                </div>
                                                <span style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--primary)', flexShrink:0, minWidth:60, textAlign:'right' }}>${(Number(entry.item.item_precio) * entry.cantidad).toLocaleString('es-CL')}</span>
                                                <button type="button" onClick={() => removeFromCart(entry.item.item_id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger, #ef4444)', display:'flex', padding:2, flexShrink:0 }}><Icon name="trash-2" size={14} /></button>
                                            </div>
                                            );
                                        })}
                                    </div>
                                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.75rem' }}>
                                        <div style={{ fontSize:'1rem', fontWeight:800, color:'var(--primary)' }}>Total: ${cartTotal.toLocaleString('es-CL')}</div>
                                        <div style={{ display:'flex', gap:'0.5rem' }}>
                                            <button type="button" onClick={() => setPickerCart([])} style={{ padding:'0.45rem 0.85rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text-muted)', fontSize:'0.8rem', fontWeight:600, cursor:'pointer' }}>Vaciar</button>
                                            <button type="button" onClick={confirmCart} style={{ padding:'0.45rem 1.1rem', borderRadius:8, border:'none', background:'var(--primary)', color:'white', fontSize:'0.85rem', fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}><Icon name="check" size={15} /> Confirmar selección</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                        );
                    })()}
                </div>}{/* fin columna izquierda */}

                {/* RIGHT: Movimientos + Cliente picker + Formulario */}
                <div style={{ display:'flex', flexDirection:'column', gap:'1.5rem' }}>

                <div className="card">
                    <div className="p-4 border-b flex justify-between items-center">
                        <h3 className="font-semibold text-lg">Movimientos de Caja</h3>
                        <span className="badge badge-success">{movimientos.length} registros</span>
                    </div>
                    {loading ? (
                        <div className="p-8 text-center text-muted">Cargando...</div>
                    ) : movimientos.length === 0 ? (
                        <div className="p-8 text-center text-muted">
                            <Icon name="inbox" size={40} className="mb-2" />
                            <div>Sin movimientos registrados</div>
                        </div>
                    ) : (() => {
                        const totalPaginas = Math.ceil(movimientos.length / MOV_POR_PAGINA);
                        const paginaActual = Math.min(pagina, totalPaginas);
                        const movsPagina = movimientos.slice((paginaActual - 1) * MOV_POR_PAGINA, paginaActual * MOV_POR_PAGINA);
                        return (
                            <>
                            <div className="table-wrapper">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>#</th>
                                            <th>Tipo</th>
                                            <th>Concepto</th>
                                            <th>Monto</th>
                                            <th>Método</th>
                                            <th>Fecha</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {movsPagina.map(mov => {
                                            const esReembolso = mov.mov_es_reembolso === 1;
                                            const metodoPagoIcon = { efectivo: '💵', tarjeta: '💳', transferencia: '🏦', mixto: '💸' }[mov.mov_metodo_pago] || '';
                                            return (
                                            <tr key={mov.mov_id}
                                                onClick={() => setMovDetalle(mov)}
                                                style={{ cursor:'pointer', background: esReembolso ? '#faf5ff' : undefined, transition:'background 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = esReembolso ? '#f3eeff' : 'var(--bg-color)'}
                                                onMouseLeave={e => e.currentTarget.style.background = esReembolso ? '#faf5ff' : ''}>
                                                <td className="text-muted text-xs">#{mov.mov_id}</td>
                                                <td>
                                                    {esReembolso ? (
                                                        <span className="badge" style={{ background:'#ede9fe', color:'#6d28d9' }}>⟲ Reembolso</span>
                                                    ) : (
                                                        <span className={`badge ${mov.mov_tipo === 'ingreso' ? 'badge-success' : 'badge-danger'}`}>
                                                            {mov.mov_tipo === 'ingreso' ? '↓ Ingreso' : '↑ Egreso'}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="font-medium" style={{ minWidth:200, maxWidth:300 }}>
                                                    <div>{mov.mov_concepto}</div>
                                                    {mov.cli_nombre_snap && (
                                                        <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:3 }}>
                                                            <span style={{ fontSize:'0.68rem', background:'var(--primary-light)', color:'var(--primary)', borderRadius:999, padding:'1px 7px', fontWeight:700, border:'1px solid var(--primary)' }}>
                                                                👤 {mov.cli_nombre_snap}
                                                            </span>
                                                        </div>
                                                    )}
                                                    {mov.mov_ref_id && <div className="text-xs text-muted">Ref. #{mov.mov_ref_id}</div>}
                                                </td>
                                                <td className="font-bold" style={{ color: esReembolso ? '#7c3aed' : (mov.mov_tipo === 'ingreso' ? 'var(--success)' : 'var(--danger)') }}>
                                                    ${Number(mov.mov_monto).toLocaleString('es-CL')}
                                                </td>
                                                <td className="text-sm">
                                                    <div>{metodoPagoIcon} <span className="text-xs text-muted">{mov.mov_metodo_pago || '—'}</span></div>
                                                </td>
                                                <td className="text-xs text-muted">
                                                    {new Date(mov.mov_timestamp).toLocaleString('es-CL', { timeZone:'America/Asuncion' })}
                                                </td>
                                            </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {/* Paginación */}
                            {totalPaginas > 1 && (
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1rem', borderTop:'1px solid var(--border)', background:'var(--bg-color)' }}>
                                    <span className="text-xs text-muted">
                                        Mostrando {(paginaActual - 1) * MOV_POR_PAGINA + 1}–{Math.min(paginaActual * MOV_POR_PAGINA, movimientos.length)} de {movimientos.length}
                                    </span>
                                    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center' }}>
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            disabled={paginaActual === 1}
                                            onClick={() => setPagina(1)}
                                            title="Primera página"
                                            style={{ opacity: paginaActual === 1 ? 0.4 : 1 }}>
                                            <Icon name="chevrons-left" size={15} />
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            disabled={paginaActual === 1}
                                            onClick={() => setPagina(p => Math.max(1, p - 1))}
                                            title="Página anterior"
                                            style={{ opacity: paginaActual === 1 ? 0.4 : 1 }}>
                                            <Icon name="chevron-left" size={15} />
                                        </button>
                                        {Array.from({ length: totalPaginas }, (_, i) => i + 1).map(n => (
                                            <button key={n}
                                                onClick={() => setPagina(n)}
                                                style={{
                                                    minWidth: 32, height: 32, borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: n === paginaActual ? 700 : 400,
                                                    background: n === paginaActual ? 'var(--primary)' : 'transparent',
                                                    color: n === paginaActual ? 'white' : 'var(--text-muted)',
                                                    transition: 'all 0.15s',
                                                }}>
                                                {n}
                                            </button>
                                        ))}
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            disabled={paginaActual === totalPaginas}
                                            onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                                            title="Página siguiente"
                                            style={{ opacity: paginaActual === totalPaginas ? 0.4 : 1 }}>
                                            <Icon name="chevron-right" size={15} />
                                        </button>
                                        <button
                                            className="btn btn-secondary btn-icon"
                                            disabled={paginaActual === totalPaginas}
                                            onClick={() => setPagina(totalPaginas)}
                                            title="Última página"
                                            style={{ opacity: paginaActual === totalPaginas ? 0.4 : 1 }}>
                                            <Icon name="chevrons-right" size={15} />
                                        </button>
                                    </div>
                                </div>
                            )}
                            </>
                        );
                    })()}
                </div>

                {/* Panel picker de clientes */}
                {showClientePicker && (() => {
                    const q = clientePickerBuscar.toLowerCase().trim();
                    const filtered = cajaClientes.filter(c =>
                        (clientePickerTipo === 'todos' || c.tipo === clientePickerTipo)
                    );
                    const highlightCli = (text) => {
                        if (!q || !text) return text;
                        const idx = text.toLowerCase().indexOf(q);
                        if (idx === -1) return text;
                        return <>{text.slice(0, idx)}<mark style={{ background:'#fef08a', borderRadius:2, padding:'0 1px' }}>{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
                    };
                    return (
                    <div className="card animate-fade-in" ref={clientePickerRef}>
                        {/* Header */}
                        <div className="p-4 border-b flex justify-between items-center" style={{ gap:'0.75rem', flexWrap:'wrap' }}>
                            <h3 className="font-semibold text-lg flex items-center gap-2">
                                <Icon name="users" size={20} className="text-primary" />
                                {cliPickerModo === 'clientes' ? 'Clientes' : 'Buscar por Máquina'}
                                {cliPickerModo === 'clientes' && !cajaCliLoading && <span style={{ background:'var(--primary)', color:'white', borderRadius:999, fontSize:'0.72rem', fontWeight:700, padding:'2px 9px' }}>{filtered.length}</span>}
                            </h3>
                            <div style={{ display:'flex', gap:'0.4rem', marginLeft:'auto' }}>
                                <button type="button"
                                    onClick={() => { setCliPickerModo('clientes'); setMaqPickerBusqueda(''); }}
                                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.8rem', fontWeight:700, padding:'5px 12px', borderRadius:999, border:'none', cursor:'pointer', background: cliPickerModo==='clientes' ? 'var(--primary)' : 'var(--bg-secondary)', color: cliPickerModo==='clientes' ? 'white' : 'var(--text-muted)', transition:'all 0.15s' }}>
                                    <Icon name="users" size={13} /> Clientes
                                </button>
                                <button type="button"
                                    onClick={() => { setCliPickerModo('maquina'); setClientePickerBuscar(''); }}
                                    style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.8rem', fontWeight:700, padding:'5px 12px', borderRadius:999, border:'none', cursor:'pointer', background: cliPickerModo==='maquina' ? 'var(--primary)' : 'var(--bg-secondary)', color: cliPickerModo==='maquina' ? 'white' : 'var(--text-muted)', transition:'all 0.15s' }}>
                                    <Icon name="cpu" size={13} /> Por Máquina
                                </button>
                                <button className="btn btn-secondary btn-icon" onClick={() => { setShowClientePicker(false); setClientePickerBuscar(''); setCliPickerModo('clientes'); setMaqPickerBusqueda(''); }} title="Cerrar">
                                    <Icon name="x" size={18} />
                                </button>
                            </div>
                        </div>

                        {/* ── Modo: selector por máquina (cascada) ── */}
                        {cliPickerModo === 'maquina' && (
                            <div>
                                {/* Search filter */}
                                <div style={{ padding:'0.65rem 1rem', borderBottom:'1px solid var(--border)', background:'var(--bg-color)', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                    <Icon name="search" size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                    <input className="input" placeholder="Buscar cliente o máquina..."
                                        value={maqPickerBusqueda}
                                        onChange={e => setMaqPickerBusqueda(e.target.value)}
                                        autoFocus style={{ flex:1 }} />
                                    {maqPickerBusqueda && (
                                        <button type="button" onClick={() => setMaqPickerBusqueda('')}
                                            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}>
                                            <Icon name="x-circle" size={14} />
                                        </button>
                                    )}
                                </div>

                                {/* Cascade list */}
                                <div style={{ maxHeight:360, overflowY:'auto' }}>
                                    {maqPickerCargando ? (
                                        <div style={{ textAlign:'center', padding:'2.5rem', color:'var(--text-muted)' }}>
                                            <Icon name="loader" size={24} className="animate-spin" />
                                            <div style={{ marginTop:'0.5rem', fontSize:'0.83rem' }}>Cargando máquinas...</div>
                                        </div>
                                    ) : clientesMaquinasPickerFiltrados.length === 0 ? (
                                        <div style={{ textAlign:'center', padding:'2.5rem', color:'var(--text-muted)' }}>
                                            <Icon name="cpu" size={32} className="mb-2" />
                                            <div style={{ fontWeight:600, fontSize:'0.875rem' }}>
                                                {maqPickerBusqueda ? `Sin resultados para "${maqPickerBusqueda}"` : 'Ninguna máquina tiene cliente asignado'}
                                            </div>
                                        </div>
                                    ) : clientesMaquinasPickerFiltrados.map(grupo => (
                                        <div key={grupo.cliId}>
                                            {/* Client header */}
                                            <div style={{ display:'flex', alignItems:'center', gap:'0.65rem', padding:'0.55rem 1rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:1 }}>
                                                <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.8rem', flexShrink:0 }}>
                                                    {grupo.nombre.charAt(0).toUpperCase()}
                                                </div>
                                                <span style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text)', flex:1 }}>{grupo.nombre}</span>
                                                <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600, background:'var(--border)', borderRadius:999, padding:'1px 8px' }}>
                                                    {grupo.maquinas.length} máq.
                                                </span>
                                            </div>
                                            {/* Machines */}
                                            {grupo.maquinas.map((maq, idx) => {
                                                const dotColor = { ok:'#16a34a', mantenimiento:'#d97706', fuera_servicio:'#dc2626', baja:'#9ca3af', warning:'#f59e0b', inactiva:'#9ca3af' }[maq.status] ?? '#9ca3af';
                                                return (
                                                    <button key={maq.id} type="button"
                                                        onClick={() => {
                                                            setClienteSeleccionado({ id: maq.cliId, nombre: maq.clienteNombre, tipo: 'persona' });
                                                            setShowClientePicker(false);
                                                            setMaqPickerBusqueda('');
                                                            setCliPickerModo('clientes');
                                                        }}
                                                        style={{ width:'100%', display:'flex', alignItems:'center', gap:'0.7rem', padding:'0.6rem 1rem 0.6rem 1.75rem', border:'none', borderBottom: idx < grupo.maquinas.length - 1 ? '1px solid var(--border)' : 'none', background:'var(--surface)', cursor:'pointer', textAlign:'left', transition:'all 0.12s' }}
                                                        onMouseEnter={e => { e.currentTarget.style.background='var(--primary-light)'; e.currentTarget.style.paddingLeft='2rem'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.background='var(--surface)'; e.currentTarget.style.paddingLeft='1.75rem'; }}>
                                                        <div style={{ width:9, height:9, borderRadius:'50%', background:dotColor, flexShrink:0 }} />
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text)' }}>MQ {maq.id}</div>
                                                            {(maq.type || maq.location) && (
                                                                <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:1 }}>
                                                                    {[maq.type, maq.location].filter(Boolean).join(' · ')}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <Icon name="chevron-right" size={15} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Modo: búsqueda por nombre/RUC (clásico) ── */}
                        {cliPickerModo === 'clientes' && <>
                        {/* Buscador */}
                        <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', background:'var(--bg-color)' }}>
                            <div style={{ position:'relative' }}>
                                <Icon name="search" size={15} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                                <input className="input" placeholder="Buscar por nombre, RUC, email, teléfono..."
                                    value={clientePickerBuscar}
                                    onChange={e => setClientePickerBuscar(e.target.value)}
                                    style={{ paddingLeft:32, paddingRight: clientePickerBuscar ? 32 : undefined }}
                                    autoFocus />
                                {clientePickerBuscar && (
                                    <button onClick={() => setClientePickerBuscar('')} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}>
                                        <Icon name="x-circle" size={15} />
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Tabs tipo */}
                        <div style={{ display:'flex', borderBottom:'1px solid var(--border)' }}>
                            {[['todos','Todos'],['persona','👤 Personas'],['empresa','🏢 Empresas']].map(([val, label]) => (
                                <button key={val} type="button" onClick={() => setClientePickerTipo(val)}
                                    style={{ padding:'0.6rem 1.2rem', border:'none', cursor:'pointer', fontWeight: clientePickerTipo===val ? 700 : 500, background: clientePickerTipo===val ? 'var(--primary-light)' : 'transparent', color: clientePickerTipo===val ? 'var(--primary)' : 'var(--text-muted)', fontSize:'0.85rem', borderBottom: clientePickerTipo===val ? '2px solid var(--primary)' : '2px solid transparent', transition:'all 0.15s' }}>
                                    {label}
                                </button>
                            ))}
                        </div>

                        {/* Lista de clientes */}
                        <div style={{ padding:'0.75rem 1rem 1rem', display:'flex', flexDirection:'column', gap:'0.5rem', maxHeight:340, overflowY:'auto' }}>
                            {cajaCliLoading ? (
                                <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}><Icon name="loader" size={24} className="animate-spin" /></div>
                            ) : filtered.length === 0 ? (
                                <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>
                                    <Icon name="users" size={32} className="mb-2" />
                                    <div style={{ fontWeight:600 }}>{q ? `Sin resultados para "${clientePickerBuscar}"` : 'No hay clientes registrados'}</div>
                                </div>
                            ) : filtered.map(c => (
                                <button key={c.id} type="button"
                                    onClick={() => { setClienteSeleccionado({ id: c.id, nombre: c.nombre, tipo: c.tipo }); setShowClientePicker(false); setClientePickerBuscar(''); setCliPickerModo('clientes'); setMaqPickerBusqueda(''); }}
                                    style={{ display:'flex', alignItems:'center', gap:'0.7rem', padding:'0.65rem 0.8rem', borderRadius:10, border:'1px solid var(--border)', background:'var(--surface)', textAlign:'left', cursor:'pointer', transition:'all 0.15s', width:'100%' }}
                                    onMouseEnter={e => { e.currentTarget.style.background='var(--primary-light)'; e.currentTarget.style.borderColor='var(--primary)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background='white'; e.currentTarget.style.borderColor='var(--border)'; }}>
                                    <div style={{ width:36, height:36, borderRadius:'50%', background: c.tipo==='empresa' ? '#7c3aed' : 'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.95rem', flexShrink:0 }}>
                                        {c.nombre.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{highlightCli(c.nombre)}</div>
                                        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', display:'flex', gap:6, flexWrap:'wrap', marginTop:1 }}>
                                            <span>{c.tipo === 'empresa' ? '🏢 Empresa' : '👤 Persona'}</span>
                                            {c.rucCi && <span>· {highlightCli(c.rucCi)}</span>}
                                            {c.email && <span>· {highlightCli(c.email)}</span>}
                                            {c.telefono && <span>· {highlightCli(c.telefono)}</span>}
                                        </div>
                                    </div>
                                    <Icon name="chevron-right" size={16} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                </button>
                            ))}
                        </div>

                        {/* Footer: nuevo cliente */}
                        <div style={{ padding:'0.75rem 1rem', borderTop:'1px solid var(--border)', background:'var(--bg-color)', display:'flex', justifyContent:'flex-end' }}>
                            <button type="button"
                                onClick={() => { setCajaModalCli(true); setCajaFormCli({ nombre:'', tipo:'persona', rucCi:'', email:'', telefono:'', direccion:'', contacto:'', notas:'', lat:null, lng:null }); setCajaErrorCli(''); }}
                                style={{ fontSize:'0.85rem', fontWeight:700, padding:'7px 16px', borderRadius:999, border:'none', background:'var(--primary)', color:'white', cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                                <Icon name="user-plus" size={14} /> Nuevo Cliente
                            </button>
                        </div>
                        </>}
                    </div>
                    );
                })()}

                {/* Formulario: Nuevo Movimiento — oculto en modo lectura */}
                {filtroCajero && (
                    <div className="card p-6" style={{ textAlign:'center', color:'var(--text-muted)', display:'flex', flexDirection:'column', alignItems:'center', gap:'0.75rem' }}>
                        <Icon name="eye" size={32} style={{ opacity:0.35 }} />
                        <div style={{ fontWeight:700, fontSize:'0.95rem' }}>Modo lectura</div>
                        <div style={{ fontSize:'0.82rem', lineHeight:1.5 }}>
                            Estás viendo la caja de <strong>{filtroCajero.nombre}</strong>.<br />
                            Solo podés visualizar sus movimientos — no podés registrar nuevos.
                        </div>
                        <button className="btn btn-secondary" style={{ marginTop:'0.25rem', gap:5 }} onClick={() => setFiltroCajero(null)}>
                            <Icon name="arrow-left" size={14} /> Volver a mi caja
                        </button>
                    </div>
                )}
                {!filtroCajero && (
                <div className="card p-6" style={{ position:'relative', overflow:'hidden' }}>
                    <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                        <Icon name="plus-circle" size={20} className="text-primary" /> Nuevo Movimiento
                    </h3>
                    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                        {/* ── Selector de cliente ── */}
                        <div className="input-group mb-0" style={{ position:'relative' }}>
                            <label className="label" style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <Icon name="user" size={13} /> Cliente <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', fontWeight:400 }}>(opcional)</span>
                            </label>
                            {clienteSeleccionado ? (
                                <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.55rem 0.8rem', borderRadius:8, border:'2px solid var(--primary)', background:'var(--primary-light)' }}>
                                    <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.85rem', flexShrink:0 }}>
                                        {clienteSeleccionado.nombre.charAt(0).toUpperCase()}
                                    </div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{clienteSeleccionado.nombre}</div>
                                        <div style={{ fontSize:'0.72rem', color:'var(--primary)', fontWeight:600 }}>{clienteSeleccionado.tipo === 'empresa' ? '🏢 Empresa' : '👤 Persona'}</div>
                                    </div>
                                    <button type="button" onClick={() => setClienteSeleccionado(null)}
                                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', display:'flex', padding:3, flexShrink:0 }} title="Quitar cliente">
                                        <Icon name="x" size={16} />
                                    </button>
                                </div>
                            ) : (
                                <button type="button"
                                    onClick={() => { setShowClientePicker(v => !v); setClientePickerBuscar(''); setClientePickerTipo('todos'); setCliPickerModo('clientes'); setMaqPickerBusqueda(''); setTimeout(() => clientePickerRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }), 50); }}
                                    className="btn btn-secondary w-full"
                                    style={{ justifyContent:'center', gap:6 }}>
                                    <Icon name="users" size={16} /> Seleccionar cliente
                                </button>
                            )}
                        </div>

                        <div className="input-group mb-0">
                            <label className="label">Concepto</label>
                            <input
                                className="input"
                                placeholder="Ej: Fondo inicial, Pago proveedor..."
                                value={concepto}
                                onChange={e => { setConcepto(e.target.value); setCartSummary([]); }}
                                required
                            />
                        </div>

                        {/* Resumen del carrito */}
                        {cartSummary.length > 0 && (
                            <div className="animate-fade-in" style={{ borderRadius:10, border:'1px solid var(--border)', overflow:'hidden' }}>
                                <div style={{ padding:'0.55rem 0.75rem', background:'var(--primary-light)', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid var(--border)' }}>
                                    <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--primary)', display:'flex', alignItems:'center', gap:5 }}>
                                        <Icon name="shopping-cart" size={13} /> Resumen de productos
                                    </span>
                                    <button type="button" onClick={() => { setCartSummary([]); setConcepto(''); setMonto(''); }}
                                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }} title="Limpiar selección">
                                        <Icon name="x" size={13} />
                                    </button>
                                </div>
                                <div style={{ background:'var(--surface)' }}>
                                    {cartSummary.map((entry, i) => {
                                        const subtotal = Number(entry.item.item_precio) * entry.cantidad;
                                        return (
                                            <div key={entry.item.item_id} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.45rem 0.75rem', borderBottom: i < cartSummary.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                <span style={{ fontSize:'1rem' }}>{entry.item.item_tipo === 'producto' ? '📦' : '🔧'}</span>
                                                <span style={{ flex:1, fontSize:'0.8rem', fontWeight:500, color:'var(--text)' }}>{entry.item.item_nombre}</span>
                                                <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>
                                                    {entry.cantidad > 1 && <><strong>{entry.cantidad}</strong> × ${Number(entry.item.item_precio).toLocaleString('es-CL')} = </>}
                                                    <strong style={{ color:'var(--text)' }}>${subtotal.toLocaleString('es-CL')}</strong>
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ padding:'0.5rem 0.75rem', background:'var(--bg-color)', borderTop:'2px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                                    <span style={{ fontSize:'0.8rem', color:'var(--text-muted)', fontWeight:600 }}>
                                        {cartSummary.length} {cartSummary.length === 1 ? 'ítem' : 'ítems'} · {cartSummary.reduce((s,e)=>s+e.cantidad,0)} unidades
                                    </span>
                                    <span style={{ fontSize:'1rem', fontWeight:800, color:'var(--primary)' }}>
                                        Total: ${cartSummary.reduce((s,e)=>s+Number(e.item.item_precio)*e.cantidad,0).toLocaleString('es-CL')}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="input-group mb-0">
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.25rem' }}>
                                <label className="label" style={{ margin:0 }}>Monto ($)</label>
                                {cartSummary.length > 0 && (
                                    <span style={{ fontSize:'0.7rem', color:'var(--primary)', fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>
                                        <Icon name="lock" size={11} /> Calculado desde catálogo
                                    </span>
                                )}
                            </div>
                            {cartSummary.length > 0 ? (
                                <div style={{ padding:'0.65rem 0.9rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-color)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    <span style={{ fontSize:'1.15rem', fontWeight:800, color:'var(--primary)', letterSpacing:'-0.01em' }}>
                                        ${Number(monto).toLocaleString('es-CL')}
                                    </span>
                                    <span style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>
                                        {cartSummary.reduce((s,e)=>s+e.cantidad,0)} unidades
                                    </span>
                                </div>
                            ) : (
                                <input className="input" type="number" min="1" step="1" placeholder="0" value={monto} onChange={e => setMonto(e.target.value)} required />
                            )}
                        </div>

                        {/* ── Método de Pago ── */}
                        <div style={{ borderTop:'2px dashed var(--border)', paddingTop:'1rem' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
                                <span style={{ fontWeight:700, fontSize:'0.9rem', color:'var(--text)', display:'flex', alignItems:'center', gap:6 }}>
                                    <Icon name="credit-card" size={16} className="text-primary" /> Método de Pago
                                </span>
                                <button type="button"
                                    onClick={() => { setDividirPago(d => !d); setPagosDiv([PAGO_VACIO(), PAGO_VACIO()]); }}
                                    style={{ fontSize:'0.9rem', fontWeight:800, padding:'8px 18px', borderRadius:999, border:`2px solid var(--primary)`, background: dividirPago ? 'var(--primary)' : 'white', color: dividirPago ? 'white' : 'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', gap:6, letterSpacing:'0.01em', boxShadow: dividirPago ? 'none' : '0 0 0 1px var(--primary)' }}>
                                    <Icon name="split" size={15} /> {dividirPago ? 'Pago único' : 'Dividir pago'}
                                </button>
                            </div>
                            {!dividirPago && (<>
                                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.4rem' }}>
                                    {METODOS_PAGO.map(m => (
                                        <button key={m.id} type="button" onClick={() => setMetodoPago(m.id)}
                                            style={{ padding:'0.5rem 0.25rem', borderRadius:8, border:`2px solid ${metodoPago===m.id ? 'var(--primary)' : 'var(--border)'}`, background: metodoPago===m.id ? 'var(--primary-light)' : 'transparent', color: metodoPago===m.id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: metodoPago===m.id ? 700 : 500, cursor:'pointer', fontSize:'0.78rem', display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                                            <span style={{ fontSize:'1.1rem' }}>{m.icon}</span>{m.label}
                                        </button>
                                    ))}
                                </div>
                                {metodoPago === 'tarjeta' && (
                                    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'0.6rem', padding:'0.75rem', borderRadius:8, background:'var(--primary-light)', border:'1px solid var(--primary)', marginTop:'0.5rem' }}>
                                        <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--primary)' }}>💳 Datos de Tarjeta</div>
                                        <div>
                                            <label className="label" style={{ fontSize:'0.75rem' }}>Tipo de tarjeta</label>
                                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem' }}>
                                                {[{id:'debito',label:'Débito'},{id:'credito',label:'Crédito'}].map(t => (
                                                    <button key={t.id} type="button" onClick={() => setTarjTipo(t.id)}
                                                        style={{ padding:'0.45rem', borderRadius:6, border:`2px solid ${tarjTipo===t.id ? 'var(--primary)' : 'var(--border)'}`, background: tarjTipo===t.id ? 'white' : 'transparent', color: tarjTipo===t.id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: tarjTipo===t.id ? 700 : 500, cursor:'pointer', fontSize:'0.78rem' }}>{t.label}</button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="label" style={{ fontSize:'0.75rem' }}>Últimos 4 dígitos <span style={{ color:'var(--danger)' }}>*</span></label>
                                            <input className="input" type="text" inputMode="numeric" maxLength={4} placeholder="0000" value={tarjUltimos4} onChange={e => setTarjUltimos4(e.target.value.replace(/\D/g,'').slice(0,4))} style={{ letterSpacing:'0.25em', fontWeight:700, fontSize:'1.1rem', textAlign:'center' }} />
                                        </div>
                                    </div>
                                )}
                                {metodoPago === 'transferencia' && (
                                    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'0.6rem', padding:'0.75rem', borderRadius:8, background:'var(--primary-light)', border:'1px solid var(--primary)', marginTop:'0.5rem' }}>
                                        <div style={{ fontSize:'0.78rem', fontWeight:700, color:'#1d4ed8' }}>🏦 Datos de Transferencia</div>
                                        <div>
                                            <label className="label" style={{ fontSize:'0.75rem' }}>N° Comprobante <span style={{ color:'var(--danger)' }}>*</span></label>
                                            <input className="input" type="text" placeholder="Ej: 00123456" value={transReferencia} onChange={e => setTransReferencia(e.target.value)} />
                                        </div>
                                        <div>
                                            <label className="label" style={{ fontSize:'0.75rem' }}>Banco <span style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>(opcional)</span></label>
                                            <input className="input" type="text" placeholder="Ej: BCP, Itaú, Continental..." value={transBanco} onChange={e => setTransBanco(e.target.value)} />
                                        </div>
                                    </div>
                                )}
                            </>)}
                            {dividirPago && (() => {
                                const total = Number(monto) || 0;
                                const asignado = pagosDiv.reduce((s, p) => s + (Number(p.monto) || 0), 0);
                                const restante = total - asignado;
                                const pct = total > 0 ? Math.min(100, (asignado / total) * 100) : 0;
                                const ok = total > 0 && Math.abs(restante) < 0.01;
                                const updPago = (id, key, val) => setPagosDiv(prev => prev.map(p => p.id === id ? { ...p, [key]: val } : p));
                                const addPago = () => setPagosDiv(prev => [...prev, PAGO_VACIO()]);
                                const delPago = (id) => setPagosDiv(prev => prev.length > 2 ? prev.filter(p => p.id !== id) : prev);
                                const autoCompletar = (id) => {
                                    if (total <= 0) return;
                                    const otrosMonto = pagosDiv.filter(p => p.id !== id).reduce((s, p) => s + (Number(p.monto) || 0), 0);
                                    const diff = total - otrosMonto;
                                    if (diff > 0) updPago(id, 'monto', String(diff));
                                };
                                return (
                                    <div className="animate-fade-in" style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
                                        {total > 0 && (
                                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', borderRadius:8, background:'var(--bg-color)', border:'1px solid var(--border)', fontSize:'0.82rem' }}>
                                                <span style={{ color:'var(--text-muted)', fontWeight:500 }}>Total a pagar:</span>
                                                <strong style={{ color:'var(--text)', fontSize:'1rem' }}>${total.toLocaleString('es-CL')}</strong>
                                            </div>
                                        )}
                                        <div style={{ background:'var(--border)', borderRadius:999, height:10, overflow:'hidden' }}>
                                            <div style={{ width:`${pct}%`, height:'100%', background: ok ? 'var(--success)' : asignado > total ? 'var(--danger)' : 'var(--primary)', borderRadius:999, transition:'width 0.25s' }} />
                                        </div>
                                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.76rem', fontWeight:600 }}>
                                            <span style={{ color:'var(--text-muted)' }}>Asignado: <strong style={{ color: ok ? 'var(--success, #16a34a)' : 'var(--text)' }}>${asignado.toLocaleString('es-CL')}</strong></span>
                                            <span style={{ color: ok ? 'var(--success, #16a34a)' : restante < 0 ? 'var(--danger, #dc2626)' : 'var(--text-muted)' }}>
                                                {!total ? 'Ingresa el monto total primero' : ok ? '✓ Cuadrado' : restante > 0 ? `Faltan $${restante.toLocaleString('es-CL')}` : `Excede $${(-restante).toLocaleString('es-CL')}`}
                                            </span>
                                        </div>
                                        {pagosDiv.map((p, idx) => (
                                            <div key={p.id} style={{ border:'1px solid var(--border)', borderRadius:10, padding:'0.75rem', background:'var(--surface)', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                                    <span style={{ fontSize:'0.75rem', fontWeight:700, color:'var(--text-muted)' }}>Tramo {idx + 1}</span>
                                                    {pagosDiv.length > 2 && <button type="button" onClick={() => delPago(p.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger,#ef4444)', display:'flex', padding:2 }}><Icon name="trash-2" size={13} /></button>}
                                                </div>
                                                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.3rem' }}>
                                                    {METODOS_PAGO.map(m => (
                                                        <button key={m.id} type="button" onClick={() => updPago(p.id, 'metodo', m.id)}
                                                            style={{ padding:'0.35rem 0.2rem', borderRadius:7, border:`2px solid ${p.metodo===m.id ? 'var(--primary)' : 'var(--border)'}`, background: p.metodo===m.id ? 'var(--primary-light)' : 'transparent', color: p.metodo===m.id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: p.metodo===m.id ? 700 : 500, cursor:'pointer', fontSize:'0.72rem', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                                                            <span style={{ fontSize:'1rem' }}>{m.icon}</span>{m.label}
                                                        </button>
                                                    ))}
                                                </div>
                                                <div style={{ display:'flex', gap:'0.4rem', alignItems:'flex-end' }}>
                                                    <div style={{ flex:1 }}>
                                                        <label className="label" style={{ fontSize:'0.72rem' }}>Monto <span style={{ color:'var(--danger)' }}>*</span></label>
                                                        <input className="input" type="number" min={0} step="0.01" placeholder="0.00" value={p.monto} onChange={e => updPago(p.id, 'monto', e.target.value)} style={{ fontWeight:700 }} />
                                                    </div>
                                                    {total > 0 && (
                                                        <button type="button" onClick={() => autoCompletar(p.id)} title="Poner el monto restante aquí"
                                                            style={{ padding:'0.5rem 0.65rem', borderRadius:7, border:'1px solid var(--primary)', background:'var(--primary-light)', cursor:'pointer', fontSize:'0.72rem', color:'var(--primary)', fontWeight:700, whiteSpace:'nowrap', marginBottom:1 }}>
                                                            ← Restante
                                                        </button>
                                                    )}
                                                </div>
                                                {p.metodo === 'tarjeta' && (
                                                    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', padding:'0.55rem', borderRadius:7, background:'var(--primary-light)', border:'1px solid var(--primary)' }}>
                                                        <div style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--primary)' }}>💳 Datos de Tarjeta</div>
                                                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.3rem' }}>
                                                            {[{id:'debito',label:'Débito'},{id:'credito',label:'Crédito'}].map(t => (
                                                                <button key={t.id} type="button" onClick={() => updPago(p.id, 'tarjTipo', t.id)}
                                                                    style={{ padding:'0.3rem', borderRadius:5, border:`2px solid ${p.tarjTipo===t.id ? 'var(--primary)' : 'var(--border)'}`, background: p.tarjTipo===t.id ? 'white' : 'transparent', color: p.tarjTipo===t.id ? 'var(--primary)' : 'var(--text-muted)', fontWeight: p.tarjTipo===t.id ? 700 : 500, cursor:'pointer', fontSize:'0.72rem' }}>{t.label}</button>
                                                            ))}
                                                        </div>
                                                        <input className="input" type="text" inputMode="numeric" maxLength={4} placeholder="Últimos 4 dígitos" value={p.tarjUltimos4} onChange={e => updPago(p.id, 'tarjUltimos4', e.target.value.replace(/\D/g,'').slice(0,4))} style={{ letterSpacing:'0.2em', fontWeight:700, textAlign:'center' }} />
                                                    </div>
                                                )}
                                                {p.metodo === 'transferencia' && (
                                                    <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', padding:'0.55rem', borderRadius:7, background:'var(--primary-light)', border:'1px solid var(--primary)' }}>
                                                        <div style={{ fontSize:'0.72rem', fontWeight:700, color:'#1d4ed8' }}>🏦 Datos de Transferencia</div>
                                                        <input className="input" type="text" placeholder="N° Comprobante *" value={p.transReferencia} onChange={e => updPago(p.id, 'transReferencia', e.target.value)} />
                                                        <input className="input" type="text" placeholder="Banco (opcional)" value={p.transBanco} onChange={e => updPago(p.id, 'transBanco', e.target.value)} />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <button type="button" onClick={addPago}
                                            style={{ padding:'0.45rem', borderRadius:8, border:'2px dashed var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', fontSize:'0.8rem', fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                                            <Icon name="plus" size={14} /> Agregar tramo
                                        </button>
                                    </div>
                                );
                            })()}
                        </div>

                        {error && <div className="bg-danger-light text-danger p-2 rounded-md text-xs font-medium">{error}</div>}
                        <button type="submit" className="btn btn-primary w-full" disabled={saving}
                            style={{ background: tipo === 'egreso' ? 'var(--danger)' : undefined }}>
                            <Icon name={saving ? 'loader' : 'save'} size={16} />
                            {saving ? 'Guardando...' : `Registrar ${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}`}
                        </button>
                    </form>
                </div>
                )}{/* fin !filtroCajero form */}
                </div>{/* fin columna derecha */}
            </div>
            )}{/* fin gate caja */}

            {/* Modal: nuevo cliente desde Caja — se oculta mientras el mapa está abierto */}
            {cajaModalCli && !cajaMapPickerCli && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}>
                    <div style={{ background:'var(--surface)', borderRadius:14, width:'100%', maxWidth:480, boxShadow:'0 20px 60px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column', maxHeight:'90vh', overflow:'hidden' }}>
                        <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <h3 style={{ fontWeight:700, fontSize:'1.05rem', display:'flex', alignItems:'center', gap:8 }}>
                                <Icon name="user-plus" size={18} className="text-primary" /> Nuevo Cliente
                            </h3>
                            <button onClick={() => setCajaModalCli(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}><Icon name="x" size={20} /></button>
                        </div>
                        <div style={{ padding:'1.25rem 1.5rem', overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.9rem' }}>
                            {/* Tipo */}
                            <div>
                                <label className="label">Tipo</label>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                                    {[{v:'persona',l:'👤 Persona'},{v:'empresa',l:'🏢 Empresa'}].map(t => (
                                        <button key={t.v} type="button" onClick={() => setCajaFormCli(f => ({...f, tipo:t.v}))}
                                            style={{ padding:'0.55rem', borderRadius:8, border:`2px solid ${cajaFormCli.tipo===t.v ? 'var(--primary)' : 'var(--border)'}`, background: cajaFormCli.tipo===t.v ? 'var(--primary-light)' : 'transparent', color: cajaFormCli.tipo===t.v ? 'var(--primary)' : 'var(--text-muted)', fontWeight:700, cursor:'pointer', fontSize:'0.875rem' }}>{t.l}</button>
                                    ))}
                                </div>
                            </div>
                            <div className="input-group mb-0">
                                <label className="label">Nombre <span style={{ color:'var(--danger)' }}>*</span></label>
                                <input className="input" placeholder={cajaFormCli.tipo==='empresa' ? 'Razón social' : 'Nombre completo'} value={cajaFormCli.nombre} onChange={e => setCajaFormCli(f => ({...f, nombre:e.target.value}))} />
                            </div>
                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem' }}>
                                <div className="input-group mb-0">
                                    <label className="label">{cajaFormCli.tipo==='empresa' ? 'RUC' : 'Cédula / CI'}</label>
                                    <input className="input" placeholder="Ej: 1234567890" value={cajaFormCli.rucCi} onChange={e => setCajaFormCli(f => ({...f, rucCi:e.target.value}))} />
                                </div>
                                <div className="input-group mb-0">
                                    <label className="label">Teléfono</label>
                                    <input className="input" placeholder="Ej: 0991234567" value={cajaFormCli.telefono} onChange={e => setCajaFormCli(f => ({...f, telefono:e.target.value}))} />
                                </div>
                            </div>
                            <div className="input-group mb-0">
                                <label className="label">Email</label>
                                <input className="input" type="email" placeholder="correo@ejemplo.com" value={cajaFormCli.email} onChange={e => setCajaFormCli(f => ({...f, email:e.target.value}))} />
                            </div>
                            <div className="input-group mb-0">
                                <label className="label">Dirección</label>
                                <input className="input" placeholder="Dirección completa" value={cajaFormCli.direccion} onChange={e => setCajaFormCli(f => ({...f, direccion:e.target.value}))} />
                            </div>
                            {/* Ubicación en mapa */}
                            <div className="input-group mb-0">
                                <label className="label" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                    <span style={{ display:'flex', alignItems:'center', gap:5 }}><Icon name="map-pin" size={13} /> Ubicación en mapa</span>
                                    <button type="button" onClick={() => setCajaMapPickerCli(true)}
                                        style={{ fontSize:'0.72rem', fontWeight:700, padding:'3px 10px', borderRadius:999, border:'1.5px solid var(--primary)', background: cajaFormCli.lat ? 'var(--primary)' : 'white', color: cajaFormCli.lat ? 'white' : 'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                                        <Icon name="map" size={11} /> {cajaFormCli.lat ? 'Cambiar' : 'Fijar en mapa'}
                                    </button>
                                </label>
                                {cajaFormCli.lat && cajaFormCli.lng ? (
                                    <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0.45rem 0.7rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-color)', fontSize:'0.78rem' }}>
                                        <Icon name="map-pin" size={13} style={{ color:'var(--primary)', flexShrink:0 }} />
                                        <span style={{ flex:1 }}>{cajaFormCli.lat.toFixed(6)}, {cajaFormCli.lng.toFixed(6)}</span>
                                        <span style={{ fontSize:'0.7rem', background:'var(--success-light)', color:'var(--success)', borderRadius:999, padding:'1px 6px', fontWeight:700 }}>✓ Fijada</span>
                                        <button type="button" onClick={() => setCajaFormCli(f => ({...f, lat:null, lng:null}))} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}><Icon name="x" size={12} /></button>
                                    </div>
                                ) : (
                                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', padding:'0.3rem 0' }}>Sin coordenadas — pulsa "Fijar en mapa" para ubicar al cliente.</div>
                                )}
                            </div>
                            {cajaFormCli.tipo === 'empresa' && (
                                <div className="input-group mb-0">
                                    <label className="label">Contacto</label>
                                    <input className="input" placeholder="Nombre del contacto" value={cajaFormCli.contacto} onChange={e => setCajaFormCli(f => ({...f, contacto:e.target.value}))} />
                                </div>
                            )}
                            <div className="input-group mb-0">
                                <label className="label">Notas <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', fontWeight:400 }}>(opcional)</span></label>
                                <textarea className="input" rows={2} placeholder="Notas internas..." value={cajaFormCli.notas} onChange={e => setCajaFormCli(f => ({...f, notas:e.target.value}))} style={{ resize:'vertical' }} />
                            </div>
                            {cajaErrorCli && <div className="bg-danger-light text-danger p-2 rounded-md text-xs font-medium">{cajaErrorCli}</div>}
                        </div>
                        <div style={{ padding:'1rem 1.5rem', borderTop:'1px solid var(--border)', display:'flex', gap:'0.6rem', justifyContent:'flex-end' }}>
                            <button onClick={() => setCajaModalCli(false)} style={{ padding:'0.55rem 1.1rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', fontWeight:600, fontSize:'0.875rem' }}>Cancelar</button>
                            <button disabled={cajaSavingCli} onClick={async () => {
                                if (!cajaFormCli.nombre.trim()) { setCajaErrorCli('El nombre es requerido.'); return; }
                                setCajaSavingCli(true); setCajaErrorCli('');
                                try {
                                    const nuevo = await createCliente({ nombre: cajaFormCli.nombre.trim(), tipo: cajaFormCli.tipo, rucCi: cajaFormCli.rucCi||null, email: cajaFormCli.email||null, telefono: cajaFormCli.telefono||null, direccion: cajaFormCli.direccion||null, contacto: cajaFormCli.contacto||null, notas: cajaFormCli.notas||null, lat: cajaFormCli.lat??null, lng: cajaFormCli.lng??null });
                                    setCajaModalCli(false);
                                    // Refrescar lista y seleccionar el nuevo cliente
                                    const data = await getClientesData({ activo: true });
                                    setCajaClientes(data);
                                    setClienteSeleccionado({ id: nuevo.id, nombre: nuevo.nombre, tipo: nuevo.tipo });
                                } catch { setCajaErrorCli('Error al guardar el cliente.'); }
                                finally { setCajaSavingCli(false); }
                            }} style={{ padding:'0.55rem 1.25rem', borderRadius:8, border:'none', background:'var(--primary)', color:'white', cursor:'pointer', fontWeight:700, fontSize:'0.875rem', display:'flex', alignItems:'center', gap:5 }}>
                                {cajaSavingCli ? <><Icon name="loader" size={15} /> Guardando...</> : <><Icon name="check" size={15} /> Guardar Cliente</>}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Map picker para nuevo cliente desde Caja */}
            {cajaMapPickerCli && createPortal(
                <LocationPickerModal
                    initial={cajaFormCli.lat && cajaFormCli.lng ? [cajaFormCli.lat, cajaFormCli.lng] : null}
                    lugarNombre={cajaFormCli.nombre || 'Cliente'}
                    onConfirm={([lat, lng]) => { setCajaFormCli(f => ({...f, lat, lng})); setCajaMapPickerCli(false); }}
                    onCancel={() => setCajaMapPickerCli(false)}
                />,
                document.body
            )}
        </div>
    );
};

// ─── ClienteFichaPage ─────────────────────────────────────────────────────────
const ClienteFichaPage = ({ cliId, onBack }) => {
    const [datos, setDatos]           = useState(null);
    const [loading, setLoading]       = useState(true);
    const [proSelec, setProSelec]     = useState('');
    const [cantidad, setCantidad]     = useState('1');
    const [editQty, setEditQty]       = useState({}); // { [proId]: cantidad }
    const [saving, setSaving]         = useState(false);
    const [tabHistorial, setTabHistorial] = useState('todo');
    // ── Edición de máquinas desde el perfil ──
    const [maqModal, setMaqModal]     = useState(null);  // { producto, maquinas[] } contexto del modal
    const [maqSelec, setMaqSelec]     = useState(null);  // maquina seleccionada para editar
    const [maqForm, setMaqForm]       = useState({});    // { tmqId, lgrId, status }
    const [maqMeta, setMaqMeta]       = useState(null);  // { tipos[], lugares[] }
    const [savingMaq, setSavingMaq]   = useState(false);

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setDatos(await getClienteFicha(cliId)); }
        catch { setDatos(null); }
        finally { setLoading(false); }
    }, [cliId]);

    useEffect(() => { cargar(); }, [cargar]);

    const handleAsignar = async () => {
        if (!proSelec) return;
        setSaving(true);
        try {
            await asignarProductoCliente(cliId, Number(proSelec), Number(cantidad) || 1);
            await cargar(); setProSelec(''); setCantidad('1');
        } catch (e) { alert(e.message || 'Error al asignar producto'); }
        finally { setSaving(false); }
    };

    const handleUpdateQty = async (itemId, qty) => {
        if (!qty || isNaN(qty) || Number(qty) < 1) return;
        setSaving(true);
        try { await updateProductoCliente(cliId, itemId, Number(qty)); await cargar(); setEditQty({}); }
        catch (e) { alert(e.message || 'Error al actualizar cantidad'); }
        finally { setSaving(false); }
    };

    const handleRemove = async (itemId, nombre) => {
        if (!window.confirm(`¿Quitar "${nombre}" de este cliente?`)) return;
        setSaving(true);
        try { await removeProductoCliente(cliId, itemId); await cargar(); }
        catch (e) { alert(e.message || 'Error al quitar producto'); }
        finally { setSaving(false); }
    };

    // ── Máquina: abrir modal de edición ──
    const abrirEditMaquina = async (producto, todasMaquinas) => {
        // Filtra máquinas del cliente que coincidan con el tmq_id del producto
        const coinciden = producto.item_tmq_id
            ? todasMaquinas.filter(m => m.tmq_id === producto.item_tmq_id)
            : todasMaquinas;
        const candidatas = coinciden.length > 0 ? coinciden : todasMaquinas;
        setMaqModal({ producto, maquinas: candidatas });
        // Pre-seleccionar si hay una sola
        const primera = candidatas[0] || null;
        setMaqSelec(primera);
        if (primera) setMaqForm({ maqId: primera.maq_id ?? '', tmqId: primera.tmq_id ?? '', lgrId: primera.lgr_id ?? '', status: primera.maq_status ?? 'ok' });
        // Cargar tipos y lugares si aún no están cargados
        if (!maqMeta) {
            const [tipos, lugares] = await Promise.all([getTipos(), getLugares()]);
            setMaqMeta({ tipos, lugares });
        }
    };

    const handleSaveMaquina = async () => {
        if (!maqSelec) return;
        const nuevoId = (maqForm.maqId || '').trim();
        if (!nuevoId) { alert('El ID de la máquina no puede estar vacío.'); return; }
        setSavingMaq(true);
        try {
            await updateMachine(maqSelec.maq_id, {
                newId: nuevoId !== maqSelec.maq_id ? nuevoId : undefined,
                tmqId: maqForm.tmqId || undefined,
                lgrId: maqForm.lgrId || undefined,
                status: maqForm.status,
            });
            await cargar();
            setMaqModal(null); setMaqSelec(null); setMaqForm({});
        } catch (e) { alert(e.message || 'Error al guardar la máquina'); }
        finally { setSavingMaq(false); }
    };

    if (loading) return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:'4rem', color:'var(--text-muted)' }}>
            <Icon name="loader" size={28} />&nbsp; Cargando ficha…
        </div>
    );
    if (!datos) return <div style={{ padding:'2rem', color:'var(--danger)' }}>Error al cargar la ficha del cliente.</div>;

    const { cliente, productos, disponibles, recaudaciones, mantenimientos, maquinas, ventas = [] } = datos;

    const totalRecaudado  = recaudaciones.reduce((s, r) => s + (r.rre_mnto_total || 0), 0);
    const totalUnidades   = productos.reduce((s, p) => s + (p.cp_cantidad || 0), 0);
    const totalVendido    = ventas.filter(v => !v.mov_es_reembolso).reduce((s, v) => s + (v.mov_monto || 0), 0);

    // Timeline combinada
    const timeline = [
        ...recaudaciones.map(r => ({ tipo:'recaudacion',   fecha: r.rre_timestamp,   data: r })),
        ...mantenimientos.map(g => ({ tipo:'mantenimiento', fecha: g.gsq_timestamp,   data: g })),
        ...maquinas.map(m => ({ tipo:'maquina_nueva',       fecha: m.maq_fechacre,    data: m })),
        ...ventas.map(v => ({ tipo:'venta',                 fecha: v.mov_timestamp,   data: v })),
    ].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const timelineFiltered = tabHistorial === 'todo' ? timeline
        : tabHistorial === 'ventas' ? timeline.filter(e => e.tipo === 'venta')
        : tabHistorial === 'recaudaciones' ? timeline.filter(e => e.tipo === 'recaudacion')
        : timeline.filter(e => e.tipo !== 'recaudacion' && e.tipo !== 'venta');

    return (
        <div style={{ display:'flex', flexDirection:'column', gap:'1.25rem' }}>

            {/* ── Modal edición de máquina ── */}
            {maqModal && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}
                     onClick={e => { if (e.target === e.currentTarget) setMaqModal(null); }}>
                    <div className="card" style={{ maxWidth:460, width:'100%', overflow:'hidden' }}>
                        {/* Header */}
                        <div style={{ background:'#1a1a2e', padding:'1rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <div>
                                <div style={{ fontSize:'0.7rem', fontWeight:700, color:'rgba(255,255,255,0.5)', letterSpacing:'1.5px', textTransform:'uppercase' }}>Editar Máquina</div>
                                <div style={{ fontSize:'0.95rem', fontWeight:800, color:'#f9fafb', marginTop:2 }}>{maqModal.producto.item_nombre}</div>
                            </div>
                            <button onClick={() => setMaqModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'rgba(255,255,255,0.5)', fontSize:'1.2rem', lineHeight:1 }}>✕</button>
                        </div>

                        <div style={{ padding:'1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.9rem' }}>
                            {/* Selector de máquina si hay más de una */}
                            {maqModal.maquinas.length === 0 ? (
                                <div style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)', fontSize:'0.85rem' }}>
                                    <Icon name="cpu" size={32} style={{ marginBottom:8, opacity:0.4 }} />
                                    <div style={{ fontWeight:600 }}>No hay máquinas registradas para este cliente.</div>
                                    <div style={{ fontSize:'0.78rem', marginTop:4 }}>Crea la máquina desde el módulo <strong>Máquinas</strong>.</div>
                                </div>
                            ) : (<>
                                {maqModal.maquinas.length > 1 && (
                                    <div>
                                        <div style={{ fontSize:'0.68rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', marginBottom:'0.5rem' }}>Seleccionar máquina</div>
                                        <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                                            {maqModal.maquinas.map(m => (
                                                <button key={m.maq_id} onClick={() => { setMaqSelec(m); setMaqForm({ maqId: m.maq_id ?? '', tmqId: m.tmq_id ?? '', lgrId: m.lgr_id ?? '', status: m.maq_status ?? 'ok' }); }}
                                                    style={{ display:'flex', alignItems:'center', gap:10, padding:'0.6rem 0.9rem', borderRadius:8, border:`1.5px solid ${maqSelec?.maq_id === m.maq_id ? '#7c3aed' : 'var(--border)'}`, background: maqSelec?.maq_id === m.maq_id ? '#f5f3ff' : 'white', cursor:'pointer', textAlign:'left' }}>
                                                    <div style={{ width:34, height:34, borderRadius:8, background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                                        <Icon name="cpu" size={16} style={{ color:'#6d28d9' }} />
                                                    </div>
                                                    <div>
                                                        <div style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--text)' }}>{m.maq_id}</div>
                                                        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{m.tipo_maq || '—'} · {m.lugar_nombre || 'Sin ubicación'}</div>
                                                    </div>
                                                    {maqSelec?.maq_id === m.maq_id && <Icon name="check-circle" size={15} style={{ color:'#7c3aed', marginLeft:'auto' }} />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Formulario de edición */}
                                {maqSelec && maqMeta && (<>
                                    {maqModal.maquinas.length === 1 && (
                                        <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0.6rem 0.9rem', borderRadius:8, background:'var(--primary-light)', border:'1.5px solid #c4b5fd' }}>
                                            <div style={{ width:34, height:34, borderRadius:8, background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                                <Icon name="cpu" size={16} style={{ color:'#6d28d9' }} />
                                            </div>
                                            <div>
                                                <div style={{ fontWeight:700, fontSize:'0.85rem' }}>{maqSelec.maq_id}</div>
                                                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{maqSelec.tipo_maq || '—'} · {maqSelec.lugar_nombre || 'Sin ubicación'}</div>
                                            </div>
                                        </div>
                                    )}

                                    <div style={{ borderTop:'1px dashed var(--border)', paddingTop:'0.85rem', display:'flex', flexDirection:'column', gap:'0.7rem' }}>
                                        {/* ID de máquina */}
                                        <div>
                                            <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', display:'block', marginBottom:4 }}>ID de Máquina</label>
                                            <input
                                                value={maqForm.maqId ?? ''}
                                                onChange={e => setMaqForm(f => ({ ...f, maqId: e.target.value }))}
                                                style={{ width:'100%', padding:'0.45rem 0.65rem', borderRadius:7, border: (maqForm.maqId && maqForm.maqId !== maqSelec?.maq_id) ? '1.5px solid #7c3aed' : '1px solid var(--border)', fontSize:'0.9rem', fontWeight:700, background:'var(--surface)', letterSpacing:'0.5px', boxSizing:'border-box' }}
                                                placeholder="Ej: MQR-004"
                                            />
                                            {maqForm.maqId && maqForm.maqId !== maqSelec?.maq_id && (
                                                <div style={{ fontSize:'0.68rem', color:'#7c3aed', marginTop:3, fontWeight:600 }}>
                                                    ⚠️ El ID cambiará de <strong>{maqSelec?.maq_id}</strong> a <strong>{maqForm.maqId}</strong>
                                                </div>
                                            )}
                                        </div>
                                        {/* Tipo de máquina */}
                                        <div>
                                            <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', display:'block', marginBottom:4 }}>Tipo de Máquina</label>
                                            <select value={maqForm.tmqId} onChange={e => setMaqForm(f => ({ ...f, tmqId: Number(e.target.value) }))}
                                                style={{ width:'100%', padding:'0.45rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.85rem', background:'var(--surface)' }}>
                                                <option value="">— Sin tipo —</option>
                                                {maqMeta.tipos.map(t => <option key={t.id} value={t.id}>{t.description}</option>)}
                                            </select>
                                        </div>
                                        {/* Ubicación */}
                                        <div>
                                            <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', display:'block', marginBottom:4 }}>Ubicación</label>
                                            <select value={maqForm.lgrId} onChange={e => setMaqForm(f => ({ ...f, lgrId: Number(e.target.value) }))}
                                                style={{ width:'100%', padding:'0.45rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.85rem', background:'var(--surface)' }}>
                                                <option value="">— Sin ubicación —</option>
                                                {maqMeta.lugares.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                                            </select>
                                        </div>
                                        {/* Estado */}
                                        <div>
                                            <label style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)', letterSpacing:'1.2px', textTransform:'uppercase', display:'block', marginBottom:4 }}>Estado Operativo</label>
                                            <select value={maqForm.status} onChange={e => setMaqForm(f => ({ ...f, status: e.target.value }))}
                                                style={{ width:'100%', padding:'0.45rem 0.65rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.85rem', background:'var(--surface)' }}>
                                                <option value="ok">Operativa (OK)</option>
                                                <option value="mantenimiento">En mantenimiento</option>
                                                <option value="fuera_servicio">Fuera de servicio</option>
                                                <option value="baja">De baja</option>
                                            </select>
                                        </div>
                                    </div>
                                </>)}
                            </>)}
                        </div>

                        {/* Footer botones */}
                        {maqSelec && maqModal.maquinas.length > 0 && (
                            <div style={{ borderTop:'1px solid var(--border)', padding:'0.85rem 1.25rem', display:'flex', gap:'0.6rem', justifyContent:'flex-end', background:'var(--bg-color)' }}>
                                <button className="btn btn-secondary" onClick={() => setMaqModal(null)}>Cancelar</button>
                                <button className="btn" style={{ gap:6 }} onClick={handleSaveMaquina} disabled={savingMaq}>
                                    {savingMaq ? <><Icon name="loader" size={14} className="animate-spin" /> Guardando…</> : <><Icon name="save" size={14} /> Guardar cambios</>}
                                </button>
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
                <button onClick={onBack} style={{ background:'none', border:'1px solid var(--border)', borderRadius:8, padding:'0.45rem 0.9rem', cursor:'pointer', display:'flex', alignItems:'center', gap:6, fontSize:'0.85rem', color:'var(--text-muted)', fontWeight:600 }}>
                    <Icon name="arrow-left" size={15} /> Volver
                </button>
                <div>
                    <div style={{ fontWeight:800, fontSize:'1.15rem', color:'var(--text)' }}>{cliente.nombre}</div>
                    <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{cliente.tipo === 'empresa' ? '🏢 Empresa' : '👤 Persona natural'}{cliente.rucCi ? ` · RUC/CI: ${cliente.rucCi}` : ''}</div>
                </div>
                {!cliente.activo && <span style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fca5a5', borderRadius:999, fontSize:'0.72rem', fontWeight:700, padding:'2px 10px' }}>INACTIVO</span>}
            </div>

            {/* Info + Stats */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                <div className="card" style={{ padding:'1.1rem 1.25rem' }}>
                    <div style={{ fontWeight:700, fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:'0.75rem', textTransform:'uppercase', letterSpacing:'0.05em' }}>Datos de contacto</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.45rem' }}>
                        {cliente.email     && <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:'0.84rem' }}><Icon name="mail"     size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />{cliente.email}</div>}
                        {cliente.telefono  && <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:'0.84rem' }}><Icon name="phone"    size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />{cliente.telefono}</div>}
                        {cliente.direccion && <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:'0.84rem' }}><Icon name="map-pin"  size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />{cliente.direccion}</div>}
                        {cliente.contacto  && <div style={{ display:'flex', gap:8, alignItems:'center', fontSize:'0.84rem' }}><Icon name="user"     size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />Contacto: {cliente.contacto}</div>}
                        {cliente.notas     && <div style={{ marginTop:4, padding:'0.4rem 0.6rem', background:'var(--bg-color)', borderRadius:6, borderLeft:'3px solid var(--border)', fontSize:'0.8rem', color:'var(--text-muted)' }}>{cliente.notas}</div>}
                        {!cliente.email && !cliente.telefono && !cliente.direccion && !cliente.contacto && !cliente.notas &&
                            <div style={{ color:'var(--text-muted)', fontSize:'0.82rem', fontStyle:'italic' }}>Sin datos de contacto registrados.</div>}
                    </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.65rem' }}>
                    {[
                        { label:'Tipos de producto',  value: productos.length,                    icon:'package',        color:'var(--primary)' },
                        { label:'Total unidades',     value: totalUnidades,                       icon:'hash',           color:'#7c3aed' },
                        { label:'Ventas de caja',     value: ventas.filter(v=>!v.mov_es_reembolso).length, icon:'shopping-cart', color:'#db2777' },
                        { label:'Total vendido',      value: `${totalVendido.toLocaleString('es-PY')} Gs.`, icon:'credit-card',  color:'#be185d' },
                        { label:'Recaudaciones',      value: recaudaciones.length,                icon:'receipt',        color:'var(--success)' },
                        { label:'Total recaudado',    value: `${totalRecaudado.toLocaleString('es-PY')} Gs.`, icon:'trending-up', color:'#0891b2' },
                    ].map(s => (
                        <div key={s.label} className="card" style={{ padding:'0.9rem', display:'flex', flexDirection:'column', gap:4 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <Icon name={s.icon} size={14} style={{ color: s.color }} />
                                <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', fontWeight:600 }}>{s.label}</span>
                            </div>
                            <div style={{ fontWeight:800, fontSize:'1rem', color: s.color }}>{s.value}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Productos asignados */}
            <div className="card">
                <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.75rem' }}>
                    <div style={{ fontWeight:700, fontSize:'0.95rem', display:'flex', alignItems:'center', gap:8 }}>
                        <Icon name="package" size={17} style={{ color:'var(--primary)' }} />
                        Productos del cliente ({productos.length} {productos.length === 1 ? 'tipo' : 'tipos'}, {totalUnidades} unidades)
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
                        <select value={proSelec} onChange={e => setProSelec(e.target.value)}
                            style={{ padding:'0.4rem 0.7rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem', background:'var(--surface)', color:'var(--text)', minWidth:180 }}
                            disabled={disponibles.length === 0}>
                            <option value="">{disponibles.length === 0 ? '— Sin productos en el sistema —' : '— Seleccionar producto —'}</option>
                            {disponibles.map(p => <option key={p.item_id} value={p.item_id}>{p.item_nombre}{p.item_vigente === 0 ? ' (inactivo)' : ''}</option>)}
                        </select>
                        <input type="number" min="1" value={cantidad} onChange={e => setCantidad(e.target.value)}
                            placeholder="Cant." style={{ width:70, padding:'0.4rem 0.5rem', borderRadius:7, border:'1px solid var(--border)', fontSize:'0.82rem', textAlign:'center' }} />
                        <button onClick={handleAsignar} disabled={!proSelec || saving}
                            style={{ padding:'0.4rem 0.9rem', borderRadius:7, border:'none', background:'var(--primary)', color:'white', fontSize:'0.82rem', fontWeight:700, cursor: proSelec && !saving ? 'pointer' : 'not-allowed', opacity: proSelec && !saving ? 1 : 0.6, display:'flex', alignItems:'center', gap:5 }}>
                            <Icon name="plus" size={14} /> Agregar
                        </button>
                    </div>
                </div>
                {productos.length === 0 ? (
                    <div style={{ padding:'2.5rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.9rem' }}>
                        <Icon name="package-open" size={34} style={{ marginBottom:8, opacity:0.4 }} />
                        <div style={{ fontWeight:600 }}>Sin productos asignados</div>
                        {disponibles.length > 0
                            ? <div style={{ fontSize:'0.8rem', marginTop:4 }}>Usa el selector de arriba para agregar productos a este cliente.</div>
                            : <div style={{ fontSize:'0.8rem', marginTop:4 }}>No hay productos en el sistema. Crea productos en el módulo <strong>Productos</strong> y vuelve a asignarlos aquí.</div>}
                    </div>
                ) : (
                    <div style={{ padding:'1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                        {productos.map(p => {
                            const esManual  = p.cp_origen === 'manual';
                            const editando  = esManual && editQty[p.item_id] !== undefined;
                            return (
                                <div key={p.item_id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.75rem 1rem', borderRadius:10, border:`1px solid ${esManual ? 'var(--border)' : '#e0e7ff'}`, background: esManual ? 'var(--surface, white)' : '#f5f7ff' }}>
                                    <div style={{ width:40, height:40, borderRadius:9, background: esManual ? 'var(--primary-light)' : '#e0e7ff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                        <Icon name={esManual ? 'package' : 'shopping-cart'} size={19} style={{ color: esManual ? 'var(--primary)' : '#4f46e5' }} />
                                    </div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                            <span style={{ fontWeight:700, fontSize:'0.92rem', color:'var(--text)' }}>{p.item_nombre}</span>
                                            {!esManual && <span style={{ fontSize:'0.68rem', background:'var(--primary-light)', color:'var(--primary)', borderRadius:4, padding:'1px 6px', fontWeight:700 }}>Venta</span>}
                                        </div>
                                        {p.item_descrip && <div style={{ fontSize:'0.76rem', color:'var(--text-muted)', marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.item_descrip}</div>}
                                        <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginTop:2 }}>Desde: {p.cp_fecha ? p.cp_fecha.slice(0,10) : '—'}</div>
                                    </div>

                                    {esManual ? (
                                        /* ── Producto manual: cantidad editable + eliminar ── */
                                        <>
                                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                                {editando ? (
                                                    <>
                                                        <input type="number" min="1" autoFocus value={editQty[p.item_id]}
                                                            onChange={e => setEditQty(q => ({ ...q, [p.item_id]: e.target.value }))}
                                                            style={{ width:60, padding:'0.3rem 0.4rem', borderRadius:6, border:'1.5px solid var(--primary)', fontSize:'0.85rem', textAlign:'center', fontWeight:700 }} />
                                                        <button onClick={() => handleUpdateQty(p.item_id, editQty[p.item_id])} disabled={saving}
                                                            style={{ padding:'0.3rem 0.6rem', borderRadius:6, border:'none', background:'var(--primary)', color:'white', fontSize:'0.78rem', fontWeight:700, cursor:'pointer' }}>
                                                            <Icon name="check" size={13} />
                                                        </button>
                                                        <button onClick={() => setEditQty({})}
                                                            style={{ padding:'0.3rem 0.5rem', borderRadius:6, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text-muted)', fontSize:'0.78rem', cursor:'pointer' }}>
                                                            <Icon name="x" size={13} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                                        <div style={{ background:'var(--primary)', color:'white', borderRadius:999, fontSize:'0.85rem', fontWeight:800, padding:'3px 14px', minWidth:42, textAlign:'center' }}>
                                                            {p.cp_cantidad}
                                                        </div>
                                                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>unid.</span>
                                                        <button onClick={() => setEditQty({ [p.item_id]: String(p.cp_cantidad) })} title="Editar cantidad"
                                                            style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:3, display:'flex' }}>
                                                            <Icon name="pencil" size={13} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <button onClick={() => handleRemove(p.item_id, p.item_nombre)} disabled={saving} title="Quitar producto"
                                                style={{ background:'none', border:'none', cursor:'pointer', color:'#f87171', padding:4, display:'flex', flexShrink:0 }}>
                                                <Icon name="trash-2" size={15} />
                                            </button>
                                        </>
                                    ) : (
                                        /* ── Producto de venta ── */
                                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                            <div style={{ background:'#4f46e5', color:'white', borderRadius:999, fontSize:'0.85rem', fontWeight:800, padding:'3px 14px', minWidth:42, textAlign:'center' }}>
                                                {p.cp_cantidad}
                                            </div>
                                            <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>unid.</span>
                                            {/* Si es tipo Maquina → botón editar máquina */}
                                            {p.tipo_cat_nombre === 'Maquina' && (
                                                <button
                                                    onClick={() => abrirEditMaquina(p, maquinas)}
                                                    title="Editar máquina"
                                                    style={{ background:'#ede9fe', border:'1px solid #c4b5fd', borderRadius:7, padding:'3px 8px', cursor:'pointer', display:'flex', alignItems:'center', gap:4, color:'#6d28d9', fontSize:'0.72rem', fontWeight:700 }}>
                                                    <Icon name="settings" size={12} /> Editar máquina
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Historial de actividad */}
            <div className="card">
                <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:'0.5rem' }}>
                    <div style={{ fontWeight:700, fontSize:'0.95rem', display:'flex', alignItems:'center', gap:8 }}>
                        <Icon name="clock" size={17} style={{ color:'var(--primary)' }} /> Historial de actividad
                        <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontWeight:400 }}>(máquinas de los productos asignados)</span>
                    </div>
                    <div style={{ display:'flex', gap:'0.35rem' }}>
                        {[['todo','Todo'],['ventas','Ventas caja'],['recaudaciones','Recaudaciones'],['mantenimiento','Máquinas/Mant.']].map(([k,label]) => (
                            <button key={k} onClick={() => setTabHistorial(k)}
                                style={{ padding:'0.3rem 0.75rem', borderRadius:999, border:'1px solid var(--border)', fontSize:'0.73rem', fontWeight: tabHistorial===k ? 700 : 500, background: tabHistorial===k ? 'var(--primary)' : 'white', color: tabHistorial===k ? 'white' : 'var(--text-muted)', cursor:'pointer' }}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
                {productos.length === 0 && ventas.length === 0 ? (
                    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.85rem' }}>Asigna productos al cliente para ver el historial.</div>
                ) : timelineFiltered.length === 0 ? (
                    <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.9rem' }}>Sin actividad registrada para estos productos.</div>
                ) : (
                    <div style={{ padding:'1rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.6rem', maxHeight:500, overflowY:'auto' }}>
                        {timelineFiltered.map((ev, i) => {
                            const isLast = i === timelineFiltered.length - 1;
                            if (ev.tipo === 'recaudacion') {
                                const r = ev.data;
                                const fecha = r.rre_timestamp ? new Date(r.rre_timestamp).toLocaleString('es-PY', { timeZone:'America/Asuncion', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                                return (
                                    <div key={'rec-'+r.rre_id} style={{ display:'flex', gap:'0.85rem', alignItems:'flex-start' }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--success-light)', border:'2px solid #86efac', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name="dollar-sign" size={14} style={{ color:'var(--success)' }} />
                                        </div>
                                        <div style={{ flex:1, paddingBottom:'0.55rem', borderBottom: isLast ? 'none' : '1px dashed var(--border)' }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:4 }}>
                                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                                    <span style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--success)' }}>Recaudación</span>
                                                    {r.producto_nombre && <span style={{ fontSize:'0.75rem', background:'var(--success-light)', color:'var(--success)', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>{r.producto_nombre}</span>}
                                                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Máq: <strong>{r.maq_id}</strong></span>
                                                    {r.rre_tipo === 'init' && <span style={{ fontSize:'0.68rem', background:'var(--primary-light)', color:'var(--primary)', borderRadius:4, padding:'1px 5px', fontWeight:700 }}>INICIO</span>}
                                                </div>
                                                <span style={{ fontSize:'0.73rem', color:'var(--text-muted)' }}>{fecha}</span>
                                            </div>
                                            <div style={{ display:'flex', gap:'1rem', marginTop:3, flexWrap:'wrap' }}>
                                                <span style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--success)' }}>{Number(r.rre_mnto_total || 0).toLocaleString('es-PY')} Gs.</span>
                                                {r.rre_mnto_locatario > 0 && <span style={{ fontSize:'0.77rem', color:'var(--text-muted)' }}>Locatario: {Number(r.rre_mnto_locatario).toLocaleString('es-PY')} Gs.</span>}
                                                {r.recaudador_nombre && <span style={{ fontSize:'0.77rem', color:'var(--text-muted)', display:'flex', gap:3, alignItems:'center' }}><Icon name="user" size={11} />{r.recaudador_nombre}</span>}
                                                {r.lugar_nombre && <span style={{ fontSize:'0.77rem', color:'var(--text-muted)', display:'flex', gap:3, alignItems:'center' }}><Icon name="map-pin" size={11} />{r.lugar_nombre}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            if (ev.tipo === 'mantenimiento') {
                                const g = ev.data;
                                const fecha = g.gsq_timestamp ? new Date(g.gsq_timestamp).toLocaleString('es-PY', { timeZone:'America/Asuncion', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                                return (
                                    <div key={'gasto-'+g.gsq_id} style={{ display:'flex', gap:'0.85rem', alignItems:'flex-start' }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background:'#fffbeb', border:'2px solid #fcd34d', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name="wrench" size={14} style={{ color:'var(--warning)' }} />
                                        </div>
                                        <div style={{ flex:1, paddingBottom:'0.55rem', borderBottom: isLast ? 'none' : '1px dashed var(--border)' }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:4 }}>
                                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                                    <span style={{ fontWeight:700, fontSize:'0.85rem', color:'#b45309' }}>Mantenimiento</span>
                                                    {g.producto_nombre && <span style={{ fontSize:'0.75rem', background:'#fef9c3', color:'#a16207', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>{g.producto_nombre}</span>}
                                                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>Máq: <strong>{g.maq_id}</strong></span>
                                                </div>
                                                <span style={{ fontSize:'0.73rem', color:'var(--text-muted)' }}>{fecha}</span>
                                            </div>
                                            <div style={{ display:'flex', gap:'1rem', marginTop:3, flexWrap:'wrap' }}>
                                                {g.gsq_descripcion && <span style={{ fontSize:'0.82rem', color:'var(--text)' }}>{g.gsq_descripcion}</span>}
                                                {g.gsq_monto > 0 && <span style={{ fontSize:'0.82rem', fontWeight:700, color:'#b45309' }}>{Number(g.gsq_monto).toLocaleString('es-PY')} Gs.</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            if (ev.tipo === 'maquina_nueva') {
                                const m = ev.data;
                                const fecha = m.maq_fechacre ? m.maq_fechacre.slice(0,10) : '—';
                                return (
                                    <div key={'maq-'+m.maq_id+i} style={{ display:'flex', gap:'0.85rem', alignItems:'flex-start' }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--primary-light)', border:'2px solid #93c5fd', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name="monitor" size={14} style={{ color:'#2563eb' }} />
                                        </div>
                                        <div style={{ flex:1, paddingBottom:'0.55rem', borderBottom: isLast ? 'none' : '1px dashed var(--border)' }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:4 }}>
                                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                                    <span style={{ fontWeight:700, fontSize:'0.85rem', color:'#1d4ed8' }}>Máquina registrada</span>
                                                    {m.producto && <span style={{ fontSize:'0.75rem', background:'#dbeafe', color:'#1d4ed8', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>{m.producto}</span>}
                                                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}><strong>{m.maq_id}</strong></span>
                                                </div>
                                                <span style={{ fontSize:'0.73rem', color:'var(--text-muted)' }}>{fecha}</span>
                                            </div>
                                            <div style={{ display:'flex', gap:'1rem', marginTop:3, flexWrap:'wrap' }}>
                                                {m.tipo_maq     && <span style={{ fontSize:'0.77rem', color:'var(--text-muted)', display:'flex', gap:3, alignItems:'center' }}><Icon name="tag" size={11} />{m.tipo_maq}</span>}
                                                {m.lugar_nombre && <span style={{ fontSize:'0.77rem', color:'var(--text-muted)', display:'flex', gap:3, alignItems:'center' }}><Icon name="map-pin" size={11} />{m.lugar_nombre}</span>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            if (ev.tipo === 'venta') {
                                const v = ev.data;
                                const esReemb = v.mov_es_reembolso === 1;
                                const fecha = v.mov_timestamp ? new Date(v.mov_timestamp).toLocaleString('es-PY', { timeZone:'America/Asuncion', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
                                let itemsParsed = null;
                                try { itemsParsed = v.mov_items ? JSON.parse(v.mov_items) : null; } catch {}
                                const metodoIcon = { efectivo:'💵', tarjeta:'💳', transferencia:'🏦', mixto:'🔀' };
                                return (
                                    <div key={'venta-'+v.mov_id} style={{ display:'flex', gap:'0.85rem', alignItems:'flex-start' }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background: esReemb ? '#f5f3ff' : '#fdf2f8', border:`2px solid ${esReemb ? '#c4b5fd' : '#f9a8d4'}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name={esReemb ? 'rotate-ccw' : 'shopping-cart'} size={14} style={{ color: esReemb ? '#7c3aed' : '#db2777' }} />
                                        </div>
                                        <div style={{ flex:1, paddingBottom:'0.55rem', borderBottom: isLast ? 'none' : '1px dashed var(--border)' }}>
                                            <div style={{ display:'flex', justifyContent:'space-between', flexWrap:'wrap', gap:4 }}>
                                                <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                                                    <span style={{ fontWeight:700, fontSize:'0.85rem', color: esReemb ? '#7c3aed' : '#be185d' }}>{esReemb ? 'Reembolso' : 'Venta de caja'}</span>
                                                    <span style={{ fontSize:'0.73rem' }}>{metodoIcon[v.mov_metodo_pago] || ''}</span>
                                                    {v.usu_nombre && <span style={{ fontSize:'0.73rem', color:'var(--text-muted)', display:'flex', gap:3, alignItems:'center' }}><Icon name="user" size={11} />{v.usu_nombre}</span>}
                                                </div>
                                                <span style={{ fontSize:'0.73rem', color:'var(--text-muted)' }}>{fecha}</span>
                                            </div>
                                            <div style={{ display:'flex', gap:'1rem', marginTop:3, flexWrap:'wrap', alignItems:'flex-start' }}>
                                                <span style={{ fontSize:'0.85rem', fontWeight:800, color: esReemb ? '#7c3aed' : '#be185d' }}>{Number(v.mov_monto).toLocaleString('es-PY')} Gs.</span>
                                                {itemsParsed && Array.isArray(itemsParsed) && itemsParsed.length > 0 ? (
                                                    <div style={{ display:'flex', flexWrap:'wrap', gap:'0.3rem' }}>
                                                        {itemsParsed.map((it, idx) => (
                                                            <span key={idx} style={{ fontSize:'0.71rem', background:'#fce7f3', color:'#be185d', borderRadius:4, padding:'1px 6px', fontWeight:600 }}>
                                                                {it.nombre}{it.cantidad > 1 ? ` ×${it.cantidad}` : ''}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{v.mov_concepto}</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── ClientesPage ─────────────────────────────────────────────────────────────
const CLIENTE_EMPTY = { nombre:'', tipo:'persona', rucCi:'', email:'', telefono:'', direccion:'', contacto:'', notas:'', lat:null, lng:null };

const ClientesPage = () => {
    const [fichaClienteId, setFichaClienteId] = useState(null);
    const [clientes, setClientes]     = useState([]);
    const [loading, setLoading]       = useState(true);
    const [buscar, setBuscar]         = useState('');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [filtroActivo, setFiltroActivo] = useState('1');
    const [modal, setModal]           = useState(null);   // null | 'new' | cliente-obj (editar)
    const [form, setForm]             = useState(CLIENTE_EMPTY);
    const [saving, setSaving]         = useState(false);
    const [error, setError]           = useState('');
    const [confirmDel, setConfirmDel] = useState(null);  // cliente a eliminar
    const [cliMapPicker, setCliMapPicker] = useState(false); // mostrar mapa

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const data = await getClientesData({ buscar, tipo: filtroTipo, activo: filtroActivo === '' ? undefined : filtroActivo === '1' });
            setClientes(data);
        } finally { setLoading(false); }
    }, [buscar, filtroTipo, filtroActivo]);

    useEffect(() => { refresh(); }, [refresh]);

    function openNew() { setForm(CLIENTE_EMPTY); setError(''); setModal('new'); setCliMapPicker(false); }
    function openEdit(c) {
        setForm({ nombre: c.nombre, tipo: c.tipo, rucCi: c.rucCi||'', email: c.email||'', telefono: c.telefono||'', direccion: c.direccion||'', contacto: c.contacto||'', notas: c.notas||'', lat: c.lat??null, lng: c.lng??null });
        setError('');
        setModal(c);
        setCliMapPicker(false);
    }

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!form.nombre.trim()) { setError('El nombre es requerido.'); return; }
        setSaving(true);
        try {
            if (modal === 'new') {
                await createCliente(form);
            } else {
                await updateCliente(modal.id, form);
            }
            setModal(null);
            await refresh();
        } catch { setError('Error al guardar. Verifique los datos.'); }
        finally { setSaving(false); }
    };

    const handleToggleActivo = async (c) => {
        await updateCliente(c.id, { activo: !c.activo });
        await refresh();
    };

    const handleDelete = async () => {
        if (!confirmDel) return;
        await deleteCliente(confirmDel.id);
        setConfirmDel(null);
        await refresh();
    };

    const totalEmpresa = clientes.filter(c => c.tipo === 'empresa').length;
    const totalPersona = clientes.filter(c => c.tipo === 'persona').length;

    // Si hay ficha abierta, mostramos el detalle del cliente
    if (fichaClienteId) {
        return <ClienteFichaPage cliId={fichaClienteId} onBack={() => setFichaClienteId(null)} />;
    }

    const modalContent = modal !== null && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
            <div className="card" style={{ width:'100%', maxWidth:560, maxHeight:'90vh', overflowY:'auto' }}>
                <div style={{ padding:'1.25rem 1.5rem', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <div className="font-semibold text-lg">{modal === 'new' ? 'Nuevo Cliente' : `Editar: ${modal.nombre}`}</div>
                    <button onClick={() => setModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}>
                        <Icon name="x" size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} style={{ padding:'1.5rem', display:'flex', flexDirection:'column', gap:'1rem' }}>
                    {/* Tipo */}
                    <div className="input-group mb-0">
                        <label className="label">Tipo de cliente</label>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                            {[{id:'persona',label:'👤 Persona',desc:'Persona natural'},{id:'empresa',label:'🏢 Empresa',desc:'Persona jurídica'}].map(t => (
                                <button key={t.id} type="button" onClick={() => setForm(f => ({...f, tipo: t.id}))}
                                    style={{ padding:'0.65rem', borderRadius:8, border:`2px solid ${form.tipo===t.id?'var(--primary)':'var(--border)'}`, background: form.tipo===t.id?'var(--primary-light)':'transparent', cursor:'pointer', textAlign:'left', transition:'all 0.15s' }}>
                                    <div style={{ fontWeight:700, fontSize:'0.85rem', color: form.tipo===t.id?'var(--primary)':'var(--text)' }}>{t.label}</div>
                                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{t.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Nombre + RUC */}
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                        <div className="input-group mb-0" style={{ gridColumn:'1/-1' }}>
                            <label className="label">Nombre / Razón Social <span style={{color:'var(--danger)'}}>*</span></label>
                            <input className="input" placeholder={form.tipo==='empresa'?'Nombre de la empresa':'Nombre completo'} value={form.nombre} onChange={e=>setForm(f=>({...f,nombre:e.target.value}))} required />
                        </div>
                        <div className="input-group mb-0">
                            <label className="label">{form.tipo==='empresa'?'RUC':'Cédula'}</label>
                            <input className="input" placeholder={form.tipo==='empresa'?'Ej: 1790012345001':'Ej: 1712345678'} value={form.rucCi} onChange={e=>setForm(f=>({...f,rucCi:e.target.value}))} />
                        </div>
                        <div className="input-group mb-0">
                            <label className="label">Teléfono</label>
                            <input className="input" placeholder="Ej: 0991234567" value={form.telefono} onChange={e=>setForm(f=>({...f,telefono:e.target.value}))} />
                        </div>
                    </div>

                    {/* Email + Dirección */}
                    <div className="input-group mb-0">
                        <label className="label">Correo electrónico</label>
                        <input className="input" type="email" placeholder="correo@ejemplo.com" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} />
                    </div>
                    <div className="input-group mb-0">
                        <label className="label">Dirección</label>
                        <input className="input" placeholder="Calle, ciudad, provincia..." value={form.direccion} onChange={e=>setForm(f=>({...f,direccion:e.target.value}))} />
                    </div>

                    {/* Ubicación en mapa */}
                    <div className="input-group mb-0">
                        <label className="label" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                                <Icon name="map-pin" size={13} /> Ubicación en mapa
                            </span>
                            <button type="button" onClick={() => setCliMapPicker(true)}
                                style={{ fontSize:'0.75rem', fontWeight:700, padding:'3px 12px', borderRadius:999, border:'1.5px solid var(--primary)', background: form.lat ? 'var(--primary)' : 'white', color: form.lat ? 'white' : 'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                                <Icon name="map" size={12} /> {form.lat ? 'Cambiar en mapa' : 'Fijar en mapa'}
                            </button>
                        </label>
                        {form.lat && form.lng ? (
                            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0.5rem 0.75rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-color)', fontSize:'0.8rem' }}>
                                <Icon name="map-pin" size={14} style={{ color:'var(--primary)', flexShrink:0 }} />
                                <span style={{ flex:1, color:'var(--text)' }}>
                                    {form.lat.toFixed(6)}, {form.lng.toFixed(6)}
                                </span>
                                <span style={{ fontSize:'0.72rem', background:'var(--success-light)', color:'var(--success)', borderRadius:999, padding:'1px 7px', fontWeight:700 }}>Fijada ✓</span>
                                <button type="button" onClick={() => setForm(f=>({...f, lat:null, lng:null}))}
                                    style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }} title="Quitar coordenadas">
                                    <Icon name="x" size={13} />
                                </button>
                            </div>
                        ) : (
                            <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', padding:'0.4rem 0' }}>
                                Sin coordenadas — pulsa "Fijar en mapa" para seleccionar la ubicación exacta.
                            </div>
                        )}
                    </div>

                    {/* Contacto (solo empresas) */}
                    {form.tipo === 'empresa' && (
                        <div className="input-group mb-0">
                            <label className="label">Persona de contacto</label>
                            <input className="input" placeholder="Nombre del representante" value={form.contacto} onChange={e=>setForm(f=>({...f,contacto:e.target.value}))} />
                        </div>
                    )}

                    {/* Notas */}
                    <div className="input-group mb-0">
                        <label className="label">Notas internas</label>
                        <textarea className="input" rows={3} placeholder="Observaciones, condiciones especiales..." value={form.notas} onChange={e=>setForm(f=>({...f,notas:e.target.value}))} style={{ resize:'vertical', minHeight:72 }} />
                    </div>

                    {error && <div className="bg-danger-light text-danger p-2 rounded-md text-xs font-medium">{error}</div>}

                    <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end', paddingTop:'0.5rem' }}>
                        <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            <Icon name={saving?'loader':'save'} size={15} />
                            {saving ? 'Guardando...' : modal === 'new' ? 'Crear Cliente' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    return (
        <div className="animate-fade-in">
            {/* Modal — se oculta mientras el mapa está abierto */}
            {modal !== null && !cliMapPicker && createPortal(modalContent, document.body)}

            {/* Map picker para cliente — al confirmar/cancelar vuelve el modal */}
            {cliMapPicker && createPortal(
                <LocationPickerModal
                    initial={form.lat && form.lng ? [form.lat, form.lng] : null}
                    lugarNombre={form.nombre || 'Cliente'}
                    onConfirm={([lat, lng]) => { setForm(f => ({...f, lat, lng})); setCliMapPicker(false); }}
                    onCancel={() => setCliMapPicker(false)}
                />,
                document.body
            )}

            {/* Modal confirmación eliminar */}
            {confirmDel && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                    <div className="card p-6" style={{ maxWidth:380, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem' }}>
                            <div style={{ width:40, height:40, borderRadius:'50%', background:'var(--danger-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon name="trash-2" size={20} className="text-danger" />
                            </div>
                            <div>
                                <div className="font-semibold">Eliminar cliente</div>
                                <div className="text-sm text-muted">{confirmDel.nombre}</div>
                            </div>
                        </div>
                        <p className="text-sm text-muted mb-4">Esta acción no se puede deshacer. ¿Confirmar eliminación?</p>
                        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setConfirmDel(null)}>Cancelar</button>
                            <button className="btn btn-primary" style={{ background:'var(--danger)' }} onClick={handleDelete}>Eliminar</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Stats */}
            <div className="stats-grid" style={{ marginBottom:'1.5rem', gridTemplateColumns:'repeat(3,1fr)' }}>
                <div className="card stat-card">
                    <div className="stat-icon bg-primary-light"><Icon name="users" size={24} className="text-primary" /></div>
                    <div><div className="text-sm text-muted">Total Clientes</div><div className="text-2xl font-bold">{clientes.length}</div></div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon" style={{ background:'var(--warning-light)' }}><Icon name="building-2" size={24} style={{ color:'var(--warning)' }} /></div>
                    <div><div className="text-sm text-muted">Empresas</div><div className="text-2xl font-bold" style={{ color:'var(--warning)' }}>{totalEmpresa}</div></div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon" style={{ background:'var(--success-light)' }}><Icon name="user" size={24} style={{ color:'var(--success)' }} /></div>
                    <div><div className="text-sm text-muted">Personas</div><div className="text-2xl font-bold" style={{ color:'var(--success)' }}>{totalPersona}</div></div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="card" style={{ padding:'1rem 1.25rem', marginBottom:'1rem', display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center' }}>
                <div style={{ flex:1, minWidth:200, position:'relative' }}>
                    <Icon name="search" size={16} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)' }} />
                    <input className="input" placeholder="Buscar por nombre, RUC, email, teléfono..." value={buscar} onChange={e=>{setBuscar(e.target.value);}} style={{ paddingLeft:32 }} />
                </div>
                <select className="input" style={{ width:'auto', minWidth:130 }} value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)}>
                    <option value="">Todos los tipos</option>
                    <option value="persona">👤 Persona</option>
                    <option value="empresa">🏢 Empresa</option>
                </select>
                <select className="input" style={{ width:'auto', minWidth:130 }} value={filtroActivo} onChange={e=>setFiltroActivo(e.target.value)}>
                    <option value="1">Activos</option>
                    <option value="0">Inactivos</option>
                    <option value="">Todos</option>
                </select>
                <button className="btn btn-primary" onClick={openNew} style={{ flexShrink:0 }}>
                    <Icon name="user-plus" size={16} /> Nuevo Cliente
                </button>
            </div>

            {/* Lista */}
            {loading ? (
                <div className="card p-8 text-center text-muted">Cargando clientes...</div>
            ) : clientes.length === 0 ? (
                <div className="card p-8 text-center text-muted">
                    <Icon name="users" size={48} className="mb-3" />
                    <div className="font-semibold">Sin clientes registrados</div>
                    <p className="text-sm mt-1">Presiona "Nuevo Cliente" para agregar el primero.</p>
                </div>
            ) : (
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))', gap:'1rem' }}>
                    {clientes.map(c => (
                        <div key={c.id} className="card" style={{ opacity: c.activo ? 1 : 0.6, transition:'opacity 0.2s' }}>
                            <div style={{ padding:'1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'flex-start', gap:'0.75rem' }}>
                                {/* Avatar */}
                                <div style={{ width:44, height:44, borderRadius:12, background: c.tipo==='empresa'?'#fef3c7':'var(--primary-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:'1.3rem' }}>
                                    {c.tipo === 'empresa' ? '🏢' : '👤'}
                                </div>
                                <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                                        <span className="font-semibold" style={{ fontSize:'0.95rem' }}>{c.nombre}</span>
                                        {!c.activo && <span className="badge" style={{ background:'#f3f4f6', color:'#6b7280', fontSize:'0.65rem' }}>Inactivo</span>}
                                    </div>
                                    <div style={{ fontSize:'0.75rem', color:'var(--text-muted)', marginTop:2 }}>
                                        {c.tipo === 'empresa' ? 'Empresa' : 'Persona natural'}
                                        {c.rucCi ? ` · ${c.rucCi}` : ''}
                                    </div>
                                </div>
                            </div>
                            <div style={{ padding:'0.875rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.4rem' }}>
                                {c.email    && <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', fontSize:'0.82rem', color:'var(--text-muted)' }}><Icon name="mail"  size={13} />{c.email}</div>}
                                {c.telefono && <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', fontSize:'0.82rem', color:'var(--text-muted)' }}><Icon name="phone" size={13} />{c.telefono}</div>}
                                {c.direccion && <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', fontSize:'0.82rem', color:'var(--text-muted)' }}><Icon name="map-pin" size={13} /><span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.direccion}</span></div>}
                                {c.contacto && <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', fontSize:'0.82rem', color:'var(--text-muted)' }}><Icon name="user" size={13} />Contacto: {c.contacto}</div>}
                                {c.notas    && <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', background:'var(--bg-color)', borderRadius:6, padding:'0.4rem 0.6rem', marginTop:4, borderLeft:'3px solid var(--border)' }}>{c.notas}</div>}
                            </div>
                            <div style={{ padding:'0.75rem 1.25rem', borderTop:'1px solid var(--border)', display:'flex', gap:'0.5rem', justifyContent:'flex-end' }}>
                                <button className="btn btn-secondary btn-icon" title="Ver ficha completa" onClick={() => setFichaClienteId(c.id)}
                                    style={{ color:'var(--primary)', borderColor:'var(--primary)' }}>
                                    <Icon name="eye" size={16} />
                                </button>
                                <button className="btn btn-secondary btn-icon" title={c.activo?'Desactivar':'Activar'} onClick={() => handleToggleActivo(c)}
                                    style={{ color: c.activo ? 'var(--success)' : 'var(--text-muted)' }}>
                                    <Icon name={c.activo?'toggle-right':'toggle-left'} size={17} />
                                </button>
                                <button className="btn btn-secondary btn-icon" title="Editar" onClick={() => openEdit(c)}>
                                    <Icon name="pencil" size={15} />
                                </button>
                                <button className="btn btn-secondary btn-icon" title="Eliminar" onClick={() => setConfirmDel(c)} style={{ color:'var(--danger)' }}>
                                    <Icon name="trash-2" size={15} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ─── HistorialCajaPage ────────────────────────────────────────────────────────
const HistorialCajaPage = ({ userRol = 'caja' }) => {
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
    const [fecha, setFecha] = useState(hoy);
    const [movimientos, setMovimientos] = useState([]);
    const [cierre, setCierre] = useState(null);
    const [loading, setLoading] = useState(false);
    const [expandido, setExpandido] = useState(null);
    const [vista, setVista] = useState('lista'); // 'lista' | 'clientes'
    const [cajeros, setCajeros] = useState([]);        // lista para el selector
    const [filtroCajero, setFiltroCajero] = useState(''); // '' = todos, o usu_id
    const esSupervisor = ['admin','superadmin'].includes(userRol);

    // Cargar lista de usuarios con caja para el filtro (solo supervisores)
    useEffect(() => {
        if (esSupervisor) {
            getUsuarios()
                .then(us => setCajeros((us || []).filter(u => ['caja','admin','superadmin'].includes(u.rol))))
                .catch(() => {});
        }
    }, [esSupervisor]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setLoading(true);
        setCierre(null);
        // filtroCajero === ''       → ver propios (own:true) — default para TODOS
        // filtroCajero === 'todos'  → admin ve todos los movimientos sin filtro de usuario
        // filtroCajero === '15'     → admin ve solo ese cajero (usuId)
        const movParams = { from: fecha, to: fecha };
        if (filtroCajero === 'todos') {
            // sin own ni usuId → admin ve todos
        } else if (filtroCajero) {
            movParams.usuId = filtroCajero; // cajero específico
        } else {
            movParams.own = true; // propios (cajero o admin en "mi caja")
        }

        Promise.all([
            getCajaMovimientos(movParams),
            getCajaCierre(fecha).catch(() => null),
        ]).then(([movs, c]) => {
            setMovimientos(movs);
            setCierre(c);
        }).finally(() => setLoading(false));
    }, [fecha, filtroCajero, esSupervisor]); // eslint-disable-line react-hooks/exhaustive-deps

    const cambiarDia = (delta) => {
        const d = new Date(fecha + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        setFecha(d.toISOString().slice(0, 10));
        setExpandido(null);
    };

    const movNormales  = movimientos.filter(m => !m.mov_es_reembolso);
    const reembolsos   = movimientos.filter(m => m.mov_es_reembolso);
    const totalIngreso = movNormales.filter(m => m.mov_tipo === 'ingreso').reduce((s, m) => s + m.mov_monto, 0);
    const totalEgreso  = movNormales.filter(m => m.mov_tipo === 'egreso').reduce((s, m) => s + m.mov_monto, 0);
    const totalReemb   = reembolsos.reduce((s, m) => s + m.mov_monto, 0);
    const balance      = totalIngreso - totalEgreso - totalReemb;
    const clientesSet  = new Set(movimientos.filter(m => m.cli_nombre_snap).map(m => m.cli_nombre_snap));

    // Parsear items de un movimiento
    const parseItems = (mov) => {
        if (!mov.mov_items) return null;
        try {
            const arr = typeof mov.mov_items === 'string' ? JSON.parse(mov.mov_items) : mov.mov_items;
            return Array.isArray(arr) && arr.length > 0 ? arr : null;
        } catch { return null; }
    };

    // Agrupar por cliente para vista "Por Cliente"
    const porCliente = {};
    movimientos.forEach(m => {
        const key = m.cli_nombre_snap || '— Sin cliente —';
        if (!porCliente[key]) porCliente[key] = [];
        porCliente[key].push(m);
    });

    const metodoIcon  = { efectivo:'💵', tarjeta:'💳', transferencia:'🏦', mixto:'🔀' };
    const metodoLabel = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Dividido' };
    const fechaDisplay = new Date(fecha + 'T00:00:00').toLocaleDateString('es-CL', { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone:'America/Asuncion' });
    const esHoy = fecha === hoy;

    const exportarCSV = () => {
        const metL = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Dividido' };
        const rows = [
            ['Hora', 'Tipo', 'Concepto', 'Método', 'Cliente', 'Operador', 'Monto'],
            ...[...movimientos].reverse().map(m => {
                const hora  = new Date(m.mov_timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });
                const tipo  = m.mov_es_reembolso ? 'Reembolso' : m.mov_tipo === 'ingreso' ? 'Ingreso' : 'Egreso';
                return [
                    hora,
                    tipo,
                    `"${(m.mov_concepto || '').replace(/"/g, '""')}"`,
                    metL[m.mov_metodo_pago] || m.mov_metodo_pago,
                    `"${(m.cli_nombre_snap || '').replace(/"/g, '""')}"`,
                    `"${(m.usu_nombre || '').replace(/"/g, '""')}"`,
                    m.mov_monto,
                ];
            }),
        ];
        const csv = rows.map(r => r.join(',')).join('\r\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `historial_caja_${fecha}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const printCierreHistorial = (c, movs) => {
        const fechaStr = new Date(c.cierre_fecha + 'T00:00:00').toLocaleDateString('es-PY', { weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'America/Asuncion' });
        const horaStr  = new Date(c.cierre_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });
        const logoUrl  = `${window.location.origin}/logo.png`;
        const mLabel   = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Dividido' };
        const movNorm  = movs.filter(m => !m.mov_es_reembolso);
        const reembs   = movs.filter(m => m.mov_es_reembolso);
        const ingresos = movNorm.filter(m => m.mov_tipo === 'ingreso');
        const egresos  = movNorm.filter(m => m.mov_tipo === 'egreso');
        const rowsHTML = (list) => list.map(m => {
            const hora = new Date(m.mov_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });
            return `<tr style="border-bottom:1px dashed #e5e7eb"><td style="padding:.35em .75em;font-size:.8em;color:#6b7280">${hora}</td><td style="padding:.35em .75em;font-size:.82em;color:#111827;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.mov_concepto}</td><td style="padding:.35em .75em;font-size:.75em;color:#6b7280;white-space:nowrap">${mLabel[m.mov_metodo_pago] || m.mov_metodo_pago}</td><td style="padding:.35em .75em;font-size:.85em;font-weight:700;text-align:right;white-space:nowrap">$${Number(m.mov_monto).toLocaleString('es-CL')}</td></tr>`;
        }).join('');
        const sectionHTML = (title, color, list, total) => list.length === 0 ? '' : `<div style="margin-bottom:1.1em"><div style="font-size:.7em;font-weight:800;color:${color};letter-spacing:.1em;text-transform:uppercase;border-bottom:2px solid ${color};padding-bottom:.25em;margin-bottom:.35em">${title} (${list.length})</div><table style="width:100%;border-collapse:collapse">${rowsHTML(list)}</table><div style="display:flex;justify-content:flex-end;padding:.35em .75em;font-size:.85em;font-weight:800;color:${color}">Total: $${Number(total).toLocaleString('es-CL')}</div></div>`;
        const w = window.open('', '_blank', 'width=520,height=700');
        w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cierre de Caja · ${c.cierre_fecha}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',system-ui,sans-serif;background:#f3f4f6;display:flex;justify-content:center;padding:1.5rem}.ticket{background:white;border-radius:12px;padding:1.5em;max-width:480px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.12)}@media print{body{background:white;padding:0}.ticket{box-shadow:none;border-radius:0}}</style></head><body><div class="ticket"><div style="text-align:center;margin-bottom:1.1em"><img src="${logoUrl}" alt="Logo" style="height:36px;margin-bottom:.5em;object-fit:contain" onerror="this.style.display='none'"><div style="font-size:1.05em;font-weight:900;color:#1e293b;letter-spacing:.05em">CIERRE DE CAJA</div><div style="font-size:.75em;color:#64748b;margin-top:.25em;text-transform:capitalize">${fechaStr}</div><div style="font-size:.7em;color:#94a3b8;margin-top:.15em">Cerrado a las ${horaStr}${c.usu_nombre ? ' · por ' + c.usu_nombre : ''}</div></div><div style="background:#f8fafc;border-radius:8px;padding:.85em 1em;margin-bottom:1.1em;border:1px solid #e2e8f0"><div style="display:grid;grid-template-columns:1fr 1fr;gap:.5em;margin-bottom:.5em"><div style="background:white;border-radius:6px;padding:.5em .75em;border:1px solid #e2e8f0"><div style="font-size:.6em;color:#64748b;font-weight:700;text-transform:uppercase">Ingresos</div><div style="font-size:.95em;font-weight:800;color:#16a34a">$${Number(c.cierre_ingresos).toLocaleString('es-CL')}</div></div><div style="background:white;border-radius:6px;padding:.5em .75em;border:1px solid #e2e8f0"><div style="font-size:.6em;color:#64748b;font-weight:700;text-transform:uppercase">Egresos</div><div style="font-size:.95em;font-weight:800;color:#dc2626">$${Number(c.cierre_egresos).toLocaleString('es-CL')}</div></div></div><div style="background:${Number(c.cierre_balance)>=0?'#f0fdf4':'#fef2f2'};border-radius:6px;padding:.55em 1em;border:1px solid ${Number(c.cierre_balance)>=0?'#86efac':'#fca5a5'};text-align:center"><div style="font-size:.62em;color:#64748b;font-weight:700;text-transform:uppercase;margin-bottom:.2em">Balance Final</div><div style="font-size:1.25em;font-weight:900;color:${Number(c.cierre_balance)>=0?'#16a34a':'#dc2626'}">$${Number(c.cierre_balance).toLocaleString('es-CL')}</div></div>${c.cierre_notas?`<div style="margin-top:.5em;font-size:.72em;color:#64748b;font-style:italic;text-align:center">"${c.cierre_notas}"</div>`:''}</div>${sectionHTML('Ingresos','#16a34a',ingresos,Number(c.cierre_ingresos))}${sectionHTML('Egresos','#dc2626',egresos,Number(c.cierre_egresos))}${reembs.length>0?sectionHTML('Reembolsos','#7c3aed',reembs,reembs.reduce((s,m)=>s+m.mov_monto,0)):''}<div style="margin-top:1em;padding-top:.75em;border-top:1px dashed #e2e8f0;text-align:center"><div style="font-size:.62em;color:#94a3b8">Documento de uso interno · No válido como factura fiscal</div><div style="font-size:.65em;font-weight:700;color:#6b7280;margin-top:.2em">MAISONTECH APP © ${new Date().getFullYear()}</div></div></div><script>window.onload=()=>window.print();<\/script></body></html>`);
        w.document.close();
    };

    const MovCard = ({ mov }) => {
        const items = parseItems(mov);
        const open = expandido === mov.mov_id;
        const esReemb = mov.mov_es_reembolso === 1;
        const color   = esReemb ? '#7c3aed' : mov.mov_tipo === 'ingreso' ? '#16a34a' : '#dc2626';
        const bgLight = esReemb ? '#f5f3ff' : mov.mov_tipo === 'ingreso' ? '#f0fdf4' : '#fef2f2';
        const label   = esReemb ? 'REEMBOLSO' : mov.mov_tipo === 'ingreso' ? 'INGRESO' : 'EGRESO';
        const hora    = new Date(mov.mov_timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });

        return (
            <div style={{ border: `1px solid ${open ? color : 'var(--border)'}`, borderRadius: 12, overflow:'hidden', transition:'border-color 0.2s', background:'var(--surface)' }}>
                {/* Cabecera siempre visible */}
                <div
                    onClick={() => setExpandido(open ? null : mov.mov_id)}
                    style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.75rem 1rem', cursor:'pointer', background: open ? bgLight : 'white' }}
                >
                    {/* Hora */}
                    <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', fontWeight:600, minWidth:38, textAlign:'center' }}>{hora}</div>

                    {/* Tipo badge */}
                    <span style={{ fontSize:'0.65rem', fontWeight:800, letterSpacing:'0.08em', padding:'2px 9px', borderRadius:999, background: color, color:'white', flexShrink:0 }}>
                        {label}
                    </span>

                    {/* Concepto + cliente */}
                    <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:'0.82rem', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {mov.mov_concepto}
                        </div>
                        {mov.cli_nombre_snap && (
                            <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                                <Icon name="user" size={11} style={{ color:'var(--primary)' }} />
                                <span style={{ fontSize:'0.71rem', color:'var(--primary)', fontWeight:600 }}>{mov.cli_nombre_snap}</span>
                            </div>
                        )}
                        {items && (
                            <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                {items.map(it => `${it.nombre}${it.cantidad > 1 ? ` x${it.cantidad}` : ''}`).join(' · ')}
                            </div>
                        )}
                    </div>

                    {/* Monto */}
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:'0.95rem', fontWeight:800, color }}>${Number(mov.mov_monto).toLocaleString('es-CL')}</div>
                        <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>{metodoIcon[mov.mov_metodo_pago]} {metodoLabel[mov.mov_metodo_pago]}</div>
                    </div>

                    <Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} className="text-muted" style={{ flexShrink:0 }} />
                </div>

                {/* Detalle expandido */}
                {open && (
                    <div style={{ padding:'0.75rem 1rem 1rem', borderTop:`1px dashed ${color}33`, background: bgLight }}>

                        {/* Tabla de productos */}
                        {items && (
                            <div style={{ marginBottom:'0.85rem' }}>
                                <div style={{ fontSize:'0.68rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'0.4rem' }}>
                                    Productos / Servicios
                                </div>
                                <div style={{ border:'1px solid var(--border)', borderRadius:8, overflow:'hidden', background:'var(--surface)' }}>
                                    {items.map((it, i) => (
                                        <div key={i} style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.45rem 0.75rem', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                            <span style={{ fontSize:'1rem' }}>{it.tipo === 'servicio' ? '🔧' : '📦'}</span>
                                            <span style={{ flex:1, fontSize:'0.8rem', fontWeight:500 }}>{it.nombre}</span>
                                            {it.cantidad > 1 && (
                                                <span style={{ fontSize:'0.72rem', color:'var(--text-muted)', background:'var(--bg-color)', borderRadius:999, padding:'1px 7px', fontWeight:600 }}>x{it.cantidad}</span>
                                            )}
                                            <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>${Number(it.precio).toLocaleString('es-CL')} c/u</span>
                                            <span style={{ fontSize:'0.82rem', fontWeight:700, color }}>${(it.precio * it.cantidad).toLocaleString('es-CL')}</span>
                                        </div>
                                    ))}
                                    <div style={{ display:'flex', justifyContent:'space-between', padding:'0.45rem 0.75rem', background:'var(--bg-color)', borderTop:'2px solid var(--border)' }}>
                                        <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text-muted)' }}>Subtotal ítems</span>
                                        <span style={{ fontSize:'0.88rem', fontWeight:800, color }}>${items.reduce((s,it) => s + it.precio * it.cantidad, 0).toLocaleString('es-CL')}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Datos del movimiento */}
                        <div style={{ fontSize:'0.68rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'0.4rem' }}>
                            Datos
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.35rem' }}>
                            {[
                                ['N° movimiento', `#${String(mov.mov_id).padStart(4,'0')}`],
                                ['Método de pago', `${metodoIcon[mov.mov_metodo_pago]} ${metodoLabel[mov.mov_metodo_pago]}`],
                                mov.cli_nombre_snap ? ['Cliente', mov.cli_nombre_snap] : null,
                                mov.usu_nombre ? ['Operador', mov.usu_nombre] : null,
                                mov.mov_referencia && mov.mov_metodo_pago !== 'mixto' ? ['Referencia', mov.mov_referencia] : null,
                            ].filter(Boolean).map(([lbl, val]) => (
                                <div key={lbl} style={{ background:'var(--surface)', borderRadius:7, padding:'0.4rem 0.6rem', border:'1px solid var(--border)' }}>
                                    <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', fontWeight:600 }}>{lbl}</div>
                                    <div style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--text)', marginTop:1 }}>{val}</div>
                                </div>
                            ))}
                        </div>

                        {/* Tramos pago dividido */}
                        {mov.mov_metodo_pago === 'mixto' && mov.mov_referencia && (
                            <div style={{ marginTop:'0.7rem' }}>
                                <div style={{ fontSize:'0.68rem', fontWeight:800, color:'var(--text-muted)', letterSpacing:'1.5px', textTransform:'uppercase', marginBottom:'0.4rem' }}>Distribución del pago</div>
                                <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
                                    {mov.mov_referencia.split(' | ').map((t, i) => (
                                        <div key={i} style={{ background:'var(--surface)', border:'1px solid var(--border)', borderRadius:7, padding:'0.4rem 0.7rem', display:'flex', justifyContent:'space-between', fontSize:'0.78rem' }}>
                                            <span style={{ color:'var(--text-muted)' }}>{t.split(':')[0].trim()}</span>
                                            <span style={{ fontWeight:700, color }}>{t.split(':').slice(1).join(':').trim()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="animate-fade-in">
            {/* Header fecha */}
            <div className="card p-4 mb-4" style={{ display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <button onClick={() => cambiarDia(-1)} className="btn btn-secondary btn-icon" title="Día anterior">
                        <Icon name="chevron-left" size={18} />
                    </button>
                    <input
                        type="date"
                        className="input"
                        value={fecha}
                        max={hoy}
                        onChange={e => { setFecha(e.target.value); setExpandido(null); }}
                        style={{ width:'auto', fontWeight:600 }}
                    />
                    <button onClick={() => cambiarDia(1)} className="btn btn-secondary btn-icon" title="Día siguiente" disabled={esHoy}>
                        <Icon name="chevron-right" size={18} />
                    </button>
                </div>
                <div style={{ flex:1 }}>
                    <div style={{ fontWeight:700, fontSize:'0.95rem', textTransform:'capitalize' }}>{fechaDisplay}</div>
                    {esHoy && <span style={{ fontSize:'0.7rem', color:'var(--primary)', fontWeight:700, background:'var(--primary-light)', borderRadius:999, padding:'1px 8px' }}>Hoy</span>}
                </div>
                <button onClick={() => { setFecha(hoy); setExpandido(null); }} className="btn btn-secondary" style={{ fontSize:'0.8rem' }}>
                    <Icon name="calendar-check" size={14} /> Hoy
                </button>
                {/* Selector de cajero — solo para admin/superadmin */}
                {esSupervisor && cajeros.length > 0 && (
                    <select
                        className="input"
                        value={filtroCajero}
                        onChange={e => { setFiltroCajero(e.target.value); setExpandido(null); }}
                        style={{ fontSize:'0.82rem', width:180 }}
                    >
                        <option value="">Mi caja</option>
                        <option value="todos">Todos los cajeros</option>
                        {cajeros.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                )}
                {movimientos.length > 0 && (
                    <button onClick={exportarCSV} className="btn btn-secondary" style={{ fontSize:'0.8rem', color:'var(--success)', borderColor:'#16a34a' }}>
                        <Icon name="download" size={14} /> CSV
                    </button>
                )}
            </div>

            {/* ── Banner de Cierre ── */}
            {cierre && (
                <div style={{ background:'linear-gradient(135deg,#1e293b,#334155)', border:'2px solid #fbbf24', borderRadius:14, padding:'1.1rem 1.25rem', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap' }}>
                    <div style={{ width:48, height:48, borderRadius:'50%', background:'#fbbf24', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <Icon name="lock" size={24} style={{ color:'#1e293b' }} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:900, color:'#fbbf24', fontSize:'1rem', letterSpacing:'0.05em', textTransform:'uppercase' }}>Caja Cerrada</div>
                        <div style={{ fontSize:'0.78rem', color:'#94a3b8', marginTop:2 }}>
                            Cerrado a las {new Date(cierre.cierre_timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
                            {cierre.usu_nombre ? ` · por ${cierre.usu_nombre}` : ''}
                        </div>
                        {cierre.cierre_notas && (
                            <div style={{ fontSize:'0.75rem', color:'#cbd5e1', marginTop:3, fontStyle:'italic' }}>"{cierre.cierre_notas}"</div>
                        )}
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.5rem' }}>
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.4rem', textAlign:'right' }}>
                            <div>
                                <div style={{ fontSize:'0.62rem', color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>Ingresos</div>
                                <div style={{ fontWeight:800, color:'#4ade80', fontSize:'0.88rem' }}>${Number(cierre.cierre_ingresos).toLocaleString('es-CL')}</div>
                            </div>
                            <div>
                                <div style={{ fontSize:'0.62rem', color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>Egresos</div>
                                <div style={{ fontWeight:800, color:'#f87171', fontSize:'0.88rem' }}>${Number(cierre.cierre_egresos).toLocaleString('es-CL')}</div>
                            </div>
                            <div style={{ gridColumn:'1 / -1' }}>
                                <div style={{ fontSize:'0.62rem', color:'#94a3b8', fontWeight:600, textTransform:'uppercase' }}>Balance final</div>
                                <div style={{ fontWeight:900, color: cierre.cierre_balance >= 0 ? '#4ade80' : '#f87171', fontSize:'1.1rem' }}>
                                    ${Number(cierre.cierre_balance).toLocaleString('es-CL')}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => printCierreHistorial(cierre, movimientos)}
                            style={{ display:'flex', alignItems:'center', gap:5, background:'rgba(251,191,36,0.15)', border:'1.5px solid #fbbf24', color:'#fbbf24', borderRadius:8, padding:'0.4rem 0.85rem', fontWeight:700, fontSize:'0.78rem', cursor:'pointer', whiteSpace:'nowrap' }}
                        >
                            <Icon name="printer" size={13} /> Imprimir Cierre
                        </button>
                    </div>
                </div>
            )}

            {/* KPIs */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'0.75rem', marginBottom:'1rem' }}>
                {[
                    { label:'Ingresos', val: totalIngreso, color:'var(--success)', bg:'#f0fdf4', icon:'trending-up' },
                    { label:'Egresos',  val: totalEgreso,  color:'#dc2626', bg:'#fef2f2', icon:'trending-down' },
                    { label:'Balance',  val: balance,      color: balance >= 0 ? '#16a34a' : '#dc2626', bg: balance >= 0 ? '#f0fdf4' : '#fef2f2', icon:'wallet' },
                    { label:'Clientes', val: clientesSet.size, color:'var(--primary)', bg:'#eef2ff', icon:'users', currency: false },
                    { label:'Movimientos', val: movimientos.length, color:'#0369a1', bg:'#e0f2fe', icon:'list', currency: false },
                ].map(({ label, val, color, bg, icon, currency = true }) => (
                    <div key={label} style={{ background: bg, border:`1px solid ${color}22`, borderRadius:12, padding:'0.85rem 1rem' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
                            <Icon name={icon} size={14} style={{ color }} />
                            <span style={{ fontSize:'0.68rem', fontWeight:700, color, textTransform:'uppercase', letterSpacing:'0.08em' }}>{label}</span>
                        </div>
                        <div style={{ fontSize: currency ? '1.2rem' : '1.5rem', fontWeight:900, color }}>
                            {currency ? `$${Number(val).toLocaleString('es-CL')}` : val}
                        </div>
                    </div>
                ))}
            </div>

            {/* Selector de vista */}
            <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
                <button
                    onClick={() => setVista('lista')}
                    className={`btn ${vista === 'lista' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize:'0.82rem', gap:5 }}>
                    <Icon name="list" size={14} /> Por Movimiento
                </button>
                <button
                    onClick={() => setVista('clientes')}
                    className={`btn ${vista === 'clientes' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize:'0.82rem', gap:5 }}>
                    <Icon name="users" size={14} /> Por Cliente
                </button>
            </div>

            {loading ? (
                <div className="card p-8" style={{ textAlign:'center', color:'var(--text-muted)' }}>
                    <Icon name="loader" size={28} className="animate-spin mb-2" />
                    <div>Cargando historial...</div>
                </div>
            ) : movimientos.length === 0 ? (
                <div className="card p-8" style={{ textAlign:'center', color:'var(--text-muted)' }}>
                    <Icon name="inbox" size={40} style={{ marginBottom:12, opacity:0.4 }} />
                    <div style={{ fontWeight:600, marginBottom:4 }}>Sin movimientos</div>
                    <div style={{ fontSize:'0.82rem' }}>No hubo actividad en caja el {fechaDisplay}</div>
                </div>
            ) : vista === 'lista' ? (
                /* ── Vista lista ── */
                <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
                    {[...movimientos].reverse().map(mov => <MovCard key={mov.mov_id} mov={mov} />)}
                </div>
            ) : (
                /* ── Vista por cliente ── */
                <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
                    {Object.entries(porCliente).sort(([a],[b]) => a.localeCompare(b)).map(([cliente, movs]) => {
                        const totalCli = movs.filter(m => m.mov_tipo === 'ingreso' && !m.mov_es_reembolso).reduce((s,m) => s + m.mov_monto, 0)
                                       - movs.filter(m => m.mov_tipo === 'egreso'  && !m.mov_es_reembolso).reduce((s,m) => s + m.mov_monto, 0);
                        const sinCliente = cliente === '— Sin cliente —';
                        return (
                            <div key={cliente} className="card" style={{ overflow:'hidden' }}>
                                {/* Header del cliente */}
                                <div style={{ padding:'0.85rem 1rem', background: sinCliente ? 'var(--bg-color)' : 'var(--primary-light)', display:'flex', alignItems:'center', gap:'0.75rem', borderBottom:'1px solid var(--border)' }}>
                                    <div style={{ width:36, height:36, borderRadius:'50%', background: sinCliente ? '#e5e7eb' : 'var(--primary)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                        <Icon name={sinCliente ? 'user-x' : 'user'} size={18} style={{ color: sinCliente ? '#9ca3af' : 'white' }} />
                                    </div>
                                    <div style={{ flex:1 }}>
                                        <div style={{ fontWeight:700, fontSize:'0.92rem', color: sinCliente ? 'var(--text-muted)' : 'var(--primary)' }}>{cliente}</div>
                                        <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{movs.length} movimiento{movs.length !== 1 ? 's' : ''}</div>
                                    </div>
                                    <div style={{ textAlign:'right' }}>
                                        <div style={{ fontSize:'1rem', fontWeight:800, color: totalCli >= 0 ? '#16a34a' : '#dc2626' }}>
                                            ${Math.abs(totalCli).toLocaleString('es-CL')}
                                        </div>
                                        <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>total</div>
                                    </div>
                                </div>
                                {/* Movimientos del cliente */}
                                <div style={{ padding:'0.6rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                    {movs.map(mov => <MovCard key={mov.mov_id} mov={mov} />)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

// ─── UsuariosPage ─────────────────────────────────────────────────────────────
const ROL_LABELS = { admin: 'Admin', caja: 'Cajero', terreno: 'Recaudador' };
const ROL_COLORS = { admin: '#6366f1', caja: '#0891b2', terreno: '#16a34a' };

function UsuariosPage({ userRol }) {
    const [usuarios, setUsuarios] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modal, setModal] = useState(null); // null | { mode:'new'|'edit', data? }
    const [delTarget, setDelTarget] = useState(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ nombre:'', user:'', pass:'', rol:'terreno', email:'' });
    const [vehiculoForm, setVehiculoForm] = useState({ modelo:'', marca:'', color:'', chapa:'' });
    const [formErr, setFormErr] = useState('');
    const [passVisible, setPassVisible] = useState(new Set()); // ids con password visible
    const [perfilUsu, setPerfilUsu] = useState(null);          // usuario abierto en panel de perfil
    const [perfilRuns, setPerfilRuns] = useState([]);
    const [perfilLoading, setPerfilLoading] = useState(false);
    const [perfilAsignando, setPerfilAsignando] = useState(false);
    const [todasMaquinas, setTodasMaquinas] = useState([]);
    const [perfilSelec, setPerfilSelec] = useState(new Set());
    const [perfilCreating, setPerfilCreating] = useState(false);
    const [perfilBuscar, setPerfilBuscar] = useState('');
    const [perfilError, setPerfilError] = useState('');
    const [perfilRemoving, setPerfilRemoving] = useState(new Set()); // stopIds en proceso de eliminación
    const [perfilVehiculo, setPerfilVehiculo] = useState(null); // vehículo del recaudador
    const [buscarUsu, setBuscarUsu] = useState('');
    const [filtroRol, setFiltroRol] = useState('todos');

    const rolesDisponibles = userRol === 'superadmin'
        ? ['superadmin', 'admin', 'caja', 'terreno']
        : ['admin', 'caja', 'terreno'];

    const load = useCallback(async () => {
        setLoading(true);
        try { setUsuarios(await getUsuarios()); }
        catch (e) { setError(e.message); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const abrirPerfil = async (u) => {
        setPerfilUsu(u);
        setPerfilRuns([]);
        setPerfilVehiculo(null);
        setPerfilLoading(true);
        setPerfilAsignando(false);
        setPerfilSelec(new Set());
        setPerfilBuscar('');
        setPerfilError('');
        try {
            const [runs] = await Promise.all([
                getRouteRuns({ usuId: u.id }),
            ]);
            setPerfilRuns(runs);
            if (u.rol === 'terreno') {
                try { setPerfilVehiculo(await getVehiculo(u.id)); } catch {}
            }
        } catch { setPerfilRuns([]); }
        finally { setPerfilLoading(false); }
    };

    const abrirAsignacion = async () => {
        setPerfilAsignando(true);
        setPerfilSelec(new Set());
        setPerfilBuscar('');
        if (todasMaquinas.length === 0) {
            try { setTodasMaquinas(await getMachines()); } catch {}
        }
    };

    const handleRemoveStop = async (runId, stopId) => {
        setPerfilRemoving(s => { const n = new Set(s); n.add(stopId); return n; });
        try {
            const res = await deleteStop(runId, stopId);
            // Recargar recorridos del recaudador
            const runs = await getRouteRuns({ usuId: perfilUsu.id });
            setPerfilRuns(runs);
        } catch (e) { setPerfilError(e.message); }
        finally { setPerfilRemoving(s => { const n = new Set(s); n.delete(stopId); return n; }); }
    };

    const crearRecorridoPerfil = async () => {
        if (perfilSelec.size === 0) return;
        setPerfilCreating(true);
        setPerfilError('');
        try {
            await createRouteRun([...perfilSelec], perfilUsu.id);
            const runs = await getRouteRuns({ usuId: perfilUsu.id });
            setPerfilRuns(runs);
            setPerfilSelec(new Set());
            setPerfilAsignando(false);
        } catch (e) { setPerfilError(e.message); }
        finally { setPerfilCreating(false); }
    };

    const openNew = () => {
        setForm({ nombre:'', user:'', pass:'', rol:'terreno', email:'' });
        setVehiculoForm({ modelo:'', marca:'', color:'', chapa:'' });
        setFormErr('');
        setModal({ mode:'new' });
    };
    const openEdit = async (u) => {
        const rolInicial = rolesDisponibles.includes(u.rol) ? u.rol : rolesDisponibles[0];
        setForm({ nombre: u.nombre, user: u.user, pass:'', rol: rolInicial, email: u.email || '' });
        setVehiculoForm({ modelo:'', marca:'', color:'', chapa:'' });
        setFormErr('');
        setModal({ mode:'edit', data: u });
        // Cargar vehículo si es recaudador
        if (u.rol === 'terreno') {
            try {
                const v = await getVehiculo(u.id);
                if (v) setVehiculoForm({ modelo: v.modelo || '', marca: v.marca || '', color: v.color || '', chapa: v.chapa || '' });
            } catch {}
        }
    };

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const handleSave = async () => {
        if (!form.nombre.trim()) return setFormErr('El nombre es requerido');
        if (modal.mode === 'new' && (!form.user.trim() || !form.pass.trim())) return setFormErr('Usuario y contraseña son requeridos para un usuario nuevo');
        if (modal.mode === 'new' && !form.email.trim()) return setFormErr('El email es requerido para poder recuperar la contraseña');
        if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim())) return setFormErr('El email ingresado no tiene un formato válido');
        if (form.pass.trim() && form.pass.trim().length < 8) return setFormErr('La contraseña debe tener al menos 8 caracteres');
        setSaving(true); setFormErr('');
        try {
            let usuId;
            if (modal.mode === 'new') {
                const creado = await createUsuario(form);
                usuId = creado.id;
            } else {
                const payload = { nombre: form.nombre, rol: form.rol, email: form.email || '' };
                if (form.pass.trim()) payload.pass = form.pass;
                await updateUsuario(modal.data.id, payload);
                usuId = modal.data.id;
            }
            // Guardar vehículo si el rol es terreno y hay modelo ingresado
            const rolFinal = form.rol;
            if (rolFinal === 'terreno' && vehiculoForm.modelo.trim()) {
                await saveVehiculo(usuId, vehiculoForm);
            }
            setModal(null);
            await load();
        } catch (e) { setFormErr(e.message); }
        finally { setSaving(false); }
    };

    const handleDelete = async () => {
        if (!delTarget) return;
        try { await deleteUsuario(delTarget.id); setDelTarget(null); await load(); }
        catch (e) { setError(e.message); }
    };

    if (loading) return <div className="card p-6 text-muted text-center">Cargando usuarios...</div>;

    const q = buscarUsu.toLowerCase().trim();
    const usuariosFiltrados = usuarios.filter(u => {
        if (filtroRol !== 'todos' && u.rol !== filtroRol) return false;
        if (q && !u.nombre.toLowerCase().includes(q) && !u.user.toLowerCase().includes(q)) return false;
        return true;
    });

    return (
        <div>
            <div className="card" style={{ marginBottom:'1rem' }}>
                <div style={{ padding:'1rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:'0.75rem', borderBottom:'1px solid var(--border)' }}>
                    <h2 style={{ fontWeight:700, fontSize:'1rem', display:'flex', alignItems:'center', gap:8 }}>
                        <Icon name="users" size={18} className="text-primary" /> Usuarios del Sistema
                        <span className="badge badge-primary" style={{ marginLeft:4 }}>{usuariosFiltrados.length}{q || filtroRol !== 'todos' ? ` / ${usuarios.length}` : ''}</span>
                    </h2>
                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                        {/* Búsqueda */}
                        <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
                            <Icon name="search" size={14} style={{ position:'absolute', left:9, color:'var(--text-muted)', pointerEvents:'none' }} />
                            <input
                                type="text"
                                value={buscarUsu}
                                onChange={e => setBuscarUsu(e.target.value)}
                                placeholder="Buscar usuario..."
                                style={{ paddingLeft:30, fontSize:'0.82rem', padding:'0.35rem 0.75rem 0.35rem 2rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text-primary)', width:180 }}
                            />
                            {buscarUsu && (
                                <button onClick={() => setBuscarUsu('')} style={{ position:'absolute', right:6, background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:'0.9rem', lineHeight:1 }}>✕</button>
                            )}
                        </div>
                        {/* Filtro rol */}
                        <select
                            value={filtroRol}
                            onChange={e => setFiltroRol(e.target.value)}
                            style={{ fontSize:'0.82rem', padding:'0.35rem 0.6rem', borderRadius:8, border:'1px solid var(--border)', background:'var(--surface)', color:'var(--text-primary)' }}
                        >
                            <option value="todos">— Todos los roles —</option>
                            <option value="superadmin">Super Admin</option>
                            <option value="admin">Admin</option>
                            <option value="caja">Cajero</option>
                            <option value="terreno">Recaudador</option>
                        </select>
                        <button className="btn btn-primary" style={{ display:'flex', alignItems:'center', gap:6 }} onClick={openNew}>
                            <Icon name="user-plus" size={16} /> Nuevo
                        </button>
                    </div>
                </div>
                {error && <div className="alert alert-danger m-4">{error}</div>}

                {/* ── DESKTOP: tabla ── */}
                <div className="usuarios-table-wrapper">
                <table className="table" style={{ width:'100%' }}>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Nombre</th>
                            <th>Usuario</th>
                            <th>Rol</th>
                            <th>Contraseña</th>
                            <th style={{ textAlign:'right' }}>Acciones</th>
                        </tr>
                    </thead>
                    <tbody>
                        {usuariosFiltrados.length === 0 ? (
                            <tr><td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)', fontSize:'0.88rem' }}>
                                {q || filtroRol !== 'todos' ? 'No se encontraron usuarios con esos criterios.' : 'Sin usuarios registrados.'}
                            </td></tr>
                        ) : null}
                        {usuariosFiltrados.map(u => {
                            const visible = passVisible.has(u.id);
                            const togglePass = () => setPassVisible(s => {
                                const n = new Set(s);
                                n.has(u.id) ? n.delete(u.id) : n.add(u.id);
                                return n;
                            });
                            return (
                                <tr key={u.id}>
                                    <td style={{ color:'var(--text-muted)', fontSize:'0.8rem' }}>{u.id}</td>
                                    <td style={{ fontWeight:600 }}>{u.nombre}</td>
                                    <td style={{ fontFamily:'monospace', fontSize:'0.875rem' }}>{u.user}</td>
                                    <td>
                                        <span style={{ background: ROL_COLORS[u.rol] || '#64748b', color:'white', borderRadius:999, fontSize:'0.72rem', fontWeight:700, padding:'2px 10px' }}>
                                            {ROL_LABELS[u.rol] || u.rol}
                                        </span>
                                    </td>
                                    <td>
                                        {u.password !== null ? (
                                            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                                <span style={{ fontFamily:'monospace', fontSize:'0.85rem', letterSpacing: visible ? 'normal' : '0.12em', color: visible ? 'var(--text)' : 'var(--text-muted)', userSelect: visible ? 'text' : 'none' }}>
                                                    {visible ? u.password : '••••••••'}
                                                </span>
                                                <button
                                                    onClick={togglePass}
                                                    title={visible ? 'Ocultar contraseña' : 'Ver contraseña'}
                                                    style={{ background:'none', border:'none', cursor:'pointer', padding:2, color:'var(--text-muted)', display:'flex', flexShrink:0 }}>
                                                    <Icon name={visible ? 'eye-off' : 'eye'} size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize:'0.75rem', color:'var(--text-muted)', fontStyle:'italic' }}>
                                                {u.rol === 'superadmin' || (u.rol === 'admin' && userRol !== 'superadmin') ? '—' : 'Sin registro'}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ textAlign:'right' }}>
                                        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                                            {u.rol === 'terreno' && (
                                                <button className="btn btn-secondary btn-icon" title="Ver perfil y recorridos" onClick={() => abrirPerfil(u)}>
                                                    <Icon name="layout-list" size={15} />
                                                </button>
                                            )}
                                            {(userRol === 'superadmin' || (u.rol !== 'superadmin' && u.rol !== 'admin')) && (
                                                <>
                                                    <button className="btn btn-secondary btn-icon" title="Editar" onClick={() => openEdit(u)}><Icon name="pencil" size={15} /></button>
                                                    <button className="btn btn-icon" title="Eliminar" style={{ color:'var(--danger,#ef4444)', border:'1px solid var(--danger,#ef4444)', background:'transparent' }} onClick={() => setDelTarget(u)}><Icon name="trash-2" size={15} /></button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                </div>{/* fin .usuarios-table-wrapper */}

                {/* ── MÓVIL: tarjetas ── */}
                <div className="usuarios-mobile-list">
                    {usuariosFiltrados.length === 0 && (
                        <div style={{ padding:'2rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.88rem' }}>
                            {q || filtroRol !== 'todos' ? 'No se encontraron usuarios con esos criterios.' : 'Sin usuarios registrados.'}
                        </div>
                    )}
                    {usuariosFiltrados.map(u => {
                        const visible = passVisible.has(u.id);
                        const togglePass = () => setPassVisible(s => { const n = new Set(s); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n; });
                        return (
                            <div key={u.id} className="usuario-card">
                                <div className="usuario-card-header">
                                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                        <div style={{ width:40, height:40, borderRadius:'50%', background: ROL_COLORS[u.rol] || '#64748b', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                            <Icon name="user" size={18} style={{ color:'white' }} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight:700, fontSize:'0.9rem' }}>{u.nombre}</div>
                                            <div style={{ fontFamily:'monospace', fontSize:'0.75rem', color:'var(--text-muted)' }}>@{u.user}</div>
                                        </div>
                                    </div>
                                    <span style={{ background: ROL_COLORS[u.rol] || '#64748b', color:'white', borderRadius:999, fontSize:'0.7rem', fontWeight:700, padding:'3px 10px', flexShrink:0 }}>
                                        {ROL_LABELS[u.rol] || u.rol}
                                    </span>
                                </div>
                                {u.password !== null && (
                                    <div className="usuario-card-pass">
                                        <span style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px', flexShrink:0 }}>Contraseña:</span>
                                        <span style={{ fontFamily:'monospace', flex:1, letterSpacing: visible ? 'normal' : '0.1em', fontSize:'0.82rem' }}>
                                            {visible ? u.password : '••••••••'}
                                        </span>
                                        <button onClick={togglePass} style={{ background:'none', border:'none', cursor:'pointer', padding:2, color:'var(--text-muted)', display:'flex', flexShrink:0 }}>
                                            <Icon name={visible ? 'eye-off' : 'eye'} size={14} />
                                        </button>
                                    </div>
                                )}
                                <div className="usuario-card-actions">
                                    {u.rol === 'terreno' && (
                                        <button className="btn btn-secondary btn-icon" title="Ver perfil" onClick={() => abrirPerfil(u)}>
                                            <Icon name="layout-list" size={15} />
                                        </button>
                                    )}
                                    {(userRol === 'superadmin' || (u.rol !== 'superadmin' && u.rol !== 'admin')) && (<>
                                        <button className="btn btn-secondary btn-icon" title="Editar" onClick={() => openEdit(u)}>
                                            <Icon name="pencil" size={15} />
                                        </button>
                                        <button className="btn btn-icon" title="Eliminar"
                                            style={{ color:'var(--danger)', border:'1px solid var(--danger)', background:'transparent' }}
                                            onClick={() => setDelTarget(u)}>
                                            <Icon name="trash-2" size={15} />
                                        </button>
                                    </>)}
                                </div>
                            </div>
                        );
                    })}
                </div>

            </div>

            {/* Modal crear/editar */}
            {modal && createPortal(
                <div className="modal-overlay" onClick={() => setModal(null)}>
                    <div className="modal-box" style={{ maxWidth:440, display:'flex', flexDirection:'column', maxHeight:'90vh' }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding:'1.1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <h3 style={{ fontWeight:700, fontSize:'1rem', margin:0 }}>{modal.mode === 'new' ? 'Nuevo Usuario' : 'Editar Usuario'}</h3>
                            <button className="btn btn-secondary btn-icon" onClick={() => setModal(null)}><Icon name="x" size={18} /></button>
                        </div>
                        <div style={{ padding:'1.25rem', display:'flex', flexDirection:'column', gap:'0.85rem', overflowY:'auto' }}>
                            {formErr && <div className="alert alert-danger">{formErr}</div>}
                            <label className="form-group">
                                <span className="form-label">Nombre completo</span>
                                <input className="input" value={form.nombre} onChange={e => setForm(f=>({...f,nombre:e.target.value}))} placeholder="Ej: Juan Pérez" />
                            </label>
                            {modal.mode === 'new' && (
                                <label className="form-group">
                                    <span className="form-label">Nombre de usuario</span>
                                    <input className="input" value={form.user} onChange={e => setForm(f=>({...f,user:e.target.value}))} placeholder="Ej: juanp" autoComplete="off" />
                                </label>
                            )}
                            <label className="form-group">
                                <span className="form-label">{modal.mode === 'new' ? 'Contraseña' : 'Nueva contraseña (dejar vacío para no cambiar)'}</span>
                                <input className="input" type="password" value={form.pass} onChange={e => setForm(f=>({...f,pass:e.target.value}))} placeholder={modal.mode === 'new' ? 'Mínimo 8 caracteres' : 'Sin cambios si se deja vacío'} autoComplete="new-password" minLength={8} required={modal.mode === 'new'} />
                            </label>
                            <label className="form-group">
                                <span className="form-label">Email {modal.mode === 'new' ? <span style={{ color:'var(--danger)' }}>*</span> : <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(opcional)</span>}</span>
                                <input className="input" type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="usuario@ejemplo.com" autoComplete="off" required={modal.mode === 'new'} />
                            </label>
                            <label className="form-group">
                                <span className="form-label">Rol</span>
                                <select className="input" value={form.rol} onChange={e => setForm(f=>({...f,rol:e.target.value}))}>
                                    {rolesDisponibles.map(r => (
                                        <option key={r} value={r}>{ROL_LABELS[r] || r}</option>
                                    ))}
                                </select>
                            </label>
                            <div style={{ background:'var(--bg-color)', borderRadius:8, padding:'0.65rem 0.85rem', fontSize:'0.8rem', color:'var(--text-muted)', borderLeft:'3px solid var(--primary)' }}>
                                {form.rol === 'caja' && '🏧 Acceso exclusivo al módulo de Caja e Historial.'}
                                {form.rol === 'terreno' && '📍 Acceso a la app móvil de recaudación en campo + módulo de Caja integrado.'}
                                {form.rol === 'admin' && '🛡️ Acceso completo al sistema de administración.'}
                                {form.rol === 'superadmin' && '👑 Acceso total al sistema, incluyendo configuración y gestión de administradores.'}
                            </div>

                            {/* Info: terreno incluye caja por defecto */}
                            {form.rol === 'terreno' && (
                                <div style={{ display:'flex', alignItems:'flex-start', gap:'0.55rem', padding:'0.6rem 0.75rem', background:'var(--success-light)', border:'1.5px solid var(--success)', borderRadius:8 }}>
                                    <span style={{ fontSize:'1rem', lineHeight:1.4 }}>🏧</span>
                                    <div>
                                        <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--success)' }}>Módulo de Caja incluido</div>
                                        <div style={{ fontSize:'0.72rem', color:'#047857', marginTop:2 }}>
                                            Al aceptar una ruta se abre la caja automáticamente. La recaudación de MQs se registra como ingresos y la caja se cierra al finalizar.
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Vehículo — solo para recaudadores de terreno */}
                            {form.rol === 'terreno' && (
                                <div style={{ borderTop: '1px dashed var(--border)', paddingTop: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                        <Icon name="car" size={14} /> Vehículo del Recaudador
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                                        <label className="form-group" style={{ margin: 0 }}>
                                            <span className="form-label">Modelo <span style={{ color:'var(--danger)' }}>*</span></span>
                                            <input className="input" value={vehiculoForm.modelo} onChange={e => setVehiculoForm(f=>({...f, modelo:e.target.value}))} placeholder="Ej: Hilux, Civic" />
                                        </label>
                                        <label className="form-group" style={{ margin: 0 }}>
                                            <span className="form-label">Marca</span>
                                            <input className="input" value={vehiculoForm.marca} onChange={e => setVehiculoForm(f=>({...f, marca:e.target.value}))} placeholder="Ej: Toyota, Honda" />
                                        </label>
                                        <label className="form-group" style={{ margin: 0 }}>
                                            <span className="form-label">Color</span>
                                            <input className="input" value={vehiculoForm.color} onChange={e => setVehiculoForm(f=>({...f, color:e.target.value}))} placeholder="Ej: Blanco, Negro" />
                                        </label>
                                        <label className="form-group" style={{ margin: 0 }}>
                                            <span className="form-label">Chapa / Patente</span>
                                            <input className="input" style={{ textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }}
                                                value={vehiculoForm.chapa}
                                                onChange={e => setVehiculoForm(f=>({...f, chapa:e.target.value.toUpperCase()}))}
                                                placeholder="Ej: ABC-1234" />
                                        </label>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                        El modelo es obligatorio para guardar el vehículo. Los demás campos son opcionales.
                                    </div>
                                </div>
                            )}
                        </div>
                        <div style={{ padding:'1rem 1.25rem', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:'0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                {saving ? 'Guardando...' : modal.mode === 'new' ? 'Crear Usuario' : 'Guardar Cambios'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Confirmar eliminación */}
            {delTarget && createPortal(
                <div className="modal-overlay" onClick={() => setDelTarget(null)}>
                    <div className="modal-box" style={{ maxWidth:400, display:'flex', flexDirection:'column' }} onClick={e => e.stopPropagation()}>
                        <div style={{ padding:'1.1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <h3 style={{ fontWeight:700, fontSize:'1rem', margin:0 }}>Eliminar Usuario</h3>
                            <button className="btn btn-secondary btn-icon" onClick={() => setDelTarget(null)}><Icon name="x" size={18} /></button>
                        </div>
                        <div style={{ padding:'1.25rem' }}>
                            <p>¿Estás seguro de eliminar al usuario <strong>{delTarget.nombre}</strong> (<code>{delTarget.user}</code>)?</p>
                            <p style={{ marginTop:'0.5rem', color:'var(--text-muted)', fontSize:'0.85rem' }}>Esta acción no se puede deshacer.</p>
                        </div>
                        <div style={{ padding:'1rem 1.25rem', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end', gap:'0.5rem' }}>
                            <button className="btn btn-secondary" onClick={() => setDelTarget(null)}>Cancelar</button>
                            <button className="btn" style={{ background:'var(--danger,#ef4444)', color:'white' }} onClick={handleDelete}>Eliminar</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── Modal perfil recaudador ── */}
            {perfilUsu && createPortal(
                <div className="modal-overlay" onClick={() => { setPerfilUsu(null); setPerfilAsignando(false); }}>
                    <div className="modal-box" style={{ maxWidth:580, display:'flex', flexDirection:'column', maxHeight:'90vh', overflow:'hidden' }} onClick={e => e.stopPropagation()}>

                        {/* Cabecera */}
                        <div style={{ padding:'1.1rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:12 }}>
                            <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--success-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon name="hard-hat" size={22} style={{ color:'var(--success)' }} />
                            </div>
                            <div style={{ flex:1 }}>
                                <div style={{ fontWeight:800, fontSize:'1rem' }}>{perfilUsu.nombre}</div>
                                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>@{perfilUsu.user} · Recaudador de terreno</div>
                            </div>
                            <button className="btn btn-secondary btn-icon" onClick={() => { setPerfilUsu(null); setPerfilAsignando(false); }}><Icon name="x" size={18} /></button>
                        </div>

                        {/* Cuerpo scrollable */}
                        <div style={{ flex:1, overflowY:'auto', padding:'1.1rem 1.25rem', display:'flex', flexDirection:'column', gap:'1.1rem' }}>

                            {/* Vehículo del recaudador */}
                            {perfilUsu.rol === 'terreno' && (
                                <div style={{ background: perfilVehiculo ? '#f0fdf4' : 'var(--bg-color)', border: `1px solid ${perfilVehiculo ? '#86efac' : 'var(--border)'}`, borderRadius: 10, padding: '0.85rem 1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: perfilVehiculo ? '0.65rem' : 0 }}>
                                        <Icon name="car" size={16} style={{ color: perfilVehiculo ? '#16a34a' : 'var(--text-muted)' }} />
                                        <span style={{ fontWeight: 700, fontSize: '0.82rem', color: perfilVehiculo ? '#15803d' : 'var(--text-muted)' }}>
                                            Vehículo Asignado
                                        </span>
                                        {!perfilVehiculo && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Sin vehículo registrado</span>}
                                    </div>
                                    {perfilVehiculo && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.35rem 1rem' }}>
                                            {perfilVehiculo.modelo && (
                                                <div>
                                                    <div style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Modelo</div>
                                                    <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{perfilVehiculo.modelo}</div>
                                                </div>
                                            )}
                                            {perfilVehiculo.marca && (
                                                <div>
                                                    <div style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Marca</div>
                                                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{perfilVehiculo.marca}</div>
                                                </div>
                                            )}
                                            {perfilVehiculo.color && (
                                                <div>
                                                    <div style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Color</div>
                                                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{perfilVehiculo.color}</div>
                                                </div>
                                            )}
                                            {perfilVehiculo.chapa && (
                                                <div>
                                                    <div style={{ fontSize: '0.65rem', color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Chapa / Patente</div>
                                                    <div style={{ fontWeight: 800, fontSize: '0.95rem', letterSpacing: '1.5px', color: '#15803d' }}>{perfilVehiculo.chapa}</div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Stats rápidos */}
                            {!perfilLoading && (() => {
                                const pendientes  = perfilRuns.filter(r => r.status === 'pending');
                                const activos     = perfilRuns.filter(r => r.status === 'active');
                                const completados = perfilRuns.filter(r => r.status === 'completed');
                                const cancelados  = perfilRuns.filter(r => r.status === 'cancelled');
                                const totalRec    = completados.reduce((s, r) => s + (r.totalRecaudado || 0), 0);
                                const promedio    = completados.length > 0 ? Math.round(totalRec / completados.length) : 0;
                                return (
                                    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.5rem' }}>
                                            {[
                                                { label:'Pendientes',  val: pendientes.length,  color:'#ea580c', bg:'#fff7ed', border:'#fdba74', icon:'clock' },
                                                { label:'En curso',    val: activos.length,     color:'var(--primary)', bg:'#eef2ff', border:'#a5b4fc', icon:'route' },
                                                { label:'Completados', val: completados.length, color:'var(--success)', bg:'#f0fdf4', border:'#86efac', icon:'check-circle' },
                                                { label:'Cancelados',  val: cancelados.length,  color:'#6b7280', bg:'#f9fafb', border:'#d1d5db', icon:'x-circle' },
                                            ].map(({ label, val, color, bg, border, icon }) => (
                                                <div key={label} style={{ background:bg, border:`1px solid ${border}`, borderRadius:10, padding:'0.55rem 0.5rem', textAlign:'center' }}>
                                                    <Icon name={icon} size={16} style={{ color, marginBottom:2 }} />
                                                    <div style={{ fontWeight:800, fontSize:'1.2rem', color }}>{val}</div>
                                                    <div style={{ fontSize:'0.6rem', color, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{label}</div>
                                                </div>
                                            ))}
                                        </div>
                                        {completados.length > 0 && (
                                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                                                <div style={{ background:'var(--success-light)', border:'1px solid var(--success)', borderRadius:10, padding:'0.55rem 0.75rem', textAlign:'center' }}>
                                                    <div style={{ fontSize:'0.6rem', color:'var(--success)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Total recaudado</div>
                                                    <div style={{ fontWeight:800, fontSize:'0.9rem', color:'var(--success)' }}>Gs. {totalRec.toLocaleString('es-PY')}</div>
                                                </div>
                                                <div style={{ background:'var(--primary-light)', border:'1px solid #a5b4fc', borderRadius:10, padding:'0.55rem 0.75rem', textAlign:'center' }}>
                                                    <div style={{ fontSize:'0.6rem', color:'var(--primary)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>Promedio/recorrido</div>
                                                    <div style={{ fontWeight:800, fontSize:'0.9rem', color:'var(--primary)' }}>Gs. {promedio.toLocaleString('es-PY')}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ── Máquinas actualmente asignadas ── */}
                            {(() => {
                                const maqAsignadas = [];
                                const vistas = new Set();
                                perfilRuns.filter(r => r.status === 'pending' || r.status === 'active').forEach(run => {
                                    (run.stops ?? []).forEach(s => {
                                        if (!vistas.has(s.machineId)) {
                                            vistas.add(s.machineId);
                                            maqAsignadas.push({ ...s, runId: run.id, runStatus: run.status });
                                        }
                                    });
                                });

                                return (
                                    <div>
                                        <div style={{ fontSize:'0.65rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'1.4px', marginBottom:'0.6rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                                            <span>Máquinas asignadas actualmente</span>
                                            <span style={{ background:'var(--bg-color)', border:'1px solid var(--border)', borderRadius:99, padding:'1px 9px', fontSize:'0.7rem', fontWeight:700, color:'var(--text-muted)' }}>{maqAsignadas.length}</span>
                                        </div>
                                        {perfilError && !perfilAsignando && (
                                            <div className="alert alert-danger" style={{ fontSize:'0.8rem', padding:'0.45rem 0.85rem', marginBottom:'0.5rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                                <span>{perfilError}</span>
                                                <button onClick={() => setPerfilError('')} style={{ background:'none', border:'none', cursor:'pointer', padding:0, color:'inherit' }}><Icon name="x" size={13} /></button>
                                            </div>
                                        )}
                                        {perfilLoading ? (
                                            <div style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)' }}>
                                                <Icon name="loader" size={22} className="animate-spin" />
                                            </div>
                                        ) : maqAsignadas.length === 0 ? (
                                            <div style={{ textAlign:'center', padding:'1.25rem', color:'var(--text-muted)', background:'var(--bg-color)', borderRadius:10, border:'1px dashed var(--border)' }}>
                                                <Icon name="map-pin-off" size={26} style={{ opacity:0.3, marginBottom:5 }} />
                                                <div style={{ fontWeight:600, fontSize:'0.82rem' }}>Sin máquinas asignadas actualmente</div>
                                                <div style={{ fontSize:'0.75rem', marginTop:3 }}>Asigná un recorrido usando el botón de abajo.</div>
                                            </div>
                                        ) : (
                                            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                                                {maqAsignadas.map((s, i) => {
                                                    const isActive = s.runStatus === 'active';
                                                    const dot = s.status === 'done' ? '#16a34a' : s.status === 'failed' ? '#ef4444' : isActive ? '#4f46e5' : '#ea580c';
                                                    const bg  = isActive ? '#eef2ff' : '#fff7ed';
                                                    const bd  = isActive ? '#a5b4fc' : '#fdba74';
                                                    return (
                                                        <span key={s.machineId} style={{ display:'flex', alignItems:'center', gap:5, fontSize:'0.78rem', background:bg, border:`1px solid ${bd}`, borderRadius:8, padding:'4px 6px 4px 10px', color:'var(--text)', fontWeight:500 }}>
                                                            {perfilRemoving.has(s.id)
                                                                ? <Icon name="loader" size={12} className="animate-spin" style={{ color:dot, flexShrink:0 }} />
                                                                : <span style={{ width:8, height:8, borderRadius:'50%', background:dot, flexShrink:0, display:'inline-block' }} />
                                                            }
                                                            <span style={{ fontWeight:700 }}>{s.location ?? s.machineId}</span>
                                                            <span style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginLeft:2 }}>· #{s.runId}</span>
                                                            <button
                                                                title="Quitar esta máquina del recorrido"
                                                                disabled={perfilRemoving.has(s.id)}
                                                                onClick={() => handleRemoveStop(s.runId, s.id)}
                                                                style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 2px', display:'flex', alignItems:'center', color:'#9ca3af', lineHeight:1, marginLeft:1, flexShrink:0, opacity: perfilRemoving.has(s.id) ? 0.4 : 1 }}
                                                                onMouseEnter={e => e.currentTarget.style.color='#ef4444'}
                                                                onMouseLeave={e => e.currentTarget.style.color='#9ca3af'}>
                                                                <Icon name="x" size={13} />
                                                            </button>
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* ── Panel: Asignar nuevo recorrido ── */}
                            <div style={{ background:'var(--bg-color)', border:'1px solid var(--border)', borderRadius:12, overflow:'hidden' }}>
                                {/* Encabezado toggle */}
                                <button
                                    onClick={() => perfilAsignando ? setPerfilAsignando(false) : abrirAsignacion()}
                                    style={{ width:'100%', background:'none', border:'none', cursor:'pointer', padding:'0.75rem 1rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:8, fontWeight:700, fontSize:'0.875rem', color:'var(--primary)' }}>
                                        <Icon name="plus-circle" size={17} />
                                        Asignar nuevo recorrido a {perfilUsu.nombre.split(' ')[0]}
                                    </div>
                                    <Icon name={perfilAsignando ? 'chevron-up' : 'chevron-down'} size={16} style={{ color:'var(--text-muted)' }} />
                                </button>

                                {/* Contenido expandible */}
                                {perfilAsignando && (
                                    <div style={{ borderTop:'1px solid var(--border)', padding:'0.85rem 1rem', display:'flex', flexDirection:'column', gap:'0.75rem' }}>
                                        {perfilError && (
                                            <div className="alert alert-danger" style={{ fontSize:'0.82rem', padding:'0.5rem 0.85rem' }}>{perfilError}</div>
                                        )}
                                        {/* Buscador */}
                                        <div style={{ position:'relative' }}>
                                            <Icon name="search" size={14} style={{ position:'absolute', left:9, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                                            <input
                                                className="input"
                                                placeholder="Buscar máquina..."
                                                value={perfilBuscar}
                                                onChange={e => setPerfilBuscar(e.target.value)}
                                                style={{ paddingLeft:30, fontSize:'0.84rem', height:34 }}
                                            />
                                        </div>
                                        {/* Lista de máquinas */}
                                        <div style={{ maxHeight:220, overflowY:'auto', display:'flex', flexDirection:'column', gap:'0.35rem', paddingRight:2 }}>
                                            {todasMaquinas.length === 0 ? (
                                                <div style={{ textAlign:'center', padding:'1rem', color:'var(--text-muted)', fontSize:'0.82rem' }}>
                                                    <Icon name="loader" size={18} className="animate-spin" />
                                                </div>
                                            ) : todasMaquinas
                                                .filter(m => {
                                                    const q = perfilBuscar.toLowerCase();
                                                    return !q || m.id?.toLowerCase().includes(q) || m.location?.toLowerCase().includes(q) || m.type?.toLowerCase().includes(q);
                                                })
                                                .map(m => {
                                                    const checked = perfilSelec.has(m.id);
                                                    return (
                                                        <label key={m.id} style={{ display:'flex', alignItems:'center', gap:9, padding:'0.45rem 0.6rem', borderRadius:8, cursor:'pointer', background: checked ? 'var(--primary-light,#eff6ff)' : 'white', border:`1px solid ${checked ? 'var(--primary)' : 'var(--border)'}`, transition:'background 0.15s' }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={() => setPerfilSelec(s => {
                                                                    const n = new Set(s);
                                                                    n.has(m.id) ? n.delete(m.id) : n.add(m.id);
                                                                    return n;
                                                                })}
                                                                style={{ accentColor:'var(--primary)', width:15, height:15, flexShrink:0 }}
                                                            />
                                                            <div style={{ flex:1, minWidth:0 }}>
                                                                <div style={{ fontWeight:600, fontSize:'0.82rem', color: checked ? 'var(--primary)' : 'var(--text)' }}>{m.location || m.id}</div>
                                                                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{m.id}{m.type ? ` · ${m.type}` : ''}</div>
                                                            </div>
                                                            {checked && <Icon name="check" size={14} style={{ color:'var(--primary)', flexShrink:0 }} />}
                                                        </label>
                                                    );
                                                })
                                            }
                                        </div>
                                        {/* Resumen + Botón */}
                                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, paddingTop:4 }}>
                                            <span style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>
                                                {perfilSelec.size > 0
                                                    ? <><strong style={{ color:'var(--primary)' }}>{perfilSelec.size}</strong> máquina{perfilSelec.size !== 1 ? 's' : ''} seleccionada{perfilSelec.size !== 1 ? 's' : ''}</>
                                                    : 'Seleccioná las máquinas a asignar'}
                                            </span>
                                            <div style={{ display:'flex', gap:6 }}>
                                                <button className="btn btn-secondary" style={{ fontSize:'0.8rem', padding:'0.35rem 0.75rem' }} onClick={() => setPerfilAsignando(false)}>Cancelar</button>
                                                <button className="btn btn-primary" style={{ fontSize:'0.8rem', padding:'0.35rem 0.85rem', display:'flex', alignItems:'center', gap:5 }}
                                                    disabled={perfilSelec.size === 0 || perfilCreating}
                                                    onClick={crearRecorridoPerfil}>
                                                    {perfilCreating ? <><Icon name="loader" size={14} className="animate-spin" /> Asignando...</> : <><Icon name="send" size={14} /> Asignar recorrido</>}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ── Historial de recorridos ── */}
                            <div>
                                <div style={{ fontSize:'0.65rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'1.4px', marginBottom:'0.6rem' }}>
                                    Historial de recorridos
                                </div>
                                {perfilLoading ? (
                                    <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>
                                        <Icon name="loader" size={26} className="animate-spin" />
                                    </div>
                                ) : perfilRuns.length === 0 ? (
                                    <div style={{ textAlign:'center', padding:'1.5rem', color:'var(--text-muted)', background:'var(--bg-color)', borderRadius:10, border:'1px dashed var(--border)', fontSize:'0.82rem' }}>
                                        Sin recorridos registrados.
                                    </div>
                                ) : (
                                    <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                        {perfilRuns.map(run => {
                                            const STATUS = {
                                                pending:   { label:'Pendiente',  color:'#ea580c', bg:'#fff7ed', border:'#fdba74', icon:'clock' },
                                                active:    { label:'En curso',   color:'var(--primary)', bg:'#eef2ff', border:'#a5b4fc', icon:'play-circle' },
                                                completed: { label:'Completado', color:'var(--success)', bg:'#f0fdf4', border:'#86efac', icon:'check-circle' },
                                                cancelled: { label:'Cancelado',  color:'#6b7280', bg:'#f9fafb', border:'#d1d5db', icon:'x-circle' },
                                            };
                                            const st = STATUS[run.status] || STATUS.cancelled;
                                            const fecha = run.startedAt
                                                ? new Date(run.startedAt).toLocaleDateString('es-PY', { day:'2-digit', month:'short', year:'numeric' })
                                                : '—';
                                            const done  = (run.stops ?? []).filter(s => s.status === 'done').length;
                                            const total = run.stops?.length ?? 0;

                                            return (
                                                <div key={run.id} style={{ background:'var(--bg-color)', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                                                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'0.65rem 0.9rem' }}>
                                                        <div style={{ width:32, height:32, borderRadius:'50%', background:st.bg, border:`1.5px solid ${st.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                                            <Icon name={st.icon} size={15} style={{ color:st.color }} />
                                                        </div>
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                                                                <span style={{ fontWeight:700, fontSize:'0.85rem' }}>Recorrido #{run.id}</span>
                                                                <span style={{ fontSize:'0.63rem', fontWeight:700, background:st.bg, color:st.color, border:`1px solid ${st.border}`, borderRadius:999, padding:'1px 7px' }}>{st.label}</span>
                                                            </div>
                                                            <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:1 }}>
                                                                {fecha}
                                                                {run.duration != null && <span> · <Icon name="clock" size={10} style={{ display:'inline', verticalAlign:'middle' }} /> {fmtDuration(run.duration)}</span>}
                                                                {' · '}{done}/{total} paradas
                                                                {run.failedCount > 0 && <span style={{ color:'var(--danger)' }}> · {run.failedCount} saltadas</span>}
                                                            </div>
                                                        </div>
                                                        {run.totalRecaudado > 0 && (
                                                            <div style={{ textAlign:'right', flexShrink:0 }}>
                                                                <div style={{ fontSize:'0.68rem', color:'var(--text-muted)' }}>Recaudado</div>
                                                                <div style={{ fontWeight:800, fontSize:'0.85rem', color:'var(--success)' }}>Gs. {Math.round(run.totalRecaudado).toLocaleString('es-PY')}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {total > 0 && run.status !== 'pending' && (
                                                        <div style={{ padding:'0 0.9rem 0.5rem' }}>
                                                            <div style={{ height:4, borderRadius:99, background:'var(--border)', overflow:'hidden' }}>
                                                                <div style={{ height:'100%', width:`${(done/total)*100}%`, background: done === total ? '#16a34a' : '#4f46e5', borderRadius:99, transition:'width 0.4s' }} />
                                                            </div>
                                                        </div>
                                                    )}
                                                    {total > 0 && (
                                                        <div style={{ borderTop:'1px solid var(--border)', padding:'0.4rem 0.9rem', display:'flex', flexWrap:'wrap', gap:'0.3rem' }}>
                                                            {(run.stops ?? []).map((s, i) => {
                                                                const dot = s.status === 'done' ? '#16a34a' : s.status === 'failed' ? '#ef4444' : '#9ca3af';
                                                                const hora = s.visitedAt
                                                                    ? new Date(s.visitedAt).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit' })
                                                                    : null;
                                                                return (
                                                                    <span key={s.id}
                                                                        title={`${s.location ?? s.machineId}${hora ? ' — ' + hora : ''}`}
                                                                        style={{ display:'flex', alignItems:'center', gap:4, fontSize:'0.68rem', background:'var(--surface)', border:`1px solid ${s.status === 'done' ? '#bbf7d0' : s.status === 'failed' ? '#fecaca' : 'var(--border)'}`, borderRadius:6, padding:'2px 6px' }}>
                                                                        <span style={{ width:6, height:6, borderRadius:'50%', background:dot, flexShrink:0, display:'inline-block' }} />
                                                                        {i+1}. {s.location ?? s.machineId}
                                                                        {hora && <span style={{ color:'var(--text-muted)', fontSize:'0.6rem' }}>{hora}</span>}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Pie */}
                        <div style={{ padding:'0.85rem 1.25rem', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => { setPerfilUsu(null); setPerfilAsignando(false); }}>Cerrar</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

// ─── SolicitudesPage ──────────────────────────────────────────────────────────
function SolicitudesPage({ onIrProducto }) {
    const [solicitudes, setSolicitudes]   = useState([]);
    const [loading, setLoading]           = useState(true);
    const [filtro, setFiltro]             = useState('todas'); // 'todas' | 'pendientes'
    const [busqueda, setBusqueda]         = useState('');

    const cargar = async () => {
        setLoading(true);
        try {
            const rows = await getSolicitudes();
            setSolicitudes(Array.isArray(rows) ? rows : []);
        } catch { setSolicitudes([]); }
        finally { setLoading(false); }
    };

    useEffect(() => { cargar(); }, []);

    const marcarLeida = async (id) => {
        try {
            await marcarSolicitudLeida(id);
            setSolicitudes(prev => prev.map(s => s.id === id ? { ...s, leida: 1 } : s));
        } catch (e) { alert(e.message || 'Error'); }
    };

    const marcarTodas = async () => {
        try {
            await marcarTodasLeidas();
            setSolicitudes(prev => prev.map(s => ({ ...s, leida: 1 })));
        } catch (e) { alert(e.message || 'Error'); }
    };

    const eliminar = async (id) => {
        if (!confirm('¿Descartar esta solicitud?')) return;
        try {
            await deleteSolicitud(id);
            setSolicitudes(prev => prev.filter(s => s.id !== id));
        } catch (e) { alert(e.message || 'Error'); }
    };

    const filtradas = solicitudes.filter(s => {
        if (filtro === 'pendientes' && s.leida) return false;
        if (busqueda.trim()) {
            const q = busqueda.toLowerCase();
            return s.item_nombre?.toLowerCase().includes(q) || s.usu_nombre?.toLowerCase().includes(q) || s.mensaje?.toLowerCase().includes(q);
        }
        return true;
    });

    const pendientesCount = solicitudes.filter(s => !s.leida).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Header KPIs */}
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="card stat-card">
                    <div className="stat-icon" style={{ background: '#fef2f2' }}><Icon name="inbox" size={20} style={{ color: '#ef4444' }} /></div>
                    <div><div className="text-sm text-muted">Sin leer</div><div className="text-2xl font-bold" style={{ color: pendientesCount > 0 ? '#ef4444' : 'inherit' }}>{pendientesCount}</div></div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-primary-light"><Icon name="package" size={20} /></div>
                    <div><div className="text-sm text-muted">Total</div><div className="text-2xl font-bold">{solicitudes.length}</div></div>
                </div>
                <div className="card stat-card">
                    <div className="stat-icon bg-success-light"><Icon name="check-circle" size={20} /></div>
                    <div><div className="text-sm text-muted">Atendidas</div><div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>{solicitudes.filter(s => s.leida).length}</div></div>
                </div>
            </div>

            {/* Controles */}
            <div className="card" style={{ padding: '0.85rem 1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                    className="input"
                    style={{ flex: 1, minWidth: 200, maxWidth: 320 }}
                    placeholder="Buscar por producto, usuario o mensaje..."
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                    {[['todas','Todas'], ['pendientes','Sin leer']].map(([val, lbl]) => (
                        <button key={val} onClick={() => setFiltro(val)}
                            className={`btn ${filtro === val ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}>
                            {lbl}{val === 'pendientes' && pendientesCount > 0 && <span style={{ marginLeft: 5, background: '#ef4444', color: 'white', borderRadius: 999, fontSize: '0.65rem', padding: '1px 6px', fontWeight: 800 }}>{pendientesCount}</span>}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
                    {pendientesCount > 0 && (
                        <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={marcarTodas}>
                            <Icon name="check-check" size={14} /> Marcar todas leídas
                        </button>
                    )}
                    <button className="btn btn-secondary" style={{ fontSize: '0.78rem' }} onClick={cargar} disabled={loading}>
                        <Icon name="refresh-cw" size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refrescar
                    </button>
                </div>
            </div>

            {/* Lista */}
            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                        {loading ? 'Cargando...' : `${filtradas.length} solicitud${filtradas.length !== 1 ? 'es' : ''}`}
                    </span>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando...</div>
                ) : filtradas.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                        <Icon name="check-circle" size={40} style={{ color: 'var(--success)', opacity: 0.5 }} />
                        <div style={{ fontWeight: 700 }}>{filtro === 'pendientes' ? 'Todo al día — sin solicitudes sin leer' : 'Sin solicitudes'}</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {filtradas.map((s, i) => (
                            <div key={s.id} style={{
                                display: 'flex', alignItems: 'flex-start', gap: '1rem',
                                padding: '1rem 1.25rem',
                                borderBottom: i < filtradas.length - 1 ? '1px solid var(--border)' : 'none',
                                background: !s.leida ? 'rgba(239,68,68,0.04)' : 'transparent',
                                transition: 'background 0.15s',
                            }}>
                                {/* Icono */}
                                <div style={{ width: 40, height: 40, borderRadius: '50%', background: !s.leida ? '#fef2f2' : 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    <Icon name="package" size={18} style={{ color: !s.leida ? '#ef4444' : '#94a3b8' }} />
                                </div>
                                {/* Contenido */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: 2, flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.item_nombre}</span>
                                        {!s.leida && <span style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: 999, fontSize: '0.65rem', fontWeight: 800, padding: '1px 7px' }}>Nueva</span>}
                                    </div>
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: s.mensaje ? 6 : 0 }}>
                                        Solicitado por <strong>{s.usu_nombre}</strong> &middot; {new Date(s.created_at).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                    {s.mensaje && (
                                        <div style={{ fontSize: '0.82rem', background: 'var(--bg-secondary)', borderRadius: 6, padding: '0.35rem 0.6rem', marginBottom: 8, fontStyle: 'italic', borderLeft: '3px solid var(--border)', color: 'var(--text-color)' }}>
                                            "{s.mensaje}"
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: 4 }}>
                                        <button className="btn btn-primary" style={{ fontSize: '0.72rem', padding: '0.25rem 0.65rem', gap: 4 }}
                                            onClick={() => { onIrProducto?.(s.item_nombre); if (!s.leida) marcarLeida(s.id); }}>
                                            <Icon name="package" size={12} /> Ver producto
                                        </button>
                                        {!s.leida && (
                                            <button className="btn btn-secondary" style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                                                onClick={() => marcarLeida(s.id)}>
                                                <Icon name="check" size={12} /> Marcar leída
                                            </button>
                                        )}
                                        <button className="btn" style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem', background: 'transparent', color: 'var(--danger)', border: '1px solid #fca5a5' }}
                                            onClick={() => eliminar(s.id)}>
                                            <Icon name="trash-2" size={12} /> Descartar
                                        </button>
                                    </div>
                                </div>
                                {/* Indicador no leída */}
                                {!s.leida && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0, marginTop: 6 }} />}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── AuditPage ────────────────────────────────────────────────────────────────
function AuditPage() {
    const [rows, setRows]       = useState([]);
    const [total, setTotal]     = useState(0);
    const [page, setPage]       = useState(1);
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState('');
    const [filterAccion, setFilterAccion] = useState('');
    const [filterUsuId, setFilterUsuId]   = useState('');
    const [filterFrom,  setFilterFrom]    = useState('');
    const [filterTo,    setFilterTo]      = useState('');
    const [usuarios, setUsuarios] = useState([]);
    const LIMIT = 50;

    useEffect(() => { getUsuarios().then(u => setUsuarios(u)).catch(() => {}); }, []);

    const load = useCallback(async (p = 1) => {
        setLoading(true);
        setError('');
        try {
            const params = { page: p, limit: LIMIT };
            if (filterAccion) params.accion = filterAccion;
            if (filterUsuId)  params.usuId  = filterUsuId;
            if (filterFrom)   params.from   = filterFrom;
            if (filterTo)     params.to     = filterTo;
            const data = await getAuditLog(params);
            setRows(data.data ?? []);
            setTotal(data.total ?? 0);
            setPage(p);
        } catch (e) {
            setError(e.message || 'Error al cargar el registro de auditoría');
        } finally {
            setLoading(false);
        }
    }, [filterAccion, filterUsuId, filterFrom, filterTo]);

    useEffect(() => { load(1); }, [load]);

    const totalPages = Math.ceil(total / LIMIT);

    const ACCION_LABELS = {
        'auth.login':                'Inicio de sesión',
        'auth.login_failed':         'Login fallido',
        'auth.change_password':      'Cambio de contraseña',
        'record.create':             'Recaudación registrada',
        'caja.movimiento':           'Movimiento de caja',
        'caja.movimiento_delete':    'Movimiento eliminado',
        'caja.cierre_delete':        'Cierre de caja reabierto',
        'cliente.create':            'Cliente creado',
        'cliente.update':            'Cliente editado',
        'cliente.delete':            'Cliente eliminado',
        'usuario.create':            'Usuario creado',
        'usuario.update':            'Usuario editado',
        'usuario.delete':            'Usuario eliminado',
        'route_run.create':          'Recorrido creado',
        'route_run.status':          'Estado de recorrido',
    };

    const ACCION_COLOR = {
        'auth.login':                '#4f46e5',
        'auth.login_failed':         '#dc2626',
        'auth.change_password':      '#7c3aed',
        'record.create':             '#059669',
        'caja.movimiento':           '#0891b2',
        'caja.movimiento_delete':    '#dc2626',
        'caja.cierre_delete':        '#d97706',
        'cliente.create':            '#16a34a',
        'cliente.update':            '#d97706',
        'cliente.delete':            '#dc2626',
        'usuario.create':            '#16a34a',
        'usuario.update':            '#d97706',
        'usuario.delete':            '#dc2626',
        'route_run.create':          '#0891b2',
        'route_run.status':          '#7c3aed',
    };

    const ACCION_OPTIONS = Object.keys(ACCION_LABELS);

    function fmtTs(ts) {
        if (!ts) return '—';
        return ts.replace('T', ' ').slice(0, 19);
    }

    function fmtDetalle(d) {
        if (!d) return '—';
        try {
            const obj = typeof d === 'string' ? JSON.parse(d) : d;
            return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(' · ');
        } catch { return String(d); }
    }

    return (
        <div className="animate-fade-in">
            <div className="card mb-4" style={{ padding: '1rem 1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div>
                        <label className="text-xs text-muted font-semibold" style={{ display: 'block', marginBottom: 4 }}>Acción</label>
                        <select
                            value={filterAccion}
                            onChange={e => setFilterAccion(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.82rem', minWidth: 200 }}>
                            <option value="">Todas las acciones</option>
                            {ACCION_OPTIONS.map(a => (
                                <option key={a} value={a}>{ACCION_LABELS[a] || a}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted font-semibold" style={{ display: 'block', marginBottom: 4 }}>Usuario</label>
                        <select
                            value={filterUsuId}
                            onChange={e => setFilterUsuId(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.82rem', minWidth: 160 }}>
                            <option value="">Todos los usuarios</option>
                            {usuarios.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre || u.user}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="text-xs text-muted font-semibold" style={{ display: 'block', marginBottom: 4 }}>Desde</label>
                        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.82rem' }} />
                    </div>
                    <div>
                        <label className="text-xs text-muted font-semibold" style={{ display: 'block', marginBottom: 4 }}>Hasta</label>
                        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', fontSize: '0.82rem' }} />
                    </div>
                    <button
                        onClick={() => load(1)}
                        disabled={loading}
                        style={{ padding: '0.4rem 1rem', borderRadius: 6, background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem', alignSelf: 'flex-end' }}>
                        {loading ? 'Buscando…' : 'Buscar'}
                    </button>
                    {(filterAccion || filterUsuId || filterFrom || filterTo) && (
                        <button
                            onClick={() => { setFilterAccion(''); setFilterUsuId(''); setFilterFrom(''); setFilterTo(''); }}
                            style={{ padding: '0.4rem 0.75rem', borderRadius: 6, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', cursor: 'pointer', fontSize: '0.82rem', alignSelf: 'flex-end' }}>
                            Limpiar filtros
                        </button>
                    )}
                    <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'flex-end' }}>
                        {total} registros
                    </div>
                </div>
            </div>

            {error && (
                <div style={{ background: '#fef2f2', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: '1rem', fontSize: '0.875rem' }}>
                    {error}
                </div>
            )}

            <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-color, #f9fafb)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Fecha / Hora</th>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Usuario</th>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Acción</th>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Entidad</th>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Detalle</th>
                                <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>Result</th>
                            <th style={{ padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando…</td></tr>
                            )}
                            {!loading && rows.length === 0 && (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No hay registros</td></tr>
                            )}
                            {!loading && rows.map((r, i) => (
                                <tr key={r.id ?? i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-color, #f9fafb)' }}>
                                    <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                        {fmtTs(r.timestamp)}
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
                                        <span style={{ fontWeight: 600 }}>{r.usu_nombre || r.usu_user || '—'}</span>
                                        {r.usu_nombre && r.usu_user && (
                                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginLeft: 4 }}>({r.usu_user})</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.2rem 0.5rem',
                                            borderRadius: 4,
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: (ACCION_COLOR[r.accion] ?? '#6b7280') + '18',
                                            color: ACCION_COLOR[r.accion] ?? '#6b7280',
                                        }}>
                                            {ACCION_LABELS[r.accion] || r.accion}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                        {r.entidad ? `${r.entidad}${r.entidad_id ? ` #${r.entidad_id}` : ''}` : '—'}
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem', color: 'var(--text-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        title={typeof r.detalle === 'string' ? r.detalle : JSON.stringify(r.detalle)}>
                                        {fmtDetalle(r.detalle)}
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
                                        <span style={{
                                            display: 'inline-block', padding: '0.15rem 0.4rem',
                                            borderRadius: 4, fontSize: '0.72rem', fontWeight: 700,
                                            background: r.resultado === 'error' ? '#fef2f2' : '#f0fdf4',
                                            color: r.resultado === 'error' ? '#dc2626' : '#16a34a',
                                        }}>
                                            {r.resultado === 'error' ? '✕ error' : '✓ ok'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.55rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                        {r.ip || '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {totalPages > 1 && (
                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            Página {page} de {totalPages} · {total} registros
                        </span>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                                disabled={page <= 1 || loading}
                                onClick={() => load(page - 1)}
                                style={{ padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: page <= 1 ? '#f3f4f6' : 'white', cursor: page <= 1 ? 'default' : 'pointer', fontSize: '0.8rem' }}>
                                ← Anterior
                            </button>
                            {[...Array(Math.min(totalPages, 7))].map((_, idx) => {
                                const pg = idx + 1;
                                return (
                                    <button key={pg} onClick={() => load(pg)} disabled={loading}
                                        style={{ padding: '0.3rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: pg === page ? 'var(--primary)' : 'white', color: pg === page ? 'white' : 'inherit', cursor: 'pointer', fontSize: '0.8rem', fontWeight: pg === page ? 700 : 400 }}>
                                        {pg}
                                    </button>
                                );
                            })}
                            <button
                                disabled={page >= totalPages || loading}
                                onClick={() => load(page + 1)}
                                style={{ padding: '0.3rem 0.7rem', borderRadius: 6, border: '1px solid var(--border)', background: page >= totalPages ? '#f3f4f6' : 'white', cursor: page >= totalPages ? 'default' : 'pointer', fontSize: '0.8rem' }}>
                                Siguiente →
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── SesionesPage ─────────────────────────────────────────────────────────────
const SesionesPage = ({ userRol = 'caja' }) => {
    const [sesiones, setSesiones] = useState([]);
    const [loading, setLoading]   = useState(true);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo]     = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterUsuId, setFilterUsuId] = useState('');
    const [usuarios, setUsuarios] = useState([]);
    const [expandedId, setExpandedId] = useState(null);
    const [movimientos, setMovimientos] = useState({});
    const [loadingMov, setLoadingMov]   = useState(null);
    const [exporting, setExporting]     = useState(false);
    const esSupervisor = ['admin','superadmin'].includes(userRol);

    const handleExport = async () => {
        setExporting(true);
        try {
            const sparams = { from: filterFrom || undefined, to: filterTo || undefined };
            if (filterUsuId === 'todos') { /* sin filtro */ }
            else if (filterUsuId)        { sparams.usuId = filterUsuId; }
            else                         { sparams.own = true; }
            await exportCajaSesiones(sparams);
        } catch(e) { alert('Error al exportar: ' + e.message); }
        finally { setExporting(false); }
    };

    // Cargar lista de cajeros (incluye terreno+caja) para el filtro (solo admin/superadmin)
    useEffect(() => {
        if (esSupervisor) {
            getUsuarios().then(us => setUsuarios((us || []).filter(u =>
                ['caja','admin','superadmin'].includes(u.rol) ||
                (u.rol === 'terreno' && u.tiene_caja)
            ))).catch(() => {});
        }
    }, [esSupervisor]); // eslint-disable-line react-hooks/exhaustive-deps

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // filterUsuId === ''      → propias (own:true) — default para TODOS
            // filterUsuId === 'todos' → admin ve todas las sesiones
            // filterUsuId === '15'    → admin ve sesiones de ese cajero
            const sparams = { from: filterFrom || undefined, to: filterTo || undefined, status: filterStatus || undefined };
            if (filterUsuId === 'todos') { /* sin filtro de usuario */ }
            else if (filterUsuId)        { sparams.usuId = filterUsuId; }
            else                         { sparams.own = true; }
            const rows = await getSesiones(sparams);
            setSesiones(Array.isArray(rows) ? rows : []);
        } catch(e) { setSesiones([]); }
        finally { setLoading(false); }
    }, [filterFrom, filterTo, filterStatus, filterUsuId]);

    useEffect(() => { load(); }, [load]);

    const toggleExpand = async (sesion) => {
        const id = sesion.cierre_id;
        if (expandedId === id) { setExpandedId(null); return; }
        setExpandedId(id);
        if (!movimientos[id]) {
            setLoadingMov(id);
            try {
                const rows = await getSesionMovimientos(id);
                setMovimientos(prev => ({ ...prev, [id]: rows }));
            } catch(e) { setMovimientos(prev => ({ ...prev, [id]: [] })); }
            finally { setLoadingMov(null); }
        }
    };

    const fmt = (ts) => {
        if (!ts) return '—';
        return new Date(ts).toLocaleString('es-PY', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    };
    const fmtMoney = (n) => `Gs. ${Number(n || 0).toLocaleString('es-PY')}`;
    const sesionRef = (s) => `CAJA/${String(s.cierre_id).padStart(5,'0')}`;
    const METODO_LABEL = { efectivo:'Efectivo', tarjeta:'Tarjeta', transferencia:'Transferencia', mixto:'Dividido' };

    return (
        <div className="animate-fade-in">
            {/* Header + filtros */}
            <div className="card" style={{ padding:'1rem 1.25rem', marginBottom:'1rem' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
                    <div style={{ flex:1, minWidth:200 }}>
                        <div style={{ fontWeight:800, fontSize:'1.05rem', marginBottom:2 }}>Sesiones de Caja</div>
                        <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{sesiones.length} sesion{sesiones.length !== 1 ? 'es' : ''} encontrada{sesiones.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ display:'flex', gap:'0.5rem', alignItems:'center', flexWrap:'wrap' }}>
                        <input type="date" className="input" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ width:140, fontSize:'0.82rem' }} placeholder="Desde" />
                        <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>—</span>
                        <input type="date" className="input" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ width:140, fontSize:'0.82rem' }} placeholder="Hasta" />
                        <select className="input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ width:140, fontSize:'0.82rem' }}>
                            <option value="">Todos los estados</option>
                            <option value="abierta">En proceso</option>
                            <option value="cerrada">Cerrada</option>
                        </select>
                        {esSupervisor && usuarios.length > 0 && (
                            <select className="input" value={filterUsuId} onChange={e => setFilterUsuId(e.target.value)} style={{ width:175, fontSize:'0.82rem' }}>
                                <option value="">Mi sesión</option>
                                <option value="todos">Todos los cajeros</option>
                                {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                            </select>
                        )}
                        {(filterFrom || filterTo || filterStatus || filterUsuId) && (
                            <button className="btn btn-secondary" style={{ fontSize:'0.82rem' }} onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterStatus(''); setFilterUsuId(''); }}>
                                <Icon name="x" size={13} /> Limpiar
                            </button>
                        )}
                        <button
                            className="btn btn-secondary"
                            style={{ fontSize:'0.82rem', display:'flex', alignItems:'center', gap:5 }}
                            onClick={handleExport}
                            disabled={exporting || sesiones.length === 0}
                            title="Exportar sesiones visibles a CSV"
                        >
                            {exporting
                                ? <><Icon name="loader" size={13} className="animate-spin" /> Exportando…</>
                                : <><Icon name="download" size={13} /> CSV</>
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabla */}
            <div className="card" style={{ overflow:'hidden' }}>
                {/* Cabecera de la tabla */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1.3fr 1.1fr 1.1fr 1fr 1fr 1fr 1fr 0.85fr', gap:'0.5rem', padding:'0.65rem 1rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    <div>ID Sesion</div>
                    <div>Abierta por</div>
                    <div>Apertura</div>
                    <div>Cierre</div>
                    <div style={{ textAlign:'right' }}>Saldo inicial</div>
                    <div style={{ textAlign:'right' }}>Ingresos</div>
                    <div style={{ textAlign:'right' }}>Egresos</div>
                    <div style={{ textAlign:'right' }}>Balance</div>
                    <div style={{ textAlign:'center' }}>Estado</div>
                </div>

                {loading ? (
                    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>Cargando sesiones...</div>
                ) : sesiones.length === 0 ? (
                    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>
                        <Icon name="calendar-off" size={36} style={{ marginBottom:'0.5rem' }} />
                        <div style={{ fontWeight:700 }}>No hay sesiones en el periodo seleccionado</div>
                    </div>
                ) : sesiones.map((s, idx) => {
                    const isOpen = s.cierre_status === 'abierta';
                    const expanded = expandedId === s.cierre_id;
                    const movsDia  = movimientos[s.cierre_id];
                    return (
                        <React.Fragment key={s.cierre_id}>
                            {/* Fila principal */}
                            <div
                                onClick={() => toggleExpand(s)}
                                style={{
                                    display:'grid', gridTemplateColumns:'1fr 1.3fr 1.1fr 1.1fr 1fr 1fr 1fr 1fr 0.85fr',
                                    gap:'0.5rem', padding:'0.75rem 1rem', cursor:'pointer',
                                    borderBottom: expanded ? '2px solid var(--primary)' : idx < sesiones.length-1 ? '1px solid var(--border)' : 'none',
                                    background: expanded ? 'rgba(var(--primary-rgb, 59,130,246),0.05)' : 'transparent',
                                    transition:'background 0.15s',
                                    alignItems:'center',
                                }}
                                onMouseEnter={e => { if (!expanded) e.currentTarget.style.background='var(--bg-secondary)'; }}
                                onMouseLeave={e => { if (!expanded) e.currentTarget.style.background='transparent'; }}
                            >
                                {/* ID */}
                                <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                    <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                    <span style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--primary)', fontFamily:'monospace' }}>{sesionRef(s)}</span>
                                </div>
                                {/* Abierta por */}
                                <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                    <div style={{ width:24, height:24, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.7rem', fontWeight:800, flexShrink:0 }}>
                                        {(s.apertura_usu_nombre || 'S')[0].toUpperCase()}
                                    </div>
                                    <span style={{ fontSize:'0.82rem', fontWeight:600 }}>{s.apertura_usu_nombre || '—'}</span>
                                </div>
                                {/* Apertura */}
                                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{fmt(s.apertura_timestamp)}</div>
                                {/* Cierre */}
                                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{fmt(s.cierre_timestamp)}</div>
                                {/* Saldo inicial */}
                                <div style={{ textAlign:'right', fontSize:'0.82rem', fontWeight:600 }}>{fmtMoney(s.apertura_efectivo)}</div>
                                {/* Ingresos */}
                                <div style={{ textAlign:'right', fontSize:'0.82rem', color:'var(--success)', fontWeight:600 }}>{fmtMoney(s.cierre_ingresos)}</div>
                                {/* Egresos */}
                                <div style={{ textAlign:'right', fontSize:'0.82rem', color:'#dc2626', fontWeight:600 }}>{fmtMoney(s.cierre_egresos)}</div>
                                {/* Balance */}
                                <div style={{ textAlign:'right', fontSize:'0.82rem', fontWeight:800, color: (s.cierre_balance||0) >= 0 ? '#16a34a' : '#dc2626' }}>{fmtMoney(s.cierre_balance)}</div>
                                {/* Estado */}
                                <div style={{ textAlign:'center' }}>
                                    <span style={{ fontSize:'0.72rem', fontWeight:800, borderRadius:999, padding:'3px 10px', background: isOpen ? '#dcfce7' : '#f1f5f9', color: isOpen ? '#166534' : '#475569' }}>
                                        {isOpen ? 'En proceso' : 'Cerrada'}
                                    </span>
                                </div>
                            </div>

                            {/* Detalle expandido */}
                            {expanded && (
                                <div style={{ background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', padding:'1rem 1.5rem' }}>
                                    {/* Resumen global + ruta vinculada */}
                                    <div style={{ display:'flex', gap:'1rem', flexWrap:'wrap', marginBottom:'1rem' }}>
                                        {[
                                            { label:'Saldo inicial', val: fmtMoney(s.apertura_efectivo), color:'#64748b' },
                                            { label:'Ingresos', val: fmtMoney(s.cierre_ingresos), color:'var(--success)' },
                                            { label:'Egresos', val: fmtMoney(s.cierre_egresos), color:'#dc2626' },
                                            { label:'Reembolsos', val: fmtMoney(s.cierre_reembolsos), color:'var(--warning)' },
                                            { label:'Balance', val: fmtMoney(s.cierre_balance), color:(s.cierre_balance||0)>=0?'#16a34a':'#dc2626' },
                                        ].map(kpi => (
                                            <div key={kpi.label} style={{ background:'var(--bg-color)', borderRadius:8, padding:'0.5rem 1rem', border:'1px solid var(--border)', minWidth:110 }}>
                                                <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontWeight:700, marginBottom:2 }}>{kpi.label}</div>
                                                <div style={{ fontSize:'0.88rem', fontWeight:800, color:kpi.color }}>{kpi.val}</div>
                                            </div>
                                        ))}
                                        {s.route_run_id && (
                                            <div style={{ background:'var(--primary-light)', border:'1px solid var(--primary)', borderRadius:8, padding:'0.5rem 1rem', minWidth:110 }}>
                                                <div style={{ fontSize:'0.68rem', color:'#1e40af', fontWeight:700, marginBottom:2 }}>Ruta vinculada</div>
                                                <div style={{ fontSize:'0.88rem', fontWeight:800, color:'#1e40af' }}>#{s.route_run_id}</div>
                                            </div>
                                        )}
                                        {s.cierre_notas && (
                                            <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:8, padding:'0.5rem 1rem', flex:1, minWidth:160 }}>
                                                <div style={{ fontSize:'0.68rem', color:'var(--warning)', fontWeight:700, marginBottom:2 }}>Notas</div>
                                                <div style={{ fontSize:'0.82rem', color:'#78350f' }}>{s.cierre_notas}</div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Desglose por medio de pago */}
                                    {s.cierre_status === 'cerrada' && (s.ing_efectivo || s.ing_tarjeta || s.ing_transferencia) ? (
                                        <div style={{ marginBottom:'1rem' }}>
                                            <div style={{ fontSize:'0.72rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.5rem' }}>
                                                Cuadre por medio de pago
                                            </div>
                                            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:'0.6rem' }}>
                                                {[
                                                    { label:'Efectivo', icon:'💵', ing: s.ing_efectivo||0, egr: s.egr_efectivo||0, color:'var(--success)', bg:'#f0fdf4', border:'#bbf7d0' },
                                                    { label:'Tarjeta', icon:'💳', ing: s.ing_tarjeta||0, egr: s.egr_tarjeta||0, color:'var(--primary)', bg:'#eef2ff', border:'#c7d2fe' },
                                                    { label:'Transferencia', icon:'🏦', ing: s.ing_transferencia||0, egr: s.egr_transferencia||0, color:'#0891b2', bg:'#ecfeff', border:'#a5f3fc' },
                                                ].filter(m => m.ing > 0 || m.egr > 0).map(m => (
                                                    <div key={m.label} style={{ background:m.bg, border:`1.5px solid ${m.border}`, borderRadius:10, padding:'0.65rem 0.85rem' }}>
                                                        <div style={{ fontWeight:800, fontSize:'0.82rem', color:m.color, marginBottom:'0.35rem' }}>{m.icon} {m.label}</div>
                                                        {m.ing > 0 && <div style={{ fontSize:'0.75rem', color:'#64748b' }}>▸ Ingresos: <strong style={{ color:'var(--success)' }}>{fmtMoney(m.ing)}</strong></div>}
                                                        {m.egr > 0 && <div style={{ fontSize:'0.75rem', color:'#64748b' }}>▸ Egresos: <strong style={{ color:'#dc2626' }}>−{fmtMoney(m.egr)}</strong></div>}
                                                        <div style={{ fontSize:'0.82rem', fontWeight:800, color:m.color, marginTop:'0.35rem', borderTop:`1px solid ${m.border}`, paddingTop:'0.3rem' }}>
                                                            Neto: {fmtMoney(m.ing - m.egr)}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                    {/* Tabla de movimientos */}
                                    <div style={{ fontWeight:700, fontSize:'0.8rem', marginBottom:'0.5rem', color:'var(--text-muted)' }}>
                                        Movimientos de esta sesión ({s.cierre_mov_count} registrados)
                                    </div>
                                    {loadingMov === s.cierre_id ? (
                                        <div style={{ color:'var(--text-muted)', fontSize:'0.82rem', padding:'0.5rem' }}>Cargando...</div>
                                    ) : !movsDia || movsDia.length === 0 ? (
                                        <div style={{ color:'var(--text-muted)', fontSize:'0.82rem', padding:'0.5rem' }}>Sin movimientos registrados.</div>
                                    ) : (
                                        <div style={{ overflowX:'auto' }}>
                                            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8rem' }}>
                                                <thead>
                                                    <tr style={{ background:'var(--bg-color)', borderBottom:'1.5px solid var(--border)' }}>
                                                        {['Hora','Concepto','MQ','Cliente','Método','Monto','Tipo'].map(h => (
                                                            <th key={h} style={{ padding:'0.4rem 0.6rem', textAlign:'left', fontWeight:700, color:'var(--text-muted)', fontSize:'0.7rem', whiteSpace:'nowrap' }}>{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {movsDia.map(m => (
                                                        <tr key={m.mov_id} style={{ borderBottom:'1px solid var(--border)' }}>
                                                            <td style={{ padding:'0.4rem 0.6rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                                                                {new Date(m.mov_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit' })}
                                                            </td>
                                                            <td style={{ padding:'0.4rem 0.6rem', fontWeight:600, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.mov_concepto}</td>
                                                            <td style={{ padding:'0.4rem 0.6rem', color:'var(--primary)', fontSize:'0.75rem', fontWeight:700, fontFamily:'monospace' }}>
                                                                {m.maq_id || '—'}
                                                            </td>
                                                            <td style={{ padding:'0.4rem 0.6rem', color:'var(--text-muted)' }}>{m.cli_nombre_snap || '—'}</td>
                                                            <td style={{ padding:'0.4rem 0.6rem' }}>
                                                                <span style={{ fontSize:'0.7rem', fontWeight:700, borderRadius:999, padding:'2px 8px', background:'#f1f5f9', color:'#475569' }}>{METODO_LABEL[m.mov_metodo_pago]||m.mov_metodo_pago}</span>
                                                            </td>
                                                            <td style={{ padding:'0.4rem 0.6rem', fontWeight:700, textAlign:'right', color: m.mov_es_reembolso ? '#d97706' : m.mov_tipo==='ingreso' ? '#16a34a' : '#dc2626', whiteSpace:'nowrap' }}>
                                                                {m.mov_es_reembolso ? '-' : m.mov_tipo==='egreso' ? '-' : '+'} Gs. {Number(m.mov_monto).toLocaleString('es-PY')}
                                                            </td>
                                                            <td style={{ padding:'0.4rem 0.6rem' }}>
                                                                <span style={{ fontSize:'0.68rem', fontWeight:800, borderRadius:999, padding:'2px 8px', background: m.mov_es_reembolso?'#fef3c7': m.mov_tipo==='ingreso'?'#dcfce7':'#fef2f2', color: m.mov_es_reembolso?'#92400e': m.mov_tipo==='ingreso'?'#166534':'#991b1b' }}>
                                                                    {m.mov_es_reembolso ? 'Reembolso' : m.mov_tipo==='ingreso' ? 'Ingreso' : 'Egreso'}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

// ─── PedidosPage ───────────────────────────────────────────────────────────────
const PedidosPage = ({ userRol = 'caja' }) => {
    const [pedidos, setPedidos]   = useState([]);
    const [loading, setLoading]   = useState(true);
    const [filterFrom, setFilterFrom] = useState('');
    const [filterTo, setFilterTo]     = useState('');
    const [filterTipo, setFilterTipo] = useState('');
    const [buscar, setBuscar]         = useState('');
    const [expandedId, setExpandedId] = useState(null);
    const [usuarios, setUsuarios]     = useState([]);
    const [filtroUsu, setFiltroUsu]   = useState('');
    const esSupervisor = ['admin','superadmin'].includes(userRol);

    // Solo admin/superadmin cargan la lista de usuarios para filtrar
    useEffect(() => {
        if (esSupervisor) {
            getUsuarios().then(u => setUsuarios(Array.isArray(u) ? u : [])).catch(() => {});
        }
    }, [esSupervisor]); // eslint-disable-line react-hooks/exhaustive-deps

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // filtroUsu === ''      → propios (own:true) — default para TODOS
            // filtroUsu === 'todos' → admin ve todos los pedidos
            // filtroUsu === '15'    → admin ve pedidos de ese cajero
            const pparams = { from: filterFrom || undefined, to: filterTo || undefined, tipo: filterTipo || undefined };
            if (filtroUsu === 'todos') { /* sin filtro de usuario */ }
            else if (filtroUsu)        { pparams.usuId = filtroUsu; }
            else                       { pparams.own = true; }
            const rows = await getPedidos(pparams);
            setPedidos(Array.isArray(rows) ? rows : []);
        } catch(e) { setPedidos([]); }
        finally { setLoading(false); }
    }, [filterFrom, filterTo, filterTipo, filtroUsu]);

    useEffect(() => { load(); }, [load]);

    const q = buscar.toLowerCase().trim();
    const pedidosFiltrados = pedidos.filter(p => {
        if (!q) return true;
        return (p.mov_concepto||'').toLowerCase().includes(q)
            || (p.cli_nombre_snap||'').toLowerCase().includes(q)
            || (p.usu_nombre||'').toLowerCase().includes(q)
            || String(p.mov_id).includes(q);
    });

    const pedidoRef   = (p) => `TXN-${String(p.mov_id).padStart(6,'0')}`;
    const fmtMoney    = (n) => `Gs. ${Number(n||0).toLocaleString('es-PY')}`;
    const fmtFecha    = (ts) => {
        if (!ts) return '—';
        return new Date(ts).toLocaleString('es-PY', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
    };
    const METODO_META = {
        efectivo:      { label:'Efectivo',       color:'var(--success)', bg:'#dcfce7' },
        tarjeta:       { label:'Tarjeta',         color:'var(--primary)', bg:'#eef2ff' },
        transferencia: { label:'Transferencia',   color:'#0891b2', bg:'#ecfeff' },
        mixto:         { label:'Dividido',        color:'var(--warning)', bg:'#fef3c7' },
    };
    const tipoMeta = (p) => {
        if (p.mov_es_reembolso) return { label:'Reembolso', color:'var(--warning)', bg:'#fef3c7' };
        if (p.mov_tipo === 'ingreso') return { label:'Ingreso', color:'var(--success)', bg:'#dcfce7' };
        return { label:'Egreso', color:'var(--danger)', bg:'#fef2f2' };
    };

    // Total
    const totalIngresos = pedidos.filter(p => p.mov_tipo==='ingreso' && !p.mov_es_reembolso).reduce((a,p) => a + p.mov_monto, 0);
    const totalEgresos  = pedidos.filter(p => p.mov_tipo==='egreso'  && !p.mov_es_reembolso).reduce((a,p) => a + p.mov_monto, 0);

    return (
        <div className="animate-fade-in">
            {/* Header + filtros */}
            <div className="card" style={{ padding:'1rem 1.25rem', marginBottom:'1rem' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:'0.75rem', flexWrap:'wrap' }}>
                    <div style={{ flex:1, minWidth:200 }}>
                        <div style={{ fontWeight:800, fontSize:'1.05rem', marginBottom:2 }}>Pedidos y Movimientos</div>
                        <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{pedidosFiltrados.length} de {pedidos.length} movimiento{pedidos.length !== 1 ? 's' : ''}</div>
                    </div>
                    {/* KPIs rápidos */}
                    <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap' }}>
                        <div style={{ background:'var(--success-light)', borderRadius:8, padding:'0.35rem 0.75rem', fontSize:'0.78rem', fontWeight:800, color:'var(--success)' }}>
                            + {fmtMoney(totalIngresos)}
                        </div>
                        <div style={{ background:'#fef2f2', borderRadius:8, padding:'0.35rem 0.75rem', fontSize:'0.78rem', fontWeight:800, color:'var(--danger)' }}>
                            - {fmtMoney(totalEgresos)}
                        </div>
                    </div>
                </div>
                {/* Filtros */}
                <div style={{ display:'flex', gap:'0.5rem', flexWrap:'wrap', marginTop:'0.75rem', alignItems:'center' }}>
                    <div style={{ position:'relative', flex:1, minWidth:180 }}>
                        <Icon name="search" size={14} style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                        <input className="input" placeholder="Buscar concepto, cliente..." value={buscar} onChange={e => setBuscar(e.target.value)} style={{ paddingLeft:28, fontSize:'0.82rem' }} />
                    </div>
                    <input type="date" className="input" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ width:140, fontSize:'0.82rem' }} />
                    <span style={{ color:'var(--text-muted)' }}>—</span>
                    <input type="date" className="input" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ width:140, fontSize:'0.82rem' }} />
                    <select className="input" value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ width:140, fontSize:'0.82rem' }}>
                        <option value="">Todos los tipos</option>
                        <option value="ingreso">Ingresos</option>
                        <option value="egreso">Egresos</option>
                    </select>
                    {esSupervisor && (
                        <select className="input" value={filtroUsu} onChange={e => setFiltroUsu(e.target.value)} style={{ width:175, fontSize:'0.82rem' }}>
                            <option value="">Mis pedidos</option>
                            <option value="todos">Todos los cajeros</option>
                            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                        </select>
                    )}
                    {(filterFrom || filterTo || filterTipo || filtroUsu || buscar) && (
                        <button className="btn btn-secondary" style={{ fontSize:'0.82rem' }} onClick={() => { setFilterFrom(''); setFilterTo(''); setFilterTipo(''); setFiltroUsu(''); setBuscar(''); }}>
                            <Icon name="x" size={13} /> Limpiar
                        </button>
                    )}
                </div>
            </div>

            {/* Tabla */}
            <div className="card" style={{ overflow:'hidden' }}>
                {/* Cabecera */}
                <div style={{ display:'grid', gridTemplateColumns:'1.1fr 1fr 1.4fr 1.1fr 1fr 0.9fr 1fr 0.85fr', gap:'0.5rem', padding:'0.65rem 1rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', fontSize:'0.72rem', fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    <div>Referencia</div>
                    <div>Fecha</div>
                    <div>Concepto</div>
                    <div>Cajero</div>
                    <div>Cliente</div>
                    <div>Metodo</div>
                    <div style={{ textAlign:'right' }}>Monto</div>
                    <div style={{ textAlign:'center' }}>Tipo</div>
                </div>

                {loading ? (
                    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>Cargando pedidos...</div>
                ) : pedidosFiltrados.length === 0 ? (
                    <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-muted)' }}>
                        <Icon name="inbox" size={36} style={{ marginBottom:'0.5rem' }} />
                        <div style={{ fontWeight:700 }}>Sin movimientos en el periodo seleccionado</div>
                    </div>
                ) : pedidosFiltrados.map((p, idx) => {
                    const metodo = METODO_META[p.mov_metodo_pago] || { label: p.mov_metodo_pago, color:'#475569', bg:'#f1f5f9' };
                    const tipo   = tipoMeta(p);
                    const expanded = expandedId === p.mov_id;
                    let items = [];
                    try { items = p.mov_items ? JSON.parse(p.mov_items) : []; } catch(e) { items = []; }
                    return (
                        <React.Fragment key={p.mov_id}>
                            <div
                                onClick={() => setExpandedId(expanded ? null : p.mov_id)}
                                style={{
                                    display:'grid', gridTemplateColumns:'1.1fr 1fr 1.4fr 1.1fr 1fr 0.9fr 1fr 0.85fr',
                                    gap:'0.5rem', padding:'0.7rem 1rem', cursor: items.length > 0 ? 'pointer' : 'default',
                                    borderBottom: expanded ? '2px solid var(--primary)' : idx < pedidosFiltrados.length-1 ? '1px solid var(--border)' : 'none',
                                    background: expanded ? 'rgba(59,130,246,0.04)' : 'transparent',
                                    alignItems:'center', transition:'background 0.15s',
                                }}
                                onMouseEnter={e => { if (!expanded) e.currentTarget.style.background='var(--bg-secondary)'; }}
                                onMouseLeave={e => { if (!expanded) e.currentTarget.style.background='transparent'; }}
                            >
                                {/* Ref */}
                                <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                    {items.length > 0 && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} style={{ color:'var(--text-muted)', flexShrink:0 }} />}
                                    <span style={{ fontWeight:700, fontSize:'0.8rem', color:'var(--primary)', fontFamily:'monospace' }}>{pedidoRef(p)}</span>
                                </div>
                                {/* Fecha */}
                                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{fmtFecha(p.mov_timestamp)}</div>
                                {/* Concepto */}
                                <div style={{ fontSize:'0.82rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={p.mov_concepto}>{p.mov_concepto}</div>
                                {/* Cajero */}
                                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.usu_nombre || '—'}</div>
                                {/* Cliente */}
                                <div style={{ fontSize:'0.8rem', color:'var(--text-muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.cli_nombre_snap || p.cli_nombre || '—'}</div>
                                {/* Método */}
                                <div>
                                    <span style={{ fontSize:'0.7rem', fontWeight:700, borderRadius:999, padding:'2px 8px', background:metodo.bg, color:metodo.color }}>{metodo.label}</span>
                                </div>
                                {/* Monto */}
                                <div style={{ textAlign:'right', fontWeight:800, fontSize:'0.84rem', color:tipo.color, whiteSpace:'nowrap' }}>
                                    {p.mov_es_reembolso || p.mov_tipo==='egreso' ? '-' : '+'} {fmtMoney(p.mov_monto)}
                                </div>
                                {/* Tipo */}
                                <div style={{ textAlign:'center' }}>
                                    <span style={{ fontSize:'0.7rem', fontWeight:800, borderRadius:999, padding:'2px 8px', background:tipo.bg, color:tipo.color }}>{tipo.label}</span>
                                </div>
                            </div>
                            {/* Items expandidos */}
                            {expanded && items.length > 0 && (
                                <div style={{ background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', padding:'0.75rem 1.5rem' }}>
                                    <div style={{ fontWeight:700, fontSize:'0.78rem', color:'var(--text-muted)', marginBottom:'0.5rem' }}>Items del pedido</div>
                                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:'0.8rem', maxWidth:600 }}>
                                        <thead>
                                            <tr style={{ borderBottom:'1.5px solid var(--border)' }}>
                                                <th style={{ padding:'0.3rem 0.6rem', textAlign:'left', fontWeight:700, color:'var(--text-muted)', fontSize:'0.7rem' }}>Producto</th>
                                                <th style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:700, color:'var(--text-muted)', fontSize:'0.7rem' }}>Cant.</th>
                                                <th style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:700, color:'var(--text-muted)', fontSize:'0.7rem' }}>P. Unit.</th>
                                                <th style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:700, color:'var(--text-muted)', fontSize:'0.7rem' }}>Subtotal</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((it, i) => (
                                                <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
                                                    <td style={{ padding:'0.3rem 0.6rem', fontWeight:600 }}>{it.nombre || it.item_nombre || '—'}</td>
                                                    <td style={{ padding:'0.3rem 0.6rem', textAlign:'right' }}>{it.cantidad}</td>
                                                    <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color:'var(--text-muted)' }}>Gs. {Number(it.precio||0).toLocaleString('es-PY')}</td>
                                                    <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:700 }}>Gs. {Number((it.precio||0)*(it.cantidad||1)).toLocaleString('es-PY')}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                        <tfoot>
                                            <tr style={{ borderTop:'2px solid var(--border)' }}>
                                                <td colSpan={3} style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:700, fontSize:'0.82rem' }}>Total</td>
                                                <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', fontWeight:800, fontSize:'0.9rem', color:'var(--primary)' }}>Gs. {Number(p.mov_monto).toLocaleString('es-PY')}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        </div>
    );
};

const AdminSidebar = ({ active, setActive, userRol, open, onClose }) => {
    const go = (page) => { setActive(page); onClose && onClose(); };

    // Páginas que pertenecen a cada grupo (para auto-expandir)
    const PGS_RECORRIDO = ['routes', 'asignacion'];
    const PGS_CAJA      = ['caja', 'historial', 'sesiones', 'pedidos'];
    const PGS_ADMIN     = ['reportes', 'solicitudes', 'usuarios', 'config', 'auditoria'];

    const [openRecorrido, setOpenRecorrido] = useState(() => PGS_RECORRIDO.includes(active));
    const [openCaja,      setOpenCaja]      = useState(() => PGS_CAJA.includes(active));
    const [openAdmin,     setOpenAdmin]     = useState(() => PGS_ADMIN.includes(active));

    // Auto-expandir el grupo cuando la página activa pertenece a él
    useEffect(() => {
        if (PGS_RECORRIDO.includes(active)) setOpenRecorrido(true);
        if (PGS_CAJA.includes(active))      setOpenCaja(true);
        if (PGS_ADMIN.includes(active))     setOpenAdmin(true);
    }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

    // Componente para el encabezado de grupo desplegable
    const NavGroup = ({ label, icon, isOpen, onToggle, children, accentColor = 'var(--primary)' }) => {
        const hasActive = isOpen || React.Children.toArray(children).some(c => c?.props?.isActive);
        return (
            <div style={{ marginBottom: 2 }}>
                {/* Header del grupo */}
                <div
                    onClick={onToggle}
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem',
                        padding: '0.55rem 0.85rem', borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer', userSelect: 'none',
                        color: isOpen ? accentColor : 'var(--text-muted)',
                        fontWeight: 700, fontSize: '0.78rem',
                        background: isOpen ? `${accentColor}12` : 'transparent',
                        transition: 'all 0.15s',
                    }}
                >
                    <Icon name={icon} size={18} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, letterSpacing: '0.01em', textTransform: 'uppercase', fontSize: '0.72rem' }}>{label}</span>
                    <Icon
                        name="chevron-right"
                        size={14}
                        style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', flexShrink: 0 }}
                    />
                </div>
                {/* Items del grupo con animación */}
                <div style={{
                    overflow: 'hidden',
                    maxHeight: isOpen ? '600px' : '0px',
                    transition: 'max-height 0.25s cubic-bezier(0.4,0,0.2,1)',
                }}>
                    <div style={{ paddingLeft: '0.75rem', paddingBottom: isOpen ? '0.25rem' : 0 }}>
                        {children}
                    </div>
                </div>
            </div>
        );
    };

    // Ítem de nav dentro de un grupo (borde izquierdo de acento)
    const NavSubItem = ({ page, icon, label, accentColor = 'var(--primary)' }) => {
        const isActive = active === page;
        return (
            <div
                className={`nav-item${isActive ? ' active' : ''}`}
                onClick={() => go(page)}
                style={{
                    fontSize: '0.82rem',
                    paddingLeft: '0.75rem',
                    borderLeft: isActive ? `3px solid ${accentColor}` : '3px solid transparent',
                    borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                    marginLeft: 4,
                }}
            >
                <Icon name={icon} size={17} /> {label}
            </div>
        );
    };

    return (
        <div className={`sidebar${open ? ' open' : ''}`}>
            {/* Logo */}
            <div className="flex items-center gap-2 mb-6 px-2">
                <img src="/logo.png" alt="MaisonTech" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                <span className="font-bold text-xl">MAISONTECH APP</span>
            </div>

            {/* ── Ítems principales ── */}
            {userRol !== 'caja' && (
                <div className={`nav-item ${active === 'dashboard' ? 'active' : ''}`} onClick={() => go('dashboard')}>
                    <Icon name="layout-dashboard" size={20} /> Dashboard
                </div>
            )}
            {userRol !== 'caja' && (
                <div className={`nav-item ${active === 'machines' ? 'active' : ''}`} onClick={() => go('machines')}>
                    <Icon name="joystick" size={20} /> Máquinas
                </div>
            )}

            {/* ── Grupo: Recorrido ── */}
            {userRol !== 'caja' && (
                <NavGroup
                    label="Recorrido"
                    icon="route"
                    isOpen={openRecorrido}
                    onToggle={() => setOpenRecorrido(o => !o)}
                    accentColor="#4f46e5"
                >
                    <NavSubItem page="routes"    icon="map"     label="Rutas"                  accentColor="#4f46e5" />
                    <NavSubItem page="asignacion" icon="map-pin" label="Asignación de Recorrido" accentColor="#4f46e5" />
                </NavGroup>
            )}

            {['admin','superadmin'].includes(userRol) && (
                <div className={`nav-item ${active === 'clientes' ? 'active' : ''}`} onClick={() => go('clientes')}>
                    <Icon name="users" size={20} /> Clientes
                </div>
            )}
            {['admin','superadmin','caja'].includes(userRol) && (
                <div className={`nav-item ${active === 'productos' ? 'active' : ''}`} onClick={() => go('productos')}>
                    <Icon name="package" size={20} /> Productos
                </div>
            )}
            {/* ── Grupo: Punto de Venta ── */}
            {['admin','superadmin','caja'].includes(userRol) && (
                <NavGroup
                    label="Punto de Venta"
                    icon="wallet"
                    isOpen={openCaja}
                    onToggle={() => setOpenCaja(o => !o)}
                    accentColor="#0891b2"
                >
                    <NavSubItem page="caja"      icon="cash"         label="Caja"             accentColor="#0891b2" />
                    <NavSubItem page="pedidos"   icon="shopping-bag" label="Pedidos"          accentColor="#0891b2" />
                    <NavSubItem page="sesiones"  icon="layout-list"  label="Sesiones"         accentColor="#0891b2" />
                    <NavSubItem page="historial" icon="clock"        label="Historial"        accentColor="#0891b2" />
                </NavGroup>
            )}

            {/* ── Grupo: Administración ── */}
            {['admin','superadmin'].includes(userRol) && (
                <NavGroup
                    label="Administración"
                    icon="shield"
                    isOpen={openAdmin}
                    onToggle={() => setOpenAdmin(o => !o)}
                    accentColor="#7c3aed"
                >
                    <NavSubItem page="reportes"      icon="bar-chart-2"   label="Reportes"         accentColor="#7c3aed" />
                    <NavSubItem page="solicitudes"   icon="inbox"         label="Solicitudes"       accentColor="#7c3aed" />
                    <NavSubItem page="usuarios"      icon="user-cog"      label="Usuarios"          accentColor="#7c3aed" />
                    {userRol === 'superadmin' && (
                        <NavSubItem page="config"    icon="settings"      label="Configuración"     accentColor="#7c3aed" />
                    )}
                    {userRol === 'superadmin' && (
                        <NavSubItem page="auditoria" icon="shield-check"  label="Auditoría"         accentColor="#7c3aed" />
                    )}
                </NavGroup>
            )}

            <div className="flex-1" />

            {/* ── Perfil y logout (siempre visibles) ── */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
                <div className={`nav-item ${active === 'mi-perfil' ? 'active' : ''}`} onClick={() => go('mi-perfil')}>
                    <Icon name="user-circle" size={20} /> Mi Perfil
                </div>
                <div className="nav-item" style={{ color: 'var(--danger)' }} onClick={() => go('logout')}>
                    <Icon name="log-out" size={20} /> Cerrar Sesión
                </div>
            </div>
        </div>
    );
};

// ─── QRModal ──────────────────────────────────────────────────────────────────
function QRModal({ machine, onClose }) {
    const printRef = useRef(null);

    function handlePrint() {
        const w = window.open('', '_blank', 'width=400,height=500');
        w.document.write(`
            <html><head><title>QR ${machine.id}</title>
            <style>
                body { font-family: sans-serif; text-align: center; padding: 2rem; }
                svg { display: block; margin: 0 auto 1rem; }
                h2 { font-size: 1.4rem; margin: 0 0 0.25rem; }
                p { color: #555; margin: 0 0 0.15rem; font-size: 0.9rem; }
            </style></head><body>
            ${printRef.current.innerHTML}
            <script>window.onload=()=>{window.print();window.close();}<\/script>
            </body></html>
        `);
        w.document.close();
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ background:'var(--surface)', borderRadius: 16, padding: '2rem', width: '100%', maxWidth: 340, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '1rem', color: '#111' }}>Código QR</span>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.25rem', color: '#555' }}>✕</button>
                </div>
                <div ref={printRef}>
                    <QRCodeSVG value={`${window.location.origin}/scan/${encodeURIComponent(machine.id)}`} size={200} style={{ margin: '0 auto 1rem' }} level="M" includeMargin />
                    <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.2rem', color: '#111' }}>{machine.id}</h2>
                    <p style={{ color: '#555', margin: '0 0 0.1rem', fontSize: '0.85rem' }}>{machine.type}</p>
                    <p style={{ color: '#888', margin: 0, fontSize: '0.8rem' }}>{machine.location}</p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
                    <button onClick={handlePrint} style={{ flex: 1, padding: '0.65rem', borderRadius: 8, background: '#4f46e5', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem' }}>
                        🖨️ Imprimir
                    </button>
                    <button onClick={onClose} style={{ flex: 1, padding: '0.65rem', borderRadius: 8, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── InitModal ────────────────────────────────────────────────────────────────
// Permite cargar los valores iniciales de los campos referenciados por {prev:key}
// en las fórmulas, para que los primeros registros de una máquina nueva funcionen.
function InitModal({ machine, onClose, onSaved }) {
    const [campos, setCampos] = useState([]);
    const [values, setValues] = useState({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        // Cargar campos del tipo de la máquina
        getTipos().then(tipos => {
            const tipo = tipos.find(t => t.id === machine.tmqId);
            if (!tipo) return;
            const allCampos = tipo.campos ?? [];

            // Encontrar qué claves son referenciadas vía {prev:key} en alguna fórmula
            const prevRefs = new Set();
            allCampos.forEach(c => {
                const matches = (c.formula || '').matchAll(/\{prev:(\w+)\}/g);
                for (const m of matches) prevRefs.add(m[1]);
            });

            // Filtrar solo los campos que son fuente de {prev:key}
            const initCampos = allCampos.filter(c => prevRefs.has(c.key));
            setCampos(initCampos);
            const initial = {};
            initCampos.forEach(c => { initial[c.key] = ''; });
            setValues(initial);
        });
    }, [machine]);

    async function handleSave() {
        setSaving(true);
        try {
            await createRecord({
                machine: machine.id,
                lgrId: machine.lgrId,
                tipo: 'init',
                camposExtra: Object.fromEntries(
                    Object.entries(values).map(([k, v]) => [k, parseFloat(v) || 0])
                ),
            });
            setSaved(true);
            onSaved?.();
        } finally {
            setSaving(false);
        }
    }

    const allFilled = campos.length > 0 && campos.every(c => values[c.key] !== '');

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
            <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}>
                {/* Header */}
                <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>Inicialización — {machine.id}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                        Cargá los valores actuales de los contadores para que las fórmulas que usan el último registro arranquen correctamente.
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                    {saved ? (
                        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✅</div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>Inicialización guardada</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Los próximos registros tomarán estos valores como base.</div>
                        </div>
                    ) : campos.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            Este tipo de máquina no tiene campos que dependan del último registro.
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                            {campos.map(c => (
                                <div key={c.key} className="input-group" style={{ marginBottom: 0 }}>
                                    <label className="label" style={{ marginBottom: '0.3rem' }}>
                                        {c.label}
                                        <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 6, fontSize: '0.75rem' }}>({c.grupo})</span>
                                    </label>
                                    <input
                                        type="number"
                                        className="input"
                                        placeholder="0"
                                        value={values[c.key] ?? ''}
                                        onChange={e => setValues(v => ({ ...v, [c.key]: e.target.value }))}
                                        autoFocus={campos.indexOf(c) === 0}
                                    />
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexShrink: 0 }}>
                    <button className="btn" onClick={onClose} style={{ minWidth: 90 }}>
                        {saved ? 'Cerrar' : 'Cancelar'}
                    </button>
                    {!saved && campos.length > 0 && (
                        <button
                            className="btn btn-primary"
                            disabled={saving || !allFilled}
                            onClick={handleSave}
                            style={{ minWidth: 120 }}
                        >
                            {saving ? 'Guardando…' : 'Guardar inicialización'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── MiPerfilAdminPanel ───────────────────────────────────────────────────────
function MiPerfilAdminPanel({ userNombre, userUser, userRol, onLogout, onNombreChange }) {
    const [currPass, setCurrPass] = useState('');
    const [newPass,  setNewPass]  = useState('');
    const [confPass, setConfPass] = useState('');
    const [saving,   setSaving]   = useState(false);
    const [msg,      setMsg]      = useState(null); // { type: 'ok'|'err', text }

    // Editar nombre / email
    const [editNombre, setEditNombre] = useState(userNombre || '');
    const [editEmail,  setEditEmail]  = useState('');
    const [savingPerfil, setSavingPerfil] = useState(false);
    const [msgPerfil,    setMsgPerfil]    = useState(null);

    // Load current email on mount
    useEffect(() => {
        // We get the email from server if needed; for now leave empty so user types it
    }, []);

    const ROL_LABEL = { superadmin: 'Super Admin', admin: 'Administrador', caja: 'Caja', terreno: 'Terreno' };

    async function handleUpdatePerfil(e) {
        e.preventDefault();
        setMsgPerfil(null);
        if (!editNombre.trim() || editNombre.trim().length < 2) return setMsgPerfil({ type: 'err', text: 'El nombre debe tener al menos 2 caracteres.' });
        setSavingPerfil(true);
        try {
            const payload = {};
            if (editNombre.trim()) payload.nombre = editNombre.trim();
            if (editEmail.trim())  payload.email  = editEmail.trim();
            const res = await updateProfile(payload.nombre, payload.email || undefined);
            if (res.nombre) { setEditNombre(res.nombre); onNombreChange && onNombreChange(res.nombre); }
            setMsgPerfil({ type: 'ok', text: 'Perfil actualizado correctamente.' });
            setEditEmail('');
        } catch (err) {
            setMsgPerfil({ type: 'err', text: err.message || 'Error al actualizar el perfil.' });
        } finally {
            setSavingPerfil(false);
        }
    }

    async function handleChangePassword(e) {
        e.preventDefault();
        setMsg(null);
        if (newPass.length < 8) return setMsg({ type: 'err', text: 'La nueva contraseña debe tener al menos 8 caracteres.' });
        if (newPass !== confPass) return setMsg({ type: 'err', text: 'Las contraseñas nuevas no coinciden.' });
        setSaving(true);
        try {
            await changePassword(currPass, newPass);
            setMsg({ type: 'ok', text: 'Contraseña actualizada correctamente.' });
            setCurrPass(''); setNewPass(''); setConfPass('');
        } catch (err) {
            setMsg({ type: 'err', text: err.message || 'Error al cambiar la contraseña.' });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="animate-fade-in" style={{ maxWidth: 520, margin: '0 auto', padding: '1.5rem 1rem' }}>
            {/* Avatar + info */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', fontWeight: 800, flexShrink: 0 }}>
                    {(userNombre || userUser || '?')[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{userNombre || userUser}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>@{userUser}</div>
                    <div style={{ marginTop: 6 }}>
                        <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>{ROL_LABEL[userRol] ?? userRol}</span>
                    </div>
                </div>
            </div>

            {/* Editar nombre y email */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="user-pen" size={16} style={{ color: 'var(--primary)' }} />
                    Editar perfil
                </div>

                {msgPerfil && (
                    <div className={`alert ${msgPerfil.type === 'ok' ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1rem', fontSize: '0.83rem' }}>
                        {msgPerfil.text}
                    </div>
                )}

                <form onSubmit={handleUpdatePerfil}>
                    <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="label">Nombre visible</label>
                        <input
                            type="text"
                            className="input"
                            value={editNombre}
                            onChange={e => setEditNombre(e.target.value)}
                            placeholder="Tu nombre"
                            minLength={2}
                            maxLength={100}
                            required
                        />
                    </div>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                        <label className="label">Email (dejar vacío para no cambiar)</label>
                        <input
                            type="email"
                            className="input"
                            value={editEmail}
                            onChange={e => setEditEmail(e.target.value)}
                            placeholder="nuevo@email.com"
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={savingPerfil || !editNombre.trim()}
                        style={{ width: '100%' }}
                    >
                        {savingPerfil ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                </form>
            </div>

            {/* Cambiar contraseña */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="key-round" size={16} style={{ color: 'var(--primary)' }} />
                    Cambiar contraseña
                </div>

                {msg && (
                    <div className={`alert ${msg.type === 'ok' ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '1rem', fontSize: '0.83rem' }}>
                        {msg.text}
                    </div>
                )}

                <form onSubmit={handleChangePassword}>
                    <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="label">Contraseña actual</label>
                        <input
                            type="password"
                            className="input"
                            value={currPass}
                            onChange={e => setCurrPass(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </div>
                    <div className="input-group" style={{ marginBottom: '0.75rem' }}>
                        <label className="label">Nueva contraseña</label>
                        <input
                            type="password"
                            className="input"
                            value={newPass}
                            onChange={e => setNewPass(e.target.value)}
                            autoComplete="new-password"
                            minLength={8}
                            required
                        />
                    </div>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                        <label className="label">Confirmar nueva contraseña</label>
                        <input
                            type="password"
                            className="input"
                            value={confPass}
                            onChange={e => setConfPass(e.target.value)}
                            autoComplete="new-password"
                            minLength={8}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={saving || !currPass || !newPass || !confPass}
                        style={{ width: '100%' }}
                    >
                        {saving ? 'Guardando…' : 'Actualizar contraseña'}
                    </button>
                </form>
            </div>

            {/* Cerrar sesión */}
            <div className="card" style={{ padding: '1.5rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="shield" size={16} style={{ color: 'var(--text-muted)' }} />
                    Seguridad
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    Si creés que tu cuenta está comprometida, cerrá sesión ahora.
                </p>
                <button
                    className="btn"
                    style={{ color: '#ef4444', borderColor: '#ef4444', width: '100%' }}
                    onClick={() => {
                        if (window.confirm('¿Cerrar sesión?')) onLogout();
                    }}
                >
                    <Icon name="log-out" size={15} style={{ marginRight: 6 }} />
                    Cerrar sesión
                </button>
            </div>
        </div>
    );
}

const AdminDashboard = ({ records, machines, onSaveMachine, onMachineCreated, onLogout, userRol, userNombre, userUser, darkMode = false, onToggleDark }) => {
    const [activeMenu, setActiveMenu] = useState(userRol === 'caja' ? 'caja' : 'dashboard');
    const [localNombre, setLocalNombre] = useState(userNombre || ''); // puede actualizarse desde Mi Perfil
    const [editingMachine, setEditingMachine] = useState(null);
    const [historyMachine, setHistoryMachine] = useState(null);
    const [machinesSubView, setMachinesSubView] = useState('list');
    const [qrMachine, setQrMachine] = useState(null);
    const [initMachine, setInitMachine] = useState(null);
    const [editMapPicker, setEditMapPicker] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [deletingMachine, setDeletingMachine] = useState(null); // máquina a eliminar
    const [deleteError, setDeleteError] = useState('');
    const [editTipos, setEditTipos] = useState([]);  // tipos cargados para el form de edición

    // Inventario: búsqueda + paginación client-side
    const [machineSearch, setMachineSearch] = useState('');
    const [machinePage,   setMachinePage]   = useState(1);
    const MACHINES_PER_PAGE = 15;

    // Cargar tipos al montar (los necesita el form de editar máquina)
    useEffect(() => { getTipos().then(setEditTipos).catch(() => {}); }, []);

    // Intercept logout from sidebar — usar useEffect para no llamar setState durante render
    useEffect(() => {
        if (activeMenu === 'logout') onLogout();
    }, [activeMenu, onLogout]);

    const totalRecaudacion = records.reduce((acc, r) => acc + r.fisico, 0);
    const totalAvisos = records.filter(r => r.status !== 'OK').length;

    const [cajaBalance, setCajaBalance] = useState(null);
    const [ultimosMov, setUltimosMov] = useState([]);
    const [routeRuns, setRouteRuns] = useState([]);
    const [cierreHoy, setCierreHoy] = useState(undefined);
    const [dashLoading, setDashLoading] = useState(false);
    const [alertasOpen, setAlertasOpen] = useState(true);
    const [usuariosActividad, setUsuariosActividad] = useState([]);
    const [dashCatalogo, setDashCatalogo] = useState([]);
    // Notificaciones de reposición
    const [notifCount, setNotifCount]           = useState(0);
    const [notifOpen, setNotifOpen]             = useState(false);
    const [notifSolicitudes, setNotifSolicitudes] = useState([]);
    const [notifLoading, setNotifLoading]       = useState(false);
    // Producto a resaltar cuando se navega desde una notificación
    const [productoBuscar, setProductoBuscar]   = useState('');

    useEffect(() => {
        if (activeMenu !== 'dashboard') return;
        let alive = true;
        setDashLoading(true);
        const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Asuncion' });
        const canSeeUsers = ['admin','superadmin'].includes(userRol);
        Promise.all([
            getCajaBalance(hoy),
            getCajaMovimientos({ from: hoy, to: hoy }),
            getRouteRuns({ limit: 6 }),
            getCajaCierre(hoy),
            canSeeUsers ? getUsuariosActividad() : Promise.resolve([]),
            getCatalogo({ todos: false }), // solo vigentes, para alertas de stock
        ])
            .then(([bal, movs, runs, cierre, usrAct, cat]) => {
                if (!alive) return;
                setCajaBalance(bal);
                setUltimosMov((movs || []).slice(0, 8));
                setRouteRuns(runs || []);
                setCierreHoy(cierre || null);
                setUsuariosActividad(usrAct || []);
                setDashCatalogo(Array.isArray(cat) ? cat : []);
            })
            .catch(() => {})
            .finally(() => alive && setDashLoading(false));
        return () => { alive = false; };
    }, [activeMenu, userRol]);

    // Polling de notificaciones de reposición (cada 30s) — solo admin/superadmin
    useEffect(() => {
        if (!['admin', 'superadmin'].includes(userRol)) return;
        let alive = true;
        const poll = () => getSolicitudesPendientes().then(d => { if (alive) setNotifCount(d.total ?? 0); }).catch(() => {});
        poll();
        const interval = setInterval(poll, 30000);
        return () => { alive = false; clearInterval(interval); };
    }, [userRol]);

    const openNotifPanel = async () => {
        setNotifOpen(true);
        setNotifLoading(true);
        try {
            const rows = await getSolicitudes();
            setNotifSolicitudes(Array.isArray(rows) ? rows : []);
        } catch(e) {
            setNotifSolicitudes([]);
        } finally {
            setNotifLoading(false);
        }
    };

    const handleNotifMarcarLeida = async (id) => {
        try {
            await marcarSolicitudLeida(id);
            setNotifSolicitudes(prev => prev.map(s => s.id === id ? { ...s, leida: 1 } : s));
            setNotifCount(prev => Math.max(0, prev - 1));
        } catch(e) {}
    };

    const handleNotifMarcarTodas = async () => {
        try {
            await marcarTodasLeidas();
            setNotifSolicitudes(prev => prev.map(s => ({ ...s, leida: 1 })));
            setNotifCount(0);
        } catch(e) {}
    };

    const handleNotifEliminar = async (id) => {
        try {
            await deleteSolicitud(id);
            const eliminada = notifSolicitudes.find(s => s.id === id);
            setNotifSolicitudes(prev => prev.filter(s => s.id !== id));
            if (eliminada && !eliminada.leida) setNotifCount(prev => Math.max(0, prev - 1));
        } catch(e) {}
    };

    const handleDeleteMachine = async () => {
        if (!deletingMachine) return;
        setDeleteError('');
        try {
            await deleteMachine(deletingMachine.id);
            setDeletingMachine(null);
            await onMachineCreated(); // refresca la lista
        } catch (e) {
            setDeleteError(e.message || 'Error al eliminar la máquina');
        }
    };

    return (
        <div className="admin-shell animate-fade-in">
            {qrMachine && <QRModal machine={qrMachine} onClose={() => setQrMachine(null)} />}
            {initMachine && <InitModal machine={initMachine} onClose={() => setInitMachine(null)} onSaved={() => setInitMachine(null)} />}

            {/* Modal confirmación eliminar máquina */}
            {deletingMachine && createPortal(
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
                    <div className="card p-6" style={{ maxWidth:420, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
                            <div style={{ width:44, height:44, borderRadius:'50%', background:'#fef2f2', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon name="trash-2" size={22} style={{ color:'#dc2626' }} />
                            </div>
                            <div>
                                <div className="font-semibold" style={{ fontSize:'1rem' }}>Eliminar máquina</div>
                                <div className="text-sm text-muted">Esta acción no se puede deshacer</div>
                            </div>
                        </div>
                        <div style={{ background:'#fef2f2', borderRadius:8, padding:'0.75rem 1rem', marginBottom:'1.25rem', fontSize:'0.85rem', color:'var(--danger)' }}>
                            ¿Seguro que querés eliminar la máquina <strong>{deletingMachine.id}</strong>?<br />
                            <span style={{ fontSize:'0.78rem', color:'#dc2626', marginTop:4, display:'block' }}>Se eliminarán todos sus registros de recaudación y datos asociados.</span>
                        </div>
                        {deleteError && <div style={{ background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'1rem', fontSize:'0.82rem', fontWeight:600 }}>{deleteError}</div>}
                        <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => { setDeletingMachine(null); setDeleteError(''); }}>
                                Cancelar
                            </button>
                            <button
                                className="btn"
                                style={{ background:'#dc2626', color:'white' }}
                                onClick={handleDeleteMachine}
                            >
                                <Icon name="trash-2" size={15} /> Eliminar definitivamente
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Panel de notificaciones de reposición */}
            {notifOpen && createPortal(
                <div style={{ position:'fixed', inset:0, zIndex:9998, display:'flex', justifyContent:'flex-end' }}>
                    <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.35)' }} onClick={() => setNotifOpen(false)} />
                    <div style={{ position:'relative', width:'min(420px, 100vw)', background:'var(--bg-color)', boxShadow:'-4px 0 24px rgba(0,0,0,0.18)', display:'flex', flexDirection:'column', height:'100%', zIndex:1 }}>
                        {/* Header */}
                        <div style={{ padding:'1.25rem 1.25rem 1rem', borderBottom:'1px solid var(--border-color)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <div>
                                <div style={{ fontWeight:800, fontSize:'1rem' }}>Solicitudes de Reposición</div>
                                <div style={{ fontSize:'0.78rem', color:'var(--text-muted)', marginTop:2 }}>
                                    {notifCount > 0 ? <span style={{ color:'var(--danger)', fontWeight:700 }}>{notifCount} sin leer</span> : 'Todo al día'}
                                </div>
                                <button className="btn btn-secondary" style={{ fontSize:'0.72rem', padding:'0.2rem 0.55rem', marginTop:4, gap:4 }}
                                    onClick={() => { setNotifOpen(false); setActiveMenu('solicitudes'); }}>
                                    <Icon name="external-link" size={11} /> Ver página completa
                                </button>
                            </div>
                            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
                                {notifSolicitudes.some(s => !s.leida) && (
                                    <button className="btn btn-secondary" style={{ fontSize:'0.75rem', padding:'0.3rem 0.65rem', fontWeight:700 }} onClick={handleNotifMarcarTodas}>
                                        Marcar todas leidas
                                    </button>
                                )}
                                <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'0.25rem' }} onClick={() => setNotifOpen(false)}>
                                    <Icon name="x" size={20} />
                                </button>
                            </div>
                        </div>
                        {/* Lista */}
                        <div style={{ flex:1, overflowY:'auto', padding:'0.75rem' }}>
                            {notifLoading ? (
                                <div style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)', fontSize:'0.9rem' }}>Cargando...</div>
                            ) : notifSolicitudes.length === 0 ? (
                                <div style={{ textAlign:'center', padding:'2.5rem 1rem', color:'var(--text-muted)' }}>
                                    <Icon name="check-circle" size={36} style={{ marginBottom:'0.5rem', color:'var(--success)' }} />
                                    <div style={{ fontWeight:700, fontSize:'0.95rem' }}>Sin solicitudes pendientes</div>
                                </div>
                            ) : notifSolicitudes.map(s => (
                                <div key={s.id} style={{ background: s.leida ? 'var(--bg-secondary)' : 'rgba(239,68,68,0.06)', border:`1px solid ${s.leida ? 'var(--border-color)' : 'rgba(239,68,68,0.25)'}`, borderRadius:10, padding:'0.85rem', marginBottom:'0.6rem', display:'flex', gap:'0.75rem', alignItems:'flex-start' }}>
                                    <div style={{ width:36, height:36, borderRadius:'50%', background: s.leida ? '#f1f5f9' : '#fef2f2', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                        <Icon name="package" size={16} style={{ color: s.leida ? '#94a3b8' : '#ef4444' }} />
                                    </div>
                                    <div style={{ flex:1, minWidth:0 }}>
                                        <div style={{ fontWeight:700, fontSize:'0.88rem', marginBottom:2 }}>{s.item_nombre}</div>
                                        <div style={{ fontSize:'0.77rem', color:'var(--text-muted)', marginBottom:4 }}>
                                            Solicitado por <strong>{s.usu_nombre}</strong> &middot; {new Date(s.created_at).toLocaleString('es-PY', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                                        </div>
                                        {s.mensaje && (
                                            <div style={{ fontSize:'0.8rem', color:'var(--text-color)', background:'var(--bg-secondary)', borderRadius:6, padding:'0.35rem 0.5rem', marginBottom:4, fontStyle:'italic' }}>
                                                "{s.mensaje}"
                                            </div>
                                        )}
                                        <div style={{ display:'flex', gap:'0.4rem', marginTop:4, flexWrap:'wrap' }}>
                                            {/* Ir al producto */}
                                            <button
                                                className="btn btn-primary"
                                                style={{ fontSize:'0.7rem', padding:'0.2rem 0.6rem', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}
                                                onClick={() => {
                                                    setProductoBuscar(s.item_nombre);
                                                    setActiveMenu('productos');
                                                    setNotifOpen(false);
                                                    if (!s.leida) handleNotifMarcarLeida(s.id);
                                                }}
                                            >
                                                <Icon name="package" size={11} /> Ir al producto
                                            </button>
                                            {!s.leida && (
                                                <button className="btn btn-secondary" style={{ fontSize:'0.7rem', padding:'0.2rem 0.5rem', fontWeight:700 }} onClick={() => handleNotifMarcarLeida(s.id)}>
                                                    Marcar leida
                                                </button>
                                            )}
                                            <button className="btn" style={{ fontSize:'0.7rem', padding:'0.2rem 0.5rem', fontWeight:700, background:'transparent', color:'var(--danger)', border:'1px solid #fca5a5' }} onClick={() => handleNotifEliminar(s.id)}>
                                                Descartar
                                            </button>
                                        </div>
                                    </div>
                                    {!s.leida && (
                                        <div style={{ width:8, height:8, borderRadius:'50%', background:'#ef4444', flexShrink:0, marginTop:4 }} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>,
                document.body
            )}

            <div className={`sidebar-overlay${sidebarOpen ? ' open' : ''}`} onClick={() => setSidebarOpen(false)} />
            <AdminSidebar active={activeMenu} setActive={setActiveMenu} userRol={userRol} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

            <div className="flex-col w-full h-full overflow-hidden">
                <div className="topbar">
                    <div className="flex items-center" style={{ minWidth: 0 }}>
                        <button className="hamburger-btn" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú">
                            <Icon name="menu" size={22} />
                        </button>
                        <div className="text-lg font-semibold" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {activeMenu === 'dashboard' && 'Resumen de Recaudación'}
                            {activeMenu === 'machines' && 'Gestión de Máquinas'}
                            {activeMenu === 'edit-machine' && 'Editar Máquina'}
                            {activeMenu === 'routes' && 'Monitoreo de Rutas'}
                            {activeMenu === 'asignacion' && 'Asignación de Recorrido'}
                            {activeMenu === 'clientes' && 'Gestión de Clientes'}
                            {activeMenu === 'productos' && 'Productos y Servicios'}
                            {activeMenu === 'caja' && 'Módulo de Caja'}
                            {activeMenu === 'historial' && 'Historial de Caja'}
                            {activeMenu === 'sesiones' && 'Sesiones de Caja'}
                            {activeMenu === 'pedidos' && 'Pedidos y Movimientos'}
                            {activeMenu === 'reportes' && 'Reportes de Recaudación'}
                            {activeMenu === 'solicitudes' && 'Solicitudes de Reposición'}
                            {activeMenu === 'usuarios' && 'Gestión de Usuarios'}
                            {activeMenu === 'config' && 'Configuración del Sistema'}
                            {activeMenu === 'auditoria' && 'Registro de Auditoría'}
                            {activeMenu === 'mi-perfil' && 'Mi Perfil'}
                        </div>
                    </div>
                    <div className="flex items-center gap-4" style={{ flexShrink: 0 }}>
                        {/* Toggle dark mode */}
                        <button
                            onClick={onToggleDark}
                            title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                            style={{ background:'none', border:'none', cursor:'pointer', padding:'0.25rem', color:'var(--text-muted)', display:'flex', alignItems:'center', borderRadius:'var(--radius-md)' }}
                        >
                            <Icon name={darkMode ? 'sun' : 'moon'} size={20} />
                        </button>
                        {/* Campana de notificaciones — solo admin/superadmin */}
                        {['admin','superadmin'].includes(userRol) && (
                            <button
                                onClick={openNotifPanel}
                                title="Solicitudes de reposicion"
                                style={{ position:'relative', background:'none', border:'none', cursor:'pointer', padding:'0.25rem', color:'var(--text-muted)', display:'flex', alignItems:'center' }}
                            >
                                <Icon name="bell" size={20} />
                                {notifCount > 0 && (
                                    <span style={{ position:'absolute', top:-4, right:-4, background:'#ef4444', color:'white', borderRadius:'50%', width:17, height:17, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.6rem', fontWeight:800, lineHeight:1 }}>
                                        {notifCount > 9 ? '9+' : notifCount}
                                    </span>
                                )}
                            </button>
                        )}
                        {!['admin','superadmin'].includes(userRol) && <Icon name="bell" size={20} className="text-muted" />}
                        <div className="flex items-center gap-2" style={{ cursor: 'pointer' }} onClick={() => setActiveMenu('mi-perfil')} title="Mi Perfil">
                            <div style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', flexShrink: 0 }}>
                                {(localNombre || userUser || 'A')[0].toUpperCase()}
                            </div>
                            <span className="text-sm font-medium topbar-username">{localNombre || userUser || 'Admin'}</span>
                        </div>
                    </div>
                </div>

                <div className="main-content">
                    {activeMenu === 'dashboard' && (
                        <div className="animate-fade-in">

                            {/* ── Fila 1: KPIs recaudación + caja ── */}
                            <div className="stats-grid dashboard-kpi-grid" style={{ marginBottom: '1.5rem' }}>
                                <div className="card stat-card">
                                    <div className="stat-icon bg-success-light"><Icon name="trending-up" size={22} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Recaudación</div>
                                        <div className="text-2xl font-bold">${totalRecaudacion.toLocaleString('es-CL')}</div>
                                    </div>
                                </div>
                                <div className="card stat-card">
                                    <div className="stat-icon bg-primary-light"><Icon name="map-pin" size={22} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Rutas Activas</div>
                                        <div className="text-2xl font-bold">{routeRuns.filter(r => r.status === 'active').length}</div>
                                    </div>
                                </div>
                                <div className="card stat-card">
                                    <div className="stat-icon bg-warning-light"><Icon name="alert-triangle" size={22} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Descuadres</div>
                                        <div className="text-2xl font-bold">{totalAvisos}</div>
                                    </div>
                                </div>
                                <div className="card stat-card">
                                    <div className="stat-icon" style={{ background: 'var(--success-light,#f0fdf4)' }}><Icon name="dollar-sign" size={22} style={{ color: 'var(--success)' }} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Balance Caja</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                                            {cajaBalance ? `$${Number(cajaBalance.balance).toLocaleString('es-CL')}` : '—'}
                                        </div>
                                    </div>
                                </div>
                                <div className="card stat-card">
                                    <div className="stat-icon bg-success-light"><Icon name="arrow-down-circle" size={22} style={{ color: 'var(--success)' }} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Ingresos Caja</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--success)' }}>
                                            {cajaBalance ? `$${Number(cajaBalance.total_ingresos).toLocaleString('es-CL')}` : '—'}
                                        </div>
                                    </div>
                                </div>
                                <div className="card stat-card">
                                    <div className="stat-icon" style={{ background: '#fef2f2' }}><Icon name="arrow-up-circle" size={22} style={{ color: 'var(--danger)' }} /></div>
                                    <div>
                                        <div className="text-sm text-muted">Egresos Caja</div>
                                        <div className="text-2xl font-bold" style={{ color: 'var(--danger)' }}>
                                            {cajaBalance ? `$${Number(cajaBalance.total_egresos).toLocaleString('es-CL')}` : '—'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── Alertas Activas ── */}
                            {(() => {
                                const alertas = [];
                                // Máquinas en mantenimiento
                                const maqWarning = machines.filter(m => m.status === 'warning');
                                if (maqWarning.length > 0)
                                    alertas.push({ nivel: 'warning', icono: 'tool', titulo: `${maqWarning.length} máquina${maqWarning.length > 1 ? 's' : ''} en mantenimiento`, detalle: maqWarning.map(m => m.id).join(', ') });
                                // Descuadres en recaudaciones
                                const descuadres = records.filter(r => r.status !== 'OK');
                                if (descuadres.length > 0)
                                    alertas.push({ nivel: 'warning', icono: 'alert-triangle', titulo: `${descuadres.length} descuadre${descuadres.length > 1 ? 's' : ''} pendiente${descuadres.length > 1 ? 's' : ''}`, detalle: descuadres.map(r => `${r.machine} (${r.status})`).join(', ') });
                                // Rutas activas sin completar
                                const rutasActivas = routeRuns.filter(r => r.status === 'active');
                                if (rutasActivas.length > 0)
                                    alertas.push({ nivel: 'info', icono: 'map-pin', titulo: `${rutasActivas.length} ruta${rutasActivas.length > 1 ? 's' : ''} en curso`, detalle: rutasActivas.map(r => `Ruta #${r.id} · ${r.doneCount || 0}/${r.stops?.length || 0} paradas`).join(' — ') });
                                // Caja sin cerrar hoy (solo si hay movimientos y ya pasó la mañana)
                                if (cierreHoy === null && ultimosMov.length > 0)
                                    alertas.push({ nivel: 'danger', icono: 'unlock', titulo: 'Caja sin cerrar hoy', detalle: 'Hay movimientos registrados y la caja no fue cerrada aún.' });
                                // Egresos superan ingresos
                                if (cajaBalance && cajaBalance.total_egresos > cajaBalance.total_ingresos && cajaBalance.total_ingresos > 0)
                                    alertas.push({ nivel: 'danger', icono: 'trending-down', titulo: 'Los egresos superan los ingresos en caja', detalle: `Ingresos $${Number(cajaBalance.total_ingresos).toLocaleString('es-CL')} · Egresos $${Number(cajaBalance.total_egresos).toLocaleString('es-CL')}` });
                                // Productos sin stock
                                const prodSinStock = dashCatalogo.filter(i => i.item_tipo !== 'servicio' && (i.item_stock ?? 0) === 0);
                                if (prodSinStock.length > 0)
                                    alertas.push({ nivel: 'danger', icono: 'package-x', titulo: `${prodSinStock.length} producto${prodSinStock.length > 1 ? 's' : ''} sin stock`, detalle: prodSinStock.map(i => i.item_nombre).join(', ') });
                                // Productos con stock bajo (1–5 unidades)
                                const prodStockBajo = dashCatalogo.filter(i => i.item_tipo !== 'servicio' && (i.item_stock ?? 0) > 0 && (i.item_stock ?? 0) <= 5);
                                if (prodStockBajo.length > 0)
                                    alertas.push({ nivel: 'warning', icono: 'package', titulo: `${prodStockBajo.length} producto${prodStockBajo.length > 1 ? 's' : ''} con stock bajo (≤5 u.)`, detalle: prodStockBajo.map(i => `${i.item_nombre} (${i.item_stock}u.)`).join(', ') });

                                const colores = { warning: { bg:'var(--warning-light)', border:'var(--warning)', icon:'var(--warning)', text:'var(--text-main)' }, info: { bg:'var(--primary-light)', border:'var(--primary)', icon:'var(--primary)', text:'var(--text-main)' }, danger: { bg:'var(--danger-light)', border:'var(--danger)', icon:'var(--danger)', text:'var(--text-main)' } };

                                return (
                                    <div className="card mb-6">
                                        <button type="button"
                                            style={{ width:'100%', background:'none', border:'none', cursor:'pointer', padding:'1rem 1.25rem', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom: alertasOpen ? '1px solid var(--border)' : 'none', color:'var(--text-main)' }}
                                            onClick={() => setAlertasOpen(o => !o)}>
                                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                                <Icon name="bell" size={18} className="text-primary" />
                                                <span style={{ fontWeight:700, fontSize:'0.95rem' }}>Alertas Activas</span>
                                                {alertas.length > 0 && (
                                                    <span style={{ background:'var(--danger)', color:'#fff', borderRadius:999, padding:'1px 9px', fontSize:'0.72rem', fontWeight:800 }}>{alertas.length}</span>
                                                )}
                                                {alertas.length === 0 && !dashLoading && (
                                                    <span style={{ background:'var(--success)', color:'#fff', borderRadius:999, padding:'1px 9px', fontSize:'0.72rem', fontWeight:800 }}>OK</span>
                                                )}
                                            </div>
                                            <Icon name={alertasOpen ? 'chevron-up' : 'chevron-down'} size={18} style={{ color:'var(--text-muted)' }} />
                                        </button>
                                        {alertasOpen && (dashLoading ? (
                                            <div className="p-4 text-center text-muted text-sm">Verificando alertas...</div>
                                        ) : alertas.length === 0 ? (
                                            <div style={{ padding:'1rem 1.25rem', display:'flex', alignItems:'center', gap:'0.6rem' }}>
                                                <Icon name="check-circle" size={18} style={{ color:'var(--success)', flexShrink:0 }} />
                                                <span style={{ fontSize:'0.875rem', color:'var(--success)', fontWeight:600 }}>Todo en orden — sin alertas activas</span>
                                            </div>
                                        ) : (
                                            <div style={{ padding:'0.5rem 0' }}>
                                                {alertas.map((a, i) => {
                                                    const c = colores[a.nivel];
                                                    return (
                                                        <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:'0.75rem', padding:'0.65rem 1.25rem', borderBottom: i < alertas.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                            <div style={{ width:32, height:32, borderRadius:'50%', background:c.bg, border:`1px solid ${c.border}`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1 }}>
                                                                <Icon name={a.icono} size={15} style={{ color:c.icon }} />
                                                            </div>
                                                            <div style={{ flex:1, minWidth:0 }}>
                                                                <div style={{ fontSize:'0.82rem', fontWeight:700, color:c.text }}>{a.titulo}</div>
                                                                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.detalle}</div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ))}
                                    </div>
                                );
                            })()}

                            {/* ── Fila 2: Rendimiento por ruta + Últimos movimientos ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>

                                {/* Rendimiento por ruta */}
                                <div className="card">
                                    <div className="p-4 border-b flex items-center gap-2">
                                        <Icon name="map" size={18} className="text-primary" />
                                        <h3 className="font-semibold text-base">Rendimiento por Ruta</h3>
                                    </div>
                                    {dashLoading ? (
                                        <div className="p-6 text-center text-muted text-sm">Cargando...</div>
                                    ) : routeRuns.length === 0 ? (
                                        <div className="p-6 text-center text-muted text-sm">Sin rutas registradas</div>
                                    ) : (
                                        <div style={{ padding: '0.5rem 0' }}>
                                            {routeRuns.map((run, i) => {
                                                const total = run.stops?.length || 0;
                                                const done  = run.doneCount || 0;
                                                const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
                                                const statusColor = run.status === 'active' ? 'var(--primary)' : run.status === 'completed' ? 'var(--success)' : 'var(--text-muted)';
                                                const statusLabel = run.status === 'active' ? 'En curso' : run.status === 'completed' ? 'Completada' : 'Cancelada';
                                                const fecha = run.startedAt ? new Date(run.startedAt).toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'2-digit', timeZone:'America/Asuncion' }) : '—';
                                                return (
                                                    <div key={run.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.6rem 1rem', borderBottom: i < routeRuns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                        <div style={{ width:34, height:34, borderRadius:'50%', background:'var(--primary-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontWeight:800, fontSize:'0.8rem', color:'var(--primary)' }}>
                                                            #{run.id}
                                                        </div>
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                                                                <span style={{ fontSize:'0.8rem', fontWeight:700, color:'var(--text)' }}>{fecha} · {done}/{total} paradas</span>
                                                                <span style={{ fontSize:'0.72rem', fontWeight:700, color: statusColor }}>{statusLabel}</span>
                                                            </div>
                                                            <div style={{ height:5, background:'var(--bg-color)', borderRadius:99, overflow:'hidden' }}>
                                                                <div style={{ height:'100%', width:`${pct}%`, background: run.status === 'completed' ? 'var(--success)' : 'var(--primary)', borderRadius:99, transition:'width 0.4s' }} />
                                                            </div>
                                                            <div style={{ display:'flex', justifyContent:'space-between', marginTop:3 }}>
                                                                <span style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>{pct}% completado</span>
                                                                {run.totalRecaudado > 0 && <span style={{ fontSize:'0.7rem', fontWeight:700, color:'var(--success)' }}>${Number(run.totalRecaudado).toLocaleString('es-CL')}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Últimos movimientos de caja */}
                                <div className="card">
                                    <div className="p-4 border-b flex items-center gap-2">
                                        <Icon name="clock" size={18} className="text-primary" />
                                        <h3 className="font-semibold text-base">Últimos Movimientos de Caja</h3>
                                    </div>
                                    {dashLoading ? (
                                        <div className="p-6 text-center text-muted text-sm">Cargando...</div>
                                    ) : ultimosMov.length === 0 ? (
                                        <div className="p-6 text-center text-muted text-sm">Sin movimientos registrados</div>
                                    ) : (
                                        <div style={{ padding: '0.25rem 0' }}>
                                            {ultimosMov.map((mov, i) => {
                                                const esIngreso = mov.mov_tipo === 'ingreso';
                                                const esReemb   = mov.mov_es_reembolso === 1;
                                                const color     = esReemb ? '#7c3aed' : esIngreso ? 'var(--success)' : 'var(--danger)';
                                                const bg        = esReemb ? '#f5f3ff' : esIngreso ? 'var(--success-light,#f0fdf4)' : '#fef2f2';
                                                const icono     = esReemb ? '↩' : esIngreso ? '↓' : '↑';
                                                const hora      = new Date(mov.mov_timestamp).toLocaleTimeString('es-CL', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' });
                                                const dia       = new Date(mov.mov_timestamp).toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', timeZone:'America/Asuncion' });
                                                return (
                                                    <div key={mov.mov_id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.55rem 1rem', borderBottom: i < ultimosMov.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                        <div style={{ width:30, height:30, borderRadius:'50%', background: bg, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.9rem', color, flexShrink:0 }}>
                                                            {icono}
                                                        </div>
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ fontSize:'0.8rem', fontWeight:600, color:'var(--text)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                                                                {mov.mov_concepto || '—'}
                                                            </div>
                                                            <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:1 }}>
                                                                {dia} {hora}{mov.cli_nombre_snap ? ` · ${mov.cli_nombre_snap}` : ''}
                                                            </div>
                                                        </div>
                                                        <div style={{ fontWeight:800, fontSize:'0.85rem', color, flexShrink:0 }}>
                                                            {esIngreso ? '+' : '-'}${Number(mov.mov_monto).toLocaleString('es-CL')}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Actividad de Usuarios ── */}
                            {['admin','superadmin'].includes(userRol) && (
                                <div className="card mb-6">
                                    <div className="p-4 border-b flex items-center gap-2">
                                        <Icon name="user-check" size={18} className="text-primary" />
                                        <h3 className="font-semibold text-base">Actividad de Usuarios</h3>
                                    </div>
                                    {dashLoading ? (
                                        <div className="p-4 text-center text-muted text-sm">Cargando...</div>
                                    ) : usuariosActividad.length === 0 ? (
                                        <div className="p-4 text-center text-muted text-sm">Sin actividad registrada</div>
                                    ) : (
                                        <div style={{ padding:'0.25rem 0' }}>
                                            {usuariosActividad.map((u, i) => {
                                                const ts = u.ultima_actividad;
                                                const fecha = ts ? new Date(ts).toLocaleDateString('es-PY', { day:'2-digit', month:'2-digit', year:'2-digit', timeZone:'America/Asuncion' }) : '—';
                                                const hora  = ts ? new Date(ts).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' }) : '';
                                                const esEdit = u.accion === 'editado';
                                                return (
                                                    <div key={u.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.55rem 1rem', borderBottom: i < usuariosActividad.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                                        <div style={{ width:32, height:32, borderRadius:'50%', background: esEdit ? '#eff6ff' : '#f0fdf4', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                                            <Icon name={esEdit ? 'user-pen' : 'user-plus'} size={15} style={{ color: esEdit ? 'var(--primary)' : 'var(--success)' }} />
                                                        </div>
                                                        <div style={{ flex:1, minWidth:0 }}>
                                                            <div style={{ fontSize:'0.82rem', fontWeight:700, color:'var(--text)' }}>
                                                                {u.nombre} <span style={{ fontFamily:'monospace', fontWeight:400, color:'var(--text-muted)', fontSize:'0.78rem' }}>@{u.user}</span>
                                                            </div>
                                                            <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:1 }}>
                                                                {fecha} {hora}
                                                            </div>
                                                        </div>
                                                        <span style={{ background: ROL_COLORS[u.rol] || '#64748b', color:'white', borderRadius:999, fontSize:'0.68rem', fontWeight:700, padding:'2px 8px', flexShrink:0 }}>
                                                            {ROL_LABELS[u.rol] || u.rol}
                                                        </span>
                                                        <span style={{ fontSize:'0.75rem', fontWeight:600, color: esEdit ? 'var(--primary)' : 'var(--success)', flexShrink:0 }}>
                                                            {esEdit ? 'Editado' : 'Creado'}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── Fila 3: Últimas recaudaciones ── */}
                            <div className="card mb-6">
                                <div className="p-4 border-b flex items-center gap-2">
                                    <Icon name="list" size={18} className="text-primary" />
                                    <h3 className="font-semibold text-base">Últimas Recaudaciones Procesadas</h3>
                                </div>
                                <div className="table-wrapper">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>Máquina</th>
                                                <th>Lugar</th>
                                                <th>Pre-calc Esperado</th>
                                                <th>Ingresado Físico</th>
                                                <th>Estado</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {records.slice(0, 10).map(r => (
                                                <tr key={r.id}>
                                                    <td className="font-medium">{r.machine}</td>
                                                    <td>{r.location}</td>
                                                    <td>${r.preCalc.toLocaleString('es-CL')}</td>
                                                    <td>${r.fisico.toLocaleString('es-CL')}</td>
                                                    <td>
                                                        <span className={`badge ${r.status === 'OK' ? 'badge-success' : 'badge-warning'}`}>
                                                            {r.status === 'OK' ? 'OK' : `Descuadre ($${Math.abs(r.fisico - r.preCalc).toLocaleString('es-CL')})`}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>
                    )}

                    {activeMenu === 'machines' && machinesSubView === 'create' && (
                        <MachinesPage
                            machines={machines}
                            onMachineCreated={onMachineCreated}
                            onBack={() => setMachinesSubView('list')}
                        />
                    )}

                    {activeMenu === 'machines' && machinesSubView === 'list' && (() => {
                        const filteredMachines = machines.filter(m => {
                            if (!machineSearch.trim()) return true;
                            const q = machineSearch.toLowerCase();
                            return (m.id ?? '').toLowerCase().includes(q)
                                || (m.type ?? '').toLowerCase().includes(q)
                                || (m.location ?? '').toLowerCase().includes(q)
                                || (m.status ?? '').toLowerCase().includes(q);
                        });
                        const totalMachinePages = Math.max(1, Math.ceil(filteredMachines.length / MACHINES_PER_PAGE));
                        const safePageM = Math.min(machinePage, totalMachinePages);
                        const pagedMachines = filteredMachines.slice((safePageM - 1) * MACHINES_PER_PAGE, safePageM * MACHINES_PER_PAGE);

                        return (
                        <div className="animate-fade-in">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold">Inventario de Máquinas</h2>
                                <button className="btn btn-primary" onClick={() => setMachinesSubView('create')}>
                                    <Icon name="plus" size={16} /> Nueva Máquina
                                </button>
                            </div>

                            {/* Barra de búsqueda + contador */}
                            <div className="flex items-center gap-3 mb-4">
                                <div style={{ position:'relative', flex:1, maxWidth:360 }}>
                                    <Icon name="search" size={15} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', pointerEvents:'none' }} />
                                    <input
                                        type="text"
                                        placeholder="Buscar por ID, tipo, ubicación…"
                                        value={machineSearch}
                                        onChange={e => { setMachineSearch(e.target.value); setMachinePage(1); }}
                                        style={{ width:'100%', paddingLeft:32, paddingRight:10, height:36, borderRadius:'var(--radius-md)', border:'1px solid var(--border)', background:'var(--bg-color)', color:'var(--text-main)', fontSize:'0.875rem' }}
                                    />
                                </div>
                                <span style={{ fontSize:'0.82rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                                    {filteredMachines.length} de {machines.length} máquina{machines.length !== 1 ? 's' : ''}
                                </span>
                                {machineSearch && (
                                    <button onClick={() => { setMachineSearch(''); setMachinePage(1); }}
                                        style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', padding:'0 4px', lineHeight:1 }}
                                        title="Limpiar búsqueda">✕</button>
                                )}
                            </div>

                            <div className="card">
                                <div className="table-wrapper">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>ID Máquina</th>
                                                <th>Tipo</th>
                                                <th>Ubicación Actual</th>
                                                <th>Última Recaudación</th>
                                                <th>Estado</th>
                                                <th>Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pagedMachines.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>
                                                        {machineSearch ? 'Sin resultados para la búsqueda.' : 'No hay máquinas registradas.'}
                                                    </td>
                                                </tr>
                                            ) : pagedMachines.map(m => (
                                                <tr key={m.id}>
                                                    <td className="font-medium text-primary">{m.id}</td>
                                                    <td>{m.type}</td>
                                                    <td>
                                                        <div className="flex items-center gap-1.5">
                                                            <Icon name="map-pin" size={14} className="text-muted" />
                                                            <span>{m.location}</span>
                                                        </div>
                                                    </td>
                                                    <td className="font-semibold">{m.lastRevenue}</td>
                                                    <td>
                                                        {(() => {
                                                            const statusMap = {
                                                                ok:             { cls: 'badge-success', label: 'Operativa' },
                                                                mantenimiento:  { cls: 'badge-warning', label: 'Mantenimiento' },
                                                                warning:        { cls: 'badge-warning', label: 'Requiere Mantención' },
                                                                fuera_servicio: { cls: 'badge-danger',  label: 'Fuera de servicio' },
                                                                baja:           { cls: '',              label: 'De baja', style: { background:'#f1f5f9', color:'#64748b' } },
                                                            };
                                                            const s = statusMap[m.status] || statusMap.ok;
                                                            return <span className={`badge ${s.cls}`} style={s.style}>{s.label}</span>;
                                                        })()}
                                                    </td>
                                                    <td>
                                                        <div className="flex gap-2">
                                                            <button className="btn btn-secondary btn-icon" title="Editar" onClick={() => {
                                                                setEditingMachine({ ...m, _originalId: m.id });
                                                                setActiveMenu('edit-machine');
                                                            }}>
                                                                <Icon name="edit" size={16} />
                                                            </button>
                                                            <button className="btn btn-secondary btn-icon" title="Ver QR" onClick={() => setQrMachine(m)}>
                                                                <Icon name="qr-code" size={16} />
                                                            </button>
                                                            <button className="btn btn-secondary btn-icon" title="Historial" onClick={() => setHistoryMachine(m)}>
                                                                <Icon name="history" size={16} />
                                                            </button>
                                                            <button className="btn btn-secondary btn-icon" title="Inicializar contadores" onClick={() => setInitMachine(m)}>
                                                                <Icon name="zap" size={16} />
                                                            </button>
                                                            {userRol === 'superadmin' && (
                                                                <button className="btn btn-secondary btn-icon" title="Eliminar máquina"
                                                                    style={{ color:'#dc2626', borderColor:'var(--danger)' }}
                                                                    onClick={() => { setDeletingMachine(m); setDeleteError(''); }}>
                                                                    <Icon name="trash-2" size={16} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Paginación */}
                                {totalMachinePages > 1 && (
                                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.75rem 1rem', borderTop:'1px solid var(--border)', fontSize:'0.82rem', color:'var(--text-muted)' }}>
                                        <span>Página {safePageM} de {totalMachinePages}</span>
                                        <div style={{ display:'flex', gap:4 }}>
                                            <button onClick={() => setMachinePage(1)} disabled={safePageM === 1}
                                                className="btn btn-secondary btn-icon" title="Primera" style={{ padding:'4px 8px', fontSize:'0.8rem' }}>«</button>
                                            <button onClick={() => setMachinePage(p => Math.max(1, p - 1))} disabled={safePageM === 1}
                                                className="btn btn-secondary btn-icon" title="Anterior" style={{ padding:'4px 8px', fontSize:'0.8rem' }}>‹</button>
                                            {Array.from({ length: totalMachinePages }, (_, i) => i + 1)
                                                .filter(p => p === 1 || p === totalMachinePages || Math.abs(p - safePageM) <= 2)
                                                .reduce((acc, p, idx, arr) => {
                                                    if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                                                    acc.push(p);
                                                    return acc;
                                                }, [])
                                                .map((p, i) => p === '…'
                                                    ? <span key={`e${i}`} style={{ padding:'4px 6px' }}>…</span>
                                                    : <button key={p} onClick={() => setMachinePage(p)}
                                                        className={`btn btn-icon ${p === safePageM ? 'btn-primary' : 'btn-secondary'}`}
                                                        style={{ padding:'4px 10px', fontSize:'0.8rem', minWidth:32 }}>{p}</button>
                                                )}
                                            <button onClick={() => setMachinePage(p => Math.min(totalMachinePages, p + 1))} disabled={safePageM === totalMachinePages}
                                                className="btn btn-secondary btn-icon" title="Siguiente" style={{ padding:'4px 8px', fontSize:'0.8rem' }}>›</button>
                                            <button onClick={() => setMachinePage(totalMachinePages)} disabled={safePageM === totalMachinePages}
                                                className="btn btn-secondary btn-icon" title="Última" style={{ padding:'4px 8px', fontSize:'0.8rem' }}>»</button>
                                        </div>
                                        <span>{(safePageM - 1) * MACHINES_PER_PAGE + 1}–{Math.min(safePageM * MACHINES_PER_PAGE, filteredMachines.length)} de {filteredMachines.length}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                        );
                    })()}

                    {/* EDIT MACHINE SCREEN */}
                    {activeMenu === 'edit-machine' && editingMachine && (
                        <>
                        {/* ── Modal mapa para fijar coordenadas ── */}
                        {editMapPicker && createPortal(
                            <LocationPickerModal
                                initial={editingMachine.coords || null}
                                lugarNombre={editingMachine.location}
                                onConfirm={async (coords) => {
                                    // Guardamos las coords en el estado local para mostrárselas al usuario
                                    setEditingMachine(prev => ({ ...prev, coords }));
                                    // Persiste inmediatamente en la BD si hay lgrId
                                    if (editingMachine.lgrId) {
                                        try { await updateLugar(editingMachine.lgrId, { lat: coords[0], lng: coords[1] }); }
                                        catch { /* se guardará al hacer Guardar Cambios */ }
                                    }
                                    setEditMapPicker(false);
                                }}
                                onCancel={() => setEditMapPicker(false)}
                            />,
                            document.body
                        )}

                        <div className="animate-fade-in max-w-3xl mx-auto">
                            <div className="flex items-center gap-2 mb-6 cursor-pointer text-muted hover:text-primary transition-colors" onClick={() => {
                                setEditingMachine(null);
                                setEditMapPicker(false);
                                setActiveMenu('machines');
                            }}>
                                <Icon name="arrow-left" size={20} />
                                <span className="font-semibold text-sm">Volver al Inventario</span>
                            </div>

                            <div className="card p-8">
                                <div className="border-b pb-4 mb-6">
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <Icon name="joystick" className="text-primary" />
                                        Editar Máquina: <span className="text-primary">{editingMachine.id}</span>
                                    </h3>
                                    <p className="text-sm text-muted mt-1">Modifique los detalles técnicos y ubicación de la máquina.</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="input-group">
                                        <label className="label">ID de Máquina</label>
                                        <input
                                            className="input"
                                            value={editingMachine.id}
                                            onChange={e => setEditingMachine({ ...editingMachine, id: e.target.value })}
                                            placeholder="Ej: MQR-001"
                                        />
                                        {editingMachine.id !== editingMachine._originalId && (
                                            <p className="text-xs mt-1" style={{ color:'var(--warning,#d97706)' }}>
                                                ⚠ El ID cambiará de <strong>{editingMachine._originalId}</strong> a <strong>{editingMachine.id}</strong>
                                            </p>
                                        )}
                                    </div>
                                    <div className="input-group">
                                        <label className="label">Tipo de Máquina</label>
                                        <select
                                            className="input"
                                            value={editingMachine.tmqId ?? ''}
                                            onChange={e => {
                                                const t = editTipos.find(t => String(t.id) === e.target.value);
                                                setEditingMachine({ ...editingMachine, tmqId: e.target.value, type: t?.description ?? t?.desc ?? '' });
                                            }}
                                        >
                                            <option value="">— Seleccionar tipo —</option>
                                            {editTipos.map(t => (
                                                <option key={t.id} value={t.id}>{t.description ?? t.desc}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="input-group">
                                        <label className="label">Ubicación Actual</label>
                                        <input className="input" value={editingMachine.location} readOnly style={{ background: 'var(--bg-color)', color: 'var(--text-muted)' }} />
                                    </div>

                                    {/* ── Coordenadas + botón mapa ── */}
                                    <div className="input-group md:col-span-2">
                                        <label className="label">Coordenadas en el Mapa</label>
                                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'stretch' }}>
                                            <div style={{ flex: 1, padding: '0.65rem 0.875rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-color)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: 42 }}>
                                                {editingMachine.coords ? (
                                                    <>
                                                        <Icon name="map-pin" size={15} className="text-success" />
                                                        <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                                            {editingMachine.coords[0].toFixed(6)}, {editingMachine.coords[1].toFixed(6)}
                                                        </span>
                                                        <span className="badge badge-success" style={{ fontSize: '0.65rem', marginLeft: 4 }}>Fijada</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Icon name="map-pin" size={15} className="text-muted" />
                                                        <span style={{ color: 'var(--text-muted)' }}>Sin coordenadas — la máquina no aparecerá en el mapa</span>
                                                    </>
                                                )}
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-secondary"
                                                style={{ flexShrink: 0, gap: '0.4rem', whiteSpace: 'nowrap' }}
                                                onClick={() => setEditMapPicker(true)}
                                            >
                                                <Icon name="map" size={16} />
                                                {editingMachine.coords ? 'Cambiar en mapa' : 'Fijar en mapa'}
                                            </button>
                                        </div>
                                        <p className="text-xs text-muted mt-1">
                                            Abre el mapa, hace click en el punto exacto y confirma. El marcador es arrastrable para mayor precisión.
                                        </p>
                                    </div>

                                    <div className="input-group md:col-span-2">
                                        <label className="label">Estado Operativo</label>
                                        <select className="input" value={editingMachine.status} onChange={e => setEditingMachine({...editingMachine, status: e.target.value})}>
                                            <option value="ok">Operativa (OK)</option>
                                            <option value="mantenimiento">En Mantenimiento</option>
                                            <option value="fuera_servicio">Fuera de Servicio</option>
                                            <option value="baja">De Baja</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 mt-8 pt-6 border-t">
                                    <button className="btn btn-secondary" onClick={() => {
                                        setEditingMachine(null);
                                        setEditMapPicker(false);
                                        setActiveMenu('machines');
                                    }}>
                                        Cancelar
                                    </button>
                                    <button className="btn btn-primary" onClick={async () => {
                                        const newId = editingMachine.id.trim();
                                        if (!newId) return;
                                        await onSaveMachine(editingMachine._originalId, {
                                            tmqId: editingMachine.tmqId ? Number(editingMachine.tmqId) : undefined,
                                            status: editingMachine.status,
                                            ...(newId !== editingMachine._originalId && { newId }),
                                        });
                                        // Guardar coordenadas en el lugar si se modificaron
                                        if (editingMachine.lgrId && editingMachine.coords) {
                                            await updateLugar(editingMachine.lgrId, {
                                                lat: editingMachine.coords[0],
                                                lng: editingMachine.coords[1],
                                            });
                                        }
                                        setEditingMachine(null);
                                        setEditMapPicker(false);
                                        setActiveMenu('machines');
                                    }}>
                                        <Icon name="save" size={16} /> Guardar Cambios
                                    </button>
                                </div>
                            </div>
                        </div>
                        </>
                    )}

                    {/* HISTORY MODAL (Kept as modal since it's just a quick data view) */}
                    {historyMachine && (
                        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50 animate-fade-in" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                            <div className="card p-6 w-full max-w-2xl bg-surface shadow-lg">
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold">Historial de Recaudación: {historyMachine.id}</h3>
                                    <button className="btn-icon" onClick={() => setHistoryMachine(null)}>
                                        <Icon name="x" size={20} className="text-muted" />
                                    </button>
                                </div>
                                
                                <div className="table-wrapper max-h-64 overflow-y-auto">
                                    <table className="table">
                                        <thead>
                                            <tr>
                                                <th>ID Tarea</th>
                                                <th>Fecha</th>
                                                <th>Monto Recaudado</th>
                                                <th>Cuadre</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {records.filter(r => r.machine === historyMachine.id).length > 0 ? (
                                                records.filter(r => r.machine === historyMachine.id).map((r, i) => (
                                                    <tr key={i}>
                                                        <td className="font-medium text-muted">#{r.id}</td>
                                                        <td>{r.date || "Hoy"}</td>
                                                        <td className="font-bold">${r.fisico.toLocaleString('es-CL')}</td>
                                                        <td>
                                                        <span className={`badge ${r.status === 'OK' ? 'badge-success' : 'badge-warning'}`}>
                                                            {r.status === 'OK' ? 'OK' : `Descuadre`}
                                                        </span>
                                                        </td>
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan="4" className="text-center text-muted p-4">No hay registros de recaudación para esta máquina.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex justify-end gap-2 mt-6">
                                    <button className="btn btn-primary" onClick={() => setHistoryMachine(null)}>Cerrar</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeMenu === 'routes' && (
                        <RoutesPage />
                    )}

                    {activeMenu === 'asignacion' && (
                        <AsignacionRecorridoPage />
                    )}

                    {activeMenu === 'config' && userRol === 'superadmin' && (
                        <ConfigPanel onMachineTypesChanged={onMachineCreated} />
                    )}

                    {activeMenu === 'clientes' && <ClientesPage />}
                    {activeMenu === 'productos' && <ProductosPage readOnly={userRol === 'caja'} initialBuscar={productoBuscar} onBuscarUsed={() => setProductoBuscar('')} />}
                    {activeMenu === 'caja' && <CajaPage userRol={userRol} />}
                    {activeMenu === 'historial' && <HistorialCajaPage userRol={userRol} />}
                    {activeMenu === 'sesiones' && <SesionesPage userRol={userRol} />}
                    {activeMenu === 'pedidos' && <PedidosPage userRol={userRol} />}
                    {activeMenu === 'reportes' && ['admin','superadmin'].includes(userRol) && (
                        <div className="animate-fade-in">
                            <div style={{ marginBottom: '1.25rem' }}>
                                <h2 style={{ fontWeight: 800, fontSize: '1.25rem', marginBottom: 4 }}>Reportes de Recaudación</h2>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Análisis de recaudaciones por evento, período, acumulado y descuadres.</p>
                            </div>
                            <ReportePanel machines={machines} />
                        </div>
                    )}
                    {activeMenu === 'solicitudes' && ['admin','superadmin'].includes(userRol) && (
                        <SolicitudesPage onIrProducto={nombre => { setProductoBuscar(nombre); setActiveMenu('productos'); }} />
                    )}
                    {activeMenu === 'usuarios' && <UsuariosPage userRol={userRol} />}
                    {activeMenu === 'auditoria' && userRol === 'superadmin' && <AuditPage />}
                    {activeMenu === 'mi-perfil' && (
                        <MiPerfilAdminPanel
                            userNombre={localNombre}
                            userUser={userUser}
                            userRol={userRol}
                            onLogout={onLogout}
                            onNombreChange={setLocalNombre}
                        />
                    )}

                    {activeMenu !== 'dashboard' && activeMenu !== 'machines' && activeMenu !== 'edit-machine' && activeMenu !== 'routes' && activeMenu !== 'asignacion' && activeMenu !== 'clientes' && activeMenu !== 'productos' && activeMenu !== 'caja' && activeMenu !== 'historial' && activeMenu !== 'sesiones' && activeMenu !== 'pedidos' && activeMenu !== 'reportes' && activeMenu !== 'solicitudes' && activeMenu !== 'config' && activeMenu !== 'usuarios' && activeMenu !== 'auditoria' && activeMenu !== 'mi-perfil' && (
                        <div className="card p-6 flex flex-col items-center justify-center text-muted" style={{ height: 400 }}>
                            <Icon name="hammer" size={48} className="mb-4 text-muted" />
                            <div className="text-lg font-semibold">Módulo en Desarrollo</div>
                            <p className="text-sm">Esta vista corresponde a "{activeMenu}"</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ─── ForgotPasswordScreen ─────────────────────────────────────────────────────
const ForgotPasswordScreen = ({ onBack }) => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await forgotPassword(email.trim());
            setSent(true);
        } catch (err) {
            setError(err.message || 'Error al enviar el email');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="h-screen w-full flex items-center justify-center bg-bg-color animate-fade-in" style={{ padding: '1rem' }}>
            <div className="card w-full max-w-sm p-6 shadow-lg">
                <div className="flex flex-col items-center mb-6">
                    <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
                        <Icon name="mail" size={26} style={{ color: 'var(--primary)' }} />
                    </div>
                    <h1 className="text-xl font-bold text-center">Recuperar contraseña</h1>
                    <p className="text-muted text-center mt-1 text-sm">Ingresá tu email y te enviamos un enlace para restablecer tu contraseña</p>
                </div>

                {sent ? (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ background: 'var(--success-light)', color: '#065f46', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                            ✅ Si el email existe en el sistema, recibirás un enlace en los próximos minutos. Revisá también tu carpeta de spam.
                        </div>
                        <button className="btn btn-secondary w-full" onClick={onBack}>
                            <Icon name="arrow-left" size={16} /> Volver al inicio de sesión
                        </button>
                    </div>
                ) : (
                    <>
                        {error && (
                            <div className="bg-danger-light text-danger p-2 rounded-md mb-4 text-xs font-medium">{error}</div>
                        )}
                        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                            <div className="input-group mb-0">
                                <label className="label text-xs">Email</label>
                                <input
                                    type="email"
                                    className="input py-1.5"
                                    placeholder="tu-email@ejemplo.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>
                            <button type="submit" className="btn btn-primary w-full mt-2 py-2 text-sm" disabled={loading}>
                                {loading ? 'Enviando…' : <><Icon name="send" size={16} /> Enviar enlace</>}
                            </button>
                            <button type="button" className="btn btn-secondary w-full text-sm" onClick={onBack}>
                                <Icon name="arrow-left" size={16} /> Volver
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

// ─── ResetPasswordScreen ──────────────────────────────────────────────────────
const ResetPasswordScreen = ({ token, onDone }) => {
    const [newPass, setNewPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [verifying, setVerifying] = useState(true);
    const [tokenValid, setTokenValid] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [showPass, setShowPass] = useState(false);

    useEffect(() => {
        verifyResetToken(token)
            .then(() => setTokenValid(true))
            .catch(err => setError(err.message))
            .finally(() => setVerifying(false));
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (newPass !== confirm) { setError('Las contraseñas no coinciden'); return; }
        if (newPass.length < 8)  { setError('Mínimo 8 caracteres'); return; }
        setError('');
        setLoading(true);
        try {
            await resetPassword(token, newPass);
            setSuccess(true);
            // Limpiar la URL del token
            window.history.replaceState({}, '', '/');
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const center = { display: 'flex', flexDirection: 'column', alignItems: 'center' };

    if (verifying) return (
        <div className="h-screen w-full flex items-center justify-center">
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Verificando enlace…</div>
        </div>
    );

    return (
        <div className="h-screen w-full flex items-center justify-center bg-bg-color animate-fade-in" style={{ padding: '1rem' }}>
            <div className="card w-full max-w-sm p-6 shadow-lg">
                <div style={{ ...center, marginBottom: '1.5rem' }}>
                    <div style={{ width: 56, height: 56, borderRadius: '50%', background: tokenValid ? 'var(--primary-light)' : 'var(--danger-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
                        <Icon name={tokenValid ? 'lock' : 'alert-triangle'} size={26} style={{ color: tokenValid ? 'var(--primary)' : 'var(--danger)' }} />
                    </div>
                    <h1 className="text-xl font-bold text-center">
                        {success ? '¡Contraseña actualizada!' : tokenValid ? 'Nueva contraseña' : 'Enlace inválido'}
                    </h1>
                </div>

                {success ? (
                    <div style={center}>
                        <div style={{ background: 'var(--success-light)', color: '#065f46', padding: '1rem', borderRadius: 'var(--radius-md)', marginBottom: '1.5rem', fontSize: '0.875rem', textAlign: 'center', width: '100%' }}>
                            ✅ Tu contraseña fue actualizada correctamente.
                        </div>
                        <button className="btn btn-primary w-full" onClick={onDone}>
                            <Icon name="log-in" size={16} /> Ir al inicio de sesión
                        </button>
                    </div>
                ) : !tokenValid ? (
                    <div style={center}>
                        <div className="bg-danger-light text-danger p-3 rounded-md mb-4 text-sm text-center w-full">{error}</div>
                        <button className="btn btn-secondary w-full" onClick={onDone}>
                            <Icon name="arrow-left" size={16} /> Volver al inicio
                        </button>
                    </div>
                ) : (
                    <>
                        {error && <div className="bg-danger-light text-danger p-2 rounded-md mb-4 text-xs font-medium">{error}</div>}
                        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                            <div className="input-group mb-0">
                                <label className="label text-xs">Nueva contraseña</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showPass ? 'text' : 'password'}
                                        className="input py-1.5"
                                        placeholder="Mínimo 8 caracteres"
                                        value={newPass}
                                        onChange={e => setNewPass(e.target.value)}
                                        required autoFocus
                                    />
                                    <button type="button" onClick={() => setShowPass(p => !p)}
                                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                                        <Icon name={showPass ? 'eye-off' : 'eye'} size={16} />
                                    </button>
                                </div>
                            </div>
                            <div className="input-group mb-0">
                                <label className="label text-xs">Confirmar contraseña</label>
                                <input
                                    type={showPass ? 'text' : 'password'}
                                    className="input py-1.5"
                                    placeholder="Repetí la contraseña"
                                    value={confirm}
                                    onChange={e => setConfirm(e.target.value)}
                                    required
                                />
                            </div>
                            <button type="submit" className="btn btn-primary w-full mt-2 py-2 text-sm" disabled={loading}>
                                {loading ? 'Guardando…' : <><Icon name="save" size={16} /> Guardar contraseña</>}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

// ─── LoginScreen ──────────────────────────────────────────────────────────────
const LoginScreen = ({ onLogin, sessionExpired = false, darkMode = false, onToggleDark }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showForgot, setShowForgot] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await login(username, password);
            onLogin();
        } catch (err) {
            setError(err.message || 'Credenciales inválidas.');
        }
    };

    if (showForgot) return <ForgotPasswordScreen onBack={() => setShowForgot(false)} />;

    return (
        <div className="h-screen w-full flex items-center justify-center bg-bg-color animate-fade-in" style={{ padding: '1rem' }}>
            <div className="card w-full max-w-sm p-6 shadow-lg" style={{ position: 'relative' }}>
                {/* Toggle dark/light mode */}
                {onToggleDark && (
                    <button
                        onClick={onToggleDark}
                        title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                        style={{
                            position: 'absolute', top: '0.75rem', right: '0.75rem',
                            background: 'var(--surface-hover)', border: '1px solid var(--border)',
                            borderRadius: '50%', width: 34, height: 34,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', color: 'var(--text-muted)',
                            transition: 'background 0.15s, color 0.15s',
                        }}
                    >
                        <Icon name={darkMode ? 'sun' : 'moon'} size={16} />
                    </button>
                )}
                <div className="flex flex-col items-center mb-6">
                    <img src="/logo.png" alt="MaisonTech App" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover', marginBottom: '0.75rem', boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }} />
                    <h1 className="text-xl font-bold text-center">MAISONTECH APP</h1>
                    <p className="text-muted text-center mt-1 text-sm">Sistema de Gestión y Recaudación</p>
                </div>

                {sessionExpired && !error && (
                    <div style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)', color: '#92400e', padding: '0.5rem 0.75rem', borderRadius: '0.375rem', marginBottom: '1rem', fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Icon name="alert-circle" size={14} /> Tu sesión expiró. Iniciá sesión de nuevo.
                    </div>
                )}

                {error && (
                    <div className="bg-danger-light text-danger p-2 rounded-md mb-4 text-xs font-medium">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <div className="input-group mb-0">
                        <label className="label text-xs">Usuario</label>
                        <input
                            type="text"
                            className="input py-1.5"
                            placeholder="Ej: admin o terreno"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="off"
                            required
                        />
                    </div>
                    <div className="input-group mb-0">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                            <label className="label text-xs" style={{ margin: 0 }}>Contraseña</label>
                            <button
                                type="button"
                                onClick={() => setShowForgot(true)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: 500, padding: 0 }}
                            >
                                ¿Olvidaste tu contraseña?
                            </button>
                        </div>
                        <input
                            type="password"
                            className="input py-1.5"
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    <button type="submit" className="btn btn-primary w-full mt-2 py-2 text-sm">
                        <Icon name="log-in" size={16} /> Iniciar Sesión
                    </button>
                </form>
            </div>
        </div>
    );
};

// Detectar rol desde JWT sin decodificarlo completamente (solo la parte payload)
function getAuthFromToken() {
    const token = getToken();
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) { clearToken(); return null; }
        const nombre     = (typeof getNombre === 'function' ? getNombre() : null) || payload.user;
        const tieneCaja  = typeof getTieneCaja === 'function' ? getTieneCaja() : false;
        // terreno sin caja → móvil; terreno con caja → también móvil (la caja se maneja automáticamente)
        const view = ['terreno'].includes(payload.rol) ? 'mobile' : 'admin';
        return { view, rol: payload.rol, id: payload.id, user: payload.user, nombre, tieneCaja };
    } catch { clearToken(); return null; }
}

const App = () => {
    // Detectar token de reset en la URL (?reset=TOKEN)
    const [resetToken] = useState(() => new URLSearchParams(window.location.search).get('reset'));
    // Detectar ruta /scan/:machineId
    const [scanMachineId] = useState(() => {
        const m = window.location.pathname.match(/^\/scan\/(.+)$/);
        return m ? decodeURIComponent(m[1]) : null;
    });
    const [auth, setAuth] = useState(() => getAuthFromToken());
    const [sessionExpired, setSessionExpired] = useState(false);
    const [sessionWarning, setSessionWarning] = useState(false); // aviso de sesión por vencer
    const [minutosRestantes, setMinutosRestantes] = useState(null);
    const [records, setRecords] = useState([]);
    const [machines, setMachines] = useState([]);

    // ── Dark mode ──────────────────────────────────────────────────────────
    const [darkMode, setDarkMode] = useState(
        () => document.documentElement.dataset.theme === 'dark'
    );
    const toggleDark = useCallback(() => {
        setDarkMode(d => {
            const next = !d;
            document.documentElement.dataset.theme = next ? 'dark' : 'light';
            localStorage.setItem('theme', next ? 'dark' : 'light');
            return next;
        });
    }, []);

    const refreshData = useCallback(async () => {
        const [m, r] = await Promise.all([getMachines(), getRecords()]);
        setMachines(m);
        setRecords(r);
    }, []);

    useEffect(() => {
        if (auth) refreshData();
    }, [auth, refreshData]);

    // Logout automático si el servidor devuelve 401 (token expirado/inválido)
    useEffect(() => {
        const handler = () => { setAuth(null); setSessionExpired(true); setSessionWarning(false); };
        window.addEventListener('auth:logout', handler);
        return () => window.removeEventListener('auth:logout', handler);
    }, []);

    // Timer de expiración de sesión: aviso a los 10 min, logout automático al expirar
    useEffect(() => {
        if (!auth) return;
        const token = getToken();
        if (!token) return;
        let warnTimer, expireTimer, countdownInterval;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expMs   = payload.exp * 1000;
            const nowMs   = Date.now();
            const msLeft  = expMs - nowMs;
            if (msLeft <= 0) { clearToken(); setAuth(null); setSessionExpired(true); return; }

            const WARN_MS = 10 * 60 * 1000; // aviso 10 min antes
            const warnIn  = msLeft - WARN_MS;

            if (warnIn <= 0) {
                // Quedan menos de 10 min — mostrar aviso ya
                setSessionWarning(true);
                setMinutosRestantes(Math.ceil(msLeft / 60000));
                countdownInterval = setInterval(() => {
                    const left = Math.ceil((expMs - Date.now()) / 60000);
                    setMinutosRestantes(left > 0 ? left : 0);
                }, 30000);
            } else {
                warnTimer = setTimeout(() => {
                    setSessionWarning(true);
                    setMinutosRestantes(10);
                    countdownInterval = setInterval(() => {
                        const left = Math.ceil((expMs - Date.now()) / 60000);
                        setMinutosRestantes(left > 0 ? left : 0);
                    }, 30000);
                }, warnIn);
            }

            // Auto-logout al expirar
            expireTimer = setTimeout(() => {
                clearToken();
                setAuth(null);
                setSessionExpired(true);
                setSessionWarning(false);
            }, msLeft);
        } catch {}
        return () => {
            clearTimeout(warnTimer);
            clearTimeout(expireTimer);
            clearInterval(countdownInterval);
        };
    }, [auth]);

    const handleSaveMachine = async (id, data) => {
        await updateMachine(id, data);
        await refreshData();
    };

    const handleLogout = () => {
        clearToken();
        setAuth(null);
    };

    // Si hay token de reset en la URL, mostrar pantalla de reset (independiente de auth)
    if (resetToken) {
        return <ResetPasswordScreen token={resetToken} onDone={() => window.location.replace('/')} />;
    }

    // Ruta /scan/:machineId → mostrar página de escaneo (requiere login)
    if (scanMachineId) {
        if (!auth) return <LoginScreen onLogin={() => { setSessionExpired(false); setAuth(getAuthFromToken()); }} sessionExpired={sessionExpired} darkMode={darkMode} onToggleDark={toggleDark} />;
        return <ScanPage machineId={scanMachineId} />;
    }

    if (!auth) {
        return <LoginScreen onLogin={() => { setSessionExpired(false); setAuth(getAuthFromToken()); }} sessionExpired={sessionExpired} darkMode={darkMode} onToggleDark={toggleDark} />;
    }

    return (
        <div className="h-screen w-full relative">
            {/* Banner de advertencia de sesión por vencer */}
            {sessionWarning && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
                    background: '#f59e0b', color: '#1c1917',
                    padding: '0.55rem 1rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: '0.82rem', fontWeight: 600, gap: '0.75rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                }}>
                    <span>
                        ⏰ Tu sesión vence en {minutosRestantes != null ? `${minutosRestantes} min` : 'poco tiempo'}.
                        Guardá tu trabajo y volvé a iniciar sesión para continuar.
                    </span>
                    <button
                        onClick={() => setSessionWarning(false)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '1rem', color: '#1c1917', lineHeight: 1, flexShrink: 0 }}
                        aria-label="Cerrar aviso">
                        ✕
                    </button>
                </div>
            )}
            {auth.view === 'admin' ?
                <AdminDashboard records={records} machines={machines} onSaveMachine={handleSaveMachine} onMachineCreated={refreshData} onLogout={handleLogout} userRol={auth.rol} userNombre={auth.nombre} userUser={auth.user} darkMode={darkMode} onToggleDark={toggleDark} /> :
                <Suspense fallback={
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100dvh', flexDirection:'column', gap:12, color:'var(--text-muted)' }}>
                        <div style={{ width:32, height:32, border:'3px solid var(--border)', borderTopColor:'var(--primary)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
                        <span style={{ fontSize:'0.85rem' }}>Cargando app…</span>
                    </div>
                }>
                    <MobileApp machines={machines} onLogout={handleLogout} onRecordSaved={refreshData} userId={auth.id} userNombre={auth.nombre} userUser={auth.user} userRol={auth.rol} tieneCaja={!!auth.tieneCaja} darkMode={darkMode} onToggleDark={toggleDark} />
                </Suspense>
            }
        </div>
    );
};

export default App;
