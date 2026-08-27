# Spec — FAFF-899: L4 guardrail preflight must gate on operator-owned conditions, not each subcommand's `--selftest` suite

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-899.

> **Revised 2026-08-27 (autonomous refresh, run `run-20260827-065909-beepboop-list-0e6161`, L3).** Folds in the human decision (alec, 2026-08-23, comment on this issue) that closed the spec's two open architecture Punts — both toward the direction this spec already recommended. Punt 1 (per-run condition gates for events/sentry/holdout) → **structural floor only, no new per-run gate**. Punt 2 (stale-backing-module residual) → **ship the core fix; the version/build handshake is filed and linked as FAFF-902**. No design decision changed; the open questions were resolved. Re-rated **medium → high**.

This nlspec is for the build agent that will fix FAFF-899 and for the human reviewers who gate it. It replaces the L4 lights-out launch reachability probe — currently each guardrail subcommand's own unit-test suite — with a check of the one variable actually in question at launch: the operator's own config and this run's conditions. The fail-closed doctrine is untouched; only the *signal being tested* changes.

## 1. WHY — Problem and Principles

**The load-bearing model.** A launch preflight exists to answer one question: *is this operator's run, on this machine, right now, admissible?* The only honest inputs to that question are the operator's config and this run's filesystem/runtime state. Re-running a guardrail's shipped unit tests answers a different question — *does the library still pass its own regression suite* — which was settled at ship time and tells the operator nothing they can act on. FAFF-899 is the story of a preflight wired to the ship-time question, refusing a healthy run when the ship-time answer flickered under load.

**Problem statement.** Today every CLI-backed L4 guardrail is gated by `probeContractReachable(binPath, sub)`, which spawns `<binPath> <sub> --selftest` with a hard 20s timeout and treats any non-zero exit — including a timeout — as `absent`, hard-refusing the whole run fail-closed. That suite is a pure in-process fixture regression (events additionally does real `/tmp` I/O and subprocess fan-out), so it reads none of the operator's config or run state, yet a transient spawn-timeout under load (the epoch-9 fan-out teardown in the repro) false-refuses a correctly-configured resume. This change drops `--selftest` as the reachability signal for all seven CLI-backed guardrails and gates each on an operator-owned condition instead, so every refusal names something the operator can fix.

**Design principle — a refusal must name a consumer-fixable condition.** The bug's Expected clause is the governing constraint: any refusal must name config that is missing/invalid, or an unmet runtime condition the operator can resolve. "A subprocess selftest exited non-zero" fails this test — it is neither, and it is what we are removing. Reject any replacement whose refusal text an operator cannot act on.

**Design principle — fail-closed, no reduced mode, stays.** Per ADR-0036 and the FAFF-225 spec, a keystone reachability fault refuses; there is no keystone-absent reduced mode, and `degrades[]` exists only for specific pre-blessed softenings (host-socket attestation, corrective-integrity no-declaration, budget-metering estimate-only-with-warn). Loosening fail-closedness is a materially larger and separately-owned decision. Reject any implementation that adds a new soft-proceed path for a genuinely-unmet guardrail condition. We change *what* is probed, never *whether a real miss refuses*.

**Design principle — the launch gate must not run tests.** A subcommand's tests may be legitimately red or in flux on a faff-dev run, where runs are expected to break and be recorded. Test-passing is a CI/ship concern. Reject any replacement that re-executes a guardrail's regression suite, in whole or in part, as a launch gate.

**Reference context.**

| System | File / lines | Relevance |
|---|---|---|
| The bad probe | `plugin/skills/faff/bin/lib/lights-out.js:536-541` | `probeContractReachable` — the 20s `--selftest` spawn being removed |
| The reachability loop | `plugin/skills/faff/bin/lib/lights-out.js:798-803` (inside `assembleLightsOutPreflight`, 775-910) | Populates `reachable{}`; shared byte-for-byte by mint (`cmdLightsOut`, call at 746) and resume (`resumeLightsOut`, call at 1126) |
| Armed-state derivation | `plugin/skills/faff/bin/lib/lights-out.js:275-289` | `lightsOutArmed`; line 285 maps `reach[id] ? "live" : "absent"` for the six non-container, non-spec_review guardrails |
| The refusal | `plugin/skills/faff/bin/lib/lights-out.js:332-339` | Fail-closed loop; line 337 emits the exact bug message |
| Guardrail registry | `plugin/skills/faff/bin/lib/lights-out.js:51-60` | `LIGHTS_OUT_GUARDRAILS` — 8 entries, `container` alone has `probe:null` |
| The correct-shape model | `plugin/skills/faff/bin/lib/lights-out.js:567-571` (`spendTimeCeilingSet`), 816 (`budgetCeilingSet`), 823-824 (`meteringMeasurable`), gates at 372 & 436-449 | Config/filesystem-derived per-run conditions with operator-fixable refusals — the shape to copy |
| Container's real check | `plugin/skills/faff/bin/lib/lights-out.js:801` (`container === "contained"`) | The one guardrail that already checks a real runtime state, not a suite — the model for a genuine state check |
| Install-state check | `plugin/skills/faff/bin/lib/gates.js:905-950` (`scanDoctorDirectory`) | `faff doctor` already owns stale/miscopied-binary detection |
| CLI dispatch registry | `plugin/skills/faff/bin/faff:118` (`COMMANDS`), `:248` (`handler = COMMANDS[sub]`), `:713` (`binPath = process.argv[1]`) | The probed `binPath` **is the running entrypoint**; its handlers are present by construction |
| The flaky test | `test/lights-out.test.mjs:483-499` | The one place `probeContractReachable` runs for real — the structurally flaky integration test |

**Scope statement.** This sits at the L4 lights-out launch gate (`assembleLightsOutPreflight` → `lightsOutPreflight`), the entry/resume admission decision for an unattended run; it does not touch the guardrails themselves, their runtime enforcement, or any L1–L3 path.

## 2. OUT OF SCOPE

- **Loosening the fail-closed stance / adding a keystone-absent reduced mode.** Why excluded: settled doctrine (ADR-0036, FAFF-225 spec); a materially larger, separately-owned decision. Extension point: a future ADR revising ADR-0036 plus the `degrades[]` construction in `lightsOutPreflight` (`lights-out.js:328` onward).
- **The guardrails' own runtime enforcement and their `--selftest` suites.** Why excluded: the suites remain valid CI/ship-time regressions (`admissibleSelftest`, `contractSelftest`, `runDoneSelftest`, `budgetSelftest`, `eventsSelftest`, `sentrySelftest`, `holdoutVerdictsSelftest`); only their use as a *launch gate* is wrong. Extension point: each guardrail's `lib/*.js` selftest, still invoked by `faff <sub> --selftest` and by CI.
- **A version/build handshake between the runner and the guardrail binaries.** Why excluded: no `--version` or handshake exists anywhere today; whether one is warranted is the subject of the linked spike **FAFF-902** (see §7). Extension point: `faff doctor` (`lib/gates.js`) or a new `faff <sub> --version` surface, owned by FAFF-902.
- **The container guardrail's probe.** Why excluded: `container` (`probe:null`) already checks a real runtime state (`container === "contained"`) and is exactly the model we are moving toward. It stays as-is.
- **The already-correct dedicated budget gates.** Why excluded: `budgetCeilingSet` (`budget-ceiling`, line 372) and `meteringMeasurable` (`budget-metering`, lines 436-449) already gate operator-owned conditions with actionable refusals; this change *reuses* them, it does not rewrite them.
- **Per-run condition gates for events/sentry/holdout.** Why excluded: the human decision (alec, 2026-08-23) settled these three as **structural floor only** — no new per-run I/O gate is added (see §7, resolved decision 1). Extension point: should the bounded false-admit residual later prove to warrant it, a dedicated per-run gate modelled on budget's pair could be added on the resume path only (the mint path has no run-dir).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Reachability floor | The minimal launch check that a guardrail's subcommand is a live, invocable dispatch target of the running faff entrypoint — a structural presence check, never a suite run. |
| Consumer-owned condition | A config- or run-state fact the operator can inspect and fix (a ceiling being set, this run's transcripts being readable), as opposed to a library regression result. |
| Dedicated condition gate | A named refusal in `lightsOutPreflight` that tests one consumer-owned condition (e.g. `budget-ceiling`), distinct from the per-guardrail reachability loop. |
| Structural presence | A guardrail's handler resolving as a registered dispatch target of the running binary, established without executing the guardrail — the honest replacement for `--selftest` where no per-run state exists. |

**The two guardrail kinds.** The seven CLI-backed guardrails split by whether a per-run consumer condition even exists to check at launch:

| Kind | Guardrails | What "reachable" means at launch |
|---|---|---|
| Pure decision function — no persistent launch-state | admissibility, terminating (run-done), spec_review's contract leg | Structural presence only: the subcommand is a live dispatch target. There is nothing operator-owned to sample until the function is *called* later with real inputs. |
| Has a per-run consumer condition | budget, observability (events), kill_switch (sentry), holdout | Structural presence floor. Budget additionally carries its two existing dedicated condition gates (`budget-ceiling`, `budget-metering`). Observability, kill_switch, and holdout are **floor-only** — no new per-run gate is added (human decision, alec, 2026-08-23; see §7 resolved decision 1). |

**Type / interface changes.** The `probes` object shape (`lights-out.js:870-888`) and the pure `lightsOutPreflight`/`lightsOutArmed` contract are preserved; `reachable{}` keeps its `{id: boolean}` shape so the synthetic-probe unit tests (`allReach()`, `mintFixtureLedger`) and the banner/ledger consumers are unaffected. What changes is *how `reachable[id]` is computed*:

```
FUNCTION guardrailReachable(knownCommands, guardrail) -> boolean
  # Replaces probeContractReachable's role in the loop for CLI-backed guardrails.
  # NON-SPAWNING structural presence: is guardrail.probe a key of the running
  # entrypoint's dispatch registry? binPath == process.argv[1] (the running binary),
  # so its COMMANDS registry has every shipped handler by construction. The ONLY
  # way this returns false is a faff-internal wiring drift: a
  # LIGHTS_OUT_GUARDRAILS[i].probe string that names no COMMANDS key in the same
  # build — a code bug, not an operator condition. knownCommands is passed in (see
  # the Assumes block) so the false case is unit-testable without a real registry.
  RETURN guardrail.probe in knownCommands
```

**What the floor can and cannot detect (do not overstate it).** Because the check is an in-process lookup against the running process's own `COMMANDS` literal and `binPath === process.argv[1]`, the floor is true by construction for any faff that booted far enough to reach the preflight. It is therefore a **wiring-bug backstop** — the same class as the static floor entries the code already carries (`lights-out.js:64-69`), catching only an internal drift between a `LIGHTS_OUT_GUARDRAILS[i].probe` string and the `COMMANDS` keys of the same build. It does **not** detect a stale, miscopied, or corrupt *install*: a copied-not-symlinked skill tree still ships a self-consistent `COMMANDS` + `LIGHTS_OUT_GUARDRAILS` pair and would pass the floor while running an old `lib/*.js`. That residual belongs to `faff doctor` and the version/build-handshake spike **FAFF-902** (see §7 resolved decision 2), not to this floor — and the refusal text must name the fault the floor actually detects (an internal wiring drift, a build bug), never a re-link that cannot fix it.

**Design decision — reachability floor: in-process registry lookup vs a cheap `--help` spawn.** A `<bin> <sub> --help`-class spawn is still a subprocess with a timeout that can, however rarely, flake under extreme contention — the exact failure class we are removing — and still crosses a process boundary for a fact the running process already holds. An in-process check against the running entrypoint's dispatch registry (`COMMANDS`) crosses no boundary, cannot time out, and is faithful because `binPath === process.argv[1]`: the code running the preflight is the code that will run the guardrails. **Chosen:** in-process structural presence against the running entrypoint's command registry; no subprocess, no timeout, in the reachability floor. (`--help` spawn rejected in the rationale section.)

**Design decision — budget guardrail: retire its `--selftest` reach.** Budget's consumer-owned conditions already exist as two dedicated, actionable gates: `budgetCeilingSet` (`budget-ceiling`, line 372) and `meteringMeasurable` (`budget-metering`, lines 436-449). The `probe:"budget"` reachability leg adds only the flaky `budgetSelftest` spawn on top and refuses with the un-actionable message. **Chosen:** budget's reachability leg collapses to the structural presence floor (live on any healthy install); its real refusals are carried by the two existing dedicated gates, unchanged.

**Design decision — spec_review guardrail: retire its `contract --selftest` reach.** spec_review is already double-gated by slot liveness: `specReviewSlot` (`assembleLightsOutPreflight:810`) resolves the configured occupant and its reachability, refusing at `spec_review-slot` (line 370) when the admission-gating slot is down. The `contract --selftest` probe — which runs *every* registered contract's fixtures (~204ms, dozens of suites), not just the spec-review-verdict one — is largely redundant with that slot check. **Chosen:** spec_review's reachability leg collapses to the structural presence floor of `faff contract`; the operator-owned condition remains the existing `specReviewSlot` gate.

**Design decision — admissibility and terminating: floor only.** Both are pure call-time decision functions over inputs supplied when they are *invoked* mid-run; there is no persistent launch-state to sample at preflight. Inventing a semantic condition for them would fabricate a check with nothing real behind it. **Chosen:** structural presence floor only for admissibility and terminating (run-done). A `probe` string that names no registry key still refuses — a wiring-bug backstop, naming the internal drift it detects (see the floor's can/cannot-detect note above), not an install remedy.

**Design decision — observability, kill_switch, holdout: floor only (human decision).** These three have a per-run consumer condition in principle (an appendable `events.jsonl`, a readable ledger, an invocable holdout verdict), but the human decision (alec, 2026-08-23) settled them as structural floor only. **Chosen:** structural presence floor only for observability, kill_switch, and holdout; add no new per-run condition gate. Rationale and the bounded residual are in §7 resolved decision 1.

## 4. HOW — Behavior

**Architecture.** The single edit surface is `assembleLightsOutPreflight` (`lights-out.js:775-910`), shared by both the mint path (`cmdLightsOut`, call at 746) and the resume path (`resumeLightsOut`, call at 1126), so one change fixes entry and resume together. The reachability loop (798-803) stops calling `probeContractReachable` and instead computes each CLI-backed guardrail's `reachable[id]` via the non-spawning structural presence check. `probeContractReachable` (536-541) is deleted. `container` (`probe:null`) is untouched — it keeps `reachable[container] = container === "contained"`. Everything downstream (`lightsOutArmed`, `lightsOutPreflight`, the banner, the ledger) is unchanged because `reachable{}` keeps its shape and meaning ("is this guardrail live").

**Reachability loop — before and after.**

```
PROCEDURE build_reachable(entrypoint, container_result):
  FOR each guardrail g in LIGHTS_OUT_GUARDRAILS:
    IF g.probe == null:                          # container — unchanged
      reachable[g.id] = (container_result == "contained")
    ELSE:                                          # the seven CLI-backed guardrails
      # OLD: reachable[g.id] = spawnSync(<bin> <g.probe> --selftest, 20s) exit==0
      # NEW: reachable[g.id] = g.probe resolves in the entrypoint's command set
      reachable[g.id] = guardrailReachable(knownCommands, g)  # knownCommands threaded in
  RETURN reachable
```

**The refusal message must change too.** When structural presence fails, the refusal in `lightsOutPreflight` (line 337) must stop saying "its CLI contract failed the launch reachability probe" and instead name the fault the floor actually detects — a faff-internal wiring drift (a guardrail's `probe` string names no dispatch-registry key in this build), which is a code/build bug, not an operator config or install condition. It is a `faff doctor`-visible build-integrity fault only in the sense that a broken build should never have shipped; the message must not promise a re-link fixes it. Wording it as "missing install, run `faff doctor` and re-link" would repeat the exact sin the WHY principle forbids (a refusal naming a condition the operator cannot act on), because a copied-not-symlinked install still passes the floor:

```
PROCEDURE refusal_for(id, state):
  IF id == "container":                            # unchanged
    RETURN existing container message
  ELSE:
    # Names the internal fault the floor detects — a build/wiring bug, not a
    # consumer condition. This branch fires only on a broken faff build.
    RETURN { gate: "guardrail:"+id,
             detail: id+" guardrail command is not registered in this faff build"
                   + " ("+state+") — the guardrail's probe subcommand resolves to no"
                   + " dispatch handler, which is a faff build/wiring defect, not a"
                   + " run condition. This build should not ship; run `faff doctor`"
                   + " to confirm the install and re-obtain a correct build."
                   + " Fail-closed, no reduced mode." }
```

**Behavior summary — budget/spec_review collapse.** Budget and spec_review keep firing their real, actionable refusals from the dedicated gates that already exist; only their redundant, flaky reachability legs collapse to the structural floor. On a healthy install with a well-formed ceiling and readable transcripts, `armed.budget == "live"` and no `guardrail:budget` refusal fires — matching the "plain retry admits the run" behaviour the operator already sees intermittently, but now deterministically.

**Edge cases and error handling.**

- **Faff-internal wiring drift (probe string names no registry key).** Structural presence returns false → the guardrail is `absent` → fail-closed refusal naming the build/wiring defect. Terminal (not retryable): re-running won't fix a broken build; a correct build must be re-obtained. This is a code-integrity backstop, the only fault the floor can detect — a broken faff build that should never have shipped.
- **Stale/miscopied but self-consistent install.** A copied-not-symlinked skill tree ships a consistent `COMMANDS` + `LIGHTS_OUT_GUARDRAILS` pair, so the floor passes even though `lib/*.js` may be old. The floor does **not** catch this — it is the deliberate residual owned by the version/build-handshake spike **FAFF-902**, and `faff doctor`'s install-state check surfaces it out-of-band on entry. This is a genuine reduction from the old `--selftest` probe (which executed each guardrail's real suite and could catch a booted-but-stale backing module); see the failure-modes note below.
- **Transient host load (the repro).** No subprocess, no timeout → structural presence is unaffected by load → no false refusal. The failure class that motivated FAFF-899 is eliminated by construction, not merely made less likely.
- **faff-dev run with red guardrail tests.** No suite runs at launch → a red or in-flux `<sub> --selftest` no longer blocks the run. The run proceeds and is recorded, as faff-dev expects.
- **container guardrail.** Untouched: `container === "contained"` still gates, still refuses with its own message.
- **Synthetic-probe unit tests.** `reachable{}` keeps `{id: boolean}`, so `allReach()`/`mintFixtureLedger` fixtures and every pure `lightsOutPreflight` test continue to pass without change.

**Anti-pattern:** re-running any part of a guardrail's `--selftest` suite (even a single named contract, or a `--help`-class spawn with a shorter timeout) as the launch gate. Why: it re-imports the ship-time question and the timeout-flakiness class this issue exists to remove.

**Anti-pattern:** collapsing budget's or spec_review's reachability leg by *deleting* their existing dedicated condition gates (`budget-ceiling`, `budget-metering`, `spec_review-slot`). Why: those gates are the operator-owned conditions we are keeping; only the redundant selftest leg goes.

**Failure modes.**

- **The failure:** structural presence is *too* permissive in the false-admit direction — the old `--selftest` probe ran each guardrail's real regression suite in a subprocess, so it could catch a booted install whose subcommand is *registered* but whose backing implementation module is stale, corrupt, or miscopied (a skill tree copied rather than symlinked, running an old `lib/*.js`). The new floor confirms only that the `probe` string resolves to a registry key, which is essentially always true — so it trades a live false-*refuse* bug for a rarer false-*admit* of a booted-but-stale guardrail. This is a genuine reduction of the fail-closed gate's discriminating power, in the more-dangerous direction, and must not be understated. (Note: the old probe also ran from `process.argv[1]`, so *divergent-`binPath`* was never covered by either mechanism — the real loss is the stale-backing-module case, not a divergent path.) **How you'd know:** a `faff doctor` run reports `COPY — not dev-linked` / dangling while a lights-out run still admits. **What it means:** proceed on the core fix, but own the residual — `faff doctor` is an operator-invoked, out-of-band check, **not** on the admission path, so for a fail-closed L4 gate it is a weak bound. The compensating control (a version/build handshake) is filed and linked as **FAFF-902** (human decision, alec, 2026-08-23) — a tracked follow-up spike, so the residual is owned rather than lost at close; `faff doctor` surfaces it out-of-band in the interim.
- **The failure:** for observability/sentry/holdout, the structural floor alone may under-check — a healthy install whose *run-specific* condition (unwritable `events.jsonl`, an unreadable ledger) is broken would admit, where the old suite (for events, with its real I/O) might have caught it. **How you'd know:** a lights-out run admits, then the guardrail fails at first real use mid-run. **What it means:** this residual is **accepted by human decision** (alec, 2026-08-23): floor-only for these three. The mint/resume run-dir asymmetry makes a per-run I/O gate awkward (no run-dir exists at mint) and the false-admit is bounded — the guardrail's own runtime enforcement still catches the broken condition at first real use mid-run. The floor fixes the false-*refuse* bug for all seven guardrails; no dedicated launch gate is added for events/sentry/holdout (see §7 resolved decision 1).

## 5. Scenarios

```
Given a correctly-configured, resumable L4 run (a well-formed spend ceiling set,
      transcripts readable, every guardrail subcommand present in the install)
When the operator runs `faff lights-out --resume <run> --check` immediately after an
      epoch fan-out teardown that spikes host load
Then the run is admitted (proceed:true, refusals:[]) with no dependence on any
      subprocess completing within a timeout
```

```
Given a healthy install under transient load
When the L4 preflight computes guardrail reachability
Then no `<bin> <sub> --selftest` subprocess is spawned for any of the seven CLI-backed
      guardrails, and reachability cannot be refused by a spawn timeout
```

```
Given a faff-dev install where `faff events --selftest` currently exits non-zero
      (a guardrail's own tests are red or in flux) but the events subcommand is present
When the L4 preflight computes the observability guardrail's reachability
Then observability is armed `live` and no `guardrail:observability` refusal is emitted —
      test-passing is not a launch gate
```

```
Given a broken faff build whose `LIGHTS_OUT_GUARDRAILS` names a `sentry` probe that
      resolves to no dispatch-registry key (a build/wiring drift)
When the L4 preflight computes the kill_switch guardrail's reachability
Then the run refuses fail-closed with a `guardrail:kill_switch` detail that names the
      internal build/wiring defect (the probe resolves to no handler in this build),
      not a re-link remedy and not a selftest exit code
```

```
Given a stale-but-self-consistent faff install (skills copied not symlinked, so
      `COMMANDS` and `LIGHTS_OUT_GUARDRAILS` still agree, running an old `lib/*.js`)
When the L4 preflight computes any CLI-backed guardrail's reachability
Then the structural floor PASSES (the probe resolves) and the run is admitted — this
      false-admit residual is owned by the FAFF-902 spike and `faff doctor` surfaces it
      out-of-band; the floor deliberately does not catch it
```

- The refusal text for any non-`live` non-container guardrail names either a consumer-fixable condition (missing/invalid config, an unmet runtime condition) or — for the structural floor — the internal build/wiring defect it detects, never "a subprocess selftest exited non-zero" and never a re-link remedy the fault cannot be fixed by.

## 6. Design Decision Rationale

**How should each guardrail's launch reachability be computed, given the probe re-ran ship-time tests?**
- *Keep `--selftest`, add retries / a longer timeout.* Pro: smallest diff. Con: still tests the shipped library not the operator's config, still blocks red-test faff-dev runs, still crosses a process boundary; retries only paper over the flakiness. Rejected — it does not satisfy the "refusal names a consumer-fixable condition" principle.
- *Replace with operator-owned conditions, per guardrail.* Pro: every refusal becomes actionable; the flaky timeout class is removed; faff-dev is unblocked. Con: two guardrails (admissibility, terminating) have no per-run condition, so "operator-owned" degenerates to structural presence for them.
- **Chosen:** replace `--selftest` reachability with a non-spawning structural presence floor for all seven CLI-backed guardrails, plus the existing dedicated condition gates for budget (the only guardrail with a real per-run condition kept as a launch gate) — fail-closed stance unchanged.

**Should the fail-closed, no-reduced-mode stance change?**
- *Add a soft-proceed for an unmet guardrail.* Con: contradicts ADR-0036 and the FAFF-225 spec; `degrades[]` is reserved for pre-blessed softenings; a far larger, separately-owned decision. Rejected.
- **Chosen:** keep fail-closed exactly; change only the signal being tested. A genuinely-unmet condition still refuses.

**Reachability floor mechanism: in-process registry lookup vs a cheap `--help` spawn?**
- *`<bin> <sub> --help` with a short timeout.* Pro: exercises the real binary at `binPath`. Con: still a subprocess with a timeout that can flake under extreme contention — the removed failure class — and `binPath === process.argv[1]`, so it re-probes the running binary. Rejected.
- **Chosen:** in-process structural presence against the running entrypoint's command registry (`COMMANDS`). No subprocess, no timeout, faithful because the preflight runs from the same tree that runs the guardrails.

**Budget guardrail — reuse the existing dedicated gates or invent a new condition?**
- **Chosen:** reuse `budgetCeilingSet` (`budget-ceiling`) and `meteringMeasurable` (`budget-metering`); collapse the reachability leg to the structural floor. Budget already demonstrates the correct shape; adding a third budget condition would be redundant.

**spec_review guardrail — keep the `contract --selftest` probe or lean on slot liveness?**
- **Chosen:** lean on the existing `specReviewSlot` gate (`spec_review-slot`); collapse the `contract` reachability leg to the structural floor. The contract selftest runs dozens of unrelated contract fixtures and is redundant with the slot-liveness check.

**admissibility and terminating — what replaces `--selftest` where there is no per-run state?**
- **Chosen:** structural presence floor only. These are pure decision functions invoked mid-run with real inputs; there is no launch-time operator-owned state to sample, and fabricating one would be a check with nothing behind it. A `probe` string that resolves to no registry key still refuses — the wiring-bug backstop naming the internal drift it detects.

**observability, kill_switch, holdout — floor only, or add a per-run condition gate?**
- *Add a dedicated per-run gate for each (append/read this run's `events.jsonl`; `faff sentry check --run-dir <dir>`; `faff holdout verdict`), modelled on budget's pair.* Pro: closes the false-admit residual for these three on the admission path. Con: the mint/resume asymmetry — at mint no run-dir exists yet, so the gate could only fire on resume, giving an uneven guarantee; the false-admit residual is bounded because each guardrail's runtime enforcement still catches a broken condition at first real use.
- **Chosen (human decision, alec, 2026-08-23):** structural floor only for observability, kill_switch, and holdout; add no new per-run gate. The floor plus the existing dedicated config gates fix the false-refuse bug; the bounded false-admit residual is accepted. See §7 resolved decision 1.

## 7. Resolved Decisions and Assumptions

**Resolved architecture decisions (human decision — alec, 2026-08-23, comment on FAFF-899).** Both Punts the medium-confidence spec escalated were closed by the human, each toward the direction this spec already recommended.

**Chosen (resolved decision 1 — per-run condition gates for events/sentry/holdout): structural floor only, no new per-run gate.** The in-process structural-presence floor plus the guardrails' existing dedicated config gates fix the false-refuse bug. A per-run I/O condition gate (append/read this run's `events.jsonl`; `faff sentry check --run-dir <dir>` against this run's ledger; `faff holdout verdict`) modelled on budget's pair is deliberately **not** added, for two reasons the human decision settled: (1) the **mint/resume asymmetry** — at mint no run-dir exists yet (the run is minted only *after* this preflight; see the corrective-integrity note at `lights-out.js:791-794`), so any run-specific I/O condition could only be checked on the resume path, not at entry, giving an uneven guarantee; (2) the **false-admit residual is bounded** — a healthy install whose run-specific condition is broken (unwritable `events.jsonl`, unreadable ledger) fails at first real use mid-run, where the guardrail's own runtime enforcement still catches it, so the launch gate is not the only line of defence. Fix the live false-refuse for all seven guardrails now; do not expand launch-gate surface with an awkwardly-asymmetric per-run I/O check.

**Chosen (resolved decision 2 — stale-backing-module residual): ship the core fix; file the version/build handshake as a spike.** `faff doctor`'s install-state check (`scanDoctorDirectory`, real dirs vs repo symlinks) surfaces the stale/miscopied-install fault out-of-band for now. The version/build handshake (a `faff <sub> --version` / build-hash compared against the runner's own build at preflight, to refuse a stale backing module *on the admission path*) is a separately-owned de-risking spike, **filed and linked as FAFF-902** (created 2026-08-23 from this decision, `relatedTo` FAFF-899). It does **not** block FAFF-899. The residual is therefore owned by a tracked, linked ticket rather than lost at close — no floating note, no in-scope handshake work here.

**Assumptions.**

**Assumes:** the running faff entrypoint exposes its dispatch registry so the reachability floor can test "is `<probe>` a live command" in-process. **Chosen wiring:** thread the set of known command keys *into* `assembleLightsOutPreflight` (and on into `guardrailReachable(knownCommands, guardrail)`) as a parameter, rather than having `lights-out.js` read a module-level `COMMANDS` directly. This is required, not optional: passing the command set as an argument is what makes the "guardrail-absent → false" unit case reachable with a fixture set (no real registry needed) — a bare module-level read would leave the false branch untestable. Validation: export `COMMANDS` from `plugin/skills/faff/bin/faff:118` (currently a non-exported `const`) or hand the entrypoint's command-key set to the preflight at the call sites (`cmdLightsOut:746`, `resumeLightsOut:1126`); `binPath === process.argv[1]` (line 713) guarantees the registry belongs to the binary that will run the guardrails.

**Assumes:** each guardrail's `probe` value in `LIGHTS_OUT_GUARDRAILS` (`admissible`, `contract`, `run-done`, `budget`, `events`, `sentry`, `holdout`) is a `COMMANDS` key. Validation: cross-check the seven `probe` strings against the `COMMANDS` registry keys; on a healthy install all seven must resolve, and the integration test at `test/lights-out.test.mjs:483` asserts exactly that.

## 8. DONE — Definition of Done

### From WHY
- [ ] No L4 guardrail refusal text on any path attributes the refusal to a subprocess selftest exit; every non-container guardrail refusal names either a consumer-fixable condition (missing/invalid config, unmet runtime condition) or, for the structural floor, the internal build/wiring defect it actually detects — never a re-link remedy the floor's fault cannot be fixed by.
- [ ] The fail-closed, no-reduced-mode stance is preserved: a genuinely-absent guardrail handler still refuses (no new soft-proceed path added).

### From WHAT (types and interfaces)
- [ ] `probeContractReachable` (`lights-out.js:536-541`) is removed and no launch-path code spawns `<bin> <sub> --selftest`.
- [ ] `reachable{}` retains its `{id: boolean}` shape; `lightsOutArmed` and `lightsOutPreflight` signatures are unchanged; existing synthetic-probe tests (`allReach`, `mintFixtureLedger`) pass unmodified.
- [ ] The reachability floor is non-spawning (in-process structural presence against the running entrypoint's command registry) and cannot time out.
- [ ] Budget's reachability leg collapses to the structural floor; `budget-ceiling` (line 372) and `budget-metering` (436-449) remain the operator-owned budget refusals, unchanged.
- [ ] spec_review's reachability leg collapses to the structural floor; `spec_review-slot` (line 370) remains its operator-owned refusal.
- [ ] admissibility and terminating are gated by the structural floor only (no fabricated semantic condition).
- [ ] observability (events), kill_switch (sentry), and holdout are gated by the structural floor only — no new per-run condition gate is added (human decision, alec, 2026-08-23); their runtime enforcement and any existing behaviour are unchanged.

### From HOW (behaviour)
- [ ] The single edit is in `assembleLightsOutPreflight` (798-803), fixing both the mint (call at 746) and resume (call at 1126) paths.
- [ ] `container` (`probe:null`) reachability is unchanged (`container === "contained"`).
- [ ] A correctly-configured resumable run under transient load is admitted with `proceed:true, refusals:[]` and no dependence on a timeout.
- [ ] A faff-dev install with a red `<sub> --selftest` for a *present* subcommand arms that guardrail `live` and emits no `guardrail:<id>` refusal.

### From HOW (edge cases)
- [ ] A `probe` string that resolves to no dispatch-registry key (a faff build/wiring defect) refuses fail-closed with a `guardrail:<id>` detail naming the internal build defect — not an install/re-link remedy.

### From tests
- [ ] `guardrailReachable` takes the known-command set as a parameter (threaded in), so a pure unit test drives the guardrail-present → true and guardrail-absent → false cases with a fixture command set, mirroring `budgetSelftest`'s no-spawn style and never spawning a subprocess.
- [ ] `test/lights-out.test.mjs:483-499` is updated to assert the new reachability semantics (every guardrail's `probe` resolves in the registry and admission proceeds) rather than "every subprocess selftest exits 0".
- [ ] No preflight code path calls `spawnSync` for guardrail reachability — asserted deterministically (e.g. `probeContractReachable` is deleted and no `--selftest` spawn is reachable from `assembleLightsOutPreflight`), never via a wall-clock/timing assertion (which is the flakiness class this ticket removes).

### From follow-ups
- [ ] The version/build-handshake residual is owned by the tracked, linked follow-up **FAFF-902** (already filed 2026-08-23 and `relatedTo` FAFF-899, per resolved decision 2); the build agent keeps that link intact and does **not** re-file a duplicate. No handshake work is done in FAFF-899 itself.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. On a healthy contained install, run `faff lights-out --root <tmp> --max 5 --json`.
  2. Assert proceed == true, container == "contained", 8 armed guardrails all "live".
  3. Assert DETERMINISTICALLY that no guardrail-reachability subprocess spawn is
     reachable from the preflight path (probeContractReachable removed; no `--selftest`
     spawn call site remains) — a structural/source assertion, NOT a timing/wall-clock
     one.
  4. Assert refusals == [] and the run is minted (`.faff` exists under root).
```

confidence: high
spec-review: approve
build-tier: complex

## Methodology critique

**Right-sized?** No issues. The change is one coherent edit to the shared `assembleLightsOutPreflight` (used byte-for-byte by both mint and resume), plus a new pure unit test and a fix to one flaky integration test: a single 1-3 day unit. The two follow-on questions have been resolved by human decision (floor-only; handshake carved out to FAFF-902), so the scope is now closed rather than punted, and the seven guardrails move through one shared signal-swap, not seven independent concerns — nothing to split and no always-ships-together sibling to merge.

**Workstream fit?** No issues. The project "A current unattended run survives executor loss at safe boundaries" is outcome-named, and this bug sits inside that outcome: the false-refuse hits the resume path, so a run that lost its executor is wrongly blocked from resuming at a safe boundary. The mint path is repaired by the same shared function, which is incidental breadth from the single edit surface, not a second outcome bundled in.

**Deps surfaced?** No issues. The new refusal message redirects operators to `faff doctor` to confirm the install and re-obtain a correct build; the residual that `faff doctor` may not catch the stale/miscopied-binary fault on the admission path is now owned by the linked spike **FAFF-902** (resolved decision 2), not an implicit dependency. The other named artefacts need no links: `budgetCeilingSet`, `meteringMeasurable`, `specReviewSlot`, and the `COMMANDS` registry exist today, and ADR-0036 and FAFF-225 are doctrine references, not work prerequisites.

**Risk profile?** No issues (residual owned). The structural-presence floor confirms the command is registered, not that the backing module is current or correct; the old `--selftest` ran the guardrail's own suite. For a fail-closed L4 launch gate, admitting a structurally-present but stale/miscopied binary is the more dangerous direction of error than the false-refuse this ticket fixes — so the residual is deliberately isolated into a separate de-risking decision, **FAFF-902**, which is the right shape (de-risk apart from the main change). With that spike filed and linked, the residual exposure is tracked and not lost when this ticket closes.

---
_Prepped autonomously (run run-20260823-130634-beepboop-full-926c42, L3); refreshed autonomously (run run-20260827-065909-beepboop-list-0e6161, L3) on 2026-08-27 to fold in the human decision (alec, 2026-08-23) closing both architecture Punts — floor-only for events/sentry/holdout, version/build handshake filed as FAFF-902. Spec-review re-run on the refreshed spec: approve (single-pass architectural/infosec/QA lenses, L3). Confidence: high — no open Punt escalates a genuine architecture question; both were closed by human decision toward the spec's recommended floor-only direction._
