import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const [rootArg, outArg] = process.argv.slice(2);
if (!outArg) throw new Error('usage: node cli-timing.mjs SOURCE_ROOT OUTPUT_JSON');
const root = path.resolve(rootArg);
const out = path.resolve(outArg);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(FAFF_|CLAUDE_)/.test(k)));
delete env.NODE_OPTIONS;
delete env.NODE_V8_COVERAGE;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const cli = 'plugin/skills/faff/bin/faff';
const cases = [
  { name: 'configured-review-slot', args: [cli, 'config', 'get', 'slots.review'] },
  { name: 'regions-check', args: [cli, 'regions', 'check'] },
  { name: 'historical-replay-analysis', args: [cli, 'shadow-fidelity', 'run', '--corpus', 'verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl', '--manifest', 'verification/reports/FAFF-974-post-fix-fidelity/manifest.json', '--root', root, '--json'] },
];
const startedAt = new Date().toISOString();
const startLoad = os.loadavg();
const rows = cases.map(c => {
  const samples = [];
  for (let i = 0; i < 23; i++) {
    const start = performance.now();
    const p = spawnSync(process.execPath, c.args, { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000 });
    const elapsed = performance.now() - start;
    if (p.status !== 0 || p.error) throw new Error(`${c.name}: ${p.error || p.stderr || p.status}`);
    if (i >= 3) samples.push({ milliseconds: elapsed, stdout_sha256: hash(p.stdout), stderr_sha256: hash(p.stderr), exit_code: p.status });
  }
  const durations = samples.map(s => s.milliseconds).sort((a, b) => a - b);
  return { name: c.name, command: [process.execPath, ...c.args], warmups: 3, repetitions: 20, median_ms: (durations[9] + durations[10]) / 2, p95_ms: durations[18], min_ms: durations[0], max_ms: durations.at(-1), stable_stdout: new Set(samples.map(s => s.stdout_sha256)).size === 1, stable_stderr: new Set(samples.map(s => s.stderr_sha256)).size === 1, samples };
});
if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== commit) throw new Error('Commit changed');
fs.writeFileSync(out, JSON.stringify({
  commit, root, started_at: startedAt, finished_at: new Date().toISOString(), node: process.version,
  host: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logical_cpus: os.cpus().length, load_start: startLoad, load_end: os.loadavg() },
  scope: 'Read-only CLI subprocess timings, including Node startup; warm filesystem caches. Recorded after the unit suite finished. No model latency or migration treatment measured. Host load is uncontrolled; repeat on the same host before making speed claims.',
  environment: 'FAFF_* and CLAUDE_* removed, NODE_OPTIONS and NODE_V8_COVERAGE unset. Repository slot config is the separately recorded local configuration.',
  cases: rows,
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(rows.map(({ name, median_ms, p95_ms, stable_stdout }) => ({ name, median_ms, p95_ms, stable_stdout }))));
