// ===========================================================================
// === region:factory — claim-verdict — FAFF-758: the stale-claim liveness function. PURE: ===
// decides whether a faff claim (an issue at `In Progress`) is `live` or `stale`
// from three explicit inputs — the timestamp of the latest transition INTO the
// claim state (`claimed-at`), an injected clock (`now`), and the TTL in hours —
// and NOTHING else. It reads no tracker and no system clock, so it is fully
// selftestable, mirroring the `faff eligible` / `faff next` split: the CLI decides,
// the agent reads the tracker. The agent supplies `claimed-at` from the connector's
// own history surface (Linear: the latest `In Progress` stateHistory `startedAt`),
// resolves `ttl-hours` from `faff config get claim_ttl_hours`, and separately checks
// the `faff-claimed` provenance label; this command only does `age + TTL → verdict`.
// Fail-safe direction: a claim is `stale` only when strictly OLDER than the TTL —
// at exactly the TTL, and for any non-positive age (clock skew), it stays `live`,
// so the reclaim never yanks a claim on a boundary or a backwards clock.
// ===========================================================================


// Returns { verdict: "live"|"stale", age_secs, ttl_secs }, or throws a
// ClaimVerdictError (message names the offending input) when an input is invalid.
function claimVerdict(claimedAtISO, nowISO, ttlHours) {
  const claimedMs = Date.parse(claimedAtISO);
  if (Number.isNaN(claimedMs)) throw new ClaimVerdictError(`--claimed-at is not a valid ISO-8601 timestamp: ${claimedAtISO}`);
  const nowMs = Date.parse(nowISO);
  if (Number.isNaN(nowMs)) throw new ClaimVerdictError(`--now is not a valid ISO-8601 timestamp: ${nowISO}`);
  const ttl = Number(ttlHours);
  if (!Number.isFinite(ttl) || ttl < 0) throw new ClaimVerdictError(`--ttl-hours is not a non-negative number: ${ttlHours}`);

  const age_secs = Math.floor((nowMs - claimedMs) / 1000);
  const ttl_secs = Math.round(ttl * 3600);
  // stale IFF strictly older than the TTL (age at/under TTL, and any non-positive
  // age from clock skew, stays live — the fail-safe direction: never reclaim on a
  // boundary or a backwards clock).
  const verdict = age_secs > ttl_secs ? "stale" : "live";
  return { verdict, age_secs, ttl_secs };
}

class ClaimVerdictError extends Error {}

// Cases: [[claimed_at, now, ttl_hours], want_verdict]. The boundary table exercises
// age just-under / at / just-over the TTL, plus a clearly-stale and a clock-skew case.
const CLAIM_VERDICT_CASES = [
  [["2026-01-01T00:00:00Z", "2026-01-01T05:59:59Z", 6], "live"],   // 1s under TTL ⇒ live
  [["2026-01-01T00:00:00Z", "2026-01-01T06:00:00Z", 6], "live"],   // exactly at TTL ⇒ live (not strictly older)
  [["2026-01-01T00:00:00Z", "2026-01-01T06:00:01Z", 6], "stale"],  // 1s over TTL ⇒ stale
  [["2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 6], "stale"],  // a full day past a 6h TTL ⇒ stale
  [["2026-01-01T00:00:00Z", "2026-01-01T00:05:00Z", 6], "live"],   // fresh claim ⇒ live
  [["2026-01-01T06:00:00Z", "2026-01-01T00:00:00Z", 6], "live"],   // now BEFORE claimed (clock skew) ⇒ live (fail-safe)
  [["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z", 0], "stale"],  // ttl 0 ⇒ any positive age is stale
];

function runClaimVerdictCases() {
  let fail = 0;
  for (const [[claimedAt, now, ttl], want] of CLAIM_VERDICT_CASES) {
    let got;
    try { got = claimVerdict(claimedAt, now, ttl).verdict; }
    catch (e) { got = `ERROR(${e.message})`; }
    const ok = got === want;
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} claimed=${claimedAt} now=${now} ttl=${ttl}h → ${got} (want ${want})`);
  }
  return fail;
}

function claimVerdictSelftest() {
  const fail = runClaimVerdictCases();
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${CLAIM_VERDICT_CASES.length} cases, ${fail} failed) — no tracker, no system clock consulted`);
  return fail ? 1 : 0;
}

const { parseArgs, usageError } = require("./argv");

const CLAIM_VERDICT_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--claimed-at": { arity: 1 },
    "--now": { arity: 1 },
    "--ttl-hours": { arity: 1 },
  },
};
const CLAIM_VERDICT_USAGE = "usage: faff claim-verdict --claimed-at <ISO8601> --now <ISO8601> --ttl-hours <N> [--selftest]";

function cmdClaimVerdict(args) {
  if (args.includes("--selftest")) return claimVerdictSelftest();
  const { values, errors } = parseArgs(args, CLAIM_VERDICT_SPEC);
  if (errors.length) return usageError(errors, CLAIM_VERDICT_USAGE);
  const missing = ["--claimed-at", "--now", "--ttl-hours"].filter((f) => values[f] === undefined);
  if (missing.length) return usageError([{ code: "missing-flag", detail: `missing required flag(s): ${missing.join(", ")}` }], CLAIM_VERDICT_USAGE);
  try {
    const out = claimVerdict(values["--claimed-at"], values["--now"], values["--ttl-hours"]);
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    if (e instanceof ClaimVerdictError) return usageError([{ code: "invalid-input", detail: e.message }], CLAIM_VERDICT_USAGE);
    throw e;
  }
}


module.exports = { CLAIM_VERDICT_CASES, ClaimVerdictError, claimVerdict, cmdClaimVerdict, claimVerdictSelftest, runClaimVerdictCases };
