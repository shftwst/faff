#!/usr/bin/env node
// FAFF-928 — assemble the spec-review LensRequest[] deterministically (was inline `node -e` prose).
//
// The occupant fans out one `review-call.mjs` invocation per enabled lens (fan-out.mjs). Each lens's
// argv was previously assembled by an inline `node -e` snippet in SKILL.md — untestable prose. This
// bundled helper makes the assembly a deterministic tool (the house pattern shared with
// parse-refutation.mjs / aggregate.mjs), so the argv is unit-checkable and the new FAFF-928 raw-body
// flags (`--raw-dir <scratch>/raw --lens <lens> --round <n>`) are carried per invocation. Every other
// argv field is byte-identical to the old per-lens call, save for the one FAFF-1051 addition: `--diff`
// here is a markdown spec, not a unified diff, so every lens's argv also carries `--diff-kind prose` —
// the trim's anchored-relevance model has nothing to anchor against a document with no "@@" hunks, and
// declaring the kind routes it to the budget-driven head retention instead of today's 12-line truncation.
// Zero-dependency: node:path/node:url only.

import { join as pathJoin } from "node:path";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// PURE: one LensRequest ({lens, argv}) per enabled lens. The raw-body flags are appended only when a
// rawDir is supplied, so an occupant that resolves no scratch dir produces byte-for-byte the old argv.
//   lenses      — enabled lens names, in order (e.g. ["architectural","infosec","methodology","QA"])
//   backendsJson— the primary-first chain JSON path (--backends-json)
//   timeout     — per-backend --timeout seconds
//   maxTokens   — --max-tokens output cap
//   systemDir   — dir holding refute-<lens>.md (the --system brief)
//   contextPaths— files the spec names, each passed as one --context (+ the ratified-scope block when present)
//   diffPath    — the spec under scrutiny (--diff)
//   rawDir      — <scratch>/raw for FAFF-928 raw-body capture; falsy ⇒ the three flags are omitted
//   round       — spec-review round number for --round
//   deadline    : total wall-clock --deadline seconds, identical across every lens (like timeout);
//                 undefined/null/"" omits the flag, so a caller resolving no deadline is unaffected
export function buildLensRequests({
  lenses, backendsJson, timeout, maxTokens, systemDir, contextPaths = [], diffPath, rawDir, round, deadline,
} = {}) {
  if (!Array.isArray(lenses)) throw new Error("buildLensRequests: lenses must be an array");
  return lenses.map((lens) => {
    const argv = [
      "--backends-json", String(backendsJson),
      "--timeout", String(timeout),
      "--max-tokens", String(maxTokens),
    ];
    // The total wall-clock ceiling across all attempts/fallbacks for THIS lens's review-call.mjs
    // invocation; part of the shared/prefix-identical argv fields (order-independent of the wire's
    // cacheable prefix, which review-call.mjs assembles from --context/--diff, not from argv order).
    if (deadline !== undefined && deadline !== null && deadline !== "") argv.push("--deadline", String(deadline));
    argv.push(
      // The brief filenames are lowercase (refute-{architectural,infosec,methodology,qa}.md) but the
      // lens vocabulary carries `QA` uppercase, because that token is the spec-review-verdict contract
      // enum (contract-defs.js SPEC_REVIEW_LENSES) and rides in every objection's `lens` field. Lowercase
      // here rather than moving the enum: on a case-sensitive filesystem `refute-QA.md` is ENOENT, the QA
      // lens records a config-fault, and one config-fault floors the whole aggregate to needs-human.
      "--system", pathJoin(systemDir, `refute-${lens.toLowerCase()}.md`),
    );
    for (const p of contextPaths) argv.push("--context", String(p));
    argv.push("--diff", String(diffPath));
    // FAFF-1051: the spec under scrutiny is a document, not a unified diff — declare the kind so the
    // context trim stops truncating it to 12-line heads.
    argv.push("--diff-kind", "prose");
    // FAFF-928: per lens × backend × round raw-response-body capture. Absent rawDir ⇒ no flags (today's argv).
    if (rawDir) argv.push("--raw-dir", String(rawDir), "--lens", String(lens), "--round", String(round));
    return { lens, argv };
  });
}

// ---- CLI ------------------------------------------------------------------------------------
// build-lens-requests.mjs --lenses a,b,c --backends-json F --timeout T --max-tokens M --system-dir DIR
//   --diff SPEC [--context F]... [--raw-dir DIR --round N] [--deadline SECONDS]
// Prints the LensRequest[] JSON to stdout (drop-in for `fan-out.mjs --requests`).
export function parseArgs(argv) {
  const a = { contextPaths: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--lenses") a.lenses = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (k === "--backends-json") a.backendsJson = argv[++i];
    else if (k === "--timeout") a.timeout = argv[++i];
    else if (k === "--max-tokens") a.maxTokens = argv[++i];
    else if (k === "--system-dir") a.systemDir = argv[++i];
    else if (k === "--context") a.contextPaths.push(argv[++i]);
    else if (k === "--diff") a.diffPath = argv[++i];
    else if (k === "--raw-dir") a.rawDir = argv[++i];
    else if (k === "--round") a.round = argv[++i];
    else if (k === "--deadline") a.deadline = argv[++i];
  }
  return a;
}

function main(argv) {
  const a = parseArgs(argv.slice(2));
  if (!a.lenses || a.lenses.length === 0 || !a.backendsJson || !a.systemDir || !a.diffPath) {
    process.stderr.write("usage: build-lens-requests.mjs --lenses a,b --backends-json F --timeout T --max-tokens M --system-dir DIR --diff SPEC [--context F]... [--raw-dir DIR --round N]\n");
    return 2;
  }
  process.stdout.write(JSON.stringify(buildLensRequests(a)) + "\n");
  return 0;
}

// Run as CLI only when invoked directly (not when imported by the test) — mirrors parse-refutation.mjs /
// aggregate.mjs: canonicalise argv[1] through realpathSync so a symlinked install path (FAFF-813) matches.
export function entrypoint_href(argv1) {
  if (!argv1) return null;
  try {
    return pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return pathToFileURL(argv1).href;
  }
}

if (import.meta.url === entrypoint_href(process.argv[1])) {
  process.exit(main(process.argv));
}
