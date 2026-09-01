# Spec — FAFF-958: `faff events anchor` must refuse a drifted run-ledger fold instead of snapshotting it

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-958.
> build-tier: standard

This spec addresses FAFF-958 for the build agent and human reviewers. It specifies a guard on the per-issue `faff events anchor` command so it can no longer copy an already-broken run-ledger fold into a committable merge-floor anchor. The whole change lives in one file (`plugin/skills/faff/bin/lib/events.js`) plus tests, and it mirrors a precondition the sibling `anchor-run` command already enforces.

## 1. WHY — Problem and Principles

**The load-bearing model.** A run anchor is a tamper-evident snapshot. Its integrity rests on a "ledger fold": the last chained `ledger-write` event records `data.ledger_sha256` = SHA-256 of the run-ledger.json bytes as they stood at that write. `governance-check` re-hashes the anchored `run-ledger.json` and FAILs if it disagrees with that recorded hash — "ledger fold mismatch (unrecorded ledger rewrite)". An anchor is only trustworthy if it is minted from a ledger whose on-disk bytes still match the last chained ledger-write. Anchoring a drifted ledger bakes a guaranteed governance-check failure into a committed artifact.

**Problem statement.** Today `faff events anchor --run-dir <run> --issue <ISSUE> --dest <dir>` byte-copies `run-ledger.json` and `events.jsonl` verbatim with no fold check, so when the live ledger has drifted from its last chained `ledger-write` (an unrecorded rewrite) the per-issue anchor snapshots the broken fold and every later `governance-check` on it FAILs. This change adds the same drift guard the sibling `anchor-run` command already runs, so a per-issue anchor refuses loudly rather than shipping a broken merge-floor artifact.

**Design principles.**

- **Preserve tamper-evidence — never heal silently.** An unrecorded ledger rewrite is exactly the tamper signature the integrity leg exists to surface. The guard must *refuse and name the fix*, not auto-mint a `ledger-write` that blesses whatever bytes are currently on disk. Auto-healing inside an anchoring command would convert a genuine tamper signal into a silent side-effect write, defeating the property the anchor exists to provide. `anchor-run` already chose refusal for this reason; the per-issue path matches it.
- **`events anchor` stays a pure read-snapshot.** The command reads a run dir and writes an immutable copy; it must not mutate the source run dir (no ledger write, no event append) as a side effect of anchoring.
- **Reuse the one detector, never fork the comparison.** The hash-match core (`eventsLedgerFold`) is shared by `verify` and `anchor-run`. The new guard composes it, never a second hand-rolled comparison.
- **Do not over-guard the pre-run-close case.** A per-issue Step-9b anchor legitimately runs before the run has reached its run-close choke-point, so a run dir may carry *no* `ledger-write` event yet. The guard must refuse only on a genuine fold *mismatch*, never on the mere *absence* of a ledger-write — otherwise it breaks the normal Step-9b anchor path.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` `anchor` handler (~L1083) | Node.js | The command being guarded; calls `mintIssueAnchor` with no fold check today |
| `plugin/skills/faff/bin/lib/events.js` `anchor-run` handler (~L1124) | Node.js | The sibling whose precondition (~L1147–1158) this mirrors |
| `plugin/skills/faff/bin/lib/events.js` `eventsLedgerFold` (~L661) | Node.js | The shared drift detector reused verbatim |
| `plugin/skills/faff/bin/lib/events.js` `mintIssueAnchor` (~L1244) | Node.js | The byte-copy that must not run on a drifted ledger |
| `plugin/skills/faff/bin/lib/governance-check.js` `integrityLegForChain` (~L170) | Node.js | Where the fold mismatch becomes a gating FAIL — the downstream failure this prevents |

**Scope statement.** A single defensive precondition added to one CLI subcommand handler in the governance region, closing a guard gap between two sibling anchor commands.

## 2. OUT OF SCOPE

- **Auto-healing / re-syncing the ledger inside `events anchor`** — Why excluded: violates the tamper-evidence and pure-read-snapshot principles above; the re-sync is a deliberate, separately-logged action. Extension point: the operator/orchestrator runs the documented workaround (`faff events append` with a `ledger-write` note, `events.js` ~L975) *before* re-running `events anchor`.
- **Changing `anchor-run`'s existing precondition** — Why excluded: it already guards correctly (presence assertion + fold). Extension point: none; leave it untouched.
- **Changing `governance-check`'s integrity leg or the fold definition** — Why excluded: the leg is behaving correctly; the bug is that a broken fold reaches it. Extension point: `governance-check.js`.
- **Root-causing *why* ledgers drift without a chained ledger-write** — Why excluded: related but separate (see FAFF-679 integrity-digest bracketing). This ticket stops a drifted fold from being anchored; it does not eliminate all sources of drift. Extension point: FAFF-679.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Ledger fold | The invariant that the last chained `ledger-write` event's `data.ledger_sha256` equals SHA-256 of the current on-disk `run-ledger.json` bytes |
| Fold drift / mismatch | The fold is broken: a ledger-write exists but its recorded hash disagrees with the on-disk ledger (an unrecorded rewrite) |
| Per-issue anchor | The artifact `faff events anchor --issue <ISSUE>` mints for one issue's merge floor (via `mintIssueAnchor`) |

**The detector reused (existing, unchanged).**

```
eventsLedgerFold(dir, records, base) -> null | { status, ledger_fold, detail }
  # null      -> no ledger-write present, OR present and hash MATCHES (base.ledger_fold set to "match")
  # {status:"broken",   ledger_fold:"mismatch", detail} -> a ledger-write exists but its hash != on-disk ledger
  # {status:"malformed", detail}                        -> run-ledger.json present but unreadable
```

**Behavioural contract added to the `anchor` handler.** Between `--issue` shape validation and the `mintIssueAnchor` call, run a fold precondition. On a mismatch (or unreadable ledger) it writes a loud stderr line naming the fix and returns a non-zero exit *without* minting; otherwise the existing mint path runs unchanged.

**Design decision — refuse vs. heal.** Option (a) detect-and-refuse-loudly vs. option (b) auto-chain-a-ledger-write-then-snapshot.
**Chosen:** Option (a) — detect the drift and refuse loudly, naming the fix. Rationale: it preserves tamper-evidence (an unrecorded rewrite must be surfaced and explicitly re-synced, not silently blessed), keeps `events anchor` a side-effect-free read-snapshot, and mirrors the sibling `anchor-run` precondition, which already refuses rather than heals. Option (b) would make an anchoring command mutate its own source and paper over the exact signal the fold exists to raise.

**Design decision — which half of anchor-run's precondition to port.** `anchor-run` refuses on *both* the absence of any `ledger-write` (presence assertion) *and* a fold mismatch.
**Chosen:** Port only the fold-*mismatch* half (reuse `eventsLedgerFold`); do **not** port the presence assertion. Rationale: `anchor-run` runs at run-close, where a `ledger-write` must exist, so its presence assertion is correct *there*. A per-issue `events anchor` runs at Step-9b, which can legitimately precede any chained `ledger-write`; requiring presence would refuse healthy anchors. `eventsLedgerFold` already returns `null` (no refusal) when no ledger-write is present, which is exactly the desired behaviour for this path.

**Design decision — exit code.** `events anchor` today returns 0 (ok), 2 (usage / bad dir / bad `--issue`), 3 (no events).
**Chosen:** A fold-mismatch refusal returns exit **1** (precondition failed), matching `anchor-run`'s fold-refusal exit and distinct from usage (2) and no-events (3). An unreadable-ledger `malformed` result is also a refusal — return exit 1 with the malformed detail (mirroring `anchor-run`, which returns 1 on any truthy `fold`). Rationale: reuses the established precondition-failure code so callers already handling `anchor-run`'s exit 1 need no new branch.

## 4. HOW — Behaviour

**Architecture and approach.** Add a precondition block to the `if (cmd === "anchor")` handler in `events.js`, immediately after the `--issue` shape check (~L1103) and before `const result = mintIssueAnchor(...)` (~L1104). It reads and parses `events.jsonl` into records the same way `anchor-run` does (`splitPhysicalLines` + per-line `JSON.parse`, tolerating malformed lines — the full chain-integrity classification is `mintIssueAnchor`/`governance-check`'s job, not this presence check), then calls `eventsLedgerFold(dirArg, records, {})`. A truthy return is a refusal.

**Pseudocode (the precondition, inserted before the mint):**

```
# after: --issue shape validated (existing, ~L1101-1103)

READ eventsBuf from <dirArg>/events.jsonl
  IF unreadable:
    # no events to anchor at all — let the existing mint path own this outcome
    # (mintIssueAnchor already returns code "no-events" -> exit 3). Do NOT pre-empt it here.
    fall through to mintIssueAnchor (unchanged)

records := []
FOR each physical line in eventsBuf:
    TRY records.push(JSON.parse(line)) CATCH: skip   # malformed lines are the verifier's job

fold := eventsLedgerFold(dirArg, records, {})
IF fold is truthy:                                   # mismatch or unreadable ledger
    stderr("faff events anchor: precondition failed — " + fold.detail +
           "; append a ledger-write to re-sync the ledger fold before anchoring "
           "(echo '{\"phase\":\"run\",\"type\":\"ledger-write\"}' | faff events append --run <run>), then re-run")
    RETURN 1

# fold clean (match) or no ledger-write present -> proceed unchanged
result := mintIssueAnchor(dirArg, issueArg, destArg)
... (existing mint + logging path, unchanged)
```

**Edge cases.**

- **No `ledger-write` event yet (normal pre-run-close Step-9b):** `eventsLedgerFold` returns `null` → no refusal → anchor mints as today. This is the healthy path and must stay green.
- **Ledger-write present, hash matches:** `null` → mints as today.
- **Ledger-write present, hash mismatches (the bug):** truthy `{ledger_fold:"mismatch"}` → exit 1, nothing minted, dest untouched, fix named on stderr.
- **`run-ledger.json` unreadable:** `eventsLedgerFold` returns `{status:"malformed"}` → exit 1, fix/detail on stderr. (Consistent with `anchor-run`, which returns 1 on any truthy fold.)
- **`events.jsonl` missing:** guard falls through; `mintIssueAnchor` returns `no-events` → the existing exit 3, unchanged.
- **Idempotent re-run after the operator appends a ledger-write:** the fold now matches → the same command succeeds (exit 0). This is the documented recovery loop.
- **No partial dest on refusal:** the guard runs *before* `mintIssueAnchor` (which is what creates `dest`), so a refusal never creates or partially fills the dest dir.

## 5. Scenarios — main objectives

**Scenario: a drifted per-issue anchor is refused, not minted.**
Given a run dir whose `events.jsonl` carries a `ledger-write` recording hash `H_old` and whose `run-ledger.json` has since been rewritten to hash `H_new ≠ H_old`,
When `faff events anchor --run-dir <run> --issue FAFF-X --dest <dest>` runs,
Then it exits 1, writes nothing to `<dest>` (the dir is not created), and stderr contains "ledger fold mismatch" and the ledger-write re-sync instruction. [HOLDOUT]

**Scenario: re-sync then anchor succeeds.**
Given the same drifted run dir,
When the operator appends a `ledger-write` note (`faff events append` with `{type:"ledger-write"}`, which self-computes the hash from on-disk bytes) and re-runs `faff events anchor`,
Then the command exits 0 and mints the anchor, and `faff governance-check --anchor-dir <dest>` reports integrity pass.

**Scenario: a healthy run with no chained ledger-write still anchors.**
Given a run dir whose `events.jsonl` has *no* `ledger-write` event,
When `faff events anchor` runs,
Then it exits 0 and mints the anchor exactly as before this change (the presence-absence case is not a refusal).

**Scenario: a healthy matching fold still anchors.**
Given a run dir whose last `ledger-write` hash equals the on-disk `run-ledger.json` hash,
When `faff events anchor` runs,
Then it exits 0 and mints as before.

## 6. Design Decision Rationale

- **Chosen:** Detect-and-refuse (option a) over auto-heal (option b) — preserves tamper-evidence, keeps the command side-effect-free, matches `anchor-run`.
- **Chosen:** Reuse `eventsLedgerFold` — one home for the hash-match rule; the guard is a composition, not a fork.
- **Chosen:** Port only the fold-mismatch half of `anchor-run`'s precondition, not the presence assertion — the per-issue path legitimately precedes any chained ledger-write.
- **Chosen:** Exit 1 on refusal (with the malformed-ledger case also exit 1) — reuses the established precondition-failure code, no new caller branch.
- **Chosen:** Guard placed before `mintIssueAnchor` — guarantees no partial/committed dest on refusal.

## 7. Open Questions and Assumptions

**Open Questions:** none. The refuse-vs-heal question the ticket posed is resolved to (a) refuse, on the tamper-evidence principle and the `anchor-run` precedent.

**Assumptions:**

- **Assumes:** `eventsLedgerFold` and `splitPhysicalLines` remain exported/accessible within `events.js` and keep their current signatures. Validation: both are defined in `events.js` (~L661, ~L562) and already called by the `anchor-run` handler in the same file — the new guard sits in the same module scope, so no new import is needed. Confirm by reading the `anchor-run` handler before editing.
- **Assumes:** `mintIssueAnchor` is the sole path that creates `dest` for `events anchor` (so running the guard before it guarantees no dest side-effect on refusal). Validation: `mintIssueAnchor` calls `fs.mkdirSync(destDir, {recursive:true})` (~L1248); the `anchor` handler does not create `dest` itself. Confirm by reading the handler.

## 8. DONE — Definition of Done

- `faff events anchor` on a run dir with a `ledger-write`/on-disk-ledger hash mismatch exits **1**, mints nothing, and does not create the `--dest` directory.
- The refusal stderr line contains the substring `ledger fold mismatch` (from `eventsLedgerFold`'s `detail`) and an instruction to append a `ledger-write` to re-sync before re-running.
- `faff events anchor` on a run dir with **no** `ledger-write` event still exits 0 and mints the anchor (the presence-absence case is not refused).
- `faff events anchor` on a run dir whose last `ledger-write` hash **matches** the on-disk ledger still exits 0 and mints as before.
- An unreadable `run-ledger.json` (with a `ledger-write` present) yields exit 1 with the `malformed` detail on stderr, minting nothing.
- After appending a `ledger-write` note to a previously-drifted run dir, re-running `faff events anchor` exits 0 and the resulting anchor passes `faff governance-check --anchor-dir <dest>` integrity.
- The guard composes the existing `eventsLedgerFold` (no new hash-comparison code path is introduced).
- New coverage is added to the in-code `eventsSelftest()` battery in `events.js` — the same home as the sibling `anchor-run` drift test (~L1676–1691) and the existing `anchor` round-trip block (~L1562–1619, which today has no drift case). Cases: mismatch → non-zero exit + no dest minted + `fold.detail` message; no-`ledger-write` → mint ok; matching fold → mint ok; post-resync re-run → mint ok. A black-box CLI case may additionally be added to `test/events.test.mjs` via the existing `execFileSync("node", [CLI, ...])` helper, but the selftest battery is the primary home (it is what `regions selftest --region governance` exercises).
- `node plugin/skills/faff/bin/faff events --selftest` passes; `node plugin/skills/faff/bin/faff regions selftest --region governance` stays green; `node --test test/events*.test.mjs` passes; existing `anchor-run` and `governance-check` tests/selftests are unaffected.

## Already shipped against this surface

Related Done work on the anchor/ledger-fold surface, none of which delivers the per-issue `events anchor` guard (premise holds — proceed):

- **FAFF-796** (Done) — built the run-level `anchor-run` emitter and its precondition (presence assertion + `eventsLedgerFold` refusal). This is the *precedent this fix mirrors*, not a delivery of it: `anchor-run` guards; per-issue `events anchor` still does not.
- **FAFF-568** (Done) — added the events.jsonl chain anchor + verify in governance-check (the integrity leg that FAILs on the drifted fold). It defines the failure; it does not prevent the drifted fold reaching it.
- **FAFF-621** (Done) — shared prev-hash chaining; the `eventsLedgerFold`/`verifyChain` composition this fix reuses.
- **FAFF-679** (Done) — integrity-digest bracketing false-positive; adjacent (ledger writes vs. a bracket window), a different mechanism, explicitly out of scope here.

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes. One defensive precondition in a single handler plus its selftest cases — a single 1–3 day unit. The guard and its tests are one always-ships-together concern, so no split; no independent second concern to peel off.
- **Workstream fit?** Yes. Sits squarely in the tamper-evident-anchor / governance-integrity workstream (FAFF-568/621/796) and closes a named guard gap in it. Outcome-cohesive.
- **Deps surfaced?** No hidden dep. Everything it mirrors or reuses (`anchor-run`'s precondition, `eventsLedgerFold`) already shipped in FAFF-796 (Done), so it is unblocked; related-to links (FAFF-679/796/930) are already recorded.
- **Risk profile?** Low. No novel integration, no external dependency — an internal guard composing an existing helper with a direct sibling test precedent. No de-risking spike warranted.

No blocking methodology issues.

confidence: high
