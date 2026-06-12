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

/**
 * FAFF-97 — Routing assertion: every DECLARED human-facing output surface routed
 * through the rendering pass (the universal-routing rule, enforced behaviourally).
 *
 * This is a seam-COMPLETENESS + ORDERING claim, never a content claim: it reads only
 * `surface` / `routes` / `op` / `issue` / `seq` off the frozen record and never inspects
 * a rendered body (FAFF-96 owns body goldens). It computes no ranking — the author
 * declares which seams are human-facing; the matcher classifies nothing itself.
 *
 * spec: { surface, emits? }
 *   - surface: the rendering surface that must carry the routing (e.g. "tidy-report").
 *   - emits: the human-facing output seams that must each route through `surface`.
 *       Default [{ kind: "rendering" }] — assert the terminal render of `surface` is present.
 *       - { kind: "rendering" } — the terminal/stdout render; its presence IS the routing.
 *       - { kind: "mutation", op, issue? } — a prose-bearing tracker write that must be
 *         PRECEDED (in seq) by a binding rendering(surface) seam. `op` is one of
 *         addComment / createIssue / setStatus; mechanical writes (addLabel/removeLabel)
 *         are not human-facing and are never declared here.
 *
 * Binding: a rendering(surface) seam binds an emit when its `routes` is undefined
 * (lenient — any same-surface render preceding the emit) or equals the emit's `op`
 * (strict — exact binding). The first such seam with seq < emitSeq satisfies the emit.
 *
 * Returns undefined on match; throws AssertionError on a missing render, an emit with no
 * preceding bound render (the un-normalised-write violation), or an ordering violation.
 */
export function expectRoutedThroughRendering(rec, { surface, emits } = {}) {
  assert.ok(
    typeof surface === "string" && surface.length > 0,
    "expectRoutedThroughRendering: a non-empty `surface` is required",
  );

  const renders = arr(rec, "renderings").filter((r) => r.surface === surface);
  assert.ok(
    renders.length > 0,
    `expectRoutedThroughRendering(${surface}): no rendering with that surface`,
  );

  const selectors = emits ?? [{ kind: "rendering" }];
  const log = arr(rec, "seamLog"); // seq order == append order; sole ordering authority (FAFF-93)

  for (const emit of selectors) {
    // The render IS the terminal emit — presence (asserted above) is intrinsic routing.
    if (emit.kind === "rendering") continue;

    if (emit.kind === "mutation") {
      const ev = log.find(
        (e) =>
          e.kind === "mutation" &&
          e.payload.op === emit.op &&
          (emit.issue === undefined || e.payload.issue === emit.issue),
      );
      assert.ok(
        ev,
        `expectRoutedThroughRendering: no human-facing emit matched ${JSON.stringify(emit)}`,
      );
      const emitSeq = ev.seq;
      const binding = log.find(
        (e) =>
          e.kind === "rendering" &&
          e.payload.surface === surface &&
          (e.payload.routes === undefined || e.payload.routes === emit.op) &&
          e.seq < emitSeq,
      );
      assert.ok(
        binding,
        `expectRoutedThroughRendering: emit ${emit.op}` +
          `${emit.issue ? " (" + emit.issue + ")" : ""} at seq ${emitSeq} has no preceding ` +
          `rendering(${surface}) routing it — un-normalised write violates the universal-routing rule`,
      );
      continue;
    }

    assert.fail(`expectRoutedThroughRendering: unknown emit selector ${JSON.stringify(emit)}`);
  }
}
