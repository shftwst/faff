# Spec — FAFF-431: L2→L3 guide section (automation eligibility · per-level readiness · single-owner-tracker trust)

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-431.

This spec is for the build agent implementing FAFF-431 and for human reviewers. It defines **one user-facing guide section** (plus two small cross-links and a one-line correction) that closes the L2→L3 onboarding gap: a newcomer's first `/faff-beep-boop` silently routes the whole backlog into **On-hold** and nothing in the guide predicts or explains it. The work is a docs slice — prose only, no code, no CLI, no schema.

## 1. WHY — Problem and Principles

**The load-bearing model.** Under the shipped **fail-safe `opt-in`** default, *nothing* is automation-eligible until a human explicitly cranks a ticket up by adding the `faff-automate` label **in the tracker UI**. faff's own label CLI refuses to write that label in either direction, so `faff-automate` present ⟹ a human set it directly — that is exactly the by-construction provenance L3's trust rests on. A newcomer doesn't know this, so their first unattended run finds an empty eligible set and skips everything into the On-hold bucket.

**Problem statement.** The advertised overnight journey (README's "Want it all done while you sleep? Run `/faff-beep-boop`") stalls at the L2→L3 boundary because the single gesture that makes work automatable — the `faff-automate` crank-up — is documented in **no** user-facing doc (README, `docs/guide/unattended.md`, and `docs/guide/walkthroughs.md` are silent; only a terse `docs/guide/cli.md` row for `eligible` exists). The reader has no way to predict the skip, diagnose it, or fix it. `docs/guide/walkthroughs.md:24` actively misleads by claiming freshly-created jot tickets are "tagged so prep picks them up".

**Design principles.**

- **State the security premise where a team adopter will look, not only in the gateway.** The single-owner human-gated-tracker trust assumption (gateway `plugin/skills/faff/SKILL.md` "Untrusted input (no-execute floor)", ~lines 500–510) is the load-bearing premise of L3/L4 autonomy — it licenses a trusted spec's live-exercise AC to direct sandboxed execution. It is currently stated nowhere a reader evaluating "is this safe to run against our shared tracker?" will find it.
- **Describe the shipped behaviour, do not redesign it.** Eligibility is `opt-in` by default, `faff-automate` / `faff-automation-hold` are tracker-owned, not-eligible ≠ parked (On-hold bucket). The section reports these; it introduces no new mechanism, flag, or label.
- **Skimmable house style.** Per `docs/reference/skill-authoring.md` and the repo's guide voice: tables and bullets over prose walls; second person; no invented labelling schemes.

**Reference context.**

| System | Type | Relevance |
|---|---|---|
| `docs/guide/unattended.md` | Markdown guide (titled "Unattended runs (L3)") | The L3 deep-dive README's levels table links to — the natural home for the new section. |
| `docs/guide/walkthroughs.md` | Markdown guide | Line ~24 carries the false "tagged so prep picks them up" claim to correct. |
| `README.md` (levels table, L3 paragraph ~lines 20–31) | Markdown | Owns the L1–L4 taxonomy; the L3 paragraph should cross-link the new section. |
| `docs/guide/cli.md` | Markdown | Holds the terse `eligible` / `container-check` / `lights-out` rows the new prose points back to (no duplication). |
| gateway `plugin/skills/faff/SKILL.md` "Automation eligibility" (~330–370) + "Untrusted input" (~498–514) | Skill source | The authoritative source of the eligibility rules and the trust premise the section paraphrases. |

**Scope statement.** A documentation-only change under `docs/guide/` + `README.md`; it lands as a docs slice and does **not** reopen the Completed "A newcomer can adopt faff unaided" project.

## 2. OUT OF SCOPE

- **Any CLI, code, label, or config change.** — Why excluded: the behaviour is already shipped and correct; this ticket only documents it. Extension point: none — a behaviour change is a separate feature ticket.
- **A standalone `docs/guide/eligibility.md` page.** — Why excluded: the gap is specifically the L2→L3 unattended-onboarding narrative, which belongs in the existing L3 deep-dive; a new top-level page fragments the guide. Extension point: if eligibility content later outgrows the section, promote it to its own page and link from `unattended.md`.
- **L4 lights-out prerequisites beyond the readiness checklist's L4 row.** — Why excluded: `unattended.md` already has a "Going lights-out (L4)" section covering the cage, budget ceiling, and 8 guardrails. Extension point: that existing section; the new checklist's L4 row points to it rather than re-explaining it.
- **Documenting `automation_default: opt-out`.** — Why excluded: a brief mention that the default is `opt-in` and can be flipped is enough; the full opt-out semantics are a `configuration.md` concern. Extension point: `docs/guide/configuration.md`.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary** (define on first use in the section):

| Term | Definition |
|---|---|
| Automation eligibility | Whether the *autonomous* pipeline (`/faff-beep-boop`) may auto-spec / auto-promote / auto-build a ticket. Read/report skills are never gated by it. |
| Crank up | Make a ticket automation-eligible by adding the `faff-automate` label in the tracker. "Crank down" removes it. |
| On-hold | The bucket `/faff-wtf` and `/faff-tidy` render for not-automation-eligible tickets a human may want to crank up. Distinct from *Parked*. |
| Single-owner, human-gated tracker | A tracker whose write access is controlled by the same human who owns the repo — the premise that makes tracker content (the spec) as trustworthy as a PR-reviewed artefact. |

**Artefacts this ticket writes** (this is a docs change; the "interface" is the set of file edits):

- One **new section** in `docs/guide/unattended.md`, placed **before** "How the loop works", covering the three topics below.
- A **cross-link** added to the L3 paragraph in `README.md` (~line 29) pointing at the new section.
- A **one-line correction** to `docs/guide/walkthroughs.md:24`.

**The three topics the new section MUST cover** (the section's own sub-structure — headings/table shape are the author's call, content is fixed):

1. **The `faff-automate` crank-up gate.** The `opt-in` default (nothing automatable without an explicit label); `faff-automate` is the single include gesture; it is **tracker-owned** — a human toggles it in the tracker UI and faff's label CLI refuses to write it (that refusal is what makes "label present ⟹ human intent" true by construction); `faff-automation-hold` is the hard-stop override (`hold > automate > default`); a not-eligible ticket surfaces in **On-hold**, is never auto-picked-up, and is **not** parked. Cranking up does not auto-promote to Todo — the ticket simply rejoins normal eligibility on the next pass.
2. **A per-level readiness checklist.** Prerequisites per level, as a table (see HOW for the grounded contents): node/git everywhere; `gh` + a forge for L2+ merges; a tracker MCP (or git-only fallback); a host-isolated container + a spend/time budget ceiling + a reachable adversarial `review`/`spec_review` for L4; `tmux`/`screen` for L3/L4 over SSH.
3. **The single-owner human-gated-tracker trust assumption.** State the premise (tracker content is trusted *because* one human gates it, exactly as a PR is), what it licenses (a trusted spec's live-exercise AC may direct sandboxed, worktree-isolated execution), and the **revisit trigger** (if the tracker becomes shared / multi-tenant / externally-writable, the spec drops back to untrusted and the full no-execute floor reapplies).

**Design decision — home of the section.** Options: (a) new section in `docs/guide/unattended.md`; (b) new standalone `docs/guide/eligibility.md`; (c) expand `README.md` inline. **Chosen:** (a) `docs/guide/unattended.md` — README's levels table and L3 paragraph already point here as the L3 deep-dive, the doc is titled "Unattended runs (L3)", and the L2→L3 skip is precisely a first-unattended-run concern, so the reader hitting the skip lands exactly here.

**Design decision — placement within the file.** **Chosen:** immediately after the H1 intro and **before** "## How the loop works" — the reader must understand *what gets picked up* before *how the loop drains it*; a readiness/eligibility gate reads naturally as a precondition section at the top.

## 4. HOW — Behavior

**Approach.** Edit three files. No build step, no tests to write (docs); verification is by reading and by grep assertions (see Scenarios / DONE).

**The new section's grounded content** (author owns exact wording; these facts are load-bearing and must be accurate against the cited sources):

The **readiness checklist** table maps level → prerequisites, grounded in the shipped guide + CLI docs:

```
| Level | Needs |
| L1 (as the loop)  | node, git, a tracker MCP (or git-only mode). That's the planning tooling. |
| L2 (in the loop)  | + gh and a forge (graft opens PRs); the same tracker. |
| L3 (on the loop)  | + at least one ticket cranked up (faff-automate); tmux/screen if launching over SSH. |
| L4 (out of loop)  | + a host-isolated container (faff container-check), a spend/time budget ceiling, and a reachable adversarial review + spec_review — assembled by faff lights-out. |
```

**Anti-pattern:** duplicating the eligibility rules or the CLI subcommand descriptions verbatim from the gateway / `cli.md`. Why: the gateway is the source of truth and `cli.md` already carries the terse rows; the section paraphrases for the reader and points back, per the repo's dedup rule (`CLAUDE.md`: shared prose has one home).

**The `walkthroughs.md:24` correction.** The current line reads, after `y →`: "they're created in your tracker, tagged so prep picks them up." This is false under `opt-in`: jot tags a new ticket `faff-jot-intake` (intake provenance), **not** `faff-automate` (the eligibility gesture), so the *autonomous* pipeline does **not** pick it up. What actually happens is the walkthrough's next clause — jot **chains directly into interactive prep** ("Prep the first one for build now?"). Correct the line so it no longer implies automatic autonomous pickup: e.g. "they're created in your tracker (tagged `faff-jot-intake`); jot then offers to prep the first one right now" — and, where natural, a pointer that unattended pickup needs a crank-up (link the new section).

**The `README.md` cross-link.** Add a sentence or link at the end of the L3 paragraph (~line 29) directing the reader to the new section for "what makes work eligible before an unattended run".

**Failure modes — how this docs change could be wrong, and how you'd notice.**

- **The failure:** the section paraphrases the eligibility rules *inaccurately* (e.g. says faff can add `faff-automate`, or that a not-eligible ticket is "parked"). How you'd know: a line contradicts the gateway "Automation eligibility" / "Control-label provisioning" sections. What it means: correct against the cited gateway lines before merge — accuracy of the security/eligibility claims is the whole point.
- **The failure:** the `walkthroughs.md` fix over-corrects and denies that jot chains to prep at all. How you'd know: the walkthrough's own next lines still describe the "Prep the first one now?" chain. What it means: keep the chain, only remove the false *automatic autonomous pickup* implication.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a reader on docs/guide/unattended.md
When they read the file top to bottom before "How the loop works"
Then they find a section that names the faff-automate crank-up gate, the opt-in default, and the On-hold (not parked) outcome
```

```
Given the new section
When a reader looks for per-level prerequisites
Then a table maps each of L1–L4 to its prerequisites (node/git, gh/forge, crank-up + tmux, container + budget + adversarial review)
```

```
Given a team adopter evaluating safety for a shared tracker
When they read the new section
Then it states the single-owner human-gated-tracker trust premise AND the revisit trigger (shared/multi-tenant/externally-writable ⇒ spec drops back to untrusted, full no-execute floor reapplies)
```

```
Given docs/guide/walkthroughs.md after this change
When line ~24 is read
Then it no longer claims jot tickets are "tagged so prep picks them up", and the jot→interactive-prep chain is still described
```

- The new section's eligibility claims are consistent with the gateway "Automation eligibility" + "Control-label provisioning" sections (no claim that faff writes `faff-automate`; not-eligible described as On-hold, not parked).

## 6. DESIGN DECISION RATIONALE

**Where does the section live?** Options: new section in `unattended.md`; new `eligibility.md`; inline in README. **Chosen:** new section in `docs/guide/unattended.md` — README already routes L3 readers here, the doc is the L3 deep-dive, and the L2→L3 skip is a first-unattended-run concern. Rejected `eligibility.md` (fragments the narrative for a single missing concept) and README-inline (README is the pitch; the levels table already delegates the deep-dive to `unattended.md`).

**How much to say about the security premise?** Options: one-liner; full paraphrase with revisit trigger; copy the gateway verbatim. **Chosen:** a short paraphrase that states the premise *and* the revisit trigger, pointing to the gateway as the source of truth — enough for a team adopter to make the shared-vs-single-owner call, without duplicating the full no-execute-floor text (dedup rule).

**Correct vs delete the walkthroughs line?** **Chosen:** correct in place — the surrounding lines (jot→prep chain) are right; only the "tagged so prep picks them up" implication is false, so a minimal edit preserves the walkthrough's flow.

At the time of writing, the shipped default is `automation_default: opt-in` (confirmed via `faff config get automation_default`); revisit the "nothing is automatable by default" framing if that default ever changes.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the home, the content, and the correction are all determinate from the current docs + gateway.

**Assumptions:**

- **Assumes:** the shipped `automation_default` is `opt-in`. Validation: `faff config get automation_default` (confirmed `opt-in` at spec time). If a repo sets `opt-out`, the "nothing automatable by default" framing needs a one-clause caveat.
- **Assumes:** `docs/guide/walkthroughs.md:24` still carries the "tagged so prep picks them up" clause at build time. Validation: `grep -n "picks them up" docs/guide/walkthroughs.md` before editing; if the line moved, locate the equivalent claim.

## 8. DONE — Definition of Done

### From WHY
- [ ] `docs/guide/unattended.md` contains a new section explaining why a first `/faff-beep-boop` skips not-yet-eligible work (the opt-in default), placed before "How the loop works".

### From WHAT (the three topics)
- [ ] The section names the `faff-automate` crank-up gate: opt-in default, single include gesture, tracker-owned (faff's CLI refuses to write it), `faff-automation-hold` hard-stop, not-eligible ⇒ On-hold ≠ parked.
- [ ] The section contains a per-level readiness checklist table covering L1–L4 prerequisites (node/git; gh/forge; crank-up + tmux/screen; container + budget ceiling + adversarial review/spec_review).
- [ ] The section states the single-owner human-gated-tracker trust premise and its revisit trigger.

### From HOW (edits + accuracy)
- [ ] `docs/guide/walkthroughs.md:24` no longer claims jot tickets are "tagged so prep picks them up"; the jot→interactive-prep chain is retained.
- [ ] `README.md`'s L3 paragraph cross-links the new section.
- [ ] Every eligibility/security claim is consistent with the gateway "Automation eligibility", "Control-label provisioning", and "Untrusted input" sections (no claim faff writes the eligibility labels; not-eligible described as On-hold, not parked).
- [ ] No CLI/code/label/config change is made; the diff is confined to `docs/guide/unattended.md`, `docs/guide/walkthroughs.md`, and `README.md`.

**Integration smoke test:**

```
1. grep -n "faff-automate" docs/guide/unattended.md          → matches the new section
2. grep -n "On-hold" docs/guide/unattended.md                → not-eligible bucket named
3. grep -n "picks them up" docs/guide/walkthroughs.md         → no match (claim removed)
4. Read the readiness table                                   → four rows, L1–L4, each with prerequisites
```

confidence: high
spec-review: approve
