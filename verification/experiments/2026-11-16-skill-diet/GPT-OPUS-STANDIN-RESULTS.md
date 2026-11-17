# GPT stand-in comparison

Status: complete. Six combinations screened; two finalists completed five samples per policy arm on three tasks. Automatic scores, native execution and actual written outputs were reviewed separately.

Use **Sol 6.1 medium** as the practical default for these offline skill-diet checks, with **Astra medium** as a second check. Both finalists match the reference outcomes and pass all native execution checks. Neither has a clear fidelity advantage; Sol has the lower observed elapsed time. The screen provides no measured benefit from increasing Sol effort. Lowering it produced a failed run with duplicate submissions, missing answers and an incomplete answer.

## Equal-size screen

Each GPT combination ran two samples per policy arm on gateway execution and rendering: eight runs, 136 automatic case checks and 36 actual rendering artifacts per combination. Every artifact was read. Failed samples were retained and never replaced.

| Model | Effort | Assessed runs passed | Case checks | Native audits passed | Mean seconds per run |
|---|---|---:|---:|---:|---:|
| Sol 6.1 | low | 7/8 | 133/136 | 7/8 | 169.8 |
| Sol 6.1 | medium | 8/8 | 136/136 | 8/8 | 167.8 |
| Sol 6.1 | high | 8/8 | 136/136 | 5/8 | 173.1 |
| Astra | low | 8/8 | 136/136 | 8/8 | 181.6 |
| Astra | medium | 8/8 | 136/136 | 8/8 | 177.7 |
| Terra 6.1 | medium | 8/8 | 136/136 | 0/8 | 137.7 |

Sol-high's three audit failures have different causes: two use equivalent full-result wrappers unsupported by the frozen parser; one discards exit metadata. Terra discards exit metadata throughout. These are not all reasoning failures. Terra was fastest in this small screen, but the current measurement transport cannot certify its native execution. Sol-low's failed run has actual duplicate submissions and incomplete decisions.

Astra low also passes every screen gate. Its small observed timing difference from Astra medium does not establish a general quality or speed disadvantage. Sol medium and Astra medium advanced under the frozen ranking and observed time for matching work; the comparison does not establish a statistical winner.

All GPT baseline rendering samples omit the explanation that memoising reuses a computed result; all shortened-prompt candidates supply it. Opus's original paired rendering review found no such omission. Source facts and this plain-language requirement are scored separately; perfect automatic scores do not erase manual findings.

[Screen records](gpt-opus-standin-screen-progress.json), [selection and limits](gpt-opus-standin-finalist-selection-v1.json), [native compatibility diagnosis](manual-artifact-reviews/matrix-native-compatibility-review.json), [Sol-low decision failures](manual-artifact-reviews/sol-low-screen-decision-diagnosis.json).

## Finalist checks

Each finalist completed five samples per arm for gateway, rendering and the distinct proposal-judgement/CLI-consumption task. The comparison uses the original policy, case inputs, expected outcomes and runtime. Sol medium's already registered gateway/rendering samples were reused openly; Astra received three additional samples per arm. No failed screen sample was rerolled.

| Model | Assessed runs passed | Assessed case checks | Native audits passed | Mean seconds per run |
|---|---:|---:|---:|---:|
| Preserved Opus 5.5 medium reference | 30/30 | 420/420 | 30/30 | Unavailable |
| Sol 6.1 medium | 30/30 | 420/420 | 30/30 | 164.0 |
| Astra medium | 30/30 | 420/420 | 30/30 | 182.0 |

Each model has 410/420 raw case passes and 20/30 raw run passes. The same previously frozen rendering correction accepts the correct `AGENTS.md` heading with its Markdown marker, producing the assessed scores above. All original raw reports remain. Native failures are never waived by this semantic correction.

All 90 rendering artifacts per model were read: the original root review covers Opus; independent reviews cover both GPT finalists. All 80 harder-task reasons per model were also read and checked against the supplied policy and facts. Every core outcome, ground and consumer disposition matches, including all 20 missing-opinion cases per model.

| Manual finding | Opus reference | Sol medium | Astra medium |
|---|---:|---:|---:|
| Original-prompt memoising explanations missing | 0/5 | 5/5 | 5/5 |
| Shortened-prompt memoising explanations missing | 0/5 | 0/5 | 0/5 |
| Overbroad paraphrases of the literal log rule | 10/80 reasons | 1/80 | 0/80 |
| Ancillary source or lifetime overclaims | 5/80 reasons | 0/80 | 1/80 |

The five Opus ancillary findings overlap its ten broad paraphrases, so there are ten distinct flagged reasons, not fifteen. Sol's one confirmed caveat broadens a rule about `.faff/` logs into a blanket ban on `.faff` secrets. Astra's one confirmed caveat asserts that a cache outlives the process although cleanup is unspecified. All retain the correct decision. A separate Sol interpretation of environment-only sourcing is defensible and is not counted as an unsupported fact; the same allowance applies to every model.

These secondary findings preserve the original functional scores and do not establish a general model ranking. Opus's rendering review also retains its density caveat: four original and two shortened outputs have four-sentence paragraphs. Perfect style or prose fidelity is not claimed.

The harder GPT task explicitly measures same-provider-family judgement only. The old task calls Opus an independent reviewer of an OpenAI primary; retaining that claim for GPT would be false. The changed task wording, tool description and report scope were frozen before finalist selection. The original environment, grader and consumer effects are unchanged. Deterministic preflight passes all eight cases and rejects eight altered outcomes.

[Frozen final results](gpt-opus-finalist-results-v1.json) bind every sample, score and manual record. The [independent audit](independent-finalist-results-audit-sol.json) confirms all 90 captures, zero binding/count discrepancies and all 240 reason-to-capture matches. [Harder-task amendment](gpt-opus-hard-task-amendment-v1.json), [Sol reason review](manual-artifact-reviews/challenges-final-sol-medium.json), [Astra reason review](manual-artifact-reviews/challenges-final-astra-medium.json), [Opus reason review](manual-artifact-reviews/challenges-opus-reference.json).

## Intended Claude driver follow-up

Focused Opus confirmation is still needed for the four cuts qualified only on GPT. The model comparison covers different fixtures and cannot establish parity for those producers. The prepared queue prioritises the two judgement producers, then PRD extraction and focus-report presentation:

| Priority | Cut | Existing qualification | Opus confirmation |
|---|---|---|---|
| 1 | Default code reviewer | Astra low; actual review/comment consumption | Five original and five shortened samples |
| 2 | Default spec reviewer | Sol medium; actual contract/reject routing | Five original and five shortened samples |
| 3 | PRD producer | Astra low; actual readiness/run-start consumption | Five original and five shortened samples |
| 4 | Focus report | Sol medium; all reports manually read | Five original and five shortened samples |

[Prepared queue](opus-renewal-priority-queue.json). Nothing is scheduled or launched on Claude, and no paid credits were enabled. Existing Opus-qualified cuts do not need blanket repetition merely because a stand-in was tested. Held cuts, including intake's native failure, remain uninstalled and excluded from savings.

## Limits

- Opus received different operator-guidance bytes and provider instructions. Native transports, timeouts and literal-path reminders also differ. The harder GPT task additionally changes the independence wording. This is a practical calibration, not a model-only causal experiment.
- Elapsed time includes shared queue and tool overhead. Finalist concurrency differs from the screen. Provider costs and billed token usage are not measured.
- Samples share a small set of cases. Correct outcome/consumption, native certification, written-reason precision and rendering style are separate results.
- Both automatic failures and manual caveats stay visible. Correct admission outcomes do not excuse an overbroad rule quotation or an unsupported lifecycle claim.
