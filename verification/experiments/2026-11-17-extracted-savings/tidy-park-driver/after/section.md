## Autonomous Mode

When invoked autonomously (e.g. by `/faff-beep-boop` in its default full-pipeline mode), follow the shared autonomous contract (see the sibling `faff/references/autonomous.md`) and these specifics:

**Eligibility (gateway → Automation eligibility).** Skip issues without `faff-automate` for auto-actions/prep tagging: never tag `stale-spec`/`superseded-spec`, promote to Todo or change tracker-owned eligibility labels. Nonpipeline mechanical housekeeping still applies; preserve eligibility, including on reparenting.

**Human curation is authoritative (gateway, assertion 3).** Only own housekeeping is autonomous: stale faff-labels, cancelled/archived references and obvious orphans (parent Done/Cancelled/Archived). Never reprioritise/resequence/regroup/reparent human-curated structure or cancel/delete (appetite hard floor). Beyond these exceptions, surface for human decision (propose-and-confirm).

**Auto-actions (no prompting):**

| Housekeeping | Condition, action and record |
|---|---|
| Dead references | Every active issue: remove blocker, blockedBy, parent, sub-issue, related and dependency links to cancelled/archived issues. Post one tracker comment per cascade. Log the active id, dead target id and link type for each removed link. |
| Overlooked specs | Copy a **Spec discovery**-found noncanonical spec to the issue tracker comment, or configured spec-docs path (default `docs/specs/…`) if its feature branch exists; log. Todo without a spec at any discovery location: demote to Backlog; log "broken prep gate — no spec found". Never invoke `/faff-prep`; `/faff-beep-boop` owns the default full-pipeline prep queue. |
| Dead weight | Archive/close merged/cancelled backlog issues as tracker supports. |
| Obvious orphans | Parent Done/Cancelled/Archived: reparent to grandparent if present, else unlink parent. |

**Stale `faff-parked`.** Use `faff label remove <issue> faff-parked` and descriptor write (gateway → **Control-label provisioning**) only on either basis below.

1. **State moved on: `faff park-verdict`, never status alone.** `strip-ok`: In Review/Done/Cancelled/Archived; `n/a`: below In Progress. For In Progress, fetch tracker facts:
   - `draft_pr`: linked open DRAFT PR, `present`/`absent`.
   - `park_comment`: most-recent faff park comment, `build` (mid-build, blocked-on-external or resume-preserved), `nonbuild` (prep punt, low-confidence, gap or cycle), or `none`.
   - `human_takeover`: `true` if, after that park comment, a human moved the issue to In Progress or posted a non-faff comment. Otherwise `false`.

   Run `faff park-verdict --status in-progress --draft-pr <present|absent> --park-comment <build|nonbuild|none> --human-takeover <true|false>`; never re-derive its predicate. `strip-ok`: remove; `protect`: retain and log "valid mid-build park, label retained"; `surface`: retain and log "stale park label — needs human" for `/faff-wtf`. Live mid-build parks retain eligibility guard (`faff next --parked` ⇒ `needs-human`).

   **Capture:** Tier-1, `FAFF_RUN_DIR`-guarded, per issue `--issue <issue>`, best-effort, never gating; no run dir (standalone interactive tidy) mints nothing. Run `eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel park-verdict --export)" && faff park-verdict …` in one command. After label disposition, emit `faff decision-capture action --run <run> --issue <issue> --kernel park-verdict --action strip-ok|protect|surface` for the actual branch, never a re-emitted verdict.
2. **Reason no longer applies:** read tracker comment or `.faff/runs/<run-id>/ISSUE-XX/park.md`; exactly one basis must hold:
   - Autonomous-contract forbidden pattern: session compaction, context length, too-many-turns, topic-keyword match on a spec-closed decision, or edits taking effect only after merge (`netlify.toml`, `.github/workflows/*.yml`, `Dockerfile`, `package.json` dep bumps, IaC or migration SQL not executed pre-merge). Clear without prompting.
   - The park reason names a blocker issue ID. Live-fetch it and confirm Done/Merged/Cancelled.
   - Cited spec punt (`Punt:`, `needs human`, `TBD`, "or X if Y") now closed on the same topic by `Chosen:`/`Decision:` under the gateway Spec-readiness contract.
3. **Subjective/vague/missing reason** ("architectural change needed", "scope unclear"): retain; log "stale park label — needs human" for `/faff-wtf`.

Every auto-removal: log issue id, original reason and specific invalidating rule to `.faff/logs/YYYY-MM-DD/HHMMSS-tidy.md`; post tracker comment explaining removal and reason.

**State-only label cleanup.** No reason parsing/no-longer-applies branch. Use descriptor write; log each removal. Preserve live In Progress claim provenance.

| Label and removal command | Resolved states | Orphaned resume cleanup |
|---|---|---|
| `faff label remove <issue> faff-awaiting-review` | In Review, Done, Cancelled | Remove `.faff/resume/<issue>/` if present. |
| `faff label remove <issue> faff-awaiting-spec-review` | Off Backlog: Todo, In Progress, In Review, Done, Cancelled | Remove `.faff/resume/<issue>/spec-review-hold.json` if present, or whole `.faff/resume/<issue>/` only if otherwise empty; never `.faff/spec-review/<issue>/` convergence-window scratch. |
| `faff label remove <issue> faff-claimed` | No longer In Progress: In Review, Done, Cancelled | None. Backstop graft's terminal/retry-later breadcrumb clear. |

**Stale claim reclaim.** Each active In Progress issue: tidy reads tracker facts; CLI decides liveness.

1. `claimed_at`: latest transition into In Progress. Linear: latest matching `get_issue.stateHistory` entry's `startedAt`; GitHub: latest claim timeline event's `created_at`; Jira: latest claim-state changelog transition. Never Linear's issue-level `startedAt`: retry-later's In Progress → Todo → In Progress does not reset it. Connector no-capability: surface; log "stale-claim check unavailable on <connector>", continue; never guess/default age.
2. Run `faff claim-verdict --claimed-at <claimed_at> --now <now> --ttl-hours $(faff config get claim_ttl_hours)`. `live`: do nothing. `stale` without `faff-claimed`: leave status untouched, log "stale claim, no `faff-claimed`, needs human"; human-set/unprovable claims are surface-only.
3. Only `stale` + `faff-claimed`: re-read live status immediately before write; move In Progress → Todo, `faff label remove <issue> faff-claimed`, then `faff build-claim release-if-stale --issue <issue>` (best-effort, always exit 0). Lease-matched-delete `refs/faff/build-claims/<issue>` only if its holder is stale under machine-aware, heartbeat-only `buildClaimStaleAware`; live heartbeating builds retain the ref even with hours-stale tracker age. Never acquire a build claim. The ref, not rebase-before-merge, is the mutex: live peers still refuse Step-5 acquire; re-queue for next pass only.
4. After reclaim, post one tracker comment: "reclaimed a `faff-claimed` stale claim (age > `claim_ttl_hours`); released the build-claim ref; moved to Todo for re-queue". Log `{issue, age_secs, ttl_secs, ref_released, action: reclaimed}` using actual release result. **git-only mode:** tracker/label writes no-op, but `faff build-claim release-if-stale` still runs; the ref on `origin` is its only cross-host claim.

**Claim capture:** same Tier-1 guards/best-effort/no-mint rules as park capture. Run `eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel claim-verdict --export)" && faff claim-verdict …` in one command. After actual disposition, emit `faff decision-capture action --run <run> --issue <issue> --kernel claim-verdict --action live` (left the claim) or `--action stale` (reclaimed at step 3).

Second sanctioned In Progress → Todo backward move (gateway **Issue claim & status monotonicity**), fenced to In Progress + `stale` + `faff-claimed`; never touch In Review/Done. **git-only mode:** no reclaim path (no shared tracker; same-host is covered by the local heartbeat). Distinct from the merge-time governance **anchor** git-evidence check.

