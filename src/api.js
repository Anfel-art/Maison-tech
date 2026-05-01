const BASE = import.meta.env.VITE_API_URL || '/api';

const TOKEN_KEY = 'seprisa_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request(path, options = {}) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, { ...options, headers });

    if (res.status === 401) {
        clearToken();
        window.dispatchEvent(new Event('auth:logout'));
        throw new Error('No autenticado');
    }
    if (!res.ok) {
        let msg = `API error ${res.status}`;
        try { const body = await res.json(); if (body?.error) msg = body.error; } catch {}
        throw new Error(msg);
    }
    return res.json();
}

// Auth
export const login = async (user, pass) => {
    const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, pass }),
    });
    if (!res.ok) throw new Error('Credenciales inválidas');
    const data = await res.json();
    setToken(data.token);
    return data;
};

// Machines
export const getMachines = () => request('/machines');
export const getMachine = (id) => request(`/machines/${id}`);
export const createMachine = (data) => request('/machines', { method: 'POST', body: JSON.stringify(data) });
export const updateMachine = (id, data) => request(`/machines/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteMachine = (id) => request(`/machines/${id}`, { method: 'DELETE' });

// Machine meta
export const getTipos = () => request('/machines/meta/tipos');
export const createTipo = (data) => request('/machines/meta/tipos', { method: 'POST', body: JSON.stringify(data) });
export const updateTipo = (id, data) => request(`/machines/meta/tipos/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteTipo = (id) => request(`/machines/meta/tipos/${id}`, { method: 'DELETE' });
export const getLugares = () => request('/machines/meta/lugares');
export const createLugar = (data) => request('/machines/meta/lugares', { method: 'POST', body: JSON.stringify(data) });
export const updateLugar = (id, data) => request(`/machines/meta/lugares/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

// Records
export const getRecords = (filters = {}) => {
  if (typeof filters === 'string') filters = { machineId: filters }; // backward compat
  const params = new URLSearchParams();
  if (filters.machineId)  params.set('machineId',  filters.machineId);
  if (filters.routeRunId) params.set('routeRunId', filters.routeRunId);
  if (filters.from)       params.set('from',       filters.from);
  if (filters.to)         params.set('to',         filters.to);
  const qs = params.toString();
  return request(qs ? `/records?${qs}` : '/records');
};
export const createRecord = (data) => request('/records', { method: 'POST', body: JSON.stringify(data) });
export const getLastRecord = (machineId) => request(`/records/last/${machineId}`);
export const uploadRecordImage = (recordId, file) => {
    const form = new FormData();
    form.append('photo', file);
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    return fetch(`${BASE}/records/${recordId}/images`, { method: 'POST', headers, body: form }).then(async r => {
        if (r.status === 401) { clearToken(); window.dispatchEvent(new Event('auth:logout')); throw new Error('No autenticado'); }
        if (!r.ok) throw new Error(`Upload error ${r.status}`);
        return r.json();
    });
};

// Campos por tipo
export const createCampo   = (tipoId, data)          => request(`/machines/meta/tipos/${tipoId}/campos`,            { method: 'POST',  body: JSON.stringify(data) });
export const updateCampo   = (tipoId, campoId, data)  => request(`/machines/meta/tipos/${tipoId}/campos/${campoId}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCampo   = (tipoId, campoId)        => request(`/machines/meta/tipos/${tipoId}/campos/${campoId}`, { method: 'DELETE' });
export const reorderCampos = (tipoId, order)          => request(`/machines/meta/tipos/${tipoId}/campos/reorder`,    { method: 'PATCH', body: JSON.stringify({ order }) });

// Reports
function reportsQs(filters = {}) {
  const p = new URLSearchParams();
  if (filters.machineId) p.set('machineId', filters.machineId);
  if (filters.from)      p.set('from',      filters.from);
  if (filters.to)        p.set('to',        filters.to);
  return p.toString() ? '?' + p.toString() : '';
}
export const getReportePorEvento = (f) => request(`/reports/por-evento${reportsQs(f)}`);
export const getReporteMensual   = (f) => request(`/reports/mensual${reportsQs(f)}`);
export const getReporteAcumulado = (f) => request(`/reports/acumulado${reportsQs(f)}`);
export const getReporteDescuadres = (f) => request(`/reports/descuadres${reportsQs(f)}`);
export const getReporteExportUrl = (f) => {
  const qs = reportsQs(f);
  return `${BASE}/reports/export${qs}`;
};

// Catálogo (productos y servicios)
export const getCatalogo = (params = {}) => {
  const p = new URLSearchParams();
  if (params.catId) p.set('catId', params.catId);
  if (params.todos) p.set('todos', '1');
  return request(p.toString() ? `/catalogo?${p}` : '/catalogo');
};
export const createCatalogoItem  = (data)      => request('/catalogo', { method: 'POST',   body: JSON.stringify(data) });
export const updateCatalogoItem  = (id, data)  => request(`/catalogo/${id}`, { method: 'PATCH',  body: JSON.stringify(data) });
export const deleteCatalogoItem  = (id)        => request(`/catalogo/${id}`, { method: 'DELETE' });
export const uploadCatalogoImagen = (id, file) => {
    const fd = new FormData(); fd.append('foto', file);
    const token = getToken();
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    return fetch(`${BASE}/catalogo/${id}/imagen`, { method: 'POST', headers, body: fd }).then(async r => {
        if (r.status === 401) { clearToken(); window.dispatchEvent(new Event('auth:logout')); throw new Error('No autenticado'); }
        if (!r.ok) throw new Error(`Upload error ${r.status}`);
        return r.json();
    });
};
// Tipos de ítem del catálogo
export const getItemTiposCat    = ()           => request('/catalogo/tipos');
export const createItemTipoCat  = (nombre)     => request('/catalogo/tipos', { method: 'POST',   body: JSON.stringify({ nombre }) });
export const updateItemTipoCat  = (id, nombre) => request(`/catalogo/tipos/${id}`, { method: 'PATCH',  body: JSON.stringify({ nombre }) });
export const deleteItemTipoCat  = (id)         => request(`/catalogo/tipos/${id}`, { method: 'DELETE' });
// Tipos de máquina
export const getTipomaquinas    = ()           => request('/catalogo/tipomaquinas');

// Caja
export const getCajaMovimientos = (filters = {}) => {
  const p = new URLSearchParams();
  if (filters.from) p.set('from', filters.from);
  if (filters.to)   p.set('to',   filters.to);
  return request(p.toString() ? `/caja?${p}` : '/caja');
};
export const getCajaBalance = () => request('/caja/balance');
export const createCajaMovimiento = (data) => request('/caja', { method: 'POST', body: JSON.stringify(data) });
export const deleteCajaMovimiento = (id) => request(`/caja/${id}`, { method: 'DELETE' });
export const reembolsarMovimiento  = (id) => request(`/caja/${id}/reembolso`, { method: 'POST' });
export const getCajaCierre         = (fecha) => request(`/caja/cierres?fecha=${fecha}`);
export const createCajaCierre      = (data)  => request('/caja/cierre', { method: 'POST', body: JSON.stringify(data) });
export const deleteCajaCierre      = (fecha) => request(`/caja/cierre/${fecha}`, { method: 'DELETE' });

// Clientes
export const getClientes = (params = {}) => {
  const p = new URLSearchParams();
  if (params.buscar) p.set('buscar', params.buscar);
  if (params.tipo)   p.set('tipo',   params.tipo);
  if (params.activo !== undefined) p.set('activo', params.activo ? '1' : '0');
  return request(p.toString() ? `/clientes?${p}` : '/clientes');
};
export const getCliente              = (id)            => request(`/clientes/${id}`);
export const getClienteFicha         = (id)            => request(`/clientes/${id}/ficha`);
export const createCliente           = (data)          => request('/clientes', { method: 'POST',  body: JSON.stringify(data) });
export const updateCliente           = (id, data)      => request(`/clientes/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCliente           = (id)            => request(`/clientes/${id}`, { method: 'DELETE' });
export const asignarProductoCliente  = (id, itemId, cantidad) => request(`/clientes/${id}/productos`, { method: 'POST',   body: JSON.stringify({ itemId, cantidad }) });
export const updateProductoCliente   = (id, itemId, cantidad) => request(`/clientes/${id}/productos/${itemId}`, { method: 'PATCH',  body: JSON.stringify({ cantidad }) });
export const removeProductoCliente   = (id, itemId)     => request(`/clientes/${id}/productos/${itemId}`, { method: 'DELETE' });

// Usuarios
export const getUsuarios = () => request('/usuarios');
export const getUsuariosActividad = () => request('/usuarios/actividad');
export const createUsuario = (data) => request('/usuarios', { method: 'POST', body: JSON.stringify(data) });
export const updateUsuario = (id, data) => request(`/usuarios/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteUsuario = (id) => request(`/usuarios/${id}`, { method: 'DELETE' });

// Config
export const getConfig = () => request('/config');
export const updateConfig = (data) => request('/config', { method: 'PATCH', body: JSON.stringify(data) });

// Maintenance
export const createMaintenance = (data) => request('/maintenance', { method: 'POST', body: JSON.stringify(data) });
export const getMaintenanceByMachine = (machineId) => request(`/maintenance?machineId=${machineId}`);

// Route Runs
export const getRouteRuns    = (filters = {}) => {
  if (typeof filters === 'string') filters = { status: filters }; // backward compat
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.usuId)  p.set('usuId',  filters.usuId);
  const qs = p.toString();
  return request(qs ? `/route-runs?${qs}` : '/route-runs');
};
export const getRouteRun     = (id) => request(`/route-runs/${id}`);
export const createRouteRun  = (machineIds, recaudadorId = null) =>
  request('/route-runs', { method: 'POST', body: JSON.stringify({ machineIds, ...(recaudadorId ? { recaudadorId } : {}) }) });
export const updateRouteRun  = (id, data) => request(`/route-runs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const updateStop      = (runId, stopId, status) => request(`/route-runs/${runId}/stops/${stopId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const addStopToRun   = (runId, machineId) => request(`/route-runs/${runId}/stops`, { method: 'POST', body: JSON.stringify({ machineId }) });
export const deleteStop      = (runId, stopId) => request(`/route-runs/${runId}/stops/${stopId}`, { method: 'DELETE' });
export const getMisTareas    = () => request('/route-runs/mis-tareas');
export const getMiHistorial  = () => request('/route-runs/mi-historial');
export const aceptarRecorrido = (id) => request(`/route-runs/${id}/aceptar`, { method: 'PATCH' });
