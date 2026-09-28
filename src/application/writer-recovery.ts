import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { interruptedWriter } from '../domain/state.js';
import type { RunState } from '../domain/state.js';
import { TeamError } from '../domain/schemas.js';
import { hash, verifyInputs } from '../persistence/journal.js';
import { groupAlive, processIdentity } from '../process/supervisor.js';
import { auditChanges, committedSnapshot, git, treeSnapshot, Workspace } from '../workspace/git.js';
import type { TreeSnapshot } from '../workspace/git.js';

/** Inspection has no inference, source writes, Git worktree creation, or journal mutation. */
export async function inspectWriterRecovery(directory: string, state: RunState) {
  const call = interruptedWriter(state);
  await verifyInputs(directory, state.manifestHash);
  for (const invocation of state.invocations) {
    if (
      !invocation.processId ||
      !invocation.processIdentity ||
      (await processIdentity(invocation.processId)) === invocation.processIdentity ||
      (await groupAlive(invocation.processId))
    ) {
      throw new TeamError('STATE_CORRUPT', 'Writer recovery cannot confirm all worker exits');
    }
  }
  const recovery = JSON.parse(await readFile(join(directory, 'inputs/recovery.json'), 'utf8')) as {
    sourceSnapshot: TreeSnapshot;
  };
  const workspace = Workspace.restore(
    state.config.repositoryPath,
    join(directory, 'worktrees'),
    state.baseSha,
    recovery.sourceSnapshot,
    state.runId,
  );
  await workspace.assertSource();
  const outputs = [
    'node_modules/',
    ...state.config.validators.flatMap((v) => v.allowedOutputPaths),
  ];
  const candidate = await treeSnapshot(workspace.implementation, outputs);
  const expectedRefs = recovery.sourceSnapshot.refs
    .split('\n')
    .map((line) =>
      line.startsWith(`refs/heads/${workspace.branch} `)
        ? `refs/heads/${workspace.branch} ${state.candidateSha}`
        : line,
    )
    .join('\n');
  if (
    candidate.head !== state.candidateSha ||
    candidate.refs !== expectedRefs ||
    (await git(workspace.implementation, ['symbolic-ref', '--short', 'HEAD'])).trim() !==
      workspace.branch
  ) {
    throw new TeamError('INPUT_CHANGED', 'Writer recovery rejects changed HEAD, branch or refs');
  }
  if ((await git(workspace.implementation, ['diff', '--cached', '--name-only'])).trim()) {
    throw new TeamError('INPUT_CHANGED', 'Writer recovery requires an unchanged Git index');
  }
  const raw = await git(workspace.implementation, [
    'diff',
    '--raw',
    '--no-ext-diff',
    '--no-textconv',
  ]);
  if (
    raw.split('\n').some((line) => {
      const modes = /^:(\d+) (\d+) /u.exec(line);
      return modes && modes[1] !== modes[2] && modes[2] !== '000000';
    })
  )
    throw new TeamError('SCOPE_VIOLATION', 'Writer recovery rejects file-mode changes');
  const before = await committedSnapshot(
    workspace.implementation,
    state.candidateSha,
    expectedRefs,
  );
  if (before.digest !== state.candidateDigest)
    throw new TeamError(
      'INPUT_CHANGED',
      'Recorded candidate differs from its commit; cannot reconstruct writer basis',
    );
  const milestone = state.milestones.find((m) => m.id === call.milestoneId)!;
  const scope = { ...state.task.scope, allowedPaths: milestone.allowedPaths };
  const changedPaths = auditChanges(before, candidate, scope, state.config.protectedPaths);
  const reviewToken = hash(
    JSON.stringify({
      runId: state.runId,
      invocationId: call.id,
      manifestHash: state.manifestHash,
      head: candidate.head,
      refs: candidate.refs,
      digest: candidate.digest,
      changedPaths,
    }),
  );
  return {
    runId: state.runId,
    invocationId: call.id,
    milestoneId: call.milestoneId,
    round: call.round,
    priorSha: state.candidateSha,
    candidateDigest: candidate.digest,
    reviewToken,
    changedPaths,
    candidateWorktree: workspace.implementation,
    evidenceDirectory: directory,
    notice:
      'Review all changed and new files before resuming with this token. This does not approve the product or replace validation.',
    before,
    scope,
    outputs,
  };
}
