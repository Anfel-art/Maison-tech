/**
 * Test suite para la API de SEPRISA.
 * Uso: node server/test-api.js [--host http://localhost:3001]
 */

const HOST = process.argv.includes('--host')
  ? process.argv[process.argv.indexOf('--host') + 1]
  : 'http://localhost:3001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};

let passed = 0, failed = 0;
const failures = [];

function log(symbol, label, detail = '') {
  const color = symbol === '✓' ? c.green : c.red;
  console.log(`  ${color}${symbol}${c.reset} ${label}${detail ? c.gray + '  ' + detail + c.reset : ''}`);
}

function section(title) {
  console.log(`\n${c.bold}${c.cyan}▸ ${title}${c.reset}`);
}

async function api(method, path, { body, token, expectStatus = 200, formData } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${HOST}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : formData ?? undefined,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function expect(label, condition, detail = '') {
  if (condition) {
    passed++;
    log('✓', label, detail);
  } else {
    failed++;
    failures.push(label);
    log('✗', label, detail);
  }
}

// ─── Estado compartido entre tests ────────────────────────────────────────────

let adminToken = null;
let terrenoToken = null;
let createdMachineId = null;
let createdLugarId = null;
let createdRecordId = null;
let createdRunId = null;
let createdStopId = null;

// ─── Tests ────────────────────────────────────────────────────────────────────

async function testHealth() {
  section('Health');
  const { status, data } = await api('GET', '/api/health');
  expect('GET /api/health → 200', status === 200, `status=${status}`);
  expect('Responde { ok: true }', data?.ok === true);
}

async function testAuth() {
  section('Autenticación');

  // Login válido admin
  let r = await api('POST', '/api/auth/login', { body: { user: 'admin', pass: 'admin' } });
  expect('POST /api/auth/login admin → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve token JWT', typeof r.data?.token === 'string' && r.data.token.startsWith('eyJ'));
  expect('Devuelve rol admin', r.data?.rol === 'admin');
  adminToken = r.data?.token;

  // Login válido terreno
  r = await api('POST', '/api/auth/login', { body: { user: 'terreno', pass: 'terreno' } });
  expect('POST /api/auth/login terreno → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve rol terreno', r.data?.rol === 'terreno');
  terrenoToken = r.data?.token;

  // Credenciales inválidas
  r = await api('POST', '/api/auth/login', { body: { user: 'admin', pass: 'wrong' } });
  expect('Contraseña incorrecta → 401', r.status === 401, `status=${r.status}`);

  r = await api('POST', '/api/auth/login', { body: { user: 'noexiste', pass: 'abc' } });
  expect('Usuario inexistente → 401', r.status === 401, `status=${r.status}`);

  // Sin body
  r = await api('POST', '/api/auth/login', { body: {} });
  expect('Sin credenciales → 400', r.status === 400, `status=${r.status}`);
}

async function testProtectedRoutes() {
  section('Protección de rutas (sin token → 401)');
  const routes = [
    ['GET',  '/api/machines'],
    ['GET',  '/api/records'],
    ['GET',  '/api/route-runs'],
    ['GET',  '/api/config'],
    ['GET',  '/api/machines/meta/tipos'],
    ['GET',  '/api/machines/meta/lugares'],
  ];
  for (const [method, path] of routes) {
    const { status } = await api(method, path);
    expect(`${method} ${path} sin token → 401`, status === 401, `status=${status}`);
  }

  // Token inválido
  const { status } = await api('GET', '/api/machines', { token: 'eyJ.token.falso' });
  expect('Token inválido → 401', status === 401, `status=${status}`);
}

async function testMachines() {
  section('Máquinas');

  // GET all
  let r = await api('GET', '/api/machines', { token: adminToken });
  expect('GET /api/machines → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve array de máquinas', Array.isArray(r.data));
  const count = r.data?.length ?? 0;
  expect('Tiene máquinas seed', count > 0, `count=${count}`);

  // GET tipos
  r = await api('GET', '/api/machines/meta/tipos', { token: adminToken });
  expect('GET /api/machines/meta/tipos → 200', r.status === 200);
  expect('Devuelve tipos', Array.isArray(r.data) && r.data.length > 0);

  // GET lugares
  r = await api('GET', '/api/machines/meta/lugares', { token: adminToken });
  expect('GET /api/machines/meta/lugares → 200', r.status === 200);

  // POST lugar (para usarlo en la máquina de test)
  r = await api('POST', '/api/machines/meta/lugares', {
    token: adminToken,
    body: { nombre: 'TEST Lugar API', direccion: 'Calle Test 123', lat: -25.33, lng: -57.52 },
  });
  expect('POST /api/machines/meta/lugares → 201', r.status === 201, `status=${r.status}`);
  createdLugarId = r.data?.id;

  // POST máquina
  createdMachineId = `TEST-${Date.now()}`.slice(0, 10);
  r = await api('POST', '/api/machines', {
    token: adminToken,
    body: { id: createdMachineId, tmqId: 1, lgrId: createdLugarId },
  });
  expect('POST /api/machines → 201', r.status === 201, `status=${r.status}`);
  expect('Devuelve id correcto', r.data?.id === createdMachineId);

  // GET by id
  r = await api('GET', `/api/machines/${createdMachineId}`, { token: adminToken });
  expect('GET /api/machines/:id → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve máquina correcta', r.data?.id === createdMachineId);

  // PATCH máquina
  r = await api('PATCH', `/api/machines/${createdMachineId}`, {
    token: adminToken,
    body: { status: 'warning' },
  });
  expect('PATCH /api/machines/:id → 200', r.status === 200, `status=${r.status}`);
  expect('Status actualizado', r.data?.status === 'warning');

  // POST sin campos requeridos
  r = await api('POST', '/api/machines', { token: adminToken, body: { id: 'X' } });
  expect('POST máquina sin tmqId/lgrId → 400', r.status === 400, `status=${r.status}`);

  // GET id inexistente
  r = await api('GET', '/api/machines/NOEXISTE-999', { token: adminToken });
  expect('GET máquina inexistente → 404', r.status === 404, `status=${r.status}`);
}

async function testRecords() {
  section('Registros de Recaudación');

  // GET all
  let r = await api('GET', '/api/records', { token: adminToken });
  expect('GET /api/records → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve array', Array.isArray(r.data));

  // GET filtrado por máquina
  r = await api('GET', '/api/records?machineId=MQR-001', { token: adminToken });
  expect('GET /api/records?machineId → 200', r.status === 200, `status=${r.status}`);
  const allMine = r.data?.every(rec => rec.machine === 'MQR-001');
  expect('Registros filtrados por máquina', allMine ?? false);

  // POST registro
  r = await api('POST', '/api/records', {
    token: adminToken,
    body: {
      machine: createdMachineId,
      lgrId: createdLugarId,
      preCalc: 50000,
      fisico: 50000,
      contEntrada: 100,
      contSalida: 95,
      contReal: 95,
      contRealDif: 0,
      mntoTotal: 50000,
    },
  });
  expect('POST /api/records → 201', r.status === 201, `status=${r.status}`);
  createdRecordId = r.data?.id;
  expect('Devuelve id', typeof createdRecordId === 'number');
}

async function testRouteRuns() {
  section('Rutas de Recaudación');

  // GET all
  let r = await api('GET', '/api/route-runs', { token: adminToken });
  expect('GET /api/route-runs → 200', r.status === 200, `status=${r.status}`);
  expect('Devuelve array', Array.isArray(r.data));

  // GET filtrado por status
  r = await api('GET', '/api/route-runs?status=active', { token: adminToken });
  expect('GET /api/route-runs?status=active → 200', r.status === 200, `status=${r.status}`);
  const allActive = r.data?.every(run => run.status === 'active');
  expect('Solo rutas activas', allActive ?? true);

  // POST nueva ruta
  r = await api('POST', '/api/route-runs', {
    token: adminToken,
    body: { machineIds: ['MQR-001', 'MQC-005'] },
  });
  expect('POST /api/route-runs → 201', r.status === 201, `status=${r.status}`);
  createdRunId = r.data?.id;
  expect('Devuelve id y paradas', typeof createdRunId === 'number' && r.data?.stops?.length === 2);

  // POST sin machineIds
  r = await api('POST', '/api/route-runs', { token: adminToken, body: {} });
  expect('POST ruta sin machineIds → 400', r.status === 400, `status=${r.status}`);

  // GET by id
  r = await api('GET', `/api/route-runs/${createdRunId}`, { token: adminToken });
  expect('GET /api/route-runs/:id → 200', r.status === 200, `status=${r.status}`);
  createdStopId = r.data?.stops?.[0]?.id;

  // PATCH parada
  r = await api('PATCH', `/api/route-runs/${createdRunId}/stops/${createdStopId}`, {
    token: adminToken,
    body: { status: 'done' },
  });
  expect('PATCH parada → done → 200', r.status === 200, `status=${r.status}`);
  const updatedStop = r.data?.stops?.find(s => s.id === createdStopId);
  expect('Parada marcada como done', updatedStop?.status === 'done');

  // PATCH ruta → completar
  r = await api('PATCH', `/api/route-runs/${createdRunId}`, {
    token: adminToken,
    body: { status: 'completed', totalDistance: 12.5, totalTime: 45 },
  });
  expect('PATCH ruta → completed → 200', r.status === 200, `status=${r.status}`);
  expect('Status completado', r.data?.status === 'completed');

  // GET ruta inexistente
  r = await api('GET', '/api/route-runs/999999', { token: adminToken });
  expect('GET ruta inexistente → 404', r.status === 404, `status=${r.status}`);
}

async function testConfig() {
  section('Configuración');
  const { status, data } = await api('GET', '/api/config', { token: adminToken });
  expect('GET /api/config → 200', status === 200, `status=${status}`);
  expect('Tiene precioFicha', typeof data?.precioFicha === 'number');
  expect('Tiene pctLocatario', typeof data?.pctLocatario === 'number');
}

async function testCleanup() {
  section('Limpieza (datos de test)');

  // Eliminar máquina de test (también elimina registros asociados en cascada en la lógica de negocio)
  if (createdMachineId) {
    const { status } = await api('DELETE', `/api/machines/${createdMachineId}`, { token: adminToken });
    expect(`DELETE máquina test ${createdMachineId} → 200`, status === 200, `status=${status}`);
  }

  // DELETE máquina ya eliminada → 404
  if (createdMachineId) {
    const { status } = await api('DELETE', `/api/machines/${createdMachineId}`, { token: adminToken });
    expect('DELETE máquina inexistente → 404', status === 404, `status=${status}`);
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${c.bold}SEPRISA API Test Suite${c.reset}`);
  console.log(`${c.gray}Host: ${HOST}${c.reset}`);
  console.log(c.gray + '─'.repeat(50) + c.reset);

  try {
    await testHealth();
    await testAuth();
    await testProtectedRoutes();
    await testMachines();
    await testRecords();
    await testRouteRuns();
    await testConfig();
    await testCleanup();
  } catch (err) {
    console.error(`\n${c.red}Error inesperado: ${err.message}${c.reset}`);
    failed++;
  }

  const total = passed + failed;
  console.log('\n' + c.gray + '─'.repeat(50) + c.reset);
  console.log(`${c.bold}Resultados: ${c.green}${passed} pasaron${c.reset}  ${failed > 0 ? c.red : c.gray}${failed} fallaron${c.reset}  ${c.gray}(${total} total)${c.reset}`);

  if (failures.length > 0) {
    console.log(`\n${c.red}${c.bold}Fallidos:${c.reset}`);
    failures.forEach(f => console.log(`  ${c.red}✗ ${f}${c.reset}`));
  }

  console.log();
  process.exit(failed > 0 ? 1 : 0);
}

run();
