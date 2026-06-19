// FAFF-170 — pre/post-lean tokenomics: the prompt-SIZE census + the report that pairs the size delta
// with FAFF-169's judgement-QUALITY delta. The size half is free + deterministic (no model call); the
// paired report's quality half reuses FAFF-169's committed baseline (eval/baselines/frontier.json) vs a
// supplied post-lean eval run, degrading to size-only when no quality run is given.
//
// Zero-dependency: node builtins + estimateTokens (the chars/4 proxy — a tokenizer LIBRARY would break
// the repo's zero-dep convention; the DELTA ratio is what matters, and the constant proxy error cancels).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "./cli-driver.mjs"; // FAFF-170: reuse, do not redefine (chars/4)

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
export const SKILLS_DIR = join(REPO_ROOT, "plugin", "skills");

// Enumerate the SKILL.md files — the prose that loads into context. (FAFF-114 owns the canonical
// enumeration; this is the documented glob fallback: plugin/skills/*/SKILL.md.)
export function skillFiles(skillsDir = SKILLS_DIR) {
  return readdirSync(skillsDir)
    .map((name) => join(skillsDir, name, "SKILL.md"))
    .filter((p) => existsSync(p))
    .sort();
}

// One file's size. est_tokens reuses estimateTokens (chars/4) — labelled "est" everywhere downstream.
export function fileSize(path, read = readFileSync) {
  const text = read(path, "utf8");
  return { path: relPath(path), lines: text.split("\n").length, chars: text.length, est_tokens: estimateTokens(text) };
}
const relPath = (p) => p.startsWith(REPO_ROOT + "/") ? p.slice(REPO_ROOT.length + 1) : p;

// The size census: per-file sizes + totals. Deterministic (same tree → same numbers), no model call.
export function sizeCensus(files = skillFiles()) {
  const per_file = files.map((p) => (typeof p === "string" ? fileSize(p) : p));
  const totals = per_file.reduce(
    (t, f) => ({ files: t.files + 1, lines: t.lines + f.lines, chars: t.chars + f.chars, est_tokens: t.est_tokens + f.est_tokens }),
    { files: 0, lines: 0, chars: 0, est_tokens: 0 },
  );
  return { per_file, totals };
}

// PURE — no I/O. Diff a current census against a committed size baseline. Returns per-file + total
// deltas (absolute + percent). A negative delta is a REDUCTION (what leaning wants); pct is the
// trustworthy figure (the constant chars/4 proxy error cancels in a ratio). Added/removed files are listed.
export function diffSizes(current, baseline) {
  const cur = current.totals, base = baseline.totals;
  const pct = (a, b) => (b === 0 ? null : round(((a - b) / b) * 100));
  const delta = {
    lines: cur.lines - base.lines, chars: cur.chars - base.chars, est_tokens: cur.est_tokens - base.est_tokens,
    pct: { lines: pct(cur.lines, base.lines), chars: pct(cur.chars, base.chars), est_tokens: pct(cur.est_tokens, base.est_tokens) },
  };
  const byPath = (arr) => Object.fromEntries(arr.map((f) => [f.path, f]));
  const c = byPath(current.per_file), b = byPath(baseline.per_file);
  const per_file_deltas = [];
  for (const p of new Set([...Object.keys(b), ...Object.keys(c)])) {
    if (!b[p]) { per_file_deltas.push({ path: p, status: "added", est_tokens: c[p].est_tokens }); continue; }
    if (!c[p]) { per_file_deltas.push({ path: p, status: "removed", est_tokens: -b[p].est_tokens }); continue; }
    const d = c[p].est_tokens - b[p].est_tokens;
    if (d !== 0) per_file_deltas.push({ path: p, status: "changed", est_tokens: d, pct: pct(c[p].est_tokens, b[p].est_tokens) });
  }
  return { before: base, after: cur, delta, per_file_deltas };
}

// PURE — the QUALITY half. Pair FAFF-169's committed per_kind baseline (before) against a supplied
// post-lean eval run's per_kind (after). A drop is a regression for the report (the FAIL gating is
// FAFF-169's job — here we just surface the delta).
export function qualityDelta(frontierBaseline, qualityRun) {
  if (!frontierBaseline?.per_kind || !qualityRun?.per_kind) return { mode: "size-only", reason: "no FAFF-169 baseline or no --quality run supplied" };
  const before = frontierBaseline.per_kind, after = qualityRun.per_kind;
  const per_kind = [], regressions = [];
  for (const [kind, b] of Object.entries(before)) {
    const a = after[kind];
    if (!a) { per_kind.push({ kind, before: b, after: null, note: "missing from the quality run" }); regressions.push(kind); continue; }
    const d = { accuracy: round(a.accuracy - b.accuracy), stability: round(a.stability - b.stability) };
    per_kind.push({ kind, before: b, after: a, delta: d });
    if (d.accuracy < 0 || d.stability < 0) regressions.push(kind);
  }
  return { mode: "paired", per_kind, regressions };
}

// PURE — assemble the full report + a one-line headline.
export function buildReport(currentCensus, sizeBaseline, qualityRun = null, frontierBaseline = null) {
  const size = diffSizes(currentCensus, sizeBaseline);
  const quality = qualityRun ? qualityDelta(frontierBaseline, qualityRun) : { mode: "size-only", reason: "no --quality run supplied" };
  const cutPct = size.delta.pct.est_tokens == null ? null : -size.delta.pct.est_tokens; // positive = reduction
  const sizeStr = `${cutPct == null ? "?" : cutPct.toFixed(1)}% prompt tokens (${size.before.est_tokens} → ${size.after.est_tokens} est)`;
  const qualStr = quality.mode === "paired"
    ? `judgement Δ = ${quality.regressions.length ? "REGRESSED on " + quality.regressions.join(", ") : "0 across " + quality.per_kind.length + " kinds"}`
    : `(quality: ${quality.mode} — ${quality.reason})`;
  const verb = cutPct == null ? "size change" : cutPct >= 0 ? "cut" : "grew";
  return { size, quality, headline: `${verb} ${sizeStr}; ${qualStr}` };
}

// PURE — the budget GATE (FAFF-171). Turn the size diff into a pass/over verdict against a growth
// budget, and surface how far the floor could descend on a shrink (nudge-on-shrink — the down-click
// of the ratchet). delta_est <= budget → within (floor holds); > budget → over. under_by > 0 means
// the committed floor can drop. No I/O — main() owns reading the baseline + printing the summary.
export function evaluateGate(currentCensus, baseline, budget = 0) {
  const size = diffSizes(currentCensus, baseline);
  const delta_est = size.delta.est_tokens;
  return {
    before_est: size.before.est_tokens,
    after_est: size.after.est_tokens,
    delta_est,
    delta_pct: size.delta.pct.est_tokens,
    budget,
    over_by: Math.max(0, delta_est - budget),
    under_by: Math.max(0, -delta_est),
    status: delta_est <= budget ? "within" : "over",
    per_file_deltas: size.per_file_deltas,
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

// --- I/O helpers (CLI only; the pure functions above are what node --test covers) ---
function loadJson(path, label) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch (e) { throw new Error(`${label}: cannot read ${path}: ${e.message}`); }
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${label}: ${path} is not valid JSON: ${e.message}`); }
}
function argFlag(argv, name) { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; }

function printCensus(c) {
  console.log(`\n=== prompt-size census (${c.totals.files} SKILL.md files) ===`);
  for (const f of c.per_file) console.log(`  ${String(f.est_tokens).padStart(7)} est  ${String(f.lines).padStart(5)} ln  ${f.path}`);
  console.log(`  TOTAL: ${c.totals.est_tokens} est tokens · ${c.totals.lines} lines · ${c.totals.chars} chars (est = chars/4)`);
}
function printReport(r, against) {
  console.log(`\n=== tokenomics report vs ${against} ===`);
  console.log(`  HEADLINE: ${r.headline}`);
  console.log(`  size Δ: ${r.size.delta.est_tokens} est tokens (${fmtPct(r.size.delta.pct.est_tokens)}), ${r.size.delta.lines} lines`);
  for (const d of r.size.per_file_deltas.slice(0, 40)) console.log(`    ${d.status.padEnd(7)} ${d.path}  ${d.est_tokens >= 0 ? "+" : ""}${d.est_tokens} est`);
  if (r.quality.mode === "paired") {
    console.log(`  quality Δ (paired): ${r.quality.regressions.length ? "REGRESSIONS: " + r.quality.regressions.join(", ") : "no regressions"}`);
  } else {
    console.log(`  quality: ${r.quality.mode} — ${r.quality.reason}`);
  }
}
const fmtPct = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);

// The gate summary (FAFF-171). Markdown-ish so the CI step can append it to $GITHUB_STEP_SUMMARY
// and it renders on the PR's checks page — no PR-comment write permission needed.
function emitGateSummary(r) {
  console.log(`### prompt-size budget gate`);
  console.log(r.status === "within" ? `within budget ✓` : `OVER BUDGET ⚠ by ${r.over_by} est tokens`);
  console.log(`total: ${r.before_est} → ${r.after_est} est  (Δ ${r.delta_est >= 0 ? "+" : ""}${r.delta_est}, ${fmtPct(r.delta_pct)})`);
  if (r.under_by > 0) console.log(`floor can drop to ${r.after_est} — run --update-baseline to lock it in`);
  const growth = r.per_file_deltas.filter((d) => d.est_tokens > 0).sort((a, b) => b.est_tokens - a.est_tokens).slice(0, 10);
  if (growth.length) {
    console.log(`top growth:`);
    for (const d of growth) console.log(`  ${(d.status || "changed").padEnd(7)} ${d.path}  +${d.est_tokens} est`);
  }
}

function main(argv) {
  const census = sizeCensus();
  const updatePath = argFlag(argv, "--update-baseline");
  if (updatePath) {
    const out = { meta: { captured_at: new Date().toISOString().slice(0, 10) }, per_file: census.per_file, totals: census.totals };
    mkdirSync(dirname(updatePath), { recursive: true });
    writeFileSync(updatePath, JSON.stringify(out, null, 2) + "\n");
    printCensus(census);
    console.log(`\n=== size baseline written to ${updatePath} ===`);
    return 0;
  }
  if (argv.includes("--gate")) {
    const against = argFlag(argv, "--against");
    if (!against) throw new Error("--gate requires --against <size-baseline>");
    const baseline = loadJson(against, "--against");
    if (!baseline.totals || !baseline.per_file) throw new Error(`--against: ${against} is not a size baseline (no totals/per_file)`);
    const budgetRaw = argFlag(argv, "--budget");
    const budget = budgetRaw == null ? 0 : Number.parseInt(budgetRaw, 10);
    if (Number.isNaN(budget)) throw new Error(`--budget must be an integer, got "${budgetRaw}"`);
    const result = evaluateGate(census, baseline, budget);
    emitGateSummary(result);
    if (result.status === "within") return 0;     // shrink/hold — exit 0
    return argv.includes("--enforce") ? 2 : 0;     // over budget: enforcing → 2 (distinct from operational 1); advisory → 0
  }
  if (argv.includes("--report")) {
    const against = argFlag(argv, "--against");
    if (!against) throw new Error("--report requires --against <size-baseline> (a report with no baseline is not 0% change)");
    const sizeBaseline = loadJson(against, "--against");
    if (!sizeBaseline.totals || !sizeBaseline.per_file) throw new Error(`--against: ${against} is not a size baseline (no totals/per_file)`);
    const qualityPath = argFlag(argv, "--quality");
    let qualityRun = null, frontierBaseline = null;
    if (qualityPath) {
      qualityRun = loadJson(qualityPath, "--quality");
      const fb = join(REPO_ROOT, "eval", "baselines", "frontier.json"); // FAFF-169's committed baseline
      frontierBaseline = existsSync(fb) ? loadJson(fb, "frontier baseline") : null;
    }
    const report = buildReport(census, sizeBaseline, qualityRun, frontierBaseline);
    printReport(report, against);
    return 0;
  }
  printCensus(census); // default: just print the current census
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("size-census.mjs")) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(`[size-census] ${e.message}`); process.exitCode = 1; }
}
