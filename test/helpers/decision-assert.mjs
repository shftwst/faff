// FAFF-95 — Decision-assertion matchers over a captured DecisionRecord.
//
// Reusable throwing assertions so a skill test DECLARES expectations instead of
// hand-rolling record-field access (the bespoke plumbing FAFF-94 had to write inline).
// Reads the FAFF-93 DecisionRecord (test/helpers/skill-harness.mjs); never mutates it
// and never imports the harness. Zero-dependency: node:assert/strict only.
//
// Design (per the FAFF-95 spec):
//   - Each matcher returns undefined on match and throws AssertionError on mismatch,
//     so a regression goes red under bare `node --test`.
//   - Ordering matchers assert the CAPTURED order against an EXPECTED order the test
//     author supplies — they compute no ranking (gateway: this layer holds no ordering
//     opinion; that is the methodology's).
//   - Positive matchers fail on an absent target; absence is asserted only via the
//     explicit negative matchers (expectNoBucket / expectNoMutation).

import assert from "node:assert/strict";

// Read an array field off the record, failing loud (a clear AssertionError, not a
// TypeError deep inside a .find) when the record arg is the wrong shape.
const arr = (rec, key) => {
  assert.ok(rec && Array.isArray(rec[key]), `decision-assert: rec.${key} must be an array`);
  return rec[key];
};

/** The named bucket exists and its id array deep-equals expectedIds (order-sensitive). */
export function expectBucket(rec, name, expectedIds) {
  assert.ok(rec && rec.buckets && typeof rec.buckets === "object", "decision-assert: rec.buckets missing");
  assert.deepEqual(
    rec.buckets[name],
    expectedIds,
    `expectBucket("${name}"): got ${JSON.stringify(rec.buckets[name])}, want ${JSON.stringify(expectedIds)}`,
  );
}

/** No bucket of `name` was emitted (key absent). */
export function expectNoBucket(rec, name) {
  assert.ok(rec && rec.buckets && typeof rec.buckets === "object", "decision-assert: rec.buckets missing");
  assert.ok(
    !(name in rec.buckets),
    `expectNoBucket("${name}"): bucket was emitted as ${JSON.stringify(rec.buckets[name])}`,
  );
}

/** The named bucket's CAPTURED order equals expectedIds (author supplies the ranking; none computed here). */
export function expectOrder(rec, name, expectedIds) {
  assert.ok(rec && rec.buckets && typeof rec.buckets === "object", "decision-assert: rec.buckets missing");
  assert.deepEqual(
    rec.buckets[name],
    expectedIds,
    `expectOrder("${name}"): captured ${JSON.stringify(rec.buckets[name])}, expected ${JSON.stringify(expectedIds)}`,
  );
}

/** At least one verdict matches {issue, token} (and source if given). */
export function expectVerdict(rec, issue, token, source) {
  const v = arr(rec, "verdicts").find(
    (x) => x.issue === issue && x.token === token && (source === undefined || x.source === source),
  );
  assert.ok(v, `expectVerdict(${issue}, ${token}${source ? ", " + source : ""}): no matching verdict`);
}

/** The verdicts (in seq order) name issues equal to expectedIssueIds (author-supplied order). */
export function expectVerdictOrder(rec, expectedIssueIds) {
  assert.deepEqual(
    arr(rec, "verdicts").map((v) => v.issue),
    expectedIssueIds,
    "expectVerdictOrder: captured verdict order diverged",
  );
}

// True when every key in `sub` is present in `sup` with a JSON-equal value (subset match,
// so a caller can assert just {status:"Todo"} without restating every arg key).
const isSubset = (sup, sub) =>
  Object.entries(sub ?? {}).every(([k, val]) => JSON.stringify(sup?.[k]) === JSON.stringify(val));

/** At least one mutation ATTEMPT matches op (and issue, and an args subset, if given). */
export function expectMutation(rec, { op, issue, args } = {}) {
  const m = arr(rec, "mutations").find(
    (x) => x.op === op && (issue === undefined || x.issue === issue) && (args === undefined || isSubset(x.args, args)),
  );
  assert.ok(m, `expectMutation(${op}${issue ? ", " + issue : ""}): no matching mutation attempt`);
}

/** No mutation attempts at all (filter omitted) or none matching the {op?, issue?} filter. */
export function expectNoMutation(rec, filter) {
  const ms = arr(rec, "mutations").filter(
    (x) =>
      !filter ||
      ((filter.op === undefined || x.op === filter.op) && (filter.issue === undefined || x.issue === filter.issue)),
  );
  assert.equal(
    ms.length,
    0,
    `expectNoMutation: found ${ms.length} mutation(s): ${JSON.stringify(ms.map((m) => m.op))}`,
  );
}

/**
 * The CLI call whose argv[0]===subcommand has the asserted exit / trimmed stdout /
 * parsed-JSON subset. This is the non-tautological FAFF-94 core: it runs the real
 * JSON.parse + compare over the recorded stdout (the real `faff` binary's output),
 * just behind a name.
 */
export function expectCliResult(rec, subcommand, { exit, stdoutTrim, json } = {}) {
  const c = arr(rec, "cliCalls").find((x) => Array.isArray(x.argv) && x.argv[0] === subcommand);
  assert.ok(c, `expectCliResult(${subcommand}): no such CLI call`);
  if (exit !== undefined) {
    assert.equal(c.exit, exit, `expectCliResult(${subcommand}): exit ${c.exit} !== ${exit}`);
  }
  if (stdoutTrim !== undefined) {
    assert.equal(
      c.stdout.trim(),
      stdoutTrim,
      `expectCliResult(${subcommand}): stdout "${c.stdout.trim()}" !== "${stdoutTrim}"`,
    );
  }
  if (json !== undefined) {
    const parsed = JSON.parse(c.stdout);
    for (const [k, val] of Object.entries(json)) {
      assert.deepEqual(
        parsed[k],
        val,
        `expectCliResult(${subcommand}).json.${k}: got ${JSON.stringify(parsed[k])}, want ${JSON.stringify(val)}`,
      );
    }
  }
}

/**
 * The first seam matching selector `before` has a strictly smaller seq than the first
 * matching `after`. A selector is {kind, ...fieldMatch}; extra keys match the seam
 * payload, with `argvHead` as sugar for "payload.argv[0]" (cliCall payloads carry no
 * scalar id field). seq is the record's sole ordering authority (FAFF-93).
 */
export function expectSeamOrder(rec, before, after) {
  const seqOf = (sel) => {
    const e = arr(rec, "seamLog").find((ev) => {
      if (ev.kind !== sel.kind) return false;
      return Object.entries(sel).every(([k, val]) => {
        if (k === "kind") return true;
        if (k === "argvHead") return Array.isArray(ev.payload.argv) && ev.payload.argv[0] === val;
        return ev.payload[k] === val;
      });
    });
    assert.ok(e, `expectSeamOrder: no seam matched ${JSON.stringify(sel)}`);
    return e.seq;
  };
  const b = seqOf(before);
  const a = seqOf(after);
  assert.ok(
    b < a,
    `expectSeamOrder: ${JSON.stringify(before)} (seq ${b}) must precede ${JSON.stringify(after)} (seq ${a})`,
  );
}

/** At least one rendering with `surface` was emitted (membership only; no body — FAFF-96 owns goldens). */
export function expectRendering(rec, surface) {
  assert.ok(
    arr(rec, "renderings").some((r) => r.surface === surface),
    `expectRendering(${surface}): not emitted`,
  );
}
