# FAFF-1353 — The write core refuses an issue-scoped event with an empty issue

> Spec: faffter-dark-nlspec · 2026-10-20 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1353.

_Revised 2026-10-20 — round 4. Round 1 was rejected by spec review (the core ran full envelope mode against the active profile); round 2 narrowed the core to the issue-scoped rule; round 3 applied the operator's decision to drop the schema half; round 4 scopes the override-path claim per the operator's ruling on review round 2, records keying to `DELIVERY_PROFILE` as a rejected option, pins the predicate's position, gives the two other writers' criteria a buildable trigger, and requires the stale comment at `events.js:607-610` be corrected. Round 5 applies the named minors from review round 3 and records the agreed fallback for the `corrective.js` change; by operator decision of 2026-10-20 it goes to build with no further review round. The methodology critique below was written against round 3; round 4 touches no methodology principle, and its only stale detail is the DoD count (now eighteen)._

This is the build spec for FAFF-1353, slice 1 of 2 under FAFF-1348. It is written for the build agent that implements the change and for the people who review it. Of the parent ticket's prevention value, this slice ships all of it. Once the write core refuses, the in-kernel capture path cannot write a row with an empty `issue` on any type the active profile declares issue-scoped, and FAFF-1261's anchor gate stops having to refuse every anchor of every multi-issue run. Slice 2 (FAFF-1354) only makes the refusal visible and blocks nothing.

On 2026-10-20 the operator narrowed this slice to the writer rule alone. The schema constraint that round 2 included has moved to OUT OF SCOPE, and the decision section on scope records why.

## 1. WHY — problem and principles

**The load-bearing model.** Event validation in `faff` has two independent halves, and the write core runs only one of them. `eventViolations` (`plugin/skills/faff/bin/lib/events.js:169`) holds the vocabulary rules, among them "an issue-scoped type must carry a non-empty `issue`" (`:209`, reading `profile.issue_scoped_types`). `validateEvidenceDocument` (`evidence.js:182-195`) holds the JSON-schema check. The write core `appendRecordUnderLock` (`events.js:611-628`) runs only the schema half. The v0.3 schema accepts `issue: ""` because the envelope `issue` is a bare `{"type":"string"}`, so nothing at write time refuses the row. This slice puts the issue-scoped rule, and only that rule, into the write core, which every `events.jsonl` write passes through. It changes no schema.

**Problem statement.** A per-issue gate kernel that captures a decision under a live `$FAFF_RUN_DIR`, with no correlation id exported, writes a `decision-capture` row with `issue: ""`. The write core accepts it, and `faff events validate --file` then rejects it. Fourteen such rows sit in `.faff/runs/run-20261018-174517-beepboop-list-2710a1` (seq 7, 8, 12, 13, 14, 18, 19, 24, 33, 34, 44, 45, 46, 47). `mintIssueAnchor` byte-copies the whole run's chain (`events.js:1614`), so every per-issue anchor in that run inherits the bad rows, and one missing issue field contaminates the evidence for unrelated work. After this slice the write core refuses the row, and under the default profile, or any profile that declares the type issue-scoped, the chain cannot pick one up.

### Design principles

**The rule is enforced at the writer.** FAFF-1009 fixed the same class of defect one field over by tightening orchestrator prose, and the fourteen rows show that prose does not hold. The rule has to bind at the writer, where no caller can skip it. A rule enforced by callers can be bypassed, forgotten or rewritten.

**The rule binds on the two paths that skip checks today, as far as the active dialect declares it.** `logRecordChecker` returns `null` whenever `activeProfile() !== DELIVERY_PROFILE` (`evidence.js:212`), and the core then writes with no check. An unavailable schema bundle (`SchemaUnavailable`) reduces the write to no check at all, plus a marker in the run directory and one stderr line (`evidence.js:66-80`, `:158-171`, `:221-234`). The new check sits outside both branches. The cited run directory has no `evidence-schema-unavailable.json` marker, so a bundle fault did not cause the fourteen rows. The path is still open, though, and this slice closes it.

The rule is keyed to the active profile's `issue_scoped_types`, so its reach differs by path:

- **Default profile and unavailable bundle:** the rule binds unconditionally, against delivery's `issue_scoped_types`.
- **Profile override:** the rule binds on every type the override declares issue-scoped. Under an override that does not declare a type issue-scoped, an empty `issue` on that type is legal in that dialect. The writer accepts it, and the file validator, which reads the same profile, accepts it too.

That last case is the dialect's own rule, not a gap in this one. Under a dialect that does not name delivery's types at all, such as `SECOND_PROFILE`, FAFF-1261's gate already refuses every anchor at its first row. The gate's line validator rejects the genesis `run-start` on `phase` and `type`, and rejects a `decision-capture` row on `type`.

**The core enforces one rule, not a profile's whole vocabulary.** A governance profile is a dialect. `validateProfileShape` (`governance-profile.js:225-235`) checks that each declared key is an array of strings, from a closed set of top-level keys, and never checks what the arrays contain. The shipped `SECOND_PROFILE` (`governance-profile.js:186-202`) is deliberately disjoint from delivery: `event_phases: ["job"]` and `event_types: ["job-start","job-end","job-outcome"]`. If the core ran `eventViolations` in full, every `events.jsonl` write would have to conform to the active dialect, including the structural records the chain writes for itself, which no dialect has to name. That would change the governance model under cover of a bug fix, and this slice does not do it.

**The profile is resolved once per append, never once per record inside the lock.** When `$FAFF_GOVERNANCE_PROFILE` is set, `activeProfile` (`governance-profile.js:311-333`) does `fs.readFileSync`, `JSON.parse` and `validateProfileShape` on every call. It is deliberately not memoized, and its own comment justifies that by assuming one call per CLI invocation. Resolving the profile inside the append lock would turn that into a file read, parse and shape check for every record, all inside the lock. It would also throw `GovernanceProfileError`, which is not `EVENT_SCHEMA`. The core's callers are written to catch only `EVENTS_LOCKED` and `EVENT_SCHEMA` (`events.js:1191-1198`, `self-intake.js:189-195`, `contain.js:185-191`) and rethrow anything else. This principle corrects the parent FAFF-1348 spec. That spec said `eventViolations` "reads the active profile and loads no files", and its case that the two unchecked paths could be closed at no cost depended on that false claim.

**The capture path stays best-effort.** `captureDecisionCore` wraps its `appendEventRecord` call in a try/catch that sends any throw to `bestEffortFail` and returns (`decision-capture.js:483-484`). `captureDecision` wraps the whole call in a guard that never throws (`:489-491`). A refusal therefore makes the capture fail quietly and never changes an authoritative kernel's exit code or stdout. This slice must not change that. Making the failure loud and readable is FAFF-1354's job.

### Reference context

| Module | Role in this change |
|---|---|
| `plugin/skills/faff/bin/lib/events.js` | Holds `eventViolations` (`:169`), the write core `appendRecordUnderLock` (`:611-628`), `appendEventRecord` (`:673-684`), `emitGenesisRunStart` (`:700-706`) and the `faff events append` verb (`:1079`, `:1189`). The append lock is an atomic `wx` create of `<run dir>/events.jsonl.lock`, released in a `finally` (`:10`, `:503`) |
| `plugin/skills/faff/bin/lib/evidence.js` | Holds `logRecordChecker` (`:205-218`), which gains a trailing defaulted `profile` parameter, plus the bundle loader and the marker written when a write runs without the schema |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Holds `DELIVERY_PROFILE` (the source of `issue_scoped_types`), the disjoint `SECOND_PROFILE` test dialect, `validateProfileShape` and `activeProfile` (`:311-333`). Read, not edited |
| `plugin/skills/faff/bin/lib/corrective.js` | Holds the one existing in-lock `eventViolations` call that lets the profile default (`:373`), inside the mint callback passed at `:369` |
| `plugin/skills/faff/bin/lib/sentry.js` | `sentryThresholds` (`:315`) resolves the profile once in `faff corrective author`, before any append. Read, not edited. It matters only because the corrective probe below has to count that read |
| `scripts/evidence-v0.3-compose.mjs`, `verification/evidence/v0.3/`, `plugin/skills/faff/contracts/evidence-v0.3/` | **Untouched.** This slice changes no schema, so it regenerates nothing and leaves both schema trees as they are |

All four edited modules are `.js` source with no `.ts` sibling (checked against `plugin/skills/faff/bin/lib/*.ts`). The rule about TypeScript sources and committed `.js` emit therefore does not apply, and no `npm run build` or `build-manifest.json` update is owed. `commissaire.ts` is the sibling of one `logRecordChecker` caller (`commissaire.js:165`), but this slice does not edit that caller.

**Scope statement.** This slice enforces the issue-scoped rule at the one write path into the events chain. It adds no observability, repairs no existing row, changes no schema, and narrows no other degrade.

### The FAFF-1261 edge, and what in this slice satisfies it

FAFF-1261 ("refuse to mint or merge anchors that fail their schema") is `blockedBy` this slice. It is In Review with an open PR (#1086). Round 2 said the edge was satisfied by the schema half specifically. **That was wrong.** The write-core change satisfies the edge, and the schema half adds nothing to the gate's enforcement.

FAFF-1261's gate validates each JSONL manifest entry through `validateJsonlFile` (`evidence.js:128` on PR #1086's head). That function joins the schema check and the line validator into one list of violations: `[...validateAgainstSchema(...), ...lineValidator(...)]` (`:146`). Every JSONL entry is validated with `LINE_VALIDATORS[rel]` (`:471`), and a JSONL entry with no line validator throws `SchemaUnavailable` (`:80`), so the line validator always runs. `LINE_VALIDATORS["events.jsonl"]` is `eventViolations(rec, true)`, which rejects `issue: ""` with `type 'decision-capture' is issue-scoped but missing required field 'issue'`. FAFF-1261's gate already refuses these rows, with or without any schema change.

What FAFF-1261 needs from this slice is that new runs stop producing the rows. Otherwise its gate refuses every anchor of every multi-issue run in which a kernel captures without a correlation id. The write-core change delivers that. Anchors already holding the fourteen rows stay refused; FAFF-1347 owns them.

Narrowing the slice also removes a merge-order risk. Round 2's schema change was non-additive, so ADR-0141 would have allowed it into v0.3 in place only if it landed before #1086, and nothing enforced that order. A writer rule changes no schema, so the order of the two PRs no longer matters.

## 2. Already shipped against this surface

The check for a superseded premise found the premise still holds. The fix is not built, `HEAD` is `ba922f21`, and the four modules this slice edits have no uncommitted changes in the working tree.

**FAFF-1260 (Done 2026-10-14)** closed the payload schemas for every event type and effect kind. It is the source of `issue_scoped_types` and of the rule this slice makes binding. It also wrote the comment at `events.js:607-610`: "every events.jsonl write passes through here, so the v0.3 payload check runs on each minted record inside the lock". That is true of the payload check, which is why nobody noticed the `eventViolations` half was missing.

**FAFF-1256 (Done 2026-10-14)** shipped the v0.3 evidence schemas, the anchor manifest and the validator extension points. It registered `eventViolations` in `LINE_VALIDATORS` (`evidence.js:47-48`) for file-level validation only, and this slice ends that split for one rule.

**FAFF-1009 (Done 2026-09-06)** fixed seven of nine decision-capture kernels that shipped unwired and emitted an empty `correlation_id`. It is the closest prior work and the same class of defect one field over. Its fix was orchestrator prose, which is why this ticket wants a rule enforced in code.

**FAFF-362** set the pattern this change reuses: a trailing `profile` parameter whose default reproduces the old behaviour byte for byte. `eventViolations` and `sentryThresholds` already take their profile this way.

**FAFF-1261 (In Review, PR #1086)** set the precedent this slice follows. ADR-0141 line 54 records that FAFF-1261 met the same tension for `ac_id` and chose a writer rule over a non-additive schema change.

**FAFF-1277, FAFF-966 and FAFF-564** shipped the verdict-file `schema_version`, the genesis chain with `anchor-missing`, and the `events.jsonl` hash chain. The new refusal must not disturb any of them.

## 3. OUT OF SCOPE

**Stating the rule in the v0.3 event schema.** This means adding `"pattern": "."` to the envelope `issue` of the thirteen issue-scoped schema-2 types. The operator dropped it on 2026-10-20; the scope decision below records why. If someone takes it up later, two costs apply:

- It cannot land cheaply. Round 2 measured the change as `additive: false` under `classifySchemaChange`. Once ADR-0141 is accepted, "any other change to a v0.3 schema needs a new minor version" (line 35), so the constraint could no longer go into v0.3 in place. It would need a v0.4 directory, or a change to what `classifySchemaChange` treats as additive, which ADR-0141 line 51 says needs the same review as a change to the versioning rule.
- It adds no enforcement. It would make the schema describe the rule, but the `events.jsonl` line validator already enforces the rule wherever the file is validated.

Extension point: the envelope template in `eventSchema` (`scripts/evidence-v0.3-compose.mjs:61-75`), which already derives `issueScoped` from `DELIVERY_PROFILE.issue_scoped_types`, applied to a new minor-version directory.

**Enforcing the active profile's phase and type vocabulary at the write core.** The scoping decision below rejects this, and the failure-mode analysis records what it would break. Extension point: the `phases`/`types` checks at `events.js:203-208`, reachable from the core by widening the new predicate, never by calling `eventViolations` in full.

**Enforcing the outcome-required rule at the write core.** `issue-outcome` is the only `outcome_required_types` member under delivery, and its only writer through the core already handles a refusal (see below). Moving that rule into the core would still bring the `ledger_outcomes` vocabulary with it and reopen the blast radius this slice avoids. Extension point: the `outcomeRequired` block just after the issue-scoped test in `eventViolations`.

**Rejecting a whitespace-only or newline-only `issue`.** The whitespace decision below records this as the one gap this slice knowingly leaves. Extension point: the missing-issue test at `events.js:209`, where a trim would go, with the corpus-wide consequence that argues against it.

**Repairing the fourteen existing rows.** Editing them would destroy the chain-integrity proof, and FAFF-1347 owns that decision and needs the rows as evidence. Extension point: FAFF-1347, which already covers the per-issue anchor byte-copy at `events.js:1614`.

**Everything in FAFF-1354 (slice 2).** That covers the refusal reason surfaced from the capture path, the run-directory suppression marker, and the comment update at `decision-capture.js:454-458`. This slice must not specify or anticipate any of them. Extension point: `bestEffortFail` in `decision-capture.js`, which already receives the refusal message this slice produces.

**Keeping the payload schema check alive when the schema bundle is unavailable.** This slice makes the issue-scoped rule independent of the bundle. The payload half still falls back to no check on a `SchemaUnavailable` fault. Extension point: `validateEvidenceDocument`'s `unavailable` return (`evidence.js:186-192`) and the `unavailable` branch in `appendRecordUnderLock`.

**Tightening the orchestrator prose again so it exports the correlation id and the issue.** FAFF-1009 already did that, and the fourteen rows show prose does not hold. Extension point: the orchestrator skill prompts under `plugin/skills/faff/`.

**Restricting `__run__` to the four run-level kernels.** Extension point: the four kernel call sites at `queue-state.js:192`, `run-done.js:205`, `run-start.js:113` and `run-outward.js:122`.

**Wiring `captureDecision` into the `tier` and `regions` kernels, which do not call it.** Extension point: `captureDecision` in `decision-capture.js`, called the same way the nine wired kernels call it.

**Suppressing a row that has a good issue but an empty `correlation_id`.** That is the deferred FAFF-956 contract call, recorded in the comment at `decision-capture.js:454-458`. Updating that comment is slice 2's job. Extension point: the `correlation_id === ""` branch at `decision-capture.js:459-461`.

## 4. WHAT — vocabulary, shapes and decisions

### Vocabulary

| Term | Meaning |
|---|---|
| Envelope mode | `eventViolations(record, true, …)`. It adds the chain-envelope checks (`schema`, `run_id`, `seq`, `ts`, `prev`) and the `ledger-write` ledger-hash rule to the vocabulary rules |
| Vocabulary rules | The checks `eventViolations` runs in **both** modes: `phase` and `type` against the profile, the issue-scoped rule, the outcome rule, and the `agent-dispatch` / `runner-identity` / token / effort payload shapes |
| Issue-scoped rule | The one rule this slice moves into the core: a `type` listed in `profile.issue_scoped_types` must carry an `issue` that is not `undefined`, `null` or `""` |
| Write core | `appendRecordUnderLock` (`events.js:611-628`), the single-record wrapper over the batch core. Every `events.jsonl` write passes through it |
| Unchecked path | A condition under which the core writes a record with no vocabulary check: a non-delivery active profile, or an unavailable schema bundle |

### The write core's shape after this change

```
PROCEDURE append_record_under_lock(dir, mintRecord, opts):
  # resolved BEFORE the lock, exactly once per append
  1. profile := active_profile()                              # may throw GovernanceProfileError
  2. check   := log_record_checker("events.jsonl", profile)   # null under a non-delivery profile

  3. take the append lock, and for the one record:
     a. record := mintRecord(seq, prevRecord, prevHash, profile)   # profile is added at the end; callbacks may ignore it
     b. IF record is null: abort the batch, write nothing, return null
     c. issue_violations := issue_scoped_violations(record, profile)
     d. payload_violations := []
        IF check is not null:
          result := check(record)
          IF result.unavailable: remember it for the note after the lock
          ELSE payload_violations := result.violations
     e. IF issue_violations OR payload_violations are non-empty:
          THROW EVENT_SCHEMA with violations = issue_violations ++ payload_violations
     f. write the record

  4. IF an unavailable schema was remembered:
       note it in the run dir and call opts.onSchemaUnavailable

  CONSTRAINT no profile is resolved inside the lock, by either half or by any mint
             callback; a callback that needs a profile takes it from the parameter in (a)
  CONSTRAINT the null-record abort at (b) happens before any check
  CONSTRAINT step (c) runs whether or not `check` is null
  CONSTRAINT step (c) applies the issue-scoped rule ONLY, never the phase,
             type, outcome or payload-shape rules
```

`issue_scoped_violations` is the extracted single home of the rule. It is a predicate over a record and a resolved profile, and it returns the same violation string `eventViolations` produces today (`type '<t>' is issue-scoped but missing required field 'issue'`). `eventViolations` calls it in place of its inline check. The rule then has one implementation, and its string cannot drift between the writer and the file validator, which FAFF-1261's gate also uses.

`eventViolations` calls the predicate at the position the inline check holds today (`events.js:209-210`): after the `phase` and `type` checks (`:203-208`) and before the outcome check. `faff events append` prints one stderr line per violation in that order, so keeping the position keeps the order of violation strings, and the file validator's output over the committed corpus stays byte-identical.

**Anti-pattern:** calling `eventViolations(record, true, profile)` from the core. Why: the vocabulary rules run in both modes, so the core would apply the active dialect's whole `event_phases` / `event_types` vocabulary and payload shapes to records the chain writes for itself. Under any override that does not name them, it would refuse `run-start`, `ledger-write`, `sentry-trip`, `run-resume` and `run-claim-abandoned`, and no shipped override names them.

**Anti-pattern:** calling a check from inside the mint callback and letting its profile parameter default. Why: under `$FAFF_GOVERNANCE_PROFILE` that means a file read, parse and shape check for every record inside the append lock. It can also throw `GovernanceProfileError` at a point where every caller catches only `EVENTS_LOCKED` and `EVENT_SCHEMA`.

**Anti-pattern:** putting the issue-scoped check inside the `if (check)` guard or inside the `unavailable` else-branch. Why: those are the two unchecked paths. A check inside either leaves the defect reachable under a profile override or a missing bundle, and preventing that is the reason this slice exists.

### Decision — the schema constraint does not ship in this slice

Round 2 decided to ship both halves: the write-core rule, plus `"pattern": "."` on the envelope `issue` of the thirteen issue-scoped types across both schema trees. **The operator overturned that on 2026-10-20.** This is a scope decision made by a person, not a design judgement the producer made, and it is recorded here so that no later round or build pass reopens it.

The operator gave three reasons, each checked in the tree:

- **The schema half enforces nothing FAFF-1261's gate lacks.** The gate always runs the `events.jsonl` line validator next to the schema check and reports both sets of violations. That line validator is `eventViolations(rec, true)`, which already rejects `issue: ""`. The full trace is under "The FAFF-1261 edge" in WHY.
- **The schema half was the only part exposed to the v0.3 freeze.** PR #1086 adds ADR-0141 (Status: Proposed). Once it lands, "any other change to a v0.3 schema needs a new minor version" (line 35); only changes that `classifySchemaChange` classifies as additive may land in place. Round 2 measured this change as `additive: false`. It could have landed in v0.3 in place only if it merged before #1086, and nothing enforced that order. #1086 is open and `MERGEABLE`, its ticket carries `faff-automate`, and the merge gate's dependency interlock (FAFF-1077, `merge-gate.js:53`) binds only a PR stacked on its dependency's PR, which #1086 is not.
- **House precedent.** ADR-0141 line 54 records that FAFF-1261 faced this exact tension for `ac_id` and chose a writer rule over a non-additive schema change. This slice does the same for `issue`.

**Chosen:** ship the writer rule only, by operator decision of 2026-10-20. This slice changes no file under `verification/evidence/v0.3/` or `plugin/skills/faff/contracts/evidence-v0.3/`, and does not touch `scripts/evidence-v0.3-compose.mjs`. Leaving the schema trees alone keeps the ADR-0141 freeze irrelevant to this slice. The schema constraint is in OUT OF SCOPE, with what a follow-up would cost.

### Decision — how much of `eventViolations` the core enforces

This is the slice's central design decision. The round-1 draft got it wrong by running full envelope mode every time.

The vocabulary rules are `phase` and `type` against `profile.event_phases` / `profile.event_types`, the outcome rule, and the `agent-dispatch` / `runner-identity` payload shapes. They run in both modes, outside the `requireEnvelope` guard (`events.js:203` onward). A profile is a dialect with no constraint on its contents: `validateProfileShape` only requires an array of strings for each declared key, and the shipped `SECOND_PROFILE` is deliberately disjoint from delivery. A full `eventViolations` call at the core would therefore make the chain's own structural writes conform to the active dialect. Under `SECOND_PROFILE`, or any override like it, each of these would throw `EVENT_SCHEMA` mid-run:

- `emitGenesisRunStart`'s `run-start` (phase `run`, `events.js:702-705`)
- heartbeat's `ledger-write` fold
- `run-ledger.js`'s `sentry-trip` (`:315`, `:443`)
- `lights-out.js`'s `run-resume` (`:1400`)
- `resumecheck.js`'s `run-claim-abandoned` (`:176`)

Today those writes go through with no check, because `logRecordChecker` returns null and `if (!record || !check) return record` at `events.js:617` skips everything. If the heartbeat fold's failure were swallowed, the chain would silently lose its `ledger-write` links, and the ledger-fold integrity check would degrade for every later `events verify`.

Three shapes were available:

- Run the active dialect's whole vocabulary at the core. Rejected above.
- Check the structural vocabulary against `DELIVERY_PROFILE` and the issue-scoped rule against the active profile. This is worse: it resolves two profiles per append, gives the append two sources of truth, and refuses `SECOND_PROFILE`'s own legitimate `job-start` writes against delivery's type list.
- Declare that every override must contain delivery's vocabulary, and enforce that in `validateProfileShape`. That changes the governance model, and the shipped `SECOND_PROFILE` fixture exists precisely to be disjoint. It belongs to whoever owns the profile contract, not to a writer fix.
- Key the issue-scoped rule to `DELIVERY_PROFILE` instead of the active profile. Spec review raised this in round 2, so that an override which does not declare `decision-capture` issue-scoped could not let `issue: ""` through. The operator rejected it on 2026-10-20, for three reasons:
  - It recreates writer/validator drift, which is the property the one-implementation extraction exists to buy. The file validator reads the active profile, so under a dialect that names a type without declaring it issue-scoped, the writer would refuse rows the file validator accepts.
  - It drops a disjoint dialect's own issue rule at the writer. `SECOND_PROFILE` declares `job-start`, `job-end` and `job-outcome` issue-scoped, and a delivery-keyed core would stop enforcing that.
  - It buys no protection the gate lacks. Under a disjoint dialect such as `SECOND_PROFILE`, FAFF-1261's gate already refuses every anchor at the genesis row: `eventViolations(rec, true)` with that profile rejects the genesis `run-start` on `phase` and `type`, and rejects the `decision-capture` row on `type`.

**Chosen:** the core enforces the issue-scoped rule alone, through an extracted `issueScopedViolations(record, profile)` predicate that `eventViolations` also calls. One implementation serves the writer, the file validator and FAFF-1261's gate. It refuses the measured defect on the default path and the unavailable-bundle path unconditionally, and on the override path for any dialect that declares the type issue-scoped. Under a dialect that does not declare a type issue-scoped, an empty `issue` on that type is legal in that dialect, and the writer and the file validator agree that it is. Every structural write still goes through under every dialect, because no shipped or synthetic profile lists a structural type in `issue_scoped_types`. The dialect question stays with the file-level and CLI-level callers of `eventViolations`, which apply the whole vocabulary as they do today.

### Decision — where the profile is resolved and how it reaches the check

Three shapes were available. Resolving the profile inside the mint callback breaks the once-per-append principle above. Resolving it once in `appendRecordUnderLock` while `logRecordChecker` keeps resolving its own costs two file reads per append under an override instead of one. It also leaves two answers to "which profile is this append validated against", and that is a real hazard: `logRecordChecker` compares by identity (`activeProfile() !== DELIVERY_PROFILE`), so a change to the environment mid-append would make the two halves disagree. Resolving once and passing the result to both costs one defaulted parameter added at the end of a helper with three callers: `events.js:613`, plus `effects.js:713` and `commissaire.js:165`, which both write `declared-effects.jsonl` and stay unedited and byte-identical.

**Chosen:** `appendRecordUnderLock` calls `activeProfile()` once, before the lock, and passes the result to both halves: to `issueScopedViolations`, and to a new trailing defaulted `profile` parameter on `logRecordChecker`. This follows the FAFF-362 pattern. It gives each append one profile resolution and one source of truth, and under the default profile it does no I/O at all, because `activeProfile` returns `DELIVERY_PROFILE` without touching the filesystem when the override is unset. It adds no new way for an error to escape the callers' handling. `appendRecordUnderLock` already calls `logRecordChecker` at `events.js:613`, before the lock, and that function begins with `activeProfile()` (`evidence.js:212`). A bad override therefore already throws `GovernanceProfileError` from this point, at this moment, today.

### Decision — one combined refusal or two in sequence

The parent spec said to "raise `EVENT_SCHEMA` with the combined violations when either fails" without asking whether combining was needed. It is not needed for correctness: the record is refused either way and nothing is written. It is needed for the operator, because `faff events append` prints one stderr line for each entry in `e.violations` and exits 1 (`events.js:1193-1198`). With two refusals in sequence, an operator would fix the issue field and then meet a payload violation on the next run.

**Chosen:** one `EVENT_SCHEMA` throw, raised after both halves have run. Its `violations` list holds the issue-scoped violation first, then the payload violations, all as plain message strings. The error keeps its existing `code`, message prefix and `violations` array shape. `test/evidence-payload-writers.test.mjs:69` checks `e.code` and iterates `e.violations`, and `events.js:1196`, `self-intake.js:189-195` and `contain.js:185-191` all depend on that shape.

### Decision — what happens to the `faff events append` CLI pre-check

The parent spec called this a duplicate kept for its test coverage. It is not a duplicate. The CLI pre-check is `eventViolations(payload, false)` at `events.js:1079`: payload mode, run on the object the operator supplied, before any envelope exists and before the lock. The core's new check applies one rule to the minted record. They check different objects against different rule sets.

**Chosen:** keep the CLI pre-check unchanged, and drop the parent spec's "duplicate" framing. The pre-check refuses a bad payload before the lock is taken or a run directory is touched. It produces the per-violation stderr lines and the exit 1 that `test/events.test.mjs:139` and `:244` check. It is also where the active dialect's full vocabulary meets operator input, which the narrowed core deliberately does not check. Removing it would move the refusal of an operator typo from before any locking to inside the lock.

### Decision — the in-lock pre-check in `corrective.js`

`corrective.js:373` calls `eventViolations(record, true)` inside the mint callback passed at `:369`, inside the lock, and lets the profile default. That is the per-record in-lock resolution this slice forbids. It already ships, and the ticket does not mention it. The probe below confirms it at `HEAD`: under an override, the override file is read while `events.jsonl.lock` exists. Round 1 proposed deleting the call and relying on the core. That no longer works. The narrowed core checks one rule, so deleting the call would drop full-vocabulary checking for `corrective-authored` / `corrective-consumed` records. That would reduce checking in a slice whose purpose is to add it.

**Chosen:** keep the full `eventViolations` call where it is and change only where its profile comes from. The write core passes its already-resolved profile to the mint callback as an extra trailing parameter, and `corrective.js`'s callback hands that profile to `eventViolations` instead of letting it default. The per-record read, parse and shape check inside the lock goes away; checking stays the same; and each append keeps exactly one profile resolution. Every other mint callback ignores the new parameter, so the other seven call sites stay byte-identical. Callers see the same behaviour as before. A bad override still raises `GovernanceProfileError` out of `faff corrective author` (`sentryThresholds` throws it earlier in that verb, before any append). A vocabulary violation still makes the mint callback return `null`, and the core's null-record abort happens before either of its own checks can add a string.

Passing the profile through the callback is preferred over having `corrective.js` call `activeProfile()` itself. That would also work: `corrective.js` is `region:factory` (`:2`), and factory→governance is a legal require edge (ADR-0042, restated at `regions.js:125`). But it adds a require edge and a second resolution site for no gain. The core already holds the one resolved profile, and it is the module responsible for everything inside its lock.

**Agreed fallback (operator, 2026-10-20):** the `corrective.js` threading is the slice's pre-agreed split point. If the build stalls on the corrective lock-ordering probe, that change and its probe come out as their own ticket, and this slice ships the write-core rule without them.

### Decision — whitespace-only and newline-only `issue` values

The issue-scoped rule treats only `undefined`, `null` and `""` as missing. `issue: " "` and `issue: "\n"` therefore pass it everywhere: at the write core after this change, in `faff events validate`, in the CLI pre-check, and at FAFF-1261's gate. With no schema change in this slice, the bare `{"type":"string"}` envelope accepts them too. This slice does not change that. (Round 2 framed the gap as newline-only and caught by the schema half. That framing depended on the schema change, which no longer ships.)

**Chosen:** add no trimming, and record whitespace-only issues as a known, bounded gap. The rule's one implementation is reached by `eventViolations`, which `LINE_VALIDATORS` (`evidence.js:47-48`) runs over every historical `events.jsonl` row. Treating whitespace as missing would change what file validation accepts across the whole committed corpus, which does not belong in a writer fix. The gap is also unreachable from the defect's own path: `captureDecisionCore` passes either a resolved issue or `""` (`decision-capture.js:462`), never whitespace. The gap is listed in OUT OF SCOPE with its extension point, so a future ticket can take it on with the corpus question in view.

## 5. HOW — behaviour

### The callers of the write core

The parent spec's list of callers was incomplete, so this slice lists them. Every direct caller of `appendRecordUnderLock`, found by searching `plugin/skills/faff/bin/lib/`, comes to **eight call sites**:

| Caller | Event minted |
|---|---|
| `events.js:676` (`appendEventRecord`) | Any type, from the caller's payload |
| `events.js:702` (`emitGenesisRunStart`) | `run-start`; the parent spec's list left this caller out |
| `corrective.js:369` | `corrective-authored` / `corrective-consumed` |
| `lights-out.js:1400` | `run-resume` |
| `resumecheck.js:176` | `run-claim-abandoned` |
| `run-ledger.js:315` | `sentry-trip` |
| `run-ledger.js:443` | `sentry-trip`, the second trip site |
| `run-ledger.js:768` | `run-start`, in the selftest path |

Two of the eight mint an issue-scoped type, and the new check treats them differently:

- `appendEventRecord` (`events.js:676`) stamps whatever `payload.issue` its caller supplies, and omits the key when that is `undefined`. The defect arrives through this site, and the new check refuses it here.
- `corrective.js:369` mints `corrective-authored` / `corrective-consumed`, which are both in delivery's `issue_scoped_types`. It cannot reach the core's check with an empty issue: its own `eventViolations` call already applies the same rule and returns `null`, which aborts the batch before the core checks anything. The only change at this site is where its profile comes from.

The other five sites mint fixed structural types: `run-start` (`events.js:702`, `run-ledger.js:768`), `run-resume`, `run-claim-abandoned` and `sentry-trip`. None of those four types appears in any shipped or synthetic profile's `issue_scoped_types`, so the new check refuses none of them under any dialect. That is what the narrow scope buys. Under a disjoint dialect, the narrowed check reads these records' types, finds them absent from `issue_scoped_types`, and returns no violation. Full envelope mode would have refused all five on `phase` and `type`.

The batch core `appendRecordsUnderLock` has four direct callers that bypass the single-record core: `effects.js:715` and `commissaire.js:205`, `:220` and `:275`. All four write `declared-effects.jsonl`, not `events.jsonl`. The claim that every `events.jsonl` write passes through `appendRecordUnderLock` therefore holds after checking the batch core too. It also means there is no multi-record `events.jsonl` append to test against: `appendRecordUnderLock` fixes the batch size at 1 (`events.js:615`). A criterion that tries to tell once-per-append from once-per-record by appending two records in one batch cannot be built. That is why the profile criteria below test lock ordering instead.

### The envelope-mode rules are untouched

The narrowed core never runs envelope mode. The chain-envelope checks and the `ledger-write` ledger-hash rule are reached from exactly the callers that reach them today. `faff events append`'s payload-mode pre-check never saw them, and nothing new does either. Both `ledger-write` producers satisfy the rule anyway: `heartbeat.js:247` computes the hash before the append at `:252`, and the `faff events append` path adds it at `events.js:1183` after reading `run-ledger.json` and before minting.

### The comment on the write core

FAFF-1260's comment on `appendRecordUnderLock` (`events.js:607-610`) says an unavailable bundle "degrades the write to eventViolations alone". That is false at `HEAD`, where the write then goes through with no check, and it stays false after this change, where the core applies the issue-scoped rule only. The edit to `appendRecordUnderLock` corrects that comment to say what the core does: it resolves the profile once before the lock, applies the issue-scoped rule to every minted record, and applies the payload check only when `logRecordChecker` returns a check and the bundle is available.

### The two other issue-scoped writers already handle a refusal

Both reach the core through `appendEventRecord`, and each already handles a throw from the core the way its own durability needs, so neither needs an edit. Neither can trip the new rule through its own input: `record-outcome` refuses an `--issue` that fails `ISSUE_ID_RE` before it writes anything (`run-ledger.js:574`), and the terminal-only writer passes an issue that `guardWriterPaths` has already checked against the same pattern (`evidence.js:551`). Both are already refusable at `HEAD` by the payload half, which FAFF-1260 added. Their criteria below are regression guards on the restructured throw site, not tests of the new rule: this slice rewrites the `if (!record || !check) return record` short-circuit and the throw in `appendRecordUnderLock`, and a build that lost the payload throw would break both catch paths. They pass at `HEAD`, by design.

`run-ledger.js:631` appends an `issue-outcome` inside a try/catch that warns on stderr and continues, because the durable ledger write above it must not be undone by a fault in the chain append (`:632-634`). A refusal there leaves the ledger written and tells the operator.

`evidence.js:827` appends an `evidence-terminal-only` inside a try/catch that raises `WriterFault("cannot append the evidence-terminal-only event; nothing written")`, because that writer is all-or-nothing. A refusal there writes no `review-verdict.json`.

Both behaviours are acceptance criteria rather than inferences, because these are the two issue-scoped writers whose error paths depend on the core's throw. A test makes the core refuse each one with the house trigger for a core refusal from a best-effort caller (`test/evidence-payload-writers.test.mjs:260`, `:294`): a `pluginCopy` whose `run-event.schema.json` adds a data key the writer never sends to that type's `required` list, driven through the copy's own `bin/faff`. That reaches the core's `EVENT_SCHEMA` throw through the real writer, needs no production edit, and was checked at `HEAD` for both writers.

### What the capture path does on refusal

`captureDecisionCore` catches the `EVENT_SCHEMA` throw at `decision-capture.js:483-484`, passes it to `bestEffortFail` with the message `journal append failed: …`, and returns. `captureDecision` swallows anything that escapes (`:489-491`). The kernel's exit code, stdout and verdict do not change, and `events.jsonl` gains no row. For the defect's own reproduction, that is everything this slice changes: the refusal is correct and quiet. FAFF-1354 makes it readable.

### Failure modes

**A dialect declares a structural type issue-scoped.** Nothing in `validateProfileShape` stops an override from listing `run-start` in `issue_scoped_types`. The narrowed core would then refuse `emitGenesisRunStart` for a record that rightly carries no issue. How you would know: a run under that override fails at genesis with `EVENT_SCHEMA` naming the issue-scoped rule, before any work starts. The failure is loud, immediate and at the first write, not mid-run. What it means: proceed. The override is asking for the refusal, and this is the narrowest, earliest-failing form of the problem. The alternative, checking nothing under an override, is the defect this slice closes. No shipped or synthetic profile lists a structural type this way.

**The new check refuses a producer nobody listed.** The caller list above holds direct callers found by name, so a caller reached through an alias or dynamic dispatch would be missed. How you would know: the suite under `test/*.test.mjs` fails with `EVENT_SCHEMA` on a path this spec never names, rather than on the refusal criteria below. What it means: narrow. Supply the producer's missing `issue` where it mints, and never weaken the core check to let it through.

**The profile is passed through, but something still resolves it inside the lock.** With the batch size fixed at 1, counting reads cannot tell once-per-append from once-per-record. How you would know: the two lock-ordering probes below, one through `appendEventRecord` and one through `faff corrective author`, each record whether `<run dir>/events.jsonl.lock` exists at every read of the override file. The lock is an atomic `wx` create, released in a `finally` (`events.js:10`, `:503`), so the lock file's presence at the moment of a read is a true test of "inside the lock". `activeProfile` is not memoized, so a cache cannot hide a second read. At `HEAD`, the corrective probe records three reads, the third one with the lock present and coming from `corrective.js:373`, so the probe can fail and does fail today. What it means: narrow. Find the call that lets the profile default and pass the profile through to it, as the `corrective.js` decision above does.

**A reader takes the dropped schema half as a gap in FAFF-1261's enforcement.** How you would know: a review or a later spec claims that anchors with `issue: ""` pass FAFF-1261's gate because the envelope `issue` is a bare string. What it means: proceed. The gate's line validator is mandatory and already refuses them (see the FAFF-1261 edge in WHY). The fix to that claim is a citation, not a schema change.

## 6. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run directory whose events.jsonl holds a genesis run-start row
When a caller appends a decision-capture record with issue: ""
Then appendEventRecord throws EVENT_SCHEMA naming the issue-scoped violation
  And events.jsonl is byte-identical to its contents before the call
```

```
Given a run directory and a $FAFF_GOVERNANCE_PROFILE override whose
  event_phases and event_types are disjoint from the delivery vocabulary
When emitGenesisRunStart mints the genesis run-start for that run directory
Then the append succeeds and events.jsonl gains the run-start row
```

```
Given a run directory with a run-ledger.json and a $FAFF_GOVERNANCE_PROFILE
  override pointing at a JSON copy of the delivery profile
When faff corrective author records a park-with-cause corrective for that run
Then no read of the override file happens while <run dir>/events.jsonl.lock exists
  And events.jsonl gains the corrective-authored row
```

```
Given a git repo with capture.decision_kernel on, and a run directory whose
  events.jsonl holds a genesis run-start row
When a per-issue gate kernel runs with $FAFF_RUN_DIR set and neither
  FAFF_DECISION_CORRELATION_ID nor FAFF_DECISION_ISSUE exported
Then the kernel prints its verdict and exits 0
  And events.jsonl gains no decision-capture row
  And `faff events validate --file <that events.jsonl>` exits 0
```

- The issue-scoped rule MUST have exactly one implementation in the tree, called by both `eventViolations` and the write core.
- No profile MUST be resolved while `events.jsonl.lock` is held, by either validation half or by any mint callback.
- This slice MUST change no file under `verification/evidence/v0.3/` or `plugin/skills/faff/contracts/evidence-v0.3/`, and MUST NOT touch `scripts/evidence-v0.3-compose.mjs`.

## 7. Design decision rationale

**Does the schema constraint ship in this slice?** Options: both halves (round 2's choice); the writer rule only. **Chosen:** the writer rule only, by operator decision of 2026-10-20, which overturns round 2. The schema half adds no enforcement to FAFF-1261's gate, whose mandatory `events.jsonl` line validator already rejects `issue: ""`. It was the only part exposed to the ADR-0141 freeze, and nothing enforced the merge order that would have kept it in v0.3 in place. ADR-0141 line 54 already records the same choice for `ac_id`. Round 2's claim that the schema half was the one satisfying the FAFF-1261 edge was wrong; the write-core half satisfies it.

**How much of `eventViolations` does the core enforce?** Options:

- The whole function in envelope mode. Under any dialect that does not name them, it refuses the chain's own structural writes, because the phase, type, outcome and payload-shape rules run outside the `requireEnvelope` guard and `SECOND_PROFILE` shows a dialect may be fully disjoint.
- The structural vocabulary against `DELIVERY_PROFILE` and the issue-scoped rule against the active profile. Two resolutions and two sources of truth per append, and it refuses a disjoint dialect's own legitimate writes.
- Require every override to contain delivery's vocabulary, enforced in `validateProfileShape`. A governance-contract change, contradicted by the shipped disjoint `SECOND_PROFILE` fixture, and not a writer fix's call.
- The issue-scoped rule alone, keyed to `DELIVERY_PROFILE` rather than the active profile. Raised by spec review in round 2 and rejected by the operator on 2026-10-20. The writer would refuse rows the active-profile file validator accepts, which is the drift the extraction removes; it would stop enforcing a disjoint dialect's own issue rule, such as `SECOND_PROFILE`'s `job-*` types; and it adds no protection, because under a disjoint dialect FAFF-1261's gate already refuses every anchor at the genesis `run-start`.
- The issue-scoped rule alone, keyed to the active profile, extracted so `eventViolations` and the core share one implementation.

**Chosen:** the issue-scoped rule alone, keyed to the active profile. It refuses the measured defect on the default and unavailable-bundle paths unconditionally and on the override path wherever the dialect declares the type issue-scoped, lets every structural write through under every dialect, keeps the core's blast radius equal to the rule the ticket names, and leaves the full vocabulary with the file-level and CLI-level callers that apply it today.

**Where is the governance profile resolved, and how does it reach the check?** Options:

- Inside the mint callback, with a defaulted parameter. A file read, parse and shape check per record inside the lock, and a `GovernanceProfileError` that escapes the callers' error handling.
- Once in the core, with `logRecordChecker` resolving its own. Two reads per append under an override, and two sources of truth that can disagree if the environment changes mid-append.
- Once in the core, passed to both halves.

**Chosen:** once in the core, passed to `issueScopedViolations` and to a new trailing defaulted `profile` parameter on `logRecordChecker`. One resolution, one source of truth, no I/O under the default profile, no edits to the two `declared-effects.jsonl` callers, and no new error escape, since `logRecordChecker` already resolves the profile from this call site, before the lock, today.

**One combined refusal or two?** Options: throw as soon as either half fails (simpler control flow, but an operator who fixes the issue field then meets a payload fault on the next run); run both halves and combine. **Chosen:** combine, issue-scoped violation first, in one `EVENT_SCHEMA` whose `code`, message prefix and plain-string `violations` array are unchanged. `faff events append` prints one line per violation, and three call sites plus one test depend on that shape.

**Keep or drop the `faff events append` pre-check?** Options: drop it as a duplicate of the core check; keep it. **Chosen:** keep it, and drop the parent spec's "duplicate" framing. It runs payload mode on the operator's object before the lock, not one rule on a minted record inside it. It is where the active dialect's full vocabulary meets operator input. Dropping it would move the refusal of an operator typo from before any locking to inside the lock.

**What happens to `corrective.js`'s own in-lock pre-check?** Options:

- Delete it and rely on the core. This was round 1's answer, and it no longer holds: the narrowed core checks one rule, so deleting the call would silently drop full-vocabulary checking for `corrective-*` records.
- Leave it exactly as it is. It keeps the per-record in-lock resolution this spec forbids, and the probe shows it at `HEAD`.
- Keep the check and have `corrective.js` resolve the profile itself before the lock. Legal, but it adds a require edge and a second resolution site.
- Keep the check and have the core pass its resolved profile to the mint callback as an extra trailing parameter.

**Chosen:** keep the check and pass the profile through the callback. The forbidden in-lock resolution goes away, checking stays the same, each append keeps one resolution, and the seven other mint callbacks ignore the new parameter and stay byte-identical. The corrective lock-ordering probe makes this the one site where the threading decision has a test that can fail.

**Should the issue-scoped rule treat whitespace as missing?** Options: trim, so `" "` and `"\n"` count as missing; do not trim. **Chosen:** do not trim. The rule's one implementation is reached by `eventViolations`, the line validator for the whole committed corpus (`evidence.js:47-48`), so trimming would change what file validation accepts for every historical row. That is a corpus-wide behaviour change, and it has no place in a writer fix. At the time of writing, no caller passes a whitespace-only issue, and the capture path passes a resolved issue or `""`. The gap is listed in OUT OF SCOPE with its extension point.

## 8. Open questions and assumptions

**Open questions.** None. Every decision this slice faced is closed above. The scope question is closed by the operator's decision of 2026-10-20. One governance-contract question came up: should every override be required to contain delivery's vocabulary? It is declined as out of scope rather than left open, because the shipped disjoint `SECOND_PROFILE` fixture makes that requirement a contract change that no writer fix should carry.

**Assumptions.** None that need checking before build. The claims this spec rests on were each checked in the tree at `HEAD` `ba922f21`, or on PR #1086's head `7ecf6de8` where stated:

- the vocabulary rules run outside the `requireEnvelope` guard
- `validateProfileShape` checks shape but never contents, and `SECOND_PROFILE` is disjoint from delivery
- `activeProfile` reads the override file on every call and does no I/O under the default profile
- the eight core call sites, and which two of them mint an issue-scoped type
- both `ledger-write` producers satisfy the hash rule
- the batch size is fixed at 1
- the lock is a `wx`-created file released in a `finally`
- the corrective probe's three reads at `HEAD`, the third under the lock, and `sentryThresholds`' read before the append
- `faff corrective author` reports `event_appended: false` under a `SECOND_PROFILE`-shaped override
- on PR #1086, `validateJsonlFile` combines the schema check with a mandatory line validator
- ADR-0141's lines 35, 51 and 54
- under `SECOND_PROFILE`, `eventViolations(rec, true)` rejects the genesis `run-start` on `phase` and `type`, and a `decision-capture` row on `type`
- `record-outcome` and the terminal-only writer both check the issue against `ISSUE_ID_RE` before appending, and the `pluginCopy` trigger reaches each writer's handler at `HEAD`

## 9. DONE — definition of done

### From WHY (the defect is closed)

- [ ] Appending a `decision-capture` record with `issue: ""` through `appendEventRecord` throws `EVENT_SCHEMA`, its violations name the issue-scoped rule, and `events.jsonl` is byte-identical before and after the call.
- [ ] The same append is refused, with `events.jsonl` byte-identical, when `$FAFF_GOVERNANCE_PROFILE` points at a shape-valid profile file whose `issue_scoped_types` includes the type. The path where `logRecordChecker` returns null no longer lets the row through.
- [ ] The same append is refused, with `events.jsonl` byte-identical, when the schema bundle is unavailable, set up the way `test/evidence-payload-writers.test.mjs:191` does it with `pluginCopy` plus `mintRun`. The `evidence-schema-unavailable.json` marker and stderr line do not let the write through.

### From WHAT (scope)

- [ ] `git diff` against the base names no file under `verification/evidence/v0.3/` or `plugin/skills/faff/contracts/evidence-v0.3/`, and does not name `scripts/evidence-v0.3-compose.mjs`.
- [ ] The issue-scoped rule exists once in the tree, as a predicate over a record and a resolved profile, called by both `eventViolations` and the write core. No second copy of its violation string exists in production code under `plugin/skills/faff/bin/lib/` (`EVENT_ISSUE_SCOPED` at `events.js:96` is a delivery-keyed set used only by `test/park-reconsider.test.mjs:190`; it carries no violation string and is not a second implementation). `eventViolations` calls it after the `phase` and `type` checks and before the outcome check, so for every `events.jsonl` tracked in git (`git ls-files '*events.jsonl'`, 420 files at `HEAD`, mostly under `.faff/anchors/`), `faff events validate --file`, run with `$FAFF_GOVERNANCE_PROFILE` unset, prints byte-identical stdout and stderr, and exits with the same code, before and after the change.
- [ ] Under a `$FAFF_GOVERNANCE_PROFILE` override whose `event_phases` and `event_types` are disjoint from delivery's, `emitGenesisRunStart` still appends its `run-start`, and `faff run-ledger init-interactive` refused with exit 3 because a live L3/L4 run is already resolved (the `sentry-trip` site at `run-ledger.js:315`) still appends its `sentry-trip` row to that live run's `events.jsonl`. That append sits in a best-effort `catch`, so the exit code alone proves nothing: the criterion is the row's presence. Neither write throws `EVENT_SCHEMA`. The core refuses no record over a phase or type its dialect does not name.
- [ ] Under that same override, the core still accepts a `ledger-write` record with no `data.ledger_sha256`, because the core never runs envelope mode. That rule stays enforced only where it is enforced today.

### From WHAT (profile resolution)

- [ ] During one in-process `appendEventRecord` call under a `$FAFF_GOVERNANCE_PROFILE` override, the override file is read exactly once, and `<run dir>/events.jsonl.lock` does not exist at the moment of that read.
- [ ] During one in-process `cmdCorrectiveAuthor` call (`faff corrective author --op park-with-cause --cites-signal scope-drift --issue FAFF-1 --cause "probe" --run-dir <R>`; `--issue` is required at `corrective.js:431` and `park-with-cause` needs a non-empty `--cause` at `:435`) under a `$FAFF_GOVERNANCE_PROFILE` override pointing at a JSON copy of `DELIVERY_PROFILE`:
  - `<run dir>/events.jsonl.lock` does not exist at any read of the override file.
  - The override file is read exactly twice: once by `sentryThresholds` before the append, and once by the write core before the lock.
  - The verb reports `event_appended: true`.

  At `HEAD` the same probe records three reads, the third with the lock present, so this criterion fails if `corrective.js` keeps letting its profile default.
- [ ] With `$FAFF_GOVERNANCE_PROFILE` pointing at an unreadable or malformed file, `appendEventRecord` throws `GovernanceProfileError` and writes nothing, as that call site does today.

### From WHAT (the refusal's shape)

- [ ] A record that fails both halves raises one `EVENT_SCHEMA`. Its `violations` array holds the issue-scoped violation followed by the payload violations, all plain strings, and its `code` and message prefix are unchanged.
- [ ] `faff events append` of `{"phase":"build","type":"build-start"}` with no `issue` still exits 1, prints one stderr line per violation, and creates no `events.jsonl`. `test/events.test.mjs:139` and `:244` pass without modification.

### From HOW (callers)

- [ ] All eight `appendRecordUnderLock` call sites, `emitGenesisRunStart` included, still append under the default profile. No existing `test/*.test.mjs` file fails with `EVENT_SCHEMA` on a path that passed before. The diff leaves the seven mint callbacks other than `corrective.js`'s unchanged.
- [ ] The comment above `appendRecordUnderLock` no longer says an unavailable bundle "degrades the write to eventViolations alone". It states that the issue-scoped rule runs on every minted record, and that an unavailable bundle or a non-delivery profile skips only the payload check.
- [ ] Under a `$FAFF_GOVERNANCE_PROFILE` override shaped like `SECOND_PROFILE`, `faff corrective author --json` still writes its artifact and reports `event_appended: false`, and `events.jsonl` gains no `corrective-authored` row. The retained in-mint `eventViolations` call still refuses the record against the override's type list, as it does at `HEAD`.

### From HOW (the two other issue-scoped writers)

- [ ] Using a `pluginCopy` whose `run-event.schema.json` adds `probe_required` to the `issue-outcome` mapping's `data.required`, run the copy's `faff run-ledger record-outcome --issue FAFF-1 --outcome shipped --run-dir <R>` against a run minted with `run-ledger init-interactive --issue FAFF-1`. The core refuses the `issue-outcome` append, `run-ledger.json` holds the new outcome, the stderr line names the refusal and ends `the ledger IS written`, the verb exits 0 as it does on success, and `events.jsonl` gains no `issue-outcome` row.
- [ ] Using a `pluginCopy` whose `run-event.schema.json` adds `probe_required` to the `evidence-terminal-only` mapping's `data.required`, run the copy's `faff evidence write review-verdict --terminal-only --run-dir <R> --issue ISSUE-1` with `{"signal":"pass","findings":[]}` on stdin, from a fixture built like `test/evidence-write.test.mjs`'s. The verb exits 2, stderr carries `cannot append the evidence-terminal-only event; nothing written`, no `review-verdict.json` is written, and `events.jsonl` is byte-identical before and after.

### From HOW (the in-kernel regression)

- [ ] In a scratch git repo with `capture.decision_kernel: on` and a genesis `run-start` minted via `faff events append`, run `FAFF_RUN_DIR=<abs run dir> faff next --status todo --spec high` with neither `FAFF_DECISION_CORRELATION_ID` nor `FAFF_DECISION_ISSUE` exported. `faff next` exits 0 and prints its verdict, `events.jsonl` gains no `decision-capture` row, and `faff events validate --file <that events.jsonl>` exits 0.

### Test homes

New assertions go in `test/*.test.mjs` at the repository root, using `node:test` with `node:assert/strict` and the house pattern of `execFileSync("node", [CLI, …])` inside a `mkdtemp` root, since `validate.yml` runs one file per `node --test` invocation. The core-writer assertions follow `test/evidence-payload-writers.test.mjs:69`: assert the throw, then byte-compare the file to show nothing was written.

The two profile-resolution probes run in-process. Each requires the library directly and patches `readFileSync` on the `node:fs` module object. That works because `governance-profile.js` looks up `fs.readFileSync` as a property at call time. `activeProfile` itself is destructured at load by `events.js:76` and `evidence.js:29`, so a spy on the module export would not see the calls.

- The corrective probe calls the exported `cmdCorrectiveAuthor`; `appendCorrectiveEvent` is not exported. The probe needs a run directory with `run-ledger.json`, minted the way `mintRun` does with `faff run-ledger init-interactive`. It needs a valid `--cites-signal` from the derailment vocabulary, such as `scope-drift`, plus `--issue`, a non-empty `--cause` and `--run-dir`; without them the verb exits before any append.
- The probe should record lock presence for each read, as well as the total count, and its `readFileSync` patch must count only reads of the override file's path. The discriminating assertion is that no read happens with the lock present. The count of two pins `sentryThresholds`' existing read. If a future change removes that read, the count changes but the lock assertion still holds.
- The disjoint-dialect criteria can reuse `SECOND_PROFILE`'s shape as their override fixture, as `test/profiles.test.mjs` already does.

The in-kernel regression belongs in `test/faff-989-decision-capture-driver.test.mjs`, which already has a case without a correlation id (`:101`). No new assertion belongs in any command's `--selftest`; `faff regions selftest` spawns those, and they are no place for an end-to-end regression.

### Integration smoke test

```
PROCEDURE smoke():
  1. mkdtemp a git repo, write .faffrc.yaml with capture.decision_kernel on
  2. mint a run dir R, then:
       echo '{"phase":"run","type":"run-start"}' | faff events append --run R
  3. FAFF_RUN_DIR=<abs R> faff next --status todo --spec high
       with no FAFF_DECISION_CORRELATION_ID and no FAFF_DECISION_ISSUE
  4. ASSERT exit 0 and a verdict on stdout
  5. ASSERT events.jsonl holds exactly the genesis row, with no decision-capture row
  6. ASSERT `faff events validate --file <R>/events.jsonl` exits 0
  7. ASSERT `faff events verify --run-dir <R>` exits 0, so the chain is intact
```

If that path works, the core refusal, the capture path's best-effort catch, the chain and the file validator are all connected.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

Advisory only; gates nothing, and nothing in it has been written to the tracker. Written fresh against round 3; nothing from earlier rounds is carried forward. Claims checked against `HEAD` `ba922f21` and PR #1086's head `7ecf6de8`.

**No outstanding methodology findings.** Both round-2 `minor`s are closed and verified in the tree.

### Round-2 findings, re-verified

**ADR-0141 and merge order with PR #1086 (principles 6 and 7): closed.** The slice changes no file under either v0.3 schema tree and leaves `scripts/evidence-v0.3-compose.mjs` alone, and a DoD item checks that against `git diff`. The finding's premise was also wrong: on #1086's head `validateJsonlFile` combines the schema check with the line validator (`evidence.js:146`), `loadBundle` throws `SchemaUnavailable` for a jsonl entry with no line validator (`:80`), and `LINE_VALIDATORS["events.jsonl"]` is `eventViolations(rec, true)` (`:49`). `HEAD` already has the same combination at `evidence.js:145` and `:455`, so the gate never depended on the schema half. #1086's hunks do not overlap this slice's edit sites (`eventViolations` around `events.js:169-215`, the write core at `:611-628`, `logRecordChecker` at `evidence.js:205-218`, and `corrective.js`), so merge order no longer matters textually or semantically. Line citations below `events.js:1554` and `evidence.js:428` will shift once #1086 lands; a builder will find them by name.

**The lock-ordering probe did not reach `corrective.js` (principle 7): closed, and the new probe discriminates.** `cmdCorrectiveAuthor` calls `sentryThresholds(cfg)` at `corrective.js:459`, whose default `activeProfile()` reads the override before any append — so "exactly one read" was unbuildable and changing the remedy was correct. The two assertions catch different mistakes:

- **No read while `events.jsonl.lock` exists.** Fails at `HEAD`, because `eventViolations(record, true)` at `:373` runs inside the mint callback passed at `:369` and lets the profile default. It catches the actual defect.
- **Exactly two reads in total.** Fails the rejected alternative, where `corrective.js` resolves the profile itself before the lock — that clears the lock assertion but makes three reads. So the DoD enforces the chosen decision.

The probe is buildable: `governance-profile.js:44` binds `fs` as a module object and calls `fs.readFileSync` at call time (`:316`), and `cmdCorrectiveAuthor` is exported (`corrective.js:773`).

### Right-sizing (principle 4): no issues

About one to two days of work: extract the predicate, one profile resolution per append, three lines in `corrective.js`, and tests. Seventeen DoD items is a lot for that, but each traces to a named path and none adds scope. Dropping the schema half does not change how the slice should be cut. The `corrective.js` change is in principle a separate concern, but without it the slice's own rule that no profile is resolved under the lock would be false on day one — keep it; if review keeps returning to the corrective probe, that is the part that comes out cleanly. Merging with FAFF-1354: no — this slice carries all the prevention value, and between the two slices the refusal is not silent, since `bestEffortFail` (`decision-capture.js:324-333`) already writes a stderr line and a `degraded-capture` log entry.

### Workstream fit (principles 1 and 5): no issues

One outcome under FAFF-1348: new runs stop writing rows that poison every anchor. Everything else is moved to named extension points. The project-less state is known and is not a finding.

### Dependencies (principle 6): no issues

Dropping the schema half leaves no edge unmet that it used to meet.

- **FAFF-1261** stays satisfied by the write-core half; the gate's enforcement never came from the schema. The edge exists for sequencing — shipped first, FAFF-1261's gate would refuse every anchor of every multi-issue run that captures without a correlation id — so keep it.
- **FAFF-1346**'s warn-only check runs the same `validateAnchorDir`, which already combines schema and line validator at `HEAD`; whether that detection refuses is unaffected by any schema constraint.
- **FAFF-1347** needs the fourteen existing rows kept as evidence; round 3 repairs no rows and changes no schema.
- The prose-only waits from FAFF-1346 and FAFF-1347 are the operator's decision and are not re-recommended here.
- No new hidden dependency: the FAFF-1261 trace holds on `HEAD` too, so the slice does not depend on #1086 landing first.

### Risk (principle 7): no issues

The new rule runs on every `events.jsonl` write, contained by its narrow scope; the eight call sites are listed and covered by a DoD item, the full `test/*.test.mjs` run backstops any producer the list missed, and the disjoint-dialect criteria cover the worst case, a structural write refused mid-run. Both other issue-scoped writers have their refusal behaviour as acceptance criteria. The `faff events append` pre-check already applies the rule in payload mode, so operator-facing behaviour does not change.

**One stale comment, for review rather than this lens:** `events.js:609` says an unavailable bundle "degrades the write to eventViolations alone", which is false at `HEAD`. The edit to `appendRecordUnderLock` should correct it.

build-tier: complex
spec-review: accept (operator, 2026-10-20; review round 3 returned revise on two minors, both fixed in spec round 5, no further round)
confidence: high
