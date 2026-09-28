import { z } from 'zod';

export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/);
const text = z.string().trim().min(1);
export const relativePath = z
  .string()
  .min(1)
  .refine(
    (p) =>
      !p.startsWith('/') &&
      !p.includes('\\') &&
      !p.includes('\0') &&
      !p.split('/').some((c) => c === '..' || c === '.') &&
      !/[*?[\]{}]/u.test(p) &&
      !p.includes('//'),
    'Expected a relative file or directory prefix, without traversal/globs',
  );
export const scopeSchema = z.strictObject({
  allowedPaths: z.array(relativePath).min(1),
  forbiddenPaths: z.array(relativePath),
});
export const roleSchema = z.enum(['architect', 'implementer', 'reviewer', 'qa']);
export const providerSchema = z.enum(['codex', 'claude', 'mock']);
export const statusSchema = z.enum([
  'RUNNING',
  'PAUSED',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'READY_FOR_HUMAN_REVIEW',
]);
export const phaseSchema = z.enum([
  'PREFLIGHT',
  'BASELINE',
  'PLANNING',
  'IMPLEMENTING',
  'VALIDATING',
  'REVIEW_QA',
  'DECIDING',
  'HANDOFF',
]);
export const errorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'UNSUPPORTED_CAPABILITY',
  'PERMISSION_DENIED',
  'INVALID_RESULT',
  'PROCESS_TIMEOUT',
  'OUTPUT_LIMIT',
  'VALIDATION_FAILED',
  'SCOPE_VIOLATION',
  'INPUT_CHANGED',
  'STATE_CORRUPT',
  'BUDGET_EXHAUSTED',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_INPUT',
]);
export const publicErrorSchema = z.strictObject({ code: errorCodeSchema, message: text });
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export class TeamError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TeamError';
  }
}
export const matchesPath = (path: string, rule: string): boolean =>
  rule.endsWith('/') ? path.startsWith(rule) : path === rule;
export const inScope = (path: string, scope: z.infer<typeof scopeSchema>): boolean =>
  scope.allowedPaths.some((r) => matchesPath(path, r)) &&
  !scope.forbiddenPaths.some((r) => matchesPath(path, r));
const unique = (values: string[]) => new Set(values).size === values.length;
export const taskSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id,
    title: text,
    objective: text,
    requirements: z.array(z.strictObject({ id, text })).min(1),
    acceptanceCriteria: z
      .array(
        z.strictObject({
          id,
          requirementIds: z.array(id).min(1),
          text,
          required: z.boolean(),
          validatorIds: z.array(id),
          humanReview: text,
        }),
      )
      .min(1),
    scope: scopeSchema,
    constraints: z.array(text),
    nonGoals: z.array(text),
    expectedBaselineFailures: z.array(id),
  })
  .superRefine((task, ctx) => {
    if (
      !unique(task.requirements.map((x) => x.id)) ||
      !unique(task.acceptanceCriteria.map((x) => x.id))
    )
      ctx.addIssue({ code: 'custom', message: 'Duplicate requirement/criterion ID' });
    if (!task.acceptanceCriteria.some((c) => c.required))
      ctx.addIssue({ code: 'custom', message: 'At least one required criterion is mandatory' });
    const reqs = new Set(task.requirements.map((x) => x.id));
    task.acceptanceCriteria.forEach((c, i) => {
      if (c.requirementIds.some((r) => !reqs.has(r)))
        ctx.addIssue({
          code: 'custom',
          path: ['acceptanceCriteria', i, 'requirementIds'],
          message: 'Unknown requirement reference',
        });
    });
  });
export type TaskSpec = z.infer<typeof taskSchema>;
export function parseTask(markdown: string): TaskSpec {
  const blocks = [...markdown.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1)
    throw new TeamError(
      'INVALID_INPUT',
      'Task Markdown must contain exactly one fenced JSON block',
    );
  const block = blocks[0]!;
  const line = markdown.slice(0, block.index).split('\n').length;
  try {
    return taskSchema.parse(JSON.parse(block[1]!));
  } catch (error) {
    throw new TeamError(
      'INVALID_INPUT',
      `Task JSON starting at line ${line}: ${error instanceof Error ? error.message : 'Invalid input'}`,
    );
  }
}
export const limitDefaults = {
  maxMilestones: 4,
  maxRoundsPerMilestone: 4,
  maxRepairInvocationsPerIssue: 3,
  maxAgentInvocationsPerRun: 24,
  maxConcurrentAgents: 2,
  maxConcurrentWriters: 1,
  agentTimeoutMs: 600_000,
  validatorTimeoutMs: 180_000,
  setupTimeoutMs: 600_000,
  maxActiveRuntimeMs: 5_400_000,
  terminationGraceMs: 5_000,
  maxTransportRetriesPerInvocation: 1,
  maxContextRefillsPerRoleStep: 1,
  maxInputBytesPerInvocation: 262_144,
  maxStdoutBytesPerInvocation: 5_242_880,
  maxStderrBytesPerInvocation: 1_048_576,
  maxArtifactBytesPerRun: 104_857_600,
} as const;
const ceiling = (max: number) => z.number().int().positive().max(max).default(max);
export const limitsSchema = z.strictObject({
  maxMilestones: ceiling(4),
  maxRoundsPerMilestone: ceiling(4),
  maxRepairInvocationsPerIssue: ceiling(3),
  maxAgentInvocationsPerRun: ceiling(24),
  maxConcurrentAgents: ceiling(2),
  maxConcurrentWriters: ceiling(1),
  agentTimeoutMs: ceiling(600_000),
  validatorTimeoutMs: ceiling(180_000),
  setupTimeoutMs: ceiling(600_000),
  maxActiveRuntimeMs: ceiling(5_400_000),
  terminationGraceMs: ceiling(5_000),
  maxTransportRetriesPerInvocation: z.number().int().min(0).max(1).default(1),
  maxContextRefillsPerRoleStep: z.number().int().min(0).max(1).default(1),
  maxInputBytesPerInvocation: ceiling(262_144),
  maxStdoutBytesPerInvocation: ceiling(5_242_880),
  maxStderrBytesPerInvocation: ceiling(1_048_576),
  maxArtifactBytesPerRun: ceiling(104_857_600),
});
export type Limits = z.infer<typeof limitsSchema>;
const cwdSchema = z.union([z.literal('.'), relativePath]);
export const commandSchema = z.strictObject({
  id,
  executable: text,
  args: z.array(z.string()),
  cwd: cwdSchema,
  approved: z.boolean(),
  timeoutMs: ceiling(600_000),
});
export const validatorSchema = commandSchema.extend({
  required: z.boolean(),
  stages: z.array(z.enum(['baseline', 'candidate'])).min(1),
  allowedOutputPaths: z.array(relativePath),
});
export const bindingSchema = z.strictObject({ provider: providerSchema, model: text.nullable() });
export const profileSchema = z.enum(['mock', 'codex-only', 'claude-only', 'mixed']);
const absolutePath = z
  .string()
  .startsWith('/')
  .refine((p) => !p.includes('\0'));
export const configSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: id,
    repositoryPath: absolutePath,
    stateRoot: absolutePath,
    profile: profileSchema,
    roleBindings: z.strictObject({
      architect: bindingSchema,
      implementer: bindingSchema,
      reviewer: bindingSchema,
      qa: bindingSchema,
    }),
    setupCommands: z.array(commandSchema),
    validators: z.array(validatorSchema),
    protectedPaths: z.array(relativePath),
    authPolicy: z.strictObject({
      route: z.literal('saved-cli-login'),
      allowApiFallback: z.literal(false),
      allowCloudEndpoints: z.literal(false),
    }),
    limits: limitsSchema,
    approval: z.strictObject({ reviewedAt: z.iso.datetime().nullable() }),
  })
  .superRefine((config, ctx) => {
    if (!unique([...config.setupCommands, ...config.validators].map((c) => c.id)))
      ctx.addIssue({ code: 'custom', message: 'Duplicate command ID' });
    const expected =
      config.profile === 'mixed'
        ? ['claude', 'codex', 'claude', 'codex']
        : Array<string>(4).fill(
            config.profile === 'mock'
              ? 'mock'
              : config.profile === 'codex-only'
                ? 'codex'
                : 'claude',
          );
    (['architect', 'implementer', 'reviewer', 'qa'] as const).forEach((role, i) => {
      if (config.roleBindings[role].provider !== expected[i])
        ctx.addIssue({
          code: 'custom',
          path: ['roleBindings', role],
          message: 'Binding does not match selected profile',
        });
    });
  });
export type ProjectConfig = z.infer<typeof configSchema>;
export type Role = z.infer<typeof roleSchema>;
export type ProviderId = z.infer<typeof providerSchema>;
export function validateRunInputs(task: TaskSpec, config: ProjectConfig): void {
  const validators = new Set(config.validators.map((v) => v.id));
  for (const ref of [
    ...task.expectedBaselineFailures,
    ...task.acceptanceCriteria.flatMap((c) => c.validatorIds),
  ]) {
    if (!validators.has(ref))
      throw new TeamError('INVALID_INPUT', `Unknown validator reference: ${ref}`);
  }
  if (!config.validators.some((v) => v.required && v.approved && v.stages.includes('candidate')))
    throw new TeamError('INVALID_INPUT', 'Approve at least one required candidate validator');
  if (
    [
      ...config.setupCommands,
      ...config.validators.filter(
        (v) =>
          v.required ||
          task.acceptanceCriteria.some((c) => c.required && c.validatorIds.includes(v.id)),
      ),
    ].some((c) => !c.approved)
  )
    throw new TeamError('PERMISSION_DENIED', 'Required commands need explicit approval');
  if (!config.approval.reviewedAt)
    throw new TeamError('PERMISSION_DENIED', 'Config needs a human command-review timestamp');
}
const evidence = z.array(text);
export const findingSchema = z.strictObject({
  localId: id,
  existingIssueId: id.nullable(),
  severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'NOTE']),
  title: text,
  criterionIds: z.array(id),
  locations: z.array(
    z.strictObject({ path: relativePath, line: z.number().int().positive().nullable() }),
  ),
  symptom: text,
  evidenceReferences: evidence,
  suggestedNextAction: text,
});
export const assessmentSchema = z.strictObject({
  criterionId: id,
  outcome: z.enum(['PASS', 'FAIL', 'NOT_VERIFIED', 'NOT_APPLICABLE']),
  evidenceReferences: evidence,
  rationale: text,
});
export const milestoneSchema = z.strictObject({
  id,
  objective: text,
  criterionIds: z.array(id).min(1),
  allowedPaths: z.array(relativePath).min(1),
  dependsOn: z.array(id),
  validatorIds: z.array(id),
});
const envelope = {
  schemaVersion: z.literal(1),
  runId: id,
  invocationId: id,
  taskId: id,
  basisSha: text,
  outcome: z.enum(['OK', 'NEEDS_CONTEXT', 'BLOCKED']),
  summary: text,
  evidenceReferences: evidence,
  requestedContextPaths: z.array(relativePath),
  findings: z.array(findingSchema),
};
export const architectResultSchema = z.strictObject({
  ...envelope,
  role: z.literal('architect'),
  payload: z.strictObject({
    milestones: z.array(milestoneSchema),
    invariants: z.array(text),
    risks: z.array(text),
    assumptions: z.array(text),
  }),
});
export const implementerResultSchema = z.strictObject({
  ...envelope,
  role: z.literal('implementer'),
  payload: z.strictObject({
    changeSummary: text,
    declaredChangedPaths: z.array(relativePath),
    addressedCriterionIds: z.array(id),
    addressedIssueIds: z.array(id),
    testChanges: z.array(text),
    diagnosticClaims: z.array(text),
    limitations: z.array(text),
  }),
});
export const reviewerResultSchema = z.strictObject({
  ...envelope,
  role: z.literal('reviewer'),
  payload: z.strictObject({
    mode: z.enum(['MILESTONE', 'FULL']),
    assessments: z.array(assessmentSchema),
    verdict: text,
    humanReviewFocus: z.array(text),
    limitations: z.array(text),
  }),
});
export const qaResultSchema = z.strictObject({
  ...envelope,
  role: z.literal('qa'),
  payload: z.strictObject({
    mode: z.enum(['PLAN', 'CHECK']),
    testPlan: z.array(
      z.strictObject({
        criterionId: id,
        kind: z.enum(['happy-path', 'edge', 'regression', 'sanity', 'smoke']),
        description: text,
        validatorIds: z.array(id),
      }),
    ),
    assessments: z.array(assessmentSchema),
    requestedValidatorIds: z.array(id),
    manualSmokeSteps: z.array(text),
    limitations: z.array(text),
  }),
});
export const resultSchemas = {
  architect: architectResultSchema,
  implementer: implementerResultSchema,
  reviewer: reviewerResultSchema,
  qa: qaResultSchema,
};
export const resultSchema = z.discriminatedUnion('role', [
  architectResultSchema,
  implementerResultSchema,
  reviewerResultSchema,
  qaResultSchema,
]);
export type RoleResult = z.infer<typeof resultSchema>;
export const resultJsonSchema = (role: Role) => z.toJSONSchema(resultSchemas[role]);
export const requestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: id,
  invocationId: id,
  role: roleSchema,
  rolePromptHash: text,
  taskId: id,
  taskHash: text,
  phase: phaseSchema,
  milestoneId: id.nullable(),
  round: z.number().int().nonnegative(),
  baseSha: text,
  basisSha: text,
  scope: scopeSchema,
  assignedIssueIds: z.array(id),
  model: text.nullable(),
  workspacePath: absolutePath,
  outputSchemaPath: absolutePath,
  outputSchema: z.record(z.string(), z.unknown()),
  context: z.strictObject({
    task: taskSchema,
    rolePrompt: text,
    files: z.array(
      z.strictObject({
        path: relativePath,
        hash: text,
        excerpt: z.string(),
        startLine: z.number().int().positive(),
        endLine: z.number().int().nonnegative(),
      }),
    ),
    omissions: z.array(text),
    evidence: z.record(z.string(), z.unknown()),
    instructions: z.string(),
  }),
});
export type AgentRequest = z.infer<typeof requestSchema>;
export function validateResult(raw: unknown, request: AgentRequest): RoleResult {
  const result = resultSchema.parse(raw);
  for (const key of ['runId', 'invocationId', 'taskId', 'role', 'basisSha'] as const) {
    if (result[key] !== request[key])
      throw new TeamError('INVALID_RESULT', `Result ${key} differs from request`);
  }
  const known = new Set(Object.keys(request.context.evidence));
  const refs = [
    ...result.evidenceReferences,
    ...result.findings.flatMap((f) => f.evidenceReferences),
    ...('assessments' in result.payload
      ? result.payload.assessments.flatMap((a) => a.evidenceReferences)
      : []),
  ];
  if (refs.some((ref) => !known.has(ref)))
    throw new TeamError('INVALID_RESULT', 'Unknown evidence reference');
  const criteria = new Set(request.context.task.acceptanceCriteria.map((c) => c.id));
  if (result.findings.some((f) => f.criterionIds.some((c) => !criteria.has(c))))
    throw new TeamError('INVALID_RESULT', 'Unknown finding criterion');
  if (
    'assessments' in result.payload &&
    result.payload.assessments.some((a) => !criteria.has(a.criterionId))
  )
    throw new TeamError('INVALID_RESULT', 'Unknown assessed criterion');
  return result;
}
