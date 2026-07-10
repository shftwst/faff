// ===========================================================================
// === region:factory — worktree-prune — FAFF-126: the MECHANICAL replacement for the prose guard ===
// "never run a repo-wide `git worktree prune` while a peer may be live". A bare
// `git worktree prune` is repo-wide: it clears EVERY dangling entry in the
// shared clone's `.git/worktrees/`, so a concurrent peer whose checkout briefly
// looks absent gets its admin dir wiped mid-run (the 2026-06-12 FAFF-93/114
// clobber). This scopes the prune by construction: a run declares what it OWNS
// (its own worktree path / branch / issue id), and only its OWN dangling entries
// are pruned. Everything else — a live peer, or a dangling entry we can't prove
// is ours — is left untouched. Fail-safe: when in doubt, do not prune.
//
// classifyWorktreePrune is the pure core (no git, no fs): given the parsed
// worktree entries + the run's ownership selectors, it partitions every entry
// into own / foreign / unknown and names which to prune. The selftest drives
// this table directly. Entry shape: { path, branch, prunable }.
//   - prunable      → git would remove this entry (its checkout is gone).
//   - OWN           → matches an ownership selector (path / branch / issue id).
//   - own + prunable → PRUNE (the only entries ever removed).
//   - own + live     → skip (nothing dangling to prune; it's our in-flight tree).
//   - !own + live    → FOREIGN: a peer's live worktree — protected, never touched.
//   - !own + prunable → UNKNOWN: dangling but unproven-ours — fail-safe SKIP.
// With NO ownership selector declared, nothing is OWN, so nothing is pruned.
// Ownership match. Path and branch are EXACT (a path is identity; a branch is a
// full ref). The issue id matches on a whole token boundary, NOT raw substring —
// otherwise owning `faff-12` would claim a peer's `faff-126` worktree and prune
// it (the very clobber this guards against, via prefix collision). A token is a
// run of [A-Za-z0-9]; `faff-12` matches `…/faff-12` / `faff-12-slug` but never
// `faff-126`. Case-insensitive (issue ids are).

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findRoot } = require("./shared-infra");

function tokenMatch(haystack, want) {
  if (!haystack || !want) return false;
  const h = String(haystack).toLowerCase();
  const w = want.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(h);
}

function ownMatches(entry, sel) {
  const norm = (p) => String(p || "").replace(/\/+$/, "");
  if (sel.paths.some((p) => norm(p) && norm(p) === norm(entry.path))) return true;
  if (sel.branch && entry.branch && entry.branch === sel.branch) return true;
  if (sel.issue && (tokenMatch(entry.path, sel.issue) || tokenMatch(entry.branch, sel.issue))) return true;
  return false;
}

function classifyWorktreePrune(entries, sel) {
  const out = { prune: [], own_live: [], foreign: [], unknown: [] };
  for (const e of entries) {
    const own = ownMatches(e, sel);
    if (own && e.prunable) out.prune.push(e);
    else if (own) out.own_live.push(e);
    else if (e.prunable) out.unknown.push(e);          // dangling but unproven-ours → fail-safe skip
    else out.foreign.push(e);                           // live peer → protected
  }
  return out;
}

// Resolve the AUTHORITATIVE admin-dir id ↔ worktree-path map by reading each
// `.git/worktrees/<id>/gitdir` file (it names that worktree's own `.git` path,
// i.e. `<worktree>/.git`). This is the only safe source: git de-duplicates
// admin-dir ids with a numeric suffix on a basename collision (two worktrees
// both named `foo` → ids `foo` and `foo1`), so `basename(<worktree-path>)` is
// AMBIGUOUS and could point removal at a peer's admin dir. Returns a Map of
// worktree-path → id (normalised, trailing slash stripped).
function worktreeAdminIds(root) {
  const map = new Map();
  const base = path.join(root, ".git", "worktrees");
  let ids;
  try { ids = fs.readdirSync(base); } catch { return map; }   // no worktrees dir → empty
  for (const id of ids) {
    let gd;
    try { gd = fs.readFileSync(path.join(base, id, "gitdir"), "utf8").trim(); } catch { continue; }
    // gitdir points at "<worktree>/.git" (a file or dir) — strip the trailing /.git.
    const wt = gd.replace(/\/\.git\/?$/, "").replace(/\/+$/, "");
    if (wt) map.set(wt, id);
  }
  return map;
}

// Parse `git worktree list --porcelain` into entries, marking prunable ones and
// attaching each entry's authoritative admin-dir id (from worktreeAdminIds — NOT
// the path basename). An entry whose id can't be resolved keeps id=null and is
// therefore never removed (fail-safe). --porcelain emits a `prunable <reason>`
// attribute for entries git would prune (older gits omit it — fall back to
// `git worktree prune --dry-run --verbose`, whose `worktrees/<id>` lines name the
// dangling admin dirs directly, which is itself the authoritative id).
function parseWorktreeEntries(root) {
  const r = spawnSync("git", ["-C", root, "worktree", "list", "--porcelain"], { encoding: "utf8" });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const idByPath = worktreeAdminIds(root);
  const norm = (p) => String(p || "").replace(/\/+$/, "");
  const entries = [];
  let cur = null;
  const flush = () => { if (cur && cur.path) { cur.id = idByPath.get(norm(cur.path)) || null; entries.push(cur); } cur = null; };
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) { flush(); cur = { path: line.slice(9).trim(), branch: null, prunable: false, id: null }; }
    else if (!cur) continue;
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//, "");
    else if (line.startsWith("prunable")) cur.prunable = true;
  }
  flush();
  // Fallback for gits that don't emit `prunable`: a worktree present in the
  // prune --dry-run dangling-id set is prunable. Match on the AUTHORITATIVE id
  // (the dry-run prints the admin-dir id directly), never the path basename.
  if (!entries.some((e) => e.prunable)) {
    const d = spawnSync("git", ["-C", root, "worktree", "prune", "--dry-run", "--verbose"], { encoding: "utf8" });
    if (d.status === 0 && typeof d.stdout === "string") {
      const ids = new Set();
      for (const m of d.stdout.matchAll(/worktrees\/([^/:\s]+)/g)) ids.add(m[1]);
      for (const e of entries) if (e.id && ids.has(e.id)) e.prunable = true;
    }
  }
  return entries;
}

function cmdWorktreePrune(args) {
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const getAll = (f) => args.reduce((a, v, i) => (args[i - 1] === f ? [...a, v] : a), []);
  if (args.includes("--selftest")) return worktreePruneSelftest();
  const asJson = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const root = get("--root") || findRoot();
  const sel = { paths: getAll("--own"), branch: get("--branch"), issue: get("--issue") };

  const entries = parseWorktreeEntries(root);
  if (entries === null) { process.stderr.write("faff worktree-prune: not a git work tree (or git unavailable)\n"); return 2; }

  const cls = classifyWorktreePrune(entries, sel);
  const declared = sel.paths.length > 0 || sel.branch || sel.issue;
  const removed = [];
  const failed = [];
  if (!dryRun) {
    // Scoped removal: delete ONLY each OWN dangling admin dir, addressed by its
    // AUTHORITATIVE git admin-dir id (e.id, resolved from the gitdir map) — never
    // the path basename (ambiguous under git's id de-duplication) and never the
    // repo-wide `git worktree prune` (which would also clear peers' dangling dirs).
    // An entry whose id couldn't be resolved is NOT removed (fail-safe).
    for (const e of cls.prune) {
      if (!e.id) { failed.push({ path: e.path, error: "admin-dir id unresolved — not removed (fail-safe)" }); continue; }
      const dir = path.join(root, ".git", "worktrees", e.id);
      try { fs.rmSync(dir, { recursive: true, force: true }); removed.push(e.path); }
      catch (err) { failed.push({ path: e.path, error: err.message }); }
    }
  }
  const result = {
    root, dry_run: dryRun, declared_ownership: !!declared,
    would_prune: cls.prune.map((e) => e.path),
    pruned: dryRun ? [] : removed,
    protected: { foreign_live: cls.foreign.map((e) => e.path), unknown_dangling: cls.unknown.map((e) => e.path), own_live: cls.own_live.map((e) => e.path) },
    failed,
  };
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    const n = dryRun ? cls.prune.length : removed.length;
    console.log(`faff worktree-prune: ${dryRun ? "would prune" : "pruned"} ${n} own worktree(s)${dryRun ? " (dry-run)" : ""}`);
    if (cls.foreign.length) console.log(`  protected ${cls.foreign.length} live peer worktree(s) — never touched`);
    if (cls.unknown.length) console.log(`  skipped ${cls.unknown.length} dangling entr(ies) of unproven ownership (fail-safe)`);
    if (!declared) console.log("  no ownership declared (--own/--branch/--issue) — nothing classified as own, nothing pruned");
  }
  return failed.length ? 1 : 0;
}

// Pure-core table — no git, no fs. Asserts the own/foreign/unknown partition + the
// prune set across the load-bearing cases (the clobber repro, the fail-safe skips).
const WTPRUNE_SELFTEST_CASES = [
  // [name, entries, selector, want{prune,foreign,unknown,own_live}]
  ["own dangling → prune",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: true }],
    { paths: [], branch: null, issue: "faff-126" },
    { prune: ["/wt/faff-126"], foreign: [], unknown: [], own_live: [] }],
  ["peer LIVE → foreign, protected (the 2026-06-12 clobber)",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: true },
     { path: "/wt/faff-114", branch: "faff-114", prunable: false }],
    { paths: [], branch: null, issue: "faff-126" },
    { prune: ["/wt/faff-126"], foreign: ["/wt/faff-114"], unknown: [], own_live: [] }],
  ["peer DANGLING but not ours → unknown, fail-safe SKIP",
    [{ path: "/wt/faff-114", branch: "faff-114", prunable: true }],
    { paths: [], branch: null, issue: "faff-126" },
    { prune: [], foreign: [], unknown: ["/wt/faff-114"], own_live: [] }],
  ["own LIVE (in-flight) → skip, not pruned",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: false }],
    { paths: ["/wt/faff-126"], branch: null, issue: null },
    { prune: [], foreign: [], unknown: [], own_live: ["/wt/faff-126"] }],
  ["no ownership declared → nothing own, nothing pruned",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: true }],
    { paths: [], branch: null, issue: null },
    { prune: [], foreign: [], unknown: ["/wt/faff-126"], own_live: [] }],
  ["match by exact path (trailing-slash insensitive)",
    [{ path: "/wt/x", branch: "b", prunable: true }],
    { paths: ["/wt/x/"], branch: null, issue: null },
    { prune: ["/wt/x"], foreign: [], unknown: [], own_live: [] }],
  ["match by branch name",
    [{ path: "/wt/anything", branch: "feat/foo", prunable: true }],
    { paths: [], branch: "feat/foo", issue: null },
    { prune: ["/wt/anything"], foreign: [], unknown: [], own_live: [] }],
  ["mixed: prune own dangling, protect peer live, skip foreign dangling",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: true },
     { path: "/wt/faff-200", branch: "faff-200", prunable: false },
     { path: "/wt/faff-99", branch: "faff-99", prunable: true }],
    { paths: [], branch: null, issue: "faff-126" },
    { prune: ["/wt/faff-126"], foreign: ["/wt/faff-200"], unknown: ["/wt/faff-99"], own_live: [] }],
  ["issue PREFIX collision: owning faff-12 must NOT claim peer faff-126 (fail-safe)",
    [{ path: "/wt/faff-126", branch: "faff-126", prunable: true }],
    { paths: [], branch: null, issue: "faff-12" },
    { prune: [], foreign: [], unknown: ["/wt/faff-126"], own_live: [] }],
  ["issue token match: faff-12 owns its own faff-12-slug worktree",
    [{ path: "/wt/faff-12-add-thing", branch: "faff-12-add-thing", prunable: true }],
    { paths: [], branch: null, issue: "faff-12" },
    { prune: ["/wt/faff-12-add-thing"], foreign: [], unknown: [], own_live: [] }],
  ["branch is EXACT: owning branch faff-1 must NOT claim peer branch faff-12",
    [{ path: "/wt/x", branch: "faff-12", prunable: true }],
    { paths: [], branch: "faff-1", issue: null },
    { prune: [], foreign: [], unknown: ["/wt/x"], own_live: [] }],
];

function worktreePruneSelftest() {
  let fail = 0;
  for (const [name, entries, sel, want] of WTPRUNE_SELFTEST_CASES) {
    const got = classifyWorktreePrune(entries, sel);
    const pick = (o) => ({ prune: o.prune.map((e) => e.path), foreign: o.foreign.map((e) => e.path), unknown: o.unknown.map((e) => e.path), own_live: o.own_live.map((e) => e.path) });
    const ok = JSON.stringify(pick(got)) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(pick(got))} (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${WTPRUNE_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { WTPRUNE_SELFTEST_CASES, classifyWorktreePrune, cmdWorktreePrune, ownMatches, parseWorktreeEntries, tokenMatch, worktreeAdminIds, worktreePruneSelftest };
