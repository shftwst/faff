# Spec — FAFF-520: Executors bracket graft dispatches with integrity-digest

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-520.

This document is the build spec for FAFF-520 (revision 3 — see the spec-review trail at the end). It tells the build agent (and human reviewers) exactly how the two `concurrency` executors — `faffter-noon-concurrency-sequential` and `faffter-dark-concurrency-parallel` — wrap every build-subagent dispatch in an integrity-digest custody bracket using the already-shipped `faff integrity-digest` CLI (FAFF-518, PR #400). It is a prose-skill change (two executor `SKILL.md`s plus one gateway contract addition) with a small mechanical test delta; no new CLI code.

## 1. WHY — Problem and Principles

**The load-bearing model: custody, not signatures.** The trusted orchestrator (the concurrency executor) takes a digest snapshot of the run-grain evidence set immediately before dispatching an untrusted build subagent, holds the resulting manifest *in its own conversation context* — a place the subagent structurally cannot read or alter — and verifies against it the moment the subagent returns. Any change to the bracketed evidence that the orchestrator did not itself make between snapshot and verify is tampering, detected *before* the evidence influences any downstream decision. Custody in context replaces signatures (a same-uid key is forgeable; a conversation context is not).

**Problem:** the run-grain evidence members (`corrective/`, `run-ledger.json`, `events.jsonl`) are orchestrator-only-writable by convention, but nothing detects a build subagent that violates the convention mid-dispatch — a tampered ledger, forged corrective artifact, or rewritten event history flows silently into the orchestrator's later decisions (re-dispatch constraints, blocker-merged checks, run summary). FAFF-518 shipped the deterministic snapshot/verify CLI; this ticket wires it into both executors' dispatch sites so tampering parks the issue instead of being consumed.

**Design principles:**

- **The manifest never touches disk.** Custody is the whole mechanism. The snapshot's stdout JSON lives only in the orchestrator's conversation context and is fed back via `verify --manifest -` (stdin) or as an inline JSON argument — never written to a file. A manifest on disk is a manifest the subagent can read, replay, or replace.
- **Never proceed-as-verified on failure.** `verify` exit 1 is tamper; exit 2 is a CLI/infra error. Both mean the evidence is unverified and must not be consumed. There is no code path from a non-zero exit to normal outcome recording.
- **Honest trust class only.** The verdict surfaces as `digest-verified` and nothing else. It never references `FAFF_INTEGRITY_BOUNDARY`, never feeds `integrityGate`, and is never presented as the mount-asserted basis — those are a separate authority; conflating them is the lying-attestation failure the shipped CLI's own selftest guards against in code.
- **Detection, never a gate change.** The bracket adds a detection step ahead of evidence consumption. The merge floor (AC + CI + review, plus the L4 holdout) is byte-for-byte untouched — gateway concurrency-contract obligation 4 stands exactly as written.
- **Verify immediately on return.** The longer the manifest sits in context, the larger the compaction window in which custody could be lost. Verify-on-return keeps that window small; the residual is accepted at this rung (see the lost-custody decision in HOW).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/integrity-digest.js` | Shipped snapshot/verify CLI this ticket consumes (no changes expected) |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` (`correctiveIntegrityDirs`) | Single source of the bracketed member set |
| `plugin/skills/faff/SKILL.md` → Mechanism slot (`concurrency`) | Gateway-owned slot contract — home of the new shared bracket obligation |
| `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md` | Sequential executor — per-dispatch bracket insertion |
| `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` | Parallel executor — continuous custody chain + re-baselining |
| `plugin/skills/faff/test/integrity-digest.test.mjs` | Existing CLI test seam for the small mechanical delta |

**Scope statement:** this is the wiring rung of the FAFF-518/519/520 chain — the CLI exists, the write-authority ruling exists; this ticket makes both executors actually use them at run grain.

## 2. OUT OF SCOPE

- **Per-issue bracket expansion** (`ac-checklist.json`, `review-verdict.json`, `holdout.json`) — those members are still legitimately lane-written mid-dispatch until the FAFF-519 write-relocation follow-ups land; FAFF-519's DoD mandates splitting the expansion into its own ticket. Extension point: the bracket procedure's member set is defined once in the gateway obligation; the future ticket widens it there (and drops `--issue`-omission from the snapshot calls' rationale) — no executor restructuring needed.
- **Merge-gate consumption of the digest verdict as an `integrityGate` basis** — a follow-on the ticket explicitly excludes. Extension point: `merge-gate.js`'s `resolveIntegrity`, a separate authority this spec deliberately never touches.
- **Graft-internal finer bracket grain** — follows the lane-cut decision; jotted separately when it lands. Extension point: the same snapshot/verify CLI at graft-internal call sites.
- **Any CLI change** — `faff integrity-digest` is shipped and sufficient (snapshot/verify, run-grain via omitted `--issue`, `--events`, `--manifest -`, exit 0/1/2, named tampered paths). This spec found no gap requiring code in `integrity-digest.js`.
- **Restoring or repairing tampered evidence** — this rung detects and parks; forensic repair is human work driven by the park comment and run summary.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Bracket | The snapshot → dispatch → verify pair around untrusted work |
| Custody / baseline | The manifest held in the orchestrator's conversation context |
| Re-baseline | Replacing the held manifest with a fresh snapshot immediately after an orchestrator's *own* legitimate evidence write |
| Custody chain | A sequence of baselines where every replacement was preceded by a clean verify — so no unobserved window exists |
| Run-grain members | `corrective/`, `run-ledger.json` (byte-exact) + `events.jsonl` (prefix-preserving), i.e. `correctiveIntegrityDirs(runDir)` + `--events` |

**The CLI surface consumed (shipped, for reference — not to build):**

```
faff integrity-digest snapshot --run-dir <dir> --events
  → stdout: {"version":"d1","grain":"run","members":{...}}   (exit 0)

printf '%s' "<held manifest JSON>" | faff integrity-digest verify --run-dir <dir> --events --manifest - --json
  → exit 0: {"verdict":"digest-verified","tampered":[]}
  → exit 1: {"verdict":"tampered","tampered":["<path> (suffix)", ...]}
  → exit 2: usage / thrown error (e.g. sha256sum unavailable) — never a silent verified
```

`--issue` is always omitted (run grain). Missing `events.jsonl` at snapshot is recorded absent and stays clean unless presence flips.

**Where the bracket procedure prose lives.** The two executors would otherwise each carry a near-identical bracket procedure — which the `faff validate-adapters` duplicated-block rule (≥6 identical significant lines across 2+ skills) forbids, and which the gateway's own design already answers: the concurrency contract is gateway-owned and occupants refer back. So the procedure becomes a **fifth obligation** in the gateway's fixed `concurrency` slot contract — "Bracket every graft dispatch with integrity-digest custody" — stating the member set, the custody rule (context-held, never disk), the verify-immediately rule, the exit-1/exit-2 outcomes, and the trust-class restriction. Each executor's `SKILL.md` then adds only its own *placement and mechanics* paragraph (where its snapshot/verify calls sit; for parallel, the re-baselining chain), referring back for everything shared. Numbering it obligation 5 keeps the existing obligations 1–4 (and every cross-reference to "obligation 2"/"obligation 4") stable; every place that recaps the obligation count (the executors' contract recaps, and the gateway list itself if it names a count) updates to five. Alternative rejected: a free-standing named gateway procedure outside the contract — weaker, because the contract is the one section every occupant is already bound to load and honour, and a swap-in third-party executor must inherit the bracket too.
**Chosen:** the bracket is gateway concurrency-contract obligation 5; executors carry only their placement/mechanics prose and refer back.

**Member set and `--events`.** Passing `--events` unconditionally makes the bracketed set deterministic (always the same three members), covers event-history truncation/rewrite as tamper, and costs nothing when `events.jsonl` is absent (recorded absent, clean unless presence flips). The parallel executor's own poll-loop `sentry-checkpoint` appends verify clean under the shipped prefix rule, so `--events` introduces no false positive and no re-baseline burden for appends. Alternative rejected: omitting `--events` — leaves the one member a tampering subagent could rewrite most consequentially (the run's audit trail) unbracketed for no saving.
**Chosen:** both executors always pass `--events` on every snapshot and verify; `--issue` always omitted.

## 4. HOW — Behavior

### Sequential executor (`faffter-noon-concurrency-sequential`)

The sequential executor blocks foreground on exactly one dispatch at a time, and between snapshot and verify it writes nothing (its heartbeat between units touches only the dedicated heartbeat file, not a member; its ledger/event writes happen in step 3, after verify). So brackets are simple, disjoint, per-dispatch — no re-baselining exists in this executor at all.

```
FOR each unit in flattened order:                       # existing step 2
  1. SNAPSHOT: faff integrity-digest snapshot --run-dir <run_dir> --events
     → hold stdout manifest in conversation context (never a file)
  2. Dispatch the build subagent, foreground, as today (unchanged)
  3. On return, BEFORE step-3 reconcile-then-record:
     VERIFY: pipe held manifest → faff integrity-digest verify --run-dir <run_dir> --events --manifest - --json
     a. exit 0 → proceed exactly as today (reconcile, record); discard the manifest
     b. exit 1 → tamper-park procedure (below); do NOT reconcile from run-dir evidence
     c. exit 2 → verification-unavailable park (below)
```

Placement rationale: snapshot at the top of step 2 per unit (immediately before dispatch, after any pre-dispatch orchestrator writes like the corrective re-dispatch check), verify as the new first action of step 3 (immediately on return, before the token is reconciled or anything is recorded). Alternative rejected: one snapshot for the whole drain — needless custody duration (bigger compaction window) and it would force re-baselining after the orchestrator's own between-unit ledger writes, importing the parallel executor's bookkeeping into the executor whose whole point is simplicity.
**Chosen:** disjoint per-dispatch brackets — snapshot immediately before each dispatch, verify immediately on each return, zero re-baselining.

### Parallel executor (`faffter-dark-concurrency-parallel`)

With N dispatches overlapping over one *shared* run-grain member set, N independent per-dispatch brackets cannot work: dispatch B's legitimate outcome, recorded by the orchestrator while dispatch A is still in flight, would read as tampering against A's held manifest. The members are shared substrate, so custody must be shared too: the executor maintains **one continuous run-grain custody chain** for the whole wave — a single held baseline, replaced (re-baselined) only by the orchestrator itself, immediately after each of its own legitimate evidence writes, with a verify *before* every replacement so no window goes unobserved. Every writer of the bracketed members is the orchestrator (the write-authority roster: ledger — orchestrator sole writer; `corrective/` — orchestrator-side CLI; `events.jsonl` — orchestrator sole appender), so "everything since the last baseline that I did not write is tamper" is exact, not heuristic.

```
WAVE START (before the first dispatch):
  snapshot → hold baseline B0 in context

ON each subagent RETURN (before consuming its token / recording anything):
  verify against current baseline
    exit 0 → proceed: reconcile token vs ground truth as today
    exit 1 → tamper-park procedure (below)
    exit 2 → verification-unavailable park (below)

ON each orchestrator OWN evidence write                  # ledger outcome record,
  (always in this order — verify → write → post-write check → re-snapshot):  # park writes, corrective ops
  1. verify against current baseline                     # a tamper must be caught BEFORE
     (non-zero → the matching park path, skip the write's normal flow)   # the re-baseline absorbs it
  2. perform the write (unchanged, existing mechanics)
  3. POST-WRITE CHECK (a second CLI verify of the OLD baseline against disk):
     require the tampered set to name EXACTLY the members this write touched —
     a legitimate events.jsonl append still verifies clean under the prefix rule;
     any OTHER member named is tamper → exit-1 path; exit 2 → the parity park path
  4. snapshot → candidate new baseline
  5. INTENDED-CONTENT CHECK (closes the touched-member launder): hash the content
     the orchestrator intended to write, from context via stdin —
     printf '%s' "$intended" | /usr/bin/sha256sum — never re-reading the file;
     require the candidate baseline's recorded sha256 for EACH just-written member
     to equal it (per-file for corrective/ writes; event appends exempt as ever).
     Mismatch → tamper → exit-1 path; only a matching candidate replaces the baseline

POLL-LOOP sentry-checkpoint event appends: NO re-baseline needed —
  events.jsonl is prefix-preserving, appends verify clean against any older baseline.

WAVE END (all units terminal): final verify, then discard the baseline.
```

The verify-→-write-→-post-write-check-→-re-snapshot-→-intended-content-check ordering is the load-bearing part: re-baselining *without* first verifying would launder any tampering since the last observation into the new baseline as if legitimate — and the verify-to-re-snapshot interval itself is unobserved, so two checks close it. The post-write check catches drift on any member the orchestrator did *not* touch (the prefix rule evaluates `events.jsonl` mechanically, so legitimate appends stay clean). The intended-content check catches the one path that check cannot: for the *touched* member "changed" is the expected result, so a subagent watching for the orchestrator's write and rewriting that same member inside the span would otherwise be conforming and absorbed — comparing the candidate baseline's recorded hash against a hash of the intended content held in context makes the attacker's bytes a mismatch, however narrowly timed. One extra subprocess call plus one in-context hash per own-write, no CLI change. Alternative rejected: an in-context old-vs-new manifest diff — it false-positives on `events.jsonl` by construction (a legitimately grown file changes `prefix_sha256`, and the orchestrator cannot recompute a prefix hash in context), and exempting events would reopen the window for the member whose rewrite matters most. Further alternatives rejected: (a) N overlapping per-dispatch brackets — false-positives on every sibling outcome record, exactly the failure the ticket's third AC names; (b) a byte-exact freeze set (forbid all orchestrator writes mid-wave) — impossible, obligation 3 requires recording each terminal outcome the moment it lands. This is the "re-baselining bookkeeping" arm of the write-authority decision, needed only here and only for the orchestrator's own byte-exact-member writes.
**Chosen:** one continuous custody chain per wave — baseline at wave start, verify on every subagent return, verify→write→post-write-check→re-snapshot→intended-content-check around every orchestrator own-write to a byte-exact member (the post-write CLI verify of the old baseline catches drift on untouched members; the in-context intended-content hash comparison catches a rewrite of the touched member itself), no re-baseline for event appends.

### Tamper-park procedure (both executors, on verify exit 1)

The returning unit parks, the evidence is not consumed, and the run surfaces the detection loudly:

1. **Do not consume**: the unit's run-dir evidence and token-claimed outcome are not trusted; no corrective/constraints state is read from disk for any later re-dispatch decision this run.
2. **Park comment** on the tracker issue, citing the CLI's named tampered paths — cause string mirrors the existing park-cause shape: `integrity-digest tampered — <path1> (suffix), <path2>`.
3. **Park label**: `faff label add <issue> faff-parked` (standard op).
4. **Ledger outcome** `parked` for the unit (closed bucket vocabulary — never a new bucket), with the tamper cause. Additionally append the issue id to a top-level `integrity_tampered` array on the ledger — `[{ issue, paths }]` — mirroring the existing `review_outage_pending` top-level-array precedent, so the run summary and `/faff-wtf` surface it durably and loudly. The orchestrator remains the ledger's sole writer, so writing this record is authoritative going forward even though the on-disk *history* is suspect — the array entry is precisely the flag that says so.
5. **Parallel only — free the slot** per the existing member-park mechanics; then apply the wave-response decision below. (The member-park procedure's WIP-commit step does not apply here — the subagent has returned; its branch/worktree state is whatever its graft left, preserved untouched for forensics.)

**Chosen:** cause `integrity-digest tampered — <paths>`; standard park comment + label + `parked` bucket; plus a ledger top-level `integrity_tampered` array mirroring the `review_outage_pending` precedent for loud, durable run-summary surfacing.

**Wave response to tamper (parallel executor).** Tampered run-grain evidence taints the *shared* substrate — the ledger and corrective state every subsequent scheduling decision reads — not just the returning unit. But the existing supervision rule ("never interrupt a genuinely live subagent") still binds. So on exit 1: launch **no new dispatches**; await the already-in-flight subagents to their terminal states exactly as the await-all gate requires; verify-and-record each return through the same bracket (each may independently verify clean or tamper — record accordingly, ground truth for the bucket, tamper flag where it fires); then end the wave, returning to beep-boop with the tamper surfaced. In-flight units' merges cannot be prevented (each graft merges inside its own subagent, against git ground truth, through the untouched merge floor — which does not read the tainted members), and killing them would destroy work and violate the boundary rule. Alternative rejected: park-just-the-returning-unit-and-keep-scheduling — keeps making scheduling decisions from a substrate known to be forged.
**Chosen:** halt new dispatches, drain in-flight units to terminal through per-return verifies, end the wave loudly; never interrupt a live subagent.

**Detection after the unit already merged.** The build subagent merges inside its own graft flow, so a tampering subagent may have merged before the orchestrator's verify runs — detection at this grain is on return, and a merge cannot be retroactively undone. Honesty over fiction: the ledger outcome is still `parked` with the tamper cause per the ticket's acceptance wording (`parked` is the run's "needs human attention" state, and a merged-but-tampering unit is exactly that), and the park comment states *both* facts — the tampered paths *and* that git ground truth shows the PR merged — so the human's first move (audit/revert the merge) is named, not discovered. The merge floor itself was not weakened (it never reads the bracketed members); what merged passed AC + CI + review + (L4) holdout — the tamper is to orchestrator state, and the residual "tamperer merges before detection" window is inherent to per-dispatch grain, accepted at this rung (the graft-internal-grain follow-up shrinks it).
**Chosen:** ledger `parked` + tamper cause even when ground truth shows merged; the park comment names the merged PR explicitly for human audit.

**Verify exit 2 (CLI error — substrate-tainting parity with tamper).** Exit 2 means verification could not run (bad invocation, unreadable member, `sha256sum` unavailable, thrown error) — the evidence is *unverified*, which must never be treated as *verified*. And exit 2 is not merely an infra accident: a same-uid subagent can *force* it (tamper one member, make another unreadable — the thrown read discards any diffs already found), converting a would-be exit 1 into exit 2 on demand. So exit 2's substrate handling has **parity with exit 1**: the unit parks with cause `integrity-digest verification unavailable — <stderr first line>` (bucket `parked` — the build may be entirely fine; `errored` would misattribute a dispatcher-side failure), the unit's run-dir evidence is **not consumed** (same do-not-consume rule as tamper — no corrective/constraints state read from disk for later re-dispatch decisions this run), and the **parallel executor halts new dispatches and drains in-flight units to terminal exactly as on tamper** — an unverifiable substrate is as untrustworthy for scheduling as a tampered one. The distinctions that remain: no `integrity_tampered` array entry (no paths were *shown* tampered — the run summary surfaces the verification outage in prose, flagging that it may be tamper-masking), and the park cause names unavailability, not tamper.
**Chosen:** exit 2 → park the unit with a verification-unavailable cause, do not consume its evidence, and (parallel) halt-and-drain with exit-1 parity; never proceed-as-verified, never silently downgrade a maskable failure.

**Lost custody (compaction ate the manifest).** If, at a verify point, the orchestrator no longer holds a usable baseline (context compaction, or a resume-from-ledger orchestrator that never had one), verification is impossible for the elapsed window. This is the accepted residual the ticket names — verify-immediately keeps it small, and this rung does not park the world for it: the orchestrator notes the custody gap loudly (run summary + an explicit note on any outcome recorded from that window), takes a fresh snapshot to restart the chain, and continues. Alternative rejected: treating a lost manifest as tamper — parks every resumed run and punishes compaction, which the ticket explicitly accepts as residual at this rung.
**Chosen:** lost baseline → surface the custody gap loudly, re-snapshot to restart the chain, continue; never silently pretend continuity, never park for the accepted residual.

**Anti-pattern:** writing the manifest to a temp file "for convenience" between snapshot and verify. Why: any on-disk copy is readable and replaceable by the same-uid subagent — it converts custody back into the forgeable artifact custody exists to replace. `--manifest -` (stdin) exists precisely so this is never needed.

**Anti-pattern:** re-baselining first and verifying after (or skipping the verify "because I just wrote it myself"). Why: the re-snapshot absorbs whatever is on disk — including tampering that landed since the last observation — into the trusted baseline.

**Failure modes:**

- **The failure:** context compaction quietly corrupts (rather than drops) the held manifest JSON. **How you'd know:** `verify` exit 2 (invalid JSON / no members) — the fail-loud path, never a false `digest-verified`. **What it means:** proceed via the verification-unavailable park; frequency of these parks is the signal to prioritise the finer-grain follow-up.
- **The failure:** a legitimate orchestrator write path to a byte-exact member exists that this spec's roster missed, so the parallel executor false-positives. **How you'd know:** a tamper park whose named path traces to the orchestrator's own transcript actions. **What it means:** narrow — add the missed write site to the verify→write→post-write-check→re-snapshot→intended-content-check bracket; the write-authority roster (ledger/corrective/events all orchestrator-only) says there are none today.

### Prose shape and placement (the actual edits)

- **Gateway** (`plugin/skills/faff/SKILL.md`, concurrency contract section): add obligation 5 (~1 short paragraph + the fixed park causes), update the obligation-count phrasing. Written forward, no ticket-ID citations in the prose (per the `faff lint-refs` direction).
- **Sequential** (`SKILL.md`, currently 47 lines): one short bracket paragraph in the step 2/3 flow (snapshot before dispatch, verify before reconcile, refer back to obligation 5 for member set / custody / outcomes), update its contract recap's obligation count.
- **Parallel** (`SKILL.md`, currently 86 lines): one custody-chain subsection (baseline at wave start; verify on return; verify→write→post-write-check→re-snapshot→intended-content-check around own writes; appends exempt; wave halt on tamper; refer back to obligation 5), update its Rules obligation count.
- All three stay lean/deduplicated/skimmable per `docs/skill-authoring.md`; both executors remain far under the 600-line cap; the shared procedure appears **once** (gateway) so the duplicated-block lint cannot fire.

### Test coverage (mechanical vs model-compliance, honestly)

The executors are prose skills — the bracket's runtime behaviour (when the orchestrator snapshots, verifies, re-baselines, parks) is **model-compliance**, exercised by beep-boop runs, not unit-testable. What CAN be tested mechanically, and is in scope:

- `plugin/skills/faff/test/integrity-digest.test.mjs` (runCli subprocess seam, existing conventions): add the executor-shaped round-trips if not already covered — run-grain snapshot (no `--issue`) with `--events` yields exactly the three members; `verify --manifest -` consumes the manifest via stdin (the custody path the executors use); a mid-window `events.jsonl` append + ledger edit verifies as tampered naming only `run-ledger.json`; snapshot→own-write→re-snapshot→verify round-trips clean (the re-baseline mechanic's CLI-level truth); the intended-content seam — the new snapshot's recorded member `sha256` equals an independently computed `/usr/bin/sha256sum` of the written bytes (the in-context comparison's CLI-level truth); and the exit-2 seam that pins the tamper-masking finding — a corrupted/garbled manifest → exit 2, and an unreadable member (`chmod 000`) → exit 2, both asserting exit 2 (never 0) so the executors' parity handling has a pinned CLI truth to stand on.
- `faff validate-adapters` (existing CI gate) passes over all three edited `SKILL.md`s — line caps, no duplicated block.

**Chosen:** mechanical coverage = CLI-level bracket round-trips in the existing test file + the existing adapter lint; orchestration behaviour is documented as model-compliance per the repo's convention, not faked with untestable assertions.

## Scenarios

```
Given a sequential or parallel executor mid-run with a held run-grain baseline
When a build subagent modifies run-ledger.json, a corrective/ file, or truncates events.jsonl during its dispatch
Then verify on return exits 1 naming those paths, the issue's ledger outcome is `parked`
     with cause `integrity-digest tampered — <paths>`, and no run-dir evidence from that
     unit informs any later decision this run
```

```
Given a clean build subagent dispatch
When it returns and verify exits 0
Then the flow from token reconciliation onward is byte-for-byte today's behaviour —
     the only delta in the whole round-trip is the two CLI calls
```

```
Given the parallel executor with dispatch A in flight
When the orchestrator records sibling B's terminal outcome to run-ledger.json
     (verify → write → post-write check → re-snapshot → intended-content check) and the poll loop appends a sentry-checkpoint event
Then A's return verifies clean — no false positive from either legitimate orchestrator write
```

```
Given a verify invocation that cannot run (exit 2 — e.g. an unreadable member or sha256sum unavailable)
When the subagent's evidence would next be consumed
Then the unit parks with a verification-unavailable cause, its run-dir evidence is not
     consumed, and (parallel) no new dispatches launch — exit 2 has substrate parity
     with tamper; there is no path from exit 2 to normal outcome recording
```

- The manifest is never written to disk at any point in either executor's flow (custody assertion).
- The merge floor's conditions are unchanged in count and content (detection-only assertion).

## Design Decision Rationale

All decisions are marked inline in WHAT/HOW above; collected: (1) bracket prose home — gateway obligation 5, executors refer back (dedup rule + contract-inheritance for third-party occupants); (2) always `--events`, never `--issue` — deterministic run-grain set per the upstream interim-scope decision; (3) sequential — disjoint per-dispatch brackets, zero re-baselining (foreground blocking means no orchestrator writes inside a bracket); (4) parallel — one continuous custody chain per wave (per-dispatch brackets false-positive on shared substrate); (5) verify→write→post-write-check→re-snapshot→intended-content-check ordering (re-baselining first would launder tamper; the post-write CLI verify of the old baseline — expecting exactly the just-written members — catches untouched-member drift without false-positiving on event appends; the in-context intended-content hash comparison catches a rewrite of the touched member itself); (6) tamper-park mechanics — standard park + `integrity_tampered` ledger array on the `review_outage_pending` precedent; (7) wave response — halt new dispatches, drain in-flight, never interrupt live subagents; (8) post-merge detection — `parked` + both facts in the comment, honesty over fiction; (9) exit 2 — verification-unavailable park with substrate parity to tamper (forcible by a subagent, so never handled more leniently); (10) lost custody — loud gap + restart chain, the ticket's accepted residual; (11) tests — CLI round-trips mechanical, orchestration is model-compliance. Rejected alternatives are recorded beside each marker so the builder does not re-propose them.

## Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** the FAFF-519 ruling (its ADR and gateway write-authority paragraph) lands before or with this ticket's build. FAFF-520 is `blockedBy` FAFF-519 in the tracker, so the build is already sequenced after it. Validation instruction for the build agent: before starting, confirm the FAFF-519 ADR/gateway paragraph exists in the repo and still says (a) `events.jsonl` is prefix-preserving across a dispatch bracket, (b) the FAFF-520 bracket set is run-grain only (`correctiveIntegrityDirs(runDir)` + `--events`), (c) run-grain members have zero legitimate lane writers. This spec is consistent with those decisions as approved 2026-07-17; if any shifted at landing, the delta is a trivial re-check (member set and the re-baseline roster), not a redesign.

## DONE — Definition of Done

### From WHY (principles)
- [ ] No step in either executor writes the manifest to disk; every verify uses `--manifest -` (stdin) or an inline JSON argument
- [ ] The new prose surfaces the verdict as `digest-verified` only — no mention of `FAFF_INTEGRITY_BOUNDARY`, `integrityGate`, or mount-asserted trust in any of the three edited files
- [ ] The merge floor text (gateway obligation 4 and both executors' merge-gate prose) is character-identical before/after this change

### From WHAT
- [ ] Gateway concurrency contract carries a new obligation 5 defining the bracket (member set = `correctiveIntegrityDirs(runDir)` + `--events`; custody rule; verify-immediately; exit-1/exit-2 outcomes; trust class); obligations 1–4 unrenumbered; every obligation-count recap updated to five
- [ ] Both executor `SKILL.md`s refer back to obligation 5 and carry only their own placement/mechanics prose (no copied shared procedure)
- [ ] Every snapshot/verify call in the new prose passes `--events` and omits `--issue`

### From HOW (sequential)
- [ ] Snapshot immediately before each unit's dispatch; verify as the first action on return, before reconcile-then-record; no re-baselining anywhere in the sequential flow

### From HOW (parallel)
- [ ] Baseline at wave start; verify on every subagent return before consuming its token; verify→write→post-write-check→re-snapshot→intended-content-check around every orchestrator own-write to `run-ledger.json`/`corrective/` (post-write CLI verify of the old baseline must name exactly the just-written members — any other member is tamper; the candidate baseline's recorded sha256 for each just-written member must equal the in-context hash of the intended content — a mismatch is tamper); event appends explicitly exempt from re-baselining
- [ ] On tamper: no new dispatches launch; in-flight units drain to terminal via their own verified returns; no live subagent is interrupted

### From HOW (park mechanics)
- [ ] Tamper park: cause `integrity-digest tampered — <paths>`, standard comment + `faff-parked` label, ledger bucket `parked`, issue appended to a top-level `integrity_tampered` ledger array `[{issue, paths}]`
- [ ] Post-merge detection: park comment names both the tampered paths and the merged PR
- [ ] Exit 2: unit parks with a verification-unavailable cause, its evidence is not consumed, and the parallel executor halts new dispatches with exit-1 parity; no `integrity_tampered` entry; no path proceeds as verified
- [ ] Lost baseline: prose directs a loud custody-gap note + fresh snapshot, never a silent continue and never a park

### From HOW (tests)
- [ ] `test/integrity-digest.test.mjs` covers: run-grain `--events` member set is exactly the three members; `verify --manifest -` stdin path; append+edit window names only the edited member; snapshot→write→re-snapshot→verify clean round-trip; the new snapshot's recorded member `sha256` equals an independently computed hash of the written bytes; corrupted manifest → exit 2; unreadable member → exit 2 (skipping any already covered)
- [ ] `faff validate-adapters` passes on all three edited `SKILL.md`s

**Integration smoke test (pseudocode):**

```
tmp run-dir with run-ledger.json + corrective/c1.json + events.jsonl
M = runCli(snapshot --run-dir D --events).stdout          # held "in context" (a variable)
append a line to events.jsonl; edit run-ledger.json        # simulate dispatch window
verify(--manifest - <<< M) → exit 1, tampered == ["run-ledger.json"]   # append clean, edit named
restore ledger; M2 = snapshot; verify(<<< M2) → exit 0 "digest-verified"
H = sha256sum <<< intended-ledger-bytes                    # the in-context intended-content hash
assert JSON.parse(M2).members["run-ledger.json"].sha256 == H   # touched-member launder closed
```

confidence: high
spec-review: approve (after 3 revise iterations — trail below; final pass zero objections)