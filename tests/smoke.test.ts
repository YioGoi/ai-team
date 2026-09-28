import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startRun } from '../src/orchestration/engine.js';
import { mockAdapter } from '../src/providers/mock.js';
import { treeSnapshot } from '../src/workspace/git.js';
import { createFixture } from './fixture.js';
import { assertOracle } from './oracle.js';
const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
it('actual separate workers modify fixture, pass required checks and independent fixed oracle (T-02/06/34)', async () => {
  const fixture = await createFixture();
  const original = await treeSnapshot(fixture.repo);
  const run = await startRun(
    fixture.config,
    markdown,
    { mock: mockAdapter(join(assets, 'mock-worker.mjs')) },
    { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets },
  );
  expect(run.state.reason).not.toContain('INVALID');
  expect(run.state.status, run.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(run.state.mode).toBe('SIMULATION');
  expect(run.state.invocations).toHaveLength(5);
  expect(new Set(run.state.invocations.map((i) => i.processId)).size).toBe(5);
  expect(run.state.invocations.map((i) => i.role)).toEqual([
    'architect',
    'qa',
    'implementer',
    'reviewer',
    'qa',
  ]);
  await assertOracle(run.workspace.implementation, run.state.baseSha);
  const after = await treeSnapshot(fixture.repo);
  expect(after.head).toBe(original.head);
  expect(after.digest).toBe(original.digest);
  expect(await readFile(join(run.directory, 'artifacts/candidate.patch'), 'utf8')).toContain(
    'replace',
  );
  expect(await readFile(join(run.directory, 'artifacts/HANDOFF.md'), 'utf8')).toContain(
    'SIMULATION',
  );
}, 30000);
it('lying mock without edits cannot pass the independent external oracle (T-34)', async () => {
  const fixture = await createFixture();
  const run = await startRun(
    fixture.config,
    markdown,
    { mock: mockAdapter(join(assets, 'mock-worker.mjs'), 'lying') },
    { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets },
  );
  // Models and incomplete baseline validators can lie together. The fixed external harness must still fail.
  await expect(assertOracle(run.workspace.implementation, run.state.baseSha)).rejects.toThrow();
}, 30000);
