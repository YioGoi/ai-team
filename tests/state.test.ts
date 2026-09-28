import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finalReadinessProblems, readinessProblems, resolveIssue } from '../src/domain/state.js';
import { freezeInputs, Journal, replay, verifyInputs } from '../src/persistence/journal.js';
import { apply, created, invocation, planned } from './helpers.js';

describe('Lifetime budgets and scheduling', () => {
  it('refuses fifth round even when issue titles change (T-11)', () => {
    let s = planned();
    for (let n = 0; n < 4; n++) s = apply(s, { type: 'ROUND', milestoneId: 'm1' });
    expect(() => apply(s, { type: 'ROUND', milestoneId: 'm1' })).toThrow('Round limit');
  });
  it('refuses fourth repair and retains reservations through resolve/reopen/alias merge (T-09/10)', () => {
    let s = apply(planned(), {
      type: 'ISSUE',
      issue: {
        id: 'defect',
        keys: ['validator:unit'],
        title: 'failure',
        severity: 'MAJOR',
        criterionIds: [],
        open: true,
        reservationIds: [],
      },
    });
    for (let n = 1; n <= 3; n++) {
      s = apply(s, { type: 'ROUND', milestoneId: 'm1' });
      const call = invocation(n, 'implementer');
      call.invocation.round = n;
      call.invocation.kind = 'repair';
      call.invocation.issueIds = ['defect'];
      s = apply(s, call);
      s = apply(s, { type: 'EXITED', invocationId: `call-${n}`, confirmed: true });
    }
    s = apply(s, { type: 'RESOLVE_ISSUE', issueId: 'defect' });
    s = apply(s, {
      type: 'ISSUE',
      issue: {
        id: 'renamed',
        keys: ['validator:unit'],
        title: 'new title',
        severity: 'MAJOR',
        criterionIds: [],
        open: true,
        reservationIds: [],
      },
    });
    expect(resolveIssue(s, 'renamed')?.reservationIds).toHaveLength(3);
    s = apply(s, {
      type: 'ISSUE',
      issue: {
        id: 'alias',
        keys: ['different'],
        title: 'same problem',
        severity: 'MAJOR',
        criterionIds: [],
        open: true,
        reservationIds: [],
      },
    });
    s = apply(s, { type: 'MERGE_ISSUES', targetId: 'alias', sourceId: 'defect' });
    expect(resolveIssue(s, 'defect')?.reservationIds).toHaveLength(3);
    s = apply(s, { type: 'ROUND', milestoneId: 'm1' });
    const fourth = invocation(4, 'implementer');
    Object.assign(fourth.invocation, { round: 4, kind: 'repair', issueIds: ['renamed'] });
    expect(() => apply(s, fourth)).toThrow('Repair limit');
  });
  it('blocks simultaneous writers and readers while writer is reserved (T-05)', () => {
    let s = apply(planned(), { type: 'ROUND', milestoneId: 'm1' });
    s = apply(s, invocation(1, 'implementer'));
    expect(() => apply(s, invocation(2, 'implementer'))).toThrow('Concurrent');
    expect(() => apply(s, invocation(3, 'qa'))).toThrow('Concurrent');
    s = apply(s, { type: 'EXITED', invocationId: 'call-1', confirmed: false });
    expect(() => apply(s, invocation(4, 'implementer'))).toThrow('Concurrent');
  });
  it('bounds independent readers and context refills; rejects writer transport replay (T-05/13)', () => {
    let s = apply(planned(), invocation(1));
    s = apply(s, invocation(2, 'qa'));
    expect(() => apply(s, invocation(3))).toThrow('Concurrent');
    for (const n of [1, 2])
      s = apply(s, { type: 'EXITED', invocationId: `call-${n}`, confirmed: true });
    const call = invocation(3);
    call.invocation.kind = 'context';
    call.invocation.stepId = 'planning';
    s = apply(s, call);
    s = apply(s, { type: 'EXITED', invocationId: 'call-3', confirmed: true });
    call.invocation.id = 'call-4';
    expect(() => apply(s, call)).toThrow('context allowance');
    s = apply(s, { type: 'ROUND', milestoneId: 'm1' });
    const writer = invocation(5, 'implementer');
    writer.invocation.kind = 'transport';
    expect(() => apply(s, writer)).toThrow('Writer transport replay');
  });
  it('active time cannot be reset by a status change (T-33)', () => {
    let s = apply(planned(), { type: 'ACTIVE', elapsedMs: 5_400_000 });
    s = apply(s, { type: 'STATUS', status: 'PAUSED', reason: 'interrupt' });
    s = apply(s, { type: 'STATUS', status: 'RUNNING', reason: 'resume' });
    expect(() => apply(s, invocation(1))).toThrow('time limit');
  });
});

describe('Journal, inputs and final gates', () => {
  it('serializes concurrent 23/24 reservations and replay preserves crash consumption (T-12/16)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-journal-'));
    const journal = new Journal(dir, 'run-test', 10_000_000);
    await journal.load();
    await journal.append(created());
    for (let n = 1; n <= 23; n++) {
      await journal.append(invocation(n));
      await journal.append({ type: 'EXITED', invocationId: `call-${n}`, confirmed: true });
    }
    const results = await Promise.allSettled([
      journal.append(invocation(24)),
      journal.append(invocation(25)),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    const restored = new Journal(dir, 'run-test', 10_000_000);
    await restored.load();
    expect(restored.state?.invocations).toHaveLength(24);
    expect(restored.state?.invocations.at(-1)?.state).toBe('reserved');
    await expect(restored.append(invocation(26))).rejects.toThrow('limit');
  });
  it('handles torn tail, rejects interior corruption and conflicting duplicates (T-17)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-torn-'));
    const journal = new Journal(dir, 'run-test', 1_000_000);
    await journal.append(created());
    const line = await readFile(join(dir, 'events.jsonl'), 'utf8');
    expect(replay(line + line).events).toHaveLength(1);
    expect(() => replay(line + line.replace('"base"', '"tampered"'))).toThrow('Conflicting');
    expect(() => replay(line + 'garbage\n')).toThrow('Malformed');
    await writeFile(join(dir, 'events.jsonl'), line + '{"incomplete');
    const restored = new Journal(dir, 'run-test', 1_000_000);
    await restored.load();
    expect(restored.state?.notices.at(-1)).toContain('Quarantined');
  });
  it('freezes exact external task and rejects internal tampering (T-25/37)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-inputs-'));
    const digest = await freezeInputs(dir, 'task selected', '{}');
    expect((await verifyInputs(dir, digest)).task).toBe('task selected');
    await writeFile(join(dir, 'inputs/task.md'), 'changed');
    await expect(verifyInputs(dir, digest)).rejects.toThrow('snapshots changed');
  });
  it('enforces persisted artifact accounting after reopen (T-33)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-cap-'));
    const journal = new Journal(dir, 'run-test', 100_000);
    await journal.append(created());
    const restored = new Journal(dir, 'run-test', 100_000);
    await restored.load();
    await expect(restored.writeArtifact('huge', 'x'.repeat(100_000))).rejects.toThrow(
      'Artifact byte limit',
    );
  });
  it('missing review/QA/validators never reaches readiness, even with optimistic prose (T-19/20)', () => {
    let s = planned();
    s = apply(s, { type: 'NOTICE', message: 'All tests passed, approved!' });
    expect(readinessProblems(s).some((p) => p.includes('validator'))).toBe(true);
    expect(finalReadinessProblems(s).some((p) => p.includes('review'))).toBe(true);
    expect(() =>
      apply(s, { type: 'STATUS', status: 'READY_FOR_HUMAN_REVIEW', reason: 'claimed' }),
    ).toThrow();
  });
  it('rejects stale check candidate and never accepts nonzero exit (T-07/19)', () => {
    const result = {
      id: 'v1',
      commandId: 'unit',
      commandHash: 'h',
      candidateSha: 'old',
      argv: ['node'],
      cwd: '/tmp',
      startedAt: '',
      endedAt: '',
      exitCode: 0,
      signal: null,
      timedOut: false,
      outputLimited: false,
      cancelled: false,
      terminationConfirmed: true,
      logPath: 'output.log',
    };
    expect(() => apply(planned(), { type: 'VALIDATION', result })).toThrow('stale');
    const s = apply(planned(), {
      type: 'VALIDATION',
      result: { ...result, candidateSha: 'base', exitCode: 1 },
    });
    expect(readinessProblems(s)).toContain('Missing passing candidate validator unit');
  });
});

it('reserves terminal space before concurrent writes and reopens BLOCKED within cap (REVIEW-04)', async () => {
  const { readdir, stat } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'ai-team-terminal-'));
  const cap = 100_000;
  const journal = new Journal(dir, 'run-test', cap);
  await journal.load();
  await journal.append(created());
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, (_, n) => journal.writeArtifact(`fill-${n}`, 'x'.repeat(10_000))),
  );
  expect(results.some((r) => r.status === 'rejected')).toBe(true);
  const before = journal.state!.seq;
  await expect(journal.append({ type: 'NOTICE', message: 'x'.repeat(100_000) })).rejects.toThrow(
    'Artifact cap',
  );
  expect(journal.state!.seq).toBe(before);
  await journal.append({ type: 'STATUS', status: 'BLOCKED', reason: 'Artifact budget exhausted' });
  const reopened = new Journal(dir, 'run-test', cap);
  await reopened.load();
  expect(reopened.state!.status).toBe('BLOCKED');
  expect(reopened.state!.seq).toBe(before + 1);
  expect(JSON.parse(await readFile(join(dir, 'run.json'), 'utf8')).status).toBe('BLOCKED');
  expect(await readFile(join(dir, 'STATUS.md'), 'utf8')).toContain('BLOCKED');
  const sizes = await Promise.all(
    (await readdir(dir)).map(async (name) => (await stat(join(dir, name))).size),
  );
  expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(cap);
});

it('preflights transactional reports before committing any event or report (REVIEW-04)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-team-report-cap-'));
  const journal = new Journal(dir, 'run-test', 100_000);
  await journal.load();
  await journal.append(created());
  await journal.writeArtifact('artifacts/HANDOFF.md', 'original');
  const before = await readFile(join(dir, 'events.jsonl'), 'utf8');
  await expect(
    journal.append(
      { type: 'NOTICE', message: 'record' },
      { 'artifacts/HANDOFF.md': 'x'.repeat(100_000) },
    ),
  ).rejects.toThrow('Artifact cap');
  expect(await readFile(join(dir, 'artifacts/HANDOFF.md'), 'utf8')).toBe('original');
  expect(await readFile(join(dir, 'events.jsonl'), 'utf8')).toBe(before);
  await journal.append({ type: 'STATUS', status: 'BLOCKED', reason: 'budget exhausted' });
  expect(journal.state!.status).toBe('BLOCKED');
});
