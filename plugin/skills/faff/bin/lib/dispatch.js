"use strict";
// ===========================================================================
// === region:factory — dispatch — FAFF-1197: one dispatch: tree pairs model and effort per lane ===
// `faff dispatch resolve <lane>` returns the model and reasoning effort for one subagent-dispatched
// lane. Each field resolves on its own: a non-empty `dispatch:` value wins at its position, else
// the matching `models:` / `effort:` value applies, else `inherit` (omit the parameter). The
// overlay and the dispatch-tree validator live in config.js (effort.js requires config.js, so a
// module that config.js required would be a cycle); this module owns the verb.
// Engine capability checks (graded-effort family, reasoning_off, clamp) stay in
// resolveEngineForLane: this verb reports the configured effort and never second-guesses it.
// Requires config.js and effort.js (both factory), legal under ADR-0042 (factory -> factory).
// ===========================================================================

const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");
const {
  DEFAULTS, DISPATCH_LANES, EFFORT_LANE_VOCAB, effectiveView, laneSourceKey, loadConfig,
  resolveBuildModelForIssue, validateEngineRef, validateModelLane,
} = require("./config");
const { resolveBuildEffort } = require("./effort");

const DISPATCH_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--tier": { arity: 1 }, "--confidence": { arity: 1 }, "--root": { arity: 1 } },
  positionals: { min: 0, max: 2, name: "verb lane" },
};
const DISPATCH_USAGE = "usage: faff dispatch resolve <lane> [--tier <tier>] [--confidence <conf>] [--root DIR]";

function isEmpty(v) {
  return v === null || v === undefined || v === "";
}

// resolveDispatch(cfg, lane, { tier, confidence }) -> { model, effort } | { error }
function resolveDispatch(cfg, lane, { tier = null, confidence = null } = {}) {
  if (lane === "eval") return { error: "eval is not a dispatch lane (use eval.model / eval.effort)" };
  if (!DISPATCH_LANES.includes(lane)) return { error: `${lane} is not a dispatch lane; legal: ${DISPATCH_LANES.join(" | ")}` };
  if ((tier !== null || confidence !== null) && lane !== "build") {
    return { usage: true, error: `--tier and --confidence apply only to the build lane, not ${lane}` };
  }
  const overlaid = effectiveView(cfg);
  if (overlaid.error) return { error: overlaid.error };
  const view = overlaid.view;

  if (lane === "build") {
    const model = resolveBuildModelForIssue(view, tier, confidence);
    if (model.error) return { error: model.error };
    const effort = resolveBuildEffort(view, tier);
    if (effort.error) return { error: effort.error };
    return { model: model.token, effort: effort.level };
  }

  const modelKey = `models.${lane}`;
  const modelRaw = view.models && view.models[lane];
  const model = isEmpty(modelRaw) ? DEFAULTS[modelKey] : String(modelRaw).trim();
  const modelErr = validateModelLane(modelKey, model);
  if (modelErr) return { error: modelErr };
  if (/^engine:/.test(model)) {
    const refErr = validateEngineRef(cfg, model);
    if (refErr) return { error: `${laneSourceKey(cfg, lane, "model")}: ${refErr}` };
  }
  const effortRaw = view.effort && view.effort[lane];
  const effort = isEmpty(effortRaw) ? "inherit" : String(effortRaw).trim();
  if (!EFFORT_LANE_VOCAB["effort.build"].includes(effort)) {
    return { error: `${laneSourceKey(cfg, lane, "effort")}: invalid effort token "${effort}" — legal set: ${EFFORT_LANE_VOCAB["effort.build"].join(" | ")} (fail-loud, no silent inherit)` };
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

  ok("no dispatch key resolves every lane to inherit/inherit", DISPATCH_LANES.every((l) => pair({}, l) === "inherit/inherit"));
  ok("old-tree values pass through when dispatch is absent",
    pair({ models: { spec: "opus" }, effort: { methodology: "low" } }, "spec") === "opus/inherit"
    && pair({ models: { spec: "opus" }, effort: { methodology: "low" } }, "methodology") === "inherit/low");

  for (const lane of DISPATCH_LANES) {
    ok(`${lane}: dispatch effort is settable`, pair({ dispatch: { [lane]: { effort: "low" } } }, lane) === "inherit/low");
    ok(`${lane}: dispatch model is settable`, pair({ dispatch: { [lane]: { model: "haiku" } } }, lane) === "haiku/inherit");
  }

  const overlaid = { models: { spec: "opus" }, dispatch: { spec: { model: "sonnet" } } };
  ok("dispatch.<lane>.model wins over models.<lane>", pair(overlaid, "spec") === "sonnet/inherit");
  ok("field independence: effort-only node leaves model on the old tree",
    pair({ models: { spec: "opus" }, dispatch: { spec: { effort: "high" } } }, "spec") === "opus/high");

  const crossTree = { models: { build_by_tier: { complex: "opus" } }, dispatch: { build: { model: "sonnet" } } };
  ok("more specific old-tree position beats a less specific dispatch position", pair(crossTree, "build", { tier: "complex" }) === "opus/inherit");
  const onTop = { models: crossTree.models, dispatch: { build: { model: "sonnet", by_tier: { complex: { model: "haiku" } } } } };
  ok("dispatch matcher leaf wins at the same position", pair(onTop, "build", { tier: "complex" }) === "haiku/inherit");
  ok("tier absent: model skips by_tier entirely", pair(onTop, "build") === "sonnet/inherit");
  const effortByTier = { dispatch: { build: { by_tier: { default: { effort: "medium" } } } } };
  ok("tier absent: effort still uses by_tier.default", pair(effortByTier, "build") === "inherit/medium");
  ok("by_confidence resolves a model", pair({ dispatch: { build: { by_confidence: { medium: { model: "opus" } } } } }, "build", { confidence: "medium" }) === "opus/inherit");

  ok("--tier on a non-build lane is refused", !!resolveDispatch({}, "spec", { tier: "complex" }).usage);
  ok("--confidence on a non-build lane is refused", !!resolveDispatch({}, "adr", { confidence: "high" }).usage);
  ok("eval is not a dispatch lane", /eval is not a dispatch lane/.test(resolveDispatch({}, "eval").error));
  ok("unknown lane is refused", !!resolveDispatch({}, "bogus").error);
  ok("off-vocabulary model token fails loud", !!resolveDispatch({ dispatch: { spec: { model: "gpt-5" } } }, "spec").error);
  ok("off-vocabulary effort token fails loud", !!resolveDispatch({ dispatch: { spec: { effort: "turbo" } } }, "spec").error);
  ok("typo'd lane anywhere in the tree fails every resolve", !!resolveDispatch({ dispatch: { biuld: { model: "opus" } } }, "spec").error);
  ok("effort by confidence fails loud (ADR-0108)", /ADR-0108/.test(resolveDispatch({ dispatch: { build: { by_confidence: { high: { effort: "low" } } } } }, "build").error));
  ok("inline map fails loud with block-form advice", /block form/.test(resolveDispatch({ dispatch: { spec: "{ effort: low }" } }, "spec").error));
  ok("engine value on a non-allowlisted lane fails loud", !!resolveDispatch({ dispatch: { spec: { model: "engine:studio" } } }, "spec").error);
  ok("dispatch leaf over a scalar old-tree parent fails loud, naming the old key",
    /models\.build_by_tier/.test(resolveDispatch({ models: { build_by_tier: "opus" }, dispatch: { build: { by_tier: { complex: { model: "haiku" } } } } }, "build").error));
  ok("dangling engine reference fails loud", !!resolveDispatch({ dispatch: { methodology: { model: "engine:nope" } } }, "methodology").error);

  const cfg = { models: { build_by_tier: { complex: "opus" } }, effort: { build_by_tier: { complex: "low" } },
    dispatch: { build: { by_tier: { complex: { model: "haiku", effort: "high" } } } } };
  const snapshot = JSON.stringify(cfg);
  const first = pair(cfg, "build", { tier: "complex" });
  const second = pair(cfg, "build", { tier: "complex" });
  ok("the overlay never mutates the loaded config", JSON.stringify(cfg) === snapshot && first === second && first === "haiku/high");

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (dispatch resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { DISPATCH_SPEC, cmdDispatch, dispatchSelftest, resolveDispatch };
