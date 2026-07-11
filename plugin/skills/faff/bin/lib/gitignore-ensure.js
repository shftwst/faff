// ===========================================================================
// === region:factory — gitignore-ensure — FAFF-67: idempotently, non-destructively add faff's local ===
// artifacts (the .faffrc config in all accepted forms + the .faff/ dir) to the
// project's .gitignore. Append-only: never reorders, deduplicates, rewrites, or
// removes any existing line. A run against an already-correct file is a clean
// no-op (byte-identical). Single source of truth for the pattern set, so the
// future config writer (FAFF-5) and bootstrap skill (FAFF-6) reach the same set.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { findRoot } = require("./shared-infra");

const FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",            // bare legacy form
  ".faffrc.yml",        // legacy YAML form
  ".faffrc.yaml",       // canonical form
  ".faff/",             // the local artifacts dir (trailing slash = dir-only)
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

function cmdGitignoreEnsure(args) {
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
