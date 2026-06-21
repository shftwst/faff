# Spec — ADR status lifecycle + supersession (v1: the L1–L2 lite slice)

> Spec: faffter-dark-nlspec · 2026-06-21 · interactive · confidence: high. Full spec on Linear FAFF-197.

Adds the supersession mechanics — a `faff adr supersede` command + back-reference validation — completing the record · author · **supersede** triad atop FAFF-16's `faff adr` CLI. The lite (L1–L2) slice; L3/L4 are out of scope.

## 1. WHY — Problem and Principles

**Problem.** FAFF-16's `faff adr` appends ADRs with a hand-curated `Status` and never manages transitions; a superseding link is recorded only as freeform prose, none machine-checkable — so a "superseded" ADR can dangle (pointing at nothing, or pointed-to by nothing).

**Design principles:**
- **Deterministic mechanics** — supersession linking + validation are a CLI command, not prose.
- **Bounded edit, never a rewrite** — the *only* place the CLI edits an existing ADR, and it edits **only the `Status` line + adds one `Supersedes:` line**, never the body.
- **Lenient validation** — the back-reference check fires only when the canonical form is present, so the 4 existing freeform ADRs keep validating.

## 2. OUT OF SCOPE
- **L3 — offer-on-contradiction** — needs contradiction detection (FAFF-9 territory). Future ticket layers detection atop this command.
- **L4 — loop-authored guardrails** (two-tier authority + thrash-guard) — lights-out-era; its own ticket (`design/adrs.md`).
- **ADR body authoring** (incl. the superseding body) — that's the FAFF-196 `adr` producer.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Canonical supersession form | OLD carries `Status: Superseded by ADR-NNNN`; NEW carries `Supersedes: ADR-MMMM` |
| Dangling / asymmetric ref | A canonical ref pointing at a missing ADR, or one direction without its mirror |

**Canonical form** (zero-padded 4-digit; both ADRs already exist):
```
# OLD docs/adr/MMMM-*.md:  - **Status:** Superseded by ADR-NNNN
# NEW docs/adr/NNNN-*.md:  - **Supersedes:** ADR-MMMM
```

**CLI** — extend `faff adr`:
```
faff adr supersede <old> --by <new>   # NNNN or NNNN-slug; stamp OLD Status, add Supersedes to NEW
faff adr validate                      # EXTENDED: canonical refs must resolve both directions
faff adr --selftest                    # EXTENDED: supersede + back-reference cases
```

## 4. HOW — Behavior

```
PROCEDURE adr_supersede(old, new, dir):
  1. Resolve old, new to ADR files (NNNN or NNNN-slug). Either missing → error, non-zero.
  2. old == new → error ("cannot supersede itself").
  3. old's Status starts "Superseded" → error ("already superseded"); non-zero.
  4. Edit OLD's **Status:** VALUE → "Superseded by ADR-<new>" (body untouched).
  5. Add/ensure NEW carries "- **Supersedes:** ADR-<old>" (idempotent).
  6. Print the two changed paths.

PROCEDURE validate_supersession(adrs):   # added to adrValidate; canonical-form lines only
  FOR adr Status starting "Superseded by ADR-X":
    - X resolves                          else "superseded by missing ADR-X"
    - ADR-X carries "Supersedes: ADR-<n>" else "asymmetric: ADR-X doesn't record ADR-<n>"
  FOR adr carrying "Supersedes: ADR-Y":
    - Y resolves                          else "supersedes missing ADR-Y"
    - ADR-Y Status starts "Superseded by ADR-<n>" else "asymmetric: ADR-Y not marked superseded"
```

**Edge cases:** ADR with no refs → unaffected (existing 4 pass); freeform legacy refs (`Supersedes / unblocks: FAFF-77`, `Feeds:`) → not canonical → not validated; already-superseded old → refused.

**Anti-pattern:** rewriting an ADR's body during supersede. Why: append-only integrity — only the `Status` value + one `Supersedes:` line change.
**Anti-pattern:** forcing every ADR to carry the canonical form. Why: breaks legacy ADRs; check only where present.

## 5. SCENARIOS
```
Given 0002 and 0005 exist, 0002 not yet superseded
When  faff adr supersede 0002 --by 0005
Then  0002 Status == "Superseded by ADR-0005" and 0005 gains "- **Supersedes:** ADR-0002" (bodies unchanged)

Given 0002 "Superseded by ADR-0005" but 0005 lacks "Supersedes: ADR-0002"  →  validate fails (asymmetric)
Given 0002 "Superseded by ADR-0099" (no such ADR)                          →  validate fails (dangling)
Given the 4 existing freeform ADRs                                          →  validate still passes
Given 0002 already superseded; faff adr supersede 0002 --by 0006            →  errors, non-zero, no files changed
```

## 6. DESIGN DECISION RATIONALE
- **v1 scope?** → **Chosen:** L1–L2 only. L3/L4 separately scoped (§2).
- **Canonical format?** → **Chosen:** OLD `Status: Superseded by ADR-NNNN` + NEW `**Supersedes:** ADR-MMMM`, zero-padded.
- **How `supersede` writes?** → **Chosen:** edit OLD Status value + add one Supersedes line to NEW; never the body. The one bounded exception to append-only.
- **Validate strictness?** → **Chosen:** canonical refs resolve + symmetric → hard FAIL on dangling/asymmetric; lenient where the form is absent.
- **Preconditions?** → **Chosen:** both exist; `old != new`; `old` not already superseded.
- **L3/L4 now?** → **Chosen:** deferred (§2).

## 7. OPEN QUESTIONS AND ASSUMPTIONS
**Open Questions:** none.
**Assumptions:** **Assumes:** FAFF-16's `faff adr` CLI (`ADR_STATUSES`/`adrValidate`/`listAdrs`/`adrField`) on `main`. *Validation:* `faff adr --selftest` exits 0. (Confirmed, PR #131.)

## 8. DONE — Definition of Done

**From WHAT/HOW (command)**
- [ ] `faff adr supersede <old> --by <new>` stamps OLD `Status: Superseded by ADR-<new>` + adds `**Supersedes:** ADR-<old>` to NEW; prints both paths; bodies untouched.
- [ ] Accepts `NNNN` or `NNNN-slug`; errors (non-zero) on missing ADR / `old == new` / already-superseded `old`; idempotent on the `Supersedes:` line.

**From HOW (validation)**
- [ ] `faff adr validate` fails on a dangling canonical ref (both directions).
- [ ] `faff adr validate` fails on an asymmetric canonical ref.
- [ ] `faff adr validate` still passes the 4 existing freeform ADRs.

**From WHY (integrity)**
- [ ] Supersede edits only the `Status` value + one `Supersedes:` line — never the body.

**From conformance**
- [ ] `faff adr --selftest` covers supersede + dangling + asymmetric + legacy-passes; CI runs it + `adr validate`.
- [ ] `node --test` green.

**Smoke test:**
```
1. temp docs/adr 0001..0003 → faff adr supersede 0001 --by 0003
2. 0001 Status == "Superseded by ADR-0003"; 0003 has "**Supersedes:** ADR-0001"
3. faff adr validate → exit 0
4. break 0003's Supersedes line → faff adr validate → non-zero (asymmetric)
```

confidence: high
