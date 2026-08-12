// FAFF-581 — the registry-coverage gate (`faff lint-cli-coverage`) and the zero-dep
// coverage aggregator. Exercises both through their real entrypoints via runCli /
// a direct spawn, asserting the deterministic seam (exit + parsed JSON). Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const BIN = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");
const { TEST_FILE_COVERAGE, exercisesCommand } = require(
  path.join(repoRoot, "plugin", "skills", "faff", "bin", "lib", "lint-cli-coverage.js"),
);
const runBin = (args) => spawnSync(process.execPath, [BIN, "lint-cli-coverage", ...args], { encoding: "utf8" });

// Build a throwaway root that MIRRORS the real declared TEST_FILE_COVERAGE files
// (copied from the repo so the declaration list can change without editing the
// test), optionally mutating one, then run lint-cli-coverage --root over it.
// uncovered/orphaned derive from the compiled registry (root-independent), so a
// fixture root only controls the file existence/exercise side.
function mirrorRoot(mutate) {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-lintclicov-"));
  for (const rel of Object.values(TEST_FILE_COVERAGE)) {
    const dest = path.join(dir, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(path.join(repoRoot, rel), "utf8"));
  }
  if (mutate) mutate(dir);
  return dir;
}

// --- lint-cli-coverage (the gate) ---
test("lint-cli-coverage: the live registry is fully covered (exit 0, PASS)", () => {
  const { stdout, code } = runCli(["lint-cli-coverage"]);
  assert.equal(code, 0);
  assert.match(stdout, /PASS/);
});

test("lint-cli-coverage --json: ok true, zero uncovered/orphaned/stale/not-exercised", () => {
  const { stdout, code } = runCli(["lint-cli-coverage", "--json"]);
  assert.equal(code, 0);
  const r = JSON.parse(stdout);
  assert.equal(r.ok, true);
  assert.equal(r.uncovered.length, 0);
  assert.equal(r.orphaned.length, 0);
  assert.equal(r.missingFiles.length, 0);
  assert.equal(r.notExercised.length, 0); // FAFF-771: the real tree exercises all five
  assert.ok(r.commands > 0);
});

// --- FAFF-771: the content-exercise check (a declared file must INVOKE its command) ---

test("exercisesCommand matches all five verified real call shapes, rejects substring/prose", () => {
  assert.equal(exercisesCommand('run(["sync", "--dry-run"])', "sync"), true);
  assert.equal(exercisesCommand('spawnSync(p, [BIN, "validate-adapters"])', "validate-adapters"), true);
  assert.equal(exercisesCommand('runCli(["labels"])', "labels"), true);
  assert.equal(exercisesCommand('runCli(["state", "--json"])', "state"), true);
  assert.equal(exercisesCommand('run("doctor", "--target", t)', "doctor"), true);
  // substring tokens and prose/comment mentions do not read as coverage
  assert.equal(exercisesCommand('run(["stateful"])', "state"), false);
  assert.equal(exercisesCommand('run(["sync-status"])', "sync"), false);
  assert.equal(exercisesCommand("// exercises the sync command", "sync"), false);
  assert.equal(exercisesCommand('const notes = "we run doctor nightly";', "doctor"), false);
});

test("integration: a declared file that only mentions its command in a comment is notExercised (exit 1, offender named, no other array)", () => {
  const [cmd, rel] = Object.entries(TEST_FILE_COVERAGE)[0];
  const dir = mirrorRoot((d) => {
    // overwrite exactly ONE mirrored file with a body that mentions the command only in a comment
    writeFileSync(path.join(d, rel), `// this file only mentions ${cmd} in a comment, never invokes it\n`);
  });
  const r = runBin(["--root", dir, "--json"]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.notExercised.includes(`${cmd} → ${rel}`), r.stdout);
  // and it is reported under NO other array
  assert.ok(!out.uncovered.includes(cmd));
  assert.ok(!out.orphaned.includes(cmd));
  assert.ok(!out.missingFiles.includes(`${cmd} → ${rel}`));
});

test("a declared coverage path that resolves to a directory exits 2 (fail-closed, uid-robust)", () => {
  const [, rel] = Object.entries(TEST_FILE_COVERAGE)[0];
  const dir = mirrorRoot((d) => {
    const p = path.join(d, rel);
    rmSync(p, { force: true });        // drop the mirrored file
    mkdirSync(p, { recursive: true }); // replace with a directory → readFileSync throws EISDIR regardless of uid
  });
  const r = runBin(["--root", dir]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("the mirrored real tree (unmutated) passes clean — the five real files all exercise their command", () => {
  const dir = mirrorRoot();
  const r = runBin(["--root", dir, "--json"]);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).notExercised, []);
});

test("lint-cli-coverage --selftest: the pure bidirectional-diff cores pass", () => {
  const { stdout, code } = runCli(["lint-cli-coverage", "--selftest"]);
  assert.equal(code, 0);
  assert.match(stdout, /lint-cli-coverage --selftest: ok/);
});

// --- coverage-aggregate (publish-only measurement) ---
const aggPath = path.join(repoRoot, "scripts", "coverage-aggregate.mjs");
const runAgg = (args, env) =>
  spawnSync("node", [aggPath, ...args], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, ...env } });

test("coverage-aggregate --selftest: the pure V8-range→line cores pass", () => {
  const r = runAgg(["--selftest"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /coverage-aggregate --selftest: ok/);
});

test("coverage-aggregate on an empty dir: exits 0, publishes n/a (never throws)", () => {
  const empty = mkdtempSync(path.join(tmpdir(), "faff-v8cov-empty-"));
  const r = runAgg(["--dir", empty]);
  assert.equal(r.status, 0); // publish-only: never fails the job
  assert.match(r.stdout, /n\/a/);
});

test("coverage-aggregate with NODE_V8_COVERAGE unset and no --dir: exits 0, n/a", () => {
  const r = runAgg([], { NODE_V8_COVERAGE: "" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /n\/a/);
});
