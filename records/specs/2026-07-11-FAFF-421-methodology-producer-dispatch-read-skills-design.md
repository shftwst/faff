# FAFF-421 — Migrate the four read skills' methodology calls to producer dispatch (`models.methodology` / `effort.methodology`)

> Spec: faffter-dark-nlspec · 2026-07-10 · interactive · confidence: high. Full spec on Linear FAFF-421.

This spec migrates every `methodology`-slot call site in the four read skills (`faff-tidy`, `faff-plot`, `faff-map`, `faff-wtf`) — plus the two same-gap residuals in `faff-jot` — onto the gateway's Producer-dispatch transport, resolving both the model lane (`models.methodology`) and the effort lane (`effort.methodology`) mechanically at dispatch. It is a prose-only change to six `SKILL.md` files; no CLI code changes.

## 1. WHY — Problem and Principles

**Load-bearing model.** A slot invoked inline via the Skill tool runs in the caller's session and inherits the session model and effort — no `models:`/`effort:` key can change that. The only way the `models.methodology` / `effort.methodology` lanes can govern a methodology call is to re-shape the call into an Agent-tool **producer dispatch** (the subagent takes a `model` parameter and a reasoning-effort arg). The gateway already defines this transport generically for the `methodology` producer; prep and jot's dispatch wording partially adopted it. The four read skills' ~15 call sites specify **no transport at all**, so they silently stay session-pinned — the lanes exist but govern nothing there.

**Problem statement.** `faff-tidy`/`faff-plot`/`faff-map`/`faff-wtf` request methodology named outputs with transport-less prose ("request the X output from the configured methodology"), so those calls run inline on the session model at session effort, and a configured cheap/tuned methodology lane is ignored. This change makes every such request a producer dispatch with both lanes resolved via `faff config get`, and settles the per-output dispatch grain (the design decision the ticket front-loads).

**Design principles.**

- **Transport prose lives once in the gateway.** Skills carry a one-to-two-sentence reference, never a copy — the duplicated-block lint (≥6 identical significant lines across 2+ skills) enforces the floor; the dedup standard sets the bar lower still.
- **Both lanes resolved mechanically, never retyped.** `faff config get models.methodology` / `faff config get effort.methodology` at dispatch; `inherit` (the default for both) **omits** the parameter — byte-for-byte today's dispatch when unconfigured.
- **Grain is per-output policy, inspectable in one place.** Which outputs batch, which dispatch per request, and the one in-context fallback are recorded as a normative subsection of the gateway's methodology-slot section, so the choice can be re-tuned per output without archaeology.
- **Degradation is loud.** A failed dispatch degrades per each output's existing unanswered rule but is surfaced as "methodology unavailable" — never rendered as a clean result (the `backlog-diagnostics` structural floor especially must never green-wash).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` | skill prose | Gateway: Producer-dispatch paragraph (origin L864), stale carve-out (origin L232), `effort:` map (L149–156), The `methodology` slot section — home of the new Transport subsection |
| `plugin/skills/faff-prep/SKILL.md` | skill prose | Canonical already-migrated wording (L49 `issue-critique`; L160/L231 single-level-nesting phrase) — the pattern to match, not copy |
| `plugin/skills/faff-tidy`, `faff-plot`, `faff-map`, `faff-wtf`, `faff-jot` `SKILL.md` | skill prose | The call sites being migrated (inventory in HOW) |
| `faff validate-adapters` | CI lint | Line caps (600/skill, 1100 gateway — origin gateway is at 1038), paragraph length, duplicated-block rule |

**Scope statement.** This is the read-skill leg of the FAFF-315/FAFF-416 per-lane routing programme: prep/jot's producers are already dispatch-worded; this PR finishes the interactive methodology surface and corrects the gateway sentence that describes the migration frontier.

## 2. OUT OF SCOPE

- **`models.review` migration** — why: separately ticketed. Extension point: FAFF-412. **Build-coordination note:** FAFF-412 edits the same gateway model-selection prose region — build serially with FAFF-412, never in the same concurrent pass.
- **graft's `ship` / `adr` / `env` / `evaluator` call sites** — why: a different migration with its own transport questions. Extension point: the same gateway Producer-dispatch paragraph; a future graft-scoped ticket.
- **`/faff-beep-boop`'s own direct methodology requests** (`build-queue`, its build-queue `pick-ordering`) — why: excluded by the ticket. Note: autonomous tidy **chained by beep-boop** is *in* scope by construction — the migrated sites live in tidy's SKILL.md and the wording is mode-agnostic. Extension point: `faff-beep-boop/SKILL.md` + the two concurrency executors.
- **Per-output effort sub-lanes** — why: `effort.methodology` is one lane by FAFF-416 design; splitting it per named output is unjustified config surface.
- **Any change to the named-output contract semantics** (inputs, outputs, unanswered-rules, who writes what) — this ticket moves transport only. The `prdr-author` CLI write stays methodology-owned exactly as contracted.

## 3. WHAT — Vocabulary and Shapes

**Vocabulary.**

| Term | Definition |
|---|---|
| Producer dispatch | The gateway transport: an Agent-tool subagent (`subagent_type: general-purpose`) that invokes the resolved methodology skill and returns its output as its tool result, with `model` / reasoning-effort args resolved from the two lanes |
| Pass | One invocation of a read skill (one tidy grooming pass, one wtf render, one map synthesis, one plot recursion session) |
| Batched-per-pass | All named-output requests a pass will make, dispatched as one producer subagent after the pass's mechanical grounding (fetch + graph analysis) completes |
| Batch-per-altitude | Plot-specific grain: one dispatch per recursion level, carrying all that level's node-scoped sub-briefs |
| Follow-up dispatch | A later request in the same pass (a conditional that fired late, or an interactive follow-up such as a re-shape after `edit` or a per-project `prdr-author` offer) — same mechanics, new dispatch |

**Batched request/response shape** (prose protocol, defined once in the gateway Transport subsection):

```
BATCH REQUEST (the dispatch prompt carries):
  requests: ordered list of { output: <named-output name>, input: <the payload that output's contract row defines> }

BATCH RESPONSE (the subagent's tool result):
  one "## <output-name>" section per request, in request order
  an unanswered-optional output returns its section stating "unanswered" (the caller applies that output's existing degradation rule)
```

**Per-output transport table** (normative; lives in the gateway — see HOW):

| Output(s) | Grain | Why |
|---|---|---|
| `pick-ordering`, `backlog-diagnostics`, `crank-up-set`, `standup-digest`, `horizon-assignment` — and any other output a read-skill pass requests, by default | Batched-per-pass (one dispatch) | One snapshot, one skill-load, N answers; amortises graph serialization; keeps ordering + diagnostics consistent |
| `ticket-shaping` in `/faff-plot` | Batch-per-altitude | The recursion is level-sequential (level N's confirmed children feed level N+1's sub-briefs) so the whole tree can't batch, but all nodes at one altitude shape independently; matches plot's own level-by-level gating. Re-shape on `edit` = follow-up node-scoped dispatch |
| `ticket-shaping` in `/faff-jot` | Single dispatch (the degenerate batch — jot shapes once per pass) | — |
| `prdr-author` (tidy / plot / jot) | Dispatch-per-request (per container) | Each proposal is separately human-gated and arises after a gate; containers needing one are rare, so overhead is negligible. The subagent needs Bash for `faff prdr new` — `general-purpose` carries it; the write stays methodology-owned per the existing contract |
| Any output, when the calling skill is itself a subagent | In-context (single-level nesting fallback) | A subagent spawning a subagent double-nests. The lanes do not apply in-context (session-pinned). Inert today — none of the four read skills currently runs as a subagent — matching prep's own inert instances |

## 4. HOW — The edits

### 4.1 Gateway (`plugin/skills/faff/SKILL.md`)

**(a) Correct the carve-out sentence** (origin L232 region, end of the "Model & effort selection" opening paragraph). It currently ends:

> "The interactive prep/jot producers (`spec` / `spec_review` / `methodology` / `intake` / `architecture`) are re-shaped that way (see **Sibling-skill invocation → Producer dispatch**), so they now take a `models:` lane; the still-inline slots (graft's `review` / `ship`, and autonomous producer dispatch) stay session-model-pinned pending their own migration."

Replace that final sentence with:

> "The interactive producers (`spec` / `spec_review` / `methodology` / `intake` / `architecture`) are re-shaped that way across all their interactive callers — prep, jot, and the four read skills (tidy / plot / map / wtf) — (see **Sibling-skill invocation → Producer dispatch**), so they take `models:` lanes; the still-inline slots (graft's `review` / `ship`, and `/faff-beep-boop`'s own direct methodology requests — its `build-queue` and build-queue `pick-ordering`) stay session-model-pinned pending their own migration."

**(b) Add a `Transport` subsection** under **The `methodology` slot** (after the named-output contract table and its trailing paragraphs), carrying: the batched request/response shape, the per-output grain table from WHAT §3, the follow-up-dispatch rule, and the loud-degradation rule ("a failed/garbled dispatch degrades per each output's unanswered rule, surfaced as 'methodology unavailable this pass' — a missing `backlog-diagnostics` floor is never rendered `clean ✓`; interactive may retry once, autonomous logs + continues"). Budget ≈ 12–16 lines (gateway is 1038/1100 — fits; write it lean from the start).

**(c) One pointer sentence** appended to the Producer-dispatch bullet (origin L864): "The `methodology` producer's request-grain rules (per-pass batching + exceptions) live at gateway → **The `methodology` slot → Transport**."

**(d) Fix the stale `Requested by` column** in the named-output table: `pick-ordering` row gains `faff-tidy, faff-map`; `prdr-author` row gains `faff-tidy` (all three demonstrably request them today — docs-never-go-stale, and we're editing this section anyway).

### 4.2 Per-skill transport statement (one per skill, five skills)

Each of `faff-tidy`, `faff-plot`, `faff-map`, `faff-wtf`, `faff-jot` gains **exactly one** short normative statement, placed just before its first methodology request, of this shape (adapted per skill so no two are line-identical; never a copied block):

> **Methodology transport.** Every `methodology` named-output request this skill makes is a **producer dispatch** (gateway → **Sibling-skill invocation → Producer dispatch**, resolving `models.methodology` and `effort.methodology` via `faff config get`; `inherit` omits the parameter), with request grain per gateway → **The `methodology` slot → Transport** — batched per pass by default; in-context when this skill is itself a subagent (single-level nesting).

The existing per-site sentences ("request the `X` output from the configured methodology…") **stay as they are** — the statement defines what "request" means for the whole skill. Individual sites are edited only where the grain changes their flow (below). `faff-prep` needs no edit (its L49 wording is already correct); verify with the residual sweep in DONE.

### 4.3 Site-specific edits

- **faff-tidy** — the two `backlog-diagnostics` sites (bucket 5 structural floor, L117; bucket 7 lens findings, L186) become **one request, two consumers**: the pass's single batch asks for the full findings set once; bucket 5 renders the structural floor + mechanical-fix categories from it, bucket 7 renders the lens's opinionated findings from the same result. Each site gains a half-line noting it consumes the shared pass result. `prdr-author` (L207) is per-request per the gateway table — no site rewording needed beyond the skill statement.
- **faff-plot** — Step 2 (L43) is rewritten to batch-per-altitude: at each descent level, collect the node-scoped sub-briefs of **all** confirmed nodes at that level into one `ticket-shaping` dispatch (`shape-level` = the altitude); gate node-by-node on the returned shapes exactly as today; an `edit` triggers a follow-up node-scoped re-shape dispatch. Plot still owns the loop, stop rule, gating, and writes — unchanged.
- **faff-map / faff-wtf** — no per-site rewording beyond the skill statement; wtf 5c's conditional `backlog-diagnostics` joins the batch only when the condition — known at grounding time from the tidy log — fires.
- **faff-jot residuals** — `ticket-shaping` (L60) and `prdr-author` (L80) are covered by jot's new skill statement (fold-in, not deferral): leaving them would keep the corrected gateway sentence false for jot.

### 4.4 Mechanics the sites inherit by reference (do not restate)

Resolution of the slot occupant (Sibling-skill invocation, canonical-vs-namespaced), the `data.effort` event tagging (FAFF-415/416), and the single-level-nesting rule all come from the referenced gateway paragraphs. **Anti-pattern:** restating any lane-resolution or event-tagging mechanics at a call site — the gateway is always loaded; copies rot and trip the duplicated-block lint.

**Failure modes.**

- **Batching degrades answer quality** — one subagent answering five outputs may skimp on the later ones. How you'd know: visibly thinner tidy/wtf sections vs pre-migration. What it means: re-tune the grain table (it is per-output precisely so a single output can move to per-request without re-design).
- **Serialization cost eats the saving** — passing the full backlog graph into a subagent may cost more tokens than inline calls did. How you'd know: `faff economics --by class` shows dispatch-input growth post-migration without a compensating cheaper-lane saving. What it means: narrow the input payloads per output, or accept it where a cheap `models.methodology` offsets it.
- **Per-altitude batching fights plot's interactive feel** — heavy `edit` sessions turn one batch into many follow-ups. How you'd know: plot sessions show more follow-up dispatches than level dispatches. What it means: acceptable (follow-ups are the designed path); only if it dominates, revisit per-node grain for interactive plot.

## Scenarios

```
Given .faffrc sets models.methodology: haiku and effort.methodology: high
When /faff-wtf runs an interactive pass
Then exactly one Agent-tool producer dispatch is made for its methodology outputs
  (standup-digest, pick-ordering ×2, crank-up-set, and backlog-diagnostics iff no tidy ran)
And the dispatch carries model: haiku and reasoning-effort: high
And sections 5a/5b/5c render from that single result
```

```
Given both lanes unset (inherit)
When any migrated read skill dispatches the methodology producer
Then the Agent call omits both the model and the reasoning-effort parameters (byte-for-byte today's dispatch)
```

```
Given /faff-plot has three confirmed projects at the project altitude
When it descends to shape first-slice epics
Then one ticket-shaping dispatch carries all three node-scoped sub-briefs (shape-level: epic)
And returns three shaped child sets, gated per node as today
```

```
Given autonomous tidy (chained by /faff-beep-boop via the Skill tool) and a methodology dispatch that fails
When the pass completes
Then it renders "methodology unavailable this pass" (never `Structural diagnostics: clean ✓`), logs the failure, and continues
```

- Assertion: the four read skills + jot each contain exactly one transport statement; no run of ≥6 identical significant lines is shared between any two skills (`faff validate-adapters` green).
- Assertion: gateway line count stays ≤ 1100.

## 6. Design decision rationale

**What is the default dispatch grain?** Options: dispatch-per-request (max isolation, N× subagent spin + graph re-serialization per pass — tidy/wtf make 4–7 requests each); stay-in-context (zero overhead, forfeits both lanes — defeats the ticket); batched-per-pass (one spin, one snapshot, N answers). **Chosen:** batched-per-pass — the overhead argument is decisive at the read skills' request cardinality, and one snapshot keeps ordering + diagnostics mutually consistent.

**How does plot's per-node recursion dispatch?** Options: per-node (heaviest — re-serializes the live tracker graph every node); whole-tree batch (impossible — levels are sequentially dependent through human gates); in-context (forfeits lanes on the heaviest reasoning); batch-per-altitude. **Chosen:** batch-per-altitude — nodes at one altitude shape independently and plot already gates level-by-level; `edit` re-shapes are follow-up node-scoped dispatches.

**prdr-author grain + its CLI write?** Options: fold into the pass batch (front-runs the per-project human gates); per-request. **Chosen:** dispatch-per-request, and **no special handling** for the write — the `general-purpose` subagent carries Bash, and the `faff prdr new` write stays methodology-owned exactly as the existing contract states (moving the write locus would be a contract change, out of scope).

**tidy's two backlog-diagnostics sites?** Options: two batch entries (near-duplicate work); one request. **Chosen:** one request, two consumers — the single full findings set feeds bucket 5 (structural floor + mechanical fixes) and bucket 7 (lens findings).

**Fold in the jot residuals?** Options: defer to a sweep ticket; fix here. **Chosen:** fix here — same one-statement pattern, and the corrected gateway carve-out sentence would otherwise be false for jot on merge day.

**The ticket's `efforts.methodology` naming error?** The real key is **`effort.methodology`** (singular `effort:` map, gateway L149–156). **Chosen:** the spec records the correction and all prose uses the real key; the ticket title is corrected tracker-side alongside this spec's attach.

**Where does the grain table live?** Options: the Producer-dispatch paragraph (already dense, and the grain is methodology-specific); per-skill (copies). **Chosen:** a `Transport` subsection of gateway → **The `methodology` slot**, with a one-sentence pointer from the Producer-dispatch bullet — the slot section is the named-output contract's home, so its transport belongs beside it.

**Per-site formula or per-skill statement?** Options: repeat the full dispatch formula at ~15 sites (bloat, duplicated-block lint risk); one statement per skill defining what "request" means. **Chosen:** one per-skill statement + site edits only where grain changes flow — leaner, and the skills are always fully loaded so the statement is never out of reach.

**Fix the stale `Requested by` column while here?** **Chosen:** yes — `pick-ordering` gains `faff-tidy, faff-map`, `prdr-author` gains `faff-tidy`; a two-cell mechanical correction in a section this PR already edits (docs never go stale).

## 7. Open questions and assumptions

**Open questions:** none.

**Assumptions.**

- **Assumes:** the `effort.methodology` lane exists on main (FAFF-416, commit `9bf87c1`). Validation: cut the feature branch from freshly-pulled `origin/main` and confirm `git log --oneline -3` includes FAFF-416 before editing. *(Verified at build: `9bf87c1` is an ancestor of `origin/main`; the branch is cut from `10ed9f4`.)*
- **Assumes:** the Agent-tool dispatch accepts a reasoning-effort argument as FAFF-416's gateway prose describes ("pass a resolved level as the dispatch's reasoning-effort arg"). Validation: read the gateway's Model & effort selection section on the feature branch; it shipped in PR #297 — this spec adds no new mechanics on top of it.

## 8. DONE — Definition of Done

### From WHY / gateway (4.1)

- [ ] Gateway carve-out sentence replaced with the exact sentence in HOW 4.1(a) — it no longer describes the read skills as pending, and names the remaining inline surface as graft's `review`/`ship` + beep-boop's direct methodology requests.
- [ ] Gateway → The `methodology` slot carries a new `Transport` subsection with: the batch request/response shape, the per-output grain table, the follow-up-dispatch rule, and the loud-degradation rule (failed dispatch ⇒ "methodology unavailable", never `clean ✓`).
- [ ] Producer-dispatch bullet carries the one-sentence pointer to that subsection.
- [ ] Named-output table `Requested by` fixed: `pick-ordering` += `faff-tidy, faff-map`; `prdr-author` += `faff-tidy`.
- [ ] Gateway total line count ≤ 1100.

### From WHAT/HOW (per-skill, 4.2–4.3)

- [ ] Each of `faff-tidy`, `faff-plot`, `faff-map`, `faff-wtf`, `faff-jot` `SKILL.md` contains exactly one **Methodology transport** statement naming both `faff config get models.methodology` and `faff config get effort.methodology`, `inherit`-omits, the gateway Transport reference, and the single-level-nesting in-context fallback.
- [ ] `faff-plot` Step 2 states batch-per-altitude (all confirmed nodes of the level in one `ticket-shaping` dispatch; `edit` ⇒ follow-up node-scoped dispatch); loop/stop-rule/gates/writes wording unchanged.
- [ ] `faff-tidy` buckets 5 and 7 each state they consume the pass's single shared `backlog-diagnostics` result (one request, two consumers).
- [ ] Residual sweep recorded in the PR: `grep -n "configured methodology\|methodology skill" plugin/skills/faff-{tidy,plot,map,wtf,jot,prep}/SKILL.md` — every hit is covered by that file's transport statement (prep already conformant, untouched); no site specifies a conflicting transport.
- [ ] No lane value is retyped anywhere — every resolution goes through `faff config get`.

### From HOW (verification)

- [ ] `faff validate-adapters` green (line caps, paragraph caps, no duplicated block ≥6 identical significant lines across skills).
- [ ] Feature branch cut from up-to-date `origin/main` containing FAFF-416 (`9bf87c1`).
- [ ] Loud-degradation wording present and greppable: the gateway Transport subsection carries the failed-dispatch rule (a failed/garbled dispatch degrades per each output's unanswered rule, surfaced as "methodology unavailable this pass" — a missing `backlog-diagnostics` floor is never rendered `clean ✓`; interactive may retry once, autonomous logs + continues), and `grep -n "methodology unavailable" plugin/skills/faff/SKILL.md` hits it.

**Eval coverage:** no new LLM-judgement seam — the change relocates where existing methodology judgement executes; graders and cases are unchanged. No registry row required.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. On the feature branch, set .faffrc: models.methodology: haiku, effort.methodology: low
  2. Run interactive /faff-wtf
  3. ASSERT exactly one methodology producer dispatch occurred, carrying model + effort args
  4. ASSERT sections 5a/5b/5c rendered from its single result
  5. Run one interactive /faff-tidy pass; ASSERT a single dispatch's backlog-diagnostics result feeds BOTH bucket 5 (structural floor) and bucket 7 (lens findings) — one request, two consumers
  6. Unset both keys; re-run /faff-wtf; ASSERT the dispatch omits both params
  7. Run `faff validate-adapters`; ASSERT exit 0
  8. Simulate a failed methodology dispatch in a /faff-wtf pass (point `slots.methodology` at a nonexistent skill name); ASSERT the structural-diagnostics section renders "methodology unavailable this pass" — never `clean ✓` — and the pass completes
```
