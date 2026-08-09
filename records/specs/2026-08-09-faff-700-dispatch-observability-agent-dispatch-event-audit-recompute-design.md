# Making subagent fan-out observable — a dispatch-claim event plus an audit-time recompute (FAFF-700)

> Spec: faffter-dark-nlspec · 2026-08-06 · interactive · confidence: high · spec-review: approve. Full spec on Linear FAFF-700.

_Revised on 2026-08-06 — re-prep supersedes the 2026-08-05 spec (parked twice as needs-human). Incorporates the human resolution of the same date, closing both blockers: (1) **Chosen — build the Claude-side slice now**, do not fold into the unbuilt FAFF-483 (Codex-side deferred to a follow-up child that carries the FAFF-483 blocker); (2) **Chosen — per-cluster attribution required**: `verified` needs each subagent cluster matched via its child's `agent-*.meta.json` description token, the totals-only path reports `unverifiable-substrate` never `verified`, so a mixed run where one cluster left zero children can't report clean (new mixed-kind scenario added). Spec-review (revise→approve) then closed an infosec-major: the non-leak rule was mis-grounded on events.js:173 (a nested `data.tokens` check, not a top-level allowlist) — reframed as a NEW top-level `data.*` allow-set enumerated in full `{kind, dispatch_id, cluster_id, cluster_size, tokens, tokens_source, effort, gate, rework_turns}`; plus exact `subagent-cluster:<id>` token matching namespaced off the economics issue-id read of the same `description` field, and a re-dispatch scenario. Terminology (this pass): `cohort` → **subagent cluster** (fields `cluster_id`/`cluster_size`, stamp token `subagent-cluster:<id>`) — pure rename, no design change._

This spec is for the build agent and for human reviewers. It revises the earlier full spec (confidence: medium, parked twice as needs-human) now that a human has settled the two blocking objections: build the Claude-side slice now rather than folding it into the unbuilt FAFF-483, and require per-cluster attribution before any run may report a clean fan-out. Everything load-bearing is here; the two settled decisions are marked `**Chosen:**` in place.

## 1. WHY — Problem and Principles

**The load-bearing model: a run claims its fan-out in the event stream, and the audit re-derives whether that fan-out actually happened from the child transcripts on disk.** A dispatch is a *claim* ("I fanned out a **subagent cluster** of N readers") written as an event when the orchestrator dispatches. The trust does not come from that claim — it comes from `faff audit` walking the child `agent-*.jsonl` transcripts the run owns and counting how many really landed, per subagent cluster, then comparing. Observability is the gap between the two.

**Problem.** faff leans on subagent fan-out in load-bearing places — the spec producer, the review lenses, the audit's three isolated reader clusters — but under the FAFF-694 Codex / GPT-5.6-sol run nobody could tell whether any fan-out happened: opaque handles, "No agents completed yet" lines, a review pass that was really plain `review-call.mjs` subprocesses, and a committed `audit-report.json` asserting three reader contexts "complete" while the transcript showed the main agent reading centrally. This change makes Claude-native fan-out observable: the orchestrator emits a dispatch-claim event, and the audit recomputes it against the child transcripts so a "we isolated the readers" claim is checkable rather than taken on faith.

**Design principles.**

**Prove, don't trust.** A deliverable that requires isolation — an adversarial review, a code-blind reader — is only trustworthy if the isolation is observable after the fact. The event is the claim; the audit recompute is the proof. Never treat the self-reported cluster_size as the verified count.

**Honest about substrate.** The recompute reaches for child transcripts that may not be present (wrong session, missing dir, a substrate that does not expose child transcripts at all). When it cannot attribute a cluster's children, it must say so — `unverifiable-substrate`, never a silent pass folded into a clean result. A "can't tell" is a first-class outcome, distinct from both "verified" and "mismatch."

**Non-leak.** The dispatch event carries counts and ids only — never any prompt or response payload from the dispatched child. The event vocabulary enforces a closed **top-level** `data.*` field set (a *new* validator allow-set — see §4 Seam 1; there is no in-file precedent for a top-level `data`-key allowlist), so non-leak is enforced by the validator rather than merely asserted in prose.

**Reference context.** The implementation extends existing seams; it introduces no new subsystem.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governance-profile.js` | JS | `DELIVERY_PROFILE.event_types` closed vocab (~69); `agent-dispatch` is added here |
| `plugin/skills/faff/bin/lib/events.js` | JS | `eventViolations` (~113); closed-vocab + non-leak precedents (`data.tokens` unexpected-field reject ~173, `data.effort` ~191, `data.gate` ~201) |
| `plugin/skills/faff/bin/lib/budget.js` | JS | `transcriptBaseDir` (~419), `childOwningSession` (~486), `sessionOwnedTranscriptFiles` (~517) — the child-transcript primitives |
| `plugin/skills/faff/bin/lib/economics.js` | JS | `attributePerIssueCosts` (~129) reads each owned child's sibling `agent-*.meta.json` `description` and matches an id — the per-cluster matching precedent |
| `plugin/skills/faff/bin/lib/audit.js` | JS | `containment-check` (~166) / `self-intake-check` (~193) recomputes — the "record a claim, re-derive it" precedent; the new `dispatch_observability` block lands in the coherence region (~214) |
| `verification/audits/tools/faff-435/validate-report.mjs` | JS (ESM) | `computeAggregate` (~13) checks `reader_contexts` shape only; tighten to the FAFF-435 §4 per-context fields |

**Scope.** This is the Claude-native observability slice of the harness-agnostic runtime work (parent FAFF-694). It stands alone: the event, the recompute, and the validator tightening all build on shipped seams with no dependency on the unbuilt FAFF-483.

### Already shipped against this surface

The premise holds. FAFF-482 (child-transcript ownership attribution), FAFF-477 (session-owned transcript files), and FAFF-592 (audit coherence sub-report) are Done — the `childOwningSession`/`sessionOwnedTranscriptFiles` ownership gate and the audit's coherence block already exist and are the seams this extends. Nothing here re-litigates them.

## 2. OUT OF SCOPE

- **Codex-side fan-out observability** — *Why excluded:* Codex/GPT does not expose child transcripts the way `sessionOwnedTranscriptFiles` reads them, so the recompute cannot attribute clusters under Codex without a substrate shim that does not yet exist. *Extension point:* a Codex-side follow-up child of FAFF-694 that carries `blockedBy FAFF-483` (that child, not this ticket, holds the FAFF-483 dependency); it teaches the recompute a Codex transcript reader and reuses this ticket's classification unchanged.
- **Changing how dispatch happens** — *Why excluded:* this observes fan-out; it does not alter the Agent-tool call, the number of subagents, or the concurrency model. *Extension point:* the concurrency skills (`faffter-dark-concurrency-parallel`).
- **A live/streaming dispatch dashboard** — *Why excluded:* the deliverable is an after-the-fact audit recompute, not a during-run monitor. *Extension point:* a future runcheck/heartbeat surface.
- **Verifying the *content* of what a subagent did** — *Why excluded:* this counts that N isolated children ran and were attributable to their cluster; it does not judge whether their output was correct or genuinely code-blind. *Extension point:* the review-lens quality gates.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| dispatch (claim) | One orchestrator fan-out of a subagent cluster, recorded as an `agent-dispatch` event before the children run |
| subagent cluster (**cluster** for short) | A named group of same-kind subagents dispatched together in one fan-out (e.g. the three reader contexts); identified by `cluster_id`. "Cluster" is used in-context throughout once introduced here. |
| attribution | Matching an owned child `agent-*.jsonl` transcript back to its cluster via the id carried in its sibling `agent-*.meta.json` `description` |
| observed count | Per cluster, the number of *distinct* owned children attributable to that cluster by its id |
| substrate | The child-transcript source the recompute reads (`transcriptBaseDir` + the ambient session id); may be reachable or not |

**The event.** A new closed-vocab event type, `agent-dispatch`, added to `DELIVERY_PROFILE.event_types` (NOT to `issue_scoped_types` — a dispatch is run-scoped, not tied to one issue). Its `data` is a closed field set:

```
EVENT agent-dispatch:            # run-scoped; one per cluster fan-out
  data.kind: enum                # producer | build | reader | verify
  data.dispatch_id: string       # unique per fan-out call
  data.cluster_id: string         # groups children of one cluster; stamped into child descriptions
  data.cluster_size: integer      # >= 1; the CLAIMED number of children in this cluster

  CONSTRAINT data.* carries no key outside this closed set (plus the pre-existing
             global-optional telemetry tags), and no prompt/response payload  # non-leak
```

**The audit records.** The recompute writes a `dispatch_observability` block into the audit coherence sub-report:

```
RECORD DispatchObservability:
  status: enum                   # verified | mismatch | unverifiable-substrate | absent
  substrate_reachable: boolean   # false ⇒ transcript dir / session id unavailable
  clusters: List<ClusterResult>

RECORD ClusterResult:
  cluster_id: string
  kind: enum                     # producer | build | reader | verify (from the event)
  claimed: integer               # cluster_size from the dispatch event
  observed: integer | null       # distinct attributed children; NULL when this cluster is unattributable
  status: enum                   # verified | mismatch | unverifiable-substrate
```

**Classification rule.** Per cluster, then overall:

- A cluster is **verified** only when it is attributed per-cluster (at least one owned child carries this `cluster_id` in its meta.json description) AND `observed >= claimed`.
- A cluster is **mismatch** when it is attributed per-cluster but `observed < claimed` — children were promised and fewer landed.
- A cluster is **unverifiable-substrate** when it cannot be attributed per-cluster at all: the substrate is unreachable, or no owned child's description carries this `cluster_id` (the totals-only path). `observed` is `null`.
- Overall status is **verified** only if EVERY cluster is verified. If any cluster is mismatch, overall is **mismatch**. Otherwise (some clusters unverifiable, none mismatched) overall is **unverifiable-substrate**. A run with no `agent-dispatch` events at all is **absent** — nothing was claimed, so there is nothing to verify (not a failure).

The consequence the human asked for: a run mixing a reader cluster and a build cluster, where one cluster left zero attributable children, can never report `verified`. That cluster is mismatch or unverifiable, and one non-verified cluster forecloses an overall `verified`.

**Design decisions.**

**New event type vs. reusing `build-start`.** `build-start` is issue-scoped and already carries build semantics; overloading it to also mean "a cluster fanned out" would conflate two unrelated claims and break the issue-scoped vocabulary. A dedicated run-scoped type keeps the dispatch claim clean and lets the recompute filter on `type === "agent-dispatch"` exactly as it filters `containment-check`. **Chosen:** a new `agent-dispatch` event type, added to `event_types` only.

**Where the trust lives.** The event could be treated as self-attesting (the orchestrator says it dispatched three, so it dispatched three). That is precisely the failure FAFF-694 exposed — a report can assert "complete" while the work happened centrally. The trust must come from re-derivation, not the claim. **Chosen:** the deliverable is the audit-time recompute over the child transcripts; the event is only the claim it checks against.

**Attribution: per-cluster matching vs. a totals floor.** The earlier spec chose a v1 totals comparison (`observed_total >= sum(claimed)`) and deferred per-cluster matching. That admits a false all-clear: a run with a reader cluster of 3 and a build cluster of 3 where the readers actually ran 6 children and the build ran 0 satisfies the totals floor (6 >= 6) yet the build cluster was never isolated. Per-cluster matching is already precedented — `attributePerIssueCosts` reads each owned child's sibling `agent-*.meta.json` `description` and matches an id off it. **Chosen:** per-cluster matching required; a cluster with no per-cluster attribution reports `unverifiable-substrate`, never folded into a `verified`. The totals-only floor is dropped.

**What a `verified` result actually asserts.** The recompute reads transcripts from `transcriptBaseDir` (`$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>`) keyed on the ambient `$CLAUDE_CODE_SESSION_ID` — a directory *outside* the run dir and an environment value not committed with the run. So a `verified` is not re-derivable from the committed run dir alone. **Chosen:** a `verified` written into a committed `audit-report.json` is scoped as an observation-at-audit-time, not a run-dir-pure fact; the block records `substrate_reachable` so a later reader can see the observation depended on ambient state. This matches audit.js's existing degrade posture (attribute what you can reach, undercount rather than overcount).

**The FAFF-435 reader-contexts leg.** The `audit-report.json` that triggered this ticket asserted three reader contexts "complete," and the FAFF-435 validator (`validate-report.mjs` `computeAggregate`) only checks their *shape* (`length === 3`, unique ids) — it never checks that each context recorded the FAFF-435 §4 per-context invocation-id + digest that would evidence an isolated invocation. Shape-only is exactly how a central read passes as three isolated reads. **Chosen:** tighten `computeAggregate` to require, per reader context, the FAFF-435 §4 invocation-id + digest fields, so the "three isolated clusters" claim is itself checkable.

## 4. HOW — Behavior

Three seams, buildable in order: the event vocabulary and its validation; the orchestrator stamp side (emit the event + stamp cluster ids into child descriptions); the audit recompute that consumes both. The validator tightening is independent of the other two and can land in any order.

### Seam 1 — event vocabulary + validation (`governance-profile.js`, `events.js`)

Add `"agent-dispatch"` to `DELIVERY_PROFILE.event_types` (not `issue_scoped_types`). In `eventViolations`, add an `agent-dispatch` branch mirroring the existing closed-vocab and non-leak checks:

```
IN eventViolations(obj, requireEnvelope, profile):
  WHEN obj.type == "agent-dispatch":
    1. data.kind MUST be a string in {producer, build, reader, verify}   # mirrors data.effort vs EFFORT_LEVELS
    2. data.dispatch_id MUST be a non-empty string
    3. data.cluster_id MUST be a non-empty string
    4. data.cluster_size MUST be an integer >= 1
    5. REJECT any TOP-LEVEL data.* key outside the ENUMERATED allow-set:
       the four dispatch fields {kind, dispatch_id, cluster_id, cluster_size}
       PLUS the existing global-optional telemetry keys, enumerated in full:
       {tokens, tokens_source, effort, gate, rework_turns}.
       Any other top-level data key (e.g. data.prompt, data.transcript) is a violation.
```

**This top-level `data.*` allow-set is NEW validation work — there is NO in-file precedent for it, and the spec must not point the build agent at one.** The `data.tokens` "unexpected field(s)" reject at events.js:173 is a *nested* sub-key check *inside* the `data.tokens` object (it scans `Object.keys(data.tokens)` against the token-delta classes), and the `effort` / `gate` / `tokens` checks are each presence-gated (`"x" in obj.data`) — so today an unrecognised **top-level** `data` key is silently ignored. That silent-ignore is exactly why non-leak needs its own explicit top-level allow-set here: without it a stray `data.prompt` / `data.transcript` passes clean and the non-leak boundary is fail-open. Reuse the *style* of the events.js:173 "unexpected field(s)" message, but the top-level scan and the enumerated allow-set above are the new, load-bearing part — and the allow-set MUST include all five telemetry keys, or a valid `tokens_source`/`effort`/`gate`/`rework_turns`-tagged dispatch event is wrongly rejected. The `data.kind` closed-vocab check still follows the `data.effort` / `data.gate` pattern (guard `typeof === "string"` first so a non-string yields an honest message).

**Anti-pattern:** adding `agent-dispatch` to `issue_scoped_types`. Why: a dispatch is run-scoped; forcing an `issue` field would make every fan-out event that isn't inside a single-issue build fail validation.

**Anti-pattern:** widening the schema (bumping `schema` past 2 or adding a top-level envelope field). Why: this is additive under `data`, exactly like the token/effort/gate tags; the envelope is untouched.

### Seam 2 — the stamp side (orchestrator dispatch prose, gateway Producer-dispatch section)

Two obligations on the orchestrator when it fans out a cluster — both are prose instructions in the dispatch skill, the same way the FAFF-435 reader-contexts leg is prose:

1. **Emit the claim.** Before the fan-out, emit one `agent-dispatch` event with `kind`, a fresh `dispatch_id`, the `cluster_id`, and `cluster_size` = the number of children about to be dispatched.
2. **Stamp the cluster id into each child.** Put a namespaced, delimited token `subagent-cluster:<cluster_id>` INTO each dispatched child's `description` — the Agent-tool label that lands in that child's `agent-*.meta.json` `description`. This is the new load-bearing requirement: without it the recompute has no per-cluster key to match on, and the cluster degrades to `unverifiable-substrate`. The `subagent-cluster:` prefix is load-bearing: `economicsAttributeIssue` reads an `[A-Z]+-\d+` issue-id token from the *same* `description` field, so the field is multiplexed between two matchers — the prefix (plus the exact-token match on the read side) keeps a `cluster_id` from ever colliding with issue-id syntax and perturbing economics attribution. Constraint on `cluster_id`: it must not itself contain the `subagent-cluster:` delimiter or match `[A-Z]+-\d+`.

```
PROCEDURE dispatch_cluster(kind, children):
  1. cluster_id  := fresh id
  2. dispatch_id := fresh id
  3. Emit agent-dispatch { kind, dispatch_id, cluster_id, cluster_size: len(children) }
  4. FOR each child: set its description to include the token `subagent-cluster:<cluster_id>`   # lands in agent-*.meta.json
  5. Fan out the children via the Agent tool
```

**Anti-pattern:** emitting the event but not stamping the description. Why: it produces a claim the recompute can never attribute — every such cluster reports `unverifiable-substrate`, which reads as "the harness can't see fan-out" and defeats the whole point.

### Seam 3 — the audit recompute (`audit.js`, into the coherence region ~214)

A new block alongside `containment_mismatches` / `self_intake_mismatches`, following the same record-a-claim / re-derive-it shape:

```
PROCEDURE recompute_dispatch_observability(events, cwd, env):
  1. dispatches := events WHERE type == "agent-dispatch"       # malformed lines already in malformed_event_lines
  2. IF dispatches is empty: RETURN { status: "absent", substrate_reachable: <n/a>, clusters: [] }
  3. base := transcriptBaseDir(cwd, env);  sid := env.CLAUDE_CODE_SESSION_ID
     IF base or sid unavailable:
        RETURN { status: "unverifiable-substrate", substrate_reachable: false,
                 clusters: [ per dispatch: { cluster_id, kind, claimed, observed: null, status: "unverifiable-substrate" } ] }
  4. owned := every agent-*.jsonl in base WHERE childOwningSession(file) == sid   # FAFF-229 ownership gate
     FOR each owned child: read sibling agent-*.meta.json description
  5. FOR each cluster (group dispatches by cluster_id):
        claimed  := cluster_size
        observed := count of DISTINCT owned children (distinct by agent-*.jsonl transcript / agent id)
                    whose meta.json description contains the EXACT delimited token `subagent-cluster:<cluster_id>`
                    — exact-token match, never substring, so cluster "R1" never cross-counts "R12" or a UUID
        IF observed == 0 (no per-cluster attribution):   cluster.status := "unverifiable-substrate"; cluster.observed := null
        ELSE IF observed >= claimed:                     cluster.status := "verified"
        ELSE:                                            cluster.status := "mismatch"
  6. overall :=
        "verified"              IF every cluster verified
        "mismatch"              ELSE IF any cluster mismatch
        "unverifiable-substrate" OTHERWISE
     RETURN { status: overall, substrate_reachable: true, clusters }
```

The per-cluster key match reuses the `attributePerIssueCosts` read (the sibling `agent-*.meta.json` `description`), extended to also carry the namespaced `subagent-cluster:<cluster_id>` token alongside any issue id — the two matchers coexist on the multiplexed field because the `subagent-cluster:` prefix and exact-token matching keep them disjoint (a `cluster_id` can never be read as an issue id, nor vice versa). Attribution is by session ownership (`childOwningSession === sid`), never by mtime — mtime is at most a cheap pre-filter, consistent with `sessionOwnedTranscriptFiles`.

**Edge cases and error handling.**

- **A malformed `agent-dispatch` line** — already collected into `malformed_event_lines` by the events read; the recompute filters on well-formed events only, so a corrupt line surfaces there and does not crash the recompute.
- **Two dispatches sharing a `cluster_id`** — treat as one cluster; `claimed` is the sum of their `cluster_size` (a re-dispatch after a partial failure). Attribution counts distinct children across both.
- **A child owned by the run but carrying no cluster id** — it simply matches no cluster; it does not inflate any `observed`. Undercount, never overcount.
- **Substrate reachable but a specific cluster has zero attributable children** — that cluster is `unverifiable-substrate` (observed null), not `mismatch` — "can't see it" differs from "saw fewer than claimed." A cluster only reports `mismatch` when it has at least one attributed child yet fewer than claimed.

**Failure modes — how the approach falls over, and how you'd notice.**

- **The failure:** the description stamp is the single point the whole recompute hinges on; if the dispatch skill emits events but the stamp instruction is not followed (or a substrate rewrites descriptions), every cluster reports `unverifiable-substrate` and the audit looks like it can't see fan-out even when fan-out happened. **How you'd know:** the acceptance run with a genuine reader cluster reports `unverifiable-substrate` instead of `verified`; `substrate_reachable` is true but every `observed` is null. **What it means:** narrow — the stamp side (Seam 2), not the recompute, is broken; fix the description stamp before trusting any `verified`.
- **The failure:** a `verified` is read later as a durable fact even though it depended on ambient session state outside the run dir. **How you'd know:** re-running `faff audit` on the committed run dir alone (different session, cleared transcript dir) flips `verified` → `unverifiable-substrate`. **What it means:** proceed — this is expected and is why the block records `substrate_reachable` and why the decision scopes `verified` as an observation-at-audit-time, not a run-dir-pure fact.

### Validator tightening (`validate-report.mjs`, independent)

`computeAggregate` currently gates `reader_contexts` on `length === 3` and unique ids only. Tighten it so each reader context must also carry the FAFF-435 §4 per-context fields (an invocation-id and a digest); a context missing either fails the aggregate to `audit-incomplete`, exactly as a missing gate row does today. Extend the `selftest` fixtures with a case that has three well-shaped ids but missing per-context fields and asserts `audit-incomplete`.

**Anti-pattern:** loosening the existing shape checks while adding the field checks. Why: the shape checks (three unique ids) are still necessary; the field checks are additive on top.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run that dispatches a reader cluster of 3, stamps each child's description with the cluster_id, and all 3 children run
When faff audit recomputes dispatch_observability
Then the reader cluster reports observed 3, claimed 3, status verified — and overall status is verified
```

```
Given a run that dispatches a reader cluster claiming cluster_size 3 but only 2 attributable children ran
When faff audit recomputes dispatch_observability
Then the cluster reports observed 2, claimed 3, status mismatch — and overall status is mismatch
```

```
Given a run whose substrate does not expose child transcripts (session id / transcript dir unavailable)
When faff audit recomputes dispatch_observability
Then every cluster reports observed null, status unverifiable-substrate, substrate_reachable false — never verified, never mismatch
```

```
Given two agent-dispatch events sharing cluster_id "R1" (cluster_size 2 then 1 — a re-dispatch after a partial fan-out) and 3 distinct children stamped `subagent-cluster:R1` on disk
When faff audit recomputes dispatch_observability
Then cluster R1 reports claimed 3 (2+1 summed), observed 3, status verified
```

- An `agent-dispatch` event carrying an unexpected `data.transcript` key is rejected by `eventViolations` with an "unexpected field(s)" message mirroring the `data.tokens` reject.
- A run that legitimately did no fan-out (no `agent-dispatch` events) reports status `absent`, not a failure.

## 6. Design Decision Rationale

**Should this build now, or fold into FAFF-483?** FAFF-483 is still Todo/unbuilt. Folding this in would strand standalone-shippable value behind an interface that does not exist yet. The event, the recompute, and the validator tightening all build on shipped seams (`events.js`, `audit.js`, `budget.js`, `governance-profile.js`, `validate-report.mjs`) with zero FAFF-483 dependency and deliver observable Claude-native fan-out on their own. The human settled this: build the Claude-side slice now, defer only the Codex-side reader to a follow-up child that carries the FAFF-483 blocker. (See §7.)

**Per-cluster matching vs. the totals floor.** The totals floor was rejected because it admits a documented false all-clear (readers over-run masks a build cluster that never isolated). Per-cluster matching costs no new machinery — it reuses the meta.json-description read that `attributePerIssueCosts` already performs. The only new obligation is the stamp side putting the cluster id where the recompute can read it. (See §3, §4 Seam 2.)

**Why `unverifiable-substrate` is a distinct outcome, not a pass or a fail.** Collapsing "can't see the children" into `verified` is the original bug; collapsing it into `mismatch` would cry wolf on every substrate that doesn't expose transcripts (including Codex today). A three-way outcome keeps the honest-about-substrate principle intact and lets the Codex follow-up light up `verified` later without changing the classification. (See §3.)

**Why the event is run-scoped.** A fan-out is not tied to a single issue (the audit's reader clusters span the whole run), so `issue_scoped_types` membership would be wrong and would force a spurious `issue` field. (See §3, §4 Seam 1.)

## 7. Open Questions and Assumptions

**Open Questions.** None. Both prior blockers are settled:

**Chosen:** build the Claude-side slice now; do NOT fold into FAFF-483. The event + the `faff audit` recompute over `agent-*.jsonl` + the `validate-report.mjs` tightening all build on existing seams with zero FAFF-483 dependency and ship observable Claude-native fan-out standalone. Codex-side observability is out of scope here (§2), deferred to a Codex-side follow-up child of FAFF-694 that carries `blockedBy FAFF-483` — that child, not this ticket, holds the FAFF-483 dependency.

**Assumptions.**

**Assumes:** FAFF-483 provides the Codex-side transcript substrate — for the Codex extension only. This ticket does not depend on it; the assumption is named so the follow-up child knows where the Codex reader plugs in. *Validation:* the build agent confirms no code in this ticket imports or calls any FAFF-483 interface; the recompute reads only `transcriptBaseDir`/`childOwningSession`, which are shipped. If any FAFF-483 symbol is reached for, stop — the slice has leaked out of scope.

## 8. DONE — Definition of Done

### From WHY
- [ ] After a Claude-native reader fan-out, `faff audit` reports a `dispatch_observability` block whose reader cluster is `verified` — a fan-out claim is now checkable, not taken on faith.

### From WHAT (vocabulary + event)
- [ ] `agent-dispatch` is in `DELIVERY_PROFILE.event_types` and NOT in `issue_scoped_types`.
- [ ] An `agent-dispatch` event validates only with `data.kind ∈ {producer, build, reader, verify}`, non-empty `data.dispatch_id`, non-empty `data.cluster_id`, and integer `data.cluster_size >= 1`.
- [ ] `eventViolations` rejects any TOP-LEVEL `data.*` key on an `agent-dispatch` event outside the enumerated allow-set `{kind, dispatch_id, cluster_id, cluster_size, tokens, tokens_source, effort, gate, rework_turns}` — a NEW top-level scan (no in-file precedent; events.js:173 is a nested `data.tokens` sub-key check), so a stray `data.prompt`/`data.transcript` is rejected while a valid telemetry-tagged dispatch event passes.
- [ ] `DispatchObservability` and `ClusterResult` match the defined shapes; `ClusterResult.observed` is the distinct-attributed-children count and is `null` when the cluster is unattributable.

### From HOW (classification)
- [ ] Overall status is `verified` only when EVERY cluster is `verified` (per-cluster attributed with observed >= claimed).
- [ ] A cluster with no per-cluster attribution reports `unverifiable-substrate` (observed null), never folded into a `verified`.
- [ ] A cluster attributed but with observed < claimed reports `mismatch`.
- [ ] A run with no `agent-dispatch` events reports `absent`.
- [ ] A mixed-kind run (reader cluster present + build cluster with zero attributable children) reports the build cluster as unverifiable/mismatch and overall NOT `verified`.

### From HOW (stamp side)
- [ ] The dispatch skill emits one `agent-dispatch` event per cluster before the fan-out, and stamps the namespaced token `subagent-cluster:<cluster_id>` into each dispatched child's `description` so it lands in `agent-*.meta.json`.

### From HOW (recompute)
- [ ] The recompute attributes children by `childOwningSession === sid` (session ownership), matching the EXACT delimited token `subagent-cluster:<cluster_id>` off each child's sibling `agent-*.meta.json` `description` (never substring; distinct by transcript/agent id); mtime is at most a pre-filter. The `subagent-cluster:` prefix keeps the token disjoint from the `[A-Z]+-\d+` issue-id token `economicsAttributeIssue` reads from the same field.
- [ ] Two `agent-dispatch` events sharing a `cluster_id` sum their `cluster_size` into one cluster's `claimed`, and the cluster's children are counted by exact `subagent-cluster:<id>` token match.
- [ ] The recompute records `substrate_reachable`, and a `verified` is scoped in the block as an observation-at-audit-time, not a run-dir-pure fact.

### From HOW (validator tightening)
- [ ] `computeAggregate` fails a `reader_contexts` entry to `audit-incomplete` when it lacks the FAFF-435 §4 per-context invocation-id or digest, with a `selftest` case covering it.

### Integration smoke test

```
PROCEDURE smoke():
  1. In a scratch run, dispatch a reader cluster of 2 with descriptions stamped cluster_id="R1"
  2. Emit agent-dispatch { kind: reader, dispatch_id, cluster_id: "R1", cluster_size: 2 }
  3. Let the 2 children run (owned by this session)
  4. Run faff audit; read the dispatch_observability block
  5. ASSERT cluster R1: observed 2, claimed 2, status verified; overall verified; substrate_reachable true
```

If this one path works, the event mint, the description stamp, the ownership attribution, and the recompute are all connected.

## Appendix A — Worked classification table (per-cluster semantics)

| Clusters (claimed → attributed children) | Substrate | Per-cluster result | Overall |
|---|---|---|---|
| reader 3 → 3 | reachable | reader: verified | **verified** |
| reader 3 → 2 | reachable | reader: mismatch | **mismatch** |
| reader 3 → 3; build 2 → 0 | reachable | reader: verified; build: unverifiable-substrate | **NOT verified** (unverifiable-substrate) |
| reader 3 → 2; build 2 → 0 | reachable | reader: mismatch; build: unverifiable-substrate | **mismatch** |
| any | unreachable | all: unverifiable-substrate (observed null) | **unverifiable-substrate** |
| (no agent-dispatch events) | — | — | **absent** |

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }
  ] }
```
