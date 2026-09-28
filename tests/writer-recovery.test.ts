import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { startRun } from '../src/orchestration/engine.js';
import { readRun, resumeRun, writerRecoveryStatus } from '../src/application/services.js';
import { interruptedWriter, reduce } from '../src/domain/state.js';
import type { RunState } from '../src/domain/state.js';
import { parseCli } from '../src/cli.js';
import { hash } from '../src/persistence/journal.js';
import { mockAdapter } from '../src/providers/mock.js';
import { git, treeSnapshot } from '../src/workspace/git.js';
import { createFixture, patchSource } from './fixture.js';
import { assertOracle } from './oracle.js';

const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
const options = { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets };
const normal = { mock: mockAdapter(join(assets, 'mock-worker.mjs')) };
async function interruptedFixture() {
  const f = await createFixture();
  f.config.limits.maxStderrBytesPerInvocation = 1024;
  const adapter = mockAdapter(join(assets, 'mock-worker.mjs'));
  const ordinary = adapter.buildInvocation;
  adapter.buildInvocation = (request) => {
    const spec = ordinary(request);
    if (request.role !== 'implementer') return spec;
    // Real owned subprocess edits source, then floods stderr before returning a role result.
    const code = `const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{
      fs.writeFileSync('src/normalizeTitle.ts',${JSON.stringify(patchSource)});
      process.stderr.write('x'.repeat(4096));setInterval(()=>{},1000);
    });`;
    return { ...spec, args: ['-e', code] };
  };
  const taskPath = join(f.root, 'task.md');
  const configPath = join(f.root, 'config.json');
  await writeFile(taskPath, markdown);
  const configText = JSON.stringify(f.config);
  await writeFile(configPath, configText);
  const run = await startRun(
    f.config,
    markdown,
    { mock: adapter },
    {
      ...options,
      inputOrigins: {
        taskPath,
        configPath,
        taskHash: hash(markdown),
        configHash: hash(configText),
      },
    },
  );
  expect(run.state.status, run.state.reason).toBe('BLOCKED');
  expect(run.state.reason).toBe('OUTPUT_LIMIT: Worker output cap exceeded');
  expect(run.state.invocations).toHaveLength(3);
  return { f, run };
}

it('explicit recovery preserves the interrupted writer and requires fresh same-candidate review', async () => {
  const { f, run } = await interruptedFixture();
  const journalBefore = await readFile(join(run.directory, 'events.jsonl'), 'utf8');
  const manifestBefore = await readFile(join(run.directory, 'inputs/manifest.json'), 'utf8');
  const sourceBefore = await treeSnapshot(f.repo);
  await writeFile(
    join(f.root, 'task.md'),
    'External human note changed; frozen task stays authoritative',
  );
  const report = await writerRecoveryStatus(run.state.runId, f.home);
  expect(report.changedPaths).toEqual(['src/normalizeTitle.ts']);
  expect(report.reviewToken).toMatch(/^[a-f0-9]{64}$/u);
  expect(await readFile(join(run.directory, 'events.jsonl'), 'utf8')).toBe(journalBefore);
  await expect(resumeRun(run.state.runId, options, normal, f.home)).rejects.toMatchObject({
    code: 'PERMISSION_DENIED',
  });
  const resumed = await resumeRun(
    run.state.runId,
    { ...options, reconcileWriter: report.reviewToken },
    normal,
    f.home,
  );
  expect(resumed.state.status, resumed.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(resumed.state.runId).toBe(run.state.runId);
  expect(resumed.state.invocations.slice(0, 3)).toEqual(run.state.invocations);
  expect(resumed.state.invocations).toHaveLength(5);
  expect(resumed.state.rounds).toEqual(run.state.rounds);
  expect(resumed.state.config).toEqual(run.state.config);
  expect(resumed.state.notices.some((n) => n.startsWith('External task'))).toBe(true);
  expect(resumed.state.results.some((r) => r.invocationId === run.state.invocations[2]!.id)).toBe(
    false,
  );
  expect(resumed.state.invocations.slice(3).map((i) => i.role)).toEqual(['reviewer', 'qa']);
  expect(
    resumed.state.results.slice(-2).every((r) => r.basisSha === resumed.state.candidateSha),
  ).toBe(true);
  expect(
    resumed.state.validations.filter((v) => v.candidateSha === resumed.state.candidateSha),
  ).toHaveLength(3);
  const journalAfter = await readFile(join(run.directory, 'events.jsonl'), 'utf8');
  expect(journalAfter.startsWith(journalBefore)).toBe(true);
  expect(journalAfter).toContain('WRITER_RECONCILED');
  expect(await readFile(join(run.directory, 'inputs/manifest.json'), 'utf8')).toBe(manifestBefore);
  expect((await treeSnapshot(f.repo)).digest).toBe(sourceBefore.digest);
  await assertOracle(resumed.workspace.implementation, resumed.state.baseSha);
}, 45000);

it('recovery state rejects uncertain, completed, exhausted and unrelated interruptions', async () => {
  const { run } = await interruptedFixture();
  expect(interruptedWriter(run.state).id).toBe(run.state.invocations.at(-1)!.id);
  const cases: Array<[string, (s: RunState) => void]> = [
    ['pending command', (s) => s.pendingCommands.push('unit')],
    [
      'uncertain exit',
      (s) => {
        s.invocations.at(-1)!.state = 'uncertain';
      },
    ],
    [
      'terminal',
      (s) => {
        s.status = 'READY_FOR_HUMAN_REVIEW';
      },
    ],
    [
      'wrong phase',
      (s) => {
        s.phase = 'REVIEW_QA';
      },
    ],
    [
      'unrelated stop',
      (s) => {
        s.reason = 'SCOPE_VIOLATION: changed source';
      },
    ],
    [
      'wrong basis',
      (s) => {
        s.invocations.at(-1)!.basisSha = 'stale';
      },
    ],
    [
      'fourth round',
      (s) => {
        s.rounds.normalize = s.invocations.at(-1)!.round = 4;
      },
    ],
    [
      'calls',
      (s) => {
        s.config.limits.maxAgentInvocationsPerRun = 4;
      },
    ],
    [
      'active time',
      (s) => {
        s.activeMs = s.config.limits.maxActiveRuntimeMs;
      },
    ],
    [
      'third repair',
      (s) => {
        s.issues.push({
          id: 'issue-exhausted',
          keys: ['failure'],
          title: 'failure',
          severity: 'MAJOR',
          criterionIds: [],
          open: true,
          reservationIds: ['a', 'b', 'c'],
        });
      },
    ],
    [
      'checkpointed',
      (s) => {
        s.steps.push('writer:normalize:1');
      },
    ],
  ];
  for (const [label, change] of cases) {
    const state = structuredClone(run.state);
    change(state);
    expect(() => interruptedWriter(state), label).toThrow();
  }
  const state = structuredClone(run.state);
  state.issues.push({
    id: 'existing-issue',
    keys: ['existing'],
    title: 'prior defect',
    severity: 'MAJOR',
    criterionIds: [],
    open: true,
    reservationIds: ['old-repair'],
  });
  const reportEvent = {
    schemaVersion: 1 as const,
    eventId: 'reconcile-test',
    runId: state.runId,
    seq: state.seq + 1,
    at: new Date().toISOString(),
    payload: {
      type: 'WRITER_RECONCILED' as const,
      invocationId: state.invocations.at(-1)!.id,
      priorSha: state.candidateSha,
      sha: 'candidate',
      digest: 'new-digest',
      reviewToken: 'a'.repeat(64),
      changedPaths: ['src/normalizeTitle.ts'],
    },
  };
  const reconciled = reduce(state, reportEvent);
  expect(reconciled.issues).toEqual(state.issues);
  expect(reconciled.results).toEqual(state.results);
  expect(reconciled.status).toBe('PAUSED');
  expect(reconciled.auditClean).toBe(false);
}, 30000);

it.each([
  'stale token',
  'protected file',
  'snapshot',
  'staged file',
  'source',
  'refs',
  'live process',
])(
  'rejects %s without new workers or discarding edits',
  async (change) => {
    const { f, run } = await interruptedFixture();
    const report = await writerRecoveryStatus(run.state.runId, f.home);
    const source = join(run.workspace.implementation, 'src/normalizeTitle.ts');
    if (change === 'stale token')
      await writeFile(source, (await readFile(source, 'utf8')) + '\n// human edit\n');
    if (change === 'protected file')
      await writeFile(join(run.workspace.implementation, 'package.json'), '{}\n');
    if (change === 'snapshot') await writeFile(join(run.directory, 'inputs/task.md'), 'tampered');
    if (change === 'staged file')
      await git(run.workspace.implementation, ['add', '--', 'src/normalizeTitle.ts']);
    if (change === 'source')
      await writeFile(join(f.repo, 'src/normalizeTitle.ts'), '// human source edit\n');
    if (change === 'refs') await git(f.repo, ['branch', 'unexpected-ref']);
    if (change === 'live process') {
      // Inspection must distrust even a recorded exit when that exact process is still alive.
      const { inspectWriterRecovery } = await import('../src/application/writer-recovery.js');
      const { processIdentity } = await import('../src/process/supervisor.js');
      const state = structuredClone(run.state);
      state.invocations.at(-1)!.processId = process.pid;
      state.invocations.at(-1)!.processIdentity = await processIdentity(process.pid);
      await expect(inspectWriterRecovery(run.directory, state)).rejects.toMatchObject({
        code: 'STATE_CORRUPT',
      });
      return;
    }
    const current = await readFile(source, 'utf8');
    await expect(
      resumeRun(
        run.state.runId,
        { ...options, reconcileWriter: report.reviewToken },
        normal,
        f.home,
      ),
    ).rejects.toBeDefined();
    const after = (await readRun(run.state.runId, f.home)).state;
    expect(after.invocations).toEqual(run.state.invocations);
    expect(after.rounds).toEqual(run.state.rounds);
    expect(await readFile(source, 'utf8')).toBe(current);
    expect((await git(run.workspace.implementation, ['rev-parse', 'HEAD'])).trim()).toBe(
      run.state.candidateSha,
    );
  },
  30000,
);

it('CLI exposes explicit inspection and digest-bound resume without accepting a bare flag', () => {
  expect(parseCli(['status', 'run-example', '--recovery', '--json']).values).toMatchObject({
    recovery: true,
    json: true,
  });
  expect(
    parseCli(['resume', 'run-example', '--reconcile-writer', 'a'.repeat(64)]).values,
  ).toMatchObject({ 'reconcile-writer': 'a'.repeat(64) });
  expect(() => parseCli(['resume', 'run-example', '--reconcile-writer'])).toThrow();
  expect(() => parseCli(['run', '--reconcile-writer', 'a'.repeat(64)])).toThrow();
});
