// FAFF-922 — the spec-review judge's evidence assembler. It never re-derives a layer's output;
// it shells the shipped convergence/churn/reputation/ratified-scope resolvers and passes their
// output through, plus the raw round records and two arithmetic derivations
// (blocker_free_latest reused verbatim; infosec_major_free_latest derived here).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

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