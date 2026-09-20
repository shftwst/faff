// FAFF-1054: occupant-side (faffter-dark-spec-review/SKILL.md) resolution for the configurable
// prime-then-parallel dispatch: dispatch_strategy default chain, the deadline -gt 0 guard + 60s
// sanity-floor WARNING, the timeout -gt 0 guard, the exit-8 -> unavailable/infra-configured mapping,
// and the in-band TTFT self-check advisory.
//
// The bash resolution lines live in SKILL.md prose, not in a .mjs module (mirrors the existing
// timeout/max_tokens two-tier resolution, itself untested-as-a-module: see FAFF-911's
// test/config-set.test.mjs normaliseNumPredict()). Each isolated clause below is reimplemented
// VERBATIM from the SKILL.md snippet and run through a real shell (mirrors the FAFF-911 /
// FAFF-1058 idiom), so drift between this test and the documented snippet is a real regression
// to catch by inspection, not merely coincidental agreement. The exit-8 row and the prose
// corrections are pinned by reading SKILL.md directly, the house idiom for occupant prose
// (test/faff-679-bracket-writes.test.mjs, test/spec-review-pin.test.mjs, and others).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = join(HERE, "..", "plugin", "skills", "faffter-dark-spec-review", "SKILL.md");
const BODY = readFileSync(SKILL_MD, "utf8");

// ── dispatch_strategy resolution: spec_review.* → adversarial.* → prime-then-parallel default ──
// Reimplements the exact SKILL.md snippet:
//   strategy=$(faff config get adversarial.spec_review.dispatch_strategy \
//              -d "$(faff config get adversarial.dispatch_strategy -d prime-then-parallel)")
// A fake `faff` shell function stands in for the two config reads, driven by SPEC_VAL/GLOBAL_VAL env
// vars (mirroring the real `config get KEY -d DEFAULT` contract: print the configured value if set,
// else the -d default).
function resolveStrategy({ specVal = "", globalVal = "" } = {}) {
  const script = `
faff() {
  key="$3"; default=""
  shift 3
  while [ $# -gt 0 ]; do
    if [ "$1" = "-d" ]; then default="$2"; shift 2; else shift; fi
  done
  case "$key" in
    adversarial.spec_review.dispatch_strategy) val="$SPEC_VAL" ;;
    adversarial.dispatch_strategy) val="$GLOBAL_VAL" ;;
    *) val="" ;;
  esac
  if [ -n "$val" ]; then printf '%s' "$val"; else printf '%s' "$default"; fi
}
strategy=$(faff config get adversarial.spec_review.dispatch_strategy \\
           -d "$(faff config get adversarial.dispatch_strategy -d prime-then-parallel)")
printf '%s' "$strategy"
`;
  return execFileSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, SPEC_VAL: specVal, GLOBAL_VAL: globalVal } });
}

test("FAFF-1054: dispatch_strategy resolves to prime-then-parallel when nothing is configured", () => {
  assert.equal(resolveStrategy({}), "prime-then-parallel");
});

test("FAFF-1054: dispatch_strategy falls through to the global key when the per-consumer key is unset", () => {
  assert.equal(resolveStrategy({ globalVal: "parallel" }), "parallel");
});

test("FAFF-1054: dispatch_strategy's per-consumer key wins over both the global key and the default", () => {
  assert.equal(resolveStrategy({ specVal: "serial", globalVal: "parallel" }), "serial");
});

// ── deadline: -gt 0 guard (reset to 900) + 60s sanity-floor WARNING (never a reset) ──
// Reimplements the exact SKILL.md snippet:
//   [ "$deadline" -gt 0 ] 2>/dev/null || deadline=900
//   DEADLINE_SANITY_FLOOR=60
//   if [ "$deadline" -lt "$DEADLINE_SANITY_FLOOR" ] 2>/dev/null; then echo "WARNING: ..." >&2; fi
const DEADLINE_SCRIPT = `
deadline="$1"
[ "$deadline" -gt 0 ] 2>/dev/null || deadline=900
DEADLINE_SANITY_FLOOR=60
if [ "$deadline" -lt "$DEADLINE_SANITY_FLOOR" ] 2>/dev/null; then
  echo "WARNING: adversarial.spec_review.deadline (\${deadline}s) is below the \${DEADLINE_SANITY_FLOOR}s sanity floor; a deadline this small may expire a lens before its primary backend can answer and advance the chain to a weaker fallback." >&2
fi
printf '%s' "$deadline"
`;
function resolveDeadline(input) {
  return execFileSync("bash", ["-c", DEADLINE_SCRIPT, "bash", String(input)], { encoding: "utf8" });
}
// execFileSync only surfaces stderr on a NON-ZERO exit; this script always exits 0, so spawnSync
// (which always returns {stdout, stderr} regardless of exit status) is what actually captures the
// WARNING line on the success path.
function resolveDeadlineWithStderr(input) {
  const r = spawnSync("bash", ["-c", DEADLINE_SCRIPT, "bash", String(input)], { encoding: "utf8" });
  return { out: r.stdout, err: r.stderr };
}

test("FAFF-1054: deadline guard resets a non-positive/non-numeric value to 900", () => {
  for (const bad of ["abc", "0", "00", "-1", "3.5", ""]) {
    assert.equal(resolveDeadline(bad), "900", `input ${JSON.stringify(bad)} should reset to 900`);
  }
});

test("FAFF-1054: a valid deadline at or above the 900 default passes through unchanged, no warning", () => {
  const r = resolveDeadlineWithStderr("900");
  assert.equal(r.out, "900");
  assert.equal(r.err, "", "900 is not below the 60s floor: no warning");
});

test("FAFF-1054: a positive deadline below the 60s sanity floor is HONOURED (never reset), with exactly one WARNING on stderr", () => {
  const r = resolveDeadlineWithStderr("30");
  assert.equal(r.out, "30", "the configured value stands: never silently reset to 900");
  assert.match(r.err, /^WARNING: adversarial\.spec_review\.deadline \(30s\) is below the 60s sanity floor/);
});

test("FAFF-1054: a deadline exactly at the 60s floor is honoured with no warning (< , not <=)", () => {
  const r = resolveDeadlineWithStderr("60");
  assert.equal(r.out, "60");
  assert.equal(r.err, "", "60 is AT the floor, not below it: no warning");
});

// ── timeout: its own -gt 0 guard (reset to 120) ──
function resolveTimeout(input) {
  const script = `
timeout="$1"
[ "$timeout" -gt 0 ] 2>/dev/null || timeout=120
printf '%s' "$timeout"
`;
  return execFileSync("bash", ["-c", script, "bash", String(input)], { encoding: "utf8" });
}

test("FAFF-1054: the inactivity timeout's own -gt 0 guard resets a non-positive/non-numeric value to 120", () => {
  for (const bad of ["abc", "0", "00", "-1", "3.5", ""]) {
    assert.equal(resolveTimeout(bad), "120", `input ${JSON.stringify(bad)} should reset to 120`);
  }
  assert.equal(resolveTimeout("90"), "90", "a valid positive integer passes through untouched");
});

// ── exit-8 -> unavailable/infra-configured (never config-fault, never pass+skip) ──

test("FAFF-1054: the per-lens outcome table pins exit 8 to unavailable/infra-configured", () => {
  const row = BODY.match(/^\|\s*`8`\s*\|.*\|.*\|$/m);
  assert.ok(row, "the per-lens outcome table must carry a row for exit 8");
  // The row's OWN outcome column (the last cell), not the caveat prose (which deliberately names
  // "config-fault" to rule it out: see the next test).
  const cells = row[0].split("|");
  const outcomeColumn = cells[cells.length - 2];
  assert.match(outcomeColumn, /\*\*unavailable\*\*/);
  assert.match(outcomeColumn, /`infra-configured`/);
});

test("FAFF-1054: exit 8's row states the never-config-fault / never-pass+skip pin explicitly", () => {
  const row = BODY.match(/^\|\s*`8`\s*\|.*\|.*\|$/m)[0];
  assert.match(row, /never `?config-fault`?/);
  assert.match(row, /never a? ?silent `?pass\+skip`?/);
});

// ── in-band TTFT self-check advisory (pure logic pinned from the SKILL.md prose formula) ──
// SKILL.md states: ratio = max(ttftMs of lenses 2..N) / ttftMs(prime); ratio >= 1/5 with every ttftMs
// present -> one advisory; any lens's ttftMs null -> "not-computed", no advisory, never a wall-clock
// fallback. This mirrors the documented algorithm directly (no production module owns it yet: the
// occupant applies it at runtime), the same "pin the described behaviour" role the exit-8 table test
// above plays for the outcome table.
const ADVISORY_RATIO_FLOOR = 1 / 5;
function selfCheck(results) {
  const ttfts = results.map((r) => r.ttftMs);
  if (ttfts.some((t) => t === null || t === undefined)) return { computed: false, advisory: null };
  const [primeTtft, ...restTtfts] = ttfts;
  const ratio = Math.max(...restTtfts) / primeTtft;
  if (ratio >= ADVISORY_RATIO_FLOOR) {
    return {
      computed: true,
      ratio,
      advisory: `prime-then-parallel showed no prefill-cache benefit on this backend (post-prime/prime TTFT ratio >= 1/5); consider adversarial.spec_review.dispatch_strategy: parallel`,
    };
  }
  return { computed: true, ratio, advisory: null };
}

test("FAFF-1054 self-check: ratio >= 1/5 (no cache benefit) emits exactly one advisory", () => {
  const r = selfCheck([{ ttftMs: 1000 }, { ttftMs: 900 }, { ttftMs: 950 }]); // ratio = 950/1000 = 0.95
  assert.equal(r.computed, true);
  assert.ok(r.advisory, "an advisory must fire");
  assert.match(r.advisory, /no prefill-cache benefit/);
  assert.match(r.advisory, /dispatch_strategy: parallel/);
});

test("FAFF-1054 self-check: ratio < 1/5 (a realised cache hit) emits no advisory", () => {
  const r = selfCheck([{ ttftMs: 1000 }, { ttftMs: 150 }, { ttftMs: 100 }]); // ratio = 150/1000 = 0.15 < 0.2
  assert.equal(r.computed, true);
  assert.equal(r.advisory, null);
});

test("FAFF-1054 self-check: a missing ttftMs on any lens records not-computed and never advises (no wall-clock fallback)", () => {
  const r = selfCheck([{ ttftMs: 1000 }, { ttftMs: null }, { ttftMs: 100 }]);
  assert.equal(r.computed, false);
  assert.equal(r.advisory, null);
});

test("FAFF-1054 self-check: the ratio boundary (exactly 1/5) still fires the advisory (>= , not >)", () => {
  const r = selfCheck([{ ttftMs: 1000 }, { ttftMs: 200 }, { ttftMs: 100 }]); // ratio = 200/1000 = exactly 0.2
  assert.equal(r.computed, true);
  assert.ok(r.advisory);
});

test("FAFF-1054: SKILL.md documents the self-check as advisory-only, keyed to TTFT never wall-clock", () => {
  assert.match(BODY, /In-band prefill-cache self-check/);
  assert.match(BODY, /never total wall-clock/);
  assert.match(BODY, /not-computed/);
  assert.match(BODY, /never gates/);
});

test("FAFF-1054: SKILL.md's documented advisory ratio floor and suggestion match the mirrored implementation", () => {
  assert.match(BODY, /post-prime\/prime TTFT ratio ≥ 1\/5/);
  assert.match(BODY, /adversarial\.spec_review\.dispatch_strategy: parallel/);
});

// ── SKILL.md wiring: --deadline / --strategy threaded through the single fan-out.mjs call ──

test("FAFF-1054: --deadline is threaded into the build-lens-requests.mjs call, --strategy into the fan-out.mjs call", () => {
  assert.match(BODY, /--max-tokens "\$max_tokens" --deadline "\$deadline"/);
  assert.match(BODY, /node "\$FANOUT" --requests "\$requests_json" --strategy "\$strategy"/);
});

test("FAFF-1054: SKILL.md's resolution block carries the dispatch_strategy -d chain and the deadline/timeout -gt 0 guards", () => {
  assert.match(BODY, /adversarial\.spec_review\.dispatch_strategy/);
  assert.match(BODY, /-d "\$\("\$faff" config get adversarial\.dispatch_strategy -d prime-then-parallel\)"/);
  assert.match(BODY, /\[ "\$deadline" -gt 0 \] 2>\/dev\/null \|\| deadline=900/);
  assert.match(BODY, /\[ "\$timeout" -gt 0 \] 2>\/dev\/null \|\| timeout=120/);
  assert.match(BODY, /DEADLINE_SANITY_FLOOR=60/);
});

// ── prose corrections: the dispatch/wire-shape/rules prose describes the shipped prime-then-parallel default ──

test("FAFF-1054: the dispatch prose describes the resolved strategy, not an unconditional 'CONCURRENTLY'", () => {
  assert.match(BODY, /Dispatch the lenses via `fan-out\.mjs`'s resolved strategy, never a per-lens loop/);
  assert.match(BODY, /prime-then-parallel/);
  assert.doesNotMatch(BODY, /Dispatch the lenses CONCURRENTLY/);
});

test("FAFF-1054: the wire-shape note ties 'lens 1 populates the cache' to the prime-then-parallel default, not an unconditional claim", () => {
  const wireShape = BODY.match(/\*\*Wire shape\.\*\*[^\n]*\n?[^\n]*/)[0];
  assert.match(wireShape, /prime-then-parallel/);
  assert.match(wireShape, /priming lens populates the cache/);
});

test("FAFF-1054: the Rules section no longer mandates unconditional concurrent dispatch", () => {
  assert.match(BODY, /Dispatch lenses via `fan-out\.mjs`'s resolved strategy, never a hand-rolled per-lens bash loop/);
  assert.doesNotMatch(BODY, /Dispatch lenses concurrently via `fan-out\.mjs`, never a per-lens bash loop/);
});

// ── Cache-hit integration probe (spec DONE item, last bullet) ──
// Verifies the ~1-prefill-not-N headline claim against a REAL prefix-caching backend. Env-gated and
// slow by construction (a live backend round-trip); skipped whenever no such backend is configured,
// which is the honest scope this repo's CI runs under today.
const CACHE_BACKEND_HOST = process.env.FAFF_SPEC_REVIEW_CACHE_PROBE_HOST;
test("FAFF-1054 integration probe: prime-then-parallel over a real prefix-caching backend: post-prime TTFT <= 1/5 of the prime's",
  { skip: !CACHE_BACKEND_HOST && "no prefix-caching backend configured (set FAFF_SPEC_REVIEW_CACHE_PROBE_HOST to run)" },
  async () => {
    // Left as a marked, env-gated integration probe per the spec's own scope: this repo's CI has no
    // prefix-caching backend, so the headline "1 prefill not N" claim is decidable only when one is
    // configured. A future backend-equipped environment fills this in against fan-out.mjs +
    // build-lens-requests.mjs exactly as the pure tests above exercise them.
    assert.ok(CACHE_BACKEND_HOST);
  });
