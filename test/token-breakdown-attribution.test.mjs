// FAFF-409 — deterministic tests for the measured per-tool MCP cache-amplification
// attribution added to scripts/token-breakdown.mjs. Runs under `node --test` (free,
// zero model calls): the attribution functions are pure, fed synthetic transcript
// records, so no real ~/.claude scan is needed and the numbers are fully controlled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  estTokensFromChars,
  buildIdToTool,
  toLightRecord,
  resolveMcpTools,
  attributeCacheRead,
  analyzeCacheAttribution,
  analyze,
} from "../scripts/token-breakdown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const SCRIPT = join(REPO, "scripts", "token-breakdown.mjs");

// --- helpers: synthesise transcript records in the real shape ---------------------
let seq = 0;
function rec({ session = "s1", sidechain = false, uuid, parent = null, ts, content, usage, model = "claude-opus-4-8", type = "assistant", subtype, isCompactSummary } = {}) {
  const u = uuid || `u${++seq}`;
  const r = { sessionId: session, isSidechain: sidechain, uuid: u, parentUuid: parent, timestamp: ts || `2026-07-09T00:00:${String(seq).padStart(2, "0")}.000Z`, type };
  if (content) r.message = { content, model };
  if (usage) r.message = { ...(r.message || { model }), usage };
  if (subtype) r.subtype = subtype;
  if (isCompactSummary) r.isCompactSummary = isCompactSummary;
  return r;
}
const toolUse = (id, name, input = {}) => ({ type: "tool_use", id, name, input });
const toolResult = (tuid, content) => ({ type: "tool_result", tool_use_id: tuid, content });
const text = (s) => ({ type: "text", text: s });
const usage = (cr, extra = {}) => ({ input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: cr, ...extra });
const MCP = (t) => `mcp__claude_ai_Linear__${t}`;

// build a light-record stream from raw records the way the script does
function lightStream(raw) {
  const idToTool = buildIdToTool(raw);
  return resolveMcpTools(raw.map((r, i) => toLightRecord(r, i)), idToTool);
}

// --- the chars/4 proxy ------------------------------------------------------------
test("estTokensFromChars is the chars/4 proxy", () => {
  assert.equal(estTokensFromChars(0), 0);
  assert.equal(estTokensFromChars(4), 1);
  assert.equal(estTokensFromChars(400), 100);
});

// --- SCENARIO 1: reconciliation ---------------------------------------------------
test("SCENARIO 1: every lineage's attributed+unattributed cache_read equals billed total", () => {
  const raw = [
    // user turn returns an MCP tool_result
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("list_issues"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "x".repeat(4000))] }),
    // three billed assistant turns re-read the prefix
    rec({ uuid: "c", parent: "b", content: [text("hello")], usage: usage(1000) }),
    rec({ uuid: "d", parent: "c", content: [text("world")], usage: usage(2000) }),
    rec({ uuid: "e", parent: "d", content: [text("bye")], usage: usage(3000) }),
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  assert.equal(out.reconciles, true);
  assert.equal(out.cache_read_attributed + out.unattributed, out.cache_read_total_billed);
  assert.equal(out.cache_read_total_billed, 6000);
  // MCP block was resident for turns d and e (2000+3000), not for c (first billed,
  // empty prefix? no — the tool_result at b entered before c). It IS resident for c,d,e.
  assert.ok(out.mcp_share_tok > 0);
});

test("empty reconstructed prefix routes cache_read to unattributed, not smeared", () => {
  // first billed turn has NO prior blocks in the lineage => its cr is unattributed
  const raw = [
    rec({ uuid: "a", content: [text("first")], usage: usage(500) }), // no prior blocks
    rec({ uuid: "b", parent: "a", content: [text("second")], usage: usage(700) }),
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  assert.equal(out.unattributed, 500); // turn a: empty prefix
  assert.equal(out.reconciles, true);
  assert.equal(out.cache_read_attributed + out.unattributed, 1200);
});

// --- SCENARIO 2: position sensitivity ---------------------------------------------
test("SCENARIO 2: an early tool_result is attributed materially more than a final-turn one", () => {
  const early = "e".repeat(4000);
  const late = "l".repeat(4000); // equal payload size
  const raw = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("get_issue"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", early)] }), // EARLY result
    rec({ uuid: "c", parent: "b", content: [text("t1")], usage: usage(1000) }),
    rec({ uuid: "d", parent: "c", content: [text("t2")], usage: usage(1000) }),
    rec({ uuid: "e", parent: "d", content: [text("t3")], usage: usage(1000) }),
    rec({ uuid: "f", parent: "e", type: "user", content: [toolUse("t2", MCP("save_comment"))] }),
    rec({ uuid: "g", parent: "f", type: "user", content: [toolResult("t2", late)] }),   // LATE result
    rec({ uuid: "h", parent: "g", content: [text("final")], usage: usage(1000) }),      // final billed turn
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  const earlyTok = out.perTool.get("claude_ai_Linear__get_issue") || 0;
  const lateTok = out.perTool.get("claude_ai_Linear__save_comment") || 0;
  assert.ok(earlyTok > lateTok, `early ${earlyTok} should exceed late ${lateTok}`);
  assert.equal(out.reconciles, true);
});

test("EDGE: a tool_result on the final turn earns no amplification (one-time cost only)", () => {
  const raw = [
    rec({ uuid: "a", content: [text("warmup")], usage: usage(0) }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolUse("t1", MCP("list_issues"))] }),
    rec({ uuid: "c", parent: "b", type: "user", content: [toolResult("t1", "z".repeat(8000))] }),
    // NO billed turn follows the tool_result => it was never re-read
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  assert.equal(out.perTool.get("claude_ai_Linear__list_issues") || 0, 0);
});

// --- EDGE: unmapped tool_result -> non-MCP residual, never dropped ----------------
test("EDGE: tool_result with no mapped tool_use lands in the non-MCP residual, never dropped", () => {
  const raw = [
    // tool_result whose tool_use_id has no matching mcp tool_use
    rec({ uuid: "a", type: "user", content: [toolResult("orphan", "y".repeat(4000))] }),
    rec({ uuid: "b", parent: "a", content: [text("t")], usage: usage(1000) }),
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  assert.equal(out.mcp_share_tok, 0);          // not attributed to any tool
  assert.equal(out.nonmcp_share_tok, 1000);    // but counted in the residual
  assert.equal(out.reconciles, true);
});

// --- per-lineage isolation --------------------------------------------------------
test("attribution never crosses a lineage boundary (main vs sidechain)", () => {
  const raw = [
    // main lineage: MCP result resident across a billed turn
    rec({ session: "s1", sidechain: false, uuid: "a", type: "user", content: [toolUse("t1", MCP("get_issue"))] }),
    rec({ session: "s1", sidechain: false, uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "m".repeat(4000))] }),
    rec({ session: "s1", sidechain: false, uuid: "c", parent: "b", content: [text("main")], usage: usage(1000) }),
    // sidechain lineage: its own billed turn must NOT re-read the main MCP block
    rec({ session: "s1", sidechain: true, uuid: "x", content: [text("side")], usage: usage(5000) }),
    rec({ session: "s1", sidechain: true, uuid: "y", parent: "x", content: [text("side2")], usage: usage(5000) }),
  ];
  const out = attributeCacheRead(lightStream(raw), { mode: "detect" });
  // sidechain's 10000 cr can never be attributed to the main lineage's MCP block;
  // AND the main lineage's turn c DID have the MCP block resident, so it is > 0
  // (guards against a regression that drops MCP attribution entirely).
  const mcpTok = out.perTool.get("claude_ai_Linear__get_issue") || 0;
  assert.ok(mcpTok > 0 && mcpTok <= 1000, `MCP attribution ${mcpTok} must be in (0,1000] — resident in main only`);
  assert.equal(out.reconciles, true);
  assert.equal(out.cache_read_total_billed, 11000);
});

// --- compaction boundary clears the resident set ----------------------------------
test("a compaction boundary evicts the resident set (detect clears, lenient does not)", () => {
  const raw = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("get_issue"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "c".repeat(8000))] }),
    rec({ uuid: "c", parent: "b", content: [text("pre")], usage: usage(1000) }),   // MCP resident here
    rec({ uuid: "d", parent: "c", type: "system", subtype: "compact_boundary", isCompactSummary: true }),
    rec({ uuid: "e", parent: "d", content: [text("post")], usage: usage(1000) }),  // MCP evicted (detect)
  ];
  const detect = attributeCacheRead(lightStream(raw), { mode: "detect" });
  const lenient = attributeCacheRead(lightStream(raw), { mode: "lenient" });
  const mcpDetect = detect.perTool.get("claude_ai_Linear__get_issue") || 0;
  const mcpLenient = lenient.perTool.get("claude_ai_Linear__get_issue") || 0;
  // lenient keeps the block resident across the boundary => attributes more
  assert.ok(mcpLenient > mcpDetect, `lenient ${mcpLenient} should exceed detect ${mcpDetect}`);
  // detect: turn e has an empty prefix after eviction => that cr is unattributed
  assert.ok(detect.unattributed >= 1000);
  assert.equal(detect.reconciles, true);
  assert.equal(lenient.reconciles, true);
});

// --- analyzeCacheAttribution surfaces the three boundary modes --------------------
test("analyzeCacheAttribution returns primary + lenient + aggressive, all reconciling", () => {
  const raw = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("list_comments"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "q".repeat(4000))] }),
    rec({ uuid: "c", parent: "b", content: [text("x")], usage: usage(2000) }),
    rec({ uuid: "d", parent: "c", content: [text("y")], usage: usage(2000) }),
  ];
  const a = analyzeCacheAttribution(raw);
  for (const m of ["primary", "lenient", "aggressive"]) {
    assert.equal(a[m].reconciles, true, `${m} must reconcile`);
  }
});

// --- analyze(): the new mcp.reconciliation block ---------------------------------
test("analyze() emits per-tool cache_read_measured_tok + a per-tool amplification_ratio and a reconciling mcp block", () => {
  const raw = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("get_issue"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "g".repeat(8000))] }),
    rec({ uuid: "c", parent: "b", content: [text("one")], usage: usage(3000) }),
    rec({ uuid: "d", parent: "c", content: [text("two")], usage: usage(3000) }),
  ];
  const out = analyze(raw);
  const rc = out.mcp.reconciliation;
  assert.equal(rc.reconciles, true);
  assert.equal(rc.cache_read_attributed + rc.unattributed, rc.cache_read_total_billed);
  assert.equal(rc.mcp_share_tok + rc.nonmcp_share_tok, rc.cache_read_attributed);
  // mcp_share is INDEPENDENTLY measured (summed per-tool), not just the residual:
  // the summed per-tool measured cache_read must equal mcp_share_tok within rounding
  // (nonmcp is the residual, but MCP — the ticket's deliverable — is a real sum).
  const perToolSum = out.mcp.per_tool.reduce((s, r) => s + r.cache_read_measured_tok, 0);
  assert.ok(Math.abs(perToolSum - rc.mcp_share_tok) <= out.mcp.per_tool.length,
    `summed per-tool measured (${perToolSum}) must match mcp_share_tok (${rc.mcp_share_tok}) within rounding`);
  // per-tool columns present
  const row = out.mcp.per_tool.find((r) => r.tool === "claude_ai_Linear__get_issue");
  assert.ok(row, "get_issue row present");
  assert.equal(typeof row.cache_read_measured_tok, "number");
  assert.equal(typeof row.amplification_ratio, "number");
  assert.ok(row.cache_read_measured_tok > 0);
  // grand-total reconciliation (unchanged from FAFF-407) still holds
  assert.equal(out.reconciliation.reconciles, true);
});

test("NON-LEAK: analyze() output serialises to JSON with no transcript payload text", () => {
  const secret = "SUPER_SECRET_PAYLOAD_TEXT";
  const raw = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("get_issue"), { q: secret })] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", secret.repeat(200))] }),
    rec({ uuid: "c", parent: "b", content: [text(secret)], usage: usage(1000) }),
  ];
  const json = JSON.stringify(analyze(raw));
  assert.equal(json.includes(secret), false, "no payload text may appear in the emitted output");
});

// --- integration smoke: run the real script against a synthetic corpus ------------
test("SMOKE: node scripts/token-breakdown.mjs --json reconciles and carries the new columns", () => {
  // Build a temp CLAUDE_CONFIG_DIR whose projects/<cwd-slug>/ holds one transcript.
  const cfg = mkdtempSync(join(tmpdir(), "tbd-"));
  const cwd = mkdtempSync(join(tmpdir(), "proj-"));
  const slug = cwd.replace(/\//g, "-");
  const projDir = join(cfg, "projects", slug);
  mkdirSync(projDir, { recursive: true });
  const lines = [
    rec({ uuid: "a", type: "user", content: [toolUse("t1", MCP("list_issues"))] }),
    rec({ uuid: "b", parent: "a", type: "user", content: [toolResult("t1", "s".repeat(4000))] }),
    rec({ uuid: "c", parent: "b", content: [text("hi")], usage: usage(2000) }),
    rec({ uuid: "d", parent: "c", content: [text("bye")], usage: usage(2000) }),
  ].map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(join(projDir, "session.jsonl"), lines);

  const res = spawnSync(process.execPath, [SCRIPT, "--json"], {
    cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg }, encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.reconciliation.reconciles, true);                 // grand total (FAFF-407)
  const rc = out.mcp.reconciliation;
  assert.equal(rc.reconciles, true);                                 // new attribution
  assert.equal(rc.mcp_share_tok + rc.nonmcp_share_tok + rc.unattributed, out.by_class.cache_read);
  for (const r of out.mcp.per_tool) {
    assert.equal(typeof r.cache_read_measured_tok, "number");
    assert.equal(typeof r.amplification_ratio, "number");
  }
});
