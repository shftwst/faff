# Compact tidy housekeeping rules

Replace repeated housekeeping prose with tables and shorter procedural steps.
The slice saves 4,938 bytes; every byte outside it remains unchanged.
Eligibility, human curation, park predicates, label cleanup, stale-claim
provenance, live-status rereads, heartbeat protection and decision capture
retain their existing conditions. No CLI behaviour changes.

Independent source review found no new obligation loss. Existing predicate
and consumer tests cover mechanical rules, not model tracker acquisition or
mutation behaviour. A paired Claude Code check exercised four already-fetched
park decisions per prompt. The workers proposed tracker changes without live writes.
The existing contradictory git-only reclaim clauses are preserved; resolving
that policy ambiguity is outside this prose reduction.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Not-eligible issues are exempt from autonomous mutation (gateway → Automation` | changed: compact wording, same obligations |
| `Autonomous tidy never silently restructures human-curated structure (gateway →` | changed: compact wording, same obligations |
| `Auto-actions (applied without prompting):` | changed: compact wording, same obligations |
| `- Auto-strip dead references to cancelled/archived issues. For every active` | changed: compact wording, same obligations |
| `- Auto-canonicalise overlooked specs. When the Spec discovery rule finds a spec` | changed: compact wording, same obligations |
| `- Auto-archive dead weight: merged or cancelled issues still sitting in the` | changed: compact wording, same obligations |
| `- Auto-reparent obvious orphans: a sub-issue whose parent is Done, Cancelled,` | changed: compact wording, same obligations |
| `- Auto-remove stale faff-parked labels. Remove via faff label remove <issue>` | changed: compact wording, same obligations |
| `1. State moved on — via faff park-verdict, never a bare status check. For In` | changed: compact wording, same obligations |
| `- draft_pr — does an open DRAFT PR link to the issue? (present/absent; the` | changed: compact wording, same obligations |
| `- park_comment — class of the most-recent faff park comment: build (a mid-build` | changed: compact wording, same obligations |
| `- human_takeover — is there a human status-move to In Progress, or a human` | changed: compact wording, same obligations |
| `Then faff park-verdict --status in-progress --draft-pr <present\|absent>` | changed: compact wording, same obligations |
| `Capture (Tier-1, FAFF_RUN_DIR-guarded, per issue --issue <issue>). Wrap this` | changed: compact wording, same obligations |
| `2. Park reason no longer applies and can be cleanly verified. Read the park` | changed: compact wording, same obligations |
| `- The reason matches a pattern now forbidden by the autonomous contract (any` | changed: compact wording, same obligations |
| `- The reason cited a specific blocker issue ID and that blocker is now Done,` | changed: compact wording, same obligations |
| `- The reason cited a spec punt (Punt:, needs human, TBD, "or X if Y") and the` | changed: compact wording, same obligations |
| `3. Do not remove when the park reason is subjective ("architectural change` | changed: compact wording, same obligations |
| `For every auto-removal, log the issue id, original park reason, and the` | changed: compact wording, same obligations |
| `- Auto-clear a stale faff-awaiting-review hold. Remove via faff label remove` | changed: compact wording, same obligations |
| `- Auto-clear a stale faff-awaiting-spec-review hold. The prep-altitude twin of` | changed: compact wording, same obligations |
| `- Auto-clear a stale faff-claimed breadcrumb (backstop). Remove via faff label` | changed: compact wording, same obligations |
| `- Reclaim a stale, provably-faff In Progress claim. For each active issue at In` | changed: compact wording, same obligations |
| `1. Read claim-age — the timestamp of the latest transition into the claim` | changed: compact wording, same obligations |
| `2. Verdict — faff claim-verdict --claimed-at <claimed_at> --now <now>` | changed: compact wording, same obligations |
| `Capture (Tier-1, FAFF_RUN_DIR-guarded, per issue --issue <issue>). Wrap this` | changed: compact wording, same obligations |
| `3. stale + faff-claimed present → reclaim: move In Progress → Todo (re-reading` | changed: compact wording, same obligations |
| `4. stale + faff-claimed absent (human-set or unprovable) → surface only: log` | changed: compact wording, same obligations |
| `This is the second sanctioned In Progress → Todo backward move under the` | changed: compact wording, same obligations |
