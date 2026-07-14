// FAFF-387 — `gitignore-ensure`'s canonical set change: `.faffrc.yaml` is NO LONGER
// ignored on new bootstraps (it is the committable base), `.faffrc.local.yaml` (the
// gitignored overlay) joins the set, and the command stays APPEND-ONLY — it never
// removes an existing line, so a repo that already ignores `.faffrc.yaml` keeps it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return out;
}
function seed() { return mkdtempSync(join(tmpdir(), "faff387gi-")); }

test("the canonical set is [.faffrc, .faffrc.yml, .faffrc.local.yaml, .faff/] — .faffrc.yaml is NOT in it", () => {
  const dir = seed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    const set = [...res.added, ...res.already];
    assert.deepEqual(set.sort(), [".faff/", ".faffrc", ".faffrc.local.yaml", ".faffrc.yml"].sort());
    assert.ok(!set.includes(".faffrc.yaml"), "the committable base `.faffrc.yaml` must NOT be in the ignore set");
    // and the written file agrees.
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gi, /^\.faffrc\.local\.yaml$/m, "overlay is ignored");
    assert.doesNotMatch(gi, /^\.faffrc\.yaml$/m, "base is not ignored on a fresh bootstrap");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append-only: an existing `.faffrc.yaml` ignore line is NEVER removed", () => {
  const dir = seed();
  try {
    // a legacy repo that already ignores the base file.
    writeFileSync(join(dir, ".gitignore"), "node_modules/\n.faffrc.yaml\n.faffrc\n");
    run(dir, "gitignore-ensure");
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gi, /^\.faffrc\.yaml$/m, "pre-existing `.faffrc.yaml` line is preserved (never removed)");
    assert.match(gi, /^node_modules\/$/m, "unrelated lines preserved");
    assert.match(gi, /^\.faffrc\.local\.yaml$/m, "the overlay is appended");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("idempotent: a second run is a byte-identical no-op", () => {
  const dir = seed();
  try {
    run(dir, "gitignore-ensure");
    const first = readFileSync(join(dir, ".gitignore"));
    run(dir, "gitignore-ensure");
    assert.deepEqual(readFileSync(join(dir, ".gitignore")), first, ".gitignore byte-identical after a re-run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
