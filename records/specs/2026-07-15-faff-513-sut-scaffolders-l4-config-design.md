# Spec — FAFF-513: SUT scaffolders label P1/P2/P3 lights-out-eligible but their `.faffrc` is REFUSED at L4 preflight

> Spec: faffter-dark-nlspec · 2026-07-15 · interactive · confidence: high. Full spec on Linear FAFF-513.

## WHY

The external-verification README labels **P1, P2, P3** as lights-out-eligible (P1/P3 "lights-out eligible", P2 "lights-out + `--converge`"). FAFF-310's whole purpose is to drive one of these SUTs to an **L4 lights-out acceptance run**. But every scaffolder emits a `.faffrc.yaml` that `faff lights-out --check` **REFUSES** on dial-coherence — so an operator following the RUNBOOK hits a preflight wall the scaffolder should have prevented. A SUT that self-labels lights-out-eligible must scaffold a config that actually clears the L4 preflight. This is dogfooding-infra drift (sibling to FAFF-512, which refreshed these scaffolders without catching it).

Confirmed against a live `faff lights-out --check` (mints nothing) plus the dial-coherence source (`plugin/skills/faff/bin/lib/lights-out.js`). Three dial-coherence axes fire on a P1/P2/P3 SUT config:

| Refusal gate | SUT config today | L4 requires | Confirmed by |
|---|---|---|---|
| `dial-coherence:adversarial-review` | `slots.review: faffter-noon-review` | `faffter-dark-adversarial-review` | source (`lights-out.js:206,237`) |
| `dial-coherence:adversarial-spec-review` | `slots.spec_review` unset → single-pass default | `faffter-dark-spec-review` | live `--check` |
| `dial-coherence:gates-fallback` | `gates.fallback` unset → `advisory` | `fail-closed` | live `--check` |

The fourth preflight leg — `corrective-integrity` / `FAFF_INTEGRITY_BOUNDARY` in pid-1 — is **operator-supplied at cage launch**, not a scaffolder concern.

## OUT OF SCOPE

- `corrective-integrity` / `FAFF_INTEGRITY_BOUNDARY`: operator-supplied in the cage's pid-1 environment; the scaffolder cannot satisfy it (only *remind* about it — see WHAT).
- `container` / `container-check`: the cage is the operator's job at launch, not the scaffolder's.
- P4 (Stripe test-mode) and P5 (brownfield) `.faffrc` **L4 config**: both are deliberately gated (L2/L3 and L1–L3) — they must *not* pass L4. No config change; verify-only (WHAT §3).
- Any change to the dial-coherence rules themselves or to `faff lights-out` — the refusals are correct; the SUT configs are wrong.
- Budget-ceiling values (`max_attempts`/`tokens`/`cost`) — already set and reasoned in each scaffolder; untouched.

## WHAT

1. **Fix P1, P2, P3 scaffolders' generated `.faffrc.yaml`** so a fresh SUT clears L4 dial-coherence. In each heredoc:
   - Change `slots.review: faffter-noon-review` → `slots.review: faffter-dark-adversarial-review`.
   - Add `slots.spec_review: faffter-dark-spec-review`.
   - Add a top-level `gates:` block with `fallback: fail-closed`.
   - Add one clarifying comment line noting these three are the L4 lights-out dials.
2. **Emit a one-line `FAFF_INTEGRITY_BOUNDARY` reminder** in P1/P2/P3 RUNBOOKs (the one preflight leg the scaffolder can't satisfy), so the operator isn't ambushed by the remaining `corrective-integrity` refusal at cage launch. **Chosen** (see Rationale) — answers the ticket's second open question.
3. **Verify (no change) P4 and P5**: their `.faffrc` stays L4-refusing on purpose, and their RUNBOOK/label text already says "do NOT lights-out" / "NOT lights-out" (confirmed). DONE asserts this text is still present.
4. **Add a durable repo-side lint/test** asserting every README-lights-out-eligible scaffolder emits a `.faffrc.yaml` heredoc carrying the three L4 dials (and that gated scaffolders do not claim lights-out). The class-fix that stops the drift recurring. **Chosen** (see Rationale).

## HOW

### Per-scaffolder `.faffrc.yaml` heredoc edits (P1, P2, P3)

Target shape for each:
```yaml
slots:
  methodology: faffter-dark-methodology-agile-delivery
  spec: faffter-dark-nlspec
  architecture: faffter-noon-architecture
  env: faffter-noon-env-compose
  evaluator: faffter-noon-evaluate
  review: faffter-dark-adversarial-review     # L4 dial: adversarial second-opinion (was faffter-noon-review)
  spec_review: faffter-dark-spec-review       # L4 dial: adversarial spec_review (was unset → single-pass default)
# ... existing appetite / automation_default / intake_gate / budget unchanged ...
gates:
  fallback: fail-closed                        # L4 dial: unattended runs need fail-closed engineering gates (was unset → advisory)
```

Exact anchor lines (verified):

| Scaffolder | `review:` line | Insert `spec_review:` after it | Add `gates:` block | Comment |
|---|---|---|---|---|
| `scaffold-p1-link-shortener.sh` | L37 | yes | after `budget:` (heredoc L29–52) | header comment L30 |
| `scaffold-p2-task-api.sh` | L40 | yes | after `budget:` (heredoc L29–52) | header comment L30 |
| `scaffold-p3-landing-page.sh` | L37 | yes | after `budget:` (heredoc L30–46) | header comment L31 |

- `gates:` is top-level (sibling of `slots:`/`budget:`); order among top-level keys is immaterial to the parser (`dig(cfg, "gates.fallback")`).
- Don't disturb existing budget comments/values or `automation_default`. P4 (`review:` L43) and P5 (`review:` L136) are **not** touched.

### `FAFF_INTEGRITY_BOUNDARY` reminder (P1/P2/P3 RUNBOOK)

Add near the drive step, e.g.:
> Lights-out only: `faff lights-out --check` will still report `corrective-integrity` until the cage's pid-1 sets `FAFF_INTEGRITY_BOUNDARY` at launch — that leg is operator-supplied, not scaffolded. All three **dial-coherence** legs are now satisfied by this SUT's `.faffrc.yaml`.

### Scaffolder self-check lint (repo-side test)

A test (alongside the repo's `test/*.mjs`; no Docker, no scaffolding to disk) that, per scaffolder script, extracts the `.faffrc.yaml` heredoc body by static scan and:
- For lights-out-eligible (P1/P2/P3): asserts all three — `slots.review: faffter-dark-adversarial-review`, `slots.spec_review: faffter-dark-spec-review`, `gates.fallback: fail-closed` (whitespace-tolerant).
- For gated (P4/P5): asserts the body does **not** claim lights-out **and** the script carries a "not lights-out"/"gated" marker.

Keep the expected strings sourced (in a comment) from `lights-out.js`'s `ADVERSARIAL_REVIEW_OCCUPANTS` / `ADVERSARIAL_SPEC_REVIEW_OCCUPANTS` + the `fail-closed` token, so a future occupant rename surfaces here.

## Scenarios

- **S1/S2/S3** — Given a freshly scaffolded P1 / P2 / P3 SUT, When `faff lights-out --check` runs, Then **no** `dial-coherence:*` refusal appears (a lone `corrective-integrity` refusal, absent a cage, is acceptable).
- **S4** — Given each P1/P2/P3 generated `.faffrc.yaml`, When parsed, Then `slots.review == faffter-dark-adversarial-review`, `slots.spec_review == faffter-dark-spec-review`, `gates.fallback == fail-closed`.
- **S5** — Given P4/P5, When `.faffrc.yaml` parsed + RUNBOOK/label grepped, Then neither sets the three L4 dials **and** each still carries its "not lights-out" text.
- **S6** — Given the new lint, When a lights-out-eligible scaffolder's heredoc is missing a dial, Then it fails naming the missing dial; When all three present, Then it passes.
- **S7** — Given each P1/P2/P3 RUNBOOK, When grepped, Then a `FAFF_INTEGRITY_BOUNDARY` operator-supplied line is present.
- **S8** — Given a scaffolded P1, When an operator runs interactive `/faff-prep`→`/faff-graft`, Then the heavier adversarial slots + fail-closed gates don't wedge the drive; a pre-test `needs-human` (discovery:none under fail-closed) is expected + correct, not a blocker. [verify-at-build]

## Design Decision Rationale

- **Chosen: the three L4 dials go in the SUT's committed base `.faffrc.yaml`, not a scaffolded `.faffrc.local.yaml` overlay.** `unattended.md` recommends the overlay to avoid mutating faff's *own shared committed base*; but a scaffolder **authors the SUT's base from scratch** and owns it — an L4-passing base is the correct durable machine-independent default for a lights-out-labelled SUT (these are eligibility values, not machine-local facts). An operator wanting a lighter L2/L3 drive can still drop an overlay; we just don't make the eligible default depend on it.
- **Chosen: same adversarial `review`/`spec_review` throughout, including interactive first-light — no interactive-vs-lights-out slot split.** First-light on these SUTs is the warm-up to the very same L4 run, so exercising the adversarial machinery early is a feature; a split would reintroduce exactly the drift this fixes; budgets already allow the marginal cost.
- **Chosen: a durable repo-side lint over an in-scaffolder live `--check`.** A static heredoc-text test runs in CI with no Docker/isolation; the natural home for FAFF-512's mooted CLI-surface lint. **Punt: an in-scaffolder `faff lights-out --check` self-run — needs human (decides: qa)** — env-dependent and the `container`/`corrective-integrity` legs refuse for unrelated reasons, so it can't cleanly assert only dial-coherence without output-parsing gymnastics; the CI lint covers it more robustly.
- **Chosen: emit the `FAFF_INTEGRITY_BOUNDARY` reminder** — the single leg the scaffolder can't satisfy; a one-liner converts a confusing residual refusal into an expected documented step.

## Open Questions & Assumptions

- **Punt:** whether to *additionally* run `faff lights-out --check` inside the scaffolder as a post-write assertion, or whether the CI lint (S6) is sufficient — needs human (decides: qa). Ships the CI lint; revisit only if it proves too weak.
- **Assumes:** `faffter-dark-adversarial-review` / `faffter-dark-spec-review` exist + are reachable in a fresh SUT (global skills). *Validate:* both in `plugin/skills/` and `lights-out.js`'s occupant sets (confirmed).
- **Assumes:** `gates.fallback` is a real key. *Validate:* `dig(cfg,"gates.fallback")` in `lights-out.js`/`gates.js:149`, default `advisory` in `config.js:44` (confirmed).
- **Assumes:** `fail-closed` gates don't wedge an interactive pre-test first-light. *Validate:* per `gates.js:170-171`, fail-closed only escalates to `needs-human` on `discovery:none`; once the SUT's DoD test suite lands, discovery is non-empty and the gate passes.

## DONE

1. **P1/P2/P3 dials present.** Each of the three scaffolders' `.faffrc.yaml` heredoc contains `review: faffter-dark-adversarial-review`, `spec_review: faffter-dark-spec-review`, `gates:`/`fallback: fail-closed`; no residual `review: faffter-noon-review` in these three. (`grep -c`)
2. **Live preflight clears dial-coherence.** Scaffold P1 (spot-check P2/P3) into a temp `SUT_ROOT`; `faff lights-out --check 2>&1 | grep -c 'dial-coherence:'` == 0 (a lone `corrective-integrity` refusal is acceptable).
3. **P4/P5 untouched + honestly labelled.** Their heredocs contain none of the three dials; each script still greps a "NOT lights-out"/"gated" marker.
4. **Reminder present.** `grep -c FAFF_INTEGRITY_BOUNDARY` ≥ 1 in each P1/P2/P3 script.
5. **Self-check lint added + green.** The test asserts the dial set per scaffolder (present for P1/P2/P3, absent for P4/P5), fails loud on a missing dial (spot-check a deliberate removal), suite passes.
6. **No collateral change.** `git diff` touches only the five scaffolder scripts + the new test file — no change to `lights-out.js`, gate rules, or README labels.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "assumes" } ] }
```
