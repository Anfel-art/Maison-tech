import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  ArrowLeft, CheckCircle, XCircle, MapPin, Camera, Save,
  History, Route, LogOut, ChevronRight, AlertCircle, Wrench,
  Calculator, X, Plus, Trash2, ClipboardList, Navigation, Map, QrCode,
  ClipboardCheck, Bell, Search,
} from 'lucide-react';
import { Html5Qrcode } from 'html5-qrcode';
import MapView from './MapView';
import { getTipos, createRecord, uploadRecordImage, updateStop, addStopToRun, updateRouteRun, getRecords, createMaintenance, getLastRecord, getMisTareas, getMiHistorial, aceptarRecorrido } from './api';

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n) => Math.round(n || 0).toLocaleString('es-PY');

/** Evaluate a campo formula: replaces {key} and {prev:key} refs with actual values.
 *  prevValues = camposExtra of the last saved record for this machine. */
function evalFormula(formula, values, computedSoFar, prevValues = {}) {
  if (!formula) return 0;
  let expr = formula
    .replace(/\{prev:(\w+)\}/g, (_, key) => { const v = prevValues[key]; return parseFloat(v) || 0; })
    .replace(/\{(\w+)\}/g, (_, key) => {
      if (key in computedSoFar) return computedSoFar[key];
      return parseFloat(values[key]) || 0;
    });
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return 0;
  try { return new Function('return ' + expr)(); } // eslint-disable-line no-new-func
  catch { return 0; }
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
  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: parseFloat(value) < 0 ? '#ef4444' : 'var(--text-main)' }}>
        {typeof value === 'number' ? value.toLocaleString('es-PY', { maximumFractionDigits: 2 }) : value}
      </span>
    </div>
  );

  const visibleCampos = campos.filter(c => c.tipo !== 'constant');
  const groups = [...new Set(visibleCampos.map(c => c.grupo))];

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
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [showPreCalc, setShowPreCalc] = useState(false);
  const photoRefs = [useRef(null), useRef(null), useRef(null)];

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
                        src={URL.createObjectURL(photos[idx])}
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
const COMMON_ITEMS = ['Set cables', 'Tragamonedas', 'Teclado de 8', 'MQ USADAS', 'SSR', 'Fuente de poder', 'Pantalla', 'Motor'];

function MantencionForm({ machine, runId, onSaved, onBack }) {
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto]             = useState('');
  const [checkedItems, setCheckedItems] = useState([]);
  const [customItem, setCustomItem]   = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  function toggleItem(item) {
    setCheckedItems(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );
  }

  function addCustomItem() {
    const t = customItem.trim();
    if (!t) return;
    setCheckedItems(prev => prev.includes(t) ? prev : [...prev, t]);
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
        items:       checkedItems,
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
          {COMMON_ITEMS.map(item => (
            <button
              key={item}
              onClick={() => toggleItem(item)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', width: '100%',
                padding: '0.55rem 0.75rem', marginBottom: '0.35rem',
                borderRadius: 'var(--radius-sm)',
                border: `1px solid ${checkedItems.includes(item) ? 'rgba(79,70,229,0.5)' : 'var(--border)'}`,
                background: checkedItems.includes(item) ? 'rgba(79,70,229,0.08)' : 'var(--bg-color)',
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                border: `2px solid ${checkedItems.includes(item) ? 'var(--primary)' : 'var(--border)'}`,
                background: checkedItems.includes(item) ? 'var(--primary)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {checkedItems.includes(item) && <CheckCircle size={10} color="white" />}
              </div>
              <span style={{ fontSize: '0.85rem', color: checkedItems.includes(item) ? 'var(--primary)' : 'var(--text-main)', fontWeight: checkedItems.includes(item) ? 600 : 400 }}>
                {item}
              </span>
            </button>
          ))}

          {/* Custom item */}
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              type="text"
              placeholder="Otro producto..."
              value={customItem}
              onChange={e => setCustomItem(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCustomItem()}
              style={{ flex: 1, padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-main)', fontSize: '0.85rem', outline: 'none' }}
            />
            <button onClick={addCustomItem} style={{ padding: '0.45rem 0.6rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79,70,229,0.4)', background: 'rgba(79,70,229,0.08)', color: 'var(--primary)', cursor: 'pointer' }}>
              <Plus size={16} />
            </button>
          </div>

          {/* Items seleccionados que no están en la lista default */}
          {checkedItems.filter(i => !COMMON_ITEMS.includes(i)).map(item => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.35rem', padding: '0.45rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79,70,229,0.5)', background: 'rgba(79,70,229,0.08)' }}>
              <CheckCircle size={14} color="var(--primary)" />
              <span style={{ flex: 1, fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>{item}</span>
              <button onClick={() => toggleItem(item)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 0, display: 'flex' }}>
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

// ─── StopList (En Ruta) ──────────────────────────────────────────────────────
function StopList({ run, machines, onAction, onSkip, onFinish, onScanQR, onVerMapa, onAgregarMaquina }) {
  const stops           = run.stops ?? [];
  const firstPendingIdx = stops.findIndex(s => s.status === 'pending');
  const allHandled      = stops.every(s => s.status !== 'pending');
  const fullRouteUrl    = buildFullRouteUrl(stops, machines);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0.75rem 1rem', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>Ruta en curso</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
              {stops.filter(s => s.status === 'done').length} / {stops.length} paradas completadas
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
            <button
              onClick={onScanQR}
              title="Escanear QR de máquina"
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.65rem', borderRadius: 'var(--radius-sm)', background: 'rgba(79,70,229,0.1)', border: '1px solid rgba(79,70,229,0.3)', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <QrCode size={15} /> Escanear
            </button>
            {fullRouteUrl && (
              <a
                href={fullRouteUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.65rem', borderRadius: 'var(--radius-sm)', background: '#1a73e8', color: 'white', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 700, boxShadow: '0 2px 6px rgba(26,115,232,0.35)' }}
              >
                <Map size={15} /> Maps
              </a>
            )}
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

                {isNext && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.6rem' }}>
                    {/* Navegar a esta parada */}
                    {machine?.coords && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${machine.coords[0]},${machine.coords[1]}&travelmode=driving`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.45rem', borderRadius: 'var(--radius-sm)', background: '#1a73e8', color: 'white', textDecoration: 'none', fontSize: '0.78rem', fontWeight: 600 }}
                      >
                        <Navigation size={13} /> Navegar aquí
                      </a>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={() => machine && onAction(stop, machine)}
                        style={{ flex: 2, padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(79,70,229,0.4)', background: 'rgba(79,70,229,0.08)', color: '#4f46e5', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}
                      >
                        <ChevronRight size={14} /> Registrar
                      </button>
                      <button
                        onClick={() => onSkip(stop)}
                        style={{ flex: 1, padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#b91c1c', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}
                      >
                        Saltar
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Botón Ver Mapa — grande y prominente */}
        {onVerMapa && (
          <button
            onClick={onVerMapa}
            style={{
              width: '100%', padding: '0.875rem', borderRadius: 'var(--radius-md)',
              background: 'var(--primary)', color: 'white', border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.55rem',
              boxShadow: '0 4px 14px rgba(79,70,229,0.35)',
            }}
          >
            <MapPin size={20} /> Ver Mapa del Recorrido
          </button>
        )}
        {/* Botón Agregar Máquina */}
        <button
          onClick={onAgregarMaquina}
          style={{
            width: '100%', padding: '0.75rem', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-color)', color: 'var(--text-main)',
            border: '1px dashed var(--border)', cursor: 'pointer',
            fontWeight: 600, fontSize: '0.88rem',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          }}
        >
          <Plus size={17} /> Agregar máquina fuera de ruta
        </button>
        <button
          onClick={onFinish}
          style={{ width: '100%', padding: '0.875rem', borderRadius: 'var(--radius-md)', background: allHandled ? '#10b981' : '#ef4444', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          {allHandled ? <><CheckCircle size={18} /> Finalizar Ruta</> : <><XCircle size={18} /> Cancelar Ruta</>}
        </button>
      </div>
    </div>
  );
}

// ─── HistoryView ─────────────────────────────────────────────────────────────
function HistoryView({ completedRuns }) {
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
      <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.75rem', padding: '0 0.25rem' }}>
        Historial de Recorridos
      </div>

      {completedRuns.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          <History size={38} style={{ marginBottom: '0.6rem', opacity: 0.3 }} />
          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.3rem' }}>Sin recorridos completados</div>
          <div style={{ fontSize: '0.75rem', lineHeight: 1.5 }}>Los recorridos finalizados aparecerán aquí.</div>
        </div>
      )}

      {completedRuns.map(run => {
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

// ─── TareasView ──────────────────────────────────────────────────────────────
function TareasView({ tareas, loading, onAceptar, onRefresh }) {
  const [aceptando, setAceptando] = React.useState(null); // runId en proceso

  async function handleAceptar(run) {
    setAceptando(run.id);
    try {
      const runActivo = await aceptarRecorrido(run.id);
      onAceptar(runActivo);
    } catch (e) {
      alert(e.message || 'Error al aceptar el recorrido');
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
function HomeView({ activeRun, onEmpezarRuta }) {
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
        <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-main)' }}>Hola, Recaudador 👋</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.15rem', textTransform: 'capitalize' }}>{today}</div>
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

// ─── MobileApp ───────────────────────────────────────────────────────────────
export default function MobileApp({ machines, onLogout, onRecordSaved, userId }) {
  // view: home | map | run | stopAction | record | mantencion | history | tareas
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
  const [machineSearchOpen, setMachineSearchOpen] = useState(false); // modal buscar máquina

  // ── Back button (Android hardware — via @capacitor/app) ────────────────────
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    const BACK = {
      map: 'home', run: 'home', history: 'home', tareas: 'home',
      stopAction: 'run',
      record: selectedStop ? 'stopAction' : 'run',
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
      const all   = await getRecords();
      const today = new Date().toISOString().slice(0, 10);
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
    if (!activeRun) return;
    const allDone = activeRun.stops.every(s => s.status !== 'pending');
    await updateRouteRun(activeRun.id, { status: allDone ? 'completed' : 'cancelled' }).catch(() => null);
    setActiveRun(null);
    setAssignedRun(null); // limpiar el run asignado al terminar
    await Promise.all([loadTareas(), loadHistorial()]); // refrescar tareas e historial
    setView('home');
  }

  // Actualiza el stop indicado a 'done' en activeRun y assignedRun; devuelve allDone
  function markStopDone(stopId) {
    let allDone = false;
    const updater = prev => {
      if (!prev) return prev;
      const newStops = prev.stops.map(s => s.id === stopId ? { ...s, status: 'done' } : s);
      allDone = newStops.every(s => s.status !== 'pending');
      return { ...prev, stops: newStops };
    };
    setActiveRun(prev => {
      const next = updater(prev);
      if (allDone && prev) updateRouteRun(prev.id, { status: 'completed' }).catch(() => null);
      return next;
    });
    setAssignedRun(updater);
    return allDone;
  }

  async function handleRecordSaved() {
    const stopId = selectedStop?.id;
    const allDone = stopId ? markStopDone(stopId) : false;
    if (allDone) { setAssignedRun(null); await Promise.all([loadTareas(), loadHistorial()]); }
    await loadRecords();
    onRecordSaved?.();
    setView('run');
  }

  async function handleMantencionSaved() {
    if (activeRun && selectedStop) {
      await updateStop(activeRun.id, selectedStop.id, 'done').catch(() => null);
      const allDone = markStopDone(selectedStop.id);
      if (allDone) { setAssignedRun(null); await Promise.all([loadTareas(), loadHistorial()]); }
    }
    setView('run');
  }

  async function handleQRScan(machineId) {
    setScanOpen(false);

    // Find machine in the master list
    const machine = machines.find(m => m.id === machineId);
    if (!machine) {
      setScanFeedback({ type: 'error', msg: `Máquina "${machineId}" no encontrada en el sistema.` });
      setTimeout(() => setScanFeedback(null), 4000);
      return;
    }

    if (activeRun) {
      // Find matching stop in current route
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
        // Pending — navigate directly, respecting out-of-order scan
        setSelectedStop(stop);
        setSelectedMachine(machine);
        setView('stopAction');
        return;
      }
    }

    // Machine not in route — agregarla al run y navegar
    setScanFeedback({ type: 'warn', msg: `${machineId} no estaba en la ruta. Agregando como parada extra…` });
    setTimeout(() => setScanFeedback(null), 3500);
    await handleAddMachine(machine);
  }

  // Agrega una máquina al run activo (si no está ya) y navega a stopAction
  async function handleAddMachine(machine) {
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
      } catch {
        // Si falla (ej. ya existe), igual dejar registrar sin stop formal
        setSelectedStop(null);
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
    { id: 'history', icon: History,        label: 'Historial' },
    { id: 'logout',  icon: LogOut,         label: 'Salir' },
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
          onBack={() => setView('run')}
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
          onBack={() => setView(selectedStop ? 'stopAction' : 'run')}
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
          onBack={() => setView('stopAction')}
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
        <span style={{ fontWeight: 700, fontSize: '1rem' }}>SEPRISA Terreno</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {new Date().toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {view === 'home' && (
          <HomeView
            activeRun={activeRun}
            onEmpezarRuta={() => setView('run')}
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
          />
        )}
        {view === 'history' && <HistoryView completedRuns={completedRuns} />}
      </div>

      {/* Bottom nav — paddingBottom incluye el safe-area para la barra de gestos */}
      <div style={{ display: 'flex', background: 'var(--surface)', borderTop: '1px solid var(--border)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {navItems.map(({ id, icon: NavIcon, label, badge }) => {
          const isActive = view === id || (view === 'run' && id === 'home');
          return (
            <button
              key={id}
              onClick={() => {
                if (id === 'logout') onLogout();
                else setView(id); // 'home' siempre va a HomeView (muestra la tarjeta del recorrido)
              }}
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
