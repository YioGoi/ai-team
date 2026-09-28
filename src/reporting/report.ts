import type { RunState } from '../domain/state.js';
import { validationPassed } from '../domain/state.js';
import { redact } from '../process/supervisor.js';
export function renderHandoff(s: RunState, worktree: string, branch: string): string {
  const checks = s.validations
    .map(
      (v) =>
        `- ${v.commandId}: ${validationPassed(v) ? 'PASS' : 'FAIL'}; candidate ${v.candidateSha}; exit ${v.exitCode}; command ${JSON.stringify(v.argv)}; evidence ${v.logPath}`,
    )
    .join('\n');
  const issues =
    s.issues
      .map(
        (i) =>
          `- ${i.id}: ${i.severity} ${i.open ? 'OPEN' : 'RESOLVED'} ${i.title}; owner milestone ${i.deferredUntilMilestoneId ?? 'current/unassigned'}; repair reservations ${i.reservationIds.length}/${s.config.limits.maxRepairInvocationsPerIssue}`,
      )
      .join('\n') || '- None recorded';
  const criteria = s.task.acceptanceCriteria
    .map((c) => `- ${c.id}: ${c.text}\n  Human review: ${c.humanReview}`)
    .join('\n');
  return redact(
    `# AI Team handoff: ${s.task.title}\n\nRun: ${s.runId}\nProject: ${s.config.projectId}\nTask: ${s.task.id}\nSnapshot: ${new Date().toISOString()}\nStatus: ${s.status}\nPhase: ${s.phase}\nVerification: ${s.mode}\nProfile: ${s.config.profile}\nReason: ${s.reason}\n\nCandidate worktree: ${worktree}\nBranch: ${branch}\nBase: ${s.baseSha}\nCandidate: ${s.candidateSha}\nCumulative diff: artifacts/candidate.patch (git diff ${s.baseSha} ${s.candidateSha})\n\n## Criteria and human review focus\n\n${criteria}\n\n## Executed checks\n\n${checks || '- None'}\n\n## Findings\n\n${issues}\n\n## Consumed limits\n\nCalls reserved: ${s.invocations.length}/${s.config.limits.maxAgentInvocationsPerRun}\nRounds: ${JSON.stringify(s.rounds)}\nActive elapsed milliseconds: ${s.activeMs}/${s.config.limits.maxActiveRuntimeMs}\n\n## Limitations and supplementary manual smoke\n\n${s.results
      .filter((r) => r.role === 'qa')
      .flatMap((r) => (r.role === 'qa' ? r.payload.manualSmokeSteps : []))
      .map((x) => '- UNEXECUTED human procedure: ' + x)
      .join(
        '\n',
      )}\n\n${s.notices.map((n) => '- ' + n).join('\n')}\n\nWorktrees separate working copies; they do not sandbox hostile same-user code. Approved repository scripts can access local resources. Provider calls use remote services and their account limits; token/currency totals and remaining subscription quota are unknown unless explicitly reported. SIMULATION is never live-provider proof. Final approval and integration belong to the human; no merge, push or deployment occurred.\n`,
  );
}
