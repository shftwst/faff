// ===========================================================================
// === region:factory — config — resolve / read .faffrc (YAML subset, no deps) ===
// ===========================================================================
// FAFF-182: the single source of truth for config defaults, keyed by dotted config path.
// `config get <key>` applies these so no caller (skill prose) ever supplies a default via `-d` —
// a prose-supplied default can be forgotten/mistyped/shortcut (the slot-dispatch bug). Slots are
// entries here too (slots are just config-path keys). Computed defaults (spec-docs-path, eligible,
// next, worktree_root) keep their own resolvers — this registry is for simple-scalar + slot defaults.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
// FAFF-417: --tier/--confidence are the flag-form of the (still byte-for-byte) bare
// positional confidence — `faff models build-for <confidence>` keeps working unchanged.
const MODELS_SPEC = { flags: { "--selftest": { arity: 0 }, "--root": { arity: 1 }, "--tier": { arity: 1 }, "--confidence": { arity: 1 } }, positionals: { min: 0, max: 2, name: "verb confidence" } };
// Union across every `config` sub-verb (path|get|set|check|init and the docs-path resolvers). The gate
// rejects unknown flags / missing values; each sub-verb's own body reads the validated flags below.
const CONFIG_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--force": { arity: 0 }, "--dry-run": { arity: 0 }, "--create": { arity: 0 },
  "--root": { arity: 1 }, "--default": { arity: 1, aliases: ["-d"] }, "--set": { arity: 1, repeatable: true },
}, positionals: { min: 0, max: null, name: "verb key value" } };
// FAFF-628 — declared grammar. Every sub-verb reads its "required" argument as a positional
// (KEY for `get`, the file for `check`), never a `--flag` — so no unconditional required_flags
// is migrated here (see FAFF-628 spec §2 OUT OF SCOPE: this module has none to declare).
const CONFIG_SURFACE = {
  kind: "subcommand_dispatch",
  spec: CONFIG_SPEC,
  subcommands: {
    path: { required_flags: [] },
    check: { required_flags: [] },
    get: { required_flags: [] },
    defaults: { required_flags: [] },
    "spec-docs-path": { required_flags: [] },
    "prd-docs-path": { required_flags: [] },
    "prdr-docs-path": { required_flags: [] },
    "adr-docs-path": { required_flags: [] },
    "spike-docs-path": { required_flags: [] },
    dump: { required_flags: [] },
    init: { required_flags: [] },
    resolved: { required_flags: [] },
    set: { required_flags: [] },
  },
};
// FAFF-667: both usage strings (the flag-gate failure and the unknown/missing-subcommand
// message) derive their verb list from here, sorted, so they can never diverge from the
// dispatcher or from each other.
function configVerbList() {
  return Object.keys(CONFIG_SURFACE.subcommands).sort().join("|");
}
const { overlayHeartbeat, readHeartbeatFile } = require("./heartbeat");
const { runIsHeld } = require("./runcheck");
const { backendsConfigCheckFindings, mergeBackendsNamespace } = require("./backends");
const {
  CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, LEGACY_CONFIG, LEGACY_OVERLAY_CONFIG,
  deepMergeConfig, dig, findConfig, findOverlay, findRoot, isPlainConfigMap, parseConfigMapStrict, readBaseConfigStrict,
  parseOverlayStrict, parseYamlSubset, readLedger, scalar, stripInlineComment,
} = require("./shared-infra");

const DEFAULTS = {
  "slots.intake": "faffter-noon-intake",
  "slots.spec": "faffter-noon-spec",
  "slots.spec_review": "faffter-noon-spec-review",
  "slots.adr": "faffter-noon-adr",
  "slots.architecture": "faffter-noon-architecture",
  "slots.env": "faffter-noon-env-compose",
  "slots.evaluator": "faffter-noon-evaluate",
  "slots.review": "faffter-noon-review",
  "slots.ship": "faffter-noon-ship",
  "slots.concurrency": "faffter-noon-concurrency-sequential",
  "slots.methodology": "faffter-noon-methodology-thematic",
  "slots.routing_adaptor": "faffidavit-routing",
  "slots.rendering_adaptor": "faffidavit-rendering",
  // FAFF-191: the L4 PRD-admissibility slot — gap-filled (was documented in the gateway Slots
  // table and relied on by faff-beep-boop's prose parenthetical, but absent from the registry).
  "slots.prd": "faffter-noon-prd",
  // FAFF-817: evaluator→SUT reachability across the lane boundary, composed under `env`. Default
  // occupant covers the private-network reachability class (local docker-in-docker first slice).
  "slots.transport": "faffter-noon-transport-private-network",
  "logging": "full",
  "concurrency_max": "4",
  "automation_default": "opt-in",
  // FAFF-819 / FAFF-861: the Phase-0 recovery-bundle store. A top-level MODE ENUM, not a slot —
  // slots delegate to user-swappable Skills, whereas this names a BUILT-IN occupant bundle.js
  // dispatches on the string: "local" (default: nothing leaves the box) or "git-remote" (opt-in
  // off-box publish to a write-once orphan ref). No publish on/off flag — the occupant IS the control surface.
  "bundle_store": "local",
  // FAFF-758: the stale-claim TTL (hours). A claim (issue at `In Progress`) older than this
  // that faff can PROVE it set (the `faff-claimed` label) is auto-reclaimed to Todo by tidy;
  // anything else is surfaced, never touched. The default MUST exceed the longest legitimate
  // build — no build progress is visible across hosts during a long run, so a too-tight TTL
  // yanks live work; 6h sits well above a typical build while clearing a genuinely crashed
  // claim within a working session. Operators raise it above their longest observed build.
  "claim_ttl_hours": "6",
  "appetite": "high",
  "adr.mode": "offer",
  "intake_gate": "warn",
  // FAFF-536: the self-hosting core-defect intake lane. Default false ⇒ the lane is off and the
  // filing chokepoint is byte-identical to today (an outward item is always outward-new-root). Set
  // true ONLY in the self-hosting repo (faff building faff) to let a concrete same-tracker-team
  // outward defect reclassify as `outward-self-intake` and file to the Backlog `faff-jot-intake`
  // bucket — a NEW classification computed at the chokepoint, never a floor edit (ADR-0079). Both
  // this opt-in AND the same-team structural check must hold; each is fail-closed to outward-new-root.
  "containment.self_hosting_intake": "false",
  "gates.fallback": "fail-closed",
  // FAFF-385: post-merge verification (re-run the declared UNIT rung against the merge sha) —
  // consulted in autonomous mode only; default on so a repo opts OUT, never opts in.
  "post_merge.check": "on",
  "budget.at_ceiling": "stop",
  // FAFF-446: budget.price_per_mtok REMOVED — the ADR-0048 per-model x per-class
  // price map is the sole pricing source now (budget.price_per_mtok_by_model stays,
  // a different knob: a map override, not a competing flat price). A `.faffrc.yaml`
  // that still sets it > 0 is named on the resolved envelope's `price_per_mtok_removed`
  // field (budget.js's envelopeFrom) rather than synthesized a default here.
  // FAFF-255: PRDR thrash-ratchet bounds. thrash_max = supersessions a single lineage may accrue
  // within thrash_window (days) before `prdr admit` escalates (ratchet.breached). Conservative defaults.
  "prdr.thrash_max": "3",
  "prdr.thrash_window": "21",
  // FAFF-199: ADR thrash-ratchet bounds — the same conservative defaults, ported verbatim for the
  // ADR axis (`adr admit`'s ratchet gate). See prdr.thrash_max/window above for the shape.
  "adr.thrash_max": "3",
  "adr.thrash_window": "21",
  // FAFF-546: ADR git-awareness validate tier, mirroring prdr.validate_git — auto (default; the
  // adrGitTier pass runs, degrading to silent outside a git work tree) | off (skip the tier entirely).
  "adr.validate_git": "auto",
  // FAFF-463: PRDR git-landing. accept_branch_prefix = the landing-branch prefix `faff prdr accept`
  // commits onto. validate_git = auto (default; the git-awareness validate tier runs, degrading to
  // silent outside a git work tree) | off (skip the git tier entirely).
  "prdr.accept_branch_prefix": "prdr/",
  "prdr.validate_git": "auto",
  // FAFF-315: per-lane model selection. build/prep_explore take the closed Agent-tool token set
  // (MODEL_LANE_VOCAB below); "inherit" = dispatch with no model param (byte-for-byte today).
  // models.eval is the eval frontier driver's pinned default — NEVER the account default (budget guard).
  "models.build": "inherit",
  "models.prep_explore": "inherit",
  // FAFF-372: per-producer model lanes for the migrated interactive prep/jot producer subagents
  // (spec / methodology / spec_review / intake). Same closed Agent-token set as build; "inherit"
  // omits the model param (byte-for-byte today until a repo pins one).
  "models.spec": "inherit",
  "models.spec_review": "inherit",
  "models.methodology": "inherit",
  "models.intake": "inherit",
  // The architecture proposer's producer-subagent dispatch lane (faff-prep's conditional
  // architecture step) — same closed Agent-token set as the sibling producer lanes.
  "models.architecture": "inherit",
  "models.eval": "claude-sonnet-4-6",
  // FAFF-416: per-lane reasoning-EFFORT selection — the effort counterpart to the FAFF-315
  // model lanes. Only the non-prep, subagent-dispatched lanes are tunable: build (concurrency
  // executors' build subagents), methodology + intake (producer-subagent dispatches). "inherit"
  // = omit the effort arg = today's dispatch, byte-for-byte. HARD EXCLUSION: prep/spec lanes
  // (spec / spec_review / prep_explore / architecture) and eval get NO effort lane — prep runs
  // once and gates the whole pipeline, so it stays pinned; the adversarial judge's effort tuning
  // lives in its own adversarial engine block (compose-not-subsume). See ADR.
  "effort.build": "inherit",
  "effort.methodology": "inherit",
  "effort.intake": "inherit",
  // FAFF-403: bounded retry count for graft's retry-later/awaiting-review hold on a mandatory-review
  // `unavailable` (provider-outage) verdict — graft's own namespace (it owns the disposition loop;
  // adversarial.* configures the engine call, not loop policy). After this many held
  // drains still unavailable, the arm escalates to the standard needs-human park (never silent-forever).
  "graft.review_outage_retry_limit": "3",
  // FAFF-333: the lights-out host-socket boundedness ATTESTATION (ADR-0041 decision 3) — default
  // false (refuse on positive evidence of a mounted host socket). true is the operator taking
  // responsibility that a same-path socket is a BOUNDED nested engine, not the host daemon;
  // it downgrades the lights-out refuse to a warn without waiving container-check's own
  // containment requirement. This registry entry drives `config get`'s DISPLAY value (so it
  // returns "false" instead of exit-3, and shows in `config defaults`); it does NOT drive the
  // gate. The gate resolves the attestation fail-closed in lights-out.js's engineBoundedFromConfig
  // (only an explicit affirmative attests — unset/unrecognised always refuses), independent of
  // this value, so flipping it here changes the display, never the safety default. Unlike the
  // sibling require_container/require_branch_protection warn|block enums (resolved by SKILL.md
  // prose), this is a boolean.
  "autonomous.engine_bounded": "false",
  // FAFF-717: decouple the Sentry ABORT kill-switch from the L4 mint. Default false —
  // only a literal `true` lets an UNATTENDED L3 run's Sentry act (abort) on a trip;
  // pause/correct stay L4-only. Fail-safe direction is OFF: the un-fired state is the
  // documented L3 advisory posture and the abort is a resumable ledger-mark, so a
  // typo/unset must leave acting off (a typo silently making runs abortable is the
  // hazard). Resolved fail-closed by sentry.js's sentryActingFromConfig (mirrors
  // engine_bounded above); this registry entry drives `config get`'s DISPLAY value
  // (returns "false" instead of exit-3, shows in `config defaults`), never the gate.
  // FAFF-765: kept as a RETAINED ALIAS — superseded by autonomous.unattended below
  // (either positive assertion asserts unattended), still honoured fail-closed.
  "autonomous.sentry_acting": "false",
  // FAFF-765: the CANONICAL declared-attendedness posture — re-keys the Sentry ABORT
  // kill-switch off the L4-mint proxy onto ATTENDEDNESS. Default false (attended →
  // advisory). A literal `true` declares the run UNATTENDED, so its Sentry ABORT acts
  // (resumable) on a trip — the self-directed CI watcher / L3-on-CI drain that cannot
  // obtain the L4 mint. Same fail-safe-OFF direction and DISPLAY-only role as
  // sentry_acting above (resolved by sentry.js's declaredUnattendedFromConfig, which
  // OR-s this with the sentry_acting alias); surface/pause/correct stay L4-only-acts.
  "autonomous.unattended": "false",
  // FAFF-624: the code-side default for the convergence brace (resolveConvergence below) —
  // matches the FAFF-534-flipped `.faffrc.example.yaml` default, so a config-less repo's
  // `faff config get convergence.enabled` answers "true"/exit 0 rather than exit 3.
  "convergence.enabled": "true",
  // FAFF-859: the lane-isolation DECLARED field — an operator declares a lane's intended physical
  // boundary in `.faffrc`; faff resolves it, emits it as lane-boundary.json (the intent-out half of
  // the ADR-0041 seam), and the assert-in preflight compares the physical boundary against it.
  // TWO orthogonal flat scalars (the models.<lane> / effort.<lane> precedent, NOT the co-constrained
  // backends.<name> nested-record): `container` (containment) and `host` (locality) are independent,
  // so a co-validated record would be unjustified. Concrete physical defaults (no `inherit` sentinel —
  // isolation has no account-level "inherit" concept): the defaults reflect today's uncaged reality
  // (evaluator runs inline, sharing the run cwd) and keep the future-wired ratchet OFF unless an
  // operator explicitly declares `container: own`. Off-vocabulary values fail loud at read AND write
  // (validateIsolationLane below), never a silent fallback (the models/effort discipline).
  "lanes.evaluator.isolation.container": "shared",
  "lanes.evaluator.isolation.host": "local",
};

// FAFF-315: closed value vocabulary for the Agent-tool model lanes. A configured value outside
// the set fails LOUD at read (exit 2, names the value + legal set) — a misconfigured model must
// never silently fall back to the session default (the FAFF-50 dropped-slot failure mode).
// models.eval is deliberately absent (open vocabulary — `claude -p` validates the id itself).
const MODEL_LANE_VOCAB = {
  "models.build": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.prep_explore": ["inherit", "sonnet", "opus", "haiku", "fable"],
  // FAFF-372: migrated interactive producer lanes reuse the build lane's closed Agent-token set.
  "models.spec": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.spec_review": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.methodology": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.intake": ["inherit", "sonnet", "opus", "haiku", "fable"],
  "models.architecture": ["inherit", "sonnet", "opus", "haiku", "fable"],
};
function validateModelLane(key, value) {
  // FAFF-422: an `engine:<name>` lane value selects the out-of-session one-shot transport
  // (`faff engine call`), legal ONLY on the v1 pure-data-in allowlist. Every other models.*
  // key — the tool-needing/prep lanes, the matcher leaves, AND the open-vocabulary eval lane —
  // rejects it at read, naming the allowlist (the read-time half of the capability-mismatch
  // guard; `faff engine call --lane` is the dispatch-time half). Name existence is checked at
  // resolution (validateEngineRef), not here — the shape is what the vocabulary admits.
  if (/^models\./.test(key) && /^engine:/.test(String(value))) {
    return ENGINE_LANE_KEYS.includes(key) ? null
      : `config get ${key}: engine values are only legal on ${ENGINE_LANE_KEYS.join(" | ")} (FAFF-422 v1 allowlist — a tool-needing lane can never reach a tool-incapable transport)`;
  }
  let vocab = MODEL_LANE_VOCAB[key];
  // FAFF-334: the per-issue build-model matcher leaves (`models.build_by_confidence.<leaf>`) reuse
  // the build lane's closed Agent-token set, so an invalid token in the matcher fails loud at
  // `config get` read time too — never a silent inherit at the per-issue dispatch site.
  // FAFF-417: `models.build_by_tier.<leaf>` reuses the identical closed set — the tier matcher
  // is the same build lane, just keyed differently.
  if (!vocab && /^models\.build_by_confidence\./.test(key)) vocab = MODEL_LANE_VOCAB["models.build"];
  if (!vocab && /^models\.build_by_tier\./.test(key)) vocab = MODEL_LANE_VOCAB["models.build"];
  if (!vocab || vocab.includes(value)) return null;
  return `config get ${key}: invalid model token "${value}" — legal set: ${vocab.join(" | ")} (fail-loud, no silent inherit)`;
}

// FAFF-422: local-engine lane values. The v1 allowlist is exactly the pure-data-in producer
// lanes (their SKILL.md + payload is self-sufficient — no tool use, no repo access), enforced
// at read (validateModelLane above) AND at dispatch (`faff engine call --lane`). Engines live
// in a top-level name-keyed `engines:` map so one definition serves many lanes; the lane value
// stays a scalar (`engine:<name>`) so the closed-vocab machinery extends rather than forks.
const ENGINE_CALL_LANES = ["methodology", "intake"];
const ENGINE_LANE_KEYS = ENGINE_CALL_LANES.map((l) => `models.${l}`);
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
    default: return "high";        // defensive: never reached (validateEffortLane gates the vocab)
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
    return `engines.${name}: provider "anthropic" is refused — Anthropic models are what the Agent-token vocabulary is for (set models.<lane> to sonnet | opus | haiku | fable instead)`;
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
// a graded `effort.<lane>` on a GRADED-effort family (openai | codex — EFFORT_GRADED_FAMILIES)
// is carried on the record and mapped onto the transport at dispatch; a graded effort on a
// non-graded family (ollama, no graded transport) OR a graded effort contradicting
// `reasoning_off: true` is refused with a capability-specific message (never silently dropped).
// Returns { name, provider, family, model, host, binPath, apiKeyEnv, auth, seatTokenEnv,
// reasoningOff, timeoutMs, effort } or { error }. `effort` is the resolved faff level
// (five-level, pre-map) or null when effort.<lane> is inherit/unset. The codex family's record
// is host-less and carries binPath instead (FAFF-593 — spawn transport, not HTTP).
function resolveEngineForLane(cfg, lane) {
  if (!ENGINE_CALL_LANES.includes(lane)) {
    return { error: `lane "${lane}" is not engine-dispatchable — v1 allowlist: ${ENGINE_CALL_LANES.join(" | ")} (FAFF-422)` };
  }
  const key = `models.${lane}`;
  const raw = dig(cfg, key);
  const value = (raw === null || raw === undefined || raw === "") ? DEFAULTS[key] : String(raw).trim();
  const laneErr = validateModelLane(key, value);
  if (laneErr) return { error: laneErr };
  if (!/^engine:/.test(value)) {
    return { error: `${key} is "${value}", not an engine:<name> value — faff engine call serves only engine-valued lanes (an Anthropic token keeps the Agent-tool dispatch)` };
  }
  const refErr = validateEngineRef(cfg, value);
  if (refErr) return { error: `${key}: ${refErr}` };
  // FAFF-705: the effort level the operator requested for this lane (validateEffortLane
  // already gated the token at read, so this is a legal faff level or "inherit"). Its
  // capability check is deferred to below — it needs the resolved family + reasoning_off.
  const effortRaw = dig(cfg, `effort.${lane}`);
  const effort = (effortRaw === null || effortRaw === undefined || effortRaw === "") ? "inherit" : String(effortRaw).trim();
  const name = value.slice("engine:".length).trim();
  // validateEngineRef above already proved the merged backends:+engines: namespace has
  // this entry with provider/model/host, so this re-resolve is non-null today; guard it
  // anyway (parity with validateEngineRef) so a future change loosening that guarantee
  // fails loud, never with a bare TypeError. FAFF-523: resolves against the MERGED
  // namespace (engines: folds into backends: at load), so a backend declared only under
  // top-level `backends:` is equally reachable via engine:<name>.
  const merged = mergeBackendsNamespace(cfg);
  const entry = merged.backends && merged.backends[name];
  if (!entry) return { error: `${key}: engines.${name} vanished after validation (concurrent config edit?)` };
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
      return { error: `effort.${lane} is "${effort}" but engines.${name} (provider ${provider}, family ${family}) has no graded reasoning-effort transport — only reasoning_off (on/off). Set effort.${lane} to inherit and use engines.${name}.reasoning_off, or point the lane at a graded-effort engine (an openai-family or codex backend).` };
    }
    if (reasoningOff) {
      return { error: `effort.${lane} is "${effort}" (graded) but engines.${name} sets reasoning_off: true — contradictory; a lane cannot both silence reasoning and request a graded effort. Drop one.` };
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
    // FAFF-705: the resolved faff effort level (five-level, pre-map) or null for inherit/unset.
    // The encode sites map it onto the transport (reasoningEffortForTransport); the codex
    // spend record stores this faff level so `economics --by effort` buckets it uniformly.
    effort: resolvedEffort,
  };
}

// FAFF-416: closed value vocabulary for the per-lane reasoning-EFFORT lanes — the FAFF-415
// EFFORT_LEVELS (low|medium|high|xhigh|max) plus "inherit" (omit the effort arg, byte-for-byte
// today). Mirrors validateModelLane: a configured off-vocabulary value fails LOUD at read
// (config get exit 2, names the value + legal set), never a silent inherit at the dispatch site.
const EFFORT_LANE_VOCAB = {
  "effort.build": ["inherit", "low", "medium", "high", "xhigh", "max"],
  "effort.methodology": ["inherit", "low", "medium", "high", "xhigh", "max"],
  "effort.intake": ["inherit", "low", "medium", "high", "xhigh", "max"],
};
function validateEffortLane(key, value) {
  let vocab = EFFORT_LANE_VOCAB[key];
  // FAFF-417: the per-issue build-effort matcher leaves (`effort.build_by_tier.<leaf>`) reuse
  // the build lane's closed effort vocabulary, so an invalid token in the matcher fails loud
  // at read too — never a silent inherit at the per-issue dispatch site. Mirrors
  // validateModelLane's identical `models.build_by_confidence.` extension above.
  if (!vocab && /^effort\.build_by_tier\./.test(key)) vocab = EFFORT_LANE_VOCAB["effort.build"];
  if (vocab) return vocab.includes(value) ? null : `config get ${key}: invalid effort token "${value}" — legal set: ${vocab.join(" | ")} (fail-loud, no silent inherit)`;
  // FAFF-416: the prep/spec + eval EXCLUSION is enforced by FAIL-LOUD, not silent tolerance —
  // any `effort.<lane>` key that is not a tunable lane (e.g. effort.spec / effort.architecture /
  // effort.eval, or a typo) fails at read so a hand-set value can never masquerade as a live knob
  // no dispatch consumes. Non-`effort.*` keys are not this validator's business (returns null).
  if (/^effort\./.test(key)) return `config get ${key}: "${key}" is not a tunable effort lane — only ${Object.keys(EFFORT_LANE_VOCAB).join(" | ")} are tunable (prep/spec + eval are deliberately excluded; FAFF-416)`;
  return null;
}

// FAFF-430: `git_host` is an ADVERTISED config knob with no behavioural consumer beyond this
// TRACKING_KEYS entry — the merge floor (merge-gate.js) is unconditionally `gh`, so a configured
// non-github host was silent config theater: branch/commit ops look fine, then the merge gate is
// silently GitHub-shaped. Mirrors validateModelLane/validateEffortLane's exact-match closed-vocab
// shape: a configured off-vocabulary value fails LOUD (config get exit 2, names value + legal
// set), never a silent limp. Unset stays fully valid — this validator is only ever called for a
// PRESENT tracking.git_host value (the call sites below all short-circuit on absence first).
const GIT_HOST_ALLOWLIST = ["github"];
function validateGitHostValue(key, value) {
  if (key !== "tracking.git_host") return null;
  if (GIT_HOST_ALLOWLIST.includes(value)) return null;
  return `config get ${key}: invalid host "${value}" — faff's merge floor is GitHub-only; legal set: ${GIT_HOST_ALLOWLIST.join(" | ")} (or leave it unset)`;
}

// FAFF-859: closed value vocabulary for the two lane-isolation DECLARED-field axes. The two axes
// are ORTHOGONAL (container = containment, host = locality); each is its own closed-vocab scalar,
// keyed on the full dotted path — the models.<lane> / effort.<lane> shape, not a co-constrained
// record. A configured off-vocabulary value fails LOUD at read (config get exit 2) AND at write
// (config set exit 2), naming the value + legal set — never a silent fallback (the FAFF-315
// models/effort discipline). Chained into the same validator chain (config get ~2019, config set
// ~1008) validateModelLane/validateEffortLane run through.
const ISOLATION_LANE_VOCAB = {
  "lanes.evaluator.isolation.container": ["shared", "own"],
  "lanes.evaluator.isolation.host": ["local", "remote"],
};
function validateIsolationLane(key, value) {
  const vocab = ISOLATION_LANE_VOCAB[key];
  if (!vocab) return null; // not this validator's key
  if (vocab.includes(value)) return null;
  return `config get ${key}: "${value}" not legal — legal set: ${vocab.join(" | ")} (fail-loud, no silent fallback)`;
}

// FAFF-308: appetite is level-scoped. `resolveAppetite` is the SINGLE appetite-resolution
// channel — under an active L4 lights-out run appetite resolves to `full` unconditionally
// and config `appetite` is ignored; config stays authoritative for L1–L3. The pin bites
// HERE (behind `faff config get appetite`) so every consumer inherits the L4 guarantee with
// zero per-call-site edits. The hard floor (destructive/irreversible always parks) is
// unchanged and still wins at `full` — "L4 = full" is never "L4 = reckless".
// Precedence: env FAFF_APPETITE (valid token) > LIVE-L4 ledger (FAFF_RUN_DIR, level:"L4" AND
//             the run is live per `runIsHeld` — running owner + fresh heartbeat) > config
// `appetite` > baked default. A missing/unreadable/non-L4 ledger, a DONE/ABANDONED/stale L4
// ledger (FAFF-378 — the level alone never pins; a dead run's ledger falls through), and an
// invalid FAFF_APPETITE token all fail safe to config — the override never fabricates `full`
// nor lowers safety. Staleness can only de-escalate agency here, never escalate it.
const VALID_APPETITES = new Set(["low", "medium", "high", "full"]);

function resolveAppetite(cfg, env = process.env) {
  // 1. env belt — the runner-exported fast-path (greppable in a process; may not cross every
  //    subagent shell, which is why the ledger brace below exists).
  const envApp = env.FAFF_APPETITE;
  if (envApp && VALID_APPETITES.has(String(envApp).toLowerCase())) return String(envApp).toLowerCase();
  // 2. ledger brace — authoritative + subagent-safe (FAFF_RUN_DIR is inherited by beep-boop
  //    subagents, as budget-check/runcheck already rely on). Reads the EXPLICITLY-handed run
  //    dir, never a globally-sorted latest (dodges the latestRunDir lexical-sort hazard).
  const runDir = env.FAFF_RUN_DIR;
  if (runDir) {
    try {
      // FAFF-378: pin only for a LIVE run. `runIsHeld` is the canonical liveness predicate
      // (parity with runcheck/sentry): running owner + heartbeat fresher than the staleness
      // window. A done/abandoned/stale L4 ledger falls through to config — the level alone
      // must not escalate agency in a later session that never armed `full`.
      const ledger = readLedger(runDir);
      // FAFF-355: overlay the dedicated heartbeat file over owner.last_heartbeat before
      // the (unchanged) runIsHeld predicate runs — same file-first liveness every seam gets.
      if (ledger) overlayHeartbeat(ledger, readHeartbeatFile(runDir));
      if (ledger && ledger.level === "L4" && runIsHeld(ledger, Date.now(), env)) return "full";
    }
    catch { /* unreadable / absent ledger → fall through (never fabricate `full`) */ }
  }
  // 3. config → baked default — the unchanged L1–L3 path.
  const v = dig(cfg, "appetite");
  return (v === null || v === undefined) ? DEFAULTS["appetite"] : v;
}

// FAFF-624: convergence is level-forced, mirroring resolveAppetite's shape (FAFF-308) — the
// read chokepoint behind `faff config get convergence.enabled`. Under a live L4 lights-out run
// convergence resolves to "true" unconditionally and config `convergence.enabled` is ignored;
// config stays authoritative for L1–L3. This is the brace half of the FAFF-624 guarantee — the
// mint-time stamp (lights-out.js's dial_profile.convergence: "forced") is the other half. The
// value is INERT at L4 by design (FAFF-534's named anti-pattern): this function never refuses,
// never warns — it only forces the answer for any occupant that consults the knob.
// Precedence: LIVE-L4 ledger (FAFF_RUN_DIR, level:"L4" AND runIsHeld) > config
// `convergence.enabled` > baked default. Deliberately NO env-var channel (unlike appetite's
// FAFF_APPETITE belt) — see the FAFF-624 spec's Decision B: an env override here could only add
// a way to disable forcing, the exact door this guarantee closes.
function resolveConvergence(cfg, env = process.env) {
  const runDir = env.FAFF_RUN_DIR;
  if (runDir) {
    try {
      const ledger = readLedger(runDir);
      if (ledger) overlayHeartbeat(ledger, readHeartbeatFile(runDir));
      if (ledger && ledger.level === "L4" && runIsHeld(ledger, Date.now(), env)) return "true";
    }
    catch { /* unreadable / absent ledger → fall through (never fabricate `true`) */ }
  }
  const v = dig(cfg, "convergence.enabled");
  return (v === null || v === undefined) ? DEFAULTS["convergence.enabled"] : fmt(v);
}

function fmt(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// FAFF-387/FAFF-577: two-file merged resolution — .faffrc.local.yaml (overlay)
// deep-merged over .faffrc.yaml (base) per shared-infra's deepMergeConfig (maps
// merge per-leaf, sequences/scalars are replaced wholesale by the overlay). BOTH
// halves are STRICT: the overlay throws "overlay-parse-error" (FAFF-387) and the
// base throws "base-parse-error" (FAFF-577) on unreadable/non-map content — a
// malformed config is loud, never a silent default (the FAFF-50 failure mode; the
// base's stakes are budget/sentry ceilings). The base chokepoint
// (readBaseConfigStrict) writes its stderr warning BEFORE the throw, so the ~23
// catching/degrading call sites can never re-silence the failure, and honours the
// FAFF_CONFIG_BASE_LENIENT escape hatch (warn-and-proceed-on-{}). An absent base
// (p === null) still resolves {} silently — all-defaults is valid. Returns
// [mergedData, basePath|null, overlayPath|null].
function loadConfig(root) {
  const p = findConfig(root);
  const baseData = p === null ? {} : readBaseConfigStrict(p);
  const overlayPath = findOverlay(root);          // may throw legacy-overlay-config-name
  if (overlayPath === null) return [baseData, p, null];
  const overlayData = parseOverlayStrict(overlayPath); // may throw overlay-parse-error
  return [deepMergeConfig(baseData, overlayData), p, overlayPath];
}

// One docs-path resolver for repository record stores (FAFF-252, FAFF-245, FAFF-754).
// `configKey` is the tracking.* override; `subdir` is the leaf under docs/ (or
// doc/ when only doc/ exists). An explicit override wins; otherwise prefer an
// existing docs/, then doc/, defaulting to docs/<subdir>.
function resolveDocsPath(root, data, create, configKey, subdir) {
  let rel;
  const val = dig(data, configKey);
  if (val) rel = String(val).trim().replace(/\/+$/, "");
  else if (fs.existsSync(path.join(root, "docs"))) rel = "docs/" + subdir;
  else if (fs.existsSync(path.join(root, "doc"))) rel = "doc/" + subdir;
  else rel = "docs/" + subdir;
  if (create) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return rel;
}
const resolveSpecDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.spec_docs_path", "specs");
const resolvePrdDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.prd_docs_path", "prd");
const resolvePrdrDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.prdr_docs_path", "prdr");
const resolveAdrDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.adr_docs_path", "adr");
const resolveSpikeDocsPath = (root, data, create) => resolveDocsPath(root, data, create, "tracking.spike_docs_path", "spikes");

// ---------------------------------------------------------------------------
// config init — FAFF-5: the deterministic WRITE half of the config surface.
// Writes/merges a `tracking` block into `.faffrc.yaml`. Pure-functional except
// the final fs.writeFileSync. NO MCP, NO env reads, NO value discovery — it
// only persists values handed to it on the CLI (lane split; that is FAFF-6's
// job). The write must round-trip: a file the existing parseYamlSubset/scalar
// reads back to the values written. The merge is a SURGICAL raw-text edit —
// never parse-then-reserialise (the parser is lossy and would destroy a user's
// slots:/appetite:/comments).
// ---------------------------------------------------------------------------
const TRACKING_KEYS = [
  "tracking.tracker",
  "tracking.team_key",
  "tracking.repo",
  "tracking.git_host",
  "tracking.spec_docs_path",
  "tracking.prd_docs_path",
  "tracking.prdr_docs_path",
  "tracking.adr_docs_path",
  "tracking.spike_docs_path",
];
const INIT_HEADER = "# .faffrc.yaml — faff configuration (written by `faff config init`)\n";

// The missing inverse of scalar(): produce YAML scalar text for a string value
// such that scalar() reads it back to that exact string. Bare when safe, else
// double-quoted (the parser does NOT process single-quote `''` escaping, so we
// only emit double-quotes, escaping `\` and `"`).
function emitScalar(value) {
  const INDICATORS = new Set(['"', "'", "[", "]", "{", "}", "&", "*", "!", "|",
    ">", "@", "%", "`", ",", ":", "#", " "]);
  const firstNonSpace = value.replace(/^\s+/, "")[0];
  const needsQuote =
    value === "" ||                       // empty → "" so it's not parsed as null
    /^\s|\s$/.test(value) ||              // leading/trailing whitespace
    value.includes(" #") ||              // space-hash → stripped as inline comment
    (firstNonSpace !== undefined && INDICATORS.has(firstNonSpace)) ||
    scalar(value) !== value;             // bare token would coerce to bool/num/null
  if (needsQuote) {
    return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }
  return value;
}

// Emit a fresh, minimal `tracking:` block (create-from-scratch path only).
// `sets` is a map leafKey → rawValue. Keys are emitted in canonical TRACKING_KEYS
// order, restricted to the keys present in `sets`.
function emitTrackingBlock(sets) {
  let out = "tracking:\n";
  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (leaf in sets) out += "  " + leaf + ": " + emitScalar(sets[leaf]) + "\n";
  }
  return out;
}

// Surgical merge: edit the raw file text in place so only the targeted
// `tracking:` keys change; every other byte (other blocks, comments, ordering,
// trailing newline) survives. Returns { text, conflicts, changed }.
function mergeTrackingBlock(rawText, sets, force) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const lines = rawText.split("\n");
  const conflicts = [];
  let changed = false;

  // Locate the top-level `tracking:` key (indent 0).
  let trackIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i]) === 0 && lines[i].trim() === "tracking:") { trackIdx = i; break; }
  }

  if (trackIdx === -1) {
    // Block absent → append a fresh block. Ensure one blank line separates it
    // from prior non-empty content; preserve the original trailing-newline state.
    const hadTrailingNewline = rawText.endsWith("\n");
    let text = rawText;
    if (text.length > 0) {
      text = text.replace(/\n+$/, "");          // trim trailing blank lines
      if (text.length > 0) text += "\n\n";     // one blank-line separator
    }
    text += emitTrackingBlock(sets);            // emitTrackingBlock ends in \n
    if (!hadTrailingNewline) text = text.replace(/\n$/, "");
    return { text, conflicts, changed: true };
  }

  // Block present: its body is the run of subsequent lines at indent > 0, up to
  // the next indent-0 line (or EOF). Blank/comment lines inside stay in the run.
  let bodyEnd = trackIdx + 1;
  while (bodyEnd < lines.length) {
    const line = lines[bodyEnd];
    if (line.trim() === "") { bodyEnd++; continue; }          // blank — tentatively in body
    if (indentOf(line) > 0) { bodyEnd++; continue; }          // indented child — in body
    break;                                                     // next top-level key
  }
  // bodyEnd is the index of the first line NOT in the body (or lines.length).
  // Trim trailing blank lines back out of the body so inserts land before them.
  let insertAt = bodyEnd;
  while (insertAt > trackIdx + 1 && lines[insertAt - 1].trim() === "") insertAt--;

  // Sample the block's existing child indentation so an inserted key lands at the
  // SAME column as its siblings. parseYamlSubset's parseMap requires exact-indent
  // children (shared-infra.js:340): a line inserted at the wrong indent is read as
  // outside the block → dig() returns null → the round-trip guard fail-closes. The
  // first indented body line wins (a well-formed block's keys share one column);
  // fall back to 2 for an empty block (no indented child to sample). This honours
  // the user's own formatting (e.g. this repo's 4-space tracking body) without
  // touching any existing byte — the surgical-merge invariant. FAFF-531.
  let blockIndent = 2;
  for (let i = trackIdx + 1; i < bodyEnd; i++) {
    if (lines[i].trim() !== "" && indentOf(lines[i]) > 0) { blockIndent = indentOf(lines[i]); break; }
  }
  const pad = " ".repeat(blockIndent);

  for (const fq of TRACKING_KEYS) {
    const leaf = fq.slice("tracking.".length);
    if (!(leaf in sets)) continue;
    const rawValue = sets[leaf];
    const keyRe = new RegExp("^(\\s+)" + leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
    let foundIdx = -1;
    for (let i = trackIdx + 1; i < bodyEnd; i++) {
      if (keyRe.test(lines[i])) { foundIdx = i; break; }
    }
    if (foundIdx !== -1) {
      const colon = lines[foundIdx].indexOf(":");
      const existingRaw = stripInlineComment(lines[foundIdx].slice(colon + 1)).trim();
      const existingVal = scalar(existingRaw);
      // emitScalar guarantees the reader reads rawValue back AS the string rawValue,
      // so the desired post-write parsed value is the raw string itself — never
      // scalar(rawValue) (which would coerce "123" → 123 and mis-detect conflicts).
      const desiredVal = rawValue;
      if (existingVal === desiredVal) continue;              // no-op for this key
      if (!force) { conflicts.push({ key: leaf, existing: existingVal, desired: desiredVal }); continue; }
      const indent = lines[foundIdx].slice(0, indentOf(lines[foundIdx]));
      lines[foundIdx] = indent + leaf + ": " + emitScalar(rawValue);  // drops inline comment (force)
      changed = true;
    } else {
      // Insert a new child line at the end of the block body, at the block's own
      // child indent (sampled above) so it round-trips — never a hardcoded 2 (FAFF-531).
      lines.splice(insertAt, 0, pad + leaf + ": " + emitScalar(rawValue));
      insertAt++;
      bodyEnd++;
      changed = true;
    }
  }
  return { text: lines.join("\n"), conflicts, changed };
}

function cmdConfigInit(args, root) {
  // 1. Parse args.
  const sets = {};            // leafKey → rawValue
  const seen = {};            // leafKey → first rawValue seen (dup-with-conflict guard)
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--set") continue;
    const token = args[++i];
    if (token === undefined) {
      process.stderr.write("faff config init: --set requires KEY=VALUE\n");
      return 2;
    }
    const eq = token.indexOf("=");
    if (eq === -1) {
      process.stderr.write(`faff config init: malformed --set '${token}' (expected KEY=VALUE)\n`);
      return 2;
    }
    const rawKey = token.slice(0, eq);
    const value = token.slice(eq + 1);          // empty value is allowed
    const fq = rawKey.startsWith("tracking.") ? rawKey : "tracking." + rawKey;
    if (!TRACKING_KEYS.includes(fq)) {
      process.stderr.write(`faff config init: unknown key '${rawKey}'. Accepted keys: ${TRACKING_KEYS.join(", ")} (bare leaf keys accepted too).\n`);
      return 2;
    }
    // FAFF-430: reuse the same read-time host-vocab validator config-get enforces — a value
    // that would fail loud at read is refused at write (mirrors config-set's read⇒write belt;
    // config init has no other per-key value validation, so this seam is registered explicitly
    // here rather than assumed-inherited). Deliberately UNGUARDED by `value !== ""` — unlike
    // spec_docs_path (the documented empty-value stub key), git_host has no legitimate
    // empty-string form: an empty write must be refused here exactly as `config get` would
    // refuse reading it back (adversarial review finding, FAFF-430) — a write/read parity gap
    // would otherwise let `--set tracking.git_host=` succeed and then immediately fail loud on
    // the very next `config get`.
    const hostErr = validateGitHostValue(fq, value);
    if (hostErr) { process.stderr.write(hostErr + "\n"); return 2; }
    const leaf = fq.slice("tracking.".length);
    if (leaf in seen && seen[leaf] !== value) {
      process.stderr.write(`faff config init: key '${leaf}' set twice with different values ('${seen[leaf]}' vs '${value}') — ambiguous.\n`);
      return 2;
    }
    seen[leaf] = value;
    sets[leaf] = value;
  }
  if (Object.keys(sets).length === 0) {
    process.stderr.write("faff config init: nothing to set (pass --set KEY=VALUE).\n");
    return 2;
  }

  // 2. Resolve target file. findConfig throws legacy-config-name → propagates to
  //    cmdConfig's catch (the refuse-second-file guarantee). Do NOT catch here.
  const existingPath = findConfig(root);          // may throw; intentional
  const canonicalPath = path.join(root, CANONICAL_CONFIG);

  // 3. Compute merged text (surgical; never reserialise).
  let newText, conflicts = [], changed;
  if (existingPath === null) {
    newText = INIT_HEADER + emitTrackingBlock(sets);
    changed = true;
  } else {
    const rawText = fs.readFileSync(existingPath, "utf8");
    ({ text: newText, conflicts, changed } = mergeTrackingBlock(rawText, sets, force));
    if (conflicts.length && !force) {
      process.stderr.write("faff config init: refusing to overwrite differing value(s) without --force:\n");
      for (const c of conflicts) {
        process.stderr.write(`  tracking.${c.key} is '${fmt(c.existing)}' in the file; --set passed '${fmt(c.desired)}'.\n`);
      }
      process.stderr.write("Re-run with --force to overwrite, or change the value.\n");
      return 2;
    }
    if (!changed) {
      console.log("config init: no changes (all values already set).");
      return 0;
    }
  }

  // 4. Round-trip self-verify against the real reader before committing the write.
  const parsed = parseYamlSubset(newText);
  for (const [leaf, rawValue] of Object.entries(sets)) {
    const got = dig(parsed, "tracking." + leaf);
    // emitScalar is the inverse of scalar(): the reader must return the raw string
    // we were handed (quoting coerces "123"/"true"/"~" back to those strings).
    const want = rawValue;
    if (got !== want) {
      process.stderr.write(`faff config init: internal error — written text does not round-trip (tracking.${leaf}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}); aborting to avoid a corrupt config.\n`);
      return 2;
    }
  }

  // 5. Output.
  if (dryRun) {
    process.stdout.write(newText.endsWith("\n") ? newText : newText + "\n");
    return 0;
  }
  fs.writeFileSync(canonicalPath, newText);
  const n = Object.keys(sets).length;
  console.log(existingPath === null
    ? `config init: created ${CANONICAL_CONFIG} with ${n} key(s).`
    : `config init: wrote ${n} key(s) to ${CANONICAL_CONFIG}.`);
  return 0;
}

// ---------------------------------------------------------------------------
// config set — FAFF-667: the general scalar-leaf writer. `config init` bootstraps the 7 flat
// tracking.* keys; every OTHER behaviour key (backends.*, models.*, slots.*, appetite, ...) had
// no sanctioned write path at all. `set` fixes that: writes a scalar leaf at ANY nesting depth
// via the same surgical raw-text discipline as mergeTrackingBlock (never parse-then-reserialise),
// round-trips through the real reader before committing, and reuses config-get's own validators
// so a value that would fail loud at read is refused at write.
// ---------------------------------------------------------------------------

// The array-valued config keys a `key value` grammar cannot express. Refused BY IDENTITY,
// before the file is even read: the documented JSON-string default form of these keys
// (e.g. `fallbacks: '[{"provider":...}]'`) reads back as a plain scalar via scalar() (no JSON
// parse on quoted values), so a value-SHAPE guard alone cannot tell it apart from a legitimate
// string — a `--force` write would silently flatten the whole fallback chain. Bound to the
// schema by configSetSelftest's drift check (mirrors the WRITABLE_NAMESPACES drift check below).
const SEQUENCE_VALUED_KEYS = new Set([
  "adversarial.refs",
  "adversarial.fallbacks",
  "adversarial.backends",
]);

// Recognised top-level config namespaces `config set` may write into — a cheap typo guard at
// the root. Low-churn: a new LEAF under an existing namespace needs no edit here; only a
// brand-new top-level namespace does (a deliberate schema addition). Every top-level key
// documented in .faffrc.example.yaml must be a member — asserted by configSetSelftest.
const WRITABLE_NAMESPACES = new Set([
  "tracking", "slots", "models", "effort", "backends", "engines", "appetite",
  "concurrency_max", "worktree_root", "logging", "automation_default",
  "intake_gate", "gates", "convergence", "budget", "sentry", "adr", "prdr",
  "adversarial", "autonomous", "containment", "post_merge", "graft", "andon",
  "bundle_store", "install", "lanes",
]);

// Emit a brand-new nested chain (create-from-scratch path — no existing .faffrc.yaml). Each
// segment but the last becomes a bare map-header line at escalating 2-space indent; the leaf
// carries the value.
function emitChainBlock(segments, value) {
  const lines = [];
  for (let i = 0; i < segments.length - 1; i++) lines.push(" ".repeat(i * 2) + segments[i] + ":");
  lines.push(" ".repeat((segments.length - 1) * 2) + segments[segments.length - 1] + ": " + emitScalar(value));
  return lines.join("\n") + "\n";
}

// Splice `chainLines` (already indented) either as a brand-new top-level block (mirrors
// mergeTrackingBlock's block-absent branch: trim trailing blank lines, one blank-line
// separator, preserve the file's trailing-newline state) or into an existing window's body
// (trim trailing blanks within the window first, so the insert lands before them).
function spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel) {
  if (isTopLevel) {
    const hadTrailingNewline = rawText.endsWith("\n");
    let text = rawText;
    if (text.length > 0) {
      text = text.replace(/\n+$/, "");
      if (text.length > 0) text += "\n\n";
    }
    text += chainLines.join("\n") + "\n";
    if (!hadTrailingNewline) text = text.replace(/\n$/, "");
    return text;
  }
  let insertAt = windowEnd;
  while (insertAt > windowStart && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, ...chainLines);
  return lines.join("\n");
}

// General nested-path surgical writer — the arbitrary-depth extension of mergeTrackingBlock's
// proven discipline. Given the raw file text, a dotted key's segments, and a scalar value,
// changes only the line(s) needed to set that leaf; creates any missing intermediate maps at
// the correct sibling-matching indent (never a hardcoded 2 — FAFF-531); leaves every other byte
// alone. Returns { text, conflict, changed, typeError }.
function mergeConfigPath(rawText, segments, rawValue, force) {
  const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
  const isBlankOrComment = (line) => line.trim() === "" || line.trim().startsWith("#");
  const keyOf = (line) => {
    const content = stripInlineComment(line.trim());
    const ci = content.indexOf(":");
    return (ci === -1 ? content : content.slice(0, ci)).trim();
  };
  const lines = rawText.split("\n");

  let windowStart = 0, windowEnd = lines.length, expectedIndent = 0;

  // Descend through every segment but the last, narrowing the search window to that key's body.
  for (let s = 0; s < segments.length - 1; s++) {
    const seg = segments[s];
    let foundIdx = -1;
    for (let i = windowStart; i < windowEnd; i++) {
      const line = lines[i];
      if (isBlankOrComment(line)) continue;
      if (indentOf(line) !== expectedIndent) continue;
      if (keyOf(line) === seg) { foundIdx = i; break; }
    }
    if (foundIdx === -1) {
      // `seg` (and everything below it) is absent — emit the remaining chain from here.
      const remaining = segments.slice(s);
      const chainLines = [];
      for (let k = 0; k < remaining.length - 1; k++) chainLines.push(" ".repeat(expectedIndent + k * 2) + remaining[k] + ":");
      chainLines.push(" ".repeat(expectedIndent + (remaining.length - 1) * 2) + remaining[remaining.length - 1] + ": " + emitScalar(rawValue));
      const isTopLevel = windowStart === 0 && windowEnd === lines.length && expectedIndent === 0;
      const text = spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel);
      return { text, conflict: null, changed: true, typeError: null };
    }
    const line = lines[foundIdx];
    const colon = line.indexOf(":");
    const after = stripInlineComment(line.slice(colon + 1)).trim();
    if (after !== "") {
      return { text: rawText, conflict: null, changed: false,
        typeError: `config set: '${segments.slice(0, s + 1).join(".")}' is a scalar; can't descend into it` };
    }
    // Descend: body = the run of lines after `line` at indent > line's own indent.
    const parentIndent = indentOf(line);
    let bodyStart = foundIdx + 1, bodyEnd = bodyStart;
    while (bodyEnd < windowEnd) {
      const l = lines[bodyEnd];
      if (l.trim() === "") { bodyEnd++; continue; }
      if (indentOf(l) > parentIndent) { bodyEnd++; continue; }
      break;
    }
    // Sample the body's own child indent so an inserted key lands at the same column as its
    // siblings (FAFF-531) — fall back to parentIndent+2 for an empty body.
    let childIndent = null;
    for (let i = bodyStart; i < bodyEnd; i++) {
      if (lines[i].trim() !== "" && indentOf(lines[i]) > parentIndent) { childIndent = indentOf(lines[i]); break; }
    }
    windowStart = bodyStart; windowEnd = bodyEnd; expectedIndent = childIndent === null ? parentIndent + 2 : childIndent;
  }

  // All ancestors resolved (or there was only one segment) — locate the leaf in this window.
  const leaf = segments[segments.length - 1];
  let leafIdx = -1;
  for (let i = windowStart; i < windowEnd; i++) {
    const line = lines[i];
    if (isBlankOrComment(line)) continue;
    if (indentOf(line) !== expectedIndent) continue;
    if (keyOf(line) === leaf) { leafIdx = i; break; }
  }

  if (leafIdx === -1) {
    const chainLines = [" ".repeat(expectedIndent) + leaf + ": " + emitScalar(rawValue)];
    const isTopLevel = windowStart === 0 && windowEnd === lines.length && expectedIndent === 0;
    const text = spliceOrAppendChain(lines, rawText, chainLines, windowStart, windowEnd, isTopLevel);
    return { text, conflict: null, changed: true, typeError: null };
  }

  const line = lines[leafIdx];
  const colon = line.indexOf(":");
  const after = stripInlineComment(line.slice(colon + 1)).trim();
  const parentIndent = indentOf(line);
  // A block-sequence / nested-map target: children at indent > parentIndent immediately below.
  let hasChildren = false;
  for (let i = leafIdx + 1; i < windowEnd; i++) {
    const l = lines[i];
    if (l.trim() === "") continue;
    hasChildren = indentOf(l) > parentIndent;
    break;
  }
  const existingVal = after === "" ? null : scalar(after);
  // Inline-flow ([a,b] / {...}) also reads as a structured (non-string, non-scalar) value.
  const isArrayOrObject = existingVal !== null && typeof existingVal === "object";
  if (hasChildren || isArrayOrObject) {
    return { text: rawText, conflict: null, changed: false,
      typeError: `config set: '${segments.join(".")}' holds a list/map; scalar set can't target it — hand-edit the committed base` };
  }
  const desiredVal = rawValue;
  if (existingVal === desiredVal) return { text: rawText, conflict: null, changed: false, typeError: null };
  if (!force) return { text: rawText, conflict: { key: segments.join("."), existing: existingVal, desired: desiredVal }, changed: false, typeError: null };
  const indent = line.slice(0, parentIndent);
  lines[leafIdx] = indent + leaf + ": " + emitScalar(rawValue);
  return { text: lines.join("\n"), conflict: null, changed: true, typeError: null };
}

function cmdConfigSet(args, root) {
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const positionals = args.filter((a) => !a.startsWith("--"));
  const key = positionals[0];
  const value = positionals[1];
  if (key === undefined || value === undefined) {
    process.stderr.write("faff config set: requires <dotted.key> <value>\n");
    return 2;
  }
  const segments = key.split(".");
  if (!WRITABLE_NAMESPACES.has(segments[0])) {
    process.stderr.write(`faff config set: unknown config namespace '${segments[0]}' — writable namespaces: ${[...WRITABLE_NAMESPACES].sort().join(", ")}\n`);
    return 2;
  }
  // By NAME, before touching the file: the JSON-string form of these keys reads back as a
  // plain scalar, so a value-shape guard alone cannot catch it (see SEQUENCE_VALUED_KEYS above).
  if (SEQUENCE_VALUED_KEYS.has(key)) {
    process.stderr.write(`faff config set: '${key}' is a list-valued key — hand-edit the committed base (config set writes scalar leaves only)\n`);
    return 2;
  }
  // Reuse the SAME shape/vocab validators `config get` runs for this key — a value that would
  // fail loud at read is refused at write. Engine EXISTENCE (validateEngineRef) is deliberately
  // not run here: it needs a complete engine (provider+model+host) a first `set` hasn't written
  // yet; existence is already checked at read/resolution.
  const writeErr = validateModelLane(key, value) || validateEffortLane(key, value) || validateGitHostValue(key, value) || validateIsolationLane(key, value);
  if (writeErr) { process.stderr.write(writeErr + "\n"); return 2; }

  const canonicalPath = path.join(root, CANONICAL_CONFIG);
  const existingPath = findConfig(root);   // may throw legacy-config-name etc.; propagate to cmdConfig's catch
  let newText;
  if (existingPath === null) {
    newText = INIT_HEADER + emitChainBlock(segments, value);
  } else {
    const rawText = fs.readFileSync(existingPath, "utf8");
    const { text, conflict, changed, typeError } = mergeConfigPath(rawText, segments, value, force);
    if (typeError) { process.stderr.write(typeError + "\n"); return 2; }
    if (conflict && !force) {
      process.stderr.write(`faff config set: refusing to overwrite ${conflict.key} ('${fmt(conflict.existing)}' -> '${fmt(conflict.desired)}') without --force\n`);
      return 2;
    }
    if (!changed) {
      console.log(`config set: no change (${key} already '${value}')`);
      return 0;
    }
    newText = text;
  }

  // Round-trip self-verify against the real reader BEFORE writing — a wrong-indent bug in the
  // nested-path logic must fail loud (exit 2, no write), never persist a corrupt file. The
  // key-identity + value-shape guards above already refused a sequence/map target, so a
  // passing round-trip here means a genuine scalar leaf.
  const parsed = parseYamlSubset(newText);
  const got = dig(parsed, key);
  if (got !== value) {
    process.stderr.write(`faff config set: internal error — written text does not round-trip (${key}: got ${JSON.stringify(got)}, want ${JSON.stringify(value)}); aborting to avoid a corrupt config.\n`);
    return 2;
  }

  if (dryRun) {
    process.stdout.write(newText.endsWith("\n") ? newText : newText + "\n");
    return 0;
  }
  fs.writeFileSync(canonicalPath, newText);
  console.log(`config set: wrote ${key}=${value} to ${CANONICAL_CONFIG}.`);
  return 0;
}

// In-memory self-test for cmdConfigSet's pure helpers + the round-trip contract. Mirrors
// configInitSelftest's shape: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configSetSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };

  // create-fresh, two-level nested: backends.cx.provider then backends.cx.model land as one map.
  {
    let text = mergeConfigPath("", ["backends", "cx", "provider"], "codex", false).text;
    // mergeConfigPath on an empty string is only exercised via the ancestor-loop root-append
    // path (windowStart===0, windowEnd===0, expectedIndent===0); assert the produced shape.
    check("nested-create: backends header emitted", text.includes("backends:"));
    check("nested-create: cx header emitted", text.includes("  cx:"));
    check("nested-create: provider leaf round-trips", dig(parseYamlSubset(text), "backends.cx.provider") === "codex");
    const r2 = mergeConfigPath(text, ["backends", "cx", "model"], "o4-mini", false);
    check("nested-create: second key nests under same map", r2.changed === true);
    check("nested-create: both leaves present, unflattened",
      dig(parseYamlSubset(r2.text), "backends.cx.provider") === "codex" &&
      dig(parseYamlSubset(r2.text), "backends.cx.model") === "o4-mini");
  }

  // top-level scalar leaf into an existing file, other blocks + comments untouched.
  {
    const orig = "slots:\n  spec: gstack:autoplan  # custom\nappetite: full\n";
    const { text, changed } = mergeConfigPath(orig, ["models", "build"], "sonnet", false);
    check("top-level-leaf: changed", changed === true);
    check("top-level-leaf: slots block byte-intact", text.includes("slots:\n  spec: gstack:autoplan  # custom"));
    check("top-level-leaf: appetite intact", text.includes("appetite: full"));
    check("top-level-leaf: new key round-trips", dig(parseYamlSubset(text), "models.build") === "sonnet");
  }

  // idempotent set: identical value, changed=false, no conflict.
  {
    const orig = "appetite: high\n";
    const { changed, conflict } = mergeConfigPath(orig, ["appetite"], "high", false);
    check("idempotent: no change", changed === false && conflict === null);
  }

  // conflict without --force refuses; --force overwrites in place, sibling untouched.
  {
    const orig = "appetite: high\nlogging: full\n";
    const r1 = mergeConfigPath(orig, ["appetite"], "low", false);
    check("conflict-refused: reported, not written", r1.changed === false && r1.conflict && r1.conflict.existing === "high" && r1.conflict.desired === "low");
    const r2 = mergeConfigPath(orig, ["appetite"], "low", true);
    check("conflict-forced: overwrote", r2.changed === true && dig(parseYamlSubset(r2.text), "appetite") === "low");
    check("conflict-forced: sibling untouched", r2.text.includes("logging: full"));
  }

  // FAFF-531 generalised: a new key inside an existing 4-space-indented map lands at that
  // map's own child indent, not a hardcoded 2.
  {
    const orig = "backends:\n    cx:\n        provider: codex\n";
    const { text, changed } = mergeConfigPath(orig, ["backends", "cx", "model"], "o4-mini", false);
    check("4-space-nested-insert: changed", changed === true);
    check("4-space-nested-insert: lands at sibling indent (8)", text.split("\n").some((l) => l === "        model: o4-mini"));
    check("4-space-nested-insert: round-trips", dig(parseYamlSubset(text), "backends.cx.model") === "o4-mini");
  }

  // scalar-where-map-expected refuses with a typeError, file unchanged.
  {
    const orig = "backends: nope\n";
    const r = mergeConfigPath(orig, ["backends", "cx", "provider"], "codex", false);
    check("scalar-blocks-descent: typeError, unchanged", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 1: block-sequence — refused, file byte-unchanged.
  {
    const orig = "adversarial:\n  refs:\n    - nvidia-glm\n    - studio-ollama\n";
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/block-sequence: value-shape belt refuses", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 2: inline-flow `[a, b]` with BARE (unquoted) items — the
  // documented form. scalar()'s JSON.parse fails on bareword items ("a" is not valid JSON),
  // so it falls through to a plain STRING, not an Array — the value-shape belt does NOT
  // catch this any more than it catches the JSON-string form. Only the key-identity denylist
  // (cmdConfigSet step 2b, asserted below) closes it — same corruption risk class as
  // representation 3.
  {
    const orig = "adversarial:\n  refs: [nvidia-glm, studio-ollama]\n";
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/inline-flow-bare: mergeConfigPath alone would NOT catch this (documents the risk)",
      r.typeError === null && r.changed === true);
    check("carve-out/inline-flow-bare: is denylisted by key identity", SEQUENCE_VALUED_KEYS.has("adversarial.refs"));
  }
  // A QUOTED inline-flow (`["a", "b"]`) IS valid JSON, so scalar() does return an Array here —
  // the value-shape belt catches this representation even without the denylist. Documents the
  // one shape the belt alone protects.
  {
    const orig = 'adversarial:\n  refs: ["nvidia-glm", "studio-ollama"]\n';
    const r = mergeConfigPath(orig, ["adversarial", "refs"], "foo", true);
    check("carve-out/inline-flow-quoted: value-shape belt refuses", r.typeError !== null && r.text === orig);
  }

  // Carve-out representation 3: the DOCUMENTED DEFAULT JSON-string scalar form — this is the
  // one the value-shape belt CANNOT catch (scalar() returns a plain string for a quoted value,
  // no JSON parse). Only the key-identity denylist (cmdConfigSet step 2b, exercised via
  // SEQUENCE_VALUED_KEYS membership here) closes it — asserted at the set() level below.
  {
    const orig = 'adversarial:\n  fallbacks: \'[{"provider":"ollama","model":"qwen3-next:80b"}]\'\n';
    const r = mergeConfigPath(orig, ["adversarial", "fallbacks"], "foo", true);
    check("carve-out/json-string: mergeConfigPath alone would NOT catch this (documents the risk)",
      r.typeError === null && r.changed === true);
    check("carve-out/json-string: is denylisted by key identity", SEQUENCE_VALUED_KEYS.has("adversarial.fallbacks"));
  }

  // WRITABLE_NAMESPACES drift check: every top-level key documented in .faffrc.example.yaml
  // must be a member (or the guard silently refuses a legitimate future key).
  {
    try {
      const examplePath = path.join(__dirname, "..", "..", "..", "..", "..", ".faffrc.example.yaml");
      const exampleText = fs.readFileSync(examplePath, "utf8");
      const topKeys = Object.keys(parseYamlSubset(exampleText));
      const missing = topKeys.filter((k) => !WRITABLE_NAMESPACES.has(k));
      check(`namespace-drift: .faffrc.example.yaml top-level keys ⊆ WRITABLE_NAMESPACES (missing: ${missing.join(", ") || "none"})`, missing.length === 0);
    } catch (e) {
      check(`namespace-drift: could not read .faffrc.example.yaml (${e.message})`, false);
    }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config set, ${fail} failed)`);
  return fail ? 1 : 0;
}

// In-memory self-test for cmdConfigInit's pure helpers + the round-trip contract.
// Mirrors `next --selftest`: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configInitSelftest() {
  let fail = 0;
  const check = (label, cond) => {
    if (!cond) fail++;
    console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  };
  const reads = (text, leaf) => dig(parseYamlSubset(text), "tracking." + leaf);

  // create-fresh: header + canonical-order block, round-trips.
  {
    const text = INIT_HEADER + emitTrackingBlock({ team_key: "FAFF", tracker: "linear" });
    check("create-fresh: canonical order (tracker before team_key)",
      text.indexOf("tracker:") < text.indexOf("team_key:"));
    check("create-fresh: has header", text.startsWith(INIT_HEADER));
    check("create-fresh: round-trips team_key", reads(text, "team_key") === "FAFF");
    check("create-fresh: round-trips tracker", reads(text, "tracker") === "linear");
  }

  // merge-add-key into an existing tracking block, other keys + inline comments intact.
  {
    const orig = "tracking:\n  tracker: linear  # the tracker\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("merge-add-key: changed", changed === true && conflicts.length === 0);
    check("merge-add-key: existing key + inline comment intact", text.includes("tracker: linear  # the tracker"));
    check("merge-add-key: new key inserted", reads(text, "team_key") === "FAFF");
    check("merge-add-key: original tracker reads back", reads(text, "tracker") === "linear");
  }

  // comment / other-block preservation: non-tracking bytes untouched.
  {
    const orig = "# my config\nslots:\n  spec: gstack:autoplan  # custom\nappetite: full\n\ntracking:\n  repo: a/b\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("preserve: slots block byte-intact", text.includes("slots:\n  spec: gstack:autoplan  # custom"));
    check("preserve: appetite intact", text.includes("appetite: full"));
    check("preserve: leading comment intact", text.startsWith("# my config\n"));
    check("preserve: new tracking key present", reads(text, "team_key") === "FAFF");
    check("preserve: existing tracking key present", reads(text, "repo") === "a/b");
  }

  // append-block to a file that has none.
  {
    const orig = "slots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("append-block: changed", changed === true);
    check("append-block: slots intact", text.includes("slots:\n  spec: x"));
    check("append-block: tracking appended", reads(text, "repo") === "a/b");
  }

  // idempotent no-op: identical value, changed=false, no conflict.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("idempotent: no change", changed === false && conflicts.length === 0);
  }

  // conflict-refused-without-force.
  {
    const orig = "tracking:\n  team_key: FAFF\n";
    const { changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, false);
    check("conflict-refused: reported, not written",
      changed === false && conflicts.length === 1 && conflicts[0].existing === "FAFF" && conflicts[0].desired === "OTHER");
  }

  // conflict-overwritten-with-force: only that line changes.
  {
    const orig = "tracking:\n  team_key: FAFF\n  repo: a/b\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { team_key: "OTHER" }, true);
    check("conflict-forced: overwrote", changed === true && conflicts.length === 0 && reads(text, "team_key") === "OTHER");
    check("conflict-forced: other line untouched", reads(text, "repo") === "a/b");
  }

  // quoted/bare emit round-trip (truth table from the spec).
  {
    const cases = [
      ["linear", "linear"], ["FAFF", "FAFF"], ["shftwst/faff", "shftwst/faff"],
      ["docs/specs/", "docs/specs/"], ["true", '"true"'], ["123", '"123"'],
      ["~", '"~"'], ["", '""'], ["a #b", '"a #b"'], ["[x]", '"[x]"'],
      [" lead", '" lead"'], ["trail ", '"trail "'], ["1.5", '"1.5"'], ["false", '"false"'],
    ];
    let ok = true, badEmit = "";
    for (const [input, expectEmit] of cases) {
      const emitted = emitScalar(input);
      if (emitted !== expectEmit) { ok = false; badEmit = `${JSON.stringify(input)}→${JSON.stringify(emitted)} (want ${JSON.stringify(expectEmit)})`; break; }
      // and it must round-trip back to the original string.
      if (scalar(emitted) !== input) { ok = false; badEmit = `${JSON.stringify(input)} does not round-trip`; break; }
    }
    check("emit: quoting truth table + round-trip" + (ok ? "" : " — " + badEmit), ok);
  }

  // unknown-key rejection is enforced in cmdConfigInit (arg parse) — assert the allowlist shape here.
  check("allowlist: known key normalises", TRACKING_KEYS.includes("tracking.team_key"));
  check("allowlist: ADR docs path is writable", TRACKING_KEYS.includes("tracking.adr_docs_path"));
  check("allowlist: spike docs path is writable", TRACKING_KEYS.includes("tracking.spike_docs_path"));
  check("allowlist: unknown key absent", !TRACKING_KEYS.includes("tracking.slug"));

  // FAFF-754: ADR and spike stores share the configurable docs-path contract while
  // retaining the established docs/* defaults for repositories that do not opt in.
  check("docs paths: ADR resolver keeps the legacy default",
    typeof resolveAdrDocsPath === "function" && resolveAdrDocsPath("/tmp/no-doc-tree", {}, false) === "docs/adr");
  check("docs paths: ADR resolver honours tracking.adr_docs_path",
    typeof resolveAdrDocsPath === "function" && resolveAdrDocsPath("/tmp/no-doc-tree", { tracking: { adr_docs_path: "records/adr/" } }, false) === "records/adr");
  check("docs paths: spike resolver keeps the legacy default",
    typeof resolveSpikeDocsPath === "function" && resolveSpikeDocsPath("/tmp/no-doc-tree", {}, false) === "docs/spikes");
  check("docs paths: spike resolver honours tracking.spike_docs_path",
    typeof resolveSpikeDocsPath === "function" && resolveSpikeDocsPath("/tmp/no-doc-tree", { tracking: { spike_docs_path: "records/spikes/" } }, false) === "records/spikes");

  // empty tracking block (key with null body): inserts children.
  {
    const orig = "tracking:\nslots:\n  spec: x\n";
    const { text, changed } = mergeTrackingBlock(orig, { repo: "a/b" }, false);
    check("empty-block: inserts child", changed === true && reads(text, "repo") === "a/b");
    check("empty-block: slots untouched", text.includes("slots:\n  spec: x"));
  }

  // FAFF-531: insert into a 4-space-indented tracking block (like this repo's own
  // .faffrc.yaml). The inserted key must land at the block's own indent (4), not a
  // hardcoded 2, or parseYamlSubset reads it as outside the block → null → the
  // round-trip guard aborts. The `/` in the repro value is coincidental — a
  // non-slash key reproduces the same failure, so both are asserted.
  {
    const orig = "tracking:\n    spec_docs_path: docs/specs/ # where graft commits\n";
    const { text, changed, conflicts } = mergeTrackingBlock(orig, { repo: "shftwst/faff" }, false);
    check("4-space-insert: changed, no conflict", changed === true && conflicts.length === 0);
    check("4-space-insert: slash value round-trips", reads(text, "repo") === "shftwst/faff");
    check("4-space-insert: sibling key + inline comment byte-intact",
      text.includes("    spec_docs_path: docs/specs/ # where graft commits"));
    check("4-space-insert: sibling reads back", reads(text, "spec_docs_path") === "docs/specs/");
    check("4-space-insert: inserted line at 4-space indent",
      text.split("\n").some((l) => l === "    repo: shftwst/faff"));
  }
  {
    // non-slash new key into a 4-space block — proves the fix is indent-general,
    // not slash-specific (a bare `team_key=FAFF` also returned null pre-fix).
    const orig = "tracking:\n    spec_docs_path: docs/specs/\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("4-space-insert: non-slash key round-trips", reads(text, "team_key") === "FAFF");
    check("4-space-insert: non-slash sibling intact", reads(text, "spec_docs_path") === "docs/specs/");
  }
  {
    // regression guard: inserting into a 2-space block is byte-identical to pre-fix
    // (blockIndent samples 2), so no existing merge selftest output shifts.
    const orig = "tracking:\n  tracker: linear\n";
    const { text } = mergeTrackingBlock(orig, { team_key: "FAFF" }, false);
    check("2-space-insert: byte-identical to pre-fix (2-space pad)",
      text === "tracking:\n  tracker: linear\n  team_key: FAFF\n");
  }

  // FAFF-262: block-sequence parsing (arrays of maps + arrays of scalars).
  {
    const text = "adversarial:\n  backends:\n    - provider: nvidia\n      model: nemotron\n    - provider: ollama\n      model: qwen3\n";
    const arr = dig(parseYamlSubset(text), "adversarial.backends");
    check("seq: array of maps is an Array of length 2", Array.isArray(arr) && arr.length === 2);
    check("seq: map item 1 multi-key intact", arr && arr[0] && arr[0].provider === "nvidia" && arr[0].model === "nemotron");
    check("seq: map item 2 multi-key intact", arr && arr[1] && arr[1].provider === "ollama" && arr[1].model === "qwen3");
  }
  {
    const arr = dig(parseYamlSubset("hosts:\n  - alpha\n  - beta\n"), "hosts");
    check("seq: array of scalars", Array.isArray(arr) && arr.length === 2 && arr[0] === "alpha" && arr[1] === "beta");
  }
  {
    // scalar coercion of sequence items (numbers/booleans via scalar()).
    const arr = dig(parseYamlSubset("nums:\n  - 1\n  - 2\n  - true\n"), "nums");
    check("seq: scalar coercion of items", Array.isArray(arr) && arr[0] === 1 && arr[1] === 2 && arr[2] === true);
  }
  {
    // nested map inside a sequence item.
    const arr = dig(parseYamlSubset("items:\n  - name: a\n    opts:\n      x: 1\n"), "items");
    check("seq: nested map inside item", Array.isArray(arr) && arr[0].name === "a" && arr[0].opts && arr[0].opts.x === 1);
  }
  {
    // regression guard: scalars + nested maps + block scalar + JSON-string scalar parse unchanged.
    const text = "tracking:\n  team_key: SHF\n  spec_docs_path: docs/specs/\nnote: |\n  line one\n  line two\nfallbacks: '[{\"provider\":\"x\"}]'\n";
    const d = parseYamlSubset(text);
    check("seq regression: scalar unchanged", dig(d, "tracking.team_key") === "SHF");
    check("seq regression: nested map unchanged", dig(d, "tracking.spec_docs_path") === "docs/specs/");
    check("seq regression: block scalar unchanged", dig(d, "note") === "line one\nline two\n");
    check("seq regression: JSON-string scalar stays a string", dig(d, "fallbacks") === '[{"provider":"x"}]');
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// FAFF-387 — `faff config check`: deterministic posture + integrity checker.
// Read-only, NO tracker/network/writes. Exit 0 clean / 1 >=1 finding / 2 unreadable.
// Part of the factory `config` region (no own banner — a plain sub-section).
// ---------------------------------------------------------------------------

// Secret-scan table (spec Appendix A). Two complementary detectors, tuned for
// near-zero false positives on real config (hosts, model ids, paths all carry the
// `. : /` separators the generic detector excludes; `*_env` keys are exempt by
// design). The table is DATA — one row per pattern — so extending it is a one-line
// change plus a selftest row. `known` matches the VALUE anywhere; `generic` gates on
// the KEY name AND a high-entropy value shape.
const SECRET_KNOWN_PREFIXES = [
  "sk-", "ghp_", "gho_", "ghu_", "ghs_", "github_pat_", "AKIA",
  "nvapi-", "AIza", "-----BEGIN ",
];
// xox[baps]- (Slack) is a shape, not a bare prefix — kept as an explicit regex.
const SECRET_KNOWN_REGEXES = [/xox[baps]-/];
const SECRET_KEYNAME_RE = /key|token|secret|password|credential/i;
const SECRET_GENERIC_VALUE_RE = /^[A-Za-z0-9+/=_-]{32,}$/;

// PURE: does this (keyName, value) look like a leaked credential? Returns a reason
// string ("known-prefix" | "generic-high-entropy") or null. Never returns the value.
function secretScanLeaf(keyName, value) {
  if (typeof value !== "string" || value === "") return null;
  for (const pfx of SECRET_KNOWN_PREFIXES) if (value.startsWith(pfx)) return "known-prefix";
  for (const re of SECRET_KNOWN_REGEXES) if (re.test(value)) return "known-prefix";
  // Generic: key-name-gated, `*_env` exempt (the name-indirection pattern), and the
  // value must be a long separator-free high-entropy blob (excludes hosts/ids/paths).
  if (SECRET_KEYNAME_RE.test(keyName) && !/_env$/.test(keyName) && SECRET_GENERIC_VALUE_RE.test(value)) {
    return "generic-high-entropy";
  }
  return null;
}

// Redact a suspected secret to key-path + length + first-4-chars ONLY — NEVER the
// value. The raw value must never reach any output stream (spec: a checker that
// prints the secret recreates the leak it guards against).
function redactSecret(keyPath, value) {
  const v = String(value);
  return `${keyPath} (len=${v.length}, starts "${v.slice(0, 4)}")`;
}

// PURE: walk a parsed config document, applying secretScanLeaf to every scalar
// (string) leaf. Recurses maps and sequences; keys the finding by dotted path (and
// [i] for sequence items). `fileLabel` prefixes the finding surface so a base vs
// overlay hit is distinguishable. Returns [{severity,surface,message}].
function scanDocForSecrets(doc, fileLabel) {
  const findings = [];
  const walk = (node, keyPath, leafName) => {
    if (typeof node === "string") {
      const reason = secretScanLeaf(leafName, node);
      if (reason) findings.push({ severity: "warn", surface: `${fileLabel}:${keyPath}`, message: `possible secret (${reason}) — ${redactSecret(keyPath, node)}. Move it to an env var (\`*_env\` names the var; the value never lives in config).` });
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${keyPath}[${i}]`, leafName)); return; }
    if (isPlainConfigMap(node)) { for (const k of Object.keys(node)) walk(node[k], keyPath ? `${keyPath}.${k}` : k, k); }
  };
  walk(doc, "", "");
  return findings;
}

// Git posture probes — read-only, stdlib child_process. Return true/false/null
// (null = probe unavailable, i.e. not in a git repo or git absent).
function gitInRepo(root) {
  const r = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim() === "true";
}
function gitIsIgnored(root, relPath) {
  // exit 0 = ignored, 1 = not ignored, other = error.
  const r = spawnSync("git", ["-C", root, "check-ignore", "-q", relPath], { encoding: "utf8" });
  return r.status === 0;
}
function gitIsTracked(root, relPath) {
  const r = spawnSync("git", ["-C", root, "ls-files", "--error-unmatch", relPath], { encoding: "utf8" });
  return r.status === 0;
}

const MIGRATION_STEPS = [
  "1. Move machine-local values (private hosts, personal model prefs) into .faffrc.local.yaml",
  "2. Edit .gitignore: drop the `.faffrc.yaml` line; add `.faffrc.local.yaml`",
  "3. Run `faff config check`, then commit .faffrc.yaml",
];

// PURE: known-key (schema) lint over a document's TOP-LEVEL key NAMES only — values are
// never inspected (value-shape validation is out of scope, FAFF-794 §2). Classifies each
// top-level key as flat-dotted (name contains ".", the unreachable-literal-key mistake
// `dig`'s split-on-"." can't reach), unknown (no "." but absent from `knownSet`), or known
// (silent). Mirrors scanDocForSecrets' per-file attribution — `fileLabel` prefixes the
// finding surface so a base vs overlay hit is distinguishable. Every finding is `severity:
// "warn"` (forward-compat: a not-yet-allowlisted key must never hard-fail `config check`).
function knownKeyLint(doc, fileLabel, knownSet) {
  const findings = [];
  if (!isPlainConfigMap(doc)) return findings;
  const known = [...knownSet].sort().join(", ");
  for (const topKey of Object.keys(doc)) {
    const dotIdx = topKey.indexOf(".");
    if (dotIdx !== -1) {
      const prefix = topKey.slice(0, dotIdx);
      if (knownSet.has(prefix)) {
        findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is a flat dotted key — you likely meant a nested map (the segments under \`${prefix}:\`). As written it is a single unreachable literal key and resolves to the default.` });
      } else {
        findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is a flat dotted key with unrecognised namespace \`${prefix}\` (probable typo and flat form); nest it under a known namespace. Resolves to the default as written.` });
      }
    } else if (!knownSet.has(topKey)) {
      findings.push({ severity: "warn", surface: `${fileLabel}:${topKey}`, message: `\`${topKey}\` is an unrecognised top-level key (probable typo); silently ignored, resolves to the default. Known namespaces: ${known}.` });
    }
  }
  return findings;
}

// PURE core of `config check` — takes the already-resolved inputs and returns
// { findings, skipped, exit }. Split from cmdConfigCheck's I/O so --selftest can
// drive the secret scan + posture logic in-memory without a real git repo.
// `probes` supplies { inRepo, isIgnored(rel), isTracked(rel) } (nullable inRepo).
function computeConfigCheck({ basePath, baseDoc, overlayPath, overlayDoc, legacyBase, legacyOverlay, baseParseError, probes }) {
  const findings = [];
  const skipped = [];
  const rel = (p) => (p ? path.basename(p) : null);

  // Check 5: legacy filenames present (mirror the loud resolver error as a finding).
  for (const n of [...(legacyBase || []), ...(legacyOverlay || [])]) {
    findings.push({ severity: "error", surface: n, message: `legacy config filename \`${n}\` present — faff uses only \`.faffrc.yaml\` / \`.faffrc.local.yaml\`; rename it.` });
  }

  // Check 1b (FAFF-577): a malformed base is an error-severity FINDING naming file +
  // parse detail — the diagnosis surface describes the fault it exists to catch,
  // exit 1, never an exit-2 abort.
  if (baseParseError) {
    findings.push({ severity: "error", surface: rel(baseParseError.file) || rel(basePath) || ".faffrc.yaml", message: `malformed base config — ${baseParseError.detail}. Configured values (including budget/sentry ceilings) are NOT applied; fix the file (git diff / git checkout ${rel(baseParseError.file) || ".faffrc.yaml"}).` });
  }

  // Check 2 + 3: posture (git). Skipped entirely outside a git repo.
  if (probes.inRepo) {
    if (basePath) {
      const baseRel = rel(basePath);
      if (probes.isIgnored(baseRel) || !probes.isTracked(baseRel)) {
        findings.push({ severity: "warn", surface: baseRel, message: `\`${baseRel}\` is unmigrated/uncommitted (git-ignored or untracked) — unrecoverable if corrupted. Migrate:\n${MIGRATION_STEPS.map((s) => "     " + s).join("\n")}` });
      }
    }
    if (overlayPath) {
      const ovRel = rel(overlayPath);
      if (!probes.isIgnored(ovRel)) {
        findings.push({ severity: "warn", surface: ovRel, message: `\`${ovRel}\` is NOT git-ignored — the machine-local overlay is about to be committed. Add it to .gitignore.` });
      }
    }
  } else {
    skipped.push("posture checks skipped (not a git repo)");
  }

  // Check 4: secret scan over both files' scalar leaves (redacted output).
  if (baseDoc) findings.push(...scanDocForSecrets(baseDoc, rel(basePath) || ".faffrc.yaml"));
  if (overlayDoc) findings.push(...scanDocForSecrets(overlayDoc, rel(overlayPath) || ".faffrc.local.yaml"));

  // Check 6 (FAFF-523): backends: namespace soundness — a name collision with
  // engines: (error) and the derived-egress residency guard (warn) over the
  // MERGED document (overlay wins scalars over base, same posture as every
  // other resolved value).
  const mergedDoc = overlayDoc ? deepMergeConfig(baseDoc || {}, overlayDoc) : (baseDoc || {});
  findings.push(...backendsConfigCheckFindings(mergedDoc));

  // Check 7 (FAFF-753/FAFF-808): automation_default: opt-out is INERT on a tracker-bound
  // repo — it opens the unlabelled surface only in git-only mode. Warn when a tracker is
  // pinned (a real connector name) AND opt-out is set, so the ignored knob is surfaced.
  // A git-only pin (the reserved `none`/`git-only` sentinel, FAFF-808) is NOT a connector
  // pin — it's the symmetric assertion the repo has no tracker, so opt-out is legitimately
  // honoured there and must not warn. Read the pin inline (no require("./tracker") —
  // config.js is on tracker.js's require path) and replicate classifyTracker's
  // trim/blank/sentinel normalisation so this linter and `faff tracker probe` never
  // disagree: a whitespace-only pin is unpinned, and a git-only sentinel is not "pinned".
  const pinRaw = dig(mergedDoc, "tracking.tracker");
  // Exact parity with classifyTracker (tracker.js): null/undefined/blank-after-trim ⇒ unpinned;
  // a reserved sentinel (none/git-only, case-insensitive, trimmed) ⇒ git-only, not pinned;
  // otherwise coerce via String().trim() (a non-string pin is classified the same way there).
  const pinTrimmed = pinRaw === null || pinRaw === undefined ? "" : String(pinRaw).trim();
  const pinned = pinTrimmed !== "" && !["none", "git-only"].includes(pinTrimmed.toLowerCase());
  const autoDefault = dig(mergedDoc, "automation_default");
  if (pinned && autoDefault === "opt-out") {
    findings.push({ severity: "warn", surface: "automation_default", message: "`automation_default: opt-out` is ignored on a tracker-bound repo — it applies only in git-only mode; the two faff-* labels are the control surface here." });
  }

  // Check 8 (FAFF-430): a present, non-github tracking.git_host is config theater — faff's
  // merge floor is unconditionally `gh`, so a hand-edited base carrying e.g. `git_host: gitlab`
  // would otherwise limp silently past this linter (config get / config set already fail loud
  // on the same value; this catches a base that never went through either). Unset is fine — the
  // finding fires only when the merged value is present and off-allowlist.
  const gitHostRaw = dig(mergedDoc, "tracking.git_host");
  // fmt() first — mirrors the cmdConfig read-time path (`validateGitHostValue(key, fmt(value))`)
  // so a non-string YAML scalar (e.g. `git_host: true`) produces the identical quoted message on
  // both surfaces, never a raw-value/fmt'd-value mismatch between `config check` and `config get`
  // (adversarial review finding, FAFF-430).
  const gitHost = gitHostRaw === null || gitHostRaw === undefined ? gitHostRaw : fmt(gitHostRaw);
  if (gitHost !== null && gitHost !== undefined && validateGitHostValue("tracking.git_host", gitHost)) {
    findings.push({ severity: "error", surface: "tracking.git_host", message: `git_host: "${gitHost}" is not supported — faff's merge floor is GitHub-only. Set git_host: github or leave it unset.` });
  }

  // Check 9 (FAFF-794): known-key (schema) lint — flags an unrecognised or flat-dotted
  // top-level key as a warn finding, so a typo (e.g. `autonymous.sentry_acting`, meant as
  // `autonomous: { sentry_acting: true }`) stops silently resolving to its fail-safe
  // default with no signal. Walks baseDoc and overlayDoc INDEPENDENTLY (never the merged
  // doc) — a mistake in either file is its own distinct silent no-op and must be attributed
  // to the file it lives in, exactly as the secret scan (Check 4) attributes per-file.
  if (baseDoc) findings.push(...knownKeyLint(baseDoc, rel(basePath) || ".faffrc.yaml", WRITABLE_NAMESPACES));
  if (overlayDoc) findings.push(...knownKeyLint(overlayDoc, rel(overlayPath) || ".faffrc.local.yaml", WRITABLE_NAMESPACES));

  return { findings, skipped, exit: findings.length ? 1 : 0 };
}

function cmdConfigCheck(args, root) {
  if (args.includes("--selftest")) return configCheckSelftest();
  const json = args.includes("--json");

  // Check 1: parse. Resolve both files, reading each independently so a parse fault
  // in EITHER is a loud exit 2 (never a silent skip). Legacy names are collected as
  // findings, not thrown, so `config check` reports them rather than aborting.
  let basePath = null, baseDoc = null, overlayPath = null, overlayDoc = null;
  const legacyBase = [], legacyOverlay = [];
  try {
    basePath = findConfig(root);
  } catch (e) {
    if (e.message === "legacy-config-name") legacyBase.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  try {
    overlayPath = findOverlay(root);
  } catch (e) {
    if (e.message === "legacy-overlay-config-name") legacyOverlay.push(...e.legacy);
    else { process.stderr.write(`faff config check: ${e.message}\n`); return 2; }
  }
  // FAFF-577: the diagnosis surface must be able to DESCRIBE a malformed base —
  // detection-as-finding (error severity, exit 1), never an exit-2 abort on this
  // fault (or the one command that names the problem would refuse to run), and
  // never the old silent coerce to {}. parseConfigMapStrict is called directly
  // (not readBaseConfigStrict): check reports findings, it doesn't fire the
  // chokepoint warning or honour the hatch.
  let baseParseError = null;
  if (basePath) {
    try {
      baseDoc = parseConfigMapStrict(basePath, "base-parse-error", "the base config");
    } catch (e) {
      if (e && e.message === "base-parse-error") baseParseError = { file: e.file, detail: e.detail };
      else { process.stderr.write(`faff config check: ${basePath} unreadable (${e.code || e.message})\n`); return 2; }
    }
  }
  if (overlayPath) {
    try {
      overlayDoc = parseOverlayStrict(overlayPath);
    } catch (e) {
      process.stderr.write(`faff config check: ${e.file || overlayPath} failed to parse (${e.detail || e.message})\n`);
      return 2;
    }
  }

  const inRepo = gitInRepo(root);
  const probes = {
    inRepo,
    isIgnored: (relPath) => gitIsIgnored(root, relPath),
    isTracked: (relPath) => gitIsTracked(root, relPath),
  };
  const { findings, skipped, exit } = computeConfigCheck({
    basePath, baseDoc, overlayPath, overlayDoc, legacyBase, legacyOverlay, baseParseError, probes,
  });

  if (json) {
    console.log(JSON.stringify({ ok: exit === 0, findings, skipped }, null, 2));
    return exit;
  }
  for (const s of skipped) console.log(`skip  ${s}`);
  for (const f of findings) console.log(`${f.severity === "error" ? "ERROR" : "warn "} ${f.surface}: ${f.message}`);
  if (exit === 0) {
    console.log(skipped.length ? "config check: no findings (some checks skipped)" : "config check: clean");
  }
  return exit;
}

// In-memory selftest of the secret-pattern table + the merge (deepMergeConfig)
// behaviour + the posture logic (via computeConfigCheck's pure core). Mirrors the
// other --selftest commands: per-case ok/FAIL + a RESULT line, non-zero on any fail.
function configCheckSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // --- secret-pattern table -------------------------------------------------
  check("secret: sk- prefix flagged", secretScanLeaf("api_key", "sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD") === "known-prefix");
  check("secret: ghp_ prefix flagged", secretScanLeaf("anything", "ghp_0123456789abcdefghij") === "known-prefix");
  check("secret: AKIA prefix flagged", secretScanLeaf("aws", "AKIAIOSFODNN7EXAMPLE") === "known-prefix");
  check("secret: nvapi- prefix flagged", secretScanLeaf("k", "nvapi-xxxxxxxxxxxxxxxxxxxx") === "known-prefix");
  check("secret: AIza prefix flagged", secretScanLeaf("k", "AIzaSyBhydeSomethingLong") === "known-prefix");
  check("secret: xoxb- shape flagged", secretScanLeaf("k", "xoxb-123-456-abcdef") === "known-prefix");
  check("secret: PEM header flagged", secretScanLeaf("k", "-----BEGIN RSA PRIVATE KEY-----") === "known-prefix");
  check("secret: generic high-entropy on key-named field flagged",
    secretScanLeaf("api_token", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === "generic-high-entropy");
  // exemptions / non-secrets
  check("secret: *_env key exempt", secretScanLeaf("api_key_env", "NVIDIA_API_KEY") === null);
  check("secret: host NOT flagged", secretScanLeaf("host", "https://integrate.api.nvidia.com/v1") === null);
  check("secret: model id NOT flagged", secretScanLeaf("model", "qwen3-next:80b-a3b-instruct-q4_K_M") === null);
  check("secret: path NOT flagged", secretScanLeaf("spec_docs_path", "docs/specs/") === null);
  check("secret: short value on key-named field NOT flagged (below 32)", secretScanLeaf("token", "shortish") === null);
  check("secret: non-key-named long blob NOT flagged (generic gated on key name)",
    secretScanLeaf("some_field", "aB3dEf6hIj9lMn2pQr5tUv8xYz1AbC4d") === null);

  // redaction NEVER emits the raw value.
  {
    const raw = "sk-SUPERSECRETVALUE1234567890abcdef";
    const red = redactSecret("adversarial.api_key", raw);
    check("redact: raw value absent from redacted output", !red.includes("SECRETVALUE") && !red.includes(raw));
    check("redact: shows len + 4-char prefix", red.includes("len=") && red.includes(`"sk-S"`));
  }
  {
    // scanDocForSecrets full-path: the raw value must not appear in ANY finding message.
    const raw = "ghp_ZZZZZZZZZZ0123456789abcdefghij";
    const doc = { adversarial: { api_key: raw } };
    const fs2 = scanDocForSecrets(doc, ".faffrc.yaml");
    check("scan: nested leaf flagged by dotted path", fs2.length === 1 && fs2[0].surface === ".faffrc.yaml:adversarial.api_key");
    check("scan: raw value NEVER in finding message", !fs2[0].message.includes(raw) && !fs2[0].message.includes("ZZZZZZZZZZ"));
    // sequence-item leaf scanning.
    const doc2 = { fallbacks: [{ api_key: raw }] };
    const fs3 = scanDocForSecrets(doc2, "x");
    check("scan: sequence-item leaf flagged with [i] path", fs3.length === 1 && fs3[0].surface === "x:fallbacks[0].api_key");
  }

  // --- merge table (deepMergeConfig) ---------------------------------------
  check("merge: overlay wins scalar",
    deepMergeConfig({ appetite: "high" }, { appetite: "low" }).appetite === "low");
  check("merge: deep-merge maps per leaf (base sibling survives)", (() => {
    const m = deepMergeConfig({ slots: { spec: "a", review: "b" } }, { slots: { review: "c" } });
    return m.slots.spec === "a" && m.slots.review === "c";
  })());
  check("merge: sequences replaced wholesale (never element-merged)", (() => {
    const m = deepMergeConfig({ hosts: ["a", "b", "c"] }, { hosts: ["x"] });
    return Array.isArray(m.hosts) && m.hosts.length === 1 && m.hosts[0] === "x";
  })());
  check("merge: overlay-only key added", deepMergeConfig({ a: 1 }, { b: 2 }).b === 2);
  check("merge: no overlay → base unchanged (identity)", (() => {
    const base = { a: 1, b: { c: 2 } };
    return deepMergeConfig(base, {}).a === 1 && deepMergeConfig(base, {}).b.c === 2;
  })());
  check("merge: type mismatch (map over scalar) → overlay wins", (() => {
    const m = deepMergeConfig({ x: "scalar" }, { x: { nested: 1 } });
    return isPlainConfigMap(m.x) && m.x.nested === 1;
  })());
  check("merge: does not mutate base input", (() => {
    const base = { slots: { spec: "a" } };
    deepMergeConfig(base, { slots: { spec: "z" } });
    return base.slots.spec === "a";
  })());

  // --- posture logic (computeConfigCheck pure core) ------------------------
  {
    // base git-ignored → posture warn with migration steps; exit 1.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => true, isTracked: () => false },
    });
    check("posture: ignored base → 1 finding, exit 1", r.findings.length === 1 && r.exit === 1);
    check("posture: finding carries migration steps", r.findings[0].message.includes("Migrate:") && r.findings[0].message.includes(".faffrc.local.yaml"));
  }
  {
    // base tracked + not ignored → clean, exit 0.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("posture: tracked base → clean, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // overlay NOT ignored → hygiene finding.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {}, overlayPath: "/r/.faffrc.local.yaml", overlayDoc: {},
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: (n) => n === ".faffrc.yaml" ? false : false, isTracked: () => true },
    });
    check("hygiene: un-ignored overlay flagged", r.findings.some((f) => f.surface === ".faffrc.local.yaml" && /NOT git-ignored/.test(f.message)));
  }
  {
    // not a git repo → posture skipped (reported), parse/secret still run; clean → exit 0.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { slots: { spec: "x" } }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: false, isIgnored: () => false, isTracked: () => false },
    });
    check("not-a-repo: posture skipped + reported", r.skipped.length === 1 && r.exit === 0);
  }
  {
    // secret in base doc → exit 1, redacted (no raw value in any message).
    const raw = "sk-abcdefghijklmnopqrstuvwxyz0123456789";
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { api_key: raw }, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("secret-in-doc: exit 1", r.exit === 1);
    check("secret-in-doc: no raw value in output", !JSON.stringify(r.findings).includes(raw));
  }
  {
    // legacy filename present → error finding, exit 1.
    const r = computeConfigCheck({
      basePath: null, baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [".faffrc.yml"], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("legacy: present filename → error finding, exit 1", r.exit === 1 && r.findings.some((f) => f.severity === "error"));
  }
  {
    // FAFF-577: malformed base → error-severity finding naming file + detail, exit 1
    // (detection-as-finding — never an exit-2 abort in the pure core's vocabulary).
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      baseParseError: { file: "/r/.faffrc.yaml", detail: "does not parse to a mapping (malformed YAML — the base config must be a key:value mapping)" },
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("malformed base: error finding naming file + detail, exit 1",
      r.exit === 1 && r.findings.some((f) => f.severity === "error" && f.surface === ".faffrc.yaml" && /malformed base config/.test(f.message) && /does not parse to a mapping/.test(f.message)));
  }
  {
    // FAFF-753: pinned tracker + automation_default:opt-out → warn (opt-out inert on a tracker repo).
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "linear" }, automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-753: pinned tracker + opt-out → warn finding, exit 1",
      r.exit === 1 && r.findings.some((f) => f.severity === "warn" && f.surface === "automation_default" && /ignored on a tracker-bound repo/.test(f.message)));
  }
  {
    // FAFF-753: opt-out but tracker UNPINNED (git-only) → no warn (opt-out is legitimately honoured).
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-753: opt-out git-only (no pin) → no opt-out warn",
      !r.findings.some((f) => f.surface === "automation_default"));
  }
  {
    // FAFF-753: whitespace-only tracker pin is UNPINNED (classifyTracker parity) → no warn.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "   " }, automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-753: whitespace-only pin ⇒ unpinned ⇒ no opt-out warn (trim parity)",
      !r.findings.some((f) => f.surface === "automation_default"));
  }
  {
    // FAFF-753: pinned tracker + opt-in → no opt-out warn (opt-in is the normal safe posture).
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "linear" }, automation_default: "opt-in" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-753: pinned tracker + opt-in → no opt-out warn",
      !r.findings.some((f) => f.surface === "automation_default"));
  }
  {
    // FAFF-808: git-only pin (canonical `none`) + opt-out → no opt-out warn (not a connector pin).
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "none" }, automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-808: git-only pin (none) + opt-out → no opt-out warn",
      !r.findings.some((f) => f.surface === "automation_default"));
  }
  {
    // FAFF-808: git-only pin (alias `git-only`) + opt-out → no opt-out warn.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "git-only" }, automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-808: git-only pin (alias) + opt-out → no opt-out warn",
      !r.findings.some((f) => f.surface === "automation_default"));
  }
  {
    // FAFF-808: git-only pin, mixed-case + whitespace (`  None  `) + opt-out → no opt-out warn.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { tracking: { tracker: "  None  " }, automation_default: "opt-out" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("FAFF-808: git-only pin, mixed-case + whitespace → no opt-out warn",
      !r.findings.some((f) => f.surface === "automation_default"));
  }

  // --- known-key (schema) lint (FAFF-794) ----------------------------------
  {
    // flat-dotted key with an UNKNOWN prefix (the live repro: typo'd "autonymous" +
    // flat form) → exactly one finding, never two, exit 1.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { "autonymous.sentry_acting": true },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: flat-dotted unknown-prefix key → exactly 1 warn finding, exit 1",
      r.exit === 1 && r.findings.length === 1 && r.findings[0].severity === "warn"
      && r.findings[0].surface === ".faffrc.yaml:autonymous.sentry_acting"
      && /flat dotted key with unrecognised namespace `autonymous`/.test(r.findings[0].message));
  }
  {
    // flat-dotted key with a KNOWN prefix (correctly-spelled but flat) → nested-map hint.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { "gates.fallback": "advisory" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: flat-dotted known-prefix key → nested-map-hint warn finding",
      r.findings.length === 1 && /flat dotted key — you likely meant a nested map \(the segments under `gates:`\)/.test(r.findings[0].message));
  }
  {
    // multi-dot flat key → exactly ONE finding naming the FULL key.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { "autonomous.guardrails.require_container": true },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: multi-dot flat key → exactly 1 finding naming the full key",
      r.findings.length === 1 && r.findings[0].surface === ".faffrc.yaml:autonomous.guardrails.require_container");
  }
  {
    // plain unknown top-level key (no dot) → warn naming it + the known namespaces.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { appetitte: "high" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: plain unknown key → warn finding naming key + known namespaces",
      r.findings.length === 1 && r.findings[0].surface === ".faffrc.yaml:appetitte"
      && /unrecognised top-level key/.test(r.findings[0].message) && /Known namespaces:/.test(r.findings[0].message));
  }
  {
    // overlay-only unknown key → surface names the OVERLAY file, not the base.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: {},
      overlayPath: "/r/.faffrc.local.yaml", overlayDoc: { bogus_key: 1 },
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => true, isTracked: () => true },
    });
    check("known-key: overlay-only unknown key → surface names the overlay file",
      r.findings.some((f) => f.surface === ".faffrc.local.yaml:bogus_key"));
  }
  {
    // known top-level key with a scalar value (not a map) → key-name-only, no finding.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml", baseDoc: { slots: "not-a-map" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: known top-level key with scalar value → no known-key finding (key-name-only), exit 0",
      !r.findings.some((f) => f.surface.endsWith(":slots")) && r.findings.length === 0 && r.exit === 0);
  }
  {
    // fully valid config (only known namespaces, properly nested) → no known-key findings.
    const r = computeConfigCheck({
      basePath: "/r/.faffrc.yaml",
      baseDoc: { tracking: { tracker: "linear" }, slots: { spec: "x" }, appetite: "high" },
      overlayPath: null, overlayDoc: null, legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: fully valid config → no known-key findings, exit 0",
      r.findings.length === 0 && r.exit === 0);
  }
  {
    // absent base and overlay → the lint contributes nothing (all-defaults stays clean).
    const r = computeConfigCheck({
      basePath: null, baseDoc: null, overlayPath: null, overlayDoc: null,
      legacyBase: [], legacyOverlay: [],
      probes: { inRepo: true, isIgnored: () => false, isTracked: () => true },
    });
    check("known-key: absent base/overlay → no findings, exit 0", r.findings.length === 0 && r.exit === 0);
  }
  {
    // WRITABLE_NAMESPACES must include "install" (gates.js's install.skill_targets is live).
    check("known-key: WRITABLE_NAMESPACES includes 'install'", WRITABLE_NAMESPACES.has("install"));
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (config check, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdConfig(args) {
  // FAFF-576: fail-closed flag gate across all sub-verbs — an unknown flag / missing value exits 2
  // here; each sub-verb's body below reads validated flags via its own (positional-aware) scan.
  const gate = parseArgs(args, CONFIG_SPEC);
  if (gate.errors.length) return usageError(gate.errors, `usage: faff config <${configVerbList()}> [KEY [VALUE]] [-d DEFAULT] [--json] [--set K=V] [--force] [--dry-run] [--root DIR]`);
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];
  try {
    if (cmd === "path") {
      // FAFF-387: multi-line — each resolved file on its own line, base first;
      // exit 3 only when NEITHER file exists (first-run offer semantics preserved).
      // BACK-COMPAT: with no overlay (the common case), output is the exact same
      // single line as before.
      const basePath = findConfig(root);
      const overlayPath = findOverlay(root);       // may throw legacy-overlay-config-name
      if (basePath === null && overlayPath === null) return 3;
      if (basePath !== null) console.log(basePath);
      if (overlayPath !== null) console.log(overlayPath);
      return 0;
    }
    if (cmd === "check") {
      return cmdConfigCheck(rest.slice(1), root);
    }
    if (cmd === "get") {
      // FAFF-26: --json prints the value as JSON (structured: lists/objects survive instead of
      // being stringified to "[object Object]"). Key is the first positional that isn't a flag
      // or a flag's value, so `config get --json infra` and `config get infra` both resolve `infra`.
      const wantJson = rest.includes("--json");
      let def = null, key = null;
      for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === "-d" || a === "--default") { def = rest[++i] ?? null; continue; }
        if (a === "--json") continue;
        if (key === null) key = a;
      }
      const [data] = loadConfig(root);
      // FAFF-308: appetite is the one level-scoped dial — route it through the sole appetite
      // resolver so an active L4 run forces `full`. Guarded to the `appetite` key ONLY; every
      // other key's resolution below is byte-for-byte unchanged.
      if (key === "appetite") {
        const app = resolveAppetite(data, process.env);
        console.log(wantJson ? JSON.stringify(app) : app);
        return 0;
      }
      // FAFF-624: convergence.enabled is the second level-scoped dial — route it through the
      // sole convergence resolver so a live L4 run forces "true". Guarded to this key ONLY;
      // every other key's resolution below is byte-for-byte unchanged.
      if (key === "convergence.enabled") {
        const conv = resolveConvergence(data, process.env);
        console.log(wantJson ? JSON.stringify(conv) : conv);
        return 0;
      }
      const value = dig(data, key);
      if (value === null || value === undefined) {
        // FAFF-182: a registry key resolves to its baked default (exit 0) — no prose `-d` needed.
        if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
          console.log(wantJson ? JSON.stringify(DEFAULTS[key]) : DEFAULTS[key]);
          return 0;
        }
        if (def !== null) console.log(wantJson ? JSON.stringify(def) : def);
        else if (wantJson) console.log("null");
        return 3;
      }
      // FAFF-315: Agent-token model lanes have a closed vocabulary — an invalid configured
      // value fails loud here (exit 2), never a silent inherit at the dispatch site.
      // FAFF-430: tracking.git_host reuses the same read-time seam — a non-github value
      // fails loud here too, never a silently GitHub-shaped merge gate.
      const laneErr = validateModelLane(key, fmt(value)) || validateEffortLane(key, fmt(value)) || validateGitHostValue(key, fmt(value)) || validateIsolationLane(key, fmt(value));
      if (laneErr) { process.stderr.write(laneErr + "\n"); return 2; }
      // FAFF-422: an allowlisted engine value also resolves its engines.<name> reference at
      // read — a dangling name / missing field / illegal provider fails loud HERE, not at
      // the first dispatch that happens to touch the lane.
      if (/^models\./.test(key) && /^engine:/.test(fmt(value))) {
        const refErr = validateEngineRef(data, fmt(value));
        if (refErr) { process.stderr.write(`config get ${key}: ${refErr}\n`); return 2; }
      }
      console.log(wantJson ? JSON.stringify(value) : fmt(value));
      return 0;
    }
    if (cmd === "defaults") {
      // FAFF-182: print the registry; --selftest asserts it covers the expected slots + scalars.
      if (rest.includes("--selftest")) {
        const expected = [
          "slots.intake", "slots.spec", "slots.spec_review", "slots.review", "slots.ship", "slots.concurrency",
          "slots.methodology", "slots.routing_adaptor", "slots.rendering_adaptor", "slots.adr", "slots.architecture",
          "slots.env", "slots.prd", "slots.transport",
          "logging", "concurrency_max", "automation_default", "appetite", "adr.mode", "intake_gate",
          "containment.self_hosting_intake",
          "gates.fallback", "post_merge.check", "budget.at_ceiling",
          "models.build", "models.prep_explore",
          "models.spec", "models.spec_review", "models.methodology", "models.intake",
          "models.architecture",
          "models.eval",
          // FAFF-416: per-lane effort lanes (non-prep, subagent-dispatched only).
          "effort.build", "effort.methodology", "effort.intake",
          // FAFF-403: graft's outage-retry-later bound (graft.* namespace — graft owns the loop).
          "graft.review_outage_retry_limit",
          // FAFF-333: the lights-out host-socket boundedness attestation (default false).
          "autonomous.engine_bounded",
          // FAFF-717: the L3 Sentry-abort opt-in (default false) — retained alias.
          "autonomous.sentry_acting",
          // FAFF-765: the canonical declared-attendedness posture (default false).
          "autonomous.unattended",
          // FAFF-624: the convergence brace's code-side default.
          "convergence.enabled",
          // FAFF-859: the two lane-isolation declared-field axes (concrete physical defaults).
          "lanes.evaluator.isolation.container", "lanes.evaluator.isolation.host",
        ];
        const missing = expected.filter((k) => !Object.prototype.hasOwnProperty.call(DEFAULTS, k));
        if (missing.length) { process.stderr.write(`config defaults --selftest: missing ${missing.join(", ")}\n`); return 1; }
        // FAFF-315: the model-lane vocab table must cover every Agent-token lane, accept its own
        // defaults, and reject an off-vocabulary token (the fail-loud path is load-bearing).
        const vocabFail =
          validateModelLane("models.build", DEFAULTS["models.build"]) ||
          validateModelLane("models.prep_explore", DEFAULTS["models.prep_explore"]) ||
          // FAFF-372: the migrated producer lanes accept their own defaults and reject off-vocabulary tokens.
          validateModelLane("models.spec", DEFAULTS["models.spec"]) ||
          validateModelLane("models.spec_review", DEFAULTS["models.spec_review"]) ||
          validateModelLane("models.methodology", DEFAULTS["models.methodology"]) ||
          validateModelLane("models.intake", DEFAULTS["models.intake"]) ||
          validateModelLane("models.architecture", DEFAULTS["models.architecture"]) ||
          (validateModelLane("models.architecture", "gpt-5") ? null : "architecture lane vocab failed to reject an invalid token") ||
          (validateModelLane("models.spec", "gpt-5") ? null : "producer lane vocab failed to reject an invalid token") ||
          (validateModelLane("models.build", "gpt-5") ? null : "vocab table failed to reject an invalid token") ||
          (validateModelLane("models.eval", "any-id-is-fine") ? "models.eval must be open-vocabulary" : null) ||
          // FAFF-334: the per-issue matcher leaves must reuse the build vocab — accept a valid token, reject an invalid one.
          validateModelLane("models.build_by_confidence.high", "sonnet") ||
          (validateModelLane("models.build_by_confidence.high", "gpt-5") ? null : "matcher leaf failed to reject an invalid token") ||
          // FAFF-417: the tier-keyed matcher leaves reuse the identical build vocab — same
          // accept/reject smoke check as the confidence matcher leaves above.
          validateModelLane("models.build_by_tier.mechanical", "sonnet") ||
          (validateModelLane("models.build_by_tier.mechanical", "gpt-5") ? null : "tier matcher leaf failed to reject an invalid token") ||
          // FAFF-416: the effort-lane vocab must accept every effort lane's default (inherit) + a
          // real effort level, and reject an off-vocabulary token (the fail-loud path is load-bearing).
          validateEffortLane("effort.build", DEFAULTS["effort.build"]) ||
          validateEffortLane("effort.methodology", "low") ||
          validateEffortLane("effort.intake", "max") ||
          (validateEffortLane("effort.build", "sonnet") ? null : "effort lane vocab failed to reject a model token") ||
          (validateEffortLane("effort.build", "ultra") ? null : "effort lane vocab failed to reject an invalid effort token") ||
          // FAFF-417: the effort tier-keyed matcher leaves reuse the effort.build vocab — same
          // accept/reject smoke check as the scalar effort lanes above.
          validateEffortLane("effort.build_by_tier.mechanical", "low") ||
          (validateEffortLane("effort.build_by_tier.mechanical", "ultra") ? null : "effort tier matcher leaf failed to reject an invalid token") ||
          // FAFF-422: engine values are legal on exactly the pure-data-in allowlist — the two
          // allowlisted lanes accept the SHAPE, every other models.* key (incl. the open-vocabulary
          // eval lane and the matcher leaves) rejects it naming the allowlist.
          validateModelLane("models.methodology", "engine:studio") ||
          validateModelLane("models.intake", "engine:studio") ||
          (validateModelLane("models.build", "engine:studio") ? null : "build lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.spec", "engine:studio") ? null : "spec lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.eval", "engine:studio") ? null : "eval lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateModelLane("models.build_by_confidence.high", "engine:studio") ? null : "matcher leaf failed to reject an engine value (FAFF-422 allowlist)") ||
          // FAFF-859: the isolation-lane vocab must accept both axes' baked defaults and reject an
          // off-vocabulary value on each axis (the fail-loud path is load-bearing for the declared field).
          validateIsolationLane("lanes.evaluator.isolation.container", DEFAULTS["lanes.evaluator.isolation.container"]) ||
          validateIsolationLane("lanes.evaluator.isolation.host", DEFAULTS["lanes.evaluator.isolation.host"]) ||
          (validateIsolationLane("lanes.evaluator.isolation.container", "vm") ? null : "isolation container axis failed to reject an off-vocabulary value") ||
          (validateIsolationLane("lanes.evaluator.isolation.host", "moon") ? null : "isolation host axis failed to reject an off-vocabulary value");
        if (vocabFail) { process.stderr.write(`config defaults --selftest: ${vocabFail}\n`); return 1; }
        console.log("config defaults --selftest: ok");
        return 0;
      }
      console.log(JSON.stringify(DEFAULTS, null, 2));
      return 0;
    }
    if (cmd === "spec-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveSpecDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "prd-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolvePrdDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "prdr-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolvePrdrDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "adr-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveAdrDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "spike-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveSpikeDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "dump") {
      const [data] = loadConfig(root);
      console.log(JSON.stringify(data, null, 2));
      return 0;
    }
    if (cmd === "init") {
      if (rest.includes("--selftest")) return configInitSelftest();
      return cmdConfigInit(rest.slice(1), root);
    }
    if (cmd === "set") {
      if (rest.includes("--selftest")) return configSetSelftest();
      return cmdConfigSet(rest.slice(1), root);
    }
    if (cmd === "resolved") {
      // FAFF-50: loud, human-readable echo of the resolved NON-default config — what a run
      // actually uses that overrides a built-in default. Print it in run banners so a dropped
      // slot is visible, not silent.
      const [data, p, overlayPath] = loadConfig(root);
      const slots = (data.slots && typeof data.slots === "object" && !Array.isArray(data.slots)) ? data.slots : {};
      const SLOTS = ["intake", "spec", "spec_review", "architecture", "env", "review", "ship", "concurrency", "methodology",
        "routing_adaptor", "rendering_adaptor"];
      console.log(`config:   ${p || "(none — all defaults)"}`);
      // FAFF-387: an active overlay is echoed on its own line — never silent — so a
      // run banner shows both files in play. BACK-COMPAT: with no overlay (the
      // common case) this line is simply omitted, so output is byte-for-byte the
      // pre-FAFF-387 form.
      if (overlayPath) console.log(`config local: ${overlayPath}`);
      console.log(`appetite: ${dig(data, "appetite") ?? "high (default)"}`);
      // FAFF-212 review F3: surface a non-default intake_gate so a typo'd/overridden
      // value is visible in the run banner, not silently coerced behind the user's back.
      const gate = dig(data, "intake_gate");
      if (gate !== null && gate !== undefined && gate !== "") console.log(`intake_gate: ${gate}`);
      // FAFF-42/350/333/717/728/765: surface a non-default autonomous-entry preflight knob (require_container /
      // require_branch_protection / require_github_auth / engine_bounded / sentry_acting / unattended) so an opt-in
      // `block` — or the engine_bounded attestation, or the declared-attendedness posture (unattended, and its
      // retained sentry_acting alias) — is visible in the run banner, never silent (the operator's typo-detection
      // surface for the abort kill-switch: a typo on either key must be seen, not silently make runs abortable).
      for (const knob of ["require_container", "require_branch_protection", "require_github_auth", "engine_bounded", "sentry_acting", "unattended"]) {
        const v = dig(data, `autonomous.${knob}`);
        if (v !== null && v !== undefined && v !== "") console.log(`autonomous.${knob}: ${v}`);
      }
      let any = false;
      for (const s of SLOTS) {
        const v = slots[s];
        if (v !== null && v !== undefined && v !== "") { console.log(`slot ${s}: ${v}`); any = true; }
      }
      if (!any) console.log("slots:    (all defaults)");
      // FAFF-315: surface non-default per-lane models in the run banner — a pinned model must be
      // visible, not silent (the same FAFF-50 intent as the slot echo above).
      const models = (data.models && typeof data.models === "object" && !Array.isArray(data.models)) ? data.models : {};
      for (const lane of ["build", "prep_explore", "spec", "spec_review", "methodology", "intake", "architecture", "eval"]) {
        const v = models[lane];
        if (v !== null && v !== undefined && v !== "") console.log(`model ${lane}: ${v}`);
      }
      // FAFF-334: surface the per-issue build-model matcher when set — a routing config that flips
      // build-model resolution from per-run to per-issue must be visible in the run banner, not silent.
      const byConf = (models.build_by_confidence && typeof models.build_by_confidence === "object" && !Array.isArray(models.build_by_confidence)) ? models.build_by_confidence : {};
      // Only the buckets that actually route are echoed (default/high/medium) — a `low` leaf is inert
      // (a low-confidence spec parks at prep, never builds), so echoing it would imply a live routing
      // config that does nothing and mislead the reader about what the run will do.
      for (const conf of ["default", "high", "medium"]) {
        const v = byConf[conf];
        if (v !== null && v !== undefined && v !== "") console.log(`model build_by_confidence.${conf}: ${v}`);
      }
      // FAFF-417: surface the per-issue build-model TIER matcher when set — same FAFF-50 intent
      // as the confidence matcher above. Every tier builds (routing-only, no park/promote gate),
      // so — unlike the confidence matcher's `low`-leaf suppression — ALL configured leaves echo.
      const byTier = (models.build_by_tier && typeof models.build_by_tier === "object" && !Array.isArray(models.build_by_tier)) ? models.build_by_tier : {};
      for (const t of ["default", "mechanical", "standard", "complex"]) {
        const v = byTier[t];
        if (v !== null && v !== undefined && v !== "") console.log(`model build_by_tier.${t}: ${v}`);
      }
      // FAFF-416: surface non-default per-lane effort in the run banner — a pinned effort must be
      // visible, not silent (the same FAFF-50 intent as the slot + model echoes above).
      const effort = (data.effort && typeof data.effort === "object" && !Array.isArray(data.effort)) ? data.effort : {};
      for (const lane of ["build", "methodology", "intake"]) {
        const v = effort[lane];
        if (v !== null && v !== undefined && v !== "") console.log(`effort ${lane}: ${v}`);
      }
      // FAFF-417: surface the per-issue build-EFFORT tier matcher when set — mirrors the
      // model tier-matcher echo above; all tiers route, so no inert-leaf suppression.
      const effortByTier = (effort.build_by_tier && typeof effort.build_by_tier === "object" && !Array.isArray(effort.build_by_tier)) ? effort.build_by_tier : {};
      for (const t of ["default", "mechanical", "standard", "complex"]) {
        const v = effortByTier[t];
        if (v !== null && v !== undefined && v !== "") console.log(`effort build_by_tier.${t}: ${v}`);
      }
      // FAFF-859: surface a non-default lane-isolation declaration in the run banner — an operator
      // who armed (or will arm) the cage/locality must see it, never silent (the FAFF-50 intent as
      // the slot/model/effort echoes above). Echoed only when the resolved value DIFFERS from the
      // baked default, so an unset repo's banner is byte-for-byte the pre-FAFF-859 form.
      for (const axis of ["container", "host"]) {
        const key = `lanes.evaluator.isolation.${axis}`;
        const v = dig(data, key);
        if (v !== null && v !== undefined && v !== "" && fmt(v) !== DEFAULTS[key]) console.log(`isolation evaluator.${axis}: ${fmt(v)}`);
      }
      return 0;
    }
  } catch (e) {
    if (e.message === "legacy-config-name") {
      const names = e.legacy.join(", ");
      process.stderr.write(`faff config: legacy config filename found (${names}). faff uses only \`${CANONICAL_CONFIG}\` — rename it to \`${CANONICAL_CONFIG}\`. (FAFF-50: single canonical config name; never a silent default.)\n`);
      return 2;
    }
    if (e.message === "multiple-config") {
      const names = e.files.map((f) => path.basename(f)).join(", ");
      process.stderr.write(`faff config: multiple config files at the repo root (${names}); keep only one.\n`);
      return 2;
    }
    // FAFF-387: the overlay's own legacy-name + parse-fault tags — same LOUD,
    // never-silent discipline as the base file's legacy-config-name above.
    if (e.message === "legacy-overlay-config-name") {
      const names = e.legacy.join(", ");
      process.stderr.write(`faff config: legacy overlay config filename found (${names}). faff uses only \`${CANONICAL_OVERLAY_CONFIG}\` — rename it to \`${CANONICAL_OVERLAY_CONFIG}\`. (FAFF-387: single canonical overlay name; never a silent default.)\n`);
      return 2;
    }
    if (e.message === "overlay-parse-error") {
      process.stderr.write(`faff config: ${e.file} failed to parse (${e.detail}) — an overlay parse failure is never silently skipped (FAFF-387).\n`);
      return 2;
    }
    // FAFF-577: the base's parse-fault tag — the chokepoint warning (with the
    // remedy + hatch) already fired on stderr; this branch is the command-level
    // exit, mirroring the overlay branch above.
    if (e.message === "base-parse-error") {
      process.stderr.write(`faff config: ${e.file} failed to parse (${e.detail}) — a malformed base is never a silent default (FAFF-577).\n`);
      return 2;
    }
    throw e;
  }
  process.stderr.write(`faff config: expected one of ${configVerbList()}\n`);
  return 2;
}

// FAFF-334: per-issue build-model routing. `models.build` (FAFF-315) is a single per-run scalar;
// this resolver keys the build model off an issue's retained spec confidence via the OPTIONAL sibling
// matcher `models.build_by_confidence` (a `default` + confidence-keyed leaves), so a mixed-confidence
// build queue picks the safe model per issue with no rc churn. PURE — the confidence is passed in, no
// tracker call (the orchestrator already holds it at assembly). Fallback chain, in order:
//   models.build_by_confidence.<conf> → models.build_by_confidence.default → models.build (scalar) → "inherit".
// The resolved token is validated against the closed build Agent-token set (fail-loud, never a silent
// inherit — FAFF-315/FAFF-50). An absent/unknown `conf` routes to the `default` bucket (never guesses
// `high`), mirroring the "no confidence line" tolerance the routing gate already applies. Matcher
// ABSENT ⇒ the scalar path, byte-for-byte FAFF-315.
function resolveBuildModel(cfg, conf) {
  const byConf = dig(cfg, "models.build_by_confidence");
  const rawMap = (byConf && typeof byConf === "object" && !Array.isArray(byConf)) ? byConf : null;
  // Normalise leaf keys to lowercase once — a capitalised YAML key (`High:`) must not silently miss
  // and route to the default bucket; the confidence tokens themselves are lowercase (high|medium|low).
  const map = {};
  if (rawMap) for (const k of Object.keys(rawMap)) {
    const v = rawMap[k];
    if (v !== null && v !== undefined && v !== "") map[String(k).trim().toLowerCase()] = String(v).trim();
  }
  // Validate EVERY configured leaf up-front — not just the resolved token. The spec's guarantee is
  // "an invalid Agent-token ANYWHERE in the matcher ⇒ fail-loud at read", so a typo in a not-yet-
  // dispatched leaf is caught at the first resolution, never left dormant until its bucket happens to build.
  for (const k of Object.keys(map)) {
    if (validateModelLane("models.build_by_confidence." + k, map[k])) {
      return { error: `faff models build-for: invalid model token "${map[k]}" in models.build_by_confidence.${k} — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
    }
  }
  const pick = (k) => (k != null && Object.prototype.hasOwnProperty.call(map, k)) ? map[k] : null;
  const key = conf != null ? String(conf).trim().toLowerCase() : null;
  let token = pick(key) ?? pick("default");
  if (token == null) {
    const scalar = dig(cfg, "models.build");
    token = (scalar === null || scalar === undefined || scalar === "") ? DEFAULTS["models.build"] : String(scalar).trim();
  }
  if (validateModelLane("models.build", token)) {
    return { error: `faff models build-for: resolved token "${token}" is not a legal build model — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
  }
  return { token };
}

// FAFF-417: layers `models.build_by_tier` AHEAD of resolveBuildModel's FAFF-334
// confidence/scalar chain — never subsumes it. Fallback, first hit wins:
//   models.build_by_tier.<tier> -> .default -> null (fall through to the caller's
//   confidence/scalar chain, NOT to "inherit" directly)
// Tier ABSENT => skip the tier matcher entirely — never guess a tier. Matcher NOT
// configured at all => null immediately, same fall-through. Every configured leaf
// validates up-front (mirrors resolveBuildModel) regardless of whether `tierVal`
// resolves — an invalid token anywhere in the matcher fails loud at first resolution.
function resolveBuildModelForTier(cfg, tierVal) {
  const byTier = dig(cfg, "models.build_by_tier");
  const rawMap = (byTier && typeof byTier === "object" && !Array.isArray(byTier)) ? byTier : null;
  if (!rawMap) return null; // not configured — caller falls through to confidence/scalar
  const map = {};
  for (const k of Object.keys(rawMap)) {
    const v = rawMap[k];
    if (v !== null && v !== undefined && v !== "") map[String(k).trim().toLowerCase()] = String(v).trim();
  }
  for (const k of Object.keys(map)) {
    if (validateModelLane("models.build_by_tier." + k, map[k])) {
      return { error: `faff models build-for: invalid model token "${map[k]}" in models.build_by_tier.${k} — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
    }
  }
  if (tierVal == null) return null; // tier absent — skip the tier matcher, never guess
  const pick = (k) => (k != null && Object.prototype.hasOwnProperty.call(map, k)) ? map[k] : null;
  const key = String(tierVal).trim().toLowerCase();
  const token = pick(key) ?? pick("default");
  if (token == null) return null; // no matching leaf — fall through to confidence/scalar
  if (validateModelLane("models.build", token)) {
    return { error: `faff models build-for: resolved token "${token}" is not a legal build model — legal set: ${MODEL_LANE_VOCAB["models.build"].join(" | ")} (fail-loud, no silent inherit)` };
  }
  return { token };
}

// FAFF-417 spec §4 PROCEDURE resolve build model (tier?, conf?):
//   1. IF models.build_by_tier configured AND tier present: build_by_tier.<tier> -> .default -> fall through
//   2. IF models.build_by_confidence configured AND conf present: FAFF-334 chain verbatim (resolveBuildModel)
//   3. models.build (scalar) -> "inherit"           [handled inside resolveBuildModel]
// The tier matcher — the better-informed key, since it already folds confidence in as a
// prior — outranks the confidence matcher whenever both are configured and a tier is
// present. With no `models.build_by_tier` config (or an absent tier), this is byte-for-byte
// resolveBuildModel(cfg, conf) — the FAFF-334 posture, unchanged.
function resolveBuildModelForIssue(cfg, tierVal, conf) {
  const tierRes = resolveBuildModelForTier(cfg, tierVal);
  if (tierRes) return tierRes; // either a resolved token or a fail-loud error — tier wins
  return resolveBuildModel(cfg, conf);
}

// `faff models build-for [<confidence>] [--tier <tier>] [--confidence <conf>]` — print the
// per-issue build model token (or "inherit", which the caller maps to "omit the Agent-tool
// model param"). Pure; exit 0 token / 2 usage or invalid token. The bare positional
// `<confidence>` form is byte-for-byte unchanged (FAFF-334); `--tier` layers the FAFF-417
// tier matcher ahead of it; `--confidence` is the flag-form alias for the same confidence
// slot the positional fills (so `--tier`+`--confidence` can be given together).
function cmdModels(args) {
  if (args.includes("--selftest")) return modelsSelftest();
  const { values, positionals, errors } = parseArgs(args, MODELS_SPEC);
  const usage = "usage: faff models build-for [<confidence>] [--tier <tier>] [--confidence <conf>] [--root DIR]";
  if (errors.length) return usageError(errors, usage);
  const sub = positionals[0];
  if (sub !== "build-for") {
    process.stderr.write(usage + "\n");
    return 2;
  }
  const root = values["--root"] || findRoot();
  const confArg = values["--confidence"] || positionals[1] || null;
  const tierArg = values["--tier"] || null;
  const [cfg] = loadConfig(root);
  const res = resolveBuildModelForIssue(cfg, tierArg, confArg);
  if (res.error) { process.stderr.write(res.error + "\n"); return 2; }
  console.log(res.token);
  return 0;
}

// Selftest — drives the pure resolver over the fallback chain + the read-time matcher-leaf validation.
function modelsSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  const full = { models: { build: "opus", build_by_confidence: { default: "opus", high: "sonnet", medium: "opus" } } };
  ok("build-for high → matcher leaf sonnet", resolveBuildModel(full, "high").token === "sonnet");
  ok("build-for medium → matcher leaf opus", resolveBuildModel(full, "medium").token === "opus");
  ok("build-for HIGH (case-insensitive) → sonnet", resolveBuildModel(full, "HIGH").token === "sonnet");
  ok("unknown conf → default bucket (opus)", resolveBuildModel(full, "zzz").token === "opus");
  ok("null conf → default bucket (opus)", resolveBuildModel(full, null).token === "opus");
  // fallback precedence: leaf absent → default → scalar → inherit
  ok("no leaf, has default → default", resolveBuildModel({ models: { build: "haiku", build_by_confidence: { default: "fable", high: "sonnet" } } }, "medium").token === "fable");
  ok("no leaf, no default → scalar models.build", resolveBuildModel({ models: { build: "haiku", build_by_confidence: { high: "sonnet" } } }, "medium").token === "haiku");
  ok("no matcher, has scalar → scalar (per-run FAFF-315 path)", resolveBuildModel({ models: { build: "fable" } }, "high").token === "fable");
  ok("no matcher, no scalar → inherit", resolveBuildModel({ models: {} }, "high").token === "inherit");
  ok("empty cfg → inherit", resolveBuildModel({}, "high").token === "inherit");
  // fail-loud on an invalid resolved token — never a silent inherit
  ok("invalid matcher leaf token fails loud", !!resolveBuildModel({ models: { build_by_confidence: { high: "gpt-5" } } }, "high").error);
  ok("invalid scalar fallback fails loud", !!resolveBuildModel({ models: { build: "gpt-5" } }, "zzz").error);
  ok("low leaf tolerated (inert but valid token)", resolveBuildModel({ models: { build_by_confidence: { low: "haiku", default: "opus" } } }, "low").token === "haiku");
  // fail-loud ANYWHERE — an invalid token in a NOT-dispatched leaf is caught, never left dormant
  ok("invalid UNUSED leaf fails loud (validate anywhere, not just resolved)",
    !!resolveBuildModel({ models: { build_by_confidence: { high: "gpt-5", default: "opus" } } }, "medium").error);
  // case-insensitive YAML leaf key — a capitalised `High:` must not silently miss → default
  ok("capitalised YAML leaf key (High:) resolves case-insensitively",
    resolveBuildModel({ models: { build_by_confidence: { High: "sonnet", default: "opus" } } }, "high").token === "sonnet");
  // read-time matcher-leaf validation (validateModelLane extension)
  ok("validateModelLane accepts a valid matcher leaf", validateModelLane("models.build_by_confidence.high", "sonnet") === null);
  ok("validateModelLane rejects an invalid matcher leaf", validateModelLane("models.build_by_confidence.high", "gpt-5") !== null);
  ok("validateModelLane accepts the default leaf", validateModelLane("models.build_by_confidence.default", "opus") === null);
  ok("validateModelLane leaves models.build scalar unchanged", validateModelLane("models.build", "sonnet") === null && validateModelLane("models.build", "gpt-5") !== null);
  // FAFF-417: models.build_by_tier layers ahead of models.build_by_confidence — tier wins
  const layered = { models: { build: "opus", build_by_tier: { mechanical: "haiku", default: "fable" }, build_by_confidence: { default: "opus", high: "sonnet" } } };
  ok("tier matcher outranks confidence matcher when both configured and tier present",
    resolveBuildModelForIssue(layered, "mechanical", "high").token === "haiku");
  ok("tier matcher default leaf still outranks confidence matcher",
    resolveBuildModelForIssue(layered, "standard", "high").token === "fable");
  ok("no tier passed → falls through to the confidence matcher (still resolves)",
    resolveBuildModelForIssue(layered, null, "high").token === "sonnet");
  ok("tier passed but matcher unconfigured → falls through to the confidence matcher",
    resolveBuildModelForIssue({ models: { build: "opus", build_by_confidence: { default: "opus", high: "sonnet" } } }, "mechanical", "high").token === "sonnet");
  ok("no tier, no confidence matcher → falls through to the scalar",
    resolveBuildModelForIssue({ models: { build: "fable" } }, null, null).token === "fable");
  ok("invalid tier-matcher leaf fails loud, even on a tier that never resolves",
    !!resolveBuildModelForIssue({ models: { build_by_tier: { mechanical: "gpt-5", default: "opus" } } }, "standard", null).error);
  ok("invalid tier-matcher leaf fails loud with NO tier passed at all (validate anywhere)",
    !!resolveBuildModelForIssue({ models: { build_by_tier: { mechanical: "gpt-5" } } }, null, null).error);
  // FAFF-705: the transport effort mapping (five-level faff → three-level transport, clamp above ceiling)
  ok("reasoningEffortForTransport: low/medium/high pass through", reasoningEffortForTransport("low") === "low" && reasoningEffortForTransport("medium") === "medium" && reasoningEffortForTransport("high") === "high");
  ok("reasoningEffortForTransport: xhigh/max clamp to high", reasoningEffortForTransport("xhigh") === "high" && reasoningEffortForTransport("max") === "high");
  ok("EFFORT_GRADED_FAMILIES: openai + codex graded, ollama not", EFFORT_GRADED_FAMILIES.has("openai") && EFFORT_GRADED_FAMILIES.has("codex") && !EFFORT_GRADED_FAMILIES.has("ollama"));
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (models build-for resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { CONFIG_SPEC, CONFIG_SURFACE, DEFAULTS, EFFORT_GRADED_FAMILIES, EFFORT_LANE_VOCAB, ENGINE_CALL_LANES, ENGINE_PROVIDER_FAMILY, GIT_HOST_ALLOWLIST, INIT_HEADER, ISOLATION_LANE_VOCAB, MODEL_LANE_VOCAB, SEQUENCE_VALUED_KEYS, TRACKING_KEYS, VALID_APPETITES, WRITABLE_NAMESPACES, cmdConfig, cmdConfigCheck, cmdConfigInit, cmdConfigSet, cmdModels, computeConfigCheck, configCheckSelftest, configInitSelftest, configSetSelftest, configVerbList, emitChainBlock, emitScalar, emitTrackingBlock, fmt, loadConfig, mergeConfigPath, mergeTrackingBlock, modelsSelftest, reasoningEffortForTransport, redactSecret, resolveAdrDocsPath, resolveAppetite, resolveBuildModel, resolveBuildModelForIssue, resolveBuildModelForTier, resolveConvergence, resolveDocsPath, resolveEngineForLane, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, resolveSpikeDocsPath, scanDocForSecrets, secretScanLeaf, validateEffortLane, validateEngineRef, validateGitHostValue, validateIsolationLane, validateModelLane };
