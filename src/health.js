// Storage, validation, personalised health calculations and report builder.
const USERS = 'chm_users', SESSION = 'chm_session'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage blocked */ } }

export const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim())
export const phoneOk = p => { const d = p.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 }
export const cleanPhone = p => p.replace(/[^\d+]/g, '')
export const CONDITIONS = ['Hypertension', 'Diabetes', 'Asthma', 'Heart condition']

const users = () => read(USERS, {})
export const sessionUser = () => { const e = read(SESSION, null); return e ? users()[e] || null : null }
export const saveUser = u => { const all = users(); const k = u.email.trim().toLowerCase(); all[k] = { ...u, email: k }; write(USERS, all); write(SESSION, k); return all[k] }
export const endSession = () => { try { localStorage.removeItem(SESSION) } catch { /* ignore */ } }
export const userExists = email => !!users()[email.trim().toLowerCase()]
export const findUser = (email, phone) => {
  const u = users()[email.trim().toLowerCase()]
  return u && u.phone.replace(/\D/g, '') === phone.replace(/\D/g, '') ? u : null
}

export function validateProfile(f) {
  const e = {}
  if (f.name.trim().length < 2) e.name = 'Enter your full name'
  if (!emailOk(f.email)) e.email = 'Enter a valid email address'
  if (!phoneOk(f.phone)) e.phone = 'Enter a valid number incl. country code'
  if (!(+f.age >= 18 && +f.age <= 90)) e.age = 'Age 18–90'
  if (!(+f.height >= 120 && +f.height <= 220)) e.height = 'Height 120–220 cm'
  if (!(+f.weight >= 35 && +f.weight <= 200)) e.weight = 'Weight 35–200 kg'
  if (f.ecName.trim().length < 2) e.ecName = 'Enter a contact name'
  if (!phoneOk(f.ecPhone)) e.ecPhone = 'Enter a valid number incl. country code'
  if (!emailOk(f.ecEmail || '')) e.ecEmail = 'Enter a valid contact email'
  return e
}

const ACT = { sedentary: [1.2, 6], light: [1.375, 2], moderate: [1.55, -2], athlete: [1.9, -10] }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

// Illustrative estimates derived from the person's profile — NOT medical measurements.
export function analyze(u, t = 0) {
  const age = +u.age, h = +u.height, w = +u.weight, c = u.conditions || []
  const has = k => c.includes(k), smoker = !!u.smoker
  const bmi = w / (h / 100) ** 2
  const [factor, adj] = ACT[u.activity] || ACT.light
  const rhr = 70 + adj + (age > 50 ? 2 : 0) + (has('Heart condition') ? 6 : 0) + (smoker ? 4 : 0)
  const hr = Math.round(rhr + 2 * Math.sin(t / 3))
  const sys = Math.round(112 + Math.max(0, (age - 25) * 0.3) + (bmi >= 30 ? 8 : bmi >= 25 ? 3 : 0) + (has('Hypertension') ? 16 : 0))
  const dia = Math.round(72 + (bmi >= 30 ? 4 : 0) + (has('Hypertension') ? 9 : 0))
  const spo2 = 98 - (smoker ? 1 : 0) - (has('Asthma') ? 1 : 0)
  const rr = 14 + (u.activity === 'athlete' ? -1 : 0) + (has('Asthma') ? 2 : 0) + (smoker ? 1 : 0)
  const temp = 37.0 + (has('Diabetes') ? 0.1 : 0)
  const sexAdj = u.sex === 'Male' ? 5 : u.sex === 'Female' ? -161 : -78
  const kcal = Math.round((10 * w + 6.25 * h - 5 * age + sexAdj) * factor)
  const metrics = {
    hr: { v: hr, s: hr > 100 || hr < 50 ? 'watch' : 'normal' },
    spo2: { v: spo2, s: spo2 < 95 ? 'watch' : 'normal' },
    temp: { v: temp.toFixed(1), s: temp > 37.8 ? 'watch' : 'normal' },
    rr: { v: rr, s: rr > 20 ? 'watch' : 'normal' },
    bp: { v: `${sys}/${dia}`, s: sys >= 130 || dia >= 85 ? 'watch' : 'normal' },
    bmi: { v: bmi.toFixed(1), s: bmi < 18.5 || bmi >= 30 ? 'watch' : 'normal' },
    ecg: { v: has('Heart condition') ? 'Review' : 'Stable', s: has('Heart condition') ? 'watch' : 'simulated' }
  }
  const flags = Object.values(metrics).filter(m => m.s === 'watch').length
  const crew = flags >= 3 || (has('Heart condition') && has('Hypertension')) ? 'REVIEW' : flags ? 'WATCH' : 'NOMINAL'
  const clearance = { NOMINAL: 'Fit — no restrictions flagged', WATCH: 'Fit with monitoring', REVIEW: 'Clinician review recommended' }[crew]
  const arr = clamp(0.004 + age * 0.0002 + (has('Heart condition') ? 0.02 : 0) + (smoker ? 0.004 : 0) + (bmi >= 30 ? 0.003 : 0), 0, 0.06)
  const dec = clamp(0.004 + (has('Asthma') ? 0.004 : 0) + (smoker ? 0.002 : 0) + (bmi >= 30 ? 0.002 : 0), 0, 0.03)
  const fat = clamp(2 + (u.activity === 'sedentary' ? 1 : 0) + (has('Diabetes') ? 1 : 0) + (age > 45 ? 1 : 0) + (bmi >= 30 ? 1 : 0), 1, 9)
  const risks = [
    ['Arrhythmia probability', arr.toFixed(3), `${(arr / 0.06) * 100}%`],
    ['Decompression risk', dec.toFixed(3), `${(dec / 0.03) * 100}%`],
    ['Workload fatigue index', `${fat.toFixed(1)} / 10`, `${fat * 10}%`],
    ['Metabolic expenditure', `${kcal.toLocaleString()} kcal`, `${clamp((kcal / 3500) * 100, 5, 100)}%`]
  ]
  const tips = []
  if (metrics.bp.s === 'watch') tips.push('Blood-pressure estimate is elevated: reduce sodium, keep hydrated and have it checked by a clinician.')
  if (bmi >= 30) tips.push('BMI is in the obesity range: discuss a gradual nutrition and exercise plan with a professional.')
  else if (bmi < 18.5) tips.push('BMI is below the healthy range: review nutrition and energy intake with a professional.')
  else if (bmi >= 25) tips.push('BMI is slightly above the healthy range: regular aerobic exercise and diet balance can help.')
  if (u.activity === 'sedentary') tips.push('Low activity level: aim for 150 minutes of moderate exercise per week.')
  if (smoker) tips.push('Smoking affects oxygen saturation and cardiac risk: consider a cessation programme.')
  if (has('Asthma')) tips.push('Keep rescue medication accessible and review respiratory readiness before any pressure-related activity.')
  if (has('Diabetes')) tips.push('Monitor blood glucose regularly and plan meals and supplies for the full mission duration.')
  if (has('Heart condition')) tips.push('A cardiology review is recommended before any readiness gate is cleared.')
  if (!tips.length) tips.push('No concerns flagged from your profile. Maintain sleep, hydration, exercise and regular check-ups.')
  return { bmi, maxHR: 220 - age, metrics, crew, clearance, risks, tips, kcal, bpText: metrics.bp.v }
}

export function buildChecks(u, a) {
  const list = [
    ['crew', 'Crew health review acknowledged'], ['env', 'Environmental systems reviewed'],
    ['suit', 'Suit telemetry checked'], ['brief', 'Mission procedure briefing completed'],
    ['contact', `Emergency contact confirmed: ${u.ecName} (${u.ecPhone})`]
  ]
  if ((u.conditions || []).length || u.medications) list.push(['medical', `Personal medical profile reviewed${u.conditions?.length ? ` (${u.conditions.join(', ')})` : ''}`])
  if (a.crew === 'REVIEW') list.push(['signoff', 'Clinician sign-off obtained'])
  return list
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export function buildReportHTML(u, a, checks) {
  const id = `CHM-${(u.createdAt || Date.now()).toString(36).toUpperCase().slice(-6)}`
  const m = a.metrics
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`
  const auth = u.auth?.clearedAt
    ? `Cleared on ${new Date(u.auth.clearedAt).toLocaleString()}`
    : `Not cleared (${checks.filter(([k]) => u.auth?.checks?.[k]).length}/${checks.length} items confirmed)`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Health Report — ${esc(u.name)}</title><style>
body{font:14px/1.5 Arial,sans-serif;color:#111;margin:32px;max-width:820px}h1{margin:0}h2{border-bottom:2px solid #2563eb;padding-bottom:4px;margin-top:26px;font-size:16px;color:#1e3a8a}
.sub{color:#555;font-size:12px}table{width:100%;border-collapse:collapse}th{text-align:left;width:38%;color:#444;font-weight:600}th,td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
.badge{display:inline-block;padding:3px 12px;border-radius:99px;background:#dbeafe;color:#1e3a8a;font-weight:700}li{margin:4px 0}.note{margin-top:28px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:10px}</style></head><body>
<h1>Personal Crew Health Report</h1><div class="sub">Report ${id} · Generated ${esc(new Date().toLocaleString())} · Crew Health Monitoring (demonstration)</div>
<h2>Crew member</h2><table>${row('Name', u.name)}${row('Email', u.email)}${row('Phone', u.phone)}${row('Age / Sex', `${u.age} / ${u.sex}`)}${row('Height / Weight', `${u.height} cm / ${u.weight} kg`)}${row('Blood type', u.bloodType)}${row('Activity level', u.activity)}${row('Smoker', u.smoker ? 'Yes' : 'No')}${row('Conditions', (u.conditions || []).join(', ') || 'None reported')}${row('Medications', u.medications || 'None reported')}${row('Emergency contact', `${u.ecName} · ${u.ecPhone}${u.ecEmail ? ` · ${u.ecEmail}` : ''}`)}</table>
<h2>Overall status</h2><p><span class="badge">${esc(a.crew)}</span> &nbsp;${esc(a.clearance)}</p>
<h2>Estimated biometrics (from your profile)</h2><table>${row('Heart rate (resting est.)', `${m.hr.v} bpm (max ≈ ${a.maxHR} bpm)`)}${row('Blood oxygen', `${m.spo2.v} %`)}${row('Blood pressure', `${m.bp.v} mmHg`)}${row('Core temperature', `${m.temp.v} °C`)}${row('Respiratory rate', `${m.rr.v} /min`)}${row('BMI', m.bmi.v)}${row('Daily energy need', `${a.kcal.toLocaleString()} kcal`)}</table>
<h2>Risk model outputs (illustrative)</h2><table>${a.risks.map(r => row(r[0], r[1])).join('')}</table>
<h2>Recommendations</h2><ul>${a.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
<h2>Mission authorization</h2><table>${row('Status', auth)}${checks.map(([k, l]) => row(l, u.auth?.checks?.[k] ? '✔ Confirmed' : '✘ Pending')).join('')}</table>
<p class="note">This report is generated by an independent demonstration dashboard from self-reported data. Values are estimates, not measurements, and it is not a medical record, diagnosis or NASA-approved document. Consult a qualified clinician for medical decisions.</p></body></html>`
}
