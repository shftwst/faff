// === region:shared-infra — argv — FAFF-576: the shared fail-closed flag parser ===
// argv.js — the shared fail-closed flag parser for the faff CLI (FAFF-576).
//
// The faff CLI was fail-closed on flag *values* (closed enums everywhere) but fail-open
// on the *flags themselves*: every handler scanned `args.indexOf(flag)` and took the next
// array element as the value. That scan has two blind spots — an unknown flag is never
// looked for (so a typo'd `--recover`/`--not-eligible` is a silent no-op), and `args[i+1]`
// is taken with no check that a value is actually there (so `--run-dir --json` binds the
// string "--json" as the run-dir and silently drops --json).
//
// This module closes both in one place: each subcommand declares which flags it accepts and
// each flag's arity (a CommandSpec); `parseArgs` validates against that declaration and an
// unknown flag or a missing value is a loud exit 2 (via `usageError`) instead of a silent
// guess. The parser is PURE (no I/O, no process.exit) so the selftest table can exercise it
// directly; the handler owns the exit.
//
// Sibling of shared-infra.js in the shared-primitive tier (one module per concern, FAFF-441).

"use strict";

// ---------------------------------------------------------------------------
// Types (documented; JS carries no static shape)
//
// FlagSpec:    { arity: 0|1, enum?: string[], repeatable?: boolean, aliases?: string[], greedy?: boolean }
//   greedy:    arity-1 only — consume the next token as the value UNCONDITIONALLY, even when it
//              begins with "--" (for a flag whose value is itself a flag-string, e.g. merge-gate's
//              `--merge-args "--squash --delete-branch"`). The missing-value guard still fires when
//              there is no next token at all. Absent/false ⇒ the default "--"-successor = missing-value rule.
// CommandSpec: { flags: { [canonicalFlag: string]: FlagSpec },
//                positionals?: { min: number, max: number|null, name?: string } }
// ParseResult: { values: { [flag]: string | string[] | true }, positionals: string[], errors: ParseError[] }
// ParseError:  { code, flag?, detail }
//   code ∈ unknown-flag | missing-value | bad-enum | duplicate-flag | bad-arity
//            | too-many-positionals | too-few-positionals
// ---------------------------------------------------------------------------

// Resolve a token's flag name (canonical or alias) to its canonical name + spec.
// Returns { canonical, spec } or null when the name is not declared.
function resolveFlag(name, spec) {
  const flags = spec.flags || {};
  if (Object.prototype.hasOwnProperty.call(flags, name)) return { canonical: name, spec: flags[name] };
  for (const canonical of Object.keys(flags)) {
    const aliases = flags[canonical].aliases;
    if (Array.isArray(aliases) && aliases.includes(name)) return { canonical, spec: flags[canonical] };
  }
  return null;
}

// Is `tok` a token that must NOT be consumed as an arity-1 flag's value?
// Per spec §3 Missing-value detection: a value never begins with "--" in this CLI's
// vocabulary (issue ids, paths, ISO dates, closed enums, gitkeys), so a "--"-prefixed
// successor is unambiguously the next flag. A single-dash token is treated as not-a-value
// only when it actually resolves to a declared short flag/alias (so a lone "-" stdin
// sentinel or an unusual "-"-leading value is still accepted as a value).
function looksLikeNextFlag(tok, spec) {
  if (tok === undefined) return true;
  if (tok.startsWith("--")) return true;
  if (tok.startsWith("-") && tok !== "-") {
    const bare = tok.split("=")[0];
    return resolveFlag(bare, spec) !== null;
  }
  return false;
}

/**
 * Parse argv against a CommandSpec. Pure: returns a ParseResult, never exits, never does I/O.
 * Accumulates ALL errors in one pass (not fail-fast) so one invocation reports every problem.
 *
 * @param {string[]} argv  the handler's args (already peeled of the subcommand name)
 * @param {object}   spec  CommandSpec
 * @returns {{values: object, positionals: string[], errors: object[]}}
 */
function parseArgs(argv, spec) {
  spec = spec || {};
  const values = {};
  const positionals = [];
  const errors = [];
  const seen = Object.create(null); // canonical flag -> times seen (duplicate detection)

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];

    // Explicit end-of-flags sentinel: everything after is positional.
    if (tok === "--") {
      for (let j = i + 1; j < argv.length; j++) positionals.push(argv[j]);
      break;
    }

    // Bare "-" (stdin convention) is a positional, never a flag.
    if (tok.startsWith("-") && tok !== "-") {
      // Split on the first "=" for the `--flag=value` escape hatch.
      const eq = tok.indexOf("=");
      const name = eq === -1 ? tok : tok.slice(0, eq);
      const inlineValue = eq === -1 ? null : tok.slice(eq + 1);

      const resolved = resolveFlag(name, spec);
      if (!resolved) {
        errors.push({ code: "unknown-flag", flag: name, detail: `unknown flag ${name}` });
        i++;
        continue;
      }
      const canonical = resolved.canonical;
      const decl = resolved.spec;

      seen[canonical] = (seen[canonical] || 0) + 1;
      if (seen[canonical] > 1 && !decl.repeatable) {
        errors.push({ code: "duplicate-flag", flag: canonical, detail: `flag ${canonical} given more than once` });
        // keep parsing to collect all errors + still record the value below
      }

      if (decl.arity === 0) {
        if (inlineValue !== null) {
          errors.push({ code: "bad-arity", flag: canonical, detail: `flag ${canonical} takes no value` });
        }
        values[canonical] = true;
        i++;
        continue;
      }

      // arity 1
      let value = inlineValue;
      if (value === null) {
        const next = argv[i + 1];
        // A `greedy` flag takes the next token even when it begins with "--" (its value is itself a
        // flag-string); the only missing-value case for it is no next token at all.
        const noValue = decl.greedy ? (next === undefined) : looksLikeNextFlag(next, spec);
        if (noValue) {
          errors.push({ code: "missing-value", flag: canonical, detail: `flag ${canonical} requires a value` });
          i++;
          continue;
        }
        value = next;
        i += 2;
      } else {
        i++;
      }

      if (Array.isArray(decl.enum) && !decl.enum.includes(value)) {
        errors.push({ code: "bad-enum", flag: canonical, detail: `${value} not in ${decl.enum.join("|")}` });
      }

      if (decl.repeatable) {
        if (!Array.isArray(values[canonical])) values[canonical] = [];
        values[canonical].push(value);
      } else {
        values[canonical] = value;
      }
      continue;
    }

    // Positional (including bare "-").
    positionals.push(tok);
    i++;
  }

  // Positional arity.
  const pos = spec.positionals;
  if (pos) {
    if (typeof pos.min === "number" && positionals.length < pos.min) {
      errors.push({ code: "too-few-positionals", detail: `expected at least ${pos.min} ${pos.name || "argument(s)"}, got ${positionals.length}` });
    }
    if (pos.max !== null && typeof pos.max === "number" && positionals.length > pos.max) {
      errors.push({ code: "too-many-positionals", detail: `expected at most ${pos.max} ${pos.name || "argument(s)"}, got ${positionals.length}` });
    }
  } else if (positionals.length > 0) {
    errors.push({ code: "too-many-positionals", detail: `unexpected argument(s): ${positionals.join(" ")}` });
  }

  return { values, positionals, errors };
}

function formatError(e) {
  if (e.flag) return `${e.code}: ${e.detail}`;
  return `${e.code}: ${e.detail}`;
}

/**
 * Emit the accumulated parse errors + the command's usage line to stderr and return 2.
 * The single exit path handlers call on a non-empty `errors` list.
 *
 * @param {object[]} errors  ParseError[]
 * @param {string}   usage   the command's usage line
 * @returns {number} 2
 */
function usageError(errors, usage) {
  for (const e of errors || []) process.stderr.write(`faff: ${formatError(e)}\n`);
  if (usage) process.stderr.write(`${usage.endsWith("\n") ? usage : usage + "\n"}`);
  return 2;
}

// ---------------------------------------------------------------------------
// Selftest table — exercises parseArgs across every code path (no process spawn).
// Surfaced both as a `faff argv --selftest`-style helper and mirrored by test/argv.test.mjs.
// ---------------------------------------------------------------------------
function argvSelftestCases() {
  const S = (flags, positionals) => ({ flags, positionals });
  return [
    // [name, argv, spec, expect{ codes:[...], values?, positionals?, ok?:bool }]
    ["unknown-flag rejected",
      ["--status", "done", "--bogus-flag-xyz"],
      S({ "--status": { arity: 1 }, "--spec": { arity: 1 } }),
      { codes: ["unknown-flag"] }],
    ["missing-value: value-flag followed by another flag",
      ["--run-dir", "--json", "--level", "L3"],
      S({ "--run-dir": { arity: 1 }, "--json": { arity: 0 }, "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } }),
      { codes: ["missing-value"] }],
    ["missing-value: value-flag at end of args",
      ["--run-dir"],
      S({ "--run-dir": { arity: 1 } }),
      { codes: ["missing-value"] }],
    ["bad-enum names the accepted set",
      ["--level", "L9"],
      S({ "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } }),
      { codes: ["bad-enum"] }],
    ["duplicate non-repeatable flag rejected",
      ["--run-dir", "a", "--run-dir", "b"],
      S({ "--run-dir": { arity: 1 } }),
      { codes: ["duplicate-flag"] }],
    ["repeatable flag collects a list",
      ["--label", "a", "--label", "b", "--label", "c"],
      S({ "--label": { arity: 1, repeatable: true } }),
      { ok: true, values: { "--label": ["a", "b", "c"] } }],
    ["=-form value accepted",
      ["--run-dir=/tmp/x", "--json"],
      S({ "--run-dir": { arity: 1 }, "--json": { arity: 0 } }),
      { ok: true, values: { "--run-dir": "/tmp/x", "--json": true } }],
    ["=-form lets a value begin with --",
      ["--sig=--weird-value"],
      S({ "--sig": { arity: 1 } }),
      { ok: true, values: { "--sig": "--weird-value" } }],
    ["arity-0 flag given =value is bad-arity",
      ["--json=x"],
      S({ "--json": { arity: 0 } }),
      { codes: ["bad-arity"] }],
    ["-- sentinel: rest are positional",
      ["--", "--not-a-flag", "-x"],
      { flags: {}, positionals: { min: 0, max: null, name: "rest" } },
      { ok: true, positionals: ["--not-a-flag", "-x"] }],
    ["bare - is a positional, not a flag",
      ["-"],
      { flags: {}, positionals: { min: 1, max: 1, name: "stream" } },
      { ok: true, positionals: ["-"] }],
    ["alias resolves to canonical",
      ["-d", "opt-in"],
      S({ "--default": { arity: 1, aliases: ["-d"] } }),
      { ok: true, values: { "--default": "opt-in" } }],
    ["too-many-positionals when none declared",
      ["extra"],
      S({ "--json": { arity: 0 } }),
      { codes: ["too-many-positionals"] }],
    ["too-few-positionals under declared min",
      [],
      { flags: {}, positionals: { min: 1, max: 1, name: "key" } },
      { codes: ["too-few-positionals"] }],
    ["positional-taking command works (config get KEY)",
      ["get", "tracking.team_key"],
      { flags: { "--root": { arity: 1 } }, positionals: { min: 1, max: 2, name: "verb key" } },
      { ok: true, positionals: ["get", "tracking.team_key"] }],
    ["errors accumulate (not fail-fast)",
      ["--bogus1", "--level", "L9", "--bogus2"],
      S({ "--level": { arity: 1, enum: ["L1", "L2", "L3", "L4"] } }),
      { codes: ["unknown-flag", "bad-enum", "unknown-flag"] }],
    ["boolean flag present ⇒ true",
      ["--json"],
      S({ "--json": { arity: 0 } }),
      { ok: true, values: { "--json": true } }],
    ["value beginning with single - is accepted when not a declared flag",
      ["--now", "-5"],
      S({ "--now": { arity: 1 } }),
      { ok: true, values: { "--now": "-5" } }],
    ["greedy flag takes a --leading value (merge-args style)",
      ["--merge-args", "--squash --delete-branch", "--json"],
      S({ "--merge-args": { arity: 1, greedy: true }, "--json": { arity: 0 } }),
      { ok: true, values: { "--merge-args": "--squash --delete-branch", "--json": true } }],
    ["greedy flag with NO next token is still missing-value",
      ["--merge-args"],
      S({ "--merge-args": { arity: 1, greedy: true } }),
      { codes: ["missing-value"] }],
  ];
}

function runArgvSelftest() {
  const cases = argvSelftestCases();
  let pass = 0;
  const fails = [];
  for (const [name, argv, spec, expect] of cases) {
    const res = parseArgs(argv, spec);
    let ok = true;
    const gotCodes = res.errors.map((e) => e.code);
    if (expect.codes) {
      ok = JSON.stringify(gotCodes) === JSON.stringify(expect.codes);
    } else if (expect.ok) {
      ok = res.errors.length === 0;
    }
    if (ok && expect.values) {
      for (const k of Object.keys(expect.values)) {
        if (JSON.stringify(res.values[k]) !== JSON.stringify(expect.values[k])) ok = false;
      }
    }
    if (ok && expect.positionals) {
      if (JSON.stringify(res.positionals) !== JSON.stringify(expect.positionals)) ok = false;
    }
    if (ok) pass++;
    else fails.push({ name, gotCodes, values: res.values, positionals: res.positionals });
  }
  return { pass, total: cases.length, fails };
}

// `faff`-level parity: a thin `argv --selftest` entry (optional; the canonical harness is
// test/argv.test.mjs). Kept as an exported cmd so sibling `--selftest` parity holds.
function cmdArgv(args) {
  if (Array.isArray(args) && args.includes("--selftest")) {
    const r = runArgvSelftest();
    if (r.fails.length === 0) {
      process.stdout.write(`PASS  argv selftest: ${r.pass}/${r.total} cases\n`);
      return 0;
    }
    process.stderr.write(`FAIL  argv selftest: ${r.pass}/${r.total} — ${JSON.stringify(r.fails)}\n`);
    return 1;
  }
  process.stderr.write("faff argv: internal parser module; use --selftest\n");
  return 2;
}

module.exports = { parseArgs, usageError, resolveFlag, looksLikeNextFlag, argvSelftestCases, runArgvSelftest, cmdArgv };
