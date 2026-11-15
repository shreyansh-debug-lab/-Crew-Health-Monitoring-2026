import { notFound } from '../http/errors.js'

const iso = () => new Date().toISOString()

export function createIncidentService({ db, hub }) {
  const insert = db.prepare(`INSERT INTO incidents (ts,level,title,detail,source,crew_id,dedupe_key,created_by) VALUES (?,?,?,?,?,?,?,?)`)
  const byId = db.prepare(`
    SELECT i.*, c.code AS crew_code, u.name AS created_by_name, a.name AS acknowledged_by_name
    FROM incidents i
    LEFT JOIN crew_members c ON c.id = i.crew_id
    LEFT JOIN users u ON u.id = i.created_by
    LEFT JOIN users a ON a.id = i.acknowledged_by
    WHERE i.id = ?`)

  const shape = (r) => r && ({
    id: r.id, time: r.ts.slice(11, 19), timestamp: r.ts, level: r.level, title: r.title, detail: r.detail,
    source: r.source, crewId: r.crew_id, crewCode: r.crew_code ?? null,
    createdBy: r.created_by_name ?? null,
    acknowledged: !!r.acknowledged_at, acknowledgedAt: r.acknowledged_at, acknowledgedBy: r.acknowledged_by_name ?? null
  })

  return {
    create({ level, title, detail = '', source = 'system', crewId = null, dedupeKey = null, userId = null }) {
      const info = insert.run(iso(), level, title, detail, source, crewId, dedupeKey, userId)
      const incident = shape(byId.get(Number(info.lastInsertRowid)))
      hub.broadcast('incident', incident)
      return incident
    },

    get(id) {
      const r = byId.get(id)
      if (!r) throw notFound('Incident not found')
      return shape(r)
    },

    list({ level, acknowledged, crewId, limit = 50, offset = 0 } = {}) {
      const where = []
      const args = []
      if (level) { where.push('i.level = ?'); args.push(level) }
      if (acknowledged !== undefined) { where.push(acknowledged ? 'i.acknowledged_at IS NOT NULL' : 'i.acknowledged_at IS NULL') }
      if (crewId) { where.push('i.crew_id = ?'); args.push(crewId) }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
      const total = db.prepare(`SELECT COUNT(*) n FROM incidents i ${w}`).get(...args).n
      const rows = db.prepare(`
        SELECT i.*, c.code AS crew_code, u.name AS created_by_name, a.name AS acknowledged_by_name
        FROM incidents i
        LEFT JOIN crew_members c ON c.id = i.crew_id
        LEFT JOIN users u ON u.id = i.created_by
        LEFT JOIN users a ON a.id = i.acknowledged_by
        ${w} ORDER BY i.ts DESC, i.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
      return { total, items: rows.map(shape) }
    },

    acknowledge(id, userId) {
      const r = byId.get(id)
      if (!r) throw notFound('Incident not found')
      if (!r.acknowledged_at) {
        db.prepare('UPDATE incidents SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?').run(iso(), userId, id)
      }
      const incident = shape(byId.get(id))
      hub.broadcast('incident_updated', incident)
      return incident
    },

    // Unacknowledged critical incidents from the last `hours`
    openCritical(hours = 24) {
      const since = new Date(Date.now() - hours * 3600e3).toISOString()
      return db.prepare(`SELECT id,title,ts FROM incidents WHERE level IN ('CRITICAL','ALARM') AND acknowledged_at IS NULL AND ts >= ? ORDER BY ts DESC`).all(since)
    },

    counts() {
      return db.prepare(`SELECT COUNT(*) total, SUM(acknowledged_at IS NULL) open,
        SUM(level='CRITICAL' AND acknowledged_at IS NULL) open_critical FROM incidents`).get()
    },

    recentDuplicate(dedupeKey, level, cooldownSeconds) {
      const since = new Date(Date.now() - cooldownSeconds * 1000).toISOString()
      return !!db.prepare('SELECT 1 FROM incidents WHERE dedupe_key = ? AND level = ? AND ts >= ? LIMIT 1').get(dedupeKey, level, since)
    }
  }
}
