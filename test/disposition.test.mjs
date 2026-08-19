// FAFF-396 — `faff disposition`: the run-end disposition verdict a headless (CI/cron/
// container) wrapper runs as its final, exit-propagating step. A PURE reader (parity with
// economics/runcheck/audit): no tracker/network/LLM, and it writes nothing. It classifies
// one run dir's on-disk end state into clean (exit 0) vs needs-attention (exit 1), so a
// lights-out run whose issues parked/errored/escalated exits non-zero instead of
// green-by-silence. Drives the real entrypoint end-to-end over filesystem fixtures
// (mirrors economics.test.mjs / budget.test.mjs). The pure classifier core is additionally
// covered by `faff disposition --selftest`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// Build a run dir under a throwaway root. `ledger` is written as run-ledger.json;
// `summary` (optional) as summary.md; `events` (optional) as events.jsonl lines.
function fixture({ ledger, summary, events } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-disp-"));
  const runDir = join(root, ".faff", "runs", "run-t");
  mkdirSync(runDir, { recursive: true });
  if (ledger !== undefined) writeFileSync(join(runDir, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
  if (summary !== undefined) writeFileSync(join(runDir, "summary.md"), summary);
  if (events !== undefined) writeFileSync(join(runDir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// A recursive snapshot of {relpath: "size:mtimeMs"} so a purity check can prove the
// verb wrote nothing (byte-identical + no new files).
function snapshot(dir) {
  const out = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) Object.assign(out, Object.fromEntries(Object.entries(snapshot(p)).map(([k, v]) => [join(name, k), v])));
    else out[name] = `${st.size}:${readFileSync(p, "utf8")}`;
  }
  return out;
}

test("parked issue + parks-block cause → exit 1, issue-outcome item carries the parks cause", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "shipped", "FAFF-B": "parked" } },
    summary: '# summary\n```faff-parks\n[{"issue_id":"FAFF-B","root_cause_class":"punt-not-closed","timestamp":"2026-07-13T10:00:00Z"}]\n```\n',
  });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.equal(rep.disposition, "needs-attention");
    assert.deepEqual(rep.attention, [{ kind: "issue-outcome", issue: "FAFF-B", outcome: "parked", cause: "punt-not-closed" }]);
    assert.deepEqual(rep.counts, { shipped: 1, parked: 1 });
  } finally { f.cleanup(); }
});

test("all shipped/routed-out + queue-drained → exit 0, attention empty", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["A", "B"], outcomes: { A: "shipped", B: "routed-out" }, stop_reason: "queue-drained" },
  });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out).attention, []);
  } finally { f.cleanup(); }
});

test("all shipped + budget-escalated(tokens) → exit 1, run-escalation item", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "shipped" }, stop_reason: "budget-escalated(tokens)" },
  });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "run-escalation" && i.cause === "budget-escalated(tokens)"));
  } finally { f.cleanup(); }
});

test("admitted issue absent from outcomes (killed run) → exit 1, incomplete-ledger naming it", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["A", "B"], outcomes: { A: "shipped" } } });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "incomplete-ledger" && String(i.cause).includes("B")));
  } finally { f.cleanup(); }
});

test("sentry abort marker → exit 1, aborted item with the abort signal as cause", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "shipped" }, abort: { status: "aborted-resumable", signal: "wall-clock-runaway" } },
  });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    assert.ok(JSON.parse(out).attention.some((i) => i.kind === "aborted" && i.cause === "wall-clock-runaway"));
  } finally { f.cleanup(); }
});

test("cause degrade: no parks block, event data carries a cause → event-derived", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "errored" } },
    events: [{ schema: 1, run_id: "run-t", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "A", data: { outcome: "errored", gate: "ci" } }],
  });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    assert.ok(JSON.parse(out).attention.some((i) => i.kind === "issue-outcome" && i.cause === "ci"));
  } finally { f.cleanup(); }
});

test("no run-ledger.json under an explicit --run-dir → exit 3 (never a verdict about another run)", () => {
  const f = fixture({}); // run dir exists, no ledger
  try {
    const { code, err } = run(["disposition", "--run-dir", f.runDir]);
    assert.equal(code, 3);
    assert.match(err, /no run dir \/ no run-ledger\.json/);
  } finally { f.cleanup(); }
});

test("malformed run-ledger.json → exit 2 naming the file", () => {
  const f = fixture({ ledger: "{ not json" });
  try {
    const { code, err } = run(["disposition", "--run-dir", f.runDir]);
    assert.equal(code, 2);
    assert.match(err, /malformed ledger/);
  } finally { f.cleanup(); }
});

test("$FAFF_RUN_DIR resolution when no --run-dir is passed", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "parked" } } });
  try {
    const { code, out } = run(["disposition", "--json"], { FAFF_RUN_DIR: f.runDir });
    assert.equal(code, 1);
    assert.equal(JSON.parse(out).run_id, "run-t");
  } finally { f.cleanup(); }
});

test("FAFF-858: neither --run-dir nor $FAFF_RUN_DIR supplied -> exit 3, never guesses the newest ledger", () => {
  // Regression: the old `latestRunDir(root)` fallback silently resolved SOME run dir
  // under .faff/runs even with neither --run-dir nor $FAFF_RUN_DIR supplied — unsafe
  // once the L4 drain reuses its inherited ledger end to end (several unclosed
  // `*-lights-out` ledgers can legitimately coexist; "newest" is not a safe guess).
  const { code, err } = run(["disposition"]);
  assert.equal(code, 3);
  assert.match(err, /no run dir \/ no run-ledger\.json/);
});

test("default (non-JSON) output is skimmable and ends with the disposition line", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "parked" } } });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir]);
    assert.equal(code, 1);
    const lines = out.trimEnd().split("\n");
    assert.match(lines.at(-1), /^disposition:\s+needs-attention$/);
  } finally { f.cleanup(); }
});

test("PURE: the verb writes nothing — the run dir is byte-identical after a run", () => {
  const f = fixture({
    ledger: { run_id: "run-t", admitted: ["A"], outcomes: { A: "parked" } },
    summary: '```faff-parks\n[{"issue_id":"A","root_cause_class":"gap","timestamp":"2026-07-13T10:00:00Z"}]\n```\n',
    events: [{ schema: 1, run_id: "run-t", seq: 1, ts: "t", phase: "build", type: "issue-outcome", issue: "A", data: { outcome: "parked" } }],
  });
  try {
    const before = snapshot(f.runDir);
    run(["disposition", "--run-dir", f.runDir, "--json"]);
    run(["disposition", "--run-dir", f.runDir]);
    assert.deepEqual(snapshot(f.runDir), before);
  } finally { f.cleanup(); }
});

// Write <runDir>/<issue>/merge-record.json (raw bytes, so a truncated/corrupt record can be forced).
function writeMergeRecord(runDir, issue, body) {
  mkdirSync(join(runDir, issue), { recursive: true });
  writeFileSync(join(runDir, issue, "merge-record.json"), typeof body === "string" ? body : JSON.stringify(body));
}

test("FAFF-782: admitted-unrecorded issue with merge-record merged:true → merged-unclosed item, not incomplete-ledger", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {}, owner: { status: "running" } } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 641, head_sha: "abc12345def", merged: true });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.equal(rep.disposition, "needs-attention");
    assert.ok(rep.attention.some((i) => i.kind === "merged-unclosed" && i.issue === "FAFF-417"));
    assert.ok(!rep.attention.some((i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-417")));
  } finally { f.cleanup(); }
});

test("FAFF-782: no merge-record (killed before merge) → generic incomplete-ledger, never merged-unclosed", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {} } });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-417")));
    assert.ok(!rep.attention.some((i) => i.kind === "merged-unclosed"));
  } finally { f.cleanup(); }
});

test("FAFF-782: corrupt/partial merge-record (JSON.parse throws) fails safe to incomplete-ledger, no exception escapes", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {} } });
  writeMergeRecord(f.runDir, "FAFF-417", '{ "pr": 641, "merged": tr');   // truncated mid-write
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);   // classifier did not throw (would be exit 2)
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-417")));
    assert.ok(!rep.attention.some((i) => i.kind === "merged-unclosed"));
  } finally { f.cleanup(); }
});

test("FAFF-782: merged:false record is not merged-unclosed (an unconfirmed merge is never asserted)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {} } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 641, head_sha: "abc123", merged: false });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "incomplete-ledger"));
    assert.ok(!rep.attention.some((i) => i.kind === "merged-unclosed"));
  } finally { f.cleanup(); }
});

test("FAFF-782: mixed run — FAFF-417 merged-unclosed, FAFF-418 genuinely undispatched → both present in one report", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417", "FAFF-418"], outcomes: {} } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 700, head_sha: "deadbeef01", merged: true });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "merged-unclosed" && i.issue === "FAFF-417"));
    const inc = rep.attention.find((i) => i.kind === "incomplete-ledger");
    assert.ok(inc && String(inc.cause).includes("FAFF-418") && !String(inc.cause).includes("FAFF-417"));
  } finally { f.cleanup(); }
});

test("FAFF-782: a non-issue-id admitted entry is skipped by the shape guard (never path-joined, never merged-unclosed)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["../evil", "not-an-id"], outcomes: {} } });
  writeMergeRecord(f.runDir, "not-an-id", { pr: 1, head_sha: "x", merged: true });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(!rep.attention.some((i) => i.kind === "merged-unclosed"));
  } finally { f.cleanup(); }
});

test("FAFF-782: render enrichment surfaces the shipped PR/sha on the merged-unclosed item (non-JSON output)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {} } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 641, head_sha: "abcdef1234567", merged: true });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir]);
    assert.equal(code, 1);
    assert.match(out, /merged-unclosed FAFF-417 \(merged-unrecorded pr#641 abcdef12\)/);
  } finally { f.cleanup(); }
});

test("FAFF-782: PURE — reading merge-records writes nothing (run dir byte-identical)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {} } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 641, head_sha: "abc123", merged: true });
  try {
    const before = snapshot(f.runDir);
    run(["disposition", "--run-dir", f.runDir, "--json"]);
    run(["disposition", "--run-dir", f.runDir]);
    assert.deepEqual(snapshot(f.runDir), before);
  } finally { f.cleanup(); }
});

test("--selftest runs the pure classifier fixture table and passes", () => {
  const { code, out } = run(["disposition", "--selftest"]);
  assert.equal(code, 0);
  assert.match(out, /RESULT: PASS/);
});

// --- FAFF-784: a PRESENT per-issue custody-verdict.json drives needs-attention, independent of the
// outcome bucket — even a shipped/Done issue. Missing alone never retroactively marks a legacy run. ---

function writeCustodyVerdict(runDir, issue, over = {}) {
  mkdirSync(join(runDir, issue), { recursive: true });
  const record = {
    schema_version: 1, run_id: "run-t", issue, classification: "clean",
    paths: [], detail: "digest-verified", verified_at: "2026-08-15T00:00:00.000Z",
    merge_state_at_verification: "pre-merge", ...over,
  };
  writeFileSync(join(runDir, issue, "custody-verdict.json"), typeof record === "string" ? record : JSON.stringify(record));
}

test("FAFF-784: a TAMPER custody verdict on a SHIPPED issue → exit 1 needs-attention (custody overrides an otherwise-clean outcome)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  writeCustodyVerdict(f.runDir, "FAFF-1", { classification: "tamper", paths: ["run-ledger.json"], detail: "tampered" });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.equal(rep.disposition, "needs-attention");
    assert.ok(rep.attention.some((i) => i.kind === "custody-non-clean" && i.issue === "FAFF-1" && i.outcome === "shipped" && i.cause === "tamper"));
  } finally { f.cleanup(); }
});

test("FAFF-784: a verification-unavailable custody verdict → needs-attention", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  writeCustodyVerdict(f.runDir, "FAFF-1", { classification: "verification-unavailable", detail: "no SHA-256 tool" });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "custody-non-clean" && i.issue === "FAFF-1" && i.cause === "verification-unavailable"));
  } finally { f.cleanup(); }
});

test("FAFF-784: a malformed-present custody verdict (unparseable JSON) → needs-attention, disposition never throws (exit 1, not 2)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  mkdirSync(join(f.runDir, "FAFF-1"), { recursive: true });
  writeFileSync(join(f.runDir, "FAFF-1", "custody-verdict.json"), "{not valid json");
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "custody-non-clean" && i.issue === "FAFF-1" && i.cause === "malformed-present"));
  } finally { f.cleanup(); }
});

test("FAFF-784: an identity-mismatched custody verdict (wrong run_id — evidence carried over from a different run) → needs-attention", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  writeCustodyVerdict(f.runDir, "FAFF-1", { run_id: "some-other-run" });
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.ok(rep.attention.some((i) => i.kind === "custody-non-clean" && i.issue === "FAFF-1" && i.cause === "identity-mismatch"));
  } finally { f.cleanup(); }
});

test("FAFF-784: a CLEAN custody verdict on a shipped issue adds NOTHING (exit 0)", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  writeCustodyVerdict(f.runDir, "FAFF-1");
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out).attention, []);
  } finally { f.cleanup(); }
});

test("FAFF-784: a MISSING custody verdict on a shipped/Done issue never retroactively marks the run (exit 0) — legacy/interactive runs are unaffected", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } } });
  // deliberately no custody-verdict.json at all
  try {
    const { code, out } = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out).attention, []);
  } finally { f.cleanup(); }
});
