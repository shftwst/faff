# ADR 0142 — Review comment identity follows the recorded marker and ordering decisions

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-11-16

## Context

The review-comment prose leaves marker whitespace, duplicate ordering and splicing ambiguous. Eleven controlled development cases exposed four differences between the observed baseline and the independent expected outcomes. The operator resolved seven rules on 2026-11-15 in `eval/control-parity/policy-decisions.json`. This record promotes those existing decisions without adding implementation boundary choices.

## Decision

1. Leading whitespace disqualifies a marker line; trailing whitespace, including \r, is ignored.
2. Sort by created_at; ties keep the tracker's listing order; a missing created_at sorts after every timestamped comment.
3. Authorship is never used.
4. The region runs from the first open marker line to the first close marker line after it; later markers are ordinary text and are preserved.
5. Lines inside a fenced code block (``` or ~~~) are never marker lines.
6. Text outside the region is kept byte for byte, CRLF included; the region is always written marker_open\nbody\nmarker_close. A \r before \n is trailing whitespace of its line, so on a marker line it is rewritten with the region.
7. Marker lines stay whole lines: the region runs from the start of the open marker line to the end of the close marker line and is written marker_open\nbody\nmarker_close.

## Consequences

The pure `faff review-comment plan` command implements these rules; caller prose retains findings judgement, complete tracker reads, one remote write and uncertain-write handling. Authorship no longer influences selection. Fenced marker examples are ignored, an intentional change from the older literal line predicate.

The command returns a proposed operation and original-body digest, not proof of a remote write or compare-and-swap protection. Duplicate comments remain untouched. Boundary input validation is specified separately in `records/specs/2026-11-16-review-comment-extraction.md` and is not presented as an operator decision. The original eleven observations and expected outcomes remain unchanged.
