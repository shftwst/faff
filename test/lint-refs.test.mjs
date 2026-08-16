// `faff lint-refs`: bans external-artifact refs (FAFF-NN ticket tags, ADR NNNN citations,
// numbered records/adr pointers) in prose the reader executes or publicly consumes. Two
// enforced surfaces: docs/guide/** (recursive) and plugin/skills/*/SKILL.md (the literal
// per-skill manifest, non-recursive — contracts/ and examples/ under a skill dir stay exempt).
// docs/ outside docs/guide/ is allow-by-default; within-prose anchors are never flagged.
// The real repo tree (both surfaces ref-free) must pass clean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args) => spawnSync(process.execPath, [BIN, "lint-refs", ...args], { encoding: "utf8" });

// Build a throwaway root with the given {relativePath: contents} files, run lint-refs --root over it.
function runOnTree(files) {
  const dir = mkdtempSync(join(tmpdir(), "faff-lintrefs-"));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
  const r = run(["--root", dir]);
  rmSync(dir, { recursive: true, force: true });
  return r;
}

test("--selftest passes (matcher table)", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /lint-refs --selftest: ok/);
});

test("clean docs/guide tree passes", () => {
  const r = runOnTree({ "docs/guide/intro.md": "# Intro\n\nPlain prose, no refs.\n" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /PASS/);
});

test("flags a FAFF-NN ticket tag, naming file:line", () => {
  const r = runOnTree({ "docs/guide/cli.md": "first line\nsee FAFF-26 for rationale\n" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL\s+docs\/guide\/cli\.md:2 ✗ FAFF-26/);
});

test("flags a canonical (3-4 digit) ADR citation and a numbered records/adr pointer", () => {
  const r = runOnTree({
    "docs/guide/a.md": "per ADR 0013 the split\n",
    "docs/guide/b.md": "per ADR 013 the split\n",
    "docs/guide/c.md": "see records/adr/0010-foo.md\n",
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /a\.md:1 ✗ ADR 0013/);
  assert.match(r.stdout, /b\.md:1 ✗ ADR 013/);
  assert.match(r.stdout, /c\.md:1 ✗ records\/adr\/0010-foo/);
});

test("does NOT flag a 1-2 digit ADR ref (below the canonical zero-padded form)", () => {
  const r = runOnTree({ "docs/guide/d.md": "the adrenergic ADR 9 receptor note\n" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does NOT flag within-prose anchors or a bare records/adr dir mention", () => {
  const r = runOnTree({
    "docs/guide/ok.md": [
      "the gateway → Automation eligibility section",
      "the sibling faff/SKILL.md holds it",
      "the faff adr command operates on records/adr/",
      "delegated to faffter-dark-nlspec",
    ].join("\n") + "\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does NOT scan docs/ outside docs/guide/ (allow-by-default)", () => {
  // A ticket ref in docs/cli.md (root) and records/adr/ must be ignored — only docs/guide/ is enforced.
  const r = runOnTree({
    "docs/cli.md": "see FAFF-26\n",
    "records/adr/0001-foo.md": "Supersedes: ADR-0000 and relates to FAFF-1\n",
    "docs/guide/clean.md": "no refs here\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("flags a ref in a plugin/skills/<skill>/SKILL.md, naming file:line", () => {
  const r = runOnTree({
    "plugin/skills/demo/SKILL.md": "# Demo\n\nsee FAFF-239 for rationale\n",
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL\s+plugin\/skills\/demo\/SKILL\.md:3 ✗ FAFF-239/);
});

test("does NOT scan non-SKILL.md markdown under plugin/skills/ (the enumeration globs */SKILL.md, no recursion)", () => {
  // A ref in a skill's contracts/README.md and examples/*.md must be ignored — only the
  // literal per-skill SKILL.md is enforced. The clean SKILL.md keeps the surface non-empty.
  const r = runOnTree({
    "plugin/skills/demo/SKILL.md": "# Demo\n\nno refs here\n",
    "plugin/skills/demo/contracts/README.md": "the contract shipped in FAFF-109\n",
    "plugin/skills/demo/examples/spec.example.md": "per ADR 0013 and records/adr/0010-foo.md\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("scans BOTH surfaces in one pass, accumulating into one violations list", () => {
  const r = runOnTree({
    "docs/guide/g.md": "see FAFF-1 here\n",
    "plugin/skills/demo/SKILL.md": "# Demo\n\nand FAFF-2 here\n",
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /docs\/guide\/g\.md:1 ✗ FAFF-1/);
  assert.match(r.stdout, /plugin\/skills\/demo\/SKILL\.md:3 ✗ FAFF-2/);
  assert.match(r.stderr, /plugin\/skills\/\*\/SKILL\.md/); // summary names both surfaces
});

test("the real repo tree passes (both enforced surfaces ref-free — the end-to-end sweep guard)", () => {
  const r = run(["--root", REPO]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
