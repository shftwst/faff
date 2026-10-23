// ===========================================================================
// === region:factory — config-dispatch — the dispatch: tree, engine refs, the removed models:/effort: trees, and the run banner ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const { mergeBackendsNamespace } = require("./backends");
const { findConfig, findOverlay, readBaseConfigStrict, parseOverlayStrict } = require("./shared-infra");
const { configFileLabel } = require("./config-core");


// FAFF-315: closed Agent-tool model vocabulary for every dispatch lane. A configured value outside
// the set fails LOUD at read (exit 2, names the value + legal set) — a misconfigured model must
// never silently fall back to the session default (the FAFF-50 dropped-slot failure mode).
// The eval model is not a lane here: it lives at eval.model (open vocabulary, validateEvalKey).
const AGENT_MODEL_TOKENS = ["inherit", "sonnet", "opus", "haiku", "fable"];

// ADR-0134: the `models:` and `effort:` trees are removed; `dispatch:` is the only place a lane's
// model or effort is set. Eval's keys moved earlier (ADR-0133) and keep their own message.
const EVAL_MOVED_KEYS = { "models.eval": "eval.model", "effort.eval": "eval.effort" };
const REMOVED_TREES = ["models", "effort"];
const REMOVED_KEY_FIELD = { models: "model", effort: "effort" };

// PURE: the `dispatch.` key a removed `models.*` / `effort.*` key maps to, or null for any other key.
function replacementKey(key) {
  if (Object.prototype.hasOwnProperty.call(EVAL_MOVED_KEYS, key)) return EVAL_MOVED_KEYS[key];
  const [tree, ...rest] = String(key).split(".");
  if (!REMOVED_TREES.includes(tree)) return null;
  const field = REMOVED_KEY_FIELD[tree];
  const [head, bucket] = rest;
  const lowered = bucket === undefined ? undefined : String(bucket).toLowerCase();
  if (rest.length === 1 && DISPATCH_LANES.includes(head)) return `dispatch.${head}.${field}`;
  if (rest.length === 2 && head === "build_by_tier") return `dispatch.build.by_tier.${lowered}.${field}`;
  if (rest.length === 2 && head === "build_by_confidence" && tree === "models") return `dispatch.build.by_confidence.${lowered}.model`;
  return `the dispatch: tree (dispatch.<lane>.model / dispatch.<lane>.effort)`;
}

// PURE: the exit-2 message for a read or write of a removed key, or null. Applies to `config get` and
// `config set` only, never to `config unset` (removing the tree is the fix).
function removedKeyError(key) {
  if (Object.prototype.hasOwnProperty.call(EVAL_MOVED_KEYS, key)) {
    return `config ${key}: moved to ${EVAL_MOVED_KEYS[key]} (eval is not a dispatch lane; ADR-0133)`;
  }
  const replacement = replacementKey(key);
  if (!replacement) return null;
  return `config ${key}: removed; set ${replacement} instead, then remove the old block with \`faff config unset ${key.split(".")[0]}\` (ADR-0134)`;
}

// Every dotted leaf under a legacy tree, as { removed, replacement } pairs.
function legacyLeafPairs(tree, node) {
  const pairs = [];
  const walk = (value, parts) => {
    if (isPlainMap(value)) { for (const [k, v] of Object.entries(value)) walk(v, [...parts, k]); return; }
    if (isUnset(value)) return;
    const removed = [tree, ...parts].join(".");
    pairs.push({ removed, replacement: replacementKey(removed) });
  };
  walk(node, []);
  return pairs;
}

// PURE: one sentence per (file, legacy tree) across the base and overlay layers, or null.
// layers: [{ file, local, doc }]. A bare or leafless header counts as a legacy tree.
function legacyTreeError(layers) {
  const sentences = [];
  for (const { file, local, doc } of layers) {
    if (!isPlainMap(doc)) continue;
    for (const tree of REMOVED_TREES) {
      if (!Object.prototype.hasOwnProperty.call(doc, tree)) continue;
      const pairs = legacyLeafPairs(tree, doc[tree]);
      const unset = `\`faff config unset ${tree}${local ? " --local" : ""}\``;
      const setClause = pairs.length
        ? `set ${pairs.map((p) => `${p.removed} -> ${p.replacement}`).join(", ")}, then run `
        : "run ";
      sentences.push(`${file} still holds the removed ${tree}: tree (ADR-0134); ${setClause}${unset}.`);
    }
  }
  return sentences.length ? sentences.join(" ") : null;
}

// PURE: backstop for in-process callers holding only the merged config.
function mergedLegacyTreeError(cfg) {
  const held = REMOVED_TREES.some((tree) => cfg && Object.prototype.hasOwnProperty.call(cfg, tree));
  return held
    ? `config still holds a removed ${REMOVED_TREES.join(": / ")}: tree (ADR-0134); run ${REMOVED_TREES.map((t) => `\`faff config unset ${t}\``).join(" and ")}`
    : null;
}

// PURE: the first step of every resolver. Refuses a legacy tree and an invalid dispatch: tree, then
// returns the dispatch: map the chains walk. Returns { dispatch } | { error }.
function prepareDispatch(cfg) {
  const error = mergedLegacyTreeError(cfg) || validateDispatchTree(cfg);
  if (error) return { error };
  return { dispatch: cfg && isPlainMap(cfg.dispatch) ? cfg.dispatch : {} };
}

// The base and overlay files as separate layers, the shape legacyTreeError reads.
function readConfigLayers(root) {
  const layers = [];
  const basePath = findConfig(root);
  if (basePath !== null) layers.push({ file: configFileLabel(root, basePath), local: false, doc: readBaseConfigStrict(basePath) });
  const overlayPath = findOverlay(root);
  if (overlayPath !== null) layers.push({ file: configFileLabel(root, overlayPath), local: true, doc: parseOverlayStrict(overlayPath) });
  return layers;
}

// Entry-point guard: the legacy-tree message naming the file and exact unset command, or null.
function legacyTreeGuard(root) {
  return legacyTreeError(readConfigLayers(root));
}
// eval.model is open-vocabulary (`claude -p` validates the id) but never an engine value;
// eval.effort takes the effort vocabulary.
const EVAL_KEYS = ["eval.model", "eval.effort"];
function validateEvalKey(key, value) {
  if (!/^eval\./.test(key)) return null;
  if (!EVAL_KEYS.includes(key)) return `config ${key}: unknown eval key; legal: ${EVAL_KEYS.join(" | ")}`;
  if (key === "eval.model" && /^engine:/.test(String(value))) {
    return "config eval.model: engine values are not legal here; eval runs `claude -p --model <id>`";
  }
  if (key === "eval.effort" && !EFFORT_LEVELS_WITH_INHERIT.includes(String(value))) {
    return `config eval.effort: invalid effort token "${value}"; legal set: ${EFFORT_LEVELS_WITH_INHERIT.join(" | ")}`;
  }
  return null;
}
const EFFORT_LEVELS_WITH_INHERIT = ["inherit", "low", "medium", "high", "xhigh", "max"];
// FAFF-422: local-engine lane values. The v1 allowlist is exactly the pure-data-in producer
// lanes (their SKILL.md + payload is self-sufficient — no tool use, no repo access), enforced
// at read (validateDispatchKey) AND at dispatch (`faff engine call --lane`). Engines live
// in a top-level name-keyed `engines:` map so one definition serves many lanes; the lane value
// stays a scalar (`engine:<name>`) so the closed-vocab machinery extends rather than forks.
const ENGINE_CALL_LANES = ["methodology", "intake"];
// Provider families reuse review-call.mjs's whitelist semantics: ollama has its own wire
// format; most of the rest ride the openai-compatible /v1 shape. `codex` is the first SPAWN
// family (FAFF-593): its transport is a `codex exec --json` child process, not an HTTP POST.
// `anthropic` is refused at resolution (Anthropic engines are what the Agent-token vocabulary
// is for — two spellings of the same dispatch with different transports would be a trap),
// and an unknown provider fails loud.
const ENGINE_PROVIDER_FAMILY = {
  ollama: "ollama",
  openai: "openai", vllm: "openai", openrouter: "openai", nvidia: "openai",
  deepseek: "openai", "openai-compatible": "openai", gemini: "openai",
  codex: "codex",
};

// FAFF-705: which transport FAMILIES carry a graded reasoning-effort control on the
// wire — the openai-compatible `reasoning_effort` request field and codex exec's
// `-c model_reasoning_effort`. `ollama` is NOT one (its transport carries only the
// on/off `think:false`, no graded dial). Capability is a property of the family, not
// a hand-set per-backend flag: it is DERIVED from the family string ENGINE_PROVIDER_FAMILY
// already assigns, so a lane's effort-tunability can never drift out of sync with its
// transport. This is the single source the `resolveEngineForLane` effort lift keys off.
const EFFORT_GRADED_FAMILIES = new Set(["openai", "codex"]);

// PURE (FAFF-705): map a faff effort level (five-level, `low|medium|high|xhigh|max`)
// onto the three-level transport target the graded-effort backends accept
// (`low|medium|high`). Above-ceiling levels CLAMP to `high` (the ticket sanctions
// "map to the nearest supported") rather than fragmenting the closed lane-uniform
// vocabulary per-engine. Never called with `inherit` — that path omits the effort arg
// entirely (resolveEngineForLane returns effort:null). Both encode sites (buildEngineRequest
// for the OpenAI HTTP path, buildCodexArgv for the codex spawn path) call this one helper.
function reasoningEffortForTransport(faffLevel) {
  switch (faffLevel) {
    case "low": return "low";
    case "medium": return "medium";
    case "high": return "high";
    case "xhigh": return "high";   // clamp to ceiling
    case "max": return "high";     // clamp to ceiling
    default: return "high";        // defensive: never reached (validateDispatchKey gates the vocab)
  }
}

// PURE: validate an `engine:<name>` value's reference against the shared
// `backends:` namespace (FAFF-523 — `engines:` folds into it at load, name
// collision is a hard error there) — the resolution-time half of the
// FAFF-422 fail-loud surface. Returns null | a named error.
function validateEngineRef(cfg, value) {
  const name = String(value).slice("engine:".length).trim();
  if (!name) return `engine value "${value}": missing engine name (expected engine:<name>)`;
  const merged = mergeBackendsNamespace(cfg);
  if (merged.error) return merged.error;
  const entry = merged.backends[name];
  if (!entry) {
    const configured = Object.keys(merged.backends);
    return `unknown engine "${name}" — configured engines: ${configured.length ? configured.join(", ") : "(none — add a top-level engines: or backends: block)"}`;
  }
  // Required fields are provider-conditional (FAFF-593): the HTTP families need a host;
  // the codex spawn family has no host by construction — it spawns a binary instead.
  const missing = (field) => {
    const v = entry[field];
    return v === null || v === undefined || v === "";
  };
  if (missing("provider")) return `engines.${name}: missing required field "provider" (an engine needs provider, model, host)`;
  const provider = String(entry.provider).toLowerCase();
  if (provider === "anthropic") {
    return `engines.${name}: provider "anthropic" is refused — Anthropic models are what the Agent-token vocabulary is for (set dispatch.<lane>.model to sonnet | opus | haiku | fable instead)`;
  }
  if (!ENGINE_PROVIDER_FAMILY[provider]) {
    return `engines.${name}: unknown provider "${entry.provider}" — legal providers: ${Object.keys(ENGINE_PROVIDER_FAMILY).join(" | ")}`;
  }
  const isCodex = ENGINE_PROVIDER_FAMILY[provider] === "codex";
  for (const field of isCodex ? ["model"] : ["model", "host"]) {
    if (missing(field)) {
      return isCodex
        ? `engines.${name}: missing required field "${field}" (a codex engine needs provider, model)`
        : `engines.${name}: missing required field "${field}" (an engine needs provider, model, host)`;
    }
  }
  if (isCodex) {
    if (!missing("host")) {
      return `engines.${name}: a codex engine has no host — it spawns the codex binary; set bin_path if the binary is not on PATH`;
    }
    if (entry.reasoning_off === true) {
      return `engines.${name}: reasoning_off is not supported on provider codex — no codex mapping exists; remove it`;
    }
    if (entry.auth === "none") {
      return `engines.${name}: auth "none" is refused on provider codex — codex always authenticates (subscription-seat via codex login, or api-key via api_key_env)`;
    }
  }
  return null;
}

// PURE: resolve an allowlisted lane to its configured engine for dispatch (`faff engine call`).
// Fail-loud at every step — allowlist, engine: shape, engines.<name> reference, and the
// effort×engine resolution (FAFF-705). Effort is no longer blanket-refused on engine lanes:
// a graded `dispatch.<lane>.effort` on a GRADED-effort family (openai | codex — EFFORT_GRADED_FAMILIES)
// is carried on the record and mapped onto the transport at dispatch; a graded effort on a
// non-graded family (ollama, no graded transport) OR a graded effort contradicting
// `reasoning_off: true` is refused with a capability-specific message (never silently dropped).
// Returns { name, provider, family, model, host, binPath, apiKeyEnv, auth, seatTokenEnv,
// reasoningOff, timeoutMs, effort } or { error }. `effort` is the resolved faff level
// (five-level, pre-map) or null when dispatch.<lane>.effort is inherit/unset. The codex family's record
// is host-less and carries binPath instead (FAFF-593 — spawn transport, not HTTP).
function resolveEngineForLane(cfg, lane) {
  if (!ENGINE_CALL_LANES.includes(lane)) {
    return { error: `lane "${lane}" is not engine-dispatchable — v1 allowlist: ${ENGINE_CALL_LANES.join(" | ")} (FAFF-422)` };
  }
  const prepared = prepareDispatch(cfg);
  if (prepared.error) return { error: prepared.error };
  const node = isPlainMap(prepared.dispatch[lane]) ? prepared.dispatch[lane] : {};
  const modelSource = `dispatch.${lane}.model`;
  const effortSource = `dispatch.${lane}.effort`;
  const value = isUnset(node.model) ? "inherit" : String(node.model).trim();
  if (!/^engine:/.test(value)) {
    return { error: `${modelSource} is "${value}", not an engine:<name> value — faff engine call serves only engine-valued lanes (an Anthropic token keeps the Agent-tool dispatch)` };
  }
  const refErr = validateEngineRef(cfg, value);
  if (refErr) return { error: `${modelSource}: ${refErr}` };
  // The effort level the operator requested for this lane (prepareDispatch already gated the token,
  // so this is a legal faff level or "inherit"). Its capability check is deferred to below: it needs
  // the resolved family + reasoning_off.
  const effort = isUnset(node.effort) ? "inherit" : String(node.effort).trim();
  const name = value.slice("engine:".length).trim();
  // validateEngineRef above already proved the merged backends:+engines: namespace has
  // this entry with provider/model/host, so this re-resolve is non-null today; guard it
  // anyway (parity with validateEngineRef) so a future change loosening that guarantee
  // fails loud, never with a bare TypeError. FAFF-523: resolves against the MERGED
  // namespace (engines: folds into backends: at load), so a backend declared only under
  // top-level `backends:` is equally reachable via engine:<name>.
  const merged = mergeBackendsNamespace(cfg);
  const entry = merged.backends && merged.backends[name];
  if (!entry) return { error: `${modelSource}: engines.${name} vanished after validation (concurrent config edit?)` };
  const provider = String(entry.provider).toLowerCase();
  const family = ENGINE_PROVIDER_FAMILY[provider];
  const reasoningOff = entry.reasoning_off === true;
  // FAFF-705: resolve the requested effort against the family's capability (replaces the
  // FAFF-422 blanket refusal). `inherit`/unset → effort:null, byte-for-byte the pre-existing
  // dispatch (no transport arg). A graded level on a non-graded family (ollama) or a graded
  // level contradicting reasoning_off is refused with a capability-specific message; a graded
  // level on a graded-effort family is carried on the record (mapped onto the transport at the
  // encode sites). validateEngineRef already refuses reasoning_off on codex, so the reasoning_off
  // contradiction below bites only on the openai family (where both knobs are individually legal).
  let resolvedEffort = null;
  if (effort !== "inherit") {
    if (!EFFORT_GRADED_FAMILIES.has(family)) {
      return { error: `${effortSource} is "${effort}" but engines.${name} (provider ${provider}, family ${family}) has no graded reasoning-effort transport — only reasoning_off (on/off). Set ${effortSource} to inherit and use engines.${name}.reasoning_off, or point the lane at a graded-effort engine (an openai-family or codex backend).` };
    }
    if (reasoningOff) {
      return { error: `${effortSource} is "${effort}" (graded) but engines.${name} sets reasoning_off: true — contradictory; a lane cannot both silence reasoning and request a graded effort. Drop one.` };
    }
    resolvedEffort = effort;
  }
  return {
    name, provider, family,
    model: String(entry.model),
    // codex is host-less by construction (validateEngineRef refused any present host);
    // it spawns bin_path instead — default "codex", PATH-resolved at spawn time.
    host: family === "codex" ? null : String(entry.host),
    binPath: family === "codex" ? ((entry.bin_path === null || entry.bin_path === undefined || entry.bin_path === "") ? "codex" : String(entry.bin_path)) : null,
    apiKeyEnv: (entry.api_key_env === null || entry.api_key_env === undefined || entry.api_key_env === "") ? null : String(entry.api_key_env),
    // FAFF-481: carry the resolved auth mode + optional headless seat handle so the
    // engine-call transport resolves a subscription-seat token (backends.js resolveTokenSource).
    auth: entry.auth,
    seatTokenEnv: (entry.seat_token_env === null || entry.seat_token_env === undefined || entry.seat_token_env === "") ? null : String(entry.seat_token_env),
    reasoningOff,
    timeoutMs: (entry.timeout !== null && entry.timeout !== undefined && entry.timeout !== "") ? Number(entry.timeout) * 1000 : 120000,
    // FAFF-877: the TOTAL operation budget the shared supervisor's lease uses — distinct
    // from `timeoutMs` above (the connection/request timeout, unchanged). Policy, per
    // consumer: `backends.<name>.operation_deadline_secs` overrides the human-decided
    // default (3600s, alec, 2026-08-22 — generous enough not to trip a legitimately long
    // local-model dispatch, well below the 14400s run_elapsed_ceiling_secs backstop).
    operationDeadlineSecs: (entry.operation_deadline_secs !== null && entry.operation_deadline_secs !== undefined && entry.operation_deadline_secs !== "") ? Number(entry.operation_deadline_secs) : 3600,
    // FAFF-705: the resolved faff effort level (five-level, pre-map) or null for inherit/unset.
    // The encode sites map it onto the transport (reasoningEffortForTransport); the codex
    // spend record stores this faff level so `economics --by effort` buckets it uniformly.
    effort: resolvedEffort,
  };
}

// FAFF-1197: one dispatch: tree pairs model and effort for every subagent-dispatched lane. The
// registry carries no dispatch.* defaults: an unset position falls through its chain to inherit.
const DISPATCH_LANES = ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "adr"];
const DISPATCH_TIERS = ["default", "mechanical", "standard", "complex"];
const DISPATCH_CONFIDENCES = ["default", "high", "medium", "low"];
const DISPATCH_FIELDS = ["model", "effort"];
const DISPATCH_MATCHER_PARENTS = { by_tier: DISPATCH_TIERS, by_confidence: DISPATCH_CONFIDENCES };

function isPlainMap(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isUnset(v) {
  return v === null || v === undefined || v === "";
}
function isInlineMap(v) {
  return typeof v === "string" && v.trim().startsWith("{");
}

function dispatchLaneError(key, lane) {
  if (lane === "eval") return `config ${key}: eval is not a dispatch lane (use eval.model / eval.effort)`;
  if (!DISPATCH_LANES.includes(lane)) return `config ${key}: unknown dispatch lane ${lane}; legal: ${DISPATCH_LANES.join(" | ")}`;
  return null;
}

// PURE: classify a path below dispatch.<lane>. Returns { kind: "node" | "leaf", field? } or { error }.
function classifyDispatchPath(lane, rest) {
  if (rest.length === 0) return { kind: "node" };
  const [head, bucket, field] = rest;
  if (rest.length === 1 && DISPATCH_FIELDS.includes(head)) return { kind: "leaf", field: head };
  if (lane === "build" && Object.prototype.hasOwnProperty.call(DISPATCH_MATCHER_PARENTS, head)) {
    const legal = DISPATCH_MATCHER_PARENTS[head];
    if (rest.length === 1) return { kind: "node" };
    if (!legal.includes(String(bucket).toLowerCase())) {
      return { error: `unknown ${head} key ${bucket}; legal: ${legal.join(" | ")}` };
    }
    if (rest.length === 2) return { kind: "node" };
    if (rest.length === 3 && DISPATCH_FIELDS.includes(field)) {
      if (head === "by_confidence" && field === "effort") {
        return { error: "no effort by confidence (ADR-0108); use dispatch.build.by_tier" };
      }
      return { kind: "leaf", field };
    }
  }
  return { error: `unknown dispatch field ${rest.join(".")}; legal: ${DISPATCH_FIELDS.join(" | ")} (+ by_tier, by_confidence on build)` };
}

// PURE: read/write validator for one dispatch.* key. Only scalar values are checked here (a map
// value is a node read; validateDispatchTree covers every leaf beneath it).
function validateDispatchKey(key, value) {
  if (!/^dispatch\./.test(key)) return null;
  if (isPlainMap(value)) return null;
  const [lane, ...rest] = key.slice("dispatch.".length).split(".");
  const laneErr = dispatchLaneError(key, lane);
  if (laneErr) return laneErr;
  const position = classifyDispatchPath(lane, rest);
  if (position.error) return `config ${key}: ${position.error}`;
  if (isInlineMap(value)) return `config ${key}: holds an inline map the config parser cannot read; use block form`;
  if (position.kind === "node") return `config ${key}: must be a block map of model / effort`;
  const token = String(value);
  if (position.field === "effort") {
    return EFFORT_LEVELS_WITH_INHERIT.includes(token) ? null
      : `config ${key}: invalid effort token "${token}" — legal set: ${EFFORT_LEVELS_WITH_INHERIT.join(" | ")} (fail-loud, no silent inherit)`;
  }
  if (/^engine:/.test(token)) {
    return rest.length === 1 && ENGINE_CALL_LANES.includes(lane) ? null
      : `config ${key}: engine values are only legal on ${ENGINE_CALL_LANES.map((l) => `dispatch.${l}.model`).join(" | ")} (FAFF-422 v1 allowlist)`;
  }
  return AGENT_MODEL_TOKENS.includes(token) ? null
    : `config ${key}: invalid model token "${token}" — legal set: ${AGENT_MODEL_TOKENS.join(" | ")} (fail-loud, no silent inherit)`;
}

// PURE: the finding for a map sitting at a dispatch position (null when a map is legal there).
function dispatchMapPositionError(key, parts) {
  const [lane, ...rest] = parts;
  const laneErr = dispatchLaneError(key, lane);
  if (laneErr) return laneErr;
  const position = classifyDispatchPath(lane, rest);
  if (position.error) return `config ${key}: ${position.error}`;
  return position.kind === "leaf" ? `config ${key}: must be a single value, not a map` : null;
}

// PURE: walk every position under cfg.dispatch. Returns the first finding or null.
function validateDispatchTree(cfg) {
  const tree = cfg ? cfg.dispatch : undefined;
  if (isUnset(tree)) return null;
  if (!isPlainMap(tree)) {
    return isInlineMap(tree)
      ? "dispatch holds an inline map the config parser cannot read; use block form"
      : "dispatch must be a block map of lanes";
  }
  const walk = (node, parts) => {
    for (const [name, value] of Object.entries(node)) {
      if (isUnset(value)) continue;
      const here = [...parts, name];
      const key = `dispatch.${here.join(".")}`;
      const finding = isPlainMap(value) ? dispatchMapPositionError(key, here) || walk(value, here) : validateDispatchKey(key, value);
      if (finding) return finding;
    }
    return null;
  };
  return walk(tree, []);
}

// FAFF-430: `git_host` is an ADVERTISED config knob with no behavioural consumer beyond this
// TRACKING_KEYS entry — the merge floor (merge-gate.js) is unconditionally `gh`, so a configured
// non-github host was silent config theater: branch/commit ops look fine, then the merge gate is
// silently GitHub-shaped. Mirrors validateDispatchKey's exact-match closed-vocab
// shape: a configured off-vocabulary value fails LOUD (config get exit 2, names value + legal
// set), never a silent limp. Unset stays fully valid — this validator is only ever called for a
// PRESENT tracking.git_host value (the call sites below all short-circuit on absence first).

// FAFF-1197: echo the raw dispatch: values, the only model and effort lines in the run banner.
// An effort on an Agent-dispatched lane is recorded in the run log, never applied (the Agent tool
// has no effort parameter), so its line says so; only an engine-valued lane applies it.
const EFFORT_NOT_APPLIED_NOTE = " (effort recorded, not applied: Agent tool)";

function printDispatchBanner(data, legacyError = null) {
  const invalid = legacyError || validateDispatchTree(data);
  if (invalid) console.log(`dispatch: INVALID — ${invalid} (every resolver exits 2 until fixed)`);
  const dispatch = isPlainMap(data.dispatch) ? data.dispatch : {};
  const lowered = (node) => {
    const out = {};
    if (isPlainMap(node)) for (const [k, v] of Object.entries(node)) out[String(k).trim().toLowerCase()] = v;
    return out;
  };
  const pairs = (node, fields) => fields
    .filter((f) => isPlainMap(node) && !isUnset(node[f]))
    .map((f) => `${f}=${node[f]}`)
    .join(" ");
  const echo = (label, node, fields, agentDispatched = true) => {
    const text = pairs(node, fields);
    const unapplied = agentDispatched && isPlainMap(node) && !isUnset(node.effort) && String(node.effort).trim() !== "inherit";
    if (text) console.log(`dispatch ${label}: ${text}${unapplied ? EFFORT_NOT_APPLIED_NOTE : ""}`);
  };
  for (const lane of DISPATCH_LANES) {
    const node = dispatch[lane];
    const onEngine = ENGINE_CALL_LANES.includes(lane) && isPlainMap(node) && /^engine:/.test(String(node.model));
    echo(lane, node, DISPATCH_FIELDS, !onEngine);
  }
  const build = isPlainMap(dispatch.build) ? dispatch.build : {};
  const byTier = lowered(build.by_tier);
  for (const t of DISPATCH_TIERS) echo(`build.by_tier.${t}`, byTier[t], DISPATCH_FIELDS);
  const byConfidence = lowered(build.by_confidence);
  for (const c of ["default", "high", "medium"]) echo(`build.by_confidence.${c}`, byConfidence[c], ["model"]);
}

// FAFF-334/417: per-issue build-model routing over dispatch.build. Each field resolves on its own,
// most specific position first, and an unset position falls through to the next:
//   model:  by_tier.<tier> -> by_tier.default (tier given only) -> by_confidence.<conf>
//           -> by_confidence.default -> dispatch.build.model -> "inherit"
// The tier matcher is skipped when no tier is given (never guesses a tier); an absent or unknown
// confidence routes to by_confidence.default. The caller validated the whole dispatch: tree.
function pickDispatchField(map, key, field) {
  if (!isPlainMap(map) || key === null || key === undefined) return null;
  const wanted = String(key).trim().toLowerCase();
  for (const [name, node] of Object.entries(map)) {
    if (String(name).trim().toLowerCase() === wanted && isPlainMap(node) && !isUnset(node[field])) return String(node[field]).trim();
  }
  return null;
}

// resolveBuildModel(dispatch, tier, conf) -> token
function resolveBuildModel(dispatch, tier, conf) {
  const build = isPlainMap(dispatch.build) ? dispatch.build : {};
  const fromTier = tier == null ? null
    : pickDispatchField(build.by_tier, tier, "model") ?? pickDispatchField(build.by_tier, "default", "model");
  const fromConfidence = () => pickDispatchField(build.by_confidence, conf, "model") ?? pickDispatchField(build.by_confidence, "default", "model");
  return fromTier ?? fromConfidence() ?? (isUnset(build.model) ? "inherit" : String(build.model).trim());
}


module.exports = { AGENT_MODEL_TOKENS, DISPATCH_LANES, EFFORT_GRADED_FAMILIES, EFFORT_LEVELS_WITH_INHERIT, ENGINE_CALL_LANES, ENGINE_PROVIDER_FAMILY, legacyTreeError, legacyTreeGuard, pickDispatchField, prepareDispatch, printDispatchBanner, reasoningEffortForTransport, REMOVED_TREES, removedKeyError, resolveBuildModel, resolveEngineForLane, validateDispatchKey, validateDispatchTree, validateEngineRef, validateEvalKey };
