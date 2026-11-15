import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { estimateTokens } from './cli-driver.mjs';
import { parseTranscript, census, benchmark, RATES, CACHE_MULT } from './tokenomics.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const digest = text => createHash('sha256').update(text).digest('hex');

export function inventoryFile(path, text) {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const blocks = [];
  const headings = [];
  let start = 0;
  let fence = null;
  let frontmatter = lines[0]?.trim() === '---';
  let trail = [];
  function flush(end, kind = 'block') {
    if (end <= start) return;
    const body = lines.slice(start, end).join('');
    blocks.push({ start: start + 1, end, kind, headings: trail.map(h => h.title), bytes: Buffer.byteLength(body), sha256: digest(body), excerpt: body.trim().replace(/\s+/g, ' ').slice(0, 160) });
    start = end;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (frontmatter) {
      if (i > 0 && line.trim() === '---') { flush(i + 1, 'frontmatter'); frontmatter = false; }
      continue;
    }
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { flush(i + 1, 'code'); fence = null; }
      continue;
    }
    if (f) { flush(i); fence = f[1]; continue; }
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      flush(i);
      while (trail.length && trail.at(-1).level >= h[1].length) trail.pop();
      const heading = { line: i + 1, level: h[1].length, title: h[2], parent: trail.at(-1)?.line ?? null };
      trail.push(heading); headings.push(heading); flush(i + 1, 'heading');
    } else if (!line.trim()) { flush(i); flush(i + 1, 'space'); }
    else if (/^\s*(?:[-*] |\d+\. |\|)/.test(line)) { flush(i); }
  }
  flush(lines.length, fence ? 'unclosed-code' : 'block');
  const mentions = [...new Set(text.match(/\bfaff(?:ter-(?:noon|dark)|idavit)?(?:-[a-z]+)+\b/g) || [])].sort();
  return { path, sha256: digest(text), bytes: Buffer.byteLength(text), chars: text.length, lines: lines.length, est_tokens: estimateTokens(text), mentions, headings, blocks };
}

export function inventory(root = ROOT) {
  const base = join(root, 'plugin/skills');
  const paths = [];
  for (const name of readdirSync(base).sort()) {
    const skill = join(base, name, 'SKILL.md');
    if (!existsSync(skill)) continue;
    paths.push(skill);
    const refs = join(base, name, 'references');
    if (existsSync(refs)) for (const file of readdirSync(refs).sort()) if (file.endsWith('.md')) paths.push(join(refs, file));
  }
  const files = paths.map(path => inventoryFile(relative(root, path), readFileSync(path, 'utf8')));
  const names = new Set(files.filter(f => f.path.endsWith('/SKILL.md')).map(f => f.path.split('/')[2]));
  const edges = files.flatMap(f => f.mentions.filter(n => names.has(n) && !f.path.includes(`/${n}/`)).map(n => ({ from: f.path, to: `plugin/skills/${n}/SKILL.md`, kind: 'textual-mention-not-a-load-edge' })));
  const duplicateGroups = new Map();
  for (const file of files) for (const block of file.blocks) {
    if (block.kind !== 'block' || block.bytes < 100) continue;
    const entries = duplicateGroups.get(block.sha256) || [];
    entries.push({ path: file.path, start: block.start, end: block.end, bytes: block.bytes });
    duplicateGroups.set(block.sha256, entries);
  }
  return { schema: 1, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), estimator: 'estimateTokens: ceil(JS string length / 4); not provider tokenisation', semantic_status: 'Structural coverage only. Semantic review is in the companion audit tables. Textual mentions are not invocation or load proof.', totals: { files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), est_tokens: files.reduce((a, f) => a + f.est_tokens, 0), blocks: files.reduce((a, f) => a + f.blocks.length, 0) }, files, edges, exact_duplicate_candidates: [...duplicateGroups.values()].filter(g => new Set(g.map(x => x.path)).size > 1) };
}

export function entryLoads(root = ROOT) {
  const rows = [];
  for (const name of readdirSync(join(root, 'plugin/skills')).sort()) {
    const path = join(root, 'plugin/skills', name, 'SKILL.md');
    if (!existsSync(path)) continue;
    const body = readFileSync(path, 'utf8');
    const load = body.split('\n').find(l => l.startsWith('**Load the kernel first'));
    if (!load) continue;
    // The negative tail explicitly excludes autonomous.md for map and wtf.
    const positive = load.split(/(?:[\u2014;]\s*)?(?:map|wtf) is interactive-only/)[0];
    const refs = [...new Set(positive.match(/faff\/references\/[a-z0-9-]+\.md/g) || [])];
    const references = refs.map(ref => ({ path: `plugin/skills/${ref}`, est_tokens: estimateTokens(readFileSync(join(root, 'plugin/skills', ref), 'utf8')) }));
    rows.push({ skill: name, source_line: body.split('\n').indexOf(load) + 1, own_est_tokens: estimateTokens(body), references, shared_est_tokens: references.reduce((a, r) => a + r.est_tokens, 0), total_est_tokens: estimateTokens(body) + references.reduce((a, r) => a + r.est_tokens, 0) });
  }
  return { interpretation: 'Cold entry with declared references, loaded once each. Excludes catalog, system/developer prompts, delegated skills, dynamic outputs and history. Same-context nesting unions files rather than adding every entry total.', rows };
}

export function historical(root = ROOT) {
  const base = join(root, 'evidence/cost-run-20260829-100405/transcripts');
  const files = [];
  const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.jsonl')) files.push(p); } };
  walk(base);
  const calls = [];
  let rawUsageRows = 0;
  const sources = files.sort().map(path => {
    const bytes = readFileSync(path, 'utf8');
    const parsed = parseTranscript(bytes);
    for (const line of bytes.split('\n')) { try { if (JSON.parse(line)?.message?.usage) rawUsageRows++; } catch {} }
    calls.push(...parsed);
    return { path: relative(root, path), sha256: digest(bytes), calls: parsed.length };
  });
  if (!calls.length) throw new Error('Historical evidence has zero parsed calls');
  const unknownModels = [...new Set(calls.map(c => c.model).filter(m => !RATES[m]))];
  if (unknownModels.length) throw new Error(`Unpriced models: ${unknownModels.join(', ')}`);
  const times = calls.map(c => c.ts).filter(Number.isFinite);
  return { evidence: sources, pricing: { status: 'Historical repository model, not current prices or invoice reconciliation', rates: RATES, cache_multipliers: CACHE_MULT }, raw_usage_rows: rawUsageRows, deduplication: 'Max usage per request ID within each transcript, reusing tokenomics.mjs. Cross-file copies are not deduplicated.', census: census(calls), observed_timestamp_span_seconds: (Math.max(...times) - Math.min(...times)) / 1000, timing_limit: 'Timestamp span includes idle gaps and parallel agents. It is not summed inference time or a before/after latency measurement.', scenarios: [8300, 30000, 15000].map(lean => ({ fixed: 66153, lean, kind: 'counterfactual fixed-workload, not measured treatment', bench: benchmark(calls, { fixed: 66153, lean }) })) };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--out') throw new Error('usage: node eval/skill-audit.mjs --out <directory>');
  const out = resolve(argv[1]);
  mkdirSync(out, { recursive: true });
  for (const [name, value] of [['inventory', inventory()], ['entry-loads', entryLoads()], ['historical-cost', historical()]]) writeFileSync(join(out, `${name}.json`), JSON.stringify(value, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
