// Illustrative heuristic risk estimates that mirror the dashboard's "Quantitative Risk Models" panel.
// These are simple demonstration formulas, NOT validated clinical or operational models.

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d
const level = (pct) => (pct >= 60 ? 'critical' : pct >= 35 ? 'watch' : 'normal')

export function computeRisk({ bio, suit, env, crew }) {
  const hr = bio?.heart_rate ?? 70
  const spo2 = bio?.spo2 ?? 98
  const resp = bio?.resp_rate ?? 16
  const ecgBad = bio && bio.ecg_status && bio.ecg_status !== 'stable' ? (bio.ecg_status === 'critical' ? 3 : 1.5) : 0
  const pressure = suit?.cabin_pressure ?? 101.3
  const pn2 = env?.pn2 ?? 79.1
  const shift = crew?.shift_hours ?? 4

  const arrhythmia = sigmoid(-4.5 + 0.045 * Math.abs(hr - 70) + 0.12 * Math.max(0, 95 - spo2) + ecgBad)
  const decompression = sigmoid(-5 + 0.35 * Math.max(0, 101.3 - pressure) + 0.08 * Math.max(0, pn2 - 82))
  const fatigue = clamp(0.5 + 0.045 * Math.max(0, hr - 55) + 0.1 * Math.max(0, resp - 12) + 0.12 * shift, 0, 10)
  const kcal = clamp(1700 + 35 * (hr - 60) + 8 * (resp - 12), 1200, 5000)

  const models = [
    { key: 'arrhythmia_probability', label: 'Arrhythmia probability', value: round(arrhythmia, 3), display: round(arrhythmia, 3).toFixed(3), percent: 0 },
    { key: 'decompression_risk', label: 'Decompression risk', value: round(decompression, 3), display: round(decompression, 3).toFixed(3), percent: 0 },
    { key: 'workload_fatigue_index', label: 'Workload fatigue index', value: round(fatigue, 1), display: `${round(fatigue, 1)} / 10`, percent: round(fatigue * 10, 0) },
    { key: 'metabolic_expenditure', label: 'Metabolic expenditure', value: Math.round(kcal), display: `${Math.round(kcal).toLocaleString('en-US')} kcal`, percent: round((kcal / 3150) * 100, 0) }
  ]
  // The dashboard bar for the two probabilities uses a scaled percent (probability x 1000 capped at 100)
  models[0].percent = clamp(Math.round(arrhythmia * 1000), 0, 100)
  models[1].percent = clamp(Math.round(decompression * 1000), 0, 100)
  // Severity uses the raw probability for the two probabilistic models, index/percent for the others
  models[0].status = arrhythmia >= 0.2 ? 'critical' : arrhythmia >= 0.05 ? 'watch' : 'normal'
  models[1].status = decompression >= 0.2 ? 'critical' : decompression >= 0.05 ? 'watch' : 'normal'
  models[2].status = level(fatigue * 10 + 10)
  models[3].status = kcal > 3300 ? 'watch' : 'normal'

  return {
    models,
    disclaimer: 'Illustrative model outputs only. Validate any risk model with qualified experts before operational use.',
    inputs: { heart_rate: hr, spo2, resp_rate: resp, cabin_pressure: pressure, pn2, shift_hours: shift }
  }
}
