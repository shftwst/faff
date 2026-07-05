# Adversarial Gate Below L4: L3 Critical-Escalation + Autonomous Chain-Outage Annotation

> Spec: faffter-dark-nlspec · 2026-07-04 · autonomous · confidence: high. Full spec on Linear FAFF-353.

## 1. WHY — Problem and Principles

**Load-bearing model.** The adversarial gate's value is that a *different* model catches what the implementor missed. That value is zero if the gate silently disables itself — either by staying advisory when no human is watching (L3), or by reading "review: pass" when no adversarial review was performed.

**Problem.** The Phase-2 `critical` → `needs-human` escalation was scoped to the L4 lights-out signal only. At L3 (run overnight via `/faff-beep-boop`, no human watching) a `critical` adversarial finding remains advisory — the build agent assesses its own indictment and can dismiss it. Separately, when every backend in the fallback chain is unreachable, the chain terminates `pass+skip` in all modes; the run summary reads `review: pass` with no signal that review was not performed.

**Principles.** Review quality never loosens (appetite hard floor — critical-escalation is a quality gate, threshold `critical` unchanged, trigger widened). Interactive L2 semantics unchanged (a watched human may proceed on a dead chain). Visibility over blocking for infra faults (a down provider is not a code defect → surface loudly + annotate ledger, don't park).

## 2. OUT OF SCOPE
- Widening `ESCALATE_SEVERITIES` to include `major` (v1 = `{ critical }`).
- Appetite-modulating the critical-escalation (fixed floor) or the outage annotation.
- Changes to `review-call.mjs` exit codes (behaviour difference lives in SKILL.md prose + the contract block).
- `faffter-noon-review` (Phase 1) and the spec-review gate — untouched.

## 3. WHAT
New signal `autonomous: bool` (true on ANY unattended run — L3 or L4), forwarded by faff-graft Step 9 alongside (orthogonal to) `lights_out`. L4 = `autonomous:true ∧ lights_out:true`.

`faff-contract:review-verdict` gains an OPTIONAL backward-compatible field:
```
{ "signal":"pass|fail|needs-human", "findings":[...],
  "adversarial_outcome": "chain-outage-skipped" | omitted }
```
Present + `"chain-outage-skipped"` ONLY when: autonomous, Phase-2 full-chain outage (all exit-5), signal `pass`. The CLI validates only `signal`+`findings` as today (transparent pass-through).

**Chosen:** separate boolean (not a 3-way enum) — minimises blast radius, orthogonal composition. **Chosen:** optional field on the existing block (not a new block) — additive. **Chosen (chain-outage):** annotate-and-`pass` in autonomous mode, not park — an infra outage produces no finding to gate on; parking conflates availability with quality; the morning brief surfaces the gap.

## 4. HOW
**4a. L3 critical-escalation.** Rename `## Lights-out escalation` → `## Autonomous-run escalation` in `faffter-dark-adversarial-review/SKILL.md`; change the trigger from `lights_out:true` to `autonomous:true`. Fires when all three hold: Phase 1 `pass`, `autonomous:true`, ≥1 Phase-2 finding in `ESCALATE_SEVERITIES={critical}`. Trigger is the RAW Phase-2 severity, not the implementor's disposition. Action: set block `signal` to `needs-human`, fold each escalating critical into `findings[]` as `{location_present:true, action_present:true}`. Fail-safe: `autonomous` false/absent/unresolved → do NOT escalate.

faff-graft Step 9: forward `autonomous` (true for any beep-boop dispatch, false interactive) alongside `lights_out`, as prose context.

**4b. Full-chain outage (autonomous).** Exit-code→outcome table gains an autonomous column; only exit 5 differs:

| exit | interactive | autonomous |
|---|---|---|
| 0 | parse/disposition | same |
| 2/4/6/7 | needs-human | needs-human |
| 5 / timeout | pass + finding noting skip | pass + LOUD finding + `adversarial_outcome:"chain-outage-skipped"` |

On autonomous exit-5: emit `## Adversarial findings — SKIPPED (all backends unreachable)` ("This build shipped without adversarial review"); set block `{signal:"pass", findings:[], adversarial_outcome:"chain-outage-skipped"}`. faff-graft forwards the token; beep-boop ledger gains a top-level `review_adversarial_skipped: [issue-ids]` array (runcheck-transparent, not a per-issue enum change); beep-boop run summary renders a distinct `## Shipped (adversarial review skipped — chain outage)` subsection (issues NOT duplicated under `## Shipped (auto-merged)`).

**4c.** The two fixes are mutually exclusive (fix 1 needs findings = exit 0; fix 2 needs no findings = exit 5).

## 5. SCENARIOS
```
Given L3 (autonomous:true, lights_out:false), backend reachable, Phase1 pass, ≥1 Phase-2 critical
When the review slot authors the verdict block
Then signal is needs-human, findings has ≥1 entry, graft Step 10 parks (no merge)
```
```
Given interactive L2 (autonomous:false), same Phase1 pass + Phase-2 critical
Then signal stays pass (critical advisory) — no change from today
```
```
Given L3 autonomous, ALL backends unreachable (full-chain exit 5)
Then signal pass + adversarial_outcome "chain-outage-skipped"; loud SKIPPED header;
  run summary shows the issue under "Shipped (adversarial review skipped — chain outage)";
  ledger review_adversarial_skipped contains the id; NOT under "Shipped (auto-merged)"
```
```
Given interactive L2, all backends unreachable
Then pass + a finding noting the skip (unchanged); no adversarial_outcome; summary unchanged
```

## 6/7. RATIONALE / ASSUMPTIONS
Fixed floor (review quality is immutable per the gateway hard floor). Annotate-and-pass for infra outage (quality-conditioned gate; infra fault → no finding to gate on). Separate boolean (blast radius). Optional field (additive).

**Assumes:** faff-graft Step 9 already resolves a signal it can key `autonomous` off (set alongside `lights_out`; verify the derivation point). **Assumes:** the ledger schema allows an additive top-level array without a runcheck migration (verify `runcheck` logic).

**Punt:** Whether `faff contract review-verdict` (the CLI) needs a code change to pass through `adversarial_outcome`. *(decides: architecture)* — Lean: **no CLI change needed** (transparent pass-through validating only `signal`+`findings`); if a strict known-fields-only validation exists in the script, add the field to the allowlist. Build-time verifiable by inspecting the contract validator.

**Resolve-attempt outcome (autonomous build):** inspected `computeReviewVerdict` in `bin/faff` — it reads only `signal`+`findings` and rebuilds `contractData` from scratch, so extra fields are structurally ignored (no known-fields rejection). **No CLI change needed.** A defensive selftest fixture was added to lock the pass-through.

## 8. DONE
- [ ] L3 Phase-2 `critical` → verdict `needs-human` → PR parks (not merged)
- [ ] L2 interactive same critical → signal stays `pass` (advisory, no change)
- [ ] All-backends-unreachable → run summary `## Shipped (adversarial review skipped — chain outage)` (not a bare Shipped entry)
- [ ] Ledger `review_adversarial_skipped` array carries the affected ids
- [ ] faff-graft Step 9 forwards both `autonomous` (new) and `lights_out`
- [ ] `faffter-dark-adversarial-review/SKILL.md` defines `autonomous` in Input; section renamed to `## Autonomous-run escalation`; trigger reads `autonomous:true`
- [ ] `adversarial_outcome:"chain-outage-skipped"` emitted in the outage case only; exit-table has both mode columns
- [ ] Interactive outage → unchanged `pass + finding` (no `adversarial_outcome`)
- [ ] Critical-escalation and chain-outage paths documented mutually exclusive
- [ ] beep-boop run summary template includes the distinct subsection; issues occupy exactly one bucket

confidence: high
