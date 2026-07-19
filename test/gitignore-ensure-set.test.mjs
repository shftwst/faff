// FAFF-387 — `gitignore-ensure`'s canonical set change: `.faffrc.yaml` is NO LONGER
// ignored on new bootstraps (it is the committable base), the gitignored overlay joins
// the set, and the command stays APPEND-ONLY — it never removes an existing line, so a
// repo that already ignores `.faffrc.yaml` keeps it.
// FAFF-548 — the overlay is now matched by the GLOB `.faffrc.*.yaml` (covering every
// machine-local variant) plus a `!.faffrc.example.yaml` negation placed after the glob,
// replacing the exact `.faffrc.local.yaml` literal. The glob still never matches the
// committable base `.faffrc.yaml` (no middle segment).
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

test("the canonical set is [.faffrc, .faffrc.yml, .faffrc.*.yaml, !.faffrc.example.yaml, .faff/] — .faffrc.yaml is NOT in it (FAFF-548)", () => {
  const dir = seed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    const set = [...res.added, ...res.already];
    assert.deepEqual(set.sort(), [".faff/", ".faffrc", ".faffrc.*.yaml", "!.faffrc.example.yaml", ".faffrc.yml"].sort());
    assert.ok(!set.includes(".faffrc.yaml"), "the committable base `.faffrc.yaml` must NOT be in the ignore set");
    assert.ok(!set.includes(".faffrc.local.yaml"), "the exact-local literal is replaced by the glob");
    // and the written file agrees: overlay glob ignored, base not ignored, and the
    // negation strictly follows the glob so git honours it.
    const gi = readFileSync(join(dir, ".gitignore"), "utf8");
    assert.match(gi, /^\.faffrc\.\*\.yaml$/m, "overlay glob is ignored");
    assert.doesNotMatch(gi, /^\.faffrc\.yaml$/m, "base is not ignored on a fresh bootstrap");
    const lines = gi.split("\n");
    const gIdx = lines.indexOf(".faffrc.*.yaml");
    const nIdx = lines.indexOf("!.faffrc.example.yaml");
    assert.ok(gIdx !== -1 && nIdx !== -1 && gIdx < nIdx, "the negation line must follow the glob line");
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
    assert.match(gi, /^\.faffrc\.\*\.yaml$/m, "the overlay glob is appended (FAFF-548)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("git semantics: real `git check-ignore` honours the glob + negation on a fresh repo (FAFF-548)", () => {
  // The string/order selftest is deliberately git-free; this test closes the gap by
  // asserting git ITSELF interprets the written patterns as intended — a broken glob
  // syntax that still passes the string check would fail here. Mirrors the spec's
  // Integration smoke test + the "From HOW" DoD (dev/local/machine ignored, base +
  // example tracked).
  const dir = seed();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    run(dir, "gitignore-ensure");
    const ignored = (f) => {
      try { execFileSync("git", ["check-ignore", "-q", f], { cwd: dir }); return true; }
      catch (e) { if (e.status === 1) return false; throw e; }
    };
    assert.ok(ignored(".faffrc.dev.yaml"), "overlay variant .faffrc.dev.yaml is ignored");
    assert.ok(ignored(".faffrc.machine.yaml"), "overlay variant .faffrc.machine.yaml is ignored");
    assert.ok(ignored(".faffrc.local.yaml"), "the classic local overlay is still ignored (via the glob)");
    assert.ok(!ignored(".faffrc.yaml"), "the committable base .faffrc.yaml is tracked");
    assert.ok(!ignored(".faffrc.example.yaml"), "the tracked template is re-included by the negation");
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
