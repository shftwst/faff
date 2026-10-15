// ===========================================================================
// === region:governance — ac-id — FAFF-1287: one code home for an acceptance criterion's identity ===
// A spec's DONE line authors a local id (`- [ ] [ac-3] text`). Code, never prose, qualifies it with
// the lowercased ticket (`faff-1287#ac-3`) and that string is written byte for byte into the
// ac-checklist anchor, the rendered PR body and test sources. Lowercase is deliberate: the PR-body
// sanitizer rewrites uppercase tracker tokens and never matches this grammar. Pure, requires nothing.
// ===========================================================================

"use strict";

const ISSUE_ID_RE = /^[A-Z][A-Z0-9]{1,15}-[1-9][0-9]*$/;
const LOCAL_AC_ID_RE = /^ac-[1-9][0-9]*$/;
const POSITIONAL_AC_ID_RE = /^done:[1-9][0-9]*$/;
const QUALIFIED_AC_ID_PATTERN = "^[a-z][a-z0-9]{1,15}-[1-9][0-9]*#(ac-[1-9][0-9]*|done:[1-9][0-9]*)$";
const QUALIFIED_AC_ID_RE = new RegExp(QUALIFIED_AC_ID_PATTERN);

const AUTHORED_ID_RE = /^\[(ac-[1-9][0-9]*)\] +/;
const NEAR_MISS_ID_RE = /^\[ac-[^\]]*\]/i;

// parseLocalAcId(itemText) -> { local, text, nearMiss }. `local` is the authored id or null; `text` is
// the item without its leading `[ac-N] `. A bracket token that is not exactly lowercase `[ac-N]` is a
// near miss: no id is taken and the text is left intact.
function parseLocalAcId(itemText) {
  const text = String(itemText);
  const m = text.match(AUTHORED_ID_RE);
  if (m) return { local: m[1], text: text.slice(m[0].length), nearMiss: false };
  return { local: null, text, nearMiss: NEAR_MISS_ID_RE.test(text) };
}

function qualifyAcId(issue, localOrPositional) {
  if (typeof issue !== "string" || !ISSUE_ID_RE.test(issue)) throw new Error("issue id must match [A-Z][A-Z0-9]{1,15}-[1-9][0-9]*");
  if (!LOCAL_AC_ID_RE.test(localOrPositional) && !POSITIONAL_AC_ID_RE.test(localOrPositional)) throw new Error("AC id must be ac-N or done:N");
  return `${issue.toLowerCase()}#${localOrPositional}`;
}

// parseAcId(qualified) -> { ticket, local } or null when the string is not exactly a qualified id.
function parseAcId(qualified) {
  if (typeof qualified !== "string" || !QUALIFIED_AC_ID_RE.test(qualified)) return null;
  const at = qualified.indexOf("#");
  return { ticket: qualified.slice(0, at).toUpperCase(), local: qualified.slice(at + 1) };
}

module.exports = {
  ISSUE_ID_RE,
  QUALIFIED_AC_ID_PATTERN,
  parseAcId,
  parseLocalAcId,
  qualifyAcId,
};
