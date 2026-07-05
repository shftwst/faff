# Spec — FAFF-373: Corrective-integrity fail-safe gate

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high.

*Build spec for FAFF-373. It ships the fail-safe half of FAFF-325's corrective-integrity design: a probe that defaults to "boundary not proven" and a gate that degrades Sentry-2 corrective authority to human-relay until integrity is proven. No external dependency, no open decision.*

## 1. WHY — Problem and Principles

**The load-bearing idea:** under a shared uid faff cannot cryptographically stop a same-uid agent from forging a file (`bin/faff:1683` — *"Guardrail, not cryptographic control: a local agent can always write a marker."*). So the safe posture is **distrust by default**: the orchestrator refuses to *act* on any machine-authored corrective input (or trust ledger content as authoritative) unless a boundary is proven, degrading corrective authority to **Channel D** (human relay). This ticket ships that distrust-by-default and its degrade path — it deliberately provides *no* path to trust (that's FAFF-325).

**Problem statement.** ADR-0039 admitted Sentry-2 corrective authority (Channel A) conditional on an integrity mechanism, because the build subagent shares uid + fs with the orchestrator's on-disk artifacts and can forge a corrective artifact / rewrite `run-ledger.json`. This half closes the FAFF-278 forge path by *refusing to act* on anything the build lane could have forged — corrective authority is provably unavailable until integrity is proven. The proving (the trusted-signal channel + the read-only mount) is FAFF-325.

**Design principles.**

- **Guardrail-not-crypto (`bin/faff:1683`).** No faff-built signatures/HMAC — a shared-uid secret is forgeable, so it's false assurance. The mechanism is assert + fail-safe, not crypto.
- **Fail-safe by construction.** The default is `asserted:false → untrusted → Channel D`. Safety is what the machine structurally *cannot* do: grant corrective authority on an unproven boundary.
- **Assert, don't implement (ADR-0010).** faff detects/degrades; it never mounts or sandboxes. The boundary provision is external (FAFF-325 / rung-1).

## 2. OUT OF SCOPE

- **The trusted attestation-signal channel** (anything that makes `asserted:true`) — the FAFF-325 activation half. *Extension point:* the probe's `signal` seam + FAFF-325 / FAFF-276.
- **The read-only mount provision** — outer layer / rung-1 / claude-box-class.
- **Channel A itself** (corrective-input schema, authoring, consumption) — FAFF-326.
- **faff-built signatures / HMAC** — `bin/faff:1683`; false assurance under shared uid.
- **Whether AC5 covers ledger-content forgery** — FAFF-324; this gate provides the shared `consumer="detection"` path.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Asserted | The orchestrator has a *trusted* signal that the integrity boundary is real (never true in this ticket) |
| Integrity dir | The paths holding corrective artifacts + `run-ledger.json` — the forge surface |
| Channel D | The human-relay fallback for a correction that can't be trusted machine-side |
| Reconcile-only | Ledger content is not authoritative; cross-checked against git truth (the shipped posture) |

**The probe (new pure function, container-check shape).**

```
FUNCTION correctiveIntegrityProbe(env, fsq, signal) -> { asserted: Bool, basis: String }
  # `signal` is the SEAM FAFF-325 will wire to an un-forgeable channel. In THIS ticket
  # no trusted source exists, so the probe returns asserted:false for all inputs.
  RETURN { asserted: false, basis: "no-boundary-signal" }
```

- Pure, exported, over the shared injectable never-throws `fsq` (`realFsq()`). No secret, no crypto.
- **`asserted:false` is the only outcome here** — the `signal` parameter is the forward-compatible seam, never read as trusted.

**Chosen (mechanism):** an assert-only probe + fail-safe gate, container-check shape — **not** faff-built signatures (`bin/faff:1683`).

**Chosen (default distrust):** the probe defaults `asserted:false`; no input flips it — the trusting `signal` channel is FAFF-325.

**The integrity gate (new CLI verb — what FAFF-326 + detection call).**

```
FUNCTION integrityGate(probeResult, consumer) -> { trusted: Bool, disposition }
  IF probeResult.asserted == true -> { trusted: true, disposition: "trusted" }
  ELSE:
    consumer == "corrective" -> { trusted: false, disposition: "channel-D" }
    consumer == "detection"  -> { trusted: false, disposition: "reconcile-only" }
```

**Chosen (degrade, not refuse):** an unasserted boundary makes corrective authority unavailable → **Channel D** and ledger content **reconcile-only** — not a hard refuse; the run proceeds stop-only (`continue|pause|abort`, no `correct` rung). The `asserted:true` branch is the seam FAFF-325 activates; unreachable here.

**Chosen (single-sourced integrity-dir set):** the forge-surface paths (corrective artifacts + `run-ledger.json`) derive from the same run-dir/ledger layout `readLedger` uses — never a second hand-written list.

**Lights-out capability flag.** `corrective_authority: available | channel-D-only` derived from the probe, folded into the `lightsOutPreflight` / ledger banner — a capability record, not a new refuse path.

## 4. HOW — Behavior

One pure probe + one gate verb, consumed at two call sites (corrective / detection), plus a capability flag on the lights-out banner. No new dependencies, no crypto.

```
PROCEDURE gate-consumption:
  1. p := correctiveIntegrityProbe(env, fsq, signal)   # here → asserted:false
  2. g := integrityGate(p, consumer)
  3. consumer=="corrective" & !g.trusted -> park/relay (cause "corrective-integrity-unasserted"); run continues stop-only
     consumer=="detection"  & !g.trusted -> treat ledger content reconcile-only (cross-check vs git)
```

**Edge cases.** `fsq` read error / no run env → `asserted:false` (never-throws); a `signal` value passed → still `asserted:false`; detection under reconcile-only → predicates still run, cross-checked vs git.

**Failure modes.**

- **The `signal` seam later wired to a shared-fs source** would let the build lane forge `asserted:true`. *Mitigation:* ship the seam inert (`asserted:false` always) + a test that a shared-fs signal does **not** flip to trusted. The trust source must be FAFF-325's un-forgeable channel.
- **Wrong integrity dir** (gate reasons about dir X, artifacts live in dir Y). *Mitigation:* single-source the dir set from the run-dir/ledger layout; test both the ledger path and the corrective-artifact path.

**Anti-pattern:** honouring a `signal` from any build-lane-writable source as `asserted:true`. Why: re-opens the exact forge this closes.

**Anti-pattern:** hard-refusing the lights-out run when unasserted. Why: Channel D (stop-only) is the safe fallback; refusing over-blocks a still-safe run.

## 5. SCENARIOS

```
Given a run with no asserted integrity boundary (this ticket's only state)
When FAFF-326 asks the gate whether to consume a machine-authored corrective input (consumer="corrective")
Then it returns trusted:false / channel-D, corrective authority is unavailable, and the run proceeds stop-only (no correct rung)
```

```
Given a corrective artifact written by the build lane on the shared fs
When the orchestrator evaluates it through the gate
Then it is not acted on as authentic (degraded to Channel D / park) — the FAFF-278 forge path is closed by refusal-to-act
```

```
Given a `signal` value sourced from a build-lane-writable location is passed to the probe
When the probe evaluates
Then it still returns asserted:false (the seam is inert until FAFF-325 wires an un-forgeable channel)
```

```
Given detection reads run-ledger content with no asserted boundary (consumer="detection")
When a thrash/budget predicate evaluates
Then ledger content is treated reconcile-only (cross-checked vs git), never unconditionally authoritative
```

## 6. DESIGN DECISION RATIONALE

- **Assert + fail-safe vs faff-built signatures?** **Chosen: assert + fail-safe** — `bin/faff:1683` makes a shared-uid secret forgeable; distrust-by-default + degrade is the honest mechanism.
- **Ship the trust path or defer it?** **Chosen: defer** — a trusted signal must be un-forgeable (needs the rung-1 channel, FAFF-325). This ticket ships the inert seam + fail-safe, complete on its own.
- **Refuse vs degrade when unasserted?** **Chosen: degrade to Channel D** — ADR-0039 names it the fallback; the run stays safe stop-only.
- **Single-source the dir set?** **Chosen: yes** — a divergent list is a real bypass.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the trusted-signal channel is carved out to FAFF-325 by design.

**Assumptions.**

- **Assumes:** the run-dir/ledger layout exposes a single canonical source for the integrity-dir set. *Validate:* read `readLedger` (`bin/faff:69`) + run-dir constants; derive the set, don't re-list.
- **Assumes:** the `test/sentry.test.mjs` AC6 no-`correct`-rung guard is the invariant to preserve. *Validate:* run it before/after; this ticket adds a gate, not a `correct` rung.

## 8. DONE — Definition of Done

### From WHY
- [ ] With no asserted boundary, corrective authority is provably unavailable (degrades to Channel D) — a forgeable corrective artifact is never acted on as authentic.

### From WHAT (types and interfaces)
- [ ] `correctiveIntegrityProbe(env, fsq, signal)` is pure/exported over the shared never-throws `fsq`; returns `{asserted:false, basis:"no-boundary-signal"}` for all inputs; no crypto/secret.
- [ ] `integrityGate(probeResult, consumer)` returns `channel-D` for `corrective` and `reconcile-only` for `detection` when unasserted; the `asserted:true → trusted` branch exists as the seam.
- [ ] The integrity-dir set is single-sourced from the run-dir/ledger layout.

### From HOW (behaviour)
- [ ] Unasserted `corrective` → the caller degrades to Channel D (disposition `channel-D`); no `correct` rung (`test/sentry.test.mjs` AC6 still passes).
- [ ] The lights-out preflight records `corrective_authority: channel-D-only` when unasserted (no hard refuse).
- [ ] A `signal` from a build-lane-writable source is never honoured as `asserted:true`.

### From tests
- [ ] Tests (injected `fsq`, zero real fs/network): probe → `asserted:false` for all inputs; `corrective` → channel-D; `detection` → reconcile-only; a shared-fs `signal` does not flip to trusted; the dir set covers both the ledger path and the corrective-artifact path.
- [ ] Selftest table extended (container-check/lights-out style); `node --test` passes; AC6 guard green.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. probe := correctiveIntegrityProbe(env, fsq, /*any*/ signal) -> {asserted:false}
  2. integrityGate(probe, "corrective") -> {trusted:false, disposition:"channel-D"}
  3. assert: a corrective artifact on disk is NOT consumed; lights-out capability flag = channel-D-only
```

---

confidence: high
