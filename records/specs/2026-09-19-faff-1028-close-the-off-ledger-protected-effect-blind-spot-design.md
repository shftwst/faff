# Close the off-ledger protected-effect blind spot in `effects check`

> Spec: faffter-dark-nlspec · 2026-09-19 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1028.

This spec addresses FAFF-1028 for the build agent and human reviewers. It closes the fail-open hole where a protected merge performed **entirely outside** the governed path is invisible to governance, and an empty declared-effects ledger reads as clean. Revision 2 folded in the spec-review round-1 refutations (always-on run-scoped git branch-advancement reconcile, forge demoted to optional attribution, recorded base anchor a hard input, residual auditee-writable limitation named). Revision 3 folded in the operator's 2026-09-15 direction-settled decision (ship interim detection now; two standing design-lens blockers recorded as accepted known limits; honesty condition a DONE criterion). Revision 4 folded in the operator's 2026-09-16 resolution of the four round-3 spec-review objections. Revision 5 applied the round-1 lensed fixes (first-parent landing predicate; `merge-record.json.head_sha` cross-match source; integrity-residual note). **Revision 6 applies the round-2 (revise) lensed fixes in place**: the landing/coverage **unit** is now the branch-advancement **segment** (not per-commit), so a governed multi-commit rebase / local-ff-only landing is one covered unit rather than N−1 false-flagged escapes; the stale Assumption-4 wording is corrected; and `merge-record.json` is added to the integrity-residual note. Every non-trivial decision carries a `**Chosen:**` marker and the rating is `confidence: high`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `faff effects check` is a *comparison* detector, not an *observation* detector. It groups the declared-effects ledger by `(issue, step)` and emits an escaped-side-effect signal only for effects **observed into the ledger** but not declared (`computeEscapes`, `plugin/skills/faff/bin/lib/effects.js:87-103`). An effect never observed into the ledger produces no group, no comparison, and no signal — the detector cannot see what never touched it.

**The fail-open.** Two facts compose into the blind spot: (1) an empty/missing ledger is treated as CLEAN (`effects.js:~624`, selftest `~731` `empty ledger => clean`); (2) escape detection compares *observed* effects against declarations, so an effect performed entirely off the governed path is never observed and produces no escape. beep-boop bridges `any_escape` into Sentry every checkpoint (`plugin/skills/faff-beep-boop/SKILL.md:107`), so the fail-open reaches the kill-switch. Net today: "no effects were governed" is indistinguishable from "no effects happened."

**Principle.** A protected effect that landed on ground truth (the protected branch) but is not covered by the ledger must read as an escape, not as clean. The kill-switch must be decoupled from forge uptime and must never coerce a read fault to clean.

**Reference context.**

| Anchor | Kind | Why it matters |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js:87-103` (`computeEscapes`) | code | The pure comparison core — untouched by this slice |
| `plugin/skills/faff/bin/lib/effects.js:81-83` (`effectTargetMatches`) | code | The shared target-match predicate the coverage rule reuses (incl. `"*"` wildcard) |
| `plugin/skills/faff/bin/lib/effects.js:~624`, `~731` | code | `empty ledger => clean` — correct for the pure core, the hole at the run level |
| run-ledger `admitted` / (new) `base_sha` | JSON | This run's attribution scope + the reconcile's lower bound |
| `plugin/skills/faff-beep-boop/SKILL.md:107` | prose | The checkpoint that runs `faff effects check` and bridges `any_escape` into `faff sentry check --forbidden-side-effect` |

**Scope statement.** The detection-hardening half of the governed-effects layer (FAFF-43 / FAFF-106 lineage); it closes the direct-git bypass FAFF-1012 left open and feeds the existing `any_escape` → Sentry seam.

## 1a. OPERATOR DIRECTION — settled (folded)

Two operator decisions from interactive walkthroughs of parked work are the authoritative closures below.

**2026-09-15 (`## Direction settled … ship the interim detection`) — `Chosen:` Ship the interim off-ledger detection now, accepting the documented auditee-writable-ledger residual and the attribution/run-window limits as KNOWN LIMITS — not defects to fix in this ticket. Do not hold this ticket for the structural E-B mediation.** Rationale (operator): today an empty declared-effects ledger reads as clean — the wrong default in the wrong direction. A detector that catches the non-adversarial cases is a real improvement, and it stays useful after prevention (E-B) lands.

**2026-09-16 (`## Decision … resolve the four round-3 objections`) — the four points the 2026-09-15 12:28 spec-review raised are settled**; each is folded at its home section below and summarised in §6. The scope decision above is unchanged; these settle the design-lens objections that stood on top of it.

### Accepted known limits (were the round-2 standing blockers)

Recorded as **accepted residuals with named boundaries**, per the operator decision — the next build must implement detection as specified and **document** these limits, not attempt to engineer them away.

- **Accepted limit A (infosec — was blocker).** The ledger the reconcile judges against is writable by the same actor authorised to merge, so an actor who declares one thing and merges another is not caught. This is inherent to *detection*. Only structural mediation (making the merge un-performable off-ledger — the E-B target, OUT OF SCOPE) closes it. FAFF-1034 (settled to option 2: governor key outside the run dir, public half pinned in the repo) makes a *forged decision record* detectable; this ticket makes an *effect performed with no record at all* detectable. The two compose as detection layers; genuine prevention remains FAFF-1034 option 1 and is out of scope for both.
  - **Sub-note (folded 2026-09-19, spec-review infosec observation — non-gating, within limit A).** The reconcile's new trusted inputs — `base_sha`, the post-feature mint marker (both in `run-ledger.json`), and `merge-record.json.head_sha` (the forge-outage coverage source) — are **not** covered by the FAFF-621 hash chain (step 3 verifies only `declared-effects.jsonl`). An actor with ledger write can strip the mint marker (→ `legacy_exempt`, clean), advance `base_sha` (→ shrink `base..head`, hiding a landing), or forge a `merge-record.json` (→ spoof coverage of an off-ledger landing). All are the same auditee-writable-ledger vector as limit A, so they are an **accepted residual**, not a new defect — but the honesty-condition docs must name them explicitly (see DONE §From WHY). Chaining these into an integrity anchor is FAFF-621's lineage / the E-B work, OUT OF SCOPE here.
- **Accepted limit B (architectural — was blocker/major).** Attribution and run-window reliability for an ungoverned run: the run-ledger records no base sha today (this slice adds `base_sha` at mint as a hard input and faults non-clean when absent on a post-feature run), and branch→run attribution on a shared protected branch is heuristic (issue-branch / issue-key). The reconcile prefers under-attribution surfaced as a fault over cross-run false positives, and an unattributable in-window landing is surfaced (not dropped) — see §4.

### Honesty condition (a DONE criterion)

This ships **only** with the residual written down where a reader meets the feature — not buried in a tracker thread. The docs must state, in the terms above, **what the detector catches and what it does not**: it detects an off-ledger / undeclared landed merge after the fact; it does **not** prevent a declare-then-merge-off-ledger actor, and it is detection, **never** prevention. Shipping detection while implying prevention is the exact failure FAFF-1034 warns against. See DONE §From WHY.

## 2. OUT OF SCOPE

- **Structural E-B mediation of merge (V5) — the real closure of the trust gap.** Making the merge *impossible* off-ledger (mediated so it "could not occur through the governed path unless the gateway allowed it") is the only thing that closes accepted limit A. **Excluded:** a V5 architecture epic. **Extension point:** the Commissaire protected-effect decision path (`plugin/skills/faff/bin/lib/commissaire.js`) + the `merge-gate.js` chokepoint.
- **Enforcing the governed pipeline against hand-rolled orchestrator loops.** The incident's direct-git merge came from an unenforced loop; making delegation enforceable is FAFF-1027 (related). **Extension point:** FAFF-1027.
- **Non-merge protected effects (deploy, secret-rotation, registry-publish, force-push, prod-script).** Same blindness in principle, different ground-truth source each, no field incident yet. **Excluded:** keep the interim narrow. **Extension point:** per-kind ground-truth adapters behind the same reconcile.
- **Changing the pure `computeEscapes` core or its `--selftest` cases.** **Excluded:** the pure comparison stays; `empty ledger => clean` remains correct *for the pure core*. **Extension point:** the reconcile layer wraps it.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Off-ledger effect | A real protected effect that never entered the declared-effects ledger (neither declared nor observed) |
| Landed merge | A commit on the protected branch's **first-parent** history within the run window (`base..head --first-parent`): a 2-parent merge, a squash/rebase landing, or a direct-git commit that advanced the protected branch. Every such commit *is* a landing by construction — the protected branch only advances by landings; an ordinary feature-branch commit is not on this first-parent line and is excluded structurally (see the landing predicate, §3) |
| Base anchor | The commit sha the protected branch pointed at when the run started — the reconcile's lower bound |
| Attribution | Deciding a landed commit belongs to this run (via its admitted issue branch / issue key / patch-id), so a concurrent run's merge is not this run's escape |
| Unattributable landing | An in-window landing on the protected branch that is a landing but carries no derivable issue key/branch — surfaced as `uncovered` with `issue: null` (never dropped) |
| Reconcile | Comparing this run's landed merges against the ledger's declared/observed merge effects, emitting an escape for any uncovered landed merge |

**Types.**

```
RECORD LandedMerge:                # represents ONE branch-advancement SEGMENT, not a single commit
  target: String               # canonical target key: "pr:<N>" when forge enrichment resolved one, else "commit:<sha>"
  commit: String               # the segment's tip (head) commit sha — the representative/primary signal
  segment_base: String         # the segment's lower-bound commit sha (base..head_sha range); == prior segment tip
  issue: String | null         # the admitted issue this segment is attributed to; null when unattributable (still surfaced)
  detail: String               # sanitised human-legible label (control chars collapsed, truncated to 200 bytes); see sanitisation
  landed_at: Timestamp | null

RECORD ReconcileResult:
  reconciled: Bool             # true iff the PRIMARY (git) read succeeded AND a base anchor resolved (or the run is legacy-exempt)
  uncovered: List<LandedMerge> # this run's landed merges (incl. unattributable in-window landings) with no covering ledger entry
  any_escape: Bool             # uncovered.length > 0
  fault: String | null         # set when the primary read failed or a post-feature run has no base anchor; reconciled == false
  forge_enriched: Bool         # false when the optional gh enrichment was unavailable (NOT a fault)
  legacy_exempt: Bool          # true when a pre-feature run (no base anchor, minted before this slice) is skipped as legacy (NOT a fault)
```

**Base anchor recording + upgrade migration (a hard input this slice must add).** The run-ledger records no base sha today, so the reconcile has no trustworthy lower bound. **Chosen:** record `base_sha` (the protected branch's sha at run mint) into `run-ledger.json` at mint time, and have the reconcile read it.

- **Post-feature run, `base_sha` present** → reconcile against `base..head` normally.
- **Post-feature run, `base_sha` absent** → `reconciled:false, fault:"no base anchor"` — **non-clean**, never a silent clean. This is the genuinely-ungoverned run the ticket targets.
- **Pre-feature (legacy) run** → a run minted *before* this slice shipped has no `base_sha` and could not have had one. **Chosen (operator 2026-09-16, point 3):** treat it as **legacy-exempt** (`reconciled:true, legacy_exempt:true, any_escape:false, fault:null`), NOT a fault — so deploying this change does not trip Sentry on every in-flight pre-upgrade run. The discriminator is a **mint-era marker**: the mint path stamps a marker at run creation *after this feature lands* (e.g. a `base_sha_required:true` field written alongside `base_sha`, or the ledger schema/feature version). A run whose ledger carries the post-feature mint marker but lacks `base_sha` is a genuine fault; a run lacking the marker entirely is legacy-exempt. The discriminator MUST be a mint-time fact, never inferable from `base_sha` presence alone (which is exactly what the incident lacked).

Rationale: a detector keyed on an unbounded or guessed window is exactly the unreliability the incident exposed; a recorded anchor is deterministic, and the mint-era marker lets a genuine post-feature ungoverned run fault while a pre-feature run is exempted rather than false-positive-killed on deploy.

**CLI surface. Chosen:** a new subcommand `faff effects reconcile-merges --run <id>|--run-dir <dir> [--issue <ISSUE>] [--json]` returning `ReconcileResult`, dispatched into the impure reconcile lane (audit.js or a new `effects-reconcile.js`) so the pure `effects.js` core is untouched and the pure/impure boundary is visible at the command name. `--issue <ISSUE>` narrows **both** the attribution set and the ledger read to that single issue (used by a per-issue caller); omitted, all admitted issues are in scope. Rationale: a distinct verb keeps `check` pure and cheap.

**Landing predicate (git-only, forge-independent) — the primary detector.** The first-parent range `git rev-list base_sha..head --first-parent` on the protected branch is the raw advancement set: every commit on it advanced the protected branch (a 2-parent merge, a squash landing, or a direct-git commit), and a feature-branch commit is **never** on it (first-parent traversal never descends into a merged-in side branch), so it is excluded **structurally** — no per-commit merge test, no forge query. This resolves the squash-vs-ordinary-commit ambiguity: the discriminator is "did it advance the protected first-parent line in-window," not git-intrinsic merge-ness.

**The landing UNIT is a segment, not a single commit (Chosen).** A single governed landing can advance the protected branch by **more than one** first-parent commit — `merge-gate` sanctions `--rebase` and the FAFF-875 local **ff-only** base-advance, each of which lays down N linear first-parent commits for one PR/merge while recording exactly one declared `pr:<N>` and one `merge-record.json` (`head_sha` = the segment tip, `merge-gate.js:~475/~1133`). Treating each first-parent commit as a separate landing would false-flag the N−1 non-tip commits of a **governed** merge as uncovered escapes (worst on a no-remote repo, where local ff-only is the *only* sanctioned merge and is independent of `gh` uptime). **Chosen:** the landing unit is the **branch-advancement segment** — a contiguous run of first-parent commits that advanced the protected branch as one landing. Segments are cut as: (i) each governed landing's `merge-record.json` bounds its segment (`base..head_sha` range); (ii) the remaining first-parent commits are grouped into segments by **contiguous attribution** (the same admitted issue, via merged branch name / issue key / patch-id), with a contiguous run of unattributable commits forming one `issue:null` segment. Each `LandedMerge` record represents **one segment** (its tip commit is the representative `commit`; `target` is the segment's `pr:<N>`/`commit:<sha>`). Attribution and coverage then operate on the segment — so a governed multi-commit rebase / ff-only landing is one covered unit, the incident's direct-git merge is one uncovered `issue:null` segment, and the kill-switch is never tripped by the internal commit count of a governed merge.

**Coverage rule (the matching predicate, per-segment, with forge-outage cross-match).** A landing **segment** is *covered* when **this run's** ledger holds a `declare` **or** `observe` merge effect (`effect.kind == "merge"`) that matches it, by **either**:

- **attribution match** — the segment is attributed to an admitted issue that has a declared/observed merge effect for that issue (a governed multi-commit rebase / ff-only landing is one segment covered by its one declared `pr:<N>`, whatever its internal commit count); **or**
- **target match** — the shared `effectTargetMatches` rule (`effects.js:81-83`) matches the segment's `pr:<N>`/`commit:<sha>` target or a `"*"` wildcard, **extended to cross-match the two canonical target forms** (Chosen, operator 2026-09-16, point 2): a `pr:<N>` declaration covers a segment whose target fell back to `commit:<sha>`, and vice versa.

**The equivalence source (grounded in the code):** FAFF-1012's merge-gate auto-declaration records only `target: "pr:<N>"` in the declared-effects ledger (`merge-gate.js:~719`), but it also writes the landing commit sha as `head_sha` into the run's `merge-record.json` (`merge-gate.js:~475`). The reconcile resolves the `pr:<N>` ↔ `commit:<sha>` equivalence from (i) the forge enrichment map when `gh` is up, else (ii) **`merge-record.json.head_sha`** — always present for a governed merge-gate landing regardless of forge uptime. So a governed landing stays covered during a `gh` outage; the kill-switch is never coupled to forge uptime. **Degrade branch (fail-safe):** an **unattributable** segment (no admitted issue) with neither a matching target declaration nor a `merge-record.json` entry cannot be cross-matched — that is under-coverage, surfaced as an uncovered escape (fail-safe), never a silent clean. Uncovered ⇒ escape.

**`detail` sanitisation (untrusted input, bounded).** A PR title / commit subject is attacker-influenceable (public-repo PRs) and flows into logs/Sentry, so it is **data, never instructions** (gateway no-execute floor): collapse newlines/control characters to spaces and **truncate to a fixed 200-byte bound** (UTF-8-safe, no split multibyte) before storing in `detail`. The `target`/`commit`/`issue` fields are faff-derived, not free-text.

## 4. HOW — Behavior

**Architecture.** A new impure reconcile enumerates this run's landed merges from git (primary) and diffs them against this run's declared/observed merge effects with the extended `effectTargetMatches` predicate. The pure `computeEscapes` is untouched. The forge is queried only to *label* landings with PR numbers and to resolve the `pr:<N>` ↔ `commit:<sha>` equivalence. The reconcile's `any_escape` (or a primary-read fault) is OR-combined with the pure `check`'s `any_escape` at the beep-boop checkpoint, so the Sentry bridge fires on an observed-but-undeclared escape (today) or an off-ledger landed merge (new).

```
PROCEDURE reconcile_merges(run_dir, issue_filter?):
  1. IF run is pre-feature legacy (no post-feature mint marker) →
        return { reconciled:true, legacy_exempt:true, uncovered:[], any_escape:false, fault:null, forge_enriched:false }
  2. base := read run-ledger base_sha; head := protected-branch HEAD.
     IF base is absent/unresolvable (post-feature run) → return { reconciled:false, uncovered:[], any_escape:false,
                                               fault:"no base anchor", forge_enriched:false, legacy_exempt:false }  # non-clean
  3. chain_ok := (faff effects verify == verified)      # FAFF-621 hash chain
     IF NOT chain_ok → return { reconciled:false, …, fault:"ledger chain broken/tampered" }                          # non-clean
  4. admitted := run-ledger admitted issues (∩ {issue_filter} when given)
  5. fp := `git rev-list base..head --first-parent` on the protected branch (the raw advancement set).
        # Feature-branch commits are NOT on the first-parent line — excluded structurally, no forge query,
        # never `git log --merges` alone (a squash/direct landing is not a merge commit).
     segments := partition fp into branch-advancement SEGMENTS:
        (i) each governed landing's merge-record.json bounds a segment (its base..head_sha range);
        (ii) group the remaining first-parent commits into segments by contiguous attribution to the same
             admitted issue (merged branch name / issue key / patch-id); a contiguous run of unattributable
             commits forms one issue:null segment.
     Each segment => one LandedMerge (tip commit = representative). An unattributable segment KEEPS issue:null
        (NEVER dropped). # PRIMARY, always-on, local git.
  6. FOR each segment: resolve the pr:<N>↔commit:<sha> equivalence and a sanitised title from
        (i) the forge enrichment map when gh is up, else (ii) merge-record.json.head_sha (always present for a
        governed merge-gate landing). On gh failure set target "commit:<sha>", forge_enriched=false (NOT a fault).
  7. declared := this run's ledger merge effects (declare + observe), scoped by issue_filter when given.
  8. uncovered := [ s for s in segments if NOT covered(s) ], where covered(s) is TRUE iff
        (a) s.issue is an admitted issue with a declared/observed merge effect for that issue  # attribution match
        OR (b) any(d in declared where d.kind=="merge"
                  and effectTargetMatches(d.target, s.target OR "commit:"+s.commit, cross_match=pr<->commit)).
     # a governed multi-commit rebase/ff-only landing is ONE covered segment; an unattributable, undeclared
     # segment (the incident) is uncovered → escape.
  9. return { reconciled:true, uncovered, any_escape: uncovered.length>0, fault:null, forge_enriched, legacy_exempt:false }
```

**Checkpoint wiring (beep-boop `SKILL.md:107` and the parallel poll loop) — live per-checkpoint cadence.** **Chosen (operator 2026-09-16, point 4):** the reconcile runs **live at each beep-boop checkpoint**, matching the kill-switch's intent to catch an off-ledger merge mid-run. It is cheap, local (git), and run-scoped, so per-checkpoint is affordable. A run-end final reconcile is **not required** for this increment (a belt-and-braces run-end reconcile aligned with FAFF-397 may be added later, out of scope here). After the existing `faff effects check`, run `faff effects reconcile-merges --run <id> --json`. Combine: `forbidden := check.any_escape OR reconcile.any_escape OR (reconcile.reconciled == false)`. Pass `--forbidden-side-effect` to `faff sentry check` iff `forbidden`. A `reconciled == false` (primary-read fault or missing base anchor on a post-feature run) is non-clean and logged. A `legacy_exempt == true` is clean (logged as exempt). A `forge_enriched == false` is logged only — never contributes to `forbidden` (the kill-switch is not coupled to forge uptime).

**Edge cases.**

- **Empty ledger, no landings** → `check` clean, `reconcile.uncovered == []` → clean. The pure `empty ledger => clean` case (`effects.js:731`) is unchanged; only a real off-ledger landing breaks it.
- **Merge through `merge-gate`** → FAFF-1012 auto-declared `pr:<N>` + observed it, and wrote `merge-record.json.head_sha` → the landing cross-matches the declared `pr:<N>` effect via the forge map (gh up) or `head_sha` (gh down) → not uncovered. No double-flag, no forge-outage false flag.
- **Unattributable in-window landing (the incident case)** → a direct-git merge whose commit carries no issue key/branch → surfaced as `uncovered` with `issue:null` → `any_escape:true` → Sentry fires. This is the load-bearing fix.
- **Concurrent run on the same protected branch** → its merge is a different (non-admitted-here) issue branch, attributable to that other run → not this run's escape. (An in-window commit attributable to *no* admitted issue at all is the unattributable case above.)
- **Covered by `observe` only, or `declare` only, or a `"*"` wildcard** → each independently covers per `effectTargetMatches`.

**Failure modes.**

- **The failure:** attribution mis-maps a landing to the wrong run (branch naming ambiguous). **How you'd know:** an `uncovered` entry whose `issue` is not in this run's `admitted`, or a known in-run merge missing from `landings`. **What it means:** narrow — tighten the branch/issue-key attribution; prefer under-attribution surfaced as a fault/uncovered over cross-run false positives. (Accepted limit B, documented not eliminated.)
- **The failure:** `base_sha` is recorded but stale (branch rebased), so `base..head` spans unrelated commits. **How you'd know:** implausibly many landings, many unattributable. **What it means:** the base-anchor recording (WHAT) must capture the sha at mint and not be rewritten mid-run.
- **The failure:** the interim detector is bypassed by an actor who `declare`s the merge it is about to perform off-ledger (the ledger is writable by the merge authority). **How you'd know:** a covered merge with a declare whose provenance is the merge actor itself, no merge-gate `origin`. **What it means:** this is **accepted limit A** — the accepted limitation of *detection*; only the structural E-B mediation (OUT OF SCOPE) closes it. Do not attempt to engineer it away; document it (DONE §From WHY).

**Anti-pattern:** coercing a primary-read fault or missing base anchor (on a post-feature run) to `any_escape:false`. Why: recreates the fail-open. **Anti-pattern:** dropping an unattributable in-window landing. Why: the incident commit carried no issue key — dropping it re-creates the exact fail-open. **Anti-pattern:** flagging an ordinary feature-branch commit as a landing. Why: floods the kill-switch with false escapes; the first-parent predicate (§3) excludes feature-branch commits structurally — do not fall back to a per-commit merge-ness test (it cannot see a squash/direct landing). **Anti-pattern:** keying detection on `git log --merges` alone or on the forge query. Why: squash and direct-git landings are ordinary commits and a direct-git merge is never in the forge. **Anti-pattern:** letting a `gh` enrichment failure trip the kill-switch or flag a governed landing. Why: couples run liveness/coverage to forge uptime for no detection gain. **Anti-pattern:** faulting every pre-upgrade in-flight run on deploy. Why: violates the migration decision (§3) — a pre-feature run is legacy-exempt. **Anti-pattern:** shipping the detector while documenting or implying it *prevents* off-ledger merges. Why: violates the operator honesty condition (§1a).

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run whose orchestrator merged an admitted issue's PR via direct git (no declare, no observe) and base_sha is recorded
When faff effects reconcile-merges runs for that run
Then the landing appears in uncovered (target "commit:<sha>" or "pr:<N>") and any_escape is true
```

```
Given a run whose orchestrator landed a commit on the protected branch in-window that carries NO derivable issue key/branch
When faff effects reconcile-merges runs
Then the landing appears in uncovered with issue:null (never dropped) and any_escape is true
```

```
Given a run with an in-window commit on an admitted issue's FEATURE branch that has not landed on the protected branch (not on base..head --first-parent)
When faff effects reconcile-merges runs
Then that commit is NOT on the protected first-parent line, is NOT a landing, and does not appear in uncovered
```

```
Given a PR merged through faff merge-gate (FAFF-1012 auto-declared pr:<N> + observe, and merge-record.json.head_sha written) but gh is down so the reconcile's own target falls back to commit:<sha>
When faff effects reconcile-merges runs
Then the pr:<N> declaration cross-matches the commit:<sha> landing via merge-record.json.head_sha, uncovered is empty, and any_escape is false (forge outage never a false escape)
```

```
Given an unattributable in-window segment with neither a forge resolution nor a merge-record.json entry (not a governed merge-gate landing) and no covering declaration
When faff effects reconcile-merges runs
Then the segment cannot be cross-matched, is surfaced as uncovered (fail-safe under-coverage), and any_escape is true — never a silent clean
```

```
Given a governed multi-commit landing (merge-gate --rebase or the FAFF-875 local ff-only base-advance) that advanced the protected branch by N first-parent commits, with one declared pr:<N> and one merge-record.json (head_sha + base)
When faff effects reconcile-merges runs
Then the N commits form ONE segment covered by the single declared merge (by attribution or head_sha cross-match), uncovered is empty, and any_escape is false — the internal commit count never trips the kill-switch
```

```
Given two runs sharing the protected branch, and run B merged its own admitted issue off-ledger
When faff effects reconcile-merges runs for run A (which did not merge)
Then run B's landing is attributed to run B, not to run A, and run A's any_escape is false
```

```
Given a landed merge covered by an observe-only entry, a declare-only entry, or a "*" wildcard declaration (three sub-cases)
When faff effects reconcile-merges runs
Then each is covered and any_escape is false
```

```
Given a post-feature run-ledger (carries the post-feature mint marker) with no base_sha
When faff effects reconcile-merges runs
Then reconciled is false, fault names the missing base anchor, and the checkpoint treats the run as NON-clean
```

```
Given a pre-feature (legacy) run minted before this slice, with no base_sha and no post-feature mint marker
When faff effects reconcile-merges runs
Then legacy_exempt is true, reconciled is true, any_escape is false, and the checkpoint does NOT trip Sentry (no false positive on deploy)
```

- The reconcile MUST NOT mutate any ledger, run artifact, or git state (read-only, like `audit` / `effects check`).
- `detail` MUST contain no raw newlines/control characters and MUST be ≤ 200 bytes (UTF-8-safe truncation).

## 6. DESIGN DECISION RATIONALE

**Interim detection vs holding for structural E-B mediation.** **Chosen (operator, 2026-09-15):** ship the interim off-ledger detection now and record the auditee-writable-ledger residual + attribution/run-window limits as accepted known limits (§1a), rather than holding for the structural E-B fix or engineering the residual away. Rationale: the current default (empty ledger reads clean) is wrong in the dangerous direction; detection of the non-adversarial cases is a real improvement and survives after prevention lands.

**Unattributable in-window landing → uncovered `issue:null`, not dropped (the load-bearing correctness call).** **Chosen (operator, 2026-09-16, point 1):** a commit on the protected branch inside the run window that is a landing but cannot be attributed to this run and is not covered by the ledger is emitted as an uncovered landed merge with `issue:null`, so `any_escape` is true and the Sentry bridge fires. It is never silently dropped. This resolves the round-3 blocker: the earlier "drop commits not attributable to this run" wording contradicted the Failure-modes "surface under-attribution as a fault" and would have re-created the fail-open (the incident's direct-git commit carried no issue key). Landing detection is guarded so ordinary non-merge commits are not flagged.

**Coverage cross-match so the kill-switch is decoupled from forge uptime.** **Chosen (operator, 2026-09-16, point 2):** coverage cross-matches `pr:<N>` ↔ `commit:<sha>`, so a governed merge-gate landing (FAFF-1012 auto-declares `pr:<N>`) is covered even when a `gh` outage forces the reconcile to `commit:<sha>`. The equivalence is resolved from the forge map when up, else from **`merge-record.json.head_sha`** (`merge-gate.js:~475`) which a governed merge-gate landing always writes regardless of forge uptime — the FAFF-1012 ledger auto-declaration itself records only `pr:<N>` (`merge-gate.js:~719`), so `head_sha` is the load-bearing outage-path source, not the ledger entry. A landing with neither forge nor `merge-record.json` cannot be cross-matched and is surfaced as uncovered (fail-safe). Resolves the round-3 major that a form-exact match false-flags a governed landing on a forge outage.

**Landing predicate: protected-branch first-parent history vs per-commit merge test.** A per-commit merge-ness test cannot distinguish a squash/direct-git landing (single-parent) from an ordinary commit, and the forge is optional, so neither can be the discriminator. **Chosen:** walk the protected branch's first-parent history over `base..head` — every commit on that line advanced the protected branch and is a landing; a feature-branch commit is never on it (first-parent skips merged-in sides) and is excluded structurally. Resolves the round-3 blocker (the primary detector's landing predicate was undefined for the squash-vs-ordinary case) and makes the "landing" vs "not a landing" ACs decidable without the forge.

**Upgrade migration — legacy-exempt vs genuine fault.** **Chosen (operator, 2026-09-16, point 3):** a run minted before this feature ships has no `base_sha` and is treated as legacy/exempt (not a fault), via a mint-era marker; only a run minted after the feature lands is required to carry `base_sha` (absent then is a genuine fault). Resolves the round-3 major that deploying the change would otherwise trip Sentry on every in-flight pre-upgrade run.

**Cadence — live per-checkpoint.** **Chosen (operator, 2026-09-16, point 4):** the reconcile runs at each beep-boop checkpoint, matching the kill-switch's intent to catch an off-ledger merge mid-run. It is cheap, local, and run-scoped, so per-checkpoint is affordable; a run-end final reconcile is not required for this increment. This closes the last open architecture Punt (§7), so the spec rates `confidence: high`.

**Primary ground truth: git branch-advancement vs forge merged-PR query.** A forge query cannot see a direct-git merge (never marked merged) and is not always present; `git log --merges` alone misses squash landings. **Chosen:** always-on local git branch-advancement over `base..head` as the primary detector; the forge is optional enrichment (commit → `pr:<N>` label + equivalence) whose failure is not a fault.

**Attribution scope: this run's admitted issues vs every PR on the branch.** Matching every merged PR on a shared protected branch against one run's ledger false-positive-kills concurrent runs. **Chosen:** attribute landings to this run via its admitted issue branches and reconcile only those; a concurrent run's merge is out of scope for this run; an in-window landing attributable to no admitted issue is surfaced as `issue:null`.

**Base anchor: recorded vs inferred.** **Chosen:** record `base_sha` at run mint and fault (non-clean) when absent on a post-feature run — a deterministic bound, no silent clean on the very ungoverned run this targets.

**Where the impure read lives.** **Chosen:** the reconcile lane via a distinct `faff effects reconcile-merges` verb; the pure `computeEscapes` core is untouched.

**Kill-switch coupling to the forge.** **Chosen:** only the primary git read / base anchor can set `forbidden`; a forge enrichment failure logs and degrades labels but never trips Sentry — the kill-switch stays decoupled from forge uptime.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — all prior Punts are settled by the operator.

- **Chosen (operator, 2026-09-15):** Detection-only for this ticket — ship the interim off-ledger detection accepting the documented residual (§1a); do **not** add a positive pre-merge declaration/consult obligation in this slice (that is the first step toward the structural E-B closure, deferred with the rest of E-B, OUT OF SCOPE). *(Was the round-2 detection-only vs first-mediation-step Punt.)*
- **Chosen (operator, 2026-09-16):** Cadence — run **live per-checkpoint** (§4). A run-end final reconcile is not required for this increment. *(Was the last open §7 architecture Punt; its closure is why the rating moves to `high`.)*

**Assumptions.**

- **Assumes:** `run-ledger.json` will carry a `base_sha` **and a post-feature mint marker** after this slice adds them at mint (both confirmed absent today). Validate: check the mint path writes both; the reconcile faults (non-clean) when `base_sha` is missing on a post-feature run, and treats a run lacking the mint marker as legacy-exempt.
- **Assumes:** an admitted issue's landing is attributable from its issue branch name / issue key (faff's `gitBranchName` convention, e.g. `faff-1028-…`). Validate: confirm the branch → issue mapping is derivable for admitted issues before build. (Accepted limit B: heuristic and documented; an unattributable landing is surfaced as `issue:null`, not dropped.)
- **Assumes:** the protected/target branch is resolvable (config default branch or the run's recorded branch). Validate: resolve before build; a missing branch is a reconcile fault, not a clean.
- **Assumes:** the pr:<N>↔commit:<sha> equivalence resolves from the forge enrichment map (gh up) or **`merge-record.json.head_sha`** (gh down) — the FAFF-1012 ledger auto-declaration records only `pr:<N>` (`merge-gate.js:~719`) while the landing commit sha lives in `merge-record.json` (`merge-gate.js:~475`). Validate: confirm `merge-record.json` records `head_sha` (and, for a multi-commit landing, the segment base) for every governed merge-gate landing. An **unattributable** segment with neither forge resolution nor a `merge-record.json` entry is surfaced as uncovered (fail-safe), not a silent clean.
- **Assumes:** a governed multi-commit landing (`merge-gate --rebase` or the FAFF-875 local ff-only base-advance) is bounded by its `merge-record.json` (base..head_sha), so the segment partition (§3) groups its N first-parent commits into one covered unit. Validate: confirm `merge-record.json` records enough to bound the segment (head_sha plus the pre-advance base); absent a base, fall back to contiguous-attribution grouping.

## 8. DONE — Definition of Done

### From WHY
- [ ] A direct-git (off-ledger) merge of an admitted issue during a run is detected as an escape by the reconcile, where `faff effects check` alone reported clean.
- [ ] An unattributable in-window landing (no derivable issue key) is surfaced as `uncovered` with `issue:null` and sets `any_escape` (never dropped).
- [ ] An ordinary non-merge in-window commit is NOT flagged as a landing.
- [ ] The pure `computeEscapes` core and its `--selftest` cases are unchanged (`empty ledger => clean` still passes).
- [ ] **(Operator honesty condition, §1a)** The feature ships with documentation, where a reader meets the feature (the `faff effects reconcile-merges` help/`--describe` text and the checkpoint prose), that states plainly **what the detector catches and what it does not**: it detects an off-ledger / undeclared landed merge after the fact; it does **not** prevent a declare-then-merge-off-ledger actor (accepted limit A), and it is detection, **never** prevention. The docs name the E-B mediation (FAFF-1034 option 1) as the eventual prevention, the attribution/run-window heuristic (accepted limit B) as a known reliability boundary, **and** that `base_sha` + the mint marker (`run-ledger.json`) and `merge-record.json.head_sha` are trusted coverage inputs outside the FAFF-621 chain (an accepted limit-A integrity residual — an actor with ledger write can strip the marker, advance the anchor, or forge a merge-record to spoof coverage).

### From WHAT (types and interfaces)
- [ ] `faff effects reconcile-merges --run <id>|--run-dir <dir> [--issue] [--json]` returns `{ reconciled, uncovered, any_escape, fault, forge_enriched, legacy_exempt }`.
- [ ] `run-ledger.json` records `base_sha` **and a post-feature mint marker** at run mint; a post-feature ledger without `base_sha` makes the reconcile return `reconciled:false, fault:"no base anchor"` (non-clean); a pre-feature run lacking the mint marker is `legacy_exempt:true` (clean, not a fault).
- [ ] `--issue <ISSUE>` narrows both attribution and the ledger read to that issue.
- [ ] Coverage uses `effectTargetMatches` (wildcard `"*"` covers) over `effect.kind == "merge"` across declare + observe, scoped to this run's ledger, and cross-matches `pr:<N>` ↔ `commit:<sha>` — resolving the equivalence from the forge map (gh up) or `merge-record.json.head_sha` (gh down); a landing with neither is surfaced as uncovered (fail-safe).
- [ ] `detail` is sanitised (no raw newlines/control chars) and truncated to ≤ 200 bytes (UTF-8-safe).

### From HOW (behaviour)
- [ ] The advancement set is `git rev-list base..head --first-parent` on the protected branch (never `git log --merges` alone, never a forge-only query), partitioned into branch-advancement **segments** (merge-record.json bounds a governed segment; remaining commits grouped by contiguous attribution). A feature-branch commit is excluded structurally; each segment is attributed to an admitted issue (unattributable ⇒ `issue:null`, surfaced).
- [ ] A governed multi-commit landing (`merge-gate --rebase` or FAFF-875 local ff-only) is ONE covered segment — its N−1 non-tip first-parent commits never surface as separate uncovered escapes.
- [ ] A concurrent run's landing on the shared protected branch is attributed to that run, not flagged by this run.
- [ ] A missing base anchor (post-feature run) or a broken FAFF-621 chain yields `reconciled:false` and is treated as NON-clean by the checkpoint; a pre-feature legacy run is `legacy_exempt` (clean).
- [ ] The checkpoint combines `check.any_escape OR reconcile.any_escape OR NOT reconcile.reconciled` into the `--forbidden-side-effect` decision, and runs the reconcile live at each checkpoint.
- [ ] A forge (`gh`) enrichment failure sets `forge_enriched:false`, degrades targets to `commit:<sha>`, cross-matches a governed `pr:<N>` declaration, and does NOT set `forbidden`.
- [ ] A merge landed through `merge-gate` (FAFF-1012 covered) is not double-flagged, including under a gh outage (cross-match).

### From HOW (edge cases)
- [ ] Empty ledger with no landings stays clean.
- [ ] observe-only, declare-only, and `"*"` wildcard coverage each independently mark a landing covered.
- [ ] The reconcile mutates nothing (verified by comparing ledger hash / `git status` before and after).

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the reconcile is deterministic).

**Integration smoke test.**
```
1. Create a scratch run dir with an empty declared-effects.jsonl AND a run-ledger.json recording base_sha, the post-feature mint marker, and one admitted issue.
2. Land a commit on the protected branch attributable to that issue (git), no declare.
3. Run `faff effects reconcile-merges --run-dir <dir> --json`; assert any_escape == true, uncovered names the commit/PR.
4. Land an in-window commit with no derivable issue key; re-run; assert it appears in uncovered with issue:null and any_escape == true.
5. Add a covering `faff effects declare --step merge` (as pr:<N>) for the first target, write a merge-record.json with head_sha == that landing's commit, and simulate gh down; re-run; assert the pr:<N>↔commit:<sha> cross-match covers it via head_sha (any_escape reflects only the unattributable landing).
6. Remove base_sha but keep the mint marker; re-run; assert reconciled == false and fault names the missing anchor.
7. Remove the mint marker entirely (legacy); re-run; assert legacy_exempt == true and any_escape == false.
```

confidence: high
spec-review: approve
build-tier: complex

## Methodology critique (agile-delivery)

- **Right-sized?** Yes, once E-B is scoped out. The interim reconcile is a single 1–3 day unit: one CLI verb + a git branch-advancement adapter + `base_sha`/mint-marker recording at mint + cross-match coverage + checkpoint wiring + the operator-mandated docs. All prior open decisions are now settled, so no decision work remains in the ticket.
- **Workstream fit?** Fits the governed-effects / lights-out-integrity workstream (FAFF-43/106/397/621/1012 lineage); outcome-named (off-ledger merges become visible to governance).
- **Deps surfaced?** FAFF-1012 (Done, complementary — merge-gate path; the cross-match depends on its auto-declaration recording the landing commit sha, surfaced as an Assumption to validate), FAFF-621 (Done, the chain verifier reused), FAFF-1034 (settled option 2, composes as a detection layer), FAFF-1027 (open, the enforcement sibling). None blocks this detection slice; all linked. The `base_sha`/mint-marker-at-mint addition is an internal dependency this slice carries.
- **Risk profile?** The novel-integration risk is attribution (branch → admitted issue) and base-anchor recording — an accepted, documented limit (B). The residual trust gap (auditee-writable ledger, limit A) is explicitly accepted and deferred to E-B. No de-risking spike needed.

---
_Revision 6 (2026-09-19, autonomous, spec-review revise loop round 2): applied the two in-place-fixable lensed objections — (major, architectural) redefined the landing/coverage UNIT as the branch-advancement segment (merge-record.json-bounded, or contiguous-attribution grouped), so a governed multi-commit `--rebase` / FAFF-875 local ff-only landing is one covered segment instead of N−1 false-flagged escapes (which had re-opened the "kill-switch coupled to forge/merge-shape" class on a no-remote repo); (minor, architectural) corrected the stale Assumption-4 to name `merge-record.json.head_sha`; and (non-gating infosec) added `merge-record.json` to the accepted limit-A integrity-residual note. Rating stays **high**. Convergence: objection totals 4→2 (round 1→2), blocker-free since round 2, no new objecting lens (churn:false, converging:true)._
_Revision 5 (2026-09-19, autonomous, spec-review revise loop round 1): applied the three in-place-fixable lensed objections — (blocker, architectural) defined the primary landing predicate as the protected-branch first-parent history (`base..head --first-parent`), dissolving the squash-vs-ordinary-commit ambiguity without the forge; (major, architectural) named `merge-record.json.head_sha` as the `pr:<N>`↔`commit:<sha>` equivalence source under a gh outage (the FAFF-1012 ledger auto-declaration records only `pr:<N>`), reconciling Scenario 4 with the fail-safe degrade branch; (major, QA) made the landing/non-landing ACs decidable via the first-parent predicate (feature-branch commits excluded structurally); (minor, infosec, non-gating) documented the `base_sha`/mint-marker-outside-FAFF-621-chain integrity residual as an accepted limit-A note. Rating stays **high** (refinements strengthen the spec; no new open Punt). The accepted limits A/B and the operator-settled Chosen decisions were correctly NOT re-litigated by the review._
_Revision 4 (2026-09-19, autonomous, live-thread reconciliation): folded the operator's 2026-09-16 20:34 resolution of the four round-3 spec-review objections — (1) unattributable in-window landing surfaced as uncovered `issue:null`, not dropped, with a landing guard against non-merge commits; (2) coverage cross-matches `pr:<N>` ↔ `commit:<sha>` so a gh outage never false-flags a governed landing; (3) upgrade migration distinguishes a pre-feature legacy run (exempt) from a post-feature ungoverned run (fault) via a mint-era marker; (4) cadence Chosen live per-checkpoint. The last open architecture Punt is now closed, so the rating moves medium → **high**. Re-rated, not redrafted from scratch — a scoped annotated refresh over Revision 3._
_Revision 3 (2026-09-15, autonomous): folded the operator's 2026-09-15 05:44 "ship the interim detection" scope decision; two round-2 standing blockers recorded as accepted known limits (§1a); honesty condition a DONE criterion._
_Revision 2 (2026-09-13, autonomous): folded spec-review round-1 refutations — always-on run-scoped git branch-advancement detector, recorded base anchor a hard input, chain-integrity + `detail` sanitisation, tightened DONE/scenarios, auditee-writable-ledger residual named as the E-B boundary._