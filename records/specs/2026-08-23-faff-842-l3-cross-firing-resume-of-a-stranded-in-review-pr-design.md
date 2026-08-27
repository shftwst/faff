# FAFF-842 — L3 cross-firing resume of a stranded In Review PR (recovery-claim + disposition)

> Spec: faffter-dark-nlspec · 2026-08-23 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-842.

_Refreshed 2026-08-23 (interactive) — folds the **human decision of 2026-08-22**: the stale-reclaim of a crashed holder's recovery-claim gates on the **holder's heartbeat staleness**, not claim age. This closes the sole open Punt (stale-reclaim TTL / force-update policy) and re-rates the spec to `confidence: high`. The write-once ref mint / first-writer-wins / release-on-terminal machinery is unchanged; only the age-based stale check is replaced by a heartbeat gate that reuses faff's existing owner-heartbeat-staleness liveness model. The fencing (provably-stale **and** `faff-claimed` provenance, never seize a live or human claim) is retained. No other decision, interface, or scope changes._

This is the nlspec spec for **FAFF-842**, a re-spec after a round-1 `spec_review` **reject-approach** carrying two BLOCKER objections against the concurrency-safety mechanism. It is written for the build agent that will implement the endgame-only landing resume, and for the human reviewers who must ratify a change to faff's own multi-orchestrator machinery. The previous spec's disambiguation predicate (a self-restored landing boundary) was proven unsafe against double-drain across two concurrent recoverers; this revision replaces it with a real cross-executor claim and keeps every other confirmed-sound decision intact.

## 1. WHY — Problem and Principles

**The load-bearing model.** Resuming a stranded `In Review` + open-PR issue on a *later, different* executor is only safe if the resume is **mutually exclusive across boxes**. There is exactly one shared surface every executor can compare-and-set against: a **write-once git ref in the shared (`git-remote`) bundle store**. The endgame-only pass deliberately skips the tracker `In Progress` claim (it does not rebuild), and that claim is best-effort anyway — the tracker MCP has no compare-and-set (gateway → *Issue claim & status monotonicity*, `faff/SKILL.md:633`). The self-restored landing boundary is **local to each box's filesystem** and reconstructed independently on every box, so it can never discriminate a live peer. The mechanism this spec turns on: a first-writer-wins **recovery-claim ref** (`refs/faff/recovery-claims/<issue>`) minted by a **non-force push** at endgame admission. One executor's push is accepted; the peer's is rejected (ref exists); only the holder runs `landing_loop`; the holder **ticks a heartbeat into its claim while the landing pass runs** and releases the ref on terminal disposition; a claim whose **holder heartbeat has gone provably stale** is reclaimable under a fence that mirrors tidy's existing stale-claim carve-out.

**Problem statement.** A stranded `In Review` issue with an open PR (its original executor crashed or moved on) is currently red-flagged by disposition and never resumed, even though its landing boundary survives in the off-box Phase-0 bundle. This change lets a later L3 executor — including one with no local run dir — admit that issue for an **endgame-only landing pass** (re-enter graft's `landing_loop`, **no rebuild**), recovering the boundary from the reconstructed bundle, while disposition stops spuriously reding a resumable landing but still reds a genuine hard-park.

**Design principles.**

- **The recovery-claim ref is the concurrency floor — nothing else.** No local filesystem signal (a restored `landing-progress.json`, a local idempotency verdict) may stand in as the mutual-exclusion primitive. The floor is a shared-store CAS observable *across* executors, or there is no admission.
- **A crashed holder is detected by heartbeat liveness, not claim age.** The holder ticks a heartbeat into the claim while it runs the landing pass; a peer reclaims **only** when that heartbeat is provably stale (the holder is not ticking), never merely because the claim's age crossed a TTL. This is faff's existing heartbeat-is-liveness model (`runIsHeld` / owner heartbeat staleness), reused rather than a second age-based mechanism. It closes the live-but-slow-holder double-drain window an age-based TTL leaves open: a slow-but-working holder keeps its heartbeat fresh and is never reclaimed.
- **Fail-safe collapses to `claimed-by-peer`.** Every ambiguity — mint fails or is uncertain, store not claim-capable, `gh`/read failure, PR not open, boundary of unknown provenance, `fix_cycles >= 3`, a claim whose heartbeat is *fresh* — resolves to **skip as claimed-by-peer**, never to a speculative landing pass. Double-drain is the one outcome the design forbids; a missed resume is merely a deferral (the next pass, or a human, picks it up).
- **Single-owner budget.** Only the claim-holder runs the landing pass, so the `fix_cycles < 3` hard-park budget is honoured exactly once. The recovered `fix_cycles` is the *starting* budget the holder continues from — never re-zeroed, never counted on two boxes.
- **Additive and reversible.** Every change is additive (a new ref namespace, one new ledger array member, additive skill branches) and sits outside runcheck's completeness invariant. No migration, no terminal-state change.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| git-remote bundle store | `bundle_store: git-remote` (`.faffrc.yaml:24`, FAFF-861) | Shared store whose write-once `refs/faff/bundles/…` ref is the CAS this reuses |
| Bundle immutability CAS | FAFF-819 | Prior use of the same non-force-push write-once-ref primitive |
| Owner heartbeat staleness | `runIsHeld` / owner-heartbeat model (`runcheck.js`, `heartbeat.js`); FAFF-233 | The heartbeat-is-liveness model the stale-reclaim now reuses (not age-based `claim_ttl_hours`) |
| Stale-claim reclaim fence | gateway carve-out 2 (`faff/SKILL.md:636`); tidy (`faff-tidy/SKILL.md:295-296`) | The `faff-claimed`-provenance fence this mirrors (the *fence*; the staleness test is now heartbeat, not age) |
| Disposition | `disposition.js:36` (`ATTENTION_OUTCOMES`), `:110-116` (per-issue loop) | Where the resumable-landing skip is added |
| Bundle recover | `bundle-recover.js:296,:343` (`reconstructProjection`), `:489-492` (local idempotency) | Restores `landing-progress.json`; the misread round-1 concurrency floor |
| graft landing loop | `faff-graft/SKILL.md:577,:587,:593,:751,:813` | `landing_loop`, hard-park, `landing-resumable` token, dispatch, annotation |
| beep-boop admission | `faff-beep-boop/SKILL.md:208` | Claim-before-admit paragraph; additive branch site |

**Scope statement.** This is the recovery path for one specific stranded state (`In Review` + one open PR) under the `git-remote` bundle store; it sits beside the normal claim-before-admit gate, not inside the build pipeline.

## 2. OUT OF SCOPE

- **Rebuild / re-implementation on resume.** Excluded — the resume is endgame-only (landing pass, no build). *Why:* a rebuild would re-run review/CI/merge from scratch and could contradict the already-open PR. *Extension point:* graft's build phase (`faff-graft/SKILL.md`, Step 5 onward) already owns the from-scratch path; a future issue that wants rebuild-on-resume extends there, not here.
- **Cross-box resume under the default `local` bundle store.** Excluded by carve-out — a `local` bundle is on-box only (`<root>/.faff/bundles/…`), unreachable by a peer, and offers no shared CAS. *Why:* there is no claim-capable surface, so admission would reintroduce the double-drain. *Extension point:* a future shared-local-store bridge (a store mode that publishes claims) would relax this; until then, `local` → skip `claimed-by-peer`.
- **Tracker `In Progress` claim / status-monotonicity machinery.** Unchanged (gateway → *Issue claim & status monotonicity*, its two enumerated carve-outs). *Why:* the endgame pass deliberately does not take the In-Progress claim; the git-ref CAS is its exclusion primitive. *Extension point:* n/a — this spec adds a *sibling* claim, it does not touch the tracker claim.
- **New config keys / ledger migration.** Excluded — the heartbeat-staleness threshold reuses the existing owner-heartbeat staleness window (`heartbeatStaleSecs` / `FAFF_RUN_HEARTBEAT_STALE_SECS`, the same knob `runIsHeld` reads); `landing_resumable` is an additive optional array. *Why:* keep the change reversible and migration-free, and reuse the proven liveness threshold rather than mint a recovery-specific one. *Extension point:* a recovery-specific staleness window in `config.js` only if a future run demonstrates the shared window is wrong for this path.
- **Multiple open PRs for one issue.** Excluded — one open PR assumed. *Why:* the stranded state this recovers is the single-PR `In Review`. *Extension point:* the fencing token (PR head sha) would need to become a set; out of this issue.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Recovery-claim | A write-once git ref (`refs/faff/recovery-claims/<issue>`) in the shared bundle store that grants one executor the exclusive right to run the endgame landing pass for one stranded issue |
| Endgame-only pass | Re-entering graft's `landing_loop(issue, pr, run_dir)` with **no** rebuild, from the reconstructed Phase-0 bundle |
| Landing boundary | The `{fix_cycles, last_head_sha, history}` state in `landing-progress.json` — the point the landing pass resumes from |
| Shared / claim-capable store | `bundle_store: git-remote`, whose non-force-push write-once ref is a genuine cross-executor CAS. `local` is neither shared nor claim-capable |
| Fencing token | The open PR's head sha at admission, stored in the claim payload; proves the claim is for a specific PR revision |
| Claim heartbeat | A `last_heartbeat` timestamp the holder refreshes into the claim ref while `landing_loop` runs; the liveness signal a peer reads to tell a live holder from a crashed one |
| `claimed-by-peer` | The skip disposition (gateway → *Disposition for a peer-claimed issue*): never enters `admitted`, never parked |
| Stale reclaim | Seizing a crashed holder's claim via a sanctioned force-update, fenced to **provably-stale heartbeat** (holder not ticking, staleness > `heartbeatStaleSecs`) + `faff-claimed` provenance |

**Type definitions.**

```
RECORD RecoveryClaim:                # serialized as the write-once ref's target blob/commit
  issue: IssueId                     # ref path key: refs/faff/recovery-claims/<issue>, immutable
  claimer_id: string                 # <run_id>@<host>; release-authority + provenance
  pr_head_sha: string                # fencing token: the open PR head at admission, immutable
  claimed_at: Timestamp              # UTC; mint time — forensics/audit only, NOT the stale test
  last_heartbeat: Timestamp          # UTC; refreshed by the holder while landing_loop runs — the liveness signal
  provenance: "faff-claimed"         # mirrors the tracker claim provenance breadcrumb

  CONSTRAINT ref is minted by NON-FORCE push (write-once CAS); overwrite only via the fenced stale reclaim
  CONSTRAINT last_heartbeat is refreshed by the holder (force-update of its OWN claim) on each landing cycle boundary

ENUM AdmissionDecision:
  admit                              # we hold the claim → dispatch endgame landing_loop
  claimed-by-peer                    # skip: never enters admitted, never parked

ENUM HolderLiveness:                 # from the heartbeat-staleness check (reuses runIsHeld's threshold)
  live                               # now - last_heartbeat <= heartbeatStaleSecs → holder ticking → do NOT reclaim
  stale                              # now - last_heartbeat >  heartbeatStaleSecs → holder not ticking → reclaimable IFF faff-claimed
```

**Ledger surface (additive).**

```
RECORD RunLedger (additive member only):
  landing_resumable: List<IssueId>   # OPTIONAL, default absent → treated as []
                                     # mirrors the shipped review_outage_pending array
                                     # OUTSIDE runcheck's completeness invariant (auditLedger reads
                                     # admitted/outcomes only); governance-profile.js:67 terminal_states
                                     # UNCHANGED; no migration
```

**CLI / config surfaces (all pre-existing, reused).**

- `faff config get bundle_store` → `local | git-remote` (default `local`).
- `heartbeatStaleSecs(env)` / `FAFF_RUN_HEARTBEAT_STALE_SECS` (default 900; `runcheck.js`) → the staleness window the claim-heartbeat check reuses — the same threshold `runIsHeld` applies to the owner heartbeat.
- `faff landing-progress read <run_dir> <issue>` → `{issue, fix_cycles, last_head_sha, history, updated_at}` (`effects.js:368`).
- Git ref ops against the store remote: non-force push (mint), force-update of the holder's **own** ref (heartbeat tick), `git push origin :refs/faff/recovery-claims/<issue>` (release/delete), fenced force-update (stale reclaim).

**Design decisions** — see §6; each concludes with a canonical marker.

## 4. HOW — Behavior

**Architecture.** A new **endgame-admission branch** runs at beep-boop's claim-before-admit paragraph (`faff-beep-boop/SKILL.md:208`), additive, after the `claimed-by-peer` sentence, for an issue observed at `In Review` with one open PR. It reconstructs the Phase-0 bundle, gates on provenance + store-capability + PR-open + budget, then **mints the recovery-claim** by a non-force push. Only on an accepted push does it dispatch the endgame-only `landing_loop`, **ticking the claim heartbeat on each landing cycle boundary**. On terminal disposition it releases (deletes) the ref. A crashed holder's claim self-heals via the fenced **heartbeat-staleness** reclaim.

**Behaviour summary — admission is a CAS gate, not a filesystem inference.** The old predicate asked "did *I* restore a clean boundary?" (a per-box fact). The new predicate asks "did *my* non-force push to the shared ref win?" (a cross-box fact). That is the blocker fix. The stale-reclaim predicate asks "is the current holder's *heartbeat* provably stale?" (a liveness fact), never "is the claim old?" (an age fact) — that is the FAFF-842 refresh.

```
PROCEDURE admit_endgame_landing(issue):        # additive branch at beep-boop claim-before-admit
  1. Reconstruct Phase-0 bundle projection (bundle-recover reconstructProjection).
     IF landing-progress.json was NOT restored from a shared bundle (unknown provenance)
        -> RETURN claimed-by-peer.                         # provenance guard
  2. store = faff config get bundle_store
     IF store != "git-remote"                              # not shared / not claim-capable
        -> RETURN claimed-by-peer.                         # LOCAL-STORE CARVE-OUT
  3. Read the live PR via gh.
     IF read fails OR PR not open
        -> RETURN claimed-by-peer.
     LET H = PR head sha.
  4. lp = faff landing-progress read <run_dir> <issue>
     IF lp.fix_cycles >= 3                                 # hard-park budget already spent
        -> RETURN claimed-by-peer.                         # never resumable
  5. MINT: non-force push write-once ref refs/faff/recovery-claims/<issue>
           carrying { claimer_id, pr_head_sha: H, claimed_at: now, last_heartbeat: now, provenance: "faff-claimed" }.
     a. push ACCEPTED (ref created)         -> WE HOLD THE CLAIM -> go 6.
     b. push REJECTED (ref exists / non-fast-forward)
                                            -> peer holds it -> reclaim_if_stale(issue);
                                               if not reclaimed -> RETURN claimed-by-peer.
     c. push FAILS any other way (network/auth/uncertain)
                                            -> RETURN claimed-by-peer.   # never assume a mint
  6. ADMIT: dispatch endgame-only graft landing_loop(issue, pr, run_dir).
     - Do NOT take the tracker In-Progress claim (endgame-only, no rebuild).
     - Do NOT append to the run-ledger admitted array.
     - lp.fix_cycles is the STARTING budget the loop continues from.
     - TICK the claim heartbeat: on each landing cycle boundary, force-update OUR OWN ref
       with last_heartbeat := now (write-once mint is unaffected; this updates only our own claim).
  7. On terminal disposition (landed/merged, OR hard-park pr-open-for-human) -> release_claim(issue).
```

```
PROCEDURE reclaim_if_stale(issue, existing_claim):     # existing_claim read from the ref blob
  1. liveness = (now_utc - existing_claim.last_heartbeat) <= heartbeatStaleSecs(env) ? "live" : "stale"
                                                # reuses runIsHeld's owner-heartbeat staleness threshold — NOT claim age
  2. IF liveness != "stale"                     -> RETURN not-reclaimed.   # a LIVE peer is still ticking — never seize
  3. IF existing_claim.provenance != "faff-claimed"
                                                -> RETURN not-reclaimed.   # human/unprovable: surface, never seize
  4. Sanctioned FORCE-UPDATE the ref to our own RecoveryClaim (fenced: heartbeat stale AND faff-claimed).
     Re-read the ref; IF it does not now carry our claimer_id -> RETURN not-reclaimed (a racing reclaimer won).
  5. RETURN reclaimed  ->  caller proceeds as holder (and begins ticking its own heartbeat per step 6).
```

```
PROCEDURE release_claim(issue):                # on terminal disposition only
  1. git push origin :refs/faff/recovery-claims/<issue>     # delete the ref
  2. delete FAILS -> log + surface under Human follow-ups; NEVER halt the queue.
     (A leaked ref self-heals: its heartbeat stops ticking, goes stale, and the next pass reclaims it.)
```

**Disposition wiring** (`disposition.js`, `computeDisposition` per-issue loop `:110-116`):

```
PROCEDURE computeDisposition (additive guard only):
  resumable = Array.isArray(ledger.landing_resumable) ? Set(ledger.landing_resumable) : Set()   # mirror mergedMap/custodyMap coercion (:100,:104)
  FOR each (issue, outcome):
    IF outcome == "pr-open" AND resumable.has(issue):
       continue                          # additive: a resumable landing is NOT red
    ... existing ATTENTION_OUTCOMES red logic UNCHANGED (pr-open stays in the set at :36) ...
```

- A `pr-open` **not** in `landing_resumable` still reds — including the 3-cycle hard-park `pr-open-for-human`, which is **never** added to the array.
- `beep-boop` appends `issue` to `ledger.landing_resumable` **only** on a `landing-resumable` token return from the endgame dispatch (`faff-graft/SKILL.md:593` → pr-open bucket + annotation `:813`). It **never** appends the hard-park (`pr-open-for-human`, `:587`).

**Edge cases and error handling.**

- **Store not `git-remote`** → skip `claimed-by-peer` (step 2). This alone removes cross-box double-drain for the default `local` store.
- **PR closed/merged between reconstruction and admission** → PR-not-open → skip (step 3); if we already hold a claim, `release_claim`.
- **Fencing-token mismatch** (the open PR head no longer equals a stale claim's `pr_head_sha`) → treat the PR as moved on; skip `claimed-by-peer` rather than reclaim against a stale revision.
- **Claim heartbeat still fresh** (holder ticking) → `reclaim_if_stale` returns not-reclaimed at step 2 → skip `claimed-by-peer`. A live-but-slow holder is never seized — the window an age TTL left open is closed.
- **Release delete fails** → housekeeping, never a queue-halt; the leaked ref stops ticking, goes stale, and is reclaimed later.
- **Mint push rejected for a reason we cannot classify as ref-exists** (ambiguous stderr) → treat as uncertain → skip `claimed-by-peer` (step 5c). Never assume the mint succeeded.

**Failure modes.**

- **The failure:** the `git-remote` store's bundle push is *not actually* a non-force write-once CAS (e.g. it force-pushes, or a proxy/mirror coerces the ref update), so a second concurrent mint also "succeeds." **How you'd know:** the two-recoverer scenario (§5.1) shows two accepted pushes / two concurrent `landing_loop`s against one PR. **What it means:** abandon the ref-CAS-on-this-primitive approach — require a store that guarantees non-force write-once, or gate admission off entirely. This is why the push mechanics are an `**Assumes:**` with a validate step, not a bare claim.
- **The failure (the round-1 correction):** the previous spec cited the **local** not-yet-present idempotency guard as the concurrency floor — `existingLedgerBytes = fs.existsSync(realLedgerPath) ? … : null`, `realRunDir = <resolvedRoot>/.faff/runs/<run_id>`, `idempotencyDecision(existingLedgerBytes, …) === "absent"` (`bundle-recover.js:489-492`). **How you'd know:** two distinct boxes each independently observe `decision === "absent"` (they always do — the path is local to each root, reconstruction consumes/marks nothing in the shared store and makes no forge call), each restore the boundary, each satisfy the old `no_live_peer` predicate, both admit. **What it means:** the local guard is a *within-reconstruction* correctness property (FAFF-820), **not** a cross-executor mutual-exclusion primitive — it is NOT the floor. The recovery-claim ref is the floor. (Documented here so the build agent does not re-adopt the local signal.)
- **The failure the heartbeat gate closes:** an age-based stale reclaim would force-update a *live-but-slow* holder that merely crossed a TTL while still mid-`landing_loop` → double-drain, `fix_cycles` honoured twice. **How you'd know:** two `landing_loop`s observed against one PR immediately after a reclaim; the hard-park budget exceeded. **What it means:** this is exactly why the reclaim gates on **heartbeat staleness**, not age — a working holder keeps ticking and is never seized. The residual window is only a holder that crashes *and* whose heartbeat then ages past `heartbeatStaleSecs` before a peer reclaims, which is the intended, bounded recovery case, not a live double-drain.
- **The failure:** a holder crashes after mint, before release, and its PR never lands → the issue is stuck behind the claim until its heartbeat goes stale. **How you'd know:** a recovery-claim ref whose `last_heartbeat` is older than `heartbeatStaleSecs` against an unmerged PR. **What it means:** acceptable — the heartbeat-staleness reclaim self-heals it on the next qualifying pass. Named as a valid bounded outcome, not a gap.

**Anti-patterns.**

- **Anti-pattern:** using the self-restored landing boundary (local `landing-progress.json` presence, or the local `idempotencyDecision === "absent"`) as the mutual-exclusion signal. **Why:** it is local to each box's filesystem and reconstructed independently on every box — it never discriminates a live peer. This is the exact round-1 blocker.
- **Anti-pattern:** reclaiming on claim *age* (`claimed_at` + a TTL) instead of holder heartbeat staleness. **Why:** age cannot distinguish a crashed holder from a slow-but-working one, re-opening the double-drain window this refresh closes. The stale test is heartbeat liveness only.
- **Anti-pattern:** taking the tracker `In Progress` claim for the endgame pass. **Why:** the endgame pass deliberately skips it (no rebuild), and it is best-effort with no CAS (`faff/SKILL.md:633`). The git-ref CAS is the real primitive.
- **Anti-pattern:** force-pushing to *mint* a claim (overwriting an existing ref to "win"). **Why:** it destroys first-writer-wins. Force-update is sanctioned **only** for the holder ticking its **own** heartbeat, or inside the provably-stale reclaim fence (heartbeat stale **and** `faff-claimed`).
- **Anti-pattern:** adding the 3-cycle hard-park (`pr-open-for-human`) to `landing_resumable`. **Why:** it must still red — it is a genuine hard-park, not a resumable landing.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Scenario 1 — Concurrent recoverers, exactly one admits (the blocker fix)
Given two L3 executors on distinct boxes both reconstruct the same stranded
      In-Review + open-PR issue from the shared git-remote bundle
When both attempt endgame admission concurrently
Then exactly one non-force push to refs/faff/recovery-claims/<issue> is accepted
     and that executor runs landing_loop
 And the other executor's push is rejected (ref exists) and it skips claimed-by-peer
 And no two landing_loops ever run against the same PR concurrently
```

```
Scenario 3 — Release frees a future recovery
Given the claim-holder reaches terminal disposition (PR merged, OR hard-park pr-open-for-human)
When release_claim runs
Then refs/faff/recovery-claims/<issue> is deleted
 And a later legitimate recovery of the same issue can mint a fresh claim
```

```
Scenario 4 — Disposition: resumable pr-open not red; hard-park still red
Given ledger.landing_resumable contains issue X recorded with outcome pr-open
  And issue Y recorded with outcome pr-open-for-human is NOT in landing_resumable
When computeDisposition runs
Then X is not red (the additive continue fires)
 And Y still reds (a hard-park is not a resumable landing)
```

```
Scenario 5 — Single-owner fix-cycle budget
Given the recovered fix_cycles is 2 and the sole claim-holder runs one more landing cycle
When fix_cycles reaches 3
Then the holder hard-parks pr-open-for-human
 And the issue is NEVER added to landing_resumable
 And the 3-cycle budget is honoured exactly once (no second box ever continued the count)
```

```
Scenario 6 — Stale reclaim is fenced to a provably-dead heartbeat, provably-faff
Given a crashed holder left a recovery-claim whose last_heartbeat has aged past heartbeatStaleSecs
When a new recoverer evaluates it
Then it may reclaim (fenced force-update) ONLY IF the heartbeat is stale
     AND the claim carries faff-claimed provenance
 And a claim whose heartbeat is still fresh (holder ticking), OR without faff-claimed provenance,
     is NOT reclaimed — the recoverer skips claimed-by-peer
```

```
Scenario 7 — Live-but-slow holder is never seized (the heartbeat gate)
Given a holder is still mid-landing_loop and keeps ticking its claim heartbeat
When a peer evaluates the claim after a long interval
Then the peer reads last_heartbeat as fresh (<= heartbeatStaleSecs), classifies it live,
     and skips claimed-by-peer — no force-update, no double-drain
```

## 6. Design Decision Rationale

**Which primitive provides cross-executor mutual exclusion for the endgame pass?**
- *Self-restored landing boundary (round-1):* local per-box, reconstructed on every box, no shared consume, no forge call — proven to double-drain. Rejected.
- *Tracker In-Progress claim:* endgame pass deliberately skips it; best-effort, no CAS. Rejected as the floor.
- *Write-once ref in the shared bundle store:* a genuine first-writer-wins CAS (git server-side ref-update atomicity), the same primitive FAFF-819 uses for bundle immutability; observable across executors. **Chosen:** `refs/faff/recovery-claims/<issue>` minted by a non-force push is the recovery-claim; first writer wins, a peer's rejected push → `claimed-by-peer` — the concurrency floor.

**Is the git-remote store's push a sound CAS to build on?** The recovery-claim inherits the store's write-once-ref semantics. **Assumes:** the `git-remote` store publishes via a non-force push to `refs/faff/bundles/<run_id>/seg-<seg>/<key>` and surfaces a ref-exists / non-fast-forward rejection distinguishably (FAFF-819 immutability CAS; FAFF-861). Validate before building on it (see §7).

**How to bound the mechanism to a claim-capable store?**
- *Admit under any store:* reintroduces double-drain for `local` (on-box, unreachable, no CAS). Rejected.
- *Admit only under `git-remote`:* **Chosen:** if the recovered bundle is not from a shared/claim-capable store, do NOT admit — skip `claimed-by-peer`. This alone removes cross-box double-drain for the default `local` store.

**What keys the claim, and how is a specific PR revision fenced?** **Chosen:** ref path keyed on `<issue>`; the claim payload carries `pr_head_sha` as a fencing token (plus `claimer_id`, `claimed_at`, `last_heartbeat`, `provenance`). The token lets the stale reclaim refuse a moved-on PR and lets a resumer detect supersession. (Keying the ref path itself on `<issue,PR-head-sha>` was considered but rejected — it would let two revisions of one PR both hold "a" claim; one claim per issue is the invariant.)

**When is the claim released?** **Chosen:** the holder deletes the ref on terminal disposition — PR merged/landed, or the hard-park `pr-open-for-human`. Release failure is housekeeping (never a halt); a leaked ref stops ticking and self-heals via the heartbeat-staleness reclaim.

**What is the stale-reclaim policy for a crashed holder's claim?** *(Resolved by human decision, 2026-08-22.)*
- *Options considered:* (a) reuse `claim_ttl_hours` (default 6) + a fenced force-update on claim age; (b) a longer recovery-specific TTL; (c) a holder heartbeat gate; (d) defer reclaim to a human.
- Any age-based test (a/b) force-updates a *live-but-slow* holder that merely crossed a TTL while still mid-`landing_loop` — a genuine double-drain window. Deferring every reclaim to a human (d) makes the recovery path non-autonomous for the common crashed-holder case.
- **Chosen:** option (c) — **reclaim on holder heartbeat staleness, not claim age.** The holder ticks a `last_heartbeat` into its claim on each landing cycle boundary; a peer reclaims only when that heartbeat is provably stale (`now - last_heartbeat > heartbeatStaleSecs`, reusing `runIsHeld`'s owner-heartbeat threshold), fenced additionally to `faff-claimed` provenance. This reuses faff's proven heartbeat-is-liveness model rather than minting a second age-based mechanism, and closes the live-but-slow-holder window an age TTL leaves open. `claimed_at` is retained on the claim for forensics/audit but is **not** the stale test. *(Rationale: the human decision of 2026-08-22 ratifies the heartbeat gate as the safety-critical multi-orchestrator coordination policy for faff's own machinery.)*

**How does disposition stop reding a resumable landing without un-reding a hard-park?** **Chosen:** keep `ATTENTION_OUTCOMES` (`:36`) unchanged with `pr-open` in it; add `if (outcome === "pr-open" && resumable.has(issue)) continue` at the per-issue loop (`:110-116`), with `Array.isArray(ledger.landing_resumable) ? … : []` coercion (mirrors `mergedMap`/`custodyMap` at `:100,:104`). A `pr-open` not in the array — including `pr-open-for-human` — still reds.

**Where does the resumable signal live?** **Chosen:** an additive top-level ledger array `landing_resumable: [issue-id]`, mirroring the shipped `review_outage_pending`, written by beep-boop on a `landing-resumable` return, outside runcheck's completeness invariant (`auditLedger` reads admitted/outcomes only; `governance-profile.js:67` `terminal_states` unchanged; no migration).

*Temporal anchor:* at the time of writing, `bundle_store` in this repo is `git-remote` (`.faffrc.yaml:24`, FAFF-861) and `heartbeatStaleSecs` defaults to 900s (`FAFF_RUN_HEARTBEAT_STALE_SECS`, `runcheck.js`); revisit the reclaim threshold only if a run demonstrates the shared owner-heartbeat window is wrong for this path.

## 7. Open Questions and Assumptions

**Open Questions.** None. *(The stale-reclaim policy — previously the sole open Punt — was closed by the human decision of 2026-08-22: reclaim on holder heartbeat staleness, fenced to `faff-claimed`. See §6.)*

**Assumptions.**

- **Assumes:** the `git-remote` bundle store publishes bundles via a NON-FORCE push to `refs/faff/bundles/<run_id>/seg-<seg>/<key>` and surfaces a ref-exists / non-fast-forward rejection distinguishably from other push failures (FAFF-819 immutability CAS; FAFF-861). *Validate:* grep the git-remote store implementation for the push invocation; confirm no `--force` and no `+`-prefixed refspec, and that a ref-exists rejection is caught distinctly. If it force-pushes or cannot distinguish the rejection, the recovery-claim CAS is not sound on this primitive — escalate before building step 5.
- **Assumes:** `bundle-recover`'s `reconstructProjection` restores `landing-progress.json` (an `anchors` / `optionalFloorFiles` member, `events.js:1279`) to `<run-dir>/<issue>/landing-progress.json` (`bundle-recover.js:296,:343`). *Validate:* run a reconstruction from a bundle known to carry landing progress and confirm the file lands at that path with the `{issue, fix_cycles, last_head_sha, history, updated_at}` shape.
- **Assumes:** graft's `landing_loop(issue, pr, run_dir)` can be re-entered endgame-only (no rebuild), returns a `landing-resumable` token (`:593`) that buckets to `pr-open` + annotation (`:813`), and hard-parks at `fix_cycles >= 3` returning `pr-open-for-human` (`:587`); `faff next --status in-review` routes to graft (`next.js:71`). *Validate:* confirm these line refs against the merged code before wiring the dispatch; treat any drift as a spec-refresh trigger, not a silent adaptation.
- **Assumes:** the claim-heartbeat force-update (holder refreshing its own ref) and the reclaim force-update are both expressible against the `git-remote` store's ref namespace (the store already supports the write-once mint on the same namespace). *Validate:* confirm a force-update of an existing `refs/faff/recovery-claims/<issue>` ref by its current holder succeeds and is distinguishable from the write-once mint path before wiring the heartbeat tick.

## 8. DONE — Definition of Done

### From WHY
- [ ] The concurrency floor for endgame admission is the recovery-claim ref, not any local filesystem signal (no code path admits on a restored-boundary / local-idempotency signal).
- [ ] A crashed holder is detected by heartbeat staleness (`now - last_heartbeat > heartbeatStaleSecs`), never by claim age; a live-but-slow holder ticking its heartbeat is never reclaimed.
- [ ] Every enumerated ambiguity (mint fail/uncertain, non-`git-remote` store, gh/read failure, PR not open, unknown boundary provenance, `fix_cycles >= 3`, fresh holder heartbeat) resolves to `claimed-by-peer`.

### From WHAT (types and interfaces)
- [ ] The recovery-claim ref path is `refs/faff/recovery-claims/<issue>`; its payload carries `{claimer_id, pr_head_sha, claimed_at, last_heartbeat, provenance:"faff-claimed"}`.
- [ ] The holder refreshes `last_heartbeat` (force-update of its own ref) on each landing cycle boundary while `landing_loop` runs.
- [ ] `landing_resumable` is an additive optional top-level ledger array; absent → treated as `[]`; `governance-profile.js:67` `terminal_states` is unchanged; no migration is introduced.

### From HOW (behaviour)
- [ ] Admission mints via a NON-FORCE push; an accepted push → hold + dispatch endgame `landing_loop`; a ref-exists rejection → evaluate heartbeat-staleness reclaim, else `claimed-by-peer`; any other push failure → `claimed-by-peer`.
- [ ] The endgame pass does not take the tracker In-Progress claim and does not append the issue to the run-ledger `admitted` array.
- [ ] The recovered `fix_cycles` is the starting budget; the loop continues from it and hard-parks `pr-open-for-human` at `>= 3`.
- [ ] `release_claim` deletes the ref on terminal disposition (merged, or hard-park `pr-open-for-human`); a delete failure logs + surfaces and never halts the queue.
- [ ] `disposition.js` gains `if (outcome === "pr-open" && resumable.has(issue)) continue` at `:110-116` with `Array.isArray(...) ? ... : []` coercion; `ATTENTION_OUTCOMES` at `:36` is unchanged.
- [ ] A `pr-open` not in `landing_resumable` — including `pr-open-for-human` — still reds; the 3-cycle hard-park is never added to `landing_resumable`.
- [ ] beep-boop writes `landing_resumable` only on a `landing-resumable` token return; the additive admission branch is added after the `claimed-by-peer` sentence at `faff-beep-boop/SKILL.md:208`.

### From HOW (edge cases + failure modes)
- [ ] `bundle_store: local` → skip `claimed-by-peer` without minting (local-store carve-out).
- [ ] Fencing-token mismatch (open PR head != claim `pr_head_sha`) → skip `claimed-by-peer`, no reclaim against a moved-on PR.
- [ ] Stale reclaim is fenced to a **provably-stale heartbeat** AND `provenance == "faff-claimed"`; a fresh-heartbeat or non-`faff-claimed` claim is never seized.
- [ ] The round-1 failure-mode correction is documented so no path treats `bundle-recover.js:489-492`'s local `idempotencyDecision === "absent"` as the concurrency floor.

### From Scenarios
- [ ] Scenario 1 (concurrent recoverers, exactly one admits) is exercised by a test.
- [ ] Scenario 4 (resumable `pr-open` not red; `pr-open-for-human` still red) is exercised by a disposition test.
- [ ] Scenario 5 (single-owner `fix_cycles` budget) is exercised.
- [ ] Scenario 6 (stale reclaim fenced to a provably-stale heartbeat + provably-faff) is exercised, including the fresh-heartbeat and non-`faff-claimed` negative arms.
- [ ] Scenario 7 (live-but-slow holder ticking its heartbeat is never seized) is exercised.

**Integration smoke test.**

```
1. Under bundle_store: git-remote, stage a stranded In-Review issue with one open PR and a
   Phase-0 bundle carrying landing-progress.json (fix_cycles < 3).
2. Executor A runs the endgame-admission branch:
   - reconstruct -> boundary restored from shared bundle
   - store == git-remote, PR open, fix_cycles < 3
   - non-force push refs/faff/recovery-claims/<issue> ACCEPTED -> dispatch landing_loop
   - tick last_heartbeat on the first landing cycle boundary.
3. Executor B (different box) runs the same branch concurrently:
   - its non-force push is REJECTED (ref exists); it reads A's last_heartbeat as fresh
     -> claimed-by-peer, no landing_loop.
4. A lands the PR -> release_claim deletes the ref.
5. Crashed-holder variant: A mints then dies without ticking; after last_heartbeat ages past
   heartbeatStaleSecs, B reads the heartbeat stale + faff-claimed -> reclaims -> runs landing_loop.
6. Assert: exactly one landing_loop ran per PR at any instant; the ref is gone after merge;
   disposition did not red the issue while it sat in landing_resumable.
   If these paths hold, the CAS mint, heartbeat tick, heartbeat-staleness reclaim, single-owner
   dispatch, release, and disposition skip are wired.
```

confidence: high
spec-review: approve
build-tier: complex
