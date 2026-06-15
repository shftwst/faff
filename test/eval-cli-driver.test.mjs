// FAFF-132/FAFF-133/FAFF-134 — preset-wiring tests for the eval CLI driver. PURE: imports
// buildInvocation / the *Opts factories / resolveDriver / loadTidyJudgementProse and asserts the
// resolved args / extracted prose with ZERO spawning. The real `claude -p` driver is never invoked
// here — eval/ stays out of the real-call path (FAFF-131 runs that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, frontierDriver, localDriver, frontierOpts, localOpts, DEFAULT_PLUGIN_DIR, loadTidyJudgementProse, loadSynthesisGlossProse, loadJudgementCriteria, forwardCredentials } from "../eval/cli-driver.mjs";
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
