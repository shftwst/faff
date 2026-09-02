# Faff gateway reference — tracker

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Tracker availability resolution

**The single canonical rule for deciding tracker-vs-git-only, for the whole suite.** faff-prep, faff-graft, faff-jot, faff-tidy, faff-wtf, faff-beep-boop and faff-map all branch on "is a tracker available this session?"; they reference this rule rather than each re-inferring it (a divergence in any of them is a bug, not a local override). It exists because tracker availability was inferred from the model's **immediately-visible** tool set — valid under Claude Code (the MCP surface is always listed) but wrong under a **deferred-tool harness (Codex)**, where tools are not listed until discovered, so a connected tracker reads as absent and a legitimately-prepped ticket becomes unbuildable until a human intervenes.

1. **Honour the config pin first (deterministic).** Read `tracking.tracker` via `faff tracker probe` (`pinned` | `unpinned` | `git-only`; `--json` → `{pin, resolution}`) and branch on the resolution before anything else:
   - **`pinned`** — the operator's **assertion the connector exists**: a skill **MUST NOT** downgrade to git-only merely because the tool isn't in its immediately-visible set — it discovers the connector (step 2) or fails loud (step 4).
   - **`git-only`** — the reserved `none`/`git-only` sentinel on `tracking.tracker`, the **symmetric inverse** of a connector pin: the operator asserts the repo has no tracker relationship. Resolve git-only **immediately, short-circuiting steps 2 and 4** — no discovery attempt, and a skill **MUST NOT** upgrade to tracker-mode even if a tracker MCP is visible this session. No skill creates, claims, or updates a tracker issue under this pin. All seven consuming skills inherit this outcome by reference, not a per-skill edit.
   - **`unpinned`** — neither assertion; proceed to step 2.

   The CLI is MCP-blind, so `probe` reports only this pin half; it never asserts reachability.
2. **Discover before concluding absence.** On `unpinned`, attempt to *discover* the tracker connector via the harness's tool-discovery mechanism **before** concluding git-only. The mechanism is harness-specific — Codex exposes a tool-search / catalogue step (search for the tracker's tools, e.g. `list_comments` / `get_issue`, then use them); Claude Code already lists them up front, so discovery is a no-op there. "Not immediately listed" stops being evidence of absence: git-only is concluded only when discovery genuinely finds no connector.
3. **Resolve once per entry — don't re-infer per skill, and don't cache across sessions.** Each skill resolves the mode **once on entry** and reuses that answer for the rest of its run. Within a faff-beep-boop run this is the existing **assert-once** idiom (the structural git-only signal resolved once per run and never re-sniffed per wave) — extend that same once-per-run resolution to the tracker side rather than inventing a new mechanism. Do **not** persist the resolved mode to a cross-session marker: a marker can go stale across a mid-session harness switch and re-introduce the wrong-mode bug — recompute per skill-entry, but make the discovery correct.
4. **Unreachable ≠ git-only, and ≠ "no spec".** If a tracker is pinned or configured but the connector cannot be reached this session (discovery found nothing under a pin, or a read failed), that is a **loud fault** — surface "tracker configured/pinned but connector not reachable this session" — **not** a silent drop to git-only, and **not** a false "no spec" (see faff-graft's prep-gate, which enforces this distinction).

### Spec docs location

When `/faff-graft` starts a build it commits the spec into the repo so it ships in the same PR as the code (see **Spec discovery** below and the faff-prep / faff-graft artifact lifecycle). The in-repo directory is configurable via `tracking.spec_docs_path`.

- **Default when unset:** `docs/specs/` when `docs/` exists, otherwise `doc/specs/` when `doc/` exists, otherwise create and use `docs/specs/`.
- The value is a directory **relative to the repo root**. A trailing slash is optional.
- The filename within it is unchanged: `YYYY-MM-DD-<issue-id>-<slug>-design.md`.
- This only relocates the spec **within the same repo** — the spec still lands on the feature branch and ships with the PR. It is not a pointer to a separate repository.

Every faff sub-skill that reads or writes the committed spec resolves the directory from this key, falling back to the default-resolution rule above when it's absent. The `faff config spec-docs-path [--create]` resolver applies this exact rule — sub-skills call it rather than re-deriving the path. References below to a default of `docs/specs/` are shorthand for that rule (i.e. `doc/specs/` when only `doc/` exists). Spec discovery globs `<spec-docs-path>/*-<issue-id>-*.md`.

PRDs, PRDRs, ADRs, and spikes follow the same rule through `tracking.prd_docs_path`, `tracking.prdr_docs_path`, `tracking.adr_docs_path`, and `tracking.spike_docs_path`. Their resolver commands are `faff config prd-docs-path`, `prdr-docs-path`, `adr-docs-path`, and `spike-docs-path`. The default locations remain `docs/prd/`, `docs/prdr/`, `docs/adr/`, and `docs/spikes/`; a repository can opt into another structure without changing SuperDomestique's defaults for everyone else.


### Ignore cancelled and archived

Every faff sub-skill excludes the following from every query, recommendation, count, and output:

- Cancelled issues (and any issue in the tracker's cancellation state category — see **What counts as cancelled** below)
- Archived issues
- Issues whose parent project is cancelled or archived
- Cancelled or archived projects themselves

**What counts as cancelled.** The literal "Cancelled" state name isn't the only one — trackers group multiple sibling states under a cancellation category, and all of them are treated as cancelled for faff's purposes. Detection is **category-driven first, name-based fallback**:

- **Linear** — any workflow state in the `cancelled` state category. By default this includes `Cancelled`, `Duplicate`, and any team-defined custom states placed in that category. Read the state-category field returned by the Linear MCP (state objects expose a `type` or `stateCategory` of `cancelled`); fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix` if category metadata is unavailable.
- **GitHub Issues** — closed issues with `state_reason = not_planned` (this covers closed-as-not-planned, including closed-as-duplicate).
- **Jira** — issues resolved with a cancellation-category resolution (`Won't Do`, `Duplicate`, `Cannot Reproduce`, or team-defined equivalents in the same category).
- **Other trackers** — fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix`, `Won't Do`, `Cannot Reproduce`. If the tracker exposes state categories, prefer the category-driven check.

This wider definition matters because a tidy run that suggests cancelling tickets already in Linear's Duplicate state recommends a no-op at best, and a status-signage downgrade at worst (Duplicate → Cancelled preserves the `duplicate-of` relation but loses the self-documenting status text).

No exceptions. Cancelled/archived items (across every state above) are invisible to faff — they are never surfaced in catch-ups, never flagged in tidy, never picked up by graft, never counted in beep-boop queues.

### Satisfied blockers — edges to terminal work

A `blockedBy` edge to a shipped target is a **satisfied edge**, not a live blocker — trackers never auto-remove the relation when the target completes, so a raw read over-counts open blockers and under-counts unlock value. **Rule:** in any read-side blocker computation (is-it-blocked, unlock-value counts, an outside-blocker admission test, chain-fireability, a "blocked only by the head" render), an edge to a **terminal-complete** (Done) target is satisfied — not a live/open blocker, not traversed in an unlock-value/dependency walk (the walk stops there), and the source issue is unblocked by that edge; a mixed list drops only the satisfied edges, others keep full force. **Sibling of Ignore cancelled and archived**, not the same rule — that hides the *node*, this nulls only the *edge's* force, so a Done target stays fully visible; **non-effects:** the target is never hidden/decremented, and no `blockedBy` relation is ever added/removed/rewritten (read-side only). **Detection** (category-driven, name-fallback — mirrors *What counts as cancelled*): Linear a `completed`-category state (fallback `Done`); GitHub closed `state_reason = completed` or PR merged (not `not_planned`); Jira a done-category resolution; other trackers fall back to `Done`/`Complete`/`Shipped`/`Closed-as-done`. **Unresolvable status ⇒ live** (fail-safe): under-counting is the safe direction.


### Next-step transition — consult `faff next`

The single canonical answer to *"what's the legal next step for this issue?"* is the `faff next` CLI transition function (a pure function — it has no tracker access). Every sub-skill that decides an issue's next step (faff-beep-boop queue/wave assembly, faff-prep's post-attach step, faff-graft's prep-gate, faff-tidy's readiness promotion, the interactive next-step suggestion) **consults `faff next` rather than prose-deciding** — so the base decision is deterministic and identical everywhere.

**The agent maps fetched tracker state → the flags, then calls the function** (the agent already reads all of these per the **Always pull fresh** rule — this adds no new fetch):

```
faff next --status <S> --spec none|low|medium|high [--not-eligible] [--parked] [--blocked] [--awaiting-spec-review]
```

- `--status` ← the issue's tracker state, mapped to `backlog|todo|in-progress|in-review|done|cancelled|duplicate`.
- `--spec` ← the **Spec discovery** result: `none` when no spec exists, else the spec's retained `confidence` rating (`low|medium|high`).
- `--not-eligible` ← the issue is **not automation-eligible** (gateway → **Automation eligibility**): the agent computes `faff eligible` from the issue's labels (`faff-automate` / `faff-automation-hold`) + `automation_default` + the tracker-present signal (`--tracker present|absent`, resolved from **Tracker availability resolution**), and passes `--not-eligible` when that returns `false`. (`--held` is accepted as a deprecated, fail-safe alias.) `--parked` ← the `faff-parked` label. `--blocked` ← any open **external** blocker (in-queue dependencies are **not** `--blocked` — they are serialised by faff-beep-boop's conflict analysis; nor is a satisfied edge to a terminal-complete target — gateway → **Satisfied blockers — edges to terminal work**). Resolve each blocker's live status before computing this flag. `--awaiting-spec-review` ← the `faff-awaiting-spec-review` label — a spec-review-outage hold; forces `next: prep` (re-enter at the review gate) ahead of the spec-confidence branches, since the retained confidence rating alone doesn't mean review concluded. `--parked` is checked first and still wins over the hold (a park always beats a hold; the disposition that escalates to `needs-human` already removes this label before applying `faff-parked`, so the combination is defence-in-depth, not a live case).

It prints `{next, reason}` where `next` ∈ `prep | graft | skip-ineligible | needs-human | blocked | done | none`. The mapping is computed **per-issue at the decision point**, never cached across passes.

**Advisory: `--if-eligible` (read-only hypothetical).** When a **not-eligible** item carries `--if-eligible`, `faff next` bypasses the `skip-ineligible` short-circuit and returns the route the item *would* take **if it were cranked up** (made automation-eligible), tagged `would_be_eligible: true`. It is purely advisory — never grants eligibility, never mutates, and is a no-op for an already-eligible item; terminal states (`done`/`cancelled`/`duplicate`) still win. Decision-support layers (crank-up-set proposals, the On-hold render) use it to show a not-eligible item's runway; the live `skip-ineligible` path is unchanged.

**Three hard boundaries:**
- **Reports, never executes or gates.** `faff next` says what's *legal next*; the sub-skill still runs the interactive chain-to-build gate (**faff-jot**/prep's standalone gate) and still executes the step itself. A returned `graft` is **not** consent to build.
- **Base transition, not the whole router.** `faff next` has no inputs for the diagnostic verdicts (`gap-blocked` / `circular-blocked` / `repeat-parked`); those stay in the `routing_adaptor` automation-routing computation and layer **on top** where `faff next` returns `graft` (it gates *eligibility*; the verdict gates build-queue *admission*).
- **Fail safe.** On `error` / unknown status, fall back to the sub-skill's existing prose behaviour and log it — never crash the pass. `faff next --selftest` runs the transition table.


### Re-ground before gate (gating inputs must be live)

**Always pull fresh** governs every read-and-synthesise pass; this sharpens it for the higher-stakes case of a **gate** — a point where a skill *decides whether/how to act* on an issue (eligibility · automation-routing verdict · claim-before-admit). A gate is only as fresh as its inputs: the labels + status it consumes come from a read taken **at the gate**, never an earlier same-session tool-result — else a remembered read silently overrides a human who steered the tracker between turns. Three freshness members must be live at the gate: **status** (re-read per **Issue claim & status monotonicity**) · **verdict inputs** (post-spec comments, per **Live-thread reconciliation**) · **eligibility labels** (the `faff-automate` / `faff-automation-hold` set). **Co-location:** the eligibility-label + status re-read ride on the existing claim-before-admit fetch (one fetch) where it runs; a gate upstream of any claim-before-admit site (prep's pre-spec gate, beep-boop's queue assembly) takes its own at-the-gate read. **Honest limit:** a runtime discipline, prose-enforced — **not** statically lintable (`validate-adapters` cannot prove a caller passed a fresh read vs a snapshot), consistent with the claim-monotonicity and live-thread rules and the chaining gate. The chokepoints (beep-boop, tidy, prep, graft) refer back here rather than restate it.

### Lean tracker reads (ask for only what the step consumes)

Every tracker read returns a **resident** block, re-billed as `cache_read` every later turn — so a read's cost is `size × turns-resident`, and the cheapest lever is not fetching what the step won't read. Orthogonal to **Always pull fresh** (that rule is *when* you read; this is *how much*) — a lean read is still a fresh read. Single-homed here so call sites reference it, exactly as they reference **Always pull fresh**. It shrinks what a call *returns* but cannot evict an already-resident body — same-agent prose can't delete a received tool_result, so eviction is a separate lever (subagent isolation / an out-of-context CLI). When the id is already known, prefer a single `get_issue` to a `list_issues` — one targeted object beats a filtered sweep.

- **Pass an explicit `limit`** sized to what the step consumes (never the default 50), and **order newest-first when only recent rows matter** (`orderBy: createdAt` descending) — e.g. a post-spec comment scan wants the handful of comments after the spec, not fifty in default order.
- **Never opt into an expansion you don't consume in the same step** — omit `includeRelations` / `includeReleases` / `includeCustomerNeeds` unless the expanded fields are read right there.


### Tracker as the lights-out control plane

During unattended runs (`/faff-beep-boop`) the **tracker is the complete human-legible record, control plane, and observability surface** — never a hidden internal queue. Three obligations, all already implemented by existing machinery (this section *names* them; it adds **no** new mechanism — no `faff` subcommand, no `.faffrc` key, no per-step marker subsystem, no new `.faff/` artefact):

**1. Externalise every marker-worthy step.** The meaningful pipeline transitions leave a tracker marker — a per-issue comment, a control label, a status move, or the once-per-run digest. Factory-created tickets join the **same** `Backlog` as all other work — no parallel hidden queue — and are picked up by the next tidy→prep pass. The canonical marker set (already left, distributed across the skills):

- **Spec-attach / promote** — `faff-prep` attaches the spec as a comment (with provenance stamp); promotion to Todo.
- **Park** — park comment + `faff-parked` label, via the shared **Park protocol**.
- **Resolve-attempt-proceed** — the audit-trail comment when autonomous mode infers an answer and proceeds (**Resolve-attempt before park**).
- **Appetite-override** — the `(appetite: …)` audit comment when an appetite-influenced decision ships.
- **Discovered-scope / chain-gap filing** — the `Backlog` + `faff-chain-gap-fill` ticket with its provenance line (`faff-beep-boop` step 10; `faff-tidy` chain-gaps).
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

**Comments are not optional.** Because faff-prep writes specs to comments by default, any spec-discovery pass that only inspects descriptions is **invalid output** — it will systematically miss the most common case and produce false "no spec" findings. Before classifying any issue as "no spec / almost ready / needs prep", you **must** fetch its comments via whichever tracker MCP is configured (use the tracker's list-comments tool — autodetect from the available MCP, don't hardcode). Sampling descriptions and noting "comments not checked" is **not** acceptable — re-fetch and complete the check before reporting.

Never assume "no spec attached" without checking all three. Finding a spec in any location is a positive. When multiple sources exist, prefer the most recently modified one and note the discrepancy in the log.

**A description is never a spec — no exceptions.** However clear, detailed, or well-defined a ticket's description is, it does not satisfy the spec gate and must be formalised into a spec via `/faff-prep` before any build. No faff sub-skill may offer to build straight from a description, skip prep because "the description is already clear," or treat well-defined requirements as a substitute for the spec. Well-defined is a reason prep will be *fast*, not a reason to skip it. The spec is the durable, reviewable artefact the build is gated on; the description is not.

