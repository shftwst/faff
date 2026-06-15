// FAFF-130 — Judgement-eval grader (two-tier, deterministic) + aggregation.
//
// Closed-set and ordering judgements grade against a human oracle with NO LLM in the
// grading path. The synthesis gloss grades by a mechanical must_include/must_avoid
// rubric; an LLM "is it good?" judge stays ADVISORY and is never the reported coverage
// (spec Decision 3). Flakiness — not accuracy — is the load-bearing metric, so we measure
// per-case *signature* stability across reps, distinct from oracle accuracy.
//
// Zero-dependency: node builtins only. Pure functions — no clock / random / network.

export const KINDS = ["dupe", "vague", "stale", "superseded", "ordering", "gloss"];
export const CLOSED_SET_KINDS = new Set(["dupe", "vague", "stale", "superseded"]);

export class CaseError extends Error {}

// Validate one EvalCase: known kind, and the oracle populates exactly the field its kind needs.
export function validateCase(c) {
  if (!c || typeof c !== "object") throw new CaseError("case must be an object");
  if (typeof c.id !== "string" || !c.id) throw new CaseError("case.id must be a non-empty string");
  if (!KINDS.includes(c.kind)) throw new CaseError(`case ${c.id}: unknown kind ${JSON.stringify(c.kind)}`);
  const want = c.kind === "ordering" ? "ordering" : c.kind === "gloss" ? "gloss_rubric" : "closed_set";
  const populated = ["closed_set", "ordering", "gloss_rubric"].filter((k) => (c.oracle || {})[k] != null);
  if (populated.length !== 1 || populated[0] !== want) {
    throw new CaseError(`case ${c.id}: oracle must populate exactly \`${want}\` for kind \`${c.kind}\``);
  }
  return c;
}

function setEqual(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// Normalised rank correlation over the judgement-determined portion only (1 - inversions/max).
// Identical order => 1.0; full reverse => 0.0. Structural-CLI ties excluded: we only score
// ids the oracle lists (the judgement portion), in the relative order the prediction gives them.
export function rankCorrelation(predicted, oracle) {
  const ranked = oracle.filter((id) => predicted.includes(id));
  const n = ranked.length;
  if (n < 2) return 1.0;
  const pos = new Map(predicted.map((id, i) => [id, i]));
  let inv = 0;
  const max = (n * (n - 1)) / 2;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (pos.get(ranked[i]) > pos.get(ranked[j])) inv++;
  return 1 - inv / max;
}

// Mechanical gloss rubric — fraction of must_include/must_avoid checks passing across glosses.
// Returns { score, checks, passed, vector } where vector is the per-check pass/fail (for stability).
export function gradeGloss(env, rubric) {
  const glosses = Object.values(env.gloss || {});
  const vector = [];
  for (const raw of glosses) {
    const t = String(raw).toLowerCase();
    for (const inc of rubric.must_include || []) vector.push(t.includes(inc.toLowerCase()));
    for (const avo of rubric.must_avoid || []) vector.push(!t.includes(avo.toLowerCase()));
  }
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// grade(case, envelope) -> RepResult { graded, score, tokens, signature }.
// `signature` is the canonical judgement identity used for flakiness (NOT the grade) —
// two reps that both FAIL but classify differently are correctly counted as unstable.
export function grade(c, env) {
  const tokens = (env && env.tokens) || 0;
  if (CLOSED_SET_KINDS.has(c.kind)) {
    const predicted = (env.classifications && env.classifications[c.kind]) || [];
    const ok = setEqual(predicted, c.oracle.closed_set);
    return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, tokens, signature: JSON.stringify([...predicted].sort()) };
  }
  if (c.kind === "ordering") {
    const predicted = env.ordering || [];
    const score = rankCorrelation(predicted, c.oracle.ordering);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(predicted) };
  }
  if (c.kind === "gloss") {
    const { score, vector } = gradeGloss(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  throw new CaseError(`grade: unknown kind ${c.kind}`);
}

// A rep whose envelope was missing/malformed — distinct signature so it lowers stability.
export function erroredRep(transcriptRef) {
  return { graded: "ERRORED", score: 0, tokens: 0, signature: "ERRORED", transcript: transcriptRef || null };
}

// Aggregate reps into a CaseResult.
//   stability = fraction of reps whose judgement signature == the modal signature (1.0 = stable)
//   accuracy  = fraction of reps that PASS the oracle exactly (score === 1)
export function aggregateCase(c, repResults, { escalated = false } = {}) {
  const sigs = repResults.map((r) => r.signature);
  const counts = {};
  for (const s of sigs) counts[s] = (counts[s] || 0) + 1;
  const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const n = repResults.length || 1;
  // FAFF-137: format_adherence = fraction of *parsed* reps (those carrying a format flag — errored
  // reps have none) whose envelope used the exact tag. null when no rep was parsed.
  const formatted = repResults.filter((r) => r.format === "compliant" || r.format === "noncompliant");
  return {
    case_id: c.id,
    kind: c.kind,
    rep_results: repResults,
    stability: sigs.filter((s) => s === modal).length / n,
    accuracy: repResults.filter((r) => r.score === 1).length / n,
    format_adherence: formatted.length ? formatted.filter((r) => r.format === "compliant").length / formatted.length : null,
    escalated,
    errored: repResults.filter((r) => r.graded === "ERRORED").length,
    cost_tokens: repResults.reduce((s, r) => s + (r.tokens || 0), 0),
  };
}

// True iff the reps so far show ≥1 cross-rep judgement disagreement (the escalation trigger).
export function hasDisagreement(repResults) {
  return new Set(repResults.map((r) => r.signature)).size > 1;
}
