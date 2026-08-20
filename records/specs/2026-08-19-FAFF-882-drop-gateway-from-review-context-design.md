# FAFF-882 — Drop the faff gateway from review-call `--context`

> Spec: faffter-dark-nlspec · 2026-08-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-882.

This is the build specification for FAFF-882 ("Review calls are handed the 262 KB faff gateway as `--context`: cost, latency, and off-target findings"). Audience: the build agent that will make the change, and the human reviewing the resulting diff. Every file path and line number below was re-verified against the working tree at commit `bf85fc98`.

---

## 1. WHY — problem and principles

**The load-bearing model.** No code builds the review argv. `review-call.mjs` parses whatever argv it is handed, and the argv itself is written out as prose in two `SKILL.md` files that an agent reads and executes. So this change is a prose edit, and the only regression guard available is a test that reads those `SKILL.md` files and asserts on their text. Everything below follows from that: there is nothing to unit-test, nothing to refactor, and the "did it stay removed" question is answered by a string assertion or not at all.

**Problem statement.** Both faff review paths pass `--context plugin/skills/faff/SKILL.md` on every call, and that file is 261,739 bytes across 1,176 lines (verified: `wc -c -l`), roughly 65k tokens, fenced ahead of the artefact under review by `assembleUserMessage`. With four spec-review lenses enabled that is about 260k tokens of faff governance prose per spec-review pass, re-sent on every loop iteration, and the code-review path pays it again per diff. The change removes that one argument from both call sites and keeps the rest of the `--context` list.

### Design principles

**Deletion, not substitution.** The touched-files half of the `--context` list is what lets a reviewer check an existence or structure claim against the real file. That half stays. Nothing is added in the gateway's place in this ticket, so the diff is a strict reduction and the eval arm that measures it (FAFF-883's `none` arm) is measuring exactly what ships.

**The prose is the call site.** `plugin/skills/faffter-dark-adversarial-review/fan-out.mjs` validates `{lens, argv}` shape and spawns `[reviewCallPath, ...request.argv]` without inspecting argv contents; grep of `plugin/skills/faff/bin/lib/` for `LensRequest`, `refute-`, and `--context` returns nothing. An implementation that "fixes the code" has misread the system. Reject any diff that touches `review-call.mjs` argv parsing, `fan-out.mjs`, or the CLI.

**Lock it in, don't merely unlock it.** A test that stops asserting the gateway is present leaves the door open for the next author to re-add it. The replacement assertions are negative and argv-anchored, so re-introduction fails CI.

### Reference context

| File | Kind | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | prose (154 lines) | Spec-review lens call site: lines 32, 84, 86 |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | prose (344 lines) | Code-review call site: lines 181, 198 |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | JavaScript | Consumes `--context`; line 115 comment describes the caller convention this change alters |
| `test/adversarial-call.test.mjs` | Node test (216 tests, all passing at baseline) | Line 1629 asserts the gateway is present; must change |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | `SKILL_LINE_BASELINE` covers only `faff`, `faff-beep-boop`, `faff-graft`; neither touched file is in it |

**Scope statement.** This sits in the `spec_review` and `review` slots' shared transport layer, on the input-assembly side only. It changes what a reviewer is shown, never how a reviewer's answer is graded, dispositioned, or contracted.

---

## 2. OUT OF SCOPE

- **A distilled orientation preamble in the gateway's place.** Excluded because the touched-files half already supplies the referent for existence and structure claims, and every adopter that is not this repo has a reviewer looking at their own application code where faff's governance prose is irrelevant. Extension point: FAFF-883's `preamble` arm, which measures the idea rather than asserting it.
- **Measurement of the size or quality delta.** Excluded because the instrument does not exist yet: `eval/size-census.mjs` measures whole-`SKILL.md` file size and never sees the assembled payload, and `eval/cli-driver.mjs` feeds the `refutation-code` / `refutation-spec` judges fixtures that never route through `review-call.mjs`. Extension point: FAFF-883 in full.
- **`adr-drift` and `prdr-yagni`.** Verified: both are declared on `plugin/skills/faffter-dark-adversarial-review/SKILL.md:5`, and neither carries `--context` repo files, so there is nothing to remove. Their transports differ and the difference matters. `adr-drift` (line 300) takes a proposal-shaped payload `{old Decision body, new Decision body, why}`. `prdr-yagni` (input at line 311) does **not** reach `review-call.mjs` at all: line 315 states its transport is "invoke the `review` slot as a subagent (a different model, the Phase-2 pattern) — never the diff-shaped code-review transport", and line 333 carries an anti-pattern against routing it through that transport. Extension point: none needed for the removal, but see the consequence recorded under the ambient-inheritance entry below.
- **Shrinking the gateway itself.** FAFF-607 (execute the gateway kernel/reference split) owns it.
- **The ambient producer-dispatch inheritance path.** The issue's Scope section names it: `plugin/skills/faff/SKILL.md:998` ("Contract loading and conformance") has every consumer load the gateway on entry, so a review producer dispatched as a subagent picks it up a second way. That is a different mechanism (the orchestrator's own context, not the backend's wire payload) and needs its own ticket. Extension point: a new issue against gateway → **Contract loading and conformance**; FAFF-555's bare-executor rule is the precedent.
- **`records/adr/0052-cli-module-layout-...`, line 11.** It cites the FAFF-183 context rule as motivating context for the CLI module split. Historical records keep the wording they were written with, per `AGENTS.md`. The premise weakens but the decision it records does not change. Extension point: whoever supersedes ADR 0052.
- **`test/adversarial-call.test.mjs:63-67` and `:1715-1717`.** Both use `plugin/skills/faff/SKILL.md` as an arbitrary fixture path string against pure functions (`assembleUserMessage`, `claimTargets`), not as a call-site assertion. Verified: both keep passing untouched. Rewriting the fixture strings is churn with no signal.
- **`eval/baselines/prompt-size.json`.** It is a per-`SKILL.md` file-size census, gated non-enforcing in `.github/workflows/validate.yml:112` (no `--enforce`). This change shrinks two files slightly, which the census tolerates. FAFF-883 owns refreshing the stale baseline.

---

## 3. WHAT — the edit surface

### Every live location naming the gateway as review context

Explore surfaced five; a repo-wide grep for `--context plugin/skills/faff/SKILL.md` plus a broader search for gateway-as-context prose surfaced two more live ones. The full set:

| # | Location | Current text (abridged) | Action |
|---|---|---|---|
| 1 | `faffter-dark-spec-review/SKILL.md:32` | "**Repo architecture context** — the gateway plus the files the spec names" | Edit |
| 2 | `faffter-dark-spec-review/SKILL.md:76` | `node -e` placeholder comment `/* --backends-json, --timeout, --system refute-<lens>.md, --context..., --diff */` | No change |
| 3 | `faffter-dark-spec-review/SKILL.md:84` | the load-bearing argv paragraph | Edit |
| 4 | `faffter-dark-spec-review/SKILL.md:86` | "the **spec** is supplied as `--diff` …; repo files as `--context`" | Edit |
| 5 | `faffter-dark-adversarial-review/SKILL.md:181` | the argv line inside the backend-call bash block | Edit |
| 6 | `faffter-dark-adversarial-review/SKILL.md:198` | the `--context` rationale bullet | Rewrite |
| 7 | `faffter-dark-adversarial-review/review-call.mjs:115` | comment: "context files (the gateway + touched files …)" | Edit |

Locations 1 and 7 were not in the handed-over findings. Location 1 is the `## Inputs` bullet in the same file as location 3 and states the same rule; leaving it makes the file contradict itself. Location 7 is a two-line comment directly above `assembleUserMessage` describing the caller convention this change reverses.

**Chosen:** all seven locations land in this ticket. Locations 1 and 4 are in a file already being edited and cost nothing; location 7 is a comment-only substitution with no behaviour change and no test impact. Leaving any of them turns a clean reduction into a file that documents two incompatible rules.

### What does not change

`review-call.mjs`'s handling of `--context` is untouched. For the record, verified:

```
--context accumulation      line 831   a.context.push(argv[++i])         # argv order preserved
context file reads          line 1221  a.context.map(p => readFileSync(p))
payload assembly            lines 115-122  <file path="..."> fences, ahead of "DIFF UNDER REVIEW:"
system message              never carries context
size guard                  lines 128-140  checkPayloadSize vs DEFAULT_MAX_PAYLOAD_BYTES = 5_000_000
                            checked once at line 1234, before dispatch
```

No truncation, no per-file cap. The 5 MB guard does not trip on 261 KB today and will not after removal.

---

## 4. HOW — behaviour

### 4.1 The five prose edits

Four of the five are pure deletions or substitutions that author no new punctuation. The fifth is a rewrite.

**Location 1 — `faffter-dark-spec-review/SKILL.md:32`.** Delete `the gateway plus `:

```
- **Repo architecture context** — the files the spec names — so a refuter can verify
  existence/structure claims instead of hallucinating them.
```

**Location 3 — `faffter-dark-spec-review/SKILL.md:84`.** Delete `--context plugin/skills/faff/SKILL.md `, leaving:

```
Each `LensRequest.argv` carries exactly what the old per-lens `review-call.mjs` invocation
received: `--backends-json "$backends_json" --timeout "$timeout" --system
plugin/skills/faffter-dark-spec-review/refute-<lens>.md --context <each file the spec names>
--diff <spec-file>`.
```

**Location 4 — `faffter-dark-spec-review/SKILL.md:86`.** Substitute `repo files` with `the files the spec names`:

```
- The **spec** is supplied as `--diff` (the thing under scrutiny); the files the spec names
  as `--context`; the lens refutation prompt as `--system`.
```

Rationale for touching this line at all: "repo files as `--context`" reads as a licence for any repo file, which is the exact reading being closed.

**Location 5 — `faffter-dark-adversarial-review/SKILL.md:181`.** Delete `--context plugin/skills/faff/SKILL.md `, leaving the bash block line as:

```
      --context <each file the diff touches> \
```

**Location 6 — `faffter-dark-adversarial-review/SKILL.md:198`.** Rewrite. The existing bullet states the gateway is present deliberately and cites the false-criticals incident as its warrant. The incident is real and the record must keep it, but the record must now say that the touched files are what answered those claims. Replacement, one line:

```
- **`--context`** = **every file the diff touches** — so the reviewer can verify
  existence/structure claims instead of hallucinating "this heading doesn't exist" from a
  diff-only view. (A model given only the diff produced confident false criticals; a *more*
  capable model was *more* wrong for exactly this reason. The touched files are what answer
  those claims; nothing else belongs here, and faff's own skill prose reaches a reviewer only
  when the diff actually touches it.)
```

**Anti-pattern:** rewriting the bullet as a changelog entry ("FAFF-882 removed the gateway because…"). Why: `AGENTS.md` → Skill-authoring standard bans changelog in the prompt. State the rule forward; the ticket reference belongs in git history.

**Anti-pattern:** dropping the false-criticals parenthetical along with the gateway. Why: it is the only record of why the touched-files half exists, and deleting it invites someone to remove that half next.

**Location 7 — `review-call.mjs:115`.** Substitute `the gateway + touched files` with `every file the diff touches`:

```js
// PURE: the user message — context files (every file the diff touches, so the reviewer can verify
// existence/structure claims) fenced ahead of the diff. This is the fix for diff-only hallucination.
```

### 4.2 The test change

**Edit — `test/adversarial-call.test.mjs`, test "FAFF-746/706 spec-review command contract supplies non-empty system, diff, and context paths", line 1629.**

Replace the single positive gateway assertion with a positive on the surviving half plus a negative on the gateway:

```
PROCEDURE spec_review_argv_contract:
  1. Read plugin/skills/faffter-dark-spec-review/SKILL.md
  2. section := match "## Backend call" through "\n## Aggregation"      # unchanged
  3. ASSERT section matches  --system\s+…/refute-<lens>\.md              # unchanged
  4. ASSERT section matches  --diff\s+<spec-file>                        # unchanged
  5. ASSERT section matches  --context\s+<each file the spec names>      # REPLACES the gateway positive
  6. ASSERT section does NOT match  --context\s+plugin/skills/faff/SKILL\.md
  7. ASSERT section matches  fan-out\.mjs                                # unchanged
```

Step 5 is what keeps step 6 honest. The section match uses `?.[0] || ""`, so on an empty section a bare negative assertion passes vacuously; the surviving positives fail loudly instead, which is the guard.

**Chosen:** assert absence (step 6) rather than merely deleting the old positive. Rationale: the whole change is one deleted token in a prose file. Without a negative assertion, a future author restoring it for a plausible-sounding reason meets no resistance.

**Chosen:** anchor the negative to `--context\s+<path>` rather than to the bare path anywhere in the section. Rationale: it locks the argv, which is the thing under decision, while leaving a future author free to cite the gateway path in surrounding prose for an unrelated reason.

**New test — same file, immediately after the edited one.**

```
TEST "FAFF-882 code-review command contract: --context is the touched files, never the gateway"
  1. Read plugin/skills/faffter-dark-adversarial-review/SKILL.md
  2. section := match "## LLM provider integration" through "\n## Output to faff-graft"
                (verified headings: lines 112 and 263; the block at line 181 and the
                 rationale bullet at line 198 both fall inside)
  3. ASSERT section is non-empty            # guards against a silent pass on a renamed heading
  4. ASSERT section matches  --system\s+<review-lens-file>
  5. ASSERT section matches  --diff\s+<git-diff-file>
  6. ASSERT section matches  --context\s+<each file the diff touches>
  7. ASSERT section does NOT match  --context\s+plugin/skills/faff/SKILL\.md
```

**Chosen:** add coverage for the code-review call site. Verified: grep of `test/*.mjs` for `faffter-dark-adversarial-review/SKILL.md` returns nothing, so the argv on that path is currently asserted by no test at all. This change is the reason to have it, and shipping the same edit to two files with a guard on only one leaves the untested half free to drift back.

Step 3 is not decoration. Steps 6 and 7 both pass on `""`, so without it a renamed heading turns the whole test green for the wrong reason. The edited spec-review test does not need it because its surviving positives cover the same failure.

`assert.doesNotMatch` is the existing house idiom in this suite (`test/adversarial-call.test.mjs:2015`) and across the repo.

### 4.3 Edge cases

**The diff or spec actually touches the gateway.** Then `plugin/skills/faff/SKILL.md` is already in the touched-files set and is passed as `--context` exactly as before. No special case is needed and none should be written.

**`refuteFindings` target pool.** `review-call.mjs:1260` reuses the same context path list: `refuteFindings(res.content || "", a.context, {checkFn})`. Verified: `claimTargets` (line 344) filters to `isJsFamily(p)`, and `JS_FAMILY_RE` (line 320) is `/\.(m|c)?js$/i`. A `.md` path is never a refutation target, and the "generic claim, no file named" fallback at line 394 assigns `jsPaths`, also JS-family only. So the gateway was never checkable and removing it removes nothing from the checkable pool.

There is one real consequence, in the guard rather than the pool. Lines 394-395 read:

```js
const namedAnyContextPath = paths.some((p) => pathMentionedIn(s.raw, p));
if (!namedAnyContextPath) targets = jsPaths;
```

Today, a syntax-shaped finding that names `plugin/skills/faff/SKILL.md` and no other context path sets `namedAnyContextPath` true, which suppresses the generic fallback and leaves the finding untouched. After the change, when the diff does not touch the gateway, that same finding sees `namedAnyContextPath` false and falls back to checking every JS-family context path; if they all pass `node --check`, the finding is downgraded to `observation` rather than left alone.

**Chosen:** accept the change, document it here, write no code. Rationale: the guard's stated intent (the comment at lines 366-367) is "contextPaths is the FULL context list, unfiltered — mirrors what the reviewer was actually shown". A smaller context list means the guard keeps tracking exactly what it was written to track: a claim naming a file the reviewer was never shown is an uncommitted claim, and treating it as generic is correct, not a regression. The pass is downgrade-only, never drops a finding, and attaches its evidence, so the audit trail survives either way. Reachability is narrow: the finding must be syntax-shaped, must name the gateway and nothing else in context, and every JS context file must be clean.

**The evidence line is incoherent in that case, and that is a separate defect.** When the fallback fires it runs `node --check` over the JS-family context paths and attaches an evidence line asserting the syntax claim was mechanically disproved. For a claim about a `.md` file those checks say nothing at all, so the downgrade reaches the right outcome on evidence that does not support it. This is pre-existing behaviour that a smaller context list makes reachable more often, not something this change introduces. Record it in the PR body. Fixing it means teaching `refuteFindings` to distinguish "checked and clean" from "not checkable", which is its own ticket and out of scope here.

**Zero context files.** Not newly reachable. A spec or diff naming no repo files already produced a `--context`-free call before this change on any path where the gateway was absent, and `review-call.mjs` requires only a non-empty `--system` and `--diff` (line 1222).

### 4.4 Failure modes

The change's value rests on an assumption that has not been measured, so the ways it could be wrong are worth naming.

- **The gateway was carrying review quality after all.** How you'd know: FAFF-883's `none` arm scores materially worse than its `gateway` arm on the `refutation-code` and `refutation-spec` fixtures. What it means: abandon, or narrow to the spec-review path only. This is why the change is gated rather than shipped on argument.
- **FAFF-883 measures nothing, because its fixtures cannot detect the difference.** How you'd know: the `gateway` and `none` arms score within noise of each other on every case, which is also what a genuinely neutral removal looks like. FAFF-883's own open question 1 already flags that its fixtures may need planted defects that depend on gateway-supplied context. What it means: a null result is not the same as a pass; the human decides whether an undetectable difference is a reason to proceed or a reason to build better fixtures first.
- **The saving is smaller than the ticket claims.** How you'd know: FAFF-883's per-call payload instrumentation reports a delta well under about 65k tokens per lens, most likely because the touched-files half already dominates on a large diff. What it means: proceed anyway. The reduction is real regardless of size and the diff is seven lines; a small delta narrows the justification, not the change.
- **The prose edit lands but agents keep passing the gateway.** The call site is instructions to a model, not compiled code, so a stale copy in a cached context or an agent generalising from the surrounding examples could still emit the old argv. How you'd know: FAFF-883's instrumentation shows a per-call payload that has not moved after the change lands. What it means: the fix is elsewhere (prompt hygiene, or moving argv assembly into code), and this ticket's edit is necessary but not sufficient.

---

## 5. Scenarios

```
Given plugin/skills/faffter-dark-spec-review/SKILL.md after the change
When the "## Backend call" through "## Aggregation" section is read
Then it names --context <each file the spec names>
 And it nowhere pairs --context with plugin/skills/faff/SKILL.md
```

```
Given plugin/skills/faffter-dark-adversarial-review/SKILL.md after the change
When the "## LLM provider integration" through "## Output to faff-graft" section is read
Then it names --context <each file the diff touches>
 And it nowhere pairs --context with plugin/skills/faff/SKILL.md
 And that section is non-empty, so neither assertion can pass vacuously
```

```
Given the rewritten --context rationale bullet in faffter-dark-adversarial-review/SKILL.md
When a reader asks why only the touched-files half of the list survives
Then the bullet answers it in place, retaining the false-criticals incident as the warrant
     for the touched files rather than for the gateway
```

Non-functional assertions:

- The full `test/adversarial-call.test.mjs` suite passes, at 217 tests (216 at baseline, plus the new code-review contract test), with zero failures.
- `faff validate-adapters` returns `RESULT: PASS` with the same 20 slot skills linted and no new FAIL or WARN attributable to either edited file. Verified at baseline: neither file is in `SKILL_LINE_BASELINE` (`faff`, `faff-beep-boop`, `faff-graft` only), both sit far under the shared `SKILL_LINE_CAP` of 600 at 154 and 344 lines, and no edit adds or removes a line.
- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` has no change other than the two-line comment at 115-116. No argv parsing, no payload assembly, no exit-code path.
- No file outside the four named in the reference-context table is modified.

No holdouts are marked. This is a prose and test change with no runnable feature for the code-blind evaluator to exercise; a holdout here would be a string assertion the evaluator cannot make without reading the repo.

---

## 6. Design decision rationale

**Should a distilled orientation preamble replace the gateway?**
Options: ship a short purpose-written preamble alongside the touched files; ship nothing; keep the gateway. The preamble is attractive because it appears to preserve whatever the gateway was contributing at a fraction of the size, but it asserts the same unmeasured claim in a smaller package and would confound FAFF-883's `none` arm by shipping before the arm that tests it.
**Chosen:** ship nothing. The touched-files half is what lets a reviewer verify existence and structure claims, which is what the recorded counter-rationale was actually about, and every adopter that is not this repo has a reviewer looking at their own application code where faff's governance prose is irrelevant. The preamble survives only as FAFF-883's third arm.

**Does the measurement belong here?**
Options: build the harness in this ticket; split it out and gate on it. Building it here couples a seven-line prose reduction to a new eval runner, per-call payload instrumentation, a refreshed size baseline, and a quantitative regression threshold that has not been defined (FAFF-883's own open question 4).
**Chosen:** split, and gate. FAFF-883 is already filed and already the recorded blocker.

**Should the two call sites ship as one change or two?**
Options: one commit and PR touching both `SKILL.md` files and the test file; two, split by owning skill. The case for splitting is that the files are prose-owned separately, share no code path, and have asymmetric test coverage (one asserted, one not).
**Chosen:** one change. It is one rule being reversed, gated on one eval whose arms span both fixture families, and the total diff is roughly seven lines. Splitting doubles the review overhead and leaves an interval in which faff's two review lanes document contradictory rules about the same `--context` list. The asymmetric coverage is an argument for adding the missing test in this change, not for splitting it.

**What should `test/adversarial-call.test.mjs:1629` assert instead?**
Options: delete the line; assert the touched-files half is present; assert the gateway is absent; both.
**Chosen:** both. Deleting alone unlocks the change without locking it; a bare negative can pass vacuously on an empty section match; together they pin the argv in both directions. See section 4.2.

**Should the code-review call site get a test?**
Options: leave it uncovered; mirror the spec-review contract test.
**Chosen:** mirror it. Verified: nothing under `test/` reads `faffter-dark-adversarial-review/SKILL.md` today. Shipping the same edit to two files while guarding only one is how the guarded half stays correct and the other drifts.

**Should `review-call.mjs:115` and `faffter-dark-spec-review/SKILL.md:32` and `:86` be included?**
Options: hold the line at the two argv sites named in the ticket; include everything that states the rule.
**Chosen:** include. Locations 1 and 4 are in a file already being edited and are pure deletion or substitution; location 7 is a comment. All three would otherwise assert, in the repo, the opposite of what ships. This is the tail of the same edit, not new scope: no new file is opened that the change does not already require, and no behaviour is added.

**Should the `refuteFindings` guard be adjusted to compensate for the smaller context list?**
Options: leave it; pass an unfiltered "what the reviewer saw plus the gateway" list to preserve today's suppression behaviour.
**Chosen:** leave it. The guard is written to mirror what the reviewer was actually shown, so it keeps doing that with a smaller list; the compensating change would reintroduce the gateway through the back door to preserve a suppression that was incidental. Full analysis in section 4.3.

---

## 7. Open questions and assumptions

### Open questions

None. Every decision in this spec carries a `**Chosen:**` marker.

### Assumptions

**Assumes:** the L4 run's recorded attribution stands — the gateway in `--context` is a live cause of failed, slow, and hallucination-heavy review calls.
*Validation before starting:* none required. The attribution is the operator's, from a real run against real specs and diffs, and is stronger evidence than a synthetic fixture harness could produce. FAFF-883 is **not** a precondition and does not block this ticket; it remains in Backlog as the escalation path if a defensible graded number is ever wanted. Recorded on the ticket 2026-08-19, with the supporting finding that all 18 graded fixtures across `refutation-spec`, `refutation-code` and `spec-verdict` are synthetic 1-2 KB snippets naming no repo path and no gateway file, so a three-arm harness over them would return a guaranteed null result.

**Assumes:** `plugin/skills/faffter-dark-spec-review/SKILL.md` still carries the headings `## Backend call — reuse the shared transport (do not fork it)` (line 49) and `## Aggregation — the majority/severity gate (deterministic)` (line 106), and `plugin/skills/faffter-dark-adversarial-review/SKILL.md` still carries `## LLM provider integration` (line 112) and `## Output to faff-graft` (line 263).
*Validation before starting:* `grep -n "^## " <file>` on both. Both tests scope by these headings; a rename breaks the section match. The new test's non-empty assertion catches the adversarial-review case at CI time.

**Assumes:** `test/adversarial-call.test.mjs` still passes at 216 tests before the change.
*Validation before starting:* `node --test test/adversarial-call.test.mjs`. Verified passing at commit `bf85fc98`.

---

## 8. DONE — definition of done

### From WHY

- [ ] `grep -rn -- "--context plugin/skills/faff/SKILL.md" plugin/` returns zero results.
- [ ] `git diff --stat` names exactly four files: the two `SKILL.md` files, `review-call.mjs`, and `test/adversarial-call.test.mjs`.
- [ ] No line is added or removed in either `SKILL.md`; `wc -l` remains 154 and 344.

### From WHAT (the edit surface)

- [ ] `faffter-dark-spec-review/SKILL.md:32` reads "the files the spec names" and does not say "the gateway plus".
- [ ] `faffter-dark-spec-review/SKILL.md:76` is unchanged (the `node -e` placeholder comment never named the gateway).
- [ ] `faffter-dark-spec-review/SKILL.md:84` names `--context <each file the spec names>` and not `--context plugin/skills/faff/SKILL.md`.
- [ ] `faffter-dark-spec-review/SKILL.md:86` reads "the files the spec names as `--context`".
- [ ] `faffter-dark-adversarial-review/SKILL.md:181` reads `--context <each file the diff touches> \` with no gateway argument.
- [ ] `faffter-dark-adversarial-review/SKILL.md:198` names only the touched files, retains the false-criticals sentence, attributes it to the touched files, and contains no ticket identifier.
- [ ] `review-call.mjs:115` says "every file the diff touches" and does not say "the gateway".

### From HOW (behaviour)

- [ ] `review-call.mjs` diff is confined to lines 115-116; argv parsing (line 831), file reads (line 1221), `assembleUserMessage` (lines 115-122 body), `checkPayloadSize` (lines 128-140), and the `refuteFindings` call (line 1260) are byte-identical.
- [ ] No change to `fan-out.mjs`, `review-spawn.mjs`, or anything under `plugin/skills/faff/bin/`.

### From HOW (the test change)

- [ ] The "FAFF-746/706 spec-review command contract" test asserts `--context\s+<each file the spec names>` matches.
- [ ] The same test asserts `--context\s+plugin\/skills\/faff\/SKILL\.md` does **not** match, via `assert.doesNotMatch`.
- [ ] Its other four assertions (`--system`, `--diff`, `fan-out.mjs`, and the section scoping) are unchanged.
- [ ] A new test covers the `faffter-dark-adversarial-review/SKILL.md` call site, scoped `## LLM provider integration` through `## Output to faff-graft`, asserting the section is non-empty, that `--system <review-lens-file>`, `--diff <git-diff-file>`, and `--context <each file the diff touches>` all match, and that `--context plugin/skills/faff/SKILL.md` does not.
- [ ] Both negative assertions fail when the gateway argument is reinstated by hand. Verify by re-adding it, running the suite, seeing two failures, and reverting.

### From HOW (edge cases)

- [ ] The spec records that a diff touching `plugin/skills/faff/SKILL.md` still passes it via the touched-files half, and no code implements a special case for it.
- [ ] The `refuteFindings` guard consequence at `review-call.mjs:394-395` is documented in the PR body, with the finding that `claimTargets` filters to `/\.(m|c)?js$/i` so the checkable pool is unchanged.

### Regression

- [ ] `node --test test/adversarial-call.test.mjs` reports 217 tests, 0 failures.
- [ ] `node --test test/` reports no new failures against the pre-change baseline.
- [ ] `faff validate-adapters` reports `RESULT: PASS (20 slot skills linted)` with no new FAIL or WARN naming either edited skill.

### Eval coverage

- [ ] No new judgement seam is registered. The two affected seams, `refutation-spec` (surface `faffter-dark-spec-review`) and `refutation-code` (surface `faffter-dark-adversarial-review`), already exist in `eval/seam-registry.json` with status `covered`. This change alters an existing seam's input assembly, not its grader kind, and adds no new seam. FAFF-883 owns the arm comparison over those seams.

### Integration smoke test

```
PROCEDURE smoke:
  1. grep -rn -- "--context plugin/skills/faff/SKILL.md" plugin/     → expect zero lines
  2. node --test test/adversarial-call.test.mjs                      → expect 217 pass, 0 fail
  3. faff validate-adapters                                          → expect RESULT: PASS
  4. Re-add "--context plugin/skills/faff/SKILL.md " to BOTH call sites
     (spec-review SKILL.md:84 AND adversarial-review SKILL.md:181),
     re-run step 2                                                   → expect 2 fails,
                                                                       one per contract test
  5. git checkout both files, re-run step 2                          → expect 217 pass
```

Step 4 is the part that matters: it proves the new guards are load-carrying rather than decorative. It reinstates the argument in **both** call sites and expects **two** failures, one from each contract test, matching the DONE criterion above. A single-file variant would exercise one guard and leave the other unproven.

confidence: high