# FAFF-300 — Recognise numbered scenario headings in `faff admissible`

> Spec: faffter-dark-nlspec · 2026-06-29 · autonomous · confidence: high. Full spec on Linear FAFF-300.

## 1. WHY

`faff admissible --lights-out` is L4's runtime *quality-IN* gate (FAFF-224): it refuses a spec into the unattended queue unless its DoD is machine-verifiable, and it is **fail-safe inadmissible** — an unparseable/absent DoD reads as inadmissible.

The R1 check (≥1 born-verifiable scenario) finds the scenarios section with the regex `^\s*#{1,6}\s+scenarios\b/i`. That anchors `scenarios` to come *immediately* after the leading `#`s, so a **numbered** heading like `### 5. SCENARIOS` is not recognised and R1 reports **zero scenarios** → the whole spec is gated inadmissible **on heading style, not content**.

This bites the producer's own output: `faffter-dark-nlspec` emits `### 5. SCENARIOS` / `### 8. DONE` (numbered, H3). It surfaced live during the FAFF-225 build — the lights-out runner's *own* nlspec used numbered headings and was wrongly excluded. A brittle match silently shrinks the admissible set, the opposite of what the gate is for.

## 2. WHAT

Relax the **scenarios** heading match in `plugin/skills/faff/bin/faff` to recognise an optional leading number (`N.` / `N)`) before the section word, keeping case-insensitivity and the existing `#{1,6}` level span. Recognition only — the R1/R2a/R2b gating logic is untouched.

Surface (declared):
- `plugin/skills/faff/bin/faff` — `parseScenarios()` (R1, used by `faff admissible`) and the `sectionBody()` call inside `dodClassify()` (used by `faff dod classify`). Both use the identical brittle regex literal.
- `admissible --selftest` (and `dod --selftest`) verdict tables — add numbered-heading fixtures.

Out of scope: the DONE matcher needs **no** change — `parseDoneChecklist()` already finds the DoD heading by the word `\bdone\b` at any level, so `## 8. DONE` / `### 4. DONE` already pass (verified by repro). Touch nothing in the R1/R2a/R2b decision logic, the banned-vague list, or R3.

## 3. WHY-NOT (rejected alternatives)

- **Fix only `parseScenarios`, leave `dodClassify` brittle.** Rejected: the two call-sites share one regex literal and are documented as reading the *same* structures; `dodClassify` feeds the holdout evaluator (FAFF-34), so leaving it blind to the producer's numbered scenarios is a parallel latent defect for one saved line.
- **Generalise to lettered / `N.N` / arbitrary prefixes now.** Rejected: no producer emits those; speculative width. Tune from a real miss (matches the file's denylist "tune from real misses" philosophy).
- **Drop the section-word anchor and match any heading near scenarios.** Rejected: over-broad, risks matching prose headings; recognition should stay tight to the producer's actual forms.

## 4. HOW

Introduce **one** shared module-level constant and use it at both call-sites, so `admissible` and `dod classify` stay coherent by construction.

```
// near the other admissibility/dod regexes
const SCENARIOS_HEADING_RE = /^\s*#{1,6}\s+(?:\d+[.)]\s+)?scenarios\b/i;
```

- The optional non-capturing group `(?:\d+[.)]\s+)?` allows a leading `5. ` or `5) ` (integer + `.` or `)` + whitespace), matching the file's existing list-item numbering convention `\d+[.)]`.
- `#{1,6}` (unchanged) already covers the producer's H3 `### N. SCENARIOS` — no level change needed; this resolves the issue's "deeper heading levels?" open question.
- `i` flag (unchanged) handles `SCENARIOS` vs `Scenarios`.

Apply it:
1. `parseScenarios()` (~L9796): replace the inline `/^\s*#{1,6}\s+scenarios\b/i` with `SCENARIOS_HEADING_RE.test(lines[k])`.
2. `dodClassify()` (~L8933): replace `sectionBody(specText, /^\s*#{1,6}\s+scenarios\b/i)` with `sectionBody(specText, SCENARIOS_HEADING_RE)`.

**Anti-pattern:** widening R1's scenario-*counting* logic. Why: the bug is heading *location*, not counting — once the section is found, the existing GWT/assertion counter is correct.

### 5. SCENARIOS — born-verifiable main objectives

```
Given a spec whose sections are `### 5. SCENARIOS` and `### 8. DONE` with one Given/When/Then block and one DONE checklist item
When `faff admissible --spec - --lights-out --json` evaluates it
Then the verdict is admissible (R1 ≥1 scenario and R2a pass) and exit code is 0
```

```
Given a spec using the bare `## Scenarios` + `## DONE` headings
When `faff admissible --lights-out` evaluates it
Then it is still admissible — no regression from the relaxed regex
```

```
Given a lights-out spec with a DONE checklist but no scenarios section at all
When `faff admissible --lights-out` evaluates it
Then it is still inadmissible (R1 fail) — the fail-safe floor is intact
```

- **Assertion:** the numbered-scenarios recognition is shared by both `faff admissible` and `faff dod classify` (one `SCENARIOS_HEADING_RE` constant, both call-sites).

### 6. DESIGN DECISION RATIONALE

- **Numbered-heading recognition for the scenarios section.** **Chosen:** allow an optional `\d+[.)]\s+` prefix on the scenarios heading regex, case-insensitive, `#{1,6}` levels — because the producer's default form (`### N. SCENARIOS`) was being false-inadmissible.
- **One shared constant across both call-sites.** **Chosen:** factor the relaxed regex into a single `SCENARIOS_HEADING_RE` used by `parseScenarios` (admissible) and `dodClassify` (dod classify) — keeps the two coherent (same structures, by construction) at near-zero cost, vs duplicating the literal or fixing only one.
- **Numbering strictness.** **Chosen:** accept integer `N.` / `N)` only — not `N.N` or lettered — matching the only emitting producer and the file's existing `\d+[.)]` list convention; widen later only on a real miss.
- **Heading depth.** **Chosen:** no change — `#{1,6}` already matches `###`–`######`, so the producer's H3 form is covered once the numbered prefix is allowed.
- **DONE matcher untouched.** **Chosen:** leave `parseDoneChecklist` as-is — it already matches numbered/any-level DONE headings by the `\bdone\b` word test (confirmed by repro); changing it would be churn with no behaviour delta.

### 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none load-bearing. (The issue's two open questions — numbering strictness and heading depth — are settled above as Chosen decisions.)

**Assumes:**
- **Assumes:** `faffter-dark-nlspec` is the only spec producer emitting these section headings, so `N.`/`N)` integer numbering covers the real corpus. *Validate:* `grep -rn "SCENARIOS\|DONE" plugin/skills/*/SKILL.md` shows no lettered/`N.N` scenario-heading emitter before building.

### 8. DONE — Definition of Done

### From WHY / WHAT
- [ ] `faff admissible --spec - --lights-out` reports **admissible** for a spec using `### 5. SCENARIOS` + `### 8. DONE` (R1 + R2a pass).
- [ ] The bare `## Scenarios` + `## DONE` form is still admissible (no regression).
- [ ] A scenarios-less lights-out spec is still **inadmissible** (R1 fail) — fail-safe preserved.

### From HOW
- [ ] A single `SCENARIOS_HEADING_RE` constant exists and is used by both `parseScenarios` and the `dodClassify` `sectionBody` call (no duplicated literal).
- [ ] The regex allows an optional `\d+[.)]\s+` prefix, keeps the `i` flag and `#{1,6}` span; R1/R2a/R2b counting logic is unchanged.

### From SCENARIOS (selftest)
- [ ] `faff admissible --selftest` includes a numbered-heading fixture asserting `### N. SCENARIOS` + `### N. DONE` is admissible, and the bare-heading and DoD-less cases still pass; the suite exits 0.
- [ ] `faff dod --selftest` still passes with the shared constant (numbered-scenarios coherence; add a numbered fixture if the table doesn't already cover it).

confidence: high

spec-review: approve
