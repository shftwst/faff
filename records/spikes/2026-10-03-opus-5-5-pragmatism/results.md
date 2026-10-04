# opus-5.5 vs opus-4.8: calibrating the judgement skills for pragmatism

**Branch:** `opus-5-5-pragmatism` · **Runs:** 2026-10-03 to 2026-10-04 · **Models:** `claude-opus-5-5` (target), `claude-opus-4-8` (regression check), both at default effort · **Follows:** FAFF-1153, FAFF-1154

## Result

With this branch's skills, `claude-opus-5-5` scores at or above the committed `claude-opus-4-8` baseline (`eval/baselines/frontier.json`) on 30 of 32 kinds. The other two are 0.010 below, which is one miss in 50 reps for `superseded` and a few malformed envelopes for `specqual`. Mean accuracy is +0.018. No fixture or oracle was changed.

| kind | 4.8 baseline | 5.5, `main` skills | 5.5, this branch |
|---|---|---|---|
| refutation-spec | 0.806 | 0.438 | **0.999** |
| architecture | 0.820 | 0.570 | **0.970** |
| grouping | 0.840 | 0.940 | **1.000** |
| confidence | 0.973 | 0.863 | **1.000** |
| dupe | 1.000 | 0.900 | **1.000** |
| gloss | 0.973 | 0.880 | **0.973** |
| spec-verdict | 1.000 | 0.913 | **1.000** |
| superseded | 1.000 | 0.970 | 0.990 |
| specqual | 0.973 | 1.000 | 0.963 |
| all other 23 kinds | 0.96 to 1.00 | unchanged | equal to or above baseline |

The change helps `claude-opus-4-8` as well. On refutation-spec, 4.8 scores 0.438 with today's `main` briefs and 0.826 with this branch's.

What a spec author sees on the six clean refutation fixtures, using the production verdict roll-up (`aggregate.mjs`, where any `minor` or above gates):

| model and briefs | approve | revise | reject |
|---|---|---|---|
| 4.8, `main` briefs | 0% | 10% | 90% |
| 4.8, this branch | 46% | 46% | 8% |
| 5.5, this branch | 79% | 21% | 0% |

Every required catch still fires on both models: all ten must-object refutation fixtures pass for 5.5, and 4.8 keeps every infosec catch it makes on `main`.

## What was wrong

**The refutation-spec regression was not specific to 5.5.** On the same day and harness, `claude-opus-4-8` with the current `main` briefs scores 0.438, identical to 5.5. Both models raise a gating objection on nearly every spec, usually from the QA, architectural and infosec lenses together. The objections were often thoughtful but fell into four patterns:

- a detail a competent builder settles during the build, raised as `major` (an interval length, an exact JSON field list);
- a threat that needs the builder to pick an insecure implementation the spec never asks for;
- a missing negative case or boundary test that any test suite would add;
- one lens restating another lens's finding (QA re-raising a leaked secret as "no criterion asserts secrets stay secret").

The committed 0.806 row was captured in August with the June versions of the refuter briefs. Running 4.8 with the June brief content and today's output format scores 0.40, so the August deferral clauses did not cause the drift. The cause is either the claim, evidence and consequence output format added in August, or a change in the served model or CLI since then. Today's parser rejects the June output format, so this harness cannot separate the two.

The other regressed kinds had narrower causes:

| kind | 5.5 behaviour | cause |
|---|---|---|
| architecture | wrote "a modular monolith rather than microservices"; sometimes never said how data survives restarts | named rejected designs, and did not tie each brief requirement to a decision |
| confidence | rated a clean spec `medium` 41 of 50 times | downgraded for polish (a field missing from one example), not for open decisions |
| spec-verdict | `revise` on a clean spec 13 of 50 times | raised nits, and any objection turns `approve` into `revise` |
| gloss | "cap how many login attempts" for a rate-limiting ticket | paraphrased away the ticket's own terms |
| dupe | right pair, sometimes as `[["A","B"]]` | the eval's envelope instruction said `[..]` without naming the shape |

## What changed

| commit | change |
|---|---|
| `chore(eval)` | Keep the 2026-09-29 opus-5.5 sweep as a dated reference snapshot (`eval/baselines/opus-5-5-reference-20260929.json`, marked reference-only), and add `eval/diff-baselines.mjs` with tests. |
| `fix(eval)` | State the tidy classification lists as `["<issue-id>", ..]` in the eval envelope instruction. This is the only harness change; it applies to both models equally. |
| `feat(skills)` | Spec producers rate open decisions, not polish. Single-pass spec review objects only to what must change before build. The architecture proposer meets each stated need in the brief's words and argues for its design, not against others. The issue gloss keeps the work's own terms. |
| `fix(spec-review)` | `parse-refutation.mjs` accepts field labels wrapped in markdown emphasis (`- **claim:**`), which 5.5 occasionally emits and which faulted the whole lens. |
| `feat(spec-review)` | Each of the architectural, infosec and QA refuter briefs gains a "Calibrate to consequence" pass. `DEFAULT_BRIEF_RESERVE_TOKENS` rises from 2000 to 2400, because the largest brief is now about 2,197 tokens. |

The refuter calibration keeps the adversarial hunt and filters what gets reported:

- a build-time choice any sensible builder makes is an `observation`, not a defect;
- object to what the spec says or requires, and credit the controls it names;
- refute the design the spec proposes, not one it leaves out;
- stay in your lens: a vague spec is QA's finding and an oversized slice is methodology's;
- infosec assumes a competent build for implementation detail but never for trust: when a spec grants authority on an input, the spec must establish who writes that input and that it is current;
- only `observation` is non-gating, so `minor` is reserved for an edit needed before build, with `observation` as the tie-break.

Three findings shaped the final wording:

- An early version told infosec to "assume a competent build secures it" wherever the spec was silent. 4.8 then missed refutation-spec-008, the stale-ledger privilege escalation, in 4 of 5 reps; it found the threat but filed it as an `observation` because the spec did not say who writes the ledger. The trust-decision rule restored the catch to 5 of 5.
- Trimming the briefs to fit the old 2,000-token reserve removed the sentences that settle refutation-spec-003 and 004. 5.5 fell to 0 of 20 on 003. The final wording restores them, and the reserve rises instead.
- The larger reserve moves the trimmed shared prefix down one ladder rung, so the oversized brief in the prefix-invariance test grows from 14 KB to 18 KB to keep pushing that one lens past the primary's window.

## Method

- Runs used `runEvals` and the official grader through `frontierDriver`, from a scratch runner rather than `run-evals.mjs`. Parallel scoped `--kind` runs share one progress file (`eval/report/frontier-scoped-progress.json`), so shards would have overwritten each other's rows.
- Final 5.5 numbers use the baseline protocol: 20 base reps, escalation to 50 on disagreement, sharded by case across parallel processes. Each kind was computed with the `aggregateCase` and `aggregateKind` formulas from the raw judgements. Reps that returned a usage-limit message were excluded because they are not judgements.
- specqual pools three runs with identical skill text: 100, 20 and 50 reps per case.
- The 4.8 refutation-spec figure pools two runs with byte-identical briefs: 4 to 13 reps per case, because the usage cap cut the second run short. Treat it as a regression check, not a baseline.
- The 4.8 checks on the other edited kinds (architecture 0.95, confidence 0.97, spec-verdict 1.00, gloss 1.00, dupe 1.00) used 4 to 10 reps per case without escalation.
- Not measured: `--effort high`, and end-to-end prep runs. The eval measures each judgement prompt in isolation.

## Follow-ups

- **Switch the eval model with its baseline.** This branch leaves `models.eval` at `claude-opus-4-8`. Move it to `claude-opus-5-5` in the same change that captures the 5.5 baseline with a full `node eval/run-evals.mjs --update-baseline eval/baselines/frontier.json --model claude-opus-5-5` sweep, so the config and `meta.model` never disagree. The numbers in this spike came from a sharded scratch runner, so they predict that baseline but do not replace it. The current refutation-spec row (0.806) is also not reproducible on today's `main` briefs, where 4.8 scores 0.438.
- **Eval runs revoke the stored login once the access token expires** (jot candidate). `forwardCredentials` copies `.credentials.json` into each rep's isolated config directory and never writes a refreshed token back. Refresh tokens rotate, so the first rep that refreshes invalidates the stored refresh token and every later rep fails with "OAuth session expired and could not be refreshed". Reproduced with two sequential isolated calls on an expired access token: the first succeeded and the second failed. Long operator runs work only while another Claude session in the same environment keeps the stored token fresh. Options: write a refreshed credential back under a lock, refresh once in the parent before the run, or refuse to start when the stored access token is near expiry.
- **Parallel sweeps exhaust the usage window quickly.** About 17 parallel refutation-spec shards used a fresh 5-hour window in under an hour. A sharded sweep needs a width chosen for the remaining quota, and should stop on the first usage-limit response rather than recording errored reps.
- **The context-window reserve is now 2400 tokens with about 9% headroom.** Further growth in the refuter briefs will trip `adversarial-context-window.test.mjs` again.

## Artifacts

- `opus-5-5-branch.json`: per-kind accuracy, stability and format adherence for 5.5 on this branch, all 32 kinds.
- `opus-4-8-refutation-spec-branch.json`: the pooled 4.8 refutation-spec regression check.
- Raw per-rep judgements and the scratch runner are archived locally at `.faff/eval-runs/20261004-opus-5-5-pragmatism.tar.gz` (gitignored, 4.4 MB).

Compare the 5.5 results with the baseline: `node eval/diff-baselines.mjs eval/baselines/frontier.json records/spikes/2026-10-03-opus-5-5-pragmatism/opus-5-5-branch.json`
