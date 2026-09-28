import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eventSchema, reduce } from '../domain/state.js';
import type { Event, EventPayload, RunState } from '../domain/state.js';
import { TeamError } from '../domain/schemas.js';
export const hash = (input: string | Buffer): string =>
  createHash('sha256').update(input).digest('hex');
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
}
export interface Replay {
  state: RunState | undefined;
  events: Event[];
  trailing: string | null;
}
export function replay(input: string): Replay {
  const lines = input.split('\n');
  const trailing = lines.pop() ?? '';
  const events: Event[] = [];
  const seen = new Map<string, string>();
  let state: RunState | undefined;
  for (const line of lines) {
    if (!line) throw new TeamError('STATE_CORRUPT', 'Empty interior journal record');
    let event: Event;
    try {
      event = eventSchema.parse(JSON.parse(line));
    } catch {
      throw new TeamError('STATE_CORRUPT', 'Malformed interior journal record');
    }
    const canonical = JSON.stringify(event);
    const prior = seen.get(event.eventId);
    if (prior) {
      if (prior !== canonical)
        throw new TeamError('STATE_CORRUPT', 'Conflicting duplicate journal event');
      continue;
    }
    state = reduce(state, event);
    events.push(event);
    seen.set(event.eventId, canonical);
  }
  return { state, events, trailing: trailing || null };
}
/** One instance is used only while holding exclusive run/repository ownership. */
export class Journal {
  state: RunState | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private bytes = 0;
  // Kept available for one bounded terminal event and its derived snapshots.
  private readonly terminalReserve = 32_768;
  constructor(
    readonly directory: string,
    readonly runId: string,
    private readonly maxBytes: number,
    private readonly clock = () => new Date().toISOString(),
    private readonly ids = randomUUID as () => string,
  ) {}
  async load(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let input: string;
    try {
      input = await readFile(join(this.directory, 'events.jsonl'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.bytes = await this.artifactSize();
        return;
      }
      throw e;
    }
    const result = replay(input);
    this.state = result.state;
    this.bytes = await this.artifactSize();
    if (result.trailing) {
      // Preserve incomplete bytes before removing only that uncommitted suffix.
      await this.writeArtifact(`torn-${this.ids()}.txt`, result.trailing);
      await atomicWrite(
        join(this.directory, 'events.jsonl'),
        input.slice(0, input.length - result.trailing.length),
      );
      await this.append({
        type: 'NOTICE',
        message:
          'Quarantined incomplete trailing journal record; reservations in complete records remain consumed',
      });
    }
  }
  private async artifactSize(): Promise<number> {
    const { readdir } = await import('node:fs/promises');
    const walk = async (directory: string): Promise<number> => {
      let total = 0;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === 'worktrees' || entry.name === 'lock') continue;
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          throw new TeamError('STATE_CORRUPT', 'Symlink inside authoritative artifact storage');
        total += entry.isDirectory() ? await walk(path) : (await stat(path)).size;
      }
      return total;
    };
    return walk(this.directory);
  }
  append(payload: EventPayload, artifacts: Record<string, string> = {}): Promise<RunState> {
    const operation = this.queue.then(async () => {
      if (payload.type === 'STATUS' && ['BLOCKED', 'PAUSED', 'CANCELLED'].includes(payload.status))
        payload = { ...payload, reason: payload.reason.slice(0, 1024) };
      const terminal =
        payload.type === 'STATUS' && ['BLOCKED', 'PAUSED', 'CANCELLED'].includes(payload.status);
      const event = eventSchema.parse({
        schemaVersion: 1,
        eventId: this.ids(),
        runId: this.runId,
        seq: (this.state?.seq ?? 0) + 1,
        at: this.clock(),
        payload,
      });
      const next = reduce(this.state, event);
      const line = JSON.stringify(event) + '\n';
      const snapshots = this.snapshotContents(next);
      const reports = Object.entries(artifacts);
      if (reports.some(([path]) => !path.startsWith('artifacts/')))
        throw new TeamError('STATE_CORRUPT', 'Transactional reports must be under artifacts/');
      let projected = this.bytes + Buffer.byteLength(line);
      for (const [path, content] of [...snapshots, ...reports])
        projected += Buffer.byteLength(content) - (await this.priorSize(path));
      if (projected > this.maxBytes - (terminal ? 0 : this.terminalReserve))
        throw new TeamError(
          'BUDGET_EXHAUSTED',
          'Artifact cap prevents journal append and snapshots',
        );
      // Reports must exist before a terminal success record becomes authoritative.
      for (const [path, content] of reports) await this.writeArtifactNow(path, content, true);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = await open(join(this.directory, 'events.jsonl'), 'a', 0o600);
      try {
        await file.writeFile(line);
        await file.sync();
      } finally {
        await file.close();
      }
      this.bytes += Buffer.byteLength(line);
      this.state = next;
      for (const [path, content] of snapshots) await this.writeArtifactNow(path, content, true);
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(action);
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  snapshot(): Promise<void> {
    return this.enqueue(() => this.snapshotNow());
  }
  private snapshotContents(state: RunState): [string, string][] {
    return [
      ['run.json', JSON.stringify(state, null, 2)],
      [
        'STATUS.md',
        `# ${this.runId}\n\n${state.status} · ${state.phase} · ${state.mode}\n\n${state.reason}\n\nCompleted milestones: ${state.completedMilestones.length}/${state.milestones.length}\nCalls reserved: ${state.invocations.length}/${state.config.limits.maxAgentInvocationsPerRun}\nCandidate: ${state.candidateSha}\n`,
      ],
    ];
  }
  private async priorSize(relative: string): Promise<number> {
    try {
      return (await stat(join(this.directory, relative))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return 0;
    }
  }
  private async snapshotNow(): Promise<void> {
    if (!this.state) return;
    for (const [path, content] of this.snapshotContents(this.state))
      await this.writeArtifactNow(path, content);
  }
  writeArtifact(relative: string, content: string): Promise<void> {
    return this.enqueue(() => this.writeArtifactNow(relative, content));
  }
  private async writeArtifactNow(
    relative: string,
    content: string,
    reserved = false,
  ): Promise<void> {
    if (
      relative.startsWith('/') ||
      relative.split('/').some((p) => p === '..' || p === '.') ||
      relative.includes('\\')
    )
      throw new TeamError('STATE_CORRUPT', 'Invalid artifact path');
    let cursor = this.directory;
    for (const part of relative.split('/')) {
      cursor = join(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new TeamError('STATE_CORRUPT', 'Symlink in artifact path');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    const path = join(this.directory, relative);
    let prior = 0;
    try {
      prior = (await stat(path)).size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const next = this.bytes - prior + Buffer.byteLength(content);
    if (next > this.maxBytes - (reserved ? 0 : this.terminalReserve))
      throw new TeamError('BUDGET_EXHAUSTED', 'Artifact byte limit exhausted');
    const { dirname } = await import('node:path');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await atomicWrite(path, content);
    this.bytes = next;
  }
}
export async function freezeInputs(
  directory: string,
  task: string,
  config: string,
  files: Record<string, string> = {},
): Promise<string> {
  await mkdir(join(directory, 'inputs'), { recursive: true, mode: 0o700 });
  const manifest = JSON.stringify({
    taskHash: hash(task),
    configHash: hash(config),
    files: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, hash(value)])),
  });
  for (const [name, value] of [
    ['task.md', task],
    ['config.json', config],
    ['manifest.json', manifest],
  ])
    await writeFile(join(directory, 'inputs', name!), value!, { flag: 'wx', mode: 0o600 });
  for (const [name, value] of Object.entries(files))
    await writeFile(join(directory, 'inputs', name), value, { flag: 'wx', mode: 0o600 });
  return hash(manifest);
}
export async function verifyInputs(
  directory: string,
  expectedManifestHash: string,
): Promise<{ task: string; config: string }> {
  const manifest = await readFile(join(directory, 'inputs/manifest.json'), 'utf8');
  if (hash(manifest) !== expectedManifestHash)
    throw new TeamError('INPUT_CHANGED', 'Internal manifest changed');
  const parsed: unknown = JSON.parse(manifest);
  const task = await readFile(join(directory, 'inputs/task.md'), 'utf8');
  const config = await readFile(join(directory, 'inputs/config.json'), 'utf8');
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('taskHash' in parsed) ||
    !('configHash' in parsed) ||
    parsed.taskHash !== hash(task) ||
    parsed.configHash !== hash(config)
  )
    throw new TeamError('INPUT_CHANGED', 'Internal input snapshots changed');
  if ('files' in parsed && parsed.files && typeof parsed.files === 'object') {
    for (const [name, digest] of Object.entries(parsed.files)) {
      if (
        !/^[A-Za-z0-9_.-]+$/u.test(name) ||
        hash(await readFile(join(directory, 'inputs', name))) !== digest
      )
        throw new TeamError('INPUT_CHANGED', 'Internal recovery/role snapshot changed');
    }
  }
  return { task, config };
}
