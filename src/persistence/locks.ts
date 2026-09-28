import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { TeamError } from '../domain/schemas.js';
import { atomicWrite } from './journal.js';
import { processIdentity } from '../process/supervisor.js';
const ownerSchema = z.strictObject({
  nonce: z.string(),
  pid: z.number().int().positive(),
  identity: z.string(),
  heartbeat: z.string(),
});
/** Shared by acquire, recovery and release. A crashed guard fails closed for human reconciliation. */
async function ownershipChange<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const { dirname } = await import('node:path');
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  const guard = `${directory}.ownership-guard`;
  try {
    await mkdir(guard, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new TeamError(
        'PERMISSION_DENIED',
        'Ownership change in progress or interrupted; no takeover',
      );
    throw error;
  }
  try {
    return await action();
  } finally {
    await rmdir(guard);
  }
}
export class OwnershipLock {
  private heartbeat: NodeJS.Timeout | undefined;
  private pending: Promise<void> = Promise.resolve();
  private readonly nonce = randomUUID();
  private identity = '';
  constructor(readonly directory: string) {}
  async acquire(): Promise<void> {
    const { dirname } = await import('node:path');
    await mkdir(dirname(this.directory), { recursive: true, mode: 0o700 });
    this.identity = (await processIdentity(process.pid)) ?? '';
    if (!this.identity) throw new TeamError('STATE_CORRUPT', 'Cannot identify lock owner process');
    await ownershipChange(this.directory, async () => {
      try {
        await mkdir(this.directory, { mode: 0o700 });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          throw new TeamError(
            'PERMISSION_DENIED',
            'Repository/run lock exists; inspect ownership before explicit recovery',
          );
        throw e;
      }
      await this.refresh(true);
    });
    this.heartbeat = setInterval(() => {
      this.pending = this.pending
        .then(() => this.refresh())
        .catch(() => {
          /* assertOwned fails before any next dispatch. */
        });
    }, 1000);
    this.heartbeat.unref();
  }
  private async refresh(initial = false): Promise<void> {
    if (!initial) await this.assertOwned();
    await atomicWrite(
      join(this.directory, 'owner.json'),
      JSON.stringify({
        nonce: this.nonce,
        pid: process.pid,
        identity: this.identity,
        heartbeat: new Date().toISOString(),
      }),
    );
  }
  async assertOwned(): Promise<void> {
    const owner = ownerSchema.parse(
      JSON.parse(await readFile(join(this.directory, 'owner.json'), 'utf8')),
    );
    if (owner.nonce !== this.nonce || owner.pid !== process.pid || owner.identity !== this.identity)
      throw new TeamError('STATE_CORRUPT', 'Ownership changed');
  }
  async release(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.pending;
    await ownershipChange(this.directory, async () => {
      await this.assertOwned();
      await unlink(join(this.directory, 'owner.json'));
      await rmdir(this.directory);
    });
  }
}
export async function inspectLock(directory: string): Promise<'live' | 'dead' | 'unknown'> {
  try {
    const owner = ownerSchema.parse(
      JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')),
    );
    const actual = await processIdentity(owner.pid);
    if (actual === null) return 'dead';
    return actual === owner.identity ? 'live' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Only explicit recovery may retire a provably dead owner. Unknown/reused PIDs block. */
export async function recoverDeadLock(directory: string): Promise<void> {
  await ownershipChange(directory, async () => {
    let before: string;
    try {
      before = await readFile(join(directory, 'owner.json'), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        const { stat } = await import('node:fs/promises');
        try {
          await stat(directory);
        } catch (missing) {
          if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw missing;
        }
      }
      throw new TeamError('STATE_CORRUPT', 'Lock owner cannot be established');
    }
    if ((await inspectLock(directory)) !== 'dead')
      throw new TeamError('PERMISSION_DENIED', 'Live or uncertain controller owner; no takeover');
    if ((await readFile(join(directory, 'owner.json'), 'utf8')) !== before)
      throw new TeamError('STATE_CORRUPT', 'Lock changed during recovery');
    // Retain evidence while the shared guard excludes another recovery or new owner.
    await rename(directory, `${directory}.retired-${randomUUID()}`);
  });
}
