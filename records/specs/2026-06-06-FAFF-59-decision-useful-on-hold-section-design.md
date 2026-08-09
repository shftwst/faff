## Spec — REFRESHED (faff-prep --refresh · faffter-dark-nlspec · 2026-06-06)

*Revised 2026-06-06 — folds in the interactive Punt resolution (comment 18:44): the reversibility/risk derivation is now a closed `Chosen`, and the rating is bumped `medium → high`. Supersedes the prior spec comment (18:32). Design approach is otherwise unchanged.*

# FAFF-59 — Decision-useful On-hold section

## WHY
The On-hold sections (`faff-tidy` §4a, `faff-wtf` §4b) list held issues with a reason but no basis to decide *what to release* (your feedback: "I want to know which are safest, most standalone, or most unlock value… without going to the tracker"). Rework them to show release-decision signals, ranked best-candidate-first.

## WHAT / HOW (doc-only: `faff-tidy/SKILL.md` §4a + `faff-wtf/SKILL.md` §4b, + a shared rendering form)
Render each held issue as a compact, ranked entry carrying:
- **Gloss** — grounded per FAFF-58 (Done).
- **Standalone-ness** — `independent` / `blocks N` / `blocked by N` (from the relation graph — mechanical).
- **Unlock value** — count of direct+transitive dependents (the shared Work-ordering rule's chainable-unlock metric — mechanical).
- **Reversibility / risk** — a coarse safe-to-release tier (see Chosen below).
- **Hold reason + how to release** (`/faff-jot ISSUE-XX` thaw, or tidy's lift).

**Chosen — ordering:** safest × highest-unlock first (the natural "release these first" list).

**Chosen — rendering:** bold-lead annotated bullets (one scannable entry per held issue), per FAFF-52 skimmability; **a single shared form** both `faff-tidy` §4a and `faff-wtf` §4b reference (define the On-hold-entry form once — in `faffidavit-rendering`'s canonical forms — and point both skills at it).

**Chosen — reversibility/risk tier (Punt resolved 2026-06-06):** reuse the gateway's existing **side-effect-outside-PR taxonomy** — no new risk model.
- `low-risk` = fully `git revert`-able (docs / code / CI / config / additive changes).
- `higher-risk` = matches the gateway hard-floor side-effect list (executed migrations, secret rotation, external messaging, cloud-resource / registry changes, bulk tracker mutation).
- Rendered as an explicitly **advisory, coarse** tier, not a precise claim. This grounds the "safe to release?" hint in a contract faff already enforces (the autonomous park hard-floor), so the On-hold signal is consistent with how the pipeline already judges reversibility.

**Assumes:** the relation graph and Work-ordering chainable-unlock metric are available to both skills at render time (they already are — tidy and wtf both pull relations live).

**Out of scope:** the hold mechanism; auto-lifting (release stays human-gated).

## DONE
- [ ] `faff-tidy` §4a and `faff-wtf` §4b render each held issue with gloss + standalone-ness + unlock value + reversibility tier + hold-reason/how-to-release.
- [ ] Entries ordered safest × highest-unlock first.
- [ ] Both sections use one shared On-hold-entry rendering form (DRY) defined in `faffidavit-rendering`.
- [ ] Reversibility tier rendered as explicitly coarse/advisory, derived from the gateway side-effect-outside-PR taxonomy.
- [ ] Hold mechanism unchanged; no auto-lift.
- [ ] Diff limited to `skills/faff-tidy/SKILL.md` + `skills/faff-wtf/SKILL.md` + `skills/faffidavit-rendering/SKILL.md` (the shared form's home).

---
**Refresh self-review:** the sole open decision (reversibility/risk derivation) is now closed against an existing faff contract rather than a new model — no fresh ambiguity introduced. Codebase freshness re-verified: both target sections exist (`faff-tidy` §4a, `faff-wtf` §4b at SKILL.md:70) and both deps (FAFF-52 renderer, FAFF-58 grounding) are Done. Approach unchanged → no producer re-invoke needed (scoped Path-1 refresh). No remaining Punts → high.

## Methodology critique (faffter-dark-methodology-agile-delivery · issue-critique)
- **Right-sized?** Yes — one rendering rework across two sections + a shared form. No split.
- **Value × risk?** High value (turns an unactionable list into a release-decision aid — the "understandable, not unapproachable" tenet, FAFF-55), low risk (doc-only rendering; no mechanism change).
- **Deps surfaced?** relatedTo FAFF-58 (grounding — Done), FAFF-52 (renderer — Done), FAFF-55 (tenet). No blocker — buildable now; the previously-open reversibility decision is now closed.

confidence: high
