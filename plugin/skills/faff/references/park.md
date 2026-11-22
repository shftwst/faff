# Faff gateway reference — park lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Interactive park resolution (surface, don't settle)

Follow **Resolve-attempt before park** for unattended work. Park unresolved decisions, gaps and cycles without prompting. Interactive prep or tidy may investigate and recommend a choice. Only the human can settle architecture, scope or taste and author the `**Chosen:**` resolution.

An agent may close a factual error such as a disproven measurement or violation of an existing rule. Verify findings against the cited source, including subagent findings. Surface doubtful cases for human judgment.

### Park protocol (shared)

Every faff skill that can park work follows the same protocol:

1. **Preserve WIP and flip the PR to draft, only when they already exist.** Commit WIP with a clear message when a branch/worktree exists for this unit of work, and flip an existing PR to draft. A pre-build park — e.g. a `needs-decision-first` whose resolve-attempt fails before any build started — has neither, so both steps are skipped rather than manufacturing a branch, worktree, or PR.
2. Run `faff park prepare` on `{issue_id,root_cause_class,timestamp,reconsider,cited_input?}`. Use the routing adaptor's class (failed `needs-decision-first` uses `punt-not-closed`). Keep the returned fact and full reasoning in the existing `.faff/logs/…` log and in the per-issue park log for a run. Reuse that fact and timestamp on retries and rediscovery. A new park after unpark gets a new fact and timestamp.
3. Run `faff park finalize` on `{record,comment,label,park_records?,backstop?}`, using fresh tracker MCP observations tied to this transition. Historical comments and markers only confirm their own park. Use `confirmed`, `missing` (verified absent), or `unknown`; treat an uncertain write as `unknown` until the tracker establishes its result. In git-only mode use `marker` instead of `comment` and `label` and confirm the authorized local park evidence.
   - `comment`: post the cause, attempts and human action needed. The reason line names the decision and owner, e.g. **Park reason:** unresolved Punt — `<short decision topic from the spec's Punt line>` (`decides: <owner>`); put recovery detail in the run summary. Apply the same one-line rule to gap and cycle parks.
   - `label`: use `faff label transition <issue> parked --present-label <each current state label>` and its descriptor write. Use the configured parked role and existing governed label-write checks.
   - After each MCP effect, confirm the result and rerun finalization. `reconcile` re-reads the named effect before any retry. `already-recorded` ends recovery for that transition. `backstop:true` reserves comment creation for the initiator.
4. On `record`, the orchestrator keeps the returned ordered `park_records`. A worker returns its completed fact; the orchestrator alone folds it and renders one `faff-parks` fence at run end (even when empty).

**Interactive mode — the recovery offer (per gateway → *Interactive next-step offer*):** the terminal line names the exact re-invoke command per park cause — spec-level → `/faff-prep <issue>`, build-level → `/faff-graft <issue>` (resume from the draft PR), structural (`gap-blocked`/`circular-blocked`) → resolve the gap/cycle and the next `/faff-tidy` re-routes it — plus the later route "or see it again anytime via `/faff-wtf` → Parked work." **Autonomous mode:** emit **no** offer (the no-prompt invariant); just return control.

### Reconsider classification and the park-versus-hold boundary (FAFF-992)

Keep the five `root_cause_class` values for repeat-park counting. Classify reconsideration separately at park time:

- Use the awaiting-spec-review hold for a transient a bounded retry can clear this turn. It creates no park record.
- Use `reconsider:"machine"` only when recovery needs an external edit to one proven config file. Pass `cited_input:{kind:"config-file",ref,keys?}` to `faff park prepare`, which fingerprints the repo-confined file or falls back to `human`. Carry the classification and citation in the git-only marker's `park` field.
- Scope, taste, architecture, unproven causes and legacy records stay `human`.

### The git-only Unpark contract (FAFF-993)

A git-only park lives in `.faff/prep/<issue>.json` and, for admitted work, as a `parked` ledger outcome. Use the shared Unpark protocol (`apply_git_only_unpark`) to clear the surfaces the caller owns. A marker-only edit can strand a live queue in `all-parked`.

**Own live run.** On lights-out resume, `classifyReEntry` requires a machine park, elapsed time and a changed fingerprint for the cited config file. Missing, unreadable, unsupported, unchanged or symlink-escaping inputs keep the park. Resolve the real path inside the repo before reading. Human and legacy parks stay parked.

Resume clears its own ledger outcome under lock before the marker. A locked, yielded or malformed ledger leaves the marker in place. Success records `park-reconsidered` in that run's events and writes `.faff/resume/<issue>/spec-review-hold.json` with `cause:"reconsider-input-changed"`. Its presence gives `awaiting_spec_review:true` in `faff prepcheck --issue <id> --json`. The prep queue re-enters spec review on drain.

**Interactive re-invoke.** Git-only `/faff-prep <issue>` requires an explicit human unpark or a human-authored `**Chosen:**` closing the cited cause. For a cited config file, check the confined fingerprint and warn if unchanged. The human's decision governs. Read the previous run at `owner.run_dir`. If absent, rotated or terminal, clear the marker and log `park-reconsidered` with `via:"interactive-reprep"` in this prep's log. A live or malformed earlier run leaves the park standing. Its ledger and events are read-only for interactive prep.
