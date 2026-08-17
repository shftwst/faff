#!/usr/bin/env node
// FAFF-706 — harness-agnostic concurrent dispatch of review-call.mjs lens invocations.
//
// Under Claude Code, issuing N Bash calls in one message happens to run them concurrently — a
// harness feature, not something faff asked for by name. Under a non-Claude harness (e.g. Codex)
// there is no such free batching, so the same "one review-call.mjs invocation per lens" prose runs
// the N subprocesses one after another — and each is a full adversarial-review call (preflight,
// streaming, fallback chain), so a four-lens pass can stall over an hour. This script moves the
// concurrency out of the harness and into faff's own code: it spawns the N review-call.mjs children
// itself and awaits them together, so any harness capable of running one shell command gets the
// same speed-up. Reuses review-call.mjs verbatim (spawned as an unmodified child process) — never
// forks it. The per-lens outcome mapping and aggregation stay entirely out of this file (see the
// anti-pattern note below); this is a pure transport concern: spawn, collect, return.
//
// Zero-dependency: node stdlib only (node:child_process, node:fs, node:path, node:url).
// Pure functions (validateRequests) carry no I/O and are unit-tested directly; runOne/fanOut take an
// injectable spawn function (mirrors review-call.mjs's getFn/streamFn injection) so unit tests spawn
// nothing unless they opt in; the CLI defaults to the real node:child_process.spawn.

import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join as pathJoin } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// The shared transport this ticket fans out — spawned unmodified, per-lens, concurrently. Resolved
// relative to this file so the CLI works regardless of the caller's cwd.
export const REVIEW_CALL_PATH = pathJoin(HERE, "review-call.mjs");

// PURE: is `requests` a non-empty array of well-shaped LensRequest entries ({lens: string, argv:
// string[]})? Mirrors aggregate.mjs's "refuses to vote on an absent or inconsistent set" discipline —
// fan-out never silently produces fewer than N results, so a malformed/empty input is refused up
// front rather than partially processed.
export function validateRequests(requests) {
  if (!Array.isArray(requests) || requests.length === 0) {
    return { ok: false, reason: "requests must be a non-empty array of {lens, argv}" };
  }
  for (const r of requests) {
    if (!r || typeof r.lens !== "string" || !r.lens || !Array.isArray(r.argv)) {
      return { ok: false, reason: "each request must be {lens: string, argv: string[]}" };
    }
    // FAFF-706 adversarial review: a non-string argv element (e.g. an undefined interpolated into
    // the caller's argv assembly, coerced to "undefined") would otherwise pass silently — spawn()
    // itself coerces non-strings to strings, masking a caller bug rather than refusing loudly.
    if (!r.argv.every((a) => typeof a === "string")) {
      return { ok: false, reason: "each request's argv must be an array of strings" };
    }
  }
  return { ok: true };
}

// Spawn ONE lens request as a child (node reviewCallPath ...argv), draining stdout/stderr AS THEY
// STREAM (data-event accumulation) — never a post-exit bulk read. This streaming drain is
// load-bearing, not stylistic: with N children spawned stdio:[_, "pipe", "pipe"], a child whose
// output exceeds the OS pipe buffer (~64KB on Linux) blocks on write and never exits if the parent
// isn't draining that pipe — deadlocking the whole Promise.allSettled batch and silently
// reintroducing the exact >1h stall this file exists to remove. Adversarial-review refutations are
// genuinely multi-KB, so this is a live path, not theoretical.
//
// Resolves — NEVER rejects — on a normal child exit, even a non-zero one: a lens outcome (mapped by
// the caller's existing per-lens outcome table), not a fan-out fault. REJECTS only on a spawn()-level
// fault (e.g. ENOENT — node not found), surfaced via the child's 'error' event (the real
// child_process.spawn does not throw synchronously for ENOENT); a synchronous throw from an injected
// test spawnFn is also caught and treated the same way, so both shapes of "spawn failed before the
// child started" are handled identically.
function runOne(request, { spawnFn, nodePath, reviewCallPath }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(nodePath, [reviewCallPath, ...request.argv], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      reject(e);
      return;
    }
    let stdout = "";
    let stderr = "";
    // FAFF-706 adversarial review: `error` and `close` are not mutually exclusive on every platform
    // (a pipe-teardown fault can fire `error` after a normal `close` already resolved, or vice
    // versa) — `settled` is the single source of truth for "has this child's promise already
    // settled", so whichever event fires FIRST wins and every later event on this child is a no-op.
    // This is the only thing standing between a documented single-settle promise and a
    // silently-ignored second `resolve`/`reject` call (which Node's Promise itself already no-ops,
    // but relying on that implicitly rather than checking `settled` explicitly would leave the
    // invariant undocumented for the next reader).
    let settled = false;
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ lens: request.lens, exit: code == null ? 1 : code, stdout, stderr });
    });
  });
}

// Fan every request out as its own child, starting ALL of them before awaiting ANY of them (the
// `requests.map` below issues every spawn synchronously in one pass), then wait for all of them
// TOGETHER via Promise.allSettled — turning what was N sequential full-length calls into one batch
// bounded by the slowest single call. One lens's non-zero exit never delays or blocks sibling lenses'
// results (Promise.allSettled never cancels or blocks the others on one settling).
//
// Returns { ok: true, results: LensResult[] } (same order as `requests`) on a clean fan-out, or
// { ok: false, fault: string } when ANY child's spawn() itself faulted (distinct from a child that
// started and exited non-zero) — a fan-out-level fault fails the WHOLE batch, the same fail-loud
// posture aggregate.mjs already takes on an inconsistent input rather than silently returning fewer
// results than requested.
export async function fanOut(requests, { spawnFn = spawn, nodePath = "node", reviewCallPath = REVIEW_CALL_PATH } = {}) {
  const promises = requests.map((r) => runOne(r, { spawnFn, nodePath, reviewCallPath }));
  const settled = await Promise.allSettled(promises);
  const rejections = settled.filter((s) => s.status === "rejected");
  if (rejections.length > 0) {
    // FAFF-706 adversarial review: surface EVERY rejection, not just the first — a batch where two
    // children both fail to spawn (a resource-exhaustion cascade) reads very differently from one
    // isolated ENOENT, and the downstream "treat the whole batch as unavailable" handling is
    // unaffected either way (still ok:false), so this only improves diagnosability.
    const messages = rejections.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
    const fault = rejections.length === 1
      ? messages[0]
      : `${rejections.length} of ${requests.length} children failed to spawn — first: ${messages[0]}; all: ${messages.join(" | ")}`;
    return { ok: false, fault };
  }
  return { ok: true, results: settled.map((s) => s.value) };
}

// ---- CLI ------------------------------------------------------------------
// Input (stdin or --requests FILE) is JSON: either a bare array of LensRequest, or an object
// { requests: [...] } — mirrors aggregate.mjs's dual-mode CLI shape.
function readRequestsInput(argv) {
  const fi = argv.indexOf("--requests");
  // FAFF-706 adversarial review: a trailing `--requests` with no filename (fi is the last index)
  // would otherwise reach readFileSync(undefined) and surface an unhelpful internal TypeError —
  // catch it here with a message that actually names the mistake.
  if (fi !== -1 && fi + 1 >= argv.length) {
    throw new Error("--requests requires a FILE argument");
  }
  const raw = fi !== -1 ? readFileSync(argv[fi + 1], "utf8") : readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.requests)) return parsed.requests;
  return parsed; // let validateRequests reject a non-array/non-{requests:[]} shape uniformly
}

// FAFF-813: a pure, side-effect-free selftest over validateRequests — no spawn, no I/O — mirroring
// aggregate.mjs's `--selftest`. Gives fan-out.mjs the same invocation affordance for the
// symlink-invocation regression test (the alternative, exercising fanOut() with an injected spawnFn,
// would need EventEmitter imported into this production file just to fabricate a fake child).
export function selftest() {
  const fails = [];
  const check = (name, cond) => { if (!cond) fails.push(name); };
  check("known-good request → ok", validateRequests([{ lens: "architectural", argv: [] }]).ok === true);
  check("empty array → refused", validateRequests([]).ok === false);
  check("non-array → refused", validateRequests(null).ok === false);
  check("non-string argv element → refused", validateRequests([{ lens: "x", argv: [1] }]).ok === false);
  if (fails.length) {
    process.stderr.write("fan-out --selftest: FAIL\n" + fails.map((f) => "  ✗ " + f).join("\n") + "\n");
    return 1;
  }
  process.stdout.write("fan-out --selftest: ok\n");
  return 0;
}

// `spawnFn` is injectable exactly as review-call.mjs's getFn/streamFn are, so a caller (or test) can
// stub the transport; it defaults to the real node:child_process.spawn for the CLI.
export async function main(argv, { spawnFn = spawn } = {}) {
  // Must run FIRST, before readRequestsInput — that call reads --requests FILE or stdin (fd 0), so
  // placed later an interactive --selftest with no piped input would block on stdin.
  if (argv.includes("--selftest")) return selftest();
  let requests;
  try {
    requests = readRequestsInput(argv);
  } catch (e) {
    process.stderr.write(`fan-out: cannot read/parse --requests — ${e.message}\n`);
    return 1;
  }
  const v = validateRequests(requests);
  if (!v.ok) {
    process.stderr.write(`fan-out: ${v.reason}\n`);
    return 1;
  }
  const outcome = await fanOut(requests, { spawnFn });
  if (!outcome.ok) {
    process.stderr.write(`fan-out: spawn fault — ${outcome.fault}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(outcome.results) + "\n");
  return 0;
}

// Anti-pattern (see the spec's Design Decision Rationale): this file never re-derives the per-lens
// outcome mapping (exit → refuted/clear/unavailable) — that mapping is spec-review's own judgement,
// consumed by aggregate.mjs's contract-shaped input. fan-out.mjs stays a pure transport concern
// (spawn, collect, return) so it can be reused unmodified anywhere a set of review-call.mjs calls
// needs to run concurrently.

// Run as CLI only when invoked directly (not when imported by a test). Mirrors aggregate.mjs's
// import.meta.url / pathToFileURL(process.argv[1]) comparison (percent-encoding safe). FAFF-813:
// faff installs each skill by symlinking `plugin/skills/<skill>/` into `~/.claude/skills/<skill>`,
// so a production invocation's process.argv[1] is the symlink path while import.meta.url is already
// the repo realpath — canonicalise argv1 through realpathSync before comparing so a symlinked
// install path still matches.
export function entrypoint_href(argv1) {
  if (!argv1) return null;
  try {
    return pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return pathToFileURL(argv1).href;
  }
}

if (import.meta.url === entrypoint_href(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
