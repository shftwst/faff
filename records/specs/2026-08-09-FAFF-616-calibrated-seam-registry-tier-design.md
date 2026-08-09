# Spec — FAFF-616: `calibrated` seam status + C3 accuracy-floor gate in `validate-adapters`

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: high. Full spec on Linear FAFF-616.

**Artifact.** Buildable spec for FAFF-616 (revised twice after spec-review — architecture unchanged; revisions tightened root resolution, component boundaries, verifiable ACs, the frontier read-path, and the custom-floor / failure-string test coverage). Audience: the build agent implementing it and the reviewers gating it.

## 1. WHY — Problem and Principles

**Load-bearing model.** `validate-adapters` already runs a two-check eval-coverage gate (C1: a registry surface must declare its `judgement_seam:`; C2: a `covered` kind must have ≥1 live case). Both live in a single block that only runs when `eval/seam-registry.json` loads — and that registry is the file that carries each kind's `status`. This spec adds a **third trust tier**, `calibrated`, meaning "this kind is not just wired up and case-backed, but its measured accuracy on the committed frontier baseline clears a floor." The feature turns on one structural fact: the `status` vocabulary and the floor check live behind the same registry load, so a `calibrated` claim cannot exist unless the registry (and the whole gate block) is running.

**Problem statement.** Today a kind can be `covered` (wired + case-backed) yet have a frontier accuracy that is garbage or absent, and nothing catches it (FAFF-319 shipped 8 kinds `covered` while grading nothing; a tracker comment documents 4 more, e.g. `adr-drift` at accuracy 0.50 for the wrong reason with a meaningless stability 1.00). This ticket adds `calibrated` as a status a kind earns only when `frontier.json` shows its accuracy at/above a floor, and makes `validate-adapters` fail a `calibrated` claim not backed by an above-floor row. It flips **zero** kinds this ticket — it ships the vocabulary + the enforcing check; the first promotions wait on FAFF-614's operator sweep.

**Design principles.**

**The floor is necessary, not sufficient — and it is not today's heavy lifter.** The accuracy floor is the durable gate that will bite once FAFF-614 lands real above-floor rows and kinds get promoted. Today its only conceivable live catch is `adr-drift` (0.50), which is out of scope (FAFF-669) — so in this ticket the floor catches nothing live by design. The `policy.warn_kinds` gate (currently `confidence`, `holdout-exercise`) carries today's actual load; the floor is the structural guarantee for tomorrow.

**One resolved root, or fixture tests are unbuildable.** Every filesystem read in the gate block — the registry, the cases directory, and the new `frontier.json` — must resolve off one shared root. Today `loadSeamRegistryForLint` and the C2 `casesDir` each independently hardcode `path.resolve(HERE, "..","..","..","..")` and ignore `--root`. If C3 computes its own root, a fixture pointed at by `--root` could load its registry from the fixture but its `frontier.json` from the surrounding real checkout — a silent false pass. Shared-root is a correctness invariant.

**Eval-absent must be structurally fail-safe, never fail-open.** A `calibrated` claim is a value inside `eval/seam-registry.json`. If `eval/` is absent (plugin-only install), the registry is `null`, the whole gate block is skipped, and by construction there is no `calibrated` claim to escape unchecked. The only way a `calibrated` claim exists is with the registry present, in which case a missing/malformed `frontier.json` is a fail-loud exit 2, not a skip.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | CommonJS | Hosts the gate; `loadSeamRegistryForLint` (L145-158), C2 `casesDir` (L827), skip gate at the `else if (seamReg)` branch (L793). All new code lands here. Its only caller of `loadSeamRegistryForLint` is L785. |
| `eval/seam-registry.json` | JSON | Carries each kind's `status`; `_comment` documents the vocabulary. Gains `calibrated` in the vocab prose; zero rows change status. |
| `eval/baselines/frontier.json` | JSON | `{ meta, per_kind: { "<kind>": { accuracy, stability, format_adherence } }, policy: { warn_kinds, tolerances } }`. Read by C3 — note the **nested** `eval/baselines/` path. 14/32 kinds have rows; `meta.source` marks the file PROVISIONAL. No `policy.calibration_floor` key today. |
| `eval/grader.mjs` | ESM | Reads `seam-registry.json` directly (grader.mjs L256 — it does NOT share `loadSeamRegistryForLint`); asserts registry keys == its `KINDS`; `frontier.json.per_kind` is keyed by the same KIND ids — grounds the exact-string match decision. |
| `test/seam-registry.test.mjs`, `test/eval-coverage-gate.test.mjs` | ESM (node:test) | Existing test homes; new unit + fixture-integration tests land here. |

**Scope.** The shipped-defaults eval-coverage gate of `validate-adapters` (the block after the `--configured` early return) — the same gate as C1/C2, extended with a status tier and a floor check.

## 2. OUT OF SCOPE

- **Flipping any kind to `calibrated`.** — No kind has a trustworthy above-floor row until FAFF-614 re-seeds `frontier.json`; promoting now encodes a claim against PROVISIONAL data. Extension point: a later backfill edits the kind's `status` once its row clears the floor.
- **`adr-drift`'s sub-floor accuracy (0.50).** — Belongs to FAFF-669. It is the one row that would trip the floor today, but it is neither `calibrated` (so C3 never inspects it) nor this ticket's concern.
- **Re-seeding `frontier.json` from a real sweep.** — That is FAFF-614, a human-supervised eval run. Extension point: `node eval/run-evals.mjs --driver frontier --update-baseline …`.
- **`stability` / `format_adherence` in the floor.** — The floor is accuracy-only; broken kinds read 1.00 there. Extension point: a future multi-axis floor would make `calibration_floor` a per-axis object; today it is a scalar.
- **Provenance / attestation of `frontier.json`.** — The number's provenance is a human assertion at edit time, consistent with the file's PROVISIONAL posture. Extension point: a `meta` hash/run-id tying it to a real `run-evals` invocation, checked by C3.
- **`warn_kinds` semantics or membership.** — C3 reads `warn_kinds` as a disqualifier but does not change how it is populated.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| `calibrated` | A seam-registry `status` value (joining `covered`, `designed`): a kind wired up, case-backed, AND with a frontier accuracy at/above the floor. Strictly stronger than `covered`. |
| C3 | The new third eval-coverage check: for each `calibrated` kind, its `frontier.json` row must exist, not be a `warn_kind`, and clear the accuracy floor. |
| floor | The accuracy threshold a `calibrated` kind must meet. Read from `policy.calibration_floor` in `frontier.json` **when present**; defaults to `0.85` only when the key is absent (it is absent today). Accuracy axis only. |
| shared root | The single directory all three gate reads resolve against: `--root` if supplied, else the HERE-relative default `path.resolve(HERE, "..","..","..","..")`. |
| frontier path | `path.join(root, "eval", "baselines", "frontier.json")` — the committed baseline is at the **nested** `eval/baselines/` path, NOT `eval/frontier.json`. |
| calibrated claim | A registry entry whose `status === "calibrated"`. Can only exist when the registry loaded, i.e. `eval/` is present. |

**Status vocabulary (registry `_comment`).** The `_comment` gains one clause: *"`calibrated` — a `covered` kind whose committed frontier accuracy clears `policy.calibration_floor` (default 0.85); enforced by validate-adapters C3."* No `kinds` entry changes status.

**Frontier shape (read-only contract C3 depends on).**

```
RECORD Frontier:
  meta:    object                       # includes source (PROVISIONAL marker); not read by C3
  per_kind: Map<KindId, PerKindRow>      # keyed by the EXACT grader KIND id
  policy:  Policy

RECORD PerKindRow:
  accuracy:         Number in [0,1]      # the ONLY axis C3 gates on
  stability:        Number               # read as 1.00 for broken kinds; NOT gated
  format_adherence: Number               # NOT gated

RECORD Policy:
  warn_kinds:        List<KindId>        # a calibrated kind appearing here is a C3 FAIL
  calibration_floor: Number?             # OPTIONAL; the policy value GOVERNS when present; C3 uses `?? 0.85` only when absent
  tolerances:        object              # not read by C3
```

**Component interfaces.** Two components, split by whether they touch disk:

```
# PURE. No fs, no process.exit, no model call, no ambient state. Deterministic in its args.
FUNCTION checkCalibrated(kind, entry, baseline, floor, warnSet) -> { ok: Bool, reason?: String }
  # baseline: the ALREADY-PARSED frontier object. checkCalibrated does NOT read it from disk.
  # floor:    the resolved numeric floor (baseline.policy.calibration_floor ?? 0.85), passed in.
  # warnSet:  a Set of baseline.policy.warn_kinds, passed in.

# OUTER lint. Owns the frontier.json fs-read and the fail-loud exit. Impure by design.
FUNCTION c3CalibrationFloor(seamReg, root, casesPresent) -> { failed: Bool, exit2: Bool }
  # root: the SHARED resolved root (same value loadSeamRegistryForLint used); frontier is read from
  #       path.join(root, "eval","baselines","frontier.json"). Only called when seamReg !== null.
```

**Frontier path (named, not parallel-guessed).** The committed baseline lives at `eval/baselines/frontier.json` — a **nested** path, unlike the sibling `eval/cases/`. C3 reads `path.join(root, "eval", "baselines", "frontier.json")`. Reading `eval/frontier.json` (a false parallel to the `casesDir = path.join(root,"eval","cases")` shape) is an anti-pattern: it points at a non-existent file. The `--root` fixture-integration test writes the baseline at `eval/baselines/` and a wrong-path implementation surfaces as an absent-row FAIL (or fail-loud), so the path is test-pinned, not left to a builder's guess.

**Root threading (interface change).** `loadSeamRegistryForLint` is refactored to take the shared root and surface it, so C3 reuses the identical value:

```
FUNCTION loadSeamRegistryForLint(root) -> { registry, error, root }
  # root undefined ⇒ preserves today's HERE-relative resolve. Returns the SAME registry/error contract
  # PLUS the root it used, so callers thread ONE root. (Its only caller is validate-adapters.js L785;
  # grader.mjs does NOT use it — it reads seam-registry.json directly — so this signature change is local.)
```

The C2 `casesDir` read (L827) switches from its own `path.resolve(HERE,...)` to `path.join(root, "eval","cases")` using that same shared root.

**Chosen:** `checkCalibrated(kind, entry, baseline, floor, warnSet) -> {ok, reason?}` is **pure** (parsed `baseline` in, verdict out, no disk I/O, no `process.exit`, deterministic). The outer `c3CalibrationFloor` owns the `frontier.json` read and the fail-loud exit 2 on missing/malformed frontier while a calibrated claim exists. Rationale: a pure predicate is testable with hand-built objects and structurally cannot call a model; one place owns I/O and the exit decision.

## 4. HOW — Behavior

**Architecture.** All changes in `validate-adapters.js`, inside the existing gate. The call chain in `cmdValidateAdapters`:

1. Resolve the **shared root** once: `root = values["--root"] ?? path.resolve(HERE,"..","..","..","..")`.
2. `const { registry: seamReg, error: seamErr, root: usedRoot } = loadSeamRegistryForLint(root)`.
3. If `seamErr` → existing fail-loud exit 2 (unchanged).
4. Else if `seamReg` (registry present) → the C1/C2 block runs using `usedRoot` for `casesDir`; **then C3 runs** — `c3CalibrationFloor(seamReg, usedRoot, casesPresent)`.
5. Else (`seamReg === null && seamErr === null`, eval absent) → whole block skipped. No calibrated claim can exist here.

**C3 behavior.** For each registry kind whose `status === "calibrated"`, C3 confirms the committed frontier backs the claim: a row exists, it is not a warn_kind, and its accuracy clears the floor. A `calibrated` kind with zero cases is caught by the extended C2, not C3.

```
PROCEDURE c3CalibrationFloor(seamReg, root, casesPresent):
  1. frontierPath = join(root, "eval", "baselines", "frontier.json")   # nested path, NOT eval/frontier.json
  2. calibratedKinds = [k for (k,entry) in seamReg.kinds if entry.status == "calibrated"]
  3. IF calibratedKinds is empty:
        RETURN { failed:false, exit2:false }      # no claim → nothing to read, nothing to fail
  4. Read + parse frontierPath:
        a. IF file missing OR JSON malformed OR no per_kind map:
             print FAIL "eval/baselines/frontier.json (calibration floor) — <reason>;
                        a calibrated kind is claimed but the frontier baseline can't be read (FAFF-616 C3)"
             RETURN { failed:true, exit2:true }    # fail-LOUD, exit 2 (harness-can't-run)
  5. floor   = baseline.policy.calibration_floor ?? 0.85      # policy value GOVERNS when present
  6. warnSet = new Set(baseline.policy.warn_kinds ?? [])
  7. failed = false
  8. FOR each kind in calibratedKinds:
        result = checkCalibrated(kind, seamReg.kinds[kind], baseline, floor, warnSet)
        IF NOT result.ok:
           failed = true
           print FAIL "eval/baselines/frontier.json:<kind> (calibration floor)"; print "  ✗ " + result.reason
  9. RETURN { failed, exit2:false }                 # a claim-not-backed is a lint FAIL (exit 1), not exit 2
```

```
PROCEDURE checkCalibrated(kind, entry, baseline, floor, warnSet):   # PURE
  1. row = baseline.per_kind[kind]                  # EXACT-string key lookup, no normalization
  2. IF row is undefined:
        RETURN { ok:false, reason: "kind `"+kind+"` is registry-status `calibrated` but has no per_kind
           row in frontier.json — run the operator sweep (FAFF-614)" }   # reason contains "FAFF-614"
  3. IF warnSet has kind:
        RETURN { ok:false, reason: "kind `"+kind+"` is `calibrated` but is a policy.warn_kind in
           frontier.json — a warn-kind is not calibration-clean" }        # reason contains "warn_kind"
  4. IF row.accuracy < floor:
        RETURN { ok:false, reason: "kind `"+kind+"` accuracy "+row.accuracy+" < calibration floor "+floor }
                                                     # reason contains the accuracy AND the floor value
  5. RETURN { ok:true }
```

**Failure-reason strings are test-pinned.** The exact substrings the tests assert are: below-floor → the reason contains the row's accuracy and the floor value; absent-row → the reason contains `FAFF-614`; warn_kind → the reason names the kind as a `warn_kind`. The full wording may be edited, but these substrings are the assertion contract so a builder cannot silently drop the operator-sweep hint or the accuracy/floor numbers.

**Extended C2 (calibrated-with-0-cases).** The existing C2 loop FAILs a `covered` kind with 0 cases; it is extended so the same FAIL fires for a `calibrated` kind — a stronger tier cannot be case-empty:

```
# in the existing C2 loop, the FAIL condition widens from {covered} to {covered, calibrated}:
IF casesPresent(kind) == 0 AND entry.status IN {"covered","calibrated"}:
   failed = true
   FAIL "eval/cases/<kind> (eval coverage) — kind `<kind>` is registry-status `<status>`
         but has 0 cases in eval/cases/ (FAFF-281 C2)"
```

Because C2 runs before C3 and uses the shared-root `casesDir`, a calibrated-with-0-cases kind is a **C2** failure; C3's accuracy check on that kind is redundant but harmless.

**Edge cases and precedence.**

- **Floor default vs. policy value.** When `policy.calibration_floor` is present, that value governs; `?? 0.85` applies only when the key is absent (today's state). A future non-default floor changes the bar without a code edit.
- **Kind-name match.** `baseline.per_kind[kind]` by the exact registry KIND id. Safe because the grader asserts registry keys == `KINDS` and `frontier.json` uses those same ids. No lower-casing, no dash/underscore folding.
- **Missing frontier vs. no claim.** Frontier missing/malformed is only fatal when a calibrated claim exists (step 3 short-circuits first). Today, with zero calibrated kinds, C3 never opens the file — so it cannot regress the real tree.
- **Skip path.** `eval/` absent ⇒ `loadSeamRegistryForLint` returns `registry:null, error:null` ⇒ neither the C1/C2 nor the C3 branch runs. Observable trigger: the `eval/` directory is not present on the shared root.

**Failure modes.**

- **C3 reads the wrong `frontier.json` — wrong path or wrong root.** Two flavours: (a) a builder codes `eval/frontier.json` by false parallel to `casesDir` → reads a non-existent file; (b) C3 recomputes its own HERE-relative root while the registry loaded from a `--root` fixture → reads the real checkout. How you'd know: the `--root` fixture-integration test writes the baseline at `eval/baselines/` under the fixture and expects C3's verdict off it; a wrong path yields absent-row/fail-loud, a wrong root yields a false pass on the below-floor case. What it means: the named nested frontier path + the shared-root refactor are the fixes; the fixture test pins both.
- **The floor gate is theatre — it never bites, so a broken `checkCalibrated` looks fine.** With zero calibrated kinds, the real-tree run exercises none of C3's discriminating logic. How you'd know: the real-tree exit-0 assertion passes regardless of `checkCalibrated` correctness; only the fixture unit tests exercise the branches. What it means: treat the real-tree assertion as a no-regression guard with no discriminating power, and make the fixture scenarios load-bearing.
- **`calibrated` mints a trust tier on a hand-editable, PROVISIONAL number.** The floor is only as honest as whoever last edited `frontier.json`; there is no attestation tying the number to a real run. What it means: accepted limit, consistent with the file's PROVISIONAL posture; a `meta` hash/run-id is a named extension point.

**Anti-patterns.**

- Reading `eval/frontier.json` instead of `eval/baselines/frontier.json` — the baseline is at a nested path; a false parallel to `casesDir` reads a non-existent file.
- C3 computing its own root (a fresh `path.resolve(HERE,...)`) — breaks the shared-root invariant.
- Hardcoding `0.85` as the floor instead of reading `policy.calibration_floor` first — the policy value must govern when present; `0.85` is only the absent-key fallback.
- Disk I/O or `process.exit` inside `checkCalibrated` — destroys the purity that makes the no-model-call oracle and fixture unit tests possible.
- Gating the floor on `stability`/`format_adherence` — broken kinds read 1.00 there; noise and false confidence.
- Normalizing kind names before the `per_kind` lookup — the grader guarantees exact-id equality; normalization masks a genuine divergence.

## 5. Scenarios — born-verifiable main objectives

```
Given a fixture tree whose registry marks kind K `calibrated` and whose frontier.json (at eval/baselines/)
      has per_kind[K].accuracy at/above the floor (0.85) and K not in warn_kinds
When validate-adapters runs the eval-coverage gate with --root pointed at the fixture
Then C3 passes K (no FAIL line for K) and the run's C3 contribution is exit 0
```

```
Given a fixture whose registry marks K `calibrated` and whose frontier per_kind[K].accuracy is below the floor
When validate-adapters runs with --root pointed at the fixture
Then C3 FAILs with a reason containing both K's accuracy and the floor, and the run exits 1 (lint fail)
```

```
Given a fixture whose registry marks K `calibrated` but whose frontier has NO per_kind row for K
When validate-adapters runs with --root pointed at the fixture
Then C3 FAILs with a reason containing `FAFF-614` (run the operator sweep), exit 1
```

```
Given a fixture whose registry marks K `calibrated`, K not in warn_kinds, per_kind[K].accuracy = 0.90,
      and policy.calibration_floor = 0.95 (a NON-default floor)
When validate-adapters runs with --root pointed at the fixture
Then C3 FAILs (0.90 < 0.95) — proving the policy value governs, not the 0.85 constant;
  and with the calibration_floor key removed the SAME kind passes at the 0.85 default
```

```
Given a fixture with a calibrated kind claimed but frontier.json missing or malformed JSON
When validate-adapters runs with --root pointed at the fixture
Then C3 fails LOUD with exit 2 (harness-can't-run), distinct from a lint exit 1
```

- The floor is gated on `accuracy` only; `checkCalibrated` MUST NOT read `row.stability` or `row.format_adherence`.
- `checkCalibrated` MUST be pure: identical args → identical `{ok,reason?}`, no disk I/O, no `process.exit`.
- A `calibrated` kind listed in `frontier.json`'s `policy.warn_kinds` MUST be a C3 FAIL even if its accuracy clears the floor.

## 6. Design Decision Rationale

**Thread `--root` through the seam block, or lean on pure-fn tests only?** **Chosen:** thread the shared root into `loadSeamRegistryForLint`, `casesDir`, and the frontier read. `--root` is already in the arg spec and consumed by `lintVoicePointer`/`--configured`; extending it to the seam block is bounded and is the cleaner choice since C2 and C3 fixture tests both require it. Absence preserves today's HERE-relative default exactly.

**C3's root — reuse the registry's, or recompute?** **Chosen:** reuse — refactor `loadSeamRegistryForLint` to accept and return the shared root; C3 reads `frontier.json` off that same `usedRoot`, only when `registry !== null`. One root, one repo. (Local change: `loadSeamRegistryForLint`'s only caller is validate-adapters.js L785; grader.mjs reads the registry directly and is untouched.)

**Frontier read-path — named or parallel-inferred?** **Chosen:** name it explicitly as `eval/baselines/frontier.json` (nested), never `eval/frontier.json`. The `--root` fixture test writes the baseline at `eval/baselines/` and asserts C3's verdict off it, so a wrong-path implementation fails a test rather than silently reading nothing.

**Read the floor from policy, or hardcode 0.85?** **Chosen:** read `policy.calibration_floor` when present (the policy value governs); `?? 0.85` is only the absent-key fallback. A fixture test with a non-default `calibration_floor` (0.95) proves the policy value governs, not the constant.

**How should the floor be framed?** **Chosen:** necessary-not-sufficient — the durable gate for when FAFF-614 lands real rows; today it catches nothing live (its only candidate `adr-drift` 0.50 is out of scope), and `policy.warn_kinds` carries today's load.

**Is the eval-absent skip a fail-open?** **Chosen:** structurally impossible — the `calibrated` status lives in `eval/seam-registry.json`; `eval/` absent ⇒ registry null ⇒ the whole gate block is skipped ⇒ no `calibrated` claim can exist to escape. The only present-registry failure (missing/malformed `frontier.json` while a claim exists) is fail-loud exit 2.

**Exact-string or normalized kind matching?** **Chosen:** exact-string — `baseline.per_kind[kind]` by the exact registry KIND id, no normalization (grader asserts registry keys == `KINDS`; normalization would only hide a real divergence).

**How is "no model call" made verifiable?** **Chosen:** a mechanical oracle — a test asserts the C3 code path imports none of `child_process`, `net`, `http`, or the eval driver, AND that `checkCalibrated` is pure (identical args → identical result; no disk read; no `process.exit`).

**Add `calibrated` now, flip kinds?** **Chosen:** add the documented vocabulary + the enforcing check, flip zero kinds. Promotions wait on FAFF-614's real rows.

**Provenance of the number.** **Chosen:** accept the limit — the number's provenance is a human assertion at edit time, consistent with the PROVISIONAL posture; a `meta` hash/run-id is a named extension point.

## 7. Open Questions and Assumptions

**Open Questions.** None — every decision is closed with a **Chosen:** marker.

**Assumptions.**

- **Assumes:** FAFF-614 (the operator frontier sweep) produces the first real above-floor `per_kind` rows that make any kind eligible for a future `calibrated` promotion. Validation before build: none required — C3 is correct and tested against fixtures with zero live calibrated kinds; this assumption bears only on when the gate starts biting real data, not on whether the code is buildable/testable now. (decides: any)

## 8. DONE — Definition of Done

### From WHY / WHAT (status vocabulary)
- [ ] `eval/seam-registry.json` `_comment` documents `calibrated` as a status value (a `covered` kind clearing `policy.calibration_floor`, default 0.85, enforced by C3).
- [ ] Zero entries in `eval/seam-registry.json` change `status` (asserted by a test: no `status === "calibrated"` entry exists post-change).

### From WHAT (interfaces / root + path)
- [ ] `loadSeamRegistryForLint(root)` accepts a root argument, defaults to the HERE-relative resolve when `root` is undefined, and returns the root it used alongside `{registry, error}`.
- [ ] The C2 `casesDir` read resolves off the shared root (not its own `path.resolve(HERE,...)`).
- [ ] `c3CalibrationFloor` reads `frontier.json` from `path.join(root, "eval","baselines","frontier.json")` off the same root value `loadSeamRegistryForLint` returned, and runs only when `registry !== null`.
- [ ] A test pins the frontier path: a fixture with the baseline only at `eval/frontier.json` (and none at `eval/baselines/`) while a calibrated kind is claimed yields an absent-row/fail-loud — catching a wrong-path implementation.

### From HOW (C3 — component: PURE `checkCalibrated`, fixture-driven)
- [ ] above-floor → ok: a `calibrated` kind with `accuracy >= floor` and not in `warn_kinds` returns `{ok:true}`, no FAIL line.
- [ ] below-floor → fail: `accuracy < floor` fails with a reason **containing both the accuracy and the floor value**.
- [ ] absent-row → fail: no `per_kind` row fails with a reason **containing `FAFF-614`** (the operator-sweep hint).
- [ ] warn_kind → fail: a `calibrated` kind in `policy.warn_kinds` fails even when accuracy clears the floor, with a reason naming it a `warn_kind`.
- [ ] custom floor honoured: with a fixture `policy.calibration_floor = 0.95`, a `calibrated` kind at accuracy 0.90 FAILs; with the key removed the same kind passes at the 0.85 default — proving the policy value governs, not the constant.
- [ ] `checkCalibrated` reads only `accuracy` — a test confirms `stability`/`format_adherence` do not affect the verdict.
- [ ] Kind lookup is exact-string: a case-mismatched or dash/underscore-folded key is treated as an absent row.

### From HOW (C3 — component: outer `c3CalibrationFloor`, owns I/O + exit)
- [ ] frontier missing/malformed with a calibrated claim → fail-loud exit 2 (distinct from lint exit 1).
- [ ] no calibrated claim → no frontier read: with zero calibrated kinds, `c3CalibrationFloor` returns without opening `frontier.json`.
- [ ] a below-floor / absent-row / warn_kind C3 failure yields lint exit 1, not 2.

### From HOW (extended C2)
- [ ] calibrated-with-0-cases → C2 fail: a `calibrated` kind with 0 files in `eval/cases/` FAILs C2 (condition covers `{covered, calibrated}`), message naming the kind and its status.

### From HOW (no-model-call oracle)
- [ ] A test asserts the C3 code path imports none of `child_process`, `net`, `http`, or the eval driver, AND that `checkCalibrated` is pure (identical args → identical result; no disk I/O; no `process.exit`).

### From HOW (no-regression guard — honest framing)
- [ ] real-tree exit-0 (no-regression only): running the gate on the actual repo (14/32 rowed, zero `calibrated`) still exits 0. Documented as a no-regression guard with no discriminating power on C3 logic — the fixture scenarios are the load-bearing coverage.

### From HOW (`--root` fixture integration — automated node:test, not a manual procedure)
- [ ] An **automated** `node:test` in `test/eval-coverage-gate.test.mjs` runs `validate-adapters` with `--root` at a tmp fixture tree (registry + `eval/cases/` + `eval/baselines/frontier.json`) and asserts C3's verdict off the fixture — proving the shared root resolves registry, cases, and frontier from the same tree and never reads the surrounding checkout. It covers the above-floor-pass and below-floor-fail transitions (and, per the path-pin item, a wrong-path miss).

**Integration smoke test (automated node:test, pseudocode).**

```
PROCEDURE smoke_c3_fixture:   # test/eval-coverage-gate.test.mjs
  1. mkdtemp TMP; write TMP/eval/seam-registry.json with kind "demo" status "calibrated"
  2. write TMP/eval/cases/demo-1.json (so C2 passes)
  3. write TMP/eval/baselines/frontier.json with per_kind.demo.accuracy = 0.90, warn_kinds = []
  4. run validate-adapters with --root TMP; ASSERT exit 0 and no FAIL line for "demo"
  5. set policy.calibration_floor = 0.95; run again; ASSERT exit 1 and a FAIL line naming "demo","0.9","0.95"
  6. remove calibration_floor; set per_kind.demo.accuracy = 0.50; run again
     ASSERT exit 1 and a FAIL line naming "demo","0.5","0.85"
  7. move the baseline to TMP/eval/frontier.json (wrong path, none at eval/baselines/); run again
     ASSERT a fail (absent-row or fail-loud) — pinning the nested read path
```

**Eval coverage.** This ticket changes the registry/coverage-lint layer, not an LLM-judgement seam — it adds no grader `KIND`, so no new eval case or seam-registry row is owed.

## Methodology critique

*Agile-delivery lens (faffter-dark-methodology-agile-delivery). Advisory — surfaced for human review, does not gate promotion.*

**Right-sized? — No issues.** One coherent 1-3 day unit: a status-vocab value, one extended lint condition (C2), one new lint check (C3), the shared-root refactor, and tests. Not independently shippable — the `calibrated` value is inert without C3. No always-ships-together sibling: FAFF-614 produces baseline *data*, not this schema/lint, and this ticket ships ahead of it with zero kinds flipped.

**Workstream fit? — Something to surface.** The issue is cohesively at home in "Skill-behaviour harness" (eval-harness plumbing), but the container is a capability/harness label, not a shippable outcome — its tickets have no common outcome to sequence against. No action on FAFF-616 itself; flag for a project-level pass whether to reframe the project as the outcome it serves (e.g. "graders you can trust to catch regressions").

**Deps surfaced? — Something to surface.** FAFF-616's relationship to FAFF-614 lives as prose ("depends in spirit") + C3's failure-message reference + the `Assumes:`. The direction is the inverse of a build-blocker: FAFF-616 builds fine alone; FAFF-614's output is what makes it *live*. Recommend making the "activated-by FAFF-614" relationship explicit so the sequencer sees that flipping the first kind to `calibrated` is gated on FAFF-614. (A related-to link already exists.)

**Risk profile? — Light note, largely de-risked.** The headline risk (a paid sweep in CI) is designed out — C3 only reads the committed `frontier.json`. Residual: C3's real-data path is exercised only by fixtures until FAFF-614 lands; a schema drift between the fixture shape and the real sweep output would surface at first real flip. Mostly covered by the fixture unit tests + real-tree exit-0 assertion; to close it, treat the C3 fixture schema as a contract shared with FAFF-614's output format.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```
