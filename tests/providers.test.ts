import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter, claudeEvent } from '../src/providers/claude.js';
import { CodexAdapter, codexEvent, extractCodex } from '../src/providers/codex.js';
import { JsonlDecoder } from '../src/providers/decoder.js';
import { probeCommand, providerEnvironment } from '../src/providers/cli-support.js';
import type { ProbeCommand } from '../src/providers/cli-support.js';
import {
  requestSchema,
  resultJsonSchema,
  TeamError,
  validateResult,
} from '../src/domain/schemas.js';
import type { Role } from '../src/domain/schemas.js';
import { startRun } from '../src/orchestration/engine.js';
import { createFixture } from './fixture.js';
import { assertOracle } from './oracle.js';
import { task } from './helpers.js';
const assets = fileURLToPath(new URL('../assets', import.meta.url));
const markdown = await readFile(new URL('../examples/SMOKE_TASK.md', import.meta.url), 'utf8');
async function executables() {
  const dir = await mkdtemp(join(tmpdir(), 'ai-team provider fixtures '));
  const source = (
    await readFile(new URL('./fixtures/provider-cli.mjs', import.meta.url), 'utf8')
  ).replace(
    'process.env.AI_TEAM_TEST_MOCK_WORKER',
    JSON.stringify(join(assets, 'mock-worker.mjs')),
  );
  const paths = { codex: join(dir, 'codex-fixture'), claude: join(dir, 'claude-fixture') };
  for (const path of Object.values(paths)) {
    await writeFile(path, '#!' + process.execPath + '\n' + source);
    await chmod(path, 0o700);
  }
  return paths;
}
function request(role: Role = 'reviewer') {
  return requestSchema.parse({
    schemaVersion: 1,
    runId: 'run-test',
    invocationId: 'call-test',
    role,
    rolePromptHash: 'hash',
    taskId: task.id,
    taskHash: 'hash',
    phase: 'REVIEW_QA',
    milestoneId: 'm1',
    round: 1,
    baseSha: 'base',
    basisSha: 'candidate',
    scope: task.scope,
    assignedIssueIds: [],
    model: null,
    workspacePath: process.cwd(),
    outputSchemaPath: '/tmp/a schema.json',
    outputSchema: resultJsonSchema(role),
    context: {
      task,
      rolePrompt: 'Assess the frozen candidate.',
      files: [],
      omissions: [],
      evidence: {},
      instructions: 'No nested agents.',
    },
  });
}
const payload = { hello: 'Café 🦊' };
const transcript = (provider: 'codex' | 'claude') =>
  provider === 'codex'
    ? [
        { type: 'thread.started', thread_id: 'synthetic-1' },
        { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(payload) } },
        { type: 'turn.completed' },
      ]
    : [
        { type: 'system', subtype: 'init', session_id: 'synthetic-1', model: 'synthetic' },
        { type: 'result', subtype: 'success', is_error: false, structured_output: payload },
      ];

describe('Synthetic protocol contracts; not live-provider evidence', () => {
  it.each(['codex', 'claude'] as const)(
    '%s supports UTF-8 byte boundaries and actual final envelope (T-21/22)',
    (provider) => {
      const adapter = provider === 'codex' ? new CodexAdapter() : new ClaudeAdapter();
      const decoder = adapter.createDecoder();
      for (const byte of Buffer.from(
        transcript(provider)
          .map((e) => JSON.stringify(e))
          .join('\n') + '\n',
      ))
        decoder.push(Buffer.from([byte]));
      const events = decoder.finish();
      expect(adapter.extractResult(events)).toEqual(payload);
      expect(events.find((e) => e.type === 'metadata')).toMatchObject({ sessionId: 'synthetic-1' });
    },
  );
  it.each([
    ['AUTH_REQUIRED', 'Login required'],
    ['RATE_LIMITED', 'Rate limit reached'],
    ['PERMISSION_DENIED', 'Permission denied'],
    ['UNKNOWN', 'Unexpected upstream error'],
  ])('both providers preserve %s without retry', (code, message) => {
    for (const [adapter, value] of [
      [new CodexAdapter(), { type: 'turn.failed', error: { message } }],
      [
        new ClaudeAdapter(),
        { type: 'result', subtype: 'error_during_execution', is_error: true, errors: [message] },
      ],
    ] as const) {
      const d = adapter.createDecoder();
      d.push(Buffer.from(JSON.stringify(value) + '\n'));
      try {
        adapter.extractResult(d.finish());
        throw new Error('Expected provider error');
      } catch (e) {
        expect(e).toBeInstanceOf(TeamError);
        expect((e as TeamError).code).toBe(code);
      }
    }
  });
  it.each([new CodexAdapter(), new ClaudeAdapter()])(
    'normalizes startup stderr without inferring success or retrying',
    (adapter) => {
      for (const [message, code] of [
        ['Login required', 'AUTH_REQUIRED'],
        ['Rate limit reached', 'RATE_LIMITED'],
        ['Permission denied', 'PERMISSION_DENIED'],
      ]) {
        try {
          adapter.extractResult([], { exitCode: 1, stderr: message! });
          throw new Error('Expected failure');
        } catch (error) {
          expect(error).toBeInstanceOf(TeamError);
          expect((error as TeamError).code).toBe(code);
        }
      }
      try {
        adapter.extractResult([], { exitCode: 0, stderr: 'Login required' });
        throw new Error('Expected invalid result');
      } catch (error) {
        expect(error).toBeInstanceOf(TeamError);
        expect((error as TeamError).code).toBe('INVALID_RESULT');
      }
    },
  );
  it('uses final Codex message, never extracts success from prose or unknown terminal events', () => {
    const events = transcript('codex').flatMap(codexEvent);
    events.splice(1, 0, { type: 'result', value: 'I will inspect the source.' });
    expect(extractCodex(events)).toEqual(payload);
    expect(() => extractCodex(events.slice(0, -1))).toThrow('terminal');
    expect(() =>
      extractCodex([...events, { type: 'diagnostic', value: { type: 'unknown-terminal' } }]),
    ).toThrow('terminal');
    expect(() =>
      extractCodex([{ type: 'result', value: 'all done' }, { type: 'success' }]),
    ).toThrow('structured JSON');
  });
  it('rejects Claude optimistic text, malformed/truncated JSON, denials and unknown outcomes', () => {
    expect(() =>
      claudeEvent({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
    ).toThrow('structured_output');
    const adapter = new ClaudeAdapter();
    expect(() =>
      adapter.extractResult(
        claudeEvent({
          type: 'result',
          subtype: 'success',
          is_error: false,
          structured_output: payload,
          permission_denials: ['Write'],
        }),
      ),
    ).toThrow('permission denials');
    expect(() =>
      adapter.extractResult(
        claudeEvent({
          type: 'result',
          subtype: 'future',
          is_error: false,
          structured_output: payload,
        }),
      ),
    ).toThrow();
    const d = adapter.createDecoder();
    d.push(Buffer.from('{"type":'));
    expect(() => d.finish()).toThrow('Malformed');
    expect(() => new JsonlDecoder(claudeEvent, 4).push(Buffer.from('12345'))).toThrow('cap');
  });
  it('controller rejects wrong echoed identities even with a valid provider success', () => {
    const r = request('implementer');
    const result = {
      schemaVersion: 1,
      runId: r.runId,
      invocationId: r.invocationId,
      taskId: r.taskId,
      role: r.role,
      basisSha: 'wrong',
      outcome: 'OK',
      summary: 'Done',
      evidenceReferences: [],
      requestedContextPaths: [],
      findings: [],
      payload: {
        changeSummary: 'x',
        declaredChangedPaths: [],
        addressedCriterionIds: [],
        addressedIssueIds: [],
        testChanges: [],
        diagnosticClaims: [],
        limitations: [],
      },
    };
    const raw = new ClaudeAdapter().extractResult(
      claudeEvent({
        type: 'result',
        subtype: 'success',
        is_error: false,
        structured_output: result,
      }),
    );
    expect(() => validateResult(raw, r)).toThrow('basisSha');
  });
});
describe('Probed invocation and authentication boundaries', () => {
  it('builds fresh scoped argv from real fake CLI help/auth subprocesses', async () => {
    const paths = await executables();
    const codex = new CodexAdapter({ executable: paths.codex });
    const claude = new ClaudeAdapter({ executable: paths.claude });
    expect((await codex.probe()).configuredAuth).toBe('saved-cli-login');
    expect((await claude.probe()).workspaceWriteProfile).toBe(true);
    const read = codex.buildInvocation(request());
    const write = codex.buildInvocation(request('implementer'));
    expect(read.args).toContain('read-only');
    expect(write.args).toContain('workspace-write');
    expect(write.args).toContain('forced_login_method="chatgpt"');
    expect(write.args).toContain('/tmp/a schema.json');
    expect(write.args.at(-1)).toBe('-');
    const c = claude.buildInvocation(request());
    const c2 = claude.buildInvocation(request('implementer'));
    expect(c.args[c.args.indexOf('--tools') + 1]).toBe('');
    expect(c2.args[c2.args.indexOf('--tools') + 1]).toBe('Read,Edit,Write');
    expect(c.args).toContain('--safe-mode');
    expect(c.args).toContain('--restricted');
    expect(c.args).not.toContain('--bare');
    expect(c.args[c.args.indexOf('--session-id') + 1]).not.toBe(
      c2.args[c2.args.indexOf('--session-id') + 1],
    );
    expect(
      [...read.args, ...write.args, ...c.args, ...c2.args].some((arg) =>
        /dangerously|--resume|--last|--continue/u.test(arg),
      ),
    ).toBe(false);
  });
  it('rejects missing binaries, unprobed bindings, missing safe flags and API auth with no fallback', async () => {
    expect(() => new CodexAdapter().buildInvocation(request())).toThrow('Probe');
    expect((await new ClaudeAdapter({ env: { PATH: '/does-not-exist' } }).probe()).available).toBe(
      false,
    );
    const paths = await executables();
    const calls: string[] = [];
    const probe: ProbeCommand = async (_executable, args) => {
      calls.push(args.join(' '));
      return {
        code: 0,
        stdout: args[0] === '--version' ? '2.1.268' : '--print --bare',
        stderr: '',
      };
    };
    const adapter = new ClaudeAdapter({ executable: paths.claude, probeCommand: probe });
    const cap = await adapter.probe();
    expect(cap.configuredAuth).toBe('unknown');
    expect(calls).toEqual(['--version', '--help']);
    expect(cap.readOnlyProfile).toBe(false);
    expect(() => adapter.buildInvocation(request())).toThrow('lacks verified');
    const apiAuth: ProbeCommand = async (exe, args, cwd, env) =>
      args[0] === 'auth'
        ? { code: 0, stdout: '{"loggedIn":true,"authMethod":"api_key"}', stderr: '' }
        : probeCommand(exe, args, cwd, env);
    const api = new ClaudeAdapter({ executable: paths.claude, probeCommand: apiAuth });
    expect((await api.probe()).configuredAuth).toBe('other');
    expect(() => api.buildInvocation(request())).toThrow('saved official CLI login');
    const valid = new CodexAdapter({ executable: paths.codex });
    await valid.probe();
    await writeFile(paths.codex, '#!/bin/false\n');
    expect(() => valid.buildInvocation(request())).toThrow('changed');
  });
  it('filters billing/routing/injection env without moving saved-login homes', () => {
    const source = {
      PATH: '/bin',
      HOME: '/real/home',
      CODEX_HOME: '/real/codex',
      CLAUDE_CONFIG_DIR: '/real/claude',
      OPENAI_API_KEY: 'secret',
      ANTHROPIC_API_KEY: 'secret',
      ANTHROPIC_BASE_URL: 'bad',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_SIMPLE: '1',
      NODE_OPTIONS: 'bad',
      HTTPS_PROXY: 'bad',
    };
    const c = providerEnvironment('codex', source);
    const a = providerEnvironment('claude', source);
    expect(c.CODEX_HOME).toBe('/real/codex');
    expect(a.CLAUDE_CONFIG_DIR).toBe('/real/claude');
    expect(a.HOME).toBe('/real/home');
    for (const key of [
      'OPENAI_API_KEY',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_SIMPLE',
      'NODE_OPTIONS',
      'HTTPS_PROXY',
    ]) {
      expect(c[key]).toBeUndefined();
      expect(a[key]).toBeUndefined();
    }
  });
});
it.each(['codex-only', 'claude-only', 'mixed'] as const)(
  'same engine passes fixed oracle through %s synthetic subprocess adapters (T-03)',
  async (profile) => {
    const f = await createFixture();
    const paths = await executables();
    f.config.profile = profile;
    const providers =
      profile === 'mixed'
        ? (['claude', 'codex', 'claude', 'codex'] as const)
        : profile === 'codex-only'
          ? (['codex', 'codex', 'codex', 'codex'] as const)
          : (['claude', 'claude', 'claude', 'claude'] as const);
    (['architect', 'implementer', 'reviewer', 'qa'] as const).forEach((role, index) => {
      f.config.roleBindings[role].provider = providers[index]!;
    });
    const adapters = {
      codex: new CodexAdapter({ executable: paths.codex }),
      claude: new ClaudeAdapter({ executable: paths.claude }),
    };
    await expect(
      startRun(f.config, markdown, adapters, {
        ackTrustedLocal: true,
        allowProviderCalls: false,
        assetsPath: assets,
      }),
    ).rejects.toThrow('allow-provider-calls');
    // Opt-in exercises the LIVE code path, but executables are synthetic fixtures: never claim this as live proof.
    const run = await startRun(f.config, markdown, adapters, {
      ackTrustedLocal: true,
      allowProviderCalls: true,
      assetsPath: assets,
    });
    expect(run.state.status, run.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
    expect(run.state.invocations).toHaveLength(5);
    expect(new Set(run.state.invocations.map((i) => i.processId)).size).toBe(5);
    await assertOracle(run.workspace.implementation, run.state.baseSha);
  },
  30000,
);
