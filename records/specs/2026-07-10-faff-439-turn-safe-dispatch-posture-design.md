# Spec — FAFF-439: beep-boop strands the run by background-dispatching builds instead of blocking on the terminal token

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-439.

This document specifies the fix for FAFF-439 for the build agent that will implement it autonomously and the humans reviewing it. It covers prose pins in both `concurrency` executors, a general turn-survival invariant in the gateway and beep-boop, one new mechanical `faff validate-adapters` check, and tests.

## 1. WHY — Problem and Principles

**The load-bearing model:** the Agent/Task tool dispatches subagents in the **background by default** (`run_in_background: true` when the parameter is omitted). A backgrounded dispatch returns immediately and the orchestrator's turn can end with the child still in flight; in an unattended session an idle parent is reaped minutes later, killing the child mid-work. Nothing in the repo's prose names this default, so every "dispatch a subagent and block" sentence silently compiles to "dispatch and hope the completion callback races the reaper". The fix is to make dispatch posture **explicit at every dispatch site** and **mechanically assertable**.

**Problem statement.** Run `2026-07-10-beep-boop-explicit-0822` dispatched all builds (and its prep producers) via background Agent-tool calls, ended its final turn with `pendingBackgroundAgentCount: 1`, was reaped ~3 min later, and stranded the run at the final admitted ticket — the 8 earlier builds survived only by callback timing luck. This directly violates `faffter-noon-concurrency-sequential/SKILL.md:30` ("block awaiting its terminal token") and the line-36 heartbeat single-active-writer design that depends on it. The change pins the dispatch posture in prose and adds a validate-adapters check so no `concurrency` occupant can omit it.

**Design principles:**

- **State the invariant generally, pin it locally.** Observed behaviour (prep via Agent tool) diverges from shipped prose (prep via Skill tool), so the invariant must bind *whatever transport the orchestrator actually uses*, while each dispatch site carries its own one-clause posture pin.
- **Per-executor correctness, not one blanket pin.** Sequential is foreground-blocking by contract; parallel *architecturally requires* background dispatch (N in flight). A single `run_in_background: false` mandate would serialise the parallel executor and destroy its purpose. The rule is "turn-safe posture", with two valid shapes.
- **Explainer once, pins everywhere.** Per the skill-authoring dedup standard, the *why* (background-by-default + reaping) lives once in the gateway transport section; dispatch sites carry the pin plus a gateway pointer.
- **Prose lint checks text, not runtime.** The new check is a structural substring lint like every other mechanism check — it guarantees the instruction exists, not that a model obeys it (see Failure modes).

**Reference context:**

| Surface | Relevance |
|---|---|
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` (line 30 dispatch sentence, line 36 heartbeat, line 40 resume) | Primary fix site — foreground pin |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` (line 31 dispatch, lines 37–39 drain loop, 41–43 heartbeat punt) | Second fix site — await-all gate |
| `plugin/skills/faff/SKILL.md` (~line 862, "Producer dispatch vs chaining handoff") | Home for the one-shot background-default explainer + producer-dispatch pin |
| `plugin/skills/faff-beep-boop/SKILL.md` ("Isolation floor (orchestrator invariant)" paragraph in Build-pass execution) | Home for the general turn-survival invariant |
| `plugin/skills/faff/bin/faff` — `REGISTRY` (~5106), `checksFor` `"mechanism"` case (~5294), `SLOT_TYPES.concurrency` (~5248), `validateConfigured` (~5397) | New lint check slots in here; also gates third-party occupants |
| `test/validate-adapters.test.mjs` | Test home — spawnSync CLI against mkdtempSync fixture skills dirs |

**Scope statement.** This hardens the beep-boop build/producer dispatch seam inside the existing L4 lights-out pipeline; no CLI behaviour changes except one added lint check.

## 2. OUT OF SCOPE

- **Auto-relaunching a reaped orchestrator** — harness/dev-infra, outside faff's concern boundary (faff owns the product, not the runner). Extension point: an external supervisor watching `faff runcheck`; the existing `run-done` undispatched-safety-floor + resume-from-ledger already make a re-invoked run recover correctly.
- **New resume machinery** — FAFF-329 (`review-progress`) and FAFF-402 (`build-progress`) shipped; sequential SKILL.md:40 already documents ledger-driven re-dispatch. Nothing to build; Scenario 4 only asserts the documented recovery path is not weakened.
- **Parallel heartbeat-ownership gap** — the explicitly-flagged punt at `faffter-dark-concurrency-parallel/SKILL.md:41–43` stays as-is (tracked by FAFF-355); the await-all gate changes when the orchestrator's turn may end, not how many ledger writers exist.
- **Runtime enforcement (PreToolUse fence on backgrounded Agent calls)** — the heavier option; a prose pin + structural lint covers the observed failure proportionately. Extension point: the FAFF-434-style `hooks-ensure`-owned PreToolUse fence pattern, as a follow-up ticket if the failure recurs despite the pin.
- **Rewriting beep-boop's prep-drain transport prose** (Skill-tool-inline vs the observed Agent-tool dispatch) — prep-producer isolation is a deferred sibling (beep-boop SKILL.md:434). The general invariant added here binds whichever transport is used; reconciling the prose is that sibling's job.

## 3. WHAT — Vocabulary and the check

**Vocabulary:**

| Term | Definition |
|---|---|
| Dispatch posture | An Agent-tool call's explicit stance on `run_in_background`, plus what keeps the parent's turn alive while children are in flight |
| Turn-safe posture | Either foreground dispatch (`run_in_background: false`) or background dispatch covered by an await-all gate before any turn-end |
| Await-all gate | A foreground wait held open by the orchestrator (e.g. a Monitor/Bash until-loop polling on-disk state) until every in-flight unit has a terminal outcome |

**Canonical lint phrases** (exact strings the new check matches, case-insensitively):

- `run_in_background: false` — the foreground pin (sequential's form).
- `never end a turn` — the await-all pledge (parallel's form).

**The new validate-adapters check.** One check added to `checksFor`'s `"mechanism"` case, matching the existing substring-check shape but case-insensitive (precedent: the adaptor case's `t.toLowerCase().includes("no internal contract")`):

```
CHECK "turn-safe dispatch posture":
  pass IF lowercase(text) contains "run_in_background: false"
       OR lowercase(text) contains "never end a turn"
  failure label: 'declares a turn-safe dispatch posture ("run_in_background: false", or a "never end a turn" await-all gate)'
```

**Chosen:** one two-arm check rather than per-skill-name-keyed checks inside the mechanism case — `checksFor` is reused by `validateConfigured` via `SLOT_TYPES.concurrency`, so a third-party occupant is also gated; a two-arm check asks it for exactly one sentence (either arm) and its failure label states verbatim what to write, which is proportionate, whereas name-keyed checks would silently exempt third parties from the very trap that caused FAFF-439.

**Design decisions** (rationale collected in §6):

- **Chosen:** sequential executor pins `run_in_background: false` inline in its line-30 dispatch sentence.
- **Chosen:** parallel executor keeps background dispatch and gains a mandatory await-all gate containing the literal phrase "never end a turn".
- **Chosen:** the background-by-default explainer lives once in the gateway "Producer dispatch vs chaining handoff" section, which also gains the producer-dispatch foreground pin.
- **Chosen:** beep-boop's isolation-floor paragraph gains a general turn-survival invariant binding *all* the orchestrator's Agent-tool dispatches (build, prep, any producer), regardless of what transport prose elsewhere claims.
- **Chosen:** one two-arm mechanism check (above), not name-keyed checks.
- **Chosen:** parallel heartbeat-ownership punt stays out of scope.
- **Chosen:** long-foreground-block turn/wall-clock risk is accepted, not engineered around — foreground is the contractually correct posture for sequential; if a harness turn limit ever strands a long build, the already-shipped resume-from-ledger path (cheap via FAFF-329/402) is the recovery, and that new observed failure would get its own ticket.
- **Chosen:** resume facet is verify-and-don't-regress only; no new machinery.

## 4. HOW — Behaviour (the four prose edits + the check + tests)

Each edit is a design requirement, not literal replacement text — the builder words it to fit, keeping additions lean (validate-adapters line/paragraph caps apply). The **bolded literals are mandatory** where the lint or cross-references depend on them.

**4.1 Gateway (`plugin/skills/faff/SKILL.md`, "Producer dispatch vs chaining handoff").** In the *Producer dispatch* bullet, add the explainer + pin: the Agent tool **backgrounds by default** (`run_in_background` omitted ⇒ background); a producer dispatch must pass **`run_in_background: false`**, because a backgrounded producer returns nothing to consume — the orchestrator's turn ends, and an idle unattended parent is reaped, killing the child. Two-to-three lean sentences; this is the single home for the *why*, which the other three sites point back to (gateway → Producer dispatch).

**4.2 Sequential executor (`faffter-noon-concurrency-sequential/SKILL.md`, step 2, line 30).** Immediately after "(Agent/Task tool)", pin the posture: dispatch with **`run_in_background: false`** — background is the tool default, and a backgrounded build ends the orchestrator's turn instead of blocking (see gateway → Producer dispatch for the reaping consequence). One clause + pointer; the existing "block awaiting its terminal token" sentence stays the normative anchor. Line 36's heartbeat design and line 40's resume prose need no change.

**4.3 Parallel executor (`faffter-dark-concurrency-parallel/SKILL.md`).** Two touches:
- In the dispatch paragraph (line 31): builds are *deliberately* dispatched in the background (**`run_in_background`** left true/default) — that is what puts N in flight; name the flag explicitly so the choice is visible, with the gateway pointer.
- Strengthen the drain rule (step 3, line 39) into the await-all gate, containing the literal phrase **"never end a turn"**: never end a turn with build subagents in flight — after launching, hold the turn open with a foreground wait (a Monitor/Bash until-loop polling the run-ledger `outcomes` / per-issue `.faff/runs/<run-id>/ISSUE-XX/` artifacts; the Monitor tool streams shell output, it is not a native await-agents primitive, so the poll target is on-disk state) until every in-flight unit has a terminal outcome. An ended turn leaves an idle parent that unattended reaping kills along with every in-flight build.
- The lines 41–43 heartbeat punt is untouched.

**4.4 Beep-boop (`faff-beep-boop/SKILL.md`, "Isolation floor (orchestrator invariant)" paragraph).** Add the general turn-survival invariant, one-to-two sentences: **every** Agent-tool dispatch this orchestrator makes — build, prep producer, or any other producer, whatever transport other prose names — must hold a turn-safe posture: foreground (`run_in_background: false`) when the result is consumed inline, or covered by an executor's await-all gate; never end a turn with a dispatched agent still in flight (gateway → Producer dispatch). This is what covers the observed prep-via-Agent-tool divergence without rewriting the prep-drain transport prose.

**4.5 CLI check (`plugin/skills/faff/bin/faff`, `checksFor` mechanism case ~5294).** Append the §3 check to the existing three mechanism checks. No `REGISTRY`/`SLOT_TYPES` changes — both executors are already `{type:"mechanism"}` and `SLOT_TYPES.concurrency` already routes third-party occupants here.

**4.6 Tests (`test/validate-adapters.test.mjs`).** Fixture-based, matching the existing spawnSync-against-mkdtempSync pattern; REGISTRY-keyed mechanism checks fire only on fixture dirs literally named after the executors:

```
1. Fixture faffter-noon-concurrency-sequential/SKILL.md WITH the existing required
   phrases but WITHOUT either canonical posture phrase
   → validate-adapters reports the "turn-safe dispatch posture" failure.
2. Same fixture WITH "run_in_background: false" → that check passes.
3. Fixture faffter-dark-concurrency-parallel/SKILL.md WITH "never end a turn"
   (and no "run_in_background: false") → that check passes (second arm).
4. Case-insensitivity: "Never end a turn" (capital N) passes.
```

**Edge cases:**

- **Third-party occupant false-block:** a conforming custom executor that never states its posture now fails `validate-adapters --configured`. Intended — the failure label tells it exactly which sentence to add; the two-arm OR means one line satisfies it whichever architecture it has.
- **Self-gating:** the four prose edits are themselves linted by `faff validate-adapters` (line caps, paragraph length, duplicated blocks) — keep additions to clauses/sentences, and keep the explainer only in the gateway so the duplicated-block lint stays quiet.
- **Casing drift:** the check compares lowercased text, so sentence-initial "Never end a turn" and mid-sentence forms both pass.

**Failure modes:**

- **The failure:** the lint asserts the instruction *exists in prose*, not that the orchestrating model obeys it at runtime — a model could still background a dispatch despite the pin. **How you'd know:** a transcript final turn with `pendingBackgroundAgentCount > 0`, a stranded ledger `runcheck` flags, or `run-done` pinning `continue` on undispatched admitted issues (all existing observables). **What it means:** escalate to the runtime PreToolUse fence named in OUT OF SCOPE — a new ticket, not a widening of this one.

## Scenarios

### 1. Sequential dispatch is pinned foreground

```
Given the shipped faffter-noon-concurrency-sequential/SKILL.md
When its step-2 dispatch sentence is read
Then it instructs Agent-tool dispatch with run_in_background: false, adjacent to
     the existing "block awaiting its terminal token" clause
```
DONE: the file contains the literal `run_in_background: false` in the step-2 dispatch sentence, and `faff validate-adapters` passes it including the new check.

### 2. Parallel executor gains an await-all gate

```
Given the shipped faffter-dark-concurrency-parallel/SKILL.md
When its drain rule is read
Then it names run_in_background as deliberately background, and mandates —
     with the literal phrase "never end a turn" — a foreground wait over
     on-disk run-ledger/per-issue state until all in-flight units have
     terminal outcomes
```
DONE: the file contains the literal phrase `never end a turn` in the drain rule, still contains its unchanged lines 41–43 heartbeat punt, and passes `faff validate-adapters` including the new check.

### 3. The posture is mechanically asserted for every concurrency occupant

```
Given a fixture skills dir with a concurrency-executor SKILL.md missing both
     canonical posture phrases
When faff validate-adapters runs against it
Then it fails with the "turn-safe dispatch posture" label; and a fixture
     carrying either canonical phrase (any casing) passes
```
DONE: the four §4.6 test cases exist in `test/validate-adapters.test.mjs` and pass via `node --test`; the check lives in the `checksFor` mechanism case so `validate-adapters --configured` gates third-party occupants with the same failure label.

### 4. The general invariant covers non-build dispatches, and nothing regresses

```
Given the shipped gateway and faff-beep-boop SKILL.md
When their dispatch prose is read
Then the gateway Producer-dispatch bullet pins run_in_background: false with the
     background-by-default explainer (stated once, there only), and beep-boop's
     isolation-floor paragraph binds all its Agent-tool dispatches to a
     turn-safe posture
```
DONE: both edits present; full `faff validate-adapters` exits 0 over the repo skills dir (prose caps honoured, no duplicated-block finding); sequential SKILL.md:40 resume prose and the `run-done` undispatched safety floor are untouched by the diff.

## 6. Design decision rationale

- **Per-executor fix shape?** Blanket foreground pin vs per-executor posture. A blanket pin serialises the parallel executor (its whole point is N in flight). **Chosen:** sequential pins foreground; parallel keeps background + a mandatory await-all gate — the invariant is "turn-safe", not "foreground".
- **Lint shape?** Name-keyed per-executor checks vs one two-arm posture check. Name-keying exempts third-party occupants (routed via `SLOT_TYPES.concurrency`) from the exact trap that fired. **Chosen:** one case-insensitive two-arm check whose failure label states the required sentence verbatim.
- **Cover prep/tidy/producer dispatches?** The crashed run backgrounded prep producers too, against shipped prose. **Chosen:** yes — one general invariant in beep-boop's isolation floor + the gateway producer-dispatch pin; no rewrite of prep-transport prose (deferred sibling owns that).
- **Parallel heartbeat gap?** **Chosen:** out of scope (FAFF-355) — the await-all gate does not change ledger-writer count; the existing punt and its extension point stand.
- **Long foreground blocks vs turn/wall-clock limits?** Statically unknowable. **Chosen:** accept — foreground is contractually correct for sequential; shipped resume-from-ledger (FAFF-329/402) is the recovery if a limit ever strands a build; revisit only on an observed failure.
- **Resume facet?** Build new machinery vs verify existing. Detection (`runcheck`), the `run-done` safety floor, and cheap re-attach are all shipped; only auto-relaunch is missing and that is dev-infra. **Chosen:** verify-and-don't-regress only (Scenario 4).
- **Runtime enforcement now?** A PreToolUse fence would bind behaviour, not prose. **Chosen:** defer — prose pin + structural lint is the proportionate fix for the observed failure; the fence is the named escalation if it recurs.
- **Where does the explainer live?** **Chosen:** once in the gateway transport section, pointed to from the three other sites — the dedup standard's shared-prose rule, and it keeps the duplicated-block lint quiet.

## 7. Open questions and assumptions

**Open questions:** none — all decisions closed (required for autonomous build).

**Assumptions:**

- **Assumes:** the Agent tool's background-by-default holds in the harness this repo runs under. Validation: the harness Agent-tool schema (`run_in_background` — "Agents run in the background by default; set to false to run synchronously") and the FAFF-439 transcript both confirm it; the builder need not re-verify beyond reading the tool description in-session.

## 8. DONE — Definition of Done

### From WHY / HOW (prose pins)
- [ ] Sequential SKILL.md step 2 contains `run_in_background: false` at the dispatch point (Scenario 1)
- [ ] Parallel SKILL.md names `run_in_background` at its dispatch paragraph and contains the `never end a turn` await-all gate polling on-disk state (Scenario 2)
- [ ] Parallel heartbeat punt (lines 41–43) byte-identical before/after
- [ ] Gateway Producer-dispatch bullet pins `run_in_background: false` and carries the background-by-default explainer, stated only there (Scenario 4)
- [ ] Beep-boop isolation-floor paragraph binds all Agent-tool dispatches (build, prep, producers) to a turn-safe posture / never-end-a-turn-with-agents-in-flight (Scenario 4)

### From WHAT (the check)
- [ ] `checksFor` mechanism case gains exactly one new check: case-insensitive pass on `run_in_background: false` OR `never end a turn`, failure label naming both arms (Scenario 3)
- [ ] No `REGISTRY` / `SLOT_TYPES` changes

### From HOW (tests & gates)
- [ ] Four fixture tests per §4.6 in `test/validate-adapters.test.mjs`, green under `node --test` (Scenario 3)
- [ ] `faff validate-adapters` exits 0 over the repo skills dir post-edit (both executors satisfy the new check; prose caps honoured)
- [ ] No changes to `runcheck` / `run-done` / heartbeat / resume code paths (verify-only facet)

**Eval coverage:** no LLM-judgement seam is introduced or changed (the new check is deterministic substring lint) — no eval registration required.

**Integration smoke test:**

```
1. In a temp fixture skills dir, copy the two post-edit executor SKILL.mds
2. Run the real CLI: faff validate-adapters against the fixture
3. Expect exit 0 and both executors listed passing the
   "turn-safe dispatch posture" check
4. Strip the phrase from the sequential copy, rerun → expect the named failure
```

confidence: high
