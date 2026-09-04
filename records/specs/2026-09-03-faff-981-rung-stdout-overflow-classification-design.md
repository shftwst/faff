# Spec — FAFF-981: rung stdout over 1 MB must classify on exit status, not overflow into a false needs-human park

> Spec: faffter-dark-nlspec · 2026-09-03 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-981.

This is a buildable spec for issue FAFF-981, addressed to the build agent implementing the fix and to human reviewers gating it. It fixes a single, well-pinpointed defect in the quality-gate ladder runner: a rung that prints a lot of stdout is misread as a spawn failure and parks the whole autonomous build for a reason that is not a real failure. Line references are against `plugin/skills/faff/bin/lib/gates.js` at the time of writing.

## 1. WHY — Problem and Principles

**The load-bearing model.** A gate rung's *verdict* comes from its process exit status: `0` is pass, non-zero is fail, and only a genuine inability to run the command (spawn failure, or exit `127` command-not-found) is `errored`. Node's `spawnSync` collects the child's entire stdout and stderr into memory-capped buffers; when a buffer fills past its `maxBuffer` limit Node stops the child and reports the run as an *error* with no exit status. So the runner's ability to read a true exit status depends on the child's output fitting in the buffer — and today that buffer is Node's 1 MB default. Once output exceeds it, the exit status is destroyed before the classifier ever sees it, and a passing rung is indistinguishable from a broken one.

**Problem statement.** `runRung` spawns each rung with no `maxBuffer` override, so any rung emitting more than ~1 MB of stdout (the UNIT rung here, `node --test`, ~8 minutes and thousands of TAP lines, reliably does) is killed by Node with an `ENOBUFS` error; the classifier (`if (res.error || res.status === 127) status = "errored"`) then lumps that overflow in with real spawn failures, and the ladder turns an `errored` rung into a `needs-human` park. This spec raises the buffer ceiling so legitimate rungs classify on their real exit status, and teaches the classifier to tell a buffer overflow apart from a command-not-found so the two are never conflated again.

**Design principles.**

**Never manufacture a failure verdict from a missing exit status.** A rung that ran to completion and exited `0` must classify `pass` even when it is noisy; the fix's whole point is that output volume must not change the verdict. Any implementation that lets a high-output-but-passing rung land on `errored` or `fail` is wrong regardless of how it is coded.

**Preserve the genuine `errored` signals exactly.** Command-not-found (`127`), real spawn errors (e.g. the shell itself failing), and timeouts (`ETIMEDOUT`, the child killed at the 10-minute cap) must still classify `errored` and still park to a human — we genuinely cannot conclude anything about the code in those cases. The change narrows what counts as errored; it must not widen or shrink the *true* errored set.

**Bound memory.** The runner executes inside the build worktree on the same host as the rest of the autonomous run. A ceiling of "unlimited" would let a runaway rung exhaust memory and take the runner down, trading a false park for a hard crash. The ceiling must be generous but finite.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` — `runRung` (lines 418–433) | Node.js (CommonJS) | The function that spawns and classifies a rung; the sole site of the fix |
| `plugin/skills/faff/bin/lib/gates.js` — `runLadder` (lines 652–673) | Node.js | Consumes rung status; `errored` → `needsHuman` → `needs-human` signal (line 660) |
| `plugin/skills/faff/bin/lib/gates.js` — `gatesSelftest` (lines 728+) | Node.js | In-CLI unit table that drives `discoverRungs`/`runLadder` against tmp fixtures |
| `test/gates-ci-source.test.mjs` | Node test (`node:test`) | Existing gate test; `createRequire` to pull named exports from `gates.js` |
| `test/helpers/run-cli.mjs` | Node | `runCli` helper for CLI-level tests |

**Scope statement.** This sits entirely inside the quality-gates ladder runner (`faff gates run`); it changes how one rung's process output is buffered and classified, and nothing upstream (discovery) or downstream (the gates contract, the park mechanism) of it.

## 2. OUT OF SCOPE

- **Streaming rung output to a temp file or pipe.** Excluded — a `maxBuffer` raise fully resolves the observed defect with a one-line change, and streaming is a larger rewrite of the spawn/collect path with its own failure surface (temp-file lifecycle, cleanup on timeout). Extension point: if a future rung must emit genuinely unbounded output, `runRung`'s `spawnSync` call in `gates.js` is where a `spawn`-plus-file-redirect would replace the buffered call.
- **A configurable buffer ceiling (`gates.max_buffer_mb`).** Excluded — no evidence any rung needs a different ceiling, and every existing knob adds a config surface to test and document. Extension point: `readGatesConfig` in `gates.js` (lines 455+) is where a `gates.max_buffer_mb` knob would be read, mirroring `gates.max_rungs_per_kind`.
- **Reclassifying timeouts.** Excluded — a rung killed at the 10-minute cap (`ETIMEDOUT`) genuinely has no verdict and correctly parks to a human; this spec leaves that path untouched. This is the subject of the separate open issue FAFF-984 and is deliberately not addressed here. Extension point: none needed; the classifier explicitly only special-cases `ENOBUFS`.
- **Changing what `needs-human` means or how the ladder parks.** Excluded — the park mechanism is correct; the bug is purely that an overflow should never have reached it. Extension point: `runLadder` line 660.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| rung | One quality-gate check (LINT, UNIT, …) with a shell `command`, run by `runRung` |
| ladder | The cheapest-first sequence of rungs run by `runLadder`, fail-fast on the first failing required rung |
| `errored` | Rung status meaning "we could not obtain a verdict" (spawn failure / tool missing) → parks to a human |
| `ENOBUFS` | Node's error code on a `spawnSync` result when a child's stdout/stderr buffer exceeds `maxBuffer`; the child is killed (`SIGTERM`) and `status` is `null` |
| ceiling | The `maxBuffer` value passed to `spawnSync` — the largest output a rung may emit and still be classified on its exit status |

**The `spawnSync` result shape this fix reasons about** (Node semantics, confirmed against the FAFF-981 root-cause analysis):

```
RECORD SpawnSyncResult:
  status: int | null      # child exit code; null when the child was killed (buffer overflow, timeout)
  signal: string | null   # 'SIGTERM' when Node killed the child
  error:  Error | null    # set on spawn failure, timeout, OR buffer overflow
  error.code: string      # 'ENOBUFS' (overflow) | 'ETIMEDOUT' (timeout) | 'ENOENT' etc. (spawn failure)
  stdout: string          # captured up to maxBuffer (truncated at the ceiling on overflow)
  stderr: string          # captured up to maxBuffer
```

The situations the classifier must separate:

| Situation | `res.status` | `res.error` | `res.error.code` | Correct rung status |
|---|---|---|---|---|
| Rung ran, exited 0, any output volume ≤ ceiling | `0` | `null` | — | `pass` |
| Rung ran, exited non-zero, output ≤ ceiling | non-zero | `null` | — | `fail` |
| Command not found | `127` | `null` | — | `errored` |
| Genuine spawn failure (shell missing, etc.) | `null` | set | `ENOENT`/other | `errored` |
| Timeout at the 10-minute cap | `null` | set | `ETIMEDOUT` | `errored` (unchanged) |
| Output exceeds the ceiling | `null` | set | `ENOBUFS` | `errored` — killed child has no exit status (see rationale) |

**Design decision — the buffer ceiling.** A rung's real output is at most single-digit MB (this repo's UNIT TAP stream is the worst case). The ceiling must clear that by a wide margin yet stay finite. Options: leave the 1 MB default (rejected — the bug); `Infinity`/unbounded (rejected — violates the bound-memory principle); a generous fixed constant. **Chosen:** a fixed `MAX_RUNG_STDOUT_BYTES = 64 * 1024 * 1024` (64 MiB) module constant passed as `maxBuffer`, giving roughly an order of magnitude of headroom over any real rung while capping worst-case per-rung memory.

## 4. HOW — Behavior

**Approach.** Two edits to `runRung`, both inside `gates.js`, with no signature change and no new export (`runRung` is already exported). First, pass the new ceiling to `spawnSync`. Second, refine the classifier so it separates a buffer overflow from a genuine spawn error while keeping both, for now, as `errored` with distinct detail text.

```
CONSTANT MAX_RUNG_STDOUT_BYTES = 64 * 1024 * 1024   # 64 MiB, module scope

PROCEDURE runRung(rung, root):
  started = now()
  TRY:
    res = spawnSync(rung.command, {
            cwd: root, shell: true, encoding: "utf8",
            timeout: 10 * 60 * 1000,
            maxBuffer: MAX_RUNG_STDOUT_BYTES        # <-- added
          })
  CATCH e:
    RETURN errored result with detail = last 500 chars of e.message

  duration = now() - started
  tail = last 500 chars of (res.stderr + res.stdout)

  overflow = res.error AND res.error.code === "ENOBUFS"

  IF overflow:
     status = "errored"
     detail = "rung stdout exceeded the 64 MiB ceiling; cannot classify on exit status\n" + tail
  ELSE IF res.error OR res.status === 127:
     status = "errored"                                     # spawn failure / timeout / command-not-found
     detail = tail
  ELSE IF res.status === 0:
     status = "pass"
     detail = tail
  ELSE:
     status = "fail"
     detail = tail

  RETURN { kind, name, command, status, duration_ms: duration, detail }
```

**Behaviour summary.** The classifier now asks "did the buffer overflow?" first; if not, it falls through to the existing logic unchanged, so `127`, other spawn errors, timeouts, `0`→pass and non-zero→fail all behave exactly as before. Only the overflow case is peeled off — and only to give it distinct detail text, not to change its `errored` verdict.

**Why an overflow past the raised ceiling stays `errored`.** When `maxBuffer` is exceeded Node *kills* the child (`SIGTERM`) before it exits, so `res.status` is `null` — there is no exit status left to classify on. "Truncate the output and classify on exit status" is therefore not implementable at the ceiling: the exit status no longer exists. Since a rung emitting >64 MiB is pathological and we cannot conclude pass/fail, parking it to a human (`errored` → `needs-human`) is the correct and safe outcome. **Chosen:** overflow past the ceiling remains `errored`, distinguished from other errored causes only by its `detail` string; it is not truncated-and-classified, because a killed child yields no exit status. The value of the fix is that the ceiling is set high enough (64 MiB) that real rungs never reach this branch.

**Anti-pattern:** setting `maxBuffer: Infinity` to "never overflow again". Why: it removes the memory bound, so a runaway rung OOM-kills the runner — a worse failure than the park it replaces.

**Anti-pattern:** treating `res.error` truthiness alone as "not a buffer problem" and flipping *all* errored results to pass/fail. Why: that would misclassify real spawn failures and timeouts (which also set `res.error`) as code verdicts. The discriminator must be `res.error.code === "ENOBUFS"` specifically.

**Edge cases and error handling.**

- **Exactly at the boundary.** Output ≤ 64 MiB never triggers `ENOBUFS`; the exit status is read normally. No off-by-one concern — Node overflows only when a buffer is exceeded, not met.
- **stderr overflow.** `maxBuffer` applies per stream (stdout and stderr each), so a rung that floods stderr is covered by the same ceiling and the same `ENOBUFS` handling.
- **Timeout vs overflow ordering.** Both kill the child and set `res.error` with `res.status === null`; they are told apart by `res.error.code` (`ETIMEDOUT` vs `ENOBUFS`). A rung that both overflows and times out will surface whichever code Node reports; both classify `errored`, so the verdict is unaffected either way.
- **`detail` truncation.** `detail` remains the last 500 chars of `stderr + stdout` (`res.stdout` is Node-truncated at the ceiling on overflow); the overflow branch prepends its explanatory line so a human reviewing the park sees "output overflow", not a misleading command tail.

**Failure modes.**

- **The failure:** 64 MiB is still too low and a legitimate rung's real output grows past it, reintroducing false parks. **How you'd know:** a rung that exits 0 shows up `errored` with the "exceeded the ceiling" detail line in the park record. **What it means:** raise the constant, or move to the out-of-scope streaming approach — not a reason to abandon the fix, and the distinct detail line makes this diagnosable instead of silent (which is the improvement over today).
- **The failure:** Node's overflow error code differs from `ENOBUFS` on some platform/version, so the overflow branch never matches and overflows keep classifying via the generic `errored` path (i.e. the fix silently no-ops for detection while the raised ceiling still helps). **How you'd know:** the regression test asserting a >1 MB passing rung classifies `pass` still passes (the ceiling raise carries it), but an over-ceiling test would not carry the distinct detail. **What it means:** the ceiling raise — the load-bearing part — is independent of the code string, so the user-visible defect is fixed regardless; the `ENOBUFS` branch is a diagnosability refinement. Proceed.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a rung whose command exits 0 after printing well over 1 MB of stdout (e.g. a loop or node -e that writes ~4 MB)
When runRung executes it
Then the returned status is "pass" (classified on exit status, not "errored")
```

```
Given a rung whose command does not exist on PATH (a command-not-found, exit 127)
When runRung executes it
Then the returned status is "errored" (unchanged)
```

- The buffer ceiling passed to `spawnSync` MUST be finite (a fixed constant), not `Infinity`, so a runaway rung cannot exhaust runner memory.

## 6. Design Decision Rationale

**Raise `maxBuffer` vs stream child output to a file/pipe?** Raising the ceiling is a one-line, low-risk change that fully resolves the observed defect (rungs emit single-digit MB; 64 MiB clears that comfortably). Streaming eliminates the ceiling entirely but rewrites the spawn/collect path and adds temp-file lifecycle and cleanup-on-kill concerns for no benefit at current output sizes. **Chosen:** raise `maxBuffer` to a 64 MiB constant; streaming is documented as the out-of-scope extension point if output ever becomes genuinely unbounded.

**What ceiling value?** 1 MB is the bug; `Infinity` breaks the bound-memory principle. A fixed 64 MiB gives ~8–64× headroom over any real rung while capping per-rung worst-case memory. **Chosen:** `MAX_RUNG_STDOUT_BYTES = 64 * 1024 * 1024`.

**Should an overflow past the ceiling be `errored` or truncated-and-classified?** A ceiling overflow kills the child before it exits, so `res.status` is `null` — there is no exit status to classify on, making "truncate and classify" impossible at the ceiling. **Chosen:** overflow past the ceiling stays `errored` (parks to a human, which is correct when no verdict exists), distinguished from other errored causes by a dedicated `detail` message.

**How does the classifier tell an overflow from a real spawn error / 127?** All of overflow, timeout, and spawn failure can leave `res.status` null with `res.error` set; only the error *code* separates them. **Chosen:** branch on `res.error.code === "ENOBUFS"` for the overflow case, leaving `127` and every other `res.error` on the existing `errored` path unchanged.

**How does the regression test drive the rung?** `runRung` is already exported from `gates.js`, so the test can call it directly with a synthetic rung object, which is far tighter than an end-to-end `faff gates run` fixture and needs no export change. **Chosen:** a dedicated `test/*.test.mjs` file that `createRequire`s `runRung` and calls it with synthetic high-output / non-zero / command-not-found rungs, asserting on the returned `status`. (The `gatesSelftest` table is a viable secondary home but couples the case to CLI selftest output; the standalone test is clearer.)

## 7. Open Questions and Assumptions

**Open questions.** None — every decision above carries a `**Chosen:**` marker.

**Assumptions.**

- **Assumes:** Node's `spawnSync` sets `res.error.code === "ENOBUFS"` on a `maxBuffer` overflow and `res.status === 127` on command-not-found, as stated in the FAFF-981 root-cause analysis. Validate before starting: `node -e 'const{spawnSync}=require("child_process");const r=spawnSync("yes | head -c 2000000",{shell:true,encoding:"utf8",maxBuffer:1024});console.log(r.error&&r.error.code, r.status)'` should print `ENOBUFS`; a command-not-found run should print a null/other code with `status` 127.

## 8. DONE — Definition of Done

### From WHY
- [ ] A rung emitting well over 1 MB of stdout and exiting 0 classifies `pass`, not `errored` (the false-park class for high-output rungs is eliminated).

### From WHAT (types and ceiling)
- [ ] `runRung` passes a finite `maxBuffer` of `64 * 1024 * 1024` (a named module constant) to `spawnSync`.
- [ ] The classifier separates the situations in the WHAT table onto the correct rung status.

### From HOW (behaviour)
- [ ] A rung that prints >1 MB and exits non-zero classifies `fail`, not `errored`.
- [ ] A command-not-found rung (exit 127) still classifies `errored`.
- [ ] A genuine spawn error and a timeout (`ETIMEDOUT`) still classify `errored` (unchanged).
- [ ] A rung whose output exceeds the 64 MiB ceiling classifies `errored` with a `detail` string that names the overflow (distinct from a command-tail detail).

### From HOW (edge cases)
- [ ] The overflow branch keys on `res.error.code === "ENOBUFS"` specifically, not on `res.error` truthiness, so timeouts and spawn failures are not swept into it.

### From Scenarios (regression test)
- [ ] A `test/*.test.mjs` file drives `runRung` directly (imported via `createRequire`) with synthetic rungs and asserts: >1 MB + exit 0 → `pass`; >1 MB + non-zero → `fail`; command-not-found → `errored`.
- [ ] `node --test` (the UNIT rung) and `faff gates --selftest` pass with the change in place.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Build a synthetic rung: { kind:"UNIT", name:"noisy", command:"node -e 'for(let i=0;i<200000;i++)process.stdout.write(\"x\".repeat(30)+\"\\n\")'" }   # ~6 MB, exit 0
  2. result = runRung(rung, someRoot)
  3. ASSERT result.status === "pass"    # pre-fix this was "errored"
```

## Already shipped against this surface

The gate-ladder runner has moved recently, so the build agent should not redo work already merged:

- **FAFF-849** (Done, 2026-08-27) reworked how rungs are *discovered and selected* — exclusion rules, the `gates.*` config keys, per-kind caps, and the wall-clock budget. It did **not** touch `runRung`'s buffering or classification, which is verified to still spawn with no `maxBuffer` override. FAFF-981's fix is orthogonal to that rework.
- **FAFF-639** (Done, 2026-08-30) closed a discovery gap (CI-only validate steps the ladder missed). Also discovery-side, not the runRung buffer path.
- **FAFF-984** (Backlog, open) is a *sibling* defect in the same `runRung` area — a whole-suite UNIT rung that times out is misreported as errored. It is **not** shipped and is **not** covered here: this spec deliberately leaves the timeout (`ETIMEDOUT`) path classifying as `errored` unchanged. The two fixes touch adjacent lines of the same classifier; whichever lands second should rebase onto the first rather than re-deriving the classifier.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. The spec is a single 1–3 day unit: one defect in one function (`runRung` in `plugin/skills/faff/bin/lib/gates.js`) plus one new test file, targeting a single concern — the ENOBUFS overflow misclassification. There is no second independent concern hiding inside it, so nothing to split. On the merge side, FAFF-984 (sibling: whole-suite UNIT rung timeout misreported as `errored`) is tempting to fold in — same function, same false-`errored`/false-`needs-human` symptom — but the two are *independent* fixes on different `res.error` branches (ENOBUFS overflow vs. timeout), and either can ship and deliver value without the other. They are not an always-ships-together pair, so keep them separate rather than merging.

**Workstream fit?** No issues. The issue carries one coherent outcome — rungs that emit >1 MB stdout are classified correctly instead of false-parking to `needs-human` — with an unambiguous deliverable. It sits project-less in Backlog, which is the correct default landing for a captured bug; no outcome-led project needs to be manufactured for it. Note in passing: FAFF-981 + FAFF-984 (and any further rung-classification-correctness fixes) *feel* groupable, but "gate/rung classification correctness" is a capability/theme, not a shippable user outcome, so resist forming a thematic bucket for them — leave both loose until a genuine outcome emerges.

**Deps surfaced?** What's there: the spec explicitly scopes itself around the shared classification switch — "branch the overflow case on `res.error.code === \"ENOBUFS\"`" while "leave 127/spawn-error/timeout classification unchanged" — and timeout classification is exactly what the open sibling FAFF-984 will change. So both tickets edit the same error-classification region of `runRung`. Why it matters: this is not a load-bearing `blockedBy` dependency (neither fix needs the other's output, so no blocker link is missing), but it *is* a real file-level coupling — built concurrently they will collide, and the second-built one inherits the ENOBUFS-keyed distinguishing-detail pattern this ticket establishes. What to do: don't add a blocker edge (it would misstate the dependency), but sequence FAFF-981 and FAFF-984 adjacently, land FAFF-981 first so FAFF-984 can mirror its distinguished-detail convention for consistency, and have whichever runs second rebase. FAFF-982 (concurrent-L3 double-admit) is correctly "Related", not a blocker — it shares no code path with this fix.

**Risk profile?** No issues — and notably well-handled. This is a small, contained change to well-understood existing code: no novel integration, no external-team dependency, no unproven approach. The single unknown — Node's ENOBUFS/127/killed-child exit-status semantics — is already carried as an explicit **Assumes:** with an inline validation command, which is precisely the right lightweight de-risk; a separate de-risking spike would be overkill. One residual worth stating plainly (not a blocker): the chosen finite 64 MiB ceiling means a rung exceeding *that* still classifies `errored` — but now with a distinguishing ENOBUFS-keyed detail message rather than a silent false park, which is the deliberate, correctly-reasoned tradeoff over `Infinity` or streaming. High confidence is justified.

confidence: high
build-tier: complex
