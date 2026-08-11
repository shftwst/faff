// FAFF-186 — the WorktreeCreate hook must copy .faffrc.yaml into the worktree, else `faff config`
// resolves to defaults during autonomous builds (wrong slots, no adversarial backend). Canonical
// name only — the resolver errors loudly on legacy .faffrc / .faffrc.yml, so copying those would
// inject that error into every worktree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, "..", "..", "plugin", "skills", "faff-graft", "setup-worktree.sh");
const script = readFileSync(HOOK, "utf8");

// The single `for f in <files>; do` config-copy loop.
const loop = script.match(/for f in ([^\n;]+); do/);

test("the config-copy loop exists in setup-worktree.sh", () => {
  assert.ok(loop, "setup-worktree.sh has a `for f in …; do` config-copy loop");
});

test("the copy loop includes .faffrc.yaml (so builds get the repo's faff config)", () => {
  const files = loop[1].trim().split(/\s+/);
  assert.ok(files.includes(".faffrc.yaml"), `copy list must include .faffrc.yaml; got: ${files.join(" ")}`);
});

// FAFF-387: the gitignored machine-local overlay must be copied too, so a linked
// worktree resolves the same MERGED config as the main checkout.
test("the copy loop includes .faffrc.local.yaml (FAFF-387 overlay)", () => {
  const files = loop[1].trim().split(/\s+/);
  assert.ok(files.includes(".faffrc.local.yaml"), `copy list must include .faffrc.local.yaml; got: ${files.join(" ")}`);
});

test("the copy loop does NOT copy legacy .faffrc / .faffrc.yml (the resolver errors on them)", () => {
  const files = loop[1].trim().split(/\s+/);
  assert.ok(!files.includes(".faffrc"), "must not copy bare .faffrc (legacy — resolver errors on it)");
  assert.ok(!files.includes(".faffrc.yml"), "must not copy .faffrc.yml (legacy — resolver errors on it)");
});

test("the copy is existence-guarded (no error when a file is absent in main)", () => {
  // the loop body guards each file with `[ -f "$CWD/$f" ]` before copying
  assert.match(script, /if \[ -f "\$CWD\/\$f" \]; then/, "each copied file is existence-guarded");
});

// FAFF-532: the copy must skip any path the worktree already TRACKS — `git worktree add`
// already materialised the correct own-ref content, so copying $CWD's (possibly stale/divergent)
// version over it would clobber a committed .faffrc.yaml. The tracked-test is `git ls-files
// --error-unmatch`, NOT `git check-ignore` (the overlay is untracked but need not be gitignore-listed).
test("the copy loop guards on `git ls-files --error-unmatch` (skip tracked, keep own-ref copy) (FAFF-532)", () => {
  assert.match(
    script,
    /git ls-files --error-unmatch -- "\$f"/,
    "the copy loop must gate each file on `git ls-files --error-unmatch -- \"$f\"` so a tracked file is not clobbered",
  );
});

test("the tracked-skip guard suppresses both streams and consults only the exit code (FAFF-532)", () => {
  // >/dev/null 2>&1 keeps `set -e` from tripping and stops ls-files noise leaking into the worktree.
  assert.match(
    script,
    /git ls-files --error-unmatch -- "\$f" >\/dev\/null 2>&1/,
    "the tracked-test must redirect stdout+stderr to /dev/null and branch on the exit code alone",
  );
});

test("the tracked-vs-overlay decision does NOT use `git check-ignore` (FAFF-532 anti-pattern)", () => {
  assert.ok(
    !/git check-ignore/.test(script),
    "must not use `git check-ignore` — the overlay is untracked yet need not be gitignore-listed, so it would be wrongly dropped",
  );
});
