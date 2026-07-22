// FAFF-205 — `faff runcheck --hook` ownership+liveness gate. The Stop hook fires on
// every session's turn-end and audits the newest run ledger globally; a parallel
// beep-boop drain's in-flight ledger (admitted, no terminal outcome yet) used to
// false-block an unrelated session. The gate: fire only for a run THIS session owns
// (env-pointer / session_id match) or a genuinely abandoned one — never a foreign
// run a live owner still holds. Drives the real entrypoint against fixture roots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// spawnSync so we capture BOTH streams: the hook BLOCKS via a stdout decision payload,
// and (FAFF-235) WARNS via a non-blocking stderr line — the test distinguishes them.
function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
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

test("FAFF-235: --hook WARNS (never blocks) an unrelated session about a foreign abandoned run", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "a non-owning session must NOT be hard-blocked (no stdout decision payload)");
    assert.match(r.err, /\[warn\]/, "the abandoned foreign run is still surfaced — as a non-blocking warning");
    assert.match(r.err, /\bX\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-235: --hook --recover hard-blocks the foreign abandoned run (deliberate human recovery)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  try {
    const r = run(["runcheck", "--hook", "--recover", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "--recover is the sanctioned hard-assert on a chosen run");
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

test("FAFF-235: --hook WARNS (never blocks) a legacy ledger (no owner) in a foreign session", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.out.trim(), "", "a legacy ledger is unowned → a foreign session warns, never hard-blocks");
    assert.match(r.err, /\[warn\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--hook BLOCKS a legacy ledger under --recover (owner-less run is still recoverable)", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  try {
    const r = run(["runcheck", "--hook", "--recover", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block");
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

test("FAFF_RUN_HEARTBEAT_STALE_SECS shrinks the held window → a once-held foreign run WARNS (FAFF-235)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", last_heartbeat: isoAgo(120) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir],
      { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", FAFF_RUN_HEARTBEAT_STALE_SECS: "60" });
    // 120s-old heartbeat is stale under a 60s threshold → not-held; but foreign → warn, not block.
    assert.equal(r.out.trim(), "", "shrunk window makes it not-held, but a foreign session still only warns");
    assert.match(r.err, /\[warn\]/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-233: --hook stays SILENT for a foreign run with a fresh heartbeat but a DEAD recorded pid (pid not consulted)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", pid: 2147483646, last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.out.trim(), "", "a fresh heartbeat is authoritative — a dead/rolled recorded pid must not flip it to abandoned");
    assert.equal(r.err.trim(), "", "held → fully silent");
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

// FAFF-554 — outcomes[issue] MUST be a bare terminal-state string; a rich detail
// object is still invalid (option (a): no schema widening), but the diagnostic
// now names the outcome_details sidecar instead of stringifying to the useless
// "[object Object]". outcome_details itself is inert to the completeness gate.

test("FAFF-554: an object-valued outcome is INVALID, names outcome_details (not [object Object]), and exits 2", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"],
    outcomes: { X: { state: "shipped", merged_head: "deadbeef" } },
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 2, "an object-valued outcome stays invalid — no schema widening");
    assert.match(r.out, /INVALID outcomes:/);
    assert.match(r.out, /outcome_details/, "the diagnostic points the author at the sidecar");
    assert.doesNotMatch(r.out, /\[object Object\]/, "the stringified-object diagnostic is gone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-554: an unknown-vocabulary STRING outcome stays byte-unchanged — invalid `<issue>=<value>`, exit 2", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: { X: "bogus" },
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 2);
    assert.match(r.out, /INVALID outcomes: X=bogus/, "unknown-string diagnostic is unchanged by the FAFF-554 non-string handling");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-554: valid string outcomes + a populated outcome_details sidecar is clean (exit 0) — sidecar is inert", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"],
    outcomes: { X: "shipped" },
    outcome_details: { X: { state: "shipped", merged_head: "deadbeef", satisfies: ["AC1"] } },
    owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["runcheck", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "outcome_details never affects clean / exit code");
    assert.match(r.out, /clean: every admitted issue reached a terminal outcome\./);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FAFF-578 — run-dir resolution tolerates filesystem churn. Concurrent sessions
// creating/deleting run dirs is faff's own operating premise, so a candidate listed
// by readdirSync can be gone by the time statSync reaches it; the Stop hook that
// fires at every turn-end must never crash on that. The deterministic reproduction
// of "candidate vanished mid-scan" is a dangling symlink: readdirSync lists it,
// statSync (which follows links) throws ENOENT. These drive resolution through the
// REAL entrypoint with cwd at the fixture root (no positional arg → latestRunDir).

// Like run(), but with cwd pinned to the fixture root (resolution-path tests need
// findRoot → latestRunDir, i.e. no positional run-dir) and optional node preload flags.
function runIn(cwd, args, env, nodeFlags = []) {
  const r = spawnSync("node", [...nodeFlags, CLI, ...args], { encoding: "utf8", cwd, env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

test("FAFF-578: a dangling symlink among the run dirs is skipped — the valid dir still resolves, nothing throws", () => {
  // Ownerless (legacy) ledger: --recover hard-blocks it whoever asks, so the block
  // payload is a pure signal that resolution reached the valid dir (a held run
  // would go silent before --recover is consulted).
  const { root } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  symlinkSync(join(root, "no-such-target"), join(root, ".faff", "runs", "vanished-mid-scan"));
  try {
    // --recover hard-asserts whatever resolves; a block payload naming X proves the
    // scan survived the dangling entry AND still resolved the valid run dir.
    const r = runIn(root, ["runcheck", "--hook", "--recover"], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    const payload = JSON.parse(r.out.trim());
    assert.equal(payload.decision, "block", "the valid run dir must still resolve past the dangling entry");
    assert.match(payload.reason, /\bX\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-578: a runs dir whose ONLY entry is a dangling symlink → hook exits 0, fully silent", () => {
  const root = mkdtempSync(join(tmpdir(), "runcheck-"));
  mkdirSync(join(root, ".faff", "runs"), { recursive: true });
  symlinkSync(join(root, "no-such-target"), join(root, ".faff", "runs", "vanished-mid-scan"));
  try {
    const r = runIn(root, ["runcheck", "--hook"], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "an unstat-able sole candidate is excluded → as if no run exists");
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-578: .faff/runs is a FILE (readdirSync ENOTDIR) → hook exits 0, fully silent", () => {
  const root = mkdtempSync(join(tmpdir(), "runcheck-"));
  mkdirSync(join(root, ".faff"), { recursive: true });
  writeFileSync(join(root, ".faff", "runs"), "not a directory");
  try {
    const r = runIn(root, ["runcheck", "--hook"], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "a readdir failure on .faff/runs resolves to null, never a throw");
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The cmdRuncheck call-site catch is defence in depth — post-fix, resolution cannot
// throw through the normal fs surface (latestRunDir absorbs churn; findRoot uses only
// existsSync). Force a throw with a preloaded fs patch so the catch's two arms are
// still pinned by a real-entrypoint test.
test("FAFF-578: a forced resolution throw → hook exits 0 silent; non-hook exits 2 naming the failure", () => {
  const root = mkdtempSync(join(tmpdir(), "runcheck-"));
  const patch = join(root, "patch-fs.cjs");
  writeFileSync(patch, [
    'const fs = require("fs");',
    "const orig = fs.existsSync;",
    'fs.existsSync = (p) => { if (String(p).includes("FAFF578-BOOM")) throw new Error("simulated churn"); return orig(p); };',
    "",
  ].join("\n"));
  const boom = join(root, "FAFF578-BOOM");
  try {
    const hook = runIn(root, ["runcheck", "--hook", boom], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" }, ["-r", patch]);
    assert.equal(hook.code, 0, "a Stop hook never crashes on a resolution throw");
    assert.equal(hook.out.trim(), "");
    assert.equal(hook.err.trim(), "");
    const cli = runIn(root, ["runcheck", boom], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" }, ["-r", patch]);
    assert.equal(cli.code, 2, "the CLI report path stays loud on a resolution fault");
    assert.match(cli.err, /run-dir resolution failed: simulated churn/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
