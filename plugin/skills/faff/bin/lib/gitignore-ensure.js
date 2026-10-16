// ===========================================================================
// === region:factory — gitignore-ensure — FAFF-67: idempotently, non-destructively add faff's local ===
// artifacts to two ignore files. The project's root .gitignore gets the repo-root
// .faffrc config forms; a committed .faff/.gitignore (FAFF-1299) gets every rule about
// paths under .faff/. Append-only: never reorders, deduplicates, rewrites, or removes
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
const { findRoot } = require("./shared-infra");

// FAFF-387: `.faffrc.yaml` is NO LONGER ignored on new bootstraps — it is the
// committable, durable base config (git is its backup + drift alarm). The
// gitignored machine-local artifact is the OVERLAY. FAFF-548: the overlay is
// matched by the GLOB `.faffrc.*.yaml`, which covers EVERY machine-local variant
// (`.faffrc.local.yaml`, `.faffrc.dev.yaml`, `.faffrc.machine.yaml`, …), not just
// the exact `local` name. The glob matches only names with a middle segment, so
// the committed base `.faffrc.yaml` is safe by construction (never appended). The
// tracked template `.faffrc.example.yaml` DOES match the glob, so a `!` negation
// re-includes it — placed AFTER the glob in the array (git honours a negation only
// when it follows the matching ignore line, and the append writer emits in array
// order, so array order is file order). NB: the negation is a single literal name —
// any FUTURE tracked `.faffrc.*.yaml` template added under a different name needs its
// own `!` negation line here (also after the glob) to stay committable. The legacy names (`.faffrc`, `.faffrc.yml`)
// stay ignored (the resolver errors loudly on them anyway). This command is
// append-only: it NEVER removes an existing line — an existing `.faffrc.yaml` or
// `.faffrc.local.yaml` line stays put; migration off it is deliberate (see `faff
// config check`'s posture finding), never an automated line-drop that could sweep a
// private value into a commit.
// FAFF-1299: the root set holds repo-root files only. A repo whose root file already
// carries `.faff/*` and `!.faff/anchors/` keeps both lines (never removed, never
// re-offered); `.faff/.gitignore` overrides them, so migration needs no root edit.
const FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",               // bare legacy form
  ".faffrc.yml",           // legacy YAML form
  ".faffrc.*.yaml",        // FAFF-548: glob — every machine-local overlay variant
  "!.faffrc.example.yaml", // FAFF-548: negation — keep the tracked template out of the glob (must follow the glob)
];

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
// `.gitignore`. Because THIS target is personal-only, it can be strictly wider than the
// shared set above: `.faffrc.yaml` (the committable base — never ignored in `.gitignore`)
// is ADDED here, and the `.faff/anchors/` carve-out is DROPPED — `.faff/` is ignored
// wholesale, since a personal exclude file has no committed subtree to protect. Same
// glob-before-negation ordering requirement as the shared set.
const FAFF_GITIGNORE_PATTERNS_LOCAL = [
  ".faffrc",
  ".faffrc.yml",
  ".faffrc.yaml",
  ".faffrc.*.yaml",
  "!.faffrc.example.yaml",
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

// FAFF-1062: `--local` writes only `.git/info/exclude`. Standard mode writes the root
// `.gitignore` and (FAFF-1299) `.faff/.gitignore`, then warns about hazardous root lines.
function gitignoreEnsure(root, local = false) {
  if (local) {
    const result = ensureOneTarget(path.join(root, ".git", "info", "exclude"), FAFF_GITIGNORE_PATTERNS_LOCAL);
    return { ...result, faff_dir: null, warnings: [] };
  }
  const rootTarget = path.join(root, ".gitignore");
  const result = ensureOneTarget(rootTarget, FAFF_GITIGNORE_PATTERNS);
  const faffDir = ensureOneTarget(path.join(root, ".faff", ".gitignore"), FAFF_DIR_GITIGNORE_PATTERNS);
  const rootRaw = fs.readFileSync(rootTarget, "utf8");
  const warnings = gitignoreDirHazardLines(rootRaw).map((line) => hazardWarning(root, line));
  return { ...result, faff_dir: faffDir, warnings };
}

// FAFF-548 selftest — drives the real `gitignoreEnsure` fs writer against throwaway
// temp roots (never the live repo), asserting the pattern-set contract: fresh-repo
// append content + glob-before-negation order, idempotent no-op on re-run,
// existing-literal preservation (append-only), and `.faffrc.yaml` never appended.
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
  const lineIndex = (raw, s) => raw.split("\n").findIndex((l) => l.trim() === s);

  // Pure pattern-set contract (checkable without fs) ────────────────────────────
  const gi = FAFF_GITIGNORE_PATTERNS.indexOf(".faffrc.*.yaml");
  const ni = FAFF_GITIGNORE_PATTERNS.indexOf("!.faffrc.example.yaml");
  check("pattern set contains the overlay glob `.faffrc.*.yaml`", gi !== -1);
  check("pattern set contains the negation `!.faffrc.example.yaml`", ni !== -1);
  check("glob is at a lower index than the negation", gi !== -1 && ni !== -1 && gi < ni);
  check("literal `.faffrc.local.yaml` removed from the set", !FAFF_GITIGNORE_PATTERNS.includes(".faffrc.local.yaml"));
  check("committed base `.faffrc.yaml` not in the set", !FAFF_GITIGNORE_PATTERNS.includes(".faffrc.yaml"));
  check("root set equals the four repo-root patterns", JSON.stringify(FAFF_GITIGNORE_PATTERNS) === JSON.stringify([".faffrc", ".faffrc.yml", ".faffrc.*.yaml", "!.faffrc.example.yaml"]));
  check("root set carries neither `.faff/*` nor `!.faff/anchors/`", !FAFF_GITIGNORE_PATTERNS.includes(".faff/*") && !FAFF_GITIGNORE_PATTERNS.includes("!.faff/anchors/"));
  check("root set does NOT carry a bare `.faff/` (would block the carve-out)", !FAFF_GITIGNORE_PATTERNS.includes(".faff/"));

  // FAFF-1299: the `.faff/.gitignore` set, anchored, `/*` before every negation.
  check("faff-dir set equals the six anchored patterns", JSON.stringify(FAFF_DIR_GITIGNORE_PATTERNS) === JSON.stringify(["/*", "!/.gitignore", "!/anchors/", "!/templates/", "!/decisions.md", "!/conventions.md"]));
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

  // Fresh repo: append content + glob-before-negation order ──────────────────────
  withTmp((dir) => {
    const res = gitignoreEnsure(dir);
    const raw = fs.readFileSync(res.path, "utf8");
    check("fresh repo: glob appended", res.added.includes(".faffrc.*.yaml"));
    check("fresh repo: negation appended", res.added.includes("!.faffrc.example.yaml"));
    check("fresh repo: `.faffrc.yaml` never appended", !res.added.includes(".faffrc.yaml") && lineIndex(raw, ".faffrc.yaml") === -1);
    const g = lineIndex(raw, ".faffrc.*.yaml");
    const n = lineIndex(raw, "!.faffrc.example.yaml");
    check("fresh repo: glob line strictly before negation line", g !== -1 && n !== -1 && g < n);
    check("fresh repo: root file has no `.faff` or `!.faff` line", !raw.split("\n").some((l) => /^!?\.faff(?!rc)/.test(l)));
    const fdPath = path.join(dir, ".faff", ".gitignore");
    check("fresh repo: `.faff/` and `.faff/.gitignore` created", fs.existsSync(fdPath) && res.faff_dir.created === true && res.faff_dir.path === fdPath);
    const fd = fs.readFileSync(fdPath, "utf8");
    check("fresh repo: `.faff/.gitignore` holds all six patterns", FAFF_DIR_GITIGNORE_PATTERNS.every((p) => lineIndex(fd, p) !== -1));
    const star = lineIndex(fd, "/*");
    check("fresh repo: `/*` strictly before every negation in `.faff/.gitignore`", FAFF_DIR_GITIGNORE_PATTERNS.filter((p) => p.startsWith("!")).every((p) => star < lineIndex(fd, p)));
    check("fresh repo: no warnings", res.warnings.length === 0);
  });

  // Idempotent no-op on re-run ───────────────────────────────────────────────────
  withTmp((dir) => {
    gitignoreEnsure(dir);
    const fdPath = path.join(dir, ".faff", ".gitignore");
    const before = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    const fdBefore = fs.readFileSync(fdPath, "utf8");
    const res2 = gitignoreEnsure(dir);
    const after = fs.readFileSync(res2.path, "utf8");
    check("re-run: no lines added (idempotent)", res2.added.length === 0 && res2.faff_dir.added.length === 0);
    check("re-run: root file is byte-identical", before === after);
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
    const seed = "node_modules/\n.faffrc.local.yaml\n";
    fs.writeFileSync(path.join(dir, ".gitignore"), seed);
    const res = gitignoreEnsure(dir);
    const raw = fs.readFileSync(res.path, "utf8");
    check("existing literal: pre-existing `.faffrc.local.yaml` line preserved", lineIndex(raw, ".faffrc.local.yaml") !== -1);
    check("existing literal: seed line `node_modules/` preserved", lineIndex(raw, "node_modules/") !== -1);
    check("existing literal: glob appended alongside the old literal", res.added.includes(".faffrc.*.yaml"));
    const g = lineIndex(raw, ".faffrc.*.yaml");
    const n = lineIndex(raw, "!.faffrc.example.yaml");
    check("existing literal: appended negation still follows the glob", g !== -1 && n !== -1 && g < n);
    check("existing literal: `.faffrc.yaml` never appended", lineIndex(raw, ".faffrc.yaml") === -1);
  });

  // FAFF-1062 — --local pattern-set contract ─────────────────────────────────────
  check("local set contains `.faffrc.yaml` (never in the shared set)", FAFF_GITIGNORE_PATTERNS_LOCAL.includes(".faffrc.yaml"));
  check("local set contains `.faff/` wholesale (not `.faff/*`)", FAFF_GITIGNORE_PATTERNS_LOCAL.includes(".faff/"));
  check("local set does NOT carry the anchors carve-out negation", !FAFF_GITIGNORE_PATTERNS_LOCAL.includes("!.faff/anchors/"));
  {
    const lgi = FAFF_GITIGNORE_PATTERNS_LOCAL.indexOf(".faffrc.*.yaml");
    const lni = FAFF_GITIGNORE_PATTERNS_LOCAL.indexOf("!.faffrc.example.yaml");
    check("local set: glob is at a lower index than the negation", lgi !== -1 && lni !== -1 && lgi < lni);
  }

  // FAFF-1062 — --local writes .git/info/exclude, standard mode unaffected ──────
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    const res = gitignoreEnsure(dir, true);
    check("local: target is .git/info/exclude", res.path === path.join(dir, ".git", "info", "exclude"));
    const raw = fs.readFileSync(res.path, "utf8");
    check("local: `.faffrc.yaml` appended", res.added.includes(".faffrc.yaml") && lineIndex(raw, ".faffrc.yaml") !== -1);
    check("local: `.faff/` appended (not `.faff/*`)", res.added.includes(".faff/") && lineIndex(raw, ".faff/") !== -1);
    check("local: no anchors carve-out negation written", lineIndex(raw, "!.faff/anchors/") === -1);
    // .gitignore itself must be untouched by a --local run.
    check("local: .gitignore not created by a --local run", !fs.existsSync(path.join(dir, ".gitignore")));
    check("local: no `.faff/` directory or `.faff/.gitignore` created", !fs.existsSync(path.join(dir, ".faff")));
    check("local: faff_dir is null and warnings empty", res.faff_dir === null && res.warnings.length === 0);
  });
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".gitignore"), ".faff/\n");
    const res = gitignoreEnsure(dir, true);
    check("local: a hazardous root line yields no warning", res.warnings.length === 0 && res.faff_dir === null);
  });

  // FAFF-1062 — .git/info/exclude carrying only git's default comment preamble is
  // treated the same as a populated .gitignore (append logic handles an all-comments file).
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
    const preamble = "# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n";
    fs.writeFileSync(path.join(dir, ".git", "info", "exclude"), preamble);
    const res = gitignoreEnsure(dir, true);
    const raw = fs.readFileSync(res.path, "utf8");
    check("local/all-comments: preamble preserved", raw.startsWith(preamble));
    check("local/all-comments: patterns still appended", res.added.length === FAFF_GITIGNORE_PATTERNS_LOCAL.length);
    check("local/all-comments: `.faffrc.yaml` present", lineIndex(raw, ".faffrc.yaml") !== -1);
  });

  // FAFF-1062 — idempotent re-run on .git/info/exclude.
  withTmp((dir) => {
    fs.mkdirSync(path.join(dir, ".git", "info"), { recursive: true });
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
    const raw = fs.readFileSync(res.path, "utf8");
    check("standard mode: `.faffrc.yaml` never appended", lineIndex(raw, ".faffrc.yaml") === -1);
    check("standard mode: anchors carve-out lands in `.faff/.gitignore`, not the root file", res.faff_dir.added.includes("!/anchors/") && !res.added.includes("!.faff/anchors/"));
    check("standard mode: .git/info/exclude not written by a standard run", !fs.existsSync(path.join(dir, ".git", "info", "exclude")));
  });

  console.log(fail ? `gitignore-ensure selftest: ${fail} FAILED` : `gitignore-ensure selftest: all checks passed`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");
const GITIGNORE_ENSURE_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--local": { arity: 0 } } };

function describeTarget(target) {
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
