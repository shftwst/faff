# Spec — FAFF-1091: Configure control-label names per role (full name), not just a prefix

> Spec: faffter-dark-nlspec · 2026-09-24 · autonomous · claude-code/unknown · confidence: high (re-rated from medium after the operator ratification comment closed all three Punts). Full spec on Linear FAFF-1091.
> build-tier: standard
> Reprepped 2026-09-24 — replaces the prior (stale) spec written on the obsolete two-group / eligibility-clear-then-add model. This fresh spec targets the reshaped single-standalone-`automate` + single `state`-group model against current `origin/main` (blockers FAFF-1092 and FAFF-1097 both landed). The three open Punts are RESOLVED by operator decision comment a9a52d79 (2026-09-24): `stacked` ungrouped, one permissive name validator, built-in grouping.

## 1. WHY — Problem and Principles

FAFF-1044 already split a control label into a `role` (the stable, prefix-independent identity every code path keys off) and a `name` (the string rendered into the tracker, today always `<prefix>-<role>`). This ticket adds a second, higher-precedence source for the `name` — an optional per-role override map in config — while leaving `role` as the sole identity. It also teaches the machine-managed **state group** to clear-then-add in order, via a real CLI verb, so a single-select tracker group never rejects or transiently double-holds.

**Current role set (`origin/main`, 7 roles).** `CONTROL_LABEL_DEFS` in `plugin/skills/faff/bin/lib/labels.js` holds: `automate` (the sole `tracker_owned` eligibility signal), `parked`, `awaiting-review`, `awaiting-spec-review`, `claimed`, `awaiting-adjudication`, `stacked`. Iterate over `CONTROL_LABEL_DEFS`, never a hardcoded list.

**Design principles.**
- Purity is preserved: `controlLabels`, `labelOp`, and the new `groupTransitionOps` stay pure; the override map is resolved by the command layer and threaded in.
- Role is the only identity: the `tracker_owned` refusal predicate and every read-site key off `role`.
- Fail loud, never half-valid: a malformed override fails at read and at write with a named error.
- Zero-config is byte-identical.

## 2. OUT OF SCOPE

- Onboarding discovery/offer of these names (plain config, not an onboard step).
- Migration of live tickets when a name changes.
- Regrouping roles by config (group membership overridable) — built-in `state` grouping only.
- An eligibility group / eligibility clear-then-add — deliberately gone. `automate` is a single standalone label.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Config surface.**

```yaml
tracking:
  label_prefix: faff            # unchanged default
  control_labels:               # OPTIONAL per-role full-name overrides (nested map of scalars)
    automate: "someprefix-some-value"
    parked: "State: Parked"
```

**`automate` — a single standalone label, never faff-managed.** Tracker-owned (human-set): presence = eligible, absence = not. faff never adds or removes it, so there is no eligibility clear-then-add and no fail-open risk.

**`CONTROL_LABEL_DEFS` — a `group` field per entry.** `state` for `parked`/`awaiting-review`/`awaiting-spec-review`/`claimed`/`awaiting-adjudication`; `null` for `automate` and `stacked` (RATIFIED ungrouped, comment a9a52d79).

**Pure factory:** `controlLabels(prefix = "faff", names = {})` renders `names[role] ?? \`${prefix}-${role}\`` per entry.

**Pure mutation-op emitter:** `labelOp({ action, issue, label, present, prefix, names })` — finds by rendered name (threaded `names` so a renamed label is FOUND and REFUSED, not REJECTED).

**Pure clear-then-add emitter:** `groupTransitionOps({ targetRole, present, prefix, names })` — emits every same-group remove FIRST then the target add; an ungrouped target emits a plain add with no clears; an unknown role rejects.

**New CLI verb** `faff label transition <issue> <target-role> [--present-label L ...]` — emits one ordered remove-then-add contract; takes a TARGET-ROLE (role is the identity — the verb renders the name).

**Name resolution channel:** `resolveControlLabels(root, data)` -> `{ names } | { error }`, sibling of `resolveLabelPrefix`.

**Permissive validator:** `validateControlLabelName(key, value)` — rejects only empty/whitespace-only and control chars/newlines (RATIFIED single permissive validator, comment a9a52d79); NOT `LABEL_PREFIX_RE`. Wired into the get-side and set-side chains keyed on `tracking.control_labels.*`.

## 4. HOW — Behaviour

Read-sites that reconstruct `${prefix}-<role>` must use the resolved name: `eligible.js normalizeEligibilityLabels` (the automate-name fix lives here; `automationEligible`'s 3-arg signature is FROZEN), `next.js renderNextReason`, `intake-provenance.js intakeVerdict`. Each takes the resolved name as an argument threaded by the command layer; none reads config.

A state transition removes any other `state`-group label before adding the target, via the `faff label transition` verb the state-writing sites (faff-graft park/claim/hold, faff-tidy stale sweep) call.

Config write of incremental sibling leaves works without `--force` (verified on `origin/main`); `mergeConfigPath` is unchanged.

## 5. Scenarios

```
Given tracking.control_labels is unset and label_prefix is default
When controlLabels() is called
Then it returns byte-identical names to today and LABELS_SELFTEST_CASES passes unchanged
```

```
Given tracking.control_labels.parked is "State: Parked"
When controlLabels(prefix, names) renders the manifest
Then the parked entry's name is "State: Parked" while every unset role stays faff-<role>
```

```
Given tracking.control_labels.automate is "Some group: eligible"
When labelOp attempts to add or remove that label (threaded the same names)
Then it is refused (not rejected), keyed off the role-derived tracker_owned flag
```

```
Given an issue carrying parked and a transition to claimed
When `faff label transition <issue> claimed --present-label <parkedName>` emits ops
Then it emits removeOp(parkedName) BEFORE addOp(claimedName) as one ordered contract
```

```
Given an issue carrying awaiting-review and a transition to stacked (ungrouped)
When `faff label transition <issue> stacked` emits ops
Then it emits a plain addOp(stackedName) with NO clears
```

```
Given tracking.control_labels.automate is set and label_prefix is default
When cmdEligible resolves eligibility on a ticket carrying only a STALE literal "faff-automate"
Then the ticket resolves NOT eligible — the stale literal must never fail OPEN as still-eligible
```

## 8. DONE — Definition of Done

- [ ] `CONTROL_LABEL_DEFS` entries carry a `group` field (`state`/null); iteration is over `CONTROL_LABEL_DEFS`.
- [ ] `controlLabels(prefix, names)` renders `names[role] ?? \`${prefix}-${role}\``; color/tracker_owned/description/role/group pass through unchanged.
- [ ] `resolveControlLabels(root, data)` returns `{ names }` / `{ error }`.
- [ ] `validateControlLabelName` accepts grouped/colon names; rejects empty/whitespace and control chars; wired into get + set chains.
- [ ] Zero-config byte-identical; `LABELS_SELFTEST_CASES` passes unchanged.
- [ ] `labelOp` threaded `names`: finds a renamed label and refuses the tracker_owned `automate`.
- [ ] `eligible.js`/`next.js`/`intake-provenance.js` resolve the automate name from the override map; none reads config; `automationEligible`'s 3-arg signature unchanged.
- [ ] `groupTransitionOps` emits removes-then-add; ungrouped target (automate, stacked) is a plain add; unknown role rejects; a dedicated selftest table covers ordering + ungrouped + reject.
- [ ] Eligibility fail-open mirror: with an override, a stale literal `faff-automate` resolves NOT eligible.
- [ ] `faff label transition` verb emits the ordered contract; state-writing prose calls it.
- [ ] `faff config set tracking.control_labels.<role>` writes each leaf; a second leaf appends a sibling without `--force`.
- [ ] Malformed override fails loud at read and write.
- [ ] Decisions-register intent materialised into docs/decisions.md.

## Decisions-register intent

- **topic:** control-label group membership and name validation
- **Chosen:** `stacked` ungrouped; one permissive control-label-name validator; group membership built-in (not config-overridable).
- **Rationale:** the only single-select group is `state`; `stacked` must coexist with state labels; keep the config surface minimal.
- **Scope:** FAFF-1091 control-label naming/grouping — `labels.js` (`controlLabels`, `groupTransitionOps`), the new `resolveControlLabels`/`validateControlLabelName`.
- **Matches:** control-label groups, label name validation, stacked grouping.

---

confidence: high
spec-review: approve
build-tier: standard
