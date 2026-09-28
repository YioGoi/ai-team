import { readFileSync } from 'node:fs';
import { configSchema, parseTask } from '../src/domain/schemas.js';
import { reduce } from '../src/domain/state.js';
import type { EventPayload, RunState } from '../src/domain/state.js';
export const task = parseTask(
  readFileSync(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8'),
);
export const config = () =>
  configSchema.parse({
    schemaVersion: 1,
    projectId: 'fixture',
    repositoryPath: '/tmp/fixture',
    stateRoot: '/tmp/state',
    profile: 'mock',
    roleBindings: Object.fromEntries(
      ['architect', 'implementer', 'reviewer', 'qa'].map((r) => [
        r,
        { provider: 'mock', model: null },
      ]),
    ),
    setupCommands: [],
    validators: ['unit', 'typecheck', 'build'].map((id) => ({
      id,
      executable: 'node',
      args: ['check.js'],
      cwd: '.',
      approved: true,
      timeoutMs: 1000,
      required: true,
      stages: ['baseline', 'candidate'],
      allowedOutputPaths: [],
    })),
    protectedPaths: ['package.json'],
    authPolicy: { route: 'saved-cli-login', allowApiFallback: false, allowCloudEndpoints: false },
    limits: {},
    approval: { reviewedAt: '2026-09-19T00:00:00Z' },
  });
export function apply(state: RunState | undefined, payload: EventPayload): RunState {
  const seq = (state?.seq ?? 0) + 1;
  return reduce(state, {
    schemaVersion: 1,
    eventId: `event-${seq}`,
    runId: 'run-test',
    seq,
    at: '2026-09-19T00:00:00Z',
    payload,
  });
}
export const created = (): EventPayload => ({
  type: 'CREATED',
  task,
  config: config(),
  mode: 'SIMULATION',
  baseSha: 'base',
  sourceDigest: 'digest',
  manifestHash: 'manifest',
});
export function planned(): RunState {
  return apply(apply(undefined, created()), {
    type: 'PLAN',
    milestones: [
      {
        id: 'm1',
        objective: 'Implement normalization',
        criterionIds: task.acceptanceCriteria.map((c) => c.id),
        allowedPaths: task.scope.allowedPaths,
        dependsOn: [],
        validatorIds: ['unit', 'typecheck', 'build'],
      },
    ],
  });
}
export function invocation(
  n: number,
  role: 'architect' | 'implementer' | 'reviewer' | 'qa' = 'architect',
): Extract<EventPayload, { type: 'RESERVED' }> {
  return {
    type: 'RESERVED',
    invocation: {
      id: `call-${n}`,
      role,
      basisSha: 'base',
      milestoneId: role === 'implementer' ? 'm1' : null,
      round: role === 'implementer' ? 1 : 0,
      issueIds: [],
      kind: 'initial',
      stepId: `step-${n}`,
      state: 'reserved',
      processId: null,
      processIdentity: null,
    },
  };
}
