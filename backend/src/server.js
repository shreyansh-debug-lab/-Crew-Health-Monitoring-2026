import { loadConfig } from './config.js'
import { createApp } from './app.js'

const config = loadConfig()
const app = createApp(config)

const addr = await app.start()
console.log(`\n  Crew Health Monitoring API listening on http://localhost:${addr.port}`)
console.log(`  Environment: ${config.nodeEnv} | Simulator: ${config.simulatorEnabled ? 'ON' : 'OFF'} | Auth required: ${config.authRequired}`)
if (config.jwtSecretEphemeral) console.warn('  ! JWT_SECRET not set: using a random secret, sessions will reset on restart.')
if (config.demoUsersSeeded) console.warn('  ! Demo users created (password "ChangeMe123!"): admin@/surgeon@/control@/crew@/observer@crewhealth.local. Change before real use.')
if (!config.ingestApiKey) console.warn('  ! INGEST_API_KEY not set: device ingestion via X-API-Key is disabled.')
console.log('')

let closing = false
const shutdown = async (sig) => {
  if (closing) return
  closing = true
  console.log(`\n${sig} received, shutting down...`)
  await app.stop()
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
