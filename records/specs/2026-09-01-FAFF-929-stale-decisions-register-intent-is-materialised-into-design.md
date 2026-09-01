# FAFF-929 — Reconcile decisions-register intents against the finalised spec before graft materialises them

> Spec: faffter-dark-nlspec · 2026-09-01 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-929.

## WHY

faff-prep's **Decisions-register capture step** (`plugin/skills/faff-prep/SKILL.md:307-317`) records a `## Decisions-register intent` tracker comment when a human closes out a Punt/Assumes marker. The comment carries `topic`, `Chosen`, `Rationale`, `Scope`, `Matches` — and **nothing tying it to which spec revision it was confirmed against**. faff-graft's **Step 4c** (`plugin/skills/faff-graft/SKILL.md:253`) later appends that comment verbatim as a new `##` section to `docs/decisions.md` on the feature branch, ratified by PR review. Capture (prep, tracker-only) and materialise (graft, git) are split across time **by design**, but there is no reconcile step between them.

The bug: a spec-review `revise` loop, or a plain re-prep, can change the design out from under an already-captured intent. The intent comment stays on the ticket — still framed as human-confirmed — but now contradicts the finalised spec. Step 4c is **presence-only**: it materialises any `## Decisions-register intent` comment with no content check against the spec that just shipped. The stale precedent lands in `docs/decisions.md` and every future `faff decisions match` resolve-attempt cites it as authoritative (`plugin/skills/faff/bin/lib/decisions.js:180-193`; consulted at `faff/SKILL.md:776`). The register's whole value is that its precedents are trustworthy; one silently-stale entry poisons it.

Observed (FAFF-910 build): three `## Decisions-register intent` comments were captured on 2026-08-27. The 2026-08-28 reconciliation with the merged FAFF-907 **dropped the spec-revision sha256 digest entirely**, invalidating the "Portable identity for a ratified spec revision (sha256)" intent. Nothing marked it stale; Step 4c would have shipped a precedent about a digest the design no longer uses. It was caught **by hand**, and — because the catch was manual and coarse — all three intents were skipped, so the two still-accurate ones (v1 scope-expiry deferral, FAFF-907 composition) "now have no home." A precise reconcile would have materialised the two live ones and superseded only the obsoleted one.

The invariant to restore: **a decisions-register entry that reaches `docs/decisions.md` is consistent with the spec that shipped alongside it.**

**Notably, the register's sibling — ADR promotion — already has this guard.** graft **Step 4b sub-step 3b** (`faff-graft/SKILL.md:241-248`) runs a `detect_contradictions` LLM-judgement seam + `faff adr admit` gate before materialising an ADR-promotion intent. Step 4c has no analogue. This ticket closes that asymmetry for the decisions register.

## WHAT

Restore the invariant with a **reconcile-before-materialise** design (the ticket's candidate fix (a)), enforced at the single chokepoint and surfaced earlier at prep. Three coordinated pieces:

1. **A supersession-marker convention** on the `## Decisions-register intent` comment — a deterministic line the tracker-writer (prep) sets and the materialiser (graft) reads, so an obsoleted intent stops looking human-confirmed and is skipped by Step 4c.
2. **A prep-side reconcile pass** at each spec-finalisation seam (revise-loop exit / re-prep / autonomous Path 1 refresh): re-check every outstanding intent against the finalised spec and mark obsoleted ones superseded, so the tracker stays honest and the human/log sees it early.
3. **A graft-side reconcile-before-materialise guard** in Step 4c: skip any superseded-marked intent, and — as the backstop for an intent no prep pass revisited (e.g. a `/faff-graft` mid-build respec) — re-check each still-live intent for consistency against the **final committed spec graft already holds**, materialising only the consistent ones and skipping+surfacing the rest. This is the sole writer to `docs/decisions.md`, so it is where the invariant is actually enforced.

### Decisions

**Fix shape — reconcile (a), not a stored spec-revision marker (b).** **Chosen:** a reconcile pass that re-checks each intent's decision against the *finalised spec content* (at prep, and at graft against the committed spec), with no digest/hash/`Spec-revision:` field stored on the intent. **Rationale:** candidate fix (b)'s "content marker it was confirmed against" was already litigated and **explicitly rejected** in FAFF-910 (`records/specs/2026-08-28-faff-910-*-design.md:38,343`): a whole-spec byte hash is incoherent because "the spec is a moving target across review rounds, so no single entry's whole-spec hash can equal the finally-committed spec, and a byte hash never proves consistency" — the decision-to-spec-version binding is git's (the graft commit), not a digest. A reconcile pass that compares each intent's *topic/Chosen* against the *current* spec sidesteps that objection entirely and matches the shipped **Live-thread reconciliation** idiom (`faff/SKILL.md:1055`), which already re-earns a retained artifact (the confidence rating / spec-review verdict) against the live spec before trusting it. This ticket applies the same idiom to captured intents.

**Enforcement chokepoint — graft Step 4c is the backstop, not prep alone.** **Chosen:** the invariant is enforced at graft Step 4c (the only writer to `docs/decisions.md`); the prep-side pass is earlier surfacing, not the sole guard. **Rationale:** an intent can be obsoleted by a path that never re-runs the prep reconcile — most concretely a `/faff-graft` mid-build respec (`faff-graft/SKILL.md:271` reprep), or any capture that happened after the last prep finalisation. Putting the hard guard at the single materialise site guarantees no stale entry reaches the register regardless of how the spec changed, exactly as the sole-writer discipline of `docs/decisions.md` already intends (FAFF-448: no agent-invokable register-write primitive; writes are PR-ratified edits at graft).

**Supersession marker grammar.** **Chosen:** an obsoleted intent is marked by appending a line `> Superseded <ISO-date> (<ISSUE-XX>): <one-line reason>` to the existing `## Decisions-register intent` comment (edit-in-place via the tracker `save_comment` id path), never by deleting the comment. A comment is **superseded** iff its body contains a line matching `/^>\s*Superseded\b/mi`, else **live**. **Rationale:** append-not-delete preserves the human-confirmed audit trail (why it was captured, why it was later obsoleted) — mirroring ADR supersession, which back-refs rather than erases (`adr.js` supersede). A single fixed regex is the shared contract between the prep-writer and the graft-reader so the two can never fork on what "superseded" means, echoing decisions.js's one-grammar discipline (`fields.js` `hasFieldLine`).

**Deterministic marker classifier (the plumbing) vs the LLM obsolescence judgement (the seam).** **Chosen:** split the two. Add a pure, `--selftest`-covered helper `faff decisions intent-status` that classifies a comment body as `live | superseded | not-intent` by the marker grammar above — the deterministic skip decision both prep and graft call. The *obsolescence judgement itself* ("does the finalised spec still support this intent's `Chosen`?") stays an in-context LLM-judgement step in the prep/graft prose, exactly as graft Step 4b/3b frames `detect_contradictions` as "the only LLM-judgement step." **Rationale:** the marker parse is deterministic and testable and must not drift between writer and reader, so it earns a CLI home with a selftest (the FAFF-448/910 pattern). The consistency judgement is inherently semantic and cannot be made deterministic, so it is not forced into the CLI — it sits in prose beside the ADR-contradiction seam it mirrors.

**Precision over the coarse manual skip (the "no home" fix).** **Chosen:** reconcile per-intent, not all-or-nothing — materialise every still-consistent intent, supersede only the ones the final spec obsoleted. **Rationale:** the FAFF-910 incident lost two accurate intents because the manual catch skipped the whole batch. A per-intent check materialises the live ones (they keep their home) and supersedes only the genuinely stale one, which is the behaviour the invariant actually wants.

**Autonomous safe direction.** **Chosen:** when the graft-side consistency check finds an obsoleted (or ambiguous) intent under autonomous mode, **skip materialisation, mark it superseded, and surface it** (run-log + a tracker note) — never ship it, never park the whole build for it. A materialise-side failure of the check (e.g. cannot read the committed spec) fails safe to **skip + surface**, never a silent materialise. **Rationale:** shipping a stale precedent is the harm this ticket exists to prevent, so the check fails toward *not writing* the register; the register entry is optional enrichment of the PR, never build-blocking (Step 4c already `skip`s cleanly on no-intent).

### Reference context

- Capture site + intent fields: `plugin/skills/faff-prep/SKILL.md:307-317` (`## Decisions-register capture step`); its two call sites `:418` (Scenario A Step 3 resolve) and `:430` (Scenario B Step 2a Resolution).
- Finalisation seams to wire the prep reconcile into: `faff-prep/SKILL.md:418` (interactive resolve, the capture site itself), `:448-455` (Scenario B `iterate`), `:460-467` (`## Re-prepping`), and the autonomous mirror `:528` (Path 1 stale-refresh: "re-run the Spec-review gate ... then reattach" — the shipped precedent for re-earning a retained artifact before reattach).
- Materialise site: `plugin/skills/faff-graft/SKILL.md:253` (Step 4c); sibling guarded materialise to mirror: `:236-251` (Step 4b) + `:241-248` (3b `detect_contradictions` + `faff adr admit` + `faff adr supersede`).
- Register CLI + schema to extend: `plugin/skills/faff/bin/lib/decisions.js` (`splitSections`, `listEntries`, `matchDecision`, `cmdDecisions`, `decisionsSelftest`); wired in `bin/faff` (require + `COMMANDS`), `bin/lib/regions.js` (`factory` + `--selftest` maps), documented in `docs/guide/cli.md` (`faff lint-cli-doc` asserts the row).
- Shared field grammar: `plugin/skills/faff/bin/lib/fields.js` (`readField`, `hasFieldLine`).
- Idiom precedent: `faff/SKILL.md:1055` (Live-thread reconciliation), `:256` ("wire the retained verdict *through* that reconciliation, not around it").
- Explicit non-goal precedent (fix (b)): `records/specs/2026-08-28-faff-910-record-ratified-spec-level-tradeoff-design.md:38,96,220,343` (spec-revision digest rejected).

## HOW

**1. `faff decisions intent-status` (extend `plugin/skills/faff/bin/lib/decisions.js`).**
- Pure core `classifyIntentComment(body) → { kind: "intent"|"not-intent", status: "live"|"superseded"|null }`: `not-intent` unless the body contains a `## Decisions-register intent` heading (regex on a `^##\s+Decisions-register intent` line, tolerant of a trailing ` (superseded)` suffix); for an intent, `status = "superseded"` iff `/^>\s*Superseded\b/mi` matches, else `"live"`. No fs, no tracker — a pure string function.
- Verb `faff decisions intent-status [--file PATH | stdin] [--json]`: read the comment body from `--file` or stdin, run the core, print `live|superseded|not-intent` (or JSON `{kind,status}`). Exit `0` = live intent, `1` = superseded intent, `2` = not an intent comment / usage error. (Exit-1-on-superseded lets graft/prep shell-branch without JSON, mirroring `worktree-check`'s 0/1/2 posture.)
- Extend `decisionsSelftest` with a table: a `## Decisions-register intent` body with no marker → `live`/exit 0; the same body plus a `> Superseded 2026-09-01 (FAFF-929): design dropped the sha256 digest` line → `superseded`/exit 1; a `(superseded)` heading suffix alone (no marker line) → still `live` unless the marker line is present (the marker line, not the suffix, is authoritative); an ADR-promotion or arbitrary comment → `not-intent`/exit 2.
- Register: `DECISIONS_SPEC` gains no new global flags (`--file`/`--json` only); add `intent-status` to `DECISIONS_SURFACE.subcommands` and the `cmdDecisions` dispatch; add a `docs/guide/cli.md` row (else `lint-cli-doc` fails); `regions.js` selftest already covers `decisions --selftest`.

**2. Prep-side reconcile subroutine (`plugin/skills/faff-prep/SKILL.md`).** Add a shared subroutine `## Decisions-register reconcile step` (sibling to the capture step) and invoke it at each finalisation seam listed in Reference context. For each outstanding `## Decisions-register intent` comment on the issue that `faff decisions intent-status` reports **live**:
- Re-check its `topic`/`Chosen`/`Scope` against the just-finalised spec (in-context LLM judgement, the sole judgement step here): does the finalised spec still support this decision?
- **Still supported** → leave live, no write.
- **Obsoleted / contradicted** → edit the comment (tracker `save_comment` with its `id`) to append `> Superseded <today> (<ISSUE-XX>): <one-line reason>`, and record the supersession in the prep log (interactive: surface it to the human; autonomous Path 1: annotate the refreshed spec). Never delete the comment.
- Autonomous mode marks superseded and continues; it never parks solely for a superseded intent. This runs **before** the reconciled spec is reattached, mirroring the `:528` "re-earn before reattach" idiom.

**3. Graft Step 4c rewrite (`plugin/skills/faff-graft/SKILL.md:253`).** Replace the presence-only step with reconcile-before-materialise, run (as today) inside Step 4 after the spec is committed to the branch:
- Enumerate every `## Decisions-register intent` comment; for each, run `faff decisions intent-status`.
- **Superseded (exit 1)** → skip; log the skip + reason to `graft.md`; do not materialise.
- **Live (exit 0)** → run the consistency backstop: check the intent's `Chosen` against the **final committed spec** (`docs/specs/…-design.md`, already on the branch from Step 4) — the same `detect_contradictions`-style LLM-judgement seam Step 4b/3b uses. Consistent → append the entry as a new `##` section to `docs/decisions.md` (create if absent), commit `docs(decisions): record <topic> (<ISSUE-XX>)`, exactly as today. Obsoleted/ambiguous → **skip + surface**: mark the intent comment superseded (append the `> Superseded …` line), record the skipped intent + reason in `graft.md` and a tracker note so `/faff-wtf` resurfaces it for re-homing; do **not** write the register.
- No intent comment, or every intent skipped → no `docs/decisions.md` write (unchanged skip semantics). A `faff decisions intent-status` / spec-read failure fails safe to skip + surface, never a silent materialise.
- After materialising, run `faff decisions validate` on the updated `docs/decisions.md`; a validation failure surfaces loudly (the entry the human PR-reviews must be well-formed).

**4. Tests.**
- `decisions --selftest` table (piece 1) — live / superseded / not-intent / suffix-not-authoritative cases, wired through `regions.js`.
- `test/impure/decisions-intent-status.test.mjs` (mirroring the decisions test harness): `faff decisions intent-status --file` over fixture comment bodies asserts the 0/1/2 exits and JSON shape.
- A skill-prose lint pass: `faff validate-adapters` stays green for the edited `faff-prep`/`faff-graft` SKILL.md sections.

## DONE

- [ ] `faff decisions intent-status --file <body>` exits `0` + `live` for a `## Decisions-register intent` comment with no supersession line, `1` + `superseded` when the body carries a `> Superseded …` line, and `2` + `not-intent` for any non-intent comment.
- [ ] `faff decisions intent-status --json` emits `{ kind, status }`; a `(superseded)` heading suffix without a `> Superseded` marker line still classifies `live` (the marker line is authoritative).
- [ ] `faff decisions --selftest` covers the live / superseded / not-intent / suffix-not-authoritative cases and is exercised by the `regions.js` selftest sweep.
- [ ] `faff decisions intent-status` is registered in `bin/faff` `COMMANDS` and documented in `docs/guide/cli.md` such that `faff lint-cli-doc` passes.
- [ ] faff-prep carries a `## Decisions-register reconcile step` subroutine, invoked at the revise-loop / re-prep / autonomous Path 1 finalisation seams, that marks an obsoleted outstanding intent superseded (appends the `> Superseded …` line via `save_comment`) before the reconciled spec is reattached, and never deletes the comment.
- [ ] faff-graft Step 4c skips any intent `faff decisions intent-status` reports superseded, and for a still-live intent re-checks its `Chosen` against the final committed spec, materialising only the consistent ones.
- [ ] Under autonomous graft, an obsoleted or unreadable-check intent is skipped + surfaced (marked superseded, logged to `graft.md`, tracker note) — never materialised, never parking the build.
- [ ] A still-accurate intent in a batch that also contains an obsoleted one is still materialised (per-intent precision — the FAFF-910 "no home" regression does not recur).
- [ ] After a materialise, `faff decisions validate` passes on the updated `docs/decisions.md`; a stale precedent (an intent the finalised spec no longer supports) never reaches `docs/decisions.md`.
- [ ] No spec-revision digest / `Spec-revision:` field is introduced on the intent comment (the FAFF-910 rejection stands); consistency is judged against spec content + enforced by the git graft commit binding.

## Open Questions / Assumptions

- **Assumes:** the finalised spec graft holds at Step 4c (`docs/specs/…-design.md`, committed in Step 4) is the correct consistency target for the backstop check — it is, because Step 4 commits the spec to the branch before Step 4c runs, so the entry and the spec it must be consistent with land in the same PR (the FAFF-910 "git commit is the binding" position).
- **Assumes:** intent obsolescence is a semantic judgement a single in-context LLM check can make reliably per intent, as the ADR `detect_contradictions` seam (`faff-graft/SKILL.md:243`) already assumes for the parallel ADR case; the deterministic marker classifier bounds the blast radius (a missed judgement fails safe to skip, never to a silent stale write).

confidence: high
build-tier: standard

## Methodology critique

Lens: agile-delivery (issue-critique).

- **Right-sized?** No issues. One cohesive 1–2 day unit around a single invariant (a materialised register entry is consistent with the spec it ships with): a small deterministic classifier (`faff decisions intent-status` + selftest), the graft Step 4c reconcile guard that consumes it, the prep-side reconcile subroutine, and tests. The pieces always ship together — the graft guard and the prep pass share the one marker grammar the classifier owns — so this is a merge-not-split shape, correctly one ticket.
- **Workstream fit?** No issues. A Bug in the decisions-register / prep→graft-lifecycle workstream, directly completing FAFF-448 (the register) and FAFF-910 (the tradeoff-record path where the incident surfaced) by adding the reconcile seam neither built. Outcome-named and cohesive.
- **Deps surfaced?** No issues. Every seam it touches is already merged and present: the capture step, Step 4c, `decisions.js`, the ADR-side `detect_contradictions`/`supersede` pattern it mirrors. The `relatedTo` links (FAFF-448/907/910) are provenance/context, not build gates. No implicit unshipped blocker.
- **Risk profile?** No issues. No novel integration and no new external dependency — a string-classifier CLI verb plus two skill-prose seams over mechanisms already in the tree. The one genuine design call (reconcile (a) vs a stored spec-revision marker (b)) is resolved in-spec, decisively, citing FAFF-910's already-litigated rejection of the digest form; no de-risking spike warranted.
