# Spec: FAFF-1083 — Implement the reserved tier-1 native-template slot (jot/plot fill from the tracker)

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1083.

This is the build contract for FAFF-1083. Audience: the build agent that will implement the change, and the human reviewers who gate it. It consumes FAFF-1081's shipped writer (`.faff-templates/native-templates.yaml`) and populates the tier-1 native-template slot that `plugin/skills/faff/references/create.md` has reserved but never filled.

## 1. WHY — Problem and Principles

**Load-bearing model.** faff's create-time "fill step" resolves a per-type description template through a **first-match-wins, three-tier order** (`create.md:31-37`): tier 1 is a reserved *tracker-native* template slot, tier 2 is a committed `.faff-templates/<type>.md` override file, tier 3 is the built-in field set. Tier 1 has always been a documented no-op ("not implemented in the write-half, always misses today", `create.md:33`), so today every create falls through to tier 2 or tier 3. This ticket makes tier 1 real: at create time, resolve the tracker's own template for the determined faff-type and fill from it, keeping the tracker as source of truth. The tier is a *seam already cut*; this fills it without reworking the resolution path.

**Problem statement.** A repo whose tracker defines its own issue templates never gets them, because jot (step 4) and plot (step 5) always skip tier 1 and reach for faff's built-in field set instead. FAFF-1081 shipped the *writer* half (a committed faff-type to `{id, name}` identity map) but no *reader* and no consume path. This change adds the read path and populates tier 1 so a mapped type fills from the tracker template.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

- **Seed, never constrain.** A tracker template is a *default the producer fills*, never a form that *gates*. An unfilled field stays placeholdered (`_To be determined during prep._`); creation is **never** blocked, warned-to-block, or rejected for an under-filled template (`create.md:9`). This invariant is orthogonal to the acceptance criteria and must survive them.
- **Read at create, never copy at onboard.** The body is re-fetched from the tracker on every create via the stored id. FAFF-1081 deliberately persisted **identity only** (`{id, name}`, no body) precisely so the map cannot go stale against a maintained template set. Copying template fields at onboard time would reintroduce the staleness FAFF-1081 designed out.
- **First-match-wins is preserved, not reordered.** Tier 1 is consulted first; a tier-1 *miss* (no mapping, or a stale/opaque template) falls through to the existing tier 2 then tier 3 exactly as today. Tier 1 can only *add* resolutions, never remove or reorder existing ones.
- **YAML parsing has one home.** The map is read through the same `parseYamlSubset`/`dig` reader FAFF-1081's writer round-trip-verifies against, invoked behind a pure CLI verb, never re-implemented as skill prose.
- **The tracker read is lane-bound.** Tier 2/3 resolution is pure file/built-in work. Tier 1 needs a live `get_template` MCP call, which only the create-skill's orchestrator lane can make; the pure `faff` CLI cannot and must not.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/references/create.md` | Markdown prose | The single-sourced fill step + tier order; tier 1 is populated here |
| `plugin/skills/faff/bin/lib/native-map.js` (FAFF-1081, at `a433a1e3`) | JavaScript | Home of the `set` writer; gains the `get` reader verb |
| `plugin/skills/faff/bin/lib/shared-infra.js` | JavaScript | `parseYamlSubset(text)`, `dig(tree, "a.b.c")`, `findRoot()` the reader uses |
| `plugin/skills/faff/bin/lib/cli-surface.js` (FAFF-1081) | JavaScript | Declares `native-map`'s dispatch surface; the new subcommand must stay in bijection |
| `plugin/skills/faff/bin/faff` | JavaScript | `COMMANDS` already wires `"native-map": cmdNativeMap` |
| `plugin/skills/faff-jot/SKILL.md` (§4) / `faff-plot/SKILL.md` (§5) | Markdown prose | Delegate the fill step to create.md; inherit tier 1 with minimal change |
| `mcp__linear__get_template(id)` | Linear MCP | The create-time body fetch (skill lane only) |
| `test/native-map.test.mjs` (FAFF-1081) | Node test | Real-CLI black-box harness the reader tests extend |

**Scope statement.** This is the CONSUME half of the native-template feature (idea G): FAFF-1081 wrote the map, FAFF-1083 reads it and wires it into tier 1 of the create-time fill step.

## 2. OUT OF SCOPE

- **Replacing faff's six-type taxonomy with the tracker's vocabulary.** — faff's closed set (`bug/feature/spike/chore/epic/default`) stays the create-time taxonomy; the tracker template is fetched *for* a determined faff-type, never allowed to redefine the type set. *Extension point:* a future taxonomy-mapping ticket, not this path.
- **Writing back to the tracker.** — the feature is read-only; `get_template` is a read. *Extension point:* none planned; a write-back would be a separate initiative.
- **FAFF-1082 (rule discovery).** — independent workstream; not consumed here. *Extension point:* its own ticket.
- **Persisting type as a `faff-type-<type>` control label** (named in `create.md:62`). — a later ticket via Control-label provisioning. *Extension point:* `create.md`'s Out-of-scope seam.
- **A configurable `tracking.templates_path` key** (`create.md:62`). — the map path is fixed at `.faff-templates/native-templates.yaml` by FAFF-1081. *Extension point:* a config-CLI-allowlist follow-up.
- **FAFF-1088 (quote-prefixed values in the writer).** — a follow-up flagged by FAFF-1081's own review, in the *writer*, not this reader. *Extension point:* its own ticket.
- **Changing tier 2 / tier 3 behaviour.** — the override-file and built-in field-set tiers are untouched; tier 1 only prepends a resolution attempt. *Extension point:* n/a.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Native-template map | The committed `.faff-templates/native-templates.yaml` written by `faff native-map set`: `{ tracker, team_key, mappings: { <faff-type>: { id, name } } }` |
| Tier-1 hit | The map has an entry for the determined faff-type AND `get_template(id)` returns a usable body |
| Tier-1 miss | No map, no entry for the type, a stale id (template renamed/deleted), or an opaque body with no parseable fields; falls through to tier 2/3 |
| Stale mapping | A map entry whose stored `id` no longer resolves to a live tracker template (SC 3) |
| Opaque body | `get_template` content that yields no `## <Field>` level-2 headings (form template, plain prose, unexpected shape); treated as a miss |
| Field sequence | The ordered list of `## <Field>` level-2 headings the fill step emits as the description skeleton |

**The reader verb (pure CLI, new).**

```
faff native-map get [--type <faff-type>] [--json] [--root DIR]
```

- Pure, offline: reads `.faff-templates/native-templates.yaml` via `parseYamlSubset`/`dig`. **NO MCP, no network, no git.** Mirrors the writer's home and CLI-purity discipline in `native-map.js`.
- **Never errors on absence.** A missing map, an unreadable/malformed map, or a type with no entry is a clean "no mapping" signal at **exit 0**, never a failure. Only a malformed *argument* (a `--type` value outside the closed taxonomy) is a `usageError` (exit 2), mirroring the writer's unknown-type refusal.

```
INTERFACE native-map get:
  # --type <t> present, entry exists (tier-1 candidate):
  #   --json  -> { "type": "<t>", "id": "<id>", "name": "<name>" }        exit 0
  # --type <t> present, no entry:
  #   --json  -> { "type": "<t>", "mapping": null }                        exit 0
  # --type omitted (whole map):
  #   --json  -> { "tracker": "<t>", "team_key": "<k>", "mappings": {...} } exit 0
  # no map file / unreadable / malformed:
  #   --json  -> { "mappings": {} }   (or { "type":"<t>", "mapping": null } with --type)  exit 0
  # --type not in {bug,feature,spike,chore,epic,default}:
  #   usageError -> exit 2
  # non-json: a short human line carrying the same facts (tab-separated id/name, or "no mapping")
```

**The `get_template` response shape (external, unverified here).**

The Linear MCP `get_template(id)` returns "the content it pre-fills, the ids it applies, its sub-issues, and its form fields", and notes that a *form* template "collects its answers through a form, so applying one here creates an issue with the form unanswered." The exact JSON field name holding the pre-fill markdown is **not** visible from the schema, and this workspace currently has **zero issue templates**, so no live response could be inspected while writing this spec.

**Assumes:** `get_template(id)` returns pre-fill content that is markdown whose `## <Field>` level-2 headings are the template's field structure. *Validation (build agent, before relying on it):* call `list_templates(type: "issue")` then `get_template(id)` against a tracker that actually defines an issue template, inspect the response, and confirm which field carries the markdown body and whether it uses `## <Field>` headings. If the shape differs, the degrade path below (opaque body to fall-through) keeps creation correct while the parse is adapted; SC 2 cannot be met until the real field is parsed.

**Tier-1 resolution (updated `create.md` order).**

```
Template resolution order (first match wins, per type):
  1. Native-template slot — NOW IMPLEMENTED:
       a. faff native-map get --type <type> --json
       b. if mapping present -> get_template(id)  (create-skill MCP lane)
       c. parse the pre-fill body's `## <Field>` sequence (the tier-2 heading parse)
       d. hit -> that field sequence; miss (no mapping / stale / opaque) -> fall through
  2. Committed override file .faff-templates/<type>.md  (unchanged)
  3. Built-in default field set                          (unchanged)
```

**Design decisions** (each concluded with a marker; collected in §6):

- **Reader locus.** A pure `faff native-map get` verb versus an in-skill file read. **Chosen:** the CLI verb, in `native-map.js`, so YAML parsing stays in one tested home and the reader is black-box testable. (decides: architecture)
- **Fill-algorithm home.** **Chosen:** populate tier 1 inside `create.md`, the single-sourced fill step jot and plot already delegate to; jot/plot get no new resolution logic.
- **Field extraction.** **Chosen:** reuse the existing tier-2 `## <Field>` heading-sequence parse for the tracker body, so tiers 1 and 2 read a template uniformly.
- **`get_template` response shape.** **Assumes:** markdown with `## <Field>` headings, validated live; opaque bodies degrade to a miss.
- **Stale/miss handling.** **Chosen:** fall through to tier 2/3 AND report the stale mapping naming type + id + name (SC 3), extending the `create.md:56` "log the skipped override" convention to tier 1.

## 4. HOW — Behavior

**Architecture and approach.** Two changes, one seam. (1) `native-map.js` gains a `get` subcommand: a pure decoder over the same file the `set` writer produces. (2) `create.md`'s tier-1 slot is populated with an algorithm that calls the reader, then calls `get_template` in the create-skill's MCP lane, then reuses the tier-2 field parse, then falls through on any miss. jot §4 and plot §5 already point at `create.md`; they inherit tier 1 with, at most, a one-line note that the fill step may now perform a create-time tracker read.

**Reader verb (pure, CLI lane).**

```
PROCEDURE native_map_get(type?, json, root):
  path := join(root, ".faff-templates/native-templates.yaml")
  IF NOT exists(path):
     RETURN emit_absent(type, json)                      # exit 0
  TRY tree := parseYamlSubset(read(path))
  CATCH or tree not a map:
     RETURN emit_absent(type, json)                      # never throw; exit 0
  IF type is given:
     IF type NOT IN FAFF_TYPES: RETURN usageError(...)   # exit 2
     id   := dig(tree, "mappings." + type + ".id")
     name := dig(tree, "mappings." + type + ".name")
     IF id == null OR name == null:
        emit { type, mapping: null }; RETURN 0
     emit { type, id, name }; RETURN 0
  ELSE:
     emit { tracker: dig(tree,"tracker"),
            team_key: dig(tree,"team_key"),
            mappings: tree.mappings OR {} }
     RETURN 0
```

Wiring (all in `native-map.js` + `cli-surface.js`, no change to `bin/faff`'s `COMMANDS`, which already routes `native-map`):

- Add `"--type": { arity: 1 }` to `NATIVE_MAP_SPEC.flags`.
- Add `get: { required_flags: [] }` to `NATIVE_MAP_SURFACE.subcommands` (positionals already allow `max: 1`).
- Dispatch `verb === "get"` in `cmdNativeMap` to `cmdNativeMapGet`; unknown verbs still exit 2.
- Export the new helpers; `cli-surface.js` picks the surface up through the existing `NATIVE_MAP_SURFACE` import, so its bijection + required-flag self-test stays green (no pin references `native-map`).

**Tier-1 fill algorithm (create.md prose, executed in the create-skill's MCP lane).**

Behaviour summary: for the determined type, ask the map for an id, fetch that template's body live, extract its field sequence, and fill per the existing per-field algorithm; any miss falls through unchanged.

```
PROCEDURE resolve_native_template(type):        # returns FieldSequence | MISS
  m := run `faff native-map get --type <type> --json`
  IF m.mapping == null: RETURN MISS                          # no tier-1 entry -> tier 2
  tmpl := get_template(id = m.id)                            # orchestrator-lane MCP read
  IF tmpl is empty / not found:                              # renamed or deleted
     REPORT stale(type, m.id, m.name)                        # SC 3
     RETURN MISS
  fields := extract_field_headings(tmpl.prefill_body)        # the tier-2 `## <Field>` parse
  IF fields is empty:                                        # opaque body / form / unexpected shape
     REPORT opaque(type, m.id)
     RETURN MISS
  RETURN fields
```

```
PROCEDURE resolve_template(type):               # first-match-wins, unchanged shape
  fields := resolve_native_template(type)                    # TIER 1 (new)
  IF fields != MISS: RETURN fields
  IF exists(.faff-templates/<type>.md): RETURN tier2_headings(type)   # TIER 2
  RETURN builtin_field_set(type)                             # TIER 3
```

The returned field sequence then runs through the **unchanged** per-field fill (`create.md:47-52`): each `## <Field>` gets best-available content from the proposed ticket + brief, or the `_To be determined during prep._` placeholder, then routes through the `rendering_adaptor`.

**Edge cases and error handling.**

- **No map file** (fresh repo, onboard never ran the writer): reader returns "no mapping"; tier 1 misses; behaviour identical to today.
- **Map present, no entry for this type**: tier 1 misses for that type; other mapped types still hit.
- **Stale id** (template renamed or deleted since onboard): `get_template` returns empty; report + fall through (SC 3). Creation succeeds.
- **Opaque body** (form template with unanswered fields, plain-prose pre-fill, or a shape without `## <Field>` headings): no fields extracted; report + fall through. This is the safe landing for the `get_template`-shape Assumes.
- **Malformed / unreadable map file**: reader treats as absent (never throws), exit 0; tier 1 misses. Mirrors `create.md:56` (tier-2 unreadable to fall-through) and the writer's never-throw posture.
- **plot container nodes** (initiative/project) resolve to the `epic` template *type* first (`create.md:58`), then run the same tier-1 lookup for `epic`.
- **Git-only mode**: the map file is still read the same way; `get_template` needs a tracker, so with no tracker connector tier 1 always misses and the fill runs identically to today.
- **Error categories**: reader arg error is terminal (exit 2); every absence/miss is a non-error fall-through. No tier-1 condition is retryable, and none blocks creation.

**Failure modes — how the approach falls over, and how you would notice.**

- **The failure:** `get_template`'s pre-fill content is not `## <Field>` markdown (the Assumes is wrong), so a *mapped* type silently never produces the tracker structure. **How you would know:** SC 2's behavioural check fails against a live template while creation still succeeds via tier 2/3; the opaque-body report fires for a type the operator expected to hit. **What it means:** narrow, do not abandon: adapt `extract_field_headings` to the real field once the live shape is known; the degrade path already keeps creation correct meanwhile.
- **The failure:** the create-time `get_template` read adds a tracker round-trip and a lane dependency the pure fill step never had, so a slow/absent MCP could stall create. **How you would know:** create latency rises only when a mapping exists; a git-only or MCP-down run still creates via fall-through. **What it means:** proceed: the read is gated behind a present mapping and the miss path is fast and non-blocking; treat an MCP timeout as a miss, never a create failure.

**Anti-patterns.**

- **Anti-pattern:** parsing `.faff-templates/native-templates.yaml` inline in jot/plot prose. Why: it spreads YAML handling out of its one tested home and diverges from the writer's reader; use `faff native-map get`.
- **Anti-pattern:** calling `get_template` from the pure `faff` CLI. Why: the CLI is MCP-free by invariant; the MCP read belongs to the create-skill's orchestrator lane, and the CLI only returns the id.
- **Anti-pattern:** copying the fetched template body into the map or the ticket store at onboard time. Why: FAFF-1081 stores identity only so the tracker stays source of truth; re-fetch per create.
- **Anti-pattern:** blocking or warning-to-block a create because a tracker-template field is unfilled. Why: seed-never-constrain; placeholder the field.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a confirmed native-template mapping for faff-type `feature` (a live tracker template)
When jot creates a ticket determined to be `feature`
Then the created ticket's description follows the tracker template's `## <Field>` structure,
     not faff's built-in Why/What/Acceptance/Open-questions field set        # SC 2
```

```
Given a mapping for `feature` whose stored template id has since been renamed or deleted
When jot creates a `feature` ticket
Then creation succeeds by falling through to tier 2 then tier 3,
 And the run reports the stale mapping naming the type, the stored id, and the stored name   # SC 3
```

```
Given a repo with a native-template map that has an entry for `bug`
When `faff native-map get --type bug --json` runs
Then it prints { "type": "bug", "id": "<id>", "name": "<name>" } and exits 0     # reader hit, unit-testable
```

```
Given a repo with NO .faff-templates/native-templates.yaml
When `faff native-map get --type bug --json` runs
Then it prints { "type": "bug", "mapping": null } and exits 0, never an error    # reader absent, unit-testable
```

```
Given a mapping whose `get_template` body carries no `## <Field>` level-2 headings (an opaque/form template)
When the fill step resolves that type
Then tier 1 misses, the fill falls through to tier 2/3, and creation is not blocked   # opaque degrade
```

- **Assertion (non-functional):** `faff native-map get` performs no MCP, network, or git access (pure, offline) — same purity constraint as `native-map set`.
- **Assertion (non-functional):** no tier-1 condition (miss, stale, opaque, malformed map) blocks, warns-to-block, or errors a create; an unfilled field stays placeholdered.

Note on verification split: the reader-verb scenarios are **unit-testable** via the real-CLI black-box harness (`test/native-map.test.mjs`). SC 2 and SC 3 exercise the create-time MCP fill, which needs a **live tracker with a defined template** and is verified by prose/behavioural inspection, not a code-level test (there is no test precedent for the create-time skill fill, which is prose + MCP).

## 6. Design Decision Rationale

**Where does the map reader live?**
- *In-skill file read* — no new verb, but spreads YAML parsing into prose, diverges from the writer's reader, and is not black-box testable.
- *A pure `faff native-map get` verb* — mirrors the writer's home; one tested parse path; testable against the real CLI.
- **Chosen:** the CLI verb. Rationale: single YAML home + testability; the skill calls it for the id, then calls MCP itself. (decides: architecture)

**Where does the tier-1 fill algorithm live?**
- *In jot and plot separately* — duplication, drift risk; contradicts the single-sourced fill step.
- *In `create.md`* — the one place jot §4 and plot §5 already delegate to.
- **Chosen:** `create.md`. jot/plot need at most a one-line note that the fill step may now do a create-time tracker read.

**How is the tracker template's field list extracted?**
- *A new native-template parser* — redundant with the tier-2 reader.
- *Reuse the tier-2 `## <Field>` heading-sequence parse* — uniform handling of tier-1 and tier-2 bodies.
- **Chosen:** reuse the tier-2 parse.

**What is `get_template`'s response shape?**
- Unknown at authoring time; this workspace has no issue templates to inspect (`list_templates(type:"issue")` returned empty).
- **Assumes:** markdown with `## <Field>` headings; validate live before relying on it; opaque bodies degrade to a miss so creation stays correct while the parse is adapted. Temporal anchor: at the time of writing, no live template response was observable in this workspace.

**How are stale/missing mappings handled?**
- *Hard-fail the create* — violates seed-never-constrain and SC 3.
- *Silent fall-through* — loses the stale signal SC 3 requires.
- **Chosen:** fall through to tier 2/3 AND report the stale mapping naming type + id + name, extending `create.md:56`'s "log the skipped override" to tier 1 (a new convention: nothing currently names a stale tier-1 id). Report via the `.faff/` run log plus, interactively, a human-facing note; not a tracker comment (avoids noise; the gateway forbids duplicating legible state).

## 7. Open Questions and Assumptions

**Open Questions.** None blocking. Every design point above resolved to a `**Chosen:**` or a validated `**Assumes:**`.

**Assumptions.**

- **Assumes:** `get_template(id)` returns pre-fill markdown whose `## <Field>` level-2 headings are the field structure. *Validate:* against a tracker with a defined issue template, run `list_templates(type:"issue")` then `get_template(id)`, and confirm the body field and heading form before wiring `extract_field_headings`. Until validated, tier 1 is safe (opaque to fall-through) but SC 2 is not yet met.
- **Assumes:** `.faff-templates/native-templates.yaml` conforms to FAFF-1081's shape (`tracker`, `team_key`, `mappings.<type>.{id,name}`) and reads back through `parseYamlSubset`/`dig`. *Validate:* the writer's round-trip self-verify guarantees this on write; the reader depends on nothing beyond it.
- **Assumes:** the create-skill runs in the orchestrator lane with Linear MCP access at create time (jot/plot already call `save_issue`/`list_issues`). *Validate:* confirmed by jot §4 / plot §5 direct-MCP-call pattern.

## 8. DONE — Definition of Done

### From WHY
- [ ] A mapped type fills from the tracker template at create time; unmapped types are byte-unchanged from today (tier 2/3).
- [ ] Seed-never-constrain holds: no tier-1 condition blocks/warns/errors a create; unfilled fields keep `_To be determined during prep._`.
- [ ] The body is re-fetched via the stored id on each create; nothing copies the body into the map or ticket store at onboard.

### From WHAT (reader verb + interfaces)
- [ ] `faff native-map get --type <t> --json` prints `{type,id,name}` for a mapped type, exit 0.
- [ ] `faff native-map get --type <t> --json` prints `{type, mapping:null}` for an unmapped type, exit 0.
- [ ] `faff native-map get --json` (no `--type`) prints `{tracker, team_key, mappings}`, exit 0.
- [ ] Missing/unreadable/malformed map yields `{mappings:{}}` (or `{type, mapping:null}`) at exit 0, never a throw or non-zero exit.
- [ ] `--type` outside `{bug,feature,spike,chore,epic,default}` is a `usageError`, exit 2.
- [ ] `--type` added to `NATIVE_MAP_SPEC.flags`; `get` added to `NATIVE_MAP_SURFACE.subcommands` with empty `required_flags`; `cli-surface --selftest` stays green (bijection + required-flag checks).
- [ ] Reader performs no MCP/network/git (pure), asserted like `set`.

### From WHAT (create.md tier order)
- [ ] `create.md` tier 1 is documented as implemented (no longer "always misses today"), preserving first-match-wins into tier 2 then tier 3.

### From HOW (behaviour)
- [ ] The fill step calls `faff native-map get`, then `get_template(id)` in the create-skill's MCP lane, then the tier-2 `## <Field>` parse; jot/plot carry no duplicated resolution logic.
- [ ] A tier-1 hit produces a description whose field structure is the tracker template's, not the built-in set (SC 2).
- [ ] A stale id (renamed/deleted) falls through to tier 2/3 and reports the stale mapping naming type + id + name (SC 3).
- [ ] An opaque body (no `## <Field>` headings, e.g. a form template) falls through and does not block creation.

### From HOW (edge cases)
- [ ] Git-only / MCP-absent mode: tier 1 misses, fill runs identically to today.
- [ ] plot container nodes resolve to the `epic` template type, then run the `epic` tier-1 lookup.
- [ ] An MCP timeout on `get_template` is treated as a miss, never a create failure.

**Eval coverage.** No new LLM-judgement seam is introduced (the fill step is deterministic parse + resolution; the create-skill's existing judgement seams are unchanged). No grader registration required.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. In a temp repo, write .faff-templates/native-templates.yaml via `faff native-map set`
     with mappings = { feature: { id: T, name: "Feature Tmpl" } }.
  2. `faff native-map get --type feature --json` -> { type:"feature", id:T, name:"Feature Tmpl" }, exit 0.
  3. `faff native-map get --type bug --json`     -> { type:"bug", mapping:null }, exit 0.
  4. Remove the file; `faff native-map get --type feature --json` -> { type:"feature", mapping:null }, exit 0.
  # (Steps 1-4 are the connected-plumbing check for the reader half; SC 2/SC 3's create-time
  #  fill is inspected against a live tracker template, per the verification-split note in §5.)
```

confidence: medium
build-tier: complex
spec-review: approve

## Review notes (non-gating, spec-review round 1)

All four lenses (architectural / infosec / methodology / QA) cleared with observations only:

- **`--type` surface bleed (architectural, minor).** Adding `--type` to `NATIVE_MAP_SPEC.flags` makes it accepted-but-ignored on the existing `set` subcommand. Scope it to `get` (or document the no-op on `set`) so the CLI surface stays honest.
- **Verification-split completeness (QA, minor).** The §5 note lists SC 2 / SC 3 as inspection-only but omits the equally fixture-dependent opaque-degrade scenario. Include it in that list for completeness.
- **Untrusted `get_template` body (infosec, observation).** The body enters the orchestrator lane, but only its `## <Field>` heading sequence is extracted and the result is rendered-not-executed markdown, covered by the kernel's universal no-execute floor ([[security-floors-are-universal-kernel-residents-never-lane-scoped]]). No action beyond keeping the extract heading-only.

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

- **Right-sizing: don't split.** The reader verb alone is plumbing with no observable behaviour; the coherent vertical slice is "a mapped type fills from the tracker," which needs both the reader and the create-time wiring. Splitting the CI-verifiable reader from the create-time fill would ship a half with no user-visible effect. One coherent unit.
- **Workstream fit:** Cohesive with the native-template line — FAFF-14 reserved the tier-1 slot, FAFF-1081 wrote the map, this consumes it. Outcome-named.
- **Deps surfaced:** Blocked-by FAFF-1081 (Done) — satisfied. No inbound blocker remains.
- **Risk profile:** Medium — the single novel risk is the external `get_template` response shape, unverifiable in this workspace (zero issue templates). De-risked structurally by the opaque-body degrade (creation never breaks) plus the named build-agent live-validation step; no separate de-risking spike warranted (the methodology lens agreed). This is what caps confidence at medium and routes the ticket `needs-decision-first` rather than auto-build.
