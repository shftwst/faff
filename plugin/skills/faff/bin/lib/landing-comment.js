// === region:factory — landing-comment — FAFF-860: renders the ready-to-land PR comment (never merges) ===
//
// The verb behind `.github/actions/faff-landing-comment`. When a faff PR goes
// green, the workflow shells this verb to render ONE PR-comment body carrying the
// pre-filled, copy-pasteable `faff merge-gate --execute` command (graft, floor
// merge-ok), the blocking reasons (graft, floor refuse), or the `--human-override`
// variant (non-graft). This file NEVER merges: it only maps the PR's changed files
// to its committed anchor (`resolveAnchor`), asks `faff merge-gate --check-only`
// for the verdict, and renders the body (`renderBody`). The `--execute` /
// `--human-override` text lives INSIDE the rendered comment for a human to copy —
// this verb invokes neither the merge verb nor `gh pr merge`, under any path.
//
// Factory (not governance) for the same reason governance-check sits here: it
// derives the merge floor by shelling merge-gate (a factory verb) and reads
// FLOOR_LEVELS from contract-defs (a factory identifier).

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { ENTRYPOINT } = require("./shared-infra");
const { FLOOR_LEVELS } = require("./contract-defs");

// The case-insensitive issue-shaped token, upcased — byte-for-byte the derivation
// governance-check applies to the PR head branch (governance-check.js ISSUE_BRANCH_RE
// / matchIssueFromBranchName; the composite Action mirrors it at action.yml lines
// 171-181). The head branch is the sole source of truth for a faff PR's issue.
const ISSUE_BRANCH_RE = /[A-Za-z]+-[0-9]+/;

function matchIssueFromBranch(headRef) {
  if (typeof headRef !== "string") return null;
  const m = headRef.match(ISSUE_BRANCH_RE);
  return m ? m[0].toUpperCase() : null;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// PURE. `files` is an array of changed-file paths; `headRef` is the PR head branch
// name. Maps the diff to its anchor:
//   - no leaf under <anchorsRoot>/<run>/<issue>/ → { kind:"non-graft", issue } (the
//     FAFF-673 non-graft signature; issue derived from the branch).
//   - a leaf whose <issue> equals the branch-derived issue → { kind:"graft",
//     anchorRunDir, issue, run, headRef }.
//   - the diff carries anchor leaves but NONE for the branch issue, OR the matching
//     leaves disagree on <run> → THROWS (fail-loud; never guess against an
//     unrelated run's floor).
// No fs/git: level is resolved separately by the caller (`resolveLevel`).
function resolveAnchor(files, headRef, anchorsRoot = ".faff/anchors") {
  const branchIssue = matchIssueFromBranch(headRef);
  const root = String(anchorsRoot).replace(/\/+$/, "");
  const leafRe = new RegExp("^" + escapeRegex(root) + "/([^/]+)/([^/]+)/");
  const leaves = [];
  for (const f of files || []) {
    const s = String(f).trim();
    if (!s) continue;
    const m = s.match(leafRe);
    if (m) leaves.push({ run: m[1], issue: m[2] });
  }
  if (leaves.length === 0) return { kind: "non-graft", issue: branchIssue };

  // A PR is one branch = one issue. Keep only leaves whose <issue> is this PR's own.
  const own = leaves.filter((l) => l.issue === branchIssue);
  if (own.length === 0) {
    const others = [...new Set(leaves.map((l) => l.issue))].join(", ");
    throw new Error(`landing-comment: the diff carries anchor leaf/leaves for other issue(s) [${others}] but none for the branch issue ${branchIssue || "(unresolved from head ref)"} — refusing to guess`);
  }
  const runs = [...new Set(own.map((l) => l.run))];
  if (runs.length > 1) {
    throw new Error(`landing-comment: anchor leaves for ${branchIssue} disagree on <run> [${runs.join(", ")}] — refusing to guess`);
  }
  const run = runs[0];
  return { kind: "graft", anchorRunDir: `${root}/${run}`, issue: branchIssue, run, headRef };
}

// PURE. Renders the FULL comment string wrapped in the hidden marker pair keyed by
// PR number (the review-findings comment-identity idiom, faff/SKILL.md). The
// `--execute` / `--human-override` text is for a human to copy — this function
// renders, it never runs anything.
//   opts = { pr, kind, issue, run, level, verdict, blockers }
function renderBody(opts) {
  const { pr, kind, issue, run, level, verdict } = opts || {};
  const blockers = Array.isArray(opts && opts.blockers) ? opts.blockers : [];
  const open = `<!-- faff-landing:${pr} -->`;
  const close = `<!-- /faff-landing:${pr} -->`;
  let inner;

  if (kind === "non-graft") {
    inner = [
      "No graft floor on this PR (no anchor artifacts). If this is a legitimate non-graft",
      "change, land it yourself in a real terminal:",
      "",
      `    faff effects declare --run <run> --issue ${issue} --step merge <<'EOF'`,
      `    [{"kind":"merge","target":"pr:${pr}","reversible":true}]`,
      "    EOF",
      `    faff merge-gate --pr ${pr} --issue ${issue} \\`,
      '      --execute --human-override --interactive --override-reason "<what merged + why no floor applies>" \\',
      '      --merge-args "--squash --delete-branch"',
    ].join("\n");
  } else if (verdict === "merge-ok") {
    inner = [
      "Ready to land. Run this locally in a real terminal:",
      "",
      `    faff effects declare --run-dir .faff/anchors/${run} --issue ${issue} --step merge <<'EOF'`,
      `    [{"kind":"merge","target":"pr:${pr}","reversible":true}]`,
      "    EOF",
      `    faff merge-gate --pr ${pr} --issue ${issue} --run-dir .faff/anchors/${run} --level ${level} \\`,
      '      --execute --merge-args "--squash --delete-branch"',
    ].join("\n");
  } else {
    const lines = blockers.length ? blockers.map((b) => `    - ${b}`) : ["    - (no blocker detail reported)"];
    inner = [
      "Not ready to land. `faff merge-gate --check-only` reports these blockers:",
      "",
      ...lines,
      "",
      "Resolve them and push; this comment updates when CI re-runs.",
    ].join("\n");
  }

  return `${open}\n${inner}\n${close}`;
}

// Resolve the merge-floor level from the committed anchor's run-ledger.json
// (`.level`). Tries `git show <headRef>:<path>` first (the committed byte-copy),
// falls back to reading the checked-out working-tree file, then defaults to "L3"
// when unreadable — this is a comment, not a gate, so a level miss never blocks.
function resolveLevel(anchorRunDir, issue, headRef, cwd) {
  const rel = `${anchorRunDir}/${issue}/run-ledger.json`;
  let raw = null;
  if (headRef) {
    const r = spawnSync("git", ["show", `${headRef}:${rel}`], { cwd, encoding: "utf8", timeout: 10000 });
    if (r.status === 0) raw = r.stdout;
  }
  if (raw === null) {
    try { raw = fs.readFileSync(path.join(cwd, rel), "utf8"); } catch { raw = null; }
  }
  if (raw === null) return "L3";
  try {
    const led = JSON.parse(raw);
    if (led && FLOOR_LEVELS.includes(led.level)) return led.level;
  } catch { /* unreadable/malformed ledger → default below */ }
  return "L3";
}

const LANDING_COMMENT_SPEC = { flags: {
  "--selftest": { arity: 0 },
  "--pr": { arity: 1 },
  "--head-ref": { arity: 1 },
  "--files-file": { arity: 1 },
  "--files-stdin": { arity: 0 },
  "--anchors-root": { arity: 1 },
} };

function cmdLandingComment(args) {
  if (args.includes("--selftest")) return landingCommentSelftest();

  const { values, errors } = parseArgs(args, LANDING_COMMENT_SPEC);
  if (errors.length) return usageError(errors, "usage: faff landing-comment --pr N --head-ref REF (--files-file PATH | --files-stdin) [--anchors-root DIR]");

  const pr = values["--pr"];
  const headRef = values["--head-ref"] || "";
  const anchorsRoot = values["--anchors-root"] || ".faff/anchors";
  if (!pr) {
    process.stderr.write("faff landing-comment: --pr N is required\n");
    return 2;
  }

  let raw = "";
  if (values["--files-stdin"]) {
    try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
  } else if (values["--files-file"]) {
    try { raw = fs.readFileSync(values["--files-file"], "utf8"); }
    catch (e) { process.stderr.write(`faff landing-comment: cannot read --files-file ${values["--files-file"]}: ${e.message}\n`); return 2; }
  } else {
    process.stderr.write("faff landing-comment: one of --files-file PATH or --files-stdin is required\n");
    return 2;
  }
  const files = raw.split("\n").map((s) => s.trim()).filter(Boolean);

  let m;
  try { m = resolveAnchor(files, headRef, anchorsRoot); }
  catch (e) { process.stderr.write(`${e.message}\n`); return 1; }

  if (m.kind === "non-graft") {
    process.stdout.write(renderBody({ pr, kind: "non-graft", issue: m.issue }) + "\n");
    return 0;
  }

  // graft — resolve the level, then ask merge-gate --check-only for the verdict.
  // NEVER --execute: --check-only returns the verdict before merge-gate's merge
  // spawn, so this path cannot merge.
  const level = resolveLevel(m.anchorRunDir, m.issue, m.headRef, process.cwd());
  const r = spawnSync(process.execPath, [
    ENTRYPOINT, "merge-gate",
    "--pr", String(pr), "--issue", m.issue,
    "--run-dir", m.anchorRunDir, "--level", level,
    "--check-only", "--json",
  ], { encoding: "utf8" });

  let verdict = "refuse";
  let blockers = ["merge-gate --check-only produced no parseable verdict"];
  const lastLine = (r.stdout || "").trim().split("\n").filter(Boolean).pop() || "";
  if (lastLine) {
    try {
      const out = JSON.parse(lastLine);
      verdict = out.verdict === "merge-ok" ? "merge-ok" : "refuse";
      blockers = Array.isArray(out.blockers) ? out.blockers : [];
    } catch { /* keep the fail-safe refuse + blocker note above */ }
  }

  process.stdout.write(renderBody({ pr, kind: "graft", issue: m.issue, run: m.run, level, verdict, blockers }) + "\n");
  return 0;
}

// --selftest — pure-function battery over resolveAnchor + renderBody (no fs/git/
// network). Exit non-zero on any failure.
function landingCommentSelftest() {
  const cases = [];
  const t = (name, ok) => cases.push([name, !!ok]);
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };

  // resolveAnchor — graft
  {
    const files = [
      ".faff/anchors/run-abc/FAFF-42/ac-checklist.json",
      "src/foo.js",
      ".faff/anchors/run-abc/FAFF-42/review-verdict.json",
    ];
    const m = resolveAnchor(files, "feature/FAFF-42-thing");
    t("resolveAnchor graft → kind graft", m.kind === "graft");
    t("resolveAnchor graft → anchorRunDir .faff/anchors/run-abc", m.anchorRunDir === ".faff/anchors/run-abc");
    t("resolveAnchor graft → run run-abc", m.run === "run-abc");
    t("resolveAnchor graft → issue FAFF-42 (upcased from branch)", m.issue === "FAFF-42");
  }
  // resolveAnchor — non-graft (no anchor leaf)
  {
    const m = resolveAnchor(["src/foo.js", "docs/x.md"], "faff-99-spike");
    t("resolveAnchor non-graft → kind non-graft", m.kind === "non-graft");
    t("resolveAnchor non-graft → issue FAFF-99 from branch", m.issue === "FAFF-99");
  }
  // resolveAnchor — fail-loud: only other-issue leaves present
  t("resolveAnchor throws when only other-issue leaves ride the diff",
    throws(() => resolveAnchor([".faff/anchors/run-x/FAFF-7/ac-checklist.json"], "feature/FAFF-42-thing")));
  // resolveAnchor — fail-loud: matching leaves disagree on <run>
  t("resolveAnchor throws when the branch issue's leaves disagree on run",
    throws(() => resolveAnchor([
      ".faff/anchors/run-a/FAFF-42/ac-checklist.json",
      ".faff/anchors/run-b/FAFF-42/review-verdict.json",
    ], "feature/FAFF-42-thing")));

  // renderBody — graft merge-ok
  {
    const body = renderBody({ pr: 12, kind: "graft", issue: "FAFF-42", run: "run-abc", level: "L3", verdict: "merge-ok", blockers: [] });
    t("renderBody merge-ok contains --execute", body.includes("--execute"));
    t("renderBody merge-ok contains faff effects declare", body.includes("faff effects declare"));
    t("renderBody merge-ok contains --run-dir .faff/anchors/run-abc", body.includes("--run-dir .faff/anchors/run-abc"));
    // FAFF-864: the declare line must point at the anchor dir merge-gate reads (--run-dir),
    // never `--run run-abc` (the live run dir), so declare + merge-gate share one ledger.
    t("renderBody merge-ok declare uses --run-dir, not bare --run", !body.includes("--run run-abc"));
    t("renderBody merge-ok wraps in the open+close markers",
      body.startsWith("<!-- faff-landing:12 -->") && body.trimEnd().endsWith("<!-- /faff-landing:12 -->"));
  }
  // renderBody — graft refuse
  {
    const blockers = ["review verdict is fail", "ac-checklist.json missing/incomplete"];
    const body = renderBody({ pr: 12, kind: "graft", issue: "FAFF-42", run: "run-abc", level: "L3", verdict: "refuse", blockers });
    t("renderBody refuse contains blocker 1 verbatim", body.includes("review verdict is fail"));
    t("renderBody refuse contains blocker 2 verbatim", body.includes("ac-checklist.json missing/incomplete"));
    t("renderBody refuse has NO --execute", !body.includes("--execute"));
    t("renderBody refuse wraps in markers",
      body.includes("<!-- faff-landing:12 -->") && body.includes("<!-- /faff-landing:12 -->"));
  }
  // renderBody — non-graft human-override
  {
    const body = renderBody({ pr: 7, kind: "non-graft", issue: "FAFF-99" });
    t("renderBody non-graft contains --human-override", body.includes("--human-override"));
    t("renderBody non-graft contains the branch issue FAFF-99", body.includes("FAFF-99"));
    t("renderBody non-graft has NO --run-dir", !body.includes("--run-dir"));
    t("renderBody non-graft wraps in markers",
      body.includes("<!-- faff-landing:7 -->") && body.includes("<!-- /faff-landing:7 -->"));
  }

  let failed = 0;
  for (const [name, ok] of cases) {
    if (!ok) failed++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
  console.log(`\nRESULT: ${failed ? "FAIL" : "PASS"} (${cases.length} cases, ${failed} failed)`);
  return failed ? 1 : 0;
}

module.exports = {
  cmdLandingComment,
  landingCommentSelftest,
  matchIssueFromBranch,
  renderBody,
  resolveAnchor,
  resolveLevel,
};
