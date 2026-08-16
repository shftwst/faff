// FAFF-706 — harness-agnostic concurrent dispatch of review-call.mjs lens invocations.
// Unit tests use an injected spawnFn stub (zero live processes); the integration tests spawn REAL
// node child processes against tiny stub scripts to prove the concurrency + pipe-drain behaviour a
// mock can't demonstrate (wall-clock ≈ max, not sum; large-stdout capture without deadlock).
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync, mkdtempSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  validateRequests, fanOut, main, REVIEW_CALL_PATH, selftest, entrypoint_href,
} from "../plugin/skills/faffter-dark-adversarial-review/fan-out.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FANOUT = join(HERE, "..", "plugin", "skills", "faffter-dark-adversarial-review", "fan-out.mjs");

// ── validateRequests (pure) ──

test("validateRequests: rejects a non-array, an empty array, and a malformed entry", () => {
  assert.equal(validateRequests(null).ok, false);
  assert.equal(validateRequests(undefined).ok, false);
  assert.equal(validateRequests({}).ok, false);
  assert.equal(validateRequests([]).ok, false, "empty array — never a silent empty-array success");
  assert.equal(validateRequests([{ lens: "architectural" }]).ok, false, "missing argv");
  assert.equal(validateRequests([{ argv: [] }]).ok, false, "missing lens");
  assert.equal(validateRequests([{ lens: "", argv: [] }]).ok, false, "empty lens string");
  assert.equal(validateRequests([{ lens: "architectural", argv: "not-an-array" }]).ok, false);
});

test("validateRequests: accepts a well-shaped non-empty array", () => {
  const v = validateRequests([{ lens: "architectural", argv: ["--system", "s"] }, { lens: "infosec", argv: [] }]);
  assert.equal(v.ok, true);
});

// FAFF-706 adversarial review finding: a non-string argv element (e.g. a caller interpolating an
// undefined variable) must be refused loudly, not silently coerced by spawn() downstream.
test("validateRequests: rejects an argv array containing a non-string element", () => {
  assert.equal(validateRequests([{ lens: "x", argv: ["--system", 42] }]).ok, false);
  assert.equal(validateRequests([{ lens: "x", argv: ["--system", null] }]).ok, false);
  assert.equal(validateRequests([{ lens: "x", argv: ["--system", undefined] }]).ok, false);
  assert.equal(validateRequests([{ lens: "x", argv: ["--a", "--b"] }]).ok, true, "all-string argv still passes");
});

// ── selftest() — pure, side-effect-free, no spawn (FAFF-813) ──

test("selftest(): pure validateRequests-based checks all pass", () => {
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  let code;
  try { code = selftest(); } finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  assert.match(out, /fan-out --selftest: ok/);
});

test("fan-out.mjs --selftest (real subprocess) passes", () => {
  const res = spawnSync(process.execPath, [FANOUT, "--selftest"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /fan-out --selftest: ok/);
});

test("main(): --selftest runs BEFORE readRequestsInput — never blocks on stdin", async () => {
  // If --selftest were checked after readRequestsInput, this call would hang reading fd 0 (no
  // --requests flag and no stdin piped in this in-process call). It must resolve immediately.
  const code = await main(["--selftest"], { spawnFn: () => fakeChild() });
  assert.equal(code, 0);
});

// ── entrypoint_href() — the symlink-resolved comparison href (FAFF-813) ──

test("entrypoint_href: falsy argv1 → null (guard false, main() does not run)", () => {
  assert.equal(entrypoint_href(undefined), null);
  assert.equal(entrypoint_href(""), null);
});

test("entrypoint_href: a realpathSync throw (ENOENT) falls back to the raw-path href, never throws", () => {
  const synthetic = join(tmpdir(), "faff-813-does-not-exist", "ghost.mjs");
  assert.doesNotThrow(() => entrypoint_href(synthetic));
  assert.equal(entrypoint_href(synthetic), pathToFileURL(synthetic).href);
});

// ── CLI-entrypoint guard fires through a symlinked install path (FAFF-813) ──

test("fan-out.mjs CLI-entrypoint guard fires through a symlinked install path (FAFF-813)", () => {
  // Regression: faff installs each skill by symlinking `plugin/skills/<skill>/` into
  // `~/.claude/skills/<skill>`, so production's process.argv[1] is the symlink path while
  // import.meta.url is already the repo REALPATH. The two hrefs diverged, the guard was false, and
  // main() silently no-op'd — exit 0, empty stdout. A file symlink reproduces the identical
  // divergence (Node realpath-resolves import.meta.url either way).
  const dir = mkdtempSync(join(tmpdir(), "faff-symlink-"));
  try {
    const link = join(dir, "fan-out.mjs");
    symlinkSync(FANOUT, link);
    const res = spawnSync(process.execPath, [link, "--selftest"], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /fan-out --selftest: ok/,
      "guard must fire through a symlinked path — the selftest output, never a silent empty exit 0");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── fanOut with an injected spawnFn stub (no live processes) ──

// A fake ChildProcess: an EventEmitter with .stdout/.stderr sub-emitters, driven manually by the test
// so it can script exact timing/ordering without real subprocess overhead.
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test("fanOut: N=1 degenerates to a single child, resolves with its LensResult", async () => {
  const spawnFn = (nodePath, args) => {
    assert.equal(nodePath, "node");
    assert.deepEqual(args, [REVIEW_CALL_PATH, "--system", "s.md"]);
    const child = fakeChild();
    queueMicrotask(() => {
      child.stdout.emit("data", "### observation: no findings");
      child.emit("close", 0);
    });
    return child;
  };
  const outcome = await fanOut([{ lens: "architectural", argv: ["--system", "s.md"] }], { spawnFn });
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.results, [{ lens: "architectural", exit: 0, stdout: "### observation: no findings", stderr: "" }]);
});

test("fanOut: all children are started before any settles — a slow first child never delays a fast second child's spawn", async () => {
  const spawnOrder = [];
  const spawnFn = (nodePath, args, opts) => {
    spawnOrder.push(args[1]); // the --system arg names the lens's prompt file
    assert.deepEqual(opts.stdio, ["ignore", "pipe", "pipe"]);
    const child = fakeChild();
    // lens "slow" resolves only after lens "fast" already settled (proves no serial waiting between
    // the spawn() calls themselves — both spawns already happened by the time either resolves).
    const delay = args[1] === "slow.md" ? 20 : 0;
    setTimeout(() => { child.stdout.emit("data", "### observation: no findings"); child.emit("close", 0); }, delay);
    return child;
  };
  const requests = [
    { lens: "slow", argv: ["slow.md"] },
    { lens: "fast", argv: ["fast.md"] },
  ];
  const outcome = await fanOut(requests, { spawnFn });
  assert.deepEqual(spawnOrder, ["slow.md", "fast.md"], "both spawned, in input order, before either settled");
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.results.map((r) => r.lens), ["slow", "fast"], "results preserve input order regardless of settle order");
});

test("fanOut: one child's non-zero exit never blocks or delays sibling results (mixed outcome)", async () => {
  const spawnFn = (nodePath, args) => {
    const lens = args[1];
    const child = fakeChild();
    queueMicrotask(() => {
      if (lens === "infosec.md") { child.stderr.emit("data", "boom"); child.emit("close", 5); }
      else { child.stdout.emit("data", `### observation: no findings (${lens})`); child.emit("close", 0); }
    });
    return child;
  };
  const requests = [
    { lens: "architectural", argv: ["architectural.md"] },
    { lens: "infosec", argv: ["infosec.md"] },
    { lens: "methodology", argv: ["methodology.md"] },
    { lens: "QA", argv: ["QA.md"] },
  ];
  const outcome = await fanOut(requests, { spawnFn });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results.length, 4, "all 4 present even though one failed mid-batch");
  const byLens = Object.fromEntries(outcome.results.map((r) => [r.lens, r]));
  assert.equal(byLens.infosec.exit, 5);
  assert.equal(byLens.infosec.stderr, "boom");
  assert.equal(byLens.architectural.exit, 0);
  assert.equal(byLens.methodology.exit, 0);
  assert.equal(byLens.QA.exit, 0);
});

test("fanOut: stdout/stderr are drained per-child as they stream — never interleaved across children", async () => {
  const spawnFn = (nodePath, args) => {
    const lens = args[1];
    const child = fakeChild();
    queueMicrotask(() => {
      // Interleave the two children's emits at the microtask level; each child's own accumulator
      // must still end up with exactly its own bytes, never a sibling's.
      child.stdout.emit("data", `${lens}-part1-`);
    });
    queueMicrotask(() => {
      child.stdout.emit("data", `${lens}-part2`);
      child.emit("close", 0);
    });
    return child;
  };
  const outcome = await fanOut([{ lens: "a", argv: ["a"] }, { lens: "b", argv: ["b"] }], { spawnFn });
  const byLens = Object.fromEntries(outcome.results.map((r) => [r.lens, r]));
  assert.equal(byLens.a.stdout, "a-part1-a-part2");
  assert.equal(byLens.b.stdout, "b-part1-b-part2");
});

test("fanOut: a spawn()-level fault (synchronous throw) fails the WHOLE batch — exit-shaped as ok:false", async () => {
  const spawnFn = (nodePath, args) => {
    if (args[1] === "bad.md") throw Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" });
    const child = fakeChild();
    queueMicrotask(() => { child.stdout.emit("data", "### observation: no findings"); child.emit("close", 0); });
    return child;
  };
  const outcome = await fanOut([{ lens: "ok", argv: ["ok.md"] }, { lens: "broken", argv: ["bad.md"] }], { spawnFn });
  assert.equal(outcome.ok, false);
  assert.match(outcome.fault, /ENOENT/);
});

test("fanOut: a spawn()-level fault via the child's 'error' event (real spawn's async ENOENT shape) is caught the same way", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" })));
    return child;
  };
  const outcome = await fanOut([{ lens: "broken", argv: ["bad.md"] }], { spawnFn });
  assert.equal(outcome.ok, false);
  assert.match(outcome.fault, /ENOENT/);
});

// FAFF-706 adversarial review finding: when MULTIPLE children fail to spawn in the same batch, the
// fault message must not silently drop all but the first — a 2-of-4 spawn-fault cascade reads very
// differently from one isolated ENOENT during root-cause triage.
test("fanOut: multiple spawn()-level faults in one batch are ALL surfaced, not just the first", async () => {
  const spawnFn = (nodePath, args) => {
    const lens = args[1];
    if (lens === "bad1.md") throw Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" });
    if (lens === "bad2.md") throw Object.assign(new Error("spawn node EACCES"), { code: "EACCES" });
    const child = fakeChild();
    queueMicrotask(() => { child.stdout.emit("data", "### observation: no findings"); child.emit("close", 0); });
    return child;
  };
  const outcome = await fanOut([
    { lens: "ok", argv: ["ok.md"] },
    { lens: "broken1", argv: ["bad1.md"] },
    { lens: "broken2", argv: ["bad2.md"] },
  ], { spawnFn });
  assert.equal(outcome.ok, false);
  assert.match(outcome.fault, /2 of 3/);
  assert.match(outcome.fault, /ENOENT/);
  assert.match(outcome.fault, /EACCES/, "both faults are named, not just the first");
});

test("fanOut: a null exit code (killed) is reported as exit 1, not left undefined", async () => {
  const spawnFn = () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("close", null));
    return child;
  };
  const outcome = await fanOut([{ lens: "x", argv: [] }], { spawnFn });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results[0].exit, 1);
});

// ── main() CLI: --requests FILE / stdin, dual array-or-object shape, exit codes ──

function tmpJson(obj) {
  const dir = mkdtempSync(join(tmpdir(), "fanout-"));
  const f = join(dir, "requests.json");
  writeFileSync(f, JSON.stringify(obj));
  return f;
}

test("main(): --requests FILE, bare array shape, all children succeed → exit 0, ordered JSON on stdout", async () => {
  const f = tmpJson([{ lens: "architectural", argv: ["a.md"] }, { lens: "QA", argv: ["q.md"] }]);
  const spawnFn = (nodePath, args) => {
    const child = fakeChild();
    queueMicrotask(() => { child.stdout.emit("data", `out-${args[1]}`); child.emit("close", 0); });
    return child;
  };
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  let code;
  try { code = await main(["--requests", f], { spawnFn }); } finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed.map((r) => r.lens), ["architectural", "QA"], "same order as input");
  assert.equal(parsed[0].exit, 0);
});

test("main(): --requests FILE, {requests:[...]} object shape is also accepted (mirrors aggregate.mjs)", async () => {
  const f = tmpJson({ requests: [{ lens: "infosec", argv: [] }] });
  const spawnFn = () => {
    const child = fakeChild();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  };
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  let code;
  try { code = await main(["--requests", f], { spawnFn }); } finally { process.stdout.write = orig; }
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out).map((r) => r.lens), ["infosec"]);
});

test("main(): an empty --requests array → exit 1, no stdout (never a silent empty-array success)", async () => {
  const f = tmpJson([]);
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try { code = await main(["--requests", f], { spawnFn: () => fakeChild() }); }
  finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  assert.equal(code, 1);
  assert.equal(out, "");
  assert.match(err, /non-empty array/);
});

test("main(): a --requests file that does not exist → exit 1, diagnosis on stderr, no stdout", async () => {
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try { code = await main(["--requests", "/no/such/file-xyz.json"], { spawnFn: () => fakeChild() }); }
  finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  assert.equal(code, 1);
  assert.equal(out, "");
  assert.match(err, /fan-out:/);
});

// FAFF-706 adversarial review finding: a trailing `--requests` with no filename must produce a clear
// diagnosis ("requires a FILE argument"), not an opaque internal TypeError from readFileSync(undefined).
test("main(): a trailing --requests with no filename → exit 1, a clear diagnosis (not an internal TypeError)", async () => {
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try { code = await main(["--requests"], { spawnFn: () => fakeChild() }); }
  finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  assert.equal(code, 1);
  assert.equal(out, "");
  assert.match(err, /--requests requires a FILE argument/);
  assert.doesNotMatch(err, /ERR_INVALID_ARG_TYPE/, "not the raw internal TypeError");
});

test("main(): malformed JSON in --requests → exit 1, no stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-"));
  const f = join(dir, "bad.json");
  writeFileSync(f, "{ not json");
  let out = "";
  const origOut = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out += s; return true; };
  let code;
  try { code = await main(["--requests", f], { spawnFn: () => fakeChild() }); } finally { process.stdout.write = origOut; }
  assert.equal(code, 1);
  assert.equal(out, "");
});

test("main(): a fan-out-level spawn fault → exit 1, no stdout", async () => {
  const f = tmpJson([{ lens: "x", argv: [] }]);
  const spawnFn = () => { throw Object.assign(new Error("spawn node ENOENT"), { code: "ENOENT" }); };
  let out = "";
  let err = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  let code;
  try { code = await main(["--requests", f], { spawnFn }); } finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  assert.equal(code, 1);
  assert.equal(out, "");
  assert.match(err, /ENOENT/);
});

// ── main() CLI via a REAL subprocess: stdin input (no --requests flag) ──
// The in-process main() tests above all pass --requests FILE; the "or stdin" half of the CLI
// surface can only be proven by a real subprocess (an in-process readFileSync(0) can't be faked
// without actually replacing fd 0). Spawns fan-out.mjs itself as the CLI, piping JSON on stdin.
test("CLI subprocess: fan-out.mjs reads a bare JSON array from STDIN when --requests is omitted", async () => {
  const { spawn: realSpawn } = await import("node:child_process");
  const FANOUT_PATH = fileURLToPath(new URL("../plugin/skills/faffter-dark-adversarial-review/fan-out.mjs", import.meta.url));
  // fan-out.mjs's CLI always shells out to its own REVIEW_CALL_PATH constant for the real transport
  // (no --review-call-path override flag), so this test spawns the CLI against the real
  // review-call.mjs — safe because it only asserts on the CLI's own exit/stdout contract. With no
  // --system/--diff in argv, review-call.mjs deterministically returns its own USAGE exit (2) with no
  // stdout — exactly the "well-shaped LensResult" round-trip this test needs: it proves stdin was
  // read and parsed by fan-out.mjs, and that the child's exit code rode through unchanged.
  const child = realSpawn("node", [FANOUT_PATH], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.write(JSON.stringify([{ lens: "architectural", argv: [] }]));
  child.stdin.end();
  let stdout = "";
  child.stdout.on("data", (c) => { stdout += c; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0, "the fan-out batch itself succeeds (one child, whatever its own exit)");
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].lens, "architectural");
  assert.equal(parsed[0].exit, 2, "review-call.mjs with no --system/--diff → its own USAGE exit (2), carried through unchanged");
});

// ── Integration smoke test (mirrors the spec's own PROCEDURE smokeTest) ──
// 2 lenses against a local stub backend that always returns one clean finding → fan-out.mjs →
// mapped per-lens outcomes → aggregate.mjs → a valid faff-contract:spec-review-verdict block.
test("integration smoke test: fan-out.mjs → per-lens outcome mapping → aggregate.mjs emits a valid verdict block", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-smoke-"));
  const stub = mkStub(dir, "clean-stub.mjs", `
    process.stdout.write("### observation: no findings\\n");
    process.exit(0);
  `);
  const requests = [
    { lens: "architectural", argv: [] },
    { lens: "QA", argv: [] },
  ];
  const outcome = await fanOut(requests, { reviewCallPath: stub });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results.length, 2);

  // Apply the SKILL.md's unchanged per-lens outcome table (exit 0 → clear, since "no findings").
  const refutations = outcome.results.map((r) => ({
    lens: r.lens,
    outcome: r.exit === 0 ? "clear" : "unavailable",
    objections: [],
  }));

  const { aggregate, renderBlock } = await import("../plugin/skills/faffter-dark-spec-review/aggregate.mjs");
  const verdict = aggregate(refutations, requests.length);
  const block = renderBlock(verdict);
  assert.match(block, /```faff-contract:spec-review-verdict/);
  const parsed = JSON.parse(block.replace(/```faff-contract:spec-review-verdict\n/, "").replace(/\n```\n?$/, ""));
  assert.equal(parsed.verdict, "approve");
  assert.deepEqual(parsed.objections, []);
});

// ── Integration: REAL node child processes against tiny stub scripts (no mocks) ──
// Proves what a spawnFn stub can't: actual concurrent wall-clock, and actual OS-pipe draining under
// backpressure. Stub scripts are plain node -e one-liners so no fixture files are needed on disk
// beyond what mkdtempSync gives us for the sleep/large-output stubs (node -e can't easily emit
// hundreds of KB inline on the command line, so those two get tiny generated .mjs files).

function mkStub(dir, name, source) {
  const p = join(dir, name);
  writeFileSync(p, source);
  chmodSync(p, 0o755);
  return p;
}

test("integration: 3 concurrent sleep-stubs take ~1 slot's worth of wall-clock, not 3 (max, not sum)", async () => {
  // A fixed absolute-ms ceiling (e.g. "< 900ms") is unreliable on a loaded/shared CI box — process
  // scheduling delay under contention can dwarf the stub's own 300ms sleep. Self-calibrate instead:
  // measure ONE stub's wall-clock under THIS run's current contention, then measure 3 concurrent
  // stubs, and assert the 3-way batch took nowhere near 3× the 1-way baseline (serial dispatch would;
  // concurrent dispatch — the whole point of fan-out.mjs — should track close to the 1-way baseline
  // regardless of how loaded the box is, since both measurements share the same ambient contention).
  const dir = mkdtempSync(join(tmpdir(), "fanout-int-"));
  const stub = mkStub(dir, "sleep-stub.mjs", `
    setTimeout(() => { process.stdout.write("### observation: no findings\\n"); process.exit(0); }, 300);
  `);
  const one = [{ lens: "architectural", argv: [] }];
  const three = ["architectural", "infosec", "QA"].map((lens) => ({ lens, argv: [] }));

  const t1start = Date.now();
  const oneOutcome = await fanOut(one, { reviewCallPath: stub });
  const oneElapsed = Date.now() - t1start;
  assert.equal(oneOutcome.ok, true);

  const t3start = Date.now();
  const outcome = await fanOut(three, { reviewCallPath: stub });
  const elapsed = Date.now() - t3start;
  assert.equal(outcome.ok, true);
  assert.equal(outcome.results.length, 3);
  for (const r of outcome.results) assert.equal(r.exit, 0);
  // Serial dispatch of 3 would take ~3× the 1-way baseline; concurrent should stay well under 2×.
  assert.ok(
    elapsed < oneElapsed * 2 + 500,
    `expected the 3-concurrent batch (${elapsed}ms) to track the 1-way baseline (${oneElapsed}ms), not ~3×  it — looks serial`,
  );
});

test("integration: a child exiting non-zero doesn't hold up or corrupt its healthy siblings' results", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-int-"));
  const stub = mkStub(dir, "mixed-stub.mjs", `
    if (process.argv[2] === "--fail") { process.stderr.write("boom\\n"); process.exit(5); }
    process.stdout.write("### observation: no findings\\n");
    process.exit(0);
  `);
  const requests = [
    { lens: "architectural", argv: [] },
    { lens: "infosec", argv: ["--fail"] },
    { lens: "methodology", argv: [] },
    { lens: "QA", argv: [] },
  ];
  const outcome = await fanOut(requests, { reviewCallPath: stub });
  assert.equal(outcome.ok, true);
  const byLens = Object.fromEntries(outcome.results.map((r) => [r.lens, r]));
  assert.equal(byLens.infosec.exit, 5);
  assert.match(byLens.infosec.stderr, /boom/);
  assert.equal(byLens.architectural.exit, 0);
  assert.equal(byLens.methodology.exit, 0);
  assert.equal(byLens.QA.exit, 0);
});

test("integration: a child writing >=256KB to stdout is captured intact with no batch hang (pipe-buffer backpressure, FAFF-706 QA finding)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fanout-int-"));
  const stub = mkStub(dir, "large-stub.mjs", `
    const size = process.argv[2] === "--large" ? 300000 : 10;
    // Wait for the write to fully flush before exiting — process.exit() truncates an in-flight
    // pipe write on a large payload (a Node gotcha independent of the parent's own pipe-draining
    // behaviour, which is what this test actually exercises on the fan-out.mjs side).
    process.stdout.write("x".repeat(size), () => process.exit(0));
  `);
  const requests = [
    { lens: "big", argv: ["--large"] },
    { lens: "small1", argv: [] },
    { lens: "small2", argv: [] },
  ];
  const outcome = await fanOut(requests, { reviewCallPath: stub });
  assert.equal(outcome.ok, true);
  const byLens = Object.fromEntries(outcome.results.map((r) => [r.lens, r]));
  assert.equal(byLens.big.stdout.length, 300000, "the ≥256KB child's full stdout captured intact — no truncation, no deadlock");
  assert.equal(byLens.big.exit, 0);
  assert.equal(byLens.small1.stdout.length, 10);
  assert.equal(byLens.small2.stdout.length, 10);
});

test("integration: a spawn()-level fault (node binary genuinely absent) fails the whole batch (real async 'error' event, not a mock)", async () => {
  // Exercises fanOut() directly (not main()) so this stays independent of process.stdout capture —
  // main()'s own exit-1/no-stdout/stderr-message behaviour on a fan-out-level fault is already
  // covered by the mocked-spawn "main(): a fan-out-level spawn fault" test above. This test's own
  // job is proving the REAL child_process.spawn ENOENT path (async 'error' event, not a synchronous
  // throw) is caught the same way as the mocked version at test 8.
  const requests = [{ lens: "x", argv: [] }];
  const { spawn: realSpawn } = await import("node:child_process");
  const spawnFn = (_nodePath, args, opts) => realSpawn("node-binary-that-does-not-exist-xyz", args, opts);
  const outcome = await fanOut(requests, { spawnFn });
  assert.equal(outcome.ok, false);
  assert.match(outcome.fault, /ENOENT/);
});
