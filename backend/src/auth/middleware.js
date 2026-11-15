import crypto from 'node:crypto'
import { verifyToken } from './jwt.js'
import { forbidden, unauthorized } from '../http/errors.js'

export const ROLES = ['admin', 'flight_surgeon', 'mission_control', 'crew', 'observer']

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// Resolves a user from a Bearer token (or ?token= for SSE where headers can't be set).
export function authenticate(ctx, { allowQueryToken = false } = {}) {
  const header = ctx.req.headers.authorization || ''
  let token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token && allowQueryToken) token = ctx.query.token || null
  if (!token) return null
  const payload = verifyToken(token, ctx.config.jwtSecret)
  if (!payload) return null
  const user = ctx.db.prepare('SELECT id,email,name,role,active FROM users WHERE id = ?').get(payload.sub)
  if (!user || !user.active) return null
  return user
}

// Read access: logged-in user, or anonymous "observer" when AUTH_REQUIRED=false.
export const requireRead = (opts) => (ctx) => {
  const user = authenticate(ctx, opts)
  if (user) { ctx.user = user; return }
  if (ctx.config.authRequired) throw unauthorized()
  ctx.user = { id: null, email: 'anonymous', name: 'Anonymous', role: 'observer', anonymous: true }
}

export const requireAuth = (opts) => (ctx) => {
  const user = authenticate(ctx, opts)
  if (!user) throw unauthorized()
  ctx.user = user
}

export const requireRole = (...roles) => (ctx) => {
  requireAuth()(ctx)
  if (!roles.includes(ctx.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`)
}

// Telemetry ingestion: either a valid X-API-Key (devices/gateways) or a logged-in operator.
export const requireIngest = (ctx) => {
  const key = ctx.req.headers['x-api-key']
  if (key && ctx.config.ingestApiKey && safeEqual(key, ctx.config.ingestApiKey)) {
    ctx.user = { id: null, email: 'ingest-key', name: 'Ingest gateway', role: 'device' }
    return
  }
  requireRole('admin', 'flight_surgeon', 'mission_control')(ctx)
}

export function audit(ctx, action, entity, detail) {
  ctx.db.prepare('INSERT INTO audit_log (user_id,user_email,action,entity,detail,ip) VALUES (?,?,?,?,?,?)')
    .run(ctx.user?.id ?? null, ctx.user?.email ?? null, action, entity ?? null, detail ? JSON.stringify(detail) : null, ctx.ip)
}
