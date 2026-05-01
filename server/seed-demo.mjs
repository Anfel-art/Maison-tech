/**
 * seed-demo.mjs
 * Crea datos de demostración: tipo "Peluches" con todos sus campos
 * y 6 máquinas ubicadas en San Lorenzo, Paraguay.
 *
 * Uso:
 *   node server/seed-demo.mjs
 *
 * Requiere que el stack esté corriendo (docker-compose up -d).
 * Es idempotente: no duplica datos si se ejecuta más de una vez.
 */

const API = 'http://localhost:5173/api';

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: 'superadmin', pass: 'superadmin' }),
  });
  if (!res.ok) throw new Error('Login fallido: ' + await res.text());
  return (await res.json()).token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ─── Datos ────────────────────────────────────────────────────────────────────

const LUGAR = {
  nombre: 'JFC San Lorenzo',
  direccion: 'San Lorenzo, Paraguay',
  lat: -25.3395,
  lng: -57.5089,
};

const TIPO_DESC = 'Peluches';

const CAMPOS = [
  // Constante global
  { key: 'coin_valor',       label: 'Valor de Ficha',     grupo: 'General',            tipo: 'constant', formula: '0.25' },

  // Contador Digital
  { key: 'coin',             label: 'Coin',               grupo: 'Contador Digital',   tipo: 'number', requerido: true },
  { key: 'prize',            label: 'Prize',              grupo: 'Contador Digital',   tipo: 'number' },
  { key: 'total_coin',       label: 'Total Coin',         grupo: 'Contador Digital',   tipo: 'number' },
  { key: 'total_prize',      label: 'Total Prize',        grupo: 'Contador Digital',   tipo: 'number' },
  { key: 'ingreso',          label: 'Ingreso',            grupo: 'Contador Digital',   tipo: 'number', readonly: true, formula: '{coin} * {coin_valor}' },
  { key: 'pct_local',        label: '% Local',            grupo: 'Contador Digital',   tipo: 'number' },

  // Real
  { key: 'ingreso_real',     label: 'Ingreso Real',       grupo: 'Real',               tipo: 'number' },
  { key: 'ingreso_recaudac', label: 'Ingreso x Recaudac', grupo: 'Real',               tipo: 'number' },
  { key: 'valor_premios',    label: 'Valor Premios',      grupo: 'Real',               tipo: 'number', readonly: true, formula: '{salida_real} * {precio_premios}' },
  { key: 'saldo',            label: 'Saldo',              grupo: 'Real',               tipo: 'number', readonly: true, formula: '{ingreso_real} - {valor_premios}' },
  { key: 'saldo_recaudac',   label: 'Saldo x Recaudac',   grupo: 'Real',               tipo: 'number' },

  // Contador Analógico
  { key: 'cred_ant',         label: 'Crédito ANT',        grupo: 'Contador Analógico', tipo: 'number', readonly: true, formula: '{prev:cred_act}' },
  { key: 'prem_ant',         label: 'Premio ANT',         grupo: 'Contador Analógico', tipo: 'number', readonly: true, formula: '{prev:prem_act}' },
  { key: 'cred_act',         label: 'Crédito ACT',        grupo: 'Contador Analógico', tipo: 'number' },
  { key: 'prem_act',         label: 'Premio ACT',         grupo: 'Contador Analógico', tipo: 'number' },
  { key: 'cred_dif',         label: 'Crédito DIF',        grupo: 'Contador Analógico', tipo: 'number', readonly: true, formula: '{cred_act} - {cred_ant}' },
  { key: 'prem_dif',         label: 'Premio DIF',         grupo: 'Contador Analógico', tipo: 'number', readonly: true, formula: '{prem_act} - {prem_ant}' },

  // Premios Real
  { key: 'stock_ini',        label: 'Stock Ini',          grupo: 'Premios Real',       tipo: 'number', readonly: true, formula: '{prev:stock_fin}' },
  { key: 'salida_real',      label: 'Salida Real',        grupo: 'Premios Real',       tipo: 'number' },
  { key: 'reposicion',       label: 'Reposición',         grupo: 'Premios Real',       tipo: 'number' },
  { key: 'stock_fin',        label: 'Stock Fin',          grupo: 'Premios Real',       tipo: 'number', readonly: true, formula: '{stock_ini} - {salida_real} + {reposicion}' },
  { key: 'precio_premios',   label: 'Precio Premios',     grupo: 'Premios Real',       tipo: 'number' },
  { key: 'valor_reposic',    label: 'Valor Reposición',   grupo: 'Premios Real',       tipo: 'number', readonly: true, formula: '{reposicion} * {precio_premios}' },
];

const MACHINES = [
  'PL-001-Tank',
  'PL-001-Medi',
  'PL-002-Medi',
  'PL-003-Medi',
  'PL-004-Medi',
  'PL-001-PlayT',
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔑 Iniciando sesión como superadmin…');
  const token = await login();

  // Lugar
  const lugares = await api(token, 'GET', '/machines/meta/lugares');
  let lugar = lugares.find(l => l.nombre === LUGAR.nombre);
  if (lugar) {
    console.log(`✓ Lugar ya existe: ${lugar.nombre} (id=${lugar.id})`);
    // Actualizar coords si están vacías
    if (!lugar.lat || !lugar.lng) {
      lugar = await api(token, 'PATCH', `/machines/meta/lugares/${lugar.id}`, LUGAR);
      console.log(`  ↳ Coords actualizadas`);
    }
  } else {
    lugar = await api(token, 'POST', '/machines/meta/lugares', LUGAR);
    console.log(`✅ Lugar creado: ${lugar.nombre} (id=${lugar.id})`);
  }

  // Tipo
  const tipos = await api(token, 'GET', '/machines/meta/tipos');
  let tipo = tipos.find(t => t.desc === TIPO_DESC);
  if (tipo) {
    console.log(`✓ Tipo ya existe: ${tipo.desc} (id=${tipo.id})`);
  } else {
    tipo = await api(token, 'POST', '/machines/meta/tipos', { desc: TIPO_DESC });
    console.log(`✅ Tipo creado: ${tipo.desc} (id=${tipo.id})`);
  }

  // Campos
  const existingKeys = new Set((tipo.campos ?? []).map(c => c.key));
  let created = 0, skipped = 0;
  for (const campo of CAMPOS) {
    if (existingKeys.has(campo.key)) { skipped++; continue; }
    await api(token, 'POST', `/machines/meta/tipos/${tipo.id}/campos`, {
      key:               campo.key,
      label:             campo.label,
      grupo:             campo.grupo,
      tipo:              campo.tipo,
      requerido:         campo.requerido   ?? false,
      readonly:          campo.readonly    ?? (campo.tipo === 'constant'),
      formula:           campo.formula     ?? '',
      ancho:             campo.ancho       ?? 2,
      usaUltimoRegistro: campo.usaUltimoRegistro ?? false,
    });
    console.log(`  ✅ Campo: ${campo.key}`);
    created++;
  }
  if (skipped) console.log(`  · ${skipped} campos ya existían`);
  console.log(`Campos: ${created} creados.`);

  // Máquinas
  const existingMachines = await api(token, 'GET', '/machines');
  const existingIds = new Set(existingMachines.map(m => m.id));
  let mCreated = 0, mSkipped = 0;
  for (const id of MACHINES) {
    if (existingIds.has(id)) { mSkipped++; continue; }
    await api(token, 'POST', '/machines', { id, tmqId: tipo.id, lgrId: lugar.id });
    console.log(`  ✅ Máquina: ${id}`);
    mCreated++;
  }
  if (mSkipped) console.log(`  · ${mSkipped} máquinas ya existían`);
  console.log(`Máquinas: ${mCreated} creadas.`);

  console.log('\n🎉 Seed completado.');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
