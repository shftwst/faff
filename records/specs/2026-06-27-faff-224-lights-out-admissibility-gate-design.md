# FAFF-224 — Lights-out admissibility gate: refuse specs without a machine-verifiable DoD from the unattended queue

> Spec: faffter-dark-nlspec · 2026-06-26 · interactive · confidence: high. Full spec on Linear FAFF-224.

> **Revised 2026-06-26 (iterate).** The R3 Punt is resolved → **Chosen: recommend-not-require (advisory warn)** — a missing runnable-check command is surfaced as a non-gating `warnings` entry, never inadmissible. The graph contradiction is reconciled: `blockedBy FAFF-34/FAFF-38` downgraded to `relatedTo` (v1 is explicitly decoupled from both, so the blocker edges falsely held it not-ready). Confidence medium → high; no open Punts.

This is the build spec for FAFF-224, written for the build agent and human reviewers. It defines a **mechanical admissibility gate** that refuses a spec into the L4 / lights-out build queue unless that spec carries a machine-verifiable Definition of Done. It is a pure, deterministic check that sits between prep (spec rated) and build-admission — not an LLM judgement.

## 1. WHY — Problem and Principles

**The load-bearing idea:** at L4 nobody reviews the morning brief, so the *spec itself* must carry stop-conditions a machine can evaluate without a human — otherwise the build agent grades its own "done", the exact failure L4 exists to remove. This gate is the **mechanical floor** that refuses a spec carrying no machine-checkable DoD *structure*; it is not a semantic guarantee that the DoD is good (that judgement layer is FAFF-9, which sits above this gate).

**Problem statement.** Today the autonomous pipeline admits any spec whose confidence is `high` and whose routing verdict is `fire-and-forget`/`likely-fire` — confidence and routing say nothing about whether "done" is machine-checkable. At L3 the safety net is the morning park-review; at L4 (off down the pub) there is no morning review, so an under-specified spec would let the agent judge its own completion unchecked. This change adds a deterministic check that refuses such a spec into the lights-out queue and parks it for a human.

**Design principles** (each would reject an otherwise-valid implementation):

- **Deterministic-tools-over-prose.** The verdict is a pure function over the spec's text structure — section presence, checkbox lines, scenario keywords, a banned-vague-phrase filter. **Anti-pattern:** calling an LLM (or re-invoking the spec producer) to judge admissibility. Why: an LLM judging whether the DoD is verifiable *is* the agent grading itself — the failure mode this gate removes. The judgement layer is a separate gate (FAFF-9).
- **Fail-safe, not fail-open.** An ambiguous, unparseable, or structurally-absent DoD is **inadmissible** (parks for a human), never silently admitted. Any internal error coerces to `inadmissible`, mirroring graft's eligibility gate ("any resolution failure → not-eligible").
- **Mechanical floor, not semantic proof.** The check verifies the *structure* of a machine-verifiable DoD is present; it cannot prove a present scenario is semantically meaningful. The residual gap (structurally-present but weak DoD) is closed by the adversarial judgement layer above it — this is precisely why FAFF-224 **blocks** FAFF-9.
- **No new opinion.** The gate owns no ordering/priority/importance opinion (gateway → ordering belongs to methodology). It is a binary precondition, nothing more.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` → `nextStep` | Node (dependency-free) | Pure transition function; the admissibility verdict gates the `graft` transition but **cannot fold into `next`** — `next` takes only a `--spec none\|low\|medium\|high` token and is content-blind, while admissibility must read the spec body. |
| `plugin/skills/faff/bin/faff` → `contractSpecReadiness` / `computeSpecReadiness` | Node | Precedent for a pure CLI check over spec structure with a schema-validated output + `--selftest`. The new check mirrors its shape, **not** its producer-self-declared-extraction input model (see HOW). |
| `plugin/skills/faff/bin/faff` → `cmdEligible` / `faff eligible` | Node | Precedent: a boolean gate the autonomous lane shells at a fixed chokepoint, verdict from stdout, fail-safe default. |
| `plugin/skills/faff-graft/SKILL.md` Step 2 (eligibility + intake gates) | Skill prose | Precedent call-site: a deterministic pre-worktree refusal that creates no worktree, commits no spec, returns a skip disposition. |
| `plugin/skills/faff-beep-boop/SKILL.md` §4 Build queue assembly | Skill prose | Primary call-site: where `faff next` + routing verdict already filter candidates before admission to `admitted`. |
| `plugin/skills/faffter-noon-spec/SKILL.md` + `faffter-dark-nlspec` | Skill prose | Define the `## Scenarios` (Given-When-Then) + `### N. DONE` checklist structure this gate parses. Both already document "Works correctly" as a banned DONE item — the seed of the concreteness filter. |
| `plugin/skills/faff/contracts/spec-readiness.schema.json` | JSON Schema | Precedent for shipping the verdict's shape as a contract schema validated by the in-CLI subset validator. |

**Scope statement.** This gate sits between prep (spec attached + rated) and build-admission, active **only** under the L4 lights-out signal; at L1–L3 the human gate stands and this check is a no-op.

## 2. OUT OF SCOPE

- **Semantic quality of the DoD** — whether a present scenario actually pins down correct behaviour. *Why:* that is an LLM judgement, forbidden here by the deterministic-tools principle. *Extension point:* the `review`/spec-adversarial layer, FAFF-9 (which FAFF-224 blocks).
- **Run-level terminating predicate** (run-complete | continue | escalate). *Why:* FAFF-38 owns the *run-level* stop condition; FAFF-224 is the *per-spec* admission check. (v1 is decoupled — FAFF-38 is now `relatedTo`, not a blocker.) *Extension point:* `faff budget`/runner termination, FAFF-38 — the run-level predicate may later aggregate per-spec DoDs.
- **Holdout-subset existence** (does a withheld evaluation subset exist for this spec). *Why:* FAFF-34 owns the evaluator-lane holdout harness; v1 decouples from it deliberately (Design Decision 4). (FAFF-34 is now `relatedTo`, not a blocker.) *Extension point:* a second, stricter L4 gate layered when FAFF-34 lands; the worktree-isolation seam (gateway → Worktree location → "holdout/evaluator isolation") is where it would attach.
- **The L4 runner / lights-out activation itself.** *Why:* FAFF-225 (which FAFF-224 blocks) owns the runner that *sets* the lights-out signal. *Extension point:* the run-flag/config this gate reads (Assumption 2).
- **Modifying eligibility or routing semantics.** *Why:* admissibility is a new, orthogonal axis (is "done" machine-checkable?), not a change to eligibility (may auto-build?) or routing (`fire-and-forget` vs `needs-decision-first`). *Extension point:* none — it composes as a third filter.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Machine-verifiable DoD | A Definition of Done whose **structure** a machine can evaluate unattended: ≥1 born-verifiable scenario plus a non-empty DONE checklist free of banned-vague items. |
| Admissible | The spec carries a machine-verifiable DoD structure → may enter the lights-out build queue. |
| Inadmissible | The structure is absent, partial, or unparseable → refused; parks for a human (fail-safe). |
| Lights-out signal | The L4 run signal (config key/run flag) that activates the gate; absent → gate is a no-op (L1–L3 unchanged). |
| Born-verifiable scenario | A `## Scenarios` Given-When-Then triple **or** a non-functional assertion/constraint line (per the spec producers' format). |
| Advisory warning (R3) | A non-gating note (e.g. "no runnable check command found") surfaced for the human; **never** affects the admissible verdict. |

**Type definitions.**

```
RECORD AdmissibilityVerdict:
  admissible: Boolean
  reasons: List<String>        # human-legible failed-requirement messages; non-empty IFF admissible == false
  checks: List<CheckResult>    # full audit trail, one per GATING requirement, pass or fail (always populated)
  warnings: List<String>       # advisory, non-gating (R3 recommend-not-require); NEVER affects admissible

RECORD CheckResult:
  id: String                   # "scope" | "R1.scenarios" | "R2a.done-present" | "R2b.done-concrete"
  pass: Boolean
  detail: String               # e.g. "0 scenarios found (need >=1)" / "2 vague DONE items: ..."

  CONSTRAINT admissible == (every CheckResult in checks has pass == true)   # warnings excluded by design
  CONSTRAINT scope-inactive (lights_out == false) ⇒ admissible == true, checks == [scope:pass], warnings == []
```

**CLI surface.**

```
faff admissible --spec <path> [--lights-out] [--json]   # spec body via file; or '-' / stdin
faff admissible --selftest                              # runs the verdict table, exits 0 pass / 1 fail
```

- **Input:** the spec markdown body (file path or stdin). **No tracker/network access** — parity with `faff next` / `faff eligible` / `faff contract`. The caller supplies the spec text it already holds.
- **`--lights-out`:** when absent the gate is inactive (no-op, admissible). Callers pass it only under the resolved L4 signal (Assumption 2). Fail-safe default: **off** — so it can never accidentally block an L3 run.
- **Output (`--json` or default):** the `AdmissibilityVerdict` as JSON on stdout (including any `warnings`).
- **Exit codes:** `0` admissible · `1` inadmissible (including every fail-safe coercion: unparseable spec, internal error, structure absent) · `2` usage error (bad/missing args only). **A `warnings`-only verdict still exits `0`** (advisory, not gating). Callers may branch on stdout `admissible` or on the 0/1 exit; both agree.

**Design decision.** `faff admissible` is a **new top-level subcommand**, not folded into `faff next` and not a `faff contract` variant. **Chosen: new `faff admissible` subcommand** — `next` is content-blind (confidence token only) so the check cannot live there; `contract spec-readiness` trusts a producer-self-declared extraction, which is exactly what admissibility must *not* do (self-judgement). The eligibility/`faff eligible` pattern (a content/label-driven boolean gate the lane shells at a chokepoint) is the right precedent.

## 4. HOW — Behavior

**Architecture.** A pure function `admissibleVerdict(specText, lightsOut)` parses the spec markdown's `## Scenarios` and `### … DONE` sections and applies three **gating** requirements (R1/R2a/R2b) plus one **advisory** check (R3). It is wrapped so any parse exception coerces to `inadmissible`. Two call-sites consult it under the lights-out signal — defence-in-depth, mirroring eligibility:

1. **beep-boop build-queue assembly (primary filter).** In `faff-beep-boop` §4, after `faff next` returns `graft` and the routing verdict admits, and **before** appending to the ledger `admitted` array, shell `faff admissible` on the candidate's attached spec. Inadmissible → **do not admit**; give it a routed-out/park disposition `inadmissible:<reasons>`, surfaced in the run summary for the morning brief — never enters `admitted` (so `runcheck`'s `admitted − outcomes == ∅` invariant holds). Any `warnings` are surfaced alongside but do not change admission. Active only under the lights-out signal; an ordinary L3 run skips it.
2. **graft pre-worktree backstop.** In `faff-graft` Step 2, alongside the eligibility/intake gates and **before Step 3 creates a worktree**, under the lights-out signal only, shell `faff admissible` on the Step-1 spec body (from the tracker — the spec is committed to `docs/` only at Step 4, so the body is passed via stdin). Inadmissible → refuse: no worktree, no spec commit, log to `.faff/runs/<run-id>/<ISSUE>/graft.md`, return the `inadmissible` skip disposition (never a build attempt, never `parked`-as-built). Interactive graft skips this gate entirely (the human is the gate).

**Behaviour summary.** Given a spec and the lights-out signal, return whether its DoD structure is machine-checkable (R1+R2), plus any advisory R3 warning; on any doubt about the gating checks, return inadmissible.

```
PROCEDURE admissibleVerdict(specText, lightsOut):
  1. IF NOT lightsOut:
       RETURN { admissible: true, reasons: [], checks: [ {id:"scope", pass:true, detail:"not lights-out — gate inactive"} ], warnings: [] }
  2. TRY:
       scenarios  = parseScenarios(specText)        # Given/When/Then triples + assertion lines under "## Scenarios"
       doneItems  = parseDoneChecklist(specText)     # "- [ ]" / "- [x]" lines under a "### <n>. DONE" / "DONE — Definition of Done" heading
     CATCH any:
       RETURN { admissible:false, reasons:["spec unparseable — fail-safe inadmissible"], checks:[], warnings:[] }   # fail-safe
  3. checks = []
     # R1 — at least one born-verifiable scenario (GATING)
     checks.push R1 = { id:"R1.scenarios",   pass: scenarios.count >= 1,
                        detail: scenarios.count + " born-verifiable scenario(s) (need >=1)" }
     # R2a — a non-empty DONE checklist (GATING)
     checks.push R2a = { id:"R2a.done-present", pass: doneItems.count >= 1,
                         detail: doneItems.count + " DONE checklist item(s) (need >=1)" }
     # R2b — no DONE item matches the banned-vague filter (GATING)
     vague = doneItems WHERE matchesBannedVague(item.text)
     checks.push R2b = { id:"R2b.done-concrete", pass: vague.count == 0,
                         detail: vague.count + " vague DONE item(s): " + vague.texts }
  4. # R3 — runnable check command (ADVISORY — recommend-not-require; never gates)
     hasRunnable = detectRunnableCheck(specText)   # a fenced ```verify block, an "Integration smoke test" command, or a runnable command line in DONE
     warnings = hasRunnable ? [] : ["R3 advisory: no runnable check command found (recommended for lights-out, not required)"]
  5. admissible = checks.every(c => c.pass)
     reasons    = checks.filter(c => !c.pass).map(c => c.detail)
     RETURN { admissible, reasons, checks, warnings }
```

```
CONSTANT BANNED_VAGUE = [ "works correctly", "works as expected", "handled properly",
  "behaves correctly", "as appropriate", "etc.", "and so on", "properly handled" ]
# Case-insensitive substring match. Seeded from the producers' own documented anti-pattern
# ("Works correctly is not a DONE item"). Tunable; the list is a named constant, not scattered literals.

FUNCTION matchesBannedVague(text):
  RETURN BANNED_VAGUE.any(p => text.toLowerCase().includes(p))
```

**Parsing notes (ambiguity points).**
- `parseDoneChecklist` matches the DONE section by **name** (a heading whose text contains `DONE`), not by number — nlspec emits `### 8. DONE`, the lite producer `### 4. DONE`. Collect `- [ ]`/`- [x]` lines until the next heading of equal-or-higher level.
- `parseScenarios` counts, under a `## Scenarios` heading: each Given/When/Then group (a `Given` line is sufficient to count one) **and** each standalone assertion/constraint bullet (non-functional objectives are valid born-verifiable items per both producers).
- `detectRunnableCheck` (R3 advisory) looks for a fenced ` ```verify ` block, an "Integration smoke test" pseudocode/command block, or a runnable command line — its absence only warns, never fails admissibility.
- A spec missing the `## Scenarios` heading entirely → `scenarios.count == 0` → R1 fails → inadmissible (correct: no born-verifiable objective).

**Edge cases & error handling.**
- **No DoD sections at all** → R1 + R2a fail → inadmissible (the central case the gate exists for).
- **Empty/whitespace spec, or binary garbage** → parse yields zero items or throws → inadmissible (fail-safe).
- **R1+R2 pass but no runnable check** → **admissible** with a single `warnings` entry (R3 is advisory).
- **Lights-out signal unreadable at a call-site** → the *caller* resolves the signal; if unresolvable it must default the signal **off** (gate inactive), because a spuriously-on gate would wrongly block L3. The gate's *own* internal errors, by contrast, coerce to inadmissible. (These point opposite ways on purpose: don't activate the gate on doubt; once active, don't admit on doubt.)
- **`faff admissible` binary unresolvable / shell error at the call-site** → the call-site treats it as inadmissible (graft refuses; beep-boop routes out) — same fail-safe stance as the eligibility gate.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** structural presence ≠ semantic verifiability. A spec with one hollow `Then <it works>` scenario and concretely-worded-but-meaningless DONE items passes R1/R2 yet has no real machine-checkable done. *How you'd know:* lights-out runs ship work that no holdout/test actually pins down; post-merge reverts or escaped defects with admissible-passing specs. *What it means:* expected and accepted — this gate is the *floor*, not the ceiling. The semantic catch is FAFF-9. Do **not** widen this gate toward semantic judgement to cover it (violates the deterministic principle).
- **The failure:** the banned-vague list is an arbitrary denylist — it catches known phrasings, not novel vagueness. *How you'd know:* vague DONE items in new phrasings slip through; calibration-log entries of admitted-then-reverted lights-out work. *What it means:* tune `BANNED_VAGUE` from real misses; never escalate it to an LLM. A denylist is a floor, by design.
- **The failure:** the gate activates at L3 by mistake (signal defaulted on) and blocks the existing autonomous queue. *How you'd know:* L3 beep-boop runs suddenly route out specs that previously built. *What it means:* the fail-safe-**off** default for the signal (not the verdict) prevents this; the selftest's scope-inactive case guards it.

## Scenarios

```
Given a lights-out run and a spec with a "## Scenarios" Given-When-Then objective and a DONE
      checklist whose every item is concrete
When  the admissibility gate evaluates it
Then  the verdict is admissible (exit 0) and the issue is admitted to the build queue
```

```
Given a lights-out run and a spec with no "## Scenarios" section (no born-verifiable objective)
When  the admissibility gate evaluates it
Then  the verdict is inadmissible (exit 1) with reason citing R1, and the issue is parked for a
      human — never admitted to the ledger `admitted` array
```

```
Given a lights-out run and a spec whose DONE checklist contains an item "the feature works correctly"
When  the admissibility gate evaluates it
Then  the verdict is inadmissible (exit 1) with reason citing R2b (vague DONE item)
```

```
Given a lights-out run and a spec that passes R1+R2 but carries no runnable check command
When  the admissibility gate evaluates it
Then  the verdict is admissible (exit 0) with a single R3 advisory warning — never inadmissible for R3 alone
```

```
Given an UNPARSEABLE or empty spec body under a lights-out run
When  the admissibility gate evaluates it
Then  the verdict is inadmissible (fail-safe), not a crash and not admissible
```

```
Given the lights-out signal is OFF (an L1–L3 run)
When  the admissibility gate is consulted
Then  it returns admissible as a no-op with a single scope:pass check and no warnings — L1–L3 behaviour is unchanged
```

- **Assertion:** `faff admissible` makes zero tracker/network calls (parity with `faff next` / `faff eligible`).
- **Assertion:** an inadmissible candidate never enters the run-ledger `admitted` array, so `runcheck`'s `admitted − outcomes == ∅` invariant is unaffected.
- **Assertion:** `warnings` never changes the `admissible` verdict (R3 is advisory by construction).

## 6. DESIGN DECISION RATIONALE

**Where the gate lives — new CLI vs `faff next` extension vs prep-time stamp.**
- *`faff next` extension:* rejected — `next` is content-blind (takes a confidence token, not the spec body); admissibility needs the DoD text.
- *Prep-time stamp:* rejected as the *sole* home — a stamp written by the producer is a self-grade (the failure L4 removes), and a stale spec could carry a stamp no longer true. A fresh check at admission is authoritative.
- *New pure CLI consulted at admission:* chosen.
- **Chosen: a new pure `faff admissible` subcommand, consulted at admission** — deterministic, re-evaluable, tracker-free, mirrors the `faff eligible` chokepoint precedent.

**Call-site — single vs defence-in-depth.**
- *Single (assembly only):* simpler but a direct `/faff-graft` lights-out invocation would bypass it.
- *Defence-in-depth (assembly filter + graft pre-worktree backstop):* chosen — mirrors how eligibility is enforced at both beep-boop assembly and the graft backstop. **Chosen: assembly filter (primary) + graft pre-worktree backstop**.

**Input model — producer-declared extraction vs CLI parses structure.**
- *Producer-declared (like `contract spec-readiness`):* rejected — the producer asserting "my DoD is verifiable" is the agent grading itself.
- *CLI parses spec structure deterministically:* chosen. **Chosen: the CLI parses the spec markdown structure directly** — deliberately diverges from the spec-readiness extraction model because the thing checked is exactly what the producer must not self-certify.

**Holdout-subset requirement (open question 3) — couple to FAFF-34 now, or decouple.**
- *Require a holdout to exist for admissibility:* rejected for v1 — FAFF-34 is unshipped; coupling makes this gate un-buildable now and conflates two checks.
- *Decouple — admissibility = DoD-verifiability only:* chosen. **Chosen: v1 does not require a holdout subset; holdout-existence is a separate stricter L4 gate layered when FAFF-34 lands** — the DoD floor is independently valuable and shippable against FAFF-10 (the one shipped foundation). (FAFF-34 reconciled to `relatedTo` this iteration.)

**Minimal bar for "machine-verifiable DoD" (open question 2) — does it require a runnable check command (R3)?**
- *Require R3 (inadmissible without a runnable command):* rejected — many valid specs legitimately have no single runnable command, so requiring it would falsely reject good specs; and the run-level "checked" predicate is entangled with FAFF-38 (unshipped, now `relatedTo`).
- *Recommend-not-require (advisory warn):* chosen. **Chosen: R1+R2 are the gating floor; R3 (runnable check command) is an advisory `warnings` entry, never inadmissible** — raises visibility toward true unattended checkability without false rejections; R3 can be promoted to gating later if calibration shows it's needed. (Resolved from a Punt this iteration, 2026-06-26.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — R3 (runnable-check requirement) resolved this iteration to recommend-not-require (advisory warn); the FAFF-34/FAFF-38 coupling resolved by decoupling (now `relatedTo`).

**Assumptions.**

- **Assumes:** The `## Scenarios` (Given-When-Then + assertion) and `### N. DONE` checklist structure is the stable spec format both producers emit. *Validate:* confirm `faffter-noon-spec` and `faffter-dark-nlspec` both emit `## Scenarios` and a `DONE` heading with `- [ ]` items, and that the "Works correctly is not a DONE item" anti-pattern is documented (both verified present at spec time — this is the SHIPPED FAFF-10 foundation). If a producer's headings drift, update the parser's heading matcher.
- **Assumes:** A lights-out run signal exists (or will be provided by FAFF-225) for callers to resolve, fail-safe **off**. *Validate:* check for a `lights_out` run flag / `.faffrc` key the runner sets; if none exists yet, the gate ships dormant (callers never pass `--lights-out`) until FAFF-225 wires the signal. The CLI itself is buildable and testable now via the explicit `--lights-out` flag and `--selftest`.
- **Assumes:** FAFF-38's run-level terminating predicate is separate and out of scope. *Validate:* confirm no existing run-termination machinery already defines a per-spec DoD predicate this would duplicate; if FAFF-38 lands first, reconcile the per-spec floor with its run-level predicate rather than re-implementing.

## 8. DONE — Definition of Done

### From WHY
- [ ] Under the lights-out signal, a spec with no machine-verifiable DoD structure is refused into the build queue and parked for a human (never silently admitted).
- [ ] The check calls no LLM and does not re-invoke the spec producer (grep the implementation: no model/slot invocation in the admissibility path).

### From WHAT (types and interfaces)
- [ ] `faff admissible --spec <path>` reads spec text from a file or stdin and emits an `AdmissibilityVerdict` JSON with `admissible`, `reasons`, `checks`, `warnings`.
- [ ] `admissible == true` exactly when every `CheckResult.pass` is true; `reasons` is non-empty iff `admissible == false`; `warnings` never affects `admissible`.
- [ ] Exit code is `0` admissible (including warnings-only), `1` inadmissible (including fail-safe coercions), `2` usage error only.
- [ ] `faff admissible` makes zero tracker/network calls.

### From HOW (behaviour)
- [ ] With `--lights-out` absent, the verdict is admissible with a single `scope:pass` check and empty warnings (L1–L3 no-op).
- [ ] R1 fails (inadmissible) when zero `## Scenarios` born-verifiable items are present.
- [ ] R2a fails (inadmissible) when the DONE checklist is empty/absent; R2b fails when any DONE item matches `BANNED_VAGUE` (e.g. "works correctly").
- [ ] R3 is advisory: a spec passing R1+R2 with no runnable check command is **admissible** with one `warnings` entry — never inadmissible for R3 alone.
- [ ] The DONE section is matched by heading name containing `DONE` (works for both `### 8. DONE` and `### 4. DONE`).
- [ ] `BANNED_VAGUE` is a single named constant seeded from the producers' documented anti-pattern.

### From HOW (edge cases & fail-safe)
- [ ] An unparseable/empty spec yields `inadmissible` (not a crash, not admissible).
- [ ] At a call-site, a `faff admissible` resolution/shell failure is treated as inadmissible (graft refuses pre-worktree; beep-boop routes out) — fail-safe.
- [ ] An unresolvable lights-out signal defaults the gate **off** at the caller (never spuriously blocks L3).

### From call-site integration
- [ ] In `faff-beep-boop` §4, an inadmissible candidate under lights-out is not appended to the ledger `admitted` array and is surfaced in the run summary (not parked-as-built, `runcheck` invariant intact); warnings are surfaced but do not change admission.
- [ ] In `faff-graft` Step 2 under lights-out, an inadmissible spec creates no worktree, commits no spec, logs the reason, and returns the `inadmissible` skip disposition; interactive graft skips the gate.

### From the contract / parity guard
- [ ] `faff admissible --selftest` runs the verdict table (admissible / R1-fail / R2a-fail / R2b-fail / R3-advisory-warn / unparseable-failsafe / scope-inactive) and exits 0 only when all cases pass.

**Integration smoke test.**
```
PROCEDURE smoke():
  1. good = a spec with one Given-When-Then under "## Scenarios" + DONE items all concrete
     ASSERT  `faff admissible --spec good --lights-out`  → exit 0, admissible:true
  2. bad  = good with the "## Scenarios" section removed
     ASSERT  `faff admissible --spec bad  --lights-out`  → exit 1, admissible:false, reasons cite R1
  3. warn = good with no runnable check command
     ASSERT  `faff admissible --spec warn --lights-out`  → exit 0, admissible:true, warnings cite R3
  4. ASSERT `faff admissible --spec good` (no --lights-out) → exit 0, admissible:true (scope no-op)
  5. ASSERT `faff admissible --selftest` → exit 0
```

confidence: high
