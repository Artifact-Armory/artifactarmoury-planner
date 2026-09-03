// backend/src/services/modelIngest/isolatedChild.ts
//
// The disposable child process that isolatedRunner.ts forks. Deliberately
// minimal — it only imports the pure STL parsing/analysis functions (no DB,
// no R2 client needed beyond what fileProcessor already pulls in), because
// its only job is to do the memory-heavy parse of ONE file and report back.
// See isolatedRunner.ts for why this exists.
//
// Never run this file directly — it does nothing without a parent that sends
// it a task over the IPC channel `fork()` sets up.

import { processSTL } from '../fileProcessor';
import { computeGeometryFingerprint } from '../fingerprint';
import { analyzeMeshQuality } from '../meshQA';

type Task =
  | { task: 'fingerprint'; stlPath: string }
  | { task: 'analyze'; stlPath: string; includeMeshQA: boolean };

process.on('message', async (msg: Task) => {
  let result: any;
  try {
    if (msg.task === 'fingerprint') {
      const fingerprint = await computeGeometryFingerprint(msg.stlPath);
      result = { ok: true, fingerprint };
    } else {
      // Sequential, not Promise.all — each call independently parses the
      // whole file, so running them concurrently would hold two full parsed
      // copies in memory at once, exactly what this process exists to avoid.
      const stlData = await processSTL(msg.stlPath);
      const meshQA = msg.includeMeshQA ? await analyzeMeshQuality(msg.stlPath) : undefined;
      result = { ok: true, stlData, meshQA };
    }
  } catch (err: any) {
    result = { ok: false, reason: (err?.message || String(err)).slice(0, 500) };
  }
  // process.send + immediate process.exit can drop the message if the IPC
  // pipe hasn't flushed yet — exit only inside the send callback.
  if (process.send) {
    process.send(result, () => process.exit(result.ok ? 0 : 1));
  } else {
    process.exit(1);
  }
});
