// FAFF-135 — live driver for the FAFF-93 skill-run harness: drive faff-tidy's judgement against a
// fixture with a REAL model, recording the model's classifications as DecisionRecord buckets.
//
// The harness (test/helpers/skill-harness.mjs) header named "a live driver (FAFF-122 spike)" as a
// future occupant of the SkillDriver interface ({ kind, drive(ctx) }) producing the SAME record
// shape as scriptedDriver. This is that occupant — the "frontier live-driver" lane ADR-0003 left open.
//
// Faithful, not black-box: instead of spawning `claude -p` over a self-contained eval prompt
// (eval/cli-driver.mjs), the driver reads the fixture through the harness tracker port, prompts a
// model with faff-tidy's REAL rubric, and records the resulting judgement at the harness seams —
// so the eval can assert structured decisions (decision-assert) the same way scripted runs do.
//
// The `model` is INJECTABLE: CI tests pass a deterministic mock (zero real calls). makeLiveModel
// returns the real one (spawns `claude -p` via eval/cli-driver buildInvocation, inheriting
// --plugin-dir/--bare/env). eval/ is excluded from `node --test`, and importing this module spawns
// nothing — only calling a real model fn does.
//
// Zero-dependency: node builtins + repo siblings only.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInvocation,
  loadTidyJudgementProse,
  EVAL_MODE_INSTRUCTION,
  DEFAULT_PLUGIN_DIR,
  forwardCredentials,
} from "./cli-driver.mjs";
import { parseJudgementEnvelope } from "./envelope.mjs";
import { CLOSED_SET_KINDS } from "./grader.mjs";

// Build the judgement prompt from faff-tidy's real rubric + the issues read from the fixture + the
// shared envelope instruction. pluginDir null → no rubric (the improvise baseline / control).
export function buildJudgementPrompt(issues, { pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live", question } = {}) {
  const rubric = pluginDir
    ? `Apply faff-tidy's judgement criteria below — these are the skill's own rules, verbatim:\n\n${loadTidyJudgementProse(pluginDir)}\n\n---\n\n`
    : "";
  const ask = question ?? "classify the backlog (dupes / vague / stale / superseded) and order the ready issues";
  return (
    `${rubric}Run faff-tidy's judgement pass on the following backlog and answer: ${ask}\n\n` +
    `Backlog (FAFF-89 tracker shape):\n${JSON.stringify(issues, null, 2)}\n\n` +
    `${EVAL_MODE_INSTRUCTION.replace("<ID>", caseId)}`
  );
}

// A real model: spawn `claude -p` with the prompt. Reuses buildInvocation so it inherits the
// frontier/local preset opts (bin, model, env redirect, --bare, --plugin-dir). Returns raw stdout.
export function makeLiveModel(opts = {}) {
  return function liveModel(prompt) {
    const cfgDir = mkdtempSync(join(tmpdir(), "faff-live-"));
    forwardCredentials(cfgDir, opts); // FAFF-138: frontier auth survives the isolation; local skips
    const inv = buildInvocation(opts, prompt, cfgDir);
    const res = spawnSync(inv.bin, inv.args, { env: inv.env, cwd: cfgDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    if (res.error) throw new Error(`live model (${inv.bin}): ${res.error.message}`);
    return res.stdout ?? "";
  };
}

/**
 * A live SkillDriver for runSkill (FAFF-93). Reads the fixture, prompts the model with faff-tidy's
 * real rubric, parses the judgement envelope, and records each classification as a DecisionRecord
 * bucket (plus `ordering` when present). `model(prompt) -> rawText` is required and injectable.
 *
 * @param {{ model: Function, pluginDir?: string|null, caseId?: string }} cfg
 * @returns {{ kind: "live", drive: (ctx) => Promise<void> }}
 */
export function liveDriver({ model, pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  if (typeof model !== "function") {
    throw new Error("liveDriver requires a model(prompt) function (inject a mock in CI; makeLiveModel for real)");
  }
  return {
    kind: "live",
    async drive(ctx) {
      const issues = ctx.tracker.listIssues({}); // records a trackerRead at the harness seam
      const prompt = buildJudgementPrompt(issues, { pluginDir, caseId });
      const raw = await model(prompt);
      const env = parseJudgementEnvelope(raw, { expectedCaseId: caseId }); // FAFF-137: classify fallback recovers a mis-tagged block
      const cls = env.classifications ?? {};
      for (const kind of CLOSED_SET_KINDS) {
        if (Array.isArray(cls[kind])) ctx.record.recordBucket(kind, cls[kind]);
      }
      if (Array.isArray(env.ordering)) ctx.record.recordBucket("ordering", env.ordering);
    },
  };
}
