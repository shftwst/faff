**Revised 2026-09-22 - revise round 2: register format in ADR_SURFACE; explicit adrTemplate/adrLiveDecisions signatures; independent golden fixture; born-verifiable body-DoD split; smoke-test --title fix; bare-output line.**

# Spec: adr slot honours a repo-specific ADR template, defaults to Nygard (FAFF-1085)

> Spec: faffter-dark-nlspec · 2026-09-22 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1085.

> Re-spec 2026-09-22 - file-presence activation model, matching the `.faff-templates/<type>.md` precedent; supersedes the convention-key framing. The `adr_format` convention key and its ADR-0129 four-tier resolver dependency are dropped; ADR shape now activates on the presence of a committed, parseable `.faff-templates/adr.md`, exactly as the ticket-template surface activates.

> Revised 2026-09-22 (revise round 1) - per-section placeholders so a Nygard scaffold is byte-identical by construction (`ResolvedAdrFormat.sections` now carries `{name, placeholder}`, `nygard_default()` supplies `adrTemplate()`'s three verbatim strings); and a present-but-unreadable template now degrades and logs exactly like empty/heading-less, split from the silent absent-file path.

> Revised 2026-09-22 (revise round 2) - register `format` in `ADR_SURFACE.subcommands` (cli-surface / drift-guard); make the `adrTemplate(fields, resolved_format=nygard_default())` and `adrLiveDecisions(dir, excludeId, root)` signature changes explicit; pin the golden fixture as an independent pre-change baseline (never regenerated); split the LLM-body DoD into a born-verifiable CI check plus a holdout structural check; fix the smoke test to `faff adr new --title`; define the bare `faff adr format` output line.

This is the buildable spec for FAFF-1085. Audience: the build agent that implements it, and the human reviewers who gate it. It extends the existing `adr` slot so a repo can carry its own ADR shape by committing a template file, while a repo that commits nothing keeps today's Nygard output byte-identical.

## Already shipped against this surface

These Done tickets built the surface FAFF-1085 sits on. Each is related, none supersedes it, so the premise still holds and this work is net-new:

| Ticket | What it shipped | Why it is not this |
|---|---|---|
| FAFF-196 | The `adr` slot + `faffter-noon-adr` authoring the Nygard body | The foundation 1085 extends; it hardcodes one shape |
| FAFF-14 / FAFF-1081 / FAFF-1083 | The tracker/native issue-template precedent and the committed `.faff-templates/<type>.md` override surface (create.md) | Ticket-shape templates, not ADR-body templates; 1085 reuses their file-presence model |
| FAFF-768 | Config-resolved the ADR doc root (`tracking.adr_docs_path`) | Resolves where ADRs live, not their shape |

None delivered a repo-specific ADR template. FAFF-1085 is the first, and it reaches for the shipped `.faff-templates/` file surface rather than the naming-convention resolver.

## 1. WHY - Problem and Principles

**The load-bearing model.** ADR shape is a template (a document skeleton), resolved by file presence exactly like the ticket templates at `.faff-templates/<type>.md`. A committed, parseable `.faff-templates/adr.md` is the repo's ADR shape: its ordered level-2 headings are the section list. Absent resolves silently to the Nygard default (byte-identical, unlogged); a present-but-empty, heading-less, or unreadable file degrades to Nygard and logs the skip. Committing the file is the deliberate opt-in, the same rule create.md already documents for `.faff-templates/bug.md` and its siblings. A single read-only resolver (`faff adr format`) turns file-presence plus the file's headings into a concrete section list, and both writers (the `faff adr new` scaffold and the `faffter-noon-adr` body producer) author against that one resolved list instead of the three headings each has hardcoded today.

**Problem statement.** Today the `adr` slot always authors the Nygard shape (`## Context` / `## Decision` / `## Consequences`) and `faff adr new` always scaffolds it, so a repo with its own ADR template has faff's shape imposed on it. This change reads a repo-specific ADR template when one is committed and has both the scaffold and the body producer honour it, exactly as `/faff-jot` and `/faff-plot` already let a committed `.faff-templates/<type>.md` shape a created ticket. A repo that commits no template keeps Nygard, unchanged.

**Design principles:**

- **Nygard is the built-in default, and a silent repo is byte-identical.** A repo with no `.faff-templates/adr.md` resolves to `nygard` and produces exactly today's bytes. This is the regression floor: the self-hosting faff repo (its own `records/adr/` corpus is pure Nygard) must not shift by one character.
- **File presence is the activation, mirroring the ticket-template surface.** A repo opts into its ADR shape by committing `.faff-templates/adr.md`, not by naming a config key. This is the same opt-in the ticket-template resolution order in create.md already uses (`.faff-templates/<type>.md`, if present). There is no `adr_format` config key and no convention-resolver tier for ADR shape.
- **Resolution is CLI-only, never a hand-read (ADR-0128).** Both writers resolve the format through a faff CLI call (`faff adr format`), never by reading `.faff-templates/adr.md` themselves. There is one resolution code path; consumers call it. ADR-0128's rule ("resolve via the CLI, never hand-read the file") is preserved; only the thing the CLI reads changed, from a convention value to a template file.
- **The template carries the section list; nothing else does.** The section list lives in one place, the committed markdown file's level-2 headings, read with create.md's heading-extraction rule (headings define the ordered list, body text ignored). No config value, no cache entry, and no convention token carries a section list.

**Reference context:**

| System | Path | Relevance |
|---|---|---|
| `adr` body producer | `plugin/skills/faffter-noon-adr/SKILL.md` | The one prose site that hardcodes the three Nygard sections (Output section, ~L31-35); must author against the resolved list |
| `faff adr` CLI | `plugin/skills/faff/bin/lib/adr.js` | `adrTemplate()` (~L454) is the sole scaffold-heading site; `adrDecisionBody()` (~L537) hard-parses `## Decision` for the L3 seam; `adrLiveDecisions()` (~L546) threads it. This file is the landing site for the resolver and `faff adr format` |
| ticket-template surface | `plugin/skills/faff/references/create.md` | The committed `.faff-templates/<type>.md` file-presence model `.faff-templates/adr.md` mirrors verbatim: resolution-order (present file wins), heading-extraction rule, and empty/unreadable degrade-and-log |
| ADR-0128 | `records/adr/0128-repo-convention-discovery-as-a-deterministic-cli-contract.md` | Consumers resolve via CLI, never hand-read; preserved unchanged (the CLI now reads a template file, not a convention value) |

**Scope statement.** This adds a repo-specific ADR template (what shape an ADR has) resolved from the committed `.faff-templates/` file surface. It is a sibling of the shipped `.faff-templates/<type>.md` ticket templates, not an extension of the `conventions.js` naming-grammar resolver; ADR shape does not ride the four-tier convention resolver at all.

## 2. OUT OF SCOPE

- **History-inference of ADR shape.** Name: teaching faff to infer an ADR shape from existing `records/adr/*.md`. Why excluded: shape inference from prose headings is a distinct, lower-confidence classifier, and v1 does not need it to honour a committed template. Extension point: an `inferAdrFormat(root, ...)` classifier that `faff adr format` could consult below the file-presence tier.
- **faff-onboard active mining of an ADR template.** Name: onboard detecting an ADR shape and scaffolding `.faff-templates/adr.md` on a repo re-run. Why excluded: onboard mining on an already-configured repo is the per-field confirm-before-overwrite behaviour FAFF-1084 owns; scoping it out keeps FAFF-1085 independent of FAFF-1084. Extension point: `plugin/skills/faff-onboard/SKILL.md`, after FAFF-1084 lands, offering to scaffold `.faff-templates/adr.md`.
- **Shape-enforcing `faff adr validate`.** Name: making `faff adr validate` check the resolved section set. Why excluded: `adrValidate()` is section-agnostic today (it checks heading/fields/numbering/back-references, never the section set), so there is no hardcoded Nygard check to generalise, and adding one is new scope. Extension point: `adrValidate()` keyed off `faff adr format`'s resolved `sections` list.
- **A `tracking.templates_path` config key.** Name: making the `.faff-templates/` directory path configurable. Why excluded: create.md already documents this as its own follow-up seam; ADR templates reuse the fixed `.faff-templates/` location. Extension point: the `tracking.templates_path` key noted in create.md's out-of-scope seams.
- **Per-format L3 decision-section mapping config.** Name: a config map naming which heading a non-Nygard format uses as its decision-equivalent. Why excluded: v1 keys off a single rule (a `## Decision` heading, else degrade); a configurable mapping is only needed once a real repo has a differently-named decision section. Extension point: a `decision_section` override on the resolved format object, sourced from config rather than a fixed heading match.

## 3. WHAT - Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| ADR format | The ordered set of section headings an ADR body carries. `nygard` is Context / Decision / Consequences. |
| section list | The ordered sequence of sections a format defines. Each section carries a `## <Heading>` name AND the scaffold placeholder line emitted under it. For a template, the level-2 headings of `.faff-templates/adr.md` in order, each paired with a single generic placeholder; for Nygard, the three headings paired with `adrTemplate()`'s three verbatim per-section placeholders. |
| decision section | The heading whose body the L3 contradiction-detection seam reads (`## Decision` under Nygard). |
| resolved format | The concrete output of `faff adr format`: the token, its section list, its decision-section name (or none), the resolution source, and any degrade note. |

**No new convention key.** ADR shape does not become a fourth `conventions.js` key. `CONVENTIONS_KEYS` / `CONVENTIONS_DEFAULTS` / `CONVENTIONS_VOCAB` are untouched, and nothing calls `resolveConventionCore` or `faff conventions get` for ADR shape. The resolver reads the committed template file directly (via the single `faff adr format` code path), the same way create.md's fill step reads `.faff-templates/<type>.md`.

**The resolved-format object** (what `faff adr format` emits):

```
RECORD ResolvedAdrFormat:
  format: Enum{ "nygard", "template" }         # the resolved shape
  sections: List<{ name: String, placeholder: String }>   # ordered sections; each carries its heading name AND the scaffold placeholder line emitted under it
  decision_section: String | null               # heading the L3 seam reads; null => L3 disabled for this format
  source: Enum{ "template", "default" }          # "template" => a committed .faff-templates/adr.md was used; "default" => Nygard
  template_path: String | null                   # ".faff-templates/adr.md" when source=template, else null
  degraded: Bool                                 # true when a present-but-unusable template file forced the Nygard fallback
  notes: String | null                           # the one-line degrade/disablement message when degraded or decision_section is null; else null

  CONSTRAINT sections is non-empty
  CONSTRAINT format=="nygard" => the section names are exactly ["Context","Decision","Consequences"] in order, their placeholders are adrTemplate()'s three verbatim per-section strings (see nygard_default below), decision_section=="Decision", AND source=="default"
  CONSTRAINT decision_section, when non-null, is the name of a member of sections
  CONSTRAINT degraded==true => format=="nygard" AND source=="default" AND notes is non-null
```

The per-section `placeholder` is what makes byte-identical Nygard achievable by construction: `nygard_default()` supplies the three exact strings `adrTemplate()` emits today, and a `template` format supplies one generic placeholder per section (a repo template declares only headings, never author prose). The scaffold loop emits `## <name>` followed by that section's `placeholder`, so the Nygard path reproduces today's bytes line-for-line.

**New read-only CLI surface - `faff adr format [--json] [--root DIR]`.** Resolves the ADR format once and prints it, so both writers consume a single deterministic resolution rather than each re-deriving it (ADR-0128). Read-only: no file writes, no network. `--root DIR` pins the repo root (default: the resolved repo root); the template is read only from `<root>/.faff-templates/adr.md`. `--json` prints the `ResolvedAdrFormat` record; bare prints the one-line human summary defined below. Always exits 0 with a value (Nygard is the floor), mirroring `faff conventions get`.

`format` is a new `adr` subcommand and MUST be registered in `adr.js`'s declared-grammar object `ADR_SURFACE.subcommands` (alongside `new` / `list` / `validate` / `live-decisions` / …) as `format: { required_flags: [] }` (both `--json` and `--root` are optional). `ADR_SURFACE` is what `faff cli-surface --json` aggregates and the drift-guard asserts against, so a dispatchable verb absent from it under-reports the surface and trips the guard; registration is a required build step, not an afterthought.

**Bare (non-`--json`) output.** One line: `adr format: <token> (<source>; sections: <Name/Name/…>)` (for Nygard: `adr format: nygard (default; sections: Context/Decision/Consequences)`), with any degrade/disablement `notes` appended as a trailing `; note: <text>`. It is a human convenience; the machine-assertable contract is the `--json` record, and tests assert against `--json`, not the bare line.

**Committed template file - `.faff-templates/adr.md`.** A genuinely new candidate alongside the existing `bug` / `feature` / `spike` / `chore` / `epic` / `default` ticket templates. Same format contract as those (create.md, Override files): level-2 `## <Heading>` lines define the section list in order; body text under a heading is the repo's own author guidance and is ignored by faff (the scaffold emits the headings with TODO placeholders; the producer authors prose under each). Empty, heading-less, or unreadable file degrades to the Nygard default and logs the skip, exactly like the ticket-template surface's "treat as absent, fall through to the built-in default (never block), and log the skipped override".

**Design decision - activation model.** Options: (a) file presence, mirroring the ticket-template surface (`.faff-templates/adr.md` present and parseable => the repo's ADR shape); (b) an `adr_format` convention key on the four-tier resolver selecting the shape; (c) a `tracking.adr_format` scalar config key. Option (b) forces the section list out-of-band through a vocab-gated token, drags in the ADR-0129 documented/inferred tiers (a doc-scope matcher and an inference null-guard neither of which v1 needs), and diverges from how every other `.faff-templates/*` template activates. Option (c) is a second override surface for the same artifact. **Chosen:** file presence (option a). It reuses the shipped, documented `.faff-templates/<type>.md` model verbatim, keeps the section list in exactly one place (the file), and needs no convention resolver, no config key, and no cache. Committing the file is the opt-in.

## 4. HOW - Behaviour

**Architecture and approach.** One resolver, two writers, one L3 seam parameter. The resolver lives in `adr.js`: the CLI-side writer (`faff adr new` / `adrTemplate`) calls it in-process, and `faff adr format` is the thin command that exposes the same resolution to the skill-side producer, which shells out to it. There is one resolution function; the subprocess is only how the out-of-process consumer reaches it.

```
faff adr format  --resolves-->  ResolvedAdrFormat   (reads <root>/.faff-templates/adr.md)
        |                              |
        +-- faff adr new  ------------> scaffolds sections[] with TODO placeholders
        +-- faffter-noon-adr ---------> authors prose under sections[]
                                        |
adrDecisionBody(text, decision_section) <-- L3 seam reads the named heading (or degrades)
```

**Resolving the format - `faff adr format`:**

```
PROCEDURE resolve_adr_format(root):
  1. path := root + "/.faff-templates/adr.md"
  2. IF path is absent:                                # the clean silent default (regression floor)
     RETURN nygard_default()                          # source="default", degraded=false, notes=null
  3. IF path is present but unreadable (read error):   # present-but-unusable: treated exactly like empty/heading-less
     - msg := "faff adr format: .faff-templates/adr.md is empty or has no level-2 headings; using the Nygard default"
     - LOG msg to stderr
     - RETURN nygard_default() with degraded=true, notes=msg
  4. names := ordered level-2 (## ) heading names in the file   # create.md heading-extraction rule
  5. IF names is empty:                                # empty / heading-less
     - msg := "faff adr format: .faff-templates/adr.md is empty or has no level-2 headings; using the Nygard default"
     - LOG msg to stderr
     - RETURN nygard_default() with degraded=true, notes=msg
  6. sections := [ { name, placeholder: GENERIC_PLACEHOLDER } for name in names ]   # a template declares only headings; every section gets the one generic placeholder
  7. decision_section := "Decision" IF "Decision" in names ELSE null
  8. IF decision_section is null:
     - msg := "faff adr format: .faff-templates/adr.md has no `## Decision` heading; L3 contradiction-detection disabled for this repo"
     - LOG msg to stderr
     - notes := msg
     ELSE notes := null
  9. RETURN { format:"template", sections, decision_section,
              source:"template", template_path:".faff-templates/adr.md",
              degraded:false, notes }

WHERE nygard_default() = {
        format:"nygard",
        sections: [ { name:"Context",      placeholder:"_TODO: what forces this decision._" },
                    { name:"Decision",     placeholder:"_TODO: the decision, stated forward._" },
                    { name:"Consequences", placeholder:"_TODO: what this constrains downstream._" } ],  # verbatim from adr.js L460-462
        decision_section:"Decision", source:"default", template_path:null, degraded:false, notes:null }
  AND GENERIC_PLACEHOLDER = "_TODO: ..._"   # one generic placeholder per template section (the repo file declares only headings)
```

Absent is the only non-logged fall-through (the byte-identical floor); a present file that is empty, heading-less, OR unreadable all degrade to `nygard_default()` with `degraded:true`, the logged stderr line, and the same text in `notes`.

**Degrade log - sink and text (concrete, assertable).** The resolver writes every degrade/disablement line to **stderr**, prefixed `faff adr format:` (the house diagnostic convention already used across `adr.js` and `conventions.js`, e.g. `process.stderr.write("faff adr new: ...")`). The two exact one-line messages are:

- present-but-unusable template (empty / heading-less / unreadable): `faff adr format: .faff-templates/adr.md is empty or has no level-2 headings; using the Nygard default`
- template with headings but no `## Decision`: `faff adr format: .faff-templates/adr.md has no ` + "`## Decision`" + ` heading; L3 contradiction-detection disabled for this repo`

The **same text** is surfaced in the `--json` record's `notes` field (with `degraded:true` in the first case), so a test can assert the degrade from the machine-readable record without scraping stderr. This makes every "logged" claim in the DONE checklist pass/fail decidable.

**Behaviour summary - scaffold.** `faff adr new` asks `faff adr format` for the resolved sections, then writes each heading followed by that section's own `placeholder`, instead of the three literal Nygard strings hardcoded in `adrTemplate()` today. For a Nygard resolution the three placeholders are `adrTemplate()`'s exact per-section strings (`_TODO: what forces this decision._` / `_TODO: the decision, stated forward._` / `_TODO: what this constrains downstream._`), so the output is reproduced byte-for-byte; for a template each section carries the single generic `_TODO: ..._` line. The Status / Provenance / Date / Issue front matter is unchanged.

```
PROCEDURE adrTemplate(fields, resolved_format):
  1. emit `# ADR <num> — <title>`, blank, then the Status/Provenance/Date/[Issue]/[Initiative] lines   # unchanged front matter
  2. emit blank line                                          # the single blank before the first section
  3. FOR each { name, placeholder } IN resolved_format.sections:
     a. emit "## " + name
     b. emit blank line
     c. emit placeholder                                      # nygard: the section's verbatim _TODO string; template: the generic _TODO line
     d. emit blank line
  4. join with "\n" and return
  # Nygard resolved_format reproduces adr.js L457-462 line-for-line => byte-identical to today's output.
```

**Behaviour summary - body authoring.** `faffter-noon-adr` calls `faff adr format --json`, then authors prose under each heading in `sections` in order, and under no others, rather than emitting the three fixed Nygard sections. When the format is Nygard it authors Context / Decision / Consequences exactly as today. Its self-review and advisory `confidence:` are unchanged (the slot has no gated contract block).

**Behaviour summary - L3 contradiction detection.** `adrDecisionBody(text)` currently hard-matches `## Decision`. It gains a heading parameter so the L3 seam reads the resolved format's decision section:

```
PROCEDURE adrDecisionBody(text, decision_section = "Decision"):
  1. IF decision_section is null: RETURN ""            # format has no decision-equivalent => seam sees empty input
  2. match "## " + decision_section up to the next "## " (or EOF)   # existing regex, parameterised
  3. RETURN trimmed body, or "" when the heading is absent          # existing crash-safe path
```

`adrLiveDecisions(dir, excludeId)` gains a `root` parameter - `adrLiveDecisions(dir, excludeId, root)` - so it can call the resolver (`resolve_adr_format(root)`) once and thread the resolved `decision_section` into every `adrDecisionBody(text, decision_section)` call. Its `cmdAdr` `live-decisions` call site already has `root` in scope, so the signature change is mechanical. When `decision_section` is null, every candidate's decision body is empty, which the seam already tolerates (empty input, no crash) - L3 simply finds no contradictions.

**`adrTemplate` signature.** `adrTemplate(fields)` gains a second argument - `adrTemplate(fields, resolved_format = nygard_default())` - defaulting to `nygard_default()` so the existing in-repo callers and the `adrSelftest` cases that call `adrTemplate({...})` with no second argument stay byte-identical; the `faff adr new` dispatch branch passes the resolved format it obtained from `resolve_adr_format(root)`.

**Edge cases and fallback chain:**

- No `.faff-templates/adr.md` → resolver returns `nygard` at the `default` source → byte-identical scaffold and body.
- `.faff-templates/adr.md` present but empty, heading-less, or unreadable → degrade to Nygard, `degraded:true`, log the skip to stderr and surface it in `notes`, never block (mirrors create.md's override-degrade rule).
- `.faff-templates/adr.md` present with valid headings → `source:"template"`, those headings become the section list, in order. Committing the file is the activation (the ratified direction in section 7).
- Template file with headings but no `## Decision`-equivalent → `decision_section:null`, `notes` carries the disablement line → L3 degrades to disabled for that repo, logged and visible in `faff adr format --json` (the retained ratified decision in section 7).

**Failure modes:**

- **The failure:** the "byte-identical Nygard default" claim is wrong because the `adrTemplate` refactor changes whitespace or placeholder text. **How you'd know:** the golden-file test comparing a freshly scaffolded Nygard ADR against a committed fixture fails on a diff. **What it means:** fix before merge; the regression floor is the whole point of the ticket. Byte-identity is achievable by construction because `nygard_default()` carries `adrTemplate()`'s three verbatim per-section placeholders rather than a single uniform one, so the scaffold loop reproduces the exact per-section strings.
- **The failure:** a present-but-unusable template (empty, heading-less, OR unreadable) falls back to Nygard but the skip goes unlogged, so a mis-committed template silently produces the wrong shape's default with no trace. **How you'd know:** the resolver routes all three cases through the same degrade path - `degraded:true`, the fixed stderr line, and the same text in `--json` `notes` - so a test asserts the log from the record; absent is the only silent fall-through, and it is byte-identical by design. **What it means:** the degrade path must fire the log for every present-but-unusable file, never just empty/heading-less.
- **The failure:** L3 silently stops detecting contradictions in a repo whose template lacks a Decision-equivalent, and no one notices the safety seam degraded. **How you'd know:** `faff adr format --json` reports `decision_section:null` and `notes` naming the disablement; the resolver logged a one-line note to stderr. **What it means:** this is the ratified v1 behaviour (section 7) - degrade to disabled, observable via the log line and the `--json` fields, never silent; proceed.

**Anti-pattern:** having `faffter-noon-adr` or `faff adr new` read `.faff-templates/adr.md` directly to decide the shape. Why: it duplicates resolution and violates ADR-0128's CLI-only rule. Both writers reach the single resolver (the skill-side producer via the `faff adr format` subprocess, the CLI-side writer in-process).

**Anti-pattern:** reintroducing an `adr_format` convention key to carry the shape. Why: the section list is a document skeleton, not a naming grammar; it belongs in the `.faff-templates/` file surface (one home for the list), not on the vocab-gated convention resolver. Registering it there would drag in the ADR-0129 documented/inferred tiers this design deliberately drops.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with no .faff-templates/adr.md
When faff adr new scaffolds an ADR and faffter-noon-adr authors its body
Then the scaffolded file and authored sections are Context / Decision / Consequences, byte-identical to today's Nygard output
```

```
Given a repo with a committed .faff-templates/adr.md whose level-2 headings are Status / Context / Options / Decision / Consequences
When faff adr new scaffolds an ADR
Then the scaffold emits exactly those five ## headings in that order, each with the TODO placeholder
```

```
Given a repo whose .faff-templates/adr.md is present but empty
When faff adr format --json is run
Then format is nygard, source is default, degraded is true, and notes carries the exact stderr degrade line, so the fallback is assertable from the record
```

```
Given a repo whose .faff-templates/adr.md has headings but no ## Decision heading
When faff adr format --json is run
Then decision_section is null, notes carries the disablement line, and adrDecisionBody returns "" for every candidate, so L3 detection finds no contradictions without crashing
```

- The `faff adr format` command is read-only: it writes no files and makes no network calls, and reads the template only from `<root>/.faff-templates/adr.md`.

## 6. DESIGN DECISION RATIONALE

**How does a repo's ADR shape activate: file presence, a convention key, or a config scalar?**
- Convention key on the four-tier resolver: forces the section list out-of-band through a vocab-gated token, drags in the ADR-0129 documented/inferred tiers (a doc-scope matcher and an inference null-guard v1 does not need), and diverges from every other `.faff-templates/*` template.
- `tracking.adr_format` config scalar: a second override surface for the same artifact; still needs the file for the list.
- File presence, mirroring the ticket-template surface: `.faff-templates/adr.md` present and parseable is the shape; the file carries the list; no key, no resolver, no cache.
- **Chosen:** file presence. It reuses the shipped, documented `.faff-templates/<type>.md` model verbatim and keeps the section list in exactly one place. (This supersedes the earlier convention-key framing and its prior "key-must-select" decision.)

**How do the two writers learn the section list without hand-reading the file?**
- Each resolves independently: duplicated logic, two ADR-0128 violations.
- A single read-only `faff adr format` resolver both reach: one code path, deterministic.
- **Chosen:** `faff adr format [--json]`. Mirrors `faff conventions get`'s always-exit-0-with-a-value contract and keeps resolution CLI-only (ADR-0128 preserved; the CLI now reads a template file instead of a convention value).

**How is "byte-identical Nygard" verified, given the body is LLM-authored?**
- One golden-file test over both scaffold and body: undecidable, the body is LLM prose and cannot be byte-pinned.
- Split the check by artifact: a golden-file test on the deterministic scaffold (`faff adr new` / `adrTemplate()`), plus a structural test on the LLM body (prose under the resolved headings, in order, and under no others).
- **Chosen:** split. The scaffold half is byte-assertable against a committed fixture; the body half is a heading-sequence/containment check, never a byte comparison. (Closes the QA golden-file objection.)

**Where does the degrade log go, and what does it say?**
- "Logged" with no sink or text: unassertable, no pass/fail line.
- A concrete stderr sink with fixed message text, mirrored into the `--json` `notes` field: a test asserts the record without scraping stderr.
- **Chosen:** stderr, prefixed `faff adr format:`, with the two fixed one-line messages in section 4, and the same text in the `--json` `notes` field (with `degraded:true` for the empty/unreadable case). (Closes the QA unassertable-"logged" objection.)

**Does `faff adr validate` need to learn the resolved section set?**
- `adrValidate()` is already section-agnostic (heading/fields/numbering/back-references only); it has no Nygard section check to generalise.
- **Chosen:** leave `faff adr validate` unchanged. Shape-enforcing validation is a documented out-of-scope extension point, not a v1 requirement.

**Is ADR-shape history-inference and onboard active-mining in v1?**
- Including them couples FAFF-1085 to FAFF-1084 (onboard re-discovery gating) and adds a new classifier.
- **Chosen:** scope both out of v1. v1 resolves from the committed template file only. History-inference and onboard mining are named extension points.

**When a template has no Decision-equivalent section, what happens to L3 contradiction-detection?** (retained ratified decision, section 7)
- Require any template to declare a `## Decision`-equivalent and refuse otherwise: rejects legitimate house ADR shapes that carry no such heading.
- Degrade to disabled: `decision_section:null`, the seam sees empty input (already crash-safe), the disablement is logged and visible in `faff adr format --json`; non-blocking, so the build proceeds.
- **Chosen:** degrade to disabled. Turning a contradiction-detection seam off for a repo is observable rather than silent, and requiring a mandatory heading would impose Nygard's structure on a repo that deliberately chose a different one.

## 7. RESOLVED DECISIONS AND ASSUMPTIONS

**Superseded objections (addressed by removal, not hand-wave).** Two objections from the prior spec-review no longer apply under the file-presence model, because ADR shape no longer rides the convention resolver at all:

- The **methodology** objection (a documented-convention tier for `adr_format` is unwired: `matchDocForKey` / `scopedDocStatements` handle only `pr_title` / `commit_subject` / `branch_naming`) does not apply: there is no `adr_format` documented tier and no doc-scope activation path. Activation is file presence.
- The **architectural** objection (an `adr_format` inference-tier null-guard: `mineConventions` loops `CONVENTIONS_KEYS` and `inferConvention` would classify commit subjects for `adr_format`, producing a spurious `inferred` cache entry) does not apply: `adr_format` is never registered in `CONVENTIONS_KEYS`, so `mineConventions` never loops it and no inference or cache entry is ever produced for ADR shape.

**Ratified decisions:**

- **Chosen:** ADR shape activates on file presence, mirroring the `.faff-templates/<type>.md` ticket-template surface. A committed, parseable `.faff-templates/adr.md` is the repo's ADR shape (its ordered level-2 headings are the section list); absent resolves silently to the Nygard default (byte-identical, unlogged), while a present-but-empty, heading-less, or unreadable file degrades to the Nygard default and logs the skip. Committing the file is the deliberate opt-in. The `adr_format` convention key and the ADR-0129 four-tier resolver dependency are dropped for ADR-shape activation. Rationale: this reuses the shipped, documented ticket-template model verbatim, keeps the section list in exactly one place, and needs no convention resolver, config key, or cache. This supersedes the prior "key-must-select" decision. (decides: product)
- **Chosen:** L3 contradiction-detection under a template with no Decision-equivalent section degrades to disabled. The resolver sets `decision_section:null`, so the seam sees empty input (already crash-safe) and finds no contradictions; the disablement is logged to stderr and surfaced in `faff adr format --json` (`notes`). It is non-blocking, so the build proceeds. Rationale: disabling a contradiction-detection seam for a repo is observable rather than silent, and requiring every template to declare a `## Decision`-equivalent heading would reject legitimate house ADR shapes that carry no such heading. Retained from the prior resolution, unchanged. (decides: architecture)
- **Chosen:** the "byte-identical Nygard" DoD splits by artifact - a golden-file test on the deterministic scaffold (`faff adr new` / `adrTemplate()`) against a committed fixture captured from the pre-change code as an independent baseline, and a structural test on the LLM-authored body (`faffter-noon-adr` emits prose under the resolved headings in order and under no others), itself split into a born-verifiable static CI check on the SKILL.md Output section plus a holdout structural check. No byte-identical golden-file test is claimed on the LLM body. Rationale: the scaffold is deterministic and byte-assertable; the body is LLM prose and can only be checked structurally, so the CI-gated half asserts the deterministic producer wiring and the non-deterministic prose is left to the holdout. (decides: QA)
- **Chosen:** the degrade/disablement log has a concrete sink and fixed text - stderr, prefixed `faff adr format:`, with the two one-line messages defined in section 4 - and the same text is surfaced in `faff adr format --json` (`notes`, with `degraded:true` for the empty/unreadable case), so every "logged" claim is pass/fail decidable from the machine-readable record. Rationale: an unassertable "logged" claim has no test line; a fixed sink and message plus a `--json` field make it testable without scraping stderr. (decides: QA)

**Assumptions:**

- **Assumes:** the `.faff-templates/<type>.md` reader contract in create.md (level-2 headings define the ordered field/section list, body text ignored, empty/unreadable degrades and logs) is the intended parsing model for `.faff-templates/adr.md` too. Validation: re-read `plugin/skills/faff/references/create.md`'s Override files section and reuse its heading-extraction rule rather than inventing a second parser.
- **Assumes:** `adr.js` is the landing site for the resolver and the `faff adr format` command - `adrTemplate()` (~L454), `adrDecisionBody()` (~L537), and `adrLiveDecisions()` (~L546) are the three sites the change touches, and `conventions.js` / `record_locations` is not involved. Validation: before starting, confirm those three functions still carry the hardcoded `## Context` / `## Decision` / `## Consequences` strings and the `## Decision` parse in `adr.js`, and that no `adr_format` key exists in `conventions.js`.

## 8. DONE - Definition of Done

### From WHY
- [ ] A repo with no `.faff-templates/adr.md` produces a `faff adr new` scaffold byte-identical to the current Nygard output, verified by a golden-file test against a committed fixture (scaffold half - deterministic; byte-identity holds by construction because `nygard_default()` carries `adrTemplate()`'s three verbatim per-section placeholders). The fixture is an INDEPENDENT baseline, not a self-referential oracle: it is captured by running the pre-change `adrTemplate()` (at HEAD, before the refactor) once and committing its exact bytes, then never regenerated from the post-change code. A failing diff is fixed by correcting the refactor, never by re-recording the fixture. The exact expected bytes are those named in nygard_default() plus the `# ADR <num> — <title>` / Status / Provenance / Date / [Issue] front matter and the existing trailing newline, so a reviewer can confirm the fixture against the spec without running either code path.
- [ ] Body half (LLM-authored, not byte-compared), split into a born-verifiable CI check and a holdout check so neither DoD line depends on a live model:
  - CI (deterministic, no LLM call): `faffter-noon-adr`'s SKILL.md Output section drives its section list from `faff adr format --json` and no longer hardcodes the three Nygard headings - asserted by a static check that the Output section names the resolved-sections source and carries no literal `## Context` / `## Decision` / `## Consequences` triple.
  - Holdout (the `holdout` scenario, judged by the evaluator or a human, never a gated unit test): a real `faffter-noon-adr` run against a five-heading template emits prose under exactly those five headings in order and under no others (a structural heading-sequence check on the produced body, not a byte comparison).
- [ ] The self-hosting faff repo's `records/adr/` scaffold output is unchanged (its corpus is pure Nygard, and it commits no `.faff-templates/adr.md`).

### From WHAT (types and interfaces)
- [ ] `faff adr format [--json] [--root DIR]` exists, is read-only (no writes, no network), always exits 0, and `--json` emits the `ResolvedAdrFormat` record with `format` / `sections` (each a `{name, placeholder}`) / `decision_section` / `source` / `template_path` / `degraded` / `notes`.
- [ ] For a repo with no template, the record is `format:"nygard"`, `source:"default"`, `degraded:false`, `notes:null`, and `sections` is the three entries `Context` / `Decision` / `Consequences` in order, each carrying `adrTemplate()`'s verbatim per-section placeholder (`_TODO: what forces this decision._` / `_TODO: the decision, stated forward._` / `_TODO: what this constrains downstream._`), with `decision_section=="Decision"`.
- [ ] `.faff-templates/adr.md` is parsed with create.md's heading-extraction rule (ordered level-2 headings define the section list; body text ignored). No `adr_format` convention key is registered; `CONVENTIONS_KEYS` / `CONVENTIONS_DEFAULTS` / `CONVENTIONS_VOCAB` are unchanged.
- [ ] `faff adr format` reads the template only from `<root>/.faff-templates/adr.md` and resolves `<root>` from `--root` or the repo root.
- [ ] `format` is registered in `adr.js`'s `ADR_SURFACE.subcommands` as `format: { required_flags: [] }`, so `faff cli-surface --json` reports it and the drift-guard passes; a surface/drift test covers the new verb.
- [ ] Bare `faff adr format` prints the defined one-line summary (`adr format: <token> (<source>; sections: …)` plus any `; note:`); the machine-assertable path under test is `--json`.

### From HOW (behaviour)
- [ ] `adrTemplate(fields, resolved_format = nygard_default())` emits `## <name>` followed by that section's own `placeholder` for each entry in the resolved `sections`, driven by `faff adr format`, replacing the three literal Nygard strings hardcoded today. For a Nygard resolution the three placeholders are `adrTemplate()`'s exact per-section strings, so the scaffold is byte-identical by construction; for a template each section carries the generic `_TODO: ..._` line. The default keeps every existing caller and `adrSelftest` case (which pass no second argument) byte-identical.
- [ ] `faffter-noon-adr` calls `faff adr format --json` and authors prose under each resolved heading in order (its SKILL.md Output section no longer hardcodes the three Nygard sections).
- [ ] `adrDecisionBody(text, decision_section)` reads the named heading, returns `""` when `decision_section` is null or the heading is absent, and `adrLiveDecisions(dir, excludeId, root)` resolves the format once (via `resolve_adr_format(root)`) and threads the resolved `decision_section` through each `adrDecisionBody` call.

### From HOW (edge cases and logging)
- [ ] A committed `.faff-templates/adr.md` with valid level-2 headings drives both the scaffold and the body: the scaffold emits exactly those headings in order, each with the TODO placeholder.
- [ ] A present but empty / heading-less / unreadable `.faff-templates/adr.md` degrades to Nygard, never blocks, writes the exact line `faff adr format: .faff-templates/adr.md is empty or has no level-2 headings; using the Nygard default` to stderr, and sets `degraded:true` with that same text in the `--json` `notes` field.
- [ ] A template with no `## Decision` heading yields `decision_section:null`; L3 runs without crashing and finds no contradictions; the resolver writes the exact disablement line to stderr and surfaces it in the `--json` `notes` field (retained ratified decision, section 7).

### Integration smoke test
```
PROCEDURE smoke():
  1. In a scratch repo, write .faff-templates/adr.md with headings: Status / Context / Options / Decision / Consequences
  2. Run `faff adr format --json`  =>  expect format=="template", the five section names in order (each with the generic placeholder), decision_section=="Decision", source=="template", degraded==false, notes==null
  3. Run `faff adr new --title "Test decision"`  =>  scaffolded file has exactly those five ## headings, in order, each with a TODO placeholder
  4. Remove the template file; re-run `faff adr format --json`  =>  format=="nygard", source=="default"; re-run `faff adr new --title "Test decision"`  =>  Context / Decision / Consequences, byte-identical to today
  5. Write .faff-templates/adr.md with headings that omit Decision; run `faff adr format --json`  =>  decision_section==null, notes carries the disablement line
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```