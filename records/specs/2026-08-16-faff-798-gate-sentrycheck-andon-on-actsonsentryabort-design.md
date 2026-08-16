# FAFF-798 — Gate the sentrycheck andon page on `actsOnSentryAbort` (and record two open starvation questions)

> Spec: faffter-dark-nlspec · 2026-08-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-798.
> build-tier: complex

This is the buildable spec for FAFF-798, "Sentry wall-clock-runaway false-positives on live interactive/graft runs (heartbeat starvation)". It is written for the build agent that will land the fix, and for the human reviewers who must resolve the two open design questions this ticket also records. The ticket names three defects; this spec makes **defect #3 the buildable core** — a self-contained, one-file gate change with clear test seams — and carries **defects #1 and #2 as explicit open questions (`**Punt:**`)** that need a human design call before they can be built. See _Open Questions_ for why #1 and #2 are punted rather than solved here, and the note that each likely warrants its own follow-up ticket.

## 1. WHY — Problem and Principles

**The load-bearing model.** A Sentry "trip" is a detection, not an action. Whether faff *does* anything about a trip — aborts the run, pages the operator — is a separate, attendedness-gated decision answered by one pure predicate, `actsOnSentryAbort(ledger, cfg)`: it is true only for an L4 run or a config-declared-unattended run, and false for an attended/advisory run (L2/L3 with no unattended declaration). The detached poller already honours this split — it only pages when it also acts. The `sentrycheck` Stop-hook does not: it pages on *any* confirmed foreign trip. This fix makes `sentrycheck` symmetric with the poller.

**Problem statement.** Today a live interactive/graft session whose heartbeat has gone stale can trip Sentry's wall-clock-runaway check, and `sentrycheck`'s Stop-hook (fired from an *unrelated* session's turn-end) pages `faff andon send --class sentry-trip` even though the run is attended and *nothing acts on the trip* — an operator-visible andon push on a live interactive graft session that no automation will ever action. The fix gates the andon page on `actsOnSentryAbort(ledger, cfg)`, so an advisory-only trip surfaces the existing stderr notice but never pages. The stale-heartbeat *root cause* on interactive runs (why the trip fires at all) is a separate, undecided design question and is recorded here as a punt, not fixed.

**Design principles** (each would reject an otherwise-valid implementation):

**Page only when something acts.** The andon page is a call to a human to intervene. If no code path will act on the trip (attended/advisory run), paging is a false alarm. The gate predicate is `actsOnSentryAbort`, mirroring the poller — not a re-derived attendedness check.

**Never silence the advisory.** The stderr `trippedNotice` is diagnostic, not an action, and already states "Nothing was acted on from this session." It must keep firing on *every* confirmed trip regardless of attendedness. Only the andon *page* is gated. Gating the notice would hide a real detection from a human reading the terminal.

**Fail-safe toward silence.** A config-load fault must resolve to "do not page" for a non-L4 run, never "page anyway". `actsOnSentryAbort` reads `cfg` only after the L4 short-circuit, so an empty `cfg` (the fault fallback) yields `false` for a non-L4 run — the safe direction, since advisory runs should not page. **Note the fail-safe *kind* differs from the poller's:** the poller's conservative direction is "don't *act*" (never strand WIP), whereas this hook's is "don't *alert*". The weaker signalling is acceptable because the unconditional stderr `trippedNotice` (line 171) remains as the retained alerting floor for every trip, and the poller still acts+pages for genuinely unattended runs — so the only residual exposure is a *declared-unattended* run whose config read transiently faults being demoted to stderr-only for that one tick.

**Preserve the L4 kill-switch's config-independence.** `actsOnSentryAbort` short-circuits on `ledger.level === "L4"` *before* it ever reads `cfg` (lazy `||`). A config fault can never regress the L4 acting/paging path. Do not restructure the predicate or the cfg load in a way that reads cfg first.

**Reference context.** The fix mirrors an existing, tested oracle and reuses two exported pure helpers:

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentrycheck.js` (`cmdSentrycheck`, lines 139-193) | JavaScript (Node) | The Stop-hook being fixed; the andon page lives at lines 177-191 |
| `plugin/skills/faff/bin/lib/sentry-poller.js` (lines 243-246, 285-318) | JavaScript (Node) | The oracle: loads `cfg` and only emits sentry-trip + pumps andon inside its `action === "abort"` branch (gated on `actsOnSentryAbort`) |
| `plugin/skills/faff/bin/lib/sentry.js` (`actsOnSentryAbort`, lines 213-215; exported 1563) | JavaScript (Node) | The pure gate predicate; `declaredUnattendedFromConfig` reads `autonomous.unattended` or the `autonomous.sentry_acting` alias |
| `plugin/skills/faff/bin/lib/budget.js` (`readGovernanceConfig`, exported) | JavaScript (Node) | Loads governance config from the run root; the fault seam wrapped in try/catch |
| `test/sentrycheck.test.mjs` (FAFF-472 block, lines 260-342) | JavaScript (Node test) | The andon-page test seam; loopback HTTP server records andon POSTs |
| `test/sentry-poller.test.mjs` (line 271) | JavaScript (Node test) | The mirror oracle's test: attended-L3 + stale heartbeat → no abort, advisory-trip logged, no andon pump |

**Scope statement.** This sits at the ASSIST Stop-hook locus (ADR-0065), the cheap sibling of the detached poller; the change is confined to the andon-page branch of `cmdSentrycheck` plus its tests.

## 2. OUT OF SCOPE

- **Interactive/graft heartbeat starvation (defect #1)** — Why excluded: the fix requires an undecided design call (should interactive runs advance a heartbeat, or be marked non-running/attended on operator handoff?). Extension point: `heartbeat.js` (the sole heartbeat writer) and `run-ledger.js:165` (`init-interactive`, which stamps `started_at = last_heartbeat = now`, `status:"running"` and mints no ticker). Recorded as a punt in _Open Questions_; likely its own ticket.
- **Unscoped run resolution (defect #2)** — Why excluded: also an undecided design call (should a checker/runner with its own run context refuse to adopt a foreign `latestRunDir`?). Extension point: `sentrycheck.js:129-137` (`resolveSentryRunDir`) and `sentry.js:876-878` (`latestRunDir` adoption). Recorded as a punt; likely its own ticket.
- **The stderr `trippedNotice`** — Why excluded: it is an advisory, not an action, and must keep firing on every trip (see the "Never silence the advisory" principle). Extension point: `sentrycheck.js:105-112` — untouched by this fix.
- **Sentry's wall-clock-runaway threshold / `stall_window_secs`** — Why excluded: this fix does not retune detection; it gates the *response* to a detection. The recent `stall_window_secs` bump (FAFF-795) is orthogonal. Extension point: `sentry.js` threshold config.
- **The poller's andon path** — Why excluded: it is already correctly gated; it is the oracle this fix mirrors, not a target. Extension point: `sentry-poller.js:285-318`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| trip | A confirmed Sentry detection (`payload.tripped === true` from the consult child). |
| advisory trip | A trip on a run where nothing acts — `actsOnSentryAbort` is false. Surfaces stderr, must not page. |
| acting run | A run where `actsOnSentryAbort` is true — L4, or config-declared-unattended. |
| the page | The `faff andon send --class sentry-trip` call at `sentrycheck.js:177-191`. |
| the advisory / notice | The `trippedNotice` stderr line (`sentrycheck.js:105-112`), emitted at line 171. |

**The gate predicate** (existing, pure, exported — do not modify):

```
FUNCTION actsOnSentryAbort(ledger, cfg) -> Boolean:
  RETURN (ledger != null AND ledger.level == "L4")   # L4 short-circuit, cfg not read
         OR declaredUnattendedFromConfig(cfg)          # reads autonomous.unattended OR autonomous.sentry_acting
```

**Inputs at the andon call site.** `ledger` (read at `sentrycheck.js:150-151`, heartbeat overlaid at 156) and `runDir` are already in scope. `findRoot(runDir)` is already imported from `./shared-infra` and already called at line 189. **Missing:** `cfg`. It must be loaded exactly as the poller loads it.

**Net-new requires in `sentrycheck.js`** (it currently imports neither):

```
const { actsOnSentryAbort } = require("./sentry");
const { readGovernanceConfig } = require("./budget");
```

**Design decision — how the gate is expressed.**

- Option A: gate on `actsOnSentryAbort(ledger, cfg)`, loading cfg the way the poller does. Mirrors the tested oracle; one predicate, one meaning across both loci.
- Option B: re-derive an attendedness check inline at the hook. Duplicates the L4-first short-circuit logic; risks divergence from the poller and from `actsOnSentryPause`.

**Chosen:** Option A — gate the andon page on `actsOnSentryAbort(ledger, cfg)`, consuming the exported predicate and loading cfg exactly as `sentry-poller.js:243-246` does `(decides: architecture)`. Rationale: the poller already proves this is the correct locus for the split, and "consume, never re-derive" is the module's stated design principle (ADR-0065).

## 4. HOW — Behavior

**Behavior summary.** `cmdSentrycheck` reaches the andon block only when the consult returned a genuine trip. The change adds one cfg load and wraps *only* the `andon send` block in an `if (actsOnSentryAbort(ledger, cfg))` guard, leaving the unconditional stderr advisory (line 171) untouched.

```
PROCEDURE cmdSentrycheck (fixed region, from the tripped branch onward):
  ... (unchanged up to and including line 171)
  1. process.stderr.write(trippedNotice(runId, runDir, outcome.payload))   # UNCHANGED — every trip, always
  2. root <- findRoot(runDir)                                              # NEW: hoist to a local (was computed at line 189)
  3. cfg <- {}                                                             # NEW: fail-safe default
     TRY cfg <- readGovernanceConfig(root)
     CATCH cfg <- {}                                                       # base-parse-error / legacy-name / any fault -> fail-safe OFF
  4. IF actsOnSentryAbort(ledger, cfg):                                    # NEW gate — page only when something acts
       TRY:
         payload  <- outcome.payload OR {}
         signals  <- payload.verdicts (joined) OR "unknown"
         spawnSync(faff andon send --class sentry-trip
                   --title "faff <runId>: sentry tripped (<payload.intervention>)"
                   --body  "signals: <signals> — run looks abandoned (heartbeat stale)"
                   --run-dir <runDir> --root <root>)                       # reuse the hoisted root
       CATCH: (best-effort — fail-open telemetry, never affects the exit-0 contract)
  5. RETURN 0
```

**Fallback / precedence.**
- cfg-load fault → `cfg = {}` → `actsOnSentryAbort` is false for a non-L4 run → no page (safe). For an L4 run the predicate short-circuits true *before* cfg is read, so the L4 page still fires.
- Every existing best-effort/fail-open property of the andon `spawnSync` is preserved; the guard wraps it, it does not replace the try/catch.

**Wording — no change required.** The page title at line 186, `faff ${runId}: sentry tripped (${payload.intervention})`, interpolates the intervention *dynamically* — it is not hardcoded "(abort)". Under this fix the page fires only when acting, so the wording is already accurate; leave it as-is. (The ticket's "hardcoded (abort)" framing was slightly off — noting the correction so the build agent does not chase a wording change that isn't needed.)

**Anti-pattern:** loading cfg before the L4 check, or folding cfg into the predicate's first operand. Why: it would let a config fault regress the L4 kill-switch — the exact regression `actsOnSentryAbort`'s lazy `||` is structured to prevent (ADR-0034 un-subvertable-by-construction).

**Anti-pattern:** gating or suppressing `trippedNotice`. Why: the advisory is a diagnostic a human may be reading live; silencing it hides a real detection and violates the "Never silence the advisory" principle.

**Anti-pattern:** computing `findRoot(runDir)` twice (once for the cfg load, once at the `andon send --root`). Why: redundant filesystem walk; hoist it to one local and reuse.

### Failure modes

- **The failure:** `readGovernanceConfig` needs a *root*, and if `findRoot(runDir)` resolves a root whose `.faffrc.yaml` legitimately declares `autonomous.unattended: true` for a run that is in fact attended-interactive, the gate would page. **How you'd know:** an andon page fires on an interactive session whose config declares unattended. **What it means:** proceed — this is correct behaviour, not a bug: a config that declares unattended has armed acting, so paging is intended. The false-positive this ticket targets is the *attended, non-declared* case, which the gate correctly silences.
- **The failure:** the consult child (`faff sentry check`) itself reads a different attendedness signal than `actsOnSentryAbort`, so a run could trip yet the gate disagree with the poller. **How you'd know:** the sentry-poller mirror test (`test/sentry-poller.test.mjs:271`) and the new sentrycheck advisory test would disagree on the same fixture. **What it means:** narrow — both loci must consume the *same* `actsOnSentryAbort(ledger, cfg)`; the tests are written symmetrically precisely to catch divergence.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a foreign run whose ledger is owner.status "running" with a stale heartbeat, no `level` field, and a config that declares neither autonomous.unattended nor the sentry_acting alias
And a sentry consult that returns tripped:true (wall-clock-runaway)
When the sentrycheck Stop-hook runs from another session's turn-end
Then the trippedNotice advisory is written to stderr
And no andon notification is sent (posts.length == 0)
And the hook exits 0
```

```
Given the same stale, tripped foreign run but with ledger.level "L4" (or a config declaring autonomous.unattended: true)
When the sentrycheck Stop-hook runs
Then the trippedNotice advisory is written to stderr
And exactly one andon notification is sent (posts.length == 1), carrying the run id and the observed signal
And the hook exits 0
```

- A cfg-load fault on a non-L4 tripped run resolves to no page (`actsOnSentryAbort` false on empty cfg), while the stderr advisory still fires.

## 6. DESIGN DECISION RATIONALE

**Where to gate: consume `actsOnSentryAbort` vs re-derive attendedness inline.**
- Consume the exported predicate: single source of truth shared with the poller and with `actsOnSentryPause`; L4-first short-circuit preserved for free.
- Re-derive inline: no new require, but duplicates subtle short-circuit logic and invites divergence.
- **Chosen:** consume `actsOnSentryAbort(ledger, cfg)` — the module's "consume, never re-derive" principle (ADR-0065) is decisive, and the poller already validates this exact call shape.

**How to load cfg: mirror the poller's try/catch-to-`{}` vs let a fault propagate.**
- Mirror the poller (`let cfg = {}; try { cfg = readGovernanceConfig(findRoot(runDir)); } catch { cfg = {}; }`): a config fault fails safe toward silence for non-L4; the hook keeps its always-exit-0 contract.
- Let it propagate: a config fault would throw inside a Stop-hook, risking an exit-code or a lost advisory.
- **Chosen:** mirror the poller's fault-swallow to `cfg = {}`. Rationale: fail-safe direction is "do not page", and the hook must never throw.

**What to gate: the page only vs the page and the advisory.**
- Gate the page only: keeps the diagnostic visible, silences only the false alarm.
- Gate both: hides a real detection from a human at the terminal.
- **Chosen:** gate the `andon send` block only (lines 177-191); leave `trippedNotice` unconditional at line 171.

At the time of writing, `actsOnSentryAbort` reads exactly two acting signals (`ledger.level === "L4"`, and `declaredUnattendedFromConfig` over `autonomous.unattended` / `autonomous.sentry_acting`); if the acting model gains a third signal later, both the poller and this hook inherit it for free by sharing the predicate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

**Punt:** Defect #1 — interactive/graft heartbeat starvation. Interactive graft mints an L2 ledger via `faff run-ledger init-interactive` (`run-ledger.js:165`), stamping `started_at = last_heartbeat = now`, `status:"running"`. `faff heartbeat` (`heartbeat.js`) is the *only* writer of the heartbeat file, and every caller is marked "autonomous only" (faff-graft Steps 7.5/9/CI, beep-boop, concurrency skills). The interactive path has *no* ticker, so after `stall_window_secs` any Sentry eval sees a live session as stale. Open design question: **should interactive/graft runs advance a heartbeat, or be marked non-running/attended when handing off to the operator?** Related: FAFF-234. Note: the FAFF-553 in-flight grace (`sentry.js:671-693`) does *not* apply here — zero in-flight members. This needs a human decision and likely its own ticket once decided. `(decides: architecture)`

**Punt:** Defect #2 — unscoped run resolution. A checker/runner invoked with no `--run-dir` resolves `latestRunDir` (`sentrycheck.js:129-137`, `sentry.js:876-878`) and can adopt a stale/idle graft ledger instead of its own run. Open design question: **should resolution refuse to adopt a foreign run when the caller has its own run context?** This needs a human decision and likely its own ticket once decided. `(decides: architecture)`

Why #1 and #2 are punted here: defect #3 is decided, self-contained, and testable; #1 and #2 each hinge on a design call the human has not made. Building #3 now removes the operator-visible false page without waiting on those calls; forcing an answer to #1/#2 into this spec would be inventing decisions. After the punts are resolved, #1 and #2 should each be split into their own tickets.

**Assumptions.**

**Assumes:** `actsOnSentryAbort` is exported from `./sentry` and `readGovernanceConfig` from `./budget`. Validate before starting: `grep -n "actsOnSentryAbort\|readGovernanceConfig" plugin/skills/faff/bin/lib/sentry.js plugin/skills/faff/bin/lib/budget.js` should show both in the respective `module.exports` (confirmed at `sentry.js:1563` and `budget.js` exports at authoring time).

**Assumes:** the FAFF-472 test block in `test/sentrycheck.test.mjs` still uses a loopback HTTP server recording andon POSTs into a `posts` array, with `rootWith(...)` minting the ledger fixture. Validate: read `test/sentrycheck.test.mjs` lines 260-342 and confirm the `loopbackServer` / `posts` / `rootWith` helpers before editing fixtures.

## 8. DONE — Definition of Done

### From WHY
- [ ] An attended/advisory tripped run (running, stale heartbeat, no `level`, no unattended/sentry_acting config) no longer pages andon; the operator-visible false page on live interactive graft is gone.
- [ ] The stderr `trippedNotice` still fires on every confirmed trip regardless of attendedness (advisory never silenced).

### From WHAT (types and interfaces)
- [ ] `sentrycheck.js` requires `actsOnSentryAbort` from `./sentry` and `readGovernanceConfig` from `./budget` (net-new; neither imported before).
- [ ] `cfg` is loaded via `readGovernanceConfig(findRoot(runDir))` inside a try/catch that falls back to `cfg = {}` on any fault.
- [ ] `findRoot(runDir)` is hoisted to a single local reused by both the cfg load and the `andon send --root` argument (no double computation).

### From HOW (behaviour)
- [ ] Only the `andon send` block (`sentrycheck.js:177-191`) is wrapped in `if (actsOnSentryAbort(ledger, cfg)) { ... }`; the stderr advisory at line 171 is outside the guard.
- [ ] The page title at line 186 is left unchanged (dynamic `${payload.intervention}` interpolation, already accurate under the gate).
- [ ] The andon `spawnSync` keeps its best-effort try/catch and the hook's always-exit-0 contract.

### From HOW (edge cases)
- [ ] An L4 tripped run still pages, even when `readGovernanceConfig` throws (L4 short-circuit before cfg read).
- [ ] A config-declared-unattended (or `sentry_acting` alias) tripped run pages.
- [ ] A cfg-load fault on a non-L4 tripped run does not page, but still writes the advisory.

### From tests
- [ ] `test/sentrycheck.test.mjs`: the existing "still pages" fixtures (FAFF-472 block — the `posts.length === 1` test at line 266 and the delivery-attempted test at line 309) are updated so their ledgers set `level:"L4"` (or their `.faffrc.yaml` declares `autonomous.unattended: true`), so they continue asserting a page under the gate.
- [ ] A NET-NEW test asserts the advisory case: a running + stale + tripped fixture with no `level` and no acting config → `trippedNotice` stderr line is present AND `posts.length === 0`. (This L2/advisory → no-andon assertion does not exist today; it is the primary new coverage.)
- [ ] The new sentrycheck advisory test reads symmetrically to the poller oracle at `test/sentry-poller.test.mjs:271` (attended-L3 stale → no act/no page, advisory logged).
- [ ] A test covers the **config TRUE disjunct**: a running + stale + tripped fixture with no `level` but whose `.faffrc.yaml` declares `autonomous.unattended: true` → `posts.length === 1` (the declared-unattended run still pages). Mirrors the poller oracle at `test/sentry-poller.test.mjs:297`. Without this the `declaredUnattendedFromConfig(cfg)` half of the gate ships unverified.
- [ ] A test covers the **cfg-fault fail-safe**: `readGovernanceConfig` throws (e.g. a malformed base `.faffrc.yaml`) on a running + stale + tripped **non-L4** fixture → `cfg = {}` → `posts.length === 0` AND the `trippedNotice` stderr line is present. Confirms the try/catch → `{}` path fails safe toward silence, not toward paging.
- [ ] The existing "non-tripped consult (ok) never pages" test (line 325) still passes unchanged.

### Integration smoke test
```
1. rootWith(): mint a foreign run ledger, owner.status "running", stale started_at/last_heartbeat, NO level, no autonomous config
2. Start the loopback andon server; write .faffrc.yaml with andon.url pointing at it
3. Run: faff sentrycheck --hook --root <root>   (FAFF_RUN_DIR="", FAFF_SESSION_ID="")
4. Assert: exit 0; stderr matches /\[warn\] faff sentrycheck: latest run .* looks abandoned/; posts.length === 0
5. Re-run with the fixture's ledger.level set to "L4"
6. Assert: exit 0; same advisory stderr; posts.length === 1, body carries the run id and the wall-clock-runaway signal
```

confidence: high
spec-review: approve

_Prep: interactive · spec slot faffter-dark-nlspec · build-tier complex · spec-review approve (revise→approve, 2 rounds) · 2 open punts (defects #1, #2) recorded for follow-up._
