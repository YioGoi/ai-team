import { TeamError } from '../domain/schemas.js';
import type { RunState } from '../domain/state.js';
import { currentValidations } from '../orchestration/evidence.js';

/** Explicitly close a verified, nonmutating failed repair; never replay or refund it. */
export function contextRepairToReconcile(s: RunState): RunState['invocations'][number] {
  const reject = (): never => {
    throw new TeamError(
      'PERMISSION_DENIED',
      'Context reconciliation only accepts an exited repair requesting its current failed validator log',
    );
  };
  if (
    s.status !== 'BLOCKED' ||
    s.phase !== 'IMPLEMENTING' ||
    s.pendingCommands.length ||
    s.invocations.some((i) => i.state !== 'exited')
  )
    return reject();
  const call = s.invocations.at(-1);
  const result = s.results.at(-1);
  if (
    !call ||
    call.role !== 'implementer' ||
    call.kind !== 'repair' ||
    !call.milestoneId ||
    !call.issueIds.length ||
    call.basisSha !== s.candidateSha ||
    call.round !== s.rounds[call.milestoneId] ||
    s.completedMilestones.includes(call.milestoneId) ||
    !result ||
    result.invocationId !== call.id ||
    result.role !== 'implementer' ||
    result.outcome !== 'NEEDS_CONTEXT' ||
    result.payload.declaredChangedPaths.length ||
    !result.requestedContextPaths.length
  )
    return reject();
  const failed = currentValidations(s).filter(
    (v) =>
      v.exitCode !== 0 &&
      call.issueIds.some((id) =>
        s.issues.some((i) => i.id === id && i.keys.includes(`validator:${v.commandId}`)),
      ),
  );
  if (!result.requestedContextPaths.every((path) => failed.some((v) => v.logPath === path)))
    return reject();
  const legacyMissingLog =
    s.reason.startsWith('UNKNOWN: ENOENT:') &&
    result.requestedContextPaths.some((path) => s.reason.includes('/' + path));
  if (
    !legacyMissingLog &&
    !/^INVALID_RESULT: (Repair context refill requires human reconciliation|Context refill allowance exhausted)/u.test(
      s.reason,
    )
  )
    return reject();
  const limits = s.config.limits;
  if (
    call.round >= limits.maxRoundsPerMilestone ||
    s.invocations.length >= limits.maxAgentInvocationsPerRun ||
    s.activeMs >= limits.maxActiveRuntimeMs ||
    call.issueIds.some((id) => {
      const issue = s.issues.find((i) => i.id === id);
      return (
        !issue?.open ||
        !issue.reservationIds.includes(call.id) ||
        issue.reservationIds.length >= limits.maxRepairInvocationsPerIssue
      );
    })
  ) {
    throw new TeamError(
      'BUDGET_EXHAUSTED',
      'Context reconciliation cannot restore exhausted repair/round/call/time budgets',
    );
  }
  return call;
}
