// FAFF-1437 — `faff run close`: beep-boop's run-end bracket as one verb.
// The procedure is driven through `runClose` with injected `faff` and `git` spawners (each reply
// scripted, every call recorded) over a real ledger file in a temp root; the stop-token, refusal
// and output rules through `cmdRunClose` and the shipped CLI; and one git-only commit through real
// git. Case names are the ones the spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const rcl = require("../plugin/skills/faff/bin/lib/run-close.js");

const RUN_ID = "run-20260101-000000-beepboop-full-abc123";

function makeRun(ledger = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-run-close-"));
  const runDir = join(root, ".faff", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: RUN_ID, level: "L3", admitted: [], outcomes: {}, owner: { status: "running", started_at: "2026-01-01T00:00:00Z", last_heartbeat: "2026-01-01T00:00:00Z" }, ...ledger }, null, 2));
  writeFileSync(join(runDir, "events.jsonl"), "");
  return { root, runDir };
}
const readLedger = (fx) => JSON.parse(readFileSync(join(fx.runDir, "run-ledger.json"), "utf8"));
const bytes = (fx) => [readFileSync(join(fx.runDir, "run-ledger.json"), "utf8"), readFileSync(join(fx.runDir, "events.jsonl"), "utf8")];

const ok = (obj = {}) => ({ status: 0, stdout: typeof obj === "string" ? obj : JSON.stringify(obj), stderr: "" });
const fail = (status = 1) => ({ status, stdout: "", stderr: "boom" });

function key(args) {
  if (args[0] === "commissaire") return args.slice(0, 3).join(" ");
  return args[1] === undefined || args[1].startsWith("--") ? args[0] : `${args[0]} ${args[1]}`;
}

function fakeDeps(replies = {}, gitReplies = {}) {
  const calls = [];
  const gitCalls = [];
  const base = {
    "events append": ok(),
    "sentry-poller stop": ok(),
    "commissaire contract status": ok({ governed: false }),
    "commissaire effect reconcile": ok(),
    "commissaire verdict conclude": ok(),
    "events anchor-run": ok(),
    "bundle publish": ok(),
    "judge-trail mint": ok(),
    "andon pump": ok(),
  };
  const table = { ...base, ...replies };
  const gitBase = { add: ok(), diff: fail(1), commit: ok() };
  const gitTable = { ...gitBase, ...gitReplies };
  return {
    calls,
    gitCalls,
    faff: (args, o) => {
      calls.push({ args, input: o.input, cwd: o.cwd, timeoutMs: o.timeoutMs });
      const r = table[key(args)];
      if (r === undefined) throw new Error(`unscripted faff ${args.join(" ")}`);
      return typeof r === "function" ? r(args, o) : r;
    },
    git: (args, cwd) => {
      gitCalls.push({ args, cwd });
      const r = gitTable[args[0]];
      return typeof r === "function" ? r(args, cwd) : r;
    },
    mutateLedger: (runDir, mutate) => {
      const file = join(runDir, "run-ledger.json");
      const next = mutate(JSON.parse(readFileSync(file, "utf8")));
      if (next) writeFileSync(file, JSON.stringify(next, null, 2));
      return { written: !!next };
    },
  };
}
const called = (deps, k) => deps.calls.filter((c) => key(c.args) === k);

function close(fx, deps, over = {}) {
  return rcl.runClose({ runDir: fx.runDir, stopReason: "queue-drained", gitOnly: false, root: fx.root, sessionId: null, ...over }, deps);
}

function capture(fn) {
  const out = [];
  const err = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  let code;
  try { code = fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
  return { code, out: out.join(""), err: err.join("") };
}

// --- Completeness (§4.2 step 2) ---

test("refusal: undispatched admitted issues and invalid outcomes exit 3 and leave the ledger and events byte-identical", () => {
  for (const ledger of [{ admitted: ["A", "B"], outcomes: { A: "shipped" } }, { admitted: ["A"], outcomes: { A: "half-done" } }]) {
    const fx = makeRun(ledger);
    const before = bytes(fx);
    const deps = fakeDeps();
    const r = close(fx, deps);
    assert.equal(r.code, 3);
    assert.equal(r.result.closed, false);
    assert.deepEqual(bytes(fx), before);
    assert.equal(deps.calls.length, 0, "nothing is spawned");
    assert.equal(r.result.owner_status, "running", "owner_status as read");
    assert.ok(Object.values(r.result.steps).every((s) => s === "skipped"));
  }
  const fx = makeRun({ admitted: ["A", "B"], outcomes: { A: "shipped" } });
  assert.deepEqual(close(fx, fakeDeps()).result.undispatched, ["B"]);
});

test("abort exemption: a sentry-abort close of a run with the abort mark closes, reports undispatched and leaves outcomes untouched", () => {
  const aborted = { admitted: ["A", "B"], outcomes: { A: "shipped" }, abort: { status: "aborted-resumable" }, owner: { status: "aborted-resumable" } };
  const fx = makeRun(aborted);
  const r = close(fx, fakeDeps(), { stopReason: "sentry-abort" });
  assert.equal(r.code, 0);
  assert.equal(r.result.abort_exempt, true);
  assert.deepEqual(r.result.undispatched, ["B"]);
  const l = readLedger(fx);
  assert.deepEqual(l.outcomes, { A: "shipped" });
  assert.equal(l.stop_reason, "sentry-abort");
  // The mark alone (owner or ledger.abort) is enough; another token or no mark keeps the refusal.
  assert.equal(close(makeRun({ ...aborted, owner: { status: "running" } }), fakeDeps(), { stopReason: "sentry-abort" }).code, 0);
  assert.equal(close(makeRun(aborted), fakeDeps(), { stopReason: "queue-drained" }).code, 3);
  assert.equal(close(makeRun({ admitted: ["A"], outcomes: {} }), fakeDeps(), { stopReason: "sentry-abort" }).code, 3, "sentry-abort with no abort mark");
});

test("abort exemption leaves resumable work unconcluded: undispatched issues are neither reconciled nor concluded on a governed run", () => {
  const aborted = { admitted: ["A", "B", "C"], outcomes: { A: "shipped", C: "parked" }, abort: { status: "aborted-resumable" }, owner: { status: "aborted-resumable" } };
  const deps = fakeDeps({ "commissaire contract status": ok({ governed: true }) });
  const r = close(makeRun(aborted), deps, { stopReason: "sentry-abort" });
  assert.equal(r.code, 0);
  assert.deepEqual(r.result.undispatched, ["B"]);
  assert.deepEqual(r.result.steps.conclude.map((e) => e.issue), ["A", "C"]);
  for (const k of ["commissaire effect reconcile", "commissaire verdict conclude"]) {
    assert.ok(!called(deps, k).some((c) => c.args.includes("B")), `${k} never names B`);
  }
  // Outside the exemption every admitted issue is concluded.
  const full = fakeDeps({ "commissaire contract status": ok({ governed: true }) });
  close(makeRun({ admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" } }), full);
  assert.equal(called(full, "commissaire verdict conclude").length, 2);
});

test("owner close refused: a refused or yielded owner-close write exits 2 with closed false and owner_status null, and nothing after it runs", () => {
  for (const mutateLedger of [() => { throw new Error("schema: owner.status"); }, () => ({ written: false, yielded: true })]) {
    const fx = makeRun({ admitted: ["A"], outcomes: { A: "shipped" } });
    const deps = { ...fakeDeps({ "commissaire contract status": ok({ governed: true }) }), mutateLedger };
    const r = close(fx, deps);
    assert.equal(r.code, 2);
    assert.equal(r.result.closed, false);
    assert.equal(r.result.owner_status, null);
    assert.equal(r.result.steps.owner_close, "failed:write");
    assert.equal(readLedger(fx).owner.status, "running");
    for (const k of ["sentry-poller stop", "commissaire verdict conclude", "judge-trail mint", "andon pump"]) assert.equal(called(deps, k).length, 0, k);
  }
});

test("aborted kept: an aborted-resumable owner keeps its status, any other owner becomes done", () => {
  const fx = makeRun({ owner: { status: "aborted-resumable" }, abort: { status: "aborted-resumable" } });
  assert.equal(close(fx, fakeDeps(), { stopReason: "sentry-abort" }).result.owner_status, "aborted-resumable");
  assert.equal(readLedger(fx).owner.status, "aborted-resumable");
  const fx2 = makeRun();
  assert.equal(close(fx2, fakeDeps()).result.owner_status, "done");
  assert.equal(readLedger(fx2).owner.status, "done");
});

// --- Stop tokens and re-close (§4.2 step 1) ---

test("stop tokens: every documented token is accepted and anything else is refused before any write", () => {
  for (const t of ["queue-drained", "all-remaining-parked", "budget-hit(until)", "budget-hit(tokens,cost)", "budget-escalated(max_attempts,window)", "sentry-abort", "converged/both-dry", "non-convergence", "product-incomplete", "governance-admit-failed"]) {
    assert.equal(rcl.validStopToken(t), true, t);
  }
  for (const t of ["queue-drianed", "budget-hit()", "budget-hit(dollars)", "budget-hit(until", "budget-stopped(until)", ""]) assert.equal(rcl.validStopToken(t), false, t);
  const fx = makeRun();
  const before = bytes(fx);
  const deps = fakeDeps();
  const r = close(fx, deps, { stopReason: "queue-drianed" });
  assert.equal(r.code, 2);
  assert.deepEqual(bytes(fx), before);
  assert.equal(deps.calls.length, 0);
});

test("close twice: the same token is idempotent; a different token after an escalate-class close exits 2 and keeps stop_reason", () => {
  const fx = makeRun();
  assert.equal(close(fx, fakeDeps(), { stopReason: "non-convergence" }).code, 0);
  assert.equal(close(fx, fakeDeps(), { stopReason: "non-convergence" }).code, 0);
  const before = bytes(fx);
  const deps = fakeDeps();
  const r = close(fx, deps, { stopReason: "queue-drained" });
  assert.equal(r.code, 2);
  assert.match(r.reason, /run already closed as non-convergence/);
  assert.deepEqual(bytes(fx), before);
  assert.equal(readLedger(fx).stop_reason, "non-convergence");
});

// --- The bracket (§4.2 steps 3–9) ---

test("run-end payload: shipped/parked counts, token-tagged with --root and --session-id forwarded", () => {
  const fx = makeRun({ admitted: ["A", "B", "C", "D"], outcomes: { A: "shipped", B: "shipped", C: "parked", D: "errored" } });
  const deps = fakeDeps();
  close(fx, deps, { sessionId: "S" });
  const ends = called(deps, "events append").filter((c) => JSON.parse(c.input).type === "run-end");
  assert.equal(ends.length, 1);
  assert.deepEqual(JSON.parse(ends[0].input), { phase: "run", type: "run-end", data: { stop_reason: "queue-drained", shipped: 2, parked: 1 } });
  assert.deepEqual(ends[0].args, ["events", "append", "--run", RUN_ID, "--root", fx.root, "--tokens", "--session-id", "S"]);
  const noSession = fakeDeps();
  close(makeRun(), noSession);
  assert.ok(!called(noSession, "events append")[0].args.includes("--session-id"), "omitted when absent");
});

test("owner close: stop_reason and owner.status land in one write, followed by a ledger-write event", () => {
  const fx = makeRun({ owner: { status: "running", pid: 7, started_at: "2026-01-01T00:00:00Z", utc_offset_min: 60 } });
  const deps = fakeDeps();
  const r = close(fx, deps);
  assert.equal(r.result.steps.owner_close, "ok");
  const l = readLedger(fx);
  assert.equal(l.stop_reason, "queue-drained");
  assert.deepEqual(l.owner, { status: "done", pid: 7, started_at: "2026-01-01T00:00:00Z", utc_offset_min: 60 });
  const types = called(deps, "events append").map((c) => JSON.parse(c.input).type);
  assert.deepEqual(types, ["run-end", "ledger-write"]);
});

test("poller stop fault: a failed poller stop is a fault and the close proceeds", () => {
  const r = close(makeRun(), fakeDeps({ "sentry-poller stop": fail(1) }));
  assert.equal(r.code, 0);
  assert.equal(r.result.steps.poller_stop, "failed:1");
  assert.ok(r.result.faults.includes("sentry-poller-stop-failed"));
});

test("conclude loop: a governed run reconciles then concludes each admitted issue in ledger order, never stopping on one", () => {
  const fx = makeRun({ admitted: ["B", "A", "C"], outcomes: { A: "shipped", B: "parked", C: "shipped" } });
  const deps = fakeDeps({ "commissaire contract status": ok({ governed: true }), "commissaire verdict conclude": (args) => (args.includes("A") ? fail(2) : ok()) });
  const r = close(fx, deps);
  assert.equal(r.code, 0);
  assert.deepEqual(r.result.steps.conclude, [
    { issue: "B", reconcile_exit: 0, conclude_exit: 0 },
    { issue: "A", reconcile_exit: 0, conclude_exit: 2 },
    { issue: "C", reconcile_exit: 0, conclude_exit: 0 },
  ]);
  const seq = deps.calls.filter((c) => c.args[0] === "commissaire" && c.args[1] !== "contract").map((c) => `${c.args[1]}:${c.args.at(-1)}`);
  assert.deepEqual(seq, ["effect:B", "verdict:B", "effect:A", "verdict:A", "effect:C", "verdict:C"]);
  assert.ok(r.result.faults.includes("conclude-failed:A"));
});

test("probe failure runs loop: an unanswerable status probe is treated as governed", () => {
  for (const reply of [fail(1), { status: null, stdout: "", stderr: "" }, ok("nope")]) {
    const deps = fakeDeps({ "commissaire contract status": reply });
    const r = close(makeRun({ admitted: ["A"], outcomes: { A: "shipped" } }), deps);
    assert.equal(r.code, 0);
    assert.equal(called(deps, "commissaire verdict conclude").length, 1);
    assert.match(r.result.steps.governance_probe, /^failed:/);
    assert.equal(called(deps, "commissaire contract status")[0].timeoutMs, 30000);
  }
});

test("ungoverned: a probe answering governed:false skips the conclude loop", () => {
  const deps = fakeDeps();
  const r = close(makeRun({ admitted: ["A"], outcomes: { A: "shipped" } }), deps);
  assert.equal(r.result.steps.conclude, "skipped");
  assert.equal(called(deps, "commissaire effect reconcile").length, 0);
});

test("no audit seal spawn: the close never seals", () => {
  const deps = fakeDeps({ "commissaire contract status": ok({ governed: true }) });
  close(makeRun({ admitted: ["A"], outcomes: { A: "shipped" } }), deps, { gitOnly: true });
  assert.equal(deps.calls.filter((c) => c.args[0] === "audit").length, 0);
});

test("git-only anchor: anchor-run, a path-limited commit and the run-close bundle", () => {
  const fx = makeRun();
  const deps = fakeDeps();
  const r = close(fx, deps, { gitOnly: true });
  assert.equal(r.result.steps.anchor_run, "ok");
  assert.equal(r.result.steps.anchor_commit, "ok");
  assert.equal(r.result.steps.bundle_publish, "ok");
  const anchorPath = join(".faff", "anchors", RUN_ID);
  assert.deepEqual(deps.gitCalls.map((c) => c.args), [
    ["add", "--", anchorPath],
    ["diff", "--cached", "--quiet", "--", anchorPath],
    ["commit", "-m", `chore(anchor): run-level evidence anchor for ${RUN_ID}`, "--", anchorPath],
  ]);
  assert.deepEqual(called(deps, "bundle publish")[0].args, ["bundle", "publish", "--run-dir", fx.runDir, "--boundary-kind", "run-close", "--boundary-key", "run-close"]);
  // Nothing staged (an already-anchored re-run) is a tolerated no-op, never a commit.
  const again = fakeDeps({}, { diff: ok() });
  assert.equal(close(makeRun(), again, { gitOnly: true }).result.steps.anchor_commit, "ok");
  assert.ok(!again.gitCalls.some((c) => c.args[0] === "commit"));
});

test("anchor failure skips: a failed anchor-run skips the commit and the bundle", () => {
  const deps = fakeDeps({ "events anchor-run": fail(3) });
  const r = close(makeRun(), deps, { gitOnly: true });
  assert.equal(r.code, 0);
  assert.equal(r.result.steps.anchor_run, "failed:3");
  assert.equal(r.result.steps.anchor_commit, "skipped");
  assert.equal(r.result.steps.bundle_publish, "skipped");
  assert.equal(deps.gitCalls.length, 0);
  assert.equal(called(deps, "bundle publish").length, 0);
});

test("judge-trail non-git-only: the judge trail is minted on a tracker-backed run, with no anchor", () => {
  const deps = fakeDeps();
  const r = close(makeRun(), deps);
  assert.equal(r.result.steps.judge_trail, "ok");
  assert.equal(r.result.steps.anchor_run, "skipped");
  assert.equal(called(deps, "events anchor-run").length, 0);
});

test("andon fault: a failed andon pump is a fault and the close still exits 0", () => {
  const r = close(makeRun(), fakeDeps({ "andon pump": fail(1) }));
  assert.equal(r.code, 0);
  assert.ok(r.result.faults.includes("andon-pump-failed"));
});

test("spawn throws: a subcommand spawn that throws is that step's failure, never a crash", () => {
  const r = close(makeRun(), fakeDeps({ "judge-trail mint": () => { throw new Error("EAGAIN"); } }));
  assert.equal(r.code, 0);
  assert.equal(r.result.steps.judge_trail, "failed:timeout");
  assert.ok(r.result.faults.includes("judge-trail-failed"));
});

// --- Root and run dir ---

test("root drift: a pinned measure_root wins over a differing --root, recorded as a fault", () => {
  const fx = makeRun();
  const l = readLedger(fx);
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ ...l, budget: { measure_root: fx.root } }));
  const other = mkdtempSync(join(tmpdir(), "faff-run-close-other-"));
  const deps = fakeDeps();
  const r = close(fx, deps, { root: other });
  assert.ok(r.result.faults.includes("root-drift"));
  assert.equal(deps.calls[0].cwd, fx.root);
});

test("run dir outside root: a run dir not under the resolved root exits 2", () => {
  const fx = makeRun();
  const other = mkdtempSync(join(tmpdir(), "faff-run-close-other-"));
  const r = close(fx, fakeDeps(), { root: other });
  assert.equal(r.code, 2);
  assert.match(r.reason, /is not/);
});

// --- The verb: output on each exit ---

test("--json field values: the whole CloseResult on 0, 3 and 2", () => {
  const keys = ["abort_exempt", "closed", "faults", "owner_status", "steps", "undispatched"];
  const fx0 = makeRun();
  const r0 = capture(() => rcl.cmdRunClose(["--run-dir", fx0.runDir, "--stop-reason", "queue-drained", "--root", fx0.root, "--json"], fakeDeps()));
  assert.equal(r0.code, 0);
  const o0 = JSON.parse(r0.out);
  assert.deepEqual(Object.keys(o0).sort(), keys);
  assert.equal(o0.closed, true);
  assert.equal(o0.owner_status, "done");
  const fx3 = makeRun({ admitted: ["A"], outcomes: {} });
  const r3 = capture(() => rcl.cmdRunClose(["--run-dir", fx3.runDir, "--stop-reason", "queue-drained", "--root", fx3.root, "--json"], fakeDeps()));
  assert.equal(r3.code, 3);
  const o3 = JSON.parse(r3.out);
  assert.deepEqual(o3.undispatched, ["A"]);
  assert.equal(o3.owner_status, "running");
  assert.equal(o3.closed, false);
  const fx2 = makeRun();
  const r2 = capture(() => rcl.cmdRunClose(["--run-dir", fx2.runDir, "--stop-reason", "bogus", "--json"], fakeDeps()));
  assert.equal(r2.code, 2);
  const o2 = JSON.parse(r2.out);
  assert.equal(o2.owner_status, null);
  assert.equal(o2.closed, false);
  assert.ok(Object.values(o2.steps).every((s) => s === "skipped"));
  assert.match(o2.faults.at(-1), /unknown stop reason/);
});

// --- The shipped CLI ---

function cli(cwd, args) {
  const env = { ...process.env };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID"]) delete env[k];
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

test("real CLI: a refusal exits 3 with undispatched and leaves the files byte-identical", () => {
  const fx = makeRun({ admitted: ["A", "B"], outcomes: { A: "shipped" } });
  const before = bytes(fx);
  const r = cli(fx.root, ["run", "close", "--run-dir", fx.runDir, "--stop-reason", "queue-drained", "--json"]);
  assert.equal(r.code, 3, r.err);
  assert.deepEqual(JSON.parse(r.out).undispatched, ["B"]);
  assert.deepEqual(bytes(fx), before);
});

test("real CLI: a typo'd stop reason exits 2 and the ledger is unchanged", () => {
  const fx = makeRun();
  const before = bytes(fx);
  const r = cli(fx.root, ["run", "close", "--run-dir", fx.runDir, "--stop-reason", "queue-drianed"]);
  assert.equal(r.code, 2);
  assert.deepEqual(bytes(fx), before);
});

test("real CLI: an aborted run closes under the abort exemption and records run-end", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-run-close-cli-"));
  spawnSync("git", ["-C", root, "init", "-q"]);
  const mint = spawnSync("node", [CLI, "run-ledger", "init-self-drain", "--mode", "full", "--root", root], { cwd: root, encoding: "utf8", env: { ...process.env, FAFF_RUN_DIR: "" } });
  assert.equal(mint.status, 0, mint.stderr);
  const runDir = mint.stdout.trim().split("\n").pop();
  const file = join(runDir, "run-ledger.json");
  const l = JSON.parse(readFileSync(file, "utf8"));
  l.admitted = ["A", "B"];
  l.outcomes = { A: "shipped" };
  l.abort = { status: "aborted-resumable" };
  l.owner.status = "aborted-resumable";
  writeFileSync(file, JSON.stringify(l, null, 2));
  const r = cli(root, ["run", "close", "--run-dir", runDir, "--stop-reason", "sentry-abort", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).undispatched, ["B"]);
  const after = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(after.stop_reason, "sentry-abort");
  assert.equal(after.owner.status, "aborted-resumable");
  assert.equal(Object.hasOwn(after.outcomes, "B"), false);
  const events = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(events.some((e) => e.type === "run-end" && e.data.stop_reason === "sentry-abort"));
});

test("real CLI: the git-only commit is path-limited, so a pre-staged unrelated file stays uncommitted", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-run-close-git-"));
  const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  writeFileSync(join(root, "seed"), "x");
  git("add", "seed");
  git("commit", "-qm", "seed");
  writeFileSync(join(root, "unrelated"), "y");
  git("add", "unrelated");
  const fx = { root, runDir: join(root, ".faff", "runs", RUN_ID) };
  mkdirSync(join(root, ".faff", "anchors", RUN_ID), { recursive: true });
  writeFileSync(join(root, ".faff", "anchors", RUN_ID, "anchor.json"), "{}");
  mkdirSync(fx.runDir, { recursive: true });
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ run_id: RUN_ID, admitted: [], outcomes: {}, owner: { status: "running" } }));
  const deps = { ...fakeDeps(), git: rcl.realDeps().git };
  const r = close(fx, deps, { gitOnly: true });
  assert.equal(r.result.steps.anchor_commit, "ok", JSON.stringify(r.result));
  const committed = git("show", "--name-only", "--format=", "HEAD").stdout.trim().split("\n");
  assert.deepEqual(committed, [join(".faff", "anchors", RUN_ID, "anchor.json")]);
  assert.match(git("diff", "--cached", "--name-only").stdout, /unrelated/);
});
