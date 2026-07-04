// backend/scripts/trace-watermark.ts
//
// Decode the encrypted watermark header of a downloaded STL to reveal which
// buyer / order / model it came from. Must run with the SAME watermark key the
// download used, so run it via the Railway CLI which injects the production env:
//
//   railway run npm run trace:watermark -- "C:\path\to\downloaded.stl"
//
// (Locally it uses backend/.env's WATERMARK_SECRET/JWT_SECRET, which only
// decodes files watermarked with that same local key.)

import { promises as fs } from 'fs'
import 'dotenv/config'
import { readWatermarkHeader } from '../src/services/watermark'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: npm run trace:watermark -- <path-to.stl>')
    process.exit(1)
  }
  const buf = await fs.readFile(file)
  const payload = readWatermarkHeader(buf.subarray(0, 80))
  if (!payload) {
    console.log('No valid Artifact Planner watermark found.')
    console.log('(File is not watermarked, the header was stripped, or the key differs.)')
    return
  }
  console.log('✅ Watermark decoded — this file was issued to:')
  console.log(`   model:  ${payload.modelId}`)
  console.log(`   buyer:  ${payload.buyerId}`)
  console.log(`   order:  ${payload.orderId}  ${payload.orderId === '00000000-0000-0000-0000-000000000000' ? '(artist self-download)' : ''}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
