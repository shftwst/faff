# FAFF-525 — Corrective-integrity preflight stops coercing a lying `FAFF_INTEGRITY_BOUNDARY`

> Spec: faffter-dark-nlspec · 2026-07-18 · autonomous · confidence: high · spec-review: approve. Full spec on Linear FAFF-525.

This spec is for the build agent implementing FAFF-525 and the human reviewers gating it. It changes exactly one leg of the L4 lights-out admission preflight (`lights-out.js`) so that the honest *absence* of a mount declaration no longer forces the operator to fabricate one. It is a small, surgical integrity-model correction — no new module, no new contract, no architectural change.

## 1. WHY — Problem and Principles

**Load-bearing model.** The L4 preflight's `corrective-integrity` leg gates admission on a single string, `probes.correctiveIntegrityBasis`, which is the `.basis` of one `correctiveIntegrityProbe` call. That probe returns `asserted:true` **purely from a pid-1 `FAFF_INTEGRITY_BOUNDARY` declaration** — it trusts the outer layer's claim, it never verifies the mount exists (ADR-0061 *assert-don't-implement*). So the *declaration* and the *real mount* are two independent facts, and today's gate conflates them: it refuses on `no-declaration` and directs the operator to set the declaration — but the cage cannot enforce the matching mount yet (FAFF-517 deferred). Setting the declaration to clear the gate therefore makes the probe assert `true` on a claim that is false — the exact lying attestation ADR-0061 exists to forbid.

**Problem statement.** Today `faff lights-out --check` hard-refuses admission when no `FAFF_INTEGRITY_BOUNDARY` is declared, and the only way to clear that refusal is to declare a boundary the cage does not actually mount. That coerces a false attestation. This change downgrades the honest `no-declaration` absence to an advisory warning — because a real, mount-free integrity floor (the FAFF-518 digest custody bracket) is now unconditionally active on every L4 run — while leaving every genuine *violation* basis a hard refusal.

**Design principles.**

- **Never coerce a lie to pass a gate.** A truthful softer basis (digest custody, active by contract) beats a false hard one (a fabricated mount). This is the integrity model asserting itself, not a weakening of it — the governing principle the ticket states.
- **Absence is not violation.** `no-declaration` is the honest "nothing was mounted/declared" case; `env-injection` / `malformed` / `dir-mismatch` are tamper-or-misconfiguration evidence. The former may degrade to advisory; the latter must always refuse. This distinction already exists in the code (`VIOLATION_BASES`) and this change must not blur it.
- **The strongest basis is unchanged.** When FAFF-517 lands and a genuine mount is declared, `asserted` remains the strongest basis and admits exactly as today. This change touches only the `no-declaration` branch.

**Scope statement.** This is the FAFF-520 open-question-#2 follow-on, scoped to the **lights-out preflight admission leg only** — not the merge-floor consumer, not a new `integrityGate` basis.

## 2. OUT OF SCOPE

- A digest-verdict `integrityGate` basis (Option 1's "plumbing") — no run-dir/verdict exists at admission time; home is merge-floor `resolveIntegrity`. Tracked as the Punt.
- The real read-only mount (FAFF-517) — deferred.
- The merge-floor / `cmdMergeGate` behaviour — unchanged.
- Any change to `correctiveIntegrityProbe` / `integrityGate` / `VIOLATION_BASES` — consumed as-is.

## 4. HOW — Behavior

Split the current single `no-declaration` refusal into: (a) an advisory `degrades` push for `no-declaration`, (b) an unchanged `refusals` push for the violation bases. The probe wiring in `assembleLightsOutPreflight` is untouched.

- `no-declaration` → `degrades.push({gate:"corrective-integrity", detail: names FAFF-518 digest floor + FAFF-520 obligation 5 + points at `faff integrity-boundary` / FAFF-517 for the stronger future basis})`
- violation basis (`env-injection`/`malformed`/`dir-mismatch`) → `refusals.push` naming that basis — unchanged.
- `asserted` (or absent) → no entry — unchanged.

Because `proceed` is `false` iff `refusals` is non-empty, a run whose only corrective-integrity signal is `no-declaration` now proceeds (advisory printed); a violation still blocks.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 lights-out preflight with the digest guard active and NO FAFF_INTEGRITY_BOUNDARY declared (basis "no-declaration")
When faff lights-out --check runs the corrective-integrity leg
Then admission is NOT refused on corrective-integrity — proceed is true (absent other refusals) and a corrective-integrity entry appears in degrades, not refusals
```

```
Given an L4 lights-out preflight whose corrective-integrity basis is a violation basis (env-injection, malformed, or dir-mismatch)
When faff lights-out --check runs the corrective-integrity leg
Then admission IS refused — a corrective-integrity refusal naming that basis is present, exactly as before this change
```

## 8. DONE — Definition of Done

- [ ] With the digest guard active (any L4 run) and no `FAFF_INTEGRITY_BOUNDARY`, `faff lights-out --check` does NOT hard-refuse on corrective-integrity.
- [ ] Setting a false `FAFF_INTEGRITY_BOUNDARY` is never required to launch.
- [ ] `no-declaration` basis pushes a `corrective-integrity` entry to `degrades` (advisory), not `refusals`.
- [ ] The advisory detail names the FAFF-518 digest floor and points at `faff integrity-boundary` / FAFF-517.
- [ ] A violation basis still pushes a `corrective-integrity` refusal naming that basis — unchanged.
- [ ] The `asserted` basis produces no corrective-integrity entry in either array — unchanged.
- [ ] No change to `correctiveIntegrityProbe`, `integrityGate`, `VIOLATION_BASES`, or `assembleLightsOutPreflight`'s probe wiring.
- [ ] A run whose only corrective-integrity signal is `no-declaration` has `proceed === true` (absent other refusals).
- [ ] `lights-out.js` selftest updated: no-declaration degrades (advisory), does not refuse, proceed stays true; violation-refuses and asserted-never-fires remain green.
- [ ] `node plugin/skills/faff/bin/faff lights-out --selftest` passes.

confidence: high
spec-review: approve