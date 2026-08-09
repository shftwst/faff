# Spec — Derive merge-gate level from the run ledger; refuse a contradicting `--level`

> Spec: faffter-dark-nlspec · 2026-07-10 · autonomous · confidence: high

This is the build spec for FAFF-424. Audience: the build agent and human reviewers. It hardens `faff merge-gate` so the run's autonomy level is **derived from the run-ledger it already reads**, closing the silent L4→L3 downgrade path where one dropped prose signal removes the holdout / admissibility backstops while auto-merge continues.

## 1. WHY — Problem and Principles

**Load-bearing model.** `faff merge-gate` already consumes `--run-dir` (it re-reads `<run-dir>/<ISSUE>/ac-checklist.json` and `review-verdict.json` from it), and that same run-dir holds `run-ledger.json` whose `level` field is the run's authoritative autonomy level (minted by `faff lights-out` as `level:"L4"`, and read elsewhere as `ledger.level === "L4"` at `bin/faff:396`). Today merge-gate ignores that field and takes its level **only** from the caller's `--level` flag (default `L3`, `bin/faff:15067`). So the level that decides whether the L4 holdout leg fires (`decideFloor`, `bin/faff:7502`; call-site `bin/faff:15113`) is caller-asserted, not run-derived.

**Problem statement.** The `lights_out`/level signal is prose-resolved fail-safe-**off** through graft (`faff-graft/SKILL.md:333, 439`), so a single dropped prose signal makes graft pass `--level L3` (or the default) for what is actually an L4-ledgered run. merge-gate then decides with L3 semantics — no holdout leg, no admissibility backstop — while still executing the merge. The fix: merge-gate derives the level from the ledger, and refuses an explicit `--level` that contradicts it.

**Design principles.**

- **Fail-closed toward the higher level.** A run the ledger says is L4 must never gate at L3. Derivation makes the ledger authoritative; the flag can only match or contradict, never silently downgrade.
- **A contradiction is a caller bug, surfaced loudly.** An explicit `--level` that disagrees with the ledger is not a mergeable state to coerce — it is malformed input, exit-2 fail-loud (the same class as the existing out-of-enum `--level` check at `bin/faff:15077`), never a silent override in either direction.
- **Absent ledger level = unchanged behaviour.** No `level` in the ledger (or no readable ledger) leaves today's flag/default path exactly as-is — this is an additive backstop, not a new hard dependency on a ledger.
- **Pure core, impure shell.** The derivation/mismatch decision is a pure function covered by `--selftest`, mirroring `decideFloor`; the shell only does the (non-throwing) ledger read.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `cmdMergeGate` (`bin/faff:15061`) | JS (Node) | The impure shell; where `--level` is resolved (`:15067`) and the floor is assembled (`:15107`), incl. the holdout leg `level === "L4" ? readHoldout(issue) : "not-applicable"` (`:15113`) |
| `decideFloor` (`bin/faff:7494`) | JS | Pure floor core; `f.level === "L4"` drives the holdout blocker (`:7502`) — **unchanged** by this ticket |
| `readLedger` (`bin/faff:71`) / `tryReadLedger` (`bin/faff:1539`) | JS | Shared ledger parse; `tryReadLedger` is the non-throwing wrapper (missing/malformed → `null`) this ticket reuses |
| `FLOOR_LEVELS` (`bin/faff:7488`) | JS | `["L1","L2","L3","L4"]` — the enum both the flag and the derived ledger level validate against |
| `mergeGateSelftest` (`bin/faff:15181`) | JS | In-memory pure-core selftest to extend |
| `test/merge-gate-controlflow.test.mjs` | JS (node:test) | CLI-boundary harness (stub `gh` on PATH, real `merge-gate` via `runCli`, run-dir fixtures) to extend for the derivation + mismatch cases |

**Scope statement.** A single-file change in `bin/faff`'s merge-gate command plus its two test surfaces; it sits at the merge floor, downstream of graft's level resolution and upstream of `gh pr merge`.

## 2. OUT OF SCOPE

- **`readHoldout` run-binding / file resolution** — how `readHoldout(issue)` resolves its verdict file (currently `bin/faff:15113` calls it with only `issue`, so `dir` defaults to CWD-relative `.faff/holdout/…`). **This is FAFF-420's seam** (bind the verdict to the run, resolve run-dir-relative, freshness-check). FAFF-424 changes only *which `level`* decides whether the holdout leg runs; it does **not** touch the `readHoldout` call signature or its file resolution. Extension point: `readHoldout` (`bin/faff:15052`).
- **The prose→flag `lights_out` hop in graft/beep-boop** — how graft resolves the `lights_out`/level boolean and feeds `faff admissible` and the review slot. **This is FAFF-401's seam** (deterministic `lights_out`→`--lights-out` channel). FAFF-424 is downstream of it and independent: even a graft that drops the prose signal now cannot downgrade the gate, because merge-gate re-derives level from the ledger itself. Extension point: `faff-graft/SKILL.md:333, 439`.
- **Changing `decideFloor`'s logic** — the pure core is correct; it already gates the holdout on `level === "L4"`. This ticket only changes the `level` value fed to it. Extension point: `decideFloor` (`bin/faff:7494`).
- **Minting or writing the ledger `level` field** — `faff lights-out` already mints it. Extension point: the lights-out runner (`bin/faff:~13683`).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| ledger level | `run-ledger.json`'s `level` field (`"L1".."L4"`), the run's authoritative autonomy level |
| flag level | the value of an explicit `--level` argument, if the caller passed one (else absent) |
| effective level | the level merge-gate actually decides with, after derivation |
| mismatch | an explicit flag level that disagrees with a present ledger level |

**Pure helper (new).**

```
FUNCTION resolveGateLevel(ledgerLevel, flagLevel) -> { level, mismatch }
  # ledgerLevel : "L1".."L4" | null   (null = absent/unreadable/out-of-enum)
  # flagLevel   : "L1".."L4" | null   (null = --level not passed)
  IF ledgerLevel is non-null:
     RETURN { level: ledgerLevel,
              mismatch: (flagLevel is non-null AND flagLevel != ledgerLevel) }
  ELSE:
     RETURN { level: flagLevel OR "L3", mismatch: false }
```

Pure, total, no I/O — unit-tested in `mergeGateSelftest`. Ledger always wins when present; the flag can only agree (fine) or contradict (mismatch).

**Ledger read (reuse, non-throwing).** `tryReadLedger(runDir)` (`bin/faff:1539`) → ledger object or `null`. Derive:

```
ledger      := tryReadLedger(runDir)
ledgerLevel := (ledger AND FLOOR_LEVELS.includes(ledger.level)) ? ledger.level : null
```

An out-of-enum or absent `ledger.level` resolves to `null` → the unchanged flag/default path.

**Argument change.** Split the current single `level` resolution (`bin/faff:15067`, `const level = adrFlag(args, "--level") || "L3";`) into the raw flag plus the derived effective level:

```
flagLevel := adrFlag(args, "--level")        # null when absent
# validate the EXPLICIT flag (unchanged behaviour for a bad --level)
IF flagLevel is non-null AND NOT FLOOR_LEVELS.includes(flagLevel): exit 2
{ level, mismatch } := resolveGateLevel(ledgerLevel, flagLevel)
IF mismatch: <stderr mismatch message>; exit 2
```

## 4. HOW — Behavior

**Behaviour summary.** Immediately after `runDir` is validated as present (`bin/faff:15076`) and the explicit `--level` is validated, merge-gate reads the ledger level, resolves the effective level via `resolveGateLevel`, refuses a mismatch (exit 2), and otherwise feeds the **derived** `level` into the existing floor assembly unchanged.

```
PROCEDURE cmdMergeGate(args):   # only the changed region shown
  1. ... resolve pr, issue, runDir; require all three (exit 2 if missing)   # unchanged, :15076
  2. flagLevel := adrFlag(args, "--level")                                   # null when absent
  3. IF flagLevel != null AND NOT FLOOR_LEVELS.includes(flagLevel):
        stderr "faff merge-gate: --level <x> not in {L1,L2,L3,L4}"; RETURN 2 # unchanged check, :15077
  4. ledger      := tryReadLedger(runDir)                                    # non-throwing, :1539
     ledgerLevel := (ledger && FLOOR_LEVELS.includes(ledger.level)) ? ledger.level : null
  5. { level, mismatch } := resolveGateLevel(ledgerLevel, flagLevel)
  6. IF mismatch:
        stderr "faff merge-gate: --level <flagLevel> contradicts run-ledger level <ledgerLevel> "
               "(<runDir>/run-ledger.json); the ledger level governs — drop --level or pass --level <ledgerLevel>"
        RETURN 2
  7. ... rest of cmdMergeGate unchanged, using the DERIVED `level`:
        floor.level   := level
        floor.holdout := level === "L4" ? readHoldout(issue) : "not-applicable"   # :15113 unchanged
        ... decideFloor, gh observe, execute ...                                   # unchanged
```

**Anti-pattern:** re-deriving or re-reading the level anywhere after step 5. Why: the single derivation point is the whole guarantee — a second read could diverge. Compute `level` once, thread it through.

**Anti-pattern:** letting a missing/malformed ledger throw. Why: `runDir` is required for the artifact reads but a ledger may legitimately be absent (an L1–L3 run, or a hand-invoked gate); use `tryReadLedger` (null on any failure), never bare `readLedger`.

**Edge cases and error handling.**

- **Ledger present, `level:"L4"`, no `--level`** → effective `L4`; holdout leg fires. (The core fix: a dropped signal no longer downgrades.)
- **Ledger present, `level:"L4"`, `--level L3`** → mismatch → exit 2, before any `gh` call.
- **Ledger present, `level:"L4"`, `--level L4`** → agree → effective `L4`, proceed.
- **Ledger present, no `level` field / out-of-enum value** → `ledgerLevel = null` → flag/default governs (unchanged).
- **No readable ledger (missing/malformed)** → `tryReadLedger` returns `null` → flag/default governs (unchanged).
- **No ledger level AND no `--level`** → effective `L3` (today's default, unchanged).

**Failure modes.**

- **The failure:** the mismatch refusal fires on a *legitimate* L1–L3 run because the ledger carries a stale/unexpected `level`. **How you'd know:** merge-gate exits 2 on a run that used to merge; the stderr names the ledger path and the two levels. **What it means:** proceed — the message is actionable (the ledger is the authority; the operator drops `--level` or aligns it). This is the intended fail-closed direction, not a regression.
- **The failure:** exit-code choice (2 vs 1) confuses a caller that treats only exit 1 as "refuse". **How you'd know:** graft/ship control flow mishandles the exit. **What it means:** exit 2 is deliberate (bad-input class, per the help contract `bin/faff:6436` "2 fail-loud (bad inputs)") — callers already distinguish 2 as fail-loud from 1 as floor-refuse; a mismatch is malformed input, not a floor refusal.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a run-dir whose run-ledger.json has level:"L4" and no holdout artifact for the issue
When faff merge-gate runs against it WITHOUT --level (or with --level L4)
Then the floor is decided at L4 — the holdout leg is read and (absent) refuses (exit 1),
     i.e. the run cannot merge with L3 semantics
```

```
Given a run-dir whose run-ledger.json has level:"L4"
When faff merge-gate runs with --level L3
Then it exits 2 with a mismatch error naming the ledger level and the flag level,
     before any gh call
```

```
Given a run-dir with no run-ledger.json (or a ledger with no level field)
When faff merge-gate runs with --level L3 (or no --level)
Then behaviour is byte-for-byte unchanged from today (flag/default governs)
```

```
Given the pure resolveGateLevel helper
When called with (ledgerLevel, flagLevel) across the matrix
Then ledger-present wins and flags mismatch on disagreement; ledger-absent yields flag||"L3", never a mismatch
```

## 6. DESIGN DECISION RATIONALE

**Where does the level come from when a ledger level exists?**
- Options: (a) ledger always wins, flag becomes validate-only; (b) flag wins, ledger only warns.
- (b) preserves the exact silent-downgrade hole this ticket closes. **Chosen:** (a) — the ledger level governs; an explicit flag may only agree or trigger a mismatch refusal. Rationale: the ledger is the run's minted authority (`faff lights-out`), the flag is caller-asserted and demonstrably droppable.

**What exit code for a contradicting `--level`?**
- Options: exit 1 (floor refuse) vs exit 2 (fail-loud bad input).
- **Chosen:** exit 2. Rationale: a contradiction is malformed input, not a mergeable-state floor refusal; it matches the sibling out-of-enum `--level` check (`bin/faff:15077`) and the documented exit contract (`bin/faff:6436`, "2 fail-loud (bad inputs)"). exit 1 is reserved for a `decideFloor` refuse.

**How to treat an absent / out-of-enum ledger `level`?**
- Options: (a) treat as "no ledger level" → unchanged flag/default path; (b) fail-loud on a corrupt ledger level.
- **Chosen:** (a). Rationale: the ticket's third requirement is explicit — "No ledger level present → current flag/default behaviour, unchanged" — and a corrupt-ledger hard-fail would let a malformed ledger brick every merge, a heavier failure mode than the downgrade this ticket targets (which is addressed by the positive-derivation path). A future ticket may tighten this if corrupt ledgers prove a real vector.

**Reuse `tryReadLedger` vs a new reader?** **Chosen:** reuse `tryReadLedger` (`bin/faff:1539`) — it already gives the exact non-throwing missing/malformed→`null` semantics required; no new reader.

**Extract a pure `resolveGateLevel` vs inline branching in the shell?** **Chosen:** extract a pure helper. Rationale: mirrors the `decideFloor` pure-core/impure-shell split, so the derivation/mismatch matrix is `--selftest`-covered with zero mocking; the shell keeps only the ledger read.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the three requirements and their acceptance criteria fully determine the design.

**Assumptions:**

- **Assumes:** `faff lights-out` writes the run autonomy level as the top-level `run-ledger.json` field `level` with value `"L4"` (validated: read the same way at `bin/faff:396`, `ledger.level === "L4"`). *Validation:* grep the lights-out minting path for the ledger `level` write before relying on the field name; if it is nested elsewhere, read from that path instead (the derivation is otherwise unchanged).
- **Assumes:** `tryReadLedger` (`bin/faff:1539`) is in lexical scope from `cmdMergeGate` (both top-level functions in `bin/faff`). *Validation:* trivially true in a single-file CLI; confirm at edit time.

## 8. DONE — Definition of Done

### From WHY
- [ ] An L4-ledgered run can no longer execute the merge gate with L3 semantics — with `level:"L4"` in the ledger and no `--level`, the floor is decided at L4 (holdout leg read).

### From WHAT (types / interfaces)
- [ ] A pure `resolveGateLevel(ledgerLevel, flagLevel)` exists, returns `{ level, mismatch }`, ledger-wins-when-present, `flagLevel||"L3"` when absent, `mismatch` only on a present-ledger disagreement.
- [ ] merge-gate reads the ledger level via `tryReadLedger` and validates it against `FLOOR_LEVELS` (out-of-enum/absent → `null`).
- [ ] The explicit `--level` flag is still validated against `FLOOR_LEVELS` (bad explicit flag → exit 2, unchanged).

### From HOW (behaviour)
- [ ] `--level L3` against a `level:"L4"` ledger exits non-zero (exit 2) with a mismatch error on stderr naming both levels and the ledger path, before any `gh` call.
- [ ] `--level L4` (or no `--level`) against a `level:"L4"` ledger proceeds at L4.
- [ ] No ledger level present (missing/malformed ledger, or no `level` field) → flag/default behaviour byte-for-byte unchanged.
- [ ] The derived `level` (not the raw flag) feeds `floor.level` and the `level === "L4" ? readHoldout(issue) : "not-applicable"` leg; `readHoldout`'s call signature is untouched (FAFF-420's seam).

### From tests
- [ ] `mergeGateSelftest` (`bin/faff:15181`) covers the `resolveGateLevel` matrix: (L4 ledger, no flag)→L4/no-mismatch; (L4 ledger, L3 flag)→mismatch; (L4 ledger, L4 flag)→L4/no-mismatch; (no ledger, L3 flag)→L3/no-mismatch; (no ledger, no flag)→L3; (out-of-enum ledger level, L4 flag)→L4.
- [ ] `test/merge-gate-controlflow.test.mjs` (or `merge-gate.test.mjs`) covers, at the CLI boundary with a run-ledger fixture + stub `gh`: (1) L4 ledger + no `--level` + no holdout artifact → exit 1 with an `L4 holdout` blocker; (2) L4 ledger + `--level L3` → exit 2 mismatch (stub `gh` records no `pr merge`); (3) no-ledger run-dir + `--level L3` → unchanged exit.
- [ ] `faff merge-gate --selftest` and the merge-gate node tests pass; `node --test` green.

**Integration smoke test.**

```
Build a temp run-dir:
  write run-ledger.json { "level": "L4", ... }
  write <ISSUE>/ac-checklist.json { all_verified: true }, <ISSUE>/review-verdict.json { signal:"pass" }
  (no .faff/holdout/<ISSUE>.json)
Run: faff merge-gate --pr 1 --issue <ISSUE> --run-dir <dir> --repo owner/repo --json   (stub gh, no --level)
Expect: exit 1, verdict "refuse", a blocker naming the L4 holdout — proving level was derived as L4.
Then run the same with --level L3 → expect exit 2, mismatch error, no gh pr merge recorded.
```

## Methodology critique

Agile-delivery lens:
- **Right-sized?** Yes — one cohesive change (ledger-derived level + mismatch refusal) in one file plus its two existing test surfaces; a single 1–3 day unit. No split warranted.
- **Workstream fit?** Fits project *T1 — signals tell the truth*: it makes the merge-gate level a truthful run-derived signal rather than a droppable caller assertion.
- **Deps surfaced?** Related-not-blocking to FAFF-401 and FAFF-420; the spec's OUT OF SCOPE demarcates both seams so the three can land independently in any order. No blocker edge needed.
- **Risk profile?** Low — pure-core + narrow shell change over well-covered code; fail-closed direction. No de-risking spike needed.

spec-review: approve

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```
