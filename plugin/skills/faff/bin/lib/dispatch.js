"use strict";
// ===========================================================================
// === region:factory — dispatch — FAFF-1197/1198: one dispatch: tree pairs model and effort per lane ===
// `faff dispatch resolve <lane>` is the only way a skill reads a lane's model and reasoning effort.
// Each field resolves on its own down `dispatch.*`: the most specific non-empty value wins, else
// `inherit` (omit the parameter). The build lane walks by_tier / by_confidence; every other lane
// reads its own node. The dispatch-tree validator and the legacy-tree guard live in config.js.
// Engine capability checks (graded-effort family, reasoning_off, clamp) stay in
// resolveEngineForLane: this verb reports the configured effort and never second-guesses it.
// Requires config.js (factory), legal under ADR-0042 (factory -> factory).
// ===========================================================================

const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const {
  DISPATCH_LANES, EFFORT_GRADED_FAMILIES, loadConfig, legacyTreeGuard, pickDispatchField, prepareDispatch,
  reasoningEffortForTransport, resolveBuildModel, validateEngineRef,
} = require("./config");

const DISPATCH_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--tier": { arity: 1 }, "--confidence": { arity: 1 }, "--root": { arity: 1 } },
  positionals: { min: 0, max: 2, name: "verb lane" },
};
const DISPATCH_USAGE = "usage: faff dispatch resolve <lane> [--tier <tier>] [--confidence <conf>] [--root DIR]";

function isEmpty(v) {
  return v === null || v === undefined || v === "";
}

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// resolveBuildEffort(dispatch, tier) -> level; by_tier.default is consulted even when no tier is given.
function resolveBuildEffort(dispatch, tier) {
  const build = isMap(dispatch.build) ? dispatch.build : {};
  return pickDispatchField(build.by_tier, tier, "effort")
    ?? pickDispatchField(build.by_tier, "default", "effort")
    ?? (isEmpty(build.effort) ? "inherit" : String(build.effort).trim());
}

// resolveDispatch(cfg, lane, { tier, confidence }) -> { model, effort } | { error }
function resolveDispatch(cfg, lane, { tier = null, confidence = null } = {}) {
  if (lane === "eval") return { error: "eval is not a dispatch lane (use eval.model / eval.effort)" };
  if (!DISPATCH_LANES.includes(lane)) return { error: `${lane} is not a dispatch lane; legal: ${DISPATCH_LANES.join(" | ")}` };
  if ((tier !== null || confidence !== null) && lane !== "build") {
    return { usage: true, error: `--tier and --confidence apply only to the build lane, not ${lane}` };
  }
  const prepared = prepareDispatch(cfg);
  if (prepared.error) return { error: prepared.error };
  const dispatch = prepared.dispatch;

  if (lane === "build") {
    return { model: resolveBuildModel(dispatch, tier, confidence), effort: resolveBuildEffort(dispatch, tier) };
  }

  const node = isMap(dispatch[lane]) ? dispatch[lane] : {};
  const model = isEmpty(node.model) ? "inherit" : String(node.model).trim();
  const effort = isEmpty(node.effort) ? "inherit" : String(node.effort).trim();
  if (/^engine:/.test(model)) {
    const refErr = validateEngineRef(cfg, model);
    if (refErr) return { error: `dispatch.${lane}.model: ${refErr}` };
  }
  return { model, effort };
}

// `faff dispatch resolve <lane> [--tier T] [--confidence C]` — print {"model":..,"effort":..}.
// Exit 0 resolved / 2 usage, unknown lane or any invalid value in the dispatch tree or lane chain.
function cmdDispatch(args) {
  if (args.includes("--selftest")) return dispatchSelftest();
  const { values, positionals, errors } = parseArgs(args, DISPATCH_SPEC);
  if (errors.length) return usageError(errors, DISPATCH_USAGE);
  const [sub, lane] = positionals;
  if (sub !== "resolve" || !lane) {
    process.stderr.write(DISPATCH_USAGE + "\n");
    return 2;
  }
  const root = values["--root"] || findRoot();
  const legacy = legacyTreeGuard(root);
  if (legacy) {
    process.stderr.write(`faff dispatch resolve: ${legacy}\n`);
    return 2;
  }
  const [cfg] = loadConfig(root);
  const res = resolveDispatch(cfg, lane, { tier: values["--tier"] || null, confidence: values["--confidence"] || null });
  if (res.error) {
    process.stderr.write(`faff dispatch resolve: ${res.error}\n`);
    return 2;
  }
  console.log(JSON.stringify({ model: res.model, effort: res.effort }));
  return 0;
}

function dispatchSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  const pair = (cfg, lane, opts) => { const r = resolveDispatch(cfg, lane, opts); return r.error ? `error: ${r.error}` : `${r.model}/${r.effort}`; };
  const build = (node, tier, confidence) => pair({ dispatch: { build: node } }, "build", { tier, confidence });

  ok("no dispatch key resolves every lane to inherit/inherit", DISPATCH_LANES.every((l) => pair({}, l) === "inherit/inherit"));
  for (const lane of DISPATCH_LANES) {
    ok(`${lane}: dispatch effort is settable`, pair({ dispatch: { [lane]: { effort: "low" } } }, lane) === "inherit/low");
    ok(`${lane}: dispatch model is settable`, pair({ dispatch: { [lane]: { model: "haiku" } } }, lane) === "haiku/inherit");
  }
  ok("field independence: effort-only node leaves model at inherit", pair({ dispatch: { spec: { effort: "high" } } }, "spec") === "inherit/high");

  // build model chain: by_tier.<t> -> by_tier.default -> by_confidence.<c> -> by_confidence.default -> scalar -> inherit
  const layered = {
    model: "opus",
    by_tier: { mechanical: { model: "haiku" }, default: { model: "fable" } },
    by_confidence: { default: { model: "opus" }, high: { model: "sonnet" } },
  };
  ok("tier leaf outranks the confidence matcher", build(layered, "mechanical", "high") === "haiku/inherit");
  ok("tier with no leaf takes by_tier.default", build(layered, "standard", "high") === "fable/inherit");
  ok("tier absent skips by_tier for model, uses by_confidence", build(layered, null, "high") === "sonnet/inherit");
  ok("confidence absent or unknown uses by_confidence.default", build(layered, null, null) === "opus/inherit" && build(layered, null, "zzz") === "opus/inherit");
  ok("case-insensitive bucket keys", build({ by_confidence: { High: { model: "sonnet" } } }, null, "high") === "sonnet/inherit");
  ok("no matcher match falls to the scalar, then inherit", build({ model: "fable", by_confidence: { high: { model: "sonnet" } } }, null, "medium") === "fable/inherit" && build({}, "mechanical", "high") === "inherit/inherit");
  ok("a low leaf resolves (inert but valid)", build({ by_confidence: { low: { model: "haiku" } } }, null, "low") === "haiku/inherit");

  // build effort chain: by_tier.<t> -> by_tier.default -> scalar -> inherit
  const efforts = { effort: "medium", by_tier: { mechanical: { effort: "low" }, complex: { effort: "high" } } };
  ok("effort by tier leaf", build(efforts, "mechanical", null) === "inherit/low" && build(efforts, "complex", null) === "inherit/high");
  ok("effort with no leaf falls to the scalar", build(efforts, "standard", null) === "inherit/medium");
  ok("tier absent still uses by_tier.default for effort", build({ effort: "low", by_tier: { default: { effort: "high" } } }, null, null) === "inherit/high");
  ok("a by_tier node with only effort lets model fall through", build({ model: "sonnet", by_tier: { complex: { effort: "high" } } }, "complex", null) === "sonnet/high");

  ok("--tier on a non-build lane is refused", !!resolveDispatch({}, "spec", { tier: "complex" }).usage);
  ok("--confidence on a non-build lane is refused", !!resolveDispatch({}, "adr", { confidence: "high" }).usage);
  ok("eval is not a dispatch lane", /eval is not a dispatch lane/.test(resolveDispatch({}, "eval").error));
  ok("unknown lane is refused", !!resolveDispatch({}, "bogus").error);
  ok("off-vocabulary model token fails loud", !!resolveDispatch({ dispatch: { spec: { model: "gpt-5" } } }, "spec").error);
  ok("off-vocabulary effort token fails loud", !!resolveDispatch({ dispatch: { spec: { effort: "turbo" } } }, "spec").error);
  ok("an invalid leaf anywhere in the build tree fails loud", build({ by_tier: { complex: { model: "gpt-5" } } }, "mechanical", null).startsWith("error"));
  ok("typo'd lane anywhere in the tree fails every resolve", !!resolveDispatch({ dispatch: { biuld: { model: "opus" } } }, "spec").error);
  ok("effort by confidence fails loud (ADR-0108)", /ADR-0108/.test(resolveDispatch({ dispatch: { build: { by_confidence: { high: { effort: "low" } } } } }, "build").error));
  ok("inline map fails loud with block-form advice", /block form/.test(resolveDispatch({ dispatch: { spec: "{ effort: low }" } }, "spec").error));
  ok("engine value on a non-allowlisted lane fails loud", !!resolveDispatch({ dispatch: { spec: { model: "engine:studio" } } }, "spec").error);
  ok("dangling engine reference fails loud", !!resolveDispatch({ dispatch: { methodology: { model: "engine:nope" } } }, "methodology").error);
  ok("a legacy models: or effort: tree fails loud, naming both unset commands",
    /faff config unset models/.test(resolveDispatch({ models: { spec: "opus" } }, "spec").error)
    && /faff config unset effort/.test(resolveDispatch({ effort: null }, "spec").error));

  ok("reasoningEffortForTransport: low/medium/high pass through", ["low", "medium", "high"].every((l) => reasoningEffortForTransport(l) === l));
  ok("reasoningEffortForTransport: xhigh/max clamp to high", reasoningEffortForTransport("xhigh") === "high" && reasoningEffortForTransport("max") === "high");
  ok("EFFORT_GRADED_FAMILIES: openai + codex graded, ollama not", EFFORT_GRADED_FAMILIES.has("openai") && EFFORT_GRADED_FAMILIES.has("codex") && !EFFORT_GRADED_FAMILIES.has("ollama"));

  const cfg = { dispatch: { build: { by_tier: { complex: { model: "haiku", effort: "high" } } } } };
  const snapshot = JSON.stringify(cfg);
  const first = pair(cfg, "build", { tier: "complex" });
  ok("resolving never mutates the loaded config", JSON.stringify(cfg) === snapshot && first === pair(cfg, "build", { tier: "complex" }) && first === "haiku/high");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (dispatch resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { DISPATCH_SPEC, cmdDispatch, dispatchSelftest, resolveBuildEffort, resolveDispatch };
