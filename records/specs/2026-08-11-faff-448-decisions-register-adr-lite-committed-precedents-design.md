# Decisions register — ADR-lite committed precedents the resolve-attempt rules consult

> Spec: faffter-dark-nlspec · 2026-07-11 · interactive · confidence: high. Full spec on Linear FAFF-448.

The autonomous resolve-attempt already exists (`faff/SKILL.md` → **Resolve-attempt before park**): before parking a `needs-decision-first` punt, an autonomous run tries a bounded local inference. This spec adds one thing in front of that inference — a lookup into a **decisions register**: a small, git-committed, human-authored doc of settled small precedents. When a run parks on a punt, the human resolves it interactively; today the *next* run parks on the *same* punt. The register converts each human answer into a permanent park class deleted — the "pino vs winston" park-eliminator. Audience: the build agent (consumes precedents), human reviewers (author + ratify them), and the CLI author who adds the `faff decisions` subcommand.

## 1. WHY — Problem and Principles

**The load-bearing model.** Autonomy moves from *acquisition* to *consumption*. The run never *learns* a precedent on its own (that would be a machine-authored, forgeable, never-authoritative artifact). A human authors + commits the precedent through the normal git PR review lane; the autonomous run only *consumes* a precedent that was already human-ratified on commit. Consuming a human-ratified precedent to resolve-instead-of-park is safe precisely because a human ratified it — the same template as the infosec-prior work (loop closes through a ratified committed carrier, never runtime state).

**Problem statement:** an autonomous run parks on a small settled-able punt; a human resolves it interactively; the next run re-parks the same punt because nothing durable captured the answer. The register is a committed doc the resolve-attempt consults first, so a resolved punt never re-parks.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **The register is human-authored, git-committed, human-visible, reversible.** The committed artifact is authoritative; git history is the audit trail. It is **never** agent-writable runtime state. Two independent reasons: (a) the build lane shares uid + filesystem with orchestrator artifacts inside the container, so any agent-writable runtime state a later decision *reads* is forgeable; (b) the calibration invariant — "append-only and never authoritative; a skill never reads calibration to make a current decision." A register the autonomous run *reads to decide* must therefore not be agent-writable runtime state. Since `.faff/` is gitignored, the register cannot live there — it lives under `docs/` (committed).
- **The match is deterministic, precision-biased, and human-controlled.** A wrong match auto-resolves the *wrong* punt — that is autonomy-widening, so the match must be conservative: only a confident, unambiguous match against human-declared keys resolves; everything else falls through to today's behaviour. No fuzzy/semantic inference — a pure CLI can't, and mustn't guess.
- **The autonomous path only consumes; it never writes the register.** Writes happen only on the human-confirmed capture path, materialised into a PR the human ratifies. A machine-authored entry would violate the human-authored invariant.
- **Deterministic-tools-over-prose.** The match/citation is a deterministic string operation in a pure CLI (like `faff next` / `faff eligible` / `faff adr list`), not graded prose judgement — so it is testable and reproducible, and introduces no new LLM-judgement seam.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` | Node (region `factory`) | The heavier sibling — deterministic mechanics over a committed `docs/adr/*.md` log; the register is "ADR-lite" and its CLI parses `docs/decisions.md` the same way `adr` parses ADR headers |
| `plugin/skills/faff/bin/lib/next.js` / `eligible.js` | Node | The pure-function-CLI invariant: caller passes state, CLI computes, never executes/enforces — the `faff decisions match` contract |
| `plugin/skills/faff/SKILL.md:705-723` | SKILL prose | The resolve-attempt seam — the consumption site the register slots in front of |
| `plugin/skills/faff-graft/SKILL.md:528-552` | SKILL prose | Graft's resolve-attempt mirror (defers to the gateway; carries a `3 files` drift to fix) |
| `plugin/skills/faff-prep/SKILL.md:242-290` | SKILL prose | The ADR-promotion pattern (prep records intent → graft materialises) the capture path mirrors, and the interactive-resolution sites |

**Scope statement:** this sits *below* the ADR axis — ADRs capture architecturally-significant durable decisions; the register captures *settled, small, non-architectural* punts that keep re-parking. It plugs into the existing `needs-decision-first` resolve-attempt; it is not a new orchestration surface.

## 2. OUT OF SCOPE

- **Auto-learning / auto-mining precedents from run history** — the register is human-authored only. Extension point: a future L4 capability could *suggest* candidate entries from the calibration log's `over-cautious-parks` signal, but it would still route through human authoring + PR ratification, never a runtime write. The `/faff-tidy` calibration-signal surfacing already exists as the advisory suggestion path.
- **Fuzzy / semantic / embedding-based matching** — precision-biased deterministic string match only. Extension point: a future architecture-lens occupant could replace the match step behind the same `faff decisions match` CLI signature.
- **Auto-graduation of a register entry to a full ADR** — human-initiated only (see graduation section). Extension point: the existing `## ADR promotion intent` → `faff adr new` pipe.
- **Adding a resolve-attempt to `repeat-parked`** — that verdict deliberately gets none; the register does not change it (see the boundary section).
- **A register-write CLI primitive (`faff decisions new`)** — deliberately omitted (see the CLI-surface decision); writes are ordinary file edits landed in a human-ratified PR.
- **`gap-blocked` / `circular-blocked` resolve-attempts** — the register only informs `needs-decision-first` (the punt/decision verdict); the other two verdicts are dependency/cycle shaped, not decision-precedent shaped.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Decisions register | The committed `docs/decisions.md` doc: settled small decisions with rationale, scope, and match keys |
| Register entry | One `##`-section of the register — one settled decision |
| Match key | A human-declared punt-topic string an entry claims to answer (e.g. `pino vs winston`, `logging library`) |
| Citation id | A stable kebab slug of an entry's topic heading, used to cite the entry in the audit-trail comment |
| Capture path | The human-confirmed flow that turns an interactive punt resolution into a proposed register entry |

**The carrier — `docs/decisions.md`.** A single committed markdown file, one `##` section per entry:

```
## Logging library
- Chosen: pino
- Rationale: pino is the house structured-JSON logger; already used app-wide since the platform slice shipped.
- Scope: all backend services; excludes the CLI (which writes plain stdout).
- Matches: pino vs winston; logging library; which logger
- Date: 2026-07-11
- ADR: (optional) docs/adr/NNNN-… once graduated
```

Field rules (what `faff decisions validate` enforces):

```
RECORD RegisterEntry:
  topic:     text        # the "## " heading; source of the citation id
  chosen:    text        # required, non-empty — the settled answer
  rationale: text        # required, non-empty — why
  scope:     text        # required — descriptive: where/when the decision holds. Human-readable context
                         #   surfaced in the citation comment so a PR reviewer sees the claimed domain.
                         #   NOT a match input (the match reads only `matches`); a too-broad Scope is a
                         #   human-authoring signal, caught at PR review, never a silent widener.
  matches:   List<text>  # required, non-empty — semicolon-separated declared punt-topic keys
  date:      text        # required — ISO date the human settled it
  adr:       text        # optional — a pointer set only when graduated

  CONSTRAINT citation_id = kebab_slug(topic)   # stable, unique across entries
  CONSTRAINT matches is non-empty              # an entry with no keys can never fire — invalid
```

**CLI surface — a new `faff decisions` subcommand (region `factory`, pure, no tracker/network):**

| Invocation | Behaviour | Exit |
|---|---|---|
| `faff decisions match --punt "<topic>" [--json]` | Normalize the punt topic + every entry's `Matches:` keys and match on **normalized equality** (a declared key must *equal* the normalized punt topic — never substring/containment); return the single equal-matching entry (`{ id, chosen, rationale, scope }`) or a no-match. **Two+ entries match → no-match** (ambiguity is a signal to fall through, never to guess). | `0` always (a no-match is `{ "match": null }`, not an error); `2` on a malformed/unreadable register |
| `faff decisions list [--json]` | List every entry (id, topic, chosen, date). | `0`; `2` on malformed register |
| `faff decisions validate` | Structure lint: required fields present + non-empty, unique citation ids, well-formed sections; `FAIL docs/decisions.md ✗ <reason>` per violation. | `0` clean, `1` violation(s), `2` unreadable |
| `faff decisions --selftest` | Runs the match/normalise/validate fixture table. | `0`/`1` |

Pure-function contract (mirrors `faff next` / `faff eligible`): **the caller passes the punt topic; the CLI reads only the committed `docs/decisions.md` and computes the match. It never executes the resolution, never writes, never touches the tracker.** An absent `docs/decisions.md` is a clean no-match (`match: null`), not an error — the register is optional infrastructure a repo may not have yet.

**Design decision — carrier shape.** Options: (a) single `docs/decisions.md`; (b) a `docs/decisions/NNNN-*.md` directory with numbering; (c) a `docs/decisions.yaml`. A directory-with-numbering reproduces the exact ADR apparatus the register is meant to be *lighter than* — contiguous-number validation, per-file scaffolding — for entries that are by definition smaller than ADRs. YAML gains machine-parse tidiness but loses the human-visible, PR-review-friendly prose that makes the carrier authoritative-by-reading. A single markdown file is the lightest human-authorable carrier, parses with the same header-field reader `adr.js` already uses, and keeps the whole register reviewable in one PR diff. **Chosen:** a single committed `docs/decisions.md`, one `##` section per entry — ADR-lite by construction.

**Design decision — match / citation form.** The match must be deterministic and precision-biased (a false match auto-resolves the wrong punt). Options: fuzzy/semantic (rejected — a pure CLI can't, and false-positives widen autonomy incorrectly); human-declared keys + substring/containment (rejected — a short generic key like `logging library` *contained in* a longer punt about a different subsystem would fire a confident cross-domain match, the exact autonomy-widening failure); human-declared keys + **normalized equality**. **Chosen:** each entry carries explicit human-declared `Matches:` keys; `faff decisions match` normalizes (lowercase, collapse internal whitespace, strip surrounding punctuation/quotes) both the `--punt` topic and each declared key, and matches **only when a declared key equals the normalized punt topic in full** — never as a substring, prefix, or contiguous phrase within a longer string. If **two or more** entries equal-match, the CLI returns no-match (ambiguity falls through to the existing bounded inference, never a guess). Equality (not containment) is what makes precision fully human-controlled and closes the cross-domain false-positive by construction: the human declares *every exact phrasing* an entry should answer (the `Matches:` list is plural for exactly this), and a phrasing they didn't declare simply falls through to today's behaviour rather than mis-resolving. `Scope:` is **not** consulted by the match — it is descriptive context surfaced in the citation so a PR reviewer sees the claimed domain. The citation is the entry's stable kebab-slug id.

**Design decision — CLI write surface.** Options: add `faff decisions new` (symmetry with `faff adr new`), or keep the CLI read-only. `faff adr new` writes because ADR authoring is a structured multi-field scaffold; a register entry is a six-line markdown block a human (or graft, drafting from a confirmed intent) can write directly, and *not* having an agent-invokable register-write primitive is itself a guardrail reinforcing the human-authored invariant. **Chosen:** the `faff decisions` CLI is read-only (`match` / `list` / `validate`); register writes are ordinary committed-file edits landed in a human-ratified PR — never a CLI-driven runtime write.

## 4. HOW — Behavior

### Consumption — the resolve-attempt consults the register first

The gateway `needs-decision-first` resolve-attempt row (`faff/SKILL.md:713`) gains a **first move, before** the existing bounded inference: extract the Punt's topic and call `faff decisions match --punt "<topic>"`.

```
PROCEDURE resolve_needs_decision_first(punt):
  1. topic := the Punt marker's "X or Y" topic string
  2. hit := `faff decisions match --punt "<topic>"`
  3. IF hit is a single confident match:
     a. Proceed, implementing hit.chosen  (this is a CITATION of a human-ratified
        precedent, NOT a bounded inference — see budget note)
     b. Write the register-hit audit-trail comment (below)
     c. Return proceed
  4. ELSE (no match / ambiguous multi-match):
     a. Fall through to today's bounded inference (re-read Punt section, check
        codebase conventions, spec-internal Chosen: markers, related shipped issues)
     b. Park if that inference doesn't yield a single clear/defensible answer
```

**File-read budget clarification.** The gateway resolve-attempt reads "at most 3 files outside the spec's named scope at `medium`, 5 at `high`" (`faff/SKILL.md:717`). The register lookup reads **one committed governance doc** (`docs/decisions.md`), not codebase files, and a register hit is a *citation of a ratified precedent*, not an inference over code. **Chosen:** the register lookup does **not** count against that file-read budget — it is a distinct, cheaper, deterministic step that runs before the budgeted inference. The gateway prose states this explicitly.

**Audit-trail comment — register-hit variant.** The existing resolve-attempt always writes a tracker comment (`faff/SKILL.md:719-721`). A register-driven proceed writes a variant that cites the entry instead of narrating an inference:

> _Faff autonomous resolve-attempt (decisions register):_ The spec flagged this as `Punt: pino vs winston`. The committed decisions register entry `logging-library` records `Chosen: pino` (Rationale: pino is the house structured-JSON logger). Proceeding per that human-ratified precedent. **If this is wrong, comment on this PR before merge and faff will re-park.**

**Graft mirror + the 3/5 drift.** Graft restates the resolve-attempt (`faff-graft/SKILL.md:528-552`, deferring to the gateway). Its `needs-decision-first` bullet (:534) gains the same register-consult-first move, and its bounded-read line (:540 — currently a flat "Read at most 3 files") is corrected to defer to the gateway's appetite-scaled bound ("at most 3 files at `medium` / 5 at `high`, per the gateway"), fixing the existing drift rather than propagating it. **Chosen:** align graft's bound wording to the gateway's appetite-scaled bound and add the register consult, so the mirror stays a faithful restatement.

### Capture — turning an interactive resolution into a proposed precedent

Mirrors the ADR-promotion pattern (prep records intent, graft materialises) exactly:

```
PROCEDURE offer_capture(resolved_punt):        # runs at interactive resolution sites
  1. AFTER a human resolves a punt interactively (prep Scenario A `resolve`, or a
     Scenario B Resolution comment), offer: "Capture this as a decisions-register
     precedent? (y/n)"
  2. IF yes:
     a. Prep records a `## Decisions-register intent` tracker comment: the proposed
        entry (topic, chosen, rationale, scope, suggested Matches keys). Prep writes
        NO repo files — it stays tracker-only, exactly like `## ADR promotion intent`.
     b. If a build follows, graft materialises the intent by appending the entry
        section to docs/decisions.md on the feature branch — it ships in the PR and
        is RATIFIED by the human's PR review (the same "travels with the code,
        PR-reviewable" property as an ADR).
     c. If NO build follows (pure interactive resolve), prep surfaces the drafted
        entry text for the human to add + commit directly (human-authored by hand).
  3. The AUTONOMOUS resolve-attempt path NEVER offers capture and NEVER writes the
     register — it only consumes. A machine-authored entry would violate the
     human-authored/ratified invariant.
```

**Design decision — capture ownership.** Options: autonomous auto-capture on a successful resolve-attempt (rejected — machine-authored entry, forgeable, violates the invariant), vs human-confirmed prep-intent → graft-materialise. **Chosen:** capture is human-confirmed only; prep records intent, graft materialises into the PR (ratified on review), a no-build resolve hands the human the drafted text. The autonomous consumer never writes.

**Anti-pattern:** having the autonomous resolve-attempt write a register entry when it proceeds. Why: it would make the run *acquire* precedent (machine-authored, unratified) rather than *consume* it — the exact never-authoritative / forgeable failure the design exists to avoid.

### Graduation to a full ADR

**Design decision — graduation.** The register is the deliberately-lightweight tier; auto-classifying which entries are "architecturally significant" is the same judgement prep's ADR-promotion v1 explicitly does **not** automate. **Chosen:** graduation is human-initiated only in v1 — when a human judges a register entry cross-slice/durable, they run it through the existing `## ADR promotion intent` → `faff adr new` pipe; the register entry may then carry an optional `ADR:` pointer to the materialised ADR. No auto-graduation, no significance classifier — a clean boundary, not new automation.

### The register-vs-`repeat-parked` boundary

**Design decision.** The register consult runs *inside* the `needs-decision-first` resolve-attempt, so it pre-empts the **first** park: a punt with a matching precedent resolves on the first encounter and never accumulates toward `repeat-parked` (3+ parks / 21 days, same root-cause). **Chosen:** the register pre-empts the first park and does **not** add a resolve-attempt to `repeat-parked` — that verdict's "no resolve-attempt; the pattern signals a human must act" rule stays intact. A genuinely repeat-parked punt with *no* matching precedent still parks for a human, unchanged. This boundary is stated explicitly in the gateway prose so the two mechanisms don't blur.

**Failure mode — a wrong match silently ships the wrong decision.** The register auto-resolves a punt; if a match fires on a punt the entry doesn't actually settle, the run builds the wrong choice. *How you'd know:* the audit-trail comment names the cited entry + chosen value on every register-driven proceed, and the PR is mergeable-not-merged with the "comment before merge and faff re-parks" backstop; a human reviewing the PR sees the citation and can flip it back. *What it means:* proceed, but keep the match precision-biased (unambiguous single match only) and always emit the citing comment so the resolution is visible pre-merge — never a silent proceed.

## 5. Scenarios — born-verifiable main objectives

```
Given docs/decisions.md has an entry `logging-library` with Matches: "pino vs winston"
  And a spec carries `**Punt:** pino vs winston — needs human`
When an autonomous run reaches the needs-decision-first resolve-attempt
Then `faff decisions match --punt "pino vs winston"` returns that entry
  And the run proceeds implementing `pino`, writing the register-hit audit-trail comment
  And the punt does not park (nor count toward repeat-parked)
```

```
Given two register entries both declare a Matches key that normalizes-equal to the punt topic
When `faff decisions match --punt "<topic>"` runs
Then it returns no-match (ambiguous), and the run falls through to the bounded inference
```

```
Given entry `logging-library` declares Matches: "logging library"
  And a punt topic is "structured logging library for the audit subsystem" (a longer, different punt)
When `faff decisions match --punt "structured logging library for the audit subsystem"` runs
Then it returns no-match (the declared key is not full-string-equal to the punt topic — containment never fires)
  And the run falls through to the bounded inference, not a cross-domain auto-resolve
```

```
Given no docs/decisions.md exists in the repo
When `faff decisions match --punt "<anything>"` runs
Then it returns a clean no-match (exit 0, match: null), not an error
```

```
Given a human resolves an open Punt interactively in faff-prep and answers "y" to capture
When prep completes
Then a `## Decisions-register intent` tracker comment records the proposed entry
  And prep writes no repo files
  And (if a build follows) graft appends the entry to docs/decisions.md on the feature branch
```

Non-functional assertions:

- The `faff decisions` CLI performs no tracker or network access (pure function over the committed doc).
- No autonomous code path writes `docs/decisions.md` — the only writers are graft-materialise-from-confirmed-intent and direct human commit.

## 6. Design Decision Rationale

- **Carrier shape** — single `docs/decisions.md` vs directory-with-numbering vs YAML. **Chosen:** single markdown file — lightest human-authorable ADR-lite carrier, one-PR-reviewable, parses with the existing header-field reader; a directory reproduces the ADR apparatus the register is meant to undercut.
- **Match / citation form** — fuzzy/semantic vs human-declared keys + substring-containment vs human-declared keys + normalized **equality**. **Chosen:** human-declared `Matches:` keys, normalized full-string equality (never substring/containment), ambiguous multi-match → no-match, precision-biased. A false match is autonomy-widening, so it must be conservative and human-controlled; equality closes the cross-domain containment false-positive by construction (a generic key contained in an unrelated longer punt cannot fire); `Scope:` is descriptive-only, not a match input; determinism keeps it testable (deterministic-tools-over-prose).
- **CLI write surface** — add `faff decisions new` vs read-only. **Chosen:** read-only (`match`/`list`/`validate`); no agent-invokable register-write primitive, reinforcing the human-authored invariant; writes are ordinary PR-ratified file edits.
- **Consumption wiring** — where the lookup sits. **Chosen:** first move inside the `needs-decision-first` resolve-attempt, before the bounded inference; it does not count against the file-read budget (one governance doc, a citation not an inference); the graft mirror gets the same step and its 3/5 drift is corrected to the gateway's appetite-scaled bound.
- **Capture ownership** — autonomous auto-capture vs human-confirmed prep-intent → graft-materialise. **Chosen:** human-confirmed only; the autonomous consumer never writes the register.
- **Graduation to ADR** — auto vs human-initiated. **Chosen:** human-initiated only, reusing the `## ADR promotion intent` → `faff adr new` pipe; optional `ADR:` back-pointer.
- **`repeat-parked` interaction** — **Chosen:** the register pre-empts the first park; it adds no resolve-attempt to `repeat-parked` (that hard rule stays).
- **Judgement seam** — **Chosen:** none. The match is a deterministic string operation in a pure CLI, not a graded judgement, so no grader `KIND`, no eval case, and no seam-registry row are introduced; the `validate-adapters` REGISTRY is unchanged (a CLI subcommand + a committed doc is plumbing, like `faff adr`, not a slot-occupant skill).

## 7. Open Questions and Assumptions

**Open Questions:** none — every non-trivial decision is Chosen above.

**Assumptions** (validate before build):

- **Assumes** the resolve-attempt seam at the gateway `needs-decision-first` row is the sole autonomous consumption site (validated against `faff/SKILL.md:705-723` and the graft mirror `faff-graft/SKILL.md:528-552`; routing assigns the verdict but does not run the resolve-attempt — beep-boop/graft do). Re-confirm the row/line anchors before editing, as prose can shift.
- **Assumes** `docs/` is committed and `.faff/` is gitignored, so the register must live under `docs/`.
- **Assumes** the `faff decisions` subcommand registers exactly as `faff adr` does — a new `bin/lib/decisions.js` (region `factory`), added to the `bin/faff` COMMANDS map + USAGE, `regions.js` REGION_MAP + REGION_SELFTEST_ARGV, and documented in `docs/guide/cli.md` (validated: `lint-cli-doc` asserts COMMANDS ⊆ cli.md bidirectionally; `regions check` asserts REGION_MAP/COMMANDS parity).

## 8. Done — Definition of Done

### From WHY
- [ ] A resolved punt with a matching register entry does not re-park on the next autonomous run (the acquisition→consumption relocation holds).
- [ ] The register lives at `docs/decisions.md` (committed), never under `.faff/`; no autonomous code path writes it.

### From WHAT (carrier + types)
- [ ] `docs/decisions.md` is a single markdown file, one `##` section per entry, with `Chosen` / `Rationale` / `Scope` / `Matches` / `Date` (+ optional `ADR`) fields.
- [ ] `faff decisions validate` fails on a missing/empty required field, an empty `Matches` list, or a duplicate citation id.

### From WHAT (CLI)
- [ ] `faff decisions match --punt "<topic>"` matches on normalized full-string **equality** of a declared key (never substring/containment) and returns a single match `{ id, chosen, rationale, scope }` or `{ match: null }`; two+ equal-matches → `match: null`; `Scope:` is not consulted by the match.
- [ ] The CLI performs no tracker/network access and does not write (pure, region `factory`); an absent `docs/decisions.md` is a clean no-match, not an error.
- [ ] `faff decisions list [--json]` and `faff decisions --selftest` behave per the table; the subcommand is registered in COMMANDS + USAGE + REGION_MAP + REGION_SELFTEST_ARGV and documented in `docs/guide/cli.md` (`lint-cli-doc` + `regions check` pass).

### From HOW (consumption)
- [ ] The gateway `needs-decision-first` resolve-attempt row consults `faff decisions match` before the bounded inference; a hit proceeds citing the entry, a no-match/ambiguous match falls through.
- [ ] The gateway states the register lookup does not count against the 3/5 file-read budget.
- [ ] A register-driven proceed always writes the register-hit audit-trail comment naming the cited entry id + chosen value.
- [ ] The graft mirror gains the register-consult step and its bounded-read line is corrected to the gateway's appetite-scaled 3-at-medium/5-at-high bound.

### From HOW (capture + boundaries)
- [ ] An interactive punt resolution offers "capture as a decisions-register precedent?"; on yes, prep records a `## Decisions-register intent` comment (no repo write) and graft materialises it into `docs/decisions.md` on the feature branch (or, no-build, prep hands the human the drafted text).
- [ ] The autonomous resolve-attempt path never offers capture and never writes the register.
- [ ] Graduation to a full ADR is human-initiated via the `## ADR promotion intent` → `faff adr new` pipe; the entry may carry an optional `ADR:` pointer.
- [ ] The register pre-empts the first park and adds no resolve-attempt to `repeat-parked`.

### Eval coverage
- [ ] No new LLM-judgement seam is introduced (the match is deterministic) — so no grader `KIND`, eval case, or seam-registry row is required, and `validate-adapters` REGISTRY is unchanged. State this explicitly in the ticket.

### Skill-prose obligations
- [ ] Every SKILL.md edit (gateway, graft, prep) is self-contained — no `FAFF-NN` / ADR references in the runtime prose the build writes; rules are stated forward.
- [ ] Edited SKILL.md files stay under their line caps (gateway 1100 — currently 1038; graft 650 — 579; prep 600 — 421).

### Integration smoke test
```
# Given a temp repo with docs/decisions.md holding a `logging-library` entry
#   (Matches: "pino vs winston"), spawn the real bin/faff:
faff decisions validate                         # exit 0
faff decisions match --punt "pino vs winston" --json   # -> { id: "logging-library", chosen: "pino", ... }
faff decisions match --punt "redis vs memcached" --json # -> { match: null }  (no declared key)
faff decisions match --punt "structured logging library for the audit subsystem" --json
                                                        # -> { match: null }  (containment must NOT fire — the
                                                        #    false-positive precision case: a generic declared
                                                        #    key contained in a longer unrelated punt)
# In an empty repo (no docs/decisions.md):
faff decisions match --punt "anything" --json    # -> { match: null }, exit 0
```
A `test/decisions.test.mjs` in the `test/adr.test.mjs` shape (spawnSync the real BIN against a `tmpRepo()` with a committed `docs/decisions.md` fixture, assert stdout/exit) covers `match` (exact-equal hit) / `list` / `validate` / no-match / **containment-false-positive (a declared key contained in a longer punt returns no-match)** / ambiguous (two equal-matching entries) / absent-file.

confidence: high
spec-review: approve

## Methodology critique

`Methodology: faffter-dark-methodology-agile-delivery`

Per-issue read of **FAFF-448** through the agile-delivery lens. Overall: a well-shaped, well-sequenced first slice — the notes below are mostly affirmations with two things confirmed during prep.

**Principle 4 — right-sized (affirm, do not split).** The ticket spans three surfaces (a committed `docs/decisions.md`, a pure `faff decisions` CLI + `test/decisions.test.mjs`, and prose edits to gateway/graft/prep SKILL.md). That reads at first like a split candidate, but the spec establishes they are contract-coupled: the consumer prose is dead without the CLI, the CLI is pointless without the wiring, and the capture path grows the register the consumer reads. Splitting them would ship a half-built vertical — a CLI with no caller, or gateway prose citing a command that doesn't exist — which is exactly the "merge units that always ship together" case, not the "split independent concerns" one. Recommendation: keep it as one end-to-end slice. It sits at the upper end of a 1–3 day unit, so hold the line on scope during build rather than letting the prose edits sprawl.

**Principles 1 + 5 — workstream fit / cohesion (affirm).** The ticket encodes a single outcome — a resolved punt never re-parks — so it is cohesive and outcome-shaped, not a mixed bucket. *(Confirmed during prep: the project "Faff learns from being run" is the grouping home; FAFF-13 is a `relatedTo` tracing reference — "done" is judged against the project's DoD, not the parked epic.)*

**Principle 6 — surfaced deps (honest edges).** The tracker state is honest: no blocker edges, and the resolve-attempt seam already exists, so there is no upstream to link — correct for build-order #1. *(Confirmed during prep: `docs/prdr/0001` explicitly delegates the concrete carrier to "each epic's `/faff-prep` decision" — this lane is licensed to settle its own carrier shape; the spec's Chosen single-file carrier is that call, no PRDR ratification gate pending.)*

**Principle 7 — risk-aware sequencing (affirm, no spike needed).** The novel elements — a new committed-carrier convention and a new CLI surface — would normally argue for a de-risking spike. Here they don't: both are modelled closely on the existing `faff adr` sibling (parser, `test/adr.test.mjs` shape, regions + cli-doc wiring), so the mechanics are a trodden path. The real risk is autonomy-widening — a wrong match auto-resolves the wrong punt — and the spec de-risks it by design (normalized-equality match, ambiguous → no-match fall-through, always-cite audit comment, mergeable-not-merged backstop). Recommendation: no separate spike; keep those precision guards build-blocking, and note that landing this convention *first* (ahead of siblings 2/4/5/6) is exactly the early de-risking this principle wants.

**Principle 2 — value × risk (affirm the pick).** As the smallest useful slice that ships standalone value (the park-eliminator works end-to-end without any sibling lane), this is a sound first pickup: observable value early, no wait on unbuilt siblings, novel-but-templated risk introduced where it's cheapest to prove.
