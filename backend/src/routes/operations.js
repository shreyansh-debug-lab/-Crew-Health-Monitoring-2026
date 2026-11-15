import { requireRead, requireRole, audit } from '../auth/middleware.js'
import { validate } from '../http/validate.js'
import { notFound } from '../http/errors.js'

const OPERATORS = ['admin', 'flight_surgeon', 'mission_control', 'crew']
const SUPERVISORS = ['admin', 'flight_surgeon', 'mission_control']

export function operationsRoutes(router, { db, gate, alarm, incidents }) {
  // ---------- readiness gate ("Mission Authorization") ----------
  router.get('/api/gate', requireRead(), () => gate.snapshot())

  router.put('/api/gate/items/:key', requireRole(...OPERATORS), (ctx) => {
    const b = validate(ctx.body, { checked: { type: 'boolean', required: true } })
    const out = gate.setItem(ctx.params.key, b.checked, ctx.user)
    audit(ctx, 'gate_item', 'gate', { key: ctx.params.key, checked: b.checked })
    return out
  })

  router.post('/api/gate/clear', requireRole(...SUPERVISORS), (ctx) => {
    const out = gate.clear(ctx.user)
    audit(ctx, 'gate_cleared', 'gate')
    return out
  })

  router.post('/api/gate/reset', requireRole(...SUPERVISORS), (ctx) => {
    const out = gate.reset(ctx.user)
    audit(ctx, 'gate_reset', 'gate')
    return out
  })

  // ---------- alarm (header "Alert" button) ----------
  router.get('/api/alarm', requireRead(), () => alarm.get())

  router.post('/api/alarm/activate', requireRole(...OPERATORS), (ctx) => {
    const b = validate(ctx.body, { reason: { type: 'string', maxLength: 300, default: 'Manual alert raised from dashboard' } })
    const out = alarm.activate({ reason: b.reason, by: ctx.user.name, userId: ctx.user.id })
    audit(ctx, 'alarm_activated', 'alarm', { reason: b.reason })
    return out
  })

  router.post('/api/alarm/silence', requireRole(...SUPERVISORS, 'crew'), (ctx) => {
    const out = alarm.silence({ by: ctx.user.name, userId: ctx.user.id })
    audit(ctx, 'alarm_silenced', 'alarm')
    return out
  })

  // ---------- incident log ----------
  router.get('/api/incidents', requireRead(), (ctx) => {
    const q = validate(ctx.query, {
      level: { type: 'string', enum: ['INFO', 'WATCH', 'CRITICAL', 'MANUAL', 'ALARM'] },
      acknowledged: { type: 'boolean' },
      crewId: { type: 'integer', min: 1 },
      limit: { type: 'integer', min: 1, max: 500, default: 50 },
      offset: { type: 'integer', min: 0, default: 0 }
    })
    return incidents.list(q)
  })

  router.get('/api/incidents/:id', requireRead(), (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id)) throw notFound('Incident not found')
    return { incident: incidents.get(id) }
  })

  router.post('/api/incidents', requireRole(...OPERATORS), (ctx) => {
    const b = validate(ctx.body, {
      title: { type: 'string', required: true, minLength: 3, maxLength: 160 },
      detail: { type: 'string', maxLength: 2000, default: '' },
      level: { type: 'string', enum: ['INFO', 'WATCH', 'CRITICAL', 'MANUAL'], default: 'MANUAL' },
      crewId: { type: 'integer', min: 1 }
    })
    if (b.crewId && !db.prepare('SELECT 1 FROM crew_members WHERE id = ?').get(b.crewId)) throw notFound('Crew member not found')
    const incident = incidents.create({ ...b, crewId: b.crewId ?? null, source: 'operator', userId: ctx.user.id })
    audit(ctx, 'incident_created', 'incident', { id: incident.id })
    ctx.send(201, { incident })
  })

  router.post('/api/incidents/:id/acknowledge', requireRole(...OPERATORS), (ctx) => {
    const id = Number(ctx.params.id)
    if (!Number.isInteger(id)) throw notFound('Incident not found')
    const incident = incidents.acknowledge(id, ctx.user.id)
    audit(ctx, 'incident_acknowledged', 'incident', { id })
    return { incident }
  })

  // ---------- support contact (powers the "Prepare SMS" links) ----------
  const readContact = () => {
    const c = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'support_contact'").get().value)
    return { ...c, smsUri: `sms:${c.phone}?body=${encodeURIComponent(c.message)}`, isPlaceholder: /^\+?1?0{7,}$/.test(String(c.phone).replace(/\D/g, '')) || c.phone === '+10000000000' }
  }
  router.get('/api/support-contact', requireRead(), () => readContact())
  router.put('/api/support-contact', requireRole('admin'), (ctx) => {
    const b = validate(ctx.body, {
      label: { type: 'string', required: true, maxLength: 100 },
      phone: { type: 'string', required: true, pattern: /^\+?[0-9]{6,15}$/, patternMessage: 'must be 6-15 digits, optionally starting with +' },
      message: { type: 'string', required: true, maxLength: 300 }
    })
    db.prepare("INSERT INTO settings (key,value) VALUES ('support_contact',?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(b))
    audit(ctx, 'support_contact_updated', 'settings')
    return readContact()
  })
}
