import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveMailbox } from '../eval/control-parity/interactive-handoff.mjs';

test('literal JSON stdin reaches the mailbox without changing shell characters or line endings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-mailbox-stdin-'));
  const args = { text: '```json\r\n{"a":"$HOME", "b":"$(printf changed)", "c":"don\'t"}\n```' };
  const service = serveMailbox(directory, async (name, received) => {
    assert.equal(name, 'finish');
    assert.deepEqual(received, args);
    return { finished: true, received };
  }, { timeoutMs: 2000, pollMs: 5 });
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../eval/control-parity/mailbox-call.mjs', import.meta.url)), 'call', directory, 'finish', '-'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const completed = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
    child.stdin.end(JSON.stringify(args) + '\n');
    assert.equal(await completed, 0, stderr);
    assert.deepEqual(JSON.parse(stdout).received, args);
    assert.equal((await service).rejected, 0);
  } finally { await service; rmSync(directory, { recursive: true, force: true }); }
});
