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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInvocation,
  loadJudgementCriteria,
  loadReconciliationProse,
  EVAL_MODE_INSTRUCTION,
  DEFAULT_PLUGIN_DIR,
  forwardCredentials,
} from "./cli-driver.mjs";
import { parseJudgementEnvelope } from "./envelope.mjs";
import { CLOSED_SET_KINDS } from "./grader.mjs";

// Build the faff-tidy judgement prompt from faff's real criteria (classification + synthesis gloss,
// FAFF-140) + the issues read from the fixture + the shared envelope instruction. pluginDir null → no
// criteria (the improvise baseline / control).
//
// FAFF-146 — this is now ONE prompt builder among several: liveDriver takes a `promptBuilder` so the
// faff-tidy string is no longer the only option. buildReconciliationPrompt is the prep counterpart.
export function buildJudgementPrompt(issues, { pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live", question } = {}) {
  const rubric = pluginDir
    ? `Apply faff's judgement + synthesis criteria below — these are the skills' own rules, verbatim:\n\n${loadJudgementCriteria(pluginDir)}\n\n---\n\n`
    : "";
  const ask = question ?? "classify the backlog (dupes / vague / stale / superseded) and order the ready issues";
  return (
    `${rubric}Run faff-tidy's judgement pass on the following backlog and answer: ${ask}\n\n` +
    `Backlog (FAFF-89 tracker shape):\n${JSON.stringify(issues, null, 2)}\n\n` +
    `${EVAL_MODE_INSTRUCTION.replace("<ID>", caseId)}`
  );
}

// FAFF-146 — the prep RECONCILIATION prompt builder (the execution-entangled surface). It folds in
// prep's verbatim Step-2a rubric (Challenge / Resolution / Context / Noise) and renders the issue +
// the spec comment (the anchor) + the thread, instructing the model to classify each comment posted
// AFTER the spec comment. The envelope carries a reconciliation field the grader reads as per-comment
// `id:label` pairs (mirrors the marker encoding):
//   { "case_id": "<ID>", "reconciliation": { "<comment-id>": "challenge|resolution|context|noise", ... } }
//
// DESIGN NOTE (FAFF-146 Chosen slice-split): this builder is specified here so the reconciliation
// design is captured and the live-driver is no longer faff-tidy-hardcoded, but the live reconciliation
// RUN — the thread fixtures, the human-authored Challenge/Resolution/Context/Noise oracle, and the
// runSkill({ skill: "faff-prep" }) measurement — is the carved follow-up child under FAFF-145. The
// builder is unit-wired (it composes a prompt) but not yet exercised end-to-end against a model here.
const RECONCILIATION_INSTRUCTION =
  "Classify each comment posted AFTER the spec comment by the Step-2a rubric above, then OUTPUT ONLY " +
  "one fenced code block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON " +
  'of the shape { "case_id": "<ID>", "reconciliation": { "<comment-id>": "challenge|resolution|context|noise", ... } } ' +
  "— one entry per post-spec comment, using the comment ids from the fixture. Output NOTHING except that " +
  "single block: no reasoning, no preamble, no prose, nothing before or after it.";

export function buildReconciliationPrompt(fixture, { pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  const rubric = pluginDir
    ? `Apply faff-prep's post-spec comment-reconciliation rubric below — these are the skill's own rules, verbatim:\n\n${loadReconciliationProse(pluginDir)}\n\n---\n\n`
    : "";
  const { issue, spec_comment, thread } = fixture;
  return (
    `${rubric}Run faff-prep's live-thread reconciliation pass. The spec comment is the anchor; classify ` +
    `every comment posted AFTER it.\n\n` +
    `Issue:\n${JSON.stringify(issue, null, 2)}\n\n` +
    `Spec comment (the anchor):\n${JSON.stringify(spec_comment, null, 2)}\n\n` +
    `Thread (chronological, all after the spec comment):\n${JSON.stringify(thread, null, 2)}\n\n` +
    `${RECONCILIATION_INSTRUCTION.replace("<ID>", caseId)}`
  );
}

// A real model: spawn `claude -p` with the prompt. Reuses buildInvocation so it inherits the
// frontier/local preset opts (bin, model, env redirect, --bare, --plugin-dir). Returns raw stdout.
export function makeLiveModel(opts = {}) {
  return function liveModel(prompt) {
    const cfgDir = mkdtempSync(join(tmpdir(), "faff-live-"));
    try {
      forwardCredentials(cfgDir, opts); // FAFF-138: frontier auth survives the isolation; local skips
      const inv = buildInvocation(opts, prompt, cfgDir);
      const res = spawnSync(inv.bin, inv.args, { env: inv.env, cwd: cfgDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      if (res.error) throw new Error(`live model (${inv.bin}): ${res.error.message}`);
      return res.stdout ?? "";
    } finally {
      try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* FAFF-139: best-effort cleanup */ }
    }
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

/**
 * FAFF-146 — a live SkillDriver for faff-prep's RECONCILIATION surface. Reads the issue + spec
 * comment + thread through the harness tracker seam, prompts the model with prep's verbatim Step-2a
 * rubric (buildReconciliationPrompt), parses the reconciliation envelope, and records each post-spec
 * comment label as a `reconciliation` DecisionRecord bucket of `id:label` pairs — the same shape the
 * grader's closed-set path scores. The bucket name is arbitrary (skill-harness recordBucket is
 * name-agnostic), so no harness redesign is needed (spec Assumption, verified).
 *
 * The test path is runSkill({ skill: "faff-prep", tracker, repo, driver }) — the seam-faithful lane.
 * DESIGN NOTE: shipped as the reconciliation DESIGN (the live-driver is parameterised + a prep driver
 * exists); the end-to-end RUN (thread fixtures + human oracle + the measured frontier baseline) is the
 * carved FAFF-145 follow-up child. `fixture` is read from ctx (the harness exposes it; falls back to a
 * tracker read) so this composes once the follow-up wires a ThreadFixture through the harness.
 *
 * @param {{ model: Function, fixture: object, pluginDir?: string|null, caseId?: string }} cfg
 * @returns {{ kind: "live", drive: (ctx) => Promise<void> }}
 */
export function reconciliationLiveDriver({ model, fixture, pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  if (typeof model !== "function") {
    throw new Error("reconciliationLiveDriver requires a model(prompt) function (inject a mock in CI; makeLiveModel for real)");
  }
  if (!fixture || !fixture.spec_comment || !Array.isArray(fixture.thread)) {
    throw new Error("reconciliationLiveDriver requires a ThreadFixture { issue, spec_comment, thread }");
  }
  return {
    kind: "live",
    async drive(ctx) {
      ctx.tracker.listIssues({}); // records a trackerRead at the harness seam (the spec-comment + thread read)
      const prompt = buildReconciliationPrompt(fixture, { pluginDir, caseId });
      const raw = await model(prompt);
      const env = parseJudgementEnvelope(raw, { expectedCaseId: caseId });
      const labels = env.reconciliation && typeof env.reconciliation === "object" ? env.reconciliation : {};
      const labelPairs = Object.entries(labels).map(([id, label]) => `${id}:${label}`);
      ctx.record.recordBucket("reconciliation", labelPairs);
    },
  };
}
