// FAFF-1302 — faff's config files live under `.faff/`. The resolver reads `.faff/config.yaml` and
// `.faff/config.local.yaml` first, falls back to the root `.faffrc.yaml` / `.faffrc.local.yaml`
// (deprecated, fully valid), and still throws on the legacy names. faff never moves a config file:
// the migration commands are printed to standard error for the operator to run. Exercised through
// the real CLI and the real git binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const shared = require("../plugin/skills/faff/bin/lib/shared-infra.js");

const BASE = "tracking:\n  team_key: BASE\n";
const OVERLAY = "tracking:\n  team_key: OVERLAY\n";

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}
const gitStatus = (cwd, ...args) => spawnSync("git", args, { cwd }).status;

function repo(files = {}, { init = true } = {}) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "faff1302-")));
  if (init) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "t@t.test");
    git(dir, "config", "user.name", "t");
  }
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
const cleanup = (...dirs) => dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
const cli = (dir, ...args) => runCli(args, { cwd: dir });

// --- resolver ------------------------------------------------------------------

test("constants: preferred names under .faff/, deprecated root names, legacy names unchanged", () => {
  assert.equal(shared.CANONICAL_CONFIG, ".faff/config.yaml");
  assert.equal(shared.CANONICAL_OVERLAY_CONFIG, ".faff/config.local.yaml");
  assert.equal(shared.CANONICAL_EXAMPLE_CONFIG, ".faff/config.example.yaml");
  assert.deepEqual(shared.DEPRECATED_CONFIG, [".faffrc.yaml"]);
  assert.deepEqual(shared.DEPRECATED_OVERLAY_CONFIG, [".faffrc.local.yaml"]);
  assert.deepEqual(shared.LEGACY_CONFIG, [".faffrc.yml", ".faffrc"]);
  assert.deepEqual(shared.LEGACY_OVERLAY_CONFIG, [".faffrc.local.yml", ".faffrc.local"]);
});

test("resolver: tiers resolve independently and the preferred path wins", () => {
  const canonical = repo({ ".faff/config.yaml": BASE });
  const deprecated = repo({ ".faffrc.yaml": BASE });
  const both = repo({ ".faff/config.yaml": BASE, ".faffrc.yaml": "tracking:\n  team_key: STALE\n" });
  const mixed = repo({ ".faff/config.yaml": BASE, ".faffrc.local.yaml": OVERLAY });
  try {
    const c = shared.findConfigLocation(canonical);
    assert.deepEqual({ name: c.name, tier: c.tier, path: c.path }, { name: ".faff/config.yaml", tier: "canonical", path: path.join(canonical, ".faff/config.yaml") });
    const d = shared.findConfigLocation(deprecated);
    assert.deepEqual({ name: d.name, tier: d.tier }, { name: ".faffrc.yaml", tier: "deprecated" });
    assert.equal(shared.findConfig(both), path.join(both, ".faff/config.yaml"));
    assert.equal(cli(both, "config", "get", "tracking.team_key").stdout.trim(), "BASE", "a key set only in the stale file never appears");
    assert.equal(shared.findConfigLocation(mixed).tier, "canonical");
    assert.equal(shared.findOverlayLocation(mixed).tier, "deprecated");
    assert.equal(cli(mixed, "config", "get", "tracking.team_key").stdout.trim(), "OVERLAY", "a canonical base plus a deprecated overlay merge as a pair would");
    assert.equal(shared.findConfig(repo({}, { init: false })), null);
  } finally { cleanup(canonical, deprecated, both, mixed); }
});

test("resolver: findConfig and findOverlay still return a bare absolute path or null", () => {
  const dir = repo({ ".faffrc.yaml": BASE });
  try {
    assert.equal(shared.findConfig(dir), path.join(dir, ".faffrc.yaml"));
    assert.equal(shared.findOverlay(dir), null);
  } finally { cleanup(dir); }
});

test("resolver: a legacy name still throws, even beside a preferred-path config", () => {
  const dir = repo({ ".faff/config.yaml": BASE, ".faffrc.yml": BASE });
  const overlay = repo({ ".faff/config.local.yaml": OVERLAY, ".faffrc.local": OVERLAY });
  try {
    assert.throws(() => shared.findConfigLocation(dir), (e) => e.message === "legacy-config-name" && e.legacy.includes(".faffrc.yml"));
    assert.throws(() => shared.findOverlayLocation(overlay), (e) => e.message === "legacy-overlay-config-name");
    const r = cli(dir, "config", "path");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /legacy config filename found \(\.faffrc\.yml\)/);
  } finally { cleanup(dir, overlay); }
});

test("resolver: the `.example` skip holds, so .faff/config.example.yaml is never resolved as a base config", () => {
  const dir = repo({ ".faff/config.example.yaml": BASE });
  try {
    assert.equal(shared.findConfig(dir), null);
    assert.equal(shared.findNamedIn(dir, ".faff/config.example.yaml", [], [], "x"), null);
    assert.equal(cli(dir, "config", "path").code, 3);
  } finally { cleanup(dir); }
});

test("isInsideRoot: inside, sibling outside, and a prefix that is not a path segment", () => {
  assert.equal(shared.isInsideRoot("/repo", "/repo/.faff/config.yaml"), true);
  assert.equal(shared.isInsideRoot("/repo", "/other/repo/.faff/config.yaml"), false);
  assert.equal(shared.isInsideRoot("/repo", "/repo-other/.faff/config.yaml"), false);
  assert.equal(shared.isInsideRoot("/repo", "/repo/../elsewhere/x"), false);
});

// --- standard output belongs to the caller ----------------------------------------

test("deprecated tier: `config get` prints the bare scalar and nothing else, on stdout and stderr", () => {
  const dir = repo({ ".faffrc.yaml": BASE });
  try {
    const r = cli(dir, "config", "get", "tracking.team_key");
    assert.equal(r.code, 0);
    assert.equal(r.stdout, "BASE\n");
    assert.equal(r.stderr, "");
  } finally { cleanup(dir); }
});

test("deprecated tier: `config path` prints both root paths on stdout and the notice, naming git mv and mv, on stderr", () => {
  const dir = repo({ ".faffrc.yaml": BASE, ".faffrc.local.yaml": OVERLAY, ".gitignore": ".faffrc\n.faffrc.yml\n.faffrc.*.yaml\n!.faffrc.example.yaml\n" });
  try {
    const r = cli(dir, "config", "path");
    assert.equal(r.code, 0);
    assert.deepEqual(r.stdout.trim().split("\n"), [path.join(dir, ".faffrc.yaml"), path.join(dir, ".faffrc.local.yaml")]);
    assert.ok(r.stderr.includes("git mv .faffrc.yaml .faff/config.yaml"));
    assert.ok(r.stderr.includes("To migrate:  mv .faffrc.local.yaml .faff/config.local.yaml"));
    assert.ok(r.stderr.includes("plain mv, not git mv: the overlay is untracked and may hold machine-local values"));
    const resolved = cli(dir, "config", "resolved");
    assert.match(resolved.stdout, /^config:\s+.*\.faffrc\.yaml$/m);
    assert.ok(!resolved.stdout.includes("To migrate"), "the notice is never on stdout");
    assert.ok(resolved.stderr.includes("git mv .faffrc.yaml .faff/config.yaml"));
  } finally { cleanup(dir); }
});

test("the notice never fires on a preferred-tier repository, and `config path` with no config still exits 3", () => {
  const dir = repo({ ".faff/config.yaml": BASE });
  const empty = repo({});
  try {
    const r = cli(dir, "config", "path");
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), path.join(dir, ".faff/config.yaml"));
    assert.equal(r.stderr, "");
    const none = cli(empty, "config", "path");
    assert.equal(none.code, 3);
    assert.equal(none.stdout, "");
  } finally { cleanup(dir, empty); }
});

test("notice remedy: a destination whose ignore posture is wrong names `faff gitignore-ensure` before the move", () => {
  const rootLines = ".faffrc\n.faffrc.yml\n.faffrc.*.yaml\n!.faffrc.example.yaml\n";
  const overlay = repo({ ".faffrc.local.yaml": OVERLAY, ".gitignore": rootLines });
  const base = repo({ ".faffrc.yaml": BASE, ".gitignore": ".faff/*\n" });
  const fine = repo({ ".faffrc.yaml": BASE });
  const outside = repo({ ".faffrc.yaml": BASE }, { init: false });
  try {
    const o = cli(overlay, "config", "path").stderr;
    assert.ok(o.indexOf("faff gitignore-ensure") !== -1 && o.indexOf("faff gitignore-ensure") < o.indexOf("To migrate"));
    assert.ok(o.includes("would leave an operator-private file stageable"));
    const b = cli(base, "config", "path").stderr;
    assert.ok(b.indexOf("faff gitignore-ensure") !== -1 && b.indexOf("faff gitignore-ensure") < b.indexOf("git mv"));
    assert.ok(b.includes("would leave the base config uncommittable"));
    assert.ok(!cli(fine, "config", "path").stderr.includes("gitignore-ensure"), "correct posture prints the move alone");
    const out = cli(outside, "config", "path");
    assert.equal(out.code, 0);
    assert.ok(!out.stderr.includes("gitignore-ensure") && out.stderr.includes("git mv .faffrc.yaml .faff/config.yaml"), "outside a git repo the move prints alone");
  } finally { cleanup(overlay, base, fine, outside); }
});

// --- writers -----------------------------------------------------------------------

test("writers: init creates .faff/ and .faff/config.yaml, and --local writes .faff/config.local.yaml", () => {
  const dir = repo({});
  try {
    const r = cli(dir, "config", "init", "--set", "tracking.team_key=SMOKE");
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /created \.faff\/config\.yaml with 1 key/);
    assert.ok(existsSync(path.join(dir, ".faff/config.yaml")) && !existsSync(path.join(dir, ".faffrc.yaml")));
    const local = cli(dir, "config", "init", "--local", "--set", "tracking.team_key=LOCAL");
    assert.equal(local.code, 0, local.stderr);
    assert.ok(existsSync(path.join(dir, ".faff/config.local.yaml")));
    assert.equal(cli(dir, "config", "get", "tracking.team_key").stdout, "LOCAL\n");
  } finally { cleanup(dir); }
});

test("writers: set and unset on a deprecated-tier repo edit the root file in place, move nothing, and notice on stderr", () => {
  const dir = repo({ ".faffrc.yaml": "tracking:\n  repo: a/b\nappetite: low\n" });
  try {
    git(dir, "add", ".faffrc.yaml");
    git(dir, "commit", "-q", "-m", "seed");
    const set = cli(dir, "config", "set", "logging", "full");
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /to \.faffrc\.yaml\./);
    assert.ok(set.stderr.includes("git mv .faffrc.yaml .faff/config.yaml"));
    assert.ok(!set.stdout.includes("To migrate"));
    assert.equal(existsSync(path.join(dir, ".faff/config.yaml")), false, "no second base config appears");
    assert.equal(existsSync(path.join(dir, ".faff")), false, ".faff/ is not even created");
    assert.equal(git(dir, "status", "--porcelain").trim(), "M .faffrc.yaml", "git sees only the modified deprecated file");
    const unset = cli(dir, "config", "unset", "appetite");
    assert.equal(unset.code, 0, unset.stderr);
    assert.match(unset.stdout, /removed appetite from \.faffrc\.yaml/);
    assert.ok(unset.stderr.includes("git mv .faffrc.yaml .faff/config.yaml"));
    assert.equal(existsSync(path.join(dir, ".faff")), false);
    assert.equal(git(dir, "status", "--porcelain").trim(), "M .faffrc.yaml");
  } finally { cleanup(dir); }
});

test("writers: a deprecated-tier overlay is edited in place via --local", () => {
  const dir = repo({ ".faffrc.local.yaml": OVERLAY });
  try {
    const r = cli(dir, "config", "set", "logging", "full", "--local");
    assert.equal(r.code, 0, r.stderr);
    assert.match(readFileSync(path.join(dir, ".faffrc.local.yaml"), "utf8"), /logging: full/);
    assert.equal(existsSync(path.join(dir, ".faff")), false);
    assert.ok(r.stderr.includes("To migrate:  mv .faffrc.local.yaml .faff/config.local.yaml"));
  } finally { cleanup(dir); }
});

test("writers: `.faff` existing as a regular file is a clean exit 2, not a stack trace", () => {
  const dir = repo({ ".faff": "not a directory\n" });
  try {
    const r = cli(dir, "config", "set", "logging", "full");
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes("    at "), "no stack trace");
  } finally { cleanup(dir); }
});

// FAFF-1321 — the EEXIST/ENOTDIR catch is narrowed to the config-write mkdir. `config init`,
// `config set` and `config unset` (every write verb) still exit 2 cleanly when `.faff` is a file,
// now naming the config directory as an existing file; an EEXIST/ENOTDIR from any OTHER op (the
// `--create` docs-path mkdir) falls through to its pre-FAFF-1302 stack trace, no longer over-claimed.

test("writers: `.faff` as a regular file makes `config init` a clean exit 2 that names the directory", () => {
  const dir = repo({ ".faff": "not a directory\n" });
  try {
    const r = cli(dir, "config", "init", "--set", "team_key=SHF");
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes("    at "), "no stack trace");
    assert.ok(/cannot create the config directory/.test(r.stderr), "names the config directory as a file");
    assert.ok(r.stderr.includes(".faff"), "mentions the .faff path");
  } finally { cleanup(dir); }
});

test("writers: `.faff` as a regular file makes `config unset` a clean exit 2 that names the directory", () => {
  // unset reaches writeConfigFile only when a config resolves (here via the main-worktree
  // fallback) and the write target is the worktree-local canonical `.faff/config.yaml`; with
  // `.faff` a regular file in the worktree, that mkdir fails exactly as init/set's does.
  const { parent, wt } = worktreePair({ ".faff/config.yaml": BASE });
  try {
    writeFileSync(path.join(wt, ".faff"), "not a directory\n");
    const r = cli(wt, "config", "unset", "tracking.team_key");
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes("    at "), "no stack trace");
    assert.ok(/cannot create the config directory/.test(r.stderr), "names the config directory as a file");
  } finally { cleanup(parent); }
});

test("writers: `.faff` as a regular file makes `config set --local` (overlay target) a clean exit 2", () => {
  const dir = repo({ ".faff": "not a directory\n" });
  try {
    const r = cli(dir, "config", "set", "logging", "full", "--local");
    assert.equal(r.code, 2);
    assert.ok(!r.stderr.includes("    at "), "no stack trace");
    assert.ok(/cannot create the config directory/.test(r.stderr), "names the config directory as a file");
  } finally { cleanup(dir); }
});

test("writers: a non-write `--create` mkdir ENOTDIR is NOT over-claimed as the config-dir clean exit 2", () => {
  // No `.faff` present; `docs` exists as a regular file, so `spec-docs-path --create`'s mkdir of
  // docs/specs raises ENOTDIR from resolveDocsPath — a different op than the config-write mkdir.
  // After the narrowing it must fall through (a stack trace / non-2 exit), confirming the catch
  // no longer over-claims every EEXIST/ENOTDIR in the try body.
  const dir = repo({ "docs": "i am a file, not a directory\n" });
  try {
    const r = cli(dir, "config", "spec-docs-path", "--create");
    assert.notEqual(r.code, 2, "a non-write ENOTDIR is not reported as the config-dir clean exit 2");
    assert.ok(r.stderr.includes("    at "), "falls through to a Node stack trace (pre-FAFF-1302 behaviour)");
  } finally { cleanup(dir); }
});

// --- linked worktree ------------------------------------------------------------------

function worktreePair(mainFiles) {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "faff1302w-")));
  const main = path.join(parent, "repo");
  mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "config", "user.email", "t@t.test");
  git(main, "config", "user.name", "t");
  writeFileSync(path.join(main, "README.md"), "x\n");
  git(main, "add", "README.md");
  git(main, "commit", "-q", "-m", "init");
  for (const [rel, text] of Object.entries(mainFiles)) {
    mkdirSync(path.dirname(path.join(main, rel)), { recursive: true });
    writeFileSync(path.join(main, rel), text);
  }
  const wt = path.join(parent, "wt");
  git(main, "worktree", "add", "-q", "--detach", wt);
  return { parent, main, wt };
}

test("worktree: a base resolved from the main checkout is written at the worktree's own .faff/config.yaml, never the main checkout's", () => {
  const { parent, main, wt } = worktreePair({ ".faff/config.yaml": BASE });
  try {
    const before = readFileSync(path.join(main, ".faff/config.yaml"), "utf8");
    const r = cli(wt, "config", "set", "logging", "full");
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(path.join(wt, ".faff/config.yaml")), "written under the worktree");
    assert.equal(readFileSync(path.join(main, ".faff/config.yaml"), "utf8"), before, "the main checkout's file is untouched");
  } finally { cleanup(parent); }
});

test("worktree: `config check` skips posture for a base resolved outside the worktree, names it, and never asks git about it", () => {
  const { parent, main, wt } = worktreePair({ ".faff/config.yaml": BASE });
  try {
    const r = cli(wt, "config", "check", "--json");
    const parsed = JSON.parse(r.stdout);
    assert.ok(!parsed.findings.some((f) => /unmigrated|NOT git-ignored/.test(f.message)), "no base-posture finding");
    assert.ok(parsed.skipped.some((s) => s.includes(path.join(main, ".faff/config.yaml"))), "the skipped entry names the out-of-tree path");
    const everything = JSON.stringify(parsed);
    assert.ok(!/(^|[\\/"\s])\.\.[\\/]/.test(everything), "no `..` segment anywhere in the output");
    assert.ok(!r.stderr.includes("fatal"), "git never refused a path outside the repository");
  } finally { cleanup(parent); }
});

// --- config check ----------------------------------------------------------------------

test("config check: a migrated, committed repo with the real writer's .faff/.gitignore is clean", () => {
  const dir = repo({ ".faff/config.yaml": BASE, ".faff/config.local.yaml": OVERLAY });
  try {
    assert.equal(cli(dir, "gitignore-ensure").code, 0);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "config");
    assert.equal(git(dir, "ls-files", ".faff").includes("config.local.yaml"), false, "the overlay was never staged");
    const r = cli(dir, "config", "check");
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /config check: clean/);
  } finally { cleanup(dir); }
});

test("config check: both tiers present warn with the stale file named and git rm / rm remedies; deprecated tier warns with the move", () => {
  const dup = repo({ ".faff/config.yaml": BASE, ".faffrc.yaml": BASE, ".faff/config.local.yaml": OVERLAY, ".faffrc.local.yaml": OVERLAY });
  const old = repo({ ".faffrc.yaml": BASE });
  try {
    cli(dup, "gitignore-ensure");
    const findings = JSON.parse(cli(dup, "config", "check", "--json").stdout).findings;
    const base = findings.find((f) => f.surface === ".faff/config.yaml" && /two base configs/.test(f.message));
    const overlay = findings.find((f) => f.surface === ".faff/config.local.yaml" && /two overlay configs/.test(f.message));
    assert.ok(base && base.severity === "warn" && base.message.includes("git rm .faffrc.yaml"));
    assert.ok(overlay && overlay.severity === "warn" && overlay.message.includes("rm .faffrc.local.yaml") && !overlay.message.includes("git rm"));
    const dep = JSON.parse(cli(old, "config", "check", "--json").stdout).findings.find((f) => /deprecated location/.test(f.message));
    assert.ok(dep && dep.severity === "warn" && dep.message.includes("git mv .faffrc.yaml .faff/config.yaml"));
  } finally { cleanup(dup, old); }
});

// --- lint ----------------------------------------------------------------------------------

test("validate-adapters HANDREAD flags a shell read of the new paths and the deprecated ones", () => {
  const run = (line) => {
    const dir = mkdtempSync(path.join(tmpdir(), "faff1302l-"));
    mkdirSync(path.join(dir, "zz-handread"));
    writeFileSync(path.join(dir, "zz-handread", "SKILL.md"), line + "\n");
    const r = runCli(["validate-adapters", "--skills-dir", dir]);
    rmSync(dir, { recursive: true, force: true });
    return r;
  };
  for (const line of ["cat .faff/config.yaml", "grep slots .faff/config.local.yaml", "sed -n 1p .faffrc.yaml"]) {
    const r = run(line);
    assert.match(r.stdout, /hand-reads the rc file/, line);
    assert.notEqual(r.code, 0, line);
  }
  assert.doesNotMatch(run("cat .faff/config.example.yaml").stdout, /hand-reads the rc file/, "the .example line skip still exempts the template");
});
