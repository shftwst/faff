// ===========================================================================
// === region:governance — review-vocab — FAFF-1267: the review enums governance code may require ===
//
// The lens, severity, verdict and disposition vocabularies the spec-review evidence writer and
// collator check against. They live here, with no local requires, because governance modules may
// not require factory `contract-defs.js` (the `regions check` direction rule); `contract-defs.js`
// re-exports them under the same names so every existing importer keeps working.
// ===========================================================================

"use strict";

const SPEC_REVIEW_VERDICTS = ["approve", "revise", "reject-approach", "needs-human", "unavailable"];
const SPEC_REVIEW_LENSES = ["architectural", "infosec", "methodology", "QA"];
const SPEC_REVIEW_SEVERITIES = ["blocker", "major", "minor"];
const REVIEW_DISPOSITIONS = ["fixed", "refuted", "accepted-risk", "open"];

module.exports = { REVIEW_DISPOSITIONS, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS };
