# Spec — FAFF-939: gate the standalone self-mint on a non-refuse run-start verdict

> Spec: faffter-dark-nlspec · 2026-09-21 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-939.

This spec addresses **FAFF-939** — a prose ordering fix in `plugin/skills/faff-plot/SKILL.md`, in the `/faff-plot --autonomous` "Ignition + the outward-only guard" section (lines 190–202). The audience is the build agent applying a single prose-only edit and the human reviewer gating it. There are **no CLI or code changes** — `run-outward`, `run-record-prd`, and `run-start` are already correct and pure; the defect is entirely in the bullet ordering of the skill prompt.

## 1. WHY — problem and principles

**The load-bearing model.** The Ignition section's header promises one invariant: the run-start guard is "sequenced before any write." A write here means minting a fresh L4 run-ledger — the `.faff/runs/<id>/` structure directory that commits faff to a run. For that promise to hold, the only bullet that mints (the standalone `not-l4` self-mint) must fire *after* the guard clears, never before.

**Problem statement.** Today the `not-l4` self-mint bullet (line 200) is textually ordered *above* the "Assert via `faff run-start`" bullet (line 201). Read literally, a standalone self-directed ignition — `FAFF_RUN_DIR` unset, target resolving to faff's own repo — would compute `outward:false`, classify `not-l4`, self-mint an L4 run-ledger, and only *then* assert `run-start = refuse` and STOP, leaving an orphaned run-dir. This change reorders the prose so the standalone mint is gated on a non-refuse `run-start` verdict, making the header invariant and the refuse branch's "zero tracker/structure writes" guarantee true by construction.

**Design principles.**

- **Fix the sequencing, not the mechanics.** The lights-out preflight mint, the signals passed to `run-start`, and every CLI stay byte-unchanged. Only *when* the mint fires moves. An edit that rewrites mint behaviour, or touches a CLI, has overreached.
- **The guard is the full `run-start` verdict, not a narrowed proxy.** `run-start` owns the whole refusal taxonomy (self-directed and every other reason). Gating the mint on the complete verdict — rather than only re-checking the computed `outward` boolean — is what keeps the guard honest against refusal reasons beyond outwardness.
- **No scope widening.** This is a correctness-tightening docs fix that makes the prose match the already-stated guard-before-write invariant. It must not widen or loosen autonomous posture, so it is not gated behind the eval sweep.
- **Honour the skill-authoring lint floor.** `faff validate-adapters` lints line caps (600/file), paragraph length (200 words; bold-lead bullets WARN rather than FAIL over cap), and stray markers (run-ids, war-story idioms) — and `faff lint-refs` bans `FAFF-NN`/`ADR` refs in `SKILL.md`. The reworded prose must introduce none of these.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `plugin/skills/faff-plot/SKILL.md` (lines 190–202) | Skill prompt (markdown prose) | The only file edited — the Ignition + outward-only-guard section |
| `docs/reference/skill-authoring.md` | Contributor charter | The lean/deduplicated/skimmable standard + the lint rules the edit must not trip |
| `faff run-start` / `faff run-outward` / `faff run-record-prd` | CLIs (unchanged) | The pure, correct verdict/classify commands the prose sequences — not modified |

**Scope statement.** This locates entirely inside the `/faff-plot --autonomous` ignition prose; it does not touch the gate→verdict seam, Step 5b/5c, or any other section.

## 2. OUT OF SCOPE

- **Any CLI or code change** — Why excluded: the issue establishes `run-outward`, `run-record-prd`, and `run-start` are already correct and pure; the defect is prose ordering only. Extension point: a genuine CLI defect would be a separate ticket against the relevant `bin/`/`lib/` command, not this prompt.
- **The `inherited-l4` branch's pre-run-start `prd_root_container` record (line 199).** Why excluded: `inherited-l4` records onto an *already-live, parent-minted* ledger whose lifecycle `§0a` owns — it self-mints nothing and creates no orphan-able structure, and a nested inherited pass over an admitted external root is not a reachable `run-start` refuse (its target is outward by construction). The issue scopes the fix to the standalone self-mint, and the caller's constraint requires the `inherited-l4` path stay unaffected. Extension point: if a future change makes a nested inherited pass able to refuse at `run-start`, revisit whether that record must also defer — a distinct ticket.
- **The `fault` refusal (line 198) and its "checked first" placement** — Why excluded: `fault` is a write-free classification refusal (foreign/invalid handoff), so it neither violates the guard-before-write invariant nor mints anything; it stays checked first. Extension point: none needed.
- **The section header text (line 192)** — Why excluded: the header already states the correct invariant ("sequenced before any write"); the fix makes the body honour it, so the header needs no edit.
- **Introducing evidence-file paths, run-ids, or tracker refs into the prose** — Why excluded: the issue's evidence pointer and cross-ticket references are war-story provenance that the lint rules ban from `SKILL.md`; they belong in this spec's rationale and the commit trailer, never the edited file.

## Already shipped against this surface

- **FAFF-521 — "Run-start OUTWARD-only enforcement for autonomous plot ignition (494b)" (Done 2026-07-16).** The ticket that *authored* the Ignition + outward-only-guard prose being fixed here (the "real run-start OUTWARD-only predicate, sequenced before any write" replacement of the former stub guard). It is the origin of the prose, not a delivery of this ordering fix — related, not superseding.
- **FAFF-499 — "Whole-loop proof … lights-out" (Done 2026-08-31)** and **FAFF-492 — "End-to-end proof …" (Done 2026-08-30).** The OUTWARD-negative live-fire under FAFF-499 is where this defect was surfaced (2026-08-30); the test sequenced the guard first, so zero writes held, but the prose bug was left standing. Proof tickets, not a fix.
- **Premise verdict: still holds.** No Done work delivered this prose reorder; the defect remains live in `plugin/skills/faff-plot/SKILL.md` (the `not-l4` mint still precedes the `run-start` assert). Proceed unchanged.

## 3. WHAT — the target prose shape

**Vocabulary.**

| Term | Definition |
|---|---|
| standalone ignition | A bare `/faff-plot --autonomous` with `FAFF_RUN_DIR` unset — the `not-l4` class; the only branch that self-mints |
| self-directed refuse | `run-start`'s refuse verdict when the resolved target is faff's own repo (`outward:false`); a policy boundary, never park-and-retry |
| orphaned run-dir | A `.faff/runs/<id>/` structure minted before the guard refuses — the defect this fix eliminates |
| guard-before-write invariant | The section header's promise that the `run-start` predicate is sequenced before any minting write |

**The end-state ordering** the edited section must express (subjects restated, no invented labels):

```
Resolve target → resolve SelfRef → compute OutwardSignal
  → classify the inherited handoff (write-free; report-only):
       fault        → REFUSE loudly, zero writes, STOP   [still checked first]
       inherited-l4 → reuse $FAFF_RUN_DIR, self-mint nothing, record prd_root_container   [unchanged]
       not-l4       → select the standalone path but MINT NOTHING YET (mint deferred)
  → assert run-start (refuse, any reason incl. self-directed → zero writes, STOP)
  → ONLY on a non-refuse verdict:
       standalone (not-l4) case → perform the deferred lights-out self-mint now;
                                  runDir := freshly-minted dir
       nested-inherited case    → runDir already := $FAFF_RUN_DIR
  → descend to the §gate→verdict seam, using runDir as prd_root_container records onto
```

The invariant made true: the single minting write (`not-l4`) now sits strictly after the `run-start` assert, so a refused standalone ignition mints nothing.

## 4. HOW — the exact edit

**Behaviour summary.** Three bullets change; nothing else in the file moves. The `not-l4` sub-bullet stops minting inline and instead selects the standalone path with the mint explicitly deferred. The `run-start` bullet gains a clause stating the standalone zero-write guarantee now holds by construction. The closing bullet performs the deferred mint on a non-refuse verdict.

**Chosen fix shape.** Defer the `not-l4` mint until `run-start` returns non-refuse (gate on the *full* verdict), rather than only re-checking the `outward` boolean at the mint site. Rationale: `run-start` owns the complete refusal ladder; a bare `outward` re-check would leak past non-outward refuse reasons and re-derive taxonomy the prose says lives nowhere but `run-start`. **Chosen:** gate the standalone mint on a non-refuse `faff run-start` verdict, mint performed after the assert.

**Chosen structural placement.** Defer *only* the `not-l4` mint; keep `fault` checked first and the `inherited-l4` record where it is. Moving the whole `run-start` assert above the classify block would push `fault` after the guard (contradicting its "checked first" placement) and reorder the out-of-scope `inherited-l4` record. **Chosen:** minimal reorder touching only the `not-l4` mint's timing.

### Edit 1 — the `not-l4` sub-bullet (currently line 200)

Replace:

> - **`not-l4`** — the standalone case (a bare `/faff-plot --autonomous`, no inherited L4 handoff): **self-mint an L4 run-ledger** via the existing lights-out preflight (the same one `faff lights-out` runs — reused, not reimplemented), capturing `target_resolved` + the resolved target. `runDir := ` the freshly-minted dir. Unchanged from today.

with:

> - **`not-l4`** — the standalone case (a bare `/faff-plot --autonomous`, no inherited L4 handoff): this **selects** the standalone self-mint path but **mints nothing yet** — the L4 self-mint is **deferred until the `run-start` assert below returns non-refuse**, so a refused standalone ignition leaves no orphaned run-dir. The mint mechanics are unchanged; only their sequencing moves after the guard (performed in the closing bullet).

### Edit 2 — the `run-start` bullet (currently line 201)

In the sentence beginning "A nested pass that refuses touches no ledger…", prepend the standalone case so both zero-write guarantees are explicit. Replace:

> A nested pass that refuses touches no ledger — the **shared** `runDir` is left untouched (no mint, no close; §0a owns its lifecycle).

with:

> A standalone pass that refuses has **not yet self-minted** (the mint is deferred to the closing bullet), so its zero-write guarantee holds by construction; a nested pass that refuses touches no ledger — the **shared** `runDir` is left untouched (no mint, no close; §0a owns its lifecycle).

The rest of the `run-start` bullet (the signals shape, the refuse-verdict handling, `needs-human`, surface-for-`/faff-wtf`, never-park-and-retry) is unchanged.

### Edit 3 — the closing bullet (currently line 202)

Replace:

> - Only on the other two verdicts does the pass proceed to the §gate→verdict seam below, using `runDir` (nested-inherited or standalone-minted) as the ledger `prd_root_container` records onto.

with:

> - Only on a **non-refuse** verdict does the pass proceed. For the standalone (`not-l4`) case it **now** performs the deferred self-mint — the lights-out preflight (the same one `faff lights-out` runs, reused not reimplemented), capturing `target_resolved` + the resolved target — and sets `runDir := ` the freshly-minted dir; the nested-inherited case already has `runDir := $FAFF_RUN_DIR`. The pass then descends to the §gate→verdict seam below, using `runDir` (nested-inherited or standalone-minted) as the ledger `prd_root_container` records onto.

**Feasibility note (why the reorder is sound).** The `run-start` assert takes `--signals { target_resolved, outward, prd_present, … }` only — it does **not** reference `runDir`. So asserting `run-start` before the mint needs no minted ledger to exist; the standalone mint can move strictly after the verdict with no CLI change. This is the load-bearing fact that makes the fix prose-only.

**Anti-pattern:** re-checking only the `outward` boolean at the mint site instead of the `run-start` verdict. Why: it re-derives refusal taxonomy `run-start` owns and misses non-outward refuse reasons — the guard must be the whole verdict.

**Anti-pattern:** moving the entire `run-start` assert above the classify block to "simplify." Why: it displaces `fault` from its "checked first" position and reorders the out-of-scope `inherited-l4` record — scope creep beyond the ticket.

**Anti-pattern:** carrying the issue's evidence path or tracker refs into the bullet text. Why: `faff validate-adapters` / `faff lint-refs` ban run-ids, war-story idioms, and `FAFF-NN`/`ADR` refs in `SKILL.md`.

### Failure mode — the narrowed guard

- **The failure** — a reviewer or builder "optimises" the fix to gate the mint on the `outward` boolean alone rather than the `run-start` verdict. It looks equivalent for the demonstrated self-directed case (which *is* an outward refusal), but silently drops any future non-outward refuse reason.
- **How you'd know** — the edited `not-l4`/closing bullets would reference `sig.outward` at the mint site instead of the non-refuse `run-start` verdict; a described refuse for a non-outward reason would still reach the mint.
- **What it means** — reject that narrowing at review; the Chosen fix gates on the full `run-start` verdict.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The main objective is above the complexity bar (it is the whole point of the fix); the trivial edits get no scenario.

```
Given a standalone self-directed ignition (FAFF_RUN_DIR unset, target resolving to faff's own repo, outward:false)
When the ignition prose is followed literally, top to bottom
Then the not-l4 classification mints nothing, the run-start assert refuses (self-directed),
     and the pass STOPs with zero tracker/structure writes and no minted run-dir
```

- The section header's guard-before-write invariant ("sequenced before any write") MUST remain literally true after the edit: the only minting write (`not-l4`) is textually below the `run-start` assert.
- The `inherited-l4` reuse path MUST self-mint nothing and record `prd_root_container` exactly as before; the `fault` refusal MUST stay checked first.
- `faff validate-adapters` MUST still pass on the edited `SKILL.md` (no new line-cap, paragraph, or stray-marker violation), and `faff lint-refs` MUST stay clean (no `FAFF-NN`/`ADR` ref introduced).

## 6. Design decision rationale

**How should the standalone mint be gated?**
- *Gate on the full `run-start` verdict* — pro: matches the header ("real run-start … predicate, sequenced before any write"), covers every refuse reason; con: none material. *Re-check only the `outward` boolean at the mint site* — pro: marginally more local; con: re-derives taxonomy `run-start` owns, misses non-outward refuse reasons.
- **Chosen:** gate the standalone mint on a non-refuse `faff run-start` verdict — the guard is the whole verdict, honouring the header and the single-source refusal ladder.

**Minimal reorder vs. hoisting `run-start` above the classify block?**
- *Defer only the `not-l4` mint* — pro: keeps `fault` "checked first", leaves `inherited-l4` untouched, smallest honest diff; con: none. *Hoist the whole assert above classify* — pro: superficially "guard first everywhere"; con: displaces `fault`, reorders the out-of-scope `inherited-l4` record, widens scope.
- **Chosen:** defer only the `not-l4` mint's timing; `fault` and `inherited-l4` ordering unchanged.

**Should the `inherited-l4` pre-run-start `prd_root_container` record also defer?**
- *Leave it unchanged* — pro: it writes onto an already-live parent-owned ledger (no orphan), a nested inherited pass over an admitted external root is not a reachable `run-start` refuse, and the ticket + the caller both scope the fix to the standalone mint; con: a purist reading of "before any write" leaves this record technically pre-assert. *Also defer it* — con: reorders an out-of-scope branch, scope creep, and changes a path the constraint requires be unaffected.
- **Chosen:** leave the `inherited-l4` record unchanged; noted in OUT OF SCOPE with its reachability rationale so a future ticket can revisit if the nested-refuse combination ever becomes reachable.

## 7. Open questions and assumptions

**Open questions.** None — the fix is fully determined by the issue and the verified file state.

**Assumptions.** None requiring external validation — the target section, the header invariant, the `run-start` signal shape (no `runDir` dependency), the branch structure, and the lint rules were all verified against the files on disk during this spec's self-review.

## 8. DONE — definition of done

### From WHY
- [ ] After the edit, the section header's "sequenced before any write" invariant is literally true: the `not-l4` mint is textually below the `run-start` assert.
- [ ] The change is prose-only — `git diff` touches exactly `plugin/skills/faff-plot/SKILL.md` and no CLI/code/test file.

### From WHAT / HOW (the reorder)
- [ ] The `not-l4` sub-bullet states the standalone self-mint is **deferred** until a non-refuse `run-start` verdict and mints nothing at classify time.
- [ ] The `run-start` bullet states the standalone-refuse zero-write guarantee holds by construction (mint not yet performed), alongside the existing nested-refuse clause.
- [ ] The closing bullet performs the deferred standalone (`not-l4`) self-mint only on a non-refuse verdict, sets `runDir` to the freshly-minted dir, and preserves the `capturing target_resolved + resolved target` and `prd_root_container` details.
- [ ] The `fault` refusal remains checked first; the `inherited-l4` branch still self-mints nothing and records `prd_root_container` unchanged.

### From HOW (guard fidelity)
- [ ] The gate is the full `run-start` verdict, not a bare `outward`-boolean re-check at the mint site.

### From lint / house standard
- [ ] `faff validate-adapters` passes on the edited file (no new line-cap, paragraph-length, or stray-marker violation).
- [ ] `faff lint-refs` stays clean — no `FAFF-NN` tag, `ADR` citation, run-id, or evidence-file path introduced into the prose.
- [ ] The reworded bullets stay skimmable bold-lead bullets, restating their subject, with no invented labelling scheme.

**Integration smoke (prose trace).**
```
Read the edited Ignition section top-to-bottom as a standalone self-directed ignition:
  1. compute OutwardSignal → outward:false
  2. classify → not-l4 → NO mint yet
  3. assert run-start → refuse (self-directed) → zero writes → STOP
  Assert: no ".faff/runs/<id>/" mint appears anywhere above the run-start STOP.
Then run: faff validate-adapters  (expect pass)  and  faff lint-refs  (expect clean).
```

confidence: high
build-tier: standard
