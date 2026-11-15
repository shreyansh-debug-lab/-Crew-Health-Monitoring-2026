import http from 'node:http'
import crypto from 'node:crypto'
import { openDb } from './db.js'
import { Router } from './http/router.js'
import { HttpError } from './http/errors.js'
import { createLimiter } from './http/rateLimit.js'
import { createHub } from './services/sse.js'
import { createIncidentService } from './services/incidents.js'
import { createAlarmService } from './services/alarm.js'
import { createAlertService } from './services/alerts.js'
import { createGateService } from './services/gate.js'
import { createTelemetryService } from './services/telemetry.js'
import { createSimulator } from './services/simulator.js'
import { authRoutes } from './routes/auth.js'
import { crewRoutes } from './routes/crew.js'
import { telemetryRoutes } from './routes/telemetry.js'
import { operationsRoutes } from './routes/operations.js'
import { systemRoutes } from './routes/system.js'

const MAX_BODY = 1024 * 1024

export function createApp(config) {
  const db = openDb(config)
  const hub = createHub()
  const incidents = createIncidentService({ db, hub })
  const alarm = createAlarmService({ db, hub, incidents })
  const alerts = createAlertService({ incidents, alarm, config })
  const gate = createGateService({ db, hub, incidents, config })
  const telemetry = createTelemetryService({ db, hub, alerts })
  const simulator = createSimulator({
    config, telemetry,
    crewList: () => db.prepare('SELECT * FROM crew_members WHERE active = 1 ORDER BY id').all()
  })

  const loginLimiter = createLimiter({ windowMs: 15 * 60_000, max: config.loginAttemptsPer15Min ?? 10 })
  const services = { db, hub, incidents, alarm, alerts, gate, telemetry, simulator, config, loginLimiter }
  const router = new Router()
  for (const register of [authRoutes, crewRoutes, telemetryRoutes, operationsRoutes, systemRoutes]) register(router, services)

  const globalLimiter = createLimiter({ windowMs: 60_000, max: config.rateLimitPerMinute ?? 600 })

  const allowedOrigin = (origin) => origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))

  async function readBody(req) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return undefined
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_BODY) throw new HttpError(413, 'Request body too large')
      chunks.push(chunk)
    }
    if (!size) return {}
    const type = req.headers['content-type'] || ''
    if (!type.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json')
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'Invalid JSON body') }
  }

  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint()
    const requestId = crypto.randomUUID()
    const url = new URL(req.url, 'http://localhost')
    const origin = req.headers.origin

    const baseHeaders = {
      'X-Request-Id': requestId,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
    }
    if (allowedOrigin(origin)) {
      Object.assign(baseHeaders, {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin'
      })
    }
    for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v)

    const ctx = {
      req, res, db, config, services,
      method: req.method, path: url.pathname.replace(/\/+$/, '') || '/',
      query: Object.fromEntries(url.searchParams), params: {}, body: undefined, user: null,
      ip: req.socket.remoteAddress || '', requestId, sent: false,
      send(status, data) {
        if (ctx.sent) return
        ctx.sent = true
        const payload = data === undefined ? '' : JSON.stringify(data)
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) })
        res.end(payload)
      }
    }

    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      const rl = globalLimiter.check(ctx.ip)
      res.setHeader('X-RateLimit-Remaining', String(rl.remaining))
      if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); throw new HttpError(429, 'Too many requests') }

      ctx.body = await readBody(req)
      await router.dispatch(ctx)
    } catch (err) {
      if (res.headersSent) { res.end(); return }
      if (err instanceof HttpError) {
        ctx.send(err.status, { error: { status: err.status, message: err.message, details: err.details, requestId } })
      } else {
        console.error(`[error] ${requestId}`, err)
        ctx.send(500, { error: { status: 500, message: 'Internal server error', requestId } })
      }
    } finally {
      if (config.logRequests !== false && !ctx.path.endsWith('/stream')) {
        const ms = Number(process.hrtime.bigint() - started) / 1e6
        console.log(`${new Date().toISOString()} ${req.method} ${ctx.path} ${res.statusCode} ${ms.toFixed(1)}ms ${requestId.slice(0, 8)}`)
      }
    }
  })

  let maintenance
  return {
    server, db, services, config,
    async start() {
      await new Promise(r => server.listen(config.port, config.host ?? '0.0.0.0', r))
      if (config.simulatorEnabled) simulator.start()
      maintenance = setInterval(() => {
        try { telemetry.prune(config.retentionHours) } catch (e) { console.error('[maintenance]', e.message) }
      }, 3600_000)
      maintenance.unref()
      return server.address()
    },
    async stop() {
      simulator.stop()
      clearInterval(maintenance)
      hub.closeAll()
      await new Promise(r => server.close(r))
      try { db.close() } catch { /* already closed */ }
    }
  }
}
