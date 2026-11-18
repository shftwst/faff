// FAFF-1396 — `faff land`, graft's bounded landing loop as a command. Drives runLand through each
// token with scripted observations (the fake deps stand in for gh, ci-triage and the clock), checks
// that the deadline and re-run budget persist across calls, that --dry-run writes nothing, and runs
// the real CLI end to end against a fake `gh` on PATH.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from "node:fs";
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

test("CLI: detects a later-page regression and captures its checks for a no-push assessment", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faff-land-fix-cli-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false",
    "commit", "--allow-empty", "-qm", "base");
  const main = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", main);
  writeFileSync(join(dir, ".faffrc.yaml"), "graft:\n  landing:\n    autofix: shadow\n");

  const head = "ab".repeat(20);
  const before = join(dir, "before.json");
  const calls = join(dir, "gh-calls.jsonl");
  const failCheckRead = join(dir, "fail-gh-check-read");
  const bin = join(dir, "bin");
  const gh = join(bin, "gh");
  mkdirSync(bin);
  writeFileSync(gh, `#!/usr/bin/env node
const assert = require("node:assert/strict");
const { appendFileSync, existsSync } = require("node:fs");
const args = process.argv.slice(2);
const head = ${JSON.stringify(head)};
const main = ${JSON.stringify(main)};
const root = "repos/o/r/commits/";
const green = { name: "build", status: "completed", conclusion: "success" };
const failed = name => ({ head_sha: head, name, status: "completed", conclusion: "failure" });
const out = data => { console.log(JSON.stringify(data)); process.exit(0); };
const outRows = rows => {
  for (const row of rows) console.log(JSON.stringify(row));
  process.exit(0);
};
if (args[0] === "repo" && args[1] === "view") out({ nameWithOwner: "o/r" });
if (args[0] === "pr" && args[1] === "view" && args[2] === "7") {
  out({ headRefOid: head, mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", reviewDecision: "APPROVED" });
}
if (args[0] === "pr" && args[1] === "checks" && args[2] === "7") {
  out([{ name: "unit", bucket: "fail", link: "https://ci.example.invalid/check/1" }]);
}
if (args.includes("--slurp") || args.includes("--paginate") || args.some(arg => arg.endsWith("?per_page=100"))) {
  const checkHead = args[2] === root + main + "/check-runs?per_page=100" ? main : head;
  assert.deepEqual(args, [
    "api", "--paginate", root + checkHead + "/check-runs?per_page=100",
    "--jq", ".check_runs[] | {head_sha, name, status, conclusion} | @json",
  ]);
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ head: checkHead, paginated: true }) + "\\n");
  if (checkHead === main) outRows([{ ...green, head_sha: main }]);
  if (existsSync(${JSON.stringify(failCheckRead)})) {
    console.error("fixture check-run read failed");
    process.exit(1);
  }
  outRows([
    { ...green, head_sha: head }, failed("unit"), failed("lint, style"), failed("unit"),
    { name: "waiting", head_sha: head, status: "in_progress", conclusion: null },
  ]);
}
if (args[1] === root + head + "/check-runs" || args[1] === root + main + "/check-runs") {
  const checkHead = args[1] === root + head + "/check-runs" ? head : main;
  appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ head: checkHead, paginated: false }) + "\\n");
  out([green]);
}
if (args[1] === root + head + "/status") out({ state: "success", count: 0 });
throw new Error("unexpected gh command: " + args.join(" "));
`);
  chmodSync(gh, 0o755);

  const land = (run, ...flags) => cli(dir, ["land", "--pr", "7", "--issue", ISSUE, "--run-dir", join(dir, run),
    "--fault-domain", "code", "--slice-secs", "5", "--json", ...flags], bin);
  const legacy = land("legacy-run");
  assert.equal(legacy.code, 0, legacy.err || legacy.out);
  assert.equal(JSON.parse(legacy.out).token, "ready");

  writeFileSync(calls, "");
  const captured = land("run", "--fix-checks");
  assert.equal(captured.code, 0, captured.err || captured.out);
  const observation = JSON.parse(captured.out);
  assert.equal(observation.token, "needs-fix");
  assert.equal(observation.reason, "regression");
  assert.equal(observation.head_sha, head);
  assert.deepEqual(observation.failing_checks, ["lint, style", "unit"]);
  const checkReads = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(checkReads.some(read => read.head === main && read.paginated), "triage reads main's pinned checks");
  assert.ok(checkReads.filter(read => read.head === head && read.paginated).length >= 3,
    "observation, triage and capture read the PR's pinned checks");
  assert.ok(checkReads.every(read => read.head !== head || read.paginated), "strict mode never reads just the first PR page");
  writeFileSync(before, captured.out);

  const assessment = cli(dir, ["land", "assess-fix", "--mode", "shadow", "--before", before], bin);
  assert.equal(assessment.code, 0, assessment.err || assessment.out);
  assert.deepEqual(JSON.parse(assessment.out), {
    action: "record-failed", kind: "regression", head_sha: head, failing_checks: ["lint, style", "unit"],
  });

  writeFileSync(failCheckRead, "");
  const refused = land("unreadable-run", "--fix-checks");
  assert.equal(refused.code, 2, refused.err || refused.out);
  assert.equal(JSON.parse(refused.out).token, "errored");
});

test("CLI: bad arguments exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-land-cli-"));
  assert.equal(cli(dir, ["land", "--pr", "x", "--issue", ISSUE, "--run-dir", dir], fakeGh(dir)).code, 2);
  assert.equal(cli(dir, ["land", "--pr", "7", "--issue", ISSUE, "--run-dir", dir, "--fault-domain", "maybe"], fakeGh(dir)).code, 2);
  assert.equal(cli(dir, ["land", "--pr", "7"], fakeGh(dir)).code, 2);
});

test("fix observations capture the current regression head, sorted, with pending checks excluded", () => {
  const triage = { persistent: { origin: "mine", action: "fix-attempt", fault_domain: "code", head_sha: "h1" } };
  const h = harness({ frames: [[CLEAN, RED]], triage });
  h.deps.fixRuns = (repo, head) => {
    assert.equal(repo, "o/r"); assert.equal(head, "h1");
    const rows = ["unit", "a, b", "unit"].map(name => ({ name, head_sha: head, status: "completed", conclusion: "failure" }));
    return { ok: true, data: [...rows, { name: "waiting", head_sha: head, status: "in_progress", conclusion: null }] };
  };
  const r = runLand(h.opts({fixChecks: true}), h.deps);
  assert.equal(r.token, "needs-fix");
  assert.deepEqual(r.failing_checks, ["a, b", "unit"]);
});
test("fix observations reject stale triage, failed reads and malformed or foreign check rows", () => {
  for (const [triageHead, runs] of [
    ["old", null], ["h1", {ok: false}], ["h1", {ok: true, data: []}],
    ["h1", {ok: true, data: [{head_sha: "old", name: "unit", status: "completed", conclusion: "failure"}]}],
    ["h1", {ok: true, data: [{head_sha: "h1", name: "unit", status: "completed"}]}],
  ]) {
    const triage = { persistent: { origin: "mine", action: "fix-attempt", fault_domain: "code", head_sha: triageHead } };
    const h = harness({ frames: [[CLEAN, RED]], triage });
    h.deps.fixRuns = () => { assert.ok(runs, "stale triage must stop before reading checks"); return runs; };
    assert.equal(runLand(h.opts({fixChecks: true}), h.deps).token, "errored");
  }
});
