# Reconcile must say when it could not check, not just when it found nothing

> Spec: faffter-dark-nlspec · 2026-07-29 · autonomous · revision 2 (final) · confidence: high. Full spec on Linear FAFF-680.

## WHY

`faff reconcile` is the run-end gate that confronts each ledger claim with live git/forge/tracker evidence. It has two halves: the `shipped`/`superseded` half, and the sibling half, which catches a spec-referenced, non-admitted issue that flipped into a terminal state mid-run.

The sibling half depends on one artifact: `<run-dir>/sibling-baseline.json`. Nothing writes it. The write is named in exactly one place — `plugin/skills/faff-beep-boop/SKILL.md:193` — and appears nowhere in `plugin/skills/faff/bin/lib/`.

That alone would be an ordinary gap. What makes it worth fixing is what happens next. Run `run-20260729-002829-beepboop-full` produced no baseline, the orchestrator assembled a `ReconcileInput` with `siblings: []`, and the gate returned a clean pass. Reproduced against the current binary:

```
$ echo '{"siblings":[]}' | node plugin/skills/faff/bin/faff reconcile --run-dir /tmp/x --level L3 --json
{"divergences": [], "consistent": true, "disposition": "pass"}   # exit 0
$ echo '{}'              | node plugin/skills/faff/bin/faff reconcile --run-dir /tmp/x --level L3 --json
{"divergences": [], "consistent": true, "disposition": "pass"}   # exit 0
```

A run where the sibling check ran and found nothing, and a run where it could not run at all, are byte-identical on stdout and exit code. `reconcileCore` iterates `input.siblings` when it is an array and skips it otherwise; the comment at `reconcile.js:111` calls the empty case "vacuously consistent", which is right for a run that touched nothing and wrong for a run whose evidence never arrived.

This is out of character for the rest of the file. Every other absence is a failure to prove, not a proof of health: a missing `merge-record.json` is `claimed-shipped-unmerged` (`reconcile.js:41`), a missing `supersession.json` is `superseded-unproven` (`:73`), and the header states the rule — "a `shipped` claim with no matching merge evidence is a divergence, never a silent pass". The sibling half is the one place it was not applied, because absence there is carried by an empty array rather than a missing object.

The cost: at L4 nothing is watching, and the run summary's `## Ground-truth divergences` section renders only when the gate found something. A run that never captured a baseline reports as cleanly reconciled, and the only way to learn otherwise is to read the run directory by hand — which is how this was caught.

## WHAT

After this change, `faff reconcile` can tell "the sibling check ran and found nothing" apart from "the sibling check did not run", and only the first is a clean pass. The second surfaces through machinery that already exists: warn at ≤L3, escalate at L4, exit 1, rendered in the run summary.

In scope:

- `ReconcileInput` grows an explicit statement about whether the sibling baseline was captured, where saying nothing means "not captured".
- `reconcileCore` classifies a non-captured baseline as a divergence.
- **The existing selftest fixture table is migrated, not merely extended** *(revision 1)* — see DONE. Default-degraded changes the verdict of every fixture that does not carry the new key.
- beep-boop step 11.5 emits the statement; step 4's baseline write gains a run-end consequence for being skipped.

Out of scope: sibling-id extraction, a baseline-writing verb, touching `runcheck`, and extending the attestation to `shipped`/`superseded`. Each argued below.

## HOW

### How the input distinguishes absent from empty

The distinction cannot ride on `siblings[]` — `[]` genuinely means "zero non-admitted spec-referenced siblings". It needs a separate field, and the field's *default* has to be the degraded reading, because the observed failure is an assembler that forgot a step. An assembler that forgets the baseline write will also forget an opt-in "degraded" flag. Only a scheme where silence is unsafe survives forgetfulness.

```json
{ "level": "L4", "shipped": [], "superseded": [], "siblings": [],
  "sibling_baseline": { "captured": true, "entry_count": 3 } }
```

- `sibling_baseline` absent, or `captured` anything other than boolean `true` → the check did not run.
- `captured: true` → the assembler affirms it read `<run-dir>/sibling-baseline.json`; `entry_count` is that file's entry count.

**Chosen:** carry the distinction in a named `sibling_baseline` attestation whose absence reads as not-captured, rather than in the `siblings` array's shape (`null` versus `[]`). A null-versus-empty convention is one keystroke from silent regression and reads as a typo; a named field is visible to anyone reading the run's JSON. It is additive to the array's existing semantics.

**Chosen:** the default is degraded. An input silent about the baseline is treated exactly as `captured: false`. This is the only arrangement where the observed failure mode lands in the loud branch — an opt-in degradation marker would have made no difference to the run that exposed this.

**Chosen:** `captured` coerces fail-safe — anything not boolean `true` (missing, `null`, the string `"true"`, a number) reads as not-captured rather than being rejected as malformed. Mirrors `normalizeRunTriggerSignals` (`run-start.js:45`), where every signal is strict-`=== true`. A typo should degrade the verdict loudly, not turn the gate into a usage error a tired orchestrator routes around.

**What `entry_count` is and is not** *(revision 1 — the reviewer's infosec major).* The first draft claimed `entry_count` "stops `captured: true` degenerating into a rubber stamp". That is false and it matters, because the step-11.5 prose gets written from this paragraph. The constraint is `entry_count >= siblings.length`; with zero siblings — the ordinary case, and the exact case that produced this ticket — it reduces to `0 >= 0`. So `{"captured":true,"entry_count":0}` beside `siblings: []` is simultaneously the genuine clean shape and the shape an assembler emits by copying the example without ever opening the baseline file. The ambiguity would simply move up a level.

The honest statement: **this design catches omission, not fabrication.** Against a forgetful assembler — the observed failure — the default-degraded rule does all the work on its own. `entry_count` is a coherence check that catches a self-inconsistent payload (a claim of capture contradicting the array it supposedly came from), which is worth having and is not a defence against a determined caller. Nothing here constrains an assembler that asserts capture it did not perform, and no field on a self-reported input could. That limit belongs in the prose so nobody later mistakes the check for something stronger.

**Chosen:** an incoherent attestation — `captured: true` with a non-integer, negative, or below-`siblings.length` `entry_count` — is exit 2 malformed input, decided in `validateReconcileInput`, not a divergence. The file already draws this line: shape faults are exit 2, missing *evidence* reaches the core and fails closed there.

### The gate does not go and look for itself

**Chosen:** `reconcile` never touches the run directory; the attestation arrives on stdin like every other piece of evidence. ADR-0056 and the file's header make the split load-bearing — the caller gathers evidence, the verb classifies it. Statting a file would make the verdict depend on ambient filesystem state that `reconcileCore` and its in-memory selftest cannot reach, and a gate whose behaviour cannot be driven from a fixture table is a gate nobody can prove.

### A divergence class, not a third disposition

**Chosen:** a new divergence class, `sibling-check-unproven`, appended to `DIVERGENCE_CLASSES`. No third `disposition`.

A new disposition needs a new branch in every consumer, and the consumers are prose — beep-boop step 11.5's three-way route on `pass` / `warn` / `needs-human` (SKILL.md:321-325). Verified: nothing consumes `disposition` or `consistent` programmatically outside `reconcileExitFor` (`reconcile.js:137`). Adding a fourth arm to a prose routing table is the instruction class that already failed here. A divergence class needs no new arm: it flows into `warn` at ≤L3 and `needs-human` at L4 through the existing level gate at `:130`, sets `consistent: false`, exits 1, and renders in the summary's generic `[class] issue: detail` block.

It also matches the vocabulary — `superseded-unproven` already means "this outcome's evidence did not arrive".

The accepted cost: `consistent: false` now means either "something diverged" or "something could not be checked". The conflation predates this change (`claimed-shipped-unmerged` fires on absent evidence with no proof anything went wrong) rather than being introduced by it, and the `detail` string carries the difference.

The divergence is run-level, so it carries `issue: null` — the first output divergence to do so. `validateReconcileInput`'s non-empty-`issue` requirement applies to *input* elements and is untouched. The `✗` printer at `reconcile.js:216` needs adjusting so a null issue renders as run-level rather than the literal `null`:

```
✗ [sibling-check-unproven] run: no sibling baseline attested — the unowned-sibling-mutation check did not run
```

**Assumes:** beep-boop step 11.5 is the only producer of a run-end `ReconcileInput`. Verified by grep; `gatherResumeEvidence` (`lights-out.js:1150`) builds a similar-looking `{recorded, observed}` bundle for resume reconstruction, not this verb. An adopter piping their own input sees warns until they add the attestation — the intended direction, worth a note in the change rather than a compatibility shim.

### The missing write

**Chosen:** no new verb writes `sibling-baseline.json`. The write stays in beep-boop's assembly step; the enforcement is the run-end gate failing loudly when it did not happen.

A `faff sibling-baseline write` verb would still need invoking by the same step that forgot the file, relocating the prose dependency without removing it. The content is not mechanically derivable inside a CLI either — it needs live tracker state only the orchestrator has. Detection needs no cooperation from the path that failed.

The consequence, explicitly: until beep-boop's assembly writes the baseline *and* step 11.5 emits the attestation, every run reports a `sibling-check-unproven` divergence. Both prose edits and the code land together, or the first L4 run after the merge escalates on a self-inflicted finding.

### `runcheck` stays untouched

Three independent reasons. `auditLedger` (`runcheck.js:32`) is pure over a parsed ledger and takes no run directory — a file-presence check needs a new I/O path in a function relied on by `audit.js:17`, `disposition.js:18`, `governance-check.js:37`, `governance-profile.js:325`, plus the `faff runcheck --hook` Stop hook. Second, the property differs: whether a *different* gate's input artifact exists is not a fact about the ledger. Third, it would be redundant — `reconcile` runs immediately after and now refuses to pass without the attestation. This closes the ticket's second open question: yes, it would overload a completeness check with a freshness concern, and the concern already has a home.

### `shipped` and `superseded` are not equally exposed

For those arrays an independent record of the expected population exists: they derive from the ledger's terminal outcomes, and `runcheck` has already proven at step 11 that every admitted issue has one. "The run wrote no `merge-record.json` files" is not silent — each entry arrives with `recorded: null` and fails closed (`reconcile.js:47`, `:80`). Only wholesale dropping of ledger rows produces a silent pass there, a larger failure where the ledger on disk makes reconstruction straightforward.

For siblings there is no such record. The baseline file *is* the only statement of what the sibling set was, so its absence erases the question along with the answer.

**Chosen:** scope the attestation to the sibling baseline. Revisit trigger: a clean reconcile whose `shipped[]` is shorter than the ledger's shipped outcomes — the fix there would be a ledger-count cross-check, not a second attestation.

### Missing coverage, folded in

`faff reconcile --selftest` is not run in CI — `grep -rn reconcile .github/workflows/` returns nothing, while `merge-gate --selftest` and 20+ others are wired. It passes locally (38 cases, 0 failed), so this is a wiring omission rather than a hidden failure, but a gate whose selftest nobody runs is a gate that can rot — broadly this ticket's theme.

**Chosen:** add the step to `validate.yml`. The new class is only as good as the fixture table asserting it.

`reconcile.js:296` asserts every entry in `DIVERGENCE_CLASSES` is exercised by the fixture table, so adding the class *fails the selftest* until fixtures exist. The coverage requirement is mechanical.

### Documentation and comments that move with it

- `docs/guide/cli.md:69` — the `reconcile` row's stdin shape and divergence-class list. (`lint-cli-doc` checks only that a row exists, so this is not caught mechanically.)
- `plugin/skills/faff-beep-boop/SKILL.md` — step 11.5 gains the attestation emission; step 4's snapshot paragraph gains the run-end consequence; the `## Ground-truth divergences` example gains the class.
- **`reconcile.js:111` and `:143` comments** *(revision 1)* — both call empty input "vacuously consistent". Both become false under default-degraded. WHY quotes `:111` as the thing being wrong, so leaving it in place would ship a comment contradicting the behaviour directly above it.
- `docs/adr/0056-*.md` — the decision (pure core, impure shell, level-gated disposition) is unchanged; one line in consequences noting the class was added.

## DONE

Each is a command whose exit status decides it.

1. `node plugin/skills/faff/bin/faff reconcile --selftest` exits 0.
2. **The absent-versus-empty distinction, end to end:**
   ```
   $ echo '{"siblings":[]}' | faff reconcile --run-dir "$d" --level L3 --json
   → exit 1, divergences contains {"class":"sibling-check-unproven"}, consistent:false, disposition:"warn"

   $ echo '{"siblings":[],"sibling_baseline":{"captured":true,"entry_count":0}}' | faff reconcile --run-dir "$d" --level L3 --json
   → exit 0, divergences [], consistent:true, disposition:"pass"
   ```
3. **The existing fixture table is migrated, not just extended** *(revision 1 — the reviewer's QA major).* No fixture in `RECONCILE_SELFTEST_CASES` carries `sibling_baseline` today (zero mentions), so under default-degraded every one of them gains a `sibling-check-unproven` divergence: five that assert `consistent: true` flip to `warn`/`needs-human`, and the rest need an extra entry in their ordered `divergenceClasses` arrays because the comparison at `:288` is positional. Each existing fixture is updated deliberately — either given `sibling_baseline: {captured:true, entry_count:N}` to preserve its intent, or its expectations updated to include the new class. Criterion 1 is not satisfiable without this; treating the change as additive ships a red selftest.
4. New fixtures covering: attestation absent → `sibling-check-unproven` at L4 with `needs-human`; the same at L3 with `warn`; `captured: true` with a populated `siblings[]` and one sibling flipped terminal → exactly one `unowned-sibling-mutation` and no `sibling-check-unproven`; `captured: "true"` (string) → not-captured, exit 1; `captured: true` alongside a genuine divergence → both classes in one result, in a recorded order (`reconcileCore` pushes shipped, then siblings, then superseded — the implementer picks where the run-level entry lands and the fixture records it).
5. `validateReconcileInput` fixtures: `{captured:true, entry_count:0}` with two siblings entries → non-null error; `entry_count:-1` → error; `entry_count:"3"` → error; `{captured:true, entry_count:3}` with two siblings entries → null (drop-out from chain-unlock admission is legal); `sibling_baseline` absent → null (a degraded verdict, not a shape fault).
6. `DIVERGENCE_CLASSES` contains `sibling-check-unproven` and the `:296` coverage check still passes.
7. `node plugin/skills/faff/bin/faff reconcile --selftest` runs as a step in `.github/workflows/validate.yml`.
8. `faff lint-cli-doc` and `faff lint-refs` both exit 0 after the doc edits.
9. `grep -c sibling_baseline plugin/skills/faff-beep-boop/SKILL.md` ≥ 1, in step 11.5's assembly instruction.
10. **The run-level `✗` line renders correctly** *(revision 1 — the reviewer's QA major).* Piping an input with no attestation and no `--json` prints a line matching `✗ [sibling-check-unproven] run:`. The first draft asserted the non-`--json` output contains no literal `null`, which is unsatisfiable: `:217` also prints `JSON.stringify(result)` inside a `faff-contract:run-reconcile` fence, and that JSON carries `"issue":null` verbatim regardless of any printer change. The printer fix at `:216` is real and still required; only the assertion was defective.
11. The "vacuously consistent" comments at `reconcile.js:111` and `:143` no longer describe empty input as consistent.

## Open questions

- **Punt:** mechanise sibling-id extraction from spec bodies inside the CLI, or leave it to the orchestrator's spec read — needs human *(decides: architecture)*. Under-recall in extraction lets a wrongly-mutated sibling escape even with a correctly captured baseline; the attestation proves the check ran, not that its input was complete. **Does not block the build.**
- **Assumes:** beep-boop step 11.5 is the only producer of a run-end `ReconcileInput`.

## Self-review

### Revision 1 — after an approach review returned `revise`

Three majors, all accepted, all real.

- **major, fixed (infosec)** — the `entry_count` rationale was wrong. With zero siblings the constraint is `0 >= 0`, so the documented clean literal is also the zero-work forgery, and the ambiguity the ticket exists to close would have moved up one level. Worse, the rationale was destined for the step-11.5 prose, which would have taught the exact literal that defeats the check. Rewritten to state plainly what the design does — catches omission, not fabrication — and that no field on a self-reported input could do more.
- **major, fixed (QA)** — DONE criterion 9 (now 10) was unsatisfiable. Non-`--json` mode also prints the contract block at `:217`, whose JSON carries `"issue":null` regardless. Narrowed to the checkable half (the `✗ … run:` line), with the impossible assertion removed and the still-needed printer change kept.
- **major, fixed (QA)** — default-degraded rewrites the existing fixture table, and the spec framed the change as additive. Five fixtures assert `consistent: true` and would flip; the rest need positional array updates. The `:111` and `:143` "vacuously consistent" comments also become false and were missing from the doc-move list even though WHY quotes `:111` as the defect. Added as DONE criteria 3 and 11.

### First pass

- **major (resolved):** first draft justified the divergence-class choice on aesthetics; rewritten around the concrete consumer set (prose routing only — verified no code consumer).
- **major (resolved):** first draft asserted `shipped[]` was equally exposed. It is not — per-entry fail-closed at `:47` and `:80`. Rewrote the section around that asymmetry.
- **major (resolved):** nearly proposed that `reconcile` stat the baseline file. Rejected against ADR-0056's split; the rejection is written up rather than dropped.
- **minor (fixed):** initially treated a non-boolean `captured` as exit 2; changed to fail-safe coercion per the `run-start.js:45` precedent.
- **minor (fixed):** missed that output divergences would carry `issue: null` for the first time.
- **minor (folded in):** `reconcile --selftest` absent from CI.
- **minor (verified):** `gatherResumeEvidence` is not a second `ReconcileInput` producer.

Two review passes. The second found three real defects, one of which would have shipped a red selftest and one of which would have propagated a false security claim into skill prose. All closed rather than deferred.

confidence: high
