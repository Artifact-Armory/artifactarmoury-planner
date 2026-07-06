// backend/scripts/rollup-analytics.ts
//
// Recompute the daily analytics rollups (migration 015). Idempotent — safe to
// re-run. The dashboard auto-refreshes the last 2 days on load, so this is for a
// periodic full recompute / backfill (schedule it, e.g. Railway cron, nightly).
//
//   npm run rollup:analytics            # last 7 days
//   npm run rollup:analytics -- 30      # last 30 days
//   npm run rollup:analytics -- 2026-06-01 2026-06-30   # explicit range

import 'dotenv/config';
import { rollupRange } from '../src/services/analyticsRollup';
import { db } from '../src/db';

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

async function main() {
  const args = process.argv.slice(2);
  let from: string;
  let to: string;
  if (args.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(args[0])) {
    from = args[0];
    to = args[1];
  } else {
    const days = args[0] ? parseInt(args[0], 10) || 7 : 7;
    from = isoDaysAgo(days);
    to = isoDaysAgo(0);
  }
  console.log(`Rolling up analytics ${from} → ${to} …`);
  await rollupRange(from, to);
  console.log('✅ Rollup complete.');
  await (db as any).end?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
