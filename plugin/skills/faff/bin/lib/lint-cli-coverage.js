// === region:factory — lint-cli-coverage — FAFF-581: assert every subcommand is tested by something ===
// The registry-coverage gate. Every entry in the COMMANDS registry (the single
// source of truth — see main()) must be covered by EITHER a runnable standalone
// selftest (a non-null REGION_SELFTEST_ARGV entry, spawned by `regions selftest`)
// OR an explicit TEST_FILE_COVERAGE declaration (a `null`-selftest command that a
// `test/*.mjs` file exercises). Bidirectional and FAIL-CLOSED, in lint-cli-doc's
// shape (FAFF-237): a COMMANDS entry covered by neither is `uncovered`; a
// TEST_FILE_COVERAGE key that is not a COMMANDS entry is `orphaned`.
//
// DECLARED, NOT GREP-GUESSED (FAFF-581 §3): coverage is an explicit list, never a
// grep of `test/*.mjs` for the subcommand token — an incidental string mention
// would read as coverage and the gate would fail OPEN. A gate that can pass on an
// incidental mention is not a gate. The small maintenance cost (the ~5 null-selftest
// commands) buys a gate that fails CLOSED.
//
// This is distinct from the region sweep (`regions selftest`), which makes selftests
// RUN; this asserts every command is COVERED by something. And distinct from
// scripts/verify-split-parity.mjs's `coverageCheck`, which is a spent one-time
// `--help`↔MATRIX migration-parity check, not a test-coverage gate (FAFF-581 §3).
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const { REGION_SELFTEST_ARGV } = require("./regions");

const LINT_CLI_COVERAGE_SPEC = { flags: { "--root": { arity: 1 }, "--selftest": { arity: 0 }, "--json": { arity: 0 } } };

// Declared test-file coverage for the deliberate `null`-selftest commands
// (REGION_SELFTEST_ARGV[cmd] === null): each names the `test/*.mjs` file that
// exercises it through the real entrypoint. Explicit + auditable — a new
// `null`-selftest command with no entry here fails the gate loud (the intended
// catch). A belt-and-braces entry for a command that ALSO has a non-null selftest
// is allowed (never an error). Keyed by COMMANDS name; every key must be a
// COMMANDS entry (the orphaned side of the bidirectional diff).
const TEST_FILE_COVERAGE = {
  "sync": "test/sync.test.mjs",
  "validate-adapters": "test/validate-adapters-prose-defaults.test.mjs",
  "labels": "test/claim-verdict.test.mjs",
  "state": "test/cli-coverage.test.mjs",
  "doctor": "test/doctor.test.mjs",
};

// A command is selftest-covered iff its allowlist entry is a runnable argv array
// (a non-null value). `null` (deliberately no standalone selftest) and `undefined`
// (missing entirely — fail-closed) are both NOT selftest-covered.
const hasSelftest = (cmd, argvMap) => Array.isArray(argvMap[cmd]);

// Pure bidirectional diff: uncovered = a COMMANDS entry with neither a non-null
// selftest nor a TEST_FILE_COVERAGE declaration; orphaned = a TEST_FILE_COVERAGE
// key that is not a COMMANDS entry. Filesystem-free (the real command adds an
// existence check on top). Mirrors lint-cli-doc's diffCliDoc.
function diffCoverage(commandKeys, argvMap, testFileCoverage) {
  const commands = new Set(commandKeys);
  const declared = Object.keys(testFileCoverage);
  const uncovered = [...commands]
    .filter((c) => !hasSelftest(c, argvMap) && !declared.includes(c))
    .sort();
  const orphaned = declared.filter((d) => !commands.has(d)).sort();
  return { uncovered, orphaned };
}

function cmdLintCliCoverage(args, COMMANDS) {
  if (args.includes("--selftest")) return lintCliCoverageSelftest();
  const { values, errors } = parseArgs(args, LINT_CLI_COVERAGE_SPEC);
  if (errors.length) return usageError(errors, "usage: faff lint-cli-coverage [--root DIR] [--json]");
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  const commandKeys = Object.keys(COMMANDS);
  const { uncovered, orphaned } = diffCoverage(commandKeys, REGION_SELFTEST_ARGV, TEST_FILE_COVERAGE);

  // Belt-and-braces: a declared test file that no longer exists is a stale
  // declaration — fail closed so the list can't rot. Skipped (never a hard tooling
  // failure) if the root/file can't be resolved.
  const missingFiles = [];
  for (const [cmd, rel] of Object.entries(TEST_FILE_COVERAGE)) {
    let exists = true;
    try { exists = fs.existsSync(path.join(root, rel)); } catch { exists = true; }
    if (!exists) missingFiles.push(`${cmd} → ${rel}`);
  }

  const ok = uncovered.length === 0 && orphaned.length === 0 && missingFiles.length === 0;

  if (json) {
    console.log(JSON.stringify({ ok, commands: commandKeys.length, uncovered, orphaned, missingFiles }));
    return ok ? 0 : 1;
  }
  if (ok) {
    console.log(`PASS  lint-cli-coverage: ${commandKeys.length} subcommands, every one selftest- or test-file-covered`);
    return 0;
  }
  for (const u of uncovered) console.log(`FAIL  ✗ uncovered: ${u} (no non-null selftest and no TEST_FILE_COVERAGE declaration)`);
  for (const o of orphaned) console.log(`FAIL  ✗ orphaned: ${o} (in TEST_FILE_COVERAGE but not a COMMANDS entry)`);
  for (const m of missingFiles) console.log(`FAIL  ✗ stale test-file declaration: ${m} (file not found)`);
  process.stderr.write(`faff lint-cli-coverage: ${uncovered.length} uncovered, ${orphaned.length} orphaned, ${missingFiles.length} stale — every COMMANDS entry needs a selftest or a declared test file\n`);
  return 1;
}

// In-memory selftest of the pure diff helper (mirrors lint-cli-doc --selftest).
// Filesystem-free — synthetic COMMANDS / argv / TEST_FILE_COVERAGE sets, so it is
// host-safe and deterministic (spawned by `regions selftest --region factory`).
function lintCliCoverageSelftest() {
  let failed = 0;
  const check = (label, got, want) => {
    if (got !== want) {
      process.stderr.write(`lint-cli-coverage --selftest FAIL: ${label} (want ${want}, got ${got})\n`);
      failed++;
    }
  };

  // In-sync: every command covered by a selftest or a declaration → empty diff.
  const argv = { "alpha": ["alpha", "--selftest"], "beta": null, "gamma": ["gamma", "--selftest"] };
  const tfc = { "beta": "test/beta.test.mjs" };
  const clean = diffCoverage(["alpha", "beta", "gamma"], argv, tfc);
  check("in-sync no uncovered", clean.uncovered.length, 0);
  check("in-sync no orphaned", clean.orphaned.length, 0);

  // A null-selftest command with no declaration → uncovered, named.
  const uncov = diffCoverage(["alpha", "beta", "delta"], { ...argv, "delta": null }, tfc);
  check("one uncovered", uncov.uncovered.length, 1);
  check("uncovered names delta", uncov.uncovered[0] === "delta" ? 1 : 0, 1);

  // A command MISSING from the argv map entirely (undefined) is fail-closed:
  // undefined is not an array → not selftest-covered → uncovered unless declared.
  const missing = diffCoverage(["alpha", "epsilon"], argv, tfc);
  check("missing-from-argv is uncovered (fail-closed)", missing.uncovered.includes("epsilon") ? 1 : 0, 1);

  // A TEST_FILE_COVERAGE key that is not a COMMANDS entry → orphaned, named.
  const orph = diffCoverage(["alpha", "beta", "gamma"], argv, { ...tfc, "ghost": "test/ghost.test.mjs" });
  check("one orphaned", orph.orphaned.length, 1);
  check("orphaned names ghost", orph.orphaned[0] === "ghost" ? 1 : 0, 1);

  // Belt-and-braces: a declaration for a command that ALSO has a non-null selftest
  // is allowed (not an error) — covered by the selftest, the declaration is redundant.
  const both = diffCoverage(["alpha", "beta"], argv, { "beta": "test/beta.test.mjs", "alpha": "test/alpha.test.mjs" });
  check("belt-and-braces declaration is not an error", both.uncovered.length + both.orphaned.length, 0);

  if (failed) return 1;
  console.log("lint-cli-coverage --selftest: ok");
  return 0;
}

module.exports = { TEST_FILE_COVERAGE, cmdLintCliCoverage, diffCoverage, hasSelftest, lintCliCoverageSelftest };
