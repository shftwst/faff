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
  loadRoutingVerdictProse,
  EVAL_MODE_INSTRUCTION,
  ROUTING_MODE_INSTRUCTION,
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

// FAFF-158 — the routing VERDICT-ASSIGN prompt builder (the execution-entangled surface). It folds in
// faff's verbatim automation-routing assignment conditions (gateway + adaptor, via loadRoutingVerdictProse)
// and renders the assembled fixture-of-findings (issue + spec confidence/markers + diagnostics + conflict
// + park_history — the same shape as eval/cases/routing-*.json), then asks for EXACTLY ONE of the closed
// six verdicts via ROUTING_MODE_INSTRUCTION. The envelope carries a single `verdict` field the grader
// reads unchanged (the confidence analogue — one level → one verdict):
//   { "case_id": "<ID>", "verdict": "<one of the six>" }
//
// This is the THIRD prompt builder (after buildJudgementPrompt + buildReconciliationPrompt). pluginDir
// null → no rubric (the improvise baseline / control), exactly as the two siblings do.
export function buildRoutingPrompt(fixture, { pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  const rubric = pluginDir
    ? `Apply faff's automation-routing assignment conditions below — these are the gateway + adaptor rules, verbatim:\n\n${loadRoutingVerdictProse(pluginDir)}\n\n---\n\n`
    : "";
  const { issue, spec, diagnostics, conflict, park_history } = fixture;
  return (
    `${rubric}Run faff's automation-routing assignment pass. Assign the single verdict the assembled ` +
    `fixture-of-findings below implies.\n\n` +
    `Issue:\n${JSON.stringify(issue, null, 2)}\n\n` +
    `Spec (confidence + decision markers):\n${JSON.stringify(spec, null, 2)}\n\n` +
    `Backlog diagnostics finding:\n${JSON.stringify(diagnostics ?? null, null, 2)}\n\n` +
    `Conflict-analysis independence:\n${JSON.stringify(conflict ?? null, null, 2)}\n\n` +
    `Park history:\n${JSON.stringify(park_history ?? [], null, 2)}\n\n` +
    `${ROUTING_MODE_INSTRUCTION.replace("<ID>", caseId)}`
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
 * FAFF-158 — the GENERIC live-driver core (the shared per-skill parameterisation seam). All three
 * live-driver occupants — liveDriver (tidy, multi-bucket), reconciliationLiveDriver (prep), and
 * routingLiveDriver (routing) — are thin configurations of this one core. The body is identical in
 * shape for all three: read through the tracker seam, build the per-skill prompt, call the injected
 * model, parse the envelope, reduce it to {name, items} bucket pairs, record each at the harness seam.
 *
 * This is the seam FAFF-154 (prep-reconciliation) and FAFF-155 (verdict-build) EXTEND rather than
 * re-cut: 154 re-points its reconciliationLiveDriver onto this core (already done here); 155 adds a
 * verdictBuildLiveDriver as another wrapper. The anti-pattern this exists to prevent is a third bespoke
 * driver copy-pasting the listIssues→buildPrompt→parseEnvelope→recordBucket body.
 *
 * `readEnvelope(env) -> Array<{name, items}>` is the per-skill reducer; returning a LIST of pairs is
 * what lets the multi-bucket tidy driver (one pair per populated CLOSED_SET_KIND + ordering) and the
 * single-bucket routing/reconciliation drivers (one pair) share the one core. A pair may omit `name`
 * to fall back to `bucketName`.
 *
 * @param {{ model: Function, skill?: string, buildPrompt: Function, readEnvelope: Function,
 *           bucketName?: string, pluginDir?: string|null, caseId?: string }} cfg
 * @returns {{ kind: "live", drive: (ctx) => Promise<void> }}
 */
export function makeLiveDriver({ model, skill, buildPrompt, readEnvelope, bucketName, pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  if (typeof model !== "function") {
    throw new Error("makeLiveDriver requires a model(prompt) function (inject a mock in CI; makeLiveModel for real)");
  }
  if (typeof buildPrompt !== "function") {
    throw new Error("makeLiveDriver requires a buildPrompt(ctx, opts) function");
  }
  if (typeof readEnvelope !== "function") {
    throw new Error("makeLiveDriver requires a readEnvelope(env) -> [{name, items}, …] reducer");
  }
  return {
    kind: "live",
    skill, // provenance tag (opaque to the harness; runSkill's own `skill` arg drives record.skill)
    async drive(ctx) {
      const issues = ctx.tracker.listIssues({}); // records the single trackerRead seam (seam-faithful)
      const prompt = buildPrompt(ctx, { pluginDir, caseId, issues });
      const raw = await model(prompt);
      const env = parseJudgementEnvelope(raw, { expectedCaseId: caseId }); // FAFF-137: classify fallback recovers a mis-tagged block
      for (const pair of readEnvelope(env)) {
        if (!pair || !Array.isArray(pair.items)) continue;
        ctx.record.recordBucket(pair.name ?? bucketName, pair.items);
      }
    },
  };
}

/**
 * A live SkillDriver for runSkill (FAFF-93). Reads the fixture, prompts the model with faff-tidy's
 * real rubric, parses the judgement envelope, and records each classification as a DecisionRecord
 * bucket (plus `ordering` when present). `model(prompt) -> rawText` is required and injectable.
 *
 * FAFF-158 — re-expressed as a wrapper over makeLiveDriver (the shared core) with NO behaviour change:
 * the tidy reducer returns one {name, items} pair per populated CLOSED_SET_KIND, plus an `ordering`
 * pair when present (the multi-bucket case the pairs shape exists to absorb).
 *
 * @param {{ model: Function, pluginDir?: string|null, caseId?: string }} cfg
 * @returns {{ kind: "live", drive: (ctx) => Promise<void> }}
 */
export function liveDriver({ model, pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  if (typeof model !== "function") {
    throw new Error("liveDriver requires a model(prompt) function (inject a mock in CI; makeLiveModel for real)");
  }
  return makeLiveDriver({
    model,
    skill: "faff-tidy",
    pluginDir,
    caseId,
    buildPrompt: (ctx, { issues, ...opts }) => buildJudgementPrompt(issues, opts),
    readEnvelope(env) {
      const cls = env.classifications ?? {};
      const pairs = [];
      for (const kind of CLOSED_SET_KINDS) {
        if (Array.isArray(cls[kind])) pairs.push({ name: kind, items: cls[kind] });
      }
      if (Array.isArray(env.ordering)) pairs.push({ name: "ordering", items: env.ordering });
      return pairs;
    },
  });
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
  // FAFF-158 — re-expressed as a wrapper over makeLiveDriver (the shared core) with NO behaviour change:
  // the prep reducer returns one { name: "reconciliation", items: [id:label, …] } pair.
  return makeLiveDriver({
    model,
    skill: "faff-prep",
    pluginDir,
    caseId,
    buildPrompt: (ctx, opts) => buildReconciliationPrompt(fixture, opts),
    readEnvelope(env) {
      const labels = env.reconciliation && typeof env.reconciliation === "object" ? env.reconciliation : {};
      return [{ name: "reconciliation", items: Object.entries(labels).map(([id, label]) => `${id}:${label}`) }];
    },
  });
}

/**
 * FAFF-154 — the reconciliation live-fixture RUNNER (the harness-wiring half AC 3 asks for). Given a
 * loaded reconciliation EvalCase (a `cases-live/reconciliation-*.json` ThreadFixture + per-comment
 * `id:label` oracle) and an injected model, it binds the case's `fixture` into reconciliationLiveDriver
 * (the inherited FAFF-158 makeLiveDriver wrapper — no driver re-cut) and drives it through the REAL
 * FAFF-93 harness via `runSkill({ skill: "faff-prep" })`, returning the recorded `reconciliation`
 * bucket so the caller can grade it through the existing `reconciliation` grade path.
 *
 * `runSkill`, `tracker`, and `repo` are injected (not imported) so eval/ stays free of test-helper
 * deps and the runner is the single place the cases reach the live-driver seam — never loadCases()'s
 * black-box CLI sweep (which has no reconciliation branch). The driver still issues the listIssues
 * seam-read, so the run is seam-faithful at the harness boundary, exactly like its two siblings.
 *
 * @param {object} evalCase a loaded reconciliation case ({ id, kind:"reconciliation", fixture, oracle })
 * @param {{ runSkill: Function, tracker: object, repo: object, model: Function,
 *           pluginDir?: string|null }} cfg
 * @returns {Promise<{ record: object, bucket: string[] }>} the DecisionRecord + the reconciliation bucket
 */
export async function driveReconciliationCase(evalCase, { runSkill, tracker, repo, model, pluginDir = DEFAULT_PLUGIN_DIR } = {}) {
  if (!evalCase || evalCase.kind !== "reconciliation" || !evalCase.fixture) {
    throw new Error("driveReconciliationCase requires a reconciliation EvalCase with a `fixture`");
  }
  if (typeof runSkill !== "function") {
    throw new Error("driveReconciliationCase requires the FAFF-93 runSkill (injected, not imported)");
  }
  const driver = reconciliationLiveDriver({ model, fixture: evalCase.fixture, pluginDir, caseId: evalCase.id });
  const record = await runSkill({ skill: "faff-prep", tracker, repo, driver });
  return { record, bucket: record.buckets.reconciliation ?? [] };
}

/**
 * FAFF-158 — a live SkillDriver for faff's ROUTING (automation-routing verdict-assignment) surface,
 * completing the execution-entangled half of the routing judgement-eval FAFF-149 carved. Reads the
 * assembled fixture-of-findings through the harness tracker seam, prompts the model with faff's
 * verbatim routing rubric (buildRoutingPrompt) + the rendered findings, parses the single assigned
 * verdict, and records it as a single-element `routing` DecisionRecord bucket — the SAME `env.verdict`
 * field the existing FAFF-149 grade path scores by single-element set-equality (no grader change).
 *
 * The third wrapper over makeLiveDriver, symmetric with reconciliationLiveDriver: `fixture` is passed
 * as a config field (the harness exposes no routing-fixture port) and the core still issues a
 * listIssues seam-read so the run is seam-faithful. A missing model / a malformed routing fixture
 * (no `issue` or `spec`) throws, mirroring validateCase's routing FIXTURE_SHAPE ["issue", "spec"].
 *
 * DESIGN NOTE: shipped as the routing live-driver DESIGN + the model-free dry-smoke (mock model →
 * driver → recorded bucket → the routing grade). The measured frontier baseline (real claude -p reps)
 * is the carved human-supervised follow-up (FAFF-131/156 pattern), recorded out-of-band, never faked.
 *
 * @param {{ model: Function, fixture: object, pluginDir?: string|null, caseId?: string }} cfg
 * @returns {{ kind: "live", drive: (ctx) => Promise<void> }}
 */
export function routingLiveDriver({ model, fixture, pluginDir = DEFAULT_PLUGIN_DIR, caseId = "live" } = {}) {
  if (typeof model !== "function") {
    throw new Error("routingLiveDriver requires a model(prompt) function (inject a mock in CI; makeLiveModel for real)");
  }
  if (!fixture || !fixture.issue || !fixture.spec) {
    throw new Error("routingLiveDriver requires a routing fixture { issue, spec, … }");
  }
  // FAFF-158 — a wrapper over makeLiveDriver: the routing reducer returns one
  // { name: "routing", items: [verdict] } pair. A missing/out-of-enum verdict yields items:[] (a
  // missing verdict) or the verbatim token (out-of-enum) → a clean grader FAIL, never a throw.
  return makeLiveDriver({
    model,
    skill: "faff-tidy",
    pluginDir,
    caseId,
    buildPrompt: (ctx, opts) => buildRoutingPrompt(fixture, opts),
    readEnvelope: (env) => [{ name: "routing", items: env.verdict == null ? [] : [String(env.verdict)] }],
  });
}
