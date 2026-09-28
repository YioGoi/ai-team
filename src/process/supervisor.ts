import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { TeamError } from '../domain/schemas.js';

export interface InvocationSpec {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string>;
}
export interface ProcessResult {
  pid: number | null;
  identity: string | null;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputLimited: boolean;
  cancelled: boolean;
  terminationConfirmed: boolean;
  startedAt: string;
  endedAt: string;
}
export interface Supervision {
  timeoutMs: number;
  graceMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxInputBytes: number;
  signal?: AbortSignal;
  onStart?: (pid: number, identity: string) => Promise<void>;
}
export function childEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'TERM',
    'USER',
    'LOGNAME',
    'SHELL',
    'SystemRoot',
  ])
    if (source[key]) env[key] = source[key]!;
  env.NO_COLOR = '1';
  env.CI = '1';
  return env;
}
/** Redaction is best-effort after prevention; logs are never an authority channel. */
export function redact(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]+)\b/gu, '[REDACTED]')
    .replace(
      /((?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password)\s*[=:]\s*)(?:Bearer\s+)?[^\s,;]+/giu,
      '$1[REDACTED]',
    )
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,
      '[REDACTED PRIVATE KEY]',
    );
}
async function ps(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/ps', args, {
      shell: false,
      env: childEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let bytes = 0;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new TeamError('UNKNOWN', 'Process inspection timed out'));
    }, 2000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) {
        child.kill('SIGKILL');
        reject(new TeamError('OUTPUT_LIMIT', 'Process inspection output limit'));
      } else out += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 || code === 1) resolve(out);
      else reject(new TeamError('UNKNOWN', 'Cannot inspect process ownership'));
    });
  });
}
export async function processIdentity(pid: number): Promise<string | null> {
  const value = (await ps(['-p', String(pid), '-o', 'lstart=', '-o', 'command='])).trim();
  return value ? `${pid}:${value}` : null;
}
export async function groupAlive(pgid: number): Promise<boolean> {
  const rows = await ps(['-axo', 'pid=,pgid=,stat=']);
  return rows.split('\n').some((line) => {
    const parts = line.trim().split(/\s+/u);
    return Number(parts[1]) === pgid && !parts[2]?.startsWith('Z');
  });
}
export async function supervise(
  spec: InvocationSpec,
  options: Supervision,
): Promise<ProcessResult> {
  if (Buffer.byteLength(spec.stdin) > options.maxInputBytes)
    throw new TeamError('OUTPUT_LIMIT', 'Input packet exceeds byte cap');
  if (options.signal?.aborted) throw new TeamError('CANCELLED', 'Cancelled before spawn');
  const startedAt = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let errBytes = 0;
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let timedOut = false;
    let outputLimited = false;
    let cancelled = false;
    let terminating = false;
    let done = false;
    let identity: string | null = null;
    let startError: unknown;
    let spawnError: Error | undefined;
    let killTimer: NodeJS.Timeout | undefined;
    let settleTimer: NodeJS.Timeout | undefined;
    let startRecord: Promise<void> = Promise.resolve();
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') startError ??= e;
      }
    };
    const stop = () => {
      if (terminating || done) return;
      terminating = true;
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), options.graceMs);
      settleTimer = setTimeout(() => {
        void finish(null, 'SIGKILL', false);
      }, options.graceMs + 2500);
    };
    const onAbort = () => {
      cancelled = true;
      stop();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const finish = async (
      exitCode: number | null,
      signal: string | null,
      forcedUnknown = false,
    ) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
      await startRecord;
      let terminationConfirmed = !forcedUnknown;
      if (child.pid) {
        try {
          if (await groupAlive(child.pid)) {
            kill('SIGTERM');
            await new Promise((r) => setTimeout(r, options.graceMs));
            if (await groupAlive(child.pid)) kill('SIGKILL');
            for (let n = 0; n < 20 && (await groupAlive(child.pid)); n++)
              await new Promise((r) => setTimeout(r, 25));
            terminationConfirmed = !(await groupAlive(child.pid));
          }
        } catch {
          terminationConfirmed = false;
        }
      }
      clearTimeout(killTimer);
      clearTimeout(settleTimer);
      if (spawnError) {
        reject(spawnError);
        return;
      }
      if (startError) {
        reject(
          new TeamError('UNKNOWN', `Cannot durably record worker ownership: ${String(startError)}`),
        );
        return;
      }
      resolve({
        pid: child.pid ?? null,
        identity,
        exitCode,
        signal,
        stdout: redact(stdout + outDecoder.end()),
        stderr: redact(stderr + errDecoder.end()),
        timedOut,
        outputLimited,
        cancelled,
        terminationConfirmed,
        startedAt,
        endedAt: new Date().toISOString(),
      });
    };
    child.on('spawn', () => {
      startRecord = (async () => {
        identity = await processIdentity(child.pid!);
        // Direct child ownership still holds for short-lived commands whose ps entry already disappeared.
        identity ??= `owned-child:${child.pid}:${startedAt}`;
        await options.onStart?.(child.pid!, identity);
        if (!terminating) child.stdin.end(spec.stdin);
      })().catch((e) => {
        startError = e;
        stop();
      });
    });
    child.stdin.on('error', (e) => {
      if ((e as NodeJS.ErrnoException).code !== 'EPIPE') {
        startError = e;
        stop();
      }
    });
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > options.maxStdoutBytes) {
        outputLimited = true;
        stop();
      } else stdout += outDecoder.write(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes > options.maxStderrBytes) {
        outputLimited = true;
        stop();
      } else stderr += errDecoder.write(chunk);
    });
    child.on('error', (e) => {
      spawnError = e;
    });
    child.on('close', (code, signal) => {
      void finish(code, signal);
    });
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
