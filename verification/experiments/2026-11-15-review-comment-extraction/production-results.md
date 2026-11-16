# Review-comment extraction results

Release 0.45.0 at `690546db` satisfies the recorded release boundary. The
production implementation begins at `7501952c`; `2c3baeff` switches caller prose;
`3f1fad3d` fixes the independent review findings. Commits are unsigned as requested
and retain the operator DCO sign-off. Draft PR: https://github.com/shftwst/faff/pull/1197.

| Check | Evidence |
|---|---|
| Planner, harness and TypeScript boundary tests | 260 passed, none skipped, with the locked compiler installed locally |
| Node 20 adopter runtime | 78 planner tests passed |
| Initial CI at `3f1fad3d` | All checks passed; Node 24 source suite: 8,851 passed, zero failed, 14 skipped |
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

The fresh 22-execution comparison completed at candidate `8ba8bd0c`. It failed:
candidate 10/11, baseline 5/11, with one candidate failure and three unexpected
baseline differences. The planner returned the correct CRLF body, but Claude
wrote its escaped JSON representation. The caller now explicitly requires the
decoded body; a separately authorised one-case diagnostic at `d0efdd4e` still
failed with the same escaping error. The checkpoint remains
1,862 bytes. Full evidence is in
`../2026-11-16-review-comment-pairs/RESULTS.md` and its accompanying raw traces.

Recorded-rate usage totalled $0.9902546. Candidate cost was 0.95% higher and summed
attempt time 15.08% higher in this development run, including failures. No model
cost or latency saving was observed. Authentication worked when launched through
host `docker exec`, which inherited the existing container OAuth environment;
Claude's Bash tool deliberately removes that variable from its child commands.
The controlled MCP path does not measure shell command construction. A separate
directed Claude Code exercise followed the file-tool/redirection instructions:
exact planned bytes matched, zero of five sentinels were created, and ambiguous
input returned no plan. An intentionally unsafe positive control created its
sentinel, confirming the payload was executable. This was not a fresh blinded
model trial. See `claude-shell-transport-exercise.md`.

Implementation rulings and limits:

- Reject duplicate IDs, malformed JSON/Unicode, active replacement markers and
  unclosed replacement fences. Unsupported input needs correction before posting.
- Refuse ambiguous open-only recovery. Damaged legacy comments may need manual
  marker/fence repair; no human text is discarded to complete an update.
- Accept compact offsets and arbitrary decimal precision while retaining strict
  calendar/time validation and exact ordering.
- Keep stdin synchronous. A non-blocking stdin can fail closed with `EAGAIN`;
  file redirection and the adapter pipe are exercised. Async stdin is deferred.

The original four historical differences remain narrow declarations. The three
new baseline differences require review; none was waived. The revised caller
failed its focused diagnostic and is not ready to land. The diagnostic used
$0.0651418 across six requests, with no retry. Its raw provider response confirms
the model authored the incorrect write; Claude Code passed it through unchanged.
Evidence and a proposed deterministic connector handoff are in
`../2026-11-16-review-comment-crlf-recheck/`. No further model run is authorised.
Pending prerequisite PRs #1187 and #1194 remain separate.
