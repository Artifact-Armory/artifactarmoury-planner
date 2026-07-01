# Moving Terrain Builder Off Mock Mode

This guide describes the steps required to switch the backend from the in-memory mock database to a real PostgreSQL instance and enable the new watermark/licensing features end-to-end.

## 1. Prerequisites

- Docker Desktop **or** a local PostgreSQL 14+ installation.
- Node.js 18+ and npm 9+ (already required for the project).
- Optional: Redis (only needed if you want distributed rate limiting).

## 2. Start PostgreSQL

### Option A – Docker (recommended)

```bash
docker run --name aa-postgres \
  -e POSTGRES_USER=artifact \
  -e POSTGRES_PASSWORD=artifact \
  -e POSTGRES_DB=artifact_armoury \
  -p 5432:5432 \
  -d postgres:14
```

### Option B – Local Install

- Create a database named `artifact_armoury`.
- Create a user with sufficient privileges (e.g., `artifact` / `artifact`).

## 3. Configure the Backend

1. Copy `backend/.env.example` to `backend/.env` if you haven’t already.
2. Edit `backend/.env`:
   ```dotenv
   DB_MOCK=false
   DATABASE_URL=postgresql://artifact:artifact@127.0.0.1:5432/artifact_armoury
   ```
   (Update credentials/host as appropriate.)
3. Ensure `STRIPE_MOCK=true` stays on if you don’t want live Stripe calls yet.

## 4. Install Dependencies

`sharp` is used for image watermarking and needs to be installed before build/run:

```bash
cd backend
npm install
```

> If you see native build errors, install platform build tools (e.g., `build-essential` on Ubuntu, Xcode CLI tools on macOS) and rerun `npm install`.

## 5. Apply Database Migrations

Run the migration script from the backend directory:

```bash
npm run migrate
```

This executes migrations 001 through 006, creating:
- Core schema (`users`, `models`, etc.).
- `model_watermarks` table for watermark metadata.
- `license`, `creator_verified`, `verification_badge` columns.

## 6. Seed Test Data (optional)

If you want starter users/models:

```bash
npm run seed
```

You can also register new artists through the API/UI once mock mode is disabled.

## 7. Restart Services

Backend:

```bash
npm run dev
```

Frontend (in a separate terminal):

```bash
cd ../frontend
npm install
npm run dev
```

> Ensure `frontend/.env` has `VITE_API_BASE_URL=http://127.0.0.1:3001`.

## 8. Verify the Flow

1. Register/login via `/api/auth` or the frontend.
2. Upload a model:
   - Confirm files land under `uploads/models`, `uploads/thumbnails`.
   - `model_watermarks` table should contain a new entry (check via `psql`).
3. Hit admin similarity endpoint (requires admin JWT):
   ```
   GET /api/models/{id}/similar
   ```
   Should return watermark metadata + match scores.
4. Browse catalog in the frontend; licensing badges and verification chips should display.

## 9. Rollback to Mock Mode (if needed)

- Set `DB_MOCK=true` in `backend/.env`.
- Restart the backend.
- Postgres remains unaffected; future migrations can still be run when ready.

## Troubleshooting

- **`connect ECONNREFUSED 127.0.0.1:5432`** — Postgres isn’t running or port is blocked; verify Docker container or service status.
- **Migration column errors** — Ensure migrations ran against the correct database. Use `npm run migrate:status` to inspect applied versions.
- **`sharp` install fails** — Install platform build tools or use prebuilt binaries (see sharp documentation).
- **Login fails after migration** — Make sure your `users` table now includes `creator_verified`/`verification_badge` columns (migration 006). If migration failed midway, rerun after fixing issues.

Once these steps are complete, the application operates fully against PostgreSQL and all watermark/licensing features persist correctly.
