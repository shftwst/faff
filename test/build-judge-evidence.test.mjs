// FAFF-996 — unit tests for the build-judge evidence/dispatch/admit CLI layer
// (plugin/skills/faff/bin/lib/build-judge-evidence.js). The deterministic pieces (adjudication-
// set derivation, --admit roll-up, the critical-free-latest floor) are exercised directly; the
// two-phase review-call.mjs dispatch loop is exercised with an INJECTED fake transport so no
// test ever spawns a subprocess or hits a network backend (mirrors how review-call.mjs's own
// unit tests inject runReviewFn/checkFn rather than spawning a real provider).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const bje = require("../plugin/skills/faff/bin/lib/build-judge-evidence.js");

// Awaits `fn`'s result before cleanup — a bare try/finally around an async fn would run
// rmSync immediately (synchronously) rather than after the promise settles, deleting the
// fixture dir out from under an in-flight async cmdAssemble call.
async function withTmp(fn) {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-judge-evidence-"));
  try { return await fn(tmp); } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// --- collectAdjudicationSet ---------------------------------------------------

test("collectAdjudicationSet: standing criticals in the latest round, each with its most recent rebuttal", () => {
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [] },
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [{ finding_ref: "a.js::x", kind: "rebuttal", rebuttal_text: "wrong file" }] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.equal(set[0].finding_id, "a.js::x");
  assert.equal(set[0].rebuttal_text, "wrong file");
  assert.equal(set[0].requires_confirm, false);
});

test("collectAdjudicationSet: empty standing set + prior rebuttal round -> rebuttal-withdrawn criticals, requires_confirm true (p-05)", () => {
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [] },
    { signal: "needs-human", findings: [], author_replies: [{ finding_ref: "a.js::x", kind: "rebuttal", rebuttal_text: "wrong file, see casefile.js" }] },
    { signal: "pass", findings: [], author_replies: [] }, // reviewer omitted the finding after re-evaluating
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.equal(set[0].finding_id, "a.js::x");
  assert.equal(set[0].requires_confirm, true);
  assert.equal(set[0].rebuttal_text, "wrong file, see casefile.js");
  assert.equal(set[0].location, "a.js:1", "identity fields recovered from the last known appearance");
});

test("collectAdjudicationSet: empty standing set + no prior rebuttal -> nothing to adjudicate (fix-path withdrawal, no judge pass, p-15)", () => {
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] },
    { signal: "pass", findings: [], author_replies: [{ finding_ref: "a.js::x", kind: "fix", fix_commit: "abc123" }] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.deepEqual(set, []);
});

test("collectAdjudicationSet: no rounds -> empty set", () => {
  assert.deepEqual(bje.collectAdjudicationSet([]), []);
});

// --- computeCriticalFreeLatestFloor -------------------------------------------

test("computeCriticalFreeLatestFloor: every standing critical has an OVERTURN ruling -> true", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    const ledger = { entries: { "f-01": { finding_id: "a.js::x", resolution: "overturned" } } };
    const rulings = { "f-01": { outcome: "OVERTURN" } };
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, ledger, rulings), true);
  });
});

test("computeCriticalFreeLatestFloor: a standing critical with no OVERTURN ruling -> false", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    const ledger = { entries: { "f-01": { finding_id: "a.js::x", resolution: "pending" } } };
    const rulings = { "f-01": { outcome: "UPHOLD" } };
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, ledger, rulings), false);
  });
});

test("computeCriticalFreeLatestFloor: reads OVERTURN status from `rulings`, never a possibly-stale ledger.entries[cid].resolution field", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    // ledger.json says "pending" (stale/unwritten-back) but the freshly loaded ruling says OVERTURN.
    const ledger = { entries: { "f-01": { finding_id: "a.js::x", resolution: "pending" } } };
    const rulings = { "f-01": { outcome: "OVERTURN" } };
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, ledger, rulings), true, "the floor must agree with admitBuildRollup's own ruling-derived resolution, not a stale ledger field");
  });
});

test("computeCriticalFreeLatestFloor: no standing criticals in the latest round -> true (vacuously)", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "pass", findings: [], author_replies: [] }));
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, { entries: {} }), true);
  });
});

test("computeCriticalFreeLatestFloor: missing/unreadable dir, or no rounds -> null (degraded, fails closed downstream, p-17)", async () => {
  assert.equal(bje.computeCriticalFreeLatestFloor("/does/not/exist", { entries: {} }), null);
  await withTmp((tmp) => {
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, { entries: {} }), null);
  });
});

test("computeCriticalFreeLatestFloor: a malformed latest round record -> null (degraded)", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), "not json");
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, { entries: {} }), null);
  });
});

// --- cmdAssemble: deterministic write path (no criticals -> no dispatch, no network) ---------

test("cmdAssemble: no standing criticals -> empty ledger, exit 0, no dispatch attempted", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "pass", findings: [], author_replies: [] }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/x b/x\n");
    const result = bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": join(tmp, "judge") });
    const code = await Promise.resolve(result);
    assert.equal(code, 0);
    const ledger = JSON.parse(readFileSync(join(tmp, "judge", "ledger.json"), "utf8"));
    assert.deepEqual(ledger.order, []);
  });
});

test("cmdAssemble: unreadable --dir degrades to a park bundle, exit 0", () => {
  const code = bje.cmdAssemble({ "--dir": "/does/not/exist/anywhere", "--issue": "TEST-1", "--diff": "/dev/null" });
  assert.equal(code, 0);
});

test("cmdAssemble: missing required flags is a usage error, exit 2", () => {
  assert.equal(bje.cmdAssemble({}), 2);
  assert.equal(bje.cmdAssemble({ "--dir": "/tmp" }), 2);
});

// --- cmdAssemble: full dispatch loop with an injected fake transport --------------------------

const PAD = "this is filler text well past the forty non-whitespace character floor every single time. ";
const RECON_STDOUT = `requirements_invariants: ${PAD}\nexisting_behaviour: ${PAD}\nvalid_solution_properties: ${PAD}\nundeterminable_facts: ${PAD}`;

function fakeDepsAlwaysOverturn() {
  return {
    runReviewCall: (args) => {
      const isPhase1 = args.some((a) => String(a).includes("adjudicate-build-phase1-reconstruct.md"));
      if (isPhase1) return { code: 0, stdout: RECON_STDOUT, stderr: "" };
      return {
        code: 0,
        stdout: "```faff-contract:build-judge-verdict\n" + JSON.stringify({ finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" }) + "\n```",
        stderr: "",
      };
    },
    judgeDispatchDisposition: async (exit) => (exit === 0 ? "ruling" : "park"),
  };
}

test("cmdAssemble: dispatches the two-phase judge per non-parked case_id and writes ruling-<case_id>.json", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    const code = await Promise.resolve(bje.cmdAssemble(
      { "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir },
      fakeDepsAlwaysOverturn(),
    ));
    assert.equal(code, 0);
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "overturned");
    const ruling = JSON.parse(readFileSync(join(judgeDir, "ruling-f-01.json"), "utf8"));
    assert.equal(ruling.outcome, "OVERTURN");
  });
});

test("cmdAssemble: a Phase-1 reconstruction that fails validation parks the finding, never runs Phase 2", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    let phase2Called = false;
    const deps = {
      runReviewCall: (args) => {
        const isPhase1 = args.some((a) => String(a).includes("adjudicate-build-phase1-reconstruct.md"));
        if (isPhase1) return { code: 0, stdout: "too short", stderr: "" };
        phase2Called = true;
        return { code: 0, stdout: "unreachable", stderr: "" };
      },
      judgeDispatchDisposition: async () => "ruling",
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps));
    assert.equal(code, 0);
    assert.equal(phase2Called, false, "Phase 2 must never run after a failed reconstruction");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
    assert.match(ledger.entries["f-01"].park_cause, /reconstruction empty\/failed/);
  });
});

test("cmdAssemble: judgeDispatchDisposition 'park' (a config-fault/malformed exit) parks the finding directly, no retry consumed", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    let callCount = 0;
    const deps = {
      runReviewCall: () => { callCount++; return { code: 1, stdout: "", stderr: "boom" }; },
      judgeDispatchDisposition: async () => "park",
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir, "--retry-limit": "2" }, deps));
    assert.equal(code, 0);
    assert.equal(callCount, 1, "a park disposition never retries");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
  });
});

test("cmdAssemble: judgeDispatchDisposition 'retry' (UNREACHABLE/DEADLINE) retries up to the bound, then parks", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    let callCount = 0;
    const deps = {
      runReviewCall: () => { callCount++; return { code: 5, stdout: "", stderr: "unreachable" }; },
      judgeDispatchDisposition: async () => "retry",
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir, "--retry-limit": "2" }, deps));
    assert.equal(code, 0);
    assert.equal(callCount, 3, "retry-limit 2 means 1 initial attempt + 2 retries = 3 calls");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
  });
});

// --- cmdAdmit -----------------------------------------------------------------

function writeLedgerAndRulings(judgeDir, ledger, rulings) {
  mkdirSync(judgeDir, { recursive: true });
  writeFileSync(join(judgeDir, "ledger.json"), JSON.stringify(ledger));
  for (const [cid, ruling] of Object.entries(rulings)) {
    writeFileSync(join(judgeDir, `ruling-${cid}.json`), JSON.stringify(ruling));
  }
}

test("cmdAdmit: reads ledger + ruling files from disk, admits on an all-OVERTURN ledger with a clean floor", async () => {
  await withTmp((tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    const judgeDir = join(tmp, "judge");
    writeLedgerAndRulings(judgeDir,
      { order: ["f-01"], entries: { "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } } },
      { "f-01": { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" } });
    const code = bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir });
    assert.equal(code, 0);
    const result = JSON.parse(readFileSync(join(judgeDir, "admit-result.json"), "utf8"));
    assert.equal(result.admit, true);
  });
});

test("cmdAdmit: missing --level is a usage error, exit 2", () => {
  assert.equal(bje.cmdAdmit({ "--dir": "/tmp" }), 2);
});

test("cmdAdmit: missing/malformed ledger.json is fail-loud, exit 2", async () => {
  await withTmp((tmp) => {
    const code = bje.cmdAdmit({ "--dir": tmp, "--level": "L3", "--out": join(tmp, "nope") });
    assert.equal(code, 2);
  });
});

test("cmdAdmit: exit code mirrors admit (0) / not-admit (1) — a standing UPHOLD returns exit 1", async () => {
  await withTmp((tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    const judgeDir = join(tmp, "judge");
    writeLedgerAndRulings(judgeDir,
      { order: ["f-01"], entries: { "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending" } } },
      { "f-01": { finding_id: "a.js::x", outcome: "UPHOLD", rationale: "stands", product_gap_citation: "" } });
    const code = bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir });
    assert.equal(code, 1);
  });
});

// --- CLI dispatcher (usage errors only — no network) ------------------------------------------

test("faff build-judge-evidence: neither --assemble nor --admit is a usage error, exit 2", () => {
  const r = runCli(["build-judge-evidence"]);
  assert.equal(r.code, 2);
});

test("faff build-judge-evidence: both --assemble and --admit together is a usage error, exit 2", () => {
  const r = runCli(["build-judge-evidence", "--assemble", "--admit"]);
  assert.equal(r.code, 2);
});

test("faff build-judge-evidence --assemble: an unreadable --dir degrades to a park bundle over the real CLI, exit 0", () => {
  const r = runCli(["build-judge-evidence", "--assemble", "--dir", "/does/not/exist/anywhere", "--issue", "TEST-1", "--diff", "/dev/null"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).park, true);
});
