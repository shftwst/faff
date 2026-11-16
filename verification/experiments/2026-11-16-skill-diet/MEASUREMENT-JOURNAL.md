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


## Rendering transform qualified

Rendering v2 reduces the skill from 24,639 to 11,288 bytes and from 6,040 to
2,777 estimated tokens: 13,351 bytes and 3,263 tokens saved (about 54%). There are
no new mandatory reads. Each arm passed 45/45 actual persisted artifacts and
100/100 assessed rule decisions. Raw decision scores remain 95/100 per arm: all
ten samples named the correct `# Writing style` heading with its Markdown marker.
The documented heading normalisation is separate from the unchanged reports.
All ten native sessions pass with the same delivered guidance and model version.

Root read every artifact. V1 retained facts but repeated three glosses in one
sample and left memoising unexplained in another; it was revised and retained
separately. V2 corrects those observed issues. Four-sentence explanation paragraphs
remain in two candidate samples and four baseline samples, so this does not claim
perfect style compliance or unrestricted writing-quality equivalence.
`rendering-v2-qualification.json` binds the rubric, native and artifact reviews.

Accepted source savings are now 73,141 bytes and 18,036 estimated tokens across
three files. The pending kernel cut is excluded from that total.

## Kernel V2 functional success, native-context failure

Both V2 arms pass 45/45 real configuration/dispatch cases and 120/120 decisions.
The aggregate initially omitted the grader's already-declared graft stage-prefix
normalisation; its original failed summary remains beside the corrected summary.
Native audit then found an extra repository AGENTS.md read in candidate sample 5.
That sample fails the context protocol and the V2 cut is not qualified.

V3 explicitly preloads both global and repository guidance in every sample and
repeats both arms with the same policies, fixture and runtime. V2 remains separate;
no failed sample is replaced inside that treatment. Source savings remain pending.

## Catalogue V2 qualified

V2 shortens 26 discovery descriptions and preserves every other byte in those
skills. Both arms pass 175/175 selection decisions, with all ten native audits
passing. This is discovery evidence only; it does not execute the selected body.
V1 chose prep instead of jot for an overlapping existing-ticket request. That
failure remains; v2 restores both original descriptions and retains the other
26 cuts. No v1 candidate is pooled with v2.

The description cut saves 4,324 bytes and 1,067 estimated tokens. Accepted totals
are now 77,465 bytes and 19,103 tokens: three body cuts plus 26 descriptions.
The 41-file committed set is 1,291,970 bytes and 320,176 estimated tokens. All
368 deleted blocks are covered: 18 moved and 350 inventory rows. Kernel and
thematic working candidates remain excluded. Source and load measurements are
bound to commit 92e66bd4, before any pending body is committed.

## Kernel V3 strict command protocol failure

All 45 execution cases and 120 decisions pass per arm. Native auditing fails
one baseline and two candidate samples, including shell-variable abbreviations
of bridge commands. V3 is not qualified; all original evidence remains. V4
explicitly forbids variables and command-prefix abbreviations in both arms,
with the same policies, fixture, initial guidance and real CLI. No samples are
pooled across treatments.

## Thematic read-only cut qualified

Five samples per arm pass 60/60 decisions, 15/15 persisted ticket proposals and
five termination-policy outputs. Those policies pass 45/45 real run-done scenario
consumptions and 45/45 contract validations per arm. All ten native audits pass.
Root read all 30 proposals: the rate-limit question, split concerns, dependency,
Backlog status and empty thin branch remain faithful. Six untested/mutation
sections, the appetite table and topology-write authority stay byte-identical.

The cut removes 5,700 bytes and 1,391 estimated tokens. Accepted totals are now
83,165 bytes and 20,494 tokens across four body cuts and 26 descriptions.
The committed 41-file set is 1,286,270 bytes and 318,785 estimated tokens,
bound to commit 3ff076df. All 421 deleted blocks are covered: 19 moved and
402 mapped. Kernel and WTF working body candidates remain excluded.

## PRD Astra V2 qualification and downstream replay

The fresh Astra-low pair passes 30/30 actual PRD artifacts and 40/40 decisions per
arm, with all ten native audits complete. All sixty artifacts were read and
hash-bound. A deterministic replay feeds them through real PRD-readiness,
coverage, run-start and run-trigger commands: 120/120 cases per arm pass and
120/120 forged contrary decisions per arm are rejected. This does not mint a run
or qualify full beep-boop orchestration. Claude partial samples and the earlier
Astra path-protocol failure remain excluded.

The source falls from 4,214 to 2,465 bytes and 1,047 to 617 estimated tokens. The
eval loader follows the shorter Rubric/Output headings. All 539 targeted eval,
producer and run-start tests and adapter lint pass. The first rule-inventory
check rejected fixture paths in its executable-test column; that documentation
format was corrected, preserving the failed report. The corrected check covers
495 deleted blocks: 26 moved, 469 mapped, none uncovered.

The agile candidate remains out. Manual review found an unsupported UI dependency
qualifier in baseline-three's late-risk recommendation; the frozen all-artifact
bar fails. All forty baseline outputs were read, with 39 passing that bar. This
is a baseline failure, not a measured candidate regression. No candidate sample
was substituted; the measurement lane now runs routing assignment.

## 2026-11-16 12:20 UTC: downstream proof and held cuts

Review V3 passes 70/70 artifacts, 200/200 decisions, 70/70 exact prose/JSON title sets and 70/70 real stored-comment connector replays. Integration is held: the compressed verdict rules trigger existing enum lint. The dirty-tree connector guards account for the other two initial test failures. Production is restored. V4 measures five new presentation-corrected candidates against all five unchanged successful baselines; no V3 candidate is reused. Map baseline one omits the required TL;DR section in all six reports, so its cut is held; the separate removing/remove recogniser mismatch is recorded without relaxing the format bar. All PR checks pass at 4611efcd.

## 2026-11-16T12:27:32.526248+00:00: routing held before candidate measurement

The first three unchanged routing baselines agree on every verdict but differ on the medium-confidence root cause: spec-ambiguous-external twice, punt-not-closed once. The frozen exact projection includes root cause, so this pair cannot qualify. Candidate continuation stopped; finish baseline capture for the record. No candidate regression or savings is claimed.

## 2026-11-16T12:34:07.438312+00:00: ADR baseline held; intake comparison begins

ADR baseline one passes six structural body rubrics, but one body calls the record date an acceptance-event date. The source-fact bar holds that cut. Four policy-answer mismatches are separately recognised as exact-string oracle false negatives, with no correction or reroll because the artifact failure is independent. Intake final-brief comparison begins; the whole discovery procedure, inputs, template and appetite section remain byte-identical.

## 2026-11-16T12:52:41.381757+00:00: review V4 qualified and committed

All 35 baseline and 35 new candidate artifacts pass, alongside 100 decisions per arm and ten native audits. Root read all seventy and checked prose/JSON title equality. The actual outputs pass seventy real stored-comment connector handoffs, with exact human-content/CRLF preservation. The candidate passes 641 integration tests, adapter lint and 560-block rule inventory. Commit f6324f61 saves 5,360 bytes and 1,319 estimated tokens; cumulative accepted savings are 101,620 bytes and 25,038 tokens. Baseline reuse and sentence-title style variance are explicit in the final qualification.

Intake V1 has an exact-string false negative on /faff-jot and /faff-prep. V2 freezes clearer spelling instructions and starts five fresh samples per arm; no sample pooling. Architecture V1 is held on a wrong literal bridge path, despite its passing functional report.

## 2026-11-16T18:36:39.190886+00:00: operator continues with Sol medium

The original 12-hour window elapsed. The operator explicitly requested continuation, Sol medium as the Claude stand-in, and comparison against preserved Opus measurements to decide tomorrow's rerun needs. Fresh Sol pairs are frozen for pending cuts; gateway/rendering calibration retains exact policy, fixture and runtime hashes while disclosing different guidance, native transport, base instructions, timeout and path reminders. An independent verifier checked 282 accepted PRD/review evidence hashes and found the bounded claims supported.

The first Sol runner still invoked an Astra-specific native model check. A separate tested Sol wrapper corrects only that expectation; existing sessions are re-audited, original reports retained, with no model reroll. Prior incomplete Astra sessions reported a usage limit and are excluded. WTF V2 remains held for two missing groom offers; an independent audit also found shared empty-subsection drift, now explicit in Sol manual acceptance.

## GPT screen and pending source review, 2026-11-16T19:13:04.597231+00:00

Intake passes 629unchanged tests under a task-owned `/var/tmp` directory after both baseline and candidate showed intermittent enclosing `/tmp/.git` interference. All 48 completed briefs retain facts, but candidate 3 makes a mistyped native path call and an unterminated heredoc. The strict native gate fails and candidates 4/5 are not launched; no savings are counted.

WTF sourceV4 candidate 2 retains facts, offers and top-level empty headers but drops the empty likely-fire partition. SourceV5 adds a 157-byte reminder within Output Format only and requires five new candidate samples against the unchanged Sol baseline. Prior samples remain diagnostic and excluded.

The model/effort screen retains native failures. Sol-high has one equivalent full-result wrapper unsupported by the frozen parser; another Sol-high run and all Terra runs discard exit metadata. No such record is relabelled a native pass. The harder task now uses a separately frozen, truthful same-family judgement treatment, preserving original case data, rules and real CLI outcomes. Its deterministic preflight passes 8 cases and rejects 8 altered outcomes; this is not model evidence.

## Default spec review qualified and GPT finalists selected

Default spec review is accepted at `34764e93`: 1,405 bytes and 344 estimated tokens saved. The fresh Sol-medium pair passes 30/30 artifacts and 75/75 decisions per arm, all ten strict native audits and all 60 independent manual artifact reads. Actual contract/route replay passes for all 60 artifacts and rejects 60 unfounded mutations. The private integration passes 599 tests; main adapter lint and cumulative rule inventory pass. No full prep loop or L4 refuter is claimed.

The equal-size model screen is complete. Sol medium, Astra low and Astra medium pass all eight run-level and native gates. Sol low has duplicate submissions, two missing answers and one incomplete answer; 133/136 cases and seven of eight runs pass. Sol high has two unsupported full-result wrappers and one output-only wrapper; Terra uses output-only wrappers throughout. Functional outputs and audit compatibility are kept distinct. All GPT baselines miss the memoising reuse explanation, while their shortened-prompt candidates include it.

Sol medium and Astra medium advance using the frozen ranking and observed time for matching work. Astra low also passes; its small timing difference is not a general disadvantage claim. The finalists use additional repetitions plus the separately amended same-family challenge task. No screen sample is replaced or rerolled.

## Focus report sourceV5 qualified

Accepted at `ea19ca08`: 4,217 bytes and 1,027 estimated tokens saved. Five unchanged Sol baselines and five new V5 candidates each pass 15/15 artifact rubrics and 70/70 assessed decisions, with complete native audits. All 30 selected actual reports are read and hash-bound. Targeted manual requirements improve from 9/15 baseline to 15/15 candidate: facts 15/15 in both, offers 12/15 to 15/15, and empty automation headers/queue partitions 12/15 to 15/15. Shared calibration paragraph/bullet formatting variance remains disclosed.

The accepted V5 source is one combined commit; the known failed V4 source is not installed as an intermediate main-branch commit. The private 576-test integration, main adapter lint and cumulative rule inventory pass. No acquisition, action handoff, tracker mutation or full WTF workflow is claimed. Total accepted savings now reconcile to 107,242 bytes and 26,409 estimated tokens across nine body/reference cuts and 26 descriptions.

## GPT stand-in comparison completed, 2026-11-16T20:13:20.282266+00:00

All six screen combinations are retained. Sol medium and Astra medium each complete five samples per arm on gateway, rendering and proposal judgement/CLI consumption. Each finalist and the preserved Opus reference passes 30/30 assessed runs, 420/420 assessed cases and 30/30 native audits. Raw scores remain 20/30 runs and 410/420 cases per model; the previously frozen heading-marker correction accounts for the difference. No failed screen sample was replaced. All four new-run lanes exit successfully.

All 90 rendering artifacts per finalist were independently read; Opus's original root review covers its 90. All 240 actual judgement reasons were also reviewed. All core decisions and missing-opinion dispositions match. Sol has one broad literal-rule paraphrase; Astra has one unsupported lifetime certainty. Opus has ten broad paraphrases, with five overlapping ancillary overclaims. A defensible environment-only interpretation is treated consistently across models. These secondary wording findings preserve the original automatic outcomes. Original-prompt memoising explanations are absent in five of five GPT samples per finalist and present in all shortened samples; Opus has no omission. Opus density caveats remain four original and two shortened outputs.

Sol medium remains the practical default, with Astra medium as a second check. There is no clear fidelity winner. Mean observed elapsed time is 164.0 seconds for Sol and 182.0 for Astra, including shared queue/tool overhead; no billing or causal speed claim. The same-family challenge amendment and provider/guidance/transport differences limit interchangeability claims. The frozen final record and independent audit bind all 90 captures with zero discrepancies, including all 240 reason hashes.

A prepared, unlaunched Opus queue prioritises default review, default spec review, PRD and focus report, ten samples each after allowance renewal. Existing Opus-qualified cuts do not need blanket repetition. No Claude calls or credits were enabled. The final source audit passes 83 checks and reconciles 107,242 bytes/26,409 estimated tokens saved across nine body/reference cuts and 26 descriptions; held intake remains absent. No merge or release.

## Diet continuation after stand-in calibration

The operator resumed the diet. Architecture starts a separately registered Sol-medium comparison; intake starts Astra medium, with no provider pooling. Architecture baseline2 omits a closing heredoc marker: all eight proposals are semantically sound but strict native certification fails, so the lane stops with no candidate or source saving.

Intake baseline2 preserves both unresolved questions as questions and passes native auditing, but the old lexical rubric requires a literal undecided/unspecified phrase. The separate, independently reviewed assessor recognises only the two exact questions under Open questions, retaining all other checks and the mandatory invention review. Original captures and raw failure remain; baselines3-5 continue without replacing samples. The runner copy changes only its description and assessor whitelist.

The new beep-boop Reporting boundary runs the pinned production summary handler and real ledger writers, checks persisted bytes and immutable authority state, and observes controlled tracker/conversation publication plus no-budget continuation. Forge, health, metering and rendering are controlled dependencies; no full run-close/build loop, hosted publication, pre-write normalisation or peer-reporting claim. Six cases include shipped precedence, review holds, budget/zero-ship, dirty install, required continuation and unreadable ledger. Nineteen deterministic tests pass across reporting and the intake assessor, including altered facts, destinations, economics and continuation. Initial harness/test failures remain in deterministic-checks. Full original skill and current kernel are frozen before baseline measurement and candidate editing.

## Diet continuation: intake, reporting and roadmap

The fresh Astra-medium intake comparison completed all five baselines with thirty briefs manually reviewed. The unchanged question-form assessment corrects baseline2's lexical miss without replacing the sample. Candidate1/2 pass raw, assessed and native checks; candidate3 uses the same frozen correction as baseline2 and passes manual source/invention review. Remaining candidates are still running. Fresh private integration passes632tests, adapter lint and cumulative rule inventory. No source savings are accepted yet.

Reporting V1 stopped before any model call: the manifest hash helper rejected fractional monetary metadata. V2 changes only task-byte hashing, preserves V1source, and passes a complete mailbox preflight. Its first three full-policy baseline samples pass all18execution cases, strict native audits and manual reviews. The frozen candidate saves1454bytes/356estimatedtokens by shortening repeated bucket and housekeeping explanation. Its67integrationtests, adapter lint and inventory pass. Run close, peer handling, pre-write normalisation and complete build-loop execution remain outside scope and unchanged.

A separately registered Sol-medium roadmap comparison preserves the earlier Astra-low failure. Solbaseline1passes native transport but manual review finds all six reports move TL;DR ahead of the specified order and the on-chain-cycle report adds an unsupported exception to gate fireability. The off-chain `removing` lexical miss is not corrected because these real failures hold the lane. No candidate was measured or installed. Its prepared12-testintegration is not acceptance evidence.

A new full-nlspec format candidate is being prepared. Independent static review caught and corrected conditional wording changes. Untested failure-mode, anti-pattern, inventory and temporal-anchor prose was restored verbatim, narrowing the potential saving to2371bytes/586estimatedtokens. Four final-spec fixtures, real downstream consumer replay and negative tests are prepared; no model measurement or source acceptance yet. The first reference preflight and initial negative-test failure are preserved separately from corrected inputs.

## Intake qualified on Astra medium

Sourcecommit `c650c72b` installs the exact measured candidate:7622→5689bytes and1890→1412estimatedtokens. All60actualbriefs were independentlyread; all120decisions and10strictnativeaudits pass. Both arms score29/30rawartifactchecks and30/30assessed: baseline2andcandidate3 carry the same frozen lexical correction. Fresh contractregrading and artifact/manual hashes are checked before acceptance. Private632-testintegration and main adapterlint/inventorypass. Tally now109175bytes/26887estimatedtokens saved. Opusrenewalqueuev2adds thiscut whilepreserving the queue bound by the completed model comparison.


## Structured measurement transport, 2026-11-16 22:48 UTC

Repeated real shell path/JSON failures remain failed measurements. A separate task-local stdio MCP bridge now exposes the unchanged mailbox ports with literal structured arguments. It binds each native call/result to one ordered trace row and unique request/response files, verifies complete policy delivery before operations, and rejects extra calls, missing/tampered evidence, changed startup/task instructions and post-finish actions. No previous native audit or accepted evidence was changed.

Pilot V1 stopped before a port call because the isolated server required approval. V2 established a successful literal wrapper on earlier bridge bytes. V3 passed its functional fixture but its new auditor rejected the CLI's pre-task tool-definition advertisement; its failed audit remains. V4 freezes that declaration's content hash and shape before launch, retains rejection of unknown invocations, and passes its live native and two-case functional checks. Task-local approval applies only to the fixture ports; user configuration is not changed.

Final regression passes 87 tests. A deterministic MCP bridge preflight executes all six real reporting cases, preserves the expected domain exit 2 as a successful transport result, and rejects omission of every case trace. These infrastructure results are not skill fidelity samples or source savings. Fresh reporting MCP plans register five samples per arm using unchanged policies, runtime, fixture and semantic gates, with no pooling of prior samples. Independent V4 review is required before launch; all five baselines must pass before any candidate measurement.

Independent V4 review now qualifies the transport for fresh reporting measurements: 58 independent tests pass, live native audit reproduces exactly, all 69 preflight calls and 40 policy chunks match raw evidence, and all six omitted-case mutations fail. `mcp-transport-v4-qualification.json` binds that review and the 87-test regression.


## Reporting draft assessment and ledger preparation, 2026-11-16

Fresh MCP baseline1 passed all six execution cases, native audit and manual reading. Baseline2 retained a raw/replay failure: an intermediate conversation draft copied `Sentry: 0 checkpoints` as `nn0`, then corrected it before the only publication. Native audit passed and all final facts/publications were faithful. The original grader required exactly one normalisation per channel. Two independent source reviews confirmed the skill requires one summary command and normalisation before publication, while permitting draft correction.

`assess-reporting-drafts-v1.mjs` is a separately frozen, explicitly post-hoc oracle amendment. It retains original raw scores, captures and extra-call counts; recognises only unused successful drafts before the sole publication; validates publication IDs, case/channel, order and bytes; and reuses all remaining original grade checks. Twenty-seven tests and two independent reviews found no relaxation of authoritative state, actual published content, command count, errors or missing-case gates. Baselines1/2 assess pass without replacement. The same rule is registered for baseline3-5 and candidate1-5 before any further model launch. Candidate stays held until all five assessed/native/manual baselines pass.

The independent ledger source review found no lost requirement in a conservative 6,622-byte / 1,625-token draft. V5 real CLI lifecycle feasibility passes complete, incomplete-close and unreadable-close cases. Earlier exploratory failures caught a second-live-run mint guard, incorrect event-order/origin assumptions and asynchronous poller stop. All failures remain recorded. Cleanup now verifies the exact owned process has exited before deleting its temporary root; all prior fixture processes are gone. These checks do not establish model ledger/event fidelity or savings.
