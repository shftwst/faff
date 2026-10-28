// ===========================================================================
// === region:factory — gates-exec — rung execution: one spawn, a sharded rung, or a per-file pool (runRung) ===
// Split out of gates.js (FAFF-1390), which re-exports every name it exported before.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");
const { readGatesConfig } = require("./gates-config");

// FAFF-981: spawnSync's default maxBuffer (1 MB) is far below what a noisy-but-passing rung (the
// UNIT rung's node --test TAP stream, easily several MB) can emit. A finite ceiling well above any
// real rung's output bounds worst-case per-rung memory (spawnSync applies maxBuffer per stream, so
// stdout and stderr are each capped at this value independently — worst case ~2x this constant)
// while stopping legitimate rungs from overflowing into a false `errored` classification. See the
// ENOBUFS branch in runRung below.
const MAX_RUNG_STDOUT_BYTES = 64 * 1024 * 1024; // 64 MiB per stream

// Execution target = the worktree sandbox (cwd) — the single FAFF-12 seam (Q1 interim default).
// Runs the rung's command and classifies pass/fail/errored. A 127 (command-not-found) is `errored`
// (tool missing) not `fail` — we can't conclude the code is bad.
// FAFF-984: the spawnSync `timeout` is resolved from gates.rung_timeout_ms (default 30 min, was a
// hardcoded 600s) so a slow-but-green whole-suite rung isn't killed prematurely. A timeout kill is
// detected BEFORE the general res.error/127 branch (mirrors classifySentryConsult in
// sentrycheck.js) and tagged with an internal `reason: "timed-out"` + a timeout-shaped `detail` —
// still `status: "errored"` at the faff-contract:quality-gates boundary (the enum stays closed),
// but now diagnosable as "could not conclude" rather than indistinguishable from a genuine crash.
// FAFF-981: a rung whose stdout/stderr exceeds MAX_RUNG_STDOUT_BYTES is also killed by Node (ENOBUFS,
// res.status === null) before it can exit, so it too is peeled off BEFORE the general res.error/127
// branch — same shape as the ETIMEDOUT check above, and orthogonal to it (ENOBUFS vs ETIMEDOUT key
// off distinct res.error.code values; neither branch's ordering affects the other).
// The shared classification core — given a completed child's {error, status, signal, stdout,
// stderr} shape (spawnSync's own res object, or the equivalent object spawnAsync below resolves
// to for a single async shard), applies the SAME fail-safe rules the pre-FAFF-1002 runRung always
// applied: timeout BEFORE the general error branch (ETIMEDOUT, or a bare signal with no res.error
// — no caller sets its own killSignal, so a bare signal is our own timeout kill), then ENOBUFS
// overflow, then tool-missing/127/exit-status. Factored out so the non-sharded path (run_single)
// and each individual shard (runShardedRung) classify identically — one rule set, never a forked
// copy that could drift.
function classifyRungResult(rung, res, duration_ms, rung_timeout_ms) {
  const tail = ((res.stderr || "") + (res.stdout || "")).slice(-500);
  const timedOut = (res.error && res.error.code === "ETIMEDOUT") || (res.signal && !res.error);
  if (timedOut) {
    return {
      kind: rung.kind, name: rung.name, command: rung.command, status: "errored", reason: "timed-out",
      duration_ms, detail: `timed out after ${duration_ms}ms (limit ${rung_timeout_ms}ms); ${tail}`,
    };
  }
  // FAFF-981: buffer overflow — Node kills the child before it exits, so res.status is null and
  // there is no exit status left to classify on. Still `errored` (we genuinely cannot conclude
  // pass/fail), but distinguished from a generic spawn error/127 by a dedicated detail message so a
  // human reviewing the park sees "output overflow", not a misleading command tail.
  const overflow = res.error && res.error.code === "ENOBUFS";
  if (overflow) {
    return {
      kind: rung.kind, name: rung.name, command: rung.command, status: "errored", reason: "stdout-overflow",
      duration_ms, detail: `rung output (stdout or stderr) exceeded the ${MAX_RUNG_STDOUT_BYTES / (1024 * 1024)} MiB per-stream ceiling; cannot classify on exit status\n${tail}`,
    };
  }
  let status;
  if (res.error || res.status === 127) status = "errored";       // tool missing / spawn error
  else if (res.status === 0) status = "pass";
  else status = "fail";
  return { kind: rung.kind, name: rung.name, command: rung.command, status, duration_ms, detail: tail };
}

function rungCwd(rung, root) {
  return rung.cwd ? path.join(root, rung.cwd) : root;
}

// Today's exact single-process path (byte-identical to the pre-FAFF-1002 runRung) — the fallback
// for a non-shard-capable command and for local_shards<=1 hosts.
function runSingleSpawnSync(rung, root, rung_timeout_ms) {
  const started = Date.now();
  let res;
  try {
    res = spawnSync(rung.command, { cwd: rungCwd(rung, root), shell: true, encoding: "utf8", timeout: rung_timeout_ms, maxBuffer: MAX_RUNG_STDOUT_BYTES });
  } catch (e) {
    return { kind: rung.kind, name: rung.name, command: rung.command, status: "errored", duration_ms: Date.now() - started, detail: String(e && e.message || e).slice(-500) };
  }
  const duration_ms = Date.now() - started;
  return classifyRungResult(rung, res, duration_ms, rung_timeout_ms);
}

// FAFF-1002: a Node test invocation (`node … --test`) carrying NO existing `--test-shard` token and no explicit test path —
// the only command class Node can partition with `--test-shard=<i>/<N>`. Deterministic from the
// command string alone (tokenised on whitespace) — no timing measurement, no size heuristic. A
// command already carrying `--test-shard` (defensive — normaliseLocalRungCommand already strips it
// for the LOCAL rung upstream) or lacking a bare `node`/`--test` token is never shard-capable.
function shardCapable(command) {
  const tokens = String(command).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  const hasNode = tokens.some((t) => t === "node" || /(?:^|[\\/])node$/.test(t));
  if (!hasNode) return false;
  if (!tokens.includes("--test")) return false;
  if (tokens.some((t) => t.startsWith("--test-shard"))) return false;
  // FAFF-1356: the pool appends `--test-shard=i/n` to the command; node treats anything after an
  // explicit test path as a script argument, so every shard would run the same files in full.
  const afterTest = tokens.slice(tokens.indexOf("--test") + 1);
  if (afterTest.some((t) => !t.startsWith("-"))) return false;
  return true;
}

// FAFF-1002: async single-child spawn used ONLY by the shard-concurrent path — collects stdout ⁄
// stderr up to maxBufferBytes PER STREAM (killing the child past the ceiling, mirroring spawnSync's
// own maxBuffer/ENOBUFS behaviour), and enforces timeoutMs by killing the child and tagging the
// result exactly like spawnSync's own timeout does. Resolves to the SAME {error, status, signal,
// stdout, stderr} shape classifyRungResult already consumes — one classifier, two producers.
function spawnAsync(command, { cwd, timeoutMs, maxBufferBytes, cutHandle }) {
  return new Promise((resolve) => {
    let child;
    try {
      // `detached: true` makes the spawned shell the leader of its OWN process group (POSIX),
      // rather than sharing this process's group — the prerequisite for the group-kill below.
      // Required because `shell: true` spawns an intermediate `/bin/sh -c …`: for a command with
      // shell metacharacters (a pipe, `node -e "…"`), the shell forks real work as a CHILD of
      // itself rather than exec-replacing itself, so signalling the shell's own pid alone can
      // leave that grandchild (e.g. a slow `node --test` run) alive well past the deadline.
      // Strip NODE_TEST_CONTEXT — Node's OWN test runner sets this in its process env (observed:
      // "child-v8") when it is itself running under `node --test`; inherited by a spawned shard
      // child it makes a nested `node --test` invocation believe it is a worker of that OUTER
      // runner (expecting its private IPC/serialisation protocol) rather than a standalone run,
      // which silently short-circuits it. This matters beyond this repo's own test suite: ANY
      // caller of `faff gates run`/`runRung` from inside a `node --test` process (an integration
      // test that shells the CLI, for instance) would otherwise leak this into every real shard.
      const shardEnv = { ...process.env };
      delete shardEnv.NODE_TEST_CONTEXT;
      child = spawn(command, { cwd, shell: true, detached: true, env: shardEnv });
    } catch (e) {
      resolve({ error: e, status: null, signal: null, stdout: "", stderr: "" });
      return;
    }
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timer = null;
    let overflowed = false;
    let timedOut = false;

    // Kill the WHOLE process group (negative pid), not just the shell — see the detached comment
    // above. Falls back to a direct child.kill on any failure (e.g. pid unresolved, or a platform
    // where process groups behave differently) so a kill attempt is never silently dropped.
    const killGroup = (signal) => {
      try {
        if (typeof child.pid === "number") { process.kill(-child.pid, signal); return; }
      } catch { /* fall through to the direct kill below */ }
      try { child.kill(signal); } catch { /* best-effort — the close/error handlers still settle */ }
    };

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => { timedOut = true; killGroup("SIGTERM"); }, timeoutMs);
    }
    // FAFF-1405: a budgeted gate run can cut a unit. The caller's stop signal is the only source of
    // a cut, so a cut is never mistaken for the rung timeout and never classified as a result.
    let cutRequested = false;
    if (cutHandle) cutHandle.cut = () => { if (!settled && !cutRequested) { cutRequested = true; killGroup("SIGTERM"); } };

    const onChunk = (isStdout) => (chunk) => {
      const len = chunk.length;
      if (isStdout) { stdoutBytes += len; stdout = (stdout + chunk.toString("utf8")).slice(-2000); }
      else { stderrBytes += len; stderr = (stderr + chunk.toString("utf8")).slice(-2000); }
      if (!overflowed && (stdoutBytes > maxBufferBytes || stderrBytes > maxBufferBytes)) {
        overflowed = true;
        killGroup("SIGTERM");
      }
    };
    if (child.stdout) child.stdout.on("data", onChunk(true));
    if (child.stderr) child.stderr.on("data", onChunk(false));
    child.on("error", (err) => settle({ error: err, status: null, signal: null, stdout, stderr }));
    child.on("close", (code, signal) => {
      if (cutRequested) settle({ cut: true, error: null, status: null, signal, stdout, stderr });
      else if (overflowed) settle({ error: { code: "ENOBUFS" }, status: null, signal, stdout, stderr });
      else if (timedOut) settle({ error: { code: "ETIMEDOUT" }, status: null, signal, stdout, stderr });
      else settle({ error: null, status: code, signal, stdout, stderr });
    });
  });
}

// FAFF-1002: worst-wins aggregation — errored > fail > pass (errored is least-conclusive, so it is
// never masked by a sibling shard's clean fail; a fail is never masked by a passing sibling). The
// carried `reason` (if any) is the FIRST errored shard's own reason, in shard-index order.
function aggregateShardResults(rung, shardResults, n, wall_ms) {
  let status = "pass";
  let reason;
  const firstErrored = shardResults.find((r) => r.status === "errored");
  if (firstErrored) {
    status = "errored";
    reason = firstErrored.reason;
  } else if (shardResults.some((r) => r.status === "fail")) {
    status = "fail";
  }
  const nonPass = shardResults.filter((r) => r.status !== "pass");
  let detail;
  if (!nonPass.length) {
    detail = `all ${n} shards passed`;
  } else {
    const totalBudget = 500;
    const perShardBudget = Math.max(20, Math.floor(totalBudget / nonPass.length));
    detail = nonPass.map((r) => `shard ${r.index}/${n}: ${String(r.detail || "").slice(-perShardBudget)}`).join(" | ").slice(-totalBudget);
  }
  const out = { kind: rung.kind, name: rung.name, command: rung.command, status, duration_ms: wall_ms, detail };
  if (status === "errored" && reason) out.reason = reason;
  return out;
}

// FAFF-1002: run a shard-capable rung as N `--test-shard=<i>/<n>` children, then fold the per-shard
// results into one aggregate RungResult whose duration_ms is the WALL-CLOCK of the whole batch
// (≈ the slowest shard), not the sum. `command` on the returned result stays the LOGICAL unsharded
// command — callers never see the per-shard `--test-shard=` forms.
//
// FAFF-1137: the fan-out is a bounded worker pool, not an unbounded Promise.all. `concurrency` caps
// how many shards run at once so a resource-heavy shard can't oversubscribe the box and starve its
// siblings into a spurious RED; runRung passes gates.local_shard_concurrency (default a quarter of the
// shard count). An absent/non-numeric/<1 `concurrency` (an external caller omitting the new
// param) means n → a single wave, byte-identical to the pre-pool Promise.all path. Results are
// COLLECTED KEYED BY SHARD INDEX and folded in index order: aggregateShardResults reports the
// first-errored shard's reason in index order, so a completion-order fold would silently change
// which reason surfaces. Every one of the N shards is awaited before folding, so a later-wave
// shard's RED is never dropped.
async function runShardedRung(rung, root, rung_timeout_ms, n, concurrency) {
  const started = Date.now();
  const poolSize = Math.min((Number.isFinite(concurrency) && concurrency >= 1) ? Math.floor(concurrency) : n, n);
  const shardResults = new Array(n);
  let nextSlot = 0;
  const worker = async () => {
    for (;;) {
      const slot = nextSlot++;
      if (slot >= n) return;
      const i = slot + 1;
      const shardStarted = Date.now();
      const res = await spawnAsync(`${rung.command} --test-shard=${i}/${n}`, { cwd: rungCwd(rung, root), timeoutMs: rung_timeout_ms, maxBufferBytes: MAX_RUNG_STDOUT_BYTES });
      shardResults[slot] = { index: i, ...classifyRungResult(rung, res, Date.now() - shardStarted, rung_timeout_ms) };
    }
  };
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return aggregateShardResults(rung, shardResults, n, Date.now() - started);
}

// FAFF-1382: a glob with `**`, `*` and `?` over posix-relative paths. Node 20 (the adopter floor)
// has no fs.globSync, so the pool enumerates its own files.
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// FAFF-1382: the files under `cwd` matching `glob`, as sorted posix-relative paths. Walks from the
// glob's literal prefix and never descends into node_modules or a dot-directory, which is where
// Node's own default discovery picks up gitignored scratch copies such as .faff/spec-review/*/.
function listTestFiles(cwd, glob) {
  const re = globToRegExp(glob);
  const literal = glob.split("/").slice(0, -1);
  const stop = literal.findIndex((seg) => /[*?]/.test(seg));
  const base = (stop === -1 ? literal : literal.slice(0, stop)).join("/");
  const out = [];
  const walk = (rel) => {
    let entries;
    try { entries = fs.readdirSync(path.join(cwd, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== "node_modules" && !e.name.startsWith(".")) walk(r); }
      else if (e.isFile() && re.test(r)) out.push(r);
    }
  };
  walk(base);
  return out.sort();
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

// FAFF-1382: worst-wins over per-file results, the same precedence as aggregateShardResults
// (errored > fail > pass, first errored reason in run order), with the detail naming files.
function aggregateFileResults(rung, fileResults, counts, wall_ms) {
  let status = "pass";
  let reason;
  const firstErrored = fileResults.find((r) => r.status === "errored");
  if (firstErrored) { status = "errored"; reason = firstErrored.reason; }
  else if (fileResults.some((r) => r.status === "fail")) status = "fail";
  const nonPass = fileResults.filter((r) => r.status !== "pass");
  let detail;
  if (!nonPass.length) {
    detail = `all ${fileResults.length} files passed (${counts.pooled} pooled, ${counts.serial} serial)`;
  } else {
    // The tail budget is per file and the names are never cut, so every failing file is named.
    const perFileBudget = Math.max(20, Math.floor(500 / nonPass.length));
    detail = nonPass.map((r) => `${r.file}: ${String(r.detail || "").slice(-perFileBudget)}`).join(" | ");
  }
  const out = { kind: rung.kind, name: rung.name, command: rung.command, status, duration_ms: wall_ms, detail };
  if (status === "errored" && reason) out.reason = reason;
  return out;
}

// FAFF-1382: the gate-owned file pool. Every file matching `glob` runs as its own
// `<command> <file>` process, `concurrency` at a time; files matching a `serial` entry then run one
// at a time with nothing else running. Pooled files start largest first, a cheap stand-in for
// longest first, so a long file does not start last and set the wall-clock alone. An empty match
// is errored (no-test-files), never a vacuous pass. Results fold in run order (pooled in start
// order, then serial), so the reported first error does not depend on completion order.
async function runFilePoolRung(rung, root, rung_timeout_ms, { glob, serial = [], concurrency }) {
  const started = Date.now();
  const cwd = rungCwd(rung, root);
  const files = listTestFiles(cwd, glob);
  if (!files.length) {
    return { kind: rung.kind, name: rung.name, command: rung.command, status: "errored", reason: "no-test-files", duration_ms: Date.now() - started, detail: `gates.local_test_files '${glob}' matched no files under ${cwd}` };
  }
  const serialRes = serial.map(globToRegExp);
  const isSerial = (f) => serialRes.some((re) => re.test(f));
  const size = (f) => { try { return fs.statSync(path.join(cwd, f)).size; } catch { return 0; } };
  const pooled = files.filter((f) => !isSerial(f)).map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f);
  const serialFiles = files.filter(isSerial);
  const runOne = async (f) => {
    const t = Date.now();
    const res = await spawnAsync(`${rung.command} ${shellQuote(f)}`, { cwd, timeoutMs: rung_timeout_ms, maxBufferBytes: MAX_RUNG_STDOUT_BYTES });
    return { file: f, ...classifyRungResult(rung, res, Date.now() - t, rung_timeout_ms) };
  };
  const pooledResults = new Array(pooled.length);
  const width = Math.min((Number.isFinite(concurrency) && concurrency >= 1) ? Math.floor(concurrency) : 1, Math.max(1, pooled.length));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const slot = next++;
      if (slot >= pooled.length) return;
      pooledResults[slot] = await runOne(pooled[slot]);
    }
  };
  await Promise.all(Array.from({ length: width }, () => worker()));
  const serialResults = [];
  for (const f of serialFiles) serialResults.push(await runOne(f));
  return aggregateFileResults(rung, [...pooledResults, ...serialResults], { pooled: pooled.length, serial: serialFiles.length }, Date.now() - started);
}

// FAFF-1002: runRung is shard-aware — shard-capable commands (the local UNIT rung, once
// normaliseLocalRungCommand's stripped CI shard is re-derived HERE, sized to this host) run as N
// bounded-parallel shards so a >600s whole-suite process fits a foreground turn; every other rung
// (lint/static/type, or a UNIT rung with no `--test` token) runs the unchanged single-spawnSync
// path, byte-identical to before this ticket. Both existing callers (runLadder in gates-select.js, and
// post-merge.js's verifyPostMerge) inherit this with no change to their own calling logic — an
// async runRung is simply awaited.
// FAFF-1405: the units a rung runs as, in the order runRung would run them. A unit is one process:
// the whole rung, one file of the file pool (pooled files largest first, then the serial files), or
// one shard. The same branch order as runRung, so a budgeted run splits a rung exactly as an
// unbudgeted run executes it.
function listRungUnits(rung, root, cfg) {
  const { local_shards, local_test_files, serial_tests } = cfg;
  const whole = { mode: "whole", units: [{ id: "whole", command: rung.command }] };
  if (!shardCapable(rung.command)) return whole;
  if (local_test_files) {
    const cwd = rungCwd(rung, root);
    const files = listTestFiles(cwd, local_test_files);
    if (!files.length) return { mode: "whole", units: [{ id: "whole", command: rung.command, noFiles: `gates.local_test_files '${local_test_files}' matched no files under ${cwd}` }] };
    const serialRes = serial_tests.map(globToRegExp);
    const isSerial = (f) => serialRes.some((re) => re.test(f));
    const size = (f) => { try { return fs.statSync(path.join(cwd, f)).size; } catch { return 0; } };
    const pooled = files.filter((f) => !isSerial(f)).map((f) => [f, size(f)]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([f]) => f);
    const units = [
      ...pooled.map((f) => ({ id: `file:${f}`, file: f, command: `${rung.command} ${shellQuote(f)}`, serial: false })),
      ...files.filter(isSerial).map((f) => ({ id: `file:${f}`, file: f, command: `${rung.command} ${shellQuote(f)}`, serial: true })),
    ];
    return { mode: "pool", units };
  }
  const n = local_shards;
  if (!(n > 1)) return whole;
  return { mode: "shard", units: Array.from({ length: n }, (_, i) => ({ id: `shard:${i + 1}/${n}`, index: i + 1, command: `${rung.command} --test-shard=${i + 1}/${n}` })) };
}

// Run one unit asynchronously so it can be cut. Resolves { cut: true } when cut, else a classified
// result carrying the unit's file or shard index for the rung aggregators.
async function runUnit(rung, unit, root, rung_timeout_ms, cutHandle) {
  if (unit.noFiles) return { kind: rung.kind, name: rung.name, command: rung.command, status: "errored", reason: "no-test-files", duration_ms: 0, detail: unit.noFiles };
  const started = Date.now();
  const res = await spawnAsync(unit.command, { cwd: rungCwd(rung, root), timeoutMs: rung_timeout_ms, maxBufferBytes: MAX_RUNG_STDOUT_BYTES, cutHandle });
  if (res.cut) return { cut: true, duration_ms: Date.now() - started };
  const r = classifyRungResult(rung, res, Date.now() - started, rung_timeout_ms);
  if (unit.file) r.file = unit.file;
  if (unit.index) r.index = unit.index;
  return r;
}

// Fold a rung's unit results (in unit order) back into one rung result, exactly as the unbudgeted
// executor does for the same mode.
function aggregateUnits(rung, mode, units, results, wall_ms) {
  if (mode === "pool") {
    const serial = units.filter((u) => u.serial).length;
    return aggregateFileResults(rung, results, { pooled: units.length - serial, serial }, wall_ms);
  }
  if (mode === "shard") return aggregateShardResults(rung, results, results.length, wall_ms);
  const r = results[0];
  const out = { kind: rung.kind, name: rung.name, command: rung.command, status: r.status, duration_ms: wall_ms, detail: r.detail };
  if (r.reason) out.reason = r.reason;
  return out;
}

async function runRung(rung, root) {
  const { rung_timeout_ms, local_shards, local_shard_concurrency, local_test_files, serial_tests, file_pool_concurrency } = readGatesConfig(root);
  if (!shardCapable(rung.command)) return runSingleSpawnSync(rung, root, rung_timeout_ms);
  if (local_test_files) return runFilePoolRung(rung, root, rung_timeout_ms, { glob: local_test_files, serial: serial_tests, concurrency: file_pool_concurrency });
  const n = local_shards;
  if (!(n > 1)) return runSingleSpawnSync(rung, root, rung_timeout_ms);   // 1-core host: no benefit
  return runShardedRung(rung, root, rung_timeout_ms, n, local_shard_concurrency);
}

module.exports = { MAX_RUNG_STDOUT_BYTES, aggregateFileResults, aggregateUnits, listRungUnits, runUnit, aggregateShardResults, classifyRungResult, globToRegExp, listTestFiles, runFilePoolRung, runRung, runShardedRung, runSingleSpawnSync, rungCwd, shardCapable, spawnAsync };
