# FAFF-1014: Order-aware capture-wiring lint

> Spec: faffter-dark-nlspec · 2026-09-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1014.

> Revised 2026-09-06 (v3): the original one-line `Math.abs → d < c` idea was empirically falsified by spec-review (it reds the tree: 7 of 9 kernels are authored as same-sentence capture notes, so `d == c`). Re-scoped, under the operator's standing authorization to proceed, to the (a)+(b) predicate below, which matches the real authoring convention and keeps the tree green. Supersedes the v1/v2 spec previously in this comment.

This spec re-produces FAFF-1014, a Low chore against the capture-wiring lint in `plugin/skills/faff/bin/lib/validate-adapters.js`. It is written for the build agent that will change the lint and its tests, and for the human reviewer who will verify the green-tree property empirically. The original one-line idea for this ticket was empirically falsified by spec-review and is replaced here; the reframe is deliberate and is recorded in the design rationale.

## 1. WHY, problem and principles

The load-bearing model: the capture-wiring lint should assert that a kernel's `decide --export` runs **before** its `faff <k>` consult, but it must assert this the way the wiring is actually authored in this codebase, which is mostly as a single capture-note sentence carrying both tokens, not as separate driver and consult lines. A predicate that assumes line-number separation is wrong about the source and reds the tree.

Problem statement. The current test in `captureWiringUnwired` is order-agnostic: for a kernel `K` it pairs any `faff K` consult with any `decide --kernel K --export` line and accepts them when `Math.abs(d - c) <= CAPTURE_WIRING_WINDOW`. It therefore accepts a driver that sits *after* its consult, which does not guarantee the export ran first, so the lint does not actually enforce the ordering it exists to protect. The change makes the predicate order-aware while still matching the real authoring convention, so all nine shipped kernels stay wired.

Design principles.

**The green tree is the acceptance oracle, not a nice-to-have.** `faff validate-adapters` MUST exit 0 on the real origin/main tree after the change, with all nine `captureDecision` kernels reported wired. Any predicate that reds the shipped tree is wrong by definition, whatever its abstract merits. The reviewer verifies this empirically.

**Match the authoring convention, do not impose one.** The wiring is written as prose capture notes. Eight of nine kernels state the ordering in one sentence that carries both the `--kernel K ... --export` driver and the `faff K` consult token (so the driver line and the consult line are the same line). Only `project-next` is authored with a genuine distinct driver line preceding its consult. The predicate must recognise both shapes; it must not require a prose restructure of the SKILL.md files.

**Lint-only change.** This is a change to one helper predicate plus a caller message, plus tests. No kernel set derivation, regex, file-split, fail-closed, or exit-code behaviour changes.

Reference context.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript (Node) | `captureWiringUnwired` (function around line 837) is the predicate being changed; the caller diagnostic is around line 1420 to 1425; `CAPTURE_WIRING_WINDOW = 15` at line 778 |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown prose | Carries the same-sentence capture notes for `next`, `eligible`, `run-outward`, `run-start`, `run-done`, `queue-state` |
| `plugin/skills/faff-tidy/SKILL.md` | Markdown prose | Carries `park-verdict`, `claim-verdict` same-sentence notes, and the `project-next` distinct-line driver (line 214) preceding its consult (line 223) |
| `test/faff-1009-capture-wiring-lint.test.mjs` | Node test (`node:test`) | The lint's test suite; adds the new order-aware cases and updates the pinned caller-message assertion |

Scope statement. This sits inside the FAFF-1009 capture-wiring gate that `faff validate-adapters` runs; it sharpens one predicate inside that gate and touches nothing else in the validator.

## 2. Out of scope

- **Prose restructure of the SKILL.md capture notes.** Excluded: rewriting the eight same-sentence notes into separate driver and consult lines. Why excluded: disproportionate and risky prose surgery across two dense, adversarially-reviewed skill prompts for a Low chore, and it would red the tree until complete. Extension point: a future authoring-convention change would edit the capture notes in `faff-beep-boop/SKILL.md` and `faff-tidy/SKILL.md`, then could tighten predicate (a).
- **Changing the kernel-set derivation.** Excluded: `deriveCaptureKernels`, `balancedCallArg`, and the brace-aware read stay exactly as they are. Why excluded: the set of nine kernels is correct and unrelated to the ordering defect. Extension point: `deriveCaptureKernels` in the same file.
- **Changing `CAPTURE_WIRING_WINDOW` or the fail-closed exit codes.** Excluded: the window stays 15; unwired stays exit 1; a source read error stays exit 2; the empty-kernel-set guard stays exit 2. Why excluded: none of these are the ordering defect. Extension point: the caller block around line 1401 to 1429.
- **The `decision-capture action` marker wiring.** Excluded: the lint only checks the `decide --export` driver against the consult, not the follow-up `action` marker. Why excluded: unchanged by this ticket. Extension point: a separate lint would key on `decision-capture action`.

## 3. WHAT, vocabulary, types, and behaviour surface

Vocabulary.

| Term | Definition |
|---|---|
| consult | A `faff <k>` invocation of a kernel in a SKILL.md, matched by `consultRe(K) = /\bfaff\s+K(?![\w-])/` |
| driver / decide-export | A `decide ... --kernel <k> ... --export` line that mints the correlation id, matched by `isDecideExport` |
| same-sentence wiring | A single line that is both a driver and asserts the pre-consult order in words; the driver line and the consult reference coincide (`d == c`) |
| distinct-line wiring | A driver line at index `d` preceding a separate consult line at index `c` with `d < c` |
| wired | A kernel for which some SKILL.md file satisfies predicate (a) or predicate (b) below |

Existing helpers reused unchanged. `flaggedKernelRe(K) = /--kernel\s+K(?![\w-])/`, `consultRe(K) = /\bfaff\s+K(?![\w-])/`, and `isDecideExport(line) = /\bdecide\b/.test(line) && /--export\b/.test(line) && flaggedKernelRe(K).test(line)`.

New order token. Introduce a same-line ordering check. The word `before` must be matched case-insensitively, because at least one real note begins the sentence with a capitalised "Before" (`faff-beep-boop/SKILL.md` line 281):

```
beforeRe = /\bbefore\b/i
```

The wired predicate (the WHAT the build must implement). A kernel `K` is wired in a SKILL.md file if EITHER (a) or (b) holds:

```
(a) same-line order assertion:
    EXISTS a line L in the file such that
      isDecideExport(L)                                   # L is a K driver line
      AND beforeRe.test(L)                                # it says the export runs "before"
      AND ( /\bconsult/i.test(L) OR consultRe(K).test(L) )# and names the consult it precedes

(b) distinct-line driver precedes consult:
    EXISTS a driver index d (isDecideExport(lines[d]))
    AND a consult index c (consultRe(K).test(lines[c]))
    in the SAME file, with
      d < c
      AND (c - d) <= CAPTURE_WIRING_WINDOW
```

Predicate (a) covers the eight same-sentence kernels. Predicate (b) covers `project-next` and any future correctly-separated site. A capture note that carries the driver tokens but does not state "before" plus a consult reference on the same line, and is not a distinct driver preceding its consult within the window, is no longer counted as wired: that is the new guarantee.

Design decision. See the rationale in section 6. **Chosen:** predicate (a) same-line order assertion OR (b) distinct-line `d < c` fallback.

## 4. HOW, behaviour

Architecture and approach. The change is local to `captureWiringUnwired`. The function keeps its outer loop over derived kernels, its per-file line split, and its early-exit accumulation into `unwired`. Only the inner acceptance test changes: the current `Math.abs(d - c) <= CAPTURE_WIRING_WINDOW` pairing is replaced by the (a)-or-(b) predicate applied per file.

```
PROCEDURE captureWiringUnwired(skillsDir, kernels):
  1. Read every plugin/skills/*/SKILL.md, split into per-file line arrays  (unchanged)
  2. FOR each kernel K in kernels:
     a. cRe = consultRe(K); kRe = flaggedKernelRe(K)
        isDecideExport(line) = /\bdecide\b/.test(line) && /--export\b/.test(line) && kRe.test(line)
     b. wired = false
     c. FOR each file's line array (break outer as soon as wired):
        i.   Collect consults = [i : cRe.test(lines[i])]
             Collect decides  = [i : isDecideExport(lines[i])]
        ii.  Predicate (a): IF any d in decides has
                 beforeRe.test(lines[d]) AND ( /\bconsult/i.test(lines[d]) OR cRe.test(lines[d]) )
             THEN wired = true; break outer
        iii. Predicate (b): IF any (d in decides, c in consults) has
                 d < c AND (c - d) <= CAPTURE_WIRING_WINDOW
             THEN wired = true; break outer
     d. IF not wired: unwired.push(K)
  3. RETURN unwired
```

Behaviour summary: for each kernel, the function asks whether any single skill file either states the pre-consult order in one sentence (a) or places a driver line before a nearby consult line (b); the first file that satisfies either marks the kernel wired.

Caller diagnostic rewording. The unwired message in `cmdValidateAdapters` (around line 1425) currently reads that no SKILL.md carries a `decide --kernel <k> --export` within the window of a `faff <k>` consult. That wording falsely claims the driver is absent, when the real failure under the new predicate is that the driver does not state it runs before the consult. Reword it to name the requirement it now enforces: the capture note must state its `decide --kernel <k> --export` runs before the `faff <k>` consult, either same-line ("before ... consult" / "before ... faff <k>") or as a distinct driver line preceding the consult within `CAPTURE_WIRING_WINDOW` lines. Keep the tail clause about the empty correlation_id. The exact prose is the build agent's to write; it must name the pre-consult-order requirement and must not claim the driver is missing.

Edge cases.
- A driver and consult on the same physical line give `d == c`, so predicate (b) (`d < c`) never fires for them; only (a) can carry a same-line site. This is deliberate and is why (a) exists.
- A file with a driver but no matching consult, and no "before ... consult" assertion, is not wired by that file; another file may still wire the kernel (the outer loop is over all files).
- A driver placed after its consult (`d > c`) with no same-line before-assertion is not wired: (b) requires `d < c` and (a) requires the before token. This is the ordering defect the change closes.

**Anti-pattern:** matching `before` across lines, or globally in the file rather than on the driver line itself. Why: a stray "before" elsewhere in the prose would falsely wire a kernel; predicate (a) must test the token on the same line `L` that is the driver.

**Anti-pattern:** reintroducing an order-agnostic `Math.abs(d - c)` pairing as a third acceptance path. Why: it is exactly the defect being removed; it accepts a post-consult driver.

Failure modes.
- The failure: predicate (a)'s consult-reference leg is too loose or too strict, so a same-sentence kernel flips wired-state. How you'd know: `faff validate-adapters` reds (exit 1) naming one of the eight, or the direct helper test `captureWiringUnwired(SKILLS, kernels)` returns a non-empty array. What it means: narrow the leg (the real notes satisfy word "consult" for `next`/`eligible` and `faff K` for the rest); do not proceed until it returns `[]`.
- The failure: `beforeRe` is case-sensitive and misses the capitalised "Before" on `faff-beep-boop/SKILL.md` line 281, dropping `run-done` and `queue-state`. How you'd know: those two appear in the unwired list. What it means: the `/i` flag is load-bearing; keep it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a SKILL.md whose only capture line for kernel K is a driver
      (`decide --kernel K --export` on one line, also matching `faff K`)
      that does NOT contain the word "before"
When faff validate-adapters runs the capture-wiring gate
Then K is reported UNWIRED and the gate FAILs with exit 1
```

```
Given a SKILL.md with a distinct driver line for kernel K at index d
      and a `faff K` consult at index c, with d < c and (c - d) <= 15,
      and no before-assertion on the driver line (project-next-shaped)
When the capture-wiring gate runs
Then K is reported wired via predicate (b)
```

```
Given a SKILL.md where the `decide --kernel K --export` driver sits AFTER
      the `faff K` consult (d > c) and the driver line has no before-assertion
When the capture-wiring gate runs
Then K is reported UNWIRED (predicate (b) requires d < c; predicate (a) requires "before")
```

- The fail-closed contract is unchanged: an unwired kernel yields exit 1; a kernel-set source read error yields exit 2; an empty derived kernel set yields exit 2.

## 6. Design decision rationale

**How should the capture-wiring lint assert that a kernel's export precedes its consult, given how the wiring is actually authored?**

Options considered.

- Naive line-number `d < c` only (the original ticket idea). Pro: simple, genuinely order-aware. Con: falsified empirically. Applied to origin/main it reds the lint because eight of nine kernels are authored same-sentence (`d == c`), so line-number order is not the model; seven-to-eight kernels flip unwired. Rejected.
- Full prose restructure so every kernel has a distinct before-ordered driver line (the purist option). Pro: makes line-number order the true model. Con: disproportionate and risky prose surgery across two dense, adversarially-reviewed SKILL.md files for a Low chore, and it reds the tree until complete. Rejected.
- Recognise only the generic `--kernel <k>` placeholder driver. Pro: trivial. Con: helps only `next`/`eligible` (the sole kernels with a generic `<k>` operational driver line, which the literal `--kernel K` matcher does not even key on) and does nothing about order. Rejected.
- Predicate (a) same-line order assertion OR (b) distinct-line `d < c` fallback. Pro: matches the actual authoring convention, keeps the tree green (all nine pass, eight via (a), project-next via (b)), delivers a real "the wiring must state pre-consult order" guarantee, and is a lint-only change plus tests. Con: (a) is a prose-token check, weaker than a structural line-order proof. Chosen.

**Chosen:** predicate (a) same-line order assertion OR (b) distinct-line `d < c` fallback, rationale as above. At the time of writing the wiring is prose capture notes; if a future change separates every driver onto its own line, predicate (a) can be retired in favour of (b) alone.

This design was resolved autonomously under the operator's standing authorization to proceed without gating; the reframe from the ticket's original line-number idea to (a)+(b) is deliberate, driven by the empirical falsification of the naive approach against origin/main.

## 7. Open questions and assumptions

Open questions: none.

**Assumes:** the eight same-sentence capture notes on origin/main still each carry the `before` token plus either the word "consult" or a `faff K` reference on the driver line, and `project-next`'s distinct driver (line 214) still precedes its consult (line 223) within 15 lines. Validation: before starting, run `faff validate-adapters` on the current tree (it must pass today under the old predicate) and confirm the capture-note lines in section 3's reference table still read as described; if a note has been reworded, re-check it against predicate (a) before relying on the green-tree DoD.

## 8. DONE, definition of done

### From WHY
- [ ] `faff validate-adapters` exits 0 on the real origin/main tree after the change, with the capture-wiring gate reporting all nine `captureDecision` kernels wired (load-bearing acceptance oracle).

### From WHAT (predicate)
- [ ] `captureWiringUnwired` accepts a kernel via predicate (a): a driver line matching `isDecideExport` that also matches `/\bbefore\b/i` and matches `/\bconsult/i` or `consultRe(K)` on the same line.
- [ ] `captureWiringUnwired` accepts a kernel via predicate (b): a driver index `d` and consult index `c` in the same file with `d < c` and `(c - d) <= CAPTURE_WIRING_WINDOW`.
- [ ] The order-agnostic `Math.abs(d - c)` pairing is removed (no third acceptance path).

### From HOW (behaviour)
- [ ] A same-line driver with the driver tokens but no `before` token is reported UNWIRED.
- [ ] A driver placed after its consult (`d > c`) with no same-line before-assertion is reported UNWIRED.
- [ ] `project-next` (distinct driver line preceding consult within the window) is reported wired via predicate (b).
- [ ] The caller UNWIRED diagnostic is reworded to name the pre-consult-order requirement (same-line "before ... consult"/"before ... faff K", or a distinct driver preceding the consult within the window) and no longer claims the `decide --export` driver is absent.

### From HOW (unchanged behaviour)
- [ ] Kernel-set derivation, regexes, per-file split, `CAPTURE_WIRING_WINDOW`, and exit codes are unchanged: unwired yields exit 1, a source read error yields exit 2, an empty derived set yields exit 2.

### From tests (`test/faff-1009-capture-wiring-lint.test.mjs`)
- [ ] New test: a kernel whose only capture line has the driver tokens but does not state before/consult ordering is UNWIRED.
- [ ] New test: a distinct-line `d < c` site (project-next-shaped) is wired.
- [ ] New test: a distinct-line site with the driver after the consult and no before-assertion is UNWIRED.
- [ ] Test: the real tree still passes, `captureWiringUnwired(SKILLS, deriveCaptureKernels(LIB))` returns `[]` and `faff validate-adapters` exits 0.
- [ ] Test: fail-closed exits unchanged (unwired to 1, source read error to 2).
- [ ] The existing message-pinned assertion (`.../no SKILL.md carries a decide --kernel fixkernel --export/`) is updated to match the reworded diagnostic; the existing pass test (distinct driver preceding consult) still passes via predicate (b).

Integration smoke test:

```
PROCEDURE smoke:
  1. From repo root, run: faff validate-adapters
  2. ASSERT process exit status == 0
  3. ASSERT stdout contains "pass  capture-wiring" and no "FAIL  capture-wiring"
  4. Run the suite: node --test test/faff-1009-capture-wiring-lint.test.mjs
  5. ASSERT all cases pass, including the three new order-aware cases
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "assumes" } ] }
```
