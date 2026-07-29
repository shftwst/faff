# Teach the digest bracket what the trusted side may do while it is open

> Spec: faffter-dark-nlspec · 2026-07-29 · autonomous · revision 2 (final) · confidence: high. Issue: FAFF-679.

## WHY

The custody bracket exists so that a build subagent cannot alter the run's evidence without the orchestrator noticing before it consumes that evidence. In run `run-20260729-002829-beepboop-full` it fired on the orchestrator itself. The orchestrator wrote park outcomes for other issues into `run-ledger.json` while two builds were in flight; on return, `faff integrity-digest verify` reported `{"verdict":"tampered","tampered":["run-ledger.json"]}`. Both units had already merged cleanly — PR #502 among them — so the run refused the verdict, accepted the merges on git and forge ground truth, and invented a ledger field (`integrity_bracket_inconclusive`, which appears nowhere in the code or the prose) to say so.

The mechanics are exactly as the ticket describes. `buildManifest` in `plugin/skills/faff/bin/lib/integrity-digest.js` walks `correctiveIntegrityDirs(runDir, null, {events:true})` — `corrective/`, `run-ledger.json`, `events.jsonl` — and records `grain: "run"` when `--issue` is omitted. `events.jsonl` gets `{length, prefix_sha256}` and appends are legitimate by construction. `run-ledger.json` gets a whole-file `sha256` and any byte that moves is a diff. Nothing in the tool is wrong.

What is wrong sits one layer up. The gateway's obligation 5 says when to snapshot and when to verify and what to do about each exit code, and says nothing at all about what the trusted side may do in between. `faffter-dark-concurrency-parallel/SKILL.md` fills that silence with a good answer — one continuous run-grain custody chain per wave, and around every orchestrator write the sequence verify → write → post-write check → re-snapshot → intended-content check. `faffter-noon-concurrency-sequential/SKILL.md` fills it with a premise instead: "this executor blocks foreground on exactly one dispatch and writes nothing between snapshot and verify", therefore "disjoint, per-dispatch, with zero re-baselining". ADR-0078 (still `Proposed`, lines 38–39) records that premise as decided. The premise is not true, and the parallel skill's rule was not applied in the run that broke.

Three things falsify it, and they matter for the fix:

- The detached sentry poller (`sentry-poller.js:253`, spawned unref'd at `:319`) loops `faff sentry abort`, which writes the ledger via `mutateLedgerUnderLock`. A second trusted writer in a second process the orchestrator cannot sequence.
- `faff events append --tokens` mutates `budget.tokens_at_last_event` inside the same locked core (`events.js` ~700–740). An orchestrator that thinks it only appended an event has written a bracketed member.
- Under the parallel executor, parks and terminal outcomes for other issues arrive when they arrive. That is the case the run actually hit.

The writer inventory above `mutateLedgerUnderLock` in `heartbeat.js` already retires the single-writer assumption in as many words, and it carries the fact this whole fix has to be built around: **the orchestrator session's own ledger edits are file edits made by the driving session, not CLI subprocess calls, so the CLI-side lock cannot serialise them.**

The cost of leaving this is not one bad verdict. It is that the next operator to see a tamper verdict discounts it, and the detector stops working for the thing it exists for.

## WHAT

Three changes in the contract-and-wiring layer plus one small piece of CLI reporting. No change to how `integrity-digest` compares anything.

**One custody chain per orchestrator, for every occupant, written into the gateway.** The parallel skill's discipline becomes part of obligation 5: a single run-grain baseline held in context, trusted-side writes permitted inside an open bracket only through the fixed sequence, and a verify before every re-baseline so no window goes unobserved. Occupants keep only their placement notes.

**The sequence covers both write classes, not just the CLI one.** A direct session edit of the ledger must be composed from the baseline-verified copy held in context, never from a fresh disk read. This is the case the WHY describes.

**Ledger-mutating CLI commands report the ledger hash they saw before their write and the hash they left after it.** Without it the sequence has a hole for every write whose bytes the orchestrator does not compose (`events append --tokens`, `sentry abort`, `lights-out --resume`, `budget baseline`). `corrective author` gains the same treatment for the file it creates.

**`run-ledger.json` keeps its whole-file byte comparison.** No field scoping, no `--issue` awareness in `snapshot`, no semantic model of the ledger inside the digest tool.

Out of scope: FAFF-568 events-chain anchoring, the mount-asserted integrity boundary (a separate authority), and any change to the merge floor.

## HOW

### The mid-bracket write rule, hoisted

**Chosen:** permit trusted-side writes inside an open bracket under a mandatory re-baseline sequence, defined once in gateway obligation 5 and binding on every occupant including third-party swap-ins.

The re-snapshot question ("does a re-snapshot destroy another dispatch's baseline?") dissolves once the chain is the contract: there are no per-dispatch baselines to destroy. One baseline for the run-grain member set, and every in-flight dispatch is measured against it. A re-baseline shortens nobody's coverage because the sequence verifies immediately before re-baselining. Per-dispatch baselines over a shared mutable member set were never coherent — sibling B's legitimate outcome would read as tampering against A's baseline, which is the observed defect.

The sequence: verify the current baseline (non-zero → the park path, before a re-baseline can launder anything); perform the write; post-write check, a second verify of the *old* baseline requiring the named set to be exactly the members this write touched; snapshot a candidate; content check on the touched members; only a passing candidate replaces the baseline. `events.jsonl` appends need no re-baseline — the prefix rule tolerates them.

**Chosen:** reject "forbid trusted writes inside an open bracket". It cannot be stated truthfully. The detached poller writes from another process on its own schedule; forbidding a write the orchestrator does not make is a rule addressed to nobody. And honouring it under the parallel executor means holding every park until the wave drains, which serialises the wave and defeats the executor.

### Why `run-ledger.json` keeps its whole-file hash

**Chosen:** reject field-scoped comparison.

The appeal is symmetry with `events.jsonl`, and the symmetry is false. The events carve-out exempts bytes that *did not exist* at snapshot time. A field carve-out exempts live, already-existing state — `outcomes` for other issues, `budget`, `stop_reason` — which is the state a laundering subagent most wants to edit, and which obligation 5 names as the scheduling state being protected. It would also give the digest tool a semantic model of attacker-influenced JSON where a byte comparison needs none. The chain gets the same tolerance with no comparison weakened.

### Closing the window — both write classes

There are two, and they need different mechanics.

**Class A — CLI-mediated writes** (`events append --tokens`, `sentry abort`, `lights-out --resume`, `budget baseline`). **Chosen:** `mutateLedgerUnderLock` returns the pre-write and post-write ledger digests, and every ledger-mutating command surfaces them (a `--json` field pair, a stderr note otherwise); `corrective author` adds the `sha256` of the file it wrote.

`atomicWriteLedger` serialises a ledger derived from a fresh under-lock read the orchestrator never sees, so "the bytes I intended" is undefined here. The before-hash makes the check possible in a stronger form: instead of asserting what the file became, the orchestrator asserts what the file *was* when the trusted writer took the lock. A subagent edit at any point since the last observation makes the reported before-hash differ from the held baseline, and it is tamper. The after-hash becomes the new baseline entry.

**Class B — the orchestrator's own direct session edit** (`admitted` appends, outcome writes, the run mint). This is not a CLI call, so `mutateLedgerUnderLock` never sees it and the before-hash does not exist for it. It is also the class that produced the observed failure, so a fix that does not cover it under-delivers on its headline property at exactly the case in the WHY.

An after-only check — append a `ledger-write` note and compare its CLI-computed `ledger_sha256` against a hash of the intended bytes — is not enough. If a build subagent edits `run-ledger.json` between the step-1 verify and the moment the orchestrator reads the file to compose its edit, the tampered bytes are absorbed into "intended", the content check passes on them, and the candidate baseline blesses them — and the whole-file overwrite destroys the evidence. The parallel skill's "never re-reading the file" constrains the hashing step, not composition, and nothing required composition to come from anywhere in particular. Read-then-Edit on a large JSON file is the natural agent shape, so this is not a hypothetical.

**Chosen:** obligation 5 states that a direct ledger edit is composed from the baseline-verified copy the orchestrator holds in context, never from a fresh disk read. Equivalently, where an in-context copy is impractical, the orchestrator hashes the file immediately before composing and requires it to equal the held baseline entry — the same assertion, paid for with an extra hash. Either way the window between the step-1 verify and the write carries no unobserved read. This is a one-sentence addition to the obligation and a DONE criterion; it costs nothing and it is the difference between the property holding and merely appearing to.

**Assumes:** the `faff` binary the orchestrator invokes is the trusted one. Not new — obligation 5 already stands or falls on `faff integrity-digest`'s own stdout.

**Chosen:** no carve-out for a detached `sentry abort` landing mid-bracket. The abort changes the ledger, the next verify says tampered, the in-flight unit parks with its evidence unconsumed — which is the correct end state, since a sentry abort is ending the run. The only cost is a park cause naming tamper when the cause was an abort, and the fix for that is honest prose: the park note names both the tampered path and any abort mark found. A carve-out would be forgeable (a lane can write an abort mark) for no detection gain.

### Whether a verdict should say who changed it

**Chosen:** the verdict stays binary. No attribution field, no manifest change.

Any attribution the tool could compute would come from something on disk, and everything on disk is inside the untrusted lane's reach at the same uid — including the `ledger-write` event's `ledger_sha256`, which lives in the deliberately-mutable tail of `events.jsonl` that the prefix rule exempts by design. A lane can write a ledger edit and append a matching note, and the tool would have no basis to call one trusted. Shipping that as a verdict field would be an attestation the mechanism cannot back.

Attribution belongs to the only party who can perform it: the trusted orchestrator, comparing against values it holds in context. So the answer to the ticket's second question is yes, the distinction matters, and no, it is not a verdict field.

### Where the edits land

- `plugin/skills/faff/SKILL.md` — obligation 5 gains the mid-bracket write rule, the one-chain-per-orchestrator statement, and the Class-B composition requirement.
- `faffter-noon-concurrency-sequential/SKILL.md` — the false premise goes; placement becomes one chain, one dispatch open at a time, same sequence when a write lands.
- `faffter-dark-concurrency-parallel/SKILL.md` — shared procedure moves up; wave-scoped placement stays with a reference back.
- `heartbeat.js` — `mutateLedgerUnderLock` returns the digest pair; `atomicWriteLedger` already computes the post-write hash for its events fold, so only the before-read is new.
- `events.js`, `sentry.js`, `lights-out.js`, `budget.js`, `corrective.js` — surface the pair per command. The `heartbeat.js` writer inventory is the one roster; do not start a second.
- `docs/guide/cli.md` — affected rows, gated by `lint-cli-doc`.
- `docs/adr/0078-*.md` — amend in place (still `Proposed`; the recorded decision is unchanged, only the sequential clause at lines 38–39 is falsified).

**Punt:** keep re-baselining `run-ledger.json` on every trusted write, or make ledger mutations append-only-journalled so the member becomes prefix-preserving and never needs re-baselining — needs human *(decides: architecture)*. The chain gives "no unobserved window", not "frozen for the dispatch", and those are different strengths. A journalled ledger restores the stronger one, but changes the on-disk shape, every reader (`runcheck`, `audit`, `disposition`, `economics`, `quality`) and the FAFF-575 core. **Does not block the build.**

## DONE

`node --test test/` and `faff validate-adapters` green throughout.

CLI mechanics, in `test/integrity-digest.test.mjs` (existing `runCli` seam) or a sibling `test/faff-679-bracket-writes.test.mjs`:

1. The ticket's repro, inverted: run-grain snapshot with `--events`, an orchestrator ledger write plus its `ledger-write` note, post-write verify against the old baseline names **exactly** `run-ledger.json`, re-snapshot, verify against the new baseline exits 0.
2. Detection preserved: same window, but a second member also changes (a file added under `corrective/`, or an `events.jsonl` prefix rewrite) → the named set is no longer exactly the touched members → exit-1 path.
3. The candidate baseline's `sha256` for `run-ledger.json` equals the `ledger_sha256` printed by `faff events append`, asserted against an independent `node:crypto` digest so the oracle is independent of the CLI's hasher.
4. `mutateLedgerUnderLock` reports a before-hash equal to the pre-write bytes and an after-hash equal to the post-write bytes; an out-of-band edit landing between the baseline and the CLI write makes the reported before-hash differ from the held baseline entry.
5. `corrective author --json` carries the `sha256` of the file at the `path` it reports.
6. **Class B is covered.** Snapshot; simulate a subagent edit to `run-ledger.json`; have the orchestrator path compose its edit from the held in-context copy (or hash-before-compose) and write. Assert the sequence lands on the exit-1 path rather than absorbing the tampered bytes into the candidate baseline. A companion negative case — composing from a fresh disk read — must show the laundering this criterion exists to prevent, so the test proves the requirement is doing work.

Selftests: `faff heartbeat --selftest` and `faff events --selftest` cover the digest pair; `faff integrity-digest --selftest` unchanged and passing on Linux **and** macOS (do not reintroduce a `validate-macos` exclusion).

Prose, as node tests reading the `SKILL.md` files (the real precedents are `test/merge-gate.test.mjs` — which `readFileSync`s `faff-graft/SKILL.md` and `faffter-noon-ship/SKILL.md` — and `test/validate-adapters-prose-defaults.test.mjs`).

7. Gateway obligation 5 states the mid-bracket write rule, the one-chain-per-orchestrator requirement, **and the Class-B composition requirement**.
8. `faffter-noon-concurrency-sequential/SKILL.md` no longer asserts it writes nothing between snapshot and verify, and no longer claims zero re-baselining.
9. Both executors reference obligation 5 and carry only placement prose; `validate-adapters` reports no duplicated block and no dangling reference.
10. `faff lint-cli-doc` clean after the `docs/guide/cli.md` change, and ADR-0078's sequential clause amended.

Not checkable by a test, so stated plainly in the ADR amendment: the chain gives "no unobserved window on a bracketed member", not "the member is frozen for the dispatch".

## Open questions

- **Punt:** re-baselining versus an append-only journalled ledger — needs human *(decides: architecture)*. Does not block the build.
- **Assumes:** the `faff` binary the orchestrator invokes is the trusted one.

confidence: high
