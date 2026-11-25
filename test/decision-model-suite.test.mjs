import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../verification/decision-models/', import.meta.url));

test('decision-model runner and provider contracts work offline', () => {
  execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'test'], { cwd, stdio: 'pipe' });
});

test('checked-in decision controls match their executable outcomes', () => {
  execFileSync('python3', ['-B', 'build_controls.py'], { cwd, stdio: 'pipe' });
});
