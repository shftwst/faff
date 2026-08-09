// FAFF-411 spike scratch — Phase-1 retrospective predictor harness.
//
// Walks historical `.faff/runs/*/`, joins each BUILT issue's committed spec
// (records/specs) + run-ledger outcome + review artifacts + git diff actuals +
// `faff economics` cost, extracts per-issue feature rows (prep-time spec features
// vs post-hoc actuals), and emits a ranked signal->outcome table as JSON plus a
// human-readable summary.
//
// Read-only over the corpus. Handles patchy/missing artifacts gracefully:
// a row is emitted whenever we can join AT LEAST a spec-or-actual to an outcome;
// coverage is reported (row count may be < ticket count).
//
// Usage:
//   node analyze.mjs [--repo DIR] [--runs-dir DIR] [--specs-dir DIR]
//                    [--json] [--out FILE] [--no-econ]
// Defaults point at the MAIN checkout (runs + .faffrc live there, gitignored).
//
// NOT wired into bin/faff.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
}
const REPO = opt('--repo', '/Users/shftwst/workspace/shftwst/faff');
const RUNS_DIR = opt('--runs-dir', path.join(REPO, '.faff/runs'));
const SPECS_DIR = opt('--specs-dir', path.join(REPO, 'records/specs'));
const WANT_JSON = flag('--json');
const OUT_FILE = opt('--out', null);
const NO_ECON = flag('--no-econ');
const FAFF_BIN = path.join(REPO, 'plugin/skills/faff/bin/faff');

// Outcomes that mean the issue was actually BUILT (vs merely listed / routed away).
const BUILT_OUTCOMES = new Set([
  'shipped', 'pr-open', 'parked', 'needs-human', 'errored', 'iterate', 'merged',
]);
const SHIPPED = new Set(['shipped', 'merged']);

// ---- helpers --------------------------------------------------------------
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function git(args) {
  try {
    return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch { return ''; }
}
const CONF_NUM = { high: 3, medium: 2, low: 1 };

// tolerant confidence read (spec §3 read-safety: default unparseable -> null, NOT high;
// analysis-side guard so a defaults-to-high artifact never silently inflates the signal).
function extractConfidence(text) {
  if (!text) return null;
  const m = text.match(/confidence:\s*\**\s*(high|medium|low)\b/i);
  return m ? m[1].toLowerCase() : null;
}
function specProducer(text) {
  if (!text) return 'unknown';
  if (/nlspec/i.test(text)) return 'nlspec';
  if (/noon-spec/i.test(text)) return 'noon-spec';
  return 'unknown';
}
function countMatches(text, re) {
  if (!text) return 0;
  const m = text.match(re);
  return m ? m.length : 0;
}

// ---- 1. collect BUILT issues from run ledgers -----------------------------
function collectIssues() {
  const byIssue = new Map(); // issue -> { issue, outcome, runDir, runId }
  const runDirs = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort(); // lexical; later dirs overwrite earlier so we keep the most recent build
  const runMeta = new Map(); // runDir -> { admittedCount, tokens }
  for (const rd of runDirs) {
    const dir = path.join(RUNS_DIR, rd);
    const ledger = readJSON(path.join(dir, 'run-ledger.json'));
    if (!ledger || !ledger.outcomes) continue;
    const admitted = Array.isArray(ledger.admitted) ? ledger.admitted : [];
    runMeta.set(rd, { admittedCount: admitted.length || Object.keys(ledger.outcomes).length, tokens: null, dir });
    for (const [issue, outcome] of Object.entries(ledger.outcomes)) {
      if (!BUILT_OUTCOMES.has(outcome)) continue; // skip routed-out / unreached-budget etc.
      byIssue.set(issue, { issue, outcome, runDir: rd, runId: ledger.run_id || rd });
    }
  }
  return { byIssue, runMeta };
}

// ---- 2. per-run token cost via faff economics -----------------------------
function loadEconTokens(runMeta) {
  if (NO_ECON) return;
  for (const [rd, meta] of runMeta) {
    try {
      const out = execFileSync('node', [FAFF_BIN, 'economics', '--run-dir', meta.dir, '--json'],
        { cwd: REPO, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      const j = JSON.parse(out);
      meta.tokens = typeof j.tokens_total === 'number' ? j.tokens_total : null;
      meta.attemptCount = j.attempt_count ?? null;
    } catch { meta.tokens = null; }
  }
}

// ---- 3. spec index --------------------------------------------------------
function specPathFor(issue) {
  const n = issue.replace(/^FAFF-/i, '');
  let files = [];
  try { files = fs.readdirSync(SPECS_DIR); } catch { return null; }
  // match ...-FAFF-<n>-... (case-insensitive), exact number boundary
  const re = new RegExp(`-FAFF-${n}-`, 'i');
  const hits = files.filter((f) => re.test(f) && f.endsWith('.md'));
  if (!hits.length) return null;
  return path.join(SPECS_DIR, hits.sort().at(-1));
}

// ---- 4. git actuals: squash-merge diff for the issue ----------------------
function gitActuals(issue) {
  const n = issue.replace(/^FAFF-/i, '');
  // squash-merge subjects look like: feat(FAFF-409): ... (#292)
  const sha = git(['log', '--all', '--format=%H %s', '--grep', `FAFF-${n})`])
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(' ')[0])[0];
  if (!sha) return null;
  const stat = git(['show', '--shortstat', '--format=', sha]);
  const filesM = stat.match(/(\d+) files? changed/);
  const insM = stat.match(/(\d+) insertions?/);
  const delM = stat.match(/(\d+) deletions?/);
  const files_changed = filesM ? +filesM[1] : 0;
  const insertions = insM ? +insM[1] : 0;
  const deletions = delM ? +delM[1] : 0;
  const subject = git(['show', '-s', '--format=%s', sha]);
  const prM = subject.match(/\(#(\d+)\)/);
  return {
    sha: sha.slice(0, 12),
    pr: prM ? +prM[1] : null,
    files_changed,
    insertions,
    deletions,
    lines_changed: insertions + deletions,
  };
}

// ---- 5. review / rework actuals from run-dir ------------------------------
function reviewActuals(runDir, issue) {
  const base = path.join(RUNS_DIR, runDir, issue);
  const verdict = readJSON(path.join(base, 'review-verdict.json'));
  const progress = readJSON(path.join(base, 'review-progress.json'));
  const ac = readJSON(path.join(base, 'ac-checklist.json'));
  let findings_total = 0, findings_major = 0, findings_blocker = 0;
  if (verdict && Array.isArray(verdict.findings)) {
    findings_total = verdict.findings.length;
    for (const f of verdict.findings) {
      if (/blocker/i.test(f.severity || '')) findings_blocker++;
      if (/major/i.test(f.severity || '')) findings_major++;
    }
  }
  return {
    review_signal: verdict ? verdict.signal ?? null : null,
    findings_total,
    findings_major,
    findings_blocker,
    phase2_attempts: progress && progress.phase2 ? (progress.phase2.attempts ?? null) : null,
    ac_all_verified: ac ? ac.all_verified ?? null : null,
    has_review_artifact: !!verdict,
  };
}

// ---- correlation ----------------------------------------------------------
function pearson(pairs) {
  const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1]);
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ---- main -----------------------------------------------------------------
function main() {
  const { byIssue, runMeta } = collectIssues();
  loadEconTokens(runMeta);

  const rows = [];
  const coverage = { built_issues: byIssue.size, with_spec: 0, with_confidence: 0, with_git: 0, with_review: 0, with_tokens: 0, shipped: 0, non_shipped: 0 };

  for (const rec of byIssue.values()) {
    const specP = specPathFor(rec.issue);
    const specText = specP ? readText(specP) : null;
    const confidence = extractConfidence(specText);
    const git_ = gitActuals(rec.issue);
    const rev = reviewActuals(rec.runDir, rec.issue);
    const meta = runMeta.get(rec.runDir);
    const token_proxy = meta && meta.tokens && meta.admittedCount
      ? Math.round(meta.tokens / meta.admittedCount) : null;

    if (specText) coverage.with_spec++;
    if (confidence) coverage.with_confidence++;
    if (git_) coverage.with_git++;
    if (rev.has_review_artifact) coverage.with_review++;
    if (token_proxy) coverage.with_tokens++;
    if (SHIPPED.has(rec.outcome)) coverage.shipped++; else coverage.non_shipped++;

    rows.push({
      issue: rec.issue,
      outcome: rec.outcome,
      run_id: rec.runId,
      // ---- prep-time spec features ----
      confidence,
      confidence_num: confidence ? CONF_NUM[confidence] : null,
      spec_producer: specProducer(specText),
      spec_lines: specText ? specText.split('\n').length : null,
      scenario_count: countMatches(specText, /^\s*[-*]?\s*(Given|GIVEN)\b/gm),
      done_items: countMatches(specText, /^\s*-\s*\[[ x]\]/gm),
      // ---- post-hoc actuals ----
      files_changed: git_ ? git_.files_changed : null,
      lines_changed: git_ ? git_.lines_changed : null,
      insertions: git_ ? git_.insertions : null,
      deletions: git_ ? git_.deletions : null,
      pr: git_ ? git_.pr : null,
      review_signal: rev.review_signal,
      findings_total: rev.has_review_artifact ? rev.findings_total : null,
      findings_major: rev.has_review_artifact ? rev.findings_major : null,
      findings_blocker: rev.has_review_artifact ? rev.findings_blocker : null,
      phase2_attempts: rev.phase2_attempts,
      ac_all_verified: rev.ac_all_verified,
      token_proxy,
    });
  }

  // ---- ranked signal -> outcome table ------------------------------------
  const signals = [
    ['confidence_num', 'spec self-rated confidence (high=3/med=2/low=1)'],
    ['spec_lines', 'committed spec length (lines)'],
    ['scenario_count', 'Given/scenario count in spec'],
    ['done_items', 'DONE checklist item count in spec'],
  ];
  const outcomes = [
    ['lines_changed', 'actual lines changed (ins+del)'],
    ['files_changed', 'actual files changed'],
    ['findings_total', 'review findings raised'],
    ['findings_major', 'major+ review findings'],
    ['token_proxy', 'per-issue token proxy (run tokens / admitted)'],
  ];
  const table = [];
  for (const [sk, sl] of signals) {
    for (const [ok, ol] of outcomes) {
      const pairs = rows
        .filter((r) => typeof r[sk] === 'number' && typeof r[ok] === 'number')
        .map((r) => [r[sk], r[ok]]);
      const r = pearson(pairs);
      table.push({ signal: sk, signal_label: sl, outcome: ok, outcome_label: ol, n: pairs.length, r: r === null ? null : Math.round(r * 1000) / 1000 });
    }
  }
  table.sort((a, b) => (Math.abs(b.r ?? 0)) - (Math.abs(a.r ?? 0)));

  // ---- confidence distribution (guard the defaults-to-high read) ----------
  const confDist = {};
  for (const r of rows) { const k = r.confidence || 'MISSING'; confDist[k] = (confDist[k] || 0) + 1; }

  // ---- estimability gap: spec-time proxies vs actual diff -----------------
  const estim = {};
  for (const [sk] of [['spec_lines'], ['scenario_count'], ['done_items']]) {
    const pairs = rows.filter((r) => typeof r[sk] === 'number' && typeof r.lines_changed === 'number').map((r) => [r[sk], r.lines_changed]);
    estim[sk] = { n: pairs.length, r_vs_lines_changed: pairs.length >= 3 ? Math.round((pearson(pairs) ?? 0) * 1000) / 1000 : null };
  }

  const report = {
    generated_at: new Date().toISOString(),
    repo: REPO,
    coverage,
    confidence_distribution: confDist,
    ranked_signal_outcome_table: table,
    estimability_gap: estim,
    rows,
  };

  if (WANT_JSON) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    printSummary(report);
  }
  if (OUT_FILE) {
    fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n');
    process.stderr.write(`\n[wrote ${OUT_FILE}]\n`);
  }
}

function printSummary(rep) {
  const c = rep.coverage;
  const L = [];
  L.push('# FAFF-411 Phase-1 retrospective — signal→outcome analysis');
  L.push('');
  L.push('## Corpus coverage');
  L.push(`- built issues (from run ledgers, real build outcomes): ${c.built_issues}`);
  L.push(`- with committed spec: ${c.with_spec}   with parseable confidence: ${c.with_confidence}`);
  L.push(`- with git diff actuals: ${c.with_git}   with review artifact: ${c.with_review}   with token proxy: ${c.with_tokens}`);
  L.push(`- shipped: ${c.shipped}   non-shipped (pr-open/park/etc): ${c.non_shipped}`);
  L.push('');
  L.push('## Confidence distribution (guard the defaults-to-high read)');
  for (const [k, v] of Object.entries(rep.confidence_distribution).sort()) L.push(`- ${k}: ${v}`);
  L.push('');
  L.push('## Ranked signal → outcome (|Pearson r|, desc). r sign: + = signal up, outcome up.');
  L.push('| signal | outcome | n | r |');
  L.push('|---|---|---|---|');
  for (const t of rep.ranked_signal_outcome_table) {
    L.push(`| ${t.signal} | ${t.outcome} | ${t.n} | ${t.r === null ? 'n/a' : t.r} |`);
  }
  L.push('');
  L.push('## Estimability gap (spec-time proxy vs actual lines_changed)');
  for (const [k, v] of Object.entries(rep.estimability_gap)) {
    L.push(`- ${k}: n=${v.n}, r=${v.r_vs_lines_changed ?? 'n/a'}`);
  }
  process.stdout.write(L.join('\n') + '\n');
}

main();
