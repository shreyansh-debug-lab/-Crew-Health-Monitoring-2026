import crypto from 'node:crypto'

const env = process.env
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()))
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d)

export function loadConfig(overrides = {}) {
  const nodeEnv = env.NODE_ENV || 'development'
  const production = nodeEnv === 'production'
  const cfg = {
    nodeEnv,
    production,
    port: int(env.PORT, 4000),
    jwtSecret: env.JWT_SECRET || '',
    tokenTtlSeconds: int(env.TOKEN_TTL_SECONDS, 8 * 3600),
    dbPath: env.DB_PATH || './data/crew-health.db',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(s => s.trim()).filter(Boolean),
    authRequired: bool(env.AUTH_REQUIRED, true),
    ingestApiKey: env.INGEST_API_KEY || '',
    adminEmail: env.ADMIN_EMAIL || '',
    adminPassword: env.ADMIN_PASSWORD || '',
    simulatorEnabled: bool(env.SIMULATOR_ENABLED, !production),
    simIntervalMs: int(env.SIM_INTERVAL_MS, 2000),
    alertCooldownSeconds: int(env.ALERT_COOLDOWN_SECONDS, 120),
    autoAlarmOnCritical: bool(env.AUTO_ALARM_ON_CRITICAL, true),
    gateBlockOnCritical: bool(env.GATE_BLOCK_ON_CRITICAL, true),
    retentionHours: int(env.RETENTION_HOURS, 72),
    seedDemoUsers: !production,
    ...overrides
  }
  if (!cfg.jwtSecret) {
    if (production) throw new Error('JWT_SECRET must be set in production')
    cfg.jwtSecret = crypto.randomBytes(32).toString('hex')
    cfg.jwtSecretEphemeral = true
  }
  if (production && (!cfg.adminEmail || !cfg.adminPassword)) {
    // only fatal if the DB turns out to be empty; checked in db seeding
    cfg.adminMissing = true
  }
  return cfg
}
