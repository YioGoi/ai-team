// Synthetic protocol fixture. Never invokes a real provider or network service.
import process from 'node:process';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const MOCK_WORKER = process.env.AI_TEAM_TEST_MOCK_WORKER;
const codex = basename(process.argv[1]).startsWith('codex');
const args = process.argv.slice(2);
const flags = codex
  ? '--json --output-schema --output-last-message --sandbox workspace-write read-only --ephemeral --ignore-user-config --config --cd --color --disable --model'
  : '--print --output-format --json-schema --tools --allowedTools --disallowedTools --permission-mode --permission-prompts --safe-mode --restricted --strict-mcp-config --mcp-config --no-session-persistence --session-id --max-turns --verbose --model auth';
if (args.includes('--version')) {
  process.stdout.write(codex ? 'codex-cli 0.135.0\n' : '2.1.268 (Claude Code)\n');
} else if (args.includes('--help')) {
  process.stdout.write(flags);
} else if (args[0] === 'features') {
  process.stdout.write(
    [
      'multi_agent',
      'multi_agent_v2',
      'goals',
      'hooks',
      'plugins',
      'apps',
      'browser_use',
      'computer_use',
      'image_generation',
      'shell_snapshot',
      'workspace_dependencies',
    ]
      .map((x) => x + ' stable true')
      .join('\n'),
  );
} else if (args[0] === 'login') {
  process.stdout.write('Logged in using ChatGPT\n');
} else if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }));
} else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (
    codex &&
    !readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8').includes('schemaVersion')
  )
    throw new Error('Controller schema missing');
  if (args.some((x) => /dangerously|--bare|--resume|--continue|--last/u.test(x)))
    throw new Error('Unsafe invocation');
  // Exercise the existing real fixture editor, translating only the synthetic provider envelope.
  const lines = execFileSync(process.execPath, [MOCK_WORKER], {
    input,
    encoding: 'utf8',
    cwd: request.workspacePath,
  })
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const result = lines.find((x) => x.type === 'result').value;
  const session = 'synthetic-' + randomUUID();
  if (codex) {
    process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: session }) + '\n');
    process.stdout.write(
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: JSON.stringify(result) },
      }) + '\n',
    );
    process.stdout.write(
      '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n',
    );
  } else {
    process.stdout.write(
      JSON.stringify({ type: 'system', subtype: 'init', session_id: session, model: 'synthetic' }) +
        '\n',
    );
    process.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        session_id: session,
        structured_output: result,
      }) + '\n',
    );
  }
}
