# nlspec — FAFF-438: One documented, reachable home for a container's explicit `target`

> Spec: faffter-dark-nlspec · 2026-08-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-438.

## WHY

The gateway's `prdr-author` contract resolves a container's `target` as **explicit > inherited > methodology-default** (`plugin/skills/faff/SKILL.md:1096`), and both the thematic and agile methodologies branch their DoD ambition on it (`faffter-noon-methodology-thematic/SKILL.md:240,243`; `faffter-dark-methodology-agile-delivery/SKILL.md:51`). Verified against the callers: `/faff-plot` Step 5b (`faff-plot/SKILL.md:150`), `/faff-jot`, and `/faff-tidy` each assemble `{outcome, child_specs, target}` and re-state the resolution order — but **nothing documents where a human writes an explicit value**. So the top rung is unreachable: every container falls through to inherited / methodology-default (`finished`).

This is genuinely doc-only. The `target` is read by an LLM producer (the methodology skill) following prose instructions, not by a parser — so naming a home in prose and pointing the re-read step at it is sufficient to make the rung fire. No code path assembles `target` from any source today, so nothing regresses.

## Decisions

**Chosen (a) — syntax + value vocabulary.**
A bare `target: <value>` line in the container's (project **or** initiative) **tracker description** field. Rules, documented as a convention (no parser/enum/validate change):

| Aspect | Decision |
|---|---|
| Location | The container's **description** in the tracker (e.g. Linear project/initiative description) — not a comment, not the PRDR record, not `.faffrc`. |
| Line form | `target: <value>` on its own line, case-insensitive key, first occurrence wins. |
| Value vocabulary | One of the two ambition-band tokens the methodology already reads: **`thin-mvp`** or **`finished`** (the poles of the "thin MVP … finished" scale named at `SKILL.md:1096`). |
| Anything else | Unrecognised text or no line → the explicit rung does not fire; resolution falls through to inherited then methodology-default (`finished`). |
| Inherited rung | An **initiative-level** `target:` line is the value a child project inherits when the project sets none. State this in one clause — no inheritance mechanics beyond it. |

**Chose the scale tokens over free prose** because the DoD scaling branches on exactly these two bands (`faffter-noon-methodology-thematic/SKILL.md:243`: thin-MVP ⇒ first-slice children; finished ⇒ all children). Free prose would make the top rung fire non-deterministically — the producer would have to interpret arbitrary text — undercutting the ticket's whole point (a *reachable, concrete* explicit rung). Appetite still tunes *within* the band (unchanged).

**Chosen (b) — doc home.**
**`docs/guide/walkthroughs.md`** — a short new subsection under the existing **"Starting from nothing: idea → tickets"** heading (verified present, `walkthroughs.md:11`). Justification:
- No planning/projects guide page exists (confirmed: `docs/guide/` has no such page; `docs/concept/` and `docs/reference/` explain PRDRs only mechanically, not "how a human steers ambition").
- That section is exactly where a human creates containers — `/faff-plot` decomposes into initiatives → projects (`walkthroughs.md:38-43`). The `target` convention belongs adjacent to that roadmap-decomposition example.
- **A whole new page is overkill** for a one-paragraph convention; a subsection is right-sized for a doc-only chore. **Punt:** promoting this to a dedicated planning-guide page — warranted only if planning docs grow, out of scope here.

**Assumes:** the tracker exposes an editable container **description** field (true for Linear/GitHub/Jira; git-only mode has no containers, so the convention is inert there — acceptable).

## WHAT — the exact edits (design-level, one PR)

1. **`docs/guide/walkthroughs.md`** — new short subsection (the canonical human-facing statement). States: to steer a container's ambition, put a `target: thin-mvp` or `target: finished` line in the project/initiative **description**; absent → the loop uses the inherited (initiative-level) value, else its default (`finished`); one initiative-level line is what its projects inherit. Self-contained prose, no issue refs, no broken links.

2. **`plugin/skills/faff/SKILL.md:1106`** — the **"Manual changes are authoritative (`prdr-author`)"** step (the steer-loop re-read). Extend it so the re-read **also names where the explicit `target` is read from**: alongside re-reading the container's current DoD + human edits, prdr-author reads the explicit `target:` line from the **container description**. This is the single skill-prose home for the WHERE; keep it terse (the operative instruction the producer needs).

3. **`plugin/skills/faff/SKILL.md:1096`** (the contract row) — **unchanged in substance**: it already states `explicit > inherited > methodology-default`. It stays consistent with the one home; do not restate the location here.

4. **No edits to the callers' resolution prose** — `faff-plot/SKILL.md:150`, `faff-jot`, `faff-tidy`, `faffter-noon-methodology-thematic/SKILL.md:240`, `faffter-dark-methodology-agile-delivery`. They already say the order and already refer back to the "Manual changes are authoritative" section; they **refer back**, never restate the location. This preserves the ONE-home discipline.

**Implementer notes (from spec-review, both minor):**
- Attach the `docs/guide/walkthroughs.md` subsection to the **`/faff-plot` container-creation sub-example** (`walkthroughs.md:38-43`), not merely under the `/faff-jot`-centric "Starting from nothing" heading — that's where a human actually creates the initiatives/projects a `target:` steers.
- The gateway line budget is tight (`SKILL.md` is 1169 lines vs the `validate-adapters` baseline 1170). Make the `:1106` change an **in-line paragraph extension** (the paragraph is ~85 words, well under the 200-word cap), **not** added lines, to keep `faff validate-adapters` green.

## DONE — concrete, testable

- A human reading `docs/guide/walkthroughs.md` can set an explicit target: the subsection gives the exact `target: thin-mvp|finished` line and the field (container description) it goes in.
- `plugin/skills/faff/SKILL.md:1106` names that same location as where `prdr-author` reads the explicit `target` — the top resolution rung is now reachable end to end.
- `SKILL.md:1096` still states `explicit > inherited > methodology-default`; the doc page and the gateway state the **same single convention**, one canonical home (gateway `:1106`), other prose refers back.
- `faff validate-adapters` **green** — the `:1106` edit stays within paragraph-length / line caps, adds no stray decision markers, and any `→ **Section**` anchor it uses resolves to a real heading.
- **No new load-bearing issue refs** added to gateway or `docs/guide` prose (added prose names no `FAFF-N`).
- Docusaurus build clean (no broken links from the new subsection) — docs never stale, both edits in **one PR**.
- **Scope guard:** no CLI flag, no `.faffrc` key, no `faff prdr new` / validate code change, no change to the resolution order or the `finished` methodology-default. If review finds the chosen home in fact needs a parse/validate change to fire, **flag back** — not licence to build silently.

build-tier: mechanical
spec-review: approve

confidence: high

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"assumes"}]}
```

## Methodology critique

*(agile-delivery lens)*

- **Right-sized?** Yes — a single doc-only PR (one guide subsection + one in-line skill-prose extension); build-tier `mechanical`. Not splittable, no merge candidate.
- **Workstream fit?** A loose-end closing FAFF-40's "MVP-vs-finished" work; a gateway/docs chore, no project home needed.
- **Deps surfaced?** None load-bearing — builds on shipped FAFF-245/251; the `**Assumes:**` covers the one environmental dependency (editable container description; git-only inert).
- **Risk profile?** Minimal — doc-only, no code path touched, regression-free (verified: no code assembles `target`). No de-risking spike warranted.

---
🤖 faff-prep · interactive fresh-spec · spec-review `approve` (single-pass, 4 lenses) · confidence high · build-tier mechanical
