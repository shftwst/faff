# Faff gateway reference — create lane

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Ticket templates (born-structured create boundary)

This section defines the type-appropriate templates `/faff-jot` (Step 4) and `/faff-plot` (Step 5) fill when creating tickets. Both reference the taxonomy and field sets without duplicating them. Fill after the `methodology` slot's `ticket-shaping` proposes the set, before handing the description to `rendering_adaptor` (gateway → **Rendering**).

**The load-bearing invariant — seed, never constrain.** Templates are defaults to fill, never completeness gates. Missing content never rejects, blocks or warns-to-block creation: a one-line idea produces one filled field and placeholders for the rest. Completeness belongs to `/faff-prep`.

**Type taxonomy (closed set + fallback).**

- `bug` — a defect in existing behaviour
- `feature` — a new capability or behaviour
- `spike` — a time-boxed investigation / decision, no committed deliverable
- `chore` — maintenance with no user-facing behaviour change
- `epic` — a container that decomposes into child slices
- `default` — fallback when type can't be determined (guarantees the fill step always has a skeleton, preserving the never-block invariant)

**Built-in default field sets.** Ordered lists; every template ends with `Open questions`.

| Type | Fields (in order) |
|---|---|
| `bug` | Repro · Expected · Actual · Scope · Open questions |
| `feature` | Why · What · Acceptance · Open questions |
| `spike` | Question · Timebox · Decision to make · Open questions |
| `chore` | What · Why now · Open questions |
| `epic` | Outcome · Child slices · Open questions |
| `default` | Why · What · Open questions |

**Template resolution order** (first match wins, per type):

1. *Native-template slot* (tracker-native Linear/GitHub templates): look up this faff-type in the committed map. On a hit, live-fetch the tracker template body as source of truth. No map/entry, stale id or opaque body falls through to tier 2; see **Native-template fill**.
2. A committed **override file** at `<templates-path>/<type>.md`, if present, where `<templates-path>` is what `faff config templates-path --absolute` prints (use that string verbatim; do not join it onto the working directory or the repo root).
3. The built-in default field set above.

(`default` resolves the same way; a project may even override `<templates-path>/default.md`.)

**Native-template fill (tier 1).** Only the create-skill orchestrator calls the tracker: the pure CLI returns the stored id; the lane fetches its body via `get_template`. Misses never block creation; unfilled fields remain placeholders.

```
resolve_native_template(type):        # → FieldSequence | MISS
  m := run `faff native-map get --type <type> --json`   # pure CLI; never errors on absence
  IF m has no `id` (a miss prints {type, mapping:null}; a hit prints {type, id, name}): RETURN MISS   # no tier-1 entry → tier 2
  tmpl := get_template(id = m.id)                        # orchestrator-lane MCP read (jot/plot's MCP lane)
  IF tmpl empty / not found (stale id, renamed/deleted): # OR an MCP timeout/absent connector
     REPORT stale mapping naming type + m.id + m.name    # extends "log the skipped override" (below)
     RETURN MISS
  fields := heading sequence of `## <Field>` in tmpl.content.description   # the SAME tier-2 parse
  IF fields is empty:                                    # opaque body: form template / plain prose / no `## ` headings
     REPORT opaque mapping naming type + m.id
     RETURN MISS
  RETURN fields
```

- Read `get_template(id)`'s `content.description` markdown for its ordered `## <Field>` level-2 headings only. Ignore body guidance, as with tier-2 overrides. A tracker form with no such headings is an opaque-body miss.
- First-match-wins is preserved: tier 1 only *prepends* a resolution attempt; on any miss the existing tier 2 → tier 3 order runs unchanged.
- **Git-only / no tracker connector:** `get_template` needs a tracker, so tier 1 always misses and the fill runs identically to today.

**Override files.** Read committed `<templates-path>/<type>.md`; only `faff config templates-path --absolute` resolves the location. Failure falls to tier 3; a deprecation notice on stderr is informational. Default `.faff/templates/` stays commit-able through root `.faff/*` and `.faff/.gitignore`'s `!/templates/`. Files are the sole override surface; `tracking.templates_path` supplies only the location, since the scalar/block-scalar config CLI cannot cleanly read a per-type map. Parse ordered `## <Field>` level-2 headings, ignoring body guidance.

**Type determination** (per proposed ticket):

1. If the methodology's `ticket-shaping` attached an optional per-ticket `type` that is in the taxonomy → use it.
2. Else infer from the ticket's title + description: *broken / incorrect / regressed behaviour* ("fails", "doesn't", "regression") → `bug`; *open question / "figure out" / "decide", no committed deliverable* → `spike`; *maintenance with no user-facing change (deps, refactor, config, cleanup)* → `chore`; *a container that decomposes into child slices / spans multiple deliverables* → `epic`; *a new capability or behaviour* → `feature` (the lean for greenfield brief items).
3. If inference isn't confident → `default`.

**The fill step** (run once per proposed ticket):

1. Determine the type (above).
2. Resolve the template (above).
3. For each field in order: emit `## <Field>` followed by the best-available content drawn from the proposed ticket + brief (e.g. `feature.Why` ← the brief's goal/why prose; `feature.Acceptance` ← the brief's done-signal; `bug.Repro` ← any repro prose; every template's `Open questions` ← the brief's open questions). **When no content is available, emit the field heading with the explicit placeholder `_To be determined during prep._`** — never silently omit a field, and **never fabricate** factual content (no invented repro steps, no invented acceptance).
4. The assembled fields become the description, which then routes through the `rendering_adaptor` and is written to the tracker exactly as before.

**Edge cases.**

- Override file that's empty, heading-less, or unreadable → treat as absent, fall through to the built-in default (never block), and **log the skipped override**.
- Override filename for an unknown type (`foo.md`) → ignored; only the recognised type filenames + `default` are consulted.
- **plot** container nodes (`shape-level` = `initiative` / `project`, or any node with children) resolve to the `epic` template *type*, then run the tier-1 lookup for `epic`; buildable first-slice nodes infer their own type per node.
- **Git-only mode:** the fill step runs identically and the structured description is written into the `.faff/intake/…` file jot/plot already use; override files are read the same way, through the same resolver.
- Only the description body changes: preserve blocker/blocked-by links, `Backlog` status and plot's `planned by /faff-plot` provenance line.

**Out-of-scope seam (documented, not built here):** persisting the determined type as a `faff-type-<type>` control label via **Control-label provisioning**.
