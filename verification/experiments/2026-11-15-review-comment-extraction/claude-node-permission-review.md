# Claude Code review: Node permission flag selection

Reviewed 2026-11-15 by the Claude Code verification worker. Review and tests only: no implementation edits, no credential read, no model request, no external download.

## Verdict

The patch is correct, and there is no must-fix case. The selected flag enforces the same file system, process and worker restrictions. A wrong selection on some future Node would fail closed: Node refuses the bad option, so no plan is produced and the command never runs unsandboxed.

This environment has Node 22.23.5 only. The Node 20 and Node 24 behaviour below comes from the patch logic and known Node release history. The CI matrix result on 20, 22 and 24 is the check that confirms it.

## What was reviewed

| Item | Value |
|---|---|
| Patch | `node-permission-review.patch`, 744 bytes, SHA-256 `f4fe8060fdd4c7496db6de38507c45850dcc8975d17b367c94f113df75246dc5` |
| Base | `53398152`, applied cleanly to a fresh detached tree at `/tmp/claude-501/-Users-shftwst-workspace-shftwst-faff/8916b070-29a9-4847-9cbf-e07c2085fd3f/scratchpad/review-np`, removed after this report |
| Change | One line in `eval/control-parity/candidate-command.mjs`. The first argv entry becomes `--permission` when `process.allowedNodeEnvironmentFlags.has('--permission')` is true, and `--experimental-permission` otherwise. `--allow-fs-read=<copy>/plugin` and the rest of argv are unchanged |
| Other references | No document or test elsewhere names `--experimental-permission`, so nothing else needs updating. The `--permission-mode` hits belong to the Claude CLI, not to Node |

## Validation on Node 22.23.5

| Check | Result |
|---|---|
| `allowedNodeEnvironmentFlags` | `--permission`: true; `--experimental-permission`: true; `--allow-fs-read`: true |
| Branch selected by the patch | `--permission`, as recorded in `evidence.argv[0]` of a real invocation against the committed tree. That call returned `command-exit`, exit 2, because the production planner does not exist yet |
| Child started with `--permission --allow-fs-read=<allowed dir>` | Reading outside, writing, `child_process` and `Worker` all gave `ERR_ACCESS_DENIED`. `process.permission.has('fs.read', <outside>)` returned `false` |
| Same child with `--experimental-permission` (the fallback branch) | The same four denials, and `false` |
| An unknown flag | `node: bad option: …`. Node refuses to start, so an unsupported selection cannot run the script without a sandbox |
| `node --test test/control-parity-command.test.mjs` | 15 tests: 15 pass, 0 fail, 0 skip |
| `node --test test/control-parity-command-use.test.mjs` | 13 tests: 13 pass, 0 fail, 0 skip |
| `node --test test/control-parity*.test.mjs` | 171 tests: 171 pass, 0 fail, 0 skip |

`process.allowedNodeEnvironmentFlags` is not extensible, so the fallback branch could not be forced inside the adapter. It was verified instead by starting the child directly with the fallback flag, as shown in the table.

## Expected selection by Node line (not run here)

| Node line | `--permission` advertised | Selected | Enforces |
|---|---|---|---|
| 20.x | No; only the experimental name exists | `--experimental-permission` | Yes |
| 22.x before `--permission` was added | No | `--experimental-permission` | Yes; the experimental name is still accepted |
| 22.23.5 (observed) | Yes | `--permission` | Yes (verified) |
| 24.x | Expected yes | `--permission` | Yes; the experimental name now gives exit 9, as CI observed |

## Why the tests guard this on every Node line

The command tests already assert `ERR_ACCESS_DENIED` for reading the oracle, writing a file and spawning a process. A flag that started Node without enabling the permission model would fail those tests on that matrix line. So the CI matrix checks the restriction itself, not only the flag spelling.

## Advisory

No test pins the selection expression itself, but the behavioural tests above are the stronger check. One cheap addition would be for paired preflight to record the selected flag and `process.version` beside the command probe. They are already in `evidence.argv` and `evidence.node` of `command-probe.json`, so this only needs to be visible in the readiness reasons, so that an environment problem is reported as one rather than as a candidate failure.
