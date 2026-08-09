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
import { readFileSync } from "node:fs";
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
  const rejected = settled.find((s) => s.status === "rejected");
  if (rejected) {
    const err = rejected.reason;
    const fault = err instanceof Error ? err.message : String(err);
    return { ok: false, fault };
  }
  return { ok: true, results: settled.map((s) => s.value) };
}

// ---- CLI ------------------------------------------------------------------
// Input (stdin or --requests FILE) is JSON: either a bare array of LensRequest, or an object
// { requests: [...] } — mirrors aggregate.mjs's dual-mode CLI shape.
function readRequestsInput(argv) {
  const fi = argv.indexOf("--requests");
  const raw = fi !== -1 ? readFileSync(argv[fi + 1], "utf8") : readFileSync(0, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.requests)) return parsed.requests;
  return parsed; // let validateRequests reject a non-array/non-{requests:[]} shape uniformly
}

// `spawnFn` is injectable exactly as review-call.mjs's getFn/streamFn are, so a caller (or test) can
// stub the transport; it defaults to the real node:child_process.spawn for the CLI.
export async function main(argv, { spawnFn = spawn } = {}) {
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
// import.meta.url / pathToFileURL(process.argv[1]) comparison (percent-encoding safe).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
