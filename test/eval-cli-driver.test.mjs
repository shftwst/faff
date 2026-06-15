// FAFF-132/FAFF-133/FAFF-134 — preset-wiring tests for the eval CLI driver. PURE: imports
// buildInvocation / the *Opts factories / resolveDriver / loadTidyJudgementProse and asserts the
// resolved args / extracted prose with ZERO spawning. The real `claude -p` driver is never invoked
// here — eval/ stays out of the real-call path (FAFF-131 runs that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, frontierDriver, localDriver, frontierOpts, localOpts, DEFAULT_PLUGIN_DIR, loadTidyJudgementProse, loadSynthesisGlossProse, loadJudgementCriteria, forwardCredentials, loadConfidenceRubricProse, loadMarkerDialectProse, loadReconciliationProse, criteriaFor, buildEvalPrompt } from "../eval/cli-driver.mjs";
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
  assert.deepEqual(frontierOpts(), { bin: "claude", bare: false, pluginDir: DEFAULT_PLUGIN_DIR, forwardCreds: true });
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

// --- the tidy prompt framing is unchanged (no regression for the six tidy kinds) ---
test("FAFF-146 buildEvalPrompt(dupe) is unchanged — still the tidy backlog framing", () => {
  const c = { id: "d-x", kind: "dupe", question: "Which are dupes?", fixture: { version: 1, issues: [{ id: "A" }] } };
  const p = buildEvalPrompt(c, criteriaFor("dupe", DEFAULT_PLUGIN_DIR));
  assert.ok(p.includes("Run faff-tidy's judgement pass"), "keeps the tidy framing");
  assert.ok(p.includes('"classifications"'), "keeps the tidy envelope shape");
});
