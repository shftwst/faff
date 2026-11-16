# Review-comment extraction results

Release 0.45.0 at `690546db` satisfies the recorded release boundary. The
production implementation begins at `7501952c`; `2c3baeff` switches caller prose;
`3f1fad3d` fixes the independent review findings. Commits are unsigned as requested
and retain the operator DCO sign-off. Draft PR: https://github.com/shftwst/faff/pull/1197.

| Check | Evidence |
|---|---|
| Planner, harness and TypeScript boundary tests | 260 passed, none skipped, with the locked compiler installed locally |
| Node 20 adopter runtime | 78 planner tests passed |
| Full local suite at the final code revision | 8,623 passed, zero failed, six skipped; process-only Git signing override used for fixture commits |
| Actual restricted command adapter | Eleven independent oracle cases passed; inputs, output bytes, digests, exit and timing retained in `production-command-calls.json` |
| Deliberate code mutations | Seven caught by assertions; `check-planner-mutants.mjs` reproduces `planner-mutants.json` |
| Integration checks | Build, region direction, CLI coverage/docs, ADR and skill/reference checks passed; rule inventory covers all 12 deleted blocks |
| Independent Claude verification | Initial review reproduced 243 tests and found recovery/timestamp cases. Final integration review reproduced 254 passes plus six missing-compiler skips, then all eleven followed adapter traces matched the expected event projections |

Claude's unseen cases exposed ambiguous open-only recovery that could discard
human text. Five regression probes failed before the fix. The command now
refuses the selected ambiguous target and preserves all comments; a safe complete
duplicate can still be selected. It accepts compact timezone offsets and compares
fractional seconds exactly, rather than rejecting common spellings or rounding.
The seven recorded operator decisions and historical observations are unchanged.

The caller review led to explicit blocked-operation reporting, file-tool JSON
transport through stdin, and removal of an unnecessary pre-write reread suggestion.
Review verdicts, per-round logging, one-comment density, remote-write uncertainty
and the existing concurrency contract remain caller responsibilities.

`source-size.json` records the final loaded checkpoint: 4,337 to 1,862 bytes,
57.1% smaller. Graft removes another 605 bytes; total covered prose reduction is
3,080 bytes. This is one checkpoint, not a whole-workflow reduction.

No fresh model batch has run. The worker's zero-cost preparation bound 22
executions, the released baseline, production candidate and actual CLI 2.1.325;
preflight stopped solely because neither declared credential variable was present
in its command shell. The Codex shell also lacks the Claude executable. No secret
was read or copied. Preparation and capture must be rerun in an authenticated
launcher against the final candidate before the $10, 22-attempt, no-retry batch.
Model cost, cache behaviour, latency and model-level conformance remain unmeasured.
The controlled MCP path does not measure shell command construction.

Implementation rulings and limits:

- Reject duplicate IDs, malformed JSON/Unicode, active replacement markers and
  unclosed replacement fences. Unsupported input needs correction before posting.
- Refuse ambiguous open-only recovery. Damaged legacy comments may need manual
  marker/fence repair; no human text is discarded to complete an update.
- Accept compact offsets and arbitrary decimal precision while retaining strict
  calendar/time validation and exact ordering.
- Keep stdin synchronous. A non-blocking stdin can fail closed with `EAGAIN`;
  file redirection and the adapter pipe are exercised. Async stdin is deferred.

The original four historical differences remain narrow declarations. New
unexpected differences, missing usage or runtime drift cannot be waived. The
full paired comparison is still required before this draft can be considered
ready to land. Pending prerequisite PRs #1187 and #1194 remain separate.
