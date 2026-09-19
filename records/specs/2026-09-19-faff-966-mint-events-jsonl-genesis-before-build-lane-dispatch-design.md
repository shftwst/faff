# Spec, FAFF-966: mint the `events.jsonl` genesis before a build lane is dispatched, and fail closed (never truncate) when a run reaches the anchor without one

> Spec: faffter-noon-spec · 2026-09-19 · autonomous (faff-prep refresh: spec-review round-1 objections folded) · claude-code/unknown · confidence: high. Full spec on Linear FAFF-966.

> **Refresh, 2026-09-19 (faff-prep autonomous, run `run-20260919-042340-beepboop-list-3379b3`).** Per the operator's 2026-09-16 decision, the human-decided Option B spec was sent to the spec-review gate as-is. Round 1 returned `reject-approach` from the design lenses (architectural / infosec / QA), all objections non-critical (0 blocker, 3 major, 7 minor) and in-place fixable — none challenged Option B's approach. Folded in without altering any human-ratified decision: (1) the mint verb now refuses an existing run dir (EEXIST → exit 3) and fails closed if the genesis emit fails after the ledger write (exit 3, never exit 0 over a genesis-less dir); (2) the shared `emitGenesisRunStart` helper is now mandated across all three mints with a named L4/L2 regression assertion, closing the drift the ticket exists to kill; (3) DoD/tests now exercise each anchor-guard validity conjunct independently (wrong-`prev`, `verifyChain`-fail, neither-file) and the EEXIST/emit-fail guards; (4) the graft-park and before-dispatch-ordering DONE items now name their oracle (tested CLI exit vs prose-skill review); (5) the guard's well-formedness-not-provenance scope is stated as an explicit `Assumes` (forgery-resistance out of scope — a run-dir writer is inside the trust boundary). Option B's approach — mint at `init-self-drain`, fail-closed read-only anchor guard, never truncate, `--mode`/`--id` allowlist — is unchanged.

This is a buildable spec for FAFF-966, written for the build agent that will implement it and the human reviewers who gate it. It closes the provisioning gap where a run dir is minted with a valid `run-ledger.json` but no `events.jsonl` genesis chain, so the dispatched build lane's merge-gate anchor fails `anchor-missing`.

**Status: refreshed to Option B (fail-closed), human decision of 2026-09-13.** The prior spec chose a self-heal at the anchor point that reconstructed a missing genesis by truncating the run's `events.jsonl` to empty under the lock and emitting a fresh seq-0 record. The spec-review gate parked that at `reject-approach`: the truncate-under-lock design was not implementable as written (the mint helper re-acquired a lock the step already held) and it was destructive (an irreversible truncate before the emit, fail-open on an emit failure). The human has replaced the self-heal entirely with a fail-closed design:

- **Prevention (primary fix):** the path that dispatches a build lane mints the genesis run-start record before the lane proceeds, so a build lane never starts without a genesis chain.
- **Recovery (backstop):** if a run reaches the merge-gate anchor point without a valid genesis chain, the run aborts to a `needs-human` park. It never truncates, reconstructs, rewrites, or emits over the events log in place.

The reconstruct-and-truncate self-heal is **removed and rejected** (human decision, 2026-09-13, Option B: never truncate a live events log). See section 6 for how this resolves each standing spec-review objection by construction.

## Already shipped against this surface

- **FAFF-761** (shipped, `ab724ce8`, PR #640, Done) delivered `faff run-ledger init-interactive`, the atomic L2 mint that emits a genesis `run-start` for a standalone/top-level interactive graft. Related, **not superseding**: it fixed the L2 path only; beep-boop's L3 ordinary self-drain mint still has no atomic CLI verb and remains prose-only, which is the gap this ticket closes. `init-interactive` (`run-ledger.js`, `initInteractive`) is the exact sibling the new L3 verb mirrors, including its `--id` shape guard.
- **FAFF-930** (L4 ratification roll-up, **Done**, PR #797) reads a genesis's mint-time `data.level` corroboration. Because the backstop no longer fabricates a genesis, no reconstructed record can carry (or fake) a level; the "reconstructed genesis carries no `data.level`" invariant that was load-bearing for FAFF-930 is now moot on the recovery path, since there is no recovery-time genesis. FAFF-930 is shipped, so the prose citation suffices and no `blockedBy` FAFF-930 → FAFF-966 edge is required.
- The events-chain design ADRs **0081** (lock/seq), **0084** (chain-hash + genesis `prev` = `SHA256(run_id)`), **0085** (ledger-write fold) define the chain contract this builds on; none provisions the L3 mint seam.
- Related tickets **FAFF-963** / **FAFF-964** (both shipped) are the two runs that surfaced the recurrence, not overlapping work; their premise (the gap) is still live in current code.

Premise verdict: **holds**. The L3 mint seam and the anchor-point genesis guard are both still absent in current code; no Done work supersedes them.

## 1. WHY, Problem and Principles

**The load-bearing model.** A run's `events.jsonl` is an append-only, lock-serialised hash chain whose first record (seq 0, `prev` = `SHA256(run_id)`) is the *genesis*. Everything downstream that proves the run happened, `faff events anchor` (which byte-copies the chain into a committed anchor) and `merge-gate`'s `resolveAnchorLevel` (which reads that committed anchor at the PR head sha), assumes the genesis already exists. If a run dir is minted without emitting that first record, the chain is *absent*, not merely short: `faff events anchor` reads `events.jsonl`, hits `ENOENT`, and returns `code: "no-events"` (`mintIssueAnchor`, events.js:1354; CLI exit 3); no anchor is committed; and `merge-gate` later reads an absent anchor and fails fail-closed with status `anchor-missing` (merge-gate.js `resolveAnchorLevel`). The fix has two independent guarantees: guarantee the genesis is present the instant a build lane is dispatched, and fail closed (never repair in place) if a run ever reaches the anchor without one.

**Problem statement.** Two of the three run-dir mint paths emit the genesis atomically at mint time (`faff lights-out` for L4, `faff run-ledger init-interactive` for L2). The third, beep-boop's ordinary L3 self-drain, is minted in prose: its "At run start" step (`faff-beep-boop/SKILL.md`, _Owner stamp & heartbeat_) writes `run-ledger.json` + the owner stamp + the top-level `level`, but does **not** emit the `events.jsonl` genesis. The only place the genesis appears in that skill is a descriptive row in the later run-event-log table ("Run start (after run dir + ledger init)"), with no mandatory-before-dispatch ordering. When that inline emit is skipped, the dispatched build lane inherits a run dir with a ledger but no chain, and the first thing that needs the anchor fails `anchor-missing`. This change makes the genesis a construction-time precondition of dispatch at the L3 mint seam, and makes the anchor point fail closed to a human park if any run ever reaches it without a valid genesis.

**Design principles.**

**Genesis is minted, never hand-authored.** The genesis record's `seq` (0) and `prev` (`SHA256(run_id)`) must be produced by the locked chain core (`appendRecordUnderLock`), never composed as literal JSON in prose. Hand-authoring the record is precisely the fragility ADR-0084 exists to prevent; a prose `echo '{…}' | faff events append` that omits the emit entirely is how this bug reached production. Any implementation that satisfies this ticket by adding another prose echo step is rejected.

**A live events log is never rewritten in place.** The recovery path must not truncate, reconstruct, emit-over, or otherwise mutate a run's `events.jsonl`. A run that reaches the anchor without a valid genesis is a run that was mis-provisioned; the honest response is to stop and surface it to a human, not to manufacture a chain that papers over the provisioning bug and destroys whatever partial evidence the log holds. This is the Option B decision (human, 2026-09-13): fail closed, never destructive.

**The self-heal must not fabricate authority.** This principle survives Option B trivially: because there is no recovery-time genesis mint at all, no reconstructed record can carry `data.level` or launder an autonomy level no mint conferred.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/run-ledger.js` | JavaScript | `initInteractive` (L2 mint + genesis, `--id` guard at line 183), the sibling the new L3 verb mirrors |
| `plugin/skills/faff/bin/lib/lights-out.js` | JavaScript | `mintLightsOut` (L4 mint + genesis), the third mint path; shares the genesis-emit pattern |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript | `mintIssueAnchor` (`no-events` exit 3, byte-copy) + `appendRecordUnderLock`, the anchor-point fail-closed guard lives here |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveAnchorLevel` / `anchorRefusal`, the `anchor-missing` consumer (unchanged) |
| `plugin/skills/faff/bin/lib/governance-profile.js` | JavaScript | `DELIVERY_PROFILE` genesis-record contract (schema 2 field rules) |
| `plugin/skills/faff-beep-boop/SKILL.md` | Prose skill | The L3 self-drain "At run start" mint that skips the genesis, rewired to call the new verb before any dispatch |
| `plugin/skills/faff-graft/SKILL.md` | Prose skill | Step 9b anchor, the point that fails closed to a park, and the inheriting dispatch boundary |

**Scope statement.** This sits at the shared run-dir-mint-and-anchor seam that every entry point (lights-out L4, interactive graft L2, beep-boop self-drain L3, and any dispatched build lane) funnels through. It is provisioning plumbing beneath the build lane, not a build-lane behaviour change.

## 2. OUT OF SCOPE

- **The reconstruct-and-truncate self-heal from the prior spec.** Removed and rejected (human decision, 2026-09-13, Option B). The anchor point does not repair a missing genesis; it refuses and the run parks. This spec deliberately ships no code that truncates, rewrites, or emits over a live `events.jsonl`.
- **The drifted-ledger-fold remedy (`events.jsonl` present but its fold is stale).** Excluded: that is a *different* failure with an existing remedy message ("append a ledger-write to re-sync the ledger fold"); it applies only when a valid chain already exists. Extension point: the existing fold-drift branch in `events.js` `eventViolations`, untouched here.
- **`merge-gate`'s fail-closed `anchor-missing` behaviour.** Excluded: the gate reading an absent committed anchor as `anchor-missing` is correct fail-closed behaviour; this ticket removes the *cause* (an unanchorable run reaching dispatch) and adds a fail-closed *park* at the anchor point, but does not change the gate's response. Extension point: `resolveAnchorLevel` in `merge-gate.js`, left as-is.
- **Migrating beep-boop's full rich ledger shape (budget, outcomes, the several `*_pending` arrays) into the CLI mint.** Excluded: the new verb mints only the *core* (run dir, an L3 `run-ledger.json`, genesis); beep-boop's prose keeps managing the augmentation fields via its existing ledger writes. Extension point: `faff-beep-boop/SKILL.md`'s existing ledger-augmentation steps.
- **Any change to L4 `mintLightsOut` behaviour beyond calling a shared helper.** Excluded: L4 already mints genesis atomically and is tested; it is refactored to call the shared emit only if that lands cleanly, never rewritten. Extension point: `lights-out.js` `mintLightsOut`.
- **A retroactive backfill of genesis into already-committed historical run dirs.** Excluded: this fixes the seam forward; existing anchored runs already merged (PR #816, #818) are not rewritten.

## 3. WHAT, Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Genesis record | The seq-0 record of a run's `events.jsonl`, with `prev` = `SHA256(UTF-8 bytes of run_id)`; conventionally `type: "run-start"` |
| Mint seam | The point where a run dir + `run-ledger.json` are created; the genesis emit is part of it and precedes any lane dispatch |
| Valid genesis chain | An `events.jsonl` that exists and whose seq-0 record is a `run-start` with `prev == SHA256(run_id)` and `verifyChain` → verified |
| Anchor point | `faff events anchor` (`mintIssueAnchor`), run at graft Step 9b before `gh pr create`, the trusted preflight that byte-copies the chain into the committed anchor |
| Fail-closed park | On an absent-or-invalid genesis at the anchor point, the run refuses to anchor and parks `needs-human`, without modifying the events log |

**Genesis record contract (schema 2, from `governance-profile.js` `DELIVERY_PROFILE` and `events.js` `eventViolations`).**

```
RECORD GenesisEvent:
  schema:  2                      # constant
  run_id:  string                 # non-empty; MUST equal basename(run_dir)
  seq:     0                      # integer, CLI-minted from the locked tail-read; never caller-supplied
  ts:      string                 # non-empty ISO-8601
  prev:    hex64-lowercase        # genesis: SHA256(UTF-8 bytes of run_id)
  phase:   "run"                  # ∈ {run, tidy, prep, build, plot}
  type:    "run-start"            # ∈ event_types; run-start is NOT issue-scoped
  data?:   object                 # optional; mint-time carries data.level

  CONSTRAINT prev == SHA256(run_id) WHEN seq == 0
  CONSTRAINT run_id == basename(run_dir)          # load-bearing for the genesis prev
  MUST be minted via appendRecordUnderLock        # seq + prev correct by construction; never hand-authored
```

Mint-time genesis carries `data.level` set to the run's level (`"L4"` for lights-out, `"L3"` for the new self-drain verb, `"L2"` for interactive), the corroboration the L4-ratification roll-up reads. Under Option B there is no reconstructed genesis and therefore no level-less reconstructed record to reason about.

**New CLI verb, `faff run-ledger init-self-drain`.** The L3 sibling of `init-interactive` (L2) and `mintLightsOut` (L4). Not issue-scoped (a self-drain run admits issues over waves, so `--issue` is not required; `run-start` is not issue-scoped).

```
COMMAND faff run-ledger init-self-drain [--mode MODE] [--id RUN-ID] [--root DIR] [--json]

  MINTS ATOMICALLY (mirrors initInteractive's tail):
    - run dir  run-<utcStamp>-beepboop-<mode>-<entropy>   # or exactly --id when given (tests/determinism)
    - run-ledger.json { level:"L3", run_id, admitted:[], outcomes:{}, owner:{status:"running", …} }
    - genesis events.jsonl record  { schema:2, run_id, seq:0, ts, prev:SHA256(run_id),
                                     phase:"run", type:"run-start", data:{ level:"L3" } }

  GUARDS (identical shape to init-interactive):
    - --id, if supplied, must satisfy the bare-id shape (no "/", no "..") else exit 2, no dir
    - --mode, if supplied, must satisfy the SAME bare-id shape (no "/", no "..") else exit 2, no dir
    - refuse (exit 3, no partial dir) if a LIVE higher-level (L3/L4) run is already resolved
    - fail-closed if the ledger write does not land (lock exhaustion), exit 3, never report a mint over an absent ledger

  OUTPUT:
    - bare mode: stdout is JUST the absolute run dir path (so `export FAFF_RUN_DIR=$(…)`)
    - --json:    { proceed:true, level:"L3", run_id, run_dir, ledger_sha256_before:null, ledger_sha256_after }
```

Register it in the `run-ledger` subcommand dispatch alongside `init-interactive` and `record-outcome` (the `USAGE` string and the required-flags map both extend).

**`--mode` and `--id` validation (applies regardless of A/B).** `--mode` is interpolated into the run-id (`run-<utcStamp>-beepboop-<mode>-<entropy>`) and therefore into the run-dir path, but the prior design validated only `--id`. An unvalidated `--mode` carrying a `/` escapes `.faff/runs/`, and a `..` walks outside it or breaks the `basename(run_dir) == run_id` invariant that the genesis `prev = SHA256(run_id)` depends on. Both `--mode` and `--id` are validated against the same bare-id allowlist `init-interactive` already applies to `--id` and `--issue` (`ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/`, and an explicit `..` reject; run-ledger.js:46, 183), before any dir is created; a bad value exits 2 and mints nothing.

**Shared genesis-emit helper.** The three mint paths' genesis emits are today byte-identical hand-duplicated lines. Extract the emit into one helper both the existing paths and the new verb call, so the L3 path cannot drift out of sync again. Under Option B the helper carries no `onlyIfEmpty` self-heal branch; it always appends a mint-time genesis on a fresh dir, where `seq` is legitimately 0.

```
FUNCTION emitGenesisRunStart(run_dir, { level }):
  appendRecordUnderLock(run_dir, (seq, _prevRecord, prevHash) => (
    { schema:2, run_id: basename(run_dir), seq, ts: nowIso(), prev: prevHash,
      phase:"run", type:"run-start", data: { level } }
  ))
```

**Anchor-point genesis guard in `faff events anchor` (via `mintIssueAnchor`).** Before the byte-copy, validate the source `events.jsonl` is a valid genesis chain. If it is absent, empty, whitespace-only, torn/partial, missing its seq-0 `run-start`, or fails `verifyChain`, refuse: return a fail-closed refusal (`no-events` for absent, a new `genesis-invalid` for present-but-invalid), commit no anchor, and modify **nothing** in the run dir. This refusal is the signal graft's Step 9b turns into the shared `needs-human` park.

**Design decisions.** All markers are collected in section 6 with full rationale; the canonical markers are:

- Core direction: **Chosen:** Option B, prevent at the mint seam *and* fail closed at the anchor point. The truncate-under-lock self-heal is removed.
- Backstop behaviour: **Chosen:** an absent-or-invalid genesis at the anchor point refuses fail-closed and the run parks `needs-human`; the events log is never truncated, reconstructed, rewritten, or emitted over.
- Backstop location: **Chosen:** the guard lives in `faff events anchor` / `mintIssueAnchor` (the CLI), surfaced by graft Step 9b as the shared `needs-human` park, the same handling Step 9b already gives an anchor CLI error.
- Mint-seam form: **Chosen:** a new atomic L3 CLI verb `faff run-ledger init-self-drain`, not another prose emit step.
- Mint-before-dispatch: **Chosen:** beep-boop calls the verb before step 4 and before any lane dispatch, making the genesis an unconditional precondition of dispatch.
- `--mode` / `--id` validation: **Chosen:** validate both with the same bare-id allowlist `init-interactive` uses (reject `/` and `..`), exit 2 and no dir on a bad value.
- Duplication: **Chosen:** extract one shared `emitGenesisRunStart` helper the three mint paths call.
- Verb issue-scoping / naming: **Chosen:** `init-self-drain`, not issue-scoped (`--issue` not required).
- Structure / packaging: **Chosen:** keep the ticket whole and land the mint-seam fix and the anchor-point fail-closed guard as **two separately-reviewable commits on one branch**.

## 4. HOW, Behavior

**Architecture and approach.** Two independent guarantees, layered:

1. **Prevention, genesis by construction, before dispatch.** Add `faff run-ledger init-self-drain` (atomic L3 mint + genesis), extract the shared `emitGenesisRunStart` helper, and rewire beep-boop's prose mint to call the verb instead of a hand-authored ledger write with the genesis living only in a later event-table row. After this, a correctly-driven beep-boop run emits the genesis *before* it dispatches any build lane, so the lane inherits an anchorable chain by construction. The mint is an unconditional precondition of dispatch: no lane is dispatched until `init-self-drain` has returned a run dir carrying a genesis.

2. **Recovery, fail closed at the anchor point.** Because a dispatched lane inherits whatever run dir it is handed (graft trusts an inherited `FAFF_RUN_DIR` with no check that the chain is a valid genesis chain), a mint-seam fix alone cannot defend a future or foreign dispatch that hands over a genesis-less dir. Make `faff events anchor` validate the genesis before it byte-copies; on an absent-or-invalid genesis it refuses without touching the log, and graft parks the run `needs-human`. Every entry point, including boundaries not yet imagined, either reaches a verifiable chain or stops safely at a human park; it never manufactures one.

**Packaging (human-ratified).** The two guarantees ship together on one branch (the recurrence reproduced across two independent dispatch paths, so both land together) as **two separately-reviewable commits**: commit 1 the mint-seam fix (`init-self-drain` + shared helper + `--mode`/`--id` guard + beep-boop rewire), commit 2 the anchor-point fail-closed guard (the genesis-validity check + the graft Step 9b park mapping). Because commit 2 contains no in-place mutation of a live events log, its review focus is the *refusal predicate and the park routing*, not a concurrency reconciliation.

**Anchor-point guard precondition and procedure.**

```
PROCEDURE mintIssueAnchor(run_dir, issue, dest_dir):     # fail-closed guard added at the top
  1. valid_genesis :=
       events.jsonl exists
       AND its seq-0 record is a run-start with prev == SHA256(basename(run_dir))
       AND verifyChain(events.jsonl) → verified
     # absent / zero-byte / whitespace-only / torn-partial-line / no seq-0 run-start / unverifiable → NOT valid
  2. IF NOT valid_genesis:
       RETURN { ok:false, code: <"no-events" if absent | "genesis-invalid" if present-but-invalid>,
                message: "<run_dir> has no valid genesis chain, refusing to anchor" }
       # NO truncate, NO reconstruct, NO emit-over, NO write of any kind into run_dir
  3. Proceed to the existing byte-copy of events.jsonl + run-ledger.json (+ optional effects/floor files) into dest_dir
  4. Compute + write the CLI chain-head witness as today
  RETURN { ok:true, head, … }
```

The guard is read-only against the run dir: it reads `events.jsonl`, decides valid-or-not, and either proceeds or refuses. There is no lock to hold because there is no write to serialise; the whole class of concurrency objections the prior self-heal raised does not arise here.

**How the refusal becomes a human park.** Graft Step 9b (`faff-graft/SKILL.md`) already runs `faff events anchor` before `gh pr create` and already aborts Step 9b before the PR on any anchor CLI error. Extend that handling: an anchor refusal with code `no-events` or `genesis-invalid` routes to the **shared park protocol**, apply `faff-parked`, post a park comment naming the missing/torn genesis and the run dir, and return `needs-human`. Because the anchor runs before the PR is opened, no PR exists to flip to draft; the run simply parks with no PR, the same shape as a Step-9 `needs-human`. The run's `events.jsonl` is left exactly as found for the human to inspect.

**Behaviour summary of the mint verb.** `init-self-drain` creates the run dir whose basename *is* the `run_id`, writes an L3 ledger under the same locked core every ledger write uses, then emits the genesis `run-start` (seq 0, `prev` = `SHA256(run_id)`, `data.level: "L3"`) through `emitGenesisRunStart`. The ledger write (step 6) and the genesis emit (step 8) are two locked operations, not one critical section; the verb is **fail-closed across the seam** rather than atomic across it: it reports success (exit 0) **only** when both landed, and exits 3 on either failure (step 7 / step 9), so no exit-0 mint ever leaves a dir with a ledger but no chain. A crash between the two leaves a half-minted dir that the read-only anchor guard refuses fail-closed — never a false-success mint.

```
PROCEDURE init_self_drain(values):
  1. Validate --id shape if supplied (bare id, no "/", no "..") → else exit 2, no dir
  2. Validate --mode shape if supplied (SAME bare-id rule) → else exit 2, no dir
  3. Guard: if a LIVE L3/L4 run is already resolved → exit 3, no partial dir (best-effort sentry-trip observe on the live run)
  4. run_id := --id OR  run-<utcStamp>-beepboop-<mode>-<entropy>
  5. mkdir run_dir (basename == run_id). IF run_dir already EXISTS (EEXIST) → exit 3, write nothing into it. A stale dir with no live owner does NOT trip step 3's live-run guard, so this EEXIST refusal is the check that stops an append over a stale tail from producing a seq-N record whose `prev` is not `SHA256(run_id)` — the genesis contract (seq 0, `prev == SHA256(run_id)`) is enforced by refusing the mint, not by trusting dir freshness.
  6. write run-ledger.json { level:"L3", run_id, admitted:[], outcomes:{}, owner:{status:"running", …} } under the ledger lock
  7. IF the ledger write did not land → exit 3 (never a mint over an absent ledger)
  8. emitGenesisRunStart(run_dir, { level:"L3" })
  9. IF the genesis emit did not land (e.g. events-lock exhaustion after step 6) → exit 3, report NO success. The verb MUST never exit 0 over a dir that has a ledger but no genesis — that is the exact `anchor-missing` state this ticket removes. The half-minted dir is left in place for the anchor guard to refuse fail-closed; the verb's own contract ("a returned run dir always carries a genesis") holds by construction because the verb never returns 0 on a failed emit.
  10. print run_dir (bare) or the --json object; exit 0
```

**beep-boop rewire (`faff-beep-boop/SKILL.md`).** In the run-mint step (_Owner stamp & heartbeat_ → "At run start"), replace the hand-authored `run-ledger.json` write with `run_dir=$("$faff" run-ledger init-self-drain --mode <mode>)`, then `export FAFF_RUN_DIR`/`FAFF_SESSION_ID` as today and layer the owner stamp + budget baseline onto the minted ledger. State the mint as **before step 4 and before any lane dispatch**: the run-start row in the run-event-log table stops being the only home of the genesis emit; genesis is now minted by the verb as a construction-time precondition of dispatch. beep-boop's existing ledger augmentation (budget baseline via `faff budget baseline`, `admitted` appends, `outcomes`, owner close) is unchanged and continues via its normal ledger-write-plus-`ledger-write`-event path. Reuse of an already-minted L4 lights-out ledger (beep-boop §0a `inherited-l4`) is untouched; that path mints no run-id and already carries a genesis.

**Edge cases and error handling.**

- **Ledger absent AND chain absent** → `no-events` exit 3 at the anchor, unchanged; graft parks `needs-human`. Never fabricate a run that was never minted.
- **`events.jsonl` present but zero records / zero bytes / whitespace-only / torn partial line** → `genesis-invalid` at the anchor; graft parks `needs-human`. The file is **not** modified.
- **`events.jsonl` present, seq-0 record present but `prev != SHA256(run_id)` or `verifyChain` fails** → `genesis-invalid`; park; log untouched.
- **`events.jsonl` present with a valid genesis chain** → proceed to byte-copy (a stale fold there is the *other*, out-of-scope remedy).
- **Verb mint where the ledger write does not land (lock-budget exhaustion)** → exit 3, no genesis emitted, no success reported, same fail-closed stance as `init-interactive`.
- **Verb mint where `run_dir` already exists (EEXIST — a re-run with the same `--id`, or a stale dir left by a killed run with no live owner)** → exit 3, write nothing into it. The mint is refused rather than appended-over, so no seq-N record is ever added to a stale tail.
- **Verb mint where the ledger lands but the genesis emit fails** → exit 3, report no success; the half-minted dir (ledger, no chain) is then refused fail-closed by the anchor guard. The verb never returns 0 over a genesis-less dir.
- **`--mode` or `--id` carrying `/` or `..`** → exit 2, no dir minted, no partial state.

Error categories: a mint-verb guard refusal (bad id/mode → 2; live-higher-level or failed-write → 3) is terminal for that call, mints no partial dir, and the caller retries or escalates. An anchor-point refusal is terminal for that anchor attempt and routes to a human park; it writes nothing into the run dir.

**Failure modes, how this approach could be wrong, and how you'd notice.**

- **The anchor-point park fires for a healthy run.** If the guard's validity predicate were too strict, a genuinely anchorable run could be parked. *How you'd know:* the park comment names the run dir and the specific reason (absent / no seq-0 run-start / prev-mismatch / unverifiable), and a human can read the log directly; a run that was correctly minted through `init-self-drain` always carries a seq-0 `run-start` with the right `prev`, so a false park points at a real provisioning defect, not a guard bug. *What it means:* investigate which mint path produced the log the guard rejected.
- **The prevention fix regresses and the anchor guard silently masks it.** It cannot, under Option B: the guard does not repair, so a re-broken mint surfaces as a *visible human park*, not a silent recovery. A rising park rate on the anchor guard is the signal that a mint path regressed.
- **A parked run strands an issue.** The park is the shared `needs-human` protocol, so the issue carries `faff-parked` and re-surfaces in `/faff-wtf`; it is not lost. The human either re-mints the run or fixes the provisioning defect.

**Anti-pattern:** reintroducing any in-place repair of `events.jsonl` at the anchor point (truncate, reconstruct, emit-over). Why: this is the exact destructive, fail-open design the human rejected on 2026-09-13; the anchor point is read-only against the run dir and refuses rather than repairs.

**Anti-pattern:** having the mint (or any path) hand-author the genesis JSON and pipe it to `faff events append`. Why: it re-derives `seq`/`prev` outside the locked core, which is the ADR-0084 fragility that caused this bug; always route through `appendRecordUnderLock`.

**Anti-pattern:** validating only `--id` and leaving `--mode` unchecked. Why: `--mode` reaches the run-dir path too, so a `/` or `..` there escapes `.faff/runs/` or breaks `basename == run_id`; both flags share one allowlist.

**Anti-pattern:** "fixing" a genesis-less run by having the build subagent mint the genesis itself (the undocumented workaround from the two failing runs). Why: it violates the `events.jsonl` sole-writer invariant with an improvising agent write; the sanctioned outcomes are a CLI mint at dispatch time or a fail-closed park at the anchor.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh L3 run dir minted via `faff run-ledger init-self-drain --mode full`
When a build lane is dispatched carrying only that run_dir
Then events.jsonl exists with a seq-0 run-start whose prev == SHA256(run_id)
 And `faff events anchor` exits 0 and commits the anchor (no anchor-missing at merge-gate)
```

```
Given a run dir that has run-ledger.json but no events.jsonl
When `faff events anchor` runs against it
Then it refuses fail-closed (code no-events, exit 3), commits no anchor, and writes nothing into the run dir
 And graft Step 9b parks the run needs-human (faff-parked, park comment, no PR)
```

```
Given a run dir with run-ledger.json and a residual-bytes events.jsonl (whitespace-only or a torn partial line)
When `faff events anchor` runs against it
Then it refuses fail-closed (code genesis-invalid, exit 3), commits no anchor, and leaves events.jsonl byte-for-byte unchanged
 And graft Step 9b parks the run needs-human
```

```
Given a run dir whose events.jsonl already holds a valid seq-0 genesis chain
When `faff events anchor` runs against it
Then it proceeds, byte-copies the chain into the committed anchor, and exits 0
```

```
Given `faff run-ledger init-self-drain --mode ../escape` (or --mode with a "/")
When the verb runs
Then it exits 2 and mints no run dir (the same guard init-interactive applies to --id)
```

```
Given a run dir whose events.jsonl holds a seq-0 run-start but with prev != SHA256(run_id), OR a chain whose verifyChain fails (a tampered / mis-linked record)
When `faff events anchor` runs against it
Then it refuses fail-closed (code genesis-invalid, exit 3), commits no anchor, and leaves events.jsonl byte-for-byte unchanged
```

```
Given `.faff/runs/X` already exists (a stale dir from a killed run)
When `faff run-ledger init-self-drain --id X` runs
Then it exits 3 and writes nothing into the existing dir (no append over a stale tail)
```

```
Given a LIVE L3/L4 run is already resolved
When `faff run-ledger init-self-drain --mode full` runs
Then it exits 3 and mints no partial dir
```

```
Given the ledger write lands but the genesis emit fails (simulated events-lock exhaustion between steps 6 and 8)
When `faff run-ledger init-self-drain --mode full` runs
Then it exits 3, reports no success, and the half-minted dir (ledger, no chain) is subsequently refused fail-closed at the anchor
```

- The recovery path never modifies a live events log: on any absent-or-invalid genesis, the run dir's `events.jsonl` (present or not) is left exactly as found, and the run parks for a human.

## 6. Design Decision Rationale

**Self-heal, or fail closed? (the human decision of 2026-09-13)**
- *Reconstruct-and-truncate self-heal (prior spec):* the spec-review gate parked it `reject-approach` on two grounds: it was not implementable as written (the mint helper re-acquired a lock the step already held, deadlocking or dropping the truncate outside the lock into the exact race it meant to prevent), and it was destructive (an irreversible truncate before the emit, fail-open on an emit failure, over-broad abort predicate that only checked seq-0).
- *Fail closed (Option B):* the anchor point does not repair. A run reaching the anchor without a valid genesis is refused, the log is left untouched, and the run parks `needs-human`. Prevention at the mint seam keeps the healthy path correct by construction; the anchor guard is a read-only safety net, not a rewriter.
- **Chosen:** Option B, prevent at the mint seam and fail closed at the anchor point. Never truncate a live events log. (Human decision, 2026-09-13.)

**What resolves the standing spec-review objections?** All four are resolved *by construction* under Option B, because there is no truncate and no in-place write on the recovery path:
- *Architectural blocker (the mint helper re-acquires the lock it already holds):* gone. The anchor guard holds no lock and performs no emit; it is a read-only validity check.
- *Infosec major (abort predicate should be "any valid record in the locked tail", not just seq-0):* moot. There is no abort-then-truncate; the guard's decision is only *proceed* (valid genesis chain) vs *park* (missing/torn), and on any doubt it fails closed to a park.
- *Infosec major (irreversible truncate precedes the emit → fail-open on an empty log):* gone. There is no truncate and no emit at the anchor, so there is no window to commit an anchor over an empty log.
- *Infosec major (`--mode` path-traversal, only `--id` validated):* fixed directly. `--mode` and `--id` share one bare-id allowlist (see below), and this fix applies regardless of A/B.
These are addressed, not dropped: the anchor guard's only outcomes are anchor-a-valid-chain or park-for-a-human.

**Where does the fail-closed guard live, `faff events anchor` or graft Step 9b prose?**
- *Graft Step 9b prose only:* a prose-only check defends only the graft path and re-introduces prose fragility.
- *`faff events anchor` (the CLI):* deterministic, tested, and defends every caller (per-PR `anchor`, run-level `anchor-run`, and any future consumer) through one code path; graft Step 9b maps its refusal to the shared park.
- **Chosen:** the CLI guard inside `mintIssueAnchor`, surfaced by graft Step 9b as the shared `needs-human` park.

**How is the mint-seam gap closed, prose emit or CLI verb?**
- *Add a mandatory prose `echo … | faff events append` step:* still hand-authored and drift-prone; ADR-0084 exists to stop exactly this.
- *Add an atomic L3 CLI verb:* genesis is minted by construction inside the same call that creates the dir, with the guard/no-partial-dir/downgrade-refusal semantics `init-interactive` already proved, and it is called before any dispatch.
- **Chosen:** a new `faff run-ledger init-self-drain` verb; beep-boop calls it in place of the hand-authored ledger write, before step 4 / any dispatch.

**How are `--mode` and `--id` validated?**
- *Validate `--id` only (prior spec):* leaves `--mode`, which also lands in the run-dir path, free to carry `/` or `..`, escaping `.faff/runs/` or breaking `basename == run_id`.
- *Validate both with one allowlist:* `--mode` and `--id` both satisfy `init-interactive`'s existing bare-id rule (`ISSUE_ID_RE` + explicit `..` reject) before any dir is created.
- **Chosen:** validate both, exit 2 and no dir on a bad value. Applies regardless of the A/B direction.

**Add a third near-duplicate genesis emit, or factor one helper?**
- *Third duplicate:* `lights-out.js` and `run-ledger.js` already carry byte-identical genesis emits; a third copy is how the L3 path drifted in the first place.
- *One shared helper:* `emitGenesisRunStart(run_dir, {level})` called by all three mints, one home for the emit shape.
- **Chosen:** extract the shared helper; refactor the two existing mints to call it (mandated — see DONE), and always use it for the new verb.

**Is the L3 verb issue-scoped?**
- *Require `--issue` like `init-interactive`:* wrong for a self-drain run, which admits many issues over waves and is not issue-scoped at mint; `run-start` is not an issue-scoped event.
- **Chosen:** `init-self-drain`, not issue-scoped, `--mode` (for the `beepboop-<mode>` run-id) and optional `--id`, no required `--issue`.

**Keep the ticket whole, or split the mint-seam fix from the anchor guard?**
- *Split into two tickets:* each is a valid standalone unit, and sequencing the mint fix first de-risks. But the recurrence reproduced across two independent dispatch paths (beep-boop L3 and a direct graft), so the prevention and the fail-closed backstop genuinely ship together.
- *Keep whole:* one branch, one outcome (a genesis chain at every dispatch, and a safe park when one is missing), the shared `emitGenesisRunStart` helper landing once. Reviewability is preserved by two separately-reviewable commits.
- **Chosen:** keep whole, two separately-reviewable commits on one branch (commit 1 prevention, commit 2 the fail-closed anchor guard + park mapping).

At the time of writing there is no L3 CLI mint verb (`run-ledger` has only `init-interactive` [hardcoded L2] and `record-outcome`; `lights-out` mints only L4), `mintIssueAnchor` performs no genesis-validity check before its byte-copy, and no test exercises the `no-events` refusal-to-park path; all three are addressed here.

## 7. Open Questions and Assumptions

**Open Questions.** None. The prior standing objection (torn-tail / residual-bytes heal) is dissolved by Option B: there is no heal to make correct, only a fail-closed refusal. The packaging question is settled (keep whole, two commits). No punt remains.

**Guard scope — well-formedness, not provenance (Assumes).** The anchor guard validates genesis **well-formedness** (existence, seq-0 `run-start`, `prev == SHA256(run_id)`, `verifyChain` verified), **not provenance**. A byte-well-formed genesis hand-authored by a run-dir writer (the anti-pattern workaround from the two failing runs) is indistinguishable from a CLI-minted one and passes the guard. This is **accepted, not overlooked**: a writer with `.faff/runs/<run>/` write access is already inside the trust boundary (it can write the ledger and the chain either way), so the guard cannot and does not try to be forgery-resistant. Its job is to catch **absence/corruption** (the actual failure mode this ticket removes), and the "genesis is minted, never hand-authored" principle is enforced by the `events.jsonl` sole-writer discipline + the stated anti-pattern, not by this predicate. **Assumes:** forgery-resistance (e.g. a signed/attested genesis) is out of scope; if the run-dir write surface ever stops being trusted, the guard predicate would need a provenance check, which is a separate ticket.

**Assumptions.** None requiring external validation. `appendRecordUnderLock`, `computeChainHead`, `verifyChain`, the schema-2 genesis contract in `governance-profile.js`, the `run-ledger` subcommand dispatch, `ISSUE_ID_RE` (run-ledger.js:46), `mintIssueAnchor`'s `no-events` path (events.js:1354), and `faff budget baseline` all exist in-repo and were confirmed against the code during authoring. FAFF-930 (the L4-ratification consumer of the level-less-genesis invariant) is confirmed **Done**, so its dependency is honoured by the prose citation and needs no `blockedBy` edge; **Assumes:** FAFF-930 stays Done through build (if it reverts, re-add the citation check, not a code change here).

## 8. DONE, Definition of Done

### From WHY
- [ ] A run dir minted through the fixed L3 path has a non-empty, valid-genesis `events.jsonl` **before any build lane is dispatched**, so `faff events anchor` no longer returns `no-events`/`anchor-missing` for it.
- [ ] A run that reaches the anchor point without a valid genesis chain **parks needs-human and leaves its `events.jsonl` byte-for-byte unchanged**, no truncate, reconstruct, rewrite, or emit-over.

### From WHAT (types and interfaces)
- [ ] `faff run-ledger init-self-drain` exists, is registered in the `run-ledger` dispatch + `USAGE`, and mints run dir + L3 `run-ledger.json` + genesis atomically.
- [ ] The verb's genesis is schema 2, `seq` 0, `prev` == `SHA256(run_id)`, `type` `run-start`, `data.level` `"L3"`, `run_id` == `basename(run_dir)`.
- [ ] The verb rejects a bad `--id` **and a bad `--mode`** (a `/` or `..` → exit 2, no dir), refuses when a live L3/L4 run is resolved (exit 3, no partial dir), refuses when the run dir already exists (EEXIST → exit 3, no write into it), and fails closed if **either** the ledger write **or** the genesis emit does not land (exit 3, no success reported — never exit 0 over a dir with a ledger but no chain).
- [ ] The verb is not issue-scoped (`--issue` not required); bare stdout is the run dir path, `--json` carries `{proceed, level:"L3", run_id, run_dir, …}`.
- [ ] One shared `emitGenesisRunStart(run_dir, {level})` helper exists and is the emit path for **all three** mints — the new verb, the L4 lights-out mint (`lights-out.js`), and the L2 `init-interactive` mint (`run-ledger.js`) — so **no hand-duplicated genesis-emit site remains** (the drift mechanism this ticket exists to kill is closed only if every emit site converges on the helper); it carries no self-heal / `onlyIfEmpty` branch. If a specific existing mint genuinely cannot adopt the helper without changing its emitted genesis shape, that mint is **called out explicitly with the reason** in the PR rather than silently left duplicated.
- [ ] The L4 lights-out and L2 `init-interactive` mint tests still pass unchanged after the refactor (a named regression assertion that the two shipped mint paths' emitted genesis shape — `seq`/`prev`/`data.level` — is byte-preserved).

### From HOW (behaviour)
- [ ] `mintIssueAnchor` validates the genesis chain before its byte-copy and **refuses** (code `no-events` when absent, `genesis-invalid` when present-but-invalid) without writing anything into the run dir.
- [ ] Graft Step 9b maps that refusal to the shared `needs-human` park (`faff-parked` + park comment naming the run dir + reason, no PR). **Oracle:** the automatable half is the CLI refusal (`faff events anchor` → non-zero `no-events`/`genesis-invalid`, asserted by the anchor-guard test below); the park-routing half is a **prose-skill (graft) invariant verified by SKILL.md review** (graft has no automated test harness), so this DONE item is discharged by (a) the tested CLI refusal exit code plus (b) a reviewer confirming Step 9b's prose routes that exit code to the shared park protocol with no PR. State this split explicitly so a reviewer knows which half is machine-checked.
- [ ] beep-boop's mint step calls `faff run-ledger init-self-drain --mode <mode>` instead of a hand-authored ledger write, before step 4 / any dispatch; its ledger augmentation and L4-reuse paths are unchanged. **Oracle:** the automatable half is that a dir minted by the verb carries a genesis (the init-self-drain test below); the **before-any-dispatch ordering** is a prose-skill (beep-boop) invariant verified by SKILL.md review, not by an automated test — a reviewer confirms the `init-self-drain` call sits before step 4 / any lane dispatch. This split is stated so the ordering guarantee is not mistaken for a machine-checked one.
- [ ] The mint-seam fix and the anchor-point fail-closed guard land as **two separately-reviewable commits** on one branch.

### From HOW (edge cases)
- [ ] Ledger-absent AND chain-absent still returns `no-events` (exit 3) with no fabricated genesis and a human park.
- [ ] A zero-byte, whitespace-only, torn-partial-line, **wrong-`prev` (seq-0 run-start present but `prev != SHA256(run_id)`)**, and **`verifyChain`-failing (tampered/mis-linked)** `events.jsonl` each route to `genesis-invalid` → park, and each is left **unmodified** on disk (asserted by a before/after byte comparison). The guard's three validity conjuncts — file exists, seq-0 run-start with the right `prev`, `verifyChain` verified — are each independently exercised, so a build that checks only "file exists / non-empty" fails at least one case.
- [ ] A valid-genesis `events.jsonl` is anchored normally (exit 0) and never parked.

### Tests
- [ ] A test asserts `init-self-drain` mints genesis + L3 ledger and honours its guards — bad `--id`, **bad `--mode`**, live-higher-level refusal (exit 3), **EEXIST run-dir refusal (exit 3, nothing written)**, ledger-write fail-closed (exit 3), and **genesis-emit fail-closed (ledger lands, emit fails → exit 3, no success reported)** — mirroring `run-ledger-init-interactive.test.mjs`.
- [ ] A test asserts a `/` and a `..` in `--mode` are rejected (exit 2, no dir), alongside the existing `--id` cases.
- [ ] A test asserts the anchor guard refuses on **each** validity conjunct independently: `no-events` (absent, **and neither-file: ledger-absent AND chain-absent**), and `genesis-invalid` for zero-byte, whitespace-only, torn-partial-line, **wrong-`prev`**, and **`verifyChain`-failing (tampered)** chains — and that in every refusal the run dir's `events.jsonl` is byte-for-byte unchanged (before/after comparison).
- [ ] A test asserts a valid-genesis run anchors (exit 0) and is not parked.
- [ ] A named regression assertion that the L4 lights-out mint and the L2 `init-interactive` mint still emit their genesis unchanged (`seq`/`prev`/`data.level` byte-preserved) after the `emitGenesisRunStart` extraction.

### Decision record
- [ ] If graft's ADR gate fires for this build, the Option-B genesis-provisioning decision (dispatch-time mint + fail-closed anchor park + never-truncate) is recorded as an ADR referencing 0081/0084/0085 and naming the 2026-09-13 human decision.

**Integration smoke test.**

```
1. run_dir := `faff run-ledger init-self-drain --mode full`
2. assert events.jsonl in run_dir has exactly one record: seq 0, type run-start, prev == SHA256(basename(run_dir)), data.level == "L3"
3. `faff events anchor --run-dir run_dir --issue FAFF-XXX --dest <anchor_dir>` → exit 0; committed anchor exists; `faff events verify` on the copied chain → verified
4. cp run_dir/events.jsonl /tmp/before ; rm run_dir/events.jsonl   # simulate a genesis-less inherited dir
5. `faff events anchor …` → non-zero (no-events); assert NO anchor committed and run_dir/events.jsonl still absent (nothing fabricated)
6. printf ' \n' > run_dir/events.jsonl ; cp run_dir/events.jsonl /tmp/before2   # residual-bytes variant
7. `faff events anchor …` → non-zero (genesis-invalid); assert run_dir/events.jsonl == /tmp/before2 byte-for-byte (never truncated)
8. `faff run-ledger init-self-drain --mode ../x` → exit 2, no run dir minted
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```