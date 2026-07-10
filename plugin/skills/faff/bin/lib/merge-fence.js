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

function matchesRawGhMerge(toolName, command) {
  if (toolName !== "Bash") return false;
  if (typeof command !== "string" || command.length === 0) return false;
  return /(^|[^\w])gh\s+pr\s+merge(\s|$)/.test(command);
}

// The single-line stderr deny message — names `faff merge-gate` as the sanctioned
// remedy (never just "denied"), plus the human-operator escape hatch (run
// merge-gate yourself in a real terminal, mirroring merge-gate's own human-only
// flag fencing, FAFF-375).
const MERGE_FENCE_DENY_MESSAGE =
  "faff merge-fence: raw gh pr merge is not the sanctioned merge path — route this merge through " +
  "`faff merge-gate` (the sole sanctioned path). If you are a human operator, run merge-gate yourself " +
  "in a real terminal.\n";

// PURE: fold a parsed PreToolUse event down to the matcher's two inputs. A
// non-object event, or one missing tool_input, resolves to a definite non-match
// rather than throwing — the --hook shell's JSON.parse already fail-safes a
// malformed event to exit 0 before this is ever called with a non-null event.
function mergeFenceDecision(event) {
  if (event === null || typeof event !== "object") return false;
  const toolInput = event.tool_input;
  const command = toolInput && typeof toolInput === "object" ? toolInput.command : undefined;
  return matchesRawGhMerge(event.tool_name, command);
}

function cmdMergeFence(args) {
  if (args.includes("--selftest")) return mergeFenceSelftest();
  if (!args.includes("--hook")) {
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
  if (!mergeFenceDecision(event)) return 0;
  process.stderr.write(MERGE_FENCE_DENY_MESSAGE);
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
  const total = MERGE_FENCE_SELFTEST_CASES.length + eventCases.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { MERGE_FENCE_DENY_MESSAGE, MERGE_FENCE_SELFTEST_CASES, cmdMergeFence, matchesRawGhMerge, mergeFenceDecision, mergeFenceSelftest };
