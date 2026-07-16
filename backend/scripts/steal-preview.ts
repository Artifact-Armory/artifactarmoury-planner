// backend/scripts/steal-preview.ts
//
// RED-TEAM TOOL — play the thief against our own anti-theft preview.
//
// Given a published model id, this does exactly what a real ripper would do:
// downloads the public planner preview GLB (no login, no purchase), then answers
// the only question that matters — "is the STOLEN geometry printable, or a blob?"
//
// A 3D printer prints GEOMETRY and ignores TEXTURES. The proxy-bake defence hides
// all the visible detail in a normal-map image wrapped on a smooth low-poly shell.
// So this tool:
//   1. reports the proxy triangle count (how decimated the shape is),
//   2. lists the textures and which are normal/occlusion (the detail a printer drops),
//   3. exports geometry-only STL — literally what the thief could send to a slicer.
//
// Open the exported .stl in Cura/PrusaSlicer/Blender: if it's a smooth, detail-less
// shell, the defence works — the ripped file is useless to print.
//
// Usage:
//   railway run npm run steal:preview -- <modelId> [apiBaseUrl]
//   (apiBaseUrl defaults to the production backend)

import { promises as fsp } from 'fs';
import path from 'path';

// @gltf-transform/* is ESM-only; the CommonJS build imports it dynamically
// (same shim used in services/bake.ts and fileProcessor.ts).
const importESM = new Function('s', 'return import(s)') as <T = any>(s: string) => Promise<T>;

const DEFAULT_API = 'https://confident-purpose-production-3e3f.up.railway.app';

/** Multiply a glTF column-major mat4 (length 16) by a point. */
function applyMatrix(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function sub(a: number[], b: number[]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v: number[]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

async function main() {
  const modelId = process.argv[2];
  const apiBase = (process.argv[3] || DEFAULT_API).replace(/\/$/, '');
  if (!modelId) {
    console.error('Usage: railway run npm run steal:preview -- <modelId> [apiBaseUrl]');
    process.exit(1);
  }

  const url = `${apiBase}/api/models/${modelId}/preview.glb`;
  console.log(`\n[thief] GET ${url}  (no auth, no purchase)`);
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`[thief] Failed: HTTP ${resp.status} ${resp.statusText}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  console.log(`[thief] Ripped ${(bytes.byteLength / 1024).toFixed(0)} KB of GLB.\n`);

  const { NodeIO } = await importESM<typeof import('@gltf-transform/core')>('@gltf-transform/core');
  const { KHRDracoMeshCompression } = await importESM<typeof import('@gltf-transform/extensions')>(
    '@gltf-transform/extensions',
  );
  const draco3dMod: any = await importESM('draco3dgltf');
  const draco3d = draco3dMod.default ?? draco3dMod;

  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule() });

  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();

  // --- Collect world-space triangles across every mesh node ---
  const tris: Array<[number[], number[], number[]]> = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let wm: number[];
    try {
      wm = node.getWorldMatrix() as unknown as number[];
    } catch {
      wm = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const idxAcc = prim.getIndices();
      const count = idxAcc ? idxAcc.getCount() : pos.getCount();
      const el = [0, 0, 0];
      const getPos = (i: number): [number, number, number] => {
        pos.getElement(i, el);
        return applyMatrix(wm, el[0], el[1], el[2]);
      };
      const idxOf = (i: number): number =>
        idxAcc ? (idxAcc.getElement(i, [0]) as number[])[0] : i;
      for (let i = 0; i + 2 < count; i += 3) {
        tris.push([getPos(idxOf(i)), getPos(idxOf(i + 1)), getPos(idxOf(i + 2))]);
      }
    }
  }

  // --- Report what the detail is made of ---
  console.log('=== STOLEN PREVIEW — printability report ===');
  console.log(`Proxy triangles (what a printer would use): ${tris.length.toLocaleString()}`);

  const textures = root.listTextures();
  const slotOf = new Map<any, string>();
  for (const mat of root.listMaterials()) {
    if (mat.getNormalTexture()) slotOf.set(mat.getNormalTexture(), 'NORMAL (fake detail — printer ignores)');
    if (mat.getOcclusionTexture()) slotOf.set(mat.getOcclusionTexture(), 'OCCLUSION (shading — printer ignores)');
    if (mat.getBaseColorTexture()) slotOf.set(mat.getBaseColorTexture(), 'BASE COLOR (printer ignores)');
  }
  console.log(`Textures embedded: ${textures.length}`);
  for (const t of textures) {
    const size = t.getSize();
    const bytesLen = t.getImage()?.byteLength ?? 0;
    console.log(
      `  - ${slotOf.get(t) ?? 'unknown slot'} · ${size ? `${size[0]}x${size[1]}` : '?'} · ${(bytesLen / 1024).toFixed(0)} KB`,
    );
  }

  // --- Export geometry-only STL (drop this in a slicer to judge the print) ---
  const header = Buffer.alloc(80);
  header.write('STOLEN PROXY - geometry only (no baked detail)', 'ascii');
  const body = Buffer.alloc(4 + tris.length * 50);
  body.writeUInt32LE(tris.length, 0);
  let off = 4;
  for (const [a, b, c] of tris) {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    body.writeFloatLE(n[0], off); body.writeFloatLE(n[1], off + 4); body.writeFloatLE(n[2], off + 8);
    body.writeFloatLE(a[0], off + 12); body.writeFloatLE(a[1], off + 16); body.writeFloatLE(a[2], off + 20);
    body.writeFloatLE(b[0], off + 24); body.writeFloatLE(b[1], off + 28); body.writeFloatLE(b[2], off + 32);
    body.writeFloatLE(c[0], off + 36); body.writeFloatLE(c[1], off + 40); body.writeFloatLE(c[2], off + 44);
    off += 50; // + 2-byte attribute count left as 0
  }
  const outPath = path.resolve(process.cwd(), `stolen-${modelId}.stl`);
  await fsp.writeFile(outPath, Buffer.concat([header, body]));

  console.log(`\nGeometry-only STL written: ${outPath}`);
  console.log('Open it in a slicer or Blender. Smooth, detail-less shell = defence works.');
  console.log('If the fine detail (rivets/panel lines) is GONE from the mesh, it lives only');
  console.log('in the normal-map image above — which a printer discards. The rip is useless.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
