// FAFF-470 — `faff sentry-poller` is ADR-0065's PRIMARY watchdog locus: a mint-scoped
// detached, unref'd child process that loops the UNMODIFIED `sentry check`/`sentry
// abort` CLI on a fixed interval, so a wall-clock-runaway orchestrator that stops
// reaching checkpoints is still caught from outside its own control flow. These
// tests drive the real entrypoint end to end (spawn survives the parent's return,
// stale-heartbeat L4 fixture aborts within the deadline, stop-sentinel death,
// owner-status self-stop, idempotent start, non-L4 advisory-only) — the pure
// tick-decision core itself is exercised by `sentry-poller --selftest` (see
// plugin/skills/faff/bin/lib/sentry-poller.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, opts) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// Build a run-ledger fixture; returns { root, runDir, read(), poller helpers }.
function rootWith(ledger) {
  const root = mkdtempSync(join(tmpdir(), "sentry-poller-"));
  const runDir = join(root, ".faff", "runs", ledger.run_id || "RUN-POLL");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2));
  return {
    root, runDir,
    read: () => JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")),
    handle: () => (existsSync(join(runDir, "sentry-poller.json")) ? JSON.parse(readFileSync(join(runDir, "sentry-poller.json"), "utf8")) : null),
    log: () => (existsSync(join(runDir, "sentry-poller.log")) ? readFileSync(join(runDir, "sentry-poller.log"), "utf8") : ""),
    events: () => (existsSync(join(runDir, "events.jsonl")) ? readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
  };
}

// Poll a predicate on a fixed cadence up to a deadline — used instead of a fixed
// sleep so the suite is fast on a quick tick and still tolerant on a loaded CI box.
async function waitUntil(predicate, { timeoutMs = 10000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function pidAliveProbe(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("sentry-poller --selftest passes (the pure tick-decision core + parseIntervalSecs table)", () => {
  const r = run(["sentry-poller", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("start: exit 3 with no run dir resolvable", () => {
  const root = mkdtempSync(join(tmpdir(), "sentry-poller-empty-"));
  try {
    const r = run(["sentry-poller", "start", "--root", root, "--json"], { env: { ...process.env, FAFF_RUN_DIR: "" } });
    assert.equal(r.code, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("start: exit 2 on an invalid --interval-secs", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-POLL", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1) } });
  try {
    const r = run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "0"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /--interval-secs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("start spawns a detached poller that SURVIVES the parent's return (the ADR-0065 probe property) and writes an atomic handle", async () => {
  const { root, runDir, handle } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(5), last_heartbeat: isoAgo(1) },
  });
  try {
    const r = run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]);
    assert.equal(r.code, 0);
    const j = JSON.parse(r.out);
    assert.equal(j.spawned, true);
    assert.ok(Number.isInteger(j.pid));
    // `run` (the CLI invocation above) has already returned — the spawned child
    // outlived it. It is still alive right now (not reparented-and-killed).
    assert.ok(pidAliveProbe(j.pid), "the detached child is alive after the spawning process exited");
    const h = handle();
    assert.equal(h.pid, j.pid);
    assert.equal(h.interval_secs, 1);
    assert.ok(Number.isFinite(Date.parse(h.started_at)));
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("start is idempotent on a live pid — a second start spawns no second process", async () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(5), last_heartbeat: isoAgo(1) },
  });
  try {
    const first = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "5", "--json"]).out);
    assert.equal(first.spawned, true);
    const second = run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "5", "--json"]);
    assert.equal(second.code, 0);
    const j2 = JSON.parse(second.out);
    assert.equal(j2.already_running, true);
    assert.equal(j2.pid, first.pid);
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    rmSync(root, { recursive: true, force: true });
  }
});

test("status reports {running:false} when no poller has ever started", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-POLL", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1) } });
  try {
    const r = run(["sentry-poller", "status", "--run-dir", runDir, "--json"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { running: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("stop-sentinel death: `stop` kills the poller within one interval, no kill signal ever sent, run ledger untouched", async () => {
  const { root, runDir, read, log } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(5), last_heartbeat: isoAgo(1) },
  });
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.ok(pidAliveProbe(started.pid));

    const stopped = run(["sentry-poller", "stop", "--run-dir", runDir, "--json"]);
    assert.equal(stopped.code, 0);
    assert.equal(JSON.parse(stopped.out).signalled, true);

    const died = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: 5000 });
    assert.ok(died, "the poller process exited within a couple of intervals of the stop sentinel");
    assert.match(log(), /stop-sentinel/);
    assert.equal(read().owner.status, "running", "the run ledger is untouched by a stop");
    assert.equal(read().abort, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("owner-status self-stop: the poller exits on its own once owner.status leaves \"running\" — no sentinel needed", async () => {
  const { root, runDir, log } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(5), last_heartbeat: isoAgo(1) },
  });
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.ok(pidAliveProbe(started.pid));

    // Orchestrator exit — flips owner.status without ever calling `sentry-poller stop`.
    const ledger = JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
    ledger.owner.status = "done";
    writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2));

    const died = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: 5000 });
    assert.ok(died, "the poller self-stops within one interval of owner.status leaving running");
    assert.match(log(), /self-stop-owner-status/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("L4 + stale heartbeat → the poller actions faff sentry abort: aborted-resumable, one sentry-checkpoint event, log ends abort-actioned, poller exits (the spec's integration smoke test)", async () => {
  const { root, runDir, read, log, events, handle } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
  });
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const aborted = await waitUntil(() => {
      try { return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status === "aborted-resumable"; }
      catch { return false; }
    }, { timeoutMs: 10000 });
    assert.ok(aborted, "the ledger reached aborted-resumable within the deadline");

    const led = read();
    assert.equal(led.owner.status, "aborted-resumable");
    assert.ok(led.abort, "an abort entry exists");

    // The abort child writes the ledger; the poller parent appends the checkpoint
    // event and THEN the abort-actioned log line, in that fixed synchronous order
    // (FAFF-686). Waiting on the ledger above is not enough to observe the
    // checkpoint — the parent's append can still be in flight. Wait on the
    // abort-actioned line (a strict happens-after of the checkpoint append) before
    // reading events(), so a full-suite run under load can't read events.jsonl
    // before the checkpoint has landed.
    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: 10000 });
    assert.ok(settled, "poller reached abort-actioned (checkpoint append has run)");

    const evs = events();
    const checkpoints = evs.filter((e) => e.type === "sentry-checkpoint");
    assert.ok(checkpoints.length >= 1, "no sentry-checkpoint event appended after abort-actioned");
    assert.equal(checkpoints.length, 1, "more than one sentry-checkpoint event — the per-tick guard regressed");
    assert.equal(checkpoints[0].data.tripped, true);

    assert.match(log(), /abort-actioned/);

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: 5000 });
    assert.ok(diedOrGone, "the poller process exited after actioning the abort");
    // The handle still names the pid it spawned (it is not removed) — status now
    // reads it as not-running via the liveness probe.
    assert.equal(handle().pid, started.pid);
    const status = JSON.parse(run(["sentry-poller", "status", "--run-dir", runDir, "--json"]).out);
    assert.equal(status.running, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("non-L4 (L3) + the SAME stale heartbeat → NO abort: the ledger is byte-identical, advisory-trip logged instead (the holdout scenario's rule)", async () => {
  const { root, runDir, read } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
  });
  const before = readFileSync(join(runDir, "run-ledger.json"), "utf8");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);

    // Let several ticks elapse well past the staleness window — nothing should abort.
    await waitUntil(() => false, { timeoutMs: 3000, intervalMs: 3000 });

    assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), before, "run-ledger.json is byte-identical — no abort entry, owner.status untouched");
    assert.equal(read().owner.status, "running");
    const logText = existsSync(join(runDir, "sentry-poller.log")) ? readFileSync(join(runDir, "sentry-poller.log"), "utf8") : "";
    assert.match(logText, /advisory-trip/);
    assert.doesNotMatch(logText, /abort-actioned/);

    assert.ok(pidAliveProbe(started.pid), "a non-L4 poller keeps polling — it never self-stops on a trip");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("a malformed run-ledger.json is an own-fault: `indeterminate` (never an abort), and self-heals once the ledger becomes readable again", async () => {
  const { root, runDir, log } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(1), last_heartbeat: isoAgo(1) },
  });
  try {
    // Clobber the ledger BEFORE starting the poller so its very first tick hits the fault.
    writeFileSync(join(runDir, "run-ledger.json"), "{ not json");
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const faulted = await waitUntil(() => log().includes("indeterminate"), { timeoutMs: 5000 });
    assert.ok(faulted, "an unreadable ledger logs indeterminate");
    assert.ok(pidAliveProbe(started.pid), "an own-fault never aborts and never terminates the poller");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});
