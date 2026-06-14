// FAFF-130 — the real frontier driver: drives faff-tidy's judgement pass via `claude -p`
// headless, with per-run CLAUDE_CONFIG_DIR isolation so a rep never writes the parent
// session's ~/.claude.json (ADR 0003 infra finding). Returns raw stdout for envelope parse.
//
// ⚠ NOT exercised in CI — eval/ is excluded from the `node --test` globs. Running this for
// real (~240 reps) is FAFF-131's human-supervised job (budget + the CLAUDE_CONFIG_DIR smoke
// validation). The orchestrator (run-evals.mjs) takes the driver as an argument, so tests
// inject a mock and never reach this module.
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

export function makeFrontierDriver({ bin = "claude" } = {}) {
  return async function frontierDriver(evalCase, repIndex) {
    const cfgDir = mkdtempSync(join(tmpdir(), `faff-eval-${evalCase.id}-${repIndex}-`));
    const prompt = `${renderFixturePrompt(evalCase)}\n\n${EVAL_MODE_INSTRUCTION.replace("<ID>", evalCase.id)}`;
    const res = spawnSync(bin, ["-p", prompt], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: cfgDir }, // isolation — no parent ~/.claude.json write
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (res.error) throw new Error(`frontier driver (${bin}): ${res.error.message}`);
    return { rawText: res.stdout ?? "", tokens: estimateTokens(res.stdout), transcript: cfgDir };
  };
}
