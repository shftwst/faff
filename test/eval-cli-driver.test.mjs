// FAFF-132 — preset-wiring tests for the eval CLI driver. PURE: imports buildInvocation /
// resolveDriver and asserts the resolved { bin, args, env } with ZERO spawning. The real
// `claude -p` driver is never invoked here — eval/ stays out of the real-call path (FAFF-131 runs that).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvocation, frontierDriver, localDriver } from "../eval/cli-driver.mjs";
import { resolveDriver, resolveLocalParams } from "../eval/run-evals.mjs";

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
