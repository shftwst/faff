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

test("no ledger at the resolved run dir → soft no-op, never an error", () => {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-empty-"));
  const runDir = join(root, ".faff", "runs", "NOPE");
  mkdirSync(runDir, { recursive: true });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, false);
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
