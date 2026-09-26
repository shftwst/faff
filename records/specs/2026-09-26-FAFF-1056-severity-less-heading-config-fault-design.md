# Spec — FAFF-1056: A severity-less `###` heading must not fault the whole lens to config-fault

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1056.

> Revised 2026-09-20 (spec-review rounds 1–2, reject-approach → in-place fixes). Round 1: resolved the `objections:[]` clean-fast-path contradiction (fast-path re-keyed off recognised sections); reworded the grammar principle to its precise one-directional property and enumerated the fixture body set; added an additive `kind` provenance field to the spec-review hold store; clarified two-phase evidence preservation; reframed the transcript non-clobber DONE item as an occupant-prose check. Round 2: made the evidence-capture write atomic (`wx` exclusive-create, closing the TOCTOU race); clarified that direction-4 evidence preservation covers the *residual* faults surviving direction 1, not the now-tolerated leaked-reasoning case; reframed the hold-store `kind` DONE item honestly as prose-verified (the born-verifiable seam is the parser stdout `kind` + raw round record); scoped the future retry-ceiling divergence gate explicitly out; added a `headerModel`-past-preamble fixture item. Round 3 returned a plateaued reject-approach (see the park comment below); prep parked for human adjudication.

This spec is for the build agent and human reviewers. It addresses FAFF-1056: a refuter response that prefixes its real findings with an off-grammar `###` reasoning heading currently faults the entire lens, discards that lens's genuine objections, and — because the fault is misclassified `config-fault` — floors the whole four-lens spec-review round to `needs-human`, a park no retry loop can ride out. This is the direct successor to FAFF-990, which fixed the adjacent truncation half of the same seam.

## 1. WHY — Problem and principles

**The load-bearing model.** The spec-review gate runs each lens's refuter and passes its response through *two* grammars in sequence: the transport's exit-0 shape-gate (`validateFindingsShape` in `review-call.mjs`), then the downstream consumer (`parseRefutation` in `parse-refutation.mjs`). The two grammars disagree on one rule: the shape-gate admits any body carrying **at least one** severity-bearing `### <severity>: …` section; the parser then demands **every** `###` section carry a severity and faults on the first that does not. A reasoning model that writes headed deliberation (`### Analysis`, `### My reasoning`) ahead of a well-formed finding produces a body that *passes* the gate but *faults* the parser — and the parser's fault is misfiled as `config-fault`, the one classification routed away from every recovery path. Fixing this means (a) closing the grammar gap so the parser tolerates non-finding prose exactly as it already tolerates a narrative lead-in inside a section, and (b) correcting the classification so a served-but-off-grammar response is treated as the model-quality transient it is, not a human config bug.

**Problem statement.** Today, one lens's off-grammar `###` preamble makes `parseRefutation` exit 1 with `kind:"config-fault"`, discarding that lens's real objections and, via the aggregate transport floor, overriding three healthy lenses to roll the whole round to `needs-human` (a park). Nothing about the spec, config, or backend was wrong — a plain re-run of the same lens against the same backend parsed clean. This change makes the parser skip severity-less sections as prose (preserving every real objection) and reclassifies the residual, non-truncated parse fault away from `config-fault` so it retries-and-holds instead of parking.

**Design principles.**

- **The parser must never fault on a body the shape-gate admits, for the reason it faults today.** The parser's fail-loud arms were written as assertions about an invariant the shape-gate was *believed* to establish (`>=1` implies `all`). It does not — `>=1` is exactly `>=1`. This principle is deliberately **one-directional and precise**, not the stronger "the two grammars agree on which bodies are findings-shaped": the fix makes `parseRefutation` *strictly more permissive* than `validateFindingsShape` (it skips every severity-less section; the gate only requires one severity-bearing section to exist), and that asymmetry is intended. The fixture pins exactly that one-directional property — *for every body the gate admits, the parser either parses (`ok:true`) or faults for a reason **other than** "a section names no known severity"* — over an **enumerated** body set (Definition of Done), so the FAFF-1056 incident class cannot silently reopen. It does **not** claim two-way agreement, and it does **not** close the residual mis-headed-gating-section risk (a severity-*worded* but off-grammar heading like `### Critical Issue Found` that fails `SEVERITY_HEADING_RE` and is skipped as prose) — that residual is named in Failure Modes and Out of Scope, not pinned by this fixture.
- **A served, shape-valid, off-grammar body is never a config fault.** By construction, `parseRefutation` only ever sees content the transport already served and the shape-gate already passed — the config demonstrably worked. FAFF-990 established this for a *truncated* body ("a model clipped a field"); the same sentence holds for "a model prefixed a heading." A parser-stage residual fault is a model-quality transient, and a re-run is the recovery path.
- **Tolerance must not silently swallow a real finding as prose.** Skipping a severity-less section is safe only because the shape-gate still guarantees at least one well-formed severity section survives; a body of *only* off-grammar sections must still fault (it has no findings). Preserve that floor.
- **Reuse FAFF-990's discipline verbatim.** The parser NAMES the `kind` on stdout; the occupant records it verbatim with no exit-to-kind judgement of its own; `aggregate.mjs` and faff-prep are left unchanged wherever the routing already falls out correctly.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` | Node ESM | The downstream consumer. Owns `parseRefutation`, `splitSections`, and the CLI `kind` decision. Primary change site. |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node ESM | The transport. Owns `validateFindingsShape` (the `.some()` shape-gate) and `captureRawResponseBody` (raw-body capture, round-keyed). Evidence-capture change site; shape-gate is the fixture's other half. |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` | Node ESM | The majority/severity roll-up + transport floor. `config-fault` short-circuits to `needs-human`; a non-`config-fault` `unavailable` lens routes to the swing `unavailable` verdict. No functional change; tests + comment only. |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Prose (occupant) | Per-lens outcome table + transport-floor prose. Documents exit→kind; must learn `model-transient`. |
| `plugin/skills/faff-prep/SKILL.md` | Prose (orchestrator) | `disposition_unavailable` — the in-turn retry / resumable hold that the `unavailable` verdict feeds. Prose currently pins `config-fault` as unretriable; must acknowledge `model-transient` routes here. |
| `records/specs/2026-09-05-FAFF-990-truncated-refuter-objection-holds-not-parks-design.md` | Design doc | The pattern this ticket extends: parser-names-kind, additive field, aggregate/faff-prep untouched where possible. |

**Scope statement.** This change sits entirely inside the L4 adversarial spec-review gate's parse-and-classify seam (`parse-refutation.mjs` and its two consuming grammars); it does not touch the refuter prompts, the verdict contract, or the majority/severity math.

## 2. OUT OF SCOPE

- **Narrowing the transport floor's blast radius (direction 3).** Whether a *single* faulting lens should be able to override three healthy lenses' verdicts at all is a larger design question about the `config-fault` → `needs-human` short-circuit in `aggregate.mjs:89`. Excluded because it is a distinct concern that outlives this incident (this ticket's fix already stops *this* class from reaching that floor), and the ticket itself flags it as possibly its own ticket. **Extension point:** the transport-floor block in `aggregate.mjs` `aggregate()` (:82-101). Tracked as a `**Punt:**` in Open Questions.
- **FAFF-1053 (normaliseCleanRefutation preamble discard).** A different module (`review-call.mjs`), trigger (a *clean* refutation whose preamble defeats the line-count arms), and consequence (discarded on position, chain advances to fallback). Shared root theme — a reasoning model writing deliberation into the content channel — but a separate fix. Excluded as a distinct ticket already in Backlog. **Extension point:** `normaliseCleanRefutation` in `review-call.mjs`. A fix there should be aware of this one and vice versa.
- **Refuter prompt changes to suppress leaked reasoning.** Teaching the refuter prompts to emit reasoning outside the content channel would reduce the trigger frequency but is a prompt-engineering effort against non-deterministic model behaviour, not a grammar fix. Excluded; the parser must be robust regardless. **Extension point:** `refute-<lens>.md` prompt files.
- **Changing the refuter severity vocabulary or the verdict contract.** `SEVERITY_HEADING_RE`, `GATING_SEVERITIES`, and `SEVERITY_MAP` stay exactly as they are. Excluded — this is a tolerance-and-classification change, not a grammar-vocabulary change.

## 3. WHAT — Vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Shape-gate | `validateFindingsShape` in `review-call.mjs` — the transport's exit-0 admission test. Passes a body iff at least one `###` section carries a recognised severity. |
| Parser | `parseRefutation` in `parse-refutation.mjs` — the downstream consumer that converts the exit-0 wire body into the `objections[]` JSON `aggregate.mjs` rolls up. |
| Severity-less section | A `### …` heading line that does not match `SEVERITY_HEADING_RE` (no recognised `critical\|major\|minor\|observation` word in the heading). Leaked reasoning headings are of this shape. |
| Residual parse fault | A `parseRefutation` fault that survives after tolerance is applied: a gating section with no usable `claim` (FAFF-990's residual), or a body with zero recognised-severity sections. |
| Gating section | A section whose severity is in `GATING_SEVERITIES = {critical, major, minor}`. `observation` is non-gating. |
| `config-fault` | Kind for a genuine, human-fixable config problem (auth failed, host down, unconfigured chain, parser usage error). Aggregate floors it to `needs-human` (park). |
| `infra-configured` | FAFF-900/990 kind for a swing-capable transient (host unreachable, 429 chain, or a *truncated* residual parse fault). Aggregate routes it to the `unavailable` verdict (retry/hold). |
| `model-transient` | **New.** Kind for a *non-truncated* residual parse fault — served, backend healthy, content off-grammar in a way a re-run is likely to clear. Routes identically to `infra-configured`. |

**Type shapes (all existing; the one additive change is the `kind` enum).**

```
ENUM UnavailableKind:
  "config-fault"      # genuine human-fixable config problem — floored to needs-human
  "infra-configured"  # swing-capable transient (network / truncated residual parse fault)
  "model-transient"   # NEW: swing-capable non-truncated residual parse fault (off-grammar served body)

RECORD RefutationEntry:            # parseRefutation ok:true output, unchanged
  lens: string
  outcome: "refuted" | "clear"
  objections: List<Objection>
  model?: string

RECORD ParseFault:                 # parseRefutation ok:false output, unchanged shape
  lens: string
  severity: string                 # "unknown" for a no-findings fault
  title: string
  missing_field: "claim" | null
  reason?: string

RECORD UnavailableRecord:          # what the CLI emits on stdout for a residual fault
  lens: string
  outcome: "unavailable"
  kind: UnavailableKind            # truncated → "infra-configured"; else → "model-transient" (was "config-fault")
  objections: []
```

**CLI exit-code contract (`parse-refutation.mjs`).** Exit codes are unchanged; only the `kind` string on the non-truncated residual-fault path changes.

| Exit | Meaning | stdout `kind` | Aggregate routing |
|---|---|---|---|
| `0` | parsed (objections may be claim-only) | — (`RefutationEntry`) | normal |
| `1` | residual parse fault, no `--truncated` | `model-transient` (**was** `config-fault`) | swing → `unavailable` verdict (retry/hold) |
| `3` | residual parse fault, `--truncated` | `infra-configured` (unchanged) | swing → `unavailable` verdict (retry/hold) |
| `2` | usage (missing `--lens`, unreadable stdin) | occupant records `config-fault` | floor → `needs-human` (a real plumbing fault) |

**Design decision — parser tolerance of severity-less sections.** `parseRefutation` skips a severity-less `###` section as non-finding prose instead of faulting on it, mirroring `parseBullets`' existing discard of a narrative lead-in before the first bullet — but continues to fault when *no* recognised-severity section survives (a genuinely findings-less body). **Chosen:** skip severity-less sections as prose; fault only on a residual (no findings, or a gating section missing `claim`). Rationale and rejected alternatives in Design Decision Rationale below.

**Design decision — classification of the non-truncated residual fault.** The non-truncated residual parse fault is reclassified from `config-fault` to a new `model-transient` kind that routes exactly like `infra-configured`. **Chosen:** add `model-transient`; emit it for the exit-1 residual fault; leave genuine transport/config faults on `config-fault`. Rationale below.

**Design decision — new kind vs reusing `infra-configured`.** **Chosen:** a distinct `model-transient` kind rather than overloading `infra-configured`. Rationale below.

**Design decision — evidence-preservation mechanism.** **Chosen:** refuse-to-overwrite a retained fault body (atomic `wx` exclusive-create, append a `.retry-<k>` suffix on collision) in `captureRawResponseBody`, and give the per-lens transcript the same non-clobbering treatment. Rationale below.

## 4. HOW — Behaviour

### Parser tolerance (`parseRefutation` in `parse-refutation.mjs`)

**Summary.** Walk the sections; skip any that name no known severity; keep the rest exactly as today; fault only if nothing findings-shaped survives.

```
PROCEDURE parseRefutation(content, lens):
  sections := splitSections(content)          # unchanged: any `^### (?!#)` line is a boundary
  model    := headerModel(content)            # unchanged

  # Drop severity-less sections FIRST, then decide clean-vs-refuted on what's recognised.
  # This is the single behavioural change; the clean fast-path below is re-keyed off it.
  recognisedSections := [ s for s in sections if s.severity != null ]   # CHANGED: skip severity-less prose

  IF recognisedSections is empty:
     RETURN fault { lens, severity: "unknown", title: "(none)", missing_field: null,
                    reason: "no recognised finding section (### <severity>: ...)" }   # subsumes the old sections.length===0 arm

  # Clean fast-path — CHANGED: re-keyed off recognisedSections, not sections.length, so a leaked
  # severity-less preamble no longer defeats it. The `### observation: no findings` sentinel is
  # the clean marker and is NEVER pushed as an objection (that is what makes objections == []).
  IF recognisedSections == [ one `### observation: no findings` section ] AND no gating section:
     RETURN ok { lens, outcome: "clear", objections: [], model? }

  objections := []
  FOR each section s in recognisedSections:
     IF s is the `### observation: no findings` sentinel:
        CONTINUE                               # clean sentinel is never an objection
     IF s.severity is gating AND s has no non-empty `claim`:
        RETURN fault { lens, severity: s.severity, title: s.title, missing_field: "claim" }   # FAFF-990, unchanged
     objections.push(objection built from s's triple/anchor bullets)   # unchanged for real findings

  outcome := any gating objection ? "refuted" : "clear"
  RETURN ok { lens, outcome, objections, model? }
```

- The old `sections.length === 0` arm and the old `s.severity == null` arm both had the false "should be unreachable" comment. They collapse into a single **truthful** guard: *fault iff `recognisedSections` is empty.* Remove both "unreachable" comments; the replacement guard is reachable by construction and correctly so.
- **Anti-pattern:** deleting the fail-loud path entirely and letting an all-prose body parse to `outcome:"clear"`. Why: a findings-less body is a genuine fault (no objections to grade), not a clean pass — that would reintroduce the silent-drop this module was built to remove. The `recognisedSections`-empty fault is mandatory.
- **Anti-pattern:** having the parser strip or "repair" leaked-reasoning headings. Why: the parser reads bytes, it does not rewrite them; skipping-on-read keeps it a pure classifier and keeps the raw body intact for the evidence trail.

### Classification of the residual fault (`main()` in `parse-refutation.mjs`)

**Summary.** A parser-stage residual fault is never a config fault; only its truncation flag decides which swing kind it carries.

```
# CLI main(), the residual-fault branch (result.ok == false):
kind := truncated ? "infra-configured" : "model-transient"    # CHANGED: was "config-fault"
emit stdout { lens, outcome: "unavailable", kind, objections: [] }
emit stderr faultMessage(...)                                   # unchanged human diagnostic
return truncated ? 3 : 1                                        # exit codes UNCHANGED
```

- `config-fault` as a kind is **retained** for its genuine sources — `review-call.mjs` exit 6/2/4/7 (default-host down / unsupported provider / model-not-served / auth failed), an unconfigured or malformed chain, a `fan-out.mjs` fault, and parser usage exit 2. The aggregate `config-fault` floor stays live for exactly these. This change removes only the *parser residual fault* from that bucket.
- **The occupant does no exit-to-kind judgement** — it records the parser's stdout verbatim, exactly as FAFF-990 established. The only occupant change is prose (SKILL.md): the exit-1 row and the transport-floor paragraph must state that a non-truncated residual fault now carries `model-transient` and routes to the `unavailable` verdict, not `needs-human`.

### Aggregate routing (`aggregate.mjs`) — no functional change

`aggregate()` filters `configFault = unavailable.filter(r => r.kind === "config-fault")`. A `model-transient` lens has `outcome:"unavailable"` and `kind !== "config-fault"`, so it is **not** in `configFault`; it falls through the floor to the existing FAFF-900 branch `if (unavailable.length > 0 && !forcedReject) → verdict "unavailable"`, named as a `major` objection — identical to `infra-configured`. The only edits here are a comment noting the third kind and new selftest/table-test cases. **Anti-pattern:** adding a `model-transient` branch to the floor. Why: the existing fall-through already produces the correct swing routing; a new branch would be dead-equivalent code.

### faff-prep disposition — routing unchanged, one additive hold-store field

The `unavailable` verdict already drives `disposition_unavailable` (faff-prep/SKILL.md:229): an in-turn retry loop bounded by `prep.spec_review_outage_retry_limit` (default 2), then a resumable `spec-review-hold.json` + `faff-awaiting-spec-review` hold, then escalation to `needs-human` at `prep.spec_review_outage_hold_limit` (default 3). A `model-transient` lens surfaces as `unavailable` and rides this **retry/hold routing** unchanged. Two edits:

1. **Prose.** The paragraph that pins `config-fault` as "a human config fix the retry loop can't ride out" must clarify that a *parser* residual fault is now `model-transient`/`unavailable`, not `config-fault`.
2. **One additive field on the hold store — the provenance seam (`kind`).** **Chosen:** `disposition_unavailable` writes the swing-kind that triggered the hold onto `.faff/resume/<issue>/spec-review-hold.json` as an additive `kind` field (`"model-transient"` | `"infra-configured"`), alongside the existing `outage_holds` counter. This is the structural separation the two swing families need: today they route identically (correct — both are "the system will likely recover on its own"), but the field (a) lets an operator triaging a held issue tell a network blip from a systematically off-grammar backend, and (b) is the seam a future divergence (e.g. a shorter retry ceiling for `model-transient`) keys off **without** re-plumbing the store. The field is **read by no gate today** — it is provenance only — so it changes no routing; it is additive on a schema-less JSON store, so a legacy hold without it reads as `infra-configured` (back-compatible). The single `outage_holds` counter stays shared (a held-drain is a held-drain regardless of kind); only the `kind` provenance is added. **The future divergence itself — a gate that reads `kind` and applies a different retry ceiling — is explicitly out of scope for this ticket** (this change only lays the provenance seam; designing the divergent gate, its ceiling value, and its interaction with `prep.spec_review_outage_retry_limit` is a separate ticket, filed when a divergence is actually wanted).

- **Bounded-retry guarantee (addresses direction 2's caveat + the infosec fail-open-delay objection).** A genuinely structureless response that never parses does not retry forever: the in-turn ceiling (default 2) bounds the turn, then a hold is written, and the hold-limit (default 3) escalates to `needs-human` — the same terminal state the old `config-fault` reached, reached deterministically. A *systematically* off-grammar backend/model pair therefore parks after 3 held drains rather than immediately; this is an accepted, bounded delay (the terminal state is identical, never `approve`), and the new `kind` field is exactly what lets the operator see, from the hold file, that a persistent off-grammar backend — not a network blip — is the cause. The existing ceiling is the bound the ticket asks for; no new limit is introduced.

### Evidence non-clobber (`captureRawResponseBody` in `review-call.mjs`, + the per-lens transcript)

**Summary.** The re-run that diagnoses a fault must not overwrite the body that caused it.

**Which faults this preserves evidence for (interaction with the parser tolerance).** Direction 1 (parser tolerance) removes the *leaked-reasoning* fault entirely — a mixed body now parses `ok`, so there is no fault body to preserve for that class, which is the fix working. Direction 4's evidence preservation therefore matters for the **residual** faults that *survive* direction 1 and route to `model-transient`/retry: a gating section missing its `claim`, and an all-severity-less body (no recognised finding). For those, a clean re-run genuinely reformats a body that first faulted, and the first (fault) body is the diagnostic artifact — so preserving it is load-bearing precisely where a fault still occurs, not for the case direction 1 already tolerates.

**Why the clobber happens (confirmed against source).** The parse fault is *downstream* of `review-call.mjs`; from the transport's view both the leaked-reasoning attempt and the clean re-run are the same exit-0 success, so `captureRawResponseBody` computes the same `round`/`lens`/`chainIndex`/`provider`/`model`/`token` and therefore the same filename `round-<n>.<lens>.<chainIndex>-<provider>-<model>.<token>.txt` (:1771). The in-turn retry re-runs with the same `round`, so attempt 2 overwrites attempt 1's file. The `$pin_dir/round-<n>-<lens>.md` transcript is keyed the same way and clobbers identically.

```
PROCEDURE captureRawResponseBody(shared, { chainIndex, backend, result, token, exit }):
  ...compute base fname as today...
  # Atomic exclusive-create — NOT a check-then-write (no TOCTOU). Each attempt to write claims its
  # filename with the `wx` flag; an EEXIST means someone already holds that name, so bump the suffix
  # and retry. The OS create is the race-arbiter, so two concurrent same-round re-dispatches each land
  # on a distinct file and neither overwrites the other's body.
  target := base + ".txt"
  k := 0
  LOOP:
     TRY writeFn(join(shared.rawDir, target), preamble + body, { flag: "wx" })   # exclusive create
         BREAK                                                                    # claimed it
     CATCH EEXIST:
         k := k + 1
         target := base + ".retry-" + k + ".txt"
         CONTINUE
```

- **Chosen mechanism: refuse-to-overwrite via atomic exclusive-create** (`wx` flag, bump `.retry-<k>` on `EEXIST`) rather than a check-then-write `existsSync` (which has a TOCTOU window a concurrent same-round re-dispatch can race) and rather than threading an attempt counter down from faff-prep. It is fully local to `captureRawResponseBody`, needs zero cross-layer plumbing through `build-lens-requests.mjs`/`fan-out.mjs`/`review-call.mjs`, and preserves *every* body — the OS `wx` create is the atomic race-arbiter, so even two concurrent writers each claim a distinct file. The *first* body — the one that caused the fault — is never lost.
- The per-lens transcript (`$pin_dir/round-<n>-<lens>.md`, written by the occupant per SKILL.md) gets the same non-clobbering rule stated in the occupant prose: on a re-dispatch, do not overwrite an existing round-lens transcript — write the new attempt to a `.retry-<k>` sibling.
- **Anti-pattern:** keying the file by wall-clock timestamp. Why: it defeats deterministic fixture tests and makes the artifact set non-reproducible; a monotonic `.retry-<k>` suffix is deterministic and self-describing.
- **Two recovery phases, both covered — by two different mechanisms.** The `.retry-<k>` suffix fires only within **phase 1**, the in-turn retry (`disposition_unavailable` re-dispatches inside the *same* round/turn, so the filename collides and the suffix preserves the first body). **Phase 2**, the hold-resume, re-enters on a *later* drain via `faff next --awaiting-spec-review` with an *advanced* round number, so its `captureRawResponseBody` writes to `round-<n+1>.…` — a **different** filename that never collides with the fault body in `round-<n>.…`. So the fault body is preserved across *both* phases: by the retry-suffix within a round, and trivially by the distinct round file across a drain. The DONE criterion for `.retry-<k>` is a **phase-1** assertion (same round, in-turn), stated as such; cross-drain preservation is the round-file naming that already holds, not a second `.retry-<k>` guarantee. An operator correlating a cross-drain recovery reads two round files by lens+backend — the round-keyed layout that already exists, unchanged.

### Failure modes

- **The failure:** parser tolerance silently swallows a *mis-headed but intended-gating* section (e.g. `### Critical Issue Found`, which does not match `SEVERITY_HEADING_RE` and so is skipped as prose). A real objection is downgraded to prose rather than gated. **How you'd know:** a lens returns `clear`/fewer objections than the raw body visibly contains; the retained raw body (now preserved by the evidence change) shows a severity-worded-but-off-grammar heading that produced no objection. **What it means:** proceed — this is strictly better than the status quo (which discarded *all* findings including well-formed ones and floored three other lenses), the shape-gate still guarantees at least one well-formed severity section survives or the whole body is rejected `garbled` at the transport, and a re-run typically reformats. Narrow only if telemetry shows mis-headed gating findings are common, in which case a fuzzy-severity-match is a follow-up.
- **The failure:** the self-referential exposure — *this very spec* is reviewed by the spec-review gate running the **pre-fix** code, so a reviewing model that leaks a `###` reasoning heading could fault this spec's own review to `config-fault` → `needs-human`, parking this ticket's prep. (This is exactly what happened: the round-3 review plateaued and prep parked.) **What it means:** proceed and accept — the fix cannot apply to its own pre-merge review, the failure is transient (a re-run clears it, per the ticket's own evidence), and the evidence-preservation half of this very change makes the incident self-diagnosing if it recurs. Documented as a Chosen risk acceptance below.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refuter exit-0 body with a leading `### Analysis` severity-less heading followed by a well-formed `### minor: …` section carrying a claim
When parseRefutation runs on it
Then it returns ok, outcome "refuted"/"clear" per the minor's gating, objections carries the minor objection, and no fault is raised
```

```
Given a refuter body whose only `###` sections are severity-less (all off-grammar, no recognised severity word)
When parseRefutation runs on it
Then it returns a fault (no recognised finding section) — it does NOT parse to a clean pass
```

```
Given any refuter body B drawn from the enumerated DONE fixture table such that validateFindingsShape(B) returns ok
When parseRefutation(B) runs
Then it either parses (ok:true) or faults for a reason other than "a section names no known severity" — the one-directional property (parser never faults on a gate-admitted body for the severity-less-heading reason), not two-way grammar agreement
```

- Assertion: A retained fault raw body MUST NOT be overwritten by a subsequent in-round re-run — the first attempt's `round-<n>.<lens>.<chainIndex>-<provider>-<model>.<token>.txt` survives, the re-run writes a `.retry-1` sibling.
- Assertion: `aggregate()`'s verdict for a set containing a `model-transient` unavailable lens plus otherwise-clear lenses is `unavailable` (swing), never `needs-human` — and is `reject-approach` when the available lenses already force-reject (the missing lens cannot swing).

## 6. Design decision rationale

**Should the parser tolerate a severity-less section, or fault on it?**
- *Fault (status quo).* Fails loud on any off-grammar section. Con: discards the lens's real, well-formed findings and — via `config-fault` — floors three healthy lenses. The fault arm was a defensive assertion about an invariant (`>=1` implies `all`) the shape-gate never established.
- *Tolerate (skip as prose).* Preserves every real objection; mirrors `parseBullets`' existing narrative-lead-in discard, so it is a local precedent, not a new pattern. Con: a mis-headed intended-gating section is silently downgraded (see Failure Modes) — mitigated by the shape-gate floor and evidence preservation.
- **Chosen:** tolerate — skip severity-less sections as non-finding prose, fault only when no recognised-severity section survives. Smallest change that satisfies acceptance criteria 1-3, and strictly better than the status quo on the swallow risk.

**Is a parser-stage residual fault a config fault or a transient?**
- *config-fault (status quo).* Routes to `needs-human` park. Wrong: the parser only ever sees a body the transport served and the shape-gate passed, so the config demonstrably worked. FAFF-990 already established this reasoning for the truncated case.
- *A transient.* A re-run is the recovery path (empirically confirmed in the incident). Routes to retry/hold via the `unavailable` verdict.
- **Chosen:** a transient — the non-truncated residual fault carries `model-transient`, routing like `infra-configured`. This removes the *class* (RCA fault 2), not just this instance. *Rejected alternative — ship directions 1+4 only, leaving classification as `config-fault`:* the ticket names direction 2 "the real fix" and acceptance criterion 4 asks for the durable property that a re-runnable transient never parks; direction 1 alone still leaves the FAFF-990 missing-claim residual parking on `config-fault`. Including direction 2 is a deliberate scope call with genuine latitude — surfaced for human confirmation via the `medium` rating.

**A new `model-transient` kind, or reuse `infra-configured`?**
- *Reuse `infra-configured`.* Zero new routing anywhere. Con: conflates "backend clipped a field / network transient" with "model served off-grammar content" — inaccurate provenance in the audit trail, and it overloads a kind whose name means "infra/config-adjacent."
- *New `model-transient` kind.* Accurate provenance; `aggregate.mjs` needs no functional change (falls through to the swing branch); consumers that must learn it are few (aggregate comment/tests, occupant prose, faff-prep prose). Con: one more enum value.
- **Chosen:** a new `model-transient` kind, **plus** the additive `kind` field on the hold store (§4 faff-prep disposition) as the structural seam. The two families route identically *today* (both "the system will likely recover") but are now distinguishable in provenance — the parser's distinct stdout `kind`, the raw round record, and the hold-store `kind` field — so a future divergence (a shorter retry ceiling for `model-transient`, a distinct hold cause) keys off an existing field rather than forcing a re-plumb of `disposition_unavailable`. This directly answers the architectural objection that a distinct enum with identical routing and no recorded provenance would force a rewrite at first divergence: the provenance is now recorded at every layer the evidence touches.

**Evidence non-clobber: refuse-to-overwrite, or thread an attempt counter?**
- *Attempt counter (`round-<n>.attempt-<k>…`).* Explicit provenance. Con: requires plumbing an attempt number from faff-prep's `disposition_unavailable` down through `build-lens-requests.mjs` → `fan-out.mjs` → `review-call.mjs` `shared` — multi-layer, cross-skill.
- *Refuse-to-overwrite (`.retry-<k>` on collision).* Fully local to `captureRawResponseBody`; preserves the first (fault) body. Con: the suffix reflects collision order, not the orchestrator's attempt index.
- **Chosen:** refuse-to-overwrite via atomic `wx` exclusive-create. Keeps direction 4 contained and independently shippable exactly as the ticket predicts, with no cross-layer plumbing, and closes the check-then-write race.

**How to handle the self-referential review exposure?**
- **Chosen:** accept and proceed. The fix cannot apply to its own pre-merge review; the exposure is transient (a plain re-run clears it); and this ticket's own evidence-preservation change makes a recurrence self-diagnosing. No spec change can close a pre-merge exposure of the gate that reviews it.

## 7. Open questions and assumptions

**Open questions.**

- **Punt: Narrowing the transport floor's blast radius — a separate ticket, or fold in here? — needs human (decides: architecture).** After this fix, the parser class no longer reaches the `config-fault` floor, so the "one faulting lens overrides three healthy lenses" problem is mooted *for this class* but remains for genuine config faults. Whether a single `config-fault` lens *should* floor the whole round is a larger design question (`aggregate.mjs:89`). Recommended as its own ticket; captured here so it is not lost.

**Assumptions.** None external — every routing target (`disposition_unavailable`, the `unavailable`-verdict swing branch, `prep.spec_review_outage_retry_limit`/`_hold_limit` defaults, `captureRawResponseBody`'s round-keyed filename) was verified present in the live source during self-review.

## Already shipped against this surface

Related Done work on the same `parse-refutation.mjs` / `review-call.mjs` seam — checked for premise-supersession, none delivers this fix (premise holds):

- **FAFF-990 (Done 2026-09-05, PR #868)** — the truncation half of this exact fault. Routed a residual parse fault *carrying a truncation signal* to `infra-configured`; `kind` is keyed on `--truncated` alone, so the non-truncated leaked-reasoning body deliberately falls to `config-fault`. This ticket is its direct successor, not a duplicate.
- **FAFF-938 (Done 2026-09-02)** — built the deterministic refuter-triple parser (`parseRefutation`) this defect lives in.
- **FAFF-806 (Done 2026-08-16)** — fixed `validateFindingsShape`'s `kind` discriminator to run on raw backend bytes (a different axis; does not touch the `some`-vs-`all` grammar mismatch).
- **FAFF-1051 (Done 2026-09-19)** — spec-review repo-context trim; adjacent gate, unrelated code path.

None of these ship the `parseRefutation` severity-less-section tolerance or the `model-transient` reclassification this ticket introduces.

## 8. DONE — Definition of Done

### From WHY (one-directional grammar property)
- [ ] A fixture cross-imports both `validateFindingsShape` and `parseRefutation` and, over the **enumerated** body table below, asserts the one-directional property: *for every body where `validateFindingsShape` returns ok, `parseRefutation` either parses (`ok:true`) or faults for a reason other than "a section names no known severity".* The table **must** include, at minimum: (a) the FAFF-1056 trigger — one severity-less `### Analysis` heading + one well-formed `### major:` gating section; (b) a clean `### observation: no findings` preceded by a severity-less preamble; (c) N (≥2) severity-less headings + one gating section; (d) a body whose only recognised section is a well-formed `### minor:`. A fixture that omits body (a) does not satisfy this item.
- [ ] The fixture also documents (not asserts) the known residual it does **not** pin: a severity-*worded* but off-grammar heading (e.g. `### Critical Issue Found`) is skipped as prose — an out-of-scope follow-up, named so a later reader does not misread the green test as closing it.

### From WHAT (parser tolerance)
- [ ] A body with a leading severity-less `### …` heading plus a well-formed `### minor:`/`### major:` gating section parses `ok:true` and `objections` carries the gating objection; no fault is raised.
- [ ] A clean-refutation body (`### observation: no findings`) preceded by a severity-less reasoning heading parses to `outcome:"clear"` with `objections: []` — the clean fast-path is re-keyed off the recognised-severity sections (post-skip), not `sections.length`, and the `### observation: no findings` sentinel is never pushed as an objection.
- [ ] A body whose `###` sections are all severity-less faults with `missing_field:null` and a "no recognised finding section" reason.
- [ ] The two "should be unreachable" comments (old `sections.length===0` and `s.severity==null` arms) are removed; the replacement guard faults iff no recognised-severity section survives.
- [ ] FAFF-990 behaviour preserved: a gating section with no usable `claim` still faults `missing_field:"claim"`.
- [ ] `headerModel` is unchanged and still extracts `model` from the transport-prepended `## Adversarial findings — <provider>/<model>` header line even when a severity-less `###` preamble follows it — pinned by a fixture body that carries both the header line and a leaked `### Analysis` preamble ahead of a well-formed finding (the parser-tolerance re-key touches only section classification, never the header scan).

### From WHAT/HOW (classification)
- [ ] `UnavailableKind` includes `model-transient`.
- [ ] `parse-refutation.mjs` `main()` emits `kind:"model-transient"` (not `config-fault`) on a non-truncated residual fault; exit code stays 1; `--truncated` still yields `infra-configured` at exit 3.
- [ ] Genuine config faults (review-call exit 6/2/4/7, unconfigured/malformed chain, fan-out fault, parser usage exit 2) still carry `config-fault`.

### From HOW (aggregate routing)
- [ ] `aggregate()` routes a `model-transient` unavailable lens (others clear) to verdict `unavailable`, named as a `major` objection — not `needs-human`.
- [ ] A `model-transient` unavailable lens that cannot swing (available lenses already force-reject) yields `reject-approach`.
- [ ] No functional change to the `config-fault` floor: a `config-fault` unavailable lens still yields `needs-human`.

### From HOW (occupant + faff-prep prose + hold-store field)
- [ ] `faffter-dark-spec-review/SKILL.md` exit-1 row and transport-floor paragraph state `model-transient` routes to `unavailable` (retry/hold), not `needs-human`.
- [ ] `faff-prep/SKILL.md` disposition prose no longer implies a parser residual fault is an unretriable `config-fault`.
- [ ] The **born-verifiable** provenance separation between `model-transient` and `infra-configured` is the parser's stdout `kind` (unit-tested — see the "From WHAT/HOW (classification)" items) and the raw round record that carries it; these are the checkable seam.
- [ ] The additive `kind` field on `.faff/resume/<issue>/spec-review-hold.json` is a **faff-prep-prose** annotation (the hold store is written by the orchestrator following `faff-prep/SKILL.md`, not a deterministic module), so this item is a **prose-review** check that the SKILL.md `disposition_unavailable` prose specifies writing `kind`, with a legacy store lacking it reading as `infra-configured` — recorded explicitly as prose-verified, not a unit test, so it is not mistaken for a born-verifiable line.

### From HOW (evidence non-clobber)
- [ ] `captureRawResponseBody` does not overwrite an existing raw body **within a round**: on filename collision it writes a `.retry-<k>` sibling (atomic `wx` exclusive-create), preserving the first (fault) body. (Testable: two calls with identical round/lens/backend/token → two files, `…​.txt` + `…​.retry-1.txt`.)
- [ ] Cross-drain (phase-2) preservation is the existing round-keyed naming (`round-<n>.…` vs `round-<n+1>.…`), not a `.retry-<k>` guarantee — no new mechanism, asserted by the round-file layout that already holds.
- [ ] The per-lens transcript (`$pin_dir/round-<n>-<lens>.md`) non-clobber is an **occupant-prose** rule (the transcript is written by the SKILL.md occupant, not by `captureRawResponseBody`), so this item is a prose-review check on `faffter-dark-spec-review/SKILL.md`, not an automated test — recorded here explicitly so it is not mistaken for a testable line.

### Integration smoke test
```
1. Build the mixed body: HEADER + "### Analysis\n(reasoning prose)" + majorSection().
2. Assert validateFindingsShape(body).ok === true.
3. Run parse-refutation.mjs --lens architectural on it → exit 0, RefutationEntry with the major objection.
4. Build a no-claim gating body (non-truncated) → exit 1, stdout kind "model-transient".
5. Feed [that unavailable/model-transient entry + 3 clear lenses] to aggregate() → verdict "unavailable".
6. Call captureRawResponseBody twice with identical round/lens/backend/token → two files exist (…​.txt and …​.retry-1.txt).
```

confidence: medium
build-tier: complex