import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  ArrowLeft, CheckCircle, XCircle, MapPin, Camera, Save,
  History, Route, LogOut, ChevronRight, AlertCircle, Wrench,
  Calculator, X, Plus, Trash2, ClipboardList, Navigation, Map, QrCode,
  ClipboardCheck, Bell, Search, TrendingUp, TrendingDown, Minus, UserCircle, KeyRound, Shield,
  Wallet, RefreshCw, Sun, Moon,
  ArrowDownCircle, ArrowUpCircle, RotateCcw, Lock, LockOpen, ShoppingBag,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import MapView from './MapView';
import { getTipos, createRecord, uploadRecordImage, updateStop, addStopToRun, updateRouteRun, getRecords, createMaintenance, getLastRecord, getMisTareas, getMiHistorial, aceptarRecorrido, getCatalogo, getItemTiposCat, changePassword, getCajaCierre, getCajaMovimientos, getCajaBalance, createCajaMovimiento, createCajaApertura, createCajaCierre, deleteCajaCierre } from './api';

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => Math.round(n || 0).toLocaleString('es-PY');

/** Evaluate a campo formula: replaces {key} and {prev:key} refs with actual values.
 *  prevValues = camposExtra of the last saved record for this machine. */
/** Safe arithmetic evaluator — sin new Function, sin eval.
 *  Soporta: +  -  *  /  ( )  números decimales  negativos unarios */
function safeMath(expr) {
  const s = String(expr).trim();
  if (!s) return 0;
  if (s.length > 500) return 0; // previene DoS con expresiones enormes
  let pos = 0;
  const skip = () => { while (pos < s.length && s[pos] === ' ') pos++; };
  const parseNum = () => {
    skip();
    let start = pos;
    if (s[pos] === '-' || s[pos] === '+') pos++;
    while (pos < s.length && /[\d.]/.test(s[pos])) pos++;
    const n = parseFloat(s.slice(start));
    return isNaN(n) ? 0 : n;
  };
  const parsePrimary = () => {
    skip();
    if (s[pos] === '(') {
      pos++; const v = parseAddSub(); skip();
      if (s[pos] === ')') pos++;
      return v;
    }
    if (s[pos] === '-') { pos++; return -parsePrimary(); }
    if (s[pos] === '+') { pos++; return parsePrimary(); }
    return parseNum();
  };
  const parseMulDiv = () => {
    let left = parsePrimary();
    while (pos < s.length) {
      skip();
      if (s[pos] !== '*' && s[pos] !== '/') break;
      const op = s[pos++]; const right = parsePrimary();
      left = op === '*' ? left * right : (right !== 0 ? left / right : 0);
    }
    return left;
  };
  const parseAddSub = () => {
    let left = parseMulDiv();
    while (pos < s.length) {
      skip();
      if (s[pos] !== '+' && s[pos] !== '-') break;
      const op = s[pos++]; const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };
  try { const r = parseAddSub(); return isFinite(r) ? r : 0; }
  catch { return 0; }
}

function evalFormula(formula, values, computedSoFar, prevValues = {}) {
  if (!formula) return 0;
  let expr = formula
    .replace(/\{prev:(\w+)\}/g, (_, key) => { const v = prevValues[key]; return parseFloat(v) || 0; })
    .replace(/\{(\w+)\}/g, (_, key) => {
      if (key in computedSoFar) return computedSoFar[key];
      return parseFloat(values[key]) || 0;
    });
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
  return safeMath(expr);
}

/** Build computed values for all readonly/constant campos.
 *  Constants are resolved first so formula campos can reference them.
 *  prevValues = camposExtra of the last saved record (enables {prev:key} in formulas). */
function computeReadonly(campos, values, prevValues = {}) {
  const result = {};
  // First pass: constants (fixed numeric value stored in formula)
  for (const c of campos) {
    if (c.tipo === 'constant') result[c.key] = parseFloat(c.formula) || 0;
  }
  // Second pass: formula (readonly) campos
  for (const c of campos) {
    if (c.readonly && c.tipo !== 'constant') result[c.key] = evalFormula(c.formula, values, result, prevValues);
  }
  return result;
}

// ─── PreCalcModal ─────────────────────────────────────────────────────────────
function PreCalcModal({ campos, allValues, onClose }) {
  function fmtNum(value) {
    if (value === '' || value === null || value === undefined) return value ?? '';
    const n = typeof value === 'number' ? value : Number(value);
    if (!isNaN(n)) return n.toLocaleString('es-PY', { maximumFractionDigits: 2 });
    return value; // texto plano (observaciones, etc.)
  }

  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: parseFloat(value) < 0 ? '#ef4444' : 'var(--text-main)' }}>
        {fmtNum(value)}
      </span>
    </div>
  );

  const visibleCampos = campos.filter(c => c.tipo !== 'constant');
  const groups = [...new Set(visibleCampos.map(c => c.grupo))];

  // ── Indicador de profit ──────────────────────────────────────────────────
  // Busca el campo readonly más representativo: prioriza "total", luego "recaudac", luego el último
  const readonlyCampos = visibleCampos.filter(c => c.readonly && c.tipo !== 'checkbox' && c.tipo !== 'select' && c.tipo !== 'textarea');
  const mainCampo =
    readonlyCampos.find(c => /total/i.test(c.key + c.label)) ||
    readonlyCampos.find(c => /recaudac/i.test(c.key + c.label)) ||
    readonlyCampos[readonlyCampos.length - 1];
  const mainVal  = mainCampo ? Number(allValues[mainCampo.key] ?? 0) : null;
  const isProfit = mainVal !== null && mainVal > 0;
  const isLoss   = mainVal !== null && mainVal < 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', width: '100%', maxWidth: 380, maxHeight: '80dvh', overflowY: 'auto', padding: '1.25rem', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>Información Cálculo</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}><X size={20} /></button>
        </div>

        {/* ── Tarjeta de profit ── */}
        {mainCampo && mainVal !== null && (
          <div style={{
            borderRadius: 12,
            padding: '0.85rem 1rem',
            marginBottom: '1.1rem',
            background: isProfit ? 'rgba(16,185,129,0.1)' : isLoss ? 'rgba(239,68,68,0.08)' : 'rgba(156,163,175,0.1)',
            border: `1.5px solid ${isProfit ? 'rgba(16,185,129,0.35)' : isLoss ? 'rgba(239,68,68,0.3)' : 'rgba(156,163,175,0.25)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
          }}>
            <div>
              <div style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase', color: isProfit ? '#065f46' : isLoss ? '#991b1b' : 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {isProfit ? 'Con ganancia' : isLoss ? 'Sin ganancia' : 'Resultado neutro'}
              </div>
              <div style={{ fontSize: '1.35rem', fontWeight: 900, color: isProfit ? '#10b981' : isLoss ? '#ef4444' : 'var(--text-muted)', letterSpacing: '-0.5px', lineHeight: 1 }}>
                {fmtNum(mainVal)} <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>Gs.</span>
              </div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                {mainCampo.label}
              </div>
            </div>
            <div style={{
              width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
              background: isProfit ? 'rgba(16,185,129,0.18)' : isLoss ? 'rgba(239,68,68,0.12)' : 'rgba(156,163,175,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {isProfit
                ? <TrendingUp size={24} color="#10b981" strokeWidth={2.5} />
                : isLoss
                ? <TrendingDown size={24} color="#ef4444" strokeWidth={2.5} />
                : <Minus size={24} color="#9ca3af" strokeWidth={2.5} />
              }
            </div>
          </div>
        )}

        {groups.map(grupo => {
          const groupCampos = visibleCampos.filter(c => c.grupo === grupo);
          return (
            <div key={grupo} style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.5rem' }}>
                {grupo}
              </div>
              {groupCampos.map(c => {
                const val = allValues[c.key] ?? 0;
                return <Row key={c.key} label={c.label} value={val} />;
              })}
            </div>
          );
        })}

        <button
          onClick={onClose}
          style={{ width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700 }}
        >
          Ok
        </button>
      </div>
    </div>
  );
}

// ─── RecordForm helpers (defined outside component to avoid focus loss on re-render) ───
function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, readOnly = false, highlight = false, tipo = 'number', opciones = [] }) {
  const borderColor = highlight ? 'var(--primary)' : 'var(--border)';
  const baseStyle = {
    width: '100%', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)',
    border: `1px solid ${borderColor}`,
    background: readOnly ? 'var(--bg-color)' : 'var(--surface)',
    color: highlight ? 'var(--primary)' : 'var(--text-main)',
    fontWeight: highlight ? 700 : 400,
    fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box',
  };

  let input;
  if (readOnly) {
    // readonly always shows as plain text
    input = <input type="text" readOnly value={tipo === 'checkbox' ? (value ? 'Sí' : 'No') : value} style={baseStyle} />;
  } else if (tipo === 'checkbox') {
    input = (
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.4rem 0' }}>
        <input
          type="checkbox"
          checked={!!value}
          onChange={e => onChange({ target: { value: e.target.checked } })}
          style={{ width: 18, height: 18, accentColor: 'var(--primary)', cursor: 'pointer' }}
        />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{value ? 'Sí' : 'No'}</span>
      </label>
    );
  } else if (tipo === 'select') {
    input = (
      <select value={value} onChange={onChange} style={{ ...baseStyle, cursor: 'pointer' }}>
        <option value="">— Seleccionar —</option>
        {opciones.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (tipo === 'textarea') {
    input = (
      <textarea
        value={value} onChange={onChange} rows={3}
        style={{ ...baseStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />
    );
  } else if (tipo === 'date') {
    input = <input type="date" value={value} onChange={onChange} style={baseStyle} />;
  } else {
    // number or text
    input = (
      <input
        type={tipo === 'text' ? 'text' : 'number'}
        value={value} onChange={onChange}
        inputMode={tipo === 'text' ? 'text' : 'numeric'}
        style={baseStyle}
      />
    );
  }

  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>{label}</label>
      {input}
    </div>
  );
}

// ─── RecordForm ───────────────────────────────────────────────────────────────
function RecordForm({ machine, stop, runId, tipos, onSaved, onBack }) {
  // Find campos for this machine's type
  const campos = useMemo(() => {
    if (!tipos || !machine.tmqId) return [];
    return tipos.find(t => t.id === machine.tmqId)?.campos ?? [];
  }, [tipos, machine.tmqId]);

  // User-entered values (non-readonly campos)
  const [values, setValues] = useState({});
  const [lastRecord, setLastRecord] = useState(null);
  const [photos, setPhotos] = useState([null, null, null]);
  const [blobUrls, setBlobUrls] = useState([null, null, null]);
  const blobUrlsRef = useRef([null, null, null]);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [showPreCalc, setShowPreCalc] = useState(false);
  const photoRef0 = useRef(null);
  const photoRef1 = useRef(null);
  const photoRef2 = useRef(null);
  const photoRefs = [photoRef0, photoRef1, photoRef2];

  // Revoca todas las blob URLs al desmontar el componente para evitar memory leaks
  useEffect(() => {
    return () => { blobUrlsRef.current.forEach(url => { if (url) URL.revokeObjectURL(url); }); };
  }, []);

  // Re-init form keys when campos load/change, fetch last record for {prev:key} and usaUltimoRegistro
  useEffect(() => {
    setValues(prev => {
      const next = {};
      campos.filter(c => !c.readonly).forEach(c => {
        const def = c.tipo === 'checkbox' ? false : '';
        next[c.key] = prev[c.key] !== undefined ? prev[c.key] : def;
      });
      return next;
    });
    setLastRecord(null);

    if (machine?.id) {
      getLastRecord(machine.id).then(rec => {
        setLastRecord(rec);
        if (!rec) return;
        const extra = rec.camposExtra ?? {};
        const autoFillCampos = campos.filter(c => !c.readonly && c.usaUltimoRegistro);
        if (autoFillCampos.length === 0) return;
        setValues(prev => {
          const next = { ...prev };
          autoFillCampos.forEach(c => {
            // Only pre-fill if the user hasn't typed anything yet
            if ((prev[c.key] ?? '') === '') {
              const val = extra[c.key];
              if (val !== undefined && val !== null) next[c.key] = String(val);
            }
          });
          return next;
        });
      }).catch(() => null); // silently ignore if no last record
    }
  }, [campos, machine?.id]);

  // Computed (readonly) values — lastRecord.camposExtra enables {prev:key} in formulas
  const computed = useMemo(
    () => computeReadonly(campos, values, lastRecord?.camposExtra ?? {}),
    [campos, values, lastRecord]
  );

  // All values merged (for PreCalcModal and submit)
  const allValues = useMemo(() => ({ ...values, ...computed }), [values, computed]);


  // Validation: all required non-readonly campos must be non-empty (checkbox always passes)
  const isValid = campos.length > 0 && campos.filter(c => c.requerido && !c.readonly).every(c =>
    c.tipo === 'checkbox' ? true : (values[c.key] ?? '') !== ''
  );

  const setVal = (key) => (e) => setValues(v => ({ ...v, [key]: e.target.value }));

  function setPhoto(idx, file) {
    // Revocar la blob URL anterior para liberar memoria
    if (blobUrlsRef.current[idx]) URL.revokeObjectURL(blobUrlsRef.current[idx]);
    const newUrl = file ? URL.createObjectURL(file) : null;
    blobUrlsRef.current = [...blobUrlsRef.current];
    blobUrlsRef.current[idx] = newUrl;
    setBlobUrls([...blobUrlsRef.current]);
    setPhotos(prev => { const p = [...prev]; p[idx] = file; return p; });
  }

  async function handleSave() {
    if (!isValid) { setError('Completá todos los campos obligatorios'); return; }
    setSaving(true); setError('');
    try {
      // Build camposExtra: serialize each campo value by its type
      const camposExtra = {};
      campos.forEach(c => {
        if (c.readonly) {
          camposExtra[c.key] = computed[c.key] ?? 0;
        } else if (c.tipo === 'checkbox') {
          camposExtra[c.key] = values[c.key] ? 1 : 0;
        } else if (c.tipo === 'number') {
          camposExtra[c.key] = parseFloat(values[c.key]) || 0;
        } else {
          camposExtra[c.key] = values[c.key] ?? '';
        }
      });

      const record = await createRecord({
        machine:    machine.id,
        lgrId:      machine.lgrId ?? null,
        rutId:      runId,
        camposExtra,
      });

      for (const photo of photos.filter(Boolean)) {
        await uploadRecordImage(record.id, photo).catch(() => null);
      }

      if (stop && runId) await updateStop(runId, stop.id, 'done');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Constants are hidden — they're reference values only
  const visibleCampos = campos.filter(c => c.tipo !== 'constant');
  const groups = [...new Set(visibleCampos.map(c => c.grupo))];

  if (campos.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '0.5rem', padding: '2rem' }}>
        <AlertCircle size={32} />
        <div style={{ textAlign: 'center', fontSize: '0.9rem' }}>
          {tipos ? 'Este tipo de máquina no tiene campos configurados.' : 'Cargando campos...'}
        </div>
        <button onClick={onBack} style={{ marginTop: '1rem', padding: '0.6rem 1.2rem', borderRadius: 'var(--radius-sm)', background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
          Volver
        </button>
      </div>
    );
  }

  return (
    <>
      {showPreCalc && <PreCalcModal campos={campos} allValues={allValues} onClose={() => setShowPreCalc(false)} />}

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header */}
        <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', flexShrink: 0 }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.4rem', padding: 0 }}>
            <ArrowLeft size={16} /> Volver
          </button>
          <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
            {machine.id} — Nueva Recaudación
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {machine.type} · {machine.location} · {new Date().toLocaleDateString('es-PY')}
          </div>
        </div>

        {/* Form (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>

          {groups.map(grupo => {
            const groupCampos = visibleCampos.filter(c => c.grupo === grupo);
            return (
              <Section key={grupo} title={grupo}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {groupCampos.map(c => {
                    const colSpan = c.ancho === 1 ? 'span 2' : 'span 1';

                    const val = c.readonly ? Math.round(computed[c.key] ?? 0) : (values[c.key] ?? '');
                    return (
                      <div key={c.key} style={{ gridColumn: colSpan }}>
                        <Field
                          label={c.label + (c.requerido && !c.readonly ? ' *' : '')}
                          value={val}
                          onChange={c.readonly ? undefined : setVal(c.key)}
                          readOnly={c.readonly}
                          highlight={c.readonly && (computed[c.key] ?? 0) !== 0}
                          tipo={c.tipo}
                          opciones={c.opciones ?? []}
                        />
                      </div>
                    );
                  })}

                </div>
              </Section>
            );
          })}

          {/* Photo slots */}
          <Section title="Fotos Evidencia (hasta 3)">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              {[0, 1, 2].map(idx => (
                <div key={idx}>
                  <input
                    ref={photoRefs[idx]}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                    onChange={e => setPhoto(idx, e.target.files[0] || null)}
                  />
                  {photos[idx] ? (
                    <div style={{ position: 'relative' }}>
                      <img
                        src={blobUrls[idx]}
                        alt={`foto ${idx + 1}`}
                        onClick={() => photoRefs[idx].current.click()}
                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: '1px solid var(--border)' }}
                      />
                      <button
                        onClick={() => setPhoto(idx, null)}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(239,68,68,0.85)', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      >
                        <X size={11} color="white" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => photoRefs[idx].current.click()}
                      style={{ width: '100%', aspectRatio: '1', border: '2px dashed var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', color: 'var(--text-muted)' }}
                    >
                      <Camera size={18} />
                      <span style={{ fontSize: '0.6rem' }}>Imagen {idx + 1}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.6rem', marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center', color: '#b91c1c', fontSize: '0.8rem' }}>
              <AlertCircle size={15} /> {error}
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{ padding: '0.75rem 1rem', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={() => setShowPreCalc(true)}
            style={{ flex: 1, padding: '0.875rem', borderRadius: 'var(--radius-md)', background: 'var(--bg-color)', border: '1px solid var(--border)', color: 'var(--primary)', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
          >
            <Calculator size={16} /> Pre-Calc.
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isValid}
            style={{
              flex: 2, padding: '0.875rem', borderRadius: 'var(--radius-md)',
              background: isValid ? 'var(--success, #10b981)' : 'var(--border)',
              color: isValid ? 'white' : 'var(--text-muted)',
              border: 'none', cursor: isValid ? 'pointer' : 'not-allowed',
              fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}
          >
            <Save size={18} /> {saving ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── MantencionForm ───────────────────────────────────────────────────────────
function MantencionForm({ machine, runId, onSaved, onBack }) {
  const [descripcion, setDescripcion]   = useState('');
  const [monto, setMonto]               = useState('');
  const [checkedItems, setCheckedItems] = useState([]); // [{ nombre, itemId? }]
  const [customItem, setCustomItem]     = useState('');
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [catalogoGrupos, setCatalogoGrupos] = useState([]); // [{ tipo, items[] }]
  const [loadingCat, setLoadingCat]     = useState(true);

  // Cargar catálogo al montar — excluye tipo "Maquina"
  useEffect(() => {
    (async () => {
      try {
        const [tipos, items] = await Promise.all([getItemTiposCat(), getCatalogo({ todos: false })]);

        // Detecta si un nombre de item corresponde a una máquina (no a un repuesto/electrónico)
        const esMaquinaPorNombre = (nombre) =>
          /^m[aá]quina\b/i.test((nombre || '').trim());

        // IDs de tipos "Maquina" (excluidos — son las máquinas en sí, no repuestos)
        const maquinaIds = new Set(tipos.filter(t => {
          const n = (t.itc_nombre || '').toLowerCase();
          return n === 'maquina' || n === 'máquina';
        }).map(t => t.itc_id));

        // Tipos válidos para mantención (todo excepto Maquina)
        const tiposValidos = tipos.filter(t => !maquinaIds.has(t.itc_id));
        const validCatIds  = new Set(tiposValidos.map(t => t.itc_id));

        // Grupos por tipo con sus items — también excluye items con nombre de máquina
        const grupos = tiposValidos.map(tipo => ({
          tipo: tipo.itc_nombre,
          tipoId: tipo.itc_id,
          items: items.filter(it =>
            it.item_cat_id === tipo.itc_id && !esMaquinaPorNombre(it.item_nombre)
          ),
        })).filter(g => g.items.length > 0);

        // Items sin categoría (ni Maquina ni tipo conocido) y cuyo nombre no sea de máquina → "General"
        const generales = items.filter(it =>
          !maquinaIds.has(it.item_cat_id) &&
          !validCatIds.has(it.item_cat_id) &&
          !esMaquinaPorNombre(it.item_nombre)
        );
        if (generales.length > 0) {
          grupos.push({ tipo: 'General', tipoId: null, items: generales });
        }
        setCatalogoGrupos(grupos);
      } catch {
        setCatalogoGrupos([]);
      } finally {
        setLoadingCat(false);
      }
    })();
  }, []);

  function toggleItem(nombre, itemId) {
    setCheckedItems(prev => {
      const exists = prev.find(i => i.nombre === nombre);
      return exists ? prev.filter(i => i.nombre !== nombre) : [...prev, { nombre, itemId }];
    });
  }

  function isChecked(nombre) {
    return checkedItems.some(i => i.nombre === nombre);
  }

  function addCustomItem() {
    const t = customItem.trim();
    if (!t) return;
    if (!checkedItems.find(i => i.nombre === t)) {
      setCheckedItems(prev => [...prev, { nombre: t, itemId: null }]);
    }
    setCustomItem('');
  }

  async function handleSave() {
    if (!descripcion.trim() && checkedItems.length === 0) {
      setError('Agregá al menos una descripción o producto');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createMaintenance({
        machineId:   machine.id,
        runId:       runId || null,
        descripcion: descripcion.trim() || 'Mantención en ruta',
        monto:       parseFloat(monto) || 0,
        items:       checkedItems.map(i => i.nombre),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.4rem', padding: 0 }}>
          <ArrowLeft size={16} /> Volver
        </button>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>Mantención Máquina</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Máquina: {machine.id} — {machine.location} &nbsp;·&nbsp; {new Date().toLocaleDateString('es-PY')}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem' }}>

        {/* Productos de la máquina */}
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ClipboardList size={13} /> Lista de Productos / Repuestos
          </div>
          {loadingCat ? (
            <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Cargando productos...
            </div>
          ) : catalogoGrupos.length > 0 ? (
            catalogoGrupos.map(grupo => (
              <div key={grupo.tipo} style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.4rem', paddingLeft: '0.25rem' }}>
                  {grupo.tipo}
                </div>
                {grupo.items.map(item => {
                  const sinStock = (item.item_stock ?? 0) <= 0;
                  const checked  = isChecked(item.item_nombre);
                  return (
                    <button
                      key={item.item_id}
                      onClick={() => { if (!sinStock) toggleItem(item.item_nombre, item.item_id); }}
                      disabled={sinStock}
                      title={sinStock ? 'Sin stock — no disponible para usar' : undefined}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                        padding: '0.55rem 0.75rem', marginBottom: '0.35rem',
                        borderRadius: 'var(--radius-sm)',
                        border: `1px solid ${checked ? 'rgba(79,70,229,0.5)' : sinStock ? 'rgba(156,163,175,0.25)' : 'var(--border)'}`,
                        background: checked ? 'rgba(79,70,229,0.08)' : sinStock ? 'var(--bg-color)' : 'var(--bg-color)',
                        cursor: sinStock ? 'not-allowed' : 'pointer',
                        textAlign: 'left',
                        opacity: sinStock ? 0.45 : 1,
                        pointerEvents: sinStock ? 'none' : 'auto',
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                        border: `2px solid ${checked ? 'var(--primary)' : sinStock ? '#d1d5db' : 'var(--border)'}`,
                        background: checked ? 'var(--primary)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <CheckCircle size={10} color="white" />}
                      </div>
                      <span style={{ flex: 1, fontSize: '0.85rem', color: sinStock ? 'var(--text-muted)' : checked ? 'var(--primary)' : 'var(--text-main)', fontWeight: checked ? 600 : 400 }}>
                        {item.item_nombre}
                      </span>
                      {sinStock ? (
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#9ca3af', background: 'rgba(156,163,175,0.12)', border: '1px solid rgba(156,163,175,0.25)', borderRadius: 4, padding: '0.1rem 0.4rem', whiteSpace: 'nowrap' }}>
                          Sin stock
                        </span>
                      ) : (
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#059669', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 4, padding: '0.1rem 0.4rem', whiteSpace: 'nowrap' }}>
                          {item.item_stock} unid.
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.75rem', lineHeight: 1.5 }}>
              No hay productos en el catálogo.<br />
              Agregá productos en Electrónico u Otros desde el panel de administración.
            </div>
          )}

          {/* Custom item */}
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              type="text"
              placeholder="Otro producto..."
              value={customItem}
              maxLength={200}
              onChange={e => setCustomItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomItem()}
              style={{ flex: 1, padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
            />
            <button onClick={addCustomItem} style={{ padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79,70,229,0.4)', background: 'rgba(79,70,229,0.08)', color: 'var(--primary)', cursor: 'pointer' }}>
              <Plus size={16} />
            </button>
          </div>

          {/* Items personalizados (sin itemId) seleccionados manualmente */}
          {checkedItems.filter(i => i.itemId === null).map(item => (
            <div key={item.nombre} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', padding: '0.45rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79,70,229,0.5)', background: 'rgba(79,70,229,0.08)' }}>
              <CheckCircle size={14} color="var(--primary)" />
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>{item.nombre}</span>
              <button onClick={() => toggleItem(item.nombre, null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 0, display: 'flex' }}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {/* Descripción */}
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
            Descripción / Observaciones
          </div>
          <textarea
            rows={3}
            placeholder="Describí el trabajo realizado..."
            maxLength={500}
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Monto */}
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.6rem' }}>
            Monto gasto (opcional, Gs.)
          </div>
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            style={{ width: '100%', padding: '0.5rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.6rem', marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center', color: '#b91c1c', fontSize: '0.8rem' }}>
            <AlertCircle size={15} /> {error}
          </div>
        )}
      </div>

      {/* Save */}
      <div style={{ padding: '0.75rem 1rem', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ width: '100%', padding: '0.875rem', borderRadius: 'var(--radius-md)', background: '#f59e0b', color: 'white', border: 'none', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          <Wrench size={18} /> {saving ? 'Guardando...' : 'Registrar Mantención'}
        </button>
      </div>
    </div>
  );
}

// ─── StopActionView ───────────────────────────────────────────────────────────
function StopActionView({ stop, machine, onRecaudacion, onMantencion, onBack }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.4rem', padding: 0 }}>
          <ArrowLeft size={16} /> Volver
        </button>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>Bienvenido</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
          {machine.id} · {machine.type} · {machine.location}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem', gap: '1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Seleccioná la acción a realizar en esta máquina
        </div>

        <button
          onClick={onRecaudacion}
          style={{
            width: '100%', padding: '1.25rem', borderRadius: 'var(--radius-md)',
            background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: '1.05rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
            boxShadow: '0 4px 14px rgba(79,70,229,0.4)',
          }}
        >
          <Save size={22} /> Recaudación
        </button>

        <button
          onClick={onMantencion}
          style={{
            width: '100%', padding: '1.25rem', borderRadius: 'var(--radius-md)',
            background: '#f59e0b', color: 'white', border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: '1.05rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
            boxShadow: '0 4px 14px rgba(245,158,11,0.4)',
          }}
        >
          <Wrench size={22} /> Mantención
        </button>
      </div>
    </div>
  );
}

// ─── Google Maps URL helpers ─────────────────────────────────────────────────

/** Abre navegación a una sola coordenada */
function openNavToStop(coords) {
  const [lat, lng] = coords;
  // En móvil abre la app de Google Maps; en desktop abre el sitio
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`, '_blank');
}

/** Construye URL de ruta completa con todos los stops que tienen coords.
 *  Google Maps acepta hasta 10 waypoints intermedios vía ?api=1 (sin key).
 *  Con más de 12 paradas con coords se trunca para no exceder el límite.  */
function buildFullRouteUrl(stops, machines) {
  const withCoords = stops
    .map(s => ({ stop: s, machine: machines.find(m => m.id === s.machineId) }))
    .filter(({ machine }) => machine?.coords);

  if (withCoords.length < 2) return null;

  const MAX_WAYPOINTS = 8; // origin + 8 wpts + destination = 10 total (límite GM sin API key)
  const origin      = withCoords[0].machine.coords;
  const destination = withCoords[withCoords.length - 1].machine.coords;
  const middle      = withCoords.slice(1, -1);

  // Seleccionar waypoints representativos si hay demasiados
  const step = middle.length > MAX_WAYPOINTS
    ? Math.ceil(middle.length / MAX_WAYPOINTS)
    : 1;
  const waypoints = middle
    .filter((_, i) => i % step === 0)
    .slice(0, MAX_WAYPOINTS)
    .map(({ machine }) => machine.coords.join(','))
    .join('|');

  const base = 'https://www.google.com/maps/dir/?api=1';
  const params = new URLSearchParams({
    origin:      origin.join(','),
    destination: destination.join(','),
    travelmode:  'driving',
  });
  const url = `${base}&${params}${waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : ''}`;
  return url;
}

// ─── QRScannerModal ───────────────────────────────────────────────────────────
function QRScannerModal({ onScan, onClose }) {
  const containerId = 'qr-scanner-container';
  const scannerRef  = useRef(null);
  const [error, setError]   = useState('');
  const [active, setActive] = useState(false);

  useEffect(() => {
    let qr;
    (async () => {
      try {
        qr = new Html5Qrcode(containerId);
        scannerRef.current = qr;
        await qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 230, height: 230 } },
          (text) => {
            qr.stop().catch(() => null);
            onScan(text.trim());
          },
          () => {}
        );
        setActive(true);
      } catch (e) {
        setError('No se pudo acceder a la cámara. Verificá los permisos.');
      }
    })();
    return () => {
      scannerRef.current?.stop().catch(() => null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)', width: '100%', maxWidth: 360, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 700, fontSize: '0.95rem' }}>
            <QrCode size={18} color="var(--primary)" /> Escanear QR de Máquina
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
            <X size={20} />
          </button>
        </div>

        {/* Scanner area */}
        <div style={{ padding: '1rem' }}>
          {error ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#b91c1c', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={28} />
              <span>{error}</span>
            </div>
          ) : (
            <>
              <div id={containerId} style={{ width: '100%', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: '#000' }} />
              {!active && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  Iniciando cámara...
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ padding: '0.5rem 1rem 1rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Apuntá la cámara al código QR pegado en la máquina
        </div>
      </div>
    </div>
  );
}

// ─── MachineSearchModal ───────────────────────────────────────────────────────
function MachineSearchModal({ machines, activeRun, onSelect, onScanQR, onClose }) {
  const [query, setQuery] = useState('');
  const stops = activeRun?.stops ?? [];
  const q = query.toLowerCase().trim();

  const filtered = machines.filter(m =>
    !q ||
    m.id.toLowerCase().includes(q) ||
    (m.location ?? '').toLowerCase().includes(q) ||
    (m.type ?? '').toLowerCase().includes(q)
  );

  const inRoute    = filtered.filter(m => stops.some(s => s.machineId === m.id));
  const outOfRoute = filtered.filter(m => !stops.some(s => s.machineId === m.id));

  function stopStatus(machineId) {
    return stops.find(s => s.machineId === machineId)?.status ?? 'pending';
  }

  const statusBadge = (status) => {
    const cfg = {
      done:    { bg: 'rgba(16,185,129,0.12)', color: '#065f46', label: 'Completada' },
      failed:  { bg: 'rgba(239,68,68,0.1)',   color: '#b91c1c', label: 'Saltada'    },
      pending: { bg: 'rgba(79,70,229,0.1)',   color: '#4338ca', label: 'Pendiente'  },
    };
    const { bg, color, label } = cfg[status] ?? cfg.pending;
    return (
      <span style={{ fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: bg, color }}>
        {label}
      </span>
    );
  };

  const MachineRow = ({ m, inRun }) => {
    const status = inRun ? stopStatus(m.id) : null;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.7rem 0.75rem',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${inRun ? 'rgba(79,70,229,0.2)' : 'var(--border)'}`,
        background: inRun ? 'rgba(79,70,229,0.03)' : 'var(--surface)',
        marginBottom: '0.4rem',
      }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, background: inRun ? '#eef2ff' : 'var(--bg-color)', border: `1px solid ${inRun ? '#a5b4fc' : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MapPin size={15} color={inRun ? '#4f46e5' : 'var(--text-muted)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.id}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.location} · {m.type}
          </div>
        </div>
        {inRun
          ? <button
              onClick={() => onSelect(m)}
              style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.2rem', background: 'none', border: 'none', cursor: 'pointer', padding: '0.2rem' }}
            >
              {statusBadge(status)}
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Ver →</span>
            </button>
          : <button
              onClick={() => onSelect(m)}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.75rem', borderRadius: 'var(--radius-sm)', background: '#4f46e5', color: 'white', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, boxShadow: '0 2px 8px rgba(79,70,229,0.3)' }}
            >
              <Plus size={14} /> Agregar
            </button>
        }
      </div>
    );
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9000, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Tap outside to close */}
      <div style={{ flex: 1 }} onClick={onClose} />

      <div style={{ background: 'var(--surface)', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85dvh', display: 'flex', flexDirection: 'column', boxShadow: '0 -8px 40px rgba(0,0,0,0.2)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {/* Header */}
        <div style={{ padding: '1rem 1rem 0.5rem', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', margin: '0 auto 0.75rem' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>Agregar Máquina</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Buscá o escaneá una máquina para registrar</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem' }}>
              <X size={20} />
            </button>
          </div>

          {/* Búsqueda + QR */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={15} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input
                autoFocus
                type="text"
                placeholder="ID, ubicación o tipo..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ width: '100%', padding: '0.55rem 0.6rem 0.55rem 2rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.88rem', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <button
              onClick={onScanQR}
              style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.55rem 0.75rem', borderRadius: 'var(--radius-sm)', background: 'rgba(79,70,229,0.08)', border: '1px solid rgba(79,70,229,0.3)', color: 'var(--primary)', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}
            >
              <QrCode size={15} /> QR
            </button>
          </div>
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 1rem 1rem' }}>
          {/* En tu ruta */}
          {inRoute.length > 0 && (
            <>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem', marginTop: '0.25rem' }}>
                En tu ruta ({inRoute.length})
              </div>
              {inRoute.map(m => <MachineRow key={m.id} m={m} inRun={true} />)}
            </>
          )}

          {/* Otras máquinas */}
          {outOfRoute.length > 0 && (
            <>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.4rem', marginTop: inRoute.length > 0 ? '0.75rem' : '0.25rem' }}>
                Otras disponibles ({outOfRoute.length})
              </div>
              {outOfRoute.map(m => <MachineRow key={m.id} m={m} inRun={false} />)}
            </>
          )}

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-muted)' }}>
              <Search size={30} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
              <div style={{ fontSize: '0.85rem' }}>Sin resultados para "{query}"</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StopQR: muestra el QR de la máquina con modal para ampliar ──────────────
function StopQR({ machineId, onAction, isDone, isFailed }) {
  const [expanded, setExpanded] = useState(false);

  const canRegister = onAction && !isDone && !isFailed;

  return (
    <>
      {/* QR pequeño inline — toca para ampliar */}
      <div
        onClick={() => setExpanded(true)}
        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.5rem', padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', background: 'var(--bg-color)', border: '1px solid var(--border)', cursor: 'pointer' }}
        title="Tocar para ver QR grande"
      >
        <QRCodeSVG value={`${window.location.origin}/scan/${encodeURIComponent(machineId)}`} size={52} level="M" />
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>QR Máquina</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.5px' }}>{machineId}</div>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1 }}>
            {canRegister ? 'Tocá para ampliar y registrar' : 'Toca para ampliar'}
          </div>
        </div>
      </div>

      {/* Modal QR grande */}
      {expanded && (
        <div
          onClick={() => setExpanded(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1.5rem' }}
        >
          {/* Tarjeta blanca con QR */}
          <div style={{ background:'var(--surface)', borderRadius: 20, padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
            <QRCodeSVG value={`${window.location.origin}/scan/${encodeURIComponent(machineId)}`} size={220} level="H" />
            <div style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '1px', color: '#111' }}>{machineId}</div>
          </div>

          {/* Botón de acción directo — solo si la parada está pendiente */}
          {canRegister && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(false); onAction(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.55rem',
                padding: '0.95rem 2.5rem', borderRadius: 16,
                background: '#4f46e5', color: 'white', border: 'none',
                cursor: 'pointer', fontWeight: 800, fontSize: '1.05rem',
                boxShadow: '0 6px 20px rgba(79,70,229,0.55)',
                letterSpacing: '0.01em',
              }}
            >
              <ClipboardList size={20} /> Recaudación / Mantención
            </button>
          )}

          {/* Estado si ya fue registrada */}
          {isDone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem 1.5rem', borderRadius: 12, background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.5)', color: '#d1fae5', fontWeight: 700, fontSize: '0.88rem' }}>
              <CheckCircle size={17} /> Parada ya registrada
            </div>
          )}
          {isFailed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.65rem 1.5rem', borderRadius: 12, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.45)', color: '#fecaca', fontWeight: 700, fontSize: '0.88rem' }}>
              <XCircle size={17} /> Parada marcada como saltada
            </div>
          )}

          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.78rem', marginTop: '0.25rem' }}>Toca el fondo para cerrar</div>
        </div>
      )}
    </>
  );
}

// ─── StopList (En Ruta) ──────────────────────────────────────────────────────
function StopList({ run, machines, onAction, onSkip, onFinish, onScanQR, onVerMapa, onAgregarMaquina, finishing }) {
  const stops           = run.stops ?? [];
  const firstPendingIdx = stops.findIndex(s => s.status === 'pending');
  const allHandled      = stops.every(s => s.status !== 'pending');
  const fullRouteUrl    = buildFullRouteUrl(stops, machines);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.65rem 1rem', flexShrink: 0 }}>
        {/* Fila título + botones */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Ruta en curso</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>
              {stops.filter(s => s.status === 'done').length} / {stops.length} paradas completadas
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
            {/* Ver Mapa */}
            {onVerMapa && (
              <button
                onClick={onVerMapa}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.42rem 0.65rem', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary)', color: 'white', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 6px rgba(79,70,229,0.35)', whiteSpace: 'nowrap' }}
              >
                <MapPin size={13} /> Mapa del recorrido
              </button>
            )}
            {/* Agregar máquina */}
            <button
              onClick={onAgregarMaquina}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.42rem 0.65rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              <Plus size={13} /> Agregar máquina
            </button>
            {/* Cancelar / Finalizar */}
            <button
              onClick={onFinish}
              disabled={finishing}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.42rem 0.65rem', borderRadius: 'var(--radius-sm)', border: 'none', background: finishing ? '#9ca3af' : allHandled ? '#10b981' : '#ef4444', color: 'white', fontSize: '0.75rem', fontWeight: 700, cursor: finishing ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: finishing ? 0.7 : 1 }}
            >
              {allHandled ? <CheckCircle size={13} /> : <XCircle size={13} />}
              {finishing ? 'Guardando…' : allHandled ? 'Finalizar Ruta' : 'Cancelar Ruta'}
            </button>
          </div>
        </div>
      </div>

      {/* Stop list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
        {allHandled ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <CheckCircle size={40} color="#10b981" style={{ marginBottom: '0.5rem' }} />
            <div style={{ fontWeight: 700, color: '#10b981', marginBottom: '0.25rem' }}>¡Todas las paradas completadas!</div>
            <div style={{ fontSize: '0.8rem' }}>Podés finalizar la ruta.</div>
          </div>
        ) : (
          stops.map((stop, i) => {
            const machine  = machines.find(m => m.id === stop.machineId);
            const isNext   = i === firstPendingIdx;
            const isDone   = stop.status === 'done';
            const isFailed = stop.status === 'failed';

            return (
              <div key={stop.id} style={{
                border: `1px solid ${isDone ? 'rgba(16,185,129,0.3)' : isFailed ? 'rgba(239,68,68,0.2)' : isNext ? 'rgba(79,70,229,0.4)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '0.875rem',
                marginBottom: '0.5rem',
                background: isDone ? 'rgba(16,185,129,0.04)' : isFailed ? 'rgba(239,68,68,0.04)' : isNext ? 'rgba(79,70,229,0.04)' : 'var(--surface)',
                opacity: isFailed ? 0.65 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: isDone ? '#10b981' : isFailed ? '#ef4444' : isNext ? '#4f46e5' : '#9ca3af',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: '0.72rem', fontWeight: 700,
                  }}>{i + 1}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: isFailed ? 'line-through' : 'none' }}>
                      {machine?.location ?? stop.machineId}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{stop.machineId} · {machine?.type ?? ''}</div>
                  </div>
                  {isDone   && <CheckCircle size={18} color="#10b981" />}
                  {isFailed && <XCircle size={18} color="#ef4444" />}
                  {isNext   && <MapPin size={18} color="#4f46e5" />}
                </div>

                {/* QR de la máquina — visible en todas las paradas */}
                {machine && (
                  <StopQR
                    machineId={stop.machineId}
                    onAction={() => onAction(stop, machine)}
                    isDone={isDone}
                    isFailed={isFailed}
                  />
                )}

                {/* Botón de navegación — solo en la siguiente parada */}
                {isNext && machine?.coords && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${machine.coords[0]},${machine.coords[1]}&travelmode=driving`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', background: '#1a73e8', color: 'white', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 700 }}
                    >
                      <Navigation size={14} /> Navegar en Maps
                    </a>
                  </div>
                )}

                {/* Botones de acción — solo en paradas pendientes (o fallidas para reintentar) */}
                {!isDone && (
                  <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.55rem' }}>
                    <button
                      onClick={() => onAction(stop, machine)}
                      style={{ flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: 'none', background: isNext ? '#4f46e5' : '#6b7280', color: 'white', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
                    >
                      <ClipboardList size={13} /> Registrar
                    </button>
                    {stop.status === 'pending' && (
                      <button
                        onClick={() => onSkip(stop)}
                        style={{ padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid #fca5a5', background: 'rgba(239,68,68,0.08)', color: '#dc2626', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}
                      >
                        <XCircle size={13} /> Saltar
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

// ─── HistoryView ─────────────────────────────────────────────────────────────
function HistoryView({ completedRuns }) {
  const [filtro, setFiltro]   = useState('todos');   // 'todos' | 'completado' | 'cancelado'
  const [busqueda, setBusqueda] = useState('');

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  }

  const filtrados = useMemo(() => {
    let lista = completedRuns;
    if (filtro === 'completado') lista = lista.filter(r => r.status === 'completed');
    if (filtro === 'cancelado')  lista = lista.filter(r => r.status !== 'completed');
    const q = busqueda.trim().toLowerCase();
    if (q) lista = lista.filter(r => String(r.id).includes(q) || fmtDate(r.completedAt).toLowerCase().includes(q));
    return lista;
  }, [completedRuns, filtro, busqueda]);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
      {/* Header + controles */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
          Historial de Recorridos
          <span style={{ fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 6 }}>
            {filtrados.length} de {completedRuns.length}
          </span>
        </div>
        <input
          className="input"
          placeholder="Buscar por ID o fecha..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          style={{ marginBottom: '0.5rem', fontSize: '0.82rem' }}
        />
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[['todos','Todos'],['completado','Completados'],['cancelado','Cancelados']].map(([val, lbl]) => (
            <button key={val} type="button"
              onClick={() => setFiltro(val)}
              style={{
                padding: '0.3rem 0.7rem', borderRadius: 999, border: 'none', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 700,
                background: filtro === val ? 'var(--primary)' : 'var(--bg-secondary)',
                color: filtro === val ? 'white' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {filtrados.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <History size={38} style={{ marginBottom: '0.6rem', opacity: 0.3 }} />
          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>
            {completedRuns.length === 0 ? 'Sin recorridos completados' : 'Sin resultados para el filtro'}
          </div>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>
            {completedRuns.length === 0 ? 'Los recorridos finalizados aparecerán aquí.' : 'Probá con otro término o filtro.'}
          </div>
        </div>
      )}

      {filtrados.map(run => {
        const isCompleted = run.status === 'completed';
        const doneCount   = run.doneCount  ?? (run.stops ?? []).filter(s => s.status === 'done').length;
        const failCount   = run.failedCount ?? (run.stops ?? []).filter(s => s.status === 'failed').length;
        const total       = (run.stops ?? []).length;

        return (
          <div key={run.id} style={{
            background: 'var(--surface)',
            border: `1px solid ${isCompleted ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.2)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '0.9rem',
            marginBottom: '0.6rem',
            boxShadow: isCompleted ? '0 2px 8px rgba(16,185,129,0.06)' : '0 2px 8px rgba(239,68,68,0.05)',
          }}>
            {/* Encabezado */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                  background: isCompleted ? '#d1fae5' : '#fee2e2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isCompleted
                    ? <CheckCircle size={17} color="#10b981" />
                    : <XCircle    size={17} color="#ef4444" />}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                    Recorrido #{run.id}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                    {fmtDate(run.completedAt)}
                  </div>
                </div>
              </div>
              <span style={{
                fontSize: '0.62rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999, flexShrink: 0,
                background: isCompleted ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.1)',
                color: isCompleted ? '#065f46' : '#b91c1c',
                border: `1px solid ${isCompleted ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                {isCompleted ? 'COMPLETADO' : 'CANCELADO'}
              </span>
            </div>

            {/* Métricas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem', marginBottom: run.totalRecaudado > 0 ? '0.6rem' : 0 }}>
              <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Paradas</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-main)' }}>{total}</div>
              </div>
              <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Hechas</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#10b981' }}>{doneCount}</div>
              </div>
              <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', padding: '0.4rem 0.5rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>
                  {run.duration != null ? 'Duración' : 'Saltadas'}
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: run.duration != null ? '#4f46e5' : (failCount > 0 ? '#ef4444' : 'var(--text-main)') }}>
                  {run.duration != null ? `${run.duration} min` : failCount}
                </div>
              </div>
            </div>

            {/* Total recaudado */}
            {run.totalRecaudado > 0 && (
              <div style={{ background: '#f0fdf4', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius-sm)', padding: '0.45rem 0.65rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: '#065f46', fontWeight: 600 }}>Total recaudado</span>
                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#065f46' }}>
                  Gs. {fmt(run.totalRecaudado)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CompletedView ────────────────────────────────────────────────────────────
function CompletedView({ runInfo, onGoHome, onGoHistory }) {
  if (!runInfo) return null;
  const stops      = runInfo.stops ?? [];
  const doneCount  = stops.filter(s => s.status === 'done').length;
  const failCount  = stops.filter(s => s.status === 'failed').length;
  const isCompleted = runInfo.finalStatus === 'completed';

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '2.5rem 1.5rem', textAlign: 'center',
      background: 'var(--bg-color)', overflowY: 'auto',
    }}>
      {/* Ícono central */}
      <div style={{
        width: 110, height: 110, borderRadius: '50%',
        background: isCompleted ? '#d1fae5' : '#fee2e2',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '1.75rem',
        boxShadow: isCompleted
          ? '0 0 0 18px rgba(16,185,129,0.1), 0 0 0 36px rgba(16,185,129,0.05)'
          : '0 0 0 18px rgba(239,68,68,0.1), 0 0 0 36px rgba(239,68,68,0.05)',
      }}>
        {isCompleted
          ? <CheckCircle size={56} color="#10b981" />
          : <XCircle    size={56} color="#ef4444" />}
      </div>

      {/* Título */}
      <div style={{
        fontWeight: 800, fontSize: '1.6rem', marginBottom: '0.4rem',
        color: isCompleted ? '#065f46' : '#7f1d1d',
        letterSpacing: '-0.3px',
      }}>
        {isCompleted ? '¡Recorrido completado!' : 'Recorrido cancelado'}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '2.25rem', fontWeight: 500 }}>
        Recorrido #{runInfo.id}
      </div>

      {/* Tarjetas de estadísticas */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2.5rem', width: '100%', maxWidth: 320 }}>
        <div style={{
          flex: 1, background: '#d1fae5', borderRadius: 14, padding: '1rem 0.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
        }}>
          <CheckCircle size={22} color="#10b981" />
          <div style={{ fontWeight: 800, fontSize: '1.5rem', color: '#065f46', lineHeight: 1 }}>{doneCount}</div>
          <div style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Completadas</div>
        </div>
        <div style={{
          flex: 1, background: failCount > 0 ? '#fee2e2' : '#f3f4f6', borderRadius: 14, padding: '1rem 0.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
        }}>
          <XCircle size={22} color={failCount > 0 ? '#ef4444' : '#9ca3af'} />
          <div style={{ fontWeight: 800, fontSize: '1.5rem', color: failCount > 0 ? '#7f1d1d' : '#6b7280', lineHeight: 1 }}>{failCount}</div>
          <div style={{ fontSize: '0.7rem', color: failCount > 0 ? '#b91c1c' : '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Saltadas</div>
        </div>
        <div style={{
          flex: 1, background: '#ede9fe', borderRadius: 14, padding: '1rem 0.5rem',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem',
        }}>
          <ClipboardCheck size={22} color="#7c3aed" />
          <div style={{ fontWeight: 800, fontSize: '1.5rem', color: '#4c1d95', lineHeight: 1 }}>{stops.length}</div>
          <div style={{ fontSize: '0.7rem', color: '#6d28d9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Total</div>
        </div>
      </div>

      {/* Botones */}
      <button
        onClick={onGoHistory}
        style={{
          width: '100%', maxWidth: 320, padding: '0.95rem', borderRadius: 14,
          background: 'var(--primary)', color: 'white', border: 'none',
          fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer', marginBottom: '0.75rem',
          boxShadow: '0 4px 14px rgba(79,70,229,0.35)',
        }}
      >
        <History size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Ver en historial
      </button>
      <button
        onClick={onGoHome}
        style={{
          width: '100%', maxWidth: 320, padding: '0.9rem', borderRadius: 14,
          background: 'var(--surface)', color: 'var(--text-main)',
          border: '1px solid var(--border)',
          fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
        }}
      >
        Ir al inicio
      </button>
    </div>
  );
}

// ─── TareasView ──────────────────────────────────────────────────────────────
function TareasView({ tareas, loading, onAceptar, onRefresh }) {
  const [aceptando, setAceptando] = React.useState(null); // runId en proceso
  const [errorAceptar, setErrorAceptar] = React.useState(''); // error inline (no alert)

  async function handleAceptar(run) {
    setAceptando(run.id);
    setErrorAceptar('');
    try {
      const runActivo = await aceptarRecorrido(run.id);
      onAceptar(runActivo);
    } catch (e) {
      setErrorAceptar(e.message || 'Error al aceptar el recorrido. Intentá de nuevo.');
    } finally {
      setAceptando(null);
    }
  }

  const pendientes = tareas.filter(t => t.status === 'pending');
  const activos    = tareas.filter(t => t.status === 'active');

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', padding: '0 0.25rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1rem' }}>Mis Tareas</div>
        <button onClick={onRefresh} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.2rem', display: 'flex' }}>
          <Route size={16} />
        </button>
      </div>

      {errorAceptar && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#b91c1c' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} /> {errorAceptar}
          <button onClick={() => setErrorAceptar('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', padding: 0, display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <Route size={28} style={{ marginBottom: '0.5rem', opacity: 0.4 }} />
          <div>Cargando tareas…</div>
        </div>
      ) : tareas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          <CheckCircle size={36} style={{ marginBottom: '0.5rem', opacity: 0.35 }} />
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Sin tareas pendientes</div>
          <div style={{ fontSize: '0.78rem' }}>El administrador te asignará recorridos desde el panel.</div>
        </div>
      ) : (
        <>
          {/* Tareas pendientes de aceptación */}
          {pendientes.length > 0 && (
            <>
              <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem', padding: '0 0.25rem' }}>
                Pendientes de aceptación
              </div>
              {pendientes.map(run => (
                <div key={run.id} style={{
                  background: 'var(--surface)', border: '1px solid rgba(251,146,60,0.4)',
                  borderRadius: 'var(--radius-md)', padding: '0.9rem', marginBottom: '0.6rem',
                  boxShadow: '0 2px 10px rgba(251,146,60,0.1)',
                }}>
                  {/* Cabecera */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fff7ed', border: '2px solid #fdba74', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Bell size={16} color="#ea580c" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-main)' }}>
                        Recorrido #{run.id}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#ea580c', fontWeight: 600 }}>
                        Nuevo · {run.stops?.length ?? 0} paradas asignadas
                      </div>
                    </div>
                    <span style={{ fontSize: '0.65rem', background: '#fff7ed', color: '#ea580c', border: '1px solid #fdba74', borderRadius: 999, padding: '2px 8px', fontWeight: 700, flexShrink: 0 }}>
                      PENDIENTE
                    </span>
                  </div>

                  {/* Lista de ubicaciones */}
                  <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.6rem', marginBottom: '0.7rem', maxHeight: 120, overflowY: 'auto' }}>
                    {(run.stops ?? []).map((s, i) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.2rem 0', fontSize: '0.78rem', color: 'var(--text-main)', borderBottom: i < run.stops.length - 1 ? '1px dashed var(--border)' : 'none' }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                        <MapPin size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.location ?? s.machineId}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Botón aceptar */}
                  <button
                    onClick={() => handleAceptar(run)}
                    disabled={aceptando === run.id}
                    style={{
                      width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-sm)',
                      background: aceptando === run.id ? '#d1d5db' : '#16a34a',
                      color: 'white', border: 'none',
                      cursor: aceptando === run.id ? 'not-allowed' : 'pointer',
                      fontWeight: 700, fontSize: '0.9rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                    }}
                  >
                    {aceptando === run.id
                      ? <><Route size={16} /> Aceptando…</>
                      : <><CheckCircle size={16} /> Aceptar y comenzar recorrido</>
                    }
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Tareas ya aceptadas (activas) → redirigir al módulo Ruta */}
          {activos.length > 0 && (
            <>
              <div style={{ fontSize: '0.68rem', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.5rem', marginTop: pendientes.length > 0 ? '1rem' : 0, padding: '0 0.25rem' }}>
                En curso
              </div>
              {activos.map(run => (
                <div key={run.id} style={{
                  background: '#eef2ff', border: '1px solid rgba(79,70,229,0.25)',
                  borderRadius: 'var(--radius-md)', padding: '0.85rem 1rem', marginBottom: '0.6rem',
                  display: 'flex', alignItems: 'center', gap: '0.65rem',
                }}>
                  <Route size={20} color="#4f46e5" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#3730a3' }}>
                      Recorrido #{run.id} en curso
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#4f46e5' }}>
                      Revisá la pestaña <b>Ruta</b> para continuar
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── HomeView ────────────────────────────────────────────────────────────────
function HomeView({ activeRun, onEmpezarRuta, userNombre, todayRecords }) {
  const today = new Date().toLocaleDateString('es-PY', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const stops      = activeRun?.stops ?? [];
  const doneCount  = stops.filter(s => s.status === 'done').length;
  const totalCount = stops.length;
  const progress   = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const notStarted = doneCount === 0;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>

      {/* Saludo + fecha */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-main)' }}>Hola, {userNombre || 'Recaudador'} 👋</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem', textTransform: 'capitalize' }}>{today}</div>
        {todayRecords?.length > 0 && (
          <div style={{ marginTop: '0.4rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
            <CheckCircle size={11} />
            {todayRecords.length} registro{todayRecords.length !== 1 ? 's' : ''} hoy
          </div>
        )}
      </div>

      {activeRun ? (
        /* ── Recorrido asignado: detalles + botón empezar/continuar ── */
        <div style={{
          background: 'var(--surface)', border: '1px solid rgba(79,70,229,0.3)',
          borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem',
          boxShadow: '0 2px 10px rgba(79,70,229,0.08)',
        }}>
          {/* Cabecera del recorrido */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#eef2ff', border: '2px solid #a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Route size={19} color="#4f46e5" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
                Recorrido #{activeRun.id}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#4f46e5', fontWeight: 600 }}>
                {notStarted
                  ? `${totalCount} parada${totalCount !== 1 ? 's' : ''} asignada${totalCount !== 1 ? 's' : ''}`
                  : `${doneCount} de ${totalCount} paradas completadas`}
              </div>
            </div>
            <span style={{
              fontSize: '0.62rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999,
              background: notStarted ? '#fff7ed' : '#eef2ff',
              color: notStarted ? '#ea580c' : '#4f46e5',
              border: `1px solid ${notStarted ? '#fdba74' : '#a5b4fc'}`,
              flexShrink: 0,
            }}>
              {notStarted ? 'PENDIENTE' : 'EN CURSO'}
            </span>
          </div>

          {/* Lista de paradas (primeras 4 + "y N más") */}
          <div style={{ background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)', padding: '0.5rem 0.65rem', marginBottom: '0.85rem' }}>
            {stops.slice(0, 4).map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.22rem 0', fontSize: '0.78rem', color: s.status === 'done' ? '#10b981' : s.status === 'failed' ? '#ef4444' : 'var(--text-main)', borderBottom: i < Math.min(stops.length, 4) - 1 ? '1px dashed var(--border)' : 'none' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: s.status === 'done' ? '#d1fae5' : s.status === 'failed' ? '#fee2e2' : '#e0e7ff', color: s.status === 'done' ? '#065f46' : s.status === 'failed' ? '#b91c1c' : '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.58rem', fontWeight: 800, flexShrink: 0 }}>{i + 1}</div>
                <MapPin size={10} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {s.location ?? s.machineId}
                </span>
                {s.status === 'done' && <CheckCircle size={12} color="#10b981" style={{ flexShrink: 0 }} />}
                {s.status === 'failed' && <XCircle size={12} color="#ef4444" style={{ flexShrink: 0 }} />}
              </div>
            ))}
            {stops.length > 4 && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', paddingTop: '0.3rem', fontStyle: 'italic' }}>
                y {stops.length - 4} parada{stops.length - 4 !== 1 ? 's' : ''} más…
              </div>
            )}
          </div>

          {/* Barra de progreso (solo si ya empezó) */}
          {!notStarted && (
            <div style={{ height: 5, background: '#e0e7ff', borderRadius: 999, overflow: 'hidden', marginBottom: '0.7rem' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#4f46e5', borderRadius: 999, transition: 'width 0.4s' }} />
            </div>
          )}

          {/* Botón principal */}
          <button
            onClick={onEmpezarRuta}
            style={{
              width: '100%', padding: '0.85rem', borderRadius: 'var(--radius-md)',
              background: notStarted ? '#16a34a' : '#4f46e5',
              color: 'white', border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: '0.95rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
              boxShadow: notStarted ? '0 4px 14px rgba(22,163,74,0.35)' : '0 4px 14px rgba(79,70,229,0.35)',
            }}
          >
            {notStarted
              ? <><MapPin size={18} /> Empezar ruta</>
              : <><Navigation size={18} /> Continuar ruta</>}
          </button>
        </div>
      ) : (
        /* ── Sin ruta activa ── */
        <div style={{
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 'var(--radius-md)', padding: '1.75rem 1rem',
          marginBottom: '1rem', textAlign: 'center',
        }}>
          <ClipboardCheck size={34} style={{ color: 'var(--border)', marginBottom: '0.6rem' }} />
          <div style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.3rem' }}>
            Sin ruta activa
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Revisá la pestaña <b>Tareas</b> para ver si tenés algún recorrido pendiente de aceptar.
          </div>
        </div>
      )}

    </div>
  );
}

// ─── ProfileView ─────────────────────────────────────────────────────────────
function ProfileView({ userId, userNombre, userUser, userRol, onLogout, hasActiveRun, darkMode, onToggleDark }) {
  const [currPass, setCurrPass]   = useState('');
  const [newPass, setNewPass]     = useState('');
  const [confirmPass, setConfirm] = useState('');
  const [saving, setSaving]       = useState(false);
  const [msg, setMsg]             = useState(null); // { type: 'ok'|'err', text }

  const handleChangePass = async (e) => {
    e.preventDefault();
    if (newPass !== confirmPass) return setMsg({ type: 'err', text: 'Las contraseñas nuevas no coinciden' });
    if (newPass.length < 8)      return setMsg({ type: 'err', text: 'La contraseña debe tener al menos 8 caracteres' });
    setSaving(true); setMsg(null);
    try {
      await changePassword(currPass, newPass);
      setCurrPass(''); setNewPass(''); setConfirm('');
      setMsg({ type: 'ok', text: '¡Contraseña actualizada correctamente!' });
    } catch (err) {
      setMsg({ type: 'err', text: err.message });
    } finally { setSaving(false); }
  };

  const rolLabel = { superadmin: 'Super Admin', admin: 'Administrador', caja: 'Cajero', terreno: 'Recaudador' };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
      {/* Encabezado de perfil */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: '1.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#eef2ff', border: '2px solid #a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <UserCircle size={36} color="#4f46e5" />
        </div>
        <div style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-main)' }}>{userNombre}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>@{userUser}</div>
        <span style={{ marginTop: '0.4rem', fontSize: '0.7rem', fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: '#eef2ff', color: '#4f46e5', border: '1px solid #c7d2fe' }}>
          {rolLabel[userRol] ?? userRol}
        </span>
      </div>

      {/* Cambiar contraseña */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
          <KeyRound size={16} color="#4f46e5" />
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Cambiar contraseña</span>
        </div>

        {msg && (
          <div style={{
            padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.85rem',
            fontSize: '0.8rem', fontWeight: 500,
            background: msg.type === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color:      msg.type === 'ok' ? '#065f46'              : '#b91c1c',
            border:     `1px solid ${msg.type === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {msg.text}
          </div>
        )}

        <form onSubmit={handleChangePass} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Contraseña actual</label>
            <input type="password" className="input" value={currPass} onChange={e => setCurrPass(e.target.value)} required autoComplete="current-password" style={{ fontSize: '0.9rem' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Nueva contraseña</label>
            <input type="password" className="input" value={newPass} onChange={e => setNewPass(e.target.value)} required minLength={8} autoComplete="new-password" style={{ fontSize: '0.9rem' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Confirmar nueva contraseña</label>
            <input type="password" className="input" value={confirmPass} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" style={{ fontSize: '0.9rem' }} />
          </div>
          <button type="submit" disabled={saving} className="btn btn-primary" style={{ marginTop: '0.25rem' }}>
            {saving ? 'Guardando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>

      {/* Seguridad */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <Shield size={16} color="#10b981" />
          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Información de seguridad</span>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
          • Tu sesión dura 8 horas. Después deberás iniciar sesión de nuevo.<br />
          • Si olvidaste tu contraseña, usá la opción "¿Olvidaste tu contraseña?" en el login.<br />
          • Nunca compartas tu contraseña con nadie.
        </p>
      </div>

      {/* Toggle modo oscuro */}
      {onToggleDark && (
        <button
          onClick={onToggleDark}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text-main)', fontSize: '0.9rem', cursor: 'pointer', marginBottom: '0.75rem',
          }}
        >
          <span style={{ display:'flex', alignItems:'center', gap: 8, fontWeight: 600 }}>
            {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            {darkMode ? 'Modo claro' : 'Modo oscuro'}
          </span>
          <span style={{
            width: 38, height: 22, borderRadius: 11, background: darkMode ? 'var(--primary)' : 'var(--border)',
            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
          }}>
            <span style={{
              position: 'absolute', top: 3, left: darkMode ? 18 : 3, width: 16, height: 16,
              borderRadius: '50%', background:'var(--surface)', transition: 'left 0.2s',
            }} />
          </span>
        </button>
      )}

      {/* Cerrar sesión */}
      {hasActiveRun && (
        <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-sm)', padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertCircle size={14} /> Tenés un recorrido en curso. Si cerrás sesión, el recorrido quedará incompleto.
        </div>
      )}
      <button
        onClick={() => {
          if (hasActiveRun) {
            if (!window.confirm('Tenés un recorrido en curso. ¿Seguro que querés cerrar sesión? El recorrido quedará como activo.')) return;
          }
          onLogout();
        }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          padding: '0.85rem', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.3)',
          background: 'rgba(239,68,68,0.06)', color: '#b91c1c', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer',
        }}
      >
        <LogOut size={17} /> Cerrar sesión
      </button>
    </div>
  );
}

// ─── CajaMobileView ──────────────────────────────────────────────────────────
const CAT_COLORES = {
  'Electronico':        { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  'Repuestos de maquina': { bg: '#fdf4ff', color: '#7e22ce', border: '#e9d5ff' },
  'Otro':               { bg: '#f0fdf4', color: '#166534', border: '#bbf7d0' },
};

function ModalMovimiento({ onClose, onSaved, preConcepto = '', preMonto = '' }) {
  const [movForm, setMovForm] = useState({ tipo: 'ingreso', concepto: preConcepto, monto: preMonto, metodo_pago: 'efectivo' });
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const handleSave = async () => {
    if (!movForm.concepto.trim() || !movForm.monto) { setError('Completá concepto y monto'); return; }
    if (isNaN(Number(movForm.monto)) || Number(movForm.monto) <= 0) { setError('El monto debe ser mayor a 0'); return; }
    setSaving(true); setError('');
    try {
      await createCajaMovimiento({ tipo: movForm.tipo, concepto: movForm.concepto.trim(), monto: Number(movForm.monto), metodo_pago: movForm.metodo_pago });
      onSaved();
    } catch (e) { setError(e.message || 'Error al guardar'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--surface)', borderRadius: '18px 18px 0 0', padding: '1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))', width: '100%', maxHeight: '90dvh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>Registrar movimiento</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={22} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          {['ingreso','egreso'].map(t => (
            <button key={t} onClick={() => setMovForm(f => ({ ...f, tipo: t }))} style={{
              padding: '0.75rem', borderRadius: 10,
              border: `2px solid ${movForm.tipo === t ? (t==='ingreso'?'#16a34a':'#dc2626') : 'var(--border)'}`,
              background: movForm.tipo === t ? (t==='ingreso'?'#f0fdf4':'#fef2f2') : 'var(--bg-color)',
              color: movForm.tipo === t ? (t==='ingreso'?'#166534':'#b91c1c') : 'var(--text-muted)',
              fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
            }}>{t === 'ingreso' ? '↑ Ingreso' : '↓ Egreso'}</button>
          ))}
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Concepto *</label>
          <input value={movForm.concepto} onChange={e => setMovForm(f => ({ ...f, concepto: e.target.value }))}
            placeholder="Ej: Cobro cliente, Pago combustible..."
            style={{ width: '100%', padding: '0.7rem 0.85rem', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Monto (₲) *</label>
          <input type="number" inputMode="numeric" value={movForm.monto} onChange={e => setMovForm(f => ({ ...f, monto: e.target.value }))}
            placeholder="0"
            style={{ width: '100%', padding: '0.7rem 0.85rem', borderRadius: 10, border: '1.5px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '1.1rem', fontWeight: 700, boxSizing: 'border-box' }} />
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 5 }}>Método de pago</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
            {[['efectivo','💵 Efectivo'],['tarjeta','💳 Tarjeta'],['transferencia','📲 Transfer.']].map(([val,lbl]) => (
              <button key={val} onClick={() => setMovForm(f => ({ ...f, metodo_pago: val }))} style={{
                padding: '0.6rem 0.25rem', borderRadius: 8, border: `2px solid ${movForm.metodo_pago===val?'var(--primary)':'var(--border)'}`,
                background: movForm.metodo_pago===val?'#eef2ff':'var(--bg-color)',
                color: movForm.metodo_pago===val?'var(--primary)':'var(--text-muted)',
                fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer', textAlign: 'center',
              }}>{lbl}</button>
            ))}
          </div>
        </div>
        {error && <div style={{ color:'#dc2626', fontSize:'0.82rem', fontWeight:600, padding:'0.5rem 0.75rem', background:'#fef2f2', borderRadius:8 }}>{error}</div>}
        <button onClick={handleSave} disabled={saving} style={{
          padding:'0.9rem', borderRadius:12, border:'none', cursor: saving?'not-allowed':'pointer',
          background: saving?'var(--border)':'var(--primary)', color: saving?'var(--text-muted)':'white',
          fontWeight:700, fontSize:'0.95rem', display:'flex', alignItems:'center', justifyContent:'center', gap:'0.5rem',
        }}>
          {saving ? <><RefreshCw size={16} style={{ animation:'spin 1s linear infinite' }} /> Guardando...</> : <><Plus size={16} /> Guardar</>}
        </button>
      </div>
    </div>
  );
}

function CajaMobileView({ machines = [], activeRun = null }) {
  const hoyFecha = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Asuncion' });
  const [tab, setTab]                 = useState('movimientos'); // 'movimientos' | 'productos'
  const [cierre, setCierre]           = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [balance, setBalance]         = useState(null);
  const [productos, setProductos]     = useState([]);
  const [loading, setLoading]         = useState(true);
  const [showCatalogo, setShowCatalogo] = useState(false);
  const [busqueda, setBusqueda]       = useState('');

  // ── Formulario de nuevo movimiento (inline, como CajaPage) ───────────────
  const [tipo, setTipo]           = useState('ingreso');
  const [concepto, setConcepto]   = useState('');
  const [monto, setMonto]         = useState('');
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [saving, setSaving]       = useState(false);
  const [formError, setFormError] = useState('');

  // ── Carrito de productos (multi-producto) ────────────────────────────────
  const [carrito, setCarrito] = useState([]); // [{ item_id, item_nombre, item_precio, item_stock, cantidad }]
  const totalCarrito = useMemo(() => carrito.reduce((s, it) => s + (it.item_precio ?? 0) * it.cantidad, 0), [carrito]);

  const agregarAlCarrito = (prod) => {
    setCarrito(prev => {
      const idx = prev.findIndex(it => it.item_id === prod.item_id);
      if (idx >= 0) {
        const arr = [...prev];
        const max = prod.item_stock ?? 9999;
        arr[idx] = { ...arr[idx], cantidad: Math.min(arr[idx].cantidad + 1, max) };
        return arr;
      }
      return [...prev, { item_id: prod.item_id, item_nombre: prod.item_nombre, item_precio: prod.item_precio ?? 0, item_stock: prod.item_stock, cantidad: 1 }];
    });
    if (tipo !== 'ingreso') setTipo('ingreso');
  };

  const cambiarCantidad = (item_id, delta) => {
    setCarrito(prev => prev.map(it => {
      if (it.item_id !== item_id) return it;
      const nueva = it.cantidad + delta;
      if (nueva <= 0) return null;
      const max = it.item_stock ?? 9999;
      return { ...it, cantidad: Math.min(nueva, max) };
    }).filter(Boolean));
  };

  const quitarDelCarrito = (item_id) => setCarrito(prev => prev.filter(it => it.item_id !== item_id));

  // ── Selector de cliente por máquina (cascada) ───────────────────────────
  const [maqSeleccionada, setMaqSeleccionada] = useState(null); // { id, clienteNombre, cliId, location }
  const [showMaqPicker, setShowMaqPicker]     = useState(false);
  const [maqBusqueda, setMaqBusqueda]         = useState('');

  // Máquinas agrupadas por cliente (solo las que tienen cliente asignado)
  const clientesMaquinas = useMemo(() => {
    const conCliente = machines.filter(m => m.cliId != null);
    const groups = {};
    conCliente.forEach(m => {
      const key = String(m.cliId);
      if (!groups[key]) groups[key] = { cliId: m.cliId, nombre: m.clienteNombre ?? `Cliente ${m.cliId}`, maquinas: [] };
      groups[key].maquinas.push(m);
    });
    return Object.values(groups).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [machines]);

  const clientesMaquinasFiltrados = useMemo(() => {
    const q = maqBusqueda.trim().toLowerCase();
    if (!q) return clientesMaquinas;
    return clientesMaquinas
      .map(g => ({
        ...g,
        maquinas: g.maquinas.filter(m =>
          String(m.id).toLowerCase().includes(q) ||
          (m.location ?? '').toLowerCase().includes(q) ||
          (m.type ?? '').toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.maquinas.length > 0 || g.nombre.toLowerCase().includes(q));
  }, [clientesMaquinas, maqBusqueda]);

  // Paradas del recorrido activo enriquecidas con datos del cliente
  const paradasRecorrido = useMemo(() => {
    if (!activeRun?.stops?.length) return [];
    const q = maqBusqueda.trim().toLowerCase();
    const paradas = activeRun.stops.map(stop => {
      const maq = machines.find(m => m.id === stop.machineId) ?? {};
      return {
        stopId:        stop.id,
        stopStatus:    stop.status,    // 'pending' | 'done' | 'failed'
        maqId:         stop.machineId,
        cliId:         maq.cliId   ?? null,
        clienteNombre: maq.clienteNombre ?? null,
        location:      maq.location ?? stop.machineId,
        type:          maq.type    ?? '',
      };
    });
    if (!q) return paradas;
    return paradas.filter(s =>
      String(s.maqId).toLowerCase().includes(q) ||
      (s.location ?? '').toLowerCase().includes(q) ||
      (s.clienteNombre ?? '').toLowerCase().includes(q)
    );
  }, [activeRun, machines, maqBusqueda]);

  // ── Apertura manual ──────────────────────────────────────────────────────
  const [showApertura, setShowApertura]     = useState(false);
  const [aperturaEfectivo, setAperturaEfectivo] = useState('');
  const [aperturaNotas, setAperturaNotas]   = useState('');
  const [savingApertura, setSavingApertura] = useState(false);
  const [aperturaError, setAperturaError]   = useState('');

  // ── Cierre manual ────────────────────────────────────────────────────────
  const [showCierre, setShowCierre]         = useState(false);
  const [cierreNotas, setCierreNotas]       = useState('');
  const [recuentoEfectivo, setRecuentoEfectivo] = useState('');
  const [savingCierre, setSavingCierre]     = useState(false);
  const [cierreError, setCierreError]       = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [c, movs, bal, items] = await Promise.all([
        getCajaCierre(hoyFecha).catch(() => null),
        getCajaMovimientos({ from: hoyFecha, to: hoyFecha, own: true }).catch(() => []),
        getCajaBalance(hoyFecha, { own: true }).catch(() => null),
        getCatalogo({}).catch(() => []),
      ]);
      setCierre(c);
      setMovimientos(Array.isArray(movs) ? movs : []);
      setBalance(bal);
      // Solo electrónicos, repuestos y otros (excluir Máquina y sin categoría)
      const noMaq = (Array.isArray(items) ? items : []).filter(i =>
        i.item_cat_id !== null &&
        i.tipo_cat_nombre?.toLowerCase() !== 'maquina' &&
        i.item_vigente === 1
      );
      setProductos(noMaq);
    } finally {
      setLoading(false);
    }
  }, [hoyFecha]);

  useEffect(() => { refresh(); }, [refresh]);

  const cajaStatus = cierre ? (cierre.cierre_status || 'cerrada') : null;
  const metodoLabel = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' };

  const productosFiltrados = useMemo(() =>
    productos.filter(p => p.item_nombre.toLowerCase().includes(busqueda.toLowerCase())),
    [productos, busqueda]
  );

  // Submit del formulario inline (soporta carrito multi-producto)
  const handleSubmit = async () => {
    setFormError('');
    const usarCarrito = carrito.length > 0;
    const conceptoFinal = usarCarrito
      ? (concepto.trim() || `Venta: ${carrito.map(it => it.item_nombre).join(', ')}`)
      : concepto.trim();
    const montoFinal = usarCarrito ? totalCarrito : Number(monto);

    if (!conceptoFinal)      { setFormError('Completá el concepto.'); return; }
    if (montoFinal <= 0)     { setFormError(usarCarrito ? 'El carrito está vacío o el total es 0.' : 'Ingresá un monto mayor a 0.'); return; }
    setSaving(true);
    try {
      await createCajaMovimiento({
        tipo,
        concepto: conceptoFinal,
        monto: montoFinal,
        metodo_pago: metodoPago,
        cli_id: maqSeleccionada?.cliId ?? null,
        maq_id: maqSeleccionada?.id ?? null,
        items: usarCarrito ? carrito.map(it => ({ item_id: it.item_id, cantidad: it.cantidad })) : undefined,
      });
      setConcepto(''); setMonto(''); setTipo('ingreso'); setMetodoPago('efectivo');
      setMaqSeleccionada(null);
      setCarrito([]);
      await refresh();
    } catch (e) { setFormError(e?.message || 'Error al guardar el movimiento.'); }
    finally { setSaving(false); }
  };

  const handleAbrirCaja = async () => {
    setAperturaError(''); setSavingApertura(true);
    try {
      const sesion = await createCajaApertura({
        fecha: hoyFecha,
        efectivo: Number(aperturaEfectivo) || 0,
        notas: aperturaNotas.trim() || null,
      });
      setCierre(sesion);
      setShowApertura(false);
      setAperturaEfectivo(''); setAperturaNotas('');
      await refresh();
    } catch (e) {
      setAperturaError(e?.message?.includes('ya existe') ? 'Ya existe una sesión de caja para hoy.' : 'Error al abrir la caja.');
    } finally { setSavingApertura(false); }
  };

  const handleCerrarCaja = async () => {
    setCierreError(''); setSavingCierre(true);
    try {
      const c = await createCajaCierre({
        fecha: hoyFecha,
        notas: cierreNotas.trim() || null,
        recuento_efectivo: Number(recuentoEfectivo) || 0,
      });
      setCierre(c);
      setShowCierre(false);
      setCierreNotas(''); setRecuentoEfectivo('');
      await refresh();
    } catch (e) {
      setCierreError(e?.message?.includes('ya fue cerrada') ? 'La caja de hoy ya fue cerrada.' : 'Error al registrar el cierre.');
    } finally { setSavingCierre(false); }
  };

  const handleReabrirCaja = async () => {
    if (!confirm(cajaStatus === 'cerrada' ? '¿Reabrir la caja? El cierre será cancelado.' : '¿Cancelar la apertura de hoy?')) return;
    try {
      const result = await deleteCajaCierre(hoyFecha);
      if (result?.status === 'abierta') await refresh();
      else setCierre(null);
    } catch { /* silencioso */ }
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', color: 'var(--text-muted)', padding: '2rem' }}>
      <RefreshCw size={28} style={{ opacity: 0.3, animation: 'spin 1s linear infinite' }} />
      <span style={{ fontSize: '0.85rem' }}>Cargando caja...</span>
    </div>
  );

  if (loading) return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'0.75rem', color:'var(--text-muted)', padding:'2rem' }}>
      <RefreshCw size={28} style={{ opacity:0.3, animation:'spin 1s linear infinite' }} />
      <span style={{ fontSize:'0.85rem' }}>Cargando caja...</span>
    </div>
  );

  return (
    <div className="animate-fade-in" style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>

      {/* ── Modal Apertura de Caja (estilo cajero) ── */}
      {showApertura && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
          <div className="card p-6" style={{ maxWidth:420, width:'100%' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem' }}>
              <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--success-light)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <ShoppingBag size={22} style={{ color:'var(--success)' }} />
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:'1rem' }}>Control de Apertura</div>
                <div style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>{new Date().toLocaleDateString('es-PY', { weekday:'long', day:'2-digit', month:'long', year:'numeric', timeZone:'America/Asuncion' })}</div>
              </div>
            </div>
            <div className="input-group mb-4">
              <label className="label">Efectivo inicial en caja <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span></label>
              <input className="input" type="number" min="0" step="any" placeholder="0" value={aperturaEfectivo} onChange={e => setAperturaEfectivo(e.target.value)} autoFocus />
            </div>
            <div className="input-group mb-4">
              <label className="label">Nota de apertura <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span></label>
              <textarea className="input" rows={2} placeholder="Ej: Turno mañana, sin novedad..." value={aperturaNotas} onChange={e => setAperturaNotas(e.target.value)} style={{ resize:'vertical' }} />
            </div>
            {aperturaError && <div style={{ background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'1rem', fontSize:'0.82rem', fontWeight:600 }}>{aperturaError}</div>}
            <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
              <button className="btn btn-secondary" onClick={() => { setShowApertura(false); setAperturaError(''); }} disabled={savingApertura}>Cancelar</button>
              <button className="btn" style={{ background:'#16a34a', color:'white', gap:6 }} onClick={handleAbrirCaja} disabled={savingApertura}>
                {savingApertura ? <><RefreshCw size={15} style={{ animation:'spin 1s linear infinite' }} /> Abriendo...</> : <><ShoppingBag size={15} /> Abrir Caja</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Cierre de Caja (estilo cajero) ── */}
      {showCierre && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:'1rem' }}>
          <div className="card" style={{ maxWidth:500, width:'100%', overflow:'hidden' }}>
            <div style={{ background:'linear-gradient(135deg,#1e293b,#334155)', padding:'1.1rem 1.5rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontWeight:900, color:'white', fontSize:'1rem', letterSpacing:'0.03em' }}>Cerrando la Caja</div>
                <div style={{ fontSize:'0.75rem', color:'#94a3b8', marginTop:2 }}>
                  {movimientos.filter(m => !m.mov_es_reembolso).length} movimientos · ₲ {fmt(balance?.total_ingresos ?? 0)} facturado
                </div>
              </div>
              <button onClick={() => { setShowCierre(false); setCierreError(''); setCierreNotas(''); setRecuentoEfectivo(''); }}
                style={{ background:'rgba(255,255,255,0.1)', border:'none', borderRadius:8, padding:'0.35rem 0.6rem', cursor:'pointer', color:'white', display:'flex' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding:'1.25rem 1.5rem' }}>
              {balance && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem', marginBottom:'1.25rem' }}>
                  {[
                    { label:'Ingresos', value:balance.total_ingresos, color:'var(--success)' },
                    { label:'Egresos',  value:balance.total_egresos,  color:'var(--danger)' },
                    { label:'Balance',  value:balance.balance,        color: balance.balance >= 0 ? 'var(--success)' : 'var(--danger)' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign:'center', padding:'0.6rem 0.25rem', background:'var(--bg-secondary)', borderRadius:10, border:'1px solid var(--border)' }}>
                      <div style={{ fontSize:'0.6rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.04em' }}>{label}</div>
                      <div style={{ fontWeight:800, fontSize:'0.85rem', color, marginTop:3 }}>₲ {fmt(value ?? 0)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="input-group mb-4">
                <label className="label">Recuento de efectivo en caja</label>
                <input className="input" type="number" min="0" step="any" placeholder={`0 (esperado: ₲ ${fmt(Number(cierre?.apertura_efectivo ?? 0) + (balance?.total_ingresos ?? 0) - (balance?.total_egresos ?? 0))})`}
                  value={recuentoEfectivo} onChange={e => setRecuentoEfectivo(e.target.value)}
                  style={{ fontWeight:700, borderWidth:2, borderColor: recuentoEfectivo ? (Math.abs(Number(recuentoEfectivo) - (Number(cierre?.apertura_efectivo ?? 0) + (balance?.total_ingresos ?? 0) - (balance?.total_egresos ?? 0))) > 0.01 ? '#ef4444' : '#16a34a') : '#c7d2fe', background:'var(--surface)' }} />
              </div>
              <div style={{ marginBottom:'1.25rem', background:'var(--bg-secondary)', border:'1.5px solid var(--border)', borderRadius:12, padding:'0.75rem 1rem' }}>
                <label className="label">Nota de cierre <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span></label>
                <textarea className="input" rows={2} placeholder="Ej: Todo en orden, sin diferencias..." value={cierreNotas} onChange={e => setCierreNotas(e.target.value)} style={{ resize:'vertical' }} />
              </div>
              {cierreError && <div style={{ background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'1rem', fontSize:'0.82rem', fontWeight:600 }}>{cierreError}</div>}
              <div style={{ display:'flex', gap:'0.75rem', justifyContent:'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => { setShowCierre(false); setCierreError(''); setCierreNotas(''); setRecuentoEfectivo(''); }} disabled={savingCierre}>Descartar</button>
                <button className="btn" style={{ background:'#d97706', color:'white', gap:6 }} onClick={handleCerrarCaja} disabled={savingCierre}>
                  {savingCierre ? <><RefreshCw size={15} style={{ animation:'spin 1s linear infinite' }} /> Cerrando...</> : <><Lock size={15} /> Cerrar Caja</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Banner: Caja ABIERTA ── */}
      {cajaStatus === 'abierta' && (
        <div style={{ background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', border:'2px solid #86efac', borderRadius:12, padding:'0.8rem 1.1rem', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
          <div style={{ width:36, height:36, borderRadius:'50%', background:'#16a34a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <ShoppingBag size={18} style={{ color:'white' }} />
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ fontWeight:800, color:'var(--success)', fontSize:'0.9rem' }}>Caja abierta</span>
            {cierre?.apertura_timestamp && (
              <span style={{ fontSize:'0.78rem', color:'var(--success)', marginLeft:8 }}>
                {new Date(cierre.apertura_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
              </span>
            )}
            <span style={{ display:'inline-flex', alignItems:'center', gap:4, marginLeft:10, background:'#16a34a22', borderRadius:999, padding:'1px 10px', fontSize:'0.72rem', fontWeight:700, color:'var(--success)' }}>
              Efectivo inicial: ₲ {fmt(cierre?.apertura_efectivo ?? 0)}
            </span>
            {cierre?.apertura_notas && <div style={{ fontSize:'0.72rem', color:'var(--success)', marginTop:2, fontStyle:'italic' }}>"{cierre.apertura_notas}"</div>}
          </div>
          <button onClick={handleReabrirCaja}
            style={{ display:'flex', alignItems:'center', gap:5, background:'var(--surface)', border:'1.5px solid var(--success)', color:'var(--success)', borderRadius:8, padding:'0.35rem 0.75rem', fontWeight:700, fontSize:'0.75rem', cursor:'pointer', whiteSpace:'nowrap' }}>
            <X size={13} /> Cancelar apertura
          </button>
        </div>
      )}

      {/* ── Banner: Caja CERRADA ── */}
      {cajaStatus === 'cerrada' && (
        <div style={{ background:'#fefce8', border:'2px solid #fbbf24', borderRadius:12, padding:'0.9rem 1.1rem', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.75rem', flexWrap:'wrap' }}>
          <Lock size={22} style={{ color:'var(--warning)', flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <span style={{ fontWeight:800, color:'var(--warning)', fontSize:'0.9rem' }}>Caja cerrada</span>
            {cierre?.cierre_timestamp && (
              <span style={{ fontSize:'0.8rem', color:'#78350f', marginLeft:8 }}>
                {new Date(cierre.cierre_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit', timeZone:'America/Asuncion' })}
              </span>
            )}
            {cierre?.cierre_notas && <div style={{ fontSize:'0.75rem', color:'#78350f', marginTop:2 }}>"{cierre.cierre_notas}"</div>}
          </div>
          <button onClick={handleReabrirCaja}
            style={{ display:'flex', alignItems:'center', gap:6, background:'var(--surface)', border:'1.5px solid #ef4444', color:'var(--danger)', borderRadius:8, padding:'0.4rem 0.85rem', fontWeight:700, fontSize:'0.8rem', cursor:'pointer', whiteSpace:'nowrap' }}>
            <LockOpen size={14} /> Reabrir Caja
          </button>
        </div>
      )}

      {/* ── Botones Abrir / Cerrar Caja ── */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'1rem', gap:'0.5rem' }}>
        {cajaStatus === null && (
          <button className="btn" style={{ background:'#16a34a', color:'white', fontWeight:700, gap:6, boxShadow:'0 2px 8px rgba(22,163,74,0.3)' }}
            onClick={() => { setAperturaError(''); setShowApertura(true); }}>
            <ShoppingBag size={16} /> Abrir Caja
          </button>
        )}
        {cajaStatus === 'abierta' && (
          <button className="btn" style={{ background:'#d97706', color:'white', fontWeight:700, gap:6, boxShadow:'0 2px 8px rgba(217,119,6,0.3)' }}
            onClick={() => { setCierreError(''); setRecuentoEfectivo(''); setShowCierre(true); }}>
            <Lock size={16} /> Cerrar Caja
          </button>
        )}
      </div>

      {/* ── Balance Cards (4 tarjetas igual que cajero) ── */}
      <div className="stats-grid routes-stats-grid" style={{ marginBottom:'1.5rem' }}>
        <div className="card stat-card">
          <div className="stat-icon bg-success-light"><ArrowDownCircle size={24} className="text-success" /></div>
          <div>
            <div className="text-sm text-muted">Total Ingresos</div>
            <div className="text-2xl font-bold" style={{ color:'var(--success)' }}>₲{fmt(balance?.total_ingresos ?? 0)}</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon bg-danger-light"><ArrowUpCircle size={24} className="text-danger" /></div>
          <div>
            <div className="text-sm text-muted">Total Egresos</div>
            <div className="text-2xl font-bold" style={{ color:'var(--danger)' }}>₲{fmt(balance?.total_egresos ?? 0)}</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon" style={{ background:'#ede9fe' }}><RotateCcw size={24} style={{ color:'#7c3aed' }} /></div>
          <div>
            <div className="text-sm text-muted">Reembolsos</div>
            <div className="text-2xl font-bold" style={{ color:'#7c3aed' }}>₲{fmt(balance?.total_reembolsos ?? 0)}</div>
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon bg-primary-light"><Wallet size={24} className="text-primary" /></div>
          <div>
            <div className="text-sm text-muted">Balance en Caja</div>
            <div className="text-2xl font-bold" style={{ color:(balance?.balance ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)' }}>₲{fmt(balance?.balance ?? 0)}</div>
          </div>
        </div>
      </div>

      {/* ── Gate: caja no abierta ── */}
      {cajaStatus !== 'abierta' ? (
        <div className="card" style={{ padding:'3.5rem 2rem', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'1.5rem', marginBottom:'1.5rem' }}>
          {cajaStatus === null ? (
            <>
              <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#16a34a,#15803d)', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 6px 20px rgba(22,163,74,0.35)' }}>
                <ShoppingBag size={34} style={{ color:'white' }} />
              </div>
              <div>
                <div style={{ fontWeight:800, fontSize:'1.25rem', color:'var(--success)', marginBottom:6 }}>Caja sin abrir</div>
                <div style={{ color:'#6b7280', fontSize:'0.9rem', maxWidth:320, lineHeight:1.5 }}>
                  Para registrar ventas y movimientos necesitás <strong>abrir la caja</strong> primero.
                </div>
              </div>
              <button className="btn" style={{ background:'#16a34a', color:'white', fontWeight:700, fontSize:'1rem', padding:'0.75rem 2.25rem', gap:8, boxShadow:'0 4px 14px rgba(22,163,74,0.35)', borderRadius:10 }}
                onClick={() => { setAperturaError(''); setShowApertura(true); }}>
                <ShoppingBag size={20} /> Abrir Caja
              </button>
            </>
          ) : (
            <>
              <div style={{ width:72, height:72, borderRadius:'50%', background:'linear-gradient(135deg,#fef3c7,#fde68a)', border:'2.5px solid #fbbf24', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 4px 14px rgba(217,119,6,0.2)' }}>
                <Lock size={34} style={{ color:'var(--warning)' }} />
              </div>
              <div>
                <div style={{ fontWeight:800, fontSize:'1.25rem', color:'var(--warning)', marginBottom:6 }}>Caja cerrada</div>
                <div style={{ color:'#6b7280', fontSize:'0.9rem', maxWidth:340, lineHeight:1.5 }}>
                  La caja de hoy fue cerrada. Podés reabrirla para registrar más movimientos.
                </div>
              </div>
              <button className="btn" style={{ background:'#d97706', color:'white', fontWeight:700, fontSize:'1rem', padding:'0.75rem 2.25rem', gap:8, boxShadow:'0 4px 14px rgba(217,119,6,0.3)', borderRadius:10 }}
                onClick={handleReabrirCaja}>
                <LockOpen size={20} /> Reabrir Caja
              </button>
            </>
          )}
        </div>
      ) : (

      /* ── Layout principal 2 columnas (igual al cajero) ── */
      <div className="caja-main-grid">

        {/* ── Columna IZQUIERDA: Tipo + Catálogo ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div className="card p-5">
            <div className="input-group mb-0">
              <label className="label">Tipo</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem' }}>
                <button type="button" onClick={() => setTipo('ingreso')} style={{
                  padding:'0.6rem', borderRadius:8,
                  border:`2px solid ${tipo === 'ingreso' ? 'var(--success)' : 'var(--border)'}`,
                  background: tipo === 'ingreso' ? 'var(--success-light)' : 'transparent',
                  color: tipo === 'ingreso' ? 'var(--success)' : 'var(--text-muted)',
                  fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}>
                  <ArrowDownCircle size={16} /> Ingreso
                </button>
                <button type="button" onClick={() => setTipo('egreso')} style={{
                  padding:'0.6rem', borderRadius:8,
                  border:`2px solid ${tipo === 'egreso' ? 'var(--danger)' : 'var(--border)'}`,
                  background: tipo === 'egreso' ? 'var(--danger-light)' : 'transparent',
                  color: tipo === 'egreso' ? 'var(--danger)' : 'var(--text-muted)',
                  fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}>
                  <ArrowUpCircle size={16} /> Egreso
                </button>
              </div>
            </div>
            {productos.length > 0 && (
              <button type="button" onClick={() => setShowCatalogo(s => !s)}
                className="btn btn-secondary w-full"
                style={{ justifyContent:'center', gap:6, marginTop:'1rem', position:'relative' }}>
                <ShoppingBag size={16} />
                {showCatalogo ? 'Ocultar catálogo' : 'Ver catálogo de productos'}
                {carrito.length > 0 && (
                  <span style={{ position:'absolute', top:-7, right:-7, background:'var(--primary)', color:'white', borderRadius:'50%', width:20, height:20, fontSize:'0.68rem', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 1px 4px rgba(0,0,0,0.2)' }}>
                    {carrito.reduce((s, it) => s + it.cantidad, 0)}
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Catálogo de productos inline */}
          {showCatalogo && productos.length > 0 && (
            <div className="card animate-fade-in">
              <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontWeight:700, fontSize:'0.95rem' }}>📦 Catálogo</span>
                <button className="btn btn-secondary btn-icon" onClick={() => { setShowCatalogo(false); setBusqueda(''); }}>
                  <X size={16} />
                </button>
              </div>
              <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid var(--border)', background:'var(--bg-color)' }}>
                <input className="input" placeholder="Buscar producto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} autoFocus />
              </div>
              <div style={{ padding:'0.75rem 1rem', display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                {productosFiltrados.length === 0 ? (
                  <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'1.5rem', fontSize:'0.875rem' }}>
                    {busqueda ? `Sin resultados para "${busqueda}"` : 'No hay productos cargados'}
                  </div>
                ) : productosFiltrados.map(prod => {
                  const sinStock = prod.item_stock !== null && prod.item_stock <= 0;
                  const enCarrito = carrito.find(it => it.item_id === prod.item_id);
                  return (
                    <div key={prod.item_id}
                      style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.65rem 0.85rem', borderRadius:8, border: enCarrito ? '1.5px solid var(--primary)' : '1px solid var(--border)', background: enCarrito ? 'var(--primary-light)' : 'var(--surface)', opacity: sinStock && !enCarrito ? 0.6 : 1, transition:'all 0.15s' }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:'0.875rem', color:'var(--text-main)' }}>{prod.item_nombre}</div>
                        <div style={{ fontSize:'0.8rem', color:'var(--primary)', fontWeight:700 }}>₲ {fmt(prod.item_precio)}</div>
                        <div style={{ fontSize:'0.7rem', color: sinStock ? 'var(--danger)' : 'var(--success)', fontWeight:600 }}>
                          {sinStock ? 'Sin stock' : `Stock: ${prod.item_stock}`}
                        </div>
                      </div>
                      {sinStock && !enCarrito ? null : enCarrito ? (
                        <div style={{ display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                          <button type="button" onClick={() => cambiarCantidad(prod.item_id, -1)}
                            style={{ width:28, height:28, borderRadius:6, border:'1.5px solid var(--primary)', background:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--primary)' }}>
                            <Minus size={13} />
                          </button>
                          <span style={{ fontWeight:800, fontSize:'0.9rem', minWidth:22, textAlign:'center', color:'var(--primary)' }}>{enCarrito.cantidad}</span>
                          <button type="button" onClick={() => agregarAlCarrito(prod)}
                            style={{ width:28, height:28, borderRadius:6, border:'1.5px solid var(--primary)', background:'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
                            <Plus size={13} />
                          </button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => agregarAlCarrito(prod)}
                          style={{ width:30, height:30, borderRadius:6, border:'1.5px solid var(--primary)', background:'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'white', flexShrink:0 }}>
                          <Plus size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Columna DERECHA: Movimientos + Formulario ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>

          {/* Lista de movimientos */}
          <div className="card">
            <div style={{ padding:'0.85rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <h3 style={{ fontWeight:700, fontSize:'1rem', margin:0 }}>Movimientos de Caja</h3>
              <span style={{ background:'var(--primary-light)', color:'var(--primary)', borderRadius:999, fontSize:'0.72rem', fontWeight:700, padding:'2px 9px' }}>
                {movimientos.length} registro{movimientos.length !== 1 ? 's' : ''}
              </span>
            </div>
            {movimientos.length === 0 ? (
              <div style={{ padding:'2.5rem 1rem', textAlign:'center', display:'flex', flexDirection:'column', alignItems:'center', gap:'0.75rem' }}>
                <span style={{ fontSize:'2.5rem', opacity:0.2 }}>📭</span>
                <span style={{ color:'var(--text-muted)', fontSize:'0.875rem' }}>Sin movimientos registrados</span>
              </div>
            ) : movimientos.map(m => (
              <div key={m.mov_id} style={{ padding:'0.75rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'0.75rem' }}>
                <div style={{ width:36, height:36, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', background: m.mov_tipo === 'ingreso' ? 'var(--success-light)' : 'var(--danger-light)', color: m.mov_tipo === 'ingreso' ? 'var(--success)' : 'var(--danger)' }}>
                  {m.mov_tipo === 'ingreso' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:'0.875rem', color:'var(--text-main)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{m.mov_concepto}</div>
                  <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', marginTop:2, display:'flex', gap:'0.35rem', flexWrap:'wrap', alignItems:'center' }}>
                    <span>{metodoLabel[m.mov_metodo_pago] ?? m.mov_metodo_pago}</span>
                    {m.mov_timestamp && <span>· {new Date(m.mov_timestamp).toLocaleTimeString('es-PY', { hour:'2-digit', minute:'2-digit' })}</span>}
                    {m.maq_id && <span style={{ background:'var(--primary-light)', color:'var(--primary)', borderRadius:4, padding:'0 5px', fontWeight:700, fontSize:'0.65rem' }}>MQ {m.maq_id}</span>}
                    {m.mov_es_reembolso && <span style={{ background:'#ede9fe', color:'#7c3aed', borderRadius:4, padding:'0 5px', fontWeight:700, fontSize:'0.65rem' }}>↩ Remb.</span>}
                  </div>
                </div>
                <div style={{ fontWeight:800, fontSize:'0.9rem', color: m.mov_tipo === 'ingreso' ? 'var(--success)' : 'var(--danger)', whiteSpace:'nowrap' }}>
                  {m.mov_tipo === 'ingreso' ? '+' : '-'}₲{fmt(m.mov_monto)}
                </div>
              </div>
            ))}
          </div>

          {/* Formulario Nuevo Movimiento */}
          <div className="card">
            <div style={{ padding:'0.85rem 1.25rem', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <Plus size={16} style={{ color:'var(--primary)' }} />
              <h3 style={{ fontWeight:700, fontSize:'1rem', margin:0 }}>Nuevo Movimiento</h3>
            </div>
            <div style={{ padding:'1.25rem' }}>

              {/* ── Selector de cliente por máquina (cascada) ── */}
              {(clientesMaquinas.length > 0 || activeRun?.stops?.length > 0) && (
              <div className="input-group mb-4">
                <label className="label" style={{ display:'flex', alignItems:'center', gap:5 }}>
                  {activeRun
                    ? <><Route size={13} style={{ color:'#16a34a' }} />
                        <span style={{ color:'#16a34a' }}>Cliente del recorrido</span>
                        <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span>
                      </>
                    : <><MapPin size={13} /> Cliente por Máquina
                        <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(opcional)</span>
                      </>
                  }
                </label>

                {/* Badge de máquina seleccionada */}
                {maqSeleccionada ? (
                  <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.55rem 0.85rem', borderRadius:8, border:'2px solid var(--primary)', background:'var(--primary-light)' }}>
                    <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.72rem', flexShrink:0 }}>MQ</div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--text-main)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{maqSeleccionada.id}</div>
                      {maqSeleccionada.clienteNombre
                        ? <div style={{ fontSize:'0.72rem', fontWeight:600, color:'var(--primary)' }}>{maqSeleccionada.clienteNombre}</div>
                        : <div style={{ fontSize:'0.72rem', color:'#9ca3af' }}>Sin cliente</div>}
                      {maqSeleccionada.location && <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginTop:1 }}>{maqSeleccionada.location}</div>}
                    </div>
                    <button type="button" onClick={() => setMaqSeleccionada(null)}
                      style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:3, flexShrink:0 }}>
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  /* Botón para abrir el picker */
                  <button type="button" className="btn btn-secondary w-full"
                    style={{ justifyContent:'center', gap:6, borderColor: activeRun ? '#86efac' : undefined, background: activeRun && !showMaqPicker ? '#f0fdf4' : undefined }}
                    onClick={() => setShowMaqPicker(s => !s)}>
                    {showMaqPicker
                      ? <><X size={15} /> Cerrar lista</>
                      : activeRun
                        ? <><Route size={15} style={{ color:'#16a34a' }} />
                            <span style={{ color:'#16a34a', fontWeight:700 }}>Seleccionar Cliente-máquina</span>
                          </>
                        : <><Search size={15} /> Seleccionar Cliente-máquina</>
                    }
                  </button>
                )}

                {/* Panel cascada */}
                {!maqSeleccionada && showMaqPicker && (
                  <div className="animate-fade-in" style={{ marginTop:'0.5rem', border:'1px solid var(--border)', borderRadius:10, overflow:'hidden' }}>
                    {/* Search */}
                    <div style={{ padding:'0.6rem 0.75rem', borderBottom:'1px solid var(--border)', background:'var(--bg-secondary)', display:'flex', gap:'0.5rem', alignItems:'center' }}>
                      <Search size={14} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                      <input className="input" placeholder="Buscar cliente o máquina..."
                        style={{ flex:1, padding:'0.35rem 0.5rem', fontSize:'0.82rem' }}
                        value={maqBusqueda}
                        onChange={e => setMaqBusqueda(e.target.value)}
                        autoFocus />
                      {maqBusqueda && (
                        <button type="button" onClick={() => setMaqBusqueda('')}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex', padding:2 }}>
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {/* Cascade list */}
                    <div style={{ maxHeight:320, overflowY:'auto' }}>
                      {paradasRecorrido.length === 0 && clientesMaquinasFiltrados.length === 0 ? (
                        <div style={{ padding:'1.5rem', textAlign:'center', color:'var(--text-muted)', fontSize:'0.82rem' }}>
                          {maqBusqueda ? `Sin resultados para "${maqBusqueda}"` : 'No hay máquinas con clientes asignados'}
                        </div>
                      ) : <>
                        {/* ── Sección: paradas del recorrido activo ── */}
                        {paradasRecorrido.length > 0 && (
                          <div>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', padding:'0.45rem 0.75rem', background:'linear-gradient(135deg,#f0fdf4,#dcfce7)', borderBottom:'1px solid #86efac', position:'sticky', top:0 }}>
                              <Route size={13} style={{ color:'#16a34a', flexShrink:0 }} />
                              <span style={{ fontWeight:800, fontSize:'0.75rem', color:'#16a34a', flex:1 }}>
                                Recorrido #{activeRun?.id} — {activeRun?.stops?.length ?? 0} paradas
                              </span>
                            </div>
                            {paradasRecorrido.map((s, idx) => {
                              const stopDot = { done:'#16a34a', failed:'#dc2626', pending:'#9ca3af' }[s.stopStatus] ?? '#9ca3af';
                              const displayNombre = s.clienteNombre ?? s.location ?? s.maqId;
                              return (
                                <button key={s.stopId} type="button"
                                  onClick={() => {
                                    setMaqSeleccionada({ id: s.maqId, clienteNombre: s.clienteNombre, cliId: s.cliId, location: s.location });
                                    setShowMaqPicker(false); setMaqBusqueda('');
                                    if (!concepto.trim()) setConcepto(`Cobro: MQ ${s.maqId}${s.clienteNombre ? ` — ${s.clienteNombre}` : ''}`);
                                  }}
                                  style={{ width:'100%', display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.55rem 0.75rem', border:'none', borderBottom:'1px solid var(--border)', background:'var(--surface)', cursor:'pointer', textAlign:'left', transition:'background 0.1s' }}
                                  onMouseEnter={e => { e.currentTarget.style.background='var(--primary-light)'; }}
                                  onMouseLeave={e => { e.currentTarget.style.background='var(--surface)'; }}>
                                  <div style={{ width:8, height:8, borderRadius:'50%', background:stopDot, flexShrink:0 }} />
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontWeight:700, fontSize:'0.8rem', color:'var(--text-main)', display:'flex', alignItems:'center', gap:5 }}>
                                      MQ {s.maqId}
                                      {s.stopStatus === 'done' && <span style={{ background:'#dcfce7', color:'#16a34a', borderRadius:4, padding:'0 4px', fontSize:'0.63rem', fontWeight:700 }}>✓ Hecho</span>}
                                    </div>
                                    <div style={{ fontSize:'0.68rem', marginTop:1, display:'flex', alignItems:'center', gap:4 }}>
                                      <span style={{ color:'var(--text-muted)' }}>{s.location}</span>
                                      {s.clienteNombre
                                        ? <span style={{ color:'var(--primary)', fontWeight:700 }}>· {s.clienteNombre}</span>
                                        : <span style={{ color:'#9ca3af' }}>· Sin cliente</span>}
                                    </div>
                                  </div>
                                  <ChevronRight size={13} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* ── Separador ── */}
                        {paradasRecorrido.length > 0 && clientesMaquinasFiltrados.length > 0 && (
                          <div style={{ padding:'0.3rem 0.75rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', fontSize:'0.65rem', fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>
                            Otras máquinas
                          </div>
                        )}

                        {/* ── Sección: resto de máquinas (por cliente) ── */}
                        {clientesMaquinasFiltrados.map(grupo => (
                          <div key={grupo.cliId}>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', padding:'0.5rem 0.75rem', background:'var(--bg-secondary)', borderBottom:'1px solid var(--border)', position:'sticky', top:0 }}>
                              <div style={{ width:26, height:26, borderRadius:'50%', background:'var(--primary)', color:'white', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:'0.75rem', flexShrink:0 }}>
                                {grupo.nombre.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--text-main)', flex:1 }}>{grupo.nombre}</span>
                              <span style={{ fontSize:'0.68rem', color:'var(--text-muted)', fontWeight:600 }}>{grupo.maquinas.length} máq.</span>
                            </div>
                            {grupo.maquinas.map((maq, idx) => {
                              const dotColor = { ok:'var(--success)', mantenimiento:'var(--warning)', fuera_servicio:'var(--danger)', baja:'#9ca3af', warning:'#f59e0b', inactiva:'#9ca3af' }[maq.status] ?? 'var(--text-muted)';
                              return (
                                <button key={maq.id} type="button"
                                  onClick={() => {
                                    setMaqSeleccionada(maq);
                                    setShowMaqPicker(false); setMaqBusqueda('');
                                    if (!concepto.trim()) setConcepto(`Cobro: ${maq.clienteNombre} (MQ ${maq.id})`);
                                  }}
                                  style={{ width:'100%', display:'flex', alignItems:'center', gap:'0.65rem', padding:'0.55rem 0.75rem 0.55rem 1.35rem', border:'none', borderBottom: idx < grupo.maquinas.length - 1 ? '1px solid var(--border)' : 'none', background:'var(--surface)', cursor:'pointer', textAlign:'left', transition:'background 0.1s' }}
                                  onMouseEnter={e => e.currentTarget.style.background='var(--primary-light)'}
                                  onMouseLeave={e => e.currentTarget.style.background='var(--surface)'}>
                                  <div style={{ width:8, height:8, borderRadius:'50%', background:dotColor, flexShrink:0 }} />
                                  <div style={{ flex:1, minWidth:0 }}>
                                    <div style={{ fontWeight:700, fontSize:'0.8rem', color:'var(--text-main)' }}>MQ {maq.id}</div>
                                    {(maq.type || maq.location) && (
                                      <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', marginTop:1 }}>
                                        {[maq.type, maq.location].filter(Boolean).join(' · ')}
                                      </div>
                                    )}
                                  </div>
                                  <ChevronRight size={13} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </>}
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* ── Resumen del carrito ───────────────────────────────── */}
              {carrito.length > 0 && (
                <div style={{ background:'var(--primary-light)', border:'1.5px solid var(--primary)', borderRadius:10, padding:'0.75rem', marginBottom:'1rem' }}>
                  <div style={{ fontWeight:700, fontSize:'0.82rem', color:'var(--primary)', marginBottom:'0.5rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                    <span style={{ display:'flex', alignItems:'center', gap:5 }}>
                      <ShoppingBag size={14} /> Carrito — {carrito.reduce((s, it) => s + it.cantidad, 0)} ítem{carrito.reduce((s, it) => s + it.cantidad, 0) !== 1 ? 's' : ''}
                    </span>
                    <button type="button" onClick={() => setCarrito([])} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--danger)', fontSize:'0.72rem', fontWeight:700, padding:'2px 6px', borderRadius:4 }}>
                      Vaciar
                    </button>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
                    {carrito.map(it => (
                      <div key={it.item_id} style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'white', borderRadius:7, padding:'0.35rem 0.55rem' }}>
                        <div style={{ flex:1, minWidth:0, fontSize:'0.8rem', fontWeight:600, color:'var(--text-main)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.item_nombre}</div>
                        <div style={{ display:'flex', alignItems:'center', gap:4, flexShrink:0 }}>
                          <button type="button" onClick={() => cambiarCantidad(it.item_id, -1)}
                            style={{ width:22, height:22, borderRadius:4, border:'1px solid var(--border)', background:'white', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-main)' }}>
                            <Minus size={11} />
                          </button>
                          <span style={{ fontWeight:800, fontSize:'0.82rem', minWidth:20, textAlign:'center' }}>{it.cantidad}</span>
                          <button type="button" onClick={() => cambiarCantidad(it.item_id, 1)}
                            style={{ width:22, height:22, borderRadius:4, border:'1px solid var(--primary)', background:'var(--primary)', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
                            <Plus size={11} />
                          </button>
                        </div>
                        <div style={{ fontWeight:700, fontSize:'0.8rem', color:'var(--primary)', minWidth:72, textAlign:'right', flexShrink:0 }}>₲{fmt(it.item_precio * it.cantidad)}</div>
                        <button type="button" onClick={() => quitarDelCarrito(it.item_id)}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#9ca3af', padding:2, display:'flex', flexShrink:0 }}>
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'0.5rem', paddingTop:'0.5rem', borderTop:'1.5px solid var(--primary)' }}>
                    <span style={{ fontWeight:700, fontSize:'0.85rem', color:'var(--primary)' }}>Total:</span>
                    <span style={{ fontWeight:800, fontSize:'1.05rem', color:'var(--primary)' }}>₲{fmt(totalCarrito)}</span>
                  </div>
                </div>
              )}

              <div className="input-group mb-4">
                <label className="label">
                  Concepto
                  {carrito.length > 0 && <span style={{ fontWeight:400, color:'var(--text-muted)', marginLeft:4 }}>(opcional — se auto-genera)</span>}
                </label>
                <input className="input"
                  placeholder={carrito.length > 0 ? `Venta: ${carrito.map(it => it.item_nombre).join(', ')}` : 'Ej: Fondo inicial, Pago proveedor...'}
                  value={concepto}
                  onChange={e => setConcepto(e.target.value)} />
              </div>

              {/* Monto — oculto cuando el carrito lo calcula automáticamente */}
              {carrito.length === 0 && (
                <div className="input-group mb-4">
                  <label className="label">Monto (₲)</label>
                  <input className="input" type="number" inputMode="numeric" placeholder="0" value={monto} onChange={e => setMonto(e.target.value)} style={{ fontWeight:700 }} />
                </div>
              )}

              <div className="input-group mb-4">
                <label className="label">Método de Pago</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem' }}>
                  {[['efectivo','💵','Efectivo'],['tarjeta','💳','Tarjeta'],['transferencia','📲','Transferencia']].map(([val, ico, lbl]) => (
                    <button key={val} type="button" onClick={() => setMetodoPago(val)} style={{
                      padding:'0.6rem 0.25rem', borderRadius:8, cursor:'pointer',
                      border:`2px solid ${metodoPago === val ? 'var(--primary)' : 'var(--border)'}`,
                      background: metodoPago === val ? 'var(--primary-light)' : 'transparent',
                      color: metodoPago === val ? 'var(--primary)' : 'var(--text-muted)',
                      fontWeight:700, fontSize:'0.8rem', display:'flex', flexDirection:'column', alignItems:'center', gap:4,
                    }}>
                      <span style={{ fontSize:'1.1rem' }}>{ico}</span>
                      <span>{lbl}</span>
                    </button>
                  ))}
                </div>
              </div>
              {formError && <div style={{ background:'#fef2f2', color:'#dc2626', borderRadius:8, padding:'0.6rem 0.75rem', marginBottom:'1rem', fontSize:'0.82rem', fontWeight:600 }}>{formError}</div>}
              <button className="btn w-full" style={{ justifyContent:'center', gap:6, background: tipo === 'ingreso' ? '#16a34a' : '#dc2626', color:'white', fontWeight:700, opacity: saving ? 0.7 : 1 }}
                onClick={handleSubmit} disabled={saving}>
                {saving
                  ? <><RefreshCw size={15} style={{ animation:'spin 1s linear infinite' }} /> Guardando...</>
                  : carrito.length > 0
                    ? <><ShoppingBag size={15} /> Registrar Venta · ₲{fmt(totalCarrito)}</>
                    : <><Plus size={15} /> {tipo === 'ingreso' ? 'Registrar Ingreso' : 'Registrar Egreso'}</>}
              </button>
            </div>
          </div>

        </div>
      </div>
      )}
    </div>
  );
}

// ─── MobileApp ───────────────────────────────────────────────────────────────
export default function MobileApp({ machines, onLogout, onRecordSaved, userId, userNombre, userUser, userRol, tieneCaja = false, darkMode = false, onToggleDark }) {
  // view: home | map | run | stopAction | record | mantencion | history | tareas | perfil
  const [view, setView]                   = useState('home');
  const [activeRun, setActiveRun]         = useState(null);
  const [selectedStop, setSelectedStop]   = useState(null);
  const [selectedMachine, setSelectedMachine] = useState(null);
  const [tipos, setTipos]                 = useState(null);
  const [todayRecords, setTodayRecords]   = useState([]);
  const [scanOpen, setScanOpen]           = useState(false);
  const [scanFeedback, setScanFeedback]   = useState(null); // { type:'success'|'warn'|'error', msg }
  const [tareas, setTareas]               = useState([]);
  const [loadingTareas, setLoadingTareas] = useState(false);
  const [assignedRun, setAssignedRun]     = useState(null); // run aceptado → mapa asignado
  const [completedRuns, setCompletedRuns] = useState([]);   // historial de recorridos
  const [completedRunInfo, setCompletedRunInfo] = useState(null); // snapshot del run recién finalizado
  const [machineSearchOpen, setMachineSearchOpen] = useState(false); // modal buscar máquina
  const [finishing, setFinishing]         = useState(false); // guard: doble-tap handleFinish
  const [addingMachine, setAddingMachine] = useState(false); // guard: doble-tap handleAddMachine

  // ── Back button (Android hardware — via @capacitor/app) ────────────────────
  const viewRef        = useRef(view);
  const selectedStopRef = useRef(selectedStop);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { selectedStopRef.current = selectedStop; }, [selectedStop]);

  useEffect(() => {
    const BACK = {
      map:        'home',
      run:        'home',
      history:    'home',
      tareas:     'home',
      perfil:     'home',
      caja:       'home',
      completed:  'home',
      stopAction: 'run',
      get record() { return selectedStopRef.current ? 'stopAction' : 'run'; },
      mantencion: 'stopAction',
    };

    let handle;
    CapacitorApp.addListener('backButton', () => {
      // Desde el mapa (siempre vienen de la ruta) → volver a run
      if (viewRef.current === 'map') {
        setView('run');
        return;
      }
      const dest = BACK[viewRef.current];
      if (dest) {
        setView(dest);
      }
      // En 'home' no hacemos nada → la app NO se cierra
    }).then(h => { handle = h; });

    return () => { handle?.remove(); };
  }, []);
  // ───────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    getTipos().then(setTipos).catch(() => null);
    loadRecords();
    loadTareas();
    loadHistorial();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling automático de tareas cada 60 segundos ────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      // Solo refrescar si no hay un recorrido activo (para no interrumpir al recaudador)
      if (!activeRun) loadTareas();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [activeRun]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Acción pendiente desde ScanPage (/scan/:id → boton → localStorage) ────
  useEffect(() => {
    if (!machines?.length) return;
    const raw = localStorage.getItem('scan_pending');
    if (!raw) return;
    try {
      const { machineId, action } = JSON.parse(raw);
      localStorage.removeItem('scan_pending');
      const machine = machines.find(m => m.id === machineId);
      if (!machine) return;
      setSelectedMachine(machine);
      setSelectedStop(null);
      setView(action === 'mantencion' ? 'mantencion' : 'record');
    } catch {
      localStorage.removeItem('scan_pending');
    }
  }, [machines]);

  async function loadTareas() {
    setLoadingTareas(true);
    try {
      const data = await getMisTareas();
      setTareas(data);

      // Si hay una ruta ya ACTIVA en el backend, restaurarla en el módulo Ruta
      // (útil cuando la página recarga y el estado local se pierde)
      const activa = data.find(t => t.status === 'active');
      if (activa) {
        const stops = (activa.stops ?? []).map(s => ({
          id: s.id,
          machineId: s.machineId ?? s.machine_id,
          status: s.status ?? 'pending',
          visitedAt: s.visitedAt ?? null,
          coords: s.coords ?? null,
          location: s.location ?? null,
          type: s.type ?? null,
        }));
        const formattedRun = { id: activa.id, stops };
        setActiveRun(prev => prev ?? formattedRun);   // solo si aún no está seteado
        setAssignedRun(prev => prev ?? formattedRun);
      }
    } catch { /* offline */ }
    finally { setLoadingTareas(false); }
  }

  async function loadHistorial() {
    try {
      const data = await getMiHistorial();
      setCompletedRuns(data);
    } catch { /* offline */ }
  }

  async function loadRecords() {
    try {
      const all = await getRecords();
      // Use local date (not UTC) to avoid mismatching records near midnight in Paraguay (UTC-4)
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setTodayRecords(all.filter(r => r.date === today));
    } catch { /* offline */ }
  }

  function handleRunStarted(runId, apiStops, orderedMachines) {
    const stops = apiStops.map((s, i) => ({
      ...s,
      machineId: orderedMachines[i]?.id ?? s.machine_id,
      status: 'pending',
    }));
    setActiveRun({ id: runId, stops });
    setView('run');
  }

  // Cuando el recaudador acepta (o continúa) una tarea asignada → inicia en módulo de ruta
  function handleTareaAceptada(run) {
    const stops = (run.stops ?? []).map(s => ({
      id: s.id,
      machineId: s.machineId ?? s.machine_id,
      status: s.status ?? 'pending',
      visitedAt: s.visitedAt ?? null,
      coords: s.coords ?? null,
      location: s.location ?? null,
      type: s.type ?? null,
    }));
    const formattedRun = { id: run.id, stops };
    setActiveRun(formattedRun);
    setAssignedRun(formattedRun); // guardamos para que el mapa use solo estas máquinas
    setTareas(prev => prev.filter(t => t.id !== run.id));
    setView('home'); // → módulo Ruta muestra detalles + botón "Empezar ruta"
  }

  // "Registrar" en StopList → ir a StopActionView (elegir Recaudación o Mantención)
  function handleStopAction(stop, machine) {
    setSelectedStop(stop);
    setSelectedMachine(machine);
    setView('stopAction');
  }

  async function handleSkip(stop) {
    if (!activeRun) return;
    await updateStop(activeRun.id, stop.id, 'failed').catch(() => null);
    setActiveRun(prev => ({
      ...prev,
      stops: prev.stops.map(s => s.id === stop.id ? { ...s, status: 'failed' } : s),
    }));
  }

  async function handleFinish() {
    if (!activeRun || finishing) return;
    setFinishing(true);
    try {
      const allDone  = activeRun.stops.every(s => s.status !== 'pending');
      const snapshot = { ...activeRun, finalStatus: allDone ? 'completed' : 'cancelled' };
      await updateRouteRun(activeRun.id, { status: snapshot.finalStatus }).catch(() => null);
      setActiveRun(null);
      setAssignedRun(null);
      await Promise.all([loadTareas(), loadHistorial()]);
      setCompletedRunInfo(snapshot);
      setView('completed');
    } finally {
      setFinishing(false);
    }
  }

  // Actualiza el stop indicado a 'done' en activeRun y assignedRun; devuelve allDone
  function markStopDone(stopId) {
    // Computar desde el estado actual (snapshot síncrono), no desde el updater,
    // para evitar lecturas de variables capturadas en una closure stale.
    const currentRun = activeRun;
    if (!currentRun) return false;
    const newStops = currentRun.stops.map(s => s.id === stopId ? { ...s, status: 'done' } : s);
    const allDone  = newStops.every(s => s.status !== 'pending');
    const runId    = currentRun.id;
    const updated  = { ...currentRun, stops: newStops };
    setActiveRun(updated);
    setAssignedRun(prev => prev ? { ...prev, stops: newStops } : prev);
    if (allDone) updateRouteRun(runId, { status: 'completed' }).catch(() => null);
    return allDone;
  }

  async function handleRecordSaved() {
    const stopId = selectedStop?.id;
    const allDone = stopId ? markStopDone(stopId) : false;
    if (allDone) { setAssignedRun(null); await Promise.all([loadTareas(), loadHistorial()]); }
    await loadRecords();
    onRecordSaved?.();
    setView(activeRun ? 'run' : 'home');
  }

  async function handleMantencionSaved() {
    if (activeRun && selectedStop) {
      await updateStop(activeRun.id, selectedStop.id, 'done').catch(() => null);
      const allDone = markStopDone(selectedStop.id);
      if (allDone) { setAssignedRun(null); await Promise.all([loadTareas(), loadHistorial()]); }
    }
    setView(activeRun ? 'run' : 'home');
  }

  async function handleQRScan(machineId) {
    setScanOpen(false);

    // Buscar la máquina en la lista maestra
    const machine = machines.find(m => m.id === machineId);
    if (!machine) {
      setScanFeedback({ type: 'error', msg: `Máquina "${machineId}" no encontrada en el sistema.` });
      setTimeout(() => setScanFeedback(null), 4000);
      return;
    }

    if (activeRun) {
      // Buscar parada correspondiente en la ruta activa
      const stop = activeRun.stops.find(s => s.machineId === machineId);
      if (stop) {
        if (stop.status === 'done') {
          setScanFeedback({ type: 'warn', msg: `${machineId} ya fue registrada en esta ruta.` });
          setTimeout(() => setScanFeedback(null), 3500);
          return;
        }
        if (stop.status === 'failed') {
          setScanFeedback({ type: 'warn', msg: `${machineId} fue marcada como saltada.` });
          setTimeout(() => setScanFeedback(null), 3500);
          return;
        }
        // Pendiente — navegar directo a la acción (Recaudación / Mantención)
        setSelectedStop(stop);
        setSelectedMachine(machine);
        setView('stopAction');
        return;
      }

      // Máquina no estaba en la ruta — agregarla como parada extra
      setScanFeedback({ type: 'warn', msg: `${machineId} no estaba en la ruta. Agregando como parada extra…` });
      setTimeout(() => setScanFeedback(null), 3500);
      await handleAddMachine(machine);
      return;
    }

    // Sin ruta activa: ir directo a Recaudación/Mantención (sin parada formal)
    setSelectedStop(null);
    setSelectedMachine(machine);
    setView('stopAction');
  }

  // Agrega una máquina al run activo (si no está ya) y navega a stopAction
  async function handleAddMachine(machine) {
    if (addingMachine) return;
    setMachineSearchOpen(false);

    if (activeRun) {
      // ¿Ya está en la ruta?
      const existingStop = activeRun.stops.find(s => s.machineId === machine.id);
      if (existingStop) {
        setSelectedStop(existingStop);
        setSelectedMachine(machine);
        setView('stopAction');
        return;
      }

      // Agregar como parada extra al run
      setAddingMachine(true);
      try {
        const updatedRun = await addStopToRun(activeRun.id, machine.id);
        const stops = (updatedRun.stops ?? []).map(s => ({
          id: s.id,
          machineId: s.machineId ?? s.machine_id,
          status: s.status ?? 'pending',
          visitedAt: s.visitedAt ?? null,
          coords: s.coords ?? null,
          location: s.location ?? null,
          type: s.type ?? null,
        }));
        const formattedRun = { id: updatedRun.id, stops };
        setActiveRun(formattedRun);
        setAssignedRun(formattedRun);
        const newStop = stops.find(s => s.machineId === machine.id);
        setSelectedStop(newStop ?? null);
      } catch (err) {
        console.error('[handleAddMachine]', err);
        setScanFeedback({ type: 'error', msg: 'Error al agregar la máquina a la ruta' });
        setTimeout(() => setScanFeedback(null), 3500);
        setSelectedStop(null);
      } finally {
        setAddingMachine(false);
      }
    } else {
      setSelectedStop(null);
    }

    setSelectedMachine(machine);
    setView('stopAction');
  }

  const tareasPendientes = tareas.filter(t => t.status === 'pending').length;

  const navItems = [
    { id: 'home',    icon: Route,          label: 'Ruta' },
    { id: 'tareas',  icon: ClipboardCheck, label: 'Tareas', badge: tareasPendientes },
    { id: 'caja',    icon: Wallet,         label: 'Caja' },
    { id: 'history', icon: History,        label: 'Historial' },
    { id: 'perfil',  icon: UserCircle,     label: 'Perfil' },
  ];

  // ── Map view: full-screen (solo máquinas del recorrido asignado) ────────────
  if (view === 'map') {
    const runForMap = activeRun ?? assignedRun;
    const mapMachines = (runForMap?.stops ?? [])
      .filter(s => s.coords)
      .map(s => ({
        id: s.machineId,
        coords: s.coords,
        location: s.location ?? s.machineId,
        type: s.type ?? '',
        lgrId: null,
        tmqId: null,
      }));

    function handleMapStopAction(stopId, machineId, actionType) {
      const stop    = runForMap?.stops.find(s => s.id === stopId);
      const machine = machines.find(m => m.id === machineId);
      if (!stop || !machine) return;
      setSelectedStop(stop);
      setSelectedMachine(machine);
      // Navegar al formulario correspondiente (saldrá del mapa)
      setView(actionType === 'record' ? 'record' : 'mantencion');
    }

    return (
      <div style={{ width: '100%', height: '100dvh', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, zIndex: 1001 }}>
          <button
            onClick={() => setView('run')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}
          >
            <ArrowLeft size={16} /> Volver a ruta
          </button>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>
            Recorrido #{runForMap?.id}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <MapView
            machines={mapMachines}
            mobile={true}
            onRunStarted={null}
            preloadedRun={runForMap}
            onStopAction={handleMapStopAction}
          />
        </div>
      </div>
    );
  }

  // ── StopAction, Record, Mantencion: full-screen no-nav ───────────────────
  if (view === 'stopAction' && selectedMachine) {
    return (
      <div style={{ width: '100%', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-color)', paddingTop: 'env(safe-area-inset-top)' }}>
        <StopActionView
          stop={selectedStop}
          machine={selectedMachine}
          onRecaudacion={() => setView('record')}
          onMantencion={() => setView('mantencion')}
          onBack={() => setView(activeRun ? 'run' : 'home')}
        />
      </div>
    );
  }

  if (view === 'record' && selectedMachine) {
    return (
      <div style={{ width: '100%', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-color)', paddingTop: 'env(safe-area-inset-top)' }}>
        <RecordForm
          machine={selectedMachine}
          stop={selectedStop}
          runId={activeRun?.id}
          tipos={tipos}
          onSaved={handleRecordSaved}
          onBack={() => setView(selectedStop ? 'stopAction' : activeRun ? 'run' : 'home')}
        />
      </div>
    );
  }

  if (view === 'mantencion' && selectedMachine) {
    return (
      <div style={{ width: '100%', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-color)', paddingTop: 'env(safe-area-inset-top)' }}>
        <MantencionForm
          machine={selectedMachine}
          runId={activeRun?.id}
          onSaved={handleMantencionSaved}
          onBack={() => setView(selectedStop ? 'stopAction' : activeRun ? 'run' : 'home')}
        />
      </div>
    );
  }

  // ── Normal shell with top-bar + bottom-nav ───────────────────────────────
  return (
    <div style={{ width: '100%', height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg-color)' }}>
      {scanOpen && <QRScannerModal onScan={handleQRScan} onClose={() => setScanOpen(false)} />}
      {machineSearchOpen && (
        <MachineSearchModal
          machines={machines}
          activeRun={activeRun}
          onSelect={handleAddMachine}
          onScanQR={() => { setMachineSearchOpen(false); setScanOpen(true); }}
          onClose={() => setMachineSearchOpen(false)}
        />
      )}

      {/* Scan feedback toast */}
      {scanFeedback && (
        <div style={{
          position: 'fixed', top: 'calc(env(safe-area-inset-top) + 1rem)', left: '1rem', right: '1rem', zIndex: 8000,
          padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', fontWeight: 600,
          background: scanFeedback.type === 'error' ? '#fef2f2' : scanFeedback.type === 'warn' ? '#fffbeb' : '#f0fdf4',
          color:      scanFeedback.type === 'error' ? '#b91c1c' : scanFeedback.type === 'warn' ? '#92400e' : '#065f46',
          border: `1px solid ${scanFeedback.type === 'error' ? '#fecaca' : scanFeedback.type === 'warn' ? '#fde68a' : '#a7f3d0'}`,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <AlertCircle size={16} />
          {scanFeedback.msg}
        </div>
      )}

      {/* Top bar — paddingTop incluye el safe-area para la barra de estado */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', paddingTop: 'calc(0.75rem + env(safe-area-inset-top))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>MAISONTECH App</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          {/* Botón QR — siempre visible; abre el escáner y navega a Recaudación/Mantención */}
          <button
            onClick={() => setScanOpen(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.4rem 0.8rem', borderRadius: 'var(--radius-sm)',
              background: 'var(--primary)', color: 'white',
              border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: '0.78rem',
              boxShadow: '0 2px 8px rgba(79,70,229,0.35)',
            }}
          >
            <QrCode size={15} /> Escanear QR
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'home' && (
          <HomeView
            activeRun={activeRun}
            onEmpezarRuta={() => setView('run')}
            userNombre={userNombre}
            todayRecords={todayRecords}
          />
        )}
        {view === 'tareas' && (
          <TareasView
            tareas={tareas}
            loading={loadingTareas}
            onAceptar={handleTareaAceptada}
            onRefresh={loadTareas}
          />
        )}
        {view === 'run' && !activeRun && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', padding: '2rem 1.5rem', textAlign: 'center', gap: '0.75rem' }}>
            <Route size={44} style={{ opacity: 0.25, marginBottom: '0.25rem' }} />
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-main)' }}>Sin ruta activa</div>
            <div style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
              Revisá la pestaña <b>Tareas</b> para aceptar un recorrido asignado,<br />
              o pedile al administrador que te asigne uno.
            </div>
            <button
              onClick={() => setView('tareas')}
              style={{ marginTop: '0.5rem', padding: '0.65rem 1.5rem', borderRadius: 'var(--radius-md)', background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '0.4rem', boxShadow: '0 4px 12px rgba(79,70,229,0.3)' }}
            >
              <ClipboardCheck size={15} /> Ver mis tareas
            </button>
          </div>
        )}
        {view === 'run' && activeRun && (
          <StopList
            run={activeRun}
            machines={machines}
            onAction={handleStopAction}
            onSkip={handleSkip}
            onFinish={handleFinish}
            onScanQR={() => setScanOpen(true)}
            onVerMapa={assignedRun ? () => setView('map') : null}
            onAgregarMaquina={() => setMachineSearchOpen(true)}
            finishing={finishing}
          />
        )}
        {view === 'caja' && <CajaMobileView machines={machines} activeRun={activeRun} />}
        {view === 'history' && <HistoryView completedRuns={completedRuns} />}
        {view === 'perfil' && (
          <ProfileView
            userId={userId}
            userNombre={userNombre ?? 'Usuario'}
            userUser={userUser ?? ''}
            userRol={userRol ?? 'terreno'}
            onLogout={onLogout}
            hasActiveRun={!!activeRun}
            darkMode={darkMode}
            onToggleDark={onToggleDark}
          />
        )}
        {view === 'completed' && (
          <CompletedView
            runInfo={completedRunInfo}
            onGoHome={() => { setCompletedRunInfo(null); setView('home'); }}
            onGoHistory={() => { setCompletedRunInfo(null); setView('history'); }}
          />
        )}
      </div>

      {/* Bottom nav — paddingBottom incluye el safe-area para la barra de gestos */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--border)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map(({ id, icon: NavIcon, label, badge }) => {
          const isActive = view === id || (view === 'run' && id === 'home');
          return (
            <button
              key={id}
              onClick={() => { setCompletedRunInfo(null); setView(id); }}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: '0.25rem', padding: '0.75rem 0', border: 'none', background: 'none', cursor: 'pointer',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400, fontSize: '0.72rem',
                borderTop: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                position: 'relative',
              }}
            >
              <div style={{ position: 'relative', display: 'inline-flex' }}>
                <NavIcon size={20} />
                {badge > 0 && (
                  <span style={{
                    position: 'absolute', top: -5, right: -7,
                    background: '#ea580c', color: 'white',
                    borderRadius: '50%', width: 16, height: 16,
                    fontSize: '0.58rem', fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '1.5px solid var(--surface)',
                  }}>{badge > 9 ? '9+' : badge}</span>
                )}
              </div>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
