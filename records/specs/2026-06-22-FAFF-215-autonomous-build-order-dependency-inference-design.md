# Spec — FAFF-215: Autonomous build-order dependency inference

> Spec: faffter-dark-nlspec · 2026-06-22 · interactive · confidence: high. Full spec on Linear FAFF-215.

> **Revised 2026-06-22 (prep iterate #2, interactive):** **dropped the tracker-write / `materialise_link` option entirely** (human decision). Inferred deps are now **run-local serialisation only**, with each inferred edge **surfaced in the run summary** for visibility — no build-time blocker-link write, no config knob. Rationale: a *build-time* skill auto-writing a blocker link between two *existing* in-queue tickets is the one move even `/faff-tidy` refuses (`faff-tidy:261`); it would break the suite-wide invariant that links between existing human-owned tickets are human-authored (jot/plot write links only at *creation* of a confirmed plan; tidy adds one only when creating the other endpoint). Run-local + surfaced delivers the ordering correctness without crossing that line. Supersedes the 13:08 spec. Confidence stays high (this *removes* a moving part).

*nlspec design document for the build agent and human reviewers.*

## 1. WHY — Problem and Principles

**The load-bearing idea.** beep-boop already partitions a build queue into *independents* (parallel-safe) and *collision groups* (serialised) via **conflict analysis**. This spec adds **one more signal** to that partition: when issue A's spec says it *consumes* something issue B's spec says it *produces*, serialise A behind B — even when nothing else links them. A sixth collision heuristic, not a new subsystem. **The inference's only effect is in-run build ordering plus a line in the run summary — it never writes to the tracker.**

**Problem statement.** Conflict analysis serialises only on *contention* (shared file/dir/named-symbol) or a *human-declared blocker*; it misses the asymmetric **producer→consumer** case (B creates a module/endpoint/migration/symbol/config-key; A assumes it exists), because the specs share no file and no symbol the matcher can see — so both read as independent and A may build before B. For L3/L4 that's a correctness hole: the run is only as honest as the human's pre-declared blockers.

**Design principles:**
- **Correctness, not ordering opinion.** Partitioning *can these ship in parallel without breaking* is conflict analysis's remit, distinct from *which work matters more* (the methodology's `pick-ordering`). Inference adds serialisation edges; it must **never** reorder independents or express value/risk/priority.
- **Default-safe by construction.** Must work under the zero-config **structural default**, which has no Principle-6 equivalent (confirmed: `faffter-noon-methodology-structural` has no "Surface dependencies"). Anything routing inference *through* a methodology fails this.
- **Declared blockers stay authoritative; inference never authors one.** A human-declared blocker (or explicit non-dependency) is the fast-path and override. Inference only *serialises within this run* where no blocker is declared and no file/symbol overlap exists — it **never writes a tracker blocker link**, because authoring a link between two existing tickets is human-only across the whole suite (jot/plot at creation; tidy surfaces, `faff-tidy:261`). A build skill must not cross that line.
- **Serialise on doubt, but don't collapse the queue.** Honour "when in doubt, serialise" — but a reference too vague to name a target **downgrades to surface-only** (mirroring chain-gap's ambiguity downgrade), since false-positive serialisation drives the queue sequential.

**Scope statement.** Lives entirely inside beep-boop's build-pass partition step + its run summary; one input to an existing decision, not a new stage, and not a tracker writer.

## 2. OUT OF SCOPE
- **Writing inferred deps as tracker blocker links** — a build skill must not author a link between two existing human-owned tickets (the invariant jot/plot/tidy uphold). If a persistent inferred-dep graph is ever wanted, it belongs to a *grooming* skill (tidy) behind a human confirm, not the build pass.
- **Reordering independents / any value-risk-priority judgement** — methodology's `pick-ordering`.
- **Chain-gap fill (referenced work with no ticket)** — already in faff-tidy; this handles the inverse (both tickets exist, link missing).
- **Within-run inference over mid-run *discovered* tickets** — FAFF-87's domain.
- **A persistent code-built produces/consumes index** — specs declare in prose; a code-graph build is out of proportion.
- **General spec-quality NLP** — inference reads only produces/consumes signals.

## 3. WHAT — Vocabulary, Types, Interfaces

| Term | Definition |
|---|---|
| Produces-signal | A spec statement the issue *creates* a nameable surface (module/file, exported symbol, endpoint, migration/table, config key, CLI command). From WHAT/HOW + `**Chosen:**`. |
| Consumes-signal | A spec statement the issue *depends on* a surface it doesn't create — typically `**Assumes:** X exists`, or "calls X", "builds on Y", "once Z exists". |
| Inferred dependency | A (consumer→producer) pair where a consumes-signal matches a produces-signal by ticket-ID or clear paraphrase, with **no** declared blocker and **no** file/symbol overlap already catching it. |

```
RECORD InferredDep:
  consumer: IssueId
  producer: IssueId
  evidence: Text            # consumer consumes-signal + producer produces-signal, quoted
  match_kind: ENUM { id_reference, paraphrase }
  confidence: ENUM { firm, ambiguous }   # ambiguous → surface-only, not serialised

RECORD ConflictPartition:        # existing output + one field
  independents: List<IssueId>
  groups: List<List<IssueId>>    # serialised groups (now also inferred-dep groups)
  inferred: List<InferredDep>    # NEW: run-local audit record of every firm + ambiguous inference
```

**Decision — where inference lives. Chosen:** a **sixth conflict-analysis heuristic** (a pre-pass within the existing Conflict analysis step), methodology-agnostic and prose-owned alongside the other five. Only option satisfying default-safe for free, correctness-scoped, reusing the serialise-into-groups output and "when in doubt, serialise" bias. (Rejected: routing via methodology — fails default-safe; a new CLI seam — NL matching is LLM-judgement a CLI can't own today.)

**Decision — structural default needs its own P6? Chosen:** No. Inference in conflict analysis gives the structural default producer→consumer serialisation with no methodology change. Agile P6 stays the *grooming-time* surfacing; this heuristic is the *build-time* backstop.

**Decision — write inferred deps to the tracker? Chosen: No — run-local only.** Inferred deps serialise the build *for this run* and each inferred edge (firm + ambiguous) is **surfaced in the run summary** with its evidence. **No tracker blocker link is ever written, and there is no config knob.** Rationale: authoring a blocker link between two existing tickets is human-only everywhere in the suite. If a persistent inferred-dep graph is ever wanted, it's a *grooming* feature behind a human confirm, not a build side-effect.

**Assumes:** Specs declare producer outputs and consumer dependencies in parseable prose densely enough for usable ID/paraphrase recall. *Validated this session:* a probe over recent attached specs found `**Assumes:** <named surface>` consumes-signals densely present. Producer-side naming is validated live via the `inferred[]` audit over the first runs.

## 4. HOW — Behavior

One pre-pass at the **head of the Conflict analysis step** (beep-boop step 5), before the five contention/blocker heuristics. Reads the same build-ready spec set, emits `InferredDep` records, folds *firm* ones into collision groups, routes *ambiguous* ones to surface-only, and the run summary reports both. Downstream `concurrency` slot consumes the unchanged `{independents, groups}` shape. **No tracker writes occur anywhere in this flow.**

```
PROCEDURE infer_producer_consumer_deps(build_ready_specs):
  1. For each issue extract: produces-signals (WHAT/HOW + **Chosen:**); consumes-signals (**Assumes:**, "calls/builds on/once X exists")
  2. For each consumes-signal C in issue A:
     a. Find in-queue issue B whose produces-signals match C by id_reference OR paraphrase
     b. SKIP if A already declares B as blocker (heuristic 4 serialises)
     c. SKIP if A,B already collide via file/dir/symbol (heuristics 1-3)
     d. Classify: firm (id_reference, or paraphrase naming a concrete surface) | ambiguous (vague / no nameable target / multiple producers)
  3. Emit InferredDep{consumer:A, producer:B, evidence, match_kind, confidence}

PROCEDURE fold_into_partition(inferred, existing_partition):
  1. firm: place producer BEFORE consumer in a collision group (merge transitively with existing groups)
  2. ambiguous: do NOT serialise; record under "surfaced, not serialised"
  3. annotate each group carrying an inferred edge with evidence; emit all edges to the run summary
```

**Ordering within a group.** Groups are already serialised; this only adds producer-precedes-consumer *inside* the group — a dependency-direction fact (correctness), not value ordering; never touches independents, never consults the methodology.

**Edge cases:**
- **Cycle (A↔B consume each other):** collapse into one serialised group, deterministic intra-group order (ticket-id), **flag the cycle** in the run summary as a likely spec error.
- **Producer not in build-ready set:** not an in-queue inferred dep. External open issue → `faff next --blocked` (excluded); no ticket → chain-gap (out of scope). Inference acts only when both endpoints are in-queue.
- **Multiple candidate producers:** mark `ambiguous` → surface-only; never guess.
- **Inferred dep contradicts a human "not blocked" signal:** human wins; surface-only, note conflict.

**Anti-pattern:** Inference reordering independents by importance. Why: methodology's job; violates orchestration-owns-no-ordering.
**Anti-pattern:** Writing any tracker blocker link from inference. Why: authoring a link between two existing tickets is human-only — a build skill must never do it; inference is run-local + surfaced.

## 5. SCENARIOS

```
Given in-queue B (produces module `rate_limiter`) and A (**Assumes:** a rate limiter exists), no declared blocker, no shared file/symbol,
When beep-boop conflict analysis runs under the STRUCTURAL DEFAULT,
Then A and B form one serialised group with B before A — not independents — and no tracker link is written.
```
```
Given the same pair but A references B by id ("blocked on the work in FAFF-B"),
When conflict analysis runs,
Then it serialises B→A AND records the inference (match_kind=id_reference) in the run-summary inferred list.
```
```
Given a vague reference ("integrate with the new infra somehow"), no nameable target,
When inference runs,
Then the pair is NOT serialised (stays independents) and is reported under "surfaced, not serialised".
```
```
Given a producer→consumer pair that ALREADY has a human-declared blocker,
When inference runs,
Then behaviour is unchanged — the declared-blocker fast-path serialises it; no duplicate edge, no write.
```
```
Given the same pair built under the AGILE methodology,
When conflict analysis runs,
Then serialisation is identical to the structural-default case (methodology-agnostic).
```
Assertion: the `{independents, groups}` shape consumed by the `concurrency` slot is unchanged; no tracker mutation occurs.

## 6. DESIGN DECISION RATIONALE
- **Where inference lives** → **Chosen:** conflict-analysis heuristic (only default-safe, correctness-scoped, reuse-maximising option).
- **Structural default own P6?** → **Chosen:** No (covered for free by the heuristic).
- **Write inferred deps to the tracker?** → **Chosen: No.** Run-local serialisation + surfaced in the run summary; no `blockedBy` write, no knob. Dropped the earlier `materialise_link` option entirely (human decision 2026-06-22).
- **Spike first?** → **Chosen:** No separate spike. The recall assumption was de-risked this session by a probe over real specs; remaining producer-side recall is observable live via `inferred[]`. Build as one unit.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — both former Punts resolved (tracker-write dropped; no spike).

**Assumptions:**
- **Specs declare produces/consumes in parseable prose.** *Validated this session* via a recall probe over recent attached specs; producer-side validated live via `inferred[]`.
- **Conflict analysis stays prose-owned in beep-boop** (no mid-flight CLI migration).

## 8. DONE

### From WHY
- [ ] A producer→consumer pair with no declared blocker and no file/symbol overlap is serialised producer-first (correctness hole closed).
- [ ] Inference adds only serialisation edges; never reorders independents or expresses value/risk/priority.
- [ ] Inference writes **nothing** to the tracker — no blocker link, no status change.

### From WHAT
- [ ] Conflict analysis emits existing `{independents, groups}` plus a run-local `inferred` audit list; `concurrency`-slot contract unchanged.
- [ ] Implemented as a sixth heuristic inside beep-boop's Conflict analysis step (not a methodology, not a new stage, not a tracker writer).
- [ ] Declared blockers and existing file/dir/symbol collisions are skipped by inference (no duplicate edges).

### From HOW (behaviour)
- [ ] Produces- and consumes-signals extracted from each build-ready spec.
- [ ] Firm matches serialise producer→consumer; ambiguous downgrade to surface-only.
- [ ] Serialisation identical under structural default and agile (methodology-agnostic).

### From HOW (edge cases)
- [ ] An inferred cycle collapses to one serialised group, deterministic order, flagged as likely spec error.
- [ ] A consumes-signal whose producer is not in-queue is not treated as an in-queue inferred dep.
- [ ] An inferred dep contradicting a human "not blocked" signal yields to the human and is surfaced, not serialised.

### From surfacing / audit
- [ ] Every firm and ambiguous inference recorded with quoted evidence in the run audit log **and** surfaced in the run summary (new sub-section, e.g. "Inferred build-order deps").
- [ ] No code path writes a tracker blocker link from inference (asserted).

**Integration smoke test:**
```
Build queue = [A (Assumes "the rate limiter"), B (produces module rate_limiter)], no blocker, no shared file.
Run beep-boop conflict analysis (structural default).
Expect: groups contains [B, A]; independents excludes both; inferred[] has one firm record citing both signals; run summary lists the edge; tracker unchanged.
```

confidence: high
