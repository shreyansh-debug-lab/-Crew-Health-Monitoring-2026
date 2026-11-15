// Illustrative alert ranges for a DEMONSTRATION system. They are NOT clinical or flight-rule limits.
// Replace with values approved by your flight surgeons / mission rules (e.g. derived from NASA-STD-3001).
//
// A value inside [normalLow, normalHigh] is "normal", inside [watchLow, watchHigh] is "watch", otherwise "critical".

const INF = Infinity
export const RULES = {
  biometrics: {
    heart_rate: { label: 'Heart rate', unit: 'bpm', watchLow: 40, normalLow: 50, normalHigh: 100, watchHigh: 120 },
    spo2: { label: 'Blood oxygen', unit: '%', watchLow: 90, normalLow: 95, normalHigh: INF, watchHigh: INF },
    core_temp: { label: 'Core temperature', unit: '°C', watchLow: 35.5, normalLow: 36.1, normalHigh: 37.8, watchHigh: 38.5 },
    resp_rate: { label: 'Respiratory rate', unit: '/min', watchLow: 10, normalLow: 12, normalHigh: 20, watchHigh: 25 },
    bp_sys: { label: 'Systolic pressure', unit: 'mmHg', watchLow: 80, normalLow: 90, normalHigh: 130, watchHigh: 150 },
    bp_dia: { label: 'Diastolic pressure', unit: 'mmHg', watchLow: 50, normalLow: 60, normalHigh: 85, watchHigh: 95 }
  },
  suit: {
    cabin_pressure: { label: 'Cabin pressure', unit: 'kPa', watchLow: 90, normalLow: 97, normalHigh: 103, watchHigh: 106 },
    primary_o2: { label: 'Primary oxygen', unit: '%', watchLow: 20, normalLow: 40, normalHigh: INF, watchHigh: INF },
    secondary_o2: { label: 'Secondary oxygen', unit: '%', watchLow: 20, normalLow: 40, normalHigh: INF, watchHigh: INF },
    co2_scrubber: { label: 'CO₂ scrubber', unit: '%', watchLow: 20, normalLow: 40, normalHigh: INF, watchHigh: INF },
    coolant_temp: { label: 'Coolant loop', unit: '°C', watchLow: 8, normalLow: 12, normalHigh: 24, watchHigh: 30 },
    power_reserve: { label: 'Power reserve', unit: '%', watchLow: 10, normalLow: 25, normalHigh: INF, watchHigh: INF }
  },
  environment: {
    po2: { label: 'pO₂', unit: 'kPa', watchLow: 17, normalLow: 19, normalHigh: 23, watchHigh: 25 },
    pn2: { label: 'pN₂', unit: 'kPa', watchLow: 70, normalLow: 76, normalHigh: 82, watchHigh: 86 },
    pco2: { label: 'pCO₂', unit: 'kPa', watchLow: -INF, normalLow: -INF, normalHigh: 0.5, watchHigh: 1.0 },
    dose_msv: { label: 'Dosimetry', unit: 'mSv', watchLow: -INF, normalLow: -INF, normalHigh: 0.5, watchHigh: 1.0 }
  }
}

// Thermal zones are judged by deviation from their own setpoint.
export const THERMAL_RULE = { normalDev: 1.0, watchDev: 3.0 }

export const SEVERITY = { normal: 0, watch: 1, critical: 2 }
export const worst = (a, b) => (SEVERITY[a] >= SEVERITY[b] ? a : b)

export function classify(rule, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  if (value >= rule.normalLow && value <= rule.normalHigh) return 'normal'
  if (value >= rule.watchLow && value <= rule.watchHigh) return 'watch'
  return 'critical'
}

export function classifyThermal(temp, setpoint) {
  const dev = Math.abs(temp - setpoint)
  return dev <= THERMAL_RULE.normalDev ? 'normal' : dev <= THERMAL_RULE.watchDev ? 'watch' : 'critical'
}

// Returns { status, metrics: { key: { value, status, label, unit } } }
export function evaluate(domain, reading) {
  const rules = RULES[domain]
  const metrics = {}
  let status = 'normal'
  for (const [key, rule] of Object.entries(rules)) {
    if (reading[key] === undefined || reading[key] === null) continue
    const s = classify(rule, reading[key])
    metrics[key] = { value: reading[key], status: s, label: rule.label, unit: rule.unit }
    status = worst(status, s)
  }
  if (domain === 'biometrics' && reading.ecg_status && reading.ecg_status !== 'stable') {
    const s = reading.ecg_status === 'critical' ? 'critical' : 'watch'
    metrics.ecg_status = { value: reading.ecg_status, status: s, label: 'ECG signal', unit: '' }
    status = worst(status, s)
  }
  return { status, metrics }
}
