# Stored review comment handoff

Implementation is committed and deterministic checks pass. The fresh Claude
diagnostic is prepared but has not run. Historical model failures remain failures.

## Shipped boundary

```text
model: issue + replacement -> prepare -> preview + reference
model: reference -> apply -> live snapshot recheck -> stored tracker write
```

The production modules are `review-comment-session.ts`, `review-comment-mcp.ts`
and `review-comment-server.ts`, with committed JavaScript emit. The standalone
entry point is `plugin/skills/faff/bin/faff-review-comments.mjs`. It wraps an
operator-configured upstream MCP connector; authentication stays upstream.

## Deterministic verification

| Check | Observed result |
|---|---|
| Full local suite at `87d923631f99dfd80127fbff03ebcac583798569` | 8,655 passed, 0 failed, 6 skipped |
| Final focused planner, connector, handoff and TS tests | 124 passed, 0 failed |
| Node 20.20.2 planner and connector tests after acknowledgement fix | 110 passed, 0 failed |
| Existing parity harness plus initial handoff tests | 173 passed, 0 failed |
| All eleven unchanged oracle cases through production MCP subprocess | Passed: exact effect arguments, terminal reason and persisted final state |
| Escaping mutation | Grader rejects a body transformed by `JSON.stringify(body).slice(1, -1)` |
| Actual eval stdio entry with cleared environment | Prepare/apply/finish completes through the bound production connector |
| Build, region graph, adapter/prose lint, CLI coverage and rule inventory | Passed |

The final focused run includes the later acknowledgement fix: an upstream result
containing an ID plus an explicit failure is uncertain, not acknowledged. A real
fixture write followed by a lost acknowledgement consumes its reference and does
not issue a second write.

Other cases cover CRLF, Unicode, literal backslashes, detached preview mutation,
body/target overrides, unknown/foreign-session/expired/consumed references, stale
snapshots, concurrent apply, bounded storage, upstream timeouts and unsupported
listing shapes. The MCP tests use a separate upstream process. No hosted tracker
was changed or qualified by these tests.

Local suite command uses a process-only signing override for test repositories:

```sh
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false \
  node --test test/*.test.mjs
```

The final focused command is:

```sh
node --test test/review-comment.test.mjs test/review-comment-session.test.mjs \
  test/review-comment-mcp.test.mjs test/review-comment-handoff-eval.test.mjs \
  test/check-no-boundary-cast.test.mjs
```

## Claude diagnostic preparation

Candidate: `1f2d75335d305be0ff14f1428f2bc56873a9dafa`.
Production plugin tree: `95a737122d9d74167045d24fa0619c6a47f11991`.
Harness tree: `823edd39265212712037ad236c602ee255d91663`.

- Fresh `review-comment-stored-handoff-v1` treatment, not the old planner-only arm.
- One `crlf-outside-region` attempt, no retries, $0.50 cap, Opus 5.5 medium.
- Exposes prepare/apply/finish only. Calls and exact upstream tracker effects are
  recorded independently; production code is bound to its committed artifacts.
- Capture-only preflight must match model, effort, tools, policy and credentials
  before a forwarded provider request. First-request runtime must match preflight.
- The fixture and expected effect are unchanged. The trace's oracle policy is
  loaded from released commit `690546db64e3de7a68058a98a9945bfb731e68b3` and its
  hash checked against the existing registry.
- A pass would establish this candidate's one-case fixture behaviour. It would
  not pass the earlier paired run, qualify hosted tracker pagination/authentication
  or establish cost/latency savings.

Both the managed checkout and the shared worker checkout passed `--prepare-only`.
The shared checkout is `.worktrees/review-comment-handoff`. The host launcher is
[launch-host.sh](launch-host.sh); the current Codex container cannot reach the host
Docker daemon. It starts the evaluator through the worker container's configured
OAuth environment without reading or copying the token.

## Source size

The review-comment policy section is 4,337 bytes at the released baseline and
1,488 bytes with stored handoff, a reduction of 2,849 bytes (65.7%). Including the
earlier 605-byte graft reduction gives 3,454 fewer loaded source bytes at those two
sites. These are source sizes, not whole-workflow token, cost or latency results.
