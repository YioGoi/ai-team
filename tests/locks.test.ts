import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { inspectLock, OwnershipLock, recoverDeadLock } from '../src/persistence/locks.js';
const interleave = vi.hoisted(() => ({
  directory: '',
  beforeRename: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (args[0] === interleave.directory) await interleave.beforeRename?.();
      return actual.rename(...args);
    },
  };
});
it('recovery cannot retire a new owner while another recovery is at rename (REVIEW-05)', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ai-team-recovery-race-'));
  const dir = join(parent, 'lock');
  await mkdir(dir);
  const owner = JSON.stringify({ nonce: 'old', pid: 2147483647, identity: 'dead', heartbeat: '' });
  await writeFile(join(dir, 'owner.json'), owner);
  expect(await inspectLock(dir)).toBe('dead');
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pause = new Promise<void>((resolve) => {
    release = resolve;
  });
  interleave.directory = dir;
  interleave.beforeRename = async () => {
    entered();
    await pause;
  };
  const first = recoverDeadLock(dir);
  await waiting;
  const fresh = new OwnershipLock(dir);
  try {
    await expect(recoverDeadLock(dir)).rejects.toThrow('Ownership change');
    await expect(fresh.acquire()).rejects.toThrow('Ownership change');
    expect(await readFile(join(dir, 'owner.json'), 'utf8')).toBe(owner);
  } finally {
    release();
    await first;
    interleave.beforeRename = undefined;
  }
  await fresh.acquire();
  try {
    const newOwner = await readFile(join(dir, 'owner.json'), 'utf8');
    await expect(recoverDeadLock(dir)).rejects.toThrow('Live or uncertain');
    expect(await readFile(join(dir, 'owner.json'), 'utf8')).toBe(newOwner);
    await fresh.assertOwned();
    expect((await readdir(parent)).filter((name) => name.startsWith('lock.retired-'))).toHaveLength(
      1,
    );
  } finally {
    await fresh.release();
  }
});
it('an interrupted ownership guard fails closed without automated stale takeover (REVIEW-05)', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'ai-team-stale-guard-')), 'lock');
  await mkdir(`${dir}.ownership-guard`);
  await expect(new OwnershipLock(dir).acquire()).rejects.toThrow('Ownership change');
  await expect(recoverDeadLock(dir)).rejects.toThrow('Ownership change');
});
