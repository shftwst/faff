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
const HOOK = join(HERE, "..", "plugin", "skills", "faff-graft", "setup-worktree.sh");
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

test("the copy loop does NOT copy legacy .faffrc / .faffrc.yml (the resolver errors on them)", () => {
  const files = loop[1].trim().split(/\s+/);
  assert.ok(!files.includes(".faffrc"), "must not copy bare .faffrc (legacy — resolver errors on it)");
  assert.ok(!files.includes(".faffrc.yml"), "must not copy .faffrc.yml (legacy — resolver errors on it)");
});

test("the copy is existence-guarded (no error when a file is absent in main)", () => {
  // the loop body guards each file with `[ -f "$CWD/$f" ]` before copying
  assert.match(script, /if \[ -f "\$CWD\/\$f" \]; then/, "each copied file is existence-guarded");
});
