# FAFF-384 — Evaluator hard cage: evaluate-call spawner + cross-cage transport + spawner-attested code-blindness (rung-2 second slice)

> Spec: faffter-dark-nlspec · 2026-07-08 (build-graft folded resolutions 2026-07-13) · confidence: medium.

This spec is for the build agent that implements the **second, blocked half** of the FAFF-276 rung-2 split (ADR-0041 isolation ladder). As of the 2026-07-13 graft, the three blockers have **all landed** (FAFF-276 primitives, FAFF-325 attestation channel, FAFF-380 cage), and the two architecture Punts have been **resolved by the human at graft** — this spec records those resolutions inline (see §6/§7). The design is now build-admitted.

## Build-time resolutions (2026-07-13 graft)

- **Blockers are Done.** `faff evaluator-preflight` and `faff contract lane-boundary` (FAFF-276) are in `bin/faff`; `correctiveIntegrityProbe` (FAFF-325) has landed distrust-by-default; FAFF-380's cage-engine acceptance runbook (`docs/reference/cage-engine-acceptance.md`) exists. The spec's original `Assumes … absent as of 2026-07-08` are now satisfied — reconcile the landed interfaces at build start (they may differ from spec).
- **Punt 1 (cross-cage transport form) → RESOLVED: `shared-volume-integrity-gated`.** The evaluation-request artifact (outbound) and the holdout-verdict artifact (inbound) cross the boundary on a shared `.faff/` volume; the inbound verdict's trust is gated by the landed FAFF-325 `correctiveIntegrityProbe` (the pid-1 `FAFF_INTEGRITY_BOUNDARY` boundary). This is ADR-0041 dec-2's explicitly-sanctioned path and reuses the house phase-boundary idiom with no new copy machinery.
- **Punt 2 (outer-cage operator at L4) → RESOLVED: `human per-run pre-launch` for v1; host-altitude runner deferred.** The human launching the cage writes the pid-1 launch-time attestation before each L4 run. faff only ever *reads* pid-1 environ back (`assert-don't-implement`), so the faff-side code is operator-agnostic — a future host-altitude runner drops in with zero faff code change. Only the L4 launch-preconditions doc names the operator.

## 1. WHY — Problem and Principles

**The load-bearing model.** The holdout verdict is the 4th L4 merge-floor condition (FAFF-309/311: `holdoutGateResult`, and faff-graft Step-10 condition 4), and its `code_blind: true` is today a **self-attestation by the judged party** — `computeHoldoutVerdict` checks only `extraction.code_blind === true`. It cannot detect an evaluator that read the codebase and lied. This slice moves the attestation to the **spawner**: a fresh OS-level process launcher (`evaluate-call.mjs`, the `review-call.mjs` pattern) that *provably withholds* the codebase — no repo path in argv, env, or cwd; preflight-refused cage entry — and stamps `code_blind` into the verdict envelope itself, so blindness is derived from what was withheld, never from what the judged party claims. A contract ratchet then rejects any verdict whose blindness isn't spawner-attested **when the run promised an evaluator cage**.

**Problem statement:** every L4 autonomous merge currently rests on an attestation nothing structurally enforces — a code-reading, lying evaluator would gate-pass a bad merge to `main`. FAFF-276's slice ships the assertion primitives (lane-boundary schema + refusing preflight) deliberately **unwired**; this slice is the wiring: spawner, cross-cage transport seam, spawner-attested contract change, live preflight, and the evaluator-lane attestation channel.

**Design principles:**

- **The judged party never attests its own blindness.** The single rule this slice exists for. The spawner sets `code_blind`, derived from the withheld-set; the inner evaluator's own claim is never a trust source (and an inner claim of *non*-blindness is a refuse, never laundered — see anti-patterns).
- **Assert, don't implement (ADR-0010 / ADR-0041 dec 2).** faff launches no cage and never widens one. The outer layer provides the cage (FAFF-380); faff emits intent (the FAFF-276 `lane-boundary` artifact), asserts at entry (`faff evaluator-preflight`), and refuses when the boundary is absent.
- **Additive now, mandatory on promise.** The `spawner_attested` field is additive: a legacy verdict without it stays valid **unless** the run's lane-boundary intent artifact promised an evaluator cage, in which case the contract rejects a non-spawner-attested verdict. Intent presence only ever *tightens* — no existing gate weakens.
- **Phase-boundary artifacts, never a live channel (ADR-0041 dec 2).** Request artifact out; verdict artifact consumed at the next dispatch boundary through the existing `holdout-verdict` contract. The shared-volume transport (Punt 1 resolution) is integrity-gated by the FAFF-325 mechanism; no live cross-cage channel exists.
- **Deterministic tools over prose.** The spawner, the attestation derivation, and the contract ratchet are code (pure functions + injectable I/O, selftest + `node --test`), not skill prose asked to behave.

**Scope statement:** rung 2 of the ADR-0041 isolation ladder, second (final) slice — the piece that makes evaluator code-blindness physically enforced on real L4 merges.

## 2. OUT OF SCOPE

- **The physical cage** — the container where the codebase is absent. faff implements no sandbox (ADR-0010); external. Extension point: FAFF-380 (claude-box bounded nested engine).
- **The FAFF-276 primitives themselves** (`lane-boundary` contract, `evaluator-preflight` subcommand). That sibling builds them; this slice only calls them.
- **The host-socket-absent preflight leg + architecture-SVG correction** — FAFF-333.
- **The general corrective-artifact integrity mechanism** — FAFF-325 owns it; this slice provides only the **evaluator-lane** attestation channel satisfying the same `signal` interface.
- **Rung-3 generalisation** (spawners/cages for non-evaluator lanes). Rung 3 has not fired (ADR-0041).
- **Deprecating the legacy (uncaged) holdout path.** L4 runs without a cage remain legal until the operator provides one; the ratchet keys off the intent artifact, not off a calendar.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Spawner | `evaluate-call.mjs` — the orchestrator-side helper that launches the evaluator as a fresh OS-level process and owns the verdict envelope. |
| Withheld-set | What the spawner provably did not hand the evaluator: repo path, worktree cwd, diff, build history. The basis `code_blind` is derived from. |
| Evaluation-request artifact | The phase-boundary file carrying spec text + env-handle endpoint(s) + the lane-boundary intent into the cage. |
| Spawner attestation | The envelope fields (`spawner_attested`, `attestation`) the spawner — never the judged party — writes. |
| Cage promise | A run whose lane-boundary intent artifact declares `lane: evaluator, accesses.repo: absent`. Promise present ⇒ ratchet armed. |

**Interface — the spawner:**

```
evaluate-call.mjs --spec <file> --endpoint <url> [--endpoints <json>] --key <ISSUE-XX|run-id>
                  --out <verdict-file> [--intent <lane-boundary-file>] [--deadline <s>] [--json] [--selftest]

  Exit family mirrors review-call.mjs: 0 ok · 2 usage · 1 other ·
  5 engine-unreachable · 8 deadline · plus 10 preflight-refused (new, this slice).
```

- **Fresh OS-level process, provably code-blind by construction:** cwd = a neutral scratch dir (never the repo or any worktree); argv/stdin carry **only** spec text + env-handle endpoint(s) + the intent artifact; the child env is scrubbed of repo-locating variables. The spawner records exactly what it passed — that record is the withheld-set evidence.
- **Preflight before judging:** the spawner runs `faff evaluator-preflight` **inside the cage** (via the request artifact's entry hook); a non-zero exit is exit 10 → the call-site maps it to `needs-human` (never `meets-spec`), teardown runs.
- **Envelope ownership:** the inner evaluator emits criteria + aggregate only. The spawner assembles the final `.faff/holdout/<key>.json`: inner criteria/aggregate + spawner-derived `code_blind` + `spawner_attested: true` + `attestation` basis. The inner process never writes the holdout file.

**Type — the holdout-verdict contract change (additive):**

```
RECORD HoldoutVerdict (existing fields unchanged):
  aggregate, code_blind, criteria[], violations[]        # exactly as computeHoldoutVerdict validates today
  spawner_attested?: bool                                # NEW, additive. true only when a spawner set code_blind
  attestation?: RECORD:                                  # NEW, present iff spawner_attested
    spawner: string                                      #   e.g. "evaluate-call.mjs"
    withheld: { repo: bool, worktree_cwd: bool, diff: bool }
    preflight: "pass"                                    #   the in-cage preflight exit-0 record

  RATCHET (validator): given require_spawner_attested (caller-resolved from the cage promise):
    require ∧ spawner_attested !== true  → violation (exit 1) — never coerced, never a fail-loud
    ¬require                             → absent fields tolerated byte-for-byte (legacy path unchanged)
```

- The ratchet lands in `computeHoldoutVerdict` (one shared trust gate), so `faff contract holdout-verdict`, `holdout verdict --issue` (graft gate) and `holdout verdicts --association` (run bridge) all inherit it — never a forked rule.
- **Caller resolves the promise, validator stays pure:** a new flag `faff contract holdout-verdict --require-spawner-attested` (and the same option through `holdout verdict` / `holdout verdicts`). The call-sites set it iff the run's lane-boundary intent artifact promises the evaluator cage. The validator never does I/O to find the intent.

**Interface — the evaluator-lane attestation channel (the FAFF-325 `signal` satisfier):**

- The **outer layer** (the human per-run, Punt-2 resolution) writes the attestation at **launch time** into the cage's pid-1 environment (`FAFF_INTEGRITY_BOUNDARY=<version>:<dir…>` form or the evaluator-lane analogue) — orchestrator-writable / build-lane-read-only. The spawner reads it back (pid-1 environ probe, the `correctiveIntegrityProbe`/`containerCheck` read pattern) and carries it into `attestation`; the same channel form is what FAFF-325's probe `signal` parameter accepts for this lane.
- Wired into the intent-artifact schema: the lane-boundary record's `integrity_signal` field becomes assertable for the evaluator lane. Schema version bumps only if a field's meaning changes — target: no bump.

## 4. HOW — Behavior

**Architecture.** One flow replacing `holdout_step` step 3 at both call-sites (beep-boop §10b per-run; graft Step-10 per-issue — the step is call-site-agnostic, so the change lands once):

```
PROCEDURE holdout_step step 3 (caged form):
  1. Resolve the cage promise: read the run's lane-boundary intent artifact
     (orchestrator-held run dir; FAFF-325's boundary covers it).
     ABSENT → legacy inline dispatch, byte-for-byte today's behaviour; require-flag OFF.
  2. PRESENT → write the evaluation-request artifact {spec text, env-handle endpoint(s), intent}
     to the shared .faff/ volume (Punt-1 resolution: shared-volume-integrity-gated —
     consumption of the inbound verdict is integrity-gated by correctiveIntegrityProbe).
  3. Spawn: evaluate-call.mjs --spec … --endpoint … --intent … --out .faff/holdout/<key>.json
     a. in-cage: faff evaluator-preflight → non-zero ⇒ exit 10 ⇒ needs-human, teardown
     b. inner evaluator (the configured `evaluator` slot's judging arc) exercises the
        born-verifiable criteria against the endpoint; emits criteria + aggregate only
     c. spawner derives code_blind from the withheld-set + preflight pass; stamps
        spawner_attested + attestation; writes the verdict file
  4. Pipe to `faff contract holdout-verdict --require-spawner-attested` (flag ON because
     the promise resolved present). Non-zero → needs-human, teardown. Continue per the
     existing step 4–6 (bridge, run-done / merge-floor, teardown on every path).
```

**Behaviour summary:** when a cage was promised, a holdout verdict only gate-passes if a spawner — not the judged party — attested blindness from a provably-withheld launch inside a preflight-verified cage; when no cage was promised, nothing changes.

**Edge cases:**

- **Inner evaluator claims `code_blind` itself** → the spawner ignores the field when true; when the inner output declares it saw code (`false` or evidence of repo access), the spawner **refuses to attest** — envelope carries `spawner_attested: false` + violation, mapping to `needs-human`. Never launder an inner non-blind claim into an attested-blind envelope.
- **Preflight refuses (exit 10)** → `needs-human`, teardown, refusals logged verbatim. Never retried inside the same launch (the cage is wrong, not flaky).
- **Deadline (exit 8)** → `needs-human` (a holdout, unlike the advisory second-opinion, is a merge-floor leg — it never pass+skips).
- **Intent artifact present but malformed** → `faff contract lane-boundary` fails loud; treat as promise-present-with-broken-promise ⇒ `needs-human`. A malformed promise never relaxes to legacy.
- **Verdict file missing/unwritable after spawn** → existing fail-closed behaviour of the consumers (missing file ⇒ block/needs-human) already covers it; no new handling.
- **Teardown on every path** — unchanged from the shipped step 6.

**Failure modes:**

- **Intent-artifact deletion to fall back to legacy self-attestation.** How you'd know: rung-1 (FAFF-325) integrity covers the orchestrator's run dir — a covered-path mutation is detectable; the run banner names the resolved promise state so a silently-legacy L4 run is visible. Proceed — this is the rung-1/rung-2 composition ADR-0041 orders; record the residual.
- **FAFF-380's cage ships a different entry mechanism than the request-artifact hook assumes.** How you'd know: the Assumes validation at build start (claude-box's actual entry interface vs step 3a). Narrow — keep the spawner + ratchet, re-punt the entry hook to the transport decision (same seam).

**Anti-patterns:**

- Invoking the evaluator inline "instructed to ignore the code" — in-context code makes `code_blind: true` false-by-construction.
- The spawner overwriting an inner `code_blind: false` with an attested `true` — converts the enforcement layer into a laundering layer.
- Teaching `computeHoldoutVerdict` to read the intent artifact from disk — the compute fn is pure (no I/O); promise resolution is the caller's, via the flag.
- Honouring any attestation whose source is build-lane-writable — the `correctiveIntegrityProbe` rule; a forgeable channel re-opens the exact forge this closes.

## 5. SCENARIOS

```
Given an L4 run whose lane-boundary intent artifact promises the evaluator cage
When holdout_step dispatches the evaluator via evaluate-call.mjs and the in-cage preflight passes
Then the persisted verdict carries spawner_attested:true with code_blind derived from the withheld-set,
     and `faff contract holdout-verdict --require-spawner-attested` exits 0
```
```
Given the same caged run
When a verdict arrives with code_blind:true but spawner_attested absent (a self-attested verdict)
Then the contract exits 1 naming the missing spawner attestation — the lying-evaluator hole is closed
```
```
Given a run with NO lane-boundary intent artifact (legacy, uncaged)
When today's inline holdout dispatch produces a self-attested code_blind:true verdict
Then validation without the require flag passes exactly as today — byte-for-byte back-compat
```
```
Given a promised cage whose boundary is actually absent (repo dir readable inside)
When evaluate-call.mjs runs the in-cage preflight
Then it exits 10, the call-site returns needs-human, env teardown still runs, and no verdict gate-passes
```
```
Given an inner evaluator output that declares it read the codebase
When the spawner assembles the envelope
Then it refuses to attest (spawner_attested:false + violation) — never laundered to attested-blind
```

Assertion: with the require flag OFF, every existing `holdout-verdict` selftest/`node --test` case passes unchanged (the additive-only proof).

## 6. DESIGN DECISION RATIONALE

- **Spawner launches an agentic engine** (`claude -p`-class — FAFF-380's bounded nested engine), inheriting from `review-call.mjs` the **process pattern only** (fresh OS process, zero-dep, pure fns + injectable spawn, deadline, exit-code family, selftest). A completion API cannot curl an env-handle.
- **The spawner owns the verdict envelope** — inner emits criteria+aggregate, spawner derives `code_blind`, stamps attestation, writes the file. The flag's provenance must be structurally outside the judged process.
- **Ratchet extends `computeHoldoutVerdict` additively** behind a caller-resolved `--require-spawner-attested` flag; no new contract, no schema fork, all three consumers inherit via the one shared compute fn.
- **Caller-resolved flag** for the cage promise; validator stays pure (house invariant).
- **Attestation channel form** = outer-layer, launch-time, pid-1-environ (FAFF-325's `FAFF_INTEGRITY_BOUNDARY`); no faff-side alternative invented.
- **Punt 1 (transport) → RESOLVED `shared-volume-integrity-gated`** (2026-07-13 graft): ADR-0041 dec-2's sanctioned path, gated by the landed `correctiveIntegrityProbe`; reuses the house `.faff/` phase-boundary idiom, zero new copy machinery. The spawner contract + ratchet are transport-agnostic by construction, so only step-2's medium is fixed by this.
- **Punt 2 (outer-cage operator) → RESOLVED `human per-run pre-launch` v1, runner deferred** (2026-07-13 graft): matches ADR-0041's "a human today"; the pid-1 read path is operator-agnostic, so a future host-altitude runner needs no faff code change — only the launch-preconditions doc names the operator.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** both original Punts are **resolved at graft** (see §6). None remain open.

**Assumptions (Assumes) — reconcile at build start:**

- FAFF-276's primitives (`faff evaluator-preflight`, `faff contract lane-boundary`) exist in `bin/faff`. *Validation:* grep the usage block + CONTRACT registry — **landed** (2026-07-13); reconcile the actual `--json` shapes / contract keys before wiring.
- FAFF-325 has landed the trusted-signal wiring rule (only a non-build-lane-writable source may assert). *Validation:* `correctiveIntegrityProbe` no longer unconditionally returns `{asserted:false}` — **landed** distrust-by-default; read its source-validation before wiring the evaluator-lane signal.
- FAFF-380 delivers a bounded nested engine with a launch interface that can run a preflight before judging. *Validation:* `docs/reference/cage-engine-acceptance.md` — the runbook; claude-box's actual entry interface checked at build start; mismatch → narrow per failure mode 2.
- `holdout_step` remains call-site-agnostic across beep-boop §10b and the graft Step-10 gate. *Validation:* re-read both SKILL sections at build time; the change lands once in the shared step.

## 8. DONE — Definition of Done

### From WHY
- [ ] On a cage-promised run, a gate-passing holdout verdict's `code_blind` is spawner-derived (withheld-set + preflight), not judged-party-declared — demonstrated by scenarios 1–2.
- [ ] On a run with no cage promise, all existing behaviour is byte-for-byte unchanged (scenario 3 + the untouched-selftests assertion).

### From WHAT (types and interfaces)
- [ ] `evaluate-call.mjs` exists (zero-dep Node, pure core + injectable spawn, `--selftest`), exit family `{0,1,2,5,8,10}`; launched with neutral cwd, scrubbed env, spec+endpoint(s)+intent only.
- [ ] `holdout-verdict` gains additive `spawner_attested` / `attestation`; ratchet fires only under `--require-spawner-attested`; violation (exit 1), never coercion or fail-loud, on a required-but-absent attestation.
- [ ] The flag threads through all three consumers (`contract holdout-verdict`, `holdout verdict --issue`, `holdout verdicts --association`) via the one shared compute fn.
- [ ] The evaluator-lane launch-time attestation channel satisfies the `signal` interface (orchestrator-writable / build-lane-read-only) and is wired into the lane-boundary intent artifact without a breaking schema change.

### From HOW (behaviour)
- [ ] `holdout_step` step 3 resolves the cage promise from the intent artifact: absent → legacy inline path; present → spawner dispatch with the require flag ON at step 4; both call-sites inherit from the one shared step.
- [ ] In-cage `faff evaluator-preflight` runs before judging; non-zero → exit 10 → `needs-human`; teardown on every path.
- [ ] Spawner refuses to attest on any inner non-blind signal (scenario 5); a malformed intent artifact is `needs-human`, never a relax-to-legacy.

### From HOW (edge cases)
- [ ] Deadline → `needs-human` (no pass+skip on a merge-floor leg); missing verdict file → existing fail-closed consumer behaviour confirmed by test.

### Tests + docs
- [ ] `evaluate-call.mjs --selftest` + `node --test` coverage: envelope assembly, refuse-to-attest, ratchet on/off, exit-code mapping, legacy byte-for-byte.
- [ ] `faff --help` + `docs/cli.md` + `docs/guide/cli.md` updated same PR (docs-never-go-stale); deliverable CLI prose carries no FAFF-NN refs.
- [ ] The L4 launch-preconditions doc names the cage promise + both resolved Punt outcomes; conventional commit + PR title (`feat(FAFF-384): …`).

**Integration smoke test:**
```
1. Fixture a cage (container marker + absent repo path) + a stub env endpoint.
2. Run evaluate-call.mjs against a two-criterion spec → verdict file with spawner_attested:true.
3. Pipe with --require-spawner-attested → exit 0; strip the attestation → exit 1.
4. Same pipe without the flag → exit 0 (legacy tolerance).
```

confidence: medium
