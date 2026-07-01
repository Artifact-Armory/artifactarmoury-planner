Artifact Armoury Planner — Build & Run Tasks

Overview
- This task list follows DEV_GUIDE.md to build and run the project locally.
- Supports mock mode (no Stripe, no Postgres) and real mode.

Prerequisites
- Node.js >= 18 and npm >= 9
- Git
- Optional: PostgreSQL 14+ (real DB mode)
- Optional: Stripe account + keys (real payments)

1) Clone and open the repo
- `git clone <repo-url>`
- Open the workspace in your IDE

2) Backend setup
- `cd backend`
- `npm install`
- Copy env: `cp .env.example .env` (Windows: `copy .env.example .env`)

3) Choose mode
- Mock mode (no external services):
  - In `backend/.env`, set:
    - `DB_MOCK=true`
    - `STRIPE_MOCK=true` (or `PAYMENTS_ENABLED=false`)
    - `JWT_SECRET=<32+ char dev secret>`
    - `UPLOAD_DIR=./uploads`
    - `EMAIL_FROM=noreply@example.com`
  - Skip migrations and DB.

- Real mode (full stack):
  - In `backend/.env`, set:
    - `DATABASE_URL=postgres://user:pass@host:5432/dbname`
    - `JWT_SECRET=<32+ char secret>`
    - `UPLOAD_DIR=./uploads`
    - `EMAIL_FROM=noreply@yourdomain.com`
    - Stripe: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Initialize DB:
    - `npm run migrate`
    - (Optional) `npm run seed`

4) Start backend (dev)
- `npm run dev`
- Health check: GET `http://localhost:3001/health`
- API root: GET `http://localhost:3001/api`
- Webhooks: Stripe webhook at `POST /api/webhooks/stripe` (raw body). In mock mode, it no-ops.

5) File storage
- Public files served at `http://localhost:3001/uploads/...`
- Ensure `UPLOAD_DIR` exists (defaults to `./uploads`).

6) Frontend (if present)
- `cd frontend`
- `npm install`
- Copy env: `cp .env.example .env`
- Set:
  - `VITE_API_BASE_URL=http://localhost:3001`
  - `VITE_STRIPE_PUBLISHABLE_KEY=<pk_test_...>` (mock mode value is unused)
- Run: `npm run dev` and open `http://localhost:3000`

7) Common flows
- Register/Login: `POST /api/auth/register`, `POST /api/auth/login`
- Browse models: `GET /api/browse`
- Models CRUD (artist): `POST /api/models` etc. (requires JWT)
- Orders (mock payments):
  - `POST /api/orders` returns a mock clientSecret
  - `POST /api/orders/:id/confirm` will treat payment as succeeded in mock mode

8) Build & test
- Type-check/build backend: `npm run build` (from `backend`)
- Run tests (if present): `npm test`

Environment quick reference (backend)
- Required (mock): `DB_MOCK=true`, `STRIPE_MOCK=true`, `JWT_SECRET`, `UPLOAD_DIR`, `EMAIL_FROM`
- Required (real): `DATABASE_URL`, `JWT_SECRET`, `UPLOAD_DIR`, `EMAIL_FROM`, Stripe keys/secrets
- Optional: `PORT` (default 3001), `FRONTEND_URL` (default http://localhost:3000), `BASE_URL` (default http://localhost:3001)

Notes
- Follow DEV_GUIDE.md for detailed architecture, APIs, and workflow.
- Admin and moderation endpoints are under `/api/admin` and require admin JWT.
