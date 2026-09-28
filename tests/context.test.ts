import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { startRun } from '../src/orchestration/engine.js';
import { requestedSourcePaths, validationEvidence } from '../src/orchestration/evidence.js';
import { resumeRun } from '../src/application/services.js';
import { contextRepairToReconcile } from '../src/application/context-recovery.js';
import type { ValidationResult } from '../src/domain/state.js';
import { mockAdapter } from '../src/providers/mock.js';
import { createFixture } from './fixture.js';
import { apply, created } from './helpers.js';
const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = (
  await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8')
).replace('"expectedBaselineFailures": []', '"expectedBaselineFailures": ["unit"]');
const options = { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets };
const adapters = (scenario: string) => ({
  mock: mockAdapter(join(assets, 'mock-worker.mjs'), scenario),
});
async function failureFixture() {
  const f = await createFixture();
  f.config.validators.find((v) => v.id === 'unit')!.args = [
    '-e',
    `const fs=require('node:fs');if(!fs.readFileSync('tests/normalizeTitle.test.ts','utf8').includes('evidence-guided regression')){process.stderr.write('Missing evidence-guided regression');process.exit(7)}require('node:child_process').execFileSync(process.execPath,['--test','build/tests/normalizeTitle.test.js'],{stdio:'inherit'});`,
  ];
  return f;
}
it('bounded current validator excerpts include failure head/tail and reject stale/escaping logs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ai-team evidence '));
  const state = apply(undefined, created());
  const v: ValidationResult = {
    id: 'validation-current',
    commandId: 'unit',
    commandHash: 'hash',
    candidateSha: state.candidateSha,
    argv: [],
    cwd: '.',
    startedAt: '',
    endedAt: '',
    exitCode: 1,
    signal: null,
    timedOut: false,
    outputLimited: false,
    cancelled: false,
    terminationConfirmed: true,
    logPath: 'validation/validation-current/output.log',
  };
  state.validations = [
    {
      ...v,
      id: 'validation-old',
      candidateSha: 'old',
      logPath: 'validation/validation-old/output.log',
    },
    v,
  ];
  await mkdir(join(directory, 'validation/validation-current'), { recursive: true });
  const log =
    'FAILURE HEAD password=private-example-value\n' + 'x'.repeat(20000) + '\nFAILURE TAIL';
  await writeFile(join(directory, v.logPath), log);
  const evidence = await validationEvidence(directory, state, 1000);
  expect(Object.keys(evidence)).toEqual(['validation:validation-current']);
  expect(evidence['validation:validation-current']).toMatchObject({
    exitCode: 1,
    outputTruncated: true,
  });
  const excerpt = (evidence['validation:validation-current'] as { outputExcerpt: string })
    .outputExcerpt;
  expect(excerpt).toContain('FAILURE HEAD');
  expect(excerpt).toContain('[REDACTED]');
  expect(excerpt).not.toContain('private-example-value');
  expect(excerpt).toContain('FAILURE TAIL');
  expect(Buffer.byteLength(excerpt)).toBeLessThan(1100);
  expect(await requestedSourcePaths(state, directory, [v.logPath])).toEqual([]);
  await expect(
    requestedSourcePaths(state, directory, ['validation/validation-old/output.log']),
  ).rejects.toThrow('stale');
  await expect(requestedSourcePaths(state, directory, ['.env'])).rejects.toThrow('secret');
  const escaped = await mkdtemp(join(tmpdir(), 'ai-team outside evidence '));
  await writeFile(join(escaped, 'output.log'), 'outside');
  await symlink(escaped, join(directory, 'validation/validation-escape'));
  state.validations = [
    { ...v, id: 'validation-escape', logPath: 'validation/validation-escape/output.log' },
  ];
  await expect(validationEvidence(directory, state, 1000)).rejects.toThrow('Escaping symlink');
});
it('real failed-command output reaches a repair writer; role instructions stay distinct', async () => {
  const f = await failureFixture();
  const run = await startRun(f.config, markdown, adapters('repair-evidence'), options);
  expect(run.state.status, run.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(run.state.invocations).toHaveLength(6);
  expect(run.state.issues[0]!.reservationIds).toHaveLength(1);
  for (const call of run.state.invocations) {
    const packet = JSON.parse(
      await readFile(join(run.directory, 'invocations', call.id, 'request.json'), 'utf8'),
    );
    const instructions: string = packet.context.instructions;
    if (call.role === 'implementer') {
      expect(instructions).toContain('editing permission is explicit');
      expect(instructions).not.toContain('QA mode:');
      expect(instructions).not.toContain('Reviewer mode:');
    }
    if (call.role === 'qa') {
      expect(instructions).toContain('QA mode:');
      expect(instructions).not.toContain('Reviewer mode:');
    }
    if (call.role === 'reviewer') {
      expect(instructions).toContain('Reviewer mode:');
      expect(instructions).not.toContain('QA mode:');
    }
  }
}, 30000);
it('explicit reconciliation preserves two credits and uses the third in round4 on the same run', async () => {
  const f = await failureFixture();
  const bindings = adapters('repair-evidence-context');
  const blocked = await startRun(f.config, markdown, bindings, options);
  expect(blocked.state.status).toBe('BLOCKED');
  expect(blocked.state.reason).toContain('Repair context refill requires human reconciliation');
  expect(blocked.state.invocations).toHaveLength(5);
  expect(blocked.state.issues[0]!.reservationIds).toHaveLength(2);
  expect(contextRepairToReconcile(blocked.state).id).toBe(blocked.state.invocations.at(-1)!.id);
  await expect(resumeRun(blocked.state.runId, options, bindings, f.home)).rejects.toThrow(
    'Human reconciliation',
  );
  for (const change of [
    'round',
    'credits',
    'pending',
    'uncertain',
    'changed',
    'stale',
    'unrelated',
  ]) {
    const s = structuredClone(blocked.state);
    if (change === 'round') s.rounds.normalize = s.invocations.at(-1)!.round = 4;
    if (change === 'credits') s.issues[0]!.reservationIds.push('third-credit');
    if (change === 'pending') s.pendingCommands.push('pending');
    if (change === 'uncertain') s.invocations.at(-1)!.state = 'uncertain';
    if (change === 'changed') {
      const last = s.results.at(-1)!;
      if (last.role === 'implementer')
        last.payload.declaredChangedPaths.push('src/normalizeTitle.ts');
    }
    if (change === 'stale') s.invocations.at(-1)!.basisSha = 'stale';
    if (change === 'unrelated') s.reason = 'INPUT_CHANGED: human changed candidate';
    expect(() => contextRepairToReconcile(s), change).toThrow();
  }
  const inputs = await readFile(join(blocked.directory, 'inputs/manifest.json'), 'utf8');
  const resumed = await resumeRun(
    blocked.state.runId,
    { ...options, reconcileContext: true },
    bindings,
    f.home,
  );
  expect(resumed.state.status, resumed.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(resumed.state.runId).toBe(blocked.state.runId);
  expect(resumed.state.invocations).toHaveLength(8);
  expect(resumed.state.rounds.normalize).toBe(4);
  expect(resumed.state.issues[0]!.id).toBe(blocked.state.issues[0]!.id);
  expect(resumed.state.issues[0]!.reservationIds).toHaveLength(3);
  expect(resumed.state.issues[0]!.reservationIds.slice(0, 2)).toEqual(
    blocked.state.issues[0]!.reservationIds,
  );
  expect(await readFile(join(blocked.directory, 'inputs/manifest.json'), 'utf8')).toBe(inputs);
  const { assertOracle } = await import('./oracle.js');
  await assertOracle(resumed.workspace.implementation, resumed.state.baseSha);
}, 60000);

it.each(['candidate', 'snapshot'])(
  'context reconciliation rejects changed %s without another worker',
  async (change) => {
    const f = await failureFixture();
    const bindings = adapters('repair-evidence-context');
    const blocked = await startRun(f.config, markdown, bindings, options);
    expect(blocked.state.status).toBe('BLOCKED');
    const path =
      change === 'candidate'
        ? join(blocked.workspace.implementation, 'src/normalizeTitle.ts')
        : join(blocked.directory, 'inputs/task.md');
    const edit = (await readFile(path, 'utf8')) + '\n// explicit human edit\n';
    await writeFile(path, edit);
    await expect(
      resumeRun(blocked.state.runId, { ...options, reconcileContext: true }, bindings, f.home),
    ).rejects.toMatchObject({
      code: 'INPUT_CHANGED',
      message:
        change === 'candidate'
          ? 'Candidate has unverified changes; preserve them for human reconciliation'
          : 'Internal input snapshots changed',
    });
    expect(await readFile(path, 'utf8')).toBe(edit);
    const { readRun } = await import('../src/application/services.js');
    const after = (await readRun(blocked.state.runId, f.home)).state;
    expect(after.invocations).toHaveLength(5);
    expect(after.issues[0]!.reservationIds).toEqual(blocked.state.issues[0]!.reservationIds);
  },
  45000,
);
