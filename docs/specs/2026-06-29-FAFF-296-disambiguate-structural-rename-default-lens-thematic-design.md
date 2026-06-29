# faff-prep spec — FAFF-296

**Producer:** `faffter-dark-nlspec` · **confidence:** high · **spec-review:** revise→approve (QA/architectural lens caught 3 missed reference classes; folded in)

# Disambiguate "structural": rename default lens → `thematic`, reserve "structural" for tracker topology (+ relocate the graph floor)

## WHY

"Structural" is overloaded: it names both the **default methodology lens** (`faffter-noon-methodology-structural`) and the word the FAFF-291 cluster uses for the **tracker's dependency topology** (the graph / blocker edges / where work sits — the methodology-agnostic layer orchestration reads). The collision makes cluster statements ("thematic is structural's territory") ambiguous. The decision is **settled** (issue, 2026-06-29): a clean three-way split — **structural** = tracker topology/ground truth (incl. the shared graph floor); **thematic** = the renamed opinion-free default lens; **agile** = the outcome-led lens. "topological" was considered and **rejected** (near-synonym → re-creates the overload).

## WHAT

Three coordinated changes across faff's own skills:

1. **Vocabulary** — one documented meaning for **"structural" = tracker topology** across gateway + skills.
2. **Rename** the default lens `faffter-noon-methodology-structural` → `faffter-noon-methodology-thematic` (dir + name + slot default + slot table + every cross-skill reference + the eval/config reference classes).
3. **Relocate** the cycle + ghost-project graph-floor detection **out of** the lens **into** the shared structural/topology layer; both `thematic` and `agile` compose it from there (no behavioural regression).

## HOW

### Surface (explored — concrete)

There is **no CLI cycle/ghost seam** today: cycle + ghost-project detection lives prose-side in the lens's `backlog-diagnostics`. So this is a prose/contract refactor, not a code-logic rewrite. A full-repo `git grep` enumerates **all** reference classes — including three the prose-skill grep alone misses (config example + two eval registries).

**A. Rename `faffter-noon-methodology-structural` → `faffter-noon-methodology-thematic`**

- **Skill package** — `git mv` the dir; update SKILL.md frontmatter `name:`, `description:`, the `# heading`, the in-body `slots: methodology:` example yaml, and all self-references.
- **Gateway `plugin/skills/faff/SKILL.md`** — slot table default row; `Unset → ...`; "The default is ..."; swap-floor clause. Add/confirm the single canonical sentence defining **"structural" = tracker topology**.
- **CLI `plugin/skills/faff/bin/faff`** — default-config map `"slots.methodology"`; the slot-skill registry entry.
- **Cross-skill SKILL.md refs** — `faff-tidy`, `faff-jot`, `faff-wtf`, `faff-plot`, `faff-beep-boop`, `faff-map`.
- **Agile lens `faffter-dark-methodology-agile-delivery/SKILL.md`** — refs → new name; "composes the structural floor" prose → "composes the **structural/topology** floor".
- **Guide `docs/guide/skills.md`** — the methodology table row.
- **`.faffrc.example.yaml`** — the `methodology:` slot default doc-comment.
- **`eval/seam-registry.json`** — the `ordering` judgement-seam `surface` value.
- **`eval/baselines/prompt-size.json`** — the baseline entry `path` (regenerate the size via the baseline regen).

**B. Relocate the graph floor**

- Move the **cycle** + **ghost-project** detection (the two that feed the `circular-blocked` / `gap-blocked` routing verdicts) **from** the lens's `backlog-diagnostics` **into** the shared structural/topology layer — canonically homed gateway-side as the methodology-agnostic topology floor that orchestration reads.
- `thematic` and `agile` **both compose** it from there (thematic no longer *owns* it — it composes like agile already does; the agile swap-floor clause updates to point at the shared layer, not the lens).
- The lens-specific, non-topology categories (repeat-park, splittable-spec, chain-gap, orphaned) stay where they are. Detection semantics, mechanical fixes, conservatism, and rendered form are **unchanged** — pure relocation, identical behaviour.

### Guards
- `faff validate-adapters` green (the renamed skill still conforms to the methodology contract; refer-back prose intact).
- `faff lint-refs` green — introduce **no** external FAFF-NN/ADR refs into SKILL.md or `docs/guide/` prose. State the vocabulary forward.
- Eval guards: re-run the prompt-size baseline + seam-registry checks so the renamed key/path is consistent.
- Historical `docs/specs/*`, `docs/adr/*`, `docs/audits/*` mentions of the old name are **provenance — out of scope**.

## DONE

1. **One documented meaning** for "structural" (= topology) across gateway + skills; no executed surface still uses "structural" for the *lens*.
2. **Rename complete** — `git grep faffter-noon-methodology-structural -- ':!docs/specs' ':!docs/adr' ':!docs/audits'` returns **zero** hits; dir, frontmatter `name`, gateway slot default + slot table, CLI default-config + registry, all six cross-skill refs, `.faffrc.example.yaml`, `eval/seam-registry.json`, and `eval/baselines/prompt-size.json` all use `faffter-noon-methodology-thematic`.
3. **Graph-floor relocated** — cycle + ghost-project detection lives in the shared structural/topology layer; `thematic` and `agile` both compose it from there; the agile swap-floor clause points at the shared layer.
4. **No behavioural regression** — cycle + ghost-project detection (and the `circular-blocked` / `gap-blocked` routing verdicts they feed) behave identically; detection categories, mechanical fixes, and rendered form unchanged.
5. **`faff validate-adapters` green**, **`faff lint-refs` green**, prompt-size baseline + seam-registry consistent; node `--test` / CLI selftests pass.

## Confidence: high
