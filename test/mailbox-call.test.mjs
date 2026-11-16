import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveMailbox } from '../eval/control-parity/interactive-handoff.mjs';

for (const transport of ['stdin', 'file']) test(`literal JSON ${transport} preserves shell characters, quoted commands and line endings`, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-mailbox-stdin-'));
  const args = { quoted_command: 'gh pr merge', text: '```json\r\n{"a":"$HOME", "b":"$(printf changed)", "c":"don\'t"}\n```' };
  const service = serveMailbox(directory, async (name, received) => {
    assert.equal(name, 'finish');
    assert.deepEqual(received, args);
    return { finished: true, received };
  }, { timeoutMs: 2000, pollMs: 5 });
  try {
    if (transport === 'file') writeFileSync(join(directory, 'bridge-arguments.json'), JSON.stringify(args) + '\n');
    const script = transport === 'file' ? 'mailbox-file-call.mjs' : 'mailbox-call.mjs';
    const childArgs = [fileURLToPath(new URL(`../eval/control-parity/${script}`, import.meta.url)), 'call', directory, 'finish', ...(transport === 'stdin' ? ['-'] : [])];
    assert.ok(childArgs.every(arg => !arg.includes(args.quoted_command)));
    const child = spawn(process.execPath, childArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    child.stdin.end(transport === 'stdin' ? JSON.stringify(args) + '\n' : undefined);
    assert.equal(await completed, 0, stderr);
    assert.deepEqual(JSON.parse(stdout).received, args);
    assert.equal((await service).rejected, 0);
  } finally { await service; rmSync(directory, { recursive: true, force: true }); }
});
