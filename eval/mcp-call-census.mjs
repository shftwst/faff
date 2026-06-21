// FAFF-175 — the Linear MCP call census: which Linear MCP calls faff actually makes during normal
// development, how often, and what they cost in tokens. Linear MCP ate ~39% of one week's token usage;
// this reads the ground-truth call set straight from the Claude Code session transcripts that already
// record every tool_use / tool_result — no live instrumentation.
//
// Zero-dependency: node builtins + estimateTokens (the chars/4 proxy reused from eval/cli-driver.mjs —
// a tokenizer LIBRARY would break the repo's zero-dep convention; the MCP-vs-CLI RATIO is what matters
// for FAFF-176/177, and the constant proxy error cancels in a ratio). Mirrors eval/size-census.mjs:
// pure aggregation functions + a thin I/O main().
//
// Schema-token overhead (per-tool input-schema cost, loaded once per session) is OUT OF SCOPE here —
// it isn't in the transcripts (it's sourced from the MCP tool definitions) and the per-session schema
// delta is FAFF-176's MCP-vs-CLI comparison to own. This census measures result/arg cost only.
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { estimateTokens } from "./cli-driver.mjs"; // FAFF-175: reuse, do not redefine (chars/4)

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

// est-token proxy. We accumulate raw CHAR counts (so a multi-MB Linear result never has to be rebuilt
// as a string just to be measured) and divide by 4 at the end — `estTokensFromChars`. That is the same
// chars/4 proxy as the imported `estimateTokens`, not a second definition: the equivalence
// `estTokensFromChars(s.length) === estimateTokens(s)` is asserted in the tests AND anchored here by a
// once-at-load self-check against the canonical source, so the two can never silently drift.
const estTokensFromChars = (chars) => Math.ceil((chars || 0) / 4);
{
  const probe = "the quick brown fox";
  if (estTokensFromChars(probe.length) !== estimateTokens(probe)) {
    throw new Error("mcp-call-census: estTokensFromChars drifted from eval/cli-driver.mjs estimateTokens");
  }
}

// The Claude Code transcript root: one slug dir per project/worktree, one *.jsonl per session.
export const PROJECTS_ROOT = join(homedir(), ".claude", "projects");
// A Linear MCP tool_use name looks like mcp__claude_ai_Linear__list_issues. Match any MCP server whose
// segment is "Linear" so a renamed connector (e.g. mcp__linear__) still counts; strip to the bare tool.
const LINEAR_RE = /^mcp__.*Linear__/i;
const stripTool = (name) => String(name).replace(LINEAR_RE, "");

// --- slug-dir enumeration: every ~/.claude/projects/ dir whose name contains "faff" (main + worktrees).
// "faff development" lives under faff-named slug dirs; main-only undercounts heavily (most build
// sessions run in per-issue worktree slug dirs). PURE-ish: a reader is injected for testability.
export function faffSlugDirs(projectsRoot = PROJECTS_ROOT, read = readdirSync) {
  let names;
  try { names = read(projectsRoot); } catch { return []; }
  return names
    .filter((n) => n.toLowerCase().includes("faff"))
    .map((n) => join(projectsRoot, n))
    .sort();
}

// --- normalise a tool_result.content to a measurable string. Shape varies: a plain string, or an array
// of content blocks ({type:"text", text} etc). String → as-is; array/object → JSON.stringify; null → "".
export function normaliseResultContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return JSON.stringify(content);
}

// --- argument payload to a measurable string (the tool_use.input object).
export function normaliseArgs(input) {
  if (input == null) return "";
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

// PURE — extract the Linear call records from ONE transcript's lines. Order-independent: collect every
// tool_use (id → {tool, arg_chars}) AND every tool_result (id → result_chars) in one pass, then pair by
// tool_use_id afterwards — a tool_result that lands on an earlier line than its tool_use (the Claude Code
// transcript does not guarantee use-before-result ordering; ~0.04% of live results in practice) is still
// attributed, not silently dropped. A tool_use with no matching result (truncated session) is an orphan:
// counted, result 0. Unparseable lines are skipped + counted.
// Returns { records, skippedLines, parsedLines, orphanCalls }.
export function extractCallRecords(lines) {
  const calls = new Map(); // id -> { tool, arg_chars }
  const results = new Map(); // tool_use_id -> result_chars (keyed by ALL tool_result ids seen)
  let skippedLines = 0, parsedLines = 0;
  for (const raw of lines) {
    if (!raw) continue; // blank line (e.g. trailing newline) — not an error
    let obj;
    try { obj = JSON.parse(raw); } catch { skippedLines++; continue; }
    parsedLines++;
    const content = obj?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === "tool_use" && LINEAR_RE.test(block.name || "")) {
        calls.set(block.id, { tool: stripTool(block.name), arg_chars: normaliseArgs(block.input).length });
      } else if (block?.type === "tool_result" && block.tool_use_id != null) {
        // Accumulate every result by id regardless of order; non-Linear ids are filtered out at pairing.
        const prev = results.get(block.tool_use_id) || 0;
        results.set(block.tool_use_id, prev + normaliseResultContent(block.content).length);
      }
    }
  }
  const records = [];
  let orphanCalls = 0;
  for (const [id, call] of calls) {
    const hasResult = results.has(id);
    if (!hasResult) orphanCalls++;
    records.push({ tool: call.tool, arg_chars: call.arg_chars, result_chars: results.get(id) || 0, orphan: !hasResult });
  }
  return { records, skippedLines, parsedLines, orphanCalls };
}

// PURE — aggregate a flat list of call records into per-tool ToolStats + totals, sorted by result cost.
// est_tokens via estimateTokens (chars/4). heaviest = the tools covering the top ~80% of result tokens.
export function aggregate(records) {
  const byTool = new Map();
  for (const r of records) {
    const s = byTool.get(r.tool) || { tool: r.tool, calls: 0, result_chars: 0, arg_chars: 0, orphans: 0 };
    s.calls++;
    s.result_chars += r.result_chars;
    s.arg_chars += r.arg_chars;
    if (r.orphan) s.orphans++;
    byTool.set(r.tool, s);
  }
  const by_tool = [...byTool.values()]
    .map((s) => {
      const result_est_tokens = estTokensFromChars(s.result_chars);
      return {
        tool: s.tool,
        calls: s.calls,
        result_chars: s.result_chars,
        result_est_tokens,
        arg_est_tokens: estTokensFromChars(s.arg_chars),
        // single round, to whole est-tokens (the markdown renders this verbatim — no second rounding).
        result_est_tokens_per_call: s.calls ? Math.round(result_est_tokens / s.calls) : 0,
        orphans: s.orphans,
      };
    })
    .sort((a, b) => b.result_est_tokens - a.result_est_tokens || a.tool.localeCompare(b.tool));

  const totals = by_tool.reduce(
    (t, s) => ({
      calls: t.calls + s.calls,
      result_est_tokens: t.result_est_tokens + s.result_est_tokens,
      arg_est_tokens: t.arg_est_tokens + s.arg_est_tokens,
    }),
    { calls: 0, result_est_tokens: 0, arg_est_tokens: 0 },
  );

  // heaviest: the leading tools whose cumulative result tokens reach ~80% of the total (Pareto head).
  const heaviest = [];
  let cum = 0;
  const threshold = totals.result_est_tokens * 0.8;
  for (const s of by_tool) {
    if (cum >= threshold) break;
    heaviest.push(s.tool);
    cum += s.result_est_tokens;
  }
  return { by_tool, totals, heaviest };
}

const round = (x) => Math.round(x * 1000) / 1000;

// PURE — assemble the full Report from per-file scan results. Takes the list of scanned-file summaries
// (each { file, mtime, records, skippedLines, orphanCalls }) + the window, and produces the report object.
export function buildReport(scanned, { from, to, days, slugDirsScanned }) {
  const allRecords = scanned.flatMap((s) => s.records);
  const agg = aggregate(allRecords);
  const totalSkipped = scanned.reduce((n, s) => n + s.skippedLines, 0);
  const totalOrphans = scanned.reduce((n, s) => n + s.orphanCalls, 0);
  return {
    window: { from, to, days },
    sessions_scanned: scanned.length,
    slug_dirs_scanned: slugDirsScanned,
    skipped_lines: totalSkipped,
    orphan_calls: totalOrphans,
    by_tool: agg.by_tool,
    totals: agg.totals,
    heaviest: agg.heaviest,
  };
}

// --- markdown rendering: a skimmable per-tool table led by RESULT tokens (the cost driver), per the
// anti-pattern (never lead with arg size). Mirrors size-census's printReport shape.
export function renderMarkdown(report) {
  const { window: w, totals } = report;
  const lines = [];
  lines.push(`# Linear MCP call census (FAFF-175)`);
  lines.push("");
  lines.push(`> Captured snapshot — regenerate with \`node eval/mcp-call-census.mjs --days N\`. Numbers are deterministic over a fixed window (no model call). est-tokens are a chars/4 proxy; the MCP-vs-CLI **ratio** (FAFF-176/177) is what they're for.`);
  lines.push("");
  lines.push(`> Window: ${w.from} → ${w.to} (${w.days} days) · ${report.sessions_scanned} sessions across ${report.slug_dirs_scanned} faff slug dirs`);
  lines.push("");
  lines.push(`**Total Linear MCP cost over the window:** ${totals.result_est_tokens.toLocaleString()} est result tokens across ${totals.calls.toLocaleString()} calls (chars/4 proxy).`);
  lines.push(`Arguments cost ${totals.arg_est_tokens.toLocaleString()} est tokens — the **result payload is the driver** (${ratio(totals.result_est_tokens, totals.arg_est_tokens)}× the arg cost).`);
  lines.push("");
  lines.push(`**Heaviest tools (top ~80% of result tokens):** ${report.heaviest.length ? report.heaviest.join(", ") : "(none)"}`);
  if (report.skipped_lines) lines.push(`\n_${report.skipped_lines} unparseable transcript line(s) skipped._`);
  if (report.orphan_calls) lines.push(`_${report.orphan_calls} orphan call(s) (no paired result — truncated sessions); counted with result 0._`);
  lines.push("");
  lines.push(`## Per-tool breakdown (sorted by result token cost)`);
  lines.push("");
  lines.push(`| Tool | Calls | Result est-tokens | Result/call | Arg est-tokens |`);
  lines.push(`|---|--:|--:|--:|--:|`);
  for (const t of report.by_tool) {
    lines.push(`| \`${t.tool}\` | ${t.calls} | ${t.result_est_tokens.toLocaleString()} | ${t.result_est_tokens_per_call.toLocaleString()} | ${t.arg_est_tokens.toLocaleString()} |`);
  }
  lines.push("");
  lines.push(`_est-tokens = chars/4 (reused from \`eval/cli-driver.mjs\`). Schema-token overhead is out of scope (FAFF-176). Re-running over the same window yields identical numbers._`);
  lines.push("");
  return lines.join("\n");
}
const ratio = (a, b) => (b === 0 ? "∞" : round(a / b));

// --- I/O: scan one transcript file → its per-file summary. Reads + line-splits, delegates to the pure
// extractCallRecords. mtime is captured for the window filter + report.
function scanFile(path) {
  const st = statSync(path);
  const text = readFileSync(path, "utf8");
  const { records, skippedLines, parsedLines, orphanCalls } = extractCallRecords(text.split("\n"));
  return { file: path, mtime: st.mtime, records, skippedLines, parsedLines, orphanCalls };
}

// --- the scan: enumerate faff slug dirs, mtime-filter *.jsonl by the window, scan each, build the report.
// Keyed by file path so a session that appears under two slug dirs is counted once per file (file paths
// are unique). Returns the assembled report.
export function runCensus({ days = 7, now = Date.now(), projectsRoot = PROJECTS_ROOT } = {}) {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  const dirs = faffSlugDirs(projectsRoot);
  const scanned = [];
  let oldest = Infinity, newest = -Infinity;
  for (const dir of dirs) {
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
    for (const fn of files) {
      const path = join(dir, fn);
      let st;
      try { st = statSync(path); } catch { continue; }
      if (st.mtime.getTime() < cutoff) continue; // outside the window
      const summary = scanFile(path);
      scanned.push(summary);
      const t = st.mtime.getTime();
      if (t < oldest) oldest = t;
      if (t > newest) newest = t;
    }
  }
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null);
  return buildReport(scanned, {
    from: iso(oldest),
    to: iso(newest),
    days,
    slugDirsScanned: dirs.length,
  });
}

// --- CLI (mirrors size-census's main): --days N, --out DIR. Empty window → exit non-zero, no zero report.
function argFlag(argv, name) { const i = argv.indexOf(name); return i !== -1 ? argv[i + 1] : null; }

function main(argv) {
  const daysRaw = argFlag(argv, "--days");
  const days = daysRaw == null ? 7 : Number.parseInt(daysRaw, 10);
  if (Number.isNaN(days) || days <= 0) {
    console.error(`--days must be a positive integer, got "${daysRaw}"`);
    return 1;
  }
  const report = runCensus({ days });

  // Empty window: no Linear calls found in the window → exit non-zero with a clear message, NOT a
  // zero-filled report that reads as "Linear is free".
  if (report.totals.calls === 0) {
    console.error(
      `No Linear MCP calls found in ${report.slug_dirs_scanned} faff slug dir(s) over the last ${days} day(s).\n` +
      `Either the window is too short, or no faff sessions made Linear calls. Widen --days or check ~/.claude/projects/.`,
    );
    return 2;
  }

  // Default out is a TRACKED path (eval/report/ is gitignored as real-model run output) so the spike's
  // committed report ships with the code. Override with --out for an ad-hoc scratch run.
  const outDir = argFlag(argv, "--out") || join(REPO_ROOT, "docs", "reports", "mcp-call-census");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, "report.json");
  const mdPath = join(outDir, "report.md");
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdPath, renderMarkdown(report));

  console.log(`Linear MCP call census — last ${days} days`);
  console.log(`  ${report.totals.calls} calls · ${report.totals.result_est_tokens.toLocaleString()} est result tokens · ${report.by_tool.length} distinct tools`);
  console.log(`  heaviest: ${report.heaviest.join(", ")}`);
  console.log(`  wrote ${jsonPath}`);
  console.log(`  wrote ${mdPath}`);
  return 0;
}

// Run when invoked directly (not when imported by the tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
