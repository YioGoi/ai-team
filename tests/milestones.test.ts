import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  assessmentCriterionIds,
  deferredForMilestone,
  futureMilestoneForFinding,
} from '../src/domain/milestones.js';
import { finalReadinessProblems, readinessProblems } from '../src/domain/state.js';
import type { Issue } from '../src/domain/state.js';
import { startRun } from '../src/orchestration/engine.js';
import { resumeRun } from '../src/application/services.js';
import { mockAdapter } from '../src/providers/mock.js';
import { Journal } from '../src/persistence/journal.js';
import { createFixture } from './fixture.js';
import { apply, created, invocation, task } from './helpers.js';
const ids = task.acceptanceCriteria.map((c) => c.id);
function planning() {
  return apply(apply(undefined, created()), {
    type: 'PLAN',
    milestones: [
      {
        id: 'source',
        objective: 'Implement',
        criterionIds: ids.slice(0, 3),
        allowedPaths: ['src/normalizeTitle.ts'],
        dependsOn: [],
        validatorIds: ['build'],
      },
      {
        id: 'tests',
        objective: 'Test',
        criterionIds: ids,
        allowedPaths: ['tests/normalizeTitle.test.ts'],
        dependsOn: ['source'],
        validatorIds: ['unit'],
      },
    ],
  });
}
const finding = (): Issue => ({
  id: 'coverage',
  keys: ['finding:coverage'],
  title: 'Coverage',
  severity: 'MAJOR',
  criterionIds: [ids[3]!],
  paths: ['tests/normalizeTitle.test.ts'],
  open: true,
  reservationIds: [],
});
it('only located unchanged future-only work has a future owner (SPEC4.5 / REVIEW-06)', () => {
  const s = planning();
  const f = finding();
  expect(assessmentCriterionIds(s, 'source')).toEqual(ids.slice(0, 3));
  expect(futureMilestoneForFinding(s, 'source', f, ['src/normalizeTitle.ts'])).toBe('tests');
  for (const unsafe of [
    { ...f, severity: 'CRITICAL' as const },
    { ...f, criterionIds: [] },
    { ...f, criterionIds: [ids[0]!, ids[3]!] },
    { ...f, paths: [] },
    { ...f, paths: ['unknown.ts'] },
    { ...f, paths: ['src/normalizeTitle.ts'] },
  ])
    expect(futureMilestoneForFinding(s, 'source', unsafe, [])).toBeUndefined();
  expect(futureMilestoneForFinding(s, 'source', f, f.paths!)).toBeUndefined();
  s.milestones[0]!.allowedPaths.push('tests/normalizeTitle.test.ts');
  expect(futureMilestoneForFinding(s, 'source', f, [])).toBeUndefined();
});
it('future major stays open and blocks its owner and final readiness; invalid assignments reject', () => {
  let s = apply(planning(), { type: 'ROUND', milestoneId: 'source' });
  s = apply(s, { type: 'ISSUE', issue: { ...finding(), deferredUntilMilestoneId: 'tests' } });
  const issue = s.issues[0]!;
  expect(deferredForMilestone(s, issue, 'source')).toBe(true);
  expect(readinessProblems(s, ids.slice(0, 3), 'source')).not.toContain(
    'Unresolved mandatory finding',
  );
  expect(readinessProblems(s, ids, 'tests')).toContain('Unresolved mandatory finding');
  expect(finalReadinessProblems(s)).toContain('Unresolved mandatory finding');
  const attempt = invocation(1, 'implementer');
  Object.assign(attempt.invocation, {
    milestoneId: 'source',
    round: 1,
    kind: 'repair',
    issueIds: [issue.id],
  });
  expect(() => apply(s, attempt)).toThrow('before owning milestone');
  expect(() =>
    apply(s, {
      type: 'ISSUE',
      issue: { ...finding(), severity: 'CRITICAL', deferredUntilMilestoneId: 'tests' },
    }),
  ).toThrow('Invalid future');
  s.issues[0]!.reservationIds = ['old-1', 'old-2', 'old-3'];
  expect(readinessProblems(s, ids.slice(0, 3), 'source')).toContain('Unresolved mandatory finding');
});
it('new aliases/current findings remove deferral without restoring credits or lowering severity', () => {
  let s = apply(planning(), { type: 'ROUND', milestoneId: 'source' });
  s = apply(s, { type: 'ISSUE', issue: { ...finding(), deferredUntilMilestoneId: 'tests' } });
  s = apply(s, {
    type: 'ISSUE',
    issue: { ...finding(), id: 'current-alias', severity: 'MINOR', criterionIds: [ids[0]!] },
  });
  expect(s.issues).toHaveLength(1);
  expect(s.issues[0]!.severity).toBe('MAJOR');
  expect(s.issues[0]!.deferredUntilMilestoneId).toBeUndefined();
  expect(readinessProblems(s, ids.slice(0, 3), 'source')).toContain('Unresolved mandatory finding');
});
const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
const options = { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets };
const bindings = (scenario: string) => ({
  mock: mockAdapter(join(assets, 'mock-worker.mjs'), scenario),
});
it('deferred finding survives pause/replay and is charged once in its owning milestone', async () => {
  const f = await createFixture();
  const stop = new AbortController();
  const adapters = bindings('milestones-major');
  const paused = await startRun(f.config, markdown, adapters, {
    ...options,
    signal: stop.signal,
    onProgress: (s) => {
      if (s.completedMilestones.includes('source')) stop.abort();
    },
  });
  expect(paused.state.status, paused.state.reason).toBe('PAUSED');
  expect(paused.state.invocations).toHaveLength(5);
  const j = new Journal(
    paused.directory,
    paused.state.runId,
    f.config.limits.maxArtifactBytesPerRun,
  );
  await j.load();
  expect(j.state!.issues[0]!.deferredUntilMilestoneId).toBe('tests');
  expect(j.state!.issues[0]!.reservationIds).toHaveLength(0);
  const resumed = await resumeRun(paused.state.runId, options, adapters, f.home);
  expect(resumed.state.status, resumed.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(resumed.state.invocations).toHaveLength(8);
  expect(resumed.state.issues[0]!.id).toBe(paused.state.issues[0]!.id);
  expect(resumed.state.issues[0]!.reservationIds).toHaveLength(1);
  const writer = resumed.state.invocations.find(
    (i) => i.role === 'implementer' && i.milestoneId === 'tests',
  )!;
  const packet = JSON.parse(
    await readFile(join(resumed.directory, 'invocations', writer.id, 'request.json'), 'utf8'),
  );
  expect(packet.scope.allowedPaths).toEqual(['tests/normalizeTitle.test.ts']);
  expect(packet.context.evidence['controller:plan'].assessmentCriterionIds).toEqual(ids);
}, 45000);
it('a finding affecting current criteria cannot be deferred or dispatched outside writer scope', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, bindings('milestones-current'), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('cannot be repaired within milestone source');
  expect(result.state.invocations).toHaveLength(5);
  expect(result.state.issues[0]!.deferredUntilMilestoneId).toBeUndefined();
}, 30000);
it('deferred MAJOR that remains unresolved exhausts the same three credits and never reaches final readiness', async () => {
  const f = await createFixture();
  const result = await startRun(f.config, markdown, bindings('milestones-persistent'), options);
  expect(result.state.status).toBe('BLOCKED');
  expect(result.state.reason).toContain('budget exhausted');
  const issue = result.state.issues.find((i) => i.title === 'Regression coverage is incomplete')!;
  expect(issue.open).toBe(true);
  expect(issue.reservationIds).toHaveLength(3);
  expect(
    result.state.invocations.filter((i) => i.role === 'implementer' && i.milestoneId === 'source'),
  ).toHaveLength(1);
  expect(
    result.state.invocations.filter((i) => i.role === 'implementer' && i.milestoneId === 'tests'),
  ).toHaveLength(3);
  expect(finalReadinessProblems(result.state)).toContain('Unresolved mandatory finding');
}, 60000);
