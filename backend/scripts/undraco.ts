// One-off: decode a Draco-compressed GLB and re-export it without Draco, so it
// can be opened by tools (e.g. a minimal Blender pip install) that lack the
// Draco decoder extension.
import draco3d from 'draco3dgltf'

async function main() {
  const inPath = process.argv[2]
  const outPath = process.argv[3]
  if (!inPath || !outPath) {
    console.error('Usage: ts-node scripts/undraco.ts <in.glb> <out.glb>')
    process.exit(1)
  }
  const { NodeIO } = await import('@gltf-transform/core')
  const { KHRDracoMeshCompression } = await import('@gltf-transform/extensions')
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
    })
  const doc = await io.read(inPath)
  // Drop the Draco extension declaration before writing so the output is plain.
  const draco = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_draco_mesh_compression')
  if (draco) draco.dispose()
  await io.write(outPath, doc)
  console.log(`Wrote ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
