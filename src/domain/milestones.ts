import { inScope } from './schemas.js';
import type { Issue, RunState } from './state.js';

export function assessmentCriterionIds(state: RunState, milestoneId: string): string[] {
  const due = state.milestones.filter(
    (m) => m.id === milestoneId || state.completedMilestones.includes(m.id),
  );
  return [...new Set(due.flatMap((m) => m.criterionIds))];
}

/** Only future-only, unchanged, located work with an unambiguous scoped owner may wait. */
export function futureMilestoneForFinding(
  state: RunState,
  currentId: string,
  finding: Pick<Issue, 'severity' | 'criterionIds' | 'paths'>,
  changed: string[],
): string | undefined {
  const current = state.milestones.findIndex((m) => m.id === currentId);
  const due = assessmentCriterionIds(state, currentId);
  const paths = finding.paths ?? [];
  if (
    current < 0 ||
    finding.severity === 'CRITICAL' ||
    !finding.criterionIds.length ||
    !paths.length ||
    finding.criterionIds.some((c) => due.includes(c)) ||
    paths.some((p) => changed.includes(p))
  )
    return undefined;
  const owner = state.milestones.find(
    (m, index) =>
      index > current &&
      finding.criterionIds.every((c) => m.criterionIds.includes(c)) &&
      paths.every((p) =>
        inScope(p, {
          allowedPaths: m.allowedPaths,
          forbiddenPaths: [...state.task.scope.forbiddenPaths, ...state.config.protectedPaths],
        }),
      ) &&
      // An earlier milestone able to edit these locations makes future-only ownership ambiguous.
      !state.milestones
        .slice(0, index)
        .some((earlier) =>
          paths.some((p) => inScope(p, { allowedPaths: earlier.allowedPaths, forbiddenPaths: [] })),
        ),
  );
  return owner?.id;
}

export function deferredForMilestone(state: RunState, issue: Issue, currentId?: string): boolean {
  if (
    !currentId ||
    !issue.deferredUntilMilestoneId ||
    issue.reservationIds.length >= state.config.limits.maxRepairInvocationsPerIssue
  )
    return false;
  return futureMilestoneForFinding(state, currentId, issue, []) === issue.deferredUntilMilestoneId;
}
