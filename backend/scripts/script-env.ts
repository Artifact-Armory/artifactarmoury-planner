// backend/scripts/script-env.ts
//
// Import this FIRST — before anything that pulls in `../src/db` — in any script
// meant to be run against PRODUCTION via `railway run`.
//
// THE TRAP IT CLOSES. Local dev has no Postgres, so `backend/.env` carries
// `DB_MOCK=true` and `src/db/index.ts` hands back a stub whose every query returns
// `{rows: []}`. Railway, correctly, does NOT set `DB_MOCK` at all (CLAUDE.md says
// so explicitly). And dotenv does not override variables that are already set —
// it only fills in blanks. `DB_MOCK` is a blank under `railway run`, so dotenv
// helpfully fills it from the local .env, and the script quietly runs against the
// mock with a perfectly good production `DATABASE_URL` sitting right there unused.
//
// Nothing errors. `railway run npm run rollup:analytics` would report success
// having rolled up nothing; a backfill would report "0 models found" and look like
// there was simply no work to do. That is the worst shape a bug can take in an
// operational script: it is indistinguishable from the job being already done.
//
// So: if a real DATABASE_URL is present, a local .env does not get to mock it away.

import 'dotenv/config'

if (process.env.DATABASE_URL && process.env.DB_MOCK === 'true') {
  delete process.env.DB_MOCK
  console.warn(
    'Note: ignoring DB_MOCK=true from backend/.env — a real DATABASE_URL is set,\n' +
      '      so this script is running against that database, not the local mock.\n',
  )
}
