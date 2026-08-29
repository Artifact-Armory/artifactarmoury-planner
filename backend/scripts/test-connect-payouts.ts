// backend/scripts/test-connect-payouts.ts
//
//   npm run test:connect-payouts                    # mock-Connect checks only
//   railway run npm run test:connect-payouts        # + the full ledger run
//
// Proves the artist payout chain, using the SAME service functions production uses.
// Two parts, because they need different things:
//
//   PART A — STRIPE CONNECT (no DB, always runs). A mocked account starts NOT
//     onboarded, can be flipped to onboarded, and yields an Express dashboard link.
//     This is what makes the un-onboarded path testable at all: `checkOnboardingStatus`
//     used to return true unconditionally under STRIPE_MOCK, so every mocked artist
//     looked fully set up and the "hold the balance" branch below was unreachable.
//
//   PART B — THE EARNINGS LEDGER (needs DATABASE_URL). One order containing lines
//     from TWO artists at DIFFERENT commission rates, then:
//       1. accrual produces one earning row per line, at each artist's own share;
//       2. accruing AGAIN adds nothing (the confirm route and the Stripe webhook both
//          call it, so double-accrual is a live race, not a hypothetical);
//       3. every row reconciles — artist + platform == gross, to the penny;
//       4. an artist WITHOUT a completed Connect account is held, not failed, and the
//          other artist in the same order is still paid;
//       5. paying out twice does not pay twice;
//       6. the held artist is paid on the next run once they finish onboarding.
//
// SAFETY: Part B runs entirely inside a transaction that is ALWAYS rolled back, and
// forces STRIPE_MOCK so `createTransfer` never contacts Stripe. Nothing it writes
// survives, which is what makes it safe to point at the production database — the
// only one this project has. `runPayouts()` is global by nature, so it will consider
// real artists' cleared balances during the run; those writes are mock transfers and
// are rolled back with everything else. Assertions are scoped to the test artists.

import 'dotenv/config'

// Must be set BEFORE the service modules load: services/stripe.ts reads its mode once
// at import time, and no part of this script may touch real Stripe.
process.env.STRIPE_MOCK = 'true'
process.env.PAYMENTS_ENABLED = 'false'
// Mocked accounts must start un-onboarded for Part A's first assertion to mean anything.
delete process.env.STRIPE_MOCK_ONBOARDING_COMPLETE

if (process.env.DATABASE_PUBLIC_URL && !process.env.DATABASE_URL) {
  // Same convention as scripts/db-query.ts: the private URL is not reachable from a
  // laptop, so `railway run` supplies the public one.
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}
const HAS_DB = !!process.env.DATABASE_URL
// src/db throws on import without a URL; the mock keeps Part A runnable on its own.
if (!HAS_DB) process.env.DB_MOCK = 'true'

/* eslint-disable @typescript-eslint/no-var-requires */
const { db } = require('../src/db')
const {
  getAccountStatus, setMockOnboardingState, createLoginLink, isStripeMock,
} = require('../src/services/stripe')
const { accrueEarningsForOrder } = require('../src/services/earnings')
const { runPayouts, clearMaturedEarnings, MIN_PAYOUT_GBP } = require('../src/services/payouts')

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  const suffix = detail ? '  (' + detail + ')' : ''
  if (ok) {
    console.log('  PASS  ' + label + suffix)
  } else {
    failures++
    console.log('  FAIL  ' + label + suffix)
  }
}
const pence = (n: any) => Math.round(Number(n) * 100)

// ===========================================================================
// PART A — Stripe Connect account lifecycle (mock)
// ===========================================================================

async function partA(): Promise<void> {
  console.log('\nPART A — Stripe Connect onboarding (mock)\n')
  check('payments are mocked (no real Stripe calls)', isStripeMock() === true)

  const accountId = 'acct_mock_test_' + Date.now()

  const fresh = await getAccountStatus(accountId)
  check('a new account is NOT onboarded', fresh.onboardingComplete === false)
  check('  ...and reports details not submitted', fresh.detailsSubmitted === false)
  check('  ...and names an outstanding requirement',
    Array.isArray(fresh.requirementsDue) && fresh.requirementsDue.length > 0,
    (fresh.requirementsDue || []).join(', '))

  setMockOnboardingState(accountId, true)
  const done = await getAccountStatus(accountId)
  check('after completing onboarding it is payout-ready',
    done.onboardingComplete === true && done.payoutsEnabled === true && done.chargesEnabled === true)
  check('  ...with nothing outstanding', done.requirementsDue.length === 0)

  const url = await createLoginLink(accountId)
  check('an Express dashboard link is issued', typeof url === 'string' && url.length > 0, url)

  setMockOnboardingState(accountId, false)
  check('the state can be flipped back (so the held-balance path stays testable)',
    (await getAccountStatus(accountId)).onboardingComplete === false)

  // Live mode must never let a caller self-certify their own account: the setter
  // returns null when !STRIPE_MOCK. Mock is forced here, so assert the mock contract.
  check('the mock setter reports the state it applied',
    setMockOnboardingState(accountId, true) !== null)
}

// ===========================================================================
// PART B — the earnings ledger, inside an always-rolled-back transaction
// ===========================================================================

/**
 * Pin every db call in the process to one client inside a transaction, mapping the
 * services' own BEGIN/COMMIT/ROLLBACK onto savepoints so their internal transactions
 * (payouts.payArtist opens one) nest instead of committing our outer one.
 */
async function inRolledBackTransaction(fn: () => Promise<void>): Promise<void> {
  const pinned = await db.connect()
  const origQuery = db.query.bind(db)
  const origConnect = db.connect.bind(db)
  let savepoints = 0

  await pinned.query('BEGIN')
  db.query = (text: any, params?: any) => pinned.query(text, params)
  db.connect = async () => {
    const stack: string[] = []
    return {
      query: async (text: any, params?: any) => {
        const t = String(text).trim().toUpperCase()
        if (t.indexOf('BEGIN') === 0) {
          const name = 'sp_' + ++savepoints
          stack.push(name)
          return pinned.query('SAVEPOINT ' + name)
        }
        if (t.indexOf('COMMIT') === 0) {
          const name = stack.pop()
          return name ? pinned.query('RELEASE SAVEPOINT ' + name) : { rows: [], rowCount: 0 }
        }
        if (t.indexOf('ROLLBACK') === 0) {
          const name = stack.pop()
          return name ? pinned.query('ROLLBACK TO SAVEPOINT ' + name) : { rows: [], rowCount: 0 }
        }
        return pinned.query(text, params)
      },
      release: () => {},
    }
  }

  try {
    await fn()
  } finally {
    // Unconditional: a thrown assertion must still leave the database untouched.
    await pinned.query('ROLLBACK').catch(() => {})
    db.query = origQuery
    db.connect = origConnect
    pinned.release()
  }
}

/** The artist's share of a line, exactly as routes/orders.ts computes it. */
const shareOf = (price: number, ratePercent: number) => Math.round(price * ratePercent) / 100

async function partB(): Promise<void> {
  console.log('\nPART B — earnings ledger and payout run (real Postgres, rolled back)\n')

  const stamp = Date.now()
  // Artist A keeps the default 85%; artist B is on a negotiated 70%, which is the
  // case a hard-coded platform rate would get wrong.
  const A_RATE = 85
  const B_RATE = 70

  const mkUser = async (suffix: string, role: string, rate: number | null) => {
    const r = await db.query(
      `INSERT INTO users (email, password_hash, display_name, role, commission_rate)
       VALUES ($1, 'x', $2, $3, $4) RETURNING id`,
      ['payout-test-' + stamp + '-' + suffix + '@example.invalid',
        'Payout Test ' + suffix, role, rate],
    )
    return r.rows[0].id as string
  }

  const artistA = await mkUser('a', 'artist', A_RATE)
  const artistB = await mkUser('b', 'artist', B_RATE)
  const buyer = await mkUser('buyer', 'customer', null)

  // Artist A has finished Connect onboarding; artist B has not started.
  const accountA = 'acct_mock_test_' + stamp + '_a'
  setMockOnboardingState(accountA, true)
  await db.query(
    `UPDATE users SET stripe_account_id = $1, stripe_onboarding_complete = true WHERE id = $2`,
    [accountA, artistA],
  )

  // One order, three lines, two artists — the multi-artist cart the whole design
  // exists for. Prices are NET: VAT lives on the order, never in an artist's share.
  const lines = [
    { artist: artistA, rate: A_RATE, price: 10.00, name: 'Gothic Ruin Corner' },
    { artist: artistA, rate: A_RATE, price: 4.10, name: 'Barrel Cluster' },   // rounds .5 up
    { artist: artistB, rate: B_RATE, price: 20.00, name: 'Village Tower' },
  ]
  const subtotal = lines.reduce((s, l) => s + l.price, 0)

  const orderRes = await db.query(
    `INSERT INTO orders (order_number, user_id, customer_email, subtotal, shipping_cost,
                         tax, total, payment_method, payment_status, paid_at, fulfillment_status)
     VALUES ($1, $2, $3, $4, 0, 0, $4, 'stripe', 'succeeded', CURRENT_TIMESTAMP, 'delivered')
     RETURNING id`,
    ['TEST-' + stamp, buyer, 'payout-test-' + stamp + '-buyer@example.invalid', subtotal],
  )
  const orderId = orderRes.rows[0].id as string

  for (const l of lines) {
    // model_id is deliberately NULL: the ledger keys on order_items, and skipping the
    // models table keeps this test off every unrelated upload-pipeline constraint.
    await db.query(
      `INSERT INTO order_items (order_id, artist_id, model_name, quantity, unit_price,
                                total_price, artist_commission_rate, artist_commission_amount)
       VALUES ($1, $2, $3, 1, $4, $4, $5, $6)`,
      [orderId, l.artist, l.name, l.price, l.rate, shareOf(l.price, l.rate)],
    )
  }

  // --- 1. accrual -----------------------------------------------------------
  const accrued = await accrueEarningsForOrder(orderId)
  check('one earning row accrued per order line', accrued === 3, 'accrued ' + accrued)

  // --- 2. idempotency (confirm route AND webhook both call this) -------------
  const again = await accrueEarningsForOrder(orderId)
  const total = await db.query(
    `SELECT COUNT(*)::int AS n FROM artist_earnings WHERE order_id = $1`, [orderId])
  check('re-accruing the same order adds nothing (webhook retry)',
    again === 0 && total.rows[0].n === 3,
    'second call accrued ' + again + ', ' + total.rows[0].n + ' rows total')

  // --- 3. the money reconciles ---------------------------------------------
  const rows = await db.query(
    `SELECT artist_id, gross_amount, artist_amount, platform_amount
     FROM artist_earnings WHERE order_id = $1`, [orderId])

  const reconciles = rows.rows.every((r: any) =>
    pence(r.artist_amount) + pence(r.platform_amount) === pence(r.gross_amount))
  check('every row reconciles: artist + platform == gross', reconciles)

  const sumFor = (id: string) => rows.rows
    .filter((r: any) => r.artist_id === id)
    .reduce((s: number, r: any) => s + pence(r.artist_amount), 0)

  const expectA = pence(shareOf(10.00, A_RATE)) + pence(shareOf(4.10, A_RATE))  // 850 + 349
  const expectB = pence(shareOf(20.00, B_RATE))                                 // 1400
  check("artist A's share uses artist A's rate", sumFor(artistA) === expectA,
    sumFor(artistA) + 'p vs ' + expectA + 'p expected')
  check("artist B's share uses B's DIFFERENT rate", sumFor(artistB) === expectB,
    sumFor(artistB) + 'p vs ' + expectB + 'p expected')
  check('both artists in one order are accounted separately',
    sumFor(artistA) > 0 && sumFor(artistB) > 0 && expectA !== expectB)

  // --- 4. payout run: A paid, B held ---------------------------------------
  // Mature the hold window so the run has something to pay.
  await db.query(
    `UPDATE artist_earnings SET available_at = CURRENT_TIMESTAMP - interval '1 day'
     WHERE order_id = $1`, [orderId])
  const cleared = await clearMaturedEarnings()
  check('matured earnings clear', cleared >= 3, cleared + ' cleared')
  check('both balances exceed the payout minimum, so both are eligible',
    expectA / 100 >= MIN_PAYOUT_GBP && expectB / 100 >= MIN_PAYOUT_GBP)

  const run1 = await runPayouts()
  const resultFor = (id: string) => run1.find((r: any) => r.artistId === id)
  check('artist A (onboarded) is paid', resultFor(artistA) && resultFor(artistA).status === 'paid',
    resultFor(artistA) && resultFor(artistA).status)
  check('artist B (no Connect account) is HELD, not failed',
    resultFor(artistB) && resultFor(artistB).status === 'no_account',
    resultFor(artistB) && resultFor(artistB).status)

  const payA = await db.query(
    `SELECT amount, status, stripe_transfer_id FROM payouts WHERE artist_id = $1`, [artistA])
  check('artist A has exactly one payout batch', payA.rows.length === 1)
  check('  ...marked paid with a transfer id',
    payA.rows[0] && payA.rows[0].status === 'paid' && !!payA.rows[0].stripe_transfer_id,
    payA.rows[0] && payA.rows[0].stripe_transfer_id)
  check('  ...for exactly their share of the order',
    payA.rows[0] && pence(payA.rows[0].amount) === expectA,
    (payA.rows[0] ? pence(payA.rows[0].amount) : '?') + 'p vs ' + expectA + 'p')

  const heldB = await db.query(
    `SELECT status, payout_id FROM artist_earnings WHERE artist_id = $1`, [artistB])
  check("artist B's earnings stay cleared and unassigned",
    heldB.rows.every((r: any) => r.status === 'cleared' && r.payout_id === null))

  // --- 5. no double payment ------------------------------------------------
  await runPayouts()
  const payAagain = await db.query(
    `SELECT COUNT(*)::int AS n FROM payouts WHERE artist_id = $1`, [artistA])
  check('a second payout run does not pay artist A twice', payAagain.rows[0].n === 1,
    payAagain.rows[0].n + ' batches')

  // --- 6. B finishes onboarding and is paid on the next run ----------------
  const accountB = 'acct_mock_test_' + stamp + '_b'
  setMockOnboardingState(accountB, true)
  await db.query(
    `UPDATE users SET stripe_account_id = $1, stripe_onboarding_complete = true WHERE id = $2`,
    [accountB, artistB])

  const run3 = await runPayouts()
  const bResult = run3.find((r: any) => r.artistId === artistB)
  check('artist B is paid once onboarding completes', bResult && bResult.status === 'paid',
    bResult && bResult.status)
  const payB = await db.query(
    `SELECT amount, status FROM payouts WHERE artist_id = $1`, [artistB])
  check('  ...for the amount that was held all along',
    payB.rows.length === 1 && pence(payB.rows[0].amount) === expectB,
    (payB.rows[0] ? pence(payB.rows[0].amount) : '?') + 'p vs ' + expectB + 'p')
}

// ===========================================================================

async function main(): Promise<void> {
  console.log('Artist payouts — Stripe Connect + earnings ledger')

  await partA()

  if (!HAS_DB) {
    console.log('\nPART B — SKIPPED: no DATABASE_URL.')
    console.log('  The ledger half needs a real Postgres. Run it with:')
    console.log('    railway run npm run test:connect-payouts')
    console.log('  (it writes inside a transaction that is always rolled back)')
  } else {
    await inRolledBackTransaction(partB)
    console.log('\n  transaction rolled back — nothing written persists')
  }

  console.log(failures === 0
    ? '\nALL CHECKS PASSED' + (HAS_DB ? '' : ' (Part B skipped)') + '\n'
    : '\n' + failures + ' CHECK(S) FAILED\n')
  if (db.end) await db.end()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('\nTest run crashed:', err)
  process.exit(1)
})
