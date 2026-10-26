// ===========================================================================
// === region:factory — gitignore-ensure — FAFF-67: idempotently, non-destructively add faff's local ===
// artifacts to two ignore files. The project's root .gitignore gets no faff lines (FAFF-1302
// moved the config files under .faff/); a committed .faff/.gitignore (FAFF-1299) gets every
// rule about paths under .faff/. Append-only: never reorders, deduplicates, rewrites, or removes
// any existing line. A run against already-correct files is a clean no-op
// (byte-identical). Single source of truth for the pattern sets, so the future config
// writer (FAFF-5) and bootstrap skill (FAFF-6) reach the same sets.
// FAFF-1299: a deeper .gitignore wins over a shallower one, so faff governs .faff/ from
// inside it. Every .faff/.gitignore pattern is anchored with a leading `/` (an
// unanchored `*` matches at every depth and would re-ignore the files inside
// `anchors/`), with `/*` before every negation. The ignore is `/*` (contents), never a
// bare `.faff/`: a directory ignore makes git skip the subtree, so no carve-out inside
// it could ever apply. .faff/.gitignore must be COMMITTED for the rules to reach
// another clone; `--local` writes only .git/info/exclude and creates neither file.
// A root line spelled `.faff/` (or any other spelling on the hazard list) blocks the
// rules inside .faff/; the writer never rewrites it and warns with the `.faff/*` fix.
// FAFF-1301: `faff config check` reports the same line (and an absent or uncommitted
// .faff/.gitignore) as a read-only posture finding on every later run.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findRoot, resolveInfoExcludeFile } = require("./shared-infra");

// FAFF-1302: the root set is empty. faff's config files live under `.faff/`, so every
// rule about them is in `.faff/.gitignore` and faff adds nothing to the project's own
// root `.gitignore`. This command is append-only: it NEVER removes an existing line, so a
// repo onboarded earlier keeps its `.faffrc` lines; a newly onboarded repo never gets them.
const FAFF_GITIGNORE_PATTERNS = [];

// FAFF-1299: every rule about paths under `.faff/`, written to the committed
// `.faff/.gitignore` (a deeper ignore file beats the root one). Every pattern is
// anchored with a leading `/`: an unanchored `*` matches at every depth and would
// re-ignore the files INSIDE `anchors/` after `!/anchors/` re-included the directory.
// `/*` ignores only direct children (so git still descends, which lets the negations
// work) and must precede every negation. `!/.gitignore` keeps this file committable.
// The file must be committed for the rules to reach another clone.
const FAFF_DIR_GITIGNORE_PATTERNS = [
  "/*",              // direct children of .faff/ only
  "!/.gitignore",    // this file itself
  "!/anchors/",      // FAFF-568: committed tamper-evidence anchor subtree
  "!/templates/",    // FAFF-1300: template overrides
  "!/decisions.md",  // committable once created
  "!/conventions.md", // NOT the gitignored conventions.json cache (FAFF-1068)
  "!/config.yaml",   // FAFF-1302: the committed base config (config.local.yaml stays ignored by `/*`)
  "!/config.example.yaml", // FAFF-1302: the committed template
];

// FAFF-1299, FAFF-1301: root ignore spellings that defeat the carve-outs above. Four
// prefix forms (bare, `/`, `**/`, `/**/`) crossed with four directory-scope shapes.
// Exact spellings only, stored trailing-slash-folded (a written `.faff/` and `.faff`
// compare equal; `.faff/**/` folds onto `.faff/**`); deliberately no glob evaluation.
// The family of equivalent globs is unbounded (`.faff/*/*/**`, `.faff/**/**`), so those
// are a pinned, accepted gap. Adding a spelling needs a row in the real-git oracle in
// test/config-two-file.test.mjs and one in the gitignoreEnsureSelftest fixture table.
const FAFF_GITIGNORE_DIR_HAZARD_PATTERNS = [
  // Full hazard: git skips the whole subtree, so .faff/.gitignore is never read.
  ".faff",
  "/.faff",
  "**/.faff",
  "/**/.faff",
  // Partial hazard: .faff/.gitignore is read, but files nested under re-included
  // directories stay ignored.
  ".faff/**",
  "/.faff/**",
  "**/.faff/**",
  "/**/.faff/**",
  ".faff/*/**",
  "/.faff/*/**",
  "**/.faff/*/**",
  "/**/.faff/*/**",
  ".faff/**/*",
  "/.faff/**/*",
  "**/.faff/**/*",
  "/**/.faff/**/*",
];

// FAFF-1301: the correct spellings. `.faff/*` ignores direct children only, so git still
// descends and the carve-outs work.
const FAFF_GITIGNORE_DIR_CLEAN_PATTERNS = [
  ".faff/*",
  "/.faff/*",
  "**/.faff/*",
  "/**/.faff/*",
];

// FAFF-1062: the `--local` counterpart, targeting `.git/info/exclude` (a per-checkout,
// never-committed ignore file every git repo already has) instead of the committable
// `.gitignore`. Because THIS target is personal-only, `.faff/` is ignored wholesale with
// no carve-outs: a personal exclude file has no committed subtree to protect, and a
// directory-shaped exclusion wins over `.faff/.gitignore`, so the base config is covered too.
const FAFF_GITIGNORE_PATTERNS_LOCAL = [
  ".faff/",
];
const GITIGNORE_HEADER = "# faff local artifacts (added by `faff gitignore-ensure`)";

function stripTrailingSlash(s) {
  return s.replace(/\/+$/, "");
}

// Literal match with trailing-slash normalisation, skipping blanks/comments.
// Deliberately NOT a full gitignore-semantics evaluator (globs, negation,
// anchoring) — over-matching risks failing to add a needed pattern.
function gitignoreHasPattern(pattern, lines) {
  const norm = stripTrailingSlash(pattern);
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    if (stripTrailingSlash(t) === norm) return true;
  }
  return false;
}

function foldedIgnoreLines(text) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    out.push({ line: t, folded: stripTrailingSlash(t) });
  }
  return out;
}

// Pure: offending trimmed lines of a root ignore file, in file order.
function gitignoreDirHazardLines(text) {
  return foldedIgnoreLines(text)
    .filter(({ folded }) => FAFF_GITIGNORE_DIR_HAZARD_PATTERNS.includes(folded))
    .map(({ line }) => line);
}

// Pure: does the file say anything about the `.faff` directory, wrongly or rightly?
function gitignoreMentionsFaffDir(text) {
  if (gitignoreDirHazardLines(text).length > 0) return true;
  return foldedIgnoreLines(text).some(({ folded }) => FAFF_GITIGNORE_DIR_CLEAN_PATTERNS.includes(folded));
}

function buildGitignoreAppendBlock(raw, missing) {
  const parts = [];
  if (raw !== "" && !raw.endsWith("\n")) parts.push("\n"); // finish a no-EOL last line
  if (raw.trim() !== "") parts.push("\n");                  // one blank separator line
  parts.push(GITIGNORE_HEADER + "\n");
  for (const p of missing) parts.push(p + "\n");
  return parts.join("");
}

function ensureOneTarget(target, patterns) {
  const existed = fs.existsSync(target);
  const raw = existed ? fs.readFileSync(target, "utf8") : "";
  const lines = raw.split("\n");
  const missing = patterns.filter((p) => !gitignoreHasPattern(p, lines));
  const already = patterns.filter((p) => gitignoreHasPattern(p, lines));
  if (missing.length === 0) {
    return { path: target, created: false, added: [], already };
  }
  const block = buildGitignoreAppendBlock(raw, missing);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, raw + block);
  return { path: target, created: !existed, added: missing, already };
}

function hazardWarning(root, line) {
  return `warning: ${path.join(root, ".gitignore")} has an ignore line \`${line}\` covering the .faff directory.\n` +
    "Git will not read .faff/.gitignore, or will keep ignoring files under the directories\n" +
    "it re-includes, so faff's committed anchors are invisible.\n" +
    `Fix by hand: change \`${line}\` to \`.faff/*\`.`;
}

// FAFF-1062: `--local` writes only `.git/info/exclude` — FAFF-1385: resolved through
// git's own `--git-path` plumbing (`resolveInfoExcludeFile`), never a hand-built
// `<root>/.git/info/exclude` join, so this works identically from a linked worktree
// (where `.git` is a file, not a directory) and a main checkout. Outside a git repo
// there is no exclude file to own: write nothing and signal `no_repo` up to the
// command layer rather than fabricating a stray `.git/info/exclude` tree. Standard
// mode writes the root `.gitignore` and (FAFF-1299) `.faff/.gitignore`, then warns
// about hazardous root lines — untouched by this change.
function gitignoreEnsure(root, local = false) {
  if (local) {
    const target = resolveInfoExcludeFile(root);
    if (target === null) {
      return { path: null, no_repo: true, created: false, added: [], already: [], faff_dir: null, warnings: [] };
    }
    const result = ensureOneTarget(target, FAFF_GITIGNORE_PATTERNS_LOCAL);
    return { ...result, no_repo: false, faff_dir: null, warnings: [] };
  }
  const rootTarget = path.join(root, ".gitignore");
  const result = ensureOneTarget(rootTarget, FAFF_GITIGNORE_PATTERNS);
  const faffDir = ensureOneTarget(path.join(root, ".faff", ".gitignore"), FAFF_DIR_GITIGNORE_PATTERNS);
  const rootRaw = fs.existsSync(rootTarget) ? fs.readFileSync(rootTarget, "utf8") : "";
  const warnings = gitignoreDirHazardLines(rootRaw).map((line) => hazardWarning(root, line));
  return { ...result, faff_dir: faffDir, warnings };
}

// FAFF-548 selftest — drives the real `gitignoreEnsure` fs writer against throwaway
// temp roots (never the live repo), asserting the pattern-set contract: fresh-repo
// append content + glob-before-negation order, idempotent no-op on re-run,
// existing-line preservation (append-only), and no `.faffrc` line ever appended.
// Sibling convention: per-case `ok`/`FAIL` line + a RESULT line, non-zero on any fail.
function gitignoreEnsureSelftest() {
  let fail = 0;
  const check = (desc, cond) => {
    if (cond) console.log(`ok   ${desc}`);
    else { fail++; console.log(`FAIL ${desc}`); }
  };
  const withTmp = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-gie-"));
    try { return fn(dir); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  // FAFF-1385: `--local` now resolves its target via `git rev-parse --git-path`
  // (`resolveInfoExcludeFile`), so its selftest cases need a REAL repo — a hand-made
  // `.git/info/` directory is no longer a git repo as far as `git rev-parse` is
  // concerned. `git init -q` is enough; no commit, no config, no HEAD history needed
  // for this plumbing command.
  const withGitRepo = (fn) => withTmp((dir) => {
    const r = spawnSync("git", ["-C", dir, "init", "-q"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`faff gitignore-ensure selftest: \`git init\` failed: ${r.stderr || r.error}`);
    return fn(dir);
  });
  const lineIndex = (raw, s) => raw.split("\n").findIndex((l) => l.trim() === s);

  // Pure pattern-set contract (checkable without fs) ────────────────────────────
  check("root set is empty (FAFF-1302: faff adds nothing to the project's root .gitignore)", FAFF_GITIGNORE_PATTERNS.length === 0);
  check("root set carries no `.faffrc`-stemmed entry", FAFF_GITIGNORE_PATTERNS.every((p) => !p.includes(".faffrc")));
  check("root set carries neither `.faff/*` nor `!.faff/anchors/`", !FAFF_GITIGNORE_PATTERNS.includes(".faff/*") && !FAFF_GITIGNORE_PATTERNS.includes("!.faff/anchors/"));
  check("root set does NOT carry a bare `.faff/` (would block the carve-out)", !FAFF_GITIGNORE_PATTERNS.includes(".faff/"));

  // FAFF-1299: the `.faff/.gitignore` set, anchored, `/*` before every negation.
  check("faff-dir set equals the eight anchored patterns", JSON.stringify(FAFF_DIR_GITIGNORE_PATTERNS) === JSON.stringify(["/*", "!/.gitignore", "!/anchors/", "!/templates/", "!/decisions.md", "!/conventions.md", "!/config.yaml", "!/config.example.yaml"]));
  check("faff-dir set carves out the base config and the example, never the overlay", FAFF_DIR_GITIGNORE_PATTERNS.includes("!/config.yaml") && FAFF_DIR_GITIGNORE_PATTERNS.includes("!/config.example.yaml") && !FAFF_DIR_GITIGNORE_PATTERNS.some((p) => p.includes("config.local")));
  check("faff-dir set: every pattern begins with `/` (after any `!`)", FAFF_DIR_GITIGNORE_PATTERNS.every((p) => p.replace(/^!/, "").startsWith("/")));
  {
    const star = FAFF_DIR_GITIGNORE_PATTERNS.indexOf("/*");
    const negations = FAFF_DIR_GITIGNORE_PATTERNS.map((p, i) => (p.startsWith("!") ? i : -1)).filter((i) => i !== -1);
    check("faff-dir set: `/*` is at a lower index than every negation", star !== -1 && negations.every((i) => star < i));
  }

  // FAFF-1299, FAFF-1301: hazard detection is pure, exercised here with no temp directory.
  // Every spelling added to FAFF_GITIGNORE_DIR_HAZARD_PATTERNS needs a row here and one in
  // the real-git oracle in test/config-two-file.test.mjs.
  for (const prefix of ["", "/", "**/", "/**/"]) {
    for (const suffix of ["", "/", "/**", "/**/", "/*/**", "/**/*"]) {
      const spelling = `${prefix}.faff${suffix}`;
      const got = gitignoreDirHazardLines(`node_modules/\n${spelling}\n`);
      check(`hazard: \`${spelling}\` flagged`, got.length === 1 && got[0] === spelling);
    }
    const clean = `${prefix}.faff/*`;
    check(`hazard: \`${clean}\` is not flagged`, gitignoreDirHazardLines(`${clean}\n`).length === 0);
    check(`mentions: \`${clean}\` counts as a .faff rule`, gitignoreMentionsFaffDir(`${clean}\n`) === true);
    check(`mentions: \`${prefix}.faff/\` counts as a .faff rule`, gitignoreMentionsFaffDir(`${prefix}.faff/\n`) === true);
  }
  check("hazard: the sixteen-spelling list keeps the original eight", [".faff", "/.faff", "**/.faff", "/**/.faff", ".faff/**", "/.faff/**", "**/.faff/**", "/**/.faff/**"].every((p) => FAFF_GITIGNORE_DIR_HAZARD_PATTERNS.includes(p)) && FAFF_GITIGNORE_DIR_HAZARD_PATTERNS.length === 16);
  check("hazard: clean list is exactly the four `.faff/*` forms", JSON.stringify(FAFF_GITIGNORE_DIR_CLEAN_PATTERNS) === JSON.stringify([".faff/*", "/.faff/*", "**/.faff/*", "/**/.faff/*"]));
  check("hazard: `!.faff/anchors/` is not flagged", gitignoreDirHazardLines("!.faff/anchors/\n").length === 0);
  check("hazard: a negated `!.faff/` is not flagged", gitignoreDirHazardLines("!.faff/\n").length === 0);
  check("hazard: a commented-out `# .faff/` is not flagged", gitignoreDirHazardLines("# .faff/\n").length === 0);
  check("hazard: trailing whitespace is still flagged and trimmed", JSON.stringify(gitignoreDirHazardLines(".faff/   \n")) === JSON.stringify([".faff/"]));
  check("hazard: CRLF line endings are still flagged", JSON.stringify(gitignoreDirHazardLines(".faff/\r\n")) === JSON.stringify([".faff/"]));
  check("hazard: `.faff/*` alongside `.faff/` still flags, in either order", gitignoreDirHazardLines(".faff/*\n.faff/\n").length === 1 && gitignoreDirHazardLines(".faff/\n.faff/*\n").length === 1);
  check("hazard: empty string yields nothing", gitignoreDirHazardLines("").length === 0);
  check("hazard: null and non-strings yield nothing", gitignoreDirHazardLines(null).length === 0 && gitignoreDirHazardLines(undefined).length === 0 && gitignoreDirHazardLines(42).length === 0);
  check("hazard: two hazardous lines returned in file order", JSON.stringify(gitignoreDirHazardLines("**/.faff/\nx\n  .faff/**  \n")) === JSON.stringify(["**/.faff/", ".faff/**"]));
  check("hazard: a repeated hazard line is returned each time (the message collapses it)", gitignoreDirHazardLines(".faff/\n.faff/\n").length === 2);
  check("mentions: null yields false", gitignoreMentionsFaffDir(null) === false);
  check("mentions: a file with no .faff line yields false", gitignoreMentionsFaffDir("node_modules/\n# .faff/\n!.faff/\n") === false);

  // Fresh repo: nothing for the root file, every rule in `.faff/.gitignore` ─────
  withTmp((dir) => {
    const res = gitignoreEnsure(dir);
    check("fresh repo: nothing added to the root file", res.added.length === 0 && res.created === false);
    check("fresh repo: no root .gitignore is created", !fs.existsSync(res.path));
    const fdPath = path.join(dir, ".faff", ".gitignore");
    check("fresh repo: `.faff/` and `.faff/.gitignore` created", fs.existsSync(fdPath) && res.faff_dir.created === true && res.faff_dir.path === fdPath);
    const fd = fs.readFileSync(fdPath, "utf8");
    check("fresh repo: `.faff/.gitignore` holds all eight patterns", FAFF_DIR_GITIGNORE_PATTERNS.every((p) => lineIndex(fd, p) !== -1));
    const star = lineIndex(fd, "/*");
    check("fresh repo: `/*` strictly before every negation in `.faff/.gitignore`", FAFF_DIR_GITIGNORE_PATTERNS.filter((p) => p.startsWith("!")).every((p) => star < lineIndex(fd, p)));
    check("fresh repo: no `.faffrc` line anywhere", !fd.includes(".faffrc"));
    check("fresh repo: no warnings", res.warnings.length === 0);
  });

  // Idempotent no-op on re-run ───────────────────────────────────────────────────
  withTmp((dir) => {
    gitignoreEnsure(dir);
    const fdPath = path.join(dir, ".faff", ".gitignore");
    const fdBefore = fs.readFileSync(fdPath, "utf8");
    const res2 = gitignoreEnsure(dir);
    check("re-run: no lines added (idempotent)", res2.added.length === 0 && res2.faff_dir.added.length === 0);
    check("re-run: still no root file", !fs.existsSync(res2.path));
    check("re-run: `.faff/.gitignore` is byte-identical", fdBefore === fs.readFileSync(fdPath, "utf8"));
  });

  // FAFF-1299: legacy root lines migrate with zero root edits and no warning.
  withTmp((dir) => {
    const seed = ".faff/*\n!.faff/anchors/\n";
    fs.writeFileSync(path.join(dir, ".gitignore"), seed);
    const res = gitignoreEnsure(dir);
    const raw = fs.readFileSync(res.path, "utf8");
    check("legacy root lines: both preserved", raw.startsWith(seed) && lineIndex(raw, ".faff/*") === 0 && lineIndex(raw, "!.faff/anchors/") === 1);
    check("legacy root lines: neither re-appended", raw.split("\n").filter((l) => l === ".faff/*").length === 1 && raw.split("\n").filter((l) => l === "!.faff/anchors/").length === 1);
    check("legacy root lines: no warning", res.warnings.length === 0);
  });

  // FAFF-1299: hazardous root lines warn once each, still write, never throw.
  for (const hazard of ["**/.faff/", ".faff/**"]) {
    withTmp((dir) => {
      fs.writeFileSync(path.join(dir, ".gitignore"), `${hazard}\n`);
      const res = gitignoreEnsure(dir);
      check(`hazard \`${hazard}\`: exactly one warning naming the line and \`.faff/*\``, res.warnings.length === 1 && res.warnings[0].includes(`\`${hazard}\``) && res.warnings[0].includes("`.faff/*`"));
      check(`hazard \`${hazard}\`: \`.faff/.gitignore\` still written`, fs.existsSync(path.join(dir, ".faff", ".gitignore")));
    });
  }
  withTmp((dir) => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".faff\n/**/.faff/**\n");
    const res = gitignoreEnsure(dir);
    check("two hazardous lines: two warnings in file order", res.warnings.length === 2 && res.warnings[0].includes("`.faff`") && res.warnings[1].includes("`/**/.faff/**`"));
  });

  // Existing-literal preservation (append-only) ─────────────────────────────────
  withTmp((dir) => {
    const seed = "node_modules/\n.faffrc.local.yaml\n.faffrc.*.yaml\n!.faffrc.example.yaml\n";
    fs.writeFileSync(path.join(dir, ".gitignore"), seed);
    const res = gitignoreEnsure(dir);
    const raw = fs.readFileSync(res.path, "utf8");
    check("existing lines: root file is byte-identical (nothing removed, nothing added)", raw === seed && res.added.length === 0);
  });

  // FAFF-1062 — --local pattern-set contract ─────────────────────────────────────
  check("local set contains `.faff/` wholesale (not `.faff/*`)", FAFF_GITIGNORE_PATTERNS_LOCAL.includes(".faff/"));
  check("local set contains no `.faffrc`-stemmed entry", FAFF_GITIGNORE_PATTERNS_LOCAL.every((p) => !p.includes(".faffrc")));
  check("local set does NOT carry the anchors carve-out negation", !FAFF_GITIGNORE_PATTERNS_LOCAL.includes("!.faff/anchors/"));

  // FAFF-1062/FAFF-1385 — --local resolves via `git rev-parse --git-path info/exclude`
  // and writes there; standard mode unaffected ──────
  withGitRepo((dir) => {
    const res = gitignoreEnsure(dir, true);
    check("local: no_repo is false in a real repo", res.no_repo === false);
    check("local: target is the repo's info/exclude", res.path === path.join(dir, ".git", "info", "exclude"));
    const raw = fs.readFileSync(res.path, "utf8");
    check("local: no `.faffrc` line written", !raw.includes(".faffrc"));
    check("local: `.faff/` appended (not `.faff/*`)", res.added.includes(".faff/") && lineIndex(raw, ".faff/") !== -1);
    check("local: no anchors carve-out negation written", lineIndex(raw, "!.faff/anchors/") === -1);
    // .gitignore itself must be untouched by a --local run.
    check("local: .gitignore not created by a --local run", !fs.existsSync(path.join(dir, ".gitignore")));
    check("local: no `.faff/` directory or `.faff/.gitignore` created", !fs.existsSync(path.join(dir, ".faff")));
    check("local: faff_dir is null and warnings empty", res.faff_dir === null && res.warnings.length === 0);
  });
  withGitRepo((dir) => {
    fs.writeFileSync(path.join(dir, ".gitignore"), ".faff/\n");
    const res = gitignoreEnsure(dir, true);
    check("local: a hazardous root line yields no warning", res.warnings.length === 0 && res.faff_dir === null);
  });

  // FAFF-1385 — outside a git repository, --local reports it and writes nothing
  // (never fabricates a stray .git/info/exclude tree).
  withTmp((dir) => {
    const res = gitignoreEnsure(dir, true);
    check("local/no-repo: no_repo is true", res.no_repo === true);
    check("local/no-repo: path is null", res.path === null);
    check("local/no-repo: nothing added/already and no faff_dir/warnings", res.added.length === 0 && res.already.length === 0 && res.faff_dir === null && res.warnings.length === 0);
    check("local/no-repo: no .git directory created", !fs.existsSync(path.join(dir, ".git")));
  });

  // FAFF-1385 — a linked worktree resolves its common dir's info/exclude, not a
  // (nonexistent) `<worktree>/.git/info/exclude` — the bug this issue fixes.
  // `git worktree add` needs a resolvable HEAD, so this case commits once first
  // (the other --local cases above need no commit — plain `git init` is enough
  // for `git rev-parse --git-path`).
  withGitRepo((dir) => {
    spawnSync("git", ["-C", dir, "config", "user.email", "faff-selftest@example.com"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "config", "user.name", "faff-selftest"], { encoding: "utf8" });
    fs.writeFileSync(path.join(dir, "README.md"), "x\n");
    spawnSync("git", ["-C", dir, "add", "README.md"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { encoding: "utf8" });
    const wtDir = path.join(dir, "..", `${path.basename(dir)}-wt`);
    const add = spawnSync("git", ["-C", dir, "worktree", "add", "--detach", wtDir], { encoding: "utf8" });
    try {
      check("worktree: `git worktree add` succeeded", add.status === 0);
      const res = gitignoreEnsure(wtDir, true);
      check("worktree: target is the MAIN repo's info/exclude, not <worktree>/.git/info/exclude", res.path === path.join(dir, ".git", "info", "exclude"));
      check("worktree: `.faff/` written", res.added.includes(".faff/"));
      const raw = fs.readFileSync(res.path, "utf8");
      check("worktree: pattern lands on the main repo's exclude file", lineIndex(raw, ".faff/") !== -1);
    } finally {
      spawnSync("git", ["-C", dir, "worktree", "remove", "--force", wtDir], { encoding: "utf8" });
      fs.rmSync(wtDir, { recursive: true, force: true });
    }
  });

  // FAFF-1062 — .git/info/exclude carrying only git's default comment preamble is
  // treated the same as a populated .gitignore (append logic handles an all-comments file).
  withGitRepo((dir) => {
    const target = path.join(dir, ".git", "info", "exclude");
    const preamble = "# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n";
    fs.writeFileSync(target, preamble);
    const res = gitignoreEnsure(dir, true);
    const raw = fs.readFileSync(res.path, "utf8");
    check("local/all-comments: preamble preserved", raw.startsWith(preamble));
    check("local/all-comments: patterns still appended", res.added.length === FAFF_GITIGNORE_PATTERNS_LOCAL.length);
    check("local/all-comments: `.faff/` present", lineIndex(raw, ".faff/") !== -1);
  });

  // FAFF-1062 — idempotent re-run on .git/info/exclude.
  withGitRepo((dir) => {
    gitignoreEnsure(dir, true);
    const before = fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
    const res2 = gitignoreEnsure(dir, true);
    const after = fs.readFileSync(res2.path, "utf8");
    check("local re-run: no lines added (idempotent)", res2.added.length === 0);
    check("local re-run: file is byte-identical", before === after);
  });

  // FAFF-1062: standard mode (no --local) writes both ignore files, the anchors
  // carve-out landing in `.faff/.gitignore`, even when a .git/info/exclude also exists
  // (regression: the targets are independent).
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    const res = gitignoreEnsure(dir, false);
    check("standard mode: target is .gitignore", res.path === path.join(dir, ".gitignore"));
    check("standard mode: nothing written to the root .gitignore", res.added.length === 0 && !fs.existsSync(res.path));
    check("standard mode: anchors carve-out lands in `.faff/.gitignore`, not the root file", res.faff_dir.added.includes("!/anchors/") && !res.added.includes("!.faff/anchors/"));
    check("standard mode: .git/info/exclude not written by a standard run", !fs.existsSync(path.join(dir, ".git", "info", "exclude")));
  });

  console.log(fail ? `gitignore-ensure selftest: ${fail} FAILED` : `gitignore-ensure selftest: all checks passed`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const GITIGNORE_ENSURE_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--local": { arity: 0 } } };

function describeTarget(target) {
  if (!target.added.length && !target.already.length) return `${target.path} needs no faff lines (nothing in this target's pattern set)`;
  if (!target.added.length) return `${target.path} — already ignores faff's local artifacts (no change)`;
  const verb = target.created ? "created" : "updated";
  return `${verb} ${target.path} — added: ${target.added.join(", ")}`;
}

function cmdGitignoreEnsure(args) {
  if (args.includes("--selftest")) return gitignoreEnsureSelftest();
  const { values, errors } = parseArgs(args, GITIGNORE_ENSURE_SPEC);
  if (errors.length) return usageError(errors, "usage: faff gitignore-ensure [--root DIR] [--local] [--json]");
  const root = values["--root"] || findRoot();
  const asJson = !!values["--json"];
  const local = !!values["--local"];

  let result;
  try {
    result = gitignoreEnsure(root, local);
  } catch (e) {
    process.stderr.write(`faff gitignore-ensure: ${e.message}\n`);
    return 2;
  }

  if (result.no_repo) {
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log("not a git repository — no .git/info/exclude to update; wrote nothing");
    }
    return 0;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(describeTarget(result));
    if (result.faff_dir) console.log(describeTarget(result.faff_dir));
    for (const w of result.warnings) console.log(w);
  }
  return 0;
}


module.exports = { FAFF_DIR_GITIGNORE_PATTERNS, FAFF_GITIGNORE_DIR_CLEAN_PATTERNS, FAFF_GITIGNORE_DIR_HAZARD_PATTERNS, FAFF_GITIGNORE_PATTERNS, FAFF_GITIGNORE_PATTERNS_LOCAL, GITIGNORE_HEADER, buildGitignoreAppendBlock, cmdGitignoreEnsure, gitignoreDirHazardLines, gitignoreEnsure, gitignoreHasPattern, gitignoreMentionsFaffDir, stripTrailingSlash };
