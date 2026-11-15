import { requireRead, requireIngest, audit } from '../auth/middleware.js'
import { validate } from '../http/validate.js'
import { HttpError } from '../http/errors.js'
import { historyQuery } from './crew.js'

const ts = { type: 'string', maxLength: 40 }

function checkTimestamp(t) {
  if (!t) return undefined
  const ms = Date.parse(t)
  if (Number.isNaN(ms)) throw new HttpError(422, 'Validation failed', { timestamp: 'must be an ISO-8601 date-time' })
  if (ms > Date.now() + 5 * 60_000) throw new HttpError(422, 'Validation failed', { timestamp: 'cannot be in the future' })
  return new Date(ms).toISOString()
}
function atLeastOne(obj, keys) {
  if (!keys.some(k => obj[k] !== undefined)) throw new HttpError(422, 'Validation failed', { _: `provide at least one of: ${keys.join(', ')}` })
}

export function telemetryRoutes(router, { telemetry, db }) {
  // ---------- ingestion (sensor gateway via X-API-Key, or operator login) ----------
  router.post('/api/telemetry/biometrics', requireIngest, (ctx) => {
    const b = validate(ctx.body, {
      crewId: { type: 'integer', required: true, min: 1 },
      heartRate: { type: 'number', min: 0, max: 300 }, spo2: { type: 'number', min: 0, max: 100 },
      coreTemp: { type: 'number', min: 25, max: 45 }, respRate: { type: 'number', min: 0, max: 80 },
      bpSystolic: { type: 'number', min: 30, max: 300 }, bpDiastolic: { type: 'number', min: 20, max: 200 },
      ecgStatus: { type: 'string', enum: ['stable', 'irregular', 'critical'], default: 'stable' }, timestamp: ts
    })
    atLeastOne(b, ['heartRate', 'spo2', 'coreTemp', 'respRate', 'bpSystolic', 'bpDiastolic'])
    const out = telemetry.recordBiometrics(b.crewId, {
      heart_rate: b.heartRate, spo2: b.spo2, core_temp: b.coreTemp, resp_rate: b.respRate,
      bp_sys: b.bpSystolic, bp_dia: b.bpDiastolic, ecg_status: b.ecgStatus, timestamp: checkTimestamp(b.timestamp)
    }, ctx.user.role === 'device' ? 'device' : 'manual')
    ctx.send(201, out)
  })

  router.post('/api/telemetry/suit', requireIngest, (ctx) => {
    const b = validate(ctx.body, {
      crewId: { type: 'integer', required: true, min: 1 },
      cabinPressure: { type: 'number', min: 0, max: 200 }, primaryO2: { type: 'number', min: 0, max: 100 },
      secondaryO2: { type: 'number', min: 0, max: 100 }, co2Scrubber: { type: 'number', min: 0, max: 100 },
      coolantTemp: { type: 'number', min: -50, max: 100 }, powerReserve: { type: 'number', min: 0, max: 100 }, timestamp: ts
    })
    atLeastOne(b, ['cabinPressure', 'primaryO2', 'secondaryO2', 'co2Scrubber', 'coolantTemp', 'powerReserve'])
    const out = telemetry.recordSuit(b.crewId, {
      cabin_pressure: b.cabinPressure, primary_o2: b.primaryO2, secondary_o2: b.secondaryO2,
      co2_scrubber: b.co2Scrubber, coolant_temp: b.coolantTemp, power_reserve: b.powerReserve, timestamp: checkTimestamp(b.timestamp)
    }, ctx.user.role === 'device' ? 'device' : 'manual')
    ctx.send(201, out)
  })

  router.post('/api/telemetry/environment', requireIngest, (ctx) => {
    const b = validate(ctx.body, {
      po2: { type: 'number', min: 0, max: 100 }, pn2: { type: 'number', min: 0, max: 150 },
      pco2: { type: 'number', min: 0, max: 50 }, doseMsv: { type: 'number', min: 0, max: 10000 }, timestamp: ts
    })
    atLeastOne(b, ['po2', 'pn2', 'pco2', 'doseMsv'])
    ctx.send(201, telemetry.recordEnvironment({ po2: b.po2, pn2: b.pn2, pco2: b.pco2, dose_msv: b.doseMsv, timestamp: checkTimestamp(b.timestamp) },
      ctx.user.role === 'device' ? 'device' : 'manual'))
  })

  router.post('/api/telemetry/thermal', requireIngest, (ctx) => {
    const b = validate(ctx.body, {
      zone: { type: 'string', required: true, maxLength: 60 },
      tempC: { type: 'number', required: true, min: -100, max: 150 }, timestamp: ts
    })
    ctx.send(201, telemetry.recordThermal(b.zone, b.tempC, ctx.user.role === 'device' ? 'device' : 'manual', checkTimestamp(b.timestamp)))
  })

  // ---------- reads ----------
  router.get('/api/environment/latest', requireRead(), () => ({ environment: telemetry.latestEnvironment() }))
  router.get('/api/environment', requireRead(), (ctx) => ({ items: telemetry.environmentHistory(historyQuery(ctx)) }))
  router.get('/api/thermal', requireRead(), () => telemetry.thermalSnapshot())
  router.get('/api/thermal/:zone/history', requireRead(), (ctx) => ({ items: telemetry.thermalHistory(ctx.params.zone, historyQuery(ctx)) }))
  router.get('/api/thermal/zones', requireRead(), () => ({ items: telemetry.zones().map(z => ({ slug: z.slug, name: z.name, setpointC: z.setpoint_c })) }))
}
