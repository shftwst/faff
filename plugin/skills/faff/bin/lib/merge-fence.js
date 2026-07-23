// ===========================================================================
// === region:factory — merge-fence — FAFF-434: the PreToolUse fence on raw `gh pr merge`. ===
// The mechanical, testable replacement for a hand-added inline settings.json
// stopgap: a PreToolUse hook that DENIES any Bash tool call whose command
// matches a raw `gh pr merge` invocation, naming `faff merge-gate` — the sole
// sanctioned merge path (FAFF-350) — as the remedy. Shaped exactly like
// runcheck/prepcheck's --hook/--selftest split: a pure matcher over
// (tool_name, command), plus a thin stdin shell. merge-gate's own merge is a
// spawnSync CHILD PROCESS, never a Bash tool call, so the fence never sees it
// (the tool_name==="Bash" scoping is the whole interlock — no allowlist needed).
// ===========================================================================

// PURE: does this (tool_name, command) pair invoke a raw `gh pr merge`? A `gh`
// token — allowing a leading path prefix (`/usr/bin/gh`) or a leading env-var
// prefix (`FOO=1 gh`), since either still resolves to the same binary — followed
// by `pr`, then `merge`, with any whitespace between; trailing flags are free.
// Deliberately narrow: `git merge` (no `pr`), `gh pr view`, `gh pr checkout` (no
// `merge`) all fall through un-denied. Left boundary excludes only a preceding
// WORD character (so "ghost" — no whitespace between "gh" and "ost" — never
// matches the required `\s+` after "gh" anyway; the boundary's real job is
// rejecting a "gh" that is itself part of a longer identifier, e.g. "xgh"), and
// deliberately permits "/", ".", "-" immediately before "gh" — a path prefix
// (`/usr/bin/gh`) is exactly the case this fence must still catch.
//
// LIMITATION (by design): a token-sequence regex, not a shell parser — a command
// that BREAKS the `gh`·`pr`·`merge` run with quoting/splicing/variable/substitution
// (`gh pr "merge"`, `gh pr $MERGE`) is NOT matched. This is the OUTERMOST guard-rail
// against the naive/literal form, never the merge-security boundary (that is
// merge-gate-as-sole-path + forge branch-protection, ADR 0043). The selftest pins
// this boundary explicitly with LIMITATION allow-cases; a shell-aware matcher is
// deliberately out of scope for this fence (chasing every spelling would only give a
// false sense of a guarantee a regex cannot provide).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gitRemoteEmpty, resolveLocalBase } = require("./merge-gate");

function matchesRawGhMerge(toolName, command) {
  if (toolName !== "Bash") return false;
  if (typeof command !== "string" || command.length === 0) return false;
  return /(^|[^\w])gh\s+pr\s+merge(\s|$)/.test(command);
}

// ===========================================================================
// === FAFF-526: matchesRawLocalBaseMerge — the no-remote-gated local sibling of matchesRawGhMerge. ===
// On a repo with NO configured remote, `faff merge-gate --local` (this same fence's sanctioned
// escape valve, invisible here as a spawnSync child process) is meant to be the ONLY path that
// lands code on the base branch. This matcher makes that mechanical: it denies the raw base-
// branch MUTATION spellings (`git merge <feature>` while sitting ON the base branch, `git
// update-ref refs/heads/<base>`, `git push . HEAD:<base>`) — but it NEVER denies base-branch
// CONSUMPTION (`git merge <base>` run FROM a feature branch, a legitimate update).
//
// Activation is gated on CONFIRMED remote-absence (gitRemoteEmpty === true, shared verbatim with
// merge-gate.js's own bypass-guard and `resolveLocalBase` so both name the same base branch for a
// given repo, spec §6 assumption). An INDETERMINATE remote read (git unreachable, cwd not a repo)
// or an unresolvable base branch (no --base equivalent here, and neither main nor master exists)
// resolves to a definite non-match — this is a NEW enforcement surface, so ambiguity fails toward
// dormant, never toward a surprise deny on an ambiguous repo. On any remote-backed repo the whole
// matcher is a no-op: existing `matchesRawGhMerge` behaviour stays byte-identical (regression-pinned
// below).
//
// LIMITATION (same stance as matchesRawGhMerge, FAFF-434): a token-sequence regex, not a shell
// parser. A command that BREAKS the required tokens with quoting/splicing/variable/substitution
// is NOT caught. The real boundary is "`faff merge-gate --local` is the only sanctioned path", not
// this regex — it is the outermost guard-rail against the naive/literal form.
// ===========================================================================

function gitQuiet(cwd, args, timeout = 5000) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || "").trim();
}

function currentBranchForFence(cwd) {
  const b = gitQuiet(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return b && b !== "HEAD" ? b : null; // detached HEAD => no meaningful "current branch"
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// `git merge <ref>` — a landing attempt. Excludes the conflict-resolution subcommands
// --abort/--continue/--quit, which never land new commits onto the current branch.
function matchesGitMergeLandingCommand(command) {
  if (!/(^|[^\w])git\s+merge\b/.test(command)) return false;
  if (/git\s+merge\s+(--abort|--continue|--quit)\b/.test(command)) return false;
  return true;
}

// `git update-ref refs/heads/<base> …` — a direct base-ref move.
function matchesUpdateRefBase(command, base) {
  return new RegExp(`(^|[^\\w])git\\s+update-ref\\s+refs/heads/${escapeRegExp(base)}\\b`).test(command);
}

// `git push <local-target> HEAD:<base>` (`.`, another local path, or any non-URL target) — a
// local push whose refspec lands HEAD directly onto the base ref.
function matchesLocalPushToBase(command, base) {
  return new RegExp(`(^|[^\\w])git\\s+push\\s+\\S+\\s+HEAD:${escapeRegExp(base)}\\b`).test(command);
}

function matchesRawLocalBaseMerge(command, cwd) {
  if (typeof command !== "string" || command.length === 0) return false;
  if (typeof cwd !== "string" || cwd.length === 0) return false;
  if (gitRemoteEmpty(cwd) !== true) return false; // remote present, OR indeterminate => dormant
  const base = resolveLocalBase(cwd, null);
  if (!base) return false; // no resolvable base branch => nothing to protect yet

  if (matchesUpdateRefBase(command, base)) return true;
  if (matchesLocalPushToBase(command, base)) return true;
  if (matchesGitMergeLandingCommand(command)) {
    // Deny only when landing INTO the base branch (current branch IS base) — base-branch
    // MUTATION. A `git merge <base>` run FROM a feature branch (current branch != base) is
    // base-branch CONSUMPTION, a legitimate update, and falls through to `false` below.
    return currentBranchForFence(cwd) === base;
  }
  return false;
}

// The deny message for the local-base variant — points at the SAME sanctioned remedy as the
// gh-merge fence, so a denied command always names one consistent escape valve.
const LOCAL_BASE_FENCE_DENY_MESSAGE =
  "faff merge-fence: raw base-branch mutation is not the sanctioned merge path on a no-remote repo — route this merge through " +
  "`faff merge-gate --local` (the sole sanctioned path). If you are a human operator, run merge-gate yourself " +
  "in a real terminal.\n";

// The single-line stderr deny message — names `faff merge-gate` as the sanctioned
// remedy (never just "denied"), plus the human-operator escape hatch (run
// merge-gate yourself in a real terminal, mirroring merge-gate's own human-only
// flag fencing, FAFF-375).
const MERGE_FENCE_DENY_MESSAGE =
  "faff merge-fence: raw gh pr merge is not the sanctioned merge path — route this merge through " +
  "`faff merge-gate` (the sole sanctioned path). If you are a human operator, run merge-gate yourself " +
  "in a real terminal.\n";

// Fold a parsed PreToolUse event down into a full deny decision — {deny, message}. Checks
// matchesRawGhMerge FIRST (a pure check, no cwd needed); FAFF-526's matchesRawLocalBaseMerge is
// checked only for a Bash command carrying a string command AND the event's own `cwd` (never a
// caller-supplied override — the hook event is the sole cwd source, mirroring the WorktreeCreate
// hook's own event.cwd convention). A non-object event, missing tool_input, or an absent/
// non-string cwd all resolve to a definite non-match rather than throwing — the --hook shell's
// JSON.parse already fail-safes a malformed event to exit 0 before this is ever called with a
// non-null event.
function mergeFenceDecisionDetail(event) {
  if (event === null || typeof event !== "object") return { deny: false, message: null };
  const toolInput = event.tool_input;
  const command = toolInput && typeof toolInput === "object" ? toolInput.command : undefined;
  if (matchesRawGhMerge(event.tool_name, command)) return { deny: true, message: MERGE_FENCE_DENY_MESSAGE };
  if (event.tool_name === "Bash" && typeof command === "string" && typeof event.cwd === "string" && event.cwd
      && matchesRawLocalBaseMerge(command, event.cwd)) {
    return { deny: true, message: LOCAL_BASE_FENCE_DENY_MESSAGE };
  }
  return { deny: false, message: null };
}

// PURE boolean wrapper — preserves the original matcher-only decision shape for existing callers.
function mergeFenceDecision(event) {
  return mergeFenceDecisionDetail(event).deny;
}

const { parseArgs, usageError } = require("./argv");
// --root is accepted-and-ignored: hooks-ensure's probeServes always invokes
// `<sub> --hook --root <probeRoot>`, so --root must be a declared no-op, never a usage error.
const MERGE_FENCE_SPEC = { flags: { "--selftest": { arity: 0 }, "--hook": { arity: 0 }, "--root": { arity: 1 } } };

function cmdMergeFence(args) {
  if (args.includes("--selftest")) return mergeFenceSelftest();
  const { values, errors } = parseArgs(args, MERGE_FENCE_SPEC);
  if (errors.length) return usageError(errors, "faff merge-fence: use --hook (reads a PreToolUse JSON event on stdin) or --selftest");
  if (!values["--hook"]) {
    process.stderr.write("faff merge-fence: use --hook (reads a PreToolUse JSON event on stdin) or --selftest\n");
    return 2;
  }
  // --root DIR is accepted-and-ignored: the fence is a pure stdin-in decision, no
  // filesystem read — but hooks-ensure's probeServes always invokes `<sub> --hook
  // --root <probeRoot>`, so an unrecognised --root must never become a usage error
  // (that would make probeServes misclassify a perfectly-served bin as unserved).
  let raw;
  try { raw = fs.readFileSync(0, "utf8"); } catch { return 0; } // no/closed stdin → never block
  if (!raw || !raw.trim()) return 0; // empty stdin → never block
  let event;
  try { event = JSON.parse(raw); } catch { return 0; } // malformed JSON → never block
  const { deny, message } = mergeFenceDecisionDetail(event);
  if (!deny) return 0;
  process.stderr.write(message);
  return 2;
}

// [label, tool_name, command, wantMatch] — drives the pure matcher directly (no
// filesystem, no stdin): deny cases (the three `gh pr merge` prefix shapes plus
// the bare no-trailing-flags form) and allow cases (sibling `gh pr` subcommands,
// `git merge`, a non-Bash tool, a lookalike token, and the malformed-input shapes
// the --hook shell degrades before ever reaching the matcher).
const MERGE_FENCE_SELFTEST_CASES = [
  ["Bash gh pr merge + flags → deny", "Bash", "gh pr merge 123 --squash", true],
  ["Bash gh pr merge, path-prefixed gh → deny", "Bash", "/usr/bin/gh pr merge 123", true],
  ["Bash gh pr merge, env-prefixed gh → deny", "Bash", "FOO=1 gh pr merge 5 --squash", true],
  ["Bash bare gh pr merge (no trailing flags) → deny", "Bash", "gh pr merge", true],
  ["Bash extra whitespace between tokens → deny", "Bash", "gh   pr   merge  5", true],
  ["Bash gh pr view → allow (no merge)", "Bash", "gh pr view 123", false],
  ["Bash gh pr checkout → allow (no merge)", "Bash", "gh pr checkout 123", false],
  ["Bash git merge (no pr) → allow", "Bash", "git merge main", false],
  ["Bash lookalike token (ghost) → allow (no word-boundary gh)", "Bash", "ghost pr merge", false],
  ["non-Bash tool_name → allow regardless of command", "Read", "gh pr merge 123", false],
  ["absent command → allow", "Bash", undefined, false],
  ["non-string command → allow", "Bash", 123, false],
  ["absent tool_name → allow", undefined, "gh pr merge 123", false],
  // DOCUMENTED LIMITATION (recorded, not a defect): this is a REGEX token-sequence
  // matcher, not a shell parser, so a command that BREAKS the `gh`·`pr`·`merge`
  // token run with quoting, string-splicing, variable expansion, or command
  // substitution is NOT caught. That is deliberate and matches the accepted inline
  // stopgap this replaces: the fence is the OUTERMOST guard-rail against the naive/
  // literal form, NOT the merge-security boundary — that boundary is `faff merge-gate`
  // as the sole sanctioned path (its own merge is a spawnSync child, invisible here)
  // plus the forge branch-protection backstop (ADR 0043). These allow-cases pin the
  // boundary HONESTLY (so the table never reads as full-coverage of every raw-merge
  // spelling); a hardened shell-aware matcher is tracked as post-merge scope.
  ["LIMITATION: quoted merge arg → NOT caught (regex, not a shell parser)", "Bash", 'gh pr "merge" 123', false],
  ["LIMITATION: string-spliced merge → NOT caught", "Bash", 'gh pr m"er"ge 123', false],
  ["LIMITATION: variable-expanded subcommand → NOT caught", "Bash", "gh pr $MERGE 123", false],
  ["LIMITATION: command-substituted subcommand → NOT caught", "Bash", "gh pr $(echo merge) 123", false],
];

function mergeFenceSelftest() {
  let fail = 0;
  let extraChecks = 0;
  const check = (label, cond) => { const ok = !!cond; if (!ok) fail++; extraChecks++; console.log(`${ok ? "ok  " : "FAIL"} ${label}`); };
  for (const [label, toolName, command, want] of MERGE_FENCE_SELFTEST_CASES) {
    const got = matchesRawGhMerge(toolName, command);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → ${got} (want ${want})`);
  }
  // mergeFenceDecision folds a full event object the same way — a couple of
  // end-to-end cases over the event shape (incl. the malformed/absent tool_input
  // shapes the --hook shell can hand it) round out the matcher-only table above.
  const eventCases = [
    ["well-formed deny event", { tool_name: "Bash", tool_input: { command: "gh pr merge 1 --squash" } }, true],
    ["well-formed allow event (gh pr view)", { tool_name: "Bash", tool_input: { command: "gh pr view 1" } }, false],
    ["tool_input missing → allow", { tool_name: "Bash" }, false],
    ["tool_input non-object → allow", { tool_name: "Bash", tool_input: "gh pr merge 1" }, false],
    ["null event → allow", null, false],
  ];
  for (const [label, event, want] of eventCases) {
    const got = mergeFenceDecision(event);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} event: ${label} → ${got} (want ${want})`);
  }

  // === FAFF-526: matchesRawLocalBaseMerge — integration coverage against REAL git repos =====
  // (the matcher reads live `git remote`/branch state via cwd, so it cannot be driven purely).
  const localBaseTmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-merge-fence-local-base-"));
  const git = (cwd, ...gitArgs) => spawnSync("git", ["-C", cwd, ...gitArgs], { encoding: "utf8" });
  let localBaseCases = 0;
  try {
    // --- no-remote repo, sitting ON the base branch (main) ---
    const repoNoRemote = path.join(localBaseTmp, "no-remote");
    fs.mkdirSync(repoNoRemote, { recursive: true });
    git(repoNoRemote, "init", "-q", "-b", "main");
    git(repoNoRemote, "config", "user.email", "t@t.t");
    git(repoNoRemote, "config", "user.name", "t");
    fs.writeFileSync(path.join(repoNoRemote, "a.txt"), "1");
    git(repoNoRemote, "add", "-A");
    git(repoNoRemote, "commit", "-qm", "base");
    git(repoNoRemote, "checkout", "-qb", "feature");
    fs.writeFileSync(path.join(repoNoRemote, "b.txt"), "2");
    git(repoNoRemote, "add", "-A");
    git(repoNoRemote, "commit", "-qm", "feature work");
    git(repoNoRemote, "checkout", "-q", "main"); // sitting ON the base branch

    const localBaseCheck = (label, command, cwd, want) => {
      const got = matchesRawLocalBaseMerge(command, cwd);
      const ok = got === want;
      if (!ok) fail++;
      localBaseCases++;
      console.log(`${ok ? "ok  " : "FAIL"} local-base: ${label} → ${got} (want ${want})`);
    };

    localBaseCheck("no-remote, ON base, git merge <feature> → DENY (base-branch mutation)", "git merge feature", repoNoRemote, true);
    localBaseCheck("no-remote, ON base, git update-ref refs/heads/main <sha> → DENY", `git update-ref refs/heads/main ${git(repoNoRemote, "rev-parse", "feature").stdout.trim()}`, repoNoRemote, true);
    localBaseCheck("no-remote, ON base, git push . HEAD:main → DENY", "git push . HEAD:main", repoNoRemote, true);
    localBaseCheck("no-remote, ON base, git push /some/local/path HEAD:main → DENY", "git push /some/local/path HEAD:main", repoNoRemote, true);
    localBaseCheck("no-remote, ON base, git merge --abort → ALLOW (conflict resolution, not a landing attempt)", "git merge --abort", repoNoRemote, false);
    localBaseCheck("no-remote, ON base, git merge --continue → ALLOW", "git merge --continue", repoNoRemote, false);

    // --- base-branch CONSUMPTION: `git merge <base>` run FROM a feature branch — always ALLOWED ---
    git(repoNoRemote, "checkout", "-q", "feature");
    localBaseCheck("no-remote, ON feature, git merge main (consumption) → ALLOW", "git merge main", repoNoRemote, false);
    localBaseCheck("no-remote, ON feature, git update-ref refs/heads/main <sha> → still DENY (mutation, regardless of current branch)", `git update-ref refs/heads/main ${git(repoNoRemote, "rev-parse", "feature").stdout.trim()}`, repoNoRemote, true);
    localBaseCheck("no-remote, ON feature, unrelated command (git status) → ALLOW", "git status", repoNoRemote, false);

    // --- a repo WITH a remote: the matcher is a no-op regardless of the raw command ---
    const repoWithRemote = path.join(localBaseTmp, "with-remote");
    const bareRemote = path.join(localBaseTmp, "bare-remote.git");
    git(localBaseTmp, "init", "-q", "--bare", bareRemote);
    fs.mkdirSync(repoWithRemote, { recursive: true });
    git(repoWithRemote, "init", "-q", "-b", "main");
    git(repoWithRemote, "config", "user.email", "t@t.t");
    git(repoWithRemote, "config", "user.name", "t");
    git(repoWithRemote, "remote", "add", "origin", bareRemote);
    fs.writeFileSync(path.join(repoWithRemote, "a.txt"), "1");
    git(repoWithRemote, "add", "-A");
    git(repoWithRemote, "commit", "-qm", "base");
    git(repoWithRemote, "checkout", "-qb", "feature");
    fs.writeFileSync(path.join(repoWithRemote, "b.txt"), "2");
    git(repoWithRemote, "add", "-A");
    git(repoWithRemote, "commit", "-qm", "feature work");
    git(repoWithRemote, "checkout", "-q", "main");
    localBaseCheck("remote-backed repo, ON base, git merge <feature> → ALLOW (matcher dormant, zero L1-L3 impact)", "git merge feature", repoWithRemote, false);
    localBaseCheck("remote-backed repo, ON base, git update-ref refs/heads/main <sha> → ALLOW (matcher dormant)", `git update-ref refs/heads/main ${git(repoWithRemote, "rev-parse", "feature").stdout.trim()}`, repoWithRemote, false);

    // --- non-repo / unresolvable cwd → definite non-match, never a throw ---
    const notARepo = path.join(localBaseTmp, "not-a-repo");
    fs.mkdirSync(notARepo, { recursive: true });
    localBaseCheck("non-git directory → ALLOW (indeterminate remote-state fails toward dormant)", "git merge feature", notARepo, false);

    // --- regression: matchesRawGhMerge / the gh-merge event path is byte-identical on a no-remote repo ---
    git(repoNoRemote, "checkout", "-q", "main"); // back onto the base branch for the deny-shape checks below
    check("regression: matchesRawGhMerge unaffected by the new matcher (still denies gh pr merge)", matchesRawGhMerge("Bash", "gh pr merge 1 --squash") === true);
    check("mergeFenceDecisionDetail: local-base deny carries the local-base remedy message", mergeFenceDecisionDetail({ tool_name: "Bash", tool_input: { command: "git merge feature" }, cwd: repoNoRemote }).message === LOCAL_BASE_FENCE_DENY_MESSAGE);
    check("mergeFenceDecisionDetail: gh-merge deny carries the ORIGINAL remedy message (checked first)", mergeFenceDecisionDetail({ tool_name: "Bash", tool_input: { command: "gh pr merge 1" }, cwd: repoNoRemote }).message === MERGE_FENCE_DENY_MESSAGE);
    check("mergeFenceDecisionDetail: event with no cwd → local-base check never fires (cwd is the sole source, never inferred)", mergeFenceDecisionDetail({ tool_name: "Bash", tool_input: { command: "git merge feature" } }).deny === false);
    check("mergeFenceDecision: boolean wrapper agrees with the detail form (local-base deny)", mergeFenceDecision({ tool_name: "Bash", tool_input: { command: "git merge feature" }, cwd: repoNoRemote }) === true);
  } finally {
    fs.rmSync(localBaseTmp, { recursive: true, force: true });
  }

  const total = MERGE_FENCE_SELFTEST_CASES.length + eventCases.length + localBaseCases + extraChecks;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { LOCAL_BASE_FENCE_DENY_MESSAGE, MERGE_FENCE_DENY_MESSAGE, MERGE_FENCE_SELFTEST_CASES, cmdMergeFence, matchesGitMergeLandingCommand, matchesLocalPushToBase, matchesRawGhMerge, matchesRawLocalBaseMerge, matchesUpdateRefBase, mergeFenceDecision, mergeFenceDecisionDetail, mergeFenceSelftest };
