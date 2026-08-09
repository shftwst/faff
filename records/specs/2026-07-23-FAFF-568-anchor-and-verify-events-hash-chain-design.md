# FAFF-568 — Anchor and verify the events.jsonl hash chain in governance-check

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-568.

This spec addresses FAFF-568 (a hash chain nobody verifies defends nothing) for the build agent implementing it and human reviewers. It is the **verification half** of `records/rfc/rfc-governance-tamper-evidence.md`: once FAFF-564 writes the chain, this change (1) anchors the chain head into a committed PR artifact the build lane can't silently rewrite, and (2) adds a gating `integrity` leg to `governance-check` (plus a standalone `faff events verify`) that fails a merge on a broken chain. Writing the chain is FAFF-564, not this ticket.

## 1. WHY — Problem and Principles

**The load-bearing model:** a hash chain proves internal consistency only against something the attacker doesn't control. Two things make FAFF-564's chain *enforceable* rather than merely *present*: an **anchor** — the chain head frozen into a committed file that ships inside the PR's git commit, which `merge-gate` already pins by head SHA — and a **verifier** — a new `governance-check` leg that re-hashes the committed chain line-by-line and fails the required check when a link is broken. Anchor makes a post-hoc rewrite collide with published git history behind a required check; the leg is what actually looks.

**Problem statement.** FAFF-564 makes `events.jsonl` self-verifying byte-for-byte, but nothing re-hashes it and its head lives only in gitignored working state, so a rewrite is silent and unchecked. This change commits a per-PR evidence snapshot and adds the leg that re-hashes it, turning "the record is tamper-evident" into "a broken record blocks the merge". It closes step 1's verifier and step 2's anchor of the RFC's five-step sequencing.

**Design principles:**

- **The leg re-reads, it never re-implements.** Every existing `governance-check` leg composes an already-shipped verb's substrate rather than forking its rule (the file's own invariant — completeness reuses `runcheck`'s `auditLedger`, coherence reuses `audit`'s join). The integrity leg composes the new `faff events verify` the same way — the hashing rule has exactly one home.
- **Evidence, never prevention — and never a false alarm.** The claim stays "a broken chain is detectable", never "tampering is impossible" (the RFC threat model: a dishonest writer and a whole-chain rewrite without the anchor are out of scope). Equally, an honest crash (a torn final line) or a legacy schema-1 run must not be reported as tampering — a false FAIL on an unattacked run destroys the signal's credibility.
- **Anchor the evidence, not the live run.** The anchor is an immutable per-PR snapshot of the run's `events.jsonl` + `run-ledger.json` as of PR-open — not the live shared run directory. The live directory's `run-ledger.json` is still accumulating outcomes for later-queued issues mid-run, so pointing the existing completeness / budget / liveness legs at it would false-fail on undispatched work. The snapshot is integrity-verified only; the other legs never run against it.
- **Hash raw bytes, re-split on newlines.** Verification re-derives each link exactly as FAFF-564 wrote it: split the file on newlines, SHA-256 each physical line's raw bytes, compare to the next record's `prev`. No canonicalisation, no JSON re-serialisation — byte-exact and trivial for a foreign implementer.

**Reference context:**

| System | Relevance |
|---|---|
| `records/rfc/rfc-governance-tamper-evidence.md` | The committed design this implements — proposal steps 3 (anchor) and 4 (integrity leg) of its sequencing table |
| `plugin/skills/faff/bin/lib/events.js` | `cmdEvents` dispatches `append`/`validate`/`read`; this change adds the `verify` subcommand — the owning verb the leg composes. After FAFF-564 the file holds the schema-2 chain rules |
| `plugin/skills/faff/bin/lib/governance-check.js` | The five pure `evaluate*Leg` functions + `evaluateRunDir` that composes them; `pass = completeness && budget && merge_floor && liveness` (coherence is report-only). Exit 0/1/2. Where the new gating `integrity` leg is added |
| `plugin/skills/faff/bin/lib/merge-gate.js` | Pins the PR head commit sha (`--match-head-commit`, refuses on drift). This is what makes a committed anchor trustworthy — the head is inside the sha merge-gate observes |
| `.github/actions/governance-check/action.yml` + `.github/workflows/governance.yml` | The composite Action (FAFF-363, Done): discovers carried run dirs from the PR diff under `.faff/runs`, runs the verb, applies the `on-missing` knob. Gains an `anchors-path` input + a `legacy-unverifiable` policy input here |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | FAFF-518's dispatch-window snapshot/verify — a *different* window (prefix-preserving, during-dispatch), composes unchanged; not the post-hoc chain verifier this adds |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js` | Maintains the `.faff/` ignore + committable `!` negation lines; gains the `!.faff/anchors/` carve-out so the anchor subtree is the one committed part of `.faff/` |
| `plugin/skills/faff-graft/SKILL.md` | The build lane that opens the PR — where the anchor snapshot is written + committed onto the feature branch (the emitter side) |

**Scope statement.** This is step 1's verifier and step 2's anchor of the RFC's gap-closure sequencing; it lands after FAFF-564 (which it verifies) and independently of FAFF-562 (the required-check flip), which it composes with but does not block on.

## 2. OUT OF SCOPE

- **Writing the chain (FAFF-564)** — the schema-2 envelope, `prev` minting, and the `ledger-write` fold. Excluded because it is the blocking upstream ticket; this change only *reads and verifies* what it writes. Extension point: none needed here — `events.js` already owns the write path after FAFF-564.
- **General emitter-side run-dir committing (the deferred FAFF-363 slice)** — committing whole run directories as governance artifacts so completeness / budget / liveness verify on the PR. Excluded: that broad slice was explicitly deferred by FAFF-363 and carries the in-flight-ledger problem this spec sidesteps with a purpose-built snapshot. Extension point: the same emitter step in `faff-graft`, widened to carry the full run dir once a per-PR-coherent finalisation exists. This ticket anchors *only* the integrity evidence.
- **Flipping branch protection to required (FAFF-562)** — making `governance-check` a required status check. Excluded: separate one-click human toggle (related, not blocked). The integrity leg is written so it is a no-op on PRs that carry no anchor, so it composes whether or not FAFF-562 has landed. Extension point: FAFF-562's `on-missing` posture choice should anticipate the `legacy-unverifiable` knob this adds.
- **Chaining `declared-effects.jsonl`** — the second append-only ledger. Excluded: FAFF-564's OUT OF SCOPE already carries this deferral; the same per-file mechanism extends there later. Extension point: whatever module owns that file's writes.
- **Per-record writer signatures / cryptographic keys** — the RFC's YAGNI rung; hashes defend byte-integrity, keys would defend writer identity. Not foreclosed.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| chain head | The last physical line of a run's `events.jsonl`, identified by its `seq` and the `prev` of the record that would follow it (equivalently, the SHA-256 of the head line's own bytes) |
| anchor | An immutable, committed per-PR snapshot of a run's chain evidence, written to `.faff/anchors/<run-id>/<issue-id>/` on the feature branch and shipped inside the PR commit |
| integrity leg | A new gating leg of `governance-check` that re-hashes an anchored chain and confirms the ledger fold |
| broken chain | A schema-2 chain where some record's `prev` does not equal the SHA-256 of the physical line above it — the signature of a mid-log edit, reorder, or truncation-plus-splice |
| `legacy-unverifiable` | A schema-1 (pre-chain) log with no `prev` fields — honestly unverifiable, never a broken-chain FAIL |

**The anchor artifact.** Written at PR-open by the build lane, committed onto the feature branch:

```
DIRECTORY .faff/anchors/<run-id>/<issue-id>/
  events.jsonl              # verbatim byte-copy of the run's events.jsonl as of PR-open
  run-ledger.json           # verbatim byte-copy of the run's run-ledger.json as of PR-open
  chain-head.json           # the head witness (below)

RECORD ChainHead (chain-head.json):
  run_id: String            # from the snapshotted ledger / run dir basename
  issue: String             # the issue this PR delivers
  head_seq: Integer         # seq of the last physical parseable record, or null for an empty/torn-only file
  head_sha256: String       # 64 lowercase hex — SHA-256 of the head physical line's raw bytes (the value a
                            # subsequent record's `prev` would carry); the single field an external auditor pins
  line_count: Integer       # physical line count of the snapshotted events.jsonl
  schema_floor: Integer     # the LOWEST per-record schema in the snapshot (1 ⇒ legacy prefix present)
```

The two byte-copies are what the leg re-hashes; `chain-head.json` is the compact witness an external auditor pins without re-reading the whole log. The snapshot is self-consistent by construction at capture time — the ledger copy matches the last `ledger-write` in the events copy the instant it is frozen.

**The verb — `faff events verify`.** New `cmdEvents` subcommand, the owning substrate the leg composes:

```
faff events verify --run-dir <DIR>            # verify the chain in DIR/events.jsonl (+ DIR/run-ledger.json)
  [--legacy-policy pass|warn|fail]            # how to report a schema-1 legacy-unverifiable log (default pass)
  [--json]                                    # machine-readable result
```

- Reads `<DIR>/events.jsonl`, splits on newlines into physical lines, and walks them in order.
- **Genesis:** line 1's `prev` must equal SHA-256 of the UTF-8 bytes of its own `run_id`.
- **Each subsequent record:** its `prev` must equal SHA-256 of the previous physical line's raw bytes (exclusive of the terminating newline) — FAFF-564's exact write-side rule, re-derived.
- **Ledger fold:** SHA-256 the on-disk `<DIR>/run-ledger.json` bytes and confirm it equals the `data.ledger_sha256` of the **last** `ledger-write` event in the chain. Absent (no `ledger-write` and no ledger file) → not a failure; present-but-mismatch → failure (an unrecorded rewrite).
- Exit contract, mirroring the family: **0** verified (or legacy under `pass`/`warn`), **1** broken chain (mismatch), **2** malformed input (unreadable dir, non-JSON line where a record is required, malformed `prev` hex).

**Verify result shape (`--json`):**

```
RECORD VerifyResult:
  status: "verified" | "broken" | "legacy-unverifiable" | "malformed"
  schema_floor: Integer                 # lowest per-record schema seen
  line_count: Integer
  head_sha256: String | null
  first_break: { seq: Integer|null, line: Integer, expected: String, actual: String } | null
                                        # the FIRST record whose prev mismatches — line-numbered for cheap forensics
  ledger_fold: "match" | "mismatch" | "absent"
  torn_tail: Boolean                    # final physical line is a partial (no trailing newline + last record unparseable)
  detail: String
```

**The integrity leg (in `governance-check.js`).** A new pure `evaluateIntegrityLeg(runDir, legacyPolicy)` beside the others, composing the verify verb's logic (shared function, not a re-implementation), returning `{ pass, status, detail, first_break }`. Wired into `evaluateRunDir` and into the gating `pass`:

```
pass = completeness && budget && merge_floor && liveness && integrity
```

It renders in both the text and summary-md tables as a new `| integrity | … |` row, and contributes to `buildReasons` on failure (`<run_id>: integrity — <detail>` naming the first broken line). Coherence stays report-only; integrity is **gating** — a broken chain must fail, per the RFC.

**Action changes (`action.yml` + `governance.yml`).**

- New input `anchors-path` (default `.faff/anchors`): the Action discovers carried anchor dirs from the PR diff under it (mirroring the existing `.faff/runs` discovery), and passes each as an integrity target.
- New input `legacy-policy` (default `pass`): forwarded to the leg; decides how a schema-1 anchor is reported. It is the anchor-side sibling of the existing `on-missing` knob.
- Anchors route to **integrity verification only** — never the completeness / budget / liveness / merge_floor sweep (they are snapshots, not live run dirs). A PR that carries no anchor sees no integrity leg (composes with `on-missing: pass` adoption mode unchanged).

**gitignore carve-out.** `gitignore-ensure` adds a `!.faff/anchors/` negation after the `.faff/` ignore line, so the anchors subtree is the one committed part of `.faff/`; everything else under `.faff/` stays working-state.

## 4. HOW — Behaviour

**Verify walk (the core, shared by the verb and the leg).**

```
PROCEDURE verify_chain(dir, legacy_policy):
  1. lines = read dir/events.jsonl as raw bytes, split on "\n" into physical lines
     (drop a single trailing empty element from a final newline; a non-empty final
      segment with no trailing newline ⇒ torn_tail candidate)
  2. IF file absent or zero lines → status=absent-treated-as verified (nothing to break); return
  3. schema_floor = min per-record schema across parseable records (unparseable line ⇒ ignored for floor)
  4. IF schema_floor < 2 AND no record carries prev → status = legacy-unverifiable
     a. map by legacy_policy: pass → exit 0 detail="legacy schema-1, no chain"; warn → exit 0 + stderr note;
        fail → exit 1 (locked-down opt-in only). NEVER fabricate a chain over schema-1 lines.
  5. FOR each physical line i (1-based):
     a. expected = (i == 1) ? SHA256(utf8(record.run_id))            # genesis
                            : SHA256(raw bytes of line i-1, no trailing "\n")
     b. IF line i parses as a schema-2 record: actual = record.prev
        ELSE IF line i is the torn final segment: mark torn_tail, STOP the walk (do not FAIL)
        ELSE (a mid-file unparseable line where a record is required): status=malformed, exit 2
     c. IF actual != expected: status=broken, first_break={seq,line:i,expected,actual}, exit 1
  6. Ledger fold: last_lw = last event with type "ledger-write"
     IF last_lw present AND dir/run-ledger.json exists:
        IF SHA256(run-ledger.json bytes) == last_lw.data.ledger_sha256 → ledger_fold=match
        ELSE → ledger_fold=mismatch, status=broken, exit 1 (unrecorded ledger rewrite)
     ELSE → ledger_fold=absent (not a failure)
  7. status=verified, exit 0
```

**Anchor write (build lane, at PR-open — the emitter side).** In `faff-graft`, at the point the feature branch is committed and the PR is about to open (alongside the spec commit), the lane snapshots the run's chain evidence:

```
PROCEDURE write_anchor(run_dir, issue, branch):
  1. dest = .faff/anchors/<run_id>/<issue>/
  2. byte-copy run_dir/events.jsonl and run_dir/run-ledger.json into dest (verbatim, no reformat)
  3. compute chain-head.json from the copied events.jsonl (head_seq, head_sha256, line_count, schema_floor)
  4. git add dest; it commits with the branch and ships inside the PR head sha merge-gate pins
```

Write it as a mechanical CLI step — `faff events anchor --run-dir <DIR> --issue <X> --dest .faff/anchors/<run-id>/<X>/` — so the head hash is CLI-computed, never agent-supplied (same trust seam as FAFF-564's write side). The build lane runs the verb and commits its output; it never hand-writes a hash.

**Why the head is trustworthy once committed.** `merge-gate` refuses to merge unless the live PR head equals the sha it observed CI on (`--match-head-commit`, head-drift ⇒ refuse). The anchor is a file inside that commit, so its head hash is pinned by the same mechanism that already gates the merge — rewriting it post-observation means rewriting the pinned head, which merge-gate refuses. No new pinning machinery; the anchor rides the existing one.

**Mixed-schema anchor.** A run in flight when FAFF-564 shipped can produce a log with schema-1 lines followed by schema-2 lines. The walk verifies from the first schema-2 record forward (its `prev` hashes the preceding schema-1 line like any other physical line); the schema-1 prefix carries no `prev` and is reported unverifiable-but-not-broken. `schema_floor` = 1 records the mixed state. Only a genuine `prev` mismatch among the schema-2 records is a broken-chain FAIL.

**Failure modes:**

- **The anchor decouples completeness — but only if it never gets swept as a run dir.** If a future change points the run-dir discovery at `.faff/anchors`, the completeness leg would fire against a snapshotted ledger whose `admitted` array still lists later-queued issues → a false FAIL on an honest run. How you'd know: governance-check FAILs completeness on PRs whose build succeeded, naming undispatched issues that belong to the *run*, not the *PR*. What it means: keep anchor discovery (`anchors-path` → integrity only) strictly separate from run-dir discovery (`artifacts-path` → full sweep); they are different inputs by design.
- **Byte-touching tooling breaks the chain honestly-but-noisily.** An editor or git filter that reformats the committed `events.jsonl` breaks the re-hash without malice. How you'd know: an integrity FAIL naming a line nobody edited maliciously. What it means: the anchor is committed verbatim and never re-touched; the leg's `first_break` line number keeps forensics cheap; run artifacts are otherwise gitignored working state.
- **A forgotten `ledger-write` note (FAFF-564's prose-layer risk) surfaces here as a fold mismatch.** How you'd know: `ledger_fold=mismatch` on a run never attacked. What it means: this is the detection FAFF-564 designed toward — the leg reports it as broken; the fix is FAFF-564's note rule, not this verifier.

**Anti-pattern:** re-implementing the hash walk inside `governance-check.js` instead of composing the `faff events verify` core. Why: two homes for the hashing rule drift, and the file's own invariant is that a leg re-reads a verb's substrate, never forks it.

**Anti-pattern:** committing the live run directory as the anchor. Why: its `run-ledger.json` is mid-run mutable and its `admitted` array is not PR-scoped — the completeness/liveness legs would false-fail. Snapshot the evidence, don't carry the live dir.

**Anti-pattern:** failing a schema-1 or torn-tail run as "broken". Why: neither is tampering; a false FAIL on an honest run destroys the signal. Only a `prev`/ledger mismatch among schema-2 records is a broken chain.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

A broken chain fails the merge (the headline objective):

The integrity leg gates governance-check:

```
Given a carried anchor with a broken chain
When the governance-check Action runs on the PR
Then the integrity leg reports FAIL, governance-check exits non-zero, and the job summary's integrity row
  names the first broken line
```

A clean chain verifies end to end, ledger fold included:

```
Given an anchor whose events.jsonl re-hashes cleanly from genesis and whose run-ledger.json matches the
  last ledger-write event's ledger_sha256
When `faff events verify` runs
Then it exits 0, status "verified", ledger_fold "match"
```

Legacy and torn runs are not false failures:

```
Given a schema-1 anchor with no prev fields, and separately an otherwise-valid schema-2 anchor whose final
  physical line is a torn partial write
When verify runs with the default legacy-policy
Then the schema-1 case exits 0 status "legacy-unverifiable", and the torn case exits 0 with torn_tail true
  (everything before the torn line verified) — neither is reported as broken
```

Non-functional assertions:

- The integrity leg is **gating**: `governance-check`'s aggregate `pass` is false whenever the integrity leg fails, exactly as for completeness/budget/merge_floor/liveness (coherence remains the only report-only leg).
- A PR carrying **no** anchor runs **no** integrity leg and is unaffected — the leg composes with `on-missing: pass` adoption mode without blocking human PRs.
- The head hash written into `chain-head.json` is CLI-computed by `faff events anchor`, never accepted from a caller.

## 6. DESIGN DECISION RATIONALE

**What owns the hash-walk logic — the leg or a verb?** Options: (a) a standalone `faff events verify` verb the leg composes; (b) inline the walk inside `governance-check.js`; (c) reuse `integrity-digest.js`. `governance-check`'s own invariant is that every leg re-reads a verb's substrate (completeness↔`runcheck`, coherence↔`audit`) — inlining forks the hashing rule into a second home that drifts from FAFF-564's write side. `integrity-digest` verifies a *different* property (prefix-preservation during a dispatch window), not a from-genesis re-hash.
**Chosen:** a new `faff events verify` subcommand is the owning verb; the integrity leg composes its core function. One home for the hashing rule, shared by the standalone verb (forensics) and the leg (enforcement).

**What is anchored, and where?** Options: (a) commit the whole live run directory under `.faff/runs`; (b) commit an immutable per-PR snapshot of just the chain evidence (events + ledger + head witness) under a dedicated committed `.faff/anchors` subtree; (c) anchor only a tiny head-hash file with no body. Option (a) makes the existing completeness/liveness legs false-fail — the live `run-ledger.json` is mid-run and its `admitted` array is run-scoped, not PR-scoped. Option (c) leaves the leg nothing to re-hash (the head hash alone can't detect a mid-log edit). Option (b) freezes exactly what the verifier needs, self-consistent at capture time, in a location the completeness sweep never touches.
**Chosen:** an immutable per-PR snapshot (`events.jsonl` + `run-ledger.json` byte-copies + `chain-head.json`) under `.faff/anchors/<run-id>/<issue-id>/`, committed onto the feature branch; a `!.faff/anchors/` gitignore carve-out makes it the one committed part of `.faff/`. This is deliberately narrower than FAFF-363's deferred general run-dir committing, which stays out of scope.

**How is a broken chain distinguished from an honest one?** Options: fail anything that doesn't re-hash cleanly; or classify — broken (mid-chain `prev` mismatch) vs legacy (schema-1, no chain) vs torn (final partial line) vs mixed (schema-1 prefix then schema-2). A blanket fail turns every honest crash and every pre-chain run into a false tamper alarm, destroying the signal.
**Chosen:** classify. Only a `prev` mismatch among schema-2 records (or a ledger-fold mismatch) is a gating `broken` FAIL. Schema-1 → `legacy-unverifiable` under a policy knob (default pass, never fabricate). A torn final line → tolerate-and-flag (`torn_tail`), verifying everything before it — FAFF-564 guarantees the torn bytes are exactly what the next append hashes, so it is an honest crash, not tampering. Mixed → verify from the first schema-2 record forward, schema-1 prefix flagged unverifiable-not-broken.

**Is the integrity leg gating or report-only?** Options: gating (fails the merge) or report-only like coherence. The RFC is explicit: the integrity leg "must fail (not warn) on a broken chain in a schema-2 run" — a report-only tamper check enforces nothing.
**Chosen:** gating. `pass = completeness && budget && merge_floor && liveness && integrity`. Coherence stays the sole report-only leg.

**How does the legacy / adoption policy compose with FAFF-562?** Options: a new `legacy-policy` Action input (default pass), or fold it into the existing `on-missing` knob. `on-missing` already answers "PR carries no artifacts at all"; the legacy question is orthogonal ("PR carries a schema-1 anchor"). Merging them overloads one knob with two meanings.
**Chosen:** a distinct `legacy-policy` input (default `pass`, adoption mode), the anchor-side sibling of `on-missing`. FAFF-562's required-check flip anticipates it: a locked-down agent-only branch sets `legacy-policy: fail`; faff's mixed dogfood repo keeps `pass`.

**Where is the head hash computed?** Options: the build agent computes and writes `chain-head.json`; or a CLI verb (`faff events anchor`) computes it. An agent-supplied hash is an untrusted claim inside a trust artifact — the exact anti-pattern FAFF-564 rejects on the write side.
**Chosen:** `faff events anchor` computes the head hash and writes the snapshot; the build lane runs the verb and commits its output, never hand-writing a hash.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** FAFF-564's chain format exists — schema-2 `events.jsonl` records carry `prev` (SHA-256 of the previous physical line's raw bytes; genesis = SHA-256 of the UTF-8 `run_id`), and `ledger-write` events carry `data.ledger_sha256` (SHA-256 of the post-write `run-ledger.json` bytes). This is the **in-run build order 564-before-568**: FAFF-564 is BlockedBy-upstream and its spec was promoted in this same run's queue — build 564 first, then 568. Validation: before building, `grep` `events.js` for the schema-2 `prev` mint and the `ledger-write` type; if absent, stop and re-queue behind FAFF-564 rather than re-deriving the format here. The verifier re-implements FAFF-564's hashing rule from the schema alone (that is the design — a foreign verifier must be able to), so it depends on the *format*, not on 564's internal functions.
- **Assumes:** `governance-check` and its GitHub Action (FAFF-363) exist as the composition point — verified present: `governance-check.js` with five legs and `.github/actions/governance-check/action.yml`. No blocker; stated so the leg's insertion point is unambiguous.

## 8. DONE — Definition of Done

### From WHY (anchor + verifier close steps 3–4)
- [ ] A run's chain head is committed inside the PR (an anchor snapshot ships on the feature branch), so a post-hoc rewrite collides with the head sha `merge-gate` pins.
- [ ] `governance-check` fails a broken schema-2 chain on the PR (the integrity leg is gating).

### From WHAT (verb, leg, anchor, Action)
- [ ] `faff events verify --run-dir <DIR>` exists: exit 0 verified/legacy-under-pass, 1 broken (`prev` or ledger-fold mismatch), 2 malformed; `--json` emits the `VerifyResult` shape; `--legacy-policy pass|warn|fail` (default pass).
- [ ] `faff events anchor --run-dir <DIR> --issue <X> --dest <D>` writes `events.jsonl` + `run-ledger.json` byte-copies + a CLI-computed `chain-head.json` (never a caller-supplied hash).
- [ ] `evaluateIntegrityLeg` added to `governance-check.js`, composing the verify core; wired into `evaluateRunDir`, the gating `pass`, `buildReasons`, and both the text + summary-md renderers as an `integrity` row.
- [ ] `action.yml` gains `anchors-path` (default `.faff/anchors`) discovery routing to integrity-only, and a `legacy-policy` input (default `pass`) forwarded to the leg; anchors never trigger the completeness/budget/liveness/merge_floor sweep.
- [ ] `gitignore-ensure` adds the `!.faff/anchors/` carve-out; `faff-graft` writes + commits the anchor at PR-open.

### From HOW (walk, mixed/torn/legacy, ledger fold)
- [ ] Genesis check (`prev` == SHA-256(utf8(run_id))) and per-line re-hash (raw bytes, no trailing newline) match FAFF-564's write side.
- [ ] Ledger fold: on-disk `run-ledger.json` SHA-256 confirmed against the last `ledger-write`'s `ledger_sha256`; absent → not a failure, mismatch → broken.
- [ ] Mixed-schema verifies from the first schema-2 record forward; torn final line tolerated-and-flagged; schema-1 → `legacy-unverifiable`, never fabricated, never a broken FAIL.

### Tests
- [ ] `eventsSelftest`/a verify selftest: clean chain → verified; mid-line edit → broken at the first following line; torn tail → verified + torn_tail; schema-1 → legacy-unverifiable; ledger-fold match/mismatch/absent; malformed mid-file line → exit 2.
- [ ] `governanceCheckSelftest` rows: integrity pass; integrity broken → aggregate FAIL + reason string; no-anchor PR → no integrity leg; legacy anchor under `pass` → leg passes.
- [ ] Anchor round-trip: `faff events anchor` then `faff events verify` on the produced dir verifies clean; the head hash equals SHA-256 of the head line.

### Integration smoke test
```
build a run dir with a chained events.jsonl (>=5 records) + a matching run-ledger.json;
`faff events anchor` it to .faff/anchors/<run>/<issue>/; run `faff events verify` on the anchor → exit 0;
edit one middle line of the anchored events.jsonl; re-run verify → exit 1 naming the first broken line;
run governance-check --run-dir <anchor> → integrity leg FAIL, aggregate non-zero
```

No new LLM-judgement seam is introduced — verification is deterministic byte-hashing; no eval-coverage item.

## Already shipped against this surface

Related Done work — context, none of it supersedes this premise:

- **FAFF-363** (Done, PR #359) — shipped the `governance-check` GitHub Action but explicitly deferred the emitter-side artifact-committing slice and added no integrity leg; its `on-missing: pass` dogfood is exactly the composition point this extends.
- **FAFF-518 / FAFF-520 / FAFF-525** (Done) — the `integrity-digest` dispatch-window bracket verifies `events.jsonl` prefix-preservation *during* a dispatch; a different window from post-hoc chain re-hash. Composes unchanged.
- **FAFF-564** (BlockedBy, spec promoted this run) — writes the chain this verifies; the load-bearing upstream, serialised 564-before-568 in this run.

confidence: high
spec-review: approve