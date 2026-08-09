# Spec — Architecture decision records (ADRs): durable cross-slice decisions at repo altitude

> Spec: faffter-dark-nlspec · 2026-06-21 · interactive · confidence: high. Full spec on Linear FAFF-16.

Build contract for FAFF-16. A proportionate **v1**: faff *records* and *promotes* architecturally-significant decisions into the repo's existing `records/adr/` log. Excludes generation (FAFF-27) and the consuming arch lens (FAFF-9), neither built.

## 1. WHY — Problem and Principles

**Problem.** A faff spec carries `Chosen:` decisions scoped to one slice; once the ticket ships, an architecturally-significant decision in it ("events not RPC") becomes invisible to the next slice that must respect it. The repo keeps ADRs by hand (`records/adr/0001…0004`), but faff has no mechanism to *promote* a spec decision into that durable log.

**Design principles:**
- **Promotion, not duplication.** Only the architecturally-significant subset of `Chosen:` lines graduates into an ADR; v1 never copies whole specs.
- **Deterministic mechanics, human judgement.** Number/scaffold/list/validate are a CLI tool; the "is this significant? record it?" judgement stays with the human.
- **Default off / lite, never blocking.** The promotion offer is human-gated and never blocks prep.
- **Append, don't manage.** v1 appends and lets humans curate `Status`; no automated supersession.

## 2. OUT OF SCOPE

- **Generative architecture proposal** — FAFF-27 (the generative half). *Extension:* FAFF-27 emits decisions that flow into `faff adr new`.
- **Arch-lens consumer ("does this spec violate ADR-0007?")** — the consumer is the arch lens (FAFF-9), not built. *Extension:* ADRs written here are the durable context it later reads; `faff adr list --json` is built for it.
- **L4 ends-vs-means machinery** (PRD-immutable/ADR-mutable, two-tier override authority, thrash-guard supersession) — far-future L4. *Extension:* the `Status`/supersession header fields exist so L4 can later automate transitions.
- **Automated significance classification** — ADR-spam risk; no reliable heuristic without the arch lens. *Extension:* a future `methodology`/arch-lens output could pre-mark candidates.
- **Readiness gate (unmade decision → spec `open`)** — deferred to FAFF-9; needs the arch lens's significance signal.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| ADR | Architecture Decision Record — a durable cross-slice decision in `records/adr/NNNN-title.md` |
| Promotion | Recording the architecturally-significant subset of a spec's `Chosen:` decisions as an ADR |
| Significant | Constrains *future* slices, not just this one. In v1 this is a **human** call |

**ADR file shape** (matches existing `records/adr/0002…`):

```
records/adr/NNNN-kebab-title.md
  # ADR NNNN — <Title>
  - Status:    Proposed | Accepted | Superseded by ADR-MMMM   # human-curated in v1
  - Date:      YYYY-MM-DD
  - Issue:     FAFF-XX        # provenance, optional
  - Initiative: <name>        # optional
  ## Context     ## Decision     ## Consequences
```

**CLI surface** — a new `faff adr` subcommand (zero-dependency):

```
faff adr next-number              # next zero-padded NNNN (max existing + 1), deterministic
faff adr new --title T [--issue FAFF-XX] [--initiative S] [--status Proposed]
faff adr list [--json]            # enumerate (number, title, status, date) — the consumer surface
faff adr validate                 # lint: contiguous numbering, required header fields, valid Status
faff adr --selftest               # CI fixture (per validate.yml convention)
```

`next-number`/`validate` are pure/deterministic; `new` writes one file and prints its path, never edits an existing ADR.

**Config knob** (`.faffrc.yaml`, read via `faff config get`):

```
adr:
  mode: off | surface | offer    # off = none; surface = list candidates; offer = surface + y/n record
```

**Design decisions** (resolved):
- Storage → **Chosen:** repo `records/adr/` (already the convention; travels with code, PR-reviewable).
- Mechanics → **Chosen:** a `faff adr` CLI subcommand with `--selftest`.
- Significance → **Chosen:** human-judged via the offer; v1 ships no classifier (severs the FAFF-9 dependency).
- Trigger → **Chosen:** a tail offer at the end of faff-prep, gated by `adr.mode`.
- Lifecycle → **Chosen:** append + human-curate `Status`; no automated supersession in v1.
- Default `adr.mode` → **Chosen:** `offer` (surface + human-gated y/n write). A deliberate human call — more forward than off/surface, but still human-gated and non-blocking.
- Readiness gate → **Chosen:** deferred to FAFF-9; out of v1.
- Arch-lens consumer → **Assumes:** FAFF-9 is a separate future ticket.

## 4. HOW — Behavior

Two pieces: a deterministic `faff adr` CLI (mechanics) and a prose hook in faff-prep (the human-gated offer).

```
PROCEDURE next_number():
  1. Glob records/adr/[0-9][0-9][0-9][0-9]-*.md
  2. Parse leading NNNN of each; take max (0 if none)
  3. Return max + 1, zero-padded to 4 digits

PROCEDURE adr_new(title, issue?, initiative?, status=Proposed):
  1. n := next_number();  slug := kebab-case(title);  path := records/adr/<n>-<slug>.md
  2. IF path exists → error (never overwrite); exit non-zero
  3. Write the ADR template (header filled, Context/Decision/Consequences as TODO stubs)
  4. Print path to stdout

PROCEDURE offer_adr_promotion(spec, issue):   # in faff-prep, after attach, only when adr.mode != off
  1. mode := faff config get adr.mode          # default offer
  2. IF mode == off → return
  3. candidates := the spec's Chosen: decisions already flagged architecturally significant
                   (v1 does NOT classify; it surfaces what's already marked)
  4. IF none → return
  5. Surface the candidate list (always)        # mode == surface stops here
  6. IF mode == offer: FOR each, human-gated y/n:
       yes → faff adr new --title <decision> --issue <FAFF-XX>; fill Context/Decision/Consequences from rationale
       no  → skip
  7. Never block prep; tail offer only
```

**Edge cases:** empty `records/adr/` → `0001`; malformed numbering → `validate` fails loud, `next-number` still returns max+1; `adr.mode` unset → `offer` default; the offer surfaces only already-significant-flagged decisions.

**Anti-pattern:** auto-creating an ADR per `Chosen:` marker. Why: ADR-spam destroys signal.
**Anti-pattern:** programmatically superseding an existing ADR in v1. Why: append + human-curate is the chosen lifecycle.

## 5. SCENARIOS

```
Given an empty records/adr/ and a spec with a Chosen: decision flagged significant
When the user runs prep with adr.mode: offer and confirms
Then records/adr/0001-<slug>.md is created in Nygard format with Status/Date/Issue + Context/Decision/Consequences

Given records/adr/ containing 0001..0004
When `faff adr next-number` runs
Then it prints 0005

Given adr.mode: off
When a spec with significant Chosen: decisions is attached
Then no ADR is created and no prompt is shown

Given records/adr/ with a gap (0001, 0003) or a file missing Status
When `faff adr validate` runs
Then it exits non-zero naming the offending file/field
```

Non-functional: `next-number`/`validate` are deterministic and run under `faff adr --selftest` in CI, zero dependencies.

## 6. DESIGN DECISION RATIONALE

- **Where do ADRs live?** repo `records/adr/` vs `.faff/adr/` vs tracker docs → **Chosen:** repo `records/adr/NNNN-title.md`, tracker-linked from the initiative (travels with code, PR-reviewable, already exists).
- **Where do mechanics live?** prose vs CLI → **Chosen:** a `faff adr` CLI subcommand with `--selftest` (deterministic + testable).
- **Who judges significance?** classifier vs arch lens vs human → **Chosen:** the human via the offer; v1 ships no classifier (severs the FAFF-9 dependency).
- **When is promotion offered?** produce vs prep post-attach vs graft → **Chosen:** a tail offer at the end of faff-prep, gated by `adr.mode`.
- **Status lifecycle?** automate vs append+curate → **Chosen:** append + human-curate; the `Status` field exists for L4 to later automate.
- **Default `adr.mode`?** off vs surface vs offer → **Chosen:** `offer` (human decision; human-gated + non-blocking, so the off-or-lite *safety* property holds even though it is more active than the ethos baseline).
- **Unmade significant decision → spec `open`?** → **Chosen:** deferred to FAFF-9 (couples ADRs to the readiness contract; needs the lens's significance signal).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none remaining.

**Assumptions:**
- **Assumes:** the arch-lens consumer is FAFF-9, a separate future ticket. *Validation:* confirm FAFF-9 is still Backlog before building; v1 must not implement ADR reading-for-enforcement.
- **Assumes:** `records/adr/` + its Nygard header is the canonical store. *Validation:* `ls records/adr/` shows `0001…0004` in the `# ADR NNNN — Title` + Status/Date/Issue + Context/Decision/Consequences form.

## 8. DONE — Definition of Done

**From WHY**
- [ ] A significant `Chosen:` decision can be promoted into `records/adr/` without duplicating the whole spec.
- [ ] Promotion is human-gated and never blocks prep.

**From WHAT (CLI + config)**
- [ ] `faff adr next-number` returns zero-padded max+1 (0001 on empty).
- [ ] `faff adr new --title …` scaffolds `records/adr/NNNN-<slug>.md` in Nygard format, prints path, refuses overwrite.
- [ ] `faff adr list [--json]` enumerates number/title/status/date.
- [ ] `faff adr validate` fails loud on numbering gaps or missing required header fields.
- [ ] `faff adr --selftest` runs in CI (`validate.yml`) with zero dependencies.
- [ ] `adr.mode` is read via `faff config get`; default `offer`; accepts off | surface | offer.

**From HOW (behaviour)**
- [ ] With `adr.mode: offer` (the default), prep surfaces significant candidates after attach and writes an ADR only on human confirm.
- [ ] With `adr.mode: off`, no ADR is created and no prompt shows.
- [ ] v1 never edits or supersedes an existing ADR programmatically.

**From HOW (edge cases)**
- [ ] Empty `records/adr/` → first ADR is `0001`.
- [ ] Promotion surfaces only already-significant-flagged decisions.

**Integration smoke test:**
```
1. temp records/adr/0001..0004 → `faff adr next-number` → expect 0005
2. `faff adr new --title "Events not RPC" --issue FAFF-16` → expect records/adr/0005-events-not-rpc.md created
3. `faff adr validate` → expect exit 0
4. delete 0003 → `faff adr validate` → expect non-zero naming the gap
```

confidence: high
