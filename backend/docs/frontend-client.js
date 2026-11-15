// Drop-in API client for the React dashboard. Save as src/api.js in the frontend.
// Add to the frontend's .env:  VITE_API_URL=http://localhost:4000
const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'
let token = localStorage.getItem('chm_token') || ''

async function request(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = res.status === 204 ? null : await res.json()
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || res.statusText), { status: res.status, details: data?.error?.details })
  return data
}

export const api = {
  async login(email, password) {
    const r = await request('POST', '/api/auth/login', { email, password })
    token = r.token; localStorage.setItem('chm_token', token)
    return r.user
  },
  logout() { token = ''; localStorage.removeItem('chm_token') },
  overview: () => request('GET', '/api/overview'),
  incidents: (limit = 50) => request('GET', `/api/incidents?limit=${limit}`),
  addIncident: (title, detail) => request('POST', '/api/incidents', { title, detail }),
  setGateItem: (key, checked) => request('PUT', `/api/gate/items/${key}`, { checked }),
  clearGate: () => request('POST', '/api/gate/clear'),
  resetGate: () => request('POST', '/api/gate/reset'),
  activateAlarm: (reason) => request('POST', '/api/alarm/activate', { reason }),
  silenceAlarm: () => request('POST', '/api/alarm/silence'),
  supportContact: () => request('GET', '/api/support-contact'),
  standards: () => request('GET', '/api/standards'),

  // Live updates: events are biometrics | suit | environment | thermal | incident | incident_updated | alarm | gate
  stream(handlers) {
    const es = new EventSource(`${BASE}/api/stream?token=${encodeURIComponent(token)}`)
    for (const [event, fn] of Object.entries(handlers)) es.addEventListener(event, e => fn(JSON.parse(e.data)))
    return () => es.close()
  }
}
