// backend/scripts/script-env.ts
//
// Import this FIRST — before anything that pulls in `../src/db` — in any script
// meant to be run against PRODUCTION via `railway run`.
//
// It closes two traps that both fail SILENTLY or confusingly from a laptop.
//
// 1. A LOCAL .env SILENTLY MOCKING THE DATABASE.
//    Local dev has no Postgres, so `backend/.env` carries `DB_MOCK=true` and
//    `src/db/index.ts` hands back a stub whose every query returns `{rows: []}`.
//    Railway, correctly, does NOT set `DB_MOCK` (CLAUDE.md says so explicitly).
//    And dotenv does not override variables that are already set — it only fills
//    in blanks. `DB_MOCK` is a blank under `railway run`, so dotenv helpfully
//    fills it from the local .env and the script quietly runs against the mock
//    with a perfectly good production connection sitting right there unused.
//    Nothing errors: a rollup reports success having rolled up nothing, a backfill
//    reports "0 models found". That is the worst shape a bug can take in an ops
//    script — indistinguishable from the job being already done.
//
// 2. THE PRIVATE DATABASE_URL NOT RESOLVING OFF-PLATFORM.
//    `railway run` injects production's env but executes on YOUR machine, and
//    production's `DATABASE_URL` points at `postgres.railway.internal` — a private
//    hostname that only resolves inside Railway (`ENOTFOUND` from anywhere else).
//    `DATABASE_PUBLIC_URL` is the reachable one. `scripts/db-query.ts` has always
//    preferred it; these scripts now do too, rather than each rediscovering it.

import 'dotenv/config'

const INTERNAL_HOST = /\.railway\.internal/

if (process.env.DATABASE_PUBLIC_URL && INTERNAL_HOST.test(process.env.DATABASE_URL ?? '')) {
  // Same swap scripts/db-query.ts makes, for the same reason.
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}

if (process.env.DATABASE_URL && process.env.DB_MOCK === 'true') {
  delete process.env.DB_MOCK
  console.warn(
    'Note: ignoring DB_MOCK=true from backend/.env — a real DATABASE_URL is set,\n' +
      '      so this script is running against that database, not the local mock.\n',
  )
}

if (INTERNAL_HOST.test(process.env.DATABASE_URL ?? '')) {
  console.error(
    'Only the PRIVATE DATABASE_URL is set (a *.railway.internal host). That name\n' +
      'resolves inside Railway only — `railway run` injects the env but runs the\n' +
      'command on this machine, so it cannot connect.\n\n' +
      'Link the POSTGRES service, which also exposes DATABASE_PUBLIC_URL:\n\n' +
      '  railway link          (same project, choose "Postgres")\n' +
      '  railway run npm run <this script>\n',
  )
  process.exit(1)
}
