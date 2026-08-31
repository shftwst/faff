// ===========================================================================
// === region:factory — heading-slug — FAFF-943: the spec_anchor join key's single rule home ===
// THE single rule home for the `spec_anchor` join key. The spec-review refuters emit
// `spec_anchor` (the heading slug of the spec section an objection attacks) by hand-applying
// the prose statement of this exact rule; the FAFF-930 assembler imports headingSlug() and
// never re-derives the rule. Producer prose and this code are held to the same worked
// examples by test/heading-slug.test.mjs (the prose-identity oracle).
//
// The OTHER slug dialect: adr.js/decisions.js/prd.js each apply this same transform PLUS a
// trailing .slice(0, 80) and a fallback token — both filename concerns. Filenames use those;
// the spec_anchor join key uses THIS uncapped, fallback-free rule (a cap would make two long
// headings colliding on an 80-char prefix indistinguishable, and a fabricated fallback token
// could false-match). A degenerate all-punctuation heading yields "" honestly.
//
// The value is the MUTABLE heading slug for the initial assemble-time match only — never the
// rename-resistant content-addressed case-file anchor FAFF-930 also names `spec_anchor`; do
// not persist it across spec revisions.

"use strict";

// PURE: markdown heading source line -> heading text. Drops the leading `#`-run and its
// following whitespace and any trailing ATX-closer `#`-run, and nothing else — no rendering,
// no markup stripping, no entity decoding (inline markup characters are non-alphanumeric runs
// the slug transform collapses). ANY leading `#`-run is treated as a heading marker — the
// function does not decide heading-ness; callers index heading lines (filter with /^#+\s/)
// before calling it. A line with no leading `#` passes through trimmed.
function headingText(sourceLine) {
  return String(sourceLine)
    .replace(/^\s*#+\s*/, "")
    .replace(/\s*#+\s*$/, "")
    .trim();
}

// PURE: heading text -> slug. Lowercase; every run of characters outside [a-z0-9] becomes a
// single "-"; leading/trailing "-" trimmed. No length cap, no fallback token (see header).
function headingSlug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = { headingSlug, headingText };
