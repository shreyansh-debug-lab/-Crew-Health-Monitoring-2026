import { HttpError } from './errors.js'

// schema: { field: { type:'number'|'string'|'boolean'|'integer', required, min, max, enum, maxLength, minLength, pattern } }
export function validate(input, schema) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const out = {}
  const errors = {}
  for (const [key, rule] of Object.entries(schema)) {
    let v = src[key]
    if (v === undefined || v === null || v === '') {
      if (rule.required) errors[key] = 'is required'
      else if (rule.default !== undefined) out[key] = rule.default
      continue
    }
    switch (rule.type) {
      case 'number':
      case 'integer': {
        if (typeof v === 'string' && v.trim() !== '') v = Number(v)
        if (typeof v !== 'number' || !Number.isFinite(v)) { errors[key] = 'must be a number'; continue }
        if (rule.type === 'integer' && !Number.isInteger(v)) { errors[key] = 'must be an integer'; continue }
        if (rule.min !== undefined && v < rule.min) { errors[key] = `must be >= ${rule.min}`; continue }
        if (rule.max !== undefined && v > rule.max) { errors[key] = `must be <= ${rule.max}`; continue }
        break
      }
      case 'boolean':
        if (typeof v === 'string') v = ['true', '1'].includes(v) ? true : ['false', '0'].includes(v) ? false : v
        if (typeof v !== 'boolean') { errors[key] = 'must be a boolean'; continue }
        break
      default: {
        if (typeof v !== 'string') { errors[key] = 'must be a string'; continue }
        v = v.trim()
        if (rule.minLength && v.length < rule.minLength) { errors[key] = `must be at least ${rule.minLength} characters`; continue }
        if (rule.maxLength && v.length > rule.maxLength) { errors[key] = `must be at most ${rule.maxLength} characters`; continue }
        if (rule.pattern && !rule.pattern.test(v)) { errors[key] = rule.patternMessage || 'has an invalid format'; continue }
      }
    }
    if (rule.enum && !rule.enum.includes(v)) { errors[key] = `must be one of: ${rule.enum.join(', ')}`; continue }
    out[key] = v
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'Validation failed', errors)
  return out
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
