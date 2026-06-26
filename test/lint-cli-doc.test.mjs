// FAFF-237 — `faff lint-cli-doc`: asserts docs/guide/cli.md documents every subcommand the
// CLI dispatches (the COMMANDS registry), bidirectionally. The canonical set is the compiled
// registry (Object.keys(COMMANDS)), so --root fixtures control only the *documented* side.
// The real repo tree (every command documented) must pass clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");
const REAL_DOC = readFileSync(join(REPO, "docs", "guide", "cli.md"), "utf8");

const run = (args) => spawnSync(process.execPath, [BIN, "lint-cli-doc", ...args], { encoding: "utf8" });

// Build a throwaway root whose docs/guide/cli.md = body, run lint-cli-doc --root over it.
function runOnDoc(body) {
  const dir = mkdtempSync(join(tmpdir(), "faff-lintclidoc-"));
  const full = join(dir, "docs", "guide", "cli.md");
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
  const r = run(["--root", dir]);
  rmSync(dir, { recursive: true, force: true });
  return r;
}

test("--selftest passes (parse/diff table)", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lint-cli-doc --selftest: ok/);
});

test("the real repo tree passes — every subcommand documented (green by construction)", () => {
  const r = run(["--root", REPO]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS  lint-cli-doc: \d+ subcommands documented/);
});

test("a subcommand present in the CLI but absent from the doc fails, naming it", () => {
  // A doc that documents only `config` leaves every other real command missing.
  const r = runOnDoc("| Subcommand | What |\n|---|---|\n| `config get` | reads config |\n");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+docs\/guide\/cli\.md ✗ missing: eligible/); // a real command, absent here
});

test("a documented command the CLI does not expose fails as orphaned, naming it", () => {
  // The real doc (all real commands documented) + one ghost row → exactly one orphaned, no missing.
  const r = runOnDoc(REAL_DOC + "\n| `zzzghost --x` | not a real command |\n");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /FAIL\s+docs\/guide\/cli\.md ✗ orphaned: zzzghost/);
  assert.doesNotMatch(r.stdout, /✗ missing:/); // all real commands still documented
});

test("FP guard: leading --flag / dotfile spans are not parsed as commands", () => {
  // Real doc (in sync) + junk rows whose leading backtick span is a flag or a dotfile —
  // neither matches the command-shaped anchor, so the set stays in sync and passes.
  const r = runOnDoc(REAL_DOC + "\n| `--some-flag` | a flag, not a command |\n| `.faffrc.yaml` | a file, not a command |\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("an unreadable doc exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff-lintclidoc-empty-"));
  const r = run(["--root", dir]); // no docs/guide/cli.md under this root
  rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 2, r.stdout + r.stderr);
});

test("--json reports the diff machine-readably", () => {
  const r = run(["--root", REPO, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.deepEqual(out.missing, []);
  assert.deepEqual(out.orphaned, []);
});
