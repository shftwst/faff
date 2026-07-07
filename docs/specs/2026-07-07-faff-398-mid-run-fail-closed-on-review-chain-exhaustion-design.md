# Spec — FAFF-398: Mid-run fail-closed on review-chain exhaustion

> Spec: faffter-dark-nlspec · 2026-07-07 · interactive · confidence: high
> (spec-review: approve — architectural / infosec / QA; `revise` → resolved, re-review approved)

## 1. WHY

On a lights-out (L4) run, when a **mandatory** adversarial review has its entire backend fallback chain exhausted (all-unreachable, exit `5`; or deadline exhaustion, exit `8`), `review-call.mjs` returns a code the slot maps to `pass` + a loud skip — so the L4 second-opinion gate silently no-ops on an outage and the PR auto-merges with no second opinion (recurred: all four merges in run-140848; `design/portable-runtime.md`). Fail that case **closed → `needs-human`** on the mandatory path only; advisory (L1–L3) stays at today's pass+skip.

**Principles** (reject an implementation that violates any):
1. **One decision home** — the mandatory-vs-advisory fail-direction is a deterministic, unit-tested seam in `review-call.mjs`, never interpretable `SKILL.md` prose.
2. **No advisory regression** — flag absent ⇒ today's behaviour, byte-for-byte.
3. **No silent weakening** — config-fault classes (2/4/6/7) already map to needs-human; the remap must not weaken *or upgrade/mask* them.
4. **The helper stays level-agnostic** — `review-call.mjs` knows only "mandatory / not", never "L4" or the ledger.

**Files:** `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` (`EXIT`, `chainTerminalExit`, `runReviewChain`, `main`); its `SKILL.md` (exit table); `test/adversarial-call.test.mjs`; `plugin/skills/faff/bin/faff` (`dialCoherence`, `decideFloor` — read-only context); `plugin/skills/faff-graft/SKILL.md` (forwards `autonomous`+`lights_out`).

## 2. OUT OF SCOPE

- **faff-graft Step 10 / `faff merge-gate` / `decideFloor`** — `signal: needs-human` already auto-parks via `decideFloor` (`review_verdict !== "pass"`). No graft/merge-gate edit.
- **FAFF-395 run-start reachability preflight** — the launch-time complement; this is the mid-run complement.
- **FAFF-297 critical-finding escalation** — the *findings* path (exit 0); this governs the *no-findings* terminal (5/8). Mutually exclusive.
- **FAFF-232 per-failure-class advance rules** — only the all-exhausted terminal changes; `mapResultExit` + advance loop untouched.
- **A new required/advisory config knob** — `lights_out` (L4) is the proxy for "mandatory".

## 3. WHAT

- **Mandatory review ≡ `lights_out` (L4)** — `dialCoherence` already refuses an L4 run whose `slots.review` is not adversarial, so at L4 the second opinion is *structurally* required. Resolves, for the review slot, the mandatory-vs-advisory question shared with FAFF-395.
- **No-opinion classes:** `UNREACHABLE` (5), `DEADLINE` (8) — today advisory pass+skip.
- **Config-fault classes:** `USAGE` (2), `NOT_SERVED` (4), `DEFAULT_HOST_UNREACHABLE` (6), `AUTH` (7) — already needs-human, unchanged.
- **New exit** `EXIT.MANDATORY_OUTAGE` (= 9) — the slot maps it → `signal: needs-human`.
- **New param** — a `mandatory` boolean: CLI flag `--lights-out` (presence ⇒ true, absent ⇒ false default), consumed in `main()`.
- **Chosen:** `--lights-out` boolean presence flag; the slot owns the L4→flag translation, the helper stays level-agnostic.

## 4. HOW (single-chokepoint remap)

One pure `mandatoryRemap(exit, mandatory)`: if not mandatory → `exit` unchanged; if `exit` is `UNREACHABLE` or `DEADLINE` → `MANDATORY_OUTAGE`; else unchanged (config-fault classes and OK pass through). Applied **exactly once in `main()`** on the final `res.exit` returned by `runReviewChain` — before the terminal-log branch and before the process exit is set: `finalExit = mandatoryRemap(res.exit, a.mandatory)`.

`runReviewChain` stays **level-agnostic** — it never learns `mandatory` and returns the raw availability/deadline class exactly as today (5 on all-unreachable; 8 at each of the three DEADLINE loci incl. the mid-call race; a config-fault class when one dominates). Because every exhaustion path funnels through `res.exit`, one remap covers them all — **miss-proof by construction** — and both invocation forms (single-backend flags = 1-element chain; `--backends-json`) funnel through the same `main()` boundary. `parseArgs` collects `--lights-out` → `a.mandatory`; `main`'s terminal-log branch gains a distinct loud `MANDATORY_OUTAGE` arm (a needs-human terminal, not a skip).

**Anti-patterns:** (a) applying the remap *inside* `runReviewChain` at the four terminal returns — reintroduces the "miss a locus" failure mode and forces the helper to learn `mandatory`; (b) editing `chainTerminalExit` alone (never sees the DEADLINE path); (c) teaching `review-call.mjs` about "L4"/the ledger.

**Slot side (`SKILL.md`):** the exit-code→signal table gains a `MANDATORY_OUTAGE` row → autonomous `needs-human`, `adversarial_outcome: "mandatory-chain-outage"`; interactive not-reachable. The slot passes `--lights-out` iff its forwarded `lights_out` context is true; unresolved/absent ⇒ omit (fail-safe advisory), like the existing `autonomous` fail-safe. On `MANDATORY_OUTAGE` the slot authors `signal: needs-human` with one finding naming the outage. Advisory exit 5/8 stay pass+skip; the existing `chain-outage-skipped` annotation untouched.

## 5. SCENARIOS (born-verifiable, test/adversarial-call.test.mjs)

Pure unit (exhaustive — the chokepoint makes these sufficient):
- `mandatoryRemap(UNREACHABLE, true) === MANDATORY_OUTAGE`; `mandatoryRemap(DEADLINE, true) === MANDATORY_OUTAGE`
- `mandatoryRemap(<each config-fault 2/4/6/7>, true) === that class` (unchanged); `mandatoryRemap(OK, true) === OK`; `mandatoryRemap(<any>, false) === <any>`

`runReviewChain` raw class (no regression — guards the "5/8 reaches main()" premise):
- all-UNREACHABLE chain → 5; DEADLINE via injected-clock gate → 8; **DEADLINE via mid-call race (slow backend resolving after the deadline, real-timer shape) → 8**; config-fault dominates → that class

`main()`/integration (flag → remapped process exit):
- `--lights-out` + all-UNREACHABLE → `MANDATORY_OUTAGE`; + DEADLINE (either locus) → `MANDATORY_OUTAGE`; + served fallback → `OK` (0); no flag + all-UNREACHABLE → `UNREACHABLE` (5)
- `parseArgs(["--lights-out"]).mandatory === true`; absent ⇒ falsy

Slot-level (SKILL.md conformance): the slot emits `--lights-out` iff forwarded `lights_out` is true; unresolved ⇒ advisory.

## 6. RATIONALE (Chosen)

- Deterministic `review-call.mjs` seam over prose (deterministic-tools tenet).
- Both `UNREACHABLE` and `DEADLINE` fail closed (both = no second opinion; L4 has no morning human). Config-fault classes stay as-is.
- Mandatory ≡ `lights_out` (`dialCoherence` already requires adversarial at L4); no new knob.
- The `autonomous`-vs-`lights_out` asymmetry is **intentional**: a Phase-2 `critical` finding is a real defect that must stop any unattended merge (FAFF-297 keys off `autonomous`); a chain *outage* is infra — an L3 overnight run has a morning human the brief surfaces the gap to, an L4 run has none, so outage fails closed only at L4.
- `--lights-out` matches the forwarded context 1:1 (denotes "mandatory second opinion").
- `review_adversarial_skipped` needs no change — a parked (needs-human) issue never reaches `shipped`, so the skip-annotation is naturally not applied.

## 7. OPEN QUESTIONS / ASSUMPTIONS

- **Punt:** numeric value of `EXIT.MANDATORY_OUTAGE` — **resolved to 9** at build (next free after 0–8; no external consumer keys off a specific value).
- **Punt:** the review-progress checkpoint `--phase2` status token for this terminal — a terminal needs-human, NOT a skip, so it must **not** write `--phase2 skipped_unreachable`; settle the exact token at build (the graft-side review checkpoint wiring is where this lands).
- **Assumes (accepted residual — infosec):** the seam is deterministic, but its *activation* rides one prose→flag hop — graft forwards `lights_out` as prose and the slot translates it to `--lights-out`. Accepted residual (matches the `autonomous` precedent), guarded by the slot-level AC, strictly better than today (no fail-closed mechanism exists at all now). **Follow-up (out of scope, ticket-worthy):** derive the flag through a channel the slot's Bash reads mechanically, removing the last non-deterministic hop.
- **Assumes:** `dialCoherence` keeps refusing an L4 run whose `slots.review` isn't adversarial (re-verify before build).
- **Assumes:** FAFF-232 advance rules + `mapResultExit` unchanged (confirm no such edits in the diff).

## 8. DONE — see the issue's tracker spec for the full DoD checklist.

confidence: high
