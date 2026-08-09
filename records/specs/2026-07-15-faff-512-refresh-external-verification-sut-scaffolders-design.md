# FAFF-512 — Refresh external-verification SUT scaffolders (P2/P4 leash-authoring broken vs current CLI)

> Spec: faffter-dark-nlspec · 2026-07-15 · interactive · confidence: high. Full spec on Linear FAFF-512.

## WHY

The five external-verification scaffolders in `verification/external-verification/scaffold-p{1..5}-*.sh` stand up throwaway SUT repos that faff is pointed *at* — the only miles the un-dogfoodable architecture→env→evaluate lanes ever get. Two of them (**P2** = `scaffold-p2-task-api.sh`, **P4** = `scaffold-p4-stripe-testmode.sh`) write RUNBOOKs whose PRD-leash-authoring steps **error on the current CLI**, so the acceptance run stalls at step 2 before any behaviour is instrumented. Concretely, both RUNBOOKs tell the operator to run:

- `faff prd new --from PRD.md` — three ways wrong: `new` requires a `<container>` slug positional (`prd.js:172`), there is **no `--from` flag**, and it scaffolds a *fresh template* into `docs/prd/<slug>.md` rather than ingesting the SUT's hand-authored root `PRD.md`. Worse, the whole `faff prd` verb family operates on the `docs/prd/` namespace (`prd.js:141` `prdDir(root)`), so it can never see a root-level `PRD.md` at all.
- `faff prd admit` — **no `admit` subcommand exists** on `prd`. Real verbs: `path | new | link | list | validate [--strict]` (`prd.js:194`).

A stalled leash-authoring step is a false negative that hides whatever the SUT was built to find (P2: the PRD/PRDR two-gate + agile formation; P4: the B7 safety floor). This is dogfooding-infra drift: the CLI moved, the scaffolders did not.

Secondary decay (non-blocking, same root cause):
- **All five** call `faff hooks-ensure` but not `faff gitignore-ensure`; the gateway first-run flow now runs **both** (`SKILL.md:79`), so scaffolded SUTs never auto-gitignore `.faff/`.
- P2 RUNBOOK's `prdr coverage` line (`scaffold-p2-task-api.sh:129`) omits `--prd-goals`; the flag is parser-optional but **semantically load-bearing** — absent, `prdr coverage` defaults `prdGoals=[]` (`prdr.js:256-261`) and reports a vacuously-covered empty goal set, silently no-op'ing the lower gate the step exists to demonstrate.
- P1/P3 (`scaffold-p1-*.sh:113`, `scaffold-p3-*.sh:94`) doc-comment `faff holdout verdicts --association` as an eval "against the RUNNING env" — overstated. It is a **pure trust-gated bridge** reading persisted `.faff/holdout/<key>.json` into `prdr coverage --dod-verdicts` (`admissibility.js:797-798`); the `evaluator` slot already produced that verdict.
- P1 rc-comment (`scaffold-p1-*.sh:43`) and README (`README.md:49`) frame `max_attempts` as the "predictable cap" and `tokens` as a "runaway backstop". For L4 lights-out the budget-ceiling gate **deliberately excludes `max_attempts`** — "a count is not an L4 governor" — and wants `budget.cost` / `tokens` / `until` (`lights-out.js:357`, `:520`). `budget.cost` (FAFF-427) is the recommended L4 governor; no scaffold sets it.

## OUT OF SCOPE

- **Changing any CLI behaviour.** This refreshes the *scaffolders and their docs* to match the shipped CLI; it does not add a `prd new --from`, resurrect `prd admit`, or alter `prdr coverage` semantics. Anything wanting a CLI change goes back through `/faff-jot`.
- **Editing the SUTs' `PRD.md` / `BRIEF.md` product content** — deliberate test fixture, stays byte-stable except command examples inside a RUNBOOK.
- **P5 scaffolder, `README.md` structure, the design brief** — current; only the README's one `max_attempts` sentence (`:49`) is touched.
- **`.faffrc.yaml` schema changes** — valid across all five; we may *add* a commented `budget.cost` example but remove nothing.
- **Building the RUNBOOK-command CLI-surface linter** — a design is proposed (Punt-1) but it's its own ticket.

## WHAT

1. **P2 + P4 RUNBOOKs author+admit the PRD via a path that works on today's CLI** — the two invalid `faff prd new --from` / `faff prd admit` lines removed and replaced by the canonical current path, correct for each SUT's level (P2 = L4 lights-out `--converge`; P4 = interactive L2-L3).
2. **One canonical "how to author + admit a PRD leash" doc** under `verification/external-verification/`, referenced by both RUNBOOKs instead of inlining commands — so the next CLI drift is a one-file fix.
3. **All five scaffolders call `faff gitignore-ensure`** alongside `faff hooks-ensure`, in the gateway order (`gitignore-ensure` then `hooks-ensure`).
4. **P2's `prdr coverage` line carries `--prd-goals`** (P1's example likewise), so the lower gate is non-vacuous.
5. **P1/P3 `holdout verdicts` doc-comment reframed** as a pure bridge from persisted evaluator verdicts.
6. **P1 rc-comment + README `max_attempts` framing corrected** to name `budget.cost` / `tokens` / `until` as the L4 governor and `max_attempts` as an optional extra backstop only.
7. **A decision recorded** on whether a lint should assert RUNBOOK commands stay valid against the CLI surface.

## HOW

### The canonical current PRD-leash path (the fix's spine)

The SUTs keep a **hand-authored root `PRD.md`** as the human setpoint. That file is **not** a `faff prd` record (those live under `docs/prd/`). The correct admission mechanism for a setpoint *file* is the **`prd` slot → `faff-contract:prd-readiness` contract**, which takes a PRD file *path*:

- **L4 (lights-out / beep-boop) SUTs — P2.** Admission is **automatic at run-start**: faff-beep-boop step 0a resolves the PRD path, invokes the `prd` slot (faffter-noon-prd) → one `faff-contract:prd-readiness` block → pipes it to `faff contract prd-readiness` (`contract-defs.js:342`), and **refuses the run** on `not-ready`. So P2 needs **no manual authoring verb** — the RUNBOOK keeps `PRD.md` and notes the run-start gate admits/refuses it. This *is* the "admit REJECTS a PRD with no machine-checkable stop conditions" behaviour the old step claimed.
- **Interactive L2-L3 SUTs — P4.** The L4 run-start gate does not fire interactively. Drop the two invalid verbs; for an explicit admissibility check the operator invokes the `prd` slot manually and pipes its block to `faff contract prd-readiness` (same contract, by hand), OR — if a PRDR *record* is wanted — `faff prdr admit <prdr> --actor human|loop` (`prdr.js:180-185`). Otherwise the PRD's Stop-conditions stand as the read leash (P4's actual signal is B7, not the gate).

### Create the canonical doc

New `verification/external-verification/authoring-and-admitting-a-prd.md` (~1 screen): states the two bullets above, the exact current verb surface (`faff prd path|new|link|list|validate`; `faff prdr … admit|coverage|yagni`; the `prd-readiness` contract), and an explicit "what NOT to run (removed/never-existed): `prd new --from`, `prd admit`". P2+P4 RUNBOOK step-2 sections shrink to a one-line pointer plus the SUT-specific note (L4 auto-gate vs interactive).

### Per-file edits

- **`scaffold-p2-task-api.sh`** — replace the RUNBOOK `## 2.` block (~lines 118-121) with the canonical-doc pointer + "the L4 run-start prd-readiness gate admits/refuses `PRD.md`; a refusal means the stop-conditions weren't machine-checkable — a real finding". Add `--prd-goals '<JSON array of the PRD's In-scope goals>'` to line 129's `prdr coverage`.
- **`scaffold-p4-stripe-testmode.sh`** — replace the RUNBOOK `## 1.` block (~lines 106-109) with the canonical-doc pointer + the interactive note (no auto-gate; optional manual `prd`-slot → `faff contract prd-readiness` check).
- **All five scaffolders** — add a `"$faff" gitignore-ensure` call **before** `hooks-ensure`, same degrade-not-fail idiom.
- **`scaffold-p1-link-shortener.sh`** — fix the `max_attempts` rc-comment (`:43`), reframe the `holdout verdicts` comment (`:113`), add `--prd-goals` to the `prdr coverage` example (`:114`).
- **`scaffold-p3-landing-page.sh`** — reframe the `holdout verdicts` comment (`:94`).
- **`README.md`** — rewrite the second half of the "Token ceilings" bullet (`:49`): `budget.cost` (dollars, FAFF-427) / `tokens` / `until` are the L4 governors; `max_attempts` is a count *excluded* from the L4 ceiling gate, kept only as an optional extra backstop. Add one "How to run" line noting scaffolders now run `gitignore-ensure` + `hooks-ensure`.
- **Optional, additive** — a commented `# budget: cost: <dollars>  # FAFF-427 recommended L4 governor` line in the P1/P2 `.faffrc.yaml` here-docs so at least one scaffold demonstrates it. Additive only.

## Scenarios

- **S1 — P2 leash step no longer errors.** `grep -nE 'prd new --from|faff prd admit' verification/external-verification/scaffold-p2-task-api.sh` → nothing.
- **S2 — P4 leash step no longer errors.** Same for `scaffold-p4-stripe-testmode.sh`.
- **S3 — coverage gate non-vacuous.** Every `prdr coverage` line in P1+P2 files contains `--prd-goals`.
- **S4 — SUTs auto-gitignore `.faff/`.** `grep -c gitignore-ensure` ≥ 1 for each of the five `scaffold-p*.sh` (before `hooks-ensure`).
- **S5 — holdout comment honest.** Neither P1/P3 comment contains "against the running env"; both name the persisted-verdict bridge.
- **S6 — budget framing matches the L4 gate.** `grep -n 'predictable cap' scaffold-p1-… README.md` → nothing; both mention `budget.cost` or `tokens`/`until`.
- **S7 — single source of truth.** `authoring-and-admitting-a-prd.md` exists; both P2+P4 RUNBOOK here-docs contain its basename.
- **S8 — no regression in clean files.** `grep -rn 'price_per_mtok' verification/external-verification/` → nothing; P5 diff limited to the `gitignore-ensure` line.

## Design Decision Rationale

- **Chosen:** Author admission via the **`prd`-slot → `faff-contract:prd-readiness`** path, not a `faff prd` record — the SUTs' root `PRD.md` is a setpoint *file*; the `faff prd` verbs manage the `docs/prd/` record namespace and structurally can't see a root file. prd-readiness is what actually gates L4 run-start.
- **Chosen:** **P2 keeps no manual authoring verb** — its run uses `/faff-beep-boop --converge` (L4), where step 0a admits/refuses `PRD.md` automatically; a manual verb would duplicate the gate and re-introduce drift surface. P4 (interactive) gets an *optional* manual check because its auto-gate never fires.
- **Chosen:** **One canonical doc, RUNBOOKs point at it** — the ticket's own diagnosis (recurring drift) is best answered by de-duplicating the leash prose to a single home (mirrors the skill-authoring "one home, reference it" standard).
- **Chosen:** **`gitignore-ensure` before `hooks-ensure`**, matching the gateway order (`SKILL.md:79`) and `faff-onboard` step 5, using the scripts' existing degrade-not-fail `"$faff"` resolution.
- **Chosen:** **Add `--prd-goals`, keep it explicit** — the flag is parser-optional but omitting it silently voids the gate; an explicit JSON goal list makes demonstrated coverage real.
- **Assumes:** The `prd`-slot occupant (faffter-noon-prd) and the `prd-readiness` contract are stable for the SUTs' lifespan (true today, `contract-defs.js:342`). *Fallback:* the canonical doc is the single edit point if the slot/contract name moves.
- **Assumes:** P4's operator wants at most a *lightweight* interactive admissibility check, not the full PRDR two-gate. *Fallback:* the canonical doc mentions `faff prdr admit <prdr> --actor human` for anyone who does.
- **Punt (decides: human):** Add a **CLI-surface lint** — extend `faff validate-adapters` (or a new `faff doc-lint`) to scan `verification/external-verification/**` fenced/indented `faff <verb>` tokens and fail if a verb isn't in the live dispatch tables. High leverage (this is the third+ drift), non-trivial (tokenising shell here-docs), own ticket. This spec ships the doc-dedup that makes such a lint cheap later.
- **Punt (decides: human):** Whether every SUT `.faffrc.yaml` should *default* to a `budget.cost` L4 governor — this spec only adds a *commented* example; making it the default touches the acceptance-run cost profile (a product call).

## Open Questions & Assumptions

- **OQ1 — Does P2 ever create PRDR *records*?** `prdr coverage` (absent `--live-prdrs`) reads live PRDRs from `docs/prdr/`; if the SUT never runs `faff prdr new`, coverage sees an empty PRDR set even with `--prd-goals`. Adding `--prd-goals` fixes the *goal* half; whether the RUNBOOK should also seed PRDRs is deeper. **Assumption for this ticket:** scope is command-validity + non-vacuous goals; PRDR-record seeding is noted, not required for DONE.
- **OQ2 — Canonical doc vs README section?** Chosen a standalone file; a reviewer may prefer a README `## Authoring the leash` section. Either satisfies "one home".
- **Assumption:** No automated harness executes these scaffolders in CI today (run-by-hand test infra), so DONE is asserted by grep/tree checks. If a CI runner exists, S1-S2 should also assert a dry-run exit 0.

## DONE

1. `grep -rnE 'prd new --from|faff prd admit' verification/external-verification/` → **no matches**.
2. For each `scaffold-p{1,2,3,4,5}-*.sh`: `grep -c 'gitignore-ensure'` → **≥ 1**.
3. Every `prdr coverage` line in `scaffold-p1-*.sh` and `scaffold-p2-*.sh` also contains `--prd-goals`.
4. `grep -n 'against the running env' scaffold-p1-… scaffold-p3-…` → **no matches**; both reference the persisted `.faff/holdout/` bridge.
5. `grep -n 'predictable cap' scaffold-p1-… README.md` → **no matches**; both name `budget.cost` and/or `tokens`/`until`.
6. `verification/external-verification/authoring-and-admitting-a-prd.md` **exists**; P2 + P4 scaffolders each contain its basename.
7. `grep -rn 'price_per_mtok' verification/external-verification/` → **no matches**; P5 diff limited to the added `gitignore-ensure` line.
8. Every touched `.sh` passes `bash -n`; every `.faffrc.yaml` here-doc still parses as YAML.
9. The drift-guard decision is recorded as a Punt with a named owner (satisfied here; no code required this ticket).

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "punt" }, { "marker": "punt" } ] }
```
