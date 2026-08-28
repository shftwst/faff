// ===========================================================================
// === region:factory — fields — the single shared metadata-field reader (FAFF-850) ===
// One regex, one home: adr.js / prd.js / prdr.js / decisions.js all read record metadata fields
// through this module, so the reader can never exist in more than one place and drift apart.
// ===========================================================================

// Read a header field "- **Status:** value" / "- Status: value" (bold optional) from a record's
// full text, returning the trimmed value or null when the field line is absent OR present-but-blank.
// Records carry freeform trailing text (e.g. "Accepted (spike outcome …)"), so the value is the
// whole remainder; callers interpret only its leading token.
//
// Tolerate every bold/colon arrangement: "- **Status:** v", "- **Status**: v", "- Status: v".
// Leading "[\s>*-]*" eats list/bold markers; a colon is MANDATORY (so a prose line merely
// starting with the field word — "Status quo …" — is not mis-read as the field); the value
// begins at the first non-space/non-asterisk char and runs to end of line.
//
// FAFF-850: the whitespace classes AROUND the colon are bounded to non-newline whitespace
// ([ \t*]*, not [\s*]*). "\s" inside a character class matches "\n" even under the "m" flag (there
// is no dotall), so the old [\s*]* let a PRESENT-BUT-BLANK field ("- **PRD-goals:** " with nothing
// after the colon) swallow the line break and capture the NEXT non-blank line — typically the
// following "## Context" heading. Bounding to [ \t*]* keeps the match on one line, so a blank
// field now correctly yields null. The leading marker class and the value capture are unchanged.
// The shared field-line HEAD: leading list/bold marker class, the field name, non-newline space,
// a MANDATORY colon. Both the value read (readField) and the presence check (hasFieldLine) build on
// this one source so they can never fork into two grammars (FAFF-910 anti-drift). readField appends
// the value capture; hasFieldLine stops at the colon.
function fieldLineHead(name) {
  return `^[\\s>*-]*${name}[ \\t*]*:`;
}

function readField(text, name) {
  const m = text.match(new RegExp(fieldLineHead(name) + "[ \\t*]*([^\\s*].*)$", "mi"));
  return m ? m[1].trim() : null;
}

// FAFF-850/FAFF-910: test the LEXICAL PRESENCE of a field line, independent of its value. readField
// maps both an absent line AND a present-but-blank value to null, so a value read alone cannot tell
// "no such line" from "line present, value blank" — this presence check on the SAME shared head
// supplies that distinction (a blank `Ratified-by:` is a present line, hence a malformed tradeoff
// rather than a precedent fall-through).
function hasFieldLine(text, name) {
  return new RegExp(fieldLineHead(name), "mi").test(String(text));
}

module.exports = { fieldLineHead, hasFieldLine, readField };
