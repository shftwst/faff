# Record an autonomous build-review round

Graft gives each independent review return an ordinal before dispatch. Its
recording command validates the verdict, determines standing finding identities,
and publishes a private dialogue record and the existing review evidence. The
dialogue record pins both ordinals and the captured diff digest. It carries
only the scrubbed inputs needed to finish the evidence write on retry. The
evidence writer's existing exclusive creation and schema still apply.

The reviewer chooses the finding and whether to withdraw it. The author fixes
and tests code or drafts a rebuttal. The command records the reply and charges
each reply kind once for that follow-up review round. The command evaluates
churn first, then the fix cap's convergence exception, then the independent
rebuttal cap. An already withdrawn rebutted finding can still require a judge
after another finding clears by a fix. The existing judge rules on those cases.

The caller continues to route ordinary reviews, outages, turn holds and
terminal evidence. An unavailable return leaves both histories untouched.
Resume can recover a round whose author reply or terminal action still needs
handling. The existing resume store carries both histories and keeps its own
counters and judge stage. Legacy rounds keep their numbers and saved counts.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `From a review-outage store, Step 9 reads the carried review-progress.json` | Graft restores outage retries and uses the saved dialogue independently. | test/build-review-round.test.mjs: "resume store preserves a pending reply, a partial record and caps across drains" | changed: shorter handoff retains both resume sources |
| `re-enter the build-review dialogue loop at resume.dialogue.next_round` | Resume recovers the stored action and legacy index. | test/build-review-round.test.mjs: "legacy carried dialogue keeps its round ordinal and stashed counters" | changed: recover the actionable prior round before dispatch |
| `Phase-2 critical no longer routes straight to needs-human` | Graft opts in only for the autonomous escalation and respects the same config gate. | test/build-review-round.test.mjs: "ordinary fail and human escalation keep their own actions" | changed: reworded entry and gate |
| `Each reviewer invocation writes a DialogueRoundRecord` | Validate, bind its diff, persist the dialogue and numbered floor evidence. Carry diagnostics come from the same resolver. | test/build-review-round.test.mjs: "replay repairs the pinned floor record and reply replay never consumes the cap again"; test/build-review-round.test.mjs: "safe carry reuses prior wording and the evidence handle from the actual prior dialogue round" | kept |
| `Check termination, in order` | Existing churn and convergence functions precede the independent rebuttal cap. | test/build-review-round.test.mjs: "churn outranks both caps, and strict convergence yields the exhausted fix cap"; test/build-review-round.test.mjs: "fix plateau and independent rebuttal cap pick the judge" | kept |
| `The author's bounded reply` | Validate refs and kind, bound and scrub rebuttals, preserve submitted fix commit. The author cannot mark a finding cleared. | test/build-review-round.test.mjs: "rebuttals are scrubbed before persistence and authors cannot clear findings" | kept |
| `Turn-budget exhaustion mid-loop` | The caller follows the existing hold, carrying the persisted counts. | test/build-review-round.test.mjs: "resume store preserves a pending reply, a partial record and caps across drains" | changed: reworded caller handoff |
| `if any critical still stands, or a rebuttal-driven withdrawal awaits confirmation` | Standing critical stops and rebuttal withdrawals route to the judge. A confirmed fix-only withdrawal can pass. | test/build-review-round.test.mjs: "direct and earlier rebuttal withdrawals both require the judge"; test/build-review-round.test.mjs: "fixed withdrawal goes directly to pass and collates one floor record per reviewer return" | kept |
| `A critical finding enters the dialogue loop first on an autonomous run` | The caller keeps its separate verdict and availability routing. | test/build-review-round.test.mjs: "malformed and unavailable returns cannot create either round record" | changed: updated section pointer |
| `add --prior-dir "$run_dir/<ISSUE>/build-review" on a dialogue-loop pass` | The dialogue recorder pins the reviewer's actual prior handle source and writes floor evidence once. Ordinary review uses the existing writer. | test/build-review-round.test.mjs: "safe carry reuses prior wording and the evidence handle from the actual prior dialogue round"; test/evidence-review-rounds.test.mjs | changed: dialogue path owns the once-per-return write |
