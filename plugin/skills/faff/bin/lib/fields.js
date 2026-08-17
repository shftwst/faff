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
function readField(text, name) {
  const m = text.match(new RegExp(`^[\\s>*-]*${name}[ \\t*]*:[ \\t*]*([^\\s*].*)$`, "mi"));
  return m ? m[1].trim() : null;
}

module.exports = { readField };
