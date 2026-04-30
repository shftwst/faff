---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-wtf to figure out what to focus on, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-workit to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

The stuff you do before actual work — but automated. This is a gateway — invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-workit ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |
| `/faff-beep-boop` | "Run overnight", "fire and forget", "chew through the backlog", "unattended" |

## Configuration (shared across all sub-skills)

All faff sub-skills read project-specific details from `CLAUDE.md`. They expect a **Project Tracking** section with at minimum:

- Issue tracker details (project ID, team key, etc.)
- Git host details (org, repo)

Optional but useful:
- Labels and their meanings
- Working pattern notes

**Never put mutable state in a consuming repo's `CLAUDE.md`.** That means no milestone lists, no target dates, no progress percentages, no issue snapshots, no "current cycle" notes — anything that can change in the tracker must be fetched live by the skill on every invocation. `CLAUDE.md` holds only stable identifiers (project IDs, team keys, repo slugs, label names) and stable preferences. If a sub-skill needs mutable data, the skill instructions must say "refetch from the tracker" and name the MCP tool to call.

Faff auto-detects which issue tracker and git host MCP servers are available and adapts accordingly. It works with Linear, GitHub Issues, Jira, or any issue tracker exposed via MCP. If no tracker MCP is available, it falls back to git-only mode (commits, branches, PRs).

### Planning Skills (optional delegation slots)

Faff delegates specialised work to configured skills. Slots live in a `Planning Skills` section of `CLAUDE.md`. All slots are optional — each has a sensible faff default when unset.

```markdown
## Planning Skills
- spec: superpowers:brainstorming                      # used by faff-prep
- plan: superpowers:writing-plans                      # used inside faff-workit, optional
- parallel: superpowers:dispatching-parallel-agents    # used by faff-beep-boop for concurrency, optional
- review: gstack:review                                # pre-PR review inside faff-workit, optional
- ship: gstack:land-and-deploy                         # merge/deploy mechanism inside faff-workit, optional
```

Defaults when a slot is unset:

| Slot | Default |
|---|---|
| `spec` | Inline spec produced by faff-prep. In autonomous mode, the inline path parks instead (no self-rating available — see autonomous contract). |
| `plan` | faff-workit builds directly from the spec without a formal plan step. |
| `parallel` | faff-beep-boop runs sequentially. |
| `review` | faff built-in review: faff-workit plays the senior-engineer role — diff read, AC-to-test coverage, obvious-bug scan, scope check, human-judgement flagging. Emits `pass` / `fail` / `needs-human`. |
| `ship` | Vanilla `gh pr merge` after faff's merge-confidence gate passes. |

`review` and `ship` are **not** user-invokable slash commands. They are internal phases of faff-workit, with optional delegation via these slots.

## Shared Rules

These rules apply to every faff sub-skill. Sub-skills point at this section rather than re-stating.

### Ignore cancelled and archived

Every faff sub-skill excludes the following from every query, recommendation, count, and output:

- Cancelled issues
- Archived issues
- Issues whose parent project is cancelled or archived
- Cancelled or archived projects themselves

No exceptions. Cancelled/archived items are invisible to faff — they are never surfaced in catch-ups, never flagged in tidy, never picked up by workit, never counted in beep-boop queues.

### Spec discovery (where to look for an existing spec)

Any faff sub-skill that asks "does this issue have a spec?" must check **all three** of the following, in order, and treat a hit in any of them as the spec:

1. **Issue tracker comments** — **the default and most common location**. faff-prep writes the spec as a comment on the issue during Phase 1 (pre-build). **Most specs live here**, not in the description.
2. **Issue tracker main description / body** — users sometimes paste or author the spec directly in the ticket body instead of a comment.
3. **Committed docs** in the repo — e.g. `docs/superpowers/specs/YYYY-MM-DD-<issue-id>-*.md`. This is where faff-workit commits the spec on build, and where it lives post-merge. If a feature branch already has a spec committed under this path (matching the issue id), treat that as the spec even if no tracker comment exists.

**Comments are not optional.** Because faff-prep writes specs to comments by default, any spec-discovery pass that only inspects descriptions is **invalid output** — it will systematically miss the most common case and produce false "no spec" findings. Before classifying any issue as "no spec / almost ready / needs prep", you **must** fetch its comments via whichever tracker MCP is configured (use the tracker's list-comments tool — autodetect from the available MCP, don't hardcode). Sampling descriptions and noting "comments not checked" is **not** acceptable — re-fetch and complete the check before reporting.

Never assume "no spec attached" without checking all three. Finding a spec in any location is a positive. When multiple sources exist, prefer the most recently modified one and note the discrepancy in the log.

### `.faff/` logging directory

Every faff skill invocation writes a structured markdown log to the repo-local `.faff/` directory. Layout:

```
.faff/
  logs/
    YYYY-MM-DD/
      HHMMSS-<skill>[-<context>].md     # one file per skill invocation
  runs/
    YYYY-MM-DD-beep-boop-HH-MM-SS/      # grouped per beep-boop run
      summary.md
      ISSUE-XX/
        prep.md
        workit.md
        ac-verification.md
      ...
```

Each log entry captures:

- Invocation context (args, mode — interactive or autonomous, working directory)
- MCP calls made (tool name, relevant inputs, key outputs)
- Decisions with reasoning (what was expected, what was observed, what decision was taken, why)
- Commit SHAs, PR URLs, branch names
- Errors, parks, and their causes

Logs are plain markdown — agent-readable and human-readable. A log must contain enough context that a follow-up agent, given only the log file, can pick up intelligently without needing the original conversation.

**Gitignore:** `.faff/` is added to `.gitignore` on first write if not already present. Users may un-ignore to commit logs if they want.

### Bash command hygiene (universal)

These rules apply to **every** faff invocation — interactive and autonomous alike. The premise is simple: if a simpler, atomic command does the same job without tripping an approval prompt, that is the default behaviour. Don't write a command that requires the human to authorise it when an equivalent one wouldn't. Approval prompts in interactive mode aren't "free" — they break the human's flow, force them to context-switch, and accumulate as friction across a session. In autonomous mode the same prompt halts the whole run. Either way, the fix is the same: write commands that don't need approval.

Before invoking `Bash`, mechanically check the command against the list below. If it contains ANY banned construct, rewrite it as separate atomic calls — don't try to disguise the construct or argue why yours is different.

**Rule 0 (check this first, every time): never invoke `grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo >` via `Bash`.** Use the dedicated tools — `Grep`, `Glob`, `Read`, `Edit`, `Write`. They never trip approval heuristics. This applies regardless of how innocent the path looks. The single biggest source of repeated halts is reaching for shell `grep` (often with `-B`/`-A` context flags, which `Grep` also supports) on paths containing `$`, spaces, or glob metacharacters. The fix is never to escape harder; it is always to use the `Grep` tool. Same logic for `find` → `Glob`, `cat`/`head`/`tail` → `Read`. If you're about to type any of those binaries into a `Bash` call, stop and switch tools.

**Rule 0.5: never invoke `cd` via `Bash`.** Shell state doesn't persist (see below), so `cd` alone is useless. `cd <dir> && <cmd>` is *worse* — the sandbox flags any `cd` chained with `git` (or anything else) as a "bare-repository-attack" pattern and prompts for approval. There is no legitimate single-call use of `cd` here. Use `git -C <dir> ...` for git, `--cwd <dir>` / `-C <dir>` flags for tools that support them, or pass absolute paths. If a tool genuinely requires the working directory to be set and offers no flag, write a script to `$TMPDIR/<name>.sh` that does the `cd` internally and run that file. **Exact prompts to recognise** (any `cd <dir> && <cmd>` pattern triggers one of these):
- "Compound commands with cd and git require approval to prevent bare repository attacks."
- "Compound command contains cd with write operation - manual approval required to prevent path resolution bypass."

If you've ever seen either, you've already broken Rule 0.5.

**Rule 0.6: never shell-parse a file.** Reading or transforming a file's contents — including tool-results cache files, MCP response caches, JSON of any size, log dumps, anything in `~/.claude/projects/.../tool-results/` — is **always** done with the `Read` tool (with `offset`/`limit` if the file is large) or `Grep` for content search. Never reach for `awk`, `sed`, `tr`, `jq`, `cut`, `sort | uniq`, or any pipeline that ingests a file path. The cost of running an MCP query a second time is lower than the cost of an approval prompt; if the data was already fetched, `Read` the cache file directly. **The "file is too big to Read" intuition is wrong** — `Read` supports `offset` and `limit` and works on any file. **Exact prompts to recognise:**
- "Contains simple_expansion" (sandbox flag for any `$VAR` expansion in arguments — typical when piping shell-processed output through `$TMPDIR`)
- Any prompt mentioning shell expansion, pipeline complexity, or text-processing utilities

If your reflex is "I'll just `awk` this real quick," stop. There is no real quick. Use `Read`.

**Mental model:** shell state does **not** persist between `Bash` tool invocations. Each call is a fresh shell. Variable assignments, `cd`, `export`, `set -e`, shell functions — none of it survives. If you catch yourself writing `FOO=...; do_something_with_$FOO`, you've already lost: the assignment is useless because the next `Bash` call won't see `$FOO` anyway. Compute values on **this** turn (via a separate `Bash` call or by calling `date`/`uuidgen`/etc. once and reading the output), then pass literal values into the next call. Do **not** try to persist state via `/tmp/` or `$TMPDIR` files as a substitute for shell-level state — that's the wrapper anti-pattern, and it hits the same sandbox prompts.

**Banned constructs (reject on sight, rewrite as atomic calls):**

| Pattern | Example that trips | Fix |
|---|---|---|
| Command substitution | `RUN_ID="$(date ...)"`, `` `cmd` `` | Call `date` in a separate `Bash` call, read its output, pass the literal string into the next call |
| Arithmetic expansion | `$(( x + 1 ))` | Compute in the host language (JS/TS/Python is what you're likely editing anyway) or hardcode |
| Process substitution | `<(cmd)`, `>(cmd)` | Capture output to `$TMPDIR/…` in one call, read it in the next |
| `;`-chains, `&&`-chains, or `\|`-pipelines (>1 command) | `a ; b`, `a && b && c`, `a \| b`, `cmd \| tee file` | One `Bash` call per command. For pipelines reading a file, use `Read`/`Grep` instead — never `awk file \| tr`, `cat file \| jq`, `sort file \| uniq`, etc. (see Rule 0.6) |
| Variable assignment + use in same call | `X=foo; echo $X`, `FOO=bar cmd` (where you then reference `$FOO` later) | Pass literal value; shell state doesn't persist anyway |
| Heredoc into interpreter | `python3 <<EOF`, `bash <<EOF` | `Write` a file to `$TMPDIR/<name>.<ext>`, run the file |
| `-c` / `-e` with multi-line body | `python3 -c "..."`, `node -e "..."` | Same — `Write` a file, run the file |
| Writes to `/tmp/` directly | `> /tmp/foo`, `--output /tmp/bar` | Use `"$TMPDIR/foo"` — the sandbox only allows `$TMPDIR`, `/tmp/claude`, `/private/tmp/claude` |
| `#` after a newline inside a quoted arg | Multi-line quoted string with a `#` comment | Don't use multi-line quoted strings for commands; use a file |
| Any command >~3 lines or needing a comment to explain | Anything that doesn't fit "run binary X with literal args Y" | Decompose into separate calls or `Write` a script |
| Paths containing `$` (Remix/React Router route files, etc.) | `grep -n "x" app/routes/app.\$id_.spec.ts` | Use the `Grep` tool — `$` in a path trips shell-expansion heuristics even when escaped |

**Rule of thumb:** a good `Bash` call runs one binary with fully-literal arguments — and that binary is **not** one of the search/read/edit binaries listed in Rule 0. If you're reaching for shell features (substitution, expansion, chaining, redirection to anywhere but `$TMPDIR`/project, flow control), you're wrapping — decompose.

**When a genuinely atomic command still prompts** (rare — usually means irreversible: force-push, `rm -rf` outside repo, destructive migration): in interactive mode, surface the command and reasoning to the user and let them approve. In autonomous mode, **park the unit of work** and log why. Don't attempt it without authorisation. Decomposition fixes complexity; approval (interactive) or parking (autonomous) is the correct response to genuine irreversibility.

### Autonomous Mode Contract

Faff sub-skills can be invoked in **autonomous mode** (primarily by `/faff-beep-boop`). The mode is signalled in-conversation at the top of the invocation: _"running in autonomous mode, skip all prompts, park on ambiguity, log everything"_.

Universal rules in autonomous mode:

- **Never prompt.** Every interactive gate has a pre-defined autonomous default. If there is no safe default for a decision, park the work unit and move on.
- **Log every decision, input, and output** to `.faff/logs/…` per the layout above. The log must be sufficient to resume in a fresh conversation.
- **Park on unexpected state.** Missing MCP tool, failed query, dirty worktree, genuine ambiguity — all trigger _park + log + continue_. Never abort the whole run on a single issue.
- **"Ambiguity" means the spec is ambiguous — not that the session state is.** Things about your own runtime are never valid park reasons:
  - Context compaction (current or anticipated) — the harness handles compaction; the `.faff/` logs + tracker + PR state make every work unit resumable across compactions. A compacted session is not an ambiguous one.
  - Session length, turn count, "this will take many steps", "I've already done a lot this session" — none of these are ambiguities. Do the work.
  - Worries about whether you'll remember earlier steps — you don't need to. The log captures what was decided; the tracker captures status; git captures diffs. Future-you (or a resumed session) reads state, it doesn't remember it.
  - Beep-boop processes issues serially (or via the `parallel` slot). Each `/faff-workit` invocation is an independent unit — if compaction happens mid-build, resume from `.faff/runs/<run-id>/ISSUE-XX/workit.md` + the branch/PR state. This is a feature, not a risk.
  - **Forbidden park reasons (explicit list):** "session may compact", "context is getting long", "too many turns", "too many issues left in the queue", "risk of another compaction", "mid-build compaction would be ambiguous", "single-session capacity constraints", "single-conversation context budget", "honest orchestration is to do fewer", "depends on a Todo issue that's also in this run", "large scope + external dep addition", "would introduce a new package as first LLM/SDK/XXX site", "chained issue — waiting for earlier to ship". If one of these is the reason, **just proceed** — or serialise via conflict analysis — it's not a real park.
- **"Deferred" / "queued for next run" / "not dispatched this conversation" is the same thing as "parked", just relabelled.** Renaming the category doesn't change the failure mode: ready work that should have been dispatched didn't get dispatched. Any of these phrasings — "deferred to next pass", "saved for the next /faff-beep-boop", "queue is unblocked, ready for next run", "single-conversation context budget", "didn't dispatch this conversation" — is a forbidden bail under a different name. If you find yourself writing one of those phrases in a run summary, the run is **not complete**: go back and dispatch the queue. The only valid run-end states are (i) the queue drained, (ii) every remaining issue is genuinely parked under one of the three valid categories, or (iii) the harness terminated the session externally (which leaves a `.faff/runs/<run-id>/` resumable from the next invocation — not a "deferred" state authored by you).
- **If conflict analysis produced a build queue, dispatching it is the next mandatory step.** Identifying waves and partitioning into independents/collision groups is not the finish line — it's the precondition to building. A run that ends after conflict analysis with the queue undispatched is an incomplete run, not a deferred one. Compaction during build is a resume (the `.faff/runs/<run-id>/` directory + PR/branch state make it resumable from a fresh session); pre-emptively stopping because compaction *might* happen is the same anti-pattern as pre-parking on "session may compact" — explicitly forbidden above.
- **Log entries always include:** what was expected, what was observed, what decision was taken, and why.
- **Spec-closed decisions stay closed. Never re-litigate them.** When reading a spec in autonomous mode, parse for **decision markers**, not topic keywords:
  - Sections ending with `Chosen: X`, `**Chosen:** X`, `Decision: X`, or equivalent conclusion markers are **closed**. Do the thing the spec chose. A "pino vs winston" rationale table that ends in `Chosen: pino` is not an open question — it is a locked decision.
  - A spec self-rated `confidence: high` closes every spec-internal decision. Trust the contents. Park only on external unknowns.
  - **Spec punts are explicit.** Markers include `Punt:`, `needs human`, `TBD`, `unresolved`, `(or X if Y is too much)`, "revisit", or any sentence presenting two options without picking one. Only these escalate.
- **The review skill is the autonomous human-review gate.** Every autonomous build lands as a **regular (ready-for-review) PR** and runs the configured `review` skill (or faff-workit's built-in review if none is configured) as a senior-engineer stand-in. The review's job is to decide whether this PR can merge on green, or whether a human actually has to look first. On pass → auto-merge when CI is green and ACs are verified. On `needs-human` → flip the PR to draft and park for human attention. On `fail` (fixable issues — failing tests, obvious bugs, missing test coverage) → iterate autonomously, re-run review, keep going until pass or `needs-human`. **Work that lands via PR is reversible by definition** — `git revert` exists. Pre-parking is wasteful when the review + merge-confidence gate already catches mistakes. Chained issues depend on earlier PRs merging; over-parking at the pre-PR stage breaks the pipeline.
- **Valid autonomous parks (escalate to human pre-PR):** only three categories — (a) the spec contains an explicit punt marker, (b) the spec assumes external state that doesn't exist in the repo (missing dep, undefined seam, blocker issue not shipped **and not in the current run's queue**), (c) the work cannot be fully reversed by `git revert` on the merge commit — i.e. it would execute a **side effect outside the PR flow** before the human reviews it.
- **In-queue dependencies are serialisation, not parks.** If issue A depends on issue B, and B is in the current beep-boop run's build or prep queue, that is a **collision group** — build B first, then A in the same run. Do NOT park A for "depends on B" when B is Todo/Backlog-in-queue. The conflict analysis step (see `skills/faff-beep-boop/SKILL.md`) exists precisely to serialise these. Parking chained work is the failure mode that breaks the pipeline: if a queue of 5 chained issues all park because "the next one isn't Done yet", nothing ships.
- **External dependency additions (new SDK, new package) are not a park category.** If the spec has a `Chosen:` / `Decision:` marker naming the package, the decision is closed — proceed. Adding a package to `package.json` lands via PR and is caught by the review + merge-confidence gate. "Introduces new external dep" is a topic-keyword match, not a park reason.
- **Scope size is not a park category.** "Large scope", "many files touched", "significant surface area", "too many issues left to do", "only time for one" — none of these are in the three valid categories. The review step judges scope creep *relative to the spec*; if the diff matches what the spec asked for, scope is fine regardless of size. If there are too many issues to do in one run, that is solved by parallelism or by the run ending naturally when the queue drains — not by pre-parking to save effort.
- **What "side effect outside the PR flow" actually means:** producing state changes that persist regardless of whether the PR lands. Examples: dropping or migrating production database tables, deleting or renaming S3 buckets / cloud resources, rotating or revoking secrets, sending emails or webhooks to real recipients, publishing packages to a registry, force-pushing to a protected branch, running one-off scripts against prod. These genuinely need pre-approval because the PR gate can't catch them after the fact.
- **What is NOT a valid park, even if the CLAUDE.md topic list mentions it:** edits to files that only take effect after merge. This includes `netlify.toml`, `.github/workflows/*.yml`, `Dockerfile`, `package.json` dep bumps, migration SQL files (as long as they are not *executed* pre-merge), IaC definitions, CI config, build config. These all land via PR; the PR review is the gate. A CLAUDE.md rule like "modifying CI/CD requires confirmation" means *the PR review is the confirmation* — not a pre-park.
- **Rule of thumb:** ask "if I merge this PR and it turns out wrong, can I fix it with `git revert` and a redeploy?" If yes → proceed, let the PR gate catch it. If no (because damage happened before or independent of the merge) → park.
- **Invalid autonomous parks (just proceed):** anything outside the three valid categories above. Stylistic second-guessing, "did the author really mean X?", topic-keyword matches on sections that the spec has already closed, conflating "this touches sensitive files" with "this needs pre-approval". If the spec has an answer and the PR gate will catch mistakes, that is the answer.
- **Post-merge housekeeping failures never halt the queue.** Deleting a merged local branch, removing a worktree, returning to the main working directory, tracker-side status bumps, label cleanup — these are **post-ship housekeeping**, not load-bearing steps. The work that mattered (spec → build → review → CI → merge) is already done and persisted. If any of these housekeeping steps fails (permission error because the shell is still inside the worktree, branch currently checked out, tracker transition rejected, label already removed, etc.) — **skip the failing step, log it, move on to the next issue in the queue**. Never prompt. Never park the merged issue. Never ask the human to resolve it mid-run. Accumulate the skipped items in a per-run "human follow-ups" list that is surfaced in the final run summary (see `skills/faff-beep-boop/SKILL.md` Reporting). The golden rule: anything that happens *after* the PR is merged and cannot be undone by a human in a minute from the run summary is not worth halting the pipeline for.
- **Bash hygiene is mandatory** — see the **Bash command hygiene** shared rule above. Those rules apply universally, but they are especially load-bearing here: a single approval prompt halts the run, where in interactive mode it would only break the user's flow. Same rules, higher cost when broken. The autonomous-specific tail: when a genuinely atomic command still prompts, **park** rather than attempt — there is no human to approve it.

Per-skill autonomous specifics live in each sub-skill's `Autonomous Mode` section. Summary:

| Skill | Autonomous behaviour (high-level) |
|---|---|
| faff-tidy | Auto-archive merged/cancelled + auto-reparent obvious orphans only. Everything else logged for morning review. |
| faff-wtf | Return the ready-queue as a plain list. No focus recommendation. |
| faff-prep | Stale-refresh when original design still holds; auto-spec from scratch only on high-confidence self-rating. Medium/low → park. Inline path parks (no self-rating available). |
| faff-workit | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park. Post-build → AC verification → review (pass/fail/needs-human). `pass` → auto-merge on green CI (unblocks chained issues). `fail` → iterate. `needs-human` → flip PR to draft, park. |

### Park protocol (shared)

Every faff skill that can park work follows the same protocol:

1. Commit WIP with a clear message (if a branch/worktree exists for this unit of work).
2. Open or update the PR as **draft**.
3. Post a comment on the tracker issue: cause, what was attempted, what is needed from a human. Tag the issue as `parked-by-faff` (or the tracker's equivalent label) so `/faff-wtf` can surface it.
4. Write to `.faff/logs/…` with the full context.
5. Return control to the caller (beep-boop or interactive invoker).

## Chaining pattern

When a faff skill's flow leads naturally into another faff skill, it offers the next step via a yes/no gate (or a short-choice prompt where there is a real branch like Build/Review/Reprep). On confirm, it invokes the next skill via the `Skill` tool in the same conversation. On deny, it stops cleanly.

No faff skill uses passive "run `/faff-*` next" or "you should run" language. Every chain point is an explicit gate.

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly.
