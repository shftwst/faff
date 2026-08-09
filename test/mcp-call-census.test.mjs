// FAFF-175 — deterministic tests for the Linear MCP call census. Runs under `node --test` (free, zero
// model calls): every aggregation function is pure, fed synthetic transcript lines, so no real
// ~/.claude/projects scan is needed and the numbers are fully controlled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "../eval/cli-driver.mjs";
import {
  extractCallRecords,
  aggregate,
  buildReport,
  renderMarkdown,
  normaliseResultContent,
  normaliseArgs,
  faffSlugDirs,
  runCensus,
} from "../scripts/mcp-call-census.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SCRIPT = join(REPO, "scripts", "mcp-call-census.mjs");

// --- helpers to synthesise a transcript line in the real shape -------------------------------------
const toolUse = (id, name, input = {}) => JSON.stringify({ message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (tuid, content) => JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: tuid, content }] } });
const LINEAR = (t) => `mcp__claude_ai_Linear__${t}`;

// --- the chars/4 proxy is the SAME function the repo blessed (no redefinition) ----------------------
test("est-token proxy is exactly estimateTokens (chars/4), not a redefinition", () => {
  // The census accumulates char COUNTS then divides by 4; that must equal estimateTokens on the string.
  for (const s of ["", "x", "test", "the quick brown fox", "a".repeat(4001)]) {
    assert.equal(Math.ceil(s.length / 4), estimateTokens(s), `chars/4 must match estimateTokens for len ${s.length}`);
  }
});

// --- extractCallRecords (PURE) ----------------------------------------------------------------------
test("extractCallRecords pairs a Linear tool_use with its result by tool_use_id", () => {
  const lines = [
    toolUse("id1", LINEAR("get_issue"), { id: "FAFF-1" }),
    toolResult("id1", "result-payload-16ch"),
  ];
  const { records, orphanCalls } = extractCallRecords(lines);
  assert.equal(records.length, 1);
  assert.equal(records[0].tool, "get_issue"); // prefix stripped
  assert.equal(records[0].result_chars, "result-payload-16ch".length);
  assert.equal(records[0].orphan, false);
  assert.equal(orphanCalls, 0);
});

test("extractCallRecords ignores non-Linear tool_use", () => {
  const lines = [
    toolUse("id1", "Bash", { command: "ls" }),
    toolResult("id1", "files..."),
    toolUse("id2", LINEAR("list_issues")),
    toolResult("id2", "[...]"),
  ];
  const { records } = extractCallRecords(lines);
  assert.equal(records.length, 1);
  assert.equal(records[0].tool, "list_issues");
});

test("orphan call (no paired result) is counted with result 0 and surfaced", () => {
  const lines = [toolUse("orphan", LINEAR("save_issue"), { id: "X" })]; // truncated before tool_result
  const { records, orphanCalls } = extractCallRecords(lines);
  assert.equal(records.length, 1);
  assert.equal(records[0].result_chars, 0);
  assert.equal(records[0].orphan, true);
  assert.equal(orphanCalls, 1);
});

test("extractCallRecords attributes a tool_result that appears BEFORE its tool_use (order-independent)", () => {
  // The Claude Code transcript does not guarantee use-before-result ordering; ~0.04% of live Linear
  // results arrive on an earlier line than their tool_use. The result must still be paired, not dropped.
  const lines = [
    toolResult("id1", "x".repeat(2828)), // result lands first
    toolUse("id1", LINEAR("get_issue"), { id: "FAFF-1" }),
  ];
  const { records, orphanCalls } = extractCallRecords(lines);
  assert.equal(records.length, 1);
  assert.equal(records[0].result_chars, 2828); // attributed despite the inverted order
  assert.equal(records[0].orphan, false);
  assert.equal(orphanCalls, 0);
});

test("unparseable JSONL lines are skipped and counted, not fatal", () => {
  const lines = [
    "{not json",
    toolUse("id1", LINEAR("get_issue")),
    toolResult("id1", "ok"),
    "}}also broken",
    "", // blank — not counted as skipped
  ];
  const { records, skippedLines, parsedLines } = extractCallRecords(lines);
  assert.equal(skippedLines, 2);
  assert.equal(parsedLines, 2);
  assert.equal(records.length, 1);
});

test("tool_result.content is normalised whether string or array of blocks", () => {
  const arr = [{ type: "text", text: "hello world" }];
  const strLines = [toolUse("a", LINEAR("get_issue")), toolResult("a", "hello world")];
  const arrLines = [toolUse("b", LINEAR("get_issue")), toolResult("b", arr)];
  const s = extractCallRecords(strLines).records[0].result_chars;
  const a = extractCallRecords(arrLines).records[0].result_chars;
  assert.equal(s, "hello world".length);
  assert.equal(a, JSON.stringify(arr).length); // array → JSON.stringify, measured normalised
  assert.ok(a > 0);
});

test("normaliseResultContent / normaliseArgs handle null, string, array, object", () => {
  assert.equal(normaliseResultContent(null), "");
  assert.equal(normaliseResultContent("abc"), "abc");
  assert.equal(normaliseResultContent([{ text: "x" }]), JSON.stringify([{ text: "x" }]));
  assert.equal(normaliseArgs(null), "");
  assert.equal(normaliseArgs({ id: "FAFF-1" }), JSON.stringify({ id: "FAFF-1" }));
});

// --- aggregate (PURE) -------------------------------------------------------------------------------
test("aggregate sums per-tool result chars → chars/4 est-tokens and sorts by result cost desc", () => {
  const records = [
    { tool: "get_issue", arg_chars: 8, result_chars: 400, orphan: false },
    { tool: "get_issue", arg_chars: 8, result_chars: 400, orphan: false },
    { tool: "list_issues", arg_chars: 4, result_chars: 4000, orphan: false },
  ];
  const { by_tool, totals } = aggregate(records);
  // sorted by result_est_tokens desc → list_issues (1000) before get_issue (200)
  assert.equal(by_tool[0].tool, "list_issues");
  assert.equal(by_tool[0].result_est_tokens, 1000); // 4000/4
  assert.equal(by_tool[1].tool, "get_issue");
  assert.equal(by_tool[1].calls, 2);
  assert.equal(by_tool[1].result_est_tokens, 200); // 800/4
  assert.equal(by_tool[1].result_est_tokens_per_call, 100);
  assert.equal(totals.calls, 3);
  assert.equal(totals.result_est_tokens, 1200);
});

test("result_est_tokens_per_call is a single clean integer round (no double-rounding in the markdown)", () => {
  // 3 calls totalling 1000 result chars → 250 est-tokens / 3 = 83.33 → Math.round → 83.
  const records = [
    { tool: "t", arg_chars: 0, result_chars: 400, orphan: false },
    { tool: "t", arg_chars: 0, result_chars: 300, orphan: false },
    { tool: "t", arg_chars: 0, result_chars: 300, orphan: false },
  ];
  const { by_tool } = aggregate(records);
  assert.equal(by_tool[0].result_est_tokens, 250); // ceil(1000/4)
  assert.equal(by_tool[0].result_est_tokens_per_call, 83); // 250/3 rounded once, an integer
  // and the markdown renders that integer verbatim (the value carried no fractional part to re-round).
  const r = buildReport([{ records, skippedLines: 0, orphanCalls: 0 }], { from: "a", to: "b", days: 7, slugDirsScanned: 1 });
  const md = renderMarkdown(r);
  assert.match(md, /\| 83 \|/);
});

test("aggregate heaviest names the tools covering the top ~80% of result tokens", () => {
  const records = [
    { tool: "big", arg_chars: 0, result_chars: 8000, orphan: false }, // 2000 tok
    { tool: "mid", arg_chars: 0, result_chars: 2000, orphan: false }, // 500 tok
    { tool: "tiny", arg_chars: 0, result_chars: 40, orphan: false },  // 10 tok
  ];
  const { heaviest } = aggregate(records);
  // total 2510; 80% = 2008. cum: big(2000) < 2008 → include big; then cum 2000 < 2008 → include mid; stop.
  assert.ok(heaviest.includes("big"));
  assert.ok(!heaviest.includes("tiny"));
});

// --- buildReport (PURE) -----------------------------------------------------------------------------
test("buildReport assembles window, totals, per-tool, heaviest, and surfaces skipped/orphans", () => {
  const scanned = [
    { records: [{ tool: "get_issue", arg_chars: 8, result_chars: 400, orphan: false }], skippedLines: 1, orphanCalls: 0 },
    { records: [{ tool: "save_issue", arg_chars: 100, result_chars: 40, orphan: true }], skippedLines: 0, orphanCalls: 1 },
  ];
  const r = buildReport(scanned, { from: "2026-06-16", to: "2026-06-21", days: 7, slugDirsScanned: 20 });
  assert.equal(r.window.days, 7);
  assert.equal(r.sessions_scanned, 2);
  assert.equal(r.slug_dirs_scanned, 20);
  assert.equal(r.skipped_lines, 1);
  assert.equal(r.orphan_calls, 1);
  assert.equal(r.totals.calls, 2);
  assert.equal(r.by_tool.length, 2);
});

// --- renderMarkdown (PURE) --------------------------------------------------------------------------
test("renderMarkdown leads with result tokens, not arg size (the anti-pattern guard)", () => {
  const scanned = [{ records: [
    { tool: "get_issue", arg_chars: 8, result_chars: 4000, orphan: false },
    { tool: "save_comment", arg_chars: 4000, result_chars: 40, orphan: false },
  ], skippedLines: 0, orphanCalls: 0 }];
  const r = buildReport(scanned, { from: "a", to: "b", days: 7, slugDirsScanned: 1 });
  const md = renderMarkdown(r);
  // result-token table comes before any arg emphasis; get_issue (heaviest by result) is first data row
  const firstRow = md.split("\n").find((l) => l.startsWith("| `"));
  assert.match(firstRow, /get_issue/);
  assert.match(md, /result payload is the driver/);
  assert.match(md, /sorted by result token cost/);
});

// --- determinism: two runs over the same synthetic scan yield identical numbers ---------------------
test("aggregate is deterministic (same records → identical output)", () => {
  const records = [
    { tool: "b", arg_chars: 1, result_chars: 40, orphan: false },
    { tool: "a", arg_chars: 1, result_chars: 40, orphan: false },
  ];
  assert.deepEqual(aggregate(records), aggregate(records));
});

// --- faffSlugDirs (injected reader) -----------------------------------------------------------------
test("faffSlugDirs returns only slug dirs whose name contains 'faff', sorted", () => {
  const fake = () => ["-Users-x-workspace-faff", "-Users-x-other-project", "-Users-x-faff-worktrees-faff-99"];
  const dirs = faffSlugDirs("/root", fake);
  assert.equal(dirs.length, 2);
  assert.ok(dirs.every((d) => d.toLowerCase().includes("faff")));
  assert.deepEqual(dirs, [...dirs].sort());
});

test("faffSlugDirs returns [] when the projects root is unreadable (no crash)", () => {
  assert.deepEqual(faffSlugDirs("/root", () => { throw new Error("ENOENT"); }), []);
});

// --- runCensus over a real temp projects tree (I/O end-to-end, still deterministic) -----------------
test("runCensus scans a faff slug dir, mtime-filters, and aggregates real files", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-mcp-census-"));
  const slug = join(root, "-Users-x-workspace-shftwst-faff");
  mkdirSync(slug, { recursive: true });
  const lines = [
    toolUse("id1", LINEAR("get_issue"), { id: "FAFF-1" }),
    toolResult("id1", "a".repeat(400)),
    toolUse("id2", LINEAR("list_issues")),
    toolResult("id2", "b".repeat(4000)),
  ].join("\n") + "\n";
  writeFileSync(join(slug, "session.jsonl"), lines);
  // a non-faff dir must be ignored
  const other = join(root, "-Users-x-someone-else");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "s.jsonl"), toolUse("z", LINEAR("get_issue")) + "\n" + toolResult("z", "c".repeat(9999)) + "\n");

  const r = runCensus({ days: 7, projectsRoot: root });
  assert.equal(r.slug_dirs_scanned, 1);          // only the faff dir
  assert.equal(r.totals.calls, 2);               // the non-faff dir's call excluded
  assert.equal(r.by_tool[0].tool, "list_issues"); // 4000 chars heaviest
  assert.equal(r.by_tool[0].result_est_tokens, 1000);
});

test("runCensus mtime-filter excludes files older than the window", async () => {
  const root = mkdtempSync(join(tmpdir(), "faff-mcp-census-old-"));
  const slug = join(root, "-faff-old");
  mkdirSync(slug, { recursive: true });
  const f = join(slug, "old.jsonl");
  writeFileSync(f, toolUse("id1", LINEAR("get_issue")) + "\n" + toolResult("id1", "x".repeat(400)) + "\n");
  // backdate the file well past the window
  const past = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const { utimesSync } = await import("node:fs");
  utimesSync(f, new Date(past), new Date(past));
  const r = runCensus({ days: 7, projectsRoot: root });
  assert.equal(r.totals.calls, 0); // filtered out by mtime
});

// --- CLI exit contract: empty window exits non-zero, NOT a zero-filled report -----------------------
test("CLI exits 2 (not a zero report) when no Linear calls fall in the window", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-mcp-empty-"));
  // a faff slug dir under ~/.claude/projects but with no transcripts
  mkdirSync(join(root, ".claude", "projects", "-faff-empty"), { recursive: true });
  const r = spawnSync(process.execPath, [SCRIPT, "--days", "7", "--out", join(root, "out")], {
    encoding: "utf8",
    env: { ...process.env, HOME: root }, // point ~/.claude/projects at the empty tree
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No Linear MCP calls found/);
  assert.equal(existsSync(join(root, "out", "report.json")), false); // no zero-filled report written
});

test("CLI rejects a non-positive --days with exit 1", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--days", "0"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /positive integer/);
});

test("CLI writes report.json + report.md and is reproducible over the same window", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-mcp-write-"));
  const slug = join(root, ".claude", "projects", "-faff-main");
  mkdirSync(slug, { recursive: true });
  writeFileSync(join(slug, "s.jsonl"),
    toolUse("id1", LINEAR("get_issue")) + "\n" + toolResult("id1", "x".repeat(800)) + "\n");
  const out = join(root, "out");
  const env = { ...process.env, HOME: root };
  const run = () => spawnSync(process.execPath, [SCRIPT, "--days", "7", "--out", out], { encoding: "utf8", env });
  const r1 = run();
  assert.equal(r1.status, 0);
  const json1 = readFileSync(join(out, "report.json"), "utf8");
  assert.ok(existsSync(join(out, "report.md")));
  const r2 = run();
  const json2 = readFileSync(join(out, "report.json"), "utf8");
  assert.equal(json1, json2); // reproducible: identical bytes over the same window
});
