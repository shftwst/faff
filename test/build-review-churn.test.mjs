// FAFF-996 — build-review-churn: detect a thrashing build-review dialogue loop. Sibling of
// test/spec-review-churn.test.mjs, ported to the finding-identity comparator: covers the pure
// comparator (all fixture cases), the CLI subcommand (stdout/exit-code contract, --selftest),
// and the missing-vs-malformed --prev/--curr split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import {
  BUILD_REVIEW_CHURN_CASES,
  computeChurn,
  standingCriticalIds,
  buildReviewChurnSelftest,
} from "../plugin/skills/faff/bin/lib/build-review-churn.js";

// --- Pure comparator: every fixture case ------------------------------------------------

test("computeChurn: fixture cases (identical/shrink/new-id/disjoint-swap/missing-prev/non-critical)", () => {
  for (const [name, prev, curr, prevRoundNumber, wantChurn, wantNewIds] of BUILD_REVIEW_CHURN_CASES) {
    const res = computeChurn(prev, curr, prevRoundNumber);
    assert.equal(res.churn, wantChurn, name);
    assert.deepEqual(res.new_critical_ids, wantNewIds, name);
  }
});

test("computeChurn: a same file+title finding whose location shifts by a line is the SAME identity — no churn (p-10)", () => {
  const prev = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:120", title: "T" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical", location: "foo.js:121", title: "T" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, false);
});

test("computeChurn: a genuinely new title at the same file is a NEW identity — churn (p-10)", () => {
  const prev = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "foo.js::t", severity: "critical" }, { finding_id: "foo.js::u", severity: "critical" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, true);
  assert.deepEqual(res.new_critical_ids, ["foo.js::u"]);
});

test("computeChurn: round 1 (no prior record) degrades safely", () => {
  const curr = { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const res = computeChurn(null, curr, null);
  assert.equal(res.churn, false);
  assert.equal(res.reason, "no prior round on disk");
});

test("computeChurn: mixed signal types — comparator only looks at findings", () => {
  const prev = { signal: "fail", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const curr = { signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] };
  const res = computeChurn(prev, curr, 1);
  assert.equal(res.churn, false);
});

// --- standingCriticalIds helper --------------------------------------------------------

test("standingCriticalIds: dedupes, sorts, tolerates malformed input, ignores non-critical severities", () => {
  assert.deepEqual(standingCriticalIds([{ finding_id: "b", severity: "critical" }, { finding_id: "a", severity: "critical" }, { finding_id: "b", severity: "critical" }]), ["a", "b"]);
  assert.deepEqual(standingCriticalIds(undefined), []);
  assert.deepEqual(standingCriticalIds("not-an-array"), []);
  assert.deepEqual(standingCriticalIds([{ notFinding: 1 }, null, { finding_id: "a", severity: "major" }, { finding_id: "b", severity: "critical" }]), ["b"]);
});

// --- in-process selftest ------------------------------------------------------------------

test("in-process selftest passes", () => {
  assert.equal(buildReviewChurnSelftest(), 0);
});

// --- CLI subcommand -------------------------------------------------------------------------

test("faff build-review-churn --prev --curr: prints a BuildReviewChurnResult, exit 0 (integration smoke test)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    const round2 = join(tmp, "round-2.json");
    writeFileSync(round1, JSON.stringify({ signal: "needs-human", findings: [{ finding_id: "a.js::x", severity: "critical" }] }));
    writeFileSync(round2, JSON.stringify({
      signal: "needs-human",
      findings: [{ finding_id: "a.js::x", severity: "critical" }, { finding_id: "b.js::y", severity: "critical" }],
    }));
    const r = runCli(["build-review-churn", "--prev", round1, "--curr", round2]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.churn, true);
    assert.deepEqual(parsed.new_critical_ids, ["b.js::y"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: missing --prev degrades to churn:false, exit 0 (round-1 shape)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    writeFileSync(round1, JSON.stringify({ signal: "pass", findings: [] }));
    const r = runCli(["build-review-churn", "--prev", join(tmp, "round-0-never-written.json"), "--curr", round1]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).churn, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: malformed --prev fails loud, exit 2, nothing on stdout", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const badPrev = join(tmp, "round-1.json");
    writeFileSync(badPrev, "not valid json");
    const curr = join(tmp, "round-2.json");
    writeFileSync(curr, JSON.stringify({ signal: "pass", findings: [] }));
    const r = runCli(["build-review-churn", "--prev", badPrev, "--curr", curr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: malformed --curr fails loud, exit 2", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-cli-"));
  try {
    const prev = join(tmp, "round-1.json");
    writeFileSync(prev, JSON.stringify({ signal: "pass", findings: [] }));
    const badCurr = join(tmp, "round-2.json");
    writeFileSync(badCurr, "not valid json");
    const r = runCli(["build-review-churn", "--prev", prev, "--curr", badCurr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff build-review-churn: missing both flags exits 2, usage on stderr", () => {
  const r = runCli(["build-review-churn"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: faff build-review-churn/);
});

test("faff build-review-churn --selftest exits 0 and reports PASS", () => {
  const r = runCli(["build-review-churn", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// --- FAFF-1266: ids come from title + location (finding-id.js) ----------------------------------

test("churn: a title/location-derived id wins over a stale stored finding_id; a line shift does not churn", () => {
  const prev = { signal: "needs-human", findings: [{ severity: "critical", location: "a.js:9", title: "Missing null check" }] };
  const curr = { signal: "needs-human", findings: [{ severity: "critical", location: "./a.js:14", title: "Missing `null` check.", finding_id: "a.js::missing null check" }] };
  const res = computeChurn(prev, curr, 1, 2);
  assert.equal(res.churn, false);
  assert.deepEqual(res.curr_critical_ids, ["a.js::missing null check"]);
});

test("standingCriticalIds: two same-round criticals with equal normalised titles in one file are two standing ids", () => {
  const ids = standingCriticalIds([
    { severity: "critical", location: "src/x.js:3", title: "Leaks fd" },
    { severity: "critical", location: "./src/x.js:40", title: "leaks  FD" },
  ], 1);
  assert.deepEqual(ids, ["src/x.js::leaks fd", "src/x.js::leaks fd#2"]);
});

test("standingCriticalIds: an untitled, id-less critical counts as standing under a round-scoped id", () => {
  assert.deepEqual(standingCriticalIds([{ severity: "major" }, { severity: "critical" }], 2), ["round-2#1"]);
});

test("computeChurn: an untitled, id-less critical recurring in a later round churns", () => {
  const prev = { signal: "needs-human", findings: [{ severity: "critical" }] };
  const curr = { signal: "needs-human", findings: [{ severity: "critical" }] };
  assert.equal(computeChurn(prev, curr, 1, 2).churn, true);
  assert.equal(computeChurn(prev, curr, null).churn, true);
});

test("faff build-review-churn smoke: the same critical at a shifted location with a wrong stored id does not churn", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-ids-"));
  try {
    const round1 = join(tmp, "round-1.json");
    const round2 = join(tmp, "round-2.json");
    writeFileSync(round1, JSON.stringify({ signal: "needs-human", findings: [{ severity: "critical", location: "./a.js:3", title: "Leaks fd" }] }));
    writeFileSync(round2, JSON.stringify({ signal: "needs-human", findings: [{ severity: "critical", location: "a.js:30", title: "leaks FD", finding_id: "wrong" }] }));
    const r = runCli(["build-review-churn", "--prev", round1, "--curr", round2]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.churn, false);
    assert.deepEqual(parsed.curr_critical_ids, ["a.js::leaks fd"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- FAFF-1276: carried ids resolve through the round chain --------------------------------

function withRounds(records, fn) {
  const tmp = mkdtempSync(join(tmpdir(), "faff-build-review-churn-carry-"));
  try {
    records.forEach((rec, i) => writeFileSync(join(tmp, `round-${i + 1}.json`), typeof rec === "string" ? rec : JSON.stringify(rec)));
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const crit = (location, title, carried_id) => ({ severity: "critical", location, title, ...(carried_id ? { carried_id } : {}) });

test("faff build-review-churn: scenario — a reworded critical that carries P1 does not churn and is listed as carried", () => {
  withRounds([
    { signal: "needs-human", findings: [crit("a.js:3", "leaks fd")] },
    { signal: "needs-human", findings: [crit("a.js:40", "file descriptor not closed", "P1")] },
  ], (dir) => {
    const r = runCli(["build-review-churn", "--prev", join(dir, "round-1.json"), "--curr", join(dir, "round-2.json")]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.churn, false);
    assert.deepEqual(parsed.curr_critical_ids, ["a.js::leaks fd"]);
    assert.deepEqual(parsed.carried_critical_ids, ["a.js::leaks fd"]);
    assert.equal(parsed.chain_rounds, undefined);
  });
});

test("faff build-review-churn: --prev round-2 --curr round-3 resolves round 2's carry through round 1", () => {
  withRounds([
    { signal: "needs-human", findings: [crit("a.js:3", "leaks fd")] },
    { signal: "needs-human", findings: [crit("a.js:4", "fd never closed", "P1")] },
    { signal: "needs-human", findings: [crit("a.js:5", "descriptor left open", "P1")] },
  ], (dir) => {
    const r = runCli(["build-review-churn", "--prev", join(dir, "round-2.json"), "--curr", join(dir, "round-3.json")]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual([parsed.churn, parsed.prev_critical_ids, parsed.curr_critical_ids], [false, ["a.js::leaks fd"], ["a.js::leaks fd"]]);
  });
});

test("faff build-review-churn: a malformed earlier round in the directory exits 2 naming it", () => {
  withRounds(["not json", { findings: [crit("a.js:4", "x")] }, { findings: [crit("a.js:4", "x")] }], (dir) => {
    const r = runCli(["build-review-churn", "--prev", join(dir, "round-2.json"), "--curr", join(dir, "round-3.json")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /round-1\.json/);
  });
});

test("faff build-review-churn: --prev and --curr in different directories resolve two rounds, say so, and report chain_rounds", () => {
  withRounds([{ findings: [crit("a.js:3", "leaks fd")] }], (dirA) => withRounds([{ findings: [] }, { findings: [crit("a.js:9", "fd never closed", "P1")] }], (dirB) => {
    const r = runCli(["build-review-churn", "--prev", join(dirA, "round-1.json"), "--curr", join(dirB, "round-2.json")]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.chain_rounds, 2);
    assert.equal(parsed.churn, false);
    assert.match(r.stderr, /different directories/);
  }));
});

test("computeChurn: earlier rounds resolve a carry; with none, a wrong carry is refused and churns", () => {
  const earlier = [{ round: 1, record: { findings: [crit("a.js:1", "leaks fd")] } }];
  const prev = { findings: [crit("a.js:2", "fd never closed", "P1")] };
  const curr = { findings: [crit("a.js:3", "fd still open", "P1")] };
  assert.equal(computeChurn(prev, curr, 2, 3, earlier).churn, false);
  const wrongFile = { findings: [crit("b.js:3", "fd still open", "P1")] };
  const res = computeChurn(prev, wrongFile, 2, 3, earlier);
  assert.deepEqual([res.churn, res.carried_critical_ids, res.refused_carries], [true, [], 1]);
  assert.equal(computeChurn(prev, curr, 2, 3, earlier).refused_carries, 0);
});

test("smoke (FAFF-1276): review-prior lists the round-2 finding and churn holds steady across the carry", () => {
  withRounds([
    { signal: "needs-human", findings: [crit("./a.js:3", "Leaks fd")] },
    { signal: "needs-human", findings: [crit("a.js:30", "fd never closed", "P1")] },
  ], (dir) => {
    const prior = runCli(["review-prior", "--dir", dir]);
    assert.equal(prior.code, 0, prior.stderr);
    assert.deepEqual(JSON.parse(prior.stdout), { round: 2, findings: [{ handle: "P1", title: "fd never closed", location: "a.js:30", severity: "critical" }] });
    const r = runCli(["build-review-churn", "--prev", join(dir, "round-1.json"), "--curr", join(dir, "round-2.json")]);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual([parsed.churn, parsed.curr_critical_ids], [false, ["a.js::leaks fd"]]);
  });
});
