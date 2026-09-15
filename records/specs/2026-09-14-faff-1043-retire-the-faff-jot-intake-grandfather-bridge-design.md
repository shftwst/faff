# Spec — Retire the faff-jot-intake grandfather bridge (and faff-chain-gap-fill with it)

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1043.
> build-tier: complex

This is the buildable design for FAFF-1043. Audience: the build agent that will remove the two migration-bridge control labels, and the human reviewer who signs off the one judgement call this spec reframes. It covers `faff-jot-intake` (the label with a live code branch) and its sibling `faff-chain-gap-fill` (a label with no code branch at all), retiring both together.

## 1. WHY — Problem and Principles

**The load-bearing model:** intake provenance — "did this ticket enter through the front door?" — is answered by `intakeVerdict` (`plugin/skills/faff/bin/lib/intake-provenance.js`) over three bases in strict precedence: the CLI-written `.faff/provenance/<ISSUE>.json` marker (`via`), then the `faff-jot-intake` label (`grandfathered-label`, spoofable, carries `warn:true`), then the `faff-automate` label (`eligibility-gesture`, trustworthy because the label is `tracker_owned` and the CLI refuses to write it). The whole question this spec turns on is whether the middle basis still does any work. It does not.

**Problem statement:** `faff-jot-intake` survives only as a migration bridge for tickets predating the provenance marker (FAFF-212), and its own manifest description already says so. It is an agent-writable — therefore spoofable — way past the intake gate, kept alive for legacy rows. The change removes the basis and the label, plus the identical-class sibling `faff-chain-gap-fill`.

**Design principles:**

- **Reachability decides safety, not the raw ticket count.** The issue's deciding question ("are there open tickets whose intake rests on this label alone?") is a proxy. The real safety question is whether the `grandfathered-label` branch is ever *reached in a way that changes an outcome*. It is not — see the measurement and Failure modes. An implementation that removes the branch but leaves an unhandled path that would newly *block* a build is wrong; this spec's approach exists precisely to show no such path exists.
- **The label was never the load-bearing signal; the marker is.** Every tagging site pairs the label with a real signal — `faff intake-record --via jot` (the `.faff/provenance` marker) or the `initiated: autonomous` audit field. Removal drops only the cosmetic label; every `faff intake-record` stamp stays. An implementation that removes a marker stamp alongside the label has broken the actual provenance chain.
- **Retire both or justify keeping one.** The two labels are the same class (transitional cosmetic hints). The issue forbids silently fixing one and leaving the other.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/intake-provenance.js` | Node (pure) | `intakeVerdict` + the `grandfathered-label` branch + the three selftest rows |
| `plugin/skills/faff/bin/lib/labels.js` | Node (pure) | `CONTROL_LABELS` manifest — the single source of truth for the label set |
| `plugin/skills/faff-graft/SKILL.md` | prose | Intake-provenance precondition (the only consumer of the verdict); runs *after* the eligibility gate |
| `plugin/skills/faff-jot`, `faff-plot`, `faffter-noon-methodology-thematic`, `faffter-dark-methodology-agile-delivery` | prose | Tag-on-create sites for the two labels |
| `plugin/skills/faff-tidy`, `faff-beep-boop`, `faff-graft` | prose | Chain-gap / self-intake filing recipes that tag the labels |
| `plugin/skills/faff/references/{autonomous,tracker,methodology,create}.md` | prose | Manifest recital, control-label convention, self-intake carve-out, create-path recital |
| `plugin/skills/faff/bin/lib/config.js:108` | Node | Self-intake bucket comment naming the `faff-jot-intake` bucket |

**Scope statement:** this is a self-hosting cleanup of faff's own control-label manifest and the one code branch that reads the retired label; it changes no build-pipeline behaviour that is currently load-bearing.

## 2. OUT OF SCOPE

- **The other seven control labels** — `faff-automate` / `faff-automation-hold` (tracker-owned eligibility), `faff-parked`, `faff-claimed`, `faff-awaiting-review`, `faff-awaiting-spec-review`, `faff-repeat-parked`. Why excluded: none is a migration bridge; each has a live, load-bearing role. Extension point: `CONTROL_LABELS` in `labels.js`.
- **The `.faff/provenance` marker, `faff intake-record`, and the `initiated` audit field.** Why excluded: these are the *load-bearing* signals the labels only ever decorated; they stay. Extension point: `intake-provenance.js` (`intakeVerdict` marker branch, `initiatedOf`).
- **Making the control-label prefix configurable (FAFF-1044).** Why excluded: separate related ticket; orthogonal. Extension point: `labels.js` + `tracking.label_prefix`.
- **Bulk-rewriting Linear tickets to strip the now-inert label.** Why excluded: see the `**Chosen:**` on existing tickets in section 3 — a no-op is the decision, not an omission. Extension point: a future manual/one-off tracker sweep if the inert label ever becomes noise.

## 3. WHAT — Decisions

**Vocabulary:**

| Term | Definition |
|---|---|
| grandfathered-label basis | The `intakeVerdict` outcome when a ticket carries `faff-jot-intake` but has no marker; satisfied + `warn:true` |
| eligibility-gesture basis | The `intakeVerdict` outcome when a ticket carries `faff-automate` but has no marker; satisfied, no warn |
| load-bearing | A code path whose removal would change an observable outcome (block a build that previously proceeded, or vice versa) |

**Decision — the measurement, and why it does not gate the removal.**

The issue asks: are there open, non-terminal tickets whose intake rests on `faff-jot-intake` alone (no `.faff/provenance` marker, no `faff-automate`)? Measured against the live Faff Linear team (2026-09-13): **yes, several exist** — e.g. FAFF-1040, FAFF-866, FAFF-29, FAFF-20, FAFF-316, FAFF-1006, FAFF-1007, FAFF-451, FAFF-453, FAFF-449, FAFF-450, FAFF-28, FAFF-33 (all Backlog, `faff-jot-intake` without `faff-automate`), plus several more carrying `faff-automation-hold`. And `.faff/provenance/` markers are gitignored per-machine, so on any fresh checkout the marker basis is empty for every ticket.

Taken literally, that measurement says *keep the bridge*. But the literal question is the wrong gate. The `grandfathered-label` branch is **never load-bearing**, for three independent reasons:

1. **Autonomous builds never reach it via that basis.** The intake-provenance precondition in `faff-graft` runs *after* the eligibility gate (`faff-graft/SKILL.md`: "After the prep + eligibility gates and before Step 3"). To be autonomously eligible under the shipped `opt-in` default a ticket must carry `faff-automate`. So any ticket that reaches the autonomous intake check already has `faff-automate` → `eligibility-gesture`. A `faff-jot-intake`-only ticket is filtered out one gate earlier and never gets there. (A ticket carrying *both* labels resolves to `grandfathered-label` today only by precedence — removing the branch drops it to `eligibility-gesture`, still satisfied, and loses a spurious warn.)
2. **Interactive builds bypass.** `intakecheck --interactive` treats the human at the keyboard as the sanction; an unsatisfied verdict exits 0.
3. **This repo runs `intake_gate: warn`.** In `warn` mode an unsatisfied verdict never blocks — it prints guidance and exits 0. `block` is opt-in.

So removing the branch cannot turn any satisfied build into a blocked one, regardless of how many `faff-jot-intake`-only tickets exist. The migration window is closed in the only sense that matters: the bridge carries no traffic.

- **Chosen:** Retire `faff-jot-intake` — remove its `CONTROL_LABELS` entry, its `grandfathered-label` branch in `intakeVerdict`, and its selftest rows. Rationale: the branch is provably never load-bearing (reasons 1–3); the literal ticket count is a proxy the reachability analysis supersedes.

**Decision — the sibling label.**

`faff-chain-gap-fill` is grepped across the whole `bin/lib` tree and appears **only** in the `labels.js` manifest — it has no branch in `intakeVerdict` or anywhere else in the CLI. It is already purely cosmetic; its load-bearing signal is the `initiated: autonomous` audit field, which stays.

- **Chosen:** Retire `faff-chain-gap-fill` in the same change — remove its `CONTROL_LABELS` entry and its tag-on-create sites. Rationale: identical class to `faff-jot-intake`, already code-inert, and the issue forbids leaving one behind without justification. Retiring both keeps the manifest honest.

**Decision — the self-intake bucket ripple.**

The self-hosting-defect carve-out (`containment.self_hosting_intake`, default `false`) files an `outward-self-intake` item to "the `faff-jot-intake` bucket" (`faff-beep-boop` steps 4/5/§10, `config.js:108` comment, `autonomous.md`, `faff-graft` prose). The label there was always cosmetic — the real record is the `faff intake-record --via jot --initiated autonomous` stamp filed alongside it.

- **Chosen:** The self-intake carve-out files to **plain Backlog + the `faff intake-record` marker** (no label). Rationale: the marker is the load-bearing signal; dropping the cosmetic label leaves the lane's actual provenance intact. Update the naming in `config.js:108`, `faff-beep-boop`, `autonomous.md`, and `faff-graft` prose from "the faff-jot-intake bucket" to "the Backlog self-intake lane (recorded by the intake marker)".

**Decision — existing tickets carrying the retired labels.**

- **Chosen:** Leave the labels in place on existing tickets; do **not** sweep. Rationale: once removed from `CONTROL_LABELS`, `faff label remove` refuses the name (it validates against the manifest), so a sweep would require raw tracker writes across 100+ tickets — churn with no functional benefit, since the labels are inert once no code reads them and no site tags them. The labels become ordinary orphaned Linear labels a human can bulk-delete in the tracker UI in one gesture if they ever want to. Document this as intentional in the change, not an oversight.

**Interfaces touched (no signature changes):**

```
intakeVerdict(marker, labels, mode) -> { satisfied, basis, warn? }
  # AFTER: the labelSet.has("faff-jot-intake") branch is deleted.
  #   marker via present            -> { satisfied:true, basis:via }
  #   faff-automate present         -> { satisfied:true, basis:"eligibility-gesture" }
  #   neither                       -> { satisfied:false, basis:"no-provenance" }
  # The function shape, the "off" short-circuit, and precedence among survivors are unchanged.
```

## 4. HOW — Behaviour

**Architecture and approach.** This is a deletion across two pure Node modules plus a set of prose edits; no new abstraction. Order the work so the selftests bound it.

```
PROCEDURE retire_bridges:
  1. intake-provenance.js:
     a. Delete the `faff-jot-intake` branch in intakeVerdict (the two-line if returning grandfathered-label).
     b. Delete the three INTAKECHECK_SELFTEST_CASES rows referencing "faff-jot-intake"
        (grandfathered-label only; grandfathered-vs-eligibility precedence; malformed+label).
        The eligibility-gesture rows and the no-provenance rows STAY and now fully cover the label-less bases.
     c. Update the header comment (the "grandfathered forever" / basis-table prose) and the
        intakeGuidance() closing sentence that mentions the grandfathered label, so the prose
        no longer claims a basis the code no longer has.
     d. Run `faff intakecheck --selftest` and `faff intake-record --selftest` -> both PASS.
  2. labels.js: remove the `faff-jot-intake` and `faff-chain-gap-fill` entries from CONTROL_LABELS.
     Run `faff labels --names` -> the two names are gone; the other seven remain.
  3. Prose tag-on-create sites — remove ONLY the label tag + its `faff label add ... <retired-label>`
     line; KEEP every `faff intake-record ... --via jot [--initiated ...]` stamp:
       - faff-jot-intake:  faff-jot, faff-plot, faffter-noon-methodology-thematic, create.md
       - faff-chain-gap-fill: faff-tidy (Chain gaps), faff-beep-boop (steps 4/5/§10),
         faff-graft (Step 10 discovered-scope), faffter-noon-methodology-thematic,
         faffter-dark-methodology-agile-delivery
  4. Manifest recitals + convention lines — drop the two names from the enumerations in
     autonomous.md (Control-label provisioning + the machine-breadcrumb list), tracker.md
     (discovered-scope/chain-gap marker), methodology.md (control-label convention).
  5. Self-intake bucket ripple (Chosen above): reword config.js:108 comment, faff-beep-boop,
     autonomous.md, faff-graft prose from "faff-jot-intake bucket" to the Backlog + marker lane.
  6. Grep sweep: `grep -rn "faff-jot-intake\|faff-chain-gap-fill" plugin/ docs/` returns only
     intended historical/records references (records/specs, records/adr, verification/audits are
     historical and MUST NOT be edited — see Anti-pattern). No live prose or code remains.
```

**Anti-pattern:** editing `records/specs/*`, `records/adr/*`, or `verification/audits/*`. Why: those are historical records of what was built when; the repo convention (AGENTS.md → Product names) is to keep historical wording under the names used when written. Leave them.

**Anti-pattern:** removing a `faff intake-record --via jot` stamp when removing the label tag next to it. Why: the marker is the load-bearing provenance signal; the label was the cosmetic decoration. Removing the marker breaks the front-door guarantee the labels only ever hinted at.

**Anti-pattern:** attempting a `faff label remove <ticket> faff-jot-intake` sweep after removing the manifest entry. Why: `faff label` validates against `CONTROL_LABELS` and will refuse the now-unknown name; the sweep decision is "leave inert" regardless.

**Edge cases:**

- A ticket carrying both `faff-jot-intake` and `faff-automate` (many exist): after removal, `intakeVerdict` returns `eligibility-gesture` instead of `grandfathered-label` — still `satisfied`, and it *loses* the spurious `warn`. Strictly an improvement.
- A future repo that sets `intake_gate: block` and has a `faff-jot-intake`-only, `faff-automate`-absent, marker-absent ticket: that ticket is not autonomously eligible (no `faff-automate`), so it never reaches the autonomous block; an interactive build bypasses. If someone hand-runs a non-interactive `faff intakecheck` on it under `block`, it now exits 3 (`no-provenance`) instead of 0 (`grandfathered-label`). That is the intended tightening — a spoofable basis is gone — and the remedy (`intake-record --via backfill`, or set `faff-automate`) is already documented in `intakeGuidance`.

## Failure modes

- **The failure:** the reachability argument (branch never load-bearing) is wrong because some path reaches the intake precondition *without* passing the eligibility gate first. **How you'd know:** an autonomous build of a `faff-jot-intake`-only, `faff-automate`-absent ticket that previously proceeded now parks/blocks at the intake precondition. **What it means:** if observed, the eligibility gate is not the guaranteed predecessor assumed here — narrow the change to keep the branch. Grounding check before shipping: confirm in `faff-graft/SKILL.md` that the intake precondition is sequenced after the eligibility gate (it is, at the referenced line).
- **The failure:** a live consumer of `faff-chain-gap-fill` exists that the grep missed (e.g. a dynamic label read). **How you'd know:** `grep -rn "faff-chain-gap-fill" plugin/` after the change shows a live code reference, or a selftest fails. **What it means:** the label is not code-inert — surface it and keep the manifest entry for that consumer. (Current grep: only the manifest entry.)

## 5. Scenarios

```
Given the faff-jot-intake CONTROL_LABELS entry and its intakeVerdict branch are removed
When `faff intakecheck --selftest` runs
Then it reports PASS with the grandfathered-label rows removed and the eligibility-gesture/no-provenance rows still covering the label-less bases
```

```
Given a ticket carrying both faff-jot-intake and faff-automate, no provenance marker
When intakeVerdict evaluates it after the change
Then the basis is "eligibility-gesture" (satisfied, no warn), not "grandfathered-label"
```

```
Given both labels are retired from the manifest
When `faff labels --names` runs
Then faff-jot-intake and faff-chain-gap-fill are absent and the other seven control labels remain
```

- The full CLI test suite (`faff` unit rungs) passes after the change, with no reference to either retired label in live `plugin/` code or prose.

## 6. Design decision rationale

**Should the removal be gated on the literal deciding-question measurement?** Options: (a) keep the bridge because measured tickets still carry the label alone; (b) remove it because the branch is never load-bearing. Con of (a): it preserves a spoofable basis forever on a proxy signal, since gitignored per-machine markers mean the "label alone" set is never empty on a fresh checkout — the criterion can never be satisfied. **Chosen:** (b) — the reachability analysis is a stronger, checkable ground than the raw count. This is the one judgement the spec reframes relative to the issue's literal wording, which is why confidence is held at medium for human confirmation.

**Retire both, or just the one with a code branch?** Options: retire only `faff-jot-intake`; retire both. Con of retiring one: leaves an identical-class cosmetic label the issue explicitly flags, and the manifest keeps claiming a bridge that does nothing. **Chosen:** retire both — `faff-chain-gap-fill` is already code-inert, so its removal is pure manifest+prose hygiene.

**Sweep existing tickets, or leave the labels inert?** **Chosen:** leave inert — a sweep needs raw tracker writes across 100+ tickets (the CLI refuses a de-manifested name), churn with no functional payoff; a human can bulk-delete the orphaned Linear label in one UI gesture if desired.

## 7. Open questions and assumptions

**Open questions:** none blocking. The single reframed judgement (measurement-literal vs reachability) is recorded as a `**Chosen:**` with rationale in section 3, surfaced for human confirmation via the medium rating rather than left as a `**Punt:**`.

**Assumptions:**

- **Assumes:** the intake-provenance precondition in `faff-graft` is sequenced *after* the eligibility gate. Validation: confirm the ordering in `faff-graft/SKILL.md` (the "After the prep + eligibility gates and before Step 3" line) before deleting the branch.
- **Assumes:** `faff-chain-gap-fill` has no live code consumer beyond the manifest. Validation: `grep -rn "faff-chain-gap-fill" plugin/` shows only `labels.js` before the change.

## 8. DONE — Definition of Done

### From WHY
- [ ] No live `plugin/` code path or prose treats `faff-jot-intake` or `faff-chain-gap-fill` as a provenance/initiation basis; the only remaining mentions are historical records (`records/`, `verification/`) left untouched.

### From WHAT (decisions)
- [ ] `intakeVerdict`'s `faff-jot-intake` (`grandfathered-label`) branch is removed; the function's other bases and precedence are unchanged.
- [ ] `CONTROL_LABELS` in `labels.js` no longer contains `faff-jot-intake` or `faff-chain-gap-fill`; the other seven entries are intact.
- [ ] Every `faff intake-record ... --via jot` stamp at former tagging sites is retained (only the label tag is removed).
- [ ] The self-intake carve-out files to Backlog + the intake marker, and its prose no longer says "faff-jot-intake bucket".
- [ ] Existing tickets are left carrying the inert labels (no sweep); this is documented as intentional in the change.

### From HOW (behaviour)
- [ ] A ticket with both `faff-jot-intake` and `faff-automate` (no marker) resolves to `eligibility-gesture` (no warn).
- [ ] The three `faff-jot-intake` rows are removed from `INTAKECHECK_SELFTEST_CASES`; `faff intakecheck --selftest` and `faff intake-record --selftest` PASS.
- [ ] `faff labels --names` lists exactly the seven surviving control labels.

### From HOW (docs)
- [ ] The manifest recitals in `autonomous.md`, `tracker.md`, and the control-label convention in `methodology.md` no longer enumerate the two retired labels.

### Integration smoke test
```
1. Run `faff intakecheck --selftest`            -> RESULT: PASS
2. Run `faff intake-record --selftest`          -> RESULT: PASS
3. Run `faff labels --names`                     -> seven names, neither retired label present
4. grep -rn "faff-jot-intake\|faff-chain-gap-fill" plugin/  -> no live references (records/ untouched)
5. Run the faff CLI unit suite                   -> green
```

confidence: medium