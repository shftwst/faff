// ===========================================================================
// === region:factory — config-core — the DEFAULTS registry, loadConfig, the docs-path and templates-path resolvers, and the git posture probes ===
// ===========================================================================
// FAFF-1389: split out of config.js, which re-exports every name below that it exported before.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { deepMergeConfig, dig, findConfig, findOverlay, isInsideRoot, readBaseConfigStrict, parseOverlayStrict } = require("./shared-infra");

// FAFF-182: the single source of truth for config defaults, keyed by dotted config path.
// `config get <key>` applies these so no caller (skill prose) ever supplies a default via `-d` —
// a prose-supplied default can be forgotten/mistyped/shortcut (the slot-dispatch bug). Slots are
// entries here too (slots are just config-path keys). Computed defaults (spec-docs-path, eligible,
// next, worktree_root) keep their own resolvers — this registry is for simple-scalar + slot defaults.

const DEFAULTS = {
  "slots.intake": "faffter-noon-intake",
  "slots.spec": "faffter-noon-spec",
  "slots.spec_review": "faffter-noon-spec-review",
  "slots.adr": "faffter-noon-adr",
  "slots.architecture": "faffter-noon-architecture",
  "slots.env": "faffter-noon-env-compose",
  "slots.env-code-interface": "faffter-noon-env-code-interface",
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
  // FAFF-1044: the control-label prefix. Every control label's rendered name is
  // `<label_prefix>-<role>` (see `controlLabels` in labels.js) — the default keeps
  // zero-config behaviour byte-identical to the historical hardcoded `faff-*` names.
  // Validated by validateLabelPrefix at get/set/init (a bad value fails loud, never a
  // half-valid label). Changing this on a repo with live tickets is a coordinated
  // human relabel — faff persists no prior value and ships no migration tooling (ADR
  // "Control-label prefix is set-at-adoption").
  "tracking.label_prefix": "faff",
  "appetite": "high",
  // FAFF-877: the bounded milestone-tick cadence a dispatched producer subagent (plot
  // decompose, a prep spec producer) MUST honour when ticking `faff heartbeat <run_dir>`
  // — strictly below sentry.stall_window_secs (default 900s; this default sits well
  // under half of that). See gateway → Sibling-skill invocation → Producer dispatch —
  // the LOAD-BEARING liveness defence for a nested producer whose own sub-calls fall
  // back in-context (never fork to a supervised `faff engine call`).
  "producer_tick_max_secs": "600",
  // FAFF-1128: the Node reflection bridge's per-request timeout (seconds). Bounds a single
  // open/call/call_static invocation's thenable await so a never-settling SUT op fails fast as a
  // dispatch_timeout WireError instead of wedging the session for the process lifetime. The
  // composing occupant (FAFF-1105 follow-on) reads this and passes it as --request-timeout-secs;
  // the bridge itself is config-resolution-free and pass-through when the flag is absent. 120s is
  // generous for one reflected op yet well below any run-level deadline (evaluator --deadline / env
  // teardown SLA), so it fail-fasts before run teardown.
  "bridge.request_timeout_secs": "120",
  // FAFF-1041: repo-convention discovery (branch naming / commit-subject / PR-title grammar) —
  // the DEFAULT tier only. `conventions.js`'s own resolver reads these via `dig` directly (raw,
  // undefined when genuinely unset) rather than through `config get`'s DEFAULTS-applying `get`
  // verb, so registering these here affects ONLY `faff config get conventions.*` / `config
  // resolved` / `config check` — never the precedence tiering inside `faff conventions get`
  // itself (explicit > documented > a discovered CI gate > history-inferred > this default).
  "conventions.branch_naming": "issue-slug",
  "conventions.commit_subject": "conventional",
  "conventions.pr_title": "conventional",
  "conventions.history_window": "200",
  "conventions.history_dominance": "0.7",
  "adr.mode": "offer",
  // FAFF-1048: FAFF-1042's whether-to-relocate boolean under adr.* is retired. Where a superseded
  // ADR lands is now the sole control — `tracking.adr_superseded_docs_path` (registered in
  // TRACKING_KEYS below, read by adr.js's supersededDir); unset => the active ADR dir, so nothing
  // relocates. Whether is derived from where, so the boolean had nothing left to decide.
  "intake_gate": "warn",
  // FAFF-536: the self-hosting core-defect intake lane. Default false ⇒ the lane is off and the
  // filing chokepoint is byte-identical to today (an outward item is always outward-new-root). Set
  // true ONLY in the self-hosting repo (faff building faff) to let a concrete same-tracker-team
  // outward defect reclassify as `outward-self-intake` and file to the Backlog self-intake lane
  // bucket — a NEW classification computed at the chokepoint, never a floor edit (ADR-0079). Both
  // this opt-in AND the same-team structural check must hold; each is fail-closed to outward-new-root.
  "containment.self_hosting_intake": "false",
  "gates.fallback": "fail-closed",
  // FAFF-849 (639b): the execution ladder consumes the wider recognised set (848's reporting
  // recogniser), bounded by these knobs. gates.partial decides whether below-threshold runnable
  // coverage warns (default) or gates needs-human; max_rungs_per_kind caps the per-kind blast
  // radius; partial_threshold promotes 848's hardcoded PARTIAL_COVERAGE_THRESHOLD to config.
  // (gates.exclude — the per-repo opt-out list — is read via dig, not a DEFAULTS scalar, mirroring
  // install.skill_targets.)
  "gates.partial": "warn",
  "gates.max_rungs_per_kind": "5",
  "gates.partial_threshold": "0.5",
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
  // ADR-0133: the eval harness's settings, in their own block (eval is not a dispatch lane), read by
  // eval/run-evals.mjs (the --model / --effort flags win). eval.model is the frontier driver's pinned
  // default, never the account default (budget guard); eval.effort "inherit" passes no --effort flag.
  // Both are part of a baseline's lineage.
  "eval.model": "claude-sonnet-4-6",
  "eval.effort": "inherit",
  // FAFF-403: bounded retry count for graft's retry-later/awaiting-review hold on a mandatory-review
  // `unavailable` (provider-outage) verdict — graft's own namespace (it owns the disposition loop;
  // adversarial.* configures the engine call, not loop policy). After this many held
  // drains still unavailable, the arm escalates to the standard needs-human park (never silent-forever).
  "graft.review_outage_retry_limit": "3",
  // FAFF-1077: opt-in branch-stacking for an in-run dependent whose dependency landed pr-open.
  // The concurrency occupant READS it (graft owns the worktree/rebase mechanics the knob drives),
  // in graft's own namespace, mirroring graft.review_outage_retry_limit above. "off" (DEFAULT)
  // parks the dependent exactly as today — byte-identical: no stack anchor, no faff-stacked label,
  // no dependency_gate leg, worktrees off origin/<default>. "stack" builds the dependent on the
  // dependency's branch and arms the merge-order interlock. Any value other than "stack" resolves
  // to "off" at the reader (the occupant), so a typo fails safe to today's park behaviour.
  "graft.dependency_wait": "off",
  // FAFF-900: prep's spec-review-outage disposition loop — the prep-altitude twin of
  // graft.review_outage_retry_limit above, in its OWN `prep.*` namespace (prep owns this loop, as
  // graft owns its own). Two SEPARATE ceilings bound two different time-scales:
  //   spec_review_outage_retry_limit — the IN-TURN ceiling (default 2): re-attempts inside a single
  //     turn, riding out a transient 429 chain without ever ending the turn between attempts.
  //   spec_review_outage_hold_limit  — the CROSS-DRAIN ceiling (default 3): how many held drains a
  //     persistent outage may accrue before prep escalates to a needs-human park.
  "prep.spec_review_outage_retry_limit": "2",
  "prep.spec_review_outage_hold_limit": "3",
  // FAFF-950: prep's spec-review TURN-BUDGET hand-back — the healthy-slow twin of the outage
  // loop above. When a slow-but-healthy fan-out would exceed the prep subagent's turn, prep bounds
  // it by a wall-clock and hands back a resumable review-pending hold (cause "turn-budget") instead
  // of dying mid-fan-out. Two knobs, mirroring the outage pair:
  //   spec_review_turn_budget_secs        — the fan-out DEADLINE (default 300): the wall-clock
  //     bounding the in-turn fan-out attempt(s), set below the harness turn ceiling with headroom
  //     for the hand-back write. A conservative starting default, tuned by the felt-pain loop.
  //   spec_review_turn_budget_hold_limit  — the CROSS-DRAIN ceiling (default 3): how many
  //     turn-budget held drains may accrue before prep escalates to a needs-human park. Its counter
  //     (turn_budget_holds) is independent of the outage hold's, so the two never mask each other.
  "prep.spec_review_turn_budget_secs": "300",
  "prep.spec_review_turn_budget_hold_limit": "3",
  // FAFF-941: the spec-review JUDGE dispatch's IN-TURN transport-outage retry ceiling (default 2) —
  // the judge twin of spec_review_outage_retry_limit above. The judge is dispatched once per
  // would-be-park; without a bounded retry a single transient transport blip (an EXIT.UNREACHABLE /
  // EXIT.DEADLINE outage exhausting the judge chain) parks the whole pass to needs-human. A distinct
  // key keeps the reviewer and judge dispatches independently tunable.
  "prep.spec_review_judge_retry_limit": "2",
  // FAFF-996: the build-review dialogue loop's config gate — default on for autonomous. `false`
  // lets an operator disable the whole dialogue-loop-plus-judge port and fall back to today's
  // unconditional critical->needs-human escalation. Interactive graft ignores this key entirely
  // (the dialogue loop is skipped wholesale regardless).
  "graft.build_review_judge": "true",
  // FAFF-996: the REBUTTAL-ONLY round ceiling — deliberately tighter and INDEPENDENT of the
  // appetite-scaled fix-round cap (review-iteration-cap). A rebuttal round changes only the
  // argument, never the diff, so an unbounded stream of rebuttals is the exact vector for
  // arguing the reviewer around; exceeding this cap routes the standing critical straight to the
  // blind judge (p-01).
  "graft.review_rebuttal_round_cap": "1",
  // FAFF-996 (p-08): the author rebuttal length ceiling, enforced at round-record write. An
  // over-length rebuttal is rejected (that finding parks, admit:false) rather than
  // truncated-then-admitted.
  "graft.rebuttal_max_chars": "4000",
  // FAFF-996 (p-07): the built-but-not-admitted cross-turn hold's bound — a per-issue counter
  // persisted in the resume stash. Hold N+1 fails safe to a human park instead of re-queueing
  // forever, so a build that never produces a founded answer in budget cannot loop Todo<->hold.
  "graft.build_review_hold_limit": "2",
  // FAFF-996: the build-judge dispatch's IN-TURN transport-outage retry ceiling — the build-side
  // twin of prep.spec_review_judge_retry_limit above. UNREACHABLE/DEADLINE exits retry up to this
  // bound before that finding parks; every other non-OK exit parks directly (never retried). Read
  // in-process by `build-judge-evidence --assemble`; a valid `--retry-limit` flag wins.
  "graft.build_judge_retry_limit": "2",
  // FAFF-1246: the per-call wall-clock budget (seconds) of one `build-judge-evidence --assemble`
  // invocation. It stops before any attempt that would not fit (the first attempt of a call always
  // runs), persists its ledger and exits 3 so faff-graft re-invokes it; a valid `--budget-secs` flag
  // wins. Keep it under graft's 600s foreground Bash cap and at or above adversarial.build_judge.deadline + 30.
  "graft.build_judge_call_budget_secs": "540",
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
  // FAFF-1213: the runner-GitHub-identity handles. Both default ABSENT (empty string) —
  // absent `runner_github_token_env` is zero-config (faff touches no gh environment, the ambient
  // human token path, byte-identical to today). `runner_github_token_env` NAMES an env var whose
  // VALUE is the opaque bearer token (never stored in config, read fresh per gh call); the
  // `_env`-suffixed handle convention mirrors api_key_env / seat_token_env. `runner_github_login`
  // is the optional expected login of the runner identity. Registry entries drive `config get`'s
  // DISPLAY value (empty string, exit 0); the gh chokepoint reads the raw config, not DEFAULTS.
  "autonomous.runner_github_token_env": "",
  "autonomous.runner_github_login": "",
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
  // FAFF-894: the dispatched build lane's isolation declaration. Declaration-only for custody — a
  // build-lane lane-boundary.json flips laneBoundaryDispatchState to "dispatched" (custody required)
  // but never arms the evaluator cage (laneBoundaryPromisesCage is evaluator-keyed). "shared"/"local"
  // is the honest "runs locally with the repo present in its worktree" declaration.
  "lanes.build.isolation.container": "shared",
  "lanes.build.isolation.host": "local",
  // FAFF-1061: opt-in interactive high-assurance verification. Three fail-closed boolean leaves,
  // one per verification leg, resolved via literalTrue by resolveInteractiveVerification below.
  // Default "false" so a config fault can never switch verification on, and — because the resolver
  // short-circuits to all-false for any unattended run — an existing unattended (L3/L4) run never
  // reads these. These are a VERIFICATION-confidence axis only; enabling a leg confers NO unattended
  // acting authority (the FAFF-717 autonomous.* axis is untouched). DISPLAY value for `config get`.
  "verification.holdout": "false",
  "verification.spec_review": "false",
  "verification.code_review": "false",
};
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
// doc/ when only doc/ exists). An explicit override wins; otherwise, when
// `fallbackRel` is supplied it is the unset default (FAFF-1048 — used by the
// superseded-ADR key so an unset key resolves to the RESOLVED ADR directory,
// never a literal `docs/adr` that would diverge under a customised
// tracking.adr_docs_path); otherwise prefer an existing docs/, then doc/,
// defaulting to docs/<subdir>. The five pre-FAFF-1048 bindings pass no
// `fallbackRel`, so their resolution is byte-identical.
function resolveDocsPath(root, data, create, configKey, subdir, fallbackRel) {
  let rel;
  const val = dig(data, configKey);
  if (val) rel = String(val).trim().replace(/\/+$/, "");
  else if (fallbackRel != null) rel = String(fallbackRel).replace(/\/+$/, "");
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
// FAFF-1048: where a SUPERSEDED ADR comes to rest. Read by adr.js's supersededDir(); registered
// in config.js beside its five docs-path siblings. UNSET => the resolved ADR directory itself
// (the collapsed case — nothing to relocate to, so a supersession stays in-place), which is why
// it passes `resolveAdrDocsPath(...)` as the explicit fallbackRel rather than a `docs/`-ladder
// subdir. SET => that directory (trimmed, trailing slash stripped). The `subdir` arg is null:
// the fallbackRel branch always fires when the key is unset, so the ladder is never reached.
const resolveAdrSupersededDocsPath = (root, data, create) =>
  resolveDocsPath(root, data, create, "tracking.adr_superseded_docs_path", null, resolveAdrDocsPath(root, data, false));

// FAFF-1300: where committed template overrides live (the ADR template, the native-template map,
// the per-type <type>.md files). The one owner of the canonical-first, deprecated-fallback rule.
const TEMPLATES_CANONICAL_REL = ".faff/templates";
const TEMPLATES_DEPRECATED_REL = ".faff-templates";
const TEMPLATES_DEPRECATED_MSG =
  "faff: template overrides at .faff-templates/ are deprecated; move them to .faff/templates/\n" +
  "      (`git mv .faff-templates .faff/templates`) or set tracking.templates_path.";
const TEMPLATES_SHADOWED_MSG =
  "faff: overrides at .faff-templates/ are deprecated and are now ignored; .faff/templates/ wins.\n" +
  "      Move any file you still need into .faff/templates/, then delete .faff-templates/.\n" +
  "      Do not `git mv` the whole directory: .faff/templates/ already exists, so the move\n" +
  "      would nest it as .faff/templates/.faff-templates/.";
let templatesNoticeEmitted = false;
function resetTemplatesDeprecationNotice() { templatesNoticeEmitted = false; }
function emitTemplatesDeprecationNotice(state) {
  if (templatesNoticeEmitted) return;
  templatesNoticeEmitted = true;
  process.stderr.write((state === "shadowed" ? TEMPLATES_SHADOWED_MSG : TEMPLATES_DEPRECATED_MSG) + "\n");
}
// The directory a WRITER targets: the configured key, else the canonical directory. Never the
// deprecated one, so a write cannot land where the resolver is about to stop looking.
function resolveTemplatesWritePath(data) {
  const val = dig(data, "tracking.templates_path");
  return val ? String(val).trim().replace(/\/+$/, "") : TEMPLATES_CANONICAL_REL;
}
// The deprecated directory a writer should check for a file that would be shadowed, or null when
// the key is configured (a configured value never consults the deprecated directory).
function deprecatedTemplatesRel(data) {
  return dig(data, "tracking.templates_path") ? null : TEMPLATES_DEPRECATED_REL;
}
function templatesFallbackRel(root) {
  const canon = fs.existsSync(path.join(root, TEMPLATES_CANONICAL_REL));
  const depr = fs.existsSync(path.join(root, TEMPLATES_DEPRECATED_REL));
  if (canon && depr) return [TEMPLATES_CANONICAL_REL, "shadowed"];
  if (canon) return [TEMPLATES_CANONICAL_REL, "canonical"];
  if (depr) return [TEMPLATES_DEPRECATED_REL, "fallback"];
  return [TEMPLATES_CANONICAL_REL, "absent"];
}
// Not built on resolveDocsPath's fallbackRel: that argument is evaluated eagerly, so a configured
// key would still trigger the deprecation notice.
function resolveTemplatesPath(root, data, create) {
  let rel;
  const val = dig(data, "tracking.templates_path");
  if (val) rel = String(val).trim().replace(/\/+$/, "");
  else {
    const [fallbackRel, state] = templatesFallbackRel(root);
    rel = fallbackRel;
    if (state === "fallback" || state === "shadowed") emitTemplatesDeprecationNotice(state);
  }
  if (create) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return rel;
}

const toPosix = (p) => p.split(path.sep).join("/");
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

// A file inside the operating root is named by its repo-relative POSIX path; one resolved
// through the main-worktree fallback has no repo-relative path here and keeps its absolute path.
function configFileLabel(root, p) {
  if (!p) return null;
  return isInsideRoot(root, p) ? toPosix(path.relative(root, p)) : p;
}


module.exports = { configFileLabel, DEFAULTS, deprecatedTemplatesRel, fmt, gitInRepo, gitIsIgnored, gitIsTracked, loadConfig, resetTemplatesDeprecationNotice, resolveAdrDocsPath, resolveAdrSupersededDocsPath, resolveDocsPath, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, resolveSpikeDocsPath, resolveTemplatesPath, resolveTemplatesWritePath, TEMPLATES_CANONICAL_REL, TEMPLATES_DEPRECATED_MSG, TEMPLATES_DEPRECATED_REL, TEMPLATES_SHADOWED_MSG, toPosix };
