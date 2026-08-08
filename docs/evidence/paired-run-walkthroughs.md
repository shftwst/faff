# Evidence record: paired pass-and-stop runs

This is the companion evidence record for
[Why one run continued and another stopped](../guide/run-outcomes.md). It keeps
the run and ticket identifiers out of the consumer guide while retaining direct
links to the committed evidence.

These walkthroughs use two real L3 runs from this repository. Both processed an
automation-eligible queue through prep and admission. One had room in its
attempt budget and shipped changes. The other reached a zero-attempt ceiling at
the build-launch gate and stopped.

This page is an explanatory reconstruction of committed machine records. Links
go to the records themselves. The explanations are not extra runtime evidence.

## The pair at a glance

The runs are comparable examples from the same repository and pipeline, ten
days apart. They are not a controlled experiment. Their budget settings differ,
and that difference is where their paths separate.

| Boundary | Continued run | Stopped run |
|---|---|---|
| Run | `run-20260803-232227-beepboop-full` | `run-20260724-125424-beepboop-full` |
| Queue | Automation-eligible faff tickets | Automation-eligible faff tickets |
| Prep and admission | Seven tickets admitted | [FAFF-633, make SHA-256 tool selection portable](https://linear.app/shftwst/issue/FAFF-633), and [FAFF-634, pass house voice into context-stripped agents](https://linear.app/shftwst/issue/FAFF-634), admitted |
| Attempt ceiling | 500 | 0 |
| Build launch | Builds started | Refused with `budget-escalated(max_attempts)` |
| Terminal record | Owner `done`; seven tickets shipped | Owner `done`; two admitted tickets `unreached-budget` |
| Later human work needed | Review the parked and unprocessed tickets | Choose a new budget before building the admitted tickets |

## Walkthrough 1: work was allowed to continue

The 3 August run carried an attempt ceiling of 500. Its
[ledger records the budget and final owner state](https://github.com/shftwst/faff/blob/3b52027/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-676/run-ledger.json#L37-L69).
The run admitted seven tickets and shipped all seven. Other tickets were parked
at their decision boundaries, so success here means the admitted build queue
was delivered, not that every ticket in the backlog was accepted.

FAFF-620, a small sentrycheck fix, gives one inspectable path through that run:

1. **Input.** The ticket had an automation-eligible tracker record and a
   [high-confidence specification](https://github.com/shftwst/faff/blob/82c5898/docs/specs/2026-08-04-faff-620-sentrycheck-hook-defensive-catch-design.md).
2. **Prep decision.** Prep completed, then the run emitted
   [`issue-admitted` at sequence 27](https://github.com/shftwst/faff/blob/3b52027/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-676/events.jsonl#L28).
3. **Build decision.** The run emitted
   [`build-start` at sequence 31](https://github.com/shftwst/faff/blob/3b52027/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-676/events.jsonl#L32).
   The configured attempt ceiling had not been reached.
4. **Merge evidence.** The committed anchor contains a
   [completed build](https://github.com/shftwst/faff/blob/82c5898/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-620/build-progress.json),
   [verified acceptance checklist](https://github.com/shftwst/faff/blob/82c5898/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-620/ac-checklist.json),
   and [passing review verdict](https://github.com/shftwst/faff/blob/82c5898/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-620/review-verdict.json).
5. **Output.** The event record assigns FAFF-620 the
   [`shipped` outcome](https://github.com/shftwst/faff/blob/3b52027/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-676/events.jsonl#L39),
   and [PR 537](https://github.com/shftwst/faff/pull/537) records the merge.

The run later ended with the owner marked `done`. Its stop reason says the build
queue was drained and the remaining prep queue was left for another session.
That terminal state and the mix of shipped and parked outcomes are visible in
the [final ledger](https://github.com/shftwst/faff/blob/3b52027/.faff/anchors/run-20260803-232227-beepboop-full/FAFF-676/run-ledger.json#L12-L29).

## Walkthrough 2: the build launch was refused

The 24 July run used the same full unattended pipeline, but its attempt ceiling
was zero. Prep still produced buildable work. FAFF-633 and FAFF-634 were both
admitted before the next budget check.

1. **Input.** The run ledger records `max_attempts: 0` with an `escalate` policy
   at the ceiling. FAFF-633 and FAFF-634 are both in its admitted set. See the
   [terminal ledger snapshot](https://github.com/shftwst/faff/blob/5d95025/.faff/anchors/run-20260724-125424-beepboop-full/FAFF-633/run-ledger.json#L1-L25).
2. **Prep decision.** FAFF-633 completed prep, then both tickets received
   [`issue-admitted` events](https://github.com/shftwst/faff/blob/5d95025/.faff/anchors/run-20260724-125424-beepboop-full/FAFF-633/events.jsonl#L17-L20).
3. **Build decision.** The build-launch budget check recorded
   `breached: ["max_attempts"]`, `outcome: "escalate"`, and the note that a zero
   ceiling skips the build phase. See
   [sequence 22](https://github.com/shftwst/faff/blob/5d95025/.faff/anchors/run-20260724-125424-beepboop-full/FAFF-633/events.jsonl#L23).
4. **Output.** No build started. The ledger assigned both admitted tickets the
   `unreached-budget` outcome, marked the owner `done`, and recorded
   `budget-escalated(max_attempts)` as the stop reason. See the
   [terminal fields](https://github.com/shftwst/faff/blob/5d95025/.faff/anchors/run-20260724-125424-beepboop-full/FAFF-633/run-ledger.json#L36-L51)
   and [run-end event](https://github.com/shftwst/faff/blob/5d95025/.faff/anchors/run-20260724-125424-beepboop-full/FAFF-633/events.jsonl#L26).

Stopping was justified because the configured ceiling allowed no build
attempts. Admission did not override the budget. The tickets remained available
for later work; FAFF-634 was subsequently delivered in
[PR 489](https://github.com/shftwst/faff/pull/489).

## Enforced checks and attestations

The records have different strengths. Reading them together avoids treating an
attestation as physical proof.

| Record | What it establishes | Limit |
|---|---|---|
| Event record and `chain-head.json` | The committed sequence verifies against its witness | It does not prove that every external observation written into an event was true |
| Run ledger | The pipeline recorded admitted work, outcomes, budgets, and terminal state | It does not independently identify who chose a budget value |
| Budget checkpoint | The zero-attempt ceiling was binding in the stopped run; admitted work did not start | It does not establish whether zero was a sensible limit for the intended work |
| Acceptance and review files | The continued run's merge path received `all_verified: true` and `signal: pass` | Those judgements are attestations made by their producers |
| Merged pull request | The named change reached the repository | It does not prove that the change was correct |

The budget gate is enforced by the execution path: the admitted tickets became
`unreached-budget` and the run ended before a build started. The acceptance and
review results are attested. Their contracts and presence are checked, but the
underlying judgements remain claims made by their producers.

Both committed event anchors verify with:

```sh
faff events verify --run-dir .faff/anchors/<run-id>/<issue>
```

## Where human authority remains

People set the two inputs that matter here. The `faff-automate` label grants a
ticket automation eligibility, and the attempt budget limits how far an
eligible run may go. SuperDomestique does not add the eligibility label itself.

The run may prepare, admit, build, or stop only within those inputs. A person
can remove eligibility, apply `faff-automation-hold`, or start a later run with
a new budget. A stopped run does not silently relax its ceiling and does not
close unreached tickets.
