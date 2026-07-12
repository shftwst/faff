// FAFF-373 (fail-safe half) + FAFF-325 (activation half) — the corrective-integrity
// gate over the FAFF-278 forge surface. Exercises the pure functions in-process
// (injected `fsq`, zero real fs/network) and the CLI seam via runCli. Per ADR 0002 —
// assert the deterministic seam (returned object / exit / parsed JSON), never prose.
//
// The bin is an extensionless CommonJS file; imported from ESM it exposes only the
// default export, so we destructure the exported pure functions off it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import faff from "../plugin/skills/faff/bin/faff";

const { correctiveIntegrityProbe, integrityGate, correctiveIntegrityDirs } = faff;

const mkFsq = (environText) => ({ readEnviron: () => environText || "" });
const runDir = path.join("/tmp", "faff", "runs", "20260705-lights-out");
const reqDirs = correctiveIntegrityDirs(runDir, "FAFF-1");
const wellFormedDecl = `v1:${path.join(runDir, "corrective")},${path.join(runDir, "run-ledger.json")},${path.join(runDir, "FAFF-1")}`;
const narrowDecl = `v1:${path.join(runDir, "corrective")}`; // omits run-ledger.json + the FAFF-1 dir

// Honest absence: no pid-1 declaration, nothing inherited — asserted:false / no-declaration,
// regardless of what the (now repurposed) third `requiredDirs` argument carries. A garbage
// third arg (a non-array, or a bogus "trust me" style value) must never open a trust shortcut.
test("probe → asserted:false / no-declaration when nothing is declared, for any requiredDirs shape", () => {
  for (const dirs of [undefined, [], ["/x"], "trust-me", { asserted: true }, null]) {
    const p = correctiveIntegrityProbe({}, mkFsq(""), dirs);
    assert.equal(p.asserted, false, JSON.stringify(dirs));
    assert.equal(p.basis, "no-declaration");
  }
});

// THE security-critical case: a declaration sourced from the CLI's own inherited
// (build-lane-writable / shell-profile-poisonable) env must NEVER flip the probe to
// trusted — only pid-1 environ is a trust source. Absent from pid-1 -> env-injection.
test("probe: a declaration ONLY in inherited env (shell-sourced rc file) → env-injection, never trusted", () => {
  const p = correctiveIntegrityProbe({ FAFF_INTEGRITY_BOUNDARY: wellFormedDecl }, mkFsq(""), reqDirs);
  assert.equal(p.asserted, false);
  assert.equal(p.basis, "env-injection");
});

// A genuine pid-1 declaration whose value the inherited env DISAGREES with is tamper
// evidence too — never silently prefer the trusted source over a stray mismatch.
test("probe: inherited env disagrees with a genuine pid-1 declaration → env-injection", () => {
  const p = correctiveIntegrityProbe(
    { FAFF_INTEGRITY_BOUNDARY: narrowDecl },
    mkFsq(`X=1\0FAFF_INTEGRITY_BOUNDARY=${wellFormedDecl}`),
    reqDirs,
  );
  assert.equal(p.basis, "env-injection");
});

// A genuine pid-1 declaration the inherited env happens to AGREE with (legitimate
// propagation, not poisoning) is not penalised.
test("probe: inherited env AGREES with a genuine pid-1 declaration → not penalised", () => {
  const p = correctiveIntegrityProbe(
    { FAFF_INTEGRITY_BOUNDARY: wellFormedDecl },
    mkFsq(`X=1\0FAFF_INTEGRITY_BOUNDARY=${wellFormedDecl}`),
    reqDirs,
  );
  assert.equal(p.asserted, true);
});

test("probe: a pid-1 declaration that fails to parse → malformed", () => {
  for (const bad of ["garbage-no-colon", "v1:", ":dirs-with-no-version"]) {
    const p = correctiveIntegrityProbe({}, mkFsq(`FAFF_INTEGRITY_BOUNDARY=${bad}`), []);
    assert.equal(p.basis, "malformed", bad);
  }
});

test("probe: a well-formed declaration whose dir set omits a required path → dir-mismatch (bypass, not partial pass)", () => {
  const p = correctiveIntegrityProbe({}, mkFsq(`FAFF_INTEGRITY_BOUNDARY=${narrowDecl}`), reqDirs);
  assert.equal(p.asserted, false);
  assert.equal(p.basis, "dir-mismatch");
});

test("probe: a well-formed declaration covering the full forge surface → asserted:true", () => {
  const p = correctiveIntegrityProbe({}, mkFsq(`FAFF_INTEGRITY_BOUNDARY=${wellFormedDecl}`), reqDirs);
  assert.equal(p.asserted, true);
  assert.equal(p.basis, "asserted");
});

// Unasserted gate dispositions: corrective degrades to Channel D, detection to
// reconcile-only.
test("gate: unasserted corrective → channel-D", () => {
  const g = integrityGate({ asserted: false, basis: "no-declaration" }, "corrective");
  assert.deepEqual(g, { trusted: false, disposition: "channel-D" });
});

test("gate: unasserted detection → reconcile-only", () => {
  const g = integrityGate({ asserted: false, basis: "no-declaration" }, "detection");
  assert.deepEqual(g, { trusted: false, disposition: "reconcile-only" });
});

// merge-floor (FAFF-325, the F1 audit fold): honest absence -> "unasserted" (cmdMergeGate
// applies its own level branch on top); a violation basis -> "refuse", never level-graded.
test("gate: merge-floor + no-declaration → unasserted", () => {
  const g = integrityGate({ asserted: false, basis: "no-declaration" }, "merge-floor");
  assert.deepEqual(g, { trusted: false, disposition: "unasserted" });
});

test("gate: merge-floor + a violation basis → refuse", () => {
  for (const basis of ["env-injection", "malformed", "dir-mismatch"]) {
    const g = integrityGate({ asserted: false, basis }, "merge-floor");
    assert.deepEqual(g, { trusted: false, disposition: "refuse" }, basis);
  }
});

test("gate: merge-floor + asserted:true → trusted", () => {
  const g = integrityGate({ asserted: true, basis: "asserted" }, "merge-floor");
  assert.deepEqual(g, { trusted: true, disposition: "trusted" });
});

// An unknown consumer fails safe to Channel D — never trusted.
test("gate: unknown consumer → not trusted / channel-D", () => {
  for (const consumer of ["wat", "", undefined, null, "ledger"]) {
    const g = integrityGate({ asserted: false }, consumer);
    assert.equal(g.trusted, false, `consumer=${consumer}`);
    assert.equal(g.disposition, "channel-D");
  }
});

// The asserted:true → trusted branch is reachable from a genuine or synthetic probe result.
test("gate: asserted:true → trusted (every consumer)", () => {
  assert.deepEqual(integrityGate({ asserted: true }, "corrective"), { trusted: true, disposition: "trusted" });
  assert.deepEqual(integrityGate({ asserted: true }, "detection"), { trusted: true, disposition: "trusted" });
  assert.deepEqual(integrityGate({ asserted: true }, "merge-floor"), { trusted: true, disposition: "trusted" });
});

// Fail-safe against a malformed probe result: only a strict === true asserts.
test("gate: truthy-but-not-true asserted is NOT trusted (fail-safe)", () => {
  for (const bad of [{ asserted: 1 }, { asserted: "true" }, {}, null, undefined]) {
    const g = integrityGate(bad, "corrective");
    assert.equal(g.trusted, false, JSON.stringify(bad));
    assert.equal(g.disposition, "channel-D");
  }
});

// The integrity-dir set is single-sourced from the run-dir layout: every path is
// under the run dir, and it includes both the ledger path and the corrective dir.
// Omitting `issue` yields the original FAFF-373 2-entry set unchanged; passing it
// adds the three FAFF-325 merge-floor artifacts.
test("correctiveIntegrityDirs(runDir): 2 base entries, all under runDir", () => {
  const dirs = correctiveIntegrityDirs(runDir);
  assert.equal(dirs.length, 2);
  for (const d of dirs) assert.ok(d === runDir || d.startsWith(runDir + path.sep), `not under runDir: ${d}`);
  assert.ok(dirs.includes(path.join(runDir, "run-ledger.json")), "missing the ledger path");
  assert.ok(dirs.includes(path.join(runDir, "corrective")), "missing the corrective-artifact dir");
});

test("correctiveIntegrityDirs(runDir, issue): 5 entries — 2 base + the 3 merge-floor artifacts", () => {
  const dirs = correctiveIntegrityDirs(runDir, "FAFF-1");
  assert.equal(dirs.length, 5);
  assert.ok(dirs.includes(path.join(runDir, "FAFF-1", "ac-checklist.json")));
  assert.ok(dirs.includes(path.join(runDir, "FAFF-1", "review-verdict.json")));
  assert.ok(dirs.includes(path.join(runDir, "FAFF-1", "holdout.json")));
});

// CLI seam: the selftest table passes (exit 0).
test("corrective-integrity --selftest: table passes (exit 0)", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

// CLI seam: default consumer (corrective), real (non-container, no declaration) host →
// asserted:false / no-declaration / channel-D, exit 0 (report/degrade, never a hard refuse).
test("corrective-integrity --json: asserted:false / no-declaration / channel-D, exit 0", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--json"]);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.asserted, false);
  assert.equal(out.basis, "no-declaration");
  assert.equal(out.trusted, false);
  assert.equal(out.disposition, "channel-D");
});

// CLI seam: consumer=detection → reconcile-only, still exit 0 (degrade, not refuse).
test("corrective-integrity --consumer detection --json: reconcile-only, exit 0", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--consumer", "detection", "--json"]);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.asserted, false);
  assert.equal(out.trusted, false);
  assert.equal(out.disposition, "reconcile-only");
});

// CLI seam: consumer=merge-floor → unasserted, still exit 0 (the CLI reports/degrades;
// cmdMergeGate is the call site that turns this into a refusal).
test("corrective-integrity --consumer merge-floor --json: unasserted, exit 0", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--consumer", "merge-floor", "--json"]);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.asserted, false);
  assert.equal(out.trusted, false);
  assert.equal(out.disposition, "unasserted");
});

// CLI seam: an unknown --consumer is a usage error (exit 2), not a silent channel-D.
// The gate's unknown→channel-D fail-safe stays; the CLI rejects garbage loudly.
test("corrective-integrity --consumer bogus: usage error, exit 2", () => {
  const { code, stderr } = runCli(["corrective-integrity", "--consumer", "bogus", "--json"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown --consumer/);
});

// Lights-out integration: the preflight/ledger JSON carries the corrective_authority
// capability flag (channel-D-only, since no boundary is asserted on this host) — a
// capability RECORD. Robust to the preflight's proceed/refuse verdict + any non-JSON
// preamble: pick the JSON line carrying the flag.
test("lights-out --check --json carries corrective_authority: channel-D-only", () => {
  const { stdout } = runCli(["lights-out", "--check", "--json"]);
  const line = stdout.trim().split("\n").filter((l) => l.includes("corrective_authority")).pop();
  assert.ok(line, `no corrective_authority in lights-out --check --json output:\n${stdout}`);
  const out = JSON.parse(line);
  assert.equal(out.corrective_authority, "channel-D-only");
});
