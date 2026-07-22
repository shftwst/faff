# L4 capabilities audit — 2026-07-20

**The question this audit answers.** faff's README stakes the whole pitch on a four-rung ladder, and the top rung — **L4, "out of the loop"** — is the one that has to be *trusted*, because by definition no human is watching when it runs. This audit asks three things of that rung: what is genuinely built and mechanically enforced, where does the documentation claim more enforcement than the code delivers, and is there any evidence the factory works on a repo that isn't faff's own. It also steps back and asks whether the whole thing is useful to anyone but its author.

**Method.** Three independent readers held different slices of the system in parallel — one mapped the shipped machinery in the CLI (`plugin/skills/faff/bin/`, ~30.7k lines across 67 modules) and its CI gates; one read the L4 guide pages, all L4-relevant ADRs (0034–0080), the five RFCs, the governance-landscape report, and the entire external-verification tree; one digested the live Linear roadmap (initiatives, projects, the full ~114-issue open set). Their findings were then reconciled against each other and against direct probes of the live forge and the external subject-under-test (SUT) repositories. Every load-bearing claim below is backed by a file, a ticket, a commit, or a run artifact.

**A correction round is part of this record.** A first draft of this audit made two factual errors, both caught by the repo owner and both instructive enough to keep on the page rather than quietly fix:

1. It reported `main` as **unprotected** because the legacy `branches/main/protection` API returns 404. In fact branch protection is enforced through the newer **repository rulesets** API: an active "Main" ruleset requires the `validate` status check, blocks deletion and non-fast-forward, requires linear history, and requires a squash-merge PR. The 404 was the audit using a stale endpoint — the same class of mistake faff's own `branch-protection-check` was taught to avoid in FAFF-503 ("probes the effective-rules API so it sees GitHub rulesets"), merged eleven days before this audit ran.
2. It reported two urgent gate-integrity bugs as **unfixed** because the tracker said so. The fixes were already merged on `main` under different ticket numbers. The audit had trusted the control plane (the tracker) over ground truth (the code) — which is exactly the failure mode a "tracker as the single source of truth" design cannot afford, and which became a filed finding in its own right (see §5, FAFF-569).

Both corrections *strengthen* faff's position, and both are recorded here because an audit that hides its own misfires is worth less than one that shows them.

---

## 1. What is genuinely shipped and mechanically enforced

This is a stronger column than the documentation's own hedging implies. Every core L4 verb exists, carries a `--selftest`, and is gated in CI — and a governance-region module that lacks a selftest is a **fatal** CI error, not a warning (`faff regions selftest --region governance`, `.github/workflows/validate.yml`).

- **`faff lights-out`** (`bin/lib/lights-out.js`, ~1,700 lines) — the fail-closed preflight. It probes all **8 guardrail contracts** (container isolation, admissibility, spec-review, terminating predicate, budget ceiling, observability, kill-switch, holdout) by running each one's genuine `--selftest`, not by checking config presence. Any guardrail not in a `live` state is a refusal — "no reduced mode." On pass it mints a strict-defaults L4 run-ledger stamping `level:"L4"` (the one fact the rest of the pipeline keys off) and a one-to-one trust banner; on any miss it refuses and emits nothing.
- **Budget governor** (`bin/lib/budget.js`) — measurable, not merely configured (ADR-0060). Per-model × per-class pricing; an unknown model prices at the costliest known row, so a pricing gap can only *over*count, never undercount. The preflight refuses to mint unless a token-dependent ceiling's meter actually resolves real transcripts. Budget breach is a terminating floor at **every** level, not L4-only.
- **`faff sentry`** (`bin/lib/sentry.js`) — the kill-switch, with the `continue → pause → correct → abort` ladder; `abort` is resumable by construction (commits in-flight WIP, never force-resets). Member-scoped supervision (park one fleet member, run continues) is shipped; the `correct` rung is built but dormant everywhere real (see §2).
- **Holdout evaluator** — the code-blind judge. `holdout-verdict` passes only when `code_blind:true`, every prose criterion is forced to `needs-human`, and the aggregate matches its derivation; an out-of-enum aggregate coerces to `needs-human`, never `meets-spec`. The spawner path (`evaluate-call.mjs`, `lane-boundary.json`, `--require-spawner-attested`) closes the lying-evaluator hole *when a cage promise resolves*.
- **`faff reconcile`** (ADR-0056), **`faff disposition`** (a parked run exits non-zero instead of green-by-silence), **`faff merge-gate`** (the sole sanctioned merge path; re-reads the holdout verdict fail-closed), **heartbeat/runcheck** (dedicated per-issue heartbeat file, ADR-0055), and **corrective-integrity** (`bin/lib/corrective-integrity.js`, pid-1-sourced boundary, no forgeable crypto) all exist and pass.
- **Build-lane tamper evidence** — `bin/lib/integrity-digest.js` snapshots `events.jsonl` as an append-only length + prefix-hash, digests integrity dirs per-leaf, calls `/usr/bin/sha256sum` by **absolute path** so a same-uid lane cannot PATH-shadow it, and fails loud rather than reporting unverifiable-as-verified. The concurrency executors bracket every graft dispatch with it (FAFF-520, ADR-0077/0078).
- **`governance-check`** — a real, harness-independent composite GitHub Action (`.github/actions/governance-check/action.yml`) plus the CLI verb (`bin/lib/governance-check.js`). It discovers carried run dirs from the PR's own diff (never "newest dir"), re-validates the merge-floor artifacts, and propagates its exit code. Its own description is honest: "Emitting the artifact format is NOT the same as being governed until this check is marked required."

The dormant pieces are dormant **by explicit design**, not neglect: multi-cage isolation (ADR-0041 confirms one cage at v1), the sentry `correct` rung, and the adversarial advisory→gating promotion are all named follow-ons in the code and ADRs.

## 2. The four seams where the claim exceeds the enforcement

1. **The merge chokepoint is not yet binding.** The active "Main" ruleset requires `validate` but **not** the `governance-check` job (which still runs `on-missing: pass`). So the harness-independent enforcement story — which `governance-check.md`, both enforcement RFCs, and the governance-landscape report all describe as one ruleset edit away — is real machinery that is not yet load-bearing at the forge. *(This is the corrected version of the audit's first error: the chokepoint exists and is one config change from binding, not absent.)* → **FAFF-562**.
2. **Evaluator code-blindness is attested, not physically enforced, until the cage proof runs.** The spawner path closes the lying-evaluator hole when a cage promise resolves, but `architecture.md` admits the evaluator-preflight isn't wired into live dispatch, and ADR-0041 records that "every L4 holdout verdict rests on attested (not enforced) code-blindness." The cage acceptance run in anger (FAFF-381) has never executed.
3. **Sentry's "un-subvertable by construction" was retracted by its own amendment.** ADR-0034's FAFF-324 amendment demonstrates all four trip predicates forgeable by a same-uid build lane (eight hermetic probes). The `correct` rung is unreachable everywhere real because no launcher can truthfully declare `FAFF_INTEGRITY_BOUNDARY` — the read-only mount that would make it real is FAFF-517, deferred to the process-isolation era. Live validation of the corrective channel (FAFF-328) is genuinely in progress.
4. **Tamper-evidence is half-landed.** The digest-custody bracket (detect mutation during a dispatch window) shipped. The other half — the per-line hash-chained `events.jsonl` with a git-anchored head and an `integrity` leg in governance-check — is written as an RFC but not built; `events.js` validates sequence contiguity only. Until it lands, governance-check validates *conformance*, not *authenticity*: a forged clean ledger reads as real. The governance-landscape report identifies this as the one governance property nobody surveyed — faff included — has shipped. → **FAFF-564 / FAFF-568**.

The documentation compounds seams 2 and 3 by narrating attested guarantees as enforced ones in roughly five places — including one (`unattended.md`'s corrective-integrity framing) that ADR-0073 flags as a doc bug against itself. For a trust product, docs that overstate enforcement are their own defect class. → **FAFF-570**.

## 3. Empirical evidence — the external SUT runs

The single biggest gap this audit set out to test was whether faff works on a repo that isn't its own. As of the start of the session the honest answer was "no data — only apparatus." That is now **partly false**: two external subject-under-test repositories carry real, recent faff runs. Their `.faff/` evidence lives in the SUT repos themselves and **has not yet been copied back into faff as committed audit evidence** — that copy-over is outstanding work, and there are further SUT runs in the `shftwst/faff-suts-p<n>*` repositories not yet reflected here at all.

*(Scope note, per the repo owner: the `shftwst/faff-lab-experiments-*-one-shot` repositories are **frontier controls** — single-shot builds by Fable 5 at high effort, deliberately not built by faff, kept for a future head-to-head. The faff counterparts of those experiments have not been run yet, so there is no faff-vs-frontier comparison data in this audit — only the two SUT runs below.)*

**P1 — `faff-suts-p1-link-shortener` (interactive, git-only, clean).** A production-shaped URL shortener built through one interactive session: `/faff-jot`, then four `/faff-prep` → `/faff-graft` cycles. Outcome: 4 tickets shipped, 13 commits on `main`, 41 tracked source files, 7 ADRs, 4 design specs, two runnable end-to-end proofs including persistence-across-restart. No findings log — a clean pass. Its `ECONOMICS.md` is admirably honest about what interactive mode cannot measure (no run-ledger, so no exact dollar figure), but tallies **~1.05M metered subagent tokens across 20 dispatches**, dominated by the nlspec producers and adversarial reviews. This is the "planning exoskeleton" half of faff working end-to-end on a real greenfield brief.

**P2 — `faff-suts-p2-task-api` (autonomous, git-only, L3, `--converge`).** The more valuable run, because it is the apparatus doing its job: a `/faff-beep-boop --converge` drain that shipped two epics *and surfaced five first-class defects in faff itself* (`.faff/logs/2026-07-18/225751-beep-boop-findings.md`). Three were major:

| # | Finding | Severity | Now fixed on `main`? |
|---|---|---|---|
| F1 | git-only local merge desyncs the primary worktree (staged deletions; setpoint-clobber risk) | major | ✅ FAFF-545 |
| F2 | git-only orchestrator can't auto-derive `queue_empty`/`prd_satisfied` to feed `run-done` | major | ✅ FAFF-556/557/559 |
| F3 | budget over-counts across a compacted session, false-tripping a **real** 80M ceiling → spurious `budget-escalated` floor | **major (sharpest)** | ✅ FAFF-558/560 |
| F4 | sentry `wall-clock-runaway` false-trips on heartbeat staleness (+ silent `--run` no-op) | minor | ⏳ FAFF-553 open |
| F5 | run-ledger `outcomes` rejects rich per-issue objects | minor | ⏳ FAFF-554 open |

Two things about P2 are worth stating plainly. First, **the findings log is self-correcting** — it carries a "Correction note" retracting two overstated claims from its own first draft (it had wrongly blamed the budget `escalate` on an "L4 mint default" when it is configured in `.faffrc.yaml`, and wrongly said `run-done` "can't converge a git-only run" when the real gap is the orchestrator's signal-assembly). That is the discipline you want from an autonomous run's output. Second, **F3 is the sharpest possible advertisement for why the apparatus exists**: a compaction artifact manufactured a contract-terminating budget floor that an unattended run would have obeyed, halting a healthy convergence one epic short. Continuing was only correct because a human recognised the artifact — and the fix (baseline survives compaction, owning-session attribution) is now merged. The run found the bug that would have made the run untrustworthy, and it got fixed.

The takeaway: the empirical column is no longer empty, but it is thin and first-party. Two SUT repos, one clean interactive run and one autonomous run that found five real bugs. No frontier comparison yet. The proofs that would let faff *drop the "preview" label on L4* — cage acceptance in anger (FAFF-381), greenfield end-to-end unattended (FAFF-310), a fresh frontier adversarial re-audit coming back clean (FAFF-435) — remain unrun.

## 4. What it takes to get over the finish line

The T5 "proven in anger" project already defines the finish line correctly; nothing needs redefining. In dependency order:

1. **Tonight-class:** flip governance-check to required in the "Main" ruleset (FAFF-562); copy the P1/P2 run evidence back into faff so the empirical claims are committed, not remote; close the two remaining P2 findings (FAFF-553, FAFF-554).
2. **Finish the stalled supervision/attestation residue:** live corrective validation (FAFF-328, in progress), the live-lane holdout adapter (FAFF-474), watchdog→andon wiring (FAFF-472), and the andon light itself (FAFF-386) — a factory whose 3am death waits silently until morning is unattended, not lights-out.
3. **Land tamper-evidence:** the RFC is written and sequenced (FAFF-564 → FAFF-568); it is the cheapest remaining differentiator and gates the governance-landscape claims.
4. **Run the three proofs** (FAFF-381, FAFF-310, FAFF-435) and at least one faff-vs-frontier lab pair, so there is committed head-to-head data.
5. **Defer the horizontal expansions** (harness-independence, the capability/role config DSL) until after the proofs — they are all pre-start and compete for the same attention.

## 5. Roadmap gaps this audit surfaced (now ticketed)

Six gaps had no ticket and were filed via `/faff-jot` at the end of the session (eight tickets, after two methodology-directed splits). Deliberately **not** re-filed: the andon light, the three proofs, auto-revert/recovery, and the adoption-wedge demo, which already exist.

- **FAFF-565** — close out the three P2 findings still showing open while their fixes are merged (the immediate tracker-hygiene fix).
- **FAFF-569** — the durable version: nothing reconciles finding-tickets against fixes shipped later under different IDs, and *this audit was misled by exactly that*. A tidy diagnostic or `faff reconcile` extension keyed on fix-PR references to findings-log paths would stop a stale-Urgent ticket poisoning every wtf/map/next read.
- **FAFF-562** — make governance-check the forge-required check.
- **FAFF-564 → FAFF-568** — the two halves of events.jsonl tamper-evidence (the one hard dependency edge in the set).
- **FAFF-563** — seeded-defect calibration of the holdout evaluator. Nobody tests the judge: its plumbing is contract-coerced but its *sensitivity* is unmeasured. Hand it N implementations with known injected violations plus N clean ones and measure the false-pass/false-fail rate. Until then, "adversarial review + isolated holdout" is a mechanism of unknown sensitivity — the thing you'd never accept from a human QA process.
- **FAFF-566** — an injection-to-merge adversarial exercise. The untrusted-input defense work completed 2026-06-12, before merge-gate, sentry-2, and the holdout phase existed; at L4 the loop reads untrusted repo/tracker/spec content while holding merge authority, and no red-team pass covers injection *through* the gates (distinct from FAFF-435's gate-subversion scope).
- **FAFF-570** — the docs truth pass on enforcement claims (§2).

## 6. Is this useful to anyone but its author?

**The ideas, demonstrably yes; the product today, a narrow slice — and the wedge is already in the roadmap, unprioritised.**

The differentiation is real and self-assessed with unusual rigour: the governance-landscape report scored eleven OSS and commercial coding agents against five properties and found none combining three; code-blind holdout evaluation of a *delivered* PR was "not found anywhere, commercial or academic." The ADR corpus — write-abstention, fail-closed preflight, "measurable not merely configured," the honest-REFUSE integrity posture — is publishable thinking on its own terms. And the P2 run is a genuine proof point: pointed at a non-faff repo, the harness found five real defects in itself, corrected its own overstated write-up, and shipped the fixes.

The case that adoption is still narrow, with specifics: it currently needs Claude Code **and** Linear **and** GitHub together (the gitlab/gitea merge-gate is a documented "config theater" gap for other forges, FAFF-430); the conceptual surface is 30 skills behind a 1,015-line gateway; the release pipeline doesn't version prose changes (FAFF-174); the docs are raw in-repo markdown (Docusaurus site is FAFF-508); and the public signal a month after open-sourcing is 2 stars, 0 forks, and no external user anywhere in 114 open issues. There is also a positioning mismatch worth naming: the README sells "lazy devs who hate project management," but what has actually been built is the most governance-dense solo-authored delivery system I've reviewed — the honest audience is platform and regulated-delivery teams, and the anti-PM framing may be hiding the product from the people who would pay for it.

The adoptable-today product is **L3 + the governance layer**, not the L4 factory. The wedge that would make it useful to others — L3 for a Claude Code + Linear team, the governance-check binding on any agent's output (FAFF-360's non-faff-repo demo is, per its own ticket, "the strongest public demo the layer can have"), and published lab results however they land — is entirely present in the backlog and entirely unprioritised against the L4-correctness ladder.

**Bottom line.** The finish line is closer than the open-issue count suggests: one ruleset edit, one RFC, four stalled tickets, the two remaining P2 findings, three proof runs, and the evidence copy-over. What stands between faff and "serious, trusted, lights-out" is not more machinery — it is the proofs, the judge-calibration nobody has scheduled, and the discipline to run the experiment apparatus that already exists and to trust its ground truth over the tracker.

---

## Appendix A — tickets filed from this audit

| Ticket | Title | Home |
|---|---|---|
| FAFF-565 | Close out the three finding tickets whose fixes have already merged | Backlog |
| FAFF-562 | Make governance-check required to merge on main | Backlog |
| FAFF-563 | Measure the holdout evaluator's error rates with seeded defects | T5 — proven in anger |
| FAFF-564 | Add a tamper-evident hash chain to events.jsonl | Graft evidence is tamper-evident |
| FAFF-568 | Anchor and verify the events.jsonl hash chain in governance-check | Graft evidence is tamper-evident |
| FAFF-566 | Probe whether injected repo or tracker content can reach a merge | T5 — proven in anger |
| FAFF-569 | Catch finding tickets left open after their fixes merge elsewhere | Backlog |
| FAFF-570 | Bring the docs' enforcement claims in line with shipped behaviour | Documentation is up to date |

Hard dependency: FAFF-564 blocks FAFF-568 (the RFC's own sequencing). All other cross-links are related-only, so no ticket can hold another hostage.

## Appendix B — evidence index

- **Code:** `plugin/skills/faff/bin/lib/{lights-out,budget,sentry,reconcile,disposition,governance-check,corrective-integrity,integrity-digest,heartbeat,runcheck}.js`; `.github/actions/governance-check/action.yml`; `.github/workflows/{validate,governance}.yml`.
- **Forge:** `shftwst/faff` ruleset "Main" (active; requires `validate`, not yet `governance-check`).
- **Docs/decisions:** ADRs 0034–0080; `docs/rfc/rfc-governance-tamper-evidence.md`; `docs/reports/governance-landscape-2026-07.md`; `docs/guide/{unattended,architecture,governance-check,adopting-by-change-class}.md`.
- **SUT run evidence (external, not yet copied into faff):**
  - `shftwst/faff-suts-p1-link-shortener` — interactive git-only run; `.faff/` artifacts + `ECONOMICS.md` (~1.05M metered subagent tokens, clean).
  - `shftwst/faff-suts-p2-task-api` — `/faff-beep-boop --converge` L3 run; `.faff/logs/2026-07-18/225751-beep-boop-findings.md` (findings F1–F5, three major, all self-corrected; F1–F3 fixed on `main`).
  - Further `shftwst/faff-suts-p<n>*` runs exist and are not yet reflected here.
  - `shftwst/faff-lab-experiments-*-one-shot` — frontier (Fable 5, high-effort) single-shot controls, **not** faff-built; faff counterparts not yet run, so no head-to-head data exists.
- **Prior audits:** `docs/audits/2026-07-04-faff-323-whole-system-coherence.md`; `docs/audits/FAFF-114-skill-prompt-audit.md`.
