// === region:factory — lint-cli-doc — FAFF-237: assert docs/guide/cli.md documents every subcommand ===
// the CLI dispatches. The canonical set is the COMMANDS registry (single source
// of truth — see main()); the documented set is parsed from the doc's table rows.
// Bidirectional: a command in the CLI but not the doc is `missing`; a command in
// the doc but not the CLI is `orphaned`. Sibling of lint-refs.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const LINT_CLI_DOC_SPEC = { flags: { "--root": { arity: 1 }, "--selftest": { arity: 0 }, "--json": { arity: 0 } } };
const { findRoot } = require("./shared-infra");

const CLI_DOC_PATH = "docs/guide/cli.md";

// Documented base-command set: the first command-shaped token of the LEADING
// inline-backtick span of each markdown table row. Anchored to the row's first
// column (^\|\s*`) so `--flags`, `.faffrc.yaml`, `docs/adr/` spans never match;
// deduped so alternate-form rows (`config` / `config init`) collapse to one base.
function parseDocumentedCommands(text) {
  const documented = new Set();
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*`([a-z][a-z-]*)\b/);
    if (m) documented.add(m[1]);
  }
  return documented;
}

// Pure set diff: missing = in CLI, not in doc; orphaned = in doc, not in CLI.
function diffCliDoc(canonical, documented) {
  const missing = [...canonical].filter((c) => !documented.has(c)).sort();
  const orphaned = [...documented].filter((d) => !canonical.has(d)).sort();
  return { missing, orphaned };
}

function cmdLintCliDoc(args, COMMANDS) {
  if (args.includes("--selftest")) return lintCliDocSelftest();
  const { values, errors } = parseArgs(args, LINT_CLI_DOC_SPEC);
  if (errors.length) return usageError(errors, "usage: faff lint-cli-doc [--root DIR] [--json]");
  const json = !!values["--json"];
  const root = values["--root"] || findRoot();

  const canonical = new Set(Object.keys(COMMANDS));
  const docPath = path.join(root, CLI_DOC_PATH);
  let text;
  try {
    text = fs.readFileSync(docPath, "utf8");
  } catch {
    if (json) console.log(JSON.stringify({ ok: false, error: `cannot read ${CLI_DOC_PATH}` }));
    else process.stderr.write(`lint-cli-doc: cannot read ${docPath}\n`);
    return 2;
  }
  const documented = parseDocumentedCommands(text);
  const { missing, orphaned } = diffCliDoc(canonical, documented);
  const ok = missing.length === 0 && orphaned.length === 0;

  if (json) {
    console.log(JSON.stringify({ ok, documented: canonical.size, missing, orphaned }));
    return ok ? 0 : 1;
  }
  if (ok) {
    console.log(`PASS  lint-cli-doc: ${canonical.size} subcommands documented`);
    return 0;
  }
  for (const m of missing) console.log(`FAIL  ${CLI_DOC_PATH} ✗ missing: ${m}`);
  for (const o of orphaned) console.log(`FAIL  ${CLI_DOC_PATH} ✗ orphaned: ${o}`);
  process.stderr.write(`faff lint-cli-doc: ${missing.length} missing, ${orphaned.length} orphaned — sync ${CLI_DOC_PATH} with the CLI\n`);
  return 1;
}

// In-memory self-test of the pure parse + diff helpers (mirrors lint-refs --selftest).
function lintCliDocSelftest() {
  let failed = 0;
  const check = (label, got, want) => {
    if (got !== want) {
      process.stderr.write(`lint-cli-doc --selftest FAIL: ${label} (want ${want}, got ${got})\n`);
      failed++;
    }
  };

  // parseDocumentedCommands: leading span only; flags/paths not matched; dedupe to base.
  const doc = [
    "| Subcommand | What it does |",
    "|---|---|",
    "| `config <path\\|get…> …` | reads `.faffrc.yaml`, the `--json` form |",
    "| `config init --set k=v` | merge a `tracking:` block |",
    "| `validate-adapters --configured` | pre-flight `.faff/` occupants |",
    "| `worktree-prune [--own PATH]` | scoped prune; never touch `docs/adr/` |",
    "some prose with a `--flag` and `.faffrc.yaml` span, not a table row",
  ].join("\n");
  const parsed = parseDocumentedCommands(doc);
  check("parses 3 base commands", parsed.size, 3);
  check("config deduped to one", parsed.has("config") ? 1 : 0, 1);
  check("validate-adapters base", parsed.has("validate-adapters") ? 1 : 0, 1);
  check("worktree-prune base", parsed.has("worktree-prune") ? 1 : 0, 1);
  check("no false hit on --flag span", parsed.has("flag") ? 1 : 0, 0);
  check("no false hit on .faffrc span", parsed.has("faffrc") ? 1 : 0, 0);

  // diffCliDoc: missing + orphaned both detected and named.
  const drift = diffCliDoc(new Set(["config", "next", "lint-cli-doc"]), new Set(["config", "next", "ghost"]));
  check("one missing", drift.missing.length, 1);
  check("missing names lint-cli-doc", drift.missing[0] === "lint-cli-doc" ? 1 : 0, 1);
  check("one orphaned", drift.orphaned.length, 1);
  check("orphaned names ghost", drift.orphaned[0] === "ghost" ? 1 : 0, 1);

  // in-sync sets → empty diff.
  const sync = diffCliDoc(new Set(["a", "b"]), new Set(["a", "b"]));
  check("in-sync no missing", sync.missing.length, 0);
  check("in-sync no orphaned", sync.orphaned.length, 0);

  if (failed) return 1;
  console.log("lint-cli-doc --selftest: ok");
  return 0;
}

// --- Lights-out admissibility gate (FAFF-224) ------------------------------
// A pure, deterministic structural check over a spec's machine-verifiable DoD —
// the L4 quality-IN floor. It refuses a spec into the unattended build queue
// unless its `## Scenarios` + `### N. DONE` structure is machine-checkable.
//
// DETERMINISTIC, NEVER LLM: the verdict is a pure function over the spec's text
// structure (section presence, checkbox lines, scenario keywords, a banned-vague
// filter). It calls no model and never re-invokes the spec producer — an LLM
// judging whether the DoD is verifiable IS the agent grading itself, the exact
// failure L4 removes. The semantic judgement layer sits ABOVE this gate (FAFF-9).
//
// FAIL-SAFE: an ambiguous / unparseable / structurally-absent DoD is
// inadmissible (parks for a human), never silently admitted — mirroring the
// eligibility gate's "any resolution failure → not-eligible".
//
// SCOPE: active only under the lights-out signal. Absent → no-op admissible, so
// L1–L3 behaviour is unchanged (the signal fail-safe defaults OFF at the caller).

// Banned-vague DONE phrasings — a named constant, not scattered literals. Seeded
// from the spec producers' own documented anti-pattern ("Works correctly is not a
// DONE item"). Case-insensitive substring match; a tunable denylist (a floor, by
// design — tune from real misses, never escalate to an LLM).

module.exports = { CLI_DOC_PATH, cmdLintCliDoc, diffCliDoc, lintCliDocSelftest, parseDocumentedCommands };
