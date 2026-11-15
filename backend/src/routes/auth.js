import { requireAuth, requireRole, audit, ROLES } from '../auth/middleware.js'
import { signToken } from '../auth/jwt.js'
import { hashPassword, verifyPassword, DUMMY_HASH, checkPasswordStrength } from '../auth/passwords.js'
import { validate, EMAIL_RE } from '../http/validate.js'
import { HttpError, notFound, conflict } from '../http/errors.js'

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active })

export function authRoutes(router, { db, config, loginLimiter }) {
  router.post('/api/auth/login', async (ctx) => {
    const body = validate(ctx.body, {
      email: { type: 'string', required: true, maxLength: 254 },
      password: { type: 'string', required: true, maxLength: 200 }
    })
    const key = `${ctx.ip}:${body.email.toLowerCase()}`
    const rl = loginLimiter.check(key)
    if (!rl.allowed) {
      ctx.res.setHeader('Retry-After', String(rl.retryAfter))
      throw new HttpError(429, 'Too many login attempts. Try again later.')
    }
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email)
    const ok = verifyPassword(body.password, user ? user.password_hash : DUMMY_HASH)
    if (!user || !ok || !user.active) {
      ctx.user = { id: user?.id ?? null, email: body.email }
      audit(ctx, 'login_failed', 'user')
      throw new HttpError(401, 'Invalid email or password')
    }
    db.prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(user.id)
    ctx.user = user
    audit(ctx, 'login', 'user')
    const token = signToken({ sub: user.id, role: user.role }, config.jwtSecret, config.tokenTtlSeconds)
    return { token, tokenType: 'Bearer', expiresIn: config.tokenTtlSeconds, user: publicUser(user) }
  })

  router.get('/api/auth/me', requireAuth(), (ctx) => ({ user: publicUser(ctx.user) }))

  router.post('/api/auth/change-password', requireAuth(), (ctx) => {
    const body = validate(ctx.body, {
      currentPassword: { type: 'string', required: true, maxLength: 200 },
      newPassword: { type: 'string', required: true, maxLength: 200 }
    })
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ctx.user.id)
    if (!verifyPassword(body.currentPassword, row.password_hash)) throw new HttpError(401, 'Current password is incorrect')
    const weak = checkPasswordStrength(body.newPassword)
    if (weak) throw new HttpError(422, 'Validation failed', { newPassword: weak })
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.newPassword), ctx.user.id)
    audit(ctx, 'password_changed', 'user', { id: ctx.user.id })
    return { ok: true }
  })

  // ---------- user administration ----------
  router.get('/api/users', requireRole('admin'), () => ({
    items: db.prepare('SELECT id,email,name,role,active,created_at,last_login_at FROM users ORDER BY id').all()
      .map(u => ({ ...publicUser(u), createdAt: u.created_at, lastLoginAt: u.last_login_at }))
  }))

  router.post('/api/users', requireRole('admin'), (ctx) => {
    const b = validate(ctx.body, {
      email: { type: 'string', required: true, maxLength: 254, pattern: EMAIL_RE, patternMessage: 'must be a valid email' },
      name: { type: 'string', required: true, minLength: 2, maxLength: 100 },
      password: { type: 'string', required: true, maxLength: 200 },
      role: { type: 'string', required: true, enum: ROLES }
    })
    const weak = checkPasswordStrength(b.password)
    if (weak) throw new HttpError(422, 'Validation failed', { password: weak })
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(b.email)) throw conflict('A user with this email already exists')
    const info = db.prepare('INSERT INTO users (email,name,password_hash,role) VALUES (?,?,?,?)').run(b.email, b.name, hashPassword(b.password), b.role)
    audit(ctx, 'user_created', 'user', { id: Number(info.lastInsertRowid), role: b.role })
    ctx.send(201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid))) })
  })

  router.patch('/api/users/:id', requireRole('admin'), (ctx) => {
    const id = Number(ctx.params.id)
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    if (!u) throw notFound('User not found')
    const b = validate(ctx.body, {
      name: { type: 'string', minLength: 2, maxLength: 100 },
      role: { type: 'string', enum: ROLES },
      active: { type: 'boolean' },
      password: { type: 'string', maxLength: 200 }
    })
    if (id === ctx.user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw conflict('You cannot deactivate or demote your own account')
    if (b.password) {
      const weak = checkPasswordStrength(b.password)
      if (weak) throw new HttpError(422, 'Validation failed', { password: weak })
    }
    db.prepare('UPDATE users SET name=?, role=?, active=?, password_hash=? WHERE id=?').run(
      b.name ?? u.name, b.role ?? u.role, b.active === undefined ? u.active : (b.active ? 1 : 0),
      b.password ? hashPassword(b.password) : u.password_hash, id)
    audit(ctx, 'user_updated', 'user', { id, fields: Object.keys(b).filter(k => k !== 'password') })
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) }
  })
}
