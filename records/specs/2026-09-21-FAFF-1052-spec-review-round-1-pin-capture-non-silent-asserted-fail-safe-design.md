# Spec — FAFF-1052: Make spec-review round-1 pin capture non-silent, asserted, and fail-safe

> Spec: faffter-dark-nlspec · 2026-09-21 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1052.
> build-tier: complex
> spec-review: accept (judge, L3-provisional) — 2026-09-21, run run-20260921-031906. Adversarial 3-round loop (architectural/infosec/QA, primary spark-qwen-3-8) plateaued (objection totals 5→4→5, churn=false, converging=false); at the L3 would-be-park the spec-review judge adjudicated all 5 standing propositions blind → 4 AFFIRM_SPEC + 1 UPHOLD_REVIEW (applied); deterministic admit roll-up: admit. Provisional: a later human challenge re-parks/reverts via live-thread reconciliation.

> Status: buildable — spec-review resolved via the L3 judge (2026-09-21, autonomous L3, run-20260921-031906). The one taste axis (sidecar-vs-arg) is operator-ratified (2026-09-16, Revision 4 stands) and closed in-spec (§6/§7 `**Chosen:**`). This is Revision 10. The adversarial spec-review (primary `spark-qwen-3-8`, lenses architectural/infosec/QA) ran three rounds (objection totals 5 → 4 → 5; churn=false throughout; converging=false at round 3 — a producer↔reviewer plateau re-litigating the same govern-seam-is-prose axis in new clothing each round). At that would-be-park point the L3 spec-review judge adjudicated all five standing propositions blind: AFFIRM_SPEC on four (the recurring regress + testability objections established no material defect) and one UPHOLD_REVIEW (infosec/minor), whose bounded correction (`--round` integer-validation on `--govern`) is applied here (Rev 10). No architecture change; operator-ratified sidecar untouched. The judge's admit roll-up is the spec-review verdict of record.

> Revision 2 (2026-09-15) — hardened the deterministic-input surface after round 1: served/no-lens signalling exactly-one-of and required (no silent `no-lens` fail-open); the audit record is a CLI-written artifact; one shared `backendIdentity()`; `--round` required; `reason` CLI-authored and bounded; late-pin-advance vs swap-reset pinned.

> Revision 3 (2026-09-15) — closed the round-2 objections: the swap-path served identity is recorded by the occupant into a per-round `served-<n>.json` that `--govern` reads (no pin-first `--resolve` re-derivation); `backend_identity` scrubbed like `reason`; sidecar happens-before + atomic writes pinned; scenarios added for `pin-marker-missing`/`pin-marker-contradiction`/`no-lens`.

> Revision 4 (2026-09-15) — closed the round-3 objections: `govern` now checks `pin==null → unpinnable-reset` BEFORE requiring the served identity (a FAFF-996 recurrence takes the fail-safe, never exit-2); prep has a defined non-zero-govern-exit disposition; added the round-1-anomaly-distinction, occupant-`served-<n>.json`-path, and failed-capture scenarios. The round-3 architectural minor (drop the sidecar for a required `--served` arg) was DECLINED as taste and sent to the human. Full change list in the Revision log.

> Revision 5 (2026-09-19) — folded the operator's live-thread Resolution (comment 2026-09-16, "Decision (operator): sidecar, as built (Revision 4 stands)"). The sidecar-vs-arg taste axis is now human-ratified and CLOSED in-spec (see the `**Chosen:**` in §6 / §7): the occupant-written `served-<n>.json` sidecar stands; the round-3 counter-proposal (drop the sidecar, pass a required `--served` arg derived from `--winner-index`) is DECLINED because prep resolves the chain pin-first, so a prep-side re-derivation would compare the pin against itself and miss a fallback swap — the exact FAFF-996 gap this ticket closes. The occupant is the only actor that authoritatively knows which backend served, so the fact is recorded where it is known. The methodology critique's two-unit split suggestion is advisory and non-gating (ship as one, since they always land together to close the gap; revert to a split only if a reviewer later objects on size). No architecture, interface, or acceptance criterion changed from Revision 4 — this revision only closes the previously-parked taste decision with the operator's authored choice.

> Revision 6 (2026-09-20) — spec-review resume (autonomous L3, run run-20260920-160925). Round-1 adversarial review (primary reviewer restored) returned reject-approach on five design-lens findings; applied in place, no architecture/interface change and the operator-ratified sidecar decision untouched: (1) QA-major — named the additive-only regression test `test/spec-review-additive-invariant.test.mjs`; (2) QA-major — added a behavioural scenario + `test/spec-review-occupant-served-dispatch.test.mjs` asserting the occupant writes `served-<n>.json` on a round≥2 no-op (catches the round-1-only recurrence behaviourally, not by static match); (3) QA-minor — scenario 10 reframed as a synthetic-fixture reader-tolerance test (the CLI never emits a failed/no-lens marker beside a pin); (4) infosec-minor — `--served` override now well-formedness-gated (malformed → exit 2, never a silent compare); (5) architectural-minor — `GovernanceResult`/`governance-<n>.json` now carry `capture_state`/`capture_round` cross-refs so an RCA reads one self-contained record.

> Revision 7 (2026-09-21) — spec-review resume (autonomous L3, run run-20260921-031906). Re-stamped the provenance date and re-ran the adversarial spec-review the prior drains could not complete within the turn budget (both backends now reachable). No design change at re-stamp; the operator-ratified sidecar decision (2026-09-16) stays folded and closed and the five 2026-09-20 round-1 findings stay applied.

> Revision 10 (2026-09-21) — applied the L3 spec-review judge's one UPHOLD_REVIEW ruling (the would-be-park interceptor ran at the round-3 plateau: converging=false, churn=false; the judge ruled AFFIRM_SPEC on 4 of 5 standing propositions — the recurring govern-seam-regress and testability objections established no material defect — and UPHOLD_REVIEW on 1, infosec/minor p-03). The upheld correction, bounded by the existing requirements: `--govern` now validates `--round` as an integer ≥ 1 before any read (a missing/non-integer/< 1 round is a usage error, exit 2, no governance record, window.json byte-unchanged) — the same gate `--capture`'s `--round` and `writeWindowStart` already apply, closing a path where a degenerate round could mutate `window.json` yet leave no `governance-<n>.json` (breaking the Rev-9 every-path-leaves-an-artifact invariant). Added the matching `--round 0`/negative/non-integer usage-error test to `test/spec-review-window.test.mjs`. No architecture change; operator-ratified sidecar untouched.

> Revision 9 (2026-09-21) — applied this run's round-2 adversarial findings in place (reject-approach, 4 design-lens objections, down from 5; strictly converging, no churn). No architecture change; operator-ratified sidecar untouched. (arch-major) made the governance seam *mechanically symmetric* to the capture seam: `--govern` now writes `governance-<n>.json` on **every** path incl. the served-path exit-2 faults (`{action:"fault"}` + `window_start := n` before exit), and prep asserts the artifact after any return — the "CLI records on every path + prep asserts" property now holds identically for both seams, with the only residue ("prep never calls the step") named as a shared, out-of-scope `**Assumes:**` (§7) rather than an asymmetry. (arch-minor) well-formedness-gated the *stored* pin identity too (`backendIdentity(pin)`), so a torn `pinned-reviewer.json` (degenerate `"||"`) faults loudly rather than silently comparing — "one identity function, both sides" now applied symmetrically. (infosec-minor) closed by the same every-path fault-record write (a torn/missing `served-<n>.json` round now leaves an audit artifact, not just a `prep.md` line). (QA-minor) added an explicit SKILL-wiring lint assertion for prep's `governance-<n>.json` re-read.

> Revision 8 (2026-09-21) — applied this run's round-1 adversarial findings in place (reject-approach, 5 design-lens objections, primary `spark-qwen-3-8` served all three lenses). No architecture change; the operator-ratified sidecar stands. (1) architectural-major — the `--govern` step was itself an unverified prose step (silent-omission one seam up); prep now asserts `governance-<n>.json` was written after each `--govern` and fails safe + LOUD (`govern-record-missing`) if absent — the ticket's own assert-the-step-happened backstop applied to the governance seam. (2+3) architectural-minor + infosec-minor — **removed the optional `--served` override** on `--govern`: the occupant-written `served-<n>.json` is now the sole served-identity source (reinforcing the 2026-09-16 ratification), closing the caller-supplied-input class the override re-opened; `isWellFormedIdentity` is repurposed to validate the sidecar's identity on read. (4) QA-major — named `test/spec-review-atomic-write.test.mjs`, a born-verifiable crash-injection test for the atomicity DONE criterion. (5) QA-minor — made the occupant-returns-before-prep-governs ordering an explicit `**Assumes:**` with a fail-safe (a violation degrades to the pin-present-no-served-identity exit-2 → unpinnable over-park, never a silent compare) and a named test.

This is the buildable design spec for FAFF-1052. Audience: the build agent that will implement the fix, and the human reviewers gating it. It is a high-level design document — design decisions, interfaces, and testable acceptance — not step-by-step code. The fix lives in this same (self-hosting) faff repo; all paths are repo-relative.

## 1. WHY — Problem and Principles

**The load-bearing model.** The spec-review loop's convergence and churn detectors only produce a meaningful trend if *the same reviewer backend* served every round they compare. The reviewer-pin (FAFF-886) is what guarantees that: round 1 is supposed to **capture** the served backend into `pinned-reviewer.json`, and every later round resolves its chain pin-first so it holds that reviewer. If the round-1 capture does not run, there is no pin, prep's swap detection can't fire, and the convergence window silently spans two different reviewer models — a forced fallback then reads as churn (immediate park) and a stronger primary returning reads as non-convergence (reaches the would-be-park). The whole failure is *silent* because the capture is one prose sentence with a conditional skip and **no mechanical backstop**: a missing pin from a silent non-run is byte-for-byte indistinguishable from a missing pin from a legitimate "nothing served, nothing to pin" skip.

**Problem statement.** On FAFF-996 the round-1 capture silently did not run (four lenses served, all `chain[0]`, so the capture precondition held), the pin was absent after round 1, and only appeared when round 2 wrote it — so rounds 1 and 2 were compared across two reviewers. This change makes the outcome of every capture attempt an explicit, disk-recorded fact, has prep assert and loudly record the expected post-round-1 state via a CLI-written artifact, and makes swap detection fail safe (never compare across rounds it cannot prove share a reviewer) — closing the *class* of silent omission regardless of which of the candidate root causes applied.

**Design principles** (each would cause an otherwise-valid implementation to be rejected):

- **Determinism over more prose — on both the output AND the input side.** The root cause is a prose-specified, agent-executed step with nothing checking it ran. The fix must not add *more* unchecked prose. Every new decision — capture outcome, window governance, the audit record — lives in a deterministic, unit-testable CLI, exactly as the pin, window, convergence, and churn logic already do. Crucially, the governance CLI must **fail loud on an under-specified or contradictory invocation** rather than fall through to a benign-looking default: a silent `no-lens` on a served round would just move the silent-omission bug one layer up (from the occupant's capture to prep's flag threading).
- **A legitimate skip is never a failure.** The "no lens served / empty exit-0 set" path is a real no-op and must stay exit-0. The fix distinguishes it from a silent non-run by *recording it*, not by turning it into an error.
- **Fail safe = never compare across an unproven boundary.** When the loop cannot prove two rounds shared a reviewer, it must refuse the cross-round comparison (window starts at the current round) rather than draw a false churn/convergence conclusion. Over-parking is acceptable; a silent false verdict is not.
- **One identity function, both sides.** The string that decides "same reviewer or not" is produced by exactly one helper (`backendIdentity()`) for both the pinned backend and the served backend, so the comparison can never silently drift on a format mismatch.
- **Additive only.** The `round-<n>.json` body (`{verdict, objections}`), the `spec-review-verdict` contract, and the reviewer-blind convergence/churn detectors are untouched. New state is a sidecar beside the existing ones, exactly as `pinned-reviewer.json` and `window.json` sit beside the round records.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review-pin.js` | Node (CJS) | Owns `capturePin`/`resolvePinChain`/`backendIdentity` + the pin sidecar; gets the new capture-outcome marker and exports the identity helper |
| `plugin/skills/faff/bin/lib/spec-review-window.js` | Node (CJS) | Owns `window.json`; gets the new deterministic window-governance subcommand + the governance record artifact |
| `plugin/skills/faff/bin/lib/spec-review-convergence.js` | Node (CJS) | Unchanged; consumes `[window_start .. n]` — the range governance now sets |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Prompt prose | Occupant; its round-1 capture step becomes unconditional (served → capture, empty → record skip) |
| `plugin/skills/faff-prep/SKILL.md` | Prompt prose | Loop driver; replaces hand-derived swap detection with the governance call + surfaces anomalies |
| `plugin/skills/faff/bin/lib/prepcheck.js` | Node (CJS) | The house "assert a specified step happened" precedent (externalised marker + audit) |

**Scope.** This is a robustness fix to the spec-review reviewer-pin loop (FAFF-886), sitting between the L4-adversarial occupant (`faffter-dark-spec-review`) that captures and prep (`faff-prep`) that drives the loop and consumes convergence.

## 2. OUT OF SCOPE

- **Determining the FAFF-996 root cause.** — Why the round-1 capture silently didn't run (empty `$backends_json`, an L4-vs-single-pass path difference, or plain omission) is not settled and this fix does not need it. **Why excluded:** the ticket is explicitly a *class* fix — make omission distinguishable, asserted, and fail-safe — which contains all three candidates. **Extension point:** the new capture-outcome marker's `reason`/`round` fields plus the governance record artifact are the RCA breadcrumbs a future investigation reads.
- **A Stop-hook backstop for the capture (and governance) steps.** — A `prepcheck`-style turn-end Stop hook auditing the capture/govern calls. **Why excluded:** each check has a precise inline home (immediately after each round's record, inside the loop prep already runs), unlike `prepcheck`'s turn-end concern; a Stop hook would fire globally and out of loop context. The inline home is used for *both* seams: the capture outcome is asserted via `pin-capture.json`, and the governance step is asserted via prep's inline post-`--govern` re-read of `governance-<n>.json` (§4, Rev 8) — so declining the Stop hook does **not** leave the governance seam an unverified prose step (the arch-major this closes). **Extension point:** if a turn-end backstop is later wanted, `hooks-ensure.js:36`'s hook registry is where it slots.
- **Changing convergence/churn detector semantics.** — The reviewer-blind detectors stay untouched (FAFF-886's "NO schema change" commitment holds). **Why excluded:** the fix is entirely about *which round range* is fed to them and *whether* a pin exists, not how they score. **Extension point:** `spec-review-convergence.js` already accepts `--window-start`.
- **Teaching any detector about backends.** **Why excluded:** swap awareness is a loop-level (prep + governance) concern by design. **Extension point:** the governance subcommand is the single place backend identity meets the window.
- **The sibling FAFF-1051 ("a specified step nothing verifies ran").** — Related-only; has no committed spec. **Why excluded:** different step. **Extension point:** this spec's marker+assert pattern is a reusable precedent for it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Capture-outcome marker | New sidecar `pin-capture.json` recording what the round's pin-capture attempt did: captured / skipped-no-lens / failed |
| Served set | The set of exit-0 lenses for a round; "served round" = at least one lens returned findings |
| Backend identity | The single canonical string the existing `backendIdentity()` returns — `provider\|model\|host` (literal pipes) — the sole key deciding whether two backends are "the same reviewer". Used verbatim on both sides of every comparison. |
| Capture round | The round in which the pin was actually first written (`marker.round` when `state:"captured"`) — the earliest round the pin provably covers |
| Unpinnable loop | A loop where, after a served round, no trustworthy pin exists — so no two rounds can be proven to share a reviewer |
| Window-narrowing event | Any governance action that moves `window_start` forward — `swap-reset`, `late-pin-advance`, or `unpinnable-reset`. A consumer asking "did the reviewer boundary move this round?" keys on this set (equivalently `window_start == n`), never on `swap-reset` alone. |
| Window governance | The deterministic per-round decision that sets `window_start` from (pin, capture-outcome marker, served identity, served-ness, round) and writes a governance record |

**Types.**

```
RECORD PinCaptureOutcome:                 # sidecar: <scratch>/pin-capture.json
  state: ENUM { "captured", "skipped-no-lens", "failed" }
  round: int                              # the round this outcome was produced in (>= 1); ALWAYS present
  reason: string?                         # CLI-authored (not raw file bytes); required for skipped-no-lens + failed
  winner_index: int?                      # present iff state == "captured"
  backend_identity: string?              # backendIdentity() of the pinned backend, iff "captured"
  ts: string                              # ISO timestamp

  CONSTRAINT state == "captured"        IMPLIES pinned-reviewer.json exists and names backend_identity
  CONSTRAINT state == "skipped-no-lens" IMPLIES pinned-reviewer.json absent
  CONSTRAINT reason is authored by the CLI from a fixed failure-kind vocabulary + a bounded detail
            (<= 200 chars, control chars stripped) — never the verbatim contents of --backends-json
  CONSTRAINT backend_identity is passed through the SAME bound+control-char scrub as reason before
            it is persisted (it derives from the untrusted --backends-json via backendIdentity())
```

```
RECORD ServedIdentity:                     # sidecar: <scratch>/served-<n>.json — one per served round
  round: int
  served_identity: string                  # backendIdentity() of the min-chain-index served backend (scrubbed)
  winner_index: int
  ts: string
  # Written by the OCCUPANT (the only actor that authoritatively knows which backend served round n),
  # on the served path of its per-round `spec-review-pin --capture` call — every served round, not just round 1.
  # `--govern` reads served-<n>.json for the round's served identity; there is no no-lens ServedIdentity file.
```

```
RECORD GovernanceResult:                  # stdout of `spec-review-window --govern` AND persisted to governance-<n>.json
  round: int
  window_start: int                       # the persisted window_start after this round (>= 1)
  action: ENUM { "unchanged", "swap-reset", "late-pin-advance", "unpinnable-reset", "no-lens", "fault" }   # "fault": a served-path exit-2 (Rev 9), artifact still written
  anomaly: ENUM { "round1-capture-missed", "unpinnable", "pin-marker-missing", "pin-marker-contradiction",
                  "pin-identity-malformed", "served-identity-missing-or-malformed" }?   # last two = the Rev 9 fault records
  served_identity: string?               # echoed back for the audit record; null on the no-lens path
  capture_state: ENUM { "captured", "skipped-no-lens", "failed", "absent" }   # cross-ref: pin-capture.json state (Rev 6), "absent" when no marker exists
  capture_round: int?                    # cross-ref: pin-capture.json round when a marker exists, else null
  ts: string
```

**CLI surfaces.**

`faff spec-review-pin --capture` — a no-lens mode, a CLI-authored outcome marker on every path, `--round` required, and a per-round served-identity record:

```
faff spec-review-pin --capture --dir <s> --backends-json <f> --winner-index <i> --round <n>
    served path: idempotent first-write of pinned-reviewer.json (unchanged) AND, on that same
    first-write, first-write pin-capture.json {state:"captured", round, winner_index, backend_identity}.
    Idempotent no-op (pin already exists) -> pin + pin-capture.json untouched.
    ALSO on EVERY served call (round 1 and rounds >= 2 alike, even when the pin write is a no-op): write
    served-<n>.json {round, served_identity := scrub(backendIdentity(chain[winner_index])), winner_index, ts}.
    This is the per-round record of who actually served round n — the occupant is the only actor that knows
    it authoritatively (it resolved the chain and dispatched), so recording it here removes any need for prep
    to re-derive the served backend from a pin-first --resolve (the round-2 architectural gap).

faff spec-review-pin --capture --no-lens-served --dir <s> --round <n>          # NEW
    no pin written; writes pin-capture.json {state:"skipped-no-lens", round, reason:"empty exit-0 set"}. Exit 0.
    On a failure that today exits 2 (bad-capture, unreadable/empty --backends-json): FIRST write
    pin-capture.json {state:"failed", round, reason:<CLI-authored, bounded>}, THEN exit 2.

  --round is REQUIRED on both forms (no default) — a missing --round is a usage error (exit 2). --winner-index
  and --no-lens-served are mutually exclusive; exactly one of {served capture, --no-lens-served} per call.
```

`faff spec-review-window --govern` — deterministic window governance with required served-ness signalling:

```
faff spec-review-window --govern --dir <s> --round <n> (--any-served | --no-lens)
    Reads window.json + pinned-reviewer.json + pin-capture.json + served-<n>.json; applies the window rule
    (HOW below); persists window_start via writeWindowStart; writes governance-<n>.json; prints GovernanceResult.

  Served-ness is REQUIRED and exactly-one-of:
    --no-lens        nothing served this round -> action "no-lens", window unchanged.
    --any-served     a lens served; the served identity is read SOLELY from served-<n>.json (occupant-written),
                     NOT re-derived by prep from a pin-first --resolve and NOT overridable by any caller-supplied
                     flag. The occupant-written sidecar is the SINGLE authoritative source (operator ratification
                     2026-09-16). There is NO --served override (Rev 8: removed — a second, caller-supplied input to
                     the one comparison the whole ticket hinges on re-opened the class the ratification closed, and
                     it had no production consumer; a test that needs a specific served identity writes served-<n>.json
                     directly). The served_identity read from the sidecar MUST be a well-formed identity
                     (isWellFormedIdentity: three non-empty pipe-delimited provider|model|host segments); a
                     malformed/torn sidecar -> exit 2 (fail-loud), never a silent compare.
  Usage errors (exit 2, arg-validation, written before any read, no governance record, window.json byte-unchanged): neither/both served-ness flags; a missing/non-integer/< 1 `--round`. Explicitly (Rev 10, judge UPHOLD p-03): `--govern` validates --round as an integer >= 1 before any read: a missing, non-integer, or < 1 --round is a usage error (exit 2, no governance record, window.json byte-unchanged) — the same gate `--capture`'s `--round` and `writeWindowStart`'s `window_start >= 1` already apply.
  BOTH operands of the swap comparison must be well-formed (Rev 9): the stored pin identity (backendIdentity(pin))
  and the served identity (served-<n>.json). A pin present but with a torn/missing served-<n>.json, OR a
  torn/field-stripped pinned-reviewer.json (a degenerate "||" identity), is a served-path fault: --govern writes
  governance-<n>.json {action:"fault", anomaly:...} AND sets window_start := n (unpinnable fail-safe) BEFORE exit 2
  — so EVERY round that reaches --govern leaves an audit artifact (the same "CLI records on every path" property the
  capture seam has via pin-capture.json), never a silent degenerate compare.
  Any served identity used in the comparison is a scrub(backendIdentity()) string (literal pipes). --dir/--round required.
```

The existing `--next-round | --read | --set` modes are unchanged; `--govern` joins the exactly-one-of mode set. `backendIdentity()` and `scrub()` are **exported** from `spec-review-pin.js` and are the single source of the identity string on every side.

**Design decision — where the capture-outcome record lives.** Options: (a) more occupant prose; (b) a field on `round-<n>.json`; (c) a dedicated sidecar written by the `spec-review-pin` CLI. (a) has the *identical* silent-omission failure mode this ticket exists to kill. (b) violates the additive "round record body stays `{verdict, objections}`" commitment and mixes reviewer-blind data with reviewer identity. (c) is deterministic, unit-testable, and mirrors how `pinned-reviewer.json`/`window.json` already sit as sidecars. **Chosen:** a dedicated `pin-capture.json` sidecar written by `faff spec-review-pin --capture` on every path.

**Design decision — the occupant's capture step shape.** The conditional skip is the branch that silently swallowed the non-run. **Chosen:** the occupant always invokes `spec-review-pin --capture` after aggregation — served → `--winner-index <min i> --round n`, empty set → `--no-lens-served --round n`.

**Design decision — served-ness is a required, exactly-one-of signal (closing the input-side fail-open).** Making `--any-served`/`--no-lens` optional with "absent ⇒ nothing served" re-creates the silent-omission bug on the input side. **Chosen:** served-ness is required and exactly-one-of; the served round's reviewer identity comes from the occupant-written `served-<n>.json` (below); every under-specified/contradictory combination is a usage error (exit 2).

**Design decision — the audit record is a CLI-written artifact, not agent prose.** **Chosen:** `--govern` itself writes `governance-<n>.json` (a hard-floor sidecar) carrying the full `GovernanceResult` including any `anomaly`. That file is the observable audit artifact a test asserts and a human/RCA reads; prep *additionally* surfaces anomalies into `prep.md`, but correctness never depends on the prose copy.

## 4. HOW — Behavior

### Occupant (`faffter-dark-spec-review/SKILL.md`) — unconditional capture

```
PROCEDURE occupant_pin_capture(scratch, backends_json, served_lenses, n):
  1. IF served_lenses is non-empty:
       winner_index := min(chain[i]) across served lenses         # unchanged parse of the header
       faff spec-review-pin --capture --dir scratch --backends-json backends_json --winner-index winner_index --round n
       # round 1: pinned-reviewer.json + pin-capture.json{captured}; EVERY served round: served-<n>.json{served_identity}
  2. ELSE (empty exit-0 set — nothing to pin, round is needs-human via the transport floor):
       faff spec-review-pin --capture --no-lens-served --dir scratch --round n
       # writes pin-capture.json{skipped-no-lens}; NO pin, NO served-<n>.json; a legitimate exit-0 no-op
```

Because the occupant fully returns before prep governs the round (below), the `served-<n>.json`/`pin-capture.json` writes strictly happen-before prep's `--govern` read.

### CLI — `spec-review-pin --capture` marker writes

```
PROCEDURE capture(dir, chain?, winnerIndex?, noLensServed, round):    # round REQUIRED; usage-error exit 2 if absent
  IF noLensServed:
    write pin-capture.json {state:"skipped-no-lens", round, reason:"empty exit-0 set", ts}; RETURN exit 0
  IF pinned-reviewer.json exists:                 # rounds >= first-pinned round
    id := scrub(backendIdentity(chain[winnerIndex])); write served-<n>.json {round, served_identity:id, winner_index, ts} (atomic)
    RETURN {written:false}                         # pin + pin-capture.json untouched; served-<n>.json still recorded
  validate chain is array AND winnerIndex in range AND chain[winnerIndex] is a backend object
    ON failure: reason := authored(failure_kind, bounded_detail); write pin-capture.json {state:"failed", round, reason, ts}; RETURN exit 2
  id := scrub(backendIdentity(chain[winnerIndex]))                # same bound+control-char scrub as reason
  write pinned-reviewer.json = chain[winnerIndex] (verbatim, atomic write-rename)
  write pin-capture.json {state:"captured", round, winner_index, backend_identity := id, ts} (atomic)
  write served-<n>.json {round, served_identity := id, winner_index, ts} (atomic)
  RETURN {written:true, marker_written:true}
```

`reason`, `backend_identity`, and `served_identity` are all CLI-scrubbed (fixed failure-kind vocabulary for `reason`; `scrub(backendIdentity())` — ≤200 chars, control chars stripped — for the identities), so a hostile/malformed `--backends-json` cannot inject unbounded/log-breaking content into any persisted field. All sidecar writes are atomic (write-temp-rename). `readCaptureOutcome(dir)`, `readServedIdentity(dir, n)`, `backendIdentity(backend)`, and `scrub(str)` are exported from `spec-review-pin.js`.

### Window governance — the deterministic swap/window rule

```
PROCEDURE govern(dir, n, servedness):   # servedness in {no-lens, any-served}; exactly one, REQUIRED
  # Arg validation FIRST — a bad combination or degenerate --round is a usage error, before any read (exit 2):
  #   neither/both servedness flags -> exit 2
  #   --govern validates --round as an integer >= 1 before any read: a missing, non-integer, or < 1 --round is a usage error (exit 2, no governance record, window.json byte-unchanged)
  #   (Rev 10, judge UPHOLD p-03) — mirrors --capture's --round requirement and writeWindowStart's window_start >= 1 gate, so no degenerate round reaches writeWindowStart or the governance-<n>.json filename and breaks the "every path leaves an audit artifact" invariant.
  ws  := readWindowStart(dir)              # existing fail-safe default 1
  pin := read pinned-reviewer.json (object | null)
  cap := readCaptureOutcome(dir)           # PinCaptureOutcome | null

  # (E) Nothing served this round: no comparable objections produced. Window unchanged.
  IF servedness == no-lens:
     result := {round:n, window_start: ws, action:"no-lens", served_identity:null, ts}
     write governance-<n>.json = result (atomic); RETURN result      # window.json NOT rewritten

  # (U) Served but NO pin -> UNPINNABLE. Checked BEFORE the served-identity requirement: the FAFF-996
  # recurrence (occupant serves but dies before capture, so neither pin nor served-<n>.json exists) MUST
  # take the documented unpinnable-reset fail-safe, NOT an exit-2 — there is no pin to compare against.
  IF pin == null:
     writeWindowStart(dir, n); ws := n
     anomaly := (n == 1) ? "round1-capture-missed" : "unpinnable"
     result := {round:n, window_start:n, action:"unpinnable-reset", anomaly,
                served_identity:(readServedIdentity(dir,n)?.served_identity ?? null), ts}
     write governance-<n>.json = result (atomic); RETURN result

  # Pin present -> a swap comparison is meaningful, so NOW BOTH operands of the comparison are required
  # to be well-formed — the "one identity function, both sides" principle applied symmetrically (Rev 9).
  # A served-path fault writes a governance-<n>.json {action:"fault", ...} record BEFORE exit 2 (mirroring
  # --capture's {failed}-before-exit-2), so EVERY round that reaches --govern leaves an audit artifact —
  # the governance seam now has the same "the CLI records on every path" property as the capture seam,
  # closing the infosec-minor (fault paths left no artifact) and the arch-major's asymmetry claim.
  pin_identity := backendIdentity(pin)                       # the STORED operand (Rev 9: also gated)
  IF NOT isWellFormedIdentity(pin_identity):                 # a torn/field-stripped pinned-reviewer.json (e.g. degenerate "||")
     write governance-<n>.json {round:n, window_start:n, action:"fault", anomaly:"pin-identity-malformed", served_identity:null, ts} (atomic)
     writeWindowStart(dir, n); exit 2                        # fail loud AND fail safe (window_start := n), never a silent degenerate compare
  served_identity := readServedIdentity(dir, n)?.served_identity   # SOLELY from the occupant-written sidecar — no caller override (Rev 8)
  IF served_identity is absent OR NOT isWellFormedIdentity(served_identity):   # the SERVED operand (Rev 8/9)
     write governance-<n>.json {round:n, window_start:n, action:"fault", anomaly:"served-identity-missing-or-malformed", served_identity:null, ts} (atomic)
     writeWindowStart(dir, n); exit 2                        # pin present but no readable well-formed served reviewer -> fault artifact + unpinnable fail-safe, never silent
  # Every GovernanceResult carries capture_state/capture_round read from pin-capture.json (Rev 6),
  # so governance-<n>.json alone distinguishes "capture never ran" (absent) from "capture ran and failed" (failed).

  IF cap AND cap.state == "captured": capRound := cap.round; anomaly := none
  ELSE: capRound := 1; anomaly := cap ? "pin-marker-contradiction" : "pin-marker-missing"   # SOFT — recorded, not fatal

  action := "unchanged"
  IF ws < capRound: ws := capRound; action := "late-pin-advance"                 # (L) late pin
  IF served_identity != backendIdentity(pin): ws := n; action := "swap-reset"    # (S) swap within a pinned span

  writeWindowStart(dir, ws)
  result := {round:n, window_start:ws, action, anomaly, served_identity, ts}
  write governance-<n>.json = result (atomic); RETURN result
```

**late-pin-advance vs swap-reset — distinct events, both window-narrowing.** `swap-reset` = *within an already-established pinned span* (`capRound < n`) a **different** backend served — the FAFF-886 case; late-pin-advance does not also fire (`ws` is not `< capRound`). `late-pin-advance` = the pin was first established this round (`capRound == n`, the FAFF-996 case) — there is no earlier pinned round to have swapped *from*, and `served_identity == backendIdentity(pin)`, so swap-reset does not also fire. Both push `window_start` toward `n`; a consumer asking "did the reviewer boundary move?" keys on the window-narrowing set `{swap-reset, late-pin-advance, unpinnable-reset}` (equivalently `window_start == n`), never on `action == "swap-reset"` alone.

### Prep (`faff-prep/SKILL.md`) — govern + surface

```
PROCEDURE prep_after_round(scratch, n, lens_results):   # runs AFTER the occupant dispatch fully returned
  IF lens_results has >= 1 exit-0 lens:
     result := faff spec-review-window --govern --dir scratch --round n --any-served   # NO --served: govern reads served-<n>.json
  ELSE:
     result := faff spec-review-window --govern --dir scratch --round n --no-lens
  IF govern exit != 0:                       # served-path fault (torn/missing served-<n>.json, torn pin) — the CLI still WROTE governance-<n>.json {action:"fault"} + set window_start := n (Rev 9)
     surface the govern fault into prep.md; window_start := n   # defined disposition: treat as unpinnable — never compare across an unproven boundary
  ELSE:
     window_start := result.window_start
     IF result.anomaly present: surface result.action + result.anomaly + (pin-capture.json reason, if any) into prep.md   # LOUD
  # ASSERT the governance step actually ran (Rev 8/9, arch-major): the same "assert the specified step happened"
  # backstop this ticket applies to capture, now applied to governance ITSELF so the fix does not re-introduce the
  # silent-omission class one seam up. --govern's contract (Rev 9) is to have written governance-<n>.json on EVERY
  # path it reaches — exit 0 (unchanged/swap-reset/late-pin-advance/unpinnable-reset/no-lens) AND the served-path
  # exit-2 faults ({action:"fault"}) — exactly the "CLI records on every path" property the capture seam already
  # has via pin-capture.json. Prep re-reads that artifact after ANY --govern return (0 or 2) and, if it is absent
  # or unreadable, treats the round as unpinnable (window_start := n) and surfaces a LOUD "govern-record-missing".
  # So the only artifact-less residue is prep never calling --govern at all — the irreducible "prep runs its own
  # loop steps" assumption that the capture seam ALSO rests on (§7 Assumes), out of scope for this ticket (§2), and
  # symmetric across both seams — not an asymmetry between a CLI-written capture record and a prose governance one.
  IF governance-<n>.json is absent OR unreadable (on either exit 0 or exit 2):
     window_start := n; surface "govern-record-missing" (LOUD) into prep.md
  # the authoritative audit artifact is governance-<n>.json, written by --govern itself on every path; convergence/churn run over [window_start .. n]
```

The round-1 assertion is not special-cased in prep — it is `govern(round=1, any-served)` returning `anomaly:"round1-capture-missed"` (and writing `governance-1.json`) when the pin is absent; prep surfaces it and proceeds under the `unpinnable-reset` fail-safe. The human-unpark window reset (existing `--set --next-round`) is unchanged.

**Edge cases.** Whole-chain outage → ordinary all-backends-down `needs-human` via the transport floor (no pin-specific park). Malformed `window.json`/`pin-capture.json`/`served-<n>.json` on read → fail-loud exit 2. Under-specified/contradictory `--govern` invocation → exit 2. The default single-pass occupant never drives `--govern` (the pin is L4-adversarial-occupant behaviour).

**Anti-pattern:** re-deriving `window_start` or the served identity in prep prose. The decision is the deterministic, tested `--govern` call reading the occupant-written `served-<n>.json`; prep only signals `--any-served`/`--no-lens`. **Anti-pattern:** treating a `skipped-no-lens` marker as an error — it is the legitimate no-op; only a *missing* marker on a served round is an anomaly.

### Failure modes
- **Occupant still doesn't reach the capture call:** served round → no pin (and no `served-<n>.json`) → governance takes `pin == null` FIRST → `unpinnable-reset` (`window_start := n`, anomaly recorded), written to `governance-<n>.json`; prep surfaces it. The FAFF-996 recurrence takes the documented fail-safe (never exit-2). The fix does not depend on the occupant being fixed.
- **Marker written but pin torn/absent:** governance sees `pin == null` → `unpinnable-reset`. Rare torn write, recorded not silent.
- **`failed`/`skipped-no-lens` marker alongside a pin:** soft `pin-marker-contradiction`, `capRound = 1`. Backward compatible, surfaced.
- **Legacy pin, no marker:** soft `pin-marker-missing`, `capRound = 1`. No regression on healthy loops.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a round-1 spec-review that served at least one lens
When the occupant's unconditional capture call runs (--round 1)
Then pinned-reviewer.json exists AND pin-capture.json records {state:"captured", round:1} AND served-1.json records the served identity
```

```
Given a round-1 spec-review that served NO lens (empty exit-0 set)
When the occupant calls spec-review-pin --capture --no-lens-served --dir <s> --round 1
Then it exits 0, pinned-reviewer.json is absent, no served-1.json, and pin-capture.json records {state:"skipped-no-lens", round:1} — a legitimate no-op
```

```
Given a served round n=3 with pin==null
When prep runs spec-review-window --govern --dir <s> --round 3 --any-served
Then it returns anomaly:"unpinnable" (distinct from round 1's "round1-capture-missed"), action:"unpinnable-reset", window_start:3
```

```
Given round 1's capture silently did not run and round 2's fallback then wrote the pin
      (pin-capture.json {state:"captured", round:2}, served-2.json.served_identity == the pin's identity)
When prep governs round 2 --any-served (served identity read from served-2.json, NO --served override)
Then window_start advances to 2 (action:"late-pin-advance"), governance-2.json records it, and convergence over [2..2] never compares round 1 vs round 2
```

```
Given a healthy pinned loop (pin captured round 1, capRound=1) whose round 2 is served by a DIFFERENT fallback,
      recorded by the OCCUPANT into served-2.json (served_identity != pinned identity), pin still chain[0]
When prep governs round 2 --any-served (NO --served override — govern reads served-2.json)
Then window_start resets to 2 (action:"swap-reset") — proving the round-2 fix: the occupant-recorded served identity drives swap detection
     even though --resolve would return the pin first; FAFF-886 preserved
```

```
Given a served round where --backends-json is empty/unreadable (capture failure, candidate cause #2)
When the occupant calls spec-review-pin --capture --dir <s> --backends-json <bad> --winner-index 0 --round 2
Then pin-capture.json records {state:"failed", reason:<CLI-authored, bounded>} BEFORE exit 2, no served-2.json is written,
     and a subsequent govern --round 2 --any-served with pin==null takes unpinnable-reset (a failed capture is surfaced, never silent)
```

```
Given a round-1 empty (no-lens) round
When prep governs it: spec-review-window --govern --dir <s> --round 1 --no-lens
Then the result is {action:"no-lens", window_start:1, served_identity:null}, governance-1.json is written, AND window.json is byte-unchanged
```

```
Given a served round n=3 with the pin present but NO capture marker (legacy / mid-migration), served-3.json present (identity == pin)
When prep governs it --any-served
Then capRound is assumed 1, result {action:"unchanged", window_start:<prior ws>, anomaly:"pin-marker-missing"}, full shape in governance-3.json
```

```
Given a served round n=3 with the pin present AND a pin-capture marker whose state is "failed"/"skipped-no-lens", served-3.json present (identity == pin)
  # NOTE (Rev 6): the CLI's own --capture write sequence never emits a failed/skipped-no-lens marker ALONGSIDE a pin
  # (failed/no-lens paths write no pin). This coexistence arises only from an out-of-band edit or a torn write, so
  # this scenario is exercised via a hand-crafted fixture and verifies the READER's tolerance, not a CLI-reachable runtime state.
When prep governs it --any-served (marker + pin supplied as a synthetic fixture)
Then capRound is assumed 1, result {action:"unchanged", window_start:<prior ws>, anomaly:"pin-marker-contradiction"} — distinct from pin-marker-missing by the anomaly value
```

```
Given any --govern invocation that omits served-ness, combines --no-lens with --any-served, passes --no-lens with --served,
      or --any-served with a pin present but no recorded served identity
When it runs
Then it exits 2 (usage error / fault) and writes no governance record — never a silent no-lens
```

- The convergence/churn detectors, the `round-<n>.json` body, and the `spec-review-verdict` contract are byte-unchanged (additive-only) — asserted by a file-hash/`git diff` regression check named in the DoD.

```
Given a round>=2 where the pin already exists and the occupant serves a lens (idempotent no-op capture), driven by the actual occupant dispatch (not a direct CLI call)
  # Rev 6 (QA-major-2): closes the "occupant stops recording after round 1" recurrence behaviourally, not by static prose match.
When the occupant runs its unconditional --capture step for round n>=2 (--winner-index set, pin present)
Then spec-review-pin --capture returns {written:false} AND served-<n>.json IS written for round n with the served identity,
     so a later --govern --any-served reads a served identity and never falls to the pin-present-no-served-identity exit-2 / unpinnable fail-safe
```

## 6. Design Decision Rationale

**Where does the capture outcome get recorded?** **Chosen:** a dedicated `pin-capture.json` sidecar written by `faff spec-review-pin --capture` (prose repeats the silent-omission bug; a round-record field breaks the additive commitment).

**How is the occupant's capture step shaped?** **Chosen:** unconditional — served → `--winner-index`, empty → `--no-lens-served` (the conditional skip is the branch that silently swallowed the non-run).

**Is served-ness an optional or required governance input?** **Chosen:** required, exactly-one-of; every under-specified/contradictory combination exits 2 (optional-with-a-default re-creates the silent-omission bug on the input side).

**How is the swap-comparison string kept from drifting?** **Chosen:** one exported `backendIdentity()` (through one `scrub()`) produces every side; a round-trip test pins the format.

**Where does the served identity for the swap comparison come from?** Prep is only given pin-first chain access (`--resolve` returns `[pin, ...rest]`), so deriving the served identity from `chain[0]` would compare the pin against itself on a fallback-served round and miss the swap (the round-2 architectural major). **Chosen (human-ratified, operator decision 2026-09-16):** the occupant — the only actor that authoritatively knows which backend served — writes a per-round `served-<n>.json{served_identity}` on its existing `--capture` call; `--govern` reads it as the **sole** source; prep only signals `--any-served`. The round-3 architectural minor argued to drop this sidecar for a required `--served` arg; the operator **DECLINED** that reversal: prep resolves the chain pin-first, so a prep-side re-derivation from `--winner-index` would compare the pin against itself and miss a fallback swap — the exact FAFF-996 gap this ticket closes. This taste axis is now closed; it is not an open punt.

**Is there any caller-supplied override of the served identity? (Rev 8)** Revision 6 carried an optional `--served` override on `--govern` "for testing/interactive". **Chosen:** remove it — there is **no** override; the occupant-written `served-<n>.json` is the single authoritative source. A second, caller-supplied input to the one comparison the whole ticket hinges on re-opened the exact class the 2026-09-16 ratification closed (a well-formed-but-wrong or pin-derived override silently suppresses a real swap), and it had no production consumer. A test that needs a specific served identity writes `served-<n>.json` directly. `isWellFormedIdentity()` is retained and repurposed to validate the identity **read from the sidecar** (a torn/corrupt sidecar → exit 2 fail-loud), so the export stays load-bearing.

**How is the `--govern` step itself kept from becoming the next silently-skipped prose step? (Rev 8/9)** The recurring arch-major: the whole fix rests on prep *running* `--govern` each round, which is itself a prose step, so is the assert-the-step backstop just more prose one seam up? **Chosen:** make the governance seam *mechanically symmetric* to the capture seam, not merely add another prose re-read:
- The CLI writes `governance-<n>.json` on **every path it reaches** — the exit-0 actions AND the served-path exit-2 faults (`{action:"fault"}`, Rev 9), mirroring how `--capture` writes `pin-capture.json` on every path incl. `{failed}`-before-exit-2. So "the CLI records on every path" holds identically for both seams.
- Prep asserts the artifact exists after **any** `--govern` return (0 or 2); absent → unpinnable + LOUD `govern-record-missing` (§4) — the inline sibling of the "assert the pin exists after round 1" capture assertion.
- Both operands of the swap comparison are well-formedness-gated (served identity *and* stored pin identity, Rev 9), so a torn record on either side faults loudly, never a silent degenerate `"||"` compare.

The **only** residue is prep never calling `--govern` at all — but that is the *identical* residue the capture seam has (the occupant never calling `--capture`), so it is **not** an asymmetry between a CLI-written capture record and a prose governance one; it is the one shared, irreducible assumption both seams rest on: *prep executes its own loop steps* (§7 Assumes). A full Stop-hook to catch even that stays out of scope (§2): it would fire globally, out of loop context, and the same argument would then recurse onto whatever registers the hook. The line is drawn where the ticket drew it — the inline home — for both seams identically.

**Where is the "loud record" actually observable?** **Chosen:** `--govern` writes `governance-<n>.json` (hard-floor sidecar) with the full result including `anomaly` ("the round audit log" as agent prose is unverifiable).

**What is the marker's write trigger and authority?** **Chosen:** written whenever a pin write is attempted (no pin yet exists), carries `round`; untouched on the idempotent no-op.

**Does a failed capture stay silent?** **Chosen:** write `{state:"failed", reason}` before the existing exit-2 (candidate cause #2 failed silently).

**Is `--round` optional?** **Chosen:** required on `--capture`/`--no-lens-served`; omission is a usage error (an implicit default silently breaks late-pin detection).

**What is the fail-safe / late-pin rule, and the exit-2 ordering (round-3 fix)?** **Chosen:** `pin == null → unpinnable-reset` is checked BEFORE the served-identity requirement, so a FAFF-996 recurrence takes the fail-safe (`window_start := n`), never exit-2; exit-2 is reserved for the narrower "pin present, no recorded served identity" fault, and prep has a defined non-zero-exit disposition (treat as unpinnable). Then pin present → `window_start := max(window_start, capRound)` (late-pin-advance) then identity-based `swap-reset`.

**How is a pin present without a valid marker treated (legacy/torn)?** **Chosen:** backward-compatible — assume `capRound = 1`, emit a *soft* `pin-marker-missing`/`pin-marker-contradiction` (recorded, non-fatal).

**Should the pin-capture CLI and the `--govern` state machine ship as one unit or two?** **Chosen (operator decision 2026-09-16):** ship as one. The methodology critique flags them as two structurally independent units (A: capture + sidecars + exports; B: `--govern` + fail-safe state machine + prep rewiring, which consumes A); that split is **advisory and non-gating**. They always land together to close the FAFF-996 gap, so shipping as one is legitimate; revert to a split (wiring an explicit A→B `blockedBy`) only if a reviewer later objects on size.

**Is a new hard-park cause introduced?** **Chosen:** no — the fail-safe makes convergence naturally reach the existing would-be-park (`needs-human`) if it genuinely cannot converge.

## 7. Open Questions and Assumptions

**Open Questions:** none — all decisions are closed above. The sidecar-vs-arg taste axis (previously handed to a human) was ratified by the operator on 2026-09-16: the `served-<n>.json` sidecar stands and the round-3 `--served`-arg counter-proposal is declined (see §6).

**Assumptions:**

- **Assumes:** the occupant (`faffter-dark-spec-review`) reaches its per-round `spec-review-pin --capture` call on **every served round** so `served-<n>.json` is written for `--govern` to read. *Validation:* confirm in `faffter-dark-spec-review/SKILL.md` that the capture step runs each round (this spec makes it unconditional); a served round that never reaches capture leaves no pin and no `served-<n>.json`, which `--govern` handles via the `pin == null` unpinnable-reset fail-safe (never a silent no-lens). The occupant already computes `winner_index`, so it holds the served backend object with no new input threading.
- **Assumes (Rev 9, arch-major — the shared irreducible seam):** prep **executes its own per-round loop steps** — the occupant's `--capture` dispatch AND prep's `--govern` call + `governance-<n>.json` re-read. This is the single assumption both the capture seam and the governance seam rest on: if prep runs neither the capture assertion nor `--govern`, no sidecar exists for either. It is symmetric (neither seam is more mechanically guaranteed than the other) and out of scope for this ticket (§2: a global Stop-hook to catch "prep skipped the whole loop" would fire out of loop context, and the same regress would recurse onto whatever registered it). *Validation:* both steps live inline in the single loop iteration prep already runs (`prep_after_round`, called after the occupant dispatch's tool result is consumed); the deterministic convergence/churn consumers read `[window_start .. n]`, and `window_start` only advances through `--govern`, so a governed round's window is only ever narrowed by the tool, never by prose. What the ticket *does* guarantee is that whenever `--govern` (or `--capture`) **does** run, its outcome is a disk-recorded, asserted fact — the silent-*omission-of-a-run-step* class is closed; the "prep does not run at all" class is a different (and unbounded) concern.
- **Assumes (Rev 8, QA-minor):** the Agent-tool producer dispatch is **synchronous** — the occupant fully returns (and its `served-<n>.json`/`pin-capture.json` writes have landed) before prep runs `--govern` for the same round. This happens-before ordering is what lets `--govern` read a served round's identity from `served-<n>.json`. *Validation:* prep runs `--govern` only inside `prep_after_round`, which the loop calls **after** the occupant dispatch's tool result is consumed (single-turn, `run_in_background: false`); this is the same synchronous-dispatch property the whole spec-review loop already relies on. *Fail-safe if the assumption is ever violated* (a future harness/`run_in_background` change lets `--govern` observe the scratch dir before the write lands): on a **pinned** round the missing `served-<n>.json` makes `--govern` exit 2 (pin-present-no-served-identity) → prep's defined disposition treats it as unpinnable (`window_start := n`) — a safe over-park, never a false `unchanged`/silent cross-reviewer compare; on an **unpinnable** round the `pin == null` branch already resets the window. Either way an ordering violation degrades to the fail-safe, never to a silent wrong verdict. A named test asserts the pinned-round exit-2 path (§8 Tests).

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] After a round-1 spec-review with ≥1 served lens, either `pinned-reviewer.json` exists OR `pin-capture.json` explicitly records the absence with a reason (acceptance #1).
- [ ] A backend swap between rounds is detected (`swap-reset`/`late-pin-advance`), OR the inability to detect it is surfaced (`anomaly` in `governance-<n>.json` + fail-safe window), rather than the window silently spanning two reviewers (acceptance #2).
- [ ] The no-lens-served path stays exit-0 and is recorded as `skipped-no-lens`, not a failure (acceptance #3).
- [ ] `round-<n>.json` body, the `spec-review-verdict` contract, and the convergence/churn detectors are byte-unchanged — asserted by **`test/spec-review-additive-invariant.test.mjs`** (Rev 6), a file-hash/`git diff` regression test that fails if `spec-review-convergence.js`, `spec-review-churn.js`, the `round-<n>.json` reader, or the `spec-review-verdict` contract fixture changed.

### From WHAT (types + interfaces)
- [ ] `pin-capture.json` matches `PinCaptureOutcome`; `state:"captured"` iff `pinned-reviewer.json` exists and `backend_identity` names it; `state:"skipped-no-lens"` iff no pin; `round` always present.
- [ ] `served-<n>.json` matches `ServedIdentity`, written on every served round (incl. rounds ≥2 where the pin write is a no-op) and never on the no-lens path.
- [ ] `reason` AND `backend_identity`/`served_identity` are CLI-scrubbed — never verbatim `--backends-json` bytes (asserted with a hostile/oversize/newline-laden backends file against every persisted field).
- [ ] `faff spec-review-pin --capture --no-lens-served --dir <s> --round <n>` writes the skip marker, exits 0, no pin, no `served-<n>.json`; missing `--round` → exit 2.
- [ ] `faff spec-review-pin --capture` served path writes `pin-capture.json{captured}` + `pinned-reviewer.json` on the first capture, `served-<n>.json` on EVERY served round, and `{failed}` before an exit-2. All sidecar writes are atomic (write-temp-rename) — asserted by **`test/spec-review-atomic-write.test.mjs`** (Rev 8): a write interrupted between temp-write and rename leaves the target either absent or complete-and-valid, never a torn/partial file.
- [ ] `readCaptureOutcome(dir)`, `readServedIdentity(dir, n)`, `backendIdentity(backend)`, `scrub(str)`, `isWellFormedIdentity(str)` exported from `spec-review-pin.js` (`isWellFormedIdentity` now validates the identity read from `served-<n>.json`, not a caller override — Rev 8).
- [ ] `faff spec-review-window --govern` prints a `GovernanceResult`, persists `window_start`, and writes `governance-<n>.json` (atomic, asserted by `test/spec-review-atomic-write.test.mjs`) on **every path it reaches** — the exit-0 actions AND the served-path exit-2 faults (`{action:"fault", anomaly:...}` written + `window_start := n` set BEFORE the exit-2, Rev 9); only the pre-read arg-validation error (neither/both served-ness flags) writes no record. Reads the served identity SOLELY from `served-<n>.json` on `--any-served` (no `--served` override — Rev 8). BOTH swap operands are well-formedness-gated (Rev 9): the served identity AND the stored `backendIdentity(pin)` — a torn/field-stripped pin (degenerate `"||"`) faults with `anomaly:"pin-identity-malformed"`. `pin==null` unpinnable-reset is checked BEFORE the served-identity requirement; served-ness required exactly-one-of; malformed sidecars fail loud (exit 2 with a fault record); the `no-lens` path leaves `window.json` byte-unchanged.
- [ ] Prep asserts the governance step ran: after **any** `--govern` return (exit 0 or the served-path exit-2 fault) it re-reads `governance-<n>.json`, and an absent/unreadable artifact → unpinnable fail-safe (`window_start := n`) + a LOUD `govern-record-missing` surfaced into `prep.md` (Rev 8/9, arch-major) — the assert-the-step-happened backstop applied symmetrically to the governance seam, mechanically the same as the capture seam (CLI records on every path + prep asserts the record).

### From HOW (behaviour)
- [ ] Served round-1 → `{captured, round:1}` + pin + `served-1.json`.
- [ ] Empty round-1 → `{skipped-no-lens, round:1}`, no pin, no `served-1.json`, exit 0; governance `--no-lens` → `no-lens`, window unchanged, `governance-1.json` written.
- [ ] Served round-1 with no pin (served-1.json present) → `unpinnable-reset`, `window_start:1`, `anomaly:"round1-capture-missed"`; served round n≥2 no pin → `anomaly:"unpinnable"`.
- [ ] Late pin (captured round 2 after a round-1 miss, served-2 == pin) → `late-pin-advance`.
- [ ] Healthy earlier pin (capRound=1), different fallback serves round 2 (served-2 ≠ pin, via `served-<n>.json`) → `swap-reset` — fires even though the pin is chain[0].
- [ ] Pin present, marker missing → soft `pin-marker-missing`; pin present + `failed`/`skipped-no-lens` marker → soft `pin-marker-contradiction`; both `capRound=1`.
- [ ] Every window-narrowing action sets `window_start == n` (or advances it).

### From HOW (occupant + prep wiring)
- [ ] Occupant SKILL calls `spec-review-pin --capture` unconditionally with `--round`: `--winner-index` on served (writing `served-<n>.json` every served round), `--no-lens-served` on empty.
- [ ] Prep SKILL calls `spec-review-window --govern` per round after the occupant dispatch returns, signalling only `--any-served`/`--no-lens` (no prep-side identity derivation, no `--served` override), with a defined non-zero-exit disposition (treat as unpinnable), asserts `governance-<n>.json` was written (absent → unpinnable + LOUD `govern-record-missing`), and surfaces any `anomaly`; the authoritative record is `governance-<n>.json`.

### Tests (named additions in `test/`)
- [ ] `test/spec-review-pin.test.mjs` — `--no-lens-served` (skip marker, no pin, no served-<n>.json); served capture (captured marker + served-<n>.json, correct identity/round); served round ≥2 writes served-<n>.json on the idempotent no-op; bad/unreadable/empty `--backends-json` writes `{failed}` before exit 2; missing `--round` → exit 2; hostile oversize/newline backend asserts `reason`+`backend_identity`+`served_identity` scrubbed; `readCaptureOutcome`/`readServedIdentity`/`backendIdentity`/`scrub`/`isWellFormedIdentity` round-trip + tolerate absent/malformed (well-formed 3-segment identity accepted, empty/missing-segment rejected); a `scrub(backendIdentity())` format round-trip.
- [ ] `test/spec-review-window.test.mjs` — `--govern` each branch: `no-lens` (governance written + window.json byte-unchanged); `unpinnable-reset`+`round1-capture-missed` (round 1) vs `unpinnable` (round ≥2); `late-pin-advance` (served == pin via served-<n>.json); **`swap-reset` driven by `served-<n>.json` naming a fallback ≠ pin on an earlier-pin loop, pin still chain[0]**; `unchanged`; soft `pin-marker-missing` and `pin-marker-contradiction` each asserting the FULL GovernanceResult; pin-present-no-served-identity → exit 2 **with a `{action:"fault", anomaly:"served-identity-missing-or-malformed"}` governance record written + `window_start := n`** (Rev 9); a malformed/torn `served-<n>.json` identity → same fault-record exit 2 (never a silent compare — Rev 8/9); a torn/field-stripped `pinned-reviewer.json` (degenerate `"||"`) → `{action:"fault", anomaly:"pin-identity-malformed"}` + exit 2 (Rev 9, arch-minor — the stored operand is gated symmetrically); the pinned-round happens-before-violation path (pin present, `served-<n>.json` absent) → the same served-identity fault → prep unpinnable fail-safe (Rev 8, QA-minor); the arg-validation combos (neither/both served-ness flags) → exit 2 with **no** record; **`--govern` with `--round 0`, a negative round, and a non-integer round each exit 2 as a usage error with `window.json` byte-unchanged and no governance record written** (Rev 10, judge UPHOLD p-03); **every non-arg-error `--govern` path writes `governance-<n>.json`** (Rev 9); each branch asserts `governance-<n>.json` content. Asserts NO `--served` flag is accepted (Rev 8).
- [ ] SKILL-wiring lint tests: occupant SKILL matches unconditional `--capture` with `--no-lens-served`, `--round`, and a per-round `served-<n>.json` write; prep SKILL matches `spec-review-window --govern` with `--any-served`/`--no-lens`, NO prep-side identity derivation (`assert.doesNotMatch` on the old `if a pin exists .* fallback` phrasing and any prep-side identity hand-derivation), AND the post-`--govern` `governance-<n>.json` re-read + `govern-record-missing` fail-safe assertion (Rev 9, QA-minor — so a build that drops the re-read fails the lint, closing the "govern-assert has no test" gap).
- [ ] `test/spec-review-occupant-served-dispatch.test.mjs` (Rev 6, QA-major-2) — an e2e/behavioural check that the occupant dispatch writes `served-<n>.json` on a round>=2 idempotent no-op (pin already present), so the round-1-only-capture regression is caught behaviourally, not only by the static SKILL-wiring prose match.
- [ ] `test/spec-review-additive-invariant.test.mjs` (Rev 6, QA-major-1) — the named file-hash/`git diff` regression test asserting `spec-review-convergence.js`, `spec-review-churn.js`, the `round-<n>.json` reader, and the `spec-review-verdict` contract fixture are byte-unchanged (additive-only).
- [ ] `test/spec-review-atomic-write.test.mjs` (Rev 8, QA-major) — asserts every new sidecar write (`pin-capture.json`, `served-<n>.json`, `governance-<n>.json`, `pinned-reviewer.json`) is atomic: a write interrupted between the temp-write and the rename leaves the target either absent or complete-and-parseable, never a torn/partial file (a plain `writeFileSync` build fails this).
- [ ] Both libs' embedded `--selftest` extended for the new branches, still PASS.
- [ ] End-to-end oracle (extending `detectSpecReviewConvergence`): a late-pin loop with `window_start` advanced to the capture round converges over the pinned rounds, whereas the pre-fix `window_start:1` span reads as churn/non-convergence.
- [ ] Regression test: `spec-review-convergence.js`, the `round-<n>.json` body shape, and the `spec-review-verdict` contract are byte-unchanged.

## Revision log

**Revision 10 (2026-09-21)** — the round-3 spec-review reached the L3 would-be-park point (converging=false, churn=false; totals 5→4→5, a plateau re-litigating the govern-seam-is-prose axis). The L3 spec-review judge adjudicated all five standing propositions blind (two-phase, per-proposition): AFFIRM_SPEC ×4 (p-01 arch-major, p-02 arch-minor, p-04 QA-major, p-05 QA-minor — no material defect established; the demanded external-auditor correction is out of scope), UPHOLD_REVIEW ×1 (p-03 infosec-minor). Applied p-03's bounded correction: `--govern` validates `--round` as an integer ≥ 1 before any read (usage error otherwise, exit 2, no record, window.json byte-unchanged), plus the matching test. Admit roll-up: admit → promote-provisional (L3). No architecture change; operator-ratified sidecar untouched.

**Revision 9 (2026-09-21)** — applied this run's round-2 adversarial findings in place (reject-approach, 4 design-lens objections, down from 5; churn=false, converging). No architecture change; operator-ratified sidecar untouched. arch-major: `--govern` writes `governance-<n>.json` on every path incl. served-path exit-2 faults (`{action:"fault"}`), making the governance seam mechanically symmetric to the capture seam (CLI records on every path + prep asserts the record); the residual "prep never runs the step" is named as a shared, out-of-scope `**Assumes:**` (§7). arch-minor: the stored `backendIdentity(pin)` operand is now well-formedness-gated too (torn pin → `pin-identity-malformed` fault), applying "one identity function, both sides" symmetrically. infosec-minor: closed by the same every-path fault record. QA-minor: explicit SKILL-wiring lint for prep's `governance-<n>.json` re-read.

**Revision 8 (2026-09-21)** — applied this run's (run-20260921-031906, autonomous L3) round-1 adversarial spec-review findings in place (reject-approach; 5 design-lens objections; primary `spark-qwen-3-8` served architectural/infosec/QA, all chain[0]). No architecture/interface-widening change; operator-ratified sidecar untouched. (1) arch-major: prep now asserts `governance-<n>.json` was written after each `--govern` (absent → unpinnable fail-safe + LOUD `govern-record-missing`) — the assert-the-step-happened backstop extended to the governance seam so the fix does not move the silent-omission class one seam up. (2+3) arch-minor + infosec-minor: removed the optional `--served` override on `--govern`; the occupant-written `served-<n>.json` is the sole served-identity source, and `isWellFormedIdentity` now validates the sidecar identity on read (torn/corrupt → exit 2). (4) QA-major: named `test/spec-review-atomic-write.test.mjs` (crash-injection) so the atomicity DONE criterion is born-verifiable. (5) QA-minor: the occupant-returns-before-govern ordering is now an explicit `**Assumes:**` with a fail-safe (violation → pin-present-no-served-identity exit-2 → unpinnable over-park, never a silent compare) + a named test.

**Revision 7 (2026-09-21)** — spec-review resume (run-20260921-031906): re-stamped the provenance date and re-ran the adversarial review the prior drains could not complete within the turn budget (both backends reachable). No design change at re-stamp.

**Revision 6 (2026-09-20)** — spec-review resume (run-20260920-160925): applied that drain's round-1 findings in place (named the additive-only regression test; added the occupant round≥2 `served-<n>.json` no-op scenario+test; reframed scenario 10 as a synthetic-fixture reader-tolerance test; well-formedness-gated the then-present `--served` override; added `capture_state`/`capture_round` cross-refs to `GovernanceResult`). The confirming round-2 could not finish within the turn budget → parked (infra, not a spec defect).

**Revision 5 (2026-09-19)** — folded the operator's live-thread Resolution (comment 2026-09-16): the sidecar-vs-arg taste axis is human-ratified and closed in-spec. The `served-<n>.json` sidecar (occupant-written) stands; the round-3 `--served`-arg counter-proposal is declined (prep resolves pin-first, so a prep-side re-derivation would miss a fallback swap — the FAFF-996 gap). The methodology two-unit split stays advisory/non-gating (ship as one). No architecture/interface/AC change from Revision 4; only the previously-parked decision is closed with the operator's authored choice. §6/§7 updated from "sent to the human" to "human-ratified"; Status line updated from parked to buildable.

**Revision 4 (2026-09-15)** — addressed the round-3 objections (architectural + QA; infosec cleared). The reviewer had plateaued (convergence 8→5→5, `converging:false`) with a taste-axis oscillation, so this fixes the one real correctness defect + concrete scenario gaps and the residual disagreement was parked for a human (now resolved in Rev 5):
- **architectural major (exit-2 vs unpinnable-reset ordering) — FIXED:** `govern` checks `pin == null → unpinnable-reset` BEFORE requiring the served identity, so a FAFF-996 recurrence takes the fail-safe, never exit-2; exit-2 reserved for the narrower "pin present but no served identity" fault; prep given a defined non-zero-exit disposition.
- **QA major (round-1 anomaly distinction) — FIXED:** added a scenario pinning `round1-capture-missed` (n==1) vs `unpinnable` (n≥2).
- **QA major (occupant-written served-<n>.json path) — FIXED:** late-pin/swap scenarios now govern via `served-<n>.json` (no `--served` override).
- **QA minor (failed-capture scenario) — FIXED:** added a served-round capture-failure scenario.
- **architectural minor (drop served-<n>.json for a required `--served` arg) — DECLINED (taste); ratified declined by the operator in Rev 5.**

**Revision 3 (2026-09-15)** — round-2 objections: occupant records the served identity into per-round `served-<n>.json` that `--govern` reads (no pin-first `--resolve` re-derivation); `backend_identity` scrubbed like `reason`; sidecar happens-before + atomic writes; scenarios for `pin-marker-missing`/`pin-marker-contradiction`/`no-lens`.

**Revision 2 (2026-09-15)** — round-1 objections: `--govern` served-ness required exactly-one-of (no silent `no-lens`); `governance-<n>.json` audit artifact; late-pin-advance vs swap-reset pinned; one `backendIdentity()`; `--round` required; `reason` CLI-authored/bounded; `pin-marker-contradiction` test.

## Already shipped against this surface

- **FAFF-886** (Done 2026-08-20) — shipped the reviewer pin itself; this ticket hardens its capture step (load-bearing prerequisite, shipped).
- **FAFF-909** (Done 2026-08-27) — persisted the convergence window (`window.json`, `spec-review-window`); this fix adds `--govern` to that module.
- **FAFF-951** (Done 2026-08-31) — "approve stamp without a completed round record": same assert-a-step family; its `round_recorded` guard is the sibling precedent.
- **FAFF-989** (Done 2026-09-03) — "decision-capture marker never emitted at runtime": the closest analog of the silent-omission class.
- **FAFF-425** (Done 2026-07-10) — "governance CLIs fail closed on read faults": the fail-closed convention this spec follows.
- **FAFF-178** (Done 2026-06-20) — prep same-turn attach, the origin of the `prepcheck` marker+audit pattern.

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery (agile-delivery). Advisory — surfaced for `/faff-wtf`, does not gate promotion.*

**Right-sized? — Split candidate (advisory).** Two structurally independent units: (A) unconditional capture + `pin-capture.json` + `served-<n>.json` + `--no-lens-served` + exported `backendIdentity()`/`scrub()` (`spec-review-pin.js`); (B) `spec-review-window --govern` + fail-safe state machine + `governance-<n>.json` + prep rewiring (`spec-review-window.js`). (B) consumes (A). They always ship together to close FAFF-996, so keep-as-one is legitimate (and is the operator's ratified choice, 2026-09-16); if split, wire an explicit A→B `blockedBy`.

**Workstream fit? — No issues.** Project-less Backlog is correct for a captured bug; FAFF-886/996/1051 are related-only.

**Deps surfaced? — One check.** Builds on FAFF-886 (Done), so related-only is honest; not `blockedBy`.

**Risk profile? — Contained.** Local, deterministic, additive-only; no novel integration/external dep. The risk concentration is the `--govern` fail-safe state machine — the DoD asserts each branch independently.