# FAFF-32 — Env-var & secret lane-ownership: the lane→secret visibility matrix

> Spec: faffter-dark-nlspec · 2026-07-08 · autonomous · confidence: high. Full spec on Linear FAFF-32.

This spec defines the design deliverable for FAFF-32: one ADR recording the lane→secret visibility matrix as a decided invariant, plus a gateway edit extending the lane-isolation section of `plugin/skills/faff/SKILL.md` with that matrix. It is written for the build agent that will produce the docs and for human reviewers. No product code ships from this ticket.

## 1. WHY — Problem and Principles

**The load-bearing model:** faff's lane-isolation table already fixes what each lane may see of the codebase, tracker, spec, and environment — but says nothing about *secrets*. This ticket extends that table with a second grid: per lane, per secret class, may-see or may-not. The matrix is the **fixed contract**; the store/injection mechanism that delivers each secret to each lane is the **swappable producer** behind it, and belongs to the downstream ticket FAFF-104. Everything in this spec is specification and attestation — physical enforcement arrives with the isolation ladder's higher rungs, which are already decided elsewhere and are folded in here as settled context, not re-litigated.

**Problem statement:** today every lane runs inside one shared cage with one shared environment, so the evaluator's "sees no repo credentials" and the implementor's "sees no tracker key" are unstated conventions, not recorded invariants. FAFF-104 (the secret-store/injection producer) is blocked because there is no matrix telling it *what* must be injected *to whom*. This ticket writes the matrix down — as an ADR and as gateway prose — so the invariant exists before any mechanism is built against it.

**Design principles:**

**Specify above the rung that can enforce.** ADR-0041 records the unlock condition verbatim: the matrix "is buildable as specification any time, but *physically enforceable* only at rung 3" of the isolation ladder. Any implementation that ships enforcement machinery (env scrubbing, per-lane injection, a secret store) from this ticket is wrong — reject it. The deliverable is docs.

**Assert, never implement (ADR-0017).** faff may assert a secret-visibility precondition (a `container-check`-shaped preflight, later, owned by FAFF-276's build); it must never build the store, the scrubber, or the cage. The matrix must read as a contract the *outer layer* satisfies and faff *checks*.

**Names in config, values in the environment.** The established idiom (`api_key_env`) is the house pattern for every secret this matrix covers: configuration and docs carry env-var *names* only; values live in the process environment; values never appear in `.faffrc`, on command lines, in tracker comments, or in PR logs.

**Gateway prose is self-contained.** The gateway edit must state the posture in its own words — no ADR-NNNN or FAFF-NN reference may be load-bearing in `SKILL.md` prose. The ADR carries provenance and rationale; the gateway carries the operative rule.

**Reference context:**

| System | Location | Relevance |
|---|---|---|
| Lane-isolation table | `plugin/skills/faff/SKILL.md` (## Agent Lanes → ### Lane isolation, the table at ~:283–287) | The table this ticket extends; columns Lane / Codebase / Tracker / Spec / Environment / Human dialogue |
| ADR-0010 | `docs/adr/0010-autonomous-execution-blast-radius-model-*.md` | :46 the forwarded-secret set; :47 delegates the inner (within-cage) boundary to FAFF-32; :48(a) the reopen trigger rung 3 fires |
| ADR-0041 | `docs/adr/0041-multi-cage-l4-*.md` | The isolation ladder (rungs 0–3); rung-2 partial evaluator unlock; rung-3 full-matrix unlock; the "specification any time, enforceable only at rung 3" condition |
| ADR-0017 | `docs/adr/0017-*.md` | Assert-don't-implement: faff checks dev-infra preconditions, never builds them |
| env-handle contract | `plugin/skills/faffter-noon-env-compose/SKILL.md` (:36, :42–54) | Synthetic `credentials` in the handle; "runtime-consumed and must not be persisted to the tracker or PR logs" |
| Evaluator dispatch | `plugin/skills/faff-graft/SKILL.md` (holdout gate, ~:430) | Code-blind evaluator: fresh OS-level process handed only spec text + env-handle endpoint |
| `api_key_env` idiom | `plugin/skills/faffter-dark-adversarial-review/SKILL.md` :114, `review-call.mjs` (resolves `process.env[b.apiKeyEnv]`), `.faffrc.example.yaml` :181 | The names-in-config / values-in-environment pattern the matrix canonises |
| `faff adr` CLI | `plugin/skills/faff/bin/faff` | `adr new --title T --issue FAFF-XX`, `adr next-number` (currently 0048), `adr validate` |

**Scope statement:** this ticket sits between ADR-0010's outer boundary (secrets cross *the one* container boundary as explicitly-forwarded env) and FAFF-104's injection mechanism — it defines the inner boundary both of those defer to.

## 2. OUT OF SCOPE

- **The store/injection mechanism** (env files vs vault vs OS keychain, how values reach each lane) — why: explicitly the downstream ticket's whole scope; this issue blocks FAFF-104 and FAFF-104 reads the merged ADR. Extension point: FAFF-104, building behind the matrix contract the ADR records.
- **Any enforcement machinery** (per-lane env scrubbing, secret-scoped subagent dispatch, a per-lane preflight probe) — why: physically impossible below rung 3 of the decided isolation ladder ("no per-subagent env scrubbing exists below this rung", ADR-0041); building it below the rung that can hold it is the exact anti-pattern ADR-0041's consequence warns against. Extension point: the evaluator-lane slice rides with FAFF-276 (rung 2, already fired for L4); the full-matrix slice is rung 3's, which when fired formally reopens ADR-0010 via its :48(a) trigger.
- **The rung-3 trigger decision itself** — why: already decided (ADR-0041 decision 1); this ticket's ADR restates it as context only. Extension point: none needed.
- **Untrusted-input handling** (the old FAFF-8 relationship named on the ticket) — why: FAFF-8 is Done; injection-axis concerns are governed by ADR-0010's :48(b) trigger, orthogonal to secret visibility. Extension point: reopen ADR-0010 :48(b) if the tracker stops being human-gated.
- **A tracker note on FAFF-104** — why: FAFF-104 simply reads the merged ADR; the blocking edge already routes it. Extension point: none needed.
- **Per-project secret inventory** (which concrete keys a given product needs) — why: that is per-project `.env.claude-box` content, the operator's; the matrix governs *classes*, not instances. Extension point: project onboarding docs.

## 3. WHAT — Vocabulary, the matrix, and its invariants

**Vocabulary:**

| Term | Definition |
|---|---|
| Lane | One of the three gateway-defined agent roles: orchestrator, implementor, evaluator |
| Helper process | A fresh OS-level process a lane spawns for one call (e.g. `review-call.mjs`, the evaluate-call helper, the `faff env` verbs) |
| Secret class | A named category of credential/config the matrix governs; the matrix has one column-set of these, not per-key rows |
| Visibility | "May see": the value may legitimately be present in that actor's process environment. Not "does see" — today one shared cage env means everything is physically present everywhere; visibility is the normative ceiling |
| Holdout boundary | The oblivious seam between implementor and evaluator: the evaluator never sees code or the implementor's environment; the implementor never sees the holdout env or raw evaluator feedback |

### Secret-class taxonomy

The matrix governs six classes, derived from the ADR-0010:46 forwarded set plus the two runtime classes the evaluator flow introduced:

- **Agent-engine credentials** — LLM provider keys powering agent and helper processes: `ANTHROPIC_API_KEY` (or subscription credentials), plus adversarial-review provider keys named via `api_key_env` (e.g. `NVIDIA_API_KEY`).
- **Forge credential** — repo/PR/merge authority: `GITHUB_TOKEN` or `gh` auth.
- **Tracker credential** — tracker read/write authority: `LINEAR_API_KEY`, or equivalently the tracker MCP's harness-level auth (same authority class, different transport).
- **Project runtime secrets** — the product's real configuration: per-project `.env.claude-box` contents.
- **Synthetic SUT credentials** — the env-handle's `credentials` block: minted per evaluation env, local-only, dev/test-grade, runtime-consumed, never persisted.
- **Engine-context vars** — `DOCKER_HOST` and kin: not secrets, but capability handles to the container engine, matrix-governed because an unscoped engine handle is authority (a host socket is root-equivalent host control, per ADR-0041's boundedness criterion).

**Chosen:** six classes as above — the ADR-0010:46 forwarded set (engine, forge, tracker, project) extended with the two classes the evaluator lane made real (synthetic SUT credentials, engine-context vars), with adversarial provider keys folded into engine credentials rather than a seventh class (same nature: an LLM provider key resolved via `api_key_env`).

### Actor granularity

The matrix has exactly three rows — the three lanes. Helper processes are **covered by their host lane's row plus a narrowing rule**: a helper may receive *at most* its host lane's visibility, scoped down to what the single call needs. Concretely: `review-call.mjs` (hosted by the implementor's graft flow) receives exactly the one adversarial provider key its backend chain names, via `api_key_env` resolution from the process environment; the evaluate-call helper receives exactly an engine credential plus the env-handle contents; the `faff env` verbs inherit `DOCKER_HOST` ambiently from their dispatch site. Helpers never widen — a helper needing a secret its host lane may not see is a matrix violation, not a helper exception.

**Chosen:** three lane rows + the helper narrowing rule, not per-helper rows — helper inventory churns with every slot swap (swappable producers are the point), while the lane ceiling is stable; per-helper rows would rot, and the narrowing rule covers them by construction.

### The matrix

| Secret class | Orchestrator | Implementor | Evaluator |
|---|---|---|---|
| Agent-engine credentials | Yes | Yes (incl. adversarial provider key, helper-scoped to `review-call.mjs`) | Yes (the evaluate-call helper is an LLM process) |
| Forge credential | Yes (merge-gate, PR ops) | Yes (branch, push, PR open) | **No** |
| Tracker credential | Yes (full tracker authority) | **No** (lane table: Tracker = No; graft's claim/ship writes ride the host session's tracker tool, granted at harness level — the lane holds no tracker key of its own) | **No** |
| Project runtime secrets (`.env.claude-box`) | No (sequences, never runs the product) | Yes (local dev runs the product) | **No** (it gets synthetic credentials instead — real project secrets would both leak and un-blind the holdout) |
| Synthetic SUT credentials (env-handle) | Transit only (holds the handle at dispatch, passes it on, never persists — the env-handle no-persist rule) | **No** (the holdout env is not its concern; its local dev env is its own) | Yes (its runtime input) |
| Engine-context vars (`DOCKER_HOST`) | Yes (per-run holdout phase dispatches the env verbs) | Yes (local dev docker; per-issue holdout gate hosts the provisioner) | **No** (it receives endpoint URLs from the handle, never the engine) |

Two invariants fall out of the grid and must be stated explicitly in both deliverables:

- **The evaluator ceiling:** the evaluator's complete visible set is an engine credential + the env-handle contents (endpoints, synthetic credentials) + the spec text. Nothing else — no forge credential, no tracker key, no project secrets, no engine context. This is exactly the "minimally scoped env" the isolation ladder's rung 2 already commits the outer layer to launching the evaluator cage with; the matrix row is the specification that env is scoped *to*.
- **The holdout seam is two-sided:** the evaluator never sees the implementor's classes (forge/tracker/project), and the implementor never sees the evaluator's (synthetic SUT credentials). Code-blindness already has its structural mechanism (fresh process, no repo path); this matrix adds the credential half of the same seam.

**Chosen:** the cell values above. The evaluator column restates what ADR-0041 rung 2 already decided; the implementor's tracker **No** aligns with the shipped lane-isolation table's Tracker = No rather than inventing a new position; the orchestrator's project-secrets **No** follows from "it sequences, doesn't build" — it is the one cell not forced by an existing decision, and least-privilege decides it.

### Naming & handling idiom

The matrix canonises the existing `api_key_env` pattern as the rule for every class: config and docs carry env-var **names**; **values** live only in the process environment; values never appear in `.faffrc`, on command lines (helpers resolve `process.env[name]` internally), in tracker comments, in PR logs, or in any committed file. The env-handle's no-persist rule ("runtime-consumed and must not be persisted to the tracker or PR logs") generalises from synthetic credentials to all six classes.

**Chosen:** generalise `api_key_env` + the env-handle no-persist rule to all classes — both idioms are shipped, tested behaviour; the matrix names them as the invariant rather than inventing a new handling scheme.

## 4. HOW — Deliverables and their shape

### Enforcement posture per rung (settled context, restated — not re-decided)

The ADR must record the posture per isolation-ladder rung, taking ADR-0041's decisions as given:

- **Today (rungs 0–1):** the matrix is **normative, not enforced** — one shared cage, one shared env; ADR-0010:46's posture stands (secrets cross the one container boundary as explicitly-forwarded env). A breach is a convention violation caught by review and attestation, not a mechanical block. faff builds nothing here.
- **Rung 2 (fired for L4; FAFF-276 builds it):** the **evaluator row becomes physically enforced** — the outer layer launches the evaluator cage with the minimally scoped env; faff's part is a `container-check`-shaped assert-and-refuse at lane entry, which rides with FAFF-276's build decisions, not this ticket.
- **Rung 3 (not fired):** the **full matrix becomes physically enforceable** — per-lane cages, per-lane credentials. Its trigger is partly this matrix needing physical enforcement; when it fires it formally reopens ADR-0010 via that ADR's own :48(a) escalation trigger. This ticket's ADR sharpens the trigger by existing (the matrix is now a concrete thing that can "need enforcement") and changes nothing else about it.

**Chosen:** restate the three-step posture exactly as ADR-0041 fixed it, with this ADR adding only the matrix content — any drift from ADR-0041's rung semantics in the new ADR is a defect, and the spec deliberately gives the build agent no latitude here.

### Deliverable 1 — the ADR

Author via the standard flow at graft time: `faff adr new --title <title> --issue FAFF-32`, number resolved then via `faff adr next-number` (0048 at the time of writing; may move — never hardcode it, and re-check at the merge gate per the ADR-numbering re-validation that repo CI enforces). Nygard shape (Status/Date/Issue → Context/Decision/Consequences). Content outline:

```
CONTEXT:   the lane-isolation table fixed code/tracker/spec/env visibility but not
           secrets; ADR-0010:47 delegated the within-cage boundary to FAFF-32;
           ADR-0041 fixed WHEN it becomes enforceable; FAFF-104 is blocked on WHAT.
DECISION:  1. the six secret classes
           2. the three-lane matrix (the table above, verbatim cells)
           3. the helper narrowing rule
           4. the evaluator-ceiling + two-sided-holdout invariants
           5. the naming/handling idiom (names-in-config, values-in-env, no-persist)
           6. the enforcement posture per rung (normative now / evaluator row at
              rung 2 via FAFF-276 / full matrix at rung 3, reopening ADR-0010:48(a))
           7. the contract split: matrix = fixed contract; store/injection =
              FAFF-104's swappable producer
CONSEQUENCES:
           - FAFF-104 unblocks: it designs injection to satisfy these cells,
             changing no cell
           - rung 3's trigger is sharpened, not fired
           - no enforcement ships from this ADR (assert-don't-implement per
             ADR-0017; the rung-2 assertion rides with FAFF-276)
           - revisit: if a lane's real flow needs a cell this matrix denies,
             amend the matrix by ADR before granting, never grant quietly
```

**Chosen:** one ADR via `faff adr new` at graft time, per the established design-ticket precedent (FAFF-313's spike landed the same way: docs + ADR, no build).

### Deliverable 2 — the gateway edit

Extend `plugin/skills/faff/SKILL.md` → ## Agent Lanes → ### Lane isolation. Two options for shape:

- A new **Secrets** column on the existing table — compact, but the secret dimension has six classes; one cell per lane collapses the grid that *is* the deliverable, and it perturbs a table other prose cross-references.
- An **adjacent sibling table** immediately after the existing table — keeps the shipped table byte-stable, carries the per-class grid intact.

**Chosen:** sibling table, placed directly after the existing lane-isolation table and before the "This isolation prevents:" list, introduced by one lead-in line (e.g. "The same controlled visibility extends to secrets and environment data:"). Follow it with at most three prose lines carrying: (1) the evaluator ceiling stated in words, (2) the helper narrowing rule, (3) the posture — self-contained, no ADR/ticket references (e.g. "Today all lanes share one container environment, so this matrix is a convention the flows honour and review checks; per-lane cages make it physical when they arrive."). Rationale: the grid is the deliverable and survives intact; the existing table stays stable for its cross-references; the gateway is always-loaded so the addition is capped lean (one table + ≤4 lines), with full rationale living in the ADR.

The edit must pass `faff validate-adapters` (line caps, paragraph length, duplicated-block lint) and must not duplicate ADR prose — the gateway states the rule forward, the ADR holds the why.

**Anti-pattern:** citing the new ADR from the gateway prose ("see ADR-0048 for details"). Why: executed prose must be self-contained; an ADR reference in `SKILL.md` is either decorative (delete it) or load-bearing (inline the meaning instead).

**Anti-pattern:** copying the six-class definitions into the gateway in full. Why: the gateway needs the grid and the two invariants, not the taxonomy rationale; duplication is what the lint and the authoring standard exist to stop.

### Failure modes

- **The failure:** a matrix cell is wrong about a lane's real needs — e.g. some implementor flow genuinely exercises tracker authority beyond the harness-level tool, or the orchestrator turns out to need a project secret. Wrong cells are invisible today (shared env masks them) and only bite when a rung physically enforces the row.
- **How you'd know:** at rung 2/3, a lane's cage refuses at preflight or a flow fails mid-run on a missing var that the shared cage had silently provided.
- **What it means:** amend the matrix by a superseding/amending ADR before widening any cage env — the revisit consequence above exists precisely so the fix is a recorded decision, not a quiet env edit. This is a proceed-with-recorded-correction outcome, not an abandon signal.

## Scenarios

Given the merged ADR, when FAFF-104's spec author reads it with no other context, then every lane × secret-class pair has an unambiguous may-see/may-not value (no blank, TBD, or "it depends" cell), and the fixed-contract/swappable-producer split is stated — FAFF-104 can design injection without reopening any cell.

Given the edited gateway, when `faff validate-adapters` and a reviewer's self-containment check run, then the lint passes and no ADR/ticket reference appears in the added lane-isolation prose.

Given the edited gateway's sibling table and the new ADR's matrix, when the two are compared cell by cell, then they are identical — one grid, two homes, no drift.

Constraint: no secret *value* (real or plausible-looking) appears anywhere in either deliverable — env-var names only.

## Design Decision Rationale

- **Six secret classes, adversarial keys folded into engine credentials.** Options: keep the ADR-0010:46 four-class set (misses the two evaluator-flow classes that motivated the ticket); per-key rows (rots as keys churn). **Chosen:** six classes — stable categories, instances stay in operator config.
- **Three lane rows + helper narrowing rule.** Options: per-helper rows (rots with every slot swap); ignore helpers (leaves `review-call.mjs`/evaluate-call ungoverned — the very processes that touch keys). **Chosen:** lanes own ceilings, helpers inherit narrowed.
- **The matrix cells.** Nearly all cells are forced by shipped decisions (lane table, rung-2 evaluator env, env-handle no-persist); the one free cell (orchestrator × project secrets) goes to **No** by least-privilege. **Chosen:** the grid as tabled.
- **Generalise `api_key_env` + no-persist as the handling idiom.** Option: defer all handling rules to FAFF-104 — but names-vs-values is a visibility property (what may appear where), not an injection mechanism, so it belongs to the contract side. **Chosen:** generalise.
- **Restate the rung posture verbatim from ADR-0041.** Option: leave posture out of the new ADR and cross-reference — but the ADR must be readable by FAFF-104 alone, and restating with attribution is the house rule for docs. **Chosen:** restate as settled context.
- **Sibling table over a new column in the gateway.** Rationale in HOW. **Chosen:** sibling table.
- **ADR minted at graft via `faff adr new`.** Option: hand-author with a hardcoded number — collides under concurrent grafts; the CLI + merge-gate re-validation exist for this. **Chosen:** CLI at graft time.

## Open Questions and Assumptions

**Open Questions:** none. The upstream ADRs close the architecture; the store/injection questions the ticket originally carried are FAFF-104's by explicit scoping.

**Assumptions:**

- **Assumes:** ADR-0041 stands Accepted and unamended at build time — the rung semantics this spec restates are load-bearing. Validation: read `docs/adr/0041-multi-cage-l4-*.md`, confirm Status: Accepted and no superseding ADR in the log.
- **Assumes:** the `faff adr` CLI verbs (`new`, `next-number`, `validate`) exist and work in the build worktree. Validation: run `faff adr next-number` before authoring (note: in a worktree, `faff` may resolve to the global install — invoke `node plugin/skills/faff/bin/faff` from the worktree to test the checked-out CLI).
- **Assumes:** per-project `.env.claude-box` remains the transport for project runtime secrets crossing the container boundary. Validation: confirm ADR-0010:46's wording is unchanged in the checked-out repo.

## DONE — Definition of Done

### From WHY
- [ ] No enforcement machinery, product code, or probe ships from this ticket — the diff touches only `docs/adr/` and `plugin/skills/faff/SKILL.md`

### From WHAT
- [ ] The new ADR defines exactly six secret classes as specified, with adversarial provider keys inside engine credentials
- [ ] The new ADR contains the three-lane × six-class matrix with every cell filled as tabled in this spec
- [ ] The helper narrowing rule, the evaluator ceiling, and the two-sided holdout invariant are each stated explicitly in the ADR
- [ ] The names-in-config / values-in-environment / never-persisted idiom is stated as applying to all six classes

### From HOW (ADR)
- [ ] ADR created via `faff adr new --issue FAFF-32`, number from `faff adr next-number` at graft time; `faff adr validate` passes
- [ ] The ADR records the per-rung posture (normative today under ADR-0010:46 · evaluator row enforced at rung 2 via FAFF-276 · full matrix at rung 3, formally reopening ADR-0010 via :48(a)) without altering any ADR-0041 rung semantics
- [ ] The ADR states the contract split: matrix = fixed contract, store/injection = FAFF-104's swappable producer
- [ ] The ADR's consequences include the amend-by-ADR revisit rule for wrong cells

### From HOW (gateway)
- [ ] A sibling secrets-visibility table appears in `plugin/skills/faff/SKILL.md` directly after the existing lane-isolation table, cell-identical to the ADR's matrix
- [ ] The added prose is ≤4 lines, self-contained, and contains no ADR/FAFF-NN references
- [ ] `faff validate-adapters` passes on the edited gateway
- [ ] The pre-existing lane-isolation table is byte-unchanged

### From Scenarios
- [ ] No secret value (real or example) appears in either deliverable — env-var names only

**Integration smoke test:**

```
1. In the build worktree: node plugin/skills/faff/bin/faff adr next-number → N
2. faff adr new --title "<matrix title>" --issue FAFF-32 → docs/adr/N-*.md created
3. Fill the ADR; run: node plugin/skills/faff/bin/faff adr validate → exit 0
4. Edit plugin/skills/faff/SKILL.md (sibling table); run:
   node plugin/skills/faff/bin/faff validate-adapters → exit 0
5. Diff check: git diff --stat shows only docs/adr/ + plugin/skills/faff/SKILL.md
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized (P4)** — No issues. Docs-only, two files (one CLI-scaffolded ADR + a capped gateway table), estimated small: comfortably inside the 1–3-day unit. The two deliverables are one decision rendered in two homes (cell-identical grids) — not a split candidate. And despite its small size, do **not** merge it back into FAFF-104: the fixed-contract / swappable-producer split is the point of the ticket — the matrix must exist before any injection mechanism is designed against it, and the two halves carry different risk profiles.

**Workstream fit (P1 + P5)** — One soft flag. The issue is co-owned with the **Security initiative** — a theme-shaped grouping (security is a capability area, not a shippable outcome), so sequencing *inside* that grouping is undefined. Why it matters little here: the issue's real delivery home is the contract→mechanism chain it heads (FAFF-32 → FAFF-104), which is coherent and sequenced; the consuming enforcement work already lives in an outcome-led project ("Trustworthy lights-out — harden & broaden"). Nothing to do for this build — but when the Security grouping is next groomed, this ticket's outcome home is that chain, not the theme. Named so a human can discount if the initiative boundary is deliberate.

**Deps surfaced (P6)** — Two findings.

1. **FAFF-276 / FAFF-384 referenced load-bearing in the spec, no tracker edge either direction.** What's there: the spec assigns the rung-2 evaluator-row enforcement to FAFF-276's build ("a `container-check`-shaped assert-and-refuse … rides with FAFF-276"), and the evaluator-ceiling invariant is *the specification* that cage env is scoped to. Live tracker (checked): FAFF-276 is Todo, blocks FAFF-384 ("Evaluator hard cage — rung-2 second slice"), and neither carries any relation to FAFF-32. Why it matters: whichever of FAFF-276/384 builds the minimally-scoped evaluator env + preflight should consume the merged matrix — without an edge, automation can sequence that build *before* the matrix merges, forcing it to invent its own ceiling. What to do: draw `FAFF-32 blocks FAFF-276` (or FAFF-384, wherever the env-scoping actually lands) — surface-only here; a human or tidy pass draws it. Does **not** block this build.
2. **Stale `relatedTo: FAFF-8` (Done).** The spec itself descopes that relationship as orthogonal ("injection-axis concerns … orthogonal to secret visibility"). Minor hygiene: drop or annotate the relation so the graph matches the spec's stated scope. The `Blocks FAFF-104` edge — the one that matters — is present and honest.

**Risk profile (P7)** — No de-risking spike needed. Low-risk by construction: docs-only diff, high confidence, zero Punts; every matrix cell except one (orchestrator × project secrets) is forced by already-shipped decisions, and the free cell is decided by least-privilege. The one real risk — wrong cells are latent under today's shared env and only bite when a rung physically enforces a row — is inherent to specify-above-the-rung, and the spec handles it proportionately (the amend-by-ADR revisit consequence: a recorded correction, not an abandon). Sequencing is risk-*right*: writing the matrix now, ahead of the rung-2 cage build, is exactly the early de-risking this principle wants — the enforcement work inherits a settled contract instead of surprising on an undefined one.

**Verdict through the lens:** well-shaped, correctly sized, correctly sequenced. Ship it; draw the FAFF-276/384 edge on the side.

confidence: high
spec-review: approve
