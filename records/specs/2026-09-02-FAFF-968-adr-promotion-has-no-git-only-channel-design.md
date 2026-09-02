# Spec — FAFF-968: Give ADR promotion a git-only channel (graft Step 4b reads intent from the committed spec body)

> Spec: faffter-dark-nlspec · 2026-09-02 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-968.

This is the buildable design spec for Linear issue **FAFF-968**, addressed to the build agent that will implement the fix and to the human reviewer who gates the PR. It covers a self-hosting change to this repo (the faff tool): faff-graft's `SKILL.md` prose plus one small deterministic CLI primitive and its regression test. It scopes deliberately narrowly so that sibling issue **FAFF-969** can land independently on an adjacent seam.

## 1. WHY — Problem and Principles

**The load-bearing model.** ADR promotion is a two-actor hand-off: faff-prep *decides* which architecturally-significant decisions deserve an ADR and records that intent under an `## ADR promotion intent` heading; faff-graft *materialises* each listed decision into the configured ADR directory at build time. Today that hand-off has exactly one wire — a **tracker comment**. In a git-only build (`tracker: none`) there is no tracker and therefore no comment, so graft's materialisation step finds no intent and skips silently. The fix adds a second wire that already exists physically on disk: the `## ADR promotion intent` section rides along inside the spec body, and by the time graft reaches materialisation that spec body is already committed in the worktree. Graft just has to read it there when the tracker comment is absent.

**Problem statement.** In a git-only autonomous L4 build, prep correctly identifies ADR candidates and carries an `## ADR promotion intent` section onto the shipped spec, but graft Step 4b materialises ADRs only when a tracker *comment* carries that intent — a channel git-only mode does not have — so no ADR is ever written, with no error, no skip log, and no surface. The pain is a silent, total coverage hole: architecturally-significant decisions that were actually built (for example the observed Postgres-persistence decision in run `run-20260902-011341-lights-out`) leave no ADR behind, and `faff adr list` stays empty. This change gives the intent a git-only channel by teaching graft Step 4b to fall back to reading the `## ADR promotion intent` section from the committed spec body when no tracker comment exists.

**This is a new channel, not a regression fix.** Evidence (`git log -p --all` across all 89 commits of faff-graft/SKILL.md) shows Step 4b has been tracker-comment-only since its introducing commit `6ac074f5` (FAFF-16); no spec-body fallback ever existed. The single historical git-only success is an anomaly to explain (most likely a run that reached a tracker after all, or an agent free-handing `faff adr new` outside Step 4b), not a baseline to restore. The build agent must not chase a phantom regression — it is building a channel that never existed.

**Design principles.**

**Touch only the second conjunct of the Step 4b gate.** The gate today reads `adr.mode ≠ off` **and** *the issue carries an `## ADR promotion intent` comment*. Only the second half — *where the intent is located* — is defective. The first half (`adr.mode ≠ off`) and everything downstream (scaffold, author-via-`adr`-slot, contradiction detection / supersession, commit) are correct and must stay byte-unchanged. Sibling issue FAFF-969 rewrites the first conjunct (the `adr.mode` semantics); this fix must leave a clean textual seam there so the two land without conflict.

**Preserve the tracker path exactly.** When a tracker comment is present the behaviour must be identical to today — same read, same materialisation. The spec-body read is strictly an added fallback, never a replacement, so a tracker-mode build produces byte-identical output before and after this change.

**Make the git-only channel deterministically testable.** The bug lives in SKILL.md prose, which cannot be executed. Per this repo's convention (`test/decision-capture-wiring.test.mjs`), a prose pilot site is tested by exercising the *mechanism* the prose drives with the real CLI. The fix therefore introduces a small deterministic extraction primitive so the "locate the intent in a text blob" step has a spawnable, assertable seam.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-graft/SKILL.md` (Step 4b, ~line 247) | Markdown prose | The bug site; the gate's second conjunct is edited here |
| `plugin/skills/faff-prep/SKILL.md` (~lines 408–416) | Markdown prose | Where prep records the intent; the architecture-proposal path that lands it in the spec body is the reached one |
| `plugin/skills/faff/bin/lib/adr.js` (~923 lines) | Node (dependency-free) | The `faff adr` CLI; new `extract-intent` sub-command lands here |
| `plugin/skills/faff/bin/lib/decisions.js` (`intent-status`, ~line 270) | Node | Precedent for a stdin-fed classify/extract primitive |
| `test/adr.test.mjs`, `test/decision-capture-wiring.test.mjs` | Node `node:test` | Test homes and the mechanism-testing convention to follow |

**Scope statement.** This fix sits at the prep→graft ADR hand-off inside the faff pipeline; it widens the intake side of graft's ADR materialisation to cover git-only builds, and touches nothing about how an ADR body is authored or committed.

## 2. OUT OF SCOPE

- **Prep's own tail-step git-only channel** — what's excluded: giving faff-prep's Scenario-A tail step (`plugin/skills/faff-prep/SKILL.md` ~line 414) a git-only way to record its candidates. Why excluded: in git-only *autonomous* mode the reached producer is the shared **Architecture proposal step** (`faffter-noon-architecture`), which already emits the `## ADR promotion intent` block into the spec body verbatim; prep's interactive tail step is not on the autonomous path this ticket observed. Extension point: a future issue would add a `.faff/`-routed channel for prep's tail candidates in `faff-prep/SKILL.md` near the existing git-only substitution rule.
- **The `adr.mode` first-conjunct semantics** — what's excluded: changing whether/when `adr.mode` gates materialisation. Why excluded: that is FAFF-969's ("Split adr.mode: make ADR recording unconditional, dial only supersession"). Extension point: the first conjunct of the Step 4b gate, left textually untouched here.
- **ADR body authoring, contradiction detection, and supersession (sub-steps 2, 3, 3b, 4)** — what's excluded: any change to how the `adr` slot authors the Nygard body, how `detect_contradictions` runs, or how `faff adr supersede`/`admit` gate. Why excluded: these are downstream of the intent-location bug and already correct. Extension point: unchanged; the fix routes a located intent into the existing sub-steps.
- **`faff adr` CLI materialisation behaviour** — what's excluded: `faff adr new` numbering, slug, append-only refuse-overwrite, provenance stamping. Why excluded: the CLI is fully tracker-agnostic and correct; the whole bug is upstream in the prose deciding *whether* to call it. Extension point: unchanged.
- **FAFF-967's fix** — what's excluded: the sibling `faff-plot/SKILL.md` Step 5c no-op. Why excluded: same incident class, different file, no code overlap. Extension point: its own ticket.

**Build coordination — the FAFF-968 ↔ FAFF-969 shared-region dependency (must be honoured before build).** FAFF-968 (this ticket) and FAFF-969 (`adr.mode` split) both edit the same faff-graft Step 4b region and both touch `plugin/skills/faff/bin/lib/adr.js`. This spec's clean-seam design lowers the collision risk — FAFF-968 *adds* the `extract-intent` subcommand and edits the gate's *second* conjunct, while FAFF-969 rewrites the *first* — but the two changes overlap in the same files, so their independence must be *encoded*, not trusted silently. Requirement: the build-queue conflict-analysis pass must treat FAFF-968 and FAFF-969 as a **collision group** (shared touch-point: faff-graft Step 4b + `adr.js`) and **serialise** them — build one, rebase the other onto it — never run them concurrently in separate worktrees. A reviewer or human may instead encode this as an explicit blocker edge between the two issues; either mechanism satisfies the requirement, but building them in parallel on the bare `relatedTo` edge alone is a merge-race and is not permitted.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| ADR promotion intent | A markdown section headed `## ADR promotion intent` listing the decisions prep has nominated for ADR materialisation |
| Intent channel | The medium carrying that section from prep to graft: today a tracker comment; this fix adds the committed spec body |
| Git-only mode | A run configured `tracker: none` — no tracker MCP, so no tracker issue and no tracker comment |
| Committed spec body | The builder-view spec file graft commits at Step 4 to `spec-docs-path` (this repo: `records/specs`) before Step 4b runs |
| Extraction primitive | The new deterministic CLI sub-command that locates and returns the `## ADR promotion intent` section from a text blob |

**The new CLI sub-command.** A small deterministic primitive is added to `plugin/skills/faff/bin/lib/adr.js`, mirroring the existing `faff decisions intent-status` (stdin/`--file -`-fed, classify-and-emit) precedent:

```
COMMAND faff adr extract-intent
  INPUT:  text blob on stdin, or --file <path> (--file - means stdin)
  BEHAVIOUR:
    Locate the section beginning at a line matching `## ADR promotion intent`
    (case-insensitive on the heading text, leading-`#` level tolerant),
    up to the next sibling `##`/`#` heading or end-of-blob.
  OUTPUT (present):  exit 0; the section text (heading + body) written to stdout
  OUTPUT (absent):   exit 1; empty stdout; short note to stderr
  OUTPUT (read fail): exit 2; stderr names the unreadable source
  PROPERTIES:
    Pure — filesystem/stdin read only; no tracker, no network, no git.
    Format-agnostic to the per-entry shape: it extracts the SECTION, it does
    not parse individual decision entries (two producers emit different
    per-entry shapes; entry enumeration stays with the LLM read in Step 4b).
```

**Design decision — deterministic primitive vs. free-text-only read.** Options: (a) keep Step 4b's existing LLM free-text read and merely point it at the spec-body file as a fallback source; (b) introduce a deterministic `faff adr extract-intent` primitive that locates the section, and hand its output to the existing free-text enumeration. Option (a) is smaller but leaves the git-only channel untestable (you cannot spawn prose), and acceptance criterion (4) requires a mechanism-level regression test. Option (b) matches the `faff decisions intent-status` precedent, gives the new channel a spawnable seam the regression test asserts against, and keeps the messy per-entry enumeration where it already works (the LLM read), because no shared per-entry parser exists and the two producers' entry shapes differ. **Chosen:** (b) — add `faff adr extract-intent` as the deterministic section-locator; leave per-entry enumeration in the existing Step 4b LLM read. Rationale: testability of the new channel is a hard requirement, and a section-locator is the smallest deterministic unit that makes it so without touching entry parsing.

**Design decision — the fallback source location.** Options: re-fetch or reconstruct the intent, versus read the spec file already on disk. By the time Step 4b runs, Step 4 has committed the builder-view spec to `$dir/YYYY-MM-DD-<issue-id>-<slug>-design.md` in this worktree, and the builder-view split only strips holdout-marked content inside the Scenarios/Acceptance-criteria section, so an `## ADR promotion intent` section elsewhere in the spec survives byte-identical into that committed file. **Chosen:** read the fallback intent from the on-disk committed spec file that Step 4 just wrote (`spec-docs-path`, this repo `records/specs`). Rationale: the source provably already exists on disk at Step 4b with no extra fetch, tracker call, or state threading.

**Design decision — precedence when both channels carry an intent.** In tracker mode both may be present: prep writes the tracker comment *and* the block rides on the spec body. Options: read both and union, read spec-body-first, or read comment-first with spec-body as fallback only. `faff adr new` is append-only and refuses to overwrite, so a union cannot double-write a file, but reading two possibly-divergent lists is needless ambiguity. **Chosen:** the tracker comment takes precedence; the committed spec body is consulted **only when no tracker comment is present**. Rationale: this makes the tracker path byte-identical to today (criterion 2) and gives git-only mode a single unambiguous source, with no risk of two divergent enumerations.

## 4. HOW — Behavior

**Architecture and approach.** The change has two parts. First, the deterministic locator `faff adr extract-intent` is added to `adr.js`. Second, the second conjunct of graft's Step 4b gate is rewritten so that "the issue carries an `## ADR promotion intent` comment" becomes "an `## ADR promotion intent` intent is present — from the tracker comment if there is one, otherwise from the committed spec body via `faff adr extract-intent`." Everything else in Step 4b is untouched.

**The revised Step 4b gate (prose behaviour, not a code change to the gate's downstream).**

```
PROCEDURE step_4b_locate_intent(issue, worktree, adr_mode):
  1. IF adr_mode == off: skip (UNCHANGED first conjunct — FAFF-969's seam)
  2. Locate the intent, comment-first:
     a. IF a tracker `## ADR promotion intent` comment exists (tracker mode):
          intent_text := that comment            # UNCHANGED tracker path
     b. ELSE (no tracker comment — git-only, or tracker with no comment):
          spec_file := the file Step 4 committed at
                       $(faff config spec-docs-path)/YYYY-MM-DD-<issue>-<slug>-design.md
          intent_text := faff adr extract-intent --file "$spec_file"
          #  exit 0 → intent_text is the section
          #  exit 1 → no section present  → intent is ABSENT
          #  exit 2 → unreadable source   → log, treat as ABSENT (fail safe, never crash graft)
  3. IF intent is ABSENT: skip (no materialisation, no contradiction detection) — UNCHANGED skip semantics
  4. ELSE: hand intent_text to the EXISTING Step 4b materialisation loop, unchanged:
       for each listed decision → scaffold (faff adr new … --provenance loop|human)
                                → author body via adr slot
                                → 3b detect/offer/admit supersession
                                → fill + commit
```

**Behaviour summary.** Step 4b now finds its intent from whichever channel exists — tracker comment first, committed spec body second — and then runs the identical, unchanged materialisation it runs today. In a git-only build with the section on the spec body, that means each listed decision becomes an ADR under `records/adr`, on the feature branch, shipping in the PR alongside the code.

**Provenance.** Unchanged: autonomous graft passes `--provenance loop`, interactive graft omits the flag (default `human`). A git-only autonomous build therefore stamps `loop`, exactly as a tracker autonomous build does — the channel the intent arrived on does not change provenance.

**Edge cases and error handling.**

- **No section in the spec body and no comment** → `extract-intent` exits 1, intent is absent, Step 4b skips cleanly (byte-identical to today's no-intent skip).
- **Spec file unreadable at Step 4b** → `extract-intent` exits 2; graft logs and treats the intent as absent rather than crashing the build (contradiction detection is additive, never build-blocking — same posture as the existing 3b/4c failure handling).
- **Both a comment and a spec-body block present** → comment wins; the spec body is not read (no double enumeration).
- **`adr.mode: off`** → skip before any locate, unchanged.
- **Heading variance** — the section may arrive from either the `faffter-noon-architecture` producer (one entry per `adr_candidate`) or prep's tail (title + spec section). `extract-intent` extracts the whole section regardless of per-entry shape; entry enumeration stays with the existing LLM read, which already tolerates both shapes.

**Failure modes.**

- **The failure:** the git-only channel depends on the `## ADR promotion intent` section actually surviving onto the committed spec body. If a producer stops emitting it, or the builder-view split were ever to strip it, the fallback reads an empty section and nothing materialises — silently, the very failure this ticket is about. **How you'd know:** the regression test (below) fails at the "ADR file lands under `records/adr`" assertion, and a real git-only run again shows an empty `faff adr list`. **What it means:** proceed, but keep the assertion end-to-end (file-on-disk), not merely "extract-intent returned non-empty", so a break in the survive-onto-spec-body assumption is caught.
- **The failure:** precedence is wrong and a tracker-mode build starts reading the spec body too, changing tracker-mode output. **How you'd know:** an existing tracker-path expectation shifts; guard with a test that a comment-present case never consults the spec body. **What it means:** narrow — the fallback must be strictly comment-absent-gated.

**Anti-pattern:** Replacing the tracker-comment read with the primitive in all modes. Why: it risks perturbing the byte-identical tracker path (criterion 2) for no benefit; the primitive is a fallback locator, not a universal one.

**Anti-pattern:** Teaching `extract-intent` to parse individual decision entries into structured fields. Why: two producers emit different per-entry shapes and no shared parser exists, and the primitive's contract is section-location only, and forcing entry parsing into it would couple it to producer formats that legitimately vary.

**Anti-pattern:** Editing the first conjunct (`adr.mode ≠ off`) or any 3b/4 sub-step while here. Why: FAFF-969 owns the first conjunct; disturbing it creates a merge conflict and blurs the seam the two fixes rely on.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git-only build (tracker: none) with adr.mode: offer,
  and the committed spec body carries an `## ADR promotion intent` section
  listing two decisions,
When graft Step 4b runs on the feature branch,
Then each listed decision is materialised as an ADR file under records/adr,
  and faff adr list reports them.
```

```
Given a tracker-mode build where a tracker `## ADR promotion intent` comment
  is present (and the block also rides on the spec body),
When graft Step 4b runs,
Then the intent is read from the tracker comment and the spec body is not
  consulted, producing output byte-identical to today's behaviour.
```

- The `faff adr extract-intent` primitive is pure: given the same text blob it returns the same section with no filesystem write beyond reading, no tracker call, and no network.
- The `adr.mode` first conjunct and all Step 4b sub-steps (scaffold, author, 3b-supersede, commit) are textually unchanged, leaving a clean seam for FAFF-969.

## 6. DESIGN DECISION RATIONALE

**Should the fix add a deterministic extraction primitive, or keep an LLM-only free-text read pointed at the new location?**
- Free-text-only: smallest diff, but the new git-only channel stays untestable (prose is unspawnable), failing acceptance criterion (4); it also offers no deterministic seam to assert a regression against.
- Deterministic primitive (`faff adr extract-intent`): a few lines in `adr.js`, mirrors the `faff decisions intent-status` precedent, and gives the channel a spawnable, assertable seam while leaving per-entry enumeration (which has no shared parser and two producer shapes) with the existing LLM read.
- **Chosen:** add `faff adr extract-intent` as a section-locator; keep entry enumeration in the LLM read — testability is a hard requirement and section-location is the smallest deterministic unit that satisfies it.

**Where does the fallback intent come from?**
- Re-fetch/reconstruct: needless; introduces new state and failure surface.
- The on-disk committed spec file Step 4 just wrote: the builder-view split preserves an `## ADR promotion intent` section byte-identically, so it is provably already present at Step 4b.
- **Chosen:** read the committed spec file at `spec-docs-path` (this repo `records/specs`). Rationale: zero extra fetch, the source demonstrably exists on disk at that point.

**Precedence when both channels carry an intent.**
- Union both: append-only `faff adr new` prevents double-writes, but two divergent enumerations are ambiguous.
- Spec-body-first: would perturb the tracker path.
- Comment-first, spec-body fallback only when no comment: keeps tracker mode byte-identical and gives git-only a single source.
- **Chosen:** comment-first; consult the spec body only when no tracker comment exists.

**How does the regression test assert materialisation?**
- Assert only that `extract-intent` returns non-empty: too shallow; misses the end-to-end "ADR lands" property that actually regressed.
- Mechanism test per `test/decision-capture-wiring.test.mjs`: spawn the real CLI — feed `extract-intent` a spec-body-shaped blob (and, for coverage, a tracker-comment-shaped blob), then run `faff adr new` with a title drawn from the extracted section and assert `<NNNN>-<slug>.md` lands under the configured `adr-docs-path`; assert the no-section blob yields exit 1 and no file.
- **The wiring gap (QA):** the mechanism test above hand-stitches the composition — the test author derives the `faff adr new --title` from the extracted section, whereas in real Step 4b an LLM enumeration does that. So the mechanism test proves the *primitives compose and an ADR lands*, but it does **not** prove *Step 4b's prose invokes `extract-intent` against the correct `spec-docs-path` file behind the correct gate*. A Step 4b wiring regression (wrong file path, dropped call, mis-gated conjunct) would ship green — the same silent-failure class this ticket exists to close. The wiring itself therefore needs its own oracle.
- **Chosen:** ship **two** oracles. (1) The mechanism test above — asserting the ADR file on disk under `adr-docs-path` as the end-to-end outcome, plus the negative (no-section → no file). (2) A **wiring oracle** over the unspawnable Step 4b prose, per this repo's `test/decision-capture-wiring.test.mjs` convention: assert the committed spec-file path Step 4b constructs matches `$(faff config spec-docs-path)/YYYY-MM-DD-<issue>-<slug>-design.md`, and add a prose-lint over `plugin/skills/faff-graft/SKILL.md` Step 4b asserting it literally names `faff adr extract-intent` and reads from `spec-docs-path` on the no-tracker-comment branch — so a dropped call, a wrong path, or a mis-gated conjunct fails a test rather than silently regressing. (The DoD line "no PR prose claims a restored baseline" stays a human-judgement criterion — no machine oracle — surfaced for the PR reviewer.)

**Scope of the SKILL.md edit.**
- Rewrite the whole Step 4b gate: risks colliding with FAFF-969 and disturbing correct downstream sub-steps.
- Edit only the second conjunct (intent location): isolates the fix and preserves the FAFF-969 seam.
- **Chosen:** edit only the second conjunct; leave the first conjunct and every downstream sub-step verbatim.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is closed.

**Assumptions.**

**Assumes:** the git-only intent channel depends on the shared Architecture-proposal step (`faffter-noon-architecture`) emitting the `## ADR promotion intent` block and prep carrying it verbatim onto the attached spec body, and on graft's Step 4 builder-view split preserving that section byte-identically into the committed spec file. Validation before building: confirm in `plugin/skills/faff-prep/SKILL.md` (~lines 408–416) that the architecture-proposal path instructs the spec producer to carry the block verbatim, and confirm at graft Step 4 (~lines 225–245) that `faff dod split --view builder` strips only holdout-marked Scenarios/Acceptance-criteria content, leaving a `## ADR promotion intent` section elsewhere untouched. Both were confirmed present during exploration; re-verify against the live tree before editing.

## 8. DONE — Definition of Done

### From WHY
- [ ] In a git-only build (`tracker: none`) with `adr.mode ≠ off` and an `## ADR promotion intent` section in the committed spec body, graft Step 4b materialises each listed decision as an ADR file under `records/adr` (the silent-skip hole is closed).
- [ ] The change is documented as a new channel, not a regression fix — no commit/PR prose claims a restored baseline.

### From WHAT (interfaces)
- [ ] `faff adr extract-intent` exists in `plugin/skills/faff/bin/lib/adr.js`, reads a text blob from stdin or `--file <path>` (`--file -` = stdin), and returns the `## ADR promotion intent` section on stdout with exit 0.
- [ ] `extract-intent` exits 1 with empty stdout when no such section is present, and exits 2 naming the source when it cannot read the input.
- [ ] `extract-intent` extracts the section for both producer shapes (architecture-proposal per-entry shape and prep tail-step title+section shape) without parsing individual entries.

### From HOW (behaviour)
- [ ] Step 4b reads the intent comment-first: when a tracker `## ADR promotion intent` comment is present it is used and the spec body is not consulted; tracker-mode output is byte-identical to before this change.
- [ ] When no tracker comment exists, Step 4b reads the committed spec file at `spec-docs-path` (`records/specs`) via `faff adr extract-intent` and uses that section as the intent.
- [ ] Autonomous git-only graft stamps materialised ADRs `--provenance loop`; interactive omits the flag (default `human`).

### From HOW (edge cases)
- [ ] No section and no comment → clean skip, byte-identical to today's no-intent skip.
- [ ] Unreadable spec file at Step 4b → logged and treated as absent; graft does not crash.
- [ ] The `adr.mode ≠ off` first conjunct and all Step 4b sub-steps (scaffold, author-via-`adr`-slot, 3b detect/offer/admit supersession, fill+commit) are textually unchanged — verified by diff — preserving FAFF-969's seam.

### Test coverage
- [ ] A regression test (in `test/adr.test.mjs` or a new `test/*.test.mjs`, per the `test/decision-capture-wiring.test.mjs` mechanism-testing convention) spawns the real CLI, feeds `faff adr extract-intent` a spec-body-shaped blob, then runs `faff adr new` with the extracted title and asserts a `<NNNN>-<slug>.md` file lands under the configured `adr-docs-path`.
- [ ] The same test asserts the tracker-comment-shaped blob also extracts, and that a no-section blob yields exit 1 and produces no ADR file.
- [ ] A **wiring oracle** covers the unspawnable Step 4b prose so a wiring regression cannot ship green: assert the committed-spec path Step 4b constructs equals `$(faff config spec-docs-path)/YYYY-MM-DD-<issue>-<slug>-design.md`, and a prose-lint over `plugin/skills/faff-graft/SKILL.md` Step 4b asserts it literally names `faff adr extract-intent` and reads from `spec-docs-path` on the no-tracker-comment branch (dropped call / wrong path / mis-gated conjunct → test failure).

### Build coordination
- [ ] FAFF-968 and FAFF-969 are serialised, not built concurrently: the build-queue conflict-analysis treats them as a collision group on the shared faff-graft Step 4b + `adr.js` touch-point (or a blocker edge encodes the same), so the shared-region edits never merge-race.

**Integration smoke test (happy path):**

```
1. Seed a git repo fixture with .faffrc adr_docs_path=records/adr,
   spec_docs_path=records/specs, adr.mode=offer.
2. Write a committed spec file records/specs/2026-09-02-FAFF-968-…-design.md
   containing an `## ADR promotion intent` section listing one decision.
3. section := faff adr extract-intent --file <that spec file>   # expect exit 0, non-empty
4. faff adr new --title "<decision from section>" --issue FAFF-968 --provenance loop
5. Assert: exactly one records/adr/<NNNN>-<slug>.md exists and faff adr list reports it.
```

confidence: high
build-tier: complex
spec-review: approve

_Revised 2026-09-02 (spec-review round 1, revise → round 2, approve): encoded the FAFF-968↔969 shared-region serialisation requirement (methodology-lens objection) and added a Step 4b wiring oracle to the test design so a wiring regression cannot ship green (QA-lens objection). Spec-review verdict: approve._
