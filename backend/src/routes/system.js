import { requireRead, requireRole } from '../auth/middleware.js'
import { validate } from '../http/validate.js'
import { SCENARIOS } from '../services/simulator.js'
import { computeRisk } from '../services/risk.js'
import { RULES } from '../services/thresholds.js'
import { HttpError } from '../http/errors.js'

// Reference data shown in the dashboard's "NASA Human-System Standards" panel.
const STANDARDS = [
  { title: 'NASA-STD-3001, Volume 1', subtitle: 'Crew Health', description: 'Human health and medical considerations for human spaceflight.', url: 'https://standards.nasa.gov/standard/nasa/nasa-std-3001-vol-1' },
  { title: 'NASA-STD-3001, Volume 2', subtitle: 'Human Factors, Habitability and Environmental Health', description: 'Design considerations for human-system integration and habitability.', url: 'https://standards.nasa.gov/standard/nasa/nasa-std-3001-vol-2' }
]
const DISCLAIMER = 'This system is an independent demonstration and is not NASA-approved, does not establish compliance, and is not a substitute for current standards or mission procedures.'

export function systemRoutes(router, { db, hub, config, telemetry, gate, alarm, incidents, simulator }) {
  router.get('/api/health', () => ({
    status: 'ok', time: new Date().toISOString(), uptimeSeconds: Math.round(process.uptime()),
    simulator: simulator.running, streamClients: hub.size
  }))

  router.get('/api/standards', requireRead(), () => ({ items: STANDARDS, disclaimer: DISCLAIMER }))

  router.get('/api/thresholds', requireRead(), () => ({
    note: 'Illustrative demonstration ranges, not clinical limits.',
    rules: JSON.parse(JSON.stringify(RULES, (_, v) => (v === Infinity ? null : v === -Infinity ? null : v)))
  }))

  // One call that returns everything the dashboard renders.
  router.get('/api/overview', requireRead(), (ctx) => {
    const crew = db.prepare('SELECT * FROM crew_members WHERE active = 1 ORDER BY id').all()
    const env = telemetry.latestEnvironment()
    const thermal = telemetry.thermalSnapshot()
    const crewData = crew.map(c => ({
      id: c.id, code: c.code, name: c.name, missionRole: c.mission_role,
      biometrics: telemetry.latestBiometrics(c.id),
      suit: telemetry.latestSuit(c.id),
      risk: computeRisk({ bio: telemetry.latestBiometricsRow(c.id), suit: telemetry.latestSuitRow(c.id), env: telemetry.latestEnvironmentRow(), crew: c }).models
    }))
    return {
      generatedAt: new Date().toISOString(),
      mode: simulator.running ? 'LOCAL SIMULATION' : 'LIVE INGEST',
      user: { name: ctx.user.name, role: ctx.user.role },
      crew: crewData, environment: env, thermal,
      gate: gate.snapshot(), alarm: alarm.get(),
      incidents: { ...incidents.counts(), recent: incidents.list({ limit: 5 }).items },
      disclaimer: DISCLAIMER
    }
  })

  // Live updates (Server-Sent Events). EventSource cannot send headers, so the JWT may be passed as ?token=
  router.get('/api/stream', requireRead({ allowQueryToken: true }), (ctx) => {
    const { res } = ctx
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
    })
    res.write('retry: 3000\n\n')
    hub.send(res, 'hello', { user: ctx.user.name, time: new Date().toISOString() })
    hub.add(res)
    ctx.sent = true
  })

  // ---------- audit trail ----------
  router.get('/api/audit', requireRole('admin', 'flight_surgeon'), (ctx) => {
    const q = validate(ctx.query, { limit: { type: 'integer', min: 1, max: 500, default: 100 }, offset: { type: 'integer', min: 0, default: 0 } })
    return { items: db.prepare('SELECT id,ts,user_id AS userId,user_email AS userEmail,action,entity,detail,ip FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?').all(q.limit, q.offset)
      .map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null })) }
  })

  // ---------- simulator controls (demo / drills) ----------
  router.get('/api/simulator', requireRole('admin', 'flight_surgeon', 'mission_control'), () => ({
    running: simulator.running, intervalMs: config.simIntervalMs, active: simulator.activeScenarios(), scenarios: SCENARIOS
  }))
  router.post('/api/simulator/scenario', requireRole('admin', 'flight_surgeon', 'mission_control'), (ctx) => {
    if (!simulator.running) throw new HttpError(409, 'Simulator is disabled (set SIMULATOR_ENABLED=true)')
    const b = validate(ctx.body, {
      name: { type: 'string', required: true, enum: Object.keys(SCENARIOS) },
      durationSeconds: { type: 'integer', min: 5, max: 600, default: 60 }
    })
    return simulator.trigger(b.name, b.durationSeconds)
  })
}
