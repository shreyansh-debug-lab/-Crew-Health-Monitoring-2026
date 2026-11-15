// Simple in-memory fixed-window limiter. Fine for a single instance; use Redis behind a load balancer.
export function createLimiter({ windowMs, max }) {
  const hits = new Map()
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  }, windowMs)
  timer.unref()
  return {
    check(key) {
      const now = Date.now()
      let e = hits.get(key)
      if (!e || e.reset <= now) { e = { count: 0, reset: now + windowMs }; hits.set(key, e) }
      e.count++
      return { allowed: e.count <= max, retryAfter: Math.ceil((e.reset - now) / 1000), remaining: Math.max(0, max - e.count) }
    },
    clear() { hits.clear() }
  }
}
