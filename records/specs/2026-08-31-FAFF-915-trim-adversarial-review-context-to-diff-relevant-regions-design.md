# FAFF-915 — Trim adversarial-review context to diff-relevant regions

> Spec: faffter-dark-nlspec · 2026-08-31 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-915.
> build-tier: mechanical
> spec-review: accept (judge, L3-provisional) — 4 adversarial rounds (architectural/infosec/QA), judge ruled accept on GLM-5.3-flash; standing objections addressed, no blocker, no infosec major.
> Revised 2026-08-31 (spec-review rounds 1-4): no-anchor files below a per-file floor pass through unchanged, large no-anchor files retain their head, the trim fails safe on any parse ambiguity, identifier anchors are frequency-capped and a retained-fraction ceiling forces head-retention so a recurring symbol cannot under-trim (architectural lens); tuning constants fixed to named values, the identifier rule pinned to a closed stoplist and exact boundary rule, a fixed three-file acceptance fixture named, the survival oracle and elision sentinel stated, and DONE tests added for the fail-safe, the stderr note, the frequency-cap and the ceiling fallback (QA lens).

## Why

Reasoning reviewers empty out on large review payloads: on FAFF-906 (~52K tokens) the model spends its whole output budget reasoning and emits zero findings (`finish=length`). The FAFF-914 probe found no reasoning setting that both fits the large payload and keeps detection. The 52K payload is ~62% context bundle, and the diff only touched a couple of regions, so most of the shipped context is irrelevant. Trimming the context bundle to the diff-relevant regions roughly halves the payload, putting a reasoning-ON review back under the empty-out knee. This is the targeted context-trim (the lighter fix), not the general map-reduce decomposer (its cancelled sibling).

## What

A relevance filter on the review context bundle in `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`, applied to the `--context` files after they are read and before `assembleUserMessage`. It keeps the regions the diff references and drops the rest, so the assembled user message shrinks without the caller changing how it invokes the transport.

Scope is `review-call.mjs` only. No config-schema change, no change to the fan-out or the spec-review occupant, no change to the diff itself.

## How

**Chosen:** relevance is computed by a diff-adjacency + identifier-window heuristic, the simplest mechanism the ticket lists. No static call-graph and no language parser.

For each context file, the retained line set is the union of:
- every line inside a diff-touched range for that file (matched by path against the diff's `+++ b/<path>` headers and `@@` hunk headers), and
- every line that mentions an identifier the diff's changed lines name (a cheap textual stand-in for direct callers/callees).

The identifier set is extracted deterministically: tokens matching `/[A-Za-z_$][A-Za-z0-9_$]*/` of length 3 or more, taken from the diff's added and removed lines (the `+`/`-` body lines, hunk headers excluded), minus this exact closed stoplist (no "and similar"): `const let var function return import export default this new typeof void await async class extends super yield delete instanceof`. A context-file line is an identifier anchor for token T when T occurs in the line delimited by a non-`[A-Za-z0-9_$]` character (or the line start/end) on both sides — that is, not embedded in a longer identifier run, so a diff token `parse` does not anchor a line that only contains `parseArgs`. The stoplist is closed and the boundary rule is exact, so a test asserts the exact identifier set and the exact retained lines for a fixture.

**Chosen:** identifier anchors are frequency-capped so a pervasive symbol cannot defeat the trim. Computed per context file: a diff token that would anchor more than `maxAnchorLines` lines in that file (default 40) is too common to be a useful relevance signal (it names a symbol used throughout the file, not a specific callee), so it contributes no anchors for that file. This bounds the anchored set and prevents the failure where a recurring function or import name anchors most of a large file and leaves the payload still above the knee. As a final guarantee, after trimming a file its retained fraction is checked: if it still exceeds `retainedCeiling` (default 0.8) the file is reduced to head-retention instead, so a trimmed file always drops at least a fifth. Diff-touched ranges are exempt from both caps — they are always retained (the conservative guarantee), so the caps only ever bound the identifier-anchored and windowed lines, never a line the diff itself changed.

Each retained line is expanded by a surrounding window of W lines, overlapping windows are merged, and each dropped span is replaced by a single marker line recording how many lines were elided. This keeps the touched regions plus their neighbourhood and the co-named symbols, and drops unrelated bodies.

**Chosen:** the trim is gated by a byte threshold, so small payloads are byte-identical to today. The filter is a no-op unless the total assembled context exceeds a threshold (`DEFAULT_CONTEXT_TRIM_BYTES`, a module constant), overridable by a `--context-trim-bytes N` CLI flag where `0` disables it entirely (mirroring the existing `--max-payload-bytes` escape hatch). Below the threshold the context files pass through unchanged, so every existing review and its golden tests are unaffected. The gate is self-activating above the threshold, so the oversized case (FAFF-930) benefits with no occupant change.

**Chosen:** the trim is conservative — it never drops a line inside a diff-touched range. Touched ranges are always anchors and windows only ever expand the retained set, so a region the diff references is retained by construction.

**Chosen:** a context file with no anchors (no path match, no shared identifier) is protected by a per-file byte floor. Below the floor (`DEFAULT_MIN_FILE_TRIM_BYTES`, a module constant), the caller-selected file passes through unchanged, so a small file the occupant deliberately named is never reduced. Only a no-anchor file larger than the floor is trimmed, and then to its leading `headLines` lines (the file head, which is where imports and top-level declarations sit) plus one elision marker for the dropped body. The retained head is what grounds the identity claim: no absolute "imports survive" guarantee is made beyond "the file head is retained verbatim", since imports below `headLines` in an unusually-ordered file are not specially detected. This keeps the drop bounded to genuinely large, genuinely diff-irrelevant files, which is where the ~62%-irrelevant payload weight sits, while leaving every small caller-selected file intact.

**Assumes:** the diff supplied to `review-call.mjs` is unified-diff text with standard `+++ b/<path>` and `@@ -a,b +c,d @@` hunk headers (the format faff-graft and the spec-review occupant already produce).

**Assumes:** the shared-prefix cache (FAFF-903) still holds after trimming. The trim is a pure function of `(contextFiles, diff)`, and both are byte-identical across the four spec-review lenses, so the trimmed context is identical across lenses and remains a stable cacheable prefix.

**Chosen:** the trim fails safe on any parse ambiguity. Path matching accepts both git-prefixed (`a/`, `b/`) and bare paths; on an unparseable hunk header, a rename, or a context file whose path cannot be matched and which has no identifier anchors, the file is passed through unchanged rather than trimmed on a bad guess. A wrong trim is never preferable to no trim, so every uncertain case degrades to today's behaviour for that file.

**Chosen:** the gate targets the context bundle specifically — the FAFF-914 measurement that this fix responds to found the context bundle was ~62% of the oversized payload, so trimming it is on-target. A payload dominated instead by an oversized diff or system prompt is out of scope here; that is the general map-reduce decomposer's job (the cancelled sibling), not this targeted context-trim.

**Assumes:** reduced grounding on a heavily-trimmed file is an accepted tradeoff, not a regression. The ticket ratifies the simplest mechanism that clears the empty-out knee (a touched-region + window heuristic) over a fuller call-graph; the window plus identifier anchors keep the touched region and its neighbourhood, and the alternative today is a reasoning-ON review that empties out and returns zero findings. A trimmed-but-produced review beats a whole-context review that produces nothing.

**Chosen:** the tuning constants are fixed to concrete build defaults so default-mode behaviour is verifiable: `window` (W) = 24 lines, `DEFAULT_CONTEXT_TRIM_BYTES` = 49152 (48 KB of assembled context), `DEFAULT_MIN_FILE_TRIM_BYTES` = 2048 (2 KB per-file floor), `headLines` = 12. These are module constants with the values named here; the acceptance tests pass explicit `window`/`thresholdBytes`/`minFileBytes` arguments so the oracle never depends on a later constant change.

**Assumes:** the named constants are a working starting point, not a calibrated optimum. A later review-bench pass (FAFF-904) may re-tune them against the measured empty-out knee; re-tuning changes only the constant values, not the trim's shape or its contract, so it is out of scope for this build.

## Implementation shape

- A pure, exported function (for direct unit testing, matching the file's existing pure-function convention) that takes `{ contextFiles, diff, thresholdBytes, window, minFileBytes, headLines, maxAnchorLines, retainedCeiling }` and returns the trimmed `contextFiles` plus a small report `{ trimmed, bytesBefore, bytesAfter }`.
- Diff parsing helpers: extract touched path→ranges and the changed-line identifier set.
- Call site: between reading the context files and `assembleUserMessage` in `main`, threshold read from the `--context-trim-bytes` flag or the default constant. A one-line stderr note when a trim actually fires (bytes before/after), consistent with the file's other advisory stderr notes.

## Done

The acceptance tests use one **fixed fixture** so every criterion below is born-verifiable against a specified input, not a fixture the build chooses. The fixture is three synthetic context files of `line NNN` text: `touched.js` (400 lines, ~3 KB), which the diff modifies at lines 200-201; `unrelated_big.js` (400 lines, ~3 KB, above `minFileBytes`), which the diff does not touch and which shares no identifier token with the diff's changed lines; and `unrelated_small.js` (20 lines, below `minFileBytes`), likewise untouched and non-co-named. The test passes explicit `thresholdBytes` (below the fixture's combined size), `window` = 24, `minFileBytes` = 2048, `headLines` = 12, `maxAnchorLines` = 40, `retainedCeiling` = 0.8, so no default constant is part of the oracle.

- Above the threshold, `unrelated_big.js` (large, no anchors) is reduced to its first 12 lines plus one elision marker (the head-retention path); `touched.js` keeps lines 176-225 (200-201 ± 24) plus any identifier-anchored windows and elides the rest; on this fixture `report.bytesAfter <= 0.6 * report.bytesBefore` (a concrete pass/fail line).
- `unrelated_small.js` (below `minFileBytes`) passes through unchanged even above the threshold.
- Below the threshold, `assembleUserMessage`'s output is byte-identical to today (no trim), and the existing review-call test suite passes unchanged.
- Every line inside a diff-touched range survives: the survival check is that the touched line's exact text is present as one of the output lines, and an elision marker is a fixed sentinel string (`... N line(s) elided (FAFF-915 relevance trim) ...`) that no source line can equal, so a touched line is never a marker.
- `--context-trim-bytes 0` disables the trim regardless of size (byte-identical passthrough).
- On an unparseable hunk header, a rename, or a context file whose path cannot be matched and which has no identifier anchors, the file passes through unchanged (the fail-safe), verified by a test that feeds a malformed diff and asserts no file was trimmed.
- When a trim fires, exactly one stderr note reports bytes before/after; on the no-op paths (below threshold, disabled) no note is emitted.
- The trimmed context is identical across repeated calls with the same `(contextFiles, diff)` (deterministic), so the cross-lens shared prefix is preserved.
- A frequency-capped identifier (one appearing on more than `maxAnchorLines` lines of a file) contributes no anchors for that file, and a file whose retained fraction would still exceed `retainedCeiling` falls back to head-retention — both verified by dedicated fixtures; a diff-touched line is still retained in both cases.
- New unit tests cover: threshold no-op (byte-identical), path-touched retention, identifier-window retention (with the exact expected retained lines for the fixture), large no-anchor head-retention, small no-anchor passthrough, touched-line-never-dropped, frequency-cap, retained-ceiling fallback, the fail-safe passthrough on a malformed diff, the stderr-note-on-fire, and the disable flag. `node --test` over the adversarial-review test files passes; `faff validate-adapters`, the unit suite, and `faff lint-refs` are clean.

confidence: high
