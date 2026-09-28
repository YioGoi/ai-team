import process from 'node:process';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { configSchema } from '../dist/domain/schemas.js';
import { git, treeSnapshot } from '../dist/workspace/git.js';
import { runFiles } from '../dist/application/services.js';
if (!process.argv.includes('--allow-provider-calls'))
  throw new Error('Explicit --allow-provider-calls required; consumes real Codex calls');
const maxCalls = Number(process.env.AI_TEAM_PROOF_MAX_CALLS ?? 24);
if (!Number.isInteger(maxCalls) || maxCalls < 5 || maxCalls > 24)
  throw new Error(
    'AI_TEAM_PROOF_MAX_CALLS must be an integer from 5 to 24 (per-run runtime ceiling)',
  );
const app = fileURLToPath(new URL('..', import.meta.url));
const reportDirectory = join(
  app,
  'review',
  `live-proof-${new Date().toISOString().replaceAll(':', '-')}`,
);
await mkdir(reportDirectory, { recursive: true });
const root = await mkdtemp(join(tmpdir(), 'ai-team live proof '));
const repo = join(root, 'source');
await mkdir(join(repo, 'src'), { recursive: true });
await mkdir(join(repo, 'tests'));
await writeFile(
  join(repo, 'package.json'),
  JSON.stringify({ name: 'ai-team-live-fixture', private: true, type: 'module' }),
);
await writeFile(join(repo, '.gitignore'), 'build/\nnode_modules/\n');
await writeFile(
  join(repo, 'src/normalizeTitle.ts'),
  'export function normalizeTitle(input: unknown): string {\n  if (typeof input !== "string") throw new TypeError("Expected string");\n  return input;\n}\n',
);
await writeFile(
  join(repo, 'tests/normalizeTitle.test.ts'),
  'import { strict as assert } from "node:assert";\nimport { normalizeTitle } from "../src/normalizeTitle.js";\nassert.equal(normalizeTitle("Hello"), "Hello");\nassert.equal(normalizeTitle(""), "");\nassert.throws(() => normalizeTitle(42), TypeError);\n',
);
await git(repo, ['init']);
await git(repo, [
  'add',
  '--',
  '.gitignore',
  'package.json',
  'src/normalizeTitle.ts',
  'tests/normalizeTitle.test.ts',
]);
await git(repo, [
  '-c',
  'user.name=AI Team Fixture',
  '-c',
  'user.email=fixture@localhost',
  'commit',
  '-m',
  'Live proof baseline',
]);
const before = await treeSnapshot(repo);
const args = [
  join(app, 'node_modules/typescript/bin/tsc'),
  '--target',
  'ES2023',
  '--module',
  'NodeNext',
  '--moduleResolution',
  'NodeNext',
  '--strict',
  '--skipLibCheck',
  '--types',
  'node',
  '--typeRoots',
  join(app, 'node_modules/@types'),
  '--rootDir',
  '.',
  '--outDir',
  'build',
  'src/normalizeTitle.ts',
  'tests/normalizeTitle.test.ts',
];
const config = configSchema.parse({
  schemaVersion: 1,
  projectId: 'codex-live-proof',
  repositoryPath: repo,
  stateRoot: join(root, 'state'),
  profile: 'codex-only',
  roleBindings: Object.fromEntries(
    ['architect', 'implementer', 'reviewer', 'qa'].map((role) => [
      role,
      { provider: 'codex', model: null },
    ]),
  ),
  setupCommands: [],
  validators: [
    {
      id: 'build',
      executable: process.execPath,
      args,
      cwd: '.',
      approved: true,
      timeoutMs: 30000,
      required: true,
      stages: ['baseline', 'candidate'],
      allowedOutputPaths: ['build/'],
    },
    {
      id: 'typecheck',
      executable: process.execPath,
      args: [...args, '--noEmit'],
      cwd: '.',
      approved: true,
      timeoutMs: 30000,
      required: true,
      stages: ['baseline', 'candidate'],
      allowedOutputPaths: ['build/'],
    },
    {
      id: 'unit',
      executable: process.execPath,
      args: ['--test', 'build/tests/normalizeTitle.test.js'],
      cwd: '.',
      approved: true,
      timeoutMs: 30000,
      required: true,
      stages: ['baseline', 'candidate'],
      allowedOutputPaths: ['build/'],
    },
  ],
  protectedPaths: [],
  authPolicy: { route: 'saved-cli-login', allowApiFallback: false, allowCloudEndpoints: false },
  limits: {
    maxAgentInvocationsPerRun: maxCalls,
    agentTimeoutMs: 180000,
    maxActiveRuntimeMs: 1200000,
  },
  approval: { reviewedAt: new Date().toISOString() },
});
const configPath = join(root, 'config.json');
const taskPath = join(root, 'task.md');
await writeFile(configPath, JSON.stringify(config, null, 2));
await writeFile(taskPath, await readFile(join(app, 'examples/SMOKE_TASK.md')));
await writeFile(
  join(reportDirectory, 'live-proof-location.json'),
  JSON.stringify({ root, repo, configPath, taskPath, maxCalls }, null, 2),
);
const stop = new globalThis.AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());
let last = '';
const run = await runFiles(configPath, taskPath, {
  ackTrustedLocal: true,
  allowProviderCalls: true,
  signal: stop.signal,
  onProgress(s) {
    const next = `${s.runId} ${s.phase} calls=${s.invocations.length} rounds=${JSON.stringify(s.rounds)}`;
    if (next !== last) {
      process.stderr.write(next + '\n');
      last = next;
    }
  },
});
let oracle;
let oracleError = null;
try {
  assert.equal(run.state.status, 'READY_FOR_HUMAN_REVIEW', run.state.reason);
  const { normalizeTitle } = await import(
    pathToFileURL(join(run.workspace.implementation, 'build/src/normalizeTitle.js')).href
  );
  for (const [input, expected] of [
    ['  Hello   Team  ', 'Hello Team'],
    ['\tHello\n\nTeam\r\n', 'Hello Team'],
    ['\u00a0Hello\u00a0\u00a0Team\u00a0', 'Hello Team'],
    ['MiXeD Case', 'MiXeD Case'],
    ['', ''],
    [' \t\n ', ''],
  ])
    assert.equal(normalizeTitle(input), expected);
  for (const input of [null, undefined, 42, [], {}])
    assert.throws(() => normalizeTitle(input), TypeError);
  assert.notEqual((await run.workspace.cumulativeDiff(run.state.candidateSha)).trim(), '');
  const after = await treeSnapshot(repo);
  assert.equal(after.head, before.head);
  assert.equal(after.digest, before.digest);
  oracle = 'PASS';
} catch (error) {
  oracle = 'FAIL';
  oracleError = error.message;
}
const proof = {
  reportDirectory,
  at: new Date().toISOString(),
  host: process.platform,
  node: process.version,
  profile: 'codex-only',
  verificationMode: 'LIVE',
  root,
  runId: run.state.runId,
  status: run.state.status,
  reason: run.state.reason,
  baseSha: run.state.baseSha,
  candidateSha: run.state.candidateSha,
  candidate: run.workspace.implementation,
  evidence: run.directory,
  calls: run.state.invocations.length,
  workers: run.state.invocations.map((i) => ({
    id: i.id,
    role: i.role,
    pid: i.processId,
    identity: i.processIdentity,
    state: i.state,
  })),
  oracle,
  oracleError,
};
await writeFile(join(reportDirectory, 'live-proof.json'), JSON.stringify(proof, null, 2));
process.stdout.write(JSON.stringify(proof, null, 2) + '\n');
process.exitCode = oracle === 'PASS' ? 0 : 3;
