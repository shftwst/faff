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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const { renderEconomicsBreakdown } = require("../plugin/skills/faff/bin/lib/economics.js");

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

test("FAFF-446: budget.price_per_mtok in FRESH config is REMOVED — ignored (economics still prices from the map), named in a warning", () => {
  // Non-zero tokens_at_start isolates the pricing assertion from the inflation
  // warning (which fires on tokens_at_start=0 with spend — covered separately).
  const ledger = baseLedger({ budget: { tokens_at_start: 10 } });
  const f = fixture({ rc: "budget:\n  price_per_mtok: 5\n", ledger });
  try {
    const sid = "sess-price";
    // claude-opus-4-8: input $5/MTok — same numeric rate the removed flat scalar
    // used here, so cost_total is coincidentally unchanged; `pricing` and the
    // warning prove it now comes from the map, not the removed scalar.
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 4000010 } }, timestamp: "2026-07-01T10:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript");
    assert.equal(e.tokens_total, 4000000);  // 4000010 measured − 10 baseline
    assert.equal(e.price_per_mtok, 0);      // FAFF-446: legacy echo — the removed scalar is never applied
    assert.equal(e.pricing, "map");         // FAFF-446: flat pricing can no longer be freshly configured
    assert.ok(Math.abs(e.cost_total - 20) < 1e-6, `cost_total=${e.cost_total}`);
    assert.ok(Math.abs(e.cost_per_shipped.cost_each - 20) < 1e-6);
    assert.ok(e.warnings.some((w) => /removed \(FAFF-446\)/.test(w) && /price_per_mtok_by_model/.test(w) && /'5'/.test(w)),
      `expected the removed-knob warning naming the ignored value: ${JSON.stringify(e.warnings)}`);
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
    assert.deepEqual(e.breakdown.rows.map((x) => x.key), ["input", "output", "cache_write_5m", "cache_write_1h", "cache_read"]);
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
        ["cache_read", "cache_write_1h", "cache_write_5m", "cost", "count", "input", "key", "output", "total"]);
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

test("FAFF-500 INTEGRATION: --by phase splits explore(child)/synthesis(parent)/build, reconciles", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-by-phase";
    // parent <sid>.jsonl: one record in the prep window, one in the build window.
    // agent-explore.jsonl (owned child, prep window) → prep-explore; agent-build.jsonl
    // (owned child, build window) → build. A planted SECRET in a tool_use input must
    // never reach the breakdown JSON (non-leak).
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-09T10:00:30Z" },
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 200 } }, timestamp: "2026-07-09T10:02:30Z" },
      ],
      "agent-explore.jsonl": [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 50, cache_read_input_tokens: 500 }, content: [{ type: "tool_use", name: "Read", input: { path: "SECRET-PHASE-INTEG" } }] }, timestamp: "2026-07-09T10:00:45Z" },
      ],
      "agent-build.jsonl": [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 30 } }, timestamp: "2026-07-09T10:02:45Z" },
      ],
    });
    withEvents(f.runDir, "run-test", [
      { phase: "prep", type: "prep-start", issue: "FAFF-1", ts: "2026-07-09T10:00:00Z" },
      { phase: "prep", type: "prep-done", issue: "FAFF-1", ts: "2026-07-09T10:01:00Z" },
      { phase: "build", type: "build-start", issue: "FAFF-1", ts: "2026-07-09T10:02:00Z" },
      { phase: "build", type: "issue-outcome", issue: "FAFF-1", ts: "2026-07-09T10:03:00Z" },
    ]);
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "phase", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.axis, "phase");
    assert.equal(bd.source, "transcript");
    assert.equal(bd.cost_basis, "estimate");
    assert.equal(bd.priced_at_model, "claude-opus-4-8");
    assert.deepEqual(bd.rows.map((x) => x.key), ["prep-explore", "prep-synthesis", "build"]);
    const explore = bd.rows.find((x) => x.key === "prep-explore");
    assert.equal(explore.input, 50);
    assert.equal(explore.cache_read, 500);
    assert.equal(explore.total, 550);
    assert.equal(explore.turns, 1);
    assert.equal(explore.tool_calls, 1);
    const synth = bd.rows.find((x) => x.key === "prep-synthesis");
    assert.equal(synth.total, 100);
    assert.equal(synth.turns, 1);
    const build = bd.rows.find((x) => x.key === "build");
    assert.equal(build.total, 230); // 200 parent + 30 child, both in the build window
    assert.equal(build.turns, 2);
    // reconcile-by-construction: all four buckets sum to the flat measureTokens top-line
    assert.equal(bd.reconciliation.reconciles, true);
    assert.equal(bd.reconciliation.grand_total, 880);
    assert.equal(bd.reconciliation.top_line_total, 880);
    assert.equal(bd.reconciliation.coverage_pct, 100);
    assert.equal(bd.reconciliation.windows_found, 2);
    // NON-LEAK: no transcript/event payload string in the breakdown output
    assert.ok(!r.out.includes("SECRET-PHASE-INTEG"), "planted secret must not appear in the breakdown");
    // rows carry only counts/labels/cost — no payload keys
    for (const row of bd.rows) {
      assert.deepEqual(Object.keys(row).sort(),
        ["cache_read", "cache_write_1h", "cache_write_5m", "cost", "input", "key", "output", "tool_calls", "total", "turns"]);
    }
  } finally { f.cleanup(); }
});

test("FAFF-500 INTEGRATION: --by phase with no events.jsonl → all unattributed, exit 0, reconciles", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-phase-retro";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 400, cache_read_input_tokens: 600 } }, timestamp: "2026-07-09T10:00:30Z" },
      ],
    });
    // No events.jsonl written → no windows → honest empty split, not an error.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "phase", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript");
    assert.deepEqual(bd.rows.map((x) => x.key), ["unattributed"]);
    assert.equal(bd.rows[0].total, 1000);
    assert.equal(bd.reconciliation.reconciles, true);
    assert.equal(bd.reconciliation.coverage_pct, 0);
    assert.equal(bd.reconciliation.windows_found, 0);
  } finally { f.cleanup(); }
});

test("FAFF-500 INTEGRATION: --by phase with no resolvable transcript → source:estimate, empty rows", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    // No CLAUDE_CODE_SESSION_ID → the transcript census degrades to estimate.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "phase", "--json"]);
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "estimate");
    assert.deepEqual(bd.rows, []);
  } finally { f.cleanup(); }
});

test("FAFF-705 INTEGRATION: --by effort folds engine-spend into the effort buckets (two-source)", () => {
  const ECON_MIXED = "backends:\n  seat:\n    provider: codex\n    model: claude-sonnet-5\ndispatch:\n  methodology:\n    model: engine:seat\n";
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: ECON_MIXED, ledger });
  try {
    const sid = "sess-effort-fold";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1000 } }, timestamp: "2026-08-09T10:00:00Z" },
      ],
    });
    // events.jsonl: an Agent-lane dispatch tagged low. engine-spend.jsonl: codex calls tagged
    // high + medium (the effort field FAFF-705 adds to the SpendRecord).
    writeFileSync(join(f.runDir, "events.jsonl"),
      JSON.stringify({ schema: 1, run_id: "run-test", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "low", tokens: { input: 50, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }));
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify({ ts: "t", engine: "seat", provider: "codex", model: "claude-sonnet-5", source: "exec-json-events", effort: "high", input: 300, output: 0, cache_read: 0, cache_write: 0 }) + "\n" +
      JSON.stringify({ ts: "t", engine: "seat", provider: "codex", model: "claude-sonnet-5", source: "exec-json-events", effort: "medium", input: 100, output: 0, cache_read: 0, cache_write: 0 }) + "\n");
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "events+engine-spend", "the effort census names both sources");
    const keys = bd.rows.map((x) => x.key);
    assert.ok(keys.includes("low") && keys.includes("medium") && keys.includes("high"),
      "the low (event) + high/medium (engine) buckets are all populated");
    assert.equal(bd.rows.find((x) => x.key === "high").input, 300);
    assert.equal(bd.rows.find((x) => x.key === "medium").input, 100);
    assert.equal(bd.reconciliation.engine_token_total, 400);
  } finally { f.cleanup(); }
});

test("FAFF-705 REGRESSION: --by effort on a transcript-only run stays source:events (byte-identity)", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-effort-noeng";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1000 } }, timestamp: "2026-08-09T10:00:00Z" },
      ],
    });
    writeFileSync(join(f.runDir, "events.jsonl"),
      JSON.stringify({ schema: 1, run_id: "run-test", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1", data: { effort: "high", tokens: { input: 100, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }));
    // No engine-spend.jsonl → the fold must not fire.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "events");
    assert.ok(!("engine_token_total" in bd.reconciliation), "no engine field leaks into a transcript-only census");
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

// ===========================================================================
// FAFF-488 — S2: --session-id restores per-issue attribution on the pinned
// root+session path (an owned agent-*.jsonl child + sibling .meta.json), from
// a process cwd that is NOT the pinned root and with no ambient session id —
// the same headless-orchestrator shape budget.test.mjs's S1 exercises.
// ===========================================================================
test("S2 (FAFF-488): --session-id restores per-issue attribution (owned child + .meta.json) from a mismatched cwd with no ambient session id", () => {
  const ledger = baseLedger({ outcomes: { "FAFF-77": "shipped" }, budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  const worktree = mkdtempSync(join(tmpdir(), "faff-econ-worktree-"));
  try {
    const sid = "sess-perissue";
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: { usage: [{ input_tokens: 1000 }] },
      "agent-x.jsonl": { usage: [{ input_tokens: 500000 }], meta: { description: "Build FAFF-77 via faff-graft" } },
    });
    const spawnEnv = { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg };

    // Sanity: without --session-id, no ambient sid → estimate, per_issue empty.
    const before = spawnSync("node", [CLI, "economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { encoding: "utf8", cwd: worktree, env: spawnEnv });
    const beforeJson = JSON.parse(before.stdout);
    assert.equal(beforeJson.tokens_source, "estimate");
    assert.deepEqual(beforeJson.per_issue, []);

    // With --session-id: the pinned root+session path restores both the
    // four-class total AND per-issue attribution in the same call.
    const after = spawnSync("node", [CLI, "economics", "--run-dir", f.runDir, "--root", f.root, "--session-id", sid, "--json"],
      { encoding: "utf8", cwd: worktree, env: spawnEnv });
    assert.equal(after.status, 0, after.stderr);
    const afterJson = JSON.parse(after.stdout);
    assert.equal(afterJson.tokens_source, "transcript");
    assert.deepEqual(afterJson.per_issue, [{ issue: "FAFF-77", bucket: "shipped", tokens: 500000, cost: null }]);
  } finally { f.cleanup(); rmSync(worktree, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-488 — Integration smoke: the exact sequence a real beep-boop
// orchestrator makes — run-start `budget check` baseline, a token-tagged
// `issue-outcome` append for a simulated subagent return, then `economics` —
// all with --root "$measure_root" --session-id "$session_id", from a process
// cwd that is NOT the pinned root and with no ambient session id. Asserts the
// FAFF-488 degrade does not reproduce end-to-end across all three commands.
//
// Honest limit (per the spec's §7 Assumes): this fixture hand-places the
// owned agent-*.jsonl child under the pinned root's project dir, proving the
// CLI plumbing end-to-end. It does NOT prove where a REAL isolated-worktree
// build subagent's own transcript actually lands on disk — that discharge
// requires a real dispatch, out of scope for this fixture-driven suite.
// ===========================================================================
test("Integration smoke (FAFF-488): budget check (baseline) -> events append --tokens (simulated subagent return) -> economics, all pinned to --root/--session-id from a mismatched cwd with no ambient session id", () => {
  const runId = "run-test";
  const ledger = {
    run_id: runId, admitted: ["FAFF-90"], outcomes: { "FAFF-90": "shipped" },
    owner: { status: "running", started_at: "2026-06-23T15:00:00Z" },
    budget: { tokens_at_start: 0, tokens_at_start_by_class: { input: 0, output: 0, cache_write: 0, cache_read: 0 } },
  };
  const f = fixture({ rc: null, ledger });
  const worktree = mkdtempSync(join(tmpdir(), "faff-econ-smoke-worktree-"));
  try {
    const sid = "sess-smoke";
    // The orchestrator's own transcript + one owned subagent child (simulating
    // the build subagent's return), under the MAIN checkout's (f.root) project dir.
    const cfg = withTranscripts(f.root, f.root, sid, {
      [`${sid}.jsonl`]: { usage: [{ input_tokens: 1000, output_tokens: 200 }] },
      "agent-faff90.jsonl": { usage: [{ input_tokens: 300000, output_tokens: 20000 }], meta: { description: "Build FAFF-90 via faff-graft" } },
    });
    // No ambient CLAUDE_CODE_SESSION_ID anywhere in this env — only --session-id.
    const spawnEnv = { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_CONFIG_DIR: cfg };
    const pinned = ["--root", f.root, "--session-id", sid];

    // 1. Run-start baseline: `faff budget check` (measures against the seeded
    // tokens_at_start:0 baseline — the orchestrator would record this at mint).
    const baseline = spawnSync("node", [CLI, "budget", "check", "--run-dir", f.runDir, ...pinned], { encoding: "utf8", cwd: worktree, env: spawnEnv });
    assert.equal(baseline.status, 0, baseline.stderr);
    const baselineJson = JSON.parse(baseline.stdout);
    assert.equal(baselineJson.tokens_source, "transcript", "run-start baseline must resolve via transcript, not estimate");

    // 2. A token-tagged `issue-outcome` append for the simulated subagent return.
    const append = spawnSync("node", [CLI, "events", "append", "--run", runId, ...pinned, "--tokens"], {
      encoding: "utf8", cwd: worktree, env: spawnEnv,
      input: JSON.stringify({ phase: "build", type: "issue-outcome", issue: "FAFF-90", data: { outcome: "shipped" } }),
    });
    assert.equal(append.status, 0, append.stderr);
    // FAFF-564: the tagged append emits [ledger-write, payload] — read the LAST line.
    const eventLines = readFileSync(join(f.runDir, "events.jsonl"), "utf8").trim().split("\n");
    const eventLine = JSON.parse(eventLines[eventLines.length - 1]);
    assert.equal(eventLine.data.tokens_source, "transcript", "the issue-outcome event must be token-tagged from the transcript, not degrade to estimate");

    // 3. `faff economics` — the final consumer.
    const econ = spawnSync("node", [CLI, "economics", "--run-dir", f.runDir, ...pinned, "--json"], { encoding: "utf8", cwd: worktree, env: spawnEnv });
    assert.equal(econ.status, 0, econ.stderr);
    const econJson = JSON.parse(econ.stdout);
    assert.equal(econJson.tokens_source, "transcript", "the FAFF-488 degrade does not reproduce: economics resolves via transcript");
    assert.ok(econJson.tokens_total > 0, `tokens_total=${econJson.tokens_total}`);
    assert.deepEqual(econJson.per_issue, [{ issue: "FAFF-90", bucket: "shipped", tokens: 320000, cost: null }],
      "per-issue attribution is populated end-to-end, not empty");
  } finally { f.cleanup(); rmSync(worktree, { recursive: true, force: true }); }
});

test("FAFF-500 REGRESSION: --by phase honours --session-id (reads effectiveEnv, not process.env)", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-phase-pinned";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-09T10:00:30Z" },
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 200 } }, timestamp: "2026-07-09T10:02:30Z" },
      ],
    });
    withEvents(f.runDir, "run-test", [
      { phase: "prep", type: "prep-start", issue: "FAFF-1", ts: "2026-07-09T10:00:00Z" },
      { phase: "prep", type: "prep-done", issue: "FAFF-1", ts: "2026-07-09T10:01:00Z" },
      { phase: "build", type: "build-start", issue: "FAFF-1", ts: "2026-07-09T10:02:00Z" },
      { phase: "build", type: "issue-outcome", issue: "FAFF-1", ts: "2026-07-09T10:03:00Z" },
    ]);
    // --session-id supplies the session; NO ambient CLAUDE_CODE_SESSION_ID in the env. If the
    // phase branch read process.env instead of effectiveEnv, the census would degrade to
    // source:estimate and diverge from the top-line (which IS measured via effectiveEnv).
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "phase", "--session-id", sid, "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript", "--session-id must select the session for the phase census, not degrade to estimate");
    assert.equal(bd.reconciliation.reconciles, true);
    assert.equal(bd.reconciliation.grand_total, 300);
    assert.equal(bd.rows.find((x) => x.key === "prep-synthesis").total, 100);
    assert.equal(bd.rows.find((x) => x.key === "build").total, 200);
  } finally { f.cleanup(); }
});

// ---------------------------------------------------------------------------
// FAFF-604 — mixed-fleet reporting honesty: economics labels WHERE each figure
// came from, and never reports an unobservable engine as free.
// ---------------------------------------------------------------------------

const ECON_MIXED_RC = "backends:\n  seat:\n    provider: codex\n    model: claude-sonnet-5\ndispatch:\n  methodology:\n    model: engine:seat\n";
const econCodexRecord = (over = {}) => ({
  ts: "2026-07-25T12:00:00Z", engine: "seat", provider: "codex", model: "claude-sonnet-5",
  source: "exec-json-events", input: 0, output: 0, cache_read: 0, cache_write: 0, ...over,
});

test("FAFF-604 PARITY: a transcript-only run emits no spend_sources / unmetered_engines", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 120);
    assert.equal(e.spend_sources, undefined, "the additive label must be absent on a single-source run");
    assert.equal(e.unmetered_engines, undefined);
  } finally { f.cleanup(); }
});

test("FAFF-604: a mixed-fleet run labels both sources and totals across them", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 1000, output: 200 })) + "\n");
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 1320, "the top line covers both sources");
    const src = Object.fromEntries(e.spend_sources.map((x) => [x.source, x]));
    assert.equal(src["transcript-jsonl"].tokens, 120);
    assert.equal(src["exec-json-events"].tokens, 1200);
    assert.equal(src["exec-json-events"].records, 1);
    // Both halves priced from the same map, so cost_total covers the codex lane too.
    assert.ok(e.cost_total > 0, "a priced mixed-fleet run must report a cost covering both sources");
    assert.ok(src["exec-json-events"].cost > 0, "the engine half carries its own priced figure");
  } finally { f.cleanup(); }
});

test("FAFF-604: --by model rows carry a source label and reconcile across both sources", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 500 })) + "\n");
    const cfg = withTranscripts(f.root, f.root, "sess-1", {
      "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] },
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript+engine-spend", "the census basis must name both sources");
    assert.ok(bd.rows.every((row) => row.source === "transcript-jsonl" || row.source === "exec-json-events"),
      "every model row must name where its tokens were read");
    assert.ok(bd.rows.some((row) => row.source === "exec-json-events"), "the codex lane must appear as its own row");
    assert.equal(bd.reconciliation.reconciles, true, "a mixed-fleet census must still reconcile to the top line");
  } finally { f.cleanup(); }
});

test("FAFF-604: an unmetered engine is named in economics and never counted as free", () => {
  const rc = "backends:\n  lan:\n    provider: ollama\n    model: q\n    host: http://localhost:11434\ndispatch:\n  intake:\n    model: engine:lan\n";
  const f = fixture({ rc, ledger: baseLedger() });
  try {
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.deepEqual(e.unmetered_engines, [{ engine: "lan", waived: false }]);
    assert.ok(e.warnings.some((w) => /telemetry: none/.test(w) && /lan/.test(w)),
      "the run must say its figures exclude an unobservable engine, never imply completeness");
  } finally { f.cleanup(); }
});

test("FAFF-604 REGRESSION: --by model rows carry NO source field on a transcript-only run", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript");
    assert.ok(bd.rows.length > 0);
    assert.ok(bd.rows.every((row) => !("source" in row)),
      "the byte-identical guarantee covers the absent key, not just the values");
  } finally { f.cleanup(); }
});

test("FAFF-604 REGRESSION: a partial (engine-only) cost is NAMED as partial, never reported as the run total", () => {
  // Before the seam this state reported cost_total: null — an honest unknown.
  // Reporting the engine portion alone without saying so would swap that for a
  // confident understatement, the same never-silently-zero failure in a new costume.
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ model: "claude-sonnet-5", input: 1_000_000 })) + "\n");
    // No CLAUDE_CODE_SESSION_ID → the transcript half degrades to estimate.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root]);
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    assert.ok(e.cost_total > 0, "the measured engine portion still prices");
    assert.ok(e.warnings.some((w) => /MEASURED engine-spend portion only/.test(w)),
      "a partial cost must say what it excludes — budget check warns in the identical state");
  } finally { f.cleanup(); }
});

// ---------------------------------------------------------------------------
// FAFF-640 — fold engine spend into `--by class` and `--by day` too, so both axes
// reconcile against the SAME combined population the top line and `--by model`
// already do, instead of reporting `reconciles: true` over a transcript-only
// subset. Class/day rows are aggregates by construction (unlike model rows, which
// are genuinely single-source), so every emitted row on a mixed-fleet run carries
// `source: "transcript+engine-spend"` — never per-row conditioned on whether that
// specific row happened to include engine tokens.
// ---------------------------------------------------------------------------

test("FAFF-640: --by class --json folds engine spend into every row and reconciles to the combined top line", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    // transcript: input=100 output=20  ·  engine: input=1000 output=200
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 1000, output: 200 })) + "\n");
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript+engine-spend", "the axis-level census basis must name both sources");
    const byKey = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    assert.equal(byKey.input.total, 1100, "class row totals equal transcript class counts plus engine class counts");
    assert.equal(byKey.output.total, 220);
    assert.equal(byKey.cache_write_5m.total, 0);
    assert.equal(byKey.cache_write_1h.total, 0);
    assert.equal(byKey.cache_read.total, 0);
    assert.ok(bd.rows.every((row) => row.source === "transcript+engine-spend"),
      "every emitted class row carries the mixed source, not just the axis level");
    assert.equal(bd.reconciliation.reconciles, true, "reconciles against the COMBINED top line, not a transcript-only subset");
    assert.equal(bd.reconciliation.grand_total, 1320);
    assert.equal(bd.reconciliation.top_line_total, 1320);
  } finally { f.cleanup(); }
});

test("FAFF-640: --by class priced_at_model still names only the transcript half's dominant model on a mixed run", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    // Engine model (claude-haiku-4-5) differs from the transcript's dominant model
    // (claude-opus-4-8) — priced_at_model's CONTRACT is unchanged: it names ONLY
    // the transcript half's basis, on mixed and transcript-only runs alike.
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify({ ts: "2026-08-01T00:00:00Z", engine: "seat", model: "claude-haiku-4-5", source: "exec-json-events", input: 1000, output: 0, cache_read: 0, cache_write: 0 }) + "\n");
    const cfg = withRecords(f.root, f.root, "sess-pam", {
      "sess-pam.jsonl": [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-08-01T00:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-pam" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript+engine-spend");
    assert.equal(bd.priced_at_model, "claude-opus-4-8", "priced_at_model names the transcript half's dominant model, never the engine's");
  } finally { f.cleanup(); }
});

test("FAFF-640: --by class cost sums the transcript part (at dominant model) and the engine part (at its own model), never cross-priced", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    // Transcript at claude-opus-4-8 (input $5/Mtok); engine at claude-haiku-4-5 (input $1/Mtok).
    // Built-in PRICE_PER_MTOK entries — no rc price-map override needed.
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify({ ts: "2026-08-01T00:00:00Z", engine: "seat", model: "claude-haiku-4-5", source: "exec-json-events", input: 2_000_000, output: 0, cache_read: 0, cache_write: 0 }) + "\n");
    const cfg = withRecords(f.root, f.root, "sess-rates", {
      "sess-rates.jsonl": [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 1_000_000 } }, timestamp: "2026-08-01T00:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-rates" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.priced_at_model, "claude-opus-4-8", "priced_at_model still names only the transcript half's model");
    const inputRow = bd.rows.find((x) => x.key === "input");
    assert.equal(inputRow.total, 3_000_000, "1M transcript + 2M engine");
    // transcript part: 1M tok @ $5/Mtok = $5.  engine part: 2M tok @ $1/Mtok = $2.  sum = $7.
    // NEVER 3M tok priced at either single rate ($15 at opus, $3 at haiku) — the
    // anti-cross-engine-pricing guarantee this ticket exists to enforce.
    assert.ok(Math.abs(inputRow.cost - 7) < 1e-9, `expected $7 (opus part + haiku part), got ${inputRow.cost}`);
  } finally { f.cleanup(); }
});

test("FAFF-640: --by day --json folds engine spend, including a day present only in engine spend", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    // Transcript has records on 07-01 only; engine spend lands on 07-01 AND 07-03
    // (a day the transcript never touches) — 07-03 must still appear as its own row.
    writeFileSync(join(f.runDir, "engine-spend.jsonl"), [
      JSON.stringify(econCodexRecord({ ts: "2026-07-01T09:00:00Z", input: 300 })),
      JSON.stringify(econCodexRecord({ ts: "2026-07-03T09:00:00Z", input: 40 })),
    ].join("\n") + "\n");
    const cfg = withRecords(f.root, f.root, "sess-day", {
      "sess-day.jsonl": [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-day" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    assert.equal(bd.source, "transcript+engine-spend");
    assert.deepEqual(bd.rows.map((x) => x.key), ["2026-07-01", "2026-07-03"], "rows stay sorted by day ascending; the engine-only day appears");
    const byDay = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    assert.equal(byDay["2026-07-01"].total, 400, "07-01 merges transcript (100) + engine (300)");
    assert.equal(byDay["2026-07-03"].total, 40, "07-03 is engine-only, and still appears as its own row");
    assert.ok(bd.rows.every((row) => row.source === "transcript+engine-spend"),
      "every emitted day row carries the mixed source, including the engine-only day");
    assert.equal(bd.reconciliation.reconciles, true);
    assert.equal(bd.reconciliation.grand_total, 440, "the combined top line covers both sources");
    assert.equal(bd.reconciliation.top_line_total, 440);
  } finally { f.cleanup(); }
});

test("FAFF-640: --by day includes an \"unknown\"-day engine row (missing/malformed ts) and it still counts toward the grand total", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    // ts: undefined → JSON.stringify omits the key entirely (no `ts` field at all),
    // so readEngineSpend buckets it to day "unknown".
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ ts: undefined, input: 77 })) + "\n");
    const cfg = withRecords(f.root, f.root, "sess-unknown-day", {
      "sess-unknown-day.jsonl": [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-01T10:00:00Z" },
      ],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-unknown-day" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    const byDay = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    assert.ok("unknown" in byDay, "a ts-less engine record lands in its own \"unknown\" day row");
    assert.equal(byDay.unknown.total, 77);
    assert.equal(bd.reconciliation.reconciles, true, "the unknown-day row still counts toward the grand total");
    assert.equal(bd.reconciliation.grand_total, 177);
  } finally { f.cleanup(); }
});

test("FAFF-640: --by class cost is null when the engine half carries tokens in an unpriced model, even though the transcript half is priced", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    // "unpriced-mystery-model" is in neither the built-in PRICE_PER_MTOK table nor
    // any config override — the engine part of the "input" class cannot be priced.
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify({ ts: "2026-08-01T00:00:00Z", engine: "seat", model: "unpriced-mystery-model", source: "exec-json-events", input: 500, output: 0, cache_read: 0, cache_write: 0 }) + "\n");
    const cfg = withRecords(f.root, f.root, "sess-unpriced", {
      "sess-unpriced.jsonl": [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10 } }, timestamp: "2026-08-01T00:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-unpriced" });
    assert.equal(r.code, 0, r.err);
    const bd = JSON.parse(r.out).breakdown;
    const byKey = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    assert.equal(byKey.input.total, 600, "the row STILL totals both halves — never silently dropped");
    assert.equal(byKey.input.cost, null, "cost is null, never a confident understatement of only the priceable half");
    // The output class has NO engine contribution at all, so it stays fully priceable.
    assert.ok(byKey.output.cost > 0, "a class with no unpriced engine tokens is unaffected");
  } finally { f.cleanup(); }
});

test("FAFF-640: the class-axis text header names per-engine pricing on a mixed-fleet run", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 500 })) + "\n");
    // withRecords (not withTranscripts) so the record carries a `model` — a known
    // dominant model is required for priced_at_model to be non-null, which is what
    // gates the "(priced at X ...)" header segment this note lives inside.
    const cfg = withRecords(f.root, f.root, "sess-hdr", {
      "sess-hdr.jsonl": [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-08-01T00:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-hdr" });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /# economics --by class {2}\(priced at claude-opus-4-8 · engine spend priced per engine model\)/);
  } finally { f.cleanup(); }
});

test("FAFF-640 REGRESSION: --by class and --by day carry no `source` key and reconcile unchanged on a transcript-only run", () => {
  const ledger = baseLedger({ budget: { tokens_at_start: 0 } });
  const f = fixture({ rc: null, ledger });
  try {
    const sid = "sess-640-regress";
    const cfg = withRecords(f.root, f.root, sid, {
      [`${sid}.jsonl`]: [
        { message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000 } }, timestamp: "2026-07-01T10:00:00Z" },
        { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 500 } }, timestamp: "2026-07-02T11:00:00Z" },
      ],
    });
    for (const axis of ["class", "day"]) {
      const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", axis, "--json"],
        { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: sid });
      assert.equal(r.code, 0, r.err);
      const bd = JSON.parse(r.out).breakdown;
      assert.equal(bd.source, "transcript", `--by ${axis}: source unchanged on a transcript-only run`);
      assert.ok(bd.rows.every((row) => !("source" in row)),
        `--by ${axis}: the byte-identical guarantee covers the absent key, not just the values`);
      assert.equal(bd.reconciliation.reconciles, true, `--by ${axis}: unchanged reconciliation`);
      assert.equal(bd.reconciliation.grand_total, 1685);
      assert.equal(bd.reconciliation.top_line_total, 1685);
    }
  } finally { f.cleanup(); }
});

// ---------------------------------------------------------------------------
// FAFF-641 — the `--by model` spend-source label reaches the rendered table
// (renderEconomicsBreakdown generic branch: census-basis line + source column,
// both gated on data — bd.source / has-a-row-with-`source` — never bd.axis).
// ---------------------------------------------------------------------------

function syntheticRow(over = {}) {
  return { key: "m", input: 1_000_000, output: 200_000, cache_write: 0, cache_read: 0, total: 1_200_000, cost: 0.5, ...over };
}
function syntheticBd(rows, over = {}) {
  return { axis: "model", source: "transcript", rows, reconciliation: { reconciles: true, grand_total: 1, top_line_total: 1 }, ...over };
}

const TRANSCRIPT_ONLY_HEADER =
  `  ${"key".padEnd(22)} ${"input".padStart(9)} ${"output".padStart(9)} ${"cache_wr".padStart(9)} ${"cache_rd".padStart(9)} ${"total".padStart(9)} ${"cost".padStart(10)}`;

test("FAFF-641 UNIT: no row carries a source — output is byte-identical to the pre-change renderer (no column, no census line)", () => {
  const bd = syntheticBd([syntheticRow()]);
  const out = renderEconomicsBreakdown(bd);
  const lines = out.split("\n");
  assert.equal(lines[0], "# economics --by model");
  assert.equal(lines[1], TRANSCRIPT_ONLY_HEADER, "column-header line must equal today's exact string");
  assert.ok(!out.includes("spend census:"), "the census-basis line must be absent when bd.source === \"transcript\"");
});

test("FAFF-641 UNIT: a row with source:\"transcript-jsonl\" renders \"transcript\"; \"exec-json-events\" renders \"engine\"", () => {
  const bd = syntheticBd(
    [syntheticRow({ key: "claude", source: "transcript-jsonl" }), syntheticRow({ key: "gpt-5-codex", source: "exec-json-events" })],
    { source: "transcript+engine-spend" },
  );
  const out = renderEconomicsBreakdown(bd);
  assert.match(out, /source {4}/, "the column header must appear, left-aligned width 10");
  assert.match(out, /claude.*transcript\s*$/m);
  assert.match(out, /gpt-5-codex.*engine\s*$/m);
  assert.ok(out.includes("spend census: transcript+engine-spend"), "the basis sentence must name bd.source");
});

test("FAFF-641 UNIT (spec-review objection 2): a mixed census with no row-level source prints the basis sentence but no orphaned legend/column", () => {
  const bd = syntheticBd([syntheticRow({ key: "m" })], { source: "transcript+engine-spend" });
  const out = renderEconomicsBreakdown(bd);
  assert.ok(out.includes("spend census: transcript+engine-spend"), "the basis sentence prints on bd.source != \"transcript\" independently");
  assert.ok(!out.includes("source column:"), "the abbreviation legend must NOT print when no row carries a source");
  assert.ok(!/\bsource\s{4}/.test(out), "no source column header when has_source is false");
});

test("FAFF-641 UNIT: a mixed row (source:\"transcript+engine-spend\") renders \"mixed\"", () => {
  const bd = syntheticBd([syntheticRow({ key: "class-a", source: "transcript+engine-spend" })], { axis: "class", source: "transcript+engine-spend" });
  const out = renderEconomicsBreakdown(bd);
  assert.match(out, /class-a.*mixed\s*$/m);
});

test("FAFF-641 UNIT: an unrecognised source string reaches the reader verbatim, truncated to the column width", () => {
  const bd = syntheticBd([syntheticRow({ key: "m", source: "some-future-lane-token" })], { source: "some-future-lane-token" });
  const out = renderEconomicsBreakdown(bd);
  // "some-future-lane-token" truncated to 10 chars = "some-futur"
  const dataLine = out.split("\n").find((l) => l.trim().startsWith("m "));
  assert.match(dataLine, /some-futur\s*$/, "unknown source must render verbatim (truncated), never blank or dropped");
});

test("FAFF-641 UNIT: a row with no `source` key, inside a table that shows the column, renders \"—\"", () => {
  const bd = syntheticBd(
    [syntheticRow({ key: "has-src", source: "transcript-jsonl" }), syntheticRow({ key: "no-src" })],
    { source: "transcript+engine-spend" },
  );
  const out = renderEconomicsBreakdown(bd);
  assert.match(out, /no-src.*—\s*$/m, "a source-less row in a source-bearing table must render the em-dash placeholder");
});

test("FAFF-641 UNIT: the source === \"estimate\" early return is untouched (no column, no crash on rows:[])", () => {
  const bd = { axis: "model", source: "estimate", rows: [] };
  const out = renderEconomicsBreakdown(bd);
  assert.match(out, /source:estimate, no breakdown/);
});

test("FAFF-641 UNIT: rendered data rows stay at or under 96 characters", () => {
  const bd = syntheticBd([syntheticRow({ key: "a-very-long-model-name-that-truncates", source: "transcript-jsonl" })], { source: "transcript+engine-spend" });
  const out = renderEconomicsBreakdown(bd);
  const dataLine = out.split("\n").find((l) => l.includes("a-very-long-model-name"));
  assert.ok(dataLine.length <= 96, `row was ${dataLine.length} chars: ${JSON.stringify(dataLine)}`);
});

test("FAFF-641 INTEGRATION: mixed-fleet --by model (no --json) shows the source column with transcript/engine labels", () => {
  const f = fixture({ rc: ECON_MIXED_RC, ledger: baseLedger() });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 500 })) + "\n");
    const cfg = withTranscripts(f.root, f.root, "sess-1", {
      "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] },
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    assert.throws(() => JSON.parse(r.out), "table output is not JSON");
    assert.match(r.out, /source\s+$/m, "the source column header must appear");
    assert.match(r.out, /transcript\s*$/m, "a transcript-jsonl row must render \"transcript\"");
    assert.match(r.out, /engine\s*$/m, "an exec-json-events row must render \"engine\"");
    assert.ok(r.out.includes("spend census: transcript+engine-spend"), "the census-basis line must name the mixed basis");
    // The 96-char bound applies to rendered DATA rows, not the census-basis summary line.
    const dataLines = r.out.split("\n").filter((l) => /^  \S.*\d/.test(l) && !l.startsWith("  spend census"));
    assert.ok(dataLines.length > 0, "expected at least one data row");
    for (const line of dataLines) assert.ok(line.length <= 96, `row exceeded 96 chars: ${JSON.stringify(line)}`);
  } finally { f.cleanup(); }
});

test("FAFF-641 REGRESSION: a transcript-only --by model table renders byte-identical to the pre-change output", () => {
  const f = fixture({ rc: null, ledger: baseLedger() });
  try {
    const cfg = withTranscripts(f.root, f.root, "sess-1", { "sess-1.jsonl": { usage: [{ input_tokens: 100, output_tokens: 20 }] } });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const lines = r.out.split("\n");
    assert.equal(lines[0], "# economics --by model");
    assert.equal(lines[1], TRANSCRIPT_ONLY_HEADER);
    assert.ok(!r.out.includes("spend census:"), "no census-basis line on a single-source run");
    assert.ok(!/\bsource\s*$/m.test(lines[1]), "no source column header on a single-source run");
  } finally { f.cleanup(); }
});

// ---------------------------------------------------------------------------
// FAFF-933 — a run resumed across epochs reports WHOLE-RUN spend, not just the
// resuming epoch's. `budget check` already sums Σ closed prior-epoch spans + the
// open span (FAFF-527/560/594); economics was deliberately left out of that
// mechanism and so silently dropped every earlier epoch. These pin the fix
// end-to-end through the CLI over a synthetic 2-epoch ledger fixture (the shape
// `test/budget.test.mjs`'s FAFF-594 resume case uses), never the ticket's
// illustrative dollar figures.
// ---------------------------------------------------------------------------

// A closed prior-epoch span: `closed_delta_by_model_class` non-null is what makes
// it "closed" (and so a PRIOR epoch), independent of the delta's magnitude.
const closedSpan = (sid, model, counts, over = {}) => ({
  session_id: sid,
  baseline_by_model_class: {},
  closed_at: "2026-08-29T13:34:00Z",
  close_source: "transcript",
  closed_delta_by_model_class: { [model]: { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, ...counts } },
  ...over,
});
// The resuming epoch: exactly one span with a null delta is the open span.
const openSpan = (sid, over = {}) => ({
  session_id: sid, baseline_by_model_class: {}, closed_at: null, close_source: null,
  closed_delta_by_model_class: null, ...over,
});
// The canonical 2-epoch fixture: epoch-0 closed at 500 tokens, epoch-1 open.
const twoEpochLedger = (sessions) => baseLedger({ budget: { tokens_at_start: 0, sessions } });
const EPOCH0_500 = closedSpan("epoch-0", "claude-opus-4-8", { input: 400, output: 100 });

test("FAFF-933 INTEGRATION: a resumed 2-epoch run reports the RUN-scoped total (closed 500 + open 100 = 600), not the resuming epoch's 100 alone", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript");
    // The regression this ticket exists to close: a pre-fix economics reported 100.
    assert.equal(e.tokens_total, 600, "closed prior-epoch span must be folded into the run total");
  } finally { f.cleanup(); }
});

test("FAFF-933: session PRECEDENCE meters the open span's own session — a resumed run is correct with NO ambient CLAUDE_CODE_SESSION_ID set", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    // No CLAUDE_CODE_SESSION_ID — pre-fix this fell through to the ambient (absent)
    // session and degraded to the estimate path, losing the measurement entirely.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"], { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript", "the open span's session_id is the meter target, not the ambient env");
    assert.equal(e.tokens_total, 600);
  } finally { f.cleanup(); }
});

test("FAFF-933 INTEGRATION: economics and `budget check` agree on tokens across the resume boundary — the two governance surfaces no longer disagree by the dropped epochs", () => {
  const rc = "budget:\n  tokens: 100000\n";
  const sessions = [EPOCH0_500, openSpan("epoch-1")];
  const a = fixture({ rc, ledger: twoEpochLedger(sessions) });
  try {
    const cfg = withRecords(a.root, a.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const env = { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" };
    const re = run(["economics", "--run-dir", a.runDir, "--root", a.root, "--json"], env);
    const rb = run(["budget", "check", "--run-dir", a.runDir, "--root", a.root], env);
    assert.equal(re.code, 0, re.err);
    assert.equal(rb.code, 0, rb.err);
    const e = JSON.parse(re.out);
    const b = JSON.parse(rb.out);
    assert.equal(b.spent.tokens, 600, "budget check's own cross-epoch total (the reference)");
    assert.equal(e.tokens_total, b.spent.tokens, "economics must match budget check on the same resumed run");
  } finally { a.cleanup(); }
});

test("FAFF-933 PARITY: a single-session run (no budget.sessions, or one all-open span) is byte-for-byte unchanged — no rebaseline, no fold, no resumed-run warning", () => {
  const rc = null;
  const noSessions = fixture({ rc, ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  const allOpen = fixture({ rc, ledger: twoEpochLedger([openSpan("sess-1")]) });
  try {
    const recs = { "sess-1.jsonl": [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 50 } }, timestamp: "2026-07-01T10:00:00Z" }] };
    const cfgA = withRecords(noSessions.root, noSessions.root, "sess-1", recs);
    const cfgB = withRecords(allOpen.root, allOpen.root, "sess-1", recs);
    const rA = run(["economics", "--run-dir", noSessions.runDir, "--root", noSessions.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfgA, CLAUDE_CODE_SESSION_ID: "sess-1" });
    const rB = run(["economics", "--run-dir", allOpen.runDir, "--root", allOpen.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfgB, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(rA.code, 0, rA.err);
    assert.equal(rB.code, 0, rB.err);
    // Both fixtures carry the same run_id and the same draw, so a sessions array
    // holding only an OPEN span must produce the identical bytes — it is a fresh
    // single-epoch run merely recorded in the newer shape, nothing dropped.
    assert.equal(rB.out, rA.out, "an all-open sessions array must not change a single-session run's output");
    const e = JSON.parse(rA.out);
    assert.equal(e.tokens_total, 150);
    assert.ok(!e.warnings.some((w) => /resumed run/.test(w)), "no resumed-run warning on a single-session run");
  } finally { noSessions.cleanup(); allOpen.cleanup(); }
});

test("FAFF-933 INTEGRATION: --by model folds the closed span ROW-FOR-ROW and reconciles to the epoch-spanning top line; the earlier epoch's model is not lost", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 600);
    const bd = e.breakdown;
    assert.equal(bd.axis, "model");
    assert.equal(bd.reconciliation.grand_total, 600);
    assert.equal(bd.reconciliation.top_line_total, 600);
    assert.equal(bd.reconciliation.reconciles, true, "the model axis must reconcile after the closed-span fold");
    const byKey = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    // epoch-0's model appears ONLY in the closed span — a fold that skipped it
    // would count its 500 tokens in the top line while hiding them in the rows.
    assert.ok(byKey["claude-opus-4-8"], "the closed span's model must appear as a row");
    assert.equal(byKey["claude-opus-4-8"].total, 500);
    assert.equal(byKey["claude-sonnet-4-6"].total, 100);
  } finally { f.cleanup(); }
});

test("FAFF-933 INTEGRATION: --by class folds the closed span via the model->class projection (summed across models) and reconciles to the epoch-spanning top line", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    const bd = e.breakdown;
    assert.equal(bd.axis, "class");
    assert.equal(bd.reconciliation.grand_total, 600);
    assert.equal(bd.reconciliation.top_line_total, 600);
    assert.equal(bd.reconciliation.reconciles, true, "the class axis must reconcile after the model->class projection fold");
    const byKey = Object.fromEntries(bd.rows.map((x) => [x.key, x]));
    // The class axis has no model rows: epoch-0's 400 input / 100 output are summed
    // ACROSS models into the per-class rows alongside the open span's 80 / 20.
    assert.equal(byKey.input.total, 480);
    assert.equal(byKey.output.total, 120);
  } finally { f.cleanup(); }
});

test("FAFF-933 INTEGRATION: --by day does NOT fold (no per-day granularity in a closed span) and NAMES its epoch-scoping in a warning — never a silent drop", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 600, "the top line still spans epochs");
    assert.ok(e.warnings.some((w) => /resumed run: per-day\/mcp\/phase/.test(w) && /1 prior epoch\(s\) not reconciled/.test(w)),
      `expected the per-day coverage warning naming the prior epoch count, got ${JSON.stringify(e.warnings)}`);
    // The day axis still reconciles against the population IT measures (the
    // resuming epoch), which is exactly what docs/guide/cli.md now promises.
    assert.equal(e.breakdown.reconciliation.grand_total, 100);
    assert.equal(e.breakdown.reconciliation.top_line_total, 100);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
  } finally { f.cleanup(); }
});

test("FAFF-933 INTEGRATION: the estimate fallback does NOT fold a measured span sum into a per-attempt estimate, but NAMES the prior epochs it cannot reconcile", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    // The resuming epoch's transcript is gone (no epoch-1.jsonl) — but the prior
    // epoch's durable ledger delta is not, so the drop must still be named.
    const cfg = withRecords(f.root, f.root, "epoch-1", {});
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    // 1 attempt x the 200000 default — the closed span's 500 is NOT mixed in
    // (a measured token sum and a per-attempt estimate are different units).
    assert.equal(e.tokens_total, 200000);
    assert.ok(e.warnings.some((w) => /resumed run on the estimate fallback/.test(w) && /1 prior epoch\(s\)/.test(w) && /budget check/.test(w)),
      `expected the estimate-path coverage warning, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933 INTEGRATION: a ZERO-delta closed span still fires the coverage warning — the gate is the PRESENCE of a prior epoch, never closed_span_total > 0", () => {
  const zeroSpan = closedSpan("epoch-0", "m1", {});   // every class 0 -> closedSpend.total === 0
  const f = fixture({ rc: null, ledger: twoEpochLedger([zeroSpan, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_total, 100, "a zero-delta span adds nothing to the top line");
    assert.ok(e.warnings.some((w) => /resumed run: per-day\/mcp\/phase/.test(w)),
      `a zero-delta prior epoch must NOT suppress the coverage warning, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: the tokens_at_start=0 inflation warning is SUPPRESSED on a resumed run (the total is a measured composition, not a naive whole-session sum)", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.ok(!e.warnings.some((w) => /inflated by prior-session history/.test(w)),
      `the inflation warning must not fire on a resumed run, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: a single-session run with tokens_at_start=0 STILL emits the inflation warning — the refinement narrows it, never removes it", () => {
  const f = fixture({ rc: null, ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  try {
    const cfg = withRecords(f.root, f.root, "sess-1", {
      "sess-1.jsonl": [{ message: { model: "claude-opus-4-8", usage: { input_tokens: 100 } }, timestamp: "2026-07-01T10:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.ok(e.warnings.some((w) => /inflated by prior-session history/.test(w)),
      `the single-session inflation case must be unchanged, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: a folded span measured with a DEGRADED basis (close_source != transcript) raises a provenance warning naming it", () => {
  const degraded = closedSpan("epoch-0", "claude-opus-4-8", { input: 400, output: 100 }, { close_source: "degraded" });
  const f = fixture({ rc: null, ledger: twoEpochLedger([degraded, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    // The delta is still folded (it is the best available measure) — only its
    // BASIS is named, so the reader can see why the figure may under-count.
    assert.equal(e.tokens_total, 600);
    assert.ok(e.warnings.some((w) => /degraded basis/.test(w) && /epoch-0/.test(w)),
      `expected the degraded-provenance warning, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: --session-id still OVERRIDES the open span's session (the FAFF-488 contract is preserved at the top of the precedence)", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "other-sess", {
      "other-sess.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 70 } }, timestamp: "2026-08-29T15:00:00Z" }],
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--session-id", "other-sess", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript");
    // 70 from the flag-named session (NOT epoch-1's 100) + the closed span's 500.
    assert.equal(e.tokens_total, 570, "the explicit flag must win over the open span's session_id");
  } finally { f.cleanup(); }
});

test("FAFF-933: the OPEN span's baseline rebaselines the subtraction — a stale mint tokens_at_start no longer governs a resumed run", () => {
  // The mint-time scalar (999999) is stale the instant a resume happens; the open
  // span's own baseline (30) was measured at the resume instant against the session
  // being metered. Without the rebaseline, max(0, 100 - 999999) + 500 would report
  // 500; with it, max(0, 100 - 30) + 500 reports 570 — so the number distinguishes
  // the two implementations rather than passing under either.
  const open = openSpan("epoch-1", { baseline_by_model_class: { "claude-sonnet-4-6": { input: 30, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 } } });
  const f = fixture({ rc: null, ledger: baseLedger({ budget: { tokens_at_start: 999999, sessions: [EPOCH0_500, open] } }) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "transcript");
    assert.equal(e.tokens_total, 570, "the open span's baseline must replace the stale mint baseline");
  } finally { f.cleanup(); }
});

test("FAFF-933: cost_total spans epochs too — the map-priced per-model delta folds the closed span, each model at its OWN rate", () => {
  // epoch-0 closed: 1 MTok of opus input at $5/MTok = $5.
  // epoch-1 open:   2 MTok of sonnet input at $3/MTok = $6.
  // Run-scoped cost is $11; an epoch-scoped cost would report $6 and a
  // cross-priced fold would report neither.
  const closed = closedSpan("epoch-0", "claude-opus-4-8", { input: 1_000_000 });
  const f = fixture({ rc: null, ledger: twoEpochLedger([closed, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 2_000_000 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.pricing, "map");
    assert.equal(e.tokens_total, 3_000_000);
    assert.ok(Math.abs(e.cost_total - 11) < 1e-6, `expected the epoch-spanning cost 11, got ${e.cost_total}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: --by mcp carries the same presence-gated coverage warning as --by day (the gate is the axis set, not one axis)", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "mcp", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.ok(e.warnings.some((w) => /resumed run: per-day\/mcp\/phase/.test(w)),
      `expected the coverage warning on the mcp axis too, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933: a resumed run NAMES its composition (closed_span_total / closed_span_count); a single-session run emits neither key", () => {
  const resumed = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  const single = fixture({ rc: null, ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  try {
    const recs = { "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }] };
    const cfgR = withRecords(resumed.root, resumed.root, "epoch-1", recs);
    const rR = run(["economics", "--run-dir", resumed.runDir, "--root", resumed.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfgR, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(rR.code, 0, rR.err);
    const eR = JSON.parse(rR.out);
    assert.equal(eR.closed_span_total, 500, "how much of the total came from earlier epochs is reported, not left to inference");
    assert.equal(eR.closed_span_count, 1);

    const cfgS = withRecords(single.root, single.root, "sess-1", {
      "sess-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const rS = run(["economics", "--run-dir", single.runDir, "--root", single.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfgS, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(rS.code, 0, rS.err);
    const eS = JSON.parse(rS.out);
    assert.ok(!("closed_span_total" in eS), "a single-session run must not grow a new key");
    assert.ok(!("closed_span_count" in eS), "a single-session run must not grow a new key");
  } finally { resumed.cleanup(); single.cleanup(); }
});

test("FAFF-933: the census basis names EVERY contributing source — a mixed-fleet resumed run says transcript+engine-spend+closed-spans, not just the engine half", () => {
  const require2 = createRequire(import.meta.url);
  const { economicsBreakdown } = require2("../plugin/skills/faff/bin/lib/economics.js");
  const { resolveEconomicsPriceMap } = require2("../plugin/skills/faff/bin/lib/budget.js");
  const pm = resolveEconomicsPriceMap({});
  const recs = [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100 } }, timestamp: "2026-08-29T15:00:00Z" }];
  const engine = { by_model: new Map([["gpt-5-codex", { input: 50, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 }]]), by_day: new Map() };
  const closed = new Map([["claude-opus-4-8", { input: 400, output: 100, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 }]]);

  const both = economicsBreakdown(recs, "class", pm, 100, engine, closed);
  assert.equal(both.source, "transcript+engine-spend+closed-spans", "a folded census must never go unnamed");
  assert.equal(both.rows.find((r) => r.key === "input").source, "transcript+engine-spend+closed-spans");
  assert.equal(both.reconciliation.grand_total, 650);
  assert.equal(both.reconciliation.reconciles, true);

  // Back-compatibility: every previously-emitted value is unchanged.
  assert.equal(economicsBreakdown(recs, "class", pm, 100, engine, null).source, "transcript+engine-spend");
  assert.equal(economicsBreakdown(recs, "class", pm, 100, null, closed).source, "transcript+closed-spans");
  assert.equal(economicsBreakdown(recs, "class", pm, 100, null, null).source, "transcript");
  // The day axis never folds closed spans, so its basis must NOT claim them.
  assert.equal(economicsBreakdown(recs, "day", pm, 100, null, closed).source, "transcript");
});

test("FAFF-933 (adversarial A1): --by effort gets its OWN truthful warning — its events.jsonl substrate is run-scoped, so it is never described as resuming-epoch-only", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    // events.jsonl is RUN-scoped: a resume keeps appending to the SAME file, so
    // epoch-0's effort-tagged dispatch is still here next to epoch-1's.
    writeFileSync(join(f.runDir, "events.jsonl"), [
      { schema: 1, run_id: "run-test", seq: 0, ts: "2026-08-29T10:00:00Z", type: "run-start", data: {} },
      { schema: 1, run_id: "run-test", seq: 1, ts: "2026-08-29T11:00:00Z", type: "issue-outcome", issue: "FAFF-1", data: { effort: "high", tokens: { input: 400, output: 100, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
      { schema: 1, run_id: "run-test", seq: 2, ts: "2026-08-29T15:00:00Z", type: "issue-outcome", issue: "FAFF-1", data: { effort: "low", tokens: { input: 80, output: 20, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
    ].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    // The effort rows DO span epochs — epoch-0's `high` dispatch is present — which is
    // exactly why calling them resuming-epoch-only would be a false statement.
    const keys = e.breakdown.rows.map((x) => x.key);
    assert.ok(keys.includes("high"), `epoch-0's effort bucket must be present, got ${JSON.stringify(keys)}`);
    assert.equal(e.breakdown.reconciliation.events_token_total, 600);
    assert.ok(!e.warnings.some((w) => /per-day\/mcp\/phase/.test(w) && /effort/.test(w)),
      "effort must NOT be lumped into the transcript-derived axes' resuming-epoch-only claim");
    assert.ok(e.warnings.some((w) => /--by effort axis reads the run-scoped events\.jsonl/.test(w) && /coverage_pct is not meaningful/.test(w)),
      `expected the effort-specific truthful warning, got ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial A1): a transcript-derived fine axis keeps the resuming-epoch-only wording, now without naming effort", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    const w = e.warnings.find((x) => /resuming epoch only/.test(x));
    assert.ok(w, `expected the coverage warning, got ${JSON.stringify(e.warnings)}`);
    assert.match(w, /per-day\/mcp\/phase/);
    assert.ok(!/effort/.test(w), "the transcript-derived axes' warning must no longer claim effort");
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial A2): a model row that absorbed closed-span deltas names the composition, never bare transcript-jsonl", () => {
  // epoch-0's closed span shares a model with the open span's transcript AND carries
  // one the transcript never saw, so both merged and closed-only rows are exercised.
  const shared = closedSpan("epoch-0", "claude-sonnet-4-6", { input: 300 });
  shared.closed_delta_by_model_class["claude-opus-4-8"] = { input: 200, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 };
  const f = fixture({ rc: null, ledger: twoEpochLedger([shared, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    const byKey = Object.fromEntries(e.breakdown.rows.map((x) => [x.key, x]));
    assert.equal(byKey["claude-sonnet-4-6"].total, 400, "100 transcript + 300 closed");
    assert.equal(byKey["claude-sonnet-4-6"].source, "transcript-jsonl+closed-spans",
      "a merged row must not claim to be pure transcript");
    assert.equal(byKey["claude-opus-4-8"].total, 200);
    assert.equal(byKey["claude-opus-4-8"].source, "closed-spans",
      "a model seen only in an earlier epoch is closed-spans alone");
    assert.equal(e.tokens_total, 600);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial A2): a single-session transcript-only model breakdown still emits NO per-row source key", () => {
  const f = fixture({ rc: null, ledger: baseLedger({ budget: { tokens_at_start: 0 } }) });
  try {
    const cfg = withRecords(f.root, f.root, "sess-1", {
      "sess-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 100 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "sess-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.ok(!("source" in e.breakdown.rows[0]), "the byte-identical guarantee: no new per-row key");
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial B2): on a resumed mixed-fleet run, spend_sources gives the closed spans their own row, so the transcript row's cost covers only its own tokens", () => {
  const closed = closedSpan("epoch-0", "claude-opus-4-8", { input: 1_000_000 });
  const f = fixture({ rc: ECON_MIXED_RC, ledger: twoEpochLedger([closed, openSpan("epoch-1")]) });
  try {
    writeFileSync(join(f.runDir, "engine-spend.jsonl"),
      JSON.stringify(econCodexRecord({ input: 1000, output: 200 })) + "\n");
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 2_000_000 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    const src = Object.fromEntries(e.spend_sources.map((x) => [x.source, x]));
    assert.equal(src["transcript-jsonl"].tokens, 2_000_000);
    assert.ok(Math.abs(src["transcript-jsonl"].cost - 6) < 1e-6, `transcript row must carry only its own $6, got ${src["transcript-jsonl"].cost}`);
    assert.equal(src["closed-spans"].tokens, 1_000_000);
    assert.ok(Math.abs(src["closed-spans"].cost - 5) < 1e-6, `closed-spans row must carry the prior epoch's $5, got ${src["closed-spans"].cost}`);
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial B3): the class-axis header names closed-span pricing when the census includes it", () => {
  const bd = syntheticBd([syntheticRow({ key: "input", source: "transcript+closed-spans" })],
    { axis: "class", source: "transcript+closed-spans", priced_at_model: "claude-sonnet-4-6" });
  const first = renderEconomicsBreakdown(bd).split("\n")[0];
  assert.match(first, /prior-epoch spans priced per their own model/);
  assert.doesNotMatch(first, /engine spend priced per engine model/);
  const both = syntheticBd([syntheticRow({ key: "input", source: "transcript+engine-spend+closed-spans" })],
    { axis: "class", source: "transcript+engine-spend+closed-spans", priced_at_model: "claude-sonnet-4-6" });
  const bothFirst = renderEconomicsBreakdown(both).split("\n")[0];
  assert.match(bothFirst, /engine spend priced per engine model/);
  assert.match(bothFirst, /prior-epoch spans priced per their own model/);
});

test("FAFF-933 (adversarial B4): on the estimate path no fine-axis breakdown exists, so only the estimate warning fires, not the per-day one", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {});
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    assert.ok(e.warnings.some((w) => /resumed run on the estimate fallback/.test(w)), JSON.stringify(e.warnings));
    assert.ok(!e.warnings.some((w) => /per-day\/mcp\/phase/.test(w)), `the fine-axis warning must not fire on the estimate path: ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
});

test("FAFF-933 (adversarial C1): the effort warning stays silent when there are no effort rows, and on the estimate path", () => {
  const effortWarn = (w) => /--by effort axis reads the run-scoped events\.jsonl/.test(w);
  // No events.jsonl and no engine spend: the effort breakdown is empty, so there are no rows to describe.
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.breakdown.rows.length, 0);
    assert.ok(!e.warnings.some(effortWarn), `no rows, so no effort warning: ${JSON.stringify(e.warnings)}`);
  } finally { f.cleanup(); }
  // Estimate path with events present: the top line spans no epochs, so the effort warning would contradict the estimate warning.
  const g = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    writeFileSync(join(g.runDir, "events.jsonl"), [
      { schema: 1, run_id: "run-test", seq: 0, ts: "2026-08-29T10:00:00Z", type: "run-start", data: {} },
      { schema: 1, run_id: "run-test", seq: 1, ts: "2026-08-29T11:00:00Z", type: "issue-outcome", issue: "FAFF-1", data: { effort: "high", tokens: { input: 400, output: 100, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const cfg = withRecords(g.root, g.root, "epoch-1", {});
    const r = run(["economics", "--run-dir", g.runDir, "--root", g.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: "epoch-1" });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    assert.equal(e.tokens_source, "estimate");
    assert.ok(e.warnings.some((w) => /resumed run on the estimate fallback/.test(w)), JSON.stringify(e.warnings));
    assert.ok(!e.warnings.some(effortWarn), `estimate path must not claim the top line spans epochs: ${JSON.stringify(e.warnings)}`);
  } finally { g.cleanup(); }
});

// ---------------------------------------------------------------------------
// FAFF-1380 — `--by` breakdowns must read `effectiveEnv` (the FAFF-560-resolved
// session), not ambient `process.env`, at the `--by effort` call site
// (economics.js:1564) and the generic class/model/day/mcp call site
// (economics.js:1589). The `--by phase` branch already did this; these tests
// are its no-ambient-session siblings for the other axes. Each fixture below
// is the canonical FAFF-933 resumed 2-epoch ledger (EPOCH0_500 closed + an
// open span) with NO `CLAUDE_CODE_SESSION_ID` in the test environment — the
// resumed-but-no-ambient-session case the top-line-only FAFF-933 precedence
// test (above) never exercises with a `--by` flag. Pre-fix, `process.env`
// resolves to no session at all here, so every one of these assertions fails
// against the un-patched code (confirmed via the pre-fix baseline run noted
// in the issue's prep findings). Per the spec-review-revised DONE section,
// day/mcp/effort never fold a closed span (FAFF-933, out of scope here), so
// their assertions target the field the fix actually changes for that axis,
// not a templated "closed-span tokens in the rows" claim that is false by
// design for those three.
// ---------------------------------------------------------------------------

test("FAFF-1380: --by class and --by model fold the closed span and reconcile to the epoch-spanning total with NO ambient session set", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    // No CLAUDE_CODE_SESSION_ID — the regression this ticket closes.
    const rModel = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(rModel.code, 0, rModel.err);
    const eModel = JSON.parse(rModel.out);
    assert.equal(eModel.breakdown.reconciliation.reconciles, true,
      `model axis must reconcile against the epoch-spanning total with no ambient session, got ${JSON.stringify(eModel.breakdown.reconciliation)}`);
    assert.equal(eModel.breakdown.reconciliation.grand_total, 600);
    const byKey = Object.fromEntries(eModel.breakdown.rows.map((x) => [x.key, x]));
    assert.ok(byKey["claude-opus-4-8"], "the closed span's model must appear as a row");
    assert.equal(byKey["claude-opus-4-8"].total, 500);

    const rClass = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "class", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(rClass.code, 0, rClass.err);
    const eClass = JSON.parse(rClass.out);
    assert.equal(eClass.breakdown.reconciliation.reconciles, true,
      `class axis must reconcile against the epoch-spanning total with no ambient session, got ${JSON.stringify(eClass.breakdown.reconciliation)}`);
    assert.equal(eClass.breakdown.reconciliation.grand_total, 600);
  } finally { f.cleanup(); }
});

test("FAFF-1380: --by day reads the open span's transcript (not empty) with NO ambient session set, reconciling against the resuming-epoch-only total", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "day", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    // `day` never folds the closed span (out of scope, FAFF-933) — its own
    // reconciliation target is the resuming-epoch-only total (100), not the
    // run-scoped tokens_total (600). Pre-fix: no records read -> grand_total 0.
    assert.equal(e.breakdown.reconciliation.grand_total, 100,
      `pre-fix this reads 0 (no records under no ambient session); got ${JSON.stringify(e.breakdown.reconciliation)}`);
    assert.equal(e.breakdown.reconciliation.top_line_total, 100);
    assert.equal(e.breakdown.reconciliation.reconciles, true);
  } finally { f.cleanup(); }
});

test("FAFF-1380: --by mcp carries the open span's tool-call rows with NO ambient session set (reconciles is a vacuous zero-row identity, never the discriminator)", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{
        message: {
          model: "claude-sonnet-4-6",
          usage: { input_tokens: 80, output_tokens: 20 },
          content: [{ type: "tool_use", id: "tu-1", name: "mcp__linear__get_issue", input: { id: "FAFF-1" } }],
        },
        timestamp: "2026-08-29T15:00:00Z",
      }, {
        message: { content: [{ type: "tool_result", tool_use_id: "tu-1", content: "ok" }] },
        timestamp: "2026-08-29T15:00:01Z",
      }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "mcp", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    // Do NOT assert reconciliation.reconciles — it holds trivially (0 === 0) over
    // zero rows too, so it is true both pre- and post-fix and proves nothing.
    assert.equal(e.breakdown.rows.length, 1,
      `pre-fix this reads 0 rows (no records under no ambient session); got ${JSON.stringify(e.breakdown.rows)}`);
    const row = e.breakdown.rows[0];
    assert.equal(row.tool, "linear__get_issue");
    assert.equal(row.call_count, 1);
    assert.ok(row.request_bytes > 0, "request_bytes must be non-zero");
    assert.ok(row.response_bytes > 0, "response_bytes must be non-zero");
  } finally { f.cleanup(); }
});

test("FAFF-1380: --by effort resolves the real dominant model and a priced row with NO ambient session set (events_token_total is NOT the discriminator)", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    writeFileSync(join(f.runDir, "events.jsonl"), [
      { schema: 1, run_id: "run-test", seq: 0, ts: "2026-08-29T10:00:00Z", type: "run-start", data: {} },
      { schema: 1, run_id: "run-test", seq: 1, ts: "2026-08-29T15:00:00Z", type: "issue-outcome", issue: "FAFF-1", data: { effort: "low", tokens: { input: 80, output: 20, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
    ].map((x) => JSON.stringify(x)).join("\n") + "\n");
    const cfg = withRecords(f.root, f.root, "epoch-1", {
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--by", "effort", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    // Do NOT assert reconciliation.events_token_total/top_line_total — both derive
    // from events.jsonl and the already-correct top-line measuredTotal, unchanged
    // by this fix. The dominant model + priced row are what the fix changes.
    assert.equal(e.breakdown.priced_at_model, "claude-sonnet-4-6",
      `pre-fix this is null (no records read under no ambient session); got ${JSON.stringify(e.breakdown)}`);
    const lowRow = e.breakdown.rows.find((x) => x.key === "low");
    assert.ok(lowRow, `expected a "low" effort row, got ${JSON.stringify(e.breakdown.rows)}`);
    assert.notEqual(lowRow.cost, null, "pre-fix every row's cost is unpriced (null) with no dominant model resolved");
  } finally { f.cleanup(); }
});

test("FAFF-1380: --session-id selects the breakdown's transcript too, not just the top line's, with NO ambient session set", () => {
  const f = fixture({ rc: null, ledger: twoEpochLedger([EPOCH0_500, openSpan("epoch-1")]) });
  try {
    // other-sess's model (haiku) is deliberately distinct from both EPOCH0_500's
    // closed-span model (opus — folded into the model axis regardless of which
    // transcript the open half reads) and epoch-1's own model (sonnet), so the
    // row this test checks cannot be confused with either.
    const cfg = withRecords(f.root, f.root, "other-sess", {
      "other-sess.jsonl": [{ message: { model: "claude-haiku-4-5", usage: { input_tokens: 70 } }, timestamp: "2026-08-29T15:00:00Z" }],
      "epoch-1.jsonl": [{ message: { model: "claude-sonnet-4-6", usage: { input_tokens: 80, output_tokens: 20 } }, timestamp: "2026-08-29T15:00:00Z" }],
    });
    // No ambient CLAUDE_CODE_SESSION_ID at all — only the --session-id flag names
    // the session. Pre-fix, both patched branches ignored the flag and fell
    // through to the (absent) ambient session, reading no records at all.
    const r = run(["economics", "--run-dir", f.runDir, "--root", f.root, "--session-id", "other-sess", "--by", "model", "--json"],
      { CLAUDE_CONFIG_DIR: cfg });
    assert.equal(r.code, 0, r.err);
    const e = JSON.parse(r.out);
    const byKey = Object.fromEntries(e.breakdown.rows.map((x) => [x.key, x]));
    // other-sess's model (haiku, 70 tokens) must appear — NOT epoch-1's sonnet
    // row, which would mean the flag was ignored in favour of the (absent)
    // ambient env. The closed span's own model (opus, 500) still folds in
    // regardless (FAFF-933, unaffected by this fix) — mirrors the existing
    // FAFF-933 --session-id override test's 500+70=570 top-line total.
    assert.ok(byKey["claude-haiku-4-5"], `expected other-sess's model row, got ${JSON.stringify(e.breakdown.rows)}`);
    assert.equal(byKey["claude-haiku-4-5"].total, 70);
    assert.ok(!byKey["claude-sonnet-4-6"], "the open span's own session must NOT be read once --session-id overrides it");
    assert.equal(e.breakdown.reconciliation.grand_total, 570);
  } finally { f.cleanup(); }
});
