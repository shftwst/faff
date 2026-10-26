// FAFF-387 — two-file merged config resolution (.faff/config.local.yaml overlay over
// .faff/config.yaml base over DEFAULTS) + `faff config check` + `config path`/`resolved`.
// Exercised through the REAL CLI on the filesystem, so the whole read path is covered
// (findConfig/findOverlay → deepMergeConfig → dig), not just the pure helpers.
//
// Back-compat is load-bearing: the no-overlay cases assert byte-for-byte the
// pre-FAFF-387 single-file behaviour (the existing config tests stay green unchanged;
// this file adds the explicit back-compat assertion the spec's §8 DONE requires).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const { gitignoreDirHazardLines, FAFF_DIR_GITIGNORE_PATTERNS } = createRequire(import.meta.url)("../plugin/skills/faff/bin/lib/gitignore-ensure.js");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString() };
  }
}

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

// A plain (non-git) tmp dir with the given files written.
function plainDir({ base, overlay } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff387-"));
  if (base != null || overlay != null) mkdirSync(join(dir, ".faff"), { recursive: true });
  if (base != null) writeFileSync(join(dir, ".faff/config.yaml"), base);
  if (overlay != null) writeFileSync(join(dir, ".faff/config.local.yaml"), overlay);
  return dir;
}

// A real git repo (findRoot anchors on .git; posture probes need a repo) with files.
// commitBase also commits `.faff/.gitignore` (the real writer's pattern set) when a config file
// exists, unless faffGitignore is false: it is what keeps the base committable and the overlay ignored.
function gitDir({ base, overlay, gitignore, commitBase, faffGitignore = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "faff387g-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@t.test");
  git(dir, "config", "user.name", "t");
  if (gitignore != null) writeFileSync(join(dir, ".gitignore"), gitignore);
  if (base != null || overlay != null) mkdirSync(join(dir, ".faff"), { recursive: true });
  if (base != null) writeFileSync(join(dir, ".faff/config.yaml"), base);
  if (overlay != null) writeFileSync(join(dir, ".faff/config.local.yaml"), overlay);
  if (commitBase) {
    if (faffGitignore && (base != null || overlay != null)) {
      writeFileSync(join(dir, ".faff/.gitignore"), FAFF_DIR_GITIGNORE_PATTERNS.join("\n") + "\n");
      git(dir, "add", ".faff/.gitignore");
    }
    if (base != null) git(dir, "add", ".faff/config.yaml");
    if (gitignore != null) git(dir, "add", ".gitignore");
    git(dir, "commit", "-q", "--allow-empty", "-m", "init");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Merge semantics
// ---------------------------------------------------------------------------

test("merge: overlay overrides a nested leaf; the sibling leaf still resolves from base", () => {
  const dir = plainDir({
    base: "slots:\n  spec: base-spec\n  review: base-review\n",
    overlay: "slots:\n  review: overlay-review\n",
  });
  try {
    assert.equal(run(dir, "config", "get", "slots.review").out, "overlay-review", "overridden leaf ← overlay");
    assert.equal(run(dir, "config", "get", "slots.spec").out, "base-spec", "sibling leaf ← base");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("merge: overlay replaces a sequence WHOLESALE (never element-merged)", () => {
  const dir = plainDir({
    base: "hosts:\n  - alpha\n  - beta\n  - gamma\n",
    overlay: "hosts:\n  - only\n",
  });
  try {
    assert.deepEqual(JSON.parse(run(dir, "config", "get", "--json", "hosts").out), ["only"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("merge: an overlay-only key is added; a base-only key survives", () => {
  const dir = plainDir({
    base: "appetite: high\n",
    overlay: "logging: essential\n",
  });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "high");
    assert.equal(run(dir, "config", "get", "logging").out, "essential");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("overlay-only, no base file → valid (all-overlay config), exit 0", () => {
  const dir = plainDir({ overlay: "appetite: low\n" });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "low");
    const p = run(dir, "config", "path");
    assert.equal(p.code, 0);
    assert.match(p.out, /\.faff\/config\.local\.yaml$/, "path prints the overlay");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Back-compat: no overlay → byte-for-byte the single-file behaviour
// ---------------------------------------------------------------------------

test("back-compat: no overlay → config get / dump identical to single-file behaviour", () => {
  const yaml = "slots:\n  spec: x\n  review: y\nappetite: full\n";
  const dir = plainDir({ base: yaml });
  try {
    assert.equal(run(dir, "config", "get", "slots.spec").out, "x");
    assert.equal(run(dir, "config", "get", "appetite").out, "full");
    // dump is the parsed base document, unchanged.
    assert.deepEqual(JSON.parse(run(dir, "config", "dump").out), { slots: { spec: "x", review: "y" }, appetite: "full" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("back-compat: no overlay → `config path` is a single line; `config resolved` has NO `config local:` line", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n" });
  try {
    const p = run(dir, "config", "path");
    assert.equal(p.out.split("\n").length, 1, "single line");
    assert.match(p.out, /\.faff\/config\.yaml$/);
    const r = run(dir, "config", "resolved");
    assert.doesNotMatch(r.out, /config local:/, "no overlay line when no overlay");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("neither file → config path exit 3 (first-run offer semantics preserved)", () => {
  const dir = plainDir({});
  try {
    assert.equal(run(dir, "config", "path").code, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// config path multi-line + config resolved both paths
// ---------------------------------------------------------------------------

test("config path is multi-line (base first, overlay second) when both exist", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "appetite: low\n" });
  try {
    const lines = run(dir, "config", "path").out.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /\.faff\/config\.yaml$/);
    assert.match(lines[1], /\.faff\/config\.local\.yaml$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config resolved echoes both `config:` and `config local:` paths", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "appetite: low\n" });
  try {
    const r = run(dir, "config", "resolved");
    assert.match(r.out, /config:\s+.*\.faff\/config\.yaml/);
    assert.match(r.out, /config local:\s+.*\.faff\/config\.local\.yaml/);
    assert.match(r.out, /appetite: low/, "resolved appetite is the merged (overlay) value");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Overlay parse error → LOUD exit 2 (never a silent skip)
// ---------------------------------------------------------------------------

test("overlay that is a top-level sequence (malformed) → exit 2 on every read path", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n", overlay: "- a\n- b\n" });
  try {
    for (const sub of [["config", "get", "slots.spec"], ["config", "dump"], ["config", "resolved"], ["config", "check"]]) {
      const r = run(dir, ...sub);
      assert.equal(r.code, 2, `${sub.join(" ")} → exit 2`);
      assert.match(r.err, /parse/i, "loud stderr names the parse failure");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("comment-only / empty overlay is allowed (valid no-op overlay), exit 0", () => {
  const dir = plainDir({ base: "appetite: high\n", overlay: "# just a comment\n" });
  try {
    assert.equal(run(dir, "config", "get", "appetite").out, "high");
    assert.equal(run(dir, "config", "get", "appetite").code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("legacy-shaped overlay name (.faffrc.local.yml) → loud exit 2, never a silent load", () => {
  const dir = mkdtempSync(join(tmpdir(), "faff387l-"));
  mkdirSync(join(dir, ".faff"));
  try {
    writeFileSync(join(dir, ".faff/config.yaml"), "appetite: high\n");
    writeFileSync(join(dir, ".faffrc.local.yml"), "appetite: low\n");
    const r = run(dir, "config", "get", "appetite");
    assert.equal(r.code, 2);
    assert.match(r.err, /legacy overlay/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// config check — posture, secret redaction, exit codes
// ---------------------------------------------------------------------------

test("config check --selftest passes (secret + merge + posture tables)", () => {
  const dir = plainDir({});
  try { assert.equal(run(dir, "config", "check", "--selftest").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: base present but untracked → exit 1 with a posture finding + the 3 migration steps", () => {
  const dir = gitDir({ base: "slots:\n  spec: x\n" }); // written, NOT committed
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /unmigrated|untracked|uncommitted/i);
    assert.match(r.out, /Move machine-local values/);
    assert.match(r.out, /\.faff\/\.gitignore/);
    assert.doesNotMatch(r.out, /drop the/);
    assert.match(r.out, /commit \.faff\/config\.yaml/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: base committed + overlay ignored → clean, exit 0", () => {
  const dir = gitDir({
    base: "slots:\n  spec: x\n",
    overlay: "appetite: low\n",
    gitignore: ".faff/config.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: overlay present but NOT git-ignored → hygiene finding, exit 1", () => {
  const dir = gitDir({
    base: "slots:\n  spec: x\n",
    overlay: "appetite: low\n",
    gitignore: "# empty\n",
    commitBase: true,
    faffGitignore: false,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT git-ignored/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a secret in the BASE file → exit 1, REDACTED (raw value NEVER in output)", () => {
  const RAW = "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
  const dir = gitDir({
    base: "adversarial:\n  api_key: " + RAW + "\n",
    gitignore: ".faff/config.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    // the finding names the key path + length + 4-char prefix only.
    assert.match(r.out, /adversarial\.api_key/);
    assert.match(r.out, /len=\d+/);
    // THE LOAD-BEARING ASSERTION: the raw value appears NOWHERE in stdout OR stderr.
    assert.ok(!r.out.includes(RAW), "raw secret must not appear in stdout");
    assert.ok(!r.err.includes(RAW), "raw secret must not appear in stderr");
    // and the tail past the 4-char prefix is never echoed.
    assert.ok(!r.out.includes("abcdefghij"), "no substring past the 4-char prefix");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: secret redaction holds under --json too (raw value absent)", () => {
  const RAW = "ghp_ZZZZZZZZ0123456789abcdefghijklmn";
  const dir = gitDir({ base: "token: " + RAW + "\n", gitignore: ".faff/config.local.yaml\n", commitBase: true });
  try {
    const r = run(dir, "config", "check", "--json");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(RAW), "raw secret absent from JSON output");
    const parsed = JSON.parse(r.out);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.findings.some((f) => /token/.test(f.surface)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: not a git repo → posture checks skipped (reported), parse/secret still run, exit 0 when clean", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n" }); // no .git
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0);
    assert.match(r.out, /skip.*not a git repo/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: not a git repo BUT a secret present → still exit 1 (secret scan runs regardless)", () => {
  const RAW = "AKIAIOSFODNN7EXAMPLE";
  const dir = plainDir({ base: "aws_key: " + RAW + "\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes(RAW), "raw secret absent");
    assert.match(r.out, /skip.*not a git repo/i, "posture still reported skipped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: no config at all → exit 0 (defaults)", () => {
  const dir = gitDir({});
  try { assert.equal(run(dir, "config", "check").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// config check: .faff ignore posture (FAFF-1301)
// ---------------------------------------------------------------------------

const INNER_GITIGNORE = "/*\n!/.gitignore\n!/anchors/\n!/templates/\n";

// A committed git repo with the given root .gitignore text and, optionally, a .faff/ tree.
// No config file: these cases are about ignore posture, and a base config under a hazard
// line would be ignored and add its own finding.
function faffIgnoreDir({ gitignore, faffDir = false, innerGitignore = null }) {
  const dir = gitDir({ gitignore, commitBase: true });
  if (faffDir) mkdirSync(join(dir, ".faff", "runs"), { recursive: true });
  if (innerGitignore != null) writeFileSync(join(dir, ".faff", ".gitignore"), innerGitignore);
  return dir;
}

function findingsOn(dir, surface) {
  return JSON.parse(run(dir, "config", "check", "--json").out).findings.filter((f) => f.surface === surface);
}

test("config check: root `.faff/` line → one warn on .gitignore echoing the line and naming `.faff/*`, exit 1", () => {
  const dir = faffIgnoreDir({ gitignore: ".faff/\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.gitignore:/);
    assert.ok(r.out.includes("(line: `.faff/`)"));
    assert.ok(r.out.includes("`.faff/*`"));
    assert.match(r.out, /faff gitignore-ensure` is append-only and cannot fix this/);
    assert.equal(findingsOn(dir, ".gitignore").length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: `**/.faff/` is a hazard too", () => {
  const dir = faffIgnoreDir({ gitignore: "**/.faff/\n" });
  try { assert.equal(findingsOn(dir, ".gitignore").length, 1); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: `.faff/*` with a carve-out → no .gitignore finding, no .faff/.gitignore finding, exit 0", () => {
  const dir = faffIgnoreDir({ gitignore: ".faff/*\n!.faff/anchors/\n", faffDir: true });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(findingsOn(dir, ".gitignore").length, 0);
    assert.equal(findingsOn(dir, ".faff/.gitignore").length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check --json: two hazard lines → exactly one .gitignore finding with the plural slot and only the three keys", () => {
  const dir = faffIgnoreDir({ gitignore: ".faff/\n.faff/**\n" });
  try {
    const found = findingsOn(dir, ".gitignore");
    assert.equal(found.length, 1);
    assert.ok(found[0].message.includes("(lines: `.faff/`, `.faff/**`)"));
    assert.deepEqual(Object.keys(found[0]).sort(), ["message", "severity", "surface"]);
    assert.equal(found[0].severity, "warn");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: not a git repo with a `.faff` line → over-ignore finding AND the posture skip line", () => {
  const dir = plainDir({ base: "slots:\n  spec: x\n" });
  writeFileSync(join(dir, ".gitignore"), ".faff\n");
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.gitignore:/);
    assert.match(r.out, /skip.*posture checks skipped \(not a git repo\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: no root .gitignore and no .faff/ → neither finding, exit 0", () => {
  const dir = faffIgnoreDir({});
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: .faff/ present and nothing ignores run state → one warn on .faff/.gitignore naming gitignore-ensure, exit 1", () => {
  const dir = faffIgnoreDir({ gitignore: "node_modules/\n", faffDir: true });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.faff\/\.gitignore:/);
    assert.ok(r.out.includes("faff gitignore-ensure"));
    assert.match(r.out, /Commit the file/);
    assert.equal(findingsOn(dir, ".faff/.gitignore").length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: root `.faff/*`, .faff/ present, no inner file (this repo today) → silent, exit 0", () => {
  const dir = faffIgnoreDir({ gitignore: ".faff/*\n!.faff/anchors/\n", faffDir: true });
  try { assert.equal(run(dir, "config", "check").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a correct `--local` install (.git/info/exclude has `.faff/`, no inner file) → silent, exit 0", () => {
  const dir = faffIgnoreDir({ gitignore: "", faffDir: true });
  appendFileSync(join(dir, ".git", "info", "exclude"), ".faff/\n");
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(findingsOn(dir, ".gitignore").length, 0);
    assert.equal(findingsOn(dir, ".faff/.gitignore").length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-1309 — the standing dead-carve-out finding, one real-run case (the pure predicate
// rows live in gitignore-ensure.js's own selftest and config-check.js's faffIgnore
// harness; this is the real-git proof that `faff config check` actually surfaces it).
test("config check: a hand-seeded `.faff/.gitignore` reading `!/anchors/` then `/*` is dead — one warn finding naming `!/anchors/`, and `git check-ignore` confirms the anchor is really ignored", () => {
  const dir = faffIgnoreDir({ gitignore: "", faffDir: true, innerGitignore: "!/anchors/\n/*\n" });
  try {
    git(dir, "add", "-f", ".faff/.gitignore"); git(dir, "commit", "-q", "-m", "commit inner (dead)");
    mkdirSync(join(dir, ".faff", "anchors", "run1"), { recursive: true });
    writeFileSync(join(dir, ".faff", "anchors", "run1", "a.json"), "{}\n");
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /warn +\.faff\/\.gitignore:/);
    assert.ok(r.out.includes("!/anchors/"));
    assert.ok(r.out.includes("faff gitignore-ensure"));
    assert.equal(findingsOn(dir, ".faff/.gitignore").length, 1);
    const blocked = spawnSync("git", ["check-ignore", "-q", ".faff/anchors/run1/a.json"], { cwd: dir }).status === 0;
    assert.ok(blocked, "the fault is real: git really does ignore the committed anchor");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a correctly-ordered `.faff/.gitignore` → no dead-carve-out finding, exit 0", () => {
  const dir = faffIgnoreDir({ gitignore: "", faffDir: true, innerGitignore: INNER_GITIGNORE });
  try {
    git(dir, "add", "-f", ".faff/.gitignore"); git(dir, "commit", "-q", "-m", "commit inner (correct)");
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(findingsOn(dir, ".faff/.gitignore").length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check smoke: over-ignore, then under-ignore none / ineffective-or-untracked / committed", () => {
  const dir = faffIgnoreDir({ gitignore: ".faff/\n" });
  try {
    let r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.gitignore:/);
    assert.ok(r.out.includes(".faff/*"));

    writeFileSync(join(dir, ".gitignore"), ".faff/*\n");
    git(dir, "add", ".gitignore"); git(dir, "commit", "-q", "-m", "fix ignore");
    r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /config check: clean/);

    mkdirSync(join(dir, ".faff", "runs"), { recursive: true });
    writeFileSync(join(dir, ".faff", "runs", "x.md"), "x\n");
    assert.equal(run(dir, "config", "check").code, 0, "root `.faff/*` still covers run state");

    writeFileSync(join(dir, ".gitignore"), "# nothing\n");
    git(dir, "add", ".gitignore"); git(dir, "commit", "-q", "-m", "drop root rule");
    r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.faff\/\.gitignore:/);
    assert.ok(r.out.includes("faff gitignore-ensure"));

    writeFileSync(join(dir, ".faff", ".gitignore"), "/*\n!/.gitignore\n");
    r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /warn +\.faff\/\.gitignore:/);
    assert.ok(r.out.includes("NOT committed"));

    git(dir, "add", "-f", ".faff/.gitignore"); git(dir, "commit", "-q", "-m", "commit inner");
    r = run(dir, "config", "check");
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /config check: clean/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The real-git oracle. Each row writes the line(s) as the sole root .gitignore, lays out the
// committed parts of .faff/ behind an inner .gitignore, and asks git itself whether any of them
// is blocked. `hazard` is the section 3 table's verdict; `gap` pins a KNOWN, accepted
// miss (git blocks, the predicate stays silent) so widening the list shows as a failing row.
// Adding a spelling to FAFF_GITIGNORE_DIR_HAZARD_PATTERNS requires a row here and a row in the
// gitignoreEnsureSelftest fixture table.
const COMMITTED_FAFF_PARTS = [".faff/.gitignore", ".faff/anchors/run1/a.json", ".faff/templates/adr.md"];
const ORACLE_ROWS = [
  ...["", "/", "**/", "/**/"].flatMap((prefix) => [
    ...["", "/", "/**", "/**/", "/*/**", "/**/*"].map((suffix) => ({ line: `${prefix}.faff${suffix}\n`, hazard: true })),
    { line: `${prefix}.faff/*\n`, hazard: false },
  ]),
  { line: "", hazard: false },
  { line: "# .faff/\n", hazard: false },
  { line: "!.faff/\n", hazard: false },
  { line: ".faff/   \n", hazard: true },
  { line: ".faff/*\n.faff/\n", hazard: true },
  { line: ".faff/\n.faff/*\n", hazard: true },
  { line: "node_modules/\n.faff/\ndist/\n", hazard: true },
  { line: ".faff/*/*/**\n", hazard: false, gap: true },
  { line: ".faff/**/**\n", hazard: false, gap: true },
  { line: ".faff/*/*\n", hazard: false, gap: true },
];

for (const { line, hazard, gap } of ORACLE_ROWS) {
  test(`oracle: ${JSON.stringify(line)} → predicate ${hazard ? "flags" : "is silent"}${gap ? " (pinned gap: git still blocks)" : ", agreeing with git"}`, () => {
    const dir = gitDir({ gitignore: line, commitBase: true });
    try {
      mkdirSync(join(dir, ".faff", "anchors", "run1"), { recursive: true });
      mkdirSync(join(dir, ".faff", "templates"), { recursive: true });
      writeFileSync(join(dir, ".faff", "anchors", "run1", "a.json"), "{}\n");
      writeFileSync(join(dir, ".faff", "templates", "adr.md"), "t\n");
      writeFileSync(join(dir, ".faff", ".gitignore"), INNER_GITIGNORE);
      const gitBlocks = COMMITTED_FAFF_PARTS.some((p) => spawnSync("git", ["check-ignore", "-q", p], { cwd: dir }).status === 0);
      const predicateFlags = gitignoreDirHazardLines(line).length > 0;
      assert.equal(predicateFlags, hazard, "predicate matches the section 3 table");
      if (gap) assert.ok(gitBlocks && !predicateFlags, "git blocks a committed part while the predicate stays silent");
      else assert.equal(predicateFlags, gitBlocks, "predicate agrees with git");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ---------------------------------------------------------------------------
// FAFF-1080: tracking.teams / default_team / team_routing cross-field validation.
// ---------------------------------------------------------------------------

test("config check: a well-formed team-set (teams + default_team member + team_routing values all members) → exit 0", () => {
  const dir = plainDir({
    base: "tracking:\n  teams:\n    - IDEAS\n    - PRODUCT\n    - RISKS\n  default_team: PRODUCT\n  team_routing:\n    spike: IDEAS\n    bug: PRODUCT\n",
  });
  try { assert.equal(run(dir, "config", "check").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: default_team not a member of teams → exit 1, naming the value + member set", () => {
  const dir = plainDir({ base: "tracking:\n  teams:\n    - IDEAS\n    - PRODUCT\n  default_team: STAGING\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /default_team/);
    assert.match(r.out, /STAGING/);
    assert.match(r.out, /IDEAS, PRODUCT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a team_routing value not a member of teams → exit 1, naming the key + value + member set", () => {
  const dir = plainDir({
    base: "tracking:\n  teams:\n    - IDEAS\n    - PRODUCT\n  default_team: PRODUCT\n  team_routing:\n    feature: IDEAS_TYPO\n",
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /team_routing/);
    assert.match(r.out, /feature/);
    assert.match(r.out, /IDEAS_TYPO/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: tracking.teams present but empty → exit 1", () => {
  const dir = plainDir({ base: "tracking:\n  teams: []\n  default_team: PRODUCT\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /tracking\.teams is empty/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: default_team set without teams (and without legacy team_key) → exit 1", () => {
  const dir = plainDir({ base: "tracking:\n  default_team: PRODUCT\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /default_team is set without tracking\.teams/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: legacy team_key ALONE (no teams, no default_team) → exit 0, unaffected by the new validation", () => {
  const dir = plainDir({ base: "tracking:\n  team_key: PRODUCT\n" });
  try { assert.equal(run(dir, "config", "check").code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: inline-flow bare teams (the ticket's literal [IDEAS, PRODUCT, RISKS]) reads as a string, not a list — rejected loudly, never a silent degrade", () => {
  const dir = plainDir({ base: "tracking:\n  teams: [IDEAS, PRODUCT, RISKS]\n  default_team: PRODUCT\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /tracking\.teams is empty \(or not a list\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a scalar (non-map) team_routing is rejected loudly, not silently skipped (adversarial review finding)", () => {
  const dir = plainDir({ base: "tracking:\n  teams:\n    - IDEAS\n    - PRODUCT\n  default_team: PRODUCT\n  team_routing: oops\n" });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.match(r.out, /tracking\.team_routing is not a map/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config set: refuses a nested team_routing LEAF write (tracking.team_routing.spike), not just the exact key (adversarial review finding)", () => {
  const dir = plainDir({ base: "tracking:\n  teams:\n    - IDEAS\n    - PRODUCT\n  default_team: PRODUCT\n  team_routing:\n    spike: IDEAS\n" });
  try {
    const before = readFileSync(join(dir, ".faff/config.yaml"), "utf8");
    const r = run(dir, "config", "set", "tracking.team_routing.spike", "PRODUCT", "--force");
    assert.equal(r.code, 2);
    assert.match(r.err, /list-valued key/);
    assert.equal(readFileSync(join(dir, ".faff/config.yaml"), "utf8"), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config check: a *_env value is NOT flagged (name-indirection is exempt by design)", () => {
  const dir = gitDir({
    base: "adversarial:\n  api_key_env: NVIDIA_API_KEY\n  host: https://integrate.api.nvidia.com/v1\n",
    gitignore: ".faff/config.local.yaml\n",
    commitBase: true,
  });
  try {
    const r = run(dir, "config", "check");
    assert.equal(r.code, 0, "no secret finding for api_key_env / host: " + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Scenario 1 — the 2026-07-01 failure mode is recoverable + detectable
// ---------------------------------------------------------------------------

test("scenario: a committed base survives a wholesale rewrite — diff visible, checkout restores", () => {
  const dir = gitDir({
    base: "slots:\n  review: faffter-dark-adversarial-review\n  spec: faffter-dark-nlspec\nappetite: high\n",
    gitignore: ".faff/config.local.yaml\n",
    commitBase: true,
  });
  try {
    // A wholesale agent rewrite drops the review slot (the real 2026-07-01 corruption shape).
    writeFileSync(join(dir, ".faff/config.yaml"), "slots:\n  spec: faffter-dark-nlspec\nappetite: high\n");
    // Drift is DETECTABLE: git sees a modification.
    const status = git(dir, "status", "--porcelain", ".faff/config.yaml");
    assert.match(status, /^\s*M\s+\.faff\/config\.yaml/m, "wholesale rewrite shows as a working-tree diff");
    // and RECOVERABLE: checkout restores the dropped slot.
    git(dir, "checkout", "--", ".faff/config.yaml");
    assert.equal(run(dir, "config", "get", "slots.review").out, "faffter-dark-adversarial-review");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// Integration smoke test (spec §8)
// ---------------------------------------------------------------------------

test("integration smoke: merge → check exit 1 (untracked) → commit → check exit 0 → secret → check exit 1 redacted", () => {
  const dir = gitDir({
    base: "adversarial:\n  host: http://base.test\n",
    overlay: "adversarial:\n  host: http://overlay.test\n",
    gitignore: ".faff/config.local.yaml\n",
  });
  try {
    // merge plumbing connected: overlay wins the nested leaf.
    assert.equal(run(dir, "config", "get", "adversarial.host").out, "http://overlay.test");
    // posture check connected: base is untracked → exit 1.
    assert.equal(run(dir, "config", "check").code, 1);
    // commit the base → clean posture.
    writeFileSync(join(dir, ".faff/.gitignore"), FAFF_DIR_GITIGNORE_PATTERNS.join("\n") + "\n");
    git(dir, "add", ".faff/config.yaml", ".faff/.gitignore", ".gitignore");
    git(dir, "commit", "-q", "-m", "commit base");
    assert.equal(run(dir, "config", "check").code, 0);
    // append a secret to the base → exit 1, output redacted.
    const RAW = "token: nvapi-0123456789abcdefghijklmnopqrstuv";
    appendFileSync(join(dir, ".faff/config.yaml"), RAW + "\n");
    const r = run(dir, "config", "check");
    assert.equal(r.code, 1);
    assert.ok(!r.out.includes("nvapi-0123456789abcdefghijklmnopqrstuv"), "raw secret redacted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
