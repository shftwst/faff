import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const out = path.dirname(fileURLToPath(import.meta.url));
const read = name => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
const capture = read('capture.json');
const root = process.argv[2] || capture.root;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const inventory = read('inventory.json');
let bytes = 0;
let tokens = 0;
let blocks = 0;
for (const f of inventory.files) {
  const b = fs.readFileSync(path.join(root, f.path));
  assert.equal(hash(b), f.sha256, f.path);
  assert.equal(b.length, f.bytes, f.path);
  assert.equal(Math.ceil(b.toString('utf8').length / 4), f.est_tokens, f.path);
  const lines = b.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) || [];
  let end = 0;
  for (const block of f.blocks) {
    assert.equal(block.start, end + 1, f.path);
    assert.equal(hash(lines.slice(block.start - 1, block.end).join('')), block.sha256, f.path);
    end = block.end;
  }
  assert.equal(end, lines.length, f.path);
  bytes += b.length;
  tokens += f.est_tokens;
  blocks += f.blocks.length;
}
assert.deepEqual({ files: inventory.files.length, bytes, est_tokens: tokens, blocks }, inventory.totals);
const sources = read('source-files.json');
for (const f of sources.files) assert.equal(hash(fs.readFileSync(path.join(root, f.path))), f.sha256, f.path);
assert.equal(hash(fs.readFileSync(path.join(out, 'source.tar.gz'))), capture.archive.sha256);
const history = read('historical-cost.json');
const calls = fs.readFileSync(path.join(out, 'historical-usage.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
const { census, benchmark, billCalls } = await import(pathToFileURL(path.join(root, 'eval/tokenomics.mjs')).href);
assert.deepEqual(census(calls), history.census);
assert.equal(new Set(calls.map(c => c.rid)).size, calls.length);
assert.ok(calls.every(c => c.rid && c.cw === c.cw1h + c.cw5m));
for (const s of history.scenarios) assert.deepEqual(benchmark(calls, { fixed: s.fixed, lean: s.lean }), s.bench);
const replay = read('replay/result.json');
const manifest = read('replay/manifest.json');
assert.equal(hash(fs.readFileSync(path.join(out, 'replay/decision-corpus.jsonl'))), manifest.corpus_sha256);
assert.equal(hash(fs.readFileSync(path.join(out, 'replay/state-authority-map.md'))), manifest.map.sha256);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), capture.commit);
assert.equal(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim(), '');
console.log(JSON.stringify({
  verified_at: new Date().toISOString(), commit: capture.commit, source_files_verified: sources.files.length,
  skill_files_verified: inventory.files.length, contiguous_blocks_verified: blocks, totals: inventory.totals,
  historical_unique_requests: calls.length, cache_write_buckets_reconcile: true, historical_cost_reproduced: billCalls(calls),
  replay_records: replay.record_count, replay_actual_runs: manifest.run_ids.length,
  graded_decisions: Object.values(replay.matrix).reduce((n, x) => n + x.denominator, 0),
  unobserved_kernels: Object.entries(replay.matrix).filter(([, x]) => x.denominator === 0).map(([k]) => k),
  source_unchanged: true,
}, null, 2));
