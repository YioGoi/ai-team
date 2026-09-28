import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  Workspace,
  auditChanges,
  changedPaths,
  git,
  safePath,
  treeSnapshot,
} from '../src/workspace/git.js';
import { Journal } from '../src/persistence/journal.js';
import { runValidator } from '../src/validation/runner.js';
import { validationPassed } from '../src/domain/state.js';
import { createFixture, patchSource } from './fixture.js';
import { task } from './helpers.js';

describe('Disposable real Git candidate boundaries', () => {
  it('captures scoped new files/cumulative patch and preserves original checkout/ref (T-06)', async () => {
    const f = await createFixture();
    const original = await treeSnapshot(f.repo);
    const w = await Workspace.create(f.repo, join(f.home, 'worktrees'), 'run-git');
    const before = await treeSnapshot(w.implementation);
    await writeFile(join(w.implementation, 'src/normalizeTitle.ts'), patchSource);
    await writeFile(join(w.implementation, 'src/added.ts'), 'export const added = true;\n');
    const result = await w.checkpoint(
      before,
      { allowedPaths: ['src/'], forbiddenPaths: [] },
      [],
      ['src/added.ts', 'src/normalizeTitle.ts'],
    );
    expect(result.sha).not.toBe(w.baseSha);
    expect(result.changes).toHaveLength(2);
    expect(await w.cumulativeDiff(result.sha)).toContain('src/added.ts');
    const after = await treeSnapshot(f.repo);
    expect(after.head).toBe(original.head);
    expect(after.digest).toBe(original.digest);
    const observerA = await w.observer('reviewer', result.sha, 'a');
    const observerB = await w.observer('qa', result.sha, 'b');
    expect(observerA).not.toBe(observerB);
    expect((await treeSnapshot(observerA)).head).toBe(result.sha);
    expect((await git(f.repo, ['remote'])).trim()).toBe('');
  }, 15000);
  it('rejects protected paths, escaping symlinks, hidden secret files and unauthorized refs (T-08/24)', async () => {
    const f = await createFixture();
    const w = await Workspace.create(f.repo, join(f.home, 'worktrees'), 'run-scope');
    const before = await treeSnapshot(w.implementation);
    await writeFile(join(w.implementation, 'package.json'), '{}');
    expect(() =>
      auditChanges(
        before,
        { ...before, files: { ...before.files, 'package.json': 'changed' } },
        { allowedPaths: ['package.json'], forbiddenPaths: [] },
        [],
      ),
    ).toThrow('Unauthorized');
    await symlink(f.root, join(w.implementation, 'src/escape'));
    await expect(safePath(w.implementation, 'src/escape/private', true)).rejects.toThrow(
      'Escaping',
    );
    expect(() =>
      auditChanges(
        before,
        { ...before, files: { ...before.files, '.env': 'secret' } },
        { allowedPaths: ['.env'], forbiddenPaths: [] },
        [],
      ),
    ).toThrow('Unauthorized');
    expect(() => auditChanges(before, { ...before, refs: 'changed' }, task.scope, [])).toThrow(
      'refs',
    );
  }, 15000);
  it('refuses empty/non-root targets and detects user source edits without reverting (T-25/36)', async () => {
    const f = await createFixture();
    const empty = join(f.root, 'empty');
    await mkdir(empty);
    await expect(Workspace.create(empty, join(f.home, 'a'), 'empty')).rejects.toThrow(
      'initial commit',
    );
    const w = await Workspace.create(f.repo, join(f.home, 'worktrees'), 'run-input');
    await writeFile(join(f.repo, 'src/normalizeTitle.ts'), 'human edit');
    await expect(w.assertSource()).rejects.toThrow('Original source');
    expect(await readFile(join(f.repo, 'src/normalizeTitle.ts'), 'utf8')).toBe('human edit');
  }, 15000);
  it('records actual successful/nonzero validators and rejects validator source mutation (T-08/19/31)', async () => {
    const f = await createFixture();
    const w = await Workspace.create(f.repo, join(f.home, 'worktrees'), 'run-check');
    f.config.validators.push(
      { ...f.config.validators[2]!, id: 'fail', required: false, args: ['-e', 'process.exit(7)'] },
      {
        ...f.config.validators[2]!,
        id: 'mutate',
        required: false,
        args: ['-e', 'require("node:fs").writeFileSync("src/normalizeTitle.ts", "mutation")'],
      },
    );
    const j = new Journal(join(f.home, 'run'), 'run-check', 5_000_000);
    await j.append({
      type: 'CREATED',
      task,
      config: f.config,
      mode: 'SIMULATION',
      baseSha: w.baseSha,
      sourceDigest: w.sourceSnapshot.digest,
      manifestHash: 'manifest',
    });
    for (const id of ['build', 'typecheck', 'unit'])
      expect(
        validationPassed(await runValidator(f.config, id, w.implementation, w.baseSha, j)),
      ).toBe(true);
    const bad = structuredClone(f.config);
    bad.validators[2]!.args = ['-e', 'process.exit(7)'];
    await expect(runValidator(bad, 'unit', w.implementation, w.baseSha, j)).rejects.toThrow(
      'frozen inputs',
    );
    const failure = await runValidator(f.config, 'fail', w.implementation, w.baseSha, j);
    expect(failure.exitCode).toBe(7);
    expect(validationPassed(failure)).toBe(false);
    await expect(runValidator(f.config, 'mutate', w.implementation, w.baseSha, j)).rejects.toThrow(
      'Read-only phase',
    );
    const now = await treeSnapshot(w.implementation, ['build/']);
    expect(changedPaths(w.sourceSnapshot, now)).toContain('src/normalizeTitle.ts');
  }, 20000);
});

it.each([
  'packages/widget/package.json',
  'packages/widget/package-lock.json',
  'src/AGENTS.md',
  'src/CLAUDE.md',
  'src/.codex/config.toml',
  'src/.claude/settings.json',
  'src/.github/workflows/test.yml',
  'src/.mcp.json',
])('protects nested execution/instruction surface %s (REVIEW-03)', (path) => {
  const before = { head: 'sha', refs: 'refs', digest: '', files: {} };
  expect(() =>
    auditChanges(
      before,
      { ...before, files: { [path]: 'modified' } },
      { allowedPaths: ['src/', 'packages/'], forbiddenPaths: [] },
      [],
    ),
  ).toThrow('Unauthorized');
});
it('candidate audit rejects branch and nonmanaged ref changes (REVIEW-02)', async () => {
  const f = await createFixture();
  const w = await Workspace.create(f.repo, join(f.home, 'worktrees'), 'run-final-refs');
  const before = await treeSnapshot(w.implementation);
  await git(w.implementation, ['branch', 'unexpected']);
  await expect(w.assertCandidate(before.head, before.digest, [])).rejects.toThrow(
    'Frozen candidate',
  );
  await git(w.implementation, ['branch', '-d', 'unexpected']);
  await git(w.implementation, ['checkout', '--detach']);
  await expect(w.assertCandidate(before.head, before.digest, [])).rejects.toThrow();
}, 15000);
