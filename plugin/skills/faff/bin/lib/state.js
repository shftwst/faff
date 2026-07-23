// ===========================================================================
// === region:factory — state — FAFF-65: the LOCAL read-model sibling to `faff next`. Pure-adjacent: ===
// it reads only local sources (committed/git-only specs, git branches/worktrees,
// .faff/runs park records + ledger) and emits the issue's resolved state as JSON
// in `faff next`'s flag vocabulary. NO MCP/tracker access, NO mutation, NO network.
// status/held/blocked are always the literal "unknown" — they are tracker-only and
// must be filled authoritatively by the agent before calling `faff next`.
// ===========================================================================

// resolveSpec — Spec-discovery locations 3 (committed) + 4 (git-only store), most
// recent mtime wins; parse the confidence rating with a regex tolerant of banner
// blockquotes and backtick-wrapping. Spec present but unparseable → "high" + stderr note.

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const STATE_SPEC = { flags: { "--root": { arity: 1 }, "--json": { arity: 0 } }, positionals: { min: 0, max: 1, name: "issue" } };
const { spawnSync } = require("node:child_process");
const { loadConfig, resolveSpecDocsPath } = require("./config");
const { findRoot, readLedger, sortRunDirsByMtimeDesc } = require("./shared-infra");

function resolveSpec(root, issue) {
  const candidates = [];
  let specDir;
  try { specDir = resolveSpecDocsPath(root, loadConfig(root)[0], false); } catch { specDir = null; }
  if (specDir) {
    const dir = path.join(root, specDir);
    try {
      const esc = issue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`-${esc}-.*\\.md$`, "i");
      for (const name of fs.readdirSync(dir)) {
        if (re.test(name)) candidates.push(path.join(dir, name));
      }
    } catch { /* dir missing → no committed specs */ }
  }
  // Git-only store (location 4): .faff/specs/<issue>.md, case-insensitive.
  const specsDir = path.join(root, ".faff", "specs");
  try {
    for (const name of fs.readdirSync(specsDir)) {
      if (name.toLowerCase() === `${issue.toLowerCase()}.md`) candidates.push(path.join(specsDir, name));
    }
  } catch { /* no git-only store */ }

  if (!candidates.length) return ["none", null];

  // Most-recently-modified candidate wins (Spec-discovery "prefer most recent").
  let picked = null, pickedMtime = -Infinity;
  for (const c of candidates) {
    let mtime;
    try { mtime = fs.statSync(c).mtimeMs; } catch { continue; }
    if (mtime > pickedMtime) { pickedMtime = mtime; picked = c; }
  }
  if (!picked) return ["none", null];

  let text;
  try { text = fs.readFileSync(picked, "utf8"); } catch { return ["none", null]; }
  const m = text.match(/confidence:\s*\**\s*(high|medium|low)\b/i);
  if (m) return [m[1].toLowerCase(), picked];
  // Spec present but no parseable confidence line → default high, keep it honest on stderr.
  process.stderr.write("faff state: spec found but no confidence line; defaulting to high\n");
  return ["high", picked];
}

// runDirsNewestFirst — every .faff/runs/<run-id> directory, ordered DESC by directory
// mtime (same sortRunDirsByMtimeDesc latestRunDir uses) — format-independent, so
// `latestRunDir(root) === runDirsNewestFirst(root)[0]` holds across a mixed population.
function runDirsNewestFirst(root) {
  const runs = path.join(root, ".faff", "runs");
  let names;
  try { names = fs.readdirSync(runs); } catch { return []; }
  const dirs = names
    .map((name) => path.join(runs, name))
    .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
  return sortRunDirsByMtimeDesc(dirs);
}

// resolveParked — parked iff the newest run dir with a <run-id>/<ISSUE>/park.md has one.
// Case-insensitive on the issue-id directory name.
function resolveParked(root, issue) {
  const want = issue.toLowerCase();
  for (const runDir of runDirsNewestFirst(root)) {
    let entries;
    try { entries = fs.readdirSync(runDir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.toLowerCase() !== want) continue;
      const parkPath = path.join(runDir, ent.name, "park.md");
      if (fs.existsSync(parkPath)) return [true, parkPath];
    }
  }
  return [false, null];
}

// resolveGit — first local branch whose name contains the issue id (case-insensitive),
// and the worktree (if any) checked out to that branch. Any git failure → [null, null],
// never a crash (faff state must run in a .faff-only / non-git tree).
function resolveGit(root, issue) {
  const want = issue.toLowerCase();
  let branch = null;
  try {
    const r = spawnSync("git", ["-C", root, "branch", "--list", "--format=%(refname:short)"],
      { encoding: "utf8" });
    if (r.status === 0 && typeof r.stdout === "string") {
      for (const line of r.stdout.split("\n")) {
        const name = line.trim();
        if (name && name.toLowerCase().includes(want)) { branch = name; break; }
      }
    }
  } catch { return [null, null]; }
  if (!branch) return [null, null];

  let worktree = null;
  try {
    const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
    if (r.status === 0 && typeof r.stdout === "string") {
      let curPath = null;
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("worktree ")) curPath = line.slice("worktree ".length).trim();
        else if (line.startsWith("branch ")) {
          const ref = line.slice("branch ".length).trim();          // e.g. refs/heads/<branch>
          const short = ref.replace(/^refs\/heads\//, "");
          if (short === branch && curPath) { worktree = curPath; break; }
        }
      }
    }
  } catch { /* leave worktree null */ }
  return [branch, worktree];
}

// resolveLedgerOutcome — the issue's most-recent run-ledger terminal outcome.
// Shares the ledger parse (readLedger) with runcheck; malformed ledger is skipped, not fatal.
function resolveLedgerOutcome(root, issue) {
  for (const runDir of runDirsNewestFirst(root)) {
    if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) continue;
    let data;
    try { data = readLedger(runDir); } catch { continue; }            // malformed → skip, try older
    const outcomes = (data && typeof data.outcomes === "object" && !Array.isArray(data.outcomes))
      ? data.outcomes : {};
    if (issue in outcomes) return [outcomes[issue], data.run_id ?? path.basename(runDir)];
  }
  return [null, null];
}

function cmdState(args) {
  const { values, positionals, errors } = parseArgs(args, STATE_SPEC);
  if (errors.length) return usageError(errors, "usage: faff state <issue> [--root DIR] [--json]");
  const issue = positionals[0];
  if (!issue) { process.stderr.write("faff state: missing <issue> argument\n"); return 2; }
  const root = values["--root"] || findRoot();

  const [spec, spec_source] = resolveSpec(root, issue);
  const [parked, parked_source] = resolveParked(root, issue);
  const [branch, worktree] = resolveGit(root, issue);
  const [ledger_outcome, ledger_run] = resolveLedgerOutcome(root, issue);

  const record = {
    issue,
    status: "unknown",        // tracker-only — agent fills authoritatively
    spec,
    spec_source,
    eligible: "unknown",      // tracker-only — agent computes via `faff eligible` from labels (faff-automate / faff-automation-hold) + automation_default
    parked,
    parked_source,
    blocked: "unknown",       // tracker-only (blockedBy relation)
    branch,
    worktree,
    ledger_outcome,
    ledger_run,
  };
  console.log(JSON.stringify(record));
  return 0;
}


module.exports = { cmdState, resolveGit, resolveLedgerOutcome, resolveParked, resolveSpec, runDirsNewestFirst };
