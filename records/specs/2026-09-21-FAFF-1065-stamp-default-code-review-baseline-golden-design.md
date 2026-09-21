# Spec — FAFF-1065: Stamp the default-code-review baseline golden with a merge-base sha

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1065.

This is a buildable design spec for FAFF-1065, addressed to the build agent that will implement it and the human reviewers who gate it. It covers WHAT provenance the `default-code-review-payload.json` baseline golden must carry and HOW that provenance is written and verified, mirroring the FAFF-1051 unified-golden stamping already in the repository. The change is test/tooling only; no product runtime behaviour changes.

## 1. WHY — Problem and Principles

**The load-bearing idea:** a byte-for-byte "identical to today" golden is only trustworthy if it also records *which commit "today" was* — an ancestry anchor. Without that anchor, a future refactor can silently regenerate the golden against a different base, and the byte-identity test happily re-passes against the new bytes, having quietly redefined "today". The three FAFF-1051 unified goldens already carry this anchor as a `generated_from` commit sha; the default-code-review payload golden does not. This ticket gives it the same anchor and the same loud ancestry check.

**Problem statement.** `test/fixtures/trim-baseline/default-code-review-payload.json` (added in FAFF-1058) is the oracle proving the default unified code-review payload is byte-identical to today, but it is a flat `{ "system": "...", "user": "..." }` object with no provenance field, hand-committed rather than produced by any script. So a future regeneration against a different base is undetectable — "identical to today" can drift without a single test going red. This change stamps the golden with the merge-base sha it was captured at and extends the existing provenance test to assert that sha is a real ancestor of HEAD.

**Design principle — mirror FAFF-1051, do not invent a parallel mechanism.** The repository already has exactly one convention for this: a first-key `generated_from` field holding a 40-char commit sha (or `null`), an operator-supplied sha passed as `regenerate.mjs argv[3]`, and a shallow-clone-safe ancestry test. Any implementation that introduces a *different* field name, a *different* sha-supply path, or a *second* ancestry-check helper is wrong. Parity with the three unified goldens is the acceptance bar.

**Design principle — regenerate.mjs stays git-free and deterministic.** The generator script deliberately runs no git and reads no clock (its header states this). The sha is data passed in, never computed by the script. The ancestry *assertion* (which does shell out to git) lives in the test suite, not in the generator. Do not add `git` calls to `regenerate.mjs`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `test/fixtures/trim-baseline/regenerate.mjs` | Node ESM | Generator for the three unified goldens; already owns `generated_from` + the `argv[3]` sha convention. Gains a fourth golden. |
| `test/fixtures/trim-baseline/default-code-review-fixture.mjs` | Node ESM | Exports `captureDefaultCodeReviewPayload()`, which drives `main()` over a fixed fixture and returns `{ exit, system, user }`. Its capture becomes the source of the stamped golden. |
| `test/fixtures/trim-baseline/default-code-review-payload.json` | JSON | The golden being stamped. Gains a leading `generated_from` key. |
| `test/faff-1051-diff-kind.test.mjs` (provenance loop, ~L114–147) | Node test | The generic two-tier ancestry check. Its golden-name array gains one entry. |
| `test/faff-1058-controllable-trimming.test.mjs` (byte-identity test, ~L147–156) | Node test | The consumer; reads only `.system`/`.user`, so it tolerates the new key unchanged. |

**Scope.** A provenance hardening of one existing test fixture and its generator — it sits entirely inside `test/`, and touches no plugin/skill runtime path.

## 2. OUT OF SCOPE

- **Proving the bytes were actually produced at the stamped commit.** Excluded — the ancestry check proves only that `generated_from` names an ancestor of HEAD, not that the committed bytes were captured at that commit. This is the exact same limitation the FAFF-1051 goldens accept; strengthening it (e.g. re-deriving bytes from the historical module in CI) is a separate, larger effort. Extension point: a future check in `test/faff-1051-diff-kind.test.mjs` could reconstruct the payload from `git show <sha>:…review-call.mjs`.
- **Making `regenerate.mjs` compute the merge-base itself.** Excluded — violates the git-free principle above. Extension point: a wrapper shell script or a Makefile target could compute `git merge-base` and invoke `regenerate.mjs` with the result.
- **A dedicated new CI workflow step for the ancestry check.** Excluded — `validate.yml` already runs `node --test`, which runs the provenance test; a bespoke step would duplicate the shallow-clone guard for no gain. Extension point: `.github/workflows/validate.yml` if a standalone gate is ever wanted.
- **Backfilling provenance onto any other hand-committed fixture.** Excluded — only the default-code-review golden is in this ticket's charter.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Merge-base sha | The commit at which the golden's bytes are anchored — the base a byte-identity claim is measured against. Operator-computed via `git merge-base`, passed to the generator. |
| Provenance stamp | The `generated_from` field recording the merge-base sha inside a golden. |
| Ancestry check | The test-time assertion that a golden's `generated_from` is a real ancestor commit of HEAD. |

**The stamped golden shape.** After this change, `default-code-review-payload.json` is:

```
RECORD DefaultCodeReviewGolden:
  generated_from: String            # FIRST key; 40-char commit sha, or null when the sha arg is omitted
  system: String                    # unchanged — the shared context+diff wire block
  user: String                      # unchanged — the review lens wire block

  CONSTRAINT generated_from matches /^[0-9a-f]{7,40}$/  when non-null
  CONSTRAINT key order is (generated_from, system, user)   # mirrors the unified goldens' generated_from-first layout
```

`system` and `user` MUST remain byte-identical to the currently committed golden when regenerated at the same base — the only addition is the leading `generated_from` key.

**Generator surface.** `regenerate.mjs`'s usage line is unchanged (`usage: node regenerate.mjs <path-to-review-call.mjs> [<source-commit-sha>]`); the same optional `argv[3]` sha now also stamps the default golden. When a module path is supplied, the script writes four goldens instead of three; the fourth is captured via `captureDefaultCodeReviewPayload()` and written to `default-code-review-payload.json`.

**Design decisions** (each concluded with a canonical marker; full rationale in §6):

- Where the stamp is written → **Chosen:** fold generation of the stamped default golden into `regenerate.mjs`.
- Where ancestry is verified → **Chosen:** extend the existing FAFF-1051 provenance loop in `test/faff-1051-diff-kind.test.mjs` to cover the default golden.
- Whether the generator runs the git assertion → **Chosen:** no — `regenerate.mjs` stays git-free; the test suite owns the ancestry assertion.
- Correct merge-base supplied by operator → **Assumes:** the operator computes and passes the right merge-base sha.

## 4. HOW — Behavior

**Approach.** Two edits. First, `regenerate.mjs` gains a fourth output: after building its three synchronous unified goldens, it `await`s `captureDefaultCodeReviewPayload()`, wraps the result as `{ generated_from, system, user }` (sha first, `exit` dropped), and writes it to `default-code-review-payload.json` alongside the others. Second, the FAFF-1051 provenance loop adds `"default-code-review-payload.json"` to its golden-name array so the same shape-plus-ancestry assertion runs over it.

**Generator behaviour.**

```
PROCEDURE regenerate.main(argv):
  1. modulePath = argv[2]
  2. IF no modulePath:
     a. print usage line to stderr; return 0    # unchanged no-op — node --test spawn shape
  3. generatedFrom = argv[3] OR null
  4. mod = dynamic import of modulePath          # historical copy, for the three unified goldens
  5. build the three unified goldens from `mod` (unchanged), each stamped generated_from-first
  6. capture = await captureDefaultCodeReviewPayload()   # drives the LIVE review-call.mjs
  7. add golden "default-code-review-payload" = { generated_from, system: capture.system, user: capture.user }
  8. write every golden to <name>.json with a trailing newline
  9. return 0
```

Prefer a dynamic `await import("./default-code-review-fixture.mjs")` inside `main()` (only reached when `modulePath` is present), mirroring the existing dynamic import of the module path. This keeps the top-level of `regenerate.mjs` side-effect-free so its no-args no-op behaviour under `node --test` recursive discovery is preserved.

**Ancestry-check behaviour** (the existing two-tier loop, now iterating four names):

```
PROCEDURE provenance_check():
  FOR name IN [ three unified goldens..., "default-code-review-payload.json" ]:
    g = readGolden(name)
    1. ASSERT g.generated_from is a non-empty sha matching /^[0-9a-f]{7,40}$/   # always runs
    2. IF the commit object is NOT locally present (git cat-file -e):
         continue    # shallow clone in CI — cannot prove ancestry, shape check suffices
    3. ASSERT `git merge-base --is-ancestor g.generated_from HEAD` does not throw
```

The generalisation is safe because the ancestry property is identical for all four goldens: each `generated_from` is a merge-base commit that must be an ancestor of HEAD. Broaden the test's title/comment so it no longer reads as FAFF-1051-only (it now also covers the FAFF-1065 default golden).

**Edge cases.**
- **Sha omitted** (`argv[3]` absent) → `generated_from` is `null` for all four goldens, exactly as today. The committed golden must never carry `null`; a real sha is required at commit time. The shape assertion (`generated_from must be a non-empty sha`) fails loudly on a `null`-stamped committed golden, which is the intended tripwire.
- **Shallow CI clone** → the commit object is absent locally; tier-2 ancestry is skipped, tier-1 shape still runs. This is the existing, deliberate behaviour and must be preserved unchanged.
- **Byte-identity consumer test** reads only `.system`/`.user`; the extra leading key is ignored. No change to `test/faff-1058-controllable-trimming.test.mjs` is required, and none should be made beyond (optionally) a clarifying comment.

**Anti-pattern:** regenerating the default golden *after* editing `review-call.mjs`. Why: `captureDefaultCodeReviewPayload()` imports the **live** module, so a post-edit capture reflects the edited code while `generated_from` names the pre-edit base — a stamp the ancestry check cannot catch (the sha is still an ancestor). Regenerate before editing, exactly as the existing `regenerate.mjs` header already instructs.

**Anti-pattern:** adding a second ancestry helper or a new test file. Why: the existing loop is generic; duplicating the `hasLocalObject` shallow-clone guard invites the two copies to drift.

**Failure modes.**

- **The failure:** the ancestry anchor proves the *claimed* base is an ancestor, not that the committed bytes were produced at it. A truthful-looking stamp whose bytes came from a different (still-ancestor) commit passes. **How you'd know:** the byte-identity test would only catch it if the drift changed the wire strings; a same-bytes-different-base regeneration is invisible. **What it means:** accept — this is the identical guarantee the FAFF-1051 goldens ship with, and closing it is explicitly out of scope. The parity bar is met.
- **The failure:** folding the live-capture into `regenerate.mjs` couples the default golden's regeneration to whatever `review-call.mjs` currently is, unlike the three unified goldens which read a historical copy from `argv[2]`. **How you'd know:** a default golden whose `system`/`user` diverge from the base while the three unified goldens match. **What it means:** proceed — the documented workflow ("run once before editing") makes the live module equal the merge-base module at regeneration time, so the asymmetry is inert under correct use, and the anti-pattern above names the misuse.

## 5. Scenarios

```
Given regenerate.mjs is run before editing review-call.mjs, with the merge-base sha as argv[3]
When it writes default-code-review-payload.json
Then the file's first key is generated_from set to that 40-char sha,
  and its system and user strings are byte-identical to the previously committed golden
```

```
Given the committed default-code-review-payload.json whose generated_from names a commit
  that is present locally but is NOT an ancestor of HEAD
When the provenance test runs
Then it fails loudly on the ancestry assertion for that golden
```

```
Given the committed default-code-review-payload.json carries a valid ancestor generated_from sha
When the FAFF-1058 byte-identity test runs
Then it still passes, reading only system and user and ignoring the extra key
```

## 6. Design Decision Rationale

**Where does the default golden's provenance stamp get written?**
- Option A — fold into `regenerate.mjs`. Pros: it already owns the `generated_from` field name and the `argv[3]` operator-supplied-sha convention; it is the single golden-writer for this directory; `captureDefaultCodeReviewPayload()` is already exported and importable; one regeneration entrypoint and one sha argument cover all four goldens. Cons: mixes a live-module capture with the three historical-module captures (mitigated: at regeneration time, before editing, the live module equals the base).
- Option B — a separate writer in `default-code-review-fixture.mjs` or a new tiny script. Pros: keeps live-capture and historical-capture separate. Cons: a second sha-supply path and a second regeneration command to remember; duplicates the field-name convention; contradicts the "one mechanism" principle.
- Option C — keep hand-committing and add the field by hand. Cons: no reproducible generator; the field can be typo'd or forgotten with nothing to regenerate against.

  **Chosen:** Option A — fold into `regenerate.mjs`. It reuses the exact FAFF-1051 mechanism the ticket asks us to mirror, keeps one regeneration workflow, and the live/historical asymmetry is neutralised by the existing "regenerate before editing" discipline.

**Where does the default golden's ancestry get verified?**
- Option A — extend the existing FAFF-1051 provenance loop's golden-name array by one entry. Pros: the loop is already generic (shape assertion + shallow-clone-guarded ancestry); one-line addition; identical CI behaviour including the shallow-clone guard; no duplicated logic. Cons: the test's FAFF-1051 title/comment must be broadened.
- Option B — a dedicated new test (same file or new file) for the default golden. Cons: duplicates the `hasLocalObject` shallow-clone guard, which can drift from the original.
- Option C — a `regenerate.mjs` assertion. Cons: violates the git-free principle; `regenerate.mjs` cannot run `git merge-base`.

  **Chosen:** Option A — extend the existing provenance loop, broadening its title to cover the FAFF-1065 default golden. Least duplication, identical semantics, one place owns the shallow-clone guard.

**Does `regenerate.mjs` run the git ancestry assertion itself?**
- Considered: yes (self-checking generator) vs no (test owns it). A self-checking generator would need `git` calls, contradicting the deterministic, dependency-free header contract, and would not run in CI anyway (the golden is committed, not regenerated in CI).

  **Chosen:** no — `regenerate.mjs` stays git-free; the extended provenance test is the loud CI guard. This satisfies the ticket's "CI ancestry check (or a regenerate.mjs assertion)" as the ancestry-check branch.

## 7. Open Questions and Assumptions

**Open Questions.** None — the ticket's open question (fold into `regenerate.mjs` vs a dedicated check) is resolved above under the appetite directive: fold the write into `regenerate.mjs`, verify by extending the existing provenance loop.

**Assumptions.**

- **Assumes:** the operator computes and passes the correct merge-base sha as `argv[3]` (the same convention the three FAFF-1051 unified goldens already rely on; `regenerate.mjs` never computes it). *Validation before build:* confirm `regenerate.mjs`'s usage line already documents `[<source-commit-sha>]` and that the three committed unified goldens carry real ancestor shas in `generated_from` — both are present in the repository today, so the convention is live and this change only extends it.

## 8. DONE — Definition of Done

### From WHY
- [ ] `default-code-review-payload.json` records a merge-base sha as a first-key `generated_from` field, mirroring the FAFF-1051 unified goldens.
- [ ] A CI-run check fails loudly if the golden's `generated_from` is not an ancestor of HEAD, so "identical to today" cannot silently drift.

### From WHAT (types and interfaces)
- [ ] The committed `default-code-review-payload.json` has exactly the keys `generated_from`, `system`, `user` in that order.
- [ ] `generated_from` in the committed golden is a non-null sha matching `/^[0-9a-f]{7,40}$/`.
- [ ] `system` and `user` are byte-identical to the pre-change committed golden (regenerated at the same base).
- [ ] `regenerate.mjs`'s usage line is unchanged and still documents the optional source-commit-sha argument.

### From HOW (behaviour)
- [ ] Run with a module path and a sha, `regenerate.mjs` writes four goldens, the fourth being `default-code-review-payload.json` stamped `generated_from`-first from `captureDefaultCodeReviewPayload()`, with the capture's `exit` field dropped.
- [ ] `regenerate.mjs` adds no `git` invocation and remains deterministic/dependency-free.
- [ ] Run with no arguments, `regenerate.mjs` still prints the usage line and exits 0 (the `node --test` no-op is preserved).
- [ ] The FAFF-1051 provenance test iterates the default golden alongside the three unified goldens, with its title/comment broadened beyond FAFF-1051.

### From HOW (edge cases)
- [ ] Tier-1 shape assertion runs for the default golden in a shallow clone; tier-2 ancestry runs only when the commit object is locally present.
- [ ] The FAFF-1058 byte-identity test passes unchanged, reading only `system`/`user` and ignoring the new `generated_from` key.

**Integration smoke test.**

```
1. run: node test/fixtures/trim-baseline/regenerate.mjs <path-to-current review-call.mjs> <HEAD-or-merge-base sha>
2. assert: default-code-review-payload.json now begins with "generated_from": "<that sha>"
   and its system/user are unchanged from the prior commit (git diff shows only the added key)
3. run: node --test test/faff-1051-diff-kind.test.mjs test/faff-1058-controllable-trimming.test.mjs
4. assert: the broadened provenance test passes (ancestry holds for all four goldens)
   and the byte-identity test passes
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
