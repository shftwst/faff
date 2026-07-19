# Spec — FAFF-559: git-only §8.5 run-done wiring (pipe queue-state + prd-checklist into run-done)

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-559.

This is a buildable nlspec for FAFF-559, child slice 3/3 of FAFF-551. Audience: the build agent editing `plugin/skills/faff-beep-boop/SKILL.md`, and the human reviewer gating the change. The slice is a SKILL.md prose-wiring change only — no CLI is added or modified. It is serialised behind FAFF-556 (`faff queue-state`) and FAFF-557 (`faff prd-checklist`), which are specced but unbuilt; this spec is written to their documented interfaces.

## 1. WHY — Problem and Principles

**The load-bearing model.** A beep-boop wave-boundary stop asks one question: *is the run done?* On the tracker path it answers by **observing** tracker queue-emptiness directly (and, at L4/`--converge`, by consulting `faff run-done`). A **git-only** run has no tracker to observe — no Backlog/Todo re-query (step 8.2 has nothing to hit) — so it must **derive** emptiness from on-disk state and route that derived signal through `faff run-done`, which is already the suite's terminating-condition predicate. This slice is the wiring that derives those signals (`faff queue-state`, `faff prd-checklist`) and hands them to the **unchanged** `run-done`.

**Problem statement.** Today §8.5's wave-boundary stop assumes a tracker-observed queue for its emptiness signal and a tracker PRD for its `--prd-coverage`/`--no-prd` decision; a git-only run can populate neither, so it can never terminate on doneness — it falls through to the safe-but-blunt not-empty / `--no-prd` default and never reports `run-complete`. This change adds a git-only branch to §8.5 that assembles the same `RunSignals` from pure CLIs (`faff queue-state`, `faff prd-checklist`) so a git-only run reaches an honest `run-done` verdict. `run-done` itself, and the entire tracker path, are untouched.

**Design principles.**

- **Fail-closed toward the current safe behaviour, always.** Every degrade path (missing signal, non-zero exit, unparseable output, no PRD in scope) must land on exactly the behaviour a git-only run has *today*: `queue_empty:false`/`all_parked:false` (⇒ `work-remaining`⇒`continue`) and/or `--no-prd` (⇒ null PRD floor). A degrade may never manufacture a `run-complete`. This is acceptance 3, and it is the governing constraint over every wiring decision below.
- **The tracker path is frozen.** The git-only branch is *additive*, gated on the structural git-only signal. The three existing wave-boundary bullets and the consult paragraph's non-git-only flag assembly stay byte-identical (acceptance 2). No tracker-mode reader may observe any change.
- **Reconcile the "plain L3 never consults run-done" prose.** The decision below (git-only routes the wave-boundary stop through `run-done` at *every* level, including plain L3) contradicts three existing sentences that assert a plain-L3 run "ends by queue-emptiness and **never** consults" run-done (`faff-beep-boop/SKILL.md` **line ~227** — the plain-L3 wave-boundary bullet; **line ~661** — "a plain L3 run without `--converge` ends by queue-emptiness and never consults it"; **line ~683** — "In a plain L3 run the run ends only when a wave assembles to an empty build queue"). Those sentences are describing the **tracker** plain-L3 path; the edit MUST scope each to *tracker-mode* plain L3 and add the git-only carve-out (git-only plain L3 terminates via the queue-state→run-done consult), so the file does not ship self-contradicting L3-termination prose. In a prose-wiring change, this internal consistency **is** the deliverable — see the architectural rationale and DoD below.
- **One consult, not two.** The git-only branch substitutes only *how* `--queue-empty`/`--all-parked`/`--prd-coverage`-vs-`--no-prd` are **assembled**. It reuses the existing consult paragraph's `run-done` invocation and its `continue`/`run-complete`/`escalate` verdict-branching verbatim (referenced, never copied — the skill-authoring dedup rule, enforced by `faff validate-adapters`). `--ledger-clean`/`--budget`/`--policy`/`--non-convergence` are assembled identically in both modes.
- **Spec-to-interface.** `queue-state` and `prd-checklist` are unbuilt (FAFF-556/557). This slice consumes their *documented* output shapes; the build is serialised behind them. Their interfaces are recorded under Assumptions with validation instructions.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` §8.5 (~lines 225–232) | Markdown (skill prose) | The only file edited; the wave-boundary stop + consult paragraph |
| `plugin/skills/faff/bin/lib/run-done.js` | JavaScript | The **unchanged** consumer; its arg semantics are the contract this wiring must satisfy |
| `plugin/skills/faff/SKILL.md` (gateway) | Markdown | Defines git-only mode ("no tracker MCP ⇒ git-only") and the `.faff/specs/` git-only spec store |
| `faff queue-state` (FAFF-556, unbuilt) | CLI | Producer of `{queue_empty, all_parked}` |
| `faff prd-checklist` (FAFF-557, unbuilt) | CLI | Producer of a `prd-coverage` block from a checklist PRD |

**Scope statement.** This is the git-only analog of the tracker path's bare-emptiness exit, living inside step 8's "Wave re-entry" → sub-step 5 "Wave-boundary stop" and its consult paragraph.

## 2. OUT OF SCOPE

- **Any change to `run-done.js`** — *Why:* the slice is a consumer of the frozen CLI; run-done's floors/ladder are correct as-is. *Extension point:* a future run-done change is its own ticket against `plugin/skills/faff/bin/lib/run-done.js`.
- **Building `faff queue-state` / `faff prd-checklist`** — *Why:* FAFF-556/557 own them; this slice is blockedBy both. *Extension point:* those tickets; this spec only pins the interfaces consumed.
- **The tracker-path wave-boundary logic** — *Why:* acceptance 2 requires it byte-identical. *Extension point:* n/a — deliberately untouched.
- **Sentry / budget / effects assembly at the checkpoint** — *Why:* `--budget`/`--ledger-clean` and the sentry consult are mode-agnostic and already assembled once. *Extension point:* the canonical checkpoint procedure in §*The interrupt* (unchanged).
- **PRD-path *resolution* mechanism** — *Why:* the branch reuses the run's existing "a PRD is in scope" determination; no new resolver is introduced. *Extension point:* if git-only PRD discovery ever needs its own path, that is a separate change to the run's PRD-in-scope determination.
- **A ratio/partial `prd-coverage`** — *Why:* run-done reads only the boolean `.satisfied`; boolean v1 is the shipped shape. *Extension point:* the coverage producer (FAFF-557), not this wiring.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| git-only mode | A run whose whole lifecycle has no resolving tracker MCP (gateway: "If no tracker MCP is available, it falls back to git-only mode"). Detected structurally, never forced — the same idiom `merge-gate --local` uses. |
| RunSignals | The flag set the wave-boundary consult passes to `faff run-done` (`--queue-empty`/`--all-parked`/`--ledger-clean`/`--budget`/`--no-prd`\|`--prd-coverage`/`--non-convergence`/`--policy`). |
| derived emptiness | Git-only's replacement for tracker-observed queue-emptiness: `{queue_empty, all_parked}` computed by `faff queue-state` from on-disk item-keys vs run-ledger outcomes. |
| fail-closed default | Omit both `--queue-empty`/`--all-parked` (run-done ⇒ `false`/`false`) and/or pass `--no-prd`. Maps to `work-remaining`/`continue` or a null PRD floor — never `run-complete`. |

**Documented producer interfaces (consumed as-is; see Assumptions for validation).**

```
INTERFACE faff queue-state --json          # FAFF-556, pure: no tracker/network
  reads: .faff/intake roadmap keys + .faff/specs keys, diffed against run-ledger.json outcomes by exact key match
  emits (stdout, exit 0): { queue_empty: Boolean, all_parked: Boolean }
  fail-safe: an item whose stable key is absent-from / non-terminal-in the ledger ⇒ queue_empty:false

INTERFACE faff prd-checklist <prd-path> --json     # FAFF-557, pure: no tracker/network
  parses: a checklist-style PRD's GFM `- [ ]` / `- [x]` stop-conditions
  emits (stdout, exit 0): the EXISTING prd-coverage schema —
    { satisfied: Boolean, covered: Boolean, uncovered_goals: Array }   # invariant: covered ⟺ uncovered_goals empty
  degrades LOUDLY (non-checklist / unparseable) ⇒ non-zero exit, never a false `covered`/`satisfied`
```

**run-done arg contract this wiring must satisfy (frozen — `run-done.js`).**

```
--queue-empty / --all-parked : presence booleans. PRESENT ⇒ true; ABSENT ⇒ false (boolSig, lines 130-134).
                               ⇒ pass a flag ONLY when its derived boolean is true; omit for false.
--prd-coverage <json>        : run-done reads .satisfied; value MUST be an object with boolean .satisfied,
                               else exit 2 (usage error) (lines 150-156).
--no-prd                     : forces prd_satisfied = null (no PRD floor).
EXACTLY ONE of {--prd-coverage, --no-prd} : if BOTH are passed, run-done IGNORES --prd-coverage
                               (it is gated behind !args.includes("--no-prd"), line 150).
neither --prd-coverage nor --no-prd ⇒ prd_satisfied = null (no PRD in scope).
Verdict mapping (frozen): prd_satisfied===false ⇒ escalate/product-incomplete (fixed floor);
                          work-remaining reason = !(queue_empty || all_parked) ⇒ continue.
```

**Design decision — does git-only route the wave-boundary stop through `run-done` at *every* level, including plain L3?**

- **Yes.** The tracker path's plain-L3 bullet exits on *tracker-observed* emptiness; git-only has no such observation, so its only honest emptiness oracle is `queue-state` → `run-done`. A git-only run therefore consults `run-done` at the wave boundary regardless of level, and branches on the verdict exactly as the shared consult paragraph already prescribes.
- **Chosen:** Git-only wave-boundary termination always goes through the `faff run-done` consult (the git-only analog of the tracker path's bare-emptiness exit) — rationale: there is no tracker queue to observe, and run-done's floors are strictly *safer* (a git-only L3 run whose derived queue is empty but whose PRD is unsatisfied escalates to needs-human instead of a false `run-complete`), which is the acceptance-3 direction. This is orthogonal to the L4-only *Sentry* acting scope and does not change it.

## 4. HOW — Behavior

**Architecture.** §8.5 gains one gated branch. When the run is git-only (structural signal, whole-lifecycle), the wave-boundary stop and the consult's `--queue-empty`/`--all-parked`/`--prd-coverage`-vs-`--no-prd` **assembly** are replaced by the git-only assembly below; the consult *call* and its `continue`/`run-complete`/`escalate` branch are reused unchanged. All other RunSignals and both other modes are untouched.

**Behavior summary.** Derive `{queue_empty, all_parked}` from `faff queue-state`; derive the PRD floor from `faff prd-checklist` when a checklist PRD is in scope; hand both to the existing `run-done` consult; on any failure, degrade to the current safe default.

```
PROCEDURE git_only_wave_boundary_consult(run_dir, prd_in_scope, prd_path):
  # --- emptiness (replaces tracker-observed emptiness) ---
  1. qs := run `faff queue-state --json` (pure; reads .faff stores + run-ledger.json)
  2. IF qs exit == 0 AND stdout parses to an object with boolean .queue_empty and boolean .all_parked:
       a. IF qs.queue_empty  is true → include `--queue-empty` ; ELSE omit it
       b. IF qs.all_parked   is true → include `--all-parked`  ; ELSE omit it
     ELSE (non-zero exit / unparseable / missing fields):
       c. omit BOTH flags                                  # run-done ⇒ queue_empty:false, all_parked:false
                                                           # ⇒ work-remaining ⇒ continue (fail-closed, never run-complete)
       d. record the fault to the wave log; do NOT hard-stop

  # --- PRD floor: EXACTLY ONE of --prd-coverage / --no-prd ---
  3. IF NOT prd_in_scope:
       a. include `--no-prd`                               # null floor, exactly today's git-only default
     ELSE:
       b. pc := run `faff prd-checklist <prd_path> --json`
       c. IF pc exit == 0 AND stdout parses to an object with boolean .satisfied:
            include `--prd-coverage '<pc stdout block>'`   # run-done reads .satisfied; extra fields ignored
          ELSE (non-zero / unparseable / no boolean .satisfied):
            include `--no-prd`                             # fail-closed; never fabricate covered/satisfied
       # NEVER include both --prd-coverage and --no-prd (run-done would ignore coverage)

  # --- everything else assembled identically to the tracker path ---
  4. add `--ledger-clean` (from `faff runcheck`-clean), `--budget '{breached,outcome}'` (8.1's),
         `--non-convergence` (ONLY under --converge, per the existing backstop),
         `--policy '<ladder>'` (methodology's, else omit)
  5. call `faff run-done --json` with the assembled flags, then branch on the JSON `verdict`
     EXACTLY per the existing consult paragraph: continue → re-enter; run-complete → exit reporting;
     escalate → exit with reason + needs-human signal.
```

**Argv safety (infosec).** The derived `--prd-coverage '<block>'` value (and `--budget`/`--policy`) MUST be passed to `faff run-done` as a **single argv element**, never spliced into a shell command string. A checklist PRD is a repo-content file whose parsed `prd-coverage` block is attacker-influenceable; splicing it into a shell string would let crafted content inject shell metacharacters. run-done itself pre-validates the block (boolean `.satisfied`, exit 2 on malformed), so the argv-boundary discipline plus that validation bound the blast radius. Blast radius is local (a pure CLI, no network/secrets), but the discipline is cheap and pinned here.

**Where the checklist-PRD path comes from.** The `prd_in_scope` / `prd_path` inputs are the run's **existing** PRD-in-scope determination — the same "unless a PRD is in scope" gate the current consult paragraph already applies for `--no-prd`. A git-only run has no tracker PRD, so an in-scope PRD is a checklist-PRD **file** (the configured checklist-PRD path, or whatever path that determination already yields). No new resolver is introduced.

**Edge cases and error handling (all fail-closed, precedence top-to-bottom).**

- `queue-state` non-zero / unparseable / missing a boolean field → omit both emptiness flags → `queue_empty:false, all_parked:false` → `work-remaining` → `continue`. (Never `run-complete`.)
- `prd-checklist` non-zero / unparseable / lacking boolean `.satisfied` → `--no-prd` → null floor. (Pre-validating `.satisfied` here also prevents a run-done **exit 2** usage error from a malformed `--prd-coverage`.)
- No PRD in scope → `--no-prd` (unchanged from today).
- Both derivations fail simultaneously → both defaults apply (`work-remaining` + null floor) → `continue`. The run keeps going or is bounded by budget — never a false completion.
- A well-formed `prd-coverage` with `.satisfied:false` → passed through → run-done's fixed floor → `escalate`/`product-incomplete`. This is *correct* fail-closed behaviour, not a degrade.

**Anti-pattern:** passing both `--prd-coverage` and `--no-prd` "to be safe". Why: run-done gates `--prd-coverage` behind `!--no-prd`, so coverage is silently ignored and the floor is always null — a satisfied PRD would never gate. Pass exactly one.

**Anti-pattern:** passing `--no-queue-empty`/`--no-all-parked` to signal not-empty. Why: unnecessary — absence already yields `false` (`boolSig`). Omit the flag; do not invent negative flags.

**Anti-pattern:** copying the consult paragraph's `run-done` call/verdict prose into the git-only branch. Why: it duplicates a >6-line block across the same file section and trips the `faff validate-adapters` duplicated-block rule; reference the shared consult prose and state only the git-only assembly delta.

**Failure modes.**

- **The failure:** the git-only branch's gate is written on a per-wave signal rather than the whole-lifecycle git-only fact, so a transient MCP blip mid-run flips a tracker run onto the git-only assembly (or vice-versa). **How you'd know:** a tracker run's summary shows a `queue-state`/`prd-checklist` invocation, or a git-only run's wave log shows a tracker re-query. **What it means:** narrow — gate strictly on the same whole-lifecycle structural signal `merge-gate --local` uses, asserted once, not re-sniffed per wave.
- **The failure:** `prd-checklist` emits a block that parses but whose `.satisfied` shape drifts from run-done's expectation, causing a run-done exit 2 that aborts the consult instead of degrading. **How you'd know:** a wave log shows `run-done` exit 2 / usage error at a git-only boundary. **What it means:** proceed — the pre-validation in step 3c (require a boolean `.satisfied` before passing) already converts this to a `--no-prd` degrade; the DoD asserts it.

## 5. SCENARIOS — born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git-only /faff-beep-boop run that shipped all admitted work (faff queue-state → {queue_empty:true, all_parked:false})
  and a checklist PRD in scope that is fully satisfied (faff prd-checklist → {satisfied:true, ...})
When the wave-boundary stop runs
Then the consult passes `--queue-empty` and `--prd-coverage '{...,"satisfied":true}'` (and NOT --no-prd)
  And faff run-done returns verdict `run-complete` (not `work-remaining`), with no out-of-band human judgment
```

```
Given a git-only run at a wave boundary
When `faff queue-state` exits non-zero (or emits unparseable JSON)
Then the consult omits BOTH `--queue-empty` and `--all-parked`
  And faff run-done sees queue_empty:false, all_parked:false ⇒ verdict `continue` (work-remaining) — never `run-complete`
```

- The tracker (non-git-only) wave-boundary bullets and the consult paragraph's non-git-only flag assembly MUST be byte-identical before and after this change (assert by diff — only additive git-only lines appear).

## 6. DESIGN DECISION RATIONALE

**Q: Does the git-only branch change what the consult computes, or only how the RunSignals are assembled?**
- Option A — reimplement termination for git-only. Cons: forks the terminating predicate, drifts from `run-done`, violates dedup.
- Option B — assemble the same RunSignals from pure CLIs and reuse the frozen consult. Pros: one predicate, minimal surface, run-done unchanged.
- **Chosen:** B — the git-only branch substitutes only the assembly of `--queue-empty`/`--all-parked`/`--prd-coverage`-vs-`--no-prd`; the `run-done` call and verdict branch are reused. Rationale: matches the ticket's stated scope, keeps `run-done` and the tracker path untouched (acceptance 2), and is the leanest change.

**Q: How is emptiness wired, and what happens on `queue-state` failure?**
- **Chosen:** run `faff queue-state --json`; on exit 0 + parseable, pass `--queue-empty`/`--all-parked` per its booleans (flag included only when true); on any non-zero / unparseable / missing-field result, omit **both** → run-done's `boolSig` yields `false`/`false` → `work-remaining` → `continue`. Rationale: the omit-both default is exactly today's safe not-empty behaviour and can never yield `run-complete` (acceptance 3). Passing presence-flags-only mirrors the tracker path's existing convention.

**Q: How is the PRD floor wired, and what guarantees exactly one flag?**
- **Chosen:** when a checklist PRD is in scope, run `faff prd-checklist <path> --json`; on exit 0 + a block with boolean `.satisfied`, pass `--prd-coverage '<block>'`; otherwise (non-zero / unparseable / no boolean `.satisfied` / no PRD in scope) pass `--no-prd`. Exactly one is passed, never both. Rationale: run-done ignores `--prd-coverage` when `--no-prd` is present (line 150), so passing both would nullify a satisfied PRD; pre-validating boolean `.satisfied` also avoids run-done's exit-2 usage error. `--no-prd` on every degrade is the current safe null-floor default (acceptance 3), and never fabricates `covered`.

**Q: Does git-only route through run-done even at plain L3 — and how is that squared with the existing "plain L3 never consults run-done" prose?**
- **Chosen:** yes — a git-only run consults `run-done` at the wave boundary at every level, because it has no tracker-observed emptiness to exit on. Rationale: run-done is the honest emptiness oracle here and its floors are strictly safer (unsatisfied-PRD ⇒ escalate, not false-complete). This is the git-only analog of the tracker path's bare-emptiness exit and is orthogonal to the L4-only Sentry acting scope. It is a **deliberate, documented divergence** from tracker plain-L3, not an oversight: git-only lacks the tracker re-query that lets tracker plain-L3 observe emptiness directly, so it substitutes the queue-state→run-done consult (and gains the PRD floor as a correctness bonus). **The three existing sentences that say plain L3 "never consults run-done" (lines ~227/~661/~683) describe the *tracker* path and MUST be scoped to it** (see the WHY reconciliation principle + DoD) — the edit squares them rather than leaving the file self-contradicting. The tracker plain-L3 path itself is unchanged (acceptance 2).

**Q: How is the tracker path kept byte-identical?**
- **Chosen:** the git-only branch is additive, gated on the whole-lifecycle structural git-only signal (the `merge-gate --local` idiom); a run with a resolving tracker takes the existing three bullets and consult assembly verbatim. Rationale: acceptance 2 — verified by diffing the tracker-mode lines to zero change.

**Q: Where does the checklist-PRD path come from?**
- **Chosen:** reuse the run's existing "PRD in scope" determination / configured checklist-PRD path; introduce no new resolver. Rationale: the current consult already gates `--no-prd` on "unless a PRD is in scope"; the git-only branch extends that same determination to a checklist-PRD file, keeping the change minimal.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. All decisions are closed above.

**Assumptions.**

- **Assumes:** `faff queue-state --json` (FAFF-556) exists at build time, is pure (no tracker/network), and prints `{queue_empty, all_parked}` (both boolean) on exit 0, reading `.faff/intake` + `.faff/specs` keys against `run-ledger.json`. *Validation:* the build is serialised behind FAFF-556; before wiring, run `faff queue-state --json` in a git-only run dir and confirm exit 0 + the two boolean fields (and the fail-safe-toward-not-empty behaviour on a non-terminal key). If the shipped flag for run-scoping differs (e.g. `--run-dir`), adopt FAFF-556's documented signature.
- **Assumes:** `faff prd-checklist <path> --json` (FAFF-557) exists at build time, is pure, and prints the existing `prd-coverage` schema (object with boolean `.satisfied`, plus `.covered`/`.uncovered_goals`) on exit 0, degrading loudly (non-zero) on a non-checklist/unparseable PRD. *Validation:* serialised behind FAFF-557; before wiring, run it against a known checklist PRD and confirm exit 0 + boolean `.satisfied`, and against a non-checklist file to confirm a non-zero (loud) exit that the branch maps to `--no-prd`.
- **Assumes:** the run exposes a whole-lifecycle structural git-only signal (no resolving tracker MCP) usable to gate the branch, per the gateway's git-only mode and the `merge-gate --local` idiom. *Validation:* confirm the signal beep-boop already uses for git-only spec-store (`.faff/specs/`) selection is available at §8.5 and is lifecycle-stable, not re-sniffed per wave.
- **Assumes:** the run's existing PRD-in-scope determination is reachable at §8.5 and yields a checklist-PRD file path when a PRD is in scope. *Validation:* confirm the current `--no-prd` "unless a PRD is in scope" gate already has this determination in hand at the consult; reuse it.

## 8. DONE — Definition of Done

### From WHY
- [ ] A git-only wave-boundary stop derives emptiness via `faff queue-state` and terminates via a `faff run-done` consult (not tracker-observed emptiness).
- [ ] Every degrade path lands on the current safe git-only behaviour (not-empty and/or `--no-prd`) and provably cannot yield `run-complete` (acceptance 3).

### From WHAT (interfaces / decisions)
- [ ] The git-only branch passes `--queue-empty`/`--all-parked` as presence flags (included only when the derived boolean is true; omitted for false), never negative flags.
- [ ] The git-only branch passes **exactly one** of `--prd-coverage`/`--no-prd`, never both.
- [ ] `--prd-coverage` is only passed with a block containing a boolean `.satisfied` (pre-validated, so run-done never hits its exit-2 usage error).
- [ ] `--ledger-clean`/`--budget`/`--policy`/`--non-convergence` are assembled identically in git-only and tracker modes.

### From HOW (behaviour)
- [ ] Git-only + `queue-state {queue_empty:true}` + checklist PRD `{satisfied:true}` ⇒ consult passes `--queue-empty` + `--prd-coverage` ⇒ run-done `run-complete` (Scenario 1).
- [ ] Git-only + `queue-state` non-zero/unparseable ⇒ both emptiness flags omitted ⇒ run-done `continue`/work-remaining (Scenario 2).
- [ ] Git-only + checklist PRD non-zero/unparseable/no-boolean-`.satisfied`, or no PRD in scope ⇒ `--no-prd`.
- [ ] Git-only + PRD `{satisfied:false}` ⇒ `--prd-coverage` passed ⇒ run-done `escalate`/`product-incomplete` (holdout).
- [ ] The git-only branch reuses (references, does not copy) the existing consult's `run-done` call + `continue`/`run-complete`/`escalate` verdict branch.

### From HOW (edge cases / non-functional)
- [ ] The three tracker-mode wave-boundary bullets and the consult paragraph's non-git-only flag assembly are byte-identical (diff shows only additive git-only lines) — acceptance 2.
- [ ] The three existing "plain L3 never consults run-done" sentences (`faff-beep-boop/SKILL.md` lines ~227/~661/~683) are each scoped to the **tracker** plain-L3 path with a git-only carve-out added, so no sentence in the file contradicts the git-only-consults-run-done decision (grep the file for "never consults" / "ends by queue-emptiness" and confirm each now reads as tracker-scoped).
- [ ] The derived `--prd-coverage`/`--budget`/`--policy` values are passed to `faff run-done` as single argv elements, never spliced into a shell command string (argv-safety, infosec).
- [ ] `faff validate-adapters` exits 0 over the edited `faff-beep-boop/SKILL.md` (line-cap, paragraph, duplicated-block, stray-marker).
- [ ] The branch is gated on the whole-lifecycle structural git-only signal, asserted once, not re-sniffed per wave.

**Integration smoke test (single end-to-end happy path):**

```
GIVEN a git-only run dir where queue-state → {queue_empty:true, all_parked:false}
      and a checklist PRD file that prd-checklist → {satisfied:true, covered:true, uncovered_goals:[]}
WHEN the §8.5 git-only branch assembles RunSignals and calls `faff run-done --json`
THEN the invocation includes `--queue-empty` and `--prd-coverage '{...,"satisfied":true}'` and NOT `--no-prd`
 AND run-done's JSON verdict is `run-complete` (reason `drained`)
 AND re-running the same wave with queue-state → {queue_empty:false} instead yields verdict `continue`
```

confidence: high
spec-review: approve
