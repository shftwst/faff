# Spec — FAFF-782: L3 drain gets abandoned by a 600s background-task ceiling, leaving the run-ledger unclosed after a successful merge

> Spec: faffter-dark-nlspec · 2026-08-13 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-782.

This spec is for the build agent and human reviewers. It addresses FAFF-782: a `/faff-beep-boop` L3 drain whose build genuinely merged is force-terminated mid-wait by the harness's 600s background-task ceiling, so the run-ledger never reaches a terminal state and `faff disposition` cannot tell "shipped real code, just never got to close the ledger" apart from "the build failed."

## 1. WHY — Problem and Principles

**The load-bearing model.** A drain's *real work* (merge) and its *ledger bookkeeping* (record the `shipped` outcome, flip `owner.status:"done"`) happen at different times, and a merge can already be durable on `main` while the bookkeeping is still pending. If the orchestrator process dies in that gap, the ledger is stuck `running`/empty even though nothing failed. The on-disk artifact `<run-dir>/<issue>/merge-record.json` (written by `merge-gate` *only* when the merge floor passed) is the durable proof the merge happened — it survives the process death, so a run-end reader can recover the truth the killed orchestrator never wrote.

**Problem statement.** Today a background post-merge verification step can outlive the harness's `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (unset → 600s), which force-terminates the *parent orchestrator* mid-wait; the ledger is left `owner.status:"running"` with empty `outcomes` despite a successful merge, and `faff disposition` scores it identically to a genuine build failure. This change (a) removes the ceiling as a truncation source on the L3 drain, (b) makes the run-end close run synchronously in-turn, and (c) teaches `disposition` to distinguish a merged-but-unclosed run from a real failure using the merge-record evidence.

**Design principles.**

- **`disposition` stays pure and read-only.** It reads on-disk substrates under the run dir and classifies; it writes nothing and calls no tracker/network/LLM (its stated invariant). The new merge-record read is gathered in the impure shell and folded in as another substrate, exactly like `readParksMap`/`readIssueOutcomeEvents` — never inside the pure classifier.
- **Ledger write-authority is unchanged.** Only the run's own agents write `owner.status` / `outcomes` (beep-boop's ledger contract). This change adds *detection*, not a new writer. Whether any headless path may *auto-close* a merged-but-unrecorded ledger is deliberately deferred (Open Questions).
- **Fail toward attention.** A merged-but-unclosed run is still `needs-attention` (non-zero exit) — it still needs closing. The change only makes the attention item self-evidently a different, less-alarming class than a failed build.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/disposition.js` | Node (CJS) | The run-end classifier; where the distinguish change lands. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Node (CJS) | Writes `<run-dir>/<issue>/merge-record.json` `{pr, head_sha, merged:true, merged_at, integrity}` on merge-ok — the evidence substrate. |
| `plugin/skills/faff/bin/lib/run-ledger.js` | Node (CJS) | `record-outcome` sets `outcomes[issue]` + flips `owner.status:"done"`; the close the killed orchestrator never reached. |
| `operations/ci/faff-cron.sh` | bash | In-repo REFERENCE drain wrapper (`timeout 300m claude -p "/faff-beep-boop"` then `faff disposition`); carries the same latent missing-ceiling bug. |
| `operations/ci/l3-watcher.yml` | GitHub Actions (reference) | The Actions-form twin of the same drain. |
| `plugin/skills/faff-beep-boop/SKILL.md` §11.5/11.6, §"Run ledger" | prose | Run-end reconcile + post-merge annotations + owner-close-at-exit (line ~400). |
| `plugin/skills/faff-graft/SKILL.md` Step 10, §"How to actually wait for CI" | prose | Post-merge-check runs in-flow; the existing synchronous-wait prose pattern to mirror. |
| `test/disposition.test.mjs` | Node test | Drives `disposition --selftest`; extended with the new fixtures. |

**Scope statement.** This sits at the L3 drain's run-end boundary — the seam between a merged build and a closed run-ledger — on the self-hosted runner path (`operations/ci/`) and the `disposition` verb.

## 2. OUT OF SCOPE

- **Auto-recovery / auto-close of a merged-but-unclosed ledger** — writing `record-outcome shipped` + `owner.status:"done"` from a headless recovery path. Why excluded: it crosses two invariants (disposition's read-only contract; the ledger's "only the run's own agents write owner.status") and can mask a real post-merge regression — a genuine architectural decision, surfaced as a Punt (§7), not settled here. Extension point: a future `faff reconcile`-adjacent recovery verb, or an orchestrator resume path, once the write-authority question is decided.
- **Auto-revert / reopen on post-merge regression** — already an explicitly unbuilt follow-up (post-merge "seam (b)"). Why excluded: unrelated to the truncation bug. Extension point: `post-merge.js`.
- **Changing the external `fly-ci-l3-runner` deployment (`drain.sh`/`entrypoint.sh`)** — those files live on the fly app, not in this repo. Why excluded: this repo's PR cannot edit them. Extension point: an operator change on the runner, mirrored from the reference wrappers (§7 Assumptions).
- **A mechanical PreToolUse fence on the orchestrator's background dispatch** — the existing `background-fence` deliberately does not fence the orchestrator's deliberate backgrounded dispatch (it cannot tell it from a build subagent's Agent call). Why excluded: extending it is a separate mechanical layer with its own false-positive surface. Extension point: `plugin/skills/faff/bin/lib/background-fence.js`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| merged-unclosed | A run-end state: an admitted issue has no recorded `outcome`, but its `merge-record.json` shows `merged:true` — the merge is durable, only the ledger close is missing. |
| background-task ceiling | The harness env `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (unset → 600000). When background tasks outlive it, the harness force-terminates the *parent* process. |

**New disposition substrate + attention kind.**

```
# gathered in the impure shell (NOT in the pure classifier), keyed on the ledger's admitted[]:
mergedMap: Map<issue-id, boolean>     # true iff <run-dir>/<issue>/merge-record.json parses AND .merged === true
                                      # absent/unreadable/malformed/truncated JSON/merged!=true → issue omitted (degrade, never throw)

# new attention item shape (joins the existing kinds: issue-outcome | run-escalation | aborted | incomplete-ledger):
AttentionItem {
  kind: "merged-unclosed"
  issue: <issue-id>                   # the admitted-but-unrecorded issue that DID merge
  outcome: null
  cause: "merged-unrecorded"          # a stable token; render also surfaces PR/sha when available (see HOW)
}

# concrete --json shape of the classified report (illustrative):
{ "run_id": "run-…-l3-cron",
  "disposition": "needs-attention",
  "attention": [ { "kind": "merged-unclosed", "issue": "FAFF-417", "outcome": null, "cause": "merged-unrecorded" } ],
  "counts": {} }
```

**Signature change (pure core).** `computeDisposition(ledger, parksMap, eventMap, runId)` gains a `mergedMap` parameter:

```
computeDisposition(ledger, parksMap, eventMap, mergedMap, runId)
  # mergedMap defaults to {} when omitted (parity with parksMap/eventMap defaulting), so the
  # selftest table and any caller that passes no merge evidence behave exactly as today.
```

**Design decision — where the merged/unrecorded split happens.** The `!audit.clean` branch (§6 of `computeDisposition`) currently folds every undispatched admitted issue into one generic `incomplete-ledger` item. **Chosen:** partition `audit.undispatched` by `mergedMap` — each undispatched issue with `mergedMap[issue] === true` becomes its own `merged-unclosed` item; the remaining undispatched issues plus `audit.invalid_outcomes` keep the generic `incomplete-ledger` item (omitted entirely when that remainder is empty). Rationale: composes with the existing audit, needs no change to `auditLedger`, and a mixed run (one merged-unclosed + one genuinely-undispatched) reports both truthfully.

**Design decision — the ceiling value on the reference wrappers.** Options: unset (status quo, 600s truncation); `=0` (wait indefinitely); a long finite value (e.g. 1800000). **Chosen:** set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` on the reference wrappers' `claude -p "/faff-beep-boop"` invocation. Rationale: the wrapper already imposes the real wall-clock bound via `timeout 300m`, so `=0` delegates the ceiling to that single outer cap rather than introducing a second, shorter, silent one that truncates legitimate slow steps; a finite value would just be a second knob to keep above worst-case. The knob and its rationale are documented so an operator setting a finite value understands the tradeoff.

## 4. HOW — Behavior

**Architecture.** Three coordinated layers over one failure mode: prevent the truncation (config), prevent the fire-and-forget wait (prose), and detect-and-distinguish when it still happens (code — the load-bearing, testable core).

**Layer A — `disposition.js` (the safety net).**

```
# impure shell (cmdDisposition), alongside the existing readParksMap / readIssueOutcomeEvents:
PROCEDURE readMergedMap(runDir, admitted):
  1. result = {}
  2. FOR each issue in admitted:
     a. IF issue is not a well-formed issue-id (e.g. /^[A-Z][A-Z0-9]*-\d+$/): skip   # trusted-input guard (see Anti-pattern)
     b. TRY read+JSON.parse <run-dir>/<issue>/merge-record.json
        i. IF parsed is an object AND parsed.merged === true: result[issue] = true
     c. CATCH (incl. SyntaxError from a truncated/partial write) / not merged: skip (omit issue)   # degrade-don't-crash, like readParksMap
  3. RETURN result

# pure core (computeDisposition), replacing the current §6 incomplete-ledger block:
PROCEDURE classify_incomplete(audit, mergedMap, items):
  1. IF audit.clean: RETURN               # nothing undispatched/invalid
  2. mergedUnclosed = audit.undispatched.filter(i => mergedMap[i] === true)
  3. remainderUndispatched = audit.undispatched.filter(i => mergedMap[i] !== true)
  4. FOR each issue in mergedUnclosed:
       items.push({ kind:"merged-unclosed", issue, outcome:null, cause:"merged-unrecorded" })
  5. names = [...remainderUndispatched, ...audit.invalid_outcomes]
  6. IF names.length > 0:
       items.push({ kind:"incomplete-ledger", issue:null, outcome:null, cause: names.join(", ") })
```

- `merged-unclosed` items are in the attention set → `disposition` is `needs-attention` (exit 1) whenever any exist, exactly as before. The run is *not* silently green.
- `renderDisposition` prints each `merged-unclosed` item via the existing loop (`kind issue (cause)`); when the shell has the PR/sha to hand (from the same merge-record read) it MAY enrich `cause` to `merged-unrecorded pr#<n> <short-sha>` so the operator sees the shipped PR at a glance. Pure-core tests assert only the `kind`/`issue`; the PR/sha enrichment is shell-side and non-load-bearing.
- `--json` output carries the new `kind` transparently (no schema gate on the attention array); the illustrative shape is in §3.

**Anti-pattern:** reading `merge-record.json` inside `computeDisposition`. Why: it would make the pure classifier do filesystem I/O, breaking the selftest's pure-function drive and the module's read-substrate-in-the-shell design.

**Anti-pattern:** treating `owner.status:"running"` as the trigger. Why: `running` is not a disposition attention signal (only `aborted-resumable` is), and a legitimately in-flight run also reads `running`; the trigger is the *audit* (admitted issue absent from `outcomes`) intersected with merge evidence.

**Trusted-input boundary (defensive).** `admitted` holds issue-ids written by the run's own agents to a run-ledger on a controlled volume, and disposition emits only a boolean + issue-id (never file contents) — so the merge-record read is a trusted-local-artifact read, the same pattern shipped in `merge-gate.js`/`post-merge.js`. The issue-id-shape guard above is belt-and-braces (reject any non-issue-id `admitted` entry before the `path.join`), not a load-bearing security control.

**Layer B — the reference drain wrappers (prevention, config).** In `operations/ci/faff-cron.sh`, set `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` in the environment of the `timeout 300m claude -p "/faff-beep-boop"` line (the outer `timeout 300m` remains the true wall-clock ceiling). Apply the equivalent in `operations/ci/l3-watcher.yml`'s drain step `env:`. Document the knob in `docs/guide/self-hosted-rig.md` (and cross-reference from `docs/guide/unattended.md`): what it is, why the drain sets it to `0`, and that the outer `timeout` is the real bound.

**Layer C — orchestration prose (prevention, behavior contract).** Harden `plugin/skills/faff-beep-boop/SKILL.md` so the run-end sequence (§11 runcheck → §11.5 reconcile → §11.6 post-merge annotations → owner-close + `record-outcome` at exit) is stated to run **synchronously in-turn**, and post-merge verification is never dispatched as a detached background task the orchestrator then merely awaits — mirroring `faff-graft/SKILL.md` §"How to actually wait for CI" ("never end a turn with a background job in flight"). The run-end forge/tracker waits stay heartbeat-bracketed and bounded per the existing wait discipline (never a single unbounded blocking call). Add a one-line forward-reference so the two prose sites agree. This is model-compliance (prose), acknowledged as such.

**Failure modes.**

- **The failure:** a run is killed *before* `merge-gate` writes `merge-record.json` (i.e. before/at the merge), so no merge evidence exists. **How you'd know:** `mergedMap` has no entry for the issue → it stays in the generic `incomplete-ledger` item. **What it means:** correct — that run genuinely did not ship; do not classify it merged-unclosed. Proceed.
- **The failure:** `merge-record.json` was left partially written / corrupt by a mid-write kill, so `JSON.parse` throws. **How you'd know:** the `CATCH` omits the issue → it falls back to the generic `incomplete-ledger` item. **What it means:** correct fail-safe — an unprovable merge must not be asserted as `merged-unclosed`; a human looks (the safe direction). Proceed.
- **The failure:** `merge-record.json` exists with `merged:true` but the squash-merge was later reverted out-of-band. **How you'd know:** merge evidence is point-in-time; disposition does not re-observe the forge (that is §11.5 reconcile's job, which does compare recorded-vs-live). **What it means:** acceptable — `merged-unclosed` is a *run-end truncation* signal, not a live-merge assertion; the live reconcile gate remains the authority on phantom/reverted merges. Narrow: keep the two concerns separate, do not add forge calls to the pure classifier.
- **The failure:** the `=0` ceiling lets a genuinely wedged background task hang. **How you'd know:** the outer `timeout 300m` fires (exit 124) and `faff disposition` still scores the truncated ledger. **What it means:** proceed — the wall-clock cap is the intended backstop; `=0` moves the ceiling to one place, it does not remove all bounds.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an admitted issue FAFF-417 with no recorded outcome in run-ledger.json
  And <run-dir>/FAFF-417/merge-record.json exists with merged:true
When faff disposition classifies the run
Then the attention set contains a merged-unclosed item naming FAFF-417
  And it contains no generic incomplete-ledger item that names FAFF-417
  And disposition is needs-attention (process exit 1)
```

```
Given an admitted issue with no recorded outcome and NO merge-record.json (killed before merge)
When faff disposition classifies the run
Then the issue appears in a generic incomplete-ledger item (never merged-unclosed)
  And disposition is needs-attention
```

```
Given an admitted issue with no recorded outcome and a corrupt/partial merge-record.json (JSON.parse throws)
When faff disposition classifies the run
Then the issue appears in a generic incomplete-ledger item (never merged-unclosed)
  And no exception escapes the classifier
```

- The `disposition --selftest` fixture table exercises these against the pure `computeDisposition` (adding the `mergedMap` argument to each existing case as `{}`, plus the new cases).

## 6. Design Decision Rationale

**Where does merge evidence get read?** Options: inside the pure classifier vs in the impure shell as a substrate. **Chosen:** the shell (`readMergedMap`), passed into `computeDisposition` as a new arg. Rationale: preserves the pure-function selftest and the module's established substrate pattern; the pure core never touches the filesystem.

**Distinct kind vs a flag on the existing item?** Options: a boolean on `incomplete-ledger` vs a first-class `merged-unclosed` kind. **Chosen:** a first-class kind. Rationale: the render loop, `--json` consumers, and an operator scanning `drain.sh` output all key on `kind`; a distinct kind is the legible signal the issue asks for, and it composes with a residual generic item on mixed runs.

**Ceiling `=0` vs finite.** Chosen `=0` (see §3). Rationale: single outer `timeout` cap; no second silent ceiling.

**Recover, or only detect?** Options: auto-close the ledger vs surface a distinct signal only. **Chosen (this slice):** detect + distinguish only; auto-close is Punted. Rationale: detection strictly improves operator legibility without touching write-authority invariants; auto-close is a contestable, architecturally-significant step that a human should sign off (§7).

## 7. Open Questions and Assumptions

**Open Questions.**

- **Punt (decides: architecture):** Should any headless path auto-close a merged-but-unclosed ledger — write `record-outcome shipped` + `owner.status:"done"` (and run the pending `post-merge-check`) so the drain reaches a terminal `shipped` state without manual reconciliation? This must reconcile with (a) `disposition`'s pure/read-only contract, (b) the ledger's "only the run's own agents write `owner.status`" authority, and (c) the risk of masking a real post-merge regression. Deferred to a follow-up; this spec ships detection only. A reviewer can decide this without re-reading the spec: it is purely "detect-only now, or also auto-recover?".

**Assumptions.**

- **Assumes:** the production `fly-ci-l3-runner` deployment (`drain.sh`/`entrypoint.sh`, outside this repo) will receive the equivalent `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` setting by an operator. Validation: the build agent notes this as a required operational follow-up in the PR description; the in-repo reference wrappers + docs are the source the operator mirrors. This repo's PR alone does not fix the live runner.
- **Assumes:** `merge-gate` writes `<run-dir>/<issue>/merge-record.json` with a top-level `merged:true` on the merge-ok path. Validation: confirmed in `merge-gate.js` (`writeMergeRecord`, record `{pr, head_sha, merged:true, merged_at, integrity}`); the build agent re-checks the field name before relying on it.

## 8. DONE — Definition of Done

### From WHY
- [ ] After a truncated-post-merge run, `faff disposition` reports a state distinguishable from a genuine build failure for the merged issue.

### From WHAT / HOW (disposition — Layer A)
- [ ] `computeDisposition` accepts a `mergedMap` argument (defaulting to `{}`), and the shell gathers it via a `readMergedMap(runDir, admitted)` that guards on issue-id shape and degrades to omission on absent/unreadable/malformed/truncated/`merged!=true`.
- [ ] An admitted-but-unrecorded issue whose `merge-record.json` has `merged:true` produces a `merged-unclosed` attention item naming that issue.
- [ ] Such an issue is NOT also named in the generic `incomplete-ledger` item; a residual `incomplete-ledger` item appears only for genuinely-undispatched issues and invalid outcomes, and is omitted when that remainder is empty.
- [ ] A corrupt/partial `merge-record.json` (JSON.parse throws) fails safe to the generic `incomplete-ledger` item; no exception escapes the classifier.
- [ ] `merged-unclosed` is in the attention set → `disposition` exits 1 (needs-attention) when any exist.
- [ ] `renderDisposition` and `--json` emit the new kind without error; no filesystem I/O was added to the pure `computeDisposition`.
- [ ] `disposition --selftest` (and `test/disposition.test.mjs`) cover: merged-unclosed alone, undispatched-without-merge-record, corrupt-record fail-safe, and the mixed case; all existing cases pass with the added `mergedMap` arg.

### From HOW (reference wrappers — Layer B)
- [ ] `operations/ci/faff-cron.sh` sets `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` on the drain `claude -p` invocation, with the outer `timeout 300m` retained.
- [ ] `operations/ci/l3-watcher.yml`'s drain step sets the equivalent env.
- [ ] `docs/guide/self-hosted-rig.md` documents the knob + rationale; `docs/guide/unattended.md` cross-references it.

### From HOW (orchestration prose — Layer C)
- [ ] `faff-beep-boop/SKILL.md` states the run-end reconcile + post-merge + owner-close sequence runs synchronously in-turn (heartbeat-bracketed, bounded) and is never left as a fire-and-forget background wait, cross-referencing graft's "How to actually wait for CI".

### From OUT OF SCOPE / Open Questions
- [ ] No auto-close/auto-recovery behavior is added; the auto-close question is recorded as an architectural Punt (a follow-up ticket or a tracker note references it).

**Integration smoke test.**

```
1. Mint a run dir with run-ledger.json: admitted:["FAFF-417"], outcomes:{}, owner.status:"running".
2. Write <run-dir>/FAFF-417/merge-record.json = {pr:641, head_sha:"abc123", merged:true}.
3. Run: faff disposition --run-dir <run-dir> --json
4. Expect: attention[] contains {kind:"merged-unclosed", issue:"FAFF-417"}, no incomplete-ledger naming FAFF-417, top-level disposition "needs-attention", process exit 1.
```

confidence: medium
build-tier: complex
spec-review: approve