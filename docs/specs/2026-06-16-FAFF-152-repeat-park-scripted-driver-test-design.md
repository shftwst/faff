# Spec — FAFF-152: repeat-park scripted-driver test + `faff park-history` seam (deterministic — test/, not eval/)

> Spec: faffter-dark-nlspec · 2026-06-16 · interactive · confidence: high. Full spec on Linear FAFF-152.

_Revised 2026-06-16 (interactive reprep): resolved the seam-scope Punt → build the `faff park-history` seam inside this ticket. Re-rated medium → high._

For the build agent and human reviewers. A **faff-internal test-coverage + deterministic-seam** change: add the `faff park-history` CLI seam AND a scripted-driver `test/` case for faff-tidy's **repeat-park** structural diagnostic, shipping together in one PR. **No product behaviour changes** — it adds the deterministic counting seam the repeat-park demotion implicitly relies on, plus its regression net.

## 1. WHY

**Problem statement.** faff-tidy's repeat-park demotion (≥3 same-root-cause parks in 21 days → demote Todo→Backlog + tag `repeat-parked`) is load-bearing structural-diagnostic logic with **no test**. FAFF-147 spun it out here as "deterministic, belongs in `test/` not `eval/`" because it is counting, not LLM judgement.

**The seam problem (the crux this spec settles).** The explore found there is **no deterministic code seam** for repeat-park today:

| What exists | What it does | What it does NOT do |
|---|---|---|
| `faff state <issue>` (`plugin/skills/faff/bin/faff`) | returns `parked: bool` for one issue (newest-run-wins, from `park.md` existence) | no park *history*, no root-cause class, no count, no 21-day window |
| `faff contract automation-routing` | validates a *given* `{verdict, root_cause}`'s **shape** | does not *compute* the verdict from park history |
| `faffter-noon-methodology-structural` SKILL §`backlog-diagnostics` (line 79) | **prose**: "Reads last 50 `.faff/runs/*/summary.md`; classifies each park by the root-cause class enum" | this is the **methodology/LLM** doing it — not backed by any CLI code |

So the repeat-park diagnostic is **split**: the per-park *root-cause classification* is LLM judgement (which is why it is NOT in `eval/`… but also can't be in a scripted `test/`), while the *count + 21-day window + threshold* is purely deterministic and **belongs in code**. This ticket builds that code seam and tests it.

**Why this matters for the test.** The scripted driver (`test/helpers/skill-harness.mjs`) only *replays a hand-authored seam script*; it cannot itself read summaries and count. A test that hand-authors the parks AND hand-authors the "repeat-parked" bucket asserts its own input — the exact tautology the FAFF-94 harness header forbids. **A meaningful `test/` case therefore requires a real deterministic CLI seam the test drives via `ctx.cli` and asserts the parsed result of** — same shape as the existing cases asserting `faff next` / `faff eligible`. That seam is the first deliverable of this ticket.

**Reference context.**

| System | Lang | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`cmdState`, `findLatestRunDir`, `readLedger`, dispatch in `main`) | JS | Where the new `faff park-history` (or `faff repeat-parks`) deterministic seam is added |
| `test/faff-tidy.test.mjs` (FAFF-94/95) | JS | The scripted-driver pattern to mirror exactly |
| `test/helpers/seed-repo.mjs` (`runs[].summary`, `runs[].parks`) | JS | Already writes `.faff/runs/<id>/summary.md` + `.faff/runs/<id>/<issue>/park.md`; extended to carry park metadata |
| `test/helpers/skill-harness.mjs` (`runSkill`, `scriptedDriver`, `recordBucket`, `recordMutation`, `cli`) | JS | The harness seams the test drives |
| `test/helpers/decision-assert.mjs` (`expectCliResult`, `expectBucket`, `expectMutation`, `expectSeamOrder`) | JS | The matchers the assertions use |
| gateway line 648 · faff-tidy §5 line 231 · routing line 39 | MD | Confirm the 21-day / ≥3 threshold + demote + tag behaviour |

## 2. OUT OF SCOPE

- **Per-park root-cause classification as LLM judgement** — *excluded.* The fixed enum (`punt-not-closed`/`gap`/`cycle`/`spec-ambiguous-external`/`other`) is *assigned by the routing_adaptor at park time* and recorded in the summary; both the seam and this test **read it back from the fixture**, never re-derive it. (That re-derivation, if ever wanted, is an `eval/` judgement — explicitly FAFF-147's line.)
- **The demote/tag *action* in production faff-tidy** — already prose-specced; this ticket adds the seam + its test, not new tidy behaviour.
- **Wiring the seam into the live faff-tidy SKILL prose** — the seam + test ship here; updating §5 to *call* the seam is a separate (recommended) follow-up, noted in §6.

## 3. WHAT

**Two deliverables, one PR.** This ticket ships both halves together: (1) the `faff park-history` deterministic CLI seam, and (2) the scripted-driver `test/` case that drives it.

**Vocabulary.**

| Term | Definition |
|---|---|
| park | One autonomous-run park of one issue, recorded in that run's `summary.md` with its issue_id, root_cause_class, timestamp. |
| root_cause_class | One of the fixed five (`punt-not-closed`, `gap`, `cycle`, `spec-ambiguous-external`, `other`) — assigned by the routing_adaptor, read back here. |
| repeat-park | An active issue with **≥3 parks of the same root_cause_class within a rolling 21-day window**. |
| park-history seam | A deterministic CLI subcommand that reads the last ~50 `.faff/runs/*/summary.md`, parses park metadata, and emits per-issue same-class counts within the window. |

**Decision — build the `faff park-history` deterministic seam inside FAFF-152.** **Chosen:** build the `faff park-history` deterministic seam inside FAFF-152 — the subcommand and its scripted-driver test ship in one PR. Add a `faff park-history` (name TBD at build; `repeat-parks` also fine) subcommand to `plugin/skills/faff/bin/faff` that: globs `.faff/runs/*/summary.md` (newest ~50 by run-id lexical order, reusing `findLatestRunDir`-style logic), parses each park's `{issue_id, root_cause_class, timestamp}`, windows to 21 days from a `--now` arg (injected for determinism — no ambient clock), and emits JSON of per-issue same-class counts + a `repeat_parked: [issue_ids]` list at the ≥3 threshold. It ships with a `--selftest` table (like `next`/`eligible`/`contract`). Building it here keeps the deterministic logic and its regression net together in one reviewable unit; the seam is small, self-contained, and fully deterministic.

**Decision — what the scripted-driver test asserts.** **Chosen:** the test drives the **real deterministic CLI seam** (`faff park-history --issue <id>` / `faff repeat-parks`) over seeded summary fixtures and asserts (a) the parsed seam result flags the ≥3-same-class issue and not the under-threshold/mixed-class ones, then (b) as proof-of-mechanism, that faff-tidy's recorded `setStatus Todo→Backlog` + `addLabel repeat-parked` mutation and the `repeat-parked` bucket follow. Mirrors `test/faff-tidy.test.mjs` Scenario A: `expectCliResult(rec, "park-history", {json:{…}})` is the non-tautological assertion; `expectBucket` + `expectMutation` are the plumbing. At least 3 cases: **flag** (3 same-class in window), **no-flag/under-threshold** (2 same-class, or 3rd outside 21 days), **no-flag/mixed-class** (3 parks, different classes).

**Decision — summary.md park-metadata fixture format.** **Chosen:** parks are recorded in each run's `summary.md` as a **fenced ` ```faff-parks ` JSON block** (one block per run, array of park records), parsed by the seam between fail-loud anchors — mirroring the established `faff-contract:<name>` fenced-JSON convention the codebase already uses (spec-readiness / delivery-outcome blocks). Shape:

````
```faff-parks
[ { "issue_id": "FAFF-201", "root_cause_class": "punt-not-closed", "timestamp": "2026-06-01T09:00:00Z" } ]
```
````

- `issue_id` — tracker identifier; `root_cause_class` ∈ the fixed five; `timestamp` — ISO-8601 UTC of the park.
- **Rationale for fenced-JSON over free prose:** the seam is deterministic, so its input must be machine-parseable, not regex-scraped from narrative. A fenced block with a stable fence tag is the codebase's existing idiom for "structured data the CLI parses out of a markdown artifact." It coexists with the human-readable digest prose in the same `summary.md`.

**Decision — threshold (confirmed, not invented).** **Chosen:** **≥3 parks, same `root_cause_class`, rolling 21-day window** → flag; faff-tidy then demotes Todo→Backlog + tags `repeat-parked`. Confirmed identical across gateway (line 648), faff-tidy §5 (line 231), structural methodology (lines 44/79), routing adaptor (line 39). Built-in default, not a `.faffrc` knob.

**Decision — fixture-writing helper.** **Chosen:** **extend `seedRepo`'s existing `runs[]` input** — `runs[].summary` already lands at `.faff/runs/<id>/summary.md`; tests pass the ` ```faff-parks ` block as part of `summary`, OR (cleaner) add a thin `runs[].parks_meta: [{issue_id, root_cause_class, timestamp}]` convenience that `seedRepo` serialises into the fenced block. Prefer the convenience field so cases stay declarative; no new top-level helper needed.

## 4. HOW

```
PROCEDURE add_repeat_park_seam_and_test:
  1. plugin/skills/faff/bin/faff: add cmdParkHistory(args):
       - resolve root (--root | findRoot); glob .faff/runs/*/summary.md
       - newest ~50 by run-id lexical desc (reuse the findLatestRunDir ordering)
       - for each: extract the ```faff-parks fenced JSON block; JSON.parse;
         fail-loud on a malformed block (exit 2), tolerate its absence (no parks)
       - --now <ISO> (required for determinism); window = now - 21d
       - per issue_id: count parks per root_cause_class within window;
         emit { counts: {issue:{class:n}}, repeat_parked: [issue_ids with any class>=3] }
       - wire into main() dispatch; add a --selftest fixture table
  2. test/helpers/seed-repo.mjs: add runs[].parks_meta -> serialise a ```faff-parks
     block appended into that run's summary.md (keep runs[].summary still honoured).
  3. test/faff-tidy.test.mjs (or test/faff-tidy-repeat-park.test.mjs): add cases:
       Case FLAG:    seed 3 runs, same issue ISS-RP, root_cause_class "punt-not-closed",
                     timestamps within 21d of --now. Drive:
                       { cli: ["park-history", "--issue", "ISS-RP", "--now", FIXED_NOW] }  // REAL
                       { verdict: { issue:"ISS-RP", token:"repeat-parked", source:"faff park-history" } }
                       { bucket: { name:"repeat-parked", issues:["ISS-RP"] } }
                       { mutate: { op:"setStatus", issue:"ISS-RP", args:{status:"Backlog"} } }
                       { mutate: { op:"addLabel", issue:"ISS-RP", args:{label:"repeat-parked"} } }
                     Assert: expectCliResult(rec,"park-history",{json:{repeat_parked:["ISS-RP"]}});
                             expectBucket(rec,"repeat-parked",["ISS-RP"]);
                             expectMutation(rec,{op:"setStatus",issue:"ISS-RP",args:{status:"Backlog"}});
                             expectMutation(rec,{op:"addLabel",issue:"ISS-RP",args:{label:"repeat-parked"}});
       Case UNDER:   2 same-class parks (or a 3rd timestamped > 21d before --now).
                     Assert: expectCliResult(...,{json:{repeat_parked:[]}}); expectNoBucket(rec,"repeat-parked").
       Case MIXED:   3 parks, three different root_cause_class values.
                     Assert: repeat_parked == [] (threshold is per-class).
  4. Ensure-before-tag: the label `repeat-parked` is a faff control label — the test
     asserts the addLabel ATTEMPT (harness records, never applies), consistent with the
     existing park-clear case.
```

**Anti-pattern:** hand-authoring the `repeat-parked` bucket as the *only* assertion. **Why:** that asserts the test's own input. The load-bearing assertion is `expectCliResult` on the real `faff park-history` computation — the bucket/mutation are proof-of-mechanism, exactly as the existing cases treat `faff next`.

**Anti-pattern:** reading an ambient clock in the seam. **Why:** breaks determinism; the 21-day window must be computed from an injected `--now`, like the seed-repo determinism env neutralises git dates.

## 5. SCENARIOS

```
Given .faff/runs holds 3 run summaries each recording a park of ISS-RP with
      root_cause_class "punt-not-closed", all within 21 days of the fixed --now,
When faff-tidy runs and the test drives `faff park-history --issue ISS-RP --now <fixed>`,
Then the real CLI returns repeat_parked: ["ISS-RP"],
 And the captured tidy decision demotes ISS-RP Todo→Backlog and tags `repeat-parked`.
```
```
Given only 2 same-class parks for ISS-UNDER (or a 3rd dated > 21 days before --now),
When the seam runs,
Then repeat_parked is [] and no repeat-parked bucket/demotion is recorded.
```
```
Given 3 parks of ISS-MIXED across three different root_cause_class values,
When the seam runs,
Then repeat_parked is [] (the threshold is ≥3 of the SAME class).
```

Non-functional: **`node --test` stays green**, zero processes beyond the real `faff` CLI the harness already shells (same as the existing faff-tidy cases).

## 6. DESIGN DECISION RATIONALE

**Why the code seam ships in this ticket.** The scripted driver replays decisions; it has no compute of its own. "Deterministic diagnostic" only earns a non-tautological `test/` case if the determinism lives in code the test *calls*. Today it lives in methodology prose the LLM executes. FAFF-147 routed repeat-park to `test/` on the *correct* premise (it's counting, not judgement) but the seam to make that testable was never built — so this ticket builds it. *(Considered and rejected: splitting the seam into its own blocking ticket and making FAFF-152 depend on it. Rejected — the seam is small, self-contained, and fully deterministic; keeping the logic and its regression net in one reviewable PR is cleaner than a two-ticket dependency hop. Human-resolved 2026-06-16.)*

**Why fenced-JSON in summary.md.** The codebase already parses structured data out of markdown via fenced `faff-contract:<name>` blocks; a deterministic seam needs the same machine-readable input, not narrative scraping. Coexists with the human digest.

**Why read root-cause back, never re-derive it.** Classifying *why* a park happened is judgement (the routing_adaptor's job at park time); the seam and test assert the *counting over already-classified parks*, keeping this firmly deterministic and out of `eval/`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — the seam-scope call (build inside FAFF-152 vs split) is resolved (build inside, see §3 / §6). The spec is settled.

**Assumptions.**
- **Assumes:** the harness + helpers retain the structure the explore found — `seedRepo`'s `runs[].summary`/`runs[].parks` writers, `runSkill`/`scriptedDriver`, the `expectCliResult`/`expectBucket`/`expectMutation` matchers, and the `faff` CLI `main` dispatch + `findLatestRunDir`/`readLedger` helpers. *Validation:* re-read those before editing; if a seam moved, re-locate.

## 8. DONE

### From WHY
- [ ] repeat-park has a regression net: an edit that breaks the ≥3/21-day/same-class counting makes a `test/` case fail.
- [ ] The deterministic counting lives in a CLI seam the test *calls* (not hand-authored buckets) — no tautology.

### From WHAT / HOW — deliverable 1: the `faff park-history` CLI seam
- [ ] `faff park-history` (or `repeat-parks`) added to `plugin/skills/faff/bin/faff`: globs newest ~50 `.faff/runs/*/summary.md`, parses the ` ```faff-parks ` block, windows on `--now` (no ambient clock), emits per-issue same-class counts + `repeat_parked` at ≥3, with a `--selftest` table.
- [ ] `summary.md` park metadata format is the ` ```faff-parks ` fenced JSON array of `{issue_id, root_cause_class∈fixed-five, timestamp}`.
- [ ] Threshold verified against gateway/faff-tidy/routing (≥3, same class, 21 days).

### From WHAT / HOW — deliverable 2: the scripted-driver test
- [ ] `seedRepo` writes park metadata (via `runs[].parks_meta` or `runs[].summary`).
- [ ] ≥3 scripted-driver cases (FLAG / UNDER / MIXED), each asserting the **real** `faff park-history` result via `expectCliResult`, plus the demote+tag mutation as proof-of-mechanism.

### Non-functional
- [ ] `node --test` green; zero new process spawns beyond the real `faff` CLI.

**Integration smoke:** `node --test test/faff-tidy*.test.mjs` exits 0 with the new cases; `faff park-history --selftest` passes.

confidence: high
