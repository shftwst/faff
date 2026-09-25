# FAFF-1119 — Slice B: governed records for push, label, ADR/PRDR, worktree-prune

> Spec: faffter-dark-nlspec · 2026-09-25 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1119.

**Artifact:** a buildable design spec (WHAT + acceptance criteria) for FAFF-1119, child of FAFF-1108, blocked by FAFF-1118 (Slice A, shipped at origin/main `e2d49d09`). **Audience:** the build agent that implements it, and the human reviewers who gate the merge. This is a design spec, not an implementation plan — it fixes the observable behaviour and the tradeoffs, and leaves file-level edits to the builder.

---

## 1. WHY — Problem and Principles

**The load-bearing model — a governed record is declare-before + observe-after around an effect, and nothing more.** faff already governs the two effects it can *mediate* pre-effect: the merge chokepoint (`faff merge-gate`) and, from Slice A, the pr-create chokepoint (`faff pr-create`). Both interpose a signed schema:3 grant *before* the effect and refuse when it is missing. This slice governs a *second class* of effect — ones the runner performs but **cannot intercept before they happen**: a `git push`, the agent's tracker label write, the git commit that lands an ADR / decisions-register entry, and the admin-metadata prune inside `faff worktree-prune`. For these there is no chokepoint to install, so the honest governance is a **record**: the runner *declares* the effect it is about to cause, causes it, then *observes* that it happened — writing a schema:2 declare/observe pair into the run's `declared-effects.jsonl` ledger. The pair makes the effect **visible** to the audit trail and to the escaped-side-effect detector; it never blocks the effect. Detection, not prevention.

**Problem statement.** Today these four effects leave no per-effect ledger trail on a governed run, so `faff effects check` / the audit trail cannot see them and cannot distinguish a sanctioned push/label/commit/prune from an escaped one. This slice adds declare-before / observe-after records around each, on governed runs only. It deliberately installs **no** chokepoint and claims **no** prevention — that would overclaim, because the runner cannot gate these effects before they occur.

**Design principles:**

**Record-only, never a gate.** These effects have no chokepoint and no schema:3 grant. A declare or observe that fails is logged to stderr and the effect proceeds regardless — it is never a precondition. Any wording, code path, or doc that implies these effects are *prevented* is wrong: they are *detected*. This mirrors the established honesty-condition pattern in `effects-reconcile.js` (`DESCRIBE_TEXT`: "DETECTION ONLY, never prevention").

**The record lives where the effect is performed.** The declare/observe pair is wired at the locus that actually causes the effect: SKILL prose (`faff-graft`) for the raw `git push` and the raw `git commit`, SKILL prose around the agent's MCP call for the label write (the agent, not any CLI, performs it), and inside the CLI for `faff worktree-prune` (which performs its own `fs.rmSync`). A component that does **not** itself perform the effect must not pretend to observe it.

**Declare before observe, always — an observe without a covering declare reads as an escape.** `computeEscapes` (effects.js) is observed-minus-declared per `(issue, step)`. Emitting the declare *before* the effect and the observe *after* is what keeps a sanctioned effect from surfacing as an escaped side-effect. The pair must always be written together on a governed run.

**Governed-run-only; byte-for-byte no-op otherwise.** Every new record is gated on the run being governed. On an ungoverned run (no schema:3 governance context) nothing is written and behaviour is byte-for-byte identical to today. This is a deliberate narrowing relative to the always-on FAFF-106 merge ledger — these records exist to complete the *governance* audit trail, not to replace the escaped-side-effect ledger.

**Reference context** (all at origin/main `e2d49d09`):

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | `EFFECT_KINDS` set, `effectDescriptorViolations`, `appendEffectEntries`, `computeEscapes`, the `faff effects declare\|observe` CLI |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `cmdPrCreate` step 5 (1755–1766) is the reference record-writer shape; the `…CoveredBySchema3Grant` suppressors are chokepoint-only |
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript | `hasGovernanceContext(runDir)` (the governed-run predicate); `cmdAdmit` and `admitted_scope` |
| `plugin/skills/faff/bin/lib/label.js` | JavaScript | PURE op-descriptor emitter — no run dir, no ledger I/O; the agent performs the MCP write |
| `plugin/skills/faff/bin/lib/worktree-prune.js` | JavaScript | `cmdWorktreePrune` — performs its own `fs.rmSync` of own dangling admin dirs; no `--run-dir` today |
| `plugin/skills/faff-graft/SKILL.md` | Markdown prose | Step 8b push, Step 9b anchor-head push, Step 4b ADR commit, Step 4c decisions-register commit, run-start admit |
| `plugin/skills/faff-beep-boop/SKILL.md` | Markdown prose | run-start admit `--scope` |

**Scope statement.** This is the OBSERVABILITY slice of FAFF-1108, sitting between Slice A (chokepoints: pr-create + merge-coupled branch-delete, shipped) and Slice C (tracker-status records, FAFF-1120).

---

## 2. OUT OF SCOPE

- **Any chokepoint, grant, or prevention for these four effects** — Why excluded: the runner cannot intercept them pre-effect; a funnel would add surface while still not preventing anything (see the push-funnel decision). Extension point: only structural mediation (an E-B-style un-performable-off-ledger target, per FAFF-1034) could ever add prevention; it is not this slice.
- **`tracker-write` records (issue status transitions)** — Why excluded: that is Slice C / FAFF-1120. Extension point: the `tracker-write` kind already exists in `EFFECT_KINDS`; Slice C wires it and adds it to the admit `--scope`.
- **The pr-create chokepoint and the merge-coupled branch-delete coattail** — Why excluded: shipped in Slice A / FAFF-1118. Extension point: `cmdPrCreate` and the `--delete-branch` authorize in the graft _Governed merge producer half_.
- **The schema:3 signed / authorized (`faff commissaire effect …`) path** — Why excluded: that is the chokepoint lineage; record-only effects use the unsigned schema:2 ledger and carry no grant. Extension point: a future slice promoting one of these to a chokepoint would add `faff commissaire effect declare/authorize/observe`.
- **Force-push, deploy, and other protected non-merge effects** — Why excluded: not among the four this slice records; `force-push` already exists as a kind but has no wiring here. Extension point: their kinds exist in `EFFECT_KINDS`; a later slice wires them.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Governed record | A schema:2 declare-before + observe-after pair in `declared-effects.jsonl` around an effect, with no accompanying grant and no gate. |
| Governed run | A run whose ledger carries a schema:3 governance context — `hasGovernanceContext(runDir)` is true; equivalently, governor material exists at `<run_dir>/commissaire/governor/governor.json`. |
| Chokepoint effect | An effect mediated pre-effect by a signed schema:3 grant (merge, pr-create). NOT in this slice. |
| Record-only effect | An effect with no chokepoint and no grant, made visible only by a governed record (push, label-write, file-write, branch-delete-via-prune). |

**The effect descriptor (unchanged shape).** Every record uses the existing `EffectDescriptor` validated by `effectDescriptorViolations`:

```
RECORD EffectDescriptor:
  kind: EffectKind       # must be a member of EFFECT_KINDS
  target: NonEmptyString # what the effect acts on
  reversible: Boolean    # optional; defaults true in normEffect
```

**`EFFECT_KINDS` — add `push`.** The set (effects.js) currently holds: `merge, branch-delete, deploy, db-migration, secret-rotation, email, webhook, registry-publish, force-push, prod-script, label-write, tracker-write, file-write, pr-create, other`. `push` is the only missing kind (note: `force-push` exists, plain `push` does not). Add `"push"` as a first-class member. `label-write`, `file-write`, `branch-delete` already exist and are reused as-is; no other kind is added.

**The four record sites, their descriptors, and their step keys** (step = the effect kind, mirroring `cmdPrCreate`'s `step="pr-create"`, so each `(issue, step)` group holds only its own kind):

| Effect | kind | step | target | reversible | Locus |
|---|---|---|---|---|---|
| Build-complete push (graft Step 8b) and anchor-head push (Step 9b) | `push` | `push` | the pushed branch ref (e.g. `<branch>`) | true | SKILL prose |
| Control-label MCP write (graft park / claim / hold / status transitions) | `label-write` | `label-write` | `<issue>:<label>` | true | SKILL prose, around the agent's MCP write |
| ADR materialisation commit (Step 4b) and decisions-register commit (Step 4c) | `file-write` | `file-write` | the committed path (e.g. `docs/adr/<n>-<slug>.md`, `docs/decisions.md`) | true | SKILL prose |
| Own dangling admin-dir prune (`faff worktree-prune`) | `branch-delete` | `worktree-prune` | the pruned worktree path | true | CLI (`cmdWorktreePrune`) |

**Record-writing surfaces (reused, effect-agnostic — do NOT modify):**

- **SKILL-prose sites** call `faff effects declare` then `faff effects observe` — the schema:2 CLI (`cmdEffects`), required flags `--issue`, `--step`, plus one of `--run`/`--run-dir`; stdin is the `EffectDescriptor[]`. No `--producer` (that is the signed schema:3 path). This is exactly the surface the existing merge schema:2 declare already uses in graft.
- **CLI site** (`cmdWorktreePrune`) calls `appendEffectEntries(runDir, "declare"|"observe", issue, "worktree-prune", [descriptor])` directly, the same in-process call `cmdPrCreate` uses at step 5.

**The governed-run predicate:**

- CLI site: `hasGovernanceContext(runDir)` from commissaire.js (already exported).
- SKILL-prose sites: the presence of `<run_dir>/commissaire/governor/governor.json`, the same idiom the existing _Governed merge / pr-create producer half_ blocks already use. (Equivalent to `hasGovernanceContext`: `cmdAdmit` writes both the governor material and a schema:3 admission record atomically.)

**`cmdWorktreePrune` interface change.** Add an optional `--run-dir DIR` flag (arity 1) to `WORKTREE_PRUNE_SPEC`. When present AND the run is governed AND at least one own dangling admin dir was actually removed, write one `branch-delete` declare/observe pair per removed entry (or one pair covering the removed set — builder's choice, provided each removed path is covered). When `--run-dir` is absent, the run is ungoverned, or nothing was removed (no ownership declared, or nothing prunable), write nothing. Adding ledger I/O here does not break any invariant: `cmdWorktreePrune` already performs I/O (`spawnSync` git, `fs.rmSync`), unlike the pure `label.js`.

**Design decisions** (full rationale in §6):

- Push funnel vs prose declare/observe → **Chosen:** prose declare/observe (no `faff push` funnel).
- Record ledger / schema → **Chosen:** schema:2 unsigned declared-effects ledger; the pair always writes on a governed run (no grant to suppress).
- Record locus → **Chosen:** the record lives where the effect is performed.
- Governance gate → **Chosen:** governed-run-only; ungoverned = byte-for-byte no-op.
- admit `--scope` → **Chosen:** add `push,label-write,file-write` (branch-delete already present; tracker-write deferred to Slice C).
- Failure handling → **Chosen:** log and proceed; never a precondition.
- Build base → **Assumes:** origin/main `e2d49d09` (Slice A / FAFF-1118).

---

## 4. HOW — Behaviour

**Architecture.** Each of the four effects gains a declare-before / observe-after bracket, gated on the run being governed. The bracket writes schema:2 records into the same `declared-effects.jsonl` the merge and pr-create schema:2 trails already use. Unlike the chokepoint effects, there is no grant and therefore no `…CoveredBySchema3Grant` suppression — record-only effects **always** write the pair on a governed run. The reference implementation is `cmdPrCreate` step 5, minus the grant guard.

**The record bracket (both loci, one shape):**

```
PROCEDURE record_effect(runDir, issue, step, descriptor, perform_effect):
  1. governed := hasGovernanceContext(runDir)      # SKILL prose: governor.json present
  2. IF governed:
     a. declare := append schema:2 declare (runDir, issue, step, [descriptor])
        IF declare failed: write ONE stderr note; DO NOT abort   # never a precondition
  3. perform_effect()                               # the push / commit / MCP write / rmSync — ALWAYS runs
  4. IF governed AND perform_effect succeeded:
     a. observe := append schema:2 observe (runDir, issue, step, [descriptor])
        IF observe failed: write ONE stderr note; DO NOT abort
```

**Behaviour summary — SKILL-prose sites (push, ADR/decisions commit, label write):** in `faff-graft`, when governor material is present, run `faff effects declare … --step <step>` before the raw effect and `faff effects observe … --step <step>` after it succeeds, piping the descriptor on stdin, resolving the run via `--run "$(basename "$run_dir")"` (or `--run-dir "$run_dir"`). A non-zero exit from either is logged to the graft log and the step proceeds — identical to how the existing merge schema:2 declare and `cmdPrCreate` step 5 swallow failures. On an ungoverned run the whole bracket is skipped and the effect is byte-for-byte today's.

**The label-write locus — resolved against `label.js` being pure.** FAFF-1119's brief points at "around `labelOp`", but `labelOp`/`cmdLabel` is a PURE op-descriptor emitter: it holds no run dir, performs no I/O beyond a config read, and does **not** perform the tracker mutation — it emits a `faff-contract:label-op` block that the agent then executes via the tracker MCP. Therefore the record cannot live in `label.js` (it would violate that purity and could only ever declare an intent, never observe a write it does not perform). The bracket instead lives in the SKILL prose at the sites that run `faff label` and then perform the MCP write, on a governed run: graft's park (`faff-parked`), claim (`faff-claimed`), hold (`faff-awaiting-review` / built-but-not-admitted), and the Step-5 / Step-9b status transitions. `label.js` is left untouched.

- **Anti-pattern:** adding a `--run-dir` and ledger write to `label.js`/`cmdLabel`. Why: it breaks the module's PURE invariant, and it would record a declare at op-emit time while the actual MCP write (and thus the honest observe point) is agent-side — an asymmetric, dishonest record.
- **Ungoverned grooming passes that write labels but have no run substrate (e.g. `/faff-tidy`'s stale sweep) are out** — no run dir / no governance context ⇒ no record, by the same governed-run gate. Not a gap.

**Behaviour summary — CLI site (worktree-prune):** `cmdWorktreePrune` resolves `--run-dir`; if present and `hasGovernanceContext(runDir)` is true, and the non-dry-run removal actually removed ≥1 own dangling admin dir, it appends a `branch-delete` declare/observe pair (declare emitted before the `fs.rmSync` loop, observe after, over the actually-removed set), via `appendEffectEntries`. A dry run, an ungoverned run, an absent `--run-dir`, or a zero-removal outcome writes nothing. The prune only ever removes **dangling admin metadata** for entries it proved it owns — never a live worktree or branch — so the `branch-delete` record documents an admin cleanup, not the deletion of a live ref.

**admit `--scope` extension.** The run-start admit currently passes `--scope merge,branch-delete,pr-create` (graft run-substrate step; beep-boop run-start). Extend it to `--scope merge,branch-delete,pr-create,push,label-write,file-write`. `branch-delete` is already present (it covers both Slice A's coattail and this slice's prune); `tracker-write` is **not** added (Slice C). Note this is metadata completeness, not a functional gate for this slice: `admitted_scope` is enforced only in `evaluateDecisionRequest` (the authorize/grant path), which record-only schema:2 effects never invoke; extending it keeps the signed admission record an honest declaration of the producer's full effect surface and future-proofs any later chokepoint promotion.

**Edge cases and error handling:**

- **Ledger append fails (unwritable/locked/torn ledger):** one stderr note; the effect still completes. Terminal for the record, never for the effect.
- **Declare written, effect then fails (push rejected, commit hook rejects, MCP write errors, rmSync throws):** no observe is written for that effect. The declared-but-not-observed entry is benign — `computeEscapes` flags escapes as observed-MINUS-declared, so an unmatched *declare* never produces an escape (only an unmatched *observe* would).
- **Effect succeeds, observe then fails:** one stderr note; a later `faff effects check` may see the effect as an uncovered observe only if the *declare* also failed — which is why the declare runs first and its failure is surfaced.
- **Ungoverned run:** no bracket at all; ledger byte-for-byte unchanged.
- **worktree-prune dry-run:** no removal, therefore no record, even on a governed run.
- **Two `file-write` effects in one issue (ADR at 4b, decisions at 4c):** they share `(issue, "file-write")`; each declare/observe matches its own by target, so no cross-contamination and no false escape.

**Failure modes — how this approach could be wrong, and how you'd notice:**

- **The failure:** the governed-run gate diverges between loci — the SKILL-prose `governor.json` check and the CLI `hasGovernanceContext` check disagree, so an effect is recorded at one locus but not another for the same run. **How you'd know:** on a governed run, `faff effects check` shows some record-only kinds present and others absent for the same `(issue)` despite all effects having occurred. **What it means:** narrow — align both loci on the same predicate (they are equivalent because `cmdAdmit` writes governor material and the schema:3 admission record together); if they cannot be kept equivalent, prefer `hasGovernanceContext` everywhere.
- **The failure:** recording an effect that already has a chokepoint schema:3 lineage (double-count). **How you'd know:** a merge or pr-create shows both a schema:3 and a schema:2 trail. **What it means:** proceed — this slice touches none of the chokepoint kinds; the only shared kind is `branch-delete`, and this slice's `branch-delete` is the *standalone worktree-prune* prune (step `worktree-prune`), distinct from Slice A's merge-coupled `--delete-branch` (step `merge`), so they never collide on `(issue, step)`.

---

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governed run (run dir carries a schema:3 governance context)
When the build-complete push at graft Step 8b runs and succeeds
Then declared-effects.jsonl gains a schema:2 declare AND a schema:2 observe for
     kind "push", step "push", with matching target
And   faff effects check reports no escape for that (issue, step)
```

```
Given effectDescriptorViolations
When it is passed { kind: "push", target: "feature-x", reversible: true }
Then it returns an empty violation list (push is a valid EffectKind)
```

```
Given a governed run invoking faff worktree-prune --run-dir <dir> --issue <ISSUE>
When the prune removes at least one own dangling admin dir
Then a schema:2 declare/observe pair for kind "branch-delete", step "worktree-prune"
     is written covering each removed path
And   when the same command removes nothing (no ownership declared, or nothing prunable),
      no branch-delete record is written
```

```
Given a governed run and any of the four record-only effects
When the declare or observe append fails (e.g. an unwritable ledger)
Then the effect (push / commit / MCP label write / prune) still completes
And   only a single stderr note is emitted (no abort, no non-zero effect outcome)
```

```
Given a label write performed during a governed run at a graft label site
When the agent performs the tracker MCP write
Then a schema:2 declare precedes it and a schema:2 observe follows it for
     kind "label-write", step "label-write"
And   label.js / cmdLabel emits its op-descriptor block unchanged (no run-dir, no ledger I/O)
```

---

## 6. Design Decision Rationale

**Does push warrant a light `faff push` funnel (a CLI wrapper), or is prose declare/observe around the raw `git push` sufficient?**
- *Option A — a `faff push` funnel.* Pro: one code locus, symmetrical with `faff pr-create`. Con: push is **multi-locus** (Step 8b build-complete, Step 9b anchor-head, and the push_at_build_complete-off compound) and **reversible**; a funnel adds a CLI surface and a new sanctioned-path invariant while still preventing nothing (there is no grant to check pre-push). It would imply a chokepoint that does not exist.
- *Option B — prose declare/observe around the existing raw `git push`.* Pro: matches the record-only reality (visibility, not prevention), keeps each push at its natural locus, adds no CLI surface, and is exactly what the FAFF-1108 umbrella spec recommends. Con: the record is prose-wired rather than centralised.
- **Chosen:** Option B — prose declare/observe around the raw `git push`, no `faff push` funnel. A funnel adds surface without adding prevention; push is multi-locus and reversible, so the honest record is a bracket at each push site (per the FAFF-1108 umbrella recommendation).

**Which ledger / schema do record-only effects use?**
- *Option A — schema:3 signed (`faff commissaire effect …`).* Con: that is the chokepoint lineage and implies a grant/authorize these effects do not have.
- *Option B — schema:2 unsigned (`faff effects declare|observe` / `appendEffectEntries`).* Pro: exactly the trail the merge and pr-create schema:2 paths already write; no grant, nothing to suppress, so the pair always writes on a governed run.
- **Chosen:** Option B — schema:2. Record-only effects carry no schema:3 grant, so unlike the chokepoint kinds there is nothing for a `…CoveredBySchema3Grant` predicate to suppress; the declare/observe pair is always written on a governed run.

**Where does the record live?**
- **Chosen:** at the locus that performs the effect — SKILL prose for push, ADR/decisions commits, and the agent's label MCP write; the CLI for `faff worktree-prune`. Rationale: only the performer can honestly observe the effect; `label.js` is pure and does not perform the label write, so its record must be agent-side in prose, while `cmdWorktreePrune` performs its own removal and records in-process.

**Are record-only effects gated on governance, or always-on like the FAFF-106 merge ledger?**
- **Chosen:** governed-run-only, byte-for-byte no-op on ungoverned runs. Rationale: these records complete the *governance* audit trail; scoping them to governed runs keeps ungoverned behaviour untouched and matches the brief. (A deliberate divergence from the always-on FAFF-106 escaped-side-effect merge ledger.)

**Which kinds does the run-start admit `--scope` add?**
- **Chosen:** add `push,label-write,file-write` (branch-delete already present; tracker-write deferred to Slice C). Rationale: keeps the signed admission record an honest statement of the producer's effect surface and future-proofs a later chokepoint promotion; it is metadata, not a functional gate for record-only effects.

**What happens when a declare/observe append fails?**
- **Chosen:** log one stderr note and proceed; never abort the effect. Rationale: these are records, not gates — mirrors `cmdPrCreate` step 5 and the merge observe, both of which swallow every failure.

Temporal anchor: at the time of writing (2026-09-25), origin/main HEAD is `e2d49d09` and carries Slice A (FAFF-1118); the local checkout predates it, so the build must branch off origin/main.

---

## 7. Open Questions and Assumptions

**Open Questions:** none. Every decision is closed (see §6).

**Assumptions:**

- **Assumes:** origin/main is at `e2d49d09` carrying Slice A / FAFF-1118 — `pr-create` is already in `EFFECT_KINDS`, `cmdPrCreate` exists as the record-writer reference, and the run-start admit already passes `--scope merge,branch-delete,pr-create`. *Validation:* `git log origin/main -1` shows `e2d49d09`; `grep pr-create plugin/skills/faff/bin/lib/effects.js` shows the kind present; branch off origin/main, not the current local checkout.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] On a governed run, each of the four effects (push, label-write, file-write, worktree-prune branch-delete) that occurs leaves a schema:2 declare/observe pair in `declared-effects.jsonl`.
- [ ] No chokepoint, grant, or pre-effect gate is added for any of the four; each effect still occurs regardless of the record.
- [ ] The wiring prose / describe surface states these effects are DETECTED (recorded), not PREVENTED — no wording implies prevention.

### From WHAT (kinds and interfaces)
- [ ] `EFFECT_KINDS` includes `"push"`; `effectDescriptorViolations({kind:"push",target:"x"})` returns `[]`.
- [ ] No new kind other than `push` is added; `label-write`, `file-write`, `branch-delete` are reused unchanged.
- [ ] `cmdWorktreePrune` accepts `--run-dir DIR`; the CLI usage/spec lists it.
- [ ] `label.js` / `cmdLabel` is unchanged (no `--run-dir`, no ledger I/O); it still emits the `faff-contract:label-op` block.
- [ ] The run-start admit `--scope` in both `faff-graft` and `faff-beep-boop` reads `merge,branch-delete,pr-create,push,label-write,file-write`.

### From HOW (behaviour)
- [ ] SKILL-prose sites (Step 8b push, Step 9b anchor-head push, Step 4b ADR commit, Step 4c decisions commit, graft label-write sites) run `faff effects declare` before and `faff effects observe` after the effect, gated on `governor.json` presence.
- [ ] The `worktree-prune` `branch-delete` pair is written only on a governed run with `--run-dir`, and only when ≥1 own dangling admin dir was actually removed (never on dry-run, ungoverned, absent `--run-dir`, or zero-removal).
- [ ] The declare is emitted before the effect and the observe after, so `computeEscapes` reports no escape for a sanctioned effect.
- [ ] The `worktree-prune` `branch-delete` (step `worktree-prune`) never collides with Slice A's merge-coupled `branch-delete` (step `merge`).

### From HOW (edge cases)
- [ ] A declare/observe append failure emits one stderr note and the effect still completes with its normal exit outcome.
- [ ] On an ungoverned run, `declared-effects.jsonl` is byte-for-byte unchanged for all four effects.
- [ ] A declared-but-not-observed effect (effect failed after declare) produces no escape signal.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed by this slice; no grader registration required.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. Init a governed run dir (admit it: schema:3 context present).
  2. Run faff worktree-prune --run-dir <dir> --issue <I> against a fixture with one own
     dangling admin dir.
  3. Read declared-effects.jsonl:
     ASSERT one schema:2 declare AND one schema:2 observe, kind "branch-delete",
            step "worktree-prune", target = the removed path.
  4. Run the same command against a run dir with NO schema:3 context.
     ASSERT declared-effects.jsonl gained zero new records.
```

## Methodology critique

*Lens: `faffter-dark-methodology-agile-delivery` · `issue-critique`. Advisory — surfaces for `/faff-wtf` and the human build gate.*

**Right-sized? (P4)**
- *What's there.* One issue bundling four effect record-sites (push, label-write, file-write for ADR/PRDR, branch-delete for worktree-prune) plus the `push` EFFECT_KINDS addition and the `admit --scope` extension.
- *Why it holds together.* All four sites converge on a single outcome — complete record-only observability of the remaining effects — and share one mechanism (schema:2 declare-before/observe-after pairs, gated on governed run, byte-for-byte no-op ungoverned). They share one done-bar. Splitting them would produce fragments that don't ship standalone observable value and each re-pay the governed-run gating setup for a partial picture. The repetitive sites are near-free once Slice A's pr-create pattern is in place, so the real work is the two novelties — keeping the whole inside a 1-3 day unit.
- *What to do.* Keep it as one increment — do not split. Merge-appropriate, not split-appropriate.

**Workstream fit? (P1 + P5)**
No issues. Named as the observability slice under FAFF-1108's A→B→C decomposition; the "governed records / observability" head is an outcome, not an activity bucket, and all four record-sites serve that one outcome (cohesive — single DoD, no catch-all).

**Deps surfaced? (P6)**
No issues. `blockedBy` FAFF-1118 (Slice A) is an explicit link and is merged, so the issue is actionable now. The spec's reliance on Slice A's pr-create pattern and EFFECT_KINDS is exactly that satisfied blocker; nothing else is referenced without a link (tracker-write is deferred forward to Slice C, not a dependency of B).

**Risk profile? (P7)**
- *What's there.* Three of the four sites are low-risk repetitive declare/observe, de-risked by the proven Slice-A pattern. The surprise-carrying work is the two novelties: the label-write purity resolution (declare/observe as SKILL prose around the agent MCP write, `label.js` kept pure) and the worktree-prune `--run-dir` flag threading governance context into `cmdWorktreePrune`.
- *Why it matters.* If either novelty surprises, building the three cheap sites first pushes that surprise to the end. The purity call is already a resolved major in the spec, and `--run-dir` is contained parameter-passing — so neither warrants a separate de-risking spike.
- *What to do.* Sequence the two novelties first within the build (label-purity, then `--run-dir`), then the repetitive record-sites, so any residual surprise lands early. No spike needed.


confidence: high
spec-review: approve
build-tier: complex
