// FAFF-357 — `faff economics`: per-run unit economics (cost-per-shipped-issue).
// A PURE, rendering-only reporting subcommand (parity with budget check / runcheck):
// no tracker/network/LLM, and it touches NO producer (ledger/budget/events
// unchanged). It composes the run-ledger outcomes + budget check's exact
// transcript-summed token path + best-effort agent-*.meta.json per-issue
// attribution into a UnitEconomics block. Drives the real entrypoint end-to-end
// over filesystem fixtures (mirrors budget.test.mjs).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    // Clean env so an inherited CLAUDE_CODE_SESSION_ID can't leak in.
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

function fixture({ rc, ledger }) {
  const root = mkdtempSync(join(tmpdir(), "faff-econ-"));
  const runDir = join(root, ".faff", "runs", "run-test");
  mkdirSync(runDir, { recursive: true });
  if (rc != null) writeFileSync(join(root, ".faffrc.yaml"), rc);
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Write transcript files under a fake $CLAUDE_CONFIG_DIR for `cwd`. `files` maps a
// filename to { usage: [usageObj], sessionId?, meta? }. sessionId defaults to `sid`
// (the owned case); a `meta` object is written to the sibling <stem>.meta.json.
function withTranscripts(root, cwd, sid, files) {
  const enc = String(cwd).replace(/\//g, "-");
  const projdir = join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  for (const [name, spec] of Object.entries(files)) {
    const owner = spec.sessionId !== undefined ? spec.sessionId : sid;
    const lines = spec.usage.map((u) => {
      const rec = { type: "assistant", message: { usage: u } };
      if (owner != null) rec.sessionId = owner;
      return JSON.stringify(rec);
    });
    writeFileSync(join(projdir, name), lines.join("\n"));
    if (spec.meta !== undefined) {
      writeFileSync(join(projdir, name.replace(/\.jsonl$/, ".meta.json")), JSON.stringify(spec.meta));
    }
  }
  return join(root, "cfg");
}

const baseLedger = (over = {}) => ({
  run_id: "run-test",
  admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" },
  owner: { status: "running", started_at: "2026-06-23T15:00:00Z" },
  ...over,
});

test("economics --selftest passes (the pure-core + attribution table)", () => {
  const r = run(["economics", "--selftest"]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /economics --selftest: PASS/);
});

test("no run dir → exit 2 (not a silent empty render)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-econ-empty-"));
  try {
    const r = run(["economics", "--root", root]);
    assert.equal(r.code, 2);
    assert.match(r.err, /no run dir/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("INTEGRATION: mixed ledger, unpriced/estimate → buckets, counts, no dollar column", () => {
  const ledger = baseLedger({ outcomes: { "FAFF-1": "shipped", "FAFF-2": "shipped", "FAFF-3": "parked", "FAFF-4": "routed-out" } });
  const f = fixture({ rc: null, ledger });
  try {
    // No CLAUDE_CODE_SESSION_ID → estimate path (no transcript).
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    assert.equal(e.shipped_count, 2);
    assert.equal(e.attempt_count, 3); // excludes routed-out
    assert.equal(e.price_per_mtok, 0);
    assert.equal(e.cost_total, null);
    assert.equal(e.cost_per_shipped.cost_each, null);
    assert.deepEqual(e.buckets, [
      { bucket: "shipped", count: 2 },
      { bucket: "parked", count: 1 },
      { bucket: "routed-out", count: 1 },
    ]);
    assert.deepEqual(e.per_issue, []); // estimate path skips attribution
  } finally { f.cleanup(); }
});

test("INTEGRATION: transcript path, priced ledger → cost twins on every figure", () => {
  // Non-zero tokens_at_start isolates the pricing assertion from the inflation
  // warning (which fires on tokens_at_start=0 with spend — covered separately).
  const ledger = baseLedger({ budget: { tokens_at_start: 10 } });
  const f = fixture({ rc: "budget:\n  price_per_mtok: 5\n", ledger });
  try {
    const sid = "sess-price";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: { usage: [{ input_tokens: 4000010 }] },
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript");
    assert.equal(e.tokens_total, 4000000);  // 4000010 measured − 10 baseline
    assert.equal(e.price_per_mtok, 5);
    assert.equal(e.pricing, "flat");        // FAFF-427: explicit price_per_mtok>0 → flat, byte-for-byte
    assert.equal(e.cost_total, 20);         // 4M/1e6 * 5
    assert.equal(e.cost_per_shipped.cost_each, 20);
    assert.deepEqual(e.warnings, []);       // no inflation warning: tokens_at_start > 0
  } finally { f.cleanup(); }
});

// ===========================================================================
// FAFF-427: economics top-line migrates onto the SAME per-model x per-class
// map-pricing rule `budget.cost` now uses — closing ADR-0048's "two cost
// figures coexist" deferral. `withRecords` (below) already stamps `message.model`.
// ===========================================================================

test("FAFF-427: with NO budget.price_per_mtok configured, economics shows real dollars by default (map pricing) and pricing:\"map\"", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-map-default";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        // claude-opus-4-8: cache_read $0.5/Mtok. 2,000,000 cache_read tokens → $1.
        { message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 2000000 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.pricing, "map");
    assert.equal(e.price_per_mtok, 0); // legacy echo — unset
    assert.ok(Math.abs(e.cost_total - 1) < 1e-9, `cost_total=${e.cost_total}`);
    assert.ok(Math.abs(e.cost_per_shipped.cost_each - 1) < 1e-9);
  } finally { f.cleanup(); }
});

test("FAFF-427: an unpriced model's tokens are excluded from top-line cost (cost:null reporting convention) and named in a warning — priced models still sum", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-map-unpriced";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 1000000 } }, timestamp: "2026-07-01T10:00:00Z" }, // $3
        { message: { model: "some-mystery-model", usage: { input_tokens: 1000000 } }, timestamp: "2026-07-01T10:00:01Z" }, // unpriced
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    assert.equal(e.pricing, "map");
    assert.ok(Math.abs(e.cost_total - 3) < 1e-9, `cost_total=${e.cost_total} (only the priced model counts)`);
    assert.ok(e.warnings.some((w) => /unpriced/.test(w) && /some-mystery-model/.test(w)), JSON.stringify(e.warnings));
  } finally { f.cleanup(); }
});

test("FAFF-427: top-line cost_total under map pricing RECONCILES with the sum of --by model's priced rows (the ADR-0048 seam closed)", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-map-reconcile";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1000000, cache_read_input_tokens: 2000000 } }, timestamp: "2026-07-01T10:00:00Z" },
        { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 500000 } }, timestamp: "2026-07-01T11:00:00Z" },
      ],
    });
    const topLine = JSON.parse(run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid }).out);
    const byModel = JSON.parse(run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid }).out);
    const sumByModel = byModel.breakdown.rows.reduce((s, r) => s + (r.cost || 0), 0);
    assert.ok(Math.abs(topLine.cost_total - sumByModel) < 1e-9, `top-line ${topLine.cost_total} vs --by model sum ${sumByModel}`);
  } finally { f.cleanup(); }
});

test("FAFF-427: map-priced cost_total is THIS-RUN spend (baseline-subtracted), not whole-session — pro-rata fallback", () => {
  // A resumed session: the ledger's scalar baseline reflects ~4M prior-session
  // tokens; this run itself burned only ~1M. cost_total must price the ~1M
  // this-run delta (consistent with tokens_total + budget check's spent.cost),
  // NOT the whole ~5M session — the bug the correctness review caught.
  const ledger = baseLedger({ budget: { tokens_at_start: 4000000 } }); // no per-model baseline → pro-rata
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-baseline-prorata";
    // whole-session opus input = 5,000,000 tokens ($25 @ $5/Mtok if priced whole).
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 5000000 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    assert.equal(e.pricing, "map");
    assert.equal(e.tokens_total, 1000000); // 5M measured − 4M baseline
    // this-run delta = 5M × (1M/5M) = 1M opus input @ $5/Mtok = $5 — NOT the whole-session $25.
    assert.ok(Math.abs(e.cost_total - 5) < 1e-9, `cost_total=${e.cost_total} (must be this-run $5, not whole-session $25)`);
    // and cost_per_shipped is consistent with the this-run figure (1 shipped).
    assert.ok(Math.abs(e.cost_per_shipped.cost_each - 5) < 1e-9);
  } finally { f.cleanup(); }
});

test("FAFF-427: map-priced cost_total honours a real per-model baseline (tokens_at_start_by_model_class) exactly", () => {
  const ledger = baseLedger({
    budget: {
      tokens_at_start: 3000000,
      tokens_at_start_by_model_class: { "claude-opus-4-8": { input: 3000000, output: 0, cache_write: 0, cache_read: 0 } },
    },
  });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-baseline-exact";
    // whole-session opus input = 4M; real baseline 3M → this-run delta 1M @ $5/Mtok = $5.
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 4000000 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 1000000); // 4M − 3M
    assert.ok(Math.abs(e.cost_total - 5) < 1e-9, `cost_total=${e.cost_total} (1M opus input @ $5/Mtok)`);
  } finally { f.cleanup(); }
});

test("FAFF-427: estimate source + map pricing (no --by) → cost_total stays null, pricing still reported", () => {
  const ledger = baseLedger();
  const f = fixture({ rc: null, ledger });
  try {
    // No CLAUDE_CODE_SESSION_ID → estimate path, no records to price.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    assert.equal(e.pricing, "map");
    assert.equal(e.cost_total, null);
  } finally { f.cleanup(); }
});

test("INTEGRATION: zero-ship (0 shipped, >0 tokens) flags loud", () => {
  const ledger = baseLedger({ outcomes: { "FAFF-1": "parked", "FAFF-2": "errored" }, budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-zero";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: { usage: [{ input_tokens: 1700000 }] },
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    assert.equal(e.zero_ship, true);
    assert.equal(e.cost_per_shipped, null);
    assert.equal(e.cost_per_attempt.denom, 2);
  } finally { f.cleanup(); }
});

test("INTEGRATION: per-issue attribution via meta.json (owned only; non-issue subagent rolls into run total)", () => {
  const ledger = baseLedger({ outcomes: { "FAFF-49": "shipped", "FAFF-50": "parked" }, budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-attr";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: { usage: [{ input_tokens: 100000 }] },
      "agent-a.jsonl": { usage: [{ input_tokens: 6000000 }], meta: { description: "Build FAFF-49 via faff-graft" } },
      "agent-b.jsonl": { usage: [{ input_tokens: 200000 }], meta: { description: "tidy the backlog" } },
      "agent-c.jsonl": { usage: [{ input_tokens: 9000000 }], sessionId: "foreign-session", meta: { description: "Build FAFF-49" } },
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    const e = JSON.parse(r.out);
    // foreign-session agent-c excluded; owned orchestrator + a + b summed.
    assert.equal(e.tokens_total, 6300000);
    // only FAFF-49 attributed (agent-b has no issue id; FAFF-50 has no agent).
    assert.deepEqual(e.per_issue, [{ issue: "FAFF-49", bucket: "shipped", tokens: 6000000, cost: null }]);
    // run-level figure is independent of attribution.
    assert.equal(e.shipped_count, 1);
    assert.equal(e.attempt_count, 2);
  } finally { f.cleanup(); }
});

// FAFF-410: write full transcript records (model / timestamp / content blocks) —
// withTranscripts only carries usage. `filesRecords` maps a filename to an array of
// record objects; each is stamped with sessionId (defaults to `sid`) and written as
// one JSON line.
function withRecords(root, cwd, sid, filesRecords) {
  const enc = String(cwd).replace(/\//g, "-");
  const projdir = join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  for (const [name, recs] of Object.entries(filesRecords)) {
    const lines = recs.map((r) => JSON.stringify({ sessionId: sid, ...r }));
    writeFileSync(join(projdir, name), lines.join("\n"));
  }
  return join(root, "cfg");
}

test("FAFF-410 INTEGRATION: --by class --json reconciles to the top-line total", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-class";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000 } }, timestamp: "2026-07-01T10:00:00Z" },
        { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 500 } }, timestamp: "2026-07-02T11:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.axis, "class");
    assert.equal(e.breakdown.source, "transcript");
    assert.deepEqual(e.breakdown.rows.map((x) => x.key), ["input", "output", "cache_write", "cache_read"]);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
    assert.equal(e.breakdown.reconciliation.grand_total, 1685);
    assert.equal(e.breakdown.reconciliation.top_line_total, 1685);
    assert.equal(e.breakdown.priced_at_model, "claude-opus-4-8");
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: --by model --json — one row per model, rows sum to top-line", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-model";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1000, cache_read_input_tokens: 130 } }, timestamp: "2026-07-01T10:00:00Z" },
        { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 500 } }, timestamp: "2026-07-01T11:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.rows.length, 2);
    assert.equal(e.breakdown.rows[0].key, "claude-opus-4-8"); // 1130 > 500, desc by total
    assert.equal(e.breakdown.reconciliation.grand_total, 1630);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
    // opus priced at its own per-class rate: input 1000@$5/M + cache_read 130@$0.5/M
    assert.ok(Math.abs(e.breakdown.rows[0].cost - ((1000 * 5 + 130 * 0.5) / 1e6)) < 1e-9);
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: --by mcp --json — tool row present, non-leak (no payload string)", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-mcp";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "t1", name: "mcp__linear__get_issue", input: { id: "FAFF-1" } }], usage: { input_tokens: 10 } }, uuid: "u1", timestamp: "2026-07-01T10:00:00Z" },
        { message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET-PAYLOAD-XYZ" }] }, uuid: "u2", parentUuid: "u1", timestamp: "2026-07-01T10:00:01Z" },
        { message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 1000 } }, uuid: "u3", parentUuid: "u2", timestamp: "2026-07-01T10:00:02Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "mcp", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.axis, "mcp");
    const tool = e.breakdown.rows.find((x) => x.tool === "linear__get_issue");
    assert.ok(tool, "linear__get_issue row present");
    assert.equal(tool.call_count, 1);
    assert.ok(tool.request_bytes > 0 && tool.response_bytes > 0);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
    // NON-LEAK: no transcript payload content anywhere in the output.
    assert.ok(!r.out.includes("SECRET-PAYLOAD-XYZ"), "no payload string leaked");
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: --by day (no --json) renders a text table, not JSON", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-day";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-02T10:00:00Z" },
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 200 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /economics --by day/);
    assert.throws(() => JSON.parse(r.out), "table output is not JSON");
    // chronological ascending: 07-01 appears before 07-02
    assert.ok(r.out.indexOf("2026-07-01") < r.out.indexOf("2026-07-02"));
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: --by with an unrecognised axis exits non-zero naming the legal set", () => {
  const ledger = baseLedger();
  const f = fixture({ rc: null, ledger });
  try {
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "bogus", "--json"]);
    assert.notEqual(r.code, 0);
    assert.match(r.err, /class, model, mcp, day/);
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: no session id + --by → source:estimate, empty rows, exit 0", () => {
  const ledger = baseLedger();
  const f = fixture({ rc: null, ledger });
  try {
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.source, "estimate");
    assert.deepEqual(e.breakdown.rows, []);
  } finally { f.cleanup(); }
});

test("FAFF-410 INTEGRATION: no --by is byte-for-byte the pre-change UnitEconomics output", () => {
  const ledger = baseLedger({ outcomes: { "FAFF-1": "shipped", "FAFF-2": "parked" } });
  const f = fixture({ rc: null, ledger });
  try {
    const args = ["economics", "--run-dir", f.runDir, "--root", f.root, "--json"];
    const a = run(args);
    const e = JSON.parse(a.out);
    // no `breakdown` field leaks into the default path
    assert.equal(Object.prototype.hasOwnProperty.call(e, "breakdown"), false);
    assert.equal(e.shipped_count, 1);
  } finally { f.cleanup(); }
});

// FAFF-415: write an events.jsonl under the run dir. `events` is an array of
// {phase,type,issue?,data?} payloads; the CLI envelope (schema/run_id/seq/ts) is
// stamped here so `readRunEvents` parses them.
function withEvents(runDir, runId, events) {
  const lines = events.map((e, i) => JSON.stringify({ schema: 1, run_id: runId, seq: i, ts: "2026-07-09T10:00:00Z", ...e }));
  writeFileSync(join(runDir, "events.jsonl"), lines.join("\n"));
}

test("FAFF-415 INTEGRATION: --by effort buckets events.jsonl dispatches, coverage, non-leak", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-effort";
    // top-line transcript = 1000 tokens, dominant model opus.
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 800, output_tokens: 100, cache_read_input_tokens: 100 } }, timestamp: "2026-07-09T10:00:00Z" },
      ],
    });
    // events cover 400 of the 1000 top-line tokens: high (350) + low (50). A max
    // dispatch with a null/estimate delta counts but adds 0. Payload must not leak.
    withEvents(f.runDir, "run-test", [
      { phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "high", tokens: { input: 100, output: 50, cache_write: 0, cache_read: 200 }, tokens_source: "transcript" } },
      { phase: "prep", type: "prep-done", issue: "FAFF-1", data: { effort: "low", tokens: { input: 40, output: 10, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
      { phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "max", tokens: null, tokens_source: "estimate" } },
    ]);
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.axis, "effort");
    assert.equal(e.breakdown.source, "events");
    assert.equal(e.breakdown.cost_basis, "estimate");
    assert.equal(e.breakdown.priced_at_model, "claude-opus-4-8");
    // severity order low<high<max; each an occurring bucket
    assert.deepEqual(e.breakdown.rows.map((x) => x.key), ["low", "high", "max"]);
    const high = e.breakdown.rows.find((x) => x.key === "high");
    assert.equal(high.count, 1);
    assert.equal(high.total, 350);
    assert.equal(high.cache_read, 200);
    const max = e.breakdown.rows.find((x) => x.key === "max");
    assert.equal(max.count, 1);
    assert.equal(max.total, 0); // estimate delta counts the dispatch, adds no tokens
    // coverage vs top-line, not a false reconciliation
    assert.equal(e.breakdown.reconciliation.events_token_total, 400);
    assert.equal(e.breakdown.reconciliation.top_line_total, 1000);
    assert.equal(e.breakdown.reconciliation.coverage_pct, 40);
    assert.equal(e.breakdown.reconciliation.reconciles, false);
    // NON-LEAK: each breakdown row carries only counts/labels — no event payload keys.
    for (const row of e.breakdown.rows) {
      assert.deepEqual(Object.keys(row).sort(),
        ["cache_read", "cache_write", "cost", "count", "input", "key", "output", "total"]);
    }
  } finally { f.cleanup(); }
});

test("FAFF-415 INTEGRATION: --by effort with no events.jsonl → source:estimate, empty rows", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.source, "estimate");
    assert.deepEqual(e.breakdown.rows, []);
  } finally { f.cleanup(); }
});

test("FAFF-415 INTEGRATION: --by effort surfaces malformed_lines (honest coverage)", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-effort-malformed";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1000 } }, timestamp: "2026-07-09T10:00:00Z" },
      ],
    });
    // One good effort-tagged event + one corrupt (truncated) JSON line: the corrupt
    // line's tokens vanish from coverage, so it must be counted, not silently dropped.
    writeFileSync(join(f.runDir, "events.jsonl"),
      JSON.stringify({ schema: 1, run_id: "run-test", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "high", tokens: { input: 100, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }) +
      "\n{ this is not valid json\n");
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.reconciliation.malformed_lines, 1);
    assert.equal(e.breakdown.reconciliation.events_token_total, 100);
    assert.equal(e.breakdown.reconciliation.coverage_pct, 10); // 100 of 1000
  } finally { f.cleanup(); }
});

test("INTEGRATION: empty-outcome ledger renders without erroring (0 counts)", () => {
  const ledger = baseLedger({ admitted: [], outcomes: {} });
  const f = fixture({ rc: null, ledger });
  try {
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.deepEqual(e.buckets, []);
    assert.equal(e.shipped_count, 0);
    assert.equal(e.attempt_count, 0);
    assert.equal(e.cost_per_shipped, null);
    assert.equal(e.cost_per_attempt, null);
  } finally { f.cleanup(); }
});

// FAFF-337 — `latestRunDir` used to resolve the newest run dir by NAKED LEXICAL sort,
// which is format-dependent: a dash-prefixed legacy id (`YYYY-MM-DD-...`) sorts BEFORE
// a compact `run-...` id regardless of which is actually newer, so a stale ledger could
// win. The fix orders by directory mtime instead — format-independent. These drive the
// real resolver end-to-end through `faff economics --root` (no --run-dir), whose output
// embeds `run_id: path.basename(runDir)` so the resolved directory is directly observable.
function runIdFixture(root, dirName, ledger) {
  const runDir = join(root, ".faff", "runs", dirName);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return runDir;
}

test("FAFF-337: latestRunDir resolves by mtime, not name — a lexically-earlier legacy dir with a NEWER mtime wins over a lexically-later run-* dir", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-econ-runid-"));
  try {
    // No `run_id` field in either ledger, so economics' `run_id: path.basename(runDir)`
    // fallback (computeUnitEconomics prefers ledger.run_id when present) surfaces which
    // DIRECTORY latestRunDir actually picked.
    const bareLedger = { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } };
    const legacy = runIdFixture(root, "2026-01-01-beep-boop-00-00-00", bareLedger);
    const canonical = runIdFixture(root, "run-20260701-120000-beepboop-full", bareLedger);
    const past = new Date(Date.now() - 60000);
    utimesSync(legacy, past, past);
    utimesSync(canonical, past, past);

    // canonical dir touched most recently → it wins despite sorting lexically before "2026-01-01-...".
    utimesSync(canonical, new Date(), new Date());
    const r1 = run(["economics", "--root", root, "--json"]);
    assert.equal(r1.code, 0, r1.err);
    assert.equal(JSON.parse(r1.out).run_id, "run-20260701-120000-beepboop-full");

    // Bump the legacy dir's mtime past the canonical one → resolution flips (mtime governs, never the name).
    utimesSync(legacy, new Date(Date.now() + 60000), new Date(Date.now() + 60000));
    const r2 = run(["economics", "--root", root, "--json"]);
    assert.equal(r2.code, 0, r2.err);
    assert.equal(JSON.parse(r2.out).run_id, "2026-01-01-beep-boop-00-00-00");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Exercises `resolveLedgerOutcome`, which walks `runDirsNewestFirst` and returns the
// FIRST (i.e. newest) dir's outcome for the issue — this is the invariant
// `latestRunDir(root) === runDirsNewestFirst(root)[0]` proven through a real CLI seam
// (`faff state`), not just latestRunDir alone.
test("FAFF-337: runDirsNewestFirst orders by mtime — faff state resolves the issue's outcome from the mtime-newest dir regardless of lexical name", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-econ-runid-"));
  try {
    const olderDir = runIdFixture(root, "run-20260701-120000-beepboop-full", { run_id: "newer-name-older-mtime", outcomes: { "FAFF-1": "parked" } });
    const newerDir = runIdFixture(root, "2026-01-01-beep-boop-00-00-00", { run_id: "older-name-newer-mtime", outcomes: { "FAFF-1": "shipped" } });
    utimesSync(olderDir, new Date(Date.now() - 120000), new Date(Date.now() - 120000));
    utimesSync(newerDir, new Date(), new Date());

    // The lexically-EARLIER-named dir has the NEWEST mtime → its outcome must win.
    const s1 = run(["state", "FAFF-1", "--root", root, "--json"]);
    assert.equal(s1.code, 0, s1.err);
    const j1 = JSON.parse(s1.out);
    assert.equal(j1.ledger_outcome, "shipped");
    assert.equal(j1.ledger_run, "older-name-newer-mtime");

    // Flip the mtimes → resolution flips too (mtime governs, never the name).
    utimesSync(olderDir, new Date(), new Date());
    utimesSync(newerDir, new Date(Date.now() - 120000), new Date(Date.now() - 120000));
    const s2 = run(["state", "FAFF-1", "--root", root, "--json"]);
    assert.equal(s2.code, 0, s2.err);
    const j2 = JSON.parse(s2.out);
    assert.equal(j2.ledger_outcome, "parked");
    assert.equal(j2.ledger_run, "newer-name-older-mtime");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
