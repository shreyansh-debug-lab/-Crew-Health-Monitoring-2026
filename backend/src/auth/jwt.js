import crypto from 'node:crypto'

const b64u = (b) => Buffer.from(b).toString('base64url')

export function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64u(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }))
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, b, s] = parts
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest()
  const given = Buffer.from(s, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    if (JSON.parse(Buffer.from(h, 'base64url')).alg !== 'HS256') return null
    const payload = JSON.parse(Buffer.from(b, 'base64url'))
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}
