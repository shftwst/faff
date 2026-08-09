# FAFF-531 — `faff config init --set` drops keys inserted into a non-2-space `tracking:` block (round-trip guard fail-closes with `null`)

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-531.

This spec is for the build agent fixing FAFF-531, and for the human reviewers gating it. It corrects the ticket's stated hypothesis: the defect is **not** in the emit-or-parse of `/`-bearing scalars — the slash is a coincidence. The real defect is an **indentation mismatch in the surgical merge writer**, which the round-trip guard then correctly catches.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff config init` never re-serialises the config. It performs a *surgical raw-text edit* of `.faffrc.yaml` (`mergeTrackingBlock`), then re-reads the result with the real parser (`parseYamlSubset`) and asserts every key it set reads back to the value it was handed — a **round-trip self-verify** that fail-closes rather than write a file the reader can't recover (`config.js:540`). That reader treats a map's children as *exactly-aligned* lines: `parseMap(minIndent)` stops at the first line whose indent `!== minIndent` (`shared-infra.js:340`). So the writer and the reader only agree if an inserted line is indented to match the block it is inserted into. The writer does not guarantee that — and that gap is this bug.

**Problem statement.** When `tracking:` already exists and its body is indented with something other than two spaces (the repo's own `.faffrc.yaml` uses four), inserting a *new* key writes that line at a hardcoded 2-space indent (`config.js:466`), so `parseYamlSubset` reads it as outside the block and returns `null` for it. The round-trip guard fires — `internal error — written text does not round-trip … got null` — and the whole write aborts, so a sanctioned `--set` of any not-yet-present key (`tracking.repo=shftwst/faff` among them) is impossible against such a file. The fix makes the insert reuse the block's actual indentation.

**Design principles.**

**The surgical-merge invariant governs the fix — never reserialise.** The writer must keep every other byte of the user's file intact (other blocks, comments, ordering, the trailing-newline state). The fix adjusts only the indentation of newly-inserted lines; it must not normalise, reflow, or rewrite the existing block.

**The round-trip guard is correct and stays.** It is doing its job — it caught a corrupt write. The fix is upstream of it (make the write recoverable); do not weaken, bypass, or special-case the guard to make the symptom disappear.

**Emit/parse of scalars is not in scope and must not be touched.** `emitScalar`/`scalar`/`parseYamlSubset` already handle bare `/`-scalars correctly.

## Chosen decisions

- **Chosen (root cause):** the defect is the merge writer's hardcoded insert indent at `config.js:466`; the `/` in the ticket's repro is coincidental.
- **Chosen (fix):** Option A — the insert reuses the block's own child indentation, defaulting to 2 only when the existing block is empty. Minimal change that satisfies `insert_indent_matches_block` without touching the reader, the emitter, or untouched lines. (decides: architecture)
- **Chosen (selftest):** a `repo: shftwst/faff` insert into a 4-space block asserting clean round-trip AND an unchanged sibling key, plus a non-slash (`team_key`) insert into a 4-space block.

## 4. HOW — the fix

Insert-new-key branch of `mergeTrackingBlock` (`config.js:464`–`470`):

```
1. blockIndent ← 2                                  # default for an empty block
2. FOR i FROM trackIdx+1 TO bodyEnd-1:
     IF lines[i].trim() != "" AND indentOf(lines[i]) > 0:
       blockIndent ← indentOf(lines[i])             # first indented body line wins
       BREAK
3. pad ← blockIndent spaces
4. splice each inserted line with `pad` in place of the hardcoded "  "
```

Only the literal `"  "` at `config.js:466` becomes `pad`; the surrounding splice/counter bookkeeping is untouched. The force-overwrite branch (`config.js:461`) is left alone — it already derives indent from the matched line.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff config init --set tracking.repo=shftwst/faff` against a 4-space `tracking:` body completes exit 0, no round-trip error.
- [ ] The round-trip guard (`config.js:540`–`551`) is unchanged.

### From WHAT / HOW
- [ ] `mergeTrackingBlock`'s insert-new-key branch derives the inserted line's indent from the block's first indented child, defaulting to 2 when empty; the only edit at `config.js:466` is replacing `"  "` with the sampled pad.
- [ ] `emitScalar`, `scalar`, `parseYamlSubset`/`parseMap`, `emitTrackingBlock`, and the force-overwrite branch are byte-unchanged.
- [ ] `dig(parseYamlSubset(mergeTrackingBlock(realRepoConfig, { repo: "shftwst/faff" }).text), "tracking.repo") === "shftwst/faff"` and `…"tracking.spec_docs_path") === "records/specs/"`.
- [ ] Inserting into a 2-space block yields output byte-identical to the pre-fix result.

### From HOW (selftest)
- [ ] A new `configInitSelftest` case inserts `repo: shftwst/faff` into a 4-space block, asserts value round-trips AND sibling key unchanged.
- [ ] A new case inserts a non-slash key (`team_key=FAFF`) into a 4-space block, asserts round-trip.
- [ ] Full selftest suite passes; every pre-existing case still passes.

### Verification
- [ ] `faff config init --set tracking.repo=shftwst/faff` writes cleanly against the repo's own `.faffrc.yaml`; re-reading yields `tracking.repo == "shftwst/faff"` with all other blocks byte-intact.

confidence: high
spec-review: approve
