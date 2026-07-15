// FAFF-471 — `faff sentrycheck --hook`: ADR-0065's cheap ASSIST watchdog locus, the
// third member of the Stop-hook family alongside runcheck/prepcheck. Drives the
// real entrypoint against fixture roots (runcheck-gate.test.mjs pattern) — the
// pure gate + consult-outcome classifier are covered by `sentrycheck --selftest`
// (see plugin/skills/faff/bin/lib/sentrycheck.js); these tests exercise the real
// child spawn of the unmodified `faff sentry check` CLI, matching the three
// visible Scenarios in the spec plus the consult-failure notice.
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
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
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
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
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
    owner: { status: "done", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
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
    owner: { status: "running", started_at: isoAgo(2000), last_heartbeat: isoAgo(2000) },
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
