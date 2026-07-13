# Spec — Retire the gateway's "L4 not built yet" framing; name `faff lights-out` in the levels narrative

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Full spec on Linear FAFF-339.

This is the build spec for **FAFF-339**. Audience: the build agent that will edit the gateway prompt, and the human reviewer of that PR. It is a pure documentation-drift fix — no code, no contract, no config touched. The whole deliverable is two edits to `plugin/skills/faff/SKILL.md` and a consistency check against the already-shipped `faff lights-out` surface.

## 1. WHY — Problem and Principles

**Load-bearing model.** The gateway (`plugin/skills/faff/SKILL.md`) is auto-loaded into *every* faff session, so its front-page **levels narrative** is the always-in-context description of how far a run has wandered off the loop. When that narrative denies machinery the codebase actually ships, every reader — human and autonomous — is grounded on a false premise.

**Problem statement.** The gateway's L4 row and bullet still say **"The frontier. Not built yet, mind."** `faff lights-out` shipped: it is the enforced L4 entry point today (`plugin/skills/faff/bin/lib/lights-out.js`; `docs/guide/unattended.md:36–48`). The stale hedge is a drift defect (audit finding **R1** in `docs/audits/2026-07-04-faff-323-whole-system-coherence.md`) — an autonomous decision keyed off "L4 isn't real yet" would be wrong, and a human reading the gateway is told a shipped capability is vapour.

**Design principles.**

- **Ground the prose in the shipped code, not the ticket's remembered caveats.** FAFF-339's own description names the v1 caveats as *"basic preflight only; rich dial-coherence and the adversarial promotion are follow-ons."* That framing is **stale relative to the code as of 2026-07-12** (see the Design Decision Rationale). The replacement prose must describe what `lights-out.js` and `unattended.md` actually enforce today, not re-copy the ticket's caveat list.
- **Stay in the gateway's lane.** Sibling drift tickets own the neighbouring surfaces — the README/architecture sweep is **FAFF-432**, the "preview" maturity tag + per-level guarantee table is **FAFF-351**. This spec must not do their work (no `(preview)` rename, no guarantee table), only retire the "not built yet" line in the gateway and name lights-out honestly.
- **Skimmable, house style.** The edit obeys the skill-authoring standard (lean, no invented labelling); `faff validate-adapters` must still pass.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/SKILL.md` (levels table ~line 21, L4 bullet ~line 26) | Markdown prompt | The two spots being edited. |
| `docs/guide/unattended.md` (`## Going lights-out (L4) — faff lights-out`, lines 36–48) | Markdown doc | The **authoritative** shipped-surface description the gateway must agree with. |
| `plugin/skills/faff/bin/lib/lights-out.js` | JavaScript | Ground truth for the 8 guardrails, dial-coherence, ledger+banner, and the genuine remaining caveats. |
| `docs/audits/2026-07-04-faff-323-whole-system-coherence.md` | Markdown | Audit finding R1/T5 that motivates the change. |

**Scope statement.** A two-edit copy fix to the always-loaded gateway's levels narrative, bringing it into agreement with the shipped `faff lights-out` surface.

## 2. OUT OF SCOPE

- **README.md / architecture.md L4 staleness** — *Why excluded:* independently landable and owned by **FAFF-432** (README:31, architecture.md:11). *Extension point:* those files, under FAFF-432.
- **"L4 (preview)" maturity label + per-level mechanical-vs-model guarantee table** — *Why excluded:* the guarantee framing is **FAFF-351**'s deliverable, which explicitly coordinates with this ticket (339 retires the stale line; 351 owns the preview tag + banner label). *Extension point:* the gateway levels section + lights-out banner, under FAFF-351. This spec must **not** add `(preview)` to the table cell or banner.
- **Any change to `lights-out.js`, the guardrail contracts, or `.faffrc` behaviour** — *Why excluded:* this is a documentation-drift fix; the machinery is already shipped and correct. *Extension point:* n/a.

## 3. WHAT — the exact prose changes

Two edits in `plugin/skills/faff/SKILL.md`. Line numbers are approximate — anchor on the quoted text, not the number.

**Edit A — the levels-table L4 row (≈ line 21), Entry-point cell.**

Current cell reads `lights-out (frontier)`. Replace it so the entry point is named as the shipped command, dropping the "(frontier)" tag that reinforces the not-built reading.

The other four cells of the row are unchanged (the "What keeps it honest" cell — *adversarial review + isolated holdout* — is already accurate). Do **not** add `(preview)` (FAFF-351).

**Edit B — the L4 bullet (≈ line 26).**

Current bullet ends *"The frontier. Not built yet, mind."* Replace the whole bullet with prose that (a) names `faff lights-out` as the shipped L4 entry point, (b) states the fail-closed preflight over the 8 guardrail contracts + the L4 ledger mint, and (c) carries the **accurate** v1 caveat.

**Constraints on the replacement (WHAT-level, testable):**

- The substrings **"not built yet"** and **"Not built yet"** must not appear anywhere in `plugin/skills/faff/SKILL.md` after the edit.
- The bullet names the command `faff lights-out`.
- The bullet names the **8 guardrail contracts** (or "8 guardrails") and the **L4 run-ledger mint**.
- The 8 guardrail names align with `lights-out.js`'s `LIGHTS_OUT_GUARDRAILS`: `container`, `admissibility`, `spec_review`, `terminating`, `budget`, `observability`, `kill_switch`, `holdout`.
- No `(preview)` string is introduced (that is FAFF-351's).

## 4. HOW — Behaviour

Two in-place `Edit`s to `plugin/skills/faff/SKILL.md`, matching the quoted current text exactly. No file is created or deleted. No other faff surface changes in this ticket.

**Anti-pattern:** sweeping README.md or architecture.md in the same PR. Why: those are FAFF-432's, independently landable; folding them in couples two tickets and muddies the diff.

**Anti-pattern:** adding `(preview)` or a guarantee table. Why: that is FAFF-351's deliverable; doing it here pre-empts a ticket that owns the framing.

## 5. SCENARIOS — born-verifiable objectives

```
Given the edited plugin/skills/faff/SKILL.md
When grepping the file for "not built yet" (case-insensitive)
Then there are zero matches
```

```
Given the edited L4 bullet in plugin/skills/faff/SKILL.md
When a reader reads the levels narrative
Then it names `faff lights-out` as the shipped L4 entry point, states the fail-closed preflight over the 8 guardrail contracts, and states the L4 run-ledger mint
```

```
Given the edited gateway and the shipped surface doc docs/guide/unattended.md
When the two are compared on the L4 story
Then they agree — both say lights-out has shipped; neither the gateway nor unattended.md contains a "not built yet" claim
```

```
Given the edited gateway
When `faff validate-adapters` runs in CI
Then it passes (skill-authoring lint clean)
```

```
Given the edited gateway
When grepping for "(preview)"
Then the string is absent (FAFF-351's scope is untouched)
```

## 6. DESIGN DECISION RATIONALE

**Which caveats does the replacement prose carry — the ticket's stated list, or the shipped reality?**

The ticket says the v1 caveat is *"basic preflight only; rich dial-coherence and the adversarial promotion are follow-ons."* Reading `plugin/skills/faff/bin/lib/lights-out.js` at head (2026-07-12):

- **Dial-coherence has shipped** (FAFF-298): `dialCoherence()` refuses jointly-reckless dial combinations at preflight (requires adversarial `review` + `spec_review` occupants; requires fail-closed `gates.fallback`). It is *not* a follow-on.
- **All 8 guardrails are enforced** (`enforced: true` on every `LIGHTS_OUT_GUARDRAILS` entry; the header comment states *"All 8 guardrails are now enforced … the banner reads 8/8"*), including the per-run **holdout** (env→evaluate code-blind chain). The "adversarial promotion / holdout" is *not* a follow-on either.

So the ticket's remembered caveat list is stale (the very drift class this ticket exists to fix). The prep principle *"ground the prose in the shipped code"* wins over re-copying the ticket.

- **Options considered.** (a) Copy the ticket's caveat list verbatim — *rejected:* it would re-introduce a false statement (dial-coherence/holdout described as unbuilt). (b) Claim L4 is fully mature with no caveats — *rejected:* the honest remaining gaps are real and FAFF-351 exists precisely to label maturity. (c) Name lights-out as shipped-and-enforced, and scope the caveat to the *genuine* remaining items — trust-maturity labelling (FAFF-351) and the recipe-by-name vetting seam (`VETTED_RECIPES` is intentionally empty pending FAFF-18/FAFF-377).
- **Chosen:** Option (c) — describe the enforced machinery accurately and carry only the genuine remaining caveats (maturity labelling → FAFF-351; recipe-vetting seam → FAFF-18). Rationale: it fixes the drift without creating new drift, and cross-references the tickets that own the residual work.

**Should the levels-table cell keep the "(frontier)" tag?**

- Options: keep `lights-out (frontier)`; or drop to `faff lights-out`.
- **Chosen:** drop to `faff lights-out`. Rationale: "(frontier)" pairs with the bullet's "not built yet" to read as vaporware; naming the bare shipped command is the honest, skimmable form and matches `unattended.md`'s heading. The prose bullet can still convey "leading edge" without the not-built implication.

**Temporal anchor:** at the time of writing (2026-07-12), `VETTED_RECIPES` in `lights-out.js` is intentionally empty pending FAFF-18/FAFF-377, and FAFF-351 (preview labelling) + FAFF-432 (README/architecture sweep) are both still in Backlog. Revisit the caveat wording when those land.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. (No `**Punt:**` — the caveat question resolved cleanly against the codebase.)

**Assumptions:**

- **Assumes:** `docs/guide/unattended.md:36–48` remains the authoritative shipped-lights-out description at build time. *Validation:* re-read that section before editing; if it has itself drifted, prefer the code (`lights-out.js`) as ground truth and note the discrepancy.
- **Assumes:** the quoted current gateway text (`lights-out (frontier)`; `The frontier. Not built yet, mind.`) is still present at build time. *Validation:* grep the file for both strings before editing; if absent, the drift was already fixed — verify against DONE and close.

## 8. DONE — Definition of Done

### From WHY
- [ ] `plugin/skills/faff/SKILL.md` contains **zero** case-insensitive matches for "not built yet" (the drift line is gone).

### From WHAT (Edit A — levels table)
- [ ] The L4 row's Entry-point cell reads `` `faff lights-out` `` (not `lights-out (frontier)`).
- [ ] The row's other cells (including *adversarial review + isolated holdout*) are unchanged.

### From WHAT (Edit B — L4 bullet)
- [ ] The L4 bullet names `faff lights-out` as the shipped single entry point promoting L3 → L4.
- [ ] The bullet states a **fail-closed preflight** over the **8 guardrail contracts** and names them consistently with `lights-out.js` (`container`, `admissibility`, `spec_review`, `terminating`, `budget`, `observability`, `kill_switch`, `holdout`).
- [ ] The bullet states that a clean preflight **mints an L4 run-ledger** (+ trust banner).
- [ ] The caveat names only *genuine* remaining items — maturity labelling (FAFF-351) and the recipe-by-name vetting seam (FAFF-18) — and does **not** describe dial-coherence or the holdout as unbuilt.
- [ ] The bullet cross-references `docs/guide/unattended.md`.

### From WHY (scope boundaries)
- [ ] No `(preview)` string is introduced anywhere in the file (FAFF-351 untouched).
- [ ] No change to README.md, architecture.md, or any file other than `plugin/skills/faff/SKILL.md` (FAFF-432 untouched).

### From HOW (consistency + lint)
- [ ] The gateway's L4 story agrees with `docs/guide/unattended.md` (both: lights-out shipped; no "not built yet").
- [ ] `faff validate-adapters` passes (skill-authoring lint clean).

**Integration smoke test:**

```
1. grep -ni "not built yet" plugin/skills/faff/SKILL.md   → 0 matches
2. grep -n "faff lights-out" plugin/skills/faff/SKILL.md   → ≥1 match (table cell + bullet)
3. grep -n "(preview)" plugin/skills/faff/SKILL.md          → 0 matches
4. faff validate-adapters                                   → exit 0
```

confidence: high
spec-review: approve
