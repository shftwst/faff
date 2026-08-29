// ===========================================================================
// === region:factory — spec-review-iteration-cap — the spec-review reject-loop cap ===
// The spec-stage counterpart of `review-iteration-cap` (the code-review loop bound).
// faff-prep's Spec-review gate used to force-park on a fixed count of unresolved
// revise/reject-approach rounds; this resolver makes that cap appetite-scaled
// (1/3/5/10 by low/medium/high/full) so the loop persistence matches the run's
// appetite, exactly as the code-review loop already does.
//
// It carries NO cap literals of its own: `APPETITE_CAP` and `resolveReviewIterationCap`
// are RE-EXPORTED verbatim from `review-iteration-cap.js`, the single authoritative
// literal source — so the spec-review cap and the code-review cap can never silently
// diverge, and there is no second copy of the map to drift. PURE (no tracker/network/
// file writes): the appetite is passed in by the caller (already resolved via
// `faff config get appetite`), never re-resolved here.
// ===========================================================================

"use strict";

const {
  APPETITE_CAP,
  resolveReviewIterationCap,
} = require("./review-iteration-cap");

// The one drift risk this cap has is faff-prep hardcoding a bare integer instead of
// naming the resolver — guarded by the external parity test
// (test/spec-review-iteration-cap.test.mjs). The literal map itself is single-sourced
// upstream, so this selftest exercises the RE-EXPORT (that the same 1/3/5/10 table and
// the same fail-loud shape reach through this module), not a second copy.
const SPEC_REVIEW_ITERATION_CAP_CASES = [
  ["low", 1],
  ["medium", 3],
  ["high", 5],
  ["full", 10],
  ["HIGH", 5], // case-insensitive
];

function specReviewIterationCapSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };
  for (const [appetite, want] of SPEC_REVIEW_ITERATION_CAP_CASES) {
    const res = resolveReviewIterationCap(appetite);
    ok(`appetite=${appetite} → cap ${want}`, res.cap === want);
  }
  // The re-export is the SAME map object as review-iteration-cap's — no second copy.
  ok("APPETITE_CAP is the re-exported single-source map", APPETITE_CAP.low === 1 && APPETITE_CAP.medium === 3 && APPETITE_CAP.high === 5 && APPETITE_CAP.full === 10);
  // fail-loud: unrecognised appetite
  const bad = resolveReviewIterationCap("bogus");
  ok("unrecognised appetite fails loud", !!bad.error);
  ok("unrecognised appetite names the legal set", bad.error.includes("low | medium | high | full"));
  // fail-loud: absent appetite
  const absent = resolveReviewIterationCap(undefined);
  ok("absent appetite fails loud", !!absent.error);
  ok("absent appetite names the legal set", absent.error.includes("low | medium | high | full"));
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (spec-review-iteration-cap resolver, ${fail} failed)`);
  return fail ? 1 : 0;
}

// `faff spec-review-iteration-cap --appetite <low|medium|high|full>` — print the resolved
// integer cap on stdout, exit 0. Absent/unrecognised appetite: nothing on stdout, the legal
// set named on stderr, exit 2 (fail-loud, parity with `review-iteration-cap`).
const { parseArgs, usageError } = require("./argv");
const SPEC_REVIEW_ITERATION_CAP_SPEC = { flags: { "--selftest": { arity: 0 }, "--appetite": { arity: 1 } } };
const SPEC_REVIEW_ITERATION_CAP_USAGE = "usage: faff spec-review-iteration-cap --appetite low|medium|high|full";

function cmdSpecReviewIterationCap(args) {
  if (args.includes("--selftest")) return specReviewIterationCapSelftest();
  const { values, errors } = parseArgs(args, SPEC_REVIEW_ITERATION_CAP_SPEC);
  if (errors.length) return usageError(errors, SPEC_REVIEW_ITERATION_CAP_USAGE);
  const appetite = values["--appetite"]; // undefined when absent — resolveReviewIterationCap validates
  const res = resolveReviewIterationCap(appetite);
  if (res.error) { process.stderr.write(res.error + "\n"); return 2; }
  console.log(String(res.cap));
  return 0;
}

module.exports = {
  APPETITE_CAP,
  resolveReviewIterationCap,
  SPEC_REVIEW_ITERATION_CAP_CASES,
  cmdSpecReviewIterationCap,
  specReviewIterationCapSelftest,
};
