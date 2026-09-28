#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { TeamError } from './domain/schemas.js';
import { pathToFileURL } from 'node:url';
import { ZodError } from 'zod';
import {
  cancelRun,
  doctor,
  exportRun,
  initProject,
  resumeRun,
  runExitCode,
  runFiles,
  runStatus,
  writerRecoveryStatus,
} from './application/services.js';
import { liveProbe } from './application/live-probe.js';
import { redact } from './process/supervisor.js';

export const help = `AI Team v0.1 — trusted local engineering workflow
Usage: ai-team <command> [options]
  doctor [--json]
  doctor --live --provider codex|claude --allow-provider-calls
  init --repo <absolute-path> --profile mock|codex-only|claude-only|mixed
  run --config <absolute-path> --task <absolute-md-path> --ack-trusted-local [--allow-provider-calls]
  status <run-id> [--json] [--recovery]
  resume <run-id> --ack-trusted-local [--allow-provider-calls] [--reconcile-context | --reconcile-writer <review-token>]
  cancel <run-id>
  export <run-id> --dir <absolute-directory>
  --help
Mock runs are SIMULATION. Final engineering approval belongs to the human.
`;
const options = {
  doctor: {
    json: { type: 'boolean' },
    live: { type: 'boolean' },
    provider: { type: 'string' },
    'allow-provider-calls': { type: 'boolean' },
  },
  init: { repo: { type: 'string' }, profile: { type: 'string' } },
  run: {
    config: { type: 'string' },
    task: { type: 'string' },
    'ack-trusted-local': { type: 'boolean' },
    'allow-provider-calls': { type: 'boolean' },
  },
  status: { json: { type: 'boolean' }, recovery: { type: 'boolean' } },
  resume: {
    'ack-trusted-local': { type: 'boolean' },
    'allow-provider-calls': { type: 'boolean' },
    'reconcile-context': { type: 'boolean' },
    'reconcile-writer': { type: 'string' },
  },
  cancel: {},
  export: { dir: { type: 'string' } },
} as const;
export function parseCli(args: string[]) {
  const command = args[0];
  if ((command === '--help' && args.length === 1) || args.length === 0)
    return { command: 'help' as const, values: {}, positionals: [] };
  if (!command || !(command in options))
    throw new TeamError('INVALID_INPUT', `Unknown command: ${command ?? ''}`);
  const parsed = parseArgs({
    args: args.slice(1),
    options: { ...options[command as keyof typeof options], help: { type: 'boolean' } },
    strict: true,
    allowPositionals: true,
  });
  if (parsed.values.help) return { command: 'help' as const, values: {}, positionals: [] };
  const count = ['status', 'resume', 'cancel', 'export'].includes(command) ? 1 : 0;
  if (parsed.positionals.length !== count)
    throw new TeamError('INVALID_INPUT', `${command} expects ${count} positional arguments`);
  return { command, ...parsed };
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  const json = args.includes('--json');
  try {
    const parsed = parseCli(args);
    const v = parsed.values as Record<string, string | boolean | undefined>;
    const required = (key: string) => {
      const value = v[key];
      if (typeof value !== 'string' || !value)
        throw new TeamError('INVALID_INPUT', `Missing --${key}`);
      return value;
    };
    const output = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    if (parsed.command === 'help') {
      process.stdout.write(help);
      return 0;
    }
    switch (parsed.command) {
      case 'doctor': {
        if (!v.live && (v.provider || v['allow-provider-calls']))
          throw new TeamError('INVALID_INPUT', '--provider/--allow-provider-calls require --live');
        if (v.live) {
          const provider = required('provider');
          if (provider !== 'codex' && provider !== 'claude')
            throw new TeamError('INVALID_INPUT', 'Provider must be codex or claude');
          const stop = new AbortController();
          const pause = () => stop.abort();
          process.on('SIGINT', pause);
          process.on('SIGTERM', pause);
          try {
            output(
              await liveProbe(
                provider,
                v['allow-provider-calls'] === true,
                undefined,
                undefined,
                stop.signal,
              ),
            );
          } finally {
            process.off('SIGINT', pause);
            process.off('SIGTERM', pause);
          }
        } else output(await doctor());
        return 0;
      }
      case 'init': {
        const path = await initProject(required('repo'), required('profile'));
        process.stdout.write(
          `Config: ${path}\nReview proposed commands, outputs, bindings and limits. Commands are UNAPPROVED; set reviewedAt after your review.\n`,
        );
        return 0;
      }
      case 'status': {
        if (v.recovery) {
          output(await writerRecoveryStatus(parsed.positionals[0]!));
          return 0;
        }
        const s = await runStatus(parsed.positionals[0]!);
        if (json) output(s);
        else
          process.stdout.write(
            `${s.runId} ${s.status} / ${s.phase} / ${s.mode}\nMilestones ${s.completedMilestones.length}/${s.milestones.length}; calls ${s.invocations.length}/${s.config.limits.maxAgentInvocationsPerRun}; rounds ${JSON.stringify(s.rounds)}\n${s.reason}\nCandidate: ${s.candidateWorktree}\nEvidence: ${s.evidenceDirectory}\n`,
          );
        return 0;
      }
      case 'cancel':
        output(await cancelRun(parsed.positionals[0]!));
        return 0;
      case 'export':
        process.stdout.write((await exportRun(parsed.positionals[0]!, required('dir'))) + '\n');
        return 0;
      case 'run':
      case 'resume': {
        const stop = new AbortController();
        const pause = () => stop.abort();
        process.on('SIGINT', pause);
        process.on('SIGTERM', pause);
        let last = '';
        const options = {
          reconcileContext: v['reconcile-context'] === true,
          ...(typeof v['reconcile-writer'] === 'string'
            ? { reconcileWriter: v['reconcile-writer'] }
            : {}),
          ackTrustedLocal: v['ack-trusted-local'] === true,
          allowProviderCalls: v['allow-provider-calls'] === true,
          signal: stop.signal,
          onProgress: (s: import('./domain/state.js').RunState) => {
            const message = `${s.runId} ${s.phase} ${s.mode}; calls ${s.invocations.length}; rounds ${JSON.stringify(s.rounds)}; open issues ${s.issues.filter((i) => i.open).length}`;
            if (message !== last) {
              process.stderr.write(message + '\n');
              last = message;
            }
          },
        };
        try {
          const result =
            parsed.command === 'run'
              ? await runFiles(required('config'), required('task'), options)
              : await resumeRun(parsed.positionals[0]!, options);
          output({
            runId: result.state.runId,
            status: result.state.status,
            mode: result.state.mode,
            reason: result.state.reason,
            candidate: result.workspace.implementation,
            evidence: result.directory,
          });
          return runExitCode(result.state.status);
        } finally {
          process.off('SIGINT', pause);
          process.off('SIGTERM', pause);
        }
      }
      default:
        throw new TeamError('INVALID_INPUT', 'Unknown command');
    }
  } catch (error) {
    const code =
      error instanceof TeamError
        ? error.code
        : error instanceof ZodError ||
            error instanceof SyntaxError ||
            error instanceof TypeError ||
            (error as NodeJS.ErrnoException).code?.startsWith('ERR_PARSE_ARGS')
          ? 'INVALID_INPUT'
          : 'UNKNOWN';
    const message = redact(error instanceof Error ? error.message : String(error));
    if (json) process.stderr.write(JSON.stringify({ error: { code, message } }) + '\n');
    else process.stderr.write(`${code}: ${message}\n`);
    return code === 'INVALID_INPUT' ? 2 : code === 'STATE_CORRUPT' ? 5 : 3;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
