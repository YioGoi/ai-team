import { TeamError } from '../domain/schemas.js';
import type { AgentRequest } from '../domain/schemas.js';
import type { InvocationSpec } from '../process/supervisor.js';
import {
  assertProbed,
  auditCodexAmbient,
  classifyProviderError,
  findExecutable,
  fingerprint,
  object,
  probeCommand,
  providerEnvironment,
  unavailable,
  throwKnownStartupFailure,
} from './cli-support.js';
import type { CliOptions } from './cli-support.js';
import { JsonlDecoder } from './decoder.js';
import type { NormalizedProviderEvent } from './decoder.js';
import type { ProviderAdapter, ProviderCapabilities } from './port.js';

const disabledFeatures = [
  'multi_agent',
  'multi_agent_v2',
  'goals',
  'hooks',
  'plugins',
  'apps',
  'browser_use',
  'computer_use',
  'image_generation',
  'shell_snapshot',
  'workspace_dependencies',
];
export function codexEvent(value: unknown): NormalizedProviderEvent[] {
  const event = object(value);
  switch (event.type) {
    case 'thread.started':
      if (typeof event.thread_id !== 'string')
        throw new TeamError('INVALID_RESULT', 'Codex thread identity missing');
      return [
        {
          type: 'metadata',
          sessionId: event.thread_id,
          model: typeof event.model === 'string' ? event.model : null,
        },
      ];
    case 'turn.completed':
      return [{ type: 'success' }];
    case 'turn.failed':
    case 'error':
      return [{ type: 'error', ...classifyProviderError(event.error ?? event.message ?? value) }];
    case 'item.completed': {
      const item = object(event.item);
      if (item.type === 'agent_message' && typeof item.text === 'string')
        return [{ type: 'result', value: item.text }];
      return [{ type: 'diagnostic', value }];
    }
    default:
      return [{ type: 'diagnostic', value }];
  }
}
export function extractCodex(events: NormalizedProviderEvent[]): unknown {
  const error = events.find((e) => e.type === 'error');
  if (error?.type === 'error') throw new TeamError(error.code, error.message);
  if (events.filter((e) => e.type === 'success').length !== 1 || events.at(-1)?.type !== 'success')
    throw new TeamError('INVALID_RESULT', 'Codex terminal success missing/ambiguous');
  const last = events.findLast((e) => e.type === 'result');
  if (last?.type !== 'result' || typeof last.value !== 'string')
    throw new TeamError('INVALID_RESULT', 'Codex final agent message missing');
  try {
    return JSON.parse(last.value) as unknown;
  } catch {
    throw new TeamError('INVALID_RESULT', 'Codex final message is not structured JSON');
  }
}
export class CodexAdapter implements ProviderAdapter {
  private capabilities: ProviderCapabilities | undefined;
  private stamp: string | null = null;
  private readonly env: Record<string, string>;
  private readonly options: CliOptions;
  constructor(options: CliOptions = {}) {
    this.options = options;
    this.env = providerEnvironment('codex', options.env ?? process.env);
  }
  async probe(): Promise<ProviderCapabilities> {
    this.stamp = null;
    const executable = findExecutable(this.options.executable ?? 'codex', this.env);
    if (!executable)
      return (this.capabilities = unavailable(
        'codex',
        'Install official Codex CLI and sign in directly; executable not found',
      ));
    const probe = this.options.probeCommand ?? probeCommand;
    const cwd = this.options.probeCwd ?? process.cwd();
    const version = await probe(executable, ['--version'], cwd, this.env);
    const help = await probe(executable, ['exec', '--help'], cwd, this.env);
    const features = await probe(executable, ['features', 'list'], cwd, this.env);
    const required = [
      '--json',
      '--output-schema',
      '--output-last-message',
      '--sandbox',
      'workspace-write',
      'read-only',
      '--ephemeral',
      '--ignore-user-config',
      '--config',
      '--cd',
      '--color',
      '--disable',
      '--model',
    ];
    const compatible =
      version.code === 0 &&
      help.code === 0 &&
      features.code === 0 &&
      required.every((flag) => help.stdout.includes(flag)) &&
      disabledFeatures.every((name) => new RegExp(`^${name}\\s`, 'm').test(features.stdout));
    const auth = compatible
      ? await probe(executable, ['login', 'status'], cwd, this.env)
      : { code: -1, stdout: '', stderr: '' };
    const loginText = auth.stdout + auth.stderr;
    const limitations = [
      'Working-copy isolation and CLI sandbox permissions are not hostile-repository containment.',
      'User config is omitted for this invocation; managed policy is not overridden. Model null uses the resulting CLI default.',
    ];
    if (!compatible)
      limitations.push(
        'Installed Codex lacks the verified exec/schema/sandbox/fresh-session/feature controls',
      );
    this.capabilities = {
      provider: 'codex',
      executablePath: executable,
      version: version.code === 0 ? version.stdout.trim() : null,
      available: version.code === 0,
      freshSession: compatible,
      structuredResult: compatible,
      readOnlyProfile: compatible,
      workspaceWriteProfile: compatible,
      configuredAuth:
        auth.code === 0 && /Logged in using ChatGPT/iu.test(loginText)
          ? 'saved-cli-login'
          : /API key/iu.test(loginText)
            ? 'other'
            : 'unknown',
      limitations,
    };
    this.stamp = fingerprint(executable);
    return this.capabilities;
  }
  buildInvocation(request: AgentRequest): InvocationSpec {
    assertProbed(this.capabilities, this.stamp);
    auditCodexAmbient(request.workspacePath, this.env);
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--sandbox',
      request.role === 'implementer' ? 'workspace-write' : 'read-only',
      '--cd',
      request.workspacePath,
      '--output-schema',
      request.outputSchemaPath,
      '--color',
      'never',
    ];
    for (const config of [
      'approval_policy="never"',
      'forced_login_method="chatgpt"',
      'model_provider="openai"',
      'allow_login_shell=false',
      'web_search="disabled"',
      'sandbox_workspace_write.network_access=false',
      'mcp_servers={}',
      'shell_environment_policy.inherit="none"',
      'shell_environment_policy.set.PATH=' + JSON.stringify(this.env.PATH ?? '/usr/bin:/bin'),
    ])
      args.push('-c', config);
    for (const feature of disabledFeatures) args.push('--disable', feature);
    if (request.model) args.push('--model', request.model);
    args.push('-');
    return {
      executable: this.capabilities.executablePath,
      args,
      cwd: request.workspacePath,
      stdin: JSON.stringify(request),
      env: { ...this.env },
    };
  }
  createDecoder() {
    return new JsonlDecoder(codexEvent);
  }
  extractResult(
    events: NormalizedProviderEvent[],
    execution?: { exitCode: number | null; stderr: string },
  ): unknown {
    throwKnownStartupFailure(execution);
    return extractCodex(events);
  }
}
