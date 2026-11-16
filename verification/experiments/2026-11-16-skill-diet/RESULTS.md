# Skill diet measurements

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`, at the start of the
12-hour run. The machine-readable tally is `ledger.json`. All sizes include the
whole file. Estimated tokens are `ceil(UTF-16 characters / 4)` per file, summed;
they are not provider usage or a measured cost saving.

| Skill | Bytes before | Bytes after | Saved | Estimated tokens before | After | Saved |
|---|---:|---:|---:|---:|---:|---:|
| Gateway (`faff`) | 12,984 | 5,832 | 7,152 (55.1%) | 3,222 | 1,458 | 1,764 (54.7%) |

The complete tracked skill source set started at 1,369,435 bytes and 339,279
estimated tokens. It is now 1,362,283 bytes and 337,515 estimated tokens. These
totals describe all 41 source files, not one invocation's prompt. No mandatory
dependency was added. The gateway saving applies to bare gateway loading and its
discovery description; specific heavy entry skills already load the kernel
directly and do not inherit this saving.

## Gateway fidelity

Claude Code 2.1.325, Opus 5.5 at medium effort, in the existing authenticated
`claude-retry` worker. Context was cleared between samples. Each sample answers
17 frozen routing and first-run scenarios; the oracle is a separate file that
the worker was told not to read. The interactive worker is not a security-isolated
fixture runner. The raw answers, source hashes, prompts and repeated-run screens
are retained under `runs/`.

| Arm | Samples | Correct decisions | Observed range per sample |
|---|---:|---:|---:|
| No-policy control | 1 | 9/17 | 9/17 |
| Original gateway | 5 | 85/85 | 17/17 |
| Final candidate v2 | 5 | 85/85 | 17/17 |

The control invented routes, selected the wrong lights-out entry and proposed
incorrect config mutations. Both policy arms supplied the correct route and
ordered decline actions. The initial candidate v1 also scored 17/17 once, but
failed the static heading-consumer check. Candidate v2 restores the existing
heading anchors and is the source measured in the five final samples.

These are correlated decision probes, not 85 independent trials, statistical
equivalence, or execution of the described workflows. They do not measure review
quality, full L4 behaviour, wall-clock savings or provider token usage. The first
candidate-v2 broker request stayed waiting after the model finished; its completed
raw answer was retained and graded once, with no model retry.

## Deterministic checks

64 targeted tests pass: decline-path housekeeping, adapter validation, prose-size
ratchets and malformed/missing/duplicate/unsafe-action grader cases. The gateway's
byte and line baselines were lowered. Rule inventory is checked against the
12-hour baseline before publishing the slice.

The earlier review-comment connector change is outside this baseline. Its 3,454
bytes of prior reduction and pending dedicated CRLF measurement remain separate.
