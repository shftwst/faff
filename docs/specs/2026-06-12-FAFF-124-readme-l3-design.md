# Spec: Slim, refresh & re-frame the root README around L3 (FAFF-124)

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high. Full spec on Linear FAFF-124.

This is the design spec for restructuring `README.md` from a 340-line manual into a short orientation + pitch, with reference/how-to content relocated to a small set of `docs/` pages. Audience: the build agent doing the rewrite, and human reviewers. It defines the **target structure, the docs page set, the narrative reframe, and the staleness fixes** — it does not pre-write the prose.

## 1. WHY — Problem and Principles

**Problem statement.** The root `README.md` is 340 lines / 27KB and front-loads L1/L2 — the least interesting levels — before a reader can tell where they fit or what they'd gain; it also carries reference detail (CLI, skill tiers, agent lanes, slot-swapping) that bloats the pitch and has drifted from reality. This change cuts it to a skimmable orientation + pitch centred on L3, and relocates the reference/how-to/walkthrough content into targeted `docs/` pages.

**Design principles:**

- **The README is a pitch, not a manual.** Its job is to get a reader to "I see where I fit and what I'd gain — I'll adopt this / level up." If a section is reference, how-to, or a guided walkthrough, it belongs in `docs/`, not the README. Reject any rewrite that keeps deep reference inline "for convenience."
- **L3 is the centrepiece; L1/L2 are the on-ramp.** L1/L2 are the same tracker + methodology tooling **without** build automation, so the delivery narrative explains their payoff implicitly. Don't give them equal weight to L3. L4 is one sentence (frontier, not built).
- **The tracker is the spine.** The pitch is organised around *the tracker as the control plane* driving two halves: deliver the **right things** (methodology automation) and deliver them **right** (spec-driven loop). This is the through-line, not a buried aside.
- **Purge, don't deprecate.** Pre-1.0, no adopters. Superseded concepts are removed outright with no "replaces the old X" / "was retired" framing. Document only what faff is now.
- **Ground in the gateway's own words.** The levels, the control-plane principle, the methodology-delegation rule, and the loop are defined in the gateway `SKILL.md`. Mirror them; don't reinvent.

**Reference context:**

| System | Type | Relevance |
|---|---|---|
| `README.md` | Markdown | The artifact being restructured (340 lines) |
| `docs/` (has `adr/`, `specs/`) | Markdown dir | New user-facing pages slot in beside these; orthogonal |
| gateway `SKILL.md` | Skill prose | Canonical source for levels / control-plane / methodology / loop narrative |
| `bin/faff` | Node CLI | Source of truth for the CLI subcommand list (11 subcommands) |

**Scope statement.** This restructures the repo's front-door documentation only; it changes no code, skills, or CLI behaviour.

## 2. OUT OF SCOPE

- **Rewriting any skill `SKILL.md` or gateway prose** — *Why:* this ticket is the README + `docs/` only. *Extension point:* the separate project "Skill prompts are lean, deduplicated and skimmable."
- **A docs site generator / index hub** (mkdocs, Docusaurus) — *Why:* the user chose root README + flat `docs/` pages, no hub. *Extension point:* a future `docs/index.md` + generator config if the page set grows.
- **A glossary page** — *Why:* nice-to-have, not load-bearing for the pitch; avoid scope creep. *Extension point:* `docs/glossary.md` later.
- **Changing CLI behaviour to add `faff --help` output** — *Why:* the CLI already prints a subcommand list; the docs page just reflects it. *Extension point:* n/a.
- **Net-new conceptual content** beyond what the gateway already documents — *Why:* the README should reflect faff as it is, not pitch unbuilt capability (L4 stays a teaser). *Extension point:* update when L4 ships.

## 3. WHAT — Structure, Page Set, and Fixes

### 3.1 Target README section list

**Chosen:** the README is reduced to the following sections, in order, target **~120–160 lines** (from 340):

1. **`# faff` + tagline** — one-line what-it-is.
2. **What faff is** (short) — the delivery loop (issue → spec → build → review → ship), "safe to stop watching, one step at a time"; the two halves (right things / things right) with the **tracker as the control plane** as the spine.
3. **The levels** — the L1–L4 table (kept) + L3-centred prose: L1/L2 ≈ one line each (tooling without build automation), **L3 the centrepiece** (`/faff-beep-boop`, unattended, park protocol + run-ledger), L4 one frontier sentence. Includes the "where do you fit / what you gain" hook.
4. **Install** — kept, unchanged in substance.
5. **Your first five minutes** — kept, the quickstart funnel.
6. **Commands** — compact quick-reference table, **all 10** commands incl. `/faff-onboard`, one-liner each, linking deeper material to `docs/`.
7. **Going further** — a short link list into the `docs/` pages (see 3.2).
8. **Credits** — kept.
9. **License** — kept.

**Chosen:** the two cross-cutting knobs (Slots, Appetite) get a one-line mention in §2/§3 and their detail moves to `docs/configuration.md` — they are not levels and shouldn't read as such.

### 3.2 The `docs/` page set

**Chosen:** a **small, grouped** set of 6 pages (not one-per-concern, not a monolith). Each is plain markdown, linked relatively from the README's "Going further" section:

| Page | Folds in (from current README) | Role |
|---|---|---|
| `docs/walkthroughs.md` | "Starting from nothing: idea → tickets" + "A first run, start to finish" | Guided examples |
| `docs/unattended.md` | "How it works" + "Fire and forget" | The L3 deep-dive: unattended runs, park protocol, run-ledger, tracker-as-control-plane detail |
| `docs/configuration.md` | "Setup" (`.faffrc.yaml` reference) + Slots + Appetite | Customisation how-to |
| `docs/cli.md` | "The `faff` CLI" | Full CLI subcommand reference |
| `docs/architecture.md` | "Agent lanes" | Orchestrator / Implementor / Evaluator + isolation |
| `docs/skills.md` | "Skill tiers" (+ subsections) + "Appendix: skill families, qualifiers, swapping" | Skill catalogue + slot model + swapping third-party producers |

**Each moved section is removed from the README** once relocated (not duplicated); the README references the page instead.

### 3.3 Staleness fixes (mandatory)

| Fix | Where | Detail |
|---|---|---|
| Add `/faff-onboard` | README Commands table | Real command (gateway routing); table currently lists 9, missing onboard |
| `.faffrc` → `.faffrc.yaml` | README | Canonical filename is `.faffrc.yaml`; fix every occurrence (incl. example YAML blocks) |
| CLI subcommand list | `docs/cli.md` | Reflect the real set: `config` (+ `config init`), `runcheck`, `validate-adapters`, `labels`, `eligible`, `next`, `state`, `gitignore-ensure`, `contract`; or point at the binary's printed list |
| Purge `mode: delivery-lead` | was README → `docs/skills.md` | Describe the `methodology` slot as it is; **drop** "Replaces the old `mode: delivery-lead`" framing |
| Purge retired-adaptor framing | was README → `docs/skills.md` | Describe the producer-emitted `faff-contract:<name>` model directly; **drop** "their `spec_adaptor`/`review_adaptor`/`ship_adaptor` slots were retired" backward-references |

**Assumes:** the skill-tier counts the README currently states (9 `faff-*`, 6 `faffter-noon-*`, 5 `faffter-dark-*`, 2 `faffidavit-*`) are accurate and only need relocating. *Validation:* `ls` the skills dir before writing `docs/skills.md`; correct any drift found.

**Assumes:** `docs/` is plain markdown with no site generator. *Validation:* confirm no `mkdocs.yml` / `docusaurus.config.*` at repo root before choosing relative-link style (there is none today).

## 4. HOW — Behaviour

**Approach.** A pure content move + rewrite, in three passes:

```
PROCEDURE restructure_readme:
  1. Create docs/ pages (3.2): for each target page, move the named
     README section(s) verbatim, then apply the relevant staleness fix
     and purge superseded framing. Add an H1 + one-line intro per page.
  2. Rewrite README to the 3.1 section list:
     a. Reframe intro + levels around L3 + the tracker-control-plane two-halves spine.
     b. Compress L1/L2 to ~a line each; L4 to one sentence.
     c. Replace each moved section with a one-line pointer under "Going further".
     d. Apply README-resident staleness fixes (/faff-onboard row; .faffrc -> .faffrc.yaml).
  3. Fix all cross-links: every README->docs link and any intra-doc link resolves
     to a real file + anchor.
```

**Link integrity.** Every relative link the README adds (`docs/<page>.md`) must point at a file created in pass 1. Every in-page anchor reference (e.g. `[Setup](#setup)` style that now crosses files) must be re-pointed to the new location.

**Anti-pattern:** moving a section to `docs/` but leaving a stale copy or a now-dangling `#anchor` link in the README. Why: produces broken nav and the duplication the slim-down exists to remove.

**Anti-pattern:** rewriting the L4 row into a feature pitch. Why: L4 is not built; over-selling it misleads adopters. Keep it one honest frontier sentence.

**Edge cases:**
- A moved section references another moved section → both land in `docs/`; fix the link to the sibling page, not back to the README.
- The README's existing same-file `#setup` / `#install` anchors → after the move, `Install` and the five-minutes funnel stay in-README (anchors still valid); `Setup` becomes `docs/configuration.md` (re-point).

## 5. DESIGN DECISION RATIONALE

**How granular should the `docs/` page set be?**
- *One page per concern (~11 pages):* maximal targeting, but a sprawl of thin files for a pre-1.0 doc set; more cross-links to maintain.
- *Single `docs/guide.md` monolith:* trivial linking, but recreates the "one big wall" problem a level down.
- *Grouped 6-page set:* walkthroughs / unattended / configuration / cli / architecture / skills — cohesive, few files, each substantial.
- **Chosen:** grouped 6-page set — matches the user's "small, grouped, no index hub" steer and keeps each page worth opening.

**README target length?**
- **Chosen:** ~120–160 lines — enough for the pitch + levels + install + five-minutes + a 10-row command table + links, without re-bloating. A hard cap isn't asserted (prose varies); the section list in 3.1 is the real constraint.

**Keep a commands table in the README, or move it?**
- **Chosen:** keep a compact one-liner table (orientation belongs in the pitch); deeper per-command trigger detail lives in `docs/skills.md`.

**Keep the levels prose in README or a `docs/levels.md`?**
- **Chosen:** keep in README — the levels *are* the pitch (where-you-fit). Per-level depth lives in the matching docs page (L3 → `docs/unattended.md`).

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the page breakdown and target length are resolved above.

**Assumptions:**
- Skill-tier counts accurate, relocate-only — *validate:* `ls` the skills dir before writing `docs/skills.md`.
- `docs/` is plain markdown, no generator — *validate:* no `mkdocs.yml` / `docusaurus.config.*` at root.

## 7. DONE — Definition of Done

### From WHY
- [ ] `README.md` is ≤ ~160 lines and contains only the §3.1 sections (no reference/how-to/walkthrough bodies inline).
- [ ] The pitch is organised around the tracker-as-control-plane two-halves narrative (right things / things right), grounded in the gateway's wording.

### From WHAT (structure)
- [ ] README sections match the §3.1 ordered list exactly.
- [ ] Levels table present; L1/L2 ≈ one line each, L3 is the most-developed level, L4 is a single frontier sentence.

### From WHAT (docs page set)
- [ ] All 6 `docs/` pages exist: `walkthroughs.md`, `unattended.md`, `configuration.md`, `cli.md`, `architecture.md`, `skills.md`.
- [ ] Each moved section appears in exactly one place — its `docs/` page — and not in the README.

### From WHAT (staleness)
- [ ] `/faff-onboard` is in the README commands table (10 commands total).
- [ ] No occurrence of bare `` `.faffrc` `` remains in `README.md`; all are `.faffrc.yaml`.
- [ ] `docs/cli.md` lists the real CLI subcommands (`config`, `config init`, `runcheck`, `validate-adapters`, `labels`, `eligible`, `next`, `state`, `gitignore-ensure`, `contract`) or points at the binary's printed list.
- [ ] No `mode: delivery-lead` string anywhere in `README.md` or `docs/`.
- [ ] No `spec_adaptor` / `review_adaptor` / `ship_adaptor` "retired/replaces" framing in `README.md` or `docs/`; the producer-emitted-contract model is described directly.

### From HOW (behaviour)
- [ ] Every README→`docs/` link resolves to a created file.
- [ ] No dangling same-file `#anchor` links remain for moved sections.
- [ ] `grep -rn` for each moved section's old heading finds it only in its `docs/` page.

**Integration smoke test:**
```
1. Render README.md (e.g. grip or GitHub preview).
2. Confirm: pitch reads top-to-bottom in well under a screen-and-a-half;
   L3 is clearly the centrepiece.
3. Click every link under "Going further" -> each opens a real docs/ page.
4. grep README.md for: ".faffrc"(bare), "delivery-lead",
   "spec_adaptor" -> all return nothing.
5. Confirm /faff-onboard row present in the commands table.
```

## Methodology critique

_Lens: `faffter-dark-methodology-agile-delivery` (`issue-critique`)._

- **Right-sized** — README rewrite + 6 `docs/` pages + staleness fixes are interdependent (cross-links) and always ship together, so this is correctly one unit, not a split. On the larger side but cohesive; no merge/split action.
- **Workstream fit** — good. "A newcomer can adopt faff unaided" is outcome-named and cohesive; an adoption-facing README is squarely in it.
- **Deps surfaced** — none. Related-but-separate to "Skill prompts are lean, deduplicated and skimmable" (that targets skill prose, not the README); no blocker link warranted.
- **Risk profile** — low. Docs only, no novel integration or external dependency; no de-risking spike needed.

confidence: high
