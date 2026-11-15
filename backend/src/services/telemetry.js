import { evaluate, classifyThermal, worst, RULES } from './thresholds.js'
import { notFound } from '../http/errors.js'

const iso = () => new Date().toISOString()
const BIO_COLS = ['heart_rate', 'spo2', 'core_temp', 'resp_rate', 'bp_sys', 'bp_dia']
const SUIT_COLS = ['cabin_pressure', 'primary_o2', 'secondary_o2', 'co2_scrubber', 'coolant_temp', 'power_reserve']
const ENV_COLS = ['po2', 'pn2', 'pco2', 'dose_msv']

export function createTelemetryService({ db, hub, alerts }) {
  const crewById = (id) => {
    const c = db.prepare('SELECT * FROM crew_members WHERE id = ?').get(id)
    if (!c) throw notFound('Crew member not found')
    return c
  }

  const shapeBio = (r) => r && ({
    id: r.id, crewId: r.crew_id, timestamp: r.ts, status: r.status, source: r.source,
    heartRate: r.heart_rate, spo2: r.spo2, coreTemp: r.core_temp, respRate: r.resp_rate,
    bloodPressure: r.bp_sys != null && r.bp_dia != null ? { systolic: r.bp_sys, diastolic: r.bp_dia, display: `${Math.round(r.bp_sys)}/${Math.round(r.bp_dia)}` } : null,
    ecgStatus: r.ecg_status
  })
  const shapeSuit = (r) => r && ({
    id: r.id, crewId: r.crew_id, timestamp: r.ts, status: r.status, source: r.source,
    cabinPressure: r.cabin_pressure, primaryO2: r.primary_o2, secondaryO2: r.secondary_o2,
    co2Scrubber: r.co2_scrubber, coolantTemp: r.coolant_temp, powerReserve: r.power_reserve
  })
  const shapeEnv = (r) => r && ({
    id: r.id, timestamp: r.ts, status: r.status, source: r.source, po2: r.po2, pn2: r.pn2, pco2: r.pco2, doseMsv: r.dose_msv
  })

  const range = ({ from, to, limit = 200 }, tsCol = 'ts') => {
    const w = [], a = []
    if (from) { w.push(`${tsCol} >= ?`); a.push(from) }
    if (to) { w.push(`${tsCol} <= ?`); a.push(to) }
    return { clause: w.length ? ' AND ' + w.join(' AND ') : '', args: a, limit }
  }

  return {
    crewById,

    // ---------- biometrics ----------
    recordBiometrics(crewId, d, source = 'api') {
      const crew = crewById(crewId)
      const ts = d.timestamp || iso()
      const ev = evaluate('biometrics', d)
      const info = db.prepare(`INSERT INTO biometrics (crew_id,ts,heart_rate,spo2,core_temp,resp_rate,bp_sys,bp_dia,ecg_status,status,source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(crewId, ts, d.heart_rate ?? null, d.spo2 ?? null, d.core_temp ?? null, d.resp_rate ?? null,
        d.bp_sys ?? null, d.bp_dia ?? null, d.ecg_status || 'stable', ev.status, source)
      const record = shapeBio(db.prepare('SELECT * FROM biometrics WHERE id = ?').get(Number(info.lastInsertRowid)))
      const raised = alerts.raise({ domain: 'biometrics', subject: `crew${crewId}`, subjectLabel: `Crew ${crew.code}`, crewId, evaluation: ev, source })
      hub.broadcast('biometrics', { crewId, crewCode: crew.code, ...record, metrics: ev.metrics })
      return { record, evaluation: ev, incidents: raised }
    },
    latestBiometrics(crewId) {
      crewById(crewId)
      const r = db.prepare('SELECT * FROM biometrics WHERE crew_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(crewId)
      return r ? { ...shapeBio(r), metrics: evaluate('biometrics', r).metrics } : null
    },
    latestBiometricsRow(crewId) {
      return db.prepare('SELECT * FROM biometrics WHERE crew_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(crewId)
    },
    biometricsHistory(crewId, q) {
      crewById(crewId)
      const r = range(q)
      return db.prepare(`SELECT * FROM (SELECT * FROM biometrics WHERE crew_id = ?${r.clause} ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts ASC`)
        .all(crewId, ...r.args, r.limit).map(shapeBio)
    },

    // ---------- suit ----------
    recordSuit(crewId, d, source = 'api') {
      const crew = crewById(crewId)
      const ts = d.timestamp || iso()
      const ev = evaluate('suit', d)
      const info = db.prepare(`INSERT INTO suit_telemetry (crew_id,ts,cabin_pressure,primary_o2,secondary_o2,co2_scrubber,coolant_temp,power_reserve,status,source)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crewId, ts, d.cabin_pressure ?? null, d.primary_o2 ?? null, d.secondary_o2 ?? null,
        d.co2_scrubber ?? null, d.coolant_temp ?? null, d.power_reserve ?? null, ev.status, source)
      const record = shapeSuit(db.prepare('SELECT * FROM suit_telemetry WHERE id = ?').get(Number(info.lastInsertRowid)))
      const raised = alerts.raise({ domain: 'suit', subject: `crew${crewId}`, subjectLabel: `Suit ${crew.code}`, crewId, evaluation: ev, source })
      hub.broadcast('suit', { crewId, crewCode: crew.code, ...record, metrics: ev.metrics })
      return { record, evaluation: ev, incidents: raised }
    },
    latestSuit(crewId) {
      crewById(crewId)
      const r = db.prepare('SELECT * FROM suit_telemetry WHERE crew_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(crewId)
      return r ? { ...shapeSuit(r), metrics: evaluate('suit', r).metrics } : null
    },
    latestSuitRow(crewId) {
      return db.prepare('SELECT * FROM suit_telemetry WHERE crew_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(crewId)
    },
    suitHistory(crewId, q) {
      crewById(crewId)
      const r = range(q)
      return db.prepare(`SELECT * FROM (SELECT * FROM suit_telemetry WHERE crew_id = ?${r.clause} ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts ASC`)
        .all(crewId, ...r.args, r.limit).map(shapeSuit)
    },

    // ---------- environment ----------
    recordEnvironment(d, source = 'api') {
      const ts = d.timestamp || iso()
      const ev = evaluate('environment', d)
      const info = db.prepare(`INSERT INTO environment_readings (ts,po2,pn2,pco2,dose_msv,status,source) VALUES (?,?,?,?,?,?,?)`)
        .run(ts, d.po2 ?? null, d.pn2 ?? null, d.pco2 ?? null, d.dose_msv ?? null, ev.status, source)
      const record = shapeEnv(db.prepare('SELECT * FROM environment_readings WHERE id = ?').get(Number(info.lastInsertRowid)))
      const raised = alerts.raise({ domain: 'environment', subject: 'habitat', subjectLabel: 'Habitat', crewId: null, evaluation: ev, source })
      hub.broadcast('environment', { ...record, metrics: ev.metrics })
      return { record, evaluation: ev, incidents: raised }
    },
    latestEnvironment() {
      const r = db.prepare('SELECT * FROM environment_readings ORDER BY ts DESC, id DESC LIMIT 1').get()
      return r ? { ...shapeEnv(r), metrics: evaluate('environment', r).metrics } : null
    },
    latestEnvironmentRow() { return db.prepare('SELECT * FROM environment_readings ORDER BY ts DESC, id DESC LIMIT 1').get() },
    environmentHistory(q) {
      const r = range(q)
      return db.prepare(`SELECT * FROM (SELECT * FROM environment_readings WHERE 1=1${r.clause} ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts ASC`)
        .all(...r.args, r.limit).map(shapeEnv)
    },

    // ---------- thermal ----------
    zones() { return db.prepare('SELECT * FROM thermal_zones ORDER BY id').all() },
    recordThermal(zoneSlug, tempC, source = 'api', timestamp) {
      const zone = db.prepare('SELECT * FROM thermal_zones WHERE slug = ?').get(zoneSlug)
      if (!zone) throw notFound(`Unknown thermal zone: ${zoneSlug}`)
      const status = classifyThermal(tempC, zone.setpoint_c)
      db.prepare('INSERT INTO thermal_readings (zone_id,ts,temp_c,status,source) VALUES (?,?,?,?,?)').run(zone.id, timestamp || iso(), tempC, status, source)
      const evaluation = { status, metrics: { [zone.slug]: { value: tempC, status, label: zone.name, unit: '°C' } } }
      const raised = alerts.raise({ domain: 'thermal', subject: zone.slug, subjectLabel: zone.name, crewId: null, evaluation, source,
        detailFor: () => `${zone.name} is ${(tempC - zone.setpoint_c).toFixed(1)}°C from its ${zone.setpoint_c.toFixed(1)}°C setpoint.` })
      const out = { zone: zone.slug, name: zone.name, tempC, setpointC: zone.setpoint_c, status }
      hub.broadcast('thermal', out)
      return { record: out, incidents: raised }
    },
    thermalSnapshot() {
      const zones = this.zones()
      const zoneRows = zones.map(z => {
        const r = db.prepare('SELECT temp_c, ts, status FROM thermal_readings WHERE zone_id = ? ORDER BY ts DESC, id DESC LIMIT 1').get(z.id)
        return {
          zone: z.slug, name: z.name, setpointC: z.setpoint_c,
          tempC: r ? r.temp_c : null, status: r ? classifyThermal(r.temp_c, z.setpoint_c) : null,
          deviationC: r ? Math.round((r.temp_c - z.setpoint_c) * 10) / 10 : null, timestamp: r?.ts ?? null
        }
      })
      const overall = zoneRows.reduce((s, z) => (z.status ? worst(s, z.status) : s), 'normal')
      const core = zoneRows.find(z => z.zone === 'habitat_core')
      return { setpointC: core?.setpointC ?? null, status: overall, zones: zoneRows }
    },
    thermalHistory(zoneSlug, q) {
      const zone = db.prepare('SELECT * FROM thermal_zones WHERE slug = ?').get(zoneSlug)
      if (!zone) throw notFound('Unknown thermal zone')
      const r = range(q)
      return db.prepare(`SELECT * FROM (SELECT ts,temp_c,status FROM thermal_readings WHERE zone_id = ?${r.clause} ORDER BY ts DESC, id DESC LIMIT ?) ORDER BY ts ASC`)
        .all(zone.id, ...r.args, r.limit).map(x => ({ timestamp: x.ts, tempC: x.temp_c, status: x.status }))
    },

    // ---------- maintenance ----------
    prune(hours) {
      const cutoff = new Date(Date.now() - hours * 3600e3).toISOString()
      let n = 0
      for (const t of ['biometrics', 'suit_telemetry', 'environment_readings', 'thermal_readings']) {
        n += Number(db.prepare(`DELETE FROM ${t} WHERE ts < ?`).run(cutoff).changes)
      }
      return n
    }
  }
}

export const METRIC_COLUMNS = { biometrics: BIO_COLS, suit: SUIT_COLS, environment: ENV_COLS }
export { RULES }
