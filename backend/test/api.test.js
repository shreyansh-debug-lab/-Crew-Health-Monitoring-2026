import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'
import { createApp } from '../src/app.js'

let app, base
const tokens = {}

const call = async (method, path, { body, token, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers }
}
const login = async (email) => (await call('POST', '/api/auth/login', { body: { email, password: 'ChangeMe123!' } })).body.token

before(async () => {
  const config = loadConfig({ port: 0, dbPath: ':memory:', simulatorEnabled: false, logRequests: false, ingestApiKey: 'test-key', host: '127.0.0.1', alertCooldownSeconds: 0 })
  app = createApp(config)
  const addr = await app.start()
  base = `http://127.0.0.1:${addr.port}`
  for (const r of ['admin', 'surgeon', 'control', 'crew', 'observer']) tokens[r] = await login(`${r}@crewhealth.local`)
})
after(async () => { await app.stop() })

test('health is public', async () => {
  const r = await call('GET', '/api/health')
  assert.equal(r.status, 200)
  assert.equal(r.body.status, 'ok')
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
})

test('auth: rejects bad credentials and unauthenticated access', async () => {
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'admin@crewhealth.local', password: 'nope' } })).status, 401)
  assert.equal((await call('GET', '/api/overview')).status, 401)
  assert.equal((await call('GET', '/api/overview', { token: 'garbage' })).status, 401)
  const me = await call('GET', '/api/auth/me', { token: tokens.admin })
  assert.equal(me.body.user.role, 'admin')
})

test('login is rate limited', async () => {
  let last
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/auth/login', { body: { email: 'ratelimit@x.com', password: 'bad' } })
  assert.equal(last.status, 429)
})

test('validation errors return 422 with details', async () => {
  const r = await call('POST', '/api/telemetry/biometrics', { token: tokens.surgeon, body: { crewId: 1, heartRate: 'fast', spo2: 150 } })
  assert.equal(r.status, 422)
  assert.ok(r.body.error.details.heartRate)
  assert.ok(r.body.error.details.spo2)
  assert.equal((await call('POST', '/api/telemetry/biometrics', { token: tokens.surgeon, body: { crewId: 1 } })).status, 422)
})

test('nominal biometrics ingest (operator login) and latest read', async () => {
  const r = await call('POST', '/api/telemetry/biometrics', { token: tokens.surgeon, body: { crewId: 1, heartRate: 72, spo2: 98, coreTemp: 37.1, respRate: 16, bpSystolic: 118, bpDiastolic: 76 } })
  assert.equal(r.status, 201)
  assert.equal(r.body.evaluation.status, 'normal')
  assert.equal(r.body.incidents.length, 0)
  const latest = await call('GET', '/api/crew/1/biometrics/latest', { token: tokens.observer })
  assert.equal(latest.body.biometrics.heartRate, 72)
  assert.equal(latest.body.biometrics.bloodPressure.display, '118/76')
})

test('ingest via API key works, wrong key is rejected, observers cannot ingest', async () => {
  const ok = await call('POST', '/api/telemetry/environment', { headers: { 'X-API-Key': 'test-key' }, body: { po2: 21.2, pn2: 79.1, pco2: 0.04, doseMsv: 0.18 } })
  assert.equal(ok.status, 201)
  assert.equal((await call('POST', '/api/telemetry/environment', { headers: { 'X-API-Key': 'wrong' }, body: { po2: 21 } })).status, 401)
  assert.equal((await call('POST', '/api/telemetry/environment', { token: tokens.observer, body: { po2: 21 } })).status, 403)
})

test('critical reading creates incident, raises alarm, and blocks gate clearance', async () => {
  const r = await call('POST', '/api/telemetry/biometrics', { token: tokens.surgeon, body: { crewId: 1, heartRate: 150, spo2: 85, ecgStatus: 'irregular' } })
  assert.equal(r.body.evaluation.status, 'critical')
  assert.ok(r.body.incidents.some(i => i.level === 'CRITICAL'))
  const alarm = await call('GET', '/api/alarm', { token: tokens.observer })
  assert.equal(alarm.body.active, true)

  for (const key of ['crew_health_review', 'environmental_review', 'suit_telemetry_check', 'procedure_briefing'])
    assert.equal((await call('PUT', `/api/gate/items/${key}`, { token: tokens.crew, body: { checked: true } })).status, 200)
  const blocked = await call('POST', '/api/gate/clear', { token: tokens.control })
  assert.equal(blocked.status, 409)
  assert.ok(blocked.body.error.details.blockers.length > 0)

  // acknowledge all open critical incidents, silence alarm, then clear
  const open = await call('GET', '/api/incidents?acknowledged=false&limit=100', { token: tokens.control })
  for (const i of open.body.items) await call('POST', `/api/incidents/${i.id}/acknowledge`, { token: tokens.control })
  assert.equal((await call('POST', '/api/alarm/silence', { token: tokens.control })).body.active, false)
  const cleared = await call('POST', '/api/gate/clear', { token: tokens.control })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.body.cleared, true)
  assert.equal(cleared.body.status, 'GATE CLEARED')
})

test('gate: crew cannot clear; changing an item invalidates clearance', async () => {
  assert.equal((await call('POST', '/api/gate/clear', { token: tokens.crew })).status, 403)
  const r = await call('PUT', '/api/gate/items/suit_telemetry_check', { token: tokens.crew, body: { checked: false } })
  assert.equal(r.body.cleared, false)
  assert.equal(r.body.status, 'GATE HOLD')
  assert.equal((await call('PUT', '/api/gate/items/nonsense', { token: tokens.crew, body: { checked: true } })).status, 404)
})

test('incidents: manual create, filter, pagination', async () => {
  const c = await call('POST', '/api/incidents', { token: tokens.crew, body: { title: 'Manual note', detail: 'testing' } })
  assert.equal(c.status, 201)
  assert.equal(c.body.incident.level, 'MANUAL')
  const list = await call('GET', '/api/incidents?level=MANUAL&limit=1', { token: tokens.observer })
  assert.equal(list.body.items.length, 1)
  assert.ok(list.body.total >= 1)
  assert.equal((await call('POST', '/api/incidents', { token: tokens.observer, body: { title: 'nope' } })).status, 403)
})

test('suit, thermal and environment evaluation', async () => {
  const suit = await call('POST', '/api/telemetry/suit', { token: tokens.control, body: { crewId: 1, cabinPressure: 101.3, primaryO2: 98, secondaryO2: 100, co2Scrubber: 96, coolantTemp: 18.4, powerReserve: 87 } })
  assert.equal(suit.body.evaluation.status, 'normal')
  const th = await call('POST', '/api/telemetry/thermal', { token: tokens.control, body: { zone: 'aft_equipment_bay', tempC: 23.0 } })
  assert.equal(th.body.record.status, 'watch')
  await call('POST', '/api/telemetry/thermal', { token: tokens.control, body: { zone: 'habitat_core', tempC: 21.8 } })
  const snap = await call('GET', '/api/thermal', { token: tokens.observer })
  assert.equal(snap.body.zones.length, 4)
  assert.equal(snap.body.status, 'watch')
  assert.equal((await call('POST', '/api/telemetry/thermal', { token: tokens.control, body: { zone: 'bogus', tempC: 20 } })).status, 404)
})

test('risk models return the four dashboard models', async () => {
  const r = await call('GET', '/api/crew/1/risk', { token: tokens.observer })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.models.map(m => m.key), ['arrhythmia_probability', 'decompression_risk', 'workload_fatigue_index', 'metabolic_expenditure'])
})

test('overview aggregates dashboard data', async () => {
  const r = await call('GET', '/api/overview', { token: tokens.observer })
  assert.equal(r.status, 200)
  assert.ok(r.body.crew.length >= 1)
  assert.ok(r.body.gate.items.length === 4)
  assert.ok(Array.isArray(r.body.incidents.recent))
})

test('RBAC: user admin endpoints', async () => {
  assert.equal((await call('GET', '/api/users', { token: tokens.crew })).status, 403)
  const created = await call('POST', '/api/users', { token: tokens.admin, body: { email: 'new@crewhealth.local', name: 'New User', password: 'Str0ngPassword!', role: 'observer' } })
  assert.equal(created.status, 201)
  assert.equal((await call('POST', '/api/users', { token: tokens.admin, body: { email: 'weak@crewhealth.local', name: 'Weak', password: 'short', role: 'crew' } })).status, 422)
  assert.equal((await call('POST', '/api/users', { token: tokens.admin, body: { email: 'new@crewhealth.local', name: 'Dup', password: 'Str0ngPassword!', role: 'crew' } })).status, 409)
  const audit = await call('GET', '/api/audit', { token: tokens.admin })
  assert.ok(audit.body.items.length > 0)
})

test('support contact flags placeholder until configured', async () => {
  const before = await call('GET', '/api/support-contact', { token: tokens.observer })
  assert.equal(before.body.isPlaceholder, true)
  const upd = await call('PUT', '/api/support-contact', { token: tokens.admin, body: { label: 'Ops desk', phone: '+14155550123', message: 'Need help' } })
  assert.equal(upd.body.isPlaceholder, false)
  assert.ok(upd.body.smsUri.startsWith('sms:+14155550123'))
})

test('SSE stream delivers live events', async () => {
  const ctrl = new AbortController()
  const res = await fetch(`${base}/api/stream?token=${tokens.observer}`, { signal: ctrl.signal })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  await call('POST', '/api/telemetry/environment', { token: tokens.control, body: { po2: 21.1 } })
  let buf = ''
  const deadline = Date.now() + 3000
  while (!buf.includes('event: environment') && Date.now() < deadline) buf += dec.decode((await reader.read()).value)
  ctrl.abort()
  assert.ok(buf.includes('event: hello'))
  assert.ok(buf.includes('event: environment'))
})

test('unknown routes and wrong methods', async () => {
  assert.equal((await call('GET', '/api/nope', { token: tokens.admin })).status, 404)
  assert.equal((await call('DELETE', '/api/overview', { token: tokens.admin })).status, 405)
  const bad = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
  assert.equal(bad.status, 400)
})

test('AUTH_REQUIRED=false allows read-only anonymous access', async () => {
  const open = createApp(loadConfig({ port: 0, dbPath: ':memory:', simulatorEnabled: true, logRequests: false, host: '127.0.0.1', authRequired: false }))
  const a = await open.start()
  const get = await fetch(`http://127.0.0.1:${a.port}/api/overview`)
  assert.equal(get.status, 200)
  const body = await get.json()
  assert.equal(body.mode, 'LOCAL SIMULATION')
  assert.ok(body.crew[0].biometrics, 'simulator should have produced data')
  const post = await fetch(`http://127.0.0.1:${a.port}/api/alarm/activate`, { method: 'POST' })
  assert.equal(post.status, 401)
  await open.stop()
})
