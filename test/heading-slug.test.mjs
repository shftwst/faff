// FAFF-943 — heading-slug: the spec_anchor join key's single rule home, and the
// prose-identity oracle holding the six producer files to the same canonical rule.
//
// Two halves:
//   1. The pure rule (headingText extraction + headingSlug transform): the three worked
//      examples verbatim, the pinned extraction (leading/trailing #-runs dropped, markup
//      kept), a matching slug, a missing field, and a no-match slug.
//   2. The prose-identity oracle: the canonical bullet is READ out of the committed spec
//      document (the `> spec_anchor:` blockquote — one physical source), asserted equal to
//      this test's own literal, and then asserted verbatim in all six producer files (an
//      enumerated list, never a glob) together with all three worked examples as
//      input-output pairs. A paraphrase anywhere in the chain goes red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const { headingSlug, headingText } = require("../plugin/skills/faff/bin/lib/heading-slug.js");

// The canonical rule sentence — held here as a literal AND read back out of the committed
// spec document below, so the test is pinned to the spec's one physical source, not to a
// builder paraphrase. The closing omit sentence is inside the asserted literal.
const CANONICAL_BULLET =
  "spec_anchor: the heading slug of the spec section this objection attacks. " +
  "Derive it from the heading's raw markdown line (drop the leading hash marks and surrounding whitespace, strip nothing else): " +
  "lowercase; replace every run of characters outside a-z0-9 with a single hyphen; trim leading and trailing hyphens. " +
  "Omit the field entirely if you cannot name one section.";

// The three worked examples as input-output pairs (input heading text, output slug).
const WORKED_EXAMPLES = [
  ["Aggregation — carry the anchor", "aggregation-carry-the-anchor"],
  ["Phase 2 — (revised)", "phase-2-revised"],
  ["The `spec_anchor` field", "the-spec-anchor-field"],
];

// The six producer files — an enumerated literal list by exact path, never a glob: a
// renamed or added prompt file changes this list in the same diff or goes red here.
const SIX_FILES = [
  "plugin/skills/faffter-dark-spec-review/refute-architectural.md",
  "plugin/skills/faffter-dark-spec-review/refute-infosec.md",
  "plugin/skills/faffter-dark-spec-review/refute-methodology.md",
  "plugin/skills/faffter-dark-spec-review/refute-qa.md",
  "plugin/skills/faffter-dark-spec-review/SKILL.md",
  "plugin/skills/faffter-noon-spec-review/SKILL.md",
];

const SPEC_DOC = join(REPO, "records", "specs", "2026-08-31-FAFF-943-refuter-objections-carry-spec-anchor-design.md");

// --- The pure rule -----------------------------------------------------------------------

test("headingSlug: the three worked examples round-trip verbatim (heading source line -> slug)", () => {
  for (const [text, slug] of WORKED_EXAMPLES) {
    assert.equal(headingSlug(headingText(`### ${text}`)), slug, `worked example: ${text}`);
    assert.equal(headingSlug(text), slug, `worked example (bare text): ${text}`);
  }
});

test("headingText: pinned extraction — leading/trailing #-runs and their whitespace dropped, markup kept, nothing else", () => {
  assert.equal(headingText("###   Aggregation — carry the anchor  "), "Aggregation — carry the anchor");
  assert.equal(headingText("## Title ##"), "Title", "trailing ATX-closer #-run dropped");
  assert.equal(headingText("### The `spec_anchor` field"), "The `spec_anchor` field", "inline markup kept — no stripping");
  assert.equal(headingText("not a heading"), "not a heading", "a line with no leading # passes through trimmed");
  assert.equal(headingText("# not actually markdown"), "not actually markdown", "any leading #-run is treated as a heading marker — heading-ness is the caller's filter (/^#+\\s/), not this function's");
});

test("headingSlug: run-collapse, trim, no cap, no fallback token", () => {
  assert.equal(headingSlug("a -- b"), "a-b", "a punctuation RUN collapses to a single hyphen");
  assert.equal(headingSlug("—()—"), "", "a degenerate all-punctuation heading yields the empty string, no fallback token");
  const long = "x".repeat(200);
  assert.equal(headingSlug(long), long, "no 80-char cap — the filename slugs' concern, not the join key's");
});

test("matching slug / missing field / no-match slug against a fixture spec's heading index", () => {
  const fixtureSpec = [
    "# FAFF-999 — a fixture spec",
    "## 4. How",
    "### Aggregation — carry the anchor",
    "Some prose.",
    "### Phase 2 — (revised)",
    "More prose.",
  ].join("\n");
  const index = new Map(
    fixtureSpec.split("\n").filter((l) => /^#+\s/.test(l)).map((l) => [headingSlug(headingText(l)), l]),
  );
  // a matching slug: the producer's anchor equals the consumer's derived slug for the attacked section
  assert.ok(index.has("aggregation-carry-the-anchor"), "producer anchor matches the consumer heading index");
  // a missing field: an objection without spec_anchor performs no lookup — absence is the signal
  const withoutAnchor = { lens: "QA", severity: "minor" };
  assert.ok(!("spec_anchor" in withoutAnchor), "absent field stays absent (the FAFF-930 absence-path precondition)");
  // a no-match slug: a well-formed anchor matching no heading is a consumer zero-match, never a producer error
  assert.equal(index.has("some-renamed-section"), false, "zero-match resolves downstream, not at emit");
});

// --- The prose-identity oracle -----------------------------------------------------------

test("the canonical bullet in the committed spec document equals this test's literal (one physical source)", () => {
  const spec = readFileSync(SPEC_DOC, "utf8");
  const quoted = spec.split("\n").filter((l) => l.startsWith("> spec_anchor:"));
  assert.equal(quoted.length, 1, "exactly one `> spec_anchor:` blockquote in the spec document");
  assert.equal(quoted[0].replace(/^>\s*/, ""), CANONICAL_BULLET, "spec blockquote and test literal are byte-identical");
});

test("all six producer files carry the canonical bullet and all three worked examples verbatim", () => {
  for (const rel of SIX_FILES) {
    const body = readFileSync(join(REPO, rel), "utf8");
    assert.ok(body.includes(CANONICAL_BULLET), `${rel}: canonical rule sentence (with its omit sentence) present verbatim`);
    for (const [text, slug] of WORKED_EXAMPLES) {
      assert.ok(body.includes(text), `${rel}: worked-example input heading "${text}" present`);
      assert.ok(body.includes(slug), `${rel}: worked-example output slug "${slug}" present`);
    }
  }
});
