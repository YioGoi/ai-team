import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { startRun } from '../src/orchestration/engine.js';
import { mockAdapter } from '../src/providers/mock.js';
import { createFixture } from './fixture.js';
const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
const options = { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets };
const adapters = (scenario = 'normal') => ({
  mock: mockAdapter(join(assets, 'mock-worker.mjs'), scenario),
});
it('global call cap stops actual dispatch before required fifth worker (T-06/33)', async () => {
  const f = await createFixture();
  f.config.limits.maxAgentInvocationsPerRun = 4;
  const result = await startRun(f.config, markdown, adapters(), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('BUDGET_EXHAUSTED');
  expect(result.state.invocations).toHaveLength(4);
}, 30000);
// Six workers and fifteen real validators across four rounds need integration-test headroom.
// The observed full-suite run took48s; this deadline does not change runtime repair limits.
it('four rounds and exactly three repairs stop persistent real validation failure (T-09/11/19/31)', async () => {
  const f = await createFixture();
  f.config.validators.find((v) => v.id === 'unit')!.args = ['-e', 'process.exit(3)'];
  const task = markdown.replace(
    '"expectedBaselineFailures": []',
    '"expectedBaselineFailures": ["unit"]',
  );
  const result = await startRun(f.config, task, adapters(), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('budget exhausted');
  expect(result.state.rounds.normalize).toBe(4);
  expect(
    result.state.issues.find((i) => i.keys.includes('validator:unit'))?.reservationIds,
  ).toHaveLength(3);
  expect(result.state.invocations.filter((i) => i.role === 'implementer')).toHaveLength(4);
  expect(result.state.invocations.filter((i) => i.role === 'reviewer')).toHaveLength(0);
}, 120000);
it.each(['auth', 'wrong-sha'])(
  'provider %s fails closed without retry/fallback (T-21/26/29)',
  async (scenario) => {
    const f = await createFixture();
    const result = await startRun(f.config, markdown, adapters(scenario), options);
    expect(result.state.status).toBe(scenario === 'auth' ? 'PAUSED' : 'BLOCKED');
    expect(result.state.invocations).toHaveLength(1);
  },
  30000,
);
it('single safe context refill is a fresh globally reserved process (T-13)', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, adapters('context'), options);
  expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(result.state.invocations).toHaveLength(6);
  expect(result.state.invocations.filter((i) => i.kind === 'context')).toHaveLength(1);
}, 30000);

it('repeated QA requests reuse actual candidate evidence without spending refill calls (REVIEW-01)', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, adapters('requested-checks'), options);
  expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(result.state.invocations).toHaveLength(5);
  expect(result.state.validations).toHaveLength(6);
}, 30000);
it('a new approved check gets exactly one execution and one fresh QA refill (REVIEW-01)', async () => {
  const f = await createFixture();
  f.config.validators.push({
    ...f.config.validators[2]!,
    id: 'extra',
    required: false,
    stages: ['baseline'],
  });
  const result = await startRun(f.config, markdown, adapters('extra-check'), options);
  expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(result.state.invocations).toHaveLength(6);
  expect(
    result.state.validations.filter(
      (v) => v.commandId === 'extra' && v.candidateSha === result.state.candidateSha,
    ),
  ).toHaveLength(1);
}, 30000);
it('unapproved requested checks still block before another call (REVIEW-01)', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, adapters('unapproved-check'), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('Validator not approved');
  expect(result.state.invocations).toHaveLength(2);
}, 30000);
it.each(['DECIDING', 'HANDOFF'])(
  'late candidate mutation at %s blocks readiness and preserves the edit (REVIEW-02)',
  async (phase) => {
    const f = await createFixture();
    let changed = '';
    const result = await startRun(f.config, markdown, adapters(), {
      ...options,
      onProgress: (state) => {
        if (state.phase === phase && !changed) {
          changed = join(
            f.config.stateRoot,
            'runs',
            state.runId,
            'worktrees/implementation/src/normalizeTitle.ts',
          );
          writeFileSync(changed, '// human edit after review\n');
        }
      },
    });
    expect(changed).not.toBe('');
    expect(result.state.status).toBe('BLOCKED');
    expect(result.state.reason).toContain('Frozen candidate');
    expect(await readFile(changed, 'utf8')).toBe('// human edit after review\n');
  },
  30000,
);
it('artifact exhaustion persists a terminal state that can be replayed (REVIEW-04)', async () => {
  const f = await createFixture();
  f.config.limits.maxArtifactBytesPerRun = 100_000;
  const result = await startRun(f.config, markdown, adapters(), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('BUDGET_EXHAUSTED');
  const { Journal } = await import('../src/persistence/journal.js');
  const reopened = new Journal(result.directory, result.state.runId, 100_000);
  await reopened.load();
  expect(reopened.state?.status).toBe('BLOCKED');
  expect(reopened.state?.seq).toBe(result.state.seq);
}, 30000);

it('interrupted requested-check refill cannot gain a new initial call on resume (REVIEW-01)', async () => {
  const f = await createFixture();
  f.config.validators.push({
    ...f.config.validators[2]!,
    id: 'extra',
    required: false,
    stages: ['baseline'],
  });
  const stop = new AbortController();
  const bindings = adapters('extra-check');
  const paused = await startRun(f.config, markdown, bindings, {
    ...options,
    signal: stop.signal,
    onProgress: (state) => {
      if (
        state.phase === 'REVIEW_QA' &&
        state.validations.some(
          (v) => v.commandId === 'extra' && v.candidateSha === state.candidateSha,
        )
      )
        stop.abort();
    },
  });
  expect(paused.state.status).toBe('PAUSED');
  expect(paused.state.invocations).toHaveLength(5);
  const { resumeRun } = await import('../src/application/services.js');
  const resumed = await resumeRun(paused.state.runId, options, bindings, f.home);
  expect(resumed.state.status).toBe('BLOCKED');
  expect(resumed.state.reason).toContain('Interrupted context refill');
  expect(resumed.state.invocations).toHaveLength(5);
}, 30000);

it('terminal readiness has its final handoff already written; no fallible post-READY report rewrite (REVIEW-04)', async () => {
  const { Journal } = await import('../src/persistence/journal.js');
  const original = Journal.prototype.writeArtifact;
  const spy = vi.spyOn(Journal.prototype, 'writeArtifact').mockImplementation(function (
    this: InstanceType<typeof Journal>,
    path,
    content,
  ) {
    if (this.state?.status === 'READY_FOR_HUMAN_REVIEW')
      throw new Error('Report rewrite after terminal commit');
    return original.call(this, path, content);
  });
  try {
    const f = await createFixture();
    const result = await startRun(f.config, markdown, adapters(), options);
    expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
    expect(await readFile(join(result.directory, 'artifacts/HANDOFF.md'), 'utf8')).toContain(
      'Status: READY_FOR_HUMAN_REVIEW',
    );
  } finally {
    spy.mockRestore();
  }
}, 30000);

it('first writer in a later milestone charges repair credit for a carried QA finding (REVIEW-06)', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, adapters('milestones'), options);
  expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(result.state.invocations).toHaveLength(8);
  expect(result.state.rounds).toEqual({ source: 1, tests: 1 });
  const repair = result.state.invocations.find(
    (i) => i.role === 'implementer' && i.milestoneId === 'tests',
  )!;
  expect(repair.kind).toBe('repair');
  expect(repair.round).toBe(1);
  expect(result.state.issues).toHaveLength(1);
  expect(result.state.issues[0]!.reservationIds).toEqual([repair.id]);
  expect(result.state.issues[0]!.open).toBe(false);
  const { assertOracle } = await import('./oracle.js');
  await assertOracle(result.workspace.implementation, result.state.baseSha);
}, 30000);

it('future MAJOR coverage finding reaches its scoped owner without an impossible source repair (REVIEW-06)', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, adapters('milestones-major'), options);
  expect(result.state.status, result.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(result.state.rounds).toEqual({ source: 1, tests: 1 });
  expect(result.state.invocations).toHaveLength(8);
  const writers = result.state.invocations.filter((i) => i.role === 'implementer');
  expect(writers.map((i) => i.milestoneId)).toEqual(['source', 'tests']);
  expect(result.state.issues[0]!.severity).toBe('MAJOR');
  expect(result.state.issues[0]!.open).toBe(false);
  expect(result.state.issues[0]!.reservationIds).toEqual([writers[1]!.id]);
  const { assertOracle } = await import('./oracle.js');
  await assertOracle(result.workspace.implementation, result.state.baseSha);
}, 30000);
