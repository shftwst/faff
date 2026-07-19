# FAFF-546 — `faff adr accept`: a verb and a trigger for ADR Proposed→Accepted

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-546.

Spec for FAFF-546, "ADRs are authored for already-settled decisions but born Proposed — no path (verb or trigger) to Accepted." Audience: the build agent implementing this change, and human reviewers of the resulting PR.

## WHY

The load-bearing model: an ADR's `Status` field and the real-world state of the decision it records are two different things, and today nothing keeps them in sync. `faff adr new` always scaffolds `Status: Proposed` (`plugin/skills/faff/bin/lib/adr.js:316`, `adrTemplate()`), and the `faffter-noon-adr` producer that authors the ADR body runs at faff-graft Step 4b — *after* the build, once the decision is already settled and shipped (`plugin/skills/faff-graft/SKILL.md:211`, `plugin/skills/faffter-noon-adr/SKILL.md:18`: "once a promoted decision is settled and the build is complete"). So every ADR is born describing a fact that already happened, labelled as a proposal. No CLI verb ever flips it forward: `faff adr`'s action list is exactly `next-number | new | list | live-decisions | validate | supersede | admit | renumber` (`adr.js:499`) — `supersede` retires an ADR, `admit` is a report-only gate over supersession authority (`adr.js:480`, comment: "report-only... the disposition is in the payload, never the exit code"), and neither writes `Status: Accepted`.

**Problem statement.** Today an ADR is scaffolded `Proposed` and stays `Proposed` forever unless a human hand-edits the file or it gets swept once by FAFF-342's historical fixup. This leaves the ADR log permanently out of sync with reality and undermines the one existing coherence check that depends on `Accepted` meaning something (FAFF-342's advisory). This change adds a `faff adr accept` verb and wires it into faff-graft's merge-confidence gate (Step 10) as the sole trigger that flips a newly-authored ADR from `Proposed` to `Accepted` at the moment the decision is mechanically corroborated — CI green, review passed, and (at L4) the code-blind holdout confirms the spec was met.

**Design principles.**

**The CLI verb is authority-blind by design.** `faff adr accept` performs only the mechanical Status-field edit. It takes no `--actor`, no `--admit-verdict`, no branch-landing ceremony — unlike its PRDR-axis sibling `faff prdr accept`. The decision of *whether* to call it lives entirely at the call site (graft Step 10), which already holds the only authority that matters here: the merge-confidence gate's own passed conditions. Duplicating an authority model onto the verb itself would be enforcing the same gate twice, in two different places, with two different vocabularies.

**Acceptance and supersession-authority are different gestures on different axes, and this ticket touches only one of them.** `faff adr admit` (FAFF-199) governs whether a *loop* is allowed to *supersede* a loop-provenance ADR — it is a permission check on retirement, not a state transition on adoption. `faff adr accept` is the mirror-image concept but distinct: it exists to promote an ADR whose *content* is settled, no matter which provenance tier authored it. Do not route acceptance through `admit`'s two-gate machinery; a loop-provenance ADR's acceptance is sanctioned by the merge-confidence gate (plus, at L4, the code-blind holdout verdict) — not by `admit`.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` | JavaScript | Where `faff adr accept` and its git-tier live; `cmdAdr` action dispatch (`adr.js:379-501`), `recordSupersede` (`adr.js:121-152`), `adrTemplate` (`adr.js:313-316`) |
| `plugin/skills/faff/bin/lib/prdr.js` | JavaScript | The shape being partially mirrored: `prdrAccept` (`prdr.js:148-196`), `prdrGitTier` (`prdr.js:118-135`), the `accept` CLI action (`prdr.js:285-296`) |
| `plugin/skills/faff/bin/lib/config.js` | JavaScript | Where `adr.mode`, `adr.thrash_max` etc. live (`config.js:43,68-69`) — `adrGitTier`'s config key joins this list |
| `plugin/skills/faff-graft/SKILL.md` | Markdown (skill prompt) | Step 4b (ADR authoring, line 211) and Step 10 (merge-confidence gate, line 421) — the call site for the new trigger |
| `plugin/skills/faffter-noon-adr/SKILL.md` | Markdown (skill prompt) | The producer that authors the ADR body at Step 4b; unaffected by this change except that its output now has a defined downstream acceptance moment |
| `docs/specs/2026-07-16-FAFF-199-adr-l4-loop-authored-adrs-mutable-means-design.md` | Markdown (design doc) | The supersession-authority axis this ticket does NOT touch |
| `docs/specs/2026-07-15-FAFF-342-adr-status-sweep-design.md` | Markdown (design doc) | The one-time historical sweep + the non-gating "Accepted cites Proposed" advisory this ticket keeps sound going forward |
| `docs/specs/2026-07-07-FAFF-368-adr-renumber-merge-gate-design.md` | Markdown (design doc) | The `git diff --diff-filter` mechanism this ticket's ADR-id derivation reuses verbatim |

**Scope statement.** This is a small addition to the existing ADR lifecycle CLI (`plugin/skills/faff/bin/lib/adr.js`) plus one new sub-step wired into faff-graft's already-existing Step 10 merge-confidence gate — the same shape and scale as FAFF-463's `prdr accept` + `prdrGitTier` addition to the PRDR axis.

## OUT OF SCOPE

- **Backfilling the ~29 existing `Proposed` ADRs to `Accepted`.**
  Why excluded: those ADRs predate this verb and predate any mechanical corroboration event; retroactively accepting them requires a human judgement call this ticket does not make (was each one actually settled? by what evidence?), not a mechanical rule this spec can state.
  Extension point: a follow-up ticket (parallel to FAFF-342's one-time sweep) that runs `faff adr accept` (or a dedicated bulk variant) against the existing log, gated by human review of each candidate.

- **`faff adr admit` / the supersession-authority axis (FAFF-199).**
  Why excluded: `admit` answers "may a loop supersede this loop-provenance ADR," a retirement-authority question. `faff adr accept` answers "has this decision been corroborated," an adoption-state question. They are orthogonal gestures; this ticket adds only the second.
  Extension point: if a future ticket wants acceptance to also require `admit`-style two-gate authority for loop-provenance ADRs specifically, that is a new design decision layered on top of this one, not implied by it.

- **Born-Accepted scaffolding (Direction 1) or any hybrid of Direction 1 and 2.**
  Why excluded: rejected in favour of Direction 2 (a verb + trigger) — see Design Decision Rationale.
  Extension point: none anticipated; Direction 2 was chosen because it preserves the append-only, mechanical-editor pattern the rest of the ADR CLI already follows (`recordSupersede`'s atomic edit), rather than teaching every ADR-producing call site a new default.

- **A dedicated admission/authority schema for `faff adr accept` (mirroring `prdr accept`'s `--actor`/`--admit-verdict`).**
  Why excluded: the call site (graft Step 10) already carries the authority signal (CI green, review pass, L4 holdout `meets-spec`); duplicating it as CLI flags would let the two disagree.
  Extension point: if a future need arises for the verb to be called from a context with no equivalent gate (e.g. a bare interactive `faff adr accept <id>` invoked by a human outside graft), that context supplies its own judgement before invoking — the verb still does not need to model it.

## WHAT

**Vocabulary**

| Term | Definition |
|---|---|
| Merge-confidence gate | faff-graft Step 10 (`plugin/skills/faff-graft/SKILL.md:421`) — the point where AC verification, CI-green, review-pass, and (L4) the code-blind holdout verdict are all asserted before merge |
| `adrGitTier` | The new git-awareness check for ADRs, mirroring `prdrGitTier` (`prdr.js:118-135`) — flags an ADR marked `Accepted` whose file is uncommitted/untracked |
| This-run ADR(s) | The ADR file(s) this graft run added or modified, derived via the FAFF-368 diff-filter (see HOW) |
| L3 | Interactive/human-gated graft mode — merge confirmed by a human at Step 11 |
| L4 (lights-out) | Autonomous graft mode with the code-blind holdout gate active at Step 10 |

**Type definitions**

```
ENUM AdrStatus:
  Proposed
  Accepted
  Superseded-by-<ref>          # existing, unaffected

RECORD AdrAcceptResult:
  code: Integer                # 0 success, 1 validation failure, 2 usage error
  out: String                  # stdout payload (mirrors recordSupersede-style callers)
  err: String                  # stderr payload, empty on success

RECORD AdrGitTierResult:
  fails: List<String>          # "ADR-NNNN marked Accepted but uncommitted/untracked" — blocking
  notes: List<String>          # "ADR-NNNN marked Proposed and uncommitted" — informational, legitimate authoring state
```

**CLI surface**

`faff adr accept <selector> [--root <path>]`

- `<selector>` — an ADR filename or bare number, resolved the same way `adr renumber`'s selector is resolved (`adr.js` selector handling) — ambiguous bare numbers refused, forcing filename precision.
- No `--actor`, no `--admit-verdict`, no `--no-branch`. **Chosen:** deliberately narrower than `prdr accept`'s flag surface — see Design Decision Rationale.
- Behavior: locates the ADR file, atomically rewrites its `Status:` field value from `Proposed` to `Accepted` in place, using the same field-matching regex `recordSupersede` already uses (`adr.js:137-138`, the `/^([\s>*-]*\*{0,2}Status[\s*]*:[\s*]*).*$/mi` pattern) with the replacement value `Accepted` instead of a `Superseded by ...` string. Idempotent: re-running `accept` on an already-`Accepted` ADR is a no-op success, not an error (mirrors `recordSupersede`'s idempotent `Supersedes:` insertion at `adr.js:144-148`).
- Exit codes: `0` on success (including idempotent no-op), `2` on usage error (missing/ambiguous selector, file not found), matching the existing `cmdAdr` convention (`adr.js:379-501` throughout uses `2` for usage errors).

`faff adr validate` gains an `adrGitTier` pass, config-gated by `adr.validate_git` (default `"auto"`, mirroring `prdr.validate_git`'s default at `config.js` — `DEFAULTS["prdr.validate_git"]`).

- `adr.validate_git: "auto"` — runs the tier when inside a git work tree; degrades silently (no fail) outside one, exactly as `prdrGitTier` does (confirmed by `prdrGitTier`'s "non-git tree → degrades silent" selftest, `prdr.js:779`).
- `adr.validate_git: "off"` — disables the tier entirely.
- Tier logic: for each ADR, `Accepted` + untracked-or-modified (via `git ls-files --error-unmatch` / `git status --porcelain`, the same primitives `prdrGitTier` uses at `prdr.js:118-135`) → **FAIL** ("ADR-NNNN accepted-uncommitted"); `Proposed` + untracked → **NOTE** ("ADR-NNNN proposed-uncommitted" — the ordinary authoring-in-progress state, not an error).
- This tier's FAILs gate `faff adr validate`'s exit code (unlike FAFF-342's advisories, which are explicitly informational-only per `adr.js:410`'s comment "informational only — never gates the exit code"). The git tier is a correctness check on committed state, not a style advisory, so it belongs on the gating side of `adrValidate`, distinct from `computeAdrAdvisories`.

**Design decisions embedded in this surface:**

The verb reuses the existing atomic Status-edit machinery (`recordSupersede`'s regex) rather than introducing a second Status-mutation code path.
**Chosen:** share the field-edit primitive; two independent regex implementations touching the same field is exactly the kind of drift `recordSupersede`'s own header comment (`adr.js:8-9`, "authority-blind... enforcement lives only in `admit`") warns against for the supersede axis, and the same logic applies to accept.

Whether `adr accept` should validate that the ADR isn't mid-supersession before flipping status.
**Chosen:** `adr accept` refuses (exit 2) if the target ADR's current `Status` is anything other than `Proposed` (including already `Superseded by ...`) — it only ever performs the `Proposed → Accepted` transition, never overwrites a supersession marker. This is a cheap guard, not a new authority model: it reads the same Status field the regex already parses.

## HOW

**Architecture and approach.** The only new runtime behavior is: (1) a mechanical CLI verb in `adr.js`, alongside its `prdr.js` sibling; (2) one new sub-step inside faff-graft's existing Step 10, sequenced right after the existing ADR-collision merge guard and before the `ship` handoff; (3) a config-gated git-tier check folded into `adr validate`. Nothing about Step 4b (ADR authoring) changes — the ADR is still born `Proposed`; only its downstream fate changes.

**Behavior summary — Step 10's new ADR-accept sub-step.** Once the merge-confidence gate's floor conditions are green (and, at L4, once the holdout verdict is `meets-spec`), and immediately before the `ship` handoff, determine which ADR(s) this run touched and flip each from `Proposed` to `Accepted`, then fold that edit into the same commit/staging flow the ADR-collision merge guard already uses.

```
PROCEDURE step10_adr_accept(run):
  1. this_run_adrs = git diff --diff-filter=AM \
       "$(git merge-base HEAD @{u} 2>/dev/null || git merge-base HEAD main)"..HEAD \
       -- docs/adr/
     # Reuses FAFF-368's own derivation verbatim (faff-graft/SKILL.md:440,444) —
     # identifies by file path, not by number, so it is robust under a concurrent
     # duplicate-number collision that the ADR-collision merge guard (Step 10,
     # existing) may itself be renumbering in this same pass.
  2. IF this_run_adrs is empty:
       RETURN  # no ADR in this PR — overwhelmingly common path, no-op
  3. Run the existing ADR-collision merge guard FIRST (already specified at
     faff-graft/SKILL.md Step 10) — so any renumber this run needs has already
     landed before accept touches Status, and accept operates on final filenames.
  4. FOR EACH file IN this_run_adrs WHERE file's current Status == "Proposed":
       a. IF lights_out (L4) AND holdout gate has not yet returned meets-spec:
            SKIP — accept only fires after the holdout gate passes (condition 4
            in Step 10's floor), never before
       b. Run `faff adr accept <file>`
       c. IF exit code != 0: BLOCK needs-human, surface stderr (fail-closed —
          never silently skip a failed accept)
  5. Run `faff adr validate` (now including the adrGitTier pass) — must exit 0.
     IF non-zero: BLOCK needs-human (never merge on a red tree, same rule the
     existing renumber guard already applies at faff-graft/SKILL.md's
     "Re-run faff adr validate → must exit 0; else BLOCK needs-human").
  6. Stage the specific accepted file(s) by explicit path (never git add -A,
     per FAFF-457's existing rule — faff-graft/SKILL.md's renumber guard
     step 5), run `faff stage-guard --worktree . --mode assert`, commit
     ("docs(adr): accept <ISSUE-XX> ADR <id> (merge-confidence gate)"), push.
  7. Proceed to the ship handoff.
```

**L3 vs L4 acceptance rigor.** Both modes fire `faff adr accept` at the same Step 10 call site, but the rigor behind "the decision is settled" differs by what Step 10's floor actually asserted:

| | L1–L3 (interactive/human-gated) | L4 (lights-out, autonomous) |
|---|---|---|
| Floor conditions asserted before accept fires | AC verification (Step 8), CI-green, review `pass` (Step 9) | The same three, **plus** the code-blind holdout returning `meets-spec` |
| Who confirms the merge itself | A human, at Step 11's explicit "merge now?" prompt | No human; the gate itself is the confirmation |
| What "settled" means | Mechanically verified ACs + a human's final go-ahead | Mechanically verified ACs + an independent code-blind judge corroborating the spec was met, with no human in the loop |
| Accept timing relative to holdout | N/A — no holdout gate runs at L1–L3 | Strictly after the holdout gate passes; a `fails`/`gaps`/`needs-human` holdout verdict blocks the whole Step 10 floor, so `adr accept` never fires on a rejected build |

Both flows therefore fire the identical verb through the identical sub-step; the difference is entirely in which upstream conditions had to be true first, not in `adr accept`'s own behavior. This satisfies the concern that a loop-authored, lights-out decision needs *some* accepting authority: the L4 holdout is that authority, standing in for the human confirm that L1–L3 supplies instead — see Design Decision Rationale, "does a loop-provenance ADR need its own admission gate."

**Edge cases**

```
IF the ADR's current Status is already "Accepted" when accept is invoked:
  no-op, exit 0 (idempotent — a re-run of Step 10, e.g. after a CI retry, must
  not error on an already-accepted ADR)

IF the ADR's current Status is "Superseded by ADR-NNNN":
  refuse, exit 2 — accept never overwrites a supersession marker

IF the ADR file was renumbered earlier in this same Step 10 pass (the existing
ADR-collision merge guard ran first):
  accept operates on the POST-renumber filename/path — because step 3 above
  runs the renumber guard before deriving which files to accept, and the
  diff-filter's file-identity approach (not number-identity) means the
  renumbered file's new path is what git diff reports on the final HEAD
```

**Failure modes**

- **Git-tier bypass.** The failure: an ADR gets its `Status` field flipped to `Accepted` in a session/comment/manual edit without the corresponding commit landing — the file looks accepted in a working tree but `main` never saw it. How you'd know: `faff adr validate`'s new `adrGitTier` pass reports a FAIL line ("ADR-NNNN accepted-uncommitted") the next time validate runs against that tree. What it means: this is exactly the hazard `prdrGitTier` already guards against on the PRDR axis (FAFF-463) — the guard is the same shape, so a report here should be treated as gating (not advisory), matching `prdrGitTier`'s own severity.

- **Renumber-collision interaction.** The failure: the existing ADR-collision merge guard (FAFF-368) renumbers a file in the same Step 10 pass that `adr accept` is about to run in, and if accept's ADR-id derivation ran *before* the renumber (rather than after, as this spec's procedure mandates at step 3), it could reference a filename that no longer exists post-rename. How you'd know: the accept sub-step's `faff adr accept <file>` call would fail with a file-not-found usage error (exit 2) rather than silently skipping. What it means: the procedure above deliberately sequences the renumber guard before the ADR-id derivation for accept, closing this window by construction — this is a sequencing requirement, not merely a scenario to test after the fact.

- **Superseded-while-accepting race.** The failure: between the moment this run's diff-filter derives "this run touched ADR-0050" and the moment `faff adr accept ADR-0050` actually runs, a concurrent merge (under `faffter-dark-concurrency-parallel`) lands a supersession of that same ADR. How you'd know: `adr accept`'s own guard (refuse unless current Status is exactly `Proposed`) would see `Superseded by ADR-NNNN` instead of `Proposed` and refuse with exit 2, surfacing as a BLOCK needs-human rather than silently overwriting the supersession. What it means: the accept verb's own status-check guard (WHAT section, "mid-supersession" decision) is the safety net here, not a distributed lock — acceptable because ADR files are append-mostly and a genuine same-window collision is rare enough that fail-closed-and-surface is the right cost/benefit, matching how the existing ADR-collision guard itself handles concurrent duplicate numbers (park `needs-human`, never silently resolve).

**Anti-patterns**

**Anti-pattern:** giving `faff adr accept` its own `--actor`/`--admit-verdict` flags mirroring `prdr accept`. Why: the call site (graft Step 10) already carries the only authority signal that matters (floor conditions + holdout verdict); a second authority vocabulary on the verb itself would let the CLI's stated authority and the gate's actual authority drift apart.

**Anti-pattern:** routing acceptance through `faff adr admit`'s two-gate schema for loop-provenance ADRs. Why: `admit` answers a supersession-authority question, not an acceptance question; conflating them would make a loop's OWN ADR's acceptance depend on machinery designed to answer "may this loop retire that ADR," a different concern entirely (see Design Decision Rationale).

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Given an ADR authored at faff-graft Step 4b with `Status: Proposed`
When the merge-confidence gate at Step 10 reaches all-green floor conditions in interactive (L3) mode and the human confirms merge
Then `faff adr accept <that ADR's file>` is invoked, the file's `Status` field is rewritten to `Accepted` in place, and the edit is committed and pushed before the `ship` handoff.

Given an L4 lights-out graft run where the code-blind holdout verdict returns `meets-spec` after CI-green and review-pass
When Step 10's floor completes with the holdout gate passing
Then `faff adr accept` fires for this run's ADR(s) with no human in the loop, and the accepted Status is present in the commit that reaches `main`.

Given an L4 lights-out graft run where the code-blind holdout verdict returns `fails` or `needs-human`
When Step 10's holdout gate blocks
Then `faff adr accept` is never invoked, the ADR stays `Proposed`, and the PR is flipped to draft and parked per the existing holdout-block protocol.

Given an ADR whose Status is already `Superseded by ADR-0099` at the moment Step 10's accept sub-step runs
When `faff adr accept` is invoked against that file
Then the command refuses with exit code 2 and does not overwrite the `Superseded by` marker.

Given an ADR marked `Accepted` in the working tree but never committed
When `faff adr validate` runs with `adr.validate_git` at its default (`auto`)
Then validate reports a FAIL line naming that ADR as accepted-uncommitted, and the overall exit code is non-zero.

## Design Decision Rationale

**Direction 1 (born-Accepted scaffolding) vs Direction 2 (a verb + trigger) vs a hybrid.**
Options considered: (1) have `faff adr new` scaffold `Status: Accepted` directly for settled, human-provenance decisions, provenance-tiered by how confident the origin is; (2) add `faff adr accept` and a defined trigger, leaving scaffolding untouched; (3) a hybrid — born-Accepted for high-confidence human-provenance ADRs, verb-triggered for the rest.
**Chosen:** Direction 2. Born-Accepted scaffolding would require Step 4b's authoring producer to make a provenance/confidence judgement it isn't positioned to make (it authors prose, not authority — per `faffter-noon-adr/SKILL.md`'s own boundary: "FAFF-16's mechanics own the scaffold... this producer owns only the prose"). A verb + trigger keeps the existing append-only, mechanically-edited pattern (`recordSupersede`) and lets a single well-defined moment (the merge-confidence gate) be the trigger for every ADR, regardless of provenance — no hybrid branching logic needed.

**Should `adr accept` mirror `prdr accept`'s branch-landing + actor-gated shape?**
Options considered: full mirror (own landing branch, `--actor`, `--admit-verdict`, rollback-on-failure); no mirror (plain mechanical edit, authority lives at call site only).
**Chosen:** no mirror — plain mechanical edit. `prdr accept` needs its own branch-landing ceremony because a PRDR can be accepted standalone, outside any particular build (a human ratifying it at L3 independent of a specific graft run). An ADR accepted by this ticket's design is *always* inside an already-in-flight graft run's own branch/PR — the branch-landing and rollback machinery graft's Step 10 already provides (the same PR, the same CI re-confirm) makes a second one on the verb redundant.

**Does a loop-provenance ADR's acceptance need its own admission gate, or does the merge-confidence gate (+ L4 holdout) suffice?**
Options considered: require `faff adr admit`-style two-gate authority before a loop-provenance ADR can be accepted; rely solely on the merge-confidence gate's existing floor (CI-green, review-pass, holdout `meets-spec` at L4).
**Chosen:** the merge-confidence gate suffices, with the L4 holdout specifically standing in for the "someone besides the author corroborated this" property that `admit`'s two-gate schema provides on the retirement side. The holdout is code-blind and independently judges spec-conformance — a stronger corroboration than `admit`'s disposition-only report for this particular question. Using `admit` here would also require inventing a new use for a report-only mechanism that currently has no consumer wired to gate on its output.

**Should the git-tier be bundled into this ticket or left for later?**
Options considered: ship `adr accept` without a git-awareness tier (leave the "accepted-uncommitted" hazard unguarded); bundle `adrGitTier` alongside the verb, as FAFF-463 did for `prdrGitTier`.
**Chosen:** bundle it. FAFF-463 shipped `prdrGitTier` together with `prdr accept` for exactly this reason — a status-flip verb without a corresponding git-awareness check creates a class of silent drift the moment it exists. Shipping the verb alone and the tier later would leave a known-hazard window open with no tracking ticket forcing its closure.

**How should this-run-ADR-id be derived?**
Options considered: invent a new derivation (e.g. parse the graft run's own change manifest); reuse FAFF-368's `git diff --diff-filter=AM <merge-base>..HEAD -- docs/adr/` mechanism verbatim.
**Chosen:** reuse FAFF-368's mechanism verbatim, confirmed present at `faff-graft/SKILL.md:440,444` and in the FAFF-368 design doc (`docs/specs/2026-07-07-FAFF-368-adr-renumber-merge-gate-design.md`, lines 158/170/272). It identifies by file path, not by number, so it is already robust under the exact renumber-collision scenario this ticket's own accept sub-step must also survive — reusing it means both concerns benefit from the same collision-resistant identification, rather than accept using a fragile number-based lookup the renumber guard has already proven wrong.

## Open Questions and Assumptions

**Open Questions**

**Punt:** backfilling the ~29 existing `Proposed` ADRs to `Accepted` is out of scope for this ticket — needs human (decides: product). Context: these ADRs predate the new verb and predate any mechanical corroboration event this spec defines; a bulk-accept would require a human to judge, per existing ADR, whether it was actually settled by evidence this spec has no way to reconstruct retroactively. A follow-up ticket, parallel in shape to FAFF-342's one-time sweep, is the natural extension point.

**Assumptions**

**Assumes:** `git merge-base HEAD @{u}` (falling back to `git merge-base HEAD main`) remains the correct upstream-resolution convention at the time this is built — validate by confirming `faff-graft/SKILL.md`'s existing ADR-collision merge guard (line 440) still uses this exact fallback chain; if it has changed, use whatever the shipped guard uses at build time rather than this spec's literal quote, since this ticket intentionally piggybacks on that existing derivation rather than owning its own.

**Assumes:** `adr.validate_git`'s default value should be `"auto"`, matching `prdr.validate_git`'s default (`DEFAULTS["prdr.validate_git"]` in `config.js`) — validate by reading `config.js`'s `DEFAULTS` object at build time and confirming `prdr.validate_git` is still `"auto"`; if the PRDR-axis default has since changed, mirror whatever it currently is rather than hardcoding `"auto"`.

## DONE

### From WHY
- [ ] `faff adr accept <selector>` exists as a new `cmdAdr` action alongside the existing `next-number | new | list | live-decisions | validate | supersede | admit | renumber` set
- [ ] No CLI verb other than `faff adr accept` ever writes `Status: Accepted` to an ADR file
- [ ] `faffter-noon-adr` and Step 4b's scaffolding behavior are unchanged — ADRs are still born `Proposed`

### From WHAT (types and interfaces)
- [ ] `faff adr accept` takes only `<selector>` and `[--root <path>]` — no `--actor`, `--admit-verdict`, or `--no-branch` flags exist on it
- [ ] `faff adr accept` on an ADR whose current Status is `Proposed` rewrites the Status value to `Accepted` in place, preserving the field's existing bold/prefix formatting (reusing `recordSupersede`'s regex pattern)
- [ ] `faff adr accept` on an already-`Accepted` ADR is a no-op, exit 0
- [ ] `faff adr accept` on an ADR whose Status is `Superseded by ADR-NNNN` (or any non-`Proposed` value) refuses with exit 2
- [ ] `adr.validate_git` config key exists with default `"auto"`, accepting `"auto"` and `"off"`
- [ ] `faff adr validate` runs the `adrGitTier` pass when `adr.validate_git` is not `"off"`, degrading silently outside a git work tree
- [ ] `adrGitTier`'s FAILs (accepted-uncommitted) gate `faff adr validate`'s exit code; its NOTEs (proposed-uncommitted) do not

### From HOW (behaviour)
- [ ] Step 10's new ADR-accept sub-step derives this run's touched ADR(s) via `git diff --diff-filter=AM <merge-base>..HEAD -- docs/adr/`, matching FAFF-368's existing mechanism
- [ ] The ADR-accept sub-step runs strictly after the existing ADR-collision merge guard (so it operates on post-renumber filenames) and strictly before the `ship` handoff
- [ ] At L4, the ADR-accept sub-step fires only after the holdout gate has returned `meets-spec` — a `fails`/`gaps`/`needs-human` holdout verdict prevents `faff adr accept` from being invoked at all
- [ ] At L1–L3, the ADR-accept sub-step fires after the human's Step 11 merge confirmation, with no holdout gate involved
- [ ] A non-zero exit from `faff adr accept` during Step 10 blocks the merge as `needs-human`, surfacing the CLI's stderr
- [ ] The accepted ADR file(s) are staged by explicit path (never `git add -A`) and committed with a message following the pattern `docs(adr): accept <ISSUE-XX> ADR <id> (merge-confidence gate)`

### From HOW (edge cases / failure modes)
- [ ] Git-tier bypass (accepted-but-uncommitted) is caught by `adrGitTier` on the next `faff adr validate` run
- [ ] Renumber-collision: accept operates on the post-renumber file path, never errors on a stale pre-renumber filename
- [ ] Superseded-while-accepting race: `adr accept`'s Status-check guard refuses (exit 2) rather than overwriting a supersession marker that landed in the same window

### From Scenarios
- [ ] L3 scenario: human-confirmed merge triggers `adr accept`, edit committed before ship handoff
- [ ] L4 scenario: holdout `meets-spec` triggers `adr accept` with no human in the loop
- [ ] L4 holdout-block scenario: `adr accept` never fires, ADR stays `Proposed`, PR parked
- [ ] Renumber-collision holdout scenario (see `holdout` block above) verified by the evaluator against a running instance
- [ ] Already-superseded scenario: `adr accept` refuses with exit 2
- [ ] Git-tier scenario: uncommitted `Accepted` ADR fails `faff adr validate`

**Integration smoke test**

```
PROCEDURE smoke_test_basic_accept_flow():
  1. Create a fresh ADR via `faff adr new` — assert Status: Proposed
  2. Simulate Step 10's floor passing (CI-green, review-pass; L3 path)
  3. Invoke `faff adr accept <the new ADR's file>`
  4. Assert exit code 0
  5. Read the ADR file back — assert Status: Accepted, all other fields unchanged
  6. Run `faff adr validate` — assert exit code 0, no FAIL lines
```

**Second smoke test — renumber-collision interaction**

```
PROCEDURE smoke_test_accept_after_renumber():
  1. Simulate two concurrent grafts both minting ADR number 0050 on their
     respective branches (the FAFF-368 collision scenario)
  2. Merge the first branch — ADR-0050 (branch A) lands cleanly
  3. On the second branch, run Step 10: the ADR-collision merge guard detects
     the duplicate, renumbers branch B's ADR file from 0050-x.md to 0051-x.md,
     commits the rename
  4. Immediately after, run the new ADR-accept sub-step on branch B
  5. Assert: `faff adr accept` is invoked against docs/adr/0051-x.md (NOT
     0050-x.md), succeeds with exit 0, and the final committed file shows
     Status: Accepted at the correct (post-renumber) path
  6. Run `faff adr validate` — assert exit code 0, no duplicate-number FAIL,
     no accepted-uncommitted FAIL
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```

spec-review: approve (re-verified on recovery re-dispatch — reconstructed after the original spec comment was clobbered; see the prior spec-review and ADR-promotion-intent comments below for the original review detail, both of which remain intact)
