import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, 'seprisa.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Checkpoint any pending WAL data into the main db on every startup.
// This ensures data survives container recreation (Docker bind-mounts seprisa.db + WAL files).
db.pragma('wal_checkpoint(TRUNCATE)');

db.exec(`
  -- ─── Tablas de referencia ─────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS lugar (
    lgr_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    lgr_nombre    TEXT NOT NULL,
    lgr_direccion TEXT,
    lgr_img       TEXT,
    lgr_lat       REAL,
    lgr_lng       REAL
  );

  CREATE TABLE IF NOT EXISTS usuario (
    usu_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    usu_nombre TEXT NOT NULL,
    usu_user   TEXT NOT NULL UNIQUE,
    usu_pass   TEXT NOT NULL,
    usu_rol    TEXT NOT NULL DEFAULT 'terreno'
  );

  CREATE TABLE IF NOT EXISTS vehiculo (
    vei_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    vei_modelo     TEXT NOT NULL,
    vei_km_inicial REAL DEFAULT 0,
    vei_km_actual  REAL DEFAULT 0,
    usu_id         INTEGER REFERENCES usuario(usu_id)
  );

  CREATE TABLE IF NOT EXISTS tipomaquina (
    tmq_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    tmq_desc TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tipo_campo (
    tca_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tmq_id         INTEGER NOT NULL REFERENCES tipomaquina(tmq_id),
    tca_key        TEXT    NOT NULL,
    tca_label      TEXT    NOT NULL,
    tca_grupo      TEXT    NOT NULL DEFAULT 'General',
    tca_tipo       TEXT    NOT NULL DEFAULT 'number',
    tca_requerido  INTEGER NOT NULL DEFAULT 0,
    tca_readonly   INTEGER NOT NULL DEFAULT 0,
    tca_formula    TEXT,
    tca_es_precalc INTEGER NOT NULL DEFAULT 0,
    tca_ancho      INTEGER NOT NULL DEFAULT 2,
    tca_orden      INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tmq_id, tca_key)
  );

  CREATE TABLE IF NOT EXISTS categoria (
    cat_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    cat_nombre     TEXT NOT NULL,
    cat_nvl        INTEGER DEFAULT 1,
    cat_padre      INTEGER REFERENCES categoria(cat_id),
    cat_inventario INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS producto (
    pro_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    pro_nombre    TEXT NOT NULL,
    pro_descrip   TEXT,
    pro_codbarra  TEXT,
    pro_observ    TEXT,
    emp_id        INTEGER,
    imp_id        INTEGER,
    pro_preciodet REAL DEFAULT 0,
    pro_preciomay REAL DEFAULT 0,
    pro_costo     REAL DEFAULT 0,
    pro_costomp   REAL DEFAULT 0,
    pro_pack      INTEGER DEFAULT 1,
    cat_id        INTEGER REFERENCES categoria(cat_id),
    pro_vigente   INTEGER DEFAULT 1,
    pro_vigencia  TEXT
  );

  -- ─── Entidad principal: Máquina ───────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS maquina (
    maq_id       TEXT PRIMARY KEY,
    pro_id       INTEGER REFERENCES producto(pro_id),
    maq_fechacre TEXT DEFAULT (date('now')),
    tmq_id       INTEGER REFERENCES tipomaquina(tmq_id),
    lgr_id       INTEGER REFERENCES lugar(lgr_id),
    maq_status   TEXT DEFAULT 'ok'
  );

  -- ─── Rutas y logística ────────────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS ruta (
    rut_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    vei_id     INTEGER REFERENCES vehiculo(vei_id),
    lgr_id     INTEGER REFERENCES lugar(lgr_id),
    rut_fecha  TEXT DEFAULT (datetime('now')),
    rut_km_ini REAL DEFAULT 0,
    rut_km_fin REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS log_ruta (
    lrt_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    rut_id         INTEGER REFERENCES ruta(rut_id),
    lrt_timestamp  TEXT DEFAULT (datetime('now')),
    lrt_coordenada TEXT,
    lrt_evento     TEXT,
    lgr_id         INTEGER REFERENCES lugar(lgr_id)
  );

  CREATE TABLE IF NOT EXISTS maq_gastos (
    gsq_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    maq_id          TEXT REFERENCES maquina(maq_id),
    rut_id          INTEGER REFERENCES ruta(rut_id),
    gsq_timestamp   TEXT DEFAULT (datetime('now')),
    gsq_coordenada  TEXT,
    gsq_descripcion TEXT,
    gsq_monto       REAL DEFAULT 0
  );

  -- ─── Registros de recaudación ─────────────────────────────────────────────

  CREATE TABLE IF NOT EXISTS rec_registro (
    rre_id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    maq_id                    TEXT REFERENCES maquina(maq_id),
    lgr_id                    INTEGER REFERENCES lugar(lgr_id),
    rre_timestamp             TEXT DEFAULT (datetime('now')),
    rre_coordenada            TEXT,
    rut_id                    INTEGER REFERENCES ruta(rut_id),
    rre_cont_entrada          INTEGER DEFAULT 0,
    rre_cont_salida           INTEGER DEFAULT 0,
    rre_cont_dif              INTEGER DEFAULT 0,
    rre_cont_rec_digital      INTEGER DEFAULT 0,
    rre_cont_rec_pozo         INTEGER DEFAULT 0,
    rre_cont_real             INTEGER DEFAULT 0,
    rre_cont_real_dif         INTEGER DEFAULT 0,
    rre_cont_premio_entrada   INTEGER DEFAULT 0,
    rre_cont_premio_salida    INTEGER DEFAULT 0,
    rre_cont_premio_stock_act INTEGER DEFAULT 0,
    rre_cont_premio_stock_add INTEGER DEFAULT 0,
    rre_cont_juegos_utilizados INTEGER DEFAULT 0,
    rre_mnto_locatario        REAL DEFAULT 0,
    rre_mnto_casa             REAL DEFAULT 0,
    rre_mnto_recaudador       REAL DEFAULT 0,
    rre_mnto_total            REAL DEFAULT 0,
    rre_pre_calc              REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS rec_img (
    rim_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    rim_path   TEXT NOT NULL,
    rim_evento TEXT,
    rim_obs    TEXT,
    rre_id     INTEGER REFERENCES rec_registro(rre_id)
  );

  -- ─── Ejecución de rutas de recaudación (feature app) ─────────────────────

  CREATE TABLE IF NOT EXISTS route_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at     TEXT DEFAULT (datetime('now')),
    completed_at   TEXT,
    status         TEXT DEFAULT 'active',
    total_distance REAL DEFAULT 0,
    total_time     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS route_run_stops (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    route_run_id  INTEGER REFERENCES route_runs(id),
    machine_id    TEXT REFERENCES maquina(maq_id),
    stop_order    INTEGER,
    status        TEXT DEFAULT 'pending',
    visited_at    TEXT
  );
`);

// ─── Migrations ──────────────────────────────────────────────────────────────
const rreCols = db.prepare("PRAGMA table_info(rec_registro)").all().map(c => c.name);
if (!rreCols.includes('route_run_id')) {
  db.exec('ALTER TABLE rec_registro ADD COLUMN route_run_id INTEGER REFERENCES route_runs(id)');
}

// app_config: almacena reglas de negocio editables por superadmin
db.exec(`CREATE TABLE IF NOT EXISTS app_config (
  cfg_key   TEXT PRIMARY KEY,
  cfg_value TEXT NOT NULL
)`);

// tmq_fields: campos configurables por tipo de máquina
const tmqCols = db.prepare("PRAGMA table_info(tipomaquina)").all().map(c => c.name);
if (!tmqCols.includes('tmq_fields')) {
  db.exec("ALTER TABLE tipomaquina ADD COLUMN tmq_fields TEXT DEFAULT '[]'");
  db.prepare("UPDATE tipomaquina SET tmq_fields = ? WHERE tmq_desc IN ('Peluches','Casitas','Grúa')").run(JSON.stringify(['digital','premios']));
  db.prepare("UPDATE tipomaquina SET tmq_fields = ? WHERE tmq_desc = 'Monedas'").run(JSON.stringify([]));
}

// superadmin: usuario con acceso a configuración del negocio
if (!db.prepare("SELECT 1 FROM usuario WHERE usu_user = 'superadmin'").get()) {
  db.prepare('INSERT INTO usuario (usu_nombre, usu_user, usu_pass, usu_rol) VALUES (?,?,?,?)').run(
    'Super Admin', 'superadmin', bcrypt.hashSync('superadmin', 10), 'superadmin'
  );
}

// rre_campos_extra: JSON blob con todos los valores de campos dinámicos
const rreCols2 = db.prepare("PRAGMA table_info(rec_registro)").all().map(c => c.name);
if (!rreCols2.includes('rre_campos_extra')) {
  db.exec("ALTER TABLE rec_registro ADD COLUMN rre_campos_extra TEXT DEFAULT '{}'");
}

// rre_tipo: 'normal' | 'init' — distingue registros de recaudación de registros de inicialización
const rreCols3 = db.prepare("PRAGMA table_info(rec_registro)").all().map(c => c.name);
if (!rreCols3.includes('rre_tipo')) {
  db.exec("ALTER TABLE rec_registro ADD COLUMN rre_tipo TEXT NOT NULL DEFAULT 'normal'");
}

// tca_usa_ultimo_registro + tca_opciones: nuevas columnas para campos dinámicos
const tcaCols = db.prepare("PRAGMA table_info(tipo_campo)").all().map(c => c.name);
if (!tcaCols.includes('tca_usa_ultimo_registro')) {
  db.exec("ALTER TABLE tipo_campo ADD COLUMN tca_usa_ultimo_registro INTEGER NOT NULL DEFAULT 0");
}
if (!tcaCols.includes('tca_opciones')) {
  db.exec("ALTER TABLE tipo_campo ADD COLUMN tca_opciones TEXT");
}

// Tipos de producto del catálogo (Maquina, Electronico, etc.)
db.exec(`CREATE TABLE IF NOT EXISTS item_tipo_cat (
  itc_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  itc_nombre TEXT NOT NULL UNIQUE
)`);
// Seed inicial
const _tiposExist = db.prepare('SELECT COUNT(*) as n FROM item_tipo_cat').get().n;
if (_tiposExist === 0) {
  db.prepare('INSERT INTO item_tipo_cat (itc_nombre) VALUES (?),(?),(?)').run('Maquina', 'Electronico', 'Otro');
}

// catalogo_item: productos y servicios con precios para usar en caja
db.exec(`CREATE TABLE IF NOT EXISTS catalogo_item (
  item_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  item_nombre  TEXT NOT NULL,
  item_tipo    TEXT NOT NULL DEFAULT 'producto' CHECK(item_tipo IN ('producto','servicio')),
  item_precio  REAL NOT NULL DEFAULT 0,
  item_descrip TEXT,
  item_vigente INTEGER NOT NULL DEFAULT 1,
  item_imagen  TEXT
)`);
// migración: agregar columnas si no existen
{
  const _ciCols = db.prepare("PRAGMA table_info(catalogo_item)").all().map(c => c.name);
  if (!_ciCols.includes('item_imagen'))  db.exec("ALTER TABLE catalogo_item ADD COLUMN item_imagen TEXT");
  if (!_ciCols.includes('item_stock'))   db.exec("ALTER TABLE catalogo_item ADD COLUMN item_stock INTEGER NOT NULL DEFAULT 0");
  if (!_ciCols.includes('item_cat_id'))  db.exec("ALTER TABLE catalogo_item ADD COLUMN item_cat_id INTEGER REFERENCES item_tipo_cat(itc_id)");
  if (!_ciCols.includes('item_tmq_id'))  db.exec("ALTER TABLE catalogo_item ADD COLUMN item_tmq_id INTEGER REFERENCES tipomaquina(tmq_id)");
}

// caja_movimiento: registros de ingresos y egresos de caja
db.exec(`CREATE TABLE IF NOT EXISTS caja_movimiento (
  mov_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  mov_tipo          TEXT NOT NULL CHECK(mov_tipo IN ('ingreso','egreso')),
  mov_concepto      TEXT NOT NULL,
  mov_monto         REAL NOT NULL,
  mov_metodo_pago   TEXT NOT NULL DEFAULT 'efectivo',
  mov_es_reembolso  INTEGER NOT NULL DEFAULT 0,
  mov_ref_id        INTEGER REFERENCES caja_movimiento(mov_id),
  mov_timestamp     TEXT DEFAULT (datetime('now')),
  usu_id            INTEGER REFERENCES usuario(usu_id),
  usu_nombre        TEXT
)`);

// Migraciones: agregar columnas nuevas si la tabla ya existía
(() => {
  const cols = db.prepare("PRAGMA table_info(caja_movimiento)").all().map(c => c.name);
  if (!cols.includes('mov_metodo_pago'))   db.exec("ALTER TABLE caja_movimiento ADD COLUMN mov_metodo_pago  TEXT NOT NULL DEFAULT 'efectivo'");
  if (!cols.includes('mov_es_reembolso'))  db.exec("ALTER TABLE caja_movimiento ADD COLUMN mov_es_reembolso INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes('mov_ref_id'))        db.exec("ALTER TABLE caja_movimiento ADD COLUMN mov_ref_id       INTEGER");
  if (!cols.includes('mov_referencia'))    db.exec("ALTER TABLE caja_movimiento ADD COLUMN mov_referencia   TEXT");
  if (!cols.includes('cli_id'))            db.exec("ALTER TABLE caja_movimiento ADD COLUMN cli_id            INTEGER REFERENCES cliente(cli_id)");
  if (!cols.includes('cli_nombre_snap'))   db.exec("ALTER TABLE caja_movimiento ADD COLUMN cli_nombre_snap  TEXT");
  if (!cols.includes('mov_items'))         db.exec("ALTER TABLE caja_movimiento ADD COLUMN mov_items         TEXT");
})();

// ─── Seed usuarios base (solo si no existen) ─────────────────────────────────
const usuCount = db.prepare("SELECT COUNT(*) as n FROM usuario WHERE usu_user IN ('admin','terreno')").get().n;
if (usuCount === 0) {
  const insUsu = db.prepare('INSERT INTO usuario (usu_nombre, usu_user, usu_pass, usu_rol) VALUES (?,?,?,?)');
  insUsu.run('Admin Central', 'admin',   bcrypt.hashSync('admin',   10), 'admin');
  insUsu.run('Recaudador',    'terreno', bcrypt.hashSync('terreno', 10), 'terreno');
}

// ─── Seed usuario cajero (solo si no existe) ──────────────────────────────────
if (!db.prepare("SELECT 1 FROM usuario WHERE usu_user = 'cajero'").get()) {
  db.prepare('INSERT INTO usuario (usu_nombre, usu_user, usu_pass, usu_rol) VALUES (?,?,?,?)').run(
    'Cajero', 'cajero', bcrypt.hashSync('cajero', 10), 'caja'
  );
}

// ─── Limpieza total del sistema (migración única) ─────────────────────────────
if (!db.prepare("SELECT 1 FROM app_config WHERE cfg_key = 'schema_clean_v1'").get()) {
  db.transaction(() => {
    db.prepare('DELETE FROM rec_registro').run();
    db.prepare('DELETE FROM rec_img').run();
    db.prepare('DELETE FROM route_run_stops').run();
    db.prepare('DELETE FROM route_runs').run();
    db.prepare('DELETE FROM maquina').run();
    db.prepare('DELETE FROM tipo_campo').run();
    db.prepare('DELETE FROM tipomaquina').run();
    db.prepare('DELETE FROM lugar').run();
    db.prepare("DELETE FROM app_config WHERE cfg_key IN ('precioFicha','pctLocatario','pctCasa','pctRecaudador')").run();
    db.prepare("INSERT INTO app_config (cfg_key, cfg_value) VALUES ('schema_clean_v1','1')").run();
  })();
  console.log('[db] Sistema limpiado — listo para configuración inicial por superadmin.');
}

// Migration: contraseña en texto plano para vista de admin
(() => {
  const cols = db.prepare("PRAGMA table_info(usuario)").all().map(c => c.name);
  if (!cols.includes('usu_pass_plain')) db.exec("ALTER TABLE usuario ADD COLUMN usu_pass_plain TEXT");
})();

// Migration: recaudador asignado en route_runs
(() => {
  const cols = db.prepare("PRAGMA table_info(route_runs)").all().map(c => c.name);
  if (!cols.includes('usu_id'))             db.exec("ALTER TABLE route_runs ADD COLUMN usu_id INTEGER REFERENCES usuario(usu_id)");
  if (!cols.includes('recaudador_nombre'))   db.exec("ALTER TABLE route_runs ADD COLUMN recaudador_nombre TEXT");
})();

// ─── Cierre de caja diario ───────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS caja_cierre (
  cierre_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cierre_fecha      TEXT NOT NULL UNIQUE,
  cierre_timestamp  TEXT DEFAULT (datetime('now')),
  cierre_ingresos   REAL DEFAULT 0,
  cierre_egresos    REAL DEFAULT 0,
  cierre_reembolsos REAL DEFAULT 0,
  cierre_balance    REAL DEFAULT 0,
  cierre_mov_count  INTEGER DEFAULT 0,
  cierre_notas      TEXT,
  usu_id            INTEGER REFERENCES usuario(usu_id),
  usu_nombre        TEXT
)`);

// ─── Clientes ────────────────────────────────────────────────────────────────
db.exec(`CREATE TABLE IF NOT EXISTS cliente (
  cli_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  cli_nombre    TEXT NOT NULL,
  cli_tipo      TEXT NOT NULL DEFAULT 'persona' CHECK(cli_tipo IN ('persona','empresa')),
  cli_ruc_ci    TEXT,
  cli_email     TEXT,
  cli_telefono  TEXT,
  cli_direccion TEXT,
  cli_contacto  TEXT,
  cli_notas     TEXT,
  cli_activo    INTEGER NOT NULL DEFAULT 1,
  cli_fechacre  TEXT DEFAULT (datetime('now')),
  cli_lat       REAL,
  cli_lng       REAL
)`);

// Migración: añadir coordenadas si la tabla ya existía sin ellas
(() => {
  const cols = db.prepare("PRAGMA table_info(cliente)").all().map(c => c.name);
  if (!cols.includes('cli_lat')) db.exec("ALTER TABLE cliente ADD COLUMN cli_lat REAL");
  if (!cols.includes('cli_lng')) db.exec("ALTER TABLE cliente ADD COLUMN cli_lng REAL");
})();

// Migración: timestamps de usuarios
(() => {
  const cols = db.prepare("PRAGMA table_info(usuario)").all().map(c => c.name);
  if (!cols.includes('usu_fechacre')) db.exec("ALTER TABLE usuario ADD COLUMN usu_fechacre TEXT");
  if (!cols.includes('usu_fechamod')) db.exec("ALTER TABLE usuario ADD COLUMN usu_fechamod TEXT");
})();

// Migración: asignación de máquinas a clientes
(() => {
  const cols = db.prepare("PRAGMA table_info(maquina)").all().map(c => c.name);
  if (!cols.includes('cli_id')) db.exec("ALTER TABLE maquina ADD COLUMN cli_id INTEGER REFERENCES cliente(cli_id)");
})();

// Tabla: productos asignados a clientes
db.exec(`CREATE TABLE IF NOT EXISTS cliente_producto (
  cp_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  cli_id      INTEGER NOT NULL REFERENCES cliente(cli_id),
  item_id     INTEGER NOT NULL REFERENCES catalogo_item(item_id),
  cp_cantidad INTEGER NOT NULL DEFAULT 1,
  cp_fecha    TEXT DEFAULT (datetime('now')),
  UNIQUE(cli_id, item_id)
)`);

// Migración: reemplazar pro_id → item_id si la tabla aún usa la columna vieja
(() => {
  const cols = db.prepare("PRAGMA table_info(cliente_producto)").all().map(c => c.name);
  if (cols.includes('pro_id')) {
    const rows = db.prepare('SELECT * FROM cliente_producto').all();
    db.exec('DROP TABLE cliente_producto');
    db.exec(`CREATE TABLE cliente_producto (
      cp_id       INTEGER PRIMARY KEY AUTOINCREMENT,
      cli_id      INTEGER NOT NULL REFERENCES cliente(cli_id),
      item_id     INTEGER NOT NULL REFERENCES catalogo_item(item_id),
      cp_cantidad INTEGER NOT NULL DEFAULT 1,
      cp_fecha    TEXT DEFAULT (datetime('now')),
      UNIQUE(cli_id, item_id)
    )`);
    for (const r of rows) {
      db.prepare('INSERT OR IGNORE INTO cliente_producto (cli_id, item_id, cp_cantidad, cp_fecha) VALUES (?,?,?,?)')
        .run(r.cli_id, r.pro_id, r.cp_cantidad, r.cp_fecha);
    }
  }
  // Agregar columna cp_origen si no existe
  const colsNow = db.prepare("PRAGMA table_info(cliente_producto)").all().map(c => c.name);
  if (!colsNow.includes('cp_origen')) {
    db.exec("ALTER TABLE cliente_producto ADD COLUMN cp_origen TEXT NOT NULL DEFAULT 'manual'");
    // Marcar como 'venta' los que provengan de caja_movimiento
    db.exec(`
      UPDATE cliente_producto SET cp_origen = 'venta'
      WHERE EXISTS (
        SELECT 1 FROM caja_movimiento
        WHERE caja_movimiento.cli_id = cliente_producto.cli_id
          AND caja_movimiento.mov_tipo = 'ingreso'
          AND json_extract(caja_movimiento.mov_items, '$[0].item_id') IS NOT NULL
      )
    `);
  }
})();

export default db;
