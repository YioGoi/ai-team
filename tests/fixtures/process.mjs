import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setInterval } from 'node:timers';
import { spawn } from 'node:child_process';
const mode = process.argv[2];
if (mode === 'tree' || mode === 'flood') {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  process.stdout.write(JSON.stringify({ child: child.pid }) + '\n');
  if (mode === 'flood') setInterval(() => process.stdout.write('x'.repeat(10000)), 5);
  setInterval(() => {}, 1000);
} else if (mode === 'echo') {
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  process.stdout.write(JSON.stringify({ value, pid: process.pid }));
} else if (mode === 'auth') {
  process.stdout.write('{"type":"error","code":"AUTH_REQUIRED","message":"Login required"}\n');
} else if (mode === 'utf8') {
  const value = Buffer.from('{"type":"result","value":"Café 🦊"}\n');
  for (const byte of value) process.stdout.write(Buffer.from([byte]));
} else {
  process.stderr.write('unknown mode');
  process.exitCode = 1;
}
