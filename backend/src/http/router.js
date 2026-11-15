import { HttpError, notFound } from './errors.js'

export class Router {
  constructor() { this.routes = [] }

  add(method, pattern, ...handlers) {
    const keys = []
    const re = new RegExp('^' + pattern.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)' }) + '/?$')
    this.routes.push({ method, re, keys, handlers })
    return this
  }
  get(p, ...h) { return this.add('GET', p, ...h) }
  post(p, ...h) { return this.add('POST', p, ...h) }
  put(p, ...h) { return this.add('PUT', p, ...h) }
  patch(p, ...h) { return this.add('PATCH', p, ...h) }
  delete(p, ...h) { return this.add('DELETE', p, ...h) }

  match(method, pathname) {
    let pathMatched = false
    for (const r of this.routes) {
      const m = r.re.exec(pathname)
      if (!m) continue
      pathMatched = true
      if (r.method !== method) continue
      const params = {}
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]) })
      return { route: r, params }
    }
    return { route: null, pathMatched }
  }

  async dispatch(ctx) {
    const { route, params, pathMatched } = this.match(ctx.method, ctx.path)
    if (!route) throw pathMatched ? new HttpError(405, 'Method not allowed') : notFound('Route not found')
    ctx.params = params
    for (const h of route.handlers) {
      const result = await h(ctx)
      if (ctx.res.writableEnded || ctx.sent) return
      if (result !== undefined) { ctx.send(200, result); return }
    }
  }
}
