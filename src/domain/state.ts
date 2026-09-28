import { z } from 'zod';
import {
  assessmentSchema,
  configSchema,
  id,
  limitsSchema,
  milestoneSchema,
  phaseSchema,
  relativePath,
  resultSchema,
  roleSchema,
  statusSchema,
  taskSchema,
  TeamError,
} from './schemas.js';
import { deferredForMilestone, futureMilestoneForFinding } from './milestones.js';
import type { RoleResult } from './schemas.js';

export const validationSchema = z.strictObject({
  id,
  commandId: id,
  commandHash: z.string(),
  candidateSha: z.string(),
  argv: z.array(z.string()),
  cwd: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  timedOut: z.boolean(),
  outputLimited: z.boolean(),
  cancelled: z.boolean(),
  terminationConfirmed: z.boolean(),
  logPath: z.string(),
});
export type ValidationResult = z.infer<typeof validationSchema>;
const issueSchema = z.strictObject({
  id,
  keys: z.array(z.string()),
  title: z.string(),
  severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'NOTE']),
  criterionIds: z.array(id),
  open: z.boolean(),
  reservationIds: z.array(id),
  paths: z.array(relativePath).optional(),
  deferredUntilMilestoneId: id.optional(),
});
export type Issue = z.infer<typeof issueSchema>;
const invocationSchema = z.strictObject({
  id,
  role: roleSchema,
  basisSha: z.string(),
  milestoneId: id.nullable(),
  round: z.number().int().nonnegative(),
  issueIds: z.array(id),
  kind: z.enum(['initial', 'repair', 'context', 'transport']),
  stepId: z.string(),
  state: z.enum(['reserved', 'exited', 'uncertain']),
  processId: z.number().int().nullable(),
  processIdentity: z.string().nullable(),
});
const eventPayloads = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('CREATED'),
    task: taskSchema,
    config: configSchema,
    mode: z.enum(['SIMULATION', 'LIVE']),
    baseSha: z.string(),
    sourceDigest: z.string(),
    manifestHash: z.string(),
  }),
  z.strictObject({ type: z.literal('PHASE'), phase: phaseSchema }),
  z.strictObject({ type: z.literal('STATUS'), status: statusSchema, reason: z.string() }),
  z.strictObject({ type: z.literal('PLAN'), milestones: z.array(milestoneSchema) }),
  z.strictObject({ type: z.literal('ROUND'), milestoneId: id }),
  z.strictObject({ type: z.literal('ISSUE'), issue: issueSchema }),
  z.strictObject({ type: z.literal('MERGE_ISSUES'), targetId: id, sourceId: id }),
  z.strictObject({ type: z.literal('RESOLVE_ISSUE'), issueId: id }),
  z.strictObject({ type: z.literal('RESERVED'), invocation: invocationSchema }),
  z.strictObject({
    type: z.literal('PROCESS'),
    invocationId: id,
    pid: z.number().int().positive(),
    identity: z.string(),
  }),
  z.strictObject({ type: z.literal('EXITED'), invocationId: id, confirmed: z.boolean() }),
  z.strictObject({ type: z.literal('RESULT'), invocationId: id, result: resultSchema }),
  z.strictObject({ type: z.literal('CANDIDATE'), sha: z.string(), digest: z.string() }),
  z.strictObject({
    type: z.literal('WRITER_RECONCILED'),
    invocationId: id,
    priorSha: z.string(),
    sha: z.string(),
    digest: z.string(),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/u),
    changedPaths: z.array(relativePath),
  }),
  z.strictObject({ type: z.literal('VALIDATION'), result: validationSchema }),
  z.strictObject({ type: z.literal('COMPLETED_MILESTONE'), milestoneId: id }),
  z.strictObject({ type: z.literal('ACTIVE'), elapsedMs: z.number().nonnegative() }),
  z.strictObject({ type: z.literal('AUDIT'), clean: z.boolean(), detail: z.string() }),
  z.strictObject({
    type: z.literal('ARTIFACTS'),
    acceptanceWritten: z.boolean(),
    handoffWritten: z.boolean(),
  }),
  z.strictObject({ type: z.literal('NOTICE'), message: z.string() }),
  z.strictObject({ type: z.literal('STEP'), key: z.string() }),
  z.strictObject({ type: z.literal('COMMAND'), key: z.string(), finished: z.boolean() }),
]);
export const eventSchema = z.strictObject({
  schemaVersion: z.literal(1),
  eventId: id,
  runId: id,
  seq: z.number().int().positive(),
  at: z.iso.datetime(),
  payload: eventPayloads,
});
export type Event = z.infer<typeof eventSchema>;
export type EventPayload = Event['payload'];
export interface RunState {
  runId: string;
  seq: number;
  status: z.infer<typeof statusSchema>;
  phase: z.infer<typeof phaseSchema>;
  reason: string;
  task: z.infer<typeof taskSchema>;
  config: z.infer<typeof configSchema>;
  mode: 'SIMULATION' | 'LIVE';
  baseSha: string;
  candidateSha: string;
  sourceDigest: string;
  candidateDigest: string;
  manifestHash: string;
  milestones: z.infer<typeof milestoneSchema>[];
  completedMilestones: string[];
  rounds: Record<string, number>;
  invocations: z.infer<typeof invocationSchema>[];
  issues: Issue[];
  results: RoleResult[];
  validations: ValidationResult[];
  steps: string[];
  pendingCommands: string[];
  activeMs: number;
  auditClean: boolean;
  acceptanceWritten: boolean;
  handoffWritten: boolean;
  notices: string[];
}
const fail = (message: string): never => {
  throw new TeamError('STATE_CORRUPT', message);
};
const budget = (message: string): never => {
  throw new TeamError('BUDGET_EXHAUSTED', message);
};
export function resolveIssue(state: RunState, key: string): Issue | undefined {
  return state.issues.find((i) => i.id === key || i.keys.includes(key));
}
/** Only explicit reconciliation may adopt the output of these interrupted writers. */
export function interruptedWriter(s: RunState): RunState['invocations'][number] {
  const reject = (): never => {
    throw new TeamError(
      'PERMISSION_DENIED',
      'Writer recovery requires an exited output-limited or timed-out writer without a result or checkpoint',
    );
  };
  if (
    s.status !== 'BLOCKED' ||
    s.phase !== 'IMPLEMENTING' ||
    s.pendingCommands.length ||
    ![
      'OUTPUT_LIMIT: Worker output cap exceeded',
      'PROCESS_TIMEOUT: Worker deadline exceeded',
    ].includes(s.reason) ||
    s.invocations.some((i) => i.state !== 'exited')
  )
    return reject();
  const call = s.invocations.at(-1);
  if (
    !call ||
    call.role !== 'implementer' ||
    !call.milestoneId ||
    !['initial', 'repair'].includes(call.kind) ||
    call.basisSha !== s.candidateSha ||
    call.round !== s.rounds[call.milestoneId] ||
    s.completedMilestones.includes(call.milestoneId) ||
    !s.milestones.some((m) => m.id === call.milestoneId) ||
    s.results.some((r) => r.invocationId === call.id) ||
    s.steps.includes(`writer:${call.milestoneId}:${call.round}`) ||
    s.invocations.some(
      (i) =>
        i.role === 'implementer' &&
        i.id !== call.id &&
        !s.steps.includes(`writer:${i.milestoneId}:${i.round}`),
    )
  )
    return reject();
  const limits = s.config.limits;
  if (
    call.round >= limits.maxRoundsPerMilestone ||
    s.invocations.length + 2 > limits.maxAgentInvocationsPerRun ||
    s.activeMs >= limits.maxActiveRuntimeMs ||
    s.issues.some((i) => i.open && i.reservationIds.length >= limits.maxRepairInvocationsPerIssue)
  ) {
    throw new TeamError(
      'BUDGET_EXHAUSTED',
      'Writer recovery cannot restore exhausted round/call/time/repair budgets',
    );
  }
  return call;
}
export function validationPassed(v: ValidationResult): boolean {
  return (
    v.exitCode === 0 &&
    !v.signal &&
    !v.timedOut &&
    !v.outputLimited &&
    !v.cancelled &&
    v.terminationConfirmed
  );
}
export function readinessProblems(
  s: RunState,
  criterionIds = s.task.acceptanceCriteria.filter((c) => c.required).map((c) => c.id),
  milestoneId?: string,
): string[] {
  const problems: string[] = [];
  if (s.pendingCommands.length) problems.push('Command execution unresolved');
  if (!s.auditClean) problems.push('Source/input/process audit missing or failed');
  if (s.invocations.some((i) => i.state !== 'exited')) problems.push('Worker running or uncertain');
  if (
    s.issues.some(
      (i) =>
        i.open &&
        !deferredForMilestone(s, i, milestoneId) &&
        (i.severity === 'CRITICAL' ||
          i.severity === 'MAJOR' ||
          i.criterionIds.some((c) => criterionIds.includes(c))),
    )
  )
    problems.push('Unresolved mandatory finding');
  const requiredChecks = new Set([
    ...s.config.validators
      .filter((v) => v.required && v.stages.includes('candidate'))
      .map((v) => v.id),
    ...s.task.acceptanceCriteria
      .filter((c) => criterionIds.includes(c.id))
      .flatMap((c) => c.validatorIds),
  ]);
  for (const commandId of requiredChecks) {
    const v = s.validations.findLast(
      (v) => v.commandId === commandId && v.candidateSha === s.candidateSha,
    );
    if (!v || !validationPassed(v))
      problems.push(`Missing passing candidate validator ${commandId}`);
  }
  const reviewer = s.results.findLast(
    (r) => r.role === 'reviewer' && r.basisSha === s.candidateSha,
  );
  const qa = s.results.findLast(
    (r) => r.role === 'qa' && r.payload.mode === 'CHECK' && r.basisSha === s.candidateSha,
  );
  for (const [role, result] of [
    ['reviewer', reviewer],
    ['qa', qa],
  ] as const) {
    if (!result || result.outcome !== 'OK' || !('assessments' in result.payload)) {
      problems.push(`Missing independent ${role} result`);
      continue;
    }
    const inv = s.invocations.find((i) => i.id === result.invocationId);
    if (!inv || inv.state !== 'exited' || inv.role !== role || !inv.processId)
      problems.push(`Missing exited ${role} process evidence`);
    for (const criterion of criterionIds) {
      const assessments = result.payload.assessments.filter((a) => a.criterionId === criterion);
      if (
        assessments.length !== 1 ||
        assessments[0]!.outcome !== 'PASS' ||
        assessments[0]!.evidenceReferences.length === 0
      )
        problems.push(`Missing ${role} PASS evidence for ${criterion}`);
    }
  }
  if (reviewer && qa) {
    const a = s.invocations.find((i) => i.id === reviewer.invocationId);
    const b = s.invocations.find((i) => i.id === qa.invocationId);
    if (a?.id === b?.id || a?.processIdentity === b?.processIdentity)
      problems.push('Review and QA are not separate processes');
  }
  if (s.activeMs >= s.config.limits.maxActiveRuntimeMs) problems.push('Active runtime exhausted');
  return problems;
}
export function finalReadinessProblems(s: RunState): string[] {
  const problems = readinessProblems(s);
  if (s.completedMilestones.length !== s.milestones.length || !s.milestones.length)
    problems.push('Milestones incomplete');
  if (!s.acceptanceWritten || !s.handoffWritten) problems.push('Handoff artifacts not durable');
  if (s.status !== 'RUNNING') problems.push('Run is stopped');
  const reviewer = s.results.findLast(
    (r) => r.role === 'reviewer' && r.basisSha === s.candidateSha,
  );
  if (reviewer?.role !== 'reviewer' || reviewer.payload.mode !== 'FULL')
    problems.push('Full cumulative review missing');
  return problems;
}
export function reduce(state: RunState | undefined, event: Event): RunState {
  const e = event.payload;
  if (!state) {
    if (event.seq !== 1 || e.type !== 'CREATED') return fail('Journal must begin with CREATED');
    return {
      runId: event.runId,
      seq: 1,
      status: 'RUNNING',
      phase: 'PREFLIGHT',
      reason: '',
      task: e.task,
      config: e.config,
      mode: e.mode,
      baseSha: e.baseSha,
      candidateSha: e.baseSha,
      sourceDigest: e.sourceDigest,
      candidateDigest: e.sourceDigest,
      manifestHash: e.manifestHash,
      milestones: [],
      completedMilestones: [],
      rounds: {},
      invocations: [],
      issues: [],
      results: [],
      validations: [],
      steps: [],
      pendingCommands: [],
      activeMs: 0,
      auditClean: false,
      acceptanceWritten: false,
      handoffWritten: false,
      notices: [],
    };
  }
  if (event.seq !== state.seq + 1 || event.runId !== state.runId || e.type === 'CREATED')
    return fail('Journal sequence or identity mismatch');
  const s = structuredClone(state);
  s.seq = event.seq;
  switch (e.type) {
    case 'PHASE':
      s.phase = e.phase;
      break;
    case 'STATUS':
      if (['CANCELLED', 'READY_FOR_HUMAN_REVIEW', 'FAILED'].includes(s.status))
        return fail('Terminal run cannot transition');
      if (e.status === 'READY_FOR_HUMAN_REVIEW' && finalReadinessProblems(state).length)
        return fail(finalReadinessProblems(state).join('; '));
      s.status = e.status;
      s.reason = e.reason;
      break;
    case 'PLAN': {
      if (s.milestones.length) return fail('Plan already frozen');
      if (!e.milestones.length || e.milestones.length > s.config.limits.maxMilestones)
        return budget('Milestone plan cap');
      const seen = new Set<string>();
      const criteria = new Set(s.task.acceptanceCriteria.map((c) => c.id));
      const covered = new Set<string>();
      for (const m of e.milestones) {
        if (seen.has(m.id) || m.dependsOn.some((d) => !seen.has(d)))
          return fail('Invalid plan IDs/dependencies');
        if (
          m.criterionIds.some((c) => !criteria.has(c)) ||
          m.validatorIds.some((v) => !s.config.validators.some((x) => x.id === v))
        )
          return fail('Unknown plan references');
        if (
          m.allowedPaths.some(
            (p) =>
              !s.task.scope.allowedPaths.some(
                (a) => a === p || (a.endsWith('/') && p.startsWith(a)),
              ) ||
              s.task.scope.forbiddenPaths.some(
                (f) => f === p || (f.endsWith('/') && p.startsWith(f)),
              ),
          )
        )
          return fail('Plan expands scope');
        seen.add(m.id);
        m.criterionIds.forEach((c) => covered.add(c));
      }
      if (s.task.acceptanceCriteria.some((c) => c.required && !covered.has(c.id)))
        return fail('Plan does not cover required criteria');
      s.milestones = e.milestones;
      break;
    }
    case 'ROUND': {
      if (s.status !== 'RUNNING') return fail('Cannot open round while stopped');
      const m = s.milestones.find((m) => m.id === e.milestoneId);
      if (
        !m ||
        s.completedMilestones.includes(m.id) ||
        m.dependsOn.some((d) => !s.completedMilestones.includes(d))
      )
        return fail('Milestone not eligible');
      const round = (s.rounds[m.id] ?? 0) + 1;
      if (round > s.config.limits.maxRoundsPerMilestone) return budget('Round limit exhausted');
      s.rounds[m.id] = round;
      break;
    }
    case 'ISSUE': {
      if (e.issue.deferredUntilMilestoneId) {
        const current = s.milestones.find(
          (m) => s.rounds[m.id] && !s.completedMilestones.includes(m.id),
        );
        if (
          !current ||
          futureMilestoneForFinding(s, current.id, e.issue, []) !== e.issue.deferredUntilMilestoneId
        )
          return fail('Invalid future finding ownership');
      }
      const existing = s.issues.find(
        (i) => i.id === e.issue.id || i.keys.some((k) => e.issue.keys.includes(k)),
      );
      if (existing) {
        existing.open = true;
        existing.title = e.issue.title;
        existing.severity =
          ['CRITICAL', 'MAJOR', 'MINOR', 'NOTE'].indexOf(existing.severity) <
          ['CRITICAL', 'MAJOR', 'MINOR', 'NOTE'].indexOf(e.issue.severity)
            ? existing.severity
            : e.issue.severity;
        existing.keys = [...new Set([...existing.keys, ...e.issue.keys, e.issue.id])];
        existing.criterionIds = [...new Set([...existing.criterionIds, ...e.issue.criterionIds])];
        existing.paths = [...new Set([...(existing.paths ?? []), ...(e.issue.paths ?? [])])];
        // Reopened/active or ambiguously merged defects cannot acquire a later due date.
        if (
          existing.deferredUntilMilestoneId !== e.issue.deferredUntilMilestoneId ||
          existing.severity === 'CRITICAL'
        )
          delete existing.deferredUntilMilestoneId;
      } else {
        if (e.issue.reservationIds.length) return fail('New issue cannot invent credits');
        s.issues.push(e.issue);
      }
      break;
    }
    case 'MERGE_ISSUES': {
      const target = resolveIssue(s, e.targetId);
      const source = resolveIssue(s, e.sourceId);
      if (!target || !source) return fail('Unknown merge issue');
      if (source.id !== target.id) {
        target.keys = [...new Set([...target.keys, ...source.keys, source.id])];
        target.reservationIds = [...new Set([...target.reservationIds, ...source.reservationIds])];
        target.criterionIds = [...new Set([...target.criterionIds, ...source.criterionIds])];
        target.open ||= source.open;
        target.paths = [...new Set([...(target.paths ?? []), ...(source.paths ?? [])])];
        delete target.deferredUntilMilestoneId; // Ambiguous aliases remain blocking; all credits survive.
        if (
          source.severity === 'CRITICAL' ||
          (source.severity === 'MAJOR' && target.severity !== 'CRITICAL')
        )
          target.severity = source.severity;
        s.issues = s.issues.filter((i) => i.id !== source.id);
      }
      break;
    }
    case 'RESOLVE_ISSUE': {
      const i = resolveIssue(s, e.issueId);
      if (!i) return fail('Unknown issue');
      i.open = false;
      break;
    }
    case 'RESERVED': {
      if (s.status !== 'RUNNING') return fail('Cannot dispatch stopped run');
      const limits = limitsSchema.parse(s.config.limits);
      const i = e.invocation;
      if (
        s.invocations.some((x) => x.id === i.id) ||
        i.state !== 'reserved' ||
        i.processId !== null ||
        i.processIdentity !== null
      )
        return fail('Invalid reservation');
      if (
        s.invocations.length >= limits.maxAgentInvocationsPerRun ||
        s.activeMs >= limits.maxActiveRuntimeMs
      )
        return budget('Invocation/active time limit exhausted');
      const active = s.invocations.filter((x) => x.state !== 'exited');
      if (
        active.length >= limits.maxConcurrentAgents ||
        active.some((x) => x.role === 'implementer') ||
        (i.role === 'implementer' && active.length)
      )
        return fail('Concurrent writer or reader limit');
      if (i.basisSha !== s.candidateSha) return fail('Stale invocation basis');
      if (i.role === 'implementer' && (!i.milestoneId || i.round !== s.rounds[i.milestoneId]))
        return fail('Writer round mismatch');
      if (i.role === 'implementer' && i.round > 1 && i.kind !== 'repair')
        return fail('Correction writer must reserve repairs');
      if (i.kind === 'repair') {
        if (i.role !== 'implementer' || !i.issueIds.length)
          return fail('Repair requires assigned issues and writer');
        const issues = new Set(i.issueIds.map((key) => resolveIssue(s, key)));
        for (const issue of issues)
          if (!issue || !issue.open) return fail('Unknown/closed repair issue');
          else if (issue.reservationIds.length >= limits.maxRepairInvocationsPerIssue)
            return budget(`Repair limit exhausted: ${issue.id}`);
        for (const issue of issues) {
          if (deferredForMilestone(s, issue!, i.milestoneId ?? undefined))
            return fail('Repair assigned before owning milestone');
          issue!.reservationIds.push(i.id);
        }
      } else if (i.issueIds.length) return fail('Issue targeting requires repair reservation');
      if (i.kind === 'context' || i.kind === 'transport') {
        const max =
          i.kind === 'context'
            ? limits.maxContextRefillsPerRoleStep
            : limits.maxTransportRetriesPerInvocation;
        if (s.invocations.filter((x) => x.stepId === i.stepId && x.kind === i.kind).length >= max)
          return budget(`${i.kind} allowance exhausted`);
        if (i.kind === 'transport' && i.role === 'implementer')
          return fail('Writer transport replay requires external nonmutation reconciliation');
      }
      s.invocations.push(i);
      s.auditClean = false;
      break;
    }
    case 'PROCESS': {
      const i = s.invocations.find((i) => i.id === e.invocationId);
      if (!i || i.state !== 'reserved' || i.processId) return fail('Invalid process start');
      i.processId = e.pid;
      i.processIdentity = e.identity;
      break;
    }
    case 'EXITED': {
      const i = s.invocations.find((i) => i.id === e.invocationId);
      if (!i) return fail('Unknown process exit');
      i.state = e.confirmed ? 'exited' : 'uncertain';
      break;
    }
    case 'RESULT': {
      const i = s.invocations.find((i) => i.id === e.invocationId);
      if (
        !i ||
        i.state !== 'exited' ||
        e.result.invocationId !== i.id ||
        e.result.role !== i.role ||
        e.result.basisSha !== i.basisSha ||
        e.result.runId !== s.runId ||
        e.result.taskId !== s.task.id
      )
        return fail('Invalid result identities/process evidence');
      if (s.results.some((r) => r.invocationId === i.id)) return fail('Duplicate result');
      s.results.push(e.result);
      break;
    }
    case 'WRITER_RECONCILED': {
      const call = interruptedWriter(state);
      if (e.invocationId !== call.id || e.priorSha !== state.candidateSha)
        return fail('Stale writer reconciliation');
      s.candidateSha = e.sha;
      s.candidateDigest = e.digest;
      s.auditClean = false;
      s.acceptanceWritten = false;
      s.handoffWritten = false;
      s.steps.push(`writer:${call.milestoneId}:${call.round}`);
      s.notices.push(
        `Explicit interrupted-writer reconciliation: ${call.id}; review token ${e.reviewToken}; adopted ${e.changedPaths.join(', ') || 'no source changes'}. No successful writer result inferred; all reservations retained; fresh validation/review/QA required.`,
      );
      s.status = 'PAUSED';
      s.phase = 'VALIDATING';
      s.reason =
        'Interrupted writer reconciled; candidate still requires validation and independent review';
      break;
    }
    case 'CANDIDATE':
      if (s.invocations.some((i) => i.state !== 'exited'))
        return fail('Candidate cannot freeze with active/uncertain worker');
      s.candidateSha = e.sha;
      s.candidateDigest = e.digest;
      s.auditClean = false;
      s.acceptanceWritten = false;
      s.handoffWritten = false;
      break;
    case 'VALIDATION':
      if (
        e.result.candidateSha !== s.candidateSha ||
        !s.config.validators.some((v) => v.id === e.result.commandId)
      )
        return fail('Unknown/stale validator evidence');
      s.validations.push(e.result);
      break;
    case 'COMPLETED_MILESTONE':
      if (
        !s.milestones.some((m) => m.id === e.milestoneId) ||
        s.completedMilestones.includes(e.milestoneId)
      )
        return fail('Invalid milestone completion');
      s.completedMilestones.push(e.milestoneId);
      break;
    case 'ACTIVE':
      s.activeMs += e.elapsedMs;
      break;
    case 'AUDIT':
      s.auditClean = e.clean;
      if (!e.clean) s.notices.push(e.detail);
      break;
    case 'ARTIFACTS':
      s.acceptanceWritten = e.acceptanceWritten;
      s.handoffWritten = e.handoffWritten;
      break;
    case 'NOTICE':
      s.notices.push(e.message);
      break;
    case 'STEP':
      if (!s.steps.includes(e.key)) s.steps.push(e.key);
      break;
    case 'COMMAND':
      s.pendingCommands = e.finished
        ? s.pendingCommands.filter((k) => k !== e.key)
        : [...s.pendingCommands, e.key];
      break;
  }
  return s;
}
export const acceptanceRecordSchema = z.strictObject({
  candidateSha: z.string(),
  assessments: z.array(assessmentSchema),
});
