**Spec folded + re-rated (tidy 2026-07-10)** — Punt 1 → Chosen (human decision above), Punt 2 externalised to its fork ticket. Supersedes the 01:34Z render.

# Spec — FAFF-325: Corrective-integrity activation half — trusted attestation signal + merge-floor consumer

> Spec: faff-tidy-refresh · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-325.
> Revised on 2026-07-10 — Punt 1 folded (human decision 2026-07-10: refuse at L4 only, enforced at the run-start preflight; annotate at L1–L3); Punt 2 externalised to FAFF-420.

*Build spec for the ACTIVATION half only. The fail-safe half SHIPPED as FAFF-373 (PR #277, merged 2026-07-05): inert `correctiveIntegrityProbe` (`asserted:false` for all inputs, `bin/faff:5103`), `integrityGate` with closed `corrective|detection` vocabulary (`:5116`), `correctiveIntegrityDirs` covering `corrective/` + `run-ledger.json` (`:5130`), the `corrective_authority: available|channel-D-only` lights-out flag (`:13745`), `test/corrective-integrity.test.mjs`. Everything below builds on that shipped surface — do not re-ship it.*

## 1. WHY

Under shared uid+fs the build lane can forge any on-disk artifact the orchestrator trusts (FAFF-278; `bin/faff:1683` guardrail-not-crypto). FAFF-373 made distrust the default. This ticket ships the only path *to* trust — the un-forgeable attestation the probe's inert `signal` seam was left for — and, per the FAFF-316 frontier audit (finding F1), extends the boundary to the **highest-stakes consumer: the merge floor**.

`cmdMergeGate` re-reads three build-lane-writable artifacts before code reaches `main` — `<run-dir>/<issue>/ac-checklist.json`, `<run-dir>/<issue>/review-verdict.json`, `.faff/holdout/<issue>.json` (`bin/faff:15029–15060`). It re-validates their *content* (`computeReviewVerdict` / `holdoutGateResult`) but cannot tell **who wrote them**: a build lane writing a well-formed `{code_blind:true, aggregate:"meets-spec"}` passes the L4 gate. That is the unguarded back door in the "self-grading is prevented" story — same forge root as Channel A, different (and higher-stakes) consumer.

## 2. OUT OF SCOPE

- **The fail-safe half** — SHIPPED (FAFF-373). This spec never re-specifies the probe/gate/flag skeleton.
- **The read-only mount provision + setting the pid-1 declaration** — outer layer (rung-1 / claude-box-class); assert-don't-implement (ADR-0010/0041). Nothing here *creates* the boundary; with no mount+declaration the probe stays `asserted:false` and nothing activates.
- **Channel A itself** — FAFF-326 (consumes this gate). **Fleet/multi-writer** — FAFF-327.
- **`consumer="detection"` semantics/strength** — owned by FAFF-324 (edge drawn; thin enum stays thin here).
- **faff-built signatures/HMAC** — settled rejection (`bin/faff:1683`; ADR promotion intent already recorded).
- **readHoldout freshness/containment hardening** — forked to its own ticket, FAFF-420 (see §3).

## 3. WHAT

**Chosen (attestation channel — human decision 2026-07-05, carried forward unchanged):** outer-layer launch-time declaration `FAFF_INTEGRITY_BOUNDARY=<version>:<ro-dir-set>`, read **only** from pid-1 environ via the injectable `fsq.readEnviron("/proc/1/environ")` (the shipped `containerCheck` read) — **never** the CLI's inherited process env (shells here source profile files on the shared fs, so inherited env is build-lane-poisonable). Trust-the-launcher: same trust class as the cage launch itself; exec-fixed, sibling-unwritable. Verified per-lane assert-in upgrades with FAFF-276 (recorded deliverable line there).

**Probe rule (wires the shipped inert `signal` seam):** `asserted:true` ONLY on — declaration present in pid-1 environ ∧ well-formed ∧ its dir set ⊇ the explicitly-passed integrity dirs. All other outcomes are `asserted:false`, and the `basis` field now distinguishes the two classes the disposition matrix needs:

- **Absence** — `basis:"no-declaration"`: nothing in pid-1 environ (the honest rung-0 / unasserted case).
- **Violation** — `basis:"env-injection"` (declaration in process env but absent from / differing from pid-1 environ), `"malformed"`, or `"dir-mismatch"`: a declaration exists but fails verification — tamper evidence or misconfiguration.

**New scope from F1 (the audit fold):**

- **`consumer="merge-floor"`** added to `integrityGate` + the CLI's closed `--consumer` vocabulary.
- **`correctiveIntegrityDirs` extended to the full forge surface:** existing `corrective/` + `run-ledger.json` PLUS `<run-dir>/<issue>/ac-checklist.json`, `<run-dir>/<issue>/review-verdict.json`, and the holdout path — the declaration's dir set must cover the merge-floor artifact set or the probe is `asserted:false`. Still single-sourced from the run-dir layout; never a second hand-written list.
- **`cmdMergeGate` call-site wiring:** the gate is consulted before the three artifact re-reads are trusted; the disposition matrix below applies; the merge record + ledger banner **always annotate the integrity basis** (asserted/unasserted/violated), on every decision path.

**Chosen (merge-floor unasserted disposition — human decision, 2026-07-10; closes Punt 1): refuse at L4 only, enforced at the run-start preflight; annotate at L1–L3.**

| Probe state | L4 (lights-out) | L1–L3 |
|---|---|---|
| Absent (`no-declaration`) | **Run refused at the run-start preflight**, remedy named: "set the `FAFF_INTEGRITY_BOUNDARY` declaration in the cage launch config" (the decision comment's `FAFF_CORRECTIVE_INTEGRITY` wording refers to this declaration — one name in code, the settled one above). Fail-fast at admission, never a mid-run merge surprise. Merge-gate defence-in-depth: unasserted at L4 → refuse there too. | Merge proceeds; verdict + run digest carry an explicit `integrity: unasserted` annotation — visible, never silent. |
| Violated (`env-injection` / `malformed` / `dir-mismatch`) | **Refuse the merge** (and refuse at L4 preflight, naming the specific fault). | **Refuse the merge.** Violation is never level-graded. |
| Asserted + clean | Merge proceeds; annotated `integrity: asserted`. | Same. |

**Rationale (from the decision):** matches the house level-grading (mandatoryRemap / holdout / admissibility are all L4-pinned); the threat F1 names — a build lane forging its own merge-floor artifacts — only has teeth with no human watching; and the L4 remedy is one launch-config line on a path ADR-0010 already mandates (the cage), so refusing there subtracts nothing real. L3 drains are not cage-mandated, so refusing there would force the declaration onto ordinary overnight runs — heavier than the threat (a human reviews in the morning).

**Sequencing consequence (replaces the old fork paragraph):** everything is buildable NOW against the inert probe. L1–L3 annotate works immediately (`unasserted` everywhere at rung-0), and the L4 preflight refuse is correct at rung-0 by design — an L4 run without the launch declaration SHOULD refuse; the cage is already mandated there and one config line is the admission fee.

**readHoldout freshness/containment (was Punt 2):** forked to its own ticket — **FAFF-420** (linked in comments); this spec **Assumes:** it lands independently.

## 4. HOW

```
PROCEDURE L4 run-start preflight (lightsOutPreflight, new guardrail):
  p := correctiveIntegrityProbe(env, fsq, signal)      # signal = pid-1 declaration, explicit dirs
  IF p.basis == "no-declaration": REFUSE the run — remedy: "set the FAFF_INTEGRITY_BOUNDARY
    declaration in the cage launch config"
  IF p.basis is a violation basis: REFUSE the run, naming the specific fault

PROCEDURE merge-floor consumption (inside cmdMergeGate, before trusting artifact re-reads):
  1. p := correctiveIntegrityProbe(env, fsq, signal)
  2. g := integrityGate(p, "merge-floor")
  3. IF g.trusted: proceed with the existing content re-validation (unchanged)
     ELIF violation basis: REFUSE the merge (all levels)
     ELSE (unasserted): L4 → REFUSE (defence-in-depth; preflight should have caught it)
                        L1–L3 → proceed; annotate integrity: unasserted
  4. ALWAYS annotate the integrity basis on the merge record + ledger banner
```

**Failure modes (security-critical — carried forward, one added):**

- **Forged trusted-signal** — shared-fs marker, `.faffrc` value, or `export FAFF_INTEGRITY_BOUNDARY=…` into an rc file poisoning inherited env. Must never flip `asserted:true`; only pid-1 environ is read; the injection case is a *violation* basis → refuse.
- **Wrong/narrow dir set** — probe asserts a boundary on dirs X while the merge floor reads Y → planted artifact trusted. Dir set ⊇-match is load-bearing; test each of the three merge-floor artifacts individually.
- **Forged level input (new)** — the disposition matrix keys off the run's level; if `cmdMergeGate` read the level from a build-lane-writable artifact (e.g. the run ledger), a forged "L1" label would downgrade an L4 refuse to annotate-and-proceed. The level MUST arrive via the merge-gate invocation context (flag/config from the orchestrator), never from a shared-fs artifact.
- **False sense of security** — a reader assumes FAFF-325 *creates* the boundary. It only asserts; docs must say so explicitly.

**Anti-patterns (unchanged):** honouring any build-lane-writable signal as asserted; reading the declaration from inherited/shell-sourced env; faff-built HMAC presented as closing the forge.

## 5. SCENARIOS

```
Given no pid-1 declaration (rung-0 reality) and an L1–L3 run
When cmdMergeGate consults integrityGate(probe, "merge-floor")
Then trusted:false, the merge proceeds, and the merge record + run digest show integrity: unasserted
```

```
Given no pid-1 declaration and an L4 lights-out run
When the run-start preflight evaluates
Then the run is refused at admission with the remedy named ("set the FAFF_INTEGRITY_BOUNDARY
declaration in the cage launch config"); no merge gate is ever reached
```

```
Given the build lane exported FAFF_INTEGRITY_BOUNDARY into a shared-fs rc file (any level)
When the probe runs
Then it reads pid-1 environ, finds no matching declaration, returns asserted:false basis env-injection,
and the merge gate refuses (violation is never level-graded)
```

```
Given a pid-1 declaration whose dir set omits <run-dir>/<issue>/review-verdict.json
When the probe evaluates against the merge-floor dirs
Then asserted:false basis dir-mismatch → refuse at all levels (a bypass, not a partial pass)
```

```
Given a well-formed pid-1 declaration covering the full forge surface (outer-layer mount asserted)
When the gate is asked with consumer="corrective" or "merge-floor"
Then trusted:true — FAFF-326 may consume a subtractive corrective input; the merge floor trusts its
artifact re-reads; the merge record shows integrity: asserted
```

## 6. DONE

- [ ] Probe: `asserted:true` only from a well-formed pid-1-environ declaration whose dir set covers the explicitly-passed integrity dirs; `basis` distinguishes `no-declaration` from the violation bases (`env-injection` / `malformed` / `dir-mismatch`). Tests mirror `test/corrective-integrity.test.mjs` (injected fsq, zero real fs) incl. the profile-poison red-team case.
- [ ] `correctiveIntegrityDirs` covers the full forge surface incl. the three merge-floor artifacts; single-sourced; each artifact path individually covered by a test.
- [ ] `integrityGate(p, "merge-floor")` added to the closed consumer vocabulary: trusted when asserted; dispositions per the matrix; unknown consumer still fails safe to channel-D.
- [ ] L4 run-start preflight: absent declaration → run refused with the exact remedy line; violation basis → refused naming the fault. Both tested.
- [ ] `cmdMergeGate`: asserted+clean → merge; violation → refuse at all levels; unasserted → refuse at L4 (defence-in-depth), proceed + annotate at L1–L3; integrity basis annotated on the merge record + ledger banner on every path; the level input arrives via invocation context, never a build-lane-writable artifact (tested with a forged-ledger-level case).
- [ ] `integrity: unasserted` appears in the verdict + run digest on every L1–L3 unasserted merge — never silent.
- [ ] Lights-out `corrective_authority` flips `available` when asserted (existing seam).
- [ ] `node --test` + selftests green; `test/sentry.test.mjs` AC6 no-`correct` guard unaffected.
- [ ] Docs state "asserts, not creates" explicitly.

**Assumes:** the outer layer provides the ro-mount and sets the pid-1 declaration (external — ADR-0041 rung 1; no faff ticket owns mount provision, confirmed against the tracker 2026-07-05). **Assumes:** the integrity-dir set is passed explicitly — the probe never does latest-run discovery (FAFF-337 hazard). **Assumes:** FAFF-324 owns detection-consumer strength (edge drawn). **Assumes:** readHoldout freshness/containment hardening lands independently via FAFF-420.

**Open questions:** none — Punt 1 closed by the 2026-07-10 human decision (folded above); Punt 2 externalised to FAFF-420.

---

confidence: high

spec-review: **approve** — architectural: the level-graded disposition matches the house L4-pinned-gate pattern and the enum/dir-set/cmdMergeGate wiring composes cleanly on the shipped FAFF-373 surface; infosec: fail-closed on every violation basis, pid-1-only read holds, and the one new hole found (forged level input downgrading the matrix) is folded as a failure mode + AC; QA: every AC is injected-fsq testable with no real fs, incl. the preflight refuse and the forged-ledger-level case.
