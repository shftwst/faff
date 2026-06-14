// FAFF-130/FAFF-132 — the CLI eval driver: drives faff-tidy's judgement pass via `claude -p`
// headless, with per-run CLAUDE_CONFIG_DIR isolation so a rep never writes the parent
// session's ~/.claude.json (ADR 0003 infra finding). Returns raw stdout for envelope parse.
//
// Two presets over ONE code path (FAFF-132):
//   - frontier: `claude -p` against api.anthropic.com (the default; unchanged from FAFF-130).
//   - local:    the SAME `claude -p` invocation with ollama's Anthropic-Messages-API env
//               redirect (ANTHROPIC_BASE_URL=<ollama host>, AUTH_TOKEN=ollama, API_KEY="")
//               + --model. No new transport — ollama speaks the Anthropic API natively.
//
// ⚠ NOT exercised in CI — eval/ is excluded from the `node --test` globs. Running a driver for
// real (~240 reps) is FAFF-131's human-supervised job. The orchestrator (run-evals.mjs) takes
// the driver as an argument, so tests inject a mock and never reach a real spawn. `buildInvocation`
// is PURE (no spawn/fs/clock), so a test may import this module to assert wiring with zero I/O.
//
// Zero-dependency: node builtins only.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EVAL_MODE_INSTRUCTION =
  "After your normal faff-tidy judgement pass over this fixture, emit EXACTLY ONE fenced code " +
  'block tagged `faff-eval:judgement` containing JSON of the shape ' +
  '{ "case_id": "<ID>", "classifications": { "dupe": [..], "vague": [..], "stale": [..], "superseded": [..] }, ' +
  '"ordering": ["<issue-id>", ..], "gloss": { "<issue-id>": "<one-line gloss>" } } — include only the fields your ' +
  "judgement produced for this fixture, using the fixture's issue ids. Emit nothing after the block.";

function renderFixturePrompt(c) {
  return (
    `Run faff-tidy's judgement pass on the following backlog fixture and answer: ${c.question}\n\n` +
    `Fixture (FAFF-89 tracker shape):\n${JSON.stringify(c.fixture, null, 2)}`
  );
}

// Rough token proxy for the spike's cost column; FAFF-131 can replace with claude -p's reported usage.
const estimateTokens = (s) => Math.ceil(String(s ?? "").length / 4);

// PURE: resolve the exact { bin, args, env } to spawn. No spawn, no fs, no clock — so a test can
// import this and assert preset wiring (--model appended, ollama env injected) with zero I/O.
export function buildInvocation(opts, prompt, cfgDir) {
  const { bin = "claude", model = null, env = {} } = opts ?? {};
  const args = ["-p", prompt, ...(model ? ["--model", model] : [])];
  return { bin, args, env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: cfgDir } };
}

// Generic factory. opts: { bin, model, baseUrl, env }. The closure spawns; importing this does not.
export function makeCliDriver(opts = {}) {
  return async function cliDriver(evalCase, repIndex) {
    const cfgDir = mkdtempSync(join(tmpdir(), `faff-eval-${evalCase.id}-${repIndex}-`));
    const prompt = `${renderFixturePrompt(evalCase)}\n\n${EVAL_MODE_INSTRUCTION.replace("<ID>", evalCase.id)}`;
    const inv = buildInvocation(opts, prompt, cfgDir);
    const res = spawnSync(inv.bin, inv.args, {
      env: inv.env, // isolation (CLAUDE_CONFIG_DIR) + any preset redirect — no parent ~/.claude.json write
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) throw new Error(`cli driver (${inv.bin}): ${res.error.message}`);
    return { rawText: res.stdout ?? "", tokens: estimateTokens(res.stdout), transcript: cfgDir };
  };
}

// Preset: frontier — `claude -p` against the Anthropic API (the FAFF-130 default).
export function frontierDriver({ bin = "claude" } = {}) {
  return makeCliDriver({ bin });
}

// Preset: local — the SAME `claude -p` path with ollama's Anthropic-API env redirect + --model.
// `baseUrl` is REQUIRED — there is deliberately no localhost default (ollama is served over Tailscale).
export function localDriver({ baseUrl, model, bin = "claude" } = {}) {
  if (!baseUrl) throw new Error("localDriver requires a baseUrl (the ollama host); no localhost default");
  return makeCliDriver({
    bin,
    model,
    baseUrl,
    env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "" },
  });
}
