// FAFF-205 — `faff runcheck --hook` ownership+liveness gate. The Stop hook fires on
// every session's turn-end and audits the newest run ledger globally; a parallel
// beep-boop drain's in-flight ledger (admitted, no terminal outcome yet) used to
// false-block an unrelated session. The gate: fire only for a run THIS session owns
// (env-pointer / session_id match) or a genuinely abandoned one — never a foreign
// run a live owner still holds. Drives the real entrypoint against fixture roots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env) {
  try {
    return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } }) };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "").toString() }; }
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// Build a run-ledger fixture; returns { root, runDir }.
function rootWith(ledger) {
  const root = mkdtempSync(join(tmpdir(), "runcheck-"));
  const runDir = join(root, ".faff", "runs", "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger));
  return { root, runDir };
}

test("runcheck --selftest passes (the shipped gate table)", () => {
  const r = run(["runcheck", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("--hook stays SILENT for a foreign run a live owner is holding (the fix)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    // FAFF_RUN_DIR unset → non-owning session; held → silent, no block.
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "a live foreign run must not block an unrelated session");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook BLOCKS a genuinely abandoned run (stale heartbeat) — abandoned still caught", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "blocks via the decision payload, not the exit code");
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
    assert.match(payload.reason, /\bX\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook BLOCKS the OWNING session's own in-flight run (backstop preserved)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    // FAFF_RUN_DIR == the resolved run → owned → audits-and-blocks despite fresh heartbeat.
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: runDir });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "the owning session's backstop must still fire");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook BLOCKS the owning session via the session_id fallback (env-pointer absent)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", session_id: "S1", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "S1" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "session_id match proves ownership when FAFF_RUN_DIR is not propagated");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook BLOCKS a legacy ledger (no owner) — zero regression for pre-existing runs", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "a legacy ledger is unowned → audited exactly as today");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook is SILENT for a held foreign run with a clean (fully-dispatched) queue", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: { X: "shipped" },
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.out.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF_RUN_HEARTBEAT_STALE_SECS shrinks the held window → a once-held run blocks", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(120) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir],
      { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", FAFF_RUN_HEARTBEAT_STALE_SECS: "60" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "a 120s-old heartbeat is stale under a 60s threshold");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the non-hook human report is unchanged by the gate (still exits 3, names the issue)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    // No --hook: the ownership gate does not apply; the report audits whatever it points at.
    const r = run(["runcheck", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 3, "the report path is gate-independent");
    assert.match(r.out, /UNDISPATCHED \(1\): X/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
