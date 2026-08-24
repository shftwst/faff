// Guards the eval/review-bench kit against silent drift from the prompts it benchmarks.
// Pure file I/O: no process is started and no network call is made, so this runs safely in
// the normal CI `node --test` pass (the kit's own runner scripts live under eval/ and are
// never discovered by that pass). See records/specs/2026-08-24-FAFF-904-*-design.md.
//
// Three guards:
//   1. the four spec-review lens copies are byte-identical to their canonical sources;
//   2. the committed request payloads embed the current lens text (no stale copy);
//   3. the code-review lens carries the canonical five categories, in order.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const KIT = "eval/review-bench";
const CANON_SPEC = "plugin/skills/faffter-dark-spec-review";
const CANON_CODE = "plugin/skills/faffter-dark-adversarial-review/SKILL.md";
const SPEC_LENSES = ["architectural", "infosec", "methodology", "qa"];

const read = (p) => readFileSync(p, "utf8");

test("spec-review lens copies are byte-identical to canonical", () => {
  for (const lens of SPEC_LENSES) {
    const copy = read(`${KIT}/lenses/refute-${lens}.md`);
    const canon = read(`${CANON_SPEC}/refute-${lens}.md`);
    assert.equal(
      copy,
      canon,
      `review-bench lens copy drifted from canonical: refute-${lens}.md\n` +
        `  refresh: cp ${CANON_SPEC}/refute-${lens}.md ${KIT}/lenses/refute-${lens}.md\n` +
        `  then regenerate the payloads: node ${KIT}/build-requests.mjs`,
    );
  }
});

test("committed request payloads embed the current lens text", () => {
  // Each spec-review payload carries the lens verbatim: `requests/` in `system`,
  // `requests-shared-prefix/` in `user` (the shared context moves to `system` there).
  for (const lens of SPEC_LENSES) {
    const lensText = read(`${KIT}/lenses/refute-${lens}.md`);
    for (const dir of ["requests", "requests-shared-prefix"]) {
      const p = `${KIT}/${dir}/${lens}.json`;
      const payload = JSON.parse(read(p));
      assert.ok(
        payload.system === lensText || payload.user === lensText,
        `stale committed payload ${p}: its embedded lens no longer matches ` +
          `${KIT}/lenses/refute-${lens}.md\n  regenerate: node ${KIT}/build-requests.mjs`,
      );
    }
  }
  // The code-review payload carries the code-review lens verbatim in `system`.
  const clText = read(`${KIT}/code-review/lens/review-lens.md`);
  const cp = JSON.parse(read(`${KIT}/code-review/requests/code-review.json`));
  assert.ok(
    cp.system === clText || cp.user === clText,
    `stale code-review payload: its embedded lens no longer matches ` +
      `${KIT}/code-review/lens/review-lens.md\n` +
      `  regenerate: node ${KIT}/code-review/build-requests-code.mjs`,
  );
});

test("code-review lens carries the canonical five categories, in order", () => {
  // The code-review lens is a rendering of the adversarial second-opinion five categories
  // (faffter-dark-adversarial-review), NOT faffter-noon-review's structural passes.
  const CATEGORIES = [
    "Specification gaming",
    "Implicit assumptions",
    "Failure mode blindness",
    "Security surface",
    "Concurrency and ordering",
  ];
  const inOrder = (label, text) => {
    let last = -1;
    for (const cat of CATEGORIES) {
      const idx = text.indexOf(cat);
      assert.ok(
        idx > last,
        `${label}: category "${cat}" is missing or out of order ` +
          `(the five categories must appear in the order: ${CATEGORIES.join(" -> ")})`,
      );
      last = idx;
    }
  };
  // The kit's rendering must carry all five in order...
  inOrder("review-bench code-review lens", read(`${KIT}/code-review/lens/review-lens.md`));
  // ...and so must the canonical source, so a canonical reorder/rename fails this test and
  // prompts a re-derive of the kit's rendering plus an update to this category list.
  inOrder("canonical faffter-dark-adversarial-review/SKILL.md", read(CANON_CODE));
});
