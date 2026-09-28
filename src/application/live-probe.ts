import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  configSchema,
  requestSchema,
  resultJsonSchema,
  TeamError,
  validateResult,
} from '../domain/schemas.js';
import type { ProviderId } from '../domain/schemas.js';
import { hash, Journal } from '../persistence/journal.js';
import { supervise } from '../process/supervisor.js';
import type { Adapters } from '../orchestration/engine.js';
import { git } from '../workspace/git.js';
import { adapters, stateRoot } from './services.js';
/** Explicit diagnostic only: one read-only process, never a team-readiness claim. */
export async function liveProbe(
  provider: Exclude<ProviderId, 'mock'>,
  allowed: boolean,
  bindings: Adapters = adapters(),
  root = stateRoot(),
  signal?: AbortSignal,
) {
  if (!allowed)
    throw new TeamError('PERMISSION_DENIED', 'Live doctor requires --allow-provider-calls');
  const adapter = bindings[provider];
  if (!adapter) throw new TeamError('UNSUPPORTED_CAPABILITY', 'Requested provider unavailable');
  const capabilities = await adapter.probe();
  if (
    !capabilities.available ||
    !capabilities.freshSession ||
    !capabilities.readOnlyProfile ||
    !capabilities.structuredResult
  )
    throw new TeamError('UNSUPPORTED_CAPABILITY', capabilities.limitations.join('; '));
  if (capabilities.configuredAuth !== 'saved-cli-login')
    throw new TeamError('AUTH_REQUIRED', 'Intended saved CLI login not verified');
  const runId = `probe-${randomUUID()}`;
  const directory = join(root, 'probes', runId);
  const workspace = join(directory, 'workspace');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await git(workspace, ['init']);
  const task = {
    schemaVersion: 1 as const,
    id: 'capability-probe',
    title: 'Read-only capability probe',
    objective:
      'Return one minimal plan confirming structured output; do not use tools or edit anything.',
    requirements: [{ id: 'FR1', text: 'Return a structured plan' }],
    acceptanceCriteria: [
      {
        id: 'AC1',
        requirementIds: ['FR1'],
        text: 'Plan returned',
        required: true,
        validatorIds: [],
        humanReview: 'Inspect diagnostic result',
      },
    ],
    scope: { allowedPaths: ['probe.txt'], forbiddenPaths: [] },
    constraints: ['Do not use tools, edit files or launch any process'],
    nonGoals: [],
    expectedBaselineFailures: [],
  };
  const config = configSchema.parse({
    schemaVersion: 1,
    projectId: 'doctor',
    repositoryPath: workspace,
    stateRoot: root,
    profile: `${provider}-only`,
    roleBindings: Object.fromEntries(
      ['architect', 'implementer', 'reviewer', 'qa'].map((role) => [
        role,
        { provider, model: null },
      ]),
    ),
    setupCommands: [],
    validators: [],
    protectedPaths: [],
    authPolicy: { route: 'saved-cli-login', allowApiFallback: false, allowCloudEndpoints: false },
    limits: { maxAgentInvocationsPerRun: 1, agentTimeoutMs: 60000, maxActiveRuntimeMs: 60000 },
    approval: { reviewedAt: null },
  });
  const journal = new Journal(directory, runId, config.limits.maxArtifactBytesPerRun);
  await journal.load();
  await journal.append({
    type: 'CREATED',
    task,
    config,
    mode: 'LIVE',
    baseSha: 'diagnostic',
    sourceDigest: '',
    manifestHash: '',
  });
  const invocationId = `call-${randomUUID()}`;
  const rolePrompt =
    'Act as Architect for this read-only capability diagnostic. Return one minimal milestone covering AC1. No tools, files or other agents.';
  const request = requestSchema.parse({
    schemaVersion: 1,
    runId,
    invocationId,
    role: 'architect',
    rolePromptHash: hash(rolePrompt),
    taskId: task.id,
    taskHash: hash(JSON.stringify(task)),
    phase: 'PLANNING',
    milestoneId: null,
    round: 0,
    baseSha: 'diagnostic',
    basisSha: 'diagnostic',
    scope: task.scope,
    assignedIssueIds: [],
    model: null,
    workspacePath: workspace,
    outputSchemaPath: join(directory, 'output-schema.json'),
    outputSchema: resultJsonSchema('architect'),
    context: { task, rolePrompt, files: [], omissions: [], evidence: {}, instructions: rolePrompt },
  });
  await journal.writeArtifact('capabilities.json', JSON.stringify(capabilities));
  await journal.writeArtifact('output-schema.json', JSON.stringify(request.outputSchema));
  await journal.writeArtifact('request.json', JSON.stringify(request));
  await journal.append({
    type: 'RESERVED',
    invocation: {
      id: invocationId,
      role: 'architect',
      basisSha: 'diagnostic',
      milestoneId: null,
      round: 0,
      issueIds: [],
      kind: 'initial',
      stepId: 'doctor',
      state: 'reserved',
      processId: null,
      processIdentity: null,
    },
  });
  try {
    const process = await supervise(adapter.buildInvocation(request), {
      timeoutMs: 60000,
      graceMs: 5000,
      maxInputBytes: 262144,
      maxStdoutBytes: 5242880,
      maxStderrBytes: 1048576,
      ...(signal ? { signal } : {}),
      onStart: async (pid, identity) => {
        await journal.append({ type: 'PROCESS', invocationId, pid, identity });
      },
    });
    await journal.append({ type: 'EXITED', invocationId, confirmed: process.terminationConfirmed });
    await journal.writeArtifact('stdout.redacted.jsonl', process.stdout);
    await journal.writeArtifact('stderr.redacted.log', process.stderr);
    if (
      !process.terminationConfirmed ||
      process.timedOut ||
      process.outputLimited ||
      process.cancelled
    )
      throw new TeamError('PROCESS_TIMEOUT', 'Live diagnostic did not finish within its bounds');
    const decoder = adapter.createDecoder();
    decoder.push(Buffer.from(process.stdout));
    const events = decoder.finish();
    const raw = adapter.extractResult(events, process);
    if (process.exitCode !== 0 || process.signal)
      throw new TeamError('INVALID_RESULT', 'Diagnostic process failed');
    const result = validateResult(raw, request);
    if (result.outcome !== 'OK')
      throw new TeamError('INVALID_RESULT', 'Diagnostic returned a non-OK result');
    await journal.append({ type: 'RESULT', invocationId, result });
    await journal.append({
      type: 'STATUS',
      status: 'CANCELLED',
      reason: 'Diagnostic complete; not a resumable engineering run or live-team proof',
    });
    return {
      provider,
      verificationMode: 'LIVE',
      diagnostic: 'PASS',
      modelInvocations: 1,
      evidenceDirectory: directory,
      teamWorkflowVerified: false,
    };
  } catch (error) {
    await journal.append({
      type: 'STATUS',
      status: 'BLOCKED',
      reason: error instanceof Error ? error.message : 'Diagnostic failed',
    });
    throw new TeamError(
      error instanceof TeamError ? error.code : 'UNKNOWN',
      `Live probe reserved 1 invocation; evidence ${directory}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
