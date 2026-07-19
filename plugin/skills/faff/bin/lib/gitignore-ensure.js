// ===========================================================================
// === region:factory — gitignore-ensure — FAFF-67: idempotently, non-destructively add faff's local ===
// artifacts (the .faffrc config in all accepted forms + the .faff/ dir) to the
// project's .gitignore. Append-only: never reorders, deduplicates, rewrites, or
// removes any existing line. A run against an already-correct file is a clean
// no-op (byte-identical). Single source of truth for the pattern set, so the
// future config writer (FAFF-5) and bootstrap skill (FAFF-6) reach the same set.
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
// order, so array order is file order). The legacy names (`.faffrc`, `.faffrc.yml`)
// stay ignored (the resolver errors loudly on them anyway). This command is
// append-only: it NEVER removes an existing line — an existing `.faffrc.yaml` or
// `.faffrc.local.yaml` line stays put; migration off it is deliberate (see `faff
// config check`'s posture finding), never an automated line-drop that could sweep a
// private value into a commit.
const FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",               // bare legacy form
  ".faffrc.yml",           // legacy YAML form
  ".faffrc.*.yaml",        // FAFF-548: glob — every machine-local overlay variant
  "!.faffrc.example.yaml", // FAFF-548: negation — keep the tracked template out of the glob (must follow the glob)
  ".faff/",                // the local artifacts dir (trailing slash = dir-only)
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

function buildGitignoreAppendBlock(raw, missing) {
  const parts = [];
  if (raw !== "" && !raw.endsWith("\n")) parts.push("\n"); // finish a no-EOL last line
  if (raw.trim() !== "") parts.push("\n");                  // one blank separator line
  parts.push(GITIGNORE_HEADER + "\n");
  for (const p of missing) parts.push(p + "\n");
  return parts.join("");
}

function gitignoreEnsure(root) {
  const target = path.join(root, ".gitignore");
  const existed = fs.existsSync(target);
  const raw = existed ? fs.readFileSync(target, "utf8") : "";
  const lines = raw.split("\n");
  const missing = FAFF_GITIGNORE_PATTERNS.filter((p) => !gitignoreHasPattern(p, lines));
  const already = FAFF_GITIGNORE_PATTERNS.filter((p) => gitignoreHasPattern(p, lines));
  if (missing.length === 0) {
    return { path: target, created: false, added: [], already };
  }
  const block = buildGitignoreAppendBlock(raw, missing);
  fs.writeFileSync(target, raw + block);
  return { path: target, created: !existed, added: missing, already };
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
  });

  // Idempotent no-op on re-run ───────────────────────────────────────────────────
  withTmp((dir) => {
    gitignoreEnsure(dir);
    const before = fs.readFileSync(path.join(dir, ".gitignore"), "utf8");
    const res2 = gitignoreEnsure(dir);
    const after = fs.readFileSync(res2.path, "utf8");
    check("re-run: no lines added (idempotent)", res2.added.length === 0);
    check("re-run: file is byte-identical", before === after);
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

  console.log(fail ? `gitignore-ensure selftest: ${fail} FAILED` : `gitignore-ensure selftest: all checks passed`);
  return fail ? 1 : 0;
}

function cmdGitignoreEnsure(args) {
  if (args.includes("--selftest")) return gitignoreEnsureSelftest();
  let root = null;
  const ri = args.indexOf("--root");
  if (ri !== -1) root = args[ri + 1];
  root = root || findRoot();
  const asJson = args.includes("--json");

  let result;
  try {
    result = gitignoreEnsure(root);
  } catch (e) {
    process.stderr.write(`faff gitignore-ensure: ${e.message}\n`);
    return 2;
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.added.length) {
    const verb = result.created ? "created" : "updated";
    console.log(`${verb} ${result.path} — added: ${result.added.join(", ")}`);
  } else {
    console.log(`${result.path} — already ignores faff's local artifacts (no change)`);
  }
  return 0;
}


module.exports = { FAFF_GITIGNORE_PATTERNS, GITIGNORE_HEADER, buildGitignoreAppendBlock, cmdGitignoreEnsure, gitignoreEnsure, gitignoreHasPattern, stripTrailingSlash };
