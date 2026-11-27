# Faff gateway reference — tracker

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Tracker availability resolution

At entry, `faff tracker probe --json` returns `{pin, resolution}` from `tracking.tracker`. Discover live connectors through the harness.

| Resolution | Action |
|---|---|
| `git-only` (configured `none` or `git-only`) | Use git-only immediately. Skip discovery and all tracker operations, even when a connector is visible. |
| `pinned` | Discover the named connector. If unavailable, surface the fault below. |
| `unpinned` | Discover a tracker connector. Use git-only only when discovery finds none. |

Use visible connector tools or search the harness catalogue for deferred issue/comment tools. A failed tracker read, or failure to find the configured connector, raises the fault "tracker configured/pinned but connector not reachable this session". Stop the affected lookup. Reuse the resolution for this run. Beep-boop resolves both tracker availability and its structural git-only signal once across all waves. Resolve afresh on the next entry.

### Spec docs location

Use `faff config spec-docs-path` for the repository-relative spec directory. Add `--create` when it must exist. `tracking.spec_docs_path` accepts a trailing slash. The default is `docs/specs/`, or `doc/specs/` when only `doc/` exists. Graft commits `YYYY-MM-DD-<issue-id>-<slug>-design.md` on the feature branch so the spec ships with the code.

Resolve PRDs, PRDRs, ADRs and spikes with `faff config` (`prd-docs-path`, `prdr-docs-path`, `adr-docs-path`, `spike-docs-path`). Each honours its `tracking.<kind>_docs_path` override and the same `docs/` or `doc/` rule, with subdirectories `prd/`, `prdr/`, `adr/` and `spikes/` respectively. `adr-superseded-docs-path` uses the resolved ADR directory unless `tracking.adr_superseded_docs_path` overrides it.

### Ignore cancelled and archived

Exclude cancelled or archived issues, projects and children of cancelled or archived projects from all queries, recommendations, counts and output. Completed issues stay visible.

**What counts as cancelled.** For Linear and GitHub, classify each freshly fetched batch once with `faff tracker facts --source linear|github`. Pass JSON on stdin: `{complete:true,issues,edges,queue}`. Use the same `id` throughout. Supply the observed Linear `state` (name/type or `stateCategory`) or GitHub `state`, closure reason and merge metadata. Include archive evidence and any parent project status under `project`. Edges are ordered `[issue, blocker]` ID pairs. Queue IDs mark in-wave dependencies. Omit edges and queue for a visibility-only read. Exclude `hidden` IDs. Discovery, pagination and fresh reads belong to the tracker MCP. An incomplete read or exit 2 cannot authorize action.

For Jira, exclude cancellation-category resolutions (Won't Do, Duplicate, Cannot Reproduce and team equivalents). Elsewhere use the tracker's cancellation category, falling back to Cancelled, Duplicate, Won't Fix, Won't Do or Cannot Reproduce when categories are unavailable.

### Satisfied blockers — edges to terminal work

For Linear and GitHub use `live_edges` for walks, unlock counts and chain-fireability. Only IDs in `blocked` have live external blockers. The classifier drops edges from hidden sources and edges to completed targets. Unresolved targets stay live. The read leaves tracker relations intact. On Jira a done-category resolution satisfies the edge. On other trackers prefer the completed category, then Done, Complete, Shipped or Closed-as-done by name.

### Next-step transition — consult `faff next`

Every caller deciding an issue's next step consults `faff next` using live facts at the decision point.

```
faff next --status <S> --spec none|low|medium|high [--not-eligible] [--parked] [--blocked] [--awaiting-spec-review]
```

- Map live status to `backlog|todo|in-progress|in-review|done|cancelled|duplicate`. Use the retained **Spec discovery** confidence or `none`.
- Add `--not-eligible` when `faff eligible --issue "$issue"` returns false (`--held` is its deprecated alias). Add `--parked` for the park label and `--awaiting-spec-review` for the review-outage label. Park wins over outage. An outage returns to prep before considering confidence.
- Add `--blocked` only for a live external blocker. Use the batch's `blocked` IDs where supported, otherwise resolve blocker states live. Queue members are serialised by conflict analysis.

Use `{next,reason}` at this decision point. For crank-up proposals or the On-hold report, `--if-eligible` previews an ineligible issue's route and marks it `would_be_eligible:true`. Terminal states still win. The flag grants no eligibility and has no effect on eligible issues.

Keep the interactive jot/prep chain-to-build gate. A legal `graft` route still requires consent. The routing adaptor decides admission (`gap-blocked`, `circular-blocked`, `repeat-parked`). On error or unknown status, log the fault and use the caller's existing fallback.

### Re-ground before gate (gating inputs must be live)

At each eligibility, routing or claim gate, take the current status and labels from one live issue read. Include post-spec comments when the verdict depends on them (**Live-thread reconciliation**). At claim-before-admit, use the claim fetch for both status and labels. Prep before spec and beep-boop queue assembly take their own gate read. A previous turn's snapshot cannot establish what the human permits now.

### Lean tracker reads (ask for only what the step consumes)

Use the declared lookup argument for a known issue ID. Select advertised fields only; count identity returned by default. Use a full read when projection or required gate facts are missing. Limit lists to the step, newest first (`createdAt` descending) for recent rows. Page as needed. Expand relations, releases or customer needs only when required.

Replies persist across turns. Isolate reads in a subagent or out-of-context CLI; return only needed values.

### Tracker as the lights-out control plane

During unattended runs the tracker is the complete human-visible record and control surface. Use the existing markers and gates below.

**Externalise pipeline transitions.** Use a tracker comment, control label, status move or run digest. File factory-created tickets in the shared Backlog for the next tidy→prep pass.

- **Spec-attach / promote** — `faff-prep` attaches the spec as a comment (with provenance stamp); promotion to Todo.
- **Park** — park comment + `faff-parked` label, via the shared **Park protocol**.
- **Resolve-attempt-proceed** — the audit-trail comment when autonomous mode infers an answer and proceeds (**Resolve-attempt before park**).
- **Appetite-override** — the `(appetite: …)` audit comment when an appetite-influenced decision ships.
- **Discovered-scope / chain-gap filing** — the `Backlog` ticket with its provenance line (`faff-beep-boop` step 10; `faff-tidy` chain-gaps).
- **Terminal disposition** — *shipped* (PR + auto-merge status move), *routed-out* (verdict gate), *errored* — surfaced via the run-summary digest.
- **The once-per-run run-summary digest** — posted to the tracker as a status update / project comment. One digest per run, not per step.

**Marker granularity.** Record routine file edits, tests, build decisions and CI polls in `.faff/` logs and the run digest only. Respect `logging: full|essential` and the appetite gate for discovered scope and chain gaps. Never file vague discovered scope.

**Re-read human edits each pass.** Before acting on any ticket, including factory-created tickets, fetch its current state and incorporate human edits. Apply **Always pull fresh** at beep-boop wave re-entry (`faff next`), tidy’s post-spec scan and prep’s autonomous stale-refresh.

**Agent Lanes.** Beep-boop records and files markers. Graft records and returns without tracker writes. Jot is interactive-only for tracker writes and uses `.faff/intake/` in autonomous mode. Report shipped, routed-out, errored and unreached dispositions without an extra per-issue marker.


### Spec discovery (where to look for an existing spec)

Resolve tracker mode first. With a tracker, check all three sources in order:

1. Fetch issue comments through the discovered connector's list-comments tool. Prep normally attaches the spec here. Follow pagination as needed before declaring it absent.
2. Check the issue body for a formal spec with context, approach and acceptance criteria. Plain requirements, notes or a detailed brief still need `/faff-prep` before building.
3. Check committed files matching `<spec-docs-path>/*-<issue-id>-*.md`, including a spec already committed on the feature branch.

When multiple sources contain specs, use the most recently modified one and log the discrepancy. Report "no spec" only after every applicable check succeeds. On a failed read, surface the fault under **Tracker availability resolution**.

In git-only mode check committed specs and the gitignored `.faff/specs/<gitkey>.md` store. Jot and plot mint the stable key with `faff queue-state new-key`. Prep writes the local spec there and graft commits it under the resolved spec directory. Reserve the local store for git-only mode.
