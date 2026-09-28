import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { git } from '../src/workspace/git.js';
/** Fixed external harness; not copied into the agent-editable target/worktree. */
export async function assertOracle(worktree: string, baseSha: string): Promise<void> {
  const module = (await import(
    pathToFileURL(join(worktree, 'build/src/normalizeTitle.js')).href
  )) as { normalizeTitle: (input: unknown) => string };
  for (const [input, expected] of [
    ['  Hello   Team  ', 'Hello Team'],
    ['\tHello\n\nTeam\r\n', 'Hello Team'],
    ['\u00a0Hello\u00a0\u00a0Team\u00a0', 'Hello Team'],
    ['MiXeD Case', 'MiXeD Case'],
    ['', ''],
    [' \t\n ', ''],
  ])
    assert.equal(module.normalizeTitle(input), expected);
  for (const input of [null, undefined, 42, [], {}])
    assert.throws(() => module.normalizeTitle(input), TypeError);
  assert.notEqual(
    (await git(worktree, ['diff', '--stat', baseSha, 'HEAD'])).trim(),
    '',
    'Real cumulative diff is mandatory',
  );
}
