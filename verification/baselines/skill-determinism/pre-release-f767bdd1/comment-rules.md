# Managed review-comment baseline

Pinned source: `plugin/skills/faff/references/review.md`, lines 5 to 26, at `f767bdd1c0a78f6259c335742c1567a074f512a0`. The exact bytes are in `source.tar.gz`; the file hash is in `inventory.json`.

These are requirements extracted from existing prose. They are not observations of a model executing that prose, and they are not executable parity fixtures. No comment-splicing implementation or tracker write was performed for this baseline.

| Situation | Existing requirement | Evidence status |
|---|---|---|
| Comment identification | First structural marker line must be the opening marker for this issue | Explicit prose rule |
| No matching comment | Create one body wrapped in the issue's marker pair | Explicit prose rule |
| One complete matching comment | Update that comment; replace only the bounded body | Explicit prose rule |
| Human prefix and suffix | Preserve bytes outside the owned region verbatim | Explicit prose rule |
| Opening marker without closing marker | Replace opening marker through end, re-wrap, preserve the prefix | Explicit prose rule |
| Unmarked findings-like comment | Never adopt it | Explicit prose rule |
| Marker inside a quotation or another sentence | Does not identify a managed comment | Explicit prose rule |
| Closing marker is the first structural marker | Does not match | Explicit prose rule |
| Multiple matches | Prefer complete pairs; select oldest remaining comment; leave duplicates untouched | Explicit prose rule |
| Deleting duplicates | Forbidden | Explicit prose rule |
| Comment authorship is exposed | Faff-authored comments may receive additional preference | Optional policy; freeze the chosen policy before comparing implementations |
| Indented marker | One sentence trims surrounding whitespace; another excludes indented markers | Contradiction to resolve before treating this case as a deterministic oracle |
| Equal or absent creation timestamps | No final ordering or missing-value rule stated | Underspecified |
| Repeated or nested marker pairs | No pairing algorithm stated | Underspecified |
| Marker-looking text inside fenced code | Structural rule does not define fence handling | Underspecified |
| Line endings and marker whitespace | Outside-region preservation is explicit; splice boundary normalisation is not | Partly specified |
| A third party starts its own comment with an opening marker | Acknowledged as a residual match | Do not silently redefine compatibility as author-only matching |
| Live comment enumeration | Read current comments before selection | Pagination and completeness need connector evidence |
| Concurrent edits or a lost write acknowledgement | Prose assumes claim monotonicity bounds duplicates | No atomic compare-and-swap or exactly-once mechanism demonstrated |

Before removing any of this prose, retain the explicit rules as independent assertions, resolve the ambiguous cases as recorded policy decisions, and collect actual effect traces. A pure splice test cannot establish live read completeness, remote write success, or preservation under concurrent edits.
