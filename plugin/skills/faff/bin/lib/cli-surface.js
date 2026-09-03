// ===========================================================================
// === region:factory — cli-surface — FAFF-628: the declared, machine-readable CLI grammar. ===
//
// A per-verb declaration of the second-token dispatch surface — dispatch kind, subcommand
// set, accepted flags, and per-subcommand unconditional required flags — assembled from the
// SAME exports each dispatch module already uses to gate/parse (never a re-listing). The
// FAFF-538 scaffolder drift-guard imports SURFACES from here for its flag-layer assertions
// instead of spawning a bare `faff <verb>` usage-string probe.
//
// Load-bearing model: `assembleSurfaces`/`cmdCliSurface` take `COMMANDS` as a PARAMETER
// (mirroring `cmdLintCliDoc(args, COMMANDS)` / `cmdRegions(args, COMMANDS)` in ../faff) rather
// than importing it — `../faff` requires every lib/*.js eagerly before COMMANDS exists, so a
// top-level `require("../faff")` here would see an incomplete module.exports (a require
// cycle). Importing each dispatch module's own `<VERB>_SURFACE` export directly sidesteps that.
// ===========================================================================

"use strict";

const { parseArgs, usageError } = require("./argv");

const { ADR_SURFACE } = require("./adr");
const { ANDON_SURFACE } = require("./andon");
const { COMMISSAIRE_SURFACE } = require("./commissaire");
const { CONFIG_SURFACE } = require("./config");
const { CORRECTIVE_SURFACE } = require("./corrective");
const { DOD_SURFACE, HOLDOUT_SURFACE } = require("./admissibility");
const { EFFECTS_SURFACE } = require("./effects");
const { ENV_SURFACE } = require("./env");
const { EVENTS_SURFACE } = require("./events");
const { FIXTURES_SURFACE } = require("./fixtures");
const { GATES_SURFACE } = require("./gates");
const { PRDR_SURFACE } = require("./prdr");
const { PRD_SURFACE } = require("./prd");
const { PROFILES_SURFACE } = require("./governance-profile");
const { PROFILE_SURFACE } = require("./profile");
const { RUN_LEDGER_SURFACE } = require("./run-ledger");
const { SCENARIO_MATRIX_SURFACE } = require("./scenario-matrix");
const { SENTRY_POLLER_SURFACE } = require("./sentry-poller");
const { SENTRY_SURFACE } = require("./sentry");

// verb → its module's declared VerbSurface. The COMMANDS key IS the verb — e.g. the
// `profiles` COMMANDS entry maps to governance-profile.js's PROFILES_SURFACE.
const DISPATCH_SURFACES = {
  adr: ADR_SURFACE,
  andon: ANDON_SURFACE,
  commissaire: COMMISSAIRE_SURFACE,
  config: CONFIG_SURFACE,
  corrective: CORRECTIVE_SURFACE,
  dod: DOD_SURFACE,
  holdout: HOLDOUT_SURFACE,
  effects: EFFECTS_SURFACE,
  env: ENV_SURFACE,
  events: EVENTS_SURFACE,
  fixtures: FIXTURES_SURFACE,
  gates: GATES_SURFACE,
  prdr: PRDR_SURFACE,
  prd: PRD_SURFACE,
  profiles: PROFILES_SURFACE,
  profile: PROFILE_SURFACE,
  "run-ledger": RUN_LEDGER_SURFACE,
  "scenario-matrix": SCENARIO_MATRIX_SURFACE,
  "sentry-poller": SENTRY_POLLER_SURFACE,
  sentry: SENTRY_SURFACE,
};

// Verbs whose bare invocation is pinned `positional` (a documented second-token vocabulary
// with no live dispatch surface to declare — the FAFF-538 self-test's classification floor).
// Every other COMMANDS key not in DISPATCH_SURFACES gets a `flat` default (no second-token
// vocabulary at all, e.g. `heartbeat`, `doctor`).
const POSITIONAL_VERBS = new Set(["audit", "next", "state"]);

// Assemble the full SURFACES map — one entry per COMMANDS key, in bijection by construction
// (every key gets an entry; extras never appear since we only iterate COMMANDS' own keys).
function assembleSurfaces(COMMANDS) {
  const out = {};
  for (const verb of Object.keys(COMMANDS || {})) {
    if (Object.prototype.hasOwnProperty.call(DISPATCH_SURFACES, verb)) {
      out[verb] = DISPATCH_SURFACES[verb];
    } else {
      out[verb] = { kind: POSITIONAL_VERBS.has(verb) ? "positional" : "flat", subcommands: {}, spec: null };
    }
  }
  return out;
}

// The accepted-flag set for a VerbSurface — canonical names + aliases, unioned across every
// CommandSpec the verb declares (spec may be null | CommandSpec | CommandSpec[]). Returns
// null when the verb has no declared spec at all (an UNKNOWN accepted set, never an empty one
// — callers must skip flag-membership assertions on null, not treat it as "accepts nothing").
function acceptedFlags(surface) {
  const specs = Array.isArray(surface.spec) ? surface.spec : (surface.spec ? [surface.spec] : []);
  if (specs.length === 0) return null;
  const set = new Set();
  for (const sp of specs) {
    for (const [canonical, decl] of Object.entries((sp && sp.flags) || {})) {
      set.add(canonical);
      for (const alias of (decl && decl.aliases) || []) set.add(alias);
    }
  }
  return set;
}

// Pure: SURFACES -> the emitted JSON shape (a superset of the ticket's named shape — also
// carries `kind` and `flags`). `flags: null` signals "accepted set unknown" (see acceptedFlags).
function buildCliSurface(SURFACES) {
  const out = {};
  for (const [verb, surface] of Object.entries(SURFACES)) {
    const accepted = acceptedFlags(surface);
    const required_flags = {};
    for (const [sub, sc] of Object.entries(surface.subcommands || {})) {
      required_flags[sub] = Array.isArray(sc.required_flags) ? sc.required_flags.slice().sort() : [];
    }
    out[verb] = {
      kind: surface.kind,
      subcommands: Object.keys(surface.subcommands || {}).sort(),
      flags: accepted ? [...accepted].sort() : null,
      required_flags,
    };
  }
  return out;
}

// The pinned classifications the FAFF-538 self-test carried, re-pinned here as the
// `cli-surface --selftest`'s own floor (a real member from each dispatch verb's live
// vocabulary, plus the three pinned positional verbs).
const PINNED_CLASSIFICATIONS = [
  ["prd", "subcommand_dispatch", "new"],
  ["prdr", "subcommand_dispatch", "coverage"],
  ["adr", "subcommand_dispatch", "new"],
  ["env", "subcommand_dispatch", "up"],
  ["config", "subcommand_dispatch", "get"],
  ["profile", "subcommand_dispatch", "show"],
  ["holdout", "subcommand_dispatch", "verdicts"],
  ["audit", "positional", null],
  ["next", "positional", null],
  ["state", "positional", null],
];

// Selftest core: (a) SURFACES is in bijection with COMMANDS, (b) the pinned classifications
// hold, (c) every declared required_flags name is a member of its own verb's accepted-flag
// set (never assert requiredness the CLI itself does not accept). Returns problem strings —
// empty means clean.
function cliSurfaceSelftest(SURFACES, COMMANDS) {
  const problems = [];
  const surfaceKeys = Object.keys(SURFACES).sort();
  const commandKeys = Object.keys(COMMANDS || {}).sort();
  if (JSON.stringify(surfaceKeys) !== JSON.stringify(commandKeys)) {
    const missing = commandKeys.filter((k) => !Object.prototype.hasOwnProperty.call(SURFACES, k));
    const extra = surfaceKeys.filter((k) => !Object.prototype.hasOwnProperty.call(COMMANDS, k));
    problems.push(`SURFACES is not in bijection with COMMANDS — missing: {${missing.join(",")}} extra: {${extra.join(",")}}`);
  }
  for (const [verb, kind, member] of PINNED_CLASSIFICATIONS) {
    const s = SURFACES[verb];
    if (!s) { problems.push(`${verb}: no SURFACES entry`); continue; }
    if (s.kind !== kind) problems.push(`${verb}: expected kind '${kind}', got '${s.kind}'`);
    if (member !== null && !Object.prototype.hasOwnProperty.call(s.subcommands || {}, member)) {
      problems.push(`${verb}: expected declared subcommand '${member}', got {${Object.keys(s.subcommands || {}).sort().join(",")}}`);
    }
  }
  let nullSpecCount = 0;
  for (const [verb, surface] of Object.entries(SURFACES)) {
    const accepted = acceptedFlags(surface);
    if (accepted === null) { nullSpecCount++; continue; }
    for (const [sub, sc] of Object.entries(surface.subcommands || {})) {
      for (const flag of sc.required_flags || []) {
        if (!accepted.has(flag)) problems.push(`${verb} ${sub}: required flag ${flag} is not in ${verb}'s own accepted-flag set`);
      }
    }
  }
  return { problems, nullSpecCount };
}

const CLI_SURFACE_SPEC = { flags: { "--json": { arity: 0 }, "--selftest": { arity: 0 } } };

// faff cli-surface --json | --selftest — takes COMMANDS as a parameter (see the module
// header) exactly like cmdLintCliDoc/cmdRegions; wired in ../faff as
// `"cli-surface": (args) => cmdCliSurface(args, COMMANDS)`.
function cmdCliSurface(args, COMMANDS) {
  const parsed = parseArgs(args, CLI_SURFACE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, "usage: faff cli-surface --json | --selftest");
  const SURFACES = assembleSurfaces(COMMANDS);
  if (parsed.values["--selftest"]) {
    const { problems, nullSpecCount } = cliSurfaceSelftest(SURFACES, COMMANDS);
    if (problems.length) { for (const p of problems) process.stderr.write(`FAIL  ${p}\n`); return 1; }
    console.log(`PASS  cli-surface selftest: ${Object.keys(SURFACES).length} verbs, ${nullSpecCount} with no declared spec`);
    return 0;
  }
  if (parsed.values["--json"]) {
    console.log(JSON.stringify(buildCliSurface(SURFACES)));
    return 0;
  }
  process.stderr.write("usage: faff cli-surface --json | --selftest\n");
  return 2;
}

module.exports = {
  DISPATCH_SURFACES, POSITIONAL_VERBS, PINNED_CLASSIFICATIONS,
  assembleSurfaces, acceptedFlags, buildCliSurface, cliSurfaceSelftest, cmdCliSurface,
};
