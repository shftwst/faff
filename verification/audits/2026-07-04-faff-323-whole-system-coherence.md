# Whole-system coherence audit — FAFF-323 (2026-07-04)

**The load-bearing model: faff's correctness rests on prose↔mechanism agreement.** faff is a prose-orchestrated system with deterministic contract anchors — skills are markdown prompts that *claim* what CLI gates enforce, refer back to a gateway that *claims* to be the single home of shared rules, and embody ADRs that *claim* to be implemented. Each PR reviews one seam; nothing routinely reviews the seams between the seams. This audit is that review: a single frontier reasoner (Fable 5) held the entire system — the gateway, all 28 sub-skill prompts, the CLI's help/selftest surface, all 41 ADRs, and the live tracker — in one sustained context and read it for drift across four axes.

**Method.** Whole-system read first, then deterministic verification of every candidate finding (`--selftest` tables, exit-code calibration, CLI-source greps, label-manifest and contract-dispatcher probes, live tracker relation fetches). A finding that dissolved under verification moved to the checked-and-clear appendix rather than being dropped. The draft findings were then put through the repo's own adversarial second-opinion review (a different model prompted to refute them); its challenges drove three severity reclassifications, four evidence strengthenings, and six additional probes — full dispositions in Appendix C. Severity: **defect** (behaviour diverges from a load-bearing claim now) · **drift** (two claims disagree; behaviour undetermined or latent) · **observation** (worth-confirming asymmetry).

## Coverage

- **Axis 1 — gateway ↔ sub-skill prose.** The gateway (`plugin/skills/faff/SKILL.md`, 1,015 lines) read in full against all 28 sub-skill/slot SKILL.mds, each read in full: faff-beep-boop, faff-graft, faff-prep, faff-tidy, faff-wtf, faff-map, faff-jot, faff-plot, faff-onboard, faffidavit-rendering, faffidavit-routing, faffter-dark-{adversarial-review, authoring-adaptors, concurrency-parallel, methodology-agile-delivery, nlspec, spec-review}, faffter-noon-{adr, architecture, concurrency-sequential, env-compose, evaluate, intake, methodology-thematic, review, ship, spec, spec-review}.
- **Axis 2 — contract surface.** All 14 `faff contract` dispatcher names (probed: unknown-name exit calibrated against a bogus name), all 14 `contracts/*.schema.json`, all `faff-contract:` block types named in prose (13) + the 3 CLI-emitted descriptor blocks, cross-referenced producer → block → schema → dispatcher → consumer. Disputed semantics verified against `faff runcheck --selftest` (13 cases), the label manifest (`faff labels --names`), `faff config` list parsing, and targeted CLI-source greps (`latestRunDir`, FAFF-229 attribution, `resolveAppetite`/`FAFF_APPETITE`).
- **Axis 3 — deps ↔ prose.** All 69 open Faff-team issues (65 Backlog + 4 Todo) swept for dependency language; all 10 dep-language candidates resolved (FAFF-32/33/37/40/104/119/165/279/330/332) plus the chain-shaped sentry-2 cluster (FAFF-324–328), with live relations fetched for FAFF-40, 104, 165, 279, 326, 330, 332.
- **Axis 4 — ADRs ↔ code.** All 41 ADR statuses read; implementation anchors located for the L4 governance set (0007/0008, 0010, 0012, 0014, 0018–0021, 0022–0024, 0025–0028, 0030–0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041).

**Deterministic probes run (evidence base, all reproducible):** `faff config path` exit calibration (0 found / 3 none / 2 legacy-name / 3 example-only — the `.example` exemption and legacy loud-error hold); `faff next --selftest` (23 cases PASS); `faff eligible --selftest` (6 PASS); contract selftests — `spec-readiness` 4, `review-verdict` 5, `delivery-outcome` 6, `holdout-verdict` 12, `quality-gates` 9, `automation-routing` 5, `spec-review-verdict` 9, all PASS — plus a live malformed-signal probe (`{"signal":"banana"}` → coerced `needs-human`, never `pass`); `faff admissible --selftest` (14 PASS); `faff dod --selftest` (ok); `faff contain --selftest` (21 PASS); `faff runcheck --selftest` (13 PASS); `faff labels --names` (the 5-label manifest); dispatcher known-names calibration against a bogus name; `.github/workflows/validate.yml` read — `validate-adapters`, `lint-refs`, `lint-cli-doc`, and the selftest battery genuinely run in CI, so the gateway's "enforced mechanically" claims hold; `scripts/link-skills.sh` + `setup-worktree.sh` skimmed — the worktree-root resolution order (env → rc key → `~/.faff/worktrees/<repo>`) matches the gateway Worktree policy exactly; the `faff contract` dispatcher's `spec-review-verdict` entry confirmed live logic (`bin/faff:5461,6226`), not a dead name. **Named, not read:** the CLI's remaining ~12k lines beyond the greps above, and the eval harness — per the spec's "no correctness proof of the CLI" scope.

---

## Defects

### D1 — The `spec_review` slot and its fixed contract are missing from the gateway that everything refers back to

- **Artifacts:** `plugin/skills/faffter-noon-spec-review/SKILL.md:79` ("The fixed verdict shape … and its validation live in the gateway's contract-as-code surface") and `plugin/skills/faff-prep/SKILL.md` (Spec-review gate: "resolve `faff config get slots.spec_review`") **vs** `plugin/skills/faff/SKILL.md:199–215` (the canonical slot-defaults table — no `spec_review` row) and `plugin/skills/faff/SKILL.md:861–1010` (Core contracts and adaptor slots — no "Spec-review verdict (fixed)" section).
- **Drift:** the slot is fully implemented — `faff contract spec-review-verdict` exists (dispatcher-known, selftest passes 9 cases), two occupants ship (`faffter-noon-spec-review`, `faffter-dark-spec-review`), faff-prep consumer-folds it, `faff spec-review-lenses` cost-gates it, and the lights-out preflight probes it — but the gateway, which the conformance machinery names as the single home of fixed contracts ("the contract is the gateway's, never the adaptor's", `faff/SKILL.md:875`), never defines the slot or the contract. Both occupants' refer-backs point at a gateway section that does not exist; the authoring checklist (`faffter-dark-authoring-adaptors/SKILL.md:46`, item 2) requires exactly that refer-back to resolve. The `grounding` slot (ADR-0040, `faff-contract:grounding-evidence` named in FAFF-330) is missing from the same table.
- **Fix/ticket:** add a `spec_review` row (default `faffter-noon-spec-review`) and a `grounding` row to the gateway slot table, and a "Spec-review verdict (fixed)" section under Core contracts (verdict enum, objections shape, founded-verdict invariant). → **T1**

### D2 — The agile lens instructs a tag the label CLI refuses

- **Artifacts:** `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md:245` ("File prerequisite/follow-up tickets … tagged `faff-methodology-fill`") **vs** `faff labels --names` = exactly `faff-automate, faff-automation-hold, faff-parked, faff-jot-intake, faff-chain-gap-fill` and `plugin/skills/faff/SKILL.md:758` ("it validates `<label>` against the manifest (rejecting any non-control label)").
- **Drift:** every control-label mutation must run `faff label add` (`faff/SKILL.md:758`), which rejects `faff-methodology-fill` — the lens's instructed write path cannot execute as written. Either the tag silently never happens, or an agent bypasses the sanctioned op (worse).
- **Fix/ticket:** add `faff-methodology-fill` to the manifest, or re-point the lens at `faff-chain-gap-fill` (the semantics overlap — both are machine-filed gap tickets). → **T2**

### D3 — `repeat-parked` demotion tag: not in the manifest, not even faff-prefixed

- **Artifacts:** `plugin/skills/faff-tidy/SKILL.md:136,264` and `plugin/skills/faffter-noon-methodology-thematic/SKILL.md:47,97` ("Demote to Backlog, tag with `repeat-parked` (or tracker equivalent)") **vs** the manifest (D2 above) and the control-label convention (`plugin/skills/faff/SKILL.md:334`: "Every faff-owned control label is `faff-…`-prefixed").
- **Drift:** three prose sites instruct tagging demoted issues `repeat-parked`; the tag violates the naming convention the gateway declares closed, is absent from the manifest, and is therefore refused by the one sanctioned write op. Same failure class as D2, with an added convention breach.
- **Fix/ticket:** mint `faff-repeat-parked` in the manifest and update the three prose sites. → **T2**

### D4 — The beep-boop run-directory name is pinned nowhere, and three consumers disagree with practice

- **Artifacts:** `plugin/skills/faff/SKILL.md:511` documents `runs/YYYY-MM-DD-beep-boop-HH-MM-SS/`; `plugin/skills/faff-wtf/SKILL.md:60` enriches from `.faff/runs/*-beep-boop-*/summary.md`; `plugin/skills/faff/bin/faff:887–895` (`latestRunDir`) does a naked lexical sort with the comment "run-ids are date-prefixed → lexical == chronological" **vs** the actual on-disk population: every run since late June is `run-YYYYMMDD-HHMMSS-beepboop-<mode>` (no hyphens in "beepboop"), coexisting with twelve legacy `YYYY-MM-DD-beep-boop-*` dirs.
- **Drift:** (a) **defect** — wtf's glob matches **zero** current run dirs (the literal substring `beep-boop` cannot match `beepboop`) — every recent autonomous park loses its log-path enrichment silently; (b) **defect, observed live** — `latestRunDir` is a naked `cands.sort()[cands.length - 1]` (`bin/faff:894` — no date extraction, disproving the charitable mtime-sort reading), so any future doc-format dir sorts *before* all `run-*` dirs and budget/runcheck/Stop-hook resolve a stale "latest" ledger (this exact failure was observed live on 2026-06-30); (c) **drift** — beep-boop's own SKILL.md never mints a canonical format, so nothing prevents a third variant. (Sub-severities split per the adversarial review — the bundle is one root cause, an unpinned format.)
- **Fix/ticket:** pin one canonical run-id format in beep-boop's Run ledger section; update the gateway layout, wtf's glob, and the CLI's `STRAY_TRANSCRIPT` regex (`bin/faff:3159`); make `latestRunDir` order by mtime or a normalised date key. → **T3**

### D5 — beep-boop's Stop-hook prose still describes pre-softening semantics ("abandoned may block")

- **Artifacts:** `plugin/skills/faff-beep-boop/SKILL.md:309` ("audits-and-may-block only when the resolved run is one this session owns **or** is **genuinely abandoned**"; "A legacy ledger with no `owner` is … audited exactly as before (zero regression)") **vs** `faff runcheck --selftest`, whose table rows state it directly: "`not-owned + stale heartbeat + undispatched → WARN, not block (abandoned still surfaced)`", "`not-owned + status:done + undispatched → WARN, not block`", "`legacy ledger (no owner) + undispatched → WARN, not block (no foreign hard-block)`"; only "`owned + undispatched → block`" and "`--recover on a foreign not-held undispatched run → block`" hard-block.
- **Drift:** the CLI was deliberately softened (foreign not-held runs warn instead of blocking) and the skill prose was not updated — a reader of the prose expects an abandoned foreign queue to hard-block session end; it doesn't, and "audited exactly as before" is now false for the legacy case.
- **Fix/ticket:** rewrite the Ownership + liveness gate paragraph to the warn-not-block semantics, keeping the owning-session backstop + `--recover` escape hatch. → **T4**

---

## Drift

### R1 — The gateway's front page says L4 is "Not built yet" while the L4 runner ships

- **Artifacts:** `plugin/skills/faff/SKILL.md:26` ("L4 · out of the loop. … The frontier. Not built yet, mind.") **vs** `faff lights-out` (the shipped L4 entry point: fail-closed preflight over 8 guardrail contracts, L4 ledger mint, banner) and ADR-0036 (Accepted).
- **Drift:** the always-loaded gateway's levels narrative — the first thing every session reads — denies the existence of machinery the same file's ecosystem ships and the ADR log accepts. Autonomous decisions keyed off "L4 isn't real yet" framing would be wrong. (The adversarial review offered a scope-reading — "not built yet" meaning the *complete* L4 vision rather than the v1 — which is exactly why the fix names `faff lights-out` *with its v1 caveats* rather than deleting the hedge: either reading is resolved by naming what exists.)
- **Fix/ticket:** update the levels table/bullet to name `faff lights-out` as the L4 entry point with its v1 caveats. → **T5**

### R2 — The thematic lens carries its own, contradictory copy of conflict analysis

- **Artifacts:** `plugin/skills/faffter-noon-methodology-thematic/SKILL.md:188–194` (`build-queue` → "Conflict analysis (safe for parallel): … 2. Specs name same **top-level directory** → collision", listing 4 heuristics) **vs** `plugin/skills/faff-beep-boop/SKILL.md:353` (heuristic 2: "A shared *top-level* directory alone is **not** a collision … top-level matching spuriously serialises half the queue") plus beep-boop's heuristics 3 (named shared surface) and 6 (inferred producer→consumer — homed in conflict analysis *by ADR-0006 precisely so it holds under the thematic default*).
- **Drift:** a silent duplicate instead of a refer-back, and the duplicate contradicts the canonical rule in the exact direction the canonical rule warns against (spurious serialisation), while omitting two heuristics — including the one whose methodology-agnostic homing was the point of an accepted ADR.
- **Fix/ticket:** replace the thematic `build-queue` conflict-analysis recap with a refer-back to beep-boop's Conflict analysis. → **T6**

### R3 — Two owners for the review-iteration cap, disagreeing at the shipped appetite

- **Artifacts:** `plugin/skills/faff-graft/SKILL.md:456` ("Loop until `pass` or `needs-human` (**cap at 3 iterations**…)") **vs** `plugin/skills/faffter-noon-review/SKILL.md:143` ("Review→fix→review iterations before escalation: 1 / 3 / 5 / 10" by appetite — appetite governs persistence).
- **Drift:** at the repo's configured `appetite: high` the reviewer's contract says 5 iterations; graft hardcodes 3. Whichever is intended, one of the two is dead prose, and a swapped review occupant inherits the ambiguity. (The adversarial review proposed the two numbers count different units — graft-level cycles vs reviewer-internal passes. Refuted by the reviewer's own wording at `faffter-noon-review/SKILL.md:145`: "Appetite governs **persistence** — how many **fix→review cycles the pipeline attempts** before escalating" — the pipeline's fix→review loop *is* the loop graft's cap bounds; same unit, different numbers.)
- **Fix/ticket:** pick one owner (the appetite-scaled table is the more principled: persistence is an appetite dial) and make graft consume it. → **T7**

### R4 — beep-boop's token-accounting prose describes the superseded attribution rule

- **Artifacts:** `plugin/skills/faff-beep-boop/SKILL.md:69` ("plus every child `agent-*.jsonl` **modified ≥ run start** … undercounts but never overcounts") **vs** `plugin/skills/faff/bin/faff:2365–2377,2609` + the `budget check` help ("child `agent-*.jsonl` whose own **sessionId == this run's** (mtime is a cheap pre-filter only, NOT the attribution gate — FAFF-229)").
- **Drift:** the CLI moved to sessionId attribution precisely because the mtime window the prose still describes *could* overcount cross-session children — the prose's "never overcounts" guarantee is now delivered by a mechanism it doesn't mention and contradicts.
- **Fix/ticket:** update the Token-accounting bullet to the sessionId rule. → **T4**

### R5 — The ADR log's Status field is not maintained: ≥10 shipped-but-Proposed, and one acceptance inversion — **severity: defect** (reclassified up from drift by the adversarial review: a decision *record* whose status fields are wrong now is diverging behaviour, not latent disagreement)

- **Artifacts:** `records/adr/` status sweep: 15/41 `Proposed` — including 0009 (write-abstention → shipped as the label CLI's tracker-owned refusal), 0012 (→ `faff contain`), 0014 (→ the COMMANDS registry + `lint-cli-doc`), 0018–0021 (→ `faff dod classify` / `admissible` / container-status), 0022–0024 (→ `faff prdr admit`/`yagni`/`coverage`), 0025–0028 (→ the `spec_review` slot + `spec-review-lenses`), 0034 (→ `faff sentry`), 0035 (→ the gateway Topology-write-authority dial), 0037 (→ `resolveAppetite`/`FAFF_APPETITE`, 9 hits in `bin/faff`) **vs** each named shipped mechanism.
- **Drift:** the record says "proposed" for machinery that is load-bearing in production paths; and ADR-0039 (sentry-2, **Accepted**) explicitly builds on ADR-0034 (sentry-1, still **Proposed**) — an acceptance-order inversion that makes the log incoherent as a decision history. `faff adr validate` checks numbering/headers/back-refs but nothing catches status rot.
- **Fix/ticket:** one status-sweep pass (accept or annotate each shipped-but-Proposed ADR; fix the 0034/0039 inversion), plus consider an `adr validate` advisory when a Proposed ADR is cited as the deciding record by an Accepted one. → **T8**

### R6 — ADR-0037's L4-appetite pin is implemented in the CLI but invisible in the gateway's Appetite section

- **Artifacts:** `records/adr/0037` (appetite is level-scoped; L4 resolves `full` via `resolveAppetite` precedence env `FAFF_APPETITE` → L4 ledger → config) + `bin/faff` (implemented, 9 hits) **vs** `plugin/skills/faff/SKILL.md:630–686` (the Appetite section: a single global dial, "Set `appetite:` in `.faffrc` … global per project" — no L4 mention).
- **Drift:** ADR-0037's own Consequences warn that "a consumer that bypasses the channel (hardcodes/caches config) would leak" — and the gateway, the one prose surface every consumer reads, still teaches the un-pinned model. (Compounding R5: the ADR itself is still `Proposed` while its machinery ships.)
- **Fix/ticket:** add the level-scoping rule to the gateway Appetite section (one paragraph: resolution channel + L4 pin). → **T9**

### R7 — Deps-in-prose without edges: two live instances, both with since-shipped blockers — **severity: observation** (reclassified down from drift by the adversarial review: in both live instances the graph is now *correct* — no dependency remains — and only the prose is stale; graph-readers get the right answer, so this is prose hygiene, though each began life as a genuine missing-edge instance while its blocker was open)

- **Artifacts:** FAFF-40 description ("**FAFF-245 (*blocks this*)**" and "*Blocked on FAFF-245*") **vs** its live relations (`blockedBy: []`, FAFF-245 only `relatedTo` — and FAFF-245 is no longer in the open set, i.e. shipped). FAFF-165 description ("owned by FAFF-164, **which this is blocked-by**") **vs** its live relations (`blockedBy: []`; FAFF-164 shipped).
- **Drift:** the recurring deps-in-prose hazard, live in 2 of the 10 dep-language candidates: graph-readers (`faff next`, map, unlock-value) say "ready" while prose-readers (prep) say "blocked" — and in both cases the prose is *also* stale (the named blocker has shipped). The newer tickets (FAFF-326/330/104) all carry correct edges, so the discipline now holds; these are legacy captures.
- **Fix/ticket:** update FAFF-40 + FAFF-165 prose (blockers shipped — drop the blocked framing); no new edges needed. Reverse direction (edges with no rationale): none found in the sampled set — every fetched edge carries prose rationale. → **T10**

### R8 — Executors describe the build-subagent outcome domain as "six ledger buckets"; the gateway contract fixes four

- **Artifacts:** `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md:34` ("`outcome` is one of the existing six ledger buckets (`shipped`/`pr-open`/`parked`/`errored`/`routed-out`/`unreached-budget`)") and `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md:31` (same claim) **vs** `plugin/skills/faff/SKILL.md:1006` (concurrency-contract obligation 3: record "as one of the fixed buckets `shipped` / `pr-open` / `parked` / `errored`").
- **Drift:** `routed-out` and `unreached-budget` are orchestrator dispositions written at queue assembly/budget fire — a build subagent can never legitimately return them. The executors' wording invites exactly the invalid-outcome ledger writes `runcheck` exists to flag (the ledger *file* accepts six values; the *TerminalToken* domain is four).
- **Fix/ticket:** correct both executors' sentences to the four build buckets. → **T11**

---

## Observations

### O1 — The `architecture` slot has no call-site — **severity: drift** (reclassified up from observation by the adversarial review: a documented, occupant-shipped, conformance-validated capability that no pipeline path can reach is the system claiming a capability it doesn't wire, not an open question)

- **Artifacts:** `plugin/skills/faff/SKILL.md:204` (the slot row: the PROPOSE box) + `faffter-noon-architecture` (shipped occupant, shipped contract) **vs** a grep over all 29 SKILL.mds: no skill resolves or invokes `slots.architecture` — only *consumers of its output* exist (beep-boop's holdout step 1 hands "the architecture proposal" to the env slot; evaluate reads env-handles).
- **Question:** where does the proposal enter the pipeline? Today the answer is "nowhere documented" — the box is reachable only by a human invoking the occupant by hand. → **T12**

### O2 — `faff contract prd-readiness` has no prose producer or consumer

- **Artifacts:** the dispatcher's known-names list (includes `prd-readiness`) + `contracts/prd-readiness.schema.json` **vs** grep over all SKILL.mds: zero mentions (only `docs/guide/cli.md` documents the subcommand).
- **Question:** consumed by the PRD flow outside the skill system, or orphaned? Either way the contract-as-code surface carries an entry the prose system never references. → **T13**

### O3 — The shipped `spec` occupant documents no quality bar

- **Artifacts:** `plugin/skills/faff-prep/SKILL.md` (Producer requirements: the producer must "(c) discharge its own quality bar — for `faffter-noon-spec` that's the clean-context self-review") **vs** `plugin/skills/faffter-dark-nlspec/SKILL.md`: no self-review / quality-bar section at all.
- **Question:** this repo's configured slot *is* `faffter-dark-nlspec` — so the active configuration has no documented discharge of the requirement prep names. Either dark-nlspec inherits noon-spec's self-review explicitly, or it documents its own. → **T14**

### O4 — graft Step 0 mandates a tool the harness no longer guarantees

- **Artifacts:** `plugin/skills/faff-graft/SKILL.md:58` ("use `TodoWrite` to create one todo per numbered step") **vs** current Claude Code harnesses exposing TaskCreate/TaskUpdate instead of TodoWrite (observed in this session's tool surface).
- **Question:** environment drift, not internal drift — the forcing-function intent survives; the tool name doesn't. Phrase it capability-generically. Explicitly **out of the four axes** (surfaced for completeness; not counted toward axis coverage). → **T15** (bundled)

### O5 — The rendering catalogue's "sixth form" guard went stale when the sixth form landed

- **Artifacts:** `plugin/skills/faffidavit-rendering/SKILL.md:67` ("if a skill needs a **sixth** form, this section gains it first") **vs** the same file's catalogue (a)–(f) — already six forms (On-hold entry was added as (f)).
- **Fix:** "a new form". Trivial, but it's the closed-catalogue guard sentence itself. → **T15** (bundled)

### O6 — jot's interactor still justifies itself with a pre-advisory-model sentence

- **Artifacts:** `plugin/skills/faff-jot/SKILL.md:88` ("the orchestrator lane … already has tracker write … so **mutating a label** on an existing ticket is within-lane") **vs** `faff-jot/SKILL.md:105` (step 3: the labels are tracker-owned; "faff never executes the write").
- **Drift:** the remit paragraph's rationale describes the pre-write-abstention design; three steps later the same skill correctly says no label write ever happens. Internal contradiction, cosmetic but in the section defining the interactor's authority. → **T15** (bundled)

### O7 — Declining the first-run offer permanently locks the front door to onboarding

- **Artifacts:** `plugin/skills/faff/SKILL.md:66` (decline → write a stub `.faffrc.yaml` so the offer never re-fires) **vs** `plugin/skills/faff-onboard/SKILL.md:47` (bail: "Exit 0 — a config already exists … report that faff is already set up … and stop").
- **Gap:** a human who declined once and later deliberately runs `/faff-onboard` is told faff "is already set up" — the decline-stub (one empty key) satisfies the bail check, and onboard's own rule mandates the stop ("report … and **stop**. Onboarding never overwrites a live config", `faff-onboard/SKILL.md:47`). A conversational override is possible in practice, but the prose directs a stop — a misleading front door, not a hard lockout. The bail should distinguish a decline-stub from a real config. → **T15** (bundled)

### O8 — Descriptor blocks vs contract scripts: an undocumented two-class split

- **Artifacts:** `faff-contract:infra-profile` / `intake-record` / `label-op` blocks are CLI-emitted with **no** `faff contract` validator (probed: unknown to the dispatcher) — validated instead via `faff profile validate` or trusted by construction (CLI-emitted descriptors); the other block types all have dispatcher entries.
- **Assessment:** coherent by design (trusted-source emission needs no consumer-side re-validation) but stated nowhere; an author adding a fourth descriptor block has no rule to follow. Surface-only.

---

## Checked and clear

Candidates probed and dissolved — recorded for coverage honesty:

- **ADR-0039 corrective authority "unimplemented":** Accepted with implementation deliberately ticketed (FAFF-325 → FAFF-326 → FAFF-328, correct `blockedBy` chain live in the tracker; sentry's v1 "never `correct`" guard is explicitly the seam FAFF-326 extends). Coherent decision-then-build sequencing, not drift.
- **Recent dep discipline:** FAFF-330 ("Blocked by FAFF-127" + edge ✓), FAFF-326 (prose + edge ✓, blocks FAFF-328 ✓), FAFF-104 (hard-input prose + edge ✓), FAFF-332 (explicitly "non-blocking follow-up", edge-free ✓), FAFF-279 (no prose dep; itself documents the inverse stale-Done-edge hazard).
- **`adversarial.fallbacks` as a native YAML list:** parses correctly (`faff config get` returns the list) — the parser handles sequences; the skill's note that the JSON-string form is canonical-but-not-required is accurate.
- **Heartbeat/liveness prose ↔ CLI:** gateway, graft (Step 7.5/9 ticks), both executors, and `faff heartbeat`'s field-merge/no-op semantics are consistent (single sanctioned write path; pid never consulted — matches the selftest). The parallel executor honestly flags its unresolved N-writer heartbeat punt.
- **Eligibility/write-abstention threading:** gateway ↔ graft's mechanical gate ↔ jot/tidy/prep advisory crank-ups ↔ `faff label`'s tracker-owned refusal all agree (single leftover sentence is O6).
- **Producer→consumer chains for `spec-readiness`, `review-verdict`, `quality-gates`, `delivery-outcome`, `env-handle`, `holdout-verdict`:** producer block shape, consumer fold, coercion direction (malformed → never the passing state) consistent end-to-end, including ship's uncorroborated-`shipped`→`failed` fixture.
- **`faff next` / `eligible` flag vocabularies** as used by beep-boop/tidy/wtf/graft/prep: consistent (repeated `--label` vs `intakecheck`'s single `--labels` csv is documented at both call-sites).

## Proposed follow-on tickets

One entry per actionable finding cluster; the orchestrator files these as execution-discovered scope (containment-checked, appetite-gated, deduped).

1. **T1 — Gateway: add the `spec_review` + `grounding` slots and the fixed spec-review-verdict contract section** — close D1's dangling refer-backs (axis 1/2).
2. **T2 — Reconcile the control-label manifest with lens/tidy tagging prose** — add `faff-methodology-fill` (or re-point to `faff-chain-gap-fill`) and mint `faff-repeat-parked`; update the three prose sites (D2, D3; axis 2).
3. **T3 — Pin the canonical beep-boop run-id format everywhere** — beep-boop mint rule, gateway layout, wtf glob, `STRAY_TRANSCRIPT`, and a legacy-robust `latestRunDir` (D4; axis 2).
4. **T4 — Update beep-boop prose to shipped CLI semantics** — Stop-hook warn-not-block (FAFF-235) and sessionId token attribution (FAFF-229) (D5, R4; axis 1).
5. **T5 — Retire the gateway's "L4 not built yet" framing** — name `faff lights-out` in the levels narrative (R1; axis 1/4).
6. **T6 — Thematic lens: refer back to beep-boop's conflict analysis instead of carrying a contradictory copy** (R2; axis 1).
7. **T7 — Single-owner the review-iteration cap** — graft consumes the reviewer's appetite-scaled persistence (R3; axis 1).
8. **T8 — ADR status sweep** — accept/annotate the shipped-but-Proposed set; fix the 0034/0039 inversion; optional `adr validate` advisory (R5; axis 4).
9. **T9 — Gateway Appetite section: document the ADR-0037 L4 pin + resolution channel** (R6; axis 1/4).
10. **T10 — Fix stale prose blockers on FAFF-40 and FAFF-165** (R7; axis 3).
11. **T11 — Executors: correct the TerminalToken outcome domain to the four build buckets** (R8; axis 1).
12. **T12 — Wire or future-fence the `architecture` slot call-site** — decide where the PROPOSE box is invoked (prep? plot? lights-out?) and document it (O1; axis 2).
13. **T13 — Document or retire `faff contract prd-readiness`'s producer/consumer** (O2; axis 2).
14. **T14 — Give `faffter-dark-nlspec` a documented quality bar** — inherit noon-spec's self-review explicitly or define its own (O3; axis 1).
15. **T15 — Docs-tidy bundle:** graft's TodoWrite → capability-generic wording (O4); rendering "sixth form" → "a new form" (O5); jot interactor's within-lane sentence (O6); onboard decline-stub re-entry (O7); document the descriptor-block vs contract-script class split (O8 — promoted from surfaced-only after the adversarial review noted it is exactly as actionable as O2) (axes 1+2).

These fifteen proposals are mirrored to `.faff/runs/run-20260703-211900-beepboop-list/FAFF-323/discovered-scope.json` (15 concrete entries + the O8 entry, gitignored under `.faff/` by design — the mirror is the orchestrator's filing input, not a PR artifact).

## Appendix A — Contract cross-reference (the axis-2 evidence table)

Producer → block → schema → `faff contract` dispatcher entry → consumer. **KEY:** ✓ = present/verified · — = none by design · **✗ = the gap the finding names**.

| Block / name | Producer | Schema file | Dispatcher | Consumer | Verdict |
|---|---|---|---|---|---|
| `spec-readiness` | `faffter-noon-spec`, `faffter-dark-nlspec` | ✓ | ✓ (selftest 4) | faff-prep consumer-fold | clean |
| `review-verdict` | `faffter-noon-review`, `faffter-dark-adversarial-review` | ✓ | ✓ (5) | faff-graft Step 9 | clean |
| `quality-gates` | `faff gates run` (CLI) | ✓ | ✓ (9) | faff-graft Step 7.5 | clean |
| `delivery-outcome` | `faffter-noon-ship` | ✓ | ✓ (6) | faff-graft Step 10 | clean |
| `spec-review-verdict` | `faffter-noon-spec-review`, `faffter-dark-spec-review` | ✓ | ✓ (9; live entry `bin/faff:5461,6226`) | faff-prep spec-review fold | **✗ gateway home missing → D1** |
| `architecture-proposal` | `faffter-noon-architecture` | ✓ | ✓ | *no invoking skill* | **✗ orphaned call-site → O1** |
| `env-handle` | `faffter-noon-env-compose` | ✓ | ✓ | evaluator + beep-boop 10b | clean |
| `holdout-verdict` | `faffter-noon-evaluate` | ✓ | ✓ (12) | `faff holdout verdict(s)`, graft holdout gate | clean |
| `automation-routing` | computed (`faffidavit-routing` extraction) | ✓ | ✓ (5) | routing adaptor validate | clean (computed, not producer-emitted — documented) |
| `prd-readiness` | *none named in any SKILL.md* | ✓ | ✓ | *none named* | **✗ orphaned surface → O2** |
| `prdr-admission` / `prdr-yagni` / `prd-coverage` / `run-termination` | `faff prdr admit`/`yagni`/`coverage`, `faff run-done` (CLI-emitted) | ✓ | ✓ | gateway PRDR flow / beep-boop 8.5 | clean (CLI-internal) |
| `infra-profile` | `faff profile mine` (CLI) | — | — (validated by `faff profile validate`) | orchestrator → `.faff/infra-profile.json` | clean by design → O8 (undocumented class) |
| `intake-record` | `faff intake-record` (CLI descriptor) | — | — (trusted CLI emission) | `faff intakecheck` reads the marker | clean by design → O8 |
| `label-op` | `faff label` (CLI descriptor) | — | — (trusted CLI emission) | agent executes the described write | clean by design → O8 |
| `grounding-evidence` | *future occupant (per ADR-0040 / FAFF-330)* | — | — | — | future-fenced; slot missing from gateway table → D1 |

## Appendix B — ADR status × implementation anchor (the axis-4 evidence table)

Accepted and coherent (anchor exists): 0001–0008, 0010, 0013, 0015–0017, 0029–0033, 0036, 0038, 0040 (decision-stage; occupant ticketed FAFF-330), 0041 (design settle). Accepted with implementation deliberately ticketed: 0039 (→ FAFF-325/326/328, edges verified live). **Proposed with shipped machinery (the R5/D-class set):** 0009 (`faff label` tracker-owned refusal), 0011 (`intakecheck` eligibility-gesture), 0012 (`faff contain`), 0014 (COMMANDS registry + `lint-cli-doc`), 0018/0019 (`faff dod classify` + born-verifiable recognition), 0020 (`faff admissible`), 0021 (container-status forward-only), 0022/0023/0024 (`faff prdr admit`/`yagni`/`coverage`), 0025/0026/0027/0028 (the `spec_review` slot + occupants + `spec-review-lenses`), 0034 (`faff sentry` — **inverted under Accepted 0039**), 0035 (the gateway topology-write dial), 0037 (`resolveAppetite`/`FAFF_APPETITE`).

## Appendix C — Adversarial-review dispositions

The draft findings were reviewed by the repo's own adversarial second-opinion chain (two passes; token budget raised for the second so nothing truncated). Every challenge, dispositioned:

- **"Axis-2 cross-reference asserted, not shown"** — **valid** → Appendix A added.
- **"discovered-scope.json asserted, not evidenced"** — **valid** → pointer + counts added above.
- **"O8 as actionable as O2 but unticketed"** — **valid** → folded into T15.
- **"D4b cites the comment, not the sort logic; maybe it sorts by mtime"** — **refuted with evidence**: `bin/faff:894` is `return cands.sort()[cands.length - 1]` — naked lexical sort; citation added.
- **"D5/R4 paraphrase the selftest/help rather than quoting"** — **valid** → D5 now quotes the three WARN-rows; R4's citation is the attribution *source* (`childOwningSession`, `bin/faff:2609`), not only help text.
- **"R3's two caps may count different units"** — **refuted with evidence**: `faffter-noon-review:145` defines its row as "fix→review cycles **the pipeline attempts**" — the same loop graft caps; quote added.
- **"R1's 'not built yet' may mean the complete vision, not v1"** — **partially accepted**: acknowledgment added; the fix (name `faff lights-out` + v1 caveats) resolves either reading.
- **"R7 is stale prose, not live drift — the graph is the authority and it's right"** — **accepted** → reclassified observation.
- **"R5 is a defect, not drift — the record is wrong now"** — **accepted** → reclassified defect.
- **"O1 is more than an observation — a claimed capability nothing wires"** — **accepted** → reclassified drift.
- **"D1 is drift, not defect — behaviour works, only the prose anchor is missing"** — **refuted**: the conformance *mechanism's* behaviour diverges now — a standalone-invoked occupant following its own refer-back instruction ("Read the sibling gateway → the named §") finds no section, and the occupants' non-normative recaps become authoritative-by-default, which the authoring checklist itself classes as a fail. Defect stands.
- **"O5/O6 are padding"** — **accepted as noted**: both stay in the T15 bundle, labelled trivial/cosmetic; neither counts toward the load-bearing yield.
- **"Six coverage holes (config resolver, next/eligible selftests, contract coercion, admissible/dod, contain) + CI-gate reality + the two shell scripts + dispatcher liveness"** — **valid, all probed**: results in the *Deterministic probes run* list above; all clean, converting the checked-and-clear prose claims into probe-backed ones.
