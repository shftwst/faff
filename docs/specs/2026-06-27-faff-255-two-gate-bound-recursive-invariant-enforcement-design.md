# Spec — FAFF-255: Two-gate bound + recursive-invariant enforcement

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive (chain walk, 3 design decisions resolved with the human) · confidence: high.

The **keystone** of the PRDR layer: the two gates that keep every loop-authored PRDR inside the immutable human PRD box, plus the recursive-invariant enforcement that makes the loop moving project goalposts *safe*. Ships the **bound framework + authority**, delegating the two gate *computations* to FAFF-256 (upper/YAGNI) and FAFF-257 (lower/coverage).

## 1. WHY
The loop authors and supersedes PRDRs (delegated ends, FAFF-245). For that to be safe it must not be able to leave the human PRD box. Two gates bound every PRDR move; the **recursive invariant** — *a loop can't move its own setpoint, only its encloser can* — is what lets the machine re-derive project goalposts without escaping the human's outermost ends.

**Principles:**
- **Authority lives in the gate, the record CLI stays mechanical** (FAFF-245 P1 resolution): `faff prdr supersede` is a pure linker; 255 is the admission gate that wraps it.
- **Provenance burden machine-side; human surface zero-CLI native-tracker** — ratification is a tracker gesture, never a CLI ceremony.
- **Contract-vs-producer:** 255 defines the two-gate interfaces; 256/257 are the pluggable judgments that fill them.

## 2. OUT OF SCOPE
- The **upper-gate "serves the PRD / no gold-plating" judgment** → **FAFF-256** (YAGNI arbitration via the methodology slot). 255 defines the interface + a fail-safe default.
- The **lower-gate "every PRD goal covered" computation** → **FAFF-257** (DoD roll-up). 255 defines the interface + a conservative default.
- The PRDR record + mechanical supersede/validate → FAFF-245 (shipped). Machine-authoring PRDR content → FAFF-251.

## 3. WHAT — types, gate contract, CLI

**Vocabulary:** two-gate bound · upper/YAGNI gate · lower/coverage gate · provenance (`human`|`loop`) · ratification (a human tracker move accepting a `Proposed` PRDR) · recursive invariant · per-increment immutability · thrash-ratchet · increment · encloser.

```
ENUM AdmissionDisposition: admit | propose-only | reject
RECORD PrdrAdmissionVerdict:
  disposition: AdmissionDisposition
  upper:    { admit: bool, reason }      # INPUT from FAFF-256; absent ⇒ fail-safe default (below)
  lower:    { covered: bool, uncovered_goals: [String] }  # INPUT from FAFF-257; absent ⇒ conservative default
  authority:{ actor: loop|human, supersedes_provenance: human|loop|none, by_level: ok|violation }
  ratchet:  { lineage_supersessions: Int, breached: bool }
  reasons:  [String]
  CONSTRAINT disposition==admit  IFF  upper.admit AND authority.by_level==ok
                                       AND authority NOT (loop supersedes human)   # else propose-only
                                       AND NOT ratchet.breached
                                       AND lower not newly-violated by the resulting live set
```

**CLI:** `faff contract prdr-admission` (deterministic shape validator over the verdict, mirroring `prd-readiness`) + `faff prdr admit <prdr> [--upper <256-verdict>] [--lower <257-verdict>]` — the deterministic gate that computes the **authority + by-level + ratchet** parts itself and folds in the 256/257 verdicts (or their fail-safe defaults when absent). New `prdr.thrash_window` / `prdr.thrash_max` config keys.

**Chosen — decomposition:** 255 = the two-gate **framework** (contract + the deterministic authority/invariant/ratchet) + delegation; the **computations** are FAFF-256 (upper) / FAFF-257 (lower). 255 is buildable now without them (defaults below). *(Decision 1, human, 2026-06-27.)*

## 4. HOW — the three deterministic enforcements (255's own core)

**(A) Authority — provenance-checked supersede + tracker-gesture ratification** *(Chosen, Decision 2):*
```
PROCEDURE admit_supersede(actor, old_prdr, new_prdr):
  IF old_prdr.provenance == "loop":   proceed (subject to gates + ratchet)   # loop may move its own
  IF old_prdr.provenance == "human":
     IF actor == "loop":  disposition := propose-only
        → new_prdr is written Status: Proposed; takes effect ONLY when a human
          flips it Status: Accepted on the tracker (zero-CLI ratification).
     IF actor == "human": proceed.
```
The loop **never** self-ratifies; the gate refuses to treat a loop-written `Accepted` as valid.

**(B) Recursive invariant — authority-by-level + per-increment immutability** *(Chosen, Decision 3):*
- A PRDR is **immutable to the work it governs** — the inner loop running *under* a PRDR cannot supersede that PRDR (its own setpoint). Only the **enclosing** authority re-derives it, and only **between increments**. `by_level` is the deterministic check: the actor's level must be strictly enclosing the PRDR's governed scope.

**(C) Thrash-ratchet — per-supersession review + count escalation** *(Chosen, Decision 3):*
- **Every** loop-supersession is recorded and **adversarially reviewed** (the `review` slot) for *direction of drift*. Independently, a **count ratchet**: when a single PRDR lineage accrues ≥ `prdr.thrash_max` supersessions within `prdr.thrash_window`, `ratchet.breached` → escalate to human.

**Fail-safe defaults (until 256/257 land):** absent upper-gate verdict → treat as **not admitted** for a *new capability* PRDR (conservative), admit a like-for-like supersession; absent lower-gate verdict → a supersession that *drops* a goal's last live PRDR → escalate (never silently abandon).

**Anti-patterns:** putting the YAGNI/coverage *judgment* in 255 (that's 256/257); a CLI ratification ceremony; letting the inner loop supersede its own governing PRDR.

## 5. Scenarios
- loop supersedes a `loop` PRDR, upper=admit, by-level ok, ratchet ok → **admit**.
- loop supersedes a `human` PRDR → **propose-only**: new PRDR `Proposed`; effective only after a human sets `Accepted`.
- inner loop tries to supersede the PRDR governing its own increment → **reject** (by-level violation).
- a lineage hits `thrash_max` supersessions in `thrash_window` → **escalate** (reject + ratchet-breached reason), even if each move individually passed.
- supersession would drop the last live PRDR covering a PRD goal, lower-gate absent → **escalate** (reject + coverage reason; no silent abandonment).
- Assertion: `faff prdr admit` makes no tracker/network call (pure, parity with `faff next`); the gate computes authority/by-level/ratchet deterministically and only *consumes* the 256/257 verdicts.

## 7. Open Questions / Assumptions
- **Open Questions: none** — the three load-bearing decisions resolved. `thrash_max`/`thrash_window` ship with conservative defaults, configurable.
- **Assumes:** FAFF-245's `Provenance: human|loop` field + mechanical `prdr supersede` are present (✓ shipped). The `Proposed`/`Accepted` status transitions exist on the PRDR record. The `review` slot is invocable for the per-supersession drift review (✓).

## 8. DONE
- [ ] `faff contract prdr-admission` deterministic validator + schema + `--selftest`.
- [ ] `faff prdr admit` computes authority (provenance), by-level, and ratchet deterministically; folds in 256/257 verdicts or their fail-safe defaults; emits `PrdrAdmissionVerdict`.
- [ ] loop→loop supersede admits; loop→human supersede is `propose-only` and effective only on a human tracker `Accepted`; the loop cannot self-ratify.
- [ ] inner-loop supersede of its own governing PRDR → by-level violation (rejected); per-increment immutability holds.
- [ ] every loop-supersession is review-slot reviewed; a lineage over `thrash_max`/`thrash_window` escalates needs-human.
- [ ] fail-safe defaults when 256/257 absent (no gold-plating new capability; no silent goal abandonment).
- [ ] additive — a repo with no PRDRs is unchanged; pure CLI, no tracker/network call.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"} ] }
```

---
*Interactive chain-walk spec (the three design decisions resolved with the human, 2026-06-27). Verdict: **fire-and-forget**. ADR-promotion intent: the recursive-invariant authority model (loop-propose/human-ratify by tracker gesture; authority-by-level; per-increment immutability) is architecturally significant — materialise on build.*
