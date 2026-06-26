// FAFF-238 — `faff lint-refs`: bans external-artifact refs (FAFF-NN ticket tags, ADR NNNN
// citations, numbered docs/adr pointers) in prose the reader executes or publicly consumes.
// Slice 1 enforces docs/guide/**; docs/ outside docs/guide/ is allow-by-default; within-prose
// anchors are never flagged. The real repo tree (ref-free guides) must pass clean.
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

test("flags an ADR citation (padded and unpadded) and a numbered docs/adr pointer", () => {
  const r = runOnTree({
    "docs/guide/a.md": "per ADR 0013 the split\n",
    "docs/guide/b.md": "per ADR-9 the call\n",
    "docs/guide/c.md": "see docs/adr/0010-foo.md\n",
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /a\.md:1 ✗ ADR 0013/);
  assert.match(r.stdout, /b\.md:1 ✗ ADR-9/);
  assert.match(r.stdout, /c\.md:1 ✗ docs\/adr\/0010-foo/);
});

test("does NOT flag within-prose anchors or a bare docs/adr dir mention", () => {
  const r = runOnTree({
    "docs/guide/ok.md": [
      "the gateway → Automation eligibility section",
      "the sibling faff/SKILL.md holds it",
      "the faff adr command operates on docs/adr/",
      "delegated to faffter-dark-nlspec",
    ].join("\n") + "\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("does NOT scan docs/ outside docs/guide/ (allow-by-default)", () => {
  // A ticket ref in docs/cli.md (root) and docs/adr/ must be ignored — only docs/guide/ is enforced.
  const r = runOnTree({
    "docs/cli.md": "see FAFF-26\n",
    "docs/adr/0001-foo.md": "Supersedes: ADR-0000 and relates to FAFF-1\n",
    "docs/guide/clean.md": "no refs here\n",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the real repo tree passes (guides are ref-free — green by construction)", () => {
  const r = run(["--root", REPO]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
