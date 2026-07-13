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

test("--selftest runs the pure classifier fixture table and passes", () => {
  const { code, out } = run(["disposition", "--selftest"]);
  assert.equal(code, 0);
  assert.match(out, /RESULT: PASS/);
});
