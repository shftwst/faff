// FAFF-130/FAFF-137 — parse the `faff-eval:judgement` fenced block faff-tidy emits in eval mode.
// Judgement capture stays OUT of the seam DecisionRecord / FAFF-95 matchers (spec Decision 1):
// this is the eval-only out-of-band channel.
//
// FAFF-137 — strict + classify fallback. Smaller/local models often fence the (correct) judgement
// as ```json instead of the exact ```faff-eval:judgement tag, which the strict parse rejected. We:
//   1. take the exact tag when present  -> { ...env, format: "compliant" }  (a MALFORMED tagged
//      block still fails loud — that's a real producer error, not a mis-tag);
//   2. else recover the LAST fenced block whose JSON is a valid envelope (case_id matching
//      expectedCaseId when supplied) -> { ...env, format: "noncompliant" } (recovered, but flagged);
//   3. else throw EnvelopeError (no judgement at all -> the orchestrator records the rep `errored`).
// The `format` flag is the load-bearing signal: judgement accuracy/flakiness isn't lost to a
// formatting quirk, but weak format-following stays a measured per-model property (format_adherence).
//
// FAFF-147 — the envelope is a generic JSON object: any judgement field the model emits
// (`classifications` / `ordering` / `gloss` / `splittable`) passes through verbatim, so the new
// `splittable` field (an array of independent-concern labels; [] = not splittable) needs no parser
// change — it surfaces like `ordering`/`gloss`, and its absence on a non-splittable case is tolerated
// exactly as those are (the grader reads only the field its case kind needs).
// Zero-dependency: node builtins + JSON only.

export class EnvelopeError extends Error {}

const STRICT = /```faff-eval:judgement[^\n]*\n([\s\S]*?)\n```/;
const ANY_FENCE = /```[^\n]*\n([\s\S]*?)\n```/g;

// Validate a candidate envelope body; throws EnvelopeError (fail-loud) on bad JSON / shape / case_id.
function validateEnvelopeJson(text, ctx) {
  let env;
  try {
    env = JSON.parse(text);
  } catch (e) {
    throw new EnvelopeError(`${ctx} is not valid JSON: ${e.message}`);
  }
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new EnvelopeError(`${ctx} must be a JSON object`);
  }
  if (typeof env.case_id !== "string" || !env.case_id) {
    throw new EnvelopeError(`${ctx} missing case_id`);
  }
  return env;
}

// Non-throwing parse for the fallback scan: returns a valid envelope or null.
function tryEnvelopeJson(text) {
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return null;
  }
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  if (typeof env.case_id !== "string" || !env.case_id) return null;
  return env;
}

export function parseJudgementEnvelope(rawText, { expectedCaseId } = {}) {
  const raw = String(rawText ?? "");

  // 1. strict: the exact faff-eval:judgement tag (fail-loud on a malformed tagged block).
  const strict = raw.match(STRICT);
  if (strict) {
    return { ...validateEnvelopeJson(strict[1], "faff-eval:judgement block"), format: "compliant" };
  }

  // 2. classify fallback: the LAST fenced block that is a valid envelope (case_id matching
  //    expectedCaseId when given). Recovers a correct-but-mis-tagged judgement, flagged noncompliant.
  let recovered = null;
  for (const m of raw.matchAll(ANY_FENCE)) {
    const env = tryEnvelopeJson(m[1]);
    if (env && (expectedCaseId == null || env.case_id === expectedCaseId)) recovered = env; // last wins
  }
  if (recovered) return { ...recovered, format: "noncompliant" };

  // 3. nothing usable.
  throw new EnvelopeError("no faff-eval:judgement block (and no fenced JSON object with a case_id) in output");
}
