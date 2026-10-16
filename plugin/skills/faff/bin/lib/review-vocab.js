// ===========================================================================
// === region:governance — review-vocab — FAFF-1267: the review enums governance code may require ===
//
// The lens, severity, verdict, disposition and source vocabularies the review evidence writers and
// collators check against. They live here, with no local requires, because governance modules may
// not require factory `contract-defs.js` (the `regions check` direction rule); `contract-defs.js`
// re-exports them under the same names so every existing importer keeps working.
// ===========================================================================

"use strict";

const SPEC_REVIEW_VERDICTS = ["approve", "revise", "reject-approach", "needs-human", "unavailable"];
const SPEC_REVIEW_LENSES = ["architectural", "infosec", "methodology", "QA"];
const SPEC_REVIEW_SEVERITIES = ["blocker", "major", "minor"];
const REVIEW_DISPOSITIONS = ["fixed", "refuted", "accepted-risk", "open"];
const REVIEW_SEVERITIES = ["critical", "major", "minor", "observation"];
const REVIEW_FINDING_SOURCES = ["standard", "adversarial"];

module.exports = { REVIEW_DISPOSITIONS, REVIEW_FINDING_SOURCES, REVIEW_SEVERITIES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS };
