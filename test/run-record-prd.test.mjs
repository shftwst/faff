// FAFF-858 — `faff run-record-prd`: the narrow, lock-guarded PRD-record verb over the
// ONE inherited L4 ledger. Drives the REAL CLI end-to-end over filesystem fixtures
// (mirrors disposition.test.mjs / run-outward.test.mjs). The pure classifier + record
// core is additionally covered in-memory by `faff run-record-prd --selftest` (run in CI).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env }, // FAFF_RUN_DIR deliberately excluded unless a case sets it
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// A throwaway `.faff/runs/<id>` dir carrying `run-ledger.json` (or none, when `ledger`
// is omitted — the no-ledger-under-a-named-dir fixture).
function fixture(id, ledger) {
  const root = mkdtempSync(join(tmpdir(), "faff-rrp-"));
  const runDir = join(root, ".faff", "runs", id);
  mkdirSync(runDir, { recursive: true });
  if (ledger !== undefined) writeFileSync(join(runDir, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const nowIso = "2026-08-19T00:00:00.000Z";
function l4Ledger(overrides = {}) {
  return {
    run_id: "run-20260819-045200-lights-out",
    level: "L4",
    admitted: [],
    outcomes: {},
    prd_creative_licence: null,
    prd_root_container: null,
    owner: { status: "running", session_id: "sess-1", pid: 1, started_at: nowIso, last_heartbeat: nowIso },
    ...overrides,
  };
}

test("--classify: no --run-dir / no $FAFF_RUN_DIR -> not-l4, exit 0 (report-only)", () => {
  const { code, out } = run(["run-record-prd", "--classify", "--json"]);
  assert.equal(code, 0);
  const payload = JSON.parse(out);
  assert.equal(payload.verdict, "not-l4");
  assert.equal(payload.reason, "no FAFF_RUN_DIR");
});

test("--classify: a genuine lights-out L4 ledger -> inherited-l4, exit 0", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code, out } = run(["run-record-prd", "--classify", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 0);
    const payload = JSON.parse(out);
    assert.equal(payload.verdict, "inherited-l4");
    assert.equal(payload.run_dir, f.runDir);
  } finally { f.cleanup(); }
});

test("--classify: a readable non-L4 ledger -> not-l4 (legit nested-L3, not a fault), exit 0", () => {
  const f = fixture("run-t", { level: "L3", run_id: "run-t" });
  try {
    const { code, out } = run(["run-record-prd", "--classify", "--run-dir", f.runDir, "--json"]);
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).verdict, "not-l4");
  } finally { f.cleanup(); }
});

test("write: sets prd_creative_licence on a valid inherited L4 ledger, exit 0", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code, out } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(code, 0);
    assert.equal(JSON.parse(out).written, true);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, "tight");
    assert.equal(after.prd_root_container, null); // untouched
    assert.equal(after.run_id, "run-20260819-045200-lights-out"); // untouched
  } finally { f.cleanup(); }
});

test("write: idempotent re-run of the same value is a byte-stable no-op, exit 0", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const first = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(first.code, 0);
    const second = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(second.code, 0);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, "tight");
  } finally { f.cleanup(); }
});

test("write: --prd-root-container together with --prd-creative-licence records both", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--prd-root-container", "faff-x", "--json"]);
    assert.equal(code, 0);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, "tight");
    assert.equal(after.prd_root_container, "faff-x");
  } finally { f.cleanup(); }
});

test("write: --prd-root-container WITHOUT --prd-creative-licence fails loud, exit 2, no write", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-root-container", "faff-x", "--json"]);
    assert.equal(code, 2);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_root_container, null);
  } finally { f.cleanup(); }
});

test("write: an off-vocabulary --prd-creative-licence fails loud, exit 2, no write", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "medium", "--json"]);
    assert.equal(code, 2);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, null);
  } finally { f.cleanup(); }
});

test("write: a resolved ledger that is not level:\"L4\" fails loud, exit 2, never writes onto it", () => {
  const f = fixture("run-t", { level: "L3", run_id: "run-t", prd_creative_licence: null });
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(code, 2);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, null);
  } finally { f.cleanup(); }
});

test("write: no --run-dir and no $FAFF_RUN_DIR -> exit 3", () => {
  const { code, err } = run(["run-record-prd", "--prd-creative-licence", "tight"]);
  assert.equal(code, 3);
  assert.match(err, /no ledger resolvable/);
});

test("write: --run-dir names a dir with no run-ledger.json -> exit 3", () => {
  const f = fixture("nope"); // no ledger written
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(code, 3);
  } finally { f.cleanup(); }
});

test("write: $FAFF_RUN_DIR is honoured when --run-dir is absent", () => {
  const f = fixture("run-20260819-045200-lights-out", l4Ledger());
  try {
    const { code } = run(["run-record-prd", "--prd-creative-licence", "broad", "--json"], { FAFF_RUN_DIR: f.runDir });
    assert.equal(code, 0);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, "broad");
  } finally { f.cleanup(); }
});

test("write: an L4 ledger whose run_id is NOT the lights-out mint shape (foreign) fails loud, exit 3", () => {
  const f = fixture("run-20260819-045200-graft-FAFF-1", l4Ledger({ run_id: "run-20260819-045200-graft-FAFF-1" }));
  try {
    const { code } = run(["run-record-prd", "--run-dir", f.runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(code, 3);
    const after = JSON.parse(readFileSync(join(f.runDir, "run-ledger.json"), "utf8"));
    assert.equal(after.prd_creative_licence, null);
  } finally { f.cleanup(); }
});
