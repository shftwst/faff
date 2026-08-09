# Spec — FAFF-758: Cross-host stale-claim recovery

> Spec: faffter-dark-nlspec · 2026-08-09 · interactive · confidence: high. Full spec on Linear FAFF-758.

This spec describes cross-host stale-claim recovery for faff issue claims. Audience: the build agent that will implement it, and the human reviewers who gate it.

**Ticket reshape (design converged interactively).** The original ticket was framed as "cross-host claim TTL + host-id owner field." The design was reshaped: **host-id is dropped** (the stale/live decision is time-based, not identity-based, so host identity changes no decision), and the load-bearing mechanism is the tracker's own claim-age plus a `faff-claimed` provenance label. The original title is now stale; this spec carries the corrected framing.

## 1. WHY — Problem and principles

**The core idea:** a faff claim is stale when the tracker says the issue has sat in its claim state longer than any legitimate build would take, and it is safely reclaimable only when faff can prove it set the claim itself. Both facts come from things the tracker already records or that faff already writes at claim time, so recovery needs no new on-disk state, no heartbeat traffic, and no host identity.

**Problem.** faff's only cross-machine coordinator is the tracker: an issue at `In Progress` is the claim that stops two orchestrators building the same ticket (FAFF-82, gateway SKILL.md:625-633). That claim carries no liveness signal, so a crashed run leaves an `In Progress` indistinguishable from a live build, and today recovery is manual (gateway SKILL.md:633). This change gives the claim a time-to-live: a claim older than the configured TTL that faff can prove it owns is auto-reclaimed to `Todo`; anything else is surfaced, never touched.

This is not purely a cross-host problem. Two runs on the same host must also not double-build, and a crashed same-host run leaves the same stale `In Progress`. The tracker-based mechanism covers both, because the stale-versus-live decision is time-based and does not depend on which machine set the claim.

**Design principles.**

**Human curation is authoritative.** Auto-reverting a claim a human set by dragging a card to `In Progress` would override human curation, a hard rule. The reclaim fires only on a claim faff can prove it set; a human-set or unprovable claim is surfaced, never reverted.

**No frequent tracker writes (gateway SKILL.md:490,492).** The mechanism adds no per-interval heartbeat comment or per-step marker. Claim-age is read from state the tracker already keeps, and the one new write (`faff-claimed`) happens once, at the existing claim-time status write, same cadence as the status itself.

**Time decides, not identity.** The stale-versus-live verdict is claim-age against TTL, identical whether the same host or a different host set the claim, so host identity changes no decision and is not recorded.

**Tracker-agnostic by construction.** The mechanism is a semantic, "claim-age is the timestamp of the latest transition into the claim state", resolved per connector by the agent, never a hardcoded Linear field. A connector that cannot expose claim-age degrades to surface-only.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| gateway `plugin/skills/faff/SKILL.md:625-633` | skill prose | The FAFF-82 claim model + status monotonicity this extends and must amend; :631 is the FAFF-403 backward carve-out this composes with |
| `plugin/skills/faff-graft/SKILL.md:243-252` | skill prose | Step 5 sets `In Progress` (the claim); the site that also applies `faff-claimed` |
| `plugin/skills/faff-tidy/SKILL.md:277-289` | skill prose | Auto-action stale-label sweeps; the home for the reclaim and the label backstop |
| gateway `plugin/skills/faff/SKILL.md:832-842` | skill prose | Control-label provisioning: the `faff labels` manifest + the `faff label add\|remove` op |
| `plugin/skills/faff/bin/lib/heartbeat.js`, `runcheck.js` | JavaScript CLI | Local-fs liveness (900s staleness); unchanged, and the same-host early-detection extension point |
| `docs/adr/0007-…`, `docs/adr/0008-…` | ADR | The deferred cross-host seam these two named (host-id / new on-disk fields); a new ADR amends their framing |

**Scope.** This sits inside the FAFF-82 claim model as its recovery half: FAFF-82 defines the claim and forbids clobbering it; this defines when a dead claim is cleared.

## 2. Out of scope

- **Same-host tighter early detection via the local heartbeat.** Same-host runs share `.faff/` and could read the local heartbeat file (900s staleness, tighter than the hours-long tracker TTL). Excluded to keep this tight; the tracker TTL already covers same-host, just less promptly. Extension point: a pre-check in tidy's reclaim pass consulting `runIsHeld` (`runcheck.js`) for same-host-attributable claims.
- **A host-id / new owner-on-disk field.** Not added; an on-disk field is invisible across hosts anyway. Extension point named by ADR-0007/0008 if cross-host owner identity ever earns its cost.
- **Reading the tracker actor to attribute a claim.** Linear's `stateHistory` carries only `{state, startedAt, endedAt}`, no actor (confirmed live); the who-changed-status audit trail is not known to be MCP-exposed. Provenance comes from the `faff-claimed` label instead.
- **A compare-and-set / hard mutex on the claim.** FAFF-82 already rules a heavier lock unjustified; a tight race costs one duplicate build, caught at merge. Unchanged.
- **git-only mode.** No shared tracker means no cross-host stale-claim problem (separate clones); same-host is covered by the local heartbeat. No reclaim path in git-only mode.
- **Not the anchors mechanism (FAFF-568/623).** `faff-claimed` is a live-claim liveness breadcrumb on the tracker, read by tidy during a run; a governance **anchor** is git-committed run-evidence written at PR-open and re-validated by CI at merge. Different question (is-the-claim-alive vs is-the-evidence-genuine), time (claim vs merge), store (tracker label vs git), and consumer (tidy vs CI Action). No overlap, neither substitutes for the other; the reclaim fires only on `In Progress`, so it never touches an anchored run (which is at `In Review`/`Done`).

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Claim | An issue at `In Progress` status (FAFF-82); the cross-machine signal that a run owns the build |
| Claim-age | Elapsed time since the latest transition into the claim state, per the connector's own history surface |
| TTL | The maximum age a live claim can legitimately reach; older than this is stale |
| `faff-claimed` | A faff-owned machine-breadcrumb label applied at claim time, proving faff set the claim |
| Reclaim | Moving a stale, provably-faff claim `In Progress → Todo` so the queue reconsiders it |
| Provable claim | A claim carrying `faff-claimed`; the only kind eligible for auto-reclaim |

**The `faff-claimed` control label.** Added to the `faff labels` CLI manifest (gateway SKILL.md:832) as a faff-owned machine breadcrumb, alongside `faff-parked`, `faff-awaiting-review`, and the rest.

```
LABEL faff-claimed:
  name: "faff-claimed"
  color: <manifest-assigned>
  description: "faff set this issue's In Progress claim; eligible for stale-claim reclaim"
  tracker_owned: false          # faff-writable via `faff label add|remove`, NOT an eligibility throttle
```

Written/removed via the existing `faff label add|remove <issue> faff-claimed` op (gateway SKILL.md:836), same as `faff-parked`/`faff-awaiting-review`. Because `tracker_owned` is false, the op writes it freely; the FAFF-218 refusal applies only to the two eligibility labels.

**The pure claim-verdict CLI.** A new pure subcommand owns the `age + TTL → live|stale` verdict and nothing else, mirroring `faff eligible`'s split: the CLI decides, the agent reads the tracker.

```
COMMAND faff claim-verdict:
  --claimed-at <ISO8601>    # timestamp of the latest transition INTO the claim state (agent supplies)
  --now       <ISO8601>     # injected clock, never read from the system inside the command
  --ttl-hours <N>           # resolved from config by the caller

  emits: { "verdict": "live" | "stale", "age_secs": <int>, "ttl_secs": <int> }

  CONSTRAINT verdict == "stale" IFF (now - claimed_at) > ttl_hours*3600
  --selftest drives the boundary table (age just under / at / just over TTL); no tracker or system clock consulted
```

Pure: it takes `claimed-at` and `now` as explicit inputs, so it is selftestable with no tracker and no clock dependency injected. The tracker read that produces `claimed-at`, and the `faff-claimed` presence check, both stay with the agent.

**Config: the TTL key.** A new top-level `.faffrc` key `claim_ttl_hours`, read via `faff config`, default `6`.

- Options weighed: a new top-level `claim_ttl_hours`; nesting under `budget`; nesting under `graft`. `graft` is wrong (the consumer is tidy, not graft); `budget` is about spend, a different axis; a top-level key reads cleanly for a cross-cutting claim property.
- The default must exceed the longest legitimate build — no build progress is visible across hosts during a long run, so a too-tight TTL yanks live work. Six hours sits well above a typical build while still clearing a genuinely crashed claim within a working session; operators raise it above their longest observed build.

**Chosen:** a new top-level `claim_ttl_hours` key, default `6`, resolved via `faff config`. (decides: architecture)

## 4. HOW — behaviour

**Where each piece lives.** graft applies `faff-claimed` when it takes the claim (Step 5). tidy owns the reclaim: on every pass it already re-fetches live status for each active issue (faff-tidy SKILL.md:36) and auto-clears stale labels, so a stale-claim reclaim is a new auto-action of the same family. graft (and any terminal disposition) clears `faff-claimed` when the claim resolves, with tidy's stale-label sweep as backstop. This mirrors `faff-awaiting-review`'s lifecycle exactly.

**graft Step 5: apply the breadcrumb at claim time.**

```
PROCEDURE claim_issue(issue):          # extends faff-graft Step 5
  1. Re-read live status + eligibility labels (existing FAFF-82 co-located read)
  2. IF status in {In Progress, In Review, Done} or PR merged: skip (claimed-by-peer)   # unchanged
  3. ELSE:
     a. Transition issue -> In Progress            # the claim (unchanged)
     b. faff label add <issue> faff-claimed        # NEW: one write, same cadence as (a)
```

**Clearing the breadcrumb when the claim resolves.**

- On terminal disposition (merged / shipped / needs-human park / fail), graft removes `faff-claimed` in the same housekeeping step that already clears `faff-awaiting-review` (faff-graft SKILL.md:403).
- On the FAFF-403 retry-later release (`In Progress → Todo`, faff-graft SKILL.md:401), graft removes `faff-claimed` too: the claim is being released, so its breadcrumb goes with it.
- Backstop: tidy's stale-label sweep removes `faff-claimed` from any issue no longer at `In Progress` (state-driven only, like `faff-awaiting-review`, faff-tidy SKILL.md:286), catching any breadcrumb graft missed.

**tidy's reclaim pass.**

```
PROCEDURE reclaim_stale_claims():      # new faff-tidy auto-action, runs over active In-Progress issues
  FOR each active issue at In Progress:
    1. claimed_at := connector claim-age read (see semantic below)
       IF connector cannot expose claim-age: surface-only, log "stale-claim check unavailable on <connector>", CONTINUE
    2. verdict := faff claim-verdict --claimed-at claimed_at --now <now> --ttl-hours <config>
    3. IF verdict == "live":  do nothing
    4. IF verdict == "stale":
       a. has_label := issue carries faff-claimed          # agent tracker read
       b. IF has_label:
            - reclaim: transition In Progress -> Todo       # the SECOND sanctioned backward move
            - faff label remove <issue> faff-claimed
            - post one tracker comment: "reclaimed a faff-claimed stale claim (age > claim_ttl_hours); moved to Todo for re-queue"
            - log {issue, age_secs, ttl_secs, action: reclaimed}
       c. ELSE (label absent -> human-set or unprovable):
            - surface only: log "stale claim, no faff-claimed, needs human", leave status untouched
```

**The connector claim-age semantic (the agent's read).** Claim-age is the timestamp of the latest transition into the claim state, resolved per connector:

- Linear: walk `get_issue.stateHistory` for the most-recent entry whose `state` is the `In Progress` status; take its `startedAt`.
- GitHub: the `created_at` of the latest timeline event representing the claim (`labeled` / `assigned` / project-moved, however faff already represents the claim there).
- Jira: the latest status-transition entry into the claim state in the issue changelog.

**Anti-pattern:** reading Linear's issue-level `startedAt` instead of walking `stateHistory`. Why: faff itself bounces `In Progress → Todo → In Progress` on the FAFF-403 retry-later carve-out, and the top-level `startedAt` does not reset on re-entry, so a just-re-claimed ticket would read as hours-stale and be falsely reclaimed, yanking a live build. Always read the latest transition into the claim state.

**How the reclaim composes with status monotonicity — and the canonical guard prose this MUST amend.** The monotonicity guard (gateway SKILL.md:630-631) is forward-only by rank, with one sanctioned backward move today: FAFF-403's `In Progress → Todo` retry-later, where the claim-holder releases its own claim. This reclaim is a second sanctioned `In Progress → Todo` backward move, gated on all of: the issue is at `In Progress`, the claim-verdict is `stale` (past TTL), and `faff-claimed` is present. It differs from FAFF-403 in that a third party (tidy) reverts the claim, not the holder, which is why it is fenced to a provably-faff, provably-dead claim. It never touches an issue at `In Review` or `Done`: the reclaim only fires on `In Progress`, so the guard's real concern (a different writer moving a further-along issue backward) is untouched.

**This is load-bearing prose work, not just reasoning: the canonical guard text at :630-631 currently *forbids exactly this move* and MUST be amended, or the guard will contradict the shipped behaviour.** Two specific edits (a DoD item below requires them):

- **:630** enumerates the forward-only writers as "graft Step 5, the ship producer, **tidy**, beep-boop's post-merge bump … only ever moves forward by rank." tidy is now a writer with a fenced backward move, so this blanket "tidy … only ever moves forward" must be qualified to carve out the stale-claim reclaim.
- **:631** frames FAFF-403 as "**The one** sanctioned backward move … (a) performed by the graft run that itself holds the claim (**never a third party**) … Any other backward move remains forbidden at every appetite level." This must be widened to register a **second** sanctioned carve-out — the tidy stale-claim reclaim — and its "never a third party" absolute reconciled: the reclaim *is* a third party, but a mechanical one fenced to `In Progress` + `stale` verdict + `faff-claimed` present, never touching `In Review`/`Done`, so the guard's actual concern (a different writer moving a *further-along* issue backward) still holds. Frame it exactly as the FAFF-403 carve-out is framed (an enumerated, tightly-fenced exception), not as a loosening of the rule.

Any backward move outside these two enumerated carve-outs remains forbidden.

**Graceful degradation and git-only exemption.** A connector that cannot expose claim-age degrades to surface-only (log unavailable, never reclaim). git-only mode has no reclaim path (no shared tracker; same-host covered by the local heartbeat).

**Failure modes.**

- **TTL shorter than a legitimate long build.** Failure: a real build past TTL is judged stale and reclaimed. How you'd know: a reclaimed issue later produces a PR from a still-running peer, or a merge-time conflict on a ticket tidy just moved to `Todo`. What it means: TTL too tight; raise `claim_ttl_hours`. The `faff-claimed` gate bounds blast radius to faff's own claims, and reclaim is a `Todo` re-queue, not destructive.
- **Claim-age read from the wrong history entry.** Failure: reading the first-ever/top-level timestamp, so a FAFF-403 re-claimed ticket looks stale. How you'd know: an issue reclaimed within minutes of a retry-later resume. What it means: a connector mapping bug; the semantic must be latest-transition-into-claim-state.
- **`faff-claimed` write failed at claim time.** Failure: a live faff build has no breadcrumb, so at TTL it looks human-set. How you'd know: a stale claim surfaced (not reclaimed) that logs show faff started. What it means: the fail-safe direction held (surface-only, no false reclaim); acceptable. The reverse (resolved claim keeping the label) is caught by tidy's sweep.
- **A connector reports a bogus near-zero age instead of no-capability.** Failure: a fresh claim reads ancient (or reverse) and is falsely reclaimed. How you'd know: reclaims firing on fresh claims. What it means: the capability check must be explicit present-or-absent, never a guessed/defaulted age; absent → surface-only.
- **A human round-trips a `faff-claimed` card faster than the sweep clears it.** Failure: because `faff-claimed` removal on a status change is a backstop *sweep* (state-driven, on tidy's pass), not an atomic on-transition clear, a human who takes a faff-claimed issue `In Progress → Todo → In Progress` themselves *between* two tidy passes could carry the stale `faff-claimed` label onto a now-human-set claim — which, past TTL, tidy would then reclaim, lightly overriding the human. How you'd know: a human-driven card reclaimed shortly after they re-touched it. What it means: contrived and non-destructive (a `Todo` re-queue, caught at merge, never lost work), so it is an accepted residual, not a blocker — but the reclaim comment names it as "reclaimed a `faff-claimed` stale claim" so a human who did this sees why. A future tightening (atomic label-clear on the graft-side release, or a claim-age-vs-label-age cross-check) is the extension point; out of scope here.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an issue at In Progress carrying faff-claimed, whose latest In-Progress transition is older than claim_ttl_hours
When /faff-tidy runs its reclaim pass
Then the issue is moved to Todo, faff-claimed is removed, and one tracker comment records the reclaim
```

```
Given an issue at In Progress with NO faff-claimed label (a human dragged it there), older than claim_ttl_hours
When /faff-tidy runs its reclaim pass
Then the status is left untouched and the issue is surfaced as "stale claim, needs human"
```

```
Given an issue at In Progress carrying faff-claimed whose latest In-Progress transition is within claim_ttl_hours (a legitimately long build)
When /faff-tidy runs its reclaim pass
Then the claim is not reclaimed
```

- `faff claim-verdict` produces `live`/`stale` from `--claimed-at`, `--now`, `--ttl-hours` alone; `--selftest` passes with no tracker or system clock consulted.
- A connector with no claim-age capability yields surface-only; git-only exercises no reclaim path.
- `faff labels` lists `faff-claimed`, its manifest entry has `tracker_owned` false.

## 5. Design decision rationale

**Detect a stale claim how — a `claimed_at` on-disk field, a per-interval heartbeat comment, or the tracker's native claim-age?** On-disk is invisible cross-host (rules it out); a per-interval comment floods the board (violates SKILL.md:490,492). **Chosen:** native claim-age — no new write, works cross-host because it reads shared tracker state.

**Add a host-id / owner field (the ADR-0007/0008 deferred extension)?** Both ADRs named a future host-id as the deferred seam. But the decision is time-based and identical regardless of host, faff runs as one bot user (so the host likely isn't even readable), and an on-disk field is invisible cross-host. **Chosen:** not added — the cheaper time-based mechanism makes it unnecessary; a write with no decision value. A new ADR records this path explicitly not taken.

**Establish provenance how, given the actor is not readable?** Linear `stateHistory` has no actor (confirmed); `createdBy` is the creator, not the status-changer. **Chosen:** a `faff-claimed` label at the Step-5 claim (one write, status cadence). Closest precedent `faff-awaiting-review`. Provenance is a label read, not an unavailable actor read.

**What may be auto-reclaimed?** Auto-reverting a human's `In Progress` overrides human curation (hard rule). **Chosen:** reclaim only a stale claim carrying `faff-claimed`; human-set (label absent) is surfaced, never reverted; indeterminable provenance fails safe to surface-only.

**Where does the reclaim live?** **Chosen:** graft applies the label at claim; tidy owns the reclaim; graft/terminal clear the label, tidy's sweep backstops. Mirrors `faff-awaiting-review`.

**Where does the verdict compute?** A tracker read in the CLI breaks its no-MCP purity; TTL arithmetic in the agent is un-selftestable. **Chosen:** a pure `faff claim-verdict` CLI owns `age + TTL → live|stale` (clock injected); the agent owns the tracker read + label check. Mirrors `faff eligible` / `faff next`.

**Config key + default?** **Chosen:** top-level `claim_ttl_hours`, default `6`.

**Same-host early detection in scope?** **Chosen:** no — extension point (the local heartbeat can layer on later); the tracker TTL already covers same-host.

## 6. Open questions and assumptions

**Open questions.** None — every decision is closed.

**Assumptions.**
- **Assumes:** the Linear `stateHistory` shape (no actor, `startedAt` per entry) is as confirmed live, and the sibling connectors (GitHub timeline events, Jira changelog) expose an equivalent latest-transition timestamp. *Validation:* confirmed for Linear; the build agent confirms GitHub/Jira when wiring those connectors (a connector without the capability degrades to surface-only, so a miss is fail-safe).
- **Assumes:** label writes + the `faff label` op already work on every connector faff writes labels to (the `faff-awaiting-review` precedent). *Validation:* established pattern.

## 7. DONE — Definition of Done

### From WHY
- [ ] A stale (past-TTL) `In Progress` carrying `faff-claimed` is auto-reclaimed to `Todo` by tidy, replacing today's manual/surface-only recovery.
- [ ] The mechanism adds no per-interval tracker write; the only new write is `faff-claimed` at claim time.

### From WHAT (types and interfaces)
- [ ] `faff labels` includes `faff-claimed` with `tracker_owned` false.
- [ ] `faff claim-verdict --claimed-at --now --ttl-hours` emits `{verdict, age_secs, ttl_secs}` with `verdict == "stale"` iff `now - claimed_at > ttl`.
- [ ] `faff claim-verdict --selftest` passes the boundary table with no tracker and no system-clock dependency.
- [ ] `.faffrc` `claim_ttl_hours` is read via `faff config`, default `6`.

### From HOW (behaviour)
- [ ] graft Step 5 applies `faff-claimed` in the same operation that sets `In Progress`.
- [ ] graft removes `faff-claimed` on terminal disposition and on the FAFF-403 retry-later release.
- [ ] tidy's stale-label sweep removes `faff-claimed` from any issue no longer at `In Progress` (backstop).
- [ ] tidy reclaims a stale `In Progress` carrying `faff-claimed` by moving it to `Todo`, removing the label, posting one tracker comment, logging `{issue, age_secs, ttl_secs}`.
- [ ] tidy leaves a stale `In Progress` without `faff-claimed` untouched and surfaces it as needs-human.
- [ ] Claim-age is read from the latest transition into the claim state (Linear `stateHistory` latest In-Progress `startedAt`), never the issue-level `startedAt`.

### From HOW (edge cases)
- [ ] A live within-TTL claim is never reclaimed, including a legitimately long build.
- [ ] A ticket re-claimed after a FAFF-403 bounce reads as live (latest-transition read), not falsely stale.
- [ ] A connector that cannot expose claim-age degrades to surface-only; git-only mode exercises no reclaim path.

### From governance
- [ ] **The canonical status-monotonicity guard prose is amended** (gateway SKILL.md:630-631): :630's "tidy … only ever moves forward" is qualified to carve out the reclaim, and :631 is widened to register the tidy stale-claim reclaim as a **second** enumerated, tightly-fenced backward-move carve-out (`In Progress` + `stale` + `faff-claimed`; never `In Review`/`Done`), framed like the FAFF-403 carve-out. Without this, the guard text forbids the behaviour the spec ships.
- [ ] A new ADR records the time-based cross-host reclaim as the one sanctioned tracker-read staleness heuristic, amends the ADR-0007/0008 cross-host framing, and records host-id explicitly not taken.

**Integration smoke test.**
```
1. graft-claim a test issue -> assert status In Progress AND faff-claimed present
2. Set the test connector's latest In-Progress transition to now - (claim_ttl_hours + 1)h
3. Run tidy's reclaim pass
4. Assert: issue at Todo, faff-claimed absent, one reclaim comment posted
5. Repeat 1-3 with the label removed before step 3 -> assert status still In Progress, surfaced not reclaimed
```

confidence: high
