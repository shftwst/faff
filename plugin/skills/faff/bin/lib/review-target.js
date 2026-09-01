// ===========================================================================
// === region:factory — review-target — FAFF-957: resolve the correct diff target for a build-lane review ===
// Under a worktree build lane the harness session's process cwd stays at the MAIN checkout
// (FAFF-595 de-hooked `EnterWorktree`; graft now just `cd`s inside individual Bash calls, which
// never moves the harness's own cwd). A forked ad-hoc `/code-review` with no explicit target
// resolves "the current diff" against that ambient cwd — so it silently reviews whichever branch
// the main checkout happens to be on, not the build's actual diff (the FAFF-930 incident: an
// ambient cwd on the FAFF-947 branch, reviewed instead of the FAFF-930 PR under build).
//
// This module is the faff-owned fix: a pure-logic sibling of `worktree-root` / `build-progress`,
// two modes —
//   --resolve  emits the correct explicit review target for an issue under build: `pr:<n>` when
//              an open PR exists for its branch, else the worktree path + branch + base (pre-PR).
//   --guard    compares the AMBIENT cwd's HEAD branch against the resolved branch-under-build;
//              exits non-zero (naming the correct target) on a mismatch, so a review that would
//              silently bind to the wrong tree is refused loudly instead of producing a wrong
//              verdict.
//
// Reuses existing resolvers, never a third one (FAFF-382's single-sourced-resolution principle):
//   - `parseWorktreeEntries` / `ownMatches` (worktree-prune.js) — the same issue-id token matcher
//     `worktree-check` uses, so a `faff-12` claim can never collide with a peer's `faff-126`.
//   - `resolveBaseRef` (worktree-check.js) — shells the bundled `remote-diff-base.sh`, the one
//     fail-loud base resolver every other remote-backed diff (review/build-progress/resume) uses.
//   - `gh pr list --head <branch> --state open --json number` — cwd-independent PR resolution
//     (the incident's own recovery, `gh pr diff 797`, worked precisely because it was explicit).
//
// Fail-safe direction: an unresolvable branch/target (ambiguous or missing worktree) REFUSES
// (exit 2) rather than silently passing — a wrong-diff review that passes is the harm being
// prevented (see docs/specs/2026-09-01-FAFF-957-worktree-aware-review-target-design.md).
// ===========================================================================

const { spawnSync } = require("node:child_process");
const { findRoot } = require("./shared-infra");
const { parseWorktreeEntries, ownMatches } = require("./worktree-prune");
const { resolveBaseRef } = require("./worktree-check");
const { parseArgs, usageError } = require("./argv");

// --- pure ------------------------------------------------------------------

// formatTarget — PURE. The printable explicit target string for a resolved review target: the
// PR-number form (`pr:<n>`) when a PR was found, else a worktree/branch/base flag-string a caller
// can pass straight through. No I/O.
function formatTarget(result) {
  if (!result) return null;
  if (result.kind === "pr") return `pr:${result.pr}`;
  return `--path ${result.path} --base ${result.base} --branch ${result.branch}`;
}

// --- impure: git/gh reads, no writes ---------------------------------------

// matchWorktreeForIssue — resolve the SINGLE worktree entry (path + branch) for `issue`, reusing
// worktree-prune.js's own token matcher so this can never collide on an issue-id prefix
// (`faff-12` vs `faff-126`) any differently than worktree-check/worktree-prune already do.
// Returns { ok:true, entry } or { ok:false, reason, message } — `reason` mirrors worktree-check's
// vocabulary (`no-worktree` | `ambiguous-match` | `no-branch` | `git-unavailable`).
function matchWorktreeForIssue(root, issue) {
  const entries = parseWorktreeEntries(root);
  if (entries === null) return { ok: false, reason: "git-unavailable", message: "not a git work tree (or git unavailable)" };
  const sel = { paths: [], branch: null, issue };
  const matches = entries.filter((e) => ownMatches(e, sel));
  if (matches.length === 0) return { ok: false, reason: "no-worktree", message: `no worktree resolvable for issue '${issue}'` };
  if (matches.length > 1) return { ok: false, reason: "ambiguous-match", message: `ambiguous: ${matches.length} worktrees match issue '${issue}'` };
  const entry = matches[0];
  if (!entry.branch) return { ok: false, reason: "no-branch", message: `worktree '${entry.path}' for issue '${issue}' has no resolvable branch` };
  return { ok: true, entry };
}

// resolvePrNumber — `gh pr list --head <branch> --state open`, cwd-independent (git repo context
// only, no reliance on which worktree is "current"). Any gh failure/timeout/unparseable output is
// treated as "no open PR" (never a hard error) — a PR-resolution hiccup falls back to the
// pre-PR worktree/branch target, which is still a correct (if less specific) target, never a wrong
// one. `cwd` should be a path inside the repo (any worktree works; gh resolves the remote itself).
function resolvePrNumber(cwd, branch) {
  const r = spawnSync("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "number"], { cwd, encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || typeof r.stdout !== "string") return { found: false };
  let data;
  try { data = JSON.parse(r.stdout); } catch { return { found: false }; }
  if (!Array.isArray(data) || data.length === 0) return { found: false };
  const n = data[0] && Number(data[0].number);
  if (!Number.isFinite(n) || n <= 0) return { found: false };
  return { found: true, pr: n };
}

// resolveReviewTarget — the composed resolver both --resolve and --guard drive: match the
// worktree/branch for `issue`, resolve the ref-to-ref base, then prefer an open PR over the
// pre-PR worktree target. Returns { ok:true, result } or { ok:false, reason, message }.
function resolveReviewTarget(root, issue) {
  const m = matchWorktreeForIssue(root, issue);
  if (!m.ok) return m;
  const { entry } = m;
  const { base, detail } = resolveBaseRef(entry.path);
  if (!base) return { ok: false, reason: "base-unresolvable", message: `cannot certify target — base ref unresolvable: ${detail}` };
  const pr = resolvePrNumber(entry.path, entry.branch);
  const result = pr.found
    ? { issue, kind: "pr", pr: pr.pr, branch: entry.branch, path: entry.path, base }
    : { issue, kind: "worktree", path: entry.path, branch: entry.branch, base };
  result.target = formatTarget(result);
  return { ok: true, result };
}

// --- CLI ---------------------------------------------------------------

const REVIEW_TARGET_SPEC = { flags: {
  "--resolve": { arity: 0 }, "--guard": { arity: 0 }, "--issue": { arity: 1 },
  "--run-dir": { arity: 1 }, "--root": { arity: 1 }, "--json": { arity: 0 }, "--selftest": { arity: 0 },
} };

function cmdReviewTarget(args) {
  if (args.includes("--selftest")) return reviewTargetSelftest();
  const { values, errors } = parseArgs(args, REVIEW_TARGET_SPEC);
  const usage = "usage: faff review-target [--resolve|--guard] --issue ID [--run-dir DIR] [--root DIR] [--json]";
  if (errors.length) return usageError(errors, usage);
  if (values["--resolve"] && values["--guard"]) return usageError([{ code: "bad-arity", flag: "--guard", detail: "--resolve and --guard are mutually exclusive" }], usage);
  const asJson = !!values["--json"];
  const issue = values["--issue"] || null;
  const root = values["--root"] || findRoot();
  const guardMode = !!values["--guard"];

  if (!guardMode) {
    // --resolve (the default mode when --guard is absent).
    if (!issue) return usageError([{ code: "missing-value", flag: "--issue", detail: "--issue is required for --resolve" }], usage);
    const r = resolveReviewTarget(root, issue);
    if (!r.ok) {
      if (asJson) console.log(JSON.stringify({ issue, error: r.message, reason: r.reason }));
      else process.stderr.write(`faff review-target: ${r.message}\n`);
      return 2;
    }
    if (asJson) console.log(JSON.stringify(r.result));
    else console.log(r.result.target);
    return 0;
  }

  // --guard: no --issue at all -> nothing to guard against (an ad-hoc invocation outside any
  // known build lane) -> no-op, exit 0. This is the ONLY case that reads as "not in a worktree
  // build lane" — once --issue names a specific build, an unresolvable target always refuses
  // (never a silent pass; FAFF-957 AC6).
  if (!issue) {
    if (asJson) console.log(JSON.stringify({ issue: null, ok: true, note: "no --issue given — not in a worktree build lane, nothing to guard" }));
    return 0;
  }

  const r = resolveReviewTarget(root, issue);
  if (!r.ok) {
    if (asJson) console.log(JSON.stringify({ issue, error: r.message, reason: r.reason }));
    else process.stderr.write(`faff review-target --guard: cannot certify — ${r.message}\n`);
    return 2;
  }

  const g = spawnSync("git", ["-C", process.cwd(), "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  const ambientBranch = g.status === 0 && typeof g.stdout === "string" ? g.stdout.trim() : null;
  if (!ambientBranch) {
    if (asJson) console.log(JSON.stringify({ issue, error: "cannot resolve ambient cwd's HEAD branch", reason: "git-unavailable" }));
    else process.stderr.write("faff review-target --guard: cannot resolve ambient cwd's HEAD branch\n");
    return 2;
  }

  const match = ambientBranch === r.result.branch;
  if (match) {
    if (asJson) console.log(JSON.stringify({ issue, ok: true, ambient_branch: ambientBranch, branch: r.result.branch }));
    return 0;
  }
  const msg = `ambient cwd is on '${ambientBranch}', not the branch under build for ${issue} ('${r.result.branch}') — use ${r.result.target}`;
  if (asJson) console.log(JSON.stringify({ issue, ok: false, ambient_branch: ambientBranch, branch: r.result.branch, target: r.result.target }));
  process.stderr.write(`faff review-target --guard: ${msg}\n`);
  return 1;
}

// In-memory selftest — the pure `formatTarget` core only (matchWorktreeForIssue / resolvePrNumber /
// resolveBaseRef are impure git/gh wrappers already covered, via their own primitives, by
// worktree-check's and worktree-prune's own selftests; the CLI routing is exercised through the
// real entrypoint in test/review-target.test.mjs, per lint-cli-coverage's belt-and-braces allowance).
function reviewTargetSelftest() {
  let fail = 0;
  const ok = (n, c) => { if (!c) { console.log(`FAIL ${n}`); fail++; } else console.log(`ok   ${n}`); };

  ok("pr target formats as pr:<n>",
    formatTarget({ kind: "pr", pr: 797 }) === "pr:797");
  ok("worktree target formats as --path/--base/--branch",
    formatTarget({ kind: "worktree", path: "/wt/faff-930", base: "origin/main", branch: "faff-930-x" })
      === "--path /wt/faff-930 --base origin/main --branch faff-930-x");
  ok("null result formats to null",
    formatTarget(null) === null);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (review-target formatTarget, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { cmdReviewTarget, formatTarget, matchWorktreeForIssue, resolvePrNumber, resolveReviewTarget, reviewTargetSelftest };
