// backend/scripts/test-vat-parity.ts
//
//   npm run test:vat
//
// Guards the one invariant tax-inclusive pricing rests on: **the price the buyer is
// shown is the price the buyer is charged.** The storefront grosses prices up
// client-side (so a product card can render instantly) while the backend computes
// the authoritative charge — two implementations of the same sum, which is exactly
// the setup that drifts.
//
// It has already drifted once: the frontend grossed up in a single step and the
// backend added a separately rounded VAT line, which disagreed by 1p on
// floating-point ties (at 25% VAT a £4.10 model displayed £5.13 and charged £5.12).
// Both now work in integer pence. If you change the rounding in either
// `services/vat.ts` or `frontend/src/store/taxStore.ts`, you must change both, and
// this script is what tells you whether you got it right.

import { vatOn, grossOf, vatOnLines, rateFor, taxCountries } from '../src/services/vat'

// ---------------------------------------------------------------------------
// Literal copy of `grossFromNet` / `vatFromNet` in frontend/src/store/taxStore.ts.
// Deliberately duplicated rather than imported: the point is to catch the two
// codebases diverging, so this must be updated by hand to match the frontend.
// ---------------------------------------------------------------------------
const frontendGross = (net: number, rate: number): number => {
  if (!rate || rate <= 0 || !Number.isFinite(net)) return net
  const netPence = Math.round(net * 100)
  return (netPence + Math.round((netPence * rate) / 100)) / 100
}

const frontendVat = (net: number, rate: number): number => {
  if (!rate || rate <= 0 || !Number.isFinite(net)) return 0
  return Math.round((Math.round(net * 100) * rate) / 100) / 100
}

const frontendVatLines = (nets: number[], rate: number): number => {
  if (!rate || rate <= 0) return 0
  const pence = nets.reduce(
    (sum, net) => sum + (Number.isFinite(net) ? Math.round((Math.round(net * 100) * rate) / 100) : 0),
    0,
  )
  return pence / 100
}

const frontendGrossLines = (nets: number[], rate: number): number => {
  const netPence = nets.reduce((sum, net) => sum + (Number.isFinite(net) ? Math.round(net * 100) : 0), 0)
  return (netPence + Math.round(frontendVatLines(nets, rate) * 100)) / 100
}

/** Highest price to test, in pence (£500 covers any realistic basket). */
const MAX_PENCE = 50_000

function main() {
  const countries = taxCountries()
  const failures: string[] = []
  let checked = 0

  for (const { code, rate: listedRate } of countries) {
    const rate = rateFor(code)
    if (rate !== listedRate) {
      failures.push(`rate lookup disagrees with the country list for ${code}: ${rate} vs ${listedRate}`)
    }

    for (let pence = 1; pence <= MAX_PENCE; pence++) {
      const net = pence / 100
      checked++

      const shownGross = frontendGross(net, rate)
      const chargedGross = grossOf(net, code)
      if (Math.abs(shownGross - chargedGross) > 1e-9 && failures.length < 20) {
        failures.push(
          `GROSS ${code} @${rate}% net=£${net.toFixed(2)} shown=£${shownGross.toFixed(2)} charged=£${chargedGross.toFixed(2)}`
        )
      }

      const shownVat = frontendVat(net, rate)
      const chargedVat = vatOn(net, code)
      if (Math.abs(shownVat - chargedVat) > 1e-9 && failures.length < 20) {
        failures.push(
          `VAT ${code} @${rate}% net=£${net.toFixed(2)} shown=£${shownVat.toFixed(2)} charged=£${chargedVat.toFixed(2)}`
        )
      }

      // The breakdown on the checkout panel must add up, or the buyer sees a
      // subtotal and a VAT line that don't reach the total they're asked to pay.
      if (Math.abs(net + chargedVat - chargedGross) > 1e-9 && failures.length < 20) {
        failures.push(
          `BREAKDOWN ${code} @${rate}% net=£${net.toFixed(2)} + vat=£${chargedVat.toFixed(2)} != total=£${chargedGross.toFixed(2)}`
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Baskets. The cart renders a gross price per line and one total; if the total
  // isn't the sum of those lines the buyer sees a basket that doesn't add up. This
  // regressed once already: per-line gross £5.13 + £0.73 = £5.86 against a
  // tax-on-subtotal total of £5.85.
  // ---------------------------------------------------------------------------
  let baskets = 0
  for (const { code } of countries) {
    const rate = rateFor(code)
    for (let seed = 1; seed <= 4000; seed++) {
      // Deterministic pseudo-random baskets of 1–5 lines, £0.01–£99.99.
      const lines: number[] = []
      let x = seed * 2654435761
      const n = (x % 5) + 1
      for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff
        lines.push(((x % 9999) + 1) / 100)
      }
      baskets++

      const shownTotal = frontendGrossLines(lines, rate)
      const netSum = lines.reduce((s, v) => s + Math.round(v * 100), 0) / 100
      const chargedTax = vatOnLines(lines, code)
      const chargedTotal = Math.round((netSum + chargedTax) * 100) / 100

      if (Math.abs(shownTotal - chargedTotal) > 1e-9 && failures.length < 20) {
        failures.push(`BASKET ${code} @${rate}% lines=[${lines.map((l) => l.toFixed(2)).join(', ')}] shown=£${shownTotal.toFixed(2)} charged=£${chargedTotal.toFixed(2)}`)
      }

      // And the total must equal the sum of the gross prices printed on each line.
      const sumOfShownLines = Math.round(lines.reduce((s, l) => s + Math.round(frontendGross(l, rate) * 100), 0)) / 100
      if (Math.abs(sumOfShownLines - shownTotal) > 1e-9 && failures.length < 20) {
        failures.push(`LINES-SUM ${code} @${rate}% lines=[${lines.map((l) => l.toFixed(2)).join(', ')}] linesAddTo=£${sumOfShownLines.toFixed(2)} totalShown=£${shownTotal.toFixed(2)}`)
      }
    }
  }

  console.log(
    `Checked ${checked.toLocaleString()} price/country combinations across ${countries.length} countries (£0.01–£${(MAX_PENCE / 100).toFixed(0)}), plus ${baskets.toLocaleString()} multi-line baskets.`
  )

  if (failures.length) {
    console.error(`\nFAILED — ${failures.length} mismatch(es):`)
    failures.forEach((f) => console.error('  ' + f))
    process.exit(1)
  }

  console.log('PASS — displayed price always equals charged price, and every VAT breakdown reconciles.')
}

main()
