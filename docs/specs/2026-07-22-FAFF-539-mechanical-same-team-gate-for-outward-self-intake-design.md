# FAFF-539 — `faff self-intake`: mechanical same-repo/team gate for the outward-self-intake reclassification

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-539.

This spec defines the mechanical primitive that replaces the prose-only same-team check in the FAFF-536 self-hosting intake lane. Audience: the build agent implementing it, and human reviewers checking the trust-boundary reasoning. Governed by ADR-0079 (the sanctioned classification) and the FAFF-354 ancestry-hardening boundary.

## 1. WHY — problem and principles

**The load-bearing model.** The `outward → outward-self-intake` reclassification rests on three legs: the lane is opted in (`containment.self_hosting_intake`), the discovered item's home is the mandate's own tracking team/repo, and the item is `concrete`. Today the first two legs are evaluated by the agent in prose at the filing chokepoint — the very agent the containment floor constrains. This ticket moves those two legs into a deterministic CLI primitive, `faff self-intake`, which **re-derives the self side from committed config on its own** (the agent cannot supply or forge it), compares a caller-supplied target against it fail-closed, and records the verdict for post-hoc audit — the same trust posture `faff contain` + `--record` established under FAFF-354.

**Problem statement.** FAFF-536 shipped the self-intake lane with its same-team check as agent-asserted prose, and the adversarial reviewer's ratified `critical` says a confabulating agent could assert `outward → self-intake` and bypass the containment hard floor. `contain.js` was deliberately kept pure and repo-blind, so the check cannot live there. This ticket adds the separate verified primitive so genuine same-repo self-hosting discoveries still auto-file while unverified claims stay `outward-new-root`, hard-floored.

**Design principles.**

- **The self side is never caller-suppliable.** There is no `--self` flag. The primitive reads `containment.self_hosting_intake`, `tracking.team_key`, and `tracking.repo` from the merged config itself (via the CLI's own config loader). Config is committed and PR-reviewed — that is what makes the re-derivation independent. This is the one deliberate divergence from `contain`/`run-outward` purity (args-only): reading config *is* the hardening.
- **Fail-closed everywhere.** Lane off, either side unresolvable, malformed target JSON, non-string fields, or no match → `not-self`, and the mechanical `outward-new-root` verdict stands. The cost of a false `not-self` is a surfaced item a human files by hand; a false `self` silently expands autonomous filing. (ADR-0079: "either side unresolvable ⇒ NOT self".)
- **`contain.js` stays repo-blind.** No repo/team concept enters `subtreeContains` or the containment walk. The gate is a sibling primitive consulted *after* an `outward` verdict, never a floor edit.
- **Region discipline (ADR-0042).** `faff audit` (governance) must recompute the verdict, and governance may import from `shared-infra.js` only — so the pure comparator lives in `shared-infra.js`; the factory module `self-intake.js` owns the CLI wrapper, config read, and event recording.
- **Detective recording parity (FAFF-354).** `--record <run-id>` binds the verdict to the exact inputs it was computed from as a run event, so `faff audit` recomputes-and-compares post-hoc. The target side is still agent-fetched (the CLI has no tracker); the recording is what makes a fabricated target durable evidence rather than an invisible lie. `contain.js` itself needs **zero edits** — `isSafeRunId` is already exported.

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/run-outward.js` | The SelfRef comparator shape being reused: normalize-then-ladder, strict null-safe equality, closed reason enum, selftest table |
| `plugin/skills/faff/bin/lib/contain.js` | Exit-code convention (0/3/2), `--record`/`--phase` mechanics, `isSafeRunId` traversal guard, `eventViolations` defense-in-depth |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Home for the pure comparator core (governance-importable) |
| `plugin/skills/faff/bin/lib/events.js`, `governance-profile.js` | Event validation + the `event_types` / `issue_scoped_types` registries the new event type joins |
| `plugin/skills/faff/bin/lib/audit.js` | Recompute-and-compare site to extend (mirrors its containment-check handling) |
| `plugin/skills/faff/bin/lib/config.js` | `loadConfig` + registry default `containment.self_hosting_intake: "false"`; `tracking.repo` / `tracking.team_key` keys |
| `plugin/skills/faff/bin/faff` | COMMANDS registry + usage header (both must gain the entry; `faff lint-cli-doc` is bidirectional) |
| `plugin/skills/faff-beep-boop/SKILL.md` → `autonomous_file_check` step 5 | The prose seam this primitive replaces (tidy's chokepoint references it single-sourced) |
| `plugin/skills/faff/SKILL.md` → appetite hard floor, outward bullet | One-line annotation naming the mechanical gate |
| `docs/guide/cli.md`, `test/*.test.mjs` | Doc row + test file obligations |

**Scope statement.** This is the mechanical hardening rung of the scope-containment family (FAFF-217 → 219/221/222 → 354 → 536), sitting at the filing chokepoint between `faff contain`'s `outward` verdict and the appetite gate.

## 2. OUT OF SCOPE

- **Tracker-side verification of the target** — the CLI never fetches the tracker; the target's team is agent-fetched fresh at the chokepoint. Why excluded: the no-tracker CLI invariant (parity with `contain`/`eligible`/`next`); FAFF-354 already fixed the posture (bind + audit, not fetch). Extension point: a future verifying wrapper at the chokepoint, alongside `faff audit`'s recompute.
- **Concreteness (`concrete` vs `vague`) judgement** — stays at the chokepoint. Why excluded: it is a judgement over free prose, not a mechanical comparison; forcing it into the CLI would fake determinism. Extension point: the `autonomous_file_check` procedure step 5, where the primitive's exit composes with the concreteness condition.
- **Dedupe and appetite gating of the filing** — unchanged from FAFF-536. Why excluded: they are already specified and shipped at the chokepoint. Extension point: `plugin/skills/faff-beep-boop/SKILL.md` step 5 filing recipe.
- **The lights-out `run-outward` / `run-start` rung-2 floor** — untouched. Why excluded: `run-outward.js` answers a different question (is the *run's target* outward?) at a different locus; this primitive answers "is this *discovered item's home* the self?". Extension point: none needed — the two stay siblings sharing only the comparator idiom.
- **Retro-hardening other agent-asserted seams** (e.g. the ancestry fetch itself) — FAFF-354's accepted residual. Why excluded: ratified stance; this ticket closes only the same-team leg. Extension point: `faff audit` recompute coverage.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| self side | The mandate's own identity: `tracking.team_key` + `tracking.repo` from merged config, plus the lane dial — re-derived by the CLI, never supplied by the caller |
| target side | The discovered item's intended home: `{ team, repo }`, supplied by the caller (`--target`), derived at the chokepoint per the wiring rules below |
| verdict | `self` (reclassification honoured) or `not-self` (the mechanical `outward-new-root` stands) |

**Types.**

```
RECORD SelfIntakeTarget:            # caller-supplied, coerced like run-outward's TargetRef
  team: String | null               # tracker team key of the item's intended filing destination
  repo: String | null               # org/repo slug the defect was observed in

RECORD SelfIntakeSelf:              # CLI-derived from merged config, never caller input
  team: String | null               # tracking.team_key (absent/empty -> null)
  repo: String | null               # tracking.repo (absent/empty -> null)
  lane_on: Boolean                  # containment.self_hosting_intake === "true" (string compare on the config scalar)

ENUM SelfIntakeReason:              # closed; every decision emits exactly one
  lane-off                          # dial not opted in -> not-self
  unresolved-target                 # target.team and target.repo both null -> not-self
  unresolved-self                   # self.team and self.repo both null -> not-self
  team-match                        # non-null strict equality on team -> self
  repo-match                        # non-null strict equality on repo -> self
  mismatch                          # comparisons available, none matched -> not-self
```

**CLI surface.**

```
faff self-intake <mandate> --target <json> [--record <run-id>] [--phase run|tidy|prep|build|plot] [--json]
```

- `<mandate>` — the issue/container the item was discovered under. Used for event scoping (`issue` field) and audit joins only; it plays no part in the decision.
- `--phase` (default `run`) takes the EVENT_PHASES vocabulary and, as with `contain`, is usage-invalid without `--record`.
- Exit codes: `0` = `self` (reclassification honoured) · `3` = `not-self` (fail-closed; outward stands) · `2` = usage / malformed `--target` / `--record` run dir missing or unsafe run-id. Mirrors `contain`.
- Default output: one human line (`self: team-match — reclassification honoured` / `not-self: lane-off — outward stands`). `--json`: `{ mandate, target, self: { team, repo, lane_on }, verdict, reason }` with normalized values.
- `--selftest` runs the decision table (one row per reason, null-safety rows, strict-equality rows, malformed-input coercion rows, ladder-ordering rows).

## 4. HOW — behaviour

**Decision ladder.** One pass, first-matching rung wins, biased toward `not-self` (the run-outward idiom inverted to fail toward the floor):

```
PROCEDURE decide_self_intake(target_raw, self):
  1. target := normalize(target_raw)          # non-object -> { team: null, repo: null }; non-string fields -> null
  2. IF self.lane_on !== true                 -> { verdict: not-self, reason: lane-off }
  3. IF target.team == null AND target.repo == null
                                              -> { verdict: not-self, reason: unresolved-target }
  4. IF self.team == null AND self.repo == null
                                              -> { verdict: not-self, reason: unresolved-self }
  5. IF target.team != null AND self.team != null AND target.team === self.team
                                              -> { verdict: self, reason: team-match }
  6. IF target.repo != null AND self.repo != null AND target.repo === self.repo
                                              -> { verdict: self, reason: repo-match }
  7. ELSE                                     -> { verdict: not-self, reason: mismatch }
```

The comparator core (steps 1–7, taking `self` as a plain argument) lives in `shared-infra.js` so `audit.js` (governance) can recompute it. The factory module `self-intake.js` derives `self` from config and wraps the CLI.

**Config derivation (the independence property).** `self-intake.js` resolves the merged config via the CLI's own loader (`loadConfig` from `config.js`), reading exactly three leaves: `containment.self_hosting_intake` (registry default `"false"`), `tracking.team_key`, `tracking.repo`. Empty-string or absent → `null` (an empty scalar must never strict-equal anything). A config parse failure is a loud exit `2` — never a silent `not-self` with a wrong reason, and never a fall-through to defaults that could misreport `lane-off` as the cause.

**Recording (`--record <run-id> [--phase]`).** Same mechanics as `contain`: validate the run-id with the `isSafeRunId` traversal guard (already exported by `contain.js` — import it; `contain.js` is not edited); require `.faff/runs/<run-id>` to exist (missing → exit `2` *before* any verdict — never a silently-unrecorded verdict); append one event:

```
{ phase, type: "self-intake-check", issue: <mandate>,
  data: { mandate, target_raw: <the exact --target string>,
          self: { team, repo, lane_on },          # the config snapshot used
          verdict, reason, exit } }
```

Run the constructed payload through `eventViolations` before writing (the contain defense-in-depth: a malformed record would undermine the point of recording). `self-intake-check` joins `event_types` and `issue_scoped_types` in `governance-profile.js`, with validation rows added to the `events.js` selftest cases.

**Audit recompute-and-compare.** `faff audit` gains a self-intake sibling of its containment-check handling: for each `self-intake-check` event, recompute the comparator from the recorded `target_raw` + recorded `self` snapshot (hermetic — config may legitimately change after the run) and compare `{verdict, reason}`; a disagreement is a coherence finding named like the containment mismatch finding. Selftest rows: one agreeing, one tampered (hand-edited verdict), one with unparseable `target_raw` (reported, not crashed).

**Chokepoint wiring.** `plugin/skills/faff-beep-boop/SKILL.md` → `autonomous_file_check` step 5 replaces the prose condition with the primitive call:

```
5. outward (3): create NOTHING -> step 6, UNLESS the FAFF-536 self-intake lane reclassifies
     (mechanical, FAFF-539 — checked BEFORE the floor):
     gate := faff self-intake <mandate> --target '{"team": <t>, "repo": <r>}' --record <run_id> --phase <phase>
     IF gate exits 0 AND confidence == "concrete" -> record containment "outward-self-intake",
        rejoin the appetite gate (steps 3-5), filing to Backlog + faff-jot-intake (NO faff-automate),
        deduped, stamped --via jot --initiated autonomous  (all unchanged from FAFF-536)
     ELSE (exit 3 or 2, or vague) -> step 6 (outward-new-root stands, hard-floored)
```

Target derivation at the chokepoint: `repo` := the working repo's slug derived mechanically from `git remote get-url origin` (a deterministic local read, not an agent claim), normalized to `org/repo` form (strip protocol/host/`.git`); `team` := the tracker team key of the candidate's intended filing destination, fetched fresh from the tracker at filing time (FAFF-354 trust boundary: agent-fetched, bound by `--record`). Either underivable → pass `null` for that field — the ladder fails closed. The lane-off short-circuit means callers may skip the tracker fetch when `faff config get containment.self_hosting_intake` is not `"true"` (cheap early exit; the primitive still re-checks). Tidy's chokepoint inherits this via its existing single-sourced reference to the procedure — no separate tidy edit beyond confirming the reference text still reads correctly. The gateway hard-floor bullet (`plugin/skills/faff/SKILL.md`, Outward / new-root autonomous create) gains a clause naming the reclassification as mechanically gated by `faff self-intake` (FAFF-539). Keep both skill edits lean — `validate-adapters` line caps apply.

**Edge cases.**

- Malformed `--target` JSON (unparseable, array, non-object) → exit `2` usage, matching `run-outward`'s boundary handling. A *well-formed* object with wrong-typed fields normalizes fields to `null` and proceeds (fail-closed by the ladder), matching `normalizeTargetRef`.
- Case sensitivity: comparisons are strict `===` on the raw strings — a case-mismatched repo slug fails toward `not-self`. See rationale.
- Missing `<mandate>` or `--target` → exit `2` with a usage line.
- `--phase` without `--record` → exit `2` (contain's rule).
- Git-only mode: no tracker means no autonomous tracker filing, so the chokepoint never reaches this gate; the CLI itself works anywhere config resolves.

**Failure modes.**

- **The config-derived self is wrong** (stale `tracking.repo` after a repo rename): genuine self-hosting discoveries stop reclassifying — visible as `mismatch` reasons in recorded events and items piling up in the run digest's outward surface. Signal: `faff audit` shows `self-intake-check` events with `mismatch` against a target that looks like the working repo. Meaning: fix config; the fail-closed direction held.
- **The agent fabricates the target's team** to force a match: the primitive cannot prevent it (no tracker), but the exact `target_raw` is bound into the event and `faff audit` recompute makes the fabrication durable evidence — the same detective, never preventive, stance as FAFF-354. Signal: audit mismatch vs the tracker when a human checks. Meaning: accepted residual on the ratified boundary; the *self* side and the *comparison* are no longer forgeable, which is this ticket's whole delta.
- **`git remote` yields a non-matching slug form** (SSH URL vs https, `.git` suffix): repo-match silently never fires and only team-match carries the lane. Signal: `mismatch` reasons where `repo` looks right to a human. Meaning: normalize the remote URL to `org/repo` slug form at the chokepoint — named here so the builder handles it, and a selftest row pins slug-form comparison.

**Anti-pattern:** teaching `contain.js` or `subtreeContains` about repos/teams. Why: FAFF-536's ratified stance — the primitive family stays repo-blind; this gate is a sibling, not a floor edit.
**Anti-pattern:** accepting a `--self` override flag "for testing". Why: it reopens the exact forgeable seam this ticket closes; tests inject config via fixture rc files instead.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given containment.self_hosting_intake is "true" and config tracking.repo is "shftwst/faff" with tracking.team_key unset
When faff self-intake FAFF-100 --target '{"team": "OTHER", "repo": "acme/app"}' runs
Then it exits 3 with verdict not-self, reason mismatch, and the chokepoint leaves the item outward-new-root
```

```
Given the same config
When faff self-intake FAFF-100 --target '{"team": null, "repo": "shftwst/faff"}' runs
Then it exits 0 with verdict self, reason repo-match, and the chokepoint may reclassify a concrete item outward-self-intake
```

```
Given containment.self_hosting_intake is unset (registry default "false")
When faff self-intake FAFF-100 --target '{"team": "FAFF", "repo": "shftwst/faff"}' runs
Then it exits 3 with reason lane-off — an agent asserting "the lane is on" cannot make it so
```

- With `--record <run-id>` on an existing run dir, exactly one `self-intake-check` event is appended carrying the exact `target_raw` string, the config snapshot, and the verdict; `faff audit` recomputes it and reports agreement.
- A hand-edited verdict in a recorded `self-intake-check` event is reported by `faff audit` as a coherence mismatch.

## 6. Design decision rationale

**Where does the primitive live?** Options: (a) inside `contain.js` — rejected: ratified repo-blind stance; (b) inside `run-outward.js` — rejected: different question, different consumers, and its `--self` is caller-supplied (the exact property this ticket must remove); (c) a new sibling module. **Chosen:** new factory module `self-intake.js` + comparator core in `shared-infra.js`, registered as `faff self-intake`. Follows the one-module-per-command layout and the ADR-0042 governance-import rule.

**How is the self side obtained?** Options: caller-supplied SelfRef (run-outward's shape) vs CLI-derived from config. **Chosen:** CLI-derived from merged config, no `--self` flag. Config is committed and PR-reviewed — the only self-source the agent cannot forge at run time. This is the entire point of the ticket; a caller-supplied self would re-create the prose seam with extra steps.

**Match semantics.** Options: require both team AND repo to match vs either (OR). **Chosen:** OR over non-null strict equalities (team first, then repo), per ADR-0079's "the run-outward SelfRef comparator shape" and because a legitimate config may set only one side — this very repo has `tracking.repo` set and `tracking.team_key` unset, so AND would permanently disable the lane it implements. Null never matches null (explicit unresolved rungs), so OR stays fail-closed.

**Case sensitivity.** Options: case-insensitive slug comparison (GitHub slugs are case-insensitive) vs strict. **Chosen:** strict `===`, matching `run-outward`; a case mismatch fails toward `not-self` (the safe direction), and the chokepoint's slug normalization keeps the practical case moot. At the time of writing no faff comparator lower-cases; introducing one comparator with different semantics invites drift.

**Lane dial inside the primitive?** Options: leave the config opt-in check at the chokepoint (primitive compares only) vs fold it in. **Chosen:** fold it in as rung 2 (`lane-off`). The dial is the other prose-asserted leg of the ratified critical; reading it CLI-side makes "the lane is on" as unforgeable as "same team". The chokepoint may still early-exit on the dial for cheapness — the primitive re-checks regardless.

**Exit-code shape.** Options: report-only exit 0 with the boolean in the payload (`run-outward`) vs verdict-bearing exits (`contain`). **Chosen:** `contain`'s 0/3/2. The chokepoint branches directly on the exit; unlike `run-outward` there is no downstream single-homed decider this would double-gate — the primitive *is* the decider for this leg.

**Event recompute source.** Options: recompute against live config at audit time vs against the recorded snapshot. **Chosen:** the recorded snapshot (hermetic). Config legitimately drifts between run and audit; the detective question is "was the verdict computed honestly from what it claims it saw", not "would it compute the same today". The snapshot itself is CLI-written, not agent-written.

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions.**

- **Assumes:** `loadConfig` (exported by `config.js`) resolves the merged base+overlay document a factory module can read leaves from. Validation: confirm the export and its use by an existing subcommand before building.
- **Assumes:** `eventViolations` accepts a new type once it is added to `governance-profile.js`'s `event_types` / `issue_scoped_types` lists (derivation-driven, per FAFF-362). Validation: read `governance-profile.js` and the `events.js` selftest rows for `containment-check`.
- **Assumes:** `faff lint-cli-doc` mechanically requires the `docs/guide/cli.md` row for any command in the COMMANDS registry (bidirectional). Validation: run it after wiring. (`test/cli-coverage.test.mjs` is per-command seam tests, not a registry gate — the new test file follows its fixture pattern rather than being demanded by it.)

## 8. DONE — definition of done

### From WHY (the ratified critical)
- [ ] A discovered item whose target does not independently resolve to the config's team/repo is not reclassified: `faff self-intake` exits `3` and the chokepoint prose routes it to `outward-new-root` (hard floor unchanged).
- [ ] A genuine same-repo discovery (target matches config on team or repo, lane on) exits `0`; filing behaviour downstream of the gate (dedupe, appetite, labels, provenance stamp) is byte-unchanged from FAFF-536.
- [ ] `contain.js` is byte-untouched (`isSafeRunId` is already exported); its selftest passes byte-identical.

### From WHAT (surface)
- [ ] `faff self-intake <mandate> --target <json> [--record <run-id>] [--phase] [--json]` exists with exits 0/3/2 exactly as specified; no `--self` flag exists.
- [ ] `--json` emits `{ mandate, target, self, verdict, reason }` with normalized values; default output is the one-line human form.
- [ ] The reason enum is exactly the six tokens above; every decision path emits one.

### From HOW (behaviour)
- [ ] The decision ladder matches the pseudocode: lane-off → unresolved-target → unresolved-self → team-match → repo-match → mismatch, first match wins.
- [ ] Self derivation reads only the three named config leaves via the CLI's own loader; empty/absent → null; config parse failure → exit 2, never a mislabelled `not-self`.
- [ ] Malformed `--target` (unparseable/array/non-object) → exit 2; wrong-typed fields inside a well-formed object → null-coerced, ladder proceeds.
- [ ] `--record` validates the run-id (traversal guard), requires the run dir before any verdict, appends one `eventViolations`-clean `self-intake-check` event with `target_raw`, the self snapshot, verdict, reason, exit.
- [ ] `governance-profile.js` lists `self-intake-check` in `event_types` and `issue_scoped_types`; `events.js` selftest gains valid/invalid rows for it.
- [ ] `faff audit` recomputes each `self-intake-check` event from its recorded inputs and reports a coherence finding on disagreement; audit selftest gains agree / tampered / unparseable-target rows.
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` step 5 calls the primitive (exit-0 AND concrete) instead of the prose condition, including the slug-normalized `git remote` repo derivation and fresh team fetch; `plugin/skills/faff/SKILL.md`'s outward hard-floor bullet names the mechanical gate; `faff validate-adapters` stays green.
- [ ] `bin/faff` COMMANDS registry + usage header gain the command; `docs/guide/cli.md` gains its row; `faff lint-cli-doc` passes.

### From Scenarios
- [ ] `--selftest` covers: one row per reason, the null-never-matches-null rows, ladder-ordering precedence, strict-equality (case-mismatch → not-self), malformed-input coercion.
- [ ] `test/self-intake.test.mjs` exercises the CLI end-to-end with fixture rc files (lane on/off, one-sided self, record + audit round-trip).

**Integration smoke test:**

```
1. In a temp repo with .faffrc.yaml setting containment.self_hosting_intake: true and tracking.repo: acme/app,
   and an initialised .faff/runs/r1 dir:
2. faff self-intake M-1 --target '{"team":null,"repo":"acme/app"}' --record r1 --json
   -> exit 0, verdict self, reason repo-match
3. faff audit on r1 -> the self-intake-check event is present and recompute agrees
4. Flip the config to self_hosting_intake: false, rerun without --record -> exit 3, reason lane-off
```

## Already shipped against this surface

Related-but-not-superseding, as reader context: FAFF-219/221/222 shipped the `faff contain` primitive + chokepoint wiring; FAFF-354 shipped the `--record`/audit detective control this spec extends; FAFF-521 shipped the `run-outward` comparator idiom being reused; FAFF-536 (PR #423) shipped the `outward-self-intake` classification with the same-team check as prose — which is precisely the gap this ticket closes. No Done ticket builds the mechanical gate itself; the premise holds.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes — one new CLI module plus a comparator in `shared-infra.js`, two lean skill-prose edits, tests and docs: a cohesive single unit. The comparator and its chokepoint wiring are always-ships-together (the gate is dead code without the wiring), so no split.
- **Workstream fit?** Yes — outcome-named hardening follow-up closing a ratified FAFF-536 adversarial critical, squarely in the scope-containment / attestation family. The issue is currently project-less; a later rehoming pass may home it with the containment family (note, not a defect).
- **Deps surfaced?** Yes — every upstream dependency (FAFF-536, FAFF-354, the contain family) is Done; no missing blocker links.
- **Risk profile?** Low — no novel integration or external dependency; dependency-free Node CLI with established selftest/test idioms. No de-risking spike warranted.

confidence: high

spec-review: approve
