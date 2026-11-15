import { conflict, notFound, forbidden } from '../http/errors.js'
import { tx } from '../db.js'

export function createGateService({ db, hub, incidents, config }) {
  const items = () => db.prepare(`
    SELECT g.key,g.label,g.checked,g.checked_at,u.name AS checked_by
    FROM gate_items g LEFT JOIN users u ON u.id = g.checked_by ORDER BY g.position`).all()
    .map(r => ({ key: r.key, label: r.label, checked: !!r.checked, checkedAt: r.checked_at, checkedBy: r.checked_by }))

  const state = () => db.prepare(`SELECT s.cleared,s.cleared_at,u.name AS cleared_by FROM gate_state s LEFT JOIN users u ON u.id = s.cleared_by WHERE s.id=1`).get()

  function snapshot() {
    const list = items()
    const s = state()
    const allChecked = list.every(i => i.checked)
    const cleared = !!s.cleared && allChecked
    return {
      items: list, allChecked, cleared,
      status: cleared ? 'GATE CLEARED' : 'GATE HOLD',
      clearedAt: cleared ? s.cleared_at : null, clearedBy: cleared ? s.cleared_by : null,
      blockers: config.gateBlockOnCritical ? incidents.openCritical().map(i => ({ id: i.id, title: i.title })) : []
    }
  }

  return {
    snapshot,

    setItem(key, checked, user) {
      const item = db.prepare('SELECT key FROM gate_items WHERE key = ?').get(key)
      if (!item) throw notFound('Unknown checklist item')
      tx(db, () => {
        db.prepare('UPDATE gate_items SET checked=?, checked_by=?, checked_at=? WHERE key=?')
          .run(checked ? 1 : 0, checked ? user.id : null, checked ? new Date().toISOString() : null, key)
        // Any change to the checklist invalidates a previous clearance (matches the dashboard behaviour)
        db.prepare('UPDATE gate_state SET cleared=0, cleared_by=NULL, cleared_at=NULL WHERE id=1').run()
      })
      const snap = snapshot()
      hub.broadcast('gate', snap)
      return snap
    },

    clear(user) {
      const snap = snapshot()
      if (!snap.allChecked) throw conflict('All checklist items must be confirmed before clearing the gate', { pending: snap.items.filter(i => !i.checked).map(i => i.key) })
      if (snap.blockers.length) throw conflict('Unacknowledged critical incidents block gate clearance', { blockers: snap.blockers })
      db.prepare('UPDATE gate_state SET cleared=1, cleared_by=?, cleared_at=? WHERE id=1').run(user.id, new Date().toISOString())
      incidents.create({ level: 'INFO', title: 'Readiness gate cleared', detail: `Cleared by ${user.name}`, source: 'gate', userId: user.id })
      const out = snapshot()
      hub.broadcast('gate', out)
      return out
    },

    reset(user) {
      if (!user) throw forbidden()
      db.prepare('UPDATE gate_state SET cleared=0, cleared_by=NULL, cleared_at=NULL WHERE id=1').run()
      incidents.create({ level: 'INFO', title: 'Readiness gate reset', detail: `Reset by ${user.name}`, source: 'gate', userId: user.id })
      const out = snapshot()
      hub.broadcast('gate', out)
      return out
    }
  }
}
