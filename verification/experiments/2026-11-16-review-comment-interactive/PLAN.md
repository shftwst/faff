# Interactive stored-comment execution

This is a new treatment, not a rerun of the restricted MCP/proxy experiment.
The authenticated Claude worker can execute tools interactively, while its child
shells do not inherit the OAuth token needed by that original metered runner.
Use the worker's existing session to exercise the production connector through a
bounded file-mailbox bridge. Do not read or copy credentials.

- Production pin: `a8509086ad28fa0e55cf3d1d818f2055294e663b`, in the detached
  `review-comment-interactive` worktree.
- Scenario and independent expected effects: existing `crlf-outside-region`.
- Oracle policy: unchanged released source at `690546db64e3de7a68058a98a9945bfb731e68b3`.
- Model: existing `claude-retry` worker, Claude Code 2.1.325, Opus 5.5 medium.
- One candidate model attempt, after a programmatic bridge preflight. Clear the
  worker context before submission. No model retry after a failed result.
- Available fixture operations: prepare, apply and finish. The production
  connector owns the live reads and stored-body write; the model passes the
  returned reference to apply.
- Record every bridge request/response, connector call/result, tracker read,
  attempted effect, acknowledgement and terminal state. Require the existing
  oracle's exact effect and final-state hashes, and the handoff grader's exact
  prepare/apply/finish order.

The worker still has broader Bash/file capabilities than a restricted MCP tool
runner. The task forbids other reads or effects, but this is not a security
isolation claim. Provider token usage, served-model metadata per request and
billed cost are unavailable. Preserve the original trace grader's resulting
`incomplete` classification; report behaviour separately. Do not qualify a hosted
tracker or claim paired acceptance from this single fixture run.

The first draft of this plan was recorded after execution. The treatment,
single-attempt bound, input/source hashes and scope were written by the harness
before the model task; the raw worker prompt is retained. This document explains
that existing record rather than claiming a preregistered experiment.
