import { execFile } from 'node:child_process';
import { accessSync, constants, lstatSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { TeamError } from '../domain/schemas.js';
import type { ErrorCode, ProviderId } from '../domain/schemas.js';
import { childEnvironment, redact } from '../process/supervisor.js';
import type { ProviderCapabilities } from './port.js';
const exec = promisify(execFile);
export interface ProbeOutput {
  code: number;
  stdout: string;
  stderr: string;
}
export type ProbeCommand = (
  executable: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) => Promise<ProbeOutput>;
export const probeCommand: ProbeCommand = async (executable, args, cwd, env) => {
  try {
    const out = await exec(executable, args, {
      cwd,
      env,
      shell: false,
      timeout: 5000,
      maxBuffer: 262144,
      encoding: 'utf8',
    });
    return { code: 0, stdout: out.stdout, stderr: out.stderr };
  } catch (error) {
    const e = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: e.stdout ?? '',
      stderr: typeof e.code === 'string' ? e.code : (e.stderr ?? 'Probe failed'),
    };
  }
};
export interface CliOptions {
  executable?: string;
  env?: NodeJS.ProcessEnv;
  probeCommand?: ProbeCommand;
  probeCwd?: string;
}
export function providerEnvironment(
  provider: 'codex' | 'claude',
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  const env = childEnvironment(source);
  const homeKey = provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR';
  if (source[homeKey]) env[homeKey] = source[homeKey]!; // Keep the intended official login location; never copy credentials.
  if (provider === 'claude') {
    env.DISABLE_AUTOUPDATER = '1';
    env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  }
  return env;
}
export function findExecutable(name: string, env: Record<string, string>): string | null {
  const paths = isAbsolute(name)
    ? [name]
    : (env.PATH ?? '')
        .split(':')
        .filter(isAbsolute)
        .map((dir) => join(dir, name));
  for (const path of paths) {
    try {
      accessSync(path, constants.X_OK);
      if (statSync(path).isFile()) return realpathSync(path);
    } catch {
      /* try next PATH entry */
    }
  }
  return null;
}
export function fingerprint(executable: string): string {
  const stat = statSync(executable);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}
export function unavailable(provider: ProviderId, reason: string): ProviderCapabilities {
  return {
    provider,
    executablePath: null,
    version: null,
    available: false,
    freshSession: false,
    structuredResult: false,
    readOnlyProfile: false,
    workspaceWriteProfile: false,
    configuredAuth: 'unknown',
    limitations: [reason],
  };
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function classifyProviderError(value: unknown): { code: ErrorCode; message: string } {
  const raw = object(value);
  const message = redact(
    typeof value === 'string'
      ? value
      : typeof raw.message === 'string'
        ? raw.message
        : (JSON.stringify(value) ?? 'Unknown provider error'),
  );
  const code = String(raw.code ?? raw.type ?? '').toLowerCase();
  if (
    /auth|unauthorized|invalid_api_key|401/u.test(code) ||
    /not logged in|authentication required|login required|please log in|unauthorized|invalid api key/iu.test(
      message,
    )
  )
    return { code: 'AUTH_REQUIRED', message };
  if (
    /rate_limit|quota|429/u.test(code) ||
    /rate limit|quota|usage limit|limit reached|too many requests/iu.test(message)
  )
    return { code: 'RATE_LIMITED', message };
  if (
    /permission|forbidden|403/u.test(code) ||
    /permission denied|not permitted|policy denied/iu.test(message)
  )
    return { code: 'PERMISSION_DENIED', message };
  return { code: 'UNKNOWN', message };
}
/** Presence-only audit; no provider configuration/credential content is loaded into the app. */
export function auditCodexAmbient(workspace: string, env: Record<string, string>): void {
  const candidates = [
    '/etc/codex/config.toml',
    '/etc/codex/managed_config.toml',
    '/etc/codex/requirements.toml',
  ];
  for (let dir = realpathSync(workspace); ; dir = dirname(dir)) {
    candidates.push(join(dir, '.codex/config.toml'));
    if (dirname(dir) === dir) break;
  }
  for (const path of candidates) {
    // The user config is omitted via the documented CLI flag; admin policy is never edited or bypassed.
    const userConfig = resolve(env.CODEX_HOME ?? join(env.HOME ?? '', '.codex'), 'config.toml');
    if (path === userConfig) continue;
    try {
      lstatSync(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    throw new TeamError(
      'UNSUPPORTED_CAPABILITY',
      `Additional Codex configuration requires explicit compatibility review: ${path}`,
    );
  }
}
export function assertProbed(
  cap: ProviderCapabilities | undefined,
  executableFingerprint: string | null,
): asserts cap is ProviderCapabilities & { executablePath: string } {
  if (
    !cap?.available ||
    !cap.executablePath ||
    !cap.freshSession ||
    !cap.structuredResult ||
    !cap.readOnlyProfile ||
    !cap.workspaceWriteProfile
  )
    throw new TeamError(
      'UNSUPPORTED_CAPABILITY',
      cap?.limitations.join('; ') || 'Probe provider capabilities before dispatch',
    );
  if (cap.configuredAuth !== 'saved-cli-login')
    throw new TeamError('AUTH_REQUIRED', 'Intended saved official CLI login is not verified');
  if (fingerprint(cap.executablePath) !== executableFingerprint)
    throw new TeamError(
      'UNSUPPORTED_CAPABILITY',
      'Provider executable changed; re-probe before dispatch',
    );
}

export function throwKnownStartupFailure(execution?: {
  exitCode: number | null;
  stderr: string;
}): void {
  if (!execution || execution.exitCode === 0) return;
  const error = classifyProviderError(execution.stderr);
  if (error.code !== 'UNKNOWN') throw new TeamError(error.code, error.message);
}
