// FAFF-471 — `faff sentrycheck --hook`: ADR-0065's cheap ASSIST watchdog locus, the
// third member of the Stop-hook family alongside runcheck/prepcheck. Drives the
// real entrypoint against fixture roots (runcheck-gate.test.mjs pattern) — the
// pure gate + consult-outcome classifier are covered by `sentrycheck --selftest`
// (see plugin/skills/faff/bin/lib/sentrycheck.js); these tests exercise the real
// child spawn of the unmodified `faff sentry check` CLI, matching the three
// visible Scenarios in the spec plus the consult-failure notice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// Async CLI runner (spawn, not spawnSync) — REQUIRED for the FAFF-472 andon tests
// below, which run an in-process loopback http server in this same test process:
// a synchronous spawnSync would block this process's event loop while the CLI
// child's outbound POST is still in flight, deadlocking client and server against
// each other (same reasoning as test/andon.test.mjs's own async runner).
function runAsync(args, env) {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

// A loopback server that records every POST it receives — mirrors test/andon.test.mjs
// and test/sentry-poller.test.mjs's identical helper.
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

// FAFF-620: the resolveSentryRunDir helper's fault path is unit-tested directly
// (a real deleted cwd can't be staged portably) via the same createRequire
// pattern used in test/argv.test.mjs.
const require = createRequire(import.meta.url);
const { resolveSentryRunDir } = require(join(
  dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "lib", "sentrycheck.js",
));

function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const isoAgo = (secs) => new Date(Date.now() - secs * 1000).toISOString();

// The stale/abandoned fixtures below must age a heartbeat PAST the effective sentry
// stall window so the consult classifies the run abandoned (strict `age > stall_window_secs`).
// That window is read from the repo's committed `.faffrc.yaml` (sentry.stall_window_secs),
// so a hardcoded fixture age silently un-stales itself the moment the committed window is
// bumped past it (FAFF-795: 1800 → 2400 did exactly this). Derive the age from the LIVE
// configured value + a margin so a future bump can never re-break these. Fresh fixtures
// deliberately stay a small fixed age (isoAgo(10)) — only the stale ones derive.
const STALL_WINDOW_SECS = (() => {
  const r = spawnSync("node", [CLI, "config", "get", "sentry.stall_window_secs"], { encoding: "utf8" });
  const n = Number((r.stdout ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 900; // 900 = RUN_HEARTBEAT_STALE_SECS_DEFAULT
})();
const STALE_AGE_SECS = STALL_WINDOW_SECS + 200; // comfortably past the window

// Build a run-ledger fixture; returns { root, runDir, ledgerBytes() }.
function rootWith(ledger) {
  const root = mkdtempSync(join(tmpdir(), "sentrycheck-"));
  const runDir = join(root, ".faff", "runs", ledger.run_id || "RUN-LIVE");
  mkdirSync(runDir, { recursive: true });
  const bytes = JSON.stringify(ledger, null, 2);
  writeFileSync(join(runDir, "run-ledger.json"), bytes);
  return { root, runDir, ledgerBytes: () => readFileSync(join(runDir, "run-ledger.json"), "utf8") };
}

test("sentrycheck --selftest passes (the pure gate + consult-classifier table)", () => {
  const r = run(["sentrycheck", "--selftest"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("Scenario 1: foreign + running + stale heartbeat -> exactly one sentry check consult, one [warn] line, exit 0, ledger unchanged", () => {
  const { root, runDir, ledgerBytes } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const before = ledgerBytes();
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "hook mode always exits 0");
    assert.equal(r.out.trim(), "", "no stdout decision payload, ever (FAFF-235)");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/);
    assert.match(r.err, /wall-clock-runaway/, "names the tripped signal");
    assert.match(r.err, /intervention:/, "names the chosen intervention");
    assert.match(r.err, /faff sentry check --run-dir/, "names the inspect remedy");
    assert.match(r.err, /faff sentry abort --run-dir .* --worktree/, "names the abort remedy");
    assert.equal(ledgerBytes(), before, "the run ledger's bytes are unchanged — this hook never writes");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Scenario 2: foreign + running + fresh heartbeat -> held, silent, no consult", () => {
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(10), last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "silent: no stdout");
    assert.equal(r.err.trim(), "", "silent: no stderr — a live foreign run is never consulted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("tripped:false stays silent even when a genuine consult is spawned (sentry's verdict is authoritative)", () => {
  // A heartbeat old enough to cross OUR gate's staleness window (shrunk via the env
  // override) but recent enough that sentry's OWN wall-clock-runaway threshold
  // (unaffected by that env var — it reads sentry.stall_window_secs from config,
  // default 900s) does not trip. Proves the gate and the verdict are independently
  // sourced: a consult can fire and still come back clean.
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(10), last_heartbeat: isoAgo(10) },
  });
  try {
    const r = run(["sentrycheck", "--hook", "--root", root],
      { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", FAFF_RUN_HEARTBEAT_STALE_SECS: "5" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "", "no stdout decision payload");
    assert.equal(r.err.trim(), "", "a consulted-but-clean verdict is fully silent, same as no consult at all");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Scenario 3: owned by this session (FAFF_RUN_DIR match) -> silent, no consult regardless of heartbeat age", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "", "the owning session's own run is never self-consulted from this hook");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("holdout scenario (done + stale) -> skip-not-running, silent, no consult", () => {
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "done", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "", "a done run is never abandoned-looking, regardless of timestamps");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("consult-failure notice: a foreign abandoned run whose sentry consult itself faults gets a distinct non-blocking notice (never silent, never a decision payload)", () => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    // Force the CHILD `faff sentry check` to fault while the PARENT hook's own
    // ledger read already succeeded: events.jsonl as a DIRECTORY makes
    // sentryReadEvents's readFileSync throw EISDIR, uncaught up through cmdSentry
    // -> main() rethrows -> the child process exits non-zero with no JSON on
    // stdout. classifySentryConsult reads this as consult-failed ("unexpected
    // exit code"), never as a trip and never as silence.
    mkdirSync(join(runDir, "events.jsonl"));
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "a faulted consult still never blocks the session");
    assert.equal(r.out.trim(), "", "no stdout decision payload even on consult failure");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/);
    assert.match(r.err, /not an all-clear/, "distinct from both the silent and the tripped notices");
    assert.doesNotMatch(r.err, /sentry tripped/, "a faulted consult is never reported as a genuine trip");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("no run dir resolvable -> silent exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "sentrycheck-empty-"));
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-620 Unit 1: resolveSentryRunDir swallows an ENOENT-coded findRoot throw (deleted cwd) -> null", () => {
  const deps = {
    findRoot: () => { const e = new Error("ENOENT: cwd deleted"); e.code = "ENOENT"; throw e; },
    latestRunDir: () => { throw new Error("should not be reached — findRoot threw first"); },
  };
  assert.equal(resolveSentryRunDir({}, deps), null);
});

test("FAFF-620 Unit 2: the catch wraps the whole try, not just findRoot — an ENOENT from latestRunDir also -> null", () => {
  const deps = {
    findRoot: () => { throw new Error("should not be reached — --root is set"); },
    latestRunDir: () => { const e = new Error("ENOENT: run dir deleted mid-scan"); e.code = "ENOENT"; throw e; },
  };
  assert.equal(resolveSentryRunDir({ "--root": "/some/root" }, deps), null);
});

test("FAFF-620 Unit 3: a non-ENOENT fault (e.g. EACCES) stays loud — re-thrown, not swallowed", () => {
  const deps = {
    findRoot: () => { const e = new Error("EACCES: permission denied"); e.code = "EACCES"; throw e; },
    latestRunDir: () => { throw new Error("should not be reached — findRoot threw first"); },
  };
  assert.throws(() => resolveSentryRunDir({}, deps), (e) => e.code === "EACCES");
});

test("unreadable (malformed) ledger -> silent exit 0 (D8: runcheck --hook parity, never nags on a corrupt artifact)", () => {
  const root = mkdtempSync(join(tmpdir(), "sentrycheck-malformed-"));
  const runDir = join(root, ".faff", "runs", "RUN-BAD");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), "{ not valid json");
  try {
    const r = run(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
    assert.equal(r.err.trim(), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("without --hook: prints a usage line to stderr and exits 2 (never silently no-ops)", () => {
  const r = run(["sentrycheck"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--hook/);
});

test("probeServes probe shape: --hook --root <empty tmpdir> exits 0 fast and never reads stdin", () => {
  const root = mkdtempSync(join(tmpdir(), "sentrycheck-probe-"));
  try {
    const r = spawnSync("node", [CLI, "sentrycheck", "--hook", "--root", root], { encoding: "utf8", timeout: 5000, input: "" });
    assert.equal(r.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// FAFF-472 — wire a genuine tripped consult to the andon push channel
// (FAFF-386). `andon send` only — never pump/event-append, since this locus
// fires at a FOREIGN session's turn-end and must not write the foreign run's
// events.jsonl / andon-state.json (non-owner-never-writes, FAFF-235/ADR-0065).
// ---------------------------------------------------------------------------

test("FAFF-472 Scenario 2: tripped consult with andon.url configured -> `andon send` pages exactly once, writing NO state to the foreign run dir", async (t) => {
  // FAFF-798: the andon page is now gated on actsOnSentryAbort(ledger, cfg), so this
  // "still pages" fixture declares an ACTING run (level:"L4") — the L4 short-circuit
  // arms acting before cfg is read, so it pages exactly as before the gate.
  const { root, runDir, ledgerBytes } = rootWith({
    run_id: "RUN-LIVE", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const before = ledgerBytes();
  const { posts, url } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "hook mode always exits 0");
    assert.equal(r.out.trim(), "", "no stdout decision payload, ever (FAFF-235)");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/, "the existing advisory stderr line is unchanged");

    assert.equal(posts.length, 1, "exactly one andon notification sent");
    assert.match(posts[0].body, /sentry tripped/);
    assert.match(posts[0].body, /RUN-LIVE/);
    assert.match(posts[0].body, /wall-clock-runaway/, "the observed signal is carried into the notification body");

    // Non-owner-never-writes (FAFF-235/ADR-0065): no events.jsonl, no andon-state.json,
    // and the ledger's bytes are untouched — `andon send` reads no events and writes
    // no run-dir state, unlike `andon pump`.
    assert.equal(existsSync(join(runDir, "events.jsonl")), false, "no events.jsonl written to the foreign run");
    assert.equal(existsSync(join(runDir, "andon-state.json")), false, "no andon-state.json written to the foreign run");
    assert.equal(ledgerBytes(), before, "the foreign run's ledger bytes are unchanged");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-472: andon.url unset -> tripped consult still writes the existing advisory line, exits 0, and attempts no notification (byte-for-byte no-op on the andon side)", async (t) => {
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.equal(r.out.trim(), "");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/);
    assert.equal(existsSync(join(runDir, "events.jsonl")), false);
    assert.equal(existsSync(join(runDir, "andon-state.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-472: an andon webhook failure never changes the hook's exit-0 contract or the advisory stderr line", async (t) => {
  // FAFF-798: acting run (level:"L4") so the gated andon block is reached and the
  // delivery-failure path is genuinely exercised under the gate.
  const { root, runDir } = rootWith({
    run_id: "RUN-LIVE", level: "L4", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const { posts, url } = await loopbackServer(t, (req, res) => { res.writeHead(500); res.end("nope"); });
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "a failed andon delivery never flips the hook's always-exit-0 contract");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/);
    assert.ok(posts.length >= 1, "delivery was attempted (proving the failure path, not a config miss)");
    assert.equal(existsSync(join(runDir, "andon-state.json")), false, "send never writes state, failed or not");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-472: a non-tripped consult (ok) never calls andon send", async (t) => {
  // A heartbeat old enough to cross OUR gate's staleness window but not sentry's
  // own wall-clock-runaway threshold (same technique as the existing
  // tripped:false test above) — a genuine consult fires and comes back clean.
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(10), last_heartbeat: isoAgo(10) },
  });
  const { posts, url } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root],
      { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", FAFF_RUN_HEARTBEAT_STALE_SECS: "5" });
    assert.equal(r.code, 0);
    assert.equal(r.err.trim(), "", "a consulted-but-clean verdict stays fully silent");
    assert.equal(posts.length, 0, "andon is never paged for a clean verdict");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// FAFF-798 — gate the andon page on actsOnSentryAbort(ledger, cfg), mirroring the
// poller (sentry-poller.js:243-246/285-318). An advisory-only (attended /
// non-declared) trip surfaces the stderr trippedNotice but must NOT page; an L4 or
// config-declared-unattended trip still pages. The stderr advisory (line 171) is
// never gated. These tests read symmetrically to the poller oracle
// (test/sentry-poller.test.mjs:271 attended → no act/no page; :297 declared → page).
// ---------------------------------------------------------------------------

test("FAFF-798: advisory trip (running + stale + tripped, no level, no acting config) writes the advisory but pages NO andon", async (t) => {
  // The primary new coverage: actsOnSentryAbort is false (no L4 level, no
  // autonomous.unattended / sentry_acting), so the gated andon block is skipped
  // even though andon.url IS configured — proving the gate, not a missing url,
  // suppresses the page. Mirrors the poller oracle at test/sentry-poller.test.mjs:271.
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const { posts, url } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\n`);
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "hook mode always exits 0");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/, "the advisory stderr notice fires on every trip, gated or not");
    assert.match(r.err, /wall-clock-runaway/, "the advisory still names the tripped signal");
    assert.equal(posts.length, 0, "an advisory-only trip pages NO andon (the FAFF-798 fix)");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-798: a declared-unattended (autonomous.unattended) trip pages exactly once even with no ledger level", async (t) => {
  // The declaredUnattendedFromConfig(cfg) disjunct of the gate: no L4 level, but the
  // resolved .faffrc declares autonomous.unattended → acting armed → pages. Mirrors
  // the poller oracle at test/sentry-poller.test.mjs:297.
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const { posts, url } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), `andon:\n  url: ${url()}\nautonomous:\n  unattended: true\n`);
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0);
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/);
    assert.equal(posts.length, 1, "a declared-unattended run still pages (config TRUE disjunct)");
    assert.match(posts[0].body, /RUN-LIVE/, "the page carries the run id");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-798: a cfg-load fault on a non-L4 trip fails safe to no page, advisory still fires", async (t) => {
  // readGovernanceConfig throws base-parse-error on a malformed base .faffrc.yaml
  // (a root-level sequence is a non-map → strict parse failure). The hook's
  // try/catch resolves cfg = {}, so actsOnSentryAbort is false for the non-L4 run
  // → no page — the safe direction — while the unconditional advisory still fires
  // and the hook never throws (always exit 0).
  const { root } = rootWith({
    run_id: "RUN-LIVE", admitted: [], outcomes: {},
    owner: { status: "running", started_at: isoAgo(STALE_AGE_SECS), last_heartbeat: isoAgo(STALE_AGE_SECS) },
  });
  const { posts } = await loopbackServer(t);
  writeFileSync(join(root, ".faffrc.yaml"), "- a\n- b\n"); // malformed base → readBaseConfigStrict throws
  try {
    const r = await runAsync(["sentrycheck", "--hook", "--root", root], { FAFF_RUN_DIR: "", FAFF_SESSION_ID: "" });
    assert.equal(r.code, 0, "the hook never throws on a config fault — always exit 0");
    assert.match(r.err, /\[warn\] faff sentrycheck: latest run RUN-LIVE looks abandoned/, "the advisory still fires on a cfg fault");
    assert.equal(posts.length, 0, "a cfg-load fault fails safe toward silence — no page");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
