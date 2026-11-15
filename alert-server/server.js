import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'

const env = process.env
const { DEFAULT_COUNTRY_CODE = '+91', ALLOWED_ORIGIN, PORT = 8787 } = env
const SMS_DRIVER = (env.SMS_DRIVER || 'log').toLowerCase() // off | log | android | modem | twilio
const SECRET = env.OTP_SECRET || crypto.randomBytes(16).toString('hex')

const app = express()
app.use(cors({ origin: ALLOWED_ORIGIN ? ALLOWED_ORIGIN.split(',') : true }))
app.use(express.json({ limit: '10kb' }))

const toE164 = raw => {
  const d = String(raw || '').replace(/[^\d+]/g, '')
  if (!d) return ''
  if (d.startsWith('+')) return d
  return d.length === 10 ? `${DEFAULT_COUNTRY_CODE}${d}` : `+${d}`
}
const validPhone = p => /^\+\d{8,15}$/.test(p)
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || '')

const hits = new Map()
const limited = (ip, key, max) => {
  const k = `${key}:${ip}`, now = Date.now(), list = (hits.get(k) || []).filter(t => now - t < 60000)
  list.push(now); hits.set(k, list)
  return list.length > max
}

/* ---------- SMS drivers ---------- */
// "modem": your own SIM card in a USB GSM modem — the SMS leaves through your SIM's mobile plan, no online service involved.
let modemPort = null, modemQueue = Promise.resolve()
const asciiChunks = text => {
  const clean = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E\n]/g, '?')
  return clean.match(/[\s\S]{1,150}/g) || []
}
const atSend = (p, data, expect, ms = 10000) => new Promise((resolve, reject) => {
  let buf = ''
  const done = fn => v => { clearTimeout(t); p.off('data', on); fn(v) }
  const t = setTimeout(done(reject), ms, new Error('Modem timeout'))
  const on = d => {
    buf += d.toString()
    if (buf.includes(expect)) done(resolve)(buf)
    else if (/ERROR/.test(buf)) done(reject)(new Error(`Modem error: ${buf.trim()}`))
  }
  p.on('data', on); p.write(data)
})
async function modemSendNow(to, body) {
  if (!modemPort) {
    const { SerialPort } = await import('serialport')
    modemPort = new SerialPort({ path: env.MODEM_PORT, baudRate: Number(env.MODEM_BAUD) || 115200 })
  }
  await atSend(modemPort, 'AT\r', 'OK')
  await atSend(modemPort, 'AT+CMGF=1\r', 'OK')
  for (const part of asciiChunks(body)) {
    await atSend(modemPort, `AT+CMGS="${to}"\r`, '>')
    await atSend(modemPort, `${part}\x1A`, '+CMGS', 30000)
  }
}
const modemSend = (to, body) => {
  const run = modemQueue.then(() => modemSendNow(to, body))
  modemQueue = run.catch(() => {})
  return run
}

// "android": your own Android phone + SIM acts as the SMS sender (open-source "SMS Gateway for Android", Local Server mode).
// The text leaves through your SIM's mobile plan; no online SMS service is involved.
async function androidSend(to, text) {
  const url = `${(env.ANDROID_GW_URL || '').replace(/\/$/, '')}/message`
  if (!env.ANDROID_GW_URL) throw new Error('ANDROID_GW_URL is not set in .env')
  const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${env.ANDROID_GW_USER}:${env.ANDROID_GW_PASS}`).toString('base64')}` }
  const call = payload => fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) })
  let r
  try {
    r = await call({ textMessage: { text }, phoneNumbers: [to] })
    if (r.status === 400 || r.status === 422) r = await call({ message: text, phoneNumbers: [to] }) // older app versions
  } catch { throw new Error('Cannot reach the phone — same Wi-Fi? app running? check ANDROID_GW_URL') }
  if (r.status === 401) throw new Error('Phone rejected the username/password')
  if (!r.ok) throw new Error(`Phone gateway replied ${r.status}`)
}

async function sendSms(to, body) {
  if (SMS_DRIVER === 'off') return { ok: false, error: 'SMS sending is turned off on this server — choose Email.' }
  try {
    if (SMS_DRIVER === 'log') console.log(`\n[SMS · DEV MODE, not really sent] to ${to}:\n${body}\n`)
    else if (SMS_DRIVER === 'modem') await modemSend(to, body)
    else if (SMS_DRIVER === 'android') await androidSend(to, body)
    else if (SMS_DRIVER === 'twilio') {
      const { default: twilio } = await import('twilio')
      await twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).messages.create({ to, from: env.TWILIO_FROM, body })
    } else throw new Error(`Unknown SMS_DRIVER "${SMS_DRIVER}"`)
    return { ok: true }
  } catch (e) { console.error(`SMS to ${to} failed:`, e.message); return { ok: false, error: e.message } }
}

async function sendEmail(to, subject, text) {
  if (!env.SMTP_HOST) { console.log(`\n[EMAIL · DEV MODE, not really sent] to ${to}: ${subject}\n${text}\n`); return { dev: true } }
  const nodemailer = (await import('nodemailer')).default
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port: Number(env.SMTP_PORT) || 587, secure: env.SMTP_SECURE === 'true',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  })
  await transport.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, to, subject, text })
  return { dev: false }
}

/* ---------- Verification codes (OTP) ---------- */
const otps = new Map() // id -> { channel, to, hash, exp, tries }
const lastSent = new Map()
const hashCode = (id, code) => crypto.createHmac('sha256', SECRET).update(`${id}:${code}`).digest('hex')

app.post('/api/otp/send', async (req, res) => {
  if (limited(req.ip, 'otp', 10)) return res.status(429).json({ error: 'Too many requests, wait a minute.' })
  const channel = req.body?.channel
  const to = channel === 'email' ? String(req.body?.to || '').trim().toLowerCase() : toE164(req.body?.to)
  if (channel === 'email' ? !emailOk(to) : channel === 'sms' ? !validPhone(to) : true) return res.status(400).json({ error: 'Invalid verification target' })
  if (Date.now() - (lastSent.get(to) || 0) < 30000) return res.status(429).json({ error: 'Please wait 30 seconds before requesting another code.' })
  lastSent.set(to, Date.now())
  const code = String(crypto.randomInt(100000, 1000000)), id = crypto.randomUUID()
  otps.set(id, { to, hash: hashCode(id, code), exp: Date.now() + 10 * 60000, tries: 0 })
  const text = `Your Crew Health Monitoring verification code is ${code}. It expires in 10 minutes. Do not share it.`
  try {
    if (channel === 'email') await sendEmail(to, 'Your verification code', text)
    else { const r = await sendSms(to, text); if (!r.ok) throw new Error(r.error) }
    const dev = channel === 'email' ? !env.SMTP_HOST : SMS_DRIVER === 'log'
    res.json({ id, dev })
  } catch (e) { otps.delete(id); res.status(502).json({ error: `Could not send code: ${e.message}` }) }
})

app.post('/api/otp/verify', (req, res) => {
  if (limited(req.ip, 'verify', 20)) return res.status(429).json({ error: 'Too many attempts, wait a minute.' })
  const id = String(req.body?.id || ''), code = String(req.body?.code || '').trim(), rec = otps.get(id)
  if (!rec || rec.exp < Date.now()) { otps.delete(id); return res.status(400).json({ error: 'Code expired — request a new one.' }) }
  if (++rec.tries > 5) { otps.delete(id); return res.status(400).json({ error: 'Too many wrong tries — request a new code.' }) }
  const a = Buffer.from(hashCode(id, code)), b = Buffer.from(rec.hash)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: 'Incorrect code.' })
  otps.delete(id)
  res.json({ ok: true })
})

/* ---------- Emergency alert: sends to every number given ---------- */
app.post('/api/alert', async (req, res) => {
  if (limited(req.ip, 'alert', 5)) return res.status(429).json({ error: 'Too many alerts, wait a minute.' })
  const raw = Array.isArray(req.body?.to) ? req.body.to : [req.body?.to]
  const phones = SMS_DRIVER === 'off' ? [] : [...new Set(raw.map(toE164).filter(Boolean))].slice(0, 5)
  const emails = [...new Set((Array.isArray(req.body?.emails) ? req.body.emails : []).map(e => String(e || '').trim().toLowerCase()).filter(emailOk))].slice(0, 5)
  const body = String(req.body?.message || '').slice(0, 600)
  if (!phones.length && !emails.length) return res.status(400).json({ error: 'No valid recipients' })
  if (!phones.every(validPhone)) return res.status(400).json({ error: 'Invalid phone number' })
  if (!body) return res.status(400).json({ error: 'Empty message' })
  const results = await Promise.all([
    ...phones.map(async to => ({ to, channel: 'sms', ...(await sendSms(to, body)) })),
    ...emails.map(async to => {
      try { const r = await sendEmail(to, 'EMERGENCY ALERT — Crew Health Monitoring', body); return { to, channel: 'email', ok: true, dev: !!r?.dev } }
      catch (e) { console.error(`Email to ${to} failed:`, e.message); return { to, channel: 'email', ok: false, error: e.message } }
    })
  ])
  res.json({ results })
})

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT} · SMS driver: ${SMS_DRIVER}${SMS_DRIVER === 'log' ? ' (DEV MODE — messages are printed here, not sent)' : ''}`))
