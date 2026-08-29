// FAFF-707 — spec-review-churn: detect a non-converging prep↔review loop. Covers the
// pure comparator (all fixture cases in SPEC_REVIEW_CHURN_CASES), the CLI subcommand
// (stdout/exit-code contract, --selftest), the missing-vs-malformed --prev/--curr split,
// and the faff-prep/SKILL.md wiring (Loop cap paragraph + Park causes entry) this
// resolver plugs into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  SPEC_REVIEW_CHURN_CASES,
  detectSpecReviewChurn,
  lensSet,
  readRoundRecord,
  roundNumberFromPath,
  specReviewChurnSelftest,
} from "../plugin/skills/faff/bin/lib/spec-review-churn.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const PREP_SKILL = join(REPO, "plugin", "skills", "faff-prep", "SKILL.md");

// --- Pure comparator: every fixture case ------------------------------------------------

test("detectSpecReviewChurn: fixture cases (identical/shrink/new-lens/disjoint-swap/missing-prev)", () => {
  for (const [name, prev, curr, prevRoundNumber, wantChurn, wantNewLenses] of SPEC_REVIEW_CHURN_CASES) {
    const res = detectSpecReviewChurn(prev, curr, prevRoundNumber);
    assert.equal(res.churn, wantChurn, name);
    assert.deepEqual(res.new_lenses, wantNewLenses, name);
  }
});

test("detectSpecReviewChurn: Scenario 1 (steady/shrinking lens-set) — no churn", () => {
  const prev = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }, { lens: "QA", severity: "minor" }] };
  const curr = { verdict: "revise", objections: [{ lens: "architectural", severity: "minor" }] };
  const res = detectSpecReviewChurn(prev, curr, 1);
  assert.equal(res.churn, false);
  assert.deepEqual(res.new_lenses, []);
});

test("detectSpecReviewChurn: Scenario 2 (new lens appears) — churn, names the new lens", () => {
  const prev = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] };
  const curr = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }, { lens: "infosec", severity: "blocker" }] };
  const res = detectSpecReviewChurn(prev, curr, 1);
  assert.equal(res.churn, true);
  assert.deepEqual(res.new_lenses, ["infosec"]);
  assert.match(res.reason, /new objecting lens\(es\) since round 1: infosec/);
});

test("detectSpecReviewChurn: round 1 (no prior record) — never invoked in practice, but degrades safely", () => {
  const curr = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] };
  const res = detectSpecReviewChurn(null, curr, null);
  assert.equal(res.churn, false);
  assert.equal(res.reason, "no prior round on disk");
});

test("detectSpecReviewChurn: mixed verdict types (revise vs reject-approach) — comparator only looks at objections", () => {
  const prev = { verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] };
  const curr = { verdict: "reject-approach", objections: [{ lens: "architectural", severity: "blocker" }] };
  const res = detectSpecReviewChurn(prev, curr, 1);
  assert.equal(res.churn, false, "same lens-set regardless of which verdict type produced it");
});

// --- lensSet / roundNumberFromPath helpers -----------------------------------------------

test("lensSet: dedupes, sorts, tolerates malformed input", () => {
  assert.deepEqual(lensSet([{ lens: "QA" }, { lens: "architectural" }, { lens: "QA" }]), ["QA", "architectural"]);
  assert.deepEqual(lensSet(undefined), []);
  assert.deepEqual(lensSet("not-an-array"), []);
  assert.deepEqual(lensSet([{ notLens: 1 }, null, { lens: "infosec" }]), ["infosec"]);
});

test("roundNumberFromPath: parses round-<n>.json, null otherwise", () => {
  assert.equal(roundNumberFromPath("/a/b/round-1.json"), 1);
  assert.equal(roundNumberFromPath("/a/b/round-12.json"), 12);
  assert.equal(roundNumberFromPath("/a/b/prev.json"), null);
  assert.equal(roundNumberFromPath(undefined), null);
});

// --- readRoundRecord: missing vs malformed ------------------------------------------------

test("readRoundRecord: distinguishes missing (ENOENT) from malformed (bad JSON)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-spec-review-churn-test-"));
  try {
    const missing = readRoundRecord(join(tmp, "does-not-exist.json"));
    assert.equal(missing.missing, true);
    assert.equal(missing.malformed, undefined);

    const badPath = join(tmp, "bad.json");
    writeFileSync(badPath, "{ not json");
    const malformed = readRoundRecord(badPath);
    assert.equal(malformed.missing, undefined);
    assert.ok(malformed.malformed);

    const goodPath = join(tmp, "good.json");
    writeFileSync(goodPath, JSON.stringify({ verdict: "revise", objections: [] }));
    const good = readRoundRecord(goodPath);
    assert.deepEqual(good.record, { verdict: "revise", objections: [] });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// --- in-process selftest ------------------------------------------------------------------

test("in-process selftest passes", () => {
  assert.equal(specReviewChurnSelftest(), 0);
});

// --- CLI subcommand -------------------------------------------------------------------------

test("faff spec-review-churn --prev --curr: prints a SpecReviewChurnResult, exit 0 (integration smoke test)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-spec-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    const round2 = join(tmp, "round-2.json");
    writeFileSync(round1, JSON.stringify({ verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] }));
    writeFileSync(round2, JSON.stringify({
      verdict: "revise",
      objections: [{ lens: "architectural", severity: "major" }, { lens: "infosec", severity: "blocker" }],
    }));
    const r = runCli(["spec-review-churn", "--prev", round1, "--curr", round2]);
    assert.equal(r.code, 0, r.stderr);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.churn, true);
    assert.deepEqual(parsed.new_lenses, ["infosec"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff spec-review-churn: missing --prev degrades to churn:false, exit 0 (round-1 shape)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-spec-review-churn-cli-"));
  try {
    const round1 = join(tmp, "round-1.json");
    writeFileSync(round1, JSON.stringify({ verdict: "revise", objections: [{ lens: "architectural", severity: "major" }] }));
    const r = runCli(["spec-review-churn", "--prev", join(tmp, "round-0-never-written.json"), "--curr", round1]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).churn, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff spec-review-churn: malformed --prev fails loud, exit 2, nothing on stdout", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-spec-review-churn-cli-"));
  try {
    const badPrev = join(tmp, "round-1.json");
    writeFileSync(badPrev, "not valid json");
    const curr = join(tmp, "round-2.json");
    writeFileSync(curr, JSON.stringify({ verdict: "revise", objections: [] }));
    const r = runCli(["spec-review-churn", "--prev", badPrev, "--curr", curr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff spec-review-churn: malformed --curr fails loud, exit 2", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-spec-review-churn-cli-"));
  try {
    const prev = join(tmp, "round-1.json");
    writeFileSync(prev, JSON.stringify({ verdict: "revise", objections: [] }));
    const badCurr = join(tmp, "round-2.json");
    writeFileSync(badCurr, "not valid json");
    const r = runCli(["spec-review-churn", "--prev", prev, "--curr", badCurr]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("faff spec-review-churn: missing both flags exits 2, usage on stderr", () => {
  const r = runCli(["spec-review-churn"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /usage: faff spec-review-churn/);
});

test("faff spec-review-churn --selftest exits 0 and reports PASS", () => {
  const r = runCli(["spec-review-churn", "--selftest"]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// --- faff-prep/SKILL.md wiring -------------------------------------------------------------

test("faff-prep/SKILL.md: Loop cap paragraph names the churn check and its downgrade behaviour", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  assert.match(body, /faff spec-review-churn/, "the Loop cap paragraph must resolve churn via the CLI, never eyeball it");
  assert.match(body, /churn: true/, "must name the churn:true downgrade");
  assert.match(body, /without spending|do not spend/i, "must state the earlier-bail behaviour (skip the remaining iteration)");
});

test("faff-prep/SKILL.md: Park causes gains a spec-review-churn entry", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  const parkCausesLine = body.split("\n").find((line) => line.startsWith("**Park causes**"));
  assert.ok(parkCausesLine, "Park causes line must exist");
  assert.match(parkCausesLine, /spec-review churn detected/, "Park causes must gain the churn-detected cause string");
});

test("faff-prep/SKILL.md: the count-cap resolves through the appetite resolver, with the convergence-yield clause preserved", () => {
  const body = readFileSync(PREP_SKILL, "utf8");
  // FAFF-908 (absorbed into FAFF-922): the fixed-2 cap is now an appetite-scaled ceiling `N`
  // resolved through the CLI — the Loop cap must name the resolver, never a bare integer.
  assert.match(body, /faff spec-review-iteration-cap/, "the Loop cap must resolve the ceiling via the resolver, never a hardcoded integer");
  assert.match(body, /unresolved `revise`\/`reject-approach`/, "the would-be-park fallback on N unresolved rounds must still be stated");
  // FAFF-874: the drift guard still pins the convergence-yield clause the count cap carries.
  assert.match(body, /faff spec-review-convergence/, "the Loop cap must resolve convergence via the CLI, never eyeball it");
  assert.match(body, /yields to a convergence signal/, "must state the count cap yields to the convergence signal");
  assert.match(body, /converging direction only/, "must state the yield is converging-direction-only (thrashing still parks)");
});
