# FAFF-278 spike — pass 1 refutation log (threat-model vs the 13 constraints)

Constraint numbering per the exploration extract (C1 un-subvertable channel · C2 closed input allowlist · C3 isolation co-binding · C4 supervisor reads-never-mutates, own lane · C5 resumable state · C6 consume-don't-re-derive · C7 machine-authored-mandate trust gap · C8 event-boundary coarse · C9 TaskStop-only in-flight verb · C10 fleet write-contention punt · C11 assert-don't-implement · C12 watcher un-audited · C13 spike-ADR deliverable shape).

## Channel C — live write-back into the supervised lane → REFUTED (the canary holds in pass 1)

- **C1 violated:** delivering corrective content *into a running lane* makes the intervention's effect contingent on the supervised agent processing it — the watched party can ignore, reinterpret, or route around the correction; the channel's authority is subvertable by the thing it corrects.
- **C4 violated:** the supervisor stops being read-only toward the supervised surface — it becomes a writer into the lane it watches, coupling its authority to the lane's cooperation (the exact "signalled-back watcher" ADR-0034 rejected).
- **C3 violated (revisit-trigger):** wiring any message path between lanes creates the very write-path whose absence the un-subvertability claim is co-bound to. Building C *fires ADR-0034's revisit trigger by construction*.
- **C9:** no such verb ships; C requires new IPC — new surface, new attack area.
- **Verdict: refuted** (C1, C3, C4). Retained as the pass-2 canary: a refuter that passes C is invalid.

## Channel B — boundary-consulted constraint file (constrain-and-continue, no stop) → REFUTED as a distinct channel

- **Enforcement locus is inside the supervised lane (C1):** under the shipped model, graft *runs inside the build subagent*; a constraint file consulted at graft's own gate points is enforced by the supervised agent's prose — self-enforcement by the party being corrected. A derailed or confused agent not consulting its constraints is precisely the failure mode Sentry exists to catch; an intervention that relies on the derailed agent's cooperation is not an intervention.
- **Forgeable from the lane (C2):** the artifact must live on shared disk for the lane to read mid-run; the build subagent has filesystem access (it writes its own `graft.md`), so the same lane can rewrite the constraint. There is no fs-privilege separation inside the container (C3's isolation is *context* isolation, not fs ACLs) — an in-flight-consulted artifact cannot satisfy the closed-allowlist property.
- **The salvageable half is Channel A:** a constraint file consulted by the *orchestrator* at its own dispatch boundaries (between units) is enforced in the orchestrator lane — that is not B, it is A's artifact without the abort. B adds nothing A lacks except the unsound mid-flight promise; C8 already says no sub-step intervention is promised.
- **C10:** a shared constraint artifact under a parallel fleet adds a new multi-writer surface on top of the unresolved contention punt.
- **Verdict: refuted as distinct** (C1, C2); its sound residue is folded into A.

## Channel A — stop-and-redispatch with amended mandate → SURVIVES pass 1, at SUBTRACTIVE width only

- **C1 satisfied:** every write happens while the supervised agent is dead (post-abort) or before it exists (pre-dispatch); the enforcement point is the orchestrator dispatch boundary — the shipped, un-subvertable stop channel, extended with *what happens next*, not a new channel into a live lane.
- **C2 satisfiable, must be pinned:** the corrective input is authored from the closed orchestrator surface (events.jsonl / run-ledger / budget check / heartbeat) only; no subagent-shaped value may reach the authoring decision. This is testable in the AC5 shape (probe step 4) — the authoring path gets the same normalizer treatment as detection.
- **C3 satisfied:** no new write-path from the build lane into orchestrator context; the corrective artifact is orchestrator-lane state consumed by the orchestrator itself at re-dispatch. Isolation co-binding unchanged.
- **C4 satisfied:** Sentry still only reads the supervised surface; the corrective *artifact* is Sentry/orchestrator-lane output, not a mutation of the watched surface.
- **C5 satisfied:** rides the shipped abort guarantees (aborted-resumable, WIP committed, no terminal outcome, normal resume-from-ledger consumes it).
- **C6 satisfied:** no new signal math; the corrective decision consumes the same verdicts detection already produced.
- **C7 — the load-bearing split:** the input is machine-authored, so the trusted-spec carve-out does not cover it. **Subtractive** inputs (park with cause; forbid a named surface; tighten a threshold; de-scope to a subset of the already-human-gated spec) can only *shrink* the mandate — the write-abstention safety template: safety from what the machine structurally cannot do (grant authority). **Additive** inputs (amend the WHAT, add scope, redirect the goal) have no human-gated provenance → route to park/needs-human, exactly as graft's respec already parks on any genuinely open decision. **A survives at subtractive width; additive width is refuted by C7.**
- **C8 satisfied:** correction lands at dispatch boundaries — no sub-step promise.
- **C9 satisfied:** composes TaskStop + decline-next-dispatch + orchestrator-lane artifacts; no new verb.
- **C11 satisfied:** prose/artifact wiring over shipped mechanisms; no new enforcing infrastructure.
- **Residual risks for pass 2 to attack:** (i) subtractive-smuggling-additive (constrain everything except an attacker-preferred path); (ii) forged corrective artifact (who can write the orchestrator-lane artifact on shared fs — same residual as the run-ledger itself, bounded by the same reconcile-vs-git-truth posture); (iii) unresumable wedging via a constraint that contradicts the spec (mandate narrowed to ∅ → must degrade to park, not spin).

## Channel D — tracker-mediated human relay (control) → SURVIVES (shipped baseline)

- Trivially satisfies C7 (human authorship *is* the trusted provenance), C1–C5 (it is the shipped park/unpark path). Its cost is latency: a redirect waits for a human. D is the bar A must beat on latency/autonomy without losing on trust — and the fallback whenever A's subtractive test fails.

## Decision 2 — per-run vs fleet (criterion applied)

Fleet supervision's *reads* scale safely (N append-only surfaces), but its evidence quality stands on per-run ledgers that are already compromised under the parallel executor's unresolved multi-writer heartbeat/outcome contention (C10), and any fleet-level corrective artifact would be a new shared-mutable-state write surface. Criterion ("zero new write-paths into shared mutable state while the punt stands") → **per-run supervision at v1; fleet supervision deferred behind the dedicated single-value heartbeat-file fix**, as a costed follow-up.

## Decision 3 — who-watches-the-watcher (failure-mode register)

| Watcher failure | Fails open-to-human? | Disposition (v1) |
|---|---|---|
| False-positive kill (aborts a healthy run) | Yes — abort is resumable + visible (`aborted-resumable` ledger, run summary) | Threshold calibration; the advisory non-L4 consult (run-governance wiring) is the calibration feed; calibration log captures disputes |
| Missed derailment (watcher silent while run burns) | Yes, eventually — the budget spend/time backstop binds, and run-done's floor escalates | Budget is the watcher's watcher for the burn case; acceptable v1 |
| Wedged/dead watcher (evaluator down mid-run) | Yes — L4 evaluator-failure handling is fail-closed (kill-switch down → stop dispatching, needs-human) | Owned by the run-governance wiring's mint-scoped handling |
| Forged watcher inputs | Yes — closed allowlist drops foreign fields (AC5) | Extend the AC5 test shape to the corrective-authoring path (probe step 4) |

Criterion ("every watcher failure fails open-to-human, never silent") → satisfied by composing shipped precedents; a dedicated watcher-of-watchers lane is rejected for v1 (infinite regress; assert-don't-implement, C11) and named a costed follow-up only if calibration data shows the register is insufficient.

## Pass-1 summary

- A: survives at subtractive width (additive → park). B: refuted (folds into A). C: refuted (canary). D: survives (control/baseline + fallback).
- Fleet: per-run at v1. Watcher-audit: register + shipped-precedent composition, no new machinery.
- Pass 2 targets: A's three residual risks + the canary check on C.

---

# Pass 2 — adversarial refutation (independent skeptic: nvidia/nemotron-3-super-120b-a12b)

Backend chain: NVIDIA nemotron primary (live), ollama fallback. Skeptic prompted to break Channel A's three residual risks + re-check the Channel C canary.

- **Q1 subtractive-smuggling-additive → NOT A BREAK.** A subtractive constraint cannot change the WHAT; a "narrow to everything except X" where X is spec-permitted is a valid de-scope, and where X is *not* spec-permitted it produces an empty mandate (→ Q3), never an additive redirect. The subtractive-width design contains it.
- **Q2 forged corrective artifact → UNMITIGATED BREAK (material finding).** Inside the container the build subagent shares uid + filesystem with the orchestrator's on-disk artifacts and can write the run-ledger directory. The shipped guard (terminal-token-only return, never writes orchestrator *context*) is a **context-isolation** property — it does **not** cover a new corrective **artifact on disk**. So a subtractive corrective artifact is forgeable by the very lane it constrains. **Named mitigations:** (a) mount the run-ledger / corrective-artifact dir **read-only** for the build subagent, or (b) **orchestrator-verified signatures** on corrective artifacts checked before re-dispatch consumes them. Either is an integrity mechanism that does **not** exist today.
- **Q3 unresumable wedge → MITIGATED.** Empty-mandate must be **detected before re-dispatch and degrade to park**; with reliable pre-dispatch detection that is sufficient (no spin).
- **Q4 canary (is C safe?) → NO.** "Live write-back can race with the lane's ongoing execution → inconsistent/corrupted state." The refuter refused to pass C → **calibrated**, its verdicts count.

# Pass 3 — mechanical probe (shipped-substrate confirmation)

The spike does not build the corrective mechanism (anti-pattern, out of scope), so the probe confirms the **shipped substrate** the channel would ride on, and marks exactly what an eventual build ticket must add.

- **Probe step 1 (abort guarantees hold) → PASS, already shipped.** `node --test test/sentry.test.mjs` = 12/12, 0 skipped; `sentry --selftest` = 30/30, including `abort marks ledger aborted-resumable`, `abort preserves admitted/outcomes (resumable, no force-reset)`, `abort never resurrects a done owner`. The resumable-abort contract Channel A rides on is real and tested.
- **Probe step 4 (no-foreign-authorship) → detection side PASS, authoring side is the Q2 gap.** `AC5 hostile injected fields ignored — still aborts` + `AC5 normalizer keeps only the surface allowlist` prove the **detection** inputs are a closed allowlist. There is **no** equivalent integrity guard for a would-be corrective **artifact** — that is precisely the Q2 unmitigated break. The AC5 shape is the template the corrective-authoring path must reuse, plus the Q2 integrity mechanism.
- **Probe steps 2/3/5 (subtractive reaches mandate · additive → park · empty → park) → UNBUILT (correctly).** These exercise a corrective mechanism that does not exist; they are the acceptance criteria the **follow-up build ticket** owns, not this spike.

# VERDICT (recorded in the ADR)

- **Decision 1 — corrective-redirect channel: GO-narrow.** Channel A (stop-and-redispatch, machine-authored corrective input) at **subtractive width only** (additive → park/human), **conditional on** a corrective-artifact **integrity mechanism** (read-only ledger mount for the build lane, or orchestrator-verified signatures — the Q2 mitigation) and **empty-mandate degrade-to-park** (Q3). Channels B and C refuted; D (human relay) is the fallback whenever the subtractive test fails. NOT full GO — the integrity precondition is load-bearing.
- **Decision 2 — per-run vs fleet: per-run at v1.** Fleet supervision deferred behind the parallel executor's dedicated single-value heartbeat-file fix (the unresolved multi-writer contention punt); a fleet-level corrective artifact would add a new shared-mutable-state write surface.
- **Decision 3 — who-watches-the-watcher: register + shipped-precedent composition, no new lane.** Every watcher failure fails open-to-human (abort resumable+visible; missed-derailment caught by the budget/run-done backstop; evaluator-down fail-closed; forged inputs dropped by the AC5 allowlist extended to the authoring path). A dedicated watcher-of-watchers lane is rejected for v1 (infinite regress; assert-don't-implement).

# Costed follow-ups (for the ADR)

1. **Build Channel A subtractive corrective authority** — the corrective-input schema + orchestrator-lane authoring path + re-dispatch consumption + the AC5-shaped no-foreign-authorship test; extends `SIGNAL_TRIP_INTERVENTION` and the `test/sentry.test.mjs` AC6 no-`correct` guard. **Blocked by follow-up 2.**
2. **Corrective-artifact integrity mechanism (the Q2 mitigation)** — read-only ledger mount for the build subagent, or orchestrator-verified artifact signatures. Co-bound to the FAFF-42/container boundary (this is a container-fs-ACL question, not a faff-prose question — assert-don't-implement). Load-bearing precondition for follow-up 1.
3. **Fleet supervision** — behind the dedicated single-value heartbeat-file decoupling (the multi-writer contention punt).
4. **Live-run validation** — the probe proved the substrate on fixtures; a real derailed-run trial is the provisional-GO's outstanding evidence.
