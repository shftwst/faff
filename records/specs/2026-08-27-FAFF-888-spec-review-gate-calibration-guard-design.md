# FAFF-888: spec-review backend reputation ledger — strike a candidate-degenerate reviewer at slot-selection time
> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-888.
> _Revised (round 2): wired occupant consult into DoD; ordered the accept signal._

This spec is for the build agent implementing FAFF-888, and for the human reviewers gating it. FAFF-888 adds a selection-time guard so a mono-severity spec-review backend, one that stamps `critical` on every lens of every spec and so forces `reject-approach` every round regardless of spec quality, cannot serve as the sole gatekeeper of the `spec_review` slot. The guard is a learned per-backend reputation ledger, computed by arithmetic over outcomes faff already records, consulted once when the `spec_review` chain is selected.

The committed decisions on the ticket (dated 2026-08-27, "to survive prep") are human-ratified and are honoured here, not re-opened: the guard is a learned ledger read at selection time (not a synthetic probe, not a curated eval set); it is built from signals faff already produces; v1 is a narrow, faff-owned ledger scoped to this gate and not blocked on the held `learned.yaml` carrier (FAFF-459); it composes with FAFF-870 as a selection-time bar; and it stays determinism-first (arithmetic, no judge). This spec resolves the two items the ticket left open for prep: the sample size and flag thresholds, and whether the peer-disagreement signal is in v1.

## 1. WHY — problem and principles

The load-bearing idea: faff already writes down, per run, both halves of the evidence needed to tell a reflexive reviewer from a calibrated one. It records what each spec-review backend decided (the per-round verdict files, attributable to a backend through the reviewer-pin sidecar) and what later happened to the specs those decisions blocked (the run-ledger outcomes and the shipped-path event). Cross-checking the two, over a large enough sample, is enough arithmetic to flag a backend that blocks nearly everything while a meaningful fraction of what it blocked went on to ship or be accepted. No probe run and no curated set are needed because the downstream ship/accept outcome is the "was this spec actually bad?" ground truth a curated set would otherwise have to supply.

Problem statement: today the `spec_review` aggregator honours a severity veto faithfully (`aggregate.mjs`, `anyCritical`), so a backend that returns `critical` on every lens forces `reject-approach` every round and parks the run at the loop cap no matter how good the spec is. Nothing upstream of the aggregator checks whether the reviewer itself is capable of ever passing a spec. This change adds that check, before the backend is trusted, as a bar on slot selection.

Design principles:

**Determinism over judgement.** The ledger is arithmetic over recorded outcomes: counts, rates, and fixed thresholds. No LLM re-reads anything to produce a reputation. This mirrors the existing deterministic spec-review seams (`park-history`, `spec-review-convergence`, `spec-review-churn`) and keeps the guard replayable and testable. An injected `--now` and a fixed scan bound mean the same on-disk history always yields the same ledger.

**Fail toward the gate, never past it.** The guard removes a backend from eligibility; it must never remove the gate. If striking the flagged backends would leave no eligible reviewer, the chain is returned unchanged with an all-struck advisory, because a degenerate sole gatekeeper with no configured alternative is a condition for the operator to widen the backend pool, not a licence to silently skip the spec-review. This is the L4 fail-closed discipline the aggregator and review-chain exhaustion paths already hold.

**Zero behaviour change until the evidence exists.** A backend is only ever struck once it has been observed on a sample at or above the minimum size. On a fresh adopter, or for any backend below that sample, the guard is a no-op and the assembled chain passes through unchanged. Adoption cost is nil; the guard earns its strikes from real history.

**Backend identity is provider, model, and host.** Reputation accrues to a serving identity, not a config alias. Reuse the existing `backendIdentity` key (`provider|model|host`). A model swap or host move is a new identity with a fresh, empty ledger, which is the natural and correct reset: the new build has a new calibration, so its reputation starts over with no time-decay machinery required.

Reference context:

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs:81` | Node (mjs) | The `anyCritical` severity veto this ticket guards; correct by design, untouched here |
| `plugin/skills/faff/bin/lib/adversarial-backends.js:79` | Node (js) | `assembleAdversarialBackends(cfg, consumer)` — the per-consumer chain assembly (FAFF-870); the eligible filter composes on its output |
| `plugin/skills/faff/bin/lib/spec-review-pin.js:65` | Node (js) | `resolvePinChain` — the round-by-round chain resolve the occupant already uses; `:48` `backendIdentity`; `:123` `specReviewDir` |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` (chain-resolution bash block, the `faff spec-review-pin --resolve` step) | skill prose | **The occupant edited by this ticket** — the only `spec_review` occupant that resolves an adversarial chain. It runs `spec-review-pin --resolve … > "$backends_json"` then fans out via `fan-out.mjs`; the round-1 `--eligible` consult is inserted between the two, on the exit-0 branch. The single-pass `faffter-noon-spec-review` default resolves no chain and needs no edit |
| `plugin/skills/faff/bin/lib/park-history.js` | Node (js) | The deterministic-counting pattern to mirror: `gatherParks`/`computeParkHistory`, injected `--now`, fixed scan + threshold, pure core, `--selftest` |
| `plugin/skills/faff/bin/lib/spec-review-convergence.js:16`, `spec-review-churn.js:14` | Node (js) | The round-record path `.faff/runs/<run-id>/<ISSUE>/spec-review/round-<n>.json` and its `{verdict, objections}` shape |
| `plugin/skills/faff/bin/lib/run-ledger.js:284,316` | Node (js) | `record-outcome` — the run-ledger `outcomes[issue]` map, and the `issue-outcome` event written only on the `shipped` path |
| `plugin/skills/faff/bin/lib/governance-profile.js:120` | Node (js) | `ledger_outcomes` vocabulary: `shipped, pr-open, parked, errored, ...` — the downstream-outcome enum |
| `plugin/skills/faff/bin/lib/contract-defs.js:2745` | Node (js) | `spec-review-verdict` schema: `verdict ∈ {approve, revise, reject-approach, needs-human}`, `objections[].{lens, severity}` |
| `plugin/skills/faff/bin/faff:186,223,227` | Node (js) | `COMMANDS` registry where a new subcommand wires in; `docs/guide/cli.md` row is mandatory (`lint-cli-doc`) |

Scope statement: this is a new deterministic lib and CLI subcommand under `plugin/skills/faff/bin/lib/`, plus a one-line consult wired into the `spec_review` occupant `plugin/skills/faffter-dark-spec-review/SKILL.md` (its chain-resolution bash block). The lib reads run artifacts and config and writes nothing; the occupant edit adds the `faff spec-review-reputation --eligible` filter step so the guard is actually consulted.

## 2. OUT OF SCOPE

- **A synthetic probe run or curated eval set.** Excluded by the ratified committed decisions: a probe is a smaller faster-drifting eval set, and a curated set is another artifact to author and keep current. Extension point: none needed; the ground truth is the recorded downstream outcome. Note the in-repo review-bench harness (FAFF-904) exists for offline model selection, but this guard deliberately does not depend on it.
- **The peer-disagreement signal (sampled dual-review).** Reviewing the same spec with two backends and flagging a systematically-more-severe outlier is a stronger relative signal, but it needs an occasional extra dispatch and new config. Deferred to v2. Extension point: a second signal contributor in the reputation compute core (see the Design-decision section), gated by an `adversarial.spec_review.dual_review_sample` knob; no schema change to the v1 ledger.
- **The FAFF-922 judge verdict as an accept source.** FAFF-888 blocks FAFF-922 (the spec-review judge/arbiter), so the judge does not exist yet. When it lands, its accept ruling becomes an additional downstream accept source. Extension point: the accept-source set in the outcome-fact gatherer (one added source, no compute change).
- **A shared, materialized `learned.yaml` reputation store.** v1 computes the ledger on read from run artifacts; it does not persist a mutable accreting file. Excluded to keep v1 unblocked on FAFF-459's held carrier. Extension point: when FAFF-459's carrier lands, it can absorb a cached/materialized form, and FAFF-450's retro engine can become what writes it; the compute core stays the source of truth.
- **In-run, single-review mono-severity detection.** Flagging a backend from one run's rounds alone is unsafe (a run can legitimately see several bad specs in a row). It becomes safe only with the cross-run downstream check, which is what this ledger does. Extension point: none; this is the correct design boundary the ticket draws.
- **Changing the aggregator or the loop cap.** `aggregate.mjs` and the round-count cap are correct as-is (FAFF-874 already made the cap yield to convergence). This guard sits upstream at selection, not inside the roll-up. Extension point: none.

## 3. WHAT — vocabulary, types, and interfaces

Vocabulary:

| Term | Definition |
|---|---|
| Reputation ledger | The computed per-backend view: for each serving identity, how many specs it reviewed, how many it blocked, and how many of those blocked specs were later accepted downstream, over the scanned runs |
| Blocking verdict | A spec-review round whose verdict is `reject-approach` (the veto outcome this guard targets). `needs-human` is a transport/floor outcome, not a review judgement, and does not count as a block |
| Blocked spec | A distinct issue for which a given backend returned a blocking verdict on the terminal round of that issue's spec-review in a run |
| Accepted downstream | A blocked issue whose block was later overturned. Two sources: a `shipped` or `pr-open` run-ledger outcome recorded in the block's run or a later run; or a non-reject spec-review verdict on the same issue by any backend ordered **strictly after** the block (a later round in the same run, or any round in a later run). An accept recorded before, or in the same round as, the block does not count — see the ordering key below |
| Ordering key | `(run_id, round)` for a spec-review round; run-ids are date-prefixed so their lexical order is chronological, and the terminal round number orders within a run. A ship/pr-open/shipped-event outcome sorts at `(run_id, +∞)` — after every review round in the run it was recorded in. This is the same `(run_id, round)` material `spec-review-churn` already reads via `roundNumberFromPath` |
| Candidate-degenerate | A backend flagged by the ledger arithmetic: sample at or above the minimum, block-rate at or above its threshold, and overturn-rate at or above its threshold |
| Strike | Removing a candidate-degenerate backend from the eligible chain at selection time (voir-dire: excused for cause before the trial) |

Type definitions (pseudocode; the build agent translates to the repo's Node style):

```
CONSTANTS (fixed gateway defaults, not .faffrc knobs — mirrors park-history):
  REPUTATION_SCAN      = 50     # newest N run dirs scanned under .faff/runs
  MIN_SAMPLE           = 8      # a backend needs >= this many distinct reviewed specs before it can be flagged
  BLOCK_RATE_FLAG      = 0.90   # flagged only if it blocked >= this fraction of the specs it reviewed
  OVERTURN_RATE_FLAG   = 0.30   # AND >= this fraction of what it blocked was accepted downstream

ENUM SpecReviewVerdict: approve | revise | reject-approach | needs-human   # contract enum, contract-defs.js:2745

RECORD BackendReputation:
  identity: string              # provider|model|host (backendIdentity)
  reviewed: int                 # distinct issues this backend reviewed (terminal round attributed to it)
  blocked: int                  # of reviewed, count with a terminal reject-approach
  blocked_then_accepted: int    # of blocked, count later accepted downstream
  block_rate: float             # blocked / reviewed  (0 when reviewed == 0)
  overturn_rate: float          # blocked_then_accepted / blocked  (0 when blocked == 0)
  flagged: bool                 # reviewed >= MIN_SAMPLE AND block_rate >= BLOCK_RATE_FLAG AND overturn_rate >= OVERTURN_RATE_FLAG

RECORD ReputationLedger:
  scan: int                     # runs scanned
  min_sample: int               # thresholds echoed for the reader
  block_rate_flag: float
  overturn_rate_flag: float
  backends: Map<identity, BackendReputation>
  flagged: List<identity>       # sorted; the strike set

RECORD EligibleResult:
  chain: List<Backend>          # the input chain with flagged identities struck (see the never-empty rule)
  struck: List<identity>        # identities removed
  all_struck: bool              # true iff every input backend was flagged (chain then returned UNCHANGED)
```

Pure core interfaces (no I/O; unit-tested directly, like `computeParkHistory`):

```
computeReputation(reviewFacts, outcomeFacts, opts?) -> ReputationLedger
  reviewFacts:  List<{ identity, issue, run_id, round, verdict }>
                # one per (backend, issue) terminal spec-review in a run; (run_id, round) is its ordering key.
                # The non-reject facts here ALSO serve as the peer-accept source (see ordering below) — the
                # "later non-reject verdict" accept signal is derived from these, not carried in outcomeFacts.
  outcomeFacts: List<{ issue, run_id, accepted: bool }>
                # the ship/pr-open/shipped-event downstream accept, one per (issue, run) it was recorded in;
                # run_id is its ordering anchor (the accept sorts at (run_id, +∞)).
  opts:         { min_sample?, block_rate_flag?, overturn_rate_flag? }  # default to the CONSTANTS

# Ordering (resolves the temporal-ordering gap): orderKey(run_id, round) = [run_id, round], compared
# lexically on run_id (date-prefixed → chronological) then numerically on round. A ship/pr-open/shipped
# outcome sorts at [run_id, +∞]. An accept overturns a block only when its orderKey is STRICTLY GREATER
# than the block's; a same-run ship (round +∞) beats any review round, and a same-round peer approve does
# NOT (it is simultaneous, not later). When a backend blocked one issue in several runs, the block it must
# be overturned-after is the LATEST (max-orderKey) block on that issue.

filterEligible(chain, flaggedSet) -> EligibleResult
  # strikes any chain element whose backendIdentity is in flaggedSet;
  # NEVER empties: if every element is struck, returns { chain: <input unchanged>, struck: [...], all_struck: true }
```

Gatherers (filesystem reads, mirror `gatherParks`):

```
gatherReviewFacts(root, scan) -> List<reviewFact>
  # newest `scan` run dirs under root/.faff/runs (lexical-desc == chronological, run-ids are date-prefixed).
  # For each <run>/<ISSUE>/spec-review/ dir:
  #   - terminal round = highest round-<n>.json (roundNumberFromPath, reuse spec-review-churn helper)
  #   - round   = that terminal n           # the ordering key's within-run component
  #   - run_id  = the containing run dir     # the ordering key's cross-run component
  #   - verdict = that record's `verdict`
  #   - identity = backendIdentity(parse(<dir>/pinned-reviewer.json))   # attribution source
  #   - skip (defensively) any dir with no pinned-reviewer.json and no parseable header attribution

gatherOutcomeFacts(root, scan) -> List<outcomeFact>
  # per (issue, run) across the scanned runs, accepted == true iff the run records for that issue:
  #   - run-ledger.json outcomes[issue] in { shipped, pr-open }        (run-ledger.js), OR
  #   - an issue-outcome event with data.outcome == "shipped"          (events.jsonl, shipped-path)
  # each fact carries run_id = the run dir it was read from (its ordering anchor, sorted at (run_id, +∞)).
  # The "later non-reject spec-review verdict" accept source is NOT gathered here — it is the non-reject
  # reviewFacts, ordered strictly after the block inside computeReputation (see ordering above).
```

CLI surface (`faff spec-review-reputation`, wired into `COMMANDS` at `bin/faff` with a mandatory `docs/guide/cli.md` row):

```
faff spec-review-reputation --report [--consumer NAME] [--now ISO] [--root DIR] [--scan N]
  -> prints the ReputationLedger JSON on stdout, exit 0.

faff spec-review-reputation --eligible --backends-json FILE [--consumer NAME] [--now ISO] [--root DIR] [--scan N] [--json]
  -> reads the assembled chain array from FILE (byte-compatible with adversarial-backends / spec-review-pin output),
     strikes flagged identities, prints the struck chain array on stdout (default), or { chain, struck, all_struck } with --json.
     exit 0. A missing/unreadable FILE is fail-loud (exit 2) — plumbing breakage, not a legitimate degrade.

faff spec-review-reputation --selftest   -> runs the in-process fixture table, exit 0/1.
```

**Design decision (thresholds).** Options: (a) tie flagging to a time window like park-history's 21 days; (b) bound by a run-count scan and gate purely on sample size. A reputation should not expire merely with the calendar if the backend is unchanged, and a changed backend already yields a fresh identity, so recency-decay adds machinery for no gain. **Chosen:** a run-count scan (newest 50 runs) with `MIN_SAMPLE=8`, `BLOCK_RATE_FLAG=0.90`, `OVERTURN_RATE_FLAG=0.30`; no time window. Rationale: 8 distinct specs is large enough that "blocked nearly everything" is not three genuinely-bad specs in a row (the in-run false positive the ticket warns against), yet small enough to accrue over a realistic number of drains; 0.90 encodes "blocks nearly everything" (mono-severity); 0.30 encodes "a meaningful fraction of blocks were overturned". These are the first knobs to revisit under calibration (as `thinking_token_budget` was under FAFF-920), so they are named constants in one place.

**Design decision (v1 signal).** **Chosen:** own-verdict-history cross-checked against downstream accept/ship as the sole v1 signal; the peer-disagreement sampled-dual-review signal is documented as the v2 enhancement (see OUT OF SCOPE). Rationale: the own-history signal needs no new dispatch cost and no new config, and self-calibrates from artifacts faff already writes; the peer signal is a strict, additive improvement that costs an extra review and is not required to close the mono-severity gap this ticket names.

## 4. HOW — behaviour

Architecture: one new pure-plus-gather lib `plugin/skills/faff/bin/lib/spec-review-reputation.js`, exporting the pure core (`computeReputation`, `filterEligible`), the gatherers, and `cmdSpecReviewReputation`; wired into `bin/faff`. The consult composes with the existing chain-resolution pipeline the `spec_review` occupant already runs, by filtering the resolved chain array before fan-out.

The concrete occupant edit is in `plugin/skills/faffter-dark-spec-review/SKILL.md`, in its chain-resolution bash block. Today that block runs, on the exit-0 branch, `"$faff" spec-review-pin --resolve --dir "$pin_dir" --consumer spec_review > "$backends_json"` and then builds the `LensRequest[]` and calls `fan-out.mjs`. This ticket inserts one step between the two, on the exit-0 branch and **only on round 1** (the unpinned resolve) — matching the committed "read at selection time, not per round" decision. The round-1 signal is the same one the pin protocol already uses: no `pinned-reviewer.json` sidecar in `$pin_dir` yet (equivalently, `spec-review-pin --resolve --json` reports `pinned: false`). On rounds ≥ 2 the pin already names the clean round-1 winner, so the consult is skipped and no per-round cross-run scan runs:

```bash
# after spec-review-pin --resolve has written the resolved chain to "$backends_json":
if [ ! -e "$pin_dir/pinned-reviewer.json" ]; then          # round 1 only (unpinned) — the selection-time read
  "$faff" spec-review-reputation --eligible --backends-json "$backends_json" --consumer spec_review > "$backends_json.elig" \
    && mv "$backends_json.elig" "$backends_json"            # filter in place; struck chain is byte-compatible
fi
```

Filtering in place (overwriting `$backends_json` with the struck chain) keeps the rest of the block byte-identical: the `LensRequest[]` `--backends-json`, the `chain[<i>]` header indices, and the `spec-review-pin --capture` that follows all read the already-struck chain, so a flagged backend is never served, never becomes the round-1 pin, and never fans out. The `--eligible` filter never empties the chain (an all-flagged input is returned unchanged with the gate intact), so this step cannot turn an exit-0 resolve into an empty fan-out. Because the consult is round-1-only, the fallback-tail-re-assembled-on-a-later-round gap is unchanged from the failure-mode note below (it is not re-filtered per round).

Behaviour summary: at round-1 selection the occupant resolves its per-consumer chain as it does today, pipes that chain array through `faff spec-review-reputation --eligible`, and fans out over the struck chain. Because the struck chain is what round 1 serves and pins, a flagged backend is never served and never becomes the pin.

```
PROCEDURE compute_reputation(reviewFacts, outcomeFacts, opts):
  1. shipRuns[issue]   = { of.run_id : of in outcomeFacts, of.accepted }         # runs with a ship/pr-open accept
     peerAccepts[issue] = [ orderKey(f.run_id, f.round) : f in reviewFacts, f.verdict in {approve, revise} ]
  2. FOR each distinct identity in reviewFacts:
       reviewed = distinct issues this identity reviewed
       blocks   = { i : this identity has a terminal reject-approach on i }
       blockPos(i) = MAX orderKey(f.run_id, f.round) over this identity's reject-approach facts on i
       blocked  = |blocks|
       blocked_then_accepted = { i in blocks : accepted_after(i, blockPos(i)) }
         accepted_after(i, pos) =
              ( ANY r in shipRuns[i] with orderKey(r, +∞) > pos )   # ship/pr-open in the block's run or later
           OR ( ANY k in peerAccepts[i] with k > pos )              # a strictly-later non-reject peer verdict
       block_rate    = blocked / reviewed            (0 if reviewed == 0)
       overturn_rate = |blocked_then_accepted| / |blocked|   (0 if blocked == 0)
       flagged = reviewed >= min_sample
                 AND block_rate >= block_rate_flag
                 AND overturn_rate >= overturn_rate_flag
  3. RETURN ledger with backends map + sorted flagged identity list
```

```
PROCEDURE filter_eligible(chain, flaggedSet):
  1. kept = [ b for b in chain if backendIdentity(b) not in flaggedSet ]
  2. struck = [ backendIdentity(b) for b in chain if backendIdentity(b) in flaggedSet ]
  3. IF kept is empty AND chain is non-empty:            # never remove the gate
       RETURN { chain: chain, struck: struck, all_struck: true }   # input order unchanged
  4. RETURN { chain: kept, struck: struck, all_struck: false }
```

Attribution: a round record carries only `{verdict, objections}`, never the backend, so the backend is read from the `pinned-reviewer.json` sidecar written in the same `spec-review` dir by the pin protocol (`spec-review-pin.js`). The terminal round is the highest-numbered `round-<n>.json` in the dir. A spec-review dir with no attributable backend (no pin sidecar, no parseable header) contributes no review fact and is skipped, exactly as `computeParkHistory` skips a record with a bad class or timestamp.

Downstream accept ground truth: the primary source is the run-ledger `outcomes[issue]` map (`run-ledger.js`), which carries the full outcome vocabulary including `pr-open`; the `issue-outcome` event corroborates the `shipped` case (it is written only on the shipped path). A non-reject spec-review verdict on the same issue is the secondary accept signal (a peer or subsequent review accepted the approach the flagged backend rejected), but it counts only when it is ordered **strictly after** the block by `(run_id, run-ids being date-prefixed) then round`. Ordering matters because a peer approval recorded in an earlier run, or in the same round as the block, is not evidence the block was overturned — it predates or coincides with it. The ship/pr-open source is anchored the same way: it counts only when recorded in the block's run (where the shipped outcome necessarily follows the block round) or a later run.

Edge cases and error handling:

- Cold start or under-sampled backend: `reviewed < MIN_SAMPLE` yields `flagged: false`; `--eligible` strikes nothing; the chain passes through unchanged.
- Empty or absent `.faff/runs`: gatherers return empty lists; the ledger has no backends; nothing is struck.
- A malformed round record or run-ledger.json in a scanned run: fail-loud on a corrupt block (a present-but-broken artifact is a fixture fault, like `extractParksBlock`), but a merely-absent artifact degrades to "no fact from that run", never a crash.
- `--eligible` where every input backend is flagged: returns the input chain unchanged with `all_struck: true`; the occupant proceeds with the gate intact and the operator is advised to widen the pool. The consult never emits an empty chain.
- `--eligible` input file missing or unreadable: exit 2 (fail-loud), consistent with `spec-review-pin`'s `--backends-json` handling.

Failure modes:

- **The overturn proxy over-counts legitimate revisions.** "Blocked then later shipped" can be a spec that was genuinely revised in response to the objection and then shipped, not an overturned block. How you would know: a backend with a low block-rate shows a non-trivial overturn-rate that never trips a flag. What it means: proceed. The two-gate AND is the mitigation: a discriminating backend has `block_rate < 0.90` and is never flagged whatever its overturn-rate; only a backend that blocks nearly everything AND sees a meaningful ship-through fraction is flagged, and for such a backend the ship-through cannot be explained by ordinary revision because it passed almost nothing. This is why v1 does not attempt to prove the ship happened without addressing the objection; the block-rate gate carries that weight.
- **Attribution gaps bias the sample.** If pin sidecars are frequently missing, `reviewed` undercounts and a real degenerate stays under `MIN_SAMPLE`. How you would know: `--report` shows a suspiciously low `reviewed` for a backend that is known to have served many rounds. What it means: narrow — improve attribution (header-parse fallback) before lowering `MIN_SAMPLE`. A false negative here is safe (the guard simply does not fire), which is the correct direction to fail.
- **The strike stabilises across rounds only through the pin.** The consult fires once at round-1 selection (per the committed decision, not per round). On a later round where the pinned reviewer is unreachable, `resolvePinChain`'s fallback tail is re-assembled fresh and is not re-filtered, so a struck backend could serve a single fallback round. How you would know: a served-backend header in a late round names a struck identity. What it means: proceed; the pin's prefer-with-fallback already guarantees the good reviewer serves whenever reachable, so this is a rare one-round degrade, not a re-opened gate. Documented as an accepted narrow gap, mirroring `spec-review-churn`'s accepted same-lens-swap gap.

Anti-pattern: computing the ledger inside `resolvePinChain` so it re-scans every round. Why: the committed decision fixes the read at selection time, not per round, and a per-round cross-run filesystem scan is wasted cost. Keep the consult a one-shot at round-1 selection.

Anti-pattern: striking the last eligible backend to enforce the bar. Why: that removes the gate, which the fail-closed discipline forbids; an all-struck chain is an operator-attention signal, not a bypass.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a backend identity that reviewed 10 distinct specs across the scanned runs,
      returned reject-approach on all 10, and 4 of those 10 issues later reached a shipped or pr-open outcome
When the reputation ledger is computed
Then that identity is in the flagged list (reviewed 10 >= 8, block_rate 1.0 >= 0.90, overturn_rate 0.4 >= 0.30)
```

```
Given a calibrated backend that reviewed 12 specs, blocked 5 of them, and 3 of those 5 later shipped
When the reputation ledger is computed
Then that identity is NOT flagged (block_rate 0.42 is below 0.90), regardless of its overturn_rate
```

```
Given a backend that has reviewed only 5 specs and blocked all 5, with 3 later accepted
When the reputation ledger is computed
Then that identity is NOT flagged (reviewed 5 is below MIN_SAMPLE 8)
```

```
Given a backend that blocked FAFF-9 with reject-approach at run R2 round 1,
      and a peer backend returned approve on FAFF-9 at run R1 (an EARLIER run) — before the block
When the reputation ledger is computed
Then that earlier approval does NOT count toward the backend's overturn_rate (its orderKey precedes the block)
```

```
Given the same backend and block at run R2 round 1, and a peer approve on FAFF-9 at run R3 (a LATER run)
When the reputation ledger is computed
Then the block counts as blocked_then_accepted (the accept's orderKey is strictly after the block)
```

```
Given an assembled spec_review chain [A, B, C] and a flagged set { identity(B) }
When filterEligible runs
Then the eligible chain is [A, C], struck is [identity(B)], and all_struck is false
```

- The `--report` and `--eligible` outputs are byte-stable for a fixed on-disk history and a fixed `--now` (deterministic; no ambient clock).

## 6. Design decision rationale

**Where does the guard live: aggregator, loop driver, or selection?**
Options: a runtime check in `aggregate.mjs` or the loop driver (inspect verdicts mid-loop) versus a selection-time consult. Runtime checks would make the deterministic roll-up non-deterministic and re-litigate a block mid-deliberation.
**Chosen:** a selection-time consult, per the ratified committed decision (voir-dire: strike for cause before the trial). It keeps `aggregate.mjs` untouched and the runtime deterministic.

**Recompute-on-read versus a materialized store.**
Options: persist a mutable reputation file that accretes per run, or recompute the ledger from run artifacts on each read.
**Chosen:** recompute-on-read from the newest 50 runs, mirroring `park-history`. Rationale: no new mutable state to corrupt or keep in sync, purely arithmetic over already-recorded outcomes, and unblocked on FAFF-459's held carrier. The "accretes run over run" property holds because each new run adds artifacts to the scanned set. When FAFF-459 lands it can absorb a cached form without changing the compute core.

**Ledger window: run-count scan versus time-decay.** Documented in the WHAT thresholds decision. **Chosen:** run-count scan, no time-decay; a changed backend is a new identity with a fresh ledger.

**Sample size and flag thresholds.** Documented in the WHAT thresholds decision. **Chosen:** `MIN_SAMPLE=8`, `BLOCK_RATE_FLAG=0.90`, `OVERTURN_RATE_FLAG=0.30`, scan 50.

**v1 signal set.** **Chosen:** own-history plus downstream-outcome only; peer-disagreement deferred to v2.

**Ordering the accept signal against the block.** A `blocked_then_accepted` count must not let an accept that predates the block read as an overturn. Options: (a) a per-issue accepted boolean with no ordering (simplest, but a peer approval in an earlier run miscounts as overturning a later block); (b) order every fact and require the accept to be strictly after the block. **Chosen:** (b) — order by `(run_id, round)`, run-ids being date-prefixed so their lexical order is chronological and the terminal round number orders within a run; a ship/pr-open/shipped-event accept sorts at `(run_id, +∞)`, and a peer non-reject verdict must sort strictly after the block's latest orderKey. Rationale: the ordering material already exists on disk (date-prefixed run-ids, `round-<n>.json` names — the same keys `spec-review-churn` reads via `roundNumberFromPath`), so no persisted field is added; option (a)'s miscount is the exact QA gap this closes.

**Backend identity key.** **Chosen:** reuse `backendIdentity` (`provider|model|host`) from `spec-review-pin.js`, so the ledger keys on exactly what the pin de-dups and what a served-header comparison uses.

**Composition with FAFF-870.** **Chosen:** the eligible filter runs on the output of `assembleAdversarialBackends(cfg, "spec_review")`, so a per-consumer chain is assembled first and then has flagged backends struck. The two features stack cleanly: FAFF-870 decides the candidate pool, this decides who is excused for cause.

**Fail-safe when all candidates are flagged.** **Chosen:** never emit an empty chain; return the input unchanged with `all_struck: true` as an operator-attention advisory. Rationale: the gate must survive; removing the reviewer entirely is worse than serving a suspect one with a loud flag.

## 7. Open questions and assumptions

Open questions: none blocking. The two items the ticket left open for prep are resolved above with a `Chosen:` each (thresholds; v1 signal set). The threshold values are calibration targets, tunable from one named-constant block, not open design questions.

Assumptions:

- **Assumes:** the `pinned-reviewer.json` sidecar reliably records the served backend for a spec-review round loop (the attribution source). Validation before build: confirm `spec-review-pin.js` `capturePin` writes the round-1 served backend to `<scratch>/pinned-reviewer.json` and that the dir is `specReviewDir(issue, runDir)`. Fallback for un-pinned dirs: parse the `chain[<i>]` attribution header (`review-call.mjs` `attributionHeader`); if neither is present, skip the review fact (safe under-count).
- **Assumes:** `run-ledger.json` carries an `outcomes[issue]` map with the `ledger_outcomes` vocabulary, and the `issue-outcome` shipped event exists on the shipped path. Validation before build: read `run-ledger.js` `recordOutcome` and confirm the outcomes map shape and the `shipped`-only event append; if a scanned run has neither, it contributes no outcome fact (degrade, not crash).

## 8. DONE — definition of done

### From WHY
- [ ] A backend that blocked nearly every spec it reviewed while a meaningful fraction of those specs shipped is flagged and struck from the `spec_review` chain at selection, so it can no longer force `reject-approach` as the sole gatekeeper.
- [ ] `aggregate.mjs` and the loop cap are unchanged by this ticket.
- [ ] With no qualifying history, the assembled chain passes through unchanged (zero behaviour change on a fresh adopter).

### From WHAT (types and CLI)
- [ ] `spec-review-reputation.js` exists under `plugin/skills/faff/bin/lib/`, exports `computeReputation`, `filterEligible`, the gatherers, and `cmdSpecReviewReputation`, and carries a `--selftest` table.
- [ ] `faff spec-review-reputation --report` prints a `ReputationLedger` JSON with `scan`, echoed thresholds, a `backends` map of `{reviewed, blocked, blocked_then_accepted, block_rate, overturn_rate, flagged}`, and a sorted `flagged` list.
- [ ] `faff spec-review-reputation --eligible --backends-json FILE` prints the struck chain array (default) or `{chain, struck, all_struck}` with `--json`, byte-compatible with `adversarial-backends` / `spec-review-pin` output.
- [ ] The subcommand is registered in `bin/faff` `COMMANDS` and has a `docs/guide/cli.md` row (so `lint-cli-doc` and `lint-cli-coverage` pass).
- [ ] `MIN_SAMPLE`, `BLOCK_RATE_FLAG`, `OVERTURN_RATE_FLAG`, `REPUTATION_SCAN` are named constants in one place.

### From HOW (occupant wiring — the guard is actually consulted)
- [ ] `plugin/skills/faffter-dark-spec-review/SKILL.md`'s chain-resolution bash block is edited so that, on the exit-0 branch and only on round 1 (the unpinned resolve — no `pinned-reviewer.json` sidecar yet), the resolved `$backends_json` is piped through `faff spec-review-reputation --eligible --backends-json "$backends_json"` and the struck chain replaces `$backends_json` before the `LensRequest[]` build, `fan-out.mjs`, and `spec-review-pin --capture` — so a flagged backend is never served, never pinned, and never fans out.
- [ ] The consult is inserted between `spec-review-pin --resolve` and fan-out, never on the exit-3/exit-2 branches (no chain to filter there), and gated to round 1 only (skipped when the pin sidecar already exists), per the committed "read at selection time" decision — no per-round cross-run scan.
- [ ] A test asserts the wired filter strikes a flagged backend from a resolved chain, and that a chain whose every backend is flagged is passed through unchanged (fail-safe: the gate is never emptied). The single-pass `faffter-noon-spec-review` default is unchanged (it resolves no adversarial chain).

### From HOW (behaviour)
- [ ] `computeReputation` flags an identity iff `reviewed >= MIN_SAMPLE` AND `block_rate >= BLOCK_RATE_FLAG` AND `overturn_rate >= OVERTURN_RATE_FLAG`.
- [ ] Only `reject-approach` counts as a block; `needs-human` does not.
- [ ] Backend identity is `provider|model|host` via the reused `backendIdentity`.
- [ ] `blocked_then_accepted` counts a blocked issue accepted via run-ledger `shipped`/`pr-open`, a shipped `issue-outcome` event, or a non-reject spec-review verdict on the same issue.
- [ ] The accept signal is ordered by `(run_id, round)`: a ship/pr-open/shipped-event accept counts only in the block's run or a later run; a peer non-reject verdict counts only when strictly after the block's latest orderKey. An earlier-run or same-round peer approval never counts as an overturn, and a `--selftest` case covers both the earlier-approve-not-counted and later-approve-counted paths.
- [ ] Review attribution reads `pinned-reviewer.json` in the spec-review dir; an un-attributable review is skipped, not crashed.

### From HOW (edge cases)
- [ ] `filterEligible` never returns an empty chain: an all-flagged input is returned unchanged with `all_struck: true`.
- [ ] A backend below `MIN_SAMPLE` is never struck.
- [ ] An absent run artifact degrades to no fact; a present-but-corrupt artifact is fail-loud (exit 2).
- [ ] `--eligible` with a missing/unreadable `--backends-json` exits 2.
- [ ] Output is deterministic for a fixed history and `--now`.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the ledger is arithmetic), so no grader `KIND` or eval case is required; the `--selftest` fixture table plus a `test/spec-review-reputation.test.mjs` cover the arithmetic, the accept-ordering cases (earlier-approve-not-counted, later-approve-counted), the never-empty rule, and the wired occupant filter (a flagged backend struck, an all-flagged chain preserved).

Integration smoke test:

```
PROCEDURE smoke:
  1. Build a temp root/.faff/runs with two runs, run B chronologically after run A (date-prefixed run-ids,
     e.g. run-20260101-… for A and run-20260102-… for B, so B's ship outcomes order strictly after A's blocks):
     - run A: FAFF-1 spec-review dir, round-1.json { verdict: "reject-approach", objections:[{lens:"QA",severity:"blocker"}] },
              pinned-reviewer.json = { provider:"p", model:"m", host:"h" }; repeat for FAFF-2..FAFF-8 (8 blocked specs).
     - run B: run-ledger.json outcomes { "FAFF-1":"shipped", "FAFF-2":"shipped", "FAFF-3":"pr-open" } (3 accepted,
              each in a later run than its block, so all three overturns count under the ordering rule).
  2. faff spec-review-reputation --report --root <tmp> --now <fixed>
     -> backends["p|m|h"].flagged == true (reviewed 8, block_rate 1.0, overturn_rate 0.375).
  3. echo '[{"provider":"p","model":"m","host":"h"},{"provider":"q","model":"n","host":"h2"}]' > chain.json
     faff spec-review-reputation --eligible --backends-json chain.json --root <tmp> --now <fixed> --json
     -> chain == [ {q/n/h2} ], struck == ["p|m|h"], all_struck == false.
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```