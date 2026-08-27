// FAFF-919 — the `faff ratified-scope` subcommand: assemble a `## Ratified scope` block from two
// committed sources (a PRD's `## Non-goals` section + the `docs/decisions.md` settled precedents) and
// validate the SHAPE of a supplied block. Read-only, deterministic, no network, no writes.
//
// Most cases spawn the real bin (the deterministic {stdout, stderr, code} seam, like decisions.test.mjs).
// The no-write and no-network guards run IN-PROCESS: runCli spawns a child, whose syscalls a
// test-process fs monkeypatch cannot observe, so those two assertions require the handler in-process.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const RS_PATH = join(REPO, "plugin", "skills", "faff", "bin", "lib", "ratified-scope.js");

const run = (args, { cwd = REPO, input } = {}) =>
  spawnSync(process.execPath, [BIN, "ratified-scope", ...args], { cwd, input, encoding: "utf8" });

const NON_GOALS_BODY = "- No horizontal scaling in v1. One api instance, one region.\n- No connection pooler and no read replica.";
const PRD_WITH_NON_GOALS =
  "# PRD — demo\n\n- **Container:** demo\n- **Status:** Active\n- **Date:** 2026-08-27\n- **Mode:** authored\n\n" +
  "## Non-goals\n\n" + NON_GOALS_BODY + "\n\n" +
  "## Acceptance criteria\n\n- Given a request, When it arrives, Then it is served.\n";
const PRD_LINKED_MODE = "# PRD — demo\n\n- **PRD:** https://example.invalid/prd/demo\n";
const PRD_PLACEHOLDER_NON_GOALS = "# PRD — demo\n\n## Non-goals\n\n_TODO._\n\n## Acceptance criteria\n\n- Given x, When y, Then z.\n";
const SCOPED_DECISION =
  "# Decisions register\n\n## Single-instance rate limiting for v1\n" +
  "- Chosen: the limiter keeps its counters in process.\n" +
  "- Rationale: v1 runs one api instance.\n" +
  "- Scope: the v1 checkout deployment; any per-client throttle on it.\n" +
  "- Matches: rate limiting for v1\n- Date: 2026-08-27\n";
const UNSCOPED_DECISION =
  "# Decisions register\n\n## No scope here\n- Chosen: x\n- Rationale: y\n- Matches: k\n- Date: 2026-08-27\n";

// A temp repo root. `prd` writes docs/prd/demo.md; `decisions` writes docs/decisions.md (each optional).
function tmpRepo({ prd, decisions } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-ratified-scope-it-"));
  if (prd != null) {
    mkdirSync(join(root, "docs", "prd"), { recursive: true });
    writeFileSync(join(root, "docs", "prd", "demo.md"), prd);
  }
  if (decisions != null) {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "decisions.md"), decisions);
  }
  return root;
}

// --- assemble --------------------------------------------------------------

test("assemble: both halves present -> exit 0, heading + provenance + both bodies", () => {
  const root = tmpRepo({ prd: PRD_WITH_NON_GOALS, decisions: SCOPED_DECISION });
  const r = run(["--assemble", "--root", root, "--container", "demo"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.split("\n")[0], "## Ratified scope");
  assert.match(r.stdout, /Assembled by `faff ratified-scope`/);
  assert.match(r.stdout, /### Non-goals: PRD `demo` \(docs\/prd\/demo\.md\)/);
  assert.ok(r.stdout.includes("No horizontal scaling in v1"), "non-goals body verbatim");
  assert.ok(r.stdout.includes("- Scope: the v1 checkout deployment"), "precedent scope cited");
  rmSync(root, { recursive: true, force: true });
});

test("assemble: PRD only (no scoped precedent) -> exit 0, non-goals section only", () => {
  const root = tmpRepo({ prd: PRD_WITH_NON_GOALS, decisions: UNSCOPED_DECISION });
  const r = run(["--assemble", "--root", root, "--container", "demo"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /### Non-goals: PRD `demo`/);
  assert.ok(!r.stdout.includes("### Settled precedents"), "no precedents section when none scoped");
  rmSync(root, { recursive: true, force: true });
});

test("assemble: precedents only (no --container) -> exit 0, precedents section only", () => {
  const root = tmpRepo({ decisions: SCOPED_DECISION });
  const r = run(["--assemble", "--root", root]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /### Settled precedents \(docs\/decisions\.md\)/);
  assert.ok(!r.stdout.includes("### Non-goals"), "no non-goals section without a PRD");
  assert.match(r.stdout, /- \*\*Single-instance rate limiting for v1\*\* \(`single-instance-rate-limiting-for-v1`\)/);
  rmSync(root, { recursive: true, force: true });
});

test("assemble: nothing ratified -> exit 3, empty stdout", () => {
  const root = tmpRepo({ decisions: UNSCOPED_DECISION });
  const r = run(["--assemble", "--root", root]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("assemble: placeholder-only (_TODO._) non-goals is treated as absent", () => {
  const root = tmpRepo({ prd: PRD_PLACEHOLDER_NON_GOALS });
  const r = run(["--assemble", "--root", root, "--container", "demo"]);
  // No scoped precedent and the non-goals body is a placeholder -> nothing ratified.
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("assemble: --container with the PRD file absent skips the PRD half, keeps precedents", () => {
  const root = tmpRepo({ decisions: SCOPED_DECISION }); // no docs/prd/demo.md
  const r = run(["--assemble", "--root", root, "--container", "demo"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes("### Non-goals"), "PRD half skipped when the file is absent");
  assert.match(r.stdout, /### Settled precedents/);
  rmSync(root, { recursive: true, force: true });
});

test("assemble: a linked-mode PRD (no ## sections) yields no non-goals half and is not an error", () => {
  const root = tmpRepo({ prd: PRD_LINKED_MODE, decisions: SCOPED_DECISION });
  const r = run(["--assemble", "--root", root, "--container", "demo"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!r.stdout.includes("### Non-goals"), "linked-mode PRD contributes no non-goals section");
  rmSync(root, { recursive: true, force: true });
});

// --- validate --------------------------------------------------------------

test("validate: assemble output piped to --validate exits 0 (shape round-trip)", () => {
  const root = tmpRepo({ prd: PRD_WITH_NON_GOALS, decisions: SCOPED_DECISION });
  const a = run(["--assemble", "--root", root, "--container", "demo"]);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  const v = run(["--validate"], { input: a.stdout });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /well-formed/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: empty stdin -> exit 1, problem 'empty input'", () => {
  const r = run(["--validate"], { input: "" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /empty input/);
});

test("validate: malformed (heading + provenance, no subsection) -> exit 1", () => {
  const rs = require(RS_PATH);
  const block = "## Ratified scope\n\n" + rs.PROVENANCE_SENTENCE + "\n";
  const r = run(["--validate"], { input: block });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no non-goals section and no settled-precedents section/);
});

test("validate: provenance line not beginning with the anchor -> exit 1", () => {
  const block = "## Ratified scope\n\nSomething else entirely.\n\n### Settled precedents (docs/decisions.md)\n";
  const r = run(["--validate"], { input: block });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing the provenance sentence/);
});

test("validate: --json emits {valid, problems}", () => {
  const r = run(["--validate", "--json"], { input: "" });
  assert.equal(r.status, 1);
  assert.deepEqual(JSON.parse(r.stdout), { valid: false, problems: ["empty input"] });
});

test("validate: a hand-crafted well-formed block passes — SHAPE, not authenticity", () => {
  const rs = require(RS_PATH);
  // A block never produced by --assemble from any committed file: it names files that do not exist.
  // It still validates, because --validate checks shape only. This pins that a pass is not a trust gate.
  const handCrafted =
    "## Ratified scope\n\n" + rs.PROVENANCE_SENTENCE + "\n\n" +
    "### Non-goals: PRD `never-assembled` (docs/prd/never-assembled.md)\n\n- Entirely invented.\n";
  const r = run(["--validate"], { input: handCrafted });
  assert.equal(r.status, 0, "a hand-crafted well-formed block validates (shape only)");
  // And the pure validator agrees the shape is well-formed while asserting nothing about origin.
  assert.equal(rs.validate(handCrafted).valid, true);
});

test("validate: an unreadable --in file exits 2", () => {
  const r = run(["--validate", "--in", join(tmpdir(), "faff-ratified-scope-does-not-exist-xyz.md")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
});

test("validate: an oversize --in file exits 2, loud stderr (statSync guard, no unbounded read)", () => {
  const root = mkdtempSync(join(tmpdir(), "faff-ratified-scope-big-"));
  const big = join(root, "big.md");
  const rs = require(RS_PATH);
  writeFileSync(big, "x".repeat(rs.VALIDATE_MAX_BYTES + 1));
  const r = run(["--validate", "--in", big]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /exceeds 1048576 bytes/);
  rmSync(root, { recursive: true, force: true });
});

test("validate: oversize stdin exits 2 without allocating past the cap (bounded chunked read)", () => {
  const rs = require(RS_PATH);
  const r = run(["--validate"], { input: "y".repeat(rs.VALIDATE_MAX_BYTES + 4096) });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /exceeds 1048576 bytes/);
});

test("source: the stdin read path never calls fs.readFileSync(0) unbounded (bounded read pinned)", () => {
  const src = readFileSync(RS_PATH, "utf8");
  assert.ok(!/readFileSync\s*\(\s*0\b/.test(src), "must not read fd 0 with unbounded readFileSync");
  assert.ok(/fs\.readSync\s*\(\s*0\b/.test(src), "must read fd 0 with the bounded fs.readSync chunk loop");
});

// --- usage errors ----------------------------------------------------------

test("usage: neither --assemble nor --validate -> exit 2", () => {
  const r = run([]);
  assert.equal(r.status, 2);
});

test("usage: both --assemble and --validate -> exit 2", () => {
  const r = run(["--assemble", "--validate"]);
  assert.equal(r.status, 2);
});

test("usage: wrong-mode flags exit 2 (--in/--json with --assemble; --container/--root with --validate)", () => {
  assert.equal(run(["--assemble", "--in", "/dev/null"]).status, 2);
  assert.equal(run(["--assemble", "--json"]).status, 2);
  assert.equal(run(["--validate", "--container", "demo"], { input: "" }).status, 2);
  assert.equal(run(["--validate", "--root", "/tmp"], { input: "" }).status, 2);
});

// --- helper reuse ----------------------------------------------------------

test("nonGoalsSection reuses the shared scanner: fence-aware, stops at the next equal/higher heading", () => {
  const rs = require(RS_PATH);
  const prd =
    "## Non-goals\n\n- one\n- two\n\n```\n## fenced heading is not a boundary\n```\n\n- three\n\n## Acceptance criteria\n\n- ac\n";
  const body = rs.nonGoalsSection(prd);
  assert.ok(body.includes("- one") && body.includes("- three"), "body runs to the next real heading");
  assert.ok(body.includes("## fenced heading is not a boundary"), "a fenced ## line is not a boundary (fence-aware)");
  assert.ok(!body.includes("- ac"), "stops before the next ## heading");
  assert.equal(rs.nonGoalsSection("# no non-goals here\n\n- x\n"), null, "null when the heading is absent");
});

test("ratified-scope.js reuses admissibility's exported sectionBody (no copied scanner)", () => {
  const src = readFileSync(RS_PATH, "utf8");
  assert.ok(/require\(["']\.\/admissibility["']\)/.test(src), "requires ./admissibility");
  assert.ok(/\bsectionBody\b/.test(src), "calls the shared sectionBody");
  // The shared scanner's own logic (the sectionBodyRange fence/heading walk) is NOT copied in.
  assert.ok(!/function\s+sectionBodyRange/.test(src), "does not redefine sectionBodyRange");
  assert.ok(!/function\s+sectionBody\b/.test(src), "does not redefine sectionBody");
});

test("admissibility.js is unmodified by this ticket (its selftests still pass)", () => {
  for (const cmd of ["admissible", "dod", "prd"]) {
    const r = spawnSync(process.execPath, [BIN, cmd, "--selftest"], { cwd: REPO, encoding: "utf8" });
    assert.equal(r.status, 0, `${cmd} --selftest: ${r.stdout}${r.stderr}`);
  }
});

// --- selftest --------------------------------------------------------------

test("ratified-scope --selftest passes", () => {
  const r = spawnSync(process.execPath, [BIN, "ratified-scope", "--selftest"], { cwd: REPO, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
});

// --- in-process guards (require the handler in-process; runCli is a child spawn) -------------------

test("no-write guard: --assemble writes no file (global in-process fs write-guard)", () => {
  const rs = require(RS_PATH);
  // Build the fixtures BEFORE patching (the guard must not trip on fixture setup).
  const roots = [
    tmpRepo({ prd: PRD_WITH_NON_GOALS, decisions: SCOPED_DECISION }),
    tmpRepo({ prd: PRD_WITH_NON_GOALS, decisions: UNSCOPED_DECISION }),
    tmpRepo({ decisions: SCOPED_DECISION }),
    tmpRepo({ decisions: UNSCOPED_DECISION }),
    tmpRepo({ prd: PRD_LINKED_MODE, decisions: SCOPED_DECISION }),
  ];

  // Patch every fs write entry point on the SHARED fs module all libs require, so a write-then-delete
  // or an out-of-root write is caught too — not scoped to a fixture-tree diff.
  const WRITE_METHODS = ["writeFileSync", "appendFileSync", "mkdirSync", "writeSync", "rmSync", "renameSync", "truncateSync", "unlinkSync", "cpSync", "copyFileSync"];
  const saved = {};
  for (const m of WRITE_METHODS) { saved[m] = fs[m]; fs[m] = () => { throw new Error(`fs.${m} called — --assemble must not write`); }; }
  // openSync throws only for a write flag; reads (readFileSync/statSync/existsSync) stay live.
  const savedOpen = fs.openSync;
  fs.openSync = (p, flags, ...rest) => {
    const f = String(flags == null ? "r" : flags);
    if (/[wa+]/.test(f)) throw new Error("fs.openSync(write flag) called — --assemble must not write");
    return savedOpen(p, flags, ...rest);
  };

  try {
    for (const root of roots) {
      // assemble both with and without --container across the fixtures; any write throws and fails.
      assert.doesNotThrow(() => rs.assemble(root, "demo"));
      assert.doesNotThrow(() => rs.assemble(root, null));
      assert.doesNotThrow(() => rs.cmdRatifiedScope(["--assemble", "--root", root, "--container", "demo"]));
    }
  } finally {
    for (const m of WRITE_METHODS) fs[m] = saved[m];
    fs.openSync = savedOpen;
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test("no-network guard: the require graph pulls in no network-capable module", () => {
  const src = readFileSync(RS_PATH, "utf8");
  const ALLOW = new Set(["node:fs", "node:path", "./admissibility", "./decisions", "./prd", "./argv", "./shared-infra"]);
  const requires = [...src.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
  assert.ok(requires.length > 0, "found require() calls to inspect");
  for (const r of requires) {
    assert.ok(ALLOW.has(r), `ratified-scope.js requires "${r}" — outside the no-network allowlist`);
  }
  // Transitively, none of the reachable local libs reaches a network module. Resolve each local
  // dependency and assert no http/https/net/dns/tls/fetch appears in its require set (one hop is
  // sufficient here — the allowlisted local libs are the pure reader tier).
  const NET = /\b(node:)?(http|https|net|dns|tls)\b|\bfetch\s*\(/;
  const localDeps = requires.filter((r) => r.startsWith("."));
  for (const dep of localDeps) {
    const p = require.resolve(join(REPO, "plugin", "skills", "faff", "bin", "lib", dep.replace("./", "")));
    const depSrc = readFileSync(p, "utf8");
    const depRequires = [...depSrc.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    for (const dr of depRequires) {
      assert.ok(!NET.test(dr), `${dep} transitively requires a network module "${dr}"`);
    }
  }
});
