# FAFF-1414: faff graft admit — one command for graft's Step 2 gate chain, composing next with the claim check

> Spec: faffter-dark-nlspec · 2026-10-29 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1414.

_Revised 2026-10-29 — operator decisions + split. This ticket builds the command and wires graft Step 2; beep-boop's step 4 moves to it in [FAFF-1434](https://linear.app/shftwst/issue/FAFF-1434), which carries the rest of the corpus replay._

_Revised 2026-10-29 — In Review replay moved back in, operator decision. The 14 In Review corpus records are replayed here, so the claim rule ships with its proof._

## 1. WHY

Graft's Step 2 decides whether a build may start: it runs about 84 lines of prose (faff-graft `SKILL.md` lines 73–156), shelling `faff next`, `faff eligible`, `faff intakecheck` and `faff admissible` one at a time, and wrapping each in `faff decision-capture decide` / `action` calls. Beep-boop's build-queue assembly (faff-beep-boop step 4) makes the same decision in its own prose, with its own claim-before-admit re-read. Both are re-read on every turn, and the two can drift.

Grading the post-fix decision corpus (`verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl`) showed where they disagree with the kernels:

- **14 `next` records are In Review issues** (FAFF-1292, FAFF-1207, FAFF-1205 in four drains each; FAFF-1403 in two). `next` returned `graft` (or `prep` where the drain passed `--spec none`), and the drain skipped every one as claimed-by-peer. `next` is never told the issue is claimed; the claim check lives only in beep-boop prose.
- **7 records are FAFF-1318**, where `next` returned `graft` and the issue was then refused, because `faff admissible --lights-out` rejects its spec (FAFF-1412, FAFF-1423). The admissibility refusal happens after `next` and, in two drains, only inside graft's own backstop.

`faff graft admit` runs the whole mechanical chain as one read-only command and returns one disposition. This ticket builds it and makes graft Step 2 call it. FAFF-1434 switches beep-boop step 4 to the same command, so the decision ends with one home.

**Correction to the ticket's premise.** The ticket says to compose `next` with `claim-verdict`. `claim-verdict` (`claim-verdict.js`) is a TTL liveness function: it answers "is an `In Progress` claim older than `claim_ttl_hours`?". It does not decide claimed-by-peer. The rule that skipped the 14 In Review records is beep-boop's claim-before-admit: live status `In Progress` / `In Review` set by someone else means the issue is a peer's. `faff graft admit` therefore composes `next` with that status rule plus the build-claim ref (to recognise the caller's own claim), and consults `claim-verdict` to report staleness, not to decide.

### Design principles

- **The CLI reads no tracker.** Every `faff` kernel is a pure function of what the agent passes it (the "CLI decides, the agent reads the tracker" split in `next.js` and `claim-verdict.js`). `faff graft admit` keeps that: the agent passes one facts object read from a single live `get_issue`, and the command does everything else.
- **Read-only.** The command writes no tracker state, no label, no claim ref and no provenance marker. Its only writes are decision-capture records, which are best-effort and gate nothing.
- **Same verdicts, one place.** It calls the existing kernel functions in-process (`nextStep`, `automationEligible`, `intakeVerdict`, `admissibleVerdict`, `claimVerdict`) and the build-claim store's read. It re-implements none of them.
- **Fail closed.** Any input the command cannot establish exits 2, and both callers treat a non-zero exit as a refusal before any worktree exists, as today.
- **Not a new trust boundary.** The own-claim test uses the same identity `build-claim acquire` already trusts: `owner.session_id`, taken from `$FAFF_SESSION_ID`. That id is cooperative, not authenticated; an agent that sets it to a peer's value is already treated as the holder by `acquire`'s idempotent re-acquire at Step 5. `faff graft admit` grants nothing `acquire` would not, and Step 5's CAS ref stays the mutex. Hardening the claim identity is [FAFF-1433](https://linear.app/shftwst/issue/FAFF-1433)'s concern, not this command's.

### Reference context

- `next.js` `nextStep({status, spec, eligible, parked, blocked, ifEligible, awaitingSpecReview})` — the seven-key kernel. `--if-eligible` computes the route a not-eligible issue would take, which is how interactive graft ignores eligibility.
- `eligible.js` `automationEligible(labels, automationDefault, trackerPresent)` — `faff-automate` present means eligible.
- `intake-provenance.js` `intakeVerdict(marker, labels, mode, prefix, automateName)` and `intakeExit(v, mode, interactive)` — the intake guard behind `faff intakecheck`.
- `admissibility.js` `admissibleVerdict(specText, lightsOut)` — the quality-IN floor behind `faff admissible --lights-out`.
- `claim-verdict.js` `claimVerdict(claimedAtISO, nowISO, ttlHours)` — live or stale.
- `bundle.js` `buildClaimStore(root).read` (`faff build-claim read --issue <ID> --json`) — returns the ref's claim, whose `owner.session_id` identifies the holder. `acquire` already treats a matching `session_id` as the caller's own claim.
- `decision-capture.js` `captureDecision`, `mintCorrelationId` and the action-record path behind `faff decision-capture action`. `KERNEL_REGISTRY` already registers `next`, `eligible` and `claim-verdict`.
- `labels.js` `controlLabels(prefix, names)` — resolves the configured names of `faff-parked`, `faff-awaiting-spec-review` and the other control labels.

### Already shipped against this surface

- FAFF-1404 (Done): `faff spec commit` / `faff spec verify` took graft's spec commit out of prose. It does not touch Step 2's gates.
- FAFF-1405 (Done): `faff gates run --resume`. Unrelated surface, same extraction lane.
- FAFF-1412 (In Review, PR #1157): `faff drain-filter`, a runner-side pre-check that stops a declined, unchanged issue starting another paid drain. It filters before a drain starts; `faff graft admit` decides inside one. They do not overlap, and FAFF-1422 wires `drain-filter` into the runner.

None of these delivers the admission command, so the premise holds.

## 2. OUT OF SCOPE

- **Tracker reads, spec discovery and spec capture** stay agent-side (the CLI has no connector). The prose for them shrinks to "read the issue once and build the facts object".
- **Beep-boop's live-thread re-scan and automation-routing verdict** stay agent-side: both are judgement calls that run before admission.
- **The endgame stranded-In-Review landing resume** (faff-beep-boop step 4) stays in beep-boop prose. It needs a PR read and mints a landing claim, which a read-only command cannot do. `faff graft admit` returns `claimed-by-peer` with the status, and beep-boop's existing branch runs from there.
- **Acting on a stale tracker claim.** `claim-verdict`'s TTL answer (about the tracker `In Progress` timestamp) is reported, never acted on. A stale build-claim *ref* is a different question, decided in section 4.1.
- **The build-time premise-superseded check** stays agent-side in graft prose (see section 6).
- **Beep-boop's step 4 wiring and the rest of the corpus replay** (the full 63-verdict reproduction, FAFF-1318's records and the action-marker comparison) are FAFF-1434. The In Review slice is replayed here.
- **Commissaire.** This change adds nothing to `faff commissaire` or any `commissaire*` module.

## 3. WHAT

### Interface

```
faff graft admit --mode interactive|autonomous --facts <file|->
                 [--spec-file <path>] [--session-id <S>] [--run-dir <dir>] [--wave <N>] [--now <ISO>] [--json]
```

The facts object, built by the agent from one live `get_issue` (graft Step 1; beep-boop's re-read once FAFF-1434 lands):

```json
{
  "issue": "FAFF-1414",
  "status": "todo",                    // the same normalised enum `faff next --status` takes today
  "labels": ["faff", "faff-automate"], // the full live label set, as an array
  "spec": { "found": true, "confidence": "high" },   // confidence: none|low|medium|high
  "externally_blocked": false,          // true = an external blocker is still open (passed to nextStep as blocked)
  "claimed_at": "2026-10-28T03:43:24Z", // latest transition INTO In Progress, or null
  "tracker": { "mode": "tracker", "configured": true, "pinned": false, "reachable": true }
}
```

- `tracker.pinned` is true when `tracking.tracker` pins a connector. `configured` or `pinned` with `reachable: false` is the fail-loud case; both fields are required booleans.
- `status` uses the normalisation callers already apply before `faff next --status` (the gateway's *Workable vs terminal states* mapping). This command adds no second mapping; one shared normaliser is out of scope.
- `parked` and `awaitingSpecReview` are not facts fields: the command derives them from `labels` with `controlLabels`, so a renamed control label works without the agent knowing.
- `--spec-file` is the captured spec (`.faff/graft/<ISSUE>/captured-spec.md`, or the candidate's spec body written to a file by beep-boop). It is required when `--mode autonomous` and `spec.found` is true, because admissibility reads it.
- `--session-id` identifies the caller for the own-claim test. Default `$FAFF_SESSION_ID`.
- `--run-dir` (default `$FAFF_RUN_DIR`) enables decision capture. Without a resolvable run dir nothing is captured, as today's standalone interactive graft.
- `--now` defaults to the system clock and exists for tests and replay.

Output (one JSON object on stdout, the same in text mode as a summary line):

```json
{
  "issue": "FAFF-1414",
  "disposition": "proceed",
  "reason": "build-eligible",
  "kernels": {
    "eligible": { "eligible": true },
    "next": { "step": "graft", "reason": "build-eligible / resume" },
    "claim": { "status": "todo", "ref": "missing", "own": false, "ttl": null },
    "intake": { "verdict": "pass", "warn": null },
    "admissible": { "admissible": true, "reasons": [], "warnings": [] }
  },
  "warnings": []
}
```

A gate that did not run because an earlier one decided is `null` in `kernels`.

### Dispositions

| `disposition` | When | Exit |
|---|---|---|
| `proceed` | every gate passed | 0 |
| `needs-prep` | `next` returned `prep` | 0 |
| `needs-human` | `next` returned `needs-human` | 0 |
| `excluded` | `next` returned `blocked`, `done` or `none`; `reason` carries which | 0 |
| `ineligible` | autonomous, not automation-eligible | 0 |
| `claimed-by-peer` | autonomous, status `in-progress` or `in-review`, and the caller does not hold the build-claim ref | 0 |
| `blocked` | autonomous, the intake guard refused (`intake_gate: block`, no provenance). Unreachable after eligibility (section 4.1); kept so the guard can still refuse if the two ever resolve the label differently | 0 |
| `inadmissible` | autonomous, `admissibleVerdict` refused; `reason` carries the reasons | 0 |

- Exit 2 (fail-loud): the facts object is missing, unparseable or fails its schema; `--mode` is absent or invalid; `--mode autonomous` with a found spec and no readable `--spec-file`; the tracker is configured or pinned but `reachable` is false (`reason: tracker-unreachable`); the build-claim store cannot be read for a claim status (`reason: claim-store-unavailable`).
- **Chosen:** the skip tokens are the existing graft return tokens (`ineligible`, `blocked`, `inadmissible`, `claimed-by-peer`), unchanged, because the run ledger, `runcheck` and the run summary already key on them. `next`'s own `blocked` (an external blocker) becomes `excluded` with `reason: blocked`, so it can never be confused with the intake `blocked`.
- **Chosen:** `needs-prep` and `excluded` are dispositions of the command, not new graft return tokens. Graft maps them onto its existing vocabulary (section 4.2), so its return-value list, the run ledger, `runcheck` and the run summary are unchanged. Beep-boop's own buckets for them are FAFF-1434's.

### Decision capture

When a run dir resolves and `capture.decision_kernel` is `on`, the command writes, through `decision-capture.js`'s existing functions:

- a base record for `eligible` and `next` on every call, and for `claim-verdict` whenever it was consulted;
- one action marker per base record, with the correlation id derived from run, issue, kernel and wave, so base and marker share it by construction.

| Disposition | `next` marker | `eligible` marker | `claim-verdict` marker |
|---|---|---|---|
| `proceed` | `graft` | `eligible` | `proceed`, only when a `claim-verdict` base record was written |
| `needs-prep` | `prep` | `eligible` | — |
| `needs-human` | `needs-human` | `eligible` | — |
| `excluded` | the `next` step (`blocked`/`done`/`none`) | `eligible` | — |
| `ineligible` | `skip-ineligible` | `ineligible` | — |
| `claimed-by-peer` | `none` | none (a non-eligibility skip) | `claimed-by-peer`, only when a `claim-verdict` base record was written |
| `blocked`, `inadmissible` | `none` | none | — |

- A `claim-verdict` marker is written only beside a `claim-verdict` base record, which exists only when `claimed_at` was present on a claim status. A Todo `proceed`, or a peer status with `claimed_at: null`, writes no `claim-verdict` record at all.
- **Chosen:** the command emits the markers itself, because the disposition is the action at the admission boundary. This also retires the hand-emitted markers that produced two mis-tokened records in the corpus (FAFF-1199 and FAFF-1249 carry the `eligible` token on a `next` marker).
- Graft's later premise-superseded close is a run-ledger outcome (`superseded`), not one of these kernels, so it emits no marker here.

## 4. HOW

### 4.1 The chain

```
admit(facts, mode, specFile, sessionId, runDir, wave, now):
  1. validate facts; (tracker.configured OR tracker.pinned) AND NOT reachable  -> exit 2 tracker-unreachable
  2. prefix, automateName := the configured label prefix and automate-name override (as cmdEligible resolves them)
     parked, awaiting := from labels via controlLabels(prefix, names)
     eligible := automationEligible(normalizeEligibilityLabels(labels, prefix, automateName), ...)   # captured
  3. step := nextStep({status, spec.confidence, eligible,
                       parked, blocked: externally_blocked,
                       ifEligible: interactive, awaitingSpecReview: awaiting})   # captured, always
     step == "done"|"none"            -> excluded      # terminal wins, as nextStep itself orders it
     autonomous AND NOT eligible      -> ineligible    (step is "skip-ineligible")
     interactive AND NOT eligible     -> warnings += "not automation-eligible; proceeding interactively"
  4. claim (status in-progress | in-review):
       ref := buildClaimStore(root).read(issue)           # missing | held
       own   := ref.held AND ref.claim.owner.session_id == sessionId
       stale := ref.held AND buildClaimStaleAware(root, ref.claim, now, env)   # the predicate acquire uses
       IF claimed_at: ttl := claimVerdict(claimed_at, now, claim_ttl_hours)  # captured, report-only
       own                            -> continue
       autonomous AND stale           -> continue; warnings += "stale build claim; Step 5's acquire reclaims it"
       autonomous                     -> claimed-by-peer
       interactive AND NOT own        -> warnings += "held by another claimant; Step 5's acquire decides"
  5. step == "prep"                   -> needs-prep
     step == "needs-human"            -> needs-human
     step == "blocked"                -> excluded (reason blocked)
     step == "skip-ineligible"        -> ineligible    # unreachable after step 3; kept for totality
  6. gate := the configured intake_gate (warn|block|off), resolved as cmdIntakecheck does
     intake := intakeVerdict(marker, labels, gate, prefix, automateName)
     exit := intakeExit(intake, gate, interactive)       # gate mode, never the admit --mode
     exit == 3                        -> blocked       # autonomous + block only; see note below
     intake warn                      -> warnings += it
  7. autonomous: adm := admissibleVerdict(read(specFile), lightsOut=true)
     NOT adm.admissible               -> inadmissible (reasons)
     adm.warnings                     -> warnings += them
  8. -> proceed
```

- **Chosen:** the intake guard stays in the chain, although in autonomous mode it cannot refuse an issue that passed step 2: `intakeVerdict` treats the resolved automate label as the `eligibility-gesture` basis, and eligibility requires that same label. It stays as defence-in-depth (it would fire if the two ever resolved the label differently) and for its warnings, at the cost of one marker read. `test/graft-admit.test.mjs` pins this: an eligible issue with `intake_gate: block` and no marker is `proceed`, never `blocked`.
- **Chosen:** the claim check (step 4) runs before `next`'s spec routing (step 5). A peer's in-flight issue is never this run's to prep or build, and checking it first is what reproduces the corpus: the three In Review records with `--spec none` were skipped, not prepped. Terminal statuses are handled by `next` in step 3 before the claim check, so a `done` issue is `excluded`, never `claimed-by-peer`.
- **Chosen:** in interactive mode the claim check only warns, because today interactive graft does no claim check in Step 2 and the human is the sanction; Step 5's `build-claim acquire` stays the mutex in both modes.
- **Chosen:** a `missing` ref with a peer status (`In Progress` or `In Review` and no ref) is `claimed-by-peer` in autonomous mode. That is today's beep-boop rule ("status set by someone else"), it respects a human-set `In Progress` (a claim without a ref is surfaced, never taken over), and the corpus has no refs to say otherwise. For a direct autonomous graft this is a change: today Step 5 would acquire a fresh ref and build. Rule-inventory row 36 records it.
- **Chosen (ratified: human):** a held ref that `buildClaimStaleAware` judges stale (the crashed-executor case) is `proceed` with a warning in autonomous mode, so Step 5's `acquire` reclaims it with `--force-with-lease`. It uses the predicate `acquire` itself uses, and it keeps the self-heal a direct autonomous graft has today. Beep-boop's adoption of it, which changes beep-boop's behaviour, is FAFF-1434's.
- **Chosen:** both kernels run before any disposition is decided, so every call writes an `eligible` and a `next` base record, each from its kernel's own inputs. An autonomous ineligible call records `next`'s real verdict (`skip-ineligible`, or `done`/`none` for a terminal issue, which then wins as `excluded`).
- **Chosen:** eligibility uses the same label normalisation `cmdEligible` applies (`normalizeEligibilityLabels` with the configured prefix and automate-name override), and the intake guard gets the same names, so the two never disagree on a custom prefix.
- **Chosen:** the build-claim read happens only for the two claim statuses, so a Todo candidate costs no git round trip. A read failure (`store_unavailable`) exits 2 with `reason: claim-store-unavailable` rather than reusing `claimed-by-peer`, which would tell the run summary a peer holds the issue when nobody checked. Graft refuses before Step 3 as for any other exit 2 and logs the reason.

### 4.2 Callers

**Graft Step 2** keeps, in prose:
- tracker availability resolution and spec discovery (agent-side);
- spec capture to `.faff/graft/<ISSUE>/captured-spec.md`;
- building the facts object from Step 1's `get_issue`;
- one `faff graft admit` call, then the routing table:
  - `proceed` continues to the premise-superseded check and Step 3;
  - `needs-prep` offers `/faff-prep` interactively, and returns `needs-human` autonomously, citing the missing spec (a dispatched build never preps);
  - `needs-human` stops and surfaces the reason (interactive) or returns `needs-human` (autonomous);
  - `ineligible`, `blocked`, `inadmissible` and `claimed-by-peer` return that token autonomously, logged to `graft.md`;
  - `excluded` stops: interactively it reports the reason, and autonomously it returns `needs-human` citing it (a terminal issue is already refused at Step 1, so in practice this is an external blocker);
  - a non-zero exit refuses before Step 3 and returns `ineligible` (today's fail-safe token for a resolution failure).

The eligibility, intake, admissibility and capture paragraphs, their bash blocks and their exit-code bullets are deleted.

**Beep-boop step 4** is unchanged by this ticket. FAFF-1434 replaces its admission prose with a call to this command.

### 4.3 Module placement and registration

- New TypeScript module `bin/lib/graft-admit.ts`, with its committed `tsc` emit `bin/lib/graft-admit.js` beside it (ADR-0132). Importers require it extensionless. Add the `.ts` to `tsconfig.json` `include`, run `npm run build` in `plugin/skills/faff`, and commit the emit and the updated `build-manifest.json` with the source. Existing JS modules it calls (`next.js`, `eligible.js`, `intake-provenance.js`, `admissibility.js`, `claim-verdict.js`, `bundle.js`, `decision-capture.js`) stay JS; any small edit to them stays JS.
- The source passes CI's `check-no-boundary-cast` lint, which forbids every `as`, non-null `!` and `satisfies` in TypeScript sources; narrow with type guards instead. Add `graft-admit.ts` to the exact TypeScript module list `test/check-no-boundary-cast.test.mjs` pins.
- Region `factory` (all its kernels are factory). Dispatch `faff graft admit` from the CLI table.
- No `--selftest`. `REGION_SELFTEST_ARGV["graft"] = null` and a `TEST_FILE_COVERAGE` entry naming `test/graft-admit.test.mjs`.
- `docs/reference/cli.md` documents the command, the facts schema and the disposition table.
- `SKILL_LINE_BASELINE` for `faff-graft` drops to the new line count in the same PR.

### 4.4 Edge cases

- **Label quirk retired.** Today `faff eligible` takes repeated `--label` and `faff intakecheck` takes one `--labels` csv, and the wrong form silently parses zero labels. Labels now arrive once, as a JSON array; a label containing a comma survives.
- **Absent versus corrupt.** An absent provenance marker is the intake guard's normal no-provenance case (`warn` or `block` per config). A present but malformed marker keeps `intakeVerdict`'s existing handling (a warning when another basis is satisfied). A missing `--spec-file` in autonomous mode with a found spec is exit 2, never treated as admissible.
- **Clock skew.** `claimVerdict` already keeps a non-positive age live.
- **Git-only mode.** `tracker.mode: "git-only"`: `trackerPresent` is false, statuses come from the git-only store, and the build-claim ref read works the same (the ref is on `origin`).

### 4.5 Rule inventory

Every rule in the graft prose this ticket deletes or replaces. "Agent" means the rule stays in the shortened prose. Row numbers are kept from the pre-split inventory; rows 7, 8, 26, 29, 30, 31, 34 and 37 (beep-boop's prose) moved to FAFF-1434, and rows that cited both skills now cover graft's half only.

| # | Prose rule (source) | Command behaviour | Covering test | Disposition |
|---|---|---|---|---|
| 1 | Resolve tracker availability once; a pinned tracker is never downgraded (graft Step 2, first paragraph) | Agent resolves; passes `tracker` facts | — | kept (agent) |
| 2 | Tracker configured or pinned but unreachable: fail loud, never "no spec" (graft Step 2 bullet 2) | exit 2 `tracker-unreachable` | `graft-admit.test.mjs` "unreachable tracker" | kept |
| 3 | Spec discovery over four locations; a description is never a spec (graft Step 2) | Agent; passes `spec.found`, `spec.confidence` | — | kept (agent) |
| 4 | Capture the spec byte-exact before the worktree exists (graft Step 2 bullet 1) | Agent; the file is `--spec-file` | — | kept (agent) |
| 5 | No spec: interactive offers `/faff-prep` (graft Step 2 bullet 3) | `needs-prep`; the offer stays prose | "no spec → needs-prep" | kept |
| 6 | Consult `faff next` rather than re-derive (graft Step 2 bullet 1; beep-boop step 4 "Gate eligibility") | `nextStep` in-process | "next routing per step" | kept |
| 9 | Interactive: not eligible → warn and continue, never blocked (graft Step 2 "Automation eligibility (interactive)") | warning; `ifEligible: true` | "interactive ineligible proceeds" | kept |
| 10 | Autonomous: not eligible → `ineligible`, before any worktree (graft Step 2 eligibility gate) | `ineligible`, after both kernels are captured | "autonomous ineligible records next skip-ineligible", "custom prefix" | kept |
| 11 | Labels are the at-the-gate read from the same fresh fetch (graft Step 2; beep-boop claim-before-admit) | facts from one live read | — | kept (agent) |
| 12 | Any resolution failure → refuse as `ineligible` (graft Step 2) | exit 2 with a reason; graft maps non-zero to `ineligible` and logs the reason | "malformed facts exit 2", "claim store unavailable exit 2" | kept |
| 13 | Read `faff eligible`'s stdout, not `$?` (graft Step 2 bash block) | not applicable in-process | — | dropped: no shell call remains |
| 14 | Pass labels as repeated `--label`, never comma-joined (graft Step 2) | labels as a JSON array | "comma in label" | dropped: quirk unreachable |
| 15 | Never add `faff-automate` (graft Step 2) | command writes no label | "no tracker or label writes" | kept |
| 16 | Capture only when a run dir resolves; standalone interactive captures nothing (graft Step 2 capture) | capture iff run dir resolves | "no run dir, no capture" | kept |
| 17 | Base records captured in-kernel, never hand-built; one-command driver (graft Step 2 capture; beep-boop capture) | `captureDecision` in-process | "base records carry kernel inputs" | changed: the `decide` driver is no longer needed |
| 18 | `next` marker is the action actually taken (graft, beep-boop capture bullets) | marker table in section 3 | "marker per disposition" | kept |
| 19 | `eligible` marker only on admit or eligibility refusal; a non-eligibility skip emits none (graft, beep-boop) | marker table | "claimed-by-peer emits no eligible marker" | kept |
| 20 | Intake guard: interactive passes `--interactive`, always exit 0 with a warn (graft Step 2 intake) | `intakeExit(..., interactive)` | "interactive intake bypass" | kept |
| 21 | Intake guard: autonomous `block` + no provenance → `blocked`; `warn`/`off` never block (graft Step 2 intake) | `blocked` on exit 3, unreachable after eligibility (section 4.1) | "eligible issue never intake-blocked", "intake warn" | kept |
| 22 | A malformed marker with another basis satisfied is a warning, not a refusal (graft Step 2 intake) | `intakeVerdict` unchanged | "malformed marker warns" | kept |
| 23 | Graft never runs `intake-record` itself (graft Step 2) | read-only | "no writes" | kept |
| 24 | Intake labels passed as one `--labels` csv (graft Step 2 bash block) | JSON array | "comma in label" | dropped: quirk unreachable |
| 25 | Admissibility on every automated run, keyed on `autonomous`; interactive skips (graft Step 2 admissibility) | step 7, autonomous only | "interactive skips admissibility" | kept |
| 27 | Inadmissible or any failure → `inadmissible`, never parked, not admitted (graft; beep-boop) | `inadmissible` with reasons; missing spec file exit 2 | "inadmissible", "missing spec file" | kept |
| 28 | Admissibility warnings surface but never gate (graft; beep-boop) | `warnings[]` | "admissible warnings pass" | kept |
| 32 | Skip dispositions never parked, never in `admitted` (graft Return values; beep-boop) | tokens unchanged | — | kept (agent) |
| 33 | Order: prep gate, eligibility, intake, admissibility, then premise (graft Step 2) | 4.1 order, with the claim check after eligibility; premise after `proceed` | "ordering: claim before prep" | changed: claim check added to graft's chain, ahead of `next`'s spec routing |
| 38 | Claim-before-admit semantics (beep-boop step 4, adopted by the command for graft) | command step 4 | "in-review peer", "in-progress peer", "own claim proceeds", "interactive peer warns and proceeds" | changed for graft: a new pre-worktree check; beep-boop's prose deletion is FAFF-1434 row 29 |
| 35 | Premise-superseded gate (graft Step 2, last subsection) | not in the command; runs after `proceed` | — | kept (agent) |
| 36 | Step 5 corroborate: stop if live status is already `In Progress`/`In Review`/`Done` only when the ref was lost; a won ref proceeds (graft Step 5) | autonomous: peer status with no ref, or a live peer ref → `claimed-by-peer` before Step 5; a stale ref → `proceed` with a warning | "in-progress no ref", "stale ref proceeds", "live peer ref" | changed: a direct autonomous graft no longer builds a peer-status issue that has no ref |

## Scenarios

```
Given an autonomous run, an issue In Review with a high spec, labels including faff-automate, and no build-claim ref held by this session
When faff graft admit --mode autonomous runs
Then it prints disposition "claimed-by-peer", exits 0, and records a next marker "none" and no eligible marker
```

```
Given the same issue, and a build-claim ref whose owner.session_id equals --session-id
When faff graft admit --mode autonomous runs
Then it prints disposition "proceed"
```

```
Given an autonomous run, an issue In Progress whose build-claim ref is held by another session and is stale by buildClaimStaleAware
When faff graft admit --mode autonomous runs
Then it prints disposition "proceed" and a warning that Step 5's acquire will reclaim the stale claim
```

```
Given an autonomous run, a Todo issue with a high spec whose DoD faff admissible --lights-out refuses
When faff graft admit runs with that spec as --spec-file
Then it prints disposition "inadmissible" with the admissibility reasons, and the next base record's verdict is "graft"
```

```
Given an autonomous run, a Todo issue with a high spec, faff-automate, intake provenance and an admissible spec
When faff graft admit --mode autonomous runs
Then it prints disposition "proceed", exits 0, and records a next marker "graft" and an eligible marker "eligible"
```

```
Given an autonomous run and a Backlog issue whose facts say spec.found false
When faff graft admit runs
Then it prints disposition "needs-prep"
```

```
Given an autonomous run and a Todo issue whose spec confidence is medium
When faff graft admit runs
Then it prints disposition "needs-human" with next's reason "needs-decision-first (medium spec)"
```

```
Given an autonomous run and a Todo issue with a high spec and externally_blocked true
When faff graft admit runs
Then it prints disposition "excluded" with reason "blocked"
```

```
Given an autonomous run, intake_gate set to block, no provenance marker and no faff-automate label
When faff graft admit runs
Then it prints disposition "ineligible", because eligibility is checked before intake
```

```
Given an interactive graft on an issue without faff-automate
When faff graft admit --mode interactive runs
Then the disposition is "proceed" and warnings name the missing eligibility label
```

```
Given an interactive graft on an issue In Progress whose build-claim ref is held, live, by another session
When faff graft admit --mode interactive runs
Then the disposition is "proceed" and warnings name the other claimant
```

```
Given facts with tracker.configured true and tracker.reachable false
When faff graft admit runs
Then it exits 2 with reason "tracker-unreachable"
```

## 5. DESIGN DECISION RATIONALE

- **Facts in, decision out.** Keeping the tracker read agent-side preserves the pure-CLI invariant every kernel follows, and one facts object fixes the label-format quirk for free.
- **Claim from status plus ref, not `claim-verdict`.** The corpus divergences are decided by status; `claim-verdict` answers a different question (staleness). Using it to decide would change reclaim behaviour on the tracker timestamp, which is out of scope; the stale *ref* decision uses `acquire`'s own predicate instead.
- **Existing tokens.** Graft maps every disposition onto its existing return tokens, so the run ledger, `runcheck` and the run summary need no change.
- **`claim-verdict` stays consulted.** It decides nothing here, but the ticket asks for its captures, and recording the TTL age beside every claim decision gives FAFF-1434's replay and the morning brief the staleness evidence for free. The cost is one pure function call and one capture record on claim statuses only.
- **The no-ref rule ships with this command.** A direct autonomous graft no longer builds a peer-status issue with no build-claim ref. Graft's own Step 5 always writes the ref before it moves the issue to `In Progress`, so a faff build of this issue that lost its ref is the only legitimate case refused, and it is surfaced as `claimed-by-peer`, never silently dropped. The rule is pinned by `test/graft-admit.test.mjs` and replayed against the corpus's In Review records in this ticket (section 6).

## 6. DECISIONS AND ASSUMPTIONS

- **Chosen (ratified: human):** the build-time premise-superseded check stays agent-side in graft prose and runs only after `proceed`. It is partly judgement and partly `main`-verified, and it writes `supersession.json` and moves the issue to Done, which a read-only command cannot. The command gains no `needs-judgement` disposition.
- **Chosen (ratified: human):** the In Review slice of the corpus replay ships in this ticket, so the claim rule ships with its proof. `test/graft-admit-replay-in-review.test.mjs` replays these 14 `next` records from `verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl`, by correlation id, through `faff graft admit --mode autonomous`. Each record's facts are built from its own `normalised_inputs` (status, spec confidence, and an eligible label set when `eligible` is true), with no build-claim ref, as the corpus has none. Every one must give `claimed-by-peer`:
  - `run-20261026-213652-beepboop-list-31f750/FAFF-1403/next/1`
  - `run-20261027-024440-beepboop-list-fa4ec4/FAFF-1403/next/2`
  - `run-20261027-162841-beepboop-list-36511a/FAFF-1292/next/1`, `…/FAFF-1207/next/1`, `…/FAFF-1205/next/1`
  - `run-20261027-185215-beepboop-list-1456d4/FAFF-1292/next/1`, `…/FAFF-1207/next/1`, `…/FAFF-1205/next/1`
  - `run-20261027-185806-beepboop-list-620a46/FAFF-1292/next/1`, `…/FAFF-1207/next/1`, `…/FAFF-1205/next/1`
  - `run-20261027-191711-beepboop-list-7a746f/FAFF-1292/next/1`, `…/FAFF-1207/next/1`, `…/FAFF-1205/next/1` (spec `none`: the claim check runs before `next`'s prep routing)

  The test also asserts each record's `next` base verdict is reproduced unchanged (`graft`, or `prep` for the three spec-`none` records), so the divergence is the claim rule's alone. FAFF-1434 imports this expectation for the same records in its full replay.
- **Assumes:** `faff build-claim read` resolves the configured store (`local` or `git-remote`) the same way `acquire` does, so an own-claim test against it matches `acquire`'s own idempotency rule (`owner.session_id`).

## 7. DONE

### From WHY
- [ ] `faff graft admit` returns, for each disposition in section 3, the disposition the prose chain would have reached for the same inputs.
- [ ] Graft Step 2 calls `faff graft admit` and no longer shells `faff next`, `faff eligible`, `faff intakecheck` or `faff admissible`.
- [ ] `faff-beep-boop/SKILL.md` is unchanged by this PR.

### From WHAT and HOW
- [ ] The command reads the facts object from `--facts` (a file or `-`) and exits 2 on a missing, unparseable or schema-failing object, an invalid `--mode`, a missing `--spec-file` in autonomous mode with a found spec, or an unreachable configured tracker.
- [ ] Autonomous mode returns `claimed-by-peer` for an `in-progress` or `in-review` issue with no ref, or with a live ref whose `owner.session_id` differs from `--session-id`; interactive mode warns instead.
- [ ] Autonomous mode returns `proceed`, with a warning naming the stale claim, when the ref is held by another session and `buildClaimStaleAware` judges it stale.
- [ ] `claim-verdict` is consulted whenever `claimed_at` is present on a claim status, and its verdict appears under `kernels.claim.ttl` without changing the disposition.
- [ ] `parked` and `awaitingSpecReview` are derived from the labels with `controlLabels`; the facts object has no field for them.
- [ ] Under a configured non-default label prefix or automate-name override, an issue carrying the resolved automate label is eligible, and the intake guard sees the same label.
- [ ] With a resolvable run dir and capture on, the command writes `next` and `eligible` base records on every call that reaches step 2, including an autonomous `ineligible` one (whose `next` record carries `nextStep`'s own verdict), a `claim-verdict` base record when consulted, and the action markers in section 3's table, each sharing its base record's correlation id.
- [ ] With no resolvable run dir the command writes nothing.
- [ ] The command writes no tracker state, label, claim ref or provenance marker.
- [ ] `docs/reference/cli.md` documents the command, the facts schema and the disposition table.
- [ ] `faff commissaire` and every `commissaire*` module are unchanged by this PR.
- [ ] The command lives in `bin/lib/graft-admit.ts` with its committed emit `bin/lib/graft-admit.js`; the `.ts` is in `tsconfig.json` `include`, and `build-manifest.json` is updated in the same commit.
- [ ] `faff regions check` passes, and CI's "Fail on a stale or missing committed emit" step passes.
- [ ] `graft-admit.ts` contains no `as`, non-null `!` or `satisfies`, the `check-no-boundary-cast` lint passes, and `test/check-no-boundary-cast.test.mjs` lists `graft-admit.ts` in its pinned module list and passes.
- [ ] Graft Step 2 routes every disposition and a non-zero exit as section 4.2 lists, returns only tokens already in its return-value list, and runs the premise-superseded check only after `proceed`.

### Rule inventory
- [ ] Every row in section 4.5 has its listed test case, or is marked agent or dropped with a reason.
- [ ] Every line the PR deletes from `faff-graft/SKILL.md` maps to a row in section 4.5; the PR description lists the mapping by row number.
- [ ] `SKILL_LINE_BASELINE` for `faff-graft` is lowered to the count measured after the branch is rebased on `main`, so a sibling that changed the baseline first (FAFF-1406) is absorbed, not overwritten.

### In Review replay
- [ ] `test/graft-admit-replay-in-review.test.mjs` replays the 14 In Review records named in section 6 from `verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl`; `faff graft admit --mode autonomous` gives `claimed-by-peer` for every one, and each record's `next` base verdict is reproduced unchanged. The test fails if any named correlation id is missing from the corpus.
- [ ] The test is an ordinary `node --test` case and gates nothing beyond the test run.

### Tests
- [ ] `test/graft-admit.test.mjs` covers every reachable disposition, asserts that an eligible autonomous issue under `intake_gate: block` with no marker is never `blocked`, and covers the exit-2 causes, both modes, the own-claim, live-peer-ref, stale-ref and interactive-peer cases, the custom-prefix case, the terminal-and-ineligible case (`excluded`), `intake_gate: off`, the claim-store-unavailable exit, the marker table, the no-run-dir case and the comma-in-label case, and passes.
- [ ] The command is registered `REGION_SELFTEST_ARGV["graft"] = null` with a `TEST_FILE_COVERAGE` entry naming `test/graft-admit.test.mjs` and `test/graft-admit-replay-in-review.test.mjs`, and `lint-cli-coverage` passes.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

## Methodology critique

_Agile-delivery lens (faffter-dark-methodology-agile-delivery)._

- **Right-sized?** Yes, after the operator's 2026-10-29 split: one TypeScript command and one caller (graft Step 2), with a 30-row inventory of graft's prose. The In Review slice of the corpus replay is here (operator decision); the beep-boop caller and the rest of the replay are [FAFF-1434](https://linear.app/shftwst/issue/FAFF-1434), blocked by this ticket.
- **Workstream fit?** Fits the prose-to-code extraction lane (FAFF-1404, FAFF-1405, FAFF-1406).
- **Deps surfaced?** FAFF-1434 is blocked by this ticket, and the link exists. FAFF-1406 (#1156) changes `SKILL_LINE_BASELINE`, so whichever lands second rebases one line.
- **Risk profile?** Low to moderate. The behaviour changes for graft are named in rule-inventory rows 33, 36 and 38.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
