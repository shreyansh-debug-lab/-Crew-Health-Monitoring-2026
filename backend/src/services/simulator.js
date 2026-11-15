// Generates realistic-looking demo telemetry using bounded random walks, with injectable scenarios.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const jitter = (amp) => (Math.random() * 2 - 1) * amp
const r1 = (v) => Math.round(v * 10) / 10
const r2 = (v) => Math.round(v * 100) / 100

export const SCENARIOS = {
  tachycardia: 'Elevated heart rate and respiratory rate for Crew A',
  hypoxia: 'Falling blood oxygen for Crew A',
  decompression: 'Slow cabin / suit pressure loss',
  co2_rise: 'Habitat pCO₂ rising',
  thermal_drift: 'Aft equipment bay overheating',
  radiation_event: 'Dosimetry spike',
  recovery: 'Clear all active scenarios'
}

export function createSimulator({ config, crewList, telemetry }) {
  let timer = null
  const active = new Map() // name -> expiry ms
  const state = { crew: new Map(), env: { po2: 21.2, pn2: 79.1, pco2: 0.04, dose: 0.18 }, zones: new Map() }

  const has = (n) => (active.get(n) ?? 0) > Date.now()

  function bioStep(c) {
    const s = state.crew.get(c.id) ?? { hr: 72, spo2: 98, temp: 37.1, resp: 16, sys: 118, dia: 76, pressure: 101.3, p1: 98, p2: 100, scrub: 96, cool: 18.4, power: 87 }
    state.crew.set(c.id, s)
    const isA = c.code === 'A'
    const hrTarget = isA && has('tachycardia') ? 128 : 72
    const respTarget = isA && has('tachycardia') ? 27 : 16
    const spo2Target = isA && has('hypoxia') ? 86 : 98
    s.hr = clamp(s.hr + (hrTarget - s.hr) * 0.25 + jitter(1.6), 35, 190)
    s.resp = clamp(s.resp + (respTarget - s.resp) * 0.25 + jitter(0.5), 6, 40)
    s.spo2 = clamp(s.spo2 + (spo2Target - s.spo2) * 0.25 + jitter(0.3), 70, 100)
    s.temp = clamp(s.temp + (37.1 - s.temp) * 0.1 + jitter(0.04), 35, 40)
    s.sys = clamp(s.sys + (118 - s.sys) * 0.1 + jitter(1.5), 70, 190)
    s.dia = clamp(s.dia + (76 - s.dia) * 0.1 + jitter(1), 40, 120)
    const ecg = s.hr > 140 ? 'irregular' : 'stable'
    telemetry.recordBiometrics(c.id, {
      heart_rate: Math.round(s.hr), spo2: r1(s.spo2), core_temp: r1(s.temp), resp_rate: Math.round(s.resp),
      bp_sys: Math.round(s.sys), bp_dia: Math.round(s.dia), ecg_status: ecg
    }, 'simulator')

    const pTarget = has('decompression') ? 84 : 101.3
    s.pressure = clamp(s.pressure + (pTarget - s.pressure) * (has('decompression') ? 0.08 : 0.2) + jitter(0.08), 60, 110)
    s.p1 = clamp(s.p1 - 0.01 + jitter(0.05) + (has('recovery') ? 0.5 : 0), 15, 100)
    s.p2 = clamp(s.p2 + jitter(0.03), 15, 100)
    s.scrub = clamp(s.scrub - 0.01 + jitter(0.08), 15, 100)
    s.cool = clamp(s.cool + (18.4 - s.cool) * 0.1 + jitter(0.1), 5, 35)
    s.power = clamp(s.power - 0.005 + jitter(0.03), 5, 100)
    telemetry.recordSuit(c.id, {
      cabin_pressure: r1(s.pressure), primary_o2: Math.round(s.p1), secondary_o2: Math.round(s.p2),
      co2_scrubber: Math.round(s.scrub), coolant_temp: r1(s.cool), power_reserve: Math.round(s.power)
    }, 'simulator')
  }

  function envStep() {
    const e = state.env
    e.po2 = clamp(e.po2 + (21.2 - e.po2) * 0.2 + jitter(0.03), 15, 27)
    e.pn2 = clamp(e.pn2 + (79.1 - e.pn2) * 0.2 + jitter(0.05), 60, 90)
    e.pco2 = clamp(e.pco2 + ((has('co2_rise') ? 1.4 : 0.04) - e.pco2) * (has('co2_rise') ? 0.1 : 0.2) + jitter(0.003), 0, 3)
    e.dose = clamp(e.dose + (has('radiation_event') ? 0.08 : (0.18 - e.dose) * 0.1) + jitter(0.004), 0, 5)
    telemetry.recordEnvironment({ po2: r2(e.po2), pn2: r1(e.pn2), pco2: r2(e.pco2), dose_msv: r2(e.dose) }, 'simulator')

    for (const z of telemetry.zones()) {
      let t = state.zones.get(z.slug) ?? (z.slug === 'aft_equipment_bay' ? 23.0 : z.setpoint_c)
      let target = z.slug === 'aft_equipment_bay' ? 23.0 : z.setpoint_c
      if (z.slug === 'aft_equipment_bay' && has('thermal_drift')) target = 27.5
      t = t + (target - t) * 0.15 + jitter(0.05)
      state.zones.set(z.slug, t)
      telemetry.recordThermal(z.slug, r1(t), 'simulator')
    }
  }

  function tick() {
    try {
      for (const c of crewList()) bioStep(c)
      envStep()
    } catch (e) {
      console.error('[simulator] tick failed:', e.message)
    }
  }

  return {
    start() {
      if (timer) return
      tick()
      timer = setInterval(tick, config.simIntervalMs)
      timer.unref()
    },
    stop() { if (timer) clearInterval(timer); timer = null },
    get running() { return !!timer },
    tick,
    trigger(name, seconds = 60) {
      if (name === 'recovery') { active.clear(); return { name, active: [] } }
      active.set(name, Date.now() + seconds * 1000)
      return { name, expiresInSeconds: seconds }
    },
    activeScenarios() { return [...active.entries()].filter(([, t]) => t > Date.now()).map(([n, t]) => ({ name: n, secondsLeft: Math.ceil((t - Date.now()) / 1000) })) }
  }
}
