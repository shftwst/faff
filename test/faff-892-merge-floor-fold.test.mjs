// FAFF-892 — foldMergeFloorAuthority: the pure fold that admits the digest-verified custody
// basis into the MERGE-FLOOR decision as a distinct, weaker trust class than mount-asserted.
// Mirrors corrective.js's foldCorrectiveAuthority but adds branch 2 (mount violation), which
// integrityGate(_, "merge-floor") CAN return (the corrective consumer never does). Precedence
// is the safety argument: a genuine violation refuses ABOVE the digest consult, and an
// uncomputable verify refuses ABOVE the grant. integrityGate itself stays untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import faff from "../plugin/skills/faff/bin/faff";

const { foldMergeFloorAuthority } = faff;

// integrityGate("merge-floor") dispositions the caller feeds as mountGate:
const MOUNT_TRUSTED = { trusted: true, disposition: "trusted" };
const MOUNT_VIOLATION = { trusted: false, disposition: "refuse" };   // a VIOLATION_BASES probe
const MOUNT_ABSENT = { trusted: false, disposition: "unasserted" };  // honest no-declaration

test("branch 1: mount-trusted wins over any digest state (strongest basis)", () => {
  for (const dv of [undefined, { held: false }, { held: true, diffs: [] }, { held: true, diffs: ["x"] }, { held: true, error: "boom" }]) {
    const r = foldMergeFloorAuthority(MOUNT_TRUSTED, dv);
    assert.deepEqual(r, { trusted: true, disposition: "trusted", basis: "asserted" });
  }
});

test("branch 2: a mount violation refuses ABOVE the digest consult — a clean digest never rescues it", () => {
  const r = foldMergeFloorAuthority(MOUNT_VIOLATION, { held: true, diffs: [] }); // clean digest present
  assert.deepEqual(r, { trusted: false, disposition: "refuse", basis: "violated-mount" });
});

test("branch 3: honest absence + uncomputable verify (error) refuses — never trust an uncomputable verify", () => {
  const r = foldMergeFloorAuthority(MOUNT_ABSENT, { held: true, error: "digest mismatch" });
  assert.deepEqual(r, { trusted: false, disposition: "refuse", basis: "unverifiable" });
});

test("branch 4: honest absence + clean digest GRANTS (custody-trusted / digest-verified) — the fix", () => {
  const r = foldMergeFloorAuthority(MOUNT_ABSENT, { held: true, diffs: [] });
  assert.deepEqual(r, { trusted: true, disposition: "custody-trusted", basis: "digest-verified" });
});

test("branch 5: honest absence + tampered digest (non-empty diffs) refuses", () => {
  const r = foldMergeFloorAuthority(MOUNT_ABSENT, { held: true, diffs: ["run-ledger.json"] });
  assert.deepEqual(r, { trusted: false, disposition: "refuse", basis: "tampered" });
});

test("branch 6: honest absence + no bracket held → unasserted (caller applies today's level-branch)", () => {
  for (const dv of [undefined, { held: false }]) {
    const r = foldMergeFloorAuthority(MOUNT_ABSENT, dv);
    assert.deepEqual(r, { trusted: false, disposition: "unasserted", basis: "none" });
  }
});

test("precedence: error alongside a stray diffs still routes to refuse, never a spurious grant", () => {
  // A caller that (incorrectly) sets both never grants — branch 3 is checked before branch 4.
  const r = foldMergeFloorAuthority(MOUNT_ABSENT, { held: true, error: "boom", diffs: [] });
  assert.equal(r.trusted, false);
  assert.equal(r.disposition, "refuse");
});
