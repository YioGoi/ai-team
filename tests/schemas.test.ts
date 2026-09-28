import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  configSchema,
  limitsSchema,
  parseTask,
  relativePath,
  resultJsonSchema,
  taskSchema,
  validateRunInputs,
  inScope,
} from '../src/domain/schemas.js';
const markdown = readFileSync(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
const task = parseTask(markdown);
const config = () =>
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
describe('Task and config authority (T-01)', () => {
  it('parses the complete proving task and approved config', () => {
    expect(task.acceptanceCriteria).toHaveLength(4);
    expect(() => validateRunInputs(task, config())).not.toThrow();
  });
  it('rejects absent/multiple JSON blocks with location-aware schema errors', () => {
    expect(() => parseTask('plain prose')).toThrow('exactly one');
    expect(() => parseTask(markdown + markdown)).toThrow('exactly one');
    expect(() => parseTask('# x\n```json\n{}\n```')).toThrow('line 2');
  });
  it.each([
    { objective: '' },
    { acceptanceCriteria: [] },
    { requirements: [] },
    { limits: { maxAgentInvocationsPerRun: 999 } },
    { requirements: [task.requirements[0], task.requirements[0]] },
    { acceptanceCriteria: task.acceptanceCriteria.map((c) => ({ ...c, required: false })) },
    {
      acceptanceCriteria: task.acceptanceCriteria.map((c) => ({
        ...c,
        requirementIds: ['missing'],
      })),
    },
  ])('rejects invalid task %j', (change) =>
    expect(taskSchema.safeParse({ ...task, ...change }).success).toBe(false),
  );
  it('rejects unknown validator references and absent approval', () => {
    expect(() =>
      validateRunInputs({ ...task, expectedBaselineFailures: ['missing'] }, config()),
    ).toThrow('Unknown validator');
    const c = config();
    c.validators[0]!.approved = false;
    expect(() => validateRunInputs(task, c)).toThrow('approval');
    c.validators = [];
    expect(() =>
      validateRunInputs(
        {
          ...task,
          acceptanceCriteria: task.acceptanceCriteria.map((x) => ({ ...x, validatorIds: [] })),
        },
        c,
      ),
    ).toThrow('required candidate validator');
  });
  it('rejects authority extras and hidden provider fallback', () => {
    expect(configSchema.safeParse({ ...config(), allowDangerous: true }).success).toBe(false);
    expect(configSchema.safeParse({ ...config(), profile: 'mixed' }).success).toBe(false);
    expect(
      configSchema.safeParse({
        ...config(),
        authPolicy: { route: 'api-key', allowApiFallback: true },
      }).success,
    ).toBe(false);
  });
});
describe('Path and budget schema boundaries', () => {
  it.each(['/etc/passwd', '../x', 'src/../x', './x', 'a\\b', 'src/*', 'a//b'])(
    'rejects path %s',
    (p) => expect(relativePath.safeParse(p).success).toBe(false),
  );
  it('uses component boundaries and forbidden rules win', () => {
    const scope = { allowedPaths: ['src/'], forbiddenPaths: ['src/private/'] };
    expect(inScope('src/a.ts', scope)).toBe(true);
    expect(inScope('src-other/a.ts', scope)).toBe(false);
    expect(inScope('src/private/a.ts', scope)).toBe(false);
  });
  it('allows lower ceilings but not increases or unknown keys', () => {
    expect(limitsSchema.parse({ maxAgentInvocationsPerRun: 5 }).maxAgentInvocationsPerRun).toBe(5);
    expect(limitsSchema.safeParse({ maxRoundsPerMilestone: 5 }).success).toBe(false);
    expect(limitsSchema.safeParse({ retries: 42 }).success).toBe(false);
  });
  it.each(['architect', 'implementer', 'reviewer', 'qa'] as const)(
    'generates strict provider JSON schema for %s',
    (role) => {
      const schema = resultJsonSchema(role);
      expect(schema.type).toBe('object');
      expect(schema.additionalProperties).toBe(false);
    },
  );
});
