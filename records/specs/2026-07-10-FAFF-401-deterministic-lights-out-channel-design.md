# FAFF-401 — Deterministic `lights_out` → `--lights-out` channel: derive the mandatory-review flag from the run ledger, not an LLM hop

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-401.

This document specifies the removal of the last non-deterministic hop in the FAFF-398 mandatory-outage seam. Audience: the build agent implementing it and human reviewers checking the approach.

## 1. WHY — Problem and Principles

**The load-bearing model:** the run ledger (`.faff/runs/<run-id>/run-ledger.json`) is machine-written state — `faff lights-out` mints it with `level: "L4"` — and `review-call.mjs` is deterministic code. If the helper reads the ledger itself (handed only a run-dir path), the "is this review mandatory?" decision moves entirely into deterministic code, and no model ever re-decides it. This is exactly the pattern `bin/faff`'s appetite resolver already uses (its "ledger brace": `FAFF_RUN_DIR` → read `run-ledger.json` → `level === "L4"`), so the change is an application of an established in-repo mechanism to a second consumer, not a new architecture.

**Problem statement.** FAFF-398 made the mandatory-review chain-outage fail-direction deterministic and unit-tested inside `review-call.mjs` (`--lights-out` → `mandatoryRemap` → exit 9 `MANDATORY_OUTAGE`), but its *activation* still rides one LLM hop: faff-graft forwards `lights_out` as prose context, and the adversarial-review slot's prose instructs the model to translate that into the `--lights-out` argument (`plugin/skills/faffter-dark-adversarial-review/SKILL.md`, the "MANDATORY chain-outage" section). If the model drops or misreads the signal, the review silently runs advisory — a full-chain outage then exits 5 (pass+skip) instead of 9 (needs-human), which is the exact silent second-opinion skip FAFF-398 exists to close. This change derives the flag mechanically from the run ledger so no model step sits between the resolved L4 level and the flag.

**Design principles.**

- **Fail-safe direction is unchanged: unresolved ⇒ advisory.** A missing run-dir, missing/unreadable/garbled ledger, or a ledger without `level: "L4"` must produce today's advisory behaviour byte-for-byte. The derivation may only ever *add* mandatory-ness on positive evidence; it never blocks L1–L3 flows.
- **The deterministic actors own the decision.** The only inputs to "mandatory?" are the ledger file and the helper's own flags. Skill prose may *carry a path value* (a passthrough), but must not *decide a boolean* (a translation). Reject any implementation that reintroduces a prose conditional ("if L4, add the flag").
- **No behaviour change to the FAFF-398 seam itself.** `mandatoryRemap`, the exit-code vocabulary, and the config-fault dominance rules are untouched — this changes only how `mandatory` gets *set* before the existing single-chokepoint remap.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (dependency-free, `.mjs`) | The helper: `parseArgs` (`--lights-out` → `a.mandatory`, line ~408), `mandatoryRemap` (~449), applied once in `main()` (~616). Gains the ledger derivation. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Skill prose | The invocation template ("Backend call") and the "MANDATORY chain-outage" section that currently prescribes the prose→flag hop. |
| `plugin/skills/faff/bin/faff` — `resolveAppetite` (~line 380) | Node | The precedent: reads `env.FAFF_RUN_DIR`, `readLedger(runDir)` → `run-ledger.json`, checks `ledger.level === "L4"`. Read-only context; not modified. |
| `plugin/skills/faff-graft/SKILL.md` Step 9 (~line 318–325) | Skill prose | Forwards `autonomous` + `lights_out` + `$run_dir` to the review slot; the `lights_out` bullet gets a note that the flag is now helper-derived. |
| `test/adversarial-call.test.mjs` (FAFF-398 block, ~line 817) | node --test | Existing `--lights-out` / `mandatoryRemap` / `main()` integration tests; new tests land beside them. |

**Scope statement.** This is gate-integrity plumbing within the established adversarial-review helper — the third consumer of the run ledger's `level` field (after the appetite resolver and the beep-boop level checks), and the closure of FAFF-398's accepted infosec residual.

## 2. OUT OF SCOPE

- **The `autonomous`-keyed paths (Phase-2 `critical` escalation, exit-5 outage annotation).** Why: those behaviours fire at *verdict-authoring* time — the slot's LLM composes the `faff-contract:review-verdict` block — not on the helper invocation; there is no helper flag to derive, so making them mechanical means moving verdict authoring into deterministic code, a different and much larger seam. Extension point: a future ticket could have `review-call.mjs` (or a sibling helper) emit a machine-readable `mode` line the slot echoes, or move block assembly into a CLI — extend at `review-call.mjs` `main()` and the slot's "Contract artifact" section. The issue itself scopes this as "if cheap"; it is not cheap.
- **Run-start reachability / dialCoherence checks.** Why: launch-time admission is FAFF-395/FAFF-298 territory; this ticket is mid-run activation only. Extension point: `bin/faff` `dialCoherence`.
- **Any change to exit-code semantics, the chain loop, or `chainTerminalExit`.** Why: FAFF-398/FAFF-232 shipped and tested them; this ticket only changes how `mandatory` is resolved. Extension point: none needed.
- **Liveness/heartbeat replication (`runIsHeld`) inside the helper.** Why: deliberately excluded — see the Design decision rationale on liveness (a stale ledger here can only fail *closed*, so the appetite resolver's staleness brace doesn't transfer). Extension point: import/extract a shared liveness predicate if a future consumer needs agency-*escalating* ledger reads in the helper.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| mandatory review | A review whose no-opinion chain exhaustion must fail closed (exit 9), i.e. an L4 lights-out review. Internal name: `a.mandatory` in `review-call.mjs`. |
| ledger derivation | Reading `<run-dir>/run-ledger.json` and treating `level === "L4"` as "this review is mandatory". |
| run-dir channel | How the helper learns the run dir: the new `--run-dir` flag, else the `FAFF_RUN_DIR` env var. |

**New helper surface (`review-call.mjs`):**

```
FLAG --run-dir <dir>     # optional; the run directory whose run-ledger.json decides mandatory-ness
                         # (the same $run_dir graft forwards for review-progress/heartbeat writes)

FUNCTION ledgerMandatory(runDir) -> boolean     # exported, pure-ish (fs read only)
  runDir absent/empty            -> false
  <runDir>/run-ledger.json missing, unreadable, or not JSON -> false   # never throws
  parsed.level === "L4"          -> true
  anything else                  -> false

IN main(), after parseArgs:
  effectiveRunDir = a.runDir ?? process.env.FAFF_RUN_DIR      # explicit flag wins over ambient env
  a.mandatory     = a.mandatory OR ledgerMandatory(effectiveRunDir)
  # a.mandatory from --lights-out is preserved: the explicit flag FORCES mandatory (OR, never AND)
```

The existing `--lights-out` flag, `mandatoryRemap(exit, mandatory)`, and every exit code are unchanged.

**Design decisions** (rationale collected in section 6):

- Channel = run ledger read by the helper, located via `--run-dir` flag with `FAFF_RUN_DIR` env fallback. **Chosen:** ledger derivation with dual-channel run-dir resolution.
- `--lights-out` retained as an explicit override that forces `mandatory = true` regardless of ledger. **Chosen:** keep, OR-composed.
- Derivation predicate = `level === "L4"` alone — no `owner.status` / heartbeat liveness check. **Chosen:** level-only.
- Slot invocation passes `--run-dir "$run_dir"` unconditionally whenever graft forwarded a run dir (identical template at L3 and L4 — no prose conditional). **Chosen:** unconditional passthrough.
- Generalising the mechanism to the `autonomous` prose paths. **Chosen:** out of scope (section 2).

## 4. HOW — Behaviour

**Architecture and approach.** Three touch points, smallest first:

1. **`review-call.mjs`** — add `--run-dir` to `parseArgs`; add the exported `ledgerMandatory` function; in `main()`, resolve `a.mandatory = a.mandatory || ledgerMandatory(a.runDir ?? process.env.FAFF_RUN_DIR)` *before* the existing `mandatoryRemap(res.exit, a.mandatory)` chokepoint. `readFileSync` is already imported; join the path with `node:path` (add the import) or plain string concat — either is fine, `node:path` preferred. No other logic moves.
2. **`faffter-dark-adversarial-review/SKILL.md`** — in the "Backend call" invocation template, add `--run-dir "$run_dir"` (both the single-backend and `--backends-json` forms), with prose: pass it whenever faff-graft forwarded a `$run_dir` (the same value the review-progress checkpoint writes already use; interactive runs have none and omit it). In the "MANDATORY chain-outage" section, replace the "Pass `--lights-out` iff the forwarded `lights_out` signal is true" instruction: the helper now derives mandatory-ness from the run ledger via `--run-dir`/`FAFF_RUN_DIR`; `--lights-out` remains as an explicit deterministic override (tests, callers that already resolved it) — the slot no longer translates `lights_out` into any flag. Update the exit-9 row's "only produced when `--lights-out` is passed" wording to "only produced when the review resolved mandatory (ledger-derived, or forced by `--lights-out`)".
3. **`faff-graft/SKILL.md` Step 9** — one-line amendment to the `lights_out` forwarding bullet: the `--lights-out` activation no longer rides the forwarded prose signal (the helper self-derives from the run ledger); the signal itself is still forwarded for slot context. No graft control-flow changes.

**Behaviour summary.** On any autonomous run the slot's Bash invocation carries `--run-dir`; the helper opens `run-ledger.json`; an L4-minted ledger makes the review mandatory; everything downstream (remap, exit 9, the slot's needs-human authoring on exit 9) is the already-shipped FAFF-398 machinery.

**Edge cases and error handling.**

- `--run-dir` given but no `run-ledger.json` (e.g. wrong path, deleted run): `ledgerMandatory` → `false`; advisory. Never an exception, never exit 2.
- Garbled/partial ledger JSON: caught, `false`, advisory.
- Ledger with no `level` key (ordinary L3 beep-boop run): `false`, advisory — L3 keeps pass+skip by design.
- Both `--run-dir` and `FAFF_RUN_DIR` present and different: the explicit flag wins (explicitly-handed beats ambient — mirrors the appetite resolver's "reads the explicitly-handed run dir" rule and dodges any stale-env hazard).
- `--lights-out` passed AND ledger says non-L4: mandatory (the explicit flag forces; a caller that resolved L4-ness itself is trusted).
- Interactive (L2) review: no run_dir forwarded, `FAFF_RUN_DIR` unset → advisory, byte-for-byte today's behaviour.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The slot's model drops `--run-dir` from the invocation.** The residual LLM hop shrinks from a boolean *translation* to a value *passthrough*, but does not vanish (the slot is prose; something must emit the command). You'd notice: the `FAFF_RUN_DIR` env fallback still derives mandatory when the harness propagates the export (`bin/faff` already relies on this inheritance for appetite); if both channels miss on a real L4 outage, the ledger's `review_adversarial_skipped` annotation still fires loudly in the run summary — the pre-FAFF-398 visibility floor, never a silent undifferentiated pass. Meaning: strictly better than today on every path; accept.
- **A stale/abandoned L4 ledger derives mandatory for a review that isn't really L4.** Only reachable by explicitly handing the helper a dead run's dir. Direction: *fail-closed* (a false park, visible and recoverable) — the safe direction; never a false merge. Meaning: accept (see decision 3).
- **`FAFF_RUN_DIR` leaks from a parallel L4 drain into an unrelated interactive review.** Requires the interactive session to inherit another run's export — and the failure direction is again a visible false park, not a silent skip. Meaning: accept; note in the SKILL.md prose that interactive invocations may pass `--run-dir ''`? No — **Anti-pattern:** adding an "interactive suppression" flag. Why: it reintroduces a prose-decided boolean, and the hazard it guards is already fail-safe in direction and vanishingly rare.

## 5. Scenarios

```
Given a run ledger minted by faff lights-out (level: "L4") at <run-dir>
When  review-call.mjs is invoked with --run-dir <run-dir> and NO --lights-out flag,
      and its whole backend chain exhausts with only no-opinion classes (unreachable/deadline)
Then  it exits 9 (MANDATORY_OUTAGE) — the fail-closed path fired with no model decision in the loop
```

```
Given a run ledger WITHOUT level "L4" (an ordinary L3 run) at <run-dir>
When  review-call.mjs is invoked with --run-dir <run-dir> and its chain exhausts all-unreachable
Then  it exits 5 (advisory pass+skip), exactly as today
```

```
Given no --run-dir flag and no FAFF_RUN_DIR in the environment
When  the chain exhausts
Then  the exit is byte-for-byte today's (5/6/8 per cause) — unresolved ⇒ advisory
```

```
Given FAFF_RUN_DIR points at an L4-minted ledger and no --run-dir flag is passed
When  the chain exhausts with no opinion
Then  it exits 9 — the env fallback alone activates the mandatory remap
```

```
Given --lights-out is passed explicitly (no run dir anywhere)
When  the chain exhausts with no opinion
Then  it exits 9 — the explicit override still forces mandatory (FAFF-398 back-compat)
```

Non-functional assertions: `review-call.mjs` stays dependency-free (node builtins only); a config-fault exit (2/4/6/7) is never masked by the derivation (`mandatoryRemap` dominance untouched).

## 6. Design decision rationale

**How should the flag be derived mechanically?** Options: (a) env boolean like `FAFF_LIGHTS_OUT` exported by graft — but Bash-tool shells don't reliably persist exports between calls, and an LLM would still have to prefix the invocation, i.e. the hop survives; (b) the slot echoes a graft-resolved value into the flag — still a prose translation, just relocated; (c) the helper reads the run ledger itself, handed only the run-dir path. **Chosen:** (c) ledger derivation — the ledger is machine-written (`faff lights-out` mints `level:"L4"`), the helper is deterministic code, and `bin/faff`'s appetite resolver already established the identical read (`FAFF_RUN_DIR` → `run-ledger.json` → `level === "L4"`), so the decision chain is machine-to-machine end-to-end.

**Keep or retire `--lights-out`?** Retiring it would break the shipped FAFF-398 tests and remove the deterministic escape hatch for a caller that has already resolved L4-ness. **Chosen:** keep it as an explicit override, OR-composed with the ledger derivation (`mandatory = flag || ledger`); the flag forces, never gates.

**Should the derivation check run liveness (`owner.status` / heartbeat), mirroring the appetite resolver's `runIsHeld` brace?** The appetite brace exists because a stale L4 ledger must never *escalate agency* (pin `full`). Here the derived direction *reduces* agency — mandatory ⇒ fail-closed ⇒ needs-human park — so the staleness confound inverts: a stale ledger can only cause a visible false park, never a false merge. Replicating heartbeat math into a second file adds drift risk for no directional safety. **Chosen:** `level === "L4"` alone; the asymmetry is documented in the helper comment (mirror of the FAFF-398 "why lights_out, not autonomous" note). At the time of writing no shared module exists between `bin/faff` and `review-call.mjs`; revisit if one appears.

**Where does the run-dir come from?** The slot already holds `$run_dir` (graft forwards it for the review-progress checkpoint and heartbeat ticks), and `FAFF_RUN_DIR` is exported at run start and relied on by `faff` subcommands in subagent shells. **Chosen:** `--run-dir` flag (explicit, primary) with `FAFF_RUN_DIR` fallback (ambient, belt-and-braces); flag wins on conflict. The slot template appends `--run-dir "$run_dir"` unconditionally whenever a run_dir was forwarded — the same condition, wording, and value as the existing checkpoint writes, with no L3-vs-L4 branch left in prose.

**Fold the `autonomous` prose paths into the same mechanism?** **Chosen:** no — out of scope (section 2): those paths key verdict *authoring*, not a helper flag; nothing on the invocation exists to derive. The issue's own framing ("if cheap") is answered: it is not cheap.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions:**

- **Assumes:** `run-ledger.json` with a top-level `level: "L4"` field is the canonical L4 marker, minted by `faff lights-out` — validated: `bin/faff` `resolveAppetite` reads exactly this (`ledger.level === "L4"`), and the beep-boop prose states a run is L4 iff its ledger was lights-out-minted. Build agent: grep `bin/faff` for `readLedger` before starting.
- **Assumes:** the adversarial slot receives `$run_dir` on every autonomous (L3/L4) dispatch — validated: graft Step 9 forwards it (`BuildDispatch`), and the slot's review-progress checkpoint section already consumes it.
- **Assumes (accepted residual — infosec):** the invocation line is still LLM-emitted prose, so `--run-dir` can in principle be dropped; the `FAFF_RUN_DIR` env fallback plus the loud `review_adversarial_skipped` run-summary annotation bound the damage, and the hop is now a value passthrough, not a boolean decision. This is the narrowed remainder of the FAFF-398 residual; a fully prose-free invocation would require the whole review call to move behind a CLI, out of scope here.

## 8. DONE — Definition of Done

### From WHAT (helper surface)
- [ ] `parseArgs` accepts `--run-dir <dir>`; absent ⇒ `a.runDir` undefined.
- [ ] Exported `ledgerMandatory(runDir)` returns `true` iff `<runDir>/run-ledger.json` parses and has `level === "L4"`; `false` on absent runDir, missing file, unreadable file, garbled JSON, or any other `level` — and never throws.
- [ ] `main()` resolves `a.mandatory = a.mandatory || ledgerMandatory(a.runDir ?? process.env.FAFF_RUN_DIR)` before the existing `mandatoryRemap` chokepoint; `--lights-out` still forces mandatory.

### From HOW (behaviour, node --test in test/adversarial-call.test.mjs)
- [ ] Integration: `--run-dir` at an L4-minted temp ledger + all-unreachable chain → exit 9, with **no** `--lights-out` on the argv.
- [ ] Integration: `--run-dir` at a non-L4 ledger + all-unreachable chain → exit 5 (advisory unchanged).
- [ ] Integration: `FAFF_RUN_DIR` env alone (no flag) at an L4 ledger → exit 9; and the flag wins when both are present and disagree.
- [ ] No-channel invocation (no flag, no env) → exits byte-for-byte as today (existing FAFF-398/232 tests stay green unmodified).
- [ ] Config-fault dominance untouched: a 2/4/6/7-class terminal with the ledger saying L4 still returns that fault code (existing `mandatoryRemap` pass-through tests cover it; add one ledger-driven case).

### From HOW (prose wiring — same PR, docs never stale)
- [ ] `faffter-dark-adversarial-review/SKILL.md`: invocation template(s) carry `--run-dir "$run_dir"`; the MANDATORY chain-outage section states the ledger derivation and demotes `--lights-out` to explicit override; the exit-9 row wording updated.
- [ ] `faff-graft/SKILL.md` Step 9 `lights_out` bullet notes the flag is helper-derived from the run ledger; the forwarded signal remains context-only.
- [ ] `faff validate-adapters` passes on the edited SKILL.md files.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (this change *removes* one prose decision); no new grader KIND or seam-registry row required — confirmed in the PR description.

**Integration smoke test:**

```
1. mkdir tmp-run; write tmp-run/run-ledger.json = { "run_id": "t", "level": "L4" }
2. node review-call.mjs --host http://127.0.0.1:9 --model m --system s.txt --diff d.txt --run-dir tmp-run
3. expect exit 9 and the "MANDATORY second opinion unavailable" stderr line
4. rewrite ledger without level; rerun; expect exit 5
```

## Already shipped against this surface

- **FAFF-398** (Done 2026-07-07, PR #284) — shipped the deterministic seam itself (`--lights-out`, `mandatoryRemap`, exit 9) and *named this exact residual* as the ticket-worthy follow-up ("derive the flag through a channel the slot's Bash reads mechanically"). The delta is real: `review-call.mjs` has no `--run-dir`/ledger read today, and the slot prose still prescribes the LLM hop.
- **FAFF-329** (Done) — forwards `$run_dir` into the slot for review-progress checkpoints; this spec reuses that already-plumbed value, adding no new forwarding.
- **FAFF-297 / FAFF-353** (Done) — the `autonomous`-keyed escalation/annotation paths; adjacent but untouched here (out of scope, section 2).
- **FAFF-232 / FAFF-227 / FAFF-228** (Done) — the chain/retry/exit-code machinery; untouched.

None supersede the premise — proceed.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
