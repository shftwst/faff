// FAFF-922 — the spec-review judge's evidence assembler. It never re-derives a layer's output;
// it shells the shipped convergence/churn/reputation/ratified-scope resolvers and passes their
// output through, plus the raw round records and two arithmetic derivations
// (blocker_free_latest reused verbatim; infosec_major_free_latest derived here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const events = require("../plugin/skills/faff/bin/lib/events.js");

function seed(dir, rounds) {
  rounds.forEach((objections, i) => {
    writeFileSync(join(dir, `round-${i + 1}.json`), JSON.stringify({ verdict: "reject-approach", objections }));
  });
}
function objs(total, lens = "architectural", { blockers = 0, majors = 0 } = {}) {
  const a = [];
  for (let i = 0; i < total; i++) {
    let severity = "minor";
    if (i < blockers) severity = "blocker";
    else if (i < blockers + majors) severity = "major";
    a.push({ lens, severity });
  }
  return a;
}
const BASE = ["--window-start", "1", "--level", "L4", "--appetite", "high", "--issue", "FAFF-999"];

test("plateau 13→13→13 (no blocker, no major infosec): converging:false, blocker_free_latest:true, infosec_major_free_latest:true, appetite_cap:5", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(13), objs(13), objs(13)]);
    const r = runCli(["spec-judge-evidence", "--dir", dir, ...BASE]);
    assert.equal(r.code, 0, r.stderr);
    const b = JSON.parse(r.stdout);
    assert.equal(b.convergence.converging, false, "plateau is not converging");
    assert.equal(b.blocker_free_latest, true);
    assert.equal(b.infosec_major_free_latest, true);
    assert.equal(b.appetite_cap, 5, "high → 5, via the re-exported resolver");
    assert.equal(b.rounds.length, 3);
    assert.equal(b.standing_objections.length, 13);
    assert.equal(b.level, "L4");
    // No pinned reviewer in a bare scratch dir → calibration degrades to unknown, never blocks.
    assert.equal(b.calibration.cleared, "unknown");
    assert.equal(b.churn.churn, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("convergence field equals spec-review-convergence verbatim; churn field equals spec-review-churn over the last two in-window rounds", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(14), objs(13), objs(8)]);
    const ev = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    const conv = JSON.parse(runCli(["spec-review-convergence", "--dir", dir, "--window-start", "1"]).stdout);
    assert.deepEqual(ev.convergence, conv, "convergence passed through verbatim, never re-derived");
    const churn = JSON.parse(runCli(["spec-review-churn", "--prev", join(dir, "round-2.json"), "--curr", join(dir, "round-3.json")]).stdout);
    assert.deepEqual(ev.churn, churn, "churn passed through verbatim over the last two in-window rounds");
    assert.equal(ev.blocker_free_latest, conv.blocker_free_latest, "blocker_free_latest reused from convergence");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a standing major-severity infosec objection sets infosec_major_free_latest:false (the security-severity floor input)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5), objs(4, "architectural").concat([{ lens: "infosec", severity: "major" }])]);
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    assert.equal(b.infosec_major_free_latest, false, "a major infosec objection is never free");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a standing MINOR infosec objection does not trip the floor (infosec_major_free_latest:true)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(3), objs(3), objs(2, "architectural").concat([{ lens: "infosec", severity: "minor" }])]);
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    assert.equal(b.infosec_major_free_latest, true, "a minor infosec objection is only taste — the floor is major+");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a standing blocker sets blocker_free_latest:false (the accept-bar guard input)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5), objs(5, "architectural", { blockers: 1 })]);
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    assert.equal(b.blocker_free_latest, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-935: the {claim, evidence, predicted_consequence} triple survives verbatim into standing_objections", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    const enriched = [
      { lens: "architectural", severity: "major", claim: "the loop cannot terminate", evidence: "How, step 3", predicted_consequence: "hangs on empty --dir" },
      { lens: "QA", severity: "minor", claim: "less elegant", evidence: "sec 2", predicted_consequence: "not separately stated" },
    ];
    seed(dir, [objs(3), enriched]);
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    assert.deepEqual(b.standing_objections, enriched, "the enriched objections pass through the assembler verbatim");
    // The enrichment changes no arithmetic floor: no blocker, no major infosec in the latest round.
    assert.equal(b.blocker_free_latest, true);
    assert.equal(b.infosec_major_free_latest, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-935: a legacy {lens, severity}-only round assembles and gates identically (back-compat)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5, "architectural", { blockers: 1 })]);
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    for (const o of b.standing_objections) {
      assert.ok(!("claim" in o) && !("evidence" in o) && !("predicted_consequence" in o), "a legacy objection carries no triple keys");
    }
    assert.equal(b.blocker_free_latest, false, "the blocker floor is unchanged on a legacy record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-935: spec-review-convergence and spec-review-churn output is byte-identical on legacy vs triple-enriched rounds", () => {
  const legacy = mkdtempSync(join(tmpdir(), "faff-legacy-"));
  const enriched = mkdtempSync(join(tmpdir(), "faff-enriched-"));
  try {
    const shape = [objs(4), objs(3), objs(2)];
    seed(legacy, shape);
    // same {lens, severity} shape, but every objection also carries the triple
    const withTriple = shape.map((round) => round.map((o) => ({ ...o, claim: "c", evidence: "e", predicted_consequence: "p" })));
    withTriple.forEach((objections, i) => {
      writeFileSync(join(enriched, `round-${i + 1}.json`), JSON.stringify({ verdict: "reject-approach", objections }));
    });
    const convL = JSON.parse(runCli(["spec-review-convergence", "--dir", legacy, "--window-start", "1"]).stdout);
    const convE = JSON.parse(runCli(["spec-review-convergence", "--dir", enriched, "--window-start", "1"]).stdout);
    assert.deepEqual(convE, convL, "convergence ignores the additive triple fields");
    const churnL = JSON.parse(runCli(["spec-review-churn", "--prev", join(legacy, "round-2.json"), "--curr", join(legacy, "round-3.json")]).stdout);
    const churnE = JSON.parse(runCli(["spec-review-churn", "--prev", join(enriched, "round-2.json"), "--curr", join(enriched, "round-3.json")]).stdout);
    assert.deepEqual(churnE, churnL, "churn ignores the additive triple fields");
  } finally {
    rmSync(legacy, { recursive: true, force: true });
    rmSync(enriched, { recursive: true, force: true });
  }
});


test("FAFF-943: spec_anchor survives verbatim into standing_objections; a legacy round carries no anchor key", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    const anchored = [
      { lens: "architectural", severity: "major", claim: "c", evidence: "e", predicted_consequence: "p", spec_anchor: "aggregation-carry-the-anchor" },
      { lens: "QA", severity: "minor", spec_anchor: "no-such-heading" },
      { lens: "QA", severity: "minor" },
    ];
    writeFileSync(join(dir, "round-1.json"), JSON.stringify({ verdict: "reject-approach", objections: anchored }));
    const b = JSON.parse(runCli(["spec-judge-evidence", "--dir", dir, ...BASE]).stdout);
    assert.equal(b.standing_objections[0].spec_anchor, "aggregation-carry-the-anchor", "matching-slug anchor verbatim");
    assert.equal(b.standing_objections[1].spec_anchor, "no-such-heading", "a no-match slug still carries verbatim (binding is the consumer's zero-match path)");
    assert.ok(!("spec_anchor" in b.standing_objections[2]), "a missing field stays missing");
    assert.equal(b.blocker_free_latest, true);
    assert.equal(b.infosec_major_free_latest, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-943: churn and convergence stdout is string-identical on legacy vs anchored rounds (the named fixture pair)", () => {
  const legacy = mkdtempSync(join(tmpdir(), "faff-legacy-"));
  const anchored = mkdtempSync(join(tmpdir(), "faff-anchored-"));
  try {
    const shape = [objs(4), objs(3), objs(2)];
    seed(legacy, shape);
    const withAnchor = shape.map((round) => round.map((o) => ({ ...o, claim: "c", evidence: "e", predicted_consequence: "p", spec_anchor: "phase-2-revised" })));
    withAnchor.forEach((objections, i) => {
      writeFileSync(join(anchored, `round-${i + 1}.json`), JSON.stringify({ verdict: "reject-approach", objections }));
    });
    const convL = runCli(["spec-review-convergence", "--dir", legacy, "--window-start", "1"]).stdout;
    const convA = runCli(["spec-review-convergence", "--dir", anchored, "--window-start", "1"]).stdout;
    assert.equal(convA, convL, "convergence stdout strictly equal on legacy vs anchored");
    const churnL = runCli(["spec-review-churn", "--prev", join(legacy, "round-2.json"), "--curr", join(legacy, "round-3.json")]).stdout;
    const churnA = runCli(["spec-review-churn", "--prev", join(anchored, "round-2.json"), "--curr", join(anchored, "round-3.json")]).stdout;
    assert.equal(churnA, churnL, "churn stdout strictly equal on legacy vs anchored");
  } finally {
    rmSync(legacy, { recursive: true, force: true });
    rmSync(anchored, { recursive: true, force: true });
  }
});

test("unreadable --dir → a park-direction bundle {park:true}, exit 0 (fail-safe, judge not consulted)", () => {
  const r = runCli(["spec-judge-evidence", "--dir", join(tmpdir(), "faff-judge-does-not-exist-xyz"), ...BASE]);
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.stdout), { park: true, reason: "spec-review dir unreadable" });
});

test("a malformed round record → exit 2 (fail-loud plumbing breakage)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5)]);
    writeFileSync(join(dir, "round-3.json"), "not json at all");
    const r = runCli(["spec-judge-evidence", "--dir", dir, ...BASE]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a non-bare --issue is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5)]);
    const r = runCli(["spec-judge-evidence", "--dir", dir, "--window-start", "1", "--level", "L4", "--appetite", "high", "--issue", "../etc/passwd"]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an unrecognised --appetite is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5)]);
    const r = runCli(["spec-judge-evidence", "--dir", dir, "--window-start", "1", "--level", "L4", "--appetite", "bogus", "--issue", "FAFF-1"]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an out-of-set --level is a usage error (exit 2)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-judge-ev-"));
  try {
    seed(dir, [objs(5), objs(5)]);
    const r = runCli(["spec-judge-evidence", "--dir", dir, "--window-start", "1", "--level", "L9", "--appetite", "high", "--issue", "FAFF-1"]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- FAFF-995: end-to-end cmdAdmit — the wired effective-L4 judge-aware path ------------------

function mintRatifiedL4RunDir() {
  // Mirrors spec-judge-casefile.test.mjs's mintRunDir: the chain's genesis prev-hash seed is
  // basename(dir), so the run dir MUST be named after the run_id for the from-genesis walk to
  // verify (exactly as production run dirs are).
  const parent = mkdtempSync(join(tmpdir(), "faff-sj-ev-run-"));
  const runId = "run-995-e2e";
  const dir = join(parent, runId);
  mkdirSync(dir);
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ run_id: runId, level: "L4" }));
  events.appendRecordUnderLock(dir, (seq, _prev, prevHash) => ({
    schema: 2, run_id: runId, seq, ts: "t", prev: prevHash, phase: "run", type: "run-start",
    data: { level: "L4" },
  }));
  return dir;
}

test("FAFF-995 e2e: cmdAdmit at effective-L4 with a judge-AFFIRM_SPEC'd infosec major -> admit JSON with no infosec_major veto", () => {
  const specDir = mkdtempSync(join(tmpdir(), "faff-sj-ev-cli-"));
  const scratch = join(specDir, "scratch");
  mkdirSync(scratch);
  const runDir = mintRatifiedL4RunDir();
  try {
    const specPath = join(specDir, "spec.md");
    writeFileSync(specPath, "# Spec\n\n## The guard decision\n\n**Chosen:** refuse an empty --dir with a founded error.\n");
    writeFileSync(join(scratch, "round-1.json"), JSON.stringify({
      verdict: "reject-approach",
      objections: [{ lens: "infosec", severity: "major", claim: "leak", evidence: "see config.txt", predicted_consequence: "exfiltration", spec_anchor: "the-guard-decision" }],
    }));
    const out = join(scratch, "judge");
    const a = runCli(["spec-judge-evidence", "--assemble", "--dir", scratch, "--window-start", "1", "--spec", specPath, "--issue", "FAFF-995", "--repo-root", repoRoot, "--out", out]);
    assert.equal(a.code, 0, a.stderr);
    assert.deepEqual(JSON.parse(a.stdout).propositions, ["p-01"]);

    // The judge AFFIRMs the infosec major.
    writeFileSync(join(out, "ruling-p-01.json"), JSON.stringify({ proposition_id: "p-01", outcome: "AFFIRM_SPEC", correction: null, synthesis_sources: [], prd_gap_citation: "" }));

    // PRD-presence fail-safe: stamp governing_requirements onto the assembled ledger so the
    // effective-L4 admit isn't independently vetoed by prd_absent_at_l4 (a different floor, out
    // of scope for this infosec-floor test).
    const ledgerPath = join(out, "ledger.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.governing_requirements = "PRD bounds present";
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", { mode: 0o600 });

    const r = runCli(["spec-judge-evidence", "--admit", "--level", "L4", "--out", out, "--spec", specPath, "--dir", scratch, "--window-start", "1", "--run-dir", runDir]);
    assert.equal(r.code, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.equal(res.level, "L4", "the run-dir is genuinely ratified L4");
    assert.equal(res.admit, true);
    assert.ok(!res.floor_veto.includes("infosec_major"), `floor_veto must not include infosec_major once the judge affirmed it: ${JSON.stringify(res.floor_veto)}`);

    // Same case, but level L3 (no judge-awareness) -> the pre-judge residue still vetoes.
    const r3 = runCli(["spec-judge-evidence", "--admit", "--level", "L3", "--out", out, "--spec", specPath, "--dir", scratch, "--window-start", "1"]);
    assert.equal(r3.code, 0, r3.stderr);
    const res3 = JSON.parse(r3.stdout);
    assert.equal(res3.admit, false);
    assert.ok(res3.floor_veto.includes("infosec_major"));
  } finally {
    rmSync(specDir, { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
  }
});
