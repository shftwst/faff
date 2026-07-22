// FAFF-355 — `faff heartbeat` is the single sanctioned write path for run liveness,
// now a DEDICATED per-run file (`.faff/runs/<run-id>/heartbeat`) rather than a ledger
// field-merge (superseding FAFF-234's write locus — see ADR amending 0015): a tick's
// ONLY write is that file, so the run ledger is byte-identical before/after every
// tick. Liveness (FAFF-205, heartbeat-only FAFF-233) reads a run as `held` while the
// EFFECTIVE heartbeat (file, overlaid onto the legacy ledger field) is fresher than
// STALE_SECS; builds now run as isolated subagents (FAFF-201) whose long quiet
// sub-steps (gate ladder / adversarial review / holdout) must tick the heartbeat or a
// live run ages out and a foreign Stop hook treats it as abandoned. These tests drive
// the real entrypoint: a tick keeps a long-quiet run `held`, a done-owner tick is a
// no-op, and the ledger is never touched by a tick.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// Build a run-ledger fixture; returns { root, runDir, read(), readRaw(), heartbeatFile() }.
function rootWith(ledger) {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-"));
  const runDir = join(root, ".faff", "runs", "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  const ledgerPath = join(runDir, "run-ledger.json");
  const hbPath = join(runDir, "heartbeat");
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  return {
    root, runDir,
    read: () => JSON.parse(readFileSync(ledgerPath, "utf8")),
    readRaw: () => readFileSync(ledgerPath, "utf8"),
    heartbeatFile: () => (existsSync(hbPath) ? readFileSync(hbPath, "utf8") : null),
  };
}

test("heartbeat --selftest passes (effectiveHeartbeatIso / overlayHeartbeat / held-interaction table)", () => {
  const r = run(["heartbeat", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /heartbeat --selftest: ok/);
});

// The headline AC + the spec's integration smoke test: a long-quiet run reads stale,
// a tick refreshes it, and the SAME foreign Stop hook then reads it as held (silent).
test("a tick on a long-quiet run flips runcheck --hook from WARN (stale) to SILENT (held)", () => {
  const { root, runDir, read } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {},
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(1000) },
  });
  try {
    // Foreign session (no FAFF_RUN_DIR/SESSION_ID): a stale heartbeat → non-blocking WARN.
    const before = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(before.code, 0);
    assert.match(before.err, /\[warn\]/, "a stale heartbeat foreign run WARNs (would-be abandoned)");

    // Tick: writes ONLY the dedicated heartbeat file (FAFF-355) — never the ledger.
    const tick = run(["heartbeat", runDir, "--json"]);
    assert.equal(tick.code, 0);
    const tj = JSON.parse(tick.out);
    assert.equal(tj.written, true);
    assert.equal(tj.run_dir, runDir);
    assert.ok(Number.isFinite(Date.parse(tj.last_heartbeat)), "last_heartbeat is a fresh, parseable ISO timestamp");

    // Same foreign Stop hook now reads the run as held → silent, no warn, no block
    // (runcheck --hook overlays the fresh file over the still-stale ledger field).
    const after = run(["runcheck", "--hook", runDir], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(after.code, 0);
    assert.equal(after.out.trim(), "", "no block payload");
    assert.equal(after.err.trim(), "", "no warn — the tick made it held");

    // admitted/outcomes are untouched by the heartbeat write.
    const led = read();
    assert.deepEqual(led.admitted, ["X"]);
    assert.deepEqual(led.outcomes, {});
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a tick writes ONLY the dedicated heartbeat file — run-ledger.json is byte-identical before/after", () => {
  const original = {
    run_id: "RUN-LIVE", admitted: ["X", "Y"], outcomes: { X: "shipped" },
    budget: { spent: 3 },
    owner: { status: "running", pid: 42, session_id: "S1", started_at: isoAgo(2000), last_heartbeat: isoAgo(800) },
  };
  const { root, runDir, readRaw, heartbeatFile } = rootWith(original);
  try {
    const before = readRaw();
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, true);
    // FAFF-355: the structural race-closer — the ledger is NEVER written by a tick.
    assert.equal(readRaw(), before, "run-ledger.json is byte-identical after a tick");
    // The heartbeat file is what actually changed: created, fresh, parseable.
    const hb = heartbeatFile();
    assert.ok(hb, "heartbeat file was created");
    assert.equal(hb.trim(), j.last_heartbeat, "file content matches the reported last_heartbeat");
    assert.ok(Number.isFinite(Date.parse(hb.trim())), "file content is a parseable ISO timestamp");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a done-owner tick is a soft no-op — exit 0, written:false, no ledger or file mutation (never resurrect)", () => {
  const stamp = isoAgo(1000);
  const { root, runDir, read, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: { X: "shipped" },
    owner: { status: "done", last_heartbeat: stamp },
  });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, false);
    assert.equal(j.last_heartbeat, stamp, "reports the effective (ledger-field-fallback) heartbeat, unchanged");
    assert.equal(read().owner.last_heartbeat, stamp, "a finished run is never made to look live again");
    assert.equal(heartbeatFile(), null, "no heartbeat file is created for a done owner");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing owner → soft no-op (exit 0, written:false, no file created)", () => {
  const { root, runDir, heartbeatFile } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, false);
    assert.equal(heartbeatFile(), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a running owner with no ledger last_heartbeat still ticks — the file self-heals liveness (written:true)", () => {
  const { root, runDir, read, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running" },
  });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, true);
    // FAFF-355: the ledger field itself is NEVER touched by a tick — it stays absent;
    // liveness now comes entirely from the fresh heartbeat file.
    assert.equal(read().owner.last_heartbeat, undefined, "the ledger field is never written by a tick");
    assert.ok(Number.isFinite(Date.parse(heartbeatFile().trim())), "the heartbeat file carries a fresh, parseable timestamp");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FAFF-553 — deliberate contract change (spec §4): the old "no ledger at the resolved
// run dir → soft no-op" test passed an EXPLICIT dir and asserted exit 0. That contract
// is re-scoped to AMBIENT resolution only — an explicit ledger-less target now fails
// loud (exit 3), while ambient no-run stays the sanctioned soft no-op.
test("FAFF-553: an EXPLICIT ledger-less target (positional or --run-dir) → exit 3, path named on stderr, nothing written", () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-empty-"));
  const runDir = join(root, ".faff", "runs", "NOPE");
  mkdirSync(runDir, { recursive: true });
  const missing = join(root, "does-not-exist");
  try {
    for (const args of [["heartbeat", runDir, "--json"], ["heartbeat", "--run-dir", runDir, "--json"],
      ["heartbeat", missing], ["heartbeat", "--run-dir", missing]]) {
      const r = run(args);
      assert.equal(r.code, 3, `${args.join(" ")} should exit 3`);
      assert.match(r.err, /is not a run dir \(no run-ledger\.json\)/);
      assert.match(r.err, /NOPE|does-not-exist/, "stderr names the bad target path");
      assert.equal(r.out.trim(), "", "no JSON soft no-op payload on a loud failure");
    }
    assert.equal(existsSync(join(runDir, "heartbeat")), false, "nothing was written");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-553: AMBIENT resolution with no run found → soft no-op, exit 0, written:false (unchanged)", () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-ambient-"));
  try {
    // No positional, no --run-dir, FAFF_RUN_DIR cleared, cwd has no .faff/runs →
    // ambient resolution finds nothing → the sanctioned soft no-op.
    const r = spawnSync("node", [CLI, "heartbeat", "--json"],
      { encoding: "utf8", cwd: root, env: { ...process.env, FAFF_RUN_DIR: "" } });
    assert.equal(r.status, 0);
    assert.equal(JSON.parse(r.stdout).written, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-553: an empty-string positional counts as AMBIENT, not explicit (an unset shell var stays safe to pass)", () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-ambient-"));
  try {
    for (const args of [["heartbeat", "", "--json"], ["heartbeat", "--run-dir", "", "--json"]]) {
      const r = spawnSync("node", [CLI, ...args],
        { encoding: "utf8", cwd: root, env: { ...process.env, FAFF_RUN_DIR: "" } });
      assert.equal(r.status, 0, `${JSON.stringify(args)} must stay the ambient soft no-op, not exit 3`);
      assert.equal(JSON.parse(r.stdout).written, false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-553: strict, closed flag set — the `--run <id>` silent no-op footgun ------

test("FAFF-553: `heartbeat --run X` exits 2, usage names the legal flags and suggests --run-dir; nothing written", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["heartbeat", "--run", "run-20260722-153543"], { FAFF_RUN_DIR: runDir });
    assert.equal(r.code, 2, "the invented flag fails LOUD — never the old silent exit-0 no-op");
    assert.match(r.err, /unknown flag --run/);
    assert.match(r.err, /--run-dir DIR, --unit ISSUE, --json, --selftest/, "usage names the legal flags");
    assert.match(r.err, /did you mean --run-dir <dir>, or positional RUN_DIR\?/, "the message special-cases --run");
    assert.equal(heartbeatFile(), null, "nothing was written — even with an ambient run in reach");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-553: any other unknown --flag exits 2 and its value never leaks into the positional slot", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    for (const bad of [["heartbeat", "--frobnicate", runDir], ["heartbeat", "-x", runDir], ["heartbeat", runDir, "--bogus", "value"]]) {
      const r = run(bad);
      assert.equal(r.code, 2, `${bad.join(" ")} should exit 2`);
      assert.match(r.err, /unknown flag/);
    }
    assert.equal(heartbeatFile(), null, "no unknown-flag invocation ever reached a write");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-553: `--run-dir <dir>` behaves exactly as positional <dir>; giving both exits 2; a second bare token exits 2", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  try {
    const r = run(["heartbeat", "--run-dir", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, true);
    assert.equal(j.run_dir, runDir, "--run-dir resolves the same run dir as positional");
    assert.ok(heartbeatFile(), "the tick wrote the heartbeat file");

    const both = run(["heartbeat", runDir, "--run-dir", runDir]);
    assert.equal(both.code, 2, "positional and --run-dir together exit 2");
    assert.match(both.err, /mutually exclusive/);

    const twoBare = run(["heartbeat", runDir, "another-token"]);
    assert.equal(twoBare.code, 2, "a second bare token exits 2");
    assert.match(twoBare.err, /unexpected extra positional/);

    const missingVal = run(["heartbeat", "--run-dir"]);
    assert.equal(missingVal.code, 2, "--run-dir with no value exits 2");
    assert.match(missingVal.err, /requires a value/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a malformed ledger → exit 2, loud on stderr (never silently swallowed)", () => {
  const { root, runDir } = rootWith({});
  // Clobber with non-JSON.
  writeFileSync(join(runDir, "run-ledger.json"), "{ not json");
  try {
    const r = run(["heartbeat", runDir]);
    assert.equal(r.code, 2);
    assert.match(r.err, /malformed ledger/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Adversarial-review fix: a write/rename fault must degrade to a soft no-op, never
// an uncaught crash — a single failed liveness tick is not fatal. Force the fault by
// pre-creating "heartbeat" as a DIRECTORY, so renameSync(tmp-file, heartbeat-dir)
// throws EISDIR — the same catch path a real fs fault (disk full, run dir removed
// mid-tick, permissions) would hit.
test("a write/rename fault degrades to a soft no-op (exit 0, written:false) — never an uncaught crash", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  mkdirSync(join(runDir, "heartbeat")); // an existing directory where the file should go
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0, "a write fault never crashes the tick");
    assert.equal(JSON.parse(r.out).written, false);
    assert.match(r.err, /could not write the heartbeat file/, "the fault is still surfaced loudly on stderr");
    // No orphaned tmp file left behind by the failed write.
    const leftover = readdirSync(runDir).filter((n) => n.startsWith("heartbeat.tmp."));
    assert.deepEqual(leftover, [], "the tmp file is cleaned up on failure, not orphaned");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- FAFF-327: `--unit <issue>` — the fleet member tick ---------------------------

test("--unit writes BOTH the run heartbeat file and heartbeat.<issue>, reports unit, and leaves run-ledger.json byte-identical", () => {
  const { root, runDir, readRaw, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1000) },
  });
  try {
    const before = readRaw();
    const r = run(["heartbeat", runDir, "--unit", "FAFF-1", "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, true);
    assert.equal(j.unit, "FAFF-1");
    assert.equal(readRaw(), before, "run-ledger.json byte-identical after a --unit tick");
    const runHb = heartbeatFile();
    assert.ok(runHb, "the run-level heartbeat file was written");
    assert.equal(runHb.trim(), j.last_heartbeat);
    const memberHb = readFileSync(join(runDir, "heartbeat.FAFF-1"), "utf8");
    assert.equal(memberHb.trim(), j.last_heartbeat, "the member file carries the same tick timestamp");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("without --unit, behaviour and JSON output are unchanged from post-FAFF-355 main (unit:null, no member file)", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, true);
    assert.equal(j.unit, null);
    assert.ok(heartbeatFile(), "the run-level file was written");
    const memberFiles = readdirSync(runDir).filter((n) => n.startsWith("heartbeat.") && n !== "heartbeat");
    assert.deepEqual(memberFiles, [], "no member file is ever created without --unit");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--unit on a done owner is the same soft no-op as without --unit — no run file, no member file, written:false", () => {
  const stamp = isoAgo(1000);
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: { X: "shipped" }, owner: { status: "done", last_heartbeat: stamp },
  });
  try {
    const r = run(["heartbeat", runDir, "--unit", "X", "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, false);
    assert.equal(j.unit, "X", "unit is still echoed even on a soft no-op — it was a valid flag, just nothing to tick");
    assert.equal(heartbeatFile(), null, "no run file for a done owner");
    assert.equal(existsSync(join(runDir, "heartbeat.X")), false, "no member file for a done owner");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an invalid --unit value (traversal-shaped) fails loud, exit 2, before any write", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    for (const bad of ["../escape", ".."]) {
      const r = run(["heartbeat", runDir, "--unit", bad]);
      assert.equal(r.code, 2, `--unit ${JSON.stringify(bad)} should be rejected`);
      assert.match(r.err, /not a valid issue id/);
    }
    assert.equal(heartbeatFile(), null, "an invalid --unit never reaches any write");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("--unit's RUN_DIR positional resolution is unaffected — the flag+value pair never shifts the positional index", () => {
  const { root, runDir, heartbeatFile } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(10) },
  });
  try {
    // --unit BEFORE the positional RUN_DIR arg — must still resolve the same run dir.
    const r = run(["heartbeat", "--unit", "X", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.run_dir, runDir);
    assert.equal(j.written, true);
    assert.ok(heartbeatFile());
  } finally { rmSync(root, { recursive: true, force: true }); }
});
