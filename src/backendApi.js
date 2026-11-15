// API requests use Vite's /api proxy in development (no CORS or hardcoded frontend port).
const BASE = import.meta.env.VITE_BACKEND_URL || ''
const TOKEN_KEY = 'chm_backend_token'
let token = sessionStorage.getItem(TOKEN_KEY) || ''
async function request(method, path, body) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  } catch { throw new Error('Backend unreachable. Start the backend server on port 4000.') }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `API error ${response.status}`)
  return data
}
export const backendApi = {
  hasToken: () => !!token,
  async login(email, password) { const result = await request('POST', '/api/auth/login', { email, password }); token = result.token; sessionStorage.setItem(TOKEN_KEY, token); return result.user },
  me: async () => (await request('GET', '/api/auth/me')).user,
  logout() { token = ''; sessionStorage.removeItem(TOKEN_KEY) },
  overview: () => request('GET', '/api/overview'),
  addIncident: (title, detail) => request('POST', '/api/incidents', { title, detail, level: 'MANUAL' }),
  setGateItem: (key, checked) => request('PUT', `/api/gate/items/${encodeURIComponent(key)}`, { checked }),
  clearGate: () => request('POST', '/api/gate/clear', {}),
  resetGate: () => request('POST', '/api/gate/reset', {}),
  activateAlarm: reason => request('POST', '/api/alarm/activate', { reason }),
  silenceAlarm: () => request('POST', '/api/alarm/silence', {}),
  stream(handlers) {
    if (!token) return () => {}
    const stream = new EventSource(`${BASE}/api/stream?token=${encodeURIComponent(token)}`)
    for (const [name, handler] of Object.entries(handlers)) stream.addEventListener(name, handler)
    return () => stream.close()
  }
}
