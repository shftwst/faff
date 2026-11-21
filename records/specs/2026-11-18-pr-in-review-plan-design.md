# Plan the post-PR In Review breadcrumb

The new read-only PR command accepts the existing PR-open tracker descriptor and the fresh connector observations. A plan is actionable only for a live In Progress issue with an available In Review-type workflow state. The caller still resolves the destination state through tracker MCP and sends the update through the existing authenticated tool. The old command's governed bit determines whether the planner returns the issue-bound effects bracket. The supplied run directory is the same explicit directory used for PR open.

The caller declares before the connector write and observes only a confirmed success. Record failures remain advisory. A malformed or mismatched descriptor fails locally and leaves the build flow free to proceed without a status write.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `In Review transition (after faff pr open returns opened or already-open, before Step 10)` | The caller obtains fresh tracker facts after PR open and the CLI selects its optional write. | test/graft-in-review-bracket.test.mjs | kept |
| `PROCEDURE transition_to_in_review(issue)` | The pure planner returns a no-op for an unavailable destination or a status beyond the supported source. The caller performs the write and continues after failures. | test/graft-in-review-bracket.test.mjs | kept |
| `Use Step 5's live-status re-read and agent-mediated forward-rank save_issue` | Fresh read and writing stay with MCP. The planner only returns the forward update for In Progress. | test/graft-in-review-bracket.test.mjs | kept |
| `Anti-patterns: adding faff status set` | The new command only plans. The status write and post-failure progress remain in the skill. | test/graft-in-review-bracket.test.mjs | kept |
| `Governed In Review tracker-write record (on a governed run)` | The CLI returns the validated existing descriptor and the exact shared arguments for declaration and observation. The caller brackets the connector action and keeps errors advisory. | test/graft-in-review-bracket.test.mjs | kept |
| `Proceed to Step 10.` | All outcomes of the breadcrumb lead to Step 10. | test/graft-in-review-bracket.test.mjs | changed: route states named in the retained instruction |
