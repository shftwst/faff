// FAFF-1302 — faff adds nothing to the project's root `.gitignore`. The config files live
// under `.faff/`: `.faff/config.yaml` (committed base) and `.faff/config.example.yaml`
// (committed template) are carved out of `.faff/.gitignore`'s `/*`, and the machine-local
// overlay `.faff/config.local.yaml` gets no carve-out, so the same `/*` keeps it ignored.
// The command stays APPEND-ONLY: it never removes an existing line, so a repo onboarded
// before FAFF-1302 keeps its four `.faffrc` lines.
// Each case asks the real git binary, because a pattern string can look right and ignore
// the wrong file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const { FAFF_DIR_DEEP_CATCHALLS, FAFF_DIR_GITIGNORE_PATTERNS } = createRequire(import.meta.url)("../../plugin/skills/faff/bin/lib/gitignore-ensure.js");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin", "skills", "faff", "bin", "faff");

function run(cwd, ...args) {
  const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return out;
}
function seed() { return mkdtempSync(join(tmpdir(), "faff387gi-")); }

const FAFFRC_LINES = [".faffrc", ".faffrc.yml", ".faffrc.*.yaml", "!.faffrc.example.yaml"];

test("the root set is empty; the `.faff/.gitignore` set carves out the base and the example, never the overlay (FAFF-1302)", () => {
  const dir = seed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.deepEqual([...res.added, ...res.already], [], "faff adds nothing to the project's root .gitignore");
    assert.ok(!existsSync(join(dir, ".gitignore")), "an empty set is a clean no-op: no root file, no stray header");
    assert.deepEqual([...res.faff_dir.added, ...res.faff_dir.already], ["/*", "!/.gitignore", "!/anchors/", "!/templates/", "!/decisions.md", "!/conventions.md", "!/config.yaml", "!/config.example.yaml"]);
    const inner = readFileSync(join(dir, ".faff", ".gitignore"), "utf8").split("\n");
    const star = inner.indexOf("/*");
    for (const carve of ["!/config.yaml", "!/config.example.yaml"]) assert.ok(inner.indexOf(carve) > star, `${carve} follows the \`/*\` line`);
    assert.ok(!inner.some((l) => l.includes("config.local")), "the overlay has no carve-out");
    assert.ok(!inner.some((l) => l.includes("faffrc")), "no .faffrc line anywhere");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("append-only: existing `.faffrc` ignore lines are NEVER removed, and none are re-offered", () => {
  const dir = seed();
  try {
    const seeded = "node_modules/\n.faffrc.yaml\n" + FAFFRC_LINES.join("\n") + "\n";
    writeFileSync(join(dir, ".gitignore"), seeded);
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(readFileSync(join(dir, ".gitignore"), "utf8"), seeded, "root file byte-identical");
    assert.deepEqual(res.added, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function configFixtures(dir) {
  mkdirSync(join(dir, ".faff"), { recursive: true });
  for (const f of ["config.yaml", "config.local.yaml", "config.example.yaml"]) writeFileSync(join(dir, ".faff", f), "appetite: high\n");
}

test("git semantics: base and example are committable, the overlay is ignored, and status never lists the overlay (FAFF-1302)", () => {
  const dir = seed();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    run(dir, "gitignore-ensure");
    configFixtures(dir);
    assert.ok(!isIgnored(dir, ".faff/config.yaml"), "the base is committable");
    assert.ok(!isIgnored(dir, ".faff/config.example.yaml"), "the example is committable");
    assert.ok(isIgnored(dir, ".faff/config.local.yaml"), "the overlay is ignored");
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
    assert.match(status, /^\?\? \.faff\/config\.yaml$/m);
    assert.match(status, /^\?\? \.faff\/config\.example\.yaml$/m);
    assert.doesNotMatch(status, /config\.local\.yaml/, "the overlay is never offered for commit");
    assert.ok(isIgnored(dir, ".faff/runs/run1/events.jsonl"), "run artifacts under .faff stay ignored");
    assert.ok(!isIgnored(dir, ".faff/anchors/run1/FAFF-1/events.jsonl"), "the anchors carve-out is still committable (FAFF-568)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("migrating repo: the four `.faffrc` lines and no `.faff/*` leave the overlay stageable until `gitignore-ensure` runs (FAFF-1302)", () => {
  const dir = seed();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, ".gitignore"), FAFFRC_LINES.join("\n") + "\n");
    configFixtures(dir);
    assert.ok(!isIgnored(dir, ".faff/config.local.yaml"), "before: the printed `mv` would land the overlay unignored");
    run(dir, "gitignore-ensure");
    assert.ok(isIgnored(dir, ".faff/config.local.yaml"), "after: ignored");
    assert.ok(!isIgnored(dir, ".faff/config.yaml"), "the base is committable");
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
    assert.doesNotMatch(status, /config\.local\.yaml/, "the overlay is never staged-able once the ensure has run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the notice for a deprecated overlay names `faff gitignore-ensure` first in the migrating-repo state, and the move alone once fixed", () => {
  const dir = seed();
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    writeFileSync(join(dir, ".gitignore"), FAFFRC_LINES.join("\n") + "\n");
    writeFileSync(join(dir, ".faffrc.local.yaml"), "appetite: low\n");
    const before = spawnSync("node", [CLI, "config", "path"], { cwd: dir, encoding: "utf8" });
    assert.equal(before.status, 0);
    assert.ok(before.stderr.indexOf("faff gitignore-ensure") !== -1 && before.stderr.indexOf("faff gitignore-ensure") < before.stderr.indexOf("To migrate:  mv .faffrc.local.yaml .faff/config.local.yaml"));
    assert.match(before.stderr, /would leave an operator-private file stageable/);
    assert.equal(before.stdout.trim(), join(realpathSync(dir), ".faffrc.local.yaml"));
    run(dir, "gitignore-ensure");
    const after = spawnSync("node", [CLI, "config", "path"], { cwd: dir, encoding: "utf8" });
    assert.doesNotMatch(after.stderr, /gitignore-ensure/);
    assert.match(after.stderr, /To migrate:  mv \.faffrc\.local\.yaml \.faff\/config\.local\.yaml/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("idempotent: a second run is a byte-identical no-op", () => {
  const dir = seed();
  try {
    run(dir, "gitignore-ensure");
    const firstFaff = readFileSync(join(dir, ".faff", ".gitignore"));
    run(dir, "gitignore-ensure");
    assert.ok(!existsSync(join(dir, ".gitignore")), "still no root .gitignore");
    assert.deepEqual(readFileSync(join(dir, ".faff", ".gitignore")), firstFaff, ".faff/.gitignore byte-identical after a re-run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// FAFF-1062 — `--local` targets `.git/info/exclude` with a distinct pattern set:
// `.faff/` is ignored wholesale, with no carve-outs (a personal exclude file has no
// committed subtree to protect). FAFF-1302: that covers the base config too.
// ---------------------------------------------------------------------------

function gitSeed() {
  // macOS: $TMPDIR (/var/folders) is a symlink to /private/var/folders; the CLI
  // returns its resolved cwd, so canonicalise the seed dir to match res.path.
  const dir = realpathSync(seed());
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

test("--local writes .git/info/exclude with the local pattern set: `.faff/` wholesale and no `.faffrc` line", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--local", "--json"));
    assert.equal(res.path, join(dir, ".git", "info", "exclude"));
    const set = [...res.added, ...res.already];
    assert.deepEqual(set, [".faff/"]);
    const raw = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    assert.match(raw, /^\.faff\/$/m, "the whole .faff dir is ignored (not .faff/*)");
    assert.doesNotMatch(raw, /faffrc/, "no .faffrc-stemmed line");
    assert.doesNotMatch(raw, /^!\.faff\/anchors\/$/m, "the anchors carve-out is not written to the local set");
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
    assert.match(after, /^\.faff\/$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--local git semantics: a directory-shaped exclusion wins, so the base config stays ignored even beside a carve-out (FAFF-1302)", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure", "--local");
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), "/*\n!/config.yaml\n!/config.example.yaml\n");
    assert.match(ignoredBy(dir, ".faff/config.yaml"), /^\.git\/info\/exclude:\d+:\.faff\//, "git never descends, so the carve-out is never read");
    assert.ok(isIgnored(dir, ".faff/config.local.yaml"), "the overlay is ignored");
    assert.ok(isIgnored(dir, ".faff/anchors/run1/FAFF-1/events.jsonl"), "no anchors carve-out locally: .faff/ is ignored wholesale");
    assert.ok(isIgnored(dir, ".faff/runs/run1/events.jsonl"), "run artifacts under .faff stay ignored");
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

// ---------------------------------------------------------------------------
// FAFF-1385 — `--local` resolves its target via `git rev-parse --git-path
// info/exclude` (never a hand-built `<root>/.git/info/exclude` join), so it works
// identically from a linked worktree (where `.git` is a file, not a directory) and
// reports — rather than fabricates a stray tree for — a non-repo directory.
// ---------------------------------------------------------------------------

test("--local from a linked worktree writes the MAIN repo's common-dir info/exclude, and git check-ignore confirms it from the worktree", () => {
  const dir = gitSeed();
  const wtDir = join(dirname(dir), `${dir.split("/").pop()}-wt`);
  try {
    execFileSync("git", ["-C", dir, "config", "user.email", "faff-selftest@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "faff-selftest"]);
    writeFileSync(join(dir, "README.md"), "x\n");
    execFileSync("git", ["-C", dir, "add", "README.md"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"]);
    execFileSync("git", ["-C", dir, "worktree", "add", "--detach", wtDir]);

    const res = JSON.parse(run(wtDir, "gitignore-ensure", "--local", "--json"));
    assert.equal(res.no_repo, false);
    assert.equal(res.path, join(dir, ".git", "info", "exclude"), "the target is the MAIN repo's info/exclude, not <worktree>/.git/info/exclude");
    assert.ok(statSync(join(wtDir, ".git")).isFile(), "sanity: the worktree's own .git is a file, not a directory, so a hand-built join would be wrong");
    const raw = readFileSync(join(dir, ".git", "info", "exclude"), "utf8");
    assert.match(raw, /^\.faff\/$/m, "the pattern landed on the main repo's exclude file");
    assert.ok(isIgnored(wtDir, ".faff/config.local.yaml"), "git check-ignore confirms it from the worktree");
  } finally {
    spawnSync("git", ["-C", dir, "worktree", "remove", "--force", wtDir]);
    rmSync(wtDir, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--local outside a git repository exits 0, reports no git repo, and writes no file", () => {
  const dir = seed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--local", "--json"));
    assert.equal(res.no_repo, true);
    assert.equal(res.path, null);
    assert.deepEqual(res.added, []);
    assert.equal(res.faff_dir, null);
    assert.ok(!existsSync(join(dir, ".git")), "no stray .git tree is fabricated");
    const text = run(dir, "gitignore-ensure", "--local");
    assert.match(text, /not a git repository/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("standard mode (no --local) writes both targets, the carve-out in .faff/.gitignore (regression), even inside a git repo", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(res.path, join(dir, ".gitignore"));
    const set = [...res.added, ...res.already];
    assert.deepEqual(set, [], "standard mode adds nothing to the root file");
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
  // FAFF-1309: `.faff/templates/` is a FLAT payload (a direct child), deliberately
  // distinct from the NESTED `.faff/anchors/run-1/FAFF-1/` payload — several catch-all
  // spellings (`*/`, `/*/`, `*/*`, `/*/**`) kill one and not the other, which is exactly
  // what section 5's oracle table needs to observe.
  for (const f of [".faff/anchors/run-1/FAFF-1/events.jsonl", ".faff/runs/run-1/events.jsonl", ".faff/logs/2026-10-15/x.md", ".faff/templates/spec.md"]) {
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
    assert.ok(!existsSync(join(dir, ".gitignore")), "faff adds no root .gitignore at all");
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

// ---------------------------------------------------------------------------
// FAFF-1309 — `gitignore-ensure` must not leave a dead anchors carve-out in
// `.faff/.gitignore`. The predicate-vs-git oracle (spec section 5): every row seeds a
// complete, correctly-ordered faff block (`/*` then the seven negations) plus one extra
// catch-all line above the whole block or appended below it, then asks real git whether
// a NESTED payload (anchors), a FLAT payload (templates) and a direct-child file
// (config.yaml) are each ignored, and asks `faff config check`'s standing finding the
// same question. `gap: true` rows are KNOWN, accepted misses — git blocks a committed
// part while the detector stays silent — pinned so a predicate widened without updating
// the row fails loudly, exactly as `test/config-two-file.test.mjs`'s root-file oracle
// already does for the sibling hazard list.
// ---------------------------------------------------------------------------

const CORRECT_INNER = FAFF_DIR_GITIGNORE_PATTERNS.join("\n") + "\n";

function gitCheckIgnore(dir, relPath) {
  return spawnSync("git", ["check-ignore", "-q", relPath], { cwd: dir }).status === 0;
}

// Runs `faff config check --json` without throwing on its exit 1 (a finding) — the
// throwing `run()` helper above is for commands this file otherwise expects to exit 0.
function configCheckJson(dir) {
  const r = spawnSync("node", [CLI, "config", "check", "--json"], { cwd: dir, encoding: "utf8" });
  return JSON.parse(r.stdout);
}

function oracleSeed(dir, extraLine, position) {
  const inner = extraLine === null ? CORRECT_INNER
    : position === "above" ? `${extraLine}\n${CORRECT_INNER}`
    : `${CORRECT_INNER}${extraLine}\n`;
  mkdirSync(join(dir, ".faff"), { recursive: true });
  writeFileSync(join(dir, ".faff", ".gitignore"), inner);
  seedFaffFiles(dir);
  writeFileSync(join(dir, ".faff", "config.yaml"), "appetite: high\n");
}

const FAFF_1309_ORACLE_ROWS = [
  { line: null, position: null, anchors: false, templates: false, config: false, warns: false },
  ...FAFF_DIR_DEEP_CATCHALLS.flatMap((l) => [
    { line: l, position: "above", anchors: true, templates: true, config: false, warns: true },
    { line: l, position: "below", anchors: true, templates: true, config: true, warns: true },
  ]),
  { line: "/*", position: "above", anchors: false, templates: false, config: false, warns: false },
  { line: "/*", position: "below", anchors: true, templates: true, config: true, warns: true },
  { line: "  *", position: "above", anchors: false, templates: false, config: false, warns: false },
  { line: "*/", position: "above", anchors: true, templates: false, config: false, warns: false, gap: true },
  { line: "*/", position: "below", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "/*/", position: "above", anchors: false, templates: false, config: false, warns: false },
  { line: "/*/", position: "below", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "*/*", position: "above", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "*/*", position: "below", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "/*/**", position: "above", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "/*/**", position: "below", anchors: true, templates: true, config: false, warns: false, gap: true },
  { line: "/anchors/", position: "above", anchors: false, templates: false, config: false, warns: false },
  { line: "/anchors/", position: "below", anchors: true, templates: false, config: false, warns: false, gap: true },
];

for (const row of FAFF_1309_ORACLE_ROWS) {
  const label = row.line === null ? "a correctly-ordered block alone (baseline)" : `\`${row.line}\` ${row.position}`;
  test(`FAFF-1309 oracle: ${label} → git anchors=${row.anchors} templates=${row.templates} config=${row.config}, detector ${row.warns ? "warns" : "is silent"}${row.gap ? " (pinned accepted gap)" : ""}`, () => {
    const dir = gitSeed();
    try {
      oracleSeed(dir, row.line, row.position);
      const gitAnchors = gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl");
      const gitTemplates = gitCheckIgnore(dir, ".faff/templates/spec.md");
      const gitConfig = gitCheckIgnore(dir, ".faff/config.yaml");
      assert.equal(gitAnchors, row.anchors, "git verdict: anchors (nested payload)");
      assert.equal(gitTemplates, row.templates, "git verdict: templates (flat payload)");
      assert.equal(gitConfig, row.config, "git verdict: config.yaml (direct child)");
      assert.ok(gitCheckIgnore(dir, ".faff/runs/run-1/events.jsonl"), "run state stays ignored in every shape");
      const findings = configCheckJson(dir).findings.filter((f) => f.surface === ".faff/.gitignore");
      // The seeded file is uncommitted in every row here, so the untracked finding always
      // co-fires too; isolate the dead-carve-out finding by its own distinguishing text.
      const deadFinding = findings.find((f) => f.message.includes("leaves") && f.message.includes("dead"));
      assert.equal(!!deadFinding, row.warns, "detector: warns iff this row is a genuine dead shape");
      if (row.gap) assert.ok((row.anchors || row.templates || row.config) && !deadFinding, "pinned gap: git blocks a committed part while the detector stays silent");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// Four rows whose file text is pinned literally — "position" does not determine them.
const FAFF_1309_LITERAL_ROWS = [
  { text: "!/anchors/\n/*\n!/anchors/\n", anchors: false, warns: false, desc: "`!/anchors/` · `/*` · `!/anchors/` — last occurrence governs" },
  { text: "!/anchors/\n!/anchors/\n/*\n", anchors: true, warns: true, desc: "`!/anchors/` · `!/anchors/` · `/*`" },
  { text: "*\n!/anchors/\n!/anchors/**\n", anchors: false, warns: false, desc: "`*` · `!/anchors/` · `!/anchors/**` — deep repair" },
  { text: "!/anchors/\n*\n!/anchors/**\n", anchors: true, warns: true, desc: "`!/anchors/` · `*` · `!/anchors/**` — repair pair must sit below the deep line" },
];

for (const row of FAFF_1309_LITERAL_ROWS) {
  test(`FAFF-1309 oracle (literal file text): ${row.desc} → git anchors=${row.anchors}, detector ${row.warns ? "warns" : "is silent"}`, () => {
    const dir = gitSeed();
    try {
      mkdirSync(join(dir, ".faff"), { recursive: true });
      writeFileSync(join(dir, ".faff", ".gitignore"), row.text);
      seedFaffFiles(dir);
      assert.equal(gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), row.anchors);
      const findings = configCheckJson(dir).findings.filter((f) => f.surface === ".faff/.gitignore");
      const deadFinding = findings.find((f) => f.message.includes("leaves") && f.message.includes("dead"));
      assert.equal(!!deadFinding, row.warns);
      if (deadFinding) assert.ok(deadFinding.message.includes("!/anchors/"));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// Behavioural scenarios (spec section 5) — the writer's own warning, driven through the
// real CLI, with each printed remedy applied LITERALLY and re-measured.
test("FAFF-1309 scenario: a repo whose .faff/.gitignore contains only `!/anchors/` — ensure appends the rest, still warns (verdict read from the final file, not from what this run appended)", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), "!/anchors/\n");
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(res.faff_dir.added.length > 0, true, "append-only: the rest of the set is still appended");
    assert.equal(res.warnings.length, 1);
    assert.ok(res.warnings[0].includes("!/anchors/") && res.warnings[0].includes("/*"));
    seedFaffFiles(dir);
    assert.ok(gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), "anchors really ignored");
    assert.ok(!gitCheckIgnore(dir, ".faff/templates/spec.md"), "templates stay committable (positional fault, not deep)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309 scenario: a repo whose .faff/.gitignore already reads `!/anchors/` then `/*` — ensure appends NOTHING about either line, yet still warns", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), "!/anchors/\n/*\n");
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.ok(!res.faff_dir.added.includes("!/anchors/") && !res.faff_dir.added.includes("/*"), "dedupe appends nothing about either line");
    assert.equal(res.warnings.length, 1, "still warns — the verdict is read from the final file");
    assert.ok(res.warnings[0].includes("!/anchors/"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309 scenario: a bare `*` above a correctly-ordered block — deep warning naming both subtree carve-outs; applying the printed fix (delete the `*` line) silences the next run", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), `*\n${CORRECT_INNER}`);
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(res.warnings.length, 1);
    assert.ok(res.warnings[0].includes("!/anchors/") && res.warnings[0].includes("!/templates/"), "both subtree carve-outs named");
    // Apply the printed fix literally: delete the `*` line.
    const fixed = readFileSync(join(dir, ".faff", ".gitignore"), "utf8").split("\n").filter((l) => l.trim() !== "*").join("\n");
    writeFileSync(join(dir, ".faff", ".gitignore"), fixed);
    seedFaffFiles(dir);
    assert.ok(!gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), "anchors committable after the fix");
    assert.ok(!gitCheckIgnore(dir, ".faff/templates/spec.md"), "templates committable after the fix");
    const res2 = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.equal(res2.warnings.length, 0, "the next run is silent");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309 scenario: `*` on top of a correctly-ordered block with `!/anchors/**` appended — `faff config check` names `!/templates/` only, never `!/anchors/`", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), `*\n${CORRECT_INNER}!/anchors/**\n`);
    seedFaffFiles(dir);
    assert.ok(!gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"), "real git: anchors committable");
    const findings = configCheckJson(dir).findings.filter((f) => f.surface === ".faff/.gitignore");
    const deadFinding = findings.find((f) => f.message.includes("leaves") && f.message.includes("dead"));
    assert.ok(deadFinding, "the finding fires (for templates)");
    assert.ok(!deadFinding.message.includes("!/anchors/"), "never names !/anchors/");
    assert.ok(deadFinding.message.includes("!/templates/"), "names !/templates/ only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309 scenario: `  *` (two leading spaces) above a correctly-ordered block — no warning, git agrees every carve-out is committable", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), `  *\n${CORRECT_INNER}`);
    seedFaffFiles(dir);
    assert.ok(!gitCheckIgnore(dir, ".faff/anchors/run-1/FAFF-1/events.jsonl"));
    assert.ok(!gitCheckIgnore(dir, ".faff/templates/spec.md"));
    writeFileSync(join(dir, ".faff", "config.yaml"), "appetite: high\n");
    assert.ok(!gitCheckIgnore(dir, ".faff/config.yaml"));
    const findings = configCheckJson(dir).findings.filter((f) => f.surface === ".faff/.gitignore" && f.message.includes("dead"));
    assert.equal(findings.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309 scenario: a repo already dead, no further `gitignore-ensure` run — `faff config check` alone reports the shadowed carve-outs", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), "!/anchors/\n/*\n");
    const findings = configCheckJson(dir).findings.filter((f) => f.surface === ".faff/.gitignore");
    const deadFinding = findings.find((f) => f.message.includes("leaves") && f.message.includes("dead"));
    assert.ok(deadFinding && deadFinding.severity === "warn");
    assert.ok(deadFinding.message.includes("!/anchors/"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309: faff gitignore-ensure exit code stays 0 and the file is still written on every dead-file shape", () => {
  const dir = gitSeed();
  try {
    mkdirSync(join(dir, ".faff"), { recursive: true });
    writeFileSync(join(dir, ".faff", ".gitignore"), "!/anchors/\n/*\n");
    const r = spawnSync("node", [CLI, "gitignore-ensure"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.ok(existsSync(join(dir, ".faff", ".gitignore")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309: re-running gitignore-ensure against an already-correct repo leaves .faff/.gitignore byte-identical", () => {
  const dir = gitSeed();
  try {
    run(dir, "gitignore-ensure");
    const before = readFileSync(join(dir, ".faff", ".gitignore"), "utf8");
    run(dir, "gitignore-ensure");
    const after = readFileSync(join(dir, ".faff", ".gitignore"), "utf8");
    assert.equal(before, after);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-1309: a fresh repo, after faff gitignore-ensure, produces no warnings at all", () => {
  const dir = gitSeed();
  try {
    const res = JSON.parse(run(dir, "gitignore-ensure", "--json"));
    assert.deepEqual(res.warnings, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
