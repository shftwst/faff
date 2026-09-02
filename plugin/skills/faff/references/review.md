# Faff gateway reference — review & delivery

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Review-findings comment identity (the idempotency key)

The single terminal review-findings comment (the collapse-and-log rule: one comment per build on the tracker issue) is posted **or updated in place**. Its identity — the **idempotency key** that makes update-in-place deterministic — is a hidden HTML-comment **marker pair** in the comment body, keyed by issue id:

```
<!-- faff-review-findings:<ISSUE-ID> -->
…faff-authored verdict + "resolved N findings across M passes" summary + log pointer…
<!-- /faff-review-findings:<ISSUE-ID> -->
```

Identity lives in the **body**, not tracker metadata: the tracker exposes no native idempotency-key param and faff keeps no comment-ID map (`.faffrc` is stable-config-only). The marker is invisible in rendered markdown (skimmability), greppable in `list_comments` output, and the *pair* bounds the **faff-owned region** (text between the markers) so update rewrites only faff's text. This adds **no** new comment, per-pass marker, or write density — it only makes *the one* comment findable.

**Locate → create-or-update** (run at the terminal verdict; `marker_open(id)` = `<!-- faff-review-findings:<id> -->`):

1. List the issue's comments (live read); `matches` = those that **structurally match** — the **first marker line** of the body equals `marker_open(id)`. A **marker line** is a line that, trimmed of surrounding whitespace, equals `marker_open(id)` or `marker_close(id)`; a marker that appears inside other text (quoted `> <!-- … -->`, indented, or mid-sentence) is **not** a marker line. Scan top-down: the first marker line must be the open marker. This rejects a human quote or a third-party paste that merely *contains* the marker (the injection vector) while a genuine faff comment — which authors the open marker as the body's first line — matches unchanged. (Substring-anywhere was the prior, vulnerable predicate.)
2. **0 matches** → create: body = `marker_open` + newline + faff_body + newline + `marker_close`.
3. **1 match** → update-in-place: splice (below) the faff_body into that comment, `save_comment(id=…)`.
4. **>1 match** (rare concurrent-create race, or a paste that opens with the marker) → reconcile, choosing the update target by: first prefer comments that carry **both** a `marker_open` line and a `marker_close` line (a complete, well-formed faff comment) over open-only ones; where the tracker exposes comment authorship, a faff-authored comment may *additionally* be preferred (optional, tracker-permitting — never required, never the sole discriminator); then splice into the **oldest by `created_at`** of the remaining pool (oldest-wins, stable). The "both markers" preference is a tie-break, **not** a match gate — an open-only comment is still a structural match so the legacy-truncated splice path (below) survives. Leave the other duplicate(s) in place untouched, do not error. **Never delete** them — autonomous delete is forbidden (appetite hard floor); a left duplicate is a visible, human-clearable anomaly, not corruption.

**Splice (human-edit safety — gateway → *Human curation is authoritative* assertion 3):** replace only the text **between** the markers with faff_body; preserve everything before `marker_open` and after `marker_close` **verbatim**. If `marker_open` is present but `marker_close` is missing (legacy/truncated), treat marker_open→end as the faff region and re-wrap it with a fresh pair, preserving text before it. **Never discard text outside the faff-owned region** — a human's steering edits live outside the markers and are safe.

**Edges:** a human's *unmarked* findings-like comment is never adopted (the key is the marker, not content). The concurrent-create hazard is already bounded to "a wasted duplicate, never corruption" by **Issue claim & status monotonicity** — this reconcile leans on that posture rather than adding a lock/CAS. **Residual, known-bounded:** a third party pasting `marker_open` as the literal *first line* of their own comment is still a structural match; this is bounded — the splice preserves all text outside the marker pair and the claim-monotonicity posture caps the worst case at a wasted write, never corruption — and the >1 tie-break (prefer a complete, faff-authored comment) reduces but does not claim to eliminate it.


### Producer slots vs adaptor slots (what to swap, when)

The `spec` / `review` / `ship` contracts are **producer-emitted**: the producer self-declares its contract data as a `faff-contract:<name>` block, and the consumer (`faff-prep`, `faff-graft` Step 9 / Step 10) locates it, `JSON.parse`s it, and calls `faff contract <name>` directly. There is **no** paired adaptor slot for these three — the prose-extraction adaptors (`spec_adaptor` / `review_adaptor` / `ship_adaptor`) were retired. Two adaptor slots remain.

- **Producer slots** (`intake`, `spec`, `review`, `ship`) *do the work* and emit native output **plus** their `faff-contract:<name>` block (`intake` is the exception — it emits a documented brief with no contract). Swap one to change *how the work is done*; the swapped producer conforms by emitting the same block (the consumer parses it with **no** translation layer) — or, if its native tool can't, by being wrapped via **`faffter-dark-authoring-adaptors`**, which emits the block on the producer's behalf. The absent-block fallback (the consumer reads the producer's prose) is the only place an LLM seam survives, and only for a producer that emits nothing.
- **Adaptor slots** (`routing_adaptor`, `rendering_adaptor`) *translate and validate*. `routing_adaptor` assigns a **computed** verdict (no producer authors it, so there's no artifact to emit); `rendering_adaptor` has **no** fixed internal contract (human-facing only). Swap either to change translation / house-style; the fixed internal contract never moves.

**Rule of thumb for a slot swap:** change the **producer** to change behaviour. A producer whose output the consumer can't parse from the standard `faff-contract:<name>` block is **wrapped via the fused wrapper**, not handed a bespoke adaptor slot. `intake` and `concurrency` have no contract pairing — `intake` emits a brief directly (see `faffter-noon-intake`), `concurrency` drives faff's own graft, which already speaks faff's vocabulary. The `methodology` slot is a named-output lens governed by its own contract (see **The `methodology` slot**).

