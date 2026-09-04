# Spec — Judge-aware L4 infosec floor (FAFF-995)

> Spec: faffter-dark-nlspec · 2026-09-04 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-995.
> build-tier: complex
> spec-review: approve (L3 single-pass; lenses architectural/infosec/QA; no objections)

This is the buildable spec for **FAFF-995** — "Judge-aware L4 infosec floor: veto only on a post-judge standing infosec major (not floor removal)." Audience: the build agent implementing it, and the human reviewers gating it. It is HALF 2 of 2 from FAFF-946 (human resolution 2026-09-03, "Chosen: option 3"), self-contained, with no dependency on the sibling durable-judgement-trail ticket.

## 1. WHY — Problem and Principles

**The load-bearing idea.** `admitRollup` already computes, per proposition, whether the judge *resolved* it — that is exactly the `resolved[]` array it builds in its per-proposition loop (an `AFFIRM_SPEC`, or an `UPHOLD_REVIEW`/`SYNTHESIZE` correction that `correctionApplied` confirms landed). "A post-judge *standing* infosec major" is precisely a retained infosec `major`/`blocker` objection whose proposition is **not** in `resolved[]`. The whole change is: at effective-L4, decide the infosec floor against that standing set instead of against the pre-judge ledger residue.

**Problem statement.** Today the `infosec_major_free` floor in `admitRollup` vetoes on the **pre-judge** standing residue (a boolean computed by the caller over every ledger entry's `{lens,severity}`), so it parks infosec majors the judge already affirmed or corrected — nuisance parks. FAFF-946 first proposed *removing* the L4 floor; the human resolution replaces that with a *smarter* floor. This change makes the L4 floor judge-aware so a judge-resolved infosec major no longer parks, while a genuinely-unresolved one still does.

**Design principles.**

**Fail-safe by construction via the effective level.** The floor's behaviour is keyed off the **effective** level from `l4Ratify`, never the caller-claimed level. A run that claims L4 but fails ratification falls back to effective-L3 and keeps the pre-judge floor. The relaxation only ever applies where L4 was genuinely earned.

**Deterministic and fail-closed.** No model call, no probabilistic input. A degraded/null floor input still vetoes at every level. The relaxation narrows *which* infosec majors veto; it never opens a path where a missing signal admits.

**L3 stays byte-identical.** The pre-judge arithmetic floor is the L3 security net and is unchanged. Making L3 judge-aware is a strictly-better follow-on, explicitly out of scope here.

**The judge-blinding firewall is not touched.** The judge is blinded to lens labels (`lensScrub`) on the *input* it sees; this floor reads the judge's *output* ruling, not its input. Reading the ruling to decide the floor does not weaken blinding — a separate, deliberate property.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` — `admitRollup` (~469–575) | Node.js | The roll-up that owns the floor block and computes `resolved[]` + `l4Ratify` |
| `plugin/skills/faff/bin/lib/spec-judge-evidence.js` — `cmdAdmit` (~535–606) | Node.js | Assembles floor inputs and calls `admitRollup` |
| `infosecMajorFree` (evidence.js ~65) | Node.js | Pure arithmetic floor helper (pre-judge boolean); also feeds two unrelated floors |
| `l4Ratify` (casefile.js ~428) | Node.js | Returns `{effectiveLevel, veto}` — the source of the effective level |

**Scope statement.** This tightens one deterministic admit-gate floor inside the L4 spec-judge roll-up; it changes no CLI surface, no contract schema, and no judge prompt.

## 2. OUT OF SCOPE

- **L3 judge-awareness** — the L3 floor keeps vetoing on the pre-judge residue. *Why:* the ticket scopes the change to L4; L3 is the conservative net. *Extension point:* the same effective-level branch in `admitRollup`'s floor block — a follow-on would drop the L3/L4 split.
- **The durable judgement trail** — the sibling FAFF-946 half. *Why:* independent ticket, no dependency here. *Extension point:* separate work item.
- **The convergence floor `infosec_major_free_latest`** (evidence.js ~288) and **the accept-bar `infosecMajorFree(verdict.upheld)` use** (evidence.js ~350). *Why:* these are different floors that reuse the same pure helper; they are not the admit floor and must not change behaviour. *Extension point:* n/a — leave them exactly as-is.
- **Adding new veto tokens** — the change reuses `"infosec_major"` and `"floor_input_degraded"`. *Why:* downstream classification already understands these; a new token is unneeded surface. *Extension point:* `floor_veto` vocabulary if telemetry ever needs to distinguish pre- vs post-judge.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Pre-judge residue | The caller-computed boolean `floors.infosec_major_free`: `false` iff any ledger entry is `{lens:'infosec', severity:'major'|'blocker'}`, over the *whole* ledger, before rulings are consulted. |
| Post-judge standing infosec major | A ledger entry with `lens==='infosec'` and `severity` in `{'major','blocker'}` whose proposition id is **not** in `admitRollup`'s `resolved[]` — i.e. the judge neither affirmed it nor landed an applied correction for it (covers `PRD_BOUNDARY`, unapplied corrections, parked, and non-conformant outcomes). |
| Effective level | `admitRollup`'s post-ratification level: `l4Ratify(runDir).effectiveLevel`. `L4` only when the run-ledger and from-genesis chain corroborate L4; otherwise `L3`. |

**Interfaces — unchanged signatures.** No change to `admitRollup(opts)` or `cmdAdmit`'s argument shape, the `floors` tri-state contract, the `AdmitResult` fields, or the `faff-contract` outputs. `floors.infosec_major_free` remains a tri-state (`true`/`false`/`null`).

**Key invariant relied upon (verified in code).** Every infosec `major`/`blocker` objection is `blocking` (`blockingOf(severity)` is true for both), so a *standing* infosec major is always a `blocking` unresolved proposition. Therefore membership test `!resolved.includes(pid)` fully captures the ticket's "judge did not `AFFIRM_SPEC`, and any correction for a blocking proposition was not applied, or is `PRD_BOUNDARY`."

## 4. HOW — Behavior

**Approach.** Two edits, both in `admitRollup`; `cmdAdmit` gets only a comment refresh.

**Edit 1 — hoist the effective-level computation above the floor block.** Today `effectiveLevel` is computed *after* the floor block (~544–560). Move that block to run right after the per-proposition loop / `everyBlockingResolved` (so `resolved[]` and `effectiveLevel` are both in hand before any floor is decided). The moved block keeps its existing behaviour verbatim: it sets `effectiveLevel`, pushes `l4_unratified` / `l4_chain_uncorroborated` as applicable, and applies the `prd_absent_at_l4` fail-safe (`floorPass=false`). Ordering of pushes into `floor_veto` is immaterial — it is a set-like array and no test asserts positional index.

**Edit 2 — make the infosec floor branch on effective level.** Replace the single infosec floor block (~531–534) with a level-branched decision:

```
PROCEDURE infosec_floor(effectiveLevel, floors, entries, order, resolved):
  IF effectiveLevel == "L4":
    # judge-aware, fail-closed
    input = floors.infosec_major_free
    IF input is not true AND input is not false:        # null / absent → degraded
        floorPass = false; pushVeto("floor_input_degraded")
    ELSE IF any pid in order where entry.lens == "infosec"
              AND entry.severity in {"major","blocker"}
              AND pid NOT in resolved:                   # post-judge standing
        floorPass = false; pushVeto("infosec_major")
    # else: no standing infosec major → NO veto (the nuisance-park fix)
  ELSE:
    # L3 (incl. any effective-L3, e.g. unratified-L4 fallback) — BYTE-IDENTICAL to today
    IF NOT (floors.infosec_major_free == true):
        floorPass = false
        pushVeto(floors.infosec_major_free == false ? "infosec_major" : "floor_input_degraded")
```

The other three floors (`blocker_free_latest`, `reputation_ok`, `ratified_scope_ok`) are unchanged.

**Behavior summary.** At effective-L4, the floor vetoes only when the pre-judge input is degraded (fail-closed) or an infosec major/blocker is still standing after the judge ruled. At effective-L3 — including a caller-claimed-L4 run that failed ratification — the floor is the existing pre-judge arithmetic gate.

**Why the L4 admit boolean is still safe.** A standing infosec major is always `blocking`, so it already forces `everyBlockingResolved=false` (and `PRD_BOUNDARY` also fails `prd_boundary.length===0`). The floor's L4 job is therefore to (a) *stop* firing on judge-resolved majors — the real fix — and (b) keep the correct `floor_veto` classification when one genuinely stands. It never admits something `everyBlockingResolved` would block.

**cmdAdmit.** No functional change: `admitRollup` already receives `ledger`, `rulings`, and `currentSpecText`, so the post-judge residue is computed where `resolved[]` lives — no duplicated resolution logic in `cmdAdmit`. The one required touch is the comment at ~582–587, which currently asserts the floor "vetoes OVER THE TOP regardless of the per-proposition outcome"; that is now true only at effective-L3, so the comment must be corrected to describe the L3 pre-judge / L4 judge-aware split.

**Edge cases.**
- **Parked infosec major** → not in `resolved` → stands → L4 veto `infosec_major`; also `everyBlockingResolved=false`. Correctly escalates.
- **Unapplied infosec correction** (`UPHOLD_REVIEW`/`SYNTHESIZE`, `correctionApplied` false) → not in `resolved` → stands → veto. Correct.
- **Applied infosec correction** → in `resolved` → does not stand → no L4 veto. This is part of the fix.
- **Non-conformant outcome** on an infosec major → falls to `unresolved`, not `resolved` → stands → veto (fail-safe).
- **Degraded input (`null`) at effective-L4** → `floor_input_degraded` veto (fail-closed), independent of the residue.

**Anti-pattern:** re-deriving "did the judge resolve it" in `cmdAdmit` or with a fresh `correctionApplied` pass. Why: it duplicates logic that already lives in `admitRollup`'s loop and will drift; use `resolved[]`.

**Anti-pattern:** changing `infosecMajorFree`'s two other call sites (convergence output, accept-bar). Why: they are different floors sharing a pure helper; touching them is out-of-scope scope-creep.

**Failure modes.**
- **The failure:** `resolved[]` doesn't actually mean "judge resolved" for some outcome, so the L4 floor wrongly relaxes. **How you'd know:** the PRD_BOUNDARY-at-L4 acceptance test admits, or a standing-unapplied-correction test admits. **What it means:** narrow — the standing predicate must key off `resolved[]` exactly; if a new judge outcome is added later it must be classified into `resolved`/`unresolved` before this floor can trust it.
- **The failure:** effective level is read after the floor decides (regression of Edit 1), so an unratified L4 gets the relaxed floor. **How you'd know:** the "unratified-L4 keeps the floor" test fails (admits instead of vetoing). **What it means:** proceed only with Edit 1 landed — the hoist is load-bearing, not cosmetic.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an effective-L4 run (ratified run-dir, governing_requirements present)
  with a retained infosec `major` objection the judge ruled AFFIRM_SPEC
  and floors.infosec_major_free == false (a pre-judge major was present)
When admitRollup runs
Then floor_veto does NOT include "infosec_major"
  and admit is true (nothing else blocking)
```

```
Given the same ledger and rulings but level L3 (effective-L3)
When admitRollup runs
Then floor_veto includes "infosec_major"
  and admit is false
```

```
Given a caller-claimed L4 run that FAILS ratification (runDir null or uncorroborated chain)
  with floors.infosec_major_free == false
When admitRollup runs
Then effectiveLevel is "L3"
  and floor_veto includes both the ratification veto (e.g. "l4_unratified") and "infosec_major"
  and admit is false
```

- The L4 infosec floor MUST fail closed: at effective-L4 with `floors.infosec_major_free == null`, `floor_veto` includes `"floor_input_degraded"` and `admit` is false, regardless of the standing set.
- The effective-L3 infosec floor path MUST remain byte-identical to the pre-change block (same veto tokens for `false` vs `null`).

## 6. Design Decision Rationale

**Where to compute the post-judge residue?** Options: (a) inside `admitRollup` from `entries`+`resolved[]`; (b) recompute in `cmdAdmit` and pass a second boolean. (a) reuses the exact resolution decision already made and adds no duplicate `correctionApplied` pass; (b) duplicates logic that will drift. **Chosen:** (a) — compute inside `admitRollup` using `resolved[]`.

**How to reconcile the ordering (effective level computed after the floor block)?** Options: hoist the effective-level block above the floors; or thread a second pre-computed level in. **Chosen:** hoist the existing `l4Ratify`/effective-level block to run right after the proposition loop — smallest, keeps one source of truth for the level, preserves its existing veto pushes.

**What does the L4 floor do on a degraded (`null`) input?** Options: trust the locally-computed residue and ignore the input; or fail closed. **Chosen:** fail closed (veto `floor_input_degraded`) — honours the tri-state floor contract and the fail-closed principle; defensive, since `infosecMajorFree` returns a boolean in practice.

**New veto token for the post-judge standing case?** **Chosen:** reuse `"infosec_major"` (standing) and `"floor_input_degraded"` (null) — downstream classification already handles them; no new surface.

**Change `cmdAdmit`'s floor-input assembly?** The ticket says "as needed." Since the residue lives in `admitRollup`, no functional change is needed. **Chosen:** leave the `cmdAdmit` floor inputs functionally unchanged; only correct the now-partly-false "vetoes OVER THE TOP regardless of outcome" comment to describe the L3/L4 split.

**Make L3 judge-aware too?** **Chosen:** no — out of scope per ticket; L3 stays the conservative pre-judge net. Noted as a strictly-better follow-on.

## 7. Open Questions and Assumptions

**Open Questions.** None — the design is fully determined by the ticket and verified against the code.

**Assumptions.**

- **Assumes:** ledger entries carry `lens` and `severity` fields at the point `admitRollup` reads them. *Validation:* confirmed in the ledger-build path (`spec-judge-casefile.js` ~378–389) and in existing test fixtures; the build agent should keep reading these off `entries[pid]`, not re-fetch them.
- **Assumes:** `admitRollup` is called only from `cmdAdmit`. *Validation:* `grep -rn "admitRollup" plugin/skills/faff/bin` — the only runtime caller is `cmdAdmit`; no other call site relies on the old L4 over-the-top behaviour.

## 8. DONE — Definition of Done

### From WHY
- [ ] At effective-L4, a retained infosec major the judge `AFFIRM_SPEC`'d (or landed an applied correction for) no longer produces an `infosec_major` floor veto (nuisance park removed).
- [ ] L3 admit behaviour is byte-identical to before the change (same veto tokens, same admit outcomes) for every existing L3 test.

### From WHAT
- [ ] `admitRollup(opts)` signature, the `floors` tri-state contract, and `AdmitResult` fields are unchanged.
- [ ] The `infosecMajorFree` uses at evidence.js ~288 and ~350 are untouched.

### From HOW (behaviour)
- [ ] Effective-level computation is hoisted so `effectiveLevel` and `resolved[]` are both available before the infosec floor is decided.
- [ ] At effective-L4, the infosec floor vetoes iff the input is degraded (`floor_input_degraded`) or a post-judge standing infosec `major`/`blocker` exists (`infosec_major`); otherwise no veto.
- [ ] At effective-L3 (including unratified-L4 fallback), the infosec floor is the pre-change pre-judge block.
- [ ] The standing predicate is `entry.lens==='infosec' && severity in {major,blocker} && !resolved.includes(pid)`.

### From HOW (edge cases)
- [ ] Effective-L4 + `PRD_BOUNDARY` infosec major → `admit:false`, `prd_boundary` lists it, `floor_veto` includes `infosec_major`.
- [ ] Effective-L4 + `null` infosec input → `admit:false`, `floor_veto` includes `floor_input_degraded`.
- [ ] Unratified caller-claimed L4 → effective-L3, floor still fires on a pre-judge major, `floor_veto` includes the ratification veto.

### From cmdAdmit
- [ ] The `cmdAdmit` comment (~582–587) is corrected to describe the L3 pre-judge / L4 judge-aware behaviour (no longer "over the top regardless of outcome").

### Tests
- [ ] `test/spec-judge-casefile.test.mjs` extended with the four Scenarios plus the fail-closed and L3-byte-identical assertions (reuse `mintRunDir` for ratified-L4 fixtures and set `governing_requirements` to avoid `prd_absent_at_l4`).
- [ ] `test/spec-judge-evidence.test.mjs` gets one end-to-end `cmdAdmit` case proving the wired effective-L4 judge-aware path (ledger.json + ruling files + spec + ratified run-dir → admit JSON with no `infosec_major` veto on an affirmed infosec major).

**Integration smoke test.**
```
1. Build a ratified-L4 run-dir (mintRunDir includeChainLevel=true) and a ledger with
   one infosec `major` blocking proposition + governing_requirements present.
2. Provide a ruling AFFIRM_SPEC for it; floors {blocker_free_latest:true, infosec_major_free:false}.
3. admitRollup(...) → expect admit:true, floor_veto excludes "infosec_major".
4. Flip level to "L3" with the same inputs → expect admit:false, floor_veto includes "infosec_major".
```

confidence: high
spec-review: approve

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery** (advisory — does not block promotion)

**Right-sized? (Principle 4) — No split; hold as one unit, with a tier flag.** Edit 1 (hoisting the effective-level block) is a stated prerequisite for Edit 2 (the level-branched floor) — they are a merge-correct pair, not a split candidate; splitting would ship a non-functional intermediate. Reads as a single 1–3 day unit. One thing to surface: the deterministic classifier rates this **build-tier: complex** while the ticket estimates **mechanical/standard** — reconcile the tier before it enters the build queue so the downstream gating expectation is honest.

**Workstream fit? (Principles 1 + 5) — One finding to eyeball.** Serves one coherent outcome and sits cleanly under parent FAFF-946 as self-contained Half 2; no scope riders. Worth a human glance: `faff-automate` reads as a capability/area label rather than a named shippable outcome — a project-shape question for a `backlog-diagnostics` pass, independent of this ticket.

**Deps surfaced? (Principle 6) — No issues.** No blockers; independence from sibling FAFF-994 is explicit and confirmed by the design (everything consumed lives in the same two files).

**Risk profile? (Principle 7) — Acceptable; no separate spike needed.** Touches a security admit-gate but de-risked by construction (deterministic, fail-closed; effective level keyed off `l4Ratify`, never the caller claim). Residual risk concentrates in Edit 1's ordering and is pinned by named tests. Recommended: treat the three guard tests (unratified-L4-keeps-floor, L3-byte-identical, effective-L4-null-fails-closed) as the risk gate they are.
