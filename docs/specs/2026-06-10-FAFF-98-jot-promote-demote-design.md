# Spec — Rename /faff-jot freeze/thaw → promote/demote over `faff-automate`

> _Spec · producer: faffter-dark-nlspec · adaptor: faffidavit-spec · 2026-06-10 · mode: interactive · confidence: high_

Follow-up to FAFF-61 (shipped): re-point `/faff-jot`'s existing-ticket interactor from hold-based freeze/thaw onto the `faff-automate` eligibility model, keeping `faff-automation-hold` as the hard-stop. Single-file prose change (`skills/faff-jot/SKILL.md`).

## 1. WHY
FAFF-61 inverted eligibility to opt-in (`faff-automate` includes; `faff-automation-hold` hard-excludes; unlabelled follows `automation_default`) but left jot's interactor on the old freeze/thaw of the hold. Under opt-in, "thaw" (remove hold) no longer makes a ticket automatable — it still lacks `faff-automate`. Re-point the interactor onto `faff-automate` (promote/demote); keep the hold as an explicit hard-stop.

**Principles.** Match the gateway contract (→ Automation eligibility → Release/blessing), don't re-decide it. Interactive-only, human-gated, never auto-bless. The hard-stop (`faff-automation-hold`) must stay reachable via jot.

## 2. OUT OF SCOPE
- Re-scope / re-home / split-merge intent (already-deferred jot directions).
- Behavioural test harness for the interactor (FAFF-88→97).
- tidy/wtf wording (already updated by FAFF-61).
- The CLI/gateway eligibility model (shipped FAFF-61).

## 3. WHAT — menu (keyed on eligibility, not hold-state)
```
eligible = faff eligible --label <each label> --default <automation_default>
held = ticket carries faff-automation-hold
MENU:
  IF held:        offer "unhold" (remove faff-automation-hold) — hold overrides faff-automate
  ELIF eligible:  offer "demote" (remove faff-automate); offer "hold" (hard-stop)
  ELSE:           offer "promote" (add faff-automate); offer "hold" (pre-emptive hard-stop)
```
- **Chosen:** menu keys on eligibility (`faff eligible`), not hold-state.
- **Chosen:** promote = add `faff-automate`; demote = remove it (ensure-label-exists first).
- **Chosen:** keep an explicit hold/unhold control — the hold is the only hard-exclude.
- **Chosen:** precedence-aware UX — a held ticket is offered unhold, not a silent no-op promote.

## 4. HOW
```
act(choice): promote→ensure+add faff-automate; demote→remove faff-automate;
             hold→ensure+add faff-automation-hold; unhold→remove faff-automation-hold; log each.
```
Edge cases (no-op + inform): promote-already-eligible / demote-unlabelled / hold-already-held / unhold-never-held.
**Anti-pattern:** offering promote on a held ticket (hold wins → silent no-op). **Anti-pattern:** auto-bless in any autonomous path.
Relationship-to-tidy prose updated: jot "promote/demote", tidy §4a "bless" — same `faff-automate` primitive; hold is the shared hard-stop.

## 5. RATIONALE
- Key on eligibility not hold-state — opt-in makes "not held" ≠ "automatable". **Chosen:** eligibility.
- promote/demote = add/remove `faff-automate`. **Chosen.**
- Keep hold/unhold in jot. **Chosen** (only hard-exclude).
- Held ticket the human tries to promote → offer unhold + state precedence. **Chosen.**

## 6. OPEN QUESTIONS / ASSUMPTIONS
Open: none.
- **Assumes:** FAFF-61 (`faff-automate` + `faff eligible` + gateway contract) on main. Validate: `faff labels --names` lists `faff-automate`; `faff eligible --label faff-automate --default opt-in` → true.
- **Assumes:** ensure-before-tag rule present (gateway → Control-label provisioning).

## 7. DONE
- [ ] Interactor no longer keys on hold-state; resolves eligibility first (no "not held → freeze"/"held → thaw" menu).
- [ ] promote (add faff-automate) when not eligible; demote (remove) when eligible.
- [ ] hold/unhold (faff-automation-hold) retained as hard-stop, not primary toggle.
- [ ] Held ticket offered unhold not promote, precedence stated.
- [ ] Edge cases documented (no-op + inform).
- [ ] Frontmatter L3 + L14/32/84 + autonomous note updated freeze/thaw → promote/demote.
- [ ] Relationship-to-tidy paragraph updated; no dangling thaw/lift-the-hold wording.
- [ ] `faff labels --names` includes faff-automate + faff-automation-hold; `validate-adapters` passes.

Smoke test (inspection): read the interactor — menu resolves `faff eligible`, branches held/eligible/neither; promote/demote→faff-automate, hold/unhold→faff-automation-hold; `grep -i "freeze\|thaw"` finds only historical mentions, not the live menu.

confidence: high
