import { randomUUID } from 'node:crypto';
import type { ProjectConfig } from '../domain/schemas.js';
import { TeamError } from '../domain/schemas.js';
import type { ValidationResult } from '../domain/state.js';
import { hash, Journal } from '../persistence/journal.js';
import { childEnvironment, redact, supervise } from '../process/supervisor.js';
import { assertUnmutated, safePath, treeSnapshot } from '../workspace/git.js';
export async function runValidator(
  config: ProjectConfig,
  commandId: string,
  workspace: string,
  candidateSha: string,
  journal: Journal,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const command = config.validators.find((v) => v.id === commandId);
  if (!command?.approved)
    throw new TeamError('PERMISSION_DENIED', `Validator not approved: ${commandId}`);
  const frozen = journal.state?.config.validators.find((v) => v.id === commandId);
  if (!frozen || hash(JSON.stringify(frozen)) !== hash(JSON.stringify(command)))
    throw new TeamError(
      'INPUT_CHANGED',
      'Approved validator definition differs from frozen inputs',
    );
  const before = await treeSnapshot(workspace, ['node_modules/', ...command.allowedOutputPaths]);
  if (before.head !== candidateSha)
    throw new TeamError('INPUT_CHANGED', 'Validator candidate SHA mismatch');
  const cwd = await safePath(workspace, command.cwd);
  const commandKey = `command-${randomUUID()}`;
  await journal.append({ type: 'COMMAND', key: commandKey, finished: false });
  const result = await supervise(
    { executable: command.executable, args: command.args, cwd, stdin: '', env: childEnvironment() },
    {
      timeoutMs: Math.min(command.timeoutMs, config.limits.validatorTimeoutMs),
      graceMs: config.limits.terminationGraceMs,
      maxInputBytes: config.limits.maxInputBytesPerInvocation,
      maxStdoutBytes: config.limits.maxStdoutBytesPerInvocation,
      maxStderrBytes: config.limits.maxStderrBytesPerInvocation,
      ...(signal ? { signal } : {}),
    },
  );
  if (result.terminationConfirmed)
    await journal.append({ type: 'COMMAND', key: commandKey, finished: true });
  const id = `validation-${randomUUID()}`;
  const logPath = `validation/${id}/output.log`;
  const record: ValidationResult = {
    id,
    commandId,
    commandHash: hash(JSON.stringify(command)),
    candidateSha,
    argv: [command.executable, ...command.args].map(redact),
    cwd,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputLimited: result.outputLimited,
    cancelled: result.cancelled,
    terminationConfirmed: result.terminationConfirmed,
    logPath,
  };
  await journal.writeArtifact(logPath, result.stdout + '\n' + result.stderr);
  await journal.writeArtifact(`validation/${id}/result.json`, JSON.stringify(record, null, 2));
  assertUnmutated(
    before,
    await treeSnapshot(workspace, ['node_modules/', ...command.allowedOutputPaths]),
  );
  await journal.append({ type: 'VALIDATION', result: record });
  return record;
}

export async function runSetup(
  config: ProjectConfig,
  commandId: string,
  workspace: string,
  journal: Journal,
  signal?: AbortSignal,
): Promise<void> {
  const command = config.setupCommands.find((c) => c.id === commandId);
  if (!command?.approved)
    throw new TeamError('PERMISSION_DENIED', `Setup not approved: ${commandId}`);
  const frozen = journal.state?.config.setupCommands.find((c) => c.id === commandId);
  if (!frozen || hash(JSON.stringify(frozen)) !== hash(JSON.stringify(command)))
    throw new TeamError('INPUT_CHANGED', 'Setup definition changed');
  const before = await treeSnapshot(workspace, ['node_modules/']);
  const commandKey = `command-${randomUUID()}`;
  await journal.append({ type: 'COMMAND', key: commandKey, finished: false });
  const result = await supervise(
    {
      executable: command.executable,
      args: command.args,
      cwd: await safePath(workspace, command.cwd),
      stdin: '',
      env: childEnvironment(),
    },
    {
      timeoutMs: Math.min(command.timeoutMs, config.limits.setupTimeoutMs),
      graceMs: config.limits.terminationGraceMs,
      maxInputBytes: config.limits.maxInputBytesPerInvocation,
      maxStdoutBytes: config.limits.maxStdoutBytesPerInvocation,
      maxStderrBytes: config.limits.maxStderrBytesPerInvocation,
      ...(signal ? { signal } : {}),
    },
  );
  if (result.terminationConfirmed)
    await journal.append({ type: 'COMMAND', key: commandKey, finished: true });
  const artifact = `validation/setup-${randomUUID()}.json`;
  await journal.writeArtifact(
    artifact,
    JSON.stringify({ commandId, commandHash: hash(JSON.stringify(command)), ...result }, null, 2),
  );
  assertUnmutated(before, await treeSnapshot(workspace, ['node_modules/']));
  if (
    result.exitCode !== 0 ||
    result.timedOut ||
    result.outputLimited ||
    result.cancelled ||
    !result.terminationConfirmed
  )
    throw new TeamError(
      result.cancelled ? 'CANCELLED' : 'VALIDATION_FAILED',
      `Approved setup failed: ${commandId}; see ${artifact}`,
    );
  await journal.append({
    type: 'NOTICE',
    message: `Approved setup ${commandId} passed; evidence ${artifact}`,
  });
}
