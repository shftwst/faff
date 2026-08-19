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
import http from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// A loopback server that records every POST it receives; caller controls the
// response. Mirrors test/andon.test.mjs's helper — `t` (the running test's
// TestContext) registers the close so a server is never left listening past its
// test (an unclosed handle would keep `node --test`'s process alive).
function loopbackServer(t, handler) {
  return new Promise((resolve) => {
    const posts = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        posts.push({ method: req.method, path: req.url, headers: req.headers, body });
        if (handler) handler(req, res, posts);
        else { res.writeHead(200); res.end("ok"); }
      });
    });
    t.after(() => new Promise((r) => { if (server.listening) server.close(r); else r(); }));
    server.listen(0, "127.0.0.1", () => resolve({ server, posts, url: (p) => `http://127.0.0.1:${server.address().port}${p || "/hook"}` }));
  });
}

function run(args, opts) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// The stale-heartbeat fixtures below must age a heartbeat PAST the effective sentry
// stall window so `sentry check` classifies it stale (strict `age > stall_window_secs`).
// That window is read by the `sentry check` CHILD from the repo's committed
// `.faffrc.yaml` (sentry.stall_window_secs) — NOT from the temp fixture root — so a
// hardcoded fixture age silently un-stales itself the moment the committed window is
// bumped past it (FAFF-795: 1800 → 2400 did exactly this). Derive the age from the
// LIVE configured value + a margin so a future bump can never re-break these.
const STALL_WINDOW_SECS = (() => {
  const r = spawnSync("node", [CLI, "config", "get", "sentry.stall_window_secs"], { encoding: "utf8" });
  const n = Number((r.stdout ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 900; // 900 = RUN_HEARTBEAT_STALE_SECS_DEFAULT
})();
// Comfortably past the window; still well under run_elapsed_ceiling_secs (14400) so a
// stale-heartbeat fixture never also trips the wall-clock ceiling and change what it tests.
const STALE_AGE_SECS = STALL_WINDOW_SECS + 200;

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

// FAFF-635 — the L4 abort-landing/poller-exit deadlines below are sized for a
// CPU-contended CI runner, not an idle box. The detached poller does two blocking
// spawnSync children per tick (`sentry check`, `sentry abort`) plus an events/log
// append; under N-way CI parallelism each child spawn can stretch to several
// seconds. Both waits are predicate-polled (waitUntil returns the instant the
// predicate is true), so a generous ceiling costs nothing on a healthy run and
// only ever spends time when the runner is genuinely starved.
const ABORT_LANDING_BUDGET_MS = 30000; // ~5-6x the two-child-spawn worst case under CI contention
const POLLER_EXIT_BUDGET_MS = 20000; // covers detached-process teardown under the same contention

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

// FAFF-887 — arm-time wrong-lane warning: when the operator arms the poller with
// FAFF_RUN_HEARTBEAT_STALE_SECS set but sentry.stall_window_secs unset, cmdStart names
// the correct lever pre-detach (cmdStart's stderr IS seen, unlike the poller's own
// stdio:"ignore"). Asserted via an invalid --interval-secs so cmdStart returns before
// spawning any real detached poller — the warning precedes the interval parse.
test("FAFF-887: sentry-poller start warns pre-detach naming sentry.stall_window_secs in the wrong-lane condition", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-POLL", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1) } });
  try {
    const r = run(["sentry-poller", "start", "--run-dir", runDir, "--root", root, "--interval-secs", "abc"], { env: { ...process.env, FAFF_RUN_HEARTBEAT_STALE_SECS: "7200" } });
    assert.notEqual(r.code, 0, "invalid interval returns before spawning (no detached poller left running)");
    assert.match(r.err, /sentry\.stall_window_secs/);
    assert.match(r.err, /does not reach the poller/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-887: sentry-poller start does NOT warn when sentry.stall_window_secs is set", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-POLL", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1) } });
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "sentry:\n  stall_window_secs: 1200\n");
    const r = run(["sentry-poller", "start", "--run-dir", runDir, "--root", root, "--interval-secs", "abc"], { env: { ...process.env, FAFF_RUN_HEARTBEAT_STALE_SECS: "7200" } });
    assert.doesNotMatch(r.err, /does not reach the poller/, "config lever set — no wrong-lane warning");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// FAFF-887 — the arm-time wrong-lane warn wraps its config read in try/catch so a
// config-load fault never blocks arming (the poller must run even when config is
// degraded). A top-level sequence makes readGovernanceConfig throw base-parse-error
// (same fixture as the FAFF-717 fail-safe test). With the guard, the fault is swallowed
// and arming proceeds to the interval parse (clean exit 2 on the invalid interval);
// without it, the uncaught throw would crash start (exit 1) before the interval check.
test("FAFF-887: a malformed .faffrc at arm time does not block arming (config-fault-tolerant warn)", () => {
  const { root, runDir } = rootWith({ run_id: "RUN-POLL", admitted: [], outcomes: {}, owner: { status: "running", last_heartbeat: isoAgo(1) } });
  try {
    writeFileSync(join(root, ".faffrc.yaml"), "- not\n- a\n- map\n");
    const r = run(["sentry-poller", "start", "--run-dir", runDir, "--root", root, "--interval-secs", "abc"], { env: { ...process.env, FAFF_RUN_HEARTBEAT_STALE_SECS: "7200" } });
    assert.equal(r.code, 2, "reached the interval-parse (config fault swallowed) — arming not blocked, not an exit-1 crash");
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
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const aborted = await waitUntil(() => {
      try { return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status === "aborted-resumable"; }
      catch { return false; }
    }, { timeoutMs: ABORT_LANDING_BUDGET_MS });
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
    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller reached abort-actioned (checkpoint append has run)");

    const evs = events();
    const checkpoints = evs.filter((e) => e.type === "sentry-checkpoint");
    assert.ok(checkpoints.length >= 1, "no sentry-checkpoint event appended after abort-actioned");
    assert.equal(checkpoints.length, 1, "more than one sentry-checkpoint event — the per-tick guard regressed");
    assert.equal(checkpoints[0].data.tripped, true);

    // Redundant with the settling wait above (which already confirmed this token is
    // present) — kept to document intent at its original spot, per FAFF-686's spec.
    assert.match(log(), /abort-actioned/);

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller process exited after actioning the abort");
    // The handle still names the pid it spawned (it is not removed) — status now
    // reads it as not-running via the liveness probe.
    assert.equal(handle().pid, started.pid);
    const status = JSON.parse(run(["sentry-poller", "status", "--run-dir", runDir, "--json"]).out);
    assert.equal(status.running, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("attended L3 (neither autonomous.unattended nor the sentry_acting alias) + the SAME stale heartbeat → NO abort: the ledger is byte-identical, advisory-trip logged instead (FAFF-765 — an attended run stays advisory)", async () => {
  const { root, runDir, read } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
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

test("unattended L3 (canonical autonomous.unattended:true) + the SAME stale heartbeat → the poller ACTS: aborted-resumable, exactly as an L4 run (FAFF-765 — abort keyed on attendedness)", async () => {
  const { root, runDir, read, log } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  // The canonical declaration lives in the repo-root config the detached poller resolves via findRoot(runDir).
  writeFileSync(join(root, ".faffrc.yaml"), "autonomous:\n  unattended: true\n");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const aborted = await waitUntil(() => {
      try { return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status === "aborted-resumable"; }
      catch { return false; }
    }, { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(aborted, "an unattended L3 run reached aborted-resumable — the kill-switch fired on a non-L4 run via the canonical key");

    const led = read();
    assert.equal(led.owner.status, "aborted-resumable");
    assert.ok(led.abort, "an abort entry exists");

    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller reached abort-actioned");
    assert.doesNotMatch(log(), /advisory-trip/); // declaring unattended makes it act, not merely log

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller exited after actioning the abort");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("L3 + the retained autonomous.sentry_acting:true ALIAS + the SAME stale heartbeat → the poller ACTS, identical to the canonical key (FAFF-717/FAFF-765 — the alias still asserts unattended)", async () => {
  const { root, runDir, read, log } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  // The legacy alias lives in the repo-root config the detached poller resolves via findRoot(runDir).
  writeFileSync(join(root, ".faffrc.yaml"), "autonomous:\n  sentry_acting: true\n");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const aborted = await waitUntil(() => {
      try { return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status === "aborted-resumable"; }
      catch { return false; }
    }, { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(aborted, "an L3 run with the knob reached aborted-resumable — the kill-switch fired on a non-L4 run");

    const led = read();
    assert.equal(led.owner.status, "aborted-resumable");
    assert.ok(led.abort, "an abort entry exists");

    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller reached abort-actioned");
    assert.doesNotMatch(log(), /advisory-trip/); // the knob makes it act, not merely log

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller exited after actioning the abort");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("L3 + a MALFORMED .faffrc + the SAME stale heartbeat → NO abort, advisory-trip, poller keeps polling (FAFF-717 — the guarded config read fails safe to OFF, never a coerced abort)", async () => {
  const { root, runDir, read } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  // A top-level sequence is meaningful-but-non-map content: readGovernanceConfig
  // throws base-parse-error, which gatherFacts must catch and fail safe to OFF —
  // a config fault must never wedge the watchdog nor coerce an abort on an L3 run.
  writeFileSync(join(root, ".faffrc.yaml"), "- not\n- a\n- map\n");
  const before = readFileSync(join(runDir, "run-ledger.json"), "utf8");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    // Let several ticks elapse well past the staleness window — nothing should abort.
    await waitUntil(() => false, { timeoutMs: 3000, intervalMs: 3000 });

    assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), before, "run-ledger.json is byte-identical — a config fault never coerces an abort");
    assert.equal(read().owner.status, "running");
    const logText = existsSync(join(runDir, "sentry-poller.log")) ? readFileSync(join(runDir, "sentry-poller.log"), "utf8") : "";
    assert.match(logText, /advisory-trip/);
    assert.doesNotMatch(logText, /abort-actioned/);
    assert.ok(pidAliveProbe(started.pid), "the watchdog survives a config fault — it never fault-caps on a malformed .faffrc");
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

// FAFF-766 — pause-acting is COOPERATIVE-CHECKPOINT-ONLY: actsOnSentryPause exists
// so the between-units checkpoint can park an implicated issue, but the detached
// poller never consults it and never acts on a `pause` intervention at ANY level —
// not even a declared-unattended L3/L4 that DOES act on abort. This end-to-end test
// drives a REAL fix-review-thrash trip (>= thrash_n=3 build-start events on one
// issue, no shipped outcome) through the real `sentry check` child the poller
// spawns, on a declared-unattended L3 run (the one case that, for `abort`, WOULD
// act) — and asserts the poller only ever logs advisory-trip, never touches the
// ledger, and keeps polling. The pure decideTick fixture table in sentry-poller.js
// --selftest ("acting run + pause intervention -> advisory-trip") already pins this
// at the unit level; this test pins the same guarantee end-to-end.
test("declared-unattended L3 (autonomous.unattended:true) + a REAL fix-review-thrash trip -> advisory-trip only, never a park/dispatch (pause stays poller-inert at every level)", async () => {
  const { root, runDir, read, log, events } = rootWith({
    run_id: "RUN-POLL", level: "L3", admitted: ["ISSUE-THRASH"], outcomes: {},
    owner: { status: "running", started_at: isoAgo(5), last_heartbeat: isoAgo(1) },
  });
  // Declared unattended — the same declaration that makes the poller ACT on abort.
  writeFileSync(join(root, ".faffrc.yaml"), "autonomous:\n  unattended: true\n");
  // thrash_n defaults to 3 (delivery profile): 3 build-start events on ISSUE-THRASH,
  // no shipped outcome -> evalThrash trips fix-review-thrash -> intervention "pause".
  const thrashEvents = [0, 1, 2].map((seq) => ({ type: "build-start", issue: "ISSUE-THRASH", seq }));
  writeFileSync(join(runDir, "events.jsonl"), thrashEvents.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const before = readFileSync(join(runDir, "run-ledger.json"), "utf8");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const trippedLogged = await waitUntil(() => log().includes("advisory-trip"), { timeoutMs: 5000 });
    assert.ok(trippedLogged, "the real fix-review-thrash trip is logged as advisory-trip");

    // Give it a couple more ticks — still never a park/dispatch action.
    await waitUntil(() => false, { timeoutMs: 2000, intervalMs: 2000 });

    assert.equal(readFileSync(join(runDir, "run-ledger.json"), "utf8"), before, "run-ledger.json is byte-identical — pause never mutates the ledger, unlike an acted abort");
    assert.equal(read().owner.status, "running", "the run is never marked aborted on a pause trip, even declared-unattended");
    assert.doesNotMatch(log(), /abort-actioned/, "no abort dispatch — fix-review-thrash maps to pause, not abort");
    assert.ok(pidAliveProbe(started.pid), "the poller keeps polling — a pause trip never terminates it");

    // The poller appends a `sentry-checkpoint` event ONLY on the abort action (D10 —
    // never per-tick, to avoid spamming events.jsonl on every advisory trip). A pause
    // trip never actions, so events.jsonl carries no sentry-checkpoint entry at all —
    // the absence itself is the assertion that no abort action ever fired.
    const evs = events().filter((e) => e.type === "sentry-checkpoint");
    assert.equal(evs.length, 0, "no sentry-checkpoint event is ever appended for a pause trip (only the abort action appends one)");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// FAFF-472 — wire the poller's actioned abort to the andon push channel
// (FAFF-386). Consumes the shipped `appendEventRecord`/`faff andon pump`
// unmodified: no new transport, no new event type, no new andon class.
// ---------------------------------------------------------------------------

test("FAFF-472: actioned abort with andon.url configured -> a sentry-trip event lands on events.jsonl AND andon pumps exactly one sentry-trip notification", async (t) => {
  const { root, runDir, log, events } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const { posts, url } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller reached abort-actioned");

    const posted = await waitUntil(() => posts.length >= 1, { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(posted, "andon pump delivered the sentry-trip notification");
    assert.equal(posts.length, 1, "exactly one notification — the pump's own dedupe collapses the single tripped signal set");
    assert.match(posts[0].body, /sentry tripped/);
    assert.match(posts[0].body, /RUN-POLL/);

    const trips = events().filter((e) => e.type === "sentry-trip");
    assert.equal(trips.length, 1, "exactly one sentry-trip event appended");
    assert.equal(trips[0].phase, "run");
    assert.deepEqual(trips[0].data.intervention, "abort");
    assert.ok(Array.isArray(trips[0].data.verdicts) && trips[0].data.verdicts.length >= 1, "verdicts carried through from the abort decision payload");

    // Ordering: the event append happens before the pump call (HOW §4), so by the
    // time the pump has POSTed, the event is already on disk — already asserted by
    // reading events() after observing the POST above.
    assert.ok(existsSync(join(runDir, "andon-state.json")), "the pump's own cursor/dedupe state was written");

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller still exits after actioning the abort — the andon emit doesn't change control flow");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-472: andon.url unset -> the sentry-trip event still lands (unconditional telemetry) but no andon-state.json / no notification (byte-for-byte no-op on the andon side)", async () => {
  const { root, runDir, log, events } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller reached abort-actioned");

    const trips = events().filter((e) => e.type === "sentry-trip");
    assert.equal(trips.length, 1, "the event append is unconditional — it does not gate on andon config");
    assert.equal(existsSync(join(runDir, "andon-state.json")), false, "andon disabled -> the pump is a complete no-op, no state file");

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller exits exactly as before andon.url existed");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-472: an andon webhook failure never blocks/reorders/fails the abort — the ledger still lands aborted-resumable and the poller still exits", async (t) => {
  const { root, runDir, log, read, events } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  // A loopback server that always 500s — the pump's retry-then-record-failure path,
  // fail-open by construction (ADR-0101): `faff andon pump` still exits 0.
  const { posts, url } = await loopbackServer(t, (req, res) => { res.writeHead(500); res.end("nope"); });
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    const aborted = await waitUntil(() => {
      try { return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status === "aborted-resumable"; }
      catch { return false; }
    }, { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(aborted, "the abort landed on the ledger despite the webhook failing every attempt");
    assert.equal(read().owner.status, "aborted-resumable");

    const settled = await waitUntil(() => log().includes("abort-actioned"), { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(settled, "poller still reached abort-actioned — unaffected by the andon fault");

    const failedDelivery = await waitUntil(() => posts.length >= 1, { timeoutMs: ABORT_LANDING_BUDGET_MS });
    assert.ok(failedDelivery, "the pump did attempt delivery (proving the failure path, not a config miss)");

    assert.equal(events().filter((e) => e.type === "sentry-trip").length, 1, "the event still landed regardless of the webhook's outcome");

    const diedOrGone = await waitUntil(() => !pidAliveProbe(started.pid), { timeoutMs: POLLER_EXIT_BUDGET_MS });
    assert.ok(diedOrGone, "the poller still exits — an andon failure never changes control flow");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});

test("FAFF-472: an abort-failed tick (the abort child itself fails) emits NO sentry-trip event and runs no pump -> the page fires only on the tick that actually lands", async () => {
  const { root, runDir, log, events } = rootWith({
    run_id: "RUN-POLL", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  // Pre-seed a live-looking ledger lock file (fresh mtime) so `faff sentry abort`'s
  // lock acquisition deterministically exhausts its 2s retry budget and returns
  // LEDGER_LOCKED (exit 1) on the very first tick — a non-timing-dependent way to
  // force the abort child to fail, without touching runDir's own writability (the
  // poller's handle/log/events files must stay writable, unlike a directory-level
  // permission strip).
  writeFileSync(join(runDir, "run-ledger.json.lock"), "");
  try {
    const started = JSON.parse(run(["sentry-poller", "start", "--run-dir", runDir, "--interval-secs", "1", "--json"]).out);
    assert.equal(started.spawned, true);

    // Bounded well under the lock's 5s staleness window (fs-lock.js STALE_LOCK_MS)
    // so this only ever observes the deterministic LOCKED failure, never a
    // stale-takeover success on a slow retry.
    const failed = await waitUntil(() => log().includes("abort-failed"), { timeoutMs: 4000 });
    assert.ok(failed, "the poller logged abort-failed — the abort child did not exit 0");

    assert.doesNotMatch(log(), /abort-actioned/, "the landing-tick log line never appears while the abort keeps failing");
    assert.equal(events().filter((e) => e.type === "sentry-trip").length, 0, "no sentry-trip event on a tick where the abort itself failed");
    assert.ok(pidAliveProbe(started.pid), "the poller keeps retrying, unterminated by a failed abort attempt");
  } finally {
    run(["sentry-poller", "stop", "--run-dir", runDir]);
    await waitUntil(() => true, { timeoutMs: 1500 });
    rmSync(root, { recursive: true, force: true });
  }
});
