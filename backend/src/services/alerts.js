// Turns threshold breaches into incidents (with a cooldown so a sustained breach does not flood the log).
export function createAlertService({ incidents, alarm, config }) {
  return {
    raise({ domain, subject, subjectLabel, crewId, evaluation, source, detailFor }) {
      const created = []
      let hasCritical = false
      for (const [key, m] of Object.entries(evaluation.metrics)) {
        if (m.status === 'normal' || m.status === null) continue
        const level = m.status === 'critical' ? 'CRITICAL' : 'WATCH'
        if (level === 'CRITICAL') hasCritical = true
        const dedupeKey = `${domain}:${subject}:${key}`
        if (incidents.recentDuplicate(dedupeKey, level, config.alertCooldownSeconds)) continue
        const valueText = `${m.value}${m.unit ? ' ' + m.unit : ''}`
        created.push(incidents.create({
          level,
          title: `${m.label} ${level === 'CRITICAL' ? 'critical' : 'outside nominal range'}`,
          detail: detailFor ? detailFor(m) : `${subjectLabel}: ${m.label} reading ${valueText}.`,
          source: `${source}:${domain}`, crewId, dedupeKey
        }))
      }
      if (hasCritical && config.autoAlarmOnCritical) {
        alarm.activate({ reason: `Critical reading detected (${subjectLabel})`, by: 'system', crewId })
      }
      return created
    }
  }
}
