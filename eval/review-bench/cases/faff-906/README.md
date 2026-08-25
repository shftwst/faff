# FAFF-906 case: claim-store hardening

Two review-bench cases built from the real FAFF-906 ticket ("Harden the shared claim-store
staleness/reclaim primitive"), for benchmarking a local backend against the payload shapes that
actually degraded spark-qwen (`unsloth/Qwen3.8-27B-NVFP4`) on this ticket.

## What went wrong on the real run

FAFF-906's build worktree (`faff-906-harden-the-shared-claim-store-stalenessreclaim-primitive`,
branch tip `63ac4af8`) recorded this in
`.faff/runs/interactive-FAFF-906/FAFF-906/review-verdict.json`:

> Phase 1 (standard structural review) passed. Phase 2 (adversarial second opinion,
> faffter-dark-adversarial-review) could not produce a verdict: the primary backend (spark-qwen,
> unsloth/Qwen3.8-27B-NVFP4) returned malformed output (no recognised finding section), and the
> fallback (studio-qwen) hung well past a reasonable window without returning.

That is the `code-review` case below: the adversarial review over the real diff, the step spark
actually failed on. The `spec-review` case is provided for comparison. FAFF-906 also went through
spec review at prep time, over a much larger context set (four referenced files instead of one
changed file), so it is a useful second data point on whether prompt size alone explains the
degradation.

## Capture: reconstructed, not verbatim

No raw request JSON from either the actual Phase 2 adversarial-review call or the spec-review
fan-out survives anywhere in the worktree, `.faff/runs/`, or `.faff/anchors/`, only the verdict
summary above. Both cases here are **reconstructed** from the committed source material, following
the exact assembly rules in `plugin/skills/faffter-dark-adversarial-review/SKILL.md` and
`plugin/skills/faffter-dark-spec-review/SKILL.md`, using the same fencing logic
(`assembleUserMessage`) the kit's own `build-requests.mjs` / `build-requests-code.mjs` implement.
They are faithful to those rules, not confirmed byte-identical to what was actually sent.

## code-review

- **Diff**: `diff/faff-906.diff` = `git diff origin/main...HEAD` from the FAFF-906 worktree, the
  three commits on the branch (spec, ADR, implementation). Per the adversarial-review skill, Phase
  2 is sent "the full diff: `git diff main...HEAD`", not a code-only subset, so the ADR and spec
  markdown additions are included alongside the `bundle.js` change.
- **Context**: `context/` holds the current (post-change) full content of every file the diff
  touches: `bundle.js`, the new ADR (0119), and the new spec. Per "`--context` = every file the
  diff touches".
- **Lens**: `lens/review-lens.md` is an unmodified copy of the kit's existing
  `eval/review-bench/code-review/lens/review-lens.md`.
- **Size**: system ~2.1 KB, user ~268 KB, ~67.5 K prompt tokens (`requests/code-review.json`
  `meta`). That is roughly 7x the shipped skeleton code-review case's ~39 KB diff, almost entirely
  because the diff and context both carry two brand-new markdown files in full, on top of the
  changed `bundle.js`.

Run it:

```
cd eval/review-bench
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model unsloth/Qwen3.8-27B-NVFP4 \
    --key-env OMLX_API_KEY --requests-dir cases/faff-906/code-review/requests --lens code-review
```

## spec-review

- **Spec**: `spec/faff-906.md` = the committed FAFF-906 spec
  (`records/specs/2026-08-25-FAFF-906-harden-claimstorecore-clock-skew-staleness-toctou-reclaim-design.md`).
- **Context**: `context/` holds the four files the spec's own "Reference context" table names:
  `bundle.js`, `runcheck.js`, `claim-verdict.js`, `lights-out.js`, at their pre-implementation
  content (`origin/main`, before the FAFF-906 commits), since spec review runs before the code
  change lands.
- **Lenses**: reused directly from `eval/review-bench/lenses/` (not copied into this case), so
  they stay covered by `test/review-bench-lens-parity.test.mjs`'s canonical-drift guard.
- **Size**: system ~2 KB per lens, user ~338 KB, ~85 K prompt tokens per lens
  (`requests/*.json` `meta`), over 5x the shipped gk-spec case's ~15.8 K tokens, almost entirely
  the four full reference files (`lights-out.js` alone is ~135 KB).

Run one lens:

```
cd eval/review-bench
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model unsloth/Qwen3.8-27B-NVFP4 \
    --key-env OMLX_API_KEY --requests-dir cases/faff-906/spec-review/requests --lens qa
```

Run the full 4-lens fan-out:

```
node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model unsloth/Qwen3.8-27B-NVFP4 \
    --key-env OMLX_API_KEY --requests-dir cases/faff-906/spec-review/requests --concurrent
```

## Regenerating

Each case has its own `build.mjs`, run from inside the case directory:

```
node cases/faff-906/code-review/build.mjs
node cases/faff-906/spec-review/build.mjs
```

## Caveat

The confirmed failure is the `code-review` case (the verdict above names it explicitly). The
`spec-review` case is not known to have failed on spark for FAFF-906 specifically. It is included
because it is the ticket's other, even larger, real payload, and because a size-correlated failure
mode would be expected to show up there too. Do not read a spec-review result on its own as
confirming or ruling out the code-review finding.
