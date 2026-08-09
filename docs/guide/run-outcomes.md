# Why one run continued and another stopped

This page is for teams deciding whether an unattended run can stop safely. Read
[Unattended runs at L3](unattended.md) first. Continue with
[Run unattended work on your own machine](self-hosted-rig.md) when you are ready
to provide a persistent host.

These walkthroughs use two real L3 runs from this repository. Both processed an
automation-eligible queue through prep and admission. One had room in its
attempt budget and shipped changes. The other reached a zero-attempt ceiling at
the build-launch gate and stopped.

The runs used the same repository and pipeline, ten days apart. They are not a
controlled experiment. Their budget settings differ, and that difference is
where their paths separate.

| Boundary | Continued run | Stopped run |
|---|---|---|
| Queue | Automation-eligible tickets | Automation-eligible tickets |
| Prep and admission | Seven tickets admitted | Two tickets admitted |
| Attempt ceiling | 500 | 0 |
| Build launch | Builds started | Refused at the budget gate |
| Terminal record | Owner `done`; seven tickets shipped | Owner `done`; two tickets `unreached-budget` |
| Human follow-up | Review parked and unprocessed tickets | Choose a new budget before building the admitted tickets |

## Walkthrough 1: work was allowed to continue

The run had a 500-attempt ceiling. Seven tickets completed prep, crossed
admission, and started builds. For one representative change, the committed
record contains a completed build, a verified acceptance checklist, and a
passing review verdict. The pull request merged and the run recorded the ticket
as shipped.

The run ended with its owner marked `done`. Its build queue was drained, but
some other tickets had parked at their own decision boundaries and part of the
prep queue remained for another session. Here, success means all admitted work
shipped. It does not mean every backlog item was accepted.

Continuing was justified because the work crossed admission, remained within
the attempt budget, and presented the required merge-floor records.

## Walkthrough 2: the build launch was refused

The second run used the same full unattended pipeline with a zero-attempt
ceiling. Prep still produced two buildable tickets and admitted them. The next
budget checkpoint recorded that the attempt ceiling had been reached and chose
`escalate`.

No build started. The run marked both admitted tickets `unreached-budget`,
marked its owner `done`, and ended with a budget-escalation reason. The tickets
remained available for later work.

Stopping was justified because admission does not override the budget. The run
did not silently increase its limit or reinterpret the missing allowance as
permission to build.

## Enforced checks and attestations

The budget gate was binding in the stopped run. The admitted tickets received
terminal `unreached-budget` outcomes and no build-start event. That is an
enforced execution decision recorded by the run.

The acceptance checklist and review verdict in the continued run are
attestations. Their contracts and presence are checked, but their underlying
judgements remain claims made by their producers. A merged pull request proves
that a change reached the repository, not that every judgement was correct.

[Inspect the two committed run records](https://github.com/shftwst/faff/blob/main/verification/evidence/paired-run-walkthroughs.md)
for the run ledgers, event sequences, merge records, verification command, and
the limits of each evidence type. That page is an explanatory reconstruction;
its links point to the machine records themselves.

## Where human authority remains

People set the two inputs that matter here. The `faff-automate` label grants a
ticket automation eligibility, and the attempt budget limits how far an
eligible run may go. SuperDomestique does not add the eligibility label itself.

The run may prepare, admit, build, or stop only within those inputs. A person
can remove eligibility, apply `faff-automation-hold`, or start a later run with
a new budget. A stopped run does not close unreached tickets.
