# Spec — FAFF-859: Lane isolation declared field (two-axis vocabulary + config-declares → emit → assert-in)

> Spec: faffter-dark-nlspec · 2026-08-17 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-859.

This is a buildable design spec for FAFF-859, the first implementation slice of the lane-isolation declared field. Its audience is the build agent that will graft the change and the human reviewers gating it. It records WHAT to build and WHY, plus HOW-we-know-it's-done acceptance criteria. It deliberately omits code-level steps, TDD cycles, and exact commands — those belong to the build phase. The scope boundaries below come from the FAFF-834 spike and are closed; this spec ratifies an interface, it does not reopen the spike.

## 1. WHY — Problem and Principles

**The load-bearing model.** A lane's isolation today is an *aspiration* narrated in docs and half-probed by a preflight, but nothing in faff *writes down* what isolation a lane is supposed to have. This slice closes that gap with a three-step chain that runs in one direction only: an operator **declares** isolation in `.faffrc`, faff **emits** it as `lane-boundary.json` (faff becomes the first-ever writer of that file), and the lane's assert-in preflight **compares** the physically-observed boundary against that declared intent and refuses on mismatch. The declaration is never a trust source — the refuse decision always rests on a physical probe; the declared value is a second, independently-probed fact that can only *add* a refusal, never relax one.

**Problem statement.** The lane-boundary contract carries a single containment axis (`container: shared | own`) and no file in production writes it, so a lane's intended isolation is unstated and unenforced. This slice extends the vocabulary with an orthogonal locality axis (`host: local | remote`) and stands up the declare → emit → assert-in interface end to end. It ships the writer and the asserter as tested, documented primitives without wiring them into live dispatch, so the change is inert-by-construction against today's running gates.

**Design principles.**

**A declaration never relaxes a refusal.** The assert-in preflight's refuse decision must rest on a physical filesystem probe, never on what the emitted `lane-boundary.json` claims. A present declaration may be cross-checked for defence in depth, but the new isolation-mismatch leg is strictly *additive* to the refusal set — it can raise a refusal on divergence, it can never suppress one that the physical legs already raised. This mirrors the existing `evaluator-preflight.js` posture (the `correctiveIntegrityProbe` lesson: trusting a build-lane-writable declaration would re-open the forge the rung closes).

**Fail-safe-to-arm is byte-for-byte preserved.** `merge-gate.js`'s `laneBoundaryPromisesCage` and `laneBoundaryDispatchState` treat an absent `lane-boundary.json` as legacy/no-cut and a present-but-broken one as arm/indeterminate. Because `laneBoundaryDispatchState` flips *any* run with a present, valid `lane-boundary.json` to "dispatched" (which makes custody mandatory with no caller opt-out), emitting the file into live runs would silently break every non-dispatched merge. This slice must therefore leave live runs with `lane-boundary.json` still absent.

**Out-of-enum is a violation, not a crash.** `computeLaneBoundary` fails loud (exit 2) *only* on non-object structural malformation; every out-of-enum value routes to the `violations` array (exit 1 via `contractLaneBoundary`). The new `host` axis must obey this exactly — an out-of-enum `host` routes to `violations`, it never fails loud. This routing is spec-review-mandated and load-bearing for the merge-gate fail-safe (a present-but-invalid promise arms, it does not throw).

**Orthogonal axes stay orthogonal.** `container` and `host` are independent. A lane can be own-container-local or own-container-remote. No predicate that keys on one axis may silently couple in the other.

**Reference context.**

| System | Path | Relevance |
|---|---|---|
| Lane-boundary contract validator | `plugin/skills/faff/bin/lib/contract-defs.js` (~700-760, fixtures ~2215-2229) | Pure shape/enum validator `computeLaneBoundary`; gains the `host` axis + fixtures |
| Lane-boundary shape schema | `plugin/skills/faff/contracts/lane-boundary.schema.json` | Enum-free shape, `additionalProperties:false`; gains `host` property + required entry, lock-step with the validator |
| Config resolution registry | `plugin/skills/faff/bin/lib/config.js` (DEFAULTS ~60, vocab maps ~200/415, validators, selftest ~1905-1943) | Flat dotted-scalar precedent (`models.<lane>` / `effort.<lane>`) this slice follows for the declared field |
| Nested-record config precedent | `plugin/skills/faff/bin/lib/backends.js` (~97-138) | The rejected alternative config shape (co-constrained record) |
| Assert-in preflight | `plugin/skills/faff/bin/lib/evaluator-preflight.js` | Pure `evaluatorPreflight(env, fsq, repoPath)`; SHIP-NOT-WIRE; gains the isolation-mismatch leg |
| Merge-gate fail-safe | `plugin/skills/faff/bin/lib/merge-gate.js` (~531-566) | `laneBoundaryPromisesCage` / `laneBoundaryDispatchState`; must-preserve, edit-adjacency risk |
| Container detector | `plugin/skills/faff/bin/lib/container-check.js` | The injectable `(env, fsq)` seam + selftest style the new surfaces mirror |
| Isolation ladder ADR | `records/adr/` (ADR-0041, ADR-0104, ADR-0073) | Decision records the build-time ADR amends/references |

**Scope statement.** This is the declared field plus its writer and its asserter within the ADR-0041 rung-2 intent-out / assert-in seam — the interface layer beneath the cage-and-spawner enforcement that FAFF-384 wires later.

## 2. OUT OF SCOPE

- **Naming the outer orchestrator.** Excluded because ADR-0041's "first consumer decides" clause stays open; this slice ratifies the declare → assert *interface*, not its owner. Extension point: a future ADR/issue names human, CI, or factory-compute as the outer orchestrator; the interface here is agnostic to which.
- **Live wiring of emit + assert-in into dispatch.** Excluded because wiring `lane-boundary.json` into live runs would flip `laneBoundaryDispatchState` to "dispatched" and break non-dispatched merges. Extension point: FAFF-384 (the cage + spawner sibling) wires the emitter at run-dir setup and the new preflight leg into live holdout dispatch, together.
- **Per-lane secret/credential injection.** Excluded because the field declares containment/locality only; secrets remain ADR-0104's posture. Extension point: FAFF-104 reads the resolved `lanes.<lane>.isolation` field to drive per-lane credential visibility — the field is designed to be readable for this.
- **Read-only evidence mount + attestation.** Excluded because ADR-0073 defers process-isolated lanes for subscription economics. Extension point: FAFF-517 adds the mount mechanism; this slice ships only the declared field it will later assert against.
- **Remote-dispatch runtime machinery.** Excluded because `host: remote` has zero runtime meaning in this slice — it is a pure declaration that assert-in records but cannot yet physically observe. Extension point: FAFF-817's transport slot provides the remote-observation seam; until then `host: remote` mirrors `host_socket`/`integrity_signal` (declaration-only carried fields).
- **`host` in the merge-gate cage-shape predicate.** Excluded because containment (not locality) is what makes an evaluator code-blind; see the HOW section's cage-predicate decision. Extension point: none anticipated — coupling locality into the cage promise would be a regression, not a future feature.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Declared field | The operator-authored `lanes.<lane>.isolation` config shape stating a lane's intended boundary |
| Intent artifact | The `lane-boundary.json` faff emits from the declared field — the intent-out half of the ADR-0041 seam |
| Assert-in | The preflight that compares physically-observed boundary against declared intent and refuses on mismatch |
| Containment axis | `container: shared \| own` — whether the lane runs in its own isolation boundary |
| Locality axis | `host: local \| remote` — where the lane runs; orthogonal to containment |
| SHIP-NOT-WIRE | A primitive shipped built + tested + documented but not invoked from live dispatch |

**The lane-boundary intent, with the new axis.** The contract's returned shape and the JSON schema are lock-step coupled through `additionalProperties:false` — miss one side and every `faff contract lane-boundary` call fails loud. Both gain a top-level `host` field, a sibling of `container`, never nested under `accesses`.

```
RECORD LaneBoundaryIntent:
  version: integer                # >= 1 enforced via violations, not fail-loud
  lane: string                    # closed to LANE_BOUNDARY_LANES = ["evaluator"]
  container: string               # closed to ["shared", "own"]
  host: string                    # NEW — closed to ["local", "remote"]; top-level sibling of container
  accesses:
    repo: string                  # closed to ["absent", "present"]
    host_socket: string           # closed to ["absent", "present"]
  integrity_signal: boolean
  violations: Array<string>       # every out-of-enum value lands here (exit 1), never fail-loud

  CONSTRAINT non-object input → fail-loud (exit 2); any out-of-enum value → violations (exit 1)
  CONSTRAINT schema.required includes "host"; schema property host: {type:"string"} (enum enforced in JS)
```

**The declared config field.** The declared field resolves through the flat dotted-scalar registry that `models.<lane>` / `effort.<lane>` already use, not the co-constrained nested-record shape that `backends.<name>` uses. Two independent closed-vocab scalars, keyed on the full dotted path:

```
CONFIG KEYS (flat, in the DEFAULTS registry):
  lanes.evaluator.isolation.container   default "shared"   vocab ["shared", "own"]
  lanes.evaluator.isolation.host        default "local"    vocab ["local", "remote"]

  RESOLUTION  dig(cfg, key) with DEFAULTS[key] fallback (models/effort precedent)
  VALIDATION  a new validateIsolationLane(key, value) chained into the existing
              validator chain, at BOTH set (config.js ~1008) and get (~1892)
  FAIL-LOUD   an off-vocabulary value → `config get`/`config set` EXIT 2, naming the
              value and the legal set — never a silent fallback (models/effort discipline)
  ECHO        `config resolved` lists a non-default isolation value in its echo block (FAFF-50)
  SELFTEST    the registry-completeness selftest (config.js ~1905-1943) asserts both
              isolation keys are present with vocab-valid defaults
```

**The emit surface.** A net-new CLI command backed by a new lib module parallel to `container-check.js` / `evaluator-preflight.js`. Nothing in production writes `lane-boundary.json` today (only fixtures); `SKILL.md:626` classifies it as Evidence class — orchestrator/trusted-side write authority only, never lane-written.

```
COMMAND  faff lane-boundary emit [--lane <lane>] [--run-dir <dir>]
  reads   resolved lanes.<lane>.isolation.{container,host} from config
  writes  <run-dir>/lane-boundary.json carrying the full shape incl. host
  authority  orchestrator-side (trusted writer) — never invoked from within a lane
  version    writes version: 1 (see rationale — version is not a shape-discriminator this slice branches on)
```

**Design decisions in this section carry markers in Section 6 (Design Decision Rationale).** Every non-trivial pick — the second axis, the schema/validator lock-step, the config shape fork, the emit command, the SHIP-NOT-WIRE posture, the cage predicate, and the assert-in source — is resolved there with a canonical marker.

## 4. HOW — Behavior

**Architecture and approach.** Three surfaces change, all keeping their existing purity and posture. The contract validator gains a `host` enum check that mirrors the `container` check exactly (out-of-enum → `violations`). The config layer gains two flat registry keys resolved and validated like `models.<lane>`. A new emit module reads resolved config and writes the intent artifact. The assert-in preflight gains one net-new leg that compares declared intent against physical observation. The emitter and the new preflight leg are both SHIP-NOT-WIRE — built, unit-tested, documented, but not called from live dispatch — so live runs still have no `lane-boundary.json` and the merge-gate fail-safe is untouched.

**Adding the `host` enum check.** The validator gains a `LANE_BOUNDARY_HOST = ["local", "remote"]` constant and a violations check mirroring the container check at contract-defs.js ~729-732.

```
PROCEDURE computeLaneBoundary(extraction):   # additions only; existing legs unchanged
  1. IF extraction is not a plain object → return { failLoud: "extraction must be a JSON object" }   # UNCHANGED
  2. ... existing version / lane / container / accesses.* / integrity_signal checks ...
  3. host = (typeof extraction.host === "string") ? extraction.host : ""
  4. IF extraction.host NOT IN LANE_BOUNDARY_HOST:
       violations.push(`host ${JSON.stringify(extraction.host)} not in {local,remote}`)
  5. return contractData = { version, lane, container, host, accesses:{repo,host_socket}, integrity_signal, violations }
```

The returned `contractData` gains `host` between `container` and `accesses`. The schema gains `"host": {"type":"string"}` and `"host"` in `required`. Both edits ship together or every lane-boundary call fails loud.

**Anti-pattern:** routing an out-of-enum `host` to `failLoud` instead of `violations`. Why: it would make a present-but-invalid promise *throw* instead of *arm*, breaking `laneBoundaryPromisesCage`'s must-preserve fail-safe.

**Config resolution.** The two isolation keys resolve exactly like `models.<lane>`: `dig(cfg, key)` with `DEFAULTS[key]` fallback, an off-vocabulary value failing loud at both read and write via a new validator chained into the existing validator chain.

```
PROCEDURE validateIsolationLane(key, value):
  1. IF key == "lanes.evaluator.isolation.container":
       IF value NOT IN ["shared","own"] → return `config get ${key}: "${value}" not legal — legal set: shared | own`
  2. IF key == "lanes.evaluator.isolation.host":
       IF value NOT IN ["local","remote"] → return `config get ${key}: "${value}" not legal — legal set: local | remote`
  3. return null   # not this validator's key
```

**Emitting the intent artifact.** The emit module is a pure-ish writer: read resolved config, assemble the full shape, validate it through `computeLaneBoundary` before writing (never write a shape that would fail its own contract), write to `<run-dir>/lane-boundary.json`.

```
PROCEDURE emitLaneBoundary(lane, runDir, resolvedConfig):
  1. container = resolvedConfig["lanes."+lane+".isolation.container"]
  2. host      = resolvedConfig["lanes."+lane+".isolation.host"]
  3. intent = { version: 1, lane, container, host,
                accesses: { repo: <derived>, host_socket: <derived> },
                integrity_signal: <derived>, violations: [] }
  4. { contractData, failLoud } = computeLaneBoundary(intent)
  5. IF failLoud OR contractData.violations.length > 0 → error out (never write an invalid promise)
  6. write JSON.stringify(contractData) to <run-dir>/lane-boundary.json
```

The `accesses` / `integrity_signal` values this slice writes reflect the declared container (own → repo absent; shared → repo present) — the existing v1 fields, unchanged in meaning. The emitter is not invoked from live dispatch this slice (SHIP-NOT-WIRE).

**Anti-pattern:** wiring `emitLaneBoundary` into the live run-dir setup path in this slice. Why: a present, valid `lane-boundary.json` flips `laneBoundaryDispatchState` to "dispatched", making custody mandatory on every merge and breaking non-dispatched flows. Live wiring rides with FAFF-384.

**The assert-in isolation-mismatch leg.** A net-new leg in `evaluatorPreflight`. The module convention is that the pure function does no I/O — the caller resolves the declared intent and passes it in (the `requireSpawnerAttested` precedent). So the declared boundary is a new parameter, not a file the preflight reads.

```
PROCEDURE evaluatorPreflight(env, fsq, repoPath, declaredBoundary?):   # declaredBoundary optional, caller-resolved
  1. ... existing Leg 1 (in-container) and Leg 2 (repo-absent), unchanged ...
  2. IF declaredBoundary is present:
     a. observedContainer = (containerCheck(env, fsq).result == "contained") ? "own" : "shared"
     b. IF declaredBoundary.container != observedContainer:
          refusals.push({ leg: "isolation-mismatch",
                          detail: `declared container ${declaredBoundary.container} != observed ${observedContainer}` })
     c. observedHost = "local"   # this slice: no remote machinery; observation is always local
     d. IF declaredBoundary.host == "local" AND observedHost != "local":
          refusals.push({ leg: "isolation-mismatch", detail: `declared host local != observed ${observedHost}` })
        # declaredBoundary.host == "remote" → NOT asserted this slice (physical remote-observation deferred)
  3. return { holds: refusals.length == 0, refusals }
```

The leg is strictly additive: it only pushes refusals, never removes one. It compares two independently-probed facts — the caller-passed declaration and the `containerCheck` physical probe — and the physical probe is always the refuse basis for the container/repo legs. This leg, like the rest of `evaluatorPreflight`, is SHIP-NOT-WIRE.

**Edge cases and error handling.**

- **No declared boundary passed.** `declaredBoundary` absent → the isolation-mismatch leg is skipped entirely; the existing two legs behave byte-for-byte as today. This preserves the current selftest fixtures.
- **Declared `host: remote`.** Not asserted this slice — the remote observation seam does not exist. It is neither a hold nor a refuse on the host axis; the leg simply does not evaluate it. Documented as an assumption pending FAFF-817.
- **Declared `container: shared` but observed `own`.** A mismatch → refusal. Over-provisioned isolation still violates "actual equals declared intent"; surfacing it is correct. The refusal is additive and never masks the physical legs.
- **Out-of-enum declared value reaching the preflight.** Cannot occur through the supported path — config validation (exit 2) and `computeLaneBoundary` (violations) both reject off-vocabulary values upstream; the emitter refuses to write an invalid intent.

**Failure modes.**

- **The failure:** the two-axis field ships but the whole seam is inert, so a reviewer believes isolation is now *enforced* when only the interface exists. **How you'd know:** grep for a live call site of `emitLaneBoundary` or the isolation-mismatch leg — there is none this slice; live runs have no `lane-boundary.json`. **What it means:** proceed — inertness is the intended, safety-preserving outcome, explicitly scoped to FAFF-384 for wiring. Name it in the DoD so it is not mistaken for a gap.
- **The failure:** adding `host` to `required` retroactively invalidates every existing lane-boundary fixture and any present-but-old `lane-boundary.json`, arming the merge-gate ratchet unexpectedly. **How you'd know:** the `merge-gate` and `evaluator-preflight` test suites go red on fixtures lacking `host`. **What it means:** narrow — all fixtures gain `host` in this slice; because no production writer ever existed, there are no real old files to migrate, so the blast radius is test fixtures only.
- **The failure:** the cage-shape predicate silently starts depending on `host`, flipping the code-blind ratchet OFF for a legitimately caged remote evaluator. **How you'd know:** `laneBoundaryPromisesCage` returns false for an `own` + repo-absent + `host:remote` intent. **What it means:** abandon that coupling — the predicate must ignore `host` (see rationale); a test asserts an own/repo-absent intent promises the cage regardless of `host` value.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a lane-boundary intent with host "banana" (out of enum) and otherwise-valid fields
When it is validated via `faff contract lane-boundary`
Then the call exits 1 with "banana" recorded in violations, and does NOT fail loud (exit 2)
```

```
Given .faffrc sets lanes.evaluator.isolation.container to "vm" (off-vocabulary)
When `faff config get lanes.evaluator.isolation.container` runs
Then it exits 2, names the value "vm" and the legal set "shared | own", and never falls back silently
```

```
Given the evaluator preflight is called with a declared boundary container "own"
  but the physical container probe reports not-contained (observed "shared")
When evaluatorPreflight evaluates the isolation-mismatch leg
Then it adds an "isolation-mismatch" refusal and holds is false — and the refusal is additive
  (the existing in-container / repo-absent refusals are unchanged, none suppressed)
```

- The emitter and the new preflight leg have no live call site in this slice (SHIP-NOT-WIRE); live runs produce no `lane-boundary.json`.

## 6. Design Decision Rationale

**Should the field add a second axis, and what shape?**
Options: keep one containment axis and overload it (e.g. `container: shared | own | remote`) vs. add an orthogonal `host: local | remote`. Overloading conflates containment with locality and cannot express own-container-remote. The spike settled two orthogonal axes.
**Chosen:** two orthogonal axes — `container: shared | own` kept, `host: local | remote` added as a top-level sibling; a lane can be own-container-local or own-container-remote, and `host: remote` composes with FAFF-817's transport slot.

**How does the schema/validator carry the new axis without breaking every call?**
The JSON schema and the validator's returned shape are lock-step through `additionalProperties:false`. Options: add `host` to both, or add to one. Adding to one fails loud on every call.
**Chosen:** add `host` to the validator's `contractData`, the `LANE_BOUNDARY_HOST` constant, the violations check, AND the schema's properties + required array in the same change; `host` is a top-level sibling of `container`, never nested under `accesses`.

**Fail-loud or violation for an out-of-enum `host`?**
Options: fail loud (exit 2) like structural malformation, or route to `violations` (exit 1) like every other enum. Fail-loud would make a present-but-invalid promise throw, breaking the merge-gate fail-safe.
**Chosen:** an out-of-enum `host` routes to `violations` (exit 1), mirroring the `container` check exactly; fail-loud stays reserved for non-object input.

**Which config precedent — flat scalar or nested record?**
Options: flat dotted keys `lanes.evaluator.isolation.container` / `.host` (the `models.<lane>` / `effort.<lane>` precedent) vs. a per-lane validated `isolation: {container, host}` record (the `backends.<name>` precedent). The nested-record machinery earns its complexity only when fields co-constrain (backends cross-validate `auth` against `api_key_env`). Here `container` and `host` are orthogonal by the spike's own decision, so co-validation would be unjustified; the flat form reuses `dig`/`DEFAULTS` resolution, the validator chain at both set and get, exit-2 semantics, the resolved-echo, and the registry-completeness selftest with zero new architecture.
**Chosen:** two flat registry keys — `lanes.evaluator.isolation.container` and `lanes.evaluator.isolation.host` — each a closed-vocab scalar following the `models.<lane>` precedent.

**What defaults do the isolation keys bake?**
Options: an `inherit`-style no-op sentinel (as `models`/`effort` use) vs. concrete physical defaults. Isolation is a concrete physical declaration with no account-level "inherit" concept, and the default should reflect today's uncaged reality (the evaluator runs inline, sharing the run cwd) and keep the future-wired ratchet OFF unless an operator explicitly arms it.
**Chosen:** `container: shared`, `host: local` as baked defaults — an operator must explicitly declare `container: own` to (later) arm the cage.

**What is the emit surface, and who writes it?**
Options: reuse `faff contract lane-boundary` (a validator, not a writer) vs. a net-new command. `lane-boundary.json` is Evidence class — trusted-side write authority only.
**Chosen:** a net-new `faff lane-boundary emit` command backed by a lib module parallel to `container-check.js`, invoked orchestrator-side (never lane-side); the exact command spelling is low-stakes and may be adjusted at build time to match CLI-dispatch conventions, but the writer-authority and noun-namespace grouping with `faff contract lane-boundary` are fixed.

**Wire the emit + assert-in into live dispatch this slice?**
Options: wire it live (operator declares → faff emits every run → preflight asserts) vs. SHIP-NOT-WIRE. Live wiring flips `laneBoundaryDispatchState` to "dispatched" for every run, making custody mandatory and breaking non-dispatched merges; it also would refuse on every uncaged run once the preflight is live. The existing `evaluator-preflight.js` is already SHIP-NOT-WIRE for exactly this reason (wiring deferred to FAFF-384).
**Chosen:** SHIP-NOT-WIRE — the emitter and the isolation-mismatch leg are built, unit-tested, and documented but not invoked from live dispatch; live runs keep `lane-boundary.json` absent, so the merge-gate fail-safe is byte-for-byte preserved. Live wiring rides with FAFF-384.

**Does `host` enter the merge-gate cage-shape predicate?**
Options: add `host` to `laneBoundaryPromisesCage`'s predicate (`lane==="evaluator" && container==="own" && accesses.repo==="absent"`) vs. leave it out. Containment plus repo-absence is what makes an evaluator code-blind; locality is orthogonal. Coupling `host` in would flip the ratchet OFF for a legitimately caged remote evaluator.
**Chosen:** `host` stays OUT of the cage-shape predicate — an own-container/repo-absent lane promises the cage regardless of `host`.

**Where does the assert-in leg get the declared intent?**
Options: the pure preflight reads `lane-boundary.json` (or config) itself vs. the caller resolves it and passes it in. The module convention is that the pure function does no I/O (the `requireSpawnerAttested` precedent).
**Chosen:** the caller resolves the declared boundary and passes it as a parameter; `evaluatorPreflight` stays pure. The declaration is a second independently-probed fact, and the isolation-mismatch leg is strictly additive — it never relaxes a refusal the physical legs raised.

**How does assert-in physically observe `host: local | remote` with no remote machinery?**
Options: treat any declared `host: remote` as a mismatch against the always-local observation (would refuse every remote declaration) vs. assert only the physically-observable `host: local` and treat `host: remote` as declaration-only. `host: remote` has zero runtime meaning this slice, so refusing on it would contradict the scope boundary.
**Chosen:** the assert-in leg asserts `host: local` against the always-local observation and does not evaluate `host: remote`; the remote physical assertion is deferred. (See the Assumptions section — FAFF-817.)

**Does the emitted `version` change now that the shape gained a field?**
Options: bump the emitted intent to `version: 2` to signal the host-carrying shape vs. keep `version: 1`. `computeLaneBoundary` never branches on `version`; the field is a forward-looking monotonic integer, not a shape discriminator, and there is no prior production writer to be compatible or incompatible with.
**Chosen:** the emitter writes `version: 1`; `host`'s requiredness is enforced uniformly regardless of `version`, and all existing fixtures gain `host` (test-fixture-only blast radius, since no production writer ever existed). At the time of writing, `version` gates nothing behaviourally — revisit if a future slice makes it a shape discriminator.

**Is the outer-orchestrator owner named here?**
The spike deliberately kept the owner open ("first consumer decides", ADR-0041) while ratifying the interface.
**Chosen:** ratify the declare → assert interface, keep the owner open — this slice names neither human, CI, nor factory-compute as the outer orchestrator. Note this is distinct from *where within faff's own run* the intent is emitted, which is faff's call (orchestrator-side, at run-dir setup) and is settled above.

**What ADR intent does this slice record for build time?**
The ADR is materialised at build time (faff-graft Step 4b), not by prep; the spec only records the intent.
**Chosen:** the build-time ADR amends ADR-0041 (close its "outer-orchestrator deliberately unresolved" clause by ratifying the interface, not the owner) and references ADR-0104 (two-axis vocabulary in its rung mapping). Separately, the ADR-0072→ADR-0073 citation drift is fixed in FAFF-517's Linear ticket text — see Assumptions (it is an external tracker edit, not repo prose).

## 7. Open Questions and Assumptions

**Open Questions.** None. Every non-trivial decision is either spike-settled or resolved in Section 6; there is no call that requires a human to settle before build.

**Assumptions.**

- **Assumes:** FAFF-817's transport slot will provide the remote-observation seam that lets assert-in physically verify `host: remote`. Validation before build: confirm no remote-dispatch machinery exists today (grep for a transport/remote-dispatch call site); if one has since landed, revisit whether `host: remote` becomes physically assertable in this slice rather than deferred.
- **Assumes:** FAFF-104 will read the resolved `lanes.<lane>.isolation` field to drive per-lane secret injection. Validation before build: confirm the field is resolvable via the standard config path (`dig` + `DEFAULTS`) so FAFF-104 can consume it without new plumbing.
- **Assumes:** FAFF-517 (read-only evidence mount + attestation, deferred per ADR-0073) is the consumer that later asserts a mount against this declared field. Validation before build: confirm no mount mechanism is expected in this slice — it is out of scope.
- **Assumes:** FAFF-384 (the cage + spawner sibling) is where the emitter and the new preflight leg get wired into live dispatch. Validation before build: confirm `evaluator-preflight.js` is still SHIP-NOT-WIRE (no live call site); if FAFF-384 has already wired it, reconsider whether this slice can safely wire emission too.
- **Assumes:** the ADR-0072→ADR-0073 citation drift lives only in FAFF-517's Linear ticket text (title + body), not in repo prose. Validation before build: grep the repo for a mis-citation of this topic — the explore pass found none; if the grep is still clean, the fix is a tracker edit to FAFF-517, owned by the orchestrator, not a code/doc change in this slice.

## 8. DONE — Definition of Done

### From WHY
- [ ] Live runs still produce no `lane-boundary.json`; `laneBoundaryDispatchState` returns "absent" for an ordinary run and custody stays non-mandatory (fail-safe byte-for-byte preserved).
- [ ] The declare → emit → assert-in interface exists end to end as tested primitives, with no live call site (SHIP-NOT-WIRE), documented as such.

### From WHAT (types and interfaces)
- [ ] `computeLaneBoundary` returns `host` between `container` and `accesses`; `LANE_BOUNDARY_HOST = ["local","remote"]` exists.
- [ ] `lane-boundary.schema.json` has `"host": {"type":"string"}` and `"host"` in `required`; the validator and schema shapes match (no lane-boundary call fails loud on a valid host-carrying intent).
- [ ] `DEFAULTS` contains `lanes.evaluator.isolation.container` ("shared") and `lanes.evaluator.isolation.host` ("local"); the registry-completeness selftest asserts both.
- [ ] `faff lane-boundary emit` exists, reads resolved config, and writes a valid host-carrying `lane-boundary.json` to the target run-dir.

### From WHAT (config validation)
- [ ] `config get`/`set` of an off-vocabulary `lanes.evaluator.isolation.container` exits 2 naming the value and "shared | own"; same for `.host` with "local | remote".
- [ ] A non-default isolation value appears in the `config resolved` echo block.

### From HOW (behaviour)
- [ ] An out-of-enum `host` routes to `violations` (exit 1 via `contractLaneBoundary`), never fail-loud (exit 2).
- [ ] `evaluatorPreflight` accepts an optional declared-boundary parameter and, when present, adds an `isolation-mismatch` refusal on declared-vs-observed `container` divergence.
- [ ] The isolation-mismatch leg is additive: with a declared boundary passed, the existing in-container and repo-absent refusals are unchanged (none suppressed).
- [ ] With no declared boundary passed, `evaluatorPreflight` behaves byte-for-byte as before (existing selftest fixtures stay green).
- [ ] Declared `host: local` is asserted against the always-local observation; declared `host: remote` is not evaluated (no refusal, no hold on the host axis).

### From HOW (edge cases + must-preserve)
- [ ] `laneBoundaryPromisesCage` returns true for an `own` + repo-absent intent regardless of `host` value (host excluded from the cage predicate).
- [ ] `laneBoundaryPromisesCage` / `laneBoundaryDispatchState` fail-safe tests (`test/merge-gate*.test.mjs`) stay green.
- [ ] The emitter refuses to write an intent that fails its own `computeLaneBoundary` contract (never writes an invalid promise).
- [ ] All lane-boundary contract fixtures (contract-defs.js ~2215-2229) carry `host`; new fixtures cover a conformant host, an out-of-enum host (→ violations), and a missing host.
- [ ] `faff validate-adapters`, `faff lint-refs`, `faff lint-cli-doc`, and the full `node --import ./test/hermetic-env.mjs --test test/` suite pass.

### ADR intent (recorded, not authored here)
- [ ] The spec records that the build-time ADR amends ADR-0041 and references ADR-0104, and that the ADR-0072→0073 citation drift is fixed in FAFF-517's Linear ticket text (no repo prose change in this slice).

**Integration smoke test.**

```
PROCEDURE isolation_field_smoke:
  1. Set lanes.evaluator.isolation.container = "own", host = "remote" in a test .faffrc
  2. Run `faff lane-boundary emit --lane evaluator --run-dir <tmp>` → exit 0
  3. Read <tmp>/lane-boundary.json → validate via `faff contract lane-boundary` → exit 0, host == "remote"
  4. Call laneBoundaryPromisesCage(<tmp>) → true (own + repo-absent, host ignored)
  5. Assert an ordinary live run-dir (no emit) still yields laneBoundaryDispatchState == "absent"
```

confidence: high
build-tier: complex
