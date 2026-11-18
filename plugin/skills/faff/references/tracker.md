# Faff gateway reference — tracker

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Tracker availability resolution

**The single canonical rule for deciding tracker-vs-git-only, for the whole suite.** faff-prep, faff-graft, faff-jot, faff-tidy, faff-wtf, faff-beep-boop and faff-map reference this rule; divergence is a bug, not a local override. Absence from immediately visible tools does not prove unavailability: deferred-tool harnesses such as Codex require discovery before connected tracker tools appear.

1. **Honour the config pin first (deterministic).** Read `tracking.tracker` via `faff tracker probe` (`pinned` | `unpinned` | `git-only`; `--json` → `{pin, resolution}`) and branch on the resolution before anything else:
   - **`pinned`** — the operator's **assertion the connector exists**: a skill **MUST NOT** downgrade to git-only merely because the tool isn't in its immediately-visible set — it discovers the connector (step 2) or fails loud (step 4).
   - **`git-only`** — the reserved `none`/`git-only` sentinel on `tracking.tracker`, the **symmetric inverse** of a connector pin: the operator asserts the repo has no tracker relationship. Resolve git-only **immediately, short-circuiting steps 2 and 4** — no discovery attempt, and a skill **MUST NOT** upgrade to tracker-mode even if a tracker MCP is visible this session. No skill creates, claims, or updates a tracker issue under this pin. All seven consuming skills inherit this outcome by reference, not a per-skill edit.
   - **`unpinned`** — neither assertion; proceed to step 2.

   The CLI is MCP-blind, so `probe` reports only this pin half; it never asserts reachability.
2. **Discover before concluding absence.** On `unpinned`, attempt to *discover* the tracker connector via the harness's tool-discovery mechanism **before** concluding git-only. The mechanism is harness-specific — Codex exposes a tool-search / catalogue step (search for the tracker's tools, e.g. `list_comments` / `get_issue`, then use them); Claude Code already lists them up front, so discovery is a no-op there. "Not immediately listed" stops being evidence of absence: git-only is concluded only when discovery genuinely finds no connector.
3. **Resolve once per entry — don't re-infer per skill, and don't cache across sessions.** Resolve mode on skill entry and reuse it for that run. Beep-boop resolves both tracker availability and the structural git-only signal once per run, never per wave. Never persist a cross-session mode marker: harness switching can stale it; rediscover on each entry.
4. **Unreachable ≠ git-only, and ≠ "no spec".** If a tracker is pinned or configured but the connector cannot be reached this session (discovery found nothing under a pin, or a read failed), that is a **loud fault** — surface "tracker configured/pinned but connector not reachable this session" — **not** a silent drop to git-only, and **not** a false "no spec" (see faff-graft's prep-gate, which enforces this distinction).

### Spec docs location

When `/faff-graft` starts a build it commits the spec into the repo so it ships in the same PR as the code (see **Spec discovery** below and the faff-prep / faff-graft artifact lifecycle). The in-repo directory is configurable via `tracking.spec_docs_path`.

- **Default when unset:** `docs/specs/` when `docs/` exists, otherwise `doc/specs/` when `doc/` exists, otherwise create and use `docs/specs/`.
- The value is a directory **relative to the repo root**. A trailing slash is optional.
- The filename within it is unchanged: `YYYY-MM-DD-<issue-id>-<slug>-design.md`.
- This only relocates the spec **within the same repo** — the spec still lands on the feature branch and ships with the PR. It is not a pointer to a separate repository.

Every faff sub-skill that reads or writes the committed spec resolves the directory from this key, falling back to the default-resolution rule above when it's absent. The `faff config spec-docs-path [--create]` resolver applies this exact rule — sub-skills call it rather than re-deriving the path. References below to a default of `docs/specs/` are shorthand for that rule (i.e. `doc/specs/` when only `doc/` exists). Spec discovery globs `<spec-docs-path>/*-<issue-id>-*.md`.

PRDs, PRDRs, ADRs, and spikes follow the same rule through `tracking.prd_docs_path`, `tracking.prdr_docs_path`, `tracking.adr_docs_path`, and `tracking.spike_docs_path`. Their resolver commands are `faff config prd-docs-path`, `prdr-docs-path`, `adr-docs-path`, and `spike-docs-path`. The default locations remain `docs/prd/`, `docs/prdr/`, `docs/adr/`, and `docs/spikes/`; a repository can opt into another structure without changing SuperDomestique's defaults for everyone else. A sixth key, `tracking.adr_superseded_docs_path` (resolver `faff config adr-superseded-docs-path`), sets where a superseded ADR lands; unset it defaults to the ADR directory itself (nothing relocates), and setting it to another directory is what moves a superseded ADR there.


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
- Add `--not-eligible` when `faff eligible` returns false for the fresh labels (`--held` is its deprecated alias). Add `--parked` for the park label and `--awaiting-spec-review` for the review-outage label. Park wins over outage. An outage returns to prep before considering confidence.
- Add `--blocked` only for a live external blocker. Use the batch's `blocked` IDs where supported, otherwise resolve blocker states live. Queue members are serialised by conflict analysis.

Use `{next,reason}` at this decision point. For crank-up proposals or the On-hold report, `--if-eligible` previews an ineligible issue's route and marks it `would_be_eligible:true`. Terminal states still win. The flag grants no eligibility and has no effect on eligible issues.

Keep the interactive jot/prep chain-to-build gate. A legal `graft` route still requires consent. The routing adaptor decides admission (`gap-blocked`, `circular-blocked`, `repeat-parked`). On error or unknown status, log the fault and use the caller's existing fallback.

### Re-ground before gate (gating inputs must be live)

**Always pull fresh** governs every read-and-synthesise pass; this sharpens it for the higher-stakes case of a **gate** — a point where a skill *decides whether/how to act* on an issue (eligibility · automation-routing verdict · claim-before-admit). A gate is only as fresh as its inputs: the labels + status it consumes come from a read taken **at the gate**, never an earlier same-session tool-result — else a remembered read silently overrides a human who steered the tracker between turns. Three freshness members must be live at the gate: **status** (re-read per **Issue claim & status monotonicity**) · **verdict inputs** (post-spec comments, per **Live-thread reconciliation**) · **eligibility labels** (the `faff-automate` signal). **Co-location:** the eligibility-label + status re-read ride on the existing claim-before-admit fetch (one fetch) where it runs; a gate upstream of any claim-before-admit site (prep's pre-spec gate, beep-boop's queue assembly) takes its own at-the-gate read. **Honest limit:** a runtime discipline, prose-enforced — **not** statically lintable (`validate-adapters` cannot prove a caller passed a fresh read vs a snapshot), consistent with the claim-monotonicity and live-thread rules and the chaining gate. The chokepoints (beep-boop, tidy, prep, graft) refer back here rather than restate it.

### Lean tracker reads (ask for only what the step consumes)

Tracker responses remain in context, costing `size × turns-resident` as later `cache_read`s. Fetch only what the step consumes while obeying **Always pull fresh**. Call sites reference this shared rule. Lean reads reduce returned data but cannot evict prior tool results; eviction requires subagent isolation or an out-of-context CLI. With a known id, prefer one `get_issue` over `list_issues`.

- **Pass an explicit `limit`** sized to what the step consumes (never the default 50), and **order newest-first when only recent rows matter** (`orderBy: createdAt` descending) — e.g. a post-spec comment scan wants the handful of comments after the spec, not fifty in default order.
- **Never opt into an expansion you don't consume in the same step** — omit `includeRelations` / `includeReleases` / `includeCustomerNeeds` unless the expanded fields are read right there.


### Tracker as the lights-out control plane

During unattended runs (`/faff-beep-boop`) the **tracker is the complete human-legible record, control plane, and observability surface** — never a hidden internal queue. Three obligations, all already implemented by existing machinery (this section *names* them; it adds **no** new mechanism — no `faff` subcommand, no config key, no per-step marker subsystem, no new `.faff/` artefact):

**1. Externalise every marker-worthy step.** The meaningful pipeline transitions leave a tracker marker — a per-issue comment, a control label, a status move, or the once-per-run digest. Factory-created tickets join the **same** `Backlog` as all other work — no parallel hidden queue — and are picked up by the next tidy→prep pass. The canonical marker set (already left, distributed across the skills):

- **Spec-attach / promote** — `faff-prep` attaches the spec as a comment (with provenance stamp); promotion to Todo.
- **Park** — park comment + `faff-parked` label, via the shared **Park protocol**.
- **Resolve-attempt-proceed** — the audit-trail comment when autonomous mode infers an answer and proceeds (**Resolve-attempt before park**).
- **Appetite-override** — the `(appetite: …)` audit comment when an appetite-influenced decision ships.
- **Discovered-scope / chain-gap filing** — the `Backlog` ticket with its provenance line (`faff-beep-boop` step 10; `faff-tidy` chain-gaps).
- **Terminal disposition** — *shipped* (PR + auto-merge status move), *routed-out* (verdict gate), *errored* — surfaced via the run-summary digest.
- **The once-per-run run-summary digest** — posted to the tracker as a status update / project comment. One digest per run, not per step.

**2. Marker-worthy ≠ every action (the granularity rule — the crux).** *Marker-worthy* means the transitions/dispositions above — **not** every micro-step. **Per-micro-step markers are forbidden:** a tracker comment per file edited, per test run, per intra-build decision, or per CI poll floods the control plane and destroys the legibility this principle exists to protect. Routine intra-step progress lives in `.faff/` logs and the once-per-run digest, **never** as a tracker comment. Density is governed by the **existing** levers — `logging: full|essential`, the `appetite` dial (gates discovered/chain-gap auto-create), the vague/concrete split (vague discovered-scope is never filed), and the run digest — **not** by any new knob.

**3. Re-read human edits each pass (the steer loop).** Every pass re-reads the ticket's current tracker state + human edits **before** acting and incorporates them — implemented by **Always pull fresh**, `faff-beep-boop`'s wave re-entry + `faff next`, `faff-tidy`'s post-spec comment scan, and `faff-prep`'s autonomous stale-refresh. The human can view or alter **any** ticket — including one the factory created — and the next pass honours the edit. This is the **Human curation is authoritative** principle (below) applied to factory-created work — this section is its externalise/steer half; that section is the obey half. No new fetch/merge mechanism is added.

**Lane & composition.** Markers are written by the **orchestrator** lane (`faff-beep-boop`) per **Agent Lanes** record-and-file; the implementor (`faff-graft`) records-and-returns and never writes the tracker directly; `faff-jot` stays interactive-only (its autonomous mode writes `.faff/intake/`, never the tracker). No per-issue marker is added for shipped / routed-out / errored / unreached dispositions — the PR + status move + run digest already make each legible, and §2 forbids duplicating them. This principle **composes** with **Agent Lanes**, **Always pull fresh**, **Appetite for destruction**, and the **Park protocol** — it restates none of them.


### Spec discovery (where to look for an existing spec)

**This section is the single canonical definition of spec discovery for the whole suite.** Sub-skills (faff-tidy, faff-prep, faff-graft, faff-wtf, faff-map, the methodology's `promotion-readiness`) reference it rather than restating the rule; where one mentions "a real spec per the shared Spec discovery rule", it means exactly the checks below (locations 1–3 with a tracker; location 4 the git-only fallback). Any divergence in a sub-skill is a bug, not a local override.

Any faff sub-skill that asks "does this issue have a spec?" must check **all** of the following, in order, and treat a hit in any of them as the spec:

1. **Issue tracker comments** — **the default and most common location**. faff-prep writes the spec as a comment on the issue during Phase 1 (pre-build). **Most specs live here**, not in the description.
2. **Issue tracker main description / body** — counts **only** when the body holds an actual formalised spec (the structured artefact faff-prep produces: context, approach, acceptance criteria), e.g. someone authored or pasted a real spec into the ticket body instead of a comment. A plain description — requirements, context, or notes, **however clear or well-defined** — is **not** a spec and does **not** count here.
3. **Committed docs** in the repo — under the configured **spec-docs path** (default `docs/specs/`; see **Spec docs location**), e.g. `<spec-docs-path>/YYYY-MM-DD-<issue-id>-*.md`. This is where faff-graft commits the spec on build, and where it lives post-merge. If a feature branch already has a spec committed under this path (matching the issue id), treat that as the spec even if no tracker comment exists.
4. **Git-only spec store** — `.faff/specs/<issue-id>.md`. The **tracker-less fallback**: when no tracker MCP is available, faff-prep writes the spec here (there's no issue to comment on) and faff-graft reads it from here, then commits it to the feature branch under the spec-docs path as usual. Gitignored, so it stays out of the repo until graft commits it — the spec still ships with the PR. Check this location only in git-only mode — where "git-only" is concluded **per Tracker availability resolution** (a discovery attempt found no connector *and* none is pinned), **never** from the immediately-visible tool list alone. When a tracker is configured or pinned, locations 1–3 are authoritative, and a failure to read them is a loud "tracker unreachable this session" fault (see faff-graft's prep-gate), not a fall-through to this location. **In git-only mode the `<issue-id>` filename slot here is filled by the item's stable gitkey** — `/faff-plot` and `/faff-jot` mint it via `faff queue-state new-key` at creation time, so `faff queue-state derive` can diff it against the run-ledger with no other change to this rule.

**Comments are not optional.** Specs are stored in comments by default, so description-only spec discovery is invalid. Before classifying or reporting "no spec / almost ready / needs prep", fetch comments through the configured tracker's list-comments tool, autodetected from available MCP rather than hardcoded. "Comments not checked" is unacceptable: re-fetch and finish before reporting.

Never assume "no spec attached" without checking all three. Finding a spec in any location is a positive. When multiple sources exist, prefer the most recently modified one and note the discrepancy in the log.

**A description is never a spec — no exceptions.** Before any build, formalise even clear, detailed requirements through `/faff-prep` into a durable reviewable spec. No sub-skill may offer a direct description-to-build path or skip prep because the requirements are clear.

