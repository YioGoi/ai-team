import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { inScope, matchesPath, relativePath, TeamError } from '../domain/schemas.js';
import type { TaskSpec } from '../domain/schemas.js';
import { hash } from '../persistence/journal.js';
import { childEnvironment } from '../process/supervisor.js';
const exec = promisify(execFile);
export const defaultProtected = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '.github/',
  '.gitlab-ci.yml',
  'AGENTS.md',
  'CLAUDE.md',
  '.codex/',
  '.claude/',
  '.mcp.json',
];
export const within = (path: string, root: string): boolean =>
  path === root || path.startsWith(root.endsWith('/') ? root : root + '/');
export function sensitive(path: string): boolean {
  return path
    .split('/')
    .some(
      (part) =>
        part === '.git' ||
        part === '.ssh' ||
        part === '.aws' ||
        part === '.env' ||
        (part.startsWith('.env.') && !part.endsWith('.example')) ||
        /\.(?:pem|key|p12|pfx)$/iu.test(part) ||
        /^(?:id_rsa|id_ed25519|credentials(?:\.json)?|auth\.json)$/u.test(part),
    );
}
export async function canonical(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new TeamError('INVALID_INPUT', 'Expected absolute path');
  return realpath(path);
}
export async function safePath(root: string, path: string, allowMissing = false): Promise<string> {
  if (path !== '.') relativePath.parse(path);
  const base = await realpath(root);
  const resolved = resolve(base, path);
  if (!within(resolved, base)) throw new TeamError('SCOPE_VIOLATION', 'Path escapes workspace');
  let probe = resolved;
  while (true) {
    try {
      const actual = await realpath(probe);
      if (!within(actual, base))
        throw new TeamError('SCOPE_VIOLATION', `Escaping symlink: ${path}`);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' || !allowMissing || probe === base)
        throw e;
      probe = dirname(probe);
    }
  }
  return resolved;
}
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        cwd,
        env: childEnvironment(),
        shell: false,
        timeout: 30_000,
        maxBuffer: 10_485_760,
        encoding: 'utf8',
      },
    );
    return stdout;
  } catch (error) {
    throw new TeamError(
      'UNKNOWN',
      `Git ${args[0]} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
export interface TreeSnapshot {
  head: string;
  refs: string;
  digest: string;
  files: Record<string, string>;
}
export async function treeSnapshot(root: string, outputs: string[] = []): Promise<TreeSnapshot> {
  const tracked = (await git(root, ['ls-files', '-z'])).split('\0').filter(Boolean);
  const files: Record<string, string> = {};
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(root, path).split('\\').join('/');
      if (rel === '.git') continue;
      if (
        outputs.some(
          (rule) => matchesPath(rel, rule) || (rule.endsWith('/') && rel === rule.slice(0, -1)),
        )
      )
        continue;
      if (entry.isSymbolicLink()) {
        await safePath(root, rel); // Reject escaping links even if their content is not read.
        const { readlink } = await import('node:fs/promises');
        files[rel] = `symlink:${await readlink(path)}`;
      } else if (entry.isDirectory()) await walk(path);
      else files[rel] = hash(await readFile(path));
    }
  };
  await walk(root);
  for (const path of tracked) {
    await safePath(root, path, true);
    try {
      const info = await lstat(join(root, path));
      if (info.isSymbolicLink()) continue;
      files[path] = hash(await readFile(join(root, path)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      delete files[path];
    }
  }
  return {
    head: (await git(root, ['rev-parse', 'HEAD'])).trim(),
    refs: await git(root, ['for-each-ref', '--format=%(refname) %(objectname)']),
    files,
    digest: hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))),
  };
}
/** Reconstruct the recorded commit without checking out or changing any files. */
export async function committedSnapshot(
  root: string,
  sha: string,
  refs: string,
): Promise<TreeSnapshot> {
  if (!/^[a-f0-9]{40,64}$/u.test(sha))
    throw new TeamError('STATE_CORRUPT', 'Invalid recorded commit');
  const entries = (await git(root, ['ls-tree', '-rz', '--full-tree', sha]))
    .split('\0')
    .filter(Boolean);
  const files: Record<string, string> = {};
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode, type, objectId] = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    relativePath.parse(path);
    if (type !== 'blob' || !objectId)
      throw new TeamError('SCOPE_VIOLATION', 'Writer recovery does not support submodules');
    const { stdout } = await exec('git', ['cat-file', 'blob', objectId], {
      cwd: root,
      env: childEnvironment(),
      shell: false,
      timeout: 30000,
      maxBuffer: 10485760,
      encoding: 'buffer',
    });
    files[path] = mode === '120000' ? `symlink:${stdout.toString('utf8')}` : hash(stdout);
  }
  return {
    head: sha,
    refs,
    files,
    digest: hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))),
  };
}
export function changedPaths(before: TreeSnapshot, after: TreeSnapshot): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .filter((p) => before.files[p] !== after.files[p])
    .sort();
}
export function auditChanges(
  before: TreeSnapshot,
  after: TreeSnapshot,
  scope: TaskSpec['scope'],
  protectedPaths: string[],
): string[] {
  if (before.head !== after.head || before.refs !== after.refs)
    throw new TeamError('SCOPE_VIOLATION', 'Worker changed Git HEAD/refs');
  const changes = changedPaths(before, after);
  for (const path of changes)
    if (
      sensitive(path) ||
      !inScope(path, scope) ||
      protectedPaths.some((rule) => matchesPath(path, rule)) ||
      path
        .split('/')
        .some((_, index, parts) =>
          defaultProtected.some((rule) => matchesPath(parts.slice(index).join('/'), rule)),
        )
    )
      throw new TeamError('SCOPE_VIOLATION', `Unauthorized changed path: ${path}`);
  return changes;
}
export function assertUnmutated(before: TreeSnapshot, after: TreeSnapshot): void {
  if (before.head !== after.head || before.refs !== after.refs || before.digest !== after.digest)
    throw new TeamError('SCOPE_VIOLATION', 'Read-only phase mutated source or refs');
}
export class Workspace {
  readonly branch: string;
  readonly implementation: string;
  private constructor(
    readonly source: string,
    readonly directory: string,
    readonly baseSha: string,
    readonly sourceSnapshot: TreeSnapshot,
    runId: string,
  ) {
    this.branch = `ai-team/${runId}`;
    this.implementation = join(directory, 'implementation');
  }
  static async create(sourcePath: string, directory: string, runId: string): Promise<Workspace> {
    const source = await canonical(sourcePath);
    let root: string;
    try {
      root = (await git(source, ['rev-parse', '--show-toplevel'])).trim();
    } catch {
      throw new TeamError(
        'INVALID_INPUT',
        'Target must be a scaffolded Git repository with an initial commit',
      );
    }
    if ((await realpath(root)) !== source)
      throw new TeamError('INVALID_INPUT', 'Target must be its Git checkout root');
    if (within(resolve(directory), source))
      throw new TeamError('INVALID_INPUT', 'State/worktrees must be outside target');
    if ((await git(source, ['status', '--porcelain=v1', '--untracked-files=all'])).trim())
      throw new TeamError('INPUT_CHANGED', 'Target source checkout must be clean');
    const initial = await treeSnapshot(source, ['node_modules/']);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const workspace = new Workspace(source, directory, initial.head, initial, runId);
    await git(source, [
      'worktree',
      'add',
      '-b',
      workspace.branch,
      workspace.implementation,
      initial.head,
    ]);
    // Managed branch creation is the intended ref mutation, not a source edit.
    workspace.sourceSnapshot.refs = await git(source, [
      'for-each-ref',
      '--format=%(refname) %(objectname)',
    ]);
    return workspace;
  }
  static restore(
    source: string,
    directory: string,
    baseSha: string,
    snapshot: TreeSnapshot,
    runId: string,
  ): Workspace {
    return new Workspace(source, directory, baseSha, snapshot, runId);
  }
  async assertSource(): Promise<void> {
    const actual = await treeSnapshot(this.source, ['node_modules/']);
    if (actual.head !== this.sourceSnapshot.head || actual.digest !== this.sourceSnapshot.digest)
      throw new TeamError(
        'INPUT_CHANGED',
        'Original source checkout changed; human edits preserved',
      );
  }
  async assertCandidate(sha: string, digest: string, outputs: string[]): Promise<void> {
    await this.assertSource();
    const actual = await treeSnapshot(this.implementation, outputs);
    const unmanaged = (refs: string) =>
      refs
        .split('\n')
        .filter((line) => !line.startsWith(`refs/heads/${this.branch} `))
        .join('\n');
    if (
      actual.head !== sha ||
      actual.digest !== digest ||
      (await git(this.implementation, ['symbolic-ref', '--short', 'HEAD'])).trim() !==
        this.branch ||
      !actual.refs.split('\n').includes(`refs/heads/${this.branch} ${sha}`) ||
      unmanaged(actual.refs) !== unmanaged(this.sourceSnapshot.refs)
    ) {
      throw new TeamError(
        'SCOPE_VIOLATION',
        'Frozen candidate or protected Git refs changed; human edits preserved',
      );
    }
  }
  async observer(role: string, sha: string, suffix: string): Promise<string> {
    const path = join(this.directory, `observe-${role}-${sha.slice(0, 12)}-${suffix}`);
    await git(this.source, ['worktree', 'add', '--detach', path, sha]);
    return path;
  }
  async checkpoint(
    before: TreeSnapshot,
    scope: TaskSpec['scope'],
    protectedPaths: string[],
    declared: string[],
    outputs: string[] = [],
    expectedDigest?: string,
  ): Promise<{ sha: string; snapshot: TreeSnapshot; changes: string[] }> {
    await this.assertSource();
    const after = await treeSnapshot(this.implementation, outputs);
    if (
      (await git(this.implementation, ['symbolic-ref', '--short', 'HEAD'])).trim() !== this.branch
    )
      throw new TeamError('SCOPE_VIOLATION', 'Managed branch changed');
    if (expectedDigest !== undefined && after.digest !== expectedDigest)
      throw new TeamError('INPUT_CHANGED', 'Reviewed candidate changed before checkpoint');
    const changes = auditChanges(before, after, scope, protectedPaths);
    if (JSON.stringify([...new Set(declared)].sort()) !== JSON.stringify(changes))
      throw new TeamError('INVALID_RESULT', 'Declared changed files do not match actual files');
    if (changes.length) {
      await git(this.implementation, ['add', '--', ...changes]);
      await git(this.implementation, [
        '-c',
        'user.name=AI Team',
        '-c',
        'user.email=ai-team@localhost',
        'commit',
        '-m',
        'AI Team candidate checkpoint',
      ]);
    }
    const snapshot = await treeSnapshot(this.implementation, outputs);
    await this.assertSource();
    return { sha: snapshot.head, snapshot, changes };
  }
  async cumulativeDiff(sha: string): Promise<string> {
    return git(this.implementation, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--binary',
      this.baseSha,
      sha,
      '--',
    ]);
  }
}

/** Canonicalize before mkdir so invalid state locations cannot mutate the target. */
export async function prospectiveCanonical(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new TeamError('INVALID_INPUT', 'Expected absolute path');
  const { basename } = await import('node:path');
  let ancestor = resolve(path);
  const suffix: string[] = [];
  while (true) {
    try {
      ancestor = await realpath(ancestor);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      suffix.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  return join(ancestor, ...suffix);
}
