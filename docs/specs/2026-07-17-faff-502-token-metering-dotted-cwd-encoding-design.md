# FAFF-502 — Fix `transcriptBaseDir` cwd encoding so token metering stops falsely degrading to estimate on dotted worktree paths

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: high. Full spec on Linear FAFF-502.

## WHY

`faff budget check` and `faff economics` silently report `tokens_source: "estimate"` with 0 metered tokens for every session launched from a worktree under the default `worktree_root` (`~/.faff/worktrees/*`). Because a `tokens`/`cost` budget ceiling is compared against that estimate — `attempts × est_tokens_per_attempt`, which is 0 at zero attempts — **no token or cost ceiling can ever bind on a default-layout worktree run**. This is a metering-integrity defect: the guard rail that is supposed to stop a runaway spend is inert on exactly the run shape (`/faff-graft` / `/faff-beep-boop` worktrees) where unattended spend happens. It went unnoticed because a main-checkout path (`/Users/.../workspace/...`, no dot) encodes correctly, so only dotted worktree cwds are affected.

The degrade itself is by-design (FAFF-428 made "transcripts unavailable → estimate fallback" a deliberate, loud-surfaced behaviour). The bug is a **false trigger** of that fallback: the transcript directory is present on disk but the resolver computes the wrong path and concludes it is missing.

## WHAT

One defect, in one function, feeding one shared resolver.

`transcriptBaseDir(cwd, env)` (`plugin/skills/faff/bin/lib/budget.js:317-322`) maps a cwd to its `~/.claude/projects/<encoded>` directory. Its encoder is slash-only:

```js
const encoded = String(cwd).replace(/\//g, "-");
```

Claude Code's real projects-dir encoder also maps `.` → `-`. For a dotted worktree cwd (`/Users/shftwst/.faff/worktrees/faff/faff-NNN-...`) the function computes `-Users-shftwst-.faff-worktrees-...`, but the on-disk directory is `-Users-shftwst--faff-worktrees-...` (the `.faff` segment becomes `--faff`). `existsSync(base)` fails → `sessionOwnedTranscriptFiles(base, …)` returns null → `measureTokens` / `measureTokensByClass` / `measureTokensByModelClass` all take the estimate fallback. Every metering consumer shares this one resolver (`budget.js:449-450` and `:474-475`), so budget check, economics, and the `--by class|model|mcp` breakdowns all degrade together.

**Grounding evidence (captured this run):** the live `~/.claude/projects/` corpus on this machine contains directories such as `-Users-shftwst--faff-worktrees-faff-faff-16-...` (dotted worktree path → `--faff`) alongside `-Users-shftwst-workspace-shftwst-faff` (main checkout, no dot). Every directory name in the corpus is drawn from `[a-zA-Z0-9-]` only — existing hyphens are preserved verbatim (branch slugs like `faff-16-...` keep their hyphens), and the sole transformation observed is `/` → `-` and `.` → `-`.

**Scope decisions:**

- **The encoder fix.** **Chosen:** replace both `/` and `.` with `-` in one pass — `String(cwd).replace(/[/.]/g, "-")` — and update the function's leading comment (currently `'/' → '-'`) to state the pinned convention. This is the minimal transformation that matches every real on-disk directory in the captured corpus and fixes the reported bug. It preserves existing hyphens and every alphanumeric, so a main-checkout path is byte-identical to today's output. Rationale for *not* going broader (e.g. `/[^a-zA-Z0-9]/g`): a blanket non-alphanumeric replace would also rewrite characters the corpus shows Claude Code preserves (hyphens are kept), risking a *new* mismatch; pinning exactly the two transformations the real dirs exhibit is both sufficient for the bug and lower-risk.

- **Character class beyond `/` and `.`.** **Assumes:** the faff-produced worktree cwds this bug concerns contain only `/`, `.`, hyphens, and alphanumerics — the default `worktree_root` is `~/.faff/worktrees/<repo>/<branch-slug>`, where the home dir, repo name, and branch slug introduce no underscores, spaces, or other punctuation. The captured-real-dir fixture (below) validates the encoder against an actual `~/.claude/projects` name and will fail loudly if Claude Code's convention for these path shapes is ever broader than the two mapped classes. Extending the encoder to `_`/space/other punctuation is explicitly **out of scope** — no such path arises from faff's own worktree layout, and there is no real on-disk sample in the corpus to pin against, so guessing a mapping would be unfounded.

- **`$CLAUDE_CONFIG_DIR` override.** **Chosen:** leave the `configDir` resolution (`budget.js:319`, honouring `$CLAUDE_CONFIG_DIR`) untouched. Encoding operates on `cwd` (the `projects/<encoded>` leaf); the config-dir override changes only the parent (`<configDir>/projects/`). The two are orthogonal, so the override needs no encoder-specific fixture case — the existing behaviour is unchanged and the encoding tests exercise the leaf independently of the parent.

- **Fallback design.** **Chosen:** do not touch the estimate fallback itself. It behaved as designed (FAFF-428); this change removes only the false trigger, so a genuinely-absent transcript still degrades exactly as before.

## HOW

1. **Encoder one-liner** — in `transcriptBaseDir` (`plugin/skills/faff/bin/lib/budget.js:317-322`), change `String(cwd).replace(/\//g, "-")` to `String(cwd).replace(/[/.]/g, "-")`, and update the function's leading comment to name the pinned convention (`'/' and '.' → '-'`).

2. **Dotted-cwd regression fixture** — in `budgetSelftest()` (`budget.js:785+`, the inline `ok(name, cond)` selftest table run via `faff budget --selftest`), add an assertion that `transcriptBaseDir` on a dotted worktree cwd resolves to the double-dash form. Concretely, with a fixed `env` (`{ HOME: "/Users/x" }`) assert `transcriptBaseDir("/Users/x/.faff/worktrees/repo/branch", env)` ends in `projects/-Users-x--faff-worktrees-repo-branch` (the `.faff` → `--faff` collapse the bug got wrong), and a companion assertion that a no-dot main-checkout cwd (`/Users/x/workspace/repo`) still encodes to `-Users-x-workspace-repo` (main-checkout behaviour unchanged).

3. **Captured-real-dir pin fixture** — add an assertion that pins the encoder against a **real** captured `~/.claude/projects` directory name, documenting the character class it pins. Embed a real corpus sample as a literal (source cwd → captured on-disk dir name, e.g. `/Users/shftwst/.faff/worktrees/faff/faff-16-architecture-decision-records-adrs-durable-cross-slice` → `-Users-shftwst--faff-worktrees-faff-faff-16-architecture-decision-records-adrs-durable-cross-slice`) and assert `transcriptBaseDir(sourceCwd, env)` reproduces it. A short comment records that the pinned classes are exactly `/` and `.` → `-`, hyphens/alphanumerics preserved, per the captured evidence — so a future Claude Code convention change is caught by a failing pin rather than a silent re-degrade.

## DONE

- A run launched from a dotted worktree cwd (under the default `~/.faff/worktrees/*`) resolves its real transcript files: `faff budget check --json --run-dir <run-dir>` reports `tokens_source: "transcript"` with non-zero metered tokens (not `"estimate"`) when `CLAUDE_CODE_SESSION_ID` is set and the transcript exists on disk.
- `faff budget --selftest` passes, including the new dotted-cwd regression assertion and the captured-real-dir pin assertion.
- Main-checkout (no-dot) cwd encoding is byte-identical to before — the no-dot selftest assertion passes and existing budget selftests are unchanged.
- The shared resolver fix flows through to `faff economics` and its `--by` breakdowns (same `transcriptBaseDir` call path) — no separate change needed.

## Open questions / Assumptions

- **Assumes:** Claude Code's projects-dir encoder maps exactly `/` and `.` → `-` for the path shapes faff produces (home + `~/.faff/worktrees/<repo>/<branch-slug>`), preserving hyphens and alphanumerics — validated by the captured-real-dir pin fixture. Broader punctuation (`_`, spaces) does not arise from faff's worktree layout and is out of scope.

confidence: high
spec-review: approve
