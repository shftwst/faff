# Retire the automation-hold label — eligibility becomes a single `automate` signal

> Spec: faffter-dark-nlspec · 2026-09-23 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1097.

This spec addresses FAFF-1097. Audience: the build agent implementing the change, and the human reviewers gating the PR. It describes retiring the `automation-hold` control-label role so that automation eligibility is decided by exactly one tracker-owned label — `automate` present means eligible, absent means not — with no second precedence tier.

## 1. WHY — Problem and Principles

**The load-bearing model.** faff's autonomous pipeline decides whether it may touch a ticket by reading control labels. Today two labels drive that decision in a three-tier precedence: `automation-hold` (hard exclude) > `automate` (include) > the `automation_default` knob. `automation-hold` was a *soft* "pause automation but remember it was meant to be automated" marker layered on top of `automate` instead of removing it. This change deletes that tier: eligibility resolves from `automate` alone.

**Problem statement.** Held tickets never got re-automated — they accumulated as confusing cruft. Under the opt-in default (the shipped posture), the absence of `automate` already means "not automatable", so `automation-hold` and unlabelled are behaviourally identical to the machine. The label carried confusion, not behaviour.

**Design principles.**

- **Control labels must be functionally load-bearing.** Each faff control label must drive pipeline behaviour. A purely-informational visibility marker is not faff's to maintain — how an operator tracks a ticket's state before they consider it automatable is their own business (a local label of their own). This is the same reasoning that retired `repeat-parked` in the sibling FAFF-1092. Reject any implementation that keeps `automation-hold` alive as a passive breadcrumb.
- **The eligibility read-gate's provenance rests on write-abstention, not on the hold tier.** `automate` is tracker-owned: the faff CLI refuses to write it, so its presence proves a human set it. Removing `automation-hold` must not weaken that invariant for the surviving `automate` label — the `tracker_owned` refusal path in `labelOp` must still fire for `automate`.
- **Migration is behaviour-neutral under a tracker.** A currently-held ticket is "not automated" today (the hold excludes it) and stays "not automated" after removal (it has no `automate`). Under the opt-in default the change flips no ticket's eligibility.

## 2. OUT OF SCOPE

- **Any active "paused, revisit later" surfacing.** A resurfacing reminder for held work is an operator's own concern (a local label / their own tracking), never a faff-maintained marker.
- **The `repeat-parked` verdict token.** FAFF-1092 already retired the *label* while keeping the *verdict*; this ticket touches neither.
- **Renaming or reshaping the `automate` label.** It stays tracker-owned and human-set, now the sole eligibility signal.
- **Historical records.** ADRs (`records/adr/*`), shipped specs (`records/specs/*`), spikes, and existing `CHANGELOG.md` / audit entries that mention `automation-hold` are historical and are left as written.

## 3. WHAT — the eligibility model, after this change

Per the operator decision (2026-09-24), git-only defaults opt-in like a tracker: one eligibility model everywhere. Eligibility is `automate` present → eligible, absent → not eligible, in every mode. The `automation_default: opt-out` option and the FAFF-753 git-only opt-out are removed. There is no second eligibility mode and no per-ticket exclude label.

```
FUNCTION automationEligible(labels, automationDefault, trackerPresent) -> Boolean:
  RETURN labels contains "faff-automate"          # the sole positive signal
```

The `automation-hold` hard-exclude branch and the opt-out/git-only default branch are both deleted. The function keeps its **exact 3-argument positional signature** — decision-capture's KERNEL_REGISTRY `eligible` contract (`required_inputs: [labels, automationDefault, trackerPresent]`) and shadow-fidelity's structural signature introspection depend on it.

`CONTROL_LABEL_DEFS` drops the `automation-hold` entry. Surviving roles: `automate`, `parked`, `awaiting-review`, `awaiting-spec-review`, `claimed`, `awaiting-adjudication`, `stacked`. `automate` remains the sole `tracker_owned: true` entry.

## 4. HOW — Behavior

Mirror the FAFF-1092 diff shape: one small pure-code change per lib file with its co-located selftest cases updated in the same edit, then a prose sweep.

- **labels.js** — delete the `automation-hold` `CONTROL_LABEL_DEFS` entry; remove `<prefix>-automation-hold` from both `LABELS_SELFTEST_CASES` arrays.
- **eligible.js** — `automationEligible` returns `automate`-present only; delete the hold and opt-out branches; keep the 3-arg signature. Drop hold handling in `normalizeEligibilityLabels`. Update `ELIGIBLE_CASES` / `ELIGIBLE_PREFIX_CASES` (remove hold + opt-out rows).
- **config** — remove the `automation_default` key / opt-out value and the FAFF-753 git-only opt-out (config default, writable-namespace, selftests, config-check Check 7).
- **label.js** — remove the two `automation-hold` refusal selftest rows; keep the `automate` `tracker_owned` refusal rows.
- **Prose sweep** — remove/repoint `faff-automation-hold` + `automation_default` opt-out across active SKILL prose + references (autonomous/build/kernel/methodology/tracker/prep/graft/beep-boop/wtf), jot hold/unhold, tidy hard-stop, and the `state.js` comment. Leave historical records/ADRs untouched.

## 5. Scenarios

```
Given CONTROL_LABEL_DEFS with the automation-hold entry removed
When `faff labels --selftest` runs
Then the labels selftest passes and neither expected-name array contains "<prefix>-automation-hold"
```

```
Given a ticket carrying only faff-automate
When `faff eligible --label faff-automate` runs
Then it prints "true"
```

```
Given a previously-held ticket (no faff-automate)
When `faff eligible` runs
Then it prints "false" — the same eligibility (not automated) it resolved to while held
```

- The active-surface grep `grep -rn "automation-hold" plugin/skills bin` (excluding `records/`) returns zero hits after the sweep.

## 8. DONE — Definition of Done

- [ ] `CONTROL_LABEL_DEFS` has no `automation-hold` role; `faff labels --selftest` passes.
- [ ] `automationEligible` resolves from `automate` alone; no `automation-hold`/opt-out branch remains; the 3-arg signature is unchanged; `faff eligible --selftest` passes.
- [ ] The `automation-hold` refusal rows are removed from `LABEL_SELFTEST_CASES`; the `automate` `tracker_owned` refusal rows remain and pass.
- [ ] `automation_default` opt-out and the FAFF-753 git-only opt-out are removed (config + selftests).
- [ ] `/faff-jot` hold/unhold, `/faff-tidy` hard-stop, and the `faff-automation-hold` mentions across active SKILL prose + references are removed or repointed; `state.js` comment updated.
- [ ] `grep -rn "automation-hold" plugin/skills bin` (excluding `records/`) returns zero hits.
- [ ] The `## Decisions-register intent` from the decision comment is materialised into `docs/decisions.md`.
- [ ] Historical records (`records/*`, existing `CHANGELOG`/audit entries) are untouched.

confidence: high
build-tier: complex
