import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, Bell, Check, ChevronDown, ChevronUp, CircleHelp,
  ClipboardCheck, Clock3, Gauge, HeartPulse, LifeBuoy, Menu, Search,
  ShieldCheck, Siren, Thermometer, UserRound, Wind, X, Zap, Download, Printer
} from 'lucide-react'
import './App.css'
import './features.css'
import { backendApi } from './backendApi'
import './backend.css'
import {
  CONDITIONS, analyze, buildChecks, buildReportHTML, cleanPhone, endSession, findUser,
  saveUser, sessionUser, userExists, validateProfile
} from './health'

const modules = [
  ['overview', 'Spacecraft overview'], ['nasa', 'NASA standards'],
  ['biometrics', 'Clinical biometrics'], ['access', 'Authorization'],
  ['suit', 'Suit telemetry'], ['risk', 'Risk models'],
  ['environment', 'Environment'], ['incidents', 'Incident log']
]

const initialIncidents = [
  { id: 1, time: '14:32:08', level: 'INFO', title: 'Routine biometric check completed', detail: 'Crew member A — all simulated readings within configured demonstration ranges.' },
  { id: 2, time: '13:48:51', level: 'WATCH', title: 'Thermal zone variance detected', detail: 'Habitat aft zone is 1.2°C above the simulated setpoint.' },
  { id: 3, time: '12:16:20', level: 'INFO', title: 'Suit telemetry self-check passed', detail: 'Primary and secondary oxygen channels responding in simulation.' }
]

const standards = [
  { title: 'NASA-STD-3001, Volume 1', sub: 'Crew Health', desc: 'Human health and medical considerations for human spaceflight.', url: 'https://standards.nasa.gov/node/238' },
  { title: 'NASA-STD-3001, Volume 2', sub: 'Human Factors, Habitability and Environmental Health', desc: 'Design considerations for human-system integration and habitability.', url: 'https://standards.nasa.gov/node/237' }
]

const blank = { name: '', email: '', phone: '', age: '', sex: 'Male', height: '', weight: '', bloodType: 'O+', activity: 'light', smoker: false, conditions: [], medications: '', ecName: '', ecPhone: '', ecEmail: '' }

function Field({ label, error, children }) {
  return <label className="field"><span>{label}</span>{children}{error && <em className="err">{error}</em>}</label>
}

function ProfileForm({ initial = blank, lockEmail, submitLabel, onSubmit, serverError }) {
  const [f, setF] = useState({ ...blank, ...initial })
  const [errs, setErrs] = useState({})
  const set = (k, v) => setF(s => ({ ...s, [k]: v }))
  const inp = (k, props = {}) => <input value={f[k]} onChange={e => set(k, e.target.value)} {...props} />
  const submit = e => {
    e.preventDefault()
    const v = validateProfile(f)
    setErrs(v)
    if (!Object.keys(v).length) onSubmit({ ...f, name: f.name.trim(), email: f.email.trim().toLowerCase() })
  }
  return <form className="profile-form" onSubmit={submit} noValidate>
    <h4>Identity & contact</h4>
    <div className="form-grid">
      <Field label="Full name" error={errs.name}>{inp('name', { placeholder: 'Alex Carter', autoComplete: 'name' })}</Field>
      <Field label="Email" error={errs.email}>{inp('email', { type: 'email', placeholder: 'you@example.com', disabled: lockEmail })}</Field>
      <Field label="Mobile number" error={errs.phone}>{inp('phone', { type: 'tel', placeholder: '+91 98765 43210' })}</Field>
    </div>
    <h4>Health profile</h4>
    <div className="form-grid">
      <Field label="Age" error={errs.age}>{inp('age', { type: 'number', placeholder: '32' })}</Field>
      <Field label="Sex"><select value={f.sex} onChange={e => set('sex', e.target.value)}><option>Male</option><option>Female</option><option>Other</option></select></Field>
      <Field label="Blood type"><select value={f.bloodType} onChange={e => set('bloodType', e.target.value)}>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'].map(b => <option key={b}>{b}</option>)}</select></Field>
      <Field label="Height (cm)" error={errs.height}>{inp('height', { type: 'number', placeholder: '175' })}</Field>
      <Field label="Weight (kg)" error={errs.weight}>{inp('weight', { type: 'number', placeholder: '70' })}</Field>
      <Field label="Activity level"><select value={f.activity} onChange={e => set('activity', e.target.value)}><option value="sedentary">Sedentary</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="athlete">Athlete</option></select></Field>
    </div>
    <div className="chips">{CONDITIONS.map(c => <button type="button" key={c} className={f.conditions.includes(c) ? 'on' : ''} onClick={() => set('conditions', f.conditions.includes(c) ? f.conditions.filter(x => x !== c) : [...f.conditions, c])}>{c}</button>)}
      <button type="button" className={f.smoker ? 'on' : ''} onClick={() => set('smoker', !f.smoker)}>Smoker</button></div>
    <Field label="Current medications (optional)">{inp('medications', { placeholder: 'e.g. Metformin 500 mg' })}</Field>
    <h4>Emergency contact — alerts are sent to this email (and number)</h4>
    <div className="form-grid">
      <Field label="Contact name" error={errs.ecName}>{inp('ecName', { placeholder: 'Jordan Carter' })}</Field>
      <Field label="Contact mobile number" error={errs.ecPhone}>{inp('ecPhone', { type: 'tel', placeholder: '+91 91234 56789' })}</Field>
      <Field label="Contact email" error={errs.ecEmail}>{inp('ecEmail', { type: 'email', placeholder: 'contact@example.com' })}</Field>
    </div>
    {serverError && <div className="err block">{serverError}</div>}
    <button className="btn btn-primary full" type="submit">{submitLabel}</button>
  </form>
}

// Base URL of the alert/verification server (VITE_API_URL, or the older VITE_ALERT_API)
const API = (import.meta.env.VITE_API_URL || (import.meta.env.VITE_ALERT_API || '').replace(/\/api\/alert$/, '')).replace(/\/$/, '')
const post = async (path, body) => {
  if (!API) throw new Error('Server not connected — set VITE_API_URL and start the alert server.')
  let r
  try { r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }
  catch { throw new Error('Cannot reach the server — is it running?') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Request failed')
  return j
}

function AuthPanel({ onAuth }) {
  const [tab, setTab] = useState('signin')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null) // profile waiting for verification
  const [channel, setChannel] = useState('email')
  const [otp, setOtp] = useState({ id: '', code: '', dev: false })
  const [busy, setBusy] = useState(false)
  const signIn = e => {
    e.preventDefault()
    const u = findUser(email, phone)
    if (u) { setPending(u); setError('') }
    else setError(userExists(email) ? 'The number does not match this email.' : 'No profile found for that email. Create a profile first.')
  }
  const register = data => {
    if (userExists(data.email)) { setError('A profile with this email already exists — sign in instead.'); return }
    setPending({ ...data, createdAt: Date.now(), auth: { checks: {}, clearedAt: null } }); setError('')
  }
  const sendCode = async () => {
    setBusy(true); setError('')
    try {
      const j = await post('/api/otp/send', { channel: channel === 'email' ? 'email' : 'sms', to: channel === 'email' ? pending.email : pending.phone })
      setOtp({ id: j.id, code: '', dev: j.dev })
    } catch (e) { setError(e.message) }
    setBusy(false)
  }
  const verify = async e => {
    e.preventDefault(); setBusy(true); setError('')
    try { await post('/api/otp/verify', { id: otp.id, code: otp.code }); onAuth(pending) }
    catch (err) { setError(err.message); setBusy(false) }
  }
  if (pending) return <div className="auth-panel">
    <p className="body-copy">Verify it's you, <b>{pending.name}</b>. Choose where to receive a 6-digit code.</p>
    <div className="chips">
      <button type="button" className={channel === 'email' ? 'on' : ''} onClick={() => { setChannel('email'); setOtp({ id: '', code: '', dev: false }) }}>Email · {pending.email}</button>
      <button type="button" className={channel === 'phone' ? 'on' : ''} onClick={() => { setChannel('phone'); setOtp({ id: '', code: '', dev: false }) }}>SMS · {pending.phone}</button>
    </div>
    {!otp.id
      ? <button className="btn btn-primary full" disabled={busy} onClick={sendCode}>{busy ? 'Sending…' : 'Send code'}</button>
      : <form className="profile-form" onSubmit={verify}>
        <Field label="6-digit code"><input value={otp.code} onChange={e => setOtp(o => ({ ...o, code: e.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" autoFocus placeholder="123456" /></Field>
        {otp.dev && <div className="footnote">Dev mode: the code was printed in the alert-server terminal, not sent.</div>}
        <button className="btn btn-primary full" type="submit" disabled={busy || otp.code.length !== 6}>{busy ? 'Checking…' : 'Verify & continue'}</button>
        <button type="button" className="link-btn" onClick={sendCode}>Resend code</button>
      </form>}
    {error && <div className="err block">{error}</div>}
    <button type="button" className="link-btn" onClick={() => { setPending(null); setOtp({ id: '', code: '', dev: false }); setError('') }}>← Back</button>
  </div>
  return <div className="auth-panel">
    <div className="auth-tabs"><button className={tab === 'signin' ? 'on' : ''} onClick={() => { setTab('signin'); setError('') }}>Sign in</button><button className={tab === 'register' ? 'on' : ''} onClick={() => { setTab('register'); setError('') }}>Create profile</button></div>
    {tab === 'signin'
      ? <form className="profile-form" onSubmit={signIn}>
        <p className="body-copy">Sign in with the email and mobile number you registered with. You'll then verify with a one-time code.</p>
        <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required /></Field>
        <Field label="Mobile number"><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" required /></Field>
        {error && <div className="err block">{error}</div>}
        <button className="btn btn-primary full" type="submit">Continue</button>
      </form>
      : <ProfileForm submitLabel="Continue to verification" onSubmit={register} serverError={error} />}
    <p className="footnote">Demo only: profiles are stored in this browser (localStorage). NASA Single Sign-On is not configured.</p>
  </div>
}

const BASE_CHECKS = [['crew', 'Crew health review acknowledged'], ['env', 'Environmental systems reviewed'], ['suit', 'Suit telemetry checked'], ['brief', 'Mission procedure briefing completed']]
const DEFAULT_METRICS = { hr: { v: 72, s: 'normal' }, spo2: { v: 98, s: 'normal' }, temp: { v: '37.1', s: 'normal' }, rr: { v: 16, s: 'normal' }, bp: { v: '118/76', s: 'normal' }, ecg: { v: 'Stable', s: 'simulated' } }
const DEFAULT_RISKS = [['Arrhythmia probability', '0.012', '12%'], ['Decompression risk', '0.006', '6%'], ['Workload fatigue index', '2.4 / 10', '24%'], ['Metabolic expenditure', '2,140 kcal', '68%']]

function Metric({ label, value, unit, status = 'normal', icon: Icon }) {
  return <div className="metric">
    <div className="metric-top"><span>{label}</span>{Icon && <Icon size={16} />}</div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    <span className={`metric-status ${status}`}>{status === 'normal' ? '● Nominal' : status === 'watch' ? '● Watch' : '● Simulated'}</span>
  </div>
}

function Panel({ id, title, eyebrow, children, collapsed, onToggle, className = '' }) {
  return <section id={`module-${id}`} className={`panel ${className} ${collapsed ? 'collapsed' : ''}`}>
    <div className="panel-heading">
      <div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2></div>
      <button className="icon-button" onClick={onToggle} aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}>
        {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>
    </div>
    {!collapsed && <div className="panel-content">{children}</div>}
  </section>
}

function BackendLogin({ onConnected, onClose }) {
  const [email, setEmail] = useState('admin@crewhealth.local')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try { const person = await backendApi.login(email, password); await onConnected(person); onClose() }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <div className="backend-dialog-backdrop" onClick={onClose}>
    <form className="backend-dialog" onClick={e => e.stopPropagation()} onSubmit={submit}>
      <h3>Connect mission backend</h3>
      <p>Sign in to the API server to display its simulated telemetry and manage incidents, gate and alarms.</p>
      <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="backend-error" role="alert">{error}</p>}
      <div className="backend-dialog-actions"><button className="btn btn-quiet" type="button" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button></div>
    </form>
  </div>
}

export default function App() {
  const [now, setNow] = useState(new Date())
  const [backendUser, setBackendUser] = useState(null)
  const [backendOverview, setBackendOverview] = useState(null)
  const [backendStatus, setBackendStatus] = useState('disconnected')
  const [backendLoginOpen, setBackendLoginOpen] = useState(false)
  const [backendError, setBackendError] = useState('')
  const [user, setUserState] = useState(sessionUser)
  const [modal, setModal] = useState(null)
  const [apiState, setApiState] = useState('')
  const [localDone, setLocalDone] = useState({})
  const [localCleared, setLocalCleared] = useState(null)
  const reportRef = useRef(null)
  const [alarmActive, setAlarmActive] = useState(false)
  const [activeModule, setActiveModule] = useState('overview')
  const [collapsed, setCollapsed] = useState({})
  const [query, setQuery] = useState('')
  const [incidents, setIncidents] = useState(initialIncidents)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const refreshBackend = async () => {
    const overview = await backendApi.overview()
    setBackendOverview(overview)
    setBackendStatus('connected')
    setBackendError('')
    return overview
  }
  useEffect(() => {
    let active = true
    const init = async () => {
      if (!backendApi.hasToken()) return
      try {
        const person = await backendApi.me()
        if (!active) return
        setBackendUser(person)
        const overview = await backendApi.overview()
        if (active) { setBackendOverview(overview); setBackendStatus('connected') }
      } catch (err) {
        if (active) { backendApi.logout(); setBackendStatus('disconnected'); setBackendError(err.message) }
      }
    }
    init()
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!backendUser) return
    let active = true
    const update = () => backendApi.overview().then(v => { if (active) { setBackendOverview(v); setBackendStatus('connected') } }).catch(err => { if (active) { setBackendStatus('offline'); setBackendError(err.message) } })
    const stopStream = backendApi.stream({ biometrics: update, suit: update, environment: update, thermal: update, incident: update, incident_updated: update, alarm: update, gate: update })
    const timer = setInterval(update, 10000)
    return () => { active = false; clearInterval(timer); stopStream() }
  }, [backendUser])
  const connectBackend = async person => { setBackendUser(person); await refreshBackend() }
  const disconnectBackend = () => { backendApi.logout(); setBackendUser(null); setBackendOverview(null); setBackendStatus('disconnected') }
  const remoteCrew = backendOverview?.crew?.[0]
  const remoteBio = remoteCrew?.biometrics
  const remoteSuit = remoteCrew?.suit
  const remoteEnv = backendOverview?.environment
  const remoteGate = backendOverview?.gate
  const remoteAlarm = backendOverview?.alarm
  const remoteIncidents = backendOverview?.incidents?.recent
  const remoteRisk = remoteCrew?.risk
  const backendConnected = !!backendUser && !!backendOverview
  const liveValue = (v, fallback) => backendConnected && v != null ? v : fallback
  const backendMetric = (v, fallback, status = 'normal') => ({ v: liveValue(v, fallback.v), s: backendConnected ? status : fallback.s })

  const a = user ? analyze(user, Math.floor(now.getTime() / 1000)) : null
  const localMetrics = a ? a.metrics : DEFAULT_METRICS
  const m = backendConnected && remoteBio ? {
    ...localMetrics,
    hr: backendMetric(remoteBio.heartRate, localMetrics.hr, remoteBio.metrics?.heart_rate?.status || 'normal'),
    spo2: backendMetric(remoteBio.spo2, localMetrics.spo2, remoteBio.metrics?.spo2?.status || 'normal'),
    temp: backendMetric(remoteBio.coreTemp, localMetrics.temp, remoteBio.metrics?.core_temp?.status || 'normal'),
    rr: backendMetric(remoteBio.respRate, localMetrics.rr, remoteBio.metrics?.resp_rate?.status || 'normal'),
    bp: backendMetric(remoteBio.bloodPressure?.display, localMetrics.bp),
    ecg: backendMetric(remoteBio.ecgStatus, localMetrics.ecg)
  } : localMetrics
  const risks = backendConnected && remoteRisk?.length ? remoteRisk.map(r => [r.label, r.display, `${r.percent}%`]) : (a ? a.risks : DEFAULT_RISKS)
  const checks = backendConnected && remoteGate?.items?.length ? remoteGate.items.map(i => [i.key, i.label]) : (user ? buildChecks(user, a) : BASE_CHECKS)
  const done = backendConnected ? Object.fromEntries(remoteGate.items.map(i => [i.key, i.checked])) : (user ? (user.auth?.checks || {}) : localDone)
  const clearedAt = backendConnected ? remoteGate.clearedAt : (user ? user.auth?.clearedAt : localCleared)
  const allChecked = checks.every(([k]) => done[k])
  const gateReady = backendConnected ? !!remoteGate.cleared : (allChecked && !!clearedAt)
  const first = user ? user.name.split(' ')[0] : ''
  const crewStatus = backendConnected ? (remoteBio?.status || 'NOMINAL').toUpperCase() : (a ? a.crew : 'NOMINAL')
  const crewColor = crewStatus === 'NOMINAL' ? undefined : { color: crewStatus === 'WATCH' ? '#facc15' : '#f87171' }
  const clock = now.toLocaleTimeString([], { hour12: false })
  const alertMsg = user
    ? `CREW HEALTH ALERT: ${user.name} (${user.phone}) needs assistance. Status ${a.crew}; HR ${m.hr.v} bpm, SpO2 ${m.spo2.v}%, BP ${m.bp.v}. Sent ${new Date().toLocaleString()}. Please contact them now.`
    : 'Crew health alert: please contact the mission control team.'
  const sms = `sms:${user ? [user.phone, user.ecPhone].map(cleanPhone).join(',') : '+10000000000'}?&body=${encodeURIComponent(alertMsg)}`

  const togglePanel = (id) => setCollapsed(v => ({ ...v, [id]: !v[id] }))
  const goTo = (id) => {
    setActiveModule(id)
    document.getElementById(`module-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const runSearch = (e) => {
    e.preventDefault()
    if (query.trim()) window.open(`https://www.google.com/search?q=${encodeURIComponent(query.trim())}`, '_blank', 'noopener,noreferrer')
  }
  const addIncident = async () => {
    if (backendConnected) { try { await backendApi.addIncident('Manual incident note added', 'Added from Crew Health Monitoring dashboard'); await refreshBackend() } catch (e) { setBackendError(e.message) }; return }
    const item = { id: Date.now(), time: new Date().toLocaleTimeString([], { hour12: false }), level: 'MANUAL', title: 'Manual incident note added', detail: 'A demonstration log entry was added by the dashboard operator.' }
    setIncidents(v => [item, ...v])
  }
  const logIncident = (level, title, detail) => setIncidents(v => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString([], { hour12: false }), level, title, detail }, ...v])
  const setUser = u => setUserState(saveUser(u))
  const patchAuth = patch => setUser({ ...user, auth: { ...user.auth, ...patch } })
  const handleAuth = u => { setUser(u); setModal(null); logIncident('INFO', `Signed in as ${u.name}`, 'Biometrics, risk models and authorization are now personalised.') }
  const logout = () => { endSession(); setUserState(null); setAlarmActive(false); setApiState('') }
  const toggleCheck = async k => {
    if (backendConnected) { try { await backendApi.setGateItem(k, !done[k]); await refreshBackend() } catch(e) { setBackendError(e.message) }; return }
    if (user) patchAuth({ checks: { ...done, [k]: !done[k] }, clearedAt: null }); else { setLocalDone(v => ({ ...v, [k]: !v[k] })); setLocalCleared(null) }
  }
  const toggleGate = async () => {
    if (backendConnected) { try { if (gateReady) await backendApi.resetGate(); else await backendApi.clearGate(); await refreshBackend() } catch(e) { setBackendError(e.message) }; return }
    const next = gateReady ? null : Date.now()
    if (user) patchAuth({ clearedAt: next }); else setLocalCleared(next)
    logIncident('INFO', next ? 'Readiness gate cleared' : 'Readiness gate reset', next ? `All ${checks.length} authorization items confirmed.` : 'Authorization was reset by the operator.')
  }
  const toggleAlarm = async () => {
    if (backendConnected) { try { if (remoteAlarm?.active) await backendApi.silenceAlarm(); else await backendApi.activateAlarm('Manual alert raised from dashboard'); await refreshBackend() } catch(e) { setBackendError(e.message) }; return }
    if (alarmActive) { setAlarmActive(false); setApiState(''); return }
    setAlarmActive(true)
    if (!user) return
    logIncident('ALERT', 'Emergency alert raised', `Alert for ${user.name} (${user.phone}) and ${user.ecName} (${user.ecPhone}).`)
    if (API) {
      setApiState('Sending alert…')
      try {
        const j = await post('/api/alert', { to: [user.phone, user.ecPhone], emails: [user.email, user.ecEmail].filter(Boolean), message: alertMsg })
        const ok = j.results.filter(x => x.ok), bad = j.results.filter(x => !x.ok), dev = ok.some(x => x.dev)
        setApiState(`${ok.length ? `Alert ${dev ? 'logged in dev mode (not really delivered)' : 'sent'} to ${ok.map(x => x.to).join(' and ')}. ` : ''}${bad.length ? `Failed: ${bad.map(x => `${x.to} (${x.error})`).join('; ')}.` : ''}`)
      } catch (e) { setApiState(`${e.message} Use Prepare SMS to send it yourself.`) }
    } else window.location.href = sms
  }
  const reportHTML = () => buildReportHTML(user, a, checks)
  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([reportHTML()], { type: 'text/html' }))
    const l = document.createElement('a'); l.href = url; l.download = `health-report-${user.name.replace(/\s+/g, '-').toLowerCase()}.html`; l.click(); URL.revokeObjectURL(url)
  }
  const printReport = () => { reportRef.current?.contentWindow?.focus(); reportRef.current?.contentWindow?.print() }
  const displayedIncidents = backendConnected ? (remoteIncidents || []) : incidents
  const visibleIncidents = showAll ? displayedIncidents : displayedIncidents.slice(0, 3)

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Activity size={22}/></div><div><div className="brand-kicker">MISSION CONTROL / HUMAN SYSTEMS</div><h1>Crew Health Monitoring</h1></div></div>
      <div className="top-actions">
        <span className={`gate-pill ${gateReady ? 'ready' : ''}`}><span/> {gateReady ? 'GATE CLEARED' : 'GATE HOLD'}</span>
        <button className="btn btn-quiet backend-connect" title={backendError || 'Connect to the mission API'} onClick={backendConnected ? disconnectBackend : () => setBackendLoginOpen(true)}>{backendConnected ? '● API LIVE · Disconnect' : '○ Connect API'}</button>
        <span className="clock"><Clock3 size={15}/>{clock} <small>LOCAL</small></span>
        <button className="btn btn-quiet" onClick={user ? logout : () => setModal('login')}><UserRound size={16}/>{user ? `${first} · Log out` : 'Log in'}</button>
        <button className={`btn ${(backendConnected ? remoteAlarm?.active : alarmActive) ? 'btn-danger' : 'btn-alert'}`} onClick={toggleAlarm}><Bell size={16}/>{(backendConnected ? remoteAlarm?.active : alarmActive) ? 'Silence alarm' : 'Alert'}</button>
      </div>
    </header>

    {backendError && <div className="backend-error-bar" role="alert">API: {backendError} <button onClick={() => setBackendError('')}>Dismiss</button></div>}
    {(backendConnected ? !!remoteAlarm?.active : alarmActive) && <div className="alarm-banner"><Siren size={18}/><div><b>Demonstration alert is active</b><span>{backendConnected ? 'Backend mission alarm is active (simulation). No emergency messages have been sent.' : user ? (apiState || `Alert prepared for you (${user.phone}) and ${user.ecName} (${user.ecPhone}) but NOT sent yet — a website can't send SMS by itself. Connect the alert server for automatic sending, or on a phone tap Prepare SMS and press Send.`) : 'This does not contact mission control or emergency services. Log in to send alerts to your emergency contact.'}</span></div><a href={sms}>Prepare SMS</a></div>}

    <div className="layout">
      <aside className="sidebar"><div className="side-label">DASHBOARD MODULES</div>
        {modules.map(([id, label], i) => <button key={id} className={`nav-item ${activeModule === id ? 'active' : ''}`} onClick={() => goTo(id)}><span className="nav-index">{String(i + 1).padStart(2, '0')}</span>{label}</button>)}
        <div className="sidebar-bottom"><div className="connection"><span className="live-dot"/> {backendConnected ? 'API CONNECTED' : 'LOCAL SIMULATION'}</div><p>Build 1.0.0<br/>Telemetry is illustrative</p></div>
      </aside>

      <main className="main-content">
        <div className="page-intro"><div><div className="eyebrow">FLIGHT OPERATIONS / CREW WELLNESS</div><h2>Mission health overview</h2><p>Monitor simulated crew biometrics, spacecraft environment and operational readiness.</p></div><div className="mission-tag"><span className="live-dot"/> SIMULATION ACTIVE</div></div>

        <div className="mission-strip">
          <div className="mission-stat"><span className="stat-icon">⌁</span><div><small>MISSION ELAPSED</small><strong>142<span>d</span> 08<span>h</span></strong><em>DEMO FLIGHT CLOCK</em></div></div>
          <div className="mission-stat"><span className="stat-icon">◉</span><div><small>CREW STATUS</small><strong className="stat-good" style={crewColor}>{crewStatus}</strong><em>{user ? `${user.name.toUpperCase()} · TRACKED` : '1 CREW MEMBER TRACKED'}</em></div></div>
          <div className="mission-stat"><span className="stat-icon">⌖</span><div><small>SUIT INTEGRITY</small><strong>98.7<span>%</span></strong><em>ALL SYSTEMS RESPONDING</em></div></div>
          <div className="mission-stat"><span className="stat-icon">⟡</span><div><small>HABITAT CONDITIONS</small><strong className="stat-good">STABLE</strong><em>ENVIRONMENT SIMULATED</em></div></div>
        </div>

        <Panel id="overview" title="Thermal Regulation & Observation" eyebrow="SYSTEM OVERVIEW" collapsed={!!collapsed.overview} onToggle={() => togglePanel('overview')} className="overview-panel">
          <div className="overview-grid">
            <div className="spacecraft-card orbital-card">
              <div className="card-title">ORBITAL TELEMETRY <span>LIVE TRACK / SIMULATED</span></div>
              <div className="orbital-visual">
                <div className="orbital-grid"/>
                <div className="orbit-path orbit-path-a"/>
                <div className="orbit-path orbit-path-b"/>
                <div className="orbit-path orbit-path-c"/>
                <div className="planet-glow"/>
                <div className="planet"><div className="planet-land land-a"/><div className="planet-land land-b"/><div className="planet-land land-c"/><div className="planet-gridlines"/></div>
                <div className="satellite satellite-a"><span/></div>
                <div className="satellite satellite-b"><span/></div>
                <div className="orbital-crosshair">+</div>
                <span className="orbit-label orbit-label-a">ISS ORBIT / 408 KM</span>
                <span className="orbit-label orbit-label-b">GROUND TRACK</span>
                <span className="orbit-label orbit-label-c">SECTOR 07</span>
              </div>
              <div className="orbital-footer"><span><i className="legend-green"/> ORBITAL PATH STABLE</span><b>INCLINATION 51.6°</b></div>
            </div>
            <div className="thermal-card"><div className="card-title">THERMAL ZONES <span>SIMULATED</span></div><div className="temperature-main"><Thermometer size={19}/><div><small>Habitat setpoint</small><strong>21.8<span>°C</span></strong></div><em>Nominal</em></div><div className="temp-bar"/><div className="temp-scale"><span>COOL</span><span>NEUTRAL</span><span>WARM</span></div>{[['Habitat core','21.8°C','normal'],['Aft equipment bay','23.0°C','watch'],['Crew quarters','21.2°C','normal'],['Suit interface','19.6°C','normal']].map(z=><div className="zone-row" key={z[0]}><span className={`zone-dot ${z[2]}`}/><span>{z[0]}</span><b>{z[1]}</b></div>)}</div>
            <div className="vitals-card"><div className="card-title">CREW VITALS <span>{user ? user.name.toUpperCase() : 'CREW A'}</span></div><div className="heart-line"><HeartPulse size={18}/><b>{m.hr.v}</b><small>bpm</small><span>● {m.hr.s === 'normal' ? 'NOMINAL' : 'WATCH'}</span></div><div className="waveform">{[20,34,25,55,82,26,18,32,24,60,88,30,20,35,26,66,92,30,18,40,28,57,84,25,20,33,24,63,90,27,20,35,25,56,82,25].map((h,i)=><i key={i} style={{height:`${h}%`}}/>)}</div><div className="vitals-bottom"><span>Body temperature</span><b>{m.temp.v}°C</b></div><div className="vitals-bottom"><span>Respiratory rate</span><b>{m.rr.v} / min</b></div></div>
          </div>
        </Panel>

        <Panel id="nasa" title="NASA Human-System Standards" eyebrow="REFERENCE LIBRARY" collapsed={!!collapsed.nasa} onToggle={() => togglePanel('nasa')}>
          <p className="body-copy">NASA-STD-3001 provides human-system standards for crew health and human factors in human spaceflight. Use official controlled documents to confirm current revisions and mission applicability.</p>
          <div className="standard-grid">{standards.map(s=><a className="standard-card" href={s.url} target="_blank" rel="noreferrer" key={s.title}><div className="standard-icon"><ClipboardCheck size={20}/></div><div><b>{s.title}</b><span>{s.sub}</span><p>{s.desc}</p><small>OPEN OFFICIAL STANDARD ↗</small></div></a>)}</div>
          <div className="disclaimer"><CircleHelp size={16}/> This dashboard is an independent demonstration and is not NASA-approved, does not establish compliance, and is not a substitute for current standards or mission procedures.</div>
        </Panel>

        <div className="two-column">
          <Panel id="biometrics" title="Clinical Biometrics" eyebrow="MODULE 01 / CREW HEALTH" collapsed={!!collapsed.biometrics} onToggle={() => togglePanel('biometrics')}>
            {user && <div className="profile-strip"><span>{user.age} yrs · {user.sex} · {user.height} cm · {user.weight} kg · BMI {a.bmi.toFixed(1)} · Blood {user.bloodType} · Max HR ≈ {a.maxHR} · {user.conditions?.length ? user.conditions.join(', ') : 'No conditions reported'}</span><div className="strip-actions"><button onClick={() => setModal('profile')}>Edit profile</button><button onClick={() => setModal('report')}>Health report</button></div></div>}
            <div className="metric-grid">
              <Metric label="Heart rate" value={m.hr.v} unit="bpm" status={m.hr.s} icon={HeartPulse}/>
              <Metric label="Blood oxygen" value={m.spo2.v} unit="%" status={m.spo2.s} icon={Wind}/>
              <Metric label="Core temperature" value={m.temp.v} unit="°C" status={m.temp.s} icon={Thermometer}/>
              <Metric label="Respiratory rate" value={m.rr.v} unit="/min" status={m.rr.s} icon={Activity}/>
              <Metric label="Blood pressure" value={m.bp.v} unit="mmHg" status={m.bp.s} icon={Gauge}/>
              <Metric label="ECG signal" value={m.ecg.v} unit="" status={m.ecg.s} icon={Activity}/>
            </div>
            <div className="mini-wave">{Array.from({length:64},(_,i)=><i key={i} style={{height:`${8+Math.abs(Math.sin(i*1.7))*12+(i%13===0?32:0)}px`}}/>)}</div>
            <div className="footnote">SIMULATED VALUES ONLY · Not connected to medical sensors or a patient record.</div>
          </Panel>

          <Panel id="access" title="Mission Authorization" eyebrow="ACCESS GATE" collapsed={!!collapsed.access} onToggle={() => togglePanel('access')}>
            <p className="body-copy">Confirm each readiness item before clearing the demonstration gate.</p>
            <div className="checklist">{checks.map(([k,label])=><label className="check-row" key={k}><input type="checkbox" checked={!!done[k]} onChange={() => toggleCheck(k)}/><span>{label}</span><Check size={15}/></label>)}</div>
            <button className="btn btn-primary full" disabled={!allChecked} onClick={toggleGate}>{gateReady ? 'Reset readiness gate' : 'Clear readiness gate'}</button>
            {gateReady && <div className="cert"><ShieldCheck size={18}/><div><b>Authorization granted{user ? ` · ${user.name}` : ''}</b><span>ID CHM-{String(clearedAt).slice(-6)} · {new Date(clearedAt).toLocaleString()}</span></div></div>}
            <div className="contact-box"><LifeBuoy size={18}/><div><b>{user ? `Emergency contact: ${user.ecName}` : 'Central support contact'}</b><span>{user ? `${user.ecEmail || user.ecPhone} — alerts go to this contact and to you.` : 'Demo contact placeholder — configure an approved contact before use.'}</span></div></div>
            <a className="sms-link" href={sms}>Prepare a demonstration SMS ↗</a>
          </Panel>
        </div>

        <div className="two-column">
          <Panel id="suit" title="Pressure Suit Telemetry" eyebrow="MODULE 02 / SUIT SYSTEMS" collapsed={!!collapsed.suit} onToggle={() => togglePanel('suit')}>
            <div className="metric-grid compact">
              <Metric label="Cabin pressure" value={liveValue(remoteSuit?.cabinPressure, "101.3")} unit="kPa"/>
              <Metric label="Primary oxygen" value={liveValue(remoteSuit?.primaryO2, "98")} unit="%"/>
              <Metric label="Secondary oxygen" value={liveValue(remoteSuit?.secondaryO2, "100")} unit="%"/>
              <Metric label="CO₂ scrubber" value={liveValue(remoteSuit?.co2Scrubber, "96")} unit="%"/>
              <Metric label="Coolant loop" value={liveValue(remoteSuit?.coolantTemp, "18.4")} unit="°C"/>
              <Metric label="Power reserve" value={liveValue(remoteSuit?.powerReserve, "87")} unit="%"/>
            </div><div className="footnote">SIMULATED SUIT TELEMETRY · No physical suit or sensor connection.</div>
          </Panel>
          <Panel id="risk" title="Quantitative Risk Models" eyebrow="MODULE 03 / DECISION SUPPORT" collapsed={!!collapsed.risk} onToggle={() => togglePanel('risk')}>
            <div className="risk-list">{risks.map(r=><div className="risk-item" key={r[0]}><div><span>{r[0]}</span><b>{r[1]}</b></div><div className="progress"><i style={{width:r[2]}}/></div></div>)}</div>
            <div className="advisory"><AlertTriangle size={17}/><span><b>Operational advisory</b><br/>Illustrative model outputs only. Validate any risk model with qualified experts before operational use.</span></div>
          </Panel>
        </div>

        <Panel id="environment" title="Environmental Context" eyebrow="MODULE 04 / HABITAT CONDITIONS" collapsed={!!collapsed.environment} onToggle={() => togglePanel('environment')}>
          <div className="environment-grid">{[['pO₂',liveValue(remoteEnv?.po2,'21.2'),'kPa'],['pN₂',liveValue(remoteEnv?.pn2,'79.1'),'kPa'],['pCO₂',liveValue(remoteEnv?.pco2,'0.04'),'kPa'],['Dosimetry',liveValue(remoteEnv?.doseMsv,'0.18'),'mSv']].map(v=><div className="environment-value" key={v[0]}><span>{v[0]}</span><b>{v[1]} <small>{v[2]}</small></b><em>SIMULATED</em></div>)}</div>
          <div className="environment-note"><Zap size={16}/> Orbital passage: demonstration data · Ground track: not connected to live spacecraft telemetry.</div>
        </Panel>

        <Panel id="incidents" title="Incident Log" eyebrow="MODULE 05 / EVENT HISTORY" collapsed={!!collapsed.incidents} onToggle={() => togglePanel('incidents')}>
          <div className="incident-toolbar"><span>{displayedIncidents.length} logged events</span><div><button className="btn btn-quiet small" onClick={addIncident}>+ Add demo entry</button><button className="btn btn-quiet small" onClick={() => setShowAll(v=>!v)}>{showAll?'Show less':'View all'}</button></div></div>
          <div className="incident-list">{visibleIncidents.map(item=><div className="incident-row" key={item.id}><time>{item.time}</time><span className={`level ${item.level.toLowerCase()}`}>{item.level}</span><div><b>{item.title}</b><p>{item.detail}</p></div></div>)}</div>
        </Panel>

        <Panel id="search" title="Web Search" eyebrow="EXTERNAL REFERENCE" collapsed={!!collapsed.search} onToggle={() => togglePanel('search')}>
          <form className="search-form" onSubmit={runSearch}><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search space weather, mission advisories or a topic…"/><button className="btn btn-primary" type="submit" disabled={!query.trim()}>Search web</button></form>
          <p className="footnote">Search opens Google in a new tab. Results are not fetched, verified or summarized inside this demonstration dashboard.</p>
        </Panel>

        <footer><span>CREW HEALTH MONITORING <b>·</b> DEMONSTRATION BUILD</span><span>All readings are simulated · Not for medical or flight operations use</span></footer>
      </main>
    </div>

    {modal && <div className="modal-back" onClick={() => setModal(null)}><div className={`modal glass ${modal === 'report' ? 'wide' : ''}`} onClick={e => e.stopPropagation()}>
      <div className="modal-head"><h3>{modal === 'login' ? 'Log in' : modal === 'report' ? 'Personal Health Report' : 'Edit profile'}</h3>
        <div>{modal === 'report' && user && <><button className="btn btn-quiet small" onClick={printReport}><Printer size={14}/>Print / PDF</button><button className="btn btn-quiet small" onClick={downloadReport}><Download size={14}/>Download</button></>}<button className="icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={17}/></button></div></div>
      {backendLoginOpen && <BackendLogin onConnected={connectBackend} onClose={() => setBackendLoginOpen(false)} />}
      {modal === 'login' && <AuthPanel onAuth={handleAuth} />}
      {modal === 'report' && user && <iframe ref={reportRef} title="Health report" className="report-frame" srcDoc={reportHTML()} />}
      {modal === 'profile' && user && <ProfileForm initial={user} lockEmail submitLabel="Save changes" onSubmit={data => { setUser({ ...user, ...data }); logIncident('INFO', 'Profile updated', 'Biometrics and authorization items recalculated.'); setModal(null) }} />}
    </div></div>}
  </div>
}