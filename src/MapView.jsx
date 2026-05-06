import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet-routing-machine';
import { CheckCircle, XCircle, Play, Square, MapPin, GripVertical, Plus, Save, Wrench, QrCode, ScanLine } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { createRouteRun, updateRouteRun, updateStop } from './api';

const DEFAULT_CENTER = [-0.225, -78.397]; // Tumbaco, Ecuador

function makeIcon(label, color) {
    return L.divIcon({
        className: '',
        html: `<div style="background:${color};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:13px;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);">${label}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });
}

function makeIconDot() {
    return L.divIcon({
        className: '',
        html: `<div style="background:#9ca3af;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });
}

function makeUserLocationIcon() {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:24px;height:24px;">
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:24px;height:24px;background:rgba(37,99,235,0.2);border-radius:50%;animation:userPulse 2s ease-out infinite;"></div>
            <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:14px;height:14px;background:#2563eb;border-radius:50%;border:2.5px solid white;box-shadow:0 2px 8px rgba(37,99,235,0.6);z-index:2;"></div>
        </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
    });
}

function markerColor(status, isNext) {
    if (status === 'done') return '#10b981';
    if (status === 'failed') return '#ef4444';
    if (isNext) return '#4f46e5';
    return '#9ca3af';
}

/** Si varias máquinas comparten coords exactas, las dispersa en un pequeño círculo (~15 m). */
function spreadDuplicateCoords(machines) {
    const seen = {};
    return machines.map(m => {
        if (!m.coords) return m;
        const key = `${m.coords[0].toFixed(5)},${m.coords[1].toFixed(5)}`;
        if (!seen[key]) { seen[key] = []; }
        seen[key].push(m);
        const idx   = seen[key].length - 1;
        const total = 1; // se ajusta en segundo paso
        return { ...m, _spreadKey: key, _spreadIdx: idx };
    }).map(m => {
        if (!m.coords || m._spreadIdx === undefined) return m;
        const group = seen[m._spreadKey];
        if (group.length === 1) return m; // único en ese punto, sin cambio
        const angle   = (2 * Math.PI / group.length) * m._spreadIdx - Math.PI / 2;
        const radius  = 0.00015; // ~16 m en Ecuador
        return {
            ...m,
            coords: [
                m.coords[0] + Math.cos(angle) * radius,
                m.coords[1] + Math.sin(angle) * radius,
            ],
        };
    });
}

export default function MapView({ machines, onBack, mobile = false, onRunStarted, preloadedRun = null, onStopAction = null }) {
    const stops = spreadDuplicateCoords(machines.filter(m => m.coords));

    const containerRef = useRef(null);
    const mapRef = useRef(null);
    const routingRef = useRef(null);
    const markersRef = useRef([]);
    // Si preloadedRun, el modo viaje arranca directo → inicializar con los stops con coords
    const activeStopsRef = useRef(preloadedRun ? stops.slice() : []);
    const dragIdxRef = useRef(null);
    const touchDragRef = useRef(null); // { idx, startY }

    const [orderedStops, setOrderedStops] = useState(() => stops.slice());
    // Si hay un run pre-asignado, arrancamos directo en modo viaje
    const [isTraveling, setIsTraveling] = useState(() => !!preloadedRun);
    const [statuses, setStatuses] = useState(() => {
        if (!preloadedRun) return [];
        // Alinear statuses con stops (sólo los que tienen coords)
        return stops.map(m => {
            const rs = preloadedRun.stops?.find(s => s.machineId === m.id);
            return rs?.status ?? 'pending';
        });
    });
    const [accumulated, setAccumulated] = useState({ distance: 0, time: 0 });
    const [segmentStats, setSegmentStats] = useState({ distance: 0, time: 0 });
    const [runId, setRunId] = useState(() => preloadedRun?.id ?? null);
    const [stopIds, setStopIds] = useState(() => {
        if (!preloadedRun) return [];
        // Alinear IDs de paradas con stops (sólo los que tienen coords)
        return stops.map(m => {
            const rs = preloadedRun.stops?.find(s => s.machineId === m.id);
            return rs?.id ?? null;
        });
    });
    const [panelOpen, setPanelOpen] = useState(false);
    const [qrModal, setQrModal] = useState(null); // { stopIdx, stopId, machineId, machineName }
    const [userLocation, setUserLocation] = useState(null);
    const userMarkerRef = useRef(null);
    const watchIdRef    = useRef(null);

    const firstPendingIdx = statuses.findIndex(s => s === 'pending');
    const allHandled = isTraveling && firstPendingIdx === -1;
    const excludedStops = stops.filter(m => !orderedStops.some(s => s.id === m.id));

    function haversine([lat1, lon1], [lat2, lon2]) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function optimizeOrder() {
        if (orderedStops.length < 3) return;
        const remaining = orderedStops.slice(1);
        const optimized = [orderedStops[0]];
        while (remaining.length > 0) {
            const last = optimized[optimized.length - 1];
            let nearestIdx = 0;
            let minDist = haversine(last.coords, remaining[0].coords);
            for (let i = 1; i < remaining.length; i++) {
                const d = haversine(last.coords, remaining[i].coords);
                if (d < minDist) { minDist = d; nearestIdx = i; }
            }
            optimized.push(remaining.splice(nearestIdx, 1)[0]);
        }
        setOrderedStops(optimized);
    }

    function toggleStop(m) {
        if (isTraveling) return;
        if (orderedStops.some(s => s.id === m.id)) {
            setOrderedStops(prev => prev.filter(s => s.id !== m.id));
        } else {
            setOrderedStops(prev => [...prev, m]);
        }
    }

    function onDragStart(e, i) {
        dragIdxRef.current = i;
        e.dataTransfer.effectAllowed = 'move';
    }

    function onDragEnter(e, i) {
        const from = dragIdxRef.current;
        if (from === null || from === i) return;
        dragIdxRef.current = i;
        setOrderedStops(prev => {
            const next = [...prev];
            const [dragged] = next.splice(from, 1);
            next.splice(i, 0, dragged);
            return next;
        });
    }

    function onDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }

    function onDragEnd() {
        dragIdxRef.current = null;
    }

    // Touch drag-to-reorder (mobile)
    function onStopTouchStart(e, i) {
        e.stopPropagation();
        touchDragRef.current = { idx: i, startY: e.touches[0].clientY };
    }
    function onStopTouchMove(e) {
        if (!touchDragRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const dy = e.touches[0].clientY - touchDragRef.current.startY;
        const ITEM_H = 56;
        const steps = Math.round(dy / ITEM_H);
        if (steps === 0) return;
        const from = touchDragRef.current.idx;
        const to = Math.max(0, Math.min(orderedStops.length - 1, from + steps));
        if (to === from) return;
        touchDragRef.current = { idx: to, startY: e.touches[0].clientY };
        setOrderedStops(prev => {
            const next = [...prev];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            return next;
        });
    }
    function onStopTouchEnd(e) {
        e.stopPropagation();
        touchDragRef.current = null;
    }

    // Inicializar mapa una sola vez
    useEffect(() => {
        if (mapRef.current) return;
        if (!containerRef.current) return;

        // Center on first stop if available, otherwise default center
        const center = stops.length > 0 ? stops[0].coords : DEFAULT_CENTER;
        const zoom   = stops.length > 0 ? 14 : 12;

        const map = L.map(containerRef.current, { zoomControl: false })
            .setView(center, zoom);

        L.control.zoom({ position: 'topright' }).addTo(map);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);

        stops.forEach((m, i) => {
            const marker = L.marker(m.coords, { icon: makeIcon(i + 1, '#4f46e5') })
                .addTo(map)
                .bindPopup(`<div style="min-width:140px"><b style="font-size:13px">${m.id}</b><br><span style="color:#6b7280;font-size:12px">Tipo: ${m.type}</span><br><span style="color:#6b7280;font-size:11px">📍 ${m.location}</span></div>`);
            markersRef.current.push(marker);
        });

        activeStopsRef.current = stops;

        // Only create routing control when there are waypoints to route between
        let routing = null;
        if (stops.length >= 2) {
            routing = L.Routing.control({
                waypoints: stops.map(m => L.latLng(m.coords)),
                fitSelectedRoutes: false,   // lo hacemos manual para controlar el timing
                showAlternatives: false,
                addWaypoints: false,
                createMarker: () => null,
                lineOptions: { styles: [{ color: '#4f46e5', opacity: 0.85, weight: 6 }] },
                routeWhileDragging: false,
            });

            routing.on('routesfound', e => {
                const s = e.routes[0]?.summary;
                if (s) setSegmentStats({
                    distance: s.totalDistance / 1000,
                    time: Math.round(s.totalTime / 60),
                });
                // Ajustar el mapa para mostrar toda la ruta calculada
                const coords = e.routes[0]?.coordinates;
                if (coords?.length > 1 && mapRef.current) {
                    const bounds = L.latLngBounds(coords);
                    mapRef.current.fitBounds(bounds, { padding: [40, 40] });
                }
            });

            routing.addTo(map);
        }

        mapRef.current = map;
        routingRef.current = routing;

        // En móvil el contenedor flex puede no tener su tamaño final al montar
        // Invalidar más tarde para que el panel inferior esté renderizado
        if (mobile) {
            setTimeout(() => map.invalidateSize(), 150);
            setTimeout(() => map.invalidateSize(), 600);
        }

        return () => {
            if (routing) map.removeControl(routing);
            map.remove();
            mapRef.current = null;
            routingRef.current = null;
            markersRef.current = [];
        };
    }, []);

    // Seguimiento de ubicación del usuario
    useEffect(() => {
        if (!navigator.geolocation) return;
        watchIdRef.current = navigator.geolocation.watchPosition(
            pos => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
            () => {},
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
        return () => {
            if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
        };
    }, []);

    // Actualizar marcador "Estás aquí" en el mapa
    useEffect(() => {
        if (!mapRef.current || !userLocation) return;
        if (userMarkerRef.current) {
            userMarkerRef.current.setLatLng(userLocation);
        } else {
            userMarkerRef.current = L.marker(userLocation, {
                icon: makeUserLocationIcon(),
                zIndexOffset: 1000,
            })
                .addTo(mapRef.current)
                .bindPopup('<b style="font-size:13px">📍 Tu ubicación</b>');
        }
    }, [userLocation]);

    // Actualizar marcadores y ruta cuando cambia orden/selección o estado de viaje
    useEffect(() => {
        if (!routingRef.current) return;

        if (!isTraveling) {
            markersRef.current.forEach((marker, i) => {
                const stop = stops[i];
                const orderIdx = orderedStops.findIndex(s => s.id === stop.id);
                if (orderIdx === -1) {
                    marker.setIcon(makeIconDot());
                    marker.setOpacity(0.4);
                } else {
                    marker.setIcon(makeIcon(orderIdx + 1, '#4f46e5'));
                    marker.setOpacity(1);
                }
            });
            if (orderedStops.length >= 2)
                routingRef.current.setWaypoints(orderedStops.map(m => L.latLng(m.coords)));
            return;
        }

        // Modo viaje
        const active = activeStopsRef.current;
        markersRef.current.forEach((marker, i) => {
            const activeIdx = active.findIndex(s => s.id === stops[i].id);
            if (activeIdx === -1) {
                marker.setIcon(makeIconDot());
                marker.setOpacity(0.3);
            } else {
                const isNext = activeIdx === firstPendingIdx;
                marker.setIcon(makeIcon(activeIdx + 1, markerColor(statuses[activeIdx], isNext)));
                marker.setOpacity(1);
            }
        });

        if (firstPendingIdx !== -1) {
            const pendingWps = active
                .map((s, i) => statuses[i] === 'pending' ? L.latLng(s.coords) : null)
                .filter(Boolean);

            // Punto de partida: ubicación actual del usuario si está disponible,
            // si no la última parada visitada, si no nada
            let lastHandledIdx = -1;
            for (let i = statuses.length - 1; i >= 0; i--) {
                if (statuses[i] !== 'pending') { lastHandledIdx = i; break; }
            }
            const startWp = userLocation
                ? L.latLng(userLocation)
                : (lastHandledIdx !== -1 ? L.latLng(active[lastHandledIdx].coords) : null);

            const wps = startWp ? [startWp, ...pendingWps] : pendingWps;
            if (wps.length >= 2) routingRef.current.setWaypoints(wps);
        }
        // Don't call setWaypoints([]) when all stops handled — leaflet-routing-machine can crash with empty array
    }, [isTraveling, statuses, orderedStops, userLocation]);

    async function startTravel() {
        activeStopsRef.current = orderedStops.slice();

        if (preloadedRun) {
            // Run pre-asignado: no crear uno nuevo, usar el existente
            setRunId(preloadedRun.id);
            setStopIds(orderedStops.map(m => {
                const rs = preloadedRun.stops?.find(s => s.machineId === m.id);
                return rs?.id ?? null;
            }));
            setIsTraveling(true);
            setAccumulated({ distance: 0, time: 0 });
            setStatuses(orderedStops.map(() => 'pending'));
            return;
        }

        const run = await createRouteRun(orderedStops.map(m => m.id));
        if (onRunStarted) {
            onRunStarted(run.id, run.stops, orderedStops.slice());
            return;
        }
        setRunId(run.id);
        setStopIds(run.stops.map(s => s.id));
        setIsTraveling(true);
        setAccumulated({ distance: 0, time: 0 });
        setStatuses(orderedStops.map(() => 'pending'));
    }

    async function endTravel() {
        if (runId) {
            const dist = accumulated.distance + segmentStats.distance;
            const time = accumulated.time + segmentStats.time;
            await updateRouteRun(runId, { status: 'cancelled', totalDistance: dist, totalTime: time });
        }
        setIsTraveling(false);
        setRunId(null);
        setStopIds([]);
        setStatuses([]);
        setAccumulated({ distance: 0, time: 0 });
    }

    async function handleStatus(index, status) {
        const newAccumulated = {
            distance: accumulated.distance + segmentStats.distance,
            time: accumulated.time + segmentStats.time,
        };
        setAccumulated(newAccumulated);

        if (runId && stopIds[index]) {
            await updateStop(runId, stopIds[index], status);
        }

        const next = [...statuses];
        next[index] = status;
        setStatuses(next);

        if (next.every(s => s !== 'pending')) {
            if (runId) {
                await updateRouteRun(runId, {
                    status: 'completed',
                    totalDistance: newAccumulated.distance,
                    totalTime: newAccumulated.time,
                });
            }
            setIsTraveling(false);
            setRunId(null);
            setStopIds([]);
        }
    }

    const totalDistance = (accumulated.distance + segmentStats.distance).toFixed(2);
    const totalTime = accumulated.time + segmentStats.time;
    const travelList = isTraveling ? activeStopsRef.current : null;

    // Shared panel list content
    const stopsList = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {/* — MODO VIAJE — */}
            {isTraveling && travelList && (
                <>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        Paradas ({travelList.length})
                    </div>
                    {travelList.map((m, i) => {
                        const status = statuses[i];
                        const isNext = i === firstPendingIdx;
                        const color = markerColor(status, isNext);
                        return (
                            <div key={m.id} style={{
                                border: `1px solid ${status === 'done' ? 'rgba(16,185,129,0.3)' : status === 'failed' ? 'rgba(239,68,68,0.3)' : isNext ? 'rgba(79,70,229,0.4)' : 'var(--border)'}`,
                                borderRadius: 'var(--radius-md)',
                                padding: '0.75rem',
                                background: status === 'done' ? 'rgba(16,185,129,0.05)' : status === 'failed' ? 'rgba(239,68,68,0.05)' : isNext ? 'rgba(79,70,229,0.05)' : 'var(--surface)',
                                opacity: status === 'failed' ? 0.7 : 1,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: isNext ? '0.5rem' : 0 }}>
                                    <div style={{ background: color, color: 'white', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', textDecoration: status !== 'pending' ? 'line-through' : 'none', color: status !== 'pending' ? 'var(--text-muted)' : 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.location}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.id} · {m.type}</div>
                                    </div>
                                    {status === 'done' && <CheckCircle size={16} color="#10b981" />}
                                    {status === 'failed' && <XCircle size={16} color="#ef4444" />}
                                    {isNext && <MapPin size={16} color="#4f46e5" />}
                                </div>
                                {isNext && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem' }}>
                                        {onStopAction ? (
                                            /* ── Modo mobile: Escanear QR / Saltar ── */
                                            <>
                                                <button
                                                    onClick={() => setQrModal({ stopIdx: i, stopId: stopIds[i], machineId: m.id, machineName: m.location })}
                                                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.65rem', borderRadius: 'var(--radius-sm)', border: 'none', background: '#4f46e5', color: 'white', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(79,70,229,0.35)' }}
                                                >
                                                    <QrCode size={16} /> Escanear QR
                                                </button>
                                                <button
                                                    onClick={() => handleStatus(i, 'failed')}
                                                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', padding: '0.45rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.06)', color: '#b91c1c', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                                                >
                                                    <XCircle size={13} /> Saltar parada
                                                </button>
                                            </>
                                        ) : (
                                            /* ── Modo desktop/standalone: Visitado / Saltado ── */
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button onClick={() => handleStatus(i, 'done')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#065f46', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                                                    <CheckCircle size={14} /> Visitado
                                                </button>
                                                <button onClick={() => handleStatus(i, 'failed')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: '#b91c1c', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                                                    <XCircle size={14} /> Saltado
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}

            {/* — MODO SELECCIÓN — */}
            {!isTraveling && (
                <>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                        En ruta ({orderedStops.length})
                    </div>
                    {orderedStops.length === 0 && (
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', padding: '0.75rem', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                            Agrega paradas desde abajo
                        </div>
                    )}
                    {orderedStops.map((m, i) => (
                        <div
                            key={m.id}
                            draggable
                            onDragStart={e => onDragStart(e, i)}
                            onDragEnter={e => onDragEnter(e, i)}
                            onDragOver={onDragOver}
                            onDragEnd={onDragEnd}
                            style={{ border: '1px solid rgba(79,70,229,0.3)', borderRadius: 'var(--radius-md)', padding: '0.65rem 0.75rem', background: 'rgba(79,70,229,0.04)', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <div
                                onTouchStart={e => onStopTouchStart(e, i)}
                                onTouchMove={onStopTouchMove}
                                onTouchEnd={onStopTouchEnd}
                                style={{ touchAction: 'none', cursor: 'grab', padding: '0.25rem', margin: '-0.25rem', flexShrink: 0, display: 'flex', alignItems: 'center' }}
                            >
                                <GripVertical size={18} style={{ color: 'var(--text-muted)' }} />
                            </div>
                            <div style={{ background: '#4f46e5', color: 'white', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.location}</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.id} · {m.type}</div>
                            </div>
                            <button onClick={() => toggleStop(m)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: '0.25rem', display: 'flex', flexShrink: 0 }}>
                                <XCircle size={17} />
                            </button>
                        </div>
                    ))}
                    {excludedStops.length > 0 && (
                        <>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginTop: '0.25rem' }}>
                                Excluidas ({excludedStops.length})
                            </div>
                            {excludedStops.map(m => (
                                <div
                                    key={m.id}
                                    onClick={() => toggleStop(m)}
                                    style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.65rem 0.75rem', background: 'var(--surface)', opacity: 0.5, cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px dashed #9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <Plus size={12} color="#9ca3af" />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.location}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.id} · {m.type}</div>
                                    </div>
                                </div>
                            ))}
                        </>
                    )}
                </>
            )}
        </div>
    );

    // ── MOBILE LAYOUT: mapa fijo arriba, panel desplegable abajo ──
    if (mobile) {
        // La altura collapsed suma el safe-area para que el botón no quede tapado
        const panelHeight = panelOpen ? '58%' : 'calc(158px + env(safe-area-inset-bottom))';

        function togglePanel(open) {
            setPanelOpen(open);
            setTimeout(() => mapRef.current?.invalidateSize(), 320);
        }

        // Swipe gesture: dedo hacia arriba abre el panel, hacia abajo lo cierra
        let touchStartY = null;
        function onTouchStart(e) { touchStartY = e.touches[0].clientY; }
        function onTouchEnd(e) {
            if (touchStartY === null) return;
            const dy = touchStartY - e.changedTouches[0].clientY;
            if (dy > 40) togglePanel(true);
            else if (dy < -40) togglePanel(false);
            touchStartY = null;
        }

        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Mapa — ocupa el espacio restante encima del panel */}
                <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />

                {/* Bottom sheet panel */}
                <div
                    onTouchStart={onTouchStart}
                    onTouchEnd={onTouchEnd}
                    style={{
                    height: panelHeight,
                    transition: 'height 0.3s ease',
                    background: 'var(--surface)',
                    borderTop: '1px solid var(--border)',
                    borderTopLeftRadius: 16, borderTopRightRadius: 16,
                    boxShadow: '0 -4px 20px rgba(0,0,0,0.10)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    flexShrink: 0,
                    paddingBottom: 'env(safe-area-inset-bottom)',
                }}>
                    {/* Drag handle / toggle */}
                    <div
                        onClick={() => togglePanel(!panelOpen)}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem 1rem 0.4rem', cursor: 'pointer', flexShrink: 0 }}
                    >
                        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--border)', marginBottom: '0.5rem' }} />
                        <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.45rem 1.1rem',
                            borderRadius: 999,
                            background: panelOpen ? 'var(--bg-color)' : '#4f46e5',
                            color: panelOpen ? 'var(--text-muted)' : 'white',
                            border: panelOpen ? '1px solid var(--border)' : 'none',
                            fontSize: '0.82rem', fontWeight: 700,
                            boxShadow: panelOpen ? 'none' : '0 3px 10px rgba(79,70,229,0.4)',
                            userSelect: 'none',
                            transition: 'background 0.2s',
                        }}>
                            {panelOpen ? (
                                <><span style={{ fontSize: '0.7rem' }}>▼</span> Ocultar paradas</>
                            ) : (
                                <><MapPin size={14} /> Ver paradas ({orderedStops.length || travelList?.length || 0})</>
                            )}
                        </div>
                    </div>

                    {/* Stats + botón principal — siempre visibles */}
                    <div style={{ padding: '0 0.75rem 0.5rem', flexShrink: 0 }}>
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {[['Distancia', `${totalDistance} km`], ['Tiempo', `${totalTime} min`]].map(([label, val]) => (
                                <div key={label} style={{ flex: 1, background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.35rem', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
                                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--primary)' }}>{val}</div>
                                </div>
                            ))}
                        </div>
                        {allHandled ? (
                            <div style={{ background: 'var(--success-light)', borderRadius: 'var(--radius-md)', padding: '0.6rem', textAlign: 'center', color: '#065f46', fontSize: '0.85rem', fontWeight: 600 }}>
                                ¡Ruta finalizada!
                            </div>
                        ) : !isTraveling ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ flex: 1, justifyContent: 'center', gap: '0.5rem', padding: '0.6rem 1rem', opacity: orderedStops.length === 0 ? 0.5 : 1 }}
                                    disabled={orderedStops.length === 0}
                                    onClick={startTravel}
                                >
                                    <Play size={16} />
                                    Iniciar {orderedStops.length < stops.length ? `(${orderedStops.length})` : 'Ruta'}
                                </button>
                                <button
                                    className="btn"
                                    style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)', opacity: orderedStops.length < 3 ? 0.4 : 1 }}
                                    disabled={orderedStops.length < 3}
                                    onClick={optimizeOrder}
                                    title="Orden óptimo"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                                </button>
                            </div>
                        ) : (
                            <button className="btn btn-danger" style={{ width: '100%', justifyContent: 'center', gap: '0.5rem', padding: '0.6rem 1rem' }} onClick={endTravel}>
                                <Square size={16} /> Finalizar Ruta
                            </button>
                        )}
                    </div>

                    {/* Lista de paradas — solo visible al expandir */}
                    {panelOpen && (
                        <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
                            <div style={{ paddingTop: '0.5rem' }}>
                                {stopsList}
                            </div>
                        </div>
                    )}
                </div>

                {/* ── Modal QR ── */}
                {qrModal && (
                    <div
                        onClick={() => setQrModal(null)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{ background: 'var(--surface)', borderRadius: 20, padding: '1.5rem', width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', boxShadow: '0 8px 40px rgba(0,0,0,0.4)' }}
                        >
                            {/* Header */}
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '0.2rem' }}>Máquina</div>
                                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-main)' }}>{qrModal.machineName}</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem', letterSpacing: '0.5px' }}>{qrModal.machineId}</div>
                            </div>

                            {/* QR Code */}
                            <div style={{ background: 'white', borderRadius: 12, padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
                                <QRCodeSVG value={qrModal.machineId} size={200} level="H" />
                            </div>

                            {/* Hint */}
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
                                Escaneá el QR y elegí la acción a realizar
                            </div>

                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: '0.6rem', width: '100%' }}>
                                <button
                                    onClick={() => { onStopAction(qrModal.stopId, qrModal.machineId, 'record'); setQrModal(null); }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.85rem 0.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: '#4f46e5', color: 'white', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 3px 10px rgba(79,70,229,0.4)' }}
                                >
                                    <Save size={20} />
                                    Recaudación
                                </button>
                                <button
                                    onClick={() => { onStopAction(qrModal.stopId, qrModal.machineId, 'mantencion'); setQrModal(null); }}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.85rem 0.5rem', borderRadius: 'var(--radius-md)', border: 'none', background: '#f59e0b', color: 'white', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 3px 10px rgba(245,158,11,0.4)' }}
                                >
                                    <Wrench size={20} />
                                    Mantención
                                </button>
                            </div>

                            {/* Cerrar */}
                            <button
                                onClick={() => setQrModal(null)}
                                style={{ width: '100%', padding: '0.55rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-color)', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                )}

                <style>{`
                    .leaflet-routing-container { display: none !important; }
                    @keyframes userPulse {
                        0%   { transform: translate(-50%,-50%) scale(0.6); opacity: 0.8; }
                        100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
                    }
                `}</style>
            </div>
        );
    }

    // ── DESKTOP LAYOUT (sin cambios) ──
    return (
        <div style={{ display: 'flex', flexDirection: 'row', height: '100%', margin: '-1.5rem' }}>
            {/* Panel de control */}
            <div style={{ width: 300, background: 'var(--surface)', borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', flexShrink: 0 }}>
                {onBack && (
                    <div
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, marginBottom: '-0.25rem' }}
                        onClick={onBack}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                        Volver al historial
                    </div>
                )}
                {stops.length === 0 && (
                    <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius-md)', padding: '0.75rem', fontSize: '0.8rem', color: '#92400e' }}>
                        <strong>Sin ubicaciones configuradas.</strong> Andá a Gestión de Máquinas → seleccioná un lugar → "Coordenadas" para fijar la posición en el mapa.
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    {[['Distancia', `${totalDistance} km`], ['Tiempo Est.', `${totalTime} min`]].map(([label, val]) => (
                        <div key={label} style={{ background: 'var(--bg-color)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.75rem', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', marginTop: 2 }}>{val}</div>
                        </div>
                    ))}
                </div>
                {allHandled ? (
                    <div style={{ background: 'var(--success-light)', borderRadius: 'var(--radius-md)', padding: '1rem', textAlign: 'center', color: '#065f46', fontSize: '0.875rem', fontWeight: 600 }}>
                        ¡Ruta finalizada!<br />
                        <span style={{ fontWeight: 400 }}>{accumulated.distance.toFixed(2)} km recorridos</span>
                    </div>
                ) : !isTraveling ? (
                    <>
                        <button
                            className="btn btn-primary"
                            style={{ justifyContent: 'center', gap: '0.5rem', opacity: orderedStops.length === 0 ? 0.5 : 1 }}
                            disabled={orderedStops.length === 0}
                            onClick={startTravel}
                        >
                            <Play size={16} />
                            Iniciar Ruta {orderedStops.length < stops.length ? `(${orderedStops.length})` : ''}
                        </button>
                        <button
                            className="btn"
                            style={{ justifyContent: 'center', gap: '0.5rem', opacity: orderedStops.length < 3 ? 0.4 : 1, fontSize: '0.8rem', padding: '0.4rem 0.75rem', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text-muted)' }}
                            disabled={orderedStops.length < 3}
                            onClick={optimizeOrder}
                            title="Reordena las paradas minimizando la distancia total"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                            Orden recomendado
                        </button>
                    </>
                ) : (
                    <button className="btn btn-danger" style={{ justifyContent: 'center', gap: '0.5rem' }} onClick={endTravel}>
                        <Square size={16} /> Finalizar Ruta
                    </button>
                )}
                {stopsList}
            </div>

            {/* Mapa */}
            <div ref={containerRef} style={{ flex: 1 }} />
            <style>{`
                .leaflet-routing-container { display: none !important; }
                @keyframes userPulse {
                    0%   { transform: translate(-50%,-50%) scale(0.6); opacity: 0.8; }
                    100% { transform: translate(-50%,-50%) scale(2.2); opacity: 0; }
                }
            `}</style>
        </div>
    );
}
