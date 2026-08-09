# Spec — FAFF-570: bring the L4 guide docs' enforcement claims in line with shipped behaviour

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high.

This spec is for the build agent (and human reviewers) applying a contained prose-honesty fix to two L4 guide pages, `docs/guide/unattended.md` and `docs/guide/architecture.md`. It touches wording only — no code, no CLI, no behaviour. Its central move is grounded in a grep + code-read that the ticket's own premise did not survive: of the five overclaims the ticket lists, only **two** are live in the named files today; the other three already match shipped behaviour there (or the overclaim lives in a third doc the ticket did not name). The spec makes the two real corrections and proves the other three are already honest, so "Done" is discharged by correction where a claim overstates and by verification where it already holds.

## 1. WHY — Problem and Principles

**The load-bearing model.** For a trust product, a reader calibrates *how far to trust an unattended run* off the exact wording of the L4 guide pages. So a doc that narrates an **attested** guarantee (real only while the agent complies) as a **mechanically enforced** one (a named artifact makes skipping impossible) is a defect of the same class as a code bug — it manufactures unearned trust. This spec corrects the places where `unattended.md`/`architecture.md` cross that line, in the same "mechanical vs attested" register the sibling gateway fix (FAFF-583) uses one screen up.

**Problem statement.** The 2026-07-20 L4 audit (§2) flagged that the guide docs "narrate attested guarantees as enforced ones in roughly five places." Re-grepping the two named files at HEAD, only two of those five are live overclaims; the rest are already honest in these files or live in an un-named third doc. Left unfixed, the two live overclaims tell an operator the evaluator is code-blind-by-construction and the integrity boundary is something they stand up per run — neither is true today.

**Design principles.**

- **Ground every correction in what the code actually enforces.** The honest framing must itself be accurate. Each edit below is anchored to a named module's own words: `evaluator-preflight.js` ("SHIP-NOT-WIRE … does NOT call it from the live holdout dispatch — today's evaluator is dispatched inline sharing the run cwd (it can see the repo)") and `corrective-integrity.js` ("faff's role is ASSERTION, not creation … the probe stays `asserted:false` forever — that is correct fail-safe behaviour"). Do not soften past what the code says, nor overstate the gap.
- **Correct where it overstates; verify where it already holds.** Three of the ticket's five bullets already match shipped behaviour in the named files. For those the deliverable is a stated verification (with the grep/code evidence), not a manufactured edit — editing already-honest prose would be churn and could regress it.
- **Minimal blast radius.** Wording only, confined to the L4 sections of these two files. Do not restyle, renumber, touch the lights-out banner, edit the gateway (FAFF-583's file), or edit the governance-layer explainer report (a third doc neither ticket names). The build agent locates each edit site by quoted text, not line number, in case the files drift.
- **Skimmability holds.** These are guide docs, not `SKILL.md` files, so `faff validate-adapters` does not lint them — but keep the house skimmable-prose style (lists over run-ons, no invented labels).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `docs/guide/unattended.md` (§ "The evaluator hard cage", ~lines 104–107; § "Going lights-out") | Markdown | Carries both live overclaims (evaluator cage present-tense; corrective-integrity operator-gesture). Primary fix site. |
| `docs/guide/architecture.md` (evaluator-lane paragraph, ~line 11) | Markdown | Partially honest already; still frames code-blindness as operational fact. Secondary fix site. |
| `plugin/skills/faff/bin/lib/evaluator-preflight.js` (header) | JavaScript | Ground truth for the evaluator-cage correction: "SHIP-NOT-WIRE", evaluator runs inline sharing run cwd. |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` (header) | JavaScript | Ground truth for the corrective-integrity correction: assertion-not-creation; fail-safe `asserted:false`. |
| `plugin/skills/faff/bin/lib/lights-out.js:13,328,375–392` | JavaScript | Confirms the "no reduced mode" bullet is already honest: all-or-nothing for the 8 guardrails, with the FAFF-525 corrective-integrity advisory degrade the docs already reflect. |
| `verification/audits/2026-07-20-l4-capabilities-audit.md` (§2, correction round) | Markdown | Source-of-truth for the attested-vs-enforced boundary; its own correction round is the evidence bullet 5 (account-tier) is a non-issue. |

**Scope statement.** A prose-honesty correction to the L4 guide pages, within the trust-maturity-labelling story FAFF-351 (Done) opened and FAFF-583 continues in the gateway.

## 2. OUT OF SCOPE

- **The gateway levels table/bullet** — Why excluded: FAFF-583 (prepped this same run) owns `plugin/skills/faff/SKILL.md`; different file, same framing, explicitly not merged. Extension point: FAFF-583.
- **The `docs/reports/governance-layer-explainer-2026-07.md` residual overclaims** — Why excluded: the absolute "no reduced mode" mermaid node (`:43`) and the `pause → correct → abort` sentry node narrate the same class of imprecision, but that report is a **third doc neither this ticket nor FAFF-583 names**, and widening into it breaks the minimal-blast-radius symmetry FAFF-583 set. Extension point: a peer follow-up ticket (recommended in §7) scoped to that report.
- **The lights-out banner and any change to what L4 *is*** — Why excluded: the maturity grade (holdout lane not yet run end-to-end) is unchanged; this is a wording fix, not a re-grade. Extension point: FAFF-351's guarantee-table framing / the holdout end-to-end run tickets (FAFF-381, FAFF-276).
- **Any code, CLI, or behaviour change** — Why excluded: the enforcement gaps themselves (FAFF-276 sandboxed code-blindness, FAFF-517 read-only mount, FAFF-562 required governance-check) are their own tickets; this ticket only makes the docs tell the truth about today's state. Extension point: those tickets.

## 3. WHAT — the per-claim disposition and exact corrections

**Vocabulary.**

| Term | Definition |
|---|---|
| **Mechanically enforced** | A named artifact (Stop-hook, `faff` CLI contract, CI/branch-protection gate, physical container boundary) makes skipping the guarantee impossible — the model cannot silently subvert it. |
| **Attested** | The guarantee is real only while the agent complies (or while a launch-time promise holds); no artifact physically prevents its violation today. |

**The five ticket bullets, each with its HEAD disposition:**

```
RECORD ClaimDisposition:
  bullet          # the ticket's named overclaim
  in_named_files  # is it a live overclaim in unattended.md / architecture.md at HEAD?
  action          # EDIT | VERIFY-ONLY
  ground_truth    # the code/audit anchor
```

- **(1) Sentry "un-subvertable by construction"** — `in_named_files: false`. `unattended.md` only says "Sentry watches for derailment with kill-switch authority" (no un-subvertability claim); the retracted phrase is ADR-0034's title. **Action: VERIFY-ONLY** — no such claim to correct in these files. (Ground truth: `sentry.js:9–12` — the `correct` rung is "reachable ONLY when the caller passes authority derived from corrective-integrity … today's real-world routing is unchanged"; the operational-`correct` narration lives in the explainer report, §2 out-of-scope.)
- **(2) Evaluator cage narrated as operational** — `in_named_files: true`. **Action: EDIT** both files. Ground truth: `evaluator-preflight.js` — SHIP-NOT-WIRE; the evaluator is dispatched inline sharing the run cwd and **can read the repo today**; code-blindness is attested, not enforced (audit §2.2, ADR-0041; the physical-enforcement follow-ons are FAFF-276 and the never-run cage acceptance FAFF-381).
- **(3) Corrective-integrity as an operator gesture** — `in_named_files: true`. **Action: EDIT** `unattended.md`. Ground truth: `corrective-integrity.js` — assertion-not-creation; with no outer-layer read-only mount the probe is `asserted:false` by design (an honest REFUSE / distrust-by-default). The mount that would let a launcher truthfully declare `FAFF_INTEGRITY_BOUNDARY` is FAFF-517, deferred; ADR-0073 flags this exact framing as a doc bug.
- **(4) "Fully armed or refuse — no reduced mode" vs degrade banners** — `in_named_files: false`. The phrase "no reduced mode" is not in these files; `unattended.md` already describes the `armed` `live/degraded/absent` map and "tells a fully-armed L4 run from a degraded one." **Action: VERIFY-ONLY.** Ground truth: `lights-out.js:13,328` — all-or-nothing for the 8 guardrails is real; `:375–392` (FAFF-525) degrades an absent integrity declaration to an advisory — exactly what the docs already reflect. (The absolute phrasing lives in the explainer report, §2 out-of-scope.)
- **(5) Stale T0 branch-protection "unavailable on this account tier"** — `in_named_files: false`, and not in `governance-check.md` either. **Action: VERIFY-ONLY.** Ground truth: the "account tier"/404 rationale was the **audit's own first-draft error** (audit §, correction round point 1 — rulesets protect `main`); the live docs already say the repo is ruleset-protected and the only gap is governance-check not yet required (FAFF-562). The stale rationale is already gone.

**The two edits, concretely.** Wording is illustrative; the build agent may tune phrasing so long as each corrected passage states the attested-not-enforced reality and stays skimmable.

**Edit A — `unattended.md`, the "evaluator hard cage" section (~lines 104–107).** Today it narrates the `evaluate-call.mjs` spawner / `lane-boundary.json` / `spawner_attested` path in the present tense, reading as if a physically code-blind evaluator gates every L4 merge now. Correct it to state the shipped reality: this cage path is **built but not yet wired into the live holdout dispatch** — today's evaluator is dispatched inline and shares the run working directory, so `code_blind: true` is an **attestation, not a physical fact**; the spawner/preflight machinery exists and is the intended enforcement, but the cage has not run in anger (FAFF-276 makes codebase-reading physically impossible; FAFF-381 is the acceptance run). Keep the description of *how the cage is designed to work* — just frame it as the not-yet-live target, prefaced by one plain sentence on today's attested state, rather than as current operation.

**Edit B — `unattended.md`, the corrective-integrity / `FAFF_INTEGRITY_BOUNDARY` bullet (~line 106).** Today it frames a human "stands the evaluator cage up and writes the launch-time attestation … which faff reads back via its integrity probe" as a per-run operational gesture. Correct it to: faff only ever **asserts** an outer-layer declaration it does not create; with no read-only integrity mount in place (FAFF-517, deferred), the boundary today is an **honest REFUSE** — the probe is `asserted:false` by design and the corrective channel stays dormant, so nothing an operator does per run "arms" it yet. State the `faff integrity-boundary` emitter as the forward-looking composition path for when the mount ships, not as a live per-run step.

**Edit C — `architecture.md`, evaluator-lane paragraph (~line 11).** It already hedges the preflight wiring ("built but not yet called from the live holdout dispatch") but still asserts "the code-blind holdout evaluator judges the work against a spec it never saw and its verdict gates the merge" as operational fact. Add the one missing point: code-blindness itself is **attested** — the evaluator currently runs inline and can read the repo — so "a spec it never saw" is a compliance property today, not a physically enforced one (FAFF-276/FAFF-381 pending). One clause, not a rewrite.

**Design decisions.**

- **Correct two, verify three — or force five edits?** Options: (a) edit all five bullets to satisfy the ticket's literal list — rejected: three of the five have no overclaiming text in the named files, so "editing" them means either inventing a caveat onto already-honest prose (churn, regression risk) or hunting for text that isn't there; (b) correct the two live overclaims and record the other three as verified-already-honest with evidence. **Chosen:** (b) — the ticket's Done is "each claim either matches shipped behaviour or plainly states the attested reality," which three bullets already satisfy; proving that with grep/code is the honest discharge, and it is what a reviewer comparing the ticket to HEAD would themselves conclude.
- **Widen to the governance-layer explainer report?** The absolute "no reduced mode" and operational-`correct` narrations genuinely live there. Options: (a) sweep it too — the ticket's own principle (overclaim is a defect class) arguably reaches any trust doc; (b) keep to the two named files and recommend a peer ticket. **Chosen:** (b) — FAFF-583 set the minimal-blast-radius / named-files-only precedent one screen up and explicitly ceded only `docs/guide/*` to this ticket; the explainer report is a third doc owned by neither, so the symmetric move is a peer follow-up, not silent scope-creep into a trust doc mid-run.

## 4. HOW — Behavior

There is no runtime behaviour; the "procedure" is the edit set.

```
PROCEDURE apply_fix():
  1. In docs/guide/unattended.md:
     a. Locate the "evaluator hard cage" section by its heading text.
        Reframe the spawner/lane-boundary narration as built-but-not-live:
        prepend one sentence on today's attested code-blindness (evaluator
        dispatched inline, shares run cwd, can read the repo), then present
        the cage machinery as the intended-enforcement target (FAFF-276/381),
        not current operation.
     b. Locate the FAFF_INTEGRITY_BOUNDARY / "who launches the cage" bullet.
        Reframe as assertion-not-creation + honest-REFUSE today (mount is
        FAFF-517, deferred; probe asserted:false by design); keep
        `faff integrity-boundary` as the forward composition path.
  2. In docs/guide/architecture.md:
     c. Locate the evaluator-lane paragraph. Add one clause making
        code-blindness explicitly attested (evaluator runs inline / can read
        the repo today), keeping the existing preflight-wiring hedge.
  3. Leave every other passage — the three verified-honest claims, the
     lights-out banner, the gateway, the explainer report — untouched.
  4. Re-read each edited passage against its named module to confirm the
     honest framing matches the code (no new overclaim, no understatement).
```

**Anti-pattern:** rewriting the already-honest passages (the `armed` live/degraded/absent map, the ruleset/branch-protection framing, the sentry kill-switch line) to "address" bullets 1/4/5. Why: they already match shipped behaviour; touching them is churn that risks regressing correct prose and widens the diff past what review can cheaply verify.

**Anti-pattern:** deleting the cage/spawner design description entirely because it is not yet live. Why: the machinery is real and is the intended enforcement path; the fix is to frame it as not-yet-wired, not to erase the reader's map of where enforcement is headed.

**Failure mode — the correction over-corrects into understatement.** The failure: framing the evaluator or integrity boundary as "not built / vaporware" when the primitives *are* built (evaluator-preflight, the spawner, `faff integrity-boundary` all ship) and merely un-wired/un-mounted. How you'd know: a reviewer who knows the code flags the edited prose as now *underclaiming*. What it means: narrow the wording back to "built but attested/not-yet-wired," the precise state the modules describe — the target is calibration, not deflation.

## Scenarios

The objective — each L4 enforcement claim in the two files either matches shipped behaviour or plainly states the attested-not-enforced reality — is a concrete, checkable outcome.

```
Given the "evaluator hard cage" section of docs/guide/unattended.md
When a reader reads how L4 code-blindness is enforced
Then the text states code-blindness is attested today (evaluator runs inline,
     can read the repo) and the spawner/preflight cage is built-but-not-yet-wired
And it does not read as a physically code-blind evaluator gating every L4 merge now
```

```
Given the corrective-integrity / FAFF_INTEGRITY_BOUNDARY bullet of docs/guide/unattended.md
When a reader reads how the integrity boundary is established
Then the text states faff asserts (never creates) the boundary and that today,
     with no read-only mount, it is an honest REFUSE (probe asserted:false by design)
And it does not read as a per-run operator gesture that arms the boundary now
```

```
Given docs/guide/architecture.md's evaluator-lane paragraph
When a reader reads "a spec it never saw … gates the merge"
Then code-blindness is qualified as an attested (compliance) property today, not a
     physically enforced one
```

- The three verified-already-honest claims (sentry, no-reduced-mode, branch-protection) MUST remain unedited, and the spec's evidence for each MUST be checkable against HEAD (grep + the cited module lines).

## 6. DESIGN DECISION RATIONALE

**How to discharge a ticket whose premise (5 overclaims in 2 files) doesn't match HEAD?**
- *Options:* force five edits (invents caveats / hunts phantom text); correct the two live overclaims and verify the three already-honest with evidence.
- **Chosen:** correct-two-verify-three. The ticket's Done is satisfied per-claim ("matches shipped behaviour OR states the attested reality"); three claims already match in these files, and proving that is the honest, reviewer-reproducible outcome. Temporal anchor: as of HEAD (2026-07-22) the named files carry only the evaluator-cage and corrective-integrity overclaims; if the files drift, re-grep before assuming this disposition.

**Scope: sweep the governance-layer explainer report too?**
- *Options:* widen to the third doc where "no reduced mode"/operational-`correct` actually live; keep to the two named files + recommend a peer ticket.
- **Chosen:** keep to the named files; recommend a peer ticket. Mirrors FAFF-583's minimal-blast-radius precedent (named-files-only, ceded only `docs/guide/*` here); the explainer is a third doc owned by neither ticket, so sweeping it mid-run is unsanctioned scope-creep into a trust doc. Recorded in §7 as the recommended follow-up.

**How far to reframe the cage/spawner narration?**
- *Options:* delete it (it's not live); reframe it as built-but-not-wired with a one-sentence today-state preface.
- **Chosen:** reframe, don't delete. The machinery is real and is the intended enforcement; erasing it removes the reader's map of where L4 enforcement is headed. Calibrate to the module's own "SHIP-NOT-WIRE" language.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — no **Punt:** items. (The scope-widen question is closed as a **Chosen** above, with a recommended peer follow-up below rather than a blocking punt.)

**Recommended follow-up (chain-gap, not a blocker for this ticket):** file a peer ticket to sweep `docs/reports/governance-layer-explainer-2026-07.md` for the same overclaim class — the absolute "no reduced mode" mermaid node (`:43`) and the `pause → correct → abort` sentry node that narrates the dormant `correct` rung as operational. Same trust-doc principle, third file, out of both FAFF-570's and FAFF-583's named scope.

**Assumptions:**
- **Assumes:** the two named files still carry only the evaluator-cage and corrective-integrity overclaims at build time. Validate: re-grep `docs/guide/unattended.md` and `architecture.md` for the cited passages before editing; if new overclaiming text appeared since 2026-07-22, treat it under the same correct-if-overstates / verify-if-honest rule.
- **Assumes:** the code ground truth (`evaluator-preflight.js` SHIP-NOT-WIRE; `corrective-integrity.js` assertion-not-creation; `lights-out.js` FAFF-525 degrade) still holds at build time. Validate: re-read those module headers; if FAFF-276/FAFF-517/FAFF-381 have since landed, update the honest framing to the then-current state (the guarantee may have become enforced).

## 8. DONE — Definition of Done

### From WHY
- [ ] Every L4 enforcement claim in `docs/guide/unattended.md` and `architecture.md` either matches shipped behaviour or plainly states the attested-not-enforced reality.

### From WHAT (the corrections)
- [ ] `unattended.md`'s evaluator-cage section states code-blindness is attested today (evaluator dispatched inline, shares run cwd, can read the repo) and frames the spawner/preflight cage as built-but-not-yet-wired (FAFF-276/FAFF-381 pending) — not as current operation.
- [ ] `unattended.md`'s corrective-integrity bullet states faff asserts (never creates) the boundary and that today it is an honest REFUSE (no read-only mount; probe `asserted:false` by design; FAFF-517 deferred) — not a per-run operator gesture that arms it now.
- [ ] `architecture.md`'s evaluator-lane paragraph qualifies code-blindness as an attested (compliance) property today, not physically enforced.

### From WHAT (verification — no edit)
- [ ] The spec's disposition for bullets 1 (sentry), 4 (no-reduced-mode), and 5 (branch-protection) is confirmed against HEAD: none is a live overclaim in the two named files, so each is left unedited with its grep/code evidence recorded.
- [ ] The stale "unavailable on this account tier" branch-protection rationale is confirmed absent from both files (it was never present at HEAD).

### From HOW (blast radius)
- [ ] No file other than `docs/guide/unattended.md` and `docs/guide/architecture.md` is edited — the gateway, the lights-out banner, and `docs/reports/governance-layer-explainer-2026-07.md` are untouched.
- [ ] Each edited passage was re-read against its cited module and neither overclaims nor understates (no "vaporware" understatement of built primitives).

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Open docs/guide/unattended.md to the "evaluator hard cage" section and the
     FAFF_INTEGRITY_BOUNDARY bullet; confirm each reads attested/honest-REFUSE, not operational.
  2. Open docs/guide/architecture.md's evaluator-lane paragraph; confirm code-blindness reads as attested.
  3. git diff --stat — only these two files changed.
  4. Spot-check one verified-honest claim (the `armed` live/degraded/absent map) is unchanged.
```

confidence: high
spec-review: approve