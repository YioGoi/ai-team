import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  childEnvironment,
  groupAlive,
  processIdentity,
  redact,
  supervise,
} from '../src/process/supervisor.js';
import { extractStructured, JsonlDecoder, providerEventSchema } from '../src/providers/decoder.js';
import { inspectLock, OwnershipLock } from '../src/persistence/locks.js';
const fixture = fileURLToPath(new URL('./fixtures/process.mjs', import.meta.url));
const options = {
  timeoutMs: 500,
  graceMs: 50,
  maxStdoutBytes: 2000,
  maxStderrBytes: 1000,
  maxInputBytes: 1000,
};
const spec = (mode: string) => ({
  executable: process.execPath,
  args: [fixture, mode],
  cwd: tmpdir(),
  stdin: '',
  env: childEnvironment(),
});
describe('Real OS process supervision on the current host', () => {
  it('keeps shell-looking text as stdin data and starts separate processes (T-02/23)', async () => {
    const input = '$(touch /tmp/not-executed); `false` 🦊';
    const a = await supervise({ ...spec('echo'), stdin: input }, options);
    const b = await supervise(spec('echo'), options);
    expect(JSON.parse(a.stdout).value).toBe(input);
    expect(a.pid).not.toBe(b.pid);
    expect(a.terminationConfirmed).toBe(true);
  });
  it.each(['tree', 'flood'])(
    'terminates actual group and grandchild on %s (T-14)',
    async (mode) => {
      const result = await supervise(spec(mode), options);
      expect(result.timedOut || result.outputLimited).toBe(true);
      expect(result.terminationConfirmed).toBe(true);
      expect(await groupAlive(result.pid!)).toBe(false);
      expect(result.stdout.length).toBeLessThanOrEqual(options.maxStdoutBytes);
    },
  );
  it('cancellation terminates owned tree without killing the test process (T-15/18)', async () => {
    const abort = new AbortController();
    const before = await processIdentity(process.pid);
    const result = await supervise(spec('tree'), {
      ...options,
      timeoutMs: 5000,
      signal: abort.signal,
      onStart: async () => {
        setTimeout(() => abort.abort(), 100);
      },
    });
    expect(result.cancelled).toBe(true);
    expect(result.terminationConfirmed).toBe(true);
    expect(await processIdentity(process.pid)).toBe(before);
  });
  it('strips API/routing and injection environment, redacts known secrets (T-27)', () => {
    expect(
      childEnvironment({
        PATH: '/bin',
        HOME: '/safe',
        OPENAI_API_KEY: 'secret',
        ANTHROPIC_API_KEY: 'secret',
        NODE_OPTIONS: '--require bad',
        HTTPS_PROXY: 'secret',
        ANTHROPIC_BASE_URL: 'https://bad',
      }),
    ).toEqual({ PATH: '/bin', HOME: '/safe', NO_COLOR: '1', CI: '1' });
    expect(redact('api_key=secret authorization: Bearer abc sk-123456789xyz')).not.toContain(
      'secret',
    );
  });
});
describe('Incremental provider events (synthetic, not live)', () => {
  const decoder = (cap?: number) =>
    new JsonlDecoder((raw) => [providerEventSchema.parse(raw)], cap);
  it('handles every byte boundary including UTF-8 (T-22)', () => {
    const d = decoder();
    const input = Buffer.from('{"type":"result","value":"Café 🦊"}\n{"type":"success"}\n');
    for (const byte of input) d.push(Buffer.from([byte]));
    expect(extractStructured(d.finish())).toBe('Café 🦊');
  });
  it('rejects malformed, truncated, missing terminal success and overflow (T-21/22)', () => {
    const bad = decoder();
    bad.push(Buffer.from('{"type":'));
    expect(() => bad.finish()).toThrow('Malformed');
    expect(() => extractStructured([{ type: 'diagnostic', value: 'done' }])).toThrow('terminal');
    expect(() => decoder(4).push(Buffer.from('12345'))).toThrow('cap');
    expect(() =>
      extractStructured([{ type: 'error', code: 'AUTH_REQUIRED', message: 'Login' }]),
    ).toThrow('Login');
  });
});
describe('Ownership exclusion', () => {
  it('allows only one owner and refuses unknown/PID-reused lock takeover (T-04/18)', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'ai-team-lock-')), 'lock');
    const a = new OwnershipLock(dir);
    const b = new OwnershipLock(dir);
    await a.acquire();
    try {
      expect(await inspectLock(dir)).toBe('live');
      await expect(b.acquire()).rejects.toThrow('lock exists');
    } finally {
      await a.release();
    }
    await b.acquire();
    await b.release();
    const c = new OwnershipLock(dir);
    await c.acquire();
    try {
      await writeFile(
        join(dir, 'owner.json'),
        JSON.stringify({
          nonce: 'different',
          pid: process.pid,
          identity: 'reused',
          heartbeat: new Date().toISOString(),
        }),
      );
      expect(await inspectLock(dir)).toBe('unknown');
      await expect(b.acquire()).rejects.toThrow('lock exists');
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(await inspectLock(dir)).toBe('unknown');
      await expect(c.release()).rejects.toThrow('Ownership changed');
    }
  });
});
