# Crew Health Monitoring — Hackathon Demo

React/Vite mission dashboard with a Node.js REST + Server-Sent Events backend. This project is a **simulation**, not a clinical device or NASA-approved system.

## Requirements
- Node.js 22.13+ (the backend uses Node's built-in SQLite)
- npm

## Run locally

In terminal 1:

```bash
cd backend
npm install
npm start
```

In terminal 2, from the repository root:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal (usually http://localhost:5173, or 5174 if 5173 is occupied). The Vite dev server proxies `/api` to the backend at port 4000.

Click **Connect API** in the dashboard header to authenticate. On a **new development database only**, the backend seeds `admin@crewhealth.local` with password `ChangeMe123!`. This is a demo credential; change it for any deployment. Existing databases may have different accounts. The existing local profile/OTP feature is separate from the backend login.

After connecting, biometrics, suit, environmental readings, risk models, gate state, alarms and recent incidents are supplied by the backend. Server-Sent Events trigger updates; a 10-second refresh acts as a fallback. When disconnected, the original local demo presentation remains.

The optional `alert-server` is a **separate** service used by the original local profile OTP/notification flow. It is not needed for the core backend connection. If you use it, configure its environment separately; do not reuse `VITE_BACKEND_URL` as `VITE_API_URL`.

## Configuration and safety

- Copy `backend/.env.example` to `backend/.env` and configure values as needed. The backend does not automatically load `.env`; supply environment variables via your shell or a process manager.
- For production, set a strong persistent `JWT_SECRET`, admin credentials, CORS origins, and other deployment settings.
- The backend's SQLite files are created at runtime in `backend/data/` and are excluded from Git. **Do not upload personal data or databases to GitHub.**
- Backend session token is stored in `sessionStorage` and expires when the tab/session ends.
- The local profile/OTP feature is a separate legacy demo flow, not synchronized with the backend identity system.
- The frontend's hardcoded mission elapsed time, orbital graphic and some UI text remain illustrative.

## Checks

```bash
cd backend && npm test
# from project root
npm run build
```

## GitHub

```bash
git init
git add .
git commit -m "Prepare crew health monitoring hackathon demo"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Create the empty repository on GitHub first. Review `git status` before committing to ensure `.env`, database files and secrets are excluded.
