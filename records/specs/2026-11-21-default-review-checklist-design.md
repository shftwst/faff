# Condense the default review checklist

Recover the introduction, caller inputs and first four review passes from the earlier draft. Preserve the current output template, human-judgement pass, verdict precedence, structured findings and appetite policy. Keeping the artifact rules intact isolates this cut from the earlier finding-title discrepancy.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `The default code review. Faff-graft plays the senior-engineer role — reads the` | changed: The introduction retains the implicit default, five passes, caller and fixed verdict contract. |
| `This is the implicit default when no review slot is configured. Extracted here so` | changed: The introduction retains the implicit default, five passes, caller and fixed verdict contract. |
| `yaml slots: review: faffter-noon-review # the default — explicit for clarity` | changed: The introduction retains the implicit default, five passes, caller and fixed verdict contract. |
| `The verdict vocabulary and its semantics (faff contract review-verdict` | changed: The introduction retains the implicit default, five passes, caller and fixed verdict contract. |
| `## Why pre-PR` | changed: The introduction assigns Step 9b, tracker publication, parking and iteration to the caller. |
| `In human-in-the-loop development, review happens either implicitly during pair` | changed: The introduction assigns Step 9b, tracker publication, parking and iteration to the caller. |
| `Review findings that would have surfaced as PR comments are reported to the` | changed: The introduction assigns Step 9b, tracker publication, parking and iteration to the caller. |
| `## When it runs` | changed: The introduction assigns Step 9b, tracker publication, parking and iteration to the caller. |
| `Invoked by faff-graft Step 9 after the build is complete and local tests pass,` | changed: The introduction assigns Step 9b, tracker publication, parking and iteration to the caller. |
| `Faff-graft provides:` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `- The full diff: git diff main...HEAD` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `- The spec (committed to docs/specs/ on the feature branch)` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `- The test results (pass/fail, coverage if available)` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `- The AC checklist from Step 8 (which ACs were auto-verified, which need human)` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `- From the second review pass on, the prior findings: the previous round's` | changed: Input preserves the exact diff command, spec source, tests and prior handles as untrusted data. |
| `Every acceptance criterion in the spec must have a corresponding test reference` | changed: Pass 1 requires coverage or observable evidence, a Step 8 human flag for untestable ACs and failure for missing testable coverage. |
| `- Does a test file exercise this AC? (grep for AC keywords, assert the behaviour` | changed: Pass 1 requires coverage or observable evidence, a Step 8 human flag for untestable ACs and failure for missing testable coverage. |
| `- If not testable (visual, UX, subjective) — is it marked as needing human` | changed: Pass 1 requires coverage or observable evidence, a Step 8 human flag for untestable ACs and failure for missing testable coverage. |
| `- Missing coverage for a testable AC → finding (fail)` | changed: Pass 1 requires coverage or observable evidence, a Step 8 human flag for untestable ACs and failure for missing testable coverage. |
| `Scan the diff for common defects:` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Unused variables or imports introduced by this diff` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Commented-out code blocks (leftover debugging)` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Uncaught promises / unhandled async errors` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Mismatched async/sync patterns (awaiting non-async, fire-and-forget on` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Leftover debug prints (console.log, print(), debugger statements)` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Obvious null/undefined access without guards (where the spec doesn't say` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `- Resource opens without corresponding closes on error paths` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `Planted defects in fixture content are test data, not bugs: apply gateway →` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `Any finding here → fail (fixable, iterate)` | changed: Pass 2 lists introduced defects, the fixture exception, and the fixable verdict. |
| `The diff must be within the spec's scope:` | changed: Pass 3 retains allowed plumbing, out-of-scope reverts and the original appetite exception. |
| `- Changes only touch files/modules the spec addresses or that are necessary` | changed: Pass 3 retains allowed plumbing, out-of-scope reverts and the original appetite exception. |
| `- No out-of-scope refactors smuggled in (renaming unrelated code, adding` | changed: Pass 3 retains allowed plumbing, out-of-scope reverts and the original appetite exception. |
| `- No dependency additions not mentioned in the spec` | changed: Pass 3 retains allowed plumbing, out-of-scope reverts and the original appetite exception. |
| `- Scope violations → fail with recommendation to revert the out-of-scope changes` | changed: Pass 3 retains allowed plumbing, out-of-scope reverts and the original appetite exception. |
| `The implementation matches the spec's intent, not just its letter:` | changed: Pass 4 retains the selected design, pseudocode, error paths and justified spec correction. |
| `- If the spec says Chosen: X, the code implements X (not Y with a comment saying` | changed: Pass 4 retains the selected design, pseudocode, error paths and justified spec correction. |
| `- If the spec has pseudocode, the implementation follows the same logic (not a` | changed: Pass 4 retains the selected design, pseudocode, error paths and justified spec correction. |
| `- If the spec names error handling behaviour, those error paths exist` | changed: Pass 4 retains the selected design, pseudocode, error paths and justified spec correction. |
| `- Spec divergence → fail (either fix the code or update the spec if the` | changed: Pass 4 retains the selected design, pseudocode, error paths and justified spec correction. |
