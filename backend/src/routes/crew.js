import { requireRead, requireRole, audit } from '../auth/middleware.js'
import { validate } from '../http/validate.js'
import { notFound, conflict } from '../http/errors.js'
import { computeRisk } from '../services/risk.js'

const shape = (c) => ({ id: c.id, code: c.code, name: c.name, missionRole: c.mission_role, shiftHours: c.shift_hours, active: !!c.active })

export const historyQuery = (ctx) => validate(ctx.query, {
  from: { type: 'string', maxLength: 40 }, to: { type: 'string', maxLength: 40 },
  limit: { type: 'integer', min: 1, max: 2000, default: 200 }
})

export function crewRoutes(router, { db, telemetry }) {
  const crewId = (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id)) throw notFound('Crew member not found')
    return telemetry.crewById(id).id
  }

  router.get('/api/crew', requireRead(), () => ({ items: db.prepare('SELECT * FROM crew_members ORDER BY id').all().map(shape) }))
  router.get('/api/crew/:id', requireRead(), (ctx) => ({ crew: shape(telemetry.crewById(crewId(ctx))) }))

  router.post('/api/crew', requireRole('admin', 'flight_surgeon'), (ctx) => {
    const b = validate(ctx.body, {
      code: { type: 'string', required: true, maxLength: 12, pattern: /^[A-Za-z0-9_-]+$/, patternMessage: 'letters, numbers, - and _ only' },
      name: { type: 'string', required: true, minLength: 2, maxLength: 100 },
      missionRole: { type: 'string', maxLength: 60, default: 'Crew' },
      shiftHours: { type: 'number', min: 0, max: 48, default: 0 }
    })
    if (db.prepare('SELECT 1 FROM crew_members WHERE code = ?').get(b.code)) throw conflict('Crew code already exists')
    const info = db.prepare('INSERT INTO crew_members (code,name,mission_role,shift_hours) VALUES (?,?,?,?)').run(b.code, b.name, b.missionRole, b.shiftHours)
    audit(ctx, 'crew_created', 'crew', { code: b.code })
    ctx.send(201, { crew: shape(telemetry.crewById(Number(info.lastInsertRowid))) })
  })

  router.patch('/api/crew/:id', requireRole('admin', 'flight_surgeon'), (ctx) => {
    const c = telemetry.crewById(crewId(ctx))
    const b = validate(ctx.body, {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      missionRole: { type: 'string', maxLength: 60 },
      shiftHours: { type: 'number', min: 0, max: 48 },
      active: { type: 'boolean' }
    })
    db.prepare('UPDATE crew_members SET name=?, mission_role=?, shift_hours=?, active=? WHERE id=?')
      .run(b.name ?? c.name, b.missionRole ?? c.mission_role, b.shiftHours ?? c.shift_hours, b.active === undefined ? c.active : (b.active ? 1 : 0), c.id)
    audit(ctx, 'crew_updated', 'crew', { id: c.id })
    return { crew: shape(telemetry.crewById(c.id)) }
  })

  router.get('/api/crew/:id/biometrics/latest', requireRead(), (ctx) => ({ biometrics: telemetry.latestBiometrics(crewId(ctx)) }))
  router.get('/api/crew/:id/biometrics', requireRead(), (ctx) => ({ items: telemetry.biometricsHistory(crewId(ctx), historyQuery(ctx)) }))
  router.get('/api/crew/:id/suit/latest', requireRead(), (ctx) => ({ suit: telemetry.latestSuit(crewId(ctx)) }))
  router.get('/api/crew/:id/suit', requireRead(), (ctx) => ({ items: telemetry.suitHistory(crewId(ctx), historyQuery(ctx)) }))

  router.get('/api/crew/:id/risk', requireRead(), (ctx) => {
    const crew = telemetry.crewById(crewId(ctx))
    return {
      crewId: crew.id, crewCode: crew.code, generatedAt: new Date().toISOString(),
      ...computeRisk({ bio: telemetry.latestBiometricsRow(crew.id), suit: telemetry.latestSuitRow(crew.id), env: telemetry.latestEnvironmentRow(), crew })
    }
  })
}
