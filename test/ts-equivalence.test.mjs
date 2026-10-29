// FAFF-1432 — scripts/ts-equivalence.js, the one-time equivalence check for a JavaScript-to-TypeScript
// conversion, and the committed evidence it was run against. Each fixture pair under
// testdata/typescript/equivalence/<case>/ is a base.js committed in a throwaway git repo and an
// emit.js written over it; the script compares the two with the case's allow file.
//
// The script tests SELF-SKIP when the typescript compiler API is not installed, as
// check-no-boundary-cast.test.mjs does: the CI unit matrix never installs the build-time toolchain,
// and the typecheck job runs this file under an un-skip floor. The evidence-file tests need no
// compiler and always run.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const SCRIPT = path.join(PLUGIN, "scripts", "ts-equivalence.js");
const FIX = path.join(REPO, "testdata", "typescript", "equivalence");
const EVIDENCE = path.join(REPO, "verification", "ts-conversion", "FAFF-1432");

function hasTypescript() {
  try { createRequire(path.join(PLUGIN, "package.json"))("typescript"); return true; } catch { return false; }
}
const skip = hasTypescript() ? false : "typescript compiler API not installed (run `npm install` under plugin/skills/faff)";

const tempDirs = [];
after(() => { for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true }); });

const git = (cwd, args) => {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

// Commit the case's base.js as mod.js, write its emit.js over it, and run the script against HEAD.
function runCase(name, allowFile = "allow.json") {
  const dir = mkdtempSync(path.join(os.tmpdir(), "faff-ts-equivalence-"));
  tempDirs.push(dir);
  git(dir, ["init", "-q"]);
  copyFileSync(path.join(FIX, name, "base.js"), path.join(dir, "mod.js"));
  git(dir, ["add", "mod.js"]);
  git(dir, ["commit", "-q", "-m", "base"]);
  copyFileSync(path.join(FIX, name, "emit.js"), path.join(dir, "mod.js"));
  return spawnSync(process.execPath, [SCRIPT, "--base", "HEAD", "--allow", path.join(FIX, name, allowFile), "mod.js"], { cwd: dir, encoding: "utf8" });
}

test("exit 0: a pair that differs only by toolchain preamble", { skip }, () => {
  const r = runCase("preamble");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 allowed difference/);
});

test("exit 0: preamble only, with a base that already starts with \"use strict\"", { skip }, () => {
  const r = runCase("preamble-strict-base");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 allowed difference/);
});

test("exit 0: an inserted get helper and one rewritten read, with matching entries", { skip }, () => {
  const r = runCase("reflect-get");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 allowed difference/);
});

test("exit 0: a bound-local undefined guard, with a matching entry", { skip }, () => {
  const r = runCase("undefined-guard");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 allowed difference/);
});

for (const [name, statement] of [
  ["reordered", "const b = 2;"],
  ["class-field", "reason;"],
  ["string-literal", 'const LABEL = "faff-parkd";'],
  ["reflect-get-unallowed", 'return Reflect.get(Object(e), "code");'],
]) {
  test(`exit 1 naming the statement: ${name} with no allow entry`, { skip }, () => {
    const r = runCase(name);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`+${statement}`), `the output should name ${statement}, got:\n${r.stdout}`);
  });
}

test("exit 1 naming the entry: an allow entry that matches no difference", { skip }, () => {
  const r = runCase("preamble", "allow-unused.json");
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /allow entry 0 \(reflect-get-read\) for mod\.js matches no difference/);
});

for (const [file, message] of [
  ["allow-empty-reason.json", /empty reason/],
  ["allow-bad-kind.json", /not one of reflect-get-helper, reflect-get-read, undefined-guard/],
  ["allow-both-empty.json", /both before and after empty/],
]) {
  test(`exit 2: a malformed allow file (${file})`, { skip }, () => {
    const r = runCase("preamble", file);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, message);
  });
}

// --- the committed evidence for this conversion (no compiler needed) ---

const KINDS = new Set(["reflect-get-helper", "reflect-get-read", "undefined-guard"]);
const PATHS = ["bin/lib/land.js", "bin/lib/spec-commit.js", "bin/lib/gates-progress.js"];

test("equivalence-allow.json: every entry has a known kind and a reason, and each path has at most one helper", () => {
  const entries = JSON.parse(readFileSync(path.join(EVIDENCE, "equivalence-allow.json"), "utf8"));
  assert.ok(Array.isArray(entries) && entries.length > 0);
  for (const [i, e] of entries.entries()) {
    assert.ok(PATHS.includes(e.path), `entry ${i} names ${e.path}`);
    assert.ok(KINDS.has(e.kind), `entry ${i} has kind ${e.kind}`);
    assert.equal(typeof e.reason, "string");
    assert.ok(e.reason.trim().length > 0, `entry ${i} has an empty reason`);
    assert.ok(e.before !== "" || e.after !== "", `entry ${i} has both before and after empty`);
  }
  for (const p of PATHS) {
    assert.ok(entries.filter((e) => e.path === p && e.kind === "reflect-get-helper").length <= 1, `${p} has more than one reflect-get-helper`);
  }
});

const STRICT_CHANGES = [
  "assignment to an undeclared variable throws",
  "duplicate parameter names, octal literals, with",
  "this is undefined in a plain function call",
  "arguments stops aliasing parameters; arguments.callee throws",
  "writing a read-only property or a non-writable global throws",
  "delete of an unqualified name is a syntax error",
  "eval gets its own scope",
];

test("strict-mode-audit.json: one row per strict-mode change for land and gates-progress, each cleared with evidence", () => {
  const rows = JSON.parse(readFileSync(path.join(EVIDENCE, "strict-mode-audit.json"), "utf8"));
  assert.equal(rows.length, STRICT_CHANGES.length * 2);
  for (const mod of ["land", "gates-progress"]) {
    const mine = rows.filter((r) => r.module === mod);
    assert.deepEqual(mine.map((r) => r.change), STRICT_CHANGES, `${mod} rows`);
    for (const r of mine) {
      assert.ok(["refused-by-tsc", "absent", "present-safe"].includes(r.status), `${mod} / ${r.change}: status ${r.status}`);
      assert.ok(typeof r.evidence === "string" && r.evidence.trim().length > 0, `${mod} / ${r.change}: empty evidence`);
    }
  }
});
