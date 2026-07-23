// FAFF-132/FAFF-133/FAFF-134 — preset-wiring tests for the eval CLI driver. PURE: imports
// buildInvocation / the *Opts factories / resolveDriver / loadTidyJudgementProse and asserts the
// resolved args / extracted prose with ZERO spawning. The real `claude -p` driver is never invoked
// here — eval/ stays out of the real-call path (FAFF-131 runs that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, frontierDriver, localDriver, frontierOpts, localOpts, DEFAULT_PLUGIN_DIR, loadTidyJudgementProse, loadSynthesisGlossProse, loadJudgementCriteria, forwardCredentials, loadConfidenceRubricProse, loadMarkerDialectProse, loadReconciliationProse, criteriaFor, buildEvalPrompt, loadReviewVerdictProse, VERDICT_REVERT_INSTRUCTION, loadTidyChainGapProse, loadHoldoutJudgementProse } from "../eval/cli-driver.mjs";
import { resolveDriver, resolveLocalParams, resolvePluginDir } from "../eval/run-evals.mjs";

// --- buildInvocation: local preset wires --model + the ollama Anthropic-API env redirect ---
test("local invocation appends --model and injects the ollama redirect env", () => {
  const baseUrl = "http://studio.longhair-escalator.ts.net:11434";
  const inv = buildInvocation(
    { bin: "claude", model: "qwen3.6:27b-mlx", baseUrl,
      env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "" } },
    "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--model", "qwen3.6:27b-mlx"]);
  assert.equal(inv.env.ANTHROPIC_BASE_URL, baseUrl);
  assert.equal(inv.env.ANTHROPIC_AUTH_TOKEN, "ollama");
  assert.equal(inv.env.ANTHROPIC_API_KEY, "");
  assert.equal(inv.env.CLAUDE_CONFIG_DIR, "/tmp/cfg");
});

// --- buildInvocation: frontier preset adds NOTHING beyond CLAUDE_CONFIG_DIR (no model, no redirect) ---
// Asserted env-agnostically: the only key that differs from process.env is CLAUDE_CONFIG_DIR, so the
// claim "frontier hits api.anthropic.com — no ANTHROPIC_* injected" holds regardless of ambient env.
test("frontier invocation injects nothing beyond CLAUDE_CONFIG_DIR", () => {
  const inv = buildInvocation({ bin: "claude" }, "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT"]); // no --model
  const changed = Object.keys(inv.env).filter((k) => process.env[k] !== inv.env[k]);
  assert.deepEqual(changed, ["CLAUDE_CONFIG_DIR"]);
});

// --- localDriver preset refuses to build without a base URL (no localhost default) ---
test("localDriver throws without a base URL", () => {
  assert.throws(() => localDriver({ model: "m" }), /base.?url|no localhost default/i);
});

// --- FAFF-138: credential forwarding — frontier copies, local must NOT (security), best-effort on missing ---
test("frontierOpts forwards creds; localOpts does not (never leak Anthropic creds to ollama)", () => {
  assert.equal(frontierOpts().forwardCreds, true);
  assert.equal(localOpts({ baseUrl: "http://h:11434", model: "m" }).forwardCreds, false);
});

test("forwardCredentials copies .credentials.json into cfgDir for frontier, locked to 0600", () => {
  const calls = [];
  const chmods = [];
  const copyFile = (from, to) => calls.push([from, to]);
  const chmod = (p, mode) => chmods.push([p, mode]);
  const dst = forwardCredentials("/cfg", frontierOpts(), { copyFile, chmod, env: { CLAUDE_CONFIG_DIR: "/src" } });
  assert.deepEqual(calls, [["/src/.credentials.json", "/cfg/.credentials.json"]]);
  assert.deepEqual(chmods, [["/cfg/.credentials.json", 0o600]]); // owner-only on the copy
  assert.equal(dst, "/cfg/.credentials.json");
});

test("forwardCredentials is a no-op for the local preset (forwardCreds:false)", () => {
  let called = false;
  const dst = forwardCredentials("/cfg", localOpts({ baseUrl: "http://h:11434", model: "m" }), { copyFile: () => { called = true; }, env: {} });
  assert.equal(called, false);
  assert.equal(dst, null);
});

test("forwardCredentials is best-effort: a missing creds file returns null, no throw", () => {
  const dst = forwardCredentials("/cfg", { forwardCreds: true, credentialsSource: "/nope" }, {
    copyFile: () => { throw new Error("ENOENT"); }, env: {},
  });
  assert.equal(dst, null);
});

// --- the CLI selector defaults to frontier and fails loud for an underspecified local run ---
const PRESETS = { frontierDriver, localDriver };

test("resolveDriver defaults to frontier when --driver is absent", () => {
  // frontierDriver returns a closure (a function) — proves selection without spawning.
  assert.equal(typeof resolveDriver([], PRESETS), "function");
});

test("resolveDriver(--driver local) without a base URL throws an explicit error and builds nothing", () => {
  delete process.env.FAFF_EVAL_LOCAL_BASE_URL; // ensure no ambient fallback
  assert.throws(
    () => resolveDriver(["--driver", "local", "--model", "m"], PRESETS),
    /--base-url|FAFF_EVAL_LOCAL_BASE_URL/);
});

test("resolveDriver rejects an unknown --driver", () => {
  assert.throws(() => resolveDriver(["--driver", "frobnicate"], PRESETS), /unknown --driver/);
});

// --- resolveLocalParams: flag beats env; both missing is fatal ---
test("resolveLocalParams resolves --base-url and --model from flags", () => {
  const { baseUrl, model } = resolveLocalParams(
    ["--base-url", "http://studio.longhair-escalator.ts.net:11434", "--model", "qwen3.6:27b-mlx"]);
  assert.equal(baseUrl, "http://studio.longhair-escalator.ts.net:11434");
  assert.equal(model, "qwen3.6:27b-mlx");
});

// ====================== FAFF-133 — repo-plugin loading into the isolated run ======================

// --- presets load the repo plugin; frontier drops --bare (FAFF-138: incompatible with OAuth auth) ---
test("frontierOpts: repo plugin, NO --bare (OAuth auth), forwardCreds true", () => {
  assert.deepEqual(frontierOpts(), { bin: "claude", model: null, bare: false, pluginDir: DEFAULT_PLUGIN_DIR, forwardCreds: true });
  assert.ok(DEFAULT_PLUGIN_DIR.endsWith("/plugin"), "DEFAULT_PLUGIN_DIR points at the repo plugin");
});

test("localOpts defaults to the repo plugin + --bare alongside the ollama redirect", () => {
  const o = localOpts({ baseUrl: "http://h:11434", model: "m" });
  assert.equal(o.bare, true); // local: env-token auth works under --bare
  assert.equal(o.pluginDir, DEFAULT_PLUGIN_DIR);
  assert.equal(o.env.ANTHROPIC_BASE_URL, "http://h:11434");
});

// --- frontier args: --plugin-dir, NO --bare (FAFF-138) ---
test("buildInvocation emits --plugin-dir (no --bare) for the frontier preset", () => {
  const inv = buildInvocation(frontierOpts(), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--plugin-dir", DEFAULT_PLUGIN_DIR]);
});

test("buildInvocation orders args: --model then --bare then --plugin-dir (local keeps --bare)", () => {
  const inv = buildInvocation(localOpts({ baseUrl: "http://h:11434", model: "m" }), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--model", "m", "--bare", "--plugin-dir", DEFAULT_PLUGIN_DIR]);
});

// --- pluginDir: null is the vanilla skill-less baseline (no --plugin-dir; frontier has no --bare) ---
test("pluginDir:null disables the plugin (vanilla baseline) — frontier emits just -p PROMPT", () => {
  const inv = buildInvocation(frontierOpts({ pluginDir: null }), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT"]);
});

// --- the CLI flag resolves: --plugin-dir overrides, --no-plugin disables, absent → preset default ---
test("resolvePluginDir: flag overrides, --no-plugin disables, absent is undefined", () => {
  assert.equal(resolvePluginDir(["--plugin-dir", "/custom/plugin"]), "/custom/plugin");
  assert.equal(resolvePluginDir(["--no-plugin"]), null);
  assert.equal(resolvePluginDir([]), undefined); // preset default (repo plugin) applies
});

// ============= FAFF-134 — the eval prompt carries faff-tidy's REAL classification rubric =============

// --- the rubric is extracted verbatim from the repo plugin's faff-tidy SKILL.md (section 1) ---
test("loadTidyJudgementProse extracts section 1 (the classification rubric) from the shipped SKILL.md", () => {
  const prose = loadTidyJudgementProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("### 1. The mess"), "starts at the START anchor");
  // carries the real classification criteria the eval measures...
  for (const marker of ["Dupes:", "Vagueness:", "Stale:", "Superseded:"]) {
    assert.ok(prose.includes(marker), `rubric includes "${marker}"`);
  }
  // ...and stops before the next section (no Ready-to-pick-up bleed).
  assert.ok(!prose.includes("### 2. Ready to pick up"), "stops before the END anchor");
});

// --- fail-loud when the skill file is missing (anchors can't resolve) ---
test("loadTidyJudgementProse fails loud on a missing skill file", () => {
  assert.throws(() => loadTidyJudgementProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- FAFF-140: the synthesis-gloss contract is extracted verbatim from faffidavit-rendering ---
test("loadSynthesisGlossProse extracts the synthesis-gloss section from the shipped rendering skill", () => {
  const prose = loadSynthesisGlossProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("## Synthesis — the issue-gloss contract"), "starts at the START anchor");
  assert.ok(/[Hh]umanisation/.test(prose), "carries the humanisation rule");
  assert.ok(!prose.includes("## Tabular data"), "stops before the END anchor");
});

test("loadSynthesisGlossProse fails loud on a missing skill file", () => {
  assert.throws(() => loadSynthesisGlossProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- FAFF-140: the eval prompt now carries BOTH classification + synthesis criteria ---
test("loadJudgementCriteria combines the classification rubric and the synthesis-gloss contract", () => {
  const c = loadJudgementCriteria(DEFAULT_PLUGIN_DIR);
  assert.ok(c.includes("Dupes:"), "has the classification rubric (faff-tidy)");
  assert.ok(c.includes("issue-gloss contract"), "has the synthesis-gloss contract (faffidavit-rendering)");
});

// ===================== FAFF-146 — prep rubric loaders + per-kind prompt wiring =====================

// --- the confidence rubric is extracted verbatim from faffter-dark-nlspec/SKILL.md ---
test("FAFF-146 loadConfidenceRubricProse extracts the Confidence self-rating section verbatim", () => {
  const prose = loadConfidenceRubricProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("## Confidence self-rating"), "starts at the START anchor");
  for (const level of ["high", "medium", "low"]) assert.ok(prose.includes(`**${level}**`), `defines ${level}`);
  assert.ok(!prose.includes("## Contract artifact"), "stops before the END anchor");
});

test("FAFF-146 loadConfidenceRubricProse fails loud on a missing skill file", () => {
  assert.throws(() => loadConfidenceRubricProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- the marker dialect is extracted verbatim from faff/SKILL.md "Spec readiness (fixed)" ---
test("FAFF-146 loadMarkerDialectProse extracts the decision-marker dialect verbatim", () => {
  const prose = loadMarkerDialectProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("### Spec readiness (fixed)"), "starts at the START anchor");
  for (const marker of ["**Chosen:**", "**Punt:**", "**Assumes:**"]) assert.ok(prose.includes(marker), `has ${marker}`);
  assert.ok(!prose.includes("The producer emits, the consumer parses"), "stops before the END anchor");
});

test("FAFF-146 loadMarkerDialectProse fails loud on a missing skill file", () => {
  assert.throws(() => loadMarkerDialectProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- the reconciliation rubric is extracted verbatim from faff-prep/SKILL.md Step 2a ---
test("FAFF-146 loadReconciliationProse extracts the Step-2a Challenge/Resolution/Context/Noise rubric", () => {
  const prose = loadReconciliationProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("**Step 2a: Scan comments since the spec"), "starts at the START anchor");
  for (const label of ["Challenge", "Resolution", "Context", "Noise"]) assert.ok(prose.includes(label), `has ${label}`);
  assert.ok(!prose.includes("**Step 2b:"), "stops before the END anchor");
});

test("FAFF-146 loadReconciliationProse fails loud on a missing skill file", () => {
  assert.throws(() => loadReconciliationProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- criteriaFor resolves the right verbatim rubric per kind (tidy unchanged; prep per-surface) ---
test("FAFF-146 criteriaFor picks the prep rubric for confidence/marker and the tidy criteria otherwise", () => {
  assert.ok(criteriaFor("confidence", DEFAULT_PLUGIN_DIR).startsWith("## Confidence self-rating"));
  assert.ok(criteriaFor("marker", DEFAULT_PLUGIN_DIR).startsWith("### Spec readiness (fixed)"));
  assert.ok(criteriaFor("dupe", DEFAULT_PLUGIN_DIR).includes("Dupes:")); // tidy combined criteria, unchanged
  assert.equal(criteriaFor("confidence", null), null); // --no-plugin baseline → improvise (control)
});

// --- buildEvalPrompt renders the confidence surface over a spec body with the confidence envelope ---
test("FAFF-146 buildEvalPrompt(confidence) carries the spec body and the confidence envelope shape", () => {
  const c = { id: "cf-x", kind: "confidence", question: "Rate it.", fixture: { spec_body: "THE SPEC BODY TEXT" } };
  const p = buildEvalPrompt(c, criteriaFor("confidence", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("THE SPEC BODY TEXT"), "includes the spec body");
  assert.ok(p.includes("## Confidence self-rating"), "folds in the verbatim confidence rubric");
  assert.ok(p.includes('"confidence": "<high|medium|low>"'), "asks for the confidence envelope field");
  assert.ok(p.includes("cf-x"), "interpolates the case id");
  assert.ok(!p.includes("Run faff-tidy"), "does NOT use the tidy framing");
});

// --- buildEvalPrompt renders the marker surface over decision sections with the marker envelope ---
test("FAFF-146 buildEvalPrompt(marker) carries the sections and the marker envelope shape", () => {
  const c = { id: "mk-x", kind: "marker", question: "Classify each.",
    fixture: { sections: [{ key: "auth", text: "Chosen: JWT." }] } };
  const p = buildEvalPrompt(c, criteriaFor("marker", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes('"auth"'), "includes the section key");
  assert.ok(p.includes("### Spec readiness (fixed)"), "folds in the verbatim marker dialect");
  assert.ok(p.includes('"markers"'), "asks for the markers envelope field");
});

// ====================== FAFF-153 — the chain-gap criteria anchor + prompt ======================

// --- the chain-gap criteria is the verbatim `#### Chain gaps` §5 sub-section (anchor resolves, fail-loud) ---
test("FAFF-153 loadTidyChainGapProse extracts the verbatim `#### Chain gaps` sub-section", () => {
  const prose = loadTidyChainGapProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("#### Chain gaps"), "starts at the chain-gap sub-heading");
  assert.ok(prose.includes("upstream"), "carries the sub-type vocabulary");
  assert.ok(prose.includes("Conservative skips"), "carries the conservative-skip criteria");
  assert.ok(!prose.includes("### 6. Calibration signals"), "stops before the next `### ` heading");
});
test("FAFF-153 loadTidyChainGapProse fails loud on a missing skill file", () => {
  assert.throws(() => loadTidyChainGapProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- criteriaFor + buildEvalPrompt wire the chain-gap surface (criteria folded, chain_gap envelope) ---
test("FAFF-153 buildEvalPrompt(chain-gap) folds the criteria + the chain_gap envelope over raw spec prose", () => {
  const c = { id: "cg-x", kind: "chain-gap", question: "Any chain gaps?",
    fixture: { version: 1, issues: [{ id: "ISS-CG", spec: "blocked by the ingestion job" }] } };
  const p = buildEvalPrompt(c, criteriaFor("chain-gap", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("#### Chain gaps"), "folds in the verbatim chain-gap criteria");
  assert.ok(p.includes("blocked by the ingestion job"), "includes the raw spec prose");
  assert.ok(p.includes('"chain_gap"'), "asks for the chain_gap envelope field");
  assert.ok(p.includes("upstream|downstream|peer|sub-ticket"), "names the closed sub_type enum");
  assert.ok(p.includes("cg-x"), "interpolates the case id");
  assert.ok(!p.includes('"classifications"'), "does NOT use the tidy classification envelope");
});

// --- the tidy prompt framing is unchanged (no regression for the six tidy kinds) ---
test("FAFF-146 buildEvalPrompt(dupe) is unchanged — still the tidy backlog framing", () => {
  const c = { id: "d-x", kind: "dupe", question: "Which are dupes?", fixture: { version: 1, issues: [{ id: "A" }] } };
  const p = buildEvalPrompt(c, criteriaFor("dupe", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("Run faff-tidy's judgement pass"), "keeps the tidy framing");
  assert.ok(p.includes('"classifications"'), "keeps the tidy envelope shape");
});

// ====================== FAFF-148 — the review-verdict rubric + verdict-revert prompt ======================

// --- the review-verdict rubric is extracted verbatim from BOTH shipped sources (review + gateway) ---
test("loadReviewVerdictProse folds the gateway's fixed contract and the review producer's rubric verbatim", () => {
  const prose = loadReviewVerdictProse(DEFAULT_PLUGIN_DIR);
  // gateway "Review verdict (fixed)" — the canonical revert test + malformed→needs-human coercion
  assert.ok(prose.includes("### Review verdict (fixed)"), "carries the gateway's fixed contract section");
  assert.ok(/never silently to `?pass`?/.test(prose), "carries the malformed→needs-human coercion statement");
  // review producer — pass 5 + the verbatim revert test + the verdict mapping
  assert.ok(prose.includes("### 5. Human-judgement flag"), "carries the review producer's pass-5 header");
  assert.ok(prose.includes("Only flag when the effect persists after revert"), "carries the verbatim revert test (line 103)");
  assert.ok(prose.includes("## Verdict rules"), "carries the verdict mapping");
  // ...and stops before the END anchor (no Contract-artifact / Delivery-outcome bleed)
  assert.ok(!prose.includes("### Delivery outcome (fixed)"), "stops before the gateway END anchor");
  assert.ok(!prose.includes("## Contract artifact"), "stops before the review END anchor (## Output)");
});

test("loadReviewVerdictProse fails loud on a missing skill file", () => {
  assert.throws(() => loadReviewVerdictProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- buildEvalPrompt is kind-aware: a verdict-revert case uses the verdict-shaped envelope ---
test("buildEvalPrompt(verdict-revert) emits the verdict envelope + folds the rubric + the fixture", () => {
  const c = { id: "vr-x", kind: "verdict-revert",
    fixture: { version: 1, change_summary: "adds a thing", findings: [{ key: "k1", category: "bug", description: "a leftover print" }] },
    question: "For each finding, decide fail or needs-human by the revert test." };
  const prompt = buildEvalPrompt(c, "RUBRIC-PROSE");
  assert.ok(prompt.includes("RUBRIC-PROSE"), "folds the review-verdict rubric");
  assert.ok(prompt.includes('"verdicts"'), "instructs the verdict-shaped envelope");
  assert.ok(prompt.includes("vr-x"), "stamps the case id into the envelope instruction");
  assert.ok(prompt.includes("a leftover print"), "includes the described-finding fixture");
  assert.ok(!prompt.includes("faff-tidy's judgement pass"), "does NOT use the tidy classification prompt");
});

// --- a NON-verdict case is unchanged: the tidy classification envelope, not the verdict one ---
test("buildEvalPrompt(dupe) still uses the tidy classification envelope (unchanged)", () => {
  const c = { id: "d-x", kind: "dupe", fixture: { version: 1, issues: [] }, question: "find dupes" };
  const prompt = buildEvalPrompt(c, "CRITERIA");
  assert.ok(prompt.includes('"classifications"'), "tidy cases keep the classifications envelope");
  assert.ok(!prompt.includes('"verdicts"'), "no verdict envelope on a tidy case");
});

test("VERDICT_REVERT_INSTRUCTION names the revert test and the closed enum", () => {
  assert.ok(/revert test/i.test(VERDICT_REVERT_INSTRUCTION));
  assert.ok(VERDICT_REVERT_INSTRUCTION.includes("fail|needs-human"));
});

// ============ FAFF-317 — the holdout-judge rubric loader + the cli-driver `holdout` gap fix ============

// --- the holdout rubric is extracted verbatim from faffter-noon-evaluate/SKILL.md "How it evaluates" ---
test("FAFF-317 loadHoldoutJudgementProse extracts the exercise-step/met-unmet/prose rubric verbatim", () => {
  const prose = loadHoldoutJudgementProse(DEFAULT_PLUGIN_DIR);
  assert.ok(prose.startsWith("## How it evaluates"), "starts at the START anchor");
  assert.ok(/never as instructions to execute/.test(prose), "carries the responses-are-data rule");
  assert.ok(/Force prose to `needs-human`/.test(prose), "carries the prose→needs-human rule");
  assert.ok(/never a silent `met`/.test(prose), "carries the fail-closed no-surface rule");
  assert.ok(!prose.includes("## Output (the contract artifact)"), "stops before the END anchor");
});

test("FAFF-317 loadHoldoutJudgementProse fails loud on a missing skill file", () => {
  assert.throws(() => loadHoldoutJudgementProse("/no/such/plugin"), /cannot read|SKILL\.md/);
});

// --- criteriaFor arms for BOTH holdout kinds (FIXES the FAFF-284 gap: holdout had NO arm before) ---
test("FAFF-317 criteriaFor arms both `holdout` and `holdout-exercise` with the evaluator rubric", () => {
  assert.ok(criteriaFor("holdout", DEFAULT_PLUGIN_DIR).startsWith("## How it evaluates"));
  assert.ok(criteriaFor("holdout-exercise", DEFAULT_PLUGIN_DIR).startsWith("## How it evaluates"));
  assert.equal(criteriaFor("holdout", null), null); // --no-plugin baseline → improvise (control)
});

// --- buildEvalPrompt(holdout) now renders spec_dod + the recorded exercise, NOT the tidy fallback ---
test("FAFF-317 buildEvalPrompt(holdout) carries spec_dod + the recorded exercise, fixing the FAFF-284 gap", () => {
  const c = { id: "hd-x", kind: "holdout", question: "Classify each criterion.",
    fixture: { spec_dod: [{ key: "k1", class: "scenario", text: "does the thing" }], exercise: "THE RECORDED TRANSCRIPT" } };
  const p = buildEvalPrompt(c, criteriaFor("holdout", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## How it evaluates"), "folds in the verbatim evaluator rubric");
  assert.ok(p.includes("THE RECORDED TRANSCRIPT"), "includes the recorded exercise verbatim");
  assert.ok(p.includes("k1"), "includes the spec_dod criteria");
  assert.ok(p.includes('"holdout"'), "asks for the holdout envelope field");
  assert.ok(p.includes("hd-x"), "interpolates the case id");
  assert.ok(!p.includes("Run faff-tidy's judgement pass"), "no longer falls through to the tidy fallback");
  assert.ok(!p.includes('"classifications"'), "no longer emits the tidy classifications envelope");
});

// --- buildEvalPrompt(holdout-exercise) renders spec_dod + a labelled raw recording catalog ---
test("FAFF-317 buildEvalPrompt(holdout-exercise) carries spec_dod + a labelled raw recording catalog", () => {
  const c = { id: "he-x", kind: "holdout-exercise", question: "Classify each criterion.",
    fixture: { spec_dod: [{ key: "k1", class: "scenario", text: "does the thing" }],
      recordings: [{ request: "GET http://env:8080/health", response: "200 OK; body {\"status\":\"ok\"}" }] } };
  const p = buildEvalPrompt(c, criteriaFor("holdout-exercise", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## How it evaluates"), "folds in the verbatim evaluator rubric");
  assert.ok(p.includes("Recording 1:"), "labels each recording");
  assert.ok(p.includes("GET http://env:8080/health"), "includes the raw request");
  assert.ok(p.includes("200 OK"), "includes the raw response");
  assert.ok(p.includes('"holdout-exercise"'), "asks for the holdout-exercise envelope field");
  assert.ok(p.includes("he-x"), "interpolates the case id");
  assert.ok(!p.includes("Run faff-tidy's judgement pass"), "does NOT use the tidy framing");
  assert.ok(!p.includes("THE RECORDED TRANSCRIPT"), "no pre-digested narrative — raw recordings only");
});

// === FAFF-319 — the seven judgement-eval kinds' driver arms (envelope + render + criteria) ===
// Before FAFF-319 these fell through to the tidy default: the model was told to emit tidy fields while
// the grader read env.architecture/specqual/roadmap/adr/verdict/objections/findings — empty by
// construction (a stable 0.00). Each test asserts the arm now (a) loads the surface's OWN rubric, (b)
// names the grader's exact envelope field, (c) frames the real task, and (d) no longer falls through.

test("FAFF-319 criteriaFor arms each judgement-eval kind with its OWN surface rubric (not tidy's)", () => {
  assert.ok(criteriaFor("architecture", DEFAULT_PLUGIN_DIR).startsWith("## How it proposes"));
  assert.ok(criteriaFor("specqual", DEFAULT_PLUGIN_DIR).startsWith("## The lite nlspec arc"));
  assert.ok(criteriaFor("roadmap", DEFAULT_PLUGIN_DIR).startsWith("### 4. Dependency chain"));
  assert.ok(criteriaFor("adr-gloss", DEFAULT_PLUGIN_DIR).startsWith("## Output — the ADR body"));
  assert.ok(criteriaFor("spec-verdict", DEFAULT_PLUGIN_DIR).startsWith("## The four lenses"));
  assert.ok(criteriaFor("refutation-spec", DEFAULT_PLUGIN_DIR).startsWith("## The lenses as independent refuters"));
  assert.ok(criteriaFor("refutation-code", DEFAULT_PLUGIN_DIR).startsWith("## Review lens"));
  // --no-plugin baseline → improvise (the control) for every one
  for (const k of ["architecture", "specqual", "roadmap", "adr-gloss", "spec-verdict", "refutation-spec", "refutation-code"]) {
    assert.equal(criteriaFor(k, null), null);
  }
});

test("FAFF-319 buildEvalPrompt(architecture) frames the proposal task + emits env.architecture", () => {
  const c = { id: "arch-x", kind: "architecture", question: "Propose one best-fit architecture.",
    fixture: { brief: "THE BRIEF", infra_profile: "THE INFRA PROFILE" } };
  const p = buildEvalPrompt(c, criteriaFor("architecture", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## How it proposes"), "folds in the architecture surface's own rubric");
  assert.ok(p.includes("THE BRIEF") && p.includes("THE INFRA PROFILE"), "renders brief + infra profile");
  assert.ok(p.includes('"architecture"'), "asks for the architecture envelope field the grader reads");
  assert.ok(p.includes("arch-x"), "interpolates the case id");
  assert.ok(!p.includes("Run faff-tidy's judgement pass"), "no tidy fall-through");
  assert.ok(!p.includes('"classifications"'), "no tidy classifications envelope");
});

test("FAFF-319 buildEvalPrompt(specqual) frames the write-a-spec task + emits env.specqual", () => {
  const c = { id: "sq-x", kind: "specqual", question: "Write a buildable lite-nlspec.",
    fixture: { issue: "THE ISSUE AND EXPLORE FINDINGS" } };
  const p = buildEvalPrompt(c, criteriaFor("specqual", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## The lite nlspec arc"), "folds in the spec producer's arc rubric");
  assert.ok(p.includes("THE ISSUE AND EXPLORE FINDINGS"), "renders the issue + explore findings");
  assert.ok(p.includes('"specqual"'), "asks for the specqual envelope field");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});

test("FAFF-319 buildEvalPrompt(roadmap) frames the synthesis task + emits env.roadmap", () => {
  const c = { id: "rm-x", kind: "roadmap", question: "Synthesise the roadmap.",
    fixture: { issues: [{ id: "ISS-Z", title: "ZEE ISSUE", state: "Backlog", relations: { blocks: [], blockedBy: [], relatedTo: [] } }] } };
  const p = buildEvalPrompt(c, criteriaFor("roadmap", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("### 4. Dependency chain"), "folds in faff-map's synthesis rubric");
  assert.ok(p.includes("ISS-Z") && p.includes("ZEE ISSUE"), "renders the seeded issues");
  assert.ok(p.includes('"roadmap"'), "asks for the roadmap envelope field");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});

test("FAFF-319 buildEvalPrompt(adr-gloss) frames the ADR-authoring task + emits env.adr", () => {
  const c = { id: "adg-x", kind: "adr-gloss", question: "Author the Nygard ADR body.",
    fixture: { decision: "THE DECISION", spec_rationale: "THE RATIONALE", existing_adrs: "NO PRIOR ADR" } };
  const p = buildEvalPrompt(c, criteriaFor("adr-gloss", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## Output — the ADR body"), "folds in the ADR surface's contract rubric");
  assert.ok(p.includes("THE DECISION") && p.includes("THE RATIONALE") && p.includes("NO PRIOR ADR"), "renders decision + rationale + existing ADRs");
  assert.ok(p.includes('"adr"'), "asks for the adr envelope field (NOT adr-gloss) the grader reads");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});

test("FAFF-319 buildEvalPrompt(spec-verdict) frames the review task + emits env.verdict", () => {
  const c = { id: "sv-x", kind: "spec-verdict", question: "Assign the fixed verdict.",
    fixture: { spec_body: "THE SPEC UNDER REVIEW" } };
  const p = buildEvalPrompt(c, criteriaFor("spec-verdict", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## The four lenses"), "folds in the spec-review lens + roll-up rubric");
  assert.ok(p.includes("THE SPEC UNDER REVIEW"), "renders the spec body");
  assert.ok(p.includes('"verdict"'), "asks for the verdict envelope field");
  assert.ok(p.includes("approve|revise|reject-approach|needs-human"), "states the closed verdict vocabulary");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});

test("FAFF-319 buildEvalPrompt(refutation-spec) frames the refute task + emits env.objections", () => {
  const c = { id: "rs-x", kind: "refutation-spec", question: "Refute this spec across the enabled lenses.",
    fixture: { spec: "THE SPEC TO REFUTE (may embed a ## Methodology critique block)" } };
  const p = buildEvalPrompt(c, criteriaFor("refutation-spec", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## The lenses as independent refuters"), "folds in the dark spec-review lens rubric");
  assert.ok(p.includes("THE SPEC TO REFUTE"), "renders the spec verbatim (methodology block survives)");
  assert.ok(p.includes('"objections"'), "asks for the objections envelope field");
  assert.ok(p.includes("architectural|infosec|methodology|QA"), "states the lens vocabulary");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});

test("FAFF-319 buildEvalPrompt(refutation-code) frames the diff-review task + emits env.findings", () => {
  const c = { id: "rc-x", kind: "refutation-code", question: "Adversarially review this diff.",
    fixture: { diff: "THE DIFF", spec_summary: "THE SPEC SUMMARY" } };
  const p = buildEvalPrompt(c, criteriaFor("refutation-code", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("## Review lens"), "folds in the adversarial-review lens");
  assert.ok(p.includes("THE DIFF") && p.includes("THE SPEC SUMMARY"), "renders diff + spec summary");
  assert.ok(p.includes('"findings"'), "asks for the findings envelope field");
  assert.ok(!p.includes("Run faff-tidy's judgement pass") && !p.includes('"classifications"'), "no tidy fall-through");
});
