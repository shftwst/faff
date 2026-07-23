// ===========================================================================
// === region:factory — review-iteration-cap — FAFF-341: single-owner the review fail→fix→review loop bound ===
// The `review` slot's Appetite integration table (faffter-noon-review/SKILL.md) already
// states this as an appetite-scaled persistence policy (1/3/5/10 by low/medium/high/full)
// — the drift this ticket removes was faff-graft/SKILL.md restating a bare "3" for the
// same loop. This resolver's APPETITE_CAP map is now the SINGLE authoritative literal
// source: graft resolves through it (`faff review-iteration-cap --appetite <appetite>`)
// instead of stating a per-appetite integer of its own, and the reviewer's table is
// annotated as materialized by this same resolver — so the two representations can never
// silently disagree again. PURE (no tracker/network/file writes — parity with
// eligible/models build-for): the appetite is passed in by the caller (already resolved
// via `faff config get appetite`), never re-resolved here.
// ===========================================================================

const { VALID_APPETITES } = require("./config");

// The single authoritative source for the review-loop cap literals. Any edit here
// must be mirrored in faffter-noon-review/SKILL.md's Appetite integration table —
// the drift-guard test (test/review-iteration-cap.test.mjs) fails loud if the two
// fall out of sync.
const APPETITE_CAP = { low: 1, medium: 3, high: 5, full: 10 };

const LEGAL_SET = Array.from(VALID_APPETITES).join(" | ");

// resolveReviewIterationCap(appetite) -> { cap } | { error }
// Case-insensitive; an absent/unrecognised appetite is a usage fault (fail-loud,
// never a silent default) — mirrors `models build-for`'s invalid-token shape.
function resolveReviewIterationCap(appetite) {
  const key = appetite != null ? String(appetite).trim().toLowerCase() : "";
  if (!key || !Object.prototype.hasOwnProperty.call(APPETITE_CAP, key)) {
    return {
      error: `faff review-iteration-cap: unrecognised appetite "${appetite ?? ""}" — legal set: ${LEGAL_SET}`,
    };
  }
  return { cap: APPETITE_CAP[key] };
}

const REVIEW_ITERATION_CAP_CASES = [
  ["low", 1],
  ["medium", 3],
  ["high", 5],
  ["full", 10],
  ["HIGH", 5], // case-insensitive
];

function reviewIterationCapSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  for (const [appetite, want] of REVIEW_ITERATION_CAP_CASES) {
    const res = resolveReviewIterationCap(appetite);
    ok(`appetite=${appetite} → cap ${want}`, res.cap === want);
  }
  // fail-loud: unrecognised appetite
  const bad = resolveReviewIterationCap("bogus");
  ok("unrecognised appetite fails loud", !!bad.error);
  ok("unrecognised appetite names the legal set", bad.error.includes("low | medium | high | full"));
  // fail-loud: absent appetite
  const absent = resolveReviewIterationCap(undefined);
  ok("absent appetite fails loud", !!absent.error);
  ok("absent appetite names the legal set", absent.error.includes("low | medium | high | full"));
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (review-iteration-cap resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

// `faff review-iteration-cap --appetite <low|medium|high|full>` — print the resolved
// integer cap on stdout, exit 0. Absent/unrecognised appetite: nothing on stdout, the
// legal set named on stderr, exit 2 (fail-loud, parity with `models build-for`).
const { parseArgs, usageError } = require("./argv");
const REVIEW_ITERATION_CAP_SPEC = { flags: { "--selftest": { arity: 0 }, "--appetite": { arity: 1 } } };
const REVIEW_ITERATION_CAP_USAGE = "usage: faff review-iteration-cap --appetite low|medium|high|full";

function cmdReviewIterationCap(args) {
  if (args.includes("--selftest")) return reviewIterationCapSelftest();
  const { values, errors } = parseArgs(args, REVIEW_ITERATION_CAP_SPEC);
  if (errors.length) return usageError(errors, REVIEW_ITERATION_CAP_USAGE);
  const appetite = values["--appetite"]; // undefined when absent — resolveReviewIterationCap validates
  const res = resolveReviewIterationCap(appetite);
  if (res.error) { process.stderr.write(res.error + "\n"); return 2; }
  console.log(String(res.cap));
  return 0;
}

module.exports = {
  APPETITE_CAP,
  REVIEW_ITERATION_CAP_CASES,
  cmdReviewIterationCap,
  resolveReviewIterationCap,
  reviewIterationCapSelftest,
};
