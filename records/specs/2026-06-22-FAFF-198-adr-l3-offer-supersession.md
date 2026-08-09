# Spec — ADR L3: offer supersession when a new ADR contradicts a live one

> Spec: faffter-dark-nlspec · 2026-06-22 · interactive · confidence: high. Full spec on Linear FAFF-198.

This is a buildable spec for **FAFF-198**, addressed to the build agent and human reviewers. It adds the **L3** layer atop the supersession triad: when a newly-recorded ADR's Decision *contradicts* a live (non-superseded) ADR, faff *detects* it, *offers* to supersede the old one, and *writes* the supersession on human confirm — instead of waiting for a human to spot the conflict and run `faff adr supersede` by hand.

## 1. WHY — Problem and Principles

**The load-bearing model.** Contradiction is *semantic, not lexical* — two ADRs conflict when their Decisions can't both hold, regardless of shared words. So detection turns on **one narrow LLM-judgement step**, built as a swappable seam: feed it the new ADR's `## Decision` plus every live ADR's `## Decision`, and it returns which (if any) the new one contradicts, and why. Everything else in this spec — where it hooks, the offer UX, the write — is deterministic plumbing wrapped around that single judgement call.

**Problem.** FAFF-197 shipped the L1–L2 mechanics (`faff adr supersede` + back-reference validation) but a superseding *link* still only forms when a human notices a new ADR overrides an old one and runs the command by hand; nothing surfaces the conflict at record time. L3 closes that gap: detect the contradiction the moment an ADR is materialised, surface it, and offer the already-shipped `supersede` write.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Detection is one narrow, bounded, swappable seam.** A single function `detect_contradictions(new_decision, live_adr_decisions) -> [{adr, contradicts, why}]`. It is the *only* LLM-judgement step; it does not also offer, write, or read the filesystem. It is architected so FAFF-9's future architecture lens can call the same seam or replace its occupant — this is the contract the hand-off depends on (gateway → *Deterministic tools over prose*: the judgement is isolated, the mechanics around it stay deterministic).
- **Never auto-supersede — the write is always human-confirmed.** The supersede write is a side-effect that re-points an existing record; it only ever happens on an explicit human confirm. Surfacing is appetite-graded; the *write* is not. In autonomous mode with no human, the candidate conflict is recorded for `/faff-wtf` and the build proceeds — it never writes supersession unattended (gateway → *Appetite for destruction* hard floor: appetite widens surfacing, never the write).
- **Reuse the shipped primitive verbatim.** On confirm, call the existing `faff adr supersede <old> --by <new>` (FAFF-197) — do not reimplement the edit. The resulting ADRs must pass `faff adr validate` (symmetric back-refs) by construction, because that command is the only writer.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` Step 4b | skill prose | The single hook site — ADRs are materialised here; detection inserts mid-Step-4b |
| `plugin/skills/faff/bin/faff` `cmdAdr` (~L2288) | Node | `faff adr list --json`, `faff adr supersede`, `faff adr validate` — the deterministic mechanics this layer drives |
| `plugin/skills/faffter-noon-adr/SKILL.md` | skill prose | The `adr` producer that authors the `## Decision` the seam reads |
| `plugin/skills/faff/SKILL.md` *Appetite for destruction* | skill prose | The appetite dial that grades surfacing |

**Scope statement.** This sits inside faff-graft Step 4b's ADR-materialisation sub-flow, between body-authored and commit — the only place in v1 where ADRs land on a branch.

## 2. OUT OF SCOPE

- **`faff adr new` direct-CLI hook** — what's excluded: contradiction detection when an ADR is created straight through the CLI (outside graft Step 4b). Why excluded: graft Step 4b is the single place ADRs are *materialised on a branch in the PR flow*; a direct-CLI invocation has no orchestrating skill to run the offer UX. Extension point: a `--detect-contradictions` path in `cmdAdr`'s `new` action (`plugin/skills/faff/bin/faff`) calling the same seam — explicit fast-follow.
- **L4 — loop-authored supersession (FAFF-199)** — what's excluded: autonomous mode *authoring and writing* a superseding ADR without a human. Why excluded: lights-out-era; needs two-tier authority + thrash-guard. Extension point: FAFF-199; tracked in `design/adrs.md`.
- **The FAFF-9 architecture lens itself** — what's excluded: any generative architecture analysis beyond the one contradiction-detection call. Why excluded: FAFF-9 is an unscoped Backlog epic; blocking on it would strand L3 indefinitely. Extension point: FAFF-9 calls or replaces the `detect_contradictions` seam occupant (this spec is `relatedTo FAFF-9`).
- **Detection against Proposed-but-not-Accepted ADRs** — what's excluded (v1): comparing the new Decision against ADRs whose Status is `Proposed`. Why excluded: open question — see *Open Questions* (`**Punt:**`). Extension point: the `live_adr_decisions` filter in the seam-input assembly step.
- **Multi-ADR / chained supersession in one pass** — what's excluded: offering to supersede more than the conflicting set the seam returns, or transitively re-pointing. Why excluded: out of v1 appetite; each returned contradiction is offered independently. Extension point: the offer loop over the seam's result array.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Live ADR | An ADR whose `Status` is **not** `Superseded by ADR-NNNN` (i.e. not already superseded). The candidate set the new ADR is checked against. |
| Contradiction | A *semantic* conflict: the new ADR's Decision and a live ADR's Decision cannot both hold. Not lexical overlap. |
| The seam | The single LLM-judgement step `detect_contradictions`; the only non-deterministic part of this feature. |
| Candidate conflict | A seam result with `contradicts: true` — surfaced (interactive) or recorded for `/faff-wtf` (autonomous). |

**The seam interface (the FAFF-9 hand-off contract):**

```
SEAM detect_contradictions(new_decision, live_adr_decisions) -> [Result]

  new_decision: Text                 # the new ADR's `## Decision` section body (just-authored, pre-commit)
  live_adr_decisions: List<{         # one per live (non-superseded) ADR
    adr: AdrId,                      # e.g. "0002" — the id from `faff adr list --json`
    title: Text,
    decision: Text                   # that ADR's `## Decision` section body
  }>

RECORD Result:
  adr: AdrId                         # which live ADR was assessed
  contradicts: Boolean               # true ⇒ semantic conflict with new_decision
  why: Text                          # one-sentence reason (shown in the offer / recorded for wtf)

  CONSTRAINT one Result per input live ADR (the seam assesses each; absent ⇒ treated as contradicts:false)
  CONSTRAINT the seam performs NO filesystem write, NO supersede call, NO tracker write — pure judgement
```

- **Swappability.** The seam is a single named step with this exact signature. FAFF-9's lens later either *calls* `detect_contradictions` for its contradiction sub-question, or *replaces* the occupant with a richer analyzer that honours the same signature. Nothing downstream of the seam knows which occupant ran — it consumes only `[Result]`.
- **`**Assumes:** the FAFF-196 `adr` producer emits a parseable `## Decision`** — the seam reads the `## Decision` heading's body from the just-authored ADR text. Validated at build: confirm `faffter-noon-adr`'s output (and the `faff adr new` scaffold) contains a `## Decision` section before wiring the read.
- **`**Assumes:** the FAFF-197 supersede primitive exists** — `faff adr supersede <old> --by <new>` is shipped and is the sole supersession writer. Validated at build: `faff adr supersede --help`/selftest, and `grep` for the `supersede` action in `cmdAdr`.

**Input assembly (deterministic, around the seam):**

- `live_adr_decisions` is built from `faff adr list --json` (fields `id`, `title`, `status`, `file`), keeping entries whose `status` does **not** match `Superseded by ADR-…` (the same `adrSupersededBy` predicate the CLI uses), then reading each `file`'s `## Decision` body. The just-created new ADR is excluded from its own candidate set (match on its `id`/`file`).
- `new_decision` is the `## Decision` body the `adr` producer just authored in Step-4b sub-step 2 (already in hand — no re-read needed if held in context; else read the scaffold file).

**Design decision — where detection runs.** Considered: faff-prep (rejected — prep has no ADR numbers yet and writes nothing under `records/adr`); `faff adr new` CLI (deferred — see Out of Scope); graft Step 4b mid-flow (chosen). **Chosen:** graft Step 4b, after the body is authored and the number is known, before the commit — see HOW.

## 4. HOW — Behavior

**Architecture and approach.** L3 inserts **one new sub-step (3b)** into faff-graft Step 4b's existing per-decision loop. Today that loop is: (1) scaffold `faff adr new`, (2) author body via `adr` slot, (3) confidence handling, (4) fill + commit. Detection composes *after the body exists and the number is known* (so both the new `## Decision` and the new ADR's id are available) and *before the commit* (so a confirmed supersede is recorded as part of the same materialisation):

```
PROCEDURE materialise_adr_with_L3(decision, issue):           # per listed decision, inside Step 4b
  1. scaffold = faff adr new --title <decision> --issue <issue>     # existing sub-step 1; new ADR id known here
  2. body = adr_slot.author(...)                                    # existing sub-step 2; new `## Decision` in hand
  3. confidence_handling(body)                                      # existing sub-step 3 (advisory, appetite-graded)
  3b. detect_and_offer(new_decision = body.decision,                # NEW — only when adr.mode != off
                       new_adr_id = scaffold.id, issue)
  4. fill_and_commit(scaffold, body)                                # existing sub-step 4 — commit includes any supersede edit
```

**Behaviour summary of 3b.** Assemble the live ADRs' Decisions, run the one seam call, and for each returned contradiction either offer the supersede (interactive) or record it for `/faff-wtf` (autonomous) — never writing supersession without a human.

```
PROCEDURE detect_and_offer(new_decision, new_adr_id, issue):
  1. mode = faff config get adr.mode
     IF mode == "off": RETURN            # no detection at all (see adr.mode interaction)
  2. live = [ {adr: a.id, title: a.title, decision: read_decision(a.file)}
              for a in (faff adr list --json)
              if NOT superseded(a.status) and a.id != new_adr_id ]
     IF live is empty: RETURN            # nothing to contradict — silent proceed
  3. results = detect_contradictions(new_decision, live)            # THE SEAM (the only LLM step)
  4. conflicts = [ r for r in results if r.contradicts ]
     IF conflicts is empty: RETURN       # no contradiction — silent proceed (sub-step 4 commits as normal)
  5. FOR each c in conflicts:
       offer_or_record(c, new_adr_id, mode)
```

```
PROCEDURE offer_or_record(c, new_adr_id, mode):
  IF interactive:
     surface ADR-<c.adr> ("<title>") + c.why, then prompt 3-way:
       a. supersede   -> run: faff adr supersede <c.adr> --by <new_adr_id>
       b. record-anyway (keep both live; no supersede) -> proceed, no write
       c. skip        -> proceed, no write
     # adr.mode "surface" => surface c only, no supersede prompt (see below)
  ELSE (autonomous):
     # NEVER auto-supersede at any appetite (hard floor).
     appetite = faff config get appetite
     surface_proactively = appetite in {high, full}     # appetite grades how loudly, not whether-to-write
     record candidate conflict {new_adr_id, c.adr, c.why} for /faff-wtf
       (write to .faff/ per gateway record-and-file; surface in the run digest)
     proceed                                            # build is never blocked
```

**`adr.mode` interaction** (read via `faff config get adr.mode`; default `offer`; values `off | surface | offer`):

- **`off`** → no detection runs at all (sub-step 3b returns immediately). Consistent with Step 4b already skipping materialisation when `adr.mode: off`.
- **`surface`** → detection runs; a contradiction is *surfaced* (interactive: shown with `c.why`, no supersede prompt — informational; autonomous: recorded for `/faff-wtf`), but the supersede write is never offered. The human runs `faff adr supersede` by hand if they want it.
- **`offer`** (default) → detection runs; interactive gets the full 3-way offer (supersede / record-anyway / skip); autonomous records for `/faff-wtf`.

**Appetite interaction** (orthogonal to `adr.mode`; gateway → *Appetite for destruction*):

- Appetite grades **how proactively a candidate conflict is surfaced in autonomous mode** (`low`/`medium`: record + quiet entry in the run digest; `high`/`full`: surface more prominently for `/faff-wtf`).
- Appetite **never** widens to an autonomous supersede write — re-pointing an existing record is a write-side-effect; the hard floor keeps it human-confirmed at every level including `full`.
- Interactive offer is unchanged by appetite — the human is present and confirms directly.

**Edge cases and error handling:**

- **No live ADRs / only the new one** → seam not called; silent proceed.
- **Seam returns empty or all `contradicts:false`** → silent proceed; sub-step 4 commits the new ADR normally.
- **`faff adr list --json` fails / unreadable `records/adr`** → log, skip 3b, continue the build (detection is additive, never build-blocking) — terminal, not retryable for this pass.
- **Old ADR already superseded between list and confirm** → `faff adr supersede` already errors loudly (`already superseded by ADR-NNNN`, exit 1); surface that to the human (interactive) / log it (autonomous), do not crash.
- **Seam errors / times out** → fail safe: log "contradiction detection unavailable", skip the offer, continue the build. A missing judgement never blocks materialisation.

**Failure modes — how the approach falls over, and how you'd notice:**

- **The failure: false positives** — the seam flags a contradiction that isn't one, nagging the human on every unrelated ADR. **How you'd know:** interactive users routinely pick `record-anyway`/`skip`; the `.faff/` calibration/log shows offered-but-declined dominating. **What it means:** narrow the seam prompt (tighten the "cannot both hold" bar) — *do not* loosen to auto-supersede. False-positive *tolerance* is a `**Punt:**` (see Open Questions).
- **The failure: false negatives** — a real contradiction goes undetected, two live ADRs silently coexist. **How you'd know:** `faff adr validate` still passes (it checks back-ref symmetry, not contradiction), so the signal is a human later finding the conflict by hand — exactly today's status quo. **What it means:** acceptable v1 floor — L3 is strictly additive over L1–L2; a miss degrades to the pre-L3 manual path, never to a worse state.
- **The failure: `## Decision` not parseable** — the producer's output lacks a clean `## Decision`, so the seam gets empty/garbled input. **How you'd know:** seam input is empty on a non-trivial ADR; the Assumes-validation step catches it before wiring. **What it means:** narrow — fix the read or the producer contract before relying on detection.

**Anti-pattern:** auto-running `faff adr supersede` in autonomous mode at high/full appetite. Why: re-pointing an existing record is a write side-effect; the appetite hard floor and Locked Decision 3 forbid it — autonomous records for `/faff-wtf` and proceeds.

**Anti-pattern:** putting detection in faff-prep. Why: prep has no ADR numbers and writes nothing under `records/adr`; the new `## Decision` doesn't exist until graft Step 4b authors it.

**Anti-pattern:** the seam reading the filesystem, calling `supersede`, or writing the tracker. Why: it must stay a pure judgement step so FAFF-9 can swap its occupant without inheriting side-effects.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a just-authored ADR whose Decision contradicts one live (non-superseded) ADR, in interactive mode with adr.mode=offer
When Step 4b sub-step 3b runs the contradiction seam and the human confirms "supersede"
Then `faff adr supersede <old> --by <new>` is run, and `faff adr validate` passes (symmetric back-refs: old → "Superseded by ADR-new", new → "Supersedes: ADR-old")
```

```
Given a just-authored ADR that contradicts no live ADR
When sub-step 3b runs the seam and every Result is contradicts:false
Then no offer/surface appears and the build proceeds (sub-step 4 commits the new ADR unchanged)
```

```
Given a contradiction detected in autonomous mode at any appetite (including full)
When sub-step 3b processes the conflict
Then no `faff adr supersede` is run, the candidate conflict is recorded for /faff-wtf, and the build proceeds
```

```
Given adr.mode=off
When Step 4b would run sub-step 3b
Then no contradiction detection runs at all
```

```
Given adr.mode=surface and a detected contradiction (interactive)
When sub-step 3b surfaces it
Then the conflict + reason is shown but no supersede prompt is offered, and no write occurs
```

Non-functional assertion: **the seam performs no filesystem write, no `supersede` call, and no tracker write** — it returns `[Result]` only (verified by the seam's isolation test / `--selftest` stub).

Non-functional assertion: **`detect_contradictions` honours its exact signature** so a FAFF-9 occupant is drop-in swappable.

## 6. DESIGN DECISION RATIONALE

**How is contradiction detected?**
Options: (a) lexical/rules heuristic — cheap, but contradiction is semantic, so it both misses and false-fires; (b) defer to FAFF-9's lens — but FAFF-9 is an unscoped epic, deferring strands L3; (c) a standalone LLM-judgement seam now, signed so FAFF-9 can later call/replace it.
**Chosen:** (c) a standalone, bounded LLM-judgement seam `detect_contradictions(new_decision, live_adr_decisions) -> [{adr, contradicts, why}]` — rationale: it ships L3 immediately without blocking on FAFF-9, isolates the only non-deterministic step, and the fixed signature is the FAFF-9 hand-off contract. (a) and (b) rejected per the reasons above (the human settled this).

**Where does detection hook for v1?**
Options: faff-prep (no ADR numbers, no `records/adr` writes); `faff adr new` CLI (no orchestrator for the offer UX); graft Step 4b mid-loop.
**Chosen:** graft Step 4b, inserted as sub-step 3b (after body authored + number known, before commit) — the single place ADRs are materialised on a branch in the PR flow. Direct-CLI coverage is an explicit fast-follow (Out of Scope).

**Is the offer ever auto-confirmed?**
Options: auto-supersede at high/full appetite (faster); always human-confirmed.
**Chosen:** always human-confirmed; autonomous records for `/faff-wtf` and proceeds. Rationale: re-pointing an existing record is a write side-effect under the appetite hard floor; Locked Decision 3. Appetite grades only how loudly the candidate is surfaced.

**Which ADRs are candidates?**
**Chosen:** live (non-superseded) ADRs only — an already-superseded ADR is dead, re-contradicting it is noise. (Whether *Proposed* ADRs are also candidates is a `**Punt:**`.)

At the time of writing, `faff adr validate` checks back-reference symmetry and numbering, **not** contradiction — so L3's value rests entirely on the seam; this decision can be revisited if validate ever gains semantic checks.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:**

- **`**Punt:**` Exact false-positive tolerance — needs human.** How aggressive should the seam be? A tight "cannot both hold" bar minimises nagging but risks misses; a loose bar catches more but nags. v1 ships the tight bar; the calibration signal (offered-but-declined rate in `.faff/`) informs tuning. Non-blocking: v1 is buildable at the tight bar.
- **`**Punt:**` Compare against Proposed-but-not-Accepted ADRs too, or live-Accepted only — needs human.** v1 candidate set is "not superseded" (which includes `Proposed`). Whether to *exclude* `Proposed` (a not-yet-committed decision can't really be "contradicted") is open. Non-blocking: the filter is a one-line change in input assembly; v1 defaults to "all non-superseded".

**Assumptions:**

- **`**Assumes:**` FAFF-197's `faff adr supersede <old> --by <new>` exists and is the sole supersession writer.** Validate: `grep` the `supersede` action in `cmdAdr` / run `faff adr --selftest` before wiring the confirm path.
- **`**Assumes:**` The FAFF-196 `adr` producer (`faffter-noon-adr`) emits a parseable `## Decision` section.** Validate: inspect a produced ADR / the `faff adr new` scaffold for a `## Decision` heading before wiring the seam's `new_decision` read.
- **`**Assumes:**` `faff adr list --json` exposes `id`, `title`, `status`, `file` per ADR and the `adrSupersededBy` predicate identifies superseded ones.** Validate: run `faff adr list --json` and confirm the fields (grounded: it does — `cmdAdr` list action).

## 8. DONE — Definition of Done

### From WHY
- [ ] At ADR materialisation, a new ADR contradicting a live ADR is detected and surfaced (no longer requires a human to spot it).
- [ ] The supersede write is never performed without human confirmation (interactive) — autonomous never auto-supersedes at any appetite.

### From WHAT (seam interface)
- [ ] A single seam `detect_contradictions(new_decision, live_adr_decisions) -> [{adr, contradicts, why}]` exists with that exact signature.
- [ ] The seam performs no filesystem write, no `supersede` call, no tracker write (isolation verified).
- [ ] The seam is swappable: a replacement occupant honouring the signature is drop-in (documented as the FAFF-9 hand-off; spec is `relatedTo FAFF-9`).
- [ ] `live_adr_decisions` is built from `faff adr list --json`, filtered to non-superseded, excluding the new ADR, with each `## Decision` body read.

### From HOW (behaviour)
- [ ] Detection runs as Step 4b sub-step 3b: after body authored + number known, before commit.
- [ ] Contradiction detected → interactive offers 3-way (supersede / record-anyway / skip); on "supersede" runs `faff adr supersede <old> --by <new>`.
- [ ] After a confirmed supersede, `faff adr validate` passes (symmetric back-refs).
- [ ] No contradiction → silent proceed, new ADR committed unchanged.
- [ ] Autonomous mode records the candidate conflict for `/faff-wtf` and proceeds; never auto-supersedes.

### From HOW (adr.mode + appetite)
- [ ] `adr.mode: off` → no detection runs.
- [ ] `adr.mode: surface` → contradiction surfaced, no supersede prompt/write.
- [ ] `adr.mode: offer` → full offer (interactive) / record (autonomous).
- [ ] Appetite grades only autonomous surfacing prominence, never the write (no auto-supersede even at `full`).

### From HOW (edge cases)
- [ ] No live ADRs / all `contradicts:false` → silent proceed.
- [ ] `faff adr list` / seam failure → logged, build continues unblocked.
- [ ] Already-superseded-old at confirm → `faff adr supersede` error surfaced/logged, no crash.

### From test coverage
- [ ] `--selftest` / test coverage for: input-assembly filter (non-superseded, exclude-new), the offer-routing decision table (interactive vs autonomous × adr.mode × contradicts), and seam isolation (no side-effects). Seam *judgement* itself is stubbed in tests (it's the swappable LLM occupant). Sits alongside `test/adr.test.mjs`, `test/adr-slot.test.mjs`.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. records/adr has live ADR-0001 (Decision: "use X")
  2. graft Step 4b authors new ADR-0005 (Decision: "use Y, not X")
  3. sub-step 3b: assemble live={0001}, seam returns [{adr:0001, contradicts:true, why:"X vs Y"}]
  4. interactive confirm "supersede" -> faff adr supersede 0001 --by 0005
  5. ASSERT faff adr validate passes (0001 "Superseded by ADR-0005"; 0005 "Supersedes: ADR-0001")
```

confidence: high
