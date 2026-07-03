// FAFF-130/FAFF-132/FAFF-133/FAFF-134 — the CLI eval driver: drives faff-tidy's judgement pass via
// `claude -p` headless, with per-run CLAUDE_CONFIG_DIR isolation so a rep never writes the parent
// session's ~/.claude.json (ADR 0003 infra finding). Returns raw stdout for envelope parse.
//
// Two presets over ONE code path (FAFF-132):
//   - frontier: `claude -p` against api.anthropic.com (the default).
//   - local:    the SAME `claude -p` invocation with ollama's Anthropic-Messages-API env
//               redirect (ANTHROPIC_BASE_URL=<ollama host>, AUTH_TOKEN=ollama, API_KEY="")
//               + --model. No new transport — ollama speaks the Anthropic API natively.
//
// FAFF-133 — load the REAL skills into the isolated run. The empty CLAUDE_CONFIG_DIR gave the
// spawned `claude` NO faff skills, so the eval measured an improvised vanilla-model judgement, not
// the shipped faff-tidy prose. Both presets now default to `--bare --plugin-dir <repo>/plugin`:
//   - --plugin-dir loads the repo's OWN plugin (skills as shipped in the commit under test,
//     namespaced /faff:faff-tidy) — the only way to load a local plugin; project .claude/skills is
//     NOT auto-loaded in -p mode, and no settings.json key exists for it.
//   - --bare skips hooks / CLAUDE.md / plugin-sync but still resolves --plugin-dir skills, keeping
//     the run clean + host-independent (and stops the repo Stop-hook firing inside the nested run).
// Pass pluginDir: null for a vanilla (skill-less) baseline.
//
// FAFF-134 — loading the plugin didn't change the measurement on its own: the prompt never invoked
// the skill, so the model improvised the rubric (smoke scored dupe 1.00 skill-less). The prompt now
// carries faff-tidy's REAL classification rubric, read verbatim from the same pluginDir's SKILL.md
// (loadTidyJudgementProse). pluginDir null still = the improvise baseline (the control).
//
// ⚠ NOT exercised in CI — eval/ is excluded from the `node --test` globs. Running a driver for
// real (~240 reps) is FAFF-131's human-supervised job. The orchestrator (run-evals.mjs) takes
// the driver as an argument, so tests inject a mock and never reach a real spawn. `buildInvocation`
// (and the *Opts factories) are PURE (no spawn/fs/clock), so a test may import this module to
// assert wiring with zero I/O.
//
// Zero-dependency: node builtins only.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// FAFF-138 — the isolated CLAUDE_CONFIG_DIR (ADR-0003) also strips the OAuth credential file, so a
// frontier `claude -p` lands "Not logged in". Forward ONLY the credential file into the per-rep
// cfgDir (mutable state stays isolated). Frontier-only: the local lane points at the ollama host, so
// it must NOT copy the real Anthropic credential to a third-party endpoint (forwardCreds: false).
// Best-effort: a missing creds file (e.g. ANTHROPIC_API_KEY env auth) is fine — leave it.
const CREDENTIALS_FILE = ".credentials.json";
export function forwardCredentials(cfgDir, { forwardCreds, credentialsSource } = {}, { copyFile = copyFileSync, chmod = chmodSync, env = process.env } = {}) {
  if (!forwardCreds) return null;
  const src = join(credentialsSource ?? env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), CREDENTIALS_FILE);
  const dst = join(cfgDir, CREDENTIALS_FILE);
  try {
    copyFile(src, dst);
    chmod(dst, 0o600); // copyFileSync doesn't preserve mode — lock the copy to owner-only (the cfgDir is already 0700)
    return dst;
  } catch {
    return null; // best-effort — no creds file to forward (API-key env auth still works)
  }
}

// The repo's own plugin (FAFF-121 relocated it to ./plugin). cli-driver.mjs lives in eval/, so the
// repo root is one level up. Using the repo plugin — not the host's installed copy — makes the eval
// measure the skills AS SHIPPED in the commit under test (reproducible).
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PLUGIN_DIR = join(REPO_ROOT, "plugin");

// FAFF-134 — the eval prompt carries faff-tidy's REAL classification rubric (verbatim from the
// shipped SKILL.md) so the model applies it instead of improvising one. The rubric is section "1. The
// mess" of faff-tidy/SKILL.md (dupe / vague / spec-health stale/superseded). Anchored on stable
// section headers; fail-loud if either moves (a refactor must consciously re-point this).
const TIDY_RUBRIC_START = "### 1. The mess (needs action)";
const TIDY_RUBRIC_END = "### 2. Ready to pick up";

// Read faff-tidy's classification rubric verbatim from the plugin under test. Returns the section
// text (incl. its START header). Throws (fail-loud) if the skill file or anchors are missing.
export function loadTidyJudgementProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-tidy", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadTidyJudgementProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(TIDY_RUBRIC_START);
  if (start === -1) throw new Error(`loadTidyJudgementProse: START anchor not found in ${skillPath}: "${TIDY_RUBRIC_START}"`);
  const end = md.indexOf(TIDY_RUBRIC_END, start + TIDY_RUBRIC_START.length);
  if (end === -1) throw new Error(`loadTidyJudgementProse: END anchor not found in ${skillPath}: "${TIDY_RUBRIC_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-140 — the eval prompt also carries faff's SYNTHESIS-GLOSS contract (verbatim from the shipped
// rendering adaptor). FAFF-134 injected only the classification section, so a `gloss` case had no
// criteria and the model improvised a health-summary instead of a one-line synthesis. Anchored on
// stable section headers in faffidavit-rendering/SKILL.md; fail-loud if either moves.
const SYNTH_GLOSS_START = "## Synthesis — the issue-gloss contract";
const SYNTH_GLOSS_END = "## Tabular data: markdown tables vs definition lists";
export function loadSynthesisGlossProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faffidavit-rendering", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadSynthesisGlossProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(SYNTH_GLOSS_START);
  if (start === -1) throw new Error(`loadSynthesisGlossProse: START anchor not found in ${skillPath}: "${SYNTH_GLOSS_START}"`);
  const end = md.indexOf(SYNTH_GLOSS_END, start + SYNTH_GLOSS_START.length);
  if (end === -1) throw new Error(`loadSynthesisGlossProse: END anchor not found in ${skillPath}: "${SYNTH_GLOSS_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-147 — the eval prompt also carries faff-tidy's SPLITTABLE-SPEC criteria (verbatim from the
// shipped skill). §5 bundles every structural diagnostic under one heading, so a verbatim read of the
// whole section would pull in unrelated prose; a dedicated `#### Splittable specs` sub-heading lets the
// loader read exactly the splittable criteria. Anchored on that sub-heading and the next `### ` heading
// (`### 6. Calibration signals`); fail-loud if either moves (a refactor must consciously re-point this).
const SPLITTABLE_START = "#### Splittable specs";
// FAFF-153 — END now anchors on the sibling `#### Chain gaps` sub-heading (added directly after the
// splittable sub-section), keeping the splittable read scoped to its own criteria. Was `### 6.
// Calibration signals` (FAFF-147); the chain-gap sub-section now sits between, so the older anchor
// would over-read. Fail-loud if either moves.
const SPLITTABLE_END = "#### Chain gaps";
export function loadTidySplittableSpecProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-tidy", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadTidySplittableSpecProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(SPLITTABLE_START);
  if (start === -1) throw new Error(`loadTidySplittableSpecProse: START anchor not found in ${skillPath}: "${SPLITTABLE_START}"`);
  const end = md.indexOf(SPLITTABLE_END, start + SPLITTABLE_START.length);
  if (end === -1) throw new Error(`loadTidySplittableSpecProse: END anchor not found in ${skillPath}: "${SPLITTABLE_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-153 — the eval prompt also carries faff-tidy's CHAIN-GAP criteria (verbatim from the shipped
// skill), the sibling `#### Chain gaps` sub-section of §5. Read between that sub-heading and the next
// `### ` heading (`### 6. Calibration signals`); fail-loud if either moves (a refactor must consciously
// re-point this — the loadTidySplittableSpecProse contract).
const CHAIN_GAP_START = "#### Chain gaps";
const CHAIN_GAP_END = "### 6. Calibration signals";
export function loadTidyChainGapProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-tidy", "SKILL.md");
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`loadTidyChainGapProse: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(CHAIN_GAP_START);
  if (start === -1) throw new Error(`loadTidyChainGapProse: START anchor not found in ${skillPath}: "${CHAIN_GAP_START}"`);
  const end = md.indexOf(CHAIN_GAP_END, start + CHAIN_GAP_START.length);
  if (end === -1) throw new Error(`loadTidyChainGapProse: END anchor not found in ${skillPath}: "${CHAIN_GAP_END}"`);
  return md.slice(start, end).trim();
}

// FAFF-140/FAFF-147 — the full judgement criteria the eval measures, verbatim from the shipped skills:
// classification (faff-tidy "The mess") + the synthesis-gloss contract (faffidavit-rendering) + the
// splittable-spec criteria (faff-tidy §5). All three are folded in so any case kind finds its criteria;
// the model is told (EVAL_MODE_INSTRUCTION) to emit only the fields its judgement produced.
export function loadJudgementCriteria(pluginDir = DEFAULT_PLUGIN_DIR) {
  return `${loadTidyJudgementProse(pluginDir)}\n\n${loadSynthesisGlossProse(pluginDir)}\n\n${loadTidySplittableSpecProse(pluginDir)}`;
}

// FAFF-146 — generic verbatim section extractor (the loadTidyJudgementProse contract: fail-loud if
// the file or either anchor moves, so a prose refactor must consciously re-point the loader).
function extractSection(skillPath, startAnchor, endAnchor, label) {
  let md;
  try {
    md = readFileSync(skillPath, "utf8");
  } catch (e) {
    throw new Error(`${label}: cannot read ${skillPath}: ${e.message}`);
  }
  const start = md.indexOf(startAnchor);
  if (start === -1) throw new Error(`${label}: START anchor not found in ${skillPath}: "${startAnchor}"`);
  const end = md.indexOf(endAnchor, start + startAnchor.length);
  if (end === -1) throw new Error(`${label}: END anchor not found in ${skillPath}: "${endAnchor}"`);
  return md.slice(start, end).trim();
}

// FAFF-146 — prep CONFIDENCE rubric, verbatim from faffter-dark-nlspec/SKILL.md "## Confidence
// self-rating" (the high/medium/low definitions). The black-box confidence surface folds this in so
// the model applies the shipped rubric rather than improvising a level.
const CONFIDENCE_RUBRIC_START = "## Confidence self-rating";
const CONFIDENCE_RUBRIC_END = "## Contract artifact";
export function loadConfidenceRubricProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faffter-dark-nlspec", "SKILL.md");
  return extractSection(skillPath, CONFIDENCE_RUBRIC_START, CONFIDENCE_RUBRIC_END, "loadConfidenceRubricProse");
}

// FAFF-146 — prep MARKER dialect, verbatim from faff/SKILL.md "### Spec readiness (fixed)" (the
// **Chosen**/**Punt**/**Assumes** classification). The black-box marker surface folds this in.
const MARKER_DIALECT_START = "### Spec readiness (fixed)";
const MARKER_DIALECT_END = "**The producer emits, the consumer parses.**";
export function loadMarkerDialectProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff", "SKILL.md");
  return extractSection(skillPath, MARKER_DIALECT_START, MARKER_DIALECT_END, "loadMarkerDialectProse");
}

// FAFF-146 — prep RECONCILIATION rubric, verbatim from faff-prep/SKILL.md "Step 2a" (the
// Challenge / Resolution / Context / Noise classification of post-spec comments). This is the
// execution-entangled surface: it rides the LIVE-DRIVER lane (see eval/live-driver.mjs), not the
// black-box lane — the loader lives here so the verbatim-extraction contract stays single-sourced.
const RECONCILIATION_RUBRIC_START = "**Step 2a: Scan comments since the spec";
const RECONCILIATION_RUBRIC_END = "**Step 2b:";
export function loadReconciliationProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-prep", "SKILL.md");
  return extractSection(skillPath, RECONCILIATION_RUBRIC_START, RECONCILIATION_RUBRIC_END, "loadReconciliationProse");
}

// FAFF-148 — the review-verdict rubric, verbatim from the shipped review producer + the gateway's
// fixed revert-test statement. This is the criteria the verdict-revert (revert-test discrimination)
// eval measures: given a DESCRIBED finding, decide `fail` (a defect `git revert` undoes) vs
// `needs-human` (an effect that persists after revert). Two verbatim sources, folded:
//   - faffter-noon-review/SKILL.md: "### 5. Human-judgement flag" THROUGH the "## Output" that follows
//     "## Verdict rules" (so the model gets pass-5 + the revert test (line 103) + the verdict mapping).
//   - faff/SKILL.md: the "### Review verdict (fixed)" section (so it has the CANONICAL revert-test
//     statement + the malformed→needs-human contract, not only the producer's restatement).
// Anchored on stable headers; fail-loud if any anchor moves (the loadTidyJudgementProse contract).
const REVIEW_VERDICT_START = "### 5. Human-judgement flag";
const REVIEW_VERDICT_END = "## Output";          // the "## Output" that FOLLOWS "## Verdict rules"
const GATEWAY_VERDICT_START = "### Review verdict (fixed)";
const GATEWAY_VERDICT_END = "### Delivery outcome (fixed)";

function sliceAnchored(md, skillPath, label, startAnchor, endAnchor) {
  const start = md.indexOf(startAnchor);
  if (start === -1) throw new Error(`${label}: START anchor not found in ${skillPath}: "${startAnchor}"`);
  const end = md.indexOf(endAnchor, start + startAnchor.length);
  if (end === -1) throw new Error(`${label}: END anchor not found in ${skillPath}: "${endAnchor}"`);
  return md.slice(start, end).trim();
}

export function loadReviewVerdictProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const reviewPath = join(pluginDir, "skills", "faffter-noon-review", "SKILL.md");
  const gatewayPath = join(pluginDir, "skills", "faff", "SKILL.md");
  let reviewMd, gatewayMd;
  try {
    reviewMd = readFileSync(reviewPath, "utf8");
  } catch (e) {
    throw new Error(`loadReviewVerdictProse: cannot read ${reviewPath}: ${e.message}`);
  }
  try {
    gatewayMd = readFileSync(gatewayPath, "utf8");
  } catch (e) {
    throw new Error(`loadReviewVerdictProse: cannot read ${gatewayPath}: ${e.message}`);
  }
  const reviewRubric = sliceAnchored(reviewMd, reviewPath, "loadReviewVerdictProse(review)", REVIEW_VERDICT_START, REVIEW_VERDICT_END);
  const gatewayContract = sliceAnchored(gatewayMd, gatewayPath, "loadReviewVerdictProse(gateway)", GATEWAY_VERDICT_START, GATEWAY_VERDICT_END);
  return `${gatewayContract}\n\n---\n\n${reviewRubric}`;
}

// FAFF-149 — the AUTOMATION-ROUTING verdict rubric, verbatim from BOTH shipped sources, folded the
// same two-source way loadReviewVerdictProse does (gateway = the fixed contract; the adaptor = the
// assignment conditions). This is the criteria the `routing` (verdict-assign) eval measures: given an
// assembled fixture-of-findings, assign exactly one of the closed SIX verdicts.
//   - faff/SKILL.md: "### Automation-routing verdict (fixed) → `routing_adaptor`" THROUGH the next
//     "### Spec readiness (fixed)" — the closed-six vocabulary + the admission rule + the root-cause
//     enum + the live-thread-reconciliation rule.
//   - faffidavit-routing/SKILL.md: "## The six verdicts (non-normative recap for assignment)" THROUGH
//     "## Validate — wired to the contract script (FAFF-80)" — the per-verdict ASSIGNMENT CONDITIONS
//     (incl. the `likely-fire` collision-group rule) + the display format.
// Anchored on stable headers; fail-loud if any anchor moves (the loadTidyJudgementProse contract).
const GATEWAY_ROUTING_START = "### Automation-routing verdict (fixed) → `routing_adaptor`";
const GATEWAY_ROUTING_END = "### Spec readiness (fixed)";
const ADAPTOR_ROUTING_START = "## The six verdicts (non-normative recap for assignment)";
const ADAPTOR_ROUTING_END = "## Validate — wired to the contract script (FAFF-80)";

export function loadRoutingVerdictProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const gatewayPath = join(pluginDir, "skills", "faff", "SKILL.md");
  const adaptorPath = join(pluginDir, "skills", "faffidavit-routing", "SKILL.md");
  let gatewayMd, adaptorMd;
  try {
    gatewayMd = readFileSync(gatewayPath, "utf8");
  } catch (e) {
    throw new Error(`loadRoutingVerdictProse: cannot read ${gatewayPath}: ${e.message}`);
  }
  try {
    adaptorMd = readFileSync(adaptorPath, "utf8");
  } catch (e) {
    throw new Error(`loadRoutingVerdictProse: cannot read ${adaptorPath}: ${e.message}`);
  }
  const gatewayContract = sliceAnchored(gatewayMd, gatewayPath, "loadRoutingVerdictProse(gateway)", GATEWAY_ROUTING_START, GATEWAY_ROUTING_END);
  const adaptorConditions = sliceAnchored(adaptorMd, adaptorPath, "loadRoutingVerdictProse(adaptor)", ADAPTOR_ROUTING_START, ADAPTOR_ROUTING_END);
  return `${gatewayContract}\n\n---\n\n${adaptorConditions}`;
}

// FAFF-150 — the jot/intake MODE-DETECTION rubric, verbatim from BOTH shipped sources, folded the
// same two-source way loadReviewVerdictProse / loadRoutingVerdictProse do. This is the criteria the
// `modedetect` (greenfield/single-item/ambiguous) eval measures: given a ModeScenario, assign exactly
// one mode.
//   - faff-jot/SKILL.md: "### 1. Detect the mode" THROUGH "### 2. Discover" — jot's own greenfield /
//     single-item rule + the genuine-ambiguity ("ask once") branch.
//   - faffter-noon-intake/SKILL.md: "### `greenfield` mode" THROUGH "## Output" — intake's
//     greenfield/single-item mode definitions, appended so the call is not underspecified by the jot
//     section alone (the spec's "append intake's defs if needed").
// Anchored on stable headers; fail-loud if any anchor moves (the loadTidyJudgementProse contract).
const JOT_MODE_START = "### 1. Detect the mode";
const JOT_MODE_END = "### 2. Discover";
const INTAKE_MODE_START = "### `greenfield` mode";
const INTAKE_MODE_END = "## Output";
export function loadModeDetectProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const jotPath = join(pluginDir, "skills", "faff-jot", "SKILL.md");
  const intakePath = join(pluginDir, "skills", "faffter-noon-intake", "SKILL.md");
  let jotMd, intakeMd;
  try {
    jotMd = readFileSync(jotPath, "utf8");
  } catch (e) {
    throw new Error(`loadModeDetectProse: cannot read ${jotPath}: ${e.message}`);
  }
  try {
    intakeMd = readFileSync(intakePath, "utf8");
  } catch (e) {
    throw new Error(`loadModeDetectProse: cannot read ${intakePath}: ${e.message}`);
  }
  const jotRule = sliceAnchored(jotMd, jotPath, "loadModeDetectProse(jot)", JOT_MODE_START, JOT_MODE_END);
  const intakeDefs = sliceAnchored(intakeMd, intakePath, "loadModeDetectProse(intake)", INTAKE_MODE_START, INTAKE_MODE_END);
  return `${jotRule}\n\n---\n\n${intakeDefs}`;
}

// FAFF-161 — the jot/plot TICKET-SHAPING rubric, verbatim from the shipped jot SKILL.md "### 3. Shape
// into tickets" THROUGH "### 4. Confirm and create" (the methodology-driven structuring: workstreams /
// containers, ticket boundaries, sequencing, dependency links — what a CORRECT shaping must surface).
// This is the criteria the `shaping` generative coverage eval measures. Anchored on stable headers;
// fail-loud if either moves (the loadModeDetectProse contract — a refactor must consciously re-point).
const SHAPING_START = "### 3. Shape into tickets — apply the `methodology` slot";
const SHAPING_END = "### 4. Confirm and create";
export function loadShapingProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-jot", "SKILL.md");
  return extractSection(skillPath, SHAPING_START, SHAPING_END, "loadShapingProse");
}

// FAFF-161 — the plot DECOMPOSITION rubric, verbatim from the shipped plot SKILL.md "### 2. Recurse
// top-down" THROUGH "### 4. Per-level gating" — the top-down decomposition rule incl. §3 the STOP RULE
// (the parent-link / stop-past-first-slice / dependency-link invariants the structural checks assert).
// This is the criteria the `decomposition` generative coverage eval measures. Anchored on stable
// headers; fail-loud if either moves (the loadModeDetectProse contract).
const DECOMP_START = "### 2. Recurse top-down";
const DECOMP_END = "### 4. Per-level gating";
export function loadDecompositionProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faff-plot", "SKILL.md");
  return extractSection(skillPath, DECOMP_START, DECOMP_END, "loadDecompositionProse");
}

// FAFF-203 — the Edit A rendering rule, verbatim from the shipped faffidavit-rendering SKILL.md
// "## Lead with the load-bearing model" THROUGH "## Synthesis — the issue-gloss contract" (lead with
// the governing model first, then mechanism → method → so-what — the ordering an explanatory-order
// case is graded against). This is the criteria the `explanatory-order` eval measures. Anchored on
// stable headers; fail-loud if either moves (the loadModeDetectProse contract — a rendering-adaptor
// refactor must consciously re-point this eval, never silently de-couple it).
const LEAD_WITH_MODEL_START = "## Lead with the load-bearing model";
const LEAD_WITH_MODEL_END = "## Synthesis — the issue-gloss contract";
export function loadLeadWithModelProse(pluginDir = DEFAULT_PLUGIN_DIR) {
  const skillPath = join(pluginDir, "skills", "faffidavit-rendering", "SKILL.md");
  return extractSection(skillPath, LEAD_WITH_MODEL_START, LEAD_WITH_MODEL_END, "loadLeadWithModelProse");
}

// Exported (FAFF-135) so the live driver shares the single source of the envelope contract.
// FAFF-137 — output-ONLY hardening: reasoning models (e.g. qwen3.6) otherwise emit a long reasoning
// preamble in the content before the block, which dominates wall time and risks a num_predict cap
// truncating the block away. Force-fit terseness via the instruction (the answer stays intact); the
// "exactly that tag, not ```json" line also lifts format-adherence (FAFF-137 classify-fallback).
export const EVAL_MODE_INSTRUCTION =
  "Run faff-tidy's judgement pass over this fixture internally, then OUTPUT ONLY one fenced code " +
  "block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "classifications": { "dupe": [..], "vague": [..], "stale": [..], "superseded": [..] }, ' +
  '"ordering": ["<issue-id>", ..], "gloss": { "<issue-id>": "<one-line gloss>" }, ' +
  '"splittable": ["<concern-label>", ..] } — for a splittable-spec case, `splittable` is the list of the ' +
  "structurally-independent concern labels the spec covers (an empty list [] means the spec is NOT splittable — " +
  "one cohesive concern). Include only the fields your " +
  "judgement produced, using the fixture's issue ids. Output NOTHING except that single block: no reasoning, " +
  "no preamble, no prose, nothing before or after it.";

// FAFF-146 — the prep classification surfaces (confidence + marker) emit their own envelope field,
// so each needs its own envelope instruction (the FAFF-134 anti-pattern: a new field is wired at
// both ends). Same output-only hardening as EVAL_MODE_INSTRUCTION.
export const CONFIDENCE_MODE_INSTRUCTION =
  "Rate this spec's confidence by the rubric above, then OUTPUT ONLY one fenced code block tagged " +
  "exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "confidence": "<high|medium|low>" } — exactly one level. Output NOTHING ' +
  "except that single block: no reasoning, no preamble, no prose, nothing before or after it.";
export const MARKER_MODE_INSTRUCTION =
  "Classify each identified decision section by the marker dialect above, then OUTPUT ONLY one fenced " +
  "code block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "markers": { "<section-key>": "chosen|punt|assumes|none", ... } } — one entry per ' +
  "section, using the section keys from the fixture. Output NOTHING except that single block: no reasoning, " +
  "no preamble, no prose, nothing before or after it.";

// FAFF-148 — the envelope instruction for the verdict-revert (revert-test discrimination) surface.
// The model classifies EACH described finding `fail` vs `needs-human` by the revert test, emitting a
// `verdicts` object keyed by the finding key. Same OUTPUT-ONLY hardening as EVAL_MODE_INSTRUCTION.
export const VERDICT_REVERT_INSTRUCTION =
  "For each finding, apply the revert test and decide its verdict: `fail` if a `git revert` of the " +
  "change fully undoes the finding's effect (a defect), or `needs-human` if the effect persists after " +
  "revert (judgement / irreversible). Then OUTPUT ONLY one fenced code block tagged exactly " +
  "`faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "verdicts": { "<finding-key>": "fail|needs-human", ... } } — one entry per ' +
  "finding, using the fixture's finding keys. Output NOTHING except that single block: no reasoning, " +
  "no preamble, no prose, nothing before or after it.";

// FAFF-149 — the envelope instruction for the routing (verdict-assign) surface. The model assigns
// EXACTLY ONE of the closed six verdicts to the assembled fixture-of-findings, emitting a single
// `verdict` field (the confidence analogue — one level → one verdict). Same OUTPUT-ONLY hardening.
export const ROUTING_MODE_INSTRUCTION =
  "Apply the automation-routing assignment conditions above to this assembled fixture-of-findings and " +
  "assign EXACTLY ONE of the closed six verdicts (fire-and-forget, likely-fire, needs-decision-first, " +
  "gap-blocked, circular-blocked, repeat-parked). Then OUTPUT ONLY one fenced code block tagged " +
  "exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "verdict": "<one of the six>" } — exactly one verdict. Output NOTHING ' +
  "except that single block: no reasoning, no preamble, no prose, nothing before or after it.";

// FAFF-155 — the envelope instruction for the verdict-build (whole-change review verdict) surface. The
// model applies the review-verdict rubric (loadReviewVerdictProse) to the rendered change and assigns
// EXACTLY ONE of pass / fail / needs-human by the revert test, emitting a single `verdict` field (the
// SAME field routing uses — one verdict → a one-element set). Same OUTPUT-ONLY hardening as the siblings.
export const VERDICT_BUILD_INSTRUCTION =
  "Apply the review-verdict rubric above to this whole change and assign EXACTLY ONE verdict by the " +
  "revert test: `pass` (the diff matches its spec, ACs covered, nothing flagged), `fail` (a fixable " +
  "defect a `git revert` on the merge commit fully undoes — failing tests, missing coverage, an obvious " +
  "bug, scope creep), or `needs-human` (genuine human judgement — a product call, a security/privacy " +
  "concern, an effect that persists AFTER revert, a spec gap respec can't close). Then OUTPUT ONLY one " +
  "fenced code block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the " +
  'shape { "case_id": "<ID>", "verdict": "pass|fail|needs-human" } — exactly one verdict. Output NOTHING ' +
  "except that single block: no reasoning, no preamble, no prose, nothing before or after it.";

// FAFF-150 — the envelope instruction for the modedetect surface. The model classifies the
// ModeScenario as EXACTLY ONE of greenfield / single-item / ambiguous, emitting a single `mode`
// field (the confidence/routing analogue — one verdict → a one-element set). Same OUTPUT-ONLY
// hardening as EVAL_MODE_INSTRUCTION.
export const MODE_EVAL_INSTRUCTION =
  "Apply jot's mode-detection rule above to this scenario and decide EXACTLY ONE mode: greenfield " +
  "(kicking off an empty/new project, no tracker container yet), single-item (one feature/bug/change " +
  "inside an existing project), or ambiguous (an existing project but big cross-cutting work where " +
  "jot's rule says ask once). Then OUTPUT ONLY one fenced code block tagged exactly " +
  "`faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "mode": "greenfield|single-item|ambiguous" } — exactly one mode. Output ' +
  "NOTHING except that single block: no reasoning, no preamble, no prose, nothing before or after it.";

// FAFF-161 — the envelope instruction for the `shaping` generative surface. The model emits the
// ticket-boundary set it would shape from the brief, as a `shaping` array of one-line ticket glosses.
// The grader scores must_include/must_avoid synonym-set coverage over them. Same OUTPUT-ONLY hardening.
export const SHAPING_MODE_INSTRUCTION =
  "Run jot/plot's ticket-shaping over the brief above, then OUTPUT ONLY one fenced code block tagged " +
  "exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "shaping": ["<one-line ticket gloss>", ...] } — one entry per ticket you would ' +
  "shape from the brief (its boundary as a one-line gloss). Output NOTHING except that single block: no " +
  "reasoning, no preamble, no prose, nothing before or after it.";

// FAFF-161 — the envelope instruction for the `decomposition` generative surface. The model emits the
// top-down decomposition TREE it would produce from the brief. The grader scores coverage over the
// tree's titles AND the three structural assertions (parent-link, stop-rule, DAG). OUTPUT-ONLY hardened.
export const DECOMPOSITION_MODE_INSTRUCTION =
  "Run plot's top-down decomposition over the brief above (initiatives → projects → first-slice epics), " +
  "then OUTPUT ONLY one fenced code block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) " +
  'containing JSON of the shape { "case_id": "<ID>", "decomposition": { "initiatives": [{ "id", "title" }, ...], ' +
  '"projects": [{ "id", "parent", "title" }, ...], "epics": [{ "id", "parent", "slice", "title" }, ...], ' +
  '"deps": [["<from-id>", "<to-id>"], ...] } } — every epic links to a parent project; mark first-slice ' +
  'epics with "slice": "first-slice" and do NOT recurse past the first slice; `deps` are the directed ' +
  "dependency edges (they must form a DAG). Output NOTHING except that single block: no reasoning, no " +
  "preamble, no prose, nothing before or after it.";

// FAFF-153 — the envelope instruction for the `chain-gap` prose-parsing surface. The model reads the
// spec's implementation-advice prose, identifies references no ticket tracks, classifies each, applies
// the conservative skips, and emits a `chain_gap` array of { reference, sub_type } pairs ([] when no
// real gap remains). Same OUTPUT-ONLY hardening as EVAL_MODE_INSTRUCTION.
export const CHAIN_GAP_INSTRUCTION =
  "Run faff-tidy's chain-gap prose parsing over the spec above: identify the references its " +
  "implementation advice names but no ticket tracks, classify each, and apply the conservative skips. " +
  "Then OUTPUT ONLY one fenced code block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) " +
  'containing JSON of the shape { "case_id": "<ID>", "chain_gap": [{ "reference": "<the referenced work>", ' +
  '"sub_type": "upstream|downstream|peer|sub-ticket" }, ...] } — one entry per real chain gap, with ' +
  "`sub_type` exactly one of upstream / downstream / peer / sub-ticket. Emit an empty list [] when there " +
  "is NO real gap after the conservative skips (illustrative-only, explicitly-disclaimed future work, " +
  "in-scope-for-this-PR, unitary-spec-no-reference). Output NOTHING except that single block: no " +
  "reasoning, no preamble, no prose, nothing before or after it.";

// FAFF-203 — the envelope instruction for the `explanatory-order` surface. The model orders the
// SCRAMBLED explanatory segments lead-with-the-model first, then mechanism → method → so-what, emitting
// the ordered segment-id list in the SAME `ordering` field the `ordering` kind uses (so the grader
// reads it through the shared ordering arm). Same OUTPUT-ONLY hardening as EVAL_MODE_INSTRUCTION.
export const EXPLANATORY_ORDER_INSTRUCTION =
  "Apply the \"lead with the load-bearing model\" rule above to the scrambled explanation segments: " +
  "order them so the segment stating the governing load-bearing model comes FIRST, then concrete " +
  "mechanism → how it's measured/used → what it means (so-what). Then OUTPUT ONLY one fenced code " +
  "block tagged exactly `faff-eval:judgement` (that tag, NOT ```json) containing JSON of the shape " +
  '{ "case_id": "<ID>", "ordering": ["<segment-id>", ...] } — the segment ids in your chosen order, ' +
  "using the ids from the fixture. Output NOTHING except that single block: no reasoning, no preamble, " +
  "no prose, nothing before or after it.";

// FAFF-146 — per-kind eval-mode instruction. Tidy's six kinds keep EVAL_MODE_INSTRUCTION verbatim;
// prep's two black-box surfaces get their own envelope-shape instruction. (verdict-revert is routed
// to VERDICT_REVERT_INSTRUCTION directly in buildEvalPrompt, so it isn't listed here.)
function modeInstructionFor(kind) {
  if (kind === "confidence") return CONFIDENCE_MODE_INSTRUCTION;
  if (kind === "marker") return MARKER_MODE_INSTRUCTION;
  if (kind === "routing") return ROUTING_MODE_INSTRUCTION;
  if (kind === "modedetect") return MODE_EVAL_INSTRUCTION;
  if (kind === "shaping") return SHAPING_MODE_INSTRUCTION;
  if (kind === "decomposition") return DECOMPOSITION_MODE_INSTRUCTION;
  if (kind === "chain-gap") return CHAIN_GAP_INSTRUCTION;
  if (kind === "explanatory-order") return EXPLANATORY_ORDER_INSTRUCTION;
  return EVAL_MODE_INSTRUCTION;
}

// `judgementProse` (when present) is faff's verbatim judgement criteria — prepended so the model
// applies the shipped rules. Absent (the --no-plugin baseline) → the bare improvise-it prompt (the
// control). FAFF-146 — the framing + fixture rendering is per-kind: tidy kinds run over a backlog;
// confidence reads a spec body; marker reads identified decision sections. FAFF-148 — verdict-revert
// renders described findings via renderVerdictRevertPrompt with the review-verdict rubric.
function renderFixturePrompt(c, judgementProse = null) {
  const rubric = judgementProse
    ? `Apply faff's judgement criteria below — these are the skills' own rules, verbatim:\n\n${judgementProse}\n\n---\n\n`
    : "";
  if (c.kind === "confidence") {
    return (
      `${rubric}Run faff-prep's confidence self-rating on the following spec and answer: ${c.question}\n\n` +
      `Spec body:\n${c.fixture.spec_body}`
    );
  }
  if (c.kind === "marker") {
    return (
      `${rubric}Run faff-prep's decision-marker classification on the following spec sections and answer: ${c.question}\n\n` +
      `Decision sections:\n${JSON.stringify(c.fixture.sections, null, 2)}`
    );
  }
  if (c.kind === "routing") {
    return (
      `${rubric}Assign the automation-routing verdict over the following assembled fixture-of-findings and answer: ${c.question}\n\n` +
      `Assembled fixture-of-findings:\n${JSON.stringify(c.fixture, null, 2)}`
    );
  }
  if (c.kind === "modedetect") {
    return (
      `${rubric}Run jot's mode detection on the following scenario and answer: ${c.question}\n\n` +
      `Mode scenario:\n${JSON.stringify(c.fixture, null, 2)}`
    );
  }
  // FAFF-161 — shaping/decomposition render the discovery brief the surface shapes from. The fixture
  // carries a `brief` (the rendered discovery brief); fall back to the whole fixture if absent.
  if (c.kind === "shaping") {
    return (
      `${rubric}Run jot/plot's ticket-shaping on the following discovery brief and answer: ${c.question}\n\n` +
      `Discovery brief:\n${c.fixture.brief ?? JSON.stringify(c.fixture, null, 2)}`
    );
  }
  if (c.kind === "decomposition") {
    return (
      `${rubric}Run plot's top-down decomposition on the following discovery brief and answer: ${c.question}\n\n` +
      `Discovery brief:\n${c.fixture.brief ?? JSON.stringify(c.fixture, null, 2)}`
    );
  }
  // FAFF-153 — chain-gap feeds the raw spec prose (the full-pipeline parse). The fixture mirrors the
  // splittable shape (a `{ version, issues: [{ id, title, spec }] }` backlog), so render it the same
  // tracker-shape way; the CHAIN_GAP_INSTRUCTION tells the model to parse the implementation advice.
  if (c.kind === "chain-gap") {
    return (
      `${rubric}Run faff-tidy's chain-gap prose parsing on the following active ticket and answer: ${c.question}\n\n` +
      `Fixture (FAFF-89 tracker shape):\n${JSON.stringify(c.fixture, null, 2)}`
    );
  }
  // FAFF-203 — explanatory-order renders the SCRAMBLED segments as a labelled `id: text` list the
  // model must order. The rubric (Edit A prose, via criteriaFor) leads; the segments + question follow.
  if (c.kind === "explanatory-order") {
    const segments = (c.fixture.segments || [])
      .map((s) => `${s.id}: ${s.text}`)
      .join("\n");
    return (
      `${rubric}Order the following scrambled explanation segments per the rule above and answer: ${c.question}\n\n` +
      `Segments (scrambled):\n${segments}`
    );
  }
  return (
    `${rubric}Run faff-tidy's judgement pass on the following backlog fixture and answer: ${c.question}\n\n` +
    `Fixture (FAFF-89 tracker shape):\n${JSON.stringify(c.fixture, null, 2)}`
  );
}

// FAFF-146 — resolve the verbatim criteria for a case's kind from the plugin under test. Tidy's six
// kinds use the combined classification + synthesis-gloss criteria (unchanged); confidence + marker
// use their own prep rubric; verdict-revert (FAFF-148) uses the review-verdict rubric — so each
// black-box surface measures the shipped prose it gates on.
// pluginDir null (the --no-plugin baseline) → no criteria → the model improvises (the control).
export function criteriaFor(kind, pluginDir = DEFAULT_PLUGIN_DIR) {
  if (!pluginDir) return null;
  if (kind === "confidence") return loadConfidenceRubricProse(pluginDir);
  if (kind === "marker") return loadMarkerDialectProse(pluginDir);
  if (kind === "verdict-revert") return loadReviewVerdictProse(pluginDir);
  if (kind === "routing") return loadRoutingVerdictProse(pluginDir);
  if (kind === "modedetect") return loadModeDetectProse(pluginDir);
  if (kind === "shaping") return loadShapingProse(pluginDir);
  if (kind === "decomposition") return loadDecompositionProse(pluginDir);
  if (kind === "chain-gap") return loadTidyChainGapProse(pluginDir);
  if (kind === "explanatory-order") return loadLeadWithModelProse(pluginDir);
  return loadJudgementCriteria(pluginDir);
}

// FAFF-148 — render a verdict-revert case: the review-verdict rubric (verbatim) + the described-finding
// fixture (change_summary + findings[]) + the question. `verdictProse` null (the --no-plugin baseline)
// → bare improvise prompt (the control), mirroring renderFixturePrompt.
function renderVerdictRevertPrompt(c, verdictProse = null) {
  const rubric = verdictProse
    ? `Apply faff's review-verdict rubric below — these are faff's own rules, verbatim:\n\n${verdictProse}\n\n---\n\n`
    : "";
  return (
    `${rubric}Classify each review finding below and answer: ${c.question}\n\n` +
    `Change + findings:\n${JSON.stringify(c.fixture, null, 2)}`
  );
}

// Rough token proxy for the spike's cost column; FAFF-131 can replace with claude -p's reported usage.
export const estimateTokens = (s) => Math.ceil(String(s ?? "").length / 4);

// FAFF-144/FAFF-148 — the full eval prompt for a case (criteria + fixture + the envelope instruction),
// factored out of makeCliDriver so any driver (claude -p OR a direct ollama POST) builds it the same.
// FAFF-146/148 — the envelope instruction is per-kind. verdict-revert uses the review-verdict rubric +
// its verdict-shaped envelope; confidence/marker carry their own field (modeInstructionFor); the tidy
// kinds keep EVAL_MODE_INSTRUCTION.
export function buildEvalPrompt(evalCase, criteria = null) {
  if (evalCase.kind === "verdict-revert") {
    return `${renderVerdictRevertPrompt(evalCase, criteria)}\n\n${VERDICT_REVERT_INSTRUCTION.replace("<ID>", evalCase.id)}`;
  }
  return `${renderFixturePrompt(evalCase, criteria)}\n\n${modeInstructionFor(evalCase.kind).replace("<ID>", evalCase.id)}`;
}

// PURE: resolve the exact { bin, args, env } to spawn. No spawn, no fs, no clock — so a test can
// import this and assert preset wiring (--model / --bare / --plugin-dir / ollama env) with zero I/O.
export function buildInvocation(opts, prompt, cfgDir) {
  const { bin = "claude", model = null, env = {}, bare = false, pluginDir = null } = opts ?? {};
  const args = [
    "-p",
    prompt,
    ...(model ? ["--model", model] : []),
    ...(bare ? ["--bare"] : []),
    ...(pluginDir ? ["--plugin-dir", pluginDir] : []),
  ];
  return { bin, args, env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: cfgDir } };
}

// Generic factory. opts: { bin, model, baseUrl, env, bare, pluginDir }. The closure spawns;
// importing this does not.
export function makeCliDriver(opts = {}) {
  return async function cliDriver(evalCase, repIndex) {
    const cfgDir = mkdtempSync(join(tmpdir(), `faff-eval-${evalCase.id}-${repIndex}-`));
    try {
      forwardCredentials(cfgDir, opts); // FAFF-138: frontier auth survives the isolation; local skips
      // FAFF-146/148: criteria resolved per-case kind via the module-level criteriaFor
      // (tidy → combined; confidence/marker → prep rubric; verdict-revert → review-verdict rubric).
      const prompt = buildEvalPrompt(evalCase, criteriaFor(evalCase.kind, opts.pluginDir));
      const inv = buildInvocation(opts, prompt, cfgDir);
      const res = spawnSync(inv.bin, inv.args, {
        env: inv.env, // isolation (CLAUDE_CONFIG_DIR) + any preset redirect — no parent ~/.claude.json write
        cwd: cfgDir, // FAFF-138: clean cwd → no project CLAUDE.md/hooks pulled in (replaces --bare's isolation)
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      if (res.error) throw new Error(`cli driver (${inv.bin}): ${res.error.message}`);
      // rawText is captured (a string) — the cfgDir is no longer needed; the malformed-output snippet
      // (recorded by run-evals on an envelope error) is the errored-rep diagnostic, not the cfgDir.
      return { rawText: res.stdout ?? "", tokens: estimateTokens(res.stdout) };
    } finally {
      // FAFF-139: remove the per-rep cfgDir (+ its forwarded credential copy) — never leave 200+
      // dirs with OAuth creds in tmp. Best-effort; runs on success AND on throw.
      try { rmSync(cfgDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  };
}

// PURE opts resolvers (separated from the spawning factory so the preset defaults — including the
// repo plugin + --bare — are unit-testable without spawning).

// Preset: frontier — `claude -p` against the Anthropic API. Loads the repo skills by default
// (FAFF-133); pass pluginDir: null for a vanilla skill-less baseline. forwardCreds: true (FAFF-138)
// so the real OAuth credential reaches the isolated cfgDir.
// bare: false — FAFF-138: `--bare` is incompatible with OAuth-credential auth (it only honors
// env-token auth, which is why the local lane works under it). Frontier reads `.credentials.json`,
// so it must NOT pass `--bare`; isolation comes from the fresh CLAUDE_CONFIG_DIR + clean spawn cwd
// (project hooks/CLAUDE.md aren't pulled in). `--plugin-dir` alone still loads the skills.
// FAFF-315: `model` is threaded through so the frontier lane can be PINNED (never the account
// default — the eval-bulk budget guard). buildInvocation already emits `--model` when set.
export function frontierOpts({ bin = "claude", model = null, bare = false, pluginDir = DEFAULT_PLUGIN_DIR, forwardCreds = true } = {}) {
  return { bin, model, bare, pluginDir, forwardCreds };
}
export function frontierDriver(args = {}) {
  return makeCliDriver(frontierOpts(args));
}

// Preset: local — the SAME `claude -p` path with ollama's Anthropic-API env redirect + --model.
// `baseUrl` is REQUIRED — there is deliberately no localhost default (ollama is served over Tailscale).
export function localOpts({ baseUrl, model, bin = "claude", bare = true, pluginDir = DEFAULT_PLUGIN_DIR } = {}) {
  if (!baseUrl) throw new Error("localDriver requires a baseUrl (the ollama host); no localhost default");
  return {
    bin,
    model,
    baseUrl,
    bare,
    pluginDir,
    forwardCreds: false, // FAFF-138 SECURITY: never copy the real Anthropic credential to the ollama host
    env: { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: "ollama", ANTHROPIC_API_KEY: "" },
  };
}
export function localDriver(args = {}) {
  return makeCliDriver(localOpts(args));
}
