# Escaped-side-effect detection — declared-effects ledger (FAFF-106)

> Spec: faffter-dark-nlspec · 2026-06-30 · autonomous · confidence: high. Full spec on Linear FAFF-106.
> **Revised 2026-06-30 (autonomous refresh)** — folded in the human Decision (2026-06-29 14:05): the observation-surface scope is resolved to **Option A — faff-mediated only**. The sole architectural Punt is now closed; re-rated **medium → high**. Reference line-numbers re-grounded against the current `bin/faff`.

This is the build spec for FAFF-106, the **detection** half of the *Audit, forensics & side-effect detection* project. Audience: the build agent implementing it. The one architectural decision this spec previously escalated — the observation-surface scope — was **ratified by the human (2026-06-29 14:05): Option A, faff-mediated only**. It builds directly on the shipped `faff events` substrate (FAFF-35) and feeds the already-shipped Sentry consumer (FAFF-49).

## 1. WHY — Problem and Principles

**The load-bearing model.** A *declared-effects ledger* is a per-step record of the side-effects a pipeline step **intends** to perform. Detection is then a set-difference: any side-effect faff **observes** that is not covered by the active step's declaration is an *escape* — and an escape raises a fixed escaped-side-effect signal that recovery (FAFF-37) and the live kill-switch (Sentry, FAFF-49) act on.

**Problem statement.** Today faff has a *consumer* for an escaped-side-effect signal (Sentry's `forbidden-side-effect-attempt` verdict → `abort`) but **no producer**: the signal only fires if an orchestrator hand-sets `forbidden_side_effect`, which nothing does. So a real side-effect that escapes the PR/revert envelope — a prod migration, secret rotation, email, registry publish — is invisible until a human notices. This change produces that signal from a declared-vs-observed comparison.

**Design principles.**

- **The substrate is frozen.** FAFF-35's `events.jsonl` schema (the closed phase/type enums, schema:1) is consumed by FAFF-289 (`faff audit`) and Sentry. Detection must not mutate that schema — it adds a *parallel* ledger and reuses the *existing* Sentry injection seam, not a schema bump.
- **The container is the blast-radius boundary, not faff (ADR-0010).** faff observes effects it itself mediates; it does not intercept syscalls. Anything genuinely out-of-band is the container's job. This principle *bounds the observation surface* — and the human ratified **Option A (faff-mediated only)** on exactly this basis (§6/§7).
- **Deterministic tools over prose.** Declaration, observation, and the escape comparison are a pure, `--selftest`-able CLI (the `faff events`/`budget`/`contract` model) — never an LLM judgement at runtime.
- **Reuse the existing consumer.** The escape signal must reach Sentry through its already-supported `signals.forbidden_side_effect` injection path, so detection lights up the shipped kill-switch with zero changes to Sentry.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| `faff events` substrate | `plugin/skills/faff/bin/faff` (`cmdEvents` ~8255) | Frozen schema-1 event log; the timeline detection sits beside |
| Sentry `evalForbiddenSideEffect` | `plugin/skills/faff/bin/faff` (~8582) | The existing consumer; trips on `signals.forbidden_side_effect` → `abort` |
| `faff budget` | `plugin/skills/faff/bin/faff` | Pattern: pure per-run CLI consumed by Sentry via child-process |
| ADR-0010 | `records/adr/0010-…` | Blast-radius boundary = the container, bounding the observation surface |

**Scope statement.** This is the producer of the escaped-side-effect signal within the autonomous run lifecycle; FAFF-37 consumes it for recovery, Sentry consumes it for live abort.

## 2. OUT OF SCOPE

- **Recovery / rollback** — Why: FAFF-37 owns containing effects after detection. Extension point: FAFF-37 consumes the escape signal defined here.
- **Syscall / network / filesystem interception** — Why: ADR-0010 puts OS-level isolation in the container, not faff. Extension point: the container runtime; faff's observation surface is the orchestrator chokepoints (Option A, §6).
- **A new event TYPE in `events.jsonl`** — Why: the schema-1 enum is consumed by shipped readers; detection uses a parallel ledger + the existing `data.forbidden_side_effect` flag. Extension point: a future schema-2 migration if the ledger is ever folded into the event log.
- **Forensic reconstruction view** — Why: FAFF-289 (`faff audit`) already renders the read-only who/what/why. Extension point: `faff audit` could later join the declared-effects ledger.
- **Non-faff-mediated observation (Option B)** — Why: the human ratified **Option A** for this slice; a process/network watch crosses the ADR-0010 boundary. Extension point: a later slice may grow a container-side observation mechanism.
- **Effect taxonomy completeness** — Why: v1 ships a pragmatic closed kind-vocabulary; exhaustive cloud-resource taxonomy is later. Extension point: the `EFFECT_KINDS` set.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Declared effect | A side-effect a step states it intends, recorded *before* the step acts |
| Observed effect | A side-effect faff records as having actually happened, at a chokepoint it mediates |
| Envelope | The set of declared effects active for a given step/issue |
| Escape | An observed effect not covered by any declaration in the active envelope |
| Chokepoint | A point where faff itself performs or witnesses a real effect (e.g. ship/merge, label write) |

**Effect descriptor (the unit both sides share).**

```
RECORD EffectDescriptor:
  kind: EffectKind            # closed vocabulary, below
  target: String             # the object acted on (e.g. "main", "pkg@1.2.0", "users table")
  reversible: Bool           # true => undoable by git revert + redeploy; false => escalates harder

ENUM EffectKind:
  merge | branch-delete | deploy | db-migration | secret-rotation |
  email | webhook | registry-publish | force-push | prod-script |
  label-write | tracker-write | file-write | other
  # Derived from the gateway "side effect outside the PR flow" list; `other` is the catch-all.
```

**Declared-effects ledger record (parallel JSONL, not an event).**

```
RECORD LedgerEntry:
  schema: 1                  # CLI-owned; this ledger's own version, independent of events.jsonl
  run_id: String             # CLI-owned
  seq: Int                   # CLI-owned; monotonic line count (authoritative order, ts is annotation)
  ts: ISO8601                # CLI-owned annotation
  kind_of_entry: "declare" | "observe"
  issue: String              # required
  step: String               # phase/step name (e.g. "build", "ship")
  effect: EffectDescriptor
```

Written to `.faff/runs/<run-id>/declared-effects.jsonl`, mirroring how the run-ledger and events log sit side by side under the run dir.

**The escape signal (the fixed contract — slot framing ②).**

```
RECORD EscapeSignal:
  signal: "escaped-side-effect"      # fixed token
  issue: String
  step: String
  escaped: List<EffectDescriptor>    # observed effects with no covering declaration
  event_seq: Int | null              # the events.jsonl seq of the observation, when correlatable
```

This is the **fixed contract**; *how escape is observed* (which chokepoints emit `observe`) is the **swappable producer** — exactly the slot framing the issue states.

**CLI surface (`faff effects`, pure, `--selftest`-able).**

```
faff effects declare --run <id> --issue <id> --step <name>   # EffectDescriptor(s) on stdin (JSON object or array)
faff effects observe --run <id> --issue <id> --step <name>   # EffectDescriptor on stdin
faff effects check   --run <id> [--issue <id>] [--json]      # compare observed vs declared -> EscapeSignal(s)
faff effects --selftest
```

Exit codes follow the house convention: `0` ok / `1` invalid input / `2` malformed (bad JSON / missing required flag) / `3` run-dir missing.

**Escape-to-Sentry bridge.** `faff effects check --json` returns `{ escapes: [EscapeSignal,...], any_escape: <bool> }`. The orchestrator feeds `any_escape` into `faff sentry check` via the already-supported `signals.forbidden_side_effect` injection path — **no Sentry change, no events-schema change.** When an observation is also written to the event log by a chokepoint, that event additionally carries `data.forbidden_side_effect: true`, so Sentry trips even on its event-scan path.

**Design decisions** (full rationale in section 6):

- Detection basis — declared-effects ledger vs runtime monitoring. **Chosen:** declared-effects ledger.
- Storage — extend `events.jsonl` vs parallel ledger. **Chosen:** parallel `declared-effects.jsonl`.
- Escape→consumer wiring — new event type vs reuse the Sentry injection seam. **Chosen:** reuse `signals.forbidden_side_effect`.
- Observation surface scope — what faff actually watches. **Chosen:** Option A — faff-mediated only (human Decision 2026-06-29 14:05; §6/§7).

## 4. HOW — Behavior

**Architecture.** Three pure operations over a per-run parallel ledger, plus a thin orchestration contract. A step **declares** its intended effects before acting. Chokepoints **observe** effects as faff performs/witnesses them. `check` computes the set-difference and emits escape signals; the orchestrator bridges `any_escape` into Sentry.

```
PROCEDURE effects_check(run_id, issue?):
  1. Read declared-effects.jsonl for run_id (absent => [], like events read).
  2. Partition entries by (issue, step): declared[], observed[].
  3. FOR each observed effect O in scope:
     a. covered := EXISTS d in declared for same (issue, step) WHERE
           d.effect.kind == O.kind AND target_matches(d.effect.target, O.target)
     b. IF NOT covered: add O to escapes for (issue, step)
  4. RETURN { escapes: [EscapeSignal per (issue,step) with non-empty escaped], any_escape }
```

```
PROCEDURE target_matches(declared_target, observed_target):
  - Exact string match, OR declared_target == "*" (step declared this kind broadly).
  - No fuzzy/semantic matching in v1 (deterministic-tools principle).
```

**Behavior summary.** Declaration is append-only and additive (a step may declare more than once); observation is append-only; `check` is a pure read. The ledger is single-writer per run in v1 (the orchestrator), matching FAFF-35's race-free-by-construction model.

**Edge cases and error handling.**

- **No declarations, observed effect present** → every observed effect escapes (fail-loud: an undeclared step that acts is exactly the thing to catch).
- **Declarations present, no observations** → no escape (nothing happened; absence is not an escape).
- **`check` on a run with no ledger file** → `{ escapes: [], any_escape: false }`, exit 0 (parity with `events read` tolerance) — *not* exit 3; absence of the ledger means no declared-effects activity, a valid clean state.
- **Malformed stdin / missing `--run`** → exit 2; bad EffectDescriptor (unknown `kind`, missing `target`) → exit 1.
- **Irreversible escape (`reversible:false`)** → still a single escape signal; severity escalation is the consumer's call (Sentry already maps `forbidden-side-effect-attempt` → `abort`). Detection does not itself intervene.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** a declared-effects ledger can only detect escapes among effects faff *observes*; a truly out-of-band effect (a subagent shelling `curl` to send a real email) is never observed, so never escapes — detection does not see the exact class the WHY lists when it happens out-of-band. **How you'd know:** an effect the WHY lists (email/secret-rotation) happens *out-of-band* in a run yet `faff effects check` reports `any_escape:false`. **What it means:** this is not a code bug — it is the boundary of the chosen basis, and the human **ratified Option A (2026-06-29)** precisely here: out-of-band effects are the container's responsibility (ADR-0010); v1 detection is scoped to faff-mediated chokepoints accordingly. The implementer builds to that scope; widening it is a later slice (Option B), not this one.
- **The failure:** target matching is exact-string, so a declared `deploy main` vs observed `deploy production` reads as an escape (false positive) or a too-broad `*` hides a real escape (false negative). **How you'd know:** escape signals on known-good runs (false positive) or none on a seeded escape (false negative) in the selftest fixtures. **What it means:** narrow — v1 keeps exact-match + `*` and documents the matching rule; richer matching is a later slice.

**Anti-pattern:** emitting a new `events.jsonl` event type for escapes. Why: the schema-1 enum is consumed by shipped readers (FAFF-289, Sentry); adding a type is a schema migration this slice deliberately avoids.

**Anti-pattern:** having `faff effects check` itself abort/kill the run. Why: detection produces a signal; intervention is Sentry's/FAFF-37's job (separation of producer and consumer).

## 5. SCENARIOS — born-verifiable main objectives

```
Given a run where step "build"/FAFF-200 declared effect {kind: merge, target: main}
When the orchestrator observes {kind: merge, target: main} for that step
Then `faff effects check --json` returns any_escape:false and no escape for that step
```

```
Given a run where step "build"/FAFF-200 declared only {kind: merge, target: main}
When the orchestrator observes {kind: registry-publish, target: "pkg@1.2.0"}
Then `faff effects check --json` returns any_escape:true with an escaped-side-effect signal
     listing the registry-publish, and feeding any_escape into `faff sentry check`
     yields a forbidden-side-effect-attempt verdict with intervention "abort"
```

```
Given a run with no declared-effects.jsonl file
When `faff effects check --json` runs
Then it returns {escapes: [], any_escape: false} and exits 0 (absence is a clean state, not an error)
```

Assertion (non-functional): `faff effects` performs no tracker or network I/O and writes only under `.faff/runs/<run-id>/` — verified by the pure-CLI selftest and a no-network test harness.

## 6. DESIGN DECISION RATIONALE

**Detection basis: declared-effects ledger vs runtime monitoring.**
- *Declared-effects ledger* — each step declares intent; faff compares observed-vs-declared. Pro: faff-native, deterministic, reuses the event substrate + Sentry consumer, respects ADR-0010. Con: only sees faff-mediated effects.
- *Runtime monitoring* — intercept syscalls/network/fs live. Pro: catches out-of-band effects. Con: OS-level isolation is the container's job per ADR-0010, not faff's product concern; would re-import the dev-infra/sandbox boundary faff explicitly disclaims.
- **Chosen:** declared-effects ledger — the runtime-monitoring half is out of faff's concern boundary by ADR-0010, the consumer (Sentry) and substrate (events) already assume an orchestrator-observed model, and FAFF-68's no-execute floor (not interception) set the precedent. *At time of writing, faff owns no sandbox; the container is the cage.*

**Storage: parallel ledger vs extend events.jsonl.**
- **Chosen:** parallel `declared-effects.jsonl` — keeps the schema-1 event log frozen for its shipped consumers (FAFF-289, Sentry), mirrors the run-ledger-beside-events layout, and lets the ledger evolve its own schema independently.

**Escape→consumer wiring.**
- **Chosen:** reuse Sentry's `signals.forbidden_side_effect` injection seam — the consumer already exists and already maps to `abort`; the orchestrator bridges `any_escape` with zero Sentry/schema change. Rejected: a new event type (schema migration) and a new Sentry verdict (duplicate of the existing one).

**Observation surface scope: faff-mediated-only (Option A) vs broader observation (Option B).**
- *Option A — faff-mediated only* — detect escapes only among effects faff observes at its own chokepoints (ship/merge, label/tracker writes, and any chokepoint wired to call `faff effects observe`); out-of-band effects (a subagent directly sending an email, rotating a secret, publishing a package) are *explicitly delegated* to the container boundary (ADR-0010).
- *Option B — broader observation* — grow a non-faff-mediated observation mechanism (process/network watch); crosses the ADR-0010 boundary and re-opens the sandbox-ownership question.
- **Chosen:** Option A — faff-mediated only. **Ratified by the human Decision (2026-06-29 14:05).** Deterministic, proportionate, and consistent with ADR-0010 — the container owns real runtime/syscall monitoring; faff reconciles its *declared* envelope over its own recorded surfaces. Option B is a later extension, not this slice. This bounds what "escaped-side-effect detection" promises across the project (and what FAFF-37 recovery can act on): v1 covers faff-mediated chokepoint effects.

## 7. RESOLVED DECISIONS AND ASSUMPTIONS

**Resolved (was a Punt): the observation-surface scope — Option A, faff-mediated only.** v1 deterministically detects escapes *among effects faff observes at its own chokepoints* (ship/merge, label/tracker writes, and any chokepoint wired to call `faff effects observe`). It does **not** observe out-of-band effects (a subagent directly sending an email, rotating a secret, publishing a package), because faff does not intercept syscalls (ADR-0010).

- **Decision (human, 2026-06-29 14:05):** **Option A — faff-mediated only.** Reconcile declared vs observed effects over faff's own recorded surfaces; out-of-band effects are delegated to the container per ADR-0010. Option B (a non-faff-mediated observation mechanism) is a later extension, not this slice.
- **Consequence for the build:** the chokepoint-wiring leaves are scoped to faff-mediated chokepoints; the implementer does not build a process/network watch. The honest boundary (out-of-band effects are the container's job) is documented in §4 *Failure modes* so it is not mistaken for a defect.

This decision was cross-slice, durable (first-slice epic; leaves grow from this spec), and security-adjacent — the class of call the autonomous resolve-attempt rules escalate to a human rather than auto-resolve. It is now closed; no open Punt remains.

**Assumptions.**

- **Assumes:** the shipped `faff events` substrate and Sentry's `forbidden_side_effect` injection path exist as described. *Validate:* `faff events --selftest` and `faff sentry --selftest` pass; `evalForbiddenSideEffect` reads `signals.forbidden_side_effect` (confirmed at `bin/faff` ~8582).
- **Assumes:** the run dir + ledger lifecycle (`.faff/runs/<run-id>/`) is owned by the orchestrator. *Validate:* `faff events append` requires an initialised run dir (exit 3 otherwise).

## 8. DONE — Definition of Done

### From WHY
- [ ] An escaped-side-effect signal is *produced* (not just consumable) when an observed effect falls outside the declared envelope.

### From WHAT (types and interfaces)
- [ ] `EffectDescriptor` (kind ∈ closed vocab, target, reversible) validated; unknown kind / missing target → exit 1.
- [ ] `declared-effects.jsonl` records carry CLI-owned `schema/run_id/seq/ts` + `kind_of_entry/issue/step/effect`.
- [ ] `faff effects declare|observe|check` exist with exit codes 0/1/2/3 per the house convention.
- [ ] `faff effects check --json` emits `{ escapes: [EscapeSignal], any_escape }`; `EscapeSignal.signal == "escaped-side-effect"`.

### From HOW (behaviour)
- [ ] `check` computes observed-minus-declared per (issue, step) using exact-target + `*` matching.
- [ ] No declarations + an observed effect ⇒ that effect escapes.
- [ ] Declarations + no observations ⇒ no escape.
- [ ] Missing ledger file ⇒ `{escapes:[], any_escape:false}`, exit 0 (not exit 3).
- [ ] `any_escape:true` fed to `faff sentry check` via `signals.forbidden_side_effect` yields `forbidden-side-effect-attempt` → `abort` (no Sentry change).
- [ ] `events.jsonl` schema-1 enums are unchanged (no new event type added).

### From HOW (edge cases)
- [ ] Malformed stdin / missing `--run` ⇒ exit 2; bad descriptor ⇒ exit 1.
- [ ] `faff effects` performs no tracker/network I/O; writes only under the run dir.

### Scope (per the ratified Option A)
- [x] Observation-surface scope **ratified by the human (2026-06-29 14:05): Option A — faff-mediated only.** Chokepoint-wiring leaves are scoped to faff-mediated chokepoints (ship/merge, label/tracker writes); out-of-band effects are delegated to the container (ADR-0010). v1 wires `faff effects observe` at the faff-mediated chokepoints only — no process/network watch.

**Integration smoke test:**
```
init run dir → faff effects declare {merge,main} for build/FAFF-X
            → faff effects observe {registry-publish,pkg@1} for build/FAFF-X
            → faff effects check --json  => any_escape:true, escaped=[registry-publish]
            → faff sentry check (forbidden_side_effect:true) => intervention "abort"
```

confidence: high
spec-review: approve
