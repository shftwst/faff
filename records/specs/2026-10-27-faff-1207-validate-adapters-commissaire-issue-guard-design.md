# FAFF-1207 — Spec: a `validate-adapters` guard against the deprecated commissaire `--issue` flag

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1207.

This spec is for the build agent and human reviewers. It specifies a single, narrow deliverable: a regression guard in `faff validate-adapters` that FAILs any skill-prose file passing the deprecated `--issue` alias to the `faff commissaire` facade. The prose-rewrite half of the original ticket is already shipped (see WHY → Already shipped) and is explicitly out of scope.

## Already shipped against this surface

- **FAFF-1167** (Done, commit `475c0362`, #1003) — renamed the schema:3 unit key `issue`→`unit_id` and moved `faff-graft`/`faff-beep-boop` SKILL.md commissaire prose to `--unit-id`. Verified at prep time: zero live SKILL.md lines pass `--issue` to `commissaire`.
- **FAFF-1175** (Done) — moved the one external consumer (`verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs`) to `--unit-id`.

The original ticket's prose-rewrite half is therefore delivered; this spec is narrowed to the regression-guard delta only.

## 1. WHY — Problem and Principles

**The load-bearing model.** FAFF-1167 renamed the commissaire schema:3 unit key from `issue` to `unit_id` and made `--issue` a *deprecated one-release alias* of `--unit-id` across the whole `faff commissaire` facade (`effect declare|authorize|observe|reconcile`, `verdict conclude`, `audit anchor`). The alias still works but prints a stderr deprecation notice. Nothing mechanical stops skill prose from re-introducing `--issue` on a `commissaire` call, which would make every governed graft print the warning again — exactly the regression this ticket closes.

**Problem statement.** The skill prose was corrected to `--unit-id` (FAFF-1167/1175), but that correctness rests only on review vigilance. A future prose edit can silently bring `--issue` back on a `commissaire` invocation, and no check catches it. This change adds that check.

**Design principles.**

- **Precision over recall (fail-closed, but no false CI failures).** The guard FAILs CI, so a false positive blocks unrelated work. It must match only the `faff commissaire` facade's `--issue`, never the many unrelated commands whose own current `--issue` flag is correct.
- **Follow the established lint shape.** The repo already has the exact pattern (FAFF-1198 removed-dispatch-key lint). Mirror it; do not invent a new lint architecture.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node (plain `.js` emit; not TS-sourced) | Host of every SKILL.md lint rule — the guard is added here |
| FAFF-1198 removed-dispatch-key lint (same file, ~line 1110) | Node | Exact structural precedent: builds the `dispatchProseFiles` set (every `SKILL.md` + every `references/*.md`), matches per-line with lookbehind-guarded regexes, prints `FAIL <file> (<label>)` + per-line findings, sets `failed = true` |
| `test/validate-adapters-removed-dispatch-key.test.mjs` | Node test runner | Test template: `runOnFixture(skillBody, referenceBody)` writes a throwaway skill dir, runs `faff validate-adapters --skills-dir <dir>`, asserts on stdout + non-zero exit |

**Scope statement.** A new deterministic lint rule inside the existing `faff validate-adapters` CI gate.

## 2. OUT OF SCOPE

- **Rewriting skill prose from `--issue` to `--unit-id`.** Why: already delivered by FAFF-1167/1175; no live skill prose carries the deprecated alias. Extension point: n/a — the guard below is what keeps it that way.
- **Flagging `--issue` on non-commissaire commands** (`faff effects`, `run-ledger`, `build-claim`, `landing-claim`, `worktree-check|heal|prune`, `corrective`, `spec-review-dir`, `decision-capture`, `post-merge-check`, `bundle-recover`). Why: those flags are current and correct; FAFF-1175 §50 explicitly keeps them. Extension point: n/a — the regex is anchored to exclude them.
- **Removing the `--issue` alias from the `commissaire` CLI itself.** Why: that is the CLI's own one-release deprecation cycle, a separate concern from skill prose. Extension point: the commissaire arg-normalisation step in `commissaire.js`/`.ts`.
- **A git-history ratchet or auto-fix.** Why: a single present-tense FAIL lint is sufficient and matches the house pattern. Extension point: the lint function added here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| commissaire facade | The `faff commissaire <object> <action>` CLI surface (objects `effect`/`verdict`/`audit`), which accepts `--issue` as a deprecated alias of `--unit-id` |
| skill-prose file | A `SKILL.md`, or any `references/*.md`, under a skill directory — the files `validate-adapters` already scans |

**Interface — no new public surface.** The guard is an internal addition to the existing `faff validate-adapters` command. Its only observable contract:

```
INVARIANT validate-adapters-commissaire-guard:
  WHEN faff validate-adapters runs over the skills dir
  IF any scanned skill-prose file contains a `faff commissaire …` invocation that passes `--issue`
  THEN the command prints `FAIL <file-label> (commissaire --issue)` with one `✗ line <n>: …` per hit,
       sets the overall failure flag, and exits non-zero
  ELSE that rule contributes no output and does not affect the exit code
```

**Design decision — match surface.** Reuse the FAFF-1198 `dispatchProseFiles` enumeration (every `SKILL.md` + every `references/*.md`), so the guard covers references prose too. **Chosen:** scan the same file set as the removed-dispatch-key lint — it is the established "skill prose" surface and already handles the references subdir and file-label formatting (`name` vs `name/references/x.md`).

**Design decision — match predicate.** **Chosen:** a line-scoped regex that fires when a `faff commissaire` invocation token sequence is followed, later on the same line, by a `--issue` flag — e.g. the binary token (`faff`, `"$faff"`, or `"$FAFF"`) then `commissaire` then any non-backtick run then `--issue` as a whole word. Anchoring on the `commissaire` token immediately after the binary is what excludes every other command's `--issue`. The commissaire facade invocations in skill prose are always single-line backticked commands, so a per-line match is sufficient (mirrors FAFF-1198, which is also per-line).

- **Anti-pattern:** matching any line that merely contains the words `commissaire` and `--issue`. Why: a future prose sentence describing the deprecation ("`--issue` on commissaire is deprecated") would false-FAIL; require the invocation shape (binary → `commissaire` → … → `--issue`), not mere co-occurrence.
- **Anti-pattern:** a bare `/--issue/` scan. Why: it floods on the dozen legitimate non-commissaire `--issue` flags across the prose.

## 4. HOW — Behavior

**Approach.** Add one lint block to `cmdValidateAdapters` in `validate-adapters.js`, immediately adjacent to the FAFF-1198 removed-dispatch-key block, reusing its already-built `dispatchProseFiles` array (or an identical re-derivation if lexical scope requires). For auditability and unit testing, factor the predicate into a small pure exported helper, mirroring `lintInlineEnumRestatement(skillText)`.

```
FUNCTION lintCommissaireUnitId(text):              # pure; input is one file's text
  findings := []
  FOR each line, index i in text split on "\n":
     IF line matches COMMISSAIRE_ISSUE_RE:
        findings.push("line " + (i+1) + ": `--issue` is the deprecated commissaire alias; pass `--unit-id` (FAFF-1207)")
  RETURN findings

# COMMISSAIRE_ISSUE_RE (illustrative, not prescriptive):
#   binary token  = (?:"?\$?faff"?|faff)         case-insensitive on the var form
#   invocation    = <binary>\s+commissaire\b[^`\n]*?\s--issue\b
```

```
PROCEDURE run_guard(dispatchProseFiles):           # at the call site in cmdValidateAdapters
  FOR each { name, rel, file } in dispatchProseFiles:
     findings := lintCommissaireUnitId(read(file))
     IF findings non-empty:
        failed := true
        print "FAIL  " + (rel == "SKILL.md" ? name : name + "/" + rel) + " (commissaire --issue)"
        FOR each f in findings: print "        ✗ " + f
```

**Edge cases.**

- A `commissaire` invocation that correctly passes `--unit-id` → no match (the regex requires `--issue`).
- Another command's `--issue` on the same line as an unrelated `commissaire` word → the invocation-shape anchor (binary directly followed by `commissaire`) prevents a match unless `commissaire` is the invoked subcommand.
- A `references/*.md` file hit → reported with the `name/references/x.md` label, exactly as FAFF-1198 does.
- No skill dir / empty prose → the loop runs zero times; no output, exit unaffected.

**Export + registration.** Add `lintCommissaireUnitId` to the `module.exports` list at the bottom of `validate-adapters.js` so the test file can import it directly (several existing lint helpers are exported there).

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a throwaway skill whose SKILL.md contains a line
      `"$faff" commissaire effect declare --run-dir "$d" --unit-id <ISSUE> --step merge`
      rewritten to pass `--issue <ISSUE>` instead
When  `faff validate-adapters --skills-dir <dir>` runs
Then  stdout contains `FAIL  <fixture> (commissaire --issue)` with a `✗ line 1:` finding citing FAFF-1207,
      and the process exits non-zero
```

```
Given a throwaway skill whose SKILL.md passes `--issue` on non-commissaire commands only
      (`faff run-ledger init-interactive --issue …`, `faff effects check --issue …`,
       `faff build-claim acquire --issue …`, `faff worktree-prune --issue …`)
When  `faff validate-adapters --skills-dir <dir>` runs
Then  the commissaire guard contributes no `(commissaire --issue)` FAIL for that fixture
```

## 6. Design decision rationale

**Where does the guard live?**
- Options: (a) new lint block in `validate-adapters.js` reusing `dispatchProseFiles`; (b) a brand-new CLI subcommand; (c) a git grep in CI yaml.
- **Chosen:** (a) — the house pattern (FAFF-1198) is exactly this, it already runs in the CI gate via `faff validate-adapters`, and it gives references-file coverage for free. (b)/(c) duplicate machinery and miss the references prose.

**How tight is the match?**
- Options: bare `--issue`; co-occurrence of `commissaire` + `--issue`; invocation-shape anchor.
- **Chosen:** invocation-shape anchor (binary → `commissaire` → … → `--issue`). It is the only option that is both complete (catches the real regression) and precise (no false FAIL on legitimate `--issue` flags or on prose that merely mentions the deprecation).

**Edit the `.js` directly or a `.ts` source?**
- **Chosen:** edit `validate-adapters.js` directly. Per AGENTS.md only `producer-auth.ts`/`commissaire.ts` are TS-sourced; `validate-adapters.js` is a plain committed `.js` with no `.ts` sibling, so no `npm run build` emit step is involved.

## 7. Open questions and assumptions

**Open Questions.** None.

**Assumptions.**

- **Assumes:** `validate-adapters.js` has no `.ts` sibling (it is a hand-maintained `.js`). Validate before building: `ls plugin/skills/faff/bin/lib/validate-adapters.ts` returns not-found; if one exists, edit the `.ts` and rebuild the emit per AGENTS.md instead.
- **Assumes:** the FAFF-1198 `dispatchProseFiles` enumeration (SKILL.md + references/*.md, with its label convention) is present in `cmdValidateAdapters`. Validate: grep `dispatchProseFiles` in the file (confirmed present at spec time, ~line 1116).

## 8. DONE — Definition of Done

### From WHY
- [ ] Running `faff validate-adapters` over a skills tree that contains a `faff commissaire … --issue` invocation FAILs (non-zero exit) with a finding citing FAFF-1207.

### From WHAT / HOW (behaviour)
- [ ] A pure helper `lintCommissaireUnitId(text)` returns one finding per line whose content is a `faff commissaire` invocation passing `--issue`, and an empty array otherwise.
- [ ] The guard scans both `SKILL.md` and `references/*.md` files (the FAFF-1198 `dispatchProseFiles` set) and labels a references hit `<name>/references/<file>.md`.
- [ ] A `faff commissaire … --unit-id …` line raises no finding.
- [ ] `--issue` on non-commissaire commands (`run-ledger`, `effects`, `build-claim`, `landing-claim`, `worktree-*`, `corrective`, `spec-review-dir`, `decision-capture`, `post-merge-check`, `bundle-recover`) raises no finding.
- [ ] The guard FAIL label is `(commissaire --issue)` and sets the overall `failed` flag so the command exits non-zero.

### From HOW (integration)
- [ ] `lintCommissaireUnitId` is added to `module.exports` in `validate-adapters.js`.
- [ ] `faff validate-adapters` run against the live repo skills tree still exits 0 (no live skill prose regresses the guard).

### Test floor (repository test, judged by the merge/test gate, not the holdout)
- [ ] A new `test/validate-adapters-commissaire-unit-id.test.mjs` (modeled on `test/validate-adapters-removed-dispatch-key.test.mjs`) covers: a positive SKILL.md hit, a references/*.md hit, a clean `--unit-id` negative, and a non-commissaire `--issue` negative — and the existing test suite passes.

**Integration smoke test.**

```
1. mkdtemp skills dir; write zz-fixture/SKILL.md containing
   `"$faff" commissaire effect declare --run-dir "$d" --issue FAFF-1 --step merge`
2. run: faff validate-adapters --skills-dir <dir>
3. assert stdout matches /FAIL  zz-fixture \(commissaire --issue\)/ and status != 0
4. rewrite the line to `--unit-id FAFF-1`; re-run; assert no (commissaire --issue) FAIL
```

confidence: high
build-tier: standard
spec-review: approve
