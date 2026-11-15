export function createAlarmService({ db, hub, incidents }) {
  const row = () => db.prepare('SELECT * FROM alarm_state WHERE id = 1').get()
  const shape = (r) => ({
    active: !!r.active, reason: r.reason, activatedBy: r.activated_by, activatedAt: r.activated_at,
    silencedBy: r.silenced_by, silencedAt: r.silenced_at,
    notice: 'Demonstration alarm: this does not contact mission control or emergency services.'
  })

  return {
    get: () => shape(row()),

    activate({ reason = 'Manual alert', by = 'system', userId = null, crewId = null }) {
      const now = new Date().toISOString()
      const cur = row()
      if (cur.active) return { ...shape(cur), changed: false }
      db.prepare('UPDATE alarm_state SET active=1, reason=?, activated_by=?, activated_at=?, silenced_by=NULL, silenced_at=NULL WHERE id=1').run(reason, by, now)
      incidents.create({ level: 'ALARM', title: 'Alarm activated', detail: `${reason} (by ${by})`, source: 'alarm', crewId, userId })
      const state = shape(row())
      hub.broadcast('alarm', state)
      return { ...state, changed: true }
    },

    silence({ by = 'system', userId = null }) {
      const cur = row()
      if (!cur.active) return { ...shape(cur), changed: false }
      db.prepare('UPDATE alarm_state SET active=0, silenced_by=?, silenced_at=? WHERE id=1').run(by, new Date().toISOString())
      incidents.create({ level: 'INFO', title: 'Alarm silenced', detail: `Silenced by ${by}`, source: 'alarm', userId })
      const state = shape(row())
      hub.broadcast('alarm', state)
      return { ...state, changed: true }
    }
  }
}
