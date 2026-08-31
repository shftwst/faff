// FAFF-945 — the deterministic accept-bar roll-up. Given the pre-judge evidence bundle, the
// judge's CONFORMANT spec-judge-verdict, and the level, it returns the coerced disposition.
// The infosec floor is post-adjudication (over verdict.upheld) at L1–L3, and the interim
// pre-judge floor (over evidence.infosec_major_free_latest) at L4. Exercised through the real
// CLI entrypoint (the lint-cli-coverage seam), reading two JSON files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

// Write evidence + verdict to temp files and run the CLI. Returns { code, out } (out parsed on 0).
function run(evidence, verdict, level, dir) {
  const ev = join(dir, "evidence.json");
  const vd = join(dir, "verdict.json");
  writeFileSync(ev, typeof evidence === "string" ? evidence : JSON.stringify(evidence));
  writeFileSync(vd, typeof verdict === "string" ? verdict : JSON.stringify(verdict));
  const r = runCli(["spec-judge-accept-bar", "--evidence", ev, "--verdict", vd, "--level", level]);
  return { code: r.code, out: r.code === 0 ? JSON.parse(r.stdout) : null, stderr: r.stderr };
}

const CLEAN = { blocker_free_latest: true, infosec_major_free_latest: true };
const ACCEPT = { verdict: "accept", rationale: "", upheld: [], downweighted: [] };

test("accept + clean → accept-provisional at L1/L2/L3, accept-final at L4 (coerced_from/floor_fired null)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    for (const level of ["L1", "L2", "L3"]) {
      const r = run(CLEAN, ACCEPT, level, dir);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.out, { disposition: "accept-provisional", coerced_from: null, floor_fired: null, level });
    }
    const r4 = run(CLEAN, ACCEPT, "L4", dir);
    assert.equal(r4.code, 0, r4.stderr);
    assert.deepEqual(r4.out, { disposition: "accept-final", coerced_from: null, floor_fired: null, level: "L4" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accept + pre-judge infosec major, empty upheld → NOT coerced at L3 (the regression fix), coerced at L4 (interim floor)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const ev = { blocker_free_latest: true, infosec_major_free_latest: false };
    const r3 = run(ev, ACCEPT, "L3", dir);
    assert.equal(r3.code, 0, r3.stderr);
    assert.deepEqual(r3.out, { disposition: "accept-provisional", coerced_from: null, floor_fired: null, level: "L3" },
      "L3 no longer parks on a pre-judge infosec major the judge accepted");
    const r4 = run(ev, ACCEPT, "L4", dir);
    assert.equal(r4.code, 0, r4.stderr);
    assert.deepEqual(r4.out, { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "infosec", level: "L4" },
      "L4 keeps the interim pre-judge infosec floor");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accept + upheld carries an infosec major (widened-contract shape, infosec_major_free_latest:true) → scan fires L1–L3, accept-final at L4", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const verdict = { verdict: "accept", rationale: "", upheld: [{ lens: "infosec", severity: "major" }], downweighted: [] };
    for (const level of ["L1", "L2", "L3"]) {
      const r = run(CLEAN, verdict, level, dir);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.out, { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "infosec", level },
        "the L1–L3 post-adjudication scan is live code: an upheld infosec major fires it");
    }
    const r4 = run(CLEAN, verdict, "L4", dir);
    assert.equal(r4.code, 0, r4.stderr);
    assert.deepEqual(r4.out, { disposition: "accept-final", coerced_from: null, floor_fired: null, level: "L4" },
      "L4 is pre-judge-only: the upheld-scan does not run, so infosec_major_free_latest:true → accept-final");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an upheld infosec MINOR does not fire the L1–L3 scan (major/blocker only)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const verdict = { verdict: "accept", rationale: "", upheld: [{ lens: "infosec", severity: "minor" }], downweighted: [] };
    const r = run(CLEAN, verdict, "L3", dir);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.out, { disposition: "accept-provisional", coerced_from: null, floor_fired: null, level: "L3" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accept + standing blocker → park-needs-human, floor_fired:blocker, at every level", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const ev = { blocker_free_latest: false, infosec_major_free_latest: true };
    for (const level of ["L1", "L2", "L3", "L4"]) {
      const r = run(ev, ACCEPT, level, dir);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.out, { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "blocker", level });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a missing floor field is the fail-SAFE (floor fires), not a fault", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    // no blocker_free_latest → blocker floor fires
    const r = run({ infosec_major_free_latest: true }, ACCEPT, "L3", dir);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.out.disposition, "park-needs-human");
    assert.equal(r.out.floor_fired, "blocker");
    // L4 with no infosec_major_free_latest → infosec floor fires
    const r4 = run({ blocker_free_latest: true }, ACCEPT, "L4", dir);
    assert.equal(r4.code, 0, r4.stderr);
    assert.deepEqual(r4.out, { disposition: "park-needs-human", coerced_from: "accept", floor_fired: "infosec", level: "L4" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("keep-going / park-needs-human pass through unchanged (coerced_from/floor_fired null)", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    for (const v of ["keep-going", "park-needs-human"]) {
      const verdict = { verdict: v, rationale: "x", upheld: [{ lens: "infosec", severity: "blocker" }], downweighted: [] };
      const r = run(CLEAN, verdict, "L3", dir);
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(r.out, { disposition: v, coerced_from: null, floor_fired: null, level: "L3" });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-closed (exit 2) on a verdict.verdict outside the closed three", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const r = run(CLEAN, { verdict: "approve", upheld: [] }, "L3", dir);
    assert.equal(r.code, 2);
    assert.equal(r.out, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-closed (exit 2) on a non-JSON body", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const r = run(CLEAN, "{not json", "L3", dir);
    assert.equal(r.code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-closed (exit 2) on a non-object evidence bundle", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const r = run("[1,2,3]", ACCEPT, "L3", dir);
    assert.equal(r.code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-closed (exit 2) on an unreadable --verdict file", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const ev = join(dir, "evidence.json");
    writeFileSync(ev, JSON.stringify(CLEAN));
    const r = runCli(["spec-judge-accept-bar", "--evidence", ev, "--verdict", join(dir, "nope.json"), "--level", "L3"]);
    assert.equal(r.code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("usage error (exit 2) on an invalid --level", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-acceptbar-"));
  try {
    const r = run(CLEAN, ACCEPT, "L9", dir);
    assert.equal(r.code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
