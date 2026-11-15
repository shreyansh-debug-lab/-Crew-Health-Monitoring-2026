import crypto from 'node:crypto'

const N = 16384, R = 8, P = 1, KEYLEN = 64

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, salt, hash] = stored.split('$')
    if (scheme !== 'scrypt') return false
    const expected = Buffer.from(hash, 'base64')
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: R, p: P })
    return crypto.timingSafeEqual(actual, expected)
  } catch { return false }
}

// Used to keep login timing similar when the user does not exist
export const DUMMY_HASH = hashPassword('dummy-password-for-timing')

export function checkPasswordStrength(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Password must be at least 10 characters'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Password must include upper-case, lower-case and a number'
  return null
}
