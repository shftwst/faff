// FAFF-132/FAFF-133 — preset-wiring tests for the eval CLI driver. PURE: imports buildInvocation /
// the *Opts factories / resolveDriver and asserts the resolved { bin, args, env } with ZERO spawning.
// The real `claude -p` driver is never invoked here — eval/ stays out of the real-call path (FAFF-131 runs that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, frontierDriver, localDriver, frontierOpts, localOpts, DEFAULT_PLUGIN_DIR } from "../eval/cli-driver.mjs";
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

// --- both presets default to loading the repo's canonical plugin + --bare ---
test("frontierOpts defaults to the repo plugin + --bare", () => {
  assert.deepEqual(frontierOpts(), { bin: "claude", bare: true, pluginDir: DEFAULT_PLUGIN_DIR });
  assert.ok(DEFAULT_PLUGIN_DIR.endsWith("/plugin"), "DEFAULT_PLUGIN_DIR points at the repo plugin");
});

test("localOpts defaults to the repo plugin + --bare alongside the ollama redirect", () => {
  const o = localOpts({ baseUrl: "http://h:11434", model: "m" });
  assert.equal(o.bare, true);
  assert.equal(o.pluginDir, DEFAULT_PLUGIN_DIR);
  assert.equal(o.env.ANTHROPIC_BASE_URL, "http://h:11434");
});

// --- the args carry --bare --plugin-dir, in the right order, after --model ---
test("buildInvocation emits --bare --plugin-dir for the frontier preset (skills loaded)", () => {
  const inv = buildInvocation(frontierOpts(), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--bare", "--plugin-dir", DEFAULT_PLUGIN_DIR]);
});

test("buildInvocation orders args: --model then --bare then --plugin-dir", () => {
  const inv = buildInvocation(localOpts({ baseUrl: "http://h:11434", model: "m" }), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--model", "m", "--bare", "--plugin-dir", DEFAULT_PLUGIN_DIR]);
});

// --- pluginDir: null is the vanilla skill-less baseline (no --plugin-dir) ---
test("pluginDir:null disables the plugin (vanilla baseline) — --bare stays, --plugin-dir gone", () => {
  const inv = buildInvocation(frontierOpts({ pluginDir: null }), "PROMPT", "/tmp/cfg");
  assert.deepEqual(inv.args, ["-p", "PROMPT", "--bare"]);
});

// --- the CLI flag resolves: --plugin-dir overrides, --no-plugin disables, absent → preset default ---
test("resolvePluginDir: flag overrides, --no-plugin disables, absent is undefined", () => {
  assert.equal(resolvePluginDir(["--plugin-dir", "/custom/plugin"]), "/custom/plugin");
  assert.equal(resolvePluginDir(["--no-plugin"]), null);
  assert.equal(resolvePluginDir([]), undefined); // preset default (repo plugin) applies
});
