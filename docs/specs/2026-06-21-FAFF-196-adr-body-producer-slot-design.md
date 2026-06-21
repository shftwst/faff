# Spec — ADR-body producer slot (`adr` slot + `faffter-noon-adr`)

> Spec: faffter-dark-nlspec · 2026-06-21 · interactive · confidence: high. Full spec on Linear FAFF-196.

Build contract for FAFF-196. Adds an `adr` **producer slot** so the Nygard ADR body (`Context`/`Decision`/`Consequences`) is authored by a swappable producer rather than free-handed by the graft agent — the judgement-layer follow-up to FAFF-16's deterministic ADR mechanics.

## 1. WHY — Problem and Principles

**Problem.** FAFF-16 shipped the ADR mechanics, but the ADR *body* is improvised inline by the graft agent at Step 4b — no producer, no self-review, no swap point, out of step with the `spec`/`review`/`ship` slots.

**Design principles:**
- **Symmetry with existing producer slots** — `adr` is a `user-invocable: false` producer, swappable, conformance-linted.
- **No gated contract** — the ADR body isn't gated pass/fail (graft always records an already-`Chosen` decision). The producer is **intake-shaped**: documented output, **no `faff-contract:*` block**, plus an *advisory* self-review + confidence (a quality signal, never a hard gate).
- **Authoring moves; mechanics don't** — the `faff adr new` scaffold, numbering, validate, `adr.mode`, and prep intent-recording from FAFF-16 are unchanged. Only *who writes the body* changes.

## 2. OUT OF SCOPE

- **FAFF-16 mechanics** (`faff adr` CLI, `adr.mode`, prep intent-recording) — shipped + unchanged; this only swaps Step 4b's body authorship.
- **ADR supersession / status lifecycle** — tracked as **FAFF-197**; v1 authors new ADR bodies only.
- **Arch-lens consumer (FAFF-9)** — reads ADRs to check specs; a different direction.
- **FAFF-27's generation** — FAFF-27 *proposes* decisions; it reuses this producer (see §6), it isn't built here.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| ADR body | The Nygard `## Context` / `## Decision` / `## Consequences` prose (the scaffold's TODO stubs) |
| `adr` slot | The new producer slot; default occupant `faffter-noon-adr` |
| Advisory confidence | The producer's `confidence:` self-rating — modulates human-surface vs auto-improve by appetite; **never** a hard gate |

**Producer I/O (the `adr`-slot output contract):**

```
INPUT  (graft provides):
  decision       # the Chosen: line being promoted (title + rationale from the spec)
  spec_rationale # the committed spec / tracker spec comment for the issue
  issue          # ISSUE-XX + title
  related_adrs   # `faff adr list --json` — number/title/status/date, for cross-references
OUTPUT (the producer emits):
  body           # the three Nygard sections, ready to drop into the scaffold
  self_review    # advisory findings (verified Consequences against what shipped)
  confidence: high|medium|low   # advisory only
```

**Slot wiring** (all in `plugin/skills/faff/bin/faff`):
- `DEFAULTS` → add `"slots.adr": "faffter-noon-adr"`; add to `config defaults --selftest` expected list.
- validate-adapters `REGISTRY` → `"faffter-noon-adr": { type: "producer-adr" }`.
- `SLOT_TYPES` → `adr: { type: "producer-adr" }`.
- `checksFor` → new `case "producer-adr"`: asserts the SKILL.md documents emitting a **Nygard ADR body** (Context/Decision/Consequences) + a confidence self-rating; **must not** assert a `faff-contract:` block.
- Gateway slots table (`plugin/skills/faff/SKILL.md`) → add an `adr` row.

## 4. HOW — Behavior

A new `faffter-noon-adr` producer skill (written to the `docs/skill-authoring.md` charter). Graft Step 4b resolves the `adr` slot and delegates body authoring; the `faff adr` CLI still owns scaffold + numbering + commit.

**Rewired graft Step 4b (with appetite-graded confidence handling):**

```
PROCEDURE materialise_adr(decision, issue):   # adr.mode != off and an ## ADR promotion intent exists
  1. path := `faff adr new --title "<decision>" --issue <ISSUE-XX> [--initiative …]`   # CLI scaffold (unchanged)
  2. producer := faff config get slots.adr          # default faffter-noon-adr
  3. body, confidence := invoke <producer> with { decision, spec_rationale, issue,
                                                   related_adrs := faff adr list --json }
  4. IF confidence == low:
       appetite := faff config get appetite
       IF appetite in {low, medium}:  surface body for a human glance before commit (human may edit)   # interactive
       ELSE (high/full):              re-invoke <producer> ONCE feeding its self_review back in;        # auto-escalate
                                      take the improved body; log if still low
  5. fill path's ## Context / ## Decision / ## Consequences with body   # replaces the FAFF-16 free-hand line
  6. commit (`docs(adr): record <decision> (<ISSUE-XX>)`); log the advisory confidence
```

The producer authors the three sections with a brief self-review that **checks Consequences against what actually shipped** (the build is complete at graft time — its edge over a spec-time author), and returns an advisory `confidence:`.

**Edge cases:**
- Slot unset → `faffter-noon-adr`. A configured non-default occupant is conformance-validated before first use (gateway → Slot conformance validation).
- Low-confidence body → never a hard gate: low/medium appetite surfaces it for a human glance; high/full runs one bounded refinement pass then commits regardless. The build is never blocked.
- `related_adrs` empty → the producer authors without cross-references.

**Anti-pattern:** giving the `adr` producer a `faff-contract:*` block. Why: no pass/fail consumer gate exists; a gated contract would imply graft can reject an ADR body, which it can't. Confidence is advisory.
**Anti-pattern:** moving authoring back to the spec stage. Why: FAFF-16 settled this (Consequences need the build; punts aren't decisions; decisions drift).

## 5. SCENARIOS

```
Given a promoted Chosen decision at graft Step 4b and adr.mode != off
When graft materialises the ADR
Then ## Context / ## Decision / ## Consequences are authored by the resolved `adr` slot (default faffter-noon-adr), not free-handed, and committed on the feature branch

Given the producer returns a low-confidence body at appetite: medium
When graft materialises the ADR
Then the body is surfaced for a human glance before commit (not silently committed)

Given the producer returns a low-confidence body at appetite: high
When graft materialises the ADR
Then graft runs one bounded refinement pass and commits the result regardless (no hard gate, no human block)

Given a user configures slots.adr to a non-default producer
Then it is conformance-validated (validate-adapters producer-adr checks) before first use

Given `faff config get slots.adr` unset
Then it returns faffter-noon-adr (DEFAULTS-enforced)
```

Non-functional: `validate-adapters` passes with `faffter-noon-adr` registered; `config defaults --selftest` covers `slots.adr`.

## 6. DESIGN DECISION RATIONALE

- **New slot + default producer?** inline-in-graft vs a slot → **Chosen:** an `adr` producer slot, default `faffter-noon-adr` (symmetry + swappability).
- **Gated contract or not?** → **Chosen:** intake-shaped — no gated contract, advisory self-review + confidence (no pass/fail consumer).
- **How does conformance lint it?** → **Chosen:** a new `producer-adr` type + `checksFor` case (different output shape from intake's brief).
- **Where does it run?** → **Chosen:** graft Step 4b (settled in FAFF-16).
- **Producer input?** → **Chosen:** decision (Chosen line + rationale), spec rationale, issue, `faff adr list --json`.
- **One producer shared with FAFF-27, or separate?** → **Chosen:** single shared writer — `faffter-noon-adr` is THE ADR-body writer; FAFF-27 *proposes/decides* architecture and feeds settled decisions into the same `adr` slot, carrying no ADR-writer of its own. (FAFF-27 decides, `faffter-noon-adr` records. `relatedTo` link maintained.)
- **What does the advisory confidence do?** ignore vs gate vs appetite-graded → **Chosen:** appetite-graded — low/medium appetite surfaces a low-confidence body for a human glance before commit; high/full runs one bounded refinement pass then commits regardless. Never a hard gate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none.

**Assumptions:**
- **Assumes:** the FAFF-16 `faff adr` CLI + `adr.mode` + graft Step 4b are present on `main`. *Validation:* `faff adr --selftest` exits 0 and `plugin/skills/faff-graft/SKILL.md` contains "Step 4b: Materialise ADR promotions". (Confirmed merged, PR #131.)

## 8. DONE — Definition of Done

**From WHY / WHAT (slot wiring)**
- [ ] `faffter-noon-adr` SKILL.md exists (`user-invocable: false`), documents emitting a Nygard ADR body + advisory confidence, carries **no** `faff-contract:` block, written to the `docs/skill-authoring.md` charter; documented as the single ADR-authoring producer FAFF-27 reuses.
- [ ] `faff config get slots.adr` → `faffter-noon-adr` when unset (added to `DEFAULTS` + `config defaults --selftest`).
- [ ] validate-adapters registers `faffter-noon-adr` as `producer-adr` (`REGISTRY` + `SLOT_TYPES` + `checksFor`) and passes on the shipped tree; the `producer-adr` case does **not** require a `faff-contract:` block.
- [ ] Gateway slots table has an `adr` row.
- [ ] `.faffrc.example.yaml` documents `slots.adr`.

**From HOW (behaviour)**
- [ ] graft Step 4b resolves the `adr` slot and delegates body authoring (the FAFF-16 free-hand line retired).
- [ ] The producer receives {decision, spec rationale, issue, `faff adr list --json`} and returns the three Nygard sections + advisory confidence.
- [ ] Appetite-graded low-confidence handling: surface-for-human at low/medium; one bounded refinement pass at high/full; commit regardless (no hard gate).

**From HOW (conformance)**
- [ ] `node --test` (validate-adapters + config defaults) green.

**Integration smoke test:**
```
1. `faff config get slots.adr` → faffter-noon-adr
2. `node plugin/skills/faff/bin/faff validate-adapters` → PASS (faffter-noon-adr linted as producer-adr)
3. `node plugin/skills/faff/bin/faff config defaults --selftest` → ok (covers slots.adr)
```

confidence: high
