// FAFF-1396 — `faff land`, graft's bounded landing loop as a command. Drives runLand through each
// token with scripted observations (the fake deps stand in for gh, ci-triage and the clock), checks
// that the deadline and re-run budget persist across calls, that --dry-run writes nothing, and runs
// the real CLI end to end against a fake `gh` on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const CLI = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const { runLand, statePath, DEADLINE_MS, NO_CI_SETTLE_MS, RERUN_SETTLE_MS } = require("../plugin/skills/faff/bin/lib/land.js");

const ISSUE = "FAFF-1";
const GREEN = { ci_state: "ci-green", head_sha_matches: true };
const RED = { ci_state: "ci-red", head_sha_matches: true };
const PENDING = { ci_state: "indeterminate", head_sha_matches: true };
const NO_CI = { ci_state: "no-ci-coverage", head_sha_matches: true };
const CLEAN = { mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", reviewDecision: "" };

// Scripted deps. `frames` is the sequence of [view, ci] observations; the last frame repeats.
// `triage` maps a transience to the verdict ci-triage returns. Each sleep advances the clock.
function harness({ frames, triage = {}, reviewPass = true, rerunOk = true, updateOk = true, runLink = "https://github.com/o/r/actions/runs/42/job/1", startMs = Date.parse("2026-10-24T00:00:00Z") }) {
  const runDir = mkdtempSync(join(tmpdir(), "faff-land-"));
  let t = startMs, i = 0;
  const calls = { triage: [], rerun: [], updateBranch: 0, writes: 0, heartbeats: 0 };
  const frame = () => frames[Math.min(i, frames.length - 1)];
  const deps = {
    now: () => t,
    sleep: (ms) => { t += ms; i += 1; },
    heartbeat: () => { calls.heartbeats += 1; },
    repo: () => "o/r",
    view: () => ({ ok: true, data: { headRefOid: frame()[0].head || "h1", ...frame()[0] } }),
    observeCi: () => frame()[1],
    checks: () => ({ ok: true, data: [{ name: "unit", bucket: "fail", link: runLink }] }),
    rerun: (id) => { calls.rerun.push(id); return rerunOk; },
    updateBranch: () => { calls.updateBranch += 1; return updateOk; },
    triage: (pr, transience, fd) => { calls.triage.push([transience, fd]); return { verdict: triage[transience] || { origin: "mine", action: "park-needs-human", fault_domain: "unknown" } }; },
    writeTriage: () => { calls.writes += 1; },
    reviewPass: () => reviewPass,
  };
  const opts = (over = {}) => ({ pr: "7", issue: ISSUE, runDir, sliceMs: 480000, faultDomain: null, dryRun: false, ...over });
  return { deps, opts, calls, runDir, advance: (ms) => { t += ms; } };
}

test("green, mergeable, review pass -> ready, exit 0", () => {
  const h = harness({ frames: [[CLEAN, GREEN]] });
  const r = runLand(h.opts(), h.deps);
  assert.equal(r.token, "ready");
  assert.equal(r.exit, 0);
});

test("pending CI is waited out, then ready", () => {
  const h = harness({ frames: [[CLEAN, PENDING], [CLEAN, PENDING], [CLEAN, GREEN]] });
  assert.equal(runLand(h.opts(), h.deps).token, "ready");
  assert.ok(h.calls.heartbeats >= 3, "the heartbeat ticks every pass");
});

test("a spent slice returns pending, exit 3, and the next call resumes the same loop", () => {
  const h = harness({ frames: [[CLEAN, PENDING]] });
  const r = runLand(h.opts({ sliceMs: 60000 }), h.deps);
  assert.equal(r.token, "pending");
  assert.equal(r.exit, 3);
  const started = JSON.parse(readFileSync(statePath(h.runDir, ISSUE), "utf8")).started_at;
  runLand(h.opts({ sliceMs: 60000 }), h.deps);
  assert.equal(JSON.parse(readFileSync(statePath(h.runDir, ISSUE), "utf8")).started_at, started, "the deadline clock is not reset by a new call");
});

test("the 25-minute deadline, counted across calls, returns landing-resumable", () => {
  const h = harness({ frames: [[CLEAN, PENDING]] });
  let r;
  do { r = runLand(h.opts(), h.deps); } while (r.token === "pending");
  assert.equal(r.token, "landing-resumable");
  assert.equal(r.exit, 0);
});

test("no-ci-coverage is reported only once it holds on the same head", () => {
  const h = harness({ frames: [[CLEAN, NO_CI]] });
  const r = runLand(h.opts(), h.deps);
  assert.equal(r.token, "leave-for-human");
  assert.equal(r.reason, "no-ci-coverage");
  assert.ok(Date.parse(JSON.parse(readFileSync(statePath(h.runDir, ISSUE), "utf8")).no_ci.at) > 0);
  assert.ok(NO_CI_SETTLE_MS > 0);
});

test("a conflict returns needs-fix:conflict without waiting on CI", () => {
  const h = harness({ frames: [[{ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }, { ci_state: "ci-green", head_sha_matches: false }]] });
  const r = runLand(h.opts(), h.deps);
  assert.equal(r.token, "needs-fix");
  assert.equal(r.reason, "conflict");
});

test("BEHIND updates the branch, then lands", () => {
  const h = harness({ frames: [[{ mergeStateStatus: "BEHIND", mergeable: "MERGEABLE" }, GREEN], [{ ...CLEAN, head: "h2" }, GREEN]] });
  assert.equal(runLand(h.opts(), h.deps).token, "ready");
  assert.equal(h.calls.updateBranch, 1);
});

test("a failed branch update -> leave-for-human:rebase-conflict", () => {
  const h = harness({ frames: [[{ mergeStateStatus: "BEHIND", mergeable: "MERGEABLE" }, GREEN]], updateOk: false });
  const r = runLand(h.opts(), h.deps);
  assert.deepEqual([r.token, r.reason], ["leave-for-human", "rebase-conflict"]);
});

test("main was red -> leave-for-human:ci-red-park, nothing re-run", () => {
  const h = harness({ frames: [[CLEAN, RED]], triage: { unknown: { origin: "main-was-red", action: "park-needs-human", fault_domain: "unknown" } } });
  const r = runLand(h.opts(), h.deps);
  assert.deepEqual([r.token, r.reason], ["leave-for-human", "ci-red-park"]);
  assert.equal(h.calls.rerun.length, 0);
});

test("a flake: re-run once, green, recorded as transient, then ready", () => {
  const h = harness({ frames: [[CLEAN, RED], [CLEAN, PENDING], [CLEAN, GREEN]], triage: { transient: { origin: "mine", action: "proceed-to-merge-gate", fault_domain: "unknown" } } });
  assert.equal(runLand(h.opts(), h.deps).token, "ready");
  assert.deepEqual(h.calls.rerun, ["42"]);
  assert.deepEqual(h.calls.triage.map((c) => c[0]), ["unknown", "transient"]);
});

test("a red reading straight after the re-run request is the old attempt, not the result", () => {
  // red, then the old attempt still reads red for a moment, then the re-run runs and goes green
  const h = harness({ frames: [[CLEAN, RED], [CLEAN, RED], [CLEAN, PENDING], [CLEAN, GREEN]], triage: { transient: { origin: "mine", action: "proceed-to-merge-gate", fault_domain: "unknown" } } });
  assert.equal(runLand(h.opts(), h.deps).token, "ready");
  assert.deepEqual(h.calls.triage.map((c) => c[0]), ["unknown", "transient"]);
});

test("a re-run never seen running stays red only after the settle window", () => {
  const h = harness({ frames: [[CLEAN, RED]], triage: { persistent: { origin: "mine", action: "fix-attempt", fault_domain: "code" } } });
  const t0 = h.deps.now();
  const r = runLand(h.opts(), h.deps);
  assert.deepEqual([r.token, r.reason], ["needs-fix", "regression"]);
  assert.ok(h.deps.now() - t0 >= RERUN_SETTLE_MS, "it waited out the settle window before calling it persistent");
});

test("re-run, still red: persistent + code -> needs-fix:regression", () => {
  const h = harness({ frames: [[CLEAN, RED], [CLEAN, PENDING], [CLEAN, RED]], triage: { persistent: { origin: "mine", action: "fix-attempt", fault_domain: "code" } } });
  const r = runLand(h.opts(), h.deps);
  assert.deepEqual([r.token, r.reason], ["needs-fix", "regression"]);
});

test("persistent + infra -> leave-for-human:ci-red-park", () => {
  const h = harness({ frames: [[CLEAN, RED], [CLEAN, PENDING], [CLEAN, RED]], triage: { persistent: { origin: "mine", action: "park-errored", fault_domain: "infra" } } });
  assert.equal(runLand(h.opts(), h.deps).reason, "ci-red-park");
});

test("an undecided fault domain asks once; the re-invoke with --fault-domain routes it", () => {
  const h = harness({ frames: [[CLEAN, RED], [CLEAN, PENDING], [CLEAN, RED]] });
  const r1 = runLand(h.opts(), h.deps);
  assert.deepEqual([r1.token, r1.reason], ["needs-judgement", "fault-domain"]);
  h.deps.triage = (pr, transience, fd) => { h.calls.triage.push([transience, fd]); return { verdict: { origin: "mine", action: fd === "code" ? "fix-attempt" : "park-errored", fault_domain: fd } }; };
  const r2 = runLand(h.opts({ faultDomain: "code" }), h.deps);
  assert.deepEqual([r2.token, r2.reason], ["needs-fix", "regression"]);
  assert.deepEqual(h.calls.triage.at(-1), ["persistent", "code"]);
  assert.equal(h.calls.rerun.length, 1, "the re-invoke does not spend a second re-run");
});

test("the re-run budget holds across calls: a sha already re-run is persistent by fiat", () => {
  const h = harness({ frames: [[CLEAN, RED]] });
  mkdirSync(dirname(statePath(h.runDir, ISSUE)), { recursive: true });
  writeFileSync(statePath(h.runDir, ISSUE), JSON.stringify({ schema: 1, pr: 7, started_at: new Date(h.deps.now()).toISOString(), reruns_by_sha: { h1: 1 }, reruns_total: 1, probe: null, no_ci: null }));
  runLand(h.opts(), h.deps);
  assert.equal(h.calls.rerun.length, 0);
  assert.deepEqual(h.calls.triage.map((c) => c[0]), ["unknown", "persistent"]);
});

test("a failing check with no Actions run cannot be re-run, so it reads as persistent", () => {
  const h = harness({ frames: [[CLEAN, RED]], runLink: "https://ci.example/1", triage: { persistent: { origin: "mine", action: "fix-attempt", fault_domain: "code" } } });
  assert.equal(runLand(h.opts(), h.deps).reason, "regression");
  assert.equal(h.calls.rerun.length, 0);
});

test("state from a different PR is not reused", () => {
  const h = harness({ frames: [[CLEAN, GREEN]] });
  mkdirSync(dirname(statePath(h.runDir, ISSUE)), { recursive: true });
  writeFileSync(statePath(h.runDir, ISSUE), JSON.stringify({ schema: 1, pr: 6, started_at: "2000-01-01T00:00:00Z", reruns_by_sha: {}, reruns_total: 2, probe: null, no_ci: null }));
  assert.equal(runLand(h.opts(), h.deps).token, "ready", "an old deadline from PR 6 must not expire PR 7");
});

test("--dry-run reports the next action and writes nothing", () => {
  const h = harness({ frames: [[CLEAN, RED]] });
  const r = runLand(h.opts({ dryRun: true }), h.deps);
  assert.equal(r.token, "dry-run");
  assert.equal(r.would, "rerun");
  assert.equal(h.calls.rerun.length, 0);
  assert.equal(h.calls.writes, 0);
  assert.equal(h.calls.heartbeats, 0);
  assert.equal(existsSync(statePath(h.runDir, ISSUE)), false);
  const behind = harness({ frames: [[{ mergeStateStatus: "BEHIND", mergeable: "MERGEABLE" }, GREEN]] });
  assert.equal(runLand(behind.opts({ dryRun: true }), behind.deps).would, "update-branch");
  assert.equal(behind.calls.updateBranch, 0);
});

test("the deadline constant is the 25 minutes the prose named", () => {
  assert.equal(DEADLINE_MS, 25 * 60 * 1000);
});

// --- the real CLI, end to end, against a fake gh on PATH ---
function fakeGh(dir, { mergeable = "MERGEABLE", state = "CLEAN" } = {}) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const script = `#!/usr/bin/env node
const a = process.argv.slice(2).join(" ");
const out = (o) => { process.stdout.write(JSON.stringify(o)); process.exit(0); };
if (a.startsWith("repo view")) out({ nameWithOwner: "o/r" });
if (a.startsWith("pr view")) out({ headRefOid: "abc", mergeStateStatus: "${state}", mergeable: "${mergeable}", reviewDecision: "APPROVED" });
if (a.includes("/check-runs")) out([{ status: "completed", conclusion: "success" }]);
if (a.includes("/status")) out({ state: "success", count: 0 });
if (a.startsWith("api user")) out({ login: "t" });
process.stderr.write("fake gh: unhandled " + a + "\\n"); process.exit(1);
`;
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

function cli(dir, args, bin) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

test("CLI: a green, mergeable, approved PR -> ready", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-land-cli-"));
  const runDir = join(dir, "run");
  mkdirSync(runDir, { recursive: true });
  const r = cli(dir, ["land", "--pr", "7", "--issue", ISSUE, "--run-dir", runDir, "--json"], fakeGh(dir));
  assert.equal(r.code, 0, r.err || r.out);
  const j = JSON.parse(r.out);
  assert.equal(j.token, "ready");
  assert.equal(j.head_sha, "abc");
});

test("CLI: --dry-run on a conflicting PR reports needs-fix:conflict and writes no state", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-land-cli-"));
  const runDir = join(dir, "run");
  const r = cli(dir, ["land", "--pr", "7", "--issue", ISSUE, "--run-dir", runDir, "--dry-run", "--json"], fakeGh(dir, { mergeable: "CONFLICTING", state: "DIRTY" }));
  assert.equal(r.code, 0, r.err || r.out);
  assert.equal(JSON.parse(r.out).would, "needs-fix:conflict");
  assert.equal(existsSync(join(runDir, ISSUE, "landing-loop.json")), false);
});

test("CLI: bad arguments exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-land-cli-"));
  assert.equal(cli(dir, ["land", "--pr", "x", "--issue", ISSUE, "--run-dir", dir], fakeGh(dir)).code, 2);
  assert.equal(cli(dir, ["land", "--pr", "7", "--issue", ISSUE, "--run-dir", dir, "--fault-domain", "maybe"], fakeGh(dir)).code, 2);
  assert.equal(cli(dir, ["land", "--pr", "7"], fakeGh(dir)).code, 2);
});
