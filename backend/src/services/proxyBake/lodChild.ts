// backend/src/services/proxyBake/lodChild.ts
//
// Child-process entrypoint for buildPlannerLod — see buildPlannerLodIsolated in
// lod.ts for why it exists. argv[2] is a JSON file holding the inputs; the result
// goes to a JSON file too (not stdout, which the logger shares).

import { promises as fsp } from 'fs'
import { buildPlannerLod } from './lod'

async function main(): Promise<void> {
  const inputPath = process.argv[2]
  const { inGlb, outGlb, cfg, proxyBytes, resultPath } = JSON.parse(
    await fsp.readFile(inputPath, 'utf8'),
  )
  try {
    const result = await buildPlannerLod(inGlb, outGlb, cfg, proxyBytes)
    await fsp.writeFile(resultPath, JSON.stringify({ ok: true, result }))
    process.exit(0)
  } catch (err) {
    await fsp
      .writeFile(resultPath, JSON.stringify({ ok: false, error: String((err as any)?.stack || err) }))
      .catch(() => {})
    process.exit(1)
  }
}

void main()
