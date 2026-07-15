// ===========================================================================
// === region:factory — background-fence — FAFF-491: the PreToolUse fence on a self-backgrounded gate command. ===
// A build/graft subagent that runs its own gate/test command (`node --test`,
// `faff gates run`, `npm test`, …) with `run_in_background: true` and then ends
// its turn strands the build mid-flight — nothing resumes it until heartbeat
// staleness (900s) flags the run for a human/ground-truth recovery. Two live
// occurrences (FAFF-466, FAFF-446) show the graft-prose prohibition alone is
// not enough (a third occurrence recurred even with an inline, ticket-naming
// warning in the dispatch prompt). This is the mechanical, PROBE-GATED third
// layer: a PreToolUse hook that DENIES a Bash tool call whose command matches
// a known gate-family shape AND whose run_in_background is the strict boolean
// true. Shaped exactly like merge-fence (FAFF-434): a pure matcher over
// (tool_name, command, run_in_background), plus a thin stdin shell.
// ===========================================================================

const fs = require("node:fs");

// PURE: does this command look like a gate/test-family invocation? A
// deliberately narrow set of token shapes — the ones actually observed
// (`node --test`, the Step 7.5 ladder's `"$faff" gates run`) plus the common
// repo-declared test runners the ladder discovers (`faff gates discover`):
// npm test / npm run test*, npx vitest|jest|mocha|ava|tap, make test, pytest,
// cargo test, go test. Each pattern tolerates a leading path/env/quote/variable
// prefix on the BINARY token (mirroring merge-fence's `(^|[^\w])` boundary —
// any non-word character, including `/`, `"`, `$`, `=`, transparently precedes
// the token), because the failure mode observed in practice IS the quoted-
// variable ladder invocation (`"$faff" gates run`). The `gates run` pair
// requires a nearby `faff`-referencing token (see the pattern's own comment) —
// an un-anchored bare-pair match was found, in Phase-2 adversarial review, to
// collide with any unrelated tool invoked as `<name> run` where the name
// contains "gates" (e.g. a project's own `gates run-suite` script).
//
// LIMITATION (by design, same stance as merge-fence): a token-sequence regex,
// not a shell parser — a command that BREAKS a required token with quoting,
// string-splicing, variable expansion, or command substitution (`n"o"de
// --test`, `npm run "test"`, `node --"test"`) is NOT matched. This is the
// OUTERMOST guard-rail against the naive/literal form, never the full-coverage
// boundary — the selftest pins these honestly as LIMITATION allow-cases.
const GATE_FAMILY_PATTERNS = [
  // faff gates run — the Step 7.5 ladder invocation. Requires a `faff`-referencing
  // token (case-insensitive substring "faff" — bare, path-prefixed, or the ladder's
  // own quoted/variable form `"$faff"`) immediately before "gates run", rather than
  // matching the bare token pair anywhere: an adversarial-review finding (FAFF-491
  // Phase 2) showed the un-anchored form over-matches an UNRELATED tool named
  // `gates` invoked as `gates run` (e.g. `bin/gates run-suite`, a project's own
  // `./scripts/gates run-smoke-tests`) — "gates run" is two common English words,
  // a much higher collision risk than merge-fence's near-unique `gh pr merge`.
  /(^|[^\w])\S*faff\S*\s+gates\s+run\b/i,
  // node --test
  /(^|[^\w])node\b[^\n]*(^|\s)--test(\s|=|$)/,
  // npm test / npm run test*
  /(^|[^\w])npm\s+(test\b|run\s+test[\w:-]*)/,
  // npx vitest|jest|mocha|ava|tap
  /(^|[^\w])npx\s+(vitest|jest|mocha|ava|tap)\b/,
  // make test
  /(^|[^\w])make\s+test\b/,
  // pytest
  /(^|[^\w])pytest\b/,
  // cargo test
  /(^|[^\w])cargo\s+test\b/,
  // go test
  /(^|[^\w])go\s+test\b/,
];

function matchesGateFamily(command) {
  return GATE_FAMILY_PATTERNS.some((re) => re.test(command));
}

// PURE: the fence's whole decision. Keys on the CONJUNCTION — a gate-family
// command alone (foreground) is never denied, and a backgrounded non-gate
// command (a dev server, a Monitor loop) is never denied. run_in_background is
// checked STRICTLY against the boolean `true`: absent, `false`, or any
// non-boolean (e.g. the string `"true"`) all resolve to allow — the harness
// serialises a genuine JSON boolean for this field, so anything else is not
// the failure mode this fence exists for, and fail-safe is allow.
function matchesBackgroundedGate(toolName, command, runInBackground) {
  if (toolName !== "Bash") return false;
  if (runInBackground !== true) return false;
  if (typeof command !== "string" || command.length === 0) return false;
  return matchesGateFamily(command);
}

// The single-line stderr deny message — names the foreground remedy (never
// just "denied"), plus the human-operator escape hatch (merge-fence FAFF-375
// style: a human intentionally backgrounding this runs it in a real terminal).
const BACKGROUND_FENCE_DENY_MESSAGE =
  "faff background-fence: a gate/test command must run in the FOREGROUND — never `run_in_background: true`, and never " +
  "end a turn with a background job in flight. Re-issue this command in the foreground with a generous timeout " +
  "(chunk/poll across successive foreground calls if it risks exceeding the tool's max timeout — never background it). " +
  "If you are a human operator intentionally backgrounding this, run it yourself in a real terminal.\n";

// PURE: fold a parsed PreToolUse event down to the matcher's three inputs. A
// non-object event, or one missing tool_input, resolves to a definite
// non-match rather than throwing — the --hook shell's JSON.parse already
// fail-safes a malformed event to exit 0 before this is ever called with a
// non-null event.
function backgroundFenceDecision(event) {
  if (event === null || typeof event !== "object") return false;
  const toolInput = event.tool_input;
  const command = toolInput && typeof toolInput === "object" ? toolInput.command : undefined;
  const runInBackground = toolInput && typeof toolInput === "object" ? toolInput.run_in_background : undefined;
  return matchesBackgroundedGate(event.tool_name, command, runInBackground);
}

function cmdBackgroundFence(args) {
  if (args.includes("--selftest")) return backgroundFenceSelftest();
  if (!args.includes("--hook")) {
    process.stderr.write("faff background-fence: use --hook (reads a PreToolUse JSON event on stdin) or --selftest\n");
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
  if (!backgroundFenceDecision(event)) return 0;
  process.stderr.write(BACKGROUND_FENCE_DENY_MESSAGE);
  return 2;
}

// [label, tool_name, command, run_in_background, wantMatch] — drives the pure
// matcher directly (no filesystem, no stdin): deny cases (every gate-family
// shape, backgrounded — including the ladder's quoted-variable form), allow
// cases (foreground gate runs, a backgrounded non-gate command, a non-Bash
// tool, absent/false/non-boolean run_in_background), and LIMITATION allow-
// cases (quoted/spliced/substituted spellings — recorded, not defects).
const BACKGROUND_FENCE_SELFTEST_CASES = [
  // --- deny: every gate-family shape, backgrounded ---
  ["Bash node --test, backgrounded → deny", "Bash", "node --test", true, true],
  ["Bash node --test with extra args, backgrounded → deny", "Bash", "node --test --watch tests/", true, true],
  ["Bash faff gates run, backgrounded → deny", "Bash", "faff gates run --json", true, true],
  ["Bash quoted-variable ladder form, backgrounded → deny", "Bash", '"$faff" gates run --json', true, true],
  ["Bash npm test, backgrounded → deny", "Bash", "npm test", true, true],
  ["Bash npm run test, backgrounded → deny", "Bash", "npm run test", true, true],
  ["Bash npm run test:unit, backgrounded → deny", "Bash", "npm run test:unit", true, true],
  ["Bash npx vitest, backgrounded → deny", "Bash", "npx vitest run", true, true],
  ["Bash npx jest, backgrounded → deny", "Bash", "npx jest", true, true],
  ["Bash npx mocha, backgrounded → deny", "Bash", "npx mocha", true, true],
  ["Bash npx ava, backgrounded → deny", "Bash", "npx ava", true, true],
  ["Bash npx tap, backgrounded → deny", "Bash", "npx tap", true, true],
  ["Bash make test, backgrounded → deny", "Bash", "make test", true, true],
  ["Bash pytest, backgrounded → deny", "Bash", "pytest -x", true, true],
  ["Bash cargo test, backgrounded → deny", "Bash", "cargo test", true, true],
  ["Bash go test, backgrounded → deny", "Bash", "go test ./...", true, true],
  ["Bash path-prefixed node --test, backgrounded → deny", "Bash", "/usr/local/bin/node --test", true, true],
  // --- allow: foreground gate commands (the conjunction never fires on the command alone) ---
  ["Bash node --test, foreground (false) → allow", "Bash", "node --test", false, false],
  ["Bash node --test, foreground (absent) → allow", "Bash", "node --test", undefined, false],
  ["Bash faff gates run, foreground → allow", "Bash", "faff gates run --json", false, false],
  ["Bash npm test, foreground → allow", "Bash", "npm test", false, false],
  // --- allow: backgrounded non-gate command ---
  ["Bash npm run dev, backgrounded → allow (not gate-family)", "Bash", "npm run dev", true, false],
  ["Bash a plain dev server, backgrounded → allow", "Bash", "python -m http.server 8000", true, false],
  ["Bash git status, backgrounded → allow", "Bash", "git status", true, false],
  // --- allow: an UNRELATED tool named/subcommanded "gates run" with no faff-referencing
  // token nearby (Phase-2 adversarial review finding — the un-anchored bare-pair match
  // over-collided with these) ---
  ["Bash bin/gates run-suite (unrelated tool), backgrounded → allow", "Bash", "bin/gates run-suite", true, false],
  ["Bash ./scripts/gates run-smoke-tests (unrelated tool), backgrounded → allow", "Bash", "./scripts/gates run-smoke-tests", true, false],
  // --- allow: non-Bash tool ---
  ["non-Bash tool_name → allow regardless of command/flag", "Read", "node --test", true, false],
  // --- allow: absent/non-boolean run_in_background (strict boolean check) ---
  ["Bash node --test, run_in_background is the string \"true\" → allow", "Bash", "node --test", "true", false],
  ["Bash node --test, run_in_background is 1 → allow", "Bash", "node --test", 1, false],
  ["Bash node --test, run_in_background is null → allow", "Bash", "node --test", null, false],
  // --- malformed input shapes the --hook shell can hand the matcher ---
  ["absent command → allow", "Bash", undefined, true, false],
  ["non-string command → allow", "Bash", 123, true, false],
  ["absent tool_name → allow", undefined, "node --test", true, false],
  // --- DOCUMENTED LIMITATION (recorded, not a defect): a regex token-sequence matcher,
  // not a shell parser, so a command that BREAKS a required token with quoting,
  // splicing, variable expansion, or command substitution is NOT caught. ---
  ["LIMITATION: string-spliced binary name → NOT caught", "Bash", 'n"o"de --test', true, false],
  ["LIMITATION: quoted flag → NOT caught", "Bash", 'node --"test"', true, false],
  ["LIMITATION: quoted npm test target → NOT caught", "Bash", 'npm run "test"', true, false],
  ["LIMITATION: command-substituted subcommand → NOT caught", "Bash", "npm $(echo run) test", true, false],
  // DOCUMENTED LIMITATION (Phase-2 adversarial review finding, accepted — safe-direction
  // over-match, never under-catch): the node --test pattern scans the whole command line
  // for a whitespace/`=`-bounded --test token, so a node SCRIPT that happens to take its
  // OWN --test flag (unrelated to Node's built-in test runner) is also denied when
  // backgrounded. Costs an unnecessary foreground run for that rare shape; never lets an
  // actual `node --test` invocation through backgrounded — the failure mode this fence
  // exists for.
  ["LIMITATION: node script.js --test (script's own flag, not node's test runner) → also denied (safe-direction over-match)", "Bash", "node script.js --test", true, true],
];

function backgroundFenceSelftest() {
  let fail = 0;
  for (const [label, toolName, command, runInBackground, want] of BACKGROUND_FENCE_SELFTEST_CASES) {
    const got = matchesBackgroundedGate(toolName, command, runInBackground);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${label} → ${got} (want ${want})`);
  }
  // backgroundFenceDecision folds a full event object the same way — a couple of
  // end-to-end cases over the event shape (incl. the malformed/absent tool_input
  // shapes the --hook shell can hand it) round out the matcher-only table above.
  const eventCases = [
    ["well-formed deny event", { tool_name: "Bash", tool_input: { command: "node --test", run_in_background: true } }, true],
    ["well-formed allow event (foreground)", { tool_name: "Bash", tool_input: { command: "node --test", run_in_background: false } }, false],
    ["well-formed allow event (non-gate, backgrounded)", { tool_name: "Bash", tool_input: { command: "npm run dev", run_in_background: true } }, false],
    ["tool_input missing → allow", { tool_name: "Bash" }, false],
    ["tool_input non-object → allow", { tool_name: "Bash", tool_input: "node --test" }, false],
    ["null event → allow", null, false],
  ];
  for (const [label, event, want] of eventCases) {
    const got = backgroundFenceDecision(event);
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} event: ${label} → ${got} (want ${want})`);
  }
  const total = BACKGROUND_FENCE_SELFTEST_CASES.length + eventCases.length;
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { BACKGROUND_FENCE_DENY_MESSAGE, BACKGROUND_FENCE_SELFTEST_CASES, GATE_FAMILY_PATTERNS, backgroundFenceDecision, backgroundFenceSelftest, cmdBackgroundFence, matchesBackgroundedGate, matchesGateFamily };
