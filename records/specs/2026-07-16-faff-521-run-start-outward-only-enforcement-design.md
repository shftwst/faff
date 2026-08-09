# FAFF-521 — Run-start OUTWARD-only enforcement for autonomous plot ignition (494b)

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-521.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): the self-identity oracle punt is closed. **Oracle = repo-slug match (`target.repo == tracking.repo`)**; the pure `decide_outward` core is unchanged (keeps accepting both `is_self` and `self.repo`); plot-ignition populates `--self` via the slug match (faff's container is unset by ADR-0069, so the slug is the robust positive marker); **no new `tracking.self` knob**. Re-rated **medium → high** (no open punts remain).

This spec is for the build agent implementing FAFF-521, and for the human reviewers who gate it. It specifies the **producer of `signals.outward`** — the outward-only target-resolution predicate that decides whether an autonomous pass is aimed *outward* (at an adopter/greenfield container) or is *self-directed* (at faff's own container) — and the wiring that puts that signal behind `/faff-plot --autonomous` ignition. It assumes the reader has *not* seen the surrounding code; every external dependency is named and marked.

## Refresh (operator resolution, 2026-07-16)

The §7 self-identity oracle Punt is now **Chosen** and folded below:

- **Oracle = repo-slug match** — the plot-ignition wiring populates `SelfRef` by setting `self.repo := tracking.repo` (faff's own repo slug from config) and computing `is_self := (target.repo == tracking.repo)`. Because faff's own container is unset by construction (ADR-0069), the repo-slug is the robust positive self-marker.
- **The pure `decide_outward` core is unchanged** — it already accepts both `is_self` (rung 1) and `self.repo` (rung 4); this resolution only fixes *how the caller populates `--self`*, not the core ladder. No core edit is needed.
- **No `tracking.self` config knob** — do not add a `tracking.self: true` marker; the existing `tracking.repo` is the source.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff run-start` (shipped: FAFF-496, PR #402 / commit `737fb66`) already *owns the refusal*: its fixed ladder (`deriveRunTrigger`, `run-start.js:61`) has the outward floor as rung 2 — `if (!s.outward) return { verdict: "refuse", reason: "self-directed" }`, positioned deliberately *before* the PRD checks (ADR-0069). What run-start does **not** own is the *input*: `signals.outward` arrives as a passed-in boolean, and **nothing in the tree computes it**. The CLI's own help text says so verbatim — "the ADR-0069 outward-only read (`signals.outward`, **mechanism = FAFF-521**)". This ticket ships that mechanism: the predicate that resolves a run's target and computes the one boolean run-start's outward floor consumes, then wires it behind `/faff-plot --autonomous` ignition so a self-directed autonomous plot pass refuses at the top of the loop.

**Problem statement.** Today the shipped `/faff-plot --autonomous` ignition (FAFF-494) protects itself with only a **stub guard** (`faff-plot/SKILL.md:185`) that asserts a minted L4 run-ledger exists — it does *not* check whether the target is faff's own container, so a pass ignited against faff-the-substrate would proceed. This violates ADR-0069 (faff is L3-on-itself; autonomous planning is aimed **outward only**). This change replaces the stub with a real outward-only predicate feeding `faff run-start`, so ignition refuses when the target is self-directed.

**Design principles.**

- **Refuse, never park-and-retry, on self-direction.** A self-directed target is not a transient condition that a later retry could clear — it is a policy boundary (ADR-0069). The outcome is `needs-human`, terminal, **zero writes**. Park-and-retry here would busy-loop against an intentional guardrail.
- **Fail-safe toward self-directed.** `outward` is `true` **only** when the target *positively* resolves to a non-self adopter/greenfield container. Any doubt — unresolvable target, self-referential target, indeterminate self-identity — coerces to `outward: false` (refuse). This mirrors run-start's own refusal bias, where the privileged `plan` is unreachable unless every affirmative signal is explicitly `true`.
- **Compute the signal, do not re-implement the refusal.** run-start (FAFF-496) is the single home of the {verdict, reason} taxonomy and the refusal ladder. This ticket produces the boolean input and calls run-start; it must **not** re-derive `refuse`/`self-directed` itself. One gate, computed once (see the FAFF-496 boundary in §7).
- **Purity, house pattern.** Every run-start signal has exactly one producer CLI, pure (no tracker/network/disk beyond args), consumed by run-start as a passed-in boolean (`run-start.js:1-13`). `signals.outward`'s producer follows suit: the caller resolves the live target and self-identity and passes them in; the CLI only decides.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/run-start.js` | JS (pure CLI) | Consumer: `deriveRunTrigger` rung 2 reads `signals.outward`; unchanged by this ticket |
| `plugin/skills/faff/bin/lib/contain.js` | JS (pure CLI) | Sibling pattern: pure subtree predicate taking agent-sourced input via `--ancestry`, fail-closed to `outward`; the shape this producer mirrors |
| `plugin/skills/faff/contracts/run-trigger.schema.json` | JSON Schema | Names `signals.outward` and attributes its mechanism to FAFF-521; unchanged |
| `plugin/skills/faff-plot/SKILL.md` §Ignition (line 182-185) | Prose skill | The stub-guard site this ticket hardens |
| `records/adr/0069-…-no-self-prd-….md` | ADR | The outward-only policy this predicate enforces |
| `plugin/skills/faff/bin/faff` (dispatch) | JS | Registers the new subcommand (parity with `"run-start": cmdRunStart`, line 207) |
| `.faffrc.yaml` `tracking.repo` | YAML config | The faff-self repo slug the ignition wiring reads to populate `SelfRef` (the oracle) |

**Scope statement.** This is the `signals.outward` producer + its `/faff-plot --autonomous` ignition wiring — one rung's input in the run-start trigger family, sequenced with FAFF-496 (owns the taxonomy) and FAFF-498 (owns the beep-boop §0a wiring that consumes the same signal).

## 2. OUT OF SCOPE

- **The run-start refusal ladder and {verdict, reason} taxonomy** — Owned by FAFF-496, shipped (PR #402). This ticket calls `faff run-start`; it does not touch `deriveRunTrigger`, the reason enum, or `run-trigger.schema.json`. **Extension point:** the producer emits the boolean; run-start's rung 2 consumes it, unchanged.
- **Beep-boop §0a wiring of run-start** — Owned by FAFF-498, which threads *this ticket's* `signals.outward` into `faff-beep-boop/SKILL.md` §0a alongside the existing PRD-admissibility pre-check. **Extension point:** this ticket exposes the producer as a named CLI so §0a and the plot-ignition guard consume one identical signal, populating `--self` the same way (repo-slug match); FAFF-498 adds the §0a call site.
- **PRDR authoring/admission at ignition** — Step 5b defers to a `Proposed` PRDR (FAFF-494); admission is FAFF-495. Untouched.
- **Container/subtree containment (`faff contain`)** — A *different* question ("is this parent inside the mandate subtree?", used at per-node write time, `faff-plot/SKILL.md:209`). The outward-only signal is a *run-target* question ("is the run aimed at faff-self?"). No overlap; `contain` is not modified.
- **A `tracking.self` config marker** — the oracle resolution rejects a new self-marker knob; `tracking.repo` (already in config) is the self-identity source. Not in scope to add.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| **Target** | The container an autonomous pass is aimed at, resolved **explicit > inherited > methodology-default** (FAFF-40 order; `SKILL.md:1038`). A ref: `{ container, repo }` or empty. |
| **faff-self** | faff's own tracking container / repo — the substrate. Per ADR-0069 it has no PRD by construction (`faff prd list` → `[]`, `tracking.container` unset), but `tracking.repo` IS set — the repo slug is the positive self-marker. Aiming autonomous *direction* here is out-of-policy. |
| **outward** | The target positively resolves to an adopter/greenfield container that is **not** faff-self. The only state in which autonomous planning may proceed (ADR-0069). |
| **self-directed** | The target is faff-self (its repo slug matches `tracking.repo`), is self-referential, is unresolvable, or self-identity is indeterminate. `outward: false` → run-start refuses. |

**Type definitions.**

```
RECORD TargetRef:
  container: string | null        # resolved container id; null when unresolved
  repo:      string | null        # resolved target repo slug; null when unresolved
  source:    "explicit" | "inherited" | "methodology-default" | "unresolved"

RECORD SelfRef:                    # the faff-self identity the caller supplies (oracle = repo-slug match)
  container: string | null        # faff's own tracking container (null by ADR-0069 construction)
  repo:      string | null        # faff's own repo slug (tracking.repo) — the populated oracle input
  is_self:   bool                 # caller-computed: target.repo == tracking.repo (the repo-slug match)

RECORD OutwardSignal:             # the producer's emitted payload (report-only, boolean in payload)
  target:   TargetRef
  outward:  bool                  # true iff target positively resolves to a non-self container
  reason:   OutwardReason

ENUM OutwardReason:
  "outward-adopter"               # outward: true  — target resolves to a non-self container
  "self-container"                # outward: false — target == faff-self container/repo
  "self-marked"                   # outward: false — SelfRef.is_self asserted (repo-slug match) for this invocation
  "unresolved-target"             # outward: false — no container resolvable (fail-safe)
  "self-referential"              # outward: false — target ref points back at the invoking repo
```

**CLI surface.** A new pure subcommand, parity with `faff contain` / `faff run-start`:

```
faff run-outward --target <json> [--self <json>] [--json]
  --target <json>   a TargetRef {container, repo, source} — resolved by the caller from live reads
  --self   <json>   a SelfRef {container, repo, is_self} — the caller's faff-self identity (repo-slug oracle)
  --json            emit the OutwardSignal as JSON (default: human line)
  exit 0 always (report-only; the boolean is in the payload — parity with `faff run-start`)
  exit 2 on malformed --target / --self JSON (usage class — parity with contain/run-start)
```

The boolean is emitted in the payload (not encoded in the exit code) so both call sites read `.outward` and hand it straight to `faff run-start --signals '{"outward": <bool>, …}'`. Report-only exit 0 keeps the *refusal* single-homed in run-start (a distinct exit-3 here would invite a caller to branch on it and duplicate the gate — the anti-pattern §7 confirms out).

**Design decisions** (full rationale in §6):

- **Where the signal lives.** New pure CLI `faff run-outward` vs a private helper inside `run-start.js`. **Chosen:** a new named CLI. Rationale: run-start's contract is "each named CLI stays the sole producer of its own signal, consumed here as a passed-in boolean" (`run-start.js:12`); a private helper would fold two producers into one module and deny FAFF-498's §0a the same clean seam.
- **Report-only vs exit-coded refusal.** **Chosen:** report-only exit 0, boolean in payload. Rationale: the refusal is run-start's job; a self-directed exit code would tempt call sites to refuse locally and double-gate.
- **Fail-safe direction.** **Chosen:** default `outward: false`. Rationale: an over-refusal costs a surfaced `needs-human` a human clears; an over-permit lets autonomous direction-setting touch the substrate — the exact unbounded-blast-radius harm ADR-0069 forbids.
- **Self-identity oracle (was Punt — resolved 2026-07-16).** **Chosen:** repo-slug match (`target.repo == tracking.repo`). The ignition wiring reads `tracking.repo` from config to populate `SelfRef.repo` and computes `is_self` as the slug match. faff's container being unset by ADR-0069 makes the slug the only robust positive marker. No `tracking.self` knob; the pure core is unchanged (it already accepts both `is_self` and `self.repo`).

## 4. HOW — Behavior

**Architecture.** Two pieces: (1) the pure `run-outward` decision core; (2) the `/faff-plot --autonomous` ignition wiring that resolves the live inputs, calls the producer, then calls `faff run-start`, and refuses on a non-`plan`/`drain` verdict.

**The decision core** (pure; the whole born-verifiable heart — UNCHANGED by the oracle resolution):

```
PROCEDURE decide_outward(target: TargetRef, self: SelfRef) -> OutwardSignal:
  # Fail-safe ladder — first-matching-check-wins, biased toward self-directed (outward:false).
  1. IF self.is_self == true:
       RETURN { outward: false, reason: "self-marked" }        # caller asserts this is faff-the-substrate (repo-slug match)
  2. IF target.container is null AND target.repo is null:
       RETURN { outward: false, reason: "unresolved-target" }  # nothing positively resolved (fail-safe)
  3. IF target.container != null AND target.container == self.container:
       RETURN { outward: false, reason: "self-container" }     # aimed at faff's own container
  4. IF target.repo != null AND self.repo != null AND target.repo == self.repo:
       RETURN { outward: false, reason: "self-referential" }   # aimed back at the invoking (faff) repo
  5. RETURN { outward: true, reason: "outward-adopter" }        # positively a non-self container
```

Note the null-safety in rungs 3-4: a `null == null` match must **not** read as self (two absent containers are not "the same container") — hence the explicit `!= null` guards. An all-null target is already refused at rung 2; an all-null self with a resolved non-self target is legitimately outward.

**Behavior summary.** `decide_outward` answers one question — "is this run positively aimed at a non-self container?" — and returns `false` for every other case. It never throws; malformed JSON is rejected at the CLI boundary (exit 2), not inside the core. The oracle resolution changes only how the *caller* fills `SelfRef`, not this core.

**The ignition wiring** (replaces the FAFF-494 stub guard, `faff-plot/SKILL.md:182-185`):

```
PROCEDURE plot_autonomous_ignition(brief):
  1. Resolve the target: explicit(brief/args) > inherited(ledger/config) > methodology-default (FAFF-40).
     Build TargetRef from live reads (never hard-coded true — the contain.js honesty rule, SKILL.md:207).
  2. Resolve SelfRef via the REPO-SLUG ORACLE (resolved 2026-07-16):
       self.repo    := faff config get tracking.repo         # faff's own slug
       self.container := faff config get tracking.container   # null by ADR-0069 construction
       self.is_self := (target.repo != null AND target.repo == self.repo)   # the repo-slug match
     (No tracking.self knob is read; the slug match IS the self-marker.)
  3. sig = faff run-outward --target <TargetRef> --self <SelfRef> --json   # → OutwardSignal
  4. Mint the L4 run-ledger via the existing lights-out preflight (unchanged), capturing target_resolved.
  5. v = faff run-start --signals { target_resolved, outward: sig.outward, prd_present, prd_ambiguous,
                                    prd_admissible, coverage_measurable, coverage_covered }
     (each sibling signal from its own producer — this ticket supplies ONLY `outward`.)
  6. BRANCH on v.verdict:
       refuse (reason self-directed | no-target | …) -> REFUSE ignition: ZERO writes, outcome `needs-human`,
                                                        surface for /faff-wtf, STOP. NEVER park-and-retry.
       plan | drain                                  -> proceed to the §gate→verdict seam (FAFF-494).
```

**Edge cases and error handling.**

- **Unresolvable target** — rung 2 → `outward:false` → run-start refuses. (A greenfield adopter with a genuinely unset target is not silently admitted; the Assumes clause requires a resolvable adopter/greenfield container — an unresolvable one is correctly refused, not park-retried.)
- **Malformed `--target`/`--self` JSON** — CLI exit 2 (usage). The ignition wiring treats a non-zero producer exit as **refuse** (fail-safe), identical to run-start's own fail-loud handling — never an implicit proceed.
- **run-start emits a non-`refuse` but non-`plan`/`drain` verdict** — impossible by the closed enum, but the branch defaults any non-`plan`/`drain` to refuse (defensive).
- **A human explicitly targets an adopter from the faff repo** — the oracle computes `is_self` from `target.repo == tracking.repo`, so an explicit *outward* target (`target.repo != tracking.repo`) yields `is_self:false` and is honoured; the slug match only fires `self-marked` when the target genuinely resolves back to faff's own slug. This is exactly the precision the repo-slug oracle buys.
- **`tracking.repo` unset in config** — `self.repo` is null; the `is_self` slug match cannot fire and rung 4 is null-guarded, so self-detection degrades to rung 3 (`self.container`, also null by ADR-0069) — i.e. no positive self-marker. This is the fail-safe corner: a resolved non-self target still reads outward, but there is no self-protection. In faff's config `tracking.repo` is set, so this is a misconfig guard, not the live path; `config check` should flag an unset `tracking.repo` when `/faff-plot --autonomous` is reachable.

**Failure modes.**

- **The failure:** the oracle mis-marks a legitimate greenfield/adopter run as faff-self (false `is_self`), over-refusing real outward work. **How you'd know:** a greenfield/adopter `/faff-plot --autonomous` pass returns `needs-human` / `self-marked` with a resolvable non-self target in the surfaced payload. **What it means:** the `target.repo`/`tracking.repo` comparison is wrong (slug normalisation) — the `--self` input is wrong, not the core ladder.
- **The failure:** the oracle *under*-marks — faff-self is not recognised (e.g. `tracking.repo` unset), a self-directed pass reads `outward:true` and proceeds. **How you'd know:** a pass ignited in the faff repo with no explicit outward target creates structure (Scenario S2 would fail; `faff audit` shows autonomous creates against faff's container). **What it means:** the fail-safe rungs did not catch it — confirm `tracking.repo` is set and the slug comparison is exact; this is the load-bearing correctness case and gets the holdout.

**Anti-pattern:** re-deriving `refuse`/`self-directed` in the producer or the ignition wiring. Why: run-start (FAFF-496) is the single home of that verdict; a second derivation is the double-gate §7 confirms out. The producer emits a boolean; run-start decides.

**Anti-pattern:** encoding self-directed as a distinct CLI exit code. Why: it invites a call site to refuse on the exit code and skip run-start, splitting the gate.

**Anti-pattern:** adding a `tracking.self: true` config knob. Why: the oracle resolution rejects it — `tracking.repo` already identifies faff-self via the slug match; a second marker is a redundant source of truth that can drift.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an autonomous plot pass whose target positively resolves to an adopter container (repo != tracking.repo, container != faff-self)
When decide_outward runs with SelfRef populated by the repo-slug oracle
Then it returns { outward: true, reason: "outward-adopter" } and faff run-start yields a plan|drain verdict (ignition proceeds)
```

```
Given a target that resolves to no container and no repo (both null)
When decide_outward runs
Then it returns { outward: false, reason: "unresolved-target" } (fail-safe), and ignition refuses with zero writes
```

- The producer is a pure CLI: `faff run-outward --selftest` MUST pass a decision table with one row per `OutwardReason`, including the null-safety rows (two-null-containers ≠ self-container; all-null-self + resolved-target = outward).
- The producer re-implements no run-start reason: grep confirms `decide_outward` returns only `OutwardReason` tokens and never the `run-trigger` `{verdict, reason}` vocabulary.
- The ignition wiring populates `SelfRef` from `tracking.repo` (the repo-slug oracle), not a `tracking.self` knob: grep the wiring for `tracking.repo` present and `tracking.self` absent.

## 6. Design Decision Rationale

**Where does `signals.outward` get computed?**
- *Options:* (a) new pure CLI `faff run-outward`; (b) private helper folded into `run-start.js`; (c) computed inline in the plot-ignition prose.
- (b) breaks run-start's "each named CLI is the sole producer of its own signal" invariant and denies FAFF-498's §0a a clean seam. (c) is not born-verifiable and duplicates once §0a needs it.
- **Chosen:** (a) a new pure CLI — parity with `faff contain`/`faff run-start`, one producer, consumed by both call sites as a passed-in boolean.

**Report-only vs an exit-coded refusal?**
- *Options:* (a) report-only exit 0, boolean in payload; (b) exit 0 outward / exit 3 self-directed (contain-style).
- (b) tempts a caller to refuse on exit 3 and skip run-start — the double-gate.
- **Chosen:** (a) — the refusal stays single-homed in run-start.

**How is "faff's own container" positively identified? (was Punt — resolved 2026-07-16)**
- *Options:* (a) an explicit config self-marker (e.g. `tracking.self: true`); (b) repo-slug match (`target.repo == tracking.repo` where the repo is faff's); (c) the ADR-0069 signature (no PRD + unset `tracking.container`).
- (c) conflates faff-self with a legitimately-unconfigured greenfield adopter (also no container yet) — unsafe as a *positive* self-marker. (a) adds a second source of truth that can drift from `tracking.repo`.
- **Chosen:** (b) repo-slug match. The ignition wiring populates `SelfRef.repo` from `tracking.repo` and computes `is_self := target.repo == tracking.repo`. faff's container is unset by construction (ADR-0069), so the repo slug is the most robust positive marker available. The pure core already accepts both `is_self` and `self.repo`, so no core change; only the caller's `--self` population is fixed. No `tracking.self` knob.

**Fail-safe direction.**
- **Chosen:** default `outward: false`. An over-refusal is a cheap surfaced `needs-human`; an over-permit lets autonomous direction touch the substrate (ADR-0069's unbounded blast radius).

## 7. Open Questions and Assumptions

**Open Questions.** None — the self-identity oracle Punt is resolved (2026-07-16):

- **The faff-self identity oracle — RESOLVED (Chosen: repo-slug match).** `SelfRef` is populated by the ignition wiring from `tracking.repo`; `is_self := target.repo == tracking.repo`. No `tracking.self` knob. FAFF-498's §0a wiring populates `--self` identically, so both call sites share one oracle.

**Boundary confirmation (not open — settled at prep).** The FAFF-496 boundary (Punt P1 from FAFF-494's spec, the reason for the 494a/494b split) is **resolved**: FAFF-496 shipped (PR #402) and owns run-start's refusal ladder + the `{verdict, reason}` taxonomy *including* the outward floor (rung 2). FAFF-521 owns **only** the `signals.outward` producer + the plot-ignition call site. There is **no double-gating**: the producer emits a boolean, run-start performs the single refusal. This is option (ii) from the ticket's boundary note — 496 owns the taxonomy once; 521 is the extraction that feeds it.

**Assumptions.**

- **Assumes:** `faff run-start` (FAFF-496, PR #402 / `737fb66`) is shipped with the outward floor at ladder rung 2 consuming `signals.outward`. *Validate:* `faff run-start --selftest` passes; `deriveRunTrigger` (`run-start.js:63`) refuses `self-directed` on `outward:false`.
- **Assumes:** the run target resolves to an adopter/greenfield container via **explicit > inherited > methodology-default** (FAFF-40 order, `SKILL.md:1038`). FAFF-438 (human writes an explicit target) is **note-only context, not a gate**. *Validate:* the resolution order is honoured at ignition step 1; an unset target correctly refuses (not park-retry).
- **Assumes:** `tracking.repo` is set in faff's config (it is the oracle input). *Validate:* `faff config get tracking.repo` returns faff's slug; `config check` flags an unset `tracking.repo` when `/faff-plot --autonomous` is reachable (the under-mark fail-safe corner).
- **Assumes:** FAFF-494's plot-ignition stub guard exists at `faff-plot/SKILL.md:182-185` as the hardening site, commented with the `FAFF-521` breadcrumb. *Validate:* the stub prose is present and this ticket replaces it (not adds a parallel guard).
- **Assumes:** the CLI dispatch registers subcommands in `plugin/skills/faff/bin/faff` (parity with `"run-start": cmdRunStart`, line 207). *Validate:* `faff run-outward --selftest` is reachable after wiring.

## 8. DONE — Definition of Done

### From WHY
- [ ] A self-directed `/faff-plot --autonomous` ignition refuses at run-start with **zero** tracker/structure writes and a `needs-human` outcome, never park-and-retry.
- [ ] The producer computes `signals.outward` and hands it to `faff run-start`; it does **not** re-derive `refuse`/`self-directed` (grep: no `run-trigger` verdict/reason tokens in the producer).

### From WHAT (types and CLI)
- [ ] `faff run-outward --target <json> [--self <json>] [--json]` exists, pure (no tracker/network/disk beyond args), registered in `bin/faff`.
- [ ] Emits an `OutwardSignal { target, outward, reason }`; `reason ∈ OutwardReason` enum; report-only exit 0; exit 2 on malformed `--target`/`--self` JSON.

### From HOW (behaviour)
- [ ] `decide_outward` returns `outward:true / outward-adopter` only when the target positively resolves to a non-self container (repo and container both ≠ faff-self).
- [ ] `self.is_self==true` → `outward:false / self-marked` (rung 1).
- [ ] `target.container == self.container` (both non-null) → `outward:false / self-container`.
- [ ] `target.repo == self.repo` (both non-null) → `outward:false / self-referential`.
- [ ] Unresolved target (container and repo both null) → `outward:false / unresolved-target` (fail-safe).
- [ ] Null-safety: two null containers do **not** match as self-container; all-null self with a resolved non-self target → `outward:true`.

### From HOW (the oracle — resolved 2026-07-16)
- [ ] The plot-ignition wiring populates `SelfRef` from `tracking.repo` (the repo-slug oracle) and computes `is_self := target.repo == tracking.repo`; no `tracking.self` knob is read (grep: `tracking.repo` present, `tracking.self` absent at the call-site).
- [ ] An explicit outward target from within the faff repo (`target.repo != tracking.repo`) yields `is_self:false` and is honoured (outward); only a target resolving back to `tracking.repo` fires `self-marked`.

### From HOW (edge cases)
- [ ] The ignition wiring treats a non-zero producer exit as **refuse** (fail-safe), never an implicit proceed.
- [ ] A non-`plan`/`drain` run-start verdict at ignition → refuse (no writes).

### From HOW (integration)
- [ ] The FAFF-494 stub guard at `faff-plot/SKILL.md:182-185` is **replaced** (not paralleled) by the run-outward → run-start ignition sequence; the `FAFF-521` breadcrumb is resolved.
- [ ] The producer is exposed as a named CLI so FAFF-498's §0a wiring consumes the identical signal and populates `--self` via the same repo-slug oracle (no second producer, no second oracle).

### Verification
- [ ] `faff run-outward --selftest` passes a decision table with one row per `OutwardReason` plus the two null-safety rows.

**Integration smoke test:**

```
1. Build a TargetRef for a non-self adopter container: { container: "ADOPT-1", repo: "acme/app", source: "explicit" }.
   SelfRef via oracle: { repo: (faff config get tracking.repo), container: null, is_self: ("acme/app" == tracking.repo) }  # false
   faff run-outward --target … --self … --json  -> { outward: true, reason: "outward-adopter" }
   faff run-start --outward --target-resolved … -> verdict plan|drain  (ignition would proceed)
2. Build a self-directed ref: target.repo == tracking.repo (oracle sets is_self:true)
   faff run-outward … --json -> { outward: false, reason: "self-marked" | "self-referential" }
   faff run-start --no-outward --target-resolved -> { verdict: "refuse", reason: "self-directed" }
   Ignition performs ZERO writes, outcome needs-human.  # if this one path holds, the plumbing is connected
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
