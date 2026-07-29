# Repoint the house-voice clause at `AGENTS.md`, and lint the pointer so the next one fails loudly

> Spec: faffter-dark-nlspec · 2026-07-29 · autonomous · revision 2 (final) · confidence: high. Full spec on Linear FAFF-678.

## Why

FAFF-634 shipped a one-line clause that every durable-prose dispatch stamps into its prompt: *read the house voice from a file at the repo root and write to it*. Since commit `9347430` (PR #500, 2026-07-28) the file that clause names — `.agents/STYLE.md` — does not exist. That commit consolidated contributor guidance into root `AGENTS.md`; the `.agents/` directory went with it, and nothing updated the five references in skill prose.

The clause ends with *"File absent → skip this instruction"*. So every dispatch since has read a path, found nothing, and carried on. No park, no error, no log line. FAFF-634's mechanism has been inert for a week and there is no run artifact anywhere that says so — the first notice was an orchestrator reading the clause by hand during a live run.

Two things are broken and only one of them is the path. The pointer is wrong, which is a five-line edit. The reason nobody found out is that a canonical, quoted-verbatim path reference in skill prose has no guard behind it at all — `faff validate-adapters` lints line caps, duplicated blocks, delegation literals and enum restatements, and `faff lint-refs` lints `docs/guide/` for external-artifact citations, but neither has ever asked whether a path named in a prompt resolves to anything. Fixing only the path leaves the same trap set for the next consolidation.

Confirmed against the working tree: `git grep -n '\.agents/STYLE\.md' -- 'plugin/skills/*/SKILL.md'` returns five hits in four files (gateway `plugin/skills/faff/SKILL.md:916`; `plugin/skills/faffidavit-rendering/SKILL.md:38` and `:42`; `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md:37`; `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md:30`), and `.agents/` is absent. The voice content is now at `AGENTS.md` lines 24–60 under `# Writing style`, with `## Voice`, `## Positioning language`, `## Claims` and `## Banned words` beneath it.

## What

Two deliverables, both small.

**One.** The five references name the `# Writing style` section of root `AGENTS.md`. The clause sentence stays a single canonical definition in the gateway, quoted byte-for-byte at the two concurrency stamp sites — only the path inside it changes.

**Two.** `faff validate-adapters` grows a voice-pointer check that would have failed CI on PR #500: it derives the voice source path from the gateway's own clause, asserts every other skill that quotes the clause names the same path, and — when linting faff's own source tree — asserts that path resolves on disk.

Out of scope: the runtime fallback behaviour stays as it is (see below), and FAFF-663's tracker state is housekeeping for a human.

## How

### The new clause

> *"House voice: read the `# Writing style` section of `AGENTS.md` at the repo root (worktree included) and apply it to all durable prose you write — specs, PR bodies, commit messages, tracker comments. File or section absent → skip this instruction."*

**Chosen:** the clause names `AGENTS.md` plus the `# Writing style` heading, rather than the bare file or a resurrected `.agents/STYLE.md`. The content is genuinely there and nowhere else; `AGENTS.md` is git-tracked so it is present at the root of every worktree, which is what the existing "(worktree included)" parenthetical promises; and `AGENTS.md` is the convention other agent tooling already converged on, so an adopter repo plausibly has one. Naming the heading keeps the instruction precise: root `AGENTS.md` also carries the skill-authoring standard, which has nothing to do with how prose reads.

**Chosen:** no compatibility fallback chain. Nothing outside skill prose and archived design docs ever told anyone to create `.agents/STYLE.md` — verified by grep over `docs/guide/`, `website/`, `README.md`, `docs/skill-authoring.md` — so there is no installed base. Two candidate paths would also double what the new lint has to reason about.

The three quoting sites (gateway, `faffter-dark-concurrency-parallel`, `faffter-noon-concurrency-sequential`) carry the sentence verbatim. The `faffidavit-rendering` charter's two references are prose *about* where the rules live, not quotes of the clause, so they get rewritten in place rather than substituted.

**Chosen:** the engine-lane fork appends the `# Writing style` section's contents, not the whole of `AGENTS.md`. An `engine:<name>` dispatch has no filesystem. The rest of `AGENTS.md` is guidance for someone editing a `SKILL.md`; sending it to an engine lane writing a spec is payload for nothing.

**A hard size constraint.** `plugin/skills/faff/SKILL.md` is 1117 lines against `SKILL_LINE_CAP_OVERRIDE` 1120 (`validate-adapters.js:42`). Three lines of headroom. Every change is an in-place substitution inside an existing line; do not add paragraphs to the gateway. (The 200-word paragraph cap does not apply — `isProseLine` at `:59` excludes lines starting `**` or `N.`, which all five are.)

### Failing open

**Chosen:** the per-dispatch fallback stays open — file or section absent still means skip. The loudness moves to CI in the repo that owns the pointer.

What went wrong here was an authoring mistake inside faff's own repo. An adopter repo with no `AGENTS.md` voice section is not making a mistake — it just has no house voice, which is the case the fallback was written for. Making the dispatch fail loud converts an optional file into a hard dependency for every adopter so that faff can catch its own drift. Put the check where the drift happens.

The honest limit: this leaves an adopter whose `AGENTS.md` section goes missing in exactly the silent state this ticket describes. Closing that properly means a once-per-run voice-source resolution with a run-ledger event — a larger change than repointing five strings.

### The lint

A new check in `plugin/skills/faff/bin/lib/validate-adapters.js`, inside `cmdValidateAdapters` over the same `allSkills` sweep the sibling lints use. Already wired into CI: `.github/workflows/validate.yml` runs `validate-adapters` as its first step.

It derives rather than restates, following the precedent where `inlineEnumLintSets()` reads its value sets from `CONTRACT_DESCRIBES`. A second home for the pointer would be the same class of bug one level down.

1. **Extract.** Find the gateway's clause line in `faff/SKILL.md` (anchor: the literal `House voice:`), and take the first backticked token on that line that looks like a path — contains `/` or ends in `.md`. That token is the canonical voice source.

   **Two distinct absence cases, and they are not the same** *(revision 1 — the reviewer's architectural major)*:
   - **No gateway `SKILL.md` in the resolved skills dir** → skip the whole check silently. This is the fixture-harness case: the sibling suites spawn against a `mkdtempSync` dir with no `faff/`, and they must keep passing.
   - **Gateway present, but no `House voice:` anchor or no path-shaped token on it** → **hard fail**, when and only when leg 3's source-tree condition holds. Reusing the skip here would make the guard silently vacuous in precisely the drift case it exists for: delete or reword the clause and the runtime fails open *by design* while the lint also falls silent. Two silences is how this bug survived a week. In faff's own tree, a gateway that has lost its clause is a failure, not a no-op.
2. **Agreement.** Every other `SKILL.md` line mentioning the voice (case-insensitive `house voice` / `voice rules` / `the voice`) that carries a path-shaped backticked token must name the same token. A mismatch is a partial repoint — the failure where someone updates the gateway and misses a quoting site — and fails naming both paths.
3. **Resolution.** The canonical token must exist on disk. This leg runs **only** when the resolved root is faff's own source tree, detected by the presence of `eval/` — the marker `loadSeamRegistryForLint()` (`validate-adapters.js:144`) already uses, resolving the root as `path.resolve(HERE, "..", "..", "..", "..")`. In a plugin install or an adopter repo, the leg is skipped. Existence only — an adopter's `AGENTS.md` may hold their voice under a different heading.

**Chosen:** a narrow derived pointer lint, not a general "every path in skill prose resolves" check. Skill prose is full of paths that deliberately do not exist in any checkout — `.faff/runs/<run_id>/…`, worktree paths, adopter paths, illustrative examples. A general check needs an allowlist, and that allowlist is a tax on every future skill edit. The narrow version has no allowlist and additionally catches a failure the general one would miss: three copies of one sentence drifting apart.

**Fixture isolation** *(revision 1 — the reviewer's QA minor)*: leg 3 resolves against faff's real repo root even when `--skills-dir` points at a tmpdir, so fixtures would assert a property of the surrounding checkout rather than of the fixture. Either drive leg 3's root from the existing `--root` flag (`validate-adapters.js:9`, `:366`) so a fixture supplies its own, or have negative fixtures name a provably impossible path. Whichever is chosen, a fixture's verdict must not depend on files outside the fixture.

Tests land as `test/validate-adapters-voice-pointer.test.mjs`, following `test/validate-adapters-enum-restatement.test.mjs` — `spawnSync` the CLI against a `mkdtempSync` fixture dir. Fixtures that exercise legs 1–3 must include a stub `faff/SKILL.md`.

## Open questions

- **Assumes:** root `AGENTS.md` exists and carries `# Writing style`. Verified at lines 24–60; re-checkable as `test -f AGENTS.md && grep -q '^# Writing style' AGENTS.md`.
- **Punt:** document the voice-source convention for adopters in `docs/guide/`, or leave it discoverable only by reading skill prose — needs human *(decides: product)*. An adopter has no way to learn that a `# Writing style` section in their `AGENTS.md` changes how faff's dispatched agents write. Documentation scope with a positioning question attached. **Does not block the build** — no DONE criterion depends on it.

## Done

Every check is runnable from the repo root.

1. No skill prose references the deleted path: `git grep -c '\.agents/STYLE\.md' -- 'plugin/skills/*/SKILL.md'` exits non-zero with no output.
2. The five references now name the new one: `git grep -c 'AGENTS\.md' -- 'plugin/skills/*/SKILL.md'` reports `faff:1`, `faffidavit-rendering:2`, `faffter-dark-concurrency-parallel:1`, `faffter-noon-concurrency-sequential:1`. (A one-shot acceptance check, not a standing lint — the exact counts are deterministic now because the current count is zero.)
3. The clause is still one sentence, not three: extracting the `House voice: …skip this instruction.` span from the three quoting files and piping through `sort -u | wc -l` yields `1`.
4. The target resolves: `test -f AGENTS.md && grep -q '^# Writing style' AGENTS.md` exits 0.
5. `node plugin/skills/faff/bin/faff validate-adapters` exits 0 — covering the gateway line cap (1120) and the duplicated-block detector, both of which the edit sits close to.
6. `node --test test/validate-adapters-voice-pointer.test.mjs` exits 0, covering at minimum: (a) a fixture whose gateway clause names a path that does not resolve → non-zero exit naming the unresolved path; (b) a fixture where a quoting skill names a different path from the gateway's → non-zero exit naming both; (c) a fixture matching the fixed tree → exit 0; (d) *(revision 1)* a fixture with a gateway present but its `House voice:` line removed → non-zero exit, proving the reworded-clause case fails rather than skipping; (e) a fixture dir with no `faff/` at all → exit 0, proving the sibling suites still pass. **Every one of these must be decided by fixture content alone** — see Fixture isolation above.
7. **Regression proof, from static text, not a moving ref** *(revision 1 — the reviewer's QA major)*. A fixture in the test file carries the pre-fix clause text verbatim (the `.agents/STYLE.md` form, copied as a string literal), and the lint exits non-zero against it. This is the assertion that the guard would have caught PR #500. It must **not** be expressed as "check out `origin/main` and run the lint": that inverts the day this PR merges, since `origin/main` will then name a path that resolves — and a PR checkout cannot be relied on to have the ref at all.
8. No workflow edit needed, verified rather than assumed: `grep -c 'faff validate-adapters' .github/workflows/validate.yml` ≥ 1, and `grep -c 'node --test' .github/workflows/validate.yml` ≥ 1.
9. Full suite green: `node --test` exits 0 (with `FAFF_REQUIRE_DOCKER` handling per the existing CI lane).

## Self-review

### Revision 1 — after an approach review returned `revise`

Three objections, all accepted and fixed; each was a real defect rather than a matter of taste.

- **major, fixed** — the lint's step 1 specified a skip arm only for a missing gateway file, leaving *gateway present but clause reworded or deleted* undefined. The natural implementation reuses the skip, which makes the guard silently vacuous in exactly the drift case it exists for — on top of the deliberate runtime fail-open, that is two silences. Step 1 now splits the two absence cases explicitly: missing gateway skips, missing clause hard-fails in the source tree. New DONE criterion 6(d) pins it.
- **major, fixed** — DONE criterion 7 pinned the regression fixture to `origin/main`, a moving ref. It passes once before merge and inverts immediately after, because post-merge `origin/main` names a path that resolves. Phrased like the other runnable checks, a build agent could reasonably commit it into `test/`, where it goes green on the build's own run and red for everyone the next day. Rewritten to use static pre-fix text as a string literal, with the moving-ref form explicitly barred.
- **minor, fixed** — leg 3 resolves the derived token against faff's real repo root even under `--skills-dir`, so criterion 6's fixtures asserted a property of the surrounding checkout: 6(c) passed only because the real `AGENTS.md` happens to exist, and 6(a) could false-pass if anyone created the named path. Added the Fixture isolation paragraph naming the existing `--root` seam, and made fixture-decided verdicts an explicit requirement of criterion 6.

### First pass — findings from the original draft

- **minor, fixed** — first draft asserted the gateway clause line would breach the 200-word paragraph cap. It is 199 words, and `isProseLine` excludes lines starting `**` or `N.` anyway, so the cap never applied. Replaced with the real constraint: the gateway's 1117-of-1120 line budget.
- **major, fixed** — the lint originally resolved the repo root with `findRoot()`, which in an adopter repo resolves to *their* root, failing *their* CI because *their* repo has no `AGENTS.md`. That would have turned a faff authoring guard into an adopter-hostile check, contradicting the fail-open decision two paragraphs above it. Switched to the `HERE`-relative root plus the `eval/` source-tree marker.
- **major, fixed** — the test-harness constraint was missing. The sibling fixture suites run against a tmpdir with no gateway, so without an explicit skip the new check would fail every existing fixture test.
- **minor, fixed** — DONE 3 originally claimed all four files carry byte-identical clause text. They do not: `faffidavit-rendering` describes where the voice lives rather than quoting the clause. Narrowed to the three genuine quote sites.
- **minor, accepted** — leg 2's "line mentions the voice" heuristic could fire on an unrelated line carrying a path-shaped backtick. Checked all five current lines; the other backticked tokens (`rendering_adaptor`, `models.build`, `BuildDispatch`) are not path-shaped. Left for the build to tighten against fixtures.
- **minor, accepted** — no DONE check proves worktree resolution from inside a real worktree. `AGENTS.md` is git-tracked at the root, so it holds by construction; standing up a `git worktree` in a test for a property `git ls-files` settles is not worth the cost.

Two review passes. Three objections in the second, all fixed. No blockers at any point.

confidence: high
