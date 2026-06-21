# Rename eligibility vocabulary: "bless" → "crank up / crank down"

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-189.

Build spec for **FAFF-189**. A terminology rename across faff's skill suite: the eligibility verb "bless" (and jot's synonym "promote/demote") and the `bless-set` methodology named-output become **crank up / crank down** and **`crank-up-set`** — one verb everywhere for *elevate a ticket to automation-eligible (add `faff-automate`)*.

## 1. WHY

faff's term for making a ticket automation-eligible is "bless" (tidy/prep/wtf/gateway) and, inconsistently, "promote/demote" (jot) — two names for one action, and "bless" carries a religious connotation to drop. Replace the whole vocabulary with the production-line metaphor **crank up / crank down**, unified to a single verb.

**Principles.**
- **Atomicity of the contract token.** `bless-set` is a string-matched methodology named-output: a caller requests it by name, a producer answers by it. A partial rename silently breaks output resolution at runtime — not caught by `validate-adapters` or any test. The `bless-set` → `crank-up-set` rename across its contract definition + both callers + both producers must land **together**.
- **Rename the verb, not its homographs.** "promote"/"demote" are eligibility verbs in jot only. Do **not** touch the status move *promote to Todo* / *demote to Backlog* or the `promotion-readiness` methodology output.
- **Don't rewrite history.** CHANGELOG, committed design specs, ADRs are out of scope.

## 2. OUT OF SCOPE
- Status-move promote/demote; the `promotion-readiness` output.
- The `faff-automate` / `faff-automation-hold` label names (only the human verb changes).
- Historical artefacts: `CHANGELOG.md`, `docs/specs/*-design.md`, `docs/adr/*`.

## 3. WHAT — rename map

| Old | New | Form |
|---|---|---|
| bless (verb) | crank up | verb |
| unbless / demote (eligibility) | crank down | verb |
| promote (eligibility, jot) | crank up | verb |
| blessing / "the bless" | crank-up | noun |
| blessed / unblessed | cranked up / not cranked up | adjective |
| bless candidate | crank-up candidate | modifier |
| Bless gate (prep) | Crank-up gate | modifier |
| batch-bless | batch crank-up | modifier |
| `bless-set` (token) | `crank-up-set` | contract token |

**Hyphenation.** Verb = two unhyphenated words ("crank up"/"crank down"). Modifiers/nouns/token hyphenated ("crank-up-set", "crank-up gate"). Eligible adjective = "cranked up".

## 4. HOW — per-file change list

- **gateway** `plugin/skills/faff/SKILL.md`: "blesses it"→"cranks it up"; "Release / blessing is human-gated"→"Release / crank-up is human-gated" + promote/demote, bless/unbless → crank up/crank down; "if it were blessed"→"if it were cranked up"; `bless-set`→`crank-up-set` (the "bless batches → bless-set" line + the methodology-slot contract table row + description).
- **faff-tidy**: "unblessed"/"blessed"/"bless candidate"→"not cranked up"/"crank-up candidate"; request `bless-set`→`crank-up-set`; "Bless-set card"→"Crank-up-set card"; "batch-bless"/"Bless this set (N items)"→"batch crank-up"/"Crank up this set (N items)"; "single bless"/"never blesses"→"single crank-up"/"never cranks up"; "tidy's bless and jot's promote/demote"→"tidy's crank-up and jot's crank up/crank down"; "blessing is human-gated — only interactive tidy blesses"→"crank-up is human-gated — only interactive tidy cranks up".
- **faff-prep**: "offers to bless it"→"offers to crank it up"; "Bless gate"→"Crank-up gate"; "(bless / keep)"→"(crank up / keep)"; "On bless →"→"On crank up →"; the "(Bless-only: …)" parenthetical → crank-up wording.
- **faff-jot**: eligibility "promote"→"crank up", "demote"→"crank down" across description/flow/menu/edge-cases; "tidy says bless, jot says promote" → unified "crank up / crank down".
- **faffter-noon-methodology-structural**: `### bless-set`→`### crank-up-set` + token body; "it never blesses … human-gated batch-bless"→"it never cranks up … human-gated batch crank-up".
- **faffter-dark-methodology-agile-delivery**: `bless-set`→`crank-up-set` (output name + compose reference).
- **faff-wtf**: "not yet blessed"→"not yet cranked up"; "promote/demote"→"crank up/crank down"; request `bless-set`→`crank-up-set`.
- **CLI** `plugin/skills/faff/bin/faff`: label desc "Removing it demotes the ticket"→"Removing it cranks the ticket down"; comment/reason/help "if blessed"/"human blesses (faff-automate)"→"if cranked up"/"human cranks it up (faff-automate)".
- **test** `test/faff-tidy.test.mjs`: "ready-looking but unblessed" fixture title → "ready-looking but not cranked up". (`repeat-park.test.mjs` "demote" comments are STATUS-move context — DO NOT change.)

**Anti-patterns.** Blanket `s/promote/crank up/` (corrupts status-move promote + `promotion-readiness`); renaming `bless-set` in only some sites (runtime resolution breaks silently).

## 5. SCENARIOS
- Grep live skill prose + bin/faff for "bless"/eligibility-"promote/demote" (excl. historical) → 0.
- A caller requests `crank-up-set`; both methodologies answer by that name — resolves end-to-end.
- "promote to Todo" / "demote to Backlog" / `promotion-readiness` unchanged.
- `validate-adapters` + tests pass; judgement-eval baseline re-run with no regression.

## 6. DECISIONS
- **Chosen:** crank up / crank down (maintainer pick at intake).
- **Chosen:** full sweep — verb + `bless-set`→`crank-up-set` + fold jot's promote/demote in.
- **Chosen:** single atomic change for the token sites.
- **Chosen:** leave historical artefacts untouched.

## 7. ASSUMPTIONS
- **Assumes:** the judgement-eval net (FAFF-130/145) baseline is current/runnable, so this prose change can be re-baselined after landing. Sequence behind eval readiness; don't land ahead of the human-supervised reverify.
- **Assumes:** no third-party skill outside this repo requests `bless-set` by name.

## 8. DONE
- [ ] No live skill prose / bin/faff string uses bless/blessed/blessing/unbless (grep-clean, excl. historical).
- [ ] Eligibility promote/demote (jot + gateway + wtf) read crank up/crank down.
- [ ] Hyphenation convention applied.
- [ ] `bless-set`→`crank-up-set` in all five sites consistently.
- [ ] Status-move promote/demote + `promotion-readiness` unchanged; repeat-park.test.mjs "demote" comments unchanged.
- [ ] bin/faff strings + faff-tidy.test.mjs fixture updated.
- [ ] `faff validate-adapters` + full test suite pass.
- [ ] Judgement-eval baseline re-run with no regression (human-supervised; the ticket's gate).
