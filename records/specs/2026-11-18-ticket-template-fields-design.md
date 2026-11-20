# Resolve ticket template fields

Jot and plot choose the ticket type from the methodology and ticket content. The CLI reads the existing native map and returns a fetch identity on a hit. Only the discovered tracker fetches the live body. With a supplied body the CLI returns its ordered level-2 fields, falling through to the configured local override and built-ins on a miss. Git-only callers select the local path directly. Missing fields never block creation.

The resolver prints field names without template prose. It writes no tickets, cache or configuration. The authors keep the description content, team routing, template-failure reporting and confirmation. The original native-map get/set forms retain their output shapes.

## Rule inventory

| Prose rule | Command behaviour or retained author decision | Covering test | Disposition |
|---|---|---|---|
| `- Fill each ticket's description from its type template (gateway` | The jot caller now references the shared fill instructions. |  | changed: jot uses the shared instructions |
| `This section defines the type-appropriate templates /faff-jot (St` | Jot and plot share the create-lane field resolver before rendering. |  | changed: preserve this caller instruction in the shared create reference |
| `The load-bearing invariant — seed, never constrain. Templates are` | The author may always create with placeholders. |  | changed: preserve this caller instruction in the shared create reference |
| `Type taxonomy (closed set + fallback).` | The author chooses among the existing six types. |  | changed: preserve this caller instruction in the shared create reference |
| `- bug — a defect in existing behaviour` | Broken behaviour still selects bug. |  | changed: preserve this caller instruction in the shared create reference |
| `- feature — a new capability or behaviour` | New behaviour still selects feature. |  | changed: preserve this caller instruction in the shared create reference |
| `- spike — a time-boxed investigation / decision, no committed del` | Investigation still selects spike. |  | changed: preserve this caller instruction in the shared create reference |
| `- chore — maintenance with no user-facing behaviour change` | Maintenance still selects chore. |  | changed: preserve this caller instruction in the shared create reference |
| `- epic — a container that decomposes into child slices` | Containers still select epic. |  | changed: preserve this caller instruction in the shared create reference |
| `- default — fallback when type can't be determined (guarantees th` | Uncertain cases select default. |  | changed: preserve this caller instruction in the shared create reference |
| `Built-in default field sets. Ordered lists; every template ends w` | Built-in fields preserve their order and end with Open questions. | test/ticket-template-fields.test.mjs | kept |
| `\| Type \| Fields (in order) \|` | Return an ordered field list for each type. | test/ticket-template-fields.test.mjs | kept |
| `Repro · Expected · Actual · Scope · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `Why · What · Acceptance · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `Question · Timebox · Decision to make · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `What · Why now · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `Outcome · Child slices · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `Why · What · Open questions` | Return the original ordered built-in fields for this type. | test/ticket-template-fields.test.mjs | kept |
| `Template resolution order (first match wins, per type):` | Check native, committed override, then built-in. | test/ticket-template-fields.test.mjs | kept |
| `1. Native-template slot (tracker-native Linear/GitHub templates):` | A native-map hit returns the identity for the existing connector. | test/ticket-template-fields.test.mjs | kept |
| `2. A committed override file at <templates-path>/<type>.md, if pr` | The config resolver chooses the scoped override path. | test/ticket-template-fields.test.mjs | kept |
| `3. The built-in default field set above.` | Missing usable overrides resolve to the built-in type. | test/ticket-template-fields.test.mjs | kept |
| `(default resolves the same way; a project may even override <temp` | Default accepts an override through the same resolver. | test/ticket-template-fields.test.mjs | kept |
| `Native-template fill (tier 1). Only the create-skill orchestrator` | The connector fetches the live description. |  | changed: preserve this caller instruction in the shared create reference |
| `resolve_native_template(type):` | A miss falls back and surfaces stale or opaque mapping information. |  | changed: preserve this caller instruction in the shared create reference |
| `- Read get_template(id)'s content.description markdown for its or` | Only ordered level-2 headings supply fields. | test/ticket-template-fields.test.mjs | kept |
| `- First-match-wins is preserved: tier 1 only prepends a resolutio` | A resolved native body wins over the local override. | test/ticket-template-fields.test.mjs | kept |
| `- Git-only / no tracker connector: get_template needs a tracker,` | Git-only callers choose the local path directly. | test/ticket-template-fields.test.mjs | kept |
| `Override files. Read committed <templates-path>/<type>.md; only f` | The config resolver preserves override precedence and reports skipped overrides. | test/ticket-template-fields.test.mjs | kept |
| `Type determination (per proposed ticket):` | Type remains a question for the author. |  | changed: preserve this caller instruction in the shared create reference |
| `1. If the methodology's ticket-shaping attached an optional per-t` | Recognized methodology types take precedence. |  | changed: preserve this caller instruction in the shared create reference |
| `2. Else infer from the ticket's title + description: broken / inc` | Infer the type from the ticket title and description. |  | changed: preserve this caller instruction in the shared create reference |
| `3. If inference isn't confident → default.` | Choose default when inference is uncertain. |  | changed: preserve this caller instruction in the shared create reference |
| `The fill step (run once per proposed ticket):` | Fill the description once per proposed ticket. |  | changed: preserve this caller instruction in the shared create reference |
| `1. Determine the type (above).` | Determine type before resolving fields. |  | changed: preserve this caller instruction in the shared create reference |
| `2. Resolve the template (above).` | Resolve fields before authoring the description. | test/ticket-template-fields.test.mjs | kept |
| `3. For each field in order: emit ## <Field> followed by the best-` | Fill every field from the brief, using the exact placeholder for gaps. |  | changed: preserve this caller instruction in the shared create reference |
| `4. The assembled fields become the description, which then routes` | The rendering adaptor receives the draft for the existing write lane. |  | changed: preserve this caller instruction in the shared create reference |
| `- Override file that's empty, heading-less, or unreadable → treat` | Empty, unreadable and heading-less overrides report a diagnostic and fall back. | test/ticket-template-fields.test.mjs | kept |
| `- Override filename for an unknown type (foo.md) → ignored; only` | The finite taxonomy rules out unrelated override filenames. | test/ticket-template-fields.test.mjs | kept |
| `- plot container nodes (shape-level = initiative / project, or an` | Plot selects epic for a container and infers types for buildable slices. |  | changed: preserve this caller instruction in the shared create reference |
| `- Git-only mode: the fill step runs identically and the structure` | Git-only uses the same local fields and intake lane. |  | changed: preserve this caller instruction in the shared create reference |
| `- Only the description body changes: preserve blocker/blocked-by` | Keep provenance, Backlog status and blocker links. |  | changed: preserve this caller instruction in the shared create reference |
| `Out-of-scope seam (documented, not built here): persisting the de` | Setting a control label remains outside the fill operation. |  | changed: preserve this caller instruction in the shared create reference |
