import { cpSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'faff-planner-mutants-'));
const relative = 'plugin/skills/faff/bin/lib/review-comment.js';
const target = join(dir, relative);
const source = readFileSync(join(root, relative), 'utf8');
const results = [];
try {
  cpSync(join(root, 'plugin'), join(dir, 'plugin'), { recursive: true, filter: p => !p.includes('/node_modules') });
  mkdirSync(join(dir, 'test'));
  cpSync(join(root, 'test/review-comment.test.mjs'), join(dir, 'test/review-comment.test.mjs'));
  mkdirSync(join(dir, 'eval/control-parity/fixtures'), { recursive: true });
  for (const file of ['fixtures/review-comments.json', 'expected-outcomes.json']) {
    cpSync(join(root, 'eval/control-parity', file), join(dir, 'eval/control-parity', file));
  }
  const mutants = [
    ['adopt-indented-marker', 'line.trimEnd()', 'line.trim()', 'independent oracle: indented-and-trailing-whitespace'],
    ['ignore-complete-pair-preference', 'const pool = complete.length ? complete : matches;', 'const pool = matches;', 'complete pairs outrank'],
    ['ignore-timestamp-order', 'compareTimes(a.comment.time, b.comment.time) || a.index - b.index', 'a.index - b.index', 'orders actual timestamp'],
    ['lose-human-prefix', 'chosen.comment.body.slice(0, chosen.start) + region', 'region', 'preserves Unicode'],
    ['lose-human-suffix', 'chosen.comment.body.slice(chosen.close?.end ?? chosen.comment.body.length)', "''", 'preserves Unicode'],
    ['accept-open-replacement-fence', 'if (replacement.unclosedFence)', 'if (false)', 'refuses unclosed replacement fence'],
    ['recover-ambiguous-region', 'if (!chosen.close &&', 'if (false &&', 'refuses existing unclosed fence hiding a close'],
  ];
  for (const [name, from, to, pattern] of mutants) {
    if (!source.includes(from)) throw Error(`mutation not applied: ${name}`);
    writeFileSync(target, source.replace(from, to));
    const result = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}`, join(dir, 'test/review-comment.test.mjs')], { encoding: 'utf8', timeout: 30_000 });
    const failures = Number(/# fail (\d+)/.exec(result.stdout)?.[1] ?? 0);
    if (result.status !== 1 || failures === 0 || !result.stdout.includes("code: 'ERR_ASSERTION'")) {
      throw Error(`mutation was not caught by an assertion: ${name}\n${result.stdout}\n${result.stderr}`);
    }
    results.push({ name, pattern, exit: result.status, failures });
  }
  process.stdout.write(JSON.stringify({ source: relative, source_sha256: createHash('sha256').update(source).digest('hex'), mutants: results }, null, 2) + '\n');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
