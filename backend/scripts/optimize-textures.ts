// backend/scripts/optimize-textures.ts
//
// Convert the table-surface PBR maps to WebP and downscale to a max dimension,
// cutting download size ~5–10× (the big offenders are the uncompressed normal
// PNGs). Reads a folder of material subfolders and writes a mirror tree of .webp.
//
// Input layout (one subfolder per material):
//   <src>/<material>/albedo.(jpg|png)   sRGB colour  → lossy webp
//   <src>/<material>/normal.(png|jpg)   normal map   → high-quality webp
//   <src>/<material>/arm.(jpg|png)      AO/Rough/Met → high-quality webp
//
// Output:
//   <dest>/<material>/{albedo,normal,arm}.webp
//
// Usage:
//   npm run optimize:textures -- [srcDir] [destDir] [maxSize]
// Defaults:
//   src = C:\texture-staging\out   dest = C:\texture-staging\web   maxSize = 1024
//
// After it runs, upload the dest folder:
//   npm run upload:r2 -- C:\texture-staging\web textures --force

import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'

// Per-map WebP quality. Normal/ARM carry data (not just colour) so keep them
// higher to avoid lighting artifacts; albedo tolerates more compression.
const QUALITY: Record<string, number> = { albedo: 82, normal: 92, arm: 90 }
const MAP_NAMES = ['albedo', 'normal', 'arm'] as const

async function findMap(dir: string, base: string): Promise<string | null> {
  for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
    const p = path.join(dir, base + ext)
    try { await fs.access(p); return p } catch { /* keep looking */ }
  }
  return null
}

function fmtKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`
}

async function main() {
  const args = process.argv.slice(2)
  const src = path.resolve(args[0] ?? 'C:\\texture-staging\\out')
  const dest = path.resolve(args[1] ?? 'C:\\texture-staging\\web')
  const maxSize = Number(args[2] ?? 1024)

  let materials: string[]
  try {
    materials = (await fs.readdir(src, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    console.error(`Source folder not found: ${src}`)
    process.exit(1)
  }
  if (!materials.length) {
    console.error(`No material subfolders in ${src}`)
    process.exit(1)
  }

  console.log(`Optimizing ${materials.length} material(s): ${src}  →  ${dest}  (max ${maxSize}px, WebP)\n`)

  let before = 0, after = 0, wrote = 0, missing = 0
  for (const material of materials) {
    const inDir = path.join(src, material)
    const outDir = path.join(dest, material)
    await fs.mkdir(outDir, { recursive: true })

    for (const name of MAP_NAMES) {
      const srcPath = await findMap(inDir, name)
      if (!srcPath) {
        console.log(`  ${material}/${name}: (none — skipped)`)
        missing++
        continue
      }
      const srcBytes = (await fs.stat(srcPath)).size
      const outPath = path.join(outDir, `${name}.webp`)
      await sharp(srcPath)
        .resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY[name], effort: 5 })
        .toFile(outPath)
      const outBytes = (await fs.stat(outPath)).size
      before += srcBytes
      after += outBytes
      wrote++
      const pct = ((1 - outBytes / srcBytes) * 100).toFixed(0)
      console.log(`  ${material}/${name}: ${fmtKB(srcBytes)} → ${fmtKB(outBytes)}  (-${pct}%)`)
    }
  }

  console.log(
    `\nDone: ${wrote} written${missing ? `, ${missing} missing` : ''}. ` +
    `Total ${fmtKB(before)} → ${fmtKB(after)} (-${((1 - after / before) * 100).toFixed(0)}%).`,
  )
  console.log(`\nNext: npm run upload:r2 -- ${dest} textures --force`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
