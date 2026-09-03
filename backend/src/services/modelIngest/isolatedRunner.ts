// backend/src/services/modelIngest/isolatedRunner.ts
//
// A single dense STL can OOM-kill the whole ingest worker while being parsed:
// parseSTL (fileProcessor.ts) builds a full JS object graph per triangle, and
// a genuine V8 "JavaScript heap out of memory" abort cannot be caught with
// try/catch — it kills the entire process, mid-job, taking every other part
// of whatever it was processing down with it.
//
// Incident that motivated this (2026-09-03, "Japanese houses" upload): one
// part's file was 220MB / ~4.6M triangles — under MAX_INGEST_TRIANGLES, so it
// passed that guard, then OOM-crashed the worker while actually being parsed.
// The queue's stale-lock reclaim retried the job 3 times; every attempt
// restarted from part 1 and died at the exact same file, permanently
// stranding the job at status='running' with no notification to the artist —
// see process.ts's file-header comment, which already flagged "the process
// itself crashing (e.g. OOM) mid-call" as the one failure mode nothing
// handles cleanly.
//
// The fix: run the actual parse in a disposable CHILD process. If the child
// OOMs, only the child dies — each Node process has its own V8 isolate/heap,
// so the parent (this worker, mid-ingest-job) is unaffected and can report a
// clean, specific failure for that one file instead of taking the whole job
// (and its retries) down with it.
import { fork, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from '../../utils/logger';
import type { GeometryFingerprint } from '../fingerprint';
import type { MeshQAReport } from '../meshQA';

const CHILD_TIMEOUT_MS = 5 * 60 * 1000; // generous — a hang is as bad as a crash

const OOM_REASON =
  'This file is too large or complex to process — it ran out of memory during analysis. ' +
  'Try reducing its triangle count or splitting it into smaller pieces, then re-upload.';

// dist/services/modelIngest/isolatedChild.js next to this compiled file in
// production; the .ts source directly under ts-node in dev (fork() needs an
// execArgv that can load it, since it always spawns a fresh `node`, not the
// running ts-node interpreter).
const isDev = __filename.endsWith('.ts');
const CHILD_SCRIPT = path.join(__dirname, isDev ? 'isolatedChild.ts' : 'isolatedChild.js');
const CHILD_EXEC_ARGV = isDev ? ['-r', 'ts-node/register/transpile-only'] : [];

export interface FingerprintOk { ok: true; fingerprint: GeometryFingerprint }
export interface AnalyzeOk {
  ok: true;
  stlData: { volume: number; surfaceArea: number; dimensions: { x: number; y: number; z: number }; needsSupports: boolean };
  meshQA?: MeshQAReport;
}
export interface IsolatedFailure { ok: false; reason: string }

// A plain `if (!x.ok)` doesn't reliably narrow this discriminated union with
// strictNullChecks off (this project's tsconfig) — use this instead.
export function isIsolatedFailure(r: { ok: boolean }): r is IsolatedFailure {
  return r.ok === false;
}

type Task =
  | { task: 'fingerprint'; stlPath: string }
  | { task: 'analyze'; stlPath: string; includeMeshQA: boolean };

function runChildTask<T extends { ok: boolean }>(msg: Task): Promise<T | IsolatedFailure> {
  return new Promise((resolve) => {
    if (!fs.existsSync(CHILD_SCRIPT)) {
      // Compiled output missing (e.g. a fresh checkout that hasn't run `npm
      // run build` yet) — fail loudly and specifically rather than silently
      // falling back to the unprotected in-process path.
      resolve({ ok: false, reason: 'Internal error: isolated analysis worker is not built.' });
      return;
    }

    let settled = false;
    const child: ChildProcess = fork(CHILD_SCRIPT, [], { execArgv: [...CHILD_EXEC_ARGV, ...process.execArgv] });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({
        ok: false,
        reason: 'Timed out while analysing this file (over 5 minutes) — it may be too large or complex to process.',
      });
    }, CHILD_TIMEOUT_MS);

    child.once('message', (result: T | IsolatedFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    });

    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logger.error('Isolated STL analysis child died without a result — likely out of memory', {
        code,
        signal,
        task: msg.task,
        stlPath: msg.stlPath,
      });
      resolve({ ok: false, reason: OOM_REASON });
    });

    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logger.error('Isolated STL analysis child failed to start', { error: err, task: msg.task });
      resolve({ ok: false, reason: 'Could not analyse this file.' });
    });

    child.send(msg);
  });
}

/** Fingerprint one STL file in an isolated child process. */
export async function isolatedFingerprint(stlPath: string): Promise<FingerprintOk | IsolatedFailure> {
  return runChildTask<FingerprintOk>({ task: 'fingerprint', stlPath });
}

/** Run processSTL (dims/volume/etc.), optionally + mesh QA, in an isolated child process. */
export async function isolatedStlAnalysis(
  stlPath: string,
  opts: { includeMeshQA: boolean },
): Promise<AnalyzeOk | IsolatedFailure> {
  return runChildTask<AnalyzeOk>({ task: 'analyze', stlPath, includeMeshQA: opts.includeMeshQA });
}
