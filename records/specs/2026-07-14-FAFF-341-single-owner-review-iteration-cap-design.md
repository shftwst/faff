# Single-owner the review-iteration cap

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-341.

This spec is for the build agent and human reviewers. It removes a latent drift: two places state how many review→fix→review cycles the pipeline attempts before it escalates to `needs-human`, and at the shipped `appetite: high` they disagree. The fix gives that bound exactly one owner and makes every other caller read from it.

## 1. WHY — Problem and Principles

**The load-bearing model.** The review→fix→review loop bound is an *appetite dial*: how much rope the pipeline gets before it stops iterating and asks a human. faff already frames it that way — the `review` slot's Appetite integration table (`faffter-noon-review/SKILL.md:143`) scales it 1 / 3 / 5 / 10 across `low` / `medium` / `high` / `full`. An appetite dial has one legitimate home: the slot whose behaviour it dials.

**Problem statement.** `faff-graft/SKILL.md:477` hardcodes "cap at 3 iterations" for the same loop, while the `review` slot's table says 5 at the shipped `appetite: high`. Whichever number is intended, the other is dead prose, and a swapped review occupant inherits the ambiguity. This change makes the `review` slot's appetite-scaled bound the single owner and makes graft defer to it instead of carrying its own literal.

**Design principles.**

- **One literal, one home.** The bound's numeric values must live in exactly one place. Moving graft from `3` to an inline `1/3/5/10` table would not fix the drift — it would duplicate the whole table into graft. The only drift-proof shape is a single machine-readable source both graft and the reviewer prose derive from. This is faff's *deterministic-tools-over-prose* tenet: a same-input-same-output lookup belongs in a tool, not restated prose.
- **Defer, don't relocate.** graft must not become the new owner. It resolves the bound at runtime; it never states a per-appetite value.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-review/SKILL.md` | Markdown (skill prose) | The `review` slot's Appetite integration table — the canonical persistence policy (1/3/5/10). |
| `plugin/skills/faff-graft/SKILL.md` | Markdown (skill prose) | Step 9 review loop, line ~477 — the hardcoded `cap at 3 iterations` this change removes. |
| `plugin/skills/faff/bin/faff` (+ `lib/`) | Node (dependency-free) | Hosts the sibling appetite/config resolvers (`faff eligible`, `faff models build-for`, `faff spec-review-lenses`) this new resolver mirrors. |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` | Markdown (skill prose) | The *configured* `review` occupant; its Phase 1 delegates to `faffter-noon-review`, so it inherits the table — no separate cap of its own. |

**Scope statement.** This sits at the faff-graft ↔ `review`-slot seam: it relocates ownership of one existing bound, adding no new pipeline behaviour.

## 2. OUT OF SCOPE

- **A generic "occupant emits its own cap" contract** — Why excluded: both currently-shippable `review` occupants (the `faffter-noon-review` default and `faffter-dark-adversarial-review`, whose Phase 1 delegates to it) share the same Appetite integration table, so resolving through that table *is* "the configured occupant's cap" for v1. A future occupant with a genuinely different persistence policy would need to surface its own bound. Extension point: the `review-verdict` contract or a new queryable the occupant emits, consumed by the resolver in place of the hardcoded table.
- **Changing the cap values themselves** — Why excluded: 1/3/5/10 is the shipped policy; this change preserves it exactly and only relocates ownership. Extension point: the resolver's table + `--selftest`.
- **Widening the change to other appetite-scaled knobs** (scope strictness, human-judgement threshold in the same table) — Why excluded: they are not duplicated in graft, so they have no drift to fix. Extension point: the same resolver family if a second consumer ever appears.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| review-iteration cap | The maximum number of review→fix→review cycles the pipeline attempts before escalating to `needs-human`. |
| persistence | The `review` slot's own framing for this dial: how many cycles it keeps trying (`faffter-noon-review/SKILL.md:145`). |

**The resolver interface.** A new deterministic subcommand on the bundled `faff` CLI, mirroring `faff models build-for <conf>`:

```
COMMAND faff review-iteration-cap --appetite <low|medium|high|full>
  stdout: the integer cap for that appetite (low→1, medium→3, high→5, full→10)
  exit 0: resolved
  exit 2: usage error — unrecognised/absent appetite (fail-loud, names the legal set); prints nothing to stdout
  --selftest: runs the full appetite→cap table (parity with sibling resolvers)
```

- The four-entry map is the **single authoritative source** of the cap literals.
- Pure function: no tracker, no network, no file writes (parity with `eligible` / `next` / `models build-for`).

**Design decision — where the literal lives.**

- Option A — resolver holds the literals; graft and the reviewer prose both derive from it. Pro: one machine source, drift-proof, idiomatic. Con: one new (tiny) subcommand.
- Option B — pure-prose deference: graft prose points at the reviewer's table, no CLI. Pro: no new code. Con: graft's runtime loop still needs the *number*; a prose pointer leaves it derivable only by an agent reading another skill file — a load-bearing cross-file prose coupling and exactly the drift class this ticket kills.
- Option C — graft resolves `appetite` and applies an inline 1/3/5/10 mapping. Con: relocates the entire table into graft, duplicating (not de-duplicating) the literals — strictly worse.

**Chosen:** Option A — a `faff review-iteration-cap` resolver holds the single literal source; graft consumes it. Rationale: it is the only shape that leaves exactly one authoritative number while giving graft's runtime loop a deterministic value, and it matches the five existing sibling resolvers rather than inventing a mechanism.

## 4. HOW — Behavior

**Ownership relocation, three coordinated edits:**

1. **New resolver (`plugin/skills/faff/bin/faff` + `lib/`).** Add `review-iteration-cap` per the interface above, with its appetite→cap table as the authoritative literal source and a `--selftest` covering all four appetites plus the fail-loud path.

2. **graft defers (`faff-graft/SKILL.md` Step 9, ~line 477).** Replace the hardcoded "cap at 3 iterations; if still `fail` after 3, treat as `needs-human`" with a resolve-then-loop:

```
PROCEDURE graft_review_loop(diff, spec):
  1. appetite := `faff config get appetite`            # already available to graft
  2. cap := `faff review-iteration-cap --appetite <appetite>`
  3. iterations := 0
  4. LOOP:
     a. verdict := run review (pre-PR, no PR open)
     b. IF verdict == pass    -> proceed to Step 9b (open PR)
     c. IF verdict == needs-human -> park per shared protocol, no PR
     d. IF verdict == fail:
        i.   iterations += 1
        ii.  IF iterations >= cap -> treat as needs-human (park, no PR)
        iii. ELSE fix flagged items, re-run tests, re-run review; continue LOOP
```

The prose states the bound as "the `review` slot's appetite-scaled iteration cap (resolved via `faff review-iteration-cap`)" — it names **no** per-appetite integer.

3. **Reviewer prose stays canonical, points at the resolver (`faffter-noon-review/SKILL.md` Appetite integration).** The Appetite integration table remains the human-readable statement of the policy; annotate the "Review→fix→review iterations before escalation" row as materialized by `faff review-iteration-cap` (the machine form graft consumes), so a reader knows the resolver is the runtime authority and the two cannot silently diverge.

**Anti-pattern:** re-stating a per-appetite integer in `faff-graft/SKILL.md`. Why: that recreates the exact drift this ticket removes — graft must resolve, never state, the cap.

**Failure mode — the two representations drift again.** The failure: the resolver's table and the reviewer prose row fall out of sync after a future edit. How you'd know: the resolver `--selftest` asserts the canonical four values, and an adapter/prose check (or a `node --test` case) asserts graft carries no bare per-appetite cap literal. What it means: the guard fails loud in CI; proceed only when both agree.

## Scenarios

```
Given appetite is configured `high` (the shipped default)
When graft runs its Step 9 review loop and review keeps returning `fail`
Then it attempts up to 5 review→fix→review cycles before escalating to needs-human
  (the `review` slot's high row), never the previously-hardcoded 3
```

```
Assertion: `faff-graft/SKILL.md` contains no bare per-appetite review-iteration integer;
the only cap source is `faff review-iteration-cap`.
```

## 6. DESIGN DECISION RATIONALE

**Which layer owns the review-iteration cap?**

- The `review` slot (its appetite-scaled persistence table) vs faff-graft (a hardcoded literal).
- graft is a *consumer* of the review verdict; persistence is a property of *reviewing*, which the slot's own prose already frames as an appetite dial. Ownership at graft is why the drift arose.
- **Chosen:** the `review` slot owns the cap; graft defers. — Matches the issue's recommendation and the slot's own framing.

**How does graft consume a slot-owned bound without re-stating it?**

- Prose pointer (Option B) vs inline table (Option C) vs deterministic resolver (Option A).
- **Chosen:** a `faff review-iteration-cap` resolver as the single literal source. — The only drift-proof, runtime-consumable, idiom-matching shape (see WHAT).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the owner is settled (issue recommendation, accepted) and the mechanism is chosen.

**Assumptions:**

- **Assumes:** graft already has the run's `appetite` available (it is a standard `faff config get appetite` read). Validation: confirm graft/beep-boop resolves `appetite` before Step 9 (it does for other appetite-gated behaviour); if not, add the single `faff config get appetite` read in the loop.
- **Assumes:** the bundled `faff` CLI is the right home for the resolver (parity with `models build-for`). Validation: confirm `lib/` exposes the sibling resolvers' pattern and reuse it.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff-graft/SKILL.md` no longer states any per-appetite review-iteration integer; the review-loop bound is described as the `review` slot's appetite-scaled cap.

### From WHAT (interface)
- [ ] `faff review-iteration-cap --appetite <low|medium|high|full>` prints `1|3|5|10` respectively on stdout, exit 0.
- [ ] An unrecognised/absent `--appetite` exits 2, names the legal set, prints nothing to stdout.
- [ ] `faff review-iteration-cap --selftest` runs the full appetite→cap table and passes.

### From HOW (behaviour)
- [ ] graft's Step 9 loop resolves `cap` via `faff review-iteration-cap` from the configured `appetite` and escalates to `needs-human` once `iterations >= cap`.
- [ ] At `appetite: high`, the loop attempts 5 cycles before escalating (not 3).
- [ ] `faffter-noon-review`'s Appetite integration row is annotated as materialized by `faff review-iteration-cap`.

### From HOW (drift guard)
- [ ] A CI-reachable check (resolver `--selftest` + a `node --test`/adapter assertion) fails loud if graft reintroduces a bare cap literal or the reviewer row and resolver disagree.

**Integration smoke test:**

```
1. Set appetite: high in .faffrc
2. Run `faff review-iteration-cap --appetite high` -> prints 5
3. Grep faff-graft/SKILL.md for a bare review-loop integer cap -> none
```

## Methodology critique

*Lens: agile-delivery (`faffter-dark-methodology-agile-delivery`).*

- **Right-sized?** Yes — a single 1–3 day unit (one small CLI resolver + two coordinated prose edits + a drift-guard test). One cohesive concern (single-owner one bound); not splittable, no always-ships-together sibling to merge.
- **Workstream fit?** Yes — a coherence/drift fix from the FAFF-323 whole-system audit (finding R3), carrying `faff-chain-gap-fill`. Cohesive with the review-slot ↔ graft seam.
- **Deps surfaced?** No missing edge — no blockers, independent of other in-flight work; related-to FAFF-323 (the audit source) only.
- **Risk profile?** Low — mechanical relocation of an existing literal, no novel integration or external dependency. No de-risking spike warranted.

confidence: high
spec-review: approve
