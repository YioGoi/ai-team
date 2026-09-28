import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './helpers.js';
import { git } from '../src/workspace/git.js';
export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ai-team fixture '));
  const repo = join(root, 'source repo');
  const home = join(root, 'state');
  await mkdir(join(repo, 'src'), { recursive: true });
  await mkdir(join(repo, 'tests'));
  await writeFile(
    join(repo, 'package.json'),
    JSON.stringify({ name: 'ai-team-proving-fixture', private: true, type: 'module' }),
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
    'user.name=Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-m',
    'Baseline fixture',
  ]);
  const c = config();
  c.repositoryPath = repo;
  c.stateRoot = home;
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
  const types = fileURLToPath(new URL('../node_modules/@types', import.meta.url));
  const args = [
    tsc,
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
    types,
    '--rootDir',
    '.',
    '--outDir',
    'build',
    'src/normalizeTitle.ts',
    'tests/normalizeTitle.test.ts',
  ];
  c.validators = [
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
  ];
  return { root, repo, home, config: c };
}
export const patchSource =
  'export function normalizeTitle(input: unknown): string {\n  if (typeof input !== "string") throw new TypeError("Expected string");\n  return input.trim().replace(/\\s+/gu, " ");\n}\n';
