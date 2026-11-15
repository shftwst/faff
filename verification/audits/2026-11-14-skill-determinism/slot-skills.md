# Slot skill determinism audit

Audit date: 2026-11-14. Scope: all 20 `faffter-*` and both `faffidavit-*` `SKILL.md` files, 3,311 lines. Every scoped skill was read in full. Source and test inspection is distinguished below from a proof of end-to-end execution. This audit changes no skill, runtime, installer, or default.

SuperDomestique can stop publishing the noon/dark families as separately discoverable skills while retaining their strategies internally. The user has chosen dark as the default for all five paired slots, with noon kept fully aside as an explicit opt-in before any retirement is considered after third-party usage. Deleting the noon family now loses nine unique capabilities and breaks three explicit dependencies from dark occupants. Preserve those nine capabilities as internal role prompts and move shared dependencies before changing discovery. Dark defaults intentionally change review depth, network requirements, scheduling and methodology authority; record these changes separately from exact-parity mechanical extraction.

## Current selection and packaging

| Surface | Observed behaviour | Consequence for removal of tiered loading |
|---|---|---|
| [`config-core.js`](../../../plugin/skills/faff/bin/lib/config-core.js), lines 17-37 | Sixteen default slot entries: fourteen noon occupants and the two faffidavit adaptors. `profile` is a built-in operation, not another default skill. | Record the current baseline; migrate the five paired defaults to dark explicitly, retaining configured opt-ins and the nine unique internal capabilities. |
| Repository `.faff/config.yaml`, lines 13-20 | Explicit dark overrides for methodology, spec, spec_review, concurrency and review. | This checkout's selection does not establish the product's zero-config defaults. |
| [`link-skills.sh`](../../../scripts/link-skills.sh), lines 248-256 | Discovers every top-level directory with a `SKILL.md`; frontmatter does not filter installation. | `user-invocable: false` hides a slash command, but does not remove its discoverable skill entry. |
| [`validate-adapters.js`](../../../plugin/skills/faff/bin/lib/validate-adapters.js), lines 15-39, 380-403, 612-735 | Registry, slot-type mapping, sibling directory lookup and bundled membership are name/path based. Namespaced lookup strips the last namespace for locating a file; bundled membership itself uses the exact name. | A move needs a package/resource registry and compatible name resolution. Do not turn first-party aliases into foreign occupants accidentally. |
| Same file, lines 669-675 versus 724-732 | `--configured` skips every registered occupant by name; `--is-bundled` also checks the expected slot type. | Existing checks do not establish identical wrong-slot handling. Add a migration regression case before treating them as one resolver. |
| [`kernel.md`](../../../plugin/skills/faff/references/kernel.md), Sibling-skill invocation and Slot conformance validation | Consumers resolve canonical names through the available skill catalogue and validate foreign occupants before first use. | Merely un-linking slot skills breaks invocation even if their text still exists on disk. |
| [`plugin.json`](../../../plugin/.claude-plugin/plugin.json) | Declares plugin identity and version; no selective slot-skill export list. | Plugin and symlink installs both need discovery verification, independently. |
| Asset ownership | `review-call.mjs`, `review-spawn.mjs` and `fan-out.mjs` live under the dark review skill; spec parser/aggregator/lens prompts live under dark spec-review; `evaluate-call.mjs` lives under noon evaluate. | Preserve executable assets and relative imports when removing skill catalogue entries. A prompt directory is currently also a runtime package. |

All internal occupants declare `user-invocable: false`; `faffter-dark-authoring-adaptors` is deliberately user invocable. Its runtime foreign-occupant validation use must survive any public command consolidation.

## Noon/dark comparison

| Slot | Noon behaviour | Dark behaviour | Shared dependency and parity constraint |
|---|---|---|---|
| `spec` | Lite WHY/WHAT/HOW/Scenarios/DONE; mandatory self-review, bounded format repair and rating cap. | Full vocabulary/types/rationale/assumptions/smoke-test/appendix format; same readiness contract. | Dark nlspec lines 240-248 inherit noon spec's self-review in full, with in-context review. Extract common review mechanics before removing noon's resource. Format richness remains a selected authoring strategy. |
| `review` | Five structural passes; revert test; pass/fail/needs-human. | Runs noon as Phase 1, then an independent backend; autonomous critical escalation; L4 mandatory-outage handling. | Dark review lines 27-29, 42, 355 delegate directly to noon. Dark adds network and availability semantics. It is not an equivalent replacement. |
| `spec_review` | One pass over selected lenses; at most one objection per lens; blocker lens determines outcome. | Independent refuter call per enabled lens; parser, severity veto and majority roll-up; outage holds and reviewer pin. | The same contract accepts different policies. A noon infosec blocker needs human review; a dark critical becomes reject-approach after transport floors. Keep separate policy functions and judgement prompts. |
| `methodology` | Priority, transitive unlock value and oldest-first; graph-derived structure; empty rehome-set; no issue-critique. | Value/risk judgement, outcome grouping, right-sizing, topology proposals/actions, issue-critique and rehome-set. | Dark lines 36-37, 51 and 296 compose thematic algorithms and baseline. Shared graph work can become code; selecting agile changes decisions and authority. |
| `concurrency` | One foreground unit at a time, independents then collision groups; no cross-unit rebase. | Bounded background units, foreground await-all, per-member liveness, merge lock and rebase on current base. | Both implement the same seven obligations but different scheduling. Cap 1 is not sufficient proof of equivalence because dispatch posture, polling and merge treatment differ. Corrective custody prose already diverges. |

Nine noon skills have no dark equivalent: `adr`, `architecture`, `env`, `env-code-interface`, `evaluator`, `intake`, `prd`, `ship`, and `transport`. Their capabilities must remain available under any single-default design. The faffidavit routing and rendering capabilities also have no bundled alternate.

## Evidence boundaries

| Inspected source or test | What the inspection establishes | What it does not establish |
|---|---|---|
| `contract-defs-review.js`: `computeSpecReadiness`, `computeSpecReviewVerdict`; `contract-defs-delivery.js`: `computeAutomationRouting`, `computeDeliveryOutcome` | Shape, closed vocabulary, coercion and limited consistency checks are code. Routing assignment and noon severity roll-up are outside these validators. | A conformant block does not prove a judgement was performed, correct, or based on the specified inputs. |
| `config-defaults.test.mjs`, read in full | CLI tests pin default review/PRD occupants, explicit override precedence and non-registry absence. | No complete installer-to-internal-resource invocation migration proof. Several fixture helpers still use the older config filename, so actual execution is needed before citing a green baseline. |
| `spec-review-occupant-served-dispatch.test.mjs`, read in full | Extracts the actual fenced capture snippet and executes it against the real CLI; checks later served identities and no-lens capture. | Covers one shell block, not the full review round. |
| `spec-review-dispatch-resolution.test.mjs`, shell helper bodies inspected | Runs reimplemented resolution clauses and pins some prose. | A copied clause can agree with a copied expectation while production prose changes. Replace with direct command tests after extraction. |
| `build-lens-requests.mjs`, `aggregate.mjs`, `parse-refutation.mjs`, relevant bodies inspected; test declarations inspected in `spec-review-lens-requests`, `spec-refute-aggregate`, `spec-refute-parse`, `fan-out` | Lens argv, severity mapping, aggregation and parser fault classes have production functions and test seams. | Remaining shell configuration, pin winner selection, transcript persistence and aggregate invocation are still composed by a skill. |
| `rendering-routing.test.mjs`, read in full | Tests matcher routing/order using `scriptedDriver` render and mutation actions. It explicitly excludes body content. | Does not run the rendering skill, prove actual output was normalised, or establish rendering semantics. |
| `env.js`, datastore table, endpoint validation, up/seed/down bodies inspected; `env.test.mjs`, setup and early test bodies plus remaining declarations inspected | Compose generation, base validation, service health and current seed strategies exist in code; Docker integration cases are conditional. | Does not prove the slot contributes a bridge into the same plan, resolves separated transport, or performs every cleanup branch. |
| `holdout-rpc-evaluate-integration.test.mjs`, setup inspected; `holdout-record` and `holdout-delegation` test declarations inspected | Real bridge/spawner/record paths have fixtures, including delegated criteria and detail requirements. The integration uses an injected exerciser and preflight. | Does not prove an LLM derives the right exercise or that a renamed slot is loaded with identical resources. |
| `corrective.js`: `foldCorrectiveAuthority`, manifest handling inspected | No manifest cannot produce `custody-trusted`; a clean held digest can. A tampered or uncomputable held digest refuses. | Does not prove both concurrency occupants supply the intended manifest. |
| `park-history.js`, reader/writer and constants inspected | Rolling count uses explicit time, same-class threshold and deduplicated completed transitions. | Does not classify root cause or prove the tracker action matched appetite. |

No test run result is claimed by this sub-audit. The parent audit's verification record owns executed checks.

## Fine-grained rule inventory

Each range below is inclusive and refers to its linked source skill. Frontmatter, the title, scope introduction and config examples are grouped explicitly. A row labelled mechanical names a candidate seam, not a claim that a replacement already exists. Existing CLI coverage means the stated limited property, not end-to-end parity.

### Intake

Source: [`faffter-noon-intake/SKILL.md`](../../../plugin/skills/faffter-noon-intake/SKILL.md). Inbound: jot, then methodology ticket-shaping. No gated contract block.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-17, identity/default | Names intake and discovery ownership. Keep brief authoring. | Registry metadata and default example need not be loaded each time. | Config defaults own selection; avoid claiming a heavy intake replacement is equivalent. |
| 19-23, When it runs | Discovery only; no tickets, tracker writes or code. | Invocation payload and read/write capability boundary. | Jot owns mutation. Prose prohibition alone is not a tool boundary. |
| 25-32, Input | Mode, user description, project/greenfield evidence. | Validate mode and required payload; acquire supplied context once. | `modedetect` declared seam is distinct from caller-owned mode selection. |
| 34-36, discovery | Ask only questions affecting work shape. | No deterministic substitute for relevance judgement. | Retain concise prompt instruction. |
| 38-46, greenfield | Goal, capabilities, first slice, constraints, non-goals. | Brief schema and optional-field presence. | Human discovery remains generative. |
| 48-58, single-item | Intent, done signal, affected area, dependencies, split sense; stop when brief is fillable. | Mode-specific schema; unresolved questions are a valid result. | Stop threshold and split sense remain judgement. |
| 60-100, Output | Canonical markdown brief. | Deterministic renderer from typed brief. | Test exact section order, optional sections and mutually exclusive Capabilities/Item. |
| 102-107, brief rules | Required sections, no ticket titles, plain names, no premature spec. | Enforce section exclusivity/omission; separate output type from proposed tickets. | Semantic content remains reviewable, not regex-provable. |
| 109-111, Appetite | More clarification at low/medium; record minor assumptions at high/full. | Resolve appetite once; carry explicit policy input. | Do not invent an exact question count absent from current rule. |
| 113-118, Rules | Restates lane and nonblocking open-question policy. | Deduplicate against payload/brief validation after proof. | Retain the substantive boundary in the prompt or capability model. |

### Lite spec and shared producer self-review

Source: [`faffter-noon-spec/SKILL.md`](../../../plugin/skills/faffter-noon-spec/SKILL.md). Inbound: prep; dark nlspec imports self-review. Outbound: readiness contract, admissible and punt-scan; tidy/routing consume retained confidence.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-17, identity/default | Lite format and declared confidence/marker/specqual seams. | Registry metadata and selection. | Internalise under a named lite strategy without changing its format. |
| 19-29, When/Input | Issue, exploration and fixed contract inputs. | Assemble immutable producer payload. | Standalone and dispatched invocation currently differ. |
| 31-37, Output/arc | Buildable body; every substantive decision marked. | Render sections and emit envelope from typed authoring output. | Identifying substantive decisions remains judgement; do not infer completeness from an array's validity. |
| 39-43, WHY | Motivation, constraints and scope boundary. | Section template only. | Meaning and omitted principles remain generative. |
| 45-49, WHAT | Types/interfaces, decision markers, open questions and assumptions. | Marker formatting; collect authored tagged decisions. | Codebase fit and choice remain judgement. |
| 51-55, HOW | Architecture, ambiguity-point pseudocode and risks. | No general deterministic substitute. | Keep strategy prompt. |
| 57-74, Scenarios | Complexity threshold, behavioural assertions, minority holdouts, body-supported requirements. | Fence format, counter checks, holdout fraction and reserved DONE exclusion. | `spec-producer-scenario-format` exercises examples; coverage appropriateness and whether body already requires behaviour remain judgement. Bullet holdout allowance and fenced behavioural rule need a typed distinction. |
| 76-82, DONE | Body-to-checklist trace, separable integration checks, seam coverage, split recommendation. | Require trace links and explicit criterion types; register seam artifacts mechanically. | Coverage sufficiency and split decision remain judgement. |
| 84-86, deterministic self-review | Rewrite named scenario format/code-surface warnings; retry once; log command failure without blocking. | Run admissible, classify warning prefixes, create major findings, bound repair/recheck count. | Exact branch: no scenarios can legitimately yield a note; nonempty malformed scenarios yield major. Do not convert all nonzero exits to a block. |
| 88-101, reviewer dispatch/checklist | Verify codebase fit, assumptions, punts, ACs, scope and interfaces. | Payload, read-only reviewer posture, findings schema and 400-word budget. | Fresh independent context at top level versus in-context when already dispatched must be preserved. Every fresh spec is reviewed regardless of size. |
| 103-109, findings and exception | Author revises or punts; architectural failure can return low. | Severity routing, review record requirement, cap at medium for at least one blocker or three majors; caller-owned narrowing-only exemption. | Test cap regardless of attempted fixes, missing review record, absent exemption and nesting. Wording currently counts surfaced findings, not expressly only unresolved findings. |
| 111-121, Confidence | Assess decision closure and exploration quality. | Read punt-scan eligibility, format/retain rating, caller route lookup. | Eligible nonblocking punts must come from scanner; ambiguity rating remains judgement. |
| 123-136, Contract artifact | One last block mirroring markers and rating. | Shared deterministic fence emitter and validation. | Existing readiness contract validates claims, not correspondence to prose. Preserve absent-block fallback until explicitly retired. |
| 138-145, Rules | Minimum format, punt owner selection, language-agnostic pseudocode, standalone buildability. | Optional owner syntax and canonical marker representation. | Owner assignment, assumptions and skimmability stay judgement. |

### Full nlspec

Source: [`faffter-dark-nlspec/SKILL.md`](../../../plugin/skills/faffter-dark-nlspec/SKILL.md). Inbound: prep. Explicit dependency: noon spec self-review, lines 240-248.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-21, identity/config | Full authoring strategy and historical inspiration. | Registry/config metadata; attribution can live in package documentation. | No external page was used as audit evidence. |
| 23-34, Input/Output | Same inputs and readiness boundary as lite. | Shared payload and envelope schema. | Full format is a distinct output, not redundant lite text. |
| 36-40, Spec Format/Preamble | Artifact, issue and audience grounding. | Template insertion. | Do not fabricate issue context. |
| 42-56, WHY | Lead with governing idea, short problem, useful principles and reference context. | Three-sentence constraint and optional table rendering. | Selecting the governing idea and relevant references remains judgement. |
| 58-66, OUT OF SCOPE | Excluded work, reason and extension point. | Structured fields and renderer. | Exclusions are author decisions. |
| 68-89, WHAT | Define vocabulary, RECORD/ENUM shapes and choice rationale. | Marker/owner formatting and collection. | `Decision` alias differs from lite's canonical examples; resolve through current scanner before collapsing templates. |
| 91-114, HOW | Architecture, pseudocode, fallback precedence and error categories. | Render supplied behaviour model. | Algorithm design stays with author. |
| 116-126, failure modes/anti-patterns/rule inventory | Challenge approach assumptions; inventory deleted skill rules. | Require inventory for applicable changes and run `rule-inventory check`. | Determining failure modes and complexity threshold remains judgement. This explicit inventory rule is absent from lite's local prompt. |
| 128-159, SCENARIOS | Same format/observability constraints; exact holdout forms and optional minority selection. | Shared scenario authoring validator. | Test fenced GWT and assertion holdout separately; do not turn optional zero-holdout into a requirement. |
| 161-171, rationale | Collect options and decisions with relevant temporal context. | Collect authored decisions and references. | Rationale content is not mechanically reconstructible from markers. |
| 173-177, questions/assumptions | Gather punts and validation instructions. | Structured lists and stable section rendering. | Whether assumptions hold remains author/reviewer judgement. |
| 179-212, DONE | Body coverage, separate integration checks, eval registration and integration smoke. | Typed trace matrix and templates. | Smoke-test design and sufficiency remain judgement. |
| 214-222, APPENDICES | Optional reference detail only when needed. | Renderer can omit empty appendices. | Need and organisation remain editorial judgement. |
| 224-238, confidence | Same rating and retained provenance as lite. | Shared punt-scan/rating constraints and formatting. | Keep high/medium/low rationale separate from deterministic cap. |
| 240-248, Quality bar | Inherits noon self-review without additions; always in-context here. | Shared internal review workflow and rating cap. | Removing noon before moving this section breaks the rule home. Test context-depth behaviour. |
| 250-263, Contract artifact | Same readiness artifact as lite. | One shared emitter. | Repeated schema examples are removable after shared wrapper parity. |
| 265-270, Rules | Canonical markers, style, pseudocode and sufficient context. | Common formatting constraints. | Buildability stays judgement. |

### Single-pass spec review

Source: [`faffter-noon-spec-review/SKILL.md`](../../../plugin/skills/faffter-noon-spec-review/SKILL.md). Inbound: prep. Dependencies: methodology critique, repo/ADR context, contract and `spec-review route`.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-12, identity/loading | L1-L3 default, kernel and lane context. | Resolve strategy and load bounded prompt resources. | Moving the prompt must preserve supplied ADR and methodology context. |
| 14-27, What/Inputs | Exact selected lens set, all four if absent; single-pass mode. | Validate lens set/mode and assemble context. | Do not substitute dark per-lens calls merely because the contract matches. |
| 29-40, four lenses | Architecture/security/methodology/QA critique; only build-blocking changes, worst objection per lens. | Bound one objection per selected lens. | Actual objections, severity and deduplication are judgement. QA scenario mistakes can be precomputed by admissible. |
| 42-46, enrichment/anchor | Claim/evidence/consequence with optional heading anchor. | Use `heading-slug.js`; structured envelope emitter. | Legacy lens/severity-only objects still validate; do not silently tighten contract. |
| 48, methodology | Consume critique, never recompute; missing critique gives no objection plus note. | No-critique branch and input isolation. | Translation from critique to objection stays judgement. |
| 50-67, verdict roll-up | Deterministic severity/lens map. | Extract pure noon policy function, separate from contract and consumer routing. | Multiple blockers of different lenses have no explicit tie-break beyond pseudocode ordering. Freeze intended precedence with cases before deletion. |
| 69-87, Output | One founded contract block. | Shared emitter; contract validation. | `computeSpecReviewVerdict` enforces foundedness, not this producer's policy. |
| 89-97, Level gradient | Single pass versus L4 independent refuters; upstream cost selection. | Consumer resolves strategy/lens mode. | Preserve infosec/QA minimum and unknown-surface all-four behaviour at its existing owner. |

### Adversarial spec review

Source: [`faffter-dark-spec-review/SKILL.md`](../../../plugin/skills/faffter-dark-spec-review/SKILL.md). Inbound: prep review loop. Dependencies: dark review transport, four `refute-*.md` prompts, pin/reputation/window commands, parser, aggregator, rendering.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-24, identity/When | Independent selected lenses before build admission. | Registry, strategy selection, load prompt assets. | Same public contract does not mean same noon policy. |
| 25-32, Inputs | Spec, lens set, critique and named repo context. | Payload validation and ordered context assembly. | Retain independence and one call per enabled lens. |
| 34-49, refuter lenses | Refutation judgement, methodology non-recompute, challenge false nonblocking tags. | Select exact prompt files; no-critique short path. | Honest deferrability remains judgement; refuter prompts are dependencies, not duplicate orchestration. |
| 51, ratified scope | Defer settled non-goals/goals/resolutions/human-ratified choices as cited observations; never defer critical. | Assemble neutralised data; require cited deferral fields. | Whether objection reopens decision or attacks implementation remains judgement. Preserve four distinct ratification sources. |
| 53-59, backend selection | Shared transport/fan-out, pin preference and first-round reputation filter. | One command can own chain resolution and review-pass plan. | Must preserve unpinned byte identity and nonempty chain fallback. |
| 61-106, shell config | Resolve timeout/max tokens/strategy/deadline, guards and low-deadline warning. | Move exact fallback and validation logic into typed production function. | Timeout 120, cap 2000, deadline 900; strategy occupant default differs from fan-out's omitted-flag default. Existing resolution test copies clauses. |
| 107-144, request/fan-out branch | Filter round one, determine round/raw dir, build all requests, invoke fan-out once; resolver faults synthesize unavailable. | Command owns temp files, argv and all return branches. | Current shell placeholder loop is not a safe path serializer; use argv arrays without changing file selection. |
| 146-163, unconditional capture | Lowest served chain index; capture every round or explicit no-lens record. | Parse harness header once and capture atomically. | Actual-snippet test protects round-two served identity. Preserve failed pin read/write evidence. |
| 165-175, wire/result plumbing | Prose diff kind, raw capture, shared contexts, authoritative model, unavailable config. | Existing request builder/fan-out already own parts; wrapper forwards results verbatim. | Ratified block inclusion, exact context ordering and header identity must survive packaging. |
| 177-179, TTFT advisory/fan-out fault | Advisory ratio only for complete timings; whole-call fault marks every lens unavailable. | Pure advisory calculation and result expansion. | Test one lens, zero prime TTFT and missing timing; current prose does not fully define these degenerate cases. |
| 181-205, per-lens outcome/parser | Exit class map, deterministic parser invocation, verbatim parser output, diagnostics. | Shared result fold, no LLM exit classification. | `parse-refutation.mjs` owns claim-only degraded parsing. Test every transport/parser exit, truncated flag and malformed stdout. |
| 207-213, transcript | Save stdout/header and stderr, non-clobber retry siblings, stable round. | Atomic transcript writer with exclusive-create retry allocation. | Preserve raw/transcript suffix correlation limits under concurrency; do not promise a stronger join. |
| 215-248, Aggregation | Exact enabled-count, transport floor, critical veto, majority/minority/clean and enrichment. | Already in `aggregate.mjs`; invoke once with validated result set. | Line 226 falsely claims all triple fields are mandatory; parser requires only claim. Unknown severity currently drops in aggregator, so tightening is a separate change. |
| 250-258, Output | Aggregator produces contract, consumer routes. | Return aggregator bytes and native exit status. | Nonzero aggregate must never become approve. |
| 260-262, Rendering | Human summary passes rendering; machine blocks/logs exempt. | Route typed summary through central renderer. | Existing rendering test proves scripted routing, not actual caller coverage. |
| 264-270, Rules | Independent grounded refuters and shared transport. | Enforce transport entrypoint and per-lens dispatch count. | Generic needs-human wording at line 267 is broader than transient unavailable handling above. Resolve wording without changing outage policy. |

### Standard code review

Source: [`faffter-noon-review/SKILL.md`](../../../plugin/skills/faffter-noon-review/SKILL.md). Inbound: graft and dark review Phase 1. Outbound: founded review-verdict; no tracker writes.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-19, identity/default | Standard review strategy, fixed envelope. | Registry/default and envelope schema. | Keep strategy usable internally for dark Phase 1. |
| 21-29, Why pre-PR/When | Review before PR; one terminal comment owned by graft. | Phase ordering and single-comment workflow. | Explanatory cost rationale can move to docs; ordering cannot be dropped with it. |
| 31-52, Input/Output | Diff/spec/tests/AC/prior findings in; signal plus findings out. | Typed input and standard renderer. | `main...HEAD` example must not replace current caller-resolved review target. |
| 54-62, AC coverage | Match AC to tests or human verification. | Require coverage references per AC after judgement. | Keyword search is evidence collection, not proof of behavioural coverage. |
| 64-78, bugs | Common correctness defects; fixture data exception. | Existing lint/static analysis evidence can be supplied. | Do not equate static tools with complete bug judgement; keep fixture distinction. |
| 80-96, scope/spec fidelity | Necessary changes, chosen approach and error paths. | Map authored findings to typed categories. | Scope necessity and semantic fidelity remain judgement. |
| 98-109, human judgement | Escalate only effects persisting after revert. | Carry explicit irreversible-effect finding classification. | Revert test remains semantic evidence, not a Git command proving external effects undo. |
| 111-117, Verdict rules | Human finding outranks fixable; none passes; no self-declared unavailable. | Pure category-to-signal fold. | Contract enforces shape, not complete five-pass execution. |
| 119-146, Output/Contract | Final fenced signal, optional finding detail/carry/enrichment. | Shared emitter; derive presence booleans from real fields; `finding-id` owns identity. | Preserve legacy optional fields and soft enum violations; carry judgement must not re-raise fixed defects. |
| 148-157, Appetite | Scope allowance varies; defect bar constant; iteration cap 1/3/5/10. | `review-iteration-cap` already owns persistence lookup. | Scope judgement remains; remove copied numeric table only after generated docs/policy test. |
| 159-167, Rules | No regressions/dead code, spec-grounded actionable findings, prefer fixable uncertainty. | Supply test results and finding shape checks. | Remaining rules are reviewer calibration, not removable mechanics. |

### Adversarial code review and shared challenge transport

Source: [`faffter-dark-adversarial-review/SKILL.md`](../../../plugin/skills/faffter-dark-adversarial-review/SKILL.md). Inbound: graft code review and ADR drift; plot upper-gate PRDR challenge; spec-review reuses transport. This directory contains executable assets that cannot be removed with its discovery entry.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-23, identity/When | Two-phase configured review. | Registry and workflow entry. | Intro says soft evidence adds no verdict; actual outage path emits unavailable. |
| 25-33, phases | Full noon Phase 1 first; only pass calls independent Phase 2. | Phase state machine and early return. | Preserve Phase 1 prompts as internal asset; never skip because dark is selected. |
| 35-44, Inputs | Diff/spec/prior findings and forwarded autonomous/lights_out signals. | Validate/forward payload; false/absent autonomous means interactive semantics. | Mandatory status is now separately ledger-derived. Do not conflate these switches. |
| 46-69, Output | Findings-shaped response, canonical clean marker, provenance/refutation/fixture cap. | `review-call.mjs` already normalises, attributes and downgrades mechanical claims. | These transport internals need not be re-explained at runtime once invoked by a stable wrapper. |
| 71-83, findings | Implementor investigates/dispositions, logs once, fixes and reruns primary review. | Persist disposition schema; re-run Phase 1 when code changes. | Evidence-backed rebuttal remains judgement. L3/L4 raw critical escalation cannot be cleared by author disposition. |
| 85-98, fold both passes | Unified findings with source/model/severity/disposition and settled anchor evidence. | Deterministic merge of typed findings; preserve final dispositions. | Later contract paragraph still says one entry per Phase-1 finding. Resolve against additive both-pass rule. |
| 100-132, Review lens | Gaming, assumptions, failure paths, security, ordering and carried defects. | Prompt resource and input binding; copy first carries field mechanically. | All five challenge categories remain judgement; no findings marker is a wire requirement. |
| 134-173, provider config/chain | Canonical transport, config examples and ordered fallbacks. | `adversarial-backends` already resolves chain/inheritance. | Move deployment recipes out of invocation prompt; retain operator docs. |
| 175-182, context window | Primary-targeted shared trim, per-backend over-window skip, loud primary skip. | Existing transport code owns deterministic estimate/trim/advance. | Preserve advisory versus fault behaviour and byte-identical prefix across spec lenses. |
| 184-201, providers/reasoning | Transport families, auth, reasoning flags and independence requirement. | Provider request details are code; configuration reference can be docs. | Independence selection remains a model-family policy. Reasoning-depth tradeoff is judgement/eval evidence, not parity of HTTP payload. |
| 203-257, Backend call | Resolve chain/config, base-ref fixture paths, spawner and context file arguments. | Add one production preparation/invocation command; temp-file and argv construction leave prose. | Preserve global deadline 480 versus spec deadline 900, code-only trim key and fixture lookup failure advisory. |
| 259-273, spawner/pass-through | Bounded process-group lifecycle, exact child status, run-dir mandatory propagation, prompt/context assembly. | Existing spawner and killable primitive handle lifecycle; wrapper owns forwarding. | Test timeout kills descendants and no dropped run-dir on autonomous calls. |
| 275-295, exit table/retries | Code 0 findings; structural faults need human; advisory outages/skips versus L4 unavailable. | Pure terminal outcome fold from structured transport result. | Preserve 2/4/6/7/11 dominance, 8 deadline distinction, 12 rate limit and 9 mandatory remap. Never map unknown/error 1 to pass. |
| 297-313, outage annotation | Autonomous advisory outage gets loud header/raw annotation; interactive gets plain skip. | Deterministic result decoration and ledger propagation. | Annotation remains in raw verdict, not normalised contract output. Text says shipped before actual merge; do not use it as merge evidence. |
| 315-323, mandatory outage | Ledger L4 or explicit flag makes no-opinion exhaustion fail closed. | Already transport-owned mandatory derivation; wrapper carries path. | File corruption/unreadability and missing run-dir require executable tests, not trust in forwarded boolean. |
| 325-334, checkpoints | Resume hint, phase pass/in-flight/complete/skipped writes and diff hash. | `review-progress` exists; workflow controls transitions. | Exit 9 must not write skipped; stale diff must invalidate Phase 1 hint. |
| 336-361, Output/Contract | Final fenced verdict, findings, raw additive annotations. | Shared typed emitter/fold. | Conflicting Phase-1-only wording, both-pass findings and unavailable exceptions prevent literal automatic deletion without resolved inventory. Example contains comments, not valid JSON. |
| 363-372, autonomous escalation | Raw critical plus autonomous plus Phase 1 pass yields needs-human. | Pure fold using post-transport findings; shared escalation severity set. | `location_present:true` cannot honestly be fabricated for malformed critical; current prose assumes actionable input. Record this gap before tightening. |
| 374-384, escalated_criticals | Exact critical title/location/carry for dialogue identity. | Copy typed fields, compute identity in existing helper. | Author must not choose carry handle; preserve no-ID contract. |
| 386-388, rebuttal | Independent reviewer holds or withdraws standing critical from untrusted rebuttal data. | Scrub/payload mechanics, record hold/withdraw result. | Merits of rebuttal remain judgement. |
| 390-392, ADR drift | Compare settled old/new decision rationale; missing challenge rejects. | Separate typed challenge entry and shared-backend resolution. | It leaves consumer unset; do not accidentally select code_review chain. |
| 394-425, PRDR Phase 2 | Challenge authored product decision against PRD goals. | Separate proposal-shaped interface, prdr_review selection and absent-challenge handling. | Explicitly forbids routing through diff-shaped code-review helper. Shared transport does not mean shared payload or contract. |
| 427-429, overturn criterion | Over-scope only beyond declared goals; distinguish under-citation. | Existing `prdr yagni` set test and closed ground enum. | Material goal coverage/challenge remains judgement. |
| 431-436, Rules | Independent, grounded, actionable critique. | Prompt calibration only. | Historical superiority commentary is removable rationale; independence is retained. |

### Sequential build executor

Source: [`faffter-noon-concurrency-sequential/SKILL.md`](../../../plugin/skills/faffter-noon-concurrency-sequential/SKILL.md). Inbound: beep-boop. Dependencies: graft, seven gateway obligations, dispatch/corrective/integrity/evidence/lane-boundary/heartbeat/ship operations.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-19, identity/When | Sequential default and mechanism contract. | Registry and selected execution strategy. | `judgement_seam:none` is plausible for scheduling, not for every delegated build/merge decision. |
| 21-25, contract | Seven obligations and required kernel/build/L4 resources. | Typed executor interface and capability constraints. | Recap is non-normative; do not delete obligation dependencies when reducing prompt loads. |
| 27-31, order | Independents in supplied order, then contiguous collision groups. | Pure flatten/order function. | Stable ordering, empty groups and duplicate members need fixtures. |
| 32, launch/prompt | One foreground subagent per independent or chain; explicit dispatch payload and fixed clauses. | Generate launch arguments, review-target/voice/terminal clauses, model tier/confidence extrema. | `dispatch resolve build` owns model/effort; effort is logged as unapplied and excluded from payload/event. Test exact omission for inherit. |
| 32, corrective branch | Re-dispatch only; held re-baselined manifest, trusted/custody-trusted narrowing, refuse/channel-D pass-through, empty/indeterminate park. | Extract into shared dispatch preparation with explicit custody baseline input. | `corrective.js` verifies this distinction. No fresh snapshot at consumption, no pre-authoring stale manifest. |
| 33-36, reconcile/review target | Disk/git over token claim; missing token reconciles; ad-hoc review explicit target. | Reconcile typed return and stamp target guard. | Never parse free-text transcript. Preserve exact authoritative artifact set. |
| 38, obligation 5 | Snapshot before dispatch; first return action verifies; trusted writes re-baseline; tamper/unavailable park. | Run-grain custody transaction. | Detached sentry can write while sequential build runs; foreground is not proof of zero concurrency. |
| 40, obligation 6 | Second action verifies EvidenceReturn; append evidence through re-baseline, unit-scoped park on failure. | Shared evidence verification step. | Test malformed/missing return, digest mismatch and ordering before outcome consumption. |
| 42, obligation 7 | Boundary emitted once before launch; third return action merges pr-ready above build boundary. | Shared merge completion workflow, custody verdict relay, post-merge tail. | Keep local/PR variant, collision guards, holdout and current floor. No raw pr-ready ledger bucket. |
| 44, token/buckets | Fixed five build buckets, superseded no-PR evidence and orchestrator-only dispositions. | Validate token and completion mapping. | Git-only shipped conflicts with blanket `pr != null` prose. Resolve at contract owner before claiming whole-executor parity. |
| 46, heartbeat | Shared sanctioned tick, active-writer ownership, separate heartbeat file. | Timed pulse lifecycle bound to dispatch run_dir. | `heartbeat` code exists; prompt execution/liveness is a separate trace requirement. |
| 48-51, dependency policy | Off parks unmerged dependency; stack pins parent SHA and later rebases; local degrades to off. | Dependency state machine, immutable pin and label/anchor operation plan. | Test closed-unmerged parent, conflict, pr-open, parked/errored, and one SHA used at every step. |
| 53, resume | Re-dispatch admitted without outcome; graft reattaches and review checkpoint saves work. | Resume selection and checkpoint invalidation. | Review stays inside build context; do not move review execution into scheduler during extraction. |
| 55-60, Rules | No autonomous WIP cap, no queue-order parks, no spend in token, orchestrator sole event/ledger writer. | Writer capability model and event emission. | Exact spend scope uses run measure_root and session id; an inline build replacement violates isolation. |

### Parallel build executor

Source: [`faffter-dark-concurrency-parallel/SKILL.md`](../../../plugin/skills/faffter-dark-concurrency-parallel/SKILL.md). Inbound: beep-boop. Shares the seven obligations; adds bounded concurrency and member supervision.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-21, identity/When | Parallel strategy, no change to contract. | Registry, pass initialisation. | Keep separate trace oracle from sequential execution. |
| 23-25, cap | Resolved concurrency_max, default 4; drain entire queue. | Bounded scheduler. | Validate positive cap; missing/invalid resolution must not imply unlimited dispatch. |
| 27-39, isolation/payload | Own worktree per member, one agent per chain; background dispatch, fixed clauses and unit model extrema. | Shared dispatch preparation plus explicit background strategy. | Same worktree exclusion and await-all are required, not implementation advice. |
| 41, corrective | Re-dispatch check recognises trusted narrowed constraints but supplies no manifest. | Share corrected preparation only after documenting current divergence. | Unlike sequential line 32, no custody-trusted branch or held baseline exists here. `foldCorrectiveAuthority` proves different reachable outcomes. |
| 43-50, token/pool/chains | Reconcile token from disk; bounded independent/group pool; serialize chains; dependency off/stack. | Scheduler and dependency completion state machine. | One chain agent returning only PR-ready while next member requires merged raises a coordination seam: dispatcher must merge between dependent members or receive incremental returns. Prose does not fully specify that handshake. |
| 51-54, await-all/checkpoint | Hold parent until all units terminal; checkpoint each poll; member pause versus run abort. | Event-driven supervisor using same checkpoint policy. | Preserve attendedness-based abort at non-L4, budget/effects/sentry order and no premature parent completion. |
| 56, heartbeat/writers | Per-unit heartbeat; run scalar atomic replace; ledger/events single orchestrator writer. | Typed pulse API and writer restrictions. | Existing heartbeat concurrency tests are primitive evidence, not full scheduler proof. |
| 58-71, Fleet supervision | Confirm terminal/dead boundary, selective WIP commit, park comment/label/ledger then free slot. | Ordered member-park transaction with injected liveness evidence. | Never interrupt live-but-slow agents. Require both heartbeat/build-start old for dead path; no run abort from one stalled member. |
| 73-83, Rebase-before-merge | One merge lock, current base rebase and green, verify evidence/custody, bounded repair redispatch. | Shared merge supervisor with lock and rebase strategy. | Revalidation head identity, lock release on every failure and one CI fix attempt need fault-injection tests. |
| 85-95, custody chain | One wave baseline; per-return verify, trusted-write re-baseline, prefix-preserving event append, final verify. | Stateful custody owner. | Run-grain tamper halts new launches and drains live units. Do not confuse this with per-unit evidence mismatch. |
| 97-99, evidence | Unit verify after run-grain verify, before consuming token; unit park only. | Shared return verifier. | Test healthy siblings keep launching after unit-only mismatch. |
| 101-103, merge above cut | Dispatcher calls ship/post-merge and records final bucket under merge lock. | Shared merge-completion path. | This local section lists PR flags but omits local mode mentioned by shared contract/sequential executor. Preserve contract coverage in package tests. |
| 105-112, Rules | Cap, isolation, green head, no scheduling parks, bounded supervision, unchanged token and sole spend writer. | Runtime invariants and trace assertions. | Deterministic promises require an executor, not just removing its prompt. |

### Thematic methodology

Source: [`faffter-noon-methodology-thematic/SKILL.md`](../../../plugin/skills/faffter-noon-methodology-thematic/SKILL.md). Inbound: backlog/queue/roadmap/creation consumers and agile composition. The name "opinion-free" does not make semantic mapping deterministic.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-19, identity/default | Graph-derived baseline; topology floor shared with agile. | Registry and requested-output dispatcher. | Do not collapse floor into a selected methodology and make it optional. |
| 21-25, ordering | Inherited priority, live transitive unlock count, oldest tie-break. | Pure graph sort using explicit effective-priority facts. | Test diamonds count unique dependents, terminal edges ignored, inherited ties, cycles and stable IDs. |
| 27-31, Outputs | Fixed named capabilities; issue-critique intentionally unanswered. | Output registry and required/optional validation. | Preserve no-critique rather than manufacture an empty positive judgement. |
| 33-43, pick-ordering | Core order plus optional within-priority PRD distance. | Stable band composition. | "Neutral keep position" needs explicit algorithm for mixed matched/unmatched elements; no-map byte equality is mandatory. |
| 45-57, promotion | Clear blockers, concrete deliverable/spec, closed punts, valid assumptions; repeat/stale/challenged demotion. | Conjoin typed evidence; park-history set; readiness result schema. | Concrete deliverable, challenge resolution and assumption truth stay judgement. Exact state naming Done versus terminal satisfied requires gateway parity. |
| 59-78, ticket-shaping | Brief-derived literal workstream names; single-item split only when flagged; one recursive altitude. | Shape-level/mode validation, relationship proposal schema and Backlog defaults. | Choosing first-slice work and defensible structure stays generative. No tracker writes in this output. |
| 80-97, backlog-diagnostics/detection | Cycles, named missing containers, repeat parks, semantic splits/chain gaps, intersections. | Graph SCCs, exact-name inventory, `park-history`, counted coverage/intersections. | Container text extraction, defensive edge, work-unit matching and illustrative-reference exclusion remain judgement. No broad stale-spec sweep beyond stated filter. |
| 99-111, fixes | Selective cycle/repoint/demote; split surface only; gap-ticket creation by appetite/subtype; cancellation human. | Typed fix proposal, appetite action matrix, idempotent ticket relationship plan. | Clearly matching container/real prerequisite are judgement inputs. Thematic auto-create begins high; example later says medium, a conflicting example. |
| 113-169, Output | Structural diagnostics and routing facts. | Render typed findings, suppress empty section and emit cycle/gap facts. | Long illustrative examples can become fixtures, retaining every category/action expectation. |
| 171-179, standup | Recently shipped 24-48h, newly unblocked focus, warnings and counts. | Snapshot/time filtering and ordered sections. | Horizon window is a range, not an exact constant; pick current policy before codifying. Gloss/focus remains judgement. |
| 181-188, horizon | Now/Next/Later plus roadmap gaps/stalls. | State mapping, 14-day inactivity predicate and graph render. | "Nearly clear" blockers is unspecified judgement, not an implementable boolean without supplied evidence. |
| 190-198, build queue | Build-ready admission; same order, conflict partition, waves until drained/budget. | Reuse queue and partition mechanics. | Conflict heuristics live in beep-boop; never fork them in methodology extraction. |
| 200-216, termination policy | Six ordered non-floor rungs; safety floor remains CLI-owned. | `run-done` already has the same structural-default ladder. Default output can be a built-in policy descriptor. | Do not add a model call to return literal built-in data. Preserve override protocol for other methodologies. |
| 218-232, crank-up-set | Graph roots/runway/frontiers/shared ownership with hypothetical badges. | Extract graph walk and distribution renderer. | Risk-tier input and appetite depth need explicit data; do not guess thresholds where prose gives only qualitative depth. Agile consumes this algorithm. |
| 234-251, prdr-author | Target precedence, preserve human DoD, child-derived DoD, all covered PRD goals, low-confidence fallback. | Resolve target, merge only unset fields, write Proposed record using `prdr new`. | Goal coverage/DoD synthesis remains judgement. Agile inherits field derivation and reshapes ambition. |
| 253-263, yagni-judge | Material goal service and scope proposal, no admission. | Boolean-to-proposal fold and typed upper-gate input. | Mapping actual capability to goals is semantic, despite "graph/text trace" description. |
| 265-269, rehome-set | Intentionally empty grouping opinion. | Constant empty result with zero writes. | Keep explicit no-op for compatibility rather than invoke a model to reproduce it. |
| 271-283, Appetite | Action matrix, no value reorder/topology restructuring. | Shared policy table and action authorization envelope. | Distinguish graph-derived mechanical actions from human-curated structure floor. |
| 285-290, Rules | Baseline survives dark selection; topology floor always fires. | Compose shared baseline by capability, not loading both complete prompts. | Baseline name claims no right-sizing while split diagnostics still inspect concerns; keep semantic seam declaration honest. |

### Agile delivery methodology

Source: [`faffter-dark-methodology-agile-delivery/SKILL.md`](../../../plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md). Inbound: same methodology consumers. Explicit dependencies: thematic crank-up-set/PRDR derivation and gateway topology policy.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-17, identity/config | Opinionated delivery lens. | Registry selection. | Opening says low/medium no autonomous mutations, contradicted by medium actions later. |
| 19-41, Outputs/mapping | Named capabilities and principles; WIP only standup; compose thematic helpers. | Output dispatcher and baseline composition. | Required capability set is contract; seven-principle interpretation remains judgement. |
| 43-51, recursive shaping/PRDR | One altitude; outcome-led first slice; target-scaled DoD and human edits preserved. | Target/shape-level controls and field preservation. | Outcome grouping, thinnest useful DoD and goal coverage remain judgement. |
| 53-78, inward rehome | Deepest actionable gating chain, cycle stop, shared blocker one home, fresh/idempotent state. | Graph walk and proposed reparent operations after typed actionable/stream facts. | Whether home is a value stream and topology is human-curated remain evidenced judgements. Reorder-only at surface appetite. |
| 80-98, outward scope cut | Only noncritical work, DoD still satisfiable, real DoD-bearing home; high confirmation, full action. | Conjoin provided gates and perform reversible plan. | DoD preservation is a judgement seam; absence must remain surface-only. Preserve disjointness from blocker intake. |
| 100-106, default landing | New unsequenced work projectless Backlog unless coherent actionable outcome; greenfield exemption. | Default proposal and exact mode/appetite branching. | Coherent outcome exception remains judgement; no reparenting existing work here. |
| 108-130, thematic conversion | Detect non-outcome grouping; rehome live work, remainder Backlog, retire only drained shell. | Plan completeness, terminal-ticket exclusion, preserved edges, retire precondition and idempotence. | Outcome destination assignment and ambiguous/human-curated consent remain judgement. High/full retirement wording needs reconciliation. |
| 132-152, rehome-set | High-confidence outcome clusters, complete partition, cycle-free proposed edges, leave-loose reasons. | Validate exactly-once coverage, graph-cycle test and read-only output. | Clustering/coherence/order remain judgement; breadth changes with appetite, write authority never does. |
| 154-166, principle 1 | Outcome names and evidence-backed naming diagnosis. | Structured diagnosis renderer. | Naming semantic distinction remains judgement. |
| 168-178, principle 2 | Incremental value/risk sequence; PRD distance within human-priority bands. | Compose supplied ranking/band data with distance map. | Value judgement stays; full appetite priority freedom and distance band floor must coexist explicitly. |
| 180-190, principle 3 | Human active WIP cap 3, review queue excluded, autonomous unbounded. | Count/filter and recommendation guard. | Distinguish human active work from autonomous builds using recorded actor, not inference from issue state alone. |
| 192-200, principle 4 | 1-3 day units, independent split and always-together merge. | Store size/split proposal and enforce allowed operations. | Duration estimate and independence remain judgement. |
| 202-210, principle 5 | One outcome per workstream. | Completeness/schema only. | Cohesion remains judgement. |
| 212-222, principle 6 | Explicit semantic dependencies and named gating-chain findings. | Compare judged dependency edges with graph; propose missing links. | Existence of a textual mention alone does not prove dependency. |
| 224-234, principle 7 | De-risk new integration/external dependence early. | Apply supplied risk rank and maintain dependency constraints. | Risk classification remains judgement. |
| 236-244, tone | Situation, consequence, action; educational diagnosis. | Structured result renderer. | Clear consequence wording remains editorial judgement. |
| 246-263, appetite low/medium | Low surface, medium gap creation/default landing and limited ordering. | Single operation-specific policy table. | Lines 10 and 297 call medium read-only; lines 106/261 authorize specific actions. Exact parity requires choosing rule precedence explicitly. |
| 265-283, high/full | Splits, queue/rehome proposals/actions, status moves, scope gate and fullest authority. | Executor consumes authorised plan, logs every operation, never deletes scope. | Do not infer permission from the word full alone; human-curated boundaries and explicit ask-first remain. |
| 285-298, floors/Rules | No cancel/delete, no ungrounded acts; baseline addition and high authority definition. | Closed operation policy and provenance checks. | Line 298 limits shell retirement to full, while conversion's high wording is broader. Preserve clear authoritative floor in extraction inventory. |

### ADR author

Source: [`faffter-noon-adr/SKILL.md`](../../../plugin/skills/faffter-noon-adr/SKILL.md). Inbound: graft Step 4b and architecture promotion candidates after settlement. No dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-14, identity/ownership | Single author of settled ADR prose; CLI owns scaffold/numbering. | Resolve internal prompt and structured inputs. | Keep one authoring strategy, no duplicate architecture writer. |
| 16-18, When | Author after build so consequences reflect shipped behaviour. | Workflow timing. | Do not move authoring to spec time while claiming parity. |
| 20-28, Input | Decision/spec/issue/related ADRs; resolve format through CLI only. | Run `adr list` and `adr format`, ordered sections. | `adr-slot` tests default/structural lint; no semantic authorship proof. |
| 30-42, Output | Exact sections, settled choice, actual consequences, self-review and advisory confidence. | Template render, confidence enum, no gate. | Content and confidence stay judgement. A low rating changes graft routing, never whether promoted decision is recorded. |
| 44-48, Rules | Chosen only; concise prose; no numbering/commit/routing in author. | Input class guard and capability separation. | Preserve custom template headings and decision_section identity. |

### Architecture proposer

Source: [`faffter-noon-architecture/SKILL.md`](../../../plugin/skills/faffter-noon-architecture/SKILL.md). Inbound: brief/spec workflow. Outbound: proposal envelope and ADR intent; no dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-18, identity/What | Generate one architecture; never commit ADR or run critic. | Read-only proposer capability and shared contract emitter. | Proposal/critic isolation must survive reduced context loading. |
| 20-23, Inputs | Brief plus profile show; no mine; missing profile assumption. | Fetch/profile exit-3 branch. | Other profile failures must not be mistaken for known absence. |
| 25-32, strategy | Fit profile, build bias, explicit assumptions/requirements, one design, ADR candidates. | Track requirement references and candidate schema. | Architecture choice and production fitness stay judgement; non-build output is human surfaced. |
| 34-48, Output | One proposal block plus matching intent and advisory confidence. | Emit intent from same candidate array; validate contract. | `computeArchitectureProposal` checks shape, not requirement coverage or real production fitness. |

### Environment composition

Source: [`faffter-noon-env-compose/SKILL.md`](../../../plugin/skills/faffter-noon-env-compose/SKILL.md). Inbound: evaluator/provisioning caller. Outbound: one env-handle; composes transport and code-interface. No dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-18, identity/What | Provision and seed, never judge; none seam declaration. | Internal provisioner workflow. | Line 31 explicitly makes subject/service/bridge selection a judgement. `none` is not a reliable audit classification. |
| 20-23, Inputs | Proposal/profile absence branches; double-absent repo-compose fallback, nonready if no services. | Input resolution and explicit note propagation. | Malformed proposal equals absent per existing rule; do not silently make it hard failure. |
| 25-29, engine/recommendation | Ambient Docker context; no retarget; non-build provisions nothing and emits no handle. | Fail-closed branch and environment propagation. | Test no Docker call/no handle for non-build, not a fabricated failed handle. |
| 30, transport | Resolve configured transport, inline return, default co-resident localhost. | Slot resource resolution and typed result. | No hardcoded occupant fallback after registry lookup. |
| 31, subject choice | Decide services, code components or both from trusted specification/profile. | Accept typed subject selection and primary subject. | Keep judgement seam; manifest presence must not trigger bridge choice. |
| 32, bridge contribution | Invoke component provisioner inline; one shared plan/up/health/teardown, subject-keyed endpoints. | Plan merge and deterministic failure folding. | Existing bridge integration uses a fixture setup, not proof this prose plan merge runs. No SUT paths in handle. |
| 33-34, compose plan | Use plan fields, base validation, repo reconciliation, reject unknown datastores. | Existing `env compose-gen` and base allowlist. | Plan is single source; do not rederive endpoints from prose. |
| 35-36, up/seed | Health then seed; nonzero tears down and fails. | Transactional up/seed/finally-down wrapper. | Skill says redis/mongo mount unseeded; code and `env.test` now command-replay/mongoimport. Preserve runtime code and document conflict. |
| 37-39, handle/credentials | Ready only after gates; fold transport teardown/credentials; ephemeral env; never persist creds publicly. | Handle builder and composed cleanup plan with redaction. | Current teardown_ref/cmd folding is prose-defined and needs executable combined-cleanup tests. |
| 41-61, Output | One env-handle plus advisory confidence; ready fields enforced. | Shared serializer and contract validator. | Ready shape does not establish actual healthy/seeded state. Fixtures need real command trace, not just JSON acceptance. |

### Code-interface provisioner

Source: [`faffter-noon-env-code-interface/SKILL.md`](../../../plugin/skills/faffter-noon-env-code-interface/SKILL.md). Inbound: env once per chosen component. Inline return; no independent gated block and no dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-18, identity/What | Reach chosen component through Node bridge; subject choice belongs to env. | Internal component provisioner. | Intro says starts/health-checks bridge; procedure correctly only contributes service to env. Use latter sequence in parity tests. |
| 20-26, Inputs | Component, subject, validated host, explicit manifest, topology. | Input schema and path resolution. | Never rely on manifest/bridge hidden defaults. |
| 28-55, contribution procedure | Validate manifest, build/resolve module, validate host, add bridge, derive endpoint and plain result. | Deterministic plan contribution once build command/module target are supplied. | Component build/entry discovery can require project judgement; accept explicit resolved build plan. Exactly one env up after all contributions. |
| 57, code-blind notes | No SUT module/manifest paths in evaluator-visible fields. | Separate private diagnostic fields from public handle; validate/redact. | Path absence cannot be proved by a short substring blacklist alone. |
| 59-65, reachability/placement | Rootless alias no host publish; localhost loopback only; rootful host-gateway; SUT-side execution. | Topology-specific compose plan. | Rootful rule says no all-interface publish without a full bind recipe; test actual reachability and isolation, not strings alone. Topology proof remains external. |
| 67-86, Output/anti-patterns | Subject-keyed endpoint/health, shared teardown, no paths/block/half-up env. | Plain result schema and fold validation. | Docker-gated RPC integration has injected exercise; it does not prove complete LLM selection/provisioning parity. |

### Private-network transport

Source: [`faffter-noon-transport-private-network/SKILL.md`](../../../plugin/skills/faffter-noon-transport-private-network/SKILL.md). Inbound: env. No dark substitute; deterministic intent but incomplete live branches.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-18, identity/What | Private-network reachability, no app auth; topology enum chooses rebase. | Internal transport strategy descriptor. | No need for an LLM on co-resident path. |
| 20-25, Inputs | Topology and substrate, not inferred separation. | Validate enums and pass explicit provisioning context. | Unknown topology behaviour is not specified; do not silently default every unknown to localhost. |
| 27-53, local resolver | Co-resident/absent localhost; rootless shared network versus rootful host gateway. | Docker capability probe and resource plan, credential-free result. | Engine rootless detection, network ownership and actual rootful route need fixtures/live conformance. |
| 55-64, cross-machine/future notes | Fly 6PN documented follow-on; base known before up. | Keep capability marked unavailable until implementation exists. | Do not convert aspirational pseudocode into a claimed shipped branch. Future-test narrative can move out of runtime prompt. |
| 66-77, Output | Bare validated host; optional credentials/cleanup folded into existing handle fields. | Typed inline result and composed teardown. | `envValidateBaseHost` protects interpolation, not network reachability or segmentation. |

### Code-blind evaluator

Source: [`faffter-noon-evaluate/SKILL.md`](../../../plugin/skills/faffter-noon-evaluate/SKILL.md). Inbound: graft/L4 evaluator lane. Dependencies: env, `dod classify`, RPC wire, evaluate-call spawner, holdout record/contract. No dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-24, identity/What | Code-blind outcome judge; classify and prose handling are mechanical; exercise/met decision are judgement. | Enforce input capability boundary and criterion partition. | A boolean self-claim is weaker than spawner attestation; preserve mode distinction. |
| 26-30, Inputs | Only spec and live handle; no code/tests/history. | Payload allowlist and artifact-free sandbox. | Provisioning fallback must not leak source context into judge. |
| 32-36, provision | Reuse handle or env slot; nonready produces needs-human then teardown. | Handle validation and early result fold. | Empty criteria can be refused by writer if classified judged IDs exist; actual `holdout-record` tests pin this nuance. |
| 37-40, classify/delegate | Running-stack only; IDs/text/holdout unchanged; delegated/integration excluded. | `dod classify` output selection and writer-derived delegated list. | Do not let evaluator supply its own delegated array or rename IDs. |
| 41-42, convention/exercise | Infer RPC versus service route from trusted criterion, derive requests and compare observations. | Execute a typed exercise plan, capture exact limited evidence. | Convention and request derivation remain judgement; endpoint responses stay data. No surface/error needs-human, never silent met. |
| 43, credentials | Every exercise request authenticated if derivable, no unauthenticated fallback; redact everywhere. | Header derivation, credential-unavailable result and secret scrub. | Existing helper tests cover headers; preserve plain-text evidence redaction as well as envelope redaction. |
| 44-45, RPC/failure planes | Open/call/static/close, close every path; WireError infrastructure versus thrown domain evidence, no wire retry. | RPC interpreter and finally-close from typed plan. | Matching thrown outcome to requirement remains judgement; unknown wire code needs-human. |
| 46, reasons | Prose human-only; five exact reason causes, no reason_code on met/unmet. | Closed reason mapping and validation. | Preserve distinction between human decision and repairable infrastructure gap. |
| 47, aggregate/emission | Deterministic aggregate, detailed evidence, no file write, caller record; cage spawner attests. | Shared aggregate/emitter and existing record writer. | Missing IDs/details must fail closed; no guessed aggregate or forged code_blind. |
| 48-50, teardown/boundary | Cleanup every exit, cleanup failure logs without changing verdict; never read tests. | Resource lease/finally cleanup with separate diagnostics. | Test early not-ready, thrown exercise, record refusal and failed teardown. |
| 52-80, Output | Detailed criterion block and derived aggregate. | Generate canonical schema/example from code. | Example is removable only when equivalent input/output tests and producer schema remain available. |

### PRD admissibility judge

Source: [`faffter-noon-prd/SKILL.md`](../../../plugin/skills/faffter-noon-prd/SKILL.md). Inbound: L4 run-start. No dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-16, identity/What | Code-blind judge supplies verdict; contract admits/refuses. | Internal prompt, fail-closed emitter. | Must preserve code-blind input and refusal semantics. |
| 18-21, Inputs | Read exactly resolved PRD file, no repo/tracker/run/spec. | CLI-resolved absolute path and capability restriction. | Reading unrelated kernel resources should not become permission to inspect code. |
| 23-28, Rubric | At least one verifiable stop condition; broad/tight licence advisory. | Derive verdict from judged boolean; enforce enum. | Recognition of concrete testability and licence remains judgement. Do not strengthen to all stop conditions verifiable. |
| 30-45, Output | Last fenced block; admissible empty reason, not-ready named reason. | Existing prd-readiness contract and deterministic serializer. | Shape is not evidence of meaningful termination criteria. |
| 47-51, Rules | Judge written text, no inferred goals; no softening to unblock. | Fail-closed missing/malformed response. | Retain calibration prompt and eval seam. |

### Delivery producer

Source: [`faffter-noon-ship/SKILL.md`](../../../plugin/skills/faffter-noon-ship/SKILL.md). Inbound: graft or concurrency merge locus. No dark substitute.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-25, identity/When/contract | Merge-only default after floor and existing interactive/autonomous authorisation. | Internal delivery strategy and typed handoff. | Do not introduce an extra confirmation while replacing implementation. Floor belongs to interlock. |
| 27-41, preconditions | Read-only push/scope/method/policy probes; confirmed block defers, indeterminate attempts merge, local skips all. | `delivery preflight` plus typed evidence/result. | Some probes require structured tool error classification; broad stderr keyword matching is not parity. No remediation of settings/auth. |
| 42, readiness | Default readiness always pass. | Constant strategy result. | Preserve extension point for deploy-capable replacement. |
| 43-47, merge/custody | Sole `merge-gate` path; PR/local forms; unchanged verdict path/hash relay. | Construct exact argv from validated handoff and call interlock. | Never recompute custody hash; test two-flag pass-through, omitted pair, local/PR variants and gate exits. |
| 48, cleanup | No default deploy state; worktree belongs to graft. | Empty cleanup strategy. | Do not let generic finally block remove worktrees. |
| 49-56, native mapping | Merge-ok shipped; refusal/error failed except confirmed mechanical precondition defer; unconfirmed success fails. | Deterministic mapping from structured merge result, no LLM result interpretation. | Current blockers are text-shaped; a typed result may be required before reliable extraction. |
| 58-74, Contract | Last delivery block with truthful corroboration, omit provenance, fallback when absent. | Shared serializer and contract validator. | `computeDeliveryOutcome` only coerces explicit `corroborated:false`; omission is accepted. Do not claim validator requires true. Add explicit absence parity case. |
| 76-83, Rules | Never weaken floor, squash/delete remote branch, no deploy, no admin remediation, no routing ownership. | Strategy constants and restricted operation plan. | Entire default can become code once probes/result classification are typed; no intrinsic generation remains. |

### Routing adaptor

Source: [`faffidavit-routing/SKILL.md`](../../../plugin/skills/faffidavit-routing/SKILL.md). Inbound: tidy, wtf and beep-boop; graft consumes park taxonomy. No bundled alternate.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-26, identity/contract | Assignment/display strategy; fixed six verdicts/admission and shared taxonomy elsewhere. | Registry plus typed routing facts. | Do not move queue admission into a swappable display adaptor. |
| 28-39, six verdicts | High/no blockers versus collision; unresolved decisions/medium; missing assumption; cycle; repeat history. | Pure decision table once semantic decision/assumption facts are supplied. | Conditions overlap and table gives no complete precedence. `computeAutomationRouting` validates enum only. Exact assignment cannot be claimed until multi-condition fixtures settle order. |
| 41-43, conflict | likely-fire exactly matches collision serialization. | Reuse one partition result. | Recomputing partition separately can change morning brief versus actual queue. |
| 45-49, Assignment | One verdict per spec-gated issue. | Validate exactly-once coverage and required inputs. | Non-Punt marker detection/spec closure and root-cause assignment remain judgement unless separately defined parser exists. |
| 51-58, Computation locus | Tidy writes per-run or dated output; same-pass reuse only; standalone wtf computes. | Snapshot-scoped cache and deterministic path/write. | Freshness key must be pass identity, not wall date or file existence alone. |
| 60-84, Display | Render partition and issue glosses with diagnoses. | Typed renderer and static layout. | Gloss/diagnosis remain judgement; long example can become golden fixture. |
| 86-111, Validate | Pipe extraction to contract and return stdout verbatim; exact 0/1/2 distinction. | Already contract-owned; wrapper can remove all prose parsing. | Validator does not enforce confidence/history/graph consistency or admission. Test invalid root cause versus invalid verdict separately. |
| 113-116, Rules | No vocabulary changes/detection/sequencing ownership. | Input/output boundary. | Preserve judgement seam for unresolved semantic facts, not for graph/count mechanics. |

### Rendering adaptor

Source: [`faffidavit-rendering/SKILL.md`](../../../plugin/skills/faffidavit-rendering/SKILL.md). Inbound: all human-facing skill surfaces. It has no pipeline gate contract and no bundled alternate.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-30, identity/no contract/adaptor/two faces | Pure presentation strategy with normalise/validate. | Registry, typed render interface and mode selection. | Explanations of why it is an adaptor can move to docs; semantic transform still needs a strategy. |
| 32-44, Scope/Voice | All human surfaces; logs/skills excluded; fixed AGENTS writing-style pointer through dispatch. | Surface registry and voice-pointer loading/dispatch binding. | Swapping form does not swap voice path; absent section skips per dispatch contract. Avoid loading whole gateway just to find one pointer. |
| 46-54, skimmability | 3+ enumerated items list; prose density and bold-lead style. | Typed list rendering and configurable width/sentence checks. | Detecting semantic enumeration in arbitrary prose is judgement; thresholds are approximate, not exact parser limits. |
| 56-67, token economy | Remove ceremony, repetition and padding. | Exact forbidden-prefix lint can assist. | Whether text is redundant or substantive requires editorial judgement; regex deletion alone risks meaning. |
| 69-73, visualisation | Structure visual, diagnosis/decision prose. | Pick renderer from typed structure kind. | Domain judgement chooses structure and explanation content. |
| 75-85, cycle bracket | Closed catalogue, inline chains 3+ items. | Deterministic graph formatter. | Two-item plain-prose exception must survive. |
| 87-95, cycle box | 4+ edges or branching. | Graph layout from supplied nodes/edges. | Branching threshold can be computed; legibility may need judgement. |
| 97-105, queue grid | Parallel/serial partition with gloss per ID. | Render supplied partition exactly. | Do not infer independence from visual layout. |
| 107-124, workstream/gate forms | Now/Next/Later and gate fire status. | Typed templates. | State/diagnosis truth belongs to caller. |
| 126-140, prose/lead model | Gloss/diagnosis/summary prose; hoist existing governing idea, never invent. | Reorder only when producer supplies explicit governing-statement field. | Finding the governing idea in arbitrary draft stays judgement; missing one is a producer gap. |
| 142-167, gloss/canonical | ID, human description and material unlock consequence; compact variants. | Renderer consumes structured gloss and consequence. | Gloss synthesis remains judgement, not title truncation. |
| 169-176, grounding | First mention carries gloss; whole-output minimum; later context may need regrounding. | Track ID occurrence and inject supplied gloss once. | Source has tension between first appearance and any one grounding anywhere; test intended enforcement rather than assume stronger rule. |
| 178-215, sources/humanisation | Prefer spec summary, then title/spec, then description; plain meaning, real concrete nouns only. | Source selection precedence and exact identifier preservation. | Paraphrase and explanatory sufficiency stay judgement. Repetitive delivery-lead rhetoric can leave runtime prompt. |
| 217-224, unlock language | Consequence only for at least two dependents or dependent with two; skip isolated one. | Graph predicate and optional field omission. | Consequence prose remains judgement. |
| 226-240, honesty/cache/consumption | Ambiguity explicit; per-invocation gloss cache only; every skill applies. | Invocation-scoped cache and structured uncertainty marker. | Never cache across fresh tracker reads. |
| 242-279, tables/lists | Approximate 30-char cells, multi-sentence or width overflow convert to key:value blocks with 40 box rules. | Deterministic renderer once width policy chosen. | Existing thresholds say approximately and 80-120 range; cannot claim byte parity without fixing display-width semantics. |
| 281-287, density | At most 3 cycles, 10 queue rows, 7 initiatives; remainder/log pointers. | Count/collapse formatter. | Must preserve full data in designated log, not merely truncate output. |
| 289-302, Validation/Rules | Flag or normalise without semantic change; closed visual catalogue. | Typed validators and body goldens. | Existing routing test excludes content; author supplied traces do not prove an actual renderer ran. |

### Slot authoring and semantic validation

Source: [`faffter-dark-authoring-adaptors/SKILL.md`](../../../plugin/skills/faffter-dark-authoring-adaptors/SKILL.md). Inbound: user authoring/audit and every first foreign-occupant use. No noon equivalent; retain capability independently of tier naming.

| Lines / heading | Purpose and retained judgement | Extractable mechanics | Dependencies, evidence and proof gap |
|---|---|---|---|
| 1-21, identity/binding | Build or audit swappable occupant; standalone loading and consumer contract binding. | Resolve slot metadata and required resource set. | Declares `judgement_seam:none` despite explicit semantic Validate below. Fix seam inventory before treating it as all mechanical. |
| 23-26, Two faces | Scaffold or pass/fail audit; foreign runtime validation. | CLI scaffold and structural validation dispatch. | Semantic validation still requires judgement; bundled exemption comes from registry/type predicate. |
| 28-41, contract table | Map slot to fixed contract or pure presentation/brief/mechanism. | Generate table/template from canonical slot registry. | Table omits newer slots such as architecture/env/evaluator/PRD/transport; concurrency recap lists four of seven obligations. Do not use it as complete source for new registry. |
| 43-52, checklist | Slot/contract identity, refer-back, non-normative recap, no vocabulary rewrite, faces/obligations, appetite, lane and seam. | Structural checks already in validate-adapters; add typed schema/template generation. | No-redefinition, lane ownership and actual appetite semantics remain judgement. Alternate seam declaration rule has exceptions in current skills. |
| 54-74, Author | Skeleton with contract pointer/dialect/validate/rules. | `slot scaffold` from registry and boilerplate templates. | Dialect authoring remains generative; scaffold sample lacks frontmatter required elsewhere. |
| 76-90, Validate | Exact signal/violations; structural precheck versus semantic audit. | Shared structural CLI and deterministic report emitter. | Existing configured lint can warn for missing foreign path and still pass; semantic runtime validation must remain mandatory when required. |
| 92-96, Rules | Never edit fixed contract while authoring; foreign-only gate before use. | Cache validation within run against occupant/resource identity. | Name-only cache is inadequate after file changes; currently no content-addressed cache rule is specified. Treat hardening as separate from parity. |

## Conflicts that must be resolved before claiming exact parity

These are conflicting instructions or instruction/code mismatches, not proposed silent corrections.

| Evidence | Conflict | Safe treatment |
|---|---|---|
| Sequential concurrency line 32; parallel line 41; `corrective.js` lines 253-267 and manifest handling | Sequential supplies a held custody manifest and accepts custody-trusted; parallel omits both. | Record both current traces. Decide the intended shared rule explicitly; any changed parallel outcome is a named correction, not parity. |
| Env-compose line 36; `env.js` DATASTORE_TABLE/seed dispatch; `env.test` redis/mongo tests | Prompt says unseeded mount; production code implements Redis command replay and Mongo import. | Keep executable seed strategies. Remove stale prose through a changed-rule inventory row backed by actual command tests. |
| Dark spec-review lines 202 and 226; `parse-refutation.mjs` lines 193-218 | One section allows claim-only objections; another says missing evidence/consequence faults. Parser requires claim only. | Make command output authoritative and keep degraded enrichment. Do not accidentally harden parser while extracting invocation. |
| Dark review lines 85-98, 338, 342-357 | Unified both-phase findings and autonomous/outage signal changes conflict with repeated Phase-1-only language. | Test every outcome branch and raw versus normalised fields; retain intentional exceptions in one result fold. |
| Agile lines 10, 106, 259-263, 297 | Medium described as read-only and also authorised for default landing/gap creation. | Use an operation-specific policy table with declared precedence. Do not translate broad labels directly into capability denial or blanket write permission. |
| Thematic line 110, example line 142, appetite line 277 | Thematic gap creation starts high, example says medium. | Treat the action rule/table as candidate intended authority, but record the example correction rather than imply text was consistent. |
| Ship line 71; `computeDeliveryOutcome` | Prompt requires true only on evidence; validator only rejects explicit false, accepts omitted corroboration. | A wrapper can always emit an observed boolean. Do not claim validator itself enforces a required true field; tightening legacy input is separate. |
| Standard spec-review roll-up lines 55-62 | Multiple blocker lenses have differing outcomes without an explicit tie-break. | Add mixed-lens cases and ratify precedence before a deterministic extraction claims equivalence. |
| Routing lines 34-39 | An issue can simultaneously have medium confidence, a cycle and repeat-park history; no total assignment precedence is specified. | Freeze precedence with explicit cases. Keep semantic feature extraction separate from rule fold. |
| Parallel lines 43, 46-48, 103; sequential lines 32, 42, 50-51 | A chain runs in one subagent until return; dependent needs previous member merged, while merge runs only in dispatcher after return. | Specify incremental chain/member handoff or equivalent existing runtime interaction. No code-level scheduler parity proof exists from this prose alone. |
| Sequential line 44 and local ship path | Shipped/pr-open implies a PR, but git-only shipped has no PR. | Preserve actual local terminal representation established by shared contract/caller; record clarification. |
| Env-compose line 31 and authoring-adaptors lines 90/95 versus frontmatter | Skills marked none explicitly contain judgement. | Inventory and eval coverage must follow actual decision seams, not naming or frontmatter claims. |

## Redundancy and zero-value candidates

| Candidate | Why it can leave runtime context | What must remain or move first |
|---|---|---|
| Config examples and repeated "default when unset" introductions | Registry already resolves selection; each invocation does not need a user setup tutorial. | Generated operator documentation and tested slot resolution. |
| Repeated schema examples and prose exit tables whose exact behaviour is code-owned | Commands can return validated machine records and stable errors. | A small input/output schema reference, branch handler and direct function/CLI tests. Contract acceptance alone is insufficient. |
| Dark review provider table, wire implementation narrative, trim/deadline algorithm explanation | `review-call.mjs` owns these mechanics; caller must use it rather than reconstruct requests. | Operator config docs, stable invocation wrapper and transport tests. |
| Long historical or causal explanations of background reaping, old transport behaviour, prior parser faults and old races | They describe motivation/history rather than a step the current executor needs. | Retain actionable foreground/await-all/lifecycle rule and tests; move rationale to design documentation. |
| Thematic `run-termination-policy` model answer | It returns exactly the built-in structural-default policy. | Direct built-in policy selection, retaining override interface. |
| Thematic `rehome-set` model answer | Defined constant empty opinion with zero writes. | Direct empty result and complete caller no-op behaviour. |
| Co-resident transport model invocation | Explicit enum/absence maps to localhost with no resources. | Pure resolver branch and exact result-shape fixture. |
| Default ship no-op readiness and no-op deploy cleanup | Constants, no judgement or environment decision. | One delivery command retaining extension points and merge floor. |
| Repeated spec readiness and reviewer envelope prose across noon/dark | Shared wire schema and serializer can carry it once. | Keep distinct judgement strategies and their inputs; preserve standalone and nested context rules. |
| Full noon prompts loaded to obtain one shared subsection | Dark nlspec needs self-review, agile needs graph helpers/PRDR fields, dark review needs five-pass strategy. | Internal named resources/functions and a dependency manifest that loads only required material. |
| Rendering explanations of adaptor/producer taxonomy and repeated scope statements | They explain organisation rather than output decisions. | One central surface rule plus renderer policy; keep gloss and semantic-normalisation judgement. |
| Entire noon/dark family based solely on its tier name | No evidence supports deletion. | Nine unique noon capabilities, five genuinely different pairs, shared helpers, third-party compatibility and selected defaults all need explicit handling. |

## Suggested extraction order

1. **Freeze source and observables.** Record hashes of skill text, helper assets and config defaults. Build baseline cases with explicit external snapshots and stubbed judgement returns. Capture command argv, exit/status, file bytes, comments/labels/status relationships, dispatch payloads, selected resources, write order and cleanup. Supplied trace equality proves equality of supplied traces; it does not prove capture completeness or live equivalence.
2. **Resolve contradictory rules.** Use the conflict table above to distinguish preservation from correction. Each deletion/change gets a rule-inventory row and a test identifying the behaviour. Do not use an LLM reading of conflicting instructions as the parity oracle.
3. **Extract leaf orchestration.** Start with shared envelope emitters, spec self-review cap/retry routing, noon verdict fold, routing fold over typed semantic facts, config resolution, review transcript/pin capture and constant methodology outputs. New modules under `faff/bin/lib` are TypeScript with committed JavaScript emit/build manifest; tests go in `test/`.
4. **Extract bounded workflows.** Compose the existing review helpers behind a command; make default ship and env up/health/seed/cleanup transactions code-owned. Preserve all status and cleanup branches. Keep architecture, discovery, spec authoring, critique, exercise derivation, rebuttal and semantic methodology decisions as explicit judgement calls.
5. **Extract the common build executor.** One owner manages custody, evidence, dependency disposition, event/ledger writes and merge completion. Sequential and parallel become scheduling strategies over the same obligations. Retain foreground versus background posture, member supervision, merge lock and retry limits. Prove each strategy separately before testing any proposed equivalence at cap 1.
6. **Move internal resources before changing discovery.** Add a canonical internal registry mapping slot, strategy, resource path, contract, dependencies, judgement seam and executable helper paths. Retain historical occupant names as aliases. Split shared self-review, standard code-review and thematic helpers into bounded internal resources. Load the selected judgement prompt at its call boundary; deterministic steps need no skill prompt.
7. **Change install discovery as a separate migration.** Publish only intended user entry skills. Keep internal resources in the installed package under a non-discovered path. Verify plugin-native install, local/global symlink install, custom skill targets, namespaced invocation, worktrees and standalone resource lookup. Remove only installer-owned old links; preserve foreign entries. Update validation, eval registry, prose baselines, rule inventory and asset import paths together.
8. **Migrate the chosen defaults separately.** Dark becomes the default for all five paired slots. Keep noon strategies fully aside as explicit opt-ins and preserve historical occupant names in configuration. Distinguish unset slots, which intentionally change selection, from explicit noon/dark or foreign overrides, which retain selection. Keep the nine unique noon capabilities as internal role prompts and retain the two faffidavit adaptors. Test the changed concurrency and methodology behaviour separately from review/spec policy changes. Dark defaults introduce independent model configuration and may fail startup/review where noon previously ran without it; surface that intentional change in the migration design. Consider retirement of noon opt-ins only after third-party usage provides evidence about compatibility and remaining demand, with no retirement in this migration.

The target public surface can remove noon/dark tier names without forcing all slots through one oversized prompt. Dark is the default path, while legacy noon strategy selection stays available through explicit configuration. Internal strategy selection is still required wherever existing behaviour differs. Lazy loading means loading a requested judgement resource after slot/strategy resolution, with its exact declared dependencies. It does not mean omitting shared contracts or hoping the parent context supplies them.

## Concrete proof cases for implementation tickets

| Extraction | Required positive and failure cases | Observable equality |
|---|---|---|
| Slot resolution/package migration | All 16 current defaults and five intentionally changed dark defaults; each explicit noon/dark override; namespaced and foreign occupant; nine unique internal capabilities; wrong-slot bundled name; unknown/missing resource; local/global/worktree installs; spaces in paths. | Declared default changes only; preserved explicit strategy, required validation, loaded prompt/helper hashes and invocation target. No hidden duplicate catalogue entries. |
| Shared spec self-review | Fresh tiny/large draft, already-dispatched context, narrowing refresh, absent exemption; scenario warning repaired/still bad/no JSON; 0/1 blockers and 2/3 majors; eligible/noneligible punts. | Same reviewer calls, retry count, rating cap, review record and final readiness bytes. |
| Noon spec-review/routing folds | Mixed blocker lens combinations; empty findings; missing critique; selected lens subset; simultaneous cycle/gap/medium/repeat history; collision groups. | Same explicit policy outcome and founded objection/route record, after precedence is specified. |
| Dark spec-review round | All transport exits and parser exits; claim-only enrichment; truncated fault; config fault; unavailable swing/non-swing votes; one/four lenses; invalid aggregate. | Same call count/argv, result order, raw/transcript files, model identity, contract and hold/needs-human distinction. |
| Pin/transcript mechanics | Round one served, later fallback served, no served lens, corrupt pin, reputation filter all flagged, repeated same-round attempt, concurrent exclusive creation, failed write. | Same pin stability, served-per-round identity, non-clobbered evidence and explicit failure result. |
| Adversarial code review | Phase 1 fail/human/pass; interactive/autonomous critical; missing autonomous signal; fixture-capped critical; clean marker; prior carry; all exit classes, ledger L4 mandatory and stale checkpoint. | Same hard signal, both-pass findings, raw annotations, checkpoint writes, independent call and disposition path. |
| Ship | Confirmed each precondition block; indeterminate probe; local mode; merge 0/1/2; conflict; timeout; unconfirmed success; exact custody pair. | Same probe order, no mutation from preflight, merge argv, output block and zero worktree teardown. |
| Env/transport/bridge | Proposal/profile each missing/both missing; non-build; unknown datastore; Redis/Mongo current strategies; health/seed error; mixed service+two bridges; primary bridge; malformed host; rootless/rootful/co-resident. | One plan/up/health pass, correct endpoints, no evaluator-visible source paths, no host-wide exposure, complete teardown and no false ready. |
| Evaluator | Running-stack/delegated/integration criteria; prose reason; no surface; auth absent/valid/invalid; WireError versus expected thrown error; opened-session failure; teardown failure. | Same judged IDs, credentials on every exercise, exact redaction, reason_code, aggregate, attestation and cleanup. Judgement is stubbed for mechanical proof. |
| Sequential executor | Empty queue, independent/chain order, missing token reconciles, evidence mismatch, held custody tamper/error, detached trusted write, corrective empty/refuse/custody-trusted, dependency off/stack/local. | Same terminal buckets, launch posture, per-member handoff, artifacts, sole-writer event order and no merge below boundary. |
| Parallel executor | Cap enforcement, two concurrent groups, one slow live member, dead member, run abort, per-unit evidence mismatch, run-grain tamper, merge conflict/red CI, moving base, lock release. | Same dispatch/merge order within allowed schedule, no live-agent interruption, exact park scope, current-head floor and drained in-flight work. |
| Methodology mechanics | Graph cycles/diamonds/terminal edges; priority inheritance; distance map absent/mixed neutral; repeat-window boundary; shared crank-up member; human DoD; complete rehome partition; human-curated boundary. | Same ordered proposals and authorized operation list. Semantic judgement inputs remain explicit fixtures. |
| Rendering | First ID grounding, repeated ID, 2/3-item lists, 3/4-cycle and 10/11-row boundaries, 7/8 initiatives, long cell, Unicode width, missing governing idea, unknown gloss, invocation cache invalidation. | Same preserved meaning, full underlying data, required normalisation call and expected body for deterministic templates. No gate semantics introduced by styling. |

Where current prose leaves behaviour unspecified, a new test must record the chosen specification rather than pretend to have measured the old behaviour. Where behaviour is already code-owned, test the committed emitted JavaScript and the real CLI entrypoint, with injected tools or fixtures for external effects.
