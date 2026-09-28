import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { configSchema, id, profileSchema, TeamError } from '../domain/schemas.js';
import type { ProjectConfig, Role } from '../domain/schemas.js';
import type { RunState } from '../domain/state.js';
import { interruptedWriter } from '../domain/state.js';
import { hash, Journal, replay, verifyInputs } from '../persistence/journal.js';
import { inspectLock, OwnershipLock, recoverDeadLock } from '../persistence/locks.js';
import { CodexAdapter } from '../providers/codex.js';
import { ClaudeAdapter } from '../providers/claude.js';
import { mockAdapter } from '../providers/mock.js';
import { childEnvironment, groupAlive, processIdentity, redact } from '../process/supervisor.js';
import { Engine, startRun } from '../orchestration/engine.js';
import type { Adapters, RunOptions } from '../orchestration/engine.js';
import {
  canonical,
  git,
  prospectiveCanonical,
  safePath,
  treeSnapshot,
  within,
  Workspace,
} from '../workspace/git.js';
import type { TreeSnapshot } from '../workspace/git.js';
import { inspectWriterRecovery } from './writer-recovery.js';
import { contextRepairToReconcile } from './context-recovery.js';
import { validationEvidence } from '../orchestration/evidence.js';
import { renderHandoff } from '../reporting/report.js';
const exec = promisify(execFile);
export const adapters = (): Adapters => ({
  codex: new CodexAdapter(),
  claude: new ClaudeAdapter(),
  mock: mockAdapter(),
});
export function stateRoot(): string {
  const path =
    process.env.AI_TEAM_HOME ?? join(homedir(), 'Library', 'Application Support', 'AI Team');
  if (!isAbsolute(path)) throw new TeamError('INVALID_INPUT', 'AI_TEAM_HOME must be absolute');
  return path;
}
export async function doctor(bindings = adapters()) {
  let gitVersion: string | null = null;
  try {
    gitVersion = (
      await exec('git', ['--version'], {
        env: childEnvironment(),
        timeout: 5000,
        maxBuffer: 262144,
      })
    ).stdout.trim();
  } catch {
    /* reported unavailable */
  }
  const providers = [];
  for (const provider of ['codex', 'claude'] as const)
    if (bindings[provider]) providers.push(await bindings[provider]!.probe());
  return {
    node: process.version,
    nodeSupported: Number(process.versions.node.split('.')[0]) >= 22,
    platform: process.platform,
    git: gitVersion,
    providers,
    modelInvocations: 0,
  };
}
export async function initProject(
  repoPath: string,
  profileInput: string,
  rootPath = stateRoot(),
): Promise<string> {
  const profile = profileSchema.parse(profileInput);
  const repo = await canonical(repoPath);
  let top: string;
  try {
    top = (await git(repo, ['rev-parse', '--show-toplevel'])).trim();
    await git(repo, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    throw new TeamError(
      'INVALID_INPUT',
      'Target needs a minimal scaffold and initial Git commit; initialize it explicitly first',
    );
  }
  if ((await realpath(top)) !== repo)
    throw new TeamError('INVALID_INPUT', 'Select the checkout root');
  if (!isAbsolute(rootPath)) throw new TeamError('INVALID_INPUT', 'State root must be absolute');
  const resolved = await prospectiveCanonical(rootPath);
  if (within(resolved, repo) || within(repo, resolved))
    throw new TeamError('INVALID_INPUT', 'State root and target must be separate');
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const root = await realpath(resolved);
  const projectId = `project-${hash(repo).slice(0, 24)}`;
  const directory = join(root, 'projects', projectId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const roleBindings = Object.fromEntries(
    (['architect', 'implementer', 'reviewer', 'qa'] as Role[]).map((role) => [
      role,
      {
        provider:
          profile === 'mixed'
            ? role === 'architect' || role === 'reviewer'
              ? 'claude'
              : 'codex'
            : profile === 'mock'
              ? 'mock'
              : profile === 'codex-only'
                ? 'codex'
                : 'claude',
        model: null,
      },
    ]),
  );
  const validators: ProjectConfig['validators'] = [];
  const setupCommands: ProjectConfig['setupCommands'] = [];
  try {
    const packagePath = await safePath(repo, 'package.json');
    const pkg: unknown = JSON.parse(await readFile(packagePath, 'utf8'));
    if (
      pkg &&
      typeof pkg === 'object' &&
      'scripts' in pkg &&
      pkg.scripts &&
      typeof pkg.scripts === 'object'
    ) {
      for (const name of ['build', 'typecheck', 'test', 'lint'])
        if (name in pkg.scripts)
          validators.push({
            id: name === 'test' ? 'unit' : name,
            executable: 'npm',
            args: ['run', name],
            cwd: '.',
            approved: false,
            timeoutMs: 180000,
            required: true,
            stages: ['baseline', 'candidate'],
            allowedOutputPaths: [],
          });
    }
    try {
      await stat(await safePath(repo, 'package-lock.json'));
      setupCommands.push({
        id: 'dependencies',
        executable: 'npm',
        args: ['ci'],
        cwd: '.',
        approved: false,
        timeoutMs: 600000,
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const config = configSchema.parse({
    schemaVersion: 1,
    projectId,
    repositoryPath: repo,
    stateRoot: root,
    profile,
    roleBindings,
    setupCommands,
    validators,
    protectedPaths: [],
    authPolicy: { route: 'saved-cli-login', allowApiFallback: false, allowCloudEndpoints: false },
    limits: {},
    approval: { reviewedAt: null },
  });
  const path = join(directory, 'config.json');
  await writeFile(path, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'registration.json'), JSON.stringify({ repositoryPath: repo }), {
    flag: 'wx',
    mode: 0o600,
  });
  return path;
}
export async function runFiles(
  configPath: string,
  taskPath: string,
  options: RunOptions,
  bindings = adapters(),
) {
  if (!isAbsolute(configPath) || !isAbsolute(taskPath) || !taskPath.endsWith('.md'))
    throw new TeamError('INVALID_INPUT', 'Select absolute config and Markdown task paths');
  const configText = await readFile(configPath, 'utf8');
  const task = await readFile(taskPath, 'utf8');
  return startRun(JSON.parse(configText), task, bindings, {
    ...options,
    inputOrigins: {
      configPath: await realpath(configPath),
      taskPath: await realpath(taskPath),
      configHash: hash(configText),
      taskHash: hash(task),
    },
  });
}
export async function readRun(
  runId: string,
  rootPath = stateRoot(),
): Promise<{ directory: string; state: RunState; trailing: boolean; lastAt: string }> {
  id.parse(runId);
  const root = await canonical(rootPath);
  const directory = await safePath(root, `runs/${runId}`);
  const result = replay(await readFile(await safePath(directory, 'events.jsonl'), 'utf8'));
  if (!result.state || result.state.runId !== runId)
    throw new TeamError('STATE_CORRUPT', 'Run identity missing or mismatched');
  return {
    directory,
    state: result.state,
    trailing: !!result.trailing,
    lastAt: result.events.at(-1)!.at,
  };
}
export async function writerRecoveryStatus(runId: string, rootPath = stateRoot()) {
  const record = await readRun(runId, rootPath);
  if (record.trailing)
    throw new TeamError('STATE_CORRUPT', 'Incomplete journal; reconcile before writer inspection');
  const report = await inspectWriterRecovery(record.directory, record.state);
  return {
    runId: report.runId,
    invocationId: report.invocationId,
    milestoneId: report.milestoneId,
    round: report.round,
    priorSha: report.priorSha,
    candidateDigest: report.candidateDigest,
    reviewToken: report.reviewToken,
    changedPaths: report.changedPaths,
    candidateWorktree: report.candidateWorktree,
    evidenceDirectory: report.evidenceDirectory,
    notice: report.notice,
  };
}
export async function runStatus(runId: string, rootPath = stateRoot()) {
  const record = await readRun(runId, rootPath);
  const s = record.state;
  return {
    ...s,
    evidenceDirectory: record.directory,
    candidateWorktree: join(record.directory, 'worktrees/implementation'),
    incompleteTrailingRecord: record.trailing,
    owner: await inspectLock(join(record.directory, 'lock')),
  };
}
async function acquireRecovery(directory: string, config: ProjectConfig) {
  const common = (
    await git(config.repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim();
  const repoLock = new OwnershipLock(
    join(config.stateRoot, 'locks', `${hash(await realpath(common))}.lock`),
  );
  const locks = [
    new OwnershipLock(join(common, 'ai-team-controller.lock')),
    repoLock,
    new OwnershipLock(join(directory, 'lock')),
  ];
  const acquired: OwnershipLock[] = [];
  try {
    for (const lock of locks) {
      await recoverDeadLock(lock.directory);
      await lock.acquire();
      acquired.push(lock);
    }
  } catch (error) {
    for (const lock of acquired.reverse()) await lock.release();
    throw error;
  }
  return locks;
}
export async function resumeRun(
  runId: string,
  options: RunOptions,
  bindings = adapters(),
  rootPath = stateRoot(),
) {
  const record = await readRun(runId, rootPath);
  const s = record.state;
  if (!options.ackTrustedLocal || (s.mode === 'LIVE' && !options.allowProviderCalls))
    throw new TeamError(
      'PERMISSION_DENIED',
      'Resume requires trusted-local acknowledgement and live flag for live bindings',
    );
  if (!['PAUSED', 'BLOCKED', 'RUNNING'].includes(s.status))
    throw new TeamError('INVALID_INPUT', `Cannot resume ${s.status}`);
  if (options.reconcileContext && options.reconcileWriter !== undefined)
    throw new TeamError('INVALID_INPUT', 'Choose one reconciliation mode');
  if (options.reconcileWriter !== undefined && !/^[a-f0-9]{64}$/u.test(options.reconcileWriter))
    throw new TeamError(
      'INVALID_INPUT',
      'Writer recovery requires the reviewed 64-character token',
    );
  const writerRecovery = options.reconcileWriter !== undefined ? interruptedWriter(s) : undefined;
  const contextRepair = options.reconcileContext ? contextRepairToReconcile(s) : undefined;
  if (
    s.status === 'BLOCKED' &&
    !contextRepair &&
    !writerRecovery &&
    !/^(UNSUPPORTED_CAPABILITY|AUTH_REQUIRED|RATE_LIMITED):/u.test(s.reason)
  )
    throw new TeamError('PERMISSION_DENIED', `Human reconciliation required: ${s.reason}`);
  if ((await realpath(s.config.stateRoot)) !== (await realpath(rootPath)))
    throw new TeamError('STATE_CORRUPT', 'Frozen state root mismatch');
  await verifyInputs(record.directory, s.manifestHash);
  const locks = await acquireRecovery(record.directory, s.config);
  const journal = new Journal(record.directory, runId, s.config.limits.maxArtifactBytesPerRun);
  try {
    await journal.load();
    if (journal.state!.seq !== s.seq && !record.trailing)
      throw new TeamError('STATE_CORRUPT', 'Run changed while acquiring ownership');
    if (s.pendingCommands.length)
      throw new TeamError(
        'STATE_CORRUPT',
        'Interrupted setup/validator ownership is uncertain; human reconciliation required',
      );
    for (const invocation of s.invocations.filter((i) => i.state !== 'exited')) {
      if (!invocation.processId || !invocation.processIdentity)
        throw new TeamError(
          'STATE_CORRUPT',
          'Reserved invocation has uncertain dispatch; reservation remains consumed',
        );
      const actual = await processIdentity(invocation.processId);
      if (actual !== null || (await groupAlive(invocation.processId)))
        throw new TeamError(
          'STATE_CORRUPT',
          'Worker ownership/termination remains uncertain; no kill or replacement',
        );
      await journal.append({ type: 'EXITED', invocationId: invocation.id, confirmed: true });
      if (invocation.role === 'implementer')
        throw new TeamError(
          'INPUT_CHANGED',
          'Interrupted writer requires human reconciliation; no replay',
        );
    }
    const recovery = JSON.parse(
      await readFile(join(record.directory, 'inputs/recovery.json'), 'utf8'),
    ) as { sourceSnapshot: TreeSnapshot; origins: RunOptions['inputOrigins'] | null };
    const workspace = Workspace.restore(
      s.config.repositoryPath,
      join(record.directory, 'worktrees'),
      s.baseSha,
      recovery.sourceSnapshot,
      runId,
    );
    await workspace.assertSource();
    const candidate = await treeSnapshot(workspace.implementation, [
      'node_modules/',
      ...s.config.validators.flatMap((v) => v.allowedOutputPaths),
    ]);
    const unrelatedRefs = (refs: string) =>
      refs
        .split('\n')
        .filter((line) => !line.startsWith(`refs/heads/${workspace.branch} `))
        .join('\n');
    if (unrelatedRefs(candidate.refs) !== unrelatedRefs(recovery.sourceSnapshot.refs))
      throw new TeamError('INPUT_CHANGED', 'Nonmanaged Git refs changed while stopped');
    if (
      candidate.head !== s.candidateSha ||
      (!writerRecovery && candidate.digest !== s.candidateDigest) ||
      (await git(workspace.implementation, ['symbolic-ref', '--short', 'HEAD'])).trim() !==
        workspace.branch
    )
      throw new TeamError(
        'INPUT_CHANGED',
        'Candidate has unverified changes; preserve them for human reconciliation',
      );
    if (
      s.invocations.some(
        (i) =>
          i.role === 'implementer' &&
          i.id !== contextRepair?.id &&
          i.id !== writerRecovery?.id &&
          !s.steps.includes(`writer:${i.milestoneId}:${i.round}`),
      )
    )
      throw new TeamError('INPUT_CHANGED', 'Writer checkpoint is incomplete; no automatic replay');
    if (s.status === 'RUNNING')
      await journal.append({
        type: 'ACTIVE',
        elapsedMs: Math.max(0, Date.now() - Date.parse(record.lastAt)),
      });
    if (
      journal.state!.activeMs >= s.config.limits.maxActiveRuntimeMs ||
      s.invocations.length >= s.config.limits.maxAgentInvocationsPerRun
    )
      throw new TeamError('BUDGET_EXHAUSTED', 'Preserved run budget exhausted');
    if (recovery.origins)
      for (const kind of ['task', 'config'] as const) {
        let diverged = false;
        try {
          diverged =
            hash(await readFile(recovery.origins[`${kind}Path`])) !==
            recovery.origins[`${kind}Hash`];
        } catch {
          diverged = true;
        }
        if (diverged)
          await journal.append({
            type: 'NOTICE',
            message: `External ${kind} input changed or unavailable; continuing with the immutable internal snapshot`,
          });
      }
    if (writerRecovery) {
      const report = await inspectWriterRecovery(record.directory, journal.state!);
      if (report.reviewToken !== options.reconcileWriter)
        throw new TeamError(
          'INPUT_CHANGED',
          'Writer recovery token is stale; inspect and review the current candidate',
        );
      if (options.signal?.aborted)
        throw new TeamError('CANCELLED', 'Recovery cancelled before checkpoint');
      for (const lock of locks) await lock.assertOwned();
      await verifyInputs(record.directory, s.manifestHash);
      const checkpoint = await workspace.checkpoint(
        report.before,
        report.scope,
        s.config.protectedPaths,
        report.changedPaths,
        report.outputs,
        report.candidateDigest,
      );
      if (checkpoint.snapshot.digest !== report.candidateDigest)
        throw new TeamError('INPUT_CHANGED', 'Candidate changed during recovery checkpoint');
      await journal.append({
        type: 'WRITER_RECONCILED',
        invocationId: writerRecovery.id,
        priorSha: s.candidateSha,
        sha: checkpoint.sha,
        digest: checkpoint.snapshot.digest,
        reviewToken: report.reviewToken,
        changedPaths: report.changedPaths,
      });
    }
    if (contextRepair) {
      // Even recorded exits are cross-checked for this explicit recovery; never kill a reused PID.
      for (const invocation of s.invocations) {
        if (
          !invocation.processId ||
          !invocation.processIdentity ||
          (await processIdentity(invocation.processId)) === invocation.processIdentity ||
          (await groupAlive(invocation.processId))
        )
          throw new TeamError('STATE_CORRUPT', 'Context recovery cannot confirm all worker exits');
      }
      await validationEvidence(
        record.directory,
        s,
        Math.floor(s.config.limits.maxInputBytesPerInvocation / 5),
      );
      await journal.append({
        type: 'NOTICE',
        message: `Explicit context reconciliation: ${contextRepair.id} exited without changes at ${s.candidateSha}; consumed repair retained. Close unchanged failed round ${contextRepair.round}; next round must reserve another credit. Frozen inputs remain unchanged.`,
      });
      await journal.append({
        type: 'STEP',
        key: `writer:${contextRepair.milestoneId}:${contextRepair.round}`,
      });
      await journal.append({
        type: 'STEP',
        key: `decision:${contextRepair.milestoneId}:${contextRepair.round}`,
      });
    }
    await journal.append({
      type: 'STATUS',
      status: 'RUNNING',
      reason: 'Explicit resume after ownership, inputs and candidate reconciliation',
    });
    await new Engine(journal, workspace, bindings, options, locks).execute();
    return { state: journal.state!, directory: record.directory, workspace };
  } catch (error) {
    if (journal.state && ['RUNNING', 'PAUSED', 'BLOCKED'].includes(journal.state.status))
      await journal.append({
        type: 'STATUS',
        status: 'BLOCKED',
        reason: `${error instanceof TeamError ? error.code : 'UNKNOWN'}: ${error instanceof Error ? error.message : String(error)}`,
      });
    throw error;
  } finally {
    for (const lock of locks.reverse()) await lock.release();
  }
}
export async function cancelRun(runId: string, rootPath = stateRoot()) {
  const { directory, state } = await readRun(runId, rootPath);
  if (['CANCELLED', 'READY_FOR_HUMAN_REVIEW', 'FAILED'].includes(state.status))
    throw new TeamError('INVALID_INPUT', `Cannot cancel terminal ${state.status}`);
  if ((await inspectLock(join(directory, 'lock'))) === 'live') {
    await writeFile(join(directory, 'cancel.request'), 'Explicit user cancellation\n', {
      flag: 'wx',
      mode: 0o600,
    }).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    });
    return { runId, cancellationRequested: true };
  }
  const locks = await acquireRecovery(directory, state.config);
  try {
    const journal = new Journal(directory, runId, state.config.limits.maxArtifactBytesPerRun);
    await journal.load();
    if (
      journal.state!.pendingCommands.length ||
      journal.state!.invocations.some((i) => i.state !== 'exited')
    )
      throw new TeamError(
        'STATE_CORRUPT',
        'Cannot confirm all child exits; human reconciliation required',
      );
    await journal.append({
      type: 'STATUS',
      status: 'CANCELLED',
      reason: 'Explicit user cancellation of stopped run',
    });
    return { runId, status: journal.state!.status };
  } finally {
    for (const lock of locks.reverse()) await lock.release();
  }
}
export async function exportRun(
  runId: string,
  destination: string,
  rootPath = stateRoot(),
): Promise<string> {
  const { directory, state } = await readRun(runId, rootPath);
  const root = await canonical(rootPath);
  const target = await canonical(destination);
  if (within(target, root))
    throw new TeamError(
      'PERMISSION_DENIED',
      'Export cannot enter authoritative state or worktrees',
    );
  const repositories = new Set([state.config.repositoryPath]);
  const entries = await readdir(join(root, 'projects'), { withFileTypes: true }).catch((e) => {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new TeamError('STATE_CORRUPT', 'Invalid project registry entry');
    const path = await safePath(root, `projects/${entry.name}/registration.json`);
    const registration: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (
      !registration ||
      typeof registration !== 'object' ||
      !('repositoryPath' in registration) ||
      typeof registration.repositoryPath !== 'string'
    )
      throw new TeamError('STATE_CORRUPT', 'Invalid registration');
    repositories.add(await canonical(registration.repositoryPath));
  }
  for (const repo of repositories)
    if (within(target, await canonical(repo)))
      throw new TeamError('PERMISSION_DENIED', 'Export cannot enter a registered target');
  const output = await mkdtemp(join(target, `${runId}-export-`));
  const summary = renderHandoff(
    state,
    join(directory, 'worktrees/implementation'),
    `ai-team/${runId}`,
  );
  await writeFile(
    join(output, 'SUMMARY.md'),
    redact(
      summary +
        '\nExport is a read-only snapshot. Editing this note grants no approval or continuation. Paths, project names and SHAs may be sensitive in a synced vault.\n',
    ),
    { flag: 'wx', mode: 0o600 },
  );
  return join(output, 'SUMMARY.md');
}
export function runExitCode(status: RunState['status']): number {
  return {
    RUNNING: 3,
    READY_FOR_HUMAN_REVIEW: 0,
    BLOCKED: 3,
    PAUSED: 4,
    FAILED: 5,
    CANCELLED: 130,
  }[status];
}
