# FAFF-416 — Per-slot `{model, effort}` routing: make the FAFF-407 cost levers pullable

**Status:** spec · **Confidence:** high · **Author:** faff-prep (autonomous, beep-boop run 2026-07-09)

## WHY

FAFF-407 economics on live data: 88% of spend is context and Opus is 82% of spend.
Two levers move that — **model routing** (Opus → cheaper models for mechanical work) and
**reasoning effort** (billed as output *and* compounding into cache). FAFF-315/334/372
already shipped the **model** lever as the per-lane `models:` surface. FAFF-415 shipped the
**effort telemetry** (`data.effort` on dispatch events + `economics --by effort`). The
missing piece is the **effort control**: today a slot can pick its model but not its
reasoning-effort. FAFF-416 adds the effort dimension to the existing per-lane surface so the
FAFF-407 levers are pullable and — via FAFF-415 — measurable.

## WHAT

Add an `effort.<lane>` config family — the effort counterpart to FAFF-315's `models.<lane>` —
resolved at the **same dispatch sites** that already resolve the per-lane model, and stamped
alongside it. Defaulted so behaviour is **byte-unchanged until tuned**.

Tunable lanes (the non-prep, subagent-dispatched lanes that already carry a `models.<lane>`):

- `effort.build` — the concurrency executors' build subagents (the headline spend lane).
- `effort.methodology` — the methodology producer subagent (prep critique / backlog lens).
- `effort.intake` — the intake producer subagent (jot discovery).

**HARD EXCLUSION — prep/spec is NOT tunable.** No `effort.spec`, `effort.spec_review`,
`effort.prep_explore`, or `effort.architecture` is added. Prep runs once and gates the whole
downstream pipeline; those lanes stay pinned to a capable model/effort. (Their *model* lanes
pre-exist from FAFF-372; this work adds **no** effort knob to any of them.)

**review / ship stay session-pinned.** They run **inline** inside faff-graft, so — exactly as
the gateway already documents for `models:` — they cannot carry an Agent-tool dispatch tag and
get no effort lane. The adversarial *judge*'s tuning (the ticket's "Opus-high" target) already
lives in its own `faffter_dark.adversarial` engine block (model + `--num-predict`); `effort:`
**composes with, never subsumes** it — the same rule the gateway states for `models:`.

**eval is out of scope.** `models.eval` is the frontier-driver's pinned open-vocab model id, not
a beep-boop build/review/orchestration slot; no `effort.eval`.

## HOW

Mirror the FAFF-315 `models.<lane>` mechanics exactly:

1. **Registry defaults** — `effort.build`, `effort.methodology`, `effort.intake` → `"inherit"`
   in `DEFAULTS`. `inherit` = omit the effort arg = today's dispatch, byte-for-byte.
2. **Closed vocabulary** — `EFFORT_LANE_VOCAB` = `["inherit", "low", "medium", "high", "xhigh",
   "max"]` (the FAFF-415 `EFFORT_LEVELS` plus `inherit`). `validateEffortLane(key, value)` mirrors
   `validateModelLane`; a configured off-vocabulary value **fails loud at read** (`config get`
   exit 2, names the value + legal set) — never a silent inherit at the dispatch site.
3. **`config get`** validates effort lanes alongside model lanes (same call site).
4. **`config defaults --selftest`** covers the three effort lanes + a vocab accept/reject probe.
5. **`config resolved` banner** echoes any non-default `effort.<lane>` (`effort <lane>: <value>`),
   so a pinned effort is visible in the run banner, never silent (FAFF-50 intent).
6. **Dispatch wiring (prose)** — at the sites that already resolve `models.<lane>`:
   - concurrency executors (sequential + parallel): resolve `faff config get effort.build` once
     per run and stamp it into every `BuildDispatch` alongside `model`; `inherit` omits the arg.
   - producer dispatch (methodology, intake): resolve `faff config get effort.<slot>` and pass it
     as the dispatch's reasoning-effort arg; `inherit` omits it.
   The resolved effort is also the value the dispatch tags onto its FAFF-415 `data.effort` event,
   closing the loop config → dispatch → telemetry → `economics --by effort`.
7. **Docs** — gateway `models:` section gains an `effort:` subsection; `docs/guide/cli.md`
   `config` rows note the effort lanes; example `.faffrc` gains an `effort:` block.
8. **ADR** — records the design decision: effort lanes exist exactly where model lanes exist AND
   the lane is neither a prep/spec lane nor `eval`; the inline/subagent boundary; and that the
   adversarial judge's effort tuning stays in its own engine block (compose-not-subsume).

## DONE

- `faff config get effort.build|methodology|intake` returns `inherit` with no config; a valid
  vocab token resolves; an off-vocab token exits 2 naming value + legal set.
- No `effort.spec|spec_review|prep_explore|architecture|eval` lane exists (prep-exclusion holds).
- `faff config defaults --selftest` passes and covers the effort lanes + vocab table.
- `faff config resolved` echoes a non-default effort lane (`effort build: low`).
- The no-config path is byte-identical (all defaults `inherit` ⇒ no dispatch arg emitted).
- Gateway + `cli.md` document the effort lanes; an ADR records the boundary.
- Gates green: `lint-cli-doc`, `lint-refs`, `validate-adapters`, `adr validate`,
  `economics --selftest`, `node --test` (pre-existing docker/eval failures excepted).
