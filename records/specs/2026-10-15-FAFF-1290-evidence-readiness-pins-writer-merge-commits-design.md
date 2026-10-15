# evidence-readiness: pin each writer's merge commit so a later PR cannot displace it

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1290.

> Revised on 2026-10-15 after spec-review round 1: the oldest-match rule was replaced by pinned merge commits with today's newest-match rule as the fallback, because oldest-match could report a writer as merged on the strength of an earlier commit that only names the ticket (infosec, major).

This spec is for the build agent picking up FAFF-1290 and for its reviewers. FAFF-1290 is a small fix to `faff evidence-readiness` (added by FAFF-1263) so that a later commit naming a writer ticket cannot displace that writer's resolved merge commit, without letting an earlier commit stand in for the writer.

## 1. WHY

**The idea the rest depends on.** A commit subject cannot tell a writer's real merge from any other commit that names the same ticket, whether that commit came before the merge (an ADR proposal) or after it (a follow-up fix). So readiness keeps a short table of known writer merge commits, checks each one is really on `HEAD`, and uses it. Only a writer with no verified pin falls back to today's newest-match rule, which can fail falsely but never passes falsely.

**Problem.** `resolveWriters` takes the newest first-parent commit whose subject contains `(<ticket>)`. Any later PR naming a writer ticket then becomes "the writer", reads as merged after `--since`, and fails readiness with no defect in the evidence. It is already live on `main` at 4839e550: FAFF-1266 resolves to `9ba281e9` (`chore(eval): record the finding-identity baseline (FAFF-1266) (#1060)`), not its feature merge `10a8ece4` (#1057). FAFF-1270's proving runs choose `--since` after FAFF-1268 merges, so any such follow-up would block FAFF-1261's enforcement switch.

**Design principles.**

- **Never less strict than today.** The newest-match rule is fail-closed: if the newest matching commit is at or before `--since`, every matching commit is, including the real merge. A pin may replace that rule only with a commit verified on `HEAD`'s first-parent chain whose subject names the ticket. No other path may turn a writer from failing to passing. A correct pin, or one that fails verification, is never looser than today; a wrong pin that still verifies is guarded only by review of the pin table, the same review that guards any edit to this module.
- **No bypass surface.** No flag, environment variable or config key changes the pins. They change only by a reviewed code change to the module.
- **Keep the exact match.** The literal `(<ticket>)` text, parentheses included, stays the subject rule. It keeps `FAFF-126` from matching `FAFF-1266` and ignores prose mentions such as `for FAFF-826`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/evidence-readiness.js` (`resolveWriters`, `WRITER_TICKETS`, `evidenceReadinessSelftest`) | JS | The function to change, the constant to pin beside, and the selftest to extend |
| `test/faff-1263-evidence-readiness.test.mjs` | JS (node:test) | Temp-git-repo tests; some already load the module in-process with `require` |
| `test/faff-1263-evidence-warn-only-mint.test.mjs` | JS (node:test) | Runs `evidence-readiness --selftest`, so new selftest cases run in CI |
| `docs/guide/cli.md` (the `evidence-readiness` row) | Markdown | States how a writer commit is found |
| `records/specs/2026-10-14-FAFF-1263-…-design.md` | Markdown | Historical record of the newest-match choice; left as written |

**Scope.** One function's resolution rule and one new constant in a read-only factory-region command, plus tests and one doc row.

## 2. OUT OF SCOPE

- **Pinning FAFF-1268 before it merges.** Why excluded: its merge sha does not exist yet. Extension point: its `WRITER_MERGES` entry, a one-line change once it merges (see Open questions).
- **Printing commit subjects in the report.** Why excluded: FAFF-1263 limits output to paths, statuses, counts and shas; a subject is free text from a PR title. Extension point: `renderHuman` and the `writers[]` record.
- **Changing the window, binding or anchor rules.** Why excluded: unrelated to writer resolution. Extension point: `collect`.
- **Editing FAFF-1270's spec.** Why excluded: another ticket's artifact. Its anti-pattern and failure-mode lines about writer-ticket PR titles stop applying to pinned writers once this merges; FAFF-1270 already says it does not wait for FAFF-1290.

## 3. WHAT

**Vocabulary.**

| Term | Meaning |
|---|---|
| Matching commit | A commit on `HEAD`'s first-parent chain whose subject contains the literal text `(<ticket>)` |
| Pin | The full 40-hex sha recorded for a writer ticket in `WRITER_MERGES`, or null |
| Verified pin | A pin that appears in `HEAD`'s first-parent log and whose subject there contains `(<ticket>)` |
| Resolved commit | The one commit readiness reports for a writer ticket |

**The pin table.** A frozen constant beside `WRITER_TICKETS`, with exactly the same keys:

```
WRITER_MERGES = {
  "FAFF-1266": "10a8ece4ad9a675c81fdead6fab8ccfaa447ca4b",   # feat(review) … (FAFF-1266) (#1057)
  "FAFF-1267": "35e2de21a3d127467244dd8624d67352de3b6a51",   # (#1053)
  "FAFF-1268": null,                                          # not merged at the time of writing
  "FAFF-1258": "d506fed13729961d0425e9da281089c9753ed93e",   # (#1055)
  "FAFF-1259": "e1b6f4c727905c0e5d2ff1a435077ebc74c710cb",   # (#1054)
  "FAFF-1260": "b76edaa3082cccdb9fb99ca5b125b7c6e3777809",   # (#1062)
  "FAFF-1277": "a3f9d7d00c2b387a29e7f969de8f7169b2971787",   # (#1061)
}
CONSTRAINT keys(WRITER_MERGES) = set(WRITER_TICKETS)
CONSTRAINT every value is null or matches ^[0-9a-f]{40}$
```

If FAFF-1268 has merged on `main` when the build starts, pin its merge sha too.

**Report shape.** Unchanged: `writers: List<{ issue: String, commit: String | null, before_since: Boolean }>`, one per `WRITER_TICKETS` entry, in `WRITER_TICKETS` order. No new field, flag or `unmet` text.

**Pure resolver.** A new exported function so the rule is testable without git:

```
FUNCTION resolveWriterCommits(lines: List<String>, tickets: List<String>, merges: Map<ticket, sha | null>) -> Map<ticket, sha | null>
  # lines: `git log --first-parent --format=%H%x09%s HEAD` output, newest first, "<sha>\t<subject>" per line
  FOR each ticket T in tickets:
    names(line) := subject of line (text after the first tab) contains "(" + T + ")"
    pin := merges[T]
    IF pin != null AND some line has sha == pin AND names(that line):
      result[T] := pin                                   # verified pin
    ELSE:
      result[T] := sha of the FIRST line where names(line), or null   # today's newest-match rule
```

**Chosen:** pinned merge commits with the newest-match rule as fallback. A pin that is null, absent from `HEAD`'s first-parent chain, or on a commit whose subject does not name the ticket is ignored, and the writer resolves exactly as it does today.

**Chosen:** `resolveWriters(repoRoot, sinceSha, merges = WRITER_MERGES)`. The optional third parameter is reachable only by an in-process caller (tests); the CLI always passes the default. No argv flag or environment variable reaches it.

**Chosen:** keep the literal parenthesised match, not the `wholeToken` helper, for both the pin check and the fallback.

## 4. HOW

```
PROCEDURE resolveWriters(repoRoot, sinceSha, merges = WRITER_MERGES):
  1. lines := git log --first-parent --format=%H%x09%s HEAD, split on newline, empties dropped   # unchanged
  2. resolved := resolveWriterCommits(lines, WRITER_TICKETS, merges)
  3. FOR each ticket T in WRITER_TICKETS order:
       commit := resolved[T]
       before_since := commit != null AND `git merge-base --is-ancestor commit sinceSha` exits 0   # unchanged
       emit { issue: T, commit, before_since }
```

**Edge cases.**

- Verified pin plus a later commit naming the ticket after `--since`: the pin is resolved, `before_since` follows the pin only. This is the fix.
- Verified pin after `--since`: `before_since: false`, unmet `writer <T> merged after --since` (unchanged message). A `--since` before a writer's real merge still fails.
- Pin not on `HEAD` (a checkout or temp repo that lacks it): fallback to newest-match, so the result is never looser than today.
- Pin whose subject on `HEAD` does not contain `(<T>)` (a mistyped pin pointing at another commit): ignored, fallback to newest-match.
- Unpinned writer with no matching commit: `commit: null`, unmet `writer <T> has no merge commit on HEAD` (unchanged).
- One subject naming two writers: may be the resolved commit for both (unchanged).

**Failure modes.**

- **FAFF-1268 stays unpinned.** How you'd know: `WRITER_MERGES["FAFF-1268"]` is null after FAFF-1268 merges. What it means: FAFF-1268 keeps today's behaviour, so a later PR naming it can still fail readiness falsely (never pass falsely). FAFF-1270's spec already routes around this by choosing a later `--since`. Pinning it is a one-line follow-up.
- **A pin is wrong.** How you'd know: a temp or real check shows a writer resolving by fallback when a pin exists (the pin is not on `HEAD` or its subject does not name the ticket). What it means: the pin is ignored and readiness is no looser than today; fix the pin. A wrong pin that lands on another commit naming the ticket (an ADR proposal, say) would verify, so each pin is checked against its PR number in review and by the assumption below.

**Anti-pattern:** taking the oldest matching commit. Why: an earlier commit that only names the ticket (FAFF-1109's ADR proposal #1018 preceded its build) would report a writer as merged before its code landed, so readiness could pass falsely.

**Anti-pattern:** a flag or environment variable to override pins. Why: it is a way to make an unmerged writer read as merged; FAFF-1263 already refuses a writer-skip flag for the same reason.

## 5. Scenarios

```
Given a temp repo with first-parent commits "feat: writer (FAFF-1266) (#1)" (sha P), then every other writer, then <rev>, then "fix: follow-up (FAFF-1266) (#9)"
And resolveWriters is called in-process with merges = { all null except FAFF-1266: P }
When it resolves against <rev>
Then FAFF-1266 resolves to P with before_since true
And with merges all null, FAFF-1266 resolves to the follow-up commit with before_since false (today's behaviour)
```

```
Given a temp repo with "docs(adr): propose (FAFF-1266) (#1)", then <rev>, then "feat: writer (FAFF-1266) (#2)" (sha P)
And merges = { FAFF-1266: P }
When resolveWriters resolves against <rev>
Then FAFF-1266 resolves to P with before_since false
```

```
Given main at 4839e550 with this change applied
When faff evidence-readiness --since HEAD --json runs
Then writers[FAFF-1266].commit is 10a8ece4ad9a675c81fdead6fab8ccfaa447ca4b, and every other pinned writer reports its pin with before_since true
```

## 6. DESIGN DECISION RATIONALE

**How should readiness identify a writer's merge?**

- Newest match (today): fail-closed, but fails falsely whenever a later PR names the ticket; already wrong for FAFF-1266.
- Oldest match: fixes the false failure but can pass falsely on an earlier commit that only names the ticket. Rejected in round 1.
- Pins only, no fallback: exact, but every unpinned writer reads as missing, so FAFF-1270 would wait on a pin for FAFF-1268, and temp-repo tests could not run the CLI at all.
- Pins with newest-match fallback: exact for pinned writers, never looser than today for the rest, and temp repos (where pins are absent) keep today's behaviour.

**Chosen:** pins with newest-match fallback.

**How do tests reach the pin path?** Options: an environment variable, a CLI flag, or an in-process parameter. **Chosen:** an optional `merges` parameter on `resolveWriters` and the pure `resolveWriterCommits`, used only by in-process callers. The first two would be a runtime bypass surface.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None for this build. If FAFF-1268 merges after FAFF-1290, pinning it is a one-line follow-up that needs an owner; the build does not wait for it.

**Assumptions.**

- **Assumes:** the six pinned shas above are on `main`'s first-parent chain with subjects naming their tickets. Validation: for each pin, `git log --first-parent --format='%H %s' origin/main | grep '^<sha> '` prints one line containing `(<ticket>)`.

## 8. DONE

### From WHY
- [ ] On a checkout of `main` with this change, `faff evidence-readiness --since HEAD --json` reports FAFF-1266's commit as `10a8ece4ad9a675c81fdead6fab8ccfaa447ca4b` and every pinned writer at its pin
- [ ] No flag, environment variable or config key changes `WRITER_MERGES` or the resolution rule

### From WHAT
- [ ] `WRITER_MERGES` exists with exactly the `WRITER_TICKETS` keys, each value null or 40 lowercase hex, and the six shas listed above (plus FAFF-1268's if merged at build time)
- [ ] `resolveWriterCommits(lines, tickets, merges)` is exported and follows the pseudocode: verified pin, else first matching line, else null
- [ ] The subject match stays the literal `(<ticket>)`: `(FAFF-12660)` and an unparenthesised `FAFF-1266` do not match `FAFF-1266`
- [ ] The `writers[]` record shape, order, unmet messages and flags are unchanged

### From HOW
- [ ] `resolveWriters` takes an optional `merges` argument defaulting to `WRITER_MERGES`; the CLI path never passes one; its `before_since` check is unchanged
- [ ] `--selftest` covers, with synthetic lines: a verified pin wins over a newer matching line; a pin absent from the lines falls back to the newest match; a pin whose line does not name the ticket falls back; an unpinned ticket with no match is null; `WRITER_MERGES` keys equal `WRITER_TICKETS` and every value is null or 40 lowercase hex
- [ ] A temp-repo test (in-process `resolveWriters` with an injected `merges`) for each of the first two scenarios above
- [ ] The existing CLI temp-repo tests pass unchanged, since the shipped pins are absent from temp repos and fallback is today's rule
- [ ] `docs/guide/cli.md`'s `evidence-readiness` row says a writer resolves to its pinned merge commit when that commit is on `HEAD` and names the ticket, else to the newest `(<ID>)` first-parent commit

### Integration smoke test

```
1. node --test test/faff-1263-evidence-readiness.test.mjs test/faff-1263-evidence-warn-only-mint.test.mjs   -> pass
2. faff evidence-readiness --selftest   -> "evidence-readiness selftest: OK"
3. faff evidence-readiness --since HEAD --json on main   -> FAFF-1266 at 10a8ece4…, every pinned writer before_since true
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues. One resolution rule, one constant, its tests and one doc row: under a day.
- **Workstream fit?** No issues. FAFF-1290 sits under FAFF-1255 beside FAFF-1263, the command it corrects.
- **Deps surfaced?** No issues. FAFF-1270 relates to this ticket but deliberately does not wait for it, so no blocker link is needed. FAFF-1268 is not a blocker: the build pins it only if it has merged, and the fallback covers it otherwise.
- **Risk profile?** No issues. Read-only command, existing temp-repo test harness, no new integration.

confidence: high
build-tier: complex
spec-review: approve
