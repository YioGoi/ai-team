import { open } from 'node:fs/promises';
import type { RunState, ValidationResult } from '../domain/state.js';
import { TeamError } from '../domain/schemas.js';
import { safePath, sensitive } from '../workspace/git.js';
import { redact } from '../process/supervisor.js';

export function currentValidations(state: RunState): ValidationResult[] {
  const latest = new Map<string, ValidationResult>();
  for (const v of state.validations)
    if (v.candidateSha === state.candidateSha) latest.set(v.commandId, v);
  return [...latest.values()];
}

/** Runtime logs are evidence, never candidate source paths or command authority. */
export async function validationEvidence(
  directory: string,
  state: RunState,
  byteBudget: number,
): Promise<Record<string, unknown>> {
  const evidence: Record<string, unknown> = {};
  let remaining = Math.max(0, byteBudget);
  for (const v of currentValidations(state).sort(
    (a, b) => Number(a.exitCode === 0) - Number(b.exitCode === 0),
  )) {
    if (v.logPath !== `validation/${v.id}/output.log`)
      throw new TeamError('STATE_CORRUPT', 'Validator log path differs from its recorded identity');
    const path = await safePath(directory, v.logPath);
    const file = await open(path, 'r');
    try {
      const size = (await file.stat()).size;
      const allowance = Math.min(8192, remaining);
      const take = Math.min(size, allowance);
      const head = Buffer.alloc(Math.ceil(take / 2));
      const tail = Buffer.alloc(Math.floor(take / 2));
      const a = await file.read(head, 0, head.length, 0);
      const b = await file.read(
        tail,
        0,
        tail.length,
        size > take ? size - tail.length : head.length,
      );
      const truncated = size > take;
      const outputExcerpt = redact(
        head.subarray(0, a.bytesRead).toString('utf8') +
          (truncated ? '\n[output omitted between head and tail]\n' : '') +
          tail.subarray(0, b.bytesRead).toString('utf8'),
      );
      remaining -= take;
      evidence[`validation:${v.id}`] = {
        ...v,
        outputExcerpt,
        outputTruncated: truncated,
        outputBytes: size,
      };
    } finally {
      await file.close();
    }
  }
  return evidence;
}

export async function requestedSourcePaths(
  state: RunState,
  workspace: string,
  requested: string[],
): Promise<string[]> {
  const current = currentValidations(state);
  const source: string[] = [];
  for (const path of requested) {
    if (current.some((v) => v.logPath === path)) continue; // Already supplied through validation:<id>, from runtime storage.
    if (path.startsWith('validation/') || state.validations.some((v) => v.logPath === path))
      throw new TeamError('PERMISSION_DENIED', 'Unknown or stale validator context');
    if (sensitive(path))
      throw new TeamError('PERMISSION_DENIED', 'Requested secret/protected context');
    await safePath(workspace, path);
    source.push(path);
  }
  return source;
}
