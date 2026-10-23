// ===========================================================================
// === region:factory — config — resolve / read .faffrc (YAML subset, no deps) ===
// ===========================================================================
// FAFF-1389: the facade. The config surface lives in config-core, config-dispatch, config-resolve,
// config-write, config-write-selftest and config-check; this module keeps the `faff config` CLI
// (CONFIG_SPEC, CONFIG_SURFACE, cmdConfig) and re-exports every name it exported before the split.

const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { CANONICAL_CONFIG, CANONICAL_OVERLAY_CONFIG, dig, findConfigLocation, findOverlayLocation, findRoot } = require("./shared-infra");
const { cmdConfigCheck, computeConfigCheck, configCheckSelftest, redactSecret, scanDocForSecrets, secretScanLeaf } = require("./config-check");
const { DEFAULTS, TEMPLATES_CANONICAL_REL, TEMPLATES_DEPRECATED_MSG, TEMPLATES_DEPRECATED_REL, TEMPLATES_SHADOWED_MSG, deprecatedTemplatesRel, fmt, loadConfig, resetTemplatesDeprecationNotice, resolveAdrDocsPath, resolveAdrSupersededDocsPath, resolveDocsPath, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, resolveSpikeDocsPath, resolveTemplatesPath, resolveTemplatesWritePath } = require("./config-core");
const { AGENT_MODEL_TOKENS, DISPATCH_LANES, EFFORT_GRADED_FAMILIES, EFFORT_LEVELS_WITH_INHERIT, ENGINE_CALL_LANES, ENGINE_PROVIDER_FAMILY, legacyTreeError, legacyTreeGuard, pickDispatchField, prepareDispatch, printDispatchBanner, reasoningEffortForTransport, removedKeyError, resolveBuildModel, resolveEngineForLane, validateDispatchKey, validateDispatchTree, validateEngineRef, validateEvalKey } = require("./config-dispatch");
const { GIT_HOST_ALLOWLIST, ISOLATION_LANE_VOCAB, VALID_APPETITES, cmdVerification, resolveAppetite, resolveControlLabels, resolveConvergence, resolveInteractiveVerification, resolveLabelPrefix, resolveTeams, validateControlLabelName, validateGitHostValue, validateIsolationLane, validateLabelPrefix, validateTeams } = require("./config-resolve");
const { INIT_HEADER, SEQUENCE_VALUED_KEYS, TRACKING_KEYS, WRITABLE_NAMESPACES, cmdConfigInit, cmdConfigSet, cmdConfigUnset, emitChainBlock, emitScalar, emitTrackingBlock, mergeConfigPath, mergeTrackingBlock, printLocationNotice, removeConfigPath } = require("./config-write");
const { configInitSelftest, configSetSelftest, configUnsetSelftest } = require("./config-write-selftest");

// Union across every `config` sub-verb (path|get|set|check|init and the docs-path resolvers). The gate
// rejects unknown flags / missing values; each sub-verb's own body reads the validated flags below.
const CONFIG_SPEC = { flags: {
  "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--force": { arity: 0 }, "--dry-run": { arity: 0 }, "--create": { arity: 0 }, "--absolute": { arity: 0 },
  // FAFF-1062: --local redirects `config init`/`config set` to the gitignored overlay
  // (CANONICAL_OVERLAY_CONFIG) instead of the committable base (CANONICAL_CONFIG) — every
  // other sub-verb ignores it (accepted at the shared gate, unread elsewhere).
  "--local": { arity: 0 },
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
    "adr-superseded-docs-path": { required_flags: [] },
    "spike-docs-path": { required_flags: [] },
    "templates-path": { required_flags: [] },
    dump: { required_flags: [] },
    init: { required_flags: [] },
    resolved: { required_flags: [] },
    set: { required_flags: [] },
    unset: { required_flags: [] },
  },
};
// FAFF-667: both usage strings (the flag-gate failure and the unknown/missing-subcommand
// message) derive their verb list from here, sorted, so they can never diverge from the
// dispatcher or from each other.
function configVerbList() {
  return Object.keys(CONFIG_SURFACE.subcommands).sort().join("|");
}

function cmdConfig(args) {
  // FAFF-576: fail-closed flag gate across all sub-verbs — an unknown flag / missing value exits 2
  // here; each sub-verb's body below reads validated flags via its own (positional-aware) scan.
  const gate = parseArgs(args, CONFIG_SPEC);
  if (gate.errors.length) return usageError(gate.errors, `usage: faff config <${configVerbList()}> [KEY [VALUE]] [-d DEFAULT] [--json] [--set K=V] [--force] [--dry-run] [--local] [--root DIR]`);
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
      const baseLocation = findConfigLocation(root);
      const overlayLocation = findOverlayLocation(root);       // may throw legacy-overlay-config-name
      if (baseLocation === null && overlayLocation === null) return 3;
      if (baseLocation !== null) console.log(baseLocation.path);
      if (overlayLocation !== null) console.log(overlayLocation.path);
      printLocationNotice(root, baseLocation, "base");         // FAFF-1302: stderr only
      printLocationNotice(root, overlayLocation, "overlay");
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
      const removedErr = removedKeyError(key);
      if (removedErr) { process.stderr.write(removedErr + "\n"); return 2; }
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
      // FAFF-315: dispatch model lanes have a closed vocabulary — an invalid configured
      // value fails loud here (exit 2), never a silent inherit at the dispatch site.
      // FAFF-430: tracking.git_host reuses the same read-time seam — a non-github value
      // fails loud here too, never a silently GitHub-shaped merge gate.
      const laneErr = validateEvalKey(key, fmt(value)) || validateDispatchKey(key, value) || validateGitHostValue(key, fmt(value)) || validateLabelPrefix(key, fmt(value)) || validateControlLabelName(key, fmt(value)) || validateIsolationLane(key, fmt(value));
      if (laneErr) { process.stderr.write(laneErr + "\n"); return 2; }
      // FAFF-422: an allowlisted engine value also resolves its engines.<name> reference at
      // read — a dangling name / missing field / illegal provider fails loud HERE, not at
      // the first dispatch that happens to touch the lane.
      if (/^dispatch\.(methodology|intake)\.model$/.test(key) && /^engine:/.test(fmt(value))) {
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
          "logging", "concurrency_max", "appetite", "adr.mode", "intake_gate",
          "containment.self_hosting_intake",
          "gates.fallback",
          // FAFF-849 (639b): the execution-ladder bounding knobs.
          "gates.partial", "gates.max_rungs_per_kind", "gates.partial_threshold",
          "post_merge.check", "budget.at_ceiling",
          "eval.model", "eval.effort",
          // FAFF-403: graft's outage-retry-later bound (graft.* namespace — graft owns the loop).
          "graft.review_outage_retry_limit",
          // FAFF-900: prep's spec-review-outage disposition bounds (prep.* namespace — prep owns
          // this loop, symmetric with graft's above): the in-turn ceiling and the cross-drain hold ceiling.
          "prep.spec_review_outage_retry_limit", "prep.spec_review_outage_hold_limit",
          // FAFF-941: the spec-review judge dispatch's in-turn transport-outage retry ceiling.
          "prep.spec_review_judge_retry_limit",
          // FAFF-996: the build-review dialogue loop's config gate + its four bounding knobs.
          "graft.build_review_judge", "graft.review_rebuttal_round_cap", "graft.rebuttal_max_chars",
          "graft.build_review_hold_limit", "graft.build_judge_retry_limit", "graft.build_judge_call_budget_secs",
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
          // FAFF-894: the build lane's isolation defaults (declaration-only for custody).
          "lanes.build.isolation.container", "lanes.build.isolation.host",
        ];
        const missing = expected.filter((k) => !Object.prototype.hasOwnProperty.call(DEFAULTS, k));
        if (missing.length) { process.stderr.write(`config defaults --selftest: missing ${missing.join(", ")}\n`); return 1; }
        // The dispatch vocabulary must accept every lane's legal tokens, reject off-vocabulary
        // ones, and keep engine values to the pure-data-in allowlist (the fail-loud path is the point).
        const pairsOf = (...layers) => legacyTreeError(layers.map(([file, local, doc]) => ({ file, local, doc })));
        const vocabFail =
          DISPATCH_LANES.map((lane) =>
            validateDispatchKey(`dispatch.${lane}.model`, "sonnet")
            || validateDispatchKey(`dispatch.${lane}.effort`, "max")
            || (validateDispatchKey(`dispatch.${lane}.model`, "gpt-5") ? null : `${lane} lane failed to reject an invalid model token`)
            || (validateDispatchKey(`dispatch.${lane}.effort`, "ultra") ? null : `${lane} lane failed to reject an invalid effort token`)
            || (validateDispatchKey(`dispatch.${lane}.effort`, "sonnet") ? null : `${lane} lane failed to reject a model token as an effort`)
          ).find(Boolean) ||
          validateDispatchKey("dispatch.build.by_confidence.high.model", "sonnet") ||
          (validateDispatchKey("dispatch.build.by_confidence.high.model", "gpt-5") ? null : "matcher leaf failed to reject an invalid token") ||
          validateDispatchKey("dispatch.build.by_tier.mechanical.effort", "low") ||
          (validateDispatchKey("dispatch.build.by_tier.mechanical.effort", "ultra") ? null : "tier matcher leaf failed to reject an invalid token") ||
          (validateEvalKey("eval.model", "any-id-is-fine") ? "eval.model must be open-vocabulary" : null) ||
          (validateEvalKey("eval.effort", "turbo") ? null : "eval.effort failed to reject an invalid token") ||
          (validateEvalKey("eval.model", "engine:studio") ? null : "eval.model failed to reject an engine value") ||
          // FAFF-422: engine values are legal on exactly the pure-data-in allowlist.
          validateDispatchKey("dispatch.methodology.model", "engine:studio") ||
          validateDispatchKey("dispatch.intake.model", "engine:studio") ||
          (validateDispatchKey("dispatch.build.model", "engine:studio") ? null : "build lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateDispatchKey("dispatch.spec.model", "engine:studio") ? null : "spec lane failed to reject an engine value (FAFF-422 allowlist)") ||
          (validateDispatchKey("dispatch.build.by_confidence.high.model", "engine:studio") ? null : "matcher leaf failed to reject an engine value (FAFF-422 allowlist)") ||
          // ADR-0134: the removed models:/effort: keys fail loud naming the dispatch: replacement.
          (removedKeyError("models.eval") && removedKeyError("effort.eval") ? null : "moved eval keys must fail loud") ||
          (removedKeyError("models.spec") === "config models.spec: removed; set dispatch.spec.model instead, then remove the old block with `faff config unset models` (ADR-0134)" ? null : "models.<lane> must map to dispatch.<lane>.model") ||
          (/dispatch\.adr\.effort/.test(removedKeyError("effort.adr")) ? null : "effort.<lane> must map to dispatch.<lane>.effort") ||
          (/dispatch\.build\.by_confidence\.high\.model/.test(removedKeyError("models.build_by_confidence.High")) ? null : "models.build_by_confidence.<c> must map to dispatch.build.by_confidence.<c>.model") ||
          (/dispatch\.build\.by_tier\.complex\.effort/.test(removedKeyError("effort.build_by_tier.complex")) ? null : "effort.build_by_tier.<t> must map to dispatch.build.by_tier.<t>.effort") ||
          (removedKeyError("models") && removedKeyError("effort") && removedKeyError("models.build_by_tier") ? null : "a bare removed tree must fail loud") ||
          (removedKeyError("dispatch.spec.model") === null && removedKeyError("tracking.repo") === null ? null : "a non-removed key must pass") ||
          (pairsOf([".faffrc.yaml", false, { models: { adr: "sonnet" } }]) === ".faffrc.yaml still holds the removed models: tree (ADR-0134); set models.adr -> dispatch.adr.model, then run `faff config unset models`." ? null : "legacyTreeError must name the file, the mapping and the unset command") ||
          (pairsOf([".faffrc.yaml", false, { models: { adr: "sonnet", eval: "x" } }]) === ".faffrc.yaml still holds the removed models: tree (ADR-0134); set models.adr -> dispatch.adr.model, models.eval -> eval.model, then run `faff config unset models`." ? null : "legacyTreeError must map models.eval to eval.model") ||
          (pairsOf([".faffrc.local.yaml", true, { effort: null }]) === ".faffrc.local.yaml still holds the removed effort: tree (ADR-0134); run `faff config unset effort --local`." ? null : "an empty effort: header must omit the set clause and add --local") ||
          (pairsOf([".faffrc.yaml", false, { tracking: {} }]) === null ? null : "a config without a legacy tree must pass") ||
          // FAFF-859: the isolation-lane vocab must accept both axes' baked defaults and reject an
          // off-vocabulary value on each axis (the fail-loud path is load-bearing for the declared field).
          validateIsolationLane("lanes.evaluator.isolation.container", DEFAULTS["lanes.evaluator.isolation.container"]) ||
          validateIsolationLane("lanes.evaluator.isolation.host", DEFAULTS["lanes.evaluator.isolation.host"]) ||
          (validateIsolationLane("lanes.evaluator.isolation.container", "vm") ? null : "isolation container axis failed to reject an off-vocabulary value") ||
          (validateIsolationLane("lanes.evaluator.isolation.host", "moon") ? null : "isolation host axis failed to reject an off-vocabulary value") ||
          // FAFF-894: the build lane's isolation vocab accepts its baked defaults and rejects an
          // off-vocabulary value on each axis, exactly as the evaluator lane's does.
          validateIsolationLane("lanes.build.isolation.container", DEFAULTS["lanes.build.isolation.container"]) ||
          validateIsolationLane("lanes.build.isolation.host", DEFAULTS["lanes.build.isolation.host"]) ||
          (validateIsolationLane("lanes.build.isolation.container", "vm") ? null : "build isolation container axis failed to reject an off-vocabulary value") ||
          (validateIsolationLane("lanes.build.isolation.host", "moon") ? null : "build isolation host axis failed to reject an off-vocabulary value");
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
    if (cmd === "adr-superseded-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveAdrSupersededDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "spike-docs-path") {
      const [data] = loadConfig(root);
      console.log(resolveSpikeDocsPath(root, data, rest.includes("--create")));
      return 0;
    }
    if (cmd === "templates-path") {
      const [data] = loadConfig(root);
      const rel = resolveTemplatesPath(root, data, rest.includes("--create"));
      console.log(rest.includes("--absolute") ? path.join(root, rel) : rel);
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
    if (cmd === "unset") {
      if (rest.includes("--selftest")) return configUnsetSelftest();
      return cmdConfigUnset(rest.slice(1), root);
    }
    if (cmd === "resolved") {
      // FAFF-50: loud, human-readable echo of the resolved NON-default config — what a run
      // actually uses that overrides a built-in default. Print it in run banners so a dropped
      // slot is visible, not silent.
      const [data, p, overlayPath] = loadConfig(root);
      const slots = (data.slots && typeof data.slots === "object" && !Array.isArray(data.slots)) ? data.slots : {};
      const SLOTS = ["intake", "spec", "spec_review", "architecture", "env", "review", "ship", "concurrency", "methodology",
        "routing_adaptor", "rendering_adaptor"];
      printLocationNotice(root, findConfigLocation(root), "base");        // FAFF-1302: stderr only
      printLocationNotice(root, findOverlayLocation(root), "overlay");
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
      // ADR-0133: surface the eval harness's pinned model and effort (a baseline's lineage).
      const evalCfg = (data.eval && typeof data.eval === "object" && !Array.isArray(data.eval)) ? data.eval : {};
      for (const field of ["model", "effort"]) {
        const v = evalCfg[field];
        if (v !== null && v !== undefined && v !== "") console.log(`eval ${field}: ${v}`);
      }
      // FAFF-859: surface a non-default lane-isolation declaration in the run banner — an operator
      // who armed (or will arm) the cage/locality must see it, never silent (the FAFF-50 intent as
      // the slot/model/effort echoes above). Echoed only when the resolved value DIFFERS from the
      // baked default, so an unset repo's banner is byte-for-byte the pre-FAFF-859 form.
      for (const lane of ["evaluator", "build"]) {
        for (const axis of ["container", "host"]) {
          const key = `lanes.${lane}.isolation.${axis}`;
          const v = dig(data, key);
          if (v !== null && v !== undefined && v !== "" && fmt(v) !== DEFAULTS[key]) console.log(`isolation ${lane}.${axis}: ${fmt(v)}`);
        }
      }
      printDispatchBanner(data, legacyTreeGuard(root));
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
      process.stderr.write(`faff config: multiple config files (${names}); keep only one.\n`);
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
    // FAFF-1302: `.faff` exists as a regular file, so a writer cannot create the config under it.
    if (e.code === "EEXIST" || e.code === "ENOTDIR") {
      process.stderr.write(`faff config: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
  process.stderr.write(`faff config: expected one of ${configVerbList()}\n`);
  return 2;
}

module.exports = { CONFIG_SPEC, CONFIG_SURFACE, DEFAULTS, DISPATCH_LANES, EFFORT_GRADED_FAMILIES, ENGINE_CALL_LANES, ENGINE_PROVIDER_FAMILY, GIT_HOST_ALLOWLIST, INIT_HEADER, ISOLATION_LANE_VOCAB, SEQUENCE_VALUED_KEYS, TRACKING_KEYS, VALID_APPETITES, WRITABLE_NAMESPACES, cmdConfig, cmdConfigCheck, cmdConfigInit, cmdConfigSet, cmdConfigUnset, cmdVerification, computeConfigCheck, configCheckSelftest, configInitSelftest, configSetSelftest, configUnsetSelftest, configVerbList, emitChainBlock, emitScalar, emitTrackingBlock, fmt, loadConfig, mergeConfigPath, mergeTrackingBlock, removeConfigPath, reasoningEffortForTransport, redactSecret, resolveAdrDocsPath, resolveAdrSupersededDocsPath, resolveAppetite, resolveBuildModel, resolveConvergence, resolveInteractiveVerification, resolveDocsPath, resolveEngineForLane, resolveControlLabels, resolveLabelPrefix, resolvePrdDocsPath, resolvePrdrDocsPath, resolveSpecDocsPath, resolveSpikeDocsPath, resolveTemplatesPath, resolveTemplatesWritePath, deprecatedTemplatesRel, resetTemplatesDeprecationNotice, TEMPLATES_CANONICAL_REL, TEMPLATES_DEPRECATED_REL, TEMPLATES_DEPRECATED_MSG, TEMPLATES_SHADOWED_MSG, resolveTeams, scanDocForSecrets, secretScanLeaf, validateControlLabelName, validateDispatchKey, validateDispatchTree, validateEngineRef, validateGitHostValue, validateIsolationLane, validateLabelPrefix, validateTeams, AGENT_MODEL_TOKENS, EFFORT_LEVELS_WITH_INHERIT, legacyTreeError, legacyTreeGuard, pickDispatchField, prepareDispatch, removedKeyError };
