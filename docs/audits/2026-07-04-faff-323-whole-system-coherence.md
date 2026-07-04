# Whole-system coherence audit — FAFF-323 (2026-07-04)

**The load-bearing model: faff's correctness rests on prose↔mechanism agreement.** faff is a prose-orchestrated system with deterministic contract anchors — skills are markdown prompts that *claim* what CLI gates enforce, refer back to a gateway that *claims* to be the single home of shared rules, and embody ADRs that *claim* to be implemented. Each PR reviews one seam; nothing routinely reviews the seams between the seams. This audit is that review: a single frontier reasoner (Fable 5) held the entire system — the gateway, all 28 sub-skill prompts, the CLI's help/selftest surface, all 41 ADRs, and the live tracker — in one sustained context and read it for drift across four axes.

**Method.** Whole-system read first, then deterministic verification of every candidate finding (`--selftest` tables, exit-code calibration, CLI-source greps, label-manifest and contract-dispatcher probes, live tracker relation fetches). A finding that dissolved under verification moved to the checked-and-clear appendix rather than being dropped. Severity: **defect** (behaviour diverges from a load-bearing claim now) · **drift** (two claims disagree; behaviour undetermined or latent) · **observation** (worth-confirming asymmetry).

## Coverage

- **Axis 1 — gateway ↔ sub-skill prose.** The gateway (`plugin/skills/faff/SKILL.md`, 1,015 lines) read in full against all 28 sub-skill/slot SKILL.mds, each read in full: faff-beep-boop, faff-graft, faff-prep, faff-tidy, faff-wtf, faff-map, faff-jot, faff-plot, faff-onboard, faffidavit-rendering, faffidavit-routing, faffter-dark-{adversarial-review, authoring-adaptors, concurrency-parallel, methodology-agile-delivery, nlspec, spec-review}, faffter-noon-{adr, architecture, concurrency-sequential, env-compose, evaluate, intake, methodology-thematic, review, ship, spec, spec-review}.
- **Axis 2 — contract surface.** All 14 `faff contract` dispatcher names (probed: unknown-name exit calibrated against a bogus name), all 14 `contracts/*.schema.json`, all `faff-contract:` block types named in prose (13) + the 3 CLI-emitted descriptor blocks, cross-referenced producer → block → schema → dispatcher → consumer. Disputed semantics verified against `faff runcheck --selftest` (13 cases), the label manifest (`faff labels --names`), `faff config` list parsing, and targeted CLI-source greps (`latestRunDir`, FAFF-229 attribution, `resolveAppetite`/`FAFF_APPETITE`).
- **Axis 3 — deps ↔ prose.** All 69 open Faff-team issues (65 Backlog + 4 Todo) swept for dependency language; all 10 dep-language candidates resolved (FAFF-32/33/37/40/104/119/165/279/330/332) plus the chain-shaped sentry-2 cluster (FAFF-324–328), with live relations fetched for FAFF-40, 104, 165, 279, 326, 330, 332.
- **Axis 4 — ADRs ↔ code.** All 41 ADR statuses read; implementation anchors located for the L4 governance set (0007/0008, 0010, 0012, 0014, 0018–0021, 0022–0024, 0025–0028, 0030–0034, 0035, 0036, 0037, 0038, 0039, 0040, 0041).

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
- **Drift:** (a) wtf's glob matches **zero** current run dirs — every recent autonomous park loses its log-path enrichment silently; (b) `latestRunDir`'s invariant comment is false across the two formats — any future doc-format dir sorts *before* all `run-*` dirs, so budget/runcheck/Stop-hook resolve a stale "latest" ledger (this exact failure was observed live on 2026-06-30); (c) beep-boop's own SKILL.md never mints a canonical format, so nothing prevents a third variant.
- **Fix/ticket:** pin one canonical run-id format in beep-boop's Run ledger section; update the gateway layout, wtf's glob, and the CLI's `STRAY_TRANSCRIPT` regex (`bin/faff:3159`); make `latestRunDir` order by mtime or a normalised date key. → **T3**

### D5 — beep-boop's Stop-hook prose still describes pre-softening semantics ("abandoned may block")

- **Artifacts:** `plugin/skills/faff-beep-boop/SKILL.md:309` ("audits-and-may-block only when the resolved run is one this session owns **or** is **genuinely abandoned**"; "A legacy ledger with no `owner` is … audited exactly as before (zero regression)") **vs** `faff runcheck --selftest` (13/13 pass): foreign + stale-heartbeat/`status:done`/legacy-no-owner all yield **WARN, never block**; only an owning session or explicit `--recover` hard-blocks.
- **Drift:** the CLI was deliberately softened (foreign not-held runs warn instead of blocking) and the skill prose was not updated — a reader of the prose expects an abandoned foreign queue to hard-block session end; it doesn't, and "audited exactly as before" is now false for the legacy case.
- **Fix/ticket:** rewrite the Ownership + liveness gate paragraph to the warn-not-block semantics, keeping the owning-session backstop + `--recover` escape hatch. → **T4**

---

## Drift

### R1 — The gateway's front page says L4 is "Not built yet" while the L4 runner ships

- **Artifacts:** `plugin/skills/faff/SKILL.md:26` ("L4 · out of the loop. … The frontier. Not built yet, mind.") **vs** `faff lights-out` (the shipped L4 entry point: fail-closed preflight over 8 guardrail contracts, L4 ledger mint, banner) and ADR-0036 (Accepted).
- **Drift:** the always-loaded gateway's levels narrative — the first thing every session reads — denies the existence of machinery the same file's ecosystem ships and the ADR log accepts. Autonomous decisions keyed off "L4 isn't real yet" framing would be wrong.
- **Fix/ticket:** update the levels table/bullet to name `faff lights-out` as the L4 entry point with its v1 caveats. → **T5**

### R2 — The thematic lens carries its own, contradictory copy of conflict analysis

- **Artifacts:** `plugin/skills/faffter-noon-methodology-thematic/SKILL.md:188–194` (`build-queue` → "Conflict analysis (safe for parallel): … 2. Specs name same **top-level directory** → collision", listing 4 heuristics) **vs** `plugin/skills/faff-beep-boop/SKILL.md:353` (heuristic 2: "A shared *top-level* directory alone is **not** a collision … top-level matching spuriously serialises half the queue") plus beep-boop's heuristics 3 (named shared surface) and 6 (inferred producer→consumer — homed in conflict analysis *by ADR-0006 precisely so it holds under the thematic default*).
- **Drift:** a silent duplicate instead of a refer-back, and the duplicate contradicts the canonical rule in the exact direction the canonical rule warns against (spurious serialisation), while omitting two heuristics — including the one whose methodology-agnostic homing was the point of an accepted ADR.
- **Fix/ticket:** replace the thematic `build-queue` conflict-analysis recap with a refer-back to beep-boop's Conflict analysis. → **T6**

### R3 — Two owners for the review-iteration cap, disagreeing at the shipped appetite

- **Artifacts:** `plugin/skills/faff-graft/SKILL.md:456` ("Loop until `pass` or `needs-human` (**cap at 3 iterations**…)") **vs** `plugin/skills/faffter-noon-review/SKILL.md:143` ("Review→fix→review iterations before escalation: 1 / 3 / 5 / 10" by appetite — appetite governs persistence).
- **Drift:** at the repo's configured `appetite: high` the reviewer's contract says 5 iterations; graft hardcodes 3. Whichever is intended, one of the two is dead prose, and a swapped review occupant inherits the ambiguity.
- **Fix/ticket:** pick one owner (the appetite-scaled table is the more principled: persistence is an appetite dial) and make graft consume it. → **T7**

### R4 — beep-boop's token-accounting prose describes the superseded attribution rule

- **Artifacts:** `plugin/skills/faff-beep-boop/SKILL.md:69` ("plus every child `agent-*.jsonl` **modified ≥ run start** … undercounts but never overcounts") **vs** `plugin/skills/faff/bin/faff:2365–2377,2609` + the `budget check` help ("child `agent-*.jsonl` whose own **sessionId == this run's** (mtime is a cheap pre-filter only, NOT the attribution gate — FAFF-229)").
- **Drift:** the CLI moved to sessionId attribution precisely because the mtime window the prose still describes *could* overcount cross-session children — the prose's "never overcounts" guarantee is now delivered by a mechanism it doesn't mention and contradicts.
- **Fix/ticket:** update the Token-accounting bullet to the sessionId rule. → **T4**

### R5 — The ADR log's Status field is not maintained: ≥10 shipped-but-Proposed, and one acceptance inversion

- **Artifacts:** `docs/adr/` status sweep: 15/41 `Proposed` — including 0009 (write-abstention → shipped as the label CLI's tracker-owned refusal), 0012 (→ `faff contain`), 0014 (→ the COMMANDS registry + `lint-cli-doc`), 0018–0021 (→ `faff dod classify` / `admissible` / container-status), 0022–0024 (→ `faff prdr admit`/`yagni`/`coverage`), 0025–0028 (→ the `spec_review` slot + `spec-review-lenses`), 0034 (→ `faff sentry`), 0035 (→ the gateway Topology-write-authority dial), 0037 (→ `resolveAppetite`/`FAFF_APPETITE`, 9 hits in `bin/faff`) **vs** each named shipped mechanism.
- **Drift:** the record says "proposed" for machinery that is load-bearing in production paths; and ADR-0039 (sentry-2, **Accepted**) explicitly builds on ADR-0034 (sentry-1, still **Proposed**) — an acceptance-order inversion that makes the log incoherent as a decision history. `faff adr validate` checks numbering/headers/back-refs but nothing catches status rot.
- **Fix/ticket:** one status-sweep pass (accept or annotate each shipped-but-Proposed ADR; fix the 0034/0039 inversion), plus consider an `adr validate` advisory when a Proposed ADR is cited as the deciding record by an Accepted one. → **T8**

### R6 — ADR-0037's L4-appetite pin is implemented in the CLI but invisible in the gateway's Appetite section

- **Artifacts:** `docs/adr/0037` (appetite is level-scoped; L4 resolves `full` via `resolveAppetite` precedence env `FAFF_APPETITE` → L4 ledger → config) + `bin/faff` (implemented, 9 hits) **vs** `plugin/skills/faff/SKILL.md:630–686` (the Appetite section: a single global dial, "Set `appetite:` in `.faffrc` … global per project" — no L4 mention).
- **Drift:** ADR-0037's own Consequences warn that "a consumer that bypasses the channel (hardcodes/caches config) would leak" — and the gateway, the one prose surface every consumer reads, still teaches the un-pinned model. (Compounding R5: the ADR itself is still `Proposed` while its machinery ships.)
- **Fix/ticket:** add the level-scoping rule to the gateway Appetite section (one paragraph: resolution channel + L4 pin). → **T9**

### R7 — Deps-in-prose without edges: two live instances, both with since-shipped blockers

- **Artifacts:** FAFF-40 description ("**FAFF-245 (*blocks this*)**" and "*Blocked on FAFF-245*") **vs** its live relations (`blockedBy: []`, FAFF-245 only `relatedTo` — and FAFF-245 is no longer in the open set, i.e. shipped). FAFF-165 description ("owned by FAFF-164, **which this is blocked-by**") **vs** its live relations (`blockedBy: []`; FAFF-164 shipped).
- **Drift:** the recurring deps-in-prose hazard, live in 2 of the 10 dep-language candidates: graph-readers (`faff next`, map, unlock-value) say "ready" while prose-readers (prep) say "blocked" — and in both cases the prose is *also* stale (the named blocker has shipped). The newer tickets (FAFF-326/330/104) all carry correct edges, so the discipline now holds; these are legacy captures.
- **Fix/ticket:** update FAFF-40 + FAFF-165 prose (blockers shipped — drop the blocked framing); no new edges needed. Reverse direction (edges with no rationale): none found in the sampled set — every fetched edge carries prose rationale. → **T10**

### R8 — Executors describe the build-subagent outcome domain as "six ledger buckets"; the gateway contract fixes four

- **Artifacts:** `plugin/skills/faffter-noon-concurrency-sequential/SKILL.md:34` ("`outcome` is one of the existing six ledger buckets (`shipped`/`pr-open`/`parked`/`errored`/`routed-out`/`unreached-budget`)") and `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md:31` (same claim) **vs** `plugin/skills/faff/SKILL.md:1006` (concurrency-contract obligation 3: record "as one of the fixed buckets `shipped` / `pr-open` / `parked` / `errored`").
- **Drift:** `routed-out` and `unreached-budget` are orchestrator dispositions written at queue assembly/budget fire — a build subagent can never legitimately return them. The executors' wording invites exactly the invalid-outcome ledger writes `runcheck` exists to flag (the ledger *file* accepts six values; the *TerminalToken* domain is four).
- **Fix/ticket:** correct both executors' sentences to the four build buckets. → **T11**

---

## Observations

### O1 — The `architecture` slot has no call-site

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
- **Question:** environment drift, not internal drift — the forcing-function intent survives; the tool name doesn't. Phrase it capability-generically. → **T15** (bundled)

### O5 — The rendering catalogue's "sixth form" guard went stale when the sixth form landed

- **Artifacts:** `plugin/skills/faffidavit-rendering/SKILL.md:67` ("if a skill needs a **sixth** form, this section gains it first") **vs** the same file's catalogue (a)–(f) — already six forms (On-hold entry was added as (f)).
- **Fix:** "a new form". Trivial, but it's the closed-catalogue guard sentence itself. → **T15** (bundled)

### O6 — jot's interactor still justifies itself with a pre-advisory-model sentence

- **Artifacts:** `plugin/skills/faff-jot/SKILL.md:88` ("the orchestrator lane … already has tracker write … so **mutating a label** on an existing ticket is within-lane") **vs** `faff-jot/SKILL.md:105` (step 3: the labels are tracker-owned; "faff never executes the write").
- **Drift:** the remit paragraph's rationale describes the pre-write-abstention design; three steps later the same skill correctly says no label write ever happens. Internal contradiction, cosmetic but in the section defining the interactor's authority. → **T15** (bundled)

### O7 — Declining the first-run offer permanently locks the front door to onboarding

- **Artifacts:** `plugin/skills/faff/SKILL.md:66` (decline → write a stub `.faffrc.yaml` so the offer never re-fires) **vs** `plugin/skills/faff-onboard/SKILL.md:47` (bail: "Exit 0 — a config already exists … report that faff is already set up … and stop").
- **Drift:** a human who declined once and later deliberately runs `/faff-onboard` is told faff "is already set up" — the decline-stub (one empty key) satisfies the bail check. The bail should distinguish a decline-stub from a real config (e.g. offer to continue when the config holds only the stub key). → **T15** (bundled)

### O8 — Descriptor blocks vs contract scripts: an undocumented two-class split

- **Artifacts:** `faff-contract:infra-profile` / `intake-record` / `label-op` blocks are CLI-emitted with **no** `faff contract` validator (probed: unknown to the dispatcher) — validated instead via `faff profile validate` or trusted by construction (CLI-emitted descriptors); the other block types all have dispatcher entries.
- **Assessment:** coherent by design (trusted-source emission needs no consumer-side re-validation) but stated nowhere; an author adding a fourth descriptor block has no rule to follow. Surface-only.

---

## Checked and clear

Candidates probed and dissolved — recorded for coverage honesty:

- **ADR-0039 corrective authority "unimplemented":** Accepted with implementation deliberately ticketed (FAFF-325 → FAFF-326 → FAFF-328, correct `blockedBy` chain live in the tracker; sentry's v1 "never `correct`" guard is explicitly the seam FAFF-326 extends). Coherent decision-then-build sequencing, not drift.
- **Recent dep discipline:** FAFF-330 ("Blocked by FAFF-127" + edge ✓), FAFF-326 (prose + edge ✓, blocks FAFF-328 ✓), FAFF-104 (hard-input prose + edge ✓), FAFF-332 (explicitly "non-blocking follow-up", edge-free ✓), FAFF-279 (no prose dep; itself documents the inverse stale-Done-edge hazard).
- **`faffter_dark.adversarial.fallbacks` as a native YAML list:** parses correctly (`faff config get` returns the list) — the parser handles sequences; the skill's note that the JSON-string form is canonical-but-not-required is accurate.
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
15. **T15 — Docs-tidy bundle:** graft's TodoWrite → capability-generic wording (O4); rendering "sixth form" → "a new form" (O5); jot interactor's within-lane sentence (O6); onboard decline-stub re-entry (O7) (axes 1).

Surfaced only (not proposed as tickets): O8 (descriptor-vs-contract class split — document if it ever bites).
