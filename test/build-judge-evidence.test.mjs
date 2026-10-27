// FAFF-996 — unit tests for the build-judge evidence/dispatch/admit CLI layer
// (plugin/skills/faff/bin/lib/build-judge-evidence.js). The deterministic pieces (adjudication-
// set derivation, --admit roll-up, the critical-free-latest floor) are exercised directly; the
// two-phase review-call.mjs dispatch loop is exercised with an INJECTED fake transport so no
// test ever spawns a subprocess or hits a network backend (mirrors how review-call.mjs's own
// unit tests inject runReviewFn/checkFn rather than spawning a real provider).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
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

test("latestRebuttalFor: a rebuttal citing the stored id of a finding whose computed id differs is still found and lands in the case file", () => {
  const bjc = require("../plugin/skills/faff/bin/lib/build-judge-casefile.js");
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "hand-derived", severity: "critical", location: "a.js:1", title: "Leaks fd" }], author_replies: [{ finding_ref: "hand-derived", kind: "rebuttal", rebuttal_text: "fd is closed in finally" }] },
    { signal: "needs-human", findings: [{ finding_id: "hand-derived", severity: "critical", location: "a.js:2", title: "Leaks fd" }], author_replies: [] },
  ];
  assert.equal(bje.latestRebuttalFor("a.js::leaks fd", rounds), undefined);
  assert.equal(bje.latestRebuttalFor("a.js::leaks fd", rounds, "hand-derived"), "fd is closed in finally");
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.equal(set[0].finding_id, "a.js::leaks fd");
  assert.equal(set[0].rebuttal_text, "fd is closed in finally");
  const { caseFiles } = bjc.assembleBuildCaseFiles({ criticalsToAdjudicate: set, diffText: "diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-a\n+b\n", acceptanceCriteria: "AC", runId: "r", windowStart: 1 });
  assert.ok(JSON.stringify(caseFiles["f-01"].arguments).includes("fd is closed in finally"));
});

test("collectAdjudicationSet: a withdrawn finding rebutted under its stored id is still surfaced for confirmation", () => {
  const rounds = [
    { signal: "needs-human", findings: [{ finding_id: "hand-derived", severity: "critical", location: "a.js:1", title: "Leaks fd" }], author_replies: [{ finding_ref: "hand-derived", kind: "rebuttal", rebuttal_text: "closed in finally" }] },
    { signal: "pass", findings: [], author_replies: [] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.deepEqual([set[0].finding_id, set[0].requires_confirm], ["a.js::leaks fd", true]);
});

test("computeCriticalFreeLatestFloor: an untitled, id-less critical is standing, so the floor is false", async () => {
  await withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ signal: "needs-human", findings: [{ severity: "critical" }], author_replies: [] }));
    assert.equal(bje.computeCriticalFreeLatestFloor(tmp, { entries: {} }, {}), false);
  });
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
    resolveBuildJudgeCallBudget: () => 540,
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
    findings: [{ finding_id: findingId, severity: "critical", location: `${findingId.split("::")[0]}:1`, title: findingId.split("::")[1] }],
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

// --- FAFF-1246: budgeted, resumable --assemble ------------------------------------------------

test("constants: the call budget default matches config.js DEFAULTS and exit 3 means incomplete", () => {
  const { DEFAULTS } = require("../plugin/skills/faff/bin/lib/config.js");
  assert.equal(DEFAULTS["graft.build_judge_call_budget_secs"], String(bje.DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS));
  assert.equal(bje.DEFAULT_BUILD_JUDGE_CALL_BUDGET_SECS, 540);
  assert.equal(bje.ASSEMBLE_INCOMPLETE_EXIT, 3);
  assert.equal(typeof bje.bindingMatches, "function");
  assert.equal(typeof bje.adjudicationIdentity, "function");
});

test("resolveBuildJudgeCallBudget: absent, valid and invalid config values", () => {
  const r = bje.resolveBuildJudgeCallBudget;
  assert.equal(r({}), 540);
  assert.equal(r(null), 540);
  assert.equal(r({ graft: { build_judge_call_budget_secs: 300 } }), 300);
  assert.equal(r({ graft: { build_judge_call_budget_secs: "300" } }), 300);
  for (const bad of [0, -5, "abc", 2.5]) assert.equal(r({ graft: { build_judge_call_budget_secs: bad } }), 540, JSON.stringify(bad));
  assert.equal(r({ graft: "oops" }), 540);
});

// Multi-case fixture + a per-case call counter + a fake clock.
function writeBrRounds(tmp, ids) {
  const br = join(tmp, "br"); mkdirSync(br, { recursive: true });
  writeFileSync(join(br, "round-1.json"), JSON.stringify({
    signal: "needs-human",
    findings: ids.map((id, i) => ({ finding_id: id, severity: "critical", location: `f${i}.js:1`, title: id.split("::")[1] || `T${i}` })),
    author_replies: [],
  }));
  writeFileSync(join(tmp, "diff.txt"), ids.map((_, i) => `diff --git a/f${i}.js b/f${i}.js\n@@ -1,1 +1,1 @@\n-old\n+new\n`).join(""));
  return br;
}

function trackedDeps(over = {}) {
  const clk = { t: 0, step: 0 };
  const calls = [];
  const base = fakeDepsAlwaysOverturn();
  const deps = {
    ...base,
    now: () => clk.t,
    runReviewCall: (args) => {
      const cid = basename(args[args.indexOf("--diff") + 1]).replace(/-diff\.txt$/, "");
      const phase = isPhase1Args(args) ? 1 : 2;
      const ctx = JSON.parse(readFileSync(args[args.indexOf("--context") + 1], "utf8"));
      calls.push({ cid, phase, ctx });
      clk.t += clk.step * 1000;
      return over.respond ? over.respond({ cid, phase, args }) : base.runReviewCall(args);
    },
    ...over.deps,
  };
  return { deps, clk, calls };
}

async function callAssemble(tmp, br, extra, deps) {
  const lines = []; const errs = [];
  const log = console.log; const ew = process.stderr.write;
  console.log = (s) => { lines.push(String(s)); };
  process.stderr.write = (c) => { errs.push(String(c)); return true; };
  let code;
  try {
    code = await Promise.resolve(bje.cmdAssemble({ "--dir": br, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), "--out": join(tmp, "judge"), ...extra }, deps));
  } finally { console.log = log; process.stderr.write = ew; }
  return { code, out: lines.length ? JSON.parse(lines[lines.length - 1]) : null, err: errs.join("") };
}
const readLedger = (tmp) => JSON.parse(readFileSync(join(tmp, "judge", "ledger.json"), "utf8"));

test("cmdAssemble --budget-secs: 0, abc and 2.5 are usage errors that write nothing under --out", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    for (const bad of ["0", "abc", "2.5"]) {
      const { code } = await callAssemble(tmp, br, { "--budget-secs": bad }, trackedDeps().deps);
      assert.equal(code, 2, bad);
      assert.ok(!existsSync(join(tmp, "judge")), bad);
    }
  });
});

test("cmdAssemble: --budget-secs wins over the resolver, which is then never called", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const t = trackedDeps();
    t.clk.step = 100;
    t.deps.resolveBuildJudgeCallBudget = () => { throw new Error("resolver must not be called"); };
    // deadline 300 + 30 = 330 per attempt; budget 120 fits only the progress-guarantee attempt.
    const r = await callAssemble(tmp, br, { "--budget-secs": "120" }, t.deps);
    assert.equal(r.code, 3);
    assert.equal(t.calls.length, 1);
  });
});

test("cmdAssemble: a budget stop persists the ledger, exit 3 prints the progress keys, and the next call resumes without redoing ruled work", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y", "c.js::z"]);
    const t = trackedDeps();
    t.clk.step = 400; // each attempt costs 400s; deadline 300 + 30 means the next never fits in 540
    const seen = [];
    let r;
    for (let i = 0; i < 8; i++) {
      r = await callAssemble(tmp, br, {}, t.deps);
      seen.push(r);
      if (r.code !== 3) break;
    }
    assert.equal(seen.length, 6, "two attempts per case, one attempt per call");
    assert.deepEqual(seen.map((x) => x.code), [3, 3, 3, 3, 3, 0]);
    assert.deepEqual(seen.map((x) => x.out.resumed), [false, true, true, true, true, true]);
    const falling = seen.map((x) => x.out.attempts_remaining);
    for (let i = 1; i < falling.length; i++) assert.ok(falling[i] < falling[i - 1], `attempts_remaining falls: ${falling}`);
    assert.equal(falling[falling.length - 1], 0);
    assert.deepEqual(seen[0].out.remaining, ["f-01", "f-02", "f-03"]);
    assert.deepEqual(seen[5].out.remaining, []);
    assert.equal(seen[5].out.incomplete, false);
    assert.equal(t.calls.length, 6);
    assert.deepEqual(t.calls.map((c) => `${c.cid}:${c.phase}`), ["f-01:1", "f-01:2", "f-02:1", "f-02:2", "f-03:1", "f-03:2"]);
    const ledger = readLedger(tmp);
    for (const cid of ledger.order) {
      assert.equal(ledger.entries[cid].resolution, "overturned");
      const ruling = JSON.parse(readFileSync(join(tmp, "judge", `ruling-${cid}.json`), "utf8"));
      assert.deepEqual(ruling.binding, bje.bindingFor(ledger, cid));
      const recon = JSON.parse(readFileSync(join(tmp, "judge", `recon-${cid}.json`), "utf8"));
      assert.deepEqual(recon.binding, bje.bindingFor(ledger, cid));
      assert.equal(recon.stdout, RECON_STDOUT);
      assert.equal(statSync(join(tmp, "judge", `recon-${cid}.json`)).mode & 0o777, 0o600);
    }
    // Phase 2 ran from the persisted reconstruction (scrubbed), with zero Phase-1 re-runs.
    assert.equal(t.calls.filter((c) => c.phase === 2 && typeof c.ctx.reconstruction === "string").length, 3);
    assert.equal(t.calls.filter((c) => c.phase === 1).length, 3);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": join(tmp, "judge") }), 0);
  });
});

test("cmdAssemble: a call that stopped mid-pass leaves a judge dir that --admit refuses (exit 2)", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps(); t.clk.step = 400;
    const r = await callAssemble(tmp, br, {}, t.deps);
    assert.equal(r.code, 3);
    assert.equal(bje.cmdAdmit({ "--dir": br, "--level": "L3", "--out": join(tmp, "judge") }), 2);
  });
});

test("cmdAssemble: a call over a fully decided ledger makes no call, exits 0 with attempts_remaining 0", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const first = trackedDeps();
    assert.equal((await callAssemble(tmp, br, {}, first.deps)).code, 0);
    const again = trackedDeps();
    const r = await callAssemble(tmp, br, {}, again.deps);
    assert.equal(r.code, 0);
    assert.equal(again.calls.length, 0);
    assert.equal(r.out.resumed, true);
    assert.equal(r.out.attempts_remaining, 0);
    assert.equal(r.out.dispatched, 2);
  });
});

test("cmdAssemble: always-retry across calls makes exactly retryLimit + 1 Phase-1 calls and parks with the single-call cause", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps({ respond: () => ({ code: 5, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async () => "retry", resolveBuildJudgeClock: () => ({ deadline: 300, timeout: 90 }) } });
    t.clk.step = 600;
    const rs = [];
    for (let i = 0; i < 6; i++) { const r = await callAssemble(tmp, br, { "--retry-limit": "2" }, t.deps); rs.push(r); if (r.code !== 3) break; }
    assert.deepEqual(rs.map((r) => r.code), [3, 3, 0]);
    assert.deepEqual(rs.slice(0, 2).map((r) => r.out.attempts_remaining), [5, 4]);
    assert.equal(rs[2].out.attempts_remaining, 0);
    assert.equal(t.calls.length, 3);
    assert.ok(t.calls.every((c) => c.phase === 1));
    const e = readLedger(tmp).entries["f-01"];
    assert.equal(e.resolution, "parked");
    assert.equal(e.park_cause, 'phase-1 dispatch disposition "retry" (exit 5)');
    assert.equal(e.judge_progress.phase1_attempts, 3);
  });
});

test("cmdAssemble: a budget smaller than one attempt runs exactly one attempt per call, with a stderr advisory naming both numbers", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps({ deps: { resolveBuildJudgeClock: () => ({ deadline: 300, timeout: 90 }) } });
    const rs = [];
    for (let i = 0; i < 5; i++) { const before = t.calls.length; const r = await callAssemble(tmp, br, { "--budget-secs": "10" }, t.deps); assert.equal(t.calls.length - before, 1); rs.push(r); if (r.code !== 3) break; }
    assert.deepEqual(rs.map((r) => r.code), [3, 0]);
    for (const r of rs) {
      assert.equal(r.err.split("\n").filter((l) => l.includes("each call will run one attempt")).length, 1);
      assert.match(r.err, /330s.*10s|\(300s\)\+grace\(30s\).*\(10s\)/);
    }
    assert.ok(rs[0].out.attempts_remaining > rs[1].out.attempts_remaining);
  });
});

test("cmdAssemble: the started-attempt counter is per invocation, so an attempt-less exhausted case does not defeat the progress guarantee", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const t = trackedDeps({ respond: ({ cid }) => (cid === "f-01" ? { code: 5, stdout: "", stderr: "" } : null) });
    // f-01: retry exit that is killed after its count was bumped (simulated by a throw), f-02 untouched.
    const base = t.deps.runReviewCall;
    let boom = true;
    t.deps.runReviewCall = (args) => { if (boom) { boom = false; throw new Error("killed"); } return base(args); };
    t.deps.judgeDispatchDisposition = async (exit) => (exit === 0 ? "ruling" : "retry");
    t.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, { "--retry-limit": "0" }, t.deps)).code, 2);
    t.deps.runReviewCall = (args) => {
      const cid = basename(args[args.indexOf("--diff") + 1]).replace(/-diff\.txt$/, "");
      t.calls.push({ cid, phase: isPhase1Args(args) ? 1 : 2 });
      t.clk.t += 400000;
      return isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 0, stdout: VERDICT_STDOUT, stderr: "" };
    };
    const r = await callAssemble(tmp, br, { "--retry-limit": "0" }, t.deps);
    // f-01 exhausts at resume with no attempt (did not complete); f-02 then still gets its guaranteed attempt, then the budget stops.
    assert.equal(readLedger(tmp).entries["f-01"].park_cause, "phase-1 attempts exhausted: attempt 1 of 1 did not complete");
    assert.equal(r.code, 3);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].cid, "f-02");
  });
});

test("cmdAssemble: a kill mid-dispatch keeps earlier park causes and the in-flight attempt count; a later call with --retry-limit 0 parks it without a call", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const t = trackedDeps({
      respond: ({ cid, args }) => {
        if (cid === "f-02") throw new Error("killed");
        return { code: 1, stdout: "", stderr: "" }; // f-01: a park disposition
      },
    });
    t.deps.judgeDispatchDisposition = async () => "park";
    const r = await callAssemble(tmp, br, {}, t.deps);
    assert.equal(r.code, 2);
    const ledger = readLedger(tmp);
    assert.equal(ledger.entries["f-01"].resolution, "parked");
    assert.equal(ledger.entries["f-01"].park_cause, 'phase-1 dispatch disposition "park" (exit 1)');
    assert.equal(ledger.entries["f-02"].judge_progress.phase1_attempts, 1);
    assert.equal(ledger.entries["f-02"].judge_progress.last_exit, null);

    const again = trackedDeps();
    const r2 = await callAssemble(tmp, br, { "--retry-limit": "0" }, again.deps);
    assert.equal(r2.code, 0);
    assert.equal(again.calls.length, 0);
    assert.equal(readLedger(tmp).entries["f-02"].park_cause, "phase-1 attempts exhausted: attempt 1 of 1 did not complete");
  });
});

test("cmdAssemble: a pre-judge_progress ledger with the same identity resumes from zero counts", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3);
    const ledger = readLedger(tmp);
    delete ledger.entries["f-01"].judge_progress;
    rmSync(join(tmp, "judge", "recon-f-01.json"));
    writeFileSync(join(tmp, "judge", "ledger.json"), JSON.stringify(ledger));
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, {}, t.deps);
    assert.equal(r.code, 0);
    assert.equal(r.out.resumed, true);
    assert.deepEqual(t.calls.map((c) => c.phase), [1, 2]);
  });
});

test("cmdAssemble: a missing or wrongly bound recon file on resume parks the case with no call", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3);
    const reconPath = join(tmp, "judge", "recon-f-01.json");
    const recon = JSON.parse(readFileSync(reconPath, "utf8"));
    assert.deepEqual(recon.binding, bje.bindingFor(readLedger(tmp), "f-01"));
    writeFileSync(reconPath, JSON.stringify({ ...recon, binding: { ...recon.binding, case_sha: "other" } }));
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, {}, t.deps);
    assert.equal(r.code, 0);
    assert.equal(t.calls.length, 0);
    assert.equal(readLedger(tmp).entries["f-01"].park_cause, "phase-1 reconstruction missing or unbound on resume");
  });
});

test("cmdAssemble: a missing recon file on resume also parks", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3);
    rmSync(join(tmp, "judge", "recon-f-01.json"));
    const t = trackedDeps();
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 0);
    assert.equal(t.calls.length, 0);
    assert.equal(readLedger(tmp).entries["f-01"].park_cause, "phase-1 reconstruction missing or unbound on resume");
  });
});

test("cmdAssemble: identity mismatch (changed set, changed case content, malformed ledger, pre-case_sha ledger) starts fresh and sweeps ruling, recon and admit-result files first", async () => {
  const stage = async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3); // leaves recon-f-01.json
    writeFileSync(join(tmp, "judge", "ruling-f-01.json"), "{}");
    writeFileSync(join(tmp, "judge", "admit-result.json"), "{}");
    return br;
  };
  const sweptThenKilled = (tmp) => {
    const seen = { names: null };
    const deps = trackedDeps({ respond: () => { seen.names = readdirSync(join(tmp, "judge")).filter((n) => /^(ruling|recon)-.+\.json$/.test(n) || n === "admit-result.json"); throw new Error("killed"); } }).deps;
    return { seen, deps };
  };
  const variants = {
    "changed adjudication set": async (tmp, br) => { writeBrRounds(tmp, ["b.js::y"]); return {}; },
    "changed case content, same finding and diff": async (tmp) => { writeFileSync(join(tmp, "ac.md"), "new acceptance criteria"); return { "--acceptance-criteria": join(tmp, "ac.md") }; },
    "malformed ledger": async (tmp) => { writeFileSync(join(tmp, "judge", "ledger.json"), "{not json"); return {}; },
    "pre-case_sha ledger": async (tmp) => {
      const l = readLedger(tmp); delete l.entries["f-01"].case_sha; writeFileSync(join(tmp, "judge", "ledger.json"), JSON.stringify(l)); return {};
    },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    await withTmp(async (tmp) => {
      const br = await stage(tmp);
      const extra = await mutate(tmp, br);
      const { seen, deps } = sweptThenKilled(tmp);
      const r = await callAssemble(tmp, br, extra, deps);
      assert.equal(r.code, 2, name);
      assert.deepEqual(seen.names, [], name);
      const e = readLedger(tmp).entries["f-01"];
      assert.equal(e.judge_progress.phase1_attempts, 1, `${name}: counts restart at 0 then bump`);
    });
  }
});

test("cmdAssemble: on an identity match no ruling or recon file of the pass is deleted", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const t = trackedDeps(); t.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 3);
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 3);
    const before = readdirSync(join(tmp, "judge")).filter((n) => /^(ruling|recon)-/.test(n)).sort();
    assert.deepEqual(before, ["recon-f-01.json", "ruling-f-01.json"]);
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 3);
    for (const n of before) assert.ok(existsSync(join(tmp, "judge", n)), n);
  });
});

test("cmdAssemble: an unresolvable backend chain on resume parks only pending-unruled entries", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const t = trackedDeps(); t.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 3);
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 3); // f-01 overturned; f-02 pending-unruled
    const r = await callAssemble(tmp, br, {}, { ...t.deps, resolveAdversarialBackends: () => ({ error: "unset" }) });
    assert.equal(r.code, 0);
    const ledger = readLedger(tmp);
    assert.equal(ledger.entries["f-01"].resolution, "overturned");
    assert.equal(ledger.entries["f-01"].ruling.outcome, "OVERTURN");
    assert.equal(ledger.entries["f-02"].resolution, "parked");
    assert.match(ledger.entries["f-02"].park_cause, /backend config unset/);
  });
});

test("cmdAssemble: ledger.json is written through a .tmp file and rename, stays mode 0600, and leaves no .tmp behind", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const fsMod = require("node:fs");
    const origRename = fsMod.renameSync;
    const renames = [];
    fsMod.renameSync = (from, to) => { renames.push([basename(from), basename(to)]); return origRename(from, to); };
    try { assert.equal((await callAssemble(tmp, br, {}, trackedDeps().deps)).code, 0); }
    finally { fsMod.renameSync = origRename; }
    assert.ok(renames.length >= 4 && renames.every(([f, t]) => f === "ledger.json.tmp" && t === "ledger.json"));
    assert.equal(statSync(join(tmp, "judge", "ledger.json")).mode & 0o777, 0o600);
    assert.ok(!existsSync(join(tmp, "judge", "ledger.json.tmp")));
  });
});

test("cmdAssemble: a ledger persisted mid-call names each phase's progress before the attempt runs", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const snaps = [];
    const t = trackedDeps({ respond: ({ phase, args }) => { snaps.push(readLedger(tmp).entries["f-01"].judge_progress); return isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 0, stdout: VERDICT_STDOUT, stderr: "" }; } });
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 0);
    assert.deepEqual(snaps[0], { phase1_attempts: 1, phase2_attempts: 0, last_exit: null, reconstruction: null });
    assert.deepEqual(snaps[1], { phase1_attempts: 1, phase2_attempts: 1, last_exit: null, reconstruction: "recon-f-01.json" });
  });
});

// --- FAFF-1276: carried ids and the rebuttal rule --------------------------------------------

const crit = (location, title, carried_id) => ({ severity: "critical", location, title, ...(carried_id ? { carried_id } : {}) });
const rebut = (finding_ref, rebuttal_text) => ({ finding_ref, kind: "rebuttal", rebuttal_text });

test("collectAdjudicationSet: a round-1 rebuttal reaches a round-3 critical that carried its id under an unchanged title", () => {
  const rounds = [
    { findings: [crit("a.js:3", "Leaks fd")], author_replies: [rebut("a.js::leaks fd", "closed in finally")] },
    { findings: [crit("a.js:4", "leaks fd", "P1")], author_replies: [] },
    { findings: [crit("a.js:5", "Leaks FD.", "P1")], author_replies: [] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.deepEqual(set.map((e) => [e.finding_id, e.rebuttal_text, e.requires_confirm]), [["a.js::leaks fd", "closed in finally", false]]);
});

test("collectAdjudicationSet: a round-1 rebuttal does not reach a round-3 critical that carried its id under a different title (null-defence)", () => {
  const rounds = [
    { findings: [crit("a.js:3", "leaks fd")], author_replies: [rebut("a.js::leaks fd", "closed in finally")] },
    { findings: [crit("a.js:4", "fd never closed", "P1")], author_replies: [] },
    { findings: [crit("a.js:5", "fd never closed", "P1")], author_replies: [] },
  ];
  const set = bje.collectAdjudicationSet(rounds);
  assert.equal(set.length, 1);
  assert.equal(set[0].finding_id, "a.js::leaks fd");
  assert.equal(set[0].rebuttal_text, undefined);
  assert.equal(bje.latestRebuttalFor("a.js::leaks fd", rounds), undefined);
});

test("collectAdjudicationSet: a rebuttal for an uncarried finding is unchanged", () => {
  const rounds = [
    { findings: [crit("a.js:3", "leaks fd")], author_replies: [rebut("a.js::leaks fd", "closed in finally")] },
    { findings: [crit("a.js:9", "leaks fd")], author_replies: [] },
  ];
  assert.equal(bje.collectAdjudicationSet(rounds)[0].rebuttal_text, "closed in finally");
});

test("computeCriticalFreeLatestFloor: a round-2 critical carrying a round-1 critical matches a repeated title", async () => {
  const ledger = { entries: { "f-01": { finding_id: "a.js::leaks fd" } } };
  const rulings = { "f-01": { outcome: "OVERTURN" } };
  const floorFor = (round2) => withTmp((tmp) => {
    writeFileSync(join(tmp, "round-1.json"), JSON.stringify({ findings: [crit("a.js:3", "leaks fd")], author_replies: [] }));
    writeFileSync(join(tmp, "round-2.json"), JSON.stringify({ findings: [round2], author_replies: [] }));
    return bje.computeCriticalFreeLatestFloor(tmp, ledger, rulings);
  });
  const carried = await floorFor(crit("a.js:8", "fd never closed", "P1"));
  const repeated = await floorFor(crit("a.js:8", "leaks fd"));
  assert.equal(carried, true);
  assert.equal(carried, repeated);
});

// --- FAFF-1249: park_class, --reopen-for-hold and the reopened summary field -----------------

const withHold = (t, limit = 2) => ({ ...t.deps, resolveBuildReviewHoldLimit: () => limit, ...(t.extra || {}) });
const respondOk = (args) => (isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 0, stdout: VERDICT_STDOUT, stderr: "" });
const writeLedger = (tmp, ledger) => writeFileSync(join(tmp, "judge", "ledger.json"), JSON.stringify(ledger));

test("constants: the hold limit default matches config.js DEFAULTS, and the resolver falls back on invalid values", () => {
  const { DEFAULTS } = require("../plugin/skills/faff/bin/lib/config.js");
  assert.equal(bje.DEFAULT_BUILD_REVIEW_HOLD_LIMIT, 2);
  assert.equal(DEFAULTS["graft.build_review_hold_limit"], String(bje.DEFAULT_BUILD_REVIEW_HOLD_LIMIT));
  assert.equal(bje.resolveBuildReviewHoldLimit({}), 2);
  assert.equal(bje.resolveBuildReviewHoldLimit({ graft: { build_review_hold_limit: "4" } }), 4);
  assert.equal(bje.resolveBuildReviewHoldLimit({ graft: { build_review_hold_limit: "abc" } }), 2);
});

test("park_class: exhausted Phase-1 retries park as outage, with the park_cause string unchanged", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps({ respond: () => ({ code: 5, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async () => "retry" } });
    assert.equal((await callAssemble(tmp, br, { "--retry-limit": "1" }, t.deps)).code, 0);
    const e = readLedger(tmp).entries["f-01"];
    assert.equal(e.park_class, "outage");
    assert.equal(e.park_cause, 'phase-1 dispatch disposition "retry" (exit 5)');
  });
});

test("park_class: exhausted Phase-2 retries park as outage", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps({ respond: ({ args }) => (isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 8, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "retry") } });
    assert.equal((await callAssemble(tmp, br, { "--retry-limit": "0" }, t.deps)).code, 0);
    const e = readLedger(tmp).entries["f-01"];
    assert.equal(e.park_class, "outage");
    assert.match(e.park_cause, /^phase-2 dispatch disposition "retry"/);
  });
});

test("park_class: an attempt killed before it recorded an exit parks as outage on the next call", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3);
    const ledger = readLedger(tmp);
    ledger.entries["f-01"].judge_progress = { phase1_attempts: 3, phase2_attempts: 0, last_exit: null, reconstruction: null };
    delete ledger.entries["f-01"].ruling;
    writeLedger(tmp, ledger);
    const t = trackedDeps();
    assert.equal((await callAssemble(tmp, br, { "--retry-limit": "2" }, t.deps)).code, 0);
    assert.equal(t.calls.length, 0);
    const e = readLedger(tmp).entries["f-01"];
    assert.equal(e.park_class, "outage");
    assert.match(e.park_cause, /did not complete/);
  });
});

test("park_class: an unset or malformed backend chain parks as backend-chain", async () => {
  for (const result of [{ error: "unset" }, { error: "malformed", detail: "bad ref" }]) {
    await withTmp(async (tmp) => {
      const br = writeBrRounds(tmp, ["a.js::x"]);
      const t = trackedDeps({ deps: { resolveAdversarialBackends: () => result } });
      assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 0);
      assert.equal(readLedger(tmp).entries["f-01"].park_class, "backend-chain");
    });
  }
});

test("park_class: every other dispatch park is final", async () => {
  const scenarios = {
    "phase-1 park disposition": { respond: () => ({ code: 2, stdout: "", stderr: "" }) },
    "invalid reconstruction": { respond: () => ({ code: 0, stdout: "too short", stderr: "" }) },
    "phase-2 park disposition": { respond: ({ args }) => (isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 2, stdout: "", stderr: "" }) },
    "unparseable verdict block": { respond: ({ args }) => (isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 0, stdout: "no block here", stderr: "" }) },
  };
  for (const [name, over] of Object.entries(scenarios)) {
    await withTmp(async (tmp) => {
      const br = writeBrRounds(tmp, ["a.js::x"]);
      const t = trackedDeps({ ...over, deps: { judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "park") } });
      assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 0, name);
      const e = readLedger(tmp).entries["f-01"];
      assert.equal(e.resolution, "parked", name);
      assert.equal(e.park_class, "final", name);
    });
  }
});

test("park_class: a missing reconstruction on resume is final", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps(); t0.clk.step = 400;
    assert.equal((await callAssemble(tmp, br, {}, t0.deps)).code, 3);
    rmSync(join(tmp, "judge", "recon-f-01.json"));
    const t = trackedDeps();
    assert.equal((await callAssemble(tmp, br, {}, t.deps)).code, 0);
    assert.equal(readLedger(tmp).entries["f-01"].park_class, "final");
  });
});

test("park_class: an assemble-time park carries none", async () => {
  await withTmp(async (tmp) => {
    const br = join(tmp, "br"); mkdirSync(br);
    writeFileSync(join(br, "round-1.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [],
    }));
    writeFileSync(join(br, "round-2.json"), JSON.stringify({
      signal: "needs-human",
      findings: [{ severity: "critical", location: "a.js:1", title: "X" }],
      author_replies: [{ finding_ref: "a.js::x", kind: "rebuttal", rebuttal_text: "normal\n@@ -1,3 +1,4 @@\ninjected diff marker" }],
    }));
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, {}, t.deps);
    assert.equal(r.code, 0);
    const parked = Object.values(readLedger(tmp).entries).filter((e) => e.resolution === "parked");
    assert.ok(parked.length > 0, "the fixture must park at assemble time");
    for (const e of parked) assert.equal(e.park_class, undefined);
    assert.equal(t.calls.length, 0);
  });
});

// Two cases: f-01 ruled OVERTURN on the first pass, f-02 parked as an outage on Phase 1 (no reconstruction).
async function twoCaseOutageFixture(tmp) {
  const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
  const t = trackedDeps({
    respond: ({ cid, args }) => (cid === "f-02" ? { code: 5, stdout: "", stderr: "" } : respondOk(args)),
    deps: { judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "retry") },
  });
  assert.equal((await callAssemble(tmp, br, { "--retry-limit": "2" }, t.deps)).code, 0);
  const l = readLedger(tmp);
  assert.equal(l.entries["f-01"].resolution, "overturned");
  assert.equal(l.entries["f-02"].park_class, "outage");
  return br;
}

test("--reopen-for-hold: an outage park is dispatched again from attempt 1, a ruled case is left alone, and a repeat of the same hold reopens nothing", async () => {
  await withTmp(async (tmp) => {
    const br = await twoCaseOutageFixture(tmp);
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(t));
    assert.equal(r.code, 0);
    assert.equal(r.out.resumed, true);
    assert.deepEqual(r.out.reopened, ["f-02"]);
    assert.deepEqual(t.calls.map((c) => [c.cid, c.phase]), [["f-02", 1], ["f-02", 2]], "f-01 is not dispatched, f-02 restarts at Phase 1");
    const l = readLedger(tmp);
    assert.deepEqual(l.reopened_for_holds, [1]);
    assert.equal(l.entries["f-02"].reopen_count, 1);
    assert.equal(l.entries["f-02"].resolution, "overturned");
    assert.equal(l.entries["f-02"].park_cause, undefined);
    assert.equal(l.entries["f-02"].park_class, undefined);
    assert.equal(l.entries["f-02"].judge_progress.phase1_attempts, 1, "reset to zero, then one attempt");

    const again = trackedDeps();
    const r2 = await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(again));
    assert.deepEqual(r2.out.reopened, []);
    assert.equal(again.calls.length, 0);
    assert.deepEqual(readLedger(tmp).reopened_for_holds, [1]);
  });
});

test("--reopen-for-hold: a second hold count reopens a park that failed again, and the hold is recorded", async () => {
  await withTmp(async (tmp) => {
    const br = await twoCaseOutageFixture(tmp);
    const failing = trackedDeps({ respond: () => ({ code: 5, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async () => "retry" } });
    const r1 = await callAssemble(tmp, br, { "--reopen-for-hold": "1", "--retry-limit": "2" }, withHold(failing));
    assert.deepEqual(r1.out.reopened, ["f-02"]);
    assert.equal(readLedger(tmp).entries["f-02"].park_class, "outage");
    assert.equal(failing.calls.length, 3, "a full budget of retryLimit + 1 attempts for the hold");
    const ok2 = trackedDeps();
    const r2 = await callAssemble(tmp, br, { "--reopen-for-hold": "2", "--retry-limit": "2" }, withHold(ok2));
    assert.deepEqual(r2.out.reopened, ["f-02"]);
    const l = readLedger(tmp);
    assert.deepEqual(l.reopened_for_holds, [1, 2]);
    assert.equal(l.entries["f-02"].reopen_count, 2);
  });
});

test("--reopen-for-hold: a reopened case with a persisted reconstruction resets only Phase 2 and makes no Phase-1 call", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t0 = trackedDeps({ respond: ({ args }) => (isPhase1Args(args) ? { code: 0, stdout: RECON_STDOUT, stderr: "" } : { code: 5, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "retry") } });
    assert.equal((await callAssemble(tmp, br, { "--retry-limit": "1" }, t0.deps)).code, 0);
    const parked = readLedger(tmp).entries["f-01"];
    assert.equal(parked.park_class, "outage");
    assert.equal(parked.judge_progress.reconstruction, "recon-f-01.json");
    const reconBefore = readFileSync(join(tmp, "judge", "recon-f-01.json"), "utf8");
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, { "--reopen-for-hold": "1", "--retry-limit": "1" }, withHold(t));
    assert.deepEqual(r.out.reopened, ["f-01"]);
    assert.deepEqual(t.calls.map((c) => c.phase), [2], "no Phase-1 call");
    const e = readLedger(tmp).entries["f-01"];
    assert.equal(e.judge_progress.phase1_attempts, 1, "Phase 1 attempts untouched");
    assert.equal(e.judge_progress.phase2_attempts, 1);
    assert.equal(readFileSync(join(tmp, "judge", "recon-f-01.json"), "utf8"), reconBefore);
  });
});

test("--reopen-for-hold: a backend-chain park is reopened and re-parked with its class and a reopen_count, with no call made", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const unset = { resolveAdversarialBackends: () => ({ error: "unset" }) };
    const first = trackedDeps({ deps: unset });
    assert.equal((await callAssemble(tmp, br, {}, first.deps)).code, 0);
    const t = trackedDeps({ deps: unset });
    const r = await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(t));
    assert.deepEqual(r.out.reopened, ["f-01", "f-02"]);
    assert.equal(t.calls.length, 0);
    const l = readLedger(tmp);
    for (const cid of ["f-01", "f-02"]) {
      assert.equal(l.entries[cid].resolution, "parked");
      assert.equal(l.entries[cid].park_class, "backend-chain");
      assert.equal(l.entries[cid].reopen_count, 1);
      assert.match(l.entries[cid].park_cause, /backend config unset/);
    }
  });
});

test("--reopen-for-hold: final parks and parks with no class are never reopened", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x", "b.js::y"]);
    const first = trackedDeps({ respond: ({ cid }) => (cid === "f-01" ? { code: 0, stdout: "no block", stderr: "" } : { code: 2, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "park") } });
    assert.equal((await callAssemble(tmp, br, {}, first.deps)).code, 0);
    const ledger = readLedger(tmp);
    assert.equal(ledger.entries["f-01"].park_class, "final");
    delete ledger.entries["f-02"].park_class; // a ledger written before park_class existed
    writeLedger(tmp, ledger);
    const causes = ["f-01", "f-02"].map((cid) => ledger.entries[cid].park_cause);
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(t));
    assert.deepEqual(r.out.reopened, []);
    assert.equal(t.calls.length, 0);
    const l = readLedger(tmp);
    assert.deepEqual(["f-01", "f-02"].map((cid) => l.entries[cid].park_cause), causes);
    assert.ok(["f-01", "f-02"].every((cid) => l.entries[cid].resolution === "parked"));
    assert.deepEqual(l.reopened_for_holds, [1], "the hold is still recorded");
  });
});

test("--reopen-for-hold: a fresh ledger records the hold and reopens nothing, and a later matching call does not reopen either", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const t = trackedDeps({ respond: () => ({ code: 5, stdout: "", stderr: "" }), deps: { judgeDispatchDisposition: async () => "retry" } });
    t.clk.step = 600;
    const r1 = await callAssemble(tmp, br, { "--reopen-for-hold": "1", "--retry-limit": "2" }, withHold(t));
    assert.equal(r1.code, 3);
    assert.equal(r1.out.resumed, false);
    assert.deepEqual(r1.out.reopened, []);
    assert.deepEqual(readLedger(tmp).reopened_for_holds, [1]);
    let last;
    for (let i = 0; i < 4; i++) { last = await callAssemble(tmp, br, { "--reopen-for-hold": "1", "--retry-limit": "2" }, withHold(t)); assert.deepEqual(last.out.reopened, []); if (last.code !== 3) break; }
    assert.equal(t.calls.length, 3, "retryLimit + 1 attempts across the chunk calls: the matching resume reopened nothing");
    assert.equal(readLedger(tmp).entries["f-01"].park_class, "outage");
  });
});

test("--reopen-for-hold: a hold count above graft.build_review_hold_limit reopens and records nothing, and warns", async () => {
  await withTmp(async (tmp) => {
    const br = await twoCaseOutageFixture(tmp);
    const before = readLedger(tmp);
    const t = trackedDeps();
    const r = await callAssemble(tmp, br, { "--reopen-for-hold": "3" }, withHold(t, 2));
    assert.equal(r.code, 0);
    assert.deepEqual(r.out.reopened, []);
    assert.match(r.err, /build_review_hold_limit \(2\)/);
    assert.equal(t.calls.length, 0);
    const l = readLedger(tmp);
    assert.equal(l.reopened_for_holds, undefined);
    assert.deepEqual(l.entries["f-02"], before.entries["f-02"]);
  });
});

test("--reopen-for-hold: 0, -1, abc and 1.5 are usage errors (exit 2) that write nothing", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    for (const bad of ["0", "-1", "abc", "1.5", ""]) {
      const r = await callAssemble(tmp, br, { "--reopen-for-hold": bad }, trackedDeps().deps);
      assert.equal(r.code, 2, `value ${JSON.stringify(bad)}`);
      assert.ok(!existsSync(join(tmp, "judge")), `value ${JSON.stringify(bad)}`);
    }
  });
});

test("the summary always carries reopened, [] without the flag", async () => {
  await withTmp(async (tmp) => {
    const br = writeBrRounds(tmp, ["a.js::x"]);
    const r = await callAssemble(tmp, br, {}, trackedDeps().deps);
    assert.deepEqual(r.out.reopened, []);
    assert.equal(r.out.resumed, false);
    const again = await callAssemble(tmp, br, {}, trackedDeps().deps);
    assert.deepEqual(again.out.reopened, []);
  });
});

test("adjudicationIdentity ignores the reopen fields, so a reopened ledger still resumes", async () => {
  await withTmp(async (tmp) => {
    const br = await twoCaseOutageFixture(tmp);
    const before = bje.adjudicationIdentity(readLedger(tmp));
    await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(trackedDeps()));
    assert.equal(bje.adjudicationIdentity(readLedger(tmp)), before);
    assert.equal((await callAssemble(tmp, br, {}, trackedDeps().deps)).out.resumed, true);
  });
});

test("integration: an outage park survives stash and restore, and the resumed --assemble reopens it and --admit admits", async () => {
  await withTmp(async (tmp) => {
    const runA = join(tmp, "runA"); const runB = join(tmp, "runB"); const store = join(tmp, "store");
    const issueDir = join(runA, "TEST-1");
    const br = join(issueDir, "build-review"); mkdirSync(br, { recursive: true });
    for (const n of [1, 2]) {
      writeFileSync(join(br, `round-${n}.json`), JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical", location: "a.js:1", title: "X" }], author_replies: [] }));
    }
    writeFileSync(join(tmp, "diff.txt"), "diff --git a/a.js b/a.js\n@@ -1,1 +1,1 @@\n-old\n+new\n");
    const run = async (dir, extra, deps) => {
      const lines = []; const log = console.log;
      console.log = (s) => { lines.push(String(s)); };
      let code;
      try { code = await Promise.resolve(bje.cmdAssemble({ "--dir": dir, "--issue": "TEST-1", "--diff": join(tmp, "diff.txt"), ...extra }, deps)); } finally { console.log = log; }
      return { code, out: JSON.parse(lines[lines.length - 1]) };
    };
    const down = { ...fakeDepsAlwaysOverturn(), runReviewCall: () => ({ code: 5, stdout: "", stderr: "" }), judgeDispatchDisposition: async (x) => (x === 0 ? "ruling" : "retry") };
    await run(br, {}, down);
    assert.equal(JSON.parse(readFileSync(join(br, "judge", "ledger.json"), "utf8")).entries["f-01"].park_class, "outage");

    const stash = runCli(["resume-store", "stash", "--run-dir", runA, "--issue", "TEST-1", "--cause", "build-review-dialogue", "--fix-rounds-used", "1", "--rebuttal-rounds-used", "0", "--store-root", store]);
    assert.equal(stash.code, 0, stash.stderr);
    const held = JSON.parse(stash.stdout);
    assert.equal(held.dialogue.stage, "judge");
    assert.equal(held.dialogue.hold_count, 1);
    mkdirSync(runB);
    const back = runCli(["resume-store", "restore", "--run-dir", runB, "--issue", "TEST-1", "--store-root", store]);
    assert.equal(back.code, 0, back.stderr);

    const brB = join(runB, "TEST-1", "build-review");
    const r = await run(brB, { "--reopen-for-hold": String(held.dialogue.hold_count) }, { ...fakeDepsAlwaysOverturn(), resolveBuildReviewHoldLimit: () => 2 });
    assert.equal(r.code, 0);
    assert.equal(r.out.resumed, true);
    assert.deepEqual(r.out.reopened, ["f-01"]);
    assert.ok(!existsSync(join(brB, "round-3.json")), "no reviewer round ran");
    assert.equal(runCli(["build-judge-evidence", "--admit", "--dir", brB, "--level", "L3", "--run-dir", runB]).code, 0);
  });
});

test("--reopen-for-hold: the reopened ledger is on disk before the first dispatch of the call", async () => {
  await withTmp(async (tmp) => {
    const br = await twoCaseOutageFixture(tmp);
    let seen = null;
    const t = trackedDeps({ respond: ({ args }) => { if (!seen) seen = readLedger(tmp); return respondOk(args); } });
    await callAssemble(tmp, br, { "--reopen-for-hold": "1" }, withHold(t));
    assert.deepEqual(seen.reopened_for_holds, [1]);
    assert.equal(seen.entries["f-02"].resolution, "pending");
    assert.equal(seen.entries["f-02"].reopen_count, 1);
    assert.equal(seen.entries["f-02"].park_class, undefined);
  });
});
