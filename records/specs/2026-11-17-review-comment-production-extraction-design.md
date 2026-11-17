# Review comment stored handoff extraction

Status: draft production extraction. Local deterministic checks pass; hosted connector qualification and fresh model validation remain outstanding. The source is ported from the existing review-comment implementation onto main. No experiment runner or recorded model output is a production dependency.

## Boundary and activation

The pure TypeScript planner selects and splices a terminal review comment. The session stores its immutable target and body; the MCP bridge reads complete comments and applies only the stored body after a fresh snapshot comparison. The caller supplies new findings and a plan reference, never copies existing human text into a write. Verdict judgement, per-pass logging and issue claims remain with the caller.

Activation requires an operator-owned upstream executable, authentication and tool bindings whose complete-list and acknowledgement contracts have been verified. Until then the comment operation is blocked without changing the review verdict. There is no planner-only write fallback. The example configuration is not a qualified hosted deployment.

## Policy decisions retained

These decisions intentionally make ambiguous historical prose precise; this is not a claim of byte-for-byte behavioural equivalence with every reading of that prose.

| Boundary | Implemented policy |
|---|---|
| Indentation | Leading whitespace disqualifies a marker; trailing whitespace is ignored for recognition |
| Ordering | Complete pairs first, then earliest timestamp; equal timestamps retain listing order; missing timestamps last |
| Authorship | Ignored for target selection; a marker does not authenticate its author |
| Repeated markers | First open through first subsequent close defines the region; later text is preserved |
| Fenced text | Markers inside backtick or tilde fences are data; ambiguous open-only recovery is refused |
| Line endings | Preserve exact prefix and suffix and replacement text |
| Framing | Canonical open marker, LF, replacement, LF, close marker; replace marker-line trailing whitespace |

The planner accepts only schema 1 with issue_id, faff_body and comments. It rejects duplicate IDs, malformed timestamps, invalid Unicode, active replacement markers and unclosed replacement fences. The CLI rejects duplicate JSON keys and input over one MiB, returning exit 2 without a plan. It performs no tracker I/O.

References expire after five minutes, are process-local and single use, and are consumed before apply I/O. Apply invalidates other prepared references for the issue. A changed snapshot, expiry or failed read refuses before writing. Upstream write errors or missing acknowledgements are uncertain; inspect live state before another write and never retry automatically. Limits are sixteen plans, one MiB input/snapshot, eight MiB messages and thirty-second requests. A recheck is not remote compare-and-swap; acknowledgement is not proof of durable storage.

## Validation and limits

The focused planner, session and MCP tests cover eleven fixed oracle scenarios, exact bytes through the subprocess path, stale/expired/consumed references, override rejection, concurrency and uncertain outcomes. Two hand-authored fixture JSON files and a narrow stdio tracker double live under test/. No evaluation runner is imported. Build emit, factory direction and CLI coverage are checked separately.

Prior planner-only model failures remain failures. Local tests establish neither a hosted tracker's contract nor full workflow/cost/latency improvement. Root review and the existing diagnostic route remain separate gates.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Locate it deterministically` | Graft loads the canonical read/plan/write instructions instead of restating marker mechanics. |  | changed: replace duplicated algorithm with the canonical reference |
| `The single terminal review-findings comment` | Caller retains terminal verdict, summary, log pointer and one-comment density; command owns marker identity. | test/review-comment.test.mjs | changed: split caller responsibilities from deterministic marker planning |
| `<!-- faff-review-findings:<ISSUE-ID> -->` | Command emits the same marker-pair shape around the exact replacement. | test/review-comment.test.mjs | kept |
| `Identity lives in the body, not tracker metadata` | Caller retains body identity, no config or ID map and no additional write density; command bounds the replacement region. | test/review-comment.test.mjs | changed: retain behavioural obligations; drop the explanation of rendered marker visibility |
| `Locate → create-or-update` | Prepare live-reads and stores a plan; apply rereads and sends the stored body replaces the interpreted algorithm. | test/review-comment.test.mjs | changed: delegate computation to the command |
| `List the issue's comments (live read)` | Connector owns complete current reads and exact transport; command rejects leading whitespace, quotes, inline markers, close-first and fenced markers; trailing whitespace follows the recorded decision. | test/review-comment.test.mjs | changed: resolve the seven recorded policies and move recognition into code |
| `0 matches → create: body = marker_open` | Creates the canonical marker/body/marker plan when no structural match exists. | test/review-comment.test.mjs | kept |
| `1 match → update-in-place` | Returns the selected ID, exact spliced body and original-body digest. | test/review-comment.test.mjs | kept |
| `>1 match (rare concurrent-create race` | Prefers a complete pair then the oldest instant, keeps listing-order ties, puts missing times last, ignores authorship, preserves other comments and never deletes. | test/review-comment.test.mjs | changed: deterministic selection implements the recorded ordering and authorship decisions |
| `Splice (human-edit safety` | Preserves prefix/suffix exactly; first open through first following close; open-only recovery preserves prefix; canonical marker-line framing follows the recorded decisions. | test/review-comment.test.mjs | changed: move splice into code, resolve newline framing and refuse ambiguous open-only recovery before it can discard human text |
| `Edges: a human's unmarked findings-like comment` | Unmarked text is never adopted. Caller retains that markers do not prove authorship and existing claim/status concurrency contract, with no lock/CAS claim. | test/review-comment.test.mjs | changed: remove optional authorship preference per recorded decision and retain the limits |
| `4. Run Step 9 (review phase)` | Retains pre-PR review, tracker-only findings, both modes and four-valued routing; uses the canonical comment instructions. |  | changed: shorten the duplicated comment mechanics without changing orchestration |
