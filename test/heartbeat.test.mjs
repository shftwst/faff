// FAFF-234 — `faff heartbeat` is the single sanctioned write path for the run
// ledger's owner.last_heartbeat. Liveness (FAFF-205, heartbeat-only FAFF-233) reads a
// run as `held` while last_heartbeat is fresher than STALE_SECS; builds now run as
// isolated subagents (FAFF-201) whose long quiet sub-steps (gate ladder / adversarial
// review / holdout) must tick the heartbeat or a live run ages out and a foreign Stop
// hook treats it as abandoned. These tests drive the real entrypoint: a tick keeps a
// long-quiet run `held`, a done-owner tick is a no-op, and the write is field-scoped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// Build a run-ledger fixture; returns { root, runDir, read() }.
function rootWith(ledger) {
  const root = mkdtempSync(join(tmpdir(), "heartbeat-"));
  const runDir = join(root, ".faff", "runs", "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  const ledgerPath = join(runDir, "run-ledger.json");
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  return { root, runDir, read: () => JSON.parse(readFileSync(ledgerPath, "utf8")) };
}

test("heartbeat --selftest passes (the field-merge + held-interaction table)", () => {
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

    // Tick: the owning lane refreshes owner.last_heartbeat to now.
    const tick = run(["heartbeat", runDir, "--json"]);
    assert.equal(tick.code, 0);
    const tj = JSON.parse(tick.out);
    assert.equal(tj.written, true);
    assert.equal(tj.run_dir, runDir);

    // Same foreign Stop hook now reads the run as held → silent, no warn, no block.
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

test("the write is field-scoped — only owner.last_heartbeat changes, every other field byte-identical", () => {
  const original = {
    run_id: "RUN-LIVE", admitted: ["X", "Y"], outcomes: { X: "shipped" },
    budget: { spent: 3 },
    owner: { status: "running", pid: 42, session_id: "S1", started_at: isoAgo(2000), last_heartbeat: isoAgo(800) },
  };
  const { root, runDir, read } = rootWith(original);
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, true);
    const led = read();
    // Only last_heartbeat moved.
    assert.notEqual(led.owner.last_heartbeat, original.owner.last_heartbeat);
    // Everything else is identical.
    assert.equal(led.run_id, original.run_id);
    assert.deepEqual(led.admitted, original.admitted);
    assert.deepEqual(led.outcomes, original.outcomes);
    assert.deepEqual(led.budget, original.budget);
    assert.equal(led.owner.status, "running");
    assert.equal(led.owner.pid, 42);
    assert.equal(led.owner.session_id, "S1");
    assert.equal(led.owner.started_at, original.owner.started_at);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a done-owner tick is a soft no-op — exit 0, written:false, last_heartbeat unchanged (never resurrect)", () => {
  const stamp = isoAgo(1000);
  const { root, runDir, read } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: { X: "shipped" },
    owner: { status: "done", last_heartbeat: stamp },
  });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.written, false);
    assert.equal(read().owner.last_heartbeat, stamp, "a finished run is never made to look live again");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing owner → soft no-op (exit 0, written:false)", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-LIVE", admitted: ["X"], outcomes: {} });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a missing last_heartbeat on a running owner self-heals (written:true)", () => {
  const { root, runDir, read } = rootWith({
    run_id: "RUN-LIVE", admitted: ["X"], outcomes: {}, owner: { status: "running" },
  });
  try {
    const r = run(["heartbeat", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).written, true);
    assert.ok(Number.isFinite(Date.parse(read().owner.last_heartbeat)));
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
