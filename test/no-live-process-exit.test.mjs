// FAFF-1355 — shipped JS must end by setting process.exitCode, never by a live process.exit() call
// (Node 24 can hang in process.exit(); nodejs/node#64274).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWLIST, countLiveProcessExit, checkLiveProcessExit } from "./helpers/live-process-exit.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "plugin", "skills");
const EXTRA_FILES = ["plugin/skills/faff/bin/faff"];

function shippedFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) shippedFiles(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function shippedSources() {
  const paths = [...shippedFiles(SKILLS), ...EXTRA_FILES.map((p) => join(ROOT, p))];
  return new Map(paths.map((p) => [relative(ROOT, p).split(sep).join("/"), readFileSync(p, "utf8")]));
}

test("no live process.exit in shipped JS", () => {
  const problems = checkLiveProcessExit(shippedSources());
  assert.deepEqual(problems, []);
});

test("every ALLOWLIST path exists", () => {
  for (const { path } of ALLOWLIST) assert.ok(existsSync(join(ROOT, path)), `${path} is allowlisted but missing`);
});

test("ALLOWLIST holds exactly the two backstops", () => {
  assert.deepEqual(ALLOWLIST.map((e) => [e.path, e.count]), [
    ["plugin/skills/faffter-dark-adversarial-review/review-call.mjs", 1],
    ["plugin/skills/faff/bin/faff-bridge-node.mjs", 1],
  ]);
});

test("lexer: text that cannot hold a live call counts 0", () => {
  assert.equal(countLiveProcessExit("// process.exit(1)\n"), 0);
  assert.equal(countLiveProcessExit("/* process.exit(1) */"), 0);
  assert.equal(countLiveProcessExit(`const a = "process.exit(1)"; const b = 'process.exit(1)';`), 0);
  assert.equal(countLiveProcessExit("const t = `node -e process.exit(1)`;"), 0);
  assert.equal(countLiveProcessExit("#!/usr/bin/env node\nconst x = 1;"), 0);
  assert.equal(countLiveProcessExit("const exit = process.exit;"), 0);
});

test("lexer: live calls count 1", () => {
  assert.equal(countLiveProcessExit("const t = `${process.exit(1)}`;"), 1);
  assert.equal(countLiveProcessExit("const t = `a ${ {k: 1}.k } ${process.exit(1)}`;"), 1);
  assert.equal(countLiveProcessExit(`const r = /"/; process.exit(1);`), 1);
  assert.equal(countLiveProcessExit("return /x/.test(s); process.exit(1)"), 1);
  assert.equal(countLiveProcessExit("process.exit(1) // done"), 1);
  assert.equal(countLiveProcessExit("a = b / c; process.exit(1)"), 1);
});

test("lexer: optional-chain and bracket spellings count 1, inside strings or comments 0", () => {
  for (const live of ["process?.exit(1)", `process["exit"](1)`, `process['exit'](1)`]) {
    assert.equal(countLiveProcessExit(live), 1, live);
    assert.equal(countLiveProcessExit(`// ${live}`), 0, `comment: ${live}`);
    assert.equal(countLiveProcessExit(`const s = \`${live}\`;`), 0, `template: ${live}`);
  }
  assert.equal(countLiveProcessExit(`const s = "process?.exit(1)";`), 0);
});

test("a new live call in an unallowlisted file fails and names the path and FAFF-1355", () => {
  const files = new Map(ALLOWLIST.map((e) => [e.path, "process.exit(1);"]));
  files.set("plugin/skills/x/new.mjs", "process.exit(0);");
  const problems = checkLiveProcessExit(files).join("\n");
  assert.match(problems, /plugin\/skills\/x\/new\.mjs: 1 live process\.exit call\(s\), allowed 0/);
  assert.match(problems, /FAFF-1355/);
});

test("a stale allowlist entry (fewer calls than allowed) fails and names the path", () => {
  const files = new Map(ALLOWLIST.map((e) => [e.path, "process.exitCode = 1;"]));
  const problems = checkLiveProcessExit(files).join("\n");
  assert.match(problems, /review-call\.mjs: 0 live process\.exit call\(s\), allowed 1/);
});

test("an allowlisted path missing from the scan fails", () => {
  const problems = checkLiveProcessExit(new Map()).join("\n");
  assert.match(problems, /review-call\.mjs: allowlisted file not found/);
});
