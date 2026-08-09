# FAFF-535 — PRD-greedy sibling-drain ordering

> Spec: faffter-dark-nlspec · 2026-07-17 · autonomous · confidence: medium. Full spec on Linear FAFF-535.

This spec defines the PRD-distance signal and its composition into the build ordering for FAFF-535: sequence an L4 drain toward the sibling PRDR whose completion most advances the parent PRD. Audience: the build agent implementing it, and human reviewers of the design.

## 1. WHY — Problem and Principles

**The load-bearing model:** PRD satisfaction is already a pure roll-up (`prd_satisfied ⟺ coverage ∧ completion`, `computePrdCoverageVerdict` in `plugin/skills/faff/bin/lib/contract-defs.js`), computed from individually addressable sibling records (`{id, prd_goal, dod_verdict}`) — but only the *boolean* roll-up flows anywhere. This change exposes the per-sibling remainder as a new pure producer (`faff prdr distance`), rides it into the methodology envelope as an optional input, and lets the methodology use it as a within-band tiebreaker. Distance is *steps remaining in the pipeline*, not a judgement — the orchestration layer stays opinion-free; the methodology slot keeps sole ownership of ordering.

**Problem statement.** At L4 the loop drains *toward* PRD acceptance (coverage gates in `run-start`, the roll-up terminator in `run-done`) but the pick-ordering is PRD-blind: the methodology orders by value×risk×unlock (or priority+unlock), so after sibling PRDR A completes, the loop takes queue order rather than heading for the sibling B closest to closing the parent PRD. The fix: a per-sibling PRD-distance signal composed into — never replacing — the methodology's ordering.

**Design principles:**

**The orchestration layer holds no ordering opinion.** The gateway rule (SKILL.md → *Ordering & judgement delegation*) is inviolable: beep-boop assembles the distance input and hands it to the methodology; the ranking decision is the methodology's. An implementation that has beep-boop reorder the queue itself is invalid.

**Human-set priority bands are never crossed.** Distance is a within-band signal only. An implementation where a nearer-to-PRD issue jumps a higher human-priority issue is invalid.

**Absent ⇒ byte-identical.** No PRD in scope → the input is never assembled, the envelope is unchanged, and every methodology output is byte-identical to today. This is the acceptance requirement, not a nice-to-have.

**Report-only producer parity.** `faff prdr distance` follows the `admit`/`yagni`/`coverage` house pattern exactly: pure, no tracker/network, verdict in the payload never the exit code, belt-and-braces schema check.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/prdr.js` (~407–449) | JS | `coverage` action — the flag surface and producer pattern `distance` mirrors |
| `plugin/skills/faff/bin/lib/contract-defs.js` (~1392) | JS | `computePrdCoverageVerdict` — reused internally for the uncovered set; sibling pure-fn home |
| `plugin/skills/faff/SKILL.md` (Standard envelope, ~1053; contract table ~1031) | prose | The envelope this extends; `pick-ordering`/`build-queue` rows |
| `plugin/skills/faffter-noon-methodology-thematic/SKILL.md` | prose | Default lens — gains the tiebreaker composition |
| `plugin/skills/faffter-dark-methodology-agile-delivery/SKILL.md` | prose | Agile lens — composes distance with value×risk |
| `plugin/skills/faff-beep-boop/SKILL.md` (~203) | prose | Build-queue assembly — the input-assembly call site |
| `plugin/skills/faff/bin/lib/run-start.js`, `run-done.js` | JS | Untouched — gates/terminator consume booleans only, before and after |

**Scope statement.** This sits between the existing PRD/PRDR machinery (FAFF-252/245/257) and the methodology ordering slot: one new CLI producer, one additive envelope input, composition prose in two lenses, one assembly step in beep-boop.

## 2. OUT OF SCOPE

- **Within-run convergence default** — whether sibling B's freshly-planned tickets drain in the *same* run is FAFF-534 (pairs-with, not part of this). Extension point: beep-boop wave re-entry prose.
- **Numeric criteria-counting distance** — a finer metric counting unmet DoD criteria per PRDR needs PRDR-DoD criterion enumeration (the `faff dod split/classify` surface in `admissibility.js` operates on *spec* text, not PRDR DoD sections). Extension point: `computePrdDistance` in `contract-defs.js` — add a `criteria` refinement field beside `distance_class`; the class ladder stays the coarse fallback.
- **Run-start planning order** (which uncovered goal to plan first) — `run-start`'s `plan` verdict and `/faff-plot --autonomous` are untouched; distance only reorders the *build* queue. Extension point: the same `faff prdr distance` output already lists uncovered goals; a future ticket can feed it to the planner.
- **Weakening any gate** — `run-done`'s roll-up terminator, coverage/decomposition gates, admission verdicts: all untouched by construction (no code change in `run-start.js`/`run-done.js`).
- **Cross-PRD ordering** — multiple concurrent parent PRDs in one run; v1 assumes the single resolved target PRD that L4 run-start already establishes. Extension point: key the distance map by PRD id.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Sibling | A live (non-superseded) PRDR under the parent PRD's scope; each cites one PRD goal and one container |
| Distance class | The coarse steps-remaining bucket of a sibling or uncovered goal (see ladder) |
| Distance map | The full `faff prdr distance` output — the artifact beep-boop hands the methodology |
| Within-band | Among issues whose (inherited) human-set priority is equal — the only region distance may reorder |

**The producer surface.** Two candidates: extend `prdr coverage` with per-sibling output, or add a sibling action. Extending coverage means changing the `prd-coverage` contract schema that `run-start`, `prdr admit --lower`, and `faff contract prd-coverage` already consume — a consumer-visible mutation for a purely additive need. A new action leaves every existing consumer untouched.
**Chosen:** a new `faff prdr distance` action in `cmdPrdr` (`prdr.js`), flag-for-flag mirroring `coverage` (`--prd-goals`, `--live-prdrs` | filesystem read with `--container` filter, `--dod-verdicts`, `--root`), backed by a new pure `computePrdDistance` in `contract-defs.js` that calls `computePrdCoverageVerdict` internally for the uncovered set.

**The v1 distance metric.** Distance = count of remaining pipeline stages to a `met` DoD, as a class ladder:

```
ENUM DistanceClass:                      # class_rank — lower = nearer to advancing the PRD
  met         = 0    # dod_verdict === "met": done; excluded from ordering, kept for observability
  unverified  = 1    # live PRDR, no dod_verdict: possibly built — one evaluation from met
  unmet       = 2    # live PRDR, dod_verdict present but ≠ "met": known gap — fix + re-evaluate
  uncovered   = 3    # PRD goal with NO live PRDR: plan + build + evaluate — furthest
```

`unverified` ranks nearer than `unmet` because it may need only an evaluation pass, while `unmet` is a confirmed defect needing work *and* re-evaluation; `uncovered` needs the whole pipeline. **Chosen:** the four-class steps-remaining ladder above as the v1 metric.

Within a class, the producer emits entries in stable id order (goal text order for `uncovered`) as a deterministic baseline, but intra-class ordering is delegated to the methodology — with one-goal-one-PRDR coverage every uncovered goal reduces `uncovered_goals` equally, so there is no mechanical intra-class signal for the producer to express. Which uncovered goal, or which of two unmet siblings, goes first is the methodology's pick-ordering call within the class (the now-Chosen decision in §7); PRD-distance stays the primary key across classes.

**Output shape:**

```
RECORD PrdDistance:
  entries: List<Entry>                  # sorted by class_rank asc, then id/goal asc; immutable output
  prd_satisfied: Boolean                # echo of the coverage roll-up (observability, not a gate)
  conformant: true                      # belt-and-braces, house pattern
  violations: []

RECORD Entry:
  kind: "prdr" | "goal"                 # goal ⇒ an uncovered PRD goal (no PRDR exists)
  id: String | null                     # PRDR num for kind=prdr; null for kind=goal
  container: String | null              # PRDR's Container field; null for kind=goal
  prd_goal: String                      # the goal cited (kind=prdr) or the uncovered goal itself
  dod_verdict: String | null            # the FAFF-34 verdict as given; null when absent
  distance_class: DistanceClass
  class_rank: Integer                   # 0..3 per the ladder

  CONSTRAINT kind == "goal" ⟺ distance_class == "uncovered"
```

**Contract registration.** The sibling producers all register a contract and self-check. **Chosen:** register `prd-distance` in `CONTRACTS` (contract-defs.js) with a minimal schema (entries array, closed `distance_class` vocabulary, `class_rank` 0–3), self-checked via `schemaCheck` before print, pipeable to `faff contract prd-distance` — house parity; it is *not* consumed by any gate.

**The envelope extension (gateway contract edit).** The methodology *Standard envelope* (faff/SKILL.md ~1053) currently fixes five always-supplied inputs. **Chosen:** extend it with one **optional** caller-supplied input: `prd-distance` — the `faff prdr distance` output, supplied only when a PRD hierarchy is in scope. Two floor rules fixed at the gateway, binding every lens: (a) distance never reorders across human-set priority bands; (b) input absent ⇒ every output byte-identical to a distance-unaware lens. The `pick-ordering` and `build-queue` contract rows each gain a one-line note naming the optional input.

**Composition mode.** **Chosen:** the committed default composition, documented in both lenses, is a *within-band* one: among same-band independents, each lens weights `class_rank` against its own signals (agile: value×risk×unlock) so nearer-to-PRD issues order sooner; `met` (rank 0) and unmapped issues are neutral (existing order preserved — note `met` is *excluded from preference*, not promoted). Stable-sort by `class_rank` is the deterministic fallback only where the lens expresses no preference — lens freedom above the floor, per the ordering-delegation rule.

**Issue↔sibling mapping.** **Chosen:** by container — an issue's project container matched to `Entry.container` with `adrSlug` normalisation (the exact matching `prdr list --container` already uses, prdr.js ~262). Issues whose container matches no entry are neutral. **Assumes:** project containers and PRDR `Container` fields share the slug vocabulary — validated by checking `faff prdr list --json` containers against the tracker's project names before relying on the mapping (the L4 planner already writes PRDRs keyed this way).

**Assembler.** **Chosen:** faff-beep-boop assembles the input — at build-queue assembly (SKILL.md step ~203) and at each wave re-entry — *only when* the run's `run-start` verdict resolved a target PRD (`drain / prd-covered` at L4). One `faff prdr distance` call per wave boundary, output attached to the methodology's batched dispatch alongside the existing envelope inputs. No PRD in scope → no call, no input, byte-identical dispatch. **Assumes:** the FAFF-34 evaluator's per-PRDR verdicts are available to beep-boop as the same `--dod-verdicts` map the coverage call site already assembles; when absent, every sibling classifies `unverified` — degraded but honest (validation: the coverage call in the same wave already sources this map; reuse it verbatim).

## 4. HOW — Behavior

**Approach.** Three layers, strictly additive: (1) CLI producer — `prdr.js` gains the `distance` action + `contract-defs.js` gains `computePrdDistance` and the `prd-distance` contract; (2) prose contract — gateway envelope + two lens SKILL.mds + beep-boop assembly step; (3) nothing else — no run-start/run-done/project-next code changes.

**The producer** — classify each live sibling, then append uncovered goals:

```
PROCEDURE computePrdDistance({ prdGoals, livePrdrs }):
  1. cov = computePrdCoverageVerdict({ prdGoals, livePrdrs })     # reuse — one classifier, no fork
  2. FOR each p in livePrdrs (filtered to well-formed objects, as coverage does):
     a. class = "met"        IF p.dod_verdict === "met"           # literal match, coverage parity
     b. class = "unmet"      IF p.dod_verdict present AND ≠ "met"
     c. class = "unverified" IF p.dod_verdict absent/undefined
     d. emit { kind:"prdr", id, container, prd_goal, dod_verdict ?? null, distance_class: class, class_rank }
  3. FOR each g in cov.uncovered_goals:
     emit { kind:"goal", id:null, container:null, prd_goal:g, dod_verdict:null, distance_class:"uncovered", class_rank:3 }
  4. Sort entries by (class_rank, id ?? prd_goal) — stable, deterministic
  5. RETURN { entries, prd_satisfied: cov.satisfied, conformant:true, violations:[] }
```

The `cmdPrdr` action parses flags exactly as `coverage` does (same JSON parse errors, exit 2 on malformed input, `--dod-verdicts` merge onto `livePrdrs` by id, filesystem fallback with `--container` filter and live filter), schema-checks the verdict, prints JSON, exits 0 — report-only.

**Anti-pattern:** deriving the uncovered set with fresh logic in `computePrdDistance`. Why: two classifiers drift; `computePrdCoverageVerdict` is the single source of coverage truth (its dedup and prospective-live-set semantics come free).

**The methodology tiebreaker** (prose in each lens, stated once here as the shared mechanic):

```
PROCEDURE compose_distance(ordered_issues, distance_map):     # runs only when the input is present
  1. Partition ordered_issues into contiguous human-priority bands (existing lens behaviour)
  2. WITHIN each band, stable-sort by container's class_rank:
     a. rank = min class_rank of entries whose container slug-matches the issue's container
     b. no match, OR rank == 0 (met) → neutral: keep the issue's existing relative position
  3. NEVER move an issue across a band boundary
```

Stable sort + neutral-preserves-position is what makes "absent ⇒ byte-identical" hold trivially: with no input, step 2 never runs.

**Beep-boop assembly:** at build-queue assembly and wave re-entry, IF the run holds a resolved target PRD: run `faff prdr distance --prd-goals <PRD goals> --dod-verdicts <the wave's FAFF-34 map>`, attach the JSON to the methodology batch dispatch as the `prd-distance` input. ELSE: dispatch exactly as today.

**Edge cases:**

- Empty PRD (no goals) + no siblings → `entries: []`, `prd_satisfied: true` — the methodology gets an empty map, everything neutral.
- Malformed `--prd-goals` / `--live-prdrs` / `--dod-verdicts` JSON → exit 2 with the same messages as `coverage` (copy the guards). Beep-boop treats a non-zero exit as *input absent* (byte-identical dispatch) and logs it — a broken distance call must never stall the drain.
- A sibling with a `dod_verdict` outside the known vocabulary (e.g. `"partial"`) → `unmet` (present-and-not-met), matching coverage's conservative literal-`"met"` rule.
- Duplicate goals in `--prd-goals` → deduped by the reused coverage classifier; entries never duplicate.
- Every sibling `met` but goals uncovered → the uncovered goals are the only ranked entries; ordering still points at the remaining gap.

**Failure modes:**

- **The failure:** the class ladder misorders in practice — `unmet` siblings routinely complete faster than `unverified` ones. **How you'd know:** run summaries at L4 show drains where the distance-first order finished *later* than queue order would have. **What it means:** narrow — swap ranks 1↔2 or move to the punted criteria-count metric; the producer seam localises the change to one enum.
- **The failure:** container mapping silently never matches (slug vocabulary drift), so distance is assembled but always neutral — the feature no-ops invisibly. **How you'd know:** the distance map's containers ∩ queue containers is empty in a run where siblings exist; surface this as a one-line note in the beep-boop run summary when the input was supplied but zero issues matched. **What it means:** proceed with a mapping fix — the note is the tripwire; the DONE list requires it.

**Anti-pattern:** letting beep-boop apply the tiebreaker itself "since it already has the map". Why: it breaches the ordering-delegation rule; the map is an *input*, the ordering is the methodology's answer.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a PRD with goals [g1, g2, g3] and live PRDRs: A {g1, dod_verdict: "met"},
      B {g2, no dod_verdict}, and no PRDR citing g3
When faff prdr distance runs with those inputs
Then entries are ordered [A (met, rank 0), B (unverified, rank 1), g3 (uncovered, rank 3)]
     — class_rank ascending; the first actionable (rank > 0) entry is B; prd_satisfied is false
```

```
Given a build queue of same-priority-band independents [X in container cB, Y in container cC],
      ordered [Y, X] by the lens's own rule, and a distance map where cB is unverified (rank 1)
      and cC is uncovered (rank 3)
When the methodology answers build-queue with the prd-distance input present
Then the order is [X, Y] — the nearer sibling's issue first, within the band
```

- With no PRD in scope, the beep-boop methodology dispatch and every ordering output MUST be byte-identical to a run without this change.
- An issue in a higher human-priority band MUST never be displaced by a lower-band issue regardless of distance classes.

## 6. Design Decision Rationale

- **New action or extend coverage?** Extending mutates the `prd-coverage` schema three consumers read; a sibling action is consumer-invisible. **Chosen:** new `faff prdr distance` action — additive, zero blast radius; coverage reused internally so there is one classifier.
- **What distance metric for v1?** Numeric criteria-counting needs PRDR-DoD enumeration that doesn't exist; a class ladder needs nothing new. **Chosen:** the four-class steps-remaining ladder (met 0 / unverified 1 / unmet 2 / uncovered 3).
- **Contract-register the output?** Not gate-consumed, but every sibling producer self-checks. **Chosen:** register `prd-distance` + `schemaCheck` — fail-loud parity is cheap and keeps `faff contract` complete.
- **Where does the input enter the methodology?** A new named-output would fork the ordering answer; a new envelope input keeps one ordering seam. **Chosen:** optional Standard-envelope input with a two-rule gateway floor (bands uncrossable; absent ⇒ byte-identical).
- **Tiebreaker or weighted signal?** A fixed weighting at the gateway would be an orchestration-layer opinion. **Chosen:** gateway fixes only the floor; the committed default composition delegates within-band ordering to the lens's own weighting, with stable-sort by class_rank as the deterministic fallback.
- **Who assembles, when?** **Chosen:** beep-boop, once per wave boundary (assembly + re-entry), only under a resolved target PRD.
- **How do queue issues map to siblings?** **Chosen:** container slug-match via `adrSlug`, unmatched ⇒ neutral.

## 7. Open Questions and Assumptions

**Open questions:**

- **Chosen:** intra-class ordering — with two `unmet` siblings, or several `uncovered` goals, ordering falls through to the methodology's pick-ordering (value×risk×unlock). PRD-distance is the primary sort key across classes; the methodology is the secondary key within a class; stable id/text order remains the final deterministic tiebreak when the methodology expresses no preference. Resolved by human decision 2026-07-17 (fall through to methodology within a class).

**Assumptions:**

- **Assumes:** project containers and PRDR `Container` fields share the slug vocabulary. Validate before building the mapping.
- **Assumes:** the per-PRDR `--dod-verdicts` map beep-boop feeds `coverage` at the wave boundary is reusable verbatim for the `distance` call. Absent map ⇒ all-`unverified` classification is the accepted degraded mode.

## 8. DONE — Definition of Done

### From WHAT (producer)
- [ ] `faff prdr distance` exists in `cmdPrdr` with the `coverage` flag surface (`--prd-goals`, `--live-prdrs`, `--container`, `--dod-verdicts`), exit 2 on malformed JSON, exit 0 report-only
- [ ] Output matches the `PrdDistance` record: entries sorted `(class_rank, id|goal)`, closed `distance_class` vocabulary, `prd_satisfied` echo
- [ ] `computePrdDistance` derives the uncovered set via `computePrdCoverageVerdict` (no second classifier)
- [ ] `prd-distance` registered in `CONTRACTS`; producer self-checks via `schemaCheck`; `faff contract prd-distance` validates a piped block

### From WHAT (contract prose)
- [ ] Gateway *Standard envelope* names the optional `prd-distance` input with both floor rules (bands uncrossable; absent ⇒ byte-identical); `pick-ordering` + `build-queue` rows note it
- [ ] Thematic and agile lens SKILL.mds each document the within-band composition (tiebreaker default; agile may weight within-band); `faff validate-adapters` passes

### From HOW (behaviour)
- [ ] Sibling classes: `met` ↦ 0, absent verdict ↦ `unverified` 1, present-non-met (including unknown strings) ↦ `unmet` 2, uncovered goal ↦ `goal` entry rank 3
- [ ] Beep-boop assembles the input only under a resolved target PRD, once per wave boundary; a failed distance call degrades to input-absent and is logged, never stalls the drain
- [ ] Beep-boop run summary notes when a supplied distance map matched zero queue containers (the silent-no-op tripwire)
- [ ] `run-start.js`, `run-done.js`, `project-next.js` have zero diff

### From HOW (edge cases)
- [ ] Empty PRD → `entries: []`, `prd_satisfied: true`; duplicate goals deduped; met-only-with-uncovered emits only ranked gaps

### From Scenarios
- [ ] `prdrSelftest` rows cover: the class ladder ordering, dod-verdict merge, uncovered-goal entries, empty-PRD, sort determinism, schema conformance
- [ ] An ordering fixture shows a same-band queue reordered nearer-sibling-first with the map present, and byte-identical output with it absent

**Integration smoke test:**

```
1. Seed docs/prdr with siblings A (accept + dod met), B (no verdict), PRD goals g1..g3 (g3 uncovered)
2. faff prdr distance --prd-goals '["g1","g2","g3"]' --dod-verdicts '{"0001":"met"}'
3. ASSERT entries are [A rank 0, B rank 1, g3 rank 3] (first actionable entry is B/unverified), prd_satisfied false
4. Pipe the block to faff contract prd-distance → conformant
```

confidence: high
spec-review: approve
