# FAFF-1009: Wire the seven un-wired decision-capture kernels in two tiers (complete FAFF-989's runtime join)

> Spec: faffter-dark-nlspec · 2026-09-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1009.

> Revised 2026-09-05 (v2): folds in the human's mint-and-silence decision for the two rollups (now a two-tier resolution across all seven un-wired kernels), pulls the capture-wiring lint into scope as the decidable oracle, and closes the round-1 spec-review objections. Supersedes the v1 spec above it in this thread.

> Revised 2026-09-05 (v3): round-2 spec-review `revise` fixes: DONE item 1 reworded off a runtime guarantee to the decidable presence form, the lint adjacency window pinned to a concrete number, and the kernel-set derivation made brace-aware so the multi-line `captureDecision({` form is not missed.

This spec turns FAFF-1009 (a bug: seven of nine decision-capture kernels ship un-wired and emit an empty `correlation_id`, so their base records are ungradeable and log a degraded note every run) into a buildable change. The audience is the build agent that edits the skill prose and adds the lint plus tests, and the human reviewer. It is a direct follow-up to FAFF-989, which wired the `next`/`eligible` pair and left the rest. The v1 spec was reviewed `reject-approach`; two human decisions (mint-and-silence for the two rollups, and pulling the capture-wiring lint into scope) are folded in below, and the round-1 objections are closed.

## 1. WHY: problem and principles

**The model this turns on.** Shadow-fidelity grades a coordination decision by joining two records written at different moments. A *base record* is minted inside the kernel CLI the instant a decision kernel computes its verdict; it carries the kernel's inputs, its verdict, and a `correlation_id` join key, but no chosen action, because the kernel cannot see what the orchestrator does next. An *action marker* is written later by the orchestrator, once the downstream action is known, quoting the same `correlation_id`. The grader (`analyzeCorpus` in `plugin/skills/faff/bin/lib/shadow-fidelity.js`) indexes markers by `correlation_id`, joins each base to its marker, replays the kernel over the captured inputs, and compares the replayed verdict against the action actually taken. A base whose `correlation_id` is empty joins nothing: it lands in `action_uncaptured` and grades nothing, and the kernel logs a degraded note saying so. Everything below turns on making that join happen at the call sites where it currently does not, and on silencing the degraded note where a join is not wanted.

**Problem statement.** With `capture.decision_kernel: "on"`, all nine decision-capture call sites mint a base record in-kernel, but only two (`next`, `eligible`) have the orchestrator prose that sets `FAFF_DECISION_CORRELATION_ID` before the consult. The other seven read an empty `correlation_id`, so each logs the degraded note that its base has an empty id and no marker can join it (`decision-capture.js:459-461`). This change wires all seven, in two tiers: five gain the full driver so their captures become joinable graded records, and two (the rollups with no downstream action) gain an id-minting `decide --export` only, so they land `action_uncaptured` cleanly with the degraded note silenced.

**Two tiers, one root cause.** The seven split by whether a single gradeable downstream action exists:

| Tier | Kernels | Wiring | Result |
|---|---|---|---|
| Tier 1 (full) | `claim-verdict`, `park-verdict`, `run-start`, `run-outward`, `run-done` | `decide --export` + kernel consult + `action` marker | Joinable, graded records |
| Tier 2 (id-only, mint-and-silence) | `queue-state`, `project-next` | `decide --export` only, issue `__run__`, no `action` marker | Minted id, `action_uncaptured` by design, empty-id note silenced |

Tier 2 is a settled human decision. A `correlation_id` minted whether or not a downstream consumer exists is an ordinary middleware pattern, not a surprising state: it clears the every-run degraded-note noise without inventing a fake action and without reversing the FAFF-956 empty-id append contract. Tier 2 touches the `KERNEL_REGISTRY` intent FAFF-989 reserved for a future rollup action, so the two carry an id but remain deliberately `action_uncaptured` (no consumer); this does not change how an empty id is treated by the append gate, because after this change these two no longer emit an empty id at all.

**The join key has exactly one runtime source.** A non-empty `correlation_id` at capture time comes only from `FAFF_DECISION_CORRELATION_ID`, read at `decision-capture.js:452`. The only thing that sets it is `faff decision-capture decide --export`, and the only thing that writes an action marker is `faff decision-capture action`. Both are prose instructions to the orchestrator in `SKILL.md` files; there is no code path that supplies the id or the marker on its own.

**Substrate-presence gates capture, not the run level.** `captureDecision` no-ops unless `FAFF_RUN_DIR` is set and points at a real run dir (`decision-capture.js:443,451`). Wiring must key off substrate presence, so it fires under both an L4 lights-out run and a plain L3 self-drain (both export `FAFF_RUN_DIR`), and stays inert in a standalone interactive tidy that has no run dir. Keying off `if L4` or `if autonomous` would miss the L3 self-drain and re-introduce the same gap.

**Derive the id once, reuse it; never interpolate it twice.** FAFF-989 records the failure mode at `decision-capture.js:533-550`: if the base id and the marker id are formed by two independent interpolations that disagree, both records exist but never join. The `action` verb defends against this by preferring the exact `FAFF_DECISION_CORRELATION_ID` the base was minted with (`decision-capture.js:541-545`) over any re-derivation. Wiring must co-locate `decide --export` with its kernel call in the same shell context so the marker reuses the exported id.

**`--export` output is shell-safe by construction.** The `decide --export` verb single-quotes both exported values, escaping any embedded single quote as `'\''` (`decision-capture.js:513-517`). A third-party-controlled issue id (for example the tracker-sourced id passed to `claim-verdict`/`park-verdict`) therefore cannot break out of the `eval "$(...)"` and inject shell. This guarantee is why the wiring can safely `eval` the export at each site; the wiring must not reconstruct the export string by hand and bypass the quoting.

**Capture is best-effort and never gates.** Every capture call must exit 0 and must not branch the kernel's own control flow: a disabled gate, a missing run dir, or a degraded note is a side effect only (`decision-capture.js:490-491`). This is the FAFF-956 authority-inert contract and the wiring must preserve it.

Reference context:

| System | Location | Relevance |
|---|---|---|
| In-kernel capture hook | `decision-capture.js:440-486` | Mints the base; reads `FAFF_DECISION_CORRELATION_ID` at line 452; empty-id note at 459-461 |
| `decide`/`action` driver verbs | `decision-capture.js:504-522` (decide, generic over `--kernel`), `529-559` (action) | Export quoting at 513-517; id-reuse precedence at 541-545 |
| Grader and replay adapters | `shadow-fidelity.js` (`REPLAY_ADAPTERS` at 154, divergence map 200-211) | All nine kernels have a replay adapter; joins graded here |
| Existing wiring prose (`next`/`eligible`) | `faff-beep-boop/SKILL.md:210-213` | The one documented driver pattern to refer back to |
| Tidy consults | `faff-tidy/SKILL.md:296` (`claim-verdict`), `:283` (`park-verdict`), `:221` (`project-next`) | Where three of the seven are consulted every run |
| Run-level consults | `faff-beep-boop/SKILL.md:155` (`run-start`), `:151` (`run-outward`), `:275` (`run-done`), `:277` (`queue-state` git-only derive) | Where the run-level kernels are consulted |
| Capture-wiring lint host | `validate-adapters.js` (skill loops at 727-730, 768-770) | Where the new decidable oracle lives |
| Lint precedent | `lint-cli-coverage.js:10-14` (FAFF-581 "declared, not grep-guessed"), 95-97 (structural matcher) | The fail-closed, source-derived shape the new lint follows |

Scope statement: this completes the runtime join FAFF-989 began, plus a new fail-closed lint that proves the wiring is present; it changes the orchestrator skills and adds one lint plus tests, and changes no capture-kernel record shape.

## 2. Out of scope

- **The FAFF-956 empty-id append contract.** The rule that an empty-`correlation_id` base still validates and is still appended (asserted at `decision-capture.js:951-952` and `shadow-fidelity.js`) is unchanged. This fix stops all nine kernels from producing an empty id at all in a substrate run; it does not change how an empty id is treated when one does occur. Extension point: the append gate in `captureDecisionCore` and both mirrored validators, under a dedicated FAFF-956 ticket.
- **A real rollup action for `queue-state`/`project-next`.** Tier 2 gives these a minted id and no marker; inventing a genuine downstream action for a run-level or container-level rollup is a separate registry decision, not this fix. Extension point: `KERNEL_REGISTRY` in `decision-capture.js` plus a `shadow-fidelity.js` adapter, if a rollup ever gains a real action.
- **`tier` and `regions` captures.** Both sit outside the coordinator-transition replay set (`shadow-fidelity.js:232-233`) and are not decision-kernel consults the orchestrator wires. Extension point: none intended.
- **Turning capture on by default.** The default posture stays off; `capture.decision_kernel` must read exactly `"on"`. Extension point: `.faffrc.yaml` per-repo config.

## 3. WHAT: the call sites, the wiring shape, the action tokens, and the lint

### Vocabulary

| Term | Definition |
|---|---|
| Base record | The in-kernel `{normalised_inputs, verdict, correlation_id, causation}` record minted at verdict time. |
| Action marker | The later `decision-capture-action` record quoting a base's `correlation_id`, naming the action the orchestrator took. |
| Driver | The `decide --export` (set the id) and `action` (emit the marker) verb pair that makes a base and its marker share an id by construction. |
| Mint-and-silence | Tier 2's wiring: `decide --export` only, so the base carries a real minted id (silencing the empty-id note) but never joins a marker. |
| `__run__` sentinel | The literal issue id the run-level kernels stamp, since they are not per-issue. |
| Capture-wiring lint | The new `validate-adapters` gate that asserts every `captureDecision`-calling kernel has an adjacent `decide --export` in some `SKILL.md`, fail-closed. |

### The nine call sites and their disposition

| Kernel | Call site | Consulted where | Disposition |
|---|---|---|---|
| `next` | `next.js:137` | beep-boop / graft build routing | Wired already (FAFF-989) |
| `eligible` | `eligible.js:89` | beep-boop / graft eligibility gate | Wired already (FAFF-989) |
| `claim-verdict` | `claim-verdict.js:94` | tidy stale-claim sweep, per issue | Tier 1 (this ticket) |
| `park-verdict` | `park-verdict.js:125` | tidy stale-park-label sweep, per issue | Tier 1 (this ticket) |
| `run-start` | `run-start.js:113` | beep-boop section 0a admission preflight, `__run__` | Tier 1, L4 only (this ticket) |
| `run-outward` | `run-outward.js:122` | beep-boop section 0a admission preflight, `__run__` | Tier 1, L4 only (this ticket) |
| `run-done` | `run-done.js:205` | beep-boop wave boundary and run end, `__run__` | Tier 1 (this ticket) |
| `queue-state` | `queue-state.js:192` | beep-boop wave drain and git-only signal, `__run__` | Tier 2 mint-and-silence (this ticket) |
| `project-next` | `project-next.js:196` | tidy container state-coherence, per container | Tier 2 mint-and-silence (this ticket) |

The five Tier-1 kernels are exactly FAFF-989's "affected kernels" list (design doc line 79) minus the two already done. `run-start` and `run-outward` are only reachable with a substrate at L4 section 0a; a plain L3 self-drain never enters that section (the load-bearing L4-guard invariant at `faff-beep-boop/SKILL.md:160` states this explicitly: an ordinary L3 run skips section 0a entirely and never consults `faff run-start`). Wiring those two therefore benefits L4 lights-out runs only, and any test for them must drive an L4-shaped preflight or no base is minted.

### The wiring shape (one documented pattern, reused per site)

The pattern is the one FAFF-989 already documents for `next`/`eligible` at `faff-beep-boop/SKILL.md:210-213`, generic over `--kernel`:

```
PATTERN capture_a_consult(kernel, issue_or___run__, wave):
  1. eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel <kernel> [--wave <w>] --export)"
     # sets FAFF_DECISION_CORRELATION_ID and FAFF_DECISION_ISSUE for the current shell; values single-quoted
  2. run the unmodified kernel consult (faff <kernel> ...)   # base minted in-kernel, reads the exported id
  3. Tier 1 only, once the action is known:
     faff decision-capture action --run <run> --issue <issue> --kernel <kernel> [--wave <w>] --action <token>
     # marker reuses the exported id; base and marker join by construction
```

`decide` and `action` are already generic over `--kernel` (`decision-capture.js:504-522`), so no new mint logic is needed; the change is prose plus the lint plus tests. Tier 2 stops after step 2: the base carries the minted id and lands `action_uncaptured` with no note, and no marker is emitted.

### The action token per Tier-1 kernel (spell it at the site)

Each Tier-1 site emits the action the orchestrator actually took, drawn from that kernel's own vocabulary, never a re-emitted verdict. The prescribed-versus-actual gap is the whole signal the study measures. The tokens the grader's divergence map reads are in `shadow-fidelity.js:200-211`; the authoritative source for each verdict vocabulary is `faff contract <name> --describe`. Spell each token literally at the site, not by reference, so token drift is visible in the diff:

| Kernel | Verdict vocabulary | Action token to emit at the site |
|---|---|---|
| `claim-verdict` | `live` / `stale` | `--action live` if tidy left the claim; `--action stale` if it reclaimed the stale claim |
| `park-verdict` | `strip-ok` / `protect` / `surface` / `n/a` | `--action strip-ok` (stripped), `--action protect` (retained mid-build park), or `--action surface` (left for human) |
| `run-start` | `plan` / `drain` / `refuse` | `--action plan`, `--action drain`, or `--action refuse`, per the section-0a branch taken |
| `run-outward` | verdict `outward` vs inward set (`self-marked` / `self-container` / `self-referential` / `unresolved-target`) | `--action outward-adopter` if the run proceeded outward; else the inward disposition token from the set (`shadow-fidelity.js:196,210`) |
| `run-done` | `continue` / `run-complete` / `escalate` | `--action continue`, `--action run-complete`, or `--action escalate`, per the wave-boundary branch |

Note the deliberate mismatch for `run-outward`: its action token `outward-adopter` is not a verdict token. This is why the capture-wiring lint's token check (below) uses a declared per-kernel action vocabulary, not the verdict vocabulary. A consult whose downstream action never resolves for a legitimate reason (for example a section-0a `refuse` that exits before any other action) still emits the marker naming that terminal disposition; it is never left action-uncaptured on a path the orchestrator did decide.

### The capture-wiring lint (the decidable oracle)

A new fail-closed gate in `faff validate-adapters` makes "the id-minting wiring is present at every capture site" a bounded CI check rather than an unbounded real-run inspection. It follows the FAFF-581 `lint-cli-coverage.js` precedent, "declared, not grep-guessed" (`lint-cli-coverage.js:10-14`):

```
PROCEDURE capture_wiring_lint(skillsDir, libDir):
  1. DERIVE the kernel set from source with a brace-aware / AST-style match (NOT a single-line
     regex): parse every plugin/skills/faff/bin/lib/*.js for a `captureDecision({ ... kernel: "<k>" ... })`
     call, reading the kernel argument across newlines. Three sites use the multi-line form
     `captureDecision({\n  kernel: "...",` (claim-verdict.js:94, park-verdict.js:125, eligible.js:89),
     so a naive single-line match would drop them and the gate would fail OPEN on kernels that are wired.
     This assumes the kernel argument is a literal string; a computed kernel name is out of scope (none
     exist today). The match yields the authoritative set (the nine today), never a grep for a bare
     kernel name in prose.
  2. For each derived kernel K:
       assert some plugin/skills/*/SKILL.md contains a `decide ... --kernel K ... --export`
       line within 15 lines of a `faff K` consult (the adjacency window), using a
       structural token match (a quoted/flagged `--kernel K`), not a naive substring.
  3. FAIL CLOSED: a derived kernel with no matching `decide --export` anywhere is a FAIL,
     exit 1. A read error on a source file is a hard tooling failure (exit 2), never a pass.
```

The lint asserts presence of the id-minting wiring for all nine (both tiers), so it is the mechanism behind the decidable oracle "no empty-id note fires for any kernel in a substrate-present run". It does not assert an action marker (Tier 2 has none by design); the-verbs-join half is proven by the driver-shaped unit test, not the lint.

**Token-vocabulary check (bounded, feasible with a carve-out).** The lint can additionally assert each Tier-1 site's literal `--action <token>` is drawn from that kernel's action vocabulary, if the vocabulary is *declared* as lint data (mirroring FAFF-581's declared-not-derived rule) rather than derived from the verdict vocabulary. Deriving it from the verdict vocabulary would false-fail `run-outward` (`outward-adopter` is not a verdict token). This token check is worth adding but is secondary: the primary defence against token drift is spelling each token literally at the site (the table above), which a human reviews in the diff. The mandated lint scope is wiring-presence, fail-closed; the token-vocabulary assertion is an in-scope addition where the declared-vocabulary table is cheap to maintain.

The lint lives in `validate-adapters.js`, which already reads `SKILL.md` files across the skills tree (the faffidavit-/faffter- conformance loop at lines 727-730 and the faff-* user-command loop at 768-770); the new gate-block enumerates every `plugin/skills/*/SKILL.md` under the resolved skills dir to find the `decide --export` adjacency.

## 4. HOW: where the prose goes and how each site follows through

### Architecture

Two skill files change plus one lint file plus tests. `faff-tidy/SKILL.md` hosts the per-issue Tier-1 consults (`claim-verdict`, `park-verdict`) and the Tier-2 `project-next` mint. `faff-beep-boop/SKILL.md` hosts the run-level Tier-1 consults (`run-start`, `run-outward`, `run-done`) and the Tier-2 `queue-state` mint. Each existing consult paragraph gains the driver wrap around its kernel call, guarded by substrate presence, referring back to the one documented pattern rather than restating the full `eval`/`action` sequence.

```
PROCEDURE wire_a_tier1_tidy_consult(kernel):        # claim-verdict :296, park-verdict :283
  1. IF FAFF_RUN_DIR is unset: run the consult unchanged, capture nothing
     (byte-identical to today's standalone tidy; captureDecision no-ops per :451)
  2. ELSE, per issue consulted:
     a. eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel <kernel> --export)"
     b. run the consult (faff <kernel> ...)
     c. after tidy applies the disposition:
        faff decision-capture action --run <run> --issue <issue> --kernel <kernel> --action <token>
```

```
PROCEDURE wire_a_tier1_run_level_consult(kernel, wave):   # run-start :155, run-outward :151, run-done :275
  1. eval "$(faff decision-capture decide --run <run> --issue __run__ --kernel <kernel> [--wave <wave>] --export)"
  2. run the consult (faff <kernel> ...)
  3. after the branch is taken:
     faff decision-capture action --run <run> --issue __run__ --kernel <kernel> [--wave <wave>] --action <token>
```

```
PROCEDURE mint_and_silence_tier2(kernel):   # queue-state :277 (git-only derive), project-next :221
  1. IF FAFF_RUN_DIR is unset: run the consult unchanged, capture nothing
  2. ELSE: eval "$(faff decision-capture decide --run <run> --issue __run__ --kernel <kernel> --export)"
  3. run the consult (faff <kernel> ...)   # base minted with the non-empty id; lands action_uncaptured, no note
  4. emit NO action marker
```

**`run-done` wave consistency.** `run-done` is consulted at a recurring wave boundary and its `decide`/`action` pair carry `--wave`. The `--wave` value on the `action` call must equal the value on the `decide --export` call for that consult, or the marker's id derivation can disagree with the base's and the pair never joins (`decision-capture.js:533-550`). The reused-id precedence at 541-545 protects the join when the export is `eval`'d in the same shell, but the wave passed to `action` must still match so the observability disagreement note does not fire spuriously. Wire both calls with the same `<wave>` literal.

**`project-next` is per-container yet stamped `__run__`.** `project-next.js:196` reads its issue from `$FAFF_DECISION_ISSUE`, and tidy consults it once per active container. Under the settled mint-and-silence decision the `decide --export --issue __run__` stamps `__run__` as the issue for every container's base and mints a shared id across them. This is harmless: Tier 2 emits no marker and never joins, so the id's only role is being non-empty to silence the note, and a shared id across `action_uncaptured` bases collides with nothing. The mint may run once before the container loop rather than per container.

**One documented pattern, not seven copied blocks.** The house skill-authoring standard is say-it-once and deduplicated. Each newly wired site gets a short co-located line naming its kernel, its `--issue` argument, its tier, and (Tier 1) its action token, referring back to the `next`/`eligible` pattern at `faff-beep-boop/SKILL.md:210-213`. The lint keeps the hub files honest without inflating them.

### Anti-patterns

- **Anti-pattern:** gate the wiring on `if L4` or `if autonomous`. Why: an L3 self-drain also exports `FAFF_RUN_DIR`, so a level check misses it; gate on `FAFF_RUN_DIR`, which is what `captureDecision` keys off (`decision-capture.js:451`).
- **Anti-pattern:** let a kernel mint its own `__run__`-scoped id in-process when the env var is empty. Why: the base id and the marker id would be re-derived independently and can disagree, the no-join bug FAFF-989 warns about at `decision-capture.js:533-550`.
- **Anti-pattern:** hand-build the `export FAFF_DECISION_CORRELATION_ID=...` line or pass a hand-typed `--correlates`. Why: the `decide --export` output is single-quoted for shell safety (`decision-capture.js:513-517`) and the marker reuses the exported id by construction; reconstructing either bypasses the quoting and re-introduces both the injection risk and the mismatch risk.
- **Anti-pattern:** emit an action marker for `queue-state` or `project-next`. Why: Tier 2 is mint-and-silence by design; a marker would fabricate an action for a rollup that has none.
- **Anti-pattern:** branch the kernel's control flow on a capture result. Why: capture is authority-inert and must exit 0 without changing the consult's outcome (`decision-capture.js:490-491`).

### Failure modes

- **The failure:** the wiring lands but a real L4 run still grades nothing, because the orchestrator does not execute the added prose at runtime. **How you would know:** a real run with capture on shows base records in `events.jsonl` but a `matrix.<kernel>.denominator` stays at zero for a Tier-1 kernel. **What it means:** the lint proves the prose is present and the unit test proves the verbs join when invoked, so this residual is runtime-compliance of prose, which is not a DONE criterion here; it is a monitorable signal, not an acceptance gate. Prose wiring is the chosen mechanism precisely because the verbs are generic and no code change is needed.
- **The failure:** base capture over-fires. A wired kernel is called from a path other than the intended consult, with `FAFF_RUN_DIR` set but no `decide --export` in that path, minting an orphaned empty-id base. **How you would know:** the empty-id degraded note reappears for that kernel after the fix, and `action_uncaptured` for it exceeds the deliberate consult count. **What it means:** every reachable consult of a wired kernel under a substrate needs the driver; the capture-wiring lint is the durable guard, but it checks presence at declared sites, not every call path, so a genuinely new call path is caught by the reappearing note.
- **The failure:** `run-start`/`run-outward` wiring appears to do nothing in testing. **How you would know:** an L3-shaped test never enters section 0a (`faff-beep-boop/SKILL.md:160`), so no base is minted. **What it means:** this is correct, not a defect; those two are L4-only and must be exercised with an L4-shaped preflight.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a beep-boop run with capture.decision_kernel "on" and FAFF_RUN_DIR set
And the tidy phase consulting claim-verdict for a stale-claimed issue
When the wired driver exports the id, the consult mints its base, and tidy emits --action stale
Then shadow-fidelity joins the pair, matrix.claim-verdict.denominator is at least 1, and the record is absent from action_uncaptured
```

```
Given an L4 lights-out run reaching section 0a with a substrate present
When run-start is consulted with the driver wrap and the admission branch emits its --action token (plan, drain, or refuse)
Then the run-start base and marker share a correlation id and grade as a joined record, not action_uncaptured
```

```
Given a beep-boop run with capture on and FAFF_RUN_DIR set, consulting run-done at a wave boundary
When decide --export and the action marker are both wired with the same --wave value and the branch emits --action continue
Then the run-done base and marker join on the wave-consistent id, matrix.run-done.denominator is at least 1, and no derivation-disagreement note is logged
```

- With capture on and `FAFF_RUN_DIR` set, `queue-state` and `project-next` are consulted with `decide --export` and no action marker: each base carries a non-empty `correlation_id`, lands `action_uncaptured`, and logs no empty-correlation-id degraded note (the mint-and-silence oracle).
- In a substrate-present run with capture on, no empty-correlation-id degraded note fires for any of the nine kernels (all now carry `decide --export`); this is the clean decidable form of the reported symptom.
- Negative control, driver env unset with `FAFF_RUN_DIR` set: a wired kernel's base carries an empty `correlation_id`, does not join, and the empty-id note does fire (proves the join and the silencing depend on the wiring).
- Negative control, `FAFF_RUN_DIR` unset (standalone interactive `/faff-tidy`): no `decide --export` is invoked and no base is minted (`captureDecision` no-ops at `decision-capture.js:451`); the consult output and exit code are byte-identical to today.

## 6. Design decision rationale

**Seven kernels in two tiers, or five plus two excluded?**
- Options: wire the five FAFF-989 scoped in and leave the two rollups fully un-wired (v1's framing, which left the every-run degraded note as by-design noise and an open punt); or wire all seven in two tiers.
- The two rollups have no single downstream action (`shadow-fidelity.js:206,209` classify both as always-`wasteful` read-model rollups), so a real action marker is not on the table either way. Leaving them fully un-wired keeps the reported symptom (an empty-id note every run). Mint-and-silence gives each a real minted id, which silences the note (the note fires only on an empty id, `decision-capture.js:459-461`) without inventing an action and without reversing the FAFF-956 empty-id append contract, since after the change these bases are non-empty.
- **Chosen:** wire all seven, Tier 1 full for the five with a gradeable action, Tier 2 mint-and-silence for `queue-state` and `project-next`. This closes the residual defect (no more every-run note) rather than leaving it as an in-spec punt.

**Prose wiring, or kernels minting their own id in-process when the env var is empty?**
- Options: wire the id in `SKILL.md` prose (orchestrator-supplied), or have each kernel mint a `__run__`-scoped id in-process when `FAFF_DECISION_CORRELATION_ID` is empty.
- The in-process fallback re-derives the id separately from the marker's derivation, the disagreement FAFF-989 flags at `decision-capture.js:533-550`. The driver verbs are already generic over `--kernel`, so prose wiring needs no new capture-kernel code and keeps the single-derivation guarantee.
- **Chosen:** prose wiring only, orchestrator-supplied id via `decide --export`; no in-process minting fallback.

**One shared pattern, or a hand-copied block per site?**
- Options: document the driver pattern once and refer back to it, or copy the full `eval`/`consult`/`action` block into each paragraph.
- The skill-authoring standard is say-it-once and deduplicated; copied blocks drift and inflate the line-capped hub files.
- **Chosen:** keep the pattern documented once (the `next`/`eligible` paragraph at `faff-beep-boop/SKILL.md:210-213`), add a short per-site follow-through line, and spell each Tier-1 action token literally at its site so token drift shows in the diff.

**Is the capture-wiring lint in scope, and is it the DONE oracle?**
- Options: defer the lint to a follow-up (v1's call, which left DONE resting on an unbounded real-run inspection), or build it in this ticket as the decidable oracle.
- v1's headline DONE criterion (a real run shows `matrix.<kernel>.denominator >= 1`) could only be settled by inspecting a live run, so DONE was undecidable. A fail-closed lint that derives the `captureDecision`-kernel set from source (`lint-cli-coverage.js:10-14` precedent) and asserts each site has an adjacent `decide --export` decides "the wiring is present" as a bounded CI check. Paired with the driver-shaped unit test (the verbs join when invoked), the two together bound "done" without a real-run inspection.
- **Chosen:** build the lint in this ticket, in `validate-adapters.js`. The lint decides presence-of-wiring; the driver test decides the-verbs-join; DONE drops any criterion that only a real-run inspection could settle.

**Atomic landing of all seven, or a thin slice first?**
- Options: land one kernel first (for example `claim-verdict`) as a de-risking slice, since this repeats a wiring pattern that broke once in FAFF-989; or land all seven atomically.
- Landing one at a time is the classic de-risk, but the shared mechanism means one instance proves little the driver test does not already prove. Pulling the lint in-scope changes the calculus: the lint catches a missed or malformed site mechanically at CI, so an atomic landing of seven no longer relies on manual vigilance to avoid the missed-site failure mode.
- **Chosen:** land the seven atomically, with the capture-wiring lint as the mechanical guard against a missed site. The thin-slice option is noted and declined on that basis.

## 7. Open questions and assumptions

Open questions: none. The v1 architecture punt (what to do about the two rollups' degraded note) is closed by the mint-and-silence decision above, and the lint that v1 deferred is now in scope. The build proceeds without a human gate.

Assumptions: none. The `decide`/`action` verbs' genericity over `--kernel`, the export single-quoting, the reused-id precedence, the replay adapters for all nine kernels, the substrate gate, the L4-only reachability of section 0a, and the nine `captureDecision` call sites were all verified against the codebase during drafting.

Relations to declare on the tracker (hygiene, not a build gate): FAFF-989 (which wired `next`/`eligible` and set the design precedent this completes) should be a declared `relates`/`blockedBy` relation, upgraded from the current `relatedTo` link, so the predecessor is a first-class relation rather than prose.

## 8. DONE: definition of done

### From WHY
- [ ] Every one of the nine capture sites carries a `decide --export` before its kernel consult, proven by the capture-wiring lint below, so no site can mint an empty `correlation_id` in a substrate-present run (`decision-capture.js:459-461` has no empty id to fire on). This is the decidable form: the lint decides presence-of-wiring and the driver test decides the-verbs-join; runtime note-absence in a live run is a monitorable signal, not a DONE checkbox (per the failure-modes and design-rationale sections).
- [ ] `--export` output is `eval`'d as-emitted at every wired site (single-quoted, `decision-capture.js:513-517`); no site reconstructs the export string or passes a hand-typed `--correlates`.

### From WHAT (call sites and disposition)
- [ ] `faff-tidy/SKILL.md` wires `claim-verdict` and `park-verdict` (Tier 1) and `project-next` (Tier 2 mint-and-silence, issue `__run__`).
- [ ] `faff-beep-boop/SKILL.md` wires `run-start`, `run-outward`, `run-done` (Tier 1) and `queue-state` (Tier 2 mint-and-silence, issue `__run__`).
- [ ] Each Tier-1 site emits `--action` from its kernel's action vocabulary, spelled literally at the site per the WHAT token table, never a re-emitted verdict.
- [ ] Neither Tier-2 kernel emits an action marker.

### From WHAT (the lint oracle)
- [ ] `faff validate-adapters` gains a capture-wiring gate that derives the `captureDecision`-kernel set from `plugin/skills/faff/bin/lib/*.js` via a brace-aware match that reads the multi-line `captureDecision({` form (declared from source, not a prose grep) and asserts each such kernel has a `decide --export --kernel <k>` within a 15-line window of a `faff <k>` consult in some `SKILL.md`, fail-closed (a kernel with no match is exit 1; a source read error is exit 2).
- [ ] The lint passes on the wired tree (all nine kernels covered) and fails when a `decide --export` is removed from any wired site (asserted by a lint unit case).

### From HOW (behaviour)
- [ ] Each Tier-1 site places `decide --export` immediately before its kernel call and the `action` marker after the disposition is known, in the same shell context, so the marker reuses the exported id (no in-process minting).
- [ ] The `run-done` `action` call passes the same `--wave` value as its `decide --export`, so the pair joins and no derivation-disagreement note fires.
- [ ] All wiring is guarded by `FAFF_RUN_DIR` presence: with it unset, no `decide --export` is invoked and `captureDecision` no-ops, so standalone `/faff-tidy` mints no base and is byte-identical to today.
- [ ] No wired capture call changes its kernel's exit code, stdout, or control flow (best-effort, exits 0).
- [ ] The driver pattern is documented once and referred back to; the seven sites add short follow-through lines, not copied blocks; `faff validate-adapters` stays green on line caps and prose lints.

### From HOW (test coverage)
- [ ] New real-driver end-to-end coverage, in the shape of `test/faff-989-decision-capture-driver.test.mjs` (which covers `next` today), asserts a joined, graded record for each of the five Tier-1 kernels: spawn the real kernel with the driver env set, emit the action marker, run `faff shadow-fidelity`, assert `matrix.<kernel>.denominator >= 1` and absence from `action_uncaptured`.
- [ ] A Tier-2 test asserts `queue-state` and `project-next` with `decide --export` and no marker mint a base with a non-empty `correlation_id`, land `action_uncaptured`, and log no empty-id degraded note.
- [ ] A negative control asserts that with the driver env unset (but `FAFF_RUN_DIR` set), a wired kernel's base carries an empty `correlation_id`, does not join, and the empty-id note fires.
- [ ] A negative control asserts that with `FAFF_RUN_DIR` unset, no base is minted and the consult output is unchanged.
- [ ] Lint coverage: the capture-wiring gate is exercised through the real CLI entrypoint (extend `test/validate-adapters-prose-defaults.test.mjs` or the lint's own selftest), covering the pass case, the missing-`decide --export` fail case, and the source-read fail-closed case.

### Integration smoke test
```
PROCEDURE smoke():
  1. Set capture.decision_kernel "on"; export FAFF_RUN_DIR to a fresh run dir with a genesis events.jsonl chain
  2. eval "$(faff decision-capture decide --run <run> --issue <issue> --kernel claim-verdict --export)"
  3. faff claim-verdict --claimed-at <t> --now <now> --ttl-hours <n>     # base minted in-kernel
  4. faff decision-capture action --run <run> --issue <issue> --kernel claim-verdict --action stale
  5. faff shadow-fidelity --export ... ; EXPECT matrix.claim-verdict.denominator >= 1 AND record NOT in action_uncaptured
  6. faff validate-adapters ; EXPECT the capture-wiring gate PASS (all nine kernels covered)
```

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```

## Methodology critique

`Methodology: faffter-dark-methodology-agile-delivery`

_Per-issue lens for FAFF-1009 (`issue-critique`). This block is carried from the v1 prep pass; the two "fixes before build" it flagged are now resolved by the v2 revision, annotated inline below._

### Right-sizing (Principle 4): sound

Five instances of one wiring pattern is a cohesive merge, not a split. v2 keeps that and adds the two rollups under a distinct mint-and-silence tier plus the capture-wiring lint. The residual the v1 critique flagged (the two rollups still emitting the defect note) is now closed by mint-and-silence rather than left as an in-spec punt.

### Workstream fit (Principles 1 + 5): clean

The project "Orchestration fidelity is measured before authority moves" is outcome-named and FAFF-1009 continues FAFF-989 within it. v2 discharges the project's outcome more fully than v1: after it merges, no substrate-present run emits the ungradeable empty-id record for any of the nine kernels.

### Surfaced dependencies (Principle 6): addressed

v1 flagged two implicit deps living only as in-spec prose. v2 resolves both: the `validate-adapters` capture-wiring lint is now in scope (not a follow-up), and the rollup residual is closed by mint-and-silence rather than a follow-up ticket. The remaining item is hygiene, not a dep: upgrade FAFF-989 from the current `relatedTo` link to a declared `relates`/`blockedBy` relation (stated in the spec's section 7).

### Risk profile (Principle 7): de-risked

v1's risk was an atomic landing of a pattern that broke once, at medium confidence, with no mechanical guard. v2 changes the calculus: the in-scope fail-closed lint catches a missed or malformed wiring site at CI, so the atomic landing no longer rests on manual vigilance, and the confidence is now high. The thin-slice option is explicitly considered and declined on that basis in the spec's design rationale.
