// FAFF-996 — unit tests for the build-judge evidence/dispatch/admit CLI layer
// (plugin/skills/faff/bin/lib/build-judge-evidence.js). The deterministic pieces (adjudication-
// set derivation, --admit roll-up, the critical-free-latest floor) are exercised directly; the
// two-phase review-call.mjs dispatch loop is exercised with an INJECTED fake transport so no
// test ever spawns a subprocess or hits a network backend (mirrors how review-call.mjs's own
// unit tests inject runReviewFn/checkFn rather than spawning a real provider).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
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

test("collectAdjudicationSet: a rebuttal-withdrawn critical from an EARLY round is still surfaced when a SIBLING critical keeps the loop going for several more (fix-only) rounds — the multi-critical p-05 gap", () => {
  // round-1: two criticals raised, X and Y.
  // round-2: author rebuts X, fixes Y (both replies land in round-1's author_replies).
  // round-3: reviewer withdraws X (rebuttal-driven), Y still stands (the fix didn't land).
  // round-4: author fixes Y again (round-3's author_replies).
  // round-5: reviewer now shows nothing standing — Y resolved by a FRESH-REVIEW fix (p-15,
  //   judge-free), but X's round-3 withdrawal was rebuttal-driven and was NEVER the
  //   immediately-prior round by the time round-5 is reached — it must still be surfaced.
  const rounds = [
    { signal: "needs-human", findings: [
      { finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" },
      { finding_id: "b.js::y", severity: "critical", location: "b.js:1", title: "Y" },
    ], author_replies: [] },
    { signal: "needs-human", findings: [
      { finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" },
      { finding_id: "b.js::y", severity: "critical", location: "b.js:1", title: "Y" },
    ], author_replies: [
      { finding_ref: "a.js::x", kind: "rebuttal", rebuttal_text: "wrong file, see casefile.js" },
      { finding_ref: "b.js::y", kind: "fix", fix_commit: "fix1" },
    ] },
    { signal: "needs-human", findings: [
      { finding_id: "b.js::y", severity: "critical", location: "b.js:1", title: "Y" },
    ], author_replies: [
      { finding_ref: "b.js::y", kind: "fix", fix_commit: "fix2" },
    ] },
    { signal: "pass", findings: [], author_replies: [] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1, "only X's rebuttal-driven withdrawal needs confirming — Y resolved via a fix-path admit with no judge pass");
  assert.equal(set[0].finding_id, "a.js::x");
  assert.equal(set[0].requires_confirm, true);
  assert.equal(set[0].rebuttal_text, "wrong file, see casefile.js");
});

test("collectAdjudicationSet: a rebuttal-withdrawn finding that LATER reappears as standing is not treated as withdrawn (the reviewer re-raised it)", () => {
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [] },
    { signal: "needs-human", findings: [], author_replies: [{ finding_ref: "a.js::x", kind: "rebuttal", rebuttal_text: "wrong file" }] },
    // The reviewer re-raises X later (e.g. a fresh diff reintroduced the same defect) — it is
    // standing again, so it belongs to the CURRENT standing set, not the withdrawn one.
    { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.equal(set[0].finding_id, "a.js::x");
  assert.equal(set[0].requires_confirm, false, "standing-now findings are never requires_confirm, regardless of an earlier rebuttal in their history");
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

const FAKE_CHAIN = [{ provider: "openai", model: "m", host: "http://h" }];
const FAKE_CLOCK = { deadline: 300, timeout: 90 };

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
    resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
    resolveBuildJudgeClock: () => FAKE_CLOCK,
    resolveBuildJudgeRetryLimit: () => 2,
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
    const entry = ledger.entries["f-01"];
    assert.match(entry.case_sha, /^[0-9a-f]{64}$/);
    assert.deepEqual(ruling.binding, {
      finding_id: entry.finding_id,
      pre_ruling_diff_sha: entry.pre_ruling_diff_sha,
      case_sha: entry.case_sha,
      run_id: ledger.run_id,
    });
    assert.equal(ruling.finding_id, "a.js::x", "verdict fields stay top-level");
  });
});

test("cmdAssemble: faff's binding overwrites a binding the model put in its verdict", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRound(tmp, "a.js::x");
    const judgeDir = join(tmp, "judge");
    const deps = fakeDepsAlwaysOverturn();
    const base = deps.runReviewCall;
    deps.runReviewCall = (args) => {
      const r = base(args);
      if (r.stdout.includes("build-judge-verdict")) {
        r.stdout = "```faff-contract:build-judge-verdict\n" + JSON.stringify({ finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "", binding: { finding_id: "evil" } }) + "\n```";
      }
      return r;
    };
    assert.equal(await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps)), 0);
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    const ruling = JSON.parse(readFileSync(join(judgeDir, "ruling-f-01.json"), "utf8"));
    assert.equal(ruling.binding.finding_id, "a.js::x");
    assert.equal(ruling.binding.run_id, ledger.run_id);
    assert.ok(!("binding" in ledger.entries["f-01"].ruling), "the inline ledger copy carries no model-written binding");
  });
});

function writeBrRound(tmp, findingId) {
  const br = join(tmp, "br"); mkdirSync(br, { recursive: true });
  writeFileSync(join(br, "round-1.json"), JSON.stringify({
    signal: "needs-human",
    findings: [{ finding_id: findingId, severity: "critical", location: "a.js:1", title: "X" }],
    author_replies: [],
  }));
  writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
  return br;
}

test("cmdAssemble: a second assemble over a changed set sweeps earlier rulings and admit-result before the first call; --admit then exits 2", async () => {
  await withTmp(async (tmp) => {
    const judgeDir = join(tmp, "judge");
    const br = writeBrRound(tmp, "a.js::x");
    const args = () => ({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir });
    assert.equal(await Promise.resolve(bje.cmdAssemble(args(), fakeDepsAlwaysOverturn())), 0);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 0);
    assert.ok(existsSync(join(judgeDir, "ruling-f-01.json")));
    assert.ok(existsSync(join(judgeDir, "admit-result.json")));
    const oldRuling = readFileSync(join(judgeDir, "ruling-f-01.json"), "utf8");

    writeBrRound(tmp, "b.js::y");
    let seen = null;
    const deps = {
      ...fakeDepsAlwaysOverturn(),
      runReviewCall: () => {
        seen = readdirSync(judgeDir).filter((n) => /^ruling-.+\.json$/.test(n) || n === "admit-result.json");
        throw new Error("killed");
      },
    };
    assert.equal(await Promise.resolve(bje.cmdAssemble(args(), deps)), 2);
    assert.deepEqual(seen, []);
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].finding_id, "b.js::y");
    assert.equal(ledger.entries["f-01"].ruling, null);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 2);
    assert.ok(!existsSync(join(judgeDir, "admit-result.json")));

    // smoke step 6: the old (a.js::x) ruling copied back is "not bound"
    writeFileSync(join(judgeDir, "ruling-f-01.json"), oldRuling);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 2);
    assert.ok(!existsSync(join(judgeDir, "admit-result.json")));
  });
});

test("cmdAssemble: a sweep that cannot unlink a file warns once and assemble carries on", async () => {
  await withTmp(async (tmp) => {
    const judgeDir = join(tmp, "judge"); mkdirSync(judgeDir);
    // A directory named like a ruling file cannot be unlinked.
    mkdirSync(join(judgeDir, "ruling-zz.json"));
    const br = writeBrRound(tmp, "a.js::x");
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => { writes.push(String(c)); return true; };
    let code;
    try {
      code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, fakeDepsAlwaysOverturn()));
    } finally { process.stderr.write = orig; }
    assert.equal(code, 0);
    assert.equal(writes.filter((w) => w.includes("could not remove stale ruling-zz.json")).length, 1);
    assert.ok(existsSync(join(judgeDir, "ruling-f-01.json")));
  });
});

test("cmdAssemble: early exits leave existing ruling files in place", async () => {
  await withTmp(async (tmp) => {
    const judgeDir = join(tmp, "judge"); mkdirSync(judgeDir);
    writeFileSync(join(judgeDir, "ruling-f-01.json"), "{}");
    assert.equal(bje.cmdAssemble({ "--dir": join(tmp, "br"), "--out": judgeDir }), 2); // usage error
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), "not json");
    writeFileSync(join(tmp, "diff.txt"), "d\n");
    assert.equal(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }), 2);
    assert.ok(existsSync(join(judgeDir, "ruling-f-01.json")));
  });
});

// --- bindingFor / bindingMatches ------------------------------------------------

const BLEDGER = { run_id: "R1", order: ["f-01"], entries: { "f-01": { finding_id: "a.js::x", pre_ruling_diff_sha: "d1", case_sha: "c1" } } };

test("bindingFor/bindingMatches: full match; each of the four fields mismatching; missing, non-object and non-string cases", () => {
  const good = bje.bindingFor(BLEDGER, "f-01");
  assert.deepEqual(good, { finding_id: "a.js::x", pre_ruling_diff_sha: "d1", case_sha: "c1", run_id: "R1" });
  assert.equal(bje.bindingMatches(good, BLEDGER, "f-01"), true);
  for (const k of Object.keys(good)) {
    assert.equal(bje.bindingMatches({ ...good, [k]: "other" }, BLEDGER, "f-01"), false, k);
  }
  assert.equal(bje.bindingMatches(undefined, BLEDGER, "f-01"), false);
  assert.equal(bje.bindingMatches(null, BLEDGER, "f-01"), false);
  assert.equal(bje.bindingMatches("str", BLEDGER, "f-01"), false);
  assert.equal(bje.bindingMatches([good], BLEDGER, "f-01"), false);
  const badEntry = { ...BLEDGER, entries: { "f-01": { ...BLEDGER.entries["f-01"], case_sha: undefined } } };
  assert.equal(bje.bindingMatches({ ...good, case_sha: undefined }, badEntry, "f-01"), false);
  const numEntry = { ...BLEDGER, entries: { "f-01": { ...BLEDGER.entries["f-01"], case_sha: 5 } } };
  assert.equal(bje.bindingMatches({ ...good, case_sha: 5 }, numEntry, "f-01"), false);
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
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => FAKE_CLOCK,
      resolveBuildJudgeRetryLimit: () => 2,
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
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => FAKE_CLOCK,
      resolveBuildJudgeRetryLimit: () => 2,
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
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => FAKE_CLOCK,
      resolveBuildJudgeRetryLimit: () => 2,
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir, "--retry-limit": "2" }, deps));
    assert.equal(code, 0);
    assert.equal(callCount, 3, "retry-limit 2 means 1 initial attempt + 2 retries = 3 calls");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
  });
});

test("cmdAssemble: threads --backends-json (the resolved chain) into both phase dispatches", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    const seenBackends = [];
    const deps = {
      runReviewCall: (args) => {
        // Read the backends file WHILE the dispatch tmpDir still exists (it is rm'd on loop exit).
        const i = args.indexOf("--backends-json");
        seenBackends.push(i >= 0 && typeof args[i + 1] === "string" ? JSON.parse(readFileSync(args[i + 1], "utf8")) : null);
        const isPhase1 = args.some((a) => String(a).includes("adjudicate-build-phase1-reconstruct.md"));
        if (isPhase1) return { code: 0, stdout: RECON_STDOUT, stderr: "" };
        return { code: 0, stdout: "```faff-contract:build-judge-verdict\n" + JSON.stringify({ finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" }) + "\n```", stderr: "" };
      },
      judgeDispatchDisposition: async (exit) => (exit === 0 ? "ruling" : "park"),
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => FAKE_CLOCK,
      resolveBuildJudgeRetryLimit: () => 2,
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps));
    assert.equal(code, 0);
    assert.equal(seenBackends.length, 2, "one Phase-1 and one Phase-2 dispatch, each carrying the chain");
    for (const chain of seenBackends) assert.deepEqual(chain, FAKE_CHAIN);
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "overturned");
  });
});

test("cmdAssemble: an unresolvable (unset) backend chain parks every case with a diagnostic cause, never dispatches", async () => {
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
      runReviewCall: () => { callCount++; return { code: 0, stdout: "", stderr: "" }; },
      judgeDispatchDisposition: async () => "ruling",
      resolveAdversarialBackends: () => ({ error: "unset" }),
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps));
    assert.equal(code, 0);
    assert.equal(callCount, 0, "an unresolvable chain never spawns review-call.mjs");
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
    assert.match(ledger.entries["f-01"].park_cause, /backend config unset/);
  });
});

test("cmdAssemble: a malformed backend chain parks with the resolver detail folded into park_cause", async () => {
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
      runReviewCall: () => { callCount++; return { code: 0, stdout: "", stderr: "" }; },
      judgeDispatchDisposition: async () => "ruling",
      resolveAdversarialBackends: () => ({ error: "malformed", detail: "adversarial.fallbacks is not valid JSON: boom" }),
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps));
    assert.equal(code, 0);
    assert.equal(callCount, 0);
    const ledger = JSON.parse(readFileSync(join(judgeDir, "ledger.json"), "utf8"));
    assert.equal(ledger.entries["f-01"].resolution, "parked");
    assert.match(ledger.entries["f-01"].park_cause, /malformed: adversarial\.fallbacks is not valid JSON: boom/);
  });
});

test("cmdAssemble: resolves the backend chain exactly once per invocation, not per case", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [
        { finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" },
        { finding_id: "b.js::y", severity: "critical", location: "b.js:2", title: "Y" },
      ],
      author_replies: [],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const judgeDir = join(tmp, "judge");
    let resolveCount = 0;
    const deps = {
      ...fakeDepsAlwaysOverturn(),
      resolveAdversarialBackends: () => { resolveCount++; return { chain: FAKE_CHAIN }; },
    };
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": judgeDir }, deps));
    assert.equal(code, 0);
    assert.equal(resolveCount, 1, "the chain is resolved once for the whole --assemble, not per case");
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

const BOUND_LEDGER = {
  run_id: "R1",
  order: ["f-01"],
  entries: { "f-01": { finding_id: "a.js::x", blocking: true, resolution: "pending", pre_ruling_diff_sha: "d1", case_sha: "c1" } },
};
const BOUND_BINDING = { finding_id: "a.js::x", pre_ruling_diff_sha: "d1", case_sha: "c1", run_id: "R1" };

function admitFixture(tmp, ledger, ruling) {
  const br = join(tmp, "br"); mkdirSync(br);
  writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
  const judgeDir = join(tmp, "judge");
  writeLedgerAndRulings(judgeDir, ledger, ruling ? { "f-01": ruling } : {});
  return { br, judgeDir };
}

test("cmdAdmit: a ruling file with no binding, or a mismatched one, is treated as missing (exit 2, no admit-result)", async () => {
  await withTmp((tmp) => {
    const bare = { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" };
    const { br, judgeDir } = admitFixture(tmp, BOUND_LEDGER, bare);
    const writes = [];
    const orig = process.stderr.write;
    process.stderr.write = (c) => { writes.push(String(c)); return true; };
    let code;
    try { code = bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }); }
    finally { process.stderr.write = orig; }
    assert.equal(code, 2);
    assert.equal(writes.filter((w) => w.includes("ruling-f-01.json is not bound to this ledger entry")).length, 1);
    assert.ok(!existsSync(join(judgeDir, "admit-result.json")));
    // stale OVERTURN bound to a different finding
    writeFileSync(join(judgeDir, "ruling-f-01.json"), JSON.stringify({ ...bare, binding: { ...BOUND_BINDING, finding_id: "other.js::y" } }));
    const ledger = { ...BOUND_LEDGER, entries: { "f-01": { ...BOUND_LEDGER.entries["f-01"], finding_id: "b.js::y" } } };
    writeFileSync(join(judgeDir, "ledger.json"), JSON.stringify(ledger));
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 2);
    assert.ok(!existsSync(join(judgeDir, "admit-result.json")));
  });
});

test("cmdAdmit: an inline ledger ruling wins even when its ruling file is missing or mismatched", async () => {
  await withTmp((tmp) => {
    const inline = { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" };
    const ledger = { ...BOUND_LEDGER, entries: { "f-01": { ...BOUND_LEDGER.entries["f-01"], ruling: inline, resolution: "overturned" } } };
    const { br, judgeDir } = admitFixture(tmp, ledger, null);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 0);
    writeFileSync(join(judgeDir, "ruling-f-01.json"), JSON.stringify({ ...inline, outcome: "UPHOLD", binding: { finding_id: "evil" } }));
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": judgeDir }), 0);
  });
});

test("cmdAdmit: reads ledger + ruling files from disk, admits on an all-OVERTURN ledger with a clean floor", async () => {
  await withTmp((tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }], author_replies: [] }));
    const judgeDir = join(tmp, "judge");
    writeLedgerAndRulings(judgeDir,
      BOUND_LEDGER,
      { "f-01": { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "", binding: BOUND_BINDING } });
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
      BOUND_LEDGER,
      { "f-01": { finding_id: "a.js::x", outcome: "UPHOLD", rationale: "stands", product_gap_citation: "", binding: BOUND_BINDING } });
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

// --- FAFF-1244: judge clock resolution, argv threading, spawn backstop ----------------------

const clockOf = (cfg) => bje.resolveBuildJudgeClock(cfg);

test("resolveBuildJudgeClock: absent config resolves the terminal defaults", () => {
  assert.deepEqual(clockOf({}), { deadline: 480, timeout: 120 });
  assert.deepEqual(clockOf(null), { deadline: 480, timeout: 120 });
});

test("resolveBuildJudgeClock: shared adversarial.* tier, then per-consumer build_judge.* wins", () => {
  assert.deepEqual(clockOf({ adversarial: { deadline: 300, timeout: 90 } }), { deadline: 300, timeout: 90 });
  assert.deepEqual(
    clockOf({ adversarial: { deadline: 300, timeout: 90, build_judge: { deadline: 600, timeout: 45 } } }),
    { deadline: 600, timeout: 45 },
  );
});

test("resolveBuildJudgeClock: an invalid per-consumer deadline falls through to the shared tier", () => {
  for (const bad of [0, -5, "abc", "", 2.5, true]) {
    const c = clockOf({ adversarial: { deadline: 300, build_judge: { deadline: bad } } });
    assert.equal(c.deadline, 300, `build_judge.deadline ${JSON.stringify(bad)}`);
  }
});

test("resolveBuildJudgeClock: a quoted digit string is accepted", () => {
  assert.equal(clockOf({ adversarial: { build_judge: { deadline: "600" } } }).deadline, 600);
});

test("resolveBuildJudgeClock: invalid at both tiers lands on the terminal default; tiers resolve independently", () => {
  assert.equal(clockOf({ adversarial: { timeout: 0, build_judge: { timeout: "x" } } }).timeout, 120);
  assert.deepEqual(clockOf({ adversarial: { build_judge: { timeout: 45 } } }), { deadline: 480, timeout: 45 });
});

test("resolveBuildJudgeClock: adversarial.build_judge as a non-map scalar falls through to the shared tier", () => {
  assert.deepEqual(
    clockOf({ adversarial: { deadline: 300, timeout: 90, build_judge: "oops" } }),
    { deadline: 300, timeout: 90 },
  );
});

test("constants: spawn grace and deadline exit match killable-spawn.mjs / review-call.mjs", async () => {
  const ks = await import("../plugin/skills/faff/bin/lib/killable-spawn.mjs");
  const rc = await import("../plugin/skills/faffter-dark-adversarial-review/review-call.mjs");
  assert.equal(bje.BUILD_JUDGE_SPAWN_GRACE_SECS, ks.DEFAULT_GRACE_SECONDS);
  assert.equal(bje.REVIEW_CALL_DEADLINE_EXIT, rc.EXIT.DEADLINE);
  assert.equal(bje.REVIEW_CALL_DEADLINE_EXIT, ks.WRAPPER_EXIT.DEADLINE);
  assert.equal(bje.DEFAULT_BUILD_JUDGE_DEADLINE_SECS, 480);
  assert.equal(bje.DEFAULT_BUILD_JUDGE_TIMEOUT_SECS, 120);
});

async function runDispatch(tmp, deps, extra = {}) {
  const br = join(tmp, "br"); mkdirSync(br);
  writeFileSync(join(br, "round-1.json"), JSON.stringify({
    signal: "needs-human",
    findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }],
    author_replies: [],
  }));
  writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
  return Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": join(tmp, "judge"), ...extra }, deps));
}

function assertClockArgs(call, clock) {
  const [args, opts] = call;
  for (const [flag, val] of [["--timeout", clock.timeout], ["--deadline", clock.deadline]]) {
    assert.equal(args.filter((a) => a === flag).length, 1, `${flag} appears exactly once`);
    assert.equal(args[args.indexOf(flag) + 1], String(val));
  }
  assert.equal(opts.deadlineSecs, clock.deadline);
}

const VERDICT_STDOUT = "```faff-contract:build-judge-verdict\n" + JSON.stringify({ finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "" }) + "\n```";
const isPhase1Args = (args) => args.some((a) => String(a).includes("adjudicate-build-phase1-reconstruct.md"));

test("cmdAssemble: success path passes --timeout/--deadline and opts.deadlineSecs on both phases", async () => {
  await withTmp(async (tmp) => {
    const calls = [];
    const deps = {
      ...fakeDepsAlwaysOverturn(),
      runReviewCall: (args, opts) => { calls.push([args, opts]); return isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 0, stdout: VERDICT_STDOUT, stderr: "" }; },
    };
    assert.equal(await runDispatch(tmp, deps), 0);
    assert.equal(calls.length, 2);
    for (const c of calls) assertClockArgs(c, FAKE_CLOCK);
  });
});

test("cmdAssemble: every Phase-1 retry attempt carries the clock flags", async () => {
  await withTmp(async (tmp) => {
    const calls = [];
    const deps = {
      runReviewCall: (args, opts) => { calls.push([args, opts]); return { code: 5, stdout: "", stderr: "" }; },
      judgeDispatchDisposition: async (exit) => (exit === 5 ? "retry" : "park"),
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => ({ deadline: 300, timeout: 90 }),
      resolveBuildJudgeRetryLimit: () => 2,
    };
    assert.equal(await runDispatch(tmp, deps, { "--retry-limit": "2" }), 0);
    assert.equal(calls.length, 3);
    for (const c of calls) assertClockArgs(c, { deadline: 300, timeout: 90 });
  });
});

test("cmdAssemble: every Phase-2 retry attempt carries the clock flags", async () => {
  await withTmp(async (tmp) => {
    const calls = [];
    const deps = {
      runReviewCall: (args, opts) => {
        calls.push([args, opts]);
        return isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 8, stdout: "", stderr: "" };
      },
      judgeDispatchDisposition: async (exit) => (exit === 0 ? "ruling" : exit === 8 ? "retry" : "park"),
      resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
      resolveBuildJudgeClock: () => FAKE_CLOCK,
      resolveBuildJudgeRetryLimit: () => 2,
    };
    assert.equal(await runDispatch(tmp, deps, { "--retry-limit": "1" }), 0);
    const phase2 = calls.filter((c) => !isPhase1Args(c[0]));
    assert.equal(phase2.length, 2);
    for (const c of phase2) assertClockArgs(c, FAKE_CLOCK);
    const ledger = JSON.parse(readFileSync(join(tmp, "judge", "ledger.json"), "utf8"));
    assert.match(ledger.entries["f-01"].park_cause, /phase-2 dispatch disposition "retry" \(exit 8\)/);
  });
});

test("cmdAssemble: the unresolvable-chain path never calls resolveBuildJudgeClock", async () => {
  await withTmp(async (tmp) => {
    const deps = {
      runReviewCall: () => { throw new Error("must not dispatch"); },
      judgeDispatchDisposition: async () => "ruling",
      resolveAdversarialBackends: () => ({ error: "unset" }),
      resolveBuildJudgeClock: () => { throw new Error("clock must not be resolved"); },
      resolveBuildJudgeRetryLimit: () => { throw new Error("retry limit must not be resolved"); },
    };
    assert.equal(await runDispatch(tmp, deps), 0);
  });
});

// --- FAFF-1245: retry limit resolution, flag validation -------------------------------------

const limitOf = (cfg) => bje.resolveBuildJudgeRetryLimit(cfg);

test("resolveBuildJudgeRetryLimit: absent config resolves the default", () => {
  assert.equal(limitOf({}), 2);
  assert.equal(limitOf(null), 2);
});

test("resolveBuildJudgeRetryLimit: integers, digit strings (padded too) and zero are accepted", () => {
  assert.equal(limitOf({ graft: { build_judge_retry_limit: 1 } }), 1);
  assert.equal(limitOf({ graft: { build_judge_retry_limit: "3" } }), 3);
  assert.equal(limitOf({ graft: { build_judge_retry_limit: " 4 " } }), 4);
  assert.equal(limitOf({ graft: { build_judge_retry_limit: 0 } }), 0);
  assert.equal(limitOf({ graft: { build_judge_retry_limit: "0" } }), 0);
});

test("resolveBuildJudgeRetryLimit: invalid values and a non-map graft fall through to the default", () => {
  for (const v of [-1, 1.5, "abc", "", "1.5", true]) {
    assert.equal(limitOf({ graft: { build_judge_retry_limit: v } }), 2, `value ${JSON.stringify(v)}`);
  }
  assert.equal(limitOf({ graft: "oops" }), 2);
});

test("constants: the retry limit default matches config.js DEFAULTS", () => {
  const { DEFAULTS } = require("../plugin/skills/faff/bin/lib/config.js");
  assert.equal(bje.DEFAULT_BUILD_JUDGE_RETRY_LIMIT, 2);
  assert.equal(DEFAULTS["graft.build_judge_retry_limit"], String(bje.DEFAULT_BUILD_JUDGE_RETRY_LIMIT));
});

test("realResolveBuildJudgeRetryLimit: reads graft.build_judge_retry_limit from the repo config (child process)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "bje-rl-"));
  try {
    mkdirSync(join(tmp, ".faff"));
    writeFileSync(join(tmp, ".faffrc.yaml"), "graft:\n  build_judge_retry_limit: 0\n");
    const lib = join(process.cwd(), "plugin/skills/faff/bin/lib/build-judge-evidence.js");
    const r = spawnSync(process.execPath, ["-e", `console.log(require(${JSON.stringify(lib)}).realResolveBuildJudgeRetryLimit())`], { cwd: tmp, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "0");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

const retryDeps = (calls, extra = {}) => ({
  runReviewCall: (args, opts) => { calls.push([args, opts]); return { code: 5, stdout: "", stderr: "" }; },
  judgeDispatchDisposition: async (exit) => (exit === 5 ? "retry" : "park"),
  resolveAdversarialBackends: () => ({ chain: FAKE_CHAIN }),
  resolveBuildJudgeClock: () => FAKE_CLOCK,
  resolveBuildJudgeRetryLimit: () => 2,
  ...extra,
});

test("cmdAssemble: --retry-limit abc, 1.5 and -1 are usage errors (exit 2) and write no ledger", async () => {
  for (const bad of ["abc", "1.5", "-1"]) {
    await withTmp(async (tmp) => {
      const calls = [];
      assert.equal(await runDispatch(tmp, retryDeps(calls, { resolveBuildJudgeRetryLimit: () => 2 }), { "--retry-limit": bad }), 2, bad);
      assert.equal(calls.length, 0);
      assert.equal(existsSync(join(tmp, "judge", "ledger.json")), false, bad);
    });
  }
});

test("cmdAssemble: an invalid --retry-limit is a usage error even on a zero-criticals round", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "clean", findings: [], author_replies: [] }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": join(tmp, "judge"), "--retry-limit": "abc" }, retryDeps([])));
    assert.equal(code, 2);
    assert.equal(existsSync(join(tmp, "judge", "ledger.json")), false);
  });
});

test("cmdAssemble: a zero-criticals round never reaches the retry limit resolver", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({ signal: "clean", findings: [], author_replies: [] }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const deps = retryDeps([], { resolveBuildJudgeRetryLimit: () => { throw new Error("retry limit must not be resolved"); } });
    const code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": join(tmp, "judge") }, deps));
    assert.equal(code, 0);
  });
});

test("cmdAssemble: no flag, the resolver value bounds the Phase-1 retries (0 -> 1 call, parked; 1 -> 2 calls)", async () => {
  for (const [limit, expected] of [[0, 1], [1, 2]]) {
    await withTmp(async (tmp) => {
      const calls = [];
      assert.equal(await runDispatch(tmp, retryDeps(calls, { resolveBuildJudgeRetryLimit: () => limit })), 0);
      assert.equal(calls.length, expected);
      const ledger = JSON.parse(readFileSync(join(tmp, "judge", "ledger.json"), "utf8"));
      assert.equal(ledger.entries["f-01"].resolution, "parked");
      assert.match(ledger.entries["f-01"].park_cause, /phase-1 dispatch disposition "retry" \(exit 5\)/);
    });
  }
});

test("cmdAssemble: a valid flag wins and the resolver is never called", async () => {
  await withTmp(async (tmp) => {
    const calls = [];
    const deps = retryDeps(calls, { resolveBuildJudgeRetryLimit: () => { throw new Error("resolver must not be called"); } });
    assert.equal(await runDispatch(tmp, deps, { "--retry-limit": "2" }), 0);
    assert.equal(calls.length, 3);
  });
});

test("cmdAssemble: --retry-limit 0 beats a configured 5 (guards against flag || resolver)", async () => {
  await withTmp(async (tmp) => {
    const calls = [];
    assert.equal(await runDispatch(tmp, retryDeps(calls, { resolveBuildJudgeRetryLimit: () => 5 }), { "--retry-limit": "0" }), 0);
    assert.equal(calls.length, 1);
  });
});

test("reviewCallSpawnOptions: a valid deadline arms the backstop at deadline + grace; otherwise today's options", () => {
  assert.deepEqual(bje.reviewCallSpawnOptions(480), { encoding: "utf8", timeout: 510000, killSignal: "SIGKILL" });
  assert.deepEqual(bje.reviewCallSpawnOptions(undefined), { encoding: "utf8" });
  assert.deepEqual(bje.reviewCallSpawnOptions("300"), { encoding: "utf8", timeout: 330000, killSignal: "SIGKILL" });
});

test("reviewCallExitFromError: only ETIMEDOUT maps to 8; ENOBUFS and bare signals stay 1; status passes through", () => {
  assert.equal(bje.reviewCallExitFromError({ code: "ETIMEDOUT", signal: "SIGKILL", status: null }), 8);
  assert.equal(bje.reviewCallExitFromError({ code: "ENOBUFS", signal: "SIGTERM", status: null }), 1);
  assert.equal(bje.reviewCallExitFromError({ signal: "SIGTERM", status: null }), 1);
  assert.equal(bje.reviewCallExitFromError({ status: 7 }), 7);
  assert.equal(bje.reviewCallExitFromError({ status: 8 }), 8);
});

test("realRunReviewCall: wires the spawn options and exit mapping through the opts.exec seam", () => {
  let seen = null;
  const ok = bje.realRunReviewCall(["--x"], { deadlineSecs: 300, exec: (file, argv, options) => { seen = options; return "out"; } });
  assert.deepEqual(seen, bje.reviewCallSpawnOptions(300));
  assert.deepEqual(ok, { code: 0, stdout: "out", stderr: "" });

  const writes = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (s) => { writes.push(String(s)); return true; };
  let killed, overflow;
  try {
    killed = bje.realRunReviewCall([], { deadlineSecs: 300, exec: () => { throw Object.assign(new Error("t"), { code: "ETIMEDOUT", signal: "SIGKILL", status: null }); } });
    const afterKill = writes.length;
    overflow = bje.realRunReviewCall([], { deadlineSecs: 300, exec: () => { throw Object.assign(new Error("b"), { code: "ENOBUFS", signal: "SIGTERM", status: null }); } });
    assert.equal(writes.length, afterKill, "no stderr line for ENOBUFS");
  } finally {
    process.stderr.write = realWrite;
  }
  assert.equal(killed.code, 8);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /review-call still alive at deadline\(300s\)\+grace\(30s\); killed, treated as exit 8/);
  assert.equal(overflow.code, 1);
});

test("readBoundRuling: a bound ruling comes back without its binding key, so the roll-up sees verdict fields only", async () => {
  await withTmp((tmp) => {
    const verdict = { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "r", product_gap_citation: "" };
    const { judgeDir } = admitFixture(tmp, BOUND_LEDGER, { ...verdict, binding: BOUND_BINDING });
    const read = bje.readBoundRuling(judgeDir, BOUND_LEDGER, "f-01");
    assert.equal(read.ok, true);
    assert.ok(!("binding" in read.ruling));
    assert.deepEqual(read.ruling, verdict);
    const miss = bje.readBoundRuling(judgeDir, { ...BOUND_LEDGER, run_id: "OTHER" }, "f-01");
    assert.equal(miss.ok, false);
    assert.match(miss.error, /is not bound to this ledger entry/);
  });
});
