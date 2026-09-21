// FAFF-1063 — faff-onboard's local-mode flow. Onboard resolves one boolean (`local`)
// and threads it, unchanged, to the FAFF-1062 `--local` writers: `config init`,
// `config set`, `gitignore-ensure`, `hooks-ensure`. The onboard prompt flow itself is
// skill prose (no CLI), so these tests drive the exact mechanical CLI sequence the
// skill's SKILL.md prose describes (mirroring test/decline-parity.test.mjs), against
// the real CLI on a throwaway git repo.
//
// Fidelity note: same as decline-parity.test.mjs — every invocation runs with
// `cwd = root` and NO `--root`, exercising findRoot()'s cwd-based resolution exactly
// as the onboard prose's bare `"$faff" config …` forms rely on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// Run the real faff CLI with cwd = root and NO --root (see fidelity note above).
function run(args, root, { allowFail = false } = {}) {
  try { return { code: 0, out: execFileSync("node", [CLI, ...args], { encoding: "utf8", cwd: root }) }; }
  catch (e) { if (!allowFail) throw e; return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() }; }
}

function git(root, ...args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.status}`);
  return r.stdout;
}

function seedGitRepo() {
  const root = mkdtempSync(join(tmpdir(), "onboard-local-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "t@t.test");
  git(root, "config", "user.name", "t");
  return root;
}

const overlayPath = (root) => join(root, ".faffrc.local.yaml");
const basePath = (root) => join(root, ".faffrc.yaml");
const gitignorePath = (root) => join(root, ".gitignore");
const excludePath = (root) => join(root, ".git", "info", "exclude");
const settingsLocalPath = (root) => join(root, ".claude", "settings.local.json");
const settingsPath = (root) => join(root, ".claude", "settings.json");

function readSettings(p) { return JSON.parse(readFileSync(p, "utf8")); }
function stopCmds(s) { return (s.hooks?.Stop ?? []).flatMap((g) => (g.hooks ?? []).map((h) => h.command)); }

// The exact local-mode mechanical sequence the SKILL.md prose drives (§4 the two-write
// split, §5 the threaded ensurers): config init (tracking + label_prefix, --local),
// config set (bundle_store, --local), gitignore-ensure --local, hooks-ensure --local.
function localSequence(root, { teamKey = "SHF", labelPrefix = "SHF" } = {}) {
  run(["config", "init", "--set", `tracking.team_key=${teamKey}`, "--set", `tracking.label_prefix=${labelPrefix}`, "--local"], root);
  run(["config", "set", "bundle_store", "local", "--local"], root);
  run(["gitignore-ensure", "--local"], root);
  return JSON.parse(run(["hooks-ensure", "--local", "--json"], root).out);
}

// The standard-mode mechanical sequence (no --local anywhere) — the byte-for-byte
// regression baseline.
function standardSequence(root, { teamKey = "SHF" } = {}) {
  run(["config", "init", "--set", `tracking.team_key=${teamKey}`], root);
  run(["gitignore-ensure"], root);
  return JSON.parse(run(["hooks-ensure", "--json"], root).out);
}

test("--local fresh-repo sequence writes the overlay + local targets, and nothing standard", () => {
  const root = seedGitRepo();
  try {
    const hooksResult = localSequence(root);

    // Overlay carries both pinned values; no committable base exists.
    assert.equal(existsSync(overlayPath(root)), true, ".faffrc.local.yaml exists");
    const overlay = readFileSync(overlayPath(root), "utf8");
    assert.match(overlay, /^bundle_store:\s*local\s*$/m, "top-level bundle_store: local");
    assert.match(overlay, /^\s*label_prefix:\s*SHF\s*$/m, "tracking.label_prefix: SHF");
    assert.equal(existsSync(basePath(root)), false, ".faffrc.yaml is never created in local mode");

    // config path resolves the overlay as the only config, exit 0.
    const p = run(["config", "path"], root, { allowFail: true });
    assert.equal(p.code, 0, "config path exits 0 once the overlay exists");
    assert.match(p.out, /\.faffrc\.local\.yaml/, "config path prints the overlay");

    // Standard targets are untouched.
    assert.equal(existsSync(gitignorePath(root)), false, ".gitignore is not created by a --local run");
    assert.equal(existsSync(settingsPath(root)), false, ".claude/settings.json is not created by a --local run");

    // .git/info/exclude carries the faff local patterns (FAFF_GITIGNORE_PATTERNS_LOCAL).
    const exclude = readFileSync(excludePath(root), "utf8");
    assert.match(exclude, /^\.faffrc\.yaml$/m, "exclude covers the committable base name");
    assert.match(exclude, /^\.faffrc\.\*\.yaml$/m, "exclude covers the overlay glob");
    assert.match(exclude, /^\.faff\/$/m, "exclude covers .faff/ wholesale");

    // .claude/settings.local.json carries both Stop hooks.
    assert.equal(existsSync(settingsLocalPath(root)), true, ".claude/settings.local.json exists");
    assert.ok(hooksResult.added.includes("runcheck") && hooksResult.added.includes("prepcheck"),
      "runcheck + prepcheck are freshly registered in the local target");
    const cmds = stopCmds(readSettings(settingsLocalPath(root)));
    assert.ok(cmds.some((c) => /runcheck --hook/.test(c)), "a Stop command invokes `runcheck --hook`");
    assert.ok(cmds.some((c) => /prepcheck --hook/.test(c)), "a Stop command invokes `prepcheck --hook`");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a resolved label_prefix renders control labels under that prefix, not the faff- default", () => {
  const root = seedGitRepo();
  try {
    localSequence(root, { teamKey: "SHF", labelPrefix: "SHF" });
    const names = run(["labels", "--names"], root).out.split("\n").filter(Boolean);
    assert.ok(names.includes("SHF-automate"), "control labels render under the configured prefix");
    assert.ok(!names.includes("faff-automate"), "the faff- default prefix is not used once label_prefix is set");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("LABEL_PREFIX_RE refuses an invalid prefix at write time — nothing is persisted", () => {
  const root = seedGitRepo();
  try {
    const r = run(["config", "init", "--set", "tracking.team_key=SHF", "--set", "tracking.label_prefix=bad prefix!", "--local"], root, { allowFail: true });
    assert.notEqual(r.code, 0, "an invalid label_prefix is refused, not silently accepted");
    assert.equal(existsSync(overlayPath(root)), false, "no overlay is written on a refused set");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a committed, git-tracked base is left byte-for-byte unmodified when local mode writes alongside it", () => {
  const root = seedGitRepo();
  try {
    const baseText = "tracking:\n  team_key: SHF\n  repo: shftwst/faff\n";
    writeFileSync(basePath(root), baseText);
    git(root, "add", ".faffrc.yaml");
    git(root, "commit", "-q", "-m", "seed committed base");

    // The precondition local mode's bail-override checks: the base is git-tracked.
    const tracked = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", ".faffrc.yaml"], { encoding: "utf8" });
    assert.equal(tracked.status, 0, "the seeded base is git-tracked");

    localSequence(root);

    // Base untouched, overlay written alongside it — non-destructive by construction
    // (the --local writers target the overlay exclusively, never the base).
    assert.equal(readFileSync(basePath(root), "utf8"), baseText, ".faffrc.yaml is byte-for-byte unmodified");
    assert.equal(existsSync(overlayPath(root)), true, ".faffrc.local.yaml is written alongside the untouched base");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("standard-mode sequence is unaffected: writes the base + shared targets, creates no local artifacts", () => {
  const root = seedGitRepo();
  try {
    const hooksResult = standardSequence(root);

    assert.equal(existsSync(basePath(root)), true, ".faffrc.yaml is written");
    assert.equal(existsSync(gitignorePath(root)), true, ".gitignore is written");
    assert.equal(existsSync(settingsPath(root)), true, ".claude/settings.json is written");
    assert.ok(hooksResult.added.includes("runcheck") && hooksResult.added.includes("prepcheck"),
      "standard mode still registers both Stop hooks, in the shared target");

    // git itself creates .git/info/exclude at `git init` (a comment-only preamble) — the
    // invariant is that standard mode never appends faff's local block to it, not that
    // the file is absent.
    const excludeAfterStandard = existsSync(excludePath(root)) ? readFileSync(excludePath(root), "utf8") : "";
    assert.doesNotMatch(excludeAfterStandard, /^\.faffrc\.yaml$/m, "standard mode writes no faff local-mode block to .git/info/exclude");
    assert.equal(existsSync(overlayPath(root)), false, "standard mode never creates .faffrc.local.yaml");
    assert.equal(existsSync(settingsLocalPath(root)), false, "standard mode never creates settings.local.json");

    const base = readFileSync(basePath(root), "utf8");
    assert.doesNotMatch(base, /label_prefix/, "standard mode never sets tracking.label_prefix");
    assert.doesNotMatch(base, /bundle_store/, "standard mode never sets bundle_store");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
