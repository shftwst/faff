// FAFF-130 — parse the `faff-eval:judgement` fenced block faff-tidy emits in eval mode.
// Judgement capture stays OUT of the seam DecisionRecord / FAFF-95 matchers (spec Decision 1):
// this is the eval-only out-of-band channel. Fail-loud — a missing or malformed block throws,
// and the orchestrator records that rep as `errored` (never silently passed).
// Zero-dependency: node builtins + JSON only.

export class EnvelopeError extends Error {}

const FENCE = /```faff-eval:judgement[^\n]*\n([\s\S]*?)\n```/;

export function parseJudgementEnvelope(rawText) {
  const m = String(rawText ?? "").match(FENCE);
  if (!m) throw new EnvelopeError("no faff-eval:judgement block in output");
  let env;
  try {
    env = JSON.parse(m[1]);
  } catch (e) {
    throw new EnvelopeError(`faff-eval:judgement block is not valid JSON: ${e.message}`);
  }
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    throw new EnvelopeError("envelope must be a JSON object");
  }
  if (typeof env.case_id !== "string" || !env.case_id) {
    throw new EnvelopeError("envelope missing case_id");
  }
  return env;
}
