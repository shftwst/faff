# FAFF-682 — Reword `unowned-sibling-mutation` to drop its accusatory framing

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high · build-tier: standard. Full spec on Linear FAFF-682.

confidence: high
spec-review: approve

## Why

`reconcileSibling` in `plugin/skills/faff/bin/lib/reconcile.js` raises an `unowned-sibling-mutation` divergence whenever a spec-referenced, non-admitted sibling flips into a terminal state during the run's window. It classifies on three booleans only — `{start_state_terminal, end_state_terminal, admitted}` — with **no actor field**, because Linear exposes no actor on a state transition (`stateHistory` gives `{state, startedAt, endedAt}` and nothing more; this is the same gap FAFF-216 is parked on, re-verified against the live MCP).

The current framing *asserts the run did it*. The code comment reads "out-of-mandate mutation — the run never claimed ownership of it, so nothing it did to that issue is accountable", and the human-facing `detail` string is what surfaces at an L4 `needs-human` escalation. But a sibling can legitimately flip terminal for reasons that have nothing to do with this run:

- a **parallel beep-boop run** admits, builds and closes it (FAFF-82's `claimed-by-peer` deliberately keeps it out of *this* run's `admitted`, which is the very condition — `!admitted` — the rule reads as "we had no business touching this"); or
- a **human closes it mid-run** — which the gateway explicitly *invites* ("Human curation is authoritative", "Tracker as the lights-out control plane"): editing the board is how you steer an in-flight run.

In both cases the run did nothing wrong, yet at L4 the divergence escalates a clean run to `needs-human` with an *allegation* rather than a *fact*. **A human has resolved the design question on the ticket: "Chosen 'Reword'"** (alec, 2026-08-17T21:18) — pick the ticket's "Reword, do not repair" option over shipping timestamp-correlation as a heuristic. This spec implements that resolution.

## What

Reword the divergence so it states only what the run can prove — *a spec-referenced sibling moved terminal during this run's window; this run cannot say by whom* — without changing any classification behaviour.

**Chosen:** Reword, do not repair — the human-selected option. Drop the accusatory language from the `unowned-sibling-mutation` divergence's human-facing `detail` string and its code comment so neither asserts the run caused the transition. **Do not** ship timestamp-correlation (a run knows its own window and calls, so a sibling that flipped while the run made no call is *probably* someone else's — but that is inference wearing a gate's clothes, against faff's posture that a gate asserts what it can prove). *Rationale:* honest signal at zero behavioural risk; the actor gap cannot be closed by adding a field because no such field exists.

**Chosen:** Keep the class identifier `unowned-sibling-mutation` unchanged; reword only the `detail` string and the preceding comment. *Rationale:* the id is a stable token threaded through `DIVERGENCE_CLASSES`, the sentry structural-guard test (`test/sentry.test.mjs:1253`, ADR 0034 — asserts the three class-name strings never reference `owner`/heartbeat fields), the reconcile node-tests, ADR 0056, `docs/guide/cli.md`, and `faff-beep-boop`'s Step-11 prose. The accusation lives in the `detail` (what a human reads at escalation) and the comment, not in the token — so rewording those is the cheapest honest fix; renaming the id would be disproportionate churn and risks the structural guard for no signal gain.

**Chosen:** Update the two *current* human-facing echoes of the old `detail` so the rendered examples stay truthful — `plugin/skills/faff-beep-boop/SKILL.md` (Step-11 example line) and `docs/guide/cli.md` (the `unowned-sibling-mutation` class description). Leave all `records/specs/*` and `records/adr/*` untouched — they are historical records under the wording used when written (AGENTS.md house rule).

**Assumes:** The disposition semantics are unchanged — a divergence is still level-gated `warn` at ≤L3 and `needs-human` at L4 (`reconcileCore`), and the trigger is still the same three booleans. This is a wording change only; no fixture's `consistent`/`disposition`/`divergenceClasses` expectations move.

**Punt:** Whether the divergence should *also* compose with FAFF-82's `claimed-by-peer` disposition — excluding a sibling the run saw claimed-by-peer from the sibling set at assembly, which would catch the parallel-run case without an actor — is **out of scope** for this reword. It is a sibling-set *assembly* change in `faff-beep-boop` Step 11 (not `reconcile.js`), it only addresses the parallel-run half (the human-editor half remains), and the human's "Reword" resolution settled the framing question, not this composition. Recorded as a future refinement; do not block this slice on it.

### Suggested reworded text (illustrative, not binding on exact prose)

- `detail`: `"a spec-referenced non-admitted sibling moved to a terminal state during the run's window; this run cannot attribute the change to any actor (no transition actor is available)"`
- comment above `reconcileSibling`: replace "out-of-mandate mutation — the run never claimed ownership of it, so nothing it did to that issue is accountable" with a neutral statement that the sibling moved terminal inside the run's window, the run never admitted it, and attribution is unavailable, so the class reports the *fact* of an unattributable terminal move — not a claim the run caused it.

## How

1. **`reconcileSibling` (`reconcile.js` ~L93–107).** Reword the block comment (L93–96) to drop "out-of-mandate mutation" / "nothing it did … is accountable"; reword the returned `detail` string (L101) to the non-accusatory "cannot say by whom" framing. Leave the guard condition, `class`, `issue`, and `rollback_proposal` exactly as they are.
2. **`reconcileSiblingBaseline` (`reconcile.js` ~L123).** Its `detail` names "the unowned-sibling-mutation check" — this *names* the check, it does not accuse, and the id is unchanged, so leave it. (Call it out in review so the choice is deliberate.)
3. **Downstream echoes.** Update the old-`detail` quotation in `plugin/skills/faff-beep-boop/SKILL.md` (Step-11 example) and the class description in `docs/guide/cli.md` to match the reworded `detail`. No other file quotes the string.
4. **Selftest / node-tests.** No fixture changes required — `RECONCILE_SELFTEST_CASES` and `test/reconcile.test.mjs` assert on `class` ids, `consistent`, and `disposition`, never on `detail` text. Run `node plugin/skills/faff/bin/faff reconcile --selftest` and `node --test test/reconcile.test.mjs test/sentry.test.mjs` to confirm all green after the reword.

## Done (acceptance criteria)

- [ ] The `unowned-sibling-mutation` `detail` string no longer asserts the run caused the transition; it states an unattributable terminal move within the run's window ("cannot say by whom").
- [ ] The comment above `reconcileSibling` no longer contains "out-of-mandate mutation" or "nothing it did to that issue is accountable" (or equivalent run-blaming language).
- [ ] The class id `unowned-sibling-mutation` and `DIVERGENCE_CLASSES` are unchanged; the guard condition and disposition/level-gating are unchanged.
- [ ] No timestamp-correlation (or any inference-based attribution) heuristic is added.
- [ ] `faff reconcile --selftest` exits 0, and `node --test test/reconcile.test.mjs test/sentry.test.mjs` passes (the sentry structural guard at `sentry.test.mjs:1253` stays green because the class-name strings are unchanged).
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` and `docs/guide/cli.md` quote the reworded `detail`; no `records/specs/*` or `records/adr/*` file is modified.

## Methodology critique

*Lens: agile-delivery (`faffter-dark-methodology-agile-delivery`), issue-critique. Non-blocking (autonomous prep).*

- **Right-sized?** Yes. A single, coherent <1-day unit: a two-string reword in one function plus two downstream prose echoes, no behavioural change. Not splittable, not a merge candidate.
- **Workstream fit?** Fits the run-end reconcile / ground-truth workstream (FAFF-397/680/82 cluster); outcome-named and cohesive.
- **Deps surfaced?** The one implicit dependency — the FAFF-82 `claimed-by-peer` composition — is surfaced explicitly as an out-of-scope Punt rather than an unlinked assumption. No blocker link needed.
- **Risk profile?** Low. No new integration, no external dependency, no schema/behaviour change; the selftest + structural guard bound the blast radius. No de-risking spike warranted.

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"punt"}]}
```
