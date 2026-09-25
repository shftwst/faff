// ===========================================================================
// === region:factory — worktree-heal — FAFF-1114: self-heal a clobbered graft worktree ===
// When git's per-worktree admin dir (`.git/worktrees/<id>/`) is deleted out-of-band
// (a concurrent peer's housekeeping, a human `git gc`, an external prune of the shared
// clone) but the worktree's checkout dir + its branch ref both survive, git stops
// tracking the worktree and every git op from it fails (`fatal: not a git repository`).
// The branch and commits live in the shared clone's ref/object store (never in the admin
// dir), and the checkout carries the working-tree content — so the fix RESTORES the
// missing admin metadata in place rather than deleting-and-recreating (which would
// discard uncommitted working-tree content).
//
// Two exports drive it: detectClobber (the filesystem+ref probe worktree-check reuses to
// emit its `clobbered-recoverable` reason) and healClobberedWorktree (recreate the three
// pointer files git needs, run `git worktree repair`, then VERIFY). Both are fail-safe
// SYMMETRICALLY on directory AND branch: exactly one issue-owned orphaned checkout dir
// AND exactly one ref whose slash-flattened name maps to THAT checkout's basename, or no
// finding is produced (0/>1 on either end → null → the caller's existing no-worktree /
// fresh-create path, never a false heal or a wrong-branch heal). The branch is bound to
// the checkout (by its path), never re-matched by the issue token — a second stale
// same-token branch must not silently drive the heal onto the wrong tip. Directory
// matching reuses the FAFF-126 `tokenMatch` (whole-token, prefix-collision-safe).

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findRoot, ENTRYPOINT } = require("./shared-infra");
const { tokenMatch } = require("./worktree-prune");
const { parseArgs, usageError } = require("./argv");

// Resolve the worktree root through the ONE canonical resolver (FAFF-382) — shell
// `faff worktree-root --root <root> --json` rather than re-derive the env→config→default
// precedence a second time. Any failure returns null (fail-safe: no candidates probed →
// null finding → the caller's no-worktree path), never a guessed root.
function resolveWorktreeRootFor(root) {
  const r = spawnSync(process.execPath, [ENTRYPOINT, "worktree-root", "--root", root, "--json"], { encoding: "utf8" });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  try {
    const wtRoot = JSON.parse(r.stdout).root;
    return wtRoot && String(wtRoot).trim() ? String(wtRoot) : null;
  } catch { return null; }
}

// The checkout's `.git` FILE names the admin dir on a `gitdir:` line. Parse it, or return
// null on a missing/garbled file (fail-safe — a checkout we cannot read is not a finding).
function parseGitdirLine(dotGitFile) {
  let content;
  try { content = fs.readFileSync(dotGitFile, "utf8"); } catch { return null; }
  for (const line of content.split("\n")) {
    if (line.startsWith("gitdir:")) {
      const admin = line.slice("gitdir:".length).trim();
      return admin || null;
    }
  }
  return null;
}

// List local branch short-names, or null if git is unavailable (fail-safe upstream).
function listHeadRefs(root) {
  const r = spawnSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8" });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

// Pure core — no git, no fs. Given the already-probed clobbered candidates
// [{worktree_path, admin_id, basename}] and the local branch names, bind the finding:
// require EXACTLY ONE clobbered dir AND EXACTLY ONE ref whose slash-flattened name
// (`/`→`-`) equals that dir's basename. Either count ≠ 1 → null (fail-safe). The branch
// is bound to the checkout's path, NEVER re-matched by the issue token.
function bindClobberFinding(clobbered, refs) {
  if (!Array.isArray(clobbered) || clobbered.length !== 1) return null;
  const c = clobbered[0];
  const flatten = (s) => String(s).replace(/\//g, "-");
  const matching = (refs || []).filter((br) => flatten(br) === c.basename);
  if (matching.length !== 1) return null;
  return { worktree_path: c.worktree_path, branch: matching[0], admin_id: c.admin_id };
}

// detectClobber(root, issue) -> { worktree_path, branch, admin_id } | null.
// Candidate dirs directly under the resolved worktree root whose basename tokenMatches
// the issue, kept when they carry a `.git` FILE whose `gitdir:` admin path is ABSENT on
// disk; then bindClobberFinding applies the symmetric exactly-one guard. admin_id is
// authoritative from the gitdir line (basename of the admin path), never the dir basename.
function detectClobber(root, issue) {
  if (!issue) return null;
  const wtRoot = resolveWorktreeRootFor(root);
  if (!wtRoot) return null;
  let names;
  try { names = fs.readdirSync(wtRoot); } catch { return null; }
  const clobbered = [];
  for (const name of names) {
    if (!tokenMatch(name, issue)) continue;
    const dir = path.join(wtRoot, name);
    const dotGit = path.join(dir, ".git");
    let dirStat;
    let gitStat;
    try { dirStat = fs.statSync(dir); gitStat = fs.statSync(dotGit); } catch { continue; }
    if (!dirStat.isDirectory() || !gitStat.isFile()) continue; // a linked worktree's `.git` is a FILE
    const admin = parseGitdirLine(dotGit);
    if (!admin) continue;
    if (fs.existsSync(admin)) continue; // admin metadata still present → not clobbered
    clobbered.push({ worktree_path: dir, admin_id: path.basename(admin.replace(/\/+$/, "")), basename: name });
  }
  return bindClobberFinding(clobbered, listHeadRefs(root));
}

// VERIFY the born-verifiable success gate: correct checkout branch, resolvable HEAD, AND
// repo-side re-registration (`git worktree list` names the path). All three must hold.
function verifyHeal(root, finding) {
  const wt = finding.worktree_path;
  const abbrev = spawnSync("git", ["-C", wt, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  if (abbrev.status !== 0 || (abbrev.stdout || "").trim() !== finding.branch) return false;
  const head = spawnSync("git", ["-C", wt, "rev-parse", "--verify", "HEAD"], { encoding: "utf8" });
  if (head.status !== 0) return false;
  const list = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (list.status !== 0 || typeof list.stdout !== "string") return false;
  const norm = (p) => String(p).replace(/\/+$/, "");
  const listed = list.stdout.split("\n")
    .filter((ln) => ln.startsWith("worktree "))
    .map((ln) => norm(ln.slice("worktree ".length).trim()));
  return listed.includes(norm(wt));
}

// healClobberedWorktree(root, issue) -> { code, finding, error? }.
// null finding → code 2 (no-op — the REAL idempotency route: a re-run after a successful
// heal finds the admin dir present, so detectClobber yields null here). Else recreate the
// three admin pointer files, `git worktree repair`, VERIFY: pass → 0, fail → 1.
function healClobberedWorktree(root, issue) {
  const finding = detectClobber(root, issue);
  if (!finding) return { code: 2, finding: null };
  const admin = path.join(root, ".git", "worktrees", finding.admin_id);
  // Defensive; normally unreachable — detectClobber already required admin absent. If it
  // somehow exists, no-op rather than overwrite live admin metadata.
  if (fs.existsSync(admin)) return { code: 2, finding };
  try {
    fs.mkdirSync(admin, { recursive: true });
    fs.writeFileSync(path.join(admin, "gitdir"), `${finding.worktree_path}/.git\n`);
    fs.writeFileSync(path.join(admin, "HEAD"), `ref: refs/heads/${finding.branch}\n`);
    fs.writeFileSync(path.join(admin, "commondir"), "../..\n"); // standard non-bare layout; step-6 verify catches a wrong value
  } catch (err) {
    return { code: 1, finding, error: `could not recreate admin metadata: ${err.message}` };
  }
  spawnSync("git", ["-C", root, "worktree", "repair", finding.worktree_path], { encoding: "utf8" });
  return { code: verifyHeal(root, finding) ? 0 : 1, finding };
}

const WORKTREE_HEAL_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--issue": { arity: 1 }, "--root": { arity: 1 },
} };
const HEAL_USAGE = "usage: faff worktree-heal --issue ID [--root DIR] [--json]";

function cmdWorktreeHeal(args) {
  if (args.includes("--selftest")) return worktreeHealSelftest();
  const { values, errors } = parseArgs(args, WORKTREE_HEAL_SPEC);
  if (errors.length) return usageError(errors, HEAL_USAGE);
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];
  const issue = get("--issue");
  if (!issue) return usageError([{ code: "missing-value", flag: "--issue", detail: "--issue is required" }], HEAL_USAGE);
  const root = get("--root") || findRoot();

  const res = healClobberedWorktree(root, issue);
  const f = res.finding;
  if (res.code === 0) {
    if (asJson) console.log(JSON.stringify({ issue, healed: true, worktree_path: f.worktree_path, branch: f.branch, admin_id: f.admin_id }));
    else console.log(`faff worktree-heal: healed ${f.worktree_path} on ${f.branch}`);
    return 0;
  }
  if (res.code === 2) {
    const reason = f ? "admin-present" : "nothing-to-heal";
    if (asJson) console.log(JSON.stringify({ issue, healed: false, reason }));
    else console.log(`faff worktree-heal: nothing clobbered to heal for issue '${issue}' (${reason}, no-op)`);
    return 2;
  }
  if (asJson) console.log(JSON.stringify({ issue, healed: false, reason: "repair-failed", worktree_path: f && f.worktree_path, branch: f && f.branch, admin_id: f && f.admin_id, error: res.error || null }));
  else process.stderr.write(`faff worktree-heal: in-place repair did not restore a tracked, working worktree for issue '${issue}'${res.error ? ` — ${res.error}` : ""}\n`);
  return 1;
}

// Pure-core table — no git, no fs. Drives bindClobberFinding across the load-bearing
// symmetric-guard cases (the two-issue-token-branch trap, slash-flattening, the fail-safe
// 0/>1 counts on either end). The fs/ref probe itself is exercised end-to-end by
// test/worktree-heal.test.mjs against a real simulated clobber.
const WTHEAL_SELFTEST_CASES = [
  ["exactly one clobbered dir + exactly one mapping ref → finding",
    [{ worktree_path: "/wt/faff-1114-thread", admin_id: "faff-1114-thread", basename: "faff-1114-thread" }],
    ["faff-1114-thread", "main"],
    { worktree_path: "/wt/faff-1114-thread", branch: "faff-1114-thread", admin_id: "faff-1114-thread" }],
  ["slash-flattening: basename faff-foo binds branch faff/foo",
    [{ worktree_path: "/wt/faff-foo", admin_id: "faff-foo", basename: "faff-foo" }],
    ["faff/foo", "main"],
    { worktree_path: "/wt/faff-foo", branch: "faff/foo", admin_id: "faff-foo" }],
  ["two issue-token branches, one checkout → binds the checkout's OWN branch, not the stale one",
    [{ worktree_path: "/wt/faff-1114-thread", admin_id: "faff-1114-thread", basename: "faff-1114-thread" }],
    ["faff-1114-thread", "faff-1114-old", "main"],
    { worktree_path: "/wt/faff-1114-thread", branch: "faff-1114-thread", admin_id: "faff-1114-thread" }],
  ["zero clobbered dirs → null (fail-safe)", [], ["faff-1114", "main"], null],
  ["two clobbered dirs (directory ambiguity) → null (fail-safe)",
    [{ worktree_path: "/wt/faff-1114-a", admin_id: "faff-1114-a", basename: "faff-1114-a" },
     { worktree_path: "/wt/faff-1114-b", admin_id: "faff-1114-b", basename: "faff-1114-b" }],
    ["faff-1114-a", "faff-1114-b"], null],
  ["one clobbered dir, ZERO mapping refs (branch gone) → null (fail-safe)",
    [{ worktree_path: "/wt/faff-1114", admin_id: "faff-1114", basename: "faff-1114" }],
    ["main"], null],
  ["one clobbered dir, TWO refs flattening to the basename (branch ambiguous) → null (fail-safe)",
    [{ worktree_path: "/wt/feat-x", admin_id: "feat-x", basename: "feat-x" }],
    ["feat/x", "feat-x", "main"], null],
];

function worktreeHealSelftest() {
  let fail = 0;
  for (const [name, clobbered, refs, want] of WTHEAL_SELFTEST_CASES) {
    const got = bindClobberFinding(clobbered, refs);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${WTHEAL_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { WTHEAL_SELFTEST_CASES, bindClobberFinding, cmdWorktreeHeal, detectClobber, healClobberedWorktree, worktreeHealSelftest };
