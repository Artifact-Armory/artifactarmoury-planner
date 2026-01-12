Backend (API)

Overview
- Node.js 18+, Express, TypeScript.
- PostgreSQL for persistence, JWT for auth, optional Stripe for payments.
- See DEV_GUIDE.md for full project documentation.

Quick Start (Mock Mode)
- Copy backend/.env.example to backend/.env and set:
  - DATABASE_URL=postgres://user:pass@localhost:5432/terrain_builder
  - JWT_SECRET=your-32-char-secret
  - UPLOAD_DIR=./uploads
  - EMAIL_FROM=noreply@example.com
  - STRIPE_MOCK=true (or PAYMENTS_ENABLED=false)
- Install and run:
  - npm install
  - npm run migrate
  - npm run dev

Payments Mock
- With STRIPE_MOCK=true or PAYMENTS_ENABLED=false:
  - createPaymentIntent returns a mock id and client_secret
  - getPaymentIntent returns status "succeeded"
  - Webhook /api/webhooks/stripe safely no-ops

File Uploads
- Served from /uploads (defaults to ./uploads).
- Public URL base: BASE_URL/uploads/<relativePath>.

API Routes
- /api/auth, /api/models, /api/browse, /api/artists, /api/tables, /api/orders, /api/admin
- Webhooks: /api/webhooks/stripe (mounted before JSON parser)

Environment
- Required: DATABASE_URL, JWT_SECRET
- Optional: UPLOAD_DIR (default ./uploads), EMAIL_FROM
- Stripe real mode: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET

Database Migrations
- SQL migrations live in backend/db/migrations (001_*.sql and up).
- `npm run migrate` applies pending migrations using scripts/migrate.ts.
- `npm run migrate:status` prints applied vs pending migrations.
- `npm run migrate:rollback [count]` removes entries from schema_migrations so you can re-run a migration after manually reverting the SQL.
- `npm run migrate:create -- name_here` scaffolds a timestamped SQL file.
