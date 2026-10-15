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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return out;
}
function seed() { return mkdtempSync(join(tmpdir(), "faff387gi-")); }

test("the canonical root set is [.faffrc, .faffrc.yml, .faffrc.*.yaml, !.faffrc.example.yaml]; .faffrc.yaml is NOT in it (FAFF-548/FAFF-1299)", () => {
  const dir = seed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    const set = [...res.added, ...res.already];
    // FAFF-1299: the `.faff/` rules moved to the committed `.faff/.gitignore`.
    assert.deepEqual(set.sort(), [".faffrc", ".faffrc.*.yaml", "!.faffrc.example.yaml", ".faffrc.yml"].sort());
    assert.deepEqual([...res.faff_dir.added, ...res.faff_dir.already], ["/*", "!/.gitignore", "!/anchors/", "!/templates/", "!/decisions.md", "!/conventions.md"]);
    assert.ok(!set.includes(".faff/"), "a bare `.faff/` (which would block the anchors carve-out) must NOT be in the set");
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
    // FAFF-568: the anchors carve-out — everything under `.faff/` stays ignored EXCEPT
    // the committed per-PR chain anchors. FAFF-1299: the rules now live in the
    // committed `.faff/.gitignore` (anchored `/*` + `!/anchors/`), not the root file.
    assert.ok(ignored(".faff/runs/run1/events.jsonl"), "run artifacts under .faff stay ignored");
    assert.ok(ignored(".faff/logs/2026-07-23/x.md"), "logs under .faff stay ignored");
    assert.ok(!ignored(".faff/anchors/run1/FAFF-1/events.jsonl"), "the anchors carve-out is committable (FAFF-568)");
    // FAFF-796: the git-only run-level anchor (`faff events anchor-run`, per ADR 0109) reuses
    // this SAME `.faff/anchors/<run>/<issue>/` tree — verify-only, no new gitignore line, since
    // the shape is structurally identical to the per-PR anchor above (a run id in place of a PR
    // run dir name is not a new path shape git's glob distinguishes).
    assert.ok(ignored(".faff/runs/run-20260815-084759-beepboop-list/events.jsonl"), "the live (ephemeral) run dir the anchor is minted FROM stays ignored");
    assert.ok(!ignored(".faff/anchors/run-20260815-084759-beepboop-list/FAFF-796/events.jsonl"), "the git-only run-level anchor tree is committable via the SAME carve-out (FAFF-796, no new gitignore line)");
    assert.ok(!ignored(".faff/anchors/run-20260815-084759-beepboop-list/FAFF-796/chain-head.json"), "…including its witness");
    assert.ok(!ignored(".faff/anchors/run-20260815-084759-beepboop-list/summary.md"), "…and the run-level summary.md sitting one level up");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("idempotent: a second run is a byte-identical no-op", () => {
  const dir = seed();
  try {
    run(dir, "gitignore-ensure");
    const first = readFileSync(join(dir, ".gitignore"));
    const firstFaff = readFileSync(join(dir, ".faff", ".gitignore"));
    run(dir, "gitignore-ensure");
    assert.deepEqual(readFileSync(join(dir, ".gitignore")), first, ".gitignore byte-identical after a re-run");
    assert.deepEqual(readFileSync(join(dir, ".faff", ".gitignore")), firstFaff, ".faff/.gitignore byte-identical after a re-run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// FAFF-1062 — `--local` targets `.git/info/exclude` with a distinct pattern set:
// the shared set PLUS `.faffrc.yaml`, MINUS the `!.faff/anchors/` carve-out
// (`.faff/` is ignored wholesale — a personal exclude file has no committed
// subtree to protect).
// ---------------------------------------------------------------------------

function gitSeed() {
  // macOS: $TMPDIR (/var/folders) is a symlink to /private/var/folders; the CLI
  // returns its resolved cwd, so canonicalise the seed dir to match res.path.
  const dir = realpathSync(seed());
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("--local writes .git/info/exclude with the local pattern set: .faffrc.yaml and .faff/ present, anchors carve-out absent", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--local", "--json"));
    assert.equal(res.path, join(dir, ".git", "info", "exclude"));
    const set = [...res.added, ...res.already];
    assert.deepEqual(set.sort(), [".faffrc", ".faffrc.yml", ".faffrc.yaml", ".faffrc.*.yaml", "!.faffrc.example.yaml", ".faff/"].sort());
    const raw = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    assert.match(raw, /^\.faffrc\.yaml$/m, "the base config is ignored in the local set");
    assert.match(raw, /^\.faff\/$/m, "the whole .faff dir is ignored (not .faff/*)");
    assert.doesNotMatch(raw, /^!\.faff\/anchors\/$/m, "the anchors carve-out is not written to the local set");
    // .gitignore itself is untouched by a --local run.
    assert.ok(!existsSync(join(dir, ".gitignore")), "--local must not create .gitignore");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--local preserves git's default comment preamble in .git/info/exclude and appends after it", () => {
  const dir = gitSeed();
  try {
    const before = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    assert.match(before, /^#/, "sanity: git seeded an all-comments preamble");
    run(dir, "gitignore-ensure", "--local");
    const after = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    assert.ok(after.startsWith(before), "the comment preamble is preserved byte-for-byte");
    assert.match(after, /^\.faffrc\.yaml$/m);
    assert.match(after, /^\.faff\/$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--local git semantics: check-ignore honours the local set (.faffrc.yaml ignored, .faff/ wholesale)", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure", "--local");
    const ignored = (f) => {
      try { execFileSync("git", ["check-ignore", "-q", f], { cwd: dir }); return true; }
      catch (e) { if (e.status === 1) return false; throw e; }
    };
    assert.ok(ignored(".faffrc.yaml"), "the base config IS ignored locally (personal target, unlike .gitignore)");
    assert.ok(ignored(".faffrc.dev.yaml"), "overlay variant ignored via the glob");
    assert.ok(!ignored(".faffrc.example.yaml"), "the tracked template is still re-included by the negation");
    assert.ok(ignored(".faff/anchors/run1/FAFF-1/events.jsonl"), "no anchors carve-out locally — .faff/ is ignored wholesale");
    assert.ok(ignored(".faff/runs/run1/events.jsonl"), "run artifacts under .faff stay ignored");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--local idempotent: a second run is a byte-identical no-op", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure", "--local");
    const first = readFileSync(join(dir, ".git", "info", "exclude"));
    run(dir, "gitignore-ensure", "--local");
    assert.deepEqual(readFileSync(join(dir, ".git", "info", "exclude")), first, "exclude file byte-identical after a re-run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("standard mode (no --local) writes both targets, the carve-out in .faff/.gitignore (regression), even inside a git repo", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(res.path, join(dir, ".gitignore"));
    const set = [...res.added, ...res.already];
    assert.ok(!set.includes(".faffrc.yaml"), "standard mode never ignores the committable base");
    assert.ok(!set.includes("!.faff/anchors/") && !set.includes(".faff/*"), "the root set no longer carries the .faff rules");
    assert.ok(res.faff_dir.added.includes("!/anchors/"), "the anchors carve-out lands in .faff/.gitignore");
    assert.ok(res.faff_dir.added.includes("/*"), "the contents-only glob is anchored, not .faff/");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// FAFF-1299: the `.faff/` rules live in a committed `.faff/.gitignore`.
// ---------------------------------------------------------------------------

function ignoredBy(dir, f) {
  try { return execFileSync("git", ["check-ignore", "-v", f], { cwd: dir, encoding: "utf8" }).trim(); }
  catch (e) { if (e.status === 1) return null; throw e; }
}
function isIgnored(dir, f) {
  try { execFileSync("git", ["check-ignore", "-q", f], { cwd: dir }); return true; }
  catch (e) { if (e.status === 1) return false; throw e; }
}
function seedFaffFiles(dir) {
  for (const f of [".faff/anchors/run-1/FAFF-1/events.jsonl", ".faff/runs/run-1/events.jsonl", ".faff/logs/2026-10-15/x.md"]) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), "{}\n");
  }
}
function assertFaffPolicy(dir) {
  assert.ok(isIgnored(dir, ".faff/runs/run-1/events.jsonl"), "runs ignored");
  assert.ok(isIgnored(dir, ".faff/logs/2026-10-15/x.md"), "logs ignored");
  assert.ok(!isIgnored(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), "anchors committable");
  assert.ok(!isIgnored(dir, ".faff/.gitignore"), ".faff/.gitignore committable");
}

test("FAFF-1299 git semantics: .faff/.gitignore alone ignores runs and logs, frees anchors and itself", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure");
    seedFaffFiles(dir);
    assertFaffPolicy(dir);
    assert.match(ignoredBy(dir, ".faff/runs/run-1/events.jsonl"), /^\.faff\/\.gitignore:/, "the faff file is the source");
    assert.doesNotMatch(readFileSync(join(dir, ".gitignore"), "utf8"), /^!?\.faff(?!rc)/m, "root file carries no .faff line");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1299 migration: legacy root lines are kept and .faff/.gitignore overrides them", () => {
  const dir = gitSeed();
  try {
    const legacy = ".faff/*\n!.faff/anchors/\n";
    writeFileSync(join(dir, ".gitignore"), legacy);
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    seedFaffFiles(dir);
    assertFaffPolicy(dir);
    assert.ok(readFileSync(join(dir, ".gitignore"), "utf8").startsWith(legacy), "legacy lines kept byte-for-byte");
    assert.deepEqual(res.warnings, [], ".faff/* is the correct spelling");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1299 git status lists .faff/.gitignore as an addition on a fresh repository", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure");
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
    assert.match(status, /^\?\? \.faff\/\.gitignore$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1299 partial hazard `.faff/**`: faff file is read, nested anchors stay ignored by the root line, one warning", () => {
  const dir = gitSeed();
  try {
    writeFileSync(join(dir, ".gitignore"), ".faff/**\n");
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    seedFaffFiles(dir);
    assert.equal(res.warnings.length, 1);
    assert.match(ignoredBy(dir, ".faff/.gitignore"), /^\.faff\/\.gitignore:/);
    assert.match(ignoredBy(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), /^\.gitignore:1:\.faff\/\*\*/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1299 full hazard `**/.faff/`: exits 0, writes the faff file, warns once naming the line and `.faff/*`", () => {
  const dir = gitSeed();
  try {
    writeFileSync(join(dir, ".gitignore"), "**/.faff/\n");
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.ok(existsSync(join(dir, ".faff", ".gitignore")));
    assert.equal(res.warnings.length, 1);
    assert.ok(res.warnings[0].includes("`**/.faff/`") && res.warnings[0].includes("`.faff/*`"));
    const text = run(dir, "gitignore-ensure");
    assert.match(text, /^warning: .*`\*\*\/\.faff\/`/m, "human output prints the warning after the target lines");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1299 --local creates neither .faff/.gitignore nor .faff/, and reports faff_dir null", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--local", "--json"));
    assert.equal(res.faff_dir, null);
    assert.deepEqual(res.warnings, []);
    assert.ok(!existsSync(join(dir, ".faff")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
