// ===========================================================================
// === region:factory — worktree-check — FAFF-948: does a REUSED worktree's base match main? ===
// `/faff-graft` resumes an issue's existing worktree to skip re-doing the spec commit and
// branch setup — that resume convenience is correct. But a worktree from a prior run keeps
// its original base ref indefinitely, so reuse alone can silently run the gate ladder and the
// build against a STALE base: old gate code, old review tooling, old everything merged to
// `main` since the worktree was created. FAFF-708 already closed this for the NEW-create path
// (`setup-worktree.sh` bases every fresh worktree off the freshly-fetched `origin/<default>`
// via `remote-diff-base.sh`, fail-loud); this closes the symmetric REUSE-path gap.
//
// `faff worktree-check --issue <id>` is the single home for the staleness computation — a pure
// classifier (no git, no fs) plus a git-read wrapper, mirroring `worktree-prune.js` one-for-one
// (shape, arg-parse, selftest, scoping matcher — the matcher is IMPORTED from worktree-prune.js,
// never reimplemented, so both stay fail-safe against the same issue-id prefix collision).
//
// Contract (mirrors worktree-prune's 0/1/2 posture):
//   - exit 0  = ran & FRESH  (behind <= threshold)
//   - exit 1  = ran & STALE  (behind > threshold) — the shell-branchable stale signal
//   - exit 2  = usage / no worktree resolvable for --issue / ambiguous match / base ref
//               unresolvable / git unavailable / behind-count unreadable — "cannot certify
//               freshness", which is never reported as a false FRESH.
//
// Base-ref source: shell the existing `remote-diff-base.sh` (bundled beside the faff-graft
// skill) — never a second base resolver. A resolve/fetch failure there is surfaced fail-loud
// here too (this cannot certify freshness against a base it could not fetch).
//
// Staleness measure: `behind = git rev-list --count <feature-branch>..<base>` — the count of
// commits reachable from the fetched base but not from the worktree's branch, i.e. how many
// default-branch commits merged since the worktree forked. Threshold defaults to 0 — the
// FAFF-930 incident showed even ONE missed merge silently breaks a run, so no "trivial amount"
// tolerance is baked in; `--behind-threshold N` exists as a policy input for a caller that
// wants one, but graft calls it with the default.

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { findRoot } = require("./shared-infra");
const { parseWorktreeEntries, ownMatches } = require("./worktree-prune");
const { parseArgs, usageError } = require("./argv");

// Pure core — no git, no fs. `behind` may arrive unreadable (NaN, negative, non-finite) from a
// caller that could not get a trustworthy git count; that is FAIL-SAFE STALE (never fresh), with
// `error` set so the wrapper can tell "genuinely stale" apart from "couldn't tell" (mapped to the
// wrapper's own exit-2 "cannot certify" class, never a false exit-0 fresh).
function classifyWorktreeStaleness({ behind, threshold }) {
  const t = Number.isFinite(threshold) ? threshold : 0;
  const b = typeof behind === "number" ? behind : Number(behind);
  if (!Number.isFinite(b) || b < 0) {
    return { stale: true, behind: null, threshold: t, error: "unreadable behind count" };
  }
  return { stale: b > t, behind: b, threshold: t, error: null };
}

// Resolve remote-diff-base.sh's path relative to THIS file: plugin/skills/faff/bin/lib/ ->
// plugin/skills/faff-graft/remote-diff-base.sh. Bundled beside the faff-graft skill; resolved
// here rather than duplicated, so provisioning/graft's diffs and this check share one resolver.
function remoteDiffBaseScriptPath() {
  return path.join(__dirname, "..", "..", "..", "faff-graft", "remote-diff-base.sh");
}

// Run remote-diff-base.sh from within `cwd` (the worktree whose base we want) and return its
// printed base ref, or null on any resolve/fetch failure (fail-loud — the caller must treat a
// null here as "cannot certify freshness", never fall back to a guessed/stale base).
function resolveBaseRef(cwd) {
  const script = remoteDiffBaseScriptPath();
  const r = spawnSync("bash", [script], { cwd, encoding: "utf8" });
  if (r.status !== 0 || typeof r.stdout !== "string") {
    return { base: null, detail: (r.stderr || "").trim() || "remote-diff-base.sh failed" };
  }
  const base = r.stdout.trim();
  if (!base) return { base: null, detail: "remote-diff-base.sh printed no base" };
  return { base, detail: null };
}

const WORKTREE_CHECK_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 },
  "--issue": { arity: 1 }, "--root": { arity: 1 }, "--behind-threshold": { arity: 1 },
} };

function cmdWorktreeCheck(args) {
  if (args.includes("--selftest")) return worktreeCheckSelftest();
  const { values, errors } = parseArgs(args, WORKTREE_CHECK_SPEC);
  if (errors.length) return usageError(errors, "usage: faff worktree-check --issue ID [--root DIR] [--behind-threshold N] [--json]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];
  const issue = get("--issue");
  if (!issue) return usageError([{ code: "missing-value", flag: "--issue", detail: "--issue is required" }], "usage: faff worktree-check --issue ID [--root DIR] [--behind-threshold N] [--json]");
  const root = get("--root") || findRoot();
  const thresholdRaw = get("--behind-threshold");
  const threshold = thresholdRaw == null ? 0 : Number(thresholdRaw);
  if (thresholdRaw != null && !Number.isFinite(threshold)) {
    return usageError([{ code: "bad-enum", flag: "--behind-threshold", detail: `--behind-threshold must be a number, got ${thresholdRaw}` }], "usage: faff worktree-check --issue ID [--root DIR] [--behind-threshold N] [--json]");
  }

  const fail = (msg) => {
    if (asJson) console.log(JSON.stringify({ issue, error: msg }));
    else process.stderr.write(`faff worktree-check: ${msg}\n`);
    return 2;
  };

  const entries = parseWorktreeEntries(root);
  if (entries === null) return fail("not a git work tree (or git unavailable)");

  const sel = { paths: [], branch: null, issue };
  const matches = entries.filter((e) => ownMatches(e, sel));
  if (matches.length === 0) return fail(`no worktree resolvable for issue '${issue}' — nothing to reuse (create fresh)`);
  if (matches.length > 1) return fail(`ambiguous: ${matches.length} worktrees match issue '${issue}' — cannot certify which to check`);
  const entry = matches[0];
  if (!entry.branch) return fail(`worktree '${entry.path}' for issue '${issue}' has no resolvable branch`);

  const { base, detail } = resolveBaseRef(entry.path);
  if (!base) return fail(`cannot certify freshness — base ref unresolvable: ${detail}`);

  const r = spawnSync("git", ["-C", entry.path, "rev-list", "--count", `${entry.branch}..${base}`], { encoding: "utf8" });
  const behindRaw = r.status === 0 && typeof r.stdout === "string" ? r.stdout.trim() : NaN;
  const cls = classifyWorktreeStaleness({ behind: Number(behindRaw), threshold });
  if (cls.error) return fail(`cannot certify freshness — ${cls.error} (git rev-list exit ${r.status})`);

  const result = { issue, worktree_path: entry.path, branch: entry.branch, base_ref: base, behind: cls.behind, threshold: cls.threshold, stale: cls.stale };
  if (asJson) console.log(JSON.stringify(result));
  else if (cls.stale) console.log(`faff worktree-check: STALE — ${entry.path} is ${cls.behind} commit(s) behind ${base} (threshold ${cls.threshold})`);
  else console.log(`faff worktree-check: fresh — ${entry.path} is ${cls.behind} commit(s) behind ${base} (threshold ${cls.threshold})`);
  return cls.stale ? 1 : 0;
}

// Pure-core table — no git, no fs. Drives classifyWorktreeStaleness directly across the
// load-bearing cases: exactly-fresh, stale-at-threshold-0 (the FAFF-930 incident — even one
// missed merge is stale), under-a-non-zero-threshold, and the fail-safe unreadable-count case.
const WTCHECK_SELFTEST_CASES = [
  ["behind=0, threshold=0 -> fresh",
    { behind: 0, threshold: 0 }, { stale: false, behind: 0, threshold: 0, error: null }],
  ["behind=1, threshold=0 -> stale (the FAFF-930 one-missed-merge case)",
    { behind: 1, threshold: 0 }, { stale: true, behind: 1, threshold: 0, error: null }],
  ["behind=3, threshold=5 -> fresh (under an explicit tolerance)",
    { behind: 3, threshold: 5 }, { stale: false, behind: 3, threshold: 5, error: null }],
  ["behind=5, threshold=5 -> fresh (at threshold, not over it)",
    { behind: 5, threshold: 5 }, { stale: false, behind: 5, threshold: 5, error: null }],
  ["behind=6, threshold=5 -> stale (one over the tolerance)",
    { behind: 6, threshold: 5 }, { stale: true, behind: 6, threshold: 5, error: null }],
  ["behind=NaN (unreadable count) -> fail-safe stale, never fresh",
    { behind: NaN, threshold: 0 }, { stale: true, behind: null, threshold: 0, error: "unreadable behind count" }],
  ["behind=-1 (negative, unreadable) -> fail-safe stale, never fresh",
    { behind: -1, threshold: 0 }, { stale: true, behind: null, threshold: 0, error: "unreadable behind count" }],
];

function worktreeCheckSelftest() {
  let fail = 0;
  for (const [name, input, want] of WTCHECK_SELFTEST_CASES) {
    const got = classifyWorktreeStaleness(input);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(got)} (want ${JSON.stringify(want)})`}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${WTCHECK_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { WTCHECK_SELFTEST_CASES, classifyWorktreeStaleness, cmdWorktreeCheck, remoteDiffBaseScriptPath, resolveBaseRef, worktreeCheckSelftest };
