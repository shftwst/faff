# Faff gateway reference — park lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Interactive park resolution (surface, don't settle)

**Resolve-attempt before park** (above) defines the autonomous boundary: unattended runs park `needs-decision-first` / `gap-blocked` / `circular-blocked`, never self-resolve them. In interactive L1/L2 sessions, **Human curation is authoritative**: investigation informs the human's call; it cannot turn that call into an agent-authored settled resolution.

1. **Surface, don't settle.** Resolving a `needs-human` park interactively requires the **human's actual judgment** on any architecture / scope / taste decision the park names. The agent **surfaces** the decision and may offer a **recommendation**; it does **not** author a settled `**Chosen:**` / Resolution on the human's behalf. More subagent analysis does not discharge this — the judgment, not the investigation, is reserved for the human. Analysis and recommendation are welcome; only *authorship of the verdict* transfers.
2. **Correctness carve-out.** An agent **may** close a park whose fix is a **matter of fact, not taste** — a genuine bug, a falsified measurement, a rule already written down — because there is a *right answer*, not a *choice*. Architecture / scope / taste are **never** in this carve-out. **In doubt → treat as taste and surface it.**
3. **Verify subagent findings against the source.** Check findings against the authoritative source before acting; a summary that contradicts its cited source loses to the source.

**Symmetry, not licence.** Autonomous runs park needs-human calls; interactive runs surface them. Neither lets the agent settle them. Autonomous mid-run prompts remain forbidden by the **no-prompt invariant**, **Autonomous Mode Contract**. `faff-tidy` and `faff-prep` reference this rule.

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

Classify parks at park time: human calls (scope, taste, architecture) remain human; machine-checkable causes may be reconsidered later. Recoverable in-turn transients become holds, never parks.

**The reconsider axis is orthogonal to the closed five root-cause classes.** `root_cause_class` stays closed at five (it drives repeat-park counting). The machine-versus-human distinction is a separate `reconsider` field plus a `cited_input` reference — **never** a sixth root-cause class.

**Assign `reconsider` alongside the class.** Scope, taste, architecture and unproven causes are `human`, including legacy records. Choose `machine` only for an elapsed-input change with one proven config-file cause. Supply `cited_input:{kind:"config-file",ref,keys?}` to preparation; it fingerprints the repo-root file or downgrades to `human`. The git-only prep marker's `park` sub-object carries the same classification and citation.

**The park-versus-hold boundary (prevention).** A machine cause partitions by regime:

```
             machine cause
                  |
      +-----------+-----------+
      |                       |
 in-turn-recoverable    elapsed-input-change
 (transient blip)       (config edit)
      |                       |
   HOLD                    PARK, reconsider = "machine"
   (faff-awaiting-           cited_input + fingerprint
    spec-review; FAFF-900)   (FAFF-993 reconsiders later)
   never a park
```

A machine cause a **bounded in-turn retry can clear this turn** (a transient backend blip) routes to the existing `faff-awaiting-spec-review` hold (FAFF-900, Done, #771) and **never a park** — it never reaches the park record. Only an **elapsed-input-change** cause (a config-fault that needs an external edit over elapsed operator time, with no in-turn signal to ride out) stays a park, recorded `reconsider:"machine"` with its cited input. A human-judgment cause is unaffected by this boundary and parks `reconsider:"human"`. This keeps a `machine` park record meaning exactly one thing — a cause that needs elapsed external change — which is the only thing FAFF-993's autonomous seam is licensed to reconsider.

### The git-only Unpark contract (FAFF-993)

The kernel's **Unpark protocol** owns unpark mechanics; this is its git-only definition (kernel → *The git-only Unpark contract*). In git-only mode there is no `faff-parked` label, so a park lives as `disposition:"parked"` on `.faff/prep/<issue>.json` (Sensor/resume class) and, for an admitted issue, a `parked` outcome on the run's `run-ledger.json` (Evidence class). Clearing it clears **every** git-only surfacer the actor is authorised to write, together, then logs the unpark — **never** a bare `disposition` strip that leaves a live ledger outcome (and so `queue-state`'s `all-parked`) reading `parked`. One shared write helper (`apply_git_only_unpark`, `park-reconsider.js`) owns the marker clear and its ordering, parameterised by ledger-write authority per the kernel's Run-artifact write-authority rule:

- **Autonomous re-entry — `own-live-run`.** The resume-time reconsider pass in `resumeLightsOut` clears a park **only** when the pure `classifyReEntry` proves the cited machine-checkable input demonstrably changed since park time: a `machine` park with a stored fingerprint, a repo-root-confined `ref`, and a differing current fingerprint — **never** the cause *class* alone (that re-opens FAFF-900's in-turn ruling). It is the trusted side of its **own** run's dispatch cut, so it clears that run's `parked` ledger outcome (under `mutateLedgerUnderLock`) **first**, then the marker, refusing (no strip) on a locked / yielded / malformed ledger; it appends a run-scoped `park-reconsidered` event to its own `events.jsonl` and transitions the issue into the FAFF-900 **spec-review-resume hold** (`.faff/resume/<issue>/spec-review-hold.json`, `cause:"reconsider-input-changed"`) so the existing prep-queue drain re-enters it at the spec-review gate — no new re-entry path, no in-`resumeLightsOut` re-review. In git-only mode that hold file's **presence** is the awaiting-spec-review signal (the label being a tracker no-op) — surfaced by `faff prepcheck --issue <id> --json` as `awaiting_spec_review:true` for the membership consult.
- **Interactive re-invoke — `cross-run-readonly`.** An interactive `/faff-prep <issue>` on a parked git-only issue is **not** the trusted side of the earlier dispatched run's cut, so it **never** writes that run's Evidence artifacts (`run-ledger.json` / `events.jsonl`). It writes only the marker (Sensor/resume class, which an L2 session may write) and its own prep log (`park-reconsidered`, `via:"interactive-reprep"`). It gates on a **human-authored observable** — a `**Chosen:**` closing the cited cause, or an explicit unpark — never the model's opinion that free-form input settled the cause (**Interactive park resolution** above governs). It reads the earlier run (via the marker's `owner.run_dir`) only to pick a branch: clear the marker alone when that run is absent / rotated / terminal (no live surfacer reads `parked`), and **refuse** — park left standing — when it is present-but-malformed or still live (that run's own resume-reconsider clears its ledger later). For a `config-file` cited cause it recomputes the fingerprint under repo-root confinement and warns when the cited config is byte-identical to park time, but the authored artifact is the authoritative gate.

**A human park is never auto-re-opened.** A park recorded `reconsider:"human"` (scope, taste, architecture, or anything the classifier could not prove machine-checkable), or a legacy / absent record, is never reconsidered by any autonomous path regardless of elapsed time or file changes; in doubt the park stays human. A present human at the interactive seam is authoritative and may close any park once their authored resolution settles the cause. The cited-input `ref` is always confined to the repo root by **realpath** containment (symlink-resolving, the `spec-judge-casefile.js` model — not the lexical `resumecheck.isUnderRunsRoot` check) before any fingerprint read, so an in-root symlink escaping the tree fails closed (`ref-outside-repo-root`), never dereferenced.
