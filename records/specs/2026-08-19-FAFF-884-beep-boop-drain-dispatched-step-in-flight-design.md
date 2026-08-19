# Spec — FAFF-884: a drain must not end a turn with a dispatched Agent step in flight

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-884.

_Revised 2026-08-19 — the sole open Punt (marker-write mechanism) was resolved interactively to the prose-managed write (section 6); re-rated to confidence: high._

This is the buildable spec for FAFF-884, a bug ticket in the project "A current unattended run survives executor loss at safe boundaries". The audience is the build agent that will implement the fix and the human reviewer who gates it. The ticket's own explore pass is folded in with file paths and line numbers; every codebase claim below traces to that pass or to a file read while drafting.

## 1. WHY — problem and principles

**The load-bearing model.** A headless `claude -p` drain has no scheduler. When the model ends a turn, the cage process exits; anything the drain left running in the background dies with it. The drain's only safety net at turn boundaries is the Stop-hook family: three hooks (`runcheck`, `prepcheck`, `sentrycheck`) that fire at turn-end, read an externalised on-disk marker, decide whether the current session owns it and whether it is still live, and emit `{"decision":"block", reason}` to refuse the turn-end when the owning session has unfinished work. The fix adds a fourth hook of the same shape whose marker tracks one thing the existing three do not: an Agent-tool dispatch that is in flight right now.

**Problem statement.** An L4 lights-out drain can dispatch a mandatory in-turn step (observed: a spec-review re-run) as a backgrounded Agent call and then end its turn on a progress report ("the re-run is now underway in the background ... I'll pick up when it completes"). Under headless `claude -p` the turn-end exits the cage, the backgrounded Agent dies, and the run ledger is left holding `owner.status: "running"` with a fresh heartbeat and no live process, with no `summary.md` and nothing wrong that `faff disposition` can see. The fix installs a mechanical turn-end check over the orchestrator's Agent-dispatch arm so the owning session cannot end a turn while a dispatched step is still outstanding.

**Design principles.**

**Per-dispatch, never a global flag.** The parallel build executor (`faffter-dark-concurrency-parallel/SKILL.md` line 33) deliberately puts N Agent dispatches in flight at once and holds the turn open with a foreground await-all poll (line 47). Any marker this fix introduces must be keyed per dispatch, so N legitimate concurrent dispatches produce N independent open markers, not a single boolean that trips on the second dispatch. A global marker would break the one existing multi-dispatch-in-flight pattern the moment it runs.

**The Stop hook is the mechanical floor; the marker lifecycle is a prose seam, bounded on purpose.** A Stop hook cannot observe an Agent tool-result event, so writing a marker at dispatch and clearing it on return is an orchestrator-prose obligation. This is the same shape as `prepcheck`, where a marker is written at spec-produce time and flipped on attach by prose, and the Stop hook catches a forgotten flip. The mechanical guarantee is narrow and honest: the hook refuses turn-end whenever an owned marker is still open. It does not guarantee the marker was written; that boundary is examined in Failure modes, and the choice to leave the write prose-managed rather than mechanical is settled in section 6.

**Never trap a non-owning session.** The fix inherits the FAFF-205 to FAFF-235 ownership and liveness precedence unchanged (owned and outstanding hard-blocks; a foreign live owner stays silent; a foreign abandoned-looking run gets a non-blocking stderr warning; `--recover` forces a foreign abandoned run to block). An interactive session that owns nothing is never blocked.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/runcheck.js` | JavaScript (Node) | Stop hook to mirror; source of the shared `runIsOwned` / `runIsHeld` helpers (lines 99-105, 134-143) |
| `plugin/skills/faff/bin/lib/prepcheck.js` | JavaScript (Node) | The exact write-marker / flip-by-prose / audit-at-turn-end parallel the fix follows |
| `plugin/skills/faff/bin/lib/sentrycheck.js` | JavaScript (Node) | Precedent for a fourth Stop hook that imports the shared ownership/liveness helpers (line 33) |
| `plugin/skills/faff/bin/lib/background-fence.js` | JavaScript (Node) | The house selftest convention a regression test follows (lines 189-320); the PreToolUse fence that structurally cannot see this strand |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | JavaScript (Node) | Stop-hook registrar; `FAFF_STOP_HOOKS` (line 23), selftest fixtures (lines 351-368) |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript (Node) | The anchor-phrase lint (lines 731-741) and `SKILL_LINE_BASELINE` (line 57) |
| `plugin/skills/faff-prep/SKILL.md` | Markdown (skill prompt) | Home of the spec-review Agent dispatch (line 120), where the marker lifecycle prose lives |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown (skill prompt) | Home of the Turn-survival invariant (line 537); a `SKILL_LINE_BASELINE` ratchet file |

**Scope statement.** This change sits in the Stop-hook family and the skill-authoring lint, one altitude above the existing build-subagent `background-fence`; it is a mechanical floor under the already-written turn-survival doctrine, not a new policy.

## 2. Out of scope

- **FAFF-854 — L4 drain waits out an adversarial spec-review outage.** Why excluded: it owns the provider-outage question (bounded in-turn retry of the adversarial fan-out, a `review-outage-held` outcome, a prep-side foreground-to-terminal clause), a human decision has parked it, and this ticket owns only the rule that a turn may not end with a step pending whatever the reason. Extension point: FAFF-854's prep-side clause layers onto the same `faff-prep/SKILL.md` spec-review-gate subroutine (line 120) this fix edits.
- **A launcher-side resume loop.** Why excluded: `operations/ci/l4-watcher.yml` (FAFF-606, Done) already runs that shape (classify newest run with `faff lights-out --resume <id> --check`, resume on exit 0, mint on exit 2). Extension point: adopting the watcher is deployment, not build.
- **Shortening the heartbeat staleness window.** Why excluded: `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (900s, `shared-infra.js` line 28) is a single source shared with `governance-profile.js`; changing it is a separate decision. Extension point: `shared-infra.js` line 28.
- **Provider-outage retry policy, backend chains, review-outcome semantics.** Why excluded: owned by FAFF-854 and the adversarial-review slot. Extension point: `faffter-dark-adversarial-review` / `faffter-dark-spec-review`.
- **Faster-than-900s detection of a stranded run.** Why excluded: the ticket names it as residual cost, not a proposed change. Covered in Failure modes as the known recovery-latency dependency, not fixed here.

## 3. WHAT — vocabulary, types, and the lint interface

**Vocabulary.**

| Term | Definition |
|---|---|
| In-flight marker | A per-dispatch on-disk file recording that one Agent-tool dispatch is outstanding right now: written immediately before the Agent call, removed immediately after its tool result is consumed |
| Dispatch key | The stable identifier that names one marker, shared by the write site and the clear site so the right marker is removed. The issue id where the dispatch is per-issue (a spec-review re-run, a build); otherwise a caller-supplied dispatch id |
| `inflightcheck` | The new Stop hook plus its marker-lifecycle CLI modes; the fourth member of the Stop-hook family |
| Anchor-phrase lint | The `validate-adapters.js` check that asserts a skill's prompt literally contains named turn-survival phrases, so the prose cannot silently regress |

**Marker record.** The marker mirrors the `prepcheck` owner-block shape (`prepcheck.js` `prepIsOwned`, lines 108-115, keys on `marker.owner.run_dir` / `marker.owner.session_id`).

```
RECORD InflightMarker:                       # file: .faff/inflight/<owner-scope>/<dispatch-key>.json
  key: String                                # the dispatch key; also the file basename, immutable; constrained charset (below)
  describe: String                           # short human label of what is dispatched (for the block reason)
  opened_at: Timestamp                        # ISO-8601, set at write; the stale-marker sweep reads this
  owner:
    run_dir: Path | null                      # FAFF_RUN_DIR at write time, or null when unset
    session_id: String | null                 # FAFF_SESSION_ID at write time, or null when unset

  # owner-scope — the load-bearing infosec change: the owner identity is encoded IN THE PATH (subdirectory),
  #   not only in the body. owner-scope := slug(FAFF_RUN_DIR) when set, else slug(FAFF_SESSION_ID) when set, else "local".
  #   This restores runcheck's out-of-band ownership property: a corrupt or unparseable body still resolves ownership
  #   from the path, so a malformed-but-owned marker is provably owned and fails closed (blocks) rather than fails open.
  # slug(s) := <sanitised>-<hash8>, where <sanitised> replaces every run of chars outside [A-Za-z0-9_-] with "-"
  #   (so no "/" or ".." survives into the path) and <hash8> is the first 8 hex of a stable hash of the FULL original s.
  #   The hash suffix makes slug injective: two distinct run dirs never collide onto one owner-scope, which would
  #   otherwise misclassify a foreign marker as owned (a false-positive turn-end block). slug is pinned as tightly as key.
  CONSTRAINT file EXISTS  <=>  a dispatch under this key is outstanding
  CONSTRAINT key MATCHES ^[A-Za-z0-9_-][A-Za-z0-9._-]*$   # no path separators, no "..", no LEADING dot; rejected at --open / --close
  # the leading-dot exclusion is load-bearing: a ".foo" key writes ".foo.json", a dotfile the --hook `*.json` glob skips,
  #   hiding an owned open marker into a fail-open silent strand. Forbidding a leading dot closes that; the --hook read is
  #   also made dotfile-inclusive as defence in depth, so neither layer alone is the sole guard.
```

**`inflightcheck` command surface.** One command, one `COMMANDS` registry entry (`plugin/skills/faff/bin/faff`, single-source registry per ADR-0014), following the runcheck/prepcheck shape.

```
faff inflightcheck --open  --key <k> [--describe <text>]   # write .faff/inflight/<owner-scope>/<k>.json (owner-scope from env); reject <k> off ^[A-Za-z0-9_-][A-Za-z0-9._-]*$
faff inflightcheck --close --key <k>                        # remove this session's .faff/inflight/<owner-scope>/<k>.json (idempotent; absent = success); same key check
faff inflightcheck --hook                                   # Stop-hook audit: read stdin JSON, sweep stale owned markers (dotfile-inclusive read), emit {"decision":"block", reason} or exit silently
faff inflightcheck --selftest                               # pure fixture-table selftest, ok/FAIL rows + RESULT footer
faff inflightcheck --root <dir>                             # accepted-and-ignored no-op, as background-fence.js does (probeServes calls it)
```

`--open` and `--close` reject any `--key` off `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (no path separators, no `..`, no leading dot) before touching the filesystem, so a caller-supplied dispatch id can never escape `.faff/inflight/<owner-scope>/` nor write a dotfile the `--hook` glob would skip.

**Anti-pattern:** a single global marker file. Why: the parallel executor legitimately holds N dispatches open at once (`faffter-dark-concurrency-parallel/SKILL.md` line 47); a global file trips on the second dispatch even though the await-all gate is holding the turn open correctly.

**The anchor-lint interface.** The current lint is a hard-coded single-name branch (`validate-adapters.js` lines 731-741): `if (name === "faff-graft")` asserting three case-insensitive substrings (`run_in_background: true`, `never end a turn`, `foreground-to-terminal`). The fix replaces the branch with a data-driven per-skill map.

```
# Replaces the `name === "faff-graft"` branch. Each entry: skill name -> required case-insensitive substrings.
ANCHOR_PHRASES = {
  "faff-graft":     ["run_in_background: true", "never end a turn", "foreground-to-terminal"],   # unchanged
  "faff-beep-boop": ["never end a turn", "in-flight marker"],
  "faff-prep":      ["never end a turn", "in-flight marker"],
}
PROCEDURE lint_anchor(name, text):
  1. phrases := ANCHOR_PHRASES[name]; IF none, skip
  2. lower := text.toLowerCase()
  3. missing := [p for p in phrases if not lower.includes(p)]
  4. IF missing non-empty: FAIL "<name> (turn-survival posture): missing anchor phrase(s) <missing>"
```

**Design decision — per-skill phrase map versus one shared phrase set plus prose edits.** Finding 3/4 is decisive: the three faff-graft phrases do not literally appear in `faff-beep-boop/SKILL.md` today. Its turn-survival prose at line 537 says "never end a turn with a dispatched agent still in flight" (contains `never end a turn`) but carries `run_in_background: false`, not `run_in_background: true`, and never says `foreground-to-terminal`. Forcing the shared three-phrase set onto beep-boop and prep would mean bending unnatural literals into their prose. A per-skill map lets each skill anchor on phrases its own prose genuinely carries, including the new `in-flight marker` vocabulary this fix adds at each dispatch site.

- Options: (a) per-skill phrase map; (b) one shared phrase set plus prose edits to make every skill carry the same literals.
- (a) keeps each anchor honest to its skill's real prose and needs no contrived wording; (b) is uniform but forces awkward literals and more prose churn.

**Chosen:** the per-skill anchor-phrase map (option a), covering `faff-graft` (unchanged), `faff-beep-boop`, and `faff-prep`.

**Design decision — does the anchor lint cover `faff-prep`?** The ticket's IN SCOPE list names both `faff-beep-boop/SKILL.md` and `faff-prep/SKILL.md`, and the spec-review Agent dispatch that produced the observed strand lives in `faff-prep/SKILL.md` line 120 (finding 6), so prep is exactly where the marker prose must not regress.

**Chosen:** the lint covers `faff-prep` as well as `faff-beep-boop` and `faff-graft`; the ticket's open question on prep coverage is answered by its own IN SCOPE directive.

## 4. HOW — behaviour

**Architecture.** Three moving parts, one new command, edits to two skill prompts and one registrar.

```
Agent dispatch site (faff-prep spec-review gate; beep-boop / concurrency build dispatch)
        |  before the Agent call:  faff inflightcheck --open  --key <k>
        v
   .faff/inflight/<owner-scope>/<k>.json  written  (owner = { run_dir, session_id })
        |
   Agent tool call  ...  returns tool result
        |  after the result is consumed:  faff inflightcheck --close --key <k>
        v
   .faff/inflight/<owner-scope>/<k>.json  removed
        |
        |  (STRAND: turn ends before --close runs)
        v
   Turn-end Stop event  ->  inflightcheck --hook  reads every .faff/inflight/<scope>/*.json
        ->  owned + stale (opened_at past TTL) -> sweep + stderr warn (the wedge escape)
        ->  owned + not-stale (live strand)    -> {"decision":"block", reason}   (refuse the turn-end)
        ->  foreign + live                     -> silent
        ->  foreign + abandoned                -> stderr warn (--recover forces block)
```

**Why the marker is open exactly in the strand case.** The parallel executor clears each build marker when that build's Agent call returns a terminal token to its await-all poll (`faffter-dark-concurrency-parallel/SKILL.md` line 47). In the legitimate concurrent case, the turn never ends until every dispatch has returned and every marker is closed, so the Stop event sees no open marker. A stranding dispatch is precisely one whose result never comes back before turn-end, so its marker is still open when the Stop event fires. That asymmetry is what `inflightcheck` keys on: it fires only at real turn-end, never at dispatch time, so it never blocks a legitimate mid-poll fan-out.

**`inflightcheck --hook` audit procedure.**

```
PROCEDURE inflightcheck_hook(stdin_event):
  1. Read every marker under .faff/inflight/<scope>/*.json (all scopes). Absent dir or none -> exit 0 (silent).
  2. Resolve THIS session's owner-scope from the env: slug(FAFF_RUN_DIR) | slug(FAFF_SESSION_ID) | "local".
  3. Classify each marker by PATH first (out-of-band, survives a corrupt body):
     a. owned  := marker's <owner-scope> subdir == this session's owner-scope   # path match, no body parse
     b. held   := runIsHeld(marker's run ledger)   # imported from runcheck.js, as sentrycheck.js already does
     c. stale  := opened_at older than the sweep TTL (default RUN_HEARTBEAT_STALE_SECS_DEFAULT, 900s)
        # keyed on opened_at age ALONE, not runIsHeld. A same-scope launcher resuming the run keeps that run's
        # heartbeat fresh, so a `held is false` conjunct would leave the corpse un-swept on the exact resume /
        # executor-loss path this project targets — the round-2 finding. A live strand dispatched THIS turn has a
        # recent opened_at (< TTL) and is still caught by step 5b; held is used only for the FOREIGN branch below.
  4. Sweep first (the wedge escape): any OWNED + stale marker is a corpse — the dispatch that opened it is gone.
     Remove it and emit a one-line stderr warning ("swept stale in-flight marker <key>: owning dispatch no longer live").
     A swept marker never contributes to the block decision, so an orphaned owned marker can never wedge turn-end forever.
  5. Precedence over what survives (FAFF-205 -> FAFF-235), first match wins across the set:
     a. an UNPARSEABLE body whose PATH proves it OWNED  -> fail closed: block (never fail open on a corrupt owned marker)
     b. any OWNED + not-stale open marker               -> emit {"decision":"block", reason} on stdout, exit 0 (a live strand this turn)
     c. all remaining markers FOREIGN + held            -> silent (a live foreign owner is mid-dispatch), exit 0
     d. FOREIGN + not held (abandoned-looking)          -> non-blocking stderr warning, exit 0
        (with --recover: treat one foreign abandoned marker as a block)
  6. Never a non-zero exit for the decision; the block is carried only by the JSON on stdout.
```

**Block reason text.** Names the remedy, not just the refusal, in the single-line style of `background-fence.js`'s deny messages (lines 128-142): state that an Agent dispatch under key `<k>` (`<describe>`) is still in flight; the turn may not end on a progress report; either finish the step in the foreground this turn (re-issue with `run_in_background: false`) and let its result return, or take the step's held outcome and record a terminal outcome in the run ledger, then clear the marker with `faff inflightcheck --close --key <k>`.

**Marker lifecycle prose at the dispatch sites.** The write and clear are added as orchestrator-prose obligations, worded so each target skill carries the `in-flight marker` and `never end a turn` anchors the lint now requires.

- `faff-prep/SKILL.md` spec-review-gate subroutine (line 120, "The producer"): before dispatching the `spec_review` producer subagent, write the in-flight marker keyed by the issue under review; after the producer's tool result is consumed, clear it. State plainly that the drain must never end a turn with the spec-review dispatch still in flight, and that a review that cannot finish this turn takes its held outcome and records it, rather than ending the turn on a progress report.
- `faff-beep-boop/SKILL.md` Turn-survival invariant (line 537): extend the existing invariant to name the in-flight marker as its mechanical backstop, so the anchor `in-flight marker` is present alongside the existing `never end a turn`. Keep the wording lean; the mechanism detail lives in the `inflightcheck` command, not the prompt.

**Behaviour summary for the concurrency path.** The parallel executor already opens and closes one marker per build if the build dispatch site calls `--open` / `--close` per issue; because its await-all poll holds the turn open until every build returns, all its markers are closed before any Stop event. No change to its await-all logic is required; it gains only the per-issue `--open` / `--close` bracket around each dispatch.

**Anti-pattern:** teaching `inflightcheck` to fire at dispatch time or from a PreToolUse position on the Agent tool. Why: at dispatch a backgrounded Agent call is legitimate (the parallel executor makes them deliberately), and `background-fence.js` abstains on the Agent tool by explicit design (lines 109-111) precisely because it cannot tell a build subagent's Agent call from the orchestrator's deliberate dispatch. Turn-end is the only position where a legitimate dispatch has already been discharged.

**Registration.** Follow the scaffolding in explore finding 9.

```
PROCEDURE register_inflightcheck:
  1. Implement plugin/skills/faff/bin/lib/inflightcheck.js exporting cmdInflightcheck (runcheck/prepcheck shape).
  2. require("./lib/inflightcheck") + add "inflightcheck": cmdInflightcheck to the COMMANDS registry in plugin/skills/faff/bin/faff.
  3. Add "inflightcheck" to FAFF_STOP_HOOKS (hooks-ensure.js line 23) so probeServes registers it into .claude/settings.json hooks.Stop.
  4. Extend HOOKS_ENSURE_SELFTEST_CASES (hooks-ensure.js lines 351-368) EXHAUSTIVELY for the new member (comment 347-350: a non-exhaustive fixture passes vacuously).
  5. Add a docs/guide/cli.md row for inflightcheck (CI enforces via `faff lint-cli-doc`; Object.keys(COMMANDS) is canonical, FAFF-237).
  6. Because the marker reads run-ledger heartbeat state via runIsHeld, place inflightcheck.js in the same ADR-0042 region as runcheck.js so `faff regions check` passes (the three-tier shared-infra -> governance -> factory model, one-directional).
```

**Edge cases and error handling.**

- No `.faff/inflight/` directory, or no markers: exit 0 silently. Fail-safe toward not blocking, as `runIsHeld` does on a missing heartbeat.
- Malformed or unparseable marker JSON: ownership is decided by the marker's owner-scope subdirectory, not its body, so a corrupt body under this session's own owner-scope is still provably owned and fails closed (block), mirroring `runcheck.js` `malformedOwnedReason` (lines 116-120). This path is reachable only because ownership is path-derived: the pre-revision top-level `.faff/inflight/<key>.json` shape made it unreachable, since a corrupt body carried no owner signal and fell through to foreign-plus-silent, a fail-open bypass of the very floor the fix installs. The owner-scope subdirectory closes that.
- Empty, closed, or missing stdin on `--hook`: exit 0, never block, as `background-fence.js` does (lines 175-178).
- `--close` on an absent marker: success (idempotent), so a double-clear or a clear after crash-recovery never errors.
- Concurrent `--open` under the same key: the second write overwrites `opened_at`; keys are per-dispatch, so distinct dispatches never collide, and a genuine same-key re-dispatch is one logical dispatch.

**Failure modes.**

- **The write-side prose seam.** The failure: the clear is prose, and so is the write. If a strand also skipped the `--open` call, no marker exists and `inflightcheck` cannot block. How you would know: a run still ends with `owner.status: "running"`, a fresh heartbeat, and no live process, and no block ever fired. What it means: the mechanical guarantee is bounded to "a marker that was written but not cleared is caught at turn-end", exactly `prepcheck`'s guarantee (write coupled to produce, forgotten flip caught). It is weaker than `prepcheck` on one axis: `prepcheck`'s write is coupled to an action that reliably happens (producing the spec), whereas here the write is its own prose step. The mitigation, and the reason this still catches the observed bug, is that the observed strand backgrounded the dispatch and ended on a progress report while the `--open` marker call is a single deterministic CLI step at the dispatch site, more reliably obeyed than the finer foreground-versus-background judgement it backstops. That residual is accepted for this ticket: the write stays prose-managed (settled in section 6), with a mechanical write noted there as a future hardening.
- **An orphaned owned marker wedges turn-end forever.** The failure: the owned-open block is unconditional, but here the marker's natural clear trigger is the Agent tool result returning, and the exact bug is a dispatch that dies at turn-end so its result never returns. On resume with the same owner-scope the marker is owned and open, and a naive design would block every turn-end with no dispatch left to clear it, a wedged run arguably worse than the silent death this fixes. How you would know: turn-end blocks repeatedly on a marker whose owning dispatch is gone. What it means: bounded, not left to prose. The `--hook` sweep (procedure step 4) removes any owned marker whose `opened_at` is older than the sweep TTL, keyed on age alone rather than liveness (so a same-scope resumer keeping the run heartbeat fresh cannot leave the corpse un-swept), then warns on stderr, so an orphaned owned marker can never block indefinitely. The block is reserved for a live strand (owned, not stale) happening this turn; a corpse is swept. This is the mechanical escape the plain `prepcheck`/`runcheck` markers do not need (their clear trigger always eventually fires) but this one does.
- **Stop-hook block does not re-drive a headless `claude -p` turn.** The failure: if `{"decision":"block"}` at Stop did not re-prompt the model under `claude -p`, the block would be inert. How you would know: the existing `runcheck` / `prepcheck` completion backstops would already be inert in the same headless drains, which the ticket treats as working recovery machinery. What it means: proceed; the three existing Stop hooks establish that a Stop block re-drives the headless turn, and `inflightcheck` inherits the same mechanism.
- **Recovery latency after a block that is nonetheless missed.** The failure: even with the fix, any run that does reach a stranded state is refused re-entry by `classifyReEnterable` (`resume.js` lines 53-65) as `live-running` until its heartbeat ages past the 900s window and reclassifies as `dead-running`. How you would know: a launcher resume attempt inside 900s returns `live-running` and refuses. What it means: named as a known residual cost (~15 minutes per missed strand), not fixed here; out of scope per the ticket. This fix's value is preventing the strand at turn-end, upstream of that window.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 drain owns a run (FAFF_RUN_DIR set) and has dispatched a spec-review re-run whose marker .faff/inflight/<owner-scope>/<issue>.json is open
When the drain attempts to end its turn
Then inflightcheck --hook emits {"decision":"block", reason} naming the open dispatch key, and the turn does not end
```

```
Given the same drain has since recorded the spec-review step's terminal outcome and run `faff inflightcheck --close --key <issue>`
When the drain attempts to end its turn
Then no marker is open, inflightcheck exits 0 silently, and the turn ends normally
```

The mirror property, that N markers open *mid-poll* do not block, is not a hook property and no selftest can drive it: the hook fires only at the Stop event, and the parallel executor's await-all prose is what guarantees the Stop event is never reached mid-poll. The genuine hook-level assertion is the inverse, pinned in DONE: an owned, not-stale marker open at an actual Stop event *does* block, because that is a real strand, whether it came from a lone prep dispatch or a mishandled fan-out.

- The `inflightcheck --selftest` mode drives its pure matcher over a fixture table with the ok/FAIL rows and `RESULT: PASS/FAIL (N cases, M failed)` footer, matching `background-fence.js` lines 189-320.

## 6. Design decision rationale

**Where does the mechanical check live: a PreToolUse fence on the Agent tool, or a Stop-hook-audited marker?**
- Options: (a) grow `background-fence` an Agent arm; (b) a new Stop hook auditing a per-dispatch marker.
- (a) fires at dispatch time, when a backgrounded Agent call is legitimate, and the hook cannot tell a build subagent's Agent call from the orchestrator's deliberate dispatch (`background-fence.js` lines 109-111); `faffter-dark-concurrency-parallel` depends on that abstention. (b) fires only at turn-end, by when a legitimate dispatch has been discharged by its await-all gate, and reuses the proven FAFF-205 ownership and liveness precedence so a non-owning session is never trapped.

**Chosen:** a new `inflightcheck` Stop hook auditing a per-dispatch marker, alongside `runcheck` / `prepcheck` / `sentrycheck` — the only position that does not fight the deliberate background dispatch.

**Marker granularity: global boolean or per-dispatch key?**
- Options: (a) one global in-flight flag; (b) one marker per dispatch, keyed.
- (a) trips on the parallel executor's second concurrent dispatch even though the await-all gate is holding the turn open correctly; (b) lets N legitimate dispatches produce N independent markers, all cleared before turn-end.

**Chosen:** per-dispatch keyed markers, keyed by issue id where the dispatch is per-issue.

**Marker storage and shape.**
- Options: (a) a run-scoped file under `.faff/runs/<run-id>/`; (b) a flat top-level `.faff/inflight/<key>.json` carrying its owner only in the body, as `prepcheck`'s per-issue markers do; (c) an owner-scoped path `.faff/inflight/<owner-scope>/<key>.json` with the owner identity in the subdirectory as well as the body.
- (a) has no home when the dispatch happens in a prep drain with no run dir. (b) mirrors `prepcheck`'s body-only owner block, but a corrupt body then carries no owner signal, so a malformed-owned marker cannot be proven owned and fails open, the exact silent-strand class the fix exists to prevent (the infosec objection). (c) restores runcheck's out-of-band ownership, where `ownedByEnvPointer` proves ownership from the filesystem path rather than the file content (`runcheck.js` lines 111-114): the owner-scope subdirectory is the path signal, so a corrupt body still resolves ownership and fails closed, and the prep-drain-with-no-run-dir case falls to the `local` scope rather than losing a home.

**Chosen:** the owner-scoped path `.faff/inflight/<owner-scope>/<key>.json` (option c), `owner-scope := slug(FAFF_RUN_DIR) | slug(FAFF_SESSION_ID) | "local"`, audited by a path-first ownership check with the body's owner block as corroboration and `runIsHeld` liveness. This keeps the prep-drain home option (b) had while restoring the out-of-band ownership option (b) lost.

**Dispatch-key sanitisation.**
- Options: (a) trust the caller and use `--key` verbatim as the basename; (b) constrain `--key` to a safe charset at `--open` / `--close`.
- (a) lets a caller-supplied dispatch id containing a path separator or `..` write or remove files outside `.faff/inflight/<owner-scope>/`; the orchestrator is trusted and this is a local harness, but the value crosses into a filesystem path, so an unsanitised key is a latent traversal.

**Chosen:** constrain `--key` to `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (no leading dot, so no marker is a dotfile the `--hook` glob would skip) and reject anything else before touching the filesystem (option b).

**The orphaned-owned wedge escape.**
- Options: (a) block unconditionally on any owned open marker; (b) sweep an owned marker whose run is no longer held and whose `opened_at` is past the TTL, blocking only on a live (not-stale) owned marker.
- (a) wedges turn-end forever when the owning dispatch died, since its clear trigger (the Agent result) never returns; (b) gives a mechanical escape so an orphaned marker cannot block indefinitely, while still blocking the live strand this turn.

**Chosen:** the stale-marker sweep (option b), TTL defaulting to `RUN_HEARTBEAT_STALE_SECS_DEFAULT` (the same 900s window the liveness check already uses, one source).

**The anchor-lint generalisation and its coverage.** Resolved inline in section 3: **Chosen** the per-skill anchor-phrase map covering `faff-graft`, `faff-beep-boop`, and `faff-prep`.

**Write mechanism for the marker: prose-managed, or mechanically written by a hook?**
- Options: (a) prose-managed write — the orchestrator calls `faff inflightcheck --open` before the dispatch and `--close` after, exactly as `prepcheck`'s own marker is written by prose and flipped on attach; (b) a mechanical write — a write-only Agent PreToolUse hook writes the marker on every Agent dispatch, cleared by a PostToolUse hook, so the write cannot be forgotten.
- (a) is no weaker than the proven Stop-hook family (every current marker is prose-written; the hook catches a forgotten clear) and catches the observed strand, which skipped the foreground and the clear, not the write. Its residual is a strand that also skips the `--open` write. (b) additionally closes that residual, but its correctness rests on an unverified harness fact: whether an Agent-tool PostToolUse hook fires on real completion or at background-launch. If it fires at launch, a deliberately-backgrounded dispatch's marker clears while the subagent is still running, defeating the mechanism for exactly the parallel-executor case `background-fence` abstains from. It also reintroduces the Agent-tool PreToolUse locus that abstention exists to avoid.

**Chosen:** the prose-managed write (option a). It matches how `prepcheck` and `runcheck` already manage their markers, so it is no weaker than the proven pattern, and it catches the observed strand. The mechanical write stays documented here as a noted future hardening — its first task, should it be taken up, is a spike to verify the Agent-tool PostToolUse firing timing on a backgrounded dispatch. Kept in this rationale rather than a separate ticket, by operator decision.

**`SKILL_LINE_BASELINE` bump.** `faff-beep-boop/SKILL.md` is 738 lines against its baseline of 739 (`validate-adapters.js` line 57), a zero-headroom downward ratchet (lines 861-869). Any prose the fix adds beyond one line requires bumping `SKILL_LINE_BASELINE["faff-beep-boop"]` to the new exact `wc -l` in the same commit or CI fails. `faff-prep/SKILL.md` is 469 lines against the lenient `SKILL_LINE_CAP` of 600 (line 41) with no baseline entry, so its prose additions need no baseline change.

**Chosen:** bump `SKILL_LINE_BASELINE["faff-beep-boop"]` to the committed line count in the same commit as the beep-boop prose edit; leave `faff-prep` on the lenient cap.

## 7. Open questions and assumptions

**Open questions.**

None remain. The marker-write question (prose-managed versus a mechanical write-only Agent PreToolUse hook) was resolved during prep to the **prose-managed write** — see section 6, "Write mechanism for the marker". The mechanical write stays documented there as a noted future hardening whose first task is a spike to verify Agent-tool PostToolUse timing on a backgrounded dispatch.

**Assumptions.**

**Assumes:** a `{"decision":"block"}` Stop-hook result re-drives a headless `claude -p` turn (does not merely log). Validation: confirm the existing `runcheck` / `prepcheck` completion backstops re-prompt the model under `claude -p` in an L4 drain; if they only log, this fix and the three existing hooks share the same limitation and the ticket's premise about Stop-hook recovery needs revisiting first.

**Assumes:** `inflightcheck.js` can import `runIsOwned` / `runIsHeld` from `runcheck.js` and read run-ledger heartbeat state without crossing an ADR-0042 region boundary. Validation: place `inflightcheck.js` in the same region as `runcheck.js` and run `faff regions check` before wiring the import; `sentrycheck.js` already imports both (line 33), so the region is known to permit it.

**Undeterminable, stated plainly (not a decision).** Whether run 3 was a bare `claude -p` or ran under a launcher wrapper cannot be determined from the repository; the specific stranded run artifact is not preserved in the working tree (finding 5: `.faff/runs/` has stranded-looking dirs but none shows a backgrounded spec-review re-run). The launcher half is out of scope regardless (`operations/ci/l4-watcher.yml` already covers resume). The tool that backgrounded the re-run is answered: an Agent-tool Producer dispatch inside `faff-prep`'s spec-review gate (finding 6), which is why `background-fence` had no jurisdiction.

## 8. DONE — definition of done

### From WHY
- [ ] A drain reaching a mandatory spec-review re-run either completes it in the same turn or ends the turn on a terminal outcome recorded in the run ledger; it never ends a turn on a progress report while the dispatch is open.
- [ ] No run ends with `owner.status: "running"`, a fresh heartbeat inside the 900s window, and no live process for a step `inflightcheck` would have flagged.

### From WHAT (types and the lint interface)
- [ ] Markers live at `.faff/inflight/<owner-scope>/<key>.json` with `owner-scope := slug(FAFF_RUN_DIR) | slug(FAFF_SESSION_ID) | "local"` and a body owner block; `slug` is sanitised-plus-hash8 (injective, no `/` or `..`); `--open` / `--close` reject any `--key` off `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (no leading dot) before touching the filesystem.
- [ ] The anchor lint is a data-driven per-skill map (no `name === "faff-graft"` branch); `faff-graft` keeps its three phrases unchanged, and `faff-beep-boop` and `faff-prep` each assert their own anchor set including `never end a turn` and `in-flight marker`.
- [ ] `faff validate-adapters` fails if any covered skill's SKILL.md drops a required anchor phrase.

### From HOW (behaviour)
- [ ] `faff inflightcheck --open --key <k>` writes `.faff/inflight/<owner-scope>/<k>.json` with the current owner block; `--close --key <k>` removes this session's marker and is idempotent on an absent marker; both reject a key off `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`.
- [ ] The `--hook` sweep removes an owned marker whose `opened_at` is past the TTL (default `RUN_HEARTBEAT_STALE_SECS_DEFAULT`, 900s) — keyed on `opened_at` age alone, not `runIsHeld`, so a same-scope resumer that keeps the heartbeat fresh cannot leave a corpse un-swept — warns on stderr, and lets the turn end; a live owned marker with a recent `opened_at` still blocks. An orphaned owned marker can never wedge turn-end indefinitely.
- [ ] `faff inflightcheck --hook` emits `{"decision":"block", reason}` on stdout for an owned open marker and exits 0 for the silent and warn cases, never a non-zero decision exit.
- [ ] The block reason names the open dispatch key and both remedies (finish in the foreground this turn, or record the held terminal outcome then `--close`).
- [ ] Ownership is path-derived — the marker's owner-scope subdirectory, with the body owner block retained as corroboration (never the sole signal, so a corrupt owned body still fails closed) — and a foreign marker's liveness uses `runIsHeld` imported from `runcheck.js`; the FAFF-205 to FAFF-235 precedence holds (owned+open blocks; foreign+live silent; foreign+abandoned warns; `--recover` forces a foreign abandoned marker to block).
- [ ] `faff-prep/SKILL.md` spec-review-gate subroutine writes the marker before the `spec_review` dispatch and clears it after the result, keyed by the issue under review.
- [ ] `faff-beep-boop/SKILL.md` Turn-survival invariant names the in-flight marker as its backstop; `SKILL_LINE_BASELINE["faff-beep-boop"]` is bumped to the new exact `wc -l` in the same commit.

### From HOW (registration)
- [ ] `inflightcheck` is in the `COMMANDS` registry (`plugin/skills/faff/bin/faff`) and in `FAFF_STOP_HOOKS` (`hooks-ensure.js` line 23), and `hooks-ensure` registers it into `.claude/settings.json` `hooks.Stop`.
- [ ] `HOOKS_ENSURE_SELFTEST_CASES` covers the new member exhaustively (no vacuous pass).
- [ ] A `docs/guide/cli.md` row exists for `inflightcheck` and `faff lint-cli-doc` passes.
- [ ] `inflightcheck.js` sits in the same ADR-0042 region as `runcheck.js` and `faff regions check` passes.

### From HOW (edge cases)
- [ ] No `.faff/inflight/` dir, empty/closed/missing stdin, and malformed-but-foreign markers all exit 0 without blocking; a malformed marker whose owner-scope path proves it owned fails closed (block) — the fail-closed path is reachable because ownership is path-derived, not body-derived.

### From SCENARIOS (regression test)
- [ ] `faff inflightcheck --selftest` drives a pure fixture table in the `background-fence.js` style (deny cases, allow cases, full event-object cases) with the ok/FAIL rows and `RESULT: PASS/FAIL (N cases, M failed)` footer, and pins the strand shape: an owned open marker at turn-end blocks, a cleared marker does not, and a foreign live marker stays silent.
- [ ] The stale-sweep is pinned by a selftest case: an OWNED marker whose `opened_at` is past the TTL is swept (removed) with a stderr warning and the turn ends, while an OWNED marker with a recent `opened_at` blocks — proving the sweep keys on `opened_at` age alone, not `runIsHeld`, and that the resume-path corpse is swept even when the run heartbeat is fresh.
- [ ] The concurrency non-regression is pinned honestly: a selftest asserts an owned, not-stale marker open at the Stop event DOES block (a real strand, not a false positive), and asserts that once await-all has cleared every marker the Stop event sees none and the turn ends. The "N markers open mid-poll do not block" property is documented as an obligation of the parallel executor's await-all prose (the turn is never ended mid-poll), not a hook property a selftest can drive.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Set FAFF_RUN_DIR to a scratch run dir; run `faff inflightcheck --open --key SMOKE-1 --describe "spec-review"`.
  2. Feed a Stop event on stdin to `faff inflightcheck --hook`; ASSERT stdout carries {"decision":"block", ...} naming SMOKE-1.
  3. Run `faff inflightcheck --close --key SMOKE-1`; re-run `--hook`; ASSERT exit 0 and no block.
  # If this path holds, the marker write, the turn-end audit, and the clear are wired together.
```

confidence: high
build-tier: complex
spec-review: approve

## Methodology critique

Lens: `faffter-dark-methodology-agile-delivery` (agile-delivery). Advisory — surfaced for the human, does not gate.

**Right-sized? Split candidate.** The spec bundles two structurally independent concerns: the turn-survival fix (the `inflightcheck` Stop hook, the per-dispatch markers, the marker-lifecycle prose) and a tooling change (generalising the `validate-adapters` anchor-phrase lint from the hard-coded `faff-graft` branch to a per-skill map). The first is the Urgent bug fix and ships value on its own; the lint generalisation is a separate, non-urgent tooling change that does not depend on the fix. The split is not total: the `SKILL_LINE_BASELINE` bump is genuinely coupled (the prose edits add lines that trip the cap), but the anchor-phrase feature expansion is not. Suggested: split the lint generalisation into its own ticket, keeping only the forced baseline bump alongside the fix. Note: the ticket itself puts both changes explicitly in scope, so this is a recommendation to weigh, not a defect.

**Workstream fit? The lint half is outcome-misplaced.** The project outcome is "a current unattended run survives executor loss at safe boundaries". The turn-survival half sits squarely on that outcome; the anchor-phrase lint generalisation is skill-authoring tooling quality with nothing to do with executor-loss survival. Once split, home the lint ticket under a skill-authoring or `validate-adapters` tooling outcome. The turn-survival ticket itself is a clean fit and needs no move.

**Deps surfaced? The Punt is not captured; the prerequisite references are honest.** The four related Done tickets (FAFF-491/530 background-fence, FAFF-606 launcher resume, FAFF-782 merged-but-unclosed) and the parked FAFF-854 are correctly framed; "blocked-by: none" is correct (a Done ticket cannot block). But the open Punt (whether to also build a write-only Agent PreToolUse hook) lives only in spec prose. If the human defers it, it should become a follow-up ticket or ADR so it is traceable, not lost when the spec is superseded. Separately, the design depends on `faffter-dark-concurrency-parallel`'s N-concurrent-dispatch + await-all pattern (markers are per-dispatch specifically to avoid regressing it); name that "must not regress" relationship for a reviewer.

**Risk profile? De-risk the block-forever failure mode first.** The fix adds a Stop hook that refuses turn-end while a marker is open, sitting on the exact turn-end control path the whole unattended runner depends on, with a prose-driven marker lifecycle and medium self-rated confidence. Two failure modes are more dangerous than the original bug: a missed marker clear (dispatch crashes, tool result never returns, or the clear path is missed) blocks turn-end forever (a wedged run, worse than the silent death this fixes); a missed marker write means the fence silently never fires. Suggested de-risking: add a stale-marker escape (a bound, a TTL, or clear-on-error) so an orphaned marker cannot wedge turn-end indefinitely, and pull the PreToolUse-write Punt forward as the de-risking spike it already is. A medium-confidence change on the turn-end control path is where risk-aware sequencing wants the unknown resolved early.

**Prep resolution (post-critique).** The block-forever wedge is now bounded by the stale-marker sweep (an orphaned owned marker is swept on `opened_at` age; see section 4 and the failure mode), pinned by a dedicated selftest. The marker-write Punt was closed interactively to the prose-managed write (section 6), which matches how `prepcheck` and `runcheck` already manage their markers, so it is no weaker than the proven pattern; the mechanical write is retained in the section 6 rationale as a noted future hardening (kept in-spec by operator decision, not a separate ticket). The split candidate was weighed and the two changes are kept bundled per the ticket's own scope. Automation eligibility is left unchanged (interactive-only).
