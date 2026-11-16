# Skill diet measurements

Gateway entry-boundary qualification is complete. The adversarial reduction
remains draft pending context-v3 workflow qualification.
Raw trace review found that long policies embedded as one JSON string could be
truncated by Claude's file display. The first adversarial baseline also reported
a scratch-file read/write outside the fixture rules. Earlier effect comparisons
remain useful diagnostics, but do not count as completed qualification.

Baseline: `a8509086ad28fa0e55cf3d1d818f2055294e663b`, at the start of the
12-hour run. The machine-readable tally is `ledger.json`. All sizes include the
whole file. Estimated tokens are `ceil(UTF-16 characters / 4)` per file, summed;
they are not provider usage or a measured cost saving.

| Skill | Bytes before | Bytes after | Saved | Estimated tokens before | After | Saved |
|---|---:|---:|---:|---:|---:|---:|
| Gateway (`faff`) | 12,984 | 5,832 | 7,152 (55.1%) | 3,222 | 1,458 | 1,764 (54.7%) |
| Adversarial review | 74,897 | 22,259 | 52,638 (70.3%) | 18,574 | 5,565 | 13,009 (70.0%) |
| Changed files combined | 87,881 | 28,091 | 59,790 (68.0%) | 21,796 | 7,023 | 14,773 (67.8%) |

The complete tracked skill source set started at 1,369,435 bytes and 339,279
estimated tokens. It is now 1,309,645 bytes and 324,506 estimated tokens. These
totals describe all 41 source files, not one invocation's prompt. No mandatory
dependency was added. The gateway saving applies to bare gateway loading and its
discovery description; specific heavy entry skills already load the kernel
directly and do not inherit this saving.

`load-manifest.json` records the nine entry skills' declared cold reads plus the
bare gateway. Each dependency is counted once and missing files fail the tally.
Map and wtf explicitly exclude the autonomous reference. These entry sets exclude
delegated skills, dynamic outputs, catalog, system prompts and history; review
stage savings are reported separately rather than attributed to every entry.

## Adversarial-review fidelity

The original and candidate v2 each passed all 37 workflow decisions in five
fresh Claude samples: 185/185 per arm. Cases cover Phase-1 short circuit,
interactive versus unattended criticals, fixture caps, configuration and helper
exits, L4 mandatory review, run-dir forwarding, checkpoints, carry handles,
attribution, trim/default settings, ADR/PRDR contracts and rebuttals.

Both versions also passed eight artifact-review cases in five fresh samples:
40/40 per arm, including two clean cases. Six cases come from the existing
refutation-code suite; two test lost concurrent updates and a no-op implementation
with a vacuous test. An existing purportedly clean psql example was excluded
before measurement because its shown invocation does not implement the binding
its oracle assumes. The source hashes and reason are in
`adversarial-quality-sources.json`. Both arms receive the same required 897-byte
fixture guidance. These quality fixtures were frozen after candidate authoring,
before any quality response; they are additional checks, not a preregistered
holdout.

The workflow fixture went through explicit answer-format corrections. All raw
versions remain: the first draft used an invalid Phase-1 verdict name; later
wording ambiguously requested a full command or command name. The flagged
baseline/candidate answers named the right helper path but differed in whether
they included flags or the CLI prefix. Final v5 requests executable and subcommand
as separate array elements. The semantic requirements were unchanged. The latest
preliminary no-policy control passed 11/37; its fixture differs in that formatting
question, so it is not pooled into the final comparison.

Static checks also caught two candidate-v1 issues: the fixture-cap set name must
remain visible beside the escalation set, and ADR outcomes must use the canonical
CLI describe surface rather than a copied enum. Candidate v2 fixes both. Original
helper coverage passed 551 tests. After the final prompt and ratchet changes,
99 targeted tests passed, including the affected cap/adapter checks, size tests
and the exact-decision/load-set grader tests. The intermediate broad run passed
591 tests and exposed those two static failures; it is not reported as green.

The new operator configuration page is optional reference, not another mandatory
review read. No helper behaviour, default or model choice changed. These small,
correlated samples support the tested decisions and defect examples; they do not
establish statistical non-inferiority or exercise the full two-model pipeline.

## Gateway execution effects (superseded delivery treatment)

Five fresh samples per arm executed five independent first-run and dispatch cases
through the real pinned CLI. Both arms passed 25/25 cases. Normalised mutation
order, onboarding prompts, dispatches and final file contents matched across all
ten runs. No-write cases preserved file contents and modification times. There
were no rejected calls. The original made 34 config-path reads; the candidate
made 25. The nine extra original reads are visible in raw traces and made no
mutations.

This effect comparison awaits policy-delivery requalification. Downstream skills
are stubs, with the
onboard stub using real CLI setup; full downstream workflows are not claimed.
All reports, operations, file snapshots, source hashes, worker prompts and screens
are retained under `workflow-runs/`. `gateway-execution-results.json` binds the
reports and records the cross-arm comparison. The fixture and oracle were frozen
before model execution.

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

64 gateway targeted tests pass: decline-path housekeeping, adapter validation, prose-size
ratchets and malformed/missing/duplicate/unsafe-action grader cases. The gateway's
byte and line baselines were lowered. Rule inventory is checked against the
12-hour baseline before publishing the slice.

The earlier review-comment connector change is outside this baseline. Its 3,454
bytes of prior reduction remain separate. The interactive CRLF fixture passed
its behaviour check; provider-accounting qualification remains incomplete. See
`../2026-11-16-review-comment-interactive/RESULTS.md`.

## CI correction and candidate v3

CI run 43808978097 caught six assertions in three test files: canonical review
lens labels, the ADR independence sentence, and finding identity/carry example
wording. Candidate v3 restores these source interfaces without weakening tests.
The affected tests and adapter checks pass 158/158 locally. The original failing
run remains recorded; it is not a green result. V2 model evidence remains bound to
v2. V3 separately passed 185/185 decisions and 40/40 artifact decisions in five fresh
samples for each suite. These compare with the unchanged original policy and
fixtures in the five recorded baseline samples. V2 evidence remains historical.
Execution qualification is still pending.

## Policy delivery correction

`workflow-fixtures/DELIVERY-V2.md` records the delivery fault, protocol failures
and new treatment before new samples. Policy bytes are unchanged. The new reader
returns at most 6,000 UTF-16 characters per call, records every chunk hash, and
refuses workflow calls until the full policy has been delivered in sequence.
Old reports remain unchanged; their `pass` labels refer to the captured effect
grade, not acceptance under the corrected delivery protocol.

## Delivery-v2 effects and protocol findings

Gateway effects passed 25/25 cases per arm, with matching normalised effects and
final state. The original made 25 config-path reads and the candidate 20. Full
policy delivery was recorded. However, three final screens report reading the
mandatory global guidance despite the fixture's file restriction. Those runs
fail the frozen protocol; the numerical result is not qualification. See
`gateway-delivery-v2-protocol-review.json`.

The adversarial baseline passed nine of ten cases and failed forwarding the
one-second budget, using 12 seconds instead. The failed sample is retained.
A candidate attempted an inline JSON builder that the fixture prohibited and
Claude Code rejected. Its screen is retained independently of its later effects.

`workflow-fixtures/CONTEXT-V3.md` records the corrected common-context treatment
and literal JSON bridge. The challenge caller now forwards and checks its
proposal flags. All 14 affected harness tests pass. The previous committed head
passed every required CI check (run 43815075029). No production skill or effect
oracle changed during these corrections.

The completed delivery-v2 candidate passed 3/10 exact-copy cases: in seven system
files it changed `fixture's kind` to `fixture kind`. Budget forwarding and gate
outcomes passed, but those do not waive the copy failure or the reported inline
program/combined-call protocol violations. The context-v3 literal JSON treatment
retains the exact-copy oracle and unchanged policy.

## Gateway qualification completed with context-v3

Five fresh samples per arm passed all five cases: 25/25 each. The complete policy
was supplied before operations. Normalised writes, prompts, skill dispatches and
final files matched across all ten samples. Protected no-write state was
unchanged. The original made 25 config-path reads and the candidate 23. All ten
retained final screens were inspected in full; none reports a prohibited action.
The same 22,605-byte operator-guidance source was requested in both arms and its
hash remained unchanged.

`gateway-context-v3-results.json` binds the numerical results;
`gateway-context-v3-native-review.json` records protocol review and scope. This
qualifies the changed gateway entry boundary, with real CLI mutations and stubbed
downstream skills. Screens are partial viewports, not complete native tool logs.
Full downstream workflows, statistical equivalence and provider cost are not
claimed. Earlier treatments and failures remain separate.

Across five runs, the recorded task/bridge payload proxy was 100,015 bytes and
24,915 estimated tokens before, versus 62,170 bytes and 15,570 estimated tokens
after. This counts each task and successful bridge result once. It excludes
native guidance reads, system/catalog/history, model output and tool framing;
it is separate from the source-size tally and is not provider usage.

## Challenge native-hook interruption

Context-v3 challenge effect grades passed, but retained screens for baseline-2,
baseline-3 and candidate-2 report local merge-fence rejection of the literal
merge command quoted inside JSON reasoning. Rewording later does not waive the
rejected attempt. These samples do not qualify under the no-rejection protocol.
`workflow-fixtures/FILE-INPUT-V4.md` freezes a fresh paired treatment: native Write
passes JSON through one authorised input file, then a fixed bridge command reads
it. The native guards remain enabled. Policies, fixtures and effect oracles are
unchanged. Both file and stdin bridge tests preserve literal data.
## Adversarial execution assessment correction

The first four completed context-v3 samples each satisfy all ten workflow cases
under the documented contract. Two original reports failed an overspecified
check: baseline-3 consumed interactive findings from stdout without saving an
optional file; candidate-2 made a permitted read-only probe of an unwritten
staging output. `workflow-fixtures/ORACLE-CORRECTION.md` states the correction.
Original reports and captures remain unchanged. Separate `assessment.json` files
bind their hashes, the fixture, correction and grader. All seven affected tests
pass, including negative cases for missing autonomous findings and unsafe reads.
The same correction applies to both arms and the remaining predeclared samples.
This is incomplete paired evidence, not adversarial qualification.

A native metadata audit found the first three main-worker sessions and checked
their actual tool calls. They contain no prohibited tools or native errors. The
logs identify `claude-opus-5-5` and CLI 2.1.325. Early parser outputs incorrectly
reported no tools because untimestamped metadata interrupted session tracking;
those outputs remain retained. Repeated log records share tool IDs and are
counted once by the corrected auditor. No model thoughts or raw conversations
are exported. Full native audits for all qualifying runs remain pending.

The temporary third worker disappeared when its startup handshake timed out.
Its completed file-input baseline and interrupted candidate are retained as a
separate, incomplete attempt. A fresh five-pair set uses the established worker;
no sample from the interrupted attempt is pooled into that set.

## Challenge qualification and complete native logs

The fresh file-input-v4-stable set passed all eight cases in five samples per
arm: 40/40 before and 40/40 after. Normalised real CLI admission results match.
All ten complete native tool logs pass: allowed initial reads, full policy
transport, authorised argument-file writes, fixed bridge calls and no native
rejections. The earlier interrupted third-worker pair is not pooled. The earlier
context-v3 challenge set has seven merge-fence rejections in its full logs and
remains unqualified even though final effects passed.

`challenges-file-input-v4-stable-results.json` records the consumption comparison;
`challenges-file-input-v4-native-log-review.json` binds the native audit. Provider
model IDs are claude-opus-5-5 and CLI version is 2.1.325. No hosted record writes
were exercised. Recorded task/bridge payloads across five samples are 672,970
bytes / 167,368 estimated tokens before and 411,200 bytes / 102,672 after. This
proxy excludes native framing, operator guidance, model output, cached history
and billing. Source savings remain unchanged.

The same export supplies full native logs for all ten gateway context-v3 samples;
all pass, strengthening the earlier screen-based protocol review. Actual task
Read payloads match the exact task bytes. Actual operator-guidance Read payloads
are 21,125 bytes with the same hash in all 31 exported sessions. The earlier
22,605-byte hash records the orchestrator container's file view at the requested
path; it was not the delivered worker payload hash. Both measurements remain
explicit. See `gateway-context-v3-native-log-review.json`.

The candidate-2 adversarial native error matches exactly the permitted unwritten
output probe in its corrected assessment, including canonical argument hash.
`native-audits/adversarial-candidate-2-native-assessment.json` preserves the raw
native failure label and records this diagnostic separately. No guard rejection
is covered by that correction. The full adversarial paired set is still running.

## Kernel baseline interface finding

Before any kernel edit, the first v1 baseline failed the fixture protocol:
completion status was exposed as an unrestricted string described as completed,
but the server accepted complete; the fixture rejected adapter validation despite
the full policy requiring it before unknown occupants. Accurate optional result
metadata and the equivalent faff-graft stage prefix also failed an overspecified
comparison. The raw report remains 4/9 execution cases and 23/24 decisions.

The v1 fixture bytes are archived as workflow-fixtures/kernel-config-v1.json and
match its manifest hash. KERNEL-CONFIG-V2.md records the corrected public enum,
accurate optional metadata handling and controlled prevalidated-stub boundary.
No real adapter validation is claimed. A fresh v2 baseline uses unchanged kernel
policy; the failed v1 trial is not pooled. No kernel reduction has been authored.

## Adversarial workflow qualification completed

The complete context-v3 paired set satisfies all ten intended workflow cases in
five samples per arm: 50/50 before and 50/50 after. Signals, helper exits,
checkpoint order/state and real persisted merge-floor results match under the
declared normalisations. All native calls are accounted for. Candidate samples
2, 4 and 5 each made one allowed read-only probe of an unwritten system output;
these three diagnostics match native error-call argument hashes exactly. No
native guard rejection or other error is waived. Original raw grades remain;
all ten separate assessments bind report/capture/fixture/grader hashes.

`adversarial-context-v3-qualification.json` binds the effect summary and complete
native audit. Together with the separately qualified 40/40 challenge consumption
cases per arm and the existing 185/185 decision / 40/40 artifact-review probes,
this closes the declared gateway/adversarial proof gap. Further compression may
resume. It does not establish full graft/ship or hosted publication parity.

Recorded task/bridge payloads over five runs were 668,278 bytes / 166,518 estimated
tokens before and 382,505 bytes / 95,824 after. These are limited payload proxies,
not billing. Accepted source savings now cover both current cuts: 59,790 bytes
and 14,773 estimated tokens. No further production prompt was edited while this
qualification was pending.
