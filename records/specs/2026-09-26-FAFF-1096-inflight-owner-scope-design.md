# Spec: FAFF-1096 — Scope `inflightcheck` to the session that wrote the marker, and reconcile the harness-tracked-background dispatch

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1096.

## 1. WHY — Problem and Principles

**The model this turns on.** `inflightcheck` decides who owns an in-flight marker by the marker's **filesystem path**, not by the `owner` object inside it. The owner-scope is a subdirectory name computed by `resolveOwnerScope(env)`: `slug($FAFF_RUN_DIR)`, else `slug($FAFF_SESSION_ID)`, else the literal string `"local"` (`inflightcheck.js:59-64`). Interactive Claude Code sets **neither** `FAFF_RUN_DIR` nor `FAFF_SESSION_ID`, so every interactive session's marker lands in the single shared `"local"` scope, and the Stop hook treats every `"local"` marker as owned-by-this-session. Two facts follow from that one collapse, and they are the whole defect.

**Problem statement.** Interactive Claude Code has no real session identity in the owner-scope chain, so unrelated interactive sessions share the `"local"` scope and hard-block on each other's markers (Dimension 2), while a session's own harness-tracked-background dispatch blocks it at its own turn-end even though the harness will re-invoke the parent and the child survives the turn boundary (Dimension 1). The only remedies available today are a manual `faff inflightcheck --close` (which defeats the guard for a genuinely stranded child) or closing a live peer session's marker (which corrupts a foreign session's state). This change gives interactive Claude Code a real owner-scope from `CLAUDE_CODE_SESSION_ID`, and makes the turn-end block conditional on whether the harness actually strands a backgrounded child.

**Design principles.**

- **The fix lives in the automation as a correct reconciliation, never a manual verb.** The operator's standing rule forbids a manual operator flag or workaround for an autonomous gap. The manual `--close` is the exact anti-pattern this ticket exists to remove; the guard must reconcile itself.
- **Fail-safe direction is toward the current safe behaviour.** Wherever a signal is absent or ambiguous, the code degrades to `"local"` scope and to blocking (today's conservative behaviour), never to a new fail-open path. A missing `CLAUDE_CODE_SESSION_ID` must never make a genuinely stranded headless child go uncaught.
- **The headless block stays correct.** Under autonomous beep-boop / headless `claude -p`, turn-end kills the cage and a backgrounded child dies with it. For that path the stranding premise holds and the block must remain exactly as today.
- **Composition stays disjoint and order-independent.** `runcheck` / `inflightcheck` / `turncheck` each own one turn-end case (kernel and `turncheck.js:13-18`). Any ownership change must keep `turncheck`'s defer aligned with what `inflightcheck` actually blocks on, so no case slips through both hooks or is double-blocked.
- **Bring `inflightcheck` onto the sibling owner model, do not invent a third one.** `runcheck` (FAFF-205) and `prepcheck` already resolve ownership from a real session identity matched against env. This change closes the one guard that still ignores `CLAUDE_CODE_SESSION_ID`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/inflightcheck.js` | Node.js | The guard being fixed: `resolveOwnerScope`, `inflightHookDecision`, `--open`/`--close`. |
| `plugin/skills/faff/bin/lib/turncheck.js` | Node.js | Reuses `resolveOwnerScope` + `inflightIsStale` in `hasOpenInflightForOwner`; its defer must stay aligned. |
| `plugin/skills/faff/bin/lib/runcheck.js` | Node.js | The sibling owner+liveness model (`runIsOwned`, `runIsHeld`) this change mirrors. |
| `plugin/skills/faff/bin/lib/harness.js` | Node.js | `detectHarnessFromEnv` (`:648-652`): `CLAUDE_CODE_SESSION_ID` is the Claude Code session id the rest of the codebase already keys off. |
| `plugin/skills/faff-prep/SKILL.md` | Markdown | The **only** producer that opens markers today (`:132`, `:167`), key = issue id, `--describe spec-review`. |
| `plugin/skills/faff/references/kernel.md` | Markdown | The Producer-dispatch contract (`:337-339`): `run_in_background: false (mandatory)`. |
| `test/inflightcheck.test.mjs` | Node test | Sessions distinguished by different `FAFF_SESSION_ID`; the interactive `"local"` collapse is untested. |

**Scope statement.** This sits in the Stop-hook turn-end guard family; it changes attribution and turn-end disposition inside `inflightcheck`, plus one mirrored predicate in `turncheck`, and the accompanying contract wording. It does not touch the tracker or the run ledger.

## 2. OUT OF SCOPE

- **Adding in-flight bracketing to other producers (faff-jot / faff-plot / review-lens fan-out).** Why excluded: the explore confirms **only** `faff-prep` opens markers today (`grep` of `inflightcheck --open` finds sole call sites at `faff-prep/SKILL.md:132,167`); the ticket's mention of other producers describes dispatch shapes, not existing bracket sites. The state-based `turncheck` already backstops unbracketed dispatch shapes (`turncheck.js:7-11`), so unbracketed fan-outs are covered without new markers. Extension point: a future producer that opens markers uses the same `faff inflightcheck --open/--close` protocol; no new interface needed.
- **Converting `inflightcheck` to a pure body-owner + env-match model (dropping path-scope entirely).** Why excluded: path-derived ownership is what lets a corrupt/unparseable body still fail **closed** when the path proves it owned (`inflightcheck.js:16-20,176-178`); a full conversion discards that property and forces a `turncheck` rework. Extension point: the shared block predicate (§3) is the seam a later model swap would replace.
- **A migration pass over existing `"local"` markers.** Why excluded: the age-alone sweep (TTL 900s, `inflightcheck.js:181`) reaps any orphaned legacy marker within the window; a one-time transition needs no migration. Extension point: none required.
- **Removing the `pid` field or adding a heartbeat to the marker.** Why excluded: `pid` is never written today and a marker heartbeat would re-import the staleness confound `prepcheck` deliberately avoids (`faff-prep/SKILL.md:99`). Extension point: run-ledger liveness already covers the autonomous path via `inflightForeignHeld` tier (a).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Owner-scope | The subdirectory name under `.faff/inflight/` that path-encodes which session owns a marker. |
| Harness-tracked-background | A dispatch the harness runs in the background **and** guarantees to re-invoke the parent on child completion, so the child survives the turn boundary (interactive Claude Code's Agent tool). |
| Stranding premise | The assumption that a backgrounded child dies at turn-end because nothing re-invokes the parent (holds for headless `claude -p`; does not hold for interactive Claude Code). |
| Foreign marker | A marker whose owner-scope differs from this session's resolved scope. |
| Legacy marker | A marker with an empty or absent `owner`, or one under the shared `"local"` scope, written before this change. |

**The owner-scope resolution (changed).** `resolveOwnerScope(env)` gains a new tier for the interactive Claude Code session id, inserted below `FAFF_SESSION_ID` and above the `"local"` fallback:

```
FUNCTION resolveOwnerScope(env):
  IF env.FAFF_RUN_DIR:            RETURN slug(env.FAFF_RUN_DIR)      # autonomous / headless run (unchanged)
  IF env.FAFF_SESSION_ID:        RETURN slug(env.FAFF_SESSION_ID)   # explicit faff session (unchanged)
  IF env.CLAUDE_CODE_SESSION_ID: RETURN slug(env.CLAUDE_CODE_SESSION_ID)  # NEW: interactive Claude Code
  RETURN "local"                                                    # truly identity-less fallback (unchanged)
```

`slug` is unchanged (`<sanitised>-<sha256[0:8]>`, deterministic, injective, traversal-safe). Both `--open` and `--close` recompute the scope from env, so the new tier keeps open/close **env-symmetric**: `CLAUDE_CODE_SESSION_ID` is stable across a session, so a marker opened under it closes under the same scope.

**Design decision — ownership model.** Extend the path-scope chain vs convert to body-owner match vs hybrid.

- *Extend the chain (Chosen).* Minimal; preserves path-derived fail-closed-on-corrupt-body, the age-alone sweep, traversal-safety, `--close` symmetry, and `turncheck` alignment (both call the same `resolveOwnerScope`). Fixes Dimension 2 directly: each interactive session gets a distinct scope, so a peer's marker is foreign.
- *Full body-owner conversion.* Rejected: discards fail-closed-on-corrupt-body and forces a `turncheck` rework for no added correctness here.
- *Hybrid (populate + read a real `owner.session_id`).* Partly adopted: we **also** stamp `owner.session_id` from `CLAUDE_CODE_SESSION_ID` into the marker body (below) for attribution and forensics, but the **ownership decision stays path-derived**.

**Chosen:** extend `resolveOwnerScope` with a `CLAUDE_CODE_SESSION_ID` tier below `FAFF_SESSION_ID` and above `"local"`, keeping ownership path-derived. Rationale: it is the smallest change that brings `inflightcheck` onto the sibling real-session-identity basis while preserving every existing invariant the guard depends on. `(decides: architecture)`

**The marker body (enriched).** `--open` stamps `owner.session_id` from the first available of `FAFF_SESSION_ID` then `CLAUDE_CODE_SESSION_ID`; `owner.run_dir` from `FAFF_RUN_DIR` when set (unchanged). Fields whose env vars are unset are omitted (never written as empty strings), mirroring `prepcheck` (`faff-prep/SKILL.md:99`).

```
RECORD InflightMarker:
  key: String                 # issue id; validated by INFLIGHT_KEY_RE (unchanged)
  describe: String            # --describe value or key (unchanged)
  opened_at: ISO-8601         # write time (unchanged)
  owner: RECORD:
    run_dir: String?          # from FAFF_RUN_DIR when set (unchanged)
    session_id: String?       # NEW: from FAFF_SESSION_ID, else CLAUDE_CODE_SESSION_ID, when set
  # pid is still never written (unchanged)

  CONSTRAINT owner may be {} (legacy-tolerant; an owner-less marker is never owned-by-path for a real scope)
```

**Chosen:** stamp `owner.session_id` from `FAFF_SESSION_ID` then `CLAUDE_CODE_SESSION_ID` into the marker body, for attribution and forensics; ownership remains path-derived and unaffected by body content. `(decides: architecture)`

**The block predicate (extracted and shared).** The per-marker "would this block?" logic is extracted into one exported function so `inflightHookDecision` and `turncheck`'s `hasOpenInflightForOwner` cannot drift:

```
FUNCTION inflightWouldBlock(marker, nowMs, env):   # per-marker, pure, filesystem-free
  owned := marker.scope == resolveOwnerScope(env)
  IF NOT owned: RETURN false                        # foreign never blocks (warn/silent handled elsewhere)
  IF NOT marker.parseOk: RETURN true                # owned + corrupt → fail closed
  IF inflightIsStale(marker.opened_at, nowMs, env): RETURN false   # owned corpse → swept, not blocked
  IF isHarnessTrackedBackground(env): RETURN false  # NEW: owned + fresh + harness re-invokes → not a strand
  RETURN true                                        # owned + fresh + stranding premise holds → block
```

**The harness-tracked-background signal.**

```
FUNCTION isHarnessTrackedBackground(env):
  # Interactive Claude Code backgrounds the Agent tool AND re-invokes the parent on
  # child completion, so an open own-marker at turn-end is not a strand.
  RETURN env.CLAUDE_CODE_SESSION_ID AND NOT env.FAFF_RUN_DIR
```

`FAFF_RUN_DIR` presence marks the autonomous/headless run path (beep-boop always sets it), where the stranding premise holds; its absence with `CLAUDE_CODE_SESSION_ID` present is the interactive proxy. See the Failure modes (§4) and the Punt (§7) for the residual edge this proxy leaves.

**Design decision — Dimension 1 disposition.** How to stop an own harness-tracked marker blocking at turn-end while keeping the headless block.

**Chosen:** under `isHarnessTrackedBackground`, an owned + fresh marker at turn-end does **not** block; the hook emits a non-blocking stderr note instead. Under `FAFF_RUN_DIR` (autonomous/headless), the block is unchanged. Rationale: it trusts the harness re-invocation contract only where it actually holds, removes the manual `--close`, and preserves the headless strand catch. `(decides: architecture)`

## 4. HOW — Behavior

**Architecture and approach.** Three edits, one seam each:

1. `resolveOwnerScope` gains the `CLAUDE_CODE_SESSION_ID` tier (fixes Dimension 2: distinct scope per interactive session).
2. `--open` stamps `owner.session_id` from the real session id (attribution).
3. `inflightHookDecision` routes each owned + fresh marker through `inflightWouldBlock`, which returns non-block under `isHarnessTrackedBackground` (fixes Dimension 1). `turncheck.hasOpenInflightForOwner` calls the same `inflightWouldBlock` so its defer mirrors the block exactly.

**Behaviour summary — the hook decision, post-change.** For each marker, decide independently against this session's scope; owned corpses sweep, owned live strands block **unless** the harness tracks the background child, foreign markers warn or stay silent, never block (except under `--recover`).

```
PROCEDURE inflightHookDecision(markers, nowMs, env, opts):
  thisScope := resolveOwnerScope(env)
  FOR each marker m:
    owned := m.scope == thisScope
    IF NOT m.parseOk:
      IF owned: block += m.key          # fail closed (unchanged)
      CONTINUE                           # foreign corrupt → silent (unchanged)
    IF owned:
      IF inflightIsStale(m.opened_at, nowMs, env): sweep += m   # corpse (unchanged)
      ELSE IF isHarnessTrackedBackground(env): note += m.key    # NEW: tracked child, not a strand
      ELSE: block += m.key                                       # live strand this turn (unchanged path)
      CONTINUE
    # foreign (unchanged)
    IF inflightForeignHeld(m, nowMs, env): CONTINUE   # silent
    IF opts.recover: block += m.key
    ELSE: warn += m.key
  RETURN { block, warn, sweep, note }
```

The hook prints the sweep notices and the `note` lines to stderr (non-blocking), and emits the `{"decision":"block", reason}` payload on stdout only when `block` is non-empty, exiting 0 as today.

**Behaviour summary — turncheck alignment.** `turncheck` defers to `inflightcheck` only for a marker `inflightcheck` actually blocks on; it must call the same predicate.

```
FUNCTION hasOpenInflightForOwner(root, env, nowMs):     # impure shell
  RETURN readInflightMarkers(root).some(m => inflightWouldBlock(m, nowMs, env))
```

Because interactive Claude Code is not the owner of any run ledger (`runIsOwned` is false with no `FAFF_RUN_DIR`/`FAFF_SESSION_ID` match), `turncheck` never hard-blocks an interactive session regardless; the mirrored predicate keeps the composition **stated** and order-independent rather than relying on incidental behaviour.

**Edge cases and error handling.**

- **`CLAUDE_CODE_SESSION_ID` absent under Claude Code (propagation not guaranteed into the Stop-hook subprocess).** Fallback: `resolveOwnerScope` returns `"local"` and `isHarnessTrackedBackground` returns false, so the session behaves exactly as today (shared scope, block on own fresh markers). No regression, no new fail-open. This is the safe degradation the propagation Assumes (§7) rests on.
- **Two interactive sessions, distinct `CLAUDE_CODE_SESSION_ID`.** Each resolves its own scope; a peer's fresh marker is foreign and within TTL, so `inflightForeignHeld` tier (b) returns held and this session stays silent; a peer's stale marker warns, never blocks.
- **Legacy `owner:{}` / `"local"`-scoped marker seen by a session with a real scope.** Foreign by path, so it can never block; warn (if stale) or silent (if fresh), mirroring `runcheck`'s legacy-ledger tolerance.
- **`--open` under interactive, `--close` under the same session.** Both recompute scope from the stable `CLAUDE_CODE_SESSION_ID`, so they target the same path; env-symmetry preserved.
- **Autonomous beep-boop (`FAFF_RUN_DIR` set).** `resolveOwnerScope` returns `slug(FAFF_RUN_DIR)` (never reaches the new tier); `isHarnessTrackedBackground` returns false; block unchanged.

**Failure modes.**

- **The failure:** the `FAFF_RUN_DIR`-absence proxy misclassifies a bare `claude -p` prep run (no beep-boop, so no `FAFF_RUN_DIR`, but `CLAUDE_CODE_SESSION_ID` present) as interactive, so an own fresh marker does not block at turn-end even though the headless cage dies. **How you'd know:** a spec-review dispatch under a hand-run `claude -p "/faff-prep ISSUE"` strands with the marker open and no block fires; the marker later sweeps at TTL rather than being caught at turn-end. **What it means:** narrow. This path is rare (autonomous prep runs under beep-boop, which sets `FAFF_RUN_DIR`), the age-alone sweep bounds the leak, and a human ran the command so the summary is visible. Track the robust positive signal as the Punt (§7); do not block shipping the common-case fix on it.
- **The failure:** `CLAUDE_CODE_SESSION_ID` is not the same value across the dispatching turn and the Stop-hook subprocess (harness re-keys it), breaking open/close symmetry. **How you'd know:** markers opened under one scope are never closed and always sweep at TTL; the `--json` report shows a scope mismatch. **What it means:** abandon the `CLAUDE_CODE_SESSION_ID` tier and fall back to the `"local"` behaviour if verification shows instability. The propagation-and-stability check is a hard acceptance criterion (§8), not an assumption to leave unverified.

**Anti-pattern:** adding a manual operator flag (a `--force-close`, a `--session` override) to paper over the block. Why: the manual `--close` is exactly the workaround this ticket removes; the reconciliation must be automatic.

**Anti-pattern:** re-implementing the "would block?" logic separately in `inflightcheck` and `turncheck`. Why: the two drift, and a residual marker slips through both hooks or is double-blocked; one shared `inflightWouldBlock` is the single source.

**Anti-pattern:** making `isHarnessTrackedBackground` fail open when the signal is missing. Why: a genuinely stranded headless child must be caught; absence degrades to block, not to skip.

## 5. Scenarios — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given two interactive Claude Code sessions with distinct CLAUDE_CODE_SESSION_ID and neither FAFF_RUN_DIR nor FAFF_SESSION_ID
And session A has opened a fresh in-flight marker for FAFF-1078
When session B reaches turn-end and inflightcheck --hook runs in B's env
Then B does not emit a block payload for FAFF-1078 (A's marker is foreign to B)
```

```
Given an interactive Claude Code session (CLAUDE_CODE_SESSION_ID set, FAFF_RUN_DIR unset)
And it has opened a fresh in-flight marker it owns
When inflightcheck --hook runs at that session's turn-end
Then no block payload is emitted for that marker and a non-blocking stderr note is written
```

```
Given a legacy marker under the "local" scope with owner:{}
And a session whose resolveOwnerScope returns a real CLAUDE_CODE_SESSION_ID slug
When inflightcheck --hook runs
Then the legacy marker never produces a block payload for that session
```

```
Given an interactive session that opened a marker under its CLAUDE_CODE_SESSION_ID scope
When the same session runs faff inflightcheck --close --key <ISSUE>
Then the marker file at .faff/inflight/<claude-session-slug>/<ISSUE>.json is removed (open/close env-symmetry)
```

- The block predicate used by `inflightHookDecision` and by `turncheck`'s `hasOpenInflightForOwner` MUST be the same function (no divergent re-implementation).

## 6. Design Decision Rationale

**Which ownership model brings `inflightcheck` onto the sibling basis?**
- *Extend path-scope chain* — pro: minimal, preserves fail-closed-on-corrupt-body, sweep, traversal-safety, `--close` symmetry, `turncheck` alignment for free; con: keeps two identity mechanisms in the tree (path-scope here, body-owner in runcheck).
- *Full body-owner conversion* — pro: one model across the family; con: loses fail-closed-on-corrupt-body, forces `turncheck` rework, larger blast radius.
- *Hybrid populate+read* — pro: real `owner.session_id` available; con: reading body for ownership reintroduces the corrupt-body fail-open path.

**Chosen:** extend the path-scope chain with a `CLAUDE_CODE_SESSION_ID` tier, and additionally stamp `owner.session_id` for attribution while keeping the decision path-derived. Rationale: smallest correct change that preserves every guard invariant.

**How does the guard tell a tracked background dispatch from a genuine strand?**
- *`FAFF_RUN_DIR`-absence + `CLAUDE_CODE_SESSION_ID`-presence proxy* — pro: available today, matches the sibling gates' env reliance, correct for autonomous beep-boop (the case that matters); con: misclassifies bare `claude -p` prep-without-a-run.
- *A positive harness-capability API or task-state consult* — pro: exact; con: no such signal exists in `detectHarnessFromEnv` today (it cannot distinguish interactive from `-p`).

**Chosen:** the env proxy for v1, defaulting to block whenever the interactive signal is not positively present. Rationale: fixes the common interactive case now, degrades safely, and leaves the exact positive signal as an explicit Punt.

**Should the Producer-dispatch contract relax `run_in_background: false`?**
- *Keep "foreground (mandatory)"* — con: unsatisfiable under Claude Code's Agent tool, so the contract lies about what is enforceable.
- *Relax to "foreground OR harness-tracked-background"* — pro: matches reality and the guard's new disposition; con: needs a one-line marker-semantics note.

**Chosen:** relax the kernel wording (`kernel.md:337-339`, and the mirrors in `faff-beep-boop/SKILL.md` and `faff-prep/SKILL.md`) to "foreground when the harness supports it, OR harness-tracked-background when the harness guarantees parent re-invocation on child completion". The marker protocol is unchanged (open before dispatch, close on result); only the **turn-end disposition** varies by the harness signal. At the time of writing, Claude Code's Agent tool has no foreground option, which is what makes the current wording unsatisfiable.

**Does `turncheck` need the same change?**

**Chosen:** yes, by construction. `turncheck` reuses `resolveOwnerScope` (so it inherits the scope fix) and must call the shared `inflightWouldBlock` in `hasOpenInflightForOwner` (so its defer mirrors the new block). No interactive block outcome changes today (interactive sessions are not run owners), but the coupling comment at `turncheck.js:48-55` requires the defer to track the block exactly.

## 7. Open Questions and Assumptions

**Open Questions.**

**Punt:** the robust positive "harness-tracked-background" signal — needs human `(decides: architecture)`. The v1 fix uses `CLAUDE_CODE_SESSION_ID present AND FAFF_RUN_DIR absent` as an interactive proxy. It misclassifies a bare `claude -p` prep run with no `FAFF_RUN_DIR` (headless, cage dies at turn-end) as interactive, leaving that rare strand uncaught at turn-end (swept at TTL instead). Resolving this needs one of: a harness-capability API that positively reports "backgrounded children are re-invoked", a task-state consult, or a marker field written at open time recording the dispatch's re-invoke expectation. None exists today (`detectHarnessFromEnv` cannot distinguish interactive from `-p`). Defer the hardening; ship the safe-degrading proxy.

**Assumptions.**

**Assumes:** `CLAUDE_CODE_SESSION_ID` is present and stable in the Stop-hook subprocess env under interactive Claude Code. Validation: before relying on the scope, add a test (or a one-off empirical check) that the value seen by `inflightcheck --hook` equals the value seen at `--open` time within one session; FAFF-205's build note warns `FAFF_RUN_DIR` propagation into Stop hooks is not guaranteed, so treat this as verify-not-assume. If it is absent or unstable, the code degrades to `"local"` (current behaviour) rather than regressing.

**Assumes:** autonomous beep-boop always sets `FAFF_RUN_DIR`. Validation: confirmed by the sibling gates' reliance on it (`runcheck.js:100-101`, `turncheck` env model); re-check that beep-boop's dispatch env still exports it before shipping.

## 8. DONE — Definition of Done

### From WHY
- [ ] Two interactive sessions with distinct `CLAUDE_CODE_SESSION_ID` and no `FAFF_RUN_DIR`/`FAFF_SESSION_ID` do not cross-block at turn-end (Dimension 2 pain resolved).
- [ ] A session's own harness-tracked-background marker does not force a manual `--close` at turn-end (Dimension 1 pain resolved).
- [ ] No new manual operator verb/flag/workaround is added.

### From WHAT (types and interfaces)
- [ ] `resolveOwnerScope` returns `slug(CLAUDE_CODE_SESSION_ID)` when `FAFF_RUN_DIR` and `FAFF_SESSION_ID` are both absent and `CLAUDE_CODE_SESSION_ID` is set; returns `"local"` when all three are absent.
- [ ] `--open` writes `owner.session_id` from `FAFF_SESSION_ID` else `CLAUDE_CODE_SESSION_ID`; omits the field when neither is set; still never writes `pid`.
- [ ] `inflightWouldBlock(marker, nowMs, env)` is exported from `inflightcheck.js` and is the sole "would block?" predicate.
- [ ] `isHarnessTrackedBackground(env)` returns true iff `CLAUDE_CODE_SESSION_ID` is set and `FAFF_RUN_DIR` is unset.

### From HOW (behaviour)
- [ ] `inflightHookDecision`: owned + fresh + harness-tracked-background emits a non-blocking stderr note and no block payload.
- [ ] `inflightHookDecision`: owned + fresh + `FAFF_RUN_DIR` set still emits a block payload (headless unchanged).
- [ ] `inflightHookDecision`: owned + stale still sweeps; owned + corrupt still blocks; foreign still warns/silent, never blocks except `--recover`.
- [ ] `turncheck.hasOpenInflightForOwner` calls `inflightWouldBlock` (no divergent re-implementation), so its defer mirrors the block.

### From HOW (edge cases)
- [ ] Absent `CLAUDE_CODE_SESSION_ID` degrades to `"local"` scope and to blocking (no new fail-open).
- [ ] `--open` then `--close` within one interactive session target the same scope path (env-symmetry).
- [ ] A legacy `owner:{}` / `"local"`-scoped marker never blocks a session that resolves a real scope.

### From verification (the propagation Assumes)
- [ ] A test or documented empirical check confirms `CLAUDE_CODE_SESSION_ID` is present and equal between `--open` and `--hook` within one interactive session, or the fallback-to-`"local"` path is proven safe if it is not.

### From contract wording
- [ ] `kernel.md:337-339` (and the `faff-beep-boop` / `faff-prep` mirrors) relax `run_in_background: false (mandatory)` to "foreground OR harness-tracked-background", with the unchanged marker protocol and the varying turn-end disposition noted.

### Tests (the untested surface this fix adds)
- [ ] `test/inflightcheck.test.mjs`: interactive `"local"`-collapse cross-block case (two sessions, no `FAFF_*`, distinct `CLAUDE_CODE_SESSION_ID`) proves no cross-block.
- [ ] Own-marker-under-interactive-Claude-Code disposition (non-block + note) and own-marker-under-`FAFF_RUN_DIR` (block).
- [ ] Foreign owner-less legacy non-block.
- [ ] Open/close env-symmetry under the `CLAUDE_CODE_SESSION_ID` scope.
- [ ] `test/turncheck.test.mjs`: `hasOpenInflightForOwner` mirrors the new block predicate (interactive fresh own marker is not deferred-on in a way that could strand the residual).
- [ ] The inline selftest tables in `inflightcheck.js` cover the harness-tracked-background disposition and the new scope tier.

**Integration smoke test.**

```
1. Set env: CLAUDE_CODE_SESSION_ID=sess-A, FAFF_RUN_DIR unset, FAFF_SESSION_ID unset
2. faff inflightcheck --open --key FAFF-1096 --describe spec-review
   → marker at .faff/inflight/<slug(sess-A)>/FAFF-1096.json with owner.session_id=sess-A
3. faff inflightcheck --hook   (same env)
   → no block payload; a non-blocking stderr note naming FAFF-1096
4. In a second env CLAUDE_CODE_SESSION_ID=sess-B: faff inflightcheck --hook
   → no block payload (FAFF-1096 is foreign to sess-B)
5. Back in sess-A: faff inflightcheck --close --key FAFF-1096
   → marker removed; faff inflightcheck --hook reports clean
```

## Already shipped against this surface

- **FAFF-205** shipped `runcheck`'s ownership + liveness gate (`runIsOwned` / `runIsHeld`), the real-session-identity owner model this change mirrors.
- **FAFF-233** shipped heartbeat-only liveness (`runIsHeld`, `pid` recorded but never consulted), which `inflightForeignHeld` tier (a) already delegates to.

Neither supersedes this ticket: they built the sibling model; this ticket brings `inflightcheck` (and the mirrored `turncheck` defer) onto it for the interactive Claude Code session identity they never covered.

confidence: medium
build-tier: complex
spec-review: approve
