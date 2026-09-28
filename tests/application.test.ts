import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, it } from 'vitest';
import {
  cancelRun,
  exportRun,
  initProject,
  readRun,
  resumeRun,
  runFiles,
  runStatus,
} from '../src/application/services.js';
import { liveProbe } from '../src/application/live-probe.js';
import { Journal } from '../src/persistence/journal.js';
import { OwnershipLock } from '../src/persistence/locks.js';
import { mockAdapter } from '../src/providers/mock.js';
import { git, treeSnapshot } from '../src/workspace/git.js';
import { createFixture } from './fixture.js';
import { assertOracle } from './oracle.js';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'dist/cli.js');
const assets = join(root, 'assets');
const bindings = { mock: mockAdapter(join(assets, 'mock-worker.mjs')) };
const options = { ackTrustedLocal: true, allowProviderCalls: false, assetsPath: assets };
const markdown = await readFile(join(root, 'examples/SMOKE_TASK.md'), 'utf8');
beforeAll(async () => {
  await exec('npm', ['run', 'build'], { cwd: root });
}, 30000);
async function selected() {
  const f = await createFixture();
  const vault = join(f.root, 'vault notes $(literal)');
  await mkdir(vault);
  const taskPath = join(vault, 'selected task.md');
  const configPath = join(f.root, 'config.json');
  await writeFile(taskPath, markdown);
  await writeFile(configPath, JSON.stringify(f.config));
  await writeFile(join(vault, 'unselected.md'), 'Never ingest this linked note');
  return { ...f, vault, taskPath, configPath };
}
async function command(args: string[], home: string) {
  try {
    const r = await exec(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, AI_TEAM_HOME: home },
      maxBuffer: 1000000,
    });
    return { ...r, code: 0 };
  } catch (e) {
    const r = e as { code: number; stdout: string; stderr: string };
    return r;
  }
}
it('compiled CLI rejects unknown/invalid arguments before calls; help and JSON errors work', async () => {
  const f = await selected();
  expect((await command(['--help'], f.home)).code).toBe(0);
  expect((await command(['run', '--surprise'], f.home)).code).toBe(2);
  const invalid = await command(['doctor', '--provider', 'codex', '--json'], f.home);
  expect(invalid.code).toBe(2);
  expect(JSON.parse(invalid.stderr).error.code).toBe('INVALID_INPUT');
  expect((await command(['doctor', '--live', '--provider', 'codex'], f.home)).code).toBe(3);
  expect(
    (await command(['run', '--config', f.configPath, '--task', f.taskPath], f.home)).code,
  ).toBe(3);
});
it('registration proposes unapproved separate configs; never overwrites or scaffolds empty targets (T-36)', async () => {
  const a = await selected();
  const b = await createFixture();
  await writeFile(
    join(a.repo, 'package.json'),
    JSON.stringify({ scripts: { test: 'node test.js', build: 'tsc' } }),
  );
  const first = await initProject(a.repo, 'codex-only', a.home);
  const second = await initProject(b.repo, 'mock', a.home);
  expect(first).not.toBe(second);
  const config = JSON.parse(await readFile(first, 'utf8'));
  expect(config.validators.map((v: { approved: boolean }) => v.approved)).toEqual([false, false]);
  expect(config.approval.reviewedAt).toBeNull();
  await expect(initProject(a.repo, 'mock', a.home)).rejects.toThrow();
  const empty = join(a.root, 'empty');
  await mkdir(empty);
  await expect(initProject(empty, 'mock', a.home)).rejects.toThrow('scaffold');
  await expect(initProject(a.repo, 'mock', join(a.repo, 'state'))).rejects.toThrow('separate');
});
it('compiled run/status/export work across spaced paths with independent behavior oracle (T-16/17/18/32/37/38)', async () => {
  const f = await selected();
  const original = await treeSnapshot(f.repo);
  await initProject(f.repo, 'mock', f.home);
  const run = await command(
    ['run', '--config', f.configPath, '--task', f.taskPath, '--ack-trusted-local'],
    f.home,
  );
  expect(run.code, run.stderr + run.stdout).toBe(0);
  const result = JSON.parse(run.stdout);
  expect(result.mode).toBe('SIMULATION');
  await assertOracle(result.candidate, original.head);
  const status = await command(['status', result.runId, '--json'], f.home);
  const state = JSON.parse(status.stdout);
  expect(state.status).toBe('READY_FOR_HUMAN_REVIEW');
  expect(state.invocations).toHaveLength(5);
  const journal = new Journal(
    result.evidence,
    result.runId,
    f.config.limits.maxArtifactBytesPerRun,
  );
  await journal.load();
  await journal.append({
    type: 'NOTICE',
    message: 'Synthetic redaction probe api_key=fixture-secret-do-not-export',
  });
  const journalBefore = await readFile(join(result.evidence, 'events.jsonl'), 'utf8');
  const one = await exportRun(result.runId, f.vault, f.home);
  const two = await exportRun(result.runId, f.vault, f.home);
  expect(one).not.toBe(two);
  const summary = await readFile(one, 'utf8');
  expect(summary).toContain('SIMULATION');
  expect(summary).not.toContain('unselected');
  expect(summary).not.toContain('diff --git');
  expect(summary).not.toContain('fixture-secret-do-not-export');
  expect(summary).toContain('[REDACTED]');
  expect(await readFile(join(result.evidence, 'events.jsonl'), 'utf8')).toBe(journalBefore);
  expect((await treeSnapshot(f.repo)).digest).toBe(original.digest);
  const link = join(f.vault, 'source-link');
  await symlink(f.repo, link);
  await expect(exportRun(result.runId, link, f.home)).rejects.toThrow('registered target');
  await expect(exportRun(result.runId, f.home, f.home)).rejects.toThrow('authoritative');
  await expect(resumeRun(result.runId, options, bindings, f.home)).rejects.toThrow('Cannot resume');
}, 30000);
it('pause before writer and explicit resume preserve completed planning, round and frozen external task (T-10/15/25/33)', async () => {
  const f = await selected();
  const stop = new AbortController();
  const paused = await runFiles(
    f.configPath,
    f.taskPath,
    {
      ...options,
      signal: stop.signal,
      onProgress(s) {
        if (s.phase === 'IMPLEMENTING') stop.abort();
      },
    },
    bindings,
  );
  expect(paused.state.status, paused.state.reason).toBe('PAUSED');
  expect(paused.state.invocations).toHaveLength(2);
  expect(paused.state.rounds.normalize).toBe(1);
  await writeFile(f.taskPath, 'Changed task with no valid JSON');
  await writeFile(f.configPath, '{}');
  const resumed = await resumeRun(paused.state.runId, options, bindings, f.home);
  expect(resumed.state.status, resumed.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(resumed.state.invocations).toHaveLength(5);
  expect(resumed.state.rounds.normalize).toBe(1);
  expect(resumed.state.notices.filter((n) => n.startsWith('External'))).toHaveLength(2);
  expect(resumed.state.activeMs).toBeGreaterThanOrEqual(paused.state.activeMs);
  await assertOracle(resumed.workspace.implementation, resumed.state.baseSha);
}, 30000);
it('pause after checkpoint resumes review without a second writer; cancellation is terminal', async () => {
  const f = await selected();
  const stop = new AbortController();
  const paused = await runFiles(
    f.configPath,
    f.taskPath,
    {
      ...options,
      signal: stop.signal,
      onProgress(s) {
        if (s.phase === 'REVIEW_QA') stop.abort();
      },
    },
    bindings,
  );
  expect(paused.state.status).toBe('PAUSED');
  expect(paused.state.invocations.filter((i) => i.role === 'implementer')).toHaveLength(1);
  const resumed = await resumeRun(paused.state.runId, options, bindings, f.home);
  expect(resumed.state.status, resumed.state.reason).toBe('READY_FOR_HUMAN_REVIEW');
  expect(resumed.state.invocations.filter((i) => i.role === 'implementer')).toHaveLength(1);
  const other = await selected();
  const abort = new AbortController();
  abort.abort();
  const early = await runFiles(
    other.configPath,
    other.taskPath,
    { ...options, signal: abort.signal },
    bindings,
  );
  await cancelRun(early.state.runId, other.home);
  expect((await readRun(early.state.runId, other.home)).state.status).toBe('CANCELLED');
  await expect(resumeRun(early.state.runId, options, bindings, other.home)).rejects.toThrow(
    'Cannot resume',
  );
}, 30000);
it('crashed reservation consumes credit and refuses uncertain replay; internal tampering blocks (T-16/25)', async () => {
  const f = await selected();
  const stop = new AbortController();
  stop.abort();
  const paused = await runFiles(
    f.configPath,
    f.taskPath,
    { ...options, signal: stop.signal },
    bindings,
  );
  const journal = new Journal(
    paused.directory,
    paused.state.runId,
    f.config.limits.maxArtifactBytesPerRun,
  );
  await journal.load();
  await journal.append({ type: 'STATUS', status: 'RUNNING', reason: 'Simulated crash test' });
  await journal.append({
    type: 'RESERVED',
    invocation: {
      id: 'crashed-call',
      role: 'architect',
      basisSha: paused.state.baseSha,
      milestoneId: null,
      round: 0,
      issueIds: [],
      kind: 'initial',
      stepId: 'architect:null:0',
      state: 'reserved',
      processId: null,
      processIdentity: null,
    },
  });
  await expect(resumeRun(paused.state.runId, options, bindings, f.home)).rejects.toThrow(
    'uncertain dispatch',
  );
  expect((await runStatus(paused.state.runId, f.home)).invocations).toHaveLength(1);
  const fresh = await selected();
  const clean = await runFiles(
    fresh.configPath,
    fresh.taskPath,
    { ...options, signal: stop.signal },
    bindings,
  );
  await writeFile(join(clean.directory, 'inputs/architect.md'), 'tampered');
  await expect(resumeRun(clean.state.runId, options, bindings, fresh.home)).rejects.toThrow(
    'snapshot changed',
  );
}, 30000);
it('actual SIGINT pauses a foreground command; cancel asks the live owner to stop (T-15)', async () => {
  for (const cancel of [false, true]) {
    const f = await selected();
    f.config.validators[0]!.args = ['-e', 'setTimeout(() => {}, 10000)'];
    await writeFile(f.configPath, JSON.stringify(f.config));
    const child = spawn(
      process.execPath,
      [cli, 'run', '--config', f.configPath, '--task', f.taskPath, '--ack-trusted-local'],
      {
        cwd: root,
        env: { ...process.env, AI_TEAM_HOME: f.home },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    let runId = '';
    let requested = false;
    let requestWork: Promise<unknown> = Promise.resolve();
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      const text = String(chunk);
      runId ||= text.match(/run-[0-9a-f-]+/u)?.[0] ?? '';
      if (!requested && text.includes('BASELINE') && runId) {
        requested = true;
        if (cancel) requestWork = cancelRun(runId, f.home);
        else child.kill('SIGINT');
      }
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    await requestWork;
    expect(code, output).toBe(cancel ? 130 : 4);
    expect(JSON.parse(output).status).toBe(cancel ? 'CANCELLED' : 'PAUSED');
  }
}, 30000);
it('live diagnostic refuses missing opt-in before even probing', async () => {
  let probes = 0;
  const fake = {
    ...bindings.mock,
    async probe() {
      probes++;
      return bindings.mock.probe();
    },
  };
  await expect(liveProbe('codex', false, { codex: fake })).rejects.toThrow(
    '--allow-provider-calls',
  );
  expect(probes).toBe(0);
});

it('alternate state root cannot evade shared repository ownership; invalid root creates no source files', async () => {
  const f = await selected();
  const common = (
    await git(f.repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim();
  const owner = new OwnershipLock(join(common, 'ai-team-controller.lock'));
  await owner.acquire();
  try {
    await expect(runFiles(f.configPath, f.taskPath, options, bindings)).rejects.toThrow(
      'lock exists',
    );
  } finally {
    await owner.release();
  }
  f.config.stateRoot = join(f.repo, 'forbidden-state');
  await writeFile(f.configPath, JSON.stringify(f.config));
  await expect(runFiles(f.configPath, f.taskPath, options, bindings)).rejects.toThrow('separate');
  await expect(stat(f.config.stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
}, 30000);
it('live doctor transport can be proved offline with one separately recorded fake process', async () => {
  const f = await selected();
  const result = await liveProbe('codex', true, { codex: bindings.mock }, f.home);
  expect(result.modelInvocations).toBe(1);
  expect(result.teamWorkflowVerified).toBe(false);
  // The LIVE diagnostic code path used a mock executable here; this test is not live evidence.
  const { replay } = await import('../src/persistence/journal.js');
  const state = replay(
    await readFile(join(result.evidenceDirectory, 'events.jsonl'), 'utf8'),
  ).state!;
  expect(state.invocations).toHaveLength(1);
  expect(state.invocations[0]!.state).toBe('exited');
}, 30000);
