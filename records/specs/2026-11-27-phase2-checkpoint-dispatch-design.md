# Record Phase 2 at the bounded provider call

The autonomous reviewer receives its issue and captured diff from graft. The existing foreground provider wrapper can record its start and terminal outcome using those inputs. A fresh private findings file per attempt prevents a losing callback from overwriting the winner. The run checkpoint stores only the findings path.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `After Phase 1 passes, add` | The reviewer writes its Phase-1 pass and diff hash. Interactive and non-passing Phase 1 skip the checkpoint. | test/review-progress.test.mjs | kept |
| `Every Phase-2 write adds` | The wrapper binds in-flight and terminal writes to the same captured bytes and checks the attempt before publishing findings. A mandatory outage leaves Phase 2 unfinished. | test/impure/code-review-dispatch.test.mjs, test/review-progress.test.mjs | kept |
