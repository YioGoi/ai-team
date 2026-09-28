import { randomUUID } from 'node:crypto';
import { TeamError } from '../domain/schemas.js';
import type { AgentRequest } from '../domain/schemas.js';
import type { InvocationSpec } from '../process/supervisor.js';
import {
  assertProbed,
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
import { extractStructured, JsonlDecoder } from './decoder.js';
import type { NormalizedProviderEvent } from './decoder.js';
import type { ProviderAdapter, ProviderCapabilities } from './port.js';
export function claudeEvent(value: unknown): NormalizedProviderEvent[] {
  const event = object(value);
  if (event.type === 'system' && event.subtype === 'init')
    return [
      {
        type: 'metadata',
        sessionId: typeof event.session_id === 'string' ? event.session_id : null,
        model: typeof event.model === 'string' ? event.model : null,
      },
    ];
  if (event.type === 'error')
    return [{ type: 'error', ...classifyProviderError(event.error ?? value) }];
  if (event.type !== 'result') return [{ type: 'diagnostic', value }];
  const metadata: NormalizedProviderEvent = {
    type: 'metadata',
    sessionId: typeof event.session_id === 'string' ? event.session_id : null,
    model: typeof event.model === 'string' ? event.model : null,
  };
  if (event.is_error === true || event.subtype !== 'success')
    return [
      metadata,
      { type: 'error', ...classifyProviderError(event.errors ?? event.result ?? event) },
    ];
  if (
    event.is_error !== false ||
    !('structured_output' in event) ||
    event.structured_output === null
  )
    throw new TeamError(
      'INVALID_RESULT',
      'Claude success lacks structured_output or explicit is_error:false',
    );
  if (Array.isArray(event.permission_denials) && event.permission_denials.length)
    return [
      metadata,
      {
        type: 'error',
        code: 'PERMISSION_DENIED',
        message: 'Claude reported permission denials; result is not accepted as success',
      },
    ];
  return [metadata, { type: 'result', value: event.structured_output }, { type: 'success' }];
}
export class ClaudeAdapter implements ProviderAdapter {
  private capabilities: ProviderCapabilities | undefined;
  private stamp: string | null = null;
  private readonly env: Record<string, string>;
  private readonly options: CliOptions;
  constructor(options: CliOptions = {}) {
    this.options = options;
    this.env = providerEnvironment('claude', options.env ?? process.env);
  }
  async probe(): Promise<ProviderCapabilities> {
    this.stamp = null;
    const executable = findExecutable(this.options.executable ?? 'claude', this.env);
    if (!executable)
      return (this.capabilities = unavailable(
        'claude',
        'Install official Claude Code CLI and use its direct subscription login; executable not found',
      ));
    const probe = this.options.probeCommand ?? probeCommand;
    const cwd = this.options.probeCwd ?? process.cwd();
    const version = await probe(executable, ['--version'], cwd, this.env);
    const help = await probe(executable, ['--help'], cwd, this.env);
    const required = [
      '--print',
      '--output-format',
      '--json-schema',
      '--tools',
      '--allowedTools',
      '--disallowedTools',
      '--permission-mode',
      '--permission-prompts',
      '--safe-mode',
      '--restricted',
      '--strict-mcp-config',
      '--mcp-config',
      '--no-session-persistence',
      '--session-id',
      '--max-turns',
      '--verbose',
      '--model',
    ];
    const compatible =
      version.code === 0 &&
      help.code === 0 &&
      required.every((flag) => help.stdout.includes(flag)) &&
      /\bauth\b/u.test(help.stdout) &&
      !/bare.{0,30}default|default.{0,30}bare/iu.test(help.stdout);
    // Only official nonsecret auth status; never inspect auth files or Keychain.
    const auth = compatible
      ? await probe(executable, ['auth', 'status'], cwd, this.env)
      : { code: -1, stdout: '', stderr: '' };
    let status: Record<string, unknown> = {};
    try {
      status = object(JSON.parse(auth.stdout));
    } catch {
      /* Unknown route fails closed. */
    }
    const saved = auth.code === 0 && status.loggedIn === true && status.authMethod === 'claude.ai';
    const limitations = [
      'Requires installed --safe-mode and --restricted controls; older CLIs fail closed.',
      'Safe mode preserves authentication and managed settings policy; no --bare or credential copying.',
      'Managed policy may still deny execution; no fallback is attempted.',
    ];
    if (!compatible)
      limitations.push(
        'Installed Claude lacks verified normal-print/safe-mode/restricted controls (or reports bare default); review installed version before enabling',
      );
    this.capabilities = {
      provider: 'claude',
      executablePath: executable,
      version: version.code === 0 ? version.stdout.trim() : null,
      available: version.code === 0,
      freshSession: compatible,
      structuredResult: compatible,
      readOnlyProfile: compatible,
      workspaceWriteProfile: compatible,
      configuredAuth: saved ? 'saved-cli-login' : status.loggedIn === true ? 'other' : 'unknown',
      limitations,
    };
    this.stamp = fingerprint(executable);
    return this.capabilities;
  }
  buildInvocation(request: AgentRequest): InvocationSpec {
    assertProbed(this.capabilities, this.stamp);
    const writing = request.role === 'implementer';
    const args = [
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
      '--json-schema',
      JSON.stringify(request.outputSchema),
      '--safe-mode',
      '--restricted',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-session-persistence',
      '--session-id',
      randomUUID(),
      '--permission-mode',
      writing ? 'acceptEdits' : 'default',
      '--permission-prompts',
      'none',
      '--tools',
      writing ? 'Read,Edit,Write' : '',
      '--disallowedTools',
      'Bash,Agent,Task,Skill,WebFetch,WebSearch,mcp__*',
      '--max-turns',
      '12',
    ];
    if (writing) args.push('--allowedTools', 'Read,Edit,Write');
    if (request.model) args.push('--model', request.model);
    return {
      executable: this.capabilities.executablePath,
      args,
      cwd: request.workspacePath,
      stdin: JSON.stringify(request),
      env: { ...this.env },
    };
  }
  createDecoder() {
    return new JsonlDecoder(claudeEvent);
  }
  extractResult(
    events: NormalizedProviderEvent[],
    execution?: { exitCode: number | null; stderr: string },
  ): unknown {
    throwKnownStartupFailure(execution);
    if (events.at(-1)?.type !== 'success' && !events.some((e) => e.type === 'error'))
      throw new TeamError('INVALID_RESULT', 'Unknown Claude terminal semantics');
    return extractStructured(events);
  }
}
