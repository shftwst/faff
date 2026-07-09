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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    assert.equal(e.cost_total, 20);         // 4M/1e6 * 5
    assert.equal(e.cost_per_shipped.cost_each, 20);
    assert.deepEqual(e.warnings, []);       // no inflation warning: tokens_at_start > 0
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
