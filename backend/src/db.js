import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { hashPassword } from './auth/passwords.js'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','flight_surgeon','mission_control','crew','observer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS crew_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mission_role TEXT NOT NULL DEFAULT 'Crew',
  shift_hours REAL NOT NULL DEFAULT 4,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS biometrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  heart_rate REAL, spo2 REAL, core_temp REAL, resp_rate REAL,
  bp_sys REAL, bp_dia REAL, ecg_status TEXT NOT NULL DEFAULT 'stable',
  status TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_bio_crew_ts ON biometrics(crew_id, ts);

CREATE TABLE IF NOT EXISTS suit_telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crew_id INTEGER NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  cabin_pressure REAL, primary_o2 REAL, secondary_o2 REAL,
  co2_scrubber REAL, coolant_temp REAL, power_reserve REAL,
  status TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_suit_crew_ts ON suit_telemetry(crew_id, ts);

CREATE TABLE IF NOT EXISTS environment_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  po2 REAL, pn2 REAL, pco2 REAL, dose_msv REAL,
  status TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_env_ts ON environment_readings(ts);

CREATE TABLE IF NOT EXISTS thermal_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  setpoint_c REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS thermal_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES thermal_zones(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  temp_c REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL DEFAULT 'api'
);
CREATE INDEX IF NOT EXISTS idx_thermal_zone_ts ON thermal_readings(zone_id, ts);

CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('INFO','WATCH','CRITICAL','MANUAL','ALARM')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'system',
  crew_id INTEGER REFERENCES crew_members(id) ON DELETE SET NULL,
  dedupe_key TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TEXT,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inc_ts ON incidents(ts);
CREATE INDEX IF NOT EXISTS idx_inc_dedupe ON incidents(dedupe_key, ts);

CREATE TABLE IF NOT EXISTS gate_items (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  checked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS gate_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cleared INTEGER NOT NULL DEFAULT 0,
  cleared_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  cleared_at TEXT
);

CREATE TABLE IF NOT EXISTS alarm_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  activated_by TEXT,
  activated_at TEXT,
  silenced_by TEXT,
  silenced_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_id INTEGER,
  user_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
`

const GATE_ITEMS = [
  ['crew_health_review', 'Crew health review acknowledged'],
  ['environmental_review', 'Environmental systems reviewed'],
  ['suit_telemetry_check', 'Suit telemetry checked'],
  ['procedure_briefing', 'Mission procedure briefing completed']
]

const ZONES = [
  ['habitat_core', 'Habitat core', 21.8],
  ['aft_equipment_bay', 'Aft equipment bay', 21.8],
  ['crew_quarters', 'Crew quarters', 21.2],
  ['suit_interface', 'Suit interface', 19.6]
]

export function openDb(config) {
  if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true })
  const db = new DatabaseSync(config.dbPath)
  db.exec(SCHEMA)
  seed(db, config)
  return db
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function seed(db, config) {
  const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n

  if (count('gate_items') === 0) {
    const ins = db.prepare('INSERT INTO gate_items (key,label,position) VALUES (?,?,?)')
    GATE_ITEMS.forEach(([k, l], i) => ins.run(k, l, i))
  }
  db.prepare('INSERT OR IGNORE INTO gate_state (id) VALUES (1)').run()
  db.prepare('INSERT OR IGNORE INTO alarm_state (id) VALUES (1)').run()

  if (count('thermal_zones') === 0) {
    const ins = db.prepare('INSERT INTO thermal_zones (slug,name,setpoint_c) VALUES (?,?,?)')
    ZONES.forEach(z => ins.run(...z))
  }
  if (count('crew_members') === 0) {
    db.prepare('INSERT INTO crew_members (code,name,mission_role,shift_hours) VALUES (?,?,?,?)').run('A', 'Crew member A', 'Commander', 4)
    db.prepare('INSERT INTO crew_members (code,name,mission_role,shift_hours) VALUES (?,?,?,?)').run('B', 'Crew member B', 'Mission specialist', 3)
  }
  db.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').run(
    'support_contact', JSON.stringify({ label: 'Central support contact', phone: '+10000000000', message: 'Crew health alert: please contact the mission control team.' })
  )

  if (count('users') === 0) {
    const ins = db.prepare('INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)')
    if (config.adminEmail && config.adminPassword) {
      ins.run(config.adminEmail, 'Administrator', hashPassword(config.adminPassword), 'admin')
    } else if (config.seedDemoUsers) {
      const pw = hashPassword('ChangeMe123!')
      ins.run('admin@crewhealth.local', 'Mission Admin', pw, 'admin')
      ins.run('surgeon@crewhealth.local', 'Flight Surgeon', pw, 'flight_surgeon')
      ins.run('control@crewhealth.local', 'Mission Control', pw, 'mission_control')
      ins.run('crew@crewhealth.local', 'Crew Member A', pw, 'crew')
      ins.run('observer@crewhealth.local', 'Observer', pw, 'observer')
      config.demoUsersSeeded = true
    } else {
      throw new Error('No users exist. Set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin.')
    }
  }
}
