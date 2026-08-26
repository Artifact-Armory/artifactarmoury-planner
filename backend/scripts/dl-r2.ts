// One-off: download an R2 object to a local file for inspection.
import 'dotenv/config'
import { promises as fsp } from 'fs'
import { downloadObject } from '../src/services/r2'

async function main() {
  const key = process.argv[2]
  const out = process.argv[3]
  if (!key || !out) {
    console.error('Usage: ts-node scripts/dl-r2.ts <r2-key> <out-path>')
    process.exit(1)
  }
  const buf = await downloadObject(key)
  await fsp.writeFile(out, buf)
  console.log(`Wrote ${buf.length} bytes to ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
