"use strict";
// ===========================================================================
// === region:factory — effort — FAFF-417: per-issue build-effort routing (tier-keyed) ===
// `effort.build` (FAFF-416) is a single per-run scalar; this resolver keys the build
// EFFORT off an issue's retained `build-tier` (FAFF-417) via the OPTIONAL sibling matcher
// `effort.build_by_tier` (a `default` plus tier-keyed leaves), mirroring resolveBuildModel's
// fallback-chain shape (config.js) but simpler — there is no confidence precedent here.
// ADR-0050 pinned the per-issue effort matcher's *pattern* ("on the same pattern as
// models.build_by_confidence"), not its key; FAFF-411 has since shown spec confidence is a
// near-constant, so this matcher is keyed by TIER, not confidence — no effort.build_by_confidence
// key is ever minted. PURE — the tier is passed in, no tracker call.
// Requires config.js (both factory) for the shared vocab/validation/config-load machinery —
// legal under ADR-0042 (factory -> factory), same family as self-intake -> contain.
// ===========================================================================

const { parseArgs, usageError } = require("./argv");
const { dig, findRoot } = require("./shared-infra");
const { DEFAULTS, EFFORT_LANE_VOCAB, loadConfig, validateEffortLane } = require("./config");

const EFFORT_SPEC = { flags: { "--selftest": { arity: 0 }, "--tier": { arity: 1 }, "--root": { arity: 1 } }, positionals: { min: 0, max: 1, name: "verb" } };
const EFFORT_USAGE = "usage: faff effort build-for [--tier <tier>] [--root DIR]";

// resolveBuildEffort(cfg, tierVal) -> { level } | { error }
// FAFF-417 spec §4 PROCEDURE resolve build effort (tier?):
//   1. IF effort.build_by_tier configured AND tier present: build_by_tier.<tier> -> .default -> fall through
//      (tier ABSENT => skip the tier matcher entirely — never guess a tier)
//   2. effort.build (scalar, FAFF-416) -> "inherit"
// Every configured leaf validates up-front (mirrors resolveBuildModel) — an invalid token
// ANYWHERE in the matcher fails loud at the first resolution, never left dormant until its
// bucket happens to dispatch.
function resolveBuildEffort(cfg, tierVal) {
  const byTier = dig(cfg, "effort.build_by_tier");
  const rawMap = (byTier && typeof byTier === "object" && !Array.isArray(byTier)) ? byTier : null;
  const map = {};
  if (rawMap) for (const k of Object.keys(rawMap)) {
    const v = rawMap[k];
    if (v !== null && v !== undefined && v !== "") map[String(k).trim().toLowerCase()] = String(v).trim();
  }
  for (const k of Object.keys(map)) {
    if (validateEffortLane("effort.build_by_tier." + k, map[k])) {
      return { error: `faff effort build-for: invalid effort token "${map[k]}" in effort.build_by_tier.${k} — legal set: ${EFFORT_LANE_VOCAB["effort.build"].join(" | ")} (fail-loud, no silent inherit)` };
    }
  }

  const pick = (k) => (k != null && Object.prototype.hasOwnProperty.call(map, k)) ? map[k] : null;
  const key = tierVal != null ? String(tierVal).trim().toLowerCase() : null;
  let level = pick(key) ?? pick("default");
  if (level == null) {
    const scalar = dig(cfg, "effort.build");
    level = (scalar === null || scalar === undefined || scalar === "") ? DEFAULTS["effort.build"] : String(scalar).trim();
  }
  if (validateEffortLane("effort.build", level)) {
    return { error: `faff effort build-for: resolved level "${level}" is not a legal build effort — legal set: ${EFFORT_LANE_VOCAB["effort.build"].join(" | ")} (fail-loud, no silent inherit)` };
  }
  return { level };
}

// `faff effort build-for [--tier <tier>]` — print the per-issue build effort level (or
// "inherit", which the caller maps to "omit the reasoning-effort arg"). Pure; exit 0 level /
// 2 usage or invalid token.
function cmdEffort(args) {
  if (args.includes("--selftest")) return effortSelftest();
  const { values, positionals, errors } = parseArgs(args, EFFORT_SPEC);
  if (errors.length) return usageError(errors, EFFORT_USAGE);
  const sub = positionals[0];
  if (sub !== "build-for") {
    process.stderr.write(EFFORT_USAGE + "\n");
    return 2;
  }
  const root = values["--root"] || findRoot();
  const tierArg = values["--tier"] || null;
  const [cfg] = loadConfig(root);
  const res = resolveBuildEffort(cfg, tierArg);
  if (res.error) { process.stderr.write(res.error + "\n"); return 2; }
  console.log(res.level);
  return 0;
}

// Selftest — drives the pure resolver over the fallback chain + up-front leaf validation.
function effortSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  const full = { effort: { build: "medium", build_by_tier: { default: "medium", mechanical: "low", complex: "high" } } };
  ok("build-for mechanical -> matcher leaf low", resolveBuildEffort(full, "mechanical").level === "low");
  ok("build-for complex -> matcher leaf high", resolveBuildEffort(full, "complex").level === "high");
  ok("build-for standard (no leaf) -> default bucket (medium)", resolveBuildEffort(full, "standard").level === "medium");
  ok("build-for MECHANICAL (case-insensitive) -> low", resolveBuildEffort(full, "MECHANICAL").level === "low");
  ok("no tier -> default bucket (medium)", resolveBuildEffort(full, null).level === "medium");
  // fallback precedence: leaf absent -> default -> scalar -> inherit
  ok("no leaf, has default -> default", resolveBuildEffort({ effort: { build: "low", build_by_tier: { default: "high" } } }, "mechanical").level === "high");
  ok("no matcher, has scalar -> scalar (per-run FAFF-416 path)", resolveBuildEffort({ effort: { build: "low" } }, "mechanical").level === "low");
  ok("no matcher, no scalar -> inherit", resolveBuildEffort({ effort: {} }, "mechanical").level === "inherit");
  ok("empty cfg -> inherit", resolveBuildEffort({}, "mechanical").level === "inherit");
  // fail-loud — never a silent inherit
  ok("invalid matcher leaf token fails loud", !!resolveBuildEffort({ effort: { build_by_tier: { mechanical: "bogus" } } }, "mechanical").error);
  ok("invalid UNUSED leaf fails loud (validate anywhere, not just resolved)",
    !!resolveBuildEffort({ effort: { build_by_tier: { mechanical: "bogus", default: "low" } } }, "complex").error);
  ok("invalid scalar fallback fails loud", !!resolveBuildEffort({ effort: { build: "bogus" } }, null).error);
  ok("a model token in the matcher fails loud (distinct vocabularies)", !!resolveBuildEffort({ effort: { build_by_tier: { mechanical: "sonnet" } } }, "mechanical").error);

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (effort build-for resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { cmdEffort, effortSelftest, resolveBuildEffort };
