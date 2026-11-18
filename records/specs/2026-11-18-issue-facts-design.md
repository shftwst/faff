# Classify supplied issue and blocker facts

The discovered tracker connector owns live reads and pagination. The local classifier takes one complete Linear or GitHub batch and computes hidden issues, completed targets, live edges and external blockers. Other connectors retain their existing rules. The caller preserves the configured gates and presents or executes each action.

`test/issue-facts.test.mjs` exercises the public CLI on category, closure, archive and parent-project observations. The mixed-edge case feeds the resulting blocker decision through `faff next`.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` - For each project, fetch its issues with status, priority, and blocker links (both directions — wha `` | changed: map consumes the shared classifier’s visibility and live-edge results |
| `` Draw an ASCII chain showing how initiatives feed each other. The chain answers: **if every Now proje `` | changed: map consumes the shared classifier’s visibility and live-edge results |
| `` For every "X → Y" transition implied by the chain, table whether the gate can actually fire. A gate `` | changed: map consumes the shared classifier’s visibility and live-edge results |
| `` Every faff sub-skill excludes the following from every query, recommendation, count, and output: `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - Cancelled issues (and any issue in the tracker's cancellation state category — see **What counts a `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - Archived issues `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - Issues whose parent project is cancelled or archived `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - Cancelled or archived projects themselves `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` **What counts as cancelled.** The literal "Cancelled" state name isn't the only one — trackers group `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - **Linear** — any workflow state in the `cancelled` state category. By default this includes `Cance `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - **GitHub Issues** — closed issues with `state_reason = not_planned` (this covers closed-as-not-pla `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` - **Jira** — issues resolved with a cancellation-category resolution (`Won't Do`, `Duplicate`, `Cann `` | changed: the shared rule retains category and name fallbacks for these MCPs |
| `` - **Other trackers** — fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix` `` | changed: the shared rule retains category and name fallbacks for these MCPs |
| `` This wider definition matters because a tidy run that suggests cancelling tickets already in Linear' `` | changed: the executable category and fallback cases replace the explanatory example |
| `` No exceptions. Cancelled/archived items (across every state above) are invisible to faff — they are `` | changed: the shared visibility rule and executable classifier preserve cancellation, archive and parent-project exclusions |
| `` A `blockedBy` edge to a shipped target is a **satisfied edge**, not a live blocker — trackers never `` | changed: the batch classifier computes live edges and external blockers with the unresolved-target fallback |
| `` The single canonical answer to *"what's the legal next step for this issue?"* is the `faff next` CLI `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` **The agent maps fetched tracker state → the flags, then calls the function** (the agent already rea `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - `--status` ← the issue's tracker state, mapped to `backlog\|todo\|in-progress\|in-review\|done\|cancell `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - `--spec` ← the **Spec discovery** result: `none` when no spec exists, else the spec's retained `co `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - `--not-eligible` ← the issue is **not automation-eligible** (gateway → **Automation eligibility**) `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` It prints `{next, reason}` where `next` ∈ `prep \| graft \| skip-ineligible \| needs-human \| blocked \| `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` **Advisory: `--if-eligible` (read-only hypothetical).** When a **not-eligible** item carries `--if-e `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` **Three hard boundaries:** `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - **Reports, never executes or gates.** `faff next` says what's *legal next*; the sub-skill still ru `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - **Base transition, not the whole router.** `faff next` has no inputs for the diagnostic verdicts ( `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
| `` - **Fail safe.** On `error` / unknown status, fall back to the sub-skill's existing prose behaviour `` | changed: the next-step instructions retain live inputs, flag ownership, advisory previews, gates and fallback |
