import { useState, useEffect } from 'react';
import { getMachine, getToken } from './api';
import { Wrench, Save, ArrowRight, Loader2, AlertCircle, LogIn, QrCode } from 'lucide-react';

export default function ScanPage({ machineId }) {
    const [machine, setMachine] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const isLoggedIn = !!getToken();

    useEffect(() => {
        getMachine(machineId)
            .then(m => setMachine(m))
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, [machineId]);

    function handleAction(action) {
        // Guardar acción pendiente para que MobileApp la retome
        localStorage.setItem('scan_pending', JSON.stringify({ machineId, action }));
        window.location.replace('/');
    }

    /* ── Loading ── */
    if (loading) return (
        <div style={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center', background: '#f5f5ff' }}>
            <Loader2 size={36} style={{ color: '#4f46e5', animation: 'spin 1s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );

    /* ── Error ── */
    if (error || !machine) return (
        <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2rem', background: '#f5f5ff', textAlign: 'center' }}>
            <AlertCircle size={52} color="#ef4444" />
            <p style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1e1e2e', margin: 0 }}>Máquina no encontrada</p>
            <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: 0 }}>El código QR no corresponde a ninguna máquina registrada.</p>
            <button
                onClick={() => window.location.replace('/')}
                style={{ marginTop: 8, padding: '0.65rem 1.6rem', background: '#4f46e5', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}
            >
                Ir al inicio
            </button>
        </div>
    );

    /* ── Scan landing page ── */
    return (
        <div style={{
            minHeight: '100dvh',
            background: 'linear-gradient(160deg, #eef2ff 0%, #f9fafb 60%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.5rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
            <div style={{ width: '100%', maxWidth: 380 }}>

                {/* ── Card ── */}
                <div style={{ background: 'white', borderRadius: 24, boxShadow: '0 12px 48px rgba(79,70,229,0.14)', overflow: 'hidden' }}>

                    {/* Banner superior */}
                    <div style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)', padding: '2rem 1.5rem 1.75rem', textAlign: 'center' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 48, height: 48, background: 'rgba(255,255,255,0.2)', borderRadius: '50%', marginBottom: '0.85rem' }}>
                            <QrCode size={24} color="white" />
                        </div>
                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'rgba(255,255,255,0.65)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '0.3rem' }}>
                            MÁQUINA ESCANEADA
                        </div>
                        <div style={{ fontSize: '1.45rem', fontWeight: 800, color: 'white', lineHeight: 1.2 }}>
                            {machine.location}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', marginTop: '0.3rem', letterSpacing: '0.5px' }}>
                            {machine.id}
                        </div>
                        {machine.tipo_nombre && (
                            <span style={{
                                display: 'inline-block', marginTop: '0.65rem',
                                padding: '0.22rem 0.9rem', background: 'rgba(255,255,255,0.2)',
                                borderRadius: 20, fontSize: '0.7rem', color: 'white', fontWeight: 600,
                            }}>
                                {machine.tipo_nombre}
                            </span>
                        )}
                    </div>

                    {/* Botones de acción */}
                    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p style={{ textAlign: 'center', fontSize: '0.78rem', color: '#9ca3af', margin: '0 0 0.25rem' }}>
                            Seleccioná la acción a realizar
                        </p>

                        {/* Recaudación */}
                        <button
                            onClick={() => handleAction('recaudacion')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.65rem',
                                padding: '1rem 1.1rem', borderRadius: 14, border: 'none',
                                background: '#4f46e5', color: 'white',
                                fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                                boxShadow: '0 4px 16px rgba(79,70,229,0.35)',
                                transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, background: 'rgba(255,255,255,0.2)', borderRadius: '50%' }}>
                                <Save size={18} />
                            </span>
                            Recaudación
                            <ArrowRight size={18} style={{ marginLeft: 'auto' }} />
                        </button>

                        {/* Mantención */}
                        <button
                            onClick={() => handleAction('mantencion')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.65rem',
                                padding: '1rem 1.1rem', borderRadius: 14, border: 'none',
                                background: '#f59e0b', color: 'white',
                                fontSize: '1rem', fontWeight: 700, cursor: 'pointer',
                                boxShadow: '0 4px 16px rgba(245,158,11,0.35)',
                                transition: 'opacity 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '0.88'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                        >
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, background: 'rgba(255,255,255,0.2)', borderRadius: '50%' }}>
                                <Wrench size={18} />
                            </span>
                            Mantención
                            <ArrowRight size={18} style={{ marginLeft: 'auto' }} />
                        </button>

                        {/* Aviso login si no está autenticado */}
                        {!isLoggedIn && (
                            <div style={{
                                marginTop: '0.25rem', padding: '0.7rem 0.85rem',
                                background: '#f3f4f6', borderRadius: 10,
                                display: 'flex', alignItems: 'center', gap: '0.5rem',
                                fontSize: '0.75rem', color: '#6b7280',
                            }}>
                                <LogIn size={15} color="#4f46e5" style={{ flexShrink: 0 }} />
                                Se pedirá inicio de sesión al continuar
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <p style={{ textAlign: 'center', fontSize: '0.7rem', color: '#c4b5fd', marginTop: '1.25rem' }}>
                    MaisonTech · Sistema de Gestión
                </p>
            </div>
        </div>
    );
}
