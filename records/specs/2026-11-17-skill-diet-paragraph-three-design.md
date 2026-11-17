# Shorten repeated skill explanations

## Scope

Compress explanatory paragraphs in graft, prep and adversarial spec-review. Preserve commands, schemas, tables, headings, frontmatter and operational procedures. Keep all triggers, owners, ordering, failure branches and inherited policy distinctions. This is prose compression only, with no CLI behaviour change or new judgement seam.

Independent before/after source review and existing consumer/lint tests verify this bounded edit. No fresh model parity result is claimed; no harness or raw experiment evidence is included. Byte allowances decrease to the exact new sizes.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Graft owns the worktree mechanism; the policy (location ~/.faff/worktr` | changed: same faff-graft rule, concise wording |
| `Step 3's faff worktree ensure invokes the bundled setup-worktree.sh (n` | changed: same faff-graft rule, concise wording |
| `Mint the interactive run substrate (standalone/top-level interactive g` | changed: same faff-graft rule, concise wording |
| `Step 4c: Reconcile-before-materialise a decisions-register intent. If ` | changed: same faff-graft rule, concise wording |
| `The mutex is the write-once refs/faff/build-claims/<issue> git ref on ` | changed: same faff-graft rule, concise wording |
| `Staging & committing the build — stage SELECTIVELY, never git add -A. ` | changed: same faff-graft rule, concise wording |
| `A cost-ordered engineering-quality gate ladder runs the repo's own dec` | changed: same faff-graft rule, concise wording |
| `Step-8 reconciliation — one resolver, one suite run (no double-run). T` | changed: same faff-graft rule, concise wording |
| `Heartbeat ticks (autonomous only). The gate ladder is a long, quiet su` | changed: same faff-graft rule, concise wording |
| `The full suite + lint backstop already ran once as Step 7.5's UNIT and` | changed: same faff-graft rule, concise wording |
| `The build is complete (gates + AC passed). Make it durable on origin n` | changed: same faff-graft rule, concise wording |
| `Runs after AC verification, before the PR is opened (Step 9b) and befo` | changed: same faff-graft rule, concise wording |
| `Remote-backed review diff. Capture the review diff once against the fe` | changed: same faff-graft rule, concise wording |
| `Heartbeat ticks (autonomous only). Review is the longest quiet sub-ste` | changed: same faff-graft rule, concise wording |
| `Resume from a review-progress checkpoint (autonomous only). The advers` | changed: same faff-graft rule, concise wording |
| `The unavailable disposition. An outage means the reviewer was down, no` | changed: same faff-graft rule, concise wording |
| `Where findings go — the TRACKER ISSUE, never the PR. Review runs pre-P` | changed: same faff-graft rule, concise wording |
| `Record the review result — collapse-and-log, not append-per-pass. A fa` | changed: same faff-graft rule, concise wording |
| `The write mirrors Step 5's mechanism exactly (live status re-read, age` | changed: same faff-graft rule, concise wording |
| `Anti-patterns: introducing a faff status set CLI (status writes stay a` | changed: same faff-graft rule, concise wording |
| `Endgame-only entry (a stranded In Review PR resumed by a later L3 exec` | changed: same faff-graft rule, concise wording |
| `_ADR-collision merge guard._ faff adr new allocates a number at branch` | changed: same faff-graft rule, concise wording |
| `The new outcome token: landing-resumable. Distinct from pr-open-for-hu` | changed: same faff-graft rule, concise wording |
| `Prerequisite check: before running this step, verify Steps 8, 9, and 9` | changed: same faff-graft rule, concise wording |
| `Never say "I'll check CI once it reports" and end the turn — turns don` | changed: same faff-graft rule, concise wording |
| `Conflating "zero checks" with "checks failed" either masks the absence` | changed: same faff-graft rule, concise wording |
| `Turn a vague ticket into something buildable. Prep does the thinking s` | changed: same faff-prep rule, concise wording |
| `Faff-prep is an orchestrator — it owns the issue tracker lifecycle and` | changed: same faff-prep rule, concise wording |
| `Faff-prep invokes the configured/default spec skill with the issue con` | changed: same faff-prep rule, concise wording |
| `Producer requirements (the slot contract relies on): the spec skill mu` | changed: same faff-prep rule, concise wording |
| `All human-facing output this skill emits — the spec-attach comment and` | changed: same faff-prep rule, concise wording |
| `The spec is a high-level design document. It does not contain implemen` | changed: same faff-prep rule, concise wording |
| `Every spec faff-prep attaches (freshly produced by the spec slot, or r` | changed: same faff-prep rule, concise wording |
| `The confidence gate above asks is the spec internally well-formed?. Th` | changed: same faff-prep rule, concise wording |
| `Lens selection (the cost-gate, runs first). Before invoking the produc` | changed: same faff-prep rule, concise wording |
| `Ratified tracker-resolution fold — human resolutions posted in the tra` | changed: same faff-prep rule, concise wording |
| `A design-lens objection has two paths today — loop the producer, or pa` | changed: same faff-prep rule, concise wording |
| `This is a bounded LLM classification, not a deterministic parser: ther` | changed: same faff-prep rule, concise wording |
| `The tag survives the loop, and an autonomous refresh, by carry-forward` | changed: same faff-prep rule, concise wording |
| `The clean-context review of a freshly drafted spec — dispatching a fre` | changed: same faff-prep rule, concise wording |
| `Both spec-producing flows invoke this subroutine at the point named in` | changed: same faff-prep rule, concise wording |
| `Both interactive resolution sites invoke this subroutine immediately a` | changed: same faff-prep rule, concise wording |
| `No Matches: field — a tradeoff is never fuzzy-matched (faff decisions ` | changed: same faff-prep rule, concise wording |
| `Sibling to the capture step above, closing the asymmetry with the ADR-` | changed: same faff-prep rule, concise wording |
| `During prep, the spec lives only on the issue tracker as a comment. No` | changed: same faff-prep rule, concise wording |
| `Before Step 1 of either scenario — and before any exploration narratio` | changed: same faff-prep rule, concise wording |
| `Do not include an acceptance-criteria count here — fresh prep hasn't e` | changed: same faff-prep rule, concise wording |
| `A narrow or proceed choice carries the findings section forward into t` | changed: same faff-prep rule, concise wording |
| `ADR promotion. After the spec is attached, run the ADR promotion step ` | changed: same faff-prep rule, concise wording |
| `Both autonomous paths, plus interactive Scenario A's Step 1c, invoke t` | changed: same faff-prep rule, concise wording |
| `The substantial / partial / not-at-all judgement is the prep agent's c` | changed: same faff-prep rule, concise wording |
| `Orthogonal to the existing confidence gate. This gate fires before the` | changed: same faff-prep rule, concise wording |
| `Self-verify before an attach-expecting return (the belt; the caller's ` | changed: same faff-prep rule, concise wording |
| `The L4 (lights-out) spec_review occupant runs each enabled lens as its` | changed: same faffter-dark-spec-review rule, concise wording |
| `It shares the code-stage adversarial reviewer's independent-model tran` | changed: same faffter-dark-spec-review rule, concise wording |
| `Independence is the mechanism. Run one pass per enabled lens — never a` | changed: same faffter-dark-spec-review rule, concise wording |
| `Dispatch the lenses via fan-out.mjs's resolved strategy, never a per-l` | changed: same faffter-dark-spec-review rule, concise wording |
| `Pin capture (after aggregation, EVERY round, unconditional). Once the ` | changed: same faffter-dark-spec-review rule, concise wording |
| `- No lens served (empty exit-0 set): writes no pin and no served-<n>.j` | changed: same faffter-dark-spec-review rule, concise wording |
| `- Wire shape. review-call.mjs puts the shared context+spec block in th` | changed: same faffter-dark-spec-review rule, concise wording |
| `A fan-out.mjs fault (non-zero exit — an empty/malformed --requests, or` | changed: same faffter-dark-spec-review rule, concise wording |
| `Parsing an exit-0 lens (deterministic, not prose). A refuter's exit-0 ` | changed: same faffter-dark-spec-review rule, concise wording |
| `The parser is self-contained (plugin/skills/faffter-dark-spec-review/p` | changed: same faffter-dark-spec-review rule, concise wording |
| `Also append each served lens's LensResult.stderr to that same round-<n` | changed: same faffter-dark-spec-review rule, concise wording |
| `Collect the per-lens refutations into one JSON array and pipe it to th` | changed: same faffter-dark-spec-review rule, concise wording |
| `model may be sourced from the transport-prepended header, not reconstr` | changed: same faffter-dark-spec-review rule, concise wording |
