# Spec — FAFF-892: align the L4 merge-floor corrective-integrity leg with the preflight's digest-custody basis

> Spec: faffter-dark-nlspec · 2026-08-20 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-892.
> build-tier: complex

This spec is the build contract for FAFF-892, an Urgent bug: `faff merge-gate --local --level L4` fail-closes on the FAFF-325 corrective-integrity leg for an honest missing `FAFF_INTEGRITY_BOUNDARY` declaration, while the mint / `faff lights-out --check` preflight treats the same missing declaration as an advisory degrade and proceeds. A run minted exactly per the RUN-L4.md runbook therefore builds, passes adversarial review and the code-blind holdout, and then cannot merge on a condition it could never satisfy. Because the L4 epic chain is linear, the one gate blocks the whole product. The audience is the build agent implementing the fix, plus the human reviewer who must close the open decisions this spec surfaces.

## 1. WHY — problem and principles

**The load-bearing model.** There are two trust bases for corrective-artifact integrity, and the merge floor currently recognises only the stronger one. The strong basis is the pid-1 `FAFF_INTEGRITY_BOUNDARY` mount declaration (ADR-0061: assert the boundary, do not sign it). The weaker, mount-free basis is a digest-verified custody bracket over the same forge surface (FAFF-518 digest custody, sanctioned as a distinct trust class by ADR-0073 decision 5 and folded into the `corrective` consumer by ADR-0114). The preflight already proceeds on the weaker basis; the merge floor does not know it exists. The fix teaches the merge floor to accept the same digest-verified custody basis the preflight proceeds on, staying fail-closed and truthful, without ever conflating the two bases.

**Problem statement.** Today an honest missing declaration (`basis: no-declaration`) resolves to `unasserted-refuse` at L4 in `resolveIntegrity`, which `decideFloor` turns into a hard merge blocker, while the preflight downgrades the identical condition to an advisory and ships on the FAFF-518 digest custody floor. The inconsistency, not the missing mount, is the defect: under single-session economics the mount can never be truthfully declared (ADR-0073 decision 3), so `no-declaration` at L4 is a permanent state, and a runbook-correct L4 run is permanently unshippable. This change makes the merge floor accept a digest-verified custody basis over the per-issue forge surface as a grant, so an honest-absence run with clean custody reaches merge-ok, while a genuine violation or an unverifiable/tampered custody basis still refuses.

**Design principles.** These govern every implementation choice; reject any implementation that violates one.

- **Two-basis non-conflation is absolute.** A digest verdict is never fed through `FAFF_INTEGRITY_BOUNDARY`, `correctiveIntegrityProbe`, or the pid-1 environ read (ADR-0061 as amended by ADR-0114, and ADR-0073 decisions 3 and 5). The digest basis surfaces as its own trust class, distinct from mount-asserted, never as a synthesised or coerced declaration.
- **Compose at a new fold, never patch the gate.** `integrityGate` and `integrity-digest.js` stay byte-untouched, exactly as ADR-0114 required for the `corrective` consumer. Composition happens in a new pure fold that mirrors `foldCorrectiveAuthority`, not in an inline branch grafted onto `integrityGate` or `resolveIntegrity`.
- **A genuine violation still refuses, unchanged.** `env-injection`, `malformed`, and `dir-mismatch` (the `VIOLATION_BASES`) refuse at every level as they do today. A clean digest custody never rescues a proven-invalid declaration; the violation branch sits above the digest consult in fold precedence.
- **Extend the pure core fixture-first.** Any change to the merge-floor enum flows through `contract-defs.js`: add fixtures to `CONTRACTS["integrity-floor"]` first, then make them pass. `FLOOR_INTEGRITY` and `decideFloor` change only as the fixtures demand.
- **Uncertainty fails toward refuse, never toward trust.** A lost manifest, an uncomputable verify, or a tamper result must refuse; only an affirmatively clean digest over the exact per-issue forge surface may grant.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveIntegrity` and its two call sites; the L4 ternary the bug lives on |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | JavaScript | `correctiveIntegrityProbe`, `integrityGate` (must stay untouched), `correctiveIntegrityDirs`; the new fold's home |
| `plugin/skills/faff/bin/lib/corrective.js` | JavaScript | `foldCorrectiveAuthority` — the shape the new merge-floor fold mirrors |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript | `FLOOR_INTEGRITY` / `decideFloor` / `CONTRACTS["integrity-floor"]`; `computeCustodyVerdictAdmission` |
| `plugin/skills/faff/bin/lib/lights-out.js` | JavaScript | The preflight advisory branch this change aligns merge to (not re-opened) |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | JavaScript | `custody-verdict.json` recording (FAFF-784); the persisted, sha256-pinned verdict precedent |

**Scope statement.** This change sits at the merge-floor corrective-integrity leg only: `resolveIntegrity` plus the pure-core `integrity-floor` contract, plus consuming the digest verdict FAFF-893 produces. It does not touch the preflight, the mount channel, or the digest mechanism itself.

## 2. OUT OF SCOPE

- **The producer of the custody verdict (FAFF-893).** FAFF-893 produces and threads the verdict; FAFF-892 consumes it. This ticket only widens the admission.
- **The real read-only mount (FAFF-517).** When it lands, mount-asserted returns as the strongest basis (fold branch 1) and this change needs no rework.
- **The parallel-executor false-positive risk.** ADR-0114 limited the fold to the sequential executor at v1; this change inherits the same scoping.
- **The preflight's advisory posture (FAFF-525).** Already correct; not re-opened. This ticket aligns the merge floor to the preflight.
- **Fail-closing the preflight instead.** Excluded on the merits: ADR-0073 decision 3 makes the mount permanently undeclarable, so a fail-closed preflight makes L4 permanently unlaunchable.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Mount-asserted basis | The strong trust basis: a valid pid-1 `FAFF_INTEGRITY_BOUNDARY` declaration. `integrityGate` returns `trusted`. |
| Digest-verified custody basis | The weaker, mount-free trust basis: a clean digest verify over the per-issue forge surface, sha256-pinned. Distinct trust class per ADR-0073 decision 5. |
| Honest absence | `basis: no-declaration`. Not a violation. The only basis eligible for a digest-basis grant. |
| Violation basis | `env-injection` / `malformed` / `dir-mismatch`. Refuses at every level, never rescued by a digest. |
| Per-issue forge surface | The 7-entry set from `correctiveIntegrityDirs(runDir, issue)`. |

**The merge-floor digest verify input** (a discriminated union the caller constructs; `error` and `diffs` are mutually exclusive):

```
UNION MergeFloorDigestVerify:
  { held: false }                          # no per-issue custody verdict admitted
  { held: true, diffs: [] }                # verify clean over the forge surface
  { held: true, diffs: [<path>, ...] }     # verify reports tampered members
  { held: true, error: <reason> }          # verify could not be computed
```

**The new pure fold** `foldMergeFloorAuthority(mountGate, digestVerify) -> { trusted, disposition, basis }` (in corrective-integrity.js, alongside `integrityGate`; `integrityGate` itself is not modified). The 5-branch table (plus the mount-violation branch the corrective fold lacks), precedence load-bearing:

| # | Condition | Result |
|---|---|---|
| 1 | `mountGate.trusted === true` | `{ true, "trusted", "asserted" }` |
| 2 | `mountGate.disposition === "refuse"` (violation) | `{ false, "refuse", "violated-mount" }` (ABOVE the digest consult) |
| 3 | honest absence + `held && error != null` | `{ false, "refuse", "unverifiable" }` |
| 4 | honest absence + `held && diffs.length === 0` | `{ true, "custody-trusted", "digest-verified" }` (the grant) |
| 5 | honest absence + `held && diffs.length > 0` | `{ false, "refuse", "tampered" }` |
| 6 | honest absence + `!held` | `{ false, "unasserted", "none" }` (no bracket ran) |

**Design decision — the digest-verified grant's floor value.**

**Chosen:** widen `FLOOR_INTEGRITY` with a distinct `custody-trusted` value (surfaces the digest basis as its own trust class per ADR-0073 decision 5, and lets the merge-record display the truthful basis), rather than folding to `unasserted-ok` (which would collapse the basis into "unasserted" and breach the own-trust-class obligation).

## 4. HOW — behaviour

**Architecture.** `resolveIntegrity` gains a `digestVerify` param: it composes the existing mount probe (unchanged) with the union through `foldMergeFloorAuthority`, then maps the fold's disposition to the `FLOOR_INTEGRITY` state. `integrityGate` still runs to classify the mount probe. `decideFloor` gains the new non-blocking `custody-trusted` value and no new blocker for it. Both call sites and the `alreadyMergedReconcile` hand-derivation key on the same extended state set.

```
PROCEDURE resolveIntegrity(runDir, issue, level, digestVerify):
  probe     := correctiveIntegrityProbe(process.env, realFsq(), correctiveIntegrityDirs(runDir, issue))  # UNCHANGED
  mountGate := integrityGate(probe, "merge-floor")  # UNCHANGED
  fold      := foldMergeFloorAuthority(mountGate, digestVerify)
  MAP fold.disposition -> state:
    "trusted"         -> "asserted"
    "refuse"          -> "violated"
    "custody-trusted" -> "custody-trusted"   # new non-blocking value
    "unasserted"      -> level == "L4" ? "unasserted-refuse" : "unasserted-ok"
  RETURN { state, display, basis: fold.basis }
```

**Admission of the merge-floor digest verdict** (`buildMergeFloorDigestVerify`, reusing `computeCustodyVerdictAdmission` — never a second admission gate):

```
PROCEDURE buildMergeFloorDigestVerify(runDir, issue, verdictPathArg, verdictShaArg):
  IF no verdict path/sha supplied:            RETURN { held: false }
  IF resolve(verdictPathArg) != resolve(canonical): RETURN { held: true, error: "non-canonical path" }
  admission := computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256: verdictShaArg, expectedRunId, expectedIssue })
  IF admission.admitted:                       RETURN { held: true, diffs: [] }
  IF admission.classification == "tamper":     RETURN { held: true, diffs: ["<forge surface>"] }
  OTHERWISE:                                    RETURN { held: true, error: admission.reason }
```

**Default preserved.** When no custody flags are passed, `digestVerify` is absent, the fold reaches branch 6 (`unasserted`), and the level-branch yields today's `unasserted-refuse` at L4 exactly. No regression for runs where no bracket ran.

**Anti-patterns.**

- **Anti-pattern:** synthesising a `FAFF_INTEGRITY_BOUNDARY` value from the digest verdict. Why: the two-basis conflation ADR-0061/0073/0114 forbid.
- **Anti-pattern:** editing `integrityGate` or `integrity-digest.js` inline. Why: ADR-0114 fixed composition to a separate fold.
- **Anti-pattern:** `try { diffs = verify(...) } catch { diffs = [] }`. Why: flips an uncomputable verify (branch 3) into a grant (branch 4).

## 5. Scenarios

```
Given an L4 run-dir with basis no-declaration and a clean, sha256-pinned per-issue custody verdict admitted
When faff merge-gate --local --level L4 evaluates the merge floor (all other legs green)
Then the integrity leg grants (custody-trusted) and the gate reaches merge-ok
```

```
Given an L4 run-dir with no pid-1 FAFF_INTEGRITY_BOUNDARY but an env-injected declaration, and a clean custody verdict present
When faff merge-gate --local --level L4 evaluates the integrity leg
Then it refuses (violated) — the clean digest never rescues the violation (branch 2 precedes the digest consult)
```

```
Given an L4 run-dir with basis no-declaration and a tampered or uncomputable custody verdict
When merge-gate --local --level L4 evaluates the integrity leg
Then it refuses (violated) rather than granting
```

```
Given an L4 run-dir with basis no-declaration and no custody verdict recorded
When merge-gate --local --level L4 evaluates the integrity leg
Then it refuses at L4 exactly as today (unasserted-refuse), never granting on absence
```

Non-functional assertions:

- The digest verdict is never passed to `correctiveIntegrityProbe`, `integrityGate`, or the pid-1 environ read.
- `integrityGate` and `integrity-digest.js` bytes are unchanged.
- The custody verdict is admitted only via `computeCustodyVerdictAdmission` with a caller-retained sha256.
- Below L4, no new merge blocker is introduced.

## 6. Design decision rationale

**Grant at the merge floor, or fail-close the preflight?** **Chosen:** grant at the merge floor — the only option that keeps a runbook-correct L4 run shippable while staying truthful and fail-closed. Fail-closing the preflight makes L4 permanently unlaunchable (ADR-0073 decision 3).

**Where does the composition live?** **Chosen:** a new pure fold `foldMergeFloorAuthority` mirroring `foldCorrectiveAuthority` — the ADR-0114-sanctioned composition shape, keeping `integrityGate` untouched.

**`FLOOR_INTEGRITY` widening vs fold-before-`decideFloor`.** **Chosen:** widen with a distinct `custody-trusted` value — truthful, satisfies ADR-0073 decision 5 distinctness, and the merge-record shows the real basis.

**A new ADR.** **Chosen:** author a merge-floor sibling to ADR-0114 (which explicitly left the merge floor out of scope), rather than silently reinterpreting ADR-0114.

## 7. Open questions and assumptions

**Open Questions.** None blocking — the two architecture decisions (FLOOR_INTEGRITY shape; new ADR) are resolved above at build admission.

**Assumptions.**

- **Assumes:** `computeCustodyVerdictAdmission` and `custodyHashBytes` remain the single admission gate and hasher. Validate: confirm both are used by the existing `evaluateCustody` leg.
- **Assumes:** `correctiveIntegrityDirs(runDir, issue)` returns the 7-entry per-issue set. Validate: the member-count contract.
- **Assumes:** FAFF-893 produces the per-issue custody verdict this admission reads. Validate: the joint smoke test against FAFF-893's producer.

## 8. DONE — definition of done

### From WHY (principles)
- [ ] No code path passes the digest verdict into `correctiveIntegrityProbe`, `integrityGate`, or the pid-1 environ read.
- [ ] `integrityGate` and `integrity-digest.js` are byte-unchanged (the new fold lives in corrective-integrity.js beside `integrityGate` without modifying it).
- [ ] A genuine violation basis refuses at every level with a clean digest present (precedence holds).

### From WHAT (fold + pure core)
- [ ] `foldMergeFloorAuthority(mountGate, digestVerify)` exists as a pure function with the fixed table, branch 2 (mount violation) before the digest branches.
- [ ] `FLOOR_INTEGRITY` gains `custody-trusted`; `decideFloor` treats it as non-blocking and introduces no new below-L4 blocker.
- [ ] `CONTRACTS["integrity-floor"]` gains a fixture for the grant (does not block at L4) and it passes; `faff contract integrity-floor --selftest` passes.

### From HOW (behaviour)
- [ ] `resolveIntegrity` composes `integrityGate(probe)` with the digest verify union through `foldMergeFloorAuthority` and maps the disposition per the table.
- [ ] Both `resolveIntegrity` call sites and `alreadyMergedReconcile` key on the extended state set (custody-trusted is non-blocking there too).
- [ ] An honest-absence L4 run with an admitted clean per-issue custody verdict reaches merge-ok; `merge-record.json` records the truthful `custody-trusted` display.
- [ ] A tampered / uncomputable / mismatched / absent verdict refuses; a missing verdict refuses at L4 exactly as today.

### Test surface
- [ ] `test/corrective-integrity.test.mjs` covers `foldMergeFloorAuthority`'s branch table and precedence (violation-with-clean-digest refuses).
- [ ] `test/merge-gate-local.test.mjs` covers the CLI-level integrity leg: honest-absence + clean grant reaches merge-ok; honest-absence + tamper/absent refuses; violation refuses regardless of digest.

### Integration smoke test

```
PROCEDURE smoke_l4_local_grant:   # paired with FAFF-893
  1. Stage an L4 run-dir: run-ledger.json level L4, all non-integrity legs green, CI green.
  2. Ensure NO pid-1 FAFF_INTEGRITY_BOUNDARY (basis no-declaration).
  3. Record a clean, sha256-pinned custody verdict over correctiveIntegrityDirs(runDir, issue) (FAFF-893's producer).
  4. Run: faff merge-gate --local --level L4 --custody-verdict <path> --custody-verdict-sha256 <sha>
  5. EXPECT verdict merge-ok; integrity display custody-trusted.
  6. Re-run with the verdict bytes mutated (sha mismatch) -> EXPECT refuse.
  7. Re-run with NO custody verdict -> EXPECT refuse (unasserted-refuse at L4, unchanged).
```

confidence: medium
