# Crew Health Monitoring: Backend

REST + live-stream API for the Crew Health Monitoring dashboard. Node.js 22.13+, SQLite (built-in `node:sqlite`),
**zero npm dependencies** — no `npm install` needed.

```bash
cp .env.example .env      # optional; sensible dev defaults exist
npm start                 # http://localhost:4000   (npm run dev for auto-reload)
npm test                  # 17 integration tests
```

On first start in development it creates demo users (password `ChangeMe123!`):
`admin@`, `surgeon@`, `control@`, `crew@`, `observer@crewhealth.local`, and starts a **telemetry simulator**
so the dashboard has live data immediately. Run `AUTH_REQUIRED=false` to let the dashboard read data without logging in
(writes always require a login).

## What maps to which dashboard panel

| Dashboard panel | Endpoints |
|---|---|
| Whole page (single call) | `GET /api/overview` |
| Thermal Regulation & Observation | `GET /api/thermal`, `GET /api/thermal/:zone/history` |
| Clinical Biometrics / Crew Vitals | `GET /api/crew/:id/biometrics/latest`, `GET /api/crew/:id/biometrics?from&to&limit` |
| Pressure Suit Telemetry | `GET /api/crew/:id/suit/latest`, `GET /api/crew/:id/suit` |
| Quantitative Risk Models | `GET /api/crew/:id/risk` |
| Environmental Context | `GET /api/environment/latest`, `GET /api/environment` |
| Mission Authorization (gate) | `GET /api/gate`, `PUT /api/gate/items/:key`, `POST /api/gate/clear`, `POST /api/gate/reset` |
| Alert / Silence alarm | `GET /api/alarm`, `POST /api/alarm/activate`, `POST /api/alarm/silence` |
| Incident Log | `GET/POST /api/incidents`, `GET /api/incidents/:id`, `POST /api/incidents/:id/acknowledge` |
| NASA standards | `GET /api/standards` |
| "Prepare SMS" link | `GET/PUT /api/support-contact` (returns a ready `smsUri`) |
| Log in | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` |
| Live updates | `GET /api/stream` (Server-Sent Events, `?token=<jwt>`) |

Also: crew (`/api/crew`), users (`/api/users`, admin), audit trail (`/api/audit`), thresholds (`/api/thresholds`),
simulator drills (`/api/simulator`, `POST /api/simulator/scenario`), health (`/api/health`).

## Telemetry ingestion (real sensors / gateways)

Send readings with `X-API-Key: $INGEST_API_KEY` (or an operator JWT):

```bash
curl -X POST localhost:4000/api/telemetry/biometrics \
  -H "X-API-Key: $INGEST_API_KEY" -H "Content-Type: application/json" \
  -d '{"crewId":1,"heartRate":74,"spo2":98,"coreTemp":37.1,"respRate":16,"bpSystolic":118,"bpDiastolic":76}'
```

Same pattern for `/api/telemetry/suit`, `/environment`, `/thermal` (`{"zone":"aft_equipment_bay","tempC":23.0}`).
Each reading is range-checked, classified `normal | watch | critical`, stored, streamed over SSE, and, if outside
its range, turned into an incident (with a cooldown). A `critical` reading also raises the alarm
(`AUTO_ALARM_ON_CRITICAL`) and blocks gate clearance until critical incidents are acknowledged (`GATE_BLOCK_ON_CRITICAL`).

## Roles

| Role | Can do |
|---|---|
| `admin` | everything, incl. users, support contact |
| `flight_surgeon`, `mission_control` | ingest, clear/reset gate, silence alarm, acknowledge incidents, run drills |
| `crew` | tick checklist items, raise alarm, add/acknowledge incidents |
| `observer` | read only |

## Demo a critical event

```bash
TOKEN=$(curl -s localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"control@crewhealth.local","password":"ChangeMe123!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -X POST localhost:4000/api/simulator/scenario -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"tachycardia","durationSeconds":30}'
```
Scenarios: `tachycardia`, `hypoxia`, `decompression`, `co2_rise`, `thermal_drift`, `radiation_event`, `recovery`.

## Connecting the frontend

1. Run the backend, and set `CORS_ORIGINS` to your Vite URL (default `http://localhost:5173`).
2. Copy `docs/frontend-client.js` to the frontend as `src/api.js` and replace the hard-coded arrays in `App.jsx`
   with `api.overview()` on load plus `api.stream({...})` for live updates.

## Security notes

- Passwords: scrypt. Tokens: HS256 JWT (8 h). Login rate-limited; global rate limit; body size cap; strict CORS; security headers.
- All state-changing actions are written to `audit_log`.
- **Production:** set `NODE_ENV=production`, a strong `JWT_SECRET`, `ADMIN_EMAIL`/`ADMIN_PASSWORD`, `INGEST_API_KEY`,
  and serve behind HTTPS (reverse proxy). The in-memory rate limiter is per-process.
- The NASA SSO mentioned in the dashboard is **not** implemented; local accounts are used. To add it, replace
  `POST /api/auth/login` with an OIDC callback that issues the same JWT.

## Important

Alert thresholds (`src/services/thresholds.js`) and risk formulas (`src/services/risk.js`) are **illustrative
demonstration values, not clinical or flight-rule limits**. Have qualified flight surgeons set real ones.
This software is not for medical or flight-operations use.
